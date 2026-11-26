import { compileProfile, compileDistribution, profileCount, finiteMetric } from './profile-model.ts';
import type { ColumnProfile, SourceProfile, Distribution } from './profile-model.ts';
import type { ManagedSource } from './source-model.ts';

type Row=Record<string,unknown>;
type QueryResult={get(index:number):unknown;[Symbol.iterator]():Iterator<unknown>};
type Query=(sql:string)=>Promise<QueryResult>;
function row(result:QueryResult):Row{
  const r=result.get(0);
  if(!r||typeof r!=='object')throw new Error('PROFILE_RESULT_INVALID: Không có kết quả thống kê.');
  return r as Row;
}

export async function profileSource(source:ManagedSource,query:Query):Promise<SourceProfile>{
  const {batches,duplicates}=compileProfile(source.id,source.columns);
  const columns:ColumnProfile[]=[];
  let missing=0;
  for(const batch of batches){
    const r=row(await query(batch.sql));
    if(profileCount(r.n,source.rows)!==source.rows)throw new Error('PROFILE_ROW_MISMATCH: Số dòng không khớp nguồn.');
    batch.columns.forEach((c,i)=>{
      const prefix='p'+i+'_',empty=profileCount(r[prefix+'missing'],source.rows);
      const nonEmpty=source.rows-empty;
      const distinct=profileCount(r[prefix+'distinct'],nonEmpty);
      const invalid=c.kind==='text'?null:profileCount(r[prefix+'invalid'],nonEmpty);
      const range=(key:'min'|'max'):number|string|null=>{
        const value=r[prefix+key];
        return c.kind==='number'?finiteMetric(value):c.kind==='date'&&value!=null?String(value):null;
      };
      columns.push({...c,missing:empty,distinct,invalid,min:range('min'),max:range('max'),
        sum:c.kind==='number'?finiteMetric(r[prefix+'sum']):null,
        average:c.kind==='number'?finiteMetric(r[prefix+'average']):null});
      missing+=empty;
    });
  }
  const d=row(await query(duplicates));
  const duplicateGroups=profileCount(d.duplicate_groups,source.rows);
  const duplicateRows=profileCount(d.duplicate_rows,source.rows);
  const duplicateExtra=profileCount(d.duplicate_extra,source.rows);
  if(duplicateRows-duplicateGroups!==duplicateExtra||duplicateRows<2*duplicateGroups)
    throw new Error('PROFILE_RESULT_INVALID: Thống kê trùng lặp không nhất quán.');
  return {sourceId:source.id,revision:source.revision,rows:source.rows,cells:source.rows*source.columns.length,missing,duplicateGroups,duplicateRows,duplicateExtra,columns};
}

export async function profileDistribution(source:ManagedSource,profile:SourceProfile,columnId:string,query:Query):Promise<Distribution>{
  const col=profile.columns.find(c=>c.id===columnId);
  if(!col||profile.sourceId!==source.id||profile.revision!==source.revision)
    throw new Error('PROFILE_STALE: Thống kê không còn tương thích với nguồn.');
  const nonEmpty=source.rows-col.missing;
  const values=Array.from(await query(compileDistribution(source.id,source.columns,columnId)),raw=>{
    const r=raw as Row|null;
    if(!r||typeof r.label!=='string')throw new Error('PROFILE_RESULT_INVALID: Phân bố không hợp lệ.');
    const count=profileCount(r.n,nonEmpty);
    if(!count)throw new Error('PROFILE_RESULT_INVALID: Tần suất không hợp lệ.');
    return {label:r.label,clipped:r.clipped===true,count};
  });
  const shown=values.reduce((sum,v)=>sum+v.count,0);
  if(shown>nonEmpty||values.length>col.distinct)throw new Error('PROFILE_RESULT_INVALID: Tần suất không nhất quán.');
  return {sourceId:source.id,revision:source.revision,columnId,nonEmpty,distinct:col.distinct,shown,values};
}
