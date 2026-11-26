import * as XLSX from 'xlsx';
import * as duckdb from '@duckdb/duckdb-wasm';
import { mvpWasm, ehWasm, mvpWorker, ehWorker } from 'duckdb-assets';
import { LIMITS, normalizeHeaders, compileReport, safeCsvCell } from './model';
import type { Cell, Column, Kind, Source, Config, Report, Group } from './model';
import type { Request, Response } from './protocol';
import { WORKSPACE_LIMITS, sourceTable, uniqueAlias, normalizeAlias, replacementIssues, replacementSheet, checkWorkspaceBudget } from './source-model';
import type { ManagedSource, Workspace, BookBudget } from './source-model';
import { validateSavedSource } from './workspace-model';
import type { SavedSource } from './workspace-model';
import type { SourceProfile } from './profile-model';
import { profileSource, profileDistribution } from './profile-engine';
import { convertSchemaCell, resolveSchema, remapSchemaConfig } from './schema-model';
import type { SchemaRule, SchemaPreview, SchemaIssue } from './schema-model';
import { resolveLayout,validateLayout,layoutConfig,suggestMapping,mappedRules } from './import-model';
import type { SheetBounds,ImportLayout,ColumnMapping,LayoutPreview } from './import-model';

const scope = self as unknown as DedicatedWorkerGlobalScope;
type Book = {id:string; name:string; data:XLSX.WorkBook; budget:BookBudget; demo:boolean};
type Entry = {source:ManagedSource;chars:number;profile?:SourceProfile};
const books = new Map<string,Book>();
const sources = new Map<string,Entry>();
let activeId:string|null=null;
let nextSource=0, nextBook=0;
const workspace=():Workspace=>({active:activeId?sources.get(activeId)?.source??null:null,sources:Array.from(sources.values(),e=>e.source)});
function entry(id:string,revision?:number):Entry{
  const found=sources.get(id);
  if(!found)throw new Error('SOURCE_NOT_FOUND: Nguồn dữ liệu không tồn tại.');
  if(revision!==undefined&&revision!==found.source.revision)throw new Error('SOURCE_STALE: Nguồn dữ liệu đã thay đổi. Hãy chạy lại báo cáo.');
  return found;
}
function active():Entry{
  if(!activeId)throw new Error('SOURCE_NOT_FOUND: Chưa có nguồn dữ liệu.');
  return entry(activeId);
}
function bookFor(source:ManagedSource):Book{
  const book=books.get(source.bookId);
  if(!book)throw new Error('WORKBOOK_NOT_FOUND: Không tìm thấy workbook.');
  return book;
}
function releaseBooks(){
  const referenced=new Set(Array.from(sources.values(),e=>e.source.bookId));
  for(const id of books.keys())if(!referenced.has(id))books.delete(id);
}
function makeBook(data:XLSX.WorkBook,name:string,bytes:number,demo=false):Book{
  if(!data.SheetNames.length||data.SheetNames.length>WORKSPACE_LIMITS.sheetsPerBook)throw new Error('WORKBOOK_LIMIT: Workbook phải có 1–32 sheet.');
  let cells=0;
  for(const sheet of data.SheetNames){
    const ws=data.Sheets[sheet], ref=ws?.['!fullref']||ws?.['!ref'];
    if(!ref)continue;
    const r=XLSX.utils.decode_range(ref), n=(r.e.r-r.s.r+1)*(r.e.c-r.s.c+1);
    if(!Number.isSafeInteger(n)||n<0)throw new Error('WORKBOOK_RANGE_INVALID: Vùng dữ liệu không hợp lệ.');
    cells+=n;
    if(cells>WORKSPACE_LIMITS.bookCells)throw new Error('WORKBOOK_CELLS_LIMIT: Workbook vượt 2 triệu ô.');
  }
  return {id:'b'+(++nextBook),name,data,budget:{bytes,cells,sheets:data.SheetNames.length},demo};
}
function readBook(name:string,bytes:ArrayBuffer):Book{
  if(!bytes.byteLength||bytes.byteLength>LIMITS.fileBytes)throw new Error('FILE_SIZE_INVALID: File phải không rỗng và tối đa 25 MiB.');
  if(!/\.(xlsx|xls|csv|tsv)$/i.test(name))throw new Error('FILE_FORMAT_INVALID: Định dạng file không được hỗ trợ.');
  const data=XLSX.read(bytes,{type:'array',cellDates:true,raw:true,dense:true,sheetRows:LIMITS.rows+2});
  return makeBook(data,name,bytes.byteLength);
}
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

function prepare(book: XLSX.WorkBook, sheet: string, name: string, rules:SchemaRule[]=[], buildCsv=true, layoutInput?:ImportLayout|null) {
  if (!book.SheetNames.includes(sheet)) throw new Error('Không tìm thấy sheet.');
  const ws = book.Sheets[sheet];
  if (!ws || !ws['!ref']) throw new Error('Sheet không có dữ liệu.');
  const toBounds=(ref:string):SheetBounds=>{const r=XLSX.utils.decode_range(ref);return {firstRow:r.s.r+1,lastRow:r.e.r+1,firstColumn:r.s.c+1,lastColumn:r.e.c+1};};
  const bounds=toBounds(ws['!fullref']||ws['!ref']),layout=validateLayout(layoutInput);
  const selected=resolveLayout(bounds,toBounds(ws['!ref']),layout);
  const range={s:{r:selected.firstRow-1,c:selected.firstColumn-1},e:{r:selected.lastRow-1,c:selected.lastColumn-1}};
  const width=selected.lastColumn-selected.firstColumn+1;
  if(layout && (ws['!merges']??[]).some(m=>m.s.r<=range.s.r&&m.e.r>=range.s.r&&m.s.c<=range.e.c&&m.e.c>=range.s.c))
    throw new Error('LAYOUT_MERGED_HEADER: Hàng tiêu đề có ô gộp. Hãy chọn hàng tiêu đề không gộp.');
  const matrix=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,raw:true,defval:null,blankrows:!!layout,range});
  if(layout && (!matrix[0]||matrix[0].every(v=>v==null||String(v).trim()==='')))throw new Error('LAYOUT_EMPTY_HEADER: Hàng tiêu đề không có giá trị.');
  if (!matrix.length) throw new Error('Không có hàng tiêu đề.');
  const headers = normalizeHeaders(Array.from({ length: width }, (_, i) => matrix[0][i]));
  const data = matrix.slice(1);
  const originalColumns:Column[]=headers.map((name,i)=>({id:'c'+i,name,kind:kindFor(data.map(row=>row[i]))}));
  const resolved=resolveSchema(originalColumns,rules);
  const columns=resolved.columns, schema=resolved.rules.filter(r=>r.mode!=='auto'||r.name!==r.sourceName);
  const byName=new Map(schema.map(r=>[r.sourceName,r]));
  const modes=originalColumns.map(c=>byName.get(c.name)?.mode??'auto');
  const invalid=new Uint32Array(columns.length);
  const csv:string[]=[columns.map(c=>c.id).join(',')];
  let count=0,chars=csv[0].length;
  for(const row of data){
    // Keep the original row eligibility; conversion must not silently remove a row.
    const original=originalColumns.map((c,i)=>asCell(row[i],c.kind));
    if(original.every(v=>v===null))continue;
    const cells=columns.map((c,i)=>{
      const mode=modes[i];
      if(mode==='auto')return original[i];
      const value=convertSchemaCell(row[i],mode);
      if(value===undefined){invalid[i]++;return null;}
      return value;
    });
    const line=cells.map(quoted).join(',');
    chars+=line.length+1;
    if(chars>40_000_000)throw new Error('SOURCE_MEMORY_LIMIT: Dữ liệu sau giải nén quá lớn. Hãy chia nhỏ sheet.');
    if(buildCsv)csv.push(line);
    count++;
  }
  const issues:SchemaIssue[]=originalColumns.flatMap((c,i)=>invalid[i]?[{sourceName:c.name,name:columns[i].name,invalid:invalid[i]}]:[]);
  return {csv:buildCsv?csv.join('\n'):'',next:{name,sheets:[...book.SheetNames],sheet,rows:count,columns} satisfies Source,originalColumns,schema,issues,chars,bounds,layout};
}

async function store(book:Book,sheet:string,previous?:Entry,dropDemo?:Entry,restore?:SavedSource,edit?:ReturnType<typeof prepare>):Promise<Workspace>{
  const prepared=edit??prepare(book.data,sheet,book.name,previous?.source.schema??restore?.schema??[],true,previous?.source.layout??restore?.layout);
  const {csv,next,originalColumns,schema,issues,bounds,layout}=prepared;
  if(issues.length)throw new Error('SCHEMA_CONVERSION_FAILED: '+issues.map(i=>i.name+' ('+i.invalid+' lỗi)').join(', ')+'. Nguồn cũ được giữ nguyên.');
  if(!edit&&(previous||restore)){
    const issues=replacementIssues(previous?.source.columns??restore!.columns,next.columns);
    if(issues.length)throw new Error('SOURCE_SCHEMA_MISMATCH: '+issues.join(', ')+'. Nguồn cũ được giữ nguyên.');
  }
  const excluded=new Set([previous?.source.id,dropDemo?.source.id]);
  const remaining=Array.from(sources.values()).filter(e=>!excluded.has(e.source.id));
  const referenced=new Set(remaining.map(e=>e.source.bookId));
  referenced.add(book.id);
  const allBooks=Array.from(books.values()).filter(b=>referenced.has(b.id)&&b.id!==book.id).concat(book);
  checkWorkspaceBudget(allBooks.map(b=>b.budget),[...remaining.map(e=>({rows:e.source.rows,columns:e.source.columns,chars:e.chars})),{rows:next.rows,columns:next.columns,chars:csv.length}]);
  const id=previous?.source.id??'s'+(++nextSource);
  const used=remaining.map(e=>e.source.alias);
  const alias=previous?.source.alias??(restore?normalizeAlias(restore.alias,used):uniqueAlias(book.demo?'Dữ liệu mẫu':book.name+' · '+sheet,used));
  const slotId=previous?.source.slotId??restore?.id??crypto.randomUUID();
  if(remaining.some(e=>e.source.slotId===slotId))throw new Error('WORKSPACE_SLOT_LOADED: Nguồn này đã được mở.');
  if(restore)compileReport(restore.config,next.columns,sourceTable(id));
  const managed:ManagedSource={...next,id,slotId,alias,bookId:book.id,revision:(previous?.source.revision??0)+1,demo:book.demo,originalColumns,bounds,...(schema.length?{schema}:{}),...(layout?{layout}:{})};
  const table=sourceTable(id), {db,conn}=await connect(), path='report_import.csv';
  await conn.query('DROP TABLE IF EXISTS report_stage');
  try {
    if(next.rows){
      await db.registerFileText(path,csv);
      await conn.query("CREATE TABLE report_stage AS SELECT * FROM read_csv('report_import.csv', header=true, all_varchar=true, delim=',', quote='\u0022', escape='\u0022', nullstr='', sample_size=-1)");
      const count=await conn.query('SELECT COUNT(*) AS n FROM report_stage');
      if(Number(count.get(0)?.n)!==next.rows)throw new Error('SOURCE_ROW_MISMATCH: Số dòng nhập không khớp.');
      const schema=await conn.query('SELECT * FROM report_stage LIMIT 0');
      if(schema.schema.fields.length!==next.columns.length||schema.schema.fields.some((f,k)=>f.name!==next.columns[k].id))throw new Error('SOURCE_COLUMN_MISMATCH: Cấu trúc cột nhập không khớp.');
    }else await conn.query('CREATE TABLE report_stage ('+next.columns.map(c=>'"'+c.id+'" VARCHAR').join(', ')+')');
    await conn.query('BEGIN TRANSACTION');
    try {
      if(previous)await conn.query('DROP TABLE '+table);
      if(dropDemo)await conn.query('DROP TABLE '+sourceTable(dropDemo.source.id));
      await conn.query('ALTER TABLE report_stage RENAME TO '+table);
      await conn.query('COMMIT');
    }catch(error){await conn.query('ROLLBACK');throw error;}
    if(dropDemo)sources.delete(dropDemo.source.id);
    books.set(book.id,book);
    sources.set(id,{source:managed,chars:csv.length});
    activeId=id;releaseBooks();
    return workspace();
  }finally{
    if(next.rows)await db.dropFile(path).catch(()=>{});
    await conn.query('DROP TABLE IF EXISTS report_stage').catch(()=>{});
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
async function makeReport(config: Config, page: number, source:ManagedSource): Promise<Report> {
  if (!connection) throw new Error('ENGINE_NOT_READY: Chưa có nguồn dữ liệu.');
  const query = compileReport(config, source.columns, sourceTable(source.id));
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

async function exportReport(config: Config, format: 'xlsx' | 'csv', source:ManagedSource) {
  if (!connection) throw new Error('ENGINE_NOT_READY: Chưa có nguồn dữ liệu.');
  const report = await makeReport(config, 0, source);
  if (report.truncated) throw new Error('Báo cáo có quá 5.000 nhóm. Hãy thêm bộ lọc trước khi xuất.');
  const label = config.aggregate === 'count' ? 'Số dòng' : config.aggregate.toUpperCase() + ' ' + config.metric;
  const head = [...config.groups, label, 'Số bản ghi'];
  const summary: Cell[][] = [head, ...report.groups.map(g => [...g.labels, g.value, g.count])];
  const name = 'kysheet-' + new Date().toISOString().slice(0,10);
  if (format === 'csv') {
    const buffer = new TextEncoder().encode('\uFEFF' + summary.map(row => row.map(safeCsvCell).join(',')).join('\r\n'));
    return { bytes: buffer.buffer as ArrayBuffer, name: name + '.csv', mime: 'text/csv;charset=utf-8' };
  }
  const raw = await connection.query(compileReport(config, source.columns, sourceTable(source.id)).raw);
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

async function getProfile(item:Entry):Promise<SourceProfile>{
  if(item.profile?.revision===item.source.revision)return item.profile;
  const {conn}=await connect();
  // Adapt Arrow rows at the boundary; only aggregate results cross the report worker.
  try{
    const result=await profileSource(item.source,async sql=>await conn.query(sql));
    item.profile=result;
    return result;
  }catch(error){
    if(error instanceof Error && /^PROFILE_[A-Z_]+:/.test(error.message))throw error;
    throw new Error('PROFILE_QUERY_FAILED: Không thể hoàn tất thống kê. Hãy thử chia nhỏ nguồn dữ liệu.');
  }
}
function schemaCandidate(item:Entry,rules:SchemaRule[],config:Config,buildCsv:boolean){
  const source=item.source,book=bookFor(source);
  const prepared=prepare(book.data,source.sheet,book.name,rules,buildCsv,source.layout);
  const mapped=remapSchemaConfig(config,source.columns,prepared.next.columns);
  if(prepared.next.rows!==source.rows)throw new Error('SCHEMA_ROW_MISMATCH: Số dòng thay đổi ngoài dự kiến.');
  return {book,prepared,mapped};
}
function layoutCandidate(item:Entry,layout:ImportLayout|null,config:Config,buildCsv:boolean){
 const book=bookFor(item.source),source=item.source;
 const base=prepare(book.data,source.sheet,book.name,[],false,layout);
 const rules=(source.schema??[]).filter(r=>base.originalColumns.some(c=>c.name===r.sourceName));
 const prepared=rules.length||buildCsv?prepare(book.data,source.sheet,book.name,rules,buildCsv,layout):base;
 const mapped=layoutConfig(config,source.columns,prepared.next.columns);
 return {book,prepared,mapped};
}
function mappedCandidate(item:Entry,name:string,bytes:ArrayBuffer,mapping:ColumnMapping[],buildCsv:boolean){
 const book=readBook(name,bytes),source=item.source,sheet=replacementSheet(source.sheet,book.data.SheetNames);
 const base=prepare(book.data,sheet,book.name,[],false,source.layout);
 const rules=mappedRules(source.columns,source.schema??[],base.originalColumns,mapping);
 const prepared=prepare(book.data,sheet,book.name,rules,buildCsv,source.layout);
 return {book,sheet,prepared,mismatches:replacementIssues(source.columns,prepared.next.columns)};
}
async function handle(req: Request):Promise<unknown>{
  switch(req.type){
    case 'demo':{
      const existing=Array.from(sources.values()).find(e=>e.source.demo);
      if(existing){activeId=existing.source.id;return workspace();}
      const book=makeBook(demoBook(),'Dữ liệu mẫu.xlsx',0,true);
      return store(book,book.data.SheetNames[0]);
    }
    case 'import':{
      const book=readBook(req.input.name,req.input.bytes);
      const only=sources.size===1?Array.from(sources.values())[0]:undefined;
      return store(book,book.data.SheetNames[0],undefined,only?.source.demo?only:undefined);
    }
    case 'sheet':{
      const current=active().source,book=bookFor(current);
      const existing=Array.from(sources.values()).find(e=>e.source.bookId===book.id&&e.source.sheet===req.input.sheet);
      if(existing){activeId=existing.source.id;return workspace();}
      return store(book,req.input.sheet);
    }
    case 'activateSource':{
      activeId=entry(req.input.sourceId).source.id;return workspace();
    }
    case 'renameSource':{
      const item=entry(req.input.sourceId);
      const alias=normalizeAlias(req.input.alias,Array.from(sources.values()).filter(e=>e!==item).map(e=>e.source.alias));
      sources.set(item.source.id,{...item,source:{...item.source,alias}});
      return workspace();
    }
    case 'removeSource':{
      const item=entry(req.input.sourceId),{conn}=await connect();
      await conn.query('DROP TABLE '+sourceTable(item.source.id));
      sources.delete(item.source.id);
      if(activeId===item.source.id)activeId=sources.keys().next().value??null;
      releaseBooks();return workspace();
    }
    case 'restoreSource':{
      const slot=validateSavedSource(req.input.slot);
      if(Array.from(sources.values()).some(e=>e.source.slotId===slot.id))throw new Error('WORKSPACE_SLOT_LOADED: Nguồn này đã được mở.');
      const book=readBook(req.input.name,req.input.bytes);
      const only=sources.size===1?Array.from(sources.values())[0]:undefined;
      return store(book,replacementSheet(slot.sheet,book.data.SheetNames),undefined,only?.source.demo?only:undefined,slot);
    }
    case 'replaceSource':{
      const item=entry(req.input.sourceId,req.input.revision);
      const book=readBook(req.input.name,req.input.bytes);
      return store(book,replacementSheet(item.source.sheet,book.data.SheetNames),item);
    }
    case 'previewLayout':{
      const item=entry(req.input.sourceId,req.input.revision);
      if(activeId!==item.source.id)throw new Error('SOURCE_STALE: Hãy chọn lại nguồn.');
      const {prepared,mapped}=layoutCandidate(item,req.input.layout,req.input.config,false);
      return {sourceId:item.source.id,revision:item.source.revision,bounds:prepared.bounds,columns:prepared.next.columns,rows:prepared.next.rows,issues:prepared.issues,conflicts:mapped.conflicts,config:mapped.config} satisfies LayoutPreview;
    }
    case 'applyLayout':{
      const item=entry(req.input.sourceId,req.input.revision);
      if(activeId!==item.source.id)throw new Error('SOURCE_STALE: Hãy chọn lại nguồn.');
      const {book,prepared,mapped}=layoutCandidate(item,req.input.layout,req.input.config,true);
      if(mapped.conflicts.length&&req.input.resetReport!==true)throw new Error('LAYOUT_REPORT_CONFLICT: Cần xác nhận đặt lại báo cáo.');
      const ws=await store(book,item.source.sheet,item,undefined,undefined,prepared);
      return {workspace:ws,config:mapped.config};
    }
    case 'inspectReplacement':{
      const item=entry(req.input.sourceId,req.input.revision),book=readBook(req.input.name,req.input.bytes);
      const sheet=replacementSheet(item.source.sheet,book.data.SheetNames);
      const prepared=prepare(book.data,sheet,book.name,[],false,item.source.layout);
      return {sourceId:item.source.id,revision:item.source.revision,sheet,incoming:prepared.originalColumns,mapping:suggestMapping(item.source.columns,item.source.schema??[],prepared.originalColumns)};
    }
    case 'previewMapped':{
      const item=entry(req.input.sourceId,req.input.revision),{prepared,mismatches}=mappedCandidate(item,req.input.name,req.input.bytes,req.input.mapping,false);
      return {sourceId:item.source.id,revision:item.source.revision,rows:prepared.next.rows,columns:prepared.next.columns,issues:prepared.issues,mismatches};
    }
    case 'applyMapped':{
      const item=entry(req.input.sourceId,req.input.revision);
      if(activeId!==item.source.id)throw new Error('SOURCE_STALE: Hãy chọn lại nguồn.');
      const {book,sheet,prepared,mismatches}=mappedCandidate(item,req.input.name,req.input.bytes,req.input.mapping,true);
      if(mismatches.length)throw new Error('SOURCE_SCHEMA_MISMATCH: '+mismatches.join(', '));
      return store(book,sheet,item,undefined,undefined,prepared);
    }
    case 'previewSchema':{
      const item=entry(req.input.sourceId,req.input.revision);
      if(activeId!==item.source.id)throw new Error('SOURCE_STALE: Hãy chọn lại nguồn.');
      const {prepared,mapped}=schemaCandidate(item,req.input.rules,req.input.config,false);
      return {sourceId:item.source.id,revision:item.source.revision,columns:prepared.next.columns,issues:prepared.issues,rows:prepared.next.rows,config:mapped} satisfies SchemaPreview;
    }
    case 'applySchema':{
      const item=entry(req.input.sourceId,req.input.revision);
      if(activeId!==item.source.id)throw new Error('SOURCE_STALE: Hãy chọn lại nguồn.');
      const {book,prepared,mapped}=schemaCandidate(item,req.input.rules,req.input.config,true);
      const ws=await store(book,item.source.sheet,item,undefined,undefined,prepared);
      return {workspace:ws,config:mapped};
    }
    case 'profile':return getProfile(entry(req.input.sourceId,req.input.revision));
    case 'distribution':{
      const item=entry(req.input.sourceId,req.input.revision),profile=await getProfile(item);
      const {conn}=await connect();
      try{return await profileDistribution(item.source,profile,req.input.columnId,async sql=>await conn.query(sql));}
      catch(error){
        if(error instanceof Error && /^PROFILE_[A-Z_]+:/.test(error.message))throw error;
        throw new Error('PROFILE_DISTRIBUTION_FAILED: Không thể tính phân bố của cột này.');
      }
    }
    case 'report':return makeReport(req.input.config,req.input.page,entry(req.input.sourceId,req.input.revision).source);
    case 'export':return exportReport(req.input.config,req.input.format,entry(req.input.sourceId,req.input.revision).source);
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
