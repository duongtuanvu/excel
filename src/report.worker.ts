import * as XLSX from 'xlsx';
import * as duckdb from '@duckdb/duckdb-wasm';
import { mvpWasm, ehWasm, mvpWorker, ehWorker } from 'duckdb-assets';
import { LIMITS, normalizeHeaders, compileReport, safeCsvCell } from './model';
import type { Cell, Column, Kind, Source, Config, Report, Group } from './model';
import type { Request, Response } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let workbook: XLSX.WorkBook | null = null;
let source: Source | null = null;
let database: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;

async function connect() {
  if (database && connection) return { db: database, conn: connection };
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  if (!bundle.mainWorker) throw new Error('Trình duyệt không hỗ trợ DuckDB-Wasm.');
  // Vite emits same-origin assets; resolve relative URLs inside this worker.
  const absolute = (path: string) => new URL(path, self.location.href).href;
  const worker = new Worker(absolute(bundle.mainWorker));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(absolute(bundle.mainModule), bundle.pthreadWorker ? absolute(bundle.pthreadWorker) : undefined);
    const conn = await db.connect();
    await conn.query("SET memory_limit = '384MB'");
    database = db; connection = conn;
    return { db, conn };
  } catch (error) { worker.terminate(); throw error; }
}

const numericPattern = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$|^[+-]?\.\d+$/;
function numericString(value: unknown): boolean {
  return typeof value === 'number' ? Number.isFinite(value) :
    typeof value === 'string' && numericPattern.test(value.trim()) && Number.isFinite(Number(value));
}
function kindFor(values: unknown[]): Kind {
  const present = values.filter(v => v !== null && v !== undefined && v !== '');
  if (!present.length) return 'text';
  if (present.every(v => v instanceof Date && Number.isFinite(v.getTime()))) return 'date';
  if (present.every(v => typeof v === 'boolean')) return 'boolean';
  if (present.every(numericString)) return 'number';
  return 'text';
}
function asCell(value: unknown, kind: Kind): Cell {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (kind === 'number' && numericString(value)) return Number(value);
  if (kind === 'boolean' && typeof value === 'boolean') return value;
  const str = String(value);
  if (str.length > LIMITS.textLength || str.includes('\0')) throw new Error('Ô dữ liệu quá dài hoặc chứa ký tự không hợp lệ.');
  return str;
}
const quoted = (v: Cell) => v === null ? '""' : '"' + String(v).replaceAll('"', '""') + '"';

function prepare(book: XLSX.WorkBook, sheet: string, name: string) {
  if (!book.SheetNames.includes(sheet)) throw new Error('Không tìm thấy sheet.');
  const ws = book.Sheets[sheet];
  if (!ws || !ws['!ref']) throw new Error('Sheet không có dữ liệu.');
  const range = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref']);
  const width = range.e.c - range.s.c + 1;
  const height = range.e.r - range.s.r + 1;
  if (width > LIMITS.columns || height > LIMITS.rows + 1 || width * height > LIMITS.cells) throw new Error('Sheet vượt giới hạn 100.000 dòng, 100 cột hoặc 1 triệu ô.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (!matrix.length) throw new Error('Không có hàng tiêu đề.');
  const headers = normalizeHeaders(Array.from({ length: width }, (_, i) => matrix[0][i]));
  const data = matrix.slice(1);
  const columns: Column[] = headers.map((name, i) => ({ id: 'c' + i, name, kind: kindFor(data.map(row => row[i])) }));
  const csv: string[] = [columns.map(c => c.id).join(',')];
  let count = 0, chars = csv[0].length;
  for (const row of data) {
    const cells = columns.map((c, i) => asCell(row[i], c.kind));
    if (cells.every(v => v === null)) continue;
    const line = cells.map(quoted).join(',');
    chars += line.length + 1;
    if (chars > 40_000_000) throw new Error('Dữ liệu sau giải nén quá lớn. Hãy chia nhỏ sheet.');
    csv.push(line); count++;
  }
  return { csv: csv.join('\n'), next: { name, sheets: [...book.SheetNames], sheet, rows: count, columns } satisfies Source };
}

async function activate(book: XLSX.WorkBook, sheet: string, name: string): Promise<Source> {
  const { csv, next } = prepare(book, sheet, name);
  const { db, conn } = await connect();
  const path = 'report_import.csv';
  await conn.query('DROP TABLE IF EXISTS report_stage');
  try {
    if (next.rows) {
      await db.registerFileText(path, csv);
      await conn.query("CREATE TABLE report_stage AS SELECT * FROM read_csv('report_import.csv', header=true, all_varchar=true, delim=',', quote='\u0022', escape='\u0022', nullstr='', sample_size=-1)");
      const result = await conn.query('SELECT COUNT(*) AS n FROM report_stage');
      if (Number(result.get(0)?.n) !== next.rows) throw new Error('Số dòng nhập không khớp.');
      const schema = await conn.query('SELECT * FROM report_stage LIMIT 0');
      if (schema.schema.fields.length !== next.columns.length || schema.schema.fields.some((f, i) => f.name !== next.columns[i].id)) throw new Error('Cấu trúc cột nhập không khớp.');
    } else {
      await conn.query('CREATE TABLE report_stage (' + next.columns.map(c => '"' + c.id + '" VARCHAR').join(', ') + ')');
    }
    await conn.query('BEGIN TRANSACTION');
    try {
      await conn.query('DROP TABLE IF EXISTS report_data');
      await conn.query('ALTER TABLE report_stage RENAME TO report_data');
      await conn.query('COMMIT');
    } catch (e) { await conn.query('ROLLBACK'); throw e; }
    workbook = book; source = next;
    return next;
  } finally {
    if (next.rows) await db.dropFile(path).catch(() => {});
    await conn.query('DROP TABLE IF EXISTS report_stage').catch(() => {});
  }
}

function demoBook(): XLSX.WorkBook {
  const data: Cell[][] = [['Ngày', 'Khu vực', 'Nhóm sản phẩm', 'Sản phẩm', 'Số lượng', 'Doanh thu', 'Chi phí']];
  const areas = ['Miền Bắc', 'Miền Trung', 'Miền Nam', 'Tây Nguyên'];
  const products = [['Điện tử','Tai nghe', 690000], ['Điện tử','Loa Bluetooth', 1250000], ['Gia dụng','Đèn bàn', 350000], ['Văn phòng','Sổ tay', 95000], ['Gia dụng','Bình nước', 185000]] as const;
  for (let i = 0; i < 180; i++) {
    const p = products[i % products.length], qty = 1 + (i * 7 % 23);
    const total = p[2] * qty;
    data.push(['2026-' + String(1 + (i % 6)).padStart(2,'0') + '-' + String(1 + (i % 28)).padStart(2,'0'), areas[(i * 3 + Math.floor(i / 5)) % 4], p[0], p[1], qty, total, Math.round(total * .63)]);
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), 'Bán hàng');
  return book;
}

const numberOrNull = (v: unknown): number | null => v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;
function convert(v: unknown, kind: Kind): Cell {
  if (v === null || v === undefined) return null;
  if (kind === 'number') return numberOrNull(v);
  if (kind === 'boolean') return String(v) === 'true';
  return String(v);
}
async function makeReport(config: Config, page: number): Promise<Report> {
  if (!source || !connection) throw new Error('Chưa có nguồn dữ liệu.');
  const query = compileReport(config, source.columns);
  const totals = await connection.query(query.totals);
  const total = totals.get(0);
  const filtered = Number(total?.n ?? 0);
  const safePage = Math.max(0, Math.min(Math.floor(Math.max(0, filtered - 1) / LIMITS.page), Number.isFinite(page) ? Math.trunc(page) : 0));
  const grouped = await connection.query(query.groups);
  const groups: Group[] = [];
  for (const row of grouped) {
    if (!row || groups.length === LIMITS.groups) break;
    groups.push({ labels: config.groups.map((_, i) => row['g' + i] == null ? null : String(row['g' + i])), value: numberOrNull(row.value), count: Number(row.n) });
  }
  const previewResult = await connection.query(query.preview(safePage));
  const preview = Array.from(previewResult, row => source!.columns.map(c => convert(row?.[c.id], c.kind)));
  return { total: numberOrNull(total?.value), filtered, groups, truncated: grouped.numRows > LIMITS.groups, preview, page: safePage };
}

async function exportReport(config: Config, format: 'xlsx' | 'csv') {
  if (!source || !connection) throw new Error('Chưa có nguồn dữ liệu.');
  const report = await makeReport(config, 0);
  if (report.truncated) throw new Error('Báo cáo có quá 5.000 nhóm. Hãy thêm bộ lọc trước khi xuất.');
  const label = config.aggregate === 'count' ? 'Số dòng' : config.aggregate.toUpperCase() + ' ' + config.metric;
  const head = [...config.groups, label, 'Số bản ghi'];
  const summary: Cell[][] = [head, ...report.groups.map(g => [...g.labels, g.value, g.count])];
  const name = 'kysheet-' + new Date().toISOString().slice(0,10);
  if (format === 'csv') {
    const buffer = new TextEncoder().encode('\uFEFF' + summary.map(row => row.map(safeCsvCell).join(',')).join('\r\n'));
    return { bytes: buffer.buffer as ArrayBuffer, name: name + '.csv', mime: 'text/csv;charset=utf-8' };
  }
  const raw = await connection.query(compileReport(config, source.columns).raw);
  const rows: Cell[][] = [source.columns.map(c => c.name), ...Array.from(raw, row => source!.columns.map(c => convert(row?.[c.id], c.kind)))];
  const book = XLSX.utils.book_new();
  const kpi = XLSX.utils.aoa_to_sheet([['Báo cáo', config.title], ['Chỉ số', label], ['Giá trị', report.total], ['Số dòng sau lọc', report.filtered], ['Nguồn', source.name], ['Sheet', source.sheet]]);
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  const rawSheet = XLSX.utils.aoa_to_sheet(rows);
  summarySheet['!cols'] = head.map(h => ({ wch: Math.max(14, Math.min(40, h.length + 4)) }));
  rawSheet['!cols'] = source.columns.map(c => ({ wch: Math.max(12, Math.min(35, c.name.length + 4)) }));
  XLSX.utils.book_append_sheet(book, kpi, 'Tổng quan');
  XLSX.utils.book_append_sheet(book, summarySheet, 'Tổng hợp');
  XLSX.utils.book_append_sheet(book, rawSheet, 'Dữ liệu đã lọc');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return { bytes, name: name + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'demo': { const book = demoBook(); return activate(book, book.SheetNames[0], 'Dữ liệu mẫu.xlsx'); }
    case 'import': {
      if (!req.input.bytes.byteLength || req.input.bytes.byteLength > LIMITS.fileBytes) throw new Error('File phải nhỏ hơn hoặc bằng 25 MB và không được rỗng.');
      if (!/\.(xlsx|xls|csv|tsv)$/i.test(req.input.name)) throw new Error('Định dạng file không được hỗ trợ.');
      const book = XLSX.read(req.input.bytes, { type: 'array', cellDates: true, raw: true, dense: true, sheetRows: LIMITS.rows + 2 });
      if (!book.SheetNames.length) throw new Error('Workbook không có sheet.');
      return activate(book, book.SheetNames[0], req.input.name);
    }
    case 'sheet': {
      if (!workbook || !source) throw new Error('Chưa có workbook.');
      return activate(workbook, req.input.sheet, source.name);
    }
    case 'report': return makeReport(req.input.config, req.input.page);
    case 'export': return exportReport(req.input.config, req.input.format);
  }
}

// One queue per session: imports, queries and exports cannot mutate the active table concurrently.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data;
  queue = queue.then(async () => {
    try {
      const data = await handle(req);
      const response: Response = { id: req.id, ok: true, data };
      const transfer = req.type === 'export' ? [(data as { bytes: ArrayBuffer }).bytes] : [];
      scope.postMessage(response, transfer);
    } catch (error) {
      scope.postMessage({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Response);
    }
  }).catch(error => console.error('Report worker communication failed', error));
};
