import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validateBatchFiles,checkBatchPeak,swapBatchTables,batchStage} from '../src/batch-model.ts';
const f=(sourceId:string)=>({sourceId,revision:1,name:'data.xlsx',bytes:new ArrayBuffer(4)});
test('batch rejects duplicate, invalid, stale and oversized selections',()=>{
 assert.equal(validateBatchFiles([f('s1'),f('s2')]).length,2);
 assert.throws(()=>validateBatchFiles([f('s1')]),/BATCH_COUNT_INVALID/);
 assert.throws(()=>validateBatchFiles([f('s1'),f('s1')]),/BATCH_SOURCE_DUPLICATE/);
 assert.throws(()=>validateBatchFiles([f('s1'),f('s2;DROP TABLE x')]),/SOURCE_ID_INVALID/);
 assert.throws(()=>validateBatchFiles([f('s1'),{...f('s2'),revision:0}]),/BATCH_SOURCE_STALE/);
 assert.throws(()=>validateBatchFiles([f('s1'),{...f('s2'),bytes:new ArrayBuffer(0)}]),/BATCH_FILE_INVALID/);
 assert.throws(()=>checkBatchPeak([{bytes:1,cells:4_000_001,sheets:1}],[]),/BATCH_STAGING_LIMIT/);
 assert.equal(batchStage('s2'),'batch_stage_source_s2');
});
test('atomic swap rolls back first table when second swap fails, then commits valid batch',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
 db.exec('CREATE TABLE source_s1(v INTEGER); INSERT INTO source_s1 VALUES(10); CREATE TABLE source_s2(v INTEGER); INSERT INTO source_s2 VALUES(20); CREATE TABLE batch_stage_source_s1(v INTEGER); INSERT INTO batch_stage_source_s1 VALUES(100);');
 const query=async(sql:string)=>db.exec(sql);
 await assert.rejects(()=>swapBatchTables(['s1','s2'],query),/BATCH_TRANSACTION_FAILED/);
 assert.equal(db.prepare('SELECT v FROM source_s1').get()?.v,10);
 assert.equal(db.prepare('SELECT v FROM source_s2').get()?.v,20);
 assert.equal(db.prepare('SELECT v FROM batch_stage_source_s1').get()?.v,100);
 db.exec('CREATE TABLE batch_stage_source_s2(v INTEGER); INSERT INTO batch_stage_source_s2 VALUES(200)');
 await swapBatchTables(['s1','s2'],query);
 assert.equal(db.prepare('SELECT v FROM source_s1').get()?.v,100);
 assert.equal(db.prepare('SELECT v FROM source_s2').get()?.v,200);
 }finally{db.close();}
});
test('unverified rollback has a distinct fail-closed error',async()=>{
 await assert.rejects(()=>swapBatchTables(['s1','s2'],async sql=>{if(sql!=='BEGIN TRANSACTION')throw Error('injected failure');}),/BATCH_ROLLBACK_FAILED/);
});
