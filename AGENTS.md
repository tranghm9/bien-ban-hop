# Biên bản họp: hướng dẫn cho trợ lý AI làm việc trên kho mã này

## Người dùng và mục tiêu
- Chủ dự án không rành kỹ thuật, dùng iPhone (Safari, hoặc app đã thêm ra màn hình chính). Tự làm phần kỹ thuật, giải thích bằng tiếng Việt đơn giản.
- App: ghi âm hoặc chọn file ghi âm cuộc họp, chuyển thành chữ có tách người nói, viết biên bản, theo dõi đầu việc, xuất Excel.
- Nội dung họp là thông tin mật. Nó chỉ được rời điện thoại theo hai đường: tới AssemblyAI (chuyển giọng nói) và tới Claude
  (người dùng tự dán, hoặc bản chạy trong Claude gửi trực tiếp; dữ liệu lưu trong Claude luôn được mã hoá bằng mã PIN trước khi ghi).

## App chạy ở hai nơi, chung một mã
- **Trang web** (GitHub Pages): đủ mọi việc, kể cả ghi âm và chuyển giọng nói thành chữ. Dữ liệu nằm trên điện thoại.
- **Trong app Claude** (trang Artifact, người dùng muốn dùng app từ đây): https://claude.ai/artifact/MRA8fqXNXRMcV7jKXezEcb (riêng tư, chỉ chủ tài khoản mở được; cũng là hằng `CLAUDE_APP` trong mã).
  Trang Artifact không được dùng micro và không gọi được AssemblyAI, nên ở đây KHÔNG ghi âm, KHÔNG chuyển giọng nói thành chữ.
  Người dùng chuyển giọng nói ở trang web, bấm "Sao chép sang Claude", rồi dán vào màn "Cuộc họp mới" của bản trong Claude.
  Đổi lại: Claude viết biên bản ngay trong trang (không sao chép – dán), dữ liệu lưu trong tài khoản Claude nên mở được trên mọi thiết bị.
- `index.html` tự biết mình chạy ở đâu qua `IN_CLAUDE` (có `window.claude.use`). Phần giao diện chỉ dùng ở một nơi mang lớp `web-only` hoặc `claude-only`.
  Khi thêm tính năng, luôn nghĩ cả hai nơi: lưu dữ liệu (`saveMeeting`...), gọi AI (`callLLM`), lưu file (`saveFile`) đều đã rẽ nhánh theo `IN_CLAUDE`.

## Kiến trúc (không có bước build cho trang web)
- `index.html` chứa toàn bộ app (CSS, HTML, JS trong một file, để mỗi lần cập nhật là nguyên khối, không lệch phiên bản giữa các file).
  File dài khoảng 145 KB: dùng Grep theo các tiêu đề `/* ---------- ... ---------- */` để nhảy tới đúng phần, không cần đọc cả file.
- `exceljs.min.js`: thư viện ExcelJS 4.4.0 (xuất Excel có định dạng), chỉ tải khi mở một cuộc họp (hàm `loadExcel`).
- `fonts/`: phông Be Vietnam Pro và Quicksand nằm ngay trong kho (không gọi Google Fonts). Giấy phép của phông và thư viện: `licenses/`.
- `sw.js`: service worker, xem mục riêng bên dưới.
- Thẻ `<meta http-equiv="Content-Security-Policy">` ở đầu `index.html` chỉ cho trang nối tới chính nó và hai địa chỉ của AssemblyAI.
  Cần gọi thêm địa chỉ nào thì phải sửa thẻ này, nếu không trình duyệt sẽ chặn.
- GitHub Pages phục vụ nhánh `main` tại https://tranghm9.github.io/bien-ban-hop/ . Đẩy lên `main` là phát hành.
- Dịch vụ ngoài: AssemblyAI `POST /v2/upload`, `POST/GET/DELETE /v2/transcript`, `GET /v2/transcript?limit=` (danh sách, dùng cho việc dọn dữ liệu trong Cài đặt).
  Khoá API do người dùng dán trong app, gửi ở header `authorization` (không có chữ Bearer).
- Viết biên bản (Cài đặt, `S.writer`): `claude` (mặc định trên web: app sao chép yêu cầu, người dùng dán vào app Claude rồi dán JSON trả lời về),
  `aai` (chỉ trên web: tự động qua AssemblyAI LLM Gateway, tốn phí), `direct` (mặc định trong Claude: gọi `sample` của trang Artifact, tính vào gói Claude của người dùng).

## Bản chạy trong Claude (trang Artifact)
- Phát hành: `node tools/build-artifact.js <thư mục tạm>` tạo `bien-ban-hop.html` (một file, chỉ đổi "vỏ" trang, không sửa mã), rồi dùng công cụ Artifact phát hành file đó
  lên đúng địa chỉ ở trên (tham số `url`). Quyền đã khai: `db`, `user`, `sample`, `downloads`. Phát hành lại thì không truyền `capabilities` để giữ nguyên.
  Mỗi lần phát hành trang web cũng phải phát hành lại bản này.
- Nguồn ngoài của bản trong Claude (trang Artifact chỉ cho nạp script và phông từ vài nơi): phông từ Google Fonts (do công cụ đóng gói đổi), thư viện Excel từ cdnjs,
  dự phòng jsDelivr, đúng bản 4.4.0 và kèm mã băm `EXCEL_SRI` của `exceljs.min.js` trong kho. Đổi thư viện thì tính lại:
  `openssl dgst -sha384 -binary exceljs.min.js | openssl base64 -A`. Không nội dung họp nào đi tới các nơi này. Quy tắc "không gọi bên thứ ba" ở dưới áp dụng cho trang web.
- Kho dữ liệu (`db`), tất cả nằm trong vùng riêng của từng người `data/users/<id>/bbh`: tài liệu gốc `bbh` giữ `bb_salt`, `bb_kdf`, `bb_wrap`, `bb_cfg`;
  `bbh/meetings/<id>` = `{iv, ct, t}` là phần nhẹ của cuộc họp (không có `utts`); `bbh/parts/<id>.<v>.<k>` = `{ct}` là lời thoại đã nén, mã hoá, cắt mỗi phần 180.000 ký tự
  (mỗi tài liệu trong kho tối đa 256 KiB, kho không có giao dịch). `t = {v, n, iv, z}` trỏ tới bộ phần đang dùng. Lời thoại chỉ tải khi mở cuộc họp (`openFromList`).
- Mã PIN trong Claude không mã hoá thẳng dữ liệu: nó mở một khoá dữ liệu ngẫu nhiên (`bb_wrap`). Đổi mã PIN chỉ ghi lại tài liệu gốc (`changePinClaude`).
  Mọi lượt ghi tài liệu gốc phải đi qua `kvSave`/`kvCommit` (một hàng đợi) để lượt ghi cũ không đè thông tin mở khoá mới.
- Gọi Claude: `callSample`, mỗi lượt tối đa 256 KiB (tính theo byte). Họp dài hơn thì `directChunkChars` cắt thành vài phần lớn rồi gộp, dùng lại luồng của chế độ `aai`.
- Những thứ khung Artifact cấm, đã có đường thay: đọc bộ nhớ tạm (người dùng tự dán vào ô), tự tải file (`downloads`), service worker, `confirm()`, gọi ra máy chủ ngoài.
- Gói chuyển cuộc họp từ web sang Claude: chuỗi `BBH1~` + gzip + base64 (hoặc `BBH0~` + JSON khi máy không có CompressionStream), xem `packMeeting`/`unpackMeeting`.
  `unpackMeeting` chỉ nhận các trường đã biết và ép kiểu từng trường. Bài học từ máy thật: iPhone coi chuỗi dạng `TÊN:...` là một địa chỉ và đổi `TÊN` thành chữ thường
  khi dán, nên tiền tố dùng `~`, và lúc nhận thì chấp nhận cả hoa lẫn thường, cả `:` lẫn `~`. Thứ gì đi qua bộ nhớ tạm của iPhone đều phải đọc "dễ tính" như vậy.

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
- Cuộc họp `m`: `id, created, title, date, people, speakers, utts[{s,t,a,b,p?}], names{A:"tên"}, durationText, model, sttOpts[], parts[{name,dur,err?}], minutes, lich_su[], lastChanges, truoc, cho, loiThoaiMoi?`.
  - Một cuộc họp có thể gồm nhiều file ghi âm. `parts` = các file theo thứ tự ghép (`dur` giây, `err` = lý do file đó không có trong lời thoại); `u.p` = số thứ tự phần (bỏ trống = phần đầu).
    Mốc giờ `a`, `b` tính liên tục qua các phần. Cuộc họp lưu trước bản 2026.11.18 không có `parts`: coi như một phần (`durSec` đọc `durationText` hoặc mốc cuối).
  - Máy tách người nói riêng cho từng file: phần có lời đầu tiên giữ nhãn A, B, C; phần sau lấy nhãn chưa dùng (`mergeParts`). Gõ cùng tên thì `speakerColors` gộp thành một người.
  - `loiThoaiMoi`: đã thêm file vào cuộc họp có biên bản, biên bản chưa có phần mới; xoá khi tạo lại biên bản.
  - `minutes`: `chu_de, muc_dich, thanh_phan[], tom_tat, diem_chinh[], quyet_dinh[], viec_theo_doi[{..., xong}], ke_hoach[], can_xac_nhan[{noi_dung, thoi_diem, ok, sua, applied, nhap}]`.
  - `cho = {kind: "gen" | "apply" | "lang", idx[]}`: đang chờ người dùng dán kết quả từ Claude (viết mới, cập nhật theo xác nhận, thống nhất ngôn ngữ). `truoc`: bản trước đó, để Hoàn tác.
  - `sttOpts`: tuỳ chọn phụ mà AssemblyAI đã nhận (`speaker_options`, `keyterms_prompt`), hiện ở tab Người nói. Hai nhãn người nói được gõ cùng tên được coi là một người (`speakerColors`).
- localStorage: `bb_salt`, `bb_kdf`, `bb_check`, `bb_cfg` (mã hoá: khoá API, cách viết), `bb_theme`,
  `bb_job` (mã hoá): việc chuyển chữ đang dở `{mid, meta, started, files[{name,size}], parts[{id,opts}|null], appendTo?}` (`parts[i]` null = file i chưa gửi được),
  hoặc `{del:true, ids[]}` là các bản trên máy chủ còn chờ xoá. Dạng cũ `{id,...}` / `{id, del:true}` vẫn đọc được qua `normJob`. Mỗi file được ghi vào `bb_job` ngay sau khi gửi,
  nên app bị đóng giữa chừng thì không gửi lại file đã gửi; file chưa gửi thì người dùng chọn lại (khớp theo tên) hoặc lấy kết quả phần đã gửi.
  `bb_next` (chỉ tồn tại khi một lần đổi mã PIN bị dừng giữa chừng: `{salt, kdf, check, cfg, job}` của mã mới; `tryUnlock` dựa vào đó để biết dữ liệu đang được mã hoá bằng mã nào).
- Đổi mã PIN (`changePin`) = mã hoá lại mọi cuộc họp trong MỘT giao dịch IndexedDB. Giữ nguyên thứ tự các bước trong hàm: nó bảo đảm app bị đóng ở bước nào cũng không mất dữ liệu.
- Cache Storage: chỉ kho `bbh-shell-v1` (của `sw.js`).
- Địa chỉ `tranghm9.github.io` dùng chung kho lưu trữ với mọi trang khác của cùng tài khoản: chỉ đọc, ghi, xoá các khoá `bb_*`, cơ sở dữ liệu `bienban` và kho cache `bbh-shell-v1`.

## Quy tắc khi sửa
1. Chạy `node tests/e2e.js` trước khi commit (cần Playwright và Chromium). Sửa lỗi nào thì thêm bài thử cho lỗi đó.
   Các bài tên bắt đầu bằng "trong Claude" chạy bản Artifact ở `/__claude/` với môi trường Claude giả lập (`claudeStub` trong `tests/e2e.js`, viết theo hợp đồng 0.2.96).
2. Tăng `APP_VERSION` trong `index.html` mỗi lần phát hành. Số này hiện ở cuối màn Cài đặt, và là thứ `checkUpdate()` so sánh để mời người dùng cập nhật.
3. Giữ tương thích với dữ liệu đã lưu: không đổi định dạng bản ghi nếu không có bước chuyển đổi và bài thử "dữ liệu cũ mở được bằng bản mới".
4. Không gọi script, CSS hay phông từ bên thứ ba: thứ gì cần thì đặt vào kho kèm giấy phép. Không đưa khoá API, nội dung họp hay email cá nhân của người dùng vào kho mã, commit, log.
5. Commit bằng danh tính mặc định của môi trường (không ghi đè `user.email`). Kho mã công khai.
6. Mọi chữ hiển thị viết tiếng Việt theo góc nhìn người dùng. Ô nhập phải có cỡ chữ từ 16px (nhỏ hơn thì iPhone tự phóng to trang).
7. Việc gọi AI có thể chạy nền: khi xong không được tự chuyển màn hình nếu người dùng đang ở màn khác (xem `autoRun`).
8. Biên bản phải thống nhất một ngôn ngữ: tiếng Việt, văn phong công sở, từ tiếng Anh được dịch (trừ tên riêng, chữ viết tắt). Mọi yêu cầu gửi AI có sửa lời văn biên bản phải kèm `LANG_RULES`. Lời thoại thì giữ nguyên như đã nói.
9. Việc nào thay hoặc xoá dữ liệu (tạo lại biên bản, xoá bản trên AssemblyAI, bỏ kết quả đang chờ) phải hỏi lại bằng lần bấm thứ hai.

## Giới hạn khi kiểm thử
- Bộ thử dùng Chromium và AssemblyAI giả lập. Chưa chạy được với khoá AssemblyAI thật trong môi trường đám mây
  (kho bí mật của môi trường luôn gửi khoá kèm chữ "Bearer", AssemblyAI không nhận dạng đó), và không có Safari thật:
  phần AI thật và hành vi riêng của iPhone do người dùng xác nhận trên máy. Nói rõ điều này khi báo cáo kết quả.
- Chưa được kiểm chứng với AssemblyAI thật: cách nhận ra bản chép lời đã xoá trong danh sách (`audio_url` chứa `deleted_by_user`, hàm `listRemote`).
  Nếu người dùng báo "Kiểm tra dữ liệu còn lưu" đếm cả bản đã xoá thì sửa ở đó.
- Lỗi "tràn ngăn xếp" khi dữ liệu lớn chỉ lộ ra với cuộc họp dài: bài thử "họp dài 150 phút" phải luôn được giữ.
- Bản trong Claude mới chạy với môi trường giả lập: chưa ai trong phiên làm việc mở được trang Artifact thật. Việc Claude viết trực tiếp (`sample`),
  kho dữ liệu thật, lưu file Excel qua app Claude và thao tác dán trên iPhone do người dùng xác nhận. Khi có báo lỗi từ người dùng, đọc lại hợp đồng của
  trang Artifact (skill `artifact-capabilities`) trước khi sửa, vì các quy định này thay đổi theo thời gian.
- Bài thử "tải file lên" gồm hai phần vì máy chủ giả lập không phát ra tiến độ: phần nhãn trong app, và phần tiến độ thật chạy đúng hàm `uploadAudio` với một máy chủ thật trên máy thử.
