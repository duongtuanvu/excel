# Report Studio — MVP

Web app báo cáo động từ Excel, chạy phía client, không cần API hoặc thư viện bên ngoài.

## Chạy

- Mở `index.html` bằng Chrome/Edge/Firefox phiên bản mới. Nếu trình duyệt hạn chế truy cập `file://`, chạy `python -m http.server 8080` trong thư mục này rồi mở `http://localhost:8080`.
- Có thể đưa `index.html` lên hosting tĩnh (Cloudflare Pages, GitHub Pages, Netlify). Không có bước build.

## Sử dụng

1. Import `.xlsx`, `.csv`, `.tsv`, chọn sheet nếu có nhiều sheet. Dòng không trống đầu tiên được xem là tiêu đề.
2. Chọn nhóm chính, nhóm phụ (tùy chọn), cột số và phép SUM, COUNT, AVG, MIN hoặc MAX.
3. Tìm kiếm hoặc thêm điều kiện lọc (AND). Dashboard và bảng tổng hợp tính lại tự động.
4. Tải mẫu cấu hình JSON để dùng lại với các file có cột tương thích; có thể nạp mẫu trước khi import file. Nút lưu cấu hình sử dụng localStorage nếu trình duyệt cho phép.
5. Xuất Excel gồm hai sheet: `Tong hop` và `Du lieu loc`. Xuất CSV dữ liệu hoặc tổng hợp riêng.

## Phạm vi và giới hạn

- Tối đa 30 MB/tệp, 100 MB tổng giải nén, 50.000 dòng, 100 cột, 500.000 ô/sheet.
- MVP dùng bộ đọc/ghi OOXML tối giản, chỉ hỗ trợ XLSX phổ biến, không phải Excel engine hoàn chỉnh. Không hỗ trợ XLS cũ, file mã hóa, ZIP64, macro, chart/pivot gốc của workbook, định dạng phức tạp hoặc tính lại công thức; chỉ đọc cached value nếu có.
- Header một dòng, nhóm tối đa hai cấp, không join nhiều sheet. Số lưu dưới dạng text trong Excel không tự ép kiểu. Ngày xuất ở dạng text ISO nếu đã nhận diện từ nguồn.
- Dữ liệu gốc không lưu vào localStorage; cấu hình có thể chứa tên cột và giá trị lọc. Không có tài khoản, phân quyền, lưu lịch sử hoặc đồng bộ.
- CSV yêu cầu UTF-8 hoặc UTF-16 có BOM. Số thập phân dạng dấu chấm; mã có số 0 ở đầu được giữ dạng chuỗi. CSV xuất có biện pháp hạn chế formula injection, và XLSX xuất chuỗi dưới dạng inline text.
- Tính toán dùng số IEEE-754, chưa phù hợp để thay thế engine kế toán cần độ chính xác decimal tuyệt đối. File lớn có thể làm giao diện chậm do xử lý trên main thread.

## Kiểm thử

Kiểm thử bằng Chromium headless với Playwright, nạp HTML qua `set_content` do môi trường kiểm thử chặn `file://` và điều hướng đến domain tùy ý. Đã xác minh: workbook nhiều sheet, header trùng, ngày tháng, mã có số 0 đầu, SUM/AVG, nhóm 2 cấp, dữ liệu âm, lọc AND, tìm kiếm không kết quả, CSV có dấu phẩy/xuống dòng trong trường, lỗi import không làm mất dữ liệu trước, xuất XLSX và đọc lại bằng openpyxl, nạp mẫu JSON trước khi import, layout mobile 390px không tràn ngang toàn trang. Chưa kiểm thử trực tiếp Safari/iOS, Firefox, các file Excel phức tạp và tải sản xuất lớn.

## Hướng nâng cấp

Tách thành React/TypeScript/Vite; dùng SheetJS CE vendored hoặc bộ đọc chuyên dụng đã kiểm tra, Web Worker + DuckDB-Wasm để xử lý nặng, virtualized table, dashboard builder nhiều widget, lưu template/version, schema mapping, và backend xác thực/phân quyền nếu cần chia sẻ nhiều người dùng.
