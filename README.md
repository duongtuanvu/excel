# KySheet v0.5 — Excel report automation

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
