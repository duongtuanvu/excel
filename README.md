# KySheet v0.3 — Excel report automation

Web app local-first: React + TypeScript + Vite, SheetJS và DuckDB-Wasm. Không có backend, tài khoản, database server hay IndexedDB. Workbook và bảng DuckDB chỉ tồn tại trong bộ nhớ của phiên hiện tại. Người dùng có hồ sơ local tùy chọn, thư viện mẫu local và có thể xuất/nhập mẫu JSON hoặc xuất kết quả ra XLSX/CSV.

## Chạy local

Yêu cầu Node.js >= 22.12; npm hoặc Bun. Clone repo và chạy:

    git clone https://github.com/duongtuanvu/excel.git
    cd excel
    npm install
    npm run dev

Hoặc `bun install` và `bun run dev`. Mở URL Vite (mặc định http://127.0.0.1:5173). Không mở index.html qua file://.

    npm test
    npm run build
    npm run preview
    npx playwright install chromium
    npm run test:e2e

Test model dùng Node test runner, test E2E dùng Playwright với bản build đã tạo. Sau lần cài thành công, commit lockfile để CI/deploy tái lập được. Phiên bản trực tiếp đã pin; lockfile chưa được tạo vì môi trường phát triển không truy cập được registry.

## Cloudflare Workers Builds (Static Assets)

| Setting | Value |
| --- | --- |
| Production branch | main |
| Build command | npm run build (hoặc bun run build) |
| Deploy command | npx wrangler deploy --assets=./dist --name TEN_WORKER |
| Root directory | / |
| NODE_VERSION | 22 |

Thay TEN_WORKER bằng tên Worker thật trên dashboard. Sau khi đổi Production branch, tạo deployment mới từ repo duongtuanvu/excel, branch main; không retry build cũ của repo ai. Không cần Worker script, D1 hoặc R2.

Mặc định build chỉ tải **binary WASM tĩnh, pin 1.30.0** từ jsDelivr ở runtime; worker JS và phần còn lại được host cùng website. Lý do: giới hạn 25 MiB/file trên Cloudflare Workers Static Assets có thể không phù hợp với WASM DuckDB. CDN không nhận workbook, câu truy vấn hay kết quả. Nếu CDN bị chặn, ứng dụng sẽ không khởi tạo được engine.

Nếu cần host hoàn toàn nội bộ/không gọi CDN, dùng `npm run build:local`; deploy dist lên static hosting hỗ trợ kích thước binary WASM. Không cần COOP/COEP vì chỉ dùng bundle đơn luồng MVP/EH. Không hỗ trợ offline sau reload nếu chưa có service worker hoặc cache đầy đủ.

## Chức năng

- Import XLSX/XLS/CSV/TSV, chọn sheet, nhận diện tiêu đề trùng/trống, kiểu cột số/văn bản/ngày/boolean.
- Nhóm tối đa 3 cấp; SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT; tối đa 12 điều kiện AND.
- KPI, biểu đồ thanh/cột có giá trị âm, dữ liệu nguồn và bảng tổng hợp phân trang.
- Import/export mẫu JSON có version, kiểm tra tương thích schema theo tên cột; dữ liệu không được lưu trong template (giá trị bộ lọc có thể chứa dữ liệu nhạy cảm, cần cân nhắc trước khi chia sẻ).
- XLSX xuất 3 sheet (Tổng quan, Tổng hợp, Dữ liệu đã lọc); CSV xuất bảng tổng hợp, trung hòa công thức từ text.
- Giao diện responsive; dữ liệu mẫu để thử nhanh.
- Không gian cá nhân: tên hiển thị, tên workspace, mật độ bảng, tối đa 20 mẫu lưu LocalStorage, áp dụng/xuất JSON/xóa mẫu, đặt lại hồ sơ. Không có xác thực, phân quyền hay đồng bộ tài khoản.

## Kiến trúc

    React UI
      -> typed request/response client
      -> report.worker.ts (SheetJS, import, export, serial queue)
      -> DuckDB browser worker (in-memory SQL)
      <- small report results + paginated rows

Không có SQL editor hoặc execute SQL của người dùng; tên cột nội bộ và toán tử được whitelist, literal được quote. Dữ liệu import được tải vào staging table và kiểm tra schema/row count trước khi thay nguồn chính trong transaction. Báo cáo tự cập nhật sau 250 ms debounce. Kết quả lỗi/không khớp cấu hình không được dùng để export.

## Giới hạn

- Một workbook, một sheet đang hoạt động; chưa có JOIN nhiều file, pivot column, report canvas kéo thả, calculated field hoặc dashboard nhiều widget.
- 25 MB file, 100.000 dòng, 100 cột, 1 triệu ô, khoảng 40 triệu ký tự CSV sau chuẩn hóa; giới hạn bảo vệ thiết bị, không phải cam kết chạy được mọi file đạt ngưỡng.
- 5.000 nhóm; nếu vượt, cảnh báo và chặn export thay vì xuất thiếu. Bảng dữ liệu nguồn 50 dòng/trang, chart 12 nhóm đầu.
- Giả định hàng dữ liệu không trống đầu tiên là tiêu đề. Không tính lại công thức Excel; chỉ dùng giá trị cache. Ngày trong Excel có thể được chuyển thành ISO; kiểu của cột dữ liệu trộn là text. Mã dạng chuỗi có số 0 ở đầu được giữ dạng text; mã số có format Excel đặc biệt có thể mất format gốc.
- Số thực được tổng hợp kiểu DOUBLE, không thay cho đối soát tài chính chính xác theo decimal.
- Giới hạn không bảo đảm chống mọi workbook nén độc hại; chỉ mở file từ nguồn tin cậy. Reload mất workbook và kết quả; chỉ hồ sơ và mẫu lưu chủ động tồn tại trong LocalStorage. Kho mẫu tối đa 512.000 ký tự; người dùng cùng browser profile/origin có thể đọc dữ liệu local. Khi storage bị chặn, thay đổi chỉ tồn tại trong phiên; có cảnh báo. Nhiều tab có thể ghi đè nhau; nên chỉnh sửa kho mẫu trong một tab.
- Build và E2E cần được chạy tại môi trường có internet để cài dependencies. Safari/iOS và tải lớn cần benchmark riêng.

## Tài khoản thực (thiết kế giai đoạn sau)

Giữ Guest/local-first cho mọi tính năng xử lý Excel. Nếu cần đăng nhập thật và đồng bộ đa thiết bị, dùng nhà cung cấp xác thực OAuth/OIDC có hỗ trợ Authorization Code + PKCE, session server-side hoặc cookie HttpOnly/Secure/SameSite phù hợp, Workers API cho hồ sơ/metadata mẫu, D1 cho user và mẫu có owner_id. Kiểm tra quyền sở hữu ở mọi truy vấn, không tin role từ client, chống CSRF và rate-limit auth. Chỉ đồng bộ mẫu khi người dùng đồng ý; không gửi workbook hay kết quả. Cần chọn nhà cung cấp, domain và môi trường triển khai trước khi tích hợp; chưa có backend auth hoặc database này trong repo.

## Roadmap

Tiếp theo: multi-source JOIN có kiểm tra cardinality, pivot matrix, calculated metrics, biểu đồ nhiều widget, data profiling, streaming ingest/export, CI và benchmark thực tế.
