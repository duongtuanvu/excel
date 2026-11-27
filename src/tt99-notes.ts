import { fixedString, parseFixed } from './financial-decimal.ts';
import { noteTextReady } from './tt99-note-outline.ts';
import type { FormId, PeriodKey, Receivable, StatementReport, StatementRow } from './tt99-types.ts';

// B09-DN, Phụ lục IV, Công báo 1577 + 1578, trang 53–95.
// The published annual going-concern form moves from section V to section VII.
export const TT99_REFERENCE = 'https://congbao.chinhphu.vn/van-ban/thong-tu-so-99-2025-tt-btc-46529/59652.htm';

interface NoteDefinition {
  id: string;
  title: string;
  hint: string;
  form?: FormId;
  codes?: string[];
}

const definitions: NoteDefinition[] = [
  { id: 'I', title: 'I. Đặc điểm hoạt động của doanh nghiệp',
    hint: 'Hình thức sở hữu, ngành và chu kỳ kinh doanh, đặc điểm trong năm, cấu trúc đơn vị, người lao động và khả năng so sánh.' },
  { id: 'II', title: 'II. Kỳ kế toán và đơn vị tiền tệ',
    hint: 'Xác nhận kỳ kế toán, đồng tiền ghi sổ, đồng tiền trình bày và thay đổi so với năm trước.' },
  { id: 'III', title: 'III. Chuẩn mực và chế độ kế toán áp dụng',
    hint: 'Ghi chế độ áp dụng thực tế và tuyên bố của doanh nghiệp về tuân thủ các chuẩn mực, chế độ kế toán.' },
  { id: 'IV', title: 'IV. Chính sách kế toán, ước tính và quy định áp dụng',
    hint: 'Trình bày các chính sách áp dụng theo mục IV của mẫu B09, gồm tỷ giá, tiền, công nợ, hàng tồn kho, khấu hao, vốn, doanh thu, chi phí, thuế và ước tính có liên quan.' },
  { id: 'V', title: 'V. Thông tin bổ sung về tình hình tài chính',
    hint: 'Bổ sung các bảng chi tiết áp dụng trong 32 mục của phần V. Gồm tiền và hạn chế sử dụng, đầu tư, công nợ theo đối tượng và kỳ hạn, tồn kho, biến động tài sản, thuế, công nợ phải trả, vốn và các khoản ngoài báo cáo.',
    form: 'B01', codes: ['110','120','130','140','150','160','210','220','230','240','250','260','270','310','330','400'] },
  { id: 'VII', title: 'VII. Thông tin bổ sung về kết quả kinh doanh',
    hint: 'Phân tích doanh thu, giảm trừ, giá vốn, bán hoặc thanh lý bất động sản đầu tư, hoạt động tài chính, thu chi khác, chi phí bán hàng, quản lý, chi phí theo yếu tố và thuế TNDN.',
    form: 'B02', codes: ['01','02','11','21','22','23','24','25','26','31','32','51','52'] },
  { id: 'VIII', title: 'VIII. Thông tin bổ sung về lưu chuyển tiền tệ',
    hint: 'Giải thích tiền bị hạn chế sử dụng, giao dịch phi tiền tệ, chi tiết vay và trả gốc vay, mua hoặc thanh lý công ty con.',
    form: 'B03', codes: ['33','34','35','60','70'] },
  { id: 'IX', title: 'IX. Những thông tin khác',
    hint: 'Cam kết, nợ tiềm tàng, sự kiện sau ngày kết thúc kỳ, bên liên quan, báo cáo bộ phận, số so sánh, giả định hoạt động liên tục và các ước tính trọng yếu.' },
  { id: 'X', title: 'X. Sửa đổi, bổ sung biểu mẫu và chỉ tiêu',
    hint: 'Nêu chỉ tiêu, nội dung, lý do thay đổi biểu mẫu của doanh nghiệp hoặc xác nhận áp dụng mẫu ban hành.' },
];

export interface NoteResult {
  id: string;
  title: string;
  hint: string;
  text: string;
  reviewed: boolean;
  rows: Pick<StatementRow, 'label' | 'current' | 'prior'>[];
  periodLabels: readonly [string, string];
}

// B09 V.3 asks for significant receivables and the remaining customers.
// Use the union of both periods' significant customers for comparable columns.
export function customerRows(details: Receivable[]): NoteResult['rows'] {
  const output: NoteResult['rows'] = [];
  for (const term of ['short','long'] as const) {
    const balances: Record<PeriodKey, Map<string,bigint>> = { current:new Map(),prior:new Map() };
    const covered = { current:false, prior:false };
    const totals = { current:0n,prior:0n };
    for (const detail of details) {
      if (detail.term !== term) continue;
      let value: bigint;
      try { value = parseFixed(detail.debit,6) - parseFixed(detail.credit,6); }
      catch { continue; } // The statement engine reports invalid source rows.
      covered[detail.period] = true;
      const map = balances[detail.period];
      const customer = detail.customer.trim();
      map.set(customer,(map.get(customer) ?? 0n) + value);
    }
    const name = term === 'short' ? 'Phải thu ngắn hạn' : 'Phải thu dài hạn';
    const significant = new Set<string>();
    for (const key of ['current','prior'] as const) {
      for (const [customer,amount] of balances[key]) {
        if (amount <= 0n) balances[key].delete(customer);
        else totals[key] += amount;
      }
      for (const [customer,amount] of balances[key]) if (amount * 10n >= totals[key]) significant.add(customer);
    }
    function add(label: string, current: bigint, prior: bigint) {
      output.push({ label: name + ' · ' + label, current: covered.current ? fixedString(current,6).replace(/\.?0{1,6}$/, '') : null,
        prior: covered.prior ? fixedString(prior,6).replace(/\.?0{1,6}$/, '') : null });
    }
    const rest = { ...totals };
    for (const customer of significant) {
      const current = balances.current.get(customer) ?? 0n, prior = balances.prior.get(customer) ?? 0n;
      add(customer,current,prior);
      rest.current -= current;
      rest.prior -= prior;
    }
    if (rest.current || rest.prior) add('Khách hàng khác',rest.current,rest.prior);
  }
  return output;
}

export function buildNotes(forms: StatementReport['forms'], notes: Record<string, string>, completion: Record<string, boolean>, details: Receivable[],
  receivableRows = customerRows(details)): NoteResult[] {
  return definitions.map(def => {
    const text = notes[def.id] ?? '';
    const rows = def.form ? forms[def.form].filter(row => def.codes?.includes(row.code)) : [];
    return {
      id: def.id, title: def.title, hint: def.hint, text,
      reviewed: Boolean(noteTextReady(text) && completion[def.id]),
      rows: [...rows.map(({ label, current, prior }) => ({ label, current, prior })), ...(def.id === 'V' ? receivableRows : [])],
      periodLabels: def.form === 'B01' ? ['Cuối năm', 'Đầu năm'] : ['Năm nay', 'Năm trước'],
    };
  });
}

export function noteReference(form: FormId) {
  return definitions.find(def => def.form === form)!.id;
}

export const noteIds = definitions.map(note => note.id);
