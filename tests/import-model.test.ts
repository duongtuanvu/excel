import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveLayout,validateLayout,layoutConfig,suggestMapping,mappedRules} from '../src/import-model.ts';
import {defaultConfig} from '../src/model.ts';
import type {Column} from '../src/model.ts';
const bounds={firstRow:1,lastRow:12,firstColumn:1,lastColumn:5};
const cols:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Amount',kind:'number'}];
test('layout coordinates and dynamic bounds are validated',()=>{
 const layout={headerRow:3,firstColumn:2,lastRow:null,lastColumn:4};
 assert.deepEqual(resolveLayout(bounds,bounds,layout),{firstRow:3,lastRow:12,firstColumn:2,lastColumn:4});
 assert.equal(validateLayout(undefined),undefined);
 assert.throws(()=>validateLayout({...layout,headerRow:0}),/LAYOUT_INVALID/);
 assert.throws(()=>resolveLayout(bounds,bounds,{...layout,lastRow:13}),/LAYOUT_OUT_OF_RANGE/);
 assert.throws(()=>resolveLayout(bounds,{...bounds,lastRow:10},layout),/LAYOUT_TRUNCATED/);
 assert.throws(()=>resolveLayout({...bounds,lastColumn:101},{...bounds,lastColumn:101},null),/LAYOUT_LIMIT/);
});
test('layout conflicts require explicit reset and compatible reports survive',()=>{
 const config=defaultConfig(cols);
 assert.deepEqual(layoutConfig(config,cols,[...cols].reverse()).config,config);
 assert.ok(layoutConfig(config,cols,[cols[0]]).conflicts.length);
});
test('replacement mapping is bijective and preserves conversion rules',()=>{
 const incoming:Column[]=[{id:'c0',name:'Sales',kind:'text'},{id:'c1',name:'Region',kind:'text'}];
 const prior=[{sourceName:'RawAmount',name:'Amount',mode:'number-vi' as const}];
 assert.deepEqual(suggestMapping(cols,prior,incoming),[{name:'Region',sourceName:'Region'},{name:'Amount',sourceName:''}]);
 const map=[{name:'Region',sourceName:'Region'},{name:'Amount',sourceName:'Sales'}];
 assert.equal(mappedRules(cols,prior,incoming,map)[1].mode,'number-vi');
 assert.throws(()=>mappedRules(cols,prior,incoming,[map[0],{...map[1],sourceName:'Region'}]),/MAPPING_INVALID/);
 assert.throws(()=>mappedRules(cols,prior,incoming,[map[0]]),/MAPPING_INVALID/);
});
