// Bộ kiểm thử đầu-cuối cho app Biên bản họp.
// Chạy:  node tests/e2e.js            (chạy hết)      node tests/e2e.js lock wipe   (chỉ các bài có tên chứa từ khoá)
// Cần Playwright + Chromium. Không gọi dịch vụ thật: AssemblyAI được giả lập, câu trả lời của Claude do bài thử tự viết.
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OLD_COMMIT = '2a6a1bb';   // bản trước đợt rà soát 11/2026: dùng để thử "dữ liệu cũ mở được bằng bản mới"
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.wav':'audio/wav', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8'};
const ExcelJS = require(path.join(ROOT, 'exceljs.min.js'));
const artifact = require(path.join(ROOT, 'tools/build-artifact.js'));
// "Vỏ" mà Claude bọc quanh trang Artifact khi phát hành (theo quy định Artifact): dùng để chạy thử bản trong Claude ở /__claude/
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

function serve(){
  let old = null; try{ old = cp.execFileSync('git', ['-C', ROOT, 'show', OLD_COMMIT + ':index.html'], {stdio:['ignore','pipe','ignore']}); }catch(e){}
  const st = {down: false, version: null};   // down: giả mất mạng. version: giả như vừa phát hành một bản mới
  return new Promise(res => { const s = http.createServer((q, r) => {
    if (st.down) return q.socket.destroy();
    let p = decodeURIComponent(q.url.split('?')[0]); const isOld = p.startsWith('/__old/'); if (isOld) p = p.slice(6);
    const inClaude = p.startsWith('/__claude/'); if (inClaude) p = p.slice(9);
    if (p.endsWith('/')) p += 'index.html';
    if (inClaude && p === '/index.html'){ r.writeHead(200, {'content-type': MIME['.html']});
      return r.end(SKELETON + artifact.build(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) + '</body></html>'); }
    if (isOld && p === '/index.html'){ if (!old){ r.writeHead(404); return r.end(); } r.writeHead(200, {'content-type': MIME['.html']}); return r.end(old); }
    const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end(); }
    if (st.version && p === '/index.html'){ r.writeHead(200, {'content-type': MIME['.html']});
      return r.end(fs.readFileSync(f, 'utf8').replace(/APP_VERSION = "[^"]+"/, `APP_VERSION = "${st.version}"`)); }
    r.writeHead(200, {'content-type': MIME[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
    s.listen(0, '127.0.0.1', () => res(Object.assign(st, {url: 'http://127.0.0.1:' + s.address().port + '/', hasOld: !!old, close: () => s.close()}))); });
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
const flat = ws => { const out = []; ws.eachRow(r => r.eachCell(c => out.push(String(c.value)))); return out.join('|'); };

// Giả lập môi trường chạy của trang Artifact (window.claude) theo đúng hợp đồng 0.2.96: kho db (tài liệu tối đa 256 KiB, đường dẫn chẵn/lẻ,
// không có giao dịch), user, sample, downloads; không đọc được bộ nhớ tạm. Dữ liệu kho được giữ qua các lần tải lại trang.
function claudeStub(opts){
  if (!location.pathname.startsWith('/__claude/')) return;
  const KEY = '__claude_db'; let store = {}; try{ store = JSON.parse(localStorage.getItem(KEY) || '{}'); }catch(e){}
  const persist = () => localStorage.setItem(KEY, JSON.stringify(store));
  const T = window.__stub = {store, writes: [], fail: {}, opts};
  const err = (code, message) => ({code, message});
  const segOK = x => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(x) && x !== '.' && x !== '..';
  const check = (p, even) => { const seg = String(p).split('/'); if (!seg.every(segOK) || seg.length > 16 || (seg.length % 2 === 0) !== even) throw new TypeError('đường dẫn kho không hợp lệ: ' + p); };
  const meta = {fromCache: false, hasPendingWrites: false};
  const snapOf = p => { const body = store[p]; return {id: p.split('/').pop(), exists: body !== undefined, metadata: meta,
    data: () => body === undefined ? undefined : Object.freeze(JSON.parse(JSON.stringify(body)))}; };
  const doc = p => { check(p, true); return {id: p.split('/').pop(), path: p,
    get: async () => { if (T.fail.read) throw err('unavailable', 'store unavailable'); return snapOf(p); },
    set: async data => { if (T.fail.write) throw err('unavailable', 'store unavailable');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw err('invalid_argument', 'body must be an object');
      const j = JSON.stringify(data); if (new TextEncoder().encode(j).length > 262144) throw err('invalid_argument', 'document over 256 KiB');
      store[p] = JSON.parse(j); T.writes.push(p); persist(); },
    update: async data => { if (store[p] === undefined) throw err('invalid_argument', 'no such document'); store[p] = {...store[p], ...JSON.parse(JSON.stringify(data))}; T.writes.push(p); persist(); },
    delete: async () => { if (T.fail.write) throw err('unavailable', 'store unavailable'); delete store[p]; persist(); },
    collection: name => col(p + '/' + name)}; };
  const col = (p, lim = 1000) => { check(p, false); return {path: p, doc: id => doc(p + '/' + (id || crypto.randomUUID())), limit: n => col(p, n),
    get: async () => { if (T.fail.read) throw err('unavailable', 'store unavailable'); const pre = p + '/';
      const docs = Object.keys(store).filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).sort().slice(0, lim).map(snapOf);
      return {docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta}; }}; };
  const sample = Object.assign(async (input, o = {}) => { const r = await window.__sample(input);
      if (r.error) throw err(r.error, 'stub: ' + r.error); if (o.onText) o.onText({text: r.text, delta: r.text});
      return {text: r.text, truncated: !!r.truncated, modelTierApplied: 'default'}; }, {limits: async () => ({maxPromptBytes: 262144})});
  const downloads = {save: async ({filename, data}) => { const u = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data); let bin = '';
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      if (await window.__save(filename, btoa(bin)) === 'declined') throw err('declined', 'viewer declined'); return {status: 'saved'}; }};
  const caps = {db: opts.noDb ? null : Object.freeze({doc, collection: p => col(p)}), sample: opts.noSample ? null : sample, downloads: Object.freeze(downloads),
    user: Object.freeze({id: async () => opts.noUser ? null : 'u_thu0000000000000000000', isOwner: async () => true, canEdit: async () => true})};
  window.claude = Object.freeze({use: name => Promise.resolve(caps[name] || null)});
  try{ navigator.clipboard.readText = () => Promise.reject(new DOMException('khung Artifact không cho đọc bộ nhớ tạm', 'NotAllowedError')); }catch(e){}
}

let browser, srv;
// Mở app trong một "điện thoại" mới tinh.
// opts: utterances, duration, poll(n), pollFail(n), create(body,n), llm(body,n), path, uploadHold(), remote[{id, audio_url}], delFail(id)
//       ctx (dùng lại "điện thoại" của một lượt open trước), claude {noDb, noUser, noSample} (mở bản chạy trong Claude), sample(input, n), save(filename, base64)
async function open(opts = {}){
  const ctx = opts.ctx || await browser.newContext({viewport:{width:390, height:844}, permissions:['clipboard-read','clipboard-write','microphone']});
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const saved = [], prompts = [];
  if (opts.claude){ opts.path = '__claude/';
    await page.exposeFunction('__sample', async input => { prompts.push(input); try{ return await (opts.sample ? opts.sample(input, prompts.length) : {text: JSON.stringify(MINUTES)}); }catch(e){ errors.push('giả lập Claude: ' + e.message); return {error: 'upstream_error'}; } });
    await page.exposeFunction('__save', async (filename, b64) => { if (opts.save) { const r = await opts.save(filename, b64); if (r) return r; } saved.push({filename, data: Buffer.from(b64, 'base64')}); return 'saved'; });
    await page.addInitScript(claudeStub, opts.claude === true ? {} : opts.claude); }
  // Trang không được gọi ra bên ngoài ngoài AssemblyAI, và không được vi phạm chính sách bảo mật nội dung (CSP) của chính nó
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 200)); });
  page.on('request', q => { const u = q.url();
    const claudeOK = page.url().includes('/__claude/') && /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs\/4\.4\.0\/|cdn\.jsdelivr\.net\/npm\/exceljs@4\.4\.0\/)/.test(u);   // nguồn Claude cho phép
    if (!u.startsWith(srv.url) && !/^https:\/\/(api|llm-gateway)\.assemblyai\.com\//.test(u) && !/^(blob|data):/.test(u) && !page.url().includes('/__old/') && !claudeOK) errors.push('gọi ra ngoài: ' + u);
    if (page.url().includes('/__claude/') && /assemblyai/.test(u)) errors.push('bản trong Claude không được gọi AssemblyAI: ' + u); });
  const calls = {upload:0, create:[], poll:0, del:0, llm:[], list:0, cdn:[]};
  const remote = (opts.remote || []).map(x => ({...x}));   // các bản chép lời "đang nằm trên máy chủ AssemblyAI", mới trước
  await page.route('https://api.assemblyai.com/**', async r => { const u = r.request().url(), m = r.request().method();
    if (u.includes('/v2/upload')){ calls.upload++; if (opts.uploadHold) await opts.uploadHold(); return r.fulfill({json:{upload_url:'https://cdn.assemblyai.com/upload/x'}}); }
    if (m === 'POST' && u.endsWith('/v2/transcript')){ const body = JSON.parse(r.request().postData()); calls.create.push(body);
      return r.fulfill(opts.create ? opts.create(body, calls.create.length) : {json:{id:'t1', status:'queued'}}); }
    if (m === 'DELETE'){ calls.del++; const id = u.split('/').pop(); if (opts.delFail && opts.delFail(id)) return r.fulfill({status:500, json:{error:'máy chủ bận'}});
      const it = remote.find(x => x.id === id); if (it) it.audio_url = 'http://deleted_by_user';   // bản đã xoá chỉ còn "vỏ"
      return r.fulfill({json:{}}); }
    if (m === 'GET' && u.includes('/v2/transcript/t1')){ calls.poll++;
      if (opts.pollFail && opts.pollFail(calls.poll)) return r.abort('failed');
      return r.fulfill({json: opts.poll ? opts.poll(calls.poll) : {id:'t1', status:'completed', audio_duration: opts.duration || 600, utterances: opts.utterances || fakeUtterances(2)}}); }
    // Danh sách: mỗi trang 2 bản, prev_url trỏ tới trang cũ hơn (như AssemblyAI)
    calls.list++; const from = +(new URL(u).searchParams.get('skip') || 0), rows = remote.slice(from, from + 2);
    return r.fulfill({json:{transcripts: rows, page_details:{limit:2, result_count: rows.length,
      prev_url: from + 2 < remote.length ? 'https://api.assemblyai.com/v2/transcript?limit=200&skip=' + (from + 2) : null}}}); });
  await page.route('https://llm-gateway.assemblyai.com/**', async r => { const body = JSON.parse(r.request().postData()); calls.llm.push(body);
    try{ return await r.fulfill(opts.llm ? await opts.llm(body, calls.llm.length) : {status:500, json:{}}); }catch(e){ errors.push('giả lập AI: ' + e.message); return r.fulfill({status:500, json:{}}); } });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({status:200, contentType:'text/css', body:''}));   // bản cũ (bài thử dữ liệu cũ) và bản trong Claude gọi
  // Bản trong Claude lấy thư viện Excel từ cdnjs (dự phòng jsDelivr) kèm mã băm: trả về chính file trong kho, có CORS như CDN thật
  const cdn = name => async r => { calls.cdn.push(name); if (opts.cdnFail && opts.cdnFail(name)) return r.abort('failed');
    return r.fulfill({status:200, contentType:'text/javascript', headers:{'access-control-allow-origin':'*'}, body: opts.cdnBody ? opts.cdnBody(name) : fs.readFileSync(path.join(ROOT, 'exceljs.min.js'))}); };
  await page.route('https://cdnjs.cloudflare.com/**', cdn('cdnjs')); await page.route('https://cdn.jsdelivr.net/**', cdn('jsdelivr'));
  await page.clock.install();   // đồng hồ giả: tua nhanh các khoảng chờ 5 giây của app
  await page.goto(srv.url + (opts.path || ''));
  const t = {ctx, page, errors, calls, saved, prompts,
    ev: (fn, arg) => page.evaluate(fn, arg),
    visible: sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]'); }, sel),
    pin: async d => { for (const c of d) await page.click(`#keypad button:text-is("${c}")`); },
    unlock: async (pin = '123456') => { await t.pin(pin); await page.click('#btnUnlock'); await t.until(() => S.screen && S.screen !== 'scrLock' && (S.screen !== 'scrHome' || S.loaded), 'mở khoá'); },
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
    // Bấm nút và chờ dòng báo ở màn mã PIN
    pinErr: async (digits, text) => { await t.pin(digits); await page.click('#btnUnlock');
      await t.until(new Function(`return document.getElementById('lockErr').textContent.includes(${JSON.stringify(text)})`), 'dòng báo: ' + text, 40); },
    // Đổi mã PIN từ màn Cài đặt (không chờ kết quả)
    changePin: async (oldPin, newPin) => { await page.click('#btnChangePin'); await t.pin(oldPin); await page.click('#btnUnlock'); await t.until(() => PIN.stage === 2, 'qua bước nhập mã hiện tại', 40);
      await t.pin(newPin); await page.click('#btnUnlock'); await t.pin(newPin); await page.click('#btnUnlock'); },
    excel: async () => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExcel')]);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(fs.readFileSync(await dl.path())); return {dl, wb}; },
    // Bản trong Claude: tạo mã PIN lần đầu (không có bước dán khoá API)
    firstRunClaude: async (pin = '135790') => { await t.until(() => S.screen === 'scrLock', 'kết nối kho Claude', 20); await t.pin(pin); await page.click('#btnUnlock'); await t.pin(pin); await page.click('#btnUnlock');
      await t.until(() => S.screen === 'scrHome' && S.loaded, 'vào danh sách trong Claude', 40); },
    // Bản trong Claude: dán gói cuộc họp rồi bấm Thêm
    importPkg: async pkg => { await page.click('#btnNew'); await page.fill('#impText', pkg); await page.click('#btnImport'); await t.until(() => S.screen === 'scrMeet', 'thêm cuộc họp vào Claude', 40); },
    shown: sel => page.evaluate(x => { const e = document.querySelector(x); return !!e && e.getClientRects().length > 0; }, sel),   // thật sự đang hiện trên màn hình
    done: () => ok(!errors.length, 'lỗi trên trang: ' + errors.join(' | ')),
    close: async () => { await ctx.close(); ok(!errors.length, 'lỗi trên trang: ' + errors.join(' | ')); }};
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
    ok(/Ngày họp: \d\d\/\d\d\/\d{4} \((thứ \S+|Chủ nhật)\)/.test(prompt) && prompt.includes('ngày cụ thể'), 'yêu cầu có thứ trong tuần của ngày họp để tính hạn');
    ok(prompt.includes('NGÔN NGỮ CỦA BIÊN BẢN') && prompt.includes('deadline → hạn chót') && prompt.includes('văn phong công sở') && !prompt.includes('giữ thuật ngữ tiếng Anh'), 'yêu cầu dặn viết thống nhất bằng tiếng Việt, dịch từ tiếng Anh');
    await p.click('#cbPaste'); await p.waitForTimeout(300);   // bộ nhớ tạm vẫn là yêu cầu
    ok((await p.textContent('#minErr')).includes('vẫn là yêu cầu') && await t.ev(() => S.cur.minutes === null), 'dán nhầm yêu cầu phải bị chặn, không tạo biên bản rác');
    await t.setClip(JSON.stringify({bien_ban: MINUTES})); await p.click('#cbPaste'); await t.until(() => !!S.cur.minutes, 'nhập kết quả bọc trong bien_ban');
    ok(await t.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat && !(await t.visible('#claudeBox')) && await t.ev(() => !S.cur.cho), 'nhập xong thì đóng khung Claude');
    // Có biên bản rồi: nút chính (màu hồng) là Tải Excel; Tạo lại phải bấm hai lần
    ok(await t.ev(() => document.getElementById('btnExcel').classList.contains('primary') && !document.getElementById('btnMinutes').classList.contains('primary')), 'có biên bản thì nút chính là Tải Excel');
    await p.click('#btnMinutes'); ok((await p.textContent('#btnMinutes')).includes('Bấm lần nữa') && !(await t.visible('#claudeBox')) && await t.ev(() => !S.cur.cho), 'Tạo lại: lần bấm đầu chỉ hỏi lại');
    await p.clock.fastForward(4200); ok((await p.textContent('#btnMinutes')) === 'Tạo lại biên bản', 'không bấm tiếp thì nút trở lại như cũ');
    const {dl, wb} = await t.excel(); ok(wb.worksheets.map(w => w.name).join('|') === 'Biên bản|Đầu việc|Kế hoạch tiếp theo|Lời thoại', 'đủ 4 trang tính');
    const bb = flat(wb.getWorksheet('Biên bản'));
    ok(bb.includes(MINUTES.tom_tat) && bb.includes('CẦN XÁC NHẬN LẠI') && !bb.includes('LỊCH SỬ CHỈNH SỬA'), 'Excel: có tóm tắt, không in mục trống');
    const lt = wb.getWorksheet('Lời thoại'), dv = wb.getWorksheet('Đầu việc');
    ok(lt.getCell('B2').value === 'Anh Minh' && dv.getCell('B2').value === 'Gửi report' && dv.getCell('F2').value === 'Chưa làm', 'Excel: lời thoại ghi tên thật, đầu việc đúng cột');
    ok(lt.getCell('A1').font.bold === true && lt.views[0].state === 'frozen' && lt.views[0].ySplit === 1 && lt.getCell('C2').alignment.wrapText === true && dv.getCell('B1').fill.fgColor.argb === 'FFFDE6EE',
      'Excel: dòng tiêu đề in đậm, có nền, được cố định; chữ dài tự xuống dòng');
    ok(await t.ev(() => document.fonts.ready.then(() => document.fonts.check('16px "Be Vietnam Pro"') && document.fonts.check('700 20px "Quicksand"'))), 'phông chữ tải từ chính app');
    ok(!(await t.visible('#updBar')), 'không báo "có bản mới" khi máy chủ vẫn là bản đang chạy');
    ok(/^BienBan_\d{4}-\d\d-\d\d_Hop-thu\.xlsx$/.test(dl.suggestedFilename()), 'tên file Excel');
    await p.click('#btnBack'); await p.click('#btnSettings'); ok(/^Phiên bản \d{4}\.\d+\.\d+/.test(await p.textContent('#appVer')), 'Cài đặt hiện số phiên bản'); await t.close(); },

  'xác nhận: lưu nháp, cập nhật qua Claude sau khi app tải lại, hoàn tác, sửa đầu việc': async () => { const t = await open(), p = t.page; await t.firstRun();
    await t.process({title:'Họp xác nhận'}); await t.claudeGen();
    await p.fill('#confirmCard .cx input', '30/11/2026'); await p.clock.fastForward(800); await p.waitForTimeout(100);
    await p.click('#btnBack'); await p.click('.mcard'); ok(await p.inputValue('#confirmCard .cx input') === '30/11/2026', 'chữ gõ dở được giữ');
    await p.click('#confirmCard .cx button.primary'); await p.waitForTimeout(150); ok((await p.textContent('#btnApply')).includes('(1)') && await t.visible('#btnApply'), 'có 1 xác nhận chờ cập nhật');
    await p.click('#btnApply'); await p.waitForTimeout(150); const ap = await t.clip(); ok(ap.includes('30/11/2026') && ap.includes('ĐỊNH DẠNG TRẢ LỜI') && ap.includes('văn phong công sở') && !ap.includes('LỜI THOẠI:'), 'yêu cầu cập nhật có nội dung xác nhận, quy tắc ngôn ngữ, không kèm lời thoại');
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
    const t = await open({remote: [{id:'t1', audio_url:'https://cdn.assemblyai.com/upload/x'}],
      poll: () => done ? {id:'t1', status:'completed', audio_duration:120, utterances: fakeUtterances(2)} : {id:'t1', status:'processing'}}), p = t.page;
    await t.firstRun(); await t.newMeeting({title:'Họp dở'}); await t.until(() => document.querySelector('#steps li[data-s="tr"]').className === 'on', 'bắt đầu chuyển chữ');
    for (let i = 0; i < 3; i++){ await p.clock.fastForward(5200); await p.waitForTimeout(30); } ok(t.calls.poll >= 1, 'đã hỏi kết quả');
    await p.reload(); await t.unlock(); ok(await t.visible('#meetList .card.warnc') && (await p.textContent('#meetList')).includes('Họp dở'), 'danh sách báo có cuộc họp dở');
    await p.click('#btnSettings'); await p.click('#btnScan'); await t.until(() => document.getElementById('scanStatus').textContent.includes('Chưa tính cuộc họp đang chuyển'), 'quét máy chủ khi có việc dở', 10);
    ok(!(await t.visible('#btnPurge')), 'bản đang chuyển dở không bị đưa vào danh sách xoá'); await p.click('#btnBack');
    done = true; await p.click('#meetList button:has-text("Lấy kết quả")'); await t.until(() => S.screen === 'scrMeet', 'lấy lại kết quả');
    ok(t.calls.upload === 1 && t.calls.create.length === 1, 'không tải lên / tạo việc lần hai'); await t.until(() => localStorage.getItem('bb_job') === null, 'đã xoá bản trên máy chủ', 10);
    ok(t.calls.del === 1, 'gửi lệnh xoá đúng 1 lần'); await p.reload(); await t.unlock();
    ok(await t.ev(() => S.all.length) === 1 && !(await t.visible('#meetList .card.warnc')), 'còn đúng 1 cuộc họp, hết báo dở'); await t.close(); },

  'mạng chập chờn khi chờ kết quả: tự thử lại': async () => { const t = await open({pollFail: n => n <= 2}); await t.firstRun(); await t.process({title:'Mạng yếu'});
    ok(t.calls.create.length === 1 && t.calls.poll >= 3, 'thử lại việc hỏi kết quả, không tạo việc mới'); await t.close(); },

  'tuỳ chọn phụ bị từ chối: bỏ dần rồi gửi lại': async () => {
    const t = await open({create: b => b.keyterms_prompt ? {status:400, json:{error:'keyterms_prompt is not supported for this model'}} : {json:{id:'t1', status:'queued'}}});
    await t.firstRun(); await t.process({title:'Tuỳ chọn', people:'anh Minh', speakers:2});
    ok(t.calls.create.length === 2 && !t.calls.create[1].keyterms_prompt && !!t.calls.create[1].speaker_options, 'lần hai bỏ keyterms, giữ khoảng số người nói');
    const info = await t.page.textContent('#sttInfo'); ok(info.includes('khoảng số người nói') && !info.includes('tên riêng'), 'tab Người nói cho biết gợi ý nào đã được nhận: ' + info); await t.close(); },

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
    await p.click('#btnMinutes'); await p.click('#btnMinutes'); await p.waitForTimeout(150);   // tạo lại (bấm hai lần): để lại một yêu cầu đang chờ
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
    await p.click('#btnApply'); await p.waitForTimeout(150); ok((await t.clip()).includes('28/11/2026'), 'tiếp tục cập nhật được bằng bản mới');
    ok(await t.ev(() => localStorage.getItem('bb_kdf')) === null, 'dữ liệu cũ vẫn mở bằng cách tính khoá cũ');
    await p.click('#btnBack'); await p.click('#btnSettings'); await t.changePin('123456', '24681357'); await t.until(() => S.screen === 'scrSettings', 'đổi mã PIN xong', 60);
    ok(await t.ev(() => localStorage.getItem('bb_kdf')) === '600000', 'đổi mã PIN thì chuyển sang 600.000 vòng');
    await p.reload(); await t.unlock('24681357'); await p.click('.mcard');
    ok(await t.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat && await t.visible('#claudeBox'), 'sau khi đổi mã PIN, dữ liệu cũ và yêu cầu đang chờ còn nguyên'); await t.close(); },

  'đổi mã PIN: mã cũ hết dùng được, dữ liệu và khoá API còn nguyên': async () => { const t = await open(), p = t.page; await t.firstRun(); await t.process({title:'Họp đổi mã'}); await t.claudeGen();
    ok(await t.ev(() => localStorage.getItem('bb_kdf')) === '600000', 'mã PIN mới tạo dùng 600.000 vòng');
    await p.click('#btnBack'); await p.click('#btnSettings'); await p.click('#btnChangePin');
    ok((await p.textContent('#lockTitle')) === 'Đổi mã PIN' && await t.visible('#btnPinCancel'), 'màn đổi mã có nút Huỷ'); await p.click('#btnPinCancel'); ok(await t.ev(() => S.screen) === 'scrSettings', 'Huỷ thì về Cài đặt');
    await p.click('#btnChangePin'); await t.pinErr('999999', 'Sai mã PIN');
    await t.pin('123456'); await p.click('#btnUnlock'); await t.until(() => PIN.stage === 2, 'nhập đúng mã hiện tại', 40);
    await t.pinErr('2468', 'ít nhất 6 số'); await t.pin('1357'); await p.click('#btnUnlock'); ok(await t.ev(() => PIN.stage) === 3, 'sang bước nhập lại');
    await t.pinErr('11111111', 'không giống nhau'); ok(await t.ev(() => PIN.stage) === 2 && await t.ev(() => !!localStorage.getItem('bb_salt') && !localStorage.getItem('bb_next')), 'nhập lệch thì chưa đổi gì');
    await t.pin('24681357'); await p.click('#btnUnlock'); await t.pin('24681357'); await p.click('#btnUnlock'); await t.until(() => S.screen === 'scrSettings', 'đổi mã PIN xong', 60);
    ok(await t.ev(() => !localStorage.getItem('bb_next')), 'không còn dấu vết đổi dở');
    await p.reload(); await t.pinErr('123456', 'Sai mã PIN'); await t.unlock('24681357');
    ok(await t.ev(() => S.all.length === 1 && !!S.all[0].minutes && S.apiKey === 'khoa-thu'), 'mã mới mở được: còn cuộc họp, biên bản, khoá API'); await t.close(); },

  'đổi mã PIN bị dừng giữa chừng: không mất dữ liệu, app chỉ cho biết phải nhập mã nào': async () => { const t = await open(), p = t.page; await t.firstRun(); await t.process({title:'Họp giữ nguyên'});
    // A) app bị đóng sau khi ghi "thông tin mở khoá kế tiếp" nhưng TRƯỚC khi dữ liệu được mã hoá lại
    await t.ev(() => { const real = window.tx; window.tx = (mode, fn) => mode === 'readwrite' ? new Promise(() => {}) : real(mode, fn); });
    await p.click('#btnBack'); await p.click('#btnSettings'); await t.changePin('123456', '24681357'); await t.until(() => !!localStorage.getItem('bb_next'), 'đã ghi thông tin kế tiếp', 60);
    await p.reload(); await t.pinErr('24681357', 'Hãy nhập mã PIN cũ'); await t.unlock('123456');
    ok(await t.ev(() => S.all.length === 1 && S.apiKey === 'khoa-thu' && !localStorage.getItem('bb_next')), 'A: mã cũ mở được, dữ liệu còn nguyên, dọn dấu vết đổi dở');
    // B) app bị đóng SAU khi dữ liệu đã được mã hoá lại nhưng trước khi chuyển hẳn sang mã mới
    const salt = await t.ev(() => localStorage.getItem('bb_salt'));
    await t.ev(() => { window.promoteNext = () => { throw new Error('app bị đóng giữa chừng'); }; });
    await p.click('#btnSettings'); await t.changePin('123456', '24681357'); await t.until(() => document.getElementById('lockErr').textContent.includes('app bị đóng'), 'dừng ở bước cuối', 60);
    ok(await t.ev(() => localStorage.getItem('bb_salt')) === salt && await t.ev(() => !!localStorage.getItem('bb_next')), 'B: thông tin mở khoá cũ còn đó, có thông tin kế tiếp');
    await p.reload(); await t.pinErr('123456', 'Hãy nhập mã PIN mới'); await t.unlock('24681357');
    ok(await t.ev(() => S.all.length === 1 && S.all[0].title === 'Họp giữ nguyên' && S.apiKey === 'khoa-thu' && !localStorage.getItem('bb_next')), 'B: mã mới mở được, dữ liệu và khoá API còn nguyên');
    ok(await t.ev(() => localStorage.getItem('bb_salt')) !== salt, 'B: đã chuyển hẳn sang mã mới'); await p.reload(); await t.unlock('24681357'); ok(await t.ev(() => S.all.length) === 1, 'lần mở sau vẫn bình thường'); await t.close(); },

  'dọn dữ liệu trên AssemblyAI: đếm bản còn sống qua nhiều trang, xoá, đếm lại': async () => {
    const remote = [5, 4, 3, 2, 1].map(n => ({id: 'r' + n, audio_url: n % 2 ? 'https://cdn.assemblyai.com/upload/' + n : 'http://deleted_by_user'}));
    let t = await open({remote}), p = t.page; await t.firstRun(); await p.click('#btnSettings'); const before = t.calls.list;
    await p.click('#btnScan'); await t.until(() => document.getElementById('scanStatus').textContent.includes('Còn 3 bản'), 'đếm được 3 bản còn sống', 10);
    ok(t.calls.list - before === 3, 'đọc hết 3 trang danh sách, thực tế ' + (t.calls.list - before));
    await p.click('#btnPurge'); ok((await p.textContent('#btnPurge')).includes('Bấm lần nữa') && t.calls.del === 0, 'lần bấm đầu chỉ hỏi lại');
    await p.click('#btnPurge'); await t.until(() => document.getElementById('scanStatus').textContent.includes('Không còn bản chép lời nào'), 'xoá xong và đếm lại', 10);
    ok(t.calls.del === 3 && !(await t.visible('#btnPurge')), 'gửi đúng 3 lệnh xoá'); await t.close();
    t = await open({remote, delFail: id => id === 'r3'}); p = t.page; await t.firstRun(); await p.click('#btnSettings'); await p.click('#btnScan');
    await t.until(() => document.getElementById('scanStatus').textContent.includes('Còn 3 bản'), 'đếm lần hai', 10); await p.click('#btnPurge'); await p.click('#btnPurge');
    await t.until(() => /Còn 1 bản.*1 bản chưa xoá được/.test(document.getElementById('scanStatus').textContent), 'báo thật số bản chưa xoá được', 10); await t.close(); },

  'xác nhận toàn "Đúng rồi": app tự cập nhật, không cần nhờ Claude': async () => { const t = await open(), p = t.page; await t.firstRun(); await t.process({title:'Họp đúng hết'}); await t.claudeGen();
    await p.click('#confirmCard .cx button.primary'); await p.waitForTimeout(150); ok((await p.textContent('#btnApply')).includes('(1)') && await t.ev(() => document.getElementById('btnApply').classList.contains('primary')), 'nút chính là Cập nhật biên bản');
    await t.setClip('giữ nguyên'); await p.click('#btnApply'); await t.until(() => S.cur.minutes.viec_theo_doi[0].han === 'cuối tháng', 'tự bỏ nhãn cần xác nhận', 10);
    ok(!(await t.visible('#claudeBox')) && (await t.clip()) === 'giữ nguyên' && await t.ev(() => !S.cur.cho && S.cur.minutes.can_xac_nhan[0].applied === true && S.cur.lich_su.length === 1), 'không mở khung Claude, không đụng bộ nhớ tạm, có ghi lịch sử');
    await p.click('#tab_min button:has-text("Hoàn tác")'); await p.waitForTimeout(200); ok(await t.ev(() => S.cur.minutes.viec_theo_doi[0].han.includes('[cần xác nhận]')), 'hoàn tác được');
    // Biên bản còn nhãn ở chỗ chưa được hỏi: không tự xoá, phải nhờ Claude
    await t.ev(() => { S.cur.minutes.ke_hoach[0].thoi_gian = 'Tuần sau [cần xác nhận]'; }); await p.click('#btnApply'); await p.waitForTimeout(200);
    ok(await t.visible('#claudeBox') && await t.ev(() => S.cur.cho && S.cur.cho.kind === 'apply' && S.cur.minutes.ke_hoach[0].thoi_gian.includes('[cần xác nhận]')), 'còn nhãn chưa được hỏi thì chuyển cho Claude'); await t.close(); },

  'thống nhất ngôn ngữ biên bản đã có: chỉ gửi biên bản, giữ đầu việc đã xong và xác nhận, hoàn tác được': async () => { const t = await open(), p = t.page; await t.firstRun();
    await t.process({title:'Họp lẫn tiếng Anh'}); await t.claudeGen();
    await p.click('.seg [data-tab="task"]'); await p.click('#tab_task .task >> nth=1 >> button.check'); await p.waitForTimeout(100);   // đánh dấu đầu việc thứ hai đã xong
    await p.click('.seg [data-tab="min"]'); await p.click('#confirmCard .cx button.primary'); await p.waitForTimeout(150);            // xác nhận "Đúng rồi", chưa cập nhật
    await p.click('#btnLang'); await p.waitForTimeout(150); const pr = await t.clip();
    ok(pr.includes('BIÊN BẢN HIỆN TẠI') && pr.includes('deadline → hạn chót') && pr.includes('ĐỊNH DẠNG TRẢ LỜI') && pr.includes(MINUTES.tom_tat), 'yêu cầu có biên bản hiện tại và quy tắc ngôn ngữ');
    ok(!pr.includes('LỜI THOẠI:') && !pr.includes('rà soát tiến độ kế hoạch'), 'yêu cầu không gửi lại lời thoại');
    ok((await p.textContent('#cbTitle')).includes('Thống nhất ngôn ngữ') && (await p.textContent('#cbCopyState')).includes('không kèm lời thoại'), 'khung Claude nói rõ đang làm gì');
    const vi = JSON.parse(JSON.stringify(MINUTES)); vi.tom_tat = 'Thống nhất gửi báo cáo cuối tháng.'; vi.diem_chinh[0] = {chu_de:'Báo cáo', noi_dung:'Báo cáo xong 70%.', ket_luan:'Gửi bản nháp trước thứ sáu'};
    vi.viec_theo_doi[0].cong_viec = 'Gửi báo cáo'; vi.viec_theo_doi[1].xong = false; vi.can_xac_nhan = ['Cuối tháng (hạn chót) là ngày nào?'];   // Claude trả về "xong" cũ: bản trên máy phải thắng
    await t.setClip(fenced({bien_ban: vi, thay_doi:['report → báo cáo', 'draft → bản nháp']})); await p.click('#cbPaste'); await t.until(() => S.cur.minutes.tom_tat.includes('báo cáo'), 'nhập bản đã thống nhất ngôn ngữ');
    ok(await t.ev(() => { const x = S.cur.minutes, q = x.can_xac_nhan[0];
      return x.viec_theo_doi[0].cong_viec === 'Gửi báo cáo' && x.viec_theo_doi[0].han.includes('[cần xác nhận]') && x.viec_theo_doi[1].xong === true
        && q.ok === true && q.applied !== true && q.noi_dung.includes('hạn chót') && q.thoi_diem === '00:00:10' && !S.cur.cho; }), 'lời văn được đổi; đầu việc đã xong, trạng thái xác nhận và mốc giờ giữ nguyên');
    ok(await t.ev(() => S.cur.lich_su[S.cur.lich_su.length - 1].thay_doi.join('|')) === 'report → báo cáo|draft → bản nháp' && (await p.textContent('#btnApply')).includes('(1)'), 'ghi lịch sử; xác nhận đang chờ vẫn còn');
    await p.click('#tab_min button:has-text("Hoàn tác")'); await p.waitForTimeout(200); ok(await t.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat, 'hoàn tác về bản trước');
    // Đang chờ Claude mà người dùng sửa nội dung: huỷ yêu cầu đang chờ, để kết quả cũ không ghi đè chỗ vừa sửa
    await p.click('#btnLang'); await p.waitForTimeout(150); ok(await t.visible('#claudeBox') && await t.ev(() => S.cur.cho.kind) === 'lang', 'đang chờ kết quả thống nhất ngôn ngữ');
    await p.click('.seg [data-tab="task"]'); await p.click('#tab_task .task >> nth=0 >> button:has-text("Sửa")');
    await p.fill('#tab_task .task >> nth=0 >> input[data-k="ghi_chu"]', 'vừa sửa'); await p.click('#tab_task .task >> nth=0 >> button:has-text("Lưu")'); await p.waitForTimeout(150);
    ok(await t.ev(() => !S.cur.cho && S.cur.minutes.viec_theo_doi[0].ghi_chu === 'vừa sửa') && !(await t.visible('#claudeBox')), 'sửa nội dung thì yêu cầu đang chờ bị huỷ'); await t.close(); },

  'một người bị tách thành hai nhãn: gõ cùng tên thì gộp': async () => { const t = await open(), p = t.page; await t.firstRun(); await t.process({title:'Họp bốn nhãn'});
    ok((await p.textContent('#vChips')).includes('4 người nói'), 'ban đầu 4 nhãn');
    await p.fill('#name_A', 'Anh Minh'); await p.fill('#name_C', ' anh minh'); await p.click('#btnSaveNames'); await p.waitForTimeout(150);
    ok((await p.textContent('#vChips')).includes('3 người nói') && (await p.textContent('#spkBox')).includes('đã gộp với Người A'), 'hai nhãn cùng tên được tính là một người');
    const bg = await t.ev(() => ['A', 'B', 'C'].map(s => document.getElementById('name_' + s).closest('.spkcard').querySelector('.av').style.background));
    ok(bg[0] === bg[2] && bg[0] !== bg[1], 'cùng người thì cùng màu: ' + bg.join(' / ')); await p.click('#btnBack'); ok((await p.textContent('.mcard')).includes('3 người'), 'danh sách cũng đếm 3 người'); await t.close(); },

  'tải file lên: có báo phần trăm': async () => { let release; const hold = new Promise(r => release = r);
    // 1) Trong app: nhãn bước 1 đổi theo tiến độ. Máy chủ giả lập không phát ra tiến độ, nên bài thử tự bắn một sự kiện tiến độ vào đúng lượt tải lên của app.
    const t = await open({uploadHold: () => hold}), p = t.page; await t.firstRun();
    await t.ev(() => { window.__up = []; const lb = document.getElementById('upLabel');
      new MutationObserver(() => window.__up.push(lb.textContent)).observe(lb, {childList:true, characterData:true, subtree:true});
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(body){ send.call(this, body); this.upload.dispatchEvent(new ProgressEvent('progress', {lengthComputable:true, loaded:37, total:100})); }; });
    await t.newMeeting({title:'Họp tải lên'}); await p.waitForTimeout(300); const seen = await t.ev(() => window.__up); release();
    await t.until(() => S.screen === 'scrMeet', 'chuyển thành chữ xong'); ok(seen.includes('Đang tải file ghi âm lên: 37%'), 'phải thấy phần trăm khi đang tải lên, thực tế: ' + JSON.stringify(seen));
    ok((await t.ev(() => document.getElementById('upLabel').textContent)) === 'Tải file ghi âm lên' && t.calls.upload === 1, 'xong thì nhãn trở lại bình thường'); await t.close();
    // 2) Tiến độ thật: chạy đúng hàm uploadAudio của app, tải 12 MB lên một máy chủ thật khác nguồn (có CORS như AssemblyAI)
    const fn = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/function uploadAudio\(blob, onProgress\)\{[\s\S]*?\n\}\n/)[0]; let got = 0;
    const cors = {'access-control-allow-origin':'*', 'access-control-allow-headers':'authorization, content-type', 'access-control-allow-methods':'POST'};
    const api = http.createServer((q, r) => { if (q.method === 'OPTIONS'){ r.writeHead(204, cors); return r.end(); }
      q.on('data', d => { got += d.length; q.pause(); setTimeout(() => q.resume(), 3); });   // đọc chậm để kịp thấy tiến độ
      q.on('end', () => { r.writeHead(200, {...cors, 'content-type':'application/json'}); r.end(JSON.stringify({upload_url:'x', auth: q.headers.authorization})); }); });
    const web = http.createServer((q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end('<!doctype html><title>t</title>'); });
    await new Promise(r => api.listen(0, '127.0.0.1', r)); await new Promise(r => web.listen(0, '127.0.0.1', r));
    const ctx = await browser.newContext(), pg = await ctx.newPage();
    try{ await pg.goto('http://127.0.0.1:' + web.address().port + '/');
      const out = await pg.evaluate(async ({fn, api}) => { window.AAI = api; window.S = {apiKey:'khoa-thu'}; (0, eval)(fn); const seen = [];
        const res = await uploadAudio(new Blob([new Uint8Array(12 * 1024 * 1024)]), f => seen.push(f)); return {res, seen}; }, {fn, api: 'http://127.0.0.1:' + api.address().port});
      ok(got === 12 * 1024 * 1024 && out.res.auth === 'khoa-thu', 'máy chủ nhận đủ file, khoá gửi nguyên dạng (không có chữ Bearer)');
      ok(out.seen.length >= 2 && out.seen[out.seen.length - 1] === 1 && out.seen.every((v, i) => !i || v >= out.seen[i - 1]), 'tiến độ thật tăng dần tới 100%: ' + JSON.stringify(out.seen));
    }finally{ await ctx.close(); api.close(); web.close(); } },

  'trong Claude: nhận cuộc họp từ trang web, Claude viết biên bản ngay trong trang, lưu Excel, mở lại': async () => {
    const built = artifact.build(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    ok(built.indexOf('<title>') === 0 && !/<html|<head>|<body>|http-equiv/.test(built) && built.includes('claude:viewport-fit-sides'), 'trang đóng gói đúng quy định Artifact: bắt đầu bằng tiêu đề, không tự mang vỏ html');
    ok(!built.includes('@font-face') && !built.includes('url(fonts/') && built.includes('fonts.googleapis.com/css2?family=Be+Vietnam+Pro'), 'trang đóng gói lấy phông từ Google Fonts, không trỏ tới file không đi kèm');
    const w = await open(), wp = w.page; await w.firstRun(); await w.process({title:'Họp sang Claude', people:'anh Minh, chị Lan'});
    await wp.fill('#name_A', 'Anh Minh'); await wp.click('#btnSaveNames'); const n = await w.ev(() => S.cur.utts.length);
    await wp.click('.seg [data-tab="min"]'); await wp.click('#tab_min button:has-text("Sao chép sang Claude")'); await wp.waitForTimeout(400); const pkg = await w.clip();
    ok(pkg.startsWith('BBH1:') && pkg.length < 4000 && !pkg.includes('rà soát'), 'trang web sao chép gói nén: ' + pkg.slice(0, 20) + '… dài ' + pkg.length);
    ok(!(await w.shown('#btnImport')) && !(await w.shown('#impText')) && !(await w.shown('#btnToClaude')), 'trang web không hiện phần chỉ dành cho Claude; chưa có biên bản thì nút sao chép chỉ nằm trong thẻ "Chưa có biên bản"'); w.done();
    const c = await open({ctx: w.ctx, claude: true}), p = c.page; await c.firstRunClaude();
    ok(await c.ev(() => S.writer) === 'direct' && !(await c.shown('#pickBox')) && !(await c.shown('#btnProcess')) && !(await c.shown('#btnToClaude')) && await c.shown('#btnNew'), 'trong Claude: không có ghi âm, không đòi khoá API');
    await c.importPkg(pkg);
    ok(await c.ev(() => S.cur.utts.length) === n && await c.ev(() => S.cur.names.A) === 'Anh Minh' && await c.visible('#tab_spk') && (await p.textContent('#vTitle')) === 'Họp sang Claude', 'cuộc họp sang đủ lời thoại, tên người nói');
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes'); await c.until(() => !!S.cur.minutes, 'Claude viết biên bản trong trang', 40, 100);
    ok(c.prompts.length === 1 && c.prompts[0].includes('LỜI THOẠI:') && c.prompts[0].includes('Anh Minh: ') && c.prompts[0].includes('NGÔN NGỮ CỦA BIÊN BẢN') && c.prompts[0].includes('không đặt trong khối mã'), 'gửi Claude một lần, đủ lời thoại và quy tắc');
    ok(!(await c.visible('#claudeBox')) && await c.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat, 'không cần sao chép – dán');
    await p.click('#btnExcel'); await c.until(() => !!document.getElementById('toast').textContent.includes('Excel'), 'lưu Excel qua app Claude', 20, 100);
    ok(c.saved.length === 1 && /^BienBan_.*Hop-sang-Claude\.xlsx$/.test(c.saved[0].filename), 'file Excel được giao cho app Claude lưu: ' + (c.saved[0] || {}).filename);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(c.saved[0].data); ok(wb.worksheets.length === 4 && wb.getWorksheet('Lời thoại').getCell('B2').value === 'Anh Minh', 'file Excel đúng nội dung');
    const dump = await c.ev(() => JSON.stringify(window.__stub.store)), keys = await c.ev(() => Object.keys(window.__stub.store));
    ok(!dump.includes('Họp sang Claude') && !dump.includes('rà soát') && !dump.includes('Anh Minh') && !dump.includes(MINUTES.tom_tat) && dump.includes('bb_wrap'), 'kho trong Claude chỉ có dữ liệu đã mã hoá');
    ok(keys.length >= 3 && keys.every(k => k === 'data/users/u_thu0000000000000000000/bbh' || k.startsWith('data/users/u_thu0000000000000000000/bbh/')), 'mọi thứ nằm trong vùng riêng của người dùng: ' + keys.join(', '));
    await p.reload(); await c.until(() => S.screen === 'scrLock', 'mở lại', 20); ok((await p.textContent('#lockTitle')) === 'Mở khoá', 'lần sau chỉ cần mở khoá');
    await c.pinErr('000000', 'Sai mã PIN'); await c.unlock('135790');
    ok(await c.ev(() => S.all.length === 1 && S.all[0].utts === undefined && !!S.all[0].minutes), 'danh sách mở nhanh: chưa tải lời thoại');
    await p.click('.mcard'); await c.until(() => S.screen === 'scrMeet', 'mở cuộc họp', 20, 100);
    ok(await c.ev(() => S.cur.utts.length) === n && await c.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat, 'mở lại đủ lời thoại và biên bản');
    ok(c.calls.cdn.length >= 1 && c.calls.cdn.every(x => x === 'cdnjs'), 'thư viện Excel lấy từ cdnjs và qua được kiểm tra mã băm, không cần nguồn dự phòng: ' + c.calls.cdn.join()); await c.close(); },

  'trong Claude: họp rất dài (4 tiếng) được cắt nhiều phần trong kho và khi gửi Claude': async () => { const utt = fakeUtterances(240);
    utt.forEach(u => { u.text += ' ' + Array.from({length: 40}, () => Math.random().toString(36).slice(2, 9)).join(' '); });   // nhiều chữ ngẫu nhiên: lời thoại được nén trước khi lưu, câu lặp lại sẽ nén "ảo" còn quá nhỏ
    const w = await open({utterances: utt, duration: 14400}), wp = w.page; await w.firstRun(); await w.process({title:'Họp dài sang Claude'});
    await wp.click('.seg [data-tab="min"]'); await wp.click('#tab_min button:has-text("Sao chép sang Claude")'); await wp.waitForTimeout(600); const pkg = await w.clip(); w.done();
    const sample = async input => ({text: JSON.stringify(input.includes('GHI CHÚ CÁC PHẦN') ? MINUTES : input.includes('của lời thoại') ? {diem_chinh:[{chu_de:'p', noi_dung:'q', ket_luan:''}]} : MINUTES)});
    const c = await open({ctx: w.ctx, claude: true, sample}), p = c.page; await c.firstRunClaude(); await c.importPkg(pkg);
    const parts = await c.ev(() => Object.keys(window.__stub.store).filter(k => k.includes('/parts/')).length);
    ok(parts >= 2, 'lời thoại dài phải được cắt thành nhiều tài liệu (mỗi tài liệu tối đa 256 KiB), thực tế ' + parts);
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes'); await c.until(() => !!S.cur.minutes, 'Claude viết biên bản cho họp dài', 60, 100);
    const sizes = c.prompts.map(x => Buffer.byteLength(x)); ok(c.prompts.length >= 3 && c.prompts.length <= 6 && sizes.every(b => b <= 262144), 'họp rất dài: vài phần lời thoại + 1 lượt gộp, mỗi lượt không quá 256 KiB: ' + sizes.join(', '));
    const before = await c.ev(() => window.__stub.writes.length); await p.click('.seg [data-tab="task"]'); await p.click('#tab_task .task >> nth=0 >> button.check'); await p.waitForTimeout(200);
    const w2 = await c.ev(n => window.__stub.writes.slice(n), before); ok(w2.length === 1 && w2[0].includes('/meetings/'), 'đánh dấu một đầu việc chỉ ghi lại phần nhẹ, không ghi lại lời thoại: ' + w2.join(', '));
    await p.reload(); await c.until(() => S.screen === 'scrLock', 'mở lại', 20); await c.unlock('135790'); await p.click('.mcard'); await c.until(() => S.screen === 'scrMeet', 'mở cuộc họp dài', 20, 100);
    ok(await c.ev(() => S.cur.utts.length) === utt.length && await c.ev(() => S.cur.minutes.viec_theo_doi[0].xong) === true, 'mở lại đủ lời thoại và việc đã đánh dấu'); await c.close(); },

  'trong Claude: họp 150 phút gửi Claude trong một lượt': async () => { const utt = fakeUtterances(150);
    const w = await open({utterances: utt, duration: 9000}), wp = w.page; await w.firstRun(); await w.process({title:'Họp 150 phút sang Claude'});
    await wp.click('.seg [data-tab="min"]'); await wp.click('#tab_min button:has-text("Sao chép sang Claude")'); await wp.waitForTimeout(600); const pkg = await w.clip(); w.done();
    const c = await open({ctx: w.ctx, claude: true}), p = c.page; await c.firstRunClaude(); await c.importPkg(pkg);
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes'); await c.until(() => !!S.cur.minutes, 'Claude viết biên bản', 60, 100);
    ok(c.prompts.length === 1 && Buffer.byteLength(c.prompts[0]) <= 262144, 'một lượt gọi, ' + Buffer.byteLength(c.prompts[0]) + ' byte'); await c.close(); },

  'trong Claude: đổi mã PIN chỉ ghi một tài liệu; xoá toàn bộ thì kho sạch': async () => {
    const w = await open(), wp = w.page; await w.firstRun(); await w.process({title:'Họp đổi mã trong Claude'}); await w.claudeGen();
    await wp.click('#btnToClaude'); await wp.waitForTimeout(400); const pkg = await w.clip(); ok(pkg.startsWith('BBH1:'), 'cuộc họp đã có biên bản cũng sao chép sang được'); w.done();
    const c = await open({ctx: w.ctx, claude: true, cdnFail: n => n === 'cdnjs'}), p = c.page; await c.firstRunClaude(); await c.importPkg(pkg);
    ok(await c.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat && await c.visible('#tab_min') && !(await c.visible('#tab_spk')), 'biên bản viết ở trang web đi theo sang Claude');
    await p.click('#btnExcel'); await c.until(() => document.getElementById('toast').textContent.includes('Excel'), 'lưu Excel khi cdnjs không vào được', 20, 100);
    ok(c.saved.length === 1 && c.calls.cdn.join() === 'cdnjs,jsdelivr', 'cdnjs hỏng thì lấy thư viện Excel từ nguồn dự phòng: ' + c.calls.cdn.join());
    await p.click('#btnBack'); await p.click('#btnSettings'); ok(!(await c.shown('#apiKey')) && !(await c.shown('#btnScan')) && !(await c.shown('#themeSeg')) && await c.shown('#writer'), 'Cài đặt trong Claude không có khoá API, AssemblyAI, giao diện');
    const before = await c.ev(() => window.__stub.writes.length); await c.changePin('135790', '24681357'); await c.until(() => S.screen === 'scrSettings', 'đổi mã PIN trong Claude', 60);
    const wr = await c.ev(n => window.__stub.writes.slice(n), before); ok(wr.length === 1 && wr[0].endsWith('/bbh'), 'đổi mã PIN chỉ ghi lại một tài liệu mở khoá: ' + wr.join(', '));
    await p.reload(); await c.until(() => S.screen === 'scrLock', 'mở lại', 20); await c.pinErr('135790', 'Sai mã PIN'); await c.unlock('24681357'); await p.click('.mcard'); await c.until(() => S.screen === 'scrMeet', 'mở bằng mã mới', 20, 100);
    ok(await c.ev(() => S.cur.title) === 'Họp đổi mã trong Claude' && await c.ev(() => S.cur.utts.length) > 0, 'mã mới mở được dữ liệu cũ');
    await p.click('#btnBack'); await p.click('#btnSettings'); await p.click('#btnWipe'); await p.click('#btnWipe'); await c.until(() => S.screen === 'scrLock' && document.getElementById('lockTitle').textContent === 'Tạo mã PIN', 'xoá toàn bộ', 20, 100);
    ok(await c.ev(() => Object.keys(window.__stub.store).length) === 0, 'kho trong Claude không còn gì');
    ok(await w.ev(() => S.all.length) === 1, 'dữ liệu ở trang web không bị đụng tới'); await c.close(); },

  'trong Claude: hết hạn mức thì báo rõ; đổi sang sao chép – dán vẫn làm được; dán nhầm và dán trùng được chặn': async () => {
    const w = await open(), wp = w.page; await w.firstRun(); await w.process({title:'Họp hết hạn mức'});
    await wp.click('.seg [data-tab="min"]'); await wp.click('#tab_min button:has-text("Sao chép sang Claude")'); await wp.waitForTimeout(400); const pkg = await w.clip(); w.done();
    const c = await open({ctx: w.ctx, claude: true, sample: async () => ({error: 'rate_limited'})}), p = c.page; await c.firstRunClaude();
    await p.click('#btnNew'); await p.click('#btnImport'); ok((await p.textContent('#newErr')).includes('Chưa dán gì'), 'chưa dán thì nhắc');
    await p.fill('#impText', 'Chủ đề: họp\nLỜI THOẠI: xin chào'); await p.click('#btnImport'); await c.until(() => document.getElementById('newErr').textContent.includes('không phải cuộc họp sao chép'), 'dán nhầm thứ khác', 10, 100);
    await p.fill('#impText', pkg.slice(0, pkg.length - 40)); await p.click('#btnImport'); await c.until(() => document.getElementById('newErr').textContent.includes('thiếu hoặc hỏng'), 'dán thiếu', 10, 100);
    ok(await c.ev(() => S.all.length) === 0, 'dán hỏng thì không tạo cuộc họp rác'); await p.click('#btnBack'); await c.importPkg(pkg);
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes'); await c.until(() => document.getElementById('minErr').textContent.includes('hạn mức'), 'báo hết hạn mức', 20, 100);
    ok((await p.textContent('#minErr')).includes('Sao chép – dán') && await c.ev(() => S.cur.minutes === null && !S.genId), 'gợi ý cách thay thế, không tạo biên bản rác');
    await p.click('#btnBack'); await p.click('#btnSettings'); await p.selectOption('#writer', 'claude'); await p.click('#btnSaveKey'); await c.until(() => S.screen === 'scrHome', 'lưu cách viết', 10, 100);
    await p.click('#btnNew'); await p.fill('#impText', pkg); await p.click('#btnImport'); await c.until(() => document.getElementById('newErr').textContent.includes('đã có trong Claude'), 'dán trùng thì hỏi lại', 10, 100);
    ok(await c.ev(() => S.all.length) === 1 && (await p.textContent('#btnImport')).includes('Bấm lần nữa'), 'chưa thay khi chưa bấm lần hai'); await p.click('#btnImport'); await c.until(() => S.screen === 'scrMeet', 'thay bằng bản vừa dán', 40, 100);
    ok(await c.ev(() => S.all.length) === 1 && await c.ev(() => Object.keys(window.__stub.store).filter(k => k.includes('/parts/')).length) === 1, 'thay xong không để lại phần lời thoại cũ');
    await p.click('.seg [data-tab="min"]'); await p.click('#btnMinutes'); await p.waitForTimeout(200); ok(await c.visible('#claudeBox'), 'cách sao chép – dán mở khung hướng dẫn');
    await p.click('#cbPaste'); await p.waitForTimeout(300); ok(await c.visible('#cbText'), 'trong Claude không đọc được bộ nhớ tạm: hiện ô để tự dán');
    await p.fill('#cbText', fenced(MINUTES)); await p.click('#cbImport'); await c.until(() => !!S.cur.minutes, 'nhập biên bản bằng cách dán tay', 10, 100);
    await p.reload(); await c.until(() => S.screen === 'scrLock', 'mở lại', 20); await c.unlock('135790'); ok(await c.ev(() => S.writer) === 'claude', 'nhớ cách viết đã chọn'); await c.close(); },

  'trong Claude: nguồn ngoài trả về thư viện Excel bị sửa thì trình duyệt từ chối chạy': async () => {
    const w = await open(), wp = w.page; await w.firstRun(); await w.process({title:'Họp thư viện bị sửa'}); await w.claudeGen();
    await wp.click('#btnToClaude'); await wp.waitForTimeout(400); const pkg = await w.clip(); w.done();
    const c = await open({ctx: w.ctx, claude: true, cdnBody: () => 'window.ExcelJS = {bi_sua: true};'}), p = c.page; await c.firstRunClaude(); await c.importPkg(pkg);
    await p.click('#btnExcel'); await c.until(() => document.getElementById('minErr').textContent.includes('Chưa tạo được file Excel'), 'báo không tải được thư viện', 20, 100);
    ok(await c.ev(() => typeof window.ExcelJS) === 'undefined' && c.saved.length === 0 && c.calls.cdn.length >= 2, 'mã lạ không được chạy, không có file nào được lưu'); await c.ctx.close(); },

  'trong Claude: chưa nối được kho thì báo và thử lại được; không được nhờ Claude viết thì dùng sao chép – dán': async () => {
    let c = await open({claude: {noDb: true}}), p = c.page; await c.until(() => !document.getElementById('btnBootRetry').hidden, 'báo không mở được kho', 10, 100);
    ok((await p.textContent('#bootMsg')).includes('app Claude') && await c.ev(() => S.screen) === 'scrBoot', 'không có kho thì dừng ở màn chờ, không cho tạo mã PIN'); await c.close();
    c = await open({claude: {noSample: true}}); p = c.page; await c.until(() => S.screen === 'scrLock', 'kết nối kho', 20);
    await c.ev(() => { window.__stub.fail.write = true; }); await c.pin('135790'); await p.click('#btnUnlock'); await c.pin('135790'); await p.click('#btnUnlock');
    await c.until(() => document.getElementById('lockErr').textContent.includes('Lỗi'), 'ghi kho hỏng lúc tạo mã PIN', 20, 100);
    ok(await c.ev(() => !KV.bb_wrap && !S.key && Object.keys(window.__stub.store).length === 0), 'ghi hỏng thì coi như chưa tạo mã PIN');
    await c.ev(() => { window.__stub.fail.write = false; }); await p.reload(); await c.firstRunClaude();
    ok(await c.ev(() => S.writer) === 'claude' && await c.ev(() => document.getElementById('writer').options.length) === 1, 'không có quyền nhờ Claude viết: chỉ còn cách sao chép – dán'); await c.close(); },

  'mất mạng vẫn mở được app và tải Excel; có bản mới thì mời cập nhật': async () => { const t = await open(), p = t.page;
    try{
      await t.ev(() => navigator.serviceWorker.ready.then(() => new Promise(r => navigator.serviceWorker.controller ? r() : navigator.serviceWorker.addEventListener('controllerchange', r))));
      await t.firstRun(); await t.process({title:'Họp ngoại tuyến'}); await t.claudeGen();
      srv.down = true; await p.reload(); ok(await t.visible('#scrLock'), 'mất mạng vẫn mở được app'); await t.unlock(); await p.click('.mcard');
      ok(await t.ev(() => S.cur.minutes.tom_tat) === MINUTES.tom_tat, 'mất mạng vẫn đọc được biên bản'); const {wb} = await t.excel(); ok(wb.worksheets.length === 4, 'mất mạng vẫn tải được Excel');
      ok(await t.ev(() => document.fonts.ready.then(() => document.fonts.check('16px "Be Vietnam Pro"'))), 'mất mạng vẫn có phông chữ'); ok(!(await t.visible('#updBar')), 'mất mạng thì không báo gì về bản mới');
      srv.down = false; srv.version = '2099.1.1';   // vừa phát hành bản mới, app đang mở sẵn
      await p.clock.fastForward(16 * 60 * 1000); await t.ev(() => document.dispatchEvent(new Event('visibilitychange')));
      await t.until(() => !document.getElementById('updBar').hidden, 'hiện lời mời cập nhật', 10); ok((await p.textContent('#updBar')).includes('2099.1.1'), 'lời mời ghi số bản mới');
      await Promise.all([p.waitForNavigation(), p.click('#updBar')]); ok(await t.ev(() => APP_VERSION) === '2099.1.1' && p.url().includes('?v=2099.1.1'), 'bấm là nhận bản mới');
      await t.unlock(); ok(await t.ev(() => S.all.length) === 1 && !(await t.visible('#updBar')), 'bản mới mở được dữ liệu, hết lời mời');
    }finally{ srv.down = false; srv.version = null; }
    await t.close(); },
};

module.exports = { serve, claudeStub };
if (require.main === module) (async () => {
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
