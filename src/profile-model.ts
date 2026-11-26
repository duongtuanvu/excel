import { LIMITS } from './model.ts';
import type { Column, Kind } from './model.ts';
import { sourceTable } from './source-model.ts';

export const PROFILE_LIMITS = { batchColumns:8, topValues:10, labelLength:120 } as const;
export type ColumnProfile = {
  id:string; name:string; kind:Kind; missing:number; distinct:number;
  invalid:number|null; min:number|string|null; max:number|string|null;
  sum:number|null; average:number|null;
};
export type SourceProfile = {
  sourceId:string; revision:number; rows:number; cells:number; missing:number;
  duplicateGroups:number; duplicateRows:number; duplicateExtra:number; columns:ColumnProfile[];
};
export type Distribution = {
  sourceId:string; revision:number; columnId:string;
  nonEmpty:number; distinct:number; shown:number;
  values:{label:string;clipped:boolean;count:number}[];
};

function columnId(id:string):string {
  if(!/^c(?:0|[1-9][0-9]{0,2})$/.test(id))throw new Error('PROFILE_COLUMN_INVALID: Mã cột không hợp lệ.');
  return '"'+id+'"';
}
function checkedColumns(columns:readonly Column[]):void {
  if(!columns.length||columns.length>LIMITS.columns||new Set(columns.map(c=>c.id)).size!==columns.length)
    throw new Error('PROFILE_SCHEMA_INVALID: Cấu trúc bảng không hợp lệ.');
  for(const c of columns){
    columnId(c.id);
    if(!['number','text','date','boolean'].includes(c.kind))throw new Error('PROFILE_SCHEMA_INVALID: Kiểu cột không hợp lệ.');
  }
}
// Match report empty/notEmpty semantics: NULL, empty string, or spaces only.
// Non-empty values remain unchanged for exact distinct and frequency counts.
function nonEmpty(id:string):string {
  const q=columnId(id);
  return '(CASE WHEN '+q+' IS NULL OR trim('+q+") = '' THEN NULL ELSE "+q+' END)';
}
export function compileProfile(sourceId:string,columns:readonly Column[]){
  const table=sourceTable(sourceId);
  checkedColumns(columns);
  const batches:{columns:Column[];sql:string}[]=[];
  for(let offset=0;offset<columns.length;offset+=PROFILE_LIMITS.batchColumns){
    const batch=columns.slice(offset,offset+PROFILE_LIMITS.batchColumns);
    const expressions=['CAST(COUNT(*) AS INTEGER) AS n'];
    batch.forEach((c,i)=>{
      const v=nonEmpty(c.id),alias='p'+i+'_';
      expressions.push('CAST(COUNT(*) - COUNT('+v+') AS INTEGER) AS '+alias+'missing','CAST(COUNT(DISTINCT '+v+') AS INTEGER) AS '+alias+'distinct');
      if(c.kind==='number'){
        const cast='TRY_CAST('+v+' AS DOUBLE)';
        const num='(CASE WHEN isfinite('+cast+') THEN '+cast+' ELSE NULL END)';
        expressions.push('CAST(COUNT('+v+') - COUNT('+num+') AS INTEGER) AS '+alias+'invalid',
          'MIN('+num+') AS '+alias+'min','MAX('+num+') AS '+alias+'max',
          'SUM('+num+') AS '+alias+'sum','AVG('+num+') AS '+alias+'average');
      }else if(c.kind==='date'){
        const valid='(CASE WHEN TRY_CAST('+v+' AS TIMESTAMP) IS NOT NULL THEN '+v+' ELSE NULL END)';
        expressions.push('CAST(COUNT('+v+') - COUNT('+valid+') AS INTEGER) AS '+alias+'invalid','MIN('+valid+') AS '+alias+'min','MAX('+valid+') AS '+alias+'max');
      }else if(c.kind==='boolean'){
        expressions.push("CAST(COUNT(*) FILTER (WHERE "+v+" IS NOT NULL AND "+v+" NOT IN ('true','false')) AS INTEGER) AS "+alias+'invalid');
      }
    });
    batches.push({columns:batch,sql:'SELECT '+expressions.join(', ')+' FROM '+table});
  }
  // Exact duplicate groups, based on all stored columns, with SQL NULLs grouped together.
  const grouped=columns.map(c=>columnId(c.id)).join(', ');
  // DuckDB SUM(BIGINT) promotes to HUGEINT, which can cross Arrow/WASM as a decimal object.
  // All three counts are <= LIMITS.rows, so INTEGER is exact and safe for the JS boundary.
  const duplicates='SELECT CAST(COUNT(*) AS INTEGER) AS duplicate_groups, CAST(COALESCE(SUM(n),0) AS INTEGER) AS duplicate_rows, CAST(COALESCE(SUM(n-1),0) AS INTEGER) AS duplicate_extra FROM (SELECT COUNT(*) AS n FROM '+table+' GROUP BY '+grouped+' HAVING COUNT(*)>1) AS d';
  return {batches,duplicates};
}
export function compileDistribution(sourceId:string,columns:readonly Column[],id:string){
  checkedColumns(columns);
  if(!columns.some(c=>c.id===id))throw new Error('PROFILE_COLUMN_NOT_FOUND: Không tìm thấy cột.');
  const table=sourceTable(sourceId),v=nonEmpty(id);
  return 'WITH counts AS (SELECT '+v+' AS v, CAST(COUNT(*) AS INTEGER) AS n FROM '+table+' WHERE '+v+' IS NOT NULL GROUP BY 1) SELECT left(v,'+PROFILE_LIMITS.labelLength+') AS label, length(v)>'+PROFILE_LIMITS.labelLength+' AS clipped, n FROM counts ORDER BY n DESC, v ASC LIMIT '+PROFILE_LIMITS.topValues;
}
export function profileCount(value:unknown,max:number):number{
  if((typeof value!=='number'&&typeof value!=='bigint'&&typeof value!=='string')||value==='')throw new Error('PROFILE_RESULT_INVALID: Thiếu số liệu thống kê.');
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error('PROFILE_RESULT_INVALID: Số liệu thống kê ngoài giới hạn.');
  return n;
}
export function finiteMetric(value:unknown):number|null{
  if(value==null)return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
