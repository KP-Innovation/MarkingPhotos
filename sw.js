/*
 * แคชไฟล์แอปไว้ใช้ตอนสัญญาณไม่ดี
 *
 * ⚠️ แก้ไฟล์โค้ดเมื่อไหร่ ต้องเปลี่ยน BUILD ทุกครั้ง แล้วแก้เลข ?v= ใน index.html ให้ตรงกัน
 * ไม่งั้นเครื่องที่ติดตั้งแอปไว้จะค้างอยู่กับโค้ดเก่าแบบไม่มีทางรู้ตัว
 * (บน iOS แอปที่เปิดจากหน้าโฮมแทบไม่เคยเช็ก sw.js ตัวใหม่ให้เลย)
 */
var BUILD = '20260810g';
var CACHE = 'markingphotos-' + BUILD;

var GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  .map(function (c) { return 'assets/glyphs/' + c + '.png'; })
  .concat(['assets/glyphs/dash.png']);

/* ไฟล์โค้ดต้องมี ?v= ตรงกับที่ index.html เรียก ไม่งั้นแคชคนละคีย์กัน */
var SHELL = [
  './',
  'index.html',
  'style.css?v=' + BUILD,
  'js/plate.js?v=' + BUILD,
  'js/autoplace.js?v=' + BUILD,
  'js/app.js?v=' + BUILD,
  'assets/metrics.json',
  'assets/fonts/anuphan-thai.woff2',
  'assets/fonts/anuphan-latin.woff2',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
].concat(GLYPHS);

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // ลงทีละไฟล์ ถ้าไฟล์ใดไฟล์หนึ่งโหลดไม่ได้ ต้องไม่ทำให้ทั้งชุดล้มจนติดตั้งไม่สำเร็จ
      // cache:'reload' = ข้าม HTTP cache ของเบราว์เซอร์ ไม่งั้นอาจได้ไฟล์เก่ามาใส่แคชใหม่
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }))
          .catch(function () { return cache.add(url).catch(function () {}); });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function offlineFallback() {
  return caches.match('index.html', { ignoreSearch: true }).then(function (hit) {
    return hit || caches.match('./', { ignoreSearch: true });
  }).then(function (hit) {
    return hit || new Response(
      '<!doctype html><meta charset="utf-8">' +
      '<p style="font:16px sans-serif;padding:24px">เปิดแอปไม่ได้ ลองต่อเน็ตแล้วเปิดใหม่อีกครั้ง</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  /*
   * ตัวหน้าเว็บเอง: เอาจากเน็ตก่อนเสมอ ถ้าไม่ได้ค่อยใช้ของในแคช
   * ถ้าใช้แคชก่อน แอปที่ติดตั้งบนหน้าโฮมจะค้างอยู่กับไฟล์เก่าตลอด
   * และถ้าตอนเปิดมี query string ติดมา จะหาในแคชไม่เจอจนเปิดไม่ขึ้นเลย
   */
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(offlineFallback));
    return;
  }

  function fromNetwork() {
    return fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    });
  }

  /*
   * ไฟล์อื่น ๆ: ใช้ของในแคชก่อนเพื่อความเร็วและใช้ออฟไลน์ได้
   * แต่ถ้าเป็นไฟล์โค้ด ให้ดึงตัวใหม่มาทับไว้เงียบ ๆ ด้วย เผื่อวันไหนลืมเปลี่ยน BUILD
   * รอบหน้าที่เปิดจะได้ของใหม่เอง ไม่ค้างของเก่าถาวรเหมือนเดิม
   */
  var isCode = /\.(?:html|js|css|json|webmanifest)$/i.test(new URL(req.url).pathname);

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        if (isCode) fromNetwork().catch(function () { /* ออฟไลน์ก็ช่างมัน */ });
        return hit;
      }
      return fromNetwork().catch(function () {
        // ต้องคืน Response เสมอ ถ้าคืน undefined เบราว์เซอร์จะถือว่าคำขอนี้พัง
        return caches.match(req, { ignoreSearch: true }).then(function (old) {
          return old || new Response('', { status: 504, statusText: 'offline' });
        });
      });
    })
  );
});

/* ให้หน้าเว็บสั่งข้ามคิวรอได้ ตอนผู้ใช้กด "ตรวจอัปเดต" เอง */
self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
