import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { TT99_SHEETS } from '../src/tt99-import-schema.ts';
import { readTT99File } from '../src/tt99-import.ts';
import { readSheetRows, readSourceWorkbook } from '../src/workbook-input.ts';
import { losslessNumericCell } from '../src/import-number.ts';

function workbook(sheet: XLSX.WorkSheet, name = 'Sổ'): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, name);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

test('TT99 accepts Vietnamese CSV without BOM, preserves exact money, periods and physical line references', () => {
  const headers = TT99_SHEETS.receivables.headers.join(',');
  const csv = headers + '\nHiện tại,Khách A,Ngắn hạn,100000000000000.01,0\n\nSo sánh,Khách B,Dài hạn,0,30';
  for (const bom of ['', '\uFEFF']) {
    const data = readTT99File('Sổ.csv', new TextEncoder().encode(bom + csv).buffer);
    assert.deepEqual(data.receivables?.map(({ customer, period, term, debit, source }) => [customer, period, term, debit, source]), [
      ['Khách A', 'current', 'short', '100000000000000.01', 'Sổ.csv · Sheet1!2'],
      ['Khách B', 'prior', 'long', '0', 'Sổ.csv · Sheet1!4'],
    ]);
    assert.equal(data.lines, undefined);
  }
  assert.equal(losslessNumericCell('100000000000000.01'), '100000000000000.01');
  assert.equal(losslessNumericCell('1.5000'), 1.5);
});

test('Excel numeric dates keep their civil day in general reports and journals at UTC+7', () => {
  const initial = process.env.TZ;
  process.env.TZ = 'Asia/Ho_Chi_Minh';
  try {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...TT99_SHEETS.journal.headers], ['Hiện tại', 46023, '111', '131', 100, '', '', '01', 1],
    ]);
    sheet.B2.z = 'yyyy-mm-dd';
    const bytes = workbook(sheet), book = readSourceWorkbook('a.xlsx', bytes);
    const rows = readSheetRows(book.Sheets.Sổ, 'Sổ', XLSX.utils.decode_range('A1:I2'), false);
    assert.equal((rows[1][1] as Date).toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(readTT99File('a.xlsx', bytes).journal?.[0].date, '2026-01-01');
  } finally {
    if (initial === undefined) delete process.env.TZ; else process.env.TZ = initial;
  }
});

// Some OOXML producers omit the numeric cell type, causing SheetJS to set a
// missing formula cache to zero. Exercise that encoding as well as Excel errors.
function numericXmlCell(xml: string): ArrayBuffer {
  const sheet = workbook(XLSX.utils.aoa_to_sheet([['Amount'], [1]]));
  const zip = XLSX.CFB.read(new Uint8Array(sheet), { type: 'array' });
  const path = 'Root Entry/xl/worksheets/sheet1.xml';
  const part = zip.FileIndex[zip.FullPaths.indexOf(path)];
  const unpacked = Buffer.from(part.content).toString().replace(/<c r="A2"[^>]*>.*?<\/c>/, xml);
  XLSX.CFB.utils.cfb_add(zip, path, Buffer.from(unpacked));
  return Uint8Array.from(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' })).buffer;
}

test('original OOXML formula cache distinguishes zero, error and missing results including default numeric type', () => {
  const range = XLSX.utils.decode_range('A1:A2');
  const rows = (xml: string) => readSheetRows(readSourceWorkbook('test.xlsx', numericXmlCell(xml)).Sheets.Sổ, 'Sổ', range, true);
  assert.throws(() => rows('<c r="A2"><f>1-1</f></c>'), /Công thức.*Sổ!A2/);
  assert.throws(() => rows('<c r="A2" t="e"><v>#DIV/0!</v></c>'), /#DIV\/0!.*Sổ!A2/);
  assert.deepEqual(rows('<c r="A2"><f>1-1</f><v>0</v></c>'), [['Amount'], [0]]);
  assert.deepEqual(rows('<c r="A2"><v>100000000000000.01</v></c>'), [['Amount'], ['100000000000000.01']]);
});

test('TT99 imports matched headers in arbitrary order and rejects missing amounts, duplicate roles and unknown columns', () => {
  const csv = (text: string) => readTT99File('mapping.csv', new TextEncoder().encode(text).buffer);
  const lines = csv('Căn cứ,Số tiền,Biểu,Mã chỉ tiêu,Kỳ\nĐối chiếu năm 2026,0,B01,111,current');
  assert.equal(lines.lines?.[0].amount, '0');
  assert.match(lines.lines![0].source, /Sheet1!2.*Đối chiếu/);
  assert.throws(() => csv('Căn cứ,Số tiền,Biểu,Mã chỉ tiêu,Kỳ\nGhi chú,,B01,111,current'), /Số tiền.*B2/);
  assert.throws(() => csv('Căn cứ,Số tiền,Biểu,Mã chỉ tiêu,Kỳ,extra'), /tiêu đề/);
  const book = XLSX.utils.book_new();
  for (const s of ['Sổ A', 'Sổ B']) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...TT99_SHEETS.trial.headers]]), s);
  assert.throws(() => readTT99File('trùng.xlsx', XLSX.write(book, { type: 'array', bookType: 'xlsx' })), /nhiều sheet cùng loại/);
});
