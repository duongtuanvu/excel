import {useState,useRef} from 'react';
import type {ManagedSource} from './source-model';
import type {BatchSelection,BatchPreview} from './batch-model';
import {BATCH_LIMITS} from './batch-model';
import {LIMITS} from './model';
type Props={sources:ManagedSource[];disabled:boolean;onRequest:(selection:BatchSelection[],apply?:boolean)=>Promise<BatchPreview|null>};
const fmt=new Intl.NumberFormat('vi-VN');
export default function BatchPanel({sources,disabled,onRequest}:Props){
 const real=sources.filter(s=>!s.demo&&!s.derived);
 const [open,setOpen]=useState(false),[files,setFiles]=useState<Record<string,File>>({}),[preview,setPreview]=useState<BatchPreview|null>(null),[pending,setPending]=useState<'preview'|'apply'|null>(null),[error,setError]=useState('');
 const running=useRef(false),locked=disabled||pending!==null;
 const selected=real.filter(s=>files[s.id]).map(s=>({sourceId:s.id,revision:s.revision,file:files[s.id]}));
 const bytes=selected.reduce((n,s)=>n+s.file.size,0),valid=selected.length>=2&&bytes<=BATCH_LIMITS.bytes;
 function choose(id:string,file?:File){
   setPreview(null);setError('');
   setFiles(old=>{const next={...old};delete next[id];if(file&&file.size&&file.size<=LIMITS.fileBytes&&/\.(xlsx|xls|csv|tsv)$/i.test(file.name))next[id]=file;return next;});
   if(file&&(!file.size||file.size>LIMITS.fileBytes||! /\.(xlsx|xls|csv|tsv)$/i.test(file.name)))setError('BATCH_FILE_INVALID: Chọn file Excel/CSV/TSV hợp lệ, tối đa 25 MiB.');
 }
 async function run(apply:boolean){
   if(locked||running.current||!valid||(apply&&!preview?.ready))return;
   running.current=true;setPending(apply?'apply':'preview');setError('');
   try{if(apply){await onRequest(selected,true);setFiles({});setPreview(null);}else{setPreview(null);setPreview(await onRequest(selected));}}
   catch(e){setError(e instanceof Error?e.message:'BATCH_FAILED: Không thể cập nhật nguồn.');if(apply)setPreview(null);}
   finally{running.current=false;setPending(null);}
 }
 if(real.length<2)return null;
 return <section className="report-card schema-card" aria-label="Cập nhật hàng loạt"><div className="card-heading"><div><h2>Cập nhật hàng loạt</h2><p>Thay nhiều nguồn cùng một kỳ báo cáo</p></div><button type="button" className="button" disabled={locked} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'Thu gọn':'Mở Batch Refresh'}</button></div>
 {open&&<div className="schema-body">
 <p className="profile-note">Chọn file kỳ mới cho ít nhất hai nguồn đã mở. Dùng lại header, vùng, mapping và kiểu cột hiện tại. Nếu bất kỳ nguồn nào lỗi, không cập nhật nguồn nào.</p>
 <div className="batch-summary"><strong>{selected.length}/{real.length} nguồn đã chọn</strong><span>{fmt.format(bytes/1048576)} / 50 MiB</span></div>
 <div className="batch-grid">{real.map(s=>{
 const r=preview?.items.find(v=>v.sourceId===s.id);
 return <div className="batch-source" key={s.id}><strong title={s.alias}>{s.alias}</strong><small>{s.sheet} · {fmt.format(s.rows)} dòng hiện tại</small><label className="field"><span>File kỳ mới</span><input type="file" aria-label={'File batch '+s.alias} accept=".xlsx,.xls,.csv,.tsv" disabled={locked} onChange={e=>{choose(s.id,e.target.files?.[0]);e.target.value='';}}/></label>
 {files[s.id]&&<div className="batch-file"><span title={files[s.id].name}>{files[s.id].name}</span><button type="button" className="button" aria-label={'Bỏ file batch '+s.alias} disabled={locked} onClick={()=>choose(s.id)}>Bỏ</button></div>}
 {r&&<div className={r.error?'batch-invalid':'batch-valid'}>{r.error?<span>{r.error}</span>:<><strong>Hợp lệ · {fmt.format(r.previousRows)} → {fmt.format(r.rows??0)} dòng</strong>{r.addedColumns.length>0&&<small>Cột thêm: {r.addedColumns.join(', ')}</small>}</>}</div>}
 </div>;})}</div>
 {bytes>BATCH_LIMITS.bytes&&<p className="profile-error">BATCH_BYTES_LIMIT: Tổng file vượt 50 MiB.</p>}
 {error&&<p role="alert" className="profile-error">{error}</p>}
 {preview&&<p role="status" className={preview.ready?'batch-valid':'batch-invalid'}>{preview.ready?'Tất cả '+preview.items.length+' nguồn hợp lệ. Chưa thay đổi dữ liệu.':preview.error??'Có nguồn không hợp lệ. Không thể áp dụng đợt này.'}</p>}
 {pending&&<p role="status" className="profile-note">{pending==='preview'?'Đang kiểm tra từng file…':'Đang chuẩn bị bảng và commit transaction…'}</p>}
 <div className="schema-actions"><button type="button" className="button" disabled={locked||!selected.length} onClick={()=>{setFiles({});setPreview(null);setError('');}}>Bỏ tất cả file</button><button type="button" className="button" disabled={locked||!valid} onClick={()=>void run(false)}>Kiểm tra hàng loạt</button><button type="button" className="button primary" disabled={locked||!valid||!preview?.ready} onClick={()=>void run(true)}>Áp dụng hàng loạt</button></div>
 <p className="profile-note">File không gửi lên server. Sau khi cập nhật, bấm Lưu workspace nếu muốn lưu cấu hình mới. Nguồn không được chọn giữ nguyên.</p>
 </div>}</section>;
}
