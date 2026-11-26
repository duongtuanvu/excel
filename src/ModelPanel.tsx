import {useState,useRef} from 'react';
import type {ManagedSource} from './source-model';
import {MODEL_OPERATIONS,MODEL_LABELS,defaultPairs,isUnion} from './data-model';
import type {ModelOperation,ModelInput,ModelPair,ModelPreview} from './data-model';
type Props={sources:ManagedSource[];disabled:boolean;onRequest:(input:ModelInput,apply?:boolean,confirmExpansion?:boolean)=>Promise<ModelPreview|null>};
const fmt=new Intl.NumberFormat('vi-VN');
export default function ModelPanel({sources,disabled,onRequest}:Props){
 const real=sources.filter(s=>!s.demo&&!s.derived);
 const [open,setOpen]=useState(false),[leftId,setLeft]=useState(real[0]?.id??''),[rightId,setRight]=useState(real[1]?.id??''),[operation,setOperation]=useState<ModelOperation>('left'),[alias,setAlias]=useState('Bảng ghép'),[pairs,setPairs]=useState<ModelPair[]>(()=>real.length>=2?defaultPairs(real[0],real[1],'left'):[]),[preview,setPreview]=useState<ModelPreview|null>(null),[confirm,setConfirm]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const running=useRef(false),locked=disabled||pending;
 const left=real.find(s=>s.id===leftId),right=real.find(s=>s.id===rightId),union=isUnion(operation);
 function invalidate(){setPreview(null);setConfirm(false);setError('');}
 function change(l:string,r:string,op:ModelOperation){setLeft(l);setRight(r);setOperation(op);const a=real.find(s=>s.id===l),b=real.find(s=>s.id===r);setPairs(a&&b&&a!==b?defaultPairs(a,b,op):[]);invalidate();}
 const valid=!!left&&!!right&&left!==right&&!!alias.trim()&&pairs.length>0&&pairs.every(p=>p.left&&p.right)&&new Set(pairs.map(p=>p.left)).size===pairs.length&&new Set(pairs.map(p=>p.right)).size===pairs.length;
 async function run(apply:boolean){
  if(locked||running.current||!valid||!left||!right||(apply&&(!preview||(preview.stats?.expansion&&!confirm))))return;
  running.current=true;setPending(true);setError('');
  try{
   const input={leftId:left.id,leftRevision:left.revision,rightId:right.id,rightRevision:right.revision,operation,alias,pairs};
   if(apply){await onRequest(input,true,confirm);setPreview(null);setConfirm(false);setAlias('Bảng ghép '+(sources.filter(s=>s.derived).length+2));}
   else{setPreview(null);setConfirm(false);setPreview(await onRequest(input));}
  }catch(e){setError(e instanceof Error?e.message:'MODEL_FAILED: Không thể ghép bảng.');}
  finally{running.current=false;setPending(false);}
 }
 if(real.length<2)return null;
 const stats=preview?.stats;
 return <section className="report-card schema-card" aria-label="Mô hình dữ liệu"><div className="card-heading"><div><h2>Mô hình dữ liệu</h2><p>JOIN / UNION hai nguồn Excel</p></div><button type="button" className="button" disabled={locked} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'Thu gọn':'Mở Data Model'}</button></div>
 {open&&<div className="schema-body"><div className="model-fields">
 <label className="field"><span>Bảng trái</span><select aria-label="Bảng trái" value={leftId} disabled={locked} onChange={e=>change(e.target.value,rightId,operation)}>{real.map(s=><option value={s.id} key={s.id}>{s.alias}</option>)}</select></label>
 <label className="field"><span>Bảng phải</span><select aria-label="Bảng phải" value={rightId} disabled={locked} onChange={e=>change(leftId,e.target.value,operation)}>{real.map(s=><option value={s.id} key={s.id}>{s.alias}</option>)}</select></label>
 <label className="field"><span>Phép ghép</span><select aria-label="Phép ghép" value={operation} disabled={locked} onChange={e=>change(leftId,rightId,e.target.value as ModelOperation)}>{MODEL_OPERATIONS.map(op=><option key={op} value={op}>{MODEL_LABELS[op]}</option>)}</select></label>
 <label className="field"><span>Tên bảng kết quả</span><input aria-label="Tên bảng kết quả" value={alias} maxLength={100} disabled={locked} onChange={e=>{setAlias(e.target.value);invalidate();}}/></label>
 </div><p className="profile-note">{union?'UNION loại dòng trùng; UNION ALL giữ mọi dòng. Ghép đủ cột theo cùng kiểu dữ liệu.':'JOIN so sánh khóa chính xác trên giá trị đã chuẩn hóa, phân biệt hoa/thường; NULL, rỗng và chỉ dấu cách không khớp. Hai bảng cần cùng kiểu khóa.'}</p>
 <div className="table-scroll schema-table"><table><thead><tr><th>{union?'Cột bảng trái':'Khóa trái'}</th><th>{union?'Cột bảng phải':'Khóa phải'}</th>{!union&&<th>Thao tác</th>}</tr></thead><tbody>{pairs.map((p,i)=><tr key={i}><td><select aria-label={'Cột trái '+(i+1)} disabled={locked||union} value={p.left} onChange={e=>{setPairs(v=>v.map((x,j)=>i===j?{...x,left:e.target.value,right:''}:x));invalidate();}}><option value="">Chọn cột</option>{left?.columns.map(c=><option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}</select></td><td><select aria-label={'Cột phải '+(i+1)} disabled={locked} value={p.right} onChange={e=>{setPairs(v=>v.map((x,j)=>i===j?{...x,right:e.target.value}:x));invalidate();}}><option value="">Chọn cột</option>{right?.columns.map(c=><option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}</select></td>{!union&&<td><button type="button" className="button" disabled={locked||pairs.length===1} onClick={()=>{setPairs(v=>v.filter((_,j)=>i!==j));invalidate();}}>Bỏ khóa</button></td>}</tr>)}</tbody></table></div>
 {!union&&<button type="button" className="button" disabled={locked||pairs.length>=3} onClick={()=>{setPairs(v=>[...v,{left:'',right:''}]);invalidate();}}>Thêm cặp khóa</button>}
 {pending&&<p role="status" className="profile-note">Đang xử lý mô hình…</p>}
 {error&&<p role="alert" className="profile-error">{error}</p>}
 {preview&&<div className="model-preview"><p role="status"><strong>{fmt.format(preview.rows)} dòng · {preview.columns.length} cột kết quả</strong></p>
 {stats?<><div className="profile-stats">{[{label:'Quan hệ',value:stats.cardinality},{label:'Cặp khớp',value:fmt.format(stats.matchedPairs)},{label:'Trái không khớp',value:fmt.format(stats.unmatchedLeft)},{label:'Phải không khớp',value:fmt.format(stats.unmatchedRight)}].map(x=><div className="profile-stat" key={x.label}><span>{x.label}</span><strong>{x.value}</strong></div>)}</div><p className="profile-note">Nhóm khóa trùng: trái {stats.leftDuplicateKeys}, phải {stats.rightDuplicateKeys}, trùng cả hai {stats.manyToManyKeys}. Quan hệ tổng thể tính trên các khóa khớp.</p>{stats.expansion&&<label className="model-warning"><input type="checkbox" checked={confirm} disabled={locked} onChange={e=>setConfirm(e.target.checked)}/> Tôi hiểu JOIN có thể nhân bản dòng và làm tăng tổng tiền; xác nhận tạo bảng.</label>}</>:<p className="profile-note">Số dòng trùng đã loại: {fmt.format(preview.removedDuplicates??0)}</p>}
 <p className="profile-note">Cột kết quả: {preview.columns.map(c=>c.name).join(' · ')}</p></div>}
 <div className="schema-actions"><button type="button" className="button" disabled={locked||!valid} onClick={()=>void run(false)}>Kiểm tra mô hình</button><button type="button" className="button primary" disabled={locked||!valid||!preview||!!preview.stats?.expansion&&!confirm} onClick={()=>void run(true)}>Tạo bảng kết quả</button></div>
 <p className="profile-note">Bảng kết quả chỉ đọc trong phiên, không lưu vào workspace tài khoản; dùng Report Engine và xuất Excel như nguồn thường. Thay hoặc xóa nguồn gốc sẽ làm bảng ghép hết hiệu lực. Tạo lại bảng khi cần.</p></div>}</section>;
}
