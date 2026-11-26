import { useRef, useState } from 'react';
import type { ManagedSource } from './source-model';
import type { SavedSource, SavedWorkspace } from './workspace-model';

type Props={
  saved:SavedWorkspace|null;
  sources:ManagedSource[];
  disabled:boolean;
  onSave:()=>void;
  onAttach:(id:string,file:File)=>void;
  onForget:(id:string)=>void;
  onActivate:(id:string)=>void;
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
    {loaded?<button className="button" disabled={disabled} onClick={()=>onActivate(loaded.id)}>Mở báo cáo</button>:<>
      <input ref={picker} type="file" accept=".xlsx,.xls,.csv,.tsv" hidden disabled={disabled} aria-label={'File cho nguồn '+slot.alias} onChange={event=>{
        const file=event.target.files?.[0];event.target.value='';if(file)onAttach(slot.id,file);
      }}/>
      {confirm?<div className="slot-confirm"><small>Bỏ cấu hình nguồn này khỏi tài khoản? File gốc không bị xóa.</small><div className="slot-actions"><button className="button danger-button" disabled={disabled} onClick={()=>{setConfirm(false);onForget(slot.id);}}>Xác nhận bỏ</button><button className="button" onClick={()=>setConfirm(false)}>Hủy</button></div></div>:<div className="slot-actions"><button className="button" disabled={disabled} onClick={()=>picker.current?.click()}>Chọn file</button><button className="button text-button" disabled={disabled} onClick={()=>setConfirm(true)}>Bỏ cấu hình</button></div>}
    </>}
  </li>;
}
export default function SavedWorkspacePanel({saved,sources,disabled,onSave,onAttach,onForget,onActivate}:Props){
  const real=sources.filter(s=>!s.demo);
  const bySlot=new Map(real.map(s=>[s.slotId,s]));
  const slots=saved?.slots??[];
  const ready=slots.filter(s=>bySlot.has(s.id)).length;
  return <div className="saved-workspace">
    <div className="saved-workspace-summary"><span>{slots.length?ready+'/'+slots.length+' nguồn đã nạp':'Chưa lưu workspace'}</span>{slots.length>0&&<div className="slot-progress" role="progressbar" aria-label="Nguồn workspace đã nạp" aria-valuemin={0} aria-valuemax={slots.length} aria-valuenow={ready}><i style={{width:(100*ready/slots.length)+'%'}}/></div>}</div>
    <p className="muted small-text">Lưu tên nguồn, sheet, cấu trúc cột và cấu hình báo cáo. Không lưu file, nội dung ô hay kết quả; lần sau chọn file tương thích cho từng nguồn.</p>
    {slots.length>0&&<ul className="saved-slot-list" aria-label="Nguồn workspace đã lưu">{slots.map(slot=><Slot key={slot.id} slot={slot} loaded={bySlot.get(slot.id)} disabled={disabled} onAttach={onAttach} onForget={onForget} onActivate={onActivate}/>)}</ul>}
    <button className="button primary" disabled={disabled||!real.length} onClick={onSave}>Lưu workspace</button>
    <small className="source-local-note">Lưu tất cả nguồn thật đang mở; nguồn đã lưu nhưng chưa nạp vẫn được giữ. Tên nguồn, cột và giá trị bộ lọc có thể nhạy cảm.</small>
  </div>;
}
