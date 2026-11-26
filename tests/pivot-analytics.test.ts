import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPivotAnalytics,visiblePivotIndices,pivotAxisKey} from '../src/pivot-analytics.ts';
import {validatePivot} from '../src/pivot-config.ts';
import {compilePivotDrill} from '../src/pivot-engine.ts';
import {defaultConfig} from '../src/model.ts';
import type {PivotConfig,PivotResult} from '../src/pivot-config.ts';
import type {Column} from '../src/model.ts';
const columns:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Month',kind:'text'},{id:'c2',name:'Amount',kind:'number'}];
const pivot:PivotConfig={version:1,rows:['Region'],columns:['Month'],subtotals:true,measures:[{id:'m1',name:'Revenue',kind:'aggregate',aggregate:'sum',column:'Amount',format:'number',decimals:2,showAs:'grand'}],topN:{count:1,measureId:'m1'}};
const grand={level:0,labels:[]},n={level:1,labels:['N']},s={level:1,labels:['S']};
const result:PivotResult={rows:[n,s,grand],columns:[{level:1,labels:['Jan']},grand],values:[[30,30],[90,90],[120,120]]};
test('Top N ranks raw values and preserves full denominator and total',()=>{
 const r=applyPivotAnalytics(pivot,result);
 assert.deepEqual(r.rows,[s,grand]);assert.deepEqual(r.values,[[.75,.75],[1,1]]);
 assert.deepEqual(r.ranked,{shownLeaves:1,hiddenLeaves:1});
 assert.deepEqual(validatePivot(pivot),pivot);
 assert.throws(()=>validatePivot({...pivot,topN:{count:0,measureId:'m1'}}),/PIVOT_INVALID/);
});
test('row and column ratios use original totals; zero denominator is null',()=>{
 for(const showAs of ['row','column'] as const){
 const p:PivotConfig={...pivot,topN:undefined,measures:[{...pivot.measures[0],showAs}]};
 assert.deepEqual(applyPivotAnalytics(p,result).values,showAs==='row'?[[1,1],[1,1],[1,1]]:[[.25,.25],[.75,.75],[1,1]]);
 assert.deepEqual(applyPivotAnalytics(p,{...result,values:[[0,0],[0,0],[0,0]]}).values,[[null,null],[null,null],[null,null]]);
 }
});
test('collapse compares typed paths not formatted labels',()=>{
 const a={level:1,labels:[null]},b={level:2,labels:[null,'X']},c={level:2,labels:['(NULL)','X']};
 assert.deepEqual(visiblePivotIndices([a,b,c,grand],new Set([pivotAxisKey(a)])),[0,2,3]);
});
test('drill preserves existing filters, escapes keys and distinguishes NULL',()=>{
 const config={...defaultConfig(columns),pivot,filters:[{column:'Amount',operator:'gt' as const,value:'0'}]};
 const q=compilePivotDrill(config,columns,'source_s1',{level:1,labels:["O'Brien"]},{level:1,labels:[null]});
 assert.match(q.count,/TRY_CAST\("c2" AS DOUBLE\) > 0 AND "c0" = 'O''Brien' AND "c1" IS NULL/);
 assert.throws(()=>compilePivotDrill(config,columns,'source_s1',{level:2,labels:['a','b']},grand),/PIVOT_DRILL_INVALID/);
});
