import { decimalBound, fixedString, parseFixed } from './financial-decimal.ts';
import { applicableDefinitions } from './tt99-forms.ts';
import type { Definition } from './tt99-forms.ts';
import type { FormId, PeriodKey, StatementReport, StatementRow, StatementsInput } from './tt99-types.ts';
export type * from './tt99-types.ts';

const forms: FormId[] = ['B01', 'B02', 'B03'];
const periods: PeriodKey[] = ['current', 'prior'];
const scale = 6;
const contraAssets = new Set('122 124 126 136 142 153 216 223 226 229 235 238 242 264 266 415'.split(' '));
const signedEquity = new Set(['412', '416', '417', '420a', '420b']);
const outflows = new Set('02 03 04 05 07 21 23 25 32 34 35 36'.split(' '));
const customerCodes = new Set(['131', '211', '312', '332']);
const accountPattern = /^\d{3}[A-Za-z0-9./_-]{0,47}$/;
type Origin = 'line' | 'trial' | 'customer' | 'journal';
type Amount = { value: bigint; sources: string[]; origin: Origin };
type Add = (form: FormId, code: string, period: PeriodKey, amount: bigint, source: string | string[], origin: Origin) => void;

function decimal(value: bigint): string {
  return fixedString(decimalBound(value), scale).replace(/0+$/, '').replace(/\.$/, '');
}

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function precedingYear(value: string): string {
  const target = String(Number(value.slice(0, 4)) - 1).padStart(4, '0') + value.slice(4);
  return calendarDate(target) ? target : target.slice(0, 8) + '28';
}

function periodLabel(form: FormId, period: PeriodKey): string {
  return form === 'B01' ? (period === 'current' ? 'cuối năm' : 'đầu năm') : (period === 'current' ? 'năm nay' : 'năm trước');
}

function side(value: string): bigint {
  const amount = parseFixed(value, scale);
  if (amount < 0n) throw new Error('Cột Nợ, Có và số tiền bút toán phải là số không âm.');
  return amount;
}

function validateSource(value: string): string {
  if (!value?.trim()) throw new Error('Thiếu tham chiếu tới sổ, dòng nguồn hoặc giải trình.');
  return value.trim();
}

function validPeriod(period: PeriodKey) {
  if (period !== 'current' && period !== 'prior') throw new Error('Kỳ dữ liệu không hợp lệ.');
}

function eachSource<T extends { source: string }>(rows: T[], issues: string[], title: string, read: (row: T) => void) {
  rows.forEach((row, index) => {
    try {
      validateSource(row.source);
      read(row);
    } catch (error) {
      issues.push(`${row.source?.trim() || title + ' · dòng ' + (index + 1)} — ${error instanceof Error ? error.message : 'Dữ liệu không hợp lệ.'}`);
    }
  });
}

interface ControlBalance { debit: bigint; credit: bigint; }
const blankBalance = (): ControlBalance => ({ debit: 0n, credit: 0n });
const net = (balance: ControlBalance) => balance.debit - balance.credit;

function readTrial(input: StatementsInput, add: Add, issues: string[]) {
  const trial = input.trial ?? [];
  const codes = new Set(trial.map(row => row.account.trim()));
  const seen = new Set<string>();
  const totals = { opening: blankBalance(), movement: blankBalance(), closing: blankBalance() };
  const control = { current: blankBalance(), prior: blankBalance() };
  let hasCustomerControl = false;
  let hasCustomerActivity = false;

  eachSource(trial, issues, 'Cân đối phát sinh', row => {
    const account = row.account.trim();
    if (!accountPattern.test(account)) throw new Error('Số hiệu tài khoản không hợp lệ.');
    if (seen.has(account)) throw new Error('Trùng tài khoản ' + account + ' trong bảng cân đối số phát sinh.');
    seen.add(account);
    for (let length = 3; length < account.length; length++) {
      if (codes.has(account.slice(0, length))) throw new Error('Đã nhập cả tài khoản tổng hợp và chi tiết cho TK ' + account + '.');
    }
    const opening = { debit: side(row.openingDebit), credit: side(row.openingCredit) };
    const movement = { debit: side(row.debit), credit: side(row.credit) };
    const closing = { debit: side(row.closingDebit), credit: side(row.closingCredit) };
    if (net(opening) + net(movement) !== net(closing)) throw new Error('TK ' + account + ' không khớp số dư đầu, phát sinh và số dư cuối.');
    for (const [key, balance] of Object.entries({ opening, movement, closing }) as [keyof typeof totals, ControlBalance][]) {
      totals[key].debit += balance.debit;
      totals[key].credit += balance.credit;
    }
    if (account.startsWith('131')) {
      if (row.b01) throw new Error('TK 131 phải lấy từ sổ chi tiết từng khách hàng và kỳ hạn.');
      hasCustomerControl = true;
      hasCustomerActivity ||= movement.debit !== 0n || movement.credit !== 0n;
      control.current.debit += closing.debit;
      control.current.credit += closing.credit;
      control.prior.debit += opening.debit;
      control.prior.credit += opening.credit;
      return;
    }
    if (!row.b01) {
      if (opening.debit || opening.credit || closing.debit || closing.credit) throw new Error('TK ' + account + ' còn số dư và chưa gán mã B01.');
      return;
    }
    if (customerCodes.has(row.b01)) throw new Error('Sử dụng chi tiết công nợ để lập B01 mã ' + row.b01 + '.');
    if (!row.basis || !['debit', 'credit', 'minusDebit', 'minusCredit'].includes(row.basis)) throw new Error('Cần chọn căn cứ số dư Nợ/Có cho TK ' + account + '.');
    for (const [period, balance] of [['current', closing], ['prior', opening]] as const) {
      if (balance.debit && balance.credit) throw new Error('TK ' + account + ' có số dư cả hai bên, cần tách chi tiết để phân loại.');
      let amount = net(balance);
      if (row.basis === 'credit' || row.basis === 'minusDebit') amount = -amount;
      if ((contraAssets.has(row.b01) && amount > 0n) || (!contraAssets.has(row.b01) && !signedEquity.has(row.b01) && amount < 0n)) {
        throw new Error('TK ' + account + ' có số dư ngược dấu cho B01 ' + row.b01 + ' (' + periodLabel('B01', period) + ').');
      }
      add('B01', row.b01, period, amount, row.source + ' · TK ' + account, 'trial');
    }
  });
  for (const [label, balance] of [['đầu kỳ', totals.opening], ['phát sinh', totals.movement], ['cuối kỳ', totals.closing]] as const) {
    if (net(balance) !== 0n) issues.push('Bảng cân đối số phát sinh không cân Nợ/Có ' + label + '.');
  }
  return hasCustomerControl ? { balances: control, hasCustomerActivity } : null;
}

function readCustomers(input: StatementsInput, add: Add, issues: string[], control: ReturnType<typeof readTrial>) {
  type CustomerGroup = { period: PeriodKey; term: 'short' | 'long'; customer: string; value: bigint; sources: string[] };
  const groups = new Map<string, CustomerGroup>();
  const sums = { current: blankBalance(), prior: blankBalance() };
  const reported = new Set<PeriodKey>();
  eachSource(input.receivables, issues, 'Sổ chi tiết TK 131', row => {
    validPeriod(row.period);
    if (!row.customer.trim() || !['short', 'long'].includes(row.term)) throw new Error('Thiếu khách hàng hoặc phân loại ngắn/dài hạn.');
    const value = side(row.debit) - side(row.credit);
    reported.add(row.period);
    const key = JSON.stringify([row.period, row.customer.trim(), row.term]);
    const group = groups.get(key) ?? { period: row.period, term: row.term, customer: row.customer.trim(), value: 0n, sources: [] };
    group.value += value;
    group.sources.push(row.source);
    groups.set(key, group);
  });
  for (const group of groups.values()) {
    const asset = group.value >= 0n;
    const balance = sums[group.period];
    const amount = asset ? group.value : -group.value;
    balance[asset ? 'debit' : 'credit'] += amount;
    const code = group.term === 'short' ? (asset ? '131' : '312') : (asset ? '211' : '332');
    add('B01', code, group.period, amount, group.sources.map(ref => group.customer + ' · ' + ref), 'customer');
  }
  for (const period of periods) {
    if (!control) continue;
    const ledger = control.balances[period], detail = sums[period];
    if (period === 'current' && control.hasCustomerActivity && !reported.has(period) && !ledger.debit && !ledger.credit) {
      issues.push('TK 131 có phát sinh nhưng số dư tổng hợp cuối kỳ bằng 0. Cần sổ chi tiết khách hàng cuối năm, kể cả xác nhận số dư bằng 0.');
    }
    if (net(ledger) !== net(detail) || ((ledger.debit > 0n && ledger.credit > 0n) && (ledger.debit !== detail.debit || ledger.credit !== detail.credit))) {
      issues.push('TK 131 ' + periodLabel('B01', period) + ' lệch giữa sổ chi tiết khách hàng và bảng cân đối số phát sinh.');
    }
  }
}

function readJournal(input: StatementsInput, add: Add, issues: string[]) {
  const priorStart = precedingYear(input.start);
  const priorEnd = calendarDate(input.start)
    ? new Date(Date.parse(input.start + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10)
    : '';
  const trial = new Map((input.trial ?? []).map(row => [row.account.trim(), row]));
  const activity = new Map<string, ControlBalance>();
  const unmapped = new Set<string>();
  const currentImported = input.journal?.some(row => row.period === 'current');
  const recordMovement = (account: string, entrySide: keyof ControlBalance, amount: bigint) => {
    let control = account;
    while (control.length >= 3 && !trial.has(control)) control = control.slice(0, -1);
    if (!trial.has(control)) { unmapped.add(account); return; }
    const balance = activity.get(control) ?? blankBalance();
    balance[entrySide] += amount;
    activity.set(control, balance);
  };
  eachSource(input.journal ?? [], issues, 'Sổ cái', row => {
    validPeriod(row.period);
    const start = row.period === 'current' ? input.start : priorStart;
    const end = row.period === 'current' ? input.end : priorEnd;
    if (!calendarDate(row.date) || row.date < start || row.date > end) throw new Error('Ngày hạch toán nằm ngoài kỳ đã chọn.');
    const debit = row.debitAccount.trim(), credit = row.creditAccount.trim();
    if (!accountPattern.test(debit) || !accountPattern.test(credit)) throw new Error('Thiếu tài khoản Nợ hoặc Có hợp lệ.');
    const amount = side(row.amount);
    if (!amount) return;
    if (trial.size && row.period === 'current') {
      recordMovement(debit, 'debit', amount);
      recordMovement(credit, 'credit', amount);
    }
    const ref = `${row.source} · ${row.date} · Nợ ${debit}/Có ${credit}`;
    const closing = debit.startsWith('911') || credit.startsWith('911');
    if (!row.b02 && !closing && (/^[5-8]/.test(debit) || /^[5-8]/.test(credit))) {
      issues.push(ref + ' — Chưa phân loại B02; gán mã chỉ tiêu hoặc đánh dấu đã loại trừ.');
    }
    if (row.b02 && row.b02 !== 'skip') {
      if (closing) throw new Error('Loại bút toán kết chuyển TK 911 khi đã phân loại phát sinh B02.');
      if (row.b02 === '70' || row.b02 === '71') throw new Error('Lãi trên cổ phiếu cần bảng tính bổ sung.');
      if (row.b02Sign !== undefined && row.b02Sign !== 1 && row.b02Sign !== -1) throw new Error('Dấu số liệu B02 không hợp lệ.');
      const value = row.b02Sign === -1 ? -amount : amount;
      add('B02', row.b02, row.period, value, ref, 'journal');
      if (row.b02 === '24') add('B02', '23', row.period, value, ref, 'journal');
    }
    const cashDebit = /^11[123]/.test(debit), cashCredit = /^11[123]/.test(credit);
    if (!row.b03 && cashDebit !== cashCredit) issues.push(ref + ' — Chưa phân loại B03; gán mã dòng tiền hoặc đánh dấu đã loại trừ.');
    if (row.b03 && row.b03 !== 'skip') {
      if (cashDebit && cashCredit) throw new Error('Chuyển tiền nội bộ giữa các tài khoản tiền phải được loại khỏi B03.');
      if (row.b03 === '60') throw new Error('B03 mã 60 cần số dư đầu kỳ.');
      if (!cashDebit && !cashCredit && (!row.cashEvidence?.trim() || row.b03Sign === undefined)) {
        throw new Error('Bút toán ngoài TK 111/112/113 cần ghi căn cứ tương đương tiền hoặc thanh toán trực tiếp và xác định dấu dòng tiền.');
      }
      const sign = row.b03Sign ?? (cashCredit ? -1 : 1);
      if (sign !== 1 && sign !== -1) throw new Error('Dấu dòng tiền không hợp lệ.');
      if ((cashDebit && sign < 0) || (cashCredit && sign > 0)) throw new Error('Dấu dòng tiền không phù hợp với bên Nợ/Có của tài khoản tiền.');
      add('B03', row.b03, row.period, amount * BigInt(sign), row.cashEvidence ? ref + ' · ' + row.cashEvidence : ref, 'journal');
    }
  });
  if (trial.size && currentImported) {
    for (const account of unmapped) issues.push('TK ' + account + ' phát sinh trên sổ cái nhưng thiếu trong bảng cân đối số phát sinh.');
    for (const [account, row] of trial) {
      const postings = activity.get(account) ?? blankBalance();
      try {
        if (postings.debit !== side(row.debit) || postings.credit !== side(row.credit)) issues.push('TK ' + account + ' lệch phát sinh Nợ/Có giữa sổ cái năm nay và bảng cân đối số phát sinh.');
      } catch { /* readTrial reports malformed balances with their source. */ }
    }
  }
}

export function buildStatements(input: StatementsInput): StatementReport {
  const issues: string[] = [];
  if (!calendarDate(input.start) || !calendarDate(input.end) || input.start > input.end) {
    issues.push('Ngày bắt đầu hoặc kết thúc kỳ báo cáo không hợp lệ.');
  } else {
    // Both endpoint dates belong to the period. Even a combined first/last year is at most 15 months.
    const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
    const months = monthIndex(input.end) - monthIndex(input.start);
    if (months > 15 || (months === 15 && input.end.slice(8) >= input.start.slice(8))) issues.push('Kỳ lập BCTC năm không được vượt quá 15 tháng.');
  }
  if (input.start < '2026-01-01') issues.push('TT99 áp dụng cho năm tài chính bắt đầu từ ngày 01/01/2026.');
  const definitions = new Map(forms.map(form => [form, new Map(applicableDefinitions(form, input.jointStock === true).map(def => [def.code, def]))]));
  const values = new Map<string, Amount>();
  const keyOf = (form: FormId, code: string, period: PeriodKey) => form + '/' + code + '/' + period;
  const add: Add = (form, code, period, amount, source, origin) => {
    const references = typeof source === 'string' ? [source] : source;
    const def = definitions.get(form)?.get(code);
    if (!def || def.terms) { issues.push(references[0] + ' — Mã ' + form + ' ' + code + ' không được nhập trực tiếp.'); return; }
    const key = keyOf(form, code, period);
    const entry = values.get(key);
    if (entry && entry.origin !== origin) { issues.push(references[0] + ' — Trùng dữ liệu bổ sung và dữ liệu sổ tại ' + form + ' ' + code + ' ' + periodLabel(form, period) + '.'); return; }
    if (entry) {
      entry.value += amount;
      for (const ref of references) entry.sources.push(ref);
    } else values.set(key, { value: amount, sources: references, origin });
  };
  const control = readTrial(input, add, issues);
  readCustomers(input, add, issues, control);
  readJournal(input, add, issues);
  eachSource(input.lines, issues, 'Chỉ tiêu bổ sung', row => {
    validPeriod(row.period);
    add(row.form, row.code, row.period, parseFixed(row.amount, scale), row.source, 'line');
  });

  const result: StatementReport = { forms: { B01: [], B02: [], B03: [] }, issues };
  for (const form of forms) {
    const defs = definitions.get(form)!;
    if (form === 'B03' && !values.has(keyOf('B03','60','current'))) {
      const openingCash = result.forms.B01.find(row => row.code === '110')?.prior;
      if (openingCash != null) {
        add('B03','60','current',parseFixed(openingCash,scale),'B01-DN · mã 110 · Số đầu năm','line');
      }
    }
    const calculated = new Map<string, bigint | null>();
    function calculate(def: Definition, period: PeriodKey): bigint | null {
      const key = keyOf(form, def.code, period);
      if (calculated.has(key)) return calculated.get(key)!;
      let value: bigint | null = null;
      if (def.terms) {
        value = 0n;
        for (const term of def.terms) {
          const component = calculate(defs.get(term.replace(/^-/, ''))!, period);
          if (component === null) { value = null; break; }
          value += term.startsWith('-') ? -component : component;
        }
      } else {
        value = values.get(key)?.value ?? null;
      }
      if (value !== null) {
        try { decimalBound(value); }
        catch { issues.push(form + ' ' + def.code + ' vượt giới hạn độ chính xác.'); value = null; }
      }
      calculated.set(key, value);
      return value;
    }
    const missing: Record<PeriodKey, string[]> = { current: [], prior: [] };
    for (const def of defs.values()) {
      const row: StatementRow = { code: def.code, label: def.label, total: Boolean(def.terms), current: null, prior: null, sources: { current: [], prior: [] } };
      if (form === 'B03') {
        if (def.code <= '20') row.section = 'I. Lưu chuyển tiền từ hoạt động kinh doanh';
        else if (def.code <= '30') row.section = 'II. Lưu chuyển tiền từ hoạt động đầu tư';
        else if (def.code <= '40') row.section = 'III. Lưu chuyển tiền từ hoạt động tài chính';
      }
      for (const period of periods) {
        const val = calculate(def, period);
        if (val === null && !def.terms) missing[period].push(def.code);
        if (val !== null) {
          row[period] = decimal(val);
          if (form === 'B01' && !def.terms) {
            if (contraAssets.has(def.code) && val > 0n) issues.push('B01 ' + def.code + ' phải trình bày số âm hoặc bằng 0 (' + periodLabel(form, period) + ').');
            if (!contraAssets.has(def.code) && !signedEquity.has(def.code) && val < 0n) issues.push('B01 ' + def.code + ' có số dư ngược dấu; cần kiểm tra và phân loại chi tiết (' + periodLabel(form, period) + ').');
          }
          if (form === 'B03' && !def.terms && def.code !== '22' && def.code !== '61' && ((outflows.has(def.code) && val > 0n) || (!outflows.has(def.code) && val < 0n))) {
            issues.push('B03 ' + def.code + ' sai dấu thu/chi (' + periodLabel(form, period) + ').');
          }
        }
        row.sources[period] = def.terms ? [form + ' ' + def.terms.join(' + ').replaceAll('+ -', '− ')] : values.get(keyOf(form, def.code, period))?.sources ?? [];
      }
      result.forms[form].push(row);
    }
    for (const period of periods) if (missing[period].length) issues.push(form + ' ' + periodLabel(form, period) + ' cần bổ sung hoặc xác nhận không phát sinh: ' + missing[period].join(', ') + '.');
  }
  const get = (form: FormId, code: string, period: PeriodKey) => result.forms[form].find(row => row.code === code)![period];
  const check = (left: string | null, right: string | null, message: string) => {
    if (left !== null && right !== null && left !== right) issues.push(message + ' (' + left + ' ≠ ' + right + ').');
  };
  for (const period of periods) {
    check(get('B01', '280', period), get('B01', '440', period), 'B01 tổng tài sản và tổng nguồn vốn lệch ' + periodLabel('B01', period));
    check(get('B03', '70', period), get('B01', '110', period), 'Tiền cuối kỳ B03 mã 70 lệch B01 mã 110 ' + periodLabel('B03', period));
  }
  check(get('B03', '60', 'current'), get('B01', '110', 'prior'), 'Tiền đầu kỳ B03 mã 60 lệch B01 mã 110 đầu năm');
  return result;
}
