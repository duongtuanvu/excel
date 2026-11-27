import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { emptyTT99Project, evaluateTT99Project, parseTT99Project, serializeTT99Project } from '../src/tt99-project.ts';
import { exportTT99Workbook } from '../src/tt99-output.ts';
import { noteOutline } from '../src/tt99-note-outline.ts';
import { readTT99File } from '../src/tt99-import.ts';
import { TT99_SHEETS } from '../src/tt99-import-schema.ts';

test('save and reopen the original evidence, notes, company type and long analytic account', () => {
  const p = emptyTT99Project();
  p.name = 'Công ty A';
  p.jointStock = true;
  p.notes = { IV: 'Dòng\tChi tiết' };
  p.journal = [{date:'2026-02-02',period:'current',debitAccount:'331.' + '2'.repeat(40),creditAccount:'341',
    amount:'9007199254740993.01',b03:'02',b03Sign:-1,cashEvidence:'Ngân hàng giải ngân trực tiếp cho nhà cung cấp',source:'Nhật ký!8'}];
  const text = serializeTT99Project(p);
  assert.deepEqual(JSON.parse(serializeTT99Project(parseTT99Project(text))), JSON.parse(text));
  assert.deepEqual(parseTT99Project(text).journal[0].cashEvidence, p.journal[0].cashEvidence);
  assert.throws(() => parseTT99Project(text.replace('"version":1','"version":2')), /phiên bản/);
});

test('draft retains exact money and missing cells, final refuses missing statements and unedited B09 outlines', async () => {
  const p = emptyTT99Project();
  p.lines.push({form:'B02',code:'01',period:'current',amount:'100000000000000.01',source:'Bảng doanh thu!7'});
  p.notes = { I:noteOutline('I') }; p.notesCompletion = { I:true };
  const report = evaluateTT99Project(p);
  assert.equal(report.notes.find(n => n.id === 'I')!.reviewed,false);
  await assert.rejects(exportTT99Workbook(p,'final'),/Chưa thể xuất/);
  const book = XLSX.read(await exportTT99Workbook(p,'draft'),{type:'array'});
  const data = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['B02-DN'],{header:1,defval:null});
  const row = data.find(r => r[1] === '01')!;
  assert.equal(row[3],'100000000000000.01');
  assert.equal(row[4],null);
});

test('B09 customer note reconciles to 131 after netting repeated entries for the same customer and term', () => {
  const p = emptyTT99Project();
  p.receivables = [
    {period:'current',customer:'A',term:'short',debit:'100.1234',credit:'0',source:'!2'},
    {period:'current',customer:'A',term:'short',debit:'0',credit:'30',source:'!3'},
    {period:'current',customer:'B',term:'short',debit:'0',credit:'20',source:'!4'},
  ];
  const r = evaluateTT99Project(p);
  const note = r.notes.find(n => n.id === 'V')!;
  assert.equal(note.rows.find(v => v.label.endsWith(' · A'))?.current,'70.1234');
  assert.equal(note.rows.some(v => v.label.endsWith(' · B')),false);
  assert.equal(r.forms.B01.find(v => v.code === '131')!.current,'70.1234');
  assert.equal(r.forms.B01.find(v => v.code === '312')!.current,'20');
});

test('Excel numeric codes preserve the leading zero in B02 and B03', () => {
  const book = XLSX.utils.book_new();
  for (const [role, values] of [
    ['journal',['Hiện tại','2026-01-01','111','511',42,1,1,1,1]],
    ['lines',['B03',2,'Hiện tại',-42,'Sổ chi']],
  ] as const) {
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[...TT99_SHEETS[role].headers],[...values]]),role);
  }
  const sources = readTT99File('codes.xlsx',XLSX.write(book,{type:'array',bookType:'xlsx'}));
  assert.equal(sources.journal![0].b02,'01');
  assert.equal(sources.journal![0].b03,'01');
  assert.equal(sources.lines![0].code,'02');
});
