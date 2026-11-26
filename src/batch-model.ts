import { LIMITS } from './model.ts';
import { WORKSPACE_LIMITS, sourceTable } from './source-model.ts';
import type { BookBudget, TableBudget } from './source-model.ts';

export type BatchFile={sourceId:string;revision:number;name:string;bytes:ArrayBuffer};
export type BatchSelection={sourceId:string;revision:number;file:File};
export type BatchItemPreview={sourceId:string;revision:number;alias:string;fileName:string;previousRows:number;rows:number|null;addedColumns:string[];error:string|null};
export type BatchPreview={items:BatchItemPreview[];ready:boolean;error:string|null};
export const BATCH_LIMITS={files:WORKSPACE_LIMITS.sources,bytes:WORKSPACE_LIMITS.bookBytes,peakBytes:2*WORKSPACE_LIMITS.bookBytes,peakCells:2*WORKSPACE_LIMITS.bookCells,peakTableCells:2*WORKSPACE_LIMITS.tableCells,peakChars:2*WORKSPACE_LIMITS.tableChars} as const;

export function validateBatchFiles(input:unknown):BatchFile[]{
  if(!Array.isArray(input)||input.length<2||input.length>BATCH_LIMITS.files)throw new Error('BATCH_COUNT_INVALID: Chọn từ 2 đến 12 nguồn.');
  const ids=new Set<string>();let bytes=0;
  const files=input.map((raw):BatchFile=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('BATCH_FILE_INVALID: File nguồn không hợp lệ.');
    const r=raw as Record<string,unknown>;
    if(typeof r.sourceId!=='string')throw new Error('BATCH_SOURCE_INVALID: Mã nguồn không hợp lệ.');
    sourceTable(r.sourceId);
    if(ids.has(r.sourceId))throw new Error('BATCH_SOURCE_DUPLICATE: Một nguồn chỉ được thay một lần.');
    ids.add(r.sourceId);
    if(typeof r.revision!=='number'||!Number.isSafeInteger(r.revision)||r.revision<1)throw new Error('BATCH_SOURCE_STALE: Revision không hợp lệ.');
    if(typeof r.name!=='string'||r.name.length>255||! /\.(xlsx|xls|csv|tsv)$/i.test(r.name)||!(r.bytes instanceof ArrayBuffer)||r.bytes.byteLength<1||r.bytes.byteLength>LIMITS.fileBytes)throw new Error('BATCH_FILE_INVALID: File Excel/CSV/TSV hợp lệ tối đa 25 MiB.');
    bytes+=r.bytes.byteLength;
    if(bytes>BATCH_LIMITS.bytes)throw new Error('BATCH_BYTES_LIMIT: Tổng file kỳ mới vượt 50 MiB.');
    return {sourceId:r.sourceId,revision:r.revision,name:r.name,bytes:r.bytes};
  });
  return files;
}
// Separate bounded staging allowance: old and incoming tables/books coexist until commit.
// These are logical caps, not a guarantee of actual browser heap use.
export function checkBatchPeak(books:readonly BookBudget[],tables:readonly TableBudget[]):void{
  if(books.reduce((n,b)=>n+b.bytes,0)>BATCH_LIMITS.peakBytes||books.reduce((n,b)=>n+b.cells,0)>BATCH_LIMITS.peakCells||tables.reduce((n,t)=>n+t.rows*t.columns.length,0)>BATCH_LIMITS.peakTableCells||tables.reduce((n,t)=>n+t.chars,0)>BATCH_LIMITS.peakChars)throw new Error('BATCH_STAGING_LIMIT: Vượt giới hạn bộ nhớ tạm. Hãy chia thành các đợt nhỏ hơn.');
}
export function batchStage(id:string):string{return 'batch_stage_'+sourceTable(id);}

export async function swapBatchTables(ids:readonly string[],query:(sql:string)=>Promise<unknown>):Promise<void>{
  if(ids.length<2||ids.length>BATCH_LIMITS.files||new Set(ids).size!==ids.length)throw new Error('BATCH_COUNT_INVALID: Danh sách bảng không hợp lệ.');
  const pairs=ids.map(id=>({table:sourceTable(id),stage:batchStage(id)}));
  await query('BEGIN TRANSACTION');
  try{
    for(const p of pairs){
      await query('DROP TABLE '+p.table);
      await query('ALTER TABLE '+p.stage+' RENAME TO '+p.table);
    }
    await query('COMMIT');
  }catch{
    try{await query('ROLLBACK');}catch{throw new Error('BATCH_ROLLBACK_FAILED: Không thể xác nhận rollback. Hãy tải lại trang; file gốc không bị thay đổi.');}
    throw new Error('BATCH_TRANSACTION_FAILED: Đã rollback cả đợt; bảng cũ được giữ nguyên.');
  }
}
