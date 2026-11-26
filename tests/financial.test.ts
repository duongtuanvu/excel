import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFixed,fixedArithmetic,fixedString,formatFixed,evaluateFixed} from '../src/financial-decimal.ts';
import {parseExpression} from '../src/pivot-expression.ts';
import {calculateFinancialPivot,finishFinancial} from '../src/pivot-financial.ts';
import {validatePivot} from '../src/pivot-config.ts';
import type {PivotConfig,PivotAxis} from '../src/pivot-config.ts';
test('decimal parsing and arithmetic preserve exact digits and reject silent rounding',()=>{
 assert.equal(fixedArithmetic(parseFixed('0.1',2),parseFixed('0.2',2),'+',100n),30n);
 assert.equal(parseFixed('9007199254740993.01',2),900719925474099301n);
 assert.equal(parseFixed('1.2300e0',2),123n);
 assert.throws(()=>parseFixed('0.001',2),/PIVOT_DECIMAL_SCALE/);
 assert.throws(()=>parseFixed('1,23',2),/PIVOT_DECIMAL_INPUT/);
 assert.throws(()=>parseFixed('1e40',2),/PIVOT_DECIMAL_OVERFLOW/);
 assert.equal(fixedArithmetic(-101n,200n,'/',100n),-51n);
 assert.equal(fixedArithmetic(100n,0n,'/',100n),null);
 assert.equal(formatFixed('9007199254740993.01',2,2,'number'),'9.007.199.254.740.993,01');
 assert.equal(formatFixed('-10.125',3,2,'number'),'-10,13');
 assert.equal(evaluateFixed(parseExpression('0.1+0.2','row'),()=>null,2),30n);
});
const measure={id:'m1',name:'Amount',kind:'aggregate' as const,aggregate:'sum' as const,column:'Amount',format:'number' as const,decimals:2};
const pivot:PivotConfig={version:1,rows:['Region'],columns:[],subtotals:true,financialScale:2,measures:[measure,{...measure,id:'m2',name:'Average',aggregate:'avg'},{...measure,id:'m3',name:'Customers',aggregate:'distinct',column:'Customer'}]};
test('financial aggregates recompute exact grand total, average and distinct',async()=>{
 const rows=[{r0:'A',v0:'0.1',v1:'X'},{r0:'A',v0:'0.2',v1:'Y'},{r0:'B',v0:'0.3',v1:'X'}];
 const result=await calculateFinancialPivot(pivot,n=>'"'+n+'"',' FROM source_s1',['"Region"'],[],[0,1],[0],3,1,async()=>rows,(a,b)=>b.level-a.level||String(a.labels[0]).localeCompare(String(b.labels[0])));
 assert.deepEqual(result.exactValues,[['0.30','0.15','2.00'],['0.30','0.30','1.00'],['0.60','0.20','2.00']]);
 assert.deepEqual(validatePivot(pivot),pivot);
});
test('ranking compares exact large integers and ratios keep full denominator',()=>{
 const a:PivotAxis={level:1,labels:['A']},b:PivotAxis={level:1,labels:['B']},grand:PivotAxis={level:0,labels:[]};
 const p:PivotConfig={...pivot,topN:{count:1,measureId:'m1'},measures:[measure,{...measure,id:'m2',name:'Share',showAs:'grand'}]};
 const result=finishFinancial(p,[a,b,grand],[grand],[[900719925474099300n,100n],[900719925474099301n,300n],[1801439850948198601n,400n]]);
 assert.deepEqual(result.rows,[b,grand]);
 assert.deepEqual(result.exactValues,[['9007199254740993.01','0.75'],['18014398509481986.01','1.00']]);
});
test('financial calendar previous and YTD do not use nearest missing period',()=>{
 const grand:PivotAxis={level:0,labels:[]};
 const p:PivotConfig={...pivot,rows:[],columns:['Date'],calendar:'month',measures:[measure,{id:'m2',name:'Previous',kind:'time',operation:'previous',measureId:'m1',format:'number',decimals:2},{id:'m3',name:'YTD',kind:'time',operation:'ytd',measureId:'m1',format:'number',decimals:2}]};
 const columns=[...['2026-01','2026-03','2026-04'].map(v=>({level:1,labels:[v]})),grand];
 assert.deepEqual(finishFinancial(p,[grand],columns,[[10n,null,null,20n,null,null,30n,null,null,60n,null,null]]).exactValues,[['0.10',null,'0.10','0.20',null,'0.30','0.30','0.20','0.60','0.60',null,null]]);
});
