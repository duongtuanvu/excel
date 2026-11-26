# KySheet — Product & Engineering Plan

> Thiết kế một lần, báo cáo mọi kỳ.
>
> Repository: [duongtuanvu/excel](https://github.com/duongtuanvu/excel) · Branch: `main`
>
> Baseline: v0.3.0 · commit `f9c0dbc20e7204e9bd891ae288ab60daf18ea4ea` · cập nhật 2026-11-26.

## 1. Mục tiêu và nguyên tắc

KySheet là công cụ tự động hóa báo cáo Excel định kỳ theo hướng local-first, no-code. Người dùng thiết kế nguồn, luồng xử lý, chỉ số, báo cáo một lần; các kỳ tiếp theo chỉ thay file tương thích rồi chạy lại và xuất báo cáo.

- Bắt buộc đăng nhập trước khi vào workspace; không có chế độ Guest trên bản production mới. Mỗi tài khoản sở hữu riêng hồ sơ, template và cấu hình báo cáo.
- Workbook, dữ liệu nguồn, truy vấn và kết quả xử lý ở browser; không gửi lên backend mặc định.
- Cloudflare Workers Builds + Static Assets là phương án deploy chính, không nhầm với Pages.
- DuckDB-Wasm chạy trong bộ nhớ phía client; Web Worker giữ UI không bị khóa bởi tác vụ nặng.
- Cloudflare D1 lưu user, session, hồ sơ, thư viện template và cấu hình báo cáo. Không lưu workbook hoặc kết quả phân tích trên server. Dữ liệu template/filter có thể nhạy cảm; người dùng được thông báo trước khi lưu.
- Không đánh đổi tính đúng đắn của số liệu để tăng tốc. Không âm thầm bỏ dòng, nhóm, công thức lỗi hoặc dữ liệu không khớp.
- Ưu tiên desktop cho thao tác thiết kế; mobile phải xem, lọc, nhập/xuất báo cáo thuận tiện.

## 2. Quy tắc checklist

- `[x]`: đã có implementation trong source; với mục kiểm thử hoặc triển khai, phải có kết quả chạy thực tế.
- `[ ]`: chưa có, chưa hoàn thiện, hoặc chưa xác minh.
- Không suy diễn từ việc có source test rằng test đã pass. Mọi phase chỉ đóng khi checklist và tiêu chí nghiệm thu tương ứng đều đạt.
- Sau mỗi commit tính năng: cập nhật đúng checklist, bằng chứng (commit, lệnh test, kết quả), giới hạn còn tồn tại và việc tiếp theo ngay trong file này.
- Không ghi dữ liệu khách hàng, token, thông tin định danh hay bí mật vào plan hoặc fixture công khai.

**Trạng thái baseline:** Chủ dự án xác nhận v0.3 đã deploy được tại https://excel.linhsumi.io.vn/. Chưa có log build/test độc lập hoặc smoke test đầy đủ trong phiên này. Giữ production đang chạy cho tới khi auth staging được cấu hình và nghiệm thu.

## 3. Roadmap tổng quan

| Phase | Module | Ưu tiên | Trạng thái |
|---|---|---|---|
| 00 | Build, deploy, QA baseline | P0 | Có nền tảng, chưa xác minh |
| 01 | Core Report Engine v0.3 | P0 | Đã code; chờ nghiệm thu |
| 02 | User Center theo tài khoản | P0 | UI local cũ; cần chuyển sang lưu server |
| 03 | Data Sources & schema mapping | P0 | Một phần |
| 04 | Data Model & Transformation Pipeline | P0 | Một phần |
| 05 | Pivot & Measures Engine | P0 | Một phần |
| 06 | Dashboard Designer & Widgets | P0 | Layout cố định |
| 07 | Dynamic Filters & Report Viewer | P1 | Một phần |
| 08 | Report Automation & Templates | P0 | Một phần |
| 09 | Export & Sharing | P1 | Một phần |
| 10 | Performance, PWA, Security & Accessibility | P1 | Một phần |
| 11 | Auth, User Storage & User Management | P0 | Google login production OK (chủ dự án); chờ nghiệm thu lưu cấu hình/cách ly tài khoản |
| 12 | AI Report Builder | P3 | Chưa có, tùy chọn |
| 13 | Release & Product Validation | P1 | Chưa nghiệm thu |

P0: cốt lõi, ưu tiên thực hiện trước. P1: hoàn thiện sản phẩm. P2/P3: mở rộng có điều kiện. Auth và user storage là dependency bắt buộc của workspace production.

## 4. Checklist chi tiết

**Yêu cầu thay đổi:** workspace chỉ mở sau login. Lưu cấu hình theo tài khoản; ưu tiên manual save có trạng thái rõ và phục hồi bản lưu gần nhất khi import schema tương thích. Template cũ có thể xuất/nhập JSON chủ động. Không tự đồng bộ dữ liệu từ browser profile cũ. Không đưa auth chưa cấu hình lên production hiện tại.

### Phase 00 — Build, deploy, QA baseline (P0)

- [x] 00.01 React + TypeScript + Vite project tại root repo.
- [x] 00.02 Script dev, build, preview, test, test:e2e và build:local.
- [x] 00.03 Cấu hình build WASM CDN và chế độ self-host.
- [x] 00.04 Tài liệu Cloudflare Workers Builds cho repo excel, branch main.
- [x] 00.05 Source unit test model (6 test), user-model (4 test) và Playwright E2E (2 kịch bản).
- [ ] 00.06 Cài dependency bằng Bun/npm trên Node tương thích; xác minh phiên bản/package URL tồn tại, tạo và commit một lockfile; dùng frozen install trong CI.
- [x] 00.07 Baseline v0.4.1 TypeScript + Vite production build pass trong CI run 45748267363; bản v0.5 cần chạy lại.
- [ ] 00.08 Chạy unit test và E2E hiện có; sửa lỗi và bổ sung fixture hồi quy nếu phát hiện.
- [x] 00.09 Source cấu hình Wrangler production: Worker excel, ./dist + worker/index.ts, SPA fallback, D1 binding DB; phiên bản Wrangler pin. Chưa xác minh deploy.
- [ ] 00.10 Kiểm tra kích thước từng asset theo giới hạn Workers; xác minh WASM, MIME, CORS, cache và URL worker sau deploy.
- [ ] 00.11 Deploy từ duongtuanvu/excel:main; smoke test URL thật, demo/import/filter/export/User Center, cả reload.
- [ ] 00.12 CI cho typecheck, unit test, build, E2E và secret/dependency scan; hướng dẫn rollback theo commit/release.

**Nghiệm thu:** clean install, test, build và smoke test trên URL deploy thành công; lưu bằng chứng. Không bắt đầu mở rộng engine lớn trước khi baseline ổn định.

### Phase 01 — Core Report Engine v0.3 (P0)

- [x] 01.01 SheetJS import XLSX/XLS/CSV/TSV; chọn sheet trong một workbook.
- [x] 01.02 Chuẩn hóa header trống/trùng; suy luận kiểu number, text, date, boolean.
- [x] 01.03 DuckDB-Wasm in-memory, Web Worker, typed request/response, hàng đợi tác vụ.
- [x] 01.04 Staging table, kiểm tra số dòng/schema và thay bảng trong transaction.
- [x] 01.05 Group by tối đa 3 cấp, một metric; SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT.
- [x] 01.06 Filter chứa/bằng/khác/so sánh số/trống; tối đa 12 điều kiện AND.
- [x] 01.07 KPI, biểu đồ thanh/cột, sắp xếp kết quả và bảng dữ liệu phân trang.
- [x] 01.08 Debounce, giới hạn import/nhóm, chặn export kết quả bị cắt.
- [x] 01.09 Demo data, thông báo lỗi và xử lý trạng thái tải.
- [x] 01.10 UI responsive cơ bản, cấu hình báo cáo trực tiếp.
- [ ] 01.11 Xác minh kết quả tổng hợp với fixture độc lập: null, zero, số âm, số lớn, nhóm trống, distinct, trung bình có trọng số theo dữ liệu gốc.
- [ ] 01.12 Xác minh CSV đa dòng/quote, nhiều sheet, unicode, mã số 0 đầu và export đọc lại.
- [ ] 01.13 Xử lý lỗi khởi tạo DuckDB, timeout, retry/restart worker và thay file không làm mất nguồn tốt trước đó.

**Nghiệm thu:** dữ liệu đầu vào và kết quả đối chiếu đúng; không treo UI, không hiển thị hoặc xuất kết quả của cấu hình cũ.

### Phase 02 — User Center local (P1)

- [x] 02.01 Thương hiệu KySheet, logo, favicon, avatar theo tên.
- [x] 02.02 Hồ sơ local: tên hiển thị, tên workspace, mật độ bảng.
- [x] 02.03 Thư viện tối đa 20 mẫu trên LocalStorage.
- [x] 02.04 Lưu cấu hình hiện tại, áp dụng mẫu, tải JSON, xác nhận xóa mẫu.
- [x] 02.05 Kiểm tra schema mẫu, phiên bản, kích thước và dữ liệu local không hợp lệ.
- [x] 02.06 Cảnh báo storage bị chặn; thông tin quyền riêng tư; đặt lại hồ sơ/mẫu có xác nhận.
- [ ] 02.07 Tìm kiếm, đổi tên, nhân bản, phân loại/tag và sắp xếp mẫu.
- [ ] 02.08 Recent reports (metadata tùy chọn), favorites, trạng thái mẫu chưa lưu.
- [ ] 02.09 Backup/restore toàn bộ hồ sơ và thư viện mẫu; xác nhận khi ghi đè.
- [ ] 02.10 Xử lý xung đột nhiều tab; không vô tình ghi đè mẫu của tab khác.
- [ ] 02.11 E2E lưu/reload/áp dụng/xóa, lỗi quota, reset và keyboard focus; kiểm tra mobile.

**Nghiệm thu mới:** hồ sơ và mẫu gắn với tài khoản xác thực, đồng bộ server, không lưu workbook. UI local cũ là baseline lịch sử; không dùng LocalStorage làm nguồn dữ liệu chính sau khi chuyển auth.

### Phase 03 — Data Sources & schema mapping (P0)

- [x] 03.01 Import một workbook đang hoạt động, danh sách sheet, tên file và số dòng/cột.
- [x] 03.02 Phát hiện cột tương thích khi đổi file và áp dụng cấu hình JSON theo tên.
- [x] 03.03 Source v0.5 quản lý nhiều file đồng thời, ID ổn định, alias, bảng riêng, thêm/xóa/đổi tên; chờ E2E.
- [x] 03.04a Source mở nhiều sheet độc lập từ một workbook, tránh parse lại workbook khi chuyển nguồn.
- [ ] 03.04b CSV/TSV encoding, delimiter, preview có xác nhận.
- [ ] 03.05 Chọn hàng header, vùng dữ liệu, bỏ dòng tiêu đề phụ và dòng tổng; hỗ trợ merge-cell có quy tắc rõ.
- [x] 03.06a Source schema editor: tên cột, kiểu, locale vi-VN, preview lỗi, transaction và restore theo tên cột gốc.
- [ ] 03.06b Nghiệm thu CI; giữ leading zeros dạng chuỗi, hỗ trợ Excel display format chưa có.
- [ ] 03.07 Mapping tên cột cũ/mới, phát hiện thiếu/thừa/sai kiểu, xem diff trước khi thay nguồn.
- [x] 03.08a Source profiling v0.5.2: null, distinct, duplicate, min/max/sum/avg, top 10 distribution, tỷ lệ lỗi kiểu trên bảng đã nhập; cache theo revision.
- [ ] 03.08b Kiểm tra lỗi parse trên dữ liệu gốc và histogram nâng cao khi có schema editor; xác minh CI profiling.
- [x] 03.09a Source thay từng nguồn bằng transaction, kiểm tra cột và kiểu, revision chống stale query, giữ nguồn cũ khi lỗi.
- [ ] 03.09b Batch refresh nhiều nguồn và preview schema diff tương tác.
- [ ] 03.10 Fixture nhiều nguồn, header bất thường, file lỗi/empty, mapping sai và thay file tương thích.

**Nghiệm thu:** hai file và nhiều sheet có thể tồn tại độc lập; thay file không làm mất mapping hay thay đổi các bảng không liên quan; không silently truncate dữ liệu.

### Phase 04 — Data Model & Visual Transformation Pipeline (P0)

Phụ thuộc: Phase 03.

- [x] 04.01 Lọc, tổng hợp và sắp xếp báo cáo bằng SQL được sinh từ cấu hình.
- [ ] 04.02 Mô hình nhiều bảng, sơ đồ quan hệ, khóa chính/khóa ngoại logic, kiểm tra kiểu khóa.
- [ ] 04.03 JOIN inner/left/right/full, composite key, xem cardinality 1:1/1:N/N:1/N:N, cảnh báo many-to-many nhân bản số liệu.
- [ ] 04.04 UNION/append nhiều bảng, map cột khác tên; phát hiện schema mismatch.
- [ ] 04.05 Transform chọn/xóa/đổi tên cột, cast type, trim/replace, split/merge, deduplicate, sort.
- [ ] 04.06 Xử lý null/missing value và lỗi chuyển kiểu với quy tắc có thể cấu hình; không tự thay null bằng 0.
- [ ] 04.07 Filter và group-by trong pipeline, unpivot dữ liệu rộng sang dài.
- [ ] 04.08 Visual DAG: source → transform → join → output; node/edge validation, chặn cycle.
- [ ] 04.09 Preview từng step, row count trước/sau, số bản ghi unmatched và trace nguồn gốc.
- [ ] 04.10 Undo/redo, enable/disable/reorder step; lưu pipeline dưới JSON có version.
- [ ] 04.11 Tái chạy theo dependency, cache/invalidate đúng node, xử lý giao dịch khi một step thất bại.
- [ ] 04.12 Test JOIN trùng khóa/null/khác kiểu, UNION khác schema, DAG cycle, và kết quả không nhân đôi ngoài chủ đích.

**Nghiệm thu:** quy trình từ Doanh thu.xlsx + Danh mục.xlsx tới bảng đã xử lý có thể thiết kế trực quan, lưu và chạy lại trên dữ liệu kỳ mới.

### Phase 05 — Pivot & Measures Engine (P0)

Phụ thuộc: Phase 03–04 cho báo cáo nhiều nguồn.

- [x] 05.01 Bảng tổng hợp group-by hàng nhiều cấp, một metric, 6 phép tổng hợp.
- [x] 05.02 Tổng hợp toàn bộ theo dữ liệu lọc, không chỉ cộng các giá trị hiển thị.
- [ ] 05.03 Pivot thực sự với Rows / Columns / Values / Filters; kéo thả và đổi thứ tự field.
- [ ] 05.04 Nhiều measures cùng lúc, alias, format tiền tệ/số/phần trăm/ngày.
- [ ] 05.05 Subtotal nhiều cấp, Grand Total đúng ngữ nghĩa AVG/DISTINCT/ratio; expand/collapse.
- [ ] 05.06 % of row/column/grand total, top N, sort theo measure và nhóm.
- [ ] 05.07 Drill-down từ một ô/nhóm tới dòng dữ liệu nguồn, vẫn giữ filter.
- [ ] 05.08 Calculated columns và measures phân biệt row-level/aggregate; expression AST, whitelist hàm, kiểm tra kiểu, dependency/cycle, không eval JS hay chạy SQL tùy ý.
- [ ] 05.09 Hàm số, text, date, IF/CASE, COALESCE, phép tính lợi nhuận và tỷ lệ; quy tắc chia 0/null.
- [ ] 05.10 Time intelligence: MoM, QoQ, YoY, MTD, YTD, lũy kế, rank; calendar và kỳ báo cáo cấu hình được.
- [ ] 05.11 DECIMAL cho tiền và chính xác theo yêu cầu nghiệp vụ; hiển thị rounding rõ ràng.
- [ ] 05.12 Virtualization/pagination cho ma trận lớn, chặn cardinality quá cao và xuất không thiếu dữ liệu.
- [ ] 05.13 Test độc lập với expected output hoặc đối chiếu Excel; bao gồm subtotal không cộng được, ratio, date edge case, mã null và decimal.

**Nghiệm thu:** pivot nhiều chiều và nhiều chỉ số cho ra kết quả đối chiếu đúng, kể cả số liệu tài chính. Không coi group-by hiện tại là pivot đầy đủ.

### Phase 06 — Dashboard Designer & Widget Library (P0)

Phụ thuộc: Phase 05 cho measures nâng cao.

- [x] 06.01 Layout dashboard cố định: KPI, bar ngang, bar dọc, summary/raw table.
- [ ] 06.02 Workspace điều hướng Data Sources / Data Model / Measures / Designer / Viewer.
- [ ] 06.03 Report Designer dạng canvas/grid: thêm, xóa, kéo thả, resize, duplicate, snap, lock widget.
- [ ] 06.04 Nhiều widget và nhiều trang; widget ID ổn định, nguồn và measure riêng.
- [ ] 06.05 Inspector cấu hình field, dimension, metric, sort, format, màu sắc, title và legend.
- [ ] 06.06 Bộ widget cốt lõi: KPI, table, pivot, bar, column, line, area, pie/donut, combo, text.
- [ ] 06.07 Bộ widget mở rộng: scatter, gauge/progress, heatmap, treemap, waterfall, funnel; chọn theo nhu cầu.
- [ ] 06.08 Theme, typography, conditional formatting, palette, format số và nhãn.
- [ ] 06.09 Undo/redo thao tác thiết kế, autosave metadata theo lựa chọn, warning khi đóng thay đổi chưa lưu.
- [ ] 06.10 Layout responsive theo breakpoint; edit/view/presentation mode, keyboard và touch.
- [ ] 06.11 Lưu/khôi phục layout JSON; phiên bản hóa và migrate template.
- [ ] 06.12 Hạn chế số widget/query đồng thời; cache chung, hủy query cũ, xử lý error/empty/loading theo từng widget.

**Nghiệm thu:** tạo dashboard nhiều widget và trang mà không sửa code, mở lại template vẫn đúng vị trí/cấu hình, tương tác không làm nghẽn UI.

### Phase 07 — Dynamic Filters & Report Viewer (P1)

- [x] 07.01 Filter AND của báo cáo hiện tại và cập nhật tự động có debounce.
- [ ] 07.02 Filter UI dropdown, multi-select, checkbox/radio, search, range, date picker/date range.
- [ ] 07.03 Nhóm điều kiện AND/OR, NOT và toán tử theo kiểu dữ liệu; rõ ngữ nghĩa null.
- [ ] 07.04 Global/page/widget filter, scope và precedence minh bạch.
- [ ] 07.05 Cross-filter từ chart, click-to-drill-down, breadcrumb và reset.
- [ ] 07.06 Dynamic options theo dữ liệu; top N, relative period và so sánh kỳ.
- [ ] 07.07 Viewer chỉ đọc layout, presentation/fullscreen, filter chips, chế độ mobile.
- [ ] 07.08 Test giao nhau của filter, reset, cross-filter vòng lặp, stale result và widget scope.

**Nghiệm thu:** chọn khu vực/kỳ báo cáo cập nhật đúng các widget liên quan, không ảnh hưởng widget ngoài scope.

### Phase 08 — Report Automation & Templates (P0)

- [x] 08.01 Template JSON v1 chứa cấu hình hiện tại và bộ lọc; validate schema.
- [x] 08.02 Import/export mẫu JSON; tái áp dụng khi cột tương thích.
- [x] 08.03 Thư viện mẫu local trong User Center.
- [ ] 08.04 Project/template schema v2 gồm source slots, mapping, pipeline, measures, pages, widget và filter; migrate v1 không mất cấu hình.
- [ ] 08.05 Wizard thay dữ liệu định kỳ, đặt kỳ báo cáo, chọn nhiều file và rerun pipeline.
- [ ] 08.06 Preflight kiểm tra schema/kiểu/khóa/row count; so sánh kỳ trước với kỳ hiện tại nếu người dùng cung cấp.
- [ ] 08.07 Validation nghiệp vụ cấu hình được: tổng đối soát, ngưỡng sai lệch, dữ liệu thiếu/trùng, tỷ lệ unmatched.
- [ ] 08.08 Preview thay đổi trước khi publish/export; nhật ký bước chạy, cảnh báo lỗi và tóm tắt.
- [ ] 08.09 Thư viện template mẫu cho bán hàng, kế toán, vận hành, nhân sự, kho, sản xuất; fixture tổng hợp không chứa dữ liệu thật.
- [ ] 08.10 Version history, duplicate/restore, backup project JSON; ZIP tùy chọn khi user đồng ý đóng gói dữ liệu.
- [ ] 08.11 Workflow xuất nhiều báo cáo liên tiếp, tiến độ/cancel, tên file theo kỳ và manifest kết quả.

**Nghiệm thu:** từ template đã thiết kế, người dùng chỉ chọn các file kỳ mới, xác nhận mapping/validation rồi nhận báo cáo đúng mà không thiết kế lại.

### Phase 09 — Export & Sharing (P1)

- [x] 09.01 XLSX: 3 sheet Tổng quan, Tổng hợp, Dữ liệu đã lọc.
- [x] 09.02 CSV tổng hợp, escape quote và trung hòa text có nguy cơ formula injection.
- [x] 09.03 JSON cấu hình mẫu, giới hạn và chặn export nhóm bị cắt.
- [ ] 09.04 XLSX nâng cao: nhiều pivot/measure, style, number format, column width, freeze panes, filter, subtotal; không ghi công thức ngoài ý muốn.
- [ ] 09.05 Export có tùy chọn dữ liệu nguồn/summary, loại trừ cột nhạy cảm, chọn trang, chỉ xuất dữ liệu lọc đúng.
- [ ] 09.06 PDF in ấn, A4/landscape, pagination, header/footer; không cắt widget hoặc dòng.
- [ ] 09.07 PNG/SVG cho chart hoặc dashboard; PowerPoint ở mức mở rộng.
- [ ] 09.08 HTML tương tác độc lập, offline, chỉ nhúng dữ liệu đã chọn, CSP phù hợp và escape an toàn; xem kích thước trước xuất.
- [ ] 09.09 ZIP project/template + tài nguyên/dữ liệu theo lựa chọn; kiểm tra khi import.
- [ ] 09.10 Chia sẻ online tùy chọn phụ thuộc Phase 11; không tự upload workbook; có consent, quyền truy cập, thu hồi link.
- [ ] 09.11 Đối chiếu số liệu từng định dạng, unicode, file lớn, cancel và lỗi hết bộ nhớ.

**Nghiệm thu:** file mở được bằng ứng dụng mục tiêu, đúng số liệu/bộ lọc/định dạng và không làm lộ dữ liệu ngoài phạm vi user chọn.

### Phase 10 — Performance, PWA, Security & Accessibility (P1)

Thực hiện xuyên suốt các phase, không đợi đến cuối.

- [x] 10.01 Worker xử lý nền, serial queue, transfer ArrayBuffer khi import/export.
- [x] 10.02 Giới hạn file 25 MB, 100.000 dòng, 100 cột, 1 triệu ô, 5.000 nhóm; 50 dòng/trang, biểu đồ tối đa 12 nhóm đầu.
- [x] 10.03 SQL whitelist/quote, staging transaction, kiểm tra JSON và CSV injection cơ bản.
- [ ] 10.04 Benchmark startup/import/query/export trên desktop, Android và iOS/Safari; ghi kích thước fixture, RAM, p50/p95, thời gian tải asset; không tuyên bố sức tải chưa đo.
- [ ] 10.05 Lazy-load engine/widgets, giảm copy và số lần parse, batch/stream ingestion/export, profiling memory và release tài nguyên.
- [ ] 10.06 Virtualized grid, query cache/invalidation, request coalescing, cancellation và backpressure.
- [ ] 10.07 Guard workbook nén độc hại/zip bomb, số sheet, kích thước sau giải nén, giới hạn tổng tài nguyên; timeout và recovery rõ ràng.
- [ ] 10.08 PWA manifest, service worker, cache phiên bản và offline sau lần tải đầy đủ; xử lý CDN unavailable/update/rollback.
- [ ] 10.09 Đánh giá tự host WASM hoặc R2 khi cần; giữ dữ liệu phân tích local, phân biệt asset network request với upload dữ liệu.
- [ ] 10.10 Security headers/CSP, kiểm tra XSS từ sheet/JSON/HTML, dependency audit, kiểm tra network không gửi workbook/SQL/kết quả.
- [ ] 10.11 Accessibility: contrast, screen reader, focus management, keyboard/touch, reduced motion; kiểm tra mobile 320px trở lên.
- [ ] 10.12 Smoke/load test static asset và đo cold/warm load, lỗi CDN/worker, network chậm; nếu thêm API mới đo request/CPU/DB riêng.
- [ ] 10.13 Opt-in error reporting chỉ thu metadata cần thiết đã redact, không log nội dung Excel hoặc filter nhạy cảm.

**Nghiệm thu:** có baseline benchmark tái lập được và ngưỡng release theo thiết bị đã thử; không khẳng định chạy được mọi file ở giới hạn hiện tại.

### Phase 11 — Auth, User Storage & User Management (P0)

Yêu cầu mới: đăng nhập bắt buộc, người dùng chỉ truy cập cấu hình của chính mình. Chọn Google OAuth/OIDC Authorization Code + PKCE cho MVP (không tự lưu mật khẩu); Workers API cùng origin, D1 lưu user/session/settings. Tách team, billing và AI ra sau. Không tự động nhập LocalStorage cũ vào tài khoản.

- [x] 11.01 Có UI hồ sơ local làm baseline để chuyển đổi.
- [x] 11.01a Chốt kiến trúc MVP: Google login + session cookie HttpOnly/Secure/SameSite, Workers API + D1, không có guest.
- [ ] 11.02 Cấu hình OAuth client, domain/callback, D1 binding/migration và secrets trong môi trường staging; chính sách dữ liệu.
- [x] 11.03 Source login Google, tạo tài khoản lần đầu, logout/revoke session, origin check, state/PKCE, cookie bảo mật, session hết hạn. Chưa kiểm thử tích hợp.
- [x] 11.03a Source login gate trước khi khởi tạo Excel engine; logout/401 unmount workspace. Chưa nghiệm thu logout/expiry.
- [x] 11.03b Chủ dự án xác nhận đăng nhập Google thành công trên production sau bản sửa OAuth transport `2b365f5` (26/11/2026). Đây là xác nhận vận hành luồng login, không phải kết quả toàn bộ auth test.
- [x] 11.04 Source Workers API và D1 migration cho user/session/settings; lưu hồ sơ, template và cấu hình báo cáo gần nhất theo user_id xác thực; giới hạn payload và schema.
- [x] 11.04a Chủ dự án xác nhận tạo D1 kysheet và 4 bảng nghiệp vụ qua Console.
- [x] 11.04b Commit cấu hình binding DB cho Worker excel, database kysheet. Luồng login production đã hoạt động theo xác nhận chủ dự án.
- [ ] 11.04c Xác minh schema/index, D1 binding runtime và OAuth secrets sau deploy.
- [x] 11.05 Source authorization server-side theo session user_id; không lấy owner_id từ client.
- [ ] 11.05a Test tài khoản A/B không thấy/sửa dữ liệu của nhau.
- [x] 11.06 Source lưu/khôi phục cấu hình qua API, revision CAS và hiển thị lỗi lưu; workbook/kết quả không gửi API.
- [ ] 11.06a Kiểm thử đồng bộ đa thiết bị và ghi đồng thời; offline queue/auto-save nâng cao để sau.
- [ ] 11.07 Workspace/team, invitation, role owner/editor/viewer, quyền truy cập và thu hồi.
- [ ] 11.08 Quản lý tài khoản, export dữ liệu, xóa tài khoản, session revocation và retention.
- [ ] 11.09 Admin console, abuse/rate limit, audit log không chứa dữ liệu nguồn, quota và đo chi phí thực.
- [ ] 11.10 Test CSRF, session, IDOR/tenant isolation, revoked access, race condition; load test API và database.
- [ ] 11.11 Nếu thương mại hóa: billing/entitlements/webhook idempotency, grace period, điều khoản và chính sách riêng tư.

**Nghiệm thu:** auth thật, cách ly user/workspace được kiểm tra, có audit và khả năng thu hồi quyền. Không mô phỏng bảo mật bằng local profile.

### Phase 12 — AI Report Builder (P3, tùy chọn)

Phụ thuộc: schema/pipeline/measures/dashboard đã ổn định.

- [ ] 12.01 Rule-based đề xuất báo cáo từ schema, không dùng AI.
- [ ] 12.02 AI gợi ý metric, chart, pipeline hoặc template từ schema và yêu cầu user.
- [ ] 12.03 Sinh cấu hình JSON có schema, validate type, dependency và permission trước khi áp dụng; preview và user xác nhận.
- [ ] 12.04 AI hỏi đáp báo cáo và giải thích số liệu dựa trên kết quả local có thể truy vết.
- [ ] 12.05 Chế độ privacy mặc định chỉ gửi metadata được duyệt; không tự gửi sample row/workbook, kiểm soát prompt injection từ ô dữ liệu.
- [ ] 12.06 Provider abstraction, quota/cost, key management server-side nếu dùng dịch vụ bên ngoài; fallback khi AI lỗi.
- [ ] 12.07 Test độ đúng số liệu, hallucination, cấu hình sai, chi phí và consent.

**Nghiệm thu:** AI tạo được cấu hình có thể kiểm tra, không thay thế engine tính toán xác định và không tự ý gửi dữ liệu.

### Phase 13 — Release & Product Validation (P1)

- [ ] 13.01 Hướng dẫn sử dụng/onboarding, demo báo cáo thật với dữ liệu tổng hợp, tài liệu troubleshooting.
- [ ] 13.02 Kiểm tra tên thương hiệu/nhãn hiệu/domain; KySheet hiện là tên làm việc.
- [ ] 13.03 Chạy UAT với người dùng kế toán/vận hành: đo thời gian thiết kế và thay file kỳ tiếp theo, lỗi đối soát, tỷ lệ hoàn thành.
- [ ] 13.04 Kiểm tra browser compatibility, regression, security, accessibility và deployment smoke.
- [ ] 13.05 Release version/changelog, Git tag, rollback, danh sách known issues và support.
- [x] 13.06a Source trang public Privacy Policy, Terms of Service, About và liên kết từ login/workspace.
- [ ] 13.06b Xác minh HTTP 200 và nội dung trên production, Google Branding/publish, email liên hệ trực tiếp, quy trình xóa tài khoản, retention, rà soát pháp lý và license.
- [ ] 13.07 Định lượng lợi ích automation và thu phản hồi; ưu tiên backlog theo nhu cầu thay vì số lượng chart.

## 5. Thứ tự triển khai đề xuất

| Mốc | Phạm vi | Điều kiện để chuyển tiếp |
|---|---|---|
| v0.3.x-auth | Phase 11 MVP + chuyển Phase 02 + Phase 00 | Đăng nhập, lưu cấu hình riêng và test cách ly hai tài khoản; deploy staging |
| v0.4 | Phase 03 + core Phase 04 | Multi-source, mapping, JOIN/transform đúng |
| v0.5 | Phase 05 | Pivot nhiều chiều + measures đúng số liệu |
| v0.6 | Phase 06/07 | Dashboard kéo thả và tương tác |
| v0.7 | Phase 08/09 | Template định kỳ + xuất báo cáo đầy đủ |
| v1.0 | Hoàn thiện P0/P1, Phase 10/13 | UAT, benchmark, bảo mật và release gates đạt |
| Sau v1.0 | Phase 11 mở rộng (team/admin/billing) + Phase 12 | Có nhu cầu, kiến trúc và chi phí được chốt |

Đây là thứ tự ưu tiên, không phải cam kết thời gian hoặc ngày release. Các việc security/QA/performance cần đi cùng từng phase.

## 6. Bằng chứng và công việc tiếp theo

- 2026-11-26: Chủ dự án xác nhận đăng nhập Google thành công trên production sau bản sửa `2b365f5`. Không suy ra các test lưu cấu hình, logout, tenant isolation, CI hoặc E2E đã pass.

- Auth source: commit `25bbe3a` (branch auth). D1 kysheet và 4 bảng do chủ dự án xác nhận; cấu hình Wrangler production đã được chuẩn bị, chưa có kết quả deploy/build/auth test.

| Ngày | Commit / tham chiếu | Bằng chứng | Trạng thái |
|---|---|---|---|
| 2026-11-26 | `f9c0dbc` | Đối chiếu tree, README, package.json, model, worker, App, UserCenter và test files | Source v0.3.0 đã có; runtime chưa xác minh |
| 2026-11-26 | `f9c0dbc` | Commit combined status trả danh sách rỗng | Không có bằng chứng CI pass từ kết quả này |

**Next action:** CI and release v0.6.1 linear transformation pipeline; then persistent DAG/model definitions and dependency rebuild before advanced pivot.

**Known risks:** Google OAuth production đã đăng nhập thành công theo chủ dự án; vẫn cần kiểm tra schema/index, migration tracking, lưu/khôi phục cấu hình, session revocation, tenant isolation và xung đột revision. Chưa có lockfile/CI; dependency và WASM/CDN runtime cần xác minh; file lớn/zip bomb; độ chính xác DOUBLE với tiền; workbook và kết quả mất khi reload, chỉ cấu hình lưu chủ động được giữ trên D1. Không đưa các mục này vào release notes như đã giải quyết nếu chưa có bằng chứng.

## 7. Definition of Done

Một tính năng mới chỉ được tick implementation khi có code tích hợp, không phải mock hoặc TODO. Để đóng phase:

- [ ] Các checklist bắt buộc của phase hoàn thành, hoặc scope loại trừ được ghi rõ.
- [ ] Có unit/integration/E2E phù hợp; kết quả thực tế pass và fixture hồi quy.
- [ ] Typecheck/build thành công; kiểm tra import/filter/export liên quan.
- [ ] Không có lỗi bảo mật nghiêm trọng, mất hoặc sai số liệu; giới hạn hiển thị minh bạch.
- [ ] Kiểm tra UI desktop/mobile, loading/error/empty state và performance liên quan.
- [ ] Cập nhật README/changelog/plan, commit SHA và kết quả nghiệm thu.

Checklist ở mục này là mẫu gate cho từng lần đóng phase, không đại diện cho tiến độ của một tính năng riêng.

### Cập nhật trang public

- Auth đã merge main theo yêu cầu chủ dự án (fbef146). Bổ sung HTML tĩnh Privacy/Terms/About; không phụ thuộc OAuth hoặc D1. Chưa xác nhận production deploy, OAuth publish hay kiểm thử E2E.

### OAuth troubleshooting

- [x] Source chuẩn hóa/kiểm tra OAuth credentials, phân loại lỗi Google/D1 theo stage và log mã lỗi cố định không chứa bí mật.
- [x] Chủ dự án xác nhận flow Google login thành công sau bản sửa `2b365f5`; chưa có trace runtime để khẳng định nguyên nhân duy nhất, chưa coi toàn bộ auth đã nghiệm thu.

- [x] Sửa tương thích workerd: outbound Google fetch dùng manual, không follow redirect, phân loại network/timeout/HTTP và thêm source regression test.
- [ ] Chạy regression test trên runtime phù hợp; login production đã được chủ dự án xác nhận riêng.

### Auth MVP regression gate (v0.4.1)

- [x] Source SQLite-backed API integration tests for account isolation, save/reload, CAS, CSRF, expired/revoked session, mocked OAuth callback and replay.
- [x] Source Playwright account fixture, corrected profile/reset test and logout regression; no production auth bypass.
- [x] Source CI workflow for Node unit/integration and build/Playwright.
- [x] Source distinct error codes for account switch, settings conflict and expired session; tab notification after successful session boot.
- [ ] Verify CI results, D1/Google integration, two real accounts and device restore before closing Auth MVP.

### Multi-source v0.5

- [x] CI baseline c0b3a4a: 17/17 unit/integration tests pass, npm install và production build pass (run 45748267363).
- [x] Sửa runner Ubuntu 26.04 bằng pin ubuntu-24.04; Chromium install pass run 45749263382.
- [x] Source quản lý bảng DuckDB độc lập, alias, sheet, thay nguồn, revision, giới hạn workspace và lưu config theo nguồn trong RAM.
- [x] Source regression test cho SQL table ID, schema compatibility, alias và budget.
- [x] v0.5 CI run 45749263382: 21/21 unit/integration pass, build pass, 6/7 E2E pass gồm multi-source; E2E export lỗi ở XLSX.readFile trong Node ESM.
- [x] Source sửa E2E export dùng download.saveAs + readFileSync + XLSX.read, không bỏ bài test.
- [x] CI toàn bộ v0.5.1 pass (25 unit/integration, 9 E2E); merge main 11f2ead, CI main run 45753755786 pass.
- [ ] Smoke test deployment production v0.5.1 và hai tài khoản thật.
- [x] Source persist cấu hình workspace theo tài khoản: version 1, stable slot UUID, alias/sheet/schema/config từng nguồn, không lưu file hoặc kết quả. Tương thích payload cũ và CAS.
- [x] Source restore từng slot bằng file tương thích, giữ các slot chưa nạp khi lưu; bỏ slot có xác nhận.
- [x] Source unit/integration/E2E workspace: validate, isolation, legacy write, partial restore, sai schema, reset và forget.
- [x] CI workspace v0.5.1 pass.
- [ ] Kiểm thử hai tài khoản thật và multi-device trên D1 production.
- [ ] Hoàn tất header/range, kiểu cột, profiling, mapping và batch refresh trước Phase 04.

### Workspace account persistence v0.5.1

- 2026-11-26: CI v0.5 `55dc6b0` (run 45749263382) xác nhận 21 unit/integration pass, build pass, Chromium pass, 6/7 E2E pass. Sửa lỗi test đọc file export bằng Node fs; không bỏ assertion nội dung workbook.
- Không thay D1 schema/migration hoặc OAuth. Workspace lưu trong payload hiện hữu. Một workspace/account; người dùng phải chọn lại file cho từng slot. Chưa có map cột khác tên hoặc nhiều project/account. Checklist mới là implementation, chưa phải runtime nghiệm thu.

### Release gate v0.5.1

- [x] CI 45752215492: 25/25 unit/integration, build và Chromium pass; 8/9 E2E pass, gồm workspace restore. Export workbook assertions pass; lỗi locator Sheet ở bước tiếp theo.
- [x] Thêm accessible name rõ ràng cho Sheet combobox và regression test chuyển sheet qua lại giữ filter. Chờ CI lại.
- Quy trình theo yêu cầu chủ dự án: feature branch → CI pass → merge main (Cloudflare Workers Builds) → module tiếp theo. Không đánh dấu production smoke test nếu chưa xác minh. Không merge module có lỗi CI chưa xử lý.

### Data Profiling v0.5.2

- [x] Merge main v0.5.1 tại 11f2ead; feature CI run 45753022995 và main CI run 45753755786 success.
- [x] Source SQL profiling theo bảng/revision, thống kê aggregate batch 8 cột, exact duplicate rows, top 10 frequency, kiểu dữ liệu đã chuẩn hóa.
- [x] Source UI responsive, on-demand, kết quả riêng toàn nguồn, không áp dụng filter báo cáo; local-only.
- [x] Source unit và E2E kiểm tra SQL ID, aggregate, empty, duplicate, filter independence, distribution, replace invalidation và mobile.
- [x] CI và auto merge v0.5.2 pass run 45769824542, main c67e643.
- [ ] Smoke test Cloudflare production.
- Chưa có schema editor, histogram bin, lỗi parse trước chuẩn hóa, benchmark trên mobile yếu. Không thay OAuth/D1.

### CI-gated release automation

- Chủ dự án yêu cầu mỗi module phải được nghiệm thu CI và merge main ngay khi đạt, không dừng ở push.
- [x] CI 45765148497: 28/28 unit/integration và build pass; 9/11 E2E pass; cả hai profiling E2E không hiển thị kết quả. Không bỏ qua test.
- [x] Sửa SQL aggregate count về INTEGER (giới hạn 100.000 dòng), tránh SUM(BIGINT) trả HUGEINT/Arrow decimal; thêm assertion SQL và fail-fast lỗi runtime trong E2E. Đây là nguyên nhân nghi ngờ từ source, cần kiểm chứng bằng CI.
- [x] Source release job opt-in trailer `Release-KySheet: approved`, needs unit/build, contents:write chỉ ở job release, kiểm tra SHA/ancestor, non-force fast-forward và verify remote main. Upload diagnostics khi CI lỗi.
- [x] CI/release v0.5.2 pass, xác minh HEAD main c67e643; Cloudflare deployment chưa xác minh.

- Sửa cú pháp YAML biểu thức if chứa dấu hai chấm bằng folded scalar; run 45769208332 bị từ chối trước khi tạo job.

- [x] CI run 45769265748: unit/integration và build pass; 10/11 E2E pass. Profile runtime đã hiển thị kết quả, assertions rows/missing/groups/duplicates pass, header-only và phân bố rỗng pass. Lỗi còn lại do Playwright `has` dùng locator đã scope theo panel nên không tìm thấy rowheader trong row. Sửa inner locator tương đối và kiểm tra đúng một dòng; giữ nguyên mọi assertion thống kê, phân bố, mobile và thay nguồn. Chờ CI mới.

### Schema Editor v0.5.3
- [x] Source conversion strict, preview lỗi theo cột, không âm thầm thay dữ liệu lỗi; remap report theo ID, transaction, revision/cache invalidation.
- [x] Source persistence quy tắc trong workspace JSON, reject client cũ ghi đè quy tắc, không migration D1.
- [x] Source UI, unit, integration và E2E; commit opt-in release.
- [ ] CI pass, auto merge main và smoke test production. Header/range, histogram, custom mapping khác tên cột gốc và Excel format chưa có.

- [x] CI run 45771288141: unit/integration, build pass; 11/12 E2E pass. Schema preview/apply/save assertions pass; restore sau reload còn lỗi, KPI vẫn 180 dòng demo. Source cho thấy E2E chỉ chờ KPI tồn tại, input hidden có thể nhận file trước khi Worker sẵn sàng và bỏ qua onChange. Sửa disabled input, báo WORKSPACE_BUSY thay vì bỏ qua file, E2E đợi demo hoàn tất và chọn qua filechooser thật; thêm regression file sai locale không thay nguồn trước khi restore file hợp lệ. Chờ CI mới, không bỏ assertion.

### Import layout & mapping v0.5.4
- [x] v0.5.3 CI 45771928085: 31 unit/integration, 12 E2E pass; auto merge main 7d66872.
- [x] Source header/range selection, validation, preview and explicit report reset confirmation; persisted layout and mapped rules.
- [x] Source replacement mapping per loaded source, strict conversion and compatibility checks, transactional apply.
- [x] CI v0.5.4 run 45773649563: 34 unit/integration + 13 E2E pass; auto merge main 082c4c0 verified.
- [ ] Production smoke test.
- [x] Source batch refresh multiple opened sources in v0.5.5.
- [ ] Merged-cell fill and import-time layout before initial source creation; separate follow-up.

### Batch Refresh v0.5.5
- [x] Source selection 2–12 loaded real sources, explicit file assignment, preview each, validation of schema/layout/previous mapping and revision.
- [x] Source staging budgets, independent staging tables, single atomic transaction, metadata update only after commit, fail closed when rollback cannot be verified.
- [x] Source responsive UI and unit/integration/E2E regression.
- [x] CI v0.5.5 run 45775303303: 37 unit/integration + 14 E2E pass; release main cf3a91a verified.
- [ ] Production smoke test. Batch does not restore unloaded slots or edit mapping during batch; use individual source mapping first. Browser memory limits are logical, not actual heap guarantees.

### Data Model v0.6.0
- [x] Source two raw tables, four JOIN types, up to three composite keys, exact cardinality and unmatched counts, duplicate warnings and explicit expansion confirmation.
- [x] Source UNION/UNION ALL explicit column mapping, matching kinds, output caps; readonly materialized table available in report/export/profile.
- [x] Source dependency revision invalidation; stale tables cannot query or export; derived snapshots excluded from workspace persistence and batch refresh.
- [x] CI v0.6.0 run 45776825577: 40 unit/integration + 16 E2E pass; release main 0fe4de9 verified.
- [ ] Production smoke test.
- [ ] Persistent model definitions, multi-step DAG, automatic rebuild, relation diagram and primary-key management. No implicit type coercion, no arbitrary SQL, no chained derived sources yet. Delete stale tables to release memory.

- [x] CI v0.6.0 run 45776337901: unit/integration and build passed, 14/16 E2E passed. Both new model tests failed before executing JOIN/UNION because three ModelPanel instances were visible. Source shows sibling ModelPanel/BatchPanel had identical React keys for raw-only source lists. Namespace sibling keys and encode source identity tuples with JSON.stringify to prevent key collisions, including aliases containing delimiters. Added regression requiring exactly one model and batch panel before use and after materialization/replacement; preserved all original JOIN/UNION value assertions; surface preview runtime errors immediately. CI and release still pending.

### Visual Transformation Pipeline v0.6.1
- [x] Source 8 allow-listed transforms: trim, literal replace, rename, drop, filter, fill text blanks, strict cast, full-row distinct. Up to 16 ordered steps, enable/disable/reorder/delete, bounded undo/redo.
- [x] Source bounded per-step preview and staged local execution, all-or-nothing output materialization; recursive dependency invalidation from raw and JOIN/UNION sources.
- [x] Source versioned account-level recipes (up to 12), CAS/old-client protection, no D1 migration; no cell samples persisted.
- [ ] CI, release and production smoke test. Not yet a multi-branch DAG. No sort/split/merge/group/unpivot, automatic rebuild or persistent JOIN recipe. Reapply saved recipes manually to compatible source; outputs remain session-only.

- [x] Add four pipeline compiler/dependency unit tests, account isolation/upgrade integration test and two Chromium E2E scenarios (strict cast failure, ordering, preview, undo/redo, persistence and stale result). Release gate pending.

### Advanced Pivot v0.7.0
- [x] Source Pivot with up to 3 row fields, 2 column fields, 6 measures; independent exact SQL aggregation at every subtotal/grand total, bounded axis cardinality and output, paginated matrix.
- [x] Source numeric row-level binary expressions and aggregate-measure arithmetic, ordered dependency validation, NULL on division by zero/nonfinite, formats number/VND/percent. No raw SQL/eval.
- [x] Source persistence in versioned Config, workspace/template/period compatibility, schema rename remapping and old-client write protection, full matrix CSV/XLSX export.
- [ ] CI + release and production smoke test. Remaining: drag/drop, expand/collapse, top-N, % of totals, drill-down, richer expressions/DAX, time intelligence, DECIMAL accuracy; no claim of full Phase 05 acceptance.
