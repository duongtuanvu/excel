import { LIMITS, compileReport, validateTemplate } from './model.ts';
import type { Column, Config, Kind } from './model.ts';
import { WORKSPACE_LIMITS, normalizeAlias } from './source-model.ts';
import type { ManagedSource } from './source-model.ts';
import { validateSchema, modeKind } from './schema-model.ts';
import type { SchemaRule } from './schema-model.ts';
import { validateLayout } from './import-model.ts';
import type { ImportLayout } from './import-model.ts';
import { bindRecipe, compileModel, MODEL_OPERATIONS, projectColumns } from './data-model.ts';
import type { ModelRecipe, ModelOperation, ModelTable, TransformRecipe } from './data-model.ts';
import {stageSchema,validateRecipe} from './pipeline-model.ts';

export type SavedColumn = Pick<Column,'name'|'kind'>;
export type SavedSource = {id:string;alias:string;sheet:string;columns:SavedColumn[];config:Config;schema?:SchemaRule[];layout?:ImportLayout};
export type SavedModel = (ModelRecipe|TransformRecipe) & {id:string;alias:string;config:Config};
export type SavedWorkspace = {version:1;slots:SavedSource[];models?:SavedModel[];outputId?:string};
const kinds:readonly Kind[]=['number','text','date','boolean'];
const record=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('WORKSPACE_INVALID: Cấu hình workspace không hợp lệ.');
  return v as Record<string,unknown>;
};
function text(v:unknown,max:number,field:string):string{
  if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error('WORKSPACE_INVALID: '+field+' không hợp lệ.');
  return v;
}
function slotId(value:unknown):string{
  const id=text(value,36,'Mã nguồn');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new Error('WORKSPACE_ID_INVALID: Mã nguồn không hợp lệ.');
  return id;
}
function projection(raw:unknown):string[]{
  if(!Array.isArray(raw)||!raw.length||raw.length>LIMITS.columns||new Set(raw).size!==raw.length)
    throw new Error('WORKSPACE_MODEL_INVALID: Danh sách cột đã lưu không hợp lệ.');
  return raw.map(value=>text(value,240,'Tên cột'));
}
export function validateSavedSource(input:unknown):SavedSource{
  const s=record(input);
  const id=slotId(s.id);
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
  const tables=new Map<string,ModelTable>();
  function addTable(id:string,columns:SavedColumn[]){
    tables.set(id,{id:'s'+(tables.size+1),slotId:id,revision:1,demo:false,columns:columns.map((c,i)=>({...c,id:'c'+i}))});
  }
  for(const slot of slots)addTable(slot.id,slot.columns);
  const steps=w.models===undefined?[]:w.models;
  if(!Array.isArray(steps)||slots.length+steps.length>WORKSPACE_LIMITS.sources)throw new Error('WORKSPACE_MODEL_LIMIT: Workspace vượt giới hạn số bảng.');
  const models:SavedModel[]=steps.map(raw=>{
    const m=record(raw),id=slotId(m.id),alias=normalizeAlias(text(m.alias,WORKSPACE_LIMITS.aliasLength,'Tên bảng ghép'),aliases);
    if(tables.has(id))throw new Error('WORKSPACE_ID_DUPLICATE: Mã bảng đã tồn tại.');
    const left=tables.get(slotId(m.leftSlotId));
    if(!left)throw new Error('WORKSPACE_DEPENDENCY: '+alias+' thiếu bảng đầu vào.');
    const config=validateTemplate({version:1,config:m.config}).config;
    const leftColumns=projection(m.leftColumns);
    if(m.operation==='pipeline'){
      const recipe=validateRecipe(m.recipe);
      if(!recipe.steps.some(s=>s.enabled))throw new Error('PIPELINE_EMPTY: Cần bật ít nhất một bước.');
      const columns=stageSchema(recipe,projectColumns(left,leftColumns).columns).at(-1)!;
      compileReport(config,columns);
      addTable(id,columns);aliases.push(alias);
      return {id,alias,config,operation:'pipeline',leftSlotId:left.slotId,leftColumns,recipe};
    }
    const right=tables.get(slotId(m.rightSlotId));
    if(!right)throw new Error('WORKSPACE_DEPENDENCY: '+alias+' thiếu bảng phải.');
    if(!MODEL_OPERATIONS.includes(m.operation as ModelOperation)||!Array.isArray(m.pairs)||m.pairs.length>LIMITS.columns)
      throw new Error('WORKSPACE_MODEL_INVALID: Phép ghép hoặc danh sách cột không hợp lệ.');
    const pairs=m.pairs.map(value=>{
      const p=record(value);
      return {left:text(p.left,240,'Cột trái'),right:text(p.right,240,'Cột phải')};
    });
    const model={id,alias,leftSlotId:left.slotId,rightSlotId:right.slotId,operation:m.operation as ModelOperation,pairs,config,
      leftColumns,rightColumns:projection(m.rightColumns)};
    const bound=bindRecipe(model,alias,left,right);
    const {columns}=compileModel(bound.input,bound.left,bound.right,aliases);
    compileReport(config,columns);
    addTable(id,columns);
    aliases.push(alias);
    return model;
  });
  const outputId=w.outputId===undefined?undefined:slotId(w.outputId);
  if(outputId&&!tables.has(outputId))throw new Error('WORKSPACE_OUTPUT_INVALID: Báo cáo đã chọn không tồn tại.');
  return {version:1,slots,...(models.length?{models}:{}),...(outputId?{outputId}:{})};
}
export function snapshotWorkspace(previous:SavedWorkspace|null, sources:readonly ManagedSource[], configFor:(source:ManagedSource)=>Config|undefined,activeSlotId?:string):SavedWorkspace{
  const loaded=sources.filter(s=>!s.demo&&!s.derived);
  if(!loaded.length)throw new Error('WORKSPACE_EMPTY: Hãy nhập ít nhất một nguồn thật.');
  const slots=loaded.map(source=>{
    const config=configFor(source);
    if(!config)throw new Error('WORKSPACE_CONFIG_MISSING: Không tìm thấy cấu hình của '+source.alias+'.');
    return {id:source.slotId,alias:source.alias,sheet:source.sheet,columns:source.columns.map(({name,kind})=>({name,kind})),config,...(source.schema?.length?{schema:source.schema}:{}),...(source.layout?{layout:source.layout}:{})};
  });
  const loadedIds=new Set(slots.map(s=>s.id));
  // Never discard a saved source just because its workbook has not been reattached yet.
  const combined=[...(previous?.slots.filter(s=>!loadedIds.has(s.id))??[]),...slots];
  const models=new Map(previous?.models?.map(m=>[m.id,m]));
  for(const source of sources){
    if(!source.derived)continue;
    const config=configFor(source);
    if(!config)throw new Error('WORKSPACE_CONFIG_MISSING: Thiếu cấu hình báo cáo '+source.alias+'.');
    const d=source.derived;
    const common={id:source.slotId,alias:source.alias,config,leftSlotId:d.leftSlotId,leftColumns:d.leftColumns};
    models.set(source.slotId,d.operation==='pipeline'?{...common,operation:d.operation,recipe:d.recipe}:
      {...common,rightSlotId:d.rightSlotId,operation:d.operation,pairs:d.pairs,rightColumns:d.rightColumns});
  }
  return validateWorkspace({version:1,slots:combined,models:[...models.values()],outputId:activeSlotId??previous?.outputId})!;
}
export function withoutSavedSource(workspace:SavedWorkspace,id:string):SavedWorkspace|null{
  const dependent=workspace.models?.find(m=>m.leftSlotId===id||(m.operation!=='pipeline'&&m.rightSlotId===id));
  if(dependent)throw new Error('WORKSPACE_DEPENDENCY: Hãy bỏ cấu hình bảng '+dependent.alias+' trước.');
  const slots=workspace.slots.filter(s=>s.id!==id);
  return slots.length?validateWorkspace({...workspace,slots,models:workspace.models?.filter(m=>m.id!==id),outputId:workspace.outputId===id?undefined:workspace.outputId}):null;
}

export function periodPlan(workspace:SavedWorkspace,outputId:string){
  const models=workspace.models??[];
  const output=[...workspace.slots,...models].find(s=>s.id===outputId);
  if(!output)throw new Error('WORKSPACE_OUTPUT_INVALID: Chọn báo cáo muốn chạy.');
  const required=new Set([outputId]);
  for(const model of [...models].reverse()){
    if(required.has(model.id)){required.add(model.leftSlotId);if(model.operation!=='pipeline')required.add(model.rightSlotId);}
  }
  return {output,slots:workspace.slots.filter(s=>required.has(s.id)),models:models.filter(m=>required.has(m.id))};
}
