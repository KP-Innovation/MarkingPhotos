/* แคชไฟล์แอปไว้ใช้ตอนสัญญาณไม่ดี — เปลี่ยน CACHE เมื่อแก้ไฟล์ใด ๆ */
var CACHE = 'markingphotos-v1';

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
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
].concat(GLYPHS);

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
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

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});
