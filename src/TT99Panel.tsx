import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { UiIcon } from './UiIcons';
import { ErrorMessage } from './ErrorText';
import { parseFixed } from './financial-decimal';
import { parseTT99File } from './tt99-import';
import { buildStatements } from './tt99-engine';
import { buildNotes, customerRows, TT99_REFERENCE } from './tt99-notes';
import { noteOutline, noteTextReady } from './tt99-note-outline';
import { TT99_SHEETS } from './tt99-import-schema';
import type { TT99Sources } from './tt99-import-schema';
import {
  createTT99Template, emptyTT99Project, evaluateTT99Project, exportTT99Workbook,
  parseTT99Project, serializeTT99Project, TT99_PROJECT_MAX_BYTES,
} from './tt99-output';
import type { TT99Project } from './tt99-output';
import type { FormId, InputLine, PeriodKey, StatementRow } from './tt99-types';
import './tt99.css';

const TITLES = {
  B01: 'Báo cáo tình hình tài chính',
  B02: 'Báo cáo kết quả hoạt động kinh doanh',
  B03: 'Báo cáo lưu chuyển tiền tệ',
  B09: 'Bản thuyết minh báo cáo tài chính',
} as const;
const FORM_IDS = ['B01', 'B02', 'B03', 'B09'] as const;
const PERIODS: PeriodKey[] = ['current', 'prior'];
const SOURCE_KEYS = ['trial', 'journal', 'receivables', 'lines'] as const;
const WORKBOOK_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const number = new Intl.NumberFormat('vi-VN');
type Section = typeof FORM_IDS[number];
type Review = ReturnType<typeof evaluateTT99Project>;
type LineSelection = { code: string; period: PeriodKey };

function displayAmount(value: string | null) {
  if (value === null) return 'Cần bổ sung';
  const [integer, fraction] = value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction ? ',' + fraction : '');
}

function headings(form: FormId): Record<PeriodKey, string> {
  return form === 'B01' ? { current: 'Số cuối năm', prior: 'Số đầu năm' } : { current: 'Năm nay', prior: 'Năm trước' };
}

function download(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function LineDetail({row, form, period, lines, onSave, onRemove}: {
  row: StatementRow;
  form: FormId;
  period: PeriodKey;
  lines: InputLine[];
  onSave: (entry: InputLine) => void;
  onRemove: () => void;
}) {
  const matches = lines.filter(l => l.form === form && l.code === row.code && l.period === period);
  const existing = matches.length === 1 ? matches[0] : undefined;
  const [amount, setAmount] = useState(existing?.amount ?? '');
  const [source, setSource] = useState(existing?.source ?? '');
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(15);
  const sources = row.sources[period];
  const canEnter = !row.total && (row[period] === null || Boolean(existing)) && matches.length <= 1;

  function save(event: FormEvent) {
    event.preventDefault();
    const value = amount.trim().replace(',', '.');
    try {
      if (!/^[+-]?\d+(?:[.]\d{1,6})?$/.test(value)) throw new Error();
      parseFixed(value, 6);
    } catch {
      setError('Nhập số tiền chính xác, tối đa 6 chữ số thập phân và bỏ dấu phân cách hàng nghìn.');
      return;
    }
    if (!source.trim()) { setError('Nhập căn cứ, ví dụ số chứng từ hoặc tên bảng và dòng sổ.'); return; }
    onSave({form, code: row.code, period, amount: value, source: source.trim()});
    setError('');
  }
  return <div className="tt-line-detail">
    <div>
      <h3>{row.total ? 'Các chỉ tiêu cấu thành' : 'Nguồn số liệu'} · {row.code} · {headings(form)[period]}</h3>
      {sources.length ? <>
        <ul>{sources.slice(0, limit).map((s, i) => <li key={i}>{s}</li>)}</ul>
        {sources.length > limit && <button type="button" className="button small" onClick={() => setLimit(limit + 50)}>Xem thêm nguồn ({sources.length - limit})</button>}
      </> : <p>Chưa có dòng nguồn cho số liệu này.</p>}
    </div>
    {canEnter && <form onSubmit={save} className="tt-evidence-form">
      <label className="field"><span>Số tiền (VND)</span><input required type="text" inputMode="decimal" maxLength={40} value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label className="field"><span>Căn cứ số liệu</span><input required type="text" maxLength={360} value={source} onChange={e => setSource(e.target.value)}/></label>
      <div className="tt-actions"><button type="submit" className="button primary">Ghi chỉ tiêu</button>{existing && <button type="button" className="button" onClick={onRemove}>Bỏ số đã nhập</button>}</div>
      {error && <p role="alert">{error}</p>}
    </form>}
  </div>;
}

function Statement({form, rows, lines, onLines}: {
  form: FormId; rows: StatementRow[]; lines: InputLine[]; onLines: (lines: InputLine[]) => void;
}) {
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [zeroPeriod, setZeroPeriod] = useState<PeriodKey>('current');
  const [zeroSource, setZeroSource] = useState('');
  const [zeroOpen, setZeroOpen] = useState(false);
  const labels = headings(form);
  const search = query.toLocaleLowerCase('vi-VN').trim();
  const visible = rows.filter(row =>
    (!missingOnly || row.current === null || row.prior === null) &&
    (!search || (row.code + ' ' + row.label).toLocaleLowerCase('vi-VN').includes(search))
  );
  const sourcedCodes = new Set(lines.filter(l => l.form === form && l.period === zeroPeriod).map(l => l.code));
  const canMarkZero = rows.filter(row => !row.total && row[zeroPeriod] === null &&
    row.sources[zeroPeriod].length === 0 && !sourcedCodes.has(row.code));
  function storeLine(entry: InputLine) {
    const retained = lines.filter(l => !(l.form === form && l.code === entry.code && l.period === entry.period));
    onLines([...retained, entry]);
    setSelection(null);
  }
  function markZero(event: FormEvent) {
    event.preventDefault();
    if (!zeroSource.trim() || !canMarkZero.length) return;
    onLines([...lines, ...canMarkZero.map(row => ({
      form, code: row.code, period: zeroPeriod, amount: '0', source: zeroSource.trim(),
    }))]);
    setZeroOpen(false);setZeroSource('');
  }
  return <>
    <div className="tt-filterbar">
      <input type="search" placeholder="Tìm mã hoặc tên chỉ tiêu" aria-label="Tìm mã hoặc tên chỉ tiêu" value={query} onChange={e => setQuery(e.target.value)}/>
      <label><input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)}/> Chỉ hiện chỉ tiêu thiếu số</label>
    </div>
    <div className="tt-scroll" role="region" aria-label={'Số liệu ' + form} tabIndex={0}>
      <table className="tt-ledger"><thead><tr><th scope="col">Mã</th><th scope="col">Chỉ tiêu</th>
        <th scope="col" className="tt-num">{labels.current}</th><th scope="col" className="tt-num">{labels.prior}</th>
      </tr></thead><tbody>{visible.map((row, index) => <Fragment key={row.code}>
        {row.section && row.section !== visible[index - 1]?.section && <tr className="tt-section"><th colSpan={4}>{row.section}</th></tr>}
        <tr className={row.total ? 'tt-total' : undefined} data-code={row.code}>
          <td className="tt-code">{row.code}</td><th scope="row">{row.label}</th>
          {PERIODS.map(period => {
            const selected = selection?.code === row.code && selection.period === period;
            return <td key={period} className="tt-num"><button type="button" className={row[period] === null ? 'tt-missing' : 'tt-amount'}
              aria-label={row.code + ' · ' + labels[period] + ' · ' + displayAmount(row[period])}
              aria-expanded={selected} onClick={() => setSelection(selected ? null : {code: row.code, period})}>{displayAmount(row[period])}</button></td>;
          })}
        </tr>
        {selection?.code === row.code && <tr><td colSpan={4} className="tt-detail-cell">
          <LineDetail key={form + row.code + selection.period} row={row} form={form} period={selection.period}
            lines={lines} onSave={storeLine} onRemove={() => {onLines(lines.filter(l => !(l.form === form && l.code === row.code && l.period === selection.period)));setSelection(null);}}/>
        </td></tr>}
      </Fragment>)}
        {!visible.length && <tr><td colSpan={4}>Không có chỉ tiêu phù hợp.</td></tr>}
      </tbody></table>
    </div>
    <div className="tt-table-foot">
      <p>Chọn một giá trị để xem dòng sổ nguồn hoặc bổ sung số còn thiếu. Đơn vị VND.</p>
      <button className="button" type="button" aria-expanded={zeroOpen} onClick={() => setZeroOpen(!zeroOpen)}>Xác nhận không phát sinh</button>
    </div>
    {zeroOpen && <form className="tt-zero" onSubmit={markZero}>
      <label className="field"><span>Kỳ xác nhận không phát sinh</span><select value={zeroPeriod} onChange={e => setZeroPeriod(e.target.value as PeriodKey)}>{PERIODS.map(p => <option key={p} value={p}>{labels[p]}</option>)}</select></label>
      <p><strong>{canMarkZero.length} chỉ tiêu</strong> sẽ được ghi 0 cho {labels[zeroPeriod].toLocaleLowerCase('vi-VN')}. Kiểm tra các mã trước khi xác nhận.</p>
      {canMarkZero.length > 0 && <p className="tt-codes">{canMarkZero.map(r => r.code).join(', ')}</p>}
      <label className="field"><span>Căn cứ xác nhận không phát sinh</span><input required maxLength={360} value={zeroSource} onChange={e => setZeroSource(e.target.value)}/></label>
      <button className="button" disabled={!canMarkZero.length || !zeroSource.trim()}>Xác nhận {canMarkZero.length} chỉ tiêu bằng 0</button>
    </form>}
  </>;
}

function Notes({notes, onText, onReview}: {
  notes: Review['notes'];
  onText: (id: string, value: string) => void;
  onReview: (id: string, checked: boolean) => void;
}) {
  return <div className="tt-notes">
    <p>Đối chiếu từng mục với <a href={TT99_REFERENCE} target="_blank" rel="noreferrer">Phụ lục IV · mẫu B09-DN</a>. Có thể dán bảng từ Excel vào ô diễn giải để giữ các cột khi xuất.</p>
    {notes.map(note => <details key={note.id} className="tt-note">
      <summary><span>{note.title}</span><small>{note.reviewed ? 'Đã rà soát' : 'Chờ rà soát'}</small></summary>
      <div className="tt-note-body"><p>{note.hint}</p>
        {note.rows.length > 0 && <div className="tt-scroll"><table className="tt-ledger"><thead><tr>
          <th scope="col">Chỉ tiêu đối chiếu</th>{note.periodLabels.map(label => <th className="tt-num" scope="col" key={label}>{label}</th>)}
        </tr></thead><tbody>{note.rows.map((row, i) => <tr key={i}><th scope="row">{row.label}</th>
          <td className="tt-num">{displayAmount(row.current)}</td><td className="tt-num">{displayAmount(row.prior)}</td></tr>)}</tbody></table></div>}
        {!note.text.trim() && <div className="tt-actions"><button className="button" type="button" onClick={() => onText(note.id, noteOutline(note.id))}><UiIcon name="text" size={14}/>Chèn khung thuyết minh</button></div>}
        <label className="field"><span>Diễn giải · {note.title}</span><textarea rows={5} maxLength={200_000} value={note.text} onChange={e => onText(note.id, e.target.value)}/></label>
        <label className="tt-check"><input type="checkbox" disabled={!noteTextReady(note.text)} checked={note.reviewed} onChange={e => onReview(note.id, e.target.checked)}/> Đã rà soát {note.title}</label>
      </div>
    </details>)}
  </div>;
}

function IssueList({issues}: {issues: string[]}) {
  const [limit, setLimit] = useState(12);
  if (!issues.length) return <p className="tt-ready" role="status"><UiIcon name="check" size={16}/> Đã đạt các kiểm tra để xuất báo cáo.</p>;
  return <details className="tt-issues"><summary><UiIcon name="alert" size={16}/> Đối chiếu trước khi xuất · {number.format(issues.length)} mục cần xử lý</summary>
    <ul>{issues.slice(0, limit).map((issue, i) => <li key={i}>{issue}</li>)}</ul>
    {issues.length > limit && <button type="button" className="button small" onClick={() => setLimit(limit + 50)}>Xem thêm mục đối chiếu</button>}
  </details>;
}

export default function TT99Panel() {
  const [project, setProject] = useState<TT99Project>(emptyTT99Project);
  const [form, setForm] = useState<Section>('B01');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ project: TT99Project; text: string; restored: boolean } | null>(null);
  const [sourceVersion, setSourceVersion] = useState(0);
  const importInput = useRef<HTMLInputElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const {start, end, jointStock, lines, trial, receivables, journal, notes, notesCompletion} = project;
  const statements = useMemo(() => buildStatements({start, end, jointStock, lines, trial, receivables, journal}),
    [start, end, jointStock, lines, trial, receivables, journal]);
  const customerDetail = useMemo(() => customerRows(receivables), [receivables]);
  const noteSections = useMemo(() => buildNotes(statements.forms, notes, notesCompletion, receivables, customerDetail),
    [statements, notes, notesCompletion, receivables, customerDetail]);
  const report = useMemo(() => evaluateTT99Project(project, statements, noteSections), [project, statements, noteSections]);
  const periodTag = (project.start || 'chua-chon-ky').replace(/[^0-9-]/g, '');
  const controlsLocked = busy || Boolean(pending);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault();event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function changeProject(patch: Partial<TT99Project>, resetReviews = true) {
    setProject(p => ({...p, ...patch, ...(resetReviews ? {notesCompletion: {}} : {})}));
    setDirty(true);setNotice('');setError('');
  }
  function load(next: TT99Project, restored: boolean, message: string) {
    setProject(next);setDirty(!restored);setNotice(message);setError('');setPending(null);
    setSourceVersion(v => v + 1);
  }
  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;setBusy(true);setError('');setNotice('');
    try { await task(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { running.current = false;setBusy(false); }
  }
  function handleFile(e: ChangeEvent<HTMLInputElement>, kind: 'import' | 'open') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run(async () => {
      if (kind === 'open') {
        if (file.size > TT99_PROJECT_MAX_BYTES) throw new Error('Hồ sơ vượt giới hạn 32 MiB.');
        const next = parseTT99Project(await file.text());
        if (dirty) setPending({project: next, restored: true, text: 'Mở ' + file.name + ' sẽ thay hồ sơ đang chỉnh sửa.'});
        else load(next, true, 'Đã mở hồ sơ ' + file.name + '.');
        return;
      }
      const imported: TT99Sources = await parseTT99File(file);
      const roles = SOURCE_KEYS.filter(key => imported[key] !== undefined);
      const next = {...project, ...imported, notesCompletion: {}};
      const replacing = roles.filter(key => (project[key]?.length ?? 0) > 0);
      if (replacing.length) {
        const changed = replacing.map(key => TT99_SHEETS[key].name + ' (' + (project[key]?.length ?? 0) + ' → ' + (imported[key]?.length ?? 0) + ' dòng)');
        setPending({project: next, restored: false, text: 'Nạp ' + file.name + ' sẽ thay toàn bộ dữ liệu của ' + changed.join(', ') + '.'});
      } else {
        load(next, false, 'Đã nhập ' + file.name + ' · ' + roles.map(k => TT99_SHEETS[k].name + ' (' + imported[k]!.length + ' dòng)').join(', ') + '.');
      }
    });
  }
  function saveFile() {
    void run(async () => {
      download(serializeTT99Project(project), 'Ho-so-TT99-' + periodTag + '.json', 'application/json;charset=utf-8');
      setDirty(false);setNotice('Đã tạo tệp hồ sơ. Dùng Mở hồ sơ để tiếp tục lần sau.');
    });
  }
  function exportFile(mode: 'draft' | 'final') {
    void run(async () => {
      const bytes = await exportTT99Workbook(project, mode);
      download(bytes, 'BCTC-TT99-' + (mode === 'draft' ? 'NHAP-' : '') + periodTag + '.xlsx', WORKBOOK_MIME);
      setNotice(mode === 'draft' ? 'Đã xuất bản nháp Excel.' : 'Đã xuất bộ báo cáo tài chính.');
    });
  }

  return <main className="tt99" aria-labelledby="tt99-title">
    <header className="tt-head">
      <div><p className="tt-kicker">BCTC năm · Thông tư 99/2025/TT-BTC</p>
        <h1 id="tt99-title">Lập báo cáo tài chính</h1><p>Báo cáo riêng của doanh nghiệp hoạt động liên tục · Phương pháp lưu chuyển tiền trực tiếp</p></div>
      <div className="tt-actions">
        <button className="button" type="button" disabled={controlsLocked} onClick={saveFile}><UiIcon name="save" size={15}/>Lưu hồ sơ</button>
        <button className="button" type="button" disabled={controlsLocked} onClick={() => openInput.current?.click()}><UiIcon name="folder" size={15}/>Mở hồ sơ</button>
        <input type="file" hidden accept=".json,application/json" ref={openInput} aria-label="Tệp hồ sơ TT99" onChange={e => handleFile(e, 'open')}/>
      </div>
    </header>
    {error && <div role="alert" className="tt-message tt-danger"><UiIcon name="alert" size={16}/><ErrorMessage text={error}/></div>}
    {notice && <p role="status" className="tt-message"><UiIcon name="check" size={16}/>{notice}</p>}
    {busy && <p role="status" className="tt-message"><span className="spinner"/> Đang xử lý tệp…</p>}
    {pending && <div role="group" aria-label="Xác nhận thay dữ liệu" className="tt-pending">
      <p>{pending.text}</p><div className="tt-actions">
        <button type="button" className="button primary" onClick={() => load(pending.project, pending.restored, pending.restored ? 'Đã mở hồ sơ.' : 'Đã cập nhật dữ liệu nguồn.')}>Xác nhận thay dữ liệu</button>
        <button type="button" className="button" onClick={() => setPending(null)}>Giữ hồ sơ hiện tại</button>
      </div></div>}
    <fieldset disabled={controlsLocked} className="tt-layout">
      <aside className="tt-sidebar">
        <section className="tt-card tt-settings" aria-labelledby="tt-company">
          <h2 id="tt-company"><UiIcon name="calendar" size={17}/>Doanh nghiệp và kỳ báo cáo</h2>
          <label className="field"><span>Tên doanh nghiệp</span><input maxLength={180} value={project.name} onChange={e => changeProject({name: e.target.value})}/></label>
          <label className="field"><span>Địa chỉ doanh nghiệp</span><input maxLength={350} value={project.address} onChange={e => changeProject({address: e.target.value})}/></label>
          <div className="tt-dates">
            <label className="field"><span>Từ ngày</span><input type="date" aria-label="Ngày bắt đầu năm tài chính" min="2026-01-01" value={project.start} onChange={e => changeProject({start: e.target.value})}/></label>
            <label className="field"><span>Đến ngày</span><input type="date" aria-label="Ngày kết thúc năm tài chính" min={project.start || '2026-01-01'} value={project.end} onChange={e => changeProject({end: e.target.value})}/></label>
          </div>
          <label className="tt-check"><input type="checkbox" checked={Boolean(project.jointStock)} onChange={e => changeProject({jointStock: e.target.checked})}/> Công ty cổ phần</label>
          <details className="tt-disclosure"><summary>Thông tin phê duyệt và ký</summary>
            <label className="field"><span>Ngày phê duyệt</span><input type="date" value={project.approvalDate} onChange={e => changeProject({approvalDate: e.target.value})}/></label>
            {([['preparer','Người lập'],['chief','Kế toán trưởng'],['representative','Người đại diện theo pháp luật']] as const).map(([key, label]) =>
              <label className="field" key={key}><span>{label}</span><input maxLength={160} value={project[key]} onChange={e => changeProject({[key]: e.target.value})}/></label>)}
          </details>
        </section>
        <section className="tt-card tt-settings" aria-labelledby="tt-sources">
          <h2 id="tt-sources"><UiIcon name="layers" size={17}/>Sổ và dữ liệu nguồn</h2>
          <p>Tải mẫu để xem cấu trúc cột. Nhập một workbook nhiều sheet hoặc từng sổ Excel, CSV.</p>
          <div className="tt-actions"><button type="button" className="button primary" onClick={() => importInput.current?.click()}><UiIcon name="upload" size={14}/>Nhập sổ</button>
            <button type="button" className="button" onClick={() => void run(async () => download(await createTT99Template(), 'Mau-nhap-so-TT99.xlsx', WORKBOOK_MIME))}><UiIcon name="download" size={14}/>Tải mẫu nhập sổ</button></div>
          <input ref={importInput} type="file" hidden accept=".xlsx,.xls,.csv,.tsv" aria-label="Nhập sổ kế toán" onChange={e => handleFile(e, 'import')}/>
          <dl className="tt-inventory">{SOURCE_KEYS.map(key => <div key={key}><dt>{TT99_SHEETS[key].name}</dt><dd>{number.format(project[key]?.length ?? 0)} dòng</dd></div>)}</dl>
          <p className="tt-help">Dữ liệu được xử lý trong trình duyệt. Lưu hồ sơ để giữ số liệu và căn cứ sau khi đóng trang.</p>
        </section>
      </aside>
      <section className="tt-card tt-report" aria-label="Bộ báo cáo tài chính">
        <nav className="tt-tabs" aria-label="Chọn biểu báo cáo">{FORM_IDS.map(id =>
          <button className={id === form ? 'active' : ''} type="button" key={id} aria-pressed={id === form}
            onClick={() => setForm(id)}>{id}-DN</button>)}</nav>
        <div className="tt-report-head"><h2>{TITLES[form]}</h2>
          <div className="tt-actions"><button type="button" className="button" onClick={() => exportFile('draft')}>Xuất bản nháp Excel</button>
            <button type="button" className="button primary" disabled={report.issues.length > 0} onClick={() => exportFile('final')}><UiIcon name="download" size={14}/>Xuất BCTC Excel</button></div></div>
        <IssueList issues={report.issues}/>
        {form === 'B09' ? <Notes notes={report.notes}
          onText={(id, text) => changeProject({notes: {...project.notes, [id]: text}, notesCompletion: {...project.notesCompletion, [id]: false}}, false)}
          onReview={(id, checked) => changeProject({notesCompletion: {...project.notesCompletion, [id]: checked}}, false)}/>
          : <Statement key={form + sourceVersion} form={form} rows={report.forms[form]} lines={project.lines} onLines={lines => changeProject({lines})}/>}
      </section>
    </fieldset>
  </main>;
}
