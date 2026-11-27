import * as XLSX from 'xlsx';
import type { WorkBook, WorkSheet } from 'xlsx';
import { losslessNumericCell } from './import-number.ts';
import { fitStatementPages } from './tt99-print.ts';
import { TT99_SHEETS } from './tt99-import-schema.ts';
import { noteReference, TT99_REFERENCE } from './tt99-notes.ts';
import { emptyTT99Project, evaluateTT99Project } from './tt99-project.ts';
import type { TT99Project } from './tt99-project.ts';
import type { FormId, PeriodKey, StatementRow } from './tt99-types.ts';

export { emptyTT99Project, evaluateTT99Project, parseTT99Project, serializeTT99Project, TT99_PROJECT_MAX_BYTES } from './tt99-project.ts';
export type { TT99Project } from './tt99-project.ts';
export type { NoteResult } from './tt99-notes.ts';

const titles = {
  B01: 'BÁO CÁO TÌNH HÌNH TÀI CHÍNH',
  B02: 'BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH',
  B03: 'BÁO CÁO LƯU CHUYỂN TIỀN TỆ',
  B09: 'BẢN THUYẾT MINH BÁO CÁO TÀI CHÍNH',
} as const;

type Form = keyof typeof titles;
type Cells = (string | number | null)[][];
type Spreadsheet = typeof import('xlsx');
type ExportMode = 'draft' | 'final';
const statementForms: FormId[] = ['B01','B02','B03'];
const numberFormat = '#,##0.######;(#,##0.######);0';

function dateText(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
}

// Excel preserves at most 15 significant digits. A longer amount is exported
// as literal text, so even another spreadsheet engine can recover every digit.
function excelAmount(value: string | null): number | string | null {
  return value === null ? null : losslessNumericCell(value);
}

function worksheet(x: Spreadsheet, rows: Cells, widths: number[]): WorkSheet {
  const sheet = x.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map(wch => ({ wch }));
  sheet['!margins'] = { left:0.35, right:0.35, top:0.55, bottom:0.55, header:0.25, footer:0.25 };
  return sheet;
}

function merge(sheet: WorkSheet, row: number, lastColumn: number) {
  (sheet['!merges'] ??= []).push({ s: { r: row, c: 0 }, e: { r: row, c: lastColumn } });
}

// Keep full pasted disclosures and source references within Excel's cell limit.
function appendLongRow(rows: Cells, cells: Cells[number]) {
  const limit = 32_000;
  const length = cells.reduce<number>((max, cell) => Math.max(max, typeof cell === 'string' ? cell.length : 0), 1);
  for (let offset = 0; offset < length; offset += limit) {
    rows.push(cells.map(cell => typeof cell === 'string' ? cell.slice(offset,offset + limit) : offset === 0 ? cell : null));
  }
}

function heading(p: TT99Project, form: Form, mode: ExportMode): Cells {
  return [
    ['Đơn vị báo cáo', p.name], ['Địa chỉ', p.address],
    ['Mẫu số ' + form + '-DN · Thông tư 99/2025/TT-BTC'],
    [titles[form]], [form === 'B03' ? 'Phương pháp trực tiếp' : 'Báo cáo tài chính riêng năm'],
    [form === 'B01' ? 'Tại ngày ' + dateText(p.end) : 'Từ ngày ' + dateText(p.start) + ' đến ngày ' + dateText(p.end)],
    ['Đơn vị tính: Đồng Việt Nam'],
    [mode === 'draft' ? 'BẢN NHÁP · Ô trống là số liệu cần bổ sung' : ''],
  ];
}

function signatures(p: TT99Project): Cells {
  return [
    [], ['Phê duyệt, ngày ' + (dateText(p.approvalDate) || '…/…/……')],
    ['Người lập', '', 'Kế toán trưởng', '', 'Người đại diện theo pháp luật'],
    ['(Ký, họ tên)', '', '(Ký, họ tên)', '', '(Ký, họ tên, đóng dấu)'],
    [], [], [p.preparer, '', p.chief, '', p.representative],
  ];
}

function applyHeading(sheet: WorkSheet, lastColumn = 4) {
  for (const row of [2,3,4,5,6,7]) merge(sheet,row,lastColumn);
}

function statementSheet(x: Spreadsheet, p: TT99Project, form: FormId, lines: StatementRow[], mode: ExportMode) {
  const rows = heading(p,form,mode);
  const labels = form === 'B01' ? ['Số cuối năm','Số đầu năm'] : ['Năm nay','Năm trước'];
  rows.push(['Chỉ tiêu','Mã số','Thuyết minh',...labels]);
  const first = rows.length;
  let lastSection: string | undefined;
  for (const line of lines) {
    if (line.section && line.section !== lastSection) {
      rows.push([line.section]);
      lastSection = line.section;
    }
    rows.push([line.label, line.code, noteReference(form), excelAmount(line.current), excelAmount(line.prior)]);
  }
  const afterData = rows.length;
  rows.push(...signatures(p));
  const sheet = worksheet(x,rows,[70,23,24,25,31]);
  applyHeading(sheet);
  for (const row of [0,1]) (sheet['!merges'] ??= []).push({ s:{ r:row,c:1 }, e:{ r:row,c:4 } });
  for (let r = first; r < afterData; r++) {
    for (const c of [3,4]) {
      const cell = sheet[x.utils.encode_cell({r,c})];
      if (cell?.t === 'n') cell.z = numberFormat;
    }
  }
  return sheet;
}

function appendNotes(x: Spreadsheet, book: WorkBook, p: TT99Project, result: ReturnType<typeof evaluateTT99Project>, mode: ExportMode) {
  const rows = heading(p,'B09',mode);
  const wide: number[] = [];
  const numbers: number[] = [];
  for (const note of result.notes) {
    wide.push(rows.length);
    rows.push([note.title]);
    if (note.id === 'II') rows.push(['Kỳ kế toán', dateText(p.start), dateText(p.end)], ['Đơn vị trình bày', 'VND']);
    if (note.rows.length) {
      rows.push(['Số liệu đối chiếu từ BCTC', ...note.periodLabels]);
      for (const line of note.rows) {
        numbers.push(rows.length);
        rows.push([line.label, excelAmount(line.current), excelAmount(line.prior)]);
      }
    }
    for (const paragraph of note.text.split(/\r?\n/)) {
      if (paragraph.includes('\t')) appendLongRow(rows,paragraph.split('\t'));
      else {
        // Merged prose spans the same width as the financial tables. Split long
        // narrative into printable lines while preserving explicit paragraphs.
        for (const line of paragraph.match(/.{1,105}(?:\s+|$)|\S{1,105}/gu) ?? ['']) {
          wide.push(rows.length);
          rows.push([line.trimEnd()]);
        }
      }
    }
    if (mode === 'draft' && !note.reviewed) rows.push(['Cần bổ sung hoặc xác nhận mục ' + note.id]);
    rows.push([]);
  }
  rows.push(...signatures(p));
  const columnCount = rows.reduce((n, row) => Math.max(n,row.length), 5);
  if (columnCount > 128) throw new Error('Bảng thuyết minh vượt 128 cột. Hãy chia thành các bảng nhỏ hơn.');
  const widths = Array.from({length:columnCount}, (_,i) => i === 0 ? 60 : i === 4 ? 32 : 24);
  const sheet = worksheet(x,rows,widths);
  applyHeading(sheet);
  for (const row of wide) merge(sheet,row,4);
  for (const r of numbers) for (const c of [1,2]) {
    const cell = sheet[x.utils.encode_cell({r,c})];
    if (cell?.t === 'n') cell.z = numberFormat;
  }
  x.utils.book_append_sheet(book,sheet,'B09-DN');
}

export async function exportTT99Workbook(project: TT99Project, mode: ExportMode): Promise<ArrayBuffer> {
  const result = evaluateTT99Project(project);
  if (mode === 'final' && result.issues.length) throw new Error('Chưa thể xuất BCTC. ' + result.issues[0]);
  const x = XLSX;
  const book = x.utils.book_new();
  for (const form of statementForms) {
    x.utils.book_append_sheet(book,statementSheet(x,project,form,result.forms[form],mode),form + '-DN');
  }
  appendNotes(x,book,project,result,mode);
  if (mode === 'draft') {
    const checks: Cells = [['Đối chiếu trước khi xuất BCTC']];
    for (const issue of result.issues) appendLongRow(checks,[issue]);
    if (!result.issues.length) checks.push(['Đã qua các phép đối chiếu trong KySheet.']);
    x.utils.book_append_sheet(book, worksheet(x,checks,[120]), 'Đối chiếu');
    const evidence: Cells = [['Báo cáo','Mã số','Kỳ','Số trên báo cáo','Căn cứ']];
    for (const form of statementForms) for (const row of result.forms[form].filter(r => !r.total)) {
      for (const key of ['current','prior'] as PeriodKey[]) {
        for (const src of row.sources[key]) {
          appendLongRow(evidence,[form,row.code,key === 'current' ? 'Hiện tại' : 'So sánh',excelAmount(row[key]),src]);
        }
      }
    }
    x.utils.book_append_sheet(book,worksheet(x,evidence,[12,12,20,30,94]),'Nguồn số liệu');
  }
  book.Workbook = { Names: statementForms.map((name,index) => ({
    Name:'_xlnm.Print_Titles', Sheet:index, Ref:"'" + name + "-DN'!$9:$9",
  })) };
  const bytes = x.write(book,{type:'array',bookType:'xlsx',compression:true}) as ArrayBuffer;
  return mode === 'final' ? fitStatementPages(bytes) : bytes;
}

export async function createTT99Template(): Promise<ArrayBuffer> {
  const x = XLSX;
  const book = x.utils.book_new();
  const guide: Cells = [
    ['Nhập sổ lập BCTC riêng năm theo Thông tư 99/2025/TT-BTC'],
    ['Phạm vi','Doanh nghiệp hoạt động liên tục. B03-DN dùng phương pháp trực tiếp. Đơn vị trình bày VND.'],
    ['Cách dùng','Giữ tiêu đề. Chỉ nạp bảng có dữ liệu. Có thể dùng một file Excel nhiều sheet hoặc CSV UTF-8 riêng theo từng bảng.'],
    ['Số tiền','Dùng số hoặc văn bản thập phân chuẩn, không có dấu nhóm nghìn. Nhập số dài dưới dạng văn bản để Excel giữ nguyên.'],
    ['Cân đối phát sinh','Mỗi dòng một tài khoản. Cung cấp đủ sáu số dư, phát sinh Nợ/Có. Chỉ lấy một cấp tài khoản cho mỗi khoản tiền.'],
    ['Phân loại B01','Chọn mã chỉ tiêu chi tiết từ danh mục dưới đây; cơ sở lấy số dư: Nợ, Có, Âm Nợ, Âm Có.'],
    ['Chi tiết TK 131','Mỗi khách hàng và kỳ hạn có số dư riêng. Kỳ Hiện tại ứng với cuối năm; So sánh ứng với đầu năm.'],
    ['Ví dụ TK 131','Khách A, Ngắn hạn, dư Nợ 100000000; khách B, Ngắn hạn, dư Có 30000000. B01 mã 131 và 312 tương ứng.'],
    ['Nhật ký','Một dòng cho mỗi cặp tài khoản đối ứng, ngày YYYY-MM-DD hoặc ô ngày Excel. Mã và dấu thể hiện cách ghi lên B02/B03.'],
    ['Đối chiếu phát sinh','Khi nạp cả nhật ký năm nay và cân đối phát sinh, nhập đủ nhật ký để đối chiếu tổng phát sinh Nợ/Có từng tài khoản, kể cả bút toán kết chuyển.'],
    ['Dấu','Dùng 1 hoặc -1 theo quy ước trình bày. Ví dụ khoản chi trả nhà cung cấp vào mã 02 B03 mang dấu âm. Với khoản loại trừ đã kiểm tra, nhập skip ở cột mã tương ứng.'],
    ['Căn cứ dòng tiền','Với bút toán dòng tiền không qua TK 111/112/113, điền dấu và giải thích chứng từ chứng minh khoản tương đương tiền hoặc thanh toán trực tiếp.'],
    ['Kỳ','Hiện tại hoặc So sánh. Với B02/B03, So sánh là năm trước. Mã B02/B03 như 01, 02 nhập ở dạng văn bản.'],
    ['Chỉ tiêu bổ sung','Nhập số từ tài liệu đã đối chiếu cho mã chi tiết chưa có nguồn. Ghi căn cứ, kể cả khi xác nhận số 0.'],
    ['Thuyết minh','Nhập phần diễn giải và dán bảng chi tiết từ Excel trong mục B09-DN của ứng dụng.'],
    ['Biểu mẫu gốc',TT99_REFERENCE], [], ['Biểu','Mã có thể nhập','Chỉ tiêu'],
  ];
  const {forms} = evaluateTT99Project({...emptyTT99Project(),jointStock:true});
  for (const form of statementForms) {
    for (const row of forms[form]) if (!row.total) guide.push([form,row.code,row.label]);
  }
  guide.push(['B01','411','Vốn góp của chủ sở hữu (doanh nghiệp ngoài loại hình cổ phần)']);
  const guideSheet = worksheet(x,guide,[32,115,76]);
  x.utils.book_append_sheet(book,guideSheet,'Hướng dẫn');
  for (const spec of Object.values(TT99_SHEETS)) {
    x.utils.book_append_sheet(book,worksheet(x,[[...spec.headers]],spec.headers.map(h => Math.max(18,h.length+4))),spec.name);
  }
  return x.write(book,{type:'array',bookType:'xlsx',compression:true}) as ArrayBuffer;
}
