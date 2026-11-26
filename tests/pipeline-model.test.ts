import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileStep,newStep,validateRecipe,validateRecipes,stageSchema} from '../src/pipeline-model.ts';
import {modelStale} from '../src/data-model.ts';
import type {Column} from '../src/model.ts';
import type {PipelineRecipe} from '../src/pipeline-model.ts';
const cols:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Amount',kind:'number'}];
const recipe=(steps:PipelineRecipe['steps']):PipelineRecipe=>({version:1,name:'Clean',steps});
test('pipeline recipe validates bounded allow-listed steps and excludes raw data',()=>{
 const r=validateRecipe({...recipe([newStep('trim','Region')]),sample:['SECRET']});
 assert.equal('sample' in r,false);
 assert.throws(()=>validateRecipe(recipe([])),/PIPELINE_INVALID/);
 assert.throws(()=>validateRecipe(recipe(Array.from({length:17},()=>newStep('trim','Region')))),/PIPELINE_INVALID/);
 assert.throws(()=>validateRecipe(recipe([newStep('replace','Region')])),/PIPELINE_INVALID/);
 assert.throws(()=>validateRecipes([r,{...r,name:'clean'}]),/PIPELINE_NAME_DUPLICATE/);
 assert.throws(()=>validateRecipe({...r,steps:[{...r.steps[0],type:'sql'}]}),/PIPELINE_INVALID/);
});
test('compile validates table and column IDs, escapes literals, and guards replacement and cast',()=>{
 const step={...newStep('replace','Region'),value:"O'Brien",replacement:'VN'};
 const result=compileStep(step,cols,'source_s1');
 assert.match(result.sql,/O''Brien/);assert.match(result.guard??'',/32767/);
 assert.throws(()=>compileStep(step,cols,'source_s1;DROP TABLE x'),/PIPELINE_TABLE_INVALID/);
 assert.throws(()=>compileStep(step,[{...cols[0],id:'c0;DROP TABLE x'}],'source_s1'),/PIPELINE_SCHEMA_INVALID/);
 assert.throws(()=>compileStep(newStep('trim','Amount'),cols,'source_s1'),/PIPELINE_TEXT_REQUIRED/);
 assert.throws(()=>compileStep({...newStep('cast','Region'),target:'number'},[{...cols[0],name:'Other'}],'source_s1'),/PIPELINE_COLUMN_MISSING/);
 const cast=compileStep({...newStep('cast','Region'),target:'number'},cols,'source_s1');
 assert.equal(cast.columns[0].kind,'number');assert.match(cast.guard??'',/9007199254740991/);
 assert.throws(()=>compileStep({...newStep('filter','Region'),operator:'gt',value:'1'},cols,'source_s1'),/PIPELINE_FILTER_INVALID/);
});
test('ordered schema changes, disabled steps, duplicate names and drop-last guard',()=>{
 const steps=[{...newStep('rename','Region'),value:'Area'},newStep('trim','Area'),{...newStep('drop','Amount'),enabled:false},newStep('drop','Area')];
 const stages=stageSchema(recipe(steps),cols);
 assert.equal(stages[0][0].name,'Area');assert.equal(stages[2].length,2);assert.deepEqual(stages[3],[cols[1]]);
 assert.throws(()=>stageSchema(recipe([newStep('drop','Region'),newStep('drop','Amount')]),cols),/PIPELINE_SCHEMA_INVALID/);
 assert.throws(()=>compileStep({...newStep('rename','Region'),value:'Amount'},cols,'source_s1'),/PIPELINE_NAME_DUPLICATE/);
});
test('dependency invalidation traverses JOIN -> pipeline and rejects cycles',()=>{
 const joined={operation:'left' as const,leftId:'s1',leftRevision:1,rightId:'s2',rightRevision:1};
 const pipeline={operation:'pipeline' as const,leftId:'s3',leftRevision:1,rightId:'s3',rightRevision:1};
 const sources=[{id:'s1',revision:1},{id:'s2',revision:1},{id:'s3',revision:1,derived:joined}];
 assert.equal(modelStale(pipeline,sources),false);
 assert.equal(modelStale(pipeline,[{id:'s1',revision:2},...sources.slice(1)]),true);
 assert.equal(modelStale(pipeline,[sources[0],sources[1],{...sources[2],derived:pipeline}]),true);
});
