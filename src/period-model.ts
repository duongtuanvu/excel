import { LIMITS } from './model.ts';
import { WORKSPACE_LIMITS } from './source-model.ts';
import type { Workspace } from './source-model.ts';
import type { SavedSource } from './workspace-model.ts';

export type PeriodFile = {slotId:string; name:string; bytes:ArrayBuffer};
export type PeriodSelection = {slotId:string; file:File};
export type ExpansionWarning = {id:string; alias:string; rows:number; matchedPairs:number};
export type PeriodResult = {status:'ready'; workspace:Workspace} | {status:'confirm'; warning:ExpansionWarning};

export function validatePeriodFiles(slots:SavedSource[], files:PeriodFile[]):Map<string,PeriodFile>{
  if(!Array.isArray(files)||files.length!==slots.length)throw new Error('PERIOD_FILES: Chọn một file mới cho mỗi nguồn của báo cáo.');
  const required=new Set(slots.map(slot=>slot.id));
  const assigned=new Map<string,PeriodFile>();
  let bytes=0;
  for(const file of files){
    if(!file||!required.has(file.slotId)||assigned.has(file.slotId))throw new Error('PERIOD_FILES: File thiếu hoặc gán trùng nguồn.');
    if(typeof file.name!=='string'||file.name.length>255||! /\.(xlsx|xls|csv|tsv)$/i.test(file.name)||
       !(file.bytes instanceof ArrayBuffer)||!file.bytes.byteLength||file.bytes.byteLength>LIMITS.fileBytes)
      throw new Error('PERIOD_FILE_INVALID: Chọn file Excel, CSV hoặc TSV tối đa 25 MiB.');
    bytes+=file.bytes.byteLength;
    assigned.set(file.slotId,file);
  }
  if(bytes>WORKSPACE_LIMITS.bookBytes)throw new Error('PERIOD_FILE_LIMIT: Tổng dung lượng file vượt 50 MiB.');
  return assigned;
}
