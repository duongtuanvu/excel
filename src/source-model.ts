import type { Column, Source } from './model.ts';
import type { SchemaRule } from './schema-model.ts';
import type { ImportLayout, SheetBounds } from './import-model.ts';
import type { ModelOrigin } from './data-model.ts';

export const WORKSPACE_LIMITS = {sources:12, sheetsPerBook:32, bookBytes:50*1024*1024, bookCells:2_000_000, tableCells:2_000_000, tableChars:50_000_000, aliasLength:100} as const;
export type ManagedSource = Source & {id:string; slotId:string; alias:string; bookId:string; revision:number; demo:boolean; originalColumns?:Column[]; schema?:SchemaRule[]; layout?:ImportLayout; bounds?:SheetBounds; derived?:ModelOrigin; stale?:boolean};
export type Workspace = {active:ManagedSource|null; sources:ManagedSource[]};
export type BookBudget = {bytes:number;cells:number;sheets:number};
export type TableBudget = {rows:number;columns:Column[];chars:number};

export function sourceTable(id:string):string {
  if(!/^s[1-9][0-9]{0,14}$/.test(id))throw new Error('SOURCE_ID_INVALID: Mã nguồn không hợp lệ.');
  return 'source_'+id;
}
export function normalizeAlias(input:string, used:readonly string[]):string {
  const alias=input.trim();
  if(!alias || alias.length>WORKSPACE_LIMITS.aliasLength || /[\u0000-\u001f\u007f]/.test(alias))throw new Error('SOURCE_ALIAS_INVALID: Tên nguồn phải có 1–100 ký tự hợp lệ.');
  if(used.some(v=>v.toLowerCase()===alias.toLowerCase()))throw new Error('SOURCE_ALIAS_DUPLICATE: Tên nguồn đã tồn tại.');
  return alias;
}
export function uniqueAlias(input:string,used:readonly string[]):string {
  const base=input.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,WORKSPACE_LIMITS.aliasLength)||'Nguồn dữ liệu';
  const names=new Set(used.map(v=>v.toLowerCase()));
  let result=base;
  for(let n=2;names.has(result.toLowerCase());n++){
    const suffix=' ('+n+')';
    result=base.slice(0,WORKSPACE_LIMITS.aliasLength-suffix.length)+suffix;
  }
  return result;
}
export function replacementIssues(before:readonly Pick<Column,'name'|'kind'>[],after:readonly Pick<Column,'name'|'kind'>[]):string[]{
  const next=new Map(after.map(c=>[c.name,c.kind]));
  return before.flatMap(c=>!next.has(c.name)?[c.name+' (thiếu)']:next.get(c.name)!==c.kind?[c.name+' ('+c.kind+' → '+next.get(c.name)+')']:[]);
}
export function replacementSheet(previous:string,names:readonly string[]):string{
  if(names.includes(previous))return previous;
  if(names.length===1)return names[0];
  throw new Error('SOURCE_SHEET_MISMATCH: File thay thế phải có sheet '+previous+' hoặc chỉ có một sheet.');
}
export function checkWorkspaceBudget(books:readonly BookBudget[],tables:readonly TableBudget[]):void{
  if(tables.length>WORKSPACE_LIMITS.sources)throw new Error('SOURCE_LIMIT: Tối đa 12 nguồn đang mở.');
  const valid=(n:number)=>Number.isSafeInteger(n)&&n>=0;
  if(books.some(b=>!valid(b.bytes)||!valid(b.cells)||!valid(b.sheets)||b.sheets===0||b.sheets>WORKSPACE_LIMITS.sheetsPerBook))throw new Error('WORKBOOK_LIMIT: Workbook không hợp lệ hoặc quá 32 sheet.');
  if(books.reduce((s,b)=>s+b.bytes,0)>WORKSPACE_LIMITS.bookBytes)throw new Error('WORKBOOK_BYTES_LIMIT: Tổng dung lượng file vượt 50 MiB.');
  if(books.reduce((s,b)=>s+b.cells,0)>WORKSPACE_LIMITS.bookCells)throw new Error('WORKBOOK_CELLS_LIMIT: Tổng vùng dữ liệu workbook vượt 2 triệu ô.');
  if(tables.some(t=>!valid(t.rows)||!valid(t.chars))||tables.reduce((s,t)=>s+t.rows*t.columns.length,0)>WORKSPACE_LIMITS.tableCells||tables.reduce((s,t)=>s+t.chars,0)>WORKSPACE_LIMITS.tableChars)throw new Error('SOURCE_MEMORY_LIMIT: Tổng dữ liệu bảng vượt giới hạn bộ nhớ workspace.');
}
