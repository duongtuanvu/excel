import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePivot,arithmetic,pivotMatrix,renamePivot} from '../src/pivot-config.ts';
import {calculatePivot} from '../src/pivot-engine.ts';
import {defaultConfig,validateTemplate} from '../src/model.ts';
import type {Column} from '../src/model.ts';
import type {PivotConfig} from '../src/pivot-config.ts';
import {DatabaseSync} from 'node:sqlite';
const columns:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Month',kind:'text'},{id:'c2',name:'Amount',kind:'number'},{id:'c3',name:'Customer',kind:'text'}];
const base={format:'number' as const,decimals:2};
const pivot:PivotConfig={version:1,rows:['Region'],columns:['Month'],subtotals:true,measures:[{...base,id:'m1',name:'Average',kind:'aggregate',aggregate:'avg',column:'Amount'},{...base,id:'m2',name:'Customers',kind:'aggregate',aggregate:'distinct',column:'Customer'},{...base,id:'m3',name:'Ratio',kind:'formula',left:'m1',right:'m2',op:'/'}]};
test('pivot validation and persistence preserve formulas and reject invalid dependencies',()=>{
 const config={...defaultConfig(columns),pivot};
 assert.deepEqual(validateTemplate({version:1,config}).config,config);
 assert.throws(()=>validatePivot({...pivot,rows:['Month']}),/PIVOT_INVALID/);
 assert.throws(()=>validatePivot({...pivot,measures:[pivot.measures[2]]}),/PIVOT_INVALID/);
 assert.equal(arithmetic(4,0,'/'),null);
 assert.equal(arithmetic(null,2,'+'),null);
 assert.deepEqual(renamePivot(pivot,n=>n==='Amount'?'Revenue':n).measures[0],{...pivot.measures[0],column:'Revenue'});
});
test('pivot totals recompute average and distinct over a numeric-only SQLite fixture',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
 db.exec("CREATE TABLE source_s1(c0 TEXT,c1 TEXT,c2 TEXT,c3 TEXT); INSERT INTO source_s1 VALUES ('N','Jan','10','A'),('N','Jan','20','A'),('S','Feb','90','B')");
 // SQLite is a lightweight fixture engine, not a DuckDB compatibility layer.
 // For this fixture c2 contains only known valid numeric strings, so CAST and
 // TRY_CAST have identical results. Translate only that exact expression;
 // unsupported SQL still fails. Chromium E2E runs the original DuckDB SQL.
 let translated=0;
 const result=await calculatePivot({...defaultConfig(columns),pivot},columns,'source_s1',async sql=>{
   const numeric='TRY_CAST("c2" AS DOUBLE)';
   if(sql.includes(numeric))translated++;
   const fixtureSql=sql.replaceAll(numeric,'CAST("c2" AS DOUBLE)');
   assert.ok(!fixtureSql.includes('TRY_CAST('),'Unexpected DuckDB cast in numeric-only fixture');
   return db.prepare(fixtureSql).all();
 });
 assert.ok(translated>0,'The AVG query must contain the original DuckDB numeric expression.');
 const ri=result.rows.findIndex(a=>a.level===0),ci=result.columns.findIndex(a=>a.level===0);
 assert.deepEqual(result.values[ri].slice(ci*3,ci*3+3),[40,2,20]);
 const n=result.rows.findIndex(a=>a.labels[0]==='N'),feb=result.columns.findIndex(a=>a.labels[0]==='Feb');
 assert.deepEqual(result.values[n].slice(feb*3,feb*3+3),[null,0,null]);
 assert.equal(pivotMatrix(pivot,result).length,result.rows.length+1);
 }finally{db.close();}
});
test('pivot preflight refuses oversized axis',async()=>{
 await assert.rejects(()=>calculatePivot({...defaultConfig(columns),pivot},columns,'source_s1',async()=>[{n:501}]),/PIVOT_AXIS_LIMIT/);
});
