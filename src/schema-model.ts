import {renamePivot} from './pivot-config.ts';
import { LIMITS, compileReport } from './model.ts';
import type { Cell, Column, Config, Kind } from './model.ts';

export const SCHEMA_MODES=['auto','text','number','number-vi','date','date-vi','boolean'] as const;
export type SchemaMode=typeof SCHEMA_MODES[number];
export type SchemaRule={sourceName:string;name:string;mode:SchemaMode};
export type SchemaIssue={sourceName:string;name:string;invalid:number};
export type SchemaPreview={sourceId:string;revision:number;columns:Column[];issues:SchemaIssue[];rows:number;config:Config};
const invalid=()=>new Error('SCHEMA_INVALID: Quy tắc cột không hợp lệ.');
function name(value:unknown):string{
  if(typeof value!=='string'||!value.trim()||value.length>240||/[\u0000-\u001f\u007f]/.test(value))throw invalid();
  return value;
}
export function modeKind(mode:SchemaMode):Kind|undefined{
  return mode==='auto'?undefined:mode==='number-vi'?'number':mode==='date-vi'?'date':mode;
}
export function validateSchema(input:unknown):SchemaRule[]{
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>LIMITS.columns)throw invalid();
  const used=new Set<string>(),targets=new Set<string>();
  return input.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid();
    const r=raw as Record<string,unknown>,sourceName=name(r.sourceName),target=name(r.name).trim();
    if(!SCHEMA_MODES.includes(r.mode as SchemaMode)||used.has(sourceName)||targets.has(target))throw invalid();
    used.add(sourceName);targets.add(target);
    return {sourceName,name:target,mode:r.mode as SchemaMode};
  });
}
export function resolveSchema(original:readonly Column[],input:unknown):{columns:Column[];rules:SchemaRule[]}{
  const rules=validateSchema(input),byName=new Map(rules.map(r=>[r.sourceName,r]));
  for(const r of rules)if(!original.some(c=>c.name===r.sourceName))throw new Error('SOURCE_SCHEMA_MISMATCH: Không tìm thấy cột gốc '+r.sourceName+'.');
  const columns=original.map(c=>{
    const r=byName.get(c.name);return r?{...c,name:r.name,kind:modeKind(r.mode)??c.kind}:{...c};
  });
  if(new Set(columns.map(c=>c.name)).size!==columns.length)throw new Error('SCHEMA_NAME_DUPLICATE: Tên cột sau chỉnh sửa bị trùng.');
  return {columns,rules};
}
const plain=/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const vietnamese=/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/;
function dateValue(year:number,month:number,day:number):string|undefined{
  if(year<1||year>9999||month<1||month>12||day<1||day>31)return;
  const d=new Date(0);d.setUTCFullYear(year,month-1,day);d.setUTCHours(0,0,0,0);
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return;
  return d.toISOString();
}
// Undefined means conversion failure, null means a missing cell. No silent coercion of bad values.
export function convertSchemaCell(value:unknown,mode:Exclude<SchemaMode,'auto'>):Cell|undefined{
  if(value==null||value==='')return null;
  if(mode==='text'){
    const s=value instanceof Date?(Number.isFinite(value.getTime())?value.toISOString():null):String(value);
    return s!==null&&s.length<=LIMITS.textLength&&!s.includes('\0')?s:undefined;
  }
  if(typeof value==='string'&&!value.trim())return null;
  if(mode==='number'||mode==='number-vi'){
    let n:number;
    if(typeof value==='number')n=value;
    else if(typeof value==='string'){
      const s=value.trim();
      if(!(mode==='number'?plain:vietnamese).test(s))return undefined;
      n=Number(mode==='number'?s:s.replaceAll('.','').replace(',','.'));
    }else return undefined;
    return Number.isFinite(n)&&(!Number.isInteger(n)||Number.isSafeInteger(n))?n:undefined;
  }
  if(mode==='boolean'){
    if(typeof value==='boolean')return value;
    if(typeof value!=='string'&&typeof value!=='number')return undefined;
    const s=String(value).trim().toLowerCase();
    return s==='true'||s==='1'?true:s==='false'||s==='0'?false:undefined;
  }
  if(value instanceof Date)return Number.isFinite(value.getTime())?value.toISOString():undefined;
  if(typeof value!=='string')return undefined;
  const s=value.trim();
  const m=mode==='date'?/^(\d{4})-(\d{2})-(\d{2})$/.exec(s):/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m?mode==='date'?dateValue(+m[1],+m[2],+m[3]):dateValue(+m[3],+m[2],+m[1]):undefined;
}
export function remapSchemaConfig(config:Config,before:readonly Column[],after:Column[]):Config{
  const byId=new Map(after.map(c=>[c.id,c])),byName=new Map(before.map(c=>[c.name,c]));
  const lookup=(name:string)=>{
    const old=byName.get(name),next=old&&byId.get(old.id);
    if(!next)throw new Error('SCHEMA_REPORT_CONFLICT: Không tìm thấy cột báo cáo '+name+'.');
    return next;
  };
  const metric=config.metric?lookup(config.metric):undefined;
  if(metric&&config.aggregate!=='count'&&config.aggregate!=='distinct'&&metric.kind!=='number')throw new Error('SCHEMA_REPORT_CONFLICT: Đổi phép tổng hợp hoặc cột giá trị trước khi đổi kiểu cột số.');
  const filters=config.filters.map(f=>{
    const next=lookup(f.column);
    if(['gt','gte','lt','lte'].includes(f.operator)&&byName.get(f.column)?.kind==='number'&&next.kind!=='number')throw new Error('SCHEMA_REPORT_CONFLICT: Hãy sửa bộ lọc số trên cột '+f.column+' trước.');
    return {...f,column:next.name};
  });
  const result={...config,metric:metric?.name??'',groups:config.groups.map(g=>lookup(g).name),filters,...(config.pivot?{pivot:renamePivot(config.pivot,n=>lookup(n).name)}:{})};
  try{compileReport(result,after);}catch{throw new Error('SCHEMA_REPORT_CONFLICT: Cấu hình báo cáo không hợp lệ sau chỉnh sửa.');}
  return result;
}
