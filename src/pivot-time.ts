import type {CalendarGrain,PivotConfig,PivotResult,TimeOperation} from './pivot-config.ts';
import {arithmetic} from './pivot-config.ts';

export function calendarIndex(value:string|null,grain:CalendarGrain):number|null{
 if(value===null)return null;
 const match=(grain==='month'?/^(\d{4})-(0[1-9]|1[0-2])$/:/^(\d{4})$/).exec(value);
 if(!match||Number(match[1])<1)return null;
 return grain==='month'?Number(match[1])*12+Number(match[2])-1:Number(match[1]);
}
export function periodComparison(current:number|null,previous:number|null,operation:TimeOperation):number|null{
 if(operation==='previous'||operation==='prior-year')return previous;
 const delta=arithmetic(current,previous,'-');
 if(operation==='change')return delta;
 // Use the conventional signed prior-period denominator; zero -> NULL.
 return arithmetic(delta,previous,'/');
}
// Date bucket columns are computed by DuckDB. Missing calendar periods are never
// replaced with the nearest available period. Grand/undated columns are undefined.
export function applyTimeMeasures(pivot:PivotConfig,result:PivotResult):PivotResult{
 if(!pivot.calendar||!pivot.measures.some(m=>m.kind==='time'))return result;
 const grain=pivot.calendar,width=pivot.measures.length;
 const periods=new Map<number,number>();
 for(let i=0;i<result.columns.length;i++){
   const a=result.columns[i];
   if(a.level!==1||a.labels[0]===null)continue;
   const index=calendarIndex(a.labels[0],grain);
   if(index===null||periods.has(index))throw Error('PIVOT_TIME_RESULT_INVALID: Nhóm thời gian không hợp lệ.');
   periods.set(index,i);
 }
 const ordered=[...periods.entries()].sort((a,b)=>a[0]-b[0]),measureIndices=new Map(pivot.measures.map((m,i)=>[m.id,i]));
 const values=result.values.map(raw=>{
   const out=[...raw];
   for(let i=0;i<width;i++){
     const m=pivot.measures[i];if(m.kind!=='time')continue;
     const base=measureIndices.get(m.measureId);
     if(base===undefined||base>=i)throw Error('PIVOT_TIME_RESULT_INVALID: Thiếu chỉ số gốc.');
     for(let j=0;j<result.columns.length;j++)out[j*width+i]=null;
     let year=-1,acc:number|null=null,overflow=false;
     for(const [period,col] of ordered){
       const current=raw[col*width+base];
       let value:number|null;
       if(m.operation==='ytd'){
         const y=Math.floor(period/12);
         if(y!==year){year=y;acc=null;overflow=false;}
         if(current!==null&&!overflow){const next=arithmetic(acc??0,current,'+');if(next===null)overflow=true;acc=next;}
         value=overflow?null:acc;
       }else{
         const offset=(m.operation==='prior-year'||m.operation==='yoy-growth')&&grain==='month'?12:1;
         const prior=periods.get(period-offset);
         value=periodComparison(current,prior===undefined?null:raw[prior*width+base],m.operation);
       }
       out[col*width+i]=value;
     }
   }
   return out;
 });
 return {...result,values};
}
