import { useEffect, useRef, useState } from 'react';
import type { ManagedSource } from './source-model';
import type { ColumnProfile, Distribution, SourceProfile } from './profile-model';

const fmt=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:6});
const percent=new Intl.NumberFormat('vi-VN',{style:'percent',maximumFractionDigits:1});
const show=(v:number|string|null)=>v==null?'—':typeof v==='number'?fmt.format(v):v;
const ratio=(n:number,d:number)=>d?percent.format(n/d):'—';
const kinds={number:'Số',text:'Văn bản',date:'Ngày',boolean:'Logic'};
type Props={source:ManagedSource;disabled:boolean;onProfile:(source:ManagedSource)=>Promise<SourceProfile>;onDistribution:(source:ManagedSource,columnId:string)=>Promise<Distribution>};

function Stat({label,value,detail,id}:{label:string;value:number;detail:string;id:string}){
  return <div className="profile-stat"><span>{label}</span><strong data-testid={id}>{fmt.format(value)}</strong><small>{detail}</small></div>;
}
function ColumnRow({column,rows}:{column:ColumnProfile;rows:number}){
  const invalid=column.invalid;
  return <tr>
    <th scope="row" className="profile-column"><span title={column.name}>{column.name}</span><small>{kinds[column.kind]}</small></th>
    <td className="numeric"><strong>{fmt.format(column.missing)}</strong><small className="profile-muted">{ratio(column.missing,rows)}</small></td>
    <td className="numeric">{fmt.format(column.distinct)}</td>
    <td className="numeric">{invalid==null?'—':fmt.format(invalid)}<small className="profile-muted">{invalid==null?'':ratio(invalid,rows-column.missing)}</small></td>
    <td className="numeric">{show(column.min)}</td><td className="numeric">{show(column.max)}</td>
    <td className="numeric">{show(column.sum)}</td><td className="numeric">{show(column.average)}</td>
  </tr>;
}
export default function ProfilePanel({source,disabled,onProfile,onDistribution}:Props){
  const [profile,setProfile]=useState<SourceProfile|null>(null);
  const [distribution,setDistribution]=useState<Distribution|null>(null);
  const [columnId,setColumnId]=useState(source.columns[0]?.id??'');
  const [pending,setPending]=useState<'profile'|'distribution'|null>(null);
  const [error,setError]=useState('');
  const alive=useRef(true), running=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const matches=(v:{sourceId:string;revision:number})=>v.sourceId===source.id&&v.revision===source.revision;
  const current=profile&&matches(profile)?profile:null;
  const selected=current?.columns.find(c=>c.id===columnId);
  const values=distribution&&matches(distribution)&&distribution.columnId===columnId?distribution:null;
  const locked=disabled||pending!==null;
  async function run(kind:'profile'|'distribution'){
    if(locked||running.current)return;
    running.current=true;setPending(kind);setError('');
    try{
      if(kind==='profile'){
        const result=await onProfile(source);
        if(!matches(result))throw new Error('PROFILE_STALE: Nguồn dữ liệu đã thay đổi.');
        if(alive.current){setProfile(result);setDistribution(null);}
      }else{
        if(!selected)return;
        const result=await onDistribution(source,columnId);
        if(!matches(result)||result.columnId!==columnId)throw new Error('PROFILE_STALE: Nguồn hoặc cột đã thay đổi.');
        if(alive.current)setDistribution(result);
      }
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'PROFILE_FAILED: Không thể thống kê dữ liệu.');}
    finally{running.current=false;if(alive.current)setPending(null);}
  }
  return <section className="report-card profile-card" aria-label="Chất lượng dữ liệu">
    <div className="card-heading profile-heading"><div><span className="profile-kicker">DATA QUALITY / LOCAL</span><h2>Chất lượng dữ liệu</h2><p>Toàn bộ nguồn hiện tại · không áp dụng bộ lọc báo cáo</p></div><button type="button" className="button primary" disabled={locked} onClick={()=>void run('profile')}>{current?'Tính lại thống kê':'Phân tích chất lượng'}</button></div>
    {pending==='profile'&&<div className="profile-status" role="status"><span className="spinner"/> Đang tính thống kê nguồn…</div>}
    {error&&<div className="profile-error" role="alert">{error}</div>}
    {!current&&pending!=='profile'&&<div className="profile-empty"><strong>Hiểu dữ liệu trước khi lập báo cáo.</strong><p>Kiểm tra ô trống, giá trị khác nhau, bản ghi trùng và thống kê từng cột. Chỉ chạy khi bạn yêu cầu; kết quả không gửi lên máy chủ.</p></div>}
    {current&&<div className="profile-content">
      <div className="profile-stats">
        <Stat label="Dòng dữ liệu" value={current.rows} detail={fmt.format(current.columns.length)+' cột'} id="profile-rows"/>
        <Stat label="Ô trống" value={current.missing} detail={ratio(current.missing,current.cells)+' tổng số ô'} id="profile-missing"/>
        <Stat label="Nhóm dòng trùng" value={current.duplicateGroups} detail={fmt.format(current.duplicateRows)+' dòng thuộc nhóm trùng'} id="profile-groups"/>
        <Stat label="Dòng trùng dư" value={current.duplicateExtra} detail="Nếu giữ một dòng mỗi nhóm" id="profile-duplicates"/>
      </div>
      <p className="profile-note">Ô trống gồm NULL, chuỗi rỗng và chuỗi chỉ có dấu cách. Dòng trùng được so sánh trên toàn bộ các cột đã nhập; không tự xóa dữ liệu.</p>
      <h3>Thống kê theo cột</h3>
      <div className="table-scroll profile-table" tabIndex={0} role="region" aria-label="Thống kê theo cột">
        <table><thead><tr><th scope="col">Cột / kiểu</th><th scope="col" className="numeric">Trống</th><th scope="col" className="numeric">Khác nhau</th><th scope="col" className="numeric">Sai kiểu</th><th scope="col" className="numeric">Min</th><th scope="col" className="numeric">Max</th><th scope="col" className="numeric">Tổng</th><th scope="col" className="numeric">Trung bình</th></tr></thead>
        <tbody>{current.columns.map(c=><ColumnRow key={c.id} column={c} rows={current.rows}/>)}</tbody></table>
      </div>
      <p className="profile-note">Giá trị khác nhau không tính ô trống. Sai kiểu tính trên giá trị không trống, theo kiểu đã nhận diện sau import. Cột văn bản (kể cả cột chứa kiểu hỗn hợp) không đánh giá lỗi parse; dấu — nghĩa là không áp dụng hoặc không có giá trị hữu hạn. Số dùng DOUBLE.</p>
      <div className="profile-distribution">
        <div className="profile-distribution-head"><div><h3>Phân bố giá trị</h3><p>Top 10 giá trị theo tần suất, không tính ô trống</p></div><div className="profile-controls"><label className="field"><span>Cột phân bố</span><select aria-label="Cột phân bố" value={columnId} disabled={locked} onChange={e=>{setColumnId(e.target.value);setDistribution(null);setError('');}}>{current.columns.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><button type="button" className="button" disabled={locked||!selected} onClick={()=>void run('distribution')}>Xem phân bố</button></div></div>
        {pending==='distribution'&&<div className="profile-status" role="status"><span className="spinner"/> Đang tính phân bố…</div>}
        {values&&<div className="profile-values" data-testid="profile-distribution">
          <p className="profile-note">{fmt.format(values.distinct)} giá trị khác nhau · {fmt.format(values.nonEmpty)} ô không trống · hiển thị {ratio(values.shown,values.nonEmpty)}</p>
          {values.values.length===0?<p className="profile-note">Không có giá trị không trống.</p>:values.values.map((v,i)=><div className="profile-value" key={i}><span className="profile-value-label" title={v.label}>{v.label}{v.clipped?'…':''}</span><div className="profile-track" aria-hidden="true"><i style={{width:(100*v.count/Math.max(1,values.nonEmpty))+'%'}}/></div><strong>{fmt.format(v.count)} <small>({ratio(v.count,values.nonEmpty)})</small></strong></div>)}
          {values.nonEmpty>values.shown&&<div className="profile-value profile-other"><span>Giá trị còn lại</span><div className="profile-track" aria-hidden="true"><i style={{width:(100*(values.nonEmpty-values.shown)/Math.max(1,values.nonEmpty))+'%'}}/></div><strong>{fmt.format(values.nonEmpty-values.shown)}</strong></div>}
        </div>}
      </div>
    </div>}
  </section>;
}
