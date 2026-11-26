import {compileReport,defaultConfig,LIMITS,validateTemplate} from './model.ts';
import type {Column,Config,Filter,Group} from './model.ts';
import type {PivotResult} from './pivot-config.ts';
import type {SavedWorkspace} from './workspace-model.ts';

export const DASHBOARD_LIMITS={dashboards:4,widgets:12,pivots:3,groups:30,text:1000,label:160,configBytes:192000} as const;
export const WIDGET_TYPES=['kpi','bar','line','pie','table','pivot','text'] as const;
export type WidgetType=typeof WIDGET_TYPES[number];
export const WIDGET_LABELS:Record<WidgetType,string>={kpi:'KPI',bar:'Biểu đồ cột',line:'Biểu đồ đường',pie:'Biểu đồ tròn',table:'Bảng tổng hợp',pivot:'Bảng Pivot',text:'Văn bản'};
type Layout={id:string;title:string;width:number;height:number};
export type DataWidget=Layout&{type:Exclude<WidgetType,'text'>;slotId:string;config:Config};
export type TextWidget=Layout&{type:'text';body:string};
export type DashboardWidget=DataWidget|TextWidget;
export type DashboardFilter={column:string;operator:'eq'|'contains';value:string};
export type Dashboard={version:1;id:string;title:string;theme:'light'|'dark';widgets:DashboardWidget[];filter?:DashboardFilter};
export type DashboardBinding={slotId:string;sourceId:string;revision:number};
export type WidgetData={id:string;status:'ready';total:number|null;filtered:number;groups:Group[];truncated:boolean;pivot?:PivotResult}|{id:string;status:'error';error:string};
const invalid=(detail:string)=>Error('DASHBOARD_INVALID: '+detail);
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw invalid('Cấu hình không hợp lệ.');return v as Record<string,unknown>;};
const uuid=(v:unknown):string=>{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))throw invalid('Mã định danh không hợp lệ.');return v;};
function text(v:unknown,max:number,empty=false):string{
 if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())||/[\u0000-\u001f\u007f]/.test(v))throw invalid('Tên hoặc văn bản không hợp lệ.');
 return v;
}
function integer(v:unknown,min:number,max:number):number{if(typeof v!=='number'||!Number.isInteger(v)||v<min||v>max)throw invalid('Kích thước widget không hợp lệ.');return v;}
export function dashboardSourceIds(d:Dashboard):string[]{return [...new Set(d.widgets.flatMap(w=>w.type==='text'?[]:[w.slotId]))];}
export function validateDashboard(input:unknown):Dashboard{
 const d=record(input),id=uuid(d.id),title=text(d.title,100).trim();
 if(d.version!==1||(d.theme!=='light'&&d.theme!=='dark')||!Array.isArray(d.widgets)||d.widgets.length>DASHBOARD_LIMITS.widgets)throw invalid('Tối đa 12 widget; phiên bản hoặc giao diện không hợp lệ.');
 const ids=new Set<string>();let pivots=0;
 const widgets:DashboardWidget[]=d.widgets.map(raw=>{
  const w=record(raw),wid=uuid(w.id),type=w.type as WidgetType;
  if(ids.has(wid)||!WIDGET_TYPES.includes(type))throw invalid('Widget trùng hoặc không hợp lệ.');
  ids.add(wid);
  const layout={id:wid,title:text(w.title,100).trim(),width:integer(w.width,1,4),height:integer(w.height,1,3)};
  if(type==='text'){
   if(typeof w.body!=='string'||w.body.length>DASHBOARD_LIMITS.text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(w.body))throw invalid('Văn bản không hợp lệ.');
   return {...layout,type,body:w.body};
  }
  const config=validateTemplate({version:1,config:w.config}).config;
  if(type==='pivot'){if(!config.pivot||++pivots>DASHBOARD_LIMITS.pivots)throw invalid('Cần cấu hình Pivot, tối đa 3 bảng Pivot.');}
  else if(config.pivot)throw invalid('Chỉ widget Pivot được chứa cấu hình Pivot.');
  if((type==='line'||type==='pie')&&config.groups.length!==1)throw invalid('Biểu đồ đường/tròn cần đúng một trường nhóm.');
  if(type==='pie'&&!['sum','count'].includes(config.aggregate))throw invalid('Biểu đồ tròn cần SUM hoặc COUNT cộng được.');
  return {...layout,type,slotId:uuid(w.slotId),config};
 });
 let filter:DashboardFilter|undefined;
 if(d.filter!==undefined){
  const v=record(d.filter);
  if(v.operator!=='eq'&&v.operator!=='contains')throw invalid('Bộ lọc chung chỉ dùng bằng hoặc chứa.');
  filter={column:text(v.column,240),operator:v.operator,value:text(v.value,1000,true)};
 }
 const result:Dashboard={version:1,id,title,theme:d.theme,widgets,...(filter?{filter}:{})};
 if(new TextEncoder().encode(JSON.stringify(result)).length>DASHBOARD_LIMITS.configBytes)throw invalid('Cấu hình vượt giới hạn.');
 return result;
}
export function validateDashboards(input:unknown,workspace:SavedWorkspace|null,schemas?:ReadonlyMap<string,Column[]>):Dashboard[]{
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>DASHBOARD_LIMITS.dashboards)throw invalid('Tối đa 4 dashboard.');
 const ids=new Set<string>(),names=new Set<string>(),slots=new Set([...(workspace?.slots??[]),...(workspace?.models??[])].map(s=>s.id));
 return input.map(value=>{
  const d=validateDashboard(value),name=d.title.toLocaleLowerCase('vi-VN');
  if(ids.has(d.id)||names.has(name))throw invalid('Tên hoặc mã dashboard bị trùng.');
  if(dashboardSourceIds(d).some(id=>!slots.has(id)))throw Error('DASHBOARD_SOURCE_MISSING: Nguồn widget chưa có trong workspace. Hãy lưu nguồn hoặc xóa widget.');
  if(schemas)for(const w of d.widgets){if(w.type==='text')continue;const cols=schemas.get(w.slotId);if(!cols)throw Error('DASHBOARD_SOURCE_MISSING: Thiếu schema nguồn '+w.title+'.');try{widgetConfig(w,d.filter,cols);}catch(e){throw Error('DASHBOARD_CONFIG_INVALID: '+w.title+' — '+(e instanceof Error?e.message:'Cấu hình không phù hợp.'));}}
  ids.add(d.id);names.add(name);return d;
 });
}
export function widgetConfig(widget:DataWidget,filter:DashboardFilter|undefined,columns:Column[]):Config{
 const config=validateTemplate({version:1,config:widget.config}).config;
 if(filter){
  if(!columns.some(c=>c.name===filter.column))throw Error('DASHBOARD_FILTER_MISSING: Thiếu cột lọc chung '+filter.column+'.');
  const f:Filter={...filter};
  if(config.filters.length>=LIMITS.filters)throw Error('DASHBOARD_FILTER_LIMIT: Widget đã dùng tối đa bộ lọc.');
  config.filters=[...config.filters,f];
 }
 compileReport(config,columns);
 return config;
}
export function newWidget(type:WidgetType,id:string,source?:{slotId:string;columns:Column[]},report?:Config):DashboardWidget{
 const layout={id,title:WIDGET_LABELS[type],width:type==='kpi'?1:type==='pivot'?4:2,height:type==='kpi'||type==='text'?1:2};
 if(type==='text')return {...layout,type,body:'Ghi chú báo cáo'};
 if(!source)throw Error('DASHBOARD_SOURCE_MISSING: Hãy nạp một nguồn dữ liệu.');
 const config=validateTemplate({version:1,config:report??defaultConfig(source.columns)}).config;
 if(type==='pivot'){
  if(!config.pivot){const n=source.columns.find(c=>c.kind==='number');config.pivot={version:1,rows:config.groups,columns:[],subtotals:true,measures:[{id:'m1',name:n?.name??'Số dòng',kind:'aggregate',aggregate:n?'sum':'count',column:n?.name??'',format:'number',decimals:2}]};}
 }else{
  delete config.pivot;
  if(type==='kpi')config.groups=[];
  if(type==='line'||type==='pie')config.groups=[config.groups[0]??source.columns[0]?.name].filter(Boolean);
  if(type==='pie'&&!['sum','count'].includes(config.aggregate)){config.aggregate='count';config.metric='';}
 }
 return {...layout,type,slotId:source.slotId,config};
}
export function moveWidget(widgets:DashboardWidget[],id:string,target:string):DashboardWidget[]{
 const from=widgets.findIndex(w=>w.id===id),to=widgets.findIndex(w=>w.id===target);
 if(from<0||to<0||from===to)return widgets;
 const next=[...widgets],item=next.splice(from,1)[0];next.splice(to,0,item);return next;
}
// Layout changes are independent from the data query fingerprint.
export function dashboardQueryKey(d:Dashboard):string{
 return JSON.stringify([d.filter??null,d.widgets.flatMap(w=>w.type==='text'?[]:[{id:w.id,type:w.type,slotId:w.slotId,config:w.config}]).sort((a,b)=>a.id.localeCompare(b.id))]);
}
