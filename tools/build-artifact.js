// Đóng gói app thành trang Artifact để chạy trong app Claude.
// Không sửa dòng mã nào: index.html tự nhận biết nó đang chạy trong Claude (xem IN_CLAUDE). Công cụ này chỉ đổi "vỏ" của trang cho đúng quy định Artifact:
// - bỏ <html>/<head>/<body> (Claude tự bọc), giữ <title>, <style>, phần thân và <script>;
// - phông chữ: trang Artifact chỉ được lấy phông từ Google Fonts, nên thay các @font-face trỏ tới thư mục fonts/ bằng một thẻ <link> tới Google Fonts
//   (cùng hai phông Be Vietnam Pro và Quicksand). Thư viện Excel thì app tự lấy từ cdnjs khi chạy trong Claude (xem loadExcel).
// Kết quả là MỘT file, không có file đi kèm.
// Dùng:  node tools/build-artifact.js <thư mục ra>   rồi phát hành file bien-ban-hop.html bằng công cụ Artifact.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

function build(html){
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0].replace(/^\/\* Phông chữ lưu ngay trong kho mã[^\n]*\n/m, '').replace(/@font-face\{[^}]*\}\n?/g, '');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim();
  if (!title || !style || !body.includes('<script>') || style.includes('@font-face') || style.includes('fonts/')) throw new Error('index.html không đúng cấu trúc mong đợi');
  // Thẻ meta cam kết lề hai bên dùng max(16px, env(safe-area-inset-*)), đúng như CSS của app
  return `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${FONTS}\n${style}\n${body}\n`;
}
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Quicksand:wght@300..700&display=swap">';

module.exports = { build };
if (require.main === module){
  const out = process.argv[2]; if (!out){ console.error('Thiếu thư mục ra. Dùng: node tools/build-artifact.js <thư mục ra>'); process.exit(1); }
  fs.mkdirSync(out, {recursive: true});
  const page = path.join(out, 'bien-ban-hop.html');
  fs.writeFileSync(page, build(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  console.log('Đã ghi ' + page + ' (' + fs.statSync(page).size + ' byte)');
}
