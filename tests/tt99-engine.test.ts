import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatements } from '../src/tt99-engine.ts';
import type { FormId, InputLine, JournalRow, PeriodKey, StatementReport, StatementsInput, TrialRow } from '../src/tt99-types.ts';

const input = (): StatementsInput => ({ start: '2026-01-01', end: '2026-12-31', lines: [], receivables: [] });
const line = (form: FormId, code: string, amount: string, period: PeriodKey = 'current'): InputLine => ({ form, code, period, amount, source: form + ' sổ ' + code });
const get = (report: StatementReport, form: FormId, code: string) => report.forms[form].find(row => row.code === code)!;
function confirmBlanks(data: StatementsInput) {
  const draft = buildStatements(data);
  for (const form of ['B01', 'B02', 'B03'] as const) {
    for (const row of draft.forms[form]) {
      if (row.total) continue;
      for (const period of ['current', 'prior'] as const) {
        if (row[period] === null) data.lines.push({ form, code: row.code, amount: '0', period, source: 'Đối chiếu sổ: không phát sinh' });
      }
    }
  }
}
function trial(account: string, debit: string, credit: string, b01?: string): TrialRow {
  return { account, openingDebit: '0', openingCredit: '0', debit, credit, closingDebit: debit, closingCredit: credit, b01, basis: b01 ? 'credit' : undefined, source: 'Bảng CĐPS · ' + account };
}
const journal = (changes: Partial<JournalRow>): JournalRow => ({ date: '2026-06-01', debitAccount: '131', creditAccount: '511', amount: '10', period: 'current', source: 'Sổ cái ! A8', ...changes });

test('TK 131 presents debt and advances by customer and maturity, reconciles a net control and keeps provenance', () => {
  const data = input();
  data.trial = [trial('131', '70000000', '0'), trial('411', '0', '70000000', '411')];
  data.receivables = [
    { customer: 'A', term: 'short', period: 'current', debit: '100000000', credit: '0', source: 'Theo dõi!A2' },
    { customer: 'B', term: 'short', period: 'current', debit: '0', credit: '30000000', source: 'Theo dõi!A3' },
  ];
  let report = buildStatements(data);
  assert.equal(get(report, 'B01', '131').current, '100000000');
  assert.equal(get(report, 'B01', '312').current, '30000000');
  assert.match(get(report, 'B01', '312').sources.current.join(' '), /Theo dõi!A3/);
  assert.equal(get(report, 'B01', '280').current, null);
  confirmBlanks(data);
  report = buildStatements(data);
  assert.deepEqual(report.issues, []);
  assert.equal(get(report, 'B01', '280').current, '100000000');
  assert.equal(get(report, 'B01', '440').current, '100000000');
  data.receivables[0].term = 'long';
  data.lines = data.lines.filter(x => !(x.form === 'B01' && x.code === '211' && x.period === 'current'));
  assert.equal(get(buildStatements(data), 'B01', '211').current, '100000000');
  data.receivables[1].credit = '40000000';
  assert.match(buildStatements(data).issues.join(' '), /TK 131 cuối năm lệch/);
});

test('mixed sources, double counting accounts, invalid cutoffs and wrong cash classification block final numbers', () => {
  const data = input();
  data.trial = [trial('131', '50', '0'), trial('1311', '50', '0')];
  data.receivables = [{ customer: 'A', term: 'short', period: 'current', debit: '50', credit: '0', source: 'A' }];
  data.lines = [line('B01', '131', '50'), line('B01', '280', '50'), line('B03', '02', '1')];
  data.journal = [journal({ date: '2026-02-30' }), journal({ debitAccount: '911', b02: '01' }), journal({ debitAccount: '111', creditAccount: '112', b03: '01' })];
  const report = buildStatements(data);
  assert.equal(get(report, 'B01', '131').current, '50');
  for (const message of ['tổng hợp và chi tiết', 'Trùng dữ liệu', 'không được nhập trực tiếp', 'sai dấu', 'ngoài kỳ', 'kết chuyển', 'Chuyển tiền nội bộ']) {
    assert.ok(report.issues.join(' ').includes(message), message);
  }
});

test('B02 and B03 aggregate independently from classified journal without counting transfers or interest twice', () => {
  const data = input();
  data.journal = [
    journal({ debitAccount: '111', creditAccount: '511', b02: '01', b03: '01', amount: '100.123456' }),
    journal({ debitAccount: '635', creditAccount: '111', b02: '24', b03: '04', amount: '10.10' }),
    journal({ debitAccount: '635', creditAccount: '331', b02: '23', amount: '2' }),
    journal({ debitAccount: '511', creditAccount: '911', amount: '100.123456' }),
    journal({ debitAccount: '112', creditAccount: '111', amount: '10' }),
  ];
  data.lines = [line('B01', '111', '90.023456'), line('B01', '411', '90.023456')];
  confirmBlanks(data);
  const report = buildStatements(data);
  assert.deepEqual(report.issues, []);
  assert.equal(get(report, 'B02', '23').current, '12.1');
  assert.equal(get(report, 'B02', '24').current, '10.1');
  assert.equal(get(report, 'B02', '60').current, '88.023456');
  assert.equal(get(report, 'B03', '70').current, '90.023456');
  assert.equal(get(report, 'B03', '04').current, '-10.1');
});

test('recognizes new TT99 statement codes, exact amounts and conditional equity/EPS lines', () => {
  const data = input();
  data.jointStock = true;
  data.lines = [line('B01', '411a', '9007199254740993.1234'), line('B01', '411b', '0.2'), line('B01', '111', '9007199254740993.3234'), line('B03', '01', '9007199254740993.3234')];
  confirmBlanks(data);
  let report = buildStatements(data);
  assert.equal(get(report, 'B01', '411').current, '9007199254740993.3234');
  assert.equal(get(report, 'B02', '70').current, '0');
  assert.deepEqual(report.issues, []);
  assert.ok(get(report, 'B01', '313').label.includes('cổ tức'));
  data.lines.push(line('B03', '61', '2'));
  assert.ok(buildStatements(data).issues.some(s => s.includes('Tiền cuối kỳ B03 mã 70 lệch')));
  report = buildStatements(input());
  assert.ok(!get(report, 'B02', '70') && !get(report, 'B01', '411a'));
  assert.equal(get(report, 'B01', '411').total, false);
});

test('annual applicability, calendar dates, decimals and traceable evidence all gate completion', () => {
  const data = input();
  data.start = '2025-07-01'; data.end = '2026-06-30';
  data.lines = [line('B02', '01', '1.00000001'), { ...line('B01', '111', '3'), source: '' }];
  data.journal = [journal({ date: '2026-07-01', b02: '01' })];
  const issues = buildStatements(data).issues.join(' ');
  for (const message of ['áp dụng cho năm tài chính', 'Thiếu tham chiếu', 'ngoài kỳ', 'chữ số thập phân']) assert.ok(issues.includes(message), message);
  assert.ok(buildStatements({ ...input(), end: '2027-04-01' }).issues.some(s => s.includes('15 tháng')));
  assert.ok(!buildStatements({ ...input(), end: '2027-03-31' }).issues.some(s => s.includes('15 tháng')));
});

test('control account movements reconcile both legs, accepting detailed posting accounts', () => {
  const data = input();
  data.trial = [
    { ...trial('111', '10', '0', '111'), basis: 'debit' },
    trial('411', '0', '10', '411'),
  ];
  data.journal = [journal({ debitAccount: '1111', creditAccount: '4111', b03: '31' })];
  confirmBlanks(data);
  assert.deepEqual(buildStatements(data).issues, []);
  data.journal[0].amount = '7';
  assert.ok(buildStatements(data).issues.some(s => s.includes('TK 411 lệch phát sinh')));
  data.journal[0].creditAccount = '419';
  assert.ok(buildStatements(data).issues.some(s => s.includes('TK 419 phát sinh')));
});

test('rejects unsupported noncash journal tags and accepts evidenced settlements or negative net disposal cash', () => {
  const data = input();
  data.journal = [
    journal({ debitAccount: '211', creditAccount: '341', b03: '21' }),
    journal({ debitAccount: '811', creditAccount: '111', b02: '32', b03: '22' }),
  ];
  let report = buildStatements(data);
  assert.ok(report.issues.some(s => s.includes('căn cứ tương đương tiền')));
  assert.equal(get(report, 'B03', '22').current, '-10');
  assert.ok(!report.issues.some(s => s.includes('B03 22 sai dấu')));
  data.journal[0].cashEvidence = 'Ngân hàng giải ngân và thanh toán ngay cho nhà cung cấp, UNC 02';
  data.journal[0].b03Sign = -1;
  report = buildStatements(data);
  assert.equal(get(report, 'B03', '21').current, '-10');
  assert.ok(!report.issues.some(s => s.includes('căn cứ tương đương tiền')));
});

test('flat 131 control with turnover requires source detail; abnormal balances cannot be netted into other customers', () => {
  const data = input();
  data.trial = [{ ...trial('131', '100', '100'), closingDebit: '0', closingCredit: '0' }];
  assert.ok(buildStatements(data).issues.some(s => s.includes('số dư tổng hợp cuối kỳ bằng 0')));
  data.trial = [{ ...trial('331', '2', '0', '311'), basis: 'credit' }, trial('411', '0', '2', '411')];
  assert.ok(buildStatements(data).issues.some(s => s.includes('TK 331 có số dư ngược dấu')));
});

test('fiscal year comparison includes leap day immediately before a March year opening', () => {
  const data = { ...input(), start: '2028-03-01', end: '2029-02-28' };
  data.journal = [journal({ date: '2028-02-29', period: 'prior', b02: '01' })];
  const report = buildStatements(data);
  assert.equal(get(report, 'B02', '01').prior, '10');
  assert.equal(get(report, 'B03', '20').section, 'I. Lưu chuyển tiền từ hoạt động kinh doanh');
  assert.equal(get(report, 'B03', '21').section, 'II. Lưu chuyển tiền từ hoạt động đầu tư');
  assert.equal(get(report, 'B03', '40').section, 'III. Lưu chuyển tiền từ hoạt động tài chính');
  assert.equal(get(report, 'B03', '50').section, undefined);
});
