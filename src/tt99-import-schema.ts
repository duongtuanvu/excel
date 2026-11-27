import type { StatementsInput } from './tt99-types.ts';

export type TT99Sources = Partial<Pick<StatementsInput, 'trial' | 'journal' | 'receivables' | 'lines'>>;
export const TT99_SHEETS = {
  trial: {
    name: 'Cân đối phát sinh',
    headers: ['Tài khoản', 'Dư Nợ đầu kỳ', 'Dư Có đầu kỳ', 'Phát sinh Nợ', 'Phát sinh Có', 'Dư Nợ cuối kỳ', 'Dư Có cuối kỳ', 'Mã B01', 'Cách lấy số dư'],
  },
  journal: {
    name: 'Nhật ký',
    headers: ['Kỳ', 'Ngày', 'Tài khoản Nợ', 'Tài khoản Có', 'Số tiền', 'Mã B02', 'Dấu B02', 'Mã B03', 'Dấu B03', 'Căn cứ dòng tiền'],
  },
  receivables: {
    name: 'Chi tiết TK 131',
    headers: ['Kỳ', 'Khách hàng', 'Thời hạn', 'Dư Nợ', 'Dư Có'],
  },
  lines: {
    name: 'Chỉ tiêu bổ sung',
    headers: ['Biểu', 'Mã chỉ tiêu', 'Kỳ', 'Số tiền', 'Căn cứ'],
  },
} as const;
