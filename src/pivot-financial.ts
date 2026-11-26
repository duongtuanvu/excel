import {LIMITS} from './model.ts';
import {PIVOT_LIMITS} from './pivot-config.ts';
import type {PivotConfig,PivotAxis,PivotResult,Operand} from './pivot-config.ts';
import {parseExpression,expressionRefs} from './pivot-expression.ts';
import {decimalFactor,decimalBound,parseFixed,roundedDivide,fixedArithmetic,fixedString,evaluateFixed} from './financial-decimal.ts';
import type {Fixed} from './financial-decimal.ts';
import {isAxisAncestor,pivotAxisKey} from './pivot-analytics.ts';
import {calendarIndex} from './pivot-time.ts';

export const FINANCIAL_LIMITS={batch:512,distinctEntries:250000,distinctChars:8000000,distinctLength:240} as const;
type Query=(sql:string)=>Promise<Iterable<unknown>>;
type Acc={count:number;sum:bigint;min:Fixed;max:Fixed;distinct?:Set<string>};
const axisKey=pivotAxisKey;
const accumulator=():Acc=>({count:0,sum:0n,min:null,max:null});
const cellKey=(r:PivotAxis,c:PivotAxis)=>JSON.stringify([r.level,r.labels,c.level,c.labels]);

export function finishFinancial(pivot:PivotConfig,rows:PivotAxis[],columns:PivotAxis[],raw:Fixed[][]):PivotResult{
 const scale=pivot.financialScale!,factor=decimalFactor(scale),width=pivot.measures.length;
 const grandRow=rows.findIndex(a=>a.level===0),grandCol=columns.findIndex(a=>a.level===0);
 if(grandRow<0||grandCol<0)throw Error('PIVOT_RESULT_INVALID: Thiếu tổng cộng.');
 const ids=new Map(pivot.measures.map((m,i)=>[m.id,i]));
 const result=raw.map(a=>[...a]);
 if(pivot.calendar){
   const periods=new Map<number,number>();
   columns.forEach((a,j)=>{if(a.level!==1||a.labels[0]===null)return;const period=calendarIndex(a.labels[0],pivot.calendar!);if(period===null||periods.has(period))throw Error('PIVOT_TIME_RESULT_INVALID: Kỳ không hợp lệ.');periods.set(period,j);});
   const ordered=[...periods.entries()].sort((a,b)=>a[0]-b[0]);
   raw.forEach((a,i)=>pivot.measures.forEach((m,k)=>{
     if(m.kind!=='time')return;
     const source=ids.get(m.measureId)!;let year=-1,acc:Fixed=null;
     for(const [period,j] of ordered){
       const current=a[j*width+source];let value:Fixed=null;
       if(m.operation==='ytd'){
         const y=Math.floor(period/12);
         if(y!==year){year=y;acc=null;}
         if(current!==null)acc=fixedArithmetic(acc??0n,current,'+',factor);
         value=acc;
       }else{
         const offset=(m.operation==='prior-year'||m.operation==='yoy-growth')&&pivot.calendar==='month'?12:1;
         const prior=periods.get(period-offset),previous=prior===undefined?null:a[prior*width+source];
         if(m.operation==='previous'||m.operation==='prior-year')value=previous;
         else{const delta=fixedArithmetic(current,previous,'-',factor);value=m.operation==='change'?delta:fixedArithmetic(delta,previous,'/',factor);}
       }
       result[i][j*width+k]=value;
     }
   }));
 }
 let indices=rows.map((_,i)=>i),ranked:PivotResult['ranked'];
 if(pivot.topN){
   const k=ids.get(pivot.topN.measureId)!;
   const leaf=indices.filter(i=>rows[i].level===pivot.rows.length),score=(i:number)=>raw[i][grandCol*width+k];
   const selected=leaf.filter(i=>score(i)!==null).sort((a,b)=>score(a)===score(b)?a-b:score(a)!>score(b)!?-1:1).slice(0,pivot.topN.count);
   const kept=new Set(selected);
   indices=pivot.rows.length===1?[...selected,grandRow]:indices.filter(i=>i===grandRow||kept.has(i)||selected.some(j=>isAxisAncestor(rows[i],rows[j])));
   ranked={shownLeaves:selected.length,hiddenLeaves:leaf.length-selected.length};
 }
 const exactValues=indices.map(i=>result[i].map((value,j)=>{
   const m=pivot.measures[j%width];
   if(m.showAs){
     const denominator=m.showAs==='grand'?raw[grandRow][grandCol*width+j%width]:m.showAs==='row'?raw[i][grandCol*width+j%width]:raw[grandRow][j];
     value=fixedArithmetic(value,denominator,'/',factor);
   }
   return value===null?null:fixedString(value,scale);
 }));
 // Keep the legacy numeric shape but never expose rounded binary values as exact.
 return {rows:indices.map(i=>rows[i]),columns,values:exactValues.map(row=>row.map(()=>null)),exactValues,financialScale:scale,...(ranked?{ranked}:{})};
}

export async function calculateFinancialPivot(pivot:PivotConfig,field:(name:string)=>string,from:string,r:string[],c:string[],rl:number[],cl:number[],nr:number,nc:number,query:Query,sortAxis:(a:PivotAxis,b:PivotAxis)=>number):Promise<PivotResult>{
 const scale=pivot.financialScale!,factor=decimalFactor(scale),width=pivot.measures.length;
 const expressions=new Map(pivot.measures.flatMap(m=>m.kind==='expression'||m.kind==='measure-expression'?[[m.id,parseExpression(m.formula,m.kind==='expression'?'row':'measure')] as const]:[]));
 const numericNames=new Set<string>(),distinctNames=new Set<string>();
 for(const m of pivot.measures){
   if(m.kind==='aggregate'){if(m.aggregate==='distinct')distinctNames.add(m.column);else if(m.aggregate!=='count')numericNames.add(m.column);}
   if(m.kind==='row')for(const o of [m.expression.left,m.expression.right]){if(o.kind==='column')numericNames.add(o.column);else parseFixed(String(o.value),scale);}
   if(m.kind==='expression')for(const name of expressionRefs(expressions.get(m.id)!))numericNames.add(name);
 }
 const inputs=[...new Set([...numericNames,...distinctNames])],aliases=new Map(inputs.map((name,i)=>[name,'v'+i]));
 // Bound each Arrow batch even if source contains very long text cells. Reject truncated values, never use them.
 const projection=[...r.map((q,i)=>q+' AS r'+i),...c.map((q,i)=>q+' AS k'+i),...inputs.map((n,i)=>'left('+field(n)+','+(distinctNames.has(n)?FINANCIAL_LIMITS.distinctLength+1:129)+') AS v'+i)];
 if(!projection.length)projection.push('1 AS present');
 const rowMap=new Map<string,PivotAxis>(),colMap=new Map<string,PivotAxis>(),groups=new Map<string,Acc[]>();
 const grand:PivotAxis={level:0,labels:[]};
 rowMap.set(axisKey(grand),grand);colMap.set(axisKey(grand),grand);
 groups.set(cellKey(grand,grand),Array.from({length:width},accumulator));
 let count=0,distinctEntries=0,distinctChars=0;
 const baseMeasures=pivot.measures.map((m,i)=>({m,i})).filter(({m})=>m.kind==='aggregate'||m.kind==='row'||m.kind==='expression');
 for(let offset=0;;offset+=FINANCIAL_LIMITS.batch){
   const batch=Array.from(await query('SELECT '+projection.join(', ')+from+' ORDER BY rowid LIMIT '+FINANCIAL_LIMITS.batch+' OFFSET '+offset));
   if(batch.length>FINANCIAL_LIMITS.batch||count+batch.length>LIMITS.rows)throw Error('PIVOT_DECIMAL_LIMIT: Vượt giới hạn dòng.');
   for(const item of batch){
     count++;
     const row=item as Record<string,unknown>,get=(n:string)=>{const v=row[aliases.get(n)!];return v==null?null:String(v);};
     const parsed=new Map<string,Fixed>();
     for(const name of numericNames){
       const raw=get(name);
       try{parsed.set(name,raw===null?null:parseFixed(raw,scale));}
       catch(e){if(e instanceof Error&&e.message.startsWith('PIVOT_DECIMAL_'))throw Error(e.message+' Cột '+name+', bản ghi sau lọc '+count+'.');throw e;}
     }
     const read=(n:string):Fixed=>parsed.get(n)??null;
     const operand=(o:Operand):Fixed=>o.kind==='column'?read(o.column):parseFixed(String(o.value),scale);
     const vals=baseMeasures.map(({m})=>{
       if(m.kind==='aggregate'){
         if(m.aggregate==='count')return {number:factor,text:null};
         if(m.aggregate==='distinct'){
           const text=get(m.column);
           if(text!==null&&Array.from(text).length>FINANCIAL_LIMITS.distinctLength)throw Error('PIVOT_DECIMAL_DISTINCT_LIMIT: Giá trị DISTINCT vượt 240 ký tự.');
           return {number:null,text};
         }
         return {number:read(m.column),text:null};
       }
       if(m.kind==='row')return {number:fixedArithmetic(operand(m.expression.left),operand(m.expression.right),m.expression.op,factor),text:null};
       if(m.kind==='expression')return {number:evaluateFixed(expressions.get(m.id)!,read,scale),text:null};
       throw Error('PIVOT_DECIMAL_INVALID: Chỉ số không hợp lệ.');
     });
     const axis=(prefix:string,n:number):PivotAxis=>({level:n,labels:Array.from({length:n},(_,i)=>row[prefix+i]==null?null:String(row[prefix+i]))});
     const ras=rl.map(n=>axis('r',n)),cas=cl.map(n=>axis('k',n));
     for(const a of ras)rowMap.set(axisKey(a),a);
     for(const a of cas)colMap.set(axisKey(a),a);
     if(rowMap.size>nr||colMap.size>nc)throw Error('PIVOT_CELL_LIMIT: Số nhóm vượt giới hạn.');
     for(const a of ras)for(const b of cas){
       const key=cellKey(a,b);let stats=groups.get(key);
       if(!stats){stats=Array.from({length:width},accumulator);groups.set(key,stats);}
       if(groups.size*width>PIVOT_LIMITS.cells)throw Error('PIVOT_CELL_LIMIT: Ma trận vượt giới hạn.');
       baseMeasures.forEach(({m,i},j)=>{
         const s=stats![i],v=vals[j];
         if(m.kind==='aggregate'&&m.aggregate==='distinct'){
           if(v.text===null)return;
           const set=s.distinct??(s.distinct=new Set<string>());
           if(!set.has(v.text)){
             distinctEntries++;distinctChars+=v.text.length;
             if(distinctEntries>FINANCIAL_LIMITS.distinctEntries||distinctChars>FINANCIAL_LIMITS.distinctChars)throw Error('PIVOT_DECIMAL_DISTINCT_LIMIT: DISTINCT vượt ngân sách bộ nhớ; hãy giảm nhóm hoặc bộ lọc.');
             set.add(v.text);
           }
           return;
         }
         if(v.number===null)return;
         s.count++;s.sum+=v.number;
         if(s.min===null||v.number<s.min)s.min=v.number;
         if(s.max===null||v.number>s.max)s.max=v.number;
       });
     }
   }
   if(batch.length<FINANCIAL_LIMITS.batch)break;
 }
 const rows=[...rowMap.values()].sort(sortAxis),columns=[...colMap.values()].sort(sortAxis);
 function values(stats:Acc[]|undefined):Fixed[]{
   const byId=new Map<string,Fixed>();
   return pivot.measures.map((m,i)=>{
     const s=stats?.[i]??accumulator();let v:Fixed=null;
     if(m.kind==='formula')v=fixedArithmetic(byId.get(m.left)??null,byId.get(m.right)??null,m.op,factor);
     else if(m.kind==='measure-expression')v=evaluateFixed(expressions.get(m.id)!,n=>byId.get(n)??null,scale);
     else if(m.kind!=='time'){
       switch(m.aggregate){
         case 'count':v=BigInt(s.count)*factor;break;
         case 'distinct':v=BigInt(s.distinct?.size??0)*factor;break;
         case 'sum':v=s.count?s.sum:null;break;
         case 'avg':v=s.count?roundedDivide(s.sum,BigInt(s.count)):null;break;
         case 'min':v=s.min;break;
         case 'max':v=s.max;break;
       }
     }
     if(v!==null)v=decimalBound(v);byId.set(m.id,v);return v;
   });
 }
 const raw=rows.map(a=>columns.flatMap(b=>values(groups.get(cellKey(a,b)))));
 return finishFinancial(pivot,rows,columns,raw);
}
