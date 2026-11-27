import * as XLSX from 'xlsx';
import { LIMITS } from './model.ts';
import { losslessNumericCell } from './import-number.ts';
import { WORKSPACE_LIMITS } from './source-model.ts';

type PackageEntry = { content: Uint8Array };
type PackagedBook = XLSX.WorkBook & {
  files?: Record<string, PackageEntry>;
  keys?: string[];
  Directory?: { workbooks?: string[] };
};

function textFile(bytes: ArrayBuffer): string {
  const prefix = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const encoding = prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf-16le'
    : prefix[0] === 0xfe && prefix[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('CSV_ENCODING: Không đọc được ký tự. Hãy lưu lại CSV/TSV bằng UTF-8.');
  }
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp('\\s' + name + '\\s*=\\s*(["\'])(.*?)\\1').exec(tag)?.[2];
}

// SheetJS replaces an OOXML formula without a <v> by zero when there is no
// explicit cell type. It also parses numeric XML through JS Number. Preserve the
// underlying evidence while the ZIP entries are available, then release them.
function preserveXmlCells(book: PackagedBook) {
  const files = book.files;
  if (!files) throw new Error('WORKBOOK_XML: Không thể kiểm tra giá trị gốc và kết quả công thức của workbook.');
  const workbookPath = (book.Directory?.workbooks?.[0] ?? '/xl/workbook.xml').replace(/^\//, '');
  const slash = workbookPath.lastIndexOf('/') + 1;
  const relPath = workbookPath.slice(0, slash) + '_rels/' + workbookPath.slice(slash) + '.rels';
  const decoder = new TextDecoder();
  const rels = files[relPath];
  if (!rels) throw new Error('WORKBOOK_XML: Thiếu danh sách sheet của workbook Excel.');
  const paths = new Map<string, string>();
  for (const [tag] of decoder.decode(rels.content).matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)) {
    const id = attribute(tag, 'Id'), target = attribute(tag, 'Target');
    if (id && target) paths.set(id, decodeURI(new URL(target, 'https://workbook.invalid/' + workbookPath).pathname.slice(1)));
  }
  for (const [i, name] of book.SheetNames.entries()) {
    const id = (book.Workbook?.Sheets?.[i] as { id?: string } | undefined)?.id;
    const part = id && paths.get(id);
    if (!part || !files[part] || !part.toLowerCase().endsWith('.xml'))
      throw new Error('WORKBOOK_XML: Không thể kiểm tra nội dung gốc của sheet ' + name + '.');
    const ws = book.Sheets[name], xml = decoder.decode(files[part].content);
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>)/g)) {
      const body = match[2];
      if (!body) continue;
      const content = /<(?:[\w.-]+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:[\w.-]+:)?v\s*>/.exec(body)?.[1];
      const missingCache = /<(?:[\w.-]+:)?f(?:[\s/>])/.test(body) && !content?.trim();
      const ref = /\sr\s*=\s*["']([A-Za-z]+\d+)["']/.exec(match[1])?.[1];
      if (!ref) {
        if (missingCache) throw new Error('SOURCE_CELL_ERROR: Công thức thiếu kết quả và địa chỉ ô trong sheet ' + name + '. Hãy tính lại và lưu file.');
        continue;
      }
      const at = XLSX.utils.decode_cell(ref);
      if (at.r > LIMITS.rows + 1) continue;
      const cell = ws['!data']?.[at.r]?.[at.c];
      if (missingCache && !cell) throw new Error('SOURCE_CELL_ERROR: Công thức thiếu kết quả tại ' + name + '!' + ref + '. Hãy tính lại và lưu file.');
      if (!cell) continue;
      if (missingCache) {
        cell.t = 'e';
        cell.f ??= '(công thức)';
        delete cell.v;
      } else if (cell.t === 'n' && content && typeof losslessNumericCell(content) === 'string') {
        cell.t = 's';
        cell.v = content;
      }
    }
  }
  delete book.keys;
  delete book.files;
}

export function workbookCellCount(book: XLSX.WorkBook): number {
  if (!book.SheetNames.length || book.SheetNames.length > WORKSPACE_LIMITS.sheetsPerBook)
    throw new Error('WORKBOOK_LIMIT: Workbook phải có 1–32 sheet.');
  let cells = 0;
  for (const name of book.SheetNames) {
    const ws = book.Sheets[name], ref = ws?.['!fullref'] || ws?.['!ref'];
    if (!ref) continue;
    const { s, e } = XLSX.utils.decode_range(ref);
    const size = (e.r - s.r + 1) * (e.c - s.c + 1);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('WORKBOOK_RANGE_INVALID: Vùng dữ liệu không hợp lệ.');
    cells += size;
    if (cells > WORKSPACE_LIMITS.bookCells) throw new Error('WORKBOOK_CELLS_LIMIT: Workbook vượt 2 triệu ô.');
  }
  return cells;
}

export function readSourceWorkbook(name: string, bytes: ArrayBuffer): XLSX.WorkBook {
  if (!bytes.byteLength || bytes.byteLength > LIMITS.fileBytes)
    throw new Error('FILE_SIZE_INVALID: File phải không rỗng và tối đa 25 MiB.');
  if (!/\.(xlsx|xls|csv|tsv)$/i.test(name))
    throw new Error('FILE_FORMAT_INVALID: Định dạng file không được hỗ trợ.');
  const opts = { cellDates: true, raw: true, dense: true, sheetRows: LIMITS.rows + 2, UTC: true };
  if (/\.(csv|tsv)$/i.test(name)) {
    return XLSX.read(textFile(bytes), { ...opts, type: 'string', ...(/\.tsv$/i.test(name) ? { FS: '\t' } : {}) });
  }
  const isZip = new Uint8Array(bytes, 0, 1)[0] === 0x50;
  const book = XLSX.read(bytes, { ...opts, type: 'array', bookFiles: isZip, sheetStubs: true });
  workbookCellCount(book);
  if (book.bookType === 'xlsx' || book.bookType === 'xlsm') preserveXmlCells(book);
  return book;
}

/** Validate original cells before sheet_to_json can turn an error into a missing value. */
export function readSheetRows(ws: XLSX.WorkSheet, sheet: string, range: XLSX.Range, blankrows: boolean): unknown[][] {
  const dense = ws['!data'];
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (dense && !dense[r]) continue;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell: XLSX.CellObject | undefined = dense ? dense[r][c] : ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const missing = (cell.f !== undefined || cell.F !== undefined) && (cell.v == null || cell.t === 'z');
      if (missing || cell.t === 'e') {
        const address = sheet + '!' + XLSX.utils.encode_cell({ r, c });
        const reason = missing ? 'Công thức chưa có kết quả lưu sẵn' : 'Lỗi Excel ' + (cell.w || '');
        throw new Error('SOURCE_CELL_ERROR: ' + reason.trim() + ' tại ' + address + '. Hãy kiểm tra, tính lại và lưu file.');
      }
    }
  }
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, UTC: true, defval: null, blankrows, range });
}
