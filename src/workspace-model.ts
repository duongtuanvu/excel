import { LIMITS, compileReport, validateTemplate } from './model.ts';
import type { Column, Config, Kind } from './model.ts';
import { WORKSPACE_LIMITS, normalizeAlias } from './source-model.ts';
import type { ManagedSource } from './source-model.ts';
import { validateSchema, modeKind } from './schema-model.ts';
import type { SchemaRule } from './schema-model.ts';
import { validateLayout } from './import-model.ts';
import type { ImportLayout } from './import-model.ts';

export type SavedColumn = Pick<Column,'name'|'kind'>;
export type SavedSource = {id:string;alias:string;sheet:string;columns:SavedColumn[];config:Config;schema?:SchemaRule[];layout?:ImportLayout};
export type SavedWorkspace = {version:1;slots:SavedSource[]};
const kinds:readonly Kind[]=['number','text','date','boolean'];
const record=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('WORKSPACE_INVALID: Cấu hình workspace không hợp lệ.');
  return v as Record<string,unknown>;
};
function text(v:unknown,max:number,field:string):string{
  if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error('WORKSPACE_INVALID: '+field+' không hợp lệ.');
  return v;
}
export function validateSavedSource(input:unknown):SavedSource{
  const s=record(input);
  const id=text(s.id,36,'Mã nguồn');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new Error('WORKSPACE_ID_INVALID: Mã nguồn không hợp lệ.');
  const alias=normalizeAlias(text(s.alias,WORKSPACE_LIMITS.aliasLength,'Tên nguồn'),[]);
  const sheet=text(s.sheet,240,'Tên sheet');
  if(!Array.isArray(s.columns)||!s.columns.length||s.columns.length>LIMITS.columns)throw new Error('WORKSPACE_SCHEMA_INVALID: Số cột không hợp lệ.');
  const names=new Set<string>();
  const columns:SavedColumn[]=s.columns.map(value=>{
    const c=record(value),name=text(c.name,240,'Tên cột');
    if(names.has(name)||!kinds.includes(c.kind as Kind))throw new Error('WORKSPACE_SCHEMA_INVALID: Cột trùng hoặc sai kiểu.');
    names.add(name);
    return {name,kind:c.kind as Kind};
  });
  const config=validateTemplate({version:1,config:s.config}).config;
  // Validate referenced columns, aggregation and numeric filters without executing SQL.
  compileReport(config,columns.map((c,i)=>({...c,id:'c'+i})));
  const schema=validateSchema(s.schema);
  for(const rule of schema){
    const target=columns.find(c=>c.name===rule.name),kind=modeKind(rule.mode);
    if(!target||(kind&&target.kind!==kind))throw new Error('WORKSPACE_SCHEMA_INVALID: Quy tắc cột không khớp schema đã lưu.');
  }
  const layout=validateLayout(s.layout);
  return {id,alias,sheet,columns,config,...(schema.length?{schema}:{}),...(layout?{layout}:{})};
}
export function validateWorkspace(input:unknown):SavedWorkspace|null{
  if(input==null)return null; // Old account payloads are supported.
  const w=record(input);
  if(w.version!==1||!Array.isArray(w.slots)||!w.slots.length||w.slots.length>WORKSPACE_LIMITS.sources)throw new Error('WORKSPACE_INVALID: Workspace phải có 1–12 nguồn và version 1.');
  const ids=new Set<string>(),aliases:string[]=[];
  const slots=w.slots.map(raw=>{
    const slot=validateSavedSource(raw);
    if(ids.has(slot.id))throw new Error('WORKSPACE_ID_DUPLICATE: Mã nguồn đã tồn tại.');
    normalizeAlias(slot.alias,aliases);
    ids.add(slot.id);aliases.push(slot.alias);return slot;
  });
  return {version:1,slots};
}
export function snapshotWorkspace(previous:SavedWorkspace|null, sources:readonly ManagedSource[], configFor:(source:ManagedSource)=>Config|undefined):SavedWorkspace{
  const loaded=sources.filter(s=>!s.demo);
  if(!loaded.length)throw new Error('WORKSPACE_EMPTY: Hãy nhập ít nhất một nguồn thật.');
  const slots=loaded.map(source=>{
    const config=configFor(source);
    if(!config)throw new Error('WORKSPACE_CONFIG_MISSING: Không tìm thấy cấu hình của '+source.alias+'.');
    return {id:source.slotId,alias:source.alias,sheet:source.sheet,columns:source.columns.map(({name,kind})=>({name,kind})),config,...(source.schema?.length?{schema:source.schema}:{}),...(source.layout?{layout:source.layout}:{})};
  });
  const loadedIds=new Set(slots.map(s=>s.id));
  // Never discard a saved source just because its workbook has not been reattached yet.
  const combined=[...(previous?.slots.filter(s=>!loadedIds.has(s.id))??[]),...slots];
  return validateWorkspace({version:1,slots:combined})!;
}
export function withoutSavedSource(workspace:SavedWorkspace,id:string):SavedWorkspace|null{
  const slots=workspace.slots.filter(s=>s.id!==id);
  return slots.length?{version:1,slots}:null;
}
