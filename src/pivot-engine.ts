import {compileReport,sqlText,LIMITS} from './model.ts';
import {applyPivotAnalytics} from './pivot-analytics.ts';
import type {Column,Config} from './model.ts';
import {validatePivot,validatePivotColumns,PIVOT_LIMITS,arithmetic,PIVOT_DRILL_PAGE,PIVOT_DRILL_TEXT} from './pivot-config.ts';
import type {PivotAxis,PivotResult,Operand,PivotDrill,PivotConfig} from './pivot-config.ts';
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
 return applyPivotAnalytics(pivot,{rows:rowAxes,columns:columnAxes,values:rowAxes.map(a=>columnAxes.flatMap(b=>data.get(JSON.stringify([key(a),key(b)]))??emptyValues()))});
}

function checkedDrillAxis(input:unknown,fields:string[],pivot:PivotConfig):PivotAxis{
 if(!input||typeof input!=='object')throw Error('PIVOT_DRILL_INVALID: Nhóm không hợp lệ.');
 const a=input as PivotAxis;
 if(!Number.isInteger(a.level)||a.level<0||a.level>fields.length||(!pivot.subtotals&&a.level!==0&&a.level!==fields.length)||!Array.isArray(a.labels)||a.labels.length!==a.level||a.labels.some(v=>v!==null&&(typeof v!=='string'||v.includes('\0')||Array.from(v).length>PIVOT_LIMITS.label)))throw Error('PIVOT_DRILL_INVALID: Nhóm hoặc giá trị không hợp lệ.');
 return {level:a.level,labels:[...a.labels]};
}
export function compilePivotDrill(config:Config,columns:Column[],table:string,row:unknown,column:unknown){
 const pivot=validatePivot(config.pivot);
 if(!pivot)throw Error('PIVOT_INVALID: Chưa thiết lập Pivot.');
 validatePivotColumns(pivot,columns);
 const r=checkedDrillAxis(row,pivot.rows,pivot),c=checkedDrillAxis(column,pivot.columns,pivot);
 const from=compileReport(config,columns,table).from;
 const field=(name:string)=>{
   const col=columns.find(v=>v.name===name);
   if(!col||!/^c[0-9]+$/.test(col.id))throw Error('PIVOT_DRILL_INVALID: Cột không hợp lệ.');
   return '"'+col.id+'"';
 };
 const predicates=[...r.labels.map((v,i)=>({field:field(pivot.rows[i]),v})),...c.labels.map((v,i)=>({field:field(pivot.columns[i]),v}))].map(({field,v})=>field+(v===null?' IS NULL':' = '+sqlText(v)));
 const scope=from+(predicates.length?(from.includes(' WHERE ')?' AND ':' WHERE ')+predicates.join(' AND '):'');
 if(!columns.length||columns.length>LIMITS.columns||new Set(columns.map(v=>v.id)).size!==columns.length)throw Error('PIVOT_DRILL_INVALID: Schema không hợp lệ.');
 const projection=columns.map(col=>{
   const q=field(col.name);
   return 'CASE WHEN length('+q+') > '+PIVOT_DRILL_TEXT+' THEN left('+q+','+PIVOT_DRILL_TEXT+") || '…' ELSE "+q+' END AS '+q;
 }).join(', ');
 return {row:r,column:c,count:'SELECT CAST(COUNT(*) AS DOUBLE) AS n'+scope,page:(offset:number)=>'SELECT '+projection+scope+' ORDER BY rowid LIMIT '+PIVOT_DRILL_PAGE+' OFFSET '+offset};
}
export async function drillPivot(config:Config,columns:Column[],table:string,row:unknown,column:unknown,page:unknown,query:(sql:string)=>Promise<Result>):Promise<PivotDrill>{
 if(typeof page!=='number'||!Number.isSafeInteger(page)||page<0)throw Error('PIVOT_DRILL_INVALID: Trang không hợp lệ.');
 const sql=compilePivotDrill(config,columns,table,row,column);
 const total=Array.from(await query(sql.count))[0] as Record<string,unknown>|undefined,count=Number(total?.n);
 if(!Number.isSafeInteger(count)||count<0||count>LIMITS.rows)throw Error('PIVOT_DRILL_INVALID: Số dòng ngoài giới hạn.');
 const safePage=Math.min(page,Math.floor(Math.max(0,count-1)/PIVOT_DRILL_PAGE));
 const rows=Array.from(await query(sql.page(safePage*PIVOT_DRILL_PAGE)),v=>columns.map(c=>{
   const value=(v as Record<string,unknown>)[c.id];return value==null?null:String(value);
 }));
 if(rows.length!==Math.min(PIVOT_DRILL_PAGE,Math.max(0,count-safePage*PIVOT_DRILL_PAGE)))throw Error('PIVOT_DRILL_INVALID: Kết quả không khớp số dòng.');
 return {row:sql.row,column:sql.column,page:safePage,count,columns,rows};
}
