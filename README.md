# KySheet — Excel report automation

## Lập BCTC năm theo Thông tư 99

Mở **BCTC TT99 → Tải mẫu nhập sổ**. Chế độ này lập BCTC riêng năm bằng VND cho doanh nghiệp đáp ứng giả định hoạt động liên tục, với năm tài chính bắt đầu từ ngày 01/01/2026 trở đi. B03-DN sử dụng phương pháp trực tiếp. [Biểu mẫu gốc trong Phụ lục IV](https://congbao.chinhphu.vn/van-ban/thong-tu-so-99-2025-tt-btc-46529/59652.htm)

1. Điền doanh nghiệp, địa chỉ và ngày đầu/cuối năm tài chính. Chọn loại hình cổ phần nếu áp dụng.
2. Dùng các tiêu đề trong mẫu để nhập bảng cân đối số phát sinh, nhật ký, công nợ TK 131 theo khách hàng và kỳ hạn, hoặc chỉ tiêu bổ sung có căn cứ. Gán mã chỉ tiêu và dấu theo nghiệp vụ thực tế. B01 so sánh cuối năm với đầu năm. B02 và B03 so sánh năm nay với năm trước.
3. Chọn ô của một chỉ tiêu để xem nguồn hoặc bổ sung số liệu. Kiểm tra từng mục trong **Đối chiếu trước khi xuất**. Giá trị chưa xác định hiển thị **Cần bổ sung**. Chỉ xác nhận số 0 sau khi đã kiểm tra sổ.
4. Mở **B09-DN**, điền các chính sách và bảng chi tiết áp dụng cho doanh nghiệp, rồi rà soát từng mục. Có thể chèn khung nội dung hoặc dán bảng từ Excel để giữ các cột.
5. **Xuất bản nháp Excel** kèm danh sách chênh lệch và căn cứ. **Xuất BCTC Excel** tạo bốn biểu sau khi đạt các phép đối chiếu và hoàn thiện thuyết minh. **Lưu hồ sơ** tải tệp JSON gồm số liệu và căn cứ về máy. Dùng **Mở hồ sơ** để làm tiếp. Dữ liệu của chế độ này chỉ xử lý tại thiết bị.

## Chạy báo cáo kỳ mới

Nhập file, thiết lập báo cáo rồi chọn **Workspace tài khoản → Lưu workspace**. Bạn có thể ghép nhiều bảng theo từng bước và dùng bảng đã biến đổi ở bước ghép tiếp theo. Workspace ghi nhớ nguồn, cột, phép ghép, các bước biến đổi và cấu hình báo cáo đang chọn. File Excel và kết quả tính nằm trong trình duyệt.

Khi có số liệu mới, chọn **Chạy kỳ mới**, chọn báo cáo, gán file cho từng nguồn được liệt kê rồi bấm **Chạy báo cáo**. KySheet đọc các cột theo tên đã lưu và chạy lại các bước theo thứ tự. Nếu khóa ghép làm nhân dòng, ứng dụng hiển thị số dòng dự kiến để bạn xác nhận. File sai cấu trúc hoặc bước tính bị lỗi sẽ dừng cả lần chạy và giữ báo cáo đang mở. Khi thành công, dùng **Xuất Excel** hoặc **CSV** trên báo cáo kết quả.

Web app local-first: React + TypeScript + Vite, SheetJS và DuckDB-Wasm. Phiên bản v0.5 yêu cầu đăng nhập Google, Cloudflare Workers API và D1. Workbook và kết quả phân tích chỉ tồn tại trong bộ nhớ browser. Hồ sơ, mẫu và cấu hình báo cáo lưu riêng theo tài khoản trên D1; người dùng chủ động lưu. Không tự nhập hồ sơ LocalStorage cũ.

## Build và kiểm thử

Node.js >= 22.12; npm hoặc Bun.

    git clone -b main https://github.com/duongtuanvu/excel.git
    cd excel
    bun install
    bun run build
    bun run test

Vite dev/preview đơn thuần không có Workers API; màn hình auth sẽ không mở workspace. Dùng Worker local với database/credentials test và origin/callback tương ứng hoặc môi trường staging riêng. Không dùng D1 production cho test. Bộ E2E v0.3 trước đây giả định guest; cần điều chỉnh fixture xác thực trước khi coi pass. Lockfile/CI và build auth chưa được xác minh.

## Cloudflare Workers Builds — Production

**Auth đã merge vào main theo yêu cầu chủ dự án; cần hoàn tất OAuth và kiểm thử production.** File `wrangler.jsonc` trong branch này là cấu hình production thật, không dùng để deploy Worker staging hoặc preview auth kết nối D1 production.

| Setting | Value |
| --- | --- |
| Repository | duongtuanvu/excel |
| Production branch | main |
| Worker name | excel |
| Domain hiện tại (quản lý trên Dashboard) | https://excel.linhsumi.io.vn |
| Build command | bun run build |
| Deploy command | npx wrangler deploy |
| Root directory | / |
| D1 binding | DB |
| Database name | kysheet |
| APP_ORIGIN | https://excel.linhsumi.io.vn |

`wrangler.jsonc` có Worker entry `worker/index.ts`, assets `./dist`, binding ASSETS, selective routing `/api/*`. Không dùng lệnh deploy chỉ có --assets. `keep_vars: true` giữ biến Dashboard khi deploy; không đưa secrets vào GitHub. `workers_dev: false` và không khai báo routes để tiếp tục quản lý custom domain trên Dashboard. Kiểm tra lại Domains sau deployment. Tắt non-production branch builds sử dụng cấu hình production; staging dùng Worker, D1, OAuth client/callback và Wrangler config riêng từ `wrangler.auth.jsonc.example`.

### Google OAuth

Google Auth Platform → Clients → Create client → Web application. Authorized redirect URI production:

    https://excel.linhsumi.io.vn/api/auth/callback

Chỉ yêu cầu openid/email/profile. Trong Worker Settings → Variables and Secrets, tạo GOOGLE_CLIENT_ID (Text) và GOOGLE_CLIENT_SECRET (Secret). APP_ORIGIN được quản lý bằng Wrangler. Không dùng Build Variables hoặc VITE_ cho OAuth secret. Nếu static-only Worker chưa cho phép tạo runtime bindings/secrets, deploy auth trong khung bảo trì sau khi chuẩn bị credentials hoặc dùng triển khai staging riêng; login chỉ hoạt động khi runtime secrets đầy đủ. Không gửi secret qua chat.

### D1 database

Chủ dự án xác nhận đã tạo users, user_settings, sessions, oauth_attempts qua D1 Console. Wrangler sẽ tự bind database kysheet với tên DB khi deploy Worker script. Không cần tạo lại database. Kiểm tra schema và index trong Console:

    SELECT name, type FROM sqlite_master WHERE name IN ('users','user_settings','sessions','oauth_attempts','sessions_expiry','sessions_owner','oauth_expiry') ORDER BY type,name;

Migration 0001 được đổi thành idempotent IF NOT EXISTS để có thể ghi nhận bằng Wrangler sau khi xác minh bảng/cột/index đã đúng schema; IF NOT EXISTS không sửa bảng sai cấu trúc. Không chạy migration tự động trong mỗi build. Nếu cần, chủ động chạy:

    npx wrangler d1 migrations apply DB --remote

### Kiểm thử trước release

- Build và typecheck branch auth. Staging dùng DB test riêng, không có dữ liệu thật.
- Kiểm tra callback/Google login, session expiry, logout, lưu hồ sơ và mẫu, lưu/khôi phục cấu hình.
- Kiểm thử hai tài khoản A/B trên hai browser context; sửa payload hoặc user header, hai tab cùng lưu, đổi tài khoản, CSRF, stale session.
- Sau deploy production: xác minh D1 binding DB, custom domain, API GET /api/session trả HTTP 401 JSON khi chưa đăng nhập, login và lưu cấu hình hoạt động. Chuẩn bị rollback bản v0.3 và không phá dữ liệu D1.

Mặc định build chỉ tải **binary WASM tĩnh, pin 1.30.0** từ jsDelivr ở runtime; worker JS và phần còn lại được host cùng website. Lý do: giới hạn 25 MiB/file trên Cloudflare Workers Static Assets có thể không phù hợp với WASM DuckDB. CDN không nhận workbook, câu truy vấn hay kết quả. Nếu CDN bị chặn, ứng dụng sẽ không khởi tạo được engine.

Nếu cần host hoàn toàn nội bộ/không gọi CDN, dùng `npm run build:local`; deploy dist lên static hosting hỗ trợ kích thước binary WASM. Không cần COOP/COEP vì chỉ dùng bundle đơn luồng MVP/EH. Không hỗ trợ offline sau reload nếu chưa có service worker hoặc cache đầy đủ.

## Chức năng

- Import XLSX/XLS/CSV/TSV, chọn sheet, nhận diện tiêu đề trùng/trống, kiểu cột số/văn bản/ngày/boolean.
- Nhóm tối đa 3 cấp; SUM, COUNT, AVG, MIN, MAX, COUNT DISTINCT; tối đa 12 điều kiện AND.
- KPI, biểu đồ thanh/cột có giá trị âm, dữ liệu nguồn và bảng tổng hợp phân trang.
- Import/export mẫu JSON có version, kiểm tra tương thích schema theo tên cột; dữ liệu không được lưu trong template (giá trị bộ lọc có thể chứa dữ liệu nhạy cảm, cần cân nhắc trước khi chia sẻ).
- XLSX xuất 3 sheet (Tổng quan, Tổng hợp, Dữ liệu đã lọc); CSV xuất bảng tổng hợp, trung hòa công thức từ text.
- Giao diện responsive; dữ liệu mẫu để thử nhanh.
- Không gian cá nhân: Google login, session server-side, tên hiển thị, tên workspace, mật độ bảng, tối đa 20 mẫu và cấu hình gần nhất lưu D1 theo user xác thực, áp dụng/xuất JSON/xóa mẫu, đặt lại hồ sơ và logout. Đã code, chưa nghiệm thu.

## Kiến trúc

    React UI
      -> typed request/response client
      -> report.worker.ts (SheetJS, import, export, serial queue)
      -> DuckDB browser worker (in-memory SQL)
      <- small report results + paginated rows

Không có SQL editor hoặc execute SQL của người dùng; tên cột nội bộ và toán tử được whitelist, literal được quote. Dữ liệu import được tải vào staging table và kiểm tra schema/row count trước khi thay nguồn chính trong transaction. Báo cáo tự cập nhật sau 250 ms debounce. Kết quả lỗi/không khớp cấu hình không được dùng để export.

## Giới hạn

- Nhiều workbook và sheet độc lập trong phiên; mỗi lần xem báo cáo một nguồn; chưa có JOIN nhiều file, pivot column, report canvas kéo thả, calculated field hoặc dashboard nhiều widget.
- 25 MB file, 100.000 dòng, 100 cột, 1 triệu ô, khoảng 40 triệu ký tự CSV sau chuẩn hóa; giới hạn bảo vệ thiết bị, không phải cam kết chạy được mọi file đạt ngưỡng.
- 5.000 nhóm; nếu vượt, cảnh báo và chặn export thay vì xuất thiếu. Bảng dữ liệu nguồn 50 dòng/trang, chart 12 nhóm đầu.
- Giả định hàng dữ liệu không trống đầu tiên là tiêu đề. Không tính lại công thức Excel; chỉ dùng giá trị cache. Ngày trong Excel có thể được chuyển thành ISO; kiểu của cột dữ liệu trộn là text. Mã dạng chuỗi có số 0 ở đầu được giữ dạng text; mã số có format Excel đặc biệt có thể mất format gốc.
- Số thực được tổng hợp kiểu DOUBLE, không thay cho đối soát tài chính chính xác theo decimal.
- Giới hạn không bảo đảm chống mọi workbook nén độc hại; chỉ mở file từ nguồn tin cậy. Reload mất workbook và kết quả; hồ sơ, mẫu và cấu hình đã lưu tồn tại trong D1. Giới hạn payload 512.000 byte UTF-8; revision CAS từ chối cập nhật cũ. Giá trị bộ lọc và tên cột có thể nhạy cảm. Không tự nhập LocalStorage cũ.
- Build và E2E cần được chạy tại môi trường có internet để cài dependencies. Safari/iOS và tải lớn cần benchmark riêng.

## Tài khoản

Google OAuth server-side Authorization Code + PKCE; cookie HttpOnly, Secure, SameSite=Lax, session token hash lưu D1. API dựa trên user_id của session, không tin owner_id từ frontend; origin check và revision CAS. Không lưu Google access token/password, workbook hoặc kết quả phân tích trên D1. Các guard và flow đã code, chưa kiểm thử tích hợp hoặc audit bảo mật. Cần rate limiting auth/API, kiểm thử cách ly user, chính sách riêng tư và hoàn tất QA trước release.

## Roadmap

Tiếp theo: multi-source JOIN có kiểm tra cardinality, pivot matrix, calculated metrics, biểu đồ nhiều widget, data profiling, streaming ingest/export, CI và benchmark thực tế.

## Trang thông tin công khai / Google Branding

- Homepage: https://excel.linhsumi.io.vn/
- Privacy: https://excel.linhsumi.io.vn/privacy/
- Terms: https://excel.linhsumi.io.vn/terms/
- About: https://excel.linhsumi.io.vn/about/
- Authorized domain: linhsumi.io.vn

Các trang HTML tĩnh trong public/ không cần login, D1 hoặc JavaScript. Link ở login và workspace mở tab mới. Sau deploy, xác minh HTTP 200 và nội dung thật ở cả ba URL. Chính sách mô tả implementation hiện tại, chưa được rà soát pháp lý; chủ dự án cần bổ sung địa chỉ email hỗ trợ trực tiếp khi chốt, xác nhận quy trình xóa tài khoản và retention trước phát hành rộng rãi.

### Chẩn đoán lỗi Google Login

Trang login hiển thị mã lỗi cố định theo bước OAuth. Workers logs ghi event `oauth_failed`, stage, reason và HTTP status nếu có; không ghi body Google, URL callback, credentials, code, state, token, cookie hoặc thông tin user. `google_invalid_client`: kiểm tra runtime Client ID/Secret cùng OAuth client. `google_invalid_grant`: bắt đầu lại login; kiểm tra callback và PKCE. `oauth_start_failed`, `oauth_state_storage_failed`, `account_storage_failed`, `session_storage_failed`: kiểm tra binding DB và schema. GET /api/session 401 khi chưa đăng nhập là bình thường. Không gửi secret, cookie hoặc URL callback chứa code/state khi báo lỗi. Cloudflare platform logs cần được cấu hình để không thu query OAuth nhạy cảm.

OAuth transport fix: Cloudflare workerd does not support outbound fetch redirect:'error'. Google token and UserInfo calls now use redirect:'manual' with explicit 3xx rejection; no credentials are forwarded to a redirect destination. Form body is encoded as a string. Error UI distinguishes network/timeout/redirect and displays safe numeric HTTP status. No OAuth secret or provider body is logged.

## Auth QA (v0.4.1)

`npm test` includes account API integration tests with actual SQLite migration SQL using Node 22 node:sqlite and a structural D1 adapter; Google responses are mocked in the OAuth flow. Playwright account fixture is test-only; no guest or bypass endpoint exists in production. GitHub Actions runs unit and build/E2E jobs. These tests do not replace real D1/OAuth, multi-device, or production smoke testing. Settings conflicts have a distinct SETTINGS_CONFLICT code; an account switch invalidates a stale workspace instead of saving across accounts.

## Multi-source v0.5

Thêm file sẽ tạo bảng riêng; file thật đầu tiên thay demo mặc định. Chọn sheet sẽ mở một nguồn độc lập hoặc chuyển tới nguồn đã mở. Đổi alias, xóa, thay file của nguồn hiện tại. Thay file kiểm tra mọi cột cũ theo tên/kiểu, chọn sheet cùng tên (hoặc file chỉ có một sheet), giữ ID và tăng revision; transaction giữ bảng cũ nếu import lỗi. Cấu hình riêng từng nguồn giữ trong RAM trong khi làm việc; từ v0.5.1 có thể lưu toàn bộ cấu trúc và cấu hình nguồn vào tài khoản. Chưa có JOIN. Giới hạn 12 nguồn, 32 sheet/workbook, tổng 50 MiB file, 2 triệu ô workbook/bảng và 50 triệu ký tự CSV; giới hạn sau parse không loại bỏ mọi rủi ro zip bomb. CI runner pin ubuntu-24.04 để tương thích Playwright 1.55.1.

## Workspace theo tài khoản — v0.5.1

- Import nguồn thật, thiết kế báo cáo riêng từng nguồn, chọn **Workspace tài khoản → Lưu workspace**. Lưu schema version 1, mã slot UUID, alias, sheet, tên/kiểu cột và cấu hình; không lưu workbook, dòng dữ liệu, query result, dung lượng hay đường dẫn file. Alias mặc định có thể chứa tên file, bộ lọc có thể chứa giá trị nhạy cảm.
- Đăng nhập lại/reload: danh sách nguồn đã lưu ở trạng thái Chờ file. Chọn file tương thích riêng từng slot, kiểm tra schema và áp dụng cấu hình. Các cột cũ phải cùng tên/kiểu, có thể đổi thứ tự hoặc thêm cột; ưu tiên sheet đúng tên, chấp nhận workbook chỉ một sheet. File sai schema không thay nguồn đang mở.
- Lưu khi còn slot chưa nạp giữ nguyên cấu hình slot đó. Xóa nguồn trong RAM không xóa bản đã lưu; để bỏ hẳn cấu hình, đóng nguồn rồi chọn Bỏ cấu hình và xác nhận. Đặt lại không gian cá nhân xóa workspace lưu trên server cùng các mẫu/cấu hình đã lưu, không xóa file gốc hoặc báo cáo đang mở.
- Dùng chung `user_settings.payload`, revision CAS, 512.000 byte UTF-8; không có migration D1. Đọc được payload cũ không có workspace; write từ client v0.4 không có trường workspace sẽ giữ bản đã lưu nếu revision khớp. Không rollback sang server cũ có validator không hiểu workspace sau khi user đã lưu cấu hình mới nếu chưa backup/chuẩn bị chuyển đổi dữ liệu.
- Một bản workspace trên mỗi tài khoản; tối đa 12 slot. Chưa hỗ trợ project nhiều workspace, khôi phục nhiều sheet bằng một lần chọn file, mapping thủ công hoặc autosave. File được nạp riêng mỗi slot nên có thể phát sinh bản workbook trong RAM; vẫn áp dụng budget. Kiểm thử thực tế D1/multi-device và benchmark cần xác minh.

## Data Profiling v0.5.2

Mở nguồn dữ liệu → Chất lượng dữ liệu → Phân tích chất lượng. Tính theo toàn bộ bảng đã nhập, không theo filter báo cáo. Đếm NULL/chuỗi rỗng/chỉ dấu cách, distinct không gồm ô trống, nhóm trùng toàn dòng (so sánh chính xác giá trị đã chuẩn hóa, gồm NULL), số dòng thuộc nhóm trùng và số dòng dư. Thống kê min/max/sum/avg cho cột số DOUBLE; min/max cho cột ngày ISO; lỗi chuyển kiểu ở cột đã nhận diện số/ngày/logic, không đánh giá lỗi kiểu của văn bản hỗn hợp. Đây không phải thống kê lỗi đọc file Excel trước chuẩn hóa.

SQL dùng ID bảng/cột nội bộ; aggregate theo batch tối đa 8 cột, không gửi hàng dữ liệu sang UI. Profile cache theo revision và tự mất hiệu lực khi thay/xóa nguồn. Phân bố top 10 giá trị chính xác theo tần suất, bỏ ô trống, gộp phần còn lại; nhãn tối đa 120 ký tự hiển thị, tính trên giá trị nguyên gốc. Mọi phép tính nằm trong Web Worker/DuckDB-Wasm, không lưu D1 hoặc gửi dữ liệu ra API. Không tự sửa/xóa dữ liệu; chưa có schema editor, histogram khoảng số, profiler dữ liệu gốc hoặc benchmark bộ nhớ trên thiết bị yếu.

## CI-gated module release

Module feature branches use the existing full unit/integration and TypeScript/Vite/Chromium E2E checks. To explicitly approve a finished module for release, the maintainer adds the exact standalone commit-message line `Release-KySheet: approved`. Only a push on `feature/**` with that opt-in can run the release job; ordinary pushes and pull requests cannot. Release runs only after both CI jobs succeed, uses a separate contents:write token, verifies the tested SHA is still the feature tip and main is its ancestor, and performs a non-force fast-forward push. Concurrent releases are serialized. Diverged main, branch protection or insufficient token permissions stop the release. GitHub's GITHUB_TOKEN push does not trigger another GitHub Actions push run; the exact SHA has already passed the gate. Verify the external Cloudflare Workers Builds deployment separately. Never use force push or bypass a failed check. No personal token or new Cloudflare secret is required for this workflow.

## Schema Editor v0.5.3

Chọn Cấu trúc cột → Chỉnh cấu trúc → đổi tên/kiểu → Kiểm tra chuyển đổi → Áp dụng cấu trúc. Worker đọc workbook gốc, đếm lỗi và chặn áp dụng nếu có lỗi; giữ nguyên bảng cũ và report. Số Việt Nam dùng dấu chấm nhóm và dấu phẩy thập phân, ngày DD/MM/YYYY được kiểm tra lịch, số nguyên ngoài safe integer bị từ chối ở chế độ số explicit. Text giữ leading zero có sẵn trong chuỗi, không phục hồi định dạng hiển thị Excel. Lưu workspace để lưu rule theo tên cột gốc; file kỳ mới áp dụng rule trước khi kiểm tra tương thích. Client cũ không có header schema capability sẽ bị từ chối ghi nếu đã lưu rule. Không migration D1. Không hỗ trợ header/range, mapping cột gốc khác tên hoặc arbitrary locale; DOUBLE vẫn có giới hạn độ chính xác.

## Import layout & mapping v0.5.4
Sau khi mở nguồn, chọn Vùng dữ liệu và mapping để chỉnh dòng header, cột đầu và dòng/cột cuối (trống = tự mở rộng). Header gộp bị từ chối ở chế độ chọn vùng. Preview kiểm tra xung đột cấu hình; reset báo cáo cần xác nhận. Thay file có mapping ghép từng cột hiện tại với cột file mới, giữ mode chuyển kiểu, kiểm tra schema trước khi apply transaction. Lưu workspace để giữ layout và mapping. Không migration D1. Chưa có batch refresh, chọn vùng trước lần import đầu hoặc tự điền merge-cell.

## Batch Refresh v0.5.5
Mở ít nhất hai nguồn thật, chọn Cập nhật hàng loạt, gán file kỳ mới cho 2–12 nguồn, Kiểm tra hàng loạt rồi Áp dụng hàng loạt. Worker kiểm tra revision, schema, layout, conversion, mapping đã lưu, giới hạn và tạo bảng staging; toàn bộ bảng được đổi trong một transaction. Nếu một nguồn lỗi, không commit bất kỳ nguồn nào. Nguồn không chọn giữ nguyên, không tự lưu account. Không gửi file hoặc kết quả lên server. Tổng file mới 50 MiB; staging cap logic 100 MiB file, 4 triệu ô workbook/bảng, 100 triệu ký tự CSV kể cả bảng cũ. DuckDB memory 384 MB vẫn áp dụng; không bảo đảm heap thực tế, có thể cần chia batch. Nếu không xác nhận rollback, Worker chặn truy vấn đến khi reload. Chỉ hỗ trợ nguồn đã mở, không sửa mapping trong batch.

## Data Model v0.6.0
Open two real sources, Mô hình dữ liệu → select left/right, operation, output name and key pairs or UNION mapping → Kiểm tra mô hình → Tạo bảng kết quả. INNER/LEFT/RIGHT/FULL JOIN exact stored-string equality, same logical kind, 1–3 keys; blank/NULL keys never match. Preview groups keys before expansion to count matches and unmatched rows. Expansion requires confirmation; JOIN columns prefixed Trái/Phải. UNION requires bijective mapping of equal column count and kinds; distinct removes exact duplicate rows; ALL keeps them. Output max 100k rows, 100 columns, 1m cells plus total workspace budget. Conservative UTF-8 output budget. Materialized readonly snapshot supports report, export, profiling; source revision changes invalidate it, stale snapshot cannot activate/query/export, delete it to reclaim memory. Raw file changes do not automatically rebuild. Model definitions and result tables are session-only; workspace saves raw sources only. No new D1 migration. Chained derived tables, persistent model recipes and automatic rebuild remain follow-up.

## Visual Transformation Pipeline v0.6.1
Open a real source or valid JOIN/UNION result, then Pipeline biến đổi dữ liệu. Build up to 16 ordered steps: trim, literal replace, rename, drop, filter, fill text blanks, strict cast (standard number, ISO date, boolean, text), exact full-row distinct. Enable/disable, reorder and undo/redo up to 30 edits. Check each step and inspect up to five sample rows/eight columns; create a new readonly result only after all enabled steps pass. SQL identifiers are validated, values escaped, guards reject invalid conversion or oversized text before materialization. Uses alternating staging tables, workspace and peak staging budgets. No edits to source. Stale dependency checks recurse through JOIN/UNION. Save up to 12 versioned recipes to account, load on compatible source and rerun manually; recipe names, column names and entered condition/replacement values can be sensitive. Samples/results/files stay local, no migration D1. Previous clients cannot erase saved recipes. Sequential pipeline only; no DAG, automated rebuild, sorting, splitting, merging, aggregation or unpivot yet.

## Advanced Pivot v0.7.0
Open Pivot nâng cao → Mở Pivot. Add up to 3 row fields, 2 column fields and 6 measures. Measures can aggregate a column, aggregate a binary numeric row expression, or perform arithmetic on preceding aggregate measures. Set formatting and subtotal, Kiểm tra Pivot → Áp dụng Pivot. All calculations use report filters. Each subtotal/grand total is recomputed over its input rows; missing intersections count/distinct=0, other measures=NULL; division by zero/nonfinite=NULL. Bounds: 500 row groups, 64 column groups, 20,000 measure cells, group labels 240 characters; never silently truncate. Matrix paginates both axes; CSV exports full matrix, Excel adds Pivot sheet with numeric cells and display format. Save workspace/templates to persist configuration; Chạy kỳ mới revalidates the pivot before committing new period data. DOUBLE arithmetic, not exact financial DECIMAL. No arbitrary SQL, drag/drop, DAX, drilldown, time intelligence, top-N or expand/collapse yet. No D1 migration.

## Pivot Analytics v0.7.1
Top N ranks leaf rows by the selected raw measure across all columns, excludes NULL scores, preserves full filtered subtotals and grand total. With multi-level rows it retains hierarchy order and ancestors. % of grand/row/column uses original aggregates (zero/NULL denominator -> NULL), formulas reference raw measures. Excel percent formatting and CSV headers identify ratios. Click any cell to inspect matching source rows under current filters, 25 rows per page, text clipped at 240 characters; includes rows not contributing to a measure. Collapse row groups only changes UI. Top N and show-as persist with report; old clients cannot erase them. Original axis/cell limits apply before ranking. No D1 migration.

## Advanced Expressions & Time Intelligence v0.7.2
Pivot supports bounded arithmetic expressions with parentheses, IF(comparison,yes,no), ABS and COALESCE. Row expressions reference [column] (escape ] as ]]); aggregate expressions reference earlier @m1 etc. No arbitrary SQL. Group a single date column by calendar month/year. Time measures reference earlier raw measures; previous and YoY compare exact calendar periods, absent periods return NULL. Growth uses signed prior value and NULL for zero denominator. YTD sums additive SUM/COUNT across available months within the same calendar year after report filters, not a full unfiltered calendar. No missing-month generation, fiscal calendar, rolling periods or time intelligence on time measures. Grand and undated time cells are NULL. Drill-down shows current cell period only. Config persists with workspace; old-client protection included. DOUBLE arithmetic remains.

## Financial Pivot v0.7.3
Opt in under Pivot → Chế độ tính toán Pivot. Uses fixed-point BigInt, scale 0–6, 30 scaled digits, half-away-from-zero for multiplication/division/AVG and display rounding. SUM/MIN/MAX/COUNT/DISTINCT, formulas, Top N, percentages and calendar measures operate on exact scaled integers; subtotal recomputed from source. Invalid numeric inputs or excess fractional digits and overflow fail closed. For high-precision Excel values use text cells and explicitly select Văn bản schema from the original workbook before Pivot, because numeric cells/auto conversion and earlier transforms can lose precision. Numeric comparison filters are blocked in financial mode; equality filters remain text equality. Other report KPIs, raw data export and schema/pipeline numeric operations still DOUBLE. XLSX Pivot exports exact decimal strings (not numeric Excel cells); import CSV as text to avoid spreadsheet conversion. Bounded row batches and DISTINCT memory limits. No D1 migration.

## Dashboard Designer v0.8.0
Open Dashboard Designer from the work-mode navigation. Add KPI, bar, line, pie, summary table, Pivot or text widgets; each data widget binds to a stable workspace slot and copies the current report configuration. Change source, title, dimensions, aggregation and grouping in the inspector. Drag handles or up/down buttons reorder widgets; width/height selectors resize the responsive grid. Presentation mode hides inspector; fullscreen depends on browser support. Light/dark themes. Common filter applies exact/contains to the shared field, AND with each widget's saved filters. Save up to four dashboards (12 widgets each, three Pivot maximum); saving may snapshot the workspace. Real data sources required for persistence. Run Dashboard new period to restore all required source/model dependencies in one transaction, checking every widget before commit. Pivot financial results preserve exact formatted decimal values. KPI and ordinary charts remain DOUBLE. Chart/table previews capped at 30 groups, line/pie reject larger results; Pivot preview 30 rows. No cross-filter, free-position canvas, dashboard export, or editing Pivot expressions directly in designer yet. No data/workbooks sent to server; account stores configuration only. No D1 migration.
