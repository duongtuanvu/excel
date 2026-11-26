import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileProfile, compileDistribution, profileCount, finiteMetric, PROFILE_LIMITS } from '../src/profile-model.ts';
import { profileSource, profileDistribution } from '../src/profile-engine.ts';
import type { Column } from '../src/model.ts';
import type { ManagedSource } from '../src/source-model.ts';
const columns:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Amount',kind:'number'}];
const source:ManagedSource={id:'s1',slotId:'fixture',alias:'Sales',bookId:'b1',revision:3,demo:false,name:'a.xlsx',sheet:'Sales',sheets:['Sales'],rows:6,columns};
const table=(rows:Record<string,unknown>[])=>({get:(index:number)=>rows[index]??null,[Symbol.iterator]:()=>rows[Symbol.iterator]()});
test('profile SQL uses only validated identifiers and bounded aggregate batches',()=>{
  const wide=Array.from({length:100},(_,i):Column=>({id:'c'+i,name:'untrusted; DROP TABLE x',kind:'number'}));
  const sql=compileProfile('s2',wide);
  assert.equal(sql.batches.length,Math.ceil(100/PROFILE_LIMITS.batchColumns));
  assert.ok(sql.batches.every(b=>b.columns.length<=PROFILE_LIMITS.batchColumns&&b.sql.endsWith(' FROM source_s2')&&!b.sql.includes('DROP TABLE')));
  assert.match(sql.duplicates,/GROUP BY "c0", "c1"/);
  assert.match(sql.duplicates,/CAST\(COALESCE\(SUM\(n\),0\) AS INTEGER\) AS duplicate_rows/);
  assert.match(sql.duplicates,/CAST\(COALESCE\(SUM\(n-1\),0\) AS INTEGER\) AS duplicate_extra/);
  assert.ok(sql.batches.every(b=>b.sql.includes('CAST(COUNT(*) AS INTEGER) AS n')));
  assert.throws(()=>compileProfile('s1;DROP TABLE x',columns));
  assert.throws(()=>compileProfile('s1',[{...columns[0],id:'c0"'}]));
  assert.throws(()=>compileProfile('s1',[columns[0],columns[0]]));
  assert.throws(()=>compileDistribution('s1',columns,'c2'));
  assert.match(compileDistribution('s1',columns,'c0'),/ORDER BY n DESC, v ASC LIMIT 10$/);
  assert.match(compileDistribution('s1',columns,'c0'),/left\(v,120\)/);
});
test('aggregate counts, finite metrics and duplicate definitions are validated',async()=>{
  const p=await profileSource(source,async sql=>sql.includes('duplicate_groups')
    ?table([{duplicate_groups:1n,duplicate_rows:2n,duplicate_extra:1n}])
    :table([{n:6n,p0_missing:2n,p0_distinct:2n,p1_missing:1n,p1_distinct:4n,p1_invalid:0n,p1_min:10,p1_max:40,p1_sum:110,p1_average:22}]));
  assert.equal(p.rows,6);assert.equal(p.cells,12);assert.equal(p.missing,3);
  assert.equal(p.duplicateExtra,1);assert.equal(p.duplicateRows,2);assert.equal(p.duplicateGroups,1);
  assert.equal(p.columns[0].invalid,null);assert.equal(p.columns[1].average,22);
  const d=await profileDistribution(source,p,'c0',async()=>table([{label:'A',clipped:false,n:2n},{label:'B',clipped:false,n:2n}]));
  assert.equal(d.nonEmpty,4);assert.equal(d.distinct,2);assert.equal(d.shown,4);
  await assert.rejects(()=>profileDistribution({...source,revision:4},p,'c0',async()=>table([])),/PROFILE_STALE/);
  await assert.rejects(()=>profileDistribution(source,p,'c0',async()=>table([{label:'A',n:5}])),/PROFILE_RESULT_INVALID/);
  await assert.rejects(()=>profileSource(source,async()=>table([{n:7}])),/PROFILE_RESULT_INVALID/);
  for(const n of [-1,NaN,Infinity,1.5,7,undefined,null])assert.throws(()=>profileCount(n,6));
  assert.equal(profileCount(2n,6),2);assert.equal(finiteMetric(Infinity),null);assert.equal(finiteMetric(null),null);
});
test('empty data produces zero counts and null numeric statistics',async()=>{
  const empty={...source,rows:0};
  const p=await profileSource(empty,async sql=>sql.includes('duplicate_groups')?table([{duplicate_groups:0,duplicate_rows:0,duplicate_extra:0}]):table([{n:0,p0_missing:0,p0_distinct:0,p1_missing:0,p1_distinct:0,p1_invalid:0,p1_min:null,p1_max:null,p1_sum:null,p1_average:null}]));
  assert.equal(p.missing,0);assert.equal(p.cells,0);assert.equal(p.columns[1].sum,null);
  const d=await profileDistribution(empty,p,'c1',async()=>table([]));
  assert.deepEqual(d.values,[]);assert.equal(d.nonEmpty,0);
});
