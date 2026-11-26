import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileModel,readModelStats,joinRows,checkModelSize,modelStale} from '../src/data-model.ts';
import type {ManagedSource} from '../src/source-model.ts';
import type {ModelInput} from '../src/data-model.ts';
const source=(id:string):ManagedSource=>({id,slotId:id,alias:id,bookId:id,revision:1,demo:false,name:id,sheet:'Data',sheets:['Data'],rows:4,columns:[{id:'c0',name:'Key',kind:'text'},{id:'c1',name:'Amount',kind:'number'}]});
const l=source('s1'),r=source('s2');
const input:ModelInput={leftId:l.id,leftRevision:1,rightId:r.id,rightRevision:1,operation:'left',alias:'Result',pairs:[{left:'c0',right:'c0'}]};
test('join compiler validates revisions, distinct sources, identifiers and key kinds',()=>{
 const result=compileModel(input,l,r,[]);
 assert.match(result.sql,/LEFT JOIN source_s2/);
 assert.match(result.sql,/trim\(l\."c0"\) <> ''/);
 assert.equal(result.columns.length,4);
 assert.throws(()=>compileModel({...input,leftRevision:0},l,r,[]),/MODEL_STALE/);
 assert.throws(()=>compileModel({...input,pairs:[{left:'c0',right:'c1'}]},l,r,[]),/MODEL_KEY_TYPE/);
 assert.throws(()=>compileModel({...input,pairs:[{left:'c0;DROP TABLE x',right:'c0'}]},l,r,[]),/MODEL_KEYS_INVALID/);
 assert.throws(()=>compileModel(input,l,r,['Result']));
});
test('cardinality and bounded join count calculations',()=>{
 const stats=readModelStats({pairs:6,matched_l:3,matched_r:2,dup_l:1,dup_r:1,both_dup:1},4,4);
 assert.equal(stats.cardinality,'N:N');assert.equal(stats.expansion,true);
 assert.equal(joinRows('inner',stats),6);assert.equal(joinRows('left',stats),7);assert.equal(joinRows('right',stats),8);assert.equal(joinRows('full',stats),9);
 assert.throws(()=>checkModelSize(100001,2),/MODEL_OUTPUT_LIMIT/);
 assert.throws(()=>checkModelSize(100000,11),/MODEL_OUTPUT_LIMIT/);
 assert.throws(()=>readModelStats({pairs:1,matched_l:2,matched_r:1,dup_l:0,dup_r:0,both_dup:0},4,4),/MODEL_STATS_INVALID/);
});
test('union uses explicit bijection, and dependency changes invalidate snapshots',()=>{
 const union={...input,operation:'union-all' as const,pairs:[{left:'c1',right:'c1'},{left:'c0',right:'c0'}]};
 assert.match(compileModel(union,l,r,[]).sql,/UNION ALL/);
 assert.throws(()=>compileModel({...union,pairs:[union.pairs[0]]},l,r,[]),/MODEL_UNION_SCHEMA/);
 assert.equal(modelStale(input,[l,r]),false);
 assert.equal(modelStale(input,[l,{...r,revision:2}]),true);
 assert.equal(modelStale(input,[l]),true);
});
