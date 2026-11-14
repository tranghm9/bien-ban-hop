// Giữ một bản của app trên máy để mở được khi không có mạng.
// Quy tắc: luôn hỏi máy chủ trước và không dùng bản trình duyệt tự giữ, nên lần mở sau khi phát hành là có bản mới.
// Chỉ khi không có mạng mới dùng bản đã lưu. Cách gỡ khi cần: xem mục "Service worker" trong AGENTS.md.
const CACHE = "bbh-shell-v1";
const FONTS = ["be-vietnam-pro-vietnamese-400", "be-vietnam-pro-latin-400", "be-vietnam-pro-vietnamese-500", "be-vietnam-pro-latin-500",
  "be-vietnam-pro-vietnamese-600", "be-vietnam-pro-latin-600", "be-vietnam-pro-vietnamese-700", "be-vietnam-pro-latin-700",
  "quicksand-vietnamese-wght", "quicksand-latin-wght"].map(f => `fonts/${f}-normal.woff2`);
const SHELL = ["./", "manifest.json", "icon-180.png", "icon-192.png", "icon-512.png", "exceljs.min.js", ...FONTS];
const keyOf = url => url.split("?")[0];   // "?v=..." chỉ để ép tải mới, không phải một trang khác

self.addEventListener("install", e => {
  self.skipWaiting();
  // Lưu sẵn bộ khung; một file lỗi không được làm hỏng cả lần cài
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    fetch(u, {cache: "no-cache"}).then(r => r.ok ? c.put(new URL(u, self.registration.scope).href, r) : null).catch(() => null)))));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url), scope = new URL(self.registration.scope);
  // Chỉ lo các file của chính app. Mọi thứ khác (AssemblyAI...) đi thẳng ra mạng như bình thường.
  if (req.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try{
      const res = await fetch(req.url, {cache: "no-cache"});
      if (res.ok) cache.put(keyOf(req.url), res.clone());
      return res;
    }catch(err){
      const hit = await cache.match(keyOf(req.url));
      if (hit) return hit;
      throw err;
    }
  })());
});
