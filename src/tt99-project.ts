import { buildStatements } from './tt99-engine.ts';
import type { InputLine, JournalRow, Receivable, StatementsInput, TrialRow } from './tt99-types.ts';
import { buildNotes, noteIds } from './tt99-notes.ts';

export interface TT99Project extends StatementsInput {
  name: string;
  address: string;
  preparer: string;
  chief: string;
  representative: string;
  approvalDate: string;
  jointStock: boolean;
  trial: TrialRow[];
  journal: JournalRow[];
  notes: Record<string, string>;
  notesCompletion: Record<string, boolean>;
}

export function emptyTT99Project(): TT99Project {
  const year = Math.max(2026, new Date().getFullYear());
  return {
    start: year + '-01-01', end: year + '-12-31', name: '', address: '',
    preparer: '', chief: '', representative: '', approvalDate: '', jointStock: false,
    trial: [], journal: [], receivables: [], lines: [], notes: {}, notesCompletion: {},
  };
}

export function evaluateTT99Project(project: TT99Project, report = buildStatements(project),
  notes = buildNotes(report.forms, project.notes, project.notesCompletion,project.receivables)) {
  const issues = [...report.issues];
  if (!project.name.trim()) issues.push('Thiếu tên doanh nghiệp.');
  if (!project.address.trim()) issues.push('Thiếu địa chỉ doanh nghiệp.');
  if (project.approvalDate && (!validDate(project.approvalDate) || project.approvalDate < project.end)) {
    issues.push('Ngày phê duyệt phải hợp lệ và từ ngày kết thúc kỳ trở đi.');
  }
  const pending = notes.filter(note => !note.reviewed);
  if (pending.length) issues.push('B09-DN cần hoàn thiện và xác nhận các mục ' + pending.map(note => note.id).join(', ') + '.');
  return { forms: report.forms, issues: [...new Set(issues)], notes };
}

function validDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const value = new Date(text + 'T00:00:00Z');
  return Number.isFinite(value.getTime()) && value.toISOString().startsWith(text);
}

const fileFormat = 'kysheet-tt99';
export const TT99_PROJECT_MAX_BYTES = 32 * 1024 * 1024;
const fail = (where: string): never => { throw new Error('Hồ sơ TT99 không hợp lệ tại ' + where + '.'); };

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(where);
  return value as Record<string, unknown>;
}

function readText(value: unknown, where: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail(where);
  return value;
}

function enumValue<T extends string>(v: unknown, values: readonly T[], where: string): T {
  if (!values.includes(v as T)) return fail(where);
  return v as T;
}

function period(row: Record<string, unknown>, where: string) {
  return enumValue(row.period, ['current', 'prior'] as const, where + '.period');
}
function source(row: Record<string, unknown>, where: string) {
  return readText(row.source, where + '.source', 34_000);
}
function money(row: Record<string, unknown>, key: string, where: string) {
  return readText(row[key], where + '.' + key, 128);
}
function code(value: unknown, where: string) {
  return readText(value, where, 48);
}
function optionalCode(value: unknown, where: string) {
  return value === undefined ? undefined : code(value, where);
}
function sign(value: unknown, where: string) {
  if (value === undefined || value === 1 || value === -1) return value;
  return fail(where);
}

function readRows<T>(data: Record<string, unknown>, key: string, parse: (row: Record<string, unknown>, where: string) => T): T[] {
  const rows = data[key];
  if (!Array.isArray(rows) || rows.length > 100_000) return fail(key);
  return rows.map((value, i) => {
    const where = key + '[' + (i + 1) + ']';
    return parse(record(value, where), where);
  });
}

export function parseTT99Project(text: string): TT99Project {
  if (text.length > TT99_PROJECT_MAX_BYTES || new TextEncoder().encode(text).byteLength > TT99_PROJECT_MAX_BYTES) {
    throw new Error('Hồ sơ vượt 32 MiB.');
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('JSON'); }
  const envelope = record(raw, 'định dạng');
  if (envelope.format !== fileFormat || envelope.version !== 1) return fail('phiên bản');
  const data = record(envelope.project, 'nội dung');
  const project = emptyTT99Project();
  for (const key of ['name','address','preparer','chief','representative','start','end','approvalDate'] as const) {
    project[key] = readText(data[key], key, 500);
  }
  if (typeof data.jointStock !== 'boolean') return fail('loại doanh nghiệp');
  project.jointStock = data.jointStock;
  project.lines = readRows<InputLine>(data, 'lines', (r, p) => ({
    form: enumValue(r.form, ['B01','B02','B03'] as const, p), code: code(r.code,p), period: period(r,p),
    amount: money(r,'amount',p), source: source(r,p),
  }));
  project.receivables = readRows<Receivable>(data, 'receivables', (r,p) => ({
    customer: readText(r.customer,p,32_767), term: enumValue(r.term,['short','long'] as const,p), period: period(r,p),
    debit: money(r,'debit',p), credit: money(r,'credit',p), source: source(r,p),
  }));
  project.trial = readRows<TrialRow>(data,'trial',(r,p) => ({
    account: code(r.account,p), openingDebit: money(r,'openingDebit',p), openingCredit: money(r,'openingCredit',p),
    debit: money(r,'debit',p), credit: money(r,'credit',p), closingDebit: money(r,'closingDebit',p), closingCredit: money(r,'closingCredit',p),
    b01: optionalCode(r.b01,p), basis: r.basis === undefined ? undefined : enumValue(r.basis,['debit','credit','minusDebit','minusCredit'] as const,p),
    source: source(r,p),
  }));
  project.journal = readRows<JournalRow>(data,'journal',(r,p) => ({
    period: period(r,p), date: readText(r.date,p,10), debitAccount: code(r.debitAccount,p), creditAccount: code(r.creditAccount,p),
    amount: money(r,'amount',p), b02: optionalCode(r.b02,p), b03: optionalCode(r.b03,p),
    b02Sign: sign(r.b02Sign,p), b03Sign: sign(r.b03Sign,p), source: source(r,p),
    cashEvidence: r.cashEvidence === undefined ? undefined : readText(r.cashEvidence,p,32_767),
  }));
  const notes = record(data.notes, 'thuyết minh');
  const completion = record(data.notesCompletion, 'xác nhận thuyết minh');
  for (const id of Object.keys(notes)) {
    if (!noteIds.includes(id)) return fail('mục thuyết minh ' + id);
    project.notes[id] = readText(notes[id], 'mục ' + id, 200_000);
  }
  for (const [id, reviewed] of Object.entries(completion)) {
    if (!noteIds.includes(id) || typeof reviewed !== 'boolean') return fail('xác nhận mục ' + id);
    project.notesCompletion[id] = reviewed;
  }
  return project;
}

export function serializeTT99Project(project: TT99Project) {
  const serialized = JSON.stringify({ format: fileFormat, version: 1, project });
  // Anything offered for download must be readable again by this same version.
  parseTT99Project(serialized);
  return serialized;
}
