import type {Aggregate,Column} from './model.ts';

export const PIVOT_LIMITS={rowFields:3,columnFields:2,measures:6,rows:500,axisColumns:64,cells:20000,label:240,page:40} as const;
export const PIVOT_AGGREGATES=['sum','count','avg','min','max','distinct'] as const;
export const PIVOT_OPERATORS=['+','-','*','/'] as const;
export const PIVOT_FORMATS=['number','vnd','percent'] as const;
export type PivotOp=typeof PIVOT_OPERATORS[number];
export type PivotFormat=typeof PIVOT_FORMATS[number];
export type Operand={kind:'column';column:string}|{kind:'constant';value:number};
export type RowFormula={left:Operand;op:PivotOp;right:Operand};
export const PIVOT_SHOW_AS=['grand','row','column'] as const;
export type PivotShowAs=typeof PIVOT_SHOW_AS[number];
export type MeasureBase={id:string;name:string;format:PivotFormat;decimals:number;showAs?:PivotShowAs};
export type AggregateMeasure=MeasureBase&{kind:'aggregate';aggregate:Aggregate;column:string};
export type RowMeasure=MeasureBase&{kind:'row';aggregate:'sum'|'avg'|'min'|'max';expression:RowFormula};
export type FormulaMeasure=MeasureBase&{kind:'formula';left:string;op:PivotOp;right:string};
export type PivotMeasure=AggregateMeasure|RowMeasure|FormulaMeasure;
export type PivotConfig={version:1;rows:string[];columns:string[];measures:PivotMeasure[];subtotals:boolean;topN?:{count:number;measureId:string}};
export type PivotAxis={level:number;labels:(string|null)[]};
export type PivotResult={rows:PivotAxis[];columns:PivotAxis[];values:(number|null)[][];ranked?:{shownLeaves:number;hiddenLeaves:number}};
export type PivotDrill={row:PivotAxis;column:PivotAxis;page:number;rows:(string|null)[][];columns:Column[];count:number};
export const PIVOT_DRILL_PAGE=25;
export const PIVOT_DRILL_TEXT=240;
const err=(message:string)=>new Error('PIVOT_INVALID: '+message);
const rec=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw err('Cấu hình không hợp lệ.');
 return v as Record<string,unknown>;
};
const text=(v:unknown,max:number):string=>{
 if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw err('Tên hoặc cột không hợp lệ.');
 return v;
};
function op(v:unknown):PivotOp{
 if(!PIVOT_OPERATORS.includes(v as PivotOp))throw err('Toán tử không hợp lệ.');
 return v as PivotOp;
}
function operand(v:unknown):Operand{
 const o=rec(v);
 if(o.kind==='column')return {kind:'column',column:text(o.column,240)};
 if(o.kind==='constant'&&typeof o.value==='number'&&Number.isFinite(o.value)&&Math.abs(o.value)<=Number.MAX_SAFE_INTEGER)return {kind:'constant',value:o.value};
 throw err('Toán hạng cần cột hoặc hằng số hữu hạn.');
}
export function validatePivot(input:unknown):PivotConfig|undefined{
 if(input==null)return undefined;
 const v=rec(input);
 if(v.version!==1||typeof v.subtotals!=='boolean'||!Array.isArray(v.rows)||v.rows.length>PIVOT_LIMITS.rowFields||!Array.isArray(v.columns)||v.columns.length>PIVOT_LIMITS.columnFields||!Array.isArray(v.measures)||!v.measures.length||v.measures.length>PIVOT_LIMITS.measures)throw err('Tối đa 3 trường hàng, 2 trường cột, 6 chỉ số.');
 const rows=v.rows.map(n=>text(n,240)),columns=v.columns.map(n=>text(n,240));
 if(new Set([...rows,...columns]).size!==rows.length+columns.length)throw err('Trường hàng/cột không được trùng.');
 const ids=new Set<string>(),names=new Set<string>();
 const measures:PivotMeasure[]=v.measures.map(raw=>{
   const m=rec(raw),id=text(m.id,40),name=text(m.name,100).trim();
   if(!/^m[1-9][0-9]{0,7}$/.test(id)||ids.has(id)||names.has(name.toLowerCase())||!PIVOT_FORMATS.includes(m.format as PivotFormat)||typeof m.decimals!=='number'||!Number.isInteger(m.decimals)||m.decimals<0||m.decimals>6)throw err('Mã, tên hoặc định dạng chỉ số không hợp lệ/trùng.');
   if(m.showAs!==undefined&&!PIVOT_SHOW_AS.includes(m.showAs as PivotShowAs))throw err('Kiểu tỷ trọng không hợp lệ.');
   const base={id,name,format:m.format as PivotFormat,decimals:m.decimals,...(m.showAs?{showAs:m.showAs as PivotShowAs}:{})};
   let result:PivotMeasure;
   if(m.kind==='aggregate'){
     if(!PIVOT_AGGREGATES.includes(m.aggregate as Aggregate))throw err('Phép tổng hợp không hợp lệ.');
     result={...base,kind:'aggregate',aggregate:m.aggregate as Aggregate,column:m.aggregate==='count'?'':text(m.column,240)};
   }else if(m.kind==='row'){
     if(!['sum','avg','min','max'].includes(String(m.aggregate)))throw err('Công thức từng dòng cần SUM, AVG, MIN hoặc MAX.');
     const e=rec(m.expression);
     result={...base,kind:'row',aggregate:m.aggregate as RowMeasure['aggregate'],expression:{left:operand(e.left),op:op(e.op),right:operand(e.right)}};
   }else if(m.kind==='formula'){
     const left=text(m.left,40),right=text(m.right,40);
     if(!ids.has(left)||!ids.has(right))throw err('Công thức tổng hợp chỉ được tham chiếu chỉ số đứng trước (không vòng lặp).');
     result={...base,kind:'formula',left,op:op(m.op),right};
   }else throw err('Loại chỉ số không hợp lệ.');
   ids.add(id);names.add(name.toLowerCase());return result;
 });
 let topN:PivotConfig['topN'];
 if(v.topN!==undefined){
   const t=rec(v.topN);
   if(!rows.length||typeof t.count!=='number'||!Number.isInteger(t.count)||t.count<1||t.count>100||typeof t.measureId!=='string'||!ids.has(t.measureId))throw err('Top N cần nhóm hàng, N từ 1–100 và chỉ số hợp lệ.');
   topN={count:t.count,measureId:t.measureId};
 }
 return {version:1,rows,columns,measures,subtotals:v.subtotals,...(topN?{topN}:{})};
}
export function pivotReferences(pivot:PivotConfig):string[]{
 const refs=[...pivot.rows,...pivot.columns];
 for(const m of pivot.measures){
   if(m.kind==='aggregate'&&m.aggregate!=='count')refs.push(m.column);
   if(m.kind==='row')for(const o of [m.expression.left,m.expression.right])if(o.kind==='column')refs.push(o.column);
 }
 return [...new Set(refs)];
}
export function validatePivotColumns(pivot:PivotConfig,columns:readonly Column[]):void{
 const names=new Map(columns.map(c=>[c.name,c.kind]));
 for(const n of pivotReferences(pivot))if(!names.has(n))throw new Error('PIVOT_COLUMN_MISSING: Không tìm thấy cột '+n+'.');
 for(const m of pivot.measures){
   if(m.kind==='aggregate'&&!['count','distinct'].includes(m.aggregate)&&names.get(m.column)!=='number')throw new Error('PIVOT_TYPE_INVALID: '+m.name+' cần cột số.');
   if(m.kind==='row')for(const o of [m.expression.left,m.expression.right])if(o.kind==='column'&&names.get(o.column)!=='number')throw new Error('PIVOT_TYPE_INVALID: '+m.name+' cần toán hạng số.');
 }
}
export function renamePivot(pivot:PivotConfig,lookup:(name:string)=>string):PivotConfig{
 const operandName=(o:Operand):Operand=>o.kind==='column'?{...o,column:lookup(o.column)}:o;
 return {...pivot,rows:pivot.rows.map(lookup),columns:pivot.columns.map(lookup),measures:pivot.measures.map(m=>{
   if(m.kind==='aggregate'&&m.aggregate!=='count')return {...m,column:lookup(m.column)};
   if(m.kind==='row')return {...m,expression:{...m.expression,left:operandName(m.expression.left),right:operandName(m.expression.right)}};
   return m;
 })};
}
export function arithmetic(a:number|null,b:number|null,op:PivotOp):number|null{
 if(a===null||b===null||(op==='/'&&b===0))return null;
 const v=op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:a/b;
 return Number.isFinite(v)?v:null;
}
export function axisLabel(axis:PivotAxis,fields:number):string{
 if(axis.level===0)return 'Tổng cộng';
 const values=axis.labels.map(v=>v===null?'(NULL)':v===''?'(Rỗng)':v);
 return (axis.level<fields?'Tổng phụ · ':'')+values.join(' / ');
}
export function effectivePivotFormat(measure:PivotMeasure):PivotFormat{return measure.showAs?'percent':measure.format;}
export function hasPivotAnalytics(pivot?:PivotConfig):boolean{return !!pivot&&(!!pivot.topN||pivot.measures.some(m=>!!m.showAs));}
export function pivotFormat(value:number|null,measure:PivotMeasure):string{
 if(value===null)return '—';
 const opts={minimumFractionDigits:measure.decimals,maximumFractionDigits:measure.decimals};
 return new Intl.NumberFormat('vi-VN',effectivePivotFormat(measure)==='vnd'?{...opts,style:'currency',currency:'VND'}:effectivePivotFormat(measure)==='percent'?{...opts,style:'percent'}:opts).format(value);
}
export function pivotMatrix(pivot:PivotConfig,result:PivotResult):(string|number|null)[][]{
 const suffix=(m:PivotMeasure)=>m.showAs?' (% '+(m.showAs==='grand'?'tổng chung':m.showAs==='row'?'tổng hàng':'tổng cột')+'; 1=100%)':'';
 const totalSuffix=pivot.topN?' (toàn bộ sau lọc)':'';
 return [['Cấp hàng',...pivot.rows,...result.columns.flatMap(a=>pivot.measures.map(m=>axisLabel(a,pivot.columns.length)+' · '+m.name+suffix(m)))],
 ...result.rows.map((a,i)=>[a.level===0?'Tổng cộng'+totalSuffix:a.level<pivot.rows.length?'Tổng phụ'+totalSuffix:'Chi tiết',...pivot.rows.map((_,j)=>j<a.level?a.labels[j]:null),...result.values[i]])];
}
