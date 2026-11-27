import * as XLSX from 'xlsx';
import { fixedString, parseFixed } from './financial-decimal.ts';
import { LIMITS } from './model.ts';
import { resolveLayout } from './import-model.ts';
import { convertSchemaCell } from './schema-model.ts';
import { readSheetRows, readSourceWorkbook } from './workbook-input.ts';
import { TT99_SHEETS } from './tt99-import-schema.ts';
import type { TT99Sources } from './tt99-import-schema.ts';
import type { PeriodKey, TrialRow } from './tt99-types.ts';

type Role = keyof TT99Sources;
type RowReader = (header: string, optional?: boolean) => string;

const roles = Object.keys(TT99_SHEETS) as Role[];
const requiredHeaders: Record<Role, number> = { trial: 7, journal: 5, receivables: 5, lines: 5 };
const normalize = (s: string) => s.trim().normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ');

function amount(raw: string): string {
  try {
    const value = fixedString(parseFixed(raw, 6), 6);
    return value.replace(/0+$/, '').replace(/\.$/, '');
  } catch {
    throw new Error('Số tiền không hợp lệ: “' + raw.slice(0, 60) + '”. Dùng dấu chấm thập phân, tối đa 6 số lẻ, bỏ dấu nhóm nghìn.');
  }
}

function period(read: RowReader): PeriodKey {
  const key = normalize(read('Kỳ'));
  if (['current', 'hiện tại', 'năm nay', 'cuối năm', 'cuối kỳ'].includes(key)) return 'current';
  if (['prior', 'so sánh', 'năm trước', 'đầu năm', 'đầu kỳ'].includes(key)) return 'prior';
  throw new Error('Kỳ phải là Hiện tại hoặc So sánh.');
}

function date(raw: string): string {
  const iso = convertSchemaCell(raw, /^\d{4}-/.test(raw) ? 'date' : 'date-vi');
  if (typeof iso !== 'string') throw new Error('Ngày phải là ngày Excel, YYYY-MM-DD hoặc DD/MM/YYYY.');
  return iso.slice(0, 10);
}

const bases: Record<string, NonNullable<TrialRow['basis']>> = {
  'nợ': 'debit', 'có': 'credit', 'âm nợ': 'minusDebit', 'âm có': 'minusCredit',
  debit: 'debit', credit: 'credit', minusdebit: 'minusDebit', minuscredit: 'minusCredit',
};
function sign(raw: string): 1 | -1 {
  if (raw === '1' || raw === '+1') return 1;
  if (raw === '-1') return -1;
  throw new Error('Dấu chỉ tiêu phải là 1 hoặc -1.');
}

// Excel General cells turn a typed B02/B03 code such as 01 into the number 1.
function statementCode(code: string, form: string): string {
  return (form === 'B02' || form === 'B03') && /^[1-9]$/.test(code) ? '0' + code : code;
}

function addRow(out: TT99Sources, role: Role, read: RowReader, ref: string) {
  if (role === 'trial') {
    const b01 = read('Mã B01', true), method = read('Cách lấy số dư', true);
    const basis = bases[normalize(method)];
    if ((method && !basis) || Boolean(b01) !== Boolean(method))
      throw new Error('Điền cả Mã B01 và Cách lấy số dư (Nợ, Có, Âm Nợ hoặc Âm Có), hoặc để trống cả hai.');
    out.trial!.push({
      account: read('Tài khoản'), openingDebit: amount(read('Dư Nợ đầu kỳ')), openingCredit: amount(read('Dư Có đầu kỳ')),
      debit: amount(read('Phát sinh Nợ')), credit: amount(read('Phát sinh Có')),
      closingDebit: amount(read('Dư Nợ cuối kỳ')), closingCredit: amount(read('Dư Có cuối kỳ')),
      ...(b01 ? { b01, basis } : {}), source: ref,
    });
  } else if (role === 'journal') {
    const b02 = statementCode(read('Mã B02', true),'B02'), b03 = statementCode(read('Mã B03', true),'B03');
    const sign2 = read('Dấu B02', true), sign3 = read('Dấu B03', true);
    const cashEvidence = read('Căn cứ dòng tiền', true);
    if ((sign2 && !b02) || (sign3 && !b03)) throw new Error('Đã có dấu nhưng chưa có mã chỉ tiêu B02/B03.');
    if (cashEvidence && !b03) throw new Error('Đã có căn cứ dòng tiền nhưng chưa có mã B03.');
    out.journal!.push({
      date: date(read('Ngày')), period: period(read), debitAccount: read('Tài khoản Nợ'), creditAccount: read('Tài khoản Có'),
      amount: amount(read('Số tiền')), ...(b02 ? { b02 } : {}), ...(sign2 ? { b02Sign: sign(sign2) } : {}),
      ...(b03 ? { b03 } : {}), ...(sign3 ? { b03Sign: sign(sign3) } : {}),
      ...(cashEvidence ? { cashEvidence } : {}), source: ref,
    });
  } else if (role === 'receivables') {
    const raw = normalize(read('Thời hạn'));
    const term = ['short', 'ngắn hạn'].includes(raw) ? 'short' : ['long', 'dài hạn'].includes(raw) ? 'long' : null;
    if (!term) throw new Error('Thời hạn phải là Ngắn hạn hoặc Dài hạn.');
    out.receivables!.push({ period: period(read), customer: read('Khách hàng'), term, debit: amount(read('Dư Nợ')), credit: amount(read('Dư Có')), source: ref });
  } else {
    const form = read('Biểu').trim().toUpperCase().replace(/-DN$/, '');
    if (form !== 'B01' && form !== 'B02' && form !== 'B03') throw new Error('Biểu phải là B01, B02 hoặc B03.');
    out.lines!.push({ form, code: statementCode(read('Mã chỉ tiêu'),form), period: period(read), amount: amount(read('Số tiền')), source: ref + ' · ' + read('Căn cứ') });
  }
}

/** The caller replaces only the roles present in a successfully parsed file. */
export function readTT99File(name: string, bytes: ArrayBuffer): TT99Sources {
  const book = readSourceWorkbook(name, bytes);
  if (book.SheetNames.length > 32) throw new Error('Workbook vượt giới hạn 32 sheet.');
  const out: TT99Sources = {};
  let totalCells = 0;
  for (const sheet of book.SheetNames) {
    if (normalize(sheet) === 'hướng dẫn') continue;
    const ws = book.Sheets[sheet];
    if (!ws?.['!ref']) throw new Error(sheet + ': Thiếu dòng tiêu đề theo mẫu TT99.');
    const bounds = (ref: string) => {
      const { s, e } = XLSX.utils.decode_range(ref);
      return { firstRow: s.r + 1, firstColumn: s.c + 1, lastRow: e.r + 1, lastColumn: e.c + 1 };
    };
    resolveLayout(bounds(ws['!fullref'] ?? ws['!ref']), bounds(ws['!ref']), undefined);
    const range = XLSX.utils.decode_range(ws['!ref']);
    totalCells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (totalCells > LIMITS.cells) throw new Error('Workbook TT99 vượt giới hạn 1 triệu ô.');
    const rows = readSheetRows(ws, sheet, range, true);
    const headers = (rows.shift() ?? []).map(value => normalize(String(value ?? '')));
    const role = roles.find(key => TT99_SHEETS[key].headers.slice(0, requiredHeaders[key]).every(h => headers.includes(normalize(h))));
    if (!role) throw new Error(sheet + ': Tiêu đề không khớp mẫu TT99. Hãy dùng các tên cột trong tệp mẫu.');
    if (out[role]) throw new Error(sheet + ': Có nhiều sheet cùng loại ' + TT99_SHEETS[role].name + '. Hãy gộp các dòng cùng loại.');
    const valid = new Set(TT99_SHEETS[role].headers.map(normalize));
    const invalid = headers.find(h => !valid.has(h));
    if (invalid !== undefined || new Set(headers).size !== headers.length) throw new Error(sheet + ': Có tiêu đề trống, lạ hoặc trùng: ' + (invalid || 'hãy kiểm tra dòng tiêu đề') + '.');
    out[role] = [];
    const indices = new Map(headers.map((h, index) => [h, index]));
    for (const [index, row] of rows.entries()) {
      if (!row.some(v => v != null && String(v).trim() !== '')) continue;
      const r = range.s.r + index + 1;
      const ref = name + ' · ' + sheet + '!' + (r + 1);
      const read: RowReader = (header, optional = false) => {
        const c = indices.get(normalize(header)), v = c === undefined ? null : row[c];
        const value = v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : String(v ?? '').trim();
        if (!optional && !value) throw new Error('Thiếu ' + header + (c === undefined ? '' : ' (' + XLSX.utils.encode_cell({ r, c: c + range.s.c }) + ')') + '.');
        if (value.length > LIMITS.textLength) throw new Error(header + ' vượt giới hạn độ dài.');
        return value;
      };
      try { addRow(out, role, read, ref); }
      catch (error) { throw new Error(ref + ' — ' + (error instanceof Error ? error.message : String(error))); }
    }
  }
  if (!Object.keys(out).length) throw new Error('Thiếu bảng nguồn TT99. Hãy nhập ít nhất một sheet theo mẫu.');
  return out;
}

export async function parseTT99File(file: File): Promise<TT99Sources> {
  if (file.size > LIMITS.fileBytes) throw new Error('File TT99 vượt giới hạn 25 MiB.');
  return readTT99File(file.name, await file.arrayBuffer());
}
