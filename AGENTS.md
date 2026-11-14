# Biên bản họp: hướng dẫn cho trợ lý AI làm việc trên kho mã này

## Người dùng và mục tiêu
- Chủ dự án không rành kỹ thuật, dùng iPhone (Safari, hoặc app đã thêm ra màn hình chính). Tự làm phần kỹ thuật, giải thích bằng tiếng Việt đơn giản.
- App: ghi âm hoặc chọn file ghi âm cuộc họp, chuyển thành chữ có tách người nói, viết biên bản, theo dõi đầu việc, xuất Excel.
- Nội dung họp là thông tin mật. Nó chỉ được rời điện thoại theo hai đường: tới AssemblyAI (chuyển giọng nói) và tới Claude (người dùng tự dán).

## Kiến trúc (không có bước build)
- `index.html` chứa toàn bộ app (CSS, HTML, JS trong một file, để mỗi lần cập nhật là nguyên khối, không lệch phiên bản giữa các file).
  File dài khoảng 115 KB: dùng Grep theo các tiêu đề `/* ---------- ... ---------- */` để nhảy tới đúng phần, không cần đọc cả file.
- `exceljs.min.js`: thư viện ExcelJS 4.4.0 (xuất Excel có định dạng), chỉ tải khi mở một cuộc họp (hàm `loadExcel`).
- `fonts/`: phông Be Vietnam Pro và Quicksand nằm ngay trong kho (không gọi Google Fonts). Giấy phép của phông và thư viện: `licenses/`.
- `sw.js`: service worker, xem mục riêng bên dưới.
- Thẻ `<meta http-equiv="Content-Security-Policy">` ở đầu `index.html` chỉ cho trang nối tới chính nó và hai địa chỉ của AssemblyAI.
  Cần gọi thêm địa chỉ nào thì phải sửa thẻ này, nếu không trình duyệt sẽ chặn.
- GitHub Pages phục vụ nhánh `main` tại https://tranghm9.github.io/bien-ban-hop/ . Đẩy lên `main` là phát hành.
- Dịch vụ ngoài: AssemblyAI `POST /v2/upload`, `POST/GET/DELETE /v2/transcript`, `GET /v2/transcript?limit=` (danh sách, dùng cho việc dọn dữ liệu trong Cài đặt).
  Khoá API do người dùng dán trong app, gửi ở header `authorization` (không có chữ Bearer).
- Viết biên bản có hai cách (Cài đặt, `S.writer`): `claude` (mặc định: app sao chép yêu cầu, người dùng dán vào app Claude rồi dán JSON trả lời về) và `aai` (tự động qua AssemblyAI LLM Gateway, tốn phí).

## Service worker (`sw.js`)
- Việc của nó: giữ một bản của app trên máy để mở được khi mất mạng. Luôn hỏi máy chủ trước (`cache: "no-cache"`), chỉ dùng bản đã lưu khi không có mạng.
  Nhờ vậy lần mở app sau khi phát hành là có bản mới. App đang mở sẵn thì `checkUpdate()` hiện thanh "Có bản mới", người dùng bấm mới tải lại.
- Chỉ xử lý yêu cầu GET tới chính app. Mọi yêu cầu tới AssemblyAI đi thẳng ra mạng, không bao giờ được lưu lại.
- Thêm file tĩnh mới mà app cần khi mất mạng thì thêm vào danh sách `SHELL` trong `sw.js`.
- Cách gỡ khi service worker gây lỗi: KHÔNG xoá file `sw.js` (máy người dùng sẽ giữ mãi bản cũ). Thay nội dung `sw.js` bằng bản tự gỡ rồi phát hành,
  đồng thời bỏ dòng `navigator.serviceWorker.register` trong `index.html`:
  ```js
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", e => e.waitUntil(caches.delete("bbh-shell-v1").then(() => self.registration.unregister())));
  ```

## Dữ liệu trên máy người dùng
- IndexedDB `bienban`, kho `meetings`: mỗi cuộc họp một bản ghi `{id, iv, ct}` mã hoá AES-GCM; khoá suy ra từ mã PIN bằng PBKDF2-SHA256.
  Số vòng nằm ở `bb_kdf`: 600.000 cho mã PIN tạo hoặc đổi từ bản 2026.11.14.2; không có `bb_kdf` nghĩa là dữ liệu cũ, 250.000 vòng (vẫn phải mở được).
- Cuộc họp `m`: `id, created, title, date, people, speakers, utts[{s,t,a,b}], names{A:"tên"}, durationText, model, sttOpts[], minutes, lich_su[], lastChanges, truoc, cho`.
  - `minutes`: `chu_de, muc_dich, thanh_phan[], tom_tat, diem_chinh[], quyet_dinh[], viec_theo_doi[{..., xong}], ke_hoach[], can_xac_nhan[{noi_dung, thoi_diem, ok, sua, applied, nhap}]`.
  - `cho = {kind: "gen" | "apply", idx[]}`: đang chờ người dùng dán kết quả từ Claude. `truoc`: bản trước đó, để Hoàn tác.
  - `sttOpts`: tuỳ chọn phụ mà AssemblyAI đã nhận (`speaker_options`, `keyterms_prompt`), hiện ở tab Người nói. Hai nhãn người nói được gõ cùng tên được coi là một người (`speakerColors`).
- localStorage: `bb_salt`, `bb_kdf`, `bb_check`, `bb_cfg` (mã hoá: khoá API, cách viết), `bb_theme`,
  `bb_job` (mã hoá: việc chuyển chữ đang dở, hoặc `{id, del:true}` là bản trên máy chủ còn chờ xoá),
  `bb_next` (chỉ tồn tại khi một lần đổi mã PIN bị dừng giữa chừng: `{salt, kdf, check, cfg, job}` của mã mới; `tryUnlock` dựa vào đó để biết dữ liệu đang được mã hoá bằng mã nào).
- Đổi mã PIN (`changePin`) = mã hoá lại mọi cuộc họp trong MỘT giao dịch IndexedDB. Giữ nguyên thứ tự các bước trong hàm: nó bảo đảm app bị đóng ở bước nào cũng không mất dữ liệu.
- Cache Storage: chỉ kho `bbh-shell-v1` (của `sw.js`).
- Địa chỉ `tranghm9.github.io` dùng chung kho lưu trữ với mọi trang khác của cùng tài khoản: chỉ đọc, ghi, xoá các khoá `bb_*`, cơ sở dữ liệu `bienban` và kho cache `bbh-shell-v1`.

## Quy tắc khi sửa
1. Chạy `node tests/e2e.js` trước khi commit (cần Playwright và Chromium). Sửa lỗi nào thì thêm bài thử cho lỗi đó.
2. Tăng `APP_VERSION` trong `index.html` mỗi lần phát hành. Số này hiện ở cuối màn Cài đặt, và là thứ `checkUpdate()` so sánh để mời người dùng cập nhật.
3. Giữ tương thích với dữ liệu đã lưu: không đổi định dạng bản ghi nếu không có bước chuyển đổi và bài thử "dữ liệu cũ mở được bằng bản mới".
4. Không gọi script, CSS hay phông từ bên thứ ba: thứ gì cần thì đặt vào kho kèm giấy phép. Không đưa khoá API, nội dung họp hay email cá nhân của người dùng vào kho mã, commit, log.
5. Commit bằng danh tính mặc định của môi trường (không ghi đè `user.email`). Kho mã công khai.
6. Mọi chữ hiển thị viết tiếng Việt theo góc nhìn người dùng. Ô nhập phải có cỡ chữ từ 16px (nhỏ hơn thì iPhone tự phóng to trang).
7. Việc gọi AI có thể chạy nền: khi xong không được tự chuyển màn hình nếu người dùng đang ở màn khác (xem `autoRun`).
8. Việc nào thay hoặc xoá dữ liệu (tạo lại biên bản, xoá bản trên AssemblyAI, bỏ kết quả đang chờ) phải hỏi lại bằng lần bấm thứ hai.

## Giới hạn khi kiểm thử
- Bộ thử dùng Chromium và AssemblyAI giả lập. Chưa chạy được với khoá AssemblyAI thật trong môi trường đám mây
  (kho bí mật của môi trường luôn gửi khoá kèm chữ "Bearer", AssemblyAI không nhận dạng đó), và không có Safari thật:
  phần AI thật và hành vi riêng của iPhone do người dùng xác nhận trên máy. Nói rõ điều này khi báo cáo kết quả.
- Chưa được kiểm chứng với AssemblyAI thật: cách nhận ra bản chép lời đã xoá trong danh sách (`audio_url` chứa `deleted_by_user`, hàm `listRemote`).
  Nếu người dùng báo "Kiểm tra dữ liệu còn lưu" đếm cả bản đã xoá thì sửa ở đó.
- Lỗi "tràn ngăn xếp" khi dữ liệu lớn chỉ lộ ra với cuộc họp dài: bài thử "họp dài 150 phút" phải luôn được giữ.
- Bài thử "tải file lên" gồm hai phần vì máy chủ giả lập không phát ra tiến độ: phần nhãn trong app, và phần tiến độ thật chạy đúng hàm `uploadAudio` với một máy chủ thật trên máy thử.
