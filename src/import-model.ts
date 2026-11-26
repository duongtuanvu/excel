import {pivotReferences} from './pivot-config.ts';
import { LIMITS, compileReport, defaultConfig, reconcileConfig } from './model.ts';
import type { Column, Config } from './model.ts';
import { validateSchema, resolveSchema } from './schema-model.ts';
import type { SchemaRule, SchemaIssue } from './schema-model.ts';

export type SheetBounds={firstRow:number;lastRow:number;firstColumn:number;lastColumn:number};
// All coordinates are one-based; null means the last occupied row/column of the next workbook.
export type ImportLayout={headerRow:number;firstColumn:number;lastRow:number|null;lastColumn:number|null};
export type LayoutPreview={sourceId:string;revision:number;bounds:SheetBounds;columns:Column[];rows:number;issues:SchemaIssue[];conflicts:string[];config:Config};
export type ColumnMapping={name:string;sourceName:string};
export type ReplacementPreview={sourceId:string;revision:number;incoming:Column[];mapping:ColumnMapping[];sheet:string};
export type MappedPreview={sourceId:string;revision:number;rows:number;columns:Column[];issues:SchemaIssue[];mismatches:string[]};

export function validateLayout(input:unknown):ImportLayout|undefined{
 if(input===undefined||input===null)return undefined;
 if(typeof input!=='object'||Array.isArray(input))throw new Error('LAYOUT_INVALID: Vùng dữ liệu không hợp lệ.');
 const v=input as Record<string,unknown>;
 const integer=(x:unknown,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=1&&x<=max;
 if(!integer(v.headerRow,1_048_576)||!integer(v.firstColumn,16_384)||(v.lastRow!==null&&(!integer(v.lastRow,1_048_576)||v.lastRow<v.headerRow))||(v.lastColumn!==null&&(!integer(v.lastColumn,16_384)||v.lastColumn<v.firstColumn)))throw new Error('LAYOUT_INVALID: Tọa độ dòng/cột không hợp lệ.');
 return {headerRow:v.headerRow,firstColumn:v.firstColumn,lastRow:v.lastRow as number|null,lastColumn:v.lastColumn as number|null};
}
export function resolveLayout(bounds:SheetBounds,readBounds:SheetBounds,input:unknown):SheetBounds{
 const layout=validateLayout(input);
 const range=layout?{firstRow:layout.headerRow,firstColumn:layout.firstColumn,lastRow:layout.lastRow??bounds.lastRow,lastColumn:layout.lastColumn??bounds.lastColumn}:bounds;
 if(range.firstRow<bounds.firstRow||range.firstColumn<bounds.firstColumn||range.lastRow>bounds.lastRow||range.lastColumn>bounds.lastColumn||range.firstRow>range.lastRow||range.firstColumn>range.lastColumn)throw new Error('LAYOUT_OUT_OF_RANGE: Vùng chọn nằm ngoài dữ liệu sheet.');
 if(range.firstRow<readBounds.firstRow||range.firstColumn<readBounds.firstColumn||range.lastRow>readBounds.lastRow||range.lastColumn>readBounds.lastColumn)throw new Error('LAYOUT_TRUNCATED: Vùng chọn vượt dữ liệu đã đọc. Hãy chia nhỏ workbook.');
 const width=range.lastColumn-range.firstColumn+1,height=range.lastRow-range.firstRow+1;
 if(width>LIMITS.columns||height>LIMITS.rows+1||width*height>LIMITS.cells)throw new Error('LAYOUT_LIMIT: Vùng dữ liệu vượt giới hạn 100 cột, 100.000 dòng hoặc 1 triệu ô.');
 return range;
}
export function layoutConfig(config:Config,before:Column[],after:Column[]):{config:Config;conflicts:string[]}{
 const mapped=reconcileConfig(config,after);
 const conflicts=[...mapped.missing];
 const names=new Set([...config.groups,...config.filters.map(f=>f.column),...(config.metric?[config.metric]:[]),...(config.pivot?pivotReferences(config.pivot):[])]);
 for(const name of names){
   const prev=before.find(c=>c.name===name),next=after.find(c=>c.name===name);
   if(prev&&next&&prev.kind!==next.kind)conflicts.push(name+' (đổi kiểu)');
 }
 if(!conflicts.length){try{compileReport(mapped.config,after);}catch{conflicts.push('Cấu hình báo cáo không tương thích');}}
 return {config:conflicts.length?defaultConfig(after):mapped.config,conflicts:[...new Set(conflicts)]};
}
export function suggestMapping(expected:readonly Column[],rules:readonly SchemaRule[],incoming:readonly Column[]):ColumnMapping[]{
 const rawByTarget=new Map(rules.map(r=>[r.name,r.sourceName]));
 const available=new Set(incoming.map(c=>c.name));
 const used=new Set<string>();
 return expected.map(c=>{
   const old=rawByTarget.get(c.name)??c.name;
   const sourceName=[old,c.name].find(n=>available.has(n)&&!used.has(n))??'';
   if(sourceName)used.add(sourceName);
   return {name:c.name,sourceName};
 });
}
// A mapping covers every logical column once, preserves its prior conversion mode, and
// retains extra incoming columns only if the resulting names remain unique.
export function mappedRules(expected:readonly Column[],prior:readonly SchemaRule[],incoming:readonly Column[],mapping:unknown):SchemaRule[]{
 if(!Array.isArray(mapping)||mapping.length!==expected.length)throw new Error('MAPPING_INVALID: Cần ghép đủ các cột hiện tại.');
 const oldByTarget=new Map(prior.map(r=>[r.name,r]));
 const expectedNames=new Set(expected.map(c=>c.name)),incomingNames=new Set(incoming.map(c=>c.name)),seen=new Set<string>(),used=new Set<string>();
 const rules=mapping.map(raw=>{
   if(!raw||typeof raw!=='object')throw new Error('MAPPING_INVALID: Cấu hình ghép cột không hợp lệ.');
   const {name,sourceName}=raw as Record<string,unknown>;
   if(typeof name!=='string'||typeof sourceName!=='string'||!expectedNames.has(name)||!incomingNames.has(sourceName)||seen.has(name)||used.has(sourceName))throw new Error('MAPPING_INVALID: Mỗi cột phải ghép với đúng một cột nguồn khác nhau.');
   seen.add(name);used.add(sourceName);
   return {name,sourceName,mode:oldByTarget.get(name)?.mode??'auto'} satisfies SchemaRule;
 });
 const checked=validateSchema(rules);
 resolveSchema(incoming,checked);
 return checked;
}
