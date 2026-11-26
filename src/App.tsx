import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { EngineClient } from './worker-client';
import UserCenter from './UserCenter';
import SourceManager from './SourceManager';
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

function download(bytes: BlobPart, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string,ReactNode> = {
    logo: <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 16v-4m5 4V8m5 8v-6"/></>,
    upload: <><path d="M12 15V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    file: <><path d="M7 3h7l5 5v13H5V3zm7 0v6h5M8 13h8M8 17h8"/></>,
    grid: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18"/></>,
    chart: <><path d="M4 4v16h16M8 16v-5m5 5V7m5 9v-3"/></>,
    filter: <><path d="M3 5h18l-7 8v6l-4 2v-8z"/></>,
    settings: <><path d="M5 5v14M12 5v14M19 5v14"/><path d="M2 9h6m1 7h6m1-7h6"/></>,
    shield: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM8 12l3 3 5-5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M19 16a8 8 0 0 1-13 3l-2-3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    layers: <><path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.file}</svg>;
}

function Panel({ title, icon, action, children }: { title: string; icon: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><h2><Icon name={icon}/>{title}</h2>{action}</div>{children}</section>;
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
    <button className="button small" aria-label="Trang trước" disabled={disabled || page <= 0} onClick={() => onChange(page-1)}>‹</button>
    <span>{page+1} / {pages}</span>
    <button className="button small" aria-label="Trang sau" disabled={disabled || page+1 >= pages} onClick={() => onChange(page+1)}>›</button>
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
  const [accountBusy, setAccountBusy] = useState(false);
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
  const locked = Boolean(busy) || saving || accountBusy;
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
      const saved = session.settings.lastConfig;
      const mapped = saved ? reconcileConfig(saved, s.columns) : null;
      if (mapped && !mapped.missing.length) {
        setConfig(mapped.config); restored.current = true;
      } else {
        setConfig({ ...defaultConfig(s.columns), title: 'Tổng quan kinh doanh', groups: ['Khu vực'], metric: 'Doanh thu', aggregate: 'sum' });
        if (saved) setNotice('Có cấu hình đã lưu. Import đúng file Excel để khôi phục.');
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
  function applyWorkspace(ws: Workspace) {
    if (source) sourceConfigs.current.set(source.id, config);
    const live = new Set(ws.sources.map(s => s.id));
    for (const id of sourceConfigs.current.keys()) if (!live.has(id)) sourceConfigs.current.delete(id);
    const next = ws.active;
    setSources(ws.sources); setSource(next); setSnapshot(null); setPage(0); setGroupPage(0);
    if (!next) { setConfig(defaultConfig([])); return; }
    const existing = sourceConfigs.current.get(next.id);
    if (existing) {
      const mapped = reconcileConfig(existing, next.columns);
      if (!mapped.missing.length) { setConfig(mapped.config); return; }
      setNotice('SOURCE_CONFIG_MISMATCH: Cấu hình cũ không còn tương thích; đã tạo cấu hình mới.');
    }
    const saved = session.settings.lastConfig;
    if (!restored.current && saved && !next.demo) {
      const mapped = reconcileConfig(saved, next.columns);
      if (!mapped.missing.length) {
        setConfig(mapped.config); restored.current = true;
        setNotice('Đã khôi phục cấu hình của tài khoản.'); return;
      }
    }
    setConfig(next.demo ? { ...defaultConfig(next.columns), title:'Tổng quan kinh doanh', groups:['Khu vực'], metric:'Doanh thu', aggregate:'sum' } : defaultConfig(next.columns));
  }
  async function sourceAction(label: string, operation: (engine: EngineClient) => Promise<Workspace>) {
    if (busyRef.current || saving || accountBusy || !client.current) return;
    busyRef.current = true; setBusy(label); setError(''); setNotice(''); setQueryError('');
    try { applyWorkspace(await operation(client.current)); }
    catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(''); }
  }
  function importFile(file?: File, replace = false) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv|tsv)$/i.test(file.name) || file.size <= 0 || file.size > LIMITS.fileBytes) {
      setError('FILE_INVALID: Chọn file Excel, CSV hoặc TSV hợp lệ, tối đa 25 MiB.'); return;
    }
    if (replace && !source) return;
    void sourceAction('Đang đọc ' + file.name + '…', async engine => {
      const bytes = await file.arrayBuffer();
      return replace && source
        ? engine.request('replaceSource', { name:file.name, bytes, sourceId:source.id, revision:source.revision }, [bytes])
        : engine.request('import', { name:file.name, bytes }, [bytes]);
    });
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
    if (!client.current || !source || !result || busyRef.current || result.truncated) return;
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
    await saveSettings({ ...next, lastConfig: session.settings.lastConfig });
  }
  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault(); setDragging(false);
    if (!locked) importFile(e.dataTransfer.files[0]);
  }
  const groups = result?.groups || [];
  const aggregateLabel = config.aggregate === 'count' ? 'Số bản ghi' : config.aggregate.toUpperCase() + ' · ' + (config.metric || 'Chưa chọn cột');
  const label = config.groups.join(' / ') || 'Toàn bộ dữ liệu';
  const groupOptions = (index: number) => columns.filter(c => !config.groups.includes(c.name) || c.name === config.groups[index]);

  return <div className={'workspace' + (user.data.profile.density === 'compact' ? ' density-compact' : '')}>
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Icon name="logo" size={27}/></span><div><strong>KySheet<span className="version"> v0.5</span></strong><small>EXCEL REPORT AUTOMATION</small></div></div>
      <div className="header-right"><span className="privacy"><Icon name="shield" size={16}/> Local-first</span><button className="button icon-button" onClick={() => setConfigOpen(v => !v)} title="Hiện / ẩn cấu hình" aria-label="Hiện hoặc ẩn cấu hình" aria-expanded={configOpen}><Icon name="settings"/></button><button className="button primary" disabled={locked} onClick={() => fileInput.current?.click()}><Icon name="upload"/> <span>Import Excel</span></button>
        <button type="button" ref={userButton} className="user-trigger" aria-label="Mở không gian cá nhân" aria-haspopup="dialog" onClick={() => setUserOpen(true)}>
          <span className="user-avatar">{initials(user.data.profile.displayName)}</span><span className="user-trigger-copy"><strong>{user.data.profile.displayName}</strong><small>Tài khoản</small></span><span className="user-trigger-chevron" aria-hidden="true">⌄</span>
        </button></div>
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
    <div className={'layout ' + (!configOpen ? 'wide' : '')}>
      {configOpen && <aside className="sidebar" aria-label="Cấu hình báo cáo">
        <div className="sidebar-title"><span>WORKSPACE</span><span className="dot"/></div>
        <Panel title="Nguồn dữ liệu" icon="file">
          <button className={'dropzone ' + (dragging ? 'dragging' : '')} disabled={locked} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <span className="upload-icon"><Icon name="upload" size={24}/></span><strong>Thả file Excel vào đây</strong><small>hoặc bấm để chọn file</small><small>XLSX, XLS, CSV, TSV · 25 MB</small>
          </button>
          <SourceManager sources={sources} active={source} disabled={locked}
            onActivate={id=>void sourceAction('Đang chuyển nguồn…',e=>e.request('activateSource',{sourceId:id}))}
            onSheet={sheet=>void sourceAction('Đang mở sheet…',e=>e.request('sheet',{sheet}))}
            onRename={(id,alias)=>void sourceAction('Đang đổi tên nguồn…',e=>e.request('renameSource',{sourceId:id,alias}))}
            onRemove={id=>void sourceAction('Đang xóa nguồn…',e=>e.request('removeSource',{sourceId:id}))}
            onReplace={()=>replaceInput.current?.click()}/>
          <button className="button text-button" disabled={locked} onClick={() => void sourceAction('Đang tạo dữ liệu mẫu…', engine => engine.request('demo', null))}><Icon name="refresh" size={15}/> Nạp dữ liệu mẫu</button>
        </Panel>
        <fieldset className="settings" disabled={locked || !source}>
          <Panel title="Cấu hình báo cáo" icon="settings">
            <Field label="Tên báo cáo"><input maxLength={200} value={config.title} onChange={e => patch({title:e.target.value})}/></Field>
            <div className="field"><span>Nhóm dữ liệu <small>Tối đa 3 cấp</small></span>
              {config.groups.map((name,i) => <div className="inline-row" key={i}><select aria-label={'Nhóm cấp ' + (i+1)} value={name} onChange={e => patch({groups:config.groups.map((v,j) => j === i ? e.target.value : v)})}>{groupOptions(i).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><button className="button icon-button" aria-label={'Xóa nhóm cấp ' + (i+1)} onClick={() => patch({groups:config.groups.filter((_,j) => i !== j)})}><Icon name="close" size={15}/></button></div>)}
              <button className="button dashed" disabled={config.groups.length >= 3 || !columns.some(c => !config.groups.includes(c.name))} onClick={() => { const c = columns.find(c => !config.groups.includes(c.name)); if (c) patch({groups:[...config.groups,c.name]}); }}><Icon name="plus" size={15}/> Thêm nhóm</button>
            </div>
            <Field label="Phép tổng hợp"><select value={config.aggregate} onChange={e => changeAggregate(e.target.value as Aggregate)}>{AGGREGATIONS.map(a => <option key={a} value={a} disabled={a !== 'count' && a !== 'distinct' && !numericColumns.length}>{aggregateNames[a]}</option>)}</select></Field>
            {config.aggregate !== 'count' && <Field label="Cột giá trị"><select value={config.metric} onChange={e => patch({metric:e.target.value})}><option value="" disabled>Chọn cột</option>{(config.aggregate === 'distinct' ? columns : numericColumns).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>}
            <Field label="Sắp xếp"><select value={config.sort} onChange={e => patch({sort:e.target.value as Config['sort']})}><option value="desc">Giá trị giảm dần</option><option value="asc">Giá trị tăng dần</option></select></Field>
          </Panel>
          <Panel title="Bộ lọc" icon="filter" action={<span className="count-badge">{config.filters.length}</span>}>
            {!config.filters.length && <p className="muted small-text">Đang hiển thị tất cả dữ liệu. Thêm điều kiện để phân tích chi tiết.</p>}
            {config.filters.map((f,i) => <div className="filter-card" key={i}><div className="inline-row"><select aria-label={'Cột lọc ' + (i+1)} value={f.column} onChange={e => filterPatch(i,{column:e.target.value})}>{columns.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><button className="button icon-button" aria-label={'Xóa bộ lọc ' + (i+1)} onClick={() => patch({filters:config.filters.filter((_,j) => j !== i)})}><Icon name="close" size={15}/></button></div>
              <select aria-label={'Điều kiện ' + (i+1)} value={f.operator} onChange={e => filterPatch(i,{operator:e.target.value as Operator})}>{OPERATORS.map(op => <option key={op} value={op}>{operatorNames[op]}</option>)}</select>
              {hasValue(f) && <input aria-label={'Giá trị lọc ' + (i+1)} placeholder="Nhập giá trị…" maxLength={1000} value={f.value} onChange={e => filterPatch(i,{value:e.target.value})}/>}
              {i > 0 && <small className="and">AND</small>}
            </div>)}
            <button className="button dashed" disabled={config.filters.length >= LIMITS.filters || !columns.length} onClick={() => patch({filters:[...config.filters,{column:columns[0].name,operator:'contains',value:''}]})}><Icon name="plus" size={15}/> Thêm điều kiện</button>
            {!!config.filters.length && <button className="button text-button" onClick={() => patch({filters:[]})}>Xóa tất cả bộ lọc</button>}
          </Panel>
          <Panel title="Mẫu báo cáo" icon="layers">
            <p className="muted small-text">Lưu cấu hình vào tài khoản để dùng lại trên thiết bị khác; không lưu workbook. Tên cột và giá trị bộ lọc có thể nhạy cảm.</p>
            <button className="button primary" disabled={!result || locked} onClick={() => void accountAction(() => saveSettings({...session.settings,lastConfig:config}), 'Đã lưu cấu hình vào tài khoản.')}>Lưu cấu hình tài khoản</button>
            <button className="button" disabled={!session.settings.lastConfig || locked} onClick={() => {
              const saved=session.settings.lastConfig;
              if (!saved || !source) return;
              const mapped=reconcileConfig(saved,source.columns);
              if (mapped.missing.length) { setError('Cấu hình đã lưu không khớp cột: '+mapped.missing.join(', ')); return; }
              setConfig(mapped.config); setPage(0); setGroupPage(0); setNotice('Đã áp dụng cấu hình tài khoản.');
            }}>Khôi phục cấu hình đã lưu</button>
            <button className="button text-button" disabled={locked} onClick={() => void accountAction(refreshSettings, 'Đã tải lại hồ sơ và mẫu từ tài khoản.')}>Tải lại cấu hình từ server</button><div className="two-buttons"><button className="button" onClick={() => templateInput.current?.click()}><Icon name="upload" size={15}/> Mở mẫu</button><button className="button" onClick={() => download(JSON.stringify({version:1,config},null,2),'kysheet-template.json','application/json')}><Icon name="download" size={15}/> Lưu mẫu</button></div>
          </Panel>
        </fieldset>
        <div className="sidebar-footer"><Icon name="shield" size={19}/><span><strong>Dữ liệu thuộc về bạn</strong><small>Không gửi file lên máy chủ.</small></span></div>
      </aside>}
      <main className="main">
        <div className="breadcrumb"><span>Workspace</span><Icon name="chevron" size={14}/><span>Excel reports</span><span className="spacer"/><span className="engine-status"><span className={'dot ' + (!source ? 'inactive' : '')}/>{source ? 'DuckDB · Ready' : 'DuckDB · Đang khởi tạo'}</span></div>
        <div className="hero"><div><div className="eyebrow">DYNAMIC REPORT / 01</div><h1>{config.title || 'Báo cáo tổng hợp'}</h1><p>{source ? source.alias + '  ·  ' + source.sheet : 'Import file để bắt đầu phân tích dữ liệu'}</p></div><div className="export-buttons"><button className="button" disabled={locked || !result || result.truncated} onClick={() => void exportData('csv')}><Icon name="download"/> CSV</button><button className="button primary" disabled={locked || !result || result.truncated} onClick={() => void exportData('xlsx')}><Icon name="download"/> Xuất Excel</button></div></div>
        {busy && <div className="notice working" role="status"><span className="spinner"/>{busy}</div>}
        {error && <div className="notice error" role="alert">{error}<button className="button icon-button" aria-label="Đóng thông báo lỗi" onClick={() => setError('')}><Icon name="close" size={15}/></button></div>}
        {notice && <div className="notice" role="status">{notice}<button className="button icon-button" aria-label="Đóng thông báo" onClick={() => setNotice('')}><Icon name="close" size={15}/></button></div>}
        {queryError && <div className="notice error" role="alert">{queryError}</div>}
        {result?.truncated && <div className="notice warning">Có hơn 5.000 nhóm. Chỉ hiện 5.000 nhóm đầu; hãy lọc nhỏ hơn để xuất báo cáo đầy đủ.</div>}
        <div className="kpis">
          <article className="kpi featured"><span>{aggregateLabel}<Icon name="chart"/></span><strong data-testid="metric-total">{result ? display(result.total) : '—'}</strong><small>{result ? 'Tổng hợp theo cấu hình hiện tại' : 'Chờ kết quả phân tích'}</small></article>
          <article className="kpi"><span>Số dòng sau lọc<Icon name="grid"/></span><strong data-testid="filtered-count">{result ? fmt.format(result.filtered) : '—'}</strong><small>{source ? 'trên ' + fmt.format(source.rows) + ' dòng nguồn' : 'Chưa có nguồn dữ liệu'}</small></article>
          <article className="kpi"><span>Nhóm kết quả<Icon name="layers"/></span><strong>{result ? fmt.format(groups.length) + (result.truncated ? '+' : '') : '—'}</strong><small>{label}</small></article>
          <article className="kpi"><span>Bộ lọc áp dụng<Icon name="filter"/></span><strong>{config.filters.length}</strong><small>{config.filters.length ? 'Kết hợp điều kiện AND' : 'Không giới hạn dữ liệu'}</small></article>
        </div>
        <section className="report-card chart-card"><div className="card-heading"><div><h2>Phân tích theo nhóm</h2><p>{label} · {aggregateLabel} · tối đa 12 nhóm đầu</p></div><div className="segmented" aria-label="Kiểu biểu đồ"><button className={config.chart === 'horizontal' ? 'active' : ''} aria-pressed={config.chart === 'horizontal'} disabled={locked} onClick={() => patch({chart:'horizontal'})}>Thanh</button><button className={config.chart === 'bar' ? 'active' : ''} aria-pressed={config.chart === 'bar'} disabled={locked} onClick={() => patch({chart:'bar'})}>Cột</button></div></div>
          {result ? <Chart groups={groups} mode={config.chart}/> : <div className="empty">{loading || busy ? <><span className="spinner"/> Đang tính báo cáo…</> : 'Chưa có kết quả.'}</div>}
        </section>
        <section className="report-card table-card"><div className="card-heading"><div><h2>Chi tiết dữ liệu</h2><p>Kiểm tra kết quả và dữ liệu nguồn đã lọc</p></div><span className="table-tag"><Icon name="grid" size={15}/> {source ? columns.length : 0} cột</span></div>
          <div className="tabs" role="tablist" aria-label="Bảng dữ liệu"><button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Bảng tổng hợp</button><button role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>Dữ liệu nguồn</button></div>
          {result ? tab === 'summary' ? <><div className="table-scroll"><table><thead><tr>{config.groups.map(n => <th key={n}>{n}</th>)}{!config.groups.length && <th>Nhóm</th>}<th className="numeric">Giá trị</th><th className="numeric">Số dòng</th></tr></thead><tbody>
            {groups.slice(groupPage * LIMITS.page, (groupPage+1)*LIMITS.page).map((g,i) => <tr key={i}>{g.labels.length ? g.labels.map((l,j) => <td key={j}>{l ?? '(Trống)'}</td>) : <td>Tất cả dữ liệu</td>}<td className="numeric emphasis">{display(g.value)}</td><td className="numeric">{fmt.format(g.count)}</td></tr>)}
            {!groups.length && <tr><td colSpan={Math.max(1,config.groups.length)+2} className="empty-cell">Không có dữ liệu phù hợp.</td></tr>}
            </tbody><tfoot><tr><th colSpan={Math.max(1, config.groups.length)}>Tổng hợp toàn bộ</th><th className="numeric">{display(result.total)}</th><th className="numeric">{fmt.format(result.filtered)}</th></tr></tfoot></table></div><Pager page={groupPage} total={groups.length} onChange={setGroupPage}/></> :
            <><div className="table-scroll"><table><thead><tr><th>#</th>{columns.map(c => <th key={c.id}>{c.name}<small className="column-type">{kindNames[c.kind]}</small></th>)}</tr></thead><tbody>{result.preview.map((row,i) => <tr key={i}><td className="row-number">{result.page*LIMITS.page+i+1}</td>{row.map((v,j) => <td key={j} className={columns[j]?.kind === 'number' ? 'numeric' : ''}>{display(v)}</td>)}</tr>)}{!result.preview.length && <tr><td colSpan={columns.length+1} className="empty-cell">Không có dữ liệu phù hợp.</td></tr>}</tbody></table></div><Pager page={result.page} total={result.filtered} onChange={setPage} disabled={locked || loading}/></> : <div className="empty">{loading || busy ? 'Đang tải dữ liệu…' : 'Chưa có dữ liệu để hiển thị.'}</div>}
        </section>
        <footer className="footer"><span>KySheet · React + DuckDB-Wasm</span><span>Cấu hình theo tài khoản · Xử lý Excel local</span><nav className="public-links" aria-label="Thông tin KySheet"><a href="/about/" target="_blank" rel="noopener noreferrer">Giới thiệu</a><a href="/privacy/" target="_blank" rel="noopener noreferrer">Quyền riêng tư</a><a href="/terms/" target="_blank" rel="noopener noreferrer">Điều khoản</a></nav></footer>
      </main>
    </div>
  </div>;
}
