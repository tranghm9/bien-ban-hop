# Biên bản họp

Ứng dụng web cá nhân chạy trên iPhone: ghi âm cuộc họp (hoặc chọn file ghi âm), chuyển thành chữ có tách người nói, viết biên bản, theo dõi đầu việc và xuất file Excel.

Mở tại: https://tranghm9.github.io/bien-ban-hop/

## Dữ liệu đi đâu

- **Ghi âm** được gửi thẳng từ điện thoại tới AssemblyAI để chuyển thành chữ và tách người nói. Lưu xong kết quả, app gửi lệnh xoá bản chép lời và file ghi âm trên máy chủ AssemblyAI. Nếu app bị đóng giữa chừng, lần mở sau app cho lấy lại kết quả rồi mới xoá.
- **Viết biên bản** có hai cách, chọn trong Cài đặt:
  - Mặc định: app sao chép yêu cầu và lời thoại, người dùng tự dán vào app Claude của mình rồi dán câu trả lời về. Lời thoại khi đó nằm trong tài khoản Claude của người dùng.
  - Tự động: lời thoại được gửi qua dịch vụ LLM Gateway của AssemblyAI tới mô hình Claude (tốn phí theo lượng chữ).
- **Lưu trữ**: khoá API và mọi cuộc họp được mã hoá bằng mã PIN và chỉ nằm trên điện thoại. Mã PIN chống người khác cầm máy mở app; nó không thay được mật khẩu mạnh nếu có kẻ lấy được toàn bộ dữ liệu của trình duyệt.
- Kho mã này không chứa dữ liệu hay khoá API nào. Không có máy chủ trung gian.

## Phát triển

- Không có bước build. `index.html` là toàn bộ app. Đẩy lên nhánh `main` là phát hành qua GitHub Pages.
- Kiểm thử: `node tests/e2e.js` (cần Playwright và Chromium; AssemblyAI được giả lập).
- Hướng dẫn cho trợ lý AI và sơ đồ dữ liệu: xem `AGENTS.md`.
