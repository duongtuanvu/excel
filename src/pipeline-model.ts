import { LIMITS, sqlText } from './model.ts';
import type { Column, Kind } from './model.ts';
export const PIPELINE_LIMITS={steps:16,recipes:12,value:1000,sampleRows:5,sampleColumns:8,sampleLength:120} as const;
export const STEP_TYPES=['trim','replace','rename','drop','filter','fill','cast','distinct'] as const;
export type StepType=typeof STEP_TYPES[number];
export const STEP_LABELS:Record<StepType,string>={trim:'Xóa khoảng trắng đầu/cuối',replace:'Thay văn bản',rename:'Đổi tên cột',drop:'Bỏ cột',filter:'Lọc dòng',fill:'Điền ô trống',cast:'Đổi kiểu cột',distinct:'Bỏ dòng trùng'};
export const FILTER_TYPES=['eq','neq','contains','empty','notEmpty','gt','gte','lt','lte'] as const;
export type FilterType=typeof FILTER_TYPES[number];
export type PipelineStep={type:StepType;enabled:boolean;column:string;value:string;replacement:string;operator:FilterType;target:Kind};
export type PipelineRecipe={version:1;name:string;steps:PipelineStep[]};
export type PipelineInput={sourceId:string;revision:number;alias:string;recipe:PipelineRecipe};
export type PipelineStage={index:number;label:string;enabled:boolean;before:number;rows:number;columns:Column[];sample:string[][]};
export type PipelinePreview={rows:number;columns:Column[];stages:PipelineStage[]};
const kinds:Kind[]=['text','number','date','boolean'];
const fail=(code:string,message:string)=>new Error(code+': '+message);
const record=(v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail('PIPELINE_INVALID','Cấu hình không hợp lệ.');return v as Record<string,unknown>;};
function str(v:unknown,max:number,required=false){if(typeof v!=='string'||v.length>max||v.includes('\0')||(required&&!v.trim()))throw fail('PIPELINE_INVALID','Giá trị cấu hình không hợp lệ.');return v;}
export function newStep(type:StepType='trim',column=''):PipelineStep{return {type,enabled:true,column,value:'',replacement:'',operator:'eq',target:'text'};}
export function validateRecipe(value:unknown):PipelineRecipe{
 const r=record(value),name=str(r.name,100,true).trim();
 if(/[\u0000-\u001f\u007f]/.test(name)||r.version!==1||!Array.isArray(r.steps)||r.steps.length<1||r.steps.length>PIPELINE_LIMITS.steps)throw fail('PIPELINE_INVALID','Cần công thức version 1 có 1–16 bước.');
 const steps=r.steps.map(raw=>{
   const s=record(raw);
   if(!STEP_TYPES.includes(s.type as StepType)||typeof s.enabled!=='boolean'||!FILTER_TYPES.includes(s.operator as FilterType)||!kinds.includes(s.target as Kind))throw fail('PIPELINE_INVALID','Loại bước hoặc cấu hình không hợp lệ.');
   const type=s.type as StepType;
   const column=str(s.column,240,type!=='distinct'&&s.enabled);
   const value=str(s.value,PIPELINE_LIMITS.value),replacement=str(s.replacement,PIPELINE_LIMITS.value);
   // Persist only the allow-listed fields, never arbitrary SQL or source records.
   if(s.enabled&&type==='replace'&&!value.length)throw fail('PIPELINE_INVALID','Văn bản cần thay không được rỗng.');
   if(s.enabled&&type==='rename'&&(!value.trim()||value.trim().length>200||/[\u0000-\u001f\u007f]/.test(value)))throw fail('PIPELINE_INVALID','Tên cột mới không hợp lệ.');
   if(s.enabled&&type==='fill'&&!value.length)throw fail('PIPELINE_INVALID','Giá trị điền không được rỗng.');
   return {type,enabled:s.enabled,column,value,replacement,operator:s.operator as FilterType,target:s.target as Kind};
 });
 return {version:1,name,steps};
}
export function validateRecipes(input:unknown):PipelineRecipe[]{
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>PIPELINE_LIMITS.recipes)throw fail('PIPELINE_LIMIT','Tối đa 12 công thức.');
 const seen=new Set<string>();
 return input.map(raw=>{const r=validateRecipe(raw),key=r.name.toLowerCase();if(seen.has(key))throw fail('PIPELINE_NAME_DUPLICATE','Tên công thức bị trùng.');seen.add(key);return r;});
}
export type CompiledStep={sql:string;columns:Column[];guard:string|null};
const q=(id:string)=>{if(!/^c(?:0|[1-9][0-9]?)$/.test(id))throw fail('PIPELINE_SCHEMA_INVALID','ID cột không hợp lệ.');return '"'+id+'"';};
function missing(c:string){return '('+c+" IS NULL OR trim("+c+") = '')";}
function countGuard(table:string,condition:string){return 'SELECT CAST(COUNT(*) AS DOUBLE) AS n FROM '+table+' WHERE '+condition;}
export function compileStep(step:PipelineStep,columns:Column[],table:string):CompiledStep{
 if(!/^(source_s[1-9][0-9]{0,14}|pipeline_stage_[ab])$/.test(table))throw fail('PIPELINE_TABLE_INVALID','Tên bảng không hợp lệ.');
 if(!columns.length||columns.length>LIMITS.columns||new Set(columns.map(c=>c.id)).size!==columns.length||new Set(columns.map(c=>c.name)).size!==columns.length)throw fail('PIPELINE_SCHEMA_INVALID','Schema không hợp lệ.');
 const ids=columns.map(c=>q(c.id));
 const select=(cols:Column[],expr?:{id:string;sql:string})=>'SELECT '+cols.map(c=>expr?.id===c.id?expr.sql+' AS '+q(c.id):q(c.id)).join(', ')+' FROM '+table;
 if(!step.enabled)return {sql:select(columns),columns,guard:null};
 if(step.type==='distinct')return {sql:'SELECT DISTINCT '+ids.join(', ')+' FROM '+table,columns,guard:null};
 const col=columns.find(c=>c.name===step.column);
 if(!col)throw fail('PIPELINE_COLUMN_MISSING','Không tìm thấy cột '+step.column+'.');
 const c=q(col.id),blank=missing(c),literal=sqlText(step.value);
 const transform=(expr:string,kind:Kind=col.kind,guard:string|null=null)=>({sql:select(columns,{id:col.id,sql:expr}),columns:columns.map(x=>x.id===col.id?{...x,kind}:x),guard});
 if(step.type==='rename'){
   const name=step.value.trim();
   if(columns.some(x=>x.id!==col.id&&x.name===name))throw fail('PIPELINE_NAME_DUPLICATE','Tên cột mới bị trùng.');
   return {sql:select(columns),columns:columns.map(x=>x.id===col.id?{...x,name}:x),guard:null};
 }
 if(step.type==='drop'){
   const next=columns.filter(x=>x.id!==col.id);
   if(!next.length)throw fail('PIPELINE_SCHEMA_INVALID','Không thể bỏ cột cuối cùng.');
   return {sql:select(next),columns:next,guard:null};
 }
 if(step.type==='filter'){
   let where:string;
   if(step.operator==='empty')where=blank;
   else if(step.operator==='notEmpty')where='NOT '+blank;
   else if(step.operator==='eq'||step.operator==='neq')where=c+(step.operator==='eq'?' = ':' <> ')+literal;
   else if(step.operator==='contains')where='contains(lower(coalesce('+c+", '')), lower("+literal+'))';
   else {
     const n=Number(step.value);
     if(col.kind!=='number'||!step.value.trim()||!Number.isFinite(n))throw fail('PIPELINE_FILTER_INVALID','Bộ lọc số cần cột số và giá trị hữu hạn.');
     const op={gt:'>',gte:'>=',lt:'<',lte:'<='}[step.operator];
     where='TRY_CAST('+c+' AS DOUBLE) '+op+' '+String(n);
   }
   return {sql:select(columns)+' WHERE '+where,columns,guard:null};
 }
 if(step.type==='cast'){
   if(step.target===col.kind||step.target==='text')return transform(c,step.target);
   const normalized='trim('+c+')';
   if(step.target==='number'){
     const n='TRY_CAST('+normalized+' AS DOUBLE)';
     const valid="regexp_full_match("+normalized+", '[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?') AND "+n+" IS NOT NULL AND isfinite("+n+") AND (trunc("+n+") <> "+n+" OR abs("+n+") <= 9007199254740991)";
     return transform('CASE WHEN '+blank+' THEN NULL ELSE CAST('+n+' AS VARCHAR) END','number',countGuard(table,'NOT '+blank+' AND NOT coalesce(('+valid+'),false)'));
   }
   if(step.target==='boolean'){
     const valid="lower("+normalized+") IN ('true','false','1','0')";
     return transform("CASE WHEN "+blank+" THEN NULL WHEN lower("+normalized+") IN ('true','1') THEN 'true' ELSE 'false' END",'boolean',countGuard(table,'NOT '+blank+' AND NOT coalesce(('+valid+'),false)'));
   }
   const d='TRY_CAST('+normalized+' AS DATE)';
   const valid="regexp_full_match("+normalized+", '[0-9]{4}-[0-9]{2}-[0-9]{2}') AND "+d+" IS NOT NULL AND substr("+normalized+",1,4) <> '0000'";
   return transform("CASE WHEN "+blank+" THEN NULL ELSE CAST("+d+" AS VARCHAR) || 'T00:00:00.000Z' END",'date',countGuard(table,'NOT '+blank+' AND NOT coalesce(('+valid+'),false)'));
 }
 if(col.kind!=='text')throw fail('PIPELINE_TEXT_REQUIRED','Thao tác này cần cột văn bản.');
 if(step.type==='trim')return transform('trim('+c+')');
 if(step.type==='fill')return transform('CASE WHEN '+blank+' THEN '+literal+' ELSE '+c+' END');
 if(step.type==='replace'){
   const replacement=sqlText(step.replacement);
   // Bound string growth before executing expanding replace. Use UTF-8 bytes.
   const bytes=(expr:string)=>'octet_length(encode('+expr+'))';
   const removed='replace('+c+', '+literal+", '')";
   const extra=Math.max(0,new TextEncoder().encode(step.replacement).length-new TextEncoder().encode(step.value).length);
   const size=bytes(c)+' + (('+bytes(c)+' - '+bytes(removed)+') / '+new TextEncoder().encode(step.value).length+') * '+extra;
   return transform('replace('+c+', '+literal+', '+replacement+')','text',countGuard(table,size+' > '+LIMITS.textLength));
 }
 throw fail('PIPELINE_INVALID','Loại bước chưa hỗ trợ.');
}
export function stageSchema(recipe:PipelineRecipe,columns:Column[]):Column[][]{
 let current=columns;
 return recipe.steps.map(step=>{const compiled=compileStep(step,current,'pipeline_stage_a');current=compiled.columns;return current;});
}
