import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDashboard,validateDashboards,newWidget,moveWidget,dashboardQueryKey,widgetConfig} from '../src/dashboard-model.ts';
import {queryWidget} from '../src/dashboard-engine.ts';
import {periodPlan} from '../src/workspace-model.ts';
import {defaultConfig} from '../src/model.ts';
import type {Column} from '../src/model.ts';
import type {Dashboard,DataWidget} from '../src/dashboard-model.ts';
import type {SavedWorkspace} from '../src/workspace-model.ts';
const cols:Column[]=[{id:'c0',name:'Region',kind:'text'},{id:'c1',name:'Amount',kind:'number'}];
const id=()=>crypto.randomUUID();
const a=id(),b=id(),w=newWidget('kpi',id(),{slotId:a,columns:cols}) as DataWidget;
const d:Dashboard={version:1,id:id(),title:'Sales',theme:'light',widgets:[w,newWidget('text',id())]};
test('dashboard validates only configuration and rejects duplicate widgets and missing sources',()=>{
 assert.deepEqual(validateDashboard({...d,rows:['SECRET']}),d);
 assert.throws(()=>validateDashboard({...d,widgets:[w,w]}),/DASHBOARD_INVALID/);
 assert.throws(()=>validateDashboards([d],null),/DASHBOARD_SOURCE_MISSING/);
 assert.throws(()=>validateDashboard({...d,widgets:[{...w,type:'pie',config:{...w.config,groups:['Region'],aggregate:'avg'}}]}),/DASHBOARD_INVALID/);
});
test('layout reorder and resizing do not invalidate widget queries',()=>{
 const moved=moveWidget(d.widgets,w.id,d.widgets[1].id);
 assert.equal(moved[1].id,w.id);
 assert.equal(dashboardQueryKey({...d,widgets:moved.map(v=>({...v,width:4}))}),dashboardQueryKey(d));
 assert.notEqual(dashboardQueryKey({...d,filter:{column:'Region',operator:'eq',value:'N'}}),dashboardQueryKey(d));
});
test('multi-output period selects the union of required slots without unrelated files',()=>{
 const slot=(id:string)=>({id,alias:id,sheet:'Data',columns:cols.map(({name,kind})=>({name,kind})),config:defaultConfig(cols)});
 const saved:SavedWorkspace={version:1,slots:[slot(a),slot(b),slot(id())]};
 assert.deepEqual(periodPlan(saved,a,[b]).slots.map(s=>s.id),[a,b]);
 assert.throws(()=>periodPlan(saved,a,[id()]),/WORKSPACE_OUTPUT_INVALID/);
 assert.deepEqual(validateDashboards([d],saved,new Map([[a,cols]])),[d]);
 assert.throws(()=>validateDashboards([{...d,filter:{column:'Missing',operator:'eq',value:'x'}}],saved,new Map([[a,cols]])),/DASHBOARD_CONFIG_INVALID/);
});
test('KPI query uses common filter and transfers no raw data',async()=>{
 const calls:string[]=[];
 const result=await queryWidget(w,{column:'Region',operator:'eq',value:"O'Brien"},cols,'source_s1',async sql=>{calls.push(sql);return [{value:12,n:2}];});
 assert.equal(result.total,12);assert.equal(result.filtered,2);assert.deepEqual(result.groups,[]);
 assert.equal(calls.length,1);assert.match(calls[0],/"c0" = 'O''Brien'/);
 assert.throws(()=>widgetConfig(w,{column:'Missing',operator:'eq',value:'x'},cols),/DASHBOARD_FILTER_MISSING/);
});
