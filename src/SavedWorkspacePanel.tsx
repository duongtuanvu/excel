import { useRef, useState } from 'react';
import { UiIcon } from './UiIcons';
import type { ManagedSource } from './source-model';
import type { SavedSource, SavedWorkspace } from './workspace-model';
import PeriodPanel from './PeriodPanel';
import type { RunPeriod } from './PeriodPanel';

type Props={
  saved:SavedWorkspace|null;
  sources:ManagedSource[];
  disabled:boolean;
  onSave:()=>void;
  onAttach:(id:string,file:File)=>void;
  onForget:(id:string)=>void;
  onActivate:(id:string)=>void;
  onRunPeriod:RunPeriod;
};
function Slot({slot,loaded,disabled,onAttach,onForget,onActivate}:{
  slot:SavedSource;loaded?:ManagedSource;disabled:boolean;
  onAttach:(id:string,file:File)=>void;onForget:(id:string)=>void;onActivate:(id:string)=>void;
}){
  const picker=useRef<HTMLInputElement>(null);
  const [confirm,setConfirm]=useState(false);
  return <li className="saved-slot">
    <div className="saved-slot-head"><strong title={slot.alias}>{slot.alias}</strong><span className={loaded?'slot-badge ready':'slot-badge'}>{loaded?'Đã nạp':'Chờ file'}</span></div>
    <small title={slot.sheet}>{slot.sheet} · {slot.columns.length} cột</small>
    {loaded?<button className="button" disabled={disabled} onClick={()=>onActivate(loaded.id)}><UiIcon name="eye" size={13}/>Mở báo cáo</button>:<>
      <input ref={picker} type="file" accept=".xlsx,.xls,.csv,.tsv" hidden disabled={disabled} aria-label={'File cho nguồn '+slot.alias} onChange={event=>{
        const file=event.target.files?.[0];event.target.value='';if(file)onAttach(slot.id,file);
      }}/>
      {confirm?<div className="slot-confirm"><small>Bỏ cấu hình nguồn này khỏi tài khoản? File gốc không bị xóa.</small><div className="slot-actions"><button className="button danger-button" disabled={disabled} onClick={()=>{setConfirm(false);onForget(slot.id);}}>Xác nhận bỏ</button><button className="button" onClick={()=>setConfirm(false)}>Hủy</button></div></div>:<div className="slot-actions"><button className="button" disabled={disabled} onClick={()=>picker.current?.click()}><UiIcon name="upload" size={13}/>Chọn file</button><button className="button text-button" disabled={disabled} onClick={()=>setConfirm(true)}>Bỏ cấu hình</button></div>}
    </>}
  </li>;
}
export default function SavedWorkspacePanel({saved,sources,disabled,onSave,onAttach,onForget,onActivate,onRunPeriod}:Props){
  const real=sources.filter(s=>!s.demo&&!s.derived);
  const bySlot=new Map(real.map(s=>[s.slotId,s]));
  const slots=saved?.slots??[];
  const ready=slots.filter(s=>bySlot.has(s.id)).length;
  const [forget,setForget]=useState<string|null>(null);
  return <div className="saved-workspace">
    <div className="saved-workspace-summary"><span>{slots.length?ready+'/'+slots.length+' nguồn đã nạp':'Chưa lưu workspace'}</span>{slots.length>0&&<div className="slot-progress" role="progressbar" aria-label="Nguồn workspace đã nạp" aria-valuemin={0} aria-valuemax={slots.length} aria-valuenow={ready}><i style={{width:(100*ready/slots.length)+'%'}}/></div>}</div>
    <p className="muted small-text">Lưu cách đọc file, các bước ghép và cấu hình báo cáo. Kỳ sau chọn báo cáo và file mới để tính lại trên thiết bị.</p>
    {saved&&<PeriodPanel key={JSON.stringify(saved)} saved={saved} disabled={disabled} onRun={onRunPeriod}/>}
    {slots.length>0&&<ul className="saved-slot-list" aria-label="Nguồn workspace đã lưu">{slots.map(slot=><Slot key={slot.id} slot={slot} loaded={bySlot.get(slot.id)} disabled={disabled} onAttach={onAttach} onForget={onForget} onActivate={onActivate}/>)}</ul>}
    {!!saved?.models?.length&&<ul className="saved-slot-list" aria-label="Các bước xử lý đã lưu">{saved.models.map(model=><li className="saved-slot" key={model.id}>
      <strong>{model.alias}</strong><small>{model.config.title}</small>
      {!sources.some(s=>s.slotId===model.id)&&(forget===model.id?<div className="slot-actions">
        <button className="button danger-button" disabled={disabled} onClick={()=>{setForget(null);onForget(model.id);}}>Xác nhận bỏ bước</button>
        <button className="button" onClick={()=>setForget(null)}>Hủy</button>
      </div>:<button className="button text-button" disabled={disabled} onClick={()=>setForget(model.id)}>Bỏ bước xử lý</button>)}
    </li>)}</ul>}
    <button className="button primary" disabled={disabled||!real.length} onClick={onSave}><UiIcon name="save" size={15}/>Lưu workspace</button>
    <small className="source-local-note">Lưu tất cả nguồn thật đang mở; nguồn đã lưu nhưng chưa nạp vẫn được giữ. Tên nguồn, cột và giá trị bộ lọc có thể nhạy cảm.</small>
  </div>;
}
