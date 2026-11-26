import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindRecipe,compileModel,modelOrigin} from '../src/data-model.ts';
import type {ModelInput} from '../src/data-model.ts';
import {defaultConfig} from '../src/model.ts';
import type {Column} from '../src/model.ts';
import {newStep} from '../src/pipeline-model.ts';
import {periodPlan,snapshotWorkspace,validateWorkspace,withoutSavedSource} from '../src/workspace-model.ts';
import {validatePeriodFiles} from '../src/period-model.ts';
import type {ManagedSource} from '../src/source-model.ts';

const columns:Column[]=[{id:'c0',name:'Item',kind:'text'},{id:'c1',name:'Qty',kind:'number'}];
function table(id:string):ManagedSource{
  return {id,slotId:crypto.randomUUID(),alias:id,bookId:id,revision:1,demo:false,name:id,sheet:'Data',sheets:['Data'],rows:2,columns};
}
function combine(left:ManagedSource,right:ManagedSource,id:string,operation:ModelInput['operation']):ManagedSource{
  const input={leftId:left.id,leftRevision:1,rightId:right.id,rightRevision:1,alias:id,operation,
    pairs:(operation==='union-all'?left.columns:[left.columns[0]]).map(c=>({left:c.id,right:c.id}))};
  return {...table(id),columns:compileModel(input,left,right,[]).columns,derived:modelOrigin(input,left,right)};
}
function graph(){
  const a=table('s1'),b=table('s2'),c=table('s3'),unrelated=table('s4');
  const union=combine(a,b,'s5','union-all'),joined=combine(union,c,'s6','left');
  const clean:ManagedSource={...table('s7'),columns:joined.columns,derived:{operation:'pipeline',leftId:joined.id,rightId:joined.id,
    leftRevision:1,rightRevision:1,leftSlotId:joined.slotId,leftColumns:joined.columns.map(col=>col.name),
    recipe:{version:1,name:'Clean',steps:[newStep('trim',joined.columns[0].name)]}}};
  const saved=snapshotWorkspace(null,[a,b,c,unrelated,union,joined,clean],s=>({...defaultConfig(s.columns),title:s.alias}),clean.slotId);
  return {saved,a,b,c,union,joined,clean,unrelated};
}
test('saved report selects only its dependencies and persists a chained UNION, JOIN and transformation',()=>{
  const {saved,a,b,c,union,joined,clean,unrelated}=graph();
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(saved))),saved);
  const p=periodPlan(saved,saved.outputId!);
  assert.deepEqual(p.slots.map(s=>s.id),[a.slotId,b.slotId,c.slotId]);
  assert.deepEqual(p.models.map(s=>s.id),[union.slotId,joined.slotId,clean.slotId]);
  assert.deepEqual(periodPlan(saved,unrelated.slotId).models,[]);
  assert.throws(()=>withoutSavedSource(saved,b.slotId),/DEPENDENCY/);
  assert.equal(withoutSavedSource(saved,clean.slotId)?.outputId,undefined);
  assert.throws(()=>validateWorkspace({...saved,models:saved.models!.toReversed()}),/DEPENDENCY/);
  assert.throws(()=>validateWorkspace({...saved,outputId:crypto.randomUUID()}),/OUTPUT_INVALID/);
  assert.throws(()=>validateWorkspace({...saved,models:saved.models!.map((m,i)=>i===0?{...m,leftColumns:['Missing']}:m)}),/COLUMN_MISSING/);
});
test('period replay rebinds columns by name after reordering and keeps the saved UNION projection',()=>{
  const {saved,a,b}=graph(),recipe=saved.models![0];
  assert.ok(recipe.operation==='union-all');
  const changed={...a,columns:[{id:'c0',name:'Remark',kind:'text' as const},{...columns[1],id:'c1'},{...columns[0],id:'c2'}]};
  const rebound=bindRecipe(recipe,recipe.alias,changed,b);
  const compiled=compileModel(rebound.input,rebound.left,rebound.right,[]);
  assert.match(compiled.sql,/SELECT "c2" AS "c0", "c1" AS "c1"/);
  assert.deepEqual(compiled.columns.map(col=>col.name),['Item','Qty']);
});
test('period requires new files for exactly the selected report inputs, including single-source reports',()=>{
  const {saved,a}=graph(),slots=periodPlan(saved,a.slotId).slots;
  const file={slotId:a.slotId,name:'new.csv',bytes:new ArrayBuffer(12)};
  assert.equal(validatePeriodFiles(slots,[file]).get(a.slotId),file);
  assert.throws(()=>validatePeriodFiles(slots,[]),/PERIOD_FILES/);
  assert.throws(()=>validatePeriodFiles(saved.slots.slice(0,2),[file,file]),/PERIOD_FILES/);
  assert.throws(()=>validatePeriodFiles(slots,[{...file,slotId:'wrong'}]),/PERIOD_FILES/);
  assert.throws(()=>validatePeriodFiles(slots,[{...file,name:'bad.pdf'}]),/PERIOD_FILE_INVALID/);
});
