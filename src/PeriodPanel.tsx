import { useRef, useState } from 'react';
import { UiIcon } from './UiIcons';
import { ErrorMessage } from './ErrorText';
import { LIMITS } from './model';
import { WORKSPACE_LIMITS } from './source-model';
import { periodPlan } from './workspace-model';
import type { SavedWorkspace } from './workspace-model';
import type { ExpansionWarning, PeriodSelection } from './period-model';

export type RunPeriod = (outputId:string,files:PeriodSelection[],confirmed:string[])=>Promise<ExpansionWarning|null>;

export default function PeriodPanel({saved,disabled,onRun,outputIds}:{saved:SavedWorkspace;disabled:boolean;onRun:RunPeriod;outputIds?:string[]}){
  const reports=[...(saved.models??[]),...saved.slots];
  const [open,setOpen]=useState(false);
  const [output,setOutput]=useState(outputIds?.[0]??saved.outputId??reports[0].id);
  const dashboard=!!outputIds?.length;
  const [files,setFiles]=useState<Record<string,File>>({});
  const [confirmed,setConfirmed]=useState<string[]>([]);
  const [warning,setWarning]=useState<ExpansionWarning|null>(null);
  const [error,setError]=useState(''),[success,setSuccess]=useState(false);
  const [pending,setPending]=useState(false);
  const running=useRef(false);
  const plan=periodPlan(saved,output,outputIds?.slice(1));
  const locked=disabled||pending;
  const selected=plan.slots.flatMap(slot=>files[slot.id]?[{slotId:slot.id,file:files[slot.id]}]:[]);
  const ready=selected.length===plan.slots.length;
  function clearReview(){setWarning(null);setConfirmed([]);setError('');}
  function choose(id:string,file?:File){
    clearReview();
    setFiles(old=>{
      const next={...old};
      if(file)next[id]=file;else delete next[id];
      return next;
    });
  }
  async function run(){
    if(locked||!ready||running.current)return;
    if(selected.some(s=>!s.file.size||s.file.size>LIMITS.fileBytes||! /\.(xlsx|xls|csv|tsv)$/i.test(s.file.name))){
      setError('Chọn file Excel, CSV hoặc TSV tối đa 25 MiB cho mỗi nguồn.');return;
    }
    if(selected.reduce((n,s)=>n+s.file.size,0)>WORKSPACE_LIMITS.bookBytes){
      setError('Tổng dung lượng file vượt 50 MiB.');return;
    }
    running.current=true;setPending(true);setError('');
    const approvals=warning?[...confirmed,warning.id]:confirmed;
    try{
      const next=await onRun(output,selected,approvals);
      setConfirmed(approvals);setWarning(next);
      if(!next){setFiles({});setOpen(false);clearReview();setSuccess(true);}
    }catch(e){clearReview();setError(e instanceof Error?e.message:'Không thể chạy báo cáo.');}
    finally{running.current=false;setPending(false);}
  }
  return <section className="period-panel" aria-label={dashboard?"Dashboard kỳ mới":"Báo cáo kỳ mới"}>
    <button type="button" className="button primary" disabled={locked} aria-expanded={open}
      onClick={()=>{setOpen(!open);setFiles({});clearReview();setSuccess(false);}}><UiIcon name={open?'close':'play'} size={14}/>{open?'Đóng kỳ mới':dashboard?'Chạy kỳ mới Dashboard':'Chạy kỳ mới'}</button>
    {dashboard&&success&&<p role="status" className="profile-note">Đã chạy kỳ mới Dashboard.</p>}
    {open&&<div className="period-fields">
      {!dashboard&&<label className="field"><span>Báo cáo cần chạy</span>
        <select value={output} disabled={locked} onChange={e=>{setOutput(e.target.value);setFiles({});clearReview();}}>
          {reports.map(r=><option key={r.id} value={r.id}>{r.alias} · {r.config.title}</option>)}
        </select>
      </label>}
      {dashboard&&<p className="profile-note">{plan.slots.length} nguồn gốc · {plan.models.length} bước xử lý. Tất cả widget được kiểm tra trước khi cập nhật dữ liệu.</p>}
      {plan.models.length>0&&<div><strong>Các bước đã lưu</strong><ol>{plan.models.map(m=><li key={m.id}>{m.alias}</li>)}</ol></div>}
      {plan.slots.map(slot=><label key={output+slot.id} className="field">
        <span>{slot.alias}</span><small>Sheet {slot.sheet}</small>
        <input type="file" aria-label={'File kỳ mới cho '+slot.alias} accept=".xlsx,.xls,.csv,.tsv" disabled={locked}
          onChange={e=>choose(slot.id,e.target.files?.[0])}/>
      </label>)}
      {warning&&<p role="alert" className="model-warning"><UiIcon name="alert" size={16}/><span>Bước {warning.alias} có khóa ghép trùng. Dự kiến {warning.rows.toLocaleString('vi-VN')} dòng kết quả, {warning.matchedPairs.toLocaleString('vi-VN')} cặp khớp. Tổng báo cáo có thể tăng nếu một dòng được tính nhiều lần.</span></p>}
      {error&&<p className="profile-error" role="alert"><ErrorMessage text={error}/></p>}
      <button type="button" className="button primary" disabled={locked||!ready} onClick={()=>void run()}>
        <UiIcon name={pending?'refresh':'play'} size={14}/>{pending?'Đang tính báo cáo…':warning?'Xác nhận ghép và tiếp tục':dashboard?'Chạy Dashboard':'Chạy báo cáo'}
      </button>
    </div>}
  </section>;
}
