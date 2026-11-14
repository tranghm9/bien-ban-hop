# Biên bản họp: hướng dẫn cho trợ lý AI làm việc trên kho mã này

## Người dùng và mục tiêu
- Chủ dự án không rành kỹ thuật, dùng iPhone (Safari, hoặc app đã thêm ra màn hình chính). Tự làm phần kỹ thuật, giải thích bằng tiếng Việt đơn giản.
- App: ghi âm hoặc chọn file ghi âm cuộc họp, chuyển thành chữ có tách người nói, viết biên bản, theo dõi đầu việc, xuất Excel.
- Nội dung họp là thông tin mật. Nó chỉ được rời điện thoại theo hai đường: tới AssemblyAI (chuyển giọng nói) và tới Claude (người dùng tự dán).

## Kiến trúc (không có bước build)
- `index.html` chứa toàn bộ app (CSS, HTML, JS trong một file, để mỗi lần cập nhật là nguyên khối, không lệch phiên bản giữa các file).
  File dài khoảng 95 KB: dùng Grep theo các tiêu đề `/* ---------- ... ---------- */` để nhảy tới đúng phần, không cần đọc cả file.
- `xlsx.full.min.js`: thư viện SheetJS, chỉ tải khi mở một cuộc họp (hàm `loadXLSX`).
- GitHub Pages phục vụ nhánh `main` tại https://tranghm9.github.io/bien-ban-hop/ . Đẩy lên `main` là phát hành. Trình duyệt giữ bản cũ tối đa khoảng 10 phút.
- Dịch vụ ngoài: AssemblyAI `POST /v2/upload`, `POST/GET/DELETE /v2/transcript`. Khoá API do người dùng dán trong app, gửi ở header `authorization` (không có chữ Bearer).
- Viết biên bản có hai cách (Cài đặt, `S.writer`): `claude` (mặc định: app sao chép yêu cầu, người dùng dán vào app Claude rồi dán JSON trả lời về) và `aai` (tự động qua AssemblyAI LLM Gateway, tốn phí).

## Dữ liệu trên máy người dùng
- IndexedDB `bienban`, kho `meetings`: mỗi cuộc họp một bản ghi `{id, iv, ct}` mã hoá AES-GCM; khoá suy ra từ mã PIN bằng PBKDF2 (250.000 vòng).
- Cuộc họp `m`: `id, created, title, date, people, speakers, utts[{s,t,a,b}], names{A:"tên"}, durationText, minutes, lich_su[], lastChanges, truoc, cho`.
  - `minutes`: `chu_de, muc_dich, thanh_phan[], tom_tat, diem_chinh[], quyet_dinh[], viec_theo_doi[{..., xong}], ke_hoach[], can_xac_nhan[{noi_dung, thoi_diem, ok, sua, applied, nhap}]`.
  - `cho = {kind: "gen" | "apply", idx[]}`: đang chờ người dùng dán kết quả từ Claude. `truoc`: bản trước đó, để Hoàn tác.
- localStorage: `bb_salt`, `bb_check`, `bb_cfg` (mã hoá: khoá API, cách viết), `bb_theme`, `bb_job` (mã hoá: việc chuyển chữ đang dở, hoặc `{id, del:true}` là bản trên máy chủ còn chờ xoá).
- Địa chỉ `tranghm9.github.io` dùng chung kho lưu trữ với mọi trang khác của cùng tài khoản: chỉ đọc, ghi, xoá các khoá `bb_*` và cơ sở dữ liệu `bienban`.

## Quy tắc khi sửa
1. Chạy `node tests/e2e.js` trước khi commit (cần Playwright và Chromium). Sửa lỗi nào thì thêm bài thử cho lỗi đó.
2. Tăng `APP_VERSION` trong `index.html` mỗi lần phát hành. Số này hiện ở cuối màn Cài đặt để người dùng biết máy đã nhận bản mới.
3. Giữ tương thích với dữ liệu đã lưu: không đổi định dạng bản ghi nếu không có bước chuyển đổi và bài thử "dữ liệu cũ mở được bằng bản mới".
4. Không thêm script hay CSS từ bên thứ ba. Không đưa khoá API, nội dung họp hay email cá nhân của người dùng vào kho mã, commit, log.
5. Commit bằng danh tính mặc định của môi trường (không ghi đè `user.email`). Kho mã công khai.
6. Mọi chữ hiển thị viết tiếng Việt theo góc nhìn người dùng. Ô nhập phải có cỡ chữ từ 16px (nhỏ hơn thì iPhone tự phóng to trang).
7. Việc gọi AI có thể chạy nền: khi xong không được tự chuyển màn hình nếu người dùng đang ở màn khác (xem `autoRun`).

## Giới hạn khi kiểm thử
- Bộ thử dùng Chromium và AssemblyAI giả lập. Chưa chạy được với khoá AssemblyAI thật trong môi trường đám mây, và không có Safari thật:
  phần AI thật và hành vi riêng của iPhone do người dùng xác nhận trên máy. Nói rõ điều này khi báo cáo kết quả.
- Lỗi "tràn ngăn xếp" khi dữ liệu lớn chỉ lộ ra với cuộc họp dài: bài thử "họp dài 150 phút" phải luôn được giữ.
