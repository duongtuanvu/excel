import {LIMITS,normalizeHeaders} from './model.ts';
import type {Column} from './model.ts';
import {normalizeAlias,sourceTable} from './source-model.ts';
import type {ManagedSource} from './source-model.ts';

export const MODEL_OPERATIONS=['inner','left','right','full','union','union-all'] as const;
export type ModelOperation=typeof MODEL_OPERATIONS[number];
export type ModelPair={left:string;right:string};
export type ModelInput={leftId:string;leftRevision:number;rightId:string;rightRevision:number;operation:ModelOperation;alias:string;pairs:ModelPair[]};
export type ModelOrigin={operation:ModelOperation|'pipeline';leftId:string;leftRevision:number;rightId:string;rightRevision:number};
export type ModelStats={matchedPairs:number;matchedLeft:number;matchedRight:number;unmatchedLeft:number;unmatchedRight:number;leftDuplicateKeys:number;rightDuplicateKeys:number;manyToManyKeys:number;cardinality:'none'|'1:1'|'1:N'|'N:1'|'N:N';expansion:boolean};
export type ModelPreview={rows:number;columns:Column[];chars:number;stats:ModelStats|null;removedDuplicates:number|null};
export const MODEL_LABELS:Record<ModelOperation,string>={inner:'INNER JOIN',left:'LEFT JOIN',right:'RIGHT JOIN',full:'FULL OUTER JOIN',union:'UNION', 'union-all':'UNION ALL'};
export const isUnion=(op:ModelOperation)=>op==='union'||op==='union-all';
export function modelStale(origin:ModelOrigin,sources:readonly (Pick<ManagedSource,'id'|'revision'>&Partial<Pick<ManagedSource,'derived'>>)[],path=new Set<string>()):boolean{
 const check=(id:string,revision:number):boolean=>{
   const s=sources.find(x=>x.id===id&&x.revision===revision);
   if(!s||path.has(id))return true;
   return !!s.derived&&modelStale(s.derived,sources,new Set([...path,id]));
 };
 return check(origin.leftId,origin.leftRevision)||check(origin.rightId,origin.rightRevision);
}
export function defaultPairs(left:ManagedSource,right:ManagedSource,operation:ModelOperation):ModelPair[]{
 if(isUnion(operation))return left.columns.map(c=>({left:c.id,right:right.columns.find(r=>r.name===c.name&&r.kind===c.kind)?.id??''}));
 const match=left.columns.find(c=>right.columns.some(r=>r.name===c.name&&r.kind===c.kind));
 return [{left:match?.id??left.columns[0]?.id??'',right:match?right.columns.find(r=>r.name===match.name&&r.kind===match.kind)!.id:''}];
}
function checkedColumns(source:ManagedSource){
 if(!source.columns.length||source.columns.length>LIMITS.columns||new Set(source.columns.map(c=>c.id)).size!==source.columns.length)throw new Error('MODEL_SCHEMA_INVALID: Schema nguồn không hợp lệ.');
 for(const c of source.columns)if(!/^c(?:0|[1-9][0-9]?)$/.test(c.id)||!['number','text','date','boolean'].includes(c.kind))throw new Error('MODEL_SCHEMA_INVALID: Mã hoặc kiểu cột không hợp lệ.');
}
const q=(c:string)=>'"'+c+'"';
function validKey(alias:string,ids:string[]){
 return ids.map(id=>alias+'.'+q(id)+' IS NOT NULL AND trim('+alias+'.'+q(id)+") <> ''").join(' AND ');
}
export function compileModel(input:ModelInput,left:ManagedSource,right:ManagedSource,aliases:readonly string[]){
 if(!input||!MODEL_OPERATIONS.includes(input.operation)||left.id===right.id||left.demo||right.demo||left.derived||right.derived)throw new Error('MODEL_SOURCE_INVALID: Chọn hai nguồn gốc khác nhau.');
 if(input.leftId!==left.id||input.rightId!==right.id||input.leftRevision!==left.revision||input.rightRevision!==right.revision)throw new Error('MODEL_STALE: Nguồn đã thay đổi, hãy kiểm tra lại.');
 checkedColumns(left);checkedColumns(right);
 const alias=normalizeAlias(input.alias,aliases),lt=sourceTable(left.id),rt=sourceTable(right.id),union=isUnion(input.operation);
 if(!Array.isArray(input.pairs)||input.pairs.length<1||input.pairs.length>(union?LIMITS.columns:3))throw new Error('MODEL_KEYS_INVALID: JOIN cần 1–3 cặp khóa; UNION cần ghép đủ cột.');
 const usedL=new Set<string>(),usedR=new Set<string>();
 const pairs=input.pairs.map(p=>{
   if(!p||typeof p!=='object')throw new Error('MODEL_KEYS_INVALID: Cặp cột không hợp lệ.');
   const l=left.columns.find(c=>c.id===p.left),r=right.columns.find(c=>c.id===p.right);
   if(!l||!r||usedL.has(l.id)||usedR.has(r.id))throw new Error('MODEL_KEYS_INVALID: Chọn cột hợp lệ, không trùng.');
   if(l.kind!==r.kind)throw new Error('MODEL_KEY_TYPE: Kiểu cột không khớp: '+l.name+' / '+r.name+'.');
   usedL.add(l.id);usedR.add(r.id);return {l,r};
 });
 if(union){
   if(pairs.length!==left.columns.length||pairs.length!==right.columns.length)throw new Error('MODEL_UNION_SCHEMA: Hai bảng phải cùng số cột và ghép đủ mỗi cột một lần.');
   const columns=left.columns.map((c,i)=>({...c,id:'c'+i}));
   const ordered=left.columns.map(c=>pairs.find(p=>p.l.id===c.id)!);
   const select=(side:'l'|'r')=>ordered.map((p,i)=>q(p[side].id)+' AS '+q(columns[i].id)).join(', ');
   const sql='SELECT '+select('l')+' FROM '+lt+(input.operation==='union-all'?' UNION ALL ':' UNION ')+'SELECT '+select('r')+' FROM '+rt;
   return {alias,columns,sql,statsSql:null};
 }
 if(left.columns.length+right.columns.length>LIMITS.columns)throw new Error('MODEL_COLUMNS_LIMIT: Bảng JOIN tối đa 100 cột.');
 const names=normalizeHeaders([...left.columns.map(c=>'Trái · '+c.name),...right.columns.map(c=>'Phải · '+c.name)]);
 const columns=[...left.columns,...right.columns].map((c,i)=>({id:'c'+i,name:names[i],kind:c.kind}));
 const projection=[...left.columns.map(c=>'l.'+q(c.id)),...right.columns.map(c=>'r.'+q(c.id))].map((expr,i)=>expr+' AS '+q(columns[i].id)).join(', ');
 const leftIds=pairs.map(p=>p.l.id),rightIds=pairs.map(p=>p.r.id);
 const condition=pairs.map(p=>'l.'+q(p.l.id)+' = r.'+q(p.r.id)).concat([validKey('l',leftIds),validKey('r',rightIds)]).join(' AND ');
 const join={inner:'INNER JOIN',left:'LEFT JOIN',right:'RIGHT JOIN',full:'FULL OUTER JOIN'}[input.operation as 'inner'|'left'|'right'|'full'];
 const sql='SELECT '+projection+' FROM '+lt+' AS l '+join+' '+rt+' AS r ON '+condition;
 const grouped=(table:string,ids:string[])=>'SELECT '+ids.map((id,i)=>'x.'+q(id)+' AS k'+i).join(', ')+', CAST(COUNT(*) AS DOUBLE) AS n FROM '+table+' AS x WHERE '+validKey('x',ids)+' GROUP BY '+ids.map((_,i)=>'k'+i).join(', ');
 const match=idsMatch(pairs.length);
 // Count matches over grouped keys, never expand the input Cartesian product.
 const statsSql='WITH a AS ('+grouped(lt,leftIds)+'), b AS ('+grouped(rt,rightIds)+') SELECT '+
 'COALESCE(SUM(CASE WHEN a.n IS NOT NULL AND b.n IS NOT NULL THEN a.n*b.n ELSE 0 END),0) AS pairs, '+
 'COALESCE(SUM(CASE WHEN b.n IS NOT NULL THEN a.n ELSE 0 END),0) AS matched_l, '+
 'COALESCE(SUM(CASE WHEN a.n IS NOT NULL THEN b.n ELSE 0 END),0) AS matched_r, '+
 'CAST(COUNT(*) FILTER (WHERE a.n>1) AS DOUBLE) AS dup_l, CAST(COUNT(*) FILTER (WHERE b.n>1) AS DOUBLE) AS dup_r, '+
 'CAST(COUNT(*) FILTER (WHERE a.n>1 AND b.n>1) AS DOUBLE) AS both_dup FROM a FULL OUTER JOIN b ON '+match;
 return {alias,columns,sql,statsSql};
}
function idsMatch(n:number){return Array.from({length:n},(_,i)=>'a.k'+i+' = b.k'+i).join(' AND ');}
function count(value:unknown,max:number):number{
 if(!['number','bigint','string'].includes(typeof value)||value==='')throw new Error('MODEL_STATS_INVALID: Thiếu thống kê.');
 const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error('MODEL_STATS_INVALID: Thống kê ngoài giới hạn.');return n;
}
export function readModelStats(row:Record<string,unknown>,leftRows:number,rightRows:number):ModelStats{
 const matchedPairs=count(row.pairs,leftRows*rightRows),matchedLeft=count(row.matched_l,leftRows),matchedRight=count(row.matched_r,rightRows);
 const leftDuplicateKeys=count(row.dup_l,leftRows),rightDuplicateKeys=count(row.dup_r,rightRows),manyToManyKeys=count(row.both_dup,Math.min(leftDuplicateKeys,rightDuplicateKeys));
 if(matchedPairs<Math.max(matchedLeft,matchedRight)||(matchedPairs===0&&(matchedLeft!==0||matchedRight!==0))||(matchedPairs>0&&(!matchedLeft||!matchedRight)))throw new Error('MODEL_STATS_INVALID: Số dòng khớp không nhất quán.');
 const lMany=matchedPairs>matchedRight,rMany=matchedPairs>matchedLeft;
 return {matchedPairs,matchedLeft,matchedRight,unmatchedLeft:leftRows-matchedLeft,unmatchedRight:rightRows-matchedRight,leftDuplicateKeys,rightDuplicateKeys,manyToManyKeys,cardinality:matchedPairs===0?'none':lMany?(rMany?'N:N':'N:1'):(rMany?'1:N':'1:1'),expansion:lMany||rMany};
}
export function joinRows(op:ModelOperation,s:ModelStats):number{
 if(isUnion(op))throw new Error('MODEL_OPERATION_INVALID: Không phải JOIN.');
 return s.matchedPairs+((op==='left'||op==='full')?s.unmatchedLeft:0)+((op==='right'||op==='full')?s.unmatchedRight:0);
}
export function checkModelSize(rows:number,columns:number){
 if(!Number.isSafeInteger(rows)||rows<0||rows>LIMITS.rows||!Number.isSafeInteger(columns)||columns<1||columns>LIMITS.columns||rows*columns>LIMITS.cells)throw new Error('MODEL_OUTPUT_LIMIT: Kết quả vượt 100.000 dòng, 100 cột hoặc 1 triệu ô. Hãy giảm dữ liệu hoặc sửa khóa JOIN.');
}
export function modelCount(value:unknown,max:number){return count(value,max);}
export function modelSizeSql(sql:string,columns:Column[]):string{
 // Conservative CSV budget: UTF-8 byte count, doubled for escaped quotes, plus delimiters.
 const parts=columns.map(c=>{
   if(!/^c(?:0|[1-9][0-9]?)$/.test(c.id))throw new Error('MODEL_SCHEMA_INVALID');
   return "(2*octet_length(encode(coalesce("+q(c.id)+", '')))+3)";
 });
 return 'SELECT CAST(COUNT(*) AS DOUBLE) AS n, COALESCE(SUM(CAST('+parts.join(' + ')+' AS DOUBLE)),0) AS chars FROM ('+sql+') AS result';
}
