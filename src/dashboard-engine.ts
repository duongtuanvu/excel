import {compileReport} from './model.ts';
import type {Column,Group} from './model.ts';
import {calculatePivot} from './pivot-engine.ts';
import {DASHBOARD_LIMITS,widgetConfig} from './dashboard-model.ts';
import type {DataWidget,DashboardFilter,WidgetData} from './dashboard-model.ts';
type Query=(sql:string)=>Promise<Iterable<unknown>>;
function number(value:unknown):number|null{if(value==null)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function count(value:unknown):number{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('DASHBOARD_RESULT_INVALID: Số dòng không hợp lệ.');return n;}
export async function queryWidget(widget:DataWidget,filter:DashboardFilter|undefined,columns:Column[],table:string,query:Query):Promise<Extract<WidgetData,{status:'ready'}>>{
 const config=widgetConfig(widget,filter,columns),compiled=compileReport(config,columns,table);
 const totalRow=Array.from(await query(compiled.totals))[0] as Record<string,unknown>|undefined;
 if(!totalRow)throw Error('DASHBOARD_RESULT_INVALID: Thiếu tổng hợp.');
 const total=number(totalRow.value),filtered=count(totalRow.n);
 if(widget.type==='pivot'){
  const pivot=await calculatePivot(config,columns,table,query);
  return {id:widget.id,status:'ready',total,filtered,groups:[],truncated:false,pivot};
 }
 if(widget.type==='kpi')return {id:widget.id,status:'ready',total,filtered,groups:[],truncated:false};
 const groups:Group[]=[];
 // Bound labels before transferring Arrow rows. Truncated labels are never used as filter values.
 const labels=config.groups.map((_,i)=>"CASE WHEN length(g"+i+")>"+DASHBOARD_LIMITS.label+" THEN left(g"+i+","+DASHBOARD_LIMITS.label+") || '…' ELSE g"+i+" END AS g"+i);
 const order=' ORDER BY value '+config.sort.toUpperCase()+' NULLS LAST'+(config.groups.length?', '+config.groups.map((_,i)=>'dashboard_groups.g'+i+' ASC NULLS LAST').join(', '):'');
 const sql='SELECT '+[...labels,'value','n'].join(', ')+' FROM ('+compiled.groups+') AS dashboard_groups'+order+' LIMIT '+(DASHBOARD_LIMITS.groups+1);
 for(const item of await query(sql)){
  const row=item as Record<string,unknown>;
  groups.push({labels:config.groups.map((_,i)=>row['g'+i]==null?null:String(row['g'+i])),value:number(row.value),count:count(row.n)});
 }
 const truncated=groups.length>DASHBOARD_LIMITS.groups;
 if(truncated&&(widget.type==='line'||widget.type==='pie'))throw Error('DASHBOARD_GROUP_LIMIT: Biểu đồ đường/tròn cần tối đa 30 nhóm; hãy lọc hoặc chọn trường khác.');
 const visible=groups.slice(0,DASHBOARD_LIMITS.groups);
 if(widget.type==='line')visible.sort((a,b)=>(a.labels[0]??'\uffff').localeCompare(b.labels[0]??'\uffff','vi',{numeric:true}));
 if(widget.type==='pie'&&(visible.some(g=>g.value===null||g.value<0)||!visible.some(g=>(g.value??0)>0)||!Number.isFinite(visible.reduce((s,g)=>s+(g.value??0),0))))throw Error('DASHBOARD_PIE_INVALID: Biểu đồ tròn cần giá trị không âm và tổng dương.');
 return {id:widget.id,status:'ready',total,filtered,groups:visible,truncated};
}
