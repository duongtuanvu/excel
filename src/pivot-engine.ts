import {compileReport} from './model.ts';
import type {Column,Config} from './model.ts';
import {validatePivot,validatePivotColumns,PIVOT_LIMITS,arithmetic} from './pivot-config.ts';
import type {PivotAxis,PivotResult,Operand} from './pivot-config.ts';
type Result=Iterable<unknown>;
const key=(a:PivotAxis)=>JSON.stringify([a.level,a.labels]);
const num=(v:unknown):number|null=>v==null?null:Number.isFinite(Number(v))?Number(v):null;
function sortAxis(a:PivotAxis,b:PivotAxis){
 for(let i=0;i<Math.min(a.level,b.level);i++){
  const x=a.labels[i],y=b.labels[i];if(x===y)continue;
  if(x===null)return 1;if(y===null)return -1;return x<y?-1:1;
 }
 return b.level-a.level;
}
export async function calculatePivot(config:Config,columns:Column[],table:string,query:(sql:string)=>Promise<Result>):Promise<PivotResult>{
 const pivot=validatePivot(config.pivot);
 if(!pivot)throw Error('PIVOT_INVALID: Chưa thiết lập Pivot.');
 validatePivotColumns(pivot,columns);
 const from=compileReport(config,columns,table).from;
 const field=(name:string)=>{
  const c=columns.find(c=>c.name===name);
  if(!c||!/^c[0-9]+$/.test(c.id))throw Error('PIVOT_COLUMN_MISSING: '+name);
  return '"'+c.id+'"';
 };
 const r=pivot.rows.map(field),c=pivot.columns.map(field),dims=[...r,...c];
 const levels=(n:number)=>Array.from(new Set(pivot.subtotals?Array.from({length:n+1},(_,i)=>i):[0,n]));
 const rl=levels(r.length),cl=levels(c.length);
 // Preflight each axis independently before issuing the bounded cross-product aggregation.
 async function axisCount(fields:string[],ls:number[],max:number){
  let total=0;
  for(const n of ls){
   if(!n){total++;continue;}
   const keys=fields.slice(0,n);
   const sql='SELECT CAST(COUNT(*) AS DOUBLE) AS n FROM (SELECT '+keys.join(', ')+from+' GROUP BY '+keys.join(', ')+' LIMIT '+(max+1)+') AS axis';
   const row=Array.from(await query(sql))[0] as Record<string,unknown>|undefined;
   const count=Number(row?.n);
   if(!Number.isSafeInteger(count)||count<0)throw Error('PIVOT_RESULT_INVALID: Không đọc được số nhóm.');
   total+=count;if(total>max)throw Error('PIVOT_AXIS_LIMIT: Quá nhiều nhóm hàng/cột; hãy lọc dữ liệu.');
  }
  return total;
 }
 const nr=await axisCount(r,rl,PIVOT_LIMITS.rows),nc=await axisCount(c,cl,PIVOT_LIMITS.axisColumns);
 if(nr*nc*pivot.measures.length>PIVOT_LIMITS.cells)throw Error('PIVOT_CELL_LIMIT: Ma trận vượt 20.000 ô; hãy giảm số nhóm hoặc chỉ số.');
 // Reject rather than truncate dimension labels, because truncating merges distinct keys.
 if(dims.length){
  const condition=dims.map(d=>'length('+d+') > '+PIVOT_LIMITS.label).join(' OR ');
  const row=Array.from(await query('SELECT CAST(COUNT(*) AS DOUBLE) AS n FROM (SELECT 1'+from+(from.includes(' WHERE ')?' AND ':' WHERE ')+'('+condition+') LIMIT 1) AS too_long'))[0] as Record<string,unknown>|undefined;
  if(Number(row?.n)!==0)throw Error('PIVOT_LABEL_LIMIT: Giá trị nhóm dài quá 240 ký tự.');
 }
 const numeric=(name:string)=>'TRY_CAST('+field(name)+' AS DOUBLE)';
 const operand=(o:Operand)=>o.kind==='constant'?'CAST('+String(o.value)+' AS DOUBLE)':numeric(o.column);
 const measures=pivot.measures.flatMap((m,i)=>{
  if(m.kind==='formula')return [];
  let expr:string;
  if(m.kind==='aggregate'){
   expr=m.aggregate==='count'?'COUNT(*)':m.aggregate==='distinct'?'COUNT(DISTINCT '+field(m.column)+')':m.aggregate.toUpperCase()+'('+numeric(m.column)+')';
  }else{
   const a=operand(m.expression.left),b=operand(m.expression.right);
   const expression='('+a+' '+m.expression.op+' '+(m.expression.op==='/'?'NULLIF('+b+',0)':b)+')';
   expr=m.aggregate.toUpperCase()+'(CASE WHEN isfinite('+expression+') THEN '+expression+' ELSE NULL END)';
  }
  return ['CAST('+expr+' AS DOUBLE) AS m'+i];
 });
 const rowMap=new Map<string,PivotAxis>(),colMap=new Map<string,PivotAxis>(),data=new Map<string,(number|null)[]>();
 for(const rn of rl)for(const cn of cl){
  const keys=[...r.slice(0,rn),...c.slice(0,cn)];
  const projection=[...r.slice(0,rn).map((x,i)=>x+' AS r'+i),...c.slice(0,cn).map((x,i)=>x+' AS c'+i),...measures];
  const sql='SELECT '+projection.join(', ')+from+(keys.length?' GROUP BY '+keys.join(', '):'')+' LIMIT '+(PIVOT_LIMITS.cells+1);
  for(const item of await query(sql)){
   const row=item as Record<string,unknown>;
   const axis=(prefix:string,n:number):PivotAxis=>({level:n,labels:Array.from({length:n},(_,i)=>row[prefix+i]==null?null:String(row[prefix+i]))});
   const ra=axis('r',rn),ca=axis('c',cn),rk=key(ra),ck=key(ca);
   rowMap.set(rk,ra);colMap.set(ck,ca);
   const vals:(number|null)[]=[],byId=new Map<string,number|null>();
   pivot.measures.forEach((m,i)=>{
    const v=m.kind==='formula'?arithmetic(byId.get(m.left)??null,byId.get(m.right)??null,m.op):num(row['m'+i]);
    vals.push(v);byId.set(m.id,v);
   });
   data.set(JSON.stringify([rk,ck]),vals);
   if(data.size>PIVOT_LIMITS.cells||rowMap.size>nr||colMap.size>nc)throw Error('PIVOT_CELL_LIMIT: Kết quả vượt giới hạn.');
  }
 }
 const rowAxes=[...rowMap.values()].sort(sortAxis),columnAxes=[...colMap.values()].sort(sortAxis);
 // A missing intersection has zero count/distinct and NULL for non-count measures.
 function emptyValues(){
  const seen=new Map<string,number|null>();
  return pivot!.measures.map(m=>{const value=m.kind==='formula'?arithmetic(seen.get(m.left)??null,seen.get(m.right)??null,m.op):m.kind==='aggregate'&&['count','distinct'].includes(m.aggregate)?0:null;seen.set(m.id,value);return value;});
 }
 return {rows:rowAxes,columns:columnAxes,values:rowAxes.map(a=>columnAxes.flatMap(b=>data.get(JSON.stringify([key(a),key(b)]))??emptyValues()))};
}
