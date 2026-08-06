/* แคชไฟล์แอปไว้ใช้ตอนสัญญาณไม่ดี — เปลี่ยน CACHE เมื่อแก้ไฟล์ใด ๆ */
var CACHE = 'markingphotos-v6';

var GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  .map(function (c) { return 'assets/glyphs/' + c + '.png'; })
  .concat(['assets/glyphs/dash.png']);

var SHELL = [
  './',
  'index.html',
  'style.css',
  'js/plate.js',
  'js/autoplace.js',
  'js/app.js',
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
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* ข้ามไฟล์ที่โหลดไม่ได้ */ });
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

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // ต้องคืน Response เสมอ ถ้าคืน undefined เบราว์เซอร์จะถือว่าคำขอนี้พัง
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
