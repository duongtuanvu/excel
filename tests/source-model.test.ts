import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceTable, normalizeAlias, uniqueAlias, replacementIssues, replacementSheet, checkWorkspaceBudget, WORKSPACE_LIMITS } from '../src/source-model.ts';
import { compileReport, defaultConfig } from '../src/model.ts';
import type { Column } from '../src/model.ts';
const columns:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Amount',kind:'number'}];
test('source table names cannot inject SQL and reports address the selected table',()=>{
  assert.equal(sourceTable('s12'),'source_s12');
  for(const s of ['s0','s01','s-1','s1;DROP TABLE x','s1"','s1234567890123456'])assert.throws(()=>sourceTable(s));
  assert.match(compileReport(defaultConfig(columns),columns,sourceTable('s2')).raw,/FROM source_s2/);
  assert.throws(()=>compileReport(defaultConfig(columns),columns,'report_data; DROP TABLE users'));
});
test('alias validation and deterministic uniqueness',()=>{
  assert.equal(normalizeAlias(' Sales ',[]),'Sales');
  assert.throws(()=>normalizeAlias('sales',['Sales']));
  assert.throws(()=>normalizeAlias('x\ny',[]));
  assert.throws(()=>normalizeAlias(' ',[]));
  assert.equal(uniqueAlias('Sales',['sales','Sales (2)']),'Sales (3)');
  assert.equal(uniqueAlias('a'.repeat(150),['a'.repeat(100)]).length,100);
});
test('replacement preserves same-name same-kind columns regardless of order',()=>{
  assert.deepEqual(replacementIssues(columns,[columns[1],columns[0],{id:'c2',name:'Extra',kind:'text'}]),[]);
  assert.equal(replacementIssues(columns,[{id:'c0',name:'Amount',kind:'text'}]).length,2);
  assert.equal(replacementSheet('Sales',['Other','Sales']),'Sales');
  assert.equal(replacementSheet('Sales',['New']),'New');
  assert.throws(()=>replacementSheet('Sales',['A','B']));
});
test('workspace limits count unique retained workbooks and table resources',()=>{
  const book={bytes:100,cells:100,sheets:1},table={rows:100,columns,chars:1000};
  checkWorkspaceBudget([book],[table]);
  assert.throws(()=>checkWorkspaceBudget([{...book,sheets:33}],[]));
  assert.throws(()=>checkWorkspaceBudget([{...book,cells:WORKSPACE_LIMITS.bookCells+1}],[]));
  assert.throws(()=>checkWorkspaceBudget([{...book,bytes:WORKSPACE_LIMITS.bookBytes},book],[]));
  assert.throws(()=>checkWorkspaceBudget([book],Array.from({length:13},()=>table)));
  assert.throws(()=>checkWorkspaceBudget([book],[{...table,rows:1_000_001}]));
  assert.throws(()=>checkWorkspaceBudget([book],[{...table,chars:WORKSPACE_LIMITS.tableChars+1}]));
});
