import DashboardDesigner from './DashboardDesigner';
import {dashboardSourceIds} from './dashboard-model';
import type {Dashboard,WidgetData} from './dashboard-model';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { EngineClient } from './worker-client';
import { UiIcon } from './UiIcons';
import type { IconName } from './UiIcons';
import { ErrorMessage } from './ErrorText';
import UserCenter from './UserCenter';
import SourceManager from './SourceManager';
import SavedWorkspacePanel from './SavedWorkspacePanel';
import ProfilePanel from './ProfilePanel';
import PivotPanel from './PivotPanel';
import type {PivotConfig,PivotResult,PivotAxis,PivotDrill} from './pivot-config';
import SchemaPanel from './SchemaPanel';
import ImportPanel from './ImportPanel';
import BatchPanel from './BatchPanel';
import ModelPanel from './ModelPanel';
import PipelinePanel from './PipelinePanel';
import type {PipelineInput,PipelinePreview,PipelineRecipe} from './pipeline-model';
import {validateRecipes} from './pipeline-model';
import type {ModelInput,ModelPreview} from './data-model';
import type { BatchSelection, BatchPreview } from './batch-model';
import { BATCH_LIMITS } from './batch-model';
import type { ImportLayout, ColumnMapping } from './import-model';
import type { SchemaRule, SchemaPreview } from './schema-model';
import type { Distribution, SourceProfile } from './profile-model';
import { periodPlan, snapshotWorkspace, withoutSavedSource } from './workspace-model';
import type { RunPeriod } from './PeriodPanel';
import type { SavedSource } from './workspace-model';
import type { ManagedSource, Workspace } from './source-model';
import { initials } from './user-model';
import type { AccountSnapshot, AccountSettings } from './account-model';
import { defaultSettings } from './account-model';
import type { LocalUser } from './user-model';
import { LIMITS, AGGREGATIONS, OPERATORS, defaultConfig, reconcileConfig, validateTemplate } from './model';
import type { Aggregate, Cell, Column, Config, Filter, Group, Operator, Report, Source } from './model';

const fmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const display = (value: Cell | undefined) => value === null || value === undefined ? '—' : typeof value === 'number' ? fmt.format(value) : String(value);
const aggregateNames: Record<Aggregate,string> = { sum: 'Tổng (SUM)', count: 'Đếm dòng (COUNT)', avg: 'Trung bình (AVG)', min: 'Nhỏ nhất (MIN)', max: 'Lớn nhất (MAX)', distinct: 'Đếm giá trị khác nhau' };
const operatorNames: Record<Operator,string> = { contains: 'Chứa', eq: 'Bằng', neq: 'Khác', gt: 'Lớn hơn', gte: 'Lớn hơn hoặc bằng', lt: 'Nhỏ hơn', lte: 'Nhỏ hơn hoặc bằng', empty: 'Trống', notEmpty: 'Không trống' };
const kindNames: Record<Column['kind'], string> = { number: 'Số', text: 'Văn bản', date: 'Ngày', boolean: 'Logic' };
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const groupLabel = (g: Group) => g.labels.map(v => v ?? '(Trống)').join(' / ') || 'Tổng cộng';
const hasValue = (f: Filter) => f.operator !== 'empty' && f.operator !== 'notEmpty';

type FocusSection = 'all' | 'report' | 'pivot' | 'prep';

function download(bytes: BlobPart, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Panel({ title, icon, action, children }: { title: string; icon: IconName; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><h2><span className="panel-icon"><UiIcon name={icon} size={15}/></span>{title}</h2>{action}</div>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Chart({ groups, mode }: { groups: Group[]; mode: Config['chart'] }) {
  const data = groups.slice(0, 12);
  const max = Math.max(1, ...data.map(g => Math.abs(g.value ?? 0)));
  const negative = data.some(g => (g.value ?? 0) < 0);
  if (!data.length) return <div className="empty">Không có nhóm dữ liệu phù hợp.</div>;
  if (mode === 'bar') {
    return <div className="vertical-chart" role="img" aria-label="Biểu đồ cột các nhóm dữ liệu">
      {data.map((g,i) => <div className="v-item" key={i}>
        <div className="v-value" title={display(g.value)}>{g.value === null ? '—' : compact.format(g.value)}</div>
        <div className={'v-plot ' + (negative ? 'with-negative' : '')}><div className={'v-bar ' + ((g.value ?? 0) < 0 ? 'negative' : '')} style={{ height: (Math.abs(g.value ?? 0)/max * (negative ? 50 : 100)) + '%' }}/></div>
        <div className="v-label" title={groupLabel(g)}>{groupLabel(g)}</div>
      </div>)}
    </div>;
  }
  return <div className="horizontal-chart" role="img" aria-label="Biểu đồ thanh các nhóm dữ liệu">
    {data.map((g,i) => {
      const v = g.value ?? 0, width = Math.abs(v) / max * (negative ? 50 : 100);
      return <div className="h-item" key={i}><div className="h-label" title={groupLabel(g)}>{groupLabel(g)}</div>
        <div className={'h-track ' + (negative ? 'diverging' : '')}><div className={'h-bar ' + (v < 0 ? 'negative' : '')} style={{width: width + '%', left: (negative ? (v < 0 ? 50-width : 50) : 0) + '%'}}/></div>
        <strong title={display(g.value)}>{display(g.value)}</strong></div>;
    })}
  </div>;
}

function Pager({ page, total, onChange, disabled = false }: { page: number; total: number; onChange: (p: number) => void; disabled?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / LIMITS.page));
  return <div className="pager"><span>{total ? fmt.format(page * LIMITS.page + 1) : 0}–{fmt.format(Math.min(total, (page+1)*LIMITS.page))} / {fmt.format(total)}</span><div className="pager-buttons">
    <button className="button small" aria-label="Trang trước" disabled={disabled || page <= 0} onClick={() => onChange(page-1)}><UiIcon name="chevronLeft" size={14}/></button>
    <span>{page+1} / {pages}</span>
    <button className="button small" aria-label="Trang sau" disabled={disabled || page+1 >= pages} onClick={() => onChange(page+1)}><UiIcon name="chevronRight" size={14}/></button>
  </div></div>;
}

export default function App({ session, saveSettings, refreshSettings, logout, saving }: {
  session: AccountSnapshot;
  saveSettings: (settings: AccountSettings) => Promise<void>;
  refreshSettings: () => Promise<void>;
  logout: () => Promise<void>;
  saving: boolean;
}) {
  const client = useRef<EngineClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), templateInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const user = { data: session.settings, warning: '' };
  const [dashboardOpen,setDashboardOpen]=useState(false);
  const [focusSection,setFocusSection]=useState<FocusSection>('all');
  const [accountBusy, setAccountBusy] = useState(false);
  const [profiling, setProfiling] = useState(false);
  const restored = useRef(false);
  const [userOpen, setUserOpen] = useState(false);
  const userButton = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<ManagedSource | null>(null);
  const [sources, setSources] = useState<ManagedSource[]>([]);
  const sourceConfigs = useRef(new Map<string, Config>());
  const replaceInput = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<Config>(defaultConfig([]));
  const [snapshot, setSnapshot] = useState<{ config: Config; source: Source; requestedPage: number; report: Report } | null>(null);
  const [page, setPage] = useState(0), [groupPage, setGroupPage] = useState(0);
  const [busy, setBusy] = useState('Khởi động bộ xử lý…');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [queryError, setQueryError] = useState(''), [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'summary'|'raw'>('summary');
  const [dragging, setDragging] = useState(false), [configOpen, setConfigOpen] = useState(true);
  const result = snapshot && snapshot.source === source && snapshot.config === config && snapshot.requestedPage === page ? snapshot.report : null;
  const locked = Boolean(busy) || saving || accountBusy || profiling;
  const columns = source?.columns || [];
  const numericColumns = columns.filter(c => c.kind === 'number');

  useEffect(() => {
    let active = true;
    let engine: EngineClient;
    try { engine = new EngineClient(); client.current = engine; }
    catch (e) { setError(errorText(e)); setBusy(''); return; }
    busyRef.current = true;
    engine.request('demo', null).then(ws => {
      if (!active) return;
      const s = ws.active;
      setSources(ws.sources);
      if (!s) return;
      setSource(s);
      const saved = session.settings.workspace ? null : session.settings.lastConfig;
      const mapped = saved ? reconcileConfig(saved, s.columns) : null;
      if (mapped && !mapped.missing.length) {
        setConfig(mapped.config); restored.current = true;
      } else {
        setConfig({ ...defaultConfig(s.columns), title: 'Tổng quan kinh doanh', groups: ['Khu vực'], metric: 'Doanh thu', aggregate: 'sum' });
        if (session.settings.workspace) setNotice('Có workspace đã lưu. Chọn file cho từng nguồn trong mục Workspace tài khoản.');
        else if (saved) setNotice('Có cấu hình đã lưu. Import đúng file Excel để khôi phục.');
      }
    }).catch(e => { if (active) setError(errorText(e)); }).finally(() => {
      if (active) { busyRef.current = false; setBusy(''); }
    });
    return () => { active = false; client.current = null; engine.close(); };
  }, []);

  useEffect(() => {
    if (!source || busy || !client.current) return;
    const engine = client.current;
    let active = true;
    setLoading(true); setQueryError('');
    const timer = window.setTimeout(() => {
      engine.request('report', { config, page, sourceId: source.id, revision: source.revision }).then(report => {
        if (active) setSnapshot({ config, source, requestedPage: page, report });
      }).catch(e => { if (active) { setSnapshot(null); setQueryError(errorText(e)); } })
      .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source, config, page, busy]);

  async function runProfile<T>(operation:(engine:EngineClient)=>Promise<T>):Promise<T>{
    if(busyRef.current||saving||accountBusy||!client.current)throw new Error('PROFILE_BUSY: Bộ xử lý đang bận.');
    busyRef.current=true;setProfiling(true);
    try{return await operation(client.current);}
    finally{busyRef.current=false;setProfiling(false);}
  }
  function previewPivot(pivot:PivotConfig):Promise<PivotResult>{
    if(!source)throw Error('PIVOT_SOURCE_INVALID: Chưa có nguồn.');
    return runProfile(e=>e.request('previewPivot',{sourceId:source.id,revision:source.revision,config:{...config,pivot}}));
  }
  function drillPivot(pivot:PivotConfig,row:PivotAxis,column:PivotAxis,page:number):Promise<PivotDrill>{
    if(!source)throw Error('PIVOT_SOURCE_INVALID: Chưa có nguồn.');
    return runProfile(e=>e.request('drillPivot',{sourceId:source.id,revision:source.revision,config:{...config,pivot},row,column,page}));
  }
  function loadProfile(target:ManagedSource):Promise<SourceProfile>{
    return runProfile(e=>e.request('profile',{sourceId:target.id,revision:target.revision}));
  }
  function loadDistribution(target:ManagedSource,columnId:string):Promise<Distribution>{
    return runProfile(e=>e.request('distribution',{sourceId:target.id,revision:target.revision,columnId}));
  }

  async function pipelineRequest(input:PipelineInput,apply=false):Promise<PipelinePreview|null>{
    return runProfile(async e=>{
      if(!apply)return e.request('previewPipeline',input);
      const ws=await e.request('createPipeline',input);
      applyWorkspace(ws,undefined,defaultConfig(ws.active?.columns??[]));
      setNotice('Đã tạo bảng pipeline '+input.alias+'.');
      return null;
    });
  }
  async function savePipelineRecipes(recipes:PipelineRecipe[]){
    if(busyRef.current||saving||accountBusy)throw new Error('PIPELINE_BUSY: Bộ xử lý đang bận.');
    busyRef.current=true;setAccountBusy(true);setError('');setNotice('');
    try{await saveSettings({...session.settings,pipelines:validateRecipes(recipes)});setNotice('Đã lưu công thức pipeline vào tài khoản.');}
    finally{busyRef.current=false;setAccountBusy(false);}
  }
  async function modelRequest(input:ModelInput,apply=false,confirmExpansion=false):Promise<ModelPreview|null>{
    return runProfile(async e=>{
      if(!apply)return e.request('previewModel',input);
      const ws=await e.request('createModel',{...input,confirmExpansion});
      applyWorkspace(ws,undefined,defaultConfig(ws.active?.columns??[]));
      setNotice('Đã tạo bảng ghép '+input.alias+'.');
      return null;
    });
  }
  async function batchRequest(selection:BatchSelection[],apply=false):Promise<BatchPreview|null>{
    if(selection.length<2||selection.length>BATCH_LIMITS.files)throw new Error('BATCH_COUNT_INVALID: Chọn ít nhất hai nguồn.');
    if(selection.some(s=>!s.file.size||s.file.size>LIMITS.fileBytes||! /\.(xlsx|xls|csv|tsv)$/i.test(s.file.name))||selection.reduce((n,s)=>n+s.file.size,0)>BATCH_LIMITS.bytes)throw new Error('BATCH_BYTES_LIMIT: File không hợp lệ hoặc vượt giới hạn 25 MiB/file, 50 MiB/đợt.');
    return runProfile(async e=>{
      const files=[];
      for(const s of selection)files.push({sourceId:s.sourceId,revision:s.revision,name:s.file.name,bytes:await s.file.arrayBuffer()});
      const transfer=files.map(f=>f.bytes);
      if(!apply)return e.request('previewBatch',{files},transfer);
      const ws=await e.request('applyBatch',{files},transfer);
      applyWorkspace(ws,undefined,config);
      setNotice('Đã cập nhật đồng thời '+files.length+' nguồn.');
      return null;
    });
  }
  function previewLayout(target:ManagedSource,layout:ImportLayout|null){
    return runProfile(e=>e.request('previewLayout',{sourceId:target.id,revision:target.revision,layout,config}));
  }
  async function applyLayout(target:ManagedSource,layout:ImportLayout|null,resetReport:boolean){
    await runProfile(async e=>{const r=await e.request('applyLayout',{sourceId:target.id,revision:target.revision,layout,config,resetReport});applyWorkspace(r.workspace,undefined,r.config);setNotice('Đã áp dụng vùng dữ liệu.');});
  }
  async function replacementRequest(target:ManagedSource,file:File,mapping?:ColumnMapping[],apply=false){
    if(!/\.(xlsx|xls|csv|tsv)$/i.test(file.name)||!file.size||file.size>LIMITS.fileBytes)throw new Error('FILE_INVALID: File không hợp lệ hoặc vượt 25 MiB.');
    return runProfile(async e=>{
      const bytes=await file.arrayBuffer(),input={sourceId:target.id,revision:target.revision,name:file.name,bytes};
      if(!mapping)return e.request('inspectReplacement',input,[bytes]);
      if(!apply)return e.request('previewMapped',{...input,mapping},[bytes]);
      const ws=await e.request('applyMapped',{...input,mapping},[bytes]);applyWorkspace(ws,undefined,config);setNotice('Đã thay nguồn theo mapping.');return null;
    });
  }
  function previewSchema(target:ManagedSource,rules:SchemaRule[]):Promise<SchemaPreview>{
    return runProfile(e=>e.request('previewSchema',{sourceId:target.id,revision:target.revision,rules,config}));
  }
  async function applySchema(target:ManagedSource,rules:SchemaRule[]){
    await runProfile(async e=>{
      const result=await e.request('applySchema',{sourceId:target.id,revision:target.revision,rules,config});
      applyWorkspace(result.workspace,undefined,result.config);
      setNotice('Đã áp dụng cấu trúc cột.');
    });
  }
  function patch(partial: Partial<Config>) {
    setConfig(current => ({ ...current, ...partial }));
    setPage(0); setGroupPage(0);
  }
  function changeAggregate(aggregate: Aggregate) {
    const choices = aggregate === 'distinct' ? columns : numericColumns;
    patch({ aggregate, metric: aggregate === 'count' ? '' : choices.some(c => c.name === config.metric) ? config.metric : choices[0]?.name || '' });
  }
  function filterPatch(i: number, update: Partial<Filter>) {
    patch({ filters: config.filters.map((f,j) => j === i ? {...f,...update} : f) });
  }
  function applyWorkspace(ws: Workspace, attached?: SavedSource, editedConfig?:Config) {
    if (source) sourceConfigs.current.set(source.id, config);
    const live = new Set(ws.sources.map(s => s.id));
    for (const id of sourceConfigs.current.keys()) if (!live.has(id)) sourceConfigs.current.delete(id);
    const next = ws.active;
    setSources(ws.sources); setSource(next); setSnapshot(null); setPage(0); setGroupPage(0);
    if (!next) { setConfig(defaultConfig([])); return; }
    if(editedConfig){setConfig(editedConfig);sourceConfigs.current.set(next.id,editedConfig);return;}
    if (attached && next.slotId === attached.id) {
      setConfig(attached.config); restored.current = true;
      setNotice('Đã khôi phục nguồn '+attached.alias+' và cấu hình báo cáo.'); return;
    }
    const existing = sourceConfigs.current.get(next.id);
    if (existing) {
      const mapped = reconcileConfig(existing, next.columns);
      if (!mapped.missing.length) { setConfig(mapped.config); return; }
      setNotice('SOURCE_CONFIG_MISMATCH: Cấu hình cũ không còn tương thích; đã tạo cấu hình mới.');
    }
    const saved = session.settings.lastConfig;
    if (!session.settings.workspace && !restored.current && saved && !next.demo) {
      const mapped = reconcileConfig(saved, next.columns);
      if (!mapped.missing.length) {
        setConfig(mapped.config); restored.current = true;
        setNotice('Đã khôi phục cấu hình của tài khoản.'); return;
      }
    }
    setConfig(next.demo ? { ...defaultConfig(next.columns), title:'Tổng quan kinh doanh', groups:['Khu vực'], metric:'Doanh thu', aggregate:'sum' } : defaultConfig(next.columns));
  }
  async function sourceAction(label: string, operation: (engine: EngineClient) => Promise<Workspace>, attached?: SavedSource) {
    if (busyRef.current || saving || accountBusy || !client.current) return;
    busyRef.current = true; setBusy(label); setError(''); setNotice(''); setQueryError('');
    try { applyWorkspace(await operation(client.current), attached); }
    catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(''); }
  }
  function importFile(file?: File, replace = false) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv|tsv)$/i.test(file.name) || file.size <= 0 || file.size > LIMITS.fileBytes) {
      setError('FILE_INVALID: Chọn file Excel, CSV hoặc TSV hợp lệ, tối đa 25 MiB.'); return;
    }
    if (replace && (!source || source.derived)) return;
    void sourceAction('Đang đọc ' + file.name + '…', async engine => {
      const bytes = await file.arrayBuffer();
      return replace && source
        ? engine.request('replaceSource', { name:file.name, bytes, sourceId:source.id, revision:source.revision }, [bytes])
        : engine.request('import', { name:file.name, bytes }, [bytes]);
    });
  }
  function attachSavedSource(slotId: string, file: File) {
    if (locked || busyRef.current || !client.current) {
      setError('WORKSPACE_BUSY: Bộ xử lý chưa sẵn sàng. Hãy chọn lại file khi thao tác hiện tại hoàn tất.');
      return;
    }
    const slot=session.settings.workspace?.slots.find(s=>s.id===slotId);
    if (!slot || sources.some(s=>s.slotId===slotId)) { setError('WORKSPACE_SLOT_INVALID: Nguồn đã thay đổi hoặc đã được mở.'); return; }
    if (!/\.(xlsx|xls|csv|tsv)$/i.test(file.name) || file.size<=0 || file.size>LIMITS.fileBytes) {
      setError('FILE_INVALID: Chọn file Excel, CSV hoặc TSV hợp lệ, tối đa 25 MiB.'); return;
    }
    void sourceAction('Đang khôi phục '+slot.alias+'…', async engine=>{
      const bytes=await file.arrayBuffer();
      return engine.request('restoreSource',{slot,name:file.name,bytes},[bytes]);
    },slot);
  }
  function saveWorkspace() {
    void accountAction(async()=>{
      const workspace=snapshotWorkspace(session.settings.workspace,sources,s=>s.id===source?.id?config:sourceConfigs.current.get(s.id),source&&!source.demo?source.slotId:undefined);
      await saveSettings({...session.settings,workspace});
    },'Đã lưu workspace vào tài khoản.');
  }
  const runPeriod:RunPeriod=(outputId,selection,confirmed)=>executePeriod(outputId,selection,confirmed);
  async function executePeriod(outputId: string,selection:Parameters<RunPeriod>[1],confirmed:string[],dashboard?:Dashboard){
    const saved=session.settings.workspace;
    if(!saved)throw new Error('Hãy lưu workspace trước khi chạy kỳ mới.');
    const plan=periodPlan(saved,outputId,dashboard?dashboardSourceIds(dashboard).slice(1):[]);
    return runProfile(async engine=>{
      const files=[];
      for(const item of selection)files.push({slotId:item.slotId,name:item.file.name,bytes:await item.file.arrayBuffer()});
      const result=await engine.request('runPeriod',{saved,outputId,files,confirmed,...(dashboard?{dashboard}:{})},files.map(f=>f.bytes));
      if(result.status==='confirm')return result.warning;
      applyWorkspace(result.workspace,undefined,plan.output.config);
      const configs=new Map([...plan.slots,...plan.models].map(s=>[s.id,s.config]));
      for(const item of result.workspace.sources){
        const restoredConfig=configs.get(item.slotId);
        if(restoredConfig)sourceConfigs.current.set(item.id,restoredConfig);
      }
      restored.current=true;setError('');setNotice('Đã chạy kỳ mới cho '+plan.output.alias+' từ '+files.length+' nguồn.');
      return null;
    });
  };
  async function queryDashboard(dashboard:Dashboard):Promise<WidgetData[]>{
    const ids=dashboardSourceIds(dashboard);
    const bindings=sources.filter(s=>ids.includes(s.slotId)&&!s.stale).map(s=>({slotId:s.slotId,sourceId:s.id,revision:s.revision}));
    return runProfile(e=>e.request('dashboard',{dashboard,bindings}));
  }
  async function saveDashboards(dashboards:Dashboard[]){
    if(busyRef.current||saving||accountBusy)throw Error('DASHBOARD_BUSY: Bộ xử lý đang bận.');
    setAccountBusy(true);
    try{
      const required=new Set(dashboards.flatMap(dashboardSourceIds));
      if(sources.some(s=>required.has(s.slotId)&&s.demo))throw Error('DASHBOARD_DEMO: Hãy nhập file thật trước khi lưu Dashboard.');
      const old=session.settings.workspace;
      const oldIds=new Set([...(old?.slots??[]),...(old?.models??[])].map(s=>s.id));
      const needsWorkspace=[...required].some(id=>!oldIds.has(id))||sources.some(s=>required.has(s.slotId)&&!s.stale&&!s.demo);
      const workspace=needsWorkspace&&sources.some(s=>!s.demo&&!s.derived)?snapshotWorkspace(old,sources,s=>s.id===source?.id?config:sourceConfigs.current.get(s.id),source&&!source.demo?source.slotId:undefined):old;
      await saveSettings({...session.settings,workspace,dashboards});
    }finally{setAccountBusy(false);}
  }
  function forgetSavedSource(id:string) {
    void accountAction(async()=>{
      if(session.settings.dashboards?.some(d=>dashboardSourceIds(d).includes(id)))throw Error('DASHBOARD_DEPENDENCY: Hãy xóa widget tham chiếu nguồn này trước.');
      const workspace=session.settings.workspace;
      if(!workspace || !workspace.slots.some(s=>s.id===id) || sources.some(s=>s.slotId===id)) throw new Error('WORKSPACE_SLOT_INVALID: Hãy đóng nguồn trước khi bỏ cấu hình đã lưu.');
      await saveSettings({...session.settings,workspace:withoutSavedSource(workspace,id)});
    },'Đã bỏ cấu hình nguồn khỏi workspace tài khoản.');
  }
  async function openTemplate(file?: File) {
    if (!file || !source || busyRef.current) return;
    busyRef.current = true; setBusy('Đang đọc mẫu báo cáo…'); setError(''); setNotice('');
    try {
      if (file.size > LIMITS.templateBytes) throw new Error('Mẫu JSON vượt quá 128 KB.');
      const template = validateTemplate(JSON.parse(await file.text()));
      const mapped = reconcileConfig(template.config, source.columns);
      if (mapped.missing.length) throw new Error('Mẫu không khớp nguồn dữ liệu. Thiếu hoặc sai kiểu cột: ' + mapped.missing.join(', '));
      setConfig(mapped.config); setPage(0); setGroupPage(0); setNotice('Đã áp dụng mẫu báo cáo.');
    } catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(''); }
  }
  async function exportData(format: 'xlsx' | 'csv') {
    if (!client.current || !source || !result || busyRef.current || result.truncated || result.pivotError) return;
    busyRef.current = true; setBusy('Đang tạo file ' + format.toUpperCase() + '…'); setError('');
    try {
      const exported = await client.current.request('export', { config, format, sourceId: source.id, revision: source.revision });
      download(exported.bytes, exported.name, exported.mime);
    } catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(''); }
  }
  async function accountAction(action: () => Promise<void>, message: string) {
    if (busyRef.current || saving || accountBusy) return;
    setAccountBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); }
    catch (e) { setError(errorText(e)); }
    finally { setAccountBusy(false); }
  }
  async function persistProfile(next: LocalUser) {
    await saveSettings({ ...session.settings, ...next });
  }
  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault(); setDragging(false);
    if (!locked) importFile(e.dataTransfer.files[0]);
  }
  const groups = result?.groups || [];
  const aggregateLabel = config.aggregate === 'count' ? 'Số bản ghi' : config.aggregate.toUpperCase() + ' · ' + (config.metric || 'Chưa chọn cột');
  const label = config.groups.join(' / ') || 'Toàn bộ dữ liệu';
  const groupOptions = (index: number) => columns.filter(c => !config.groups.includes(c.name) || c.name === config.groups[index]);
  const showReport = focusSection === 'all' || focusSection === 'report';
  const showPivot = focusSection === 'all' || focusSection === 'pivot';
  const showPrep = focusSection === 'all' || focusSection === 'prep';
  const hasPrepPanels = Boolean(source) || sources.filter(s=>!s.demo&&!s.stale).length >= 2;

  return <div className={'workspace' + (user.data.profile.density === 'compact' ? ' density-compact' : '')}>
    <header className="topbar">
      <div className="brand">
        <span className="brand-icon"><UiIcon name="logo" size={23}/></span>
        <div><strong>KySheet<span className="version"> v0.8.0</span></strong><small>EXCEL REPORT STUDIO</small></div>
      </div>
      <nav className="mode-switcher" aria-label="Chế độ làm việc">
        <button type="button" className={'mode-pill' + (!dashboardOpen ? ' active' : '')} disabled={locked || dashboardOpen} aria-pressed={!dashboardOpen}><UiIcon name="chart" size={14}/><span>Báo cáo</span></button>
        <button type="button" className={'mode-pill' + (dashboardOpen ? ' active' : '')} disabled={locked || dashboardOpen} aria-pressed={dashboardOpen} onClick={()=>setDashboardOpen(true)}><UiIcon name="dashboard" size={14}/><span>Dashboard Designer</span></button>
      </nav>
      <div className="header-right">
        <span className="privacy" title="Dữ liệu Excel chỉ xử lý trong trình duyệt"><UiIcon name="shield" size={14}/> Local-first</span>
        {!dashboardOpen && <button className="button icon-button" onClick={() => setConfigOpen(v => !v)} title="Hiện / ẩn thanh cấu hình" aria-label="Hiện hoặc ẩn cấu hình" aria-expanded={configOpen}><UiIcon name="sliders" size={16}/></button>}
        <button className="button primary" disabled={locked} onClick={() => fileInput.current?.click()}><UiIcon name="upload" size={15}/> <span>Import Excel</span></button>
        <button type="button" ref={userButton} className="user-trigger" aria-label="Mở không gian cá nhân" aria-haspopup="dialog" onClick={() => setUserOpen(true)}>
          <span className="user-avatar">{initials(user.data.profile.displayName)}</span><span className="user-trigger-copy"><strong>{user.data.profile.displayName}</strong><small>{user.data.profile.workspace}</small></span><span className="user-trigger-chevron" aria-hidden="true"><UiIcon name="chevronDown" size={14}/></span>
        </button>
      </div>
    </header>
    {userOpen && <UserCenter
      state={user}
      config={source && result && !locked ? config : null}
      onSave={persistProfile}
      onReset={() => saveSettings(defaultSettings(session.settings.profile.displayName))}
      accountEmail={session.account.email}
      saving={saving}
      onLogout={logout}
      onApply={next => {
        if (!source || busyRef.current) throw new Error('Chưa có nguồn dữ liệu sẵn sàng.');
        const mapped = reconcileConfig(next, source.columns);
        if (mapped.missing.length) throw new Error('Mẫu không khớp nguồn dữ liệu: ' + mapped.missing.join(', '));
        setConfig(mapped.config); setPage(0); setGroupPage(0); setNotice('Đã áp dụng mẫu từ không gian cá nhân.');
      }}
      onDownload={item => download(JSON.stringify({version:1,config:item.config},null,2),'kysheet-template.json','application/json')}
      onDismiss={() => { setUserOpen(false); requestAnimationFrame(() => userButton.current?.focus()); }}
    />}
    <input ref={fileInput} hidden type="file" accept=".xlsx,.xls,.csv,.tsv" aria-label="Chọn dữ liệu Excel" onChange={(e: ChangeEvent<HTMLInputElement>) => { importFile(e.target.files?.[0]); e.target.value = ''; }}/>
    <input ref={replaceInput} hidden type="file" accept=".xlsx,.xls,.csv,.tsv" aria-label="Chọn file thay thế" onChange={e=>{importFile(e.target.files?.[0],true);e.target.value='';}}/>
    <input ref={templateInput} hidden type="file" accept=".json,application/json" aria-label="Chọn mẫu JSON" onChange={e => { void openTemplate(e.target.files?.[0]); e.target.value = ''; }}/>
    {dashboardOpen?<DashboardDesigner active={source} sources={sources} config={config} workspace={session.settings.workspace} saved={session.settings.dashboards??[]} disabled={locked} onQuery={queryDashboard} onSave={saveDashboards} onRun={(d,...args)=>executePeriod(...args,d)} onClose={()=>setDashboardOpen(false)}/>:<div className={'layout ' + (!configOpen ? 'wide' : '')}>
      {configOpen && <aside className="sidebar" aria-label="Cấu hình báo cáo">
        <div className="sidebar-title"><span>WORKSPACE</span><span className="engine-pill"><span className={'dot ' + (!source ? 'inactive' : '')}/>{source ? 'Sẵn sàng' : 'Khởi tạo'}</span></div>
        <Panel title="Nguồn dữ liệu" icon="file">
          <button className={'dropzone ' + (dragging ? 'dragging' : '')} disabled={locked} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <span className="upload-icon"><UiIcon name="upload" size={20}/></span><strong>Thả file Excel vào đây</strong><small>hoặc bấm để chọn · XLSX, XLS, CSV, TSV (25 MB)</small>
          </button>
          <SourceManager sources={sources} active={source} disabled={locked}
            onActivate={id=>void sourceAction('Đang chuyển nguồn…',e=>e.request('activateSource',{sourceId:id}))}
            onSheet={sheet=>void sourceAction('Đang mở sheet…',e=>e.request('sheet',{sheet}))}
            onRename={(id,alias)=>void sourceAction('Đang đổi tên nguồn…',e=>e.request('renameSource',{sourceId:id,alias}))}
            onRemove={id=>void sourceAction('Đang xóa nguồn…',e=>e.request('removeSource',{sourceId:id}))}
            onReplace={()=>replaceInput.current?.click()}/>
          <button className="button text-button" disabled={locked} onClick={() => void sourceAction('Đang tạo dữ liệu mẫu…', engine => engine.request('demo', null))}><UiIcon name="refresh" size={14}/> Nạp dữ liệu mẫu</button>
        </Panel>
        <Panel title="Workspace tài khoản" icon="layers">
          <SavedWorkspacePanel saved={session.settings.workspace} sources={sources} disabled={locked}
            onSave={saveWorkspace} onAttach={attachSavedSource} onForget={forgetSavedSource} onRunPeriod={runPeriod}
            onActivate={id=>void sourceAction('Đang chuyển nguồn…',e=>e.request('activateSource',{sourceId:id}))}/>
        </Panel>
        <fieldset className="settings" disabled={locked || !source}>
          <Panel title="Cấu hình báo cáo" icon="sliders">
            <Field label="Tên báo cáo"><input maxLength={200} value={config.title} onChange={e => patch({title:e.target.value})}/></Field>
            <div className="field"><span>Nhóm dữ liệu <small>Tối đa 3 cấp</small></span>
              {config.groups.map((name,i) => <div className="inline-row" key={i}><select aria-label={'Nhóm cấp ' + (i+1)} value={name} onChange={e => patch({groups:config.groups.map((v,j) => j === i ? e.target.value : v)})}>{groupOptions(i).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><button className="button icon-button" aria-label={'Xóa nhóm cấp ' + (i+1)} onClick={() => patch({groups:config.groups.filter((_,j) => i !== j)})}><UiIcon name="close" size={14}/></button></div>)}
              <button className="button dashed" disabled={config.groups.length >= 3 || !columns.some(c => !config.groups.includes(c.name))} onClick={() => { const c = columns.find(c => !config.groups.includes(c.name)); if (c) patch({groups:[...config.groups,c.name]}); }}><UiIcon name="plus" size={14}/> Thêm nhóm</button>
            </div>
            <Field label="Phép tổng hợp"><select value={config.aggregate} onChange={e => changeAggregate(e.target.value as Aggregate)}>{AGGREGATIONS.map(a => <option key={a} value={a} disabled={a !== 'count' && a !== 'distinct' && !numericColumns.length}>{aggregateNames[a]}</option>)}</select></Field>
            {config.aggregate !== 'count' && <Field label="Cột giá trị"><select value={config.metric} onChange={e => patch({metric:e.target.value})}><option value="" disabled>Chọn cột</option>{(config.aggregate === 'distinct' ? columns : numericColumns).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>}
            <Field label="Sắp xếp"><select value={config.sort} onChange={e => patch({sort:e.target.value as Config['sort']})}><option value="desc">Giá trị giảm dần</option><option value="asc">Giá trị tăng dần</option></select></Field>
          </Panel>
          <Panel title="Bộ lọc" icon="filter" action={<span className="count-badge">{config.filters.length}</span>}>
            {!config.filters.length && <p className="muted small-text">Đang hiển thị tất cả dữ liệu. Thêm điều kiện để lọc chi tiết.</p>}
            {config.filters.map((f,i) => <div className="filter-card" key={i}><div className="inline-row"><select aria-label={'Cột lọc ' + (i+1)} value={f.column} onChange={e => filterPatch(i,{column:e.target.value})}>{columns.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><button className="button icon-button" aria-label={'Xóa bộ lọc ' + (i+1)} onClick={() => patch({filters:config.filters.filter((_,j) => i !== j)})}><UiIcon name="close" size={14}/></button></div>
              <select aria-label={'Điều kiện ' + (i+1)} value={f.operator} onChange={e => filterPatch(i,{operator:e.target.value as Operator})}>{OPERATORS.map(op => <option key={op} value={op}>{operatorNames[op]}</option>)}</select>
              {hasValue(f) && <input aria-label={'Giá trị lọc ' + (i+1)} placeholder="Nhập giá trị…" maxLength={1000} value={f.value} onChange={e => filterPatch(i,{value:e.target.value})}/>}
              {i > 0 && <small className="and">AND</small>}
            </div>)}
            <button className="button dashed" disabled={config.filters.length >= LIMITS.filters || !columns.length} onClick={() => patch({filters:[...config.filters,{column:columns[0].name,operator:'contains',value:''}]})}><UiIcon name="plus" size={14}/> Thêm điều kiện</button>
            {!!config.filters.length && <button className="button text-button" onClick={() => patch({filters:[]})}>Xóa tất cả bộ lọc</button>}
          </Panel>
          <details className="panel sidebar-advanced">
            <summary><span className="panel-icon"><UiIcon name="folder" size={15}/></span>Mẫu nhanh &amp; Tệp JSON</summary>
            <div className="sidebar-advanced-body">
              <p className="muted small-text">Lưu nhanh cấu hình đang mở vào tài khoản hoặc xuất/nhập tệp mẫu JSON. Tên cột và giá trị lọc có thể nhạy cảm.</p>
              <button className="button primary" disabled={!result || locked} onClick={() => void accountAction(() => saveSettings({...session.settings,lastConfig:config}), 'Đã lưu cấu hình vào tài khoản.')}><UiIcon name="save" size={14}/>Lưu cấu hình tài khoản</button>
              <button className="button" disabled={!session.settings.lastConfig || locked} onClick={() => {
                const saved=session.settings.lastConfig;
                if (!saved || !source) return;
                const mapped=reconcileConfig(saved,source.columns);
                if (mapped.missing.length) { setError('Cấu hình đã lưu không khớp cột: '+mapped.missing.join(', ')); return; }
                setConfig(mapped.config); setPage(0); setGroupPage(0); setNotice('Đã áp dụng cấu hình tài khoản.');
              }}><UiIcon name="refresh" size={14}/>Khôi phục cấu hình đã lưu</button>
              <button className="button text-button" disabled={locked} onClick={() => void accountAction(refreshSettings, 'Đã tải lại hồ sơ và mẫu từ tài khoản.')}>Tải lại cấu hình từ server</button>
              <div className="two-buttons"><button className="button" onClick={() => templateInput.current?.click()}><UiIcon name="upload" size={14}/> Mở mẫu</button><button className="button" onClick={() => download(JSON.stringify({version:1,config},null,2),'kysheet-template.json','application/json')}><UiIcon name="download" size={14}/> Lưu mẫu</button></div>
            </div>
          </details>
        </fieldset>
        <div className="sidebar-footer"><UiIcon name="shield" size={18}/><span><strong>Dữ liệu thuộc về bạn</strong><small>Không gửi file Excel lên máy chủ.</small></span></div>
      </aside>}
      <main className="main">
        <div className="breadcrumb">
          <span>Workspace</span><UiIcon name="chevronRight" size={13}/><span>{user.data.profile.workspace}</span>
          <span className="spacer"/>
          <div className="section-tabs" role="tablist" aria-label="Lọc khu vực hiển thị">
            {([
              ['all', 'Tất cả'],
              ['report', 'Báo cáo & Bảng'],
              ['pivot', 'Pivot'],
              ['prep', 'Chuẩn bị dữ liệu'],
            ] as const).map(([id, text]) => (
              <button key={id} type="button" role="tab" aria-selected={focusSection === id} className={focusSection === id ? 'active' : ''} onClick={() => setFocusSection(id)}>{text}</button>
            ))}
          </div>
          <span className="engine-status"><span className={'dot ' + (!source ? 'inactive' : '')}/>{source ? 'DuckDB · Ready' : 'DuckDB · Đang khởi tạo'}</span>
        </div>
        <div className="hero">
          <div>
            <div className="eyebrow">{source?.demo ? 'DỮ LIỆU MẪU · XEM THỬ' : 'BÁO CÁO PHÂN TÍCH'}</div>
            <h1>{config.title || 'Báo cáo tổng hợp'}</h1>
            <p>{source ? `${source.alias}  ·  ${source.sheet}  ·  ${fmt.format(source.rows)} dòng × ${columns.length} cột` : 'Import file Excel hoặc CSV để bắt đầu phân tích dữ liệu'}</p>
          </div>
          <div className="export-buttons">
            <button className="button" disabled={locked || !result || result.truncated || !!result.pivotError} onClick={() => void exportData('csv')}><UiIcon name="download" size={15}/> CSV</button>
            <button className="button primary" disabled={locked || !result || result.truncated || !!result.pivotError} onClick={() => void exportData('xlsx')}><UiIcon name="download" size={15}/> Xuất Excel</button>
          </div>
        </div>
        {(busy || error || notice || queryError || result?.truncated) && <div className="toast-stack">
          {busy && <div className="notice working" role="status"><span className="spinner"/><span>{busy}</span></div>}
          {error && <div className="notice error" role="alert"><UiIcon name="alert" size={16}/><ErrorMessage text={error}/><button className="button icon-button" aria-label="Đóng thông báo lỗi" onClick={() => setError('')}><UiIcon name="close" size={14}/></button></div>}
          {notice && <div className="notice" role="status"><UiIcon name="check" size={16}/><ErrorMessage text={notice}/><button className="button icon-button" aria-label="Đóng thông báo" onClick={() => setNotice('')}><UiIcon name="close" size={14}/></button></div>}
          {queryError && <div className="notice error" role="alert"><UiIcon name="alert" size={16}/><ErrorMessage text={queryError}/></div>}
          {result?.truncated && <div className="notice warning"><UiIcon name="alert" size={16}/><span>Có hơn 5.000 nhóm. Chỉ hiện 5.000 nhóm đầu; hãy lọc nhỏ hơn để xuất báo cáo đầy đủ.</span></div>}
        </div>}
        {showReport && <>
          <div className="kpis">
            <article className="kpi featured"><span>{aggregateLabel}<UiIcon name="chart" size={16}/></span><strong data-testid="metric-total">{result ? display(result.total) : '—'}</strong><small>{result ? 'Tổng hợp theo cấu hình hiện tại' : 'Chờ kết quả phân tích'}</small></article>
            <article className="kpi"><span>Số dòng sau lọc<UiIcon name="grid" size={16}/></span><strong data-testid="filtered-count">{result ? fmt.format(result.filtered) : '—'}</strong><small>{source ? 'trên ' + fmt.format(source.rows) + ' dòng nguồn' : 'Chưa có nguồn dữ liệu'}</small></article>
            <article className="kpi"><span>Nhóm kết quả<UiIcon name="layers" size={16}/></span><strong>{result ? fmt.format(groups.length) + (result.truncated ? '+' : '') : '—'}</strong><small>{label}</small></article>
            <article className="kpi"><span>Bộ lọc áp dụng<UiIcon name="filter" size={16}/></span><strong>{config.filters.length}</strong><small>{config.filters.length ? 'Kết hợp điều kiện AND' : 'Không giới hạn dữ liệu'}</small></article>
          </div>
          <section className="report-card chart-card"><div className="card-heading"><div><h2>Phân tích theo nhóm</h2><p>{label} · {aggregateLabel} · tối đa 12 nhóm đầu</p></div><div className="segmented" aria-label="Kiểu biểu đồ"><button className={config.chart === 'horizontal' ? 'active' : ''} aria-pressed={config.chart === 'horizontal'} disabled={locked} onClick={() => patch({chart:'horizontal'})}><UiIcon name="barChart" size={14}/> Thanh</button><button className={config.chart === 'bar' ? 'active' : ''} aria-pressed={config.chart === 'bar'} disabled={locked} onClick={() => patch({chart:'bar'})}><UiIcon name="chart" size={14}/> Cột</button></div></div>
            {result ? <Chart groups={groups} mode={config.chart}/> : <div className="empty">{loading || busy ? <><span className="spinner"/> Đang tính báo cáo…</> : 'Chưa có kết quả.'}</div>}
          </section>
          <section className="report-card table-card"><div className="card-heading"><div><h2>Chi tiết dữ liệu</h2><p>Kiểm tra kết quả tổng hợp và dữ liệu nguồn đã lọc</p></div><span className="table-tag"><UiIcon name="table" size={15}/> {source ? columns.length : 0} cột</span></div>
            <div className="tabs" role="tablist" aria-label="Bảng dữ liệu"><button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Bảng tổng hợp</button><button role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>Dữ liệu nguồn</button></div>
            {result ? tab === 'summary' ? <><div className="table-scroll"><table><thead><tr>{config.groups.map(n => <th key={n}>{n}</th>)}{!config.groups.length && <th>Nhóm</th>}<th className="numeric">Giá trị</th><th className="numeric">Số dòng</th></tr></thead><tbody>
              {groups.slice(groupPage * LIMITS.page, (groupPage+1)*LIMITS.page).map((g,i) => <tr key={i}>{g.labels.length ? g.labels.map((l,j) => <td key={j}>{l ?? '(Trống)'}</td>) : <td>Tất cả dữ liệu</td>}<td className="numeric emphasis">{display(g.value)}</td><td className="numeric">{fmt.format(g.count)}</td></tr>)}
              {!groups.length && <tr><td colSpan={Math.max(1,config.groups.length)+2} className="empty-cell">Không có dữ liệu phù hợp.</td></tr>}
              </tbody><tfoot><tr><th colSpan={Math.max(1, config.groups.length)}>Tổng hợp toàn bộ</th><th className="numeric">{display(result.total)}</th><th className="numeric">{fmt.format(result.filtered)}</th></tr></tfoot></table></div><Pager page={groupPage} total={groups.length} onChange={setGroupPage}/></> :
              <><div className="table-scroll"><table><thead><tr><th>#</th>{columns.map(c => <th key={c.id}>{c.name}<small className="column-type">{kindNames[c.kind]}</small></th>)}</tr></thead><tbody>{result.preview.map((row,i) => <tr key={i}><td className="row-number">{result.page*LIMITS.page+i+1}</td>{row.map((v,j) => <td key={j} className={columns[j]?.kind === 'number' ? 'numeric' : ''}>{display(v)}</td>)}</tr>)}{!result.preview.length && <tr><td colSpan={columns.length+1} className="empty-cell">Không có dữ liệu phù hợp.</td></tr>}</tbody></table></div><Pager page={result.page} total={result.filtered} onChange={setPage} disabled={locked || loading}/></> : <div className="empty">{loading || busy ? 'Đang tải dữ liệu…' : 'Chưa có dữ liệu để hiển thị.'}</div>}
          </section>
        </>}
        {showPivot && source && <PivotPanel key={'pivot:'+source.id+':'+source.revision+':'+JSON.stringify(config.pivot??null)} config={config} columns={columns} result={result?.pivot} queryError={result?.pivotError??queryError} disabled={locked} onPreview={previewPivot} onDrill={drillPivot} onApply={pivot=>patch({pivot})}/>}
        {showPrep && hasPrepPanels && <div className="studio-section">
          <div className="studio-section-head">
            <div>
              <span className="eyebrow">DATA STUDIO</span>
              <h2>Chuẩn bị, ghép nối &amp; kiểm tra dữ liệu</h2>
            </div>
            <p>Mở từng công cụ khi cần làm sạch, đổi kiểu cột, ghép nhiều file hoặc kiểm tra chất lượng trước khi lập báo cáo.</p>
          </div>
          <div className="studio-grid">
            <PipelinePanel key={'pipeline:'+JSON.stringify(sources.filter(s=>!s.demo&&!s.stale&&s.derived?.operation!=='pipeline').map(s=>[s.id,s.revision,s.alias]))} sources={sources} activeId={source?.id??null} recipes={session.settings.pipelines??[]} disabled={locked} onRequest={pipelineRequest} onSave={savePipelineRecipes}/>
            <ModelPanel key={'model:'+JSON.stringify(sources.filter(s=>!s.demo&&!s.stale).map(s=>[s.id,s.revision,s.alias]))} sources={sources} disabled={locked} onRequest={modelRequest}/>
            <BatchPanel key={'batch:'+JSON.stringify(sources.map(s=>[s.id,s.revision,s.alias]))} sources={sources} disabled={locked} onRequest={batchRequest}/>
            {source&&!source.derived&&<ImportPanel key={'import:'+source.id+':'+source.revision} source={source} config={config} disabled={locked} onPreview={previewLayout} onApply={applyLayout} onReplacement={replacementRequest}/>}
            {source&&!source.derived&&<SchemaPanel key={'schema:'+source.id+':'+source.revision} source={source} config={config} disabled={locked} onPreview={previewSchema} onApply={applySchema}/>}
            {source&&<ProfilePanel key={'profile:'+source.id+':'+source.revision} source={source} disabled={locked} onProfile={loadProfile} onDistribution={loadDistribution}/>}
          </div>
        </div>}
        <footer className="footer"><span>KySheet · React + DuckDB-Wasm</span><span>Cấu hình theo tài khoản · Xử lý Excel local</span><nav className="public-links" aria-label="Thông tin KySheet"><a href="/about/" target="_blank" rel="noopener noreferrer">Giới thiệu</a><a href="/privacy/" target="_blank" rel="noopener noreferrer">Quyền riêng tư</a><a href="/terms/" target="_blank" rel="noopener noreferrer">Điều khoản</a></nav></footer>
      </main>
    </div>}
  </div>;
}
