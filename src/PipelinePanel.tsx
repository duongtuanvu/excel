import {useState,useRef} from 'react';
import type {ManagedSource} from './source-model';
import type {Column,Kind} from './model';
import {PIPELINE_LIMITS,STEP_TYPES,STEP_LABELS,FILTER_TYPES,newStep,validateRecipe,validateRecipes,compileStep} from './pipeline-model';
import type {PipelineRecipe,PipelineStep,PipelineInput,PipelinePreview,StepType,FilterType} from './pipeline-model';
type Props={sources:ManagedSource[];activeId:string|null;recipes:PipelineRecipe[];disabled:boolean;onRequest:(input:PipelineInput,apply?:boolean)=>Promise<PipelinePreview|null>;onSave:(recipes:PipelineRecipe[])=>Promise<void>};
type History={past:PipelineStep[][];current:PipelineStep[];future:PipelineStep[][]};
const HISTORY_LIMIT=30;
const fmt=new Intl.NumberFormat('vi-VN');
const filters:Record<FilterType,string>={eq:'Bằng',neq:'Khác',contains:'Chứa',empty:'Trống',notEmpty:'Không trống',gt:'Lớn hơn',gte:'Lớn hơn hoặc bằng',lt:'Nhỏ hơn',lte:'Nhỏ hơn hoặc bằng'};
const kinds:{value:Kind;label:string}[]=[{value:'text',label:'Văn bản'},{value:'number',label:'Số chuẩn'},{value:'date',label:'Ngày YYYY-MM-DD'},{value:'boolean',label:'Logic'}];
export default function PipelinePanel({sources,activeId,recipes,disabled,onRequest,onSave}:Props){
 const eligible=sources.filter(s=>!s.demo&&!s.stale&&s.derived?.operation!=='pipeline');
 const first=eligible.find(s=>s.id===activeId)??eligible[0];
 const [open,setOpen]=useState(false),[sourceId,setSourceId]=useState(first?.id??''),[name,setName]=useState('Làm sạch dữ liệu'),[alias,setAlias]=useState('Kết quả pipeline'),[loaded,setLoaded]=useState(''),[deleteConfirm,setDeleteConfirm]=useState(false);
 const [history,setHistory]=useState<History>(()=>({past:[],current:[newStep('trim',first?.columns.find(c=>c.kind==='text')?.name??first?.columns[0]?.name??'')],future:[]}));
 const [preview,setPreview]=useState<PipelinePreview|null>(null),[sampleIndex,setSampleIndex]=useState(0),[pending,setPending]=useState<'preview'|'apply'|'save'|null>(null),[error,setError]=useState('');
 const running=useRef(false),locked=disabled||pending!==null,source=eligible.find(s=>s.id===sourceId);
 const steps=history.current,recipe:PipelineRecipe={version:1,name,steps};
 const existing=recipes.find(r=>r.name.toLowerCase()===name.trim().toLowerCase());
 const available:Column[][]=[];let cols=source?.columns??[],validSchema=true;
 for(const step of steps){
   available.push(cols);
   try{const valid=validateRecipe({version:1,name:'step',steps:[step]}).steps[0];cols=compileStep(valid,cols,'pipeline_stage_a').columns;}
   catch{validSchema=false;}
 }
 function invalidate(){setPreview(null);setError('');}
 function change(next:PipelineStep[]){setHistory(h=>({past:[...h.past,h.current].slice(-HISTORY_LIMIT),current:next,future:[]}));invalidate();}
 function patch(index:number,part:Partial<PipelineStep>){change(steps.map((s,i)=>i===index?{...s,...part}:s));}
 function move(i:number,d:number){const next=[...steps],j=i+d;if(j<0||j>=next.length)return;[next[i],next[j]]=[next[j],next[i]];change(next);}
 function undo(){setHistory(h=>h.past.length?{past:h.past.slice(0,-1),current:h.past.at(-1)!,future:[h.current,...h.future].slice(0,HISTORY_LIMIT)}:h);invalidate();}
 function redo(){setHistory(h=>h.future.length?{past:[...h.past,h.current].slice(-HISTORY_LIMIT),current:h.future[0],future:h.future.slice(1)}:h);invalidate();}
 function load(r:PipelineRecipe){setName(r.name);setLoaded(r.name);setDeleteConfirm(false);change(r.steps.map(s=>({...s})));}
 async function run(kind:'preview'|'apply'|'save',remove=false){
   if(locked||running.current||(kind==='apply'&&!preview))return;
   running.current=true;setPending(kind);setError('');
   try{
     if(kind==='save'){
       if(remove){await onSave(recipes.filter(r=>r.name!==loaded));setLoaded('');setDeleteConfirm(false);return;}
       const r=validateRecipe(recipe),next=validateRecipes([...recipes.filter(v=>v.name.toLowerCase()!==r.name.toLowerCase()),r]);
       await onSave(next);setLoaded(r.name);return;
     }
     if(!source)throw Error('PIPELINE_SOURCE_INVALID: Hãy chọn nguồn.');
     const input={sourceId:source.id,revision:source.revision,alias,recipe:validateRecipe(recipe)};
     if(kind==='preview'){setPreview(null);const r=await onRequest(input);setPreview(r);setSampleIndex(0);}
     else{await onRequest(input,true);setPreview(null);setAlias('Kết quả pipeline '+(sources.filter(s=>s.derived?.operation==='pipeline').length+2));}
   }catch(e){setError(e instanceof Error?e.message:'PIPELINE_FAILED: Không thể xử lý công thức.');}
   finally{running.current=false;setPending(null);}
 }
 if(!eligible.length)return null;
 const stage=preview?.stages[sampleIndex],ready=!!source&&!!alias.trim()&&!!name.trim()&&steps.some(s=>s.enabled)&&validSchema;
 return <section className="report-card schema-card pipeline-card" aria-label="Pipeline biến đổi dữ liệu"><div className="card-heading"><div><h2>Pipeline biến đổi dữ liệu</h2><p>Thiết kế công thức làm sạch và xử lý dữ liệu nhiều bước</p></div><button type="button" className="button" disabled={locked} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'Thu gọn':'Mở Pipeline'}</button></div>
 {open&&<div className="schema-body">
 <div className="model-fields"><label className="field"><span>Nguồn pipeline</span><select aria-label="Nguồn pipeline" value={sourceId} disabled={locked} onChange={e=>{setSourceId(e.target.value);invalidate();}}>{eligible.map(s=><option key={s.id} value={s.id}>{s.alias}</option>)}</select></label>
 <label className="field"><span>Tên bảng pipeline</span><input aria-label="Tên bảng pipeline" value={alias} maxLength={100} disabled={locked} onChange={e=>{setAlias(e.target.value);invalidate();}}/></label>
 <label className="field"><span>Tên công thức</span><input aria-label="Tên công thức pipeline" value={name} maxLength={100} disabled={locked} onChange={e=>{setName(e.target.value);invalidate();}}/></label>
 <label className="field"><span>Công thức đã lưu</span><select aria-label="Công thức pipeline đã lưu" value={loaded} disabled={locked} onChange={e=>{const r=recipes.find(r=>r.name===e.target.value);if(r)load(r);else{setLoaded('');setDeleteConfirm(false);}}}><option value="">Chọn công thức</option>{recipes.map(r=><option key={r.name} value={r.name}>{r.name} ({r.steps.length} bước)</option>)}</select></label></div>
 <div className="pipeline-bar"><strong>{steps.length}/{PIPELINE_LIMITS.steps} bước</strong><div><button type="button" className="button" disabled={locked||!history.past.length} onClick={undo}>Hoàn tác</button><button type="button" className="button" disabled={locked||!history.future.length} onClick={redo}>Làm lại</button></div></div>
 <div className="pipeline-flow"><div className="pipeline-source">▤ <strong>{source?.alias}</strong><small>{fmt.format(source?.rows??0)} dòng nguồn</small></div>
 {steps.map((step,i)=><article className={'pipeline-step'+(step.enabled?'':' pipeline-disabled')} key={i} aria-label={'Bước pipeline '+(i+1)}><div className="pipeline-step-head"><span className="pipeline-index">{i+1}</span><strong>{STEP_LABELS[step.type]}</strong><label><input type="checkbox" aria-label={'Bật bước '+(i+1)} checked={step.enabled} disabled={locked} onChange={e=>patch(i,{enabled:e.target.checked})}/> Bật</label></div>
 <div className="model-fields"><label className="field"><span>Thao tác</span><select aria-label={'Loại bước '+(i+1)} value={step.type} disabled={locked} onChange={e=>{const next=newStep(e.target.value as StepType,step.column);patch(i,{...next,enabled:step.enabled});}}>{STEP_TYPES.map(t=><option value={t} key={t}>{STEP_LABELS[t]}</option>)}</select></label>
 {step.type!=='distinct'&&<label className="field"><span>Cột</span><select aria-label={'Cột bước '+(i+1)} disabled={locked||!step.enabled} value={step.column} onChange={e=>patch(i,{column:e.target.value})}><option value="">Chọn cột</option>{step.column&&!available[i].some(c=>c.name===step.column)&&<option value={step.column}>{step.column} (không tìm thấy)</option>}{available[i].map(c=><option key={c.id} value={c.name}>{c.name} ({c.kind})</option>)}</select></label>}
 {step.type==='filter'&&<label className="field"><span>Điều kiện</span><select aria-label={'Điều kiện bước '+(i+1)} value={step.operator} disabled={locked||!step.enabled} onChange={e=>patch(i,{operator:e.target.value as FilterType})}>{FILTER_TYPES.map(t=><option key={t} value={t}>{filters[t]}</option>)}</select></label>}
 {(['replace','rename','fill'].includes(step.type)||(step.type==='filter'&&!['empty','notEmpty'].includes(step.operator)))&&<label className="field"><span>{step.type==='rename'?'Tên cột mới':step.type==='replace'?'Tìm văn bản':'Giá trị'}</span><input aria-label={'Giá trị bước '+(i+1)} value={step.value} maxLength={PIPELINE_LIMITS.value} disabled={locked||!step.enabled} onChange={e=>patch(i,{value:e.target.value})}/></label>}
 {step.type==='replace'&&<label className="field"><span>Thay bằng</span><input aria-label={'Thay bằng bước '+(i+1)} value={step.replacement} maxLength={PIPELINE_LIMITS.value} disabled={locked||!step.enabled} onChange={e=>patch(i,{replacement:e.target.value})}/></label>}
 {step.type==='cast'&&<label className="field"><span>Kiểu đích</span><select aria-label={'Kiểu đích bước '+(i+1)} value={step.target} disabled={locked||!step.enabled} onChange={e=>patch(i,{target:e.target.value as Kind})}>{kinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select></label>}</div>
 <div className="pipeline-step-foot"><small>{preview?.stages[i]?fmt.format(preview.stages[i].before)+' → '+fmt.format(preview.stages[i].rows)+' dòng':!step.enabled?'Bỏ qua bước này':'Chưa kiểm tra'}</small><div><button type="button" className="button" aria-label={'Đưa bước '+(i+1)+' lên'} disabled={locked||i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" className="button" aria-label={'Đưa bước '+(i+1)+' xuống'} disabled={locked||i===steps.length-1} onClick={()=>move(i,1)}>↓</button><button type="button" className="button" aria-label={'Xóa bước '+(i+1)} disabled={locked||steps.length===1} onClick={()=>change(steps.filter((_,j)=>i!==j))}>Xóa</button></div></div>
 </article>)}
 <button type="button" className="button pipeline-add" disabled={locked||steps.length>=PIPELINE_LIMITS.steps} onClick={()=>change([...steps,newStep('trim',cols.find(c=>c.kind==='text')?.name??cols[0]?.name??'')])}>+ Thêm bước</button></div>
 {!validSchema&&<p className="profile-note">Có bước chưa hợp lệ hoặc tham chiếu cột không còn tồn tại. Kiểm tra tên, kiểu và thứ tự bước.</p>}
 {error&&<p role="alert" className="profile-error">{error}</p>}
 {pending&&<p role="status" className="profile-note">{pending==='save'?'Đang lưu công thức…':'Đang xử lý pipeline…'}</p>}
 {preview&&<div className="model-preview"><p role="status" data-testid="pipeline-preview-count"><strong>{fmt.format(preview.rows)} dòng · {preview.columns.length} cột kết quả</strong></p><label className="field"><span>Xem kết quả từng bước</span><select aria-label="Preview bước pipeline" value={sampleIndex} disabled={locked} onChange={e=>setSampleIndex(Number(e.target.value))}>{preview.stages.map(s=><option key={s.index} value={s.index}>{s.index+1}. {s.label} · {s.rows} dòng</option>)}</select></label>
 {stage&&<><div className="table-scroll schema-table pipeline-sample" data-testid="pipeline-sample"><table><thead><tr>{stage.columns.slice(0,PIPELINE_LIMITS.sampleColumns).map(c=><th key={c.id}>{c.name}</th>)}</tr></thead><tbody>{stage.sample.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}{!stage.sample.length&&<tr><td colSpan={Math.min(stage.columns.length,PIPELINE_LIMITS.sampleColumns)}>Không còn dòng dữ liệu.</td></tr>}</tbody></table></div><p className="profile-note">Mẫu tối đa 5 dòng, 8 cột; giá trị dài được rút gọn. Không bảo đảm thứ tự dòng.</p></>}
 </div>}
 <div className="schema-actions"><button type="button" className="button" disabled={locked||!ready} onClick={()=>void run('preview')}>Kiểm tra pipeline</button><button type="button" className="button primary" disabled={locked||!ready||!preview} onClick={()=>void run('apply')}>Tạo bảng pipeline</button></div>
 <div className="pipeline-save"><button type="button" className="button" disabled={locked||!name.trim()} onClick={()=>void run('save')}>{existing?'Cập nhật công thức pipeline':'Lưu công thức pipeline'}</button>{loaded&&recipes.some(r=>r.name===loaded)&&<>{deleteConfirm?<><button type="button" className="button danger-button" disabled={locked} onClick={()=>void run('save',true)}>Xác nhận xóa công thức</button><button type="button" className="button" disabled={locked} onClick={()=>setDeleteConfirm(false)}>Hủy</button></>:<button type="button" className="button" disabled={locked} onClick={()=>setDeleteConfirm(true)}>Xóa công thức đã lưu</button>}</>}</div>
 <p className="profile-note">Chỉ lưu công thức, tên cột và giá trị điều kiện đã nhập; các thông tin này có thể nhạy cảm. File và mẫu dữ liệu không được lưu lên server. Chạy lại trên nguồn tương thích khi cần; bảng kết quả chỉ tồn tại trong phiên. Không tự thay ô lỗi bằng 0.</p>
 </div>}</section>;
}
