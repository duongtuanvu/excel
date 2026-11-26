import {useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {DASHBOARD_LIMITS,WIDGET_TYPES,WIDGET_LABELS,newWidget,moveWidget,dashboardSourceIds,dashboardQueryKey,validateDashboard} from './dashboard-model';
import type {Dashboard,DashboardWidget,DataWidget,WidgetData,WidgetType,DashboardFilter} from './dashboard-model';
import type {ManagedSource} from './source-model';
import type {SavedWorkspace} from './workspace-model';
import type {Config,Column,Aggregate} from './model';
import {AGGREGATIONS,defaultConfig} from './model';
import {pivotMatrix,effectivePivotFormat} from './pivot-config';
import {formatFixed} from './financial-decimal';
import PeriodPanel from './PeriodPanel';
import type {RunPeriod} from './PeriodPanel';
type Props={active:ManagedSource|null;sources:ManagedSource[];config:Config;workspace:SavedWorkspace|null;saved:Dashboard[];disabled:boolean;onQuery:(d:Dashboard)=>Promise<WidgetData[]>;onSave:(d:Dashboard[])=>Promise<void>;onRun:(d:Dashboard,...args:Parameters<RunPeriod>)=>ReturnType<RunPeriod>;onClose:()=>void};
const fmt=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2});
const display=(n:number|null)=>n===null?'—':fmt.format(n);
const colors=['#16836b','#3278c6','#e19b39','#8a65c7','#dd6a70','#5a9d9c'];
const blank=():Dashboard=>({version:1,id:crypto.randomUUID(),title:'Dashboard mới',theme:'light',widgets:[]});
function Chart({type,data}:{type:'bar'|'line'|'pie';data:Extract<WidgetData,{status:'ready'}>}){
 const groups=data.groups,label=(i:number)=>groups[i].labels.map(v=>v??'(Trống)').join(' / ')||'Tất cả';
 if(!groups.length)return <p className="dash-empty">Không có dữ liệu.</p>;
 const max=Math.max(0,...groups.map(g=>Math.abs(g.value??0)))||1;
 if(type==='bar')return <div className="dash-bars">{groups.map((g,i)=><div key={i}><span title={label(i)}>{label(i)}</span><div className="dash-track"><i style={{width:Math.abs(g.value??0)/max*100+'%',background:(g.value??0)<0?'#dd6a70':undefined}}/></div><strong>{display(g.value)}</strong></div>)}</div>;
 if(type==='pie'){
  const total=groups.reduce((s,g)=>s+(g.value??0),0);let start=0;
  const stops=groups.map((g,i)=>{const a=start;start+=(g.value??0)/total*100;return colors[i%colors.length]+' '+a+'% '+Math.min(100,start)+'%';});
  return <div className="dash-pie-wrap"><div className="dash-pie" role="img" aria-label="Tỷ trọng các nhóm" style={{background:'conic-gradient('+stops.join(',')+')'}}/><div className="dash-legend">{groups.map((g,i)=><div key={i}><i style={{background:colors[i%colors.length]}}/><span>{label(i)}</span><strong>{fmt.format((g.value??0)/total*100)}%</strong></div>)}</div></div>;
 }
 const min=Math.min(0,...groups.map(g=>g.value??0)),hi=Math.max(0,...groups.map(g=>g.value??0)),range=hi-min||1;
 const xy=(v:number,i:number)=>[24+i*272/Math.max(1,groups.length-1),112-(v-min)/range*94];
 const segments:number[][][]=[];let segment:number[][]=[];
 groups.forEach((g,i)=>{if(g.value===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(xy(g.value,i));});if(segment.length)segments.push(segment);
 return <div className="dash-line"><svg viewBox="0 0 320 136" role="img" aria-label="Biểu đồ đường theo nhóm"><line x1="24" y1={xy(0,0)[1]} x2="296" y2={xy(0,0)[1]} stroke="currentColor" opacity=".2"/>{segments.map((s,i)=><polyline key={i} points={s.map(p=>p.join(',')).join(' ')} fill="none" stroke="#16836b" strokeWidth="2.5"/>)}{groups.map((g,i)=>{if(g.value===null)return null;const [x,y]=xy(g.value,i);return <circle key={i} cx={x} cy={y} r="3.5" fill="#16836b"><title>{label(i)}: {display(g.value)}</title></circle>;})}</svg><div className="dash-line-labels"><span>{label(0)}</span><span>{label(groups.length-1)}</span></div><details><summary>Giá trị từng nhóm</summary>{groups.map((g,i)=><div key={i}>{label(i)}: {display(g.value)}</div>)}</details></div>;
}
function Content({widget,data}:{widget:DashboardWidget;data?:WidgetData}){
 if(widget.type==='text')return <p className="dash-text">{widget.body}</p>;
 if(!data)return <p className="dash-empty">Chờ dữ liệu…</p>;
 if(data.status==='error')return <p className="dash-error" role="alert">{data.error}</p>;
 if(widget.type==='kpi')return <div className="dash-kpi"><strong data-testid="dashboard-kpi">{display(data.total)}</strong><small>{fmt.format(data.filtered)} dòng · {widget.config.aggregate.toUpperCase()}</small></div>;
 if(widget.type==='pivot'){
  const p=widget.config.pivot!,result=data.pivot;
  if(!result)return <p className="dash-empty">Chưa có Pivot.</p>;
  const matrix=pivotMatrix(p,result),offset=1+p.rows.length;
  return <div className="dash-scroll"><table><thead><tr>{matrix[0].map((v,i)=><th key={i}>{v}</th>)}</tr></thead><tbody>{matrix.slice(1,31).map((row,i)=><tr key={i}>{row.map((v,j)=>{const m=p.measures[(j-offset)%p.measures.length];return <td key={j}>{v===null?'—':j>=offset&&m&&result.exactValues&&typeof v==='string'?formatFixed(v,result.financialScale!,m.decimals,effectivePivotFormat(m)):typeof v==='number'?display(v):v}</td>;})}</tr>)}</tbody></table>{matrix.length>31&&<small>Hiển thị 30/{matrix.length-1} nhóm; mở báo cáo Pivot để xem đầy đủ.</small>}</div>;
 }
 if(widget.type==='table')return <div className="dash-scroll"><table><thead><tr><th>Nhóm</th><th>Giá trị</th><th>Số dòng</th></tr></thead><tbody>{data.groups.map((g,i)=><tr key={i}><td>{g.labels.map(v=>v??'(Trống)').join(' / ')||'Tất cả'}</td><td>{display(g.value)}</td><td>{fmt.format(g.count)}</td></tr>)}</tbody></table>{data.truncated&&<small>Chỉ hiện 30 nhóm đầu theo thứ tự báo cáo.</small>}</div>;
 return <><Chart type={widget.type} data={data}/>{data.truncated&&<small>Chỉ hiện 30 nhóm đầu theo thứ tự báo cáo.</small>}</>;
}
export default function DashboardDesigner(props:Props){
 const {active,sources,config,workspace,saved,disabled,onQuery,onSave,onRun,onClose}=props;
 const [draft,setDraft]=useState<Dashboard>(()=>saved[0]??blank());
 const [editing,setEditing]=useState(true),[selected,setSelected]=useState<string|null>(null),[drag,setDrag]=useState<string|null>(null);
 const [data,setData]=useState<{key:string;rows:WidgetData[]}|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const alive=useRef(true),queryRef=useRef(onQuery);queryRef.current=onQuery;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const key=dashboardQueryKey(draft)+'|'+JSON.stringify(sources.map(s=>[s.slotId,s.id,s.revision,!!s.stale]))+'|'+refresh;
 const latest=useRef(key);latest.current=key;
 const shown=data?.key===key?data.rows:[];
 const busy=disabled||pending;
 useEffect(()=>{
  if(disabled||pending||data?.key===key)return;
  let cancelled=false;
  const timer=window.setTimeout(()=>{
   if(cancelled||latest.current!==key)return;
   setPending(true);setError('');
   void queryRef.current(draft).then(rows=>{if(alive.current&&latest.current===key)setData({key,rows});}).catch(e=>{if(alive.current&&latest.current===key){setError(e instanceof Error?e.message:'DASHBOARD_QUERY_FAILED');setData({key,rows:[]});}}).finally(()=>{if(alive.current)setPending(false);});
  },220);
  return()=>{cancelled=true;window.clearTimeout(timer);};
 },[key,disabled,pending,data?.key]);
 const widget=draft.widgets.find(w=>w.id===selected);
 const dirty=JSON.stringify(saved.find(d=>d.id===draft.id))!==JSON.stringify(draft);
 const ids=dashboardSourceIds(draft);
 const allSaved=ids.every(id=>[...(workspace?.slots??[]),...(workspace?.models??[])].some(s=>s.id===id));
 const available=sources.filter(s=>!s.stale);
 const sourceOf=(id:string)=>available.find(s=>s.slotId===id);
 const patch=(v:Partial<Dashboard>)=>{setDraft(d=>({...d,...v}));setNotice('');};
 const editWidget=(w:DashboardWidget)=>patch({widgets:draft.widgets.map(v=>v.id===w.id?w:v)});
 const editConfig=(w:DataWidget,changes:Partial<Config>)=>editWidget({...w,config:{...w.config,...changes}});
 function add(type:WidgetType){
  try{if(draft.widgets.length>=DASHBOARD_LIMITS.widgets)throw Error('DASHBOARD_LIMIT: Tối đa 12 widget.');
   if(type==='pivot'&&draft.widgets.filter(w=>w.type==='pivot').length>=DASHBOARD_LIMITS.pivots)throw Error('DASHBOARD_LIMIT: Tối đa 3 Pivot.');
   const s=active&&!active.stale?active:available[0],w=newWidget(type,crypto.randomUUID(),s,s?.id===active?.id?config:undefined);
   patch({widgets:[...draft.widgets,w]});setSelected(w.id);setError('');
  }catch(e){setError(e instanceof Error?e.message:'DASHBOARD_INVALID');}
 }
 function switchDraft(d:Dashboard){if(dirty&&draft.widgets.length&&!window.confirm('Bỏ thay đổi Dashboard chưa lưu?'))return;setDraft(d);setSelected(null);setNotice('');setError('');}
 async function save(remove=false){
  if(busy)return;
  setPending(true);setError('');setNotice('');
  try{
   const next=remove?saved.filter(d=>d.id!==draft.id):[...saved.filter(d=>d.id!==draft.id),validateDashboard(draft)];
   await onSave(next);if(remove){setDraft(next[0]??blank());setSelected(null);}
   setNotice(remove?'Đã xóa Dashboard.':'Đã lưu Dashboard vào tài khoản.');
  }catch(e){setError(e instanceof Error?e.message:'DASHBOARD_SAVE_FAILED');}finally{setPending(false);}
 }
 const filterColumns=ids.length?available.find(s=>s.slotId===ids[0])?.columns.filter(c=>ids.every(id=>sourceOf(id)?.columns.some(v=>v.name===c.name)))??[]:[];
 const setFilter=(v:DashboardFilter|undefined)=>patch({filter:v});
 const configColumns:Column[]=widget&&widget.type!=='text'?sourceOf(widget.slotId)?.columns??[]:[];
 const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.getElementById('dashboard-designer')?.requestFullscreen();}catch{setError('DASHBOARD_FULLSCREEN: Trình duyệt không hỗ trợ chế độ toàn màn hình.');}};
 return <section id="dashboard-designer" className={'dash-designer dash-'+draft.theme} aria-label="Dashboard Designer">
 <div className="dash-header"><div><small>DASHBOARD STUDIO / LOCAL-FIRST</small><h1>{draft.title||'Dashboard'}</h1><p>{draft.widgets.length}/12 widget · {ids.length} nguồn · {dirty?'Chưa lưu':'Đã lưu'}</p></div><div className="dash-actions"><button className="button" disabled={busy} onClick={()=>{if(!dirty||!draft.widgets.length||window.confirm('Rời Dashboard? Bố cục chưa lưu sẽ bị bỏ.'))onClose();}}>Về báo cáo</button><button className="button" onClick={()=>setEditing(v=>!v)} disabled={busy}>{editing?'Trình chiếu':'Chỉnh sửa Dashboard'}</button><button className="button" onClick={()=>void fullscreen()}>Toàn màn hình</button><button className="button primary" disabled={busy||!draft.widgets.length} onClick={()=>void save()}>Lưu Dashboard</button></div></div>
 <div className="dash-toolbar"><label className="field"><span>Dashboard đã lưu</span><select aria-label="Dashboard đã lưu" value={saved.some(d=>d.id===draft.id)?draft.id:''} disabled={busy} onChange={e=>{const d=saved.find(v=>v.id===e.target.value);if(d)switchDraft(d);}}><option value="">Dashboard chưa lưu</option>{saved.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></label><button className="button" disabled={busy||saved.length>=DASHBOARD_LIMITS.dashboards} onClick={()=>switchDraft(blank())}>Dashboard mới</button><button className="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Làm mới Dashboard</button>{saved.some(d=>d.id===draft.id)&&<button className="button danger-button" disabled={busy} onClick={()=>{if(window.confirm('Xóa Dashboard đã lưu? Nguồn dữ liệu vẫn giữ nguyên.'))void save(true);}}>Xóa Dashboard</button>}</div>
 {workspace&&allSaved&&ids.length>0&&<PeriodPanel key={JSON.stringify([draft.id,ids,workspace,dashboardQueryKey(draft)])} saved={workspace} disabled={busy} outputIds={ids} onRun={(...args)=>onRun(draft,...args)}/>}
 {error&&<p className="dash-error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}{pending&&<p role="status" className="dash-empty">Đang xử lý Dashboard…</p>}
 <div className="dash-filter"><strong>Bộ lọc chung</strong><select aria-label="Cột lọc Dashboard" disabled={busy} value={draft.filter?.column??''} onChange={e=>setFilter(e.target.value?{column:e.target.value,operator:'eq',value:''}:undefined)}><option value="">Không lọc</option>{draft.filter&&!filterColumns.some(c=>c.name===draft.filter?.column)&&<option value={draft.filter.column}>{draft.filter.column} (chưa nạp)</option>}{filterColumns.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select>{draft.filter&&<><select aria-label="Điều kiện lọc Dashboard" disabled={busy} value={draft.filter.operator} onChange={e=>setFilter({...draft.filter!,operator:e.target.value as DashboardFilter['operator']})}><option value="eq">Bằng</option><option value="contains">Chứa</option></select><input aria-label="Giá trị lọc Dashboard" disabled={busy} maxLength={1000} value={draft.filter.value} onChange={e=>setFilter({...draft.filter!,value:e.target.value})}/><button className="button" disabled={busy} onClick={()=>setFilter(undefined)}>Bỏ lọc Dashboard</button></>}</div>
 <div className={'dash-layout'+(editing?' editing':'')}>
 {editing&&<aside className="dash-inspector"><h2>Thiết kế</h2><label className="field"><span>Tên Dashboard</span><input aria-label="Tên Dashboard" value={draft.title} maxLength={100} disabled={busy} onChange={e=>patch({title:e.target.value})}/></label><label className="field"><span>Giao diện</span><select value={draft.theme} disabled={busy} onChange={e=>patch({theme:e.target.value as Dashboard['theme']})}><option value="light">Sáng</option><option value="dark">Tối</option></select></label><h3>Thêm thành phần</h3><div className="dash-add">{WIDGET_TYPES.map(t=><button key={t} className="button" disabled={busy||draft.widgets.length>=DASHBOARD_LIMITS.widgets||(t!=='text'&&!available.length)||(t==='pivot'&&draft.widgets.filter(w=>w.type==='pivot').length>=DASHBOARD_LIMITS.pivots)} onClick={()=>add(t)}>+ {WIDGET_LABELS[t]}</button>)}</div>
 {widget&&<div className="dash-fields"><h3>Cấu hình widget</h3><label className="field"><span>Tiêu đề widget</span><input aria-label="Tiêu đề widget" maxLength={100} value={widget.title} disabled={busy} onChange={e=>editWidget({...widget,title:e.target.value})}/></label><div className="dash-actions"><label className="field"><span>Rộng</span><select aria-label="Chiều rộng widget" value={widget.width} disabled={busy} onChange={e=>editWidget({...widget,width:Number(e.target.value)})}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label><label className="field"><span>Cao</span><select aria-label="Chiều cao widget" value={widget.height} disabled={busy} onChange={e=>editWidget({...widget,height:Number(e.target.value)})}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label></div>
 {widget.type==='text'?<label className="field"><span>Nội dung</span><textarea rows={5} maxLength={1000} value={widget.body} disabled={busy} onChange={e=>editWidget({...widget,body:e.target.value})}/></label>:<>
 <label className="field"><span>Nguồn widget</span><select aria-label="Nguồn widget" value={widget.slotId} disabled={busy} onChange={e=>{const s=sourceOf(e.target.value);if(!s)return;const next=newWidget(widget.type,widget.id,s,s.id===active?.id?config:undefined) as DataWidget;editWidget({...next,title:widget.title,width:widget.width,height:widget.height});}}>{!sourceOf(widget.slotId)&&<option value={widget.slotId}>Chưa nạp nguồn</option>}{available.map(s=><option key={s.id} value={s.slotId}>{s.alias}</option>)}</select></label>
 {widget.type==='pivot'?<p className="profile-note">Dùng cấu hình Pivot của báo cáo lúc thêm widget. Chỉnh Pivot ở màn hình báo cáo rồi thêm lại widget nếu cần.</p>:<>
 <label className="field"><span>Phép tổng hợp</span><select aria-label="Phép tổng hợp widget" value={widget.config.aggregate} disabled={busy} onChange={e=>{const aggregate=e.target.value as Aggregate;editConfig(widget,{aggregate,metric:aggregate==='count'?'':(aggregate==='distinct'?configColumns[0]:configColumns.find(c=>c.kind==='number'))?.name??''});}}>{AGGREGATIONS.filter(a=>widget.type!=='pie'||a==='sum'||a==='count').map(a=><option key={a} value={a} disabled={a!=='count'&&a!=='distinct'&&!configColumns.some(c=>c.kind==='number')}>{a.toUpperCase()}</option>)}</select></label>
 {widget.config.aggregate!=='count'&&<label className="field"><span>Cột giá trị</span><select aria-label="Cột giá trị widget" value={widget.config.metric} disabled={busy} onChange={e=>editConfig(widget,{metric:e.target.value})}>{(widget.config.aggregate==='distinct'?configColumns:configColumns.filter(c=>c.kind==='number')).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>}
 {widget.type!=='kpi'&&<label className="field"><span>Nhóm dữ liệu (một trường)</span><select aria-label="Nhóm widget" value={widget.config.groups[0]??''} disabled={busy} onChange={e=>editConfig(widget,{groups:e.target.value?[e.target.value]:[]})}>{widget.type!=='line'&&widget.type!=='pie'&&<option value="">Không nhóm</option>}{configColumns.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>}</>}
 <small>Giữ bộ lọc riêng lúc thêm widget; bộ lọc chung áp dụng AND.</small></>}
 <button className="button danger-button" disabled={busy} onClick={()=>{patch({widgets:draft.widgets.filter(w=>w.id!==widget.id)});setSelected(null);}}>Xóa widget đang chọn</button></div>}
 </aside>}
 <div className="dash-canvas" aria-label="Bố cục Dashboard">{!draft.widgets.length&&<div className="dash-empty dash-placeholder">Thêm KPI, biểu đồ hoặc bảng để bắt đầu thiết kế.</div>}{draft.widgets.map((w,i)=><article key={w.id} className={'dash-widget'+(editing&&selected===w.id?' selected':'')+(drag===w.id?' dragging':'')} style={{'--widget-width':w.width,'--widget-height':w.height} as CSSProperties} onDragOver={e=>{if(editing&&drag&&!busy)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(drag&&!busy)patch({widgets:moveWidget(draft.widgets,drag,w.id)});setDrag(null);}}><header><button type="button" className="dash-widget-title" disabled={!editing||busy} onClick={()=>setSelected(w.id)} aria-label={'Chọn widget '+w.title}>{w.title}</button>{editing&&<div className="dash-widget-controls"><button className="dash-grip" draggable={!busy} disabled={busy} aria-label={'Kéo widget '+w.title} onDragStart={e=>{e.dataTransfer.setData('text/plain',w.id);e.dataTransfer.effectAllowed='move';setDrag(w.id);}} onDragEnd={()=>setDrag(null)}>⠿</button><button disabled={busy||i===0} aria-label={'Đưa widget '+w.title+' lên'} onClick={()=>patch({widgets:moveWidget(draft.widgets,w.id,draft.widgets[i-1].id)})}>↑</button><button disabled={busy||i===draft.widgets.length-1} aria-label={'Đưa widget '+w.title+' xuống'} onClick={()=>patch({widgets:moveWidget(draft.widgets,w.id,draft.widgets[i+1].id)})}>↓</button></div>}</header><div className="dash-content"><Content widget={w} data={shown.find(v=>v.id===w.id)}/></div>{w.type!=='text'&&<small className="dash-source">{sourceOf(w.slotId)?.alias??'Nguồn chưa nạp'}{w.type!=='pivot'?' · DOUBLE':''}</small>}</article>)}</div></div>
 <p className="dash-footer">Chỉ lưu cấu hình và tên cột/bộ lọc vào tài khoản; không lưu workbook hoặc kết quả. Widget cập nhật theo nguồn đang nạp. Chạy kỳ mới kiểm tra toàn bộ Dashboard trước khi cập nhật.</p>
 </section>;
}
