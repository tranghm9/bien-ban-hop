// Bộ kiểm thử đầu-cuối cho app Biên bản họp.
// Chạy:  node tests/e2e.js            (chạy hết)      node tests/e2e.js lock wipe   (chỉ các bài có tên chứa từ khoá)
// Cần Playwright + Chromium. Không gọi dịch vụ thật: AssemblyAI được giả lập, câu trả lời của Claude do bài thử tự viết.
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OLD_COMMIT = 'd6543b2';   // bản trước đợt rà soát 11/2026: dùng để thử "dữ liệu cũ mở được bằng bản mới"
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.wav':'audio/wav'};

function serve(){
  let old = null; try{ old = cp.execFileSync('git', ['-C', ROOT, 'show', OLD_COMMIT + ':index.html'], {stdio:['ignore','pipe','ignore']}); }catch(e){}
  return new Promise(res => { const s = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]); const isOld = p.startsWith('/__old/'); if (isOld) p = p.slice(6);
    if (p.endsWith('/')) p += 'index.html';
    if (isOld && p === '/index.html'){ if (!old){ r.writeHead(404); return r.end(); } r.writeHead(200, {'content-type': MIME['.html']}); return r.end(old); }
    const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end(); }
    r.writeHead(200, {'content-type': MIME[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
    s.listen(0, '127.0.0.1', () => res({url: 'http://127.0.0.1:' + s.address().port + '/', hasOld: !!old, close: () => s.close()})); });
}
const SENT = ['Chào mọi người, hôm nay mình rà soát tiến độ kế hoạch quý bốn và thống nhất các đầu việc cần làm trong tháng tới.',
  'Dạ em xin cập nhật là phần report đã xong khoảng bảy mươi phần trăm, em sẽ gửi bản draft trước thứ sáu tuần này ạ.',
  'Về ngân sách thì mình cần xác nhận lại với phòng tài chính, deadline dự kiến là cuối tháng mười một nhé.',
  'Em nghĩ mình nên tách thành hai giai đoạn để giảm rủi ro, giai đoạn một launch thử ở Hà Nội trước rồi mới mở rộng.'];
// Lời thoại giả cho cuộc họp dài `minutes` phút (~200 âm tiết mỗi phút, 4 người nói luân phiên)
function fakeUtterances(minutes){ const out = []; let t = 0, i = 0;
  while (t < minutes * 60000){ const text = SENT[i % 4] + ' ' + SENT[(i + 1) % 4]; const dur = Math.round(text.split(/\s+/).length / 200 * 60000);
    out.push({speaker: 'ABCD'[i % 4], text, start: t, end: t + dur}); t += dur; i++; } return out; }
const MINUTES = {chu_de:'Tiến độ quý 4', muc_dich:'Rà soát', thanh_phan:['Anh Minh','Chị Lan'], tom_tat:'Thống nhất gửi report cuối tháng.',
  diem_chinh:[{chu_de:'Report', noi_dung:'Report xong 70%.', ket_luan:'Gửi draft trước thứ sáu'}], quyet_dinh:['Tách hai giai đoạn'],
  viec_theo_doi:[{cong_viec:'Gửi report', nguoi_phu_trach:'Chị Lan', han:'cuối tháng [cần xác nhận]', uu_tien:'Cao', ghi_chu:''},
    {cong_viec:'Xác nhận ngân sách', nguoi_phu_trach:'Anh Minh', han:'20/11/2026', uu_tien:'Trung bình', ghi_chu:''}],
  ke_hoach:[{noi_dung:'Họp lại', thoi_gian:'Tuần sau', ghi_chu:''}], can_xac_nhan:[{noi_dung:'Cuối tháng là ngày nào?', thoi_diem:'00:00:10'}]};
const fenced = obj => 'Đây là kết quả:\n```json\n' + JSON.stringify(obj, null, 1) + '\n```';
const ok = (cond, msg) => { if (!cond) throw new Error('SAI: ' + msg); };

let browser, srv;
// Mở app trong một "điện thoại" mới tinh. opts: utterances, duration, poll(n), pollFail(n), create(body,n), llm(body,n), path
async function open(opts = {}){
  const ctx = await browser.newContext({viewport:{width:390, height:844}, permissions:['clipboard-read','clipboard-write','microphone']});
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = {upload:0, create:[], poll:0, del:0, llm:[]};
  await page.route('https://api.assemblyai.com/**', async r => { const u = r.request().url(), m = r.request().method();
    if (u.includes('/v2/upload')){ calls.upload++; return r.fulfill({json:{upload_url:'https://cdn.assemblyai.com/upload/x'}}); }
    if (m === 'POST' && u.endsWith('/v2/transcript')){ const body = JSON.parse(r.request().postData()); calls.create.push(body);
      return r.fulfill(opts.create ? opts.create(body, calls.create.length) : {json:{id:'t1', status:'queued'}}); }
    if (m === 'DELETE'){ calls.del++; return r.fulfill({json:{}}); }
    if (m === 'GET' && u.includes('/v2/transcript/t1')){ calls.poll++;
      if (opts.pollFail && opts.pollFail(calls.poll)) return r.abort('failed');
      return r.fulfill({json: opts.poll ? opts.poll(calls.poll) : {id:'t1', status:'completed', audio_duration: opts.duration || 600, utterances: opts.utterances || fakeUtterances(2)}}); }
    return r.fulfill({json:{transcripts:[]}}); });
  await page.route('https://llm-gateway.assemblyai.com/**', async r => { const body = JSON.parse(r.request().postData()); calls.llm.push(body);
    try{ return await r.fulfill(opts.llm ? await opts.llm(body, calls.llm.length) : {status:500, json:{}}); }catch(e){ errors.push('giả lập AI: ' + e.message); return r.fulfill({status:500, json:{}}); } });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({status:200, contentType:'text/css', body:''}));
  await page.clock.install();   // đồng hồ giả: tua nhanh các khoảng chờ 5 giây của app
  await page.goto(srv.url + (opts.path || ''));
  const t = {ctx, page, errors, calls,
    ev: (fn, arg) => page.evaluate(fn, arg),
    visible: sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]'); }, sel),
    pin: async d => { for (const c of d) await page.click(`#keypad button:text-is("${c}")`); },
    unlock: async () => { await t.pin('123456'); await page.click('#btnUnlock'); await t.until(() => S.screen && S.screen !== 'scrLock' && (S.screen !== 'scrHome' || S.loaded), 'mở khoá'); },
    firstRun: async (writer) => { await t.pin('123456'); await page.click('#btnUnlock'); await t.pin('123456'); await page.click('#btnUnlock');
      await t.until(() => S.screen === 'scrSettings', 'vào Cài đặt lần đầu'); await page.fill('#apiKey', 'khoa-thu');
      if (writer) await page.selectOption('#writer', writer); await page.click('#btnSaveKey'); await t.until(() => S.screen === 'scrHome', 'về danh sách'); },
    // Tua đồng hồ từng 5 giây cho tới khi điều kiện đúng
    until: async (fn, what, steps = 80, realMs = 30) => { for (let i = 0; i < steps; i++){ if (await page.evaluate(fn)) return; await page.clock.fastForward(5200); await page.waitForTimeout(realMs); }
      throw new Error('Chờ mãi không thấy: ' + what); },
    newMeeting: async (meta = {}) => { await page.click('#btnNew'); await page.setInputFiles('#fileIn', path.join(__dirname, 'im-lang.wav'));
      if (meta.title) await page.fill('#mTitle', meta.title); if (meta.people) await page.fill('#mPeople', meta.people);
      if (meta.speakers) await page.fill('#mSpeakers', String(meta.speakers)); await page.click('#btnProcess'); },
    process: async meta => { await t.newMeeting(meta); await t.until(() => S.screen === 'scrMeet', 'chuyển thành chữ xong'); },
    clip: () => page.evaluate(() => navigator.clipboard.readText()),
    setClip: s => page.evaluate(x => navigator.clipboard.writeText(x), s),
    // Viết biên bản qua luồng Claude: bấm Tạo biên bản → dán câu trả lời
    claudeGen: async (minutes = MINUTES) => { await page.click('.seg [data-tab="min"]'); await page.click('#btnMinutes'); await page.waitForTimeout(150);
      const prompt = await t.clip(); await t.setClip(fenced(minutes)); await page.click('#cbPaste'); await t.until(() => !!(S.cur && S.cur.minutes), 'nhập biên bản'); return prompt; },
    close: async () => { await ctx.close(); ok(!errors.length, 'lỗi JavaScript trên trang: ' + errors.join(' | ')); }};
  return t;
}

const tests = {
  'pin: tạo mã, nhập lệch, sai mã, đúng mã': async () => { const t = await open(), p = t.page;
    await t.pin('123456'); await p.click('#btnUnlock'); await t.pin('654321'); await p.click('#btnUnlock');
    ok((await p.textContent('#lockErr')).includes('không giống'), 'phải báo hai lần nhập không giống nhau');
    await t.firstRun(); await p.reload(); await t.pin('111111'); await p.click('#btnUnlock'); await p.waitForTimeout(600);
    ok((await p.textContent('#lockErr')).includes('Sai mã PIN'), 'phải báo sai mã PIN'); await t.unlock();
    ok(await t.ev(() => S.screen) === 'scrHome', 'đúng mã thì vào danh sách'); await t.close(); },

  'claude: sao chép yêu cầu, chặn dán nhầm, nhập kết quả, Excel': async () => { const t = await open(), p = t.page; await t.firstRun();
    await t.process({title:'Họp thử', people:'anh Minh, chị Lan', speakers:3});
    const body = t.calls.create[0]; ok(body.speaker_options && body.speaker_options.min_speakers_expected === 2 && body.speaker_options.max_speakers_expected === 5 && !('speakers_expected' in body), 'số người nói phải gửi dạng khoảng');
    ok(await t.visible('#tab_spk'), 'xong thì mở tab Người nói'); ok(t.calls.upload === 1, 'tải lên đúng 1 lần');
    await p.fill('#name_A', 'Anh Minh'); await p.fill('#name_B', 'Chị Lan'); await p.click('#btnSaveNames');
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes'); await p.waitForTimeout(150); const prompt = await t.clip();
    ok(prompt.includes('ĐỊNH DẠNG TRẢ LỜI') && prompt.includes('Anh Minh: ') && prompt.includes('Cấu trúc JSON'), 'yêu cầu phải có định dạng, tên người nói, cấu trúc');
    ok(!prompt.includes('không markdown') && !prompt.includes('không đặt trong khối mã'), 'yêu cầu cho Claude không được vừa cấm vừa đòi khối mã');
    await p.click('#cbPaste'); await p.waitForTimeout(300);   // bộ nhớ tạm vẫn là yêu cầu
    ok((await p.textContent('#minErr')).includes('vẫn là yêu cầu') && await t.ev(() => S.cur.minutes === null), 'dán nhầm yêu cầu phải bị chặn, không tạo biên bản rác');
    await t.setClip(JSON.stringify({bien_ban: MINUTES})); await p.click('#cbPaste'); await t.until(() => !!S.cur.minutes, 'nhập kết quả bọc trong bien_ban');
    ok(await t.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat && !(await t.visible('#claudeBox')) && await t.ev(() => !S.cur.cho), 'nhập xong thì đóng khung Claude');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnExcel')]); const XLSX = require(path.join(ROOT, 'xlsx.full.min.js'));
    const wb = XLSX.read(fs.readFileSync(await dl.path()), {type:'buffer'}); ok(wb.SheetNames.join('|') === 'Biên bản|Việc cần theo dõi|Kế hoạch tiếp theo|Lời thoại', 'đủ 4 trang tính');
    const flat = XLSX.utils.sheet_to_json(wb.Sheets['Biên bản'], {header:1}).flat().join('|');
    ok(flat.includes(MINUTES.tom_tat) && flat.includes('CẦN XÁC NHẬN LẠI') && !flat.includes('LỊCH SỬ CHỈNH SỬA'), 'Excel: có tóm tắt, không in mục trống');
    ok(XLSX.utils.sheet_to_json(wb.Sheets['Lời thoại'], {header:1})[1][1] === 'Anh Minh', 'Excel: lời thoại ghi tên thật');
    ok(/^BienBan_\d{4}-\d\d-\d\d_Hop-thu\.xlsx$/.test(dl.suggestedFilename()), 'tên file Excel');
    await p.click('#btnBack'); await p.click('#btnSettings'); ok(/^Phiên bản \d{4}\.\d+\.\d+/.test(await p.textContent('#appVer')), 'Cài đặt hiện số phiên bản'); await t.close(); },

  'xác nhận: lưu nháp, cập nhật qua Claude sau khi app tải lại, hoàn tác, sửa đầu việc': async () => { const t = await open(), p = t.page; await t.firstRun();
    await t.process({title:'Họp xác nhận'}); await t.claudeGen();
    await p.fill('#confirmCard .cx input', '30/11/2026'); await p.clock.fastForward(800); await p.waitForTimeout(100);
    await p.click('#btnBack'); await p.click('.mcard'); ok(await p.inputValue('#confirmCard .cx input') === '30/11/2026', 'chữ gõ dở được giữ');
    await p.click('#confirmCard .cx button.primary'); await p.waitForTimeout(150); ok((await p.textContent('#btnApply')).includes('(1)') && await t.visible('#btnApply'), 'có 1 xác nhận chờ cập nhật');
    await p.click('#btnApply'); await p.waitForTimeout(150); const ap = await t.clip(); ok(ap.includes('30/11/2026') && ap.includes('ĐỊNH DẠNG TRẢ LỜI'), 'yêu cầu cập nhật có nội dung xác nhận');
    await p.reload(); await t.unlock(); await p.click('.mcard');   // app bị tải lại giữa chừng (iPhone hay làm vậy khi chuyển app)
    ok(await t.visible('#claudeBox') && (await t.clip()) === ap, 'mở lại vẫn thấy khung chờ Claude, không tự ghi đè bộ nhớ tạm');
    const upd = JSON.parse(JSON.stringify(MINUTES)); delete upd.can_xac_nhan; upd.viec_theo_doi[0].han = '30/11/2026';
    await t.setClip(fenced({bien_ban: upd, thay_doi:["Hạn 'Gửi report' → 30/11/2026"]})); await p.click('#cbPaste'); await t.until(() => S.cur.minutes.viec_theo_doi[0].han === '30/11/2026', 'cập nhật hạn');
    ok(await t.ev(() => S.cur.minutes.can_xac_nhan[0].applied === true) && !(await t.visible('#btnApply')), 'xác nhận được đánh dấu đã cập nhật, nút Cập nhật biến mất');
    await p.click('#tab_min button:has-text("Hoàn tác")'); await p.waitForTimeout(200);
    ok(await t.ev(() => S.cur.minutes.viec_theo_doi[0].han.includes('cuối tháng') && S.cur.minutes.can_xac_nhan[0].applied !== true) && await t.visible('#btnApply'), 'hoàn tác trả về bản trước');
    await p.click('.seg [data-tab="task"]'); await p.click('#tab_task .task >> nth=0 >> button:has-text("Sửa")');
    await p.fill('#tab_task .task >> nth=0 >> input[data-k="ghi_chu"]', 'ghi chú mới'); await p.click('#tab_task .task >> nth=0 >> button:has-text("Lưu")'); await p.waitForTimeout(150);
    ok(await t.ev(() => S.cur.minutes.viec_theo_doi[0].han.includes('cuối tháng') && S.cur.minutes.viec_theo_doi[0].ghi_chu === 'ghi chú mới'), 'sửa ghi chú không làm mất hạn đang chờ xác nhận');
    await t.close(); },

  'họp dài 150 phút: lưu được, mở lại được, nhập biên bản được': async () => { const utt = fakeUtterances(150); const t = await open({utterances: utt, duration: 9000}), p = t.page;
    await t.firstRun(); await t.process({title:'Họp dài'}); const size = await t.ev(() => JSON.stringify(S.cur).length);
    ok(size > 150000, 'bài thử phải vượt ngưỡng lỗi cũ (125 KB), thực tế ' + size); await t.claudeGen();
    await p.reload(); await t.unlock(); await p.click('.mcard'); ok(await t.ev(() => S.cur.utts.length) === utt.length && await t.ev(() => !!S.cur.minutes), 'mở lại đủ lời thoại và biên bản'); await t.close(); },

  'đóng app giữa chừng: lấy lại kết quả, không tải lên và trả tiền lần hai': async () => { let done = false;
    const t = await open({poll: () => done ? {id:'t1', status:'completed', audio_duration:120, utterances: fakeUtterances(2)} : {id:'t1', status:'processing'}}), p = t.page;
    await t.firstRun(); await t.newMeeting({title:'Họp dở'}); await t.until(() => document.querySelector('#steps li[data-s="tr"]').className === 'on', 'bắt đầu chuyển chữ');
    for (let i = 0; i < 3; i++){ await p.clock.fastForward(5200); await p.waitForTimeout(30); } ok(t.calls.poll >= 1, 'đã hỏi kết quả');
    await p.reload(); await t.unlock(); ok(await t.visible('#meetList .card.warnc') && (await p.textContent('#meetList')).includes('Họp dở'), 'danh sách báo có cuộc họp dở');
    done = true; await p.click('#meetList button:has-text("Lấy kết quả")'); await t.until(() => S.screen === 'scrMeet', 'lấy lại kết quả');
    ok(t.calls.upload === 1 && t.calls.create.length === 1, 'không tải lên / tạo việc lần hai'); await t.until(() => localStorage.getItem('bb_job') === null, 'đã xoá bản trên máy chủ', 10);
    ok(t.calls.del === 1, 'gửi lệnh xoá đúng 1 lần'); await p.reload(); await t.unlock();
    ok(await t.ev(() => S.all.length) === 1 && !(await t.visible('#meetList .card.warnc')), 'còn đúng 1 cuộc họp, hết báo dở'); await t.close(); },

  'mạng chập chờn khi chờ kết quả: tự thử lại': async () => { const t = await open({pollFail: n => n <= 2}); await t.firstRun(); await t.process({title:'Mạng yếu'});
    ok(t.calls.create.length === 1 && t.calls.poll >= 3, 'thử lại việc hỏi kết quả, không tạo việc mới'); await t.close(); },

  'tuỳ chọn phụ bị từ chối: bỏ dần rồi gửi lại': async () => {
    const t = await open({create: b => b.keyterms_prompt ? {status:400, json:{error:'keyterms_prompt is not supported for this model'}} : {json:{id:'t1', status:'queued'}}});
    await t.firstRun(); await t.process({title:'Tuỳ chọn', people:'anh Minh', speakers:2});
    ok(t.calls.create.length === 2 && !t.calls.create[1].keyterms_prompt && !!t.calls.create[1].speaker_options, 'lần hai bỏ keyterms, giữ khoảng số người nói'); await t.close(); },

  'file không có lời nói: báo lỗi rõ, dọn máy chủ': async () => { const t = await open({poll: () => ({id:'t1', status:'completed', audio_duration:5, utterances:[], text:''})}), p = t.page;
    await t.firstRun(); await t.newMeeting({title:'Im lặng'}); await t.until(() => document.getElementById('workErr').textContent.length > 0, 'báo lỗi');
    ok((await p.textContent('#workErr')).includes('Không nhận ra lời nói'), 'thông báo không có lời nói'); await t.until(() => localStorage.getItem('bb_job') === null, 'dọn máy chủ', 10);
    ok(t.calls.del === 1 && await t.ev(() => S.all.length) === 0, 'đã gửi lệnh xoá, không tạo cuộc họp rỗng'); await t.close(); },

  'chế độ tự động (AssemblyAI): chia phần, gộp, không giật màn hình khi đang ghi âm': async () => {
    const llm = async body => { const c = body.messages[0].content; await new Promise(r => setTimeout(r, 400));
      ok(c.includes('không đặt trong khối mã') && !c.includes('ĐỊNH DẠNG TRẢ LỜI'), 'chế độ tự động phải xin JSON trần');
      const out = c.includes('GHI CHÚ CÁC PHẦN') ? MINUTES : c.includes('của lời thoại') ? {diem_chinh:[{chu_de:'p', noi_dung:'q', ket_luan:''}]} : MINUTES;
      return {json:{choices:[{message:{content: JSON.stringify(out)}}]}}; };
    const t = await open({utterances: fakeUtterances(15), llm}), p = t.page; await t.firstRun('aai'); await t.process({title:'Họp tự động'});
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes');   // bắt đầu viết tự động (nhiều phần)
    await p.click('#btnBack'); await p.click('#btnNew'); await p.click('#btnRec'); await t.until(() => S.rec === true, 'bắt đầu ghi âm', 5);
    await t.until(() => S.all.some(m => m.minutes), 'viết xong ở nền', 60, 200);
    ok(await t.ev(() => S.screen) === 'scrNew' && await t.visible('#btnStop'), 'viết xong không được tự nhảy khỏi màn ghi âm');
    ok(t.calls.llm.length >= 3, 'họp 15 phút phải chia nhiều phần rồi gộp, thực tế ' + t.calls.llm.length + ' lượt gọi');
    await p.click('#btnStop'); await t.until(() => !!S.audio && !S.rec, 'dừng ghi âm', 5); ok(await t.visible('.filechip'), 'dừng xong có file ghi âm'); await t.close(); },

  'khoá app: xoá hết nội dung đã giải mã khỏi màn hình và bộ nhớ': async () => { const t = await open(), p = t.page; await t.firstRun(); await t.process({title:'Họp mật'}); await t.claudeGen();
    await p.click('#btnMinutes'); await p.waitForTimeout(150);   // để lại một yêu cầu đang chờ
    await p.click('#btnBack'); await p.click('#btnSettings'); await p.click('#btnLock');
    const left = await t.ev(() => ({html: document.body.innerHTML, n: S.all.length, key: S.apiKey, v: [...document.querySelectorAll('input,textarea')].map(e => e.value).join('')}));
    ok(!left.html.includes('rà soát tiến độ') && !left.html.includes(MINUTES.tom_tat) && !left.html.includes('Họp mật'), 'không còn lời thoại / biên bản / tên họp trong trang');
    ok(left.n === 0 && left.key === '' && !left.v.includes('khoa-thu') && !left.v.includes('rà soát'), 'không còn dữ liệu trong bộ nhớ và ô nhập');
    await t.unlock(); await p.click('.mcard'); ok(await t.visible('#claudeBox'), 'mở khoá lại vẫn còn khung chờ Claude');
    // tự khoá sau 10 phút ở nền
    await t.ev(() => { Object.defineProperty(document, 'hidden', {configurable:true, get: () => true}); document.dispatchEvent(new Event('visibilitychange')); });
    await p.clock.fastForward(11 * 60 * 1000);
    await t.ev(() => { Object.defineProperty(document, 'hidden', {configurable:true, get: () => false}); document.dispatchEvent(new Event('visibilitychange')); });
    ok(await t.ev(() => S.screen) === 'scrLock' && await t.ev(() => S.key === null), 'tự khoá sau 10 phút'); await t.close(); },

  'xoá toàn bộ: chỉ xoá dữ liệu của app này': async () => { const t = await open(), p = t.page; await t.firstRun(); await t.process({title:'Sắp xoá'});
    await t.ev(() => localStorage.setItem('app_khac', 'giu-lai')); await p.click('#btnBack'); await p.click('#btnSettings'); await p.click('#btnWipe'); await p.click('#btnWipe');
    await t.until(() => S.screen === 'scrLock', 'về màn tạo mã PIN', 5);
    ok(await t.ev(() => localStorage.getItem('app_khac')) === 'giu-lai' && await t.ev(() => localStorage.getItem('bb_salt')) === null, 'giữ dữ liệu trang khác, xoá dữ liệu app');
    ok((await p.textContent('#lockTitle')) === 'Tạo mã PIN', 'quay về tạo mã PIN mới'); await t.firstRun(); ok(await t.ev(() => S.all.length) === 0, 'không còn cuộc họp nào'); await t.close(); },

  'dữ liệu lưu bằng bản cũ mở được bằng bản mới': async () => { if (!srv.hasOld) return 'BỎ QUA (không có lịch sử git của bản cũ)';
    const t = await open({path:'__old/'}), p = t.page; await t.firstRun(); await t.process({title:'Họp bản cũ'}); await t.claudeGen();
    await p.fill('#confirmCard .cx input', '28/11/2026'); await p.click('#confirmCard .cx button.primary'); await p.waitForTimeout(200);
    await p.goto(srv.url); await t.unlock(); ok(await t.ev(() => S.all.length) === 1, 'bản mới thấy cuộc họp của bản cũ'); await p.click('.mcard');
    ok(await t.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat && (await p.textContent('#btnApply')).includes('(1)') && await t.visible('#btnApply'), 'biên bản và xác nhận đang chờ còn nguyên');
    await p.click('#btnApply'); await p.waitForTimeout(150); ok((await t.clip()).includes('28/11/2026'), 'tiếp tục cập nhật được bằng bản mới'); await t.close(); },
};

(async () => {
  const only = process.argv.slice(2); srv = await serve();
  browser = await chromium.launch({args:['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)){
    if (only.length && !only.some(k => name.includes(k))) continue;
    const t0 = Date.now();
    try{ const note = await fn(); console.log(`ĐẠT   ${name}${note ? ' — ' + note : ''} (${((Date.now() - t0)/1000).toFixed(1)}s)`); }
    catch(e){ failed++; console.log(`HỎNG  ${name}\n      ${String(e.message).split('\n')[0]}`); }
  }
  await browser.close(); srv.close();
  console.log(failed ? `\n${failed} bài HỎNG` : '\nTất cả đều ĐẠT'); process.exit(failed ? 1 : 0);
})();
