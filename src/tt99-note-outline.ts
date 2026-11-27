// Editable headings for the preparer; calculated balances are displayed separately.
// Numbering follows the annual B09-DN in Appendix IV, including the jump from V to VII.
const blank = '⟦…⟧';
const outlines: Record<string, string[]> = {
  I: [
    'Hình thức sở hữu vốn','Lĩnh vực kinh doanh','Ngành nghề kinh doanh','Chu kỳ kinh doanh thông thường',
    'Đặc điểm trong năm ảnh hưởng đến BCTC','Công ty con, liên doanh, liên kết và đơn vị trực thuộc',
    'Số lao động','Khả năng so sánh số liệu hai kỳ','Thông tin khác theo pháp luật có liên quan',
  ],
  II: ['Kỳ kế toán năm','Đơn vị tiền tệ ghi sổ và thay đổi trong năm (nếu có)'],
  III: ['Chế độ kế toán áp dụng','Tuyên bố của doanh nghiệp về việc tuân thủ chuẩn mực và chế độ kế toán'],
  IV: [
    'Quy đổi báo cáo bằng ngoại tệ sang VND','Tỷ giá sử dụng','Lãi suất thực tế','Tiền và tương đương tiền',
    'Đầu tư tài chính','Nợ phải thu và dự phòng','Hàng tồn kho','Tài sản cố định và bất động sản đầu tư',
    'Tài sản sinh học','Hợp đồng hợp tác kinh doanh','Chi phí chờ phân bổ','Phải trả người bán','Cổ tức và lợi nhuận phải trả',
    'Chi phí phải trả','Doanh thu chờ phân bổ','Dự phòng phải trả','Thuế thu nhập hoãn lại','Vay và nợ thuê tài chính',
    'Chi phí đi vay','Trái phiếu chuyển đổi','Vốn chủ sở hữu','Doanh thu và thu nhập khác','Giảm trừ doanh thu',
    'Giá vốn','Chi phí tài chính','Chi phí bán hàng và quản lý','Bán, thanh lý tài sản','Thuế TNDN','Chính sách khác',
  ],
  V: [
    'Tiền và tương đương tiền','Đầu tư tài chính','Phải thu khách hàng','Phải thu khác','Tài sản thiếu chờ xử lý',
    'Nợ xấu','Hàng tồn kho','Tài sản dở dang dài hạn','Biến động TSCĐ hữu hình','Biến động TSCĐ vô hình',
    'Biến động TSCĐ thuê tài chính','Tài sản sinh học','Biến động bất động sản đầu tư','Chi phí chờ phân bổ','Tài sản khác',
    'Vay và nợ thuê tài chính','Phải trả người bán','Cổ tức, lợi nhuận phải trả','Thuế và khoản phải nộp nhà nước',
    'Chi phí phải trả','Phải trả khác','Doanh thu chờ phân bổ','Trái phiếu phát hành','Cổ phiếu ưu đãi thuộc nợ phải trả',
    'Dự phòng phải trả','Tài sản và nợ thuế hoãn lại','Vốn chủ sở hữu','Chênh lệch đánh giá lại tài sản','Chênh lệch tỷ giá',
    'Khoản mục ngoài báo cáo tình hình tài chính','Tài sản của bên khác bị hạn chế sử dụng và nghĩa vụ liên quan','Giải trình bổ sung',
  ],
  VII: ['Doanh thu bán hàng và cung cấp dịch vụ','Giảm trừ doanh thu','Giá vốn','Lãi/lỗ bán hoặc thanh lý bất động sản đầu tư',
    'Doanh thu tài chính','Chi phí tài chính','Thu nhập khác','Chi phí khác','Chi phí bán hàng và quản lý','Chi phí theo yếu tố','Chi phí thuế TNDN'],
  VIII: ['Tiền bị hạn chế sử dụng','Giao dịch phi tiền tệ','Số tiền vay thực thu','Số tiền thực trả gốc vay','Mua hoặc thanh lý công ty con'],
  IX: ['Nợ tiềm tàng, cam kết','Sự kiện sau ngày kết thúc kỳ','Các bên liên quan','Thông tin bộ phận','Thông tin so sánh',
    'Đánh giá khả năng hoạt động liên tục','Giả định và ước tính trọng yếu','Giải pháp khác'],
  X: ['Tên và nội dung chỉ tiêu sửa đổi hoặc bổ sung, lý do và căn cứ áp dụng'],
};

export function noteOutline(id: string): string {
  return (outlines[id] ?? []).map((label,i) => (i + 1) + '. ' + label + '\n' + blank).join('\n\n');
}

export function noteTextReady(text: string): boolean {
  return Boolean(text.trim()) && !text.includes(blank);
}
