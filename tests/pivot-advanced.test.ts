import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExpression,evaluateExpression,compileExpression,columnRef} from '../src/pivot-expression.ts';
import {validatePivot,renamePivot} from '../src/pivot-config.ts';
import {applyTimeMeasures} from '../src/pivot-time.ts';
import type {PivotConfig,PivotResult} from '../src/pivot-config.ts';
test('bounded expressions preserve precedence, null semantics and reject injection',()=>{
 const e=parseExpression('IF([A] > 0, ABS([A] - 5) * 2, COALESCE([B], 0))','row');
 assert.equal(evaluateExpression(e,n=>n==='A'?2:null),6);
 assert.equal(evaluateExpression(e,()=>null),0);
 assert.equal(evaluateExpression(parseExpression('1 / 0','row'),()=>null),null);
 assert.equal(evaluateExpression(parseExpression('2 + 3 * 4','row'),()=>null),14);
 assert.equal(evaluateExpression(parseExpression(columnRef('A]B'),'row'),n=>n==='A]B'?7:null),7);
 assert.throws(()=>parseExpression('1; DROP TABLE x','row'),/PIVOT_EXPRESSION_INVALID/);
 assert.throws(()=>parseExpression('SUM([A])','row'),/PIVOT_EXPRESSION_INVALID/);
 assert.throws(()=>parseExpression('('.repeat(30)+'1'+')'.repeat(30),'row'),/PIVOT_EXPRESSION_INVALID/);
 assert.match(compileExpression(e,()=> 'TRY_CAST("c0" AS DOUBLE)'),/CASE WHEN/);
});
const base={id:'m1',name:'Sales',kind:'aggregate' as const,aggregate:'sum' as const,column:'Amount',format:'number' as const,decimals:2};
const pivot:PivotConfig={version:1,rows:[],columns:['Date'],subtotals:true,calendar:'month',measures:[base,{id:'m2',name:'Previous',kind:'time',operation:'previous',measureId:'m1',format:'number',decimals:2},{id:'m3',name:'YTD',kind:'time',operation:'ytd',measureId:'m1',format:'number',decimals:2},{id:'m4',name:'YoY',kind:'time',operation:'yoy-growth',measureId:'m1',format:'number',decimals:2}]};
test('calendar comparison never substitutes nearest month and YTD resets each year',()=>{
 const grand={level:0,labels:[]};const result:PivotResult={rows:[grand],columns:[...['2025-01','2026-01','2026-03','2026-04'].map(v=>({level:1,labels:[v]})),grand],values:[[10,null,null,null,20,null,null,null,40,null,null,null,80,null,null,null,150,null,null,null]]};
 assert.deepEqual(applyTimeMeasures(pivot,result).values,[[10,null,10,null,20,null,20,1,40,null,60,null,80,40,140,null,150,null,null,null]]);
 assert.deepEqual(validatePivot(pivot),pivot);
 assert.throws(()=>validatePivot({...pivot,calendar:'year'}),/PIVOT_INVALID/);
 assert.throws(()=>validatePivot({...pivot,measures:[{...base,aggregate:'avg'},pivot.measures[2]]}),/PIVOT_INVALID/);
});
test('expression references survive schema rename and reject forward references',()=>{
 const p:PivotConfig={...pivot,measures:[{...base,kind:'expression',aggregate:'sum',formula:'[Amount] * 2'},{id:'m2',name:'Ratio',kind:'measure-expression',formula:'@m1 / 2',format:'number',decimals:2}]};
 assert.equal((renamePivot(p,n=>n==='Amount'?'Revenue':n).measures[0] as {formula:string}).formula,'([Revenue] * 2)');
 assert.throws(()=>validatePivot({...p,measures:[{...p.measures[1],formula:'@m2'}]}),/PIVOT_INVALID/);
});
