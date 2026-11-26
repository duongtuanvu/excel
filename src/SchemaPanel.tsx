import {useState,useRef} from 'react';
import {UiIcon} from './UiIcons';
import {ErrorMessage} from './ErrorText';
import type {ManagedSource} from './source-model';
import type {Config} from './model';
import type {SchemaRule,SchemaMode,SchemaPreview} from './schema-model';
const modes:{value:SchemaMode;label:string}[]=[{value:'auto',label:'Tự nhận diện'},{value:'text',label:'Văn bản'},{value:'number',label:'Số chuẩn'},{value:'number-vi',label:'Số Việt Nam'},{value:'date',label:'Ngày YYYY-MM-DD'},{value:'date-vi',label:'Ngày DD/MM/YYYY'},{value:'boolean',label:'Logic'}];
type Props={source:ManagedSource;config:Config;disabled:boolean;onPreview:(source:ManagedSource,rules:SchemaRule[])=>Promise<SchemaPreview>;onApply:(source:ManagedSource,rules:SchemaRule[])=>Promise<void>};
export default function SchemaPanel({source,config,disabled,onPreview,onApply}:Props){
 const original=source.originalColumns??source.columns;
 const initial=()=>original.map(c=>source.schema?.find(r=>r.sourceName===c.name)??{sourceName:c.name,name:c.name,mode:'auto' as const});
 const [rules,setRules]=useState(initial),[opened,setOpened]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<SchemaPreview|null>(null),[checkedConfig,setCheckedConfig]=useState<Config|null>(null);
 const running=useRef(false);
 const ready=preview&&checkedConfig===config&&!preview.issues.length;
 function patch(i:number,part:Partial<SchemaRule>){setRules(r=>r.map((v,j)=>i===j?{...v,...part}:v));setPreview(null);setError('');}
 async function run(apply:boolean){
   if(disabled||running.current||(apply&&!ready))return;
   running.current=true;setPending(true);setError('');
   try{if(apply)await onApply(source,rules);else{setPreview(null);setPreview(await onPreview(source,rules));setCheckedConfig(config);}}
   catch(e){setError(e instanceof Error?e.message:'SCHEMA_FAILED: Không thể xử lý cấu trúc.');}
   finally{running.current=false;setPending(false);}
 }
 return <section className={'report-card schema-card'+(opened?' is-open':'')} aria-label="Cấu trúc cột"><div className="card-heading"><div className="card-title-row"><span className="tool-badge"><UiIcon name="schema" size={18}/></span><div><h2>Cấu trúc cột</h2><p>Đổi tên và kiểu dữ liệu từ workbook gốc</p></div></div><button type="button" className="button" disabled={disabled||pending} onClick={()=>setOpened(v=>!v)} aria-expanded={opened}><UiIcon name={opened?'chevronDown':'chevronRight'} size={15}/>{opened?'Thu gọn':'Chỉnh cấu trúc'}</button></div>
 {opened&&<div className="schema-body"><p className="profile-note">Số Việt Nam: 1.234,56. Ngày Việt Nam: 31/12/2026. Mã định danh có số 0 ở đầu nên chọn Văn bản. Chỉ giữ được số 0 vốn có trong giá trị gốc, không khôi phục định dạng hiển thị Excel.</p><div className="table-scroll schema-table"><table><thead><tr><th>Cột gốc</th><th>Tên báo cáo</th><th>Kiểu chuyển đổi</th><th>Lỗi</th></tr></thead><tbody>{rules.map((r,i)=><tr key={r.sourceName}><th scope="row">{r.sourceName}</th><td><input aria-label={'Tên cột '+r.sourceName} maxLength={240} value={r.name} disabled={disabled||pending} onChange={e=>patch(i,{name:e.target.value})}/></td><td><select aria-label={'Kiểu cột '+r.sourceName} value={r.mode} disabled={disabled||pending} onChange={e=>patch(i,{mode:e.target.value as SchemaMode})}>{modes.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select></td><td>{preview?preview.issues.find(v=>v.sourceName===r.sourceName)?.invalid??0:'—'}</td></tr>)}</tbody></table></div>
 {error&&<p role="alert" className="profile-error"><ErrorMessage text={error}/></p>}
 {preview&&<p role="status" className="profile-note">{preview.issues.length?'Có '+preview.issues.reduce((s,v)=>s+v.invalid,0)+' ô không chuyển đổi được. Chưa thay đổi dữ liệu.': 'Kiểm tra thành công: '+preview.rows+' dòng, không có lỗi chuyển đổi.'}{checkedConfig!==config?' Cấu hình báo cáo đã đổi; hãy kiểm tra lại.':''}</p>}
 <div className="schema-actions"><button type="button" className="button" disabled={disabled||pending} onClick={()=>{setRules(original.map(c=>({sourceName:c.name,name:c.name,mode:'auto'})));setPreview(null);setError('');}}><UiIcon name="refresh" size={14}/>Về schema gốc</button><button type="button" className="button" disabled={disabled||pending} onClick={()=>void run(false)}><UiIcon name="eye" size={14}/>Kiểm tra chuyển đổi</button><button type="button" className="button primary" disabled={disabled||pending||!ready} onClick={()=>void run(true)}><UiIcon name="check" size={14}/>Áp dụng cấu trúc</button></div><p className="profile-note">Không sửa file gốc. Quy tắc được lưu khi bấm Lưu workspace; thay file sẽ áp dụng lại quy tắc theo tên cột gốc.</p></div>}</section>;
}
