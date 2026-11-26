import { useState } from 'react';
import { UiIcon } from './UiIcons';
import type { ManagedSource } from './source-model';
import { WORKSPACE_LIMITS } from './source-model';
type Props={sources:ManagedSource[];active:ManagedSource|null;disabled:boolean;onActivate:(id:string)=>void;onSheet:(sheet:string)=>void;onRename:(id:string,alias:string)=>void;onRemove:(id:string)=>void;onReplace:()=>void};
const fmt=new Intl.NumberFormat('vi-VN');
export default function SourceManager({sources,active,disabled,onActivate,onSheet,onRename,onRemove,onReplace}:Props){
  const [edit,setEdit]=useState<string|null>(null),[alias,setAlias]=useState(''),[remove,setRemove]=useState<string|null>(null);
  return <div className="source-manager">
    <div className="source-manager-head"><strong>Nguồn đang mở</strong><span className="count-badge">{sources.length}/{WORKSPACE_LIMITS.sources}</span></div>
    {!sources.length&&<p className="muted small-text">Chưa có nguồn. Hãy thêm file Excel.</p>}
    <div className="source-list" aria-label="Danh sách nguồn dữ liệu">{sources.map(s=><div key={s.id} className={'source-entry'+(active?.id===s.id?' selected':'')+(s.stale?' stale':'')}>
      <button type="button" className="source-select" disabled={disabled||s.stale} aria-pressed={active?.id===s.id} aria-label={'Mở nguồn '+s.alias} onClick={()=>{setEdit(null);setRemove(null);onActivate(s.id);}}>
        <span className="source-glyph" aria-hidden="true"><UiIcon name={s.derived?(s.derived.operation==='pipeline'?'pipeline':'model'):'table'} size={15}/></span>
        <span className="source-copy">
          <strong title={s.alias}>{s.alias}</strong>
          <small title={s.name+' · '+s.sheet}>{s.derived?(s.stale?'Bảng kết quả hết hiệu lực':s.derived.operation==='pipeline'?'Bảng pipeline':'Bảng ghép · '+s.derived.operation.toUpperCase()):s.sheet} · {fmt.format(s.rows)} dòng · {s.columns.length} cột</small>
        </span>
      </button>
      {edit===s.id?<form className="source-edit" onSubmit={e=>{e.preventDefault();onRename(s.id,alias);setEdit(null);}}><input aria-label="Tên nguồn mới" required maxLength={100} value={alias} onChange={e=>setAlias(e.target.value)} disabled={disabled}/><button className="button primary" disabled={disabled}><UiIcon name="check" size={13}/>Lưu tên</button><button type="button" className="button" onClick={()=>setEdit(null)}>Hủy</button></form>
      :remove===s.id?<div className="source-edit"><span>Xóa nguồn và cấu hình trong phiên?</span><button className="button danger-button" disabled={disabled} onClick={()=>{onRemove(s.id);setRemove(null);}}>Xác nhận xóa nguồn</button><button className="button" onClick={()=>setRemove(null)}>Hủy</button></div>
      :<div className="source-actions"><button className="button" disabled={disabled} onClick={()=>{setAlias(s.alias);setEdit(s.id);setRemove(null);}}><UiIcon name="edit" size={12}/>Đổi tên</button><button className="button" disabled={disabled} onClick={()=>{setRemove(s.id);setEdit(null);}}><UiIcon name="trash" size={12}/>Xóa</button></div>}
    </div>)}</div>
    {active?.derived&&<p className="source-local-note">Lưu workspace để ghi nhớ các bước xử lý. Dùng Chạy kỳ mới để tính lại từ file mới.</p>}
    {active&&!active.derived&&<div className="source-detail"><label className="field"><span>Sheet</span><select aria-label="Sheet" data-testid="source-sheet" disabled={disabled} value={active.sheet} onChange={e=>onSheet(e.target.value)}>{active.sheets.map(s=><option key={s} value={s}>{s}</option>)}</select></label><button className="button" disabled={disabled} onClick={onReplace}><UiIcon name="refresh" size={14}/>Thay file nguồn hiện tại</button><small>Thay file chỉ tác động nguồn đang chọn. Cột thiếu hoặc đổi kiểu sẽ bị từ chối. Sheet khác được giữ nguyên.</small></div>}
    <p className="source-local-note">File chỉ nằm trên thiết bị. Dùng Workspace tài khoản để lưu cấu trúc nguồn và cấu hình báo cáo; xóa nguồn đang mở không tự xóa bản cấu hình đã lưu.</p>
  </div>;
}
