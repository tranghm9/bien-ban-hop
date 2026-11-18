# Biên bản họp

Ứng dụng web cá nhân chạy trên iPhone: ghi âm cuộc họp (hoặc chọn file ghi âm; một cuộc họp có thể gồm nhiều file), chuyển thành chữ có tách người nói, viết biên bản, theo dõi đầu việc và xuất file Excel.

App có hai nơi dùng, chung một mã:

- **Trang web**: https://tranghm9.github.io/bien-ban-hop/ . Đủ mọi việc, kể cả ghi âm và chuyển giọng nói thành chữ.
- **Trong app Claude** (trang Artifact riêng tư của chủ dự án): nhận cuộc họp đã chuyển thành chữ từ trang web, Claude viết biên bản ngay trong trang, theo dõi đầu việc, tải Excel. Trang trong Claude không được phép ghi âm hay gửi file ghi âm đi, nên bước chuyển giọng nói vẫn làm ở trang web.

## Dữ liệu đi đâu

- **Ghi âm** được gửi thẳng từ điện thoại tới AssemblyAI để chuyển thành chữ và tách người nói. Lưu xong kết quả, app gửi lệnh xoá bản chép lời và file ghi âm trên máy chủ AssemblyAI. Nếu app bị đóng giữa chừng, lần mở sau app cho lấy lại kết quả rồi mới xoá. Trong Cài đặt có nút kiểm tra và xoá những bản còn sót trên AssemblyAI.
- **Viết biên bản** có hai cách, chọn trong Cài đặt:
  - Mặc định: app sao chép yêu cầu và lời thoại, người dùng tự dán vào app Claude của mình rồi dán câu trả lời về. Lời thoại khi đó nằm trong tài khoản Claude của người dùng.
  - Tự động: lời thoại được gửi qua dịch vụ LLM Gateway của AssemblyAI tới mô hình Claude (tốn phí theo lượng chữ).
- **Bản trong Claude**: cuộc họp được mã hoá bằng mã PIN ngay trên máy rồi mới lưu vào tài khoản Claude của người dùng; khi viết biên bản, lời thoại được gửi cho Claude và không nằm lại trong lịch sử trò chuyện.
- **Lưu trữ (trang web)**: khoá API và mọi cuộc họp được mã hoá bằng mã PIN và chỉ nằm trên điện thoại. Mã PIN đổi được trong Cài đặt; mã 8–10 số khó dò hơn nhiều so với 6 số. Mã PIN chống người khác cầm máy mở app; nó không thay được mật khẩu mạnh nếu có kẻ lấy được toàn bộ dữ liệu của trình duyệt.
- **Không có bên thứ ba nào khác**: phông chữ và thư viện Excel nằm ngay trong kho mã này, trang bị chặn (bằng CSP) không cho nối tới địa chỉ nào ngoài chính nó và AssemblyAI.
- Kho mã này không chứa dữ liệu hay khoá API nào. Không có máy chủ trung gian.

## Khi không có mạng

App đã mở một lần thì lần sau mở được cả khi mất mạng: đọc biên bản, đánh dấu đầu việc, tải Excel. Ghi âm mới vẫn cần mạng để chuyển thành chữ.

## Phát triển

- Không có bước build. `index.html` là toàn bộ app. Đẩy lên nhánh `main` là phát hành qua GitHub Pages.
- Kiểm thử: `node tests/e2e.js` (cần Playwright và Chromium; AssemblyAI và môi trường Claude được giả lập).
- Bản trong Claude: `node tools/build-artifact.js <thư mục>` đóng gói `index.html` thành trang Artifact; cách phát hành ghi trong `AGENTS.md`.
- Hướng dẫn cho trợ lý AI, sơ đồ dữ liệu và cách gỡ service worker: xem `AGENTS.md`.
- Giấy phép của phông chữ và thư viện đi kèm: thư mục `licenses/`.
