import {arithmetic} from './pivot-config.ts';
import type {PivotAxis,PivotConfig,PivotResult} from './pivot-config.ts';
export function pivotAxisKey(a:PivotAxis):string{return JSON.stringify([a.level,a.labels]);}
export function isAxisAncestor(parent:PivotAxis,child:PivotAxis):boolean{
 return parent.level>0&&parent.level<child.level&&parent.labels.every((v,i)=>v===child.labels[i]);
}
export function visiblePivotIndices(axes:PivotAxis[],collapsed:ReadonlySet<string>):number[]{
 const parents=axes.filter(a=>collapsed.has(pivotAxisKey(a)));
 return axes.flatMap((a,i)=>parents.some(p=>isAxisAncestor(p,a))?[]:[i]);
}
export function applyPivotAnalytics(pivot:PivotConfig,result:PivotResult):PivotResult{
 const grandRow=result.rows.findIndex(a=>a.level===0),grandCol=result.columns.findIndex(a=>a.level===0);
 if(grandRow<0||grandCol<0)throw Error('PIVOT_RESULT_INVALID: Thiếu tổng cộng.');
 const width=pivot.measures.length,raw=result.values;
 let indices=result.rows.map((_,i)=>i),ranked:PivotResult['ranked'];
 if(pivot.topN){
   const top=pivot.topN,measure=pivot.measures.findIndex(m=>m.id===top.measureId);
   if(measure<0)throw Error('PIVOT_INVALID: Thiếu chỉ số Top N.');
   const leaf=indices.filter(i=>result.rows[i].level===pivot.rows.length);
   const score=(i:number)=>raw[i][grandCol*width+measure];
   const selected=leaf.filter(i=>score(i)!==null).sort((a,b)=>score(b)!-score(a)!||a-b).slice(0,top.count);
   const kept=new Set(selected);
   // Keep real parent totals, not a subtotal computed from the visible children.
   indices=pivot.rows.length===1?[...selected,grandRow]:indices.filter(i=>i===grandRow||kept.has(i)||selected.some(j=>isAxisAncestor(result.rows[i],result.rows[j])));
   ranked={shownLeaves:selected.length,hiddenLeaves:leaf.length-selected.length};
 }
 const values=indices.map(i=>raw[i].map((value,j)=>{
   const m=pivot.measures[j%width];
   if(!m.showAs)return value;
   const denominator=m.showAs==='grand'?raw[grandRow][grandCol*width+j%width]:m.showAs==='row'?raw[i][grandCol*width+j%width]:raw[grandRow][j];
   return arithmetic(value,denominator,'/');
 }));
 return {...result,rows:indices.map(i=>result.rows[i]),values,...(ranked?{ranked}:{})};
}
