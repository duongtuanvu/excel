import {useMemo,useRef,useState} from 'react';
import type {Column,Config,Aggregate} from './model';
import {PIVOT_LIMITS,PIVOT_AGGREGATES,PIVOT_OPERATORS,PIVOT_FORMATS,validatePivot,validatePivotColumns,axisLabel,pivotFormat} from './pivot-config';
import type {PivotConfig,PivotResult,PivotMeasure,PivotOp,PivotFormat,Operand} from './pivot-config';
type Props={config:Config;columns:Column[];result?:PivotResult;queryError:string;disabled:boolean;onPreview:(p:PivotConfig)=>Promise<PivotResult>;onApply:(p?:PivotConfig)=>void};
const labels:Record<Aggregate,string>={sum:'SUM · Tổng',count:'COUNT · Số dòng',avg:'AVG · Trung bình',min:'MIN · Nhỏ nhất',max:'MAX · Lớn nhất',distinct:'DISTINCT · Khác nhau'};
const ROW_PAGE=PIVOT_LIMITS.page,COL_PAGE=8;
const agg=(id:string,name:string,column:string):PivotMeasure=>({id,name,kind:'aggregate',aggregate:column?'sum':'count',column,format:'number',decimals:2});
function OperandEditor({value,onChange,columns,disabled,label}:{value:Operand;onChange:(o:Operand)=>void;columns:Column[];disabled:boolean;label:string}){
 return <div className="pivot-operand"><label className="field"><span>{label}</span><select aria-label={label} value={value.kind==='column'?value.column:''} disabled={disabled} onChange={e=>onChange(e.target.value?{kind:'column',column:e.target.value}:{kind:'constant',value:0})}><option value="">Hằng số</option>{columns.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>{value.kind==='constant'&&<input type="number" step="any" aria-label={label+' hằng số'} disabled={disabled} value={Number.isFinite(value.value)?value.value:''} onChange={e=>onChange({kind:'constant',value:e.target.valueAsNumber})}/>}</div>;
}
function Matrix({pivot,data}:{pivot:PivotConfig;data:PivotResult}){
 const [rp,setRp]=useState(0),[cp,setCp]=useState(0);
 const r=Math.min(rp,Math.max(0,Math.ceil(data.rows.length/ROW_PAGE)-1)),c=Math.min(cp,Math.max(0,Math.ceil(data.columns.length/COL_PAGE)-1));
 const visible=data.columns.slice(c*COL_PAGE,(c+1)*COL_PAGE),measures=pivot.measures;
 const formats=useMemo(()=>measures.map(m=>new Intl.NumberFormat('vi-VN',{minimumFractionDigits:m.decimals,maximumFractionDigits:m.decimals,...(m.format==='vnd'?{style:'currency',currency:'VND'}:m.format==='percent'?{style:'percent'}:{})})),[measures]);
 return <div className="pivot-output"><p className="profile-note" data-testid="pivot-size">{data.rows.length} nhóm hàng · {data.columns.length} nhóm cột · {measures.length} chỉ số</p><div className="table-scroll pivot-scroll"><table className="pivot-table" data-testid="pivot-matrix"><thead><tr><th rowSpan={2} scope="col">{pivot.rows.join(' / ')||'Tất cả dữ liệu'}</th>{visible.map((axis,i)=><th key={i} scope="colgroup" colSpan={measures.length}>{axisLabel(axis,pivot.columns.length)}</th>)}</tr><tr>{visible.flatMap((_,i)=>measures.map(m=><th key={i+':'+m.id} scope="col">{m.name}</th>))}</tr></thead><tbody>{data.rows.slice(r*ROW_PAGE,(r+1)*ROW_PAGE).map((a,i)=>{
  const values=data.values[r*ROW_PAGE+i];
  return <tr key={r*ROW_PAGE+i} className={a.level===0?'pivot-grand':a.level<pivot.rows.length?'pivot-subtotal':''}><th scope="row">{axisLabel(a,pivot.rows.length)}</th>{visible.flatMap((_,j)=>measures.map((m,k)=>{
    const v=values[(c*COL_PAGE+j)*measures.length+k];return <td key={j+':'+m.id} className="numeric">{v==null?'—':formats[k].format(v)}</td>;
  }))}</tr>;
 })}</tbody></table></div><div className="pivot-pagers"><div><button type="button" className="button" disabled={r===0} onClick={()=>setRp(r-1)}>Hàng trước</button><span>Hàng {r*ROW_PAGE+1}–{Math.min((r+1)*ROW_PAGE,data.rows.length)} / {data.rows.length}</span><button type="button" className="button" disabled={(r+1)*ROW_PAGE>=data.rows.length} onClick={()=>setRp(r+1)}>Hàng sau</button></div><div><button type="button" className="button" disabled={c===0} onClick={()=>setCp(c-1)}>Cột trước</button><span>Cột {c*COL_PAGE+1}–{Math.min((c+1)*COL_PAGE,data.columns.length)} / {data.columns.length}</span><button type="button" className="button" disabled={(c+1)*COL_PAGE>=data.columns.length} onClick={()=>setCp(c+1)}>Cột sau</button></div></div><p className="profile-note">NULL và phép chia 0 hiển thị —. COUNT/DISTINCT ở giao điểm không có dữ liệu bằng 0. Xuất Excel chứa toàn bộ ma trận, không chỉ trang hiện tại.</p></div>;
}
export default function PivotPanel({config,columns,result,queryError,disabled,onPreview,onApply}:Props){
 const numeric=columns.filter(c=>c.kind==='number'),first=numeric[0]?.name??'';
 const [open,setOpen]=useState(!!config.pivot),[draft,setDraft]=useState<PivotConfig>(()=>config.pivot??{version:1,rows:config.groups.slice(0,3),columns:[],measures:[agg('m1','Giá trị',first)],subtotals:true});
 const [preview,setPreview]=useState<PivotResult|null>(null),[checked,setChecked]=useState<Config|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const running=useRef(false),locked=disabled||pending;
 const applied=JSON.stringify(config.pivot)===JSON.stringify(draft),current=preview&&checked===config?preview:applied?result:undefined;
 const change=(v:Partial<PivotConfig>)=>{setDraft(d=>({...d,...v}));setPreview(null);setError('');};
 const updateMeasure=(i:number,m:PivotMeasure)=>change({measures:draft.measures.map((v,j)=>i===j?m:v)});
 const available=(axis:'rows'|'columns',i:number)=>columns.filter(c=>c.name===draft[axis][i]||![...draft.rows,...draft.columns].includes(c.name));
 const setAxis=(axis:'rows'|'columns',values:string[])=>change({[axis]:values});
 const addAxis=(axis:'rows'|'columns')=>{const v=available(axis,-1)[0];if(v)setAxis(axis,[...draft[axis],v.name]);};
 const moveAxis=(axis:'rows'|'columns',i:number,d:number)=>{const v=[...draft[axis]];[v[i],v[i+d]]=[v[i+d],v[i]];setAxis(axis,v);};
 function addMeasure(){const id='m'+(Math.max(0,...draft.measures.map(m=>Number(m.id.slice(1))))+1);change({measures:[...draft.measures,agg(id,'Chỉ số '+id.slice(1),first)]});}
 function changeKind(i:number,kind:PivotMeasure['kind']){
   const m=draft.measures[i],base={id:m.id,name:m.name,format:m.format,decimals:m.decimals};
   if(kind==='aggregate')updateMeasure(i,{...base,kind,aggregate:first?'sum':'count',column:first});
   else if(kind==='row')updateMeasure(i,{...base,kind,aggregate:'sum',expression:{left:first?{kind:'column',column:first}:{kind:'constant',value:1},op:'*',right:{kind:'constant',value:1}}});
   else if(i>0)updateMeasure(i,{...base,kind,left:draft.measures[0].id,op:'/',right:draft.measures[Math.max(0,i-1)].id});
 }
 async function check(){
   if(locked||running.current)return;
   running.current=true;setPending(true);setError('');setPreview(null);
   try{const p=validatePivot(draft)!;validatePivotColumns(p,columns);setPreview(await onPreview(p));setChecked(config);}
   catch(e){setError(e instanceof Error?e.message:'PIVOT_QUERY_FAILED: Không thể kiểm tra ma trận.');}
   finally{running.current=false;setPending(false);}
 }
 function apply(){
   if(locked||!preview||checked!==config)return;
   try{onApply(validatePivot(draft));setPreview(null);}catch(e){setError(e instanceof Error?e.message:'PIVOT_INVALID');}
 }
 return <section className="report-card schema-card pivot-card" aria-label="Pivot nâng cao"><div className="card-heading"><div><h2>Pivot nâng cao</h2><p>Ma trận nhiều chiều · Calculated Fields · Tổng phụ</p></div><button type="button" className="button" disabled={locked} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'Thu gọn Pivot':'Mở Pivot'}</button></div>
 {open&&<div className="schema-body"><div className="pivot-axes">{(['rows','columns'] as const).map(axis=>{
   const title=axis==='rows'?'Hàng':'Cột',max=axis==='rows'?PIVOT_LIMITS.rowFields:PIVOT_LIMITS.columnFields;
   return <div className="pivot-axis" key={axis}><strong>{title} · {draft[axis].length}/{max}</strong>{draft[axis].map((n,i)=><div className="pivot-axis-row" key={i}><select aria-label={title+' Pivot '+(i+1)} value={n} disabled={locked} onChange={e=>setAxis(axis,draft[axis].map((x,j)=>i===j?e.target.value:x))}>{!columns.some(c=>c.name===n)&&<option value={n}>{n} (thiếu)</option>}{available(axis,i).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select><button type="button" className="button" aria-label={'Đưa '+title+' '+(i+1)+' lên'} disabled={locked||i===0} onClick={()=>moveAxis(axis,i,-1)}>↑</button><button type="button" className="button" aria-label={'Đưa '+title+' '+(i+1)+' xuống'} disabled={locked||i===draft[axis].length-1} onClick={()=>moveAxis(axis,i,1)}>↓</button><button type="button" className="button" aria-label={'Bỏ '+title+' '+(i+1)} disabled={locked} onClick={()=>setAxis(axis,draft[axis].filter((_,j)=>i!==j))}>×</button></div>)}<button type="button" className="button dashed" disabled={locked||draft[axis].length>=max||!available(axis,-1).length} onClick={()=>addAxis(axis)}>Thêm {title.toLowerCase()} Pivot</button></div>;
 })}</div>
 <div className="pivot-bar"><label><input type="checkbox" checked={draft.subtotals} disabled={locked} onChange={e=>change({subtotals:e.target.checked})}/> Hiện tổng phụ nhiều cấp</label><span>{config.filters.length} bộ lọc báo cáo · Tổng cộng luôn có</span></div>
 <h3>Chỉ số ({draft.measures.length}/{PIVOT_LIMITS.measures})</h3>
 <div className="pivot-measures">{draft.measures.map((m,i)=>{
  const label=(s:string)=>s+' chỉ số '+(i+1),prev=draft.measures.slice(0,i);
  const choices=m.kind==='aggregate'&&m.aggregate==='distinct'?columns:numeric;
  return <article className="pivot-measure" key={m.id}><div className="pivot-measure-head"><strong>{i+1}. {m.name||'Chỉ số mới'}</strong><button type="button" className="button" aria-label={'Bỏ chỉ số '+(i+1)} disabled={locked||draft.measures.length===1} onClick={()=>change({measures:draft.measures.filter((_,j)=>i!==j)})}>Xóa</button></div><div className="model-fields"><label className="field"><span>Tên chỉ số</span><input aria-label={label('Tên')} value={m.name} maxLength={100} disabled={locked} onChange={e=>updateMeasure(i,{...m,name:e.target.value})}/></label><label className="field"><span>Loại</span><select aria-label={label('Loại')} disabled={locked} value={m.kind} onChange={e=>changeKind(i,e.target.value as PivotMeasure['kind'])}><option value="aggregate">Tổng hợp cột</option><option value="row">Công thức từng dòng</option><option value="formula" disabled={i===0}>Công thức tổng hợp</option></select></label>
 {m.kind!=='formula'&&<label className="field"><span>Phép tổng hợp</span><select aria-label={label('Phép')} value={m.aggregate} disabled={locked} onChange={e=>{const a=e.target.value as Aggregate;if(m.kind==='row'){updateMeasure(i,{...m,aggregate:a as typeof m.aggregate});return;}const opts=a==='distinct'?columns:numeric;updateMeasure(i,{...m,aggregate:a,column:a==='count'?'':opts.some(c=>c.name===m.column)?m.column:opts[0]?.name??''});}}>{PIVOT_AGGREGATES.filter(a=>m.kind!=='row'||!['count','distinct'].includes(a)).map(a=><option key={a} value={a}>{labels[a]}</option>)}</select></label>}
 {m.kind==='aggregate'&&m.aggregate!=='count'&&<label className="field"><span>Cột giá trị</span><select aria-label={label('Cột')} value={m.column} disabled={locked} onChange={e=>updateMeasure(i,{...m,column:e.target.value})}><option value="">Chọn cột</option>{choices.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>}
 {m.kind==='row'&&<><OperandEditor label={label('Vế trái')} columns={numeric} disabled={locked} value={m.expression.left} onChange={left=>updateMeasure(i,{...m,expression:{...m.expression,left}})}/><label className="field"><span>Toán tử</span><select aria-label={label('Toán tử')} value={m.expression.op} disabled={locked} onChange={e=>updateMeasure(i,{...m,expression:{...m.expression,op:e.target.value as PivotOp}})}>{PIVOT_OPERATORS.map(o=><option key={o}>{o}</option>)}</select></label><OperandEditor label={label('Vế phải')} columns={numeric} disabled={locked} value={m.expression.right} onChange={right=>updateMeasure(i,{...m,expression:{...m.expression,right}})}/></>}
 {m.kind==='formula'&&<>{(['left','right'] as const).map(side=><label className="field" key={side}><span>{side==='left'?'Chỉ số trái':'Chỉ số phải'}</span><select aria-label={label(side==='left'?'Vế trái':'Vế phải')} value={m[side]} disabled={locked} onChange={e=>updateMeasure(i,{...m,[side]:e.target.value})}><option value="">Chọn chỉ số</option>{prev.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>)}<label className="field"><span>Toán tử</span><select aria-label={label('Toán tử')} value={m.op} disabled={locked} onChange={e=>updateMeasure(i,{...m,op:e.target.value as PivotOp})}>{PIVOT_OPERATORS.map(o=><option key={o}>{o}</option>)}</select></label></>}
 <label className="field"><span>Định dạng</span><select aria-label={label('Định dạng')} value={m.format} disabled={locked} onChange={e=>updateMeasure(i,{...m,format:e.target.value as PivotFormat})}>{PIVOT_FORMATS.map(f=><option key={f} value={f}>{f==='number'?'Số':f==='vnd'?'VNĐ':'Phần trăm'}</option>)}</select></label><label className="field"><span>Chữ số thập phân</span><select aria-label={label('Làm tròn')} value={m.decimals} disabled={locked} onChange={e=>updateMeasure(i,{...m,decimals:Number(e.target.value)})}>{Array.from({length:7},(_,j)=><option key={j}>{j}</option>)}</select></label></div></article>;
 })}</div>
 <button type="button" className="button dashed" disabled={locked||draft.measures.length>=PIVOT_LIMITS.measures} onClick={addMeasure}>Thêm chỉ số Pivot</button>
 <p className="profile-note">Công thức từng dòng tính trước khi tổng hợp; công thức tổng hợp tham chiếu chỉ số đã tính tại chính ô hoặc tổng phụ. Dùng DOUBLE; làm tròn chỉ ở hiển thị/xuất định dạng, chưa phải DECIMAL tài chính.</p>
 {error&&<p role="alert" className="profile-error">{error}</p>}
 {applied&&queryError&&<p role="alert" className="profile-error">{queryError}</p>}
 {pending&&<p role="status" className="profile-note">Đang kiểm tra Pivot…</p>}
 <div className="schema-actions">{config.pivot&&<button type="button" className="button" disabled={locked} onClick={()=>onApply(undefined)}>Tắt Pivot</button>}<button type="button" className="button" disabled={locked} onClick={()=>void check()}>Kiểm tra Pivot</button><button type="button" className="button primary" disabled={locked||!preview||checked!==config} onClick={apply}>Áp dụng Pivot</button></div>
 {current&&<><p className="profile-note">{preview&&checked===config?'Bản xem trước — chưa áp dụng':'Pivot đã áp dụng'}</p><Matrix pivot={draft} data={current}/></>}
 <p className="profile-note">Sử dụng bộ lọc báo cáo hiện tại. Áp dụng Pivot rồi Lưu workspace để dùng Chạy kỳ mới; Excel xuất thêm sheet Pivot, CSV xuất ma trận Pivot.</p>
 </div>}</section>;
}
