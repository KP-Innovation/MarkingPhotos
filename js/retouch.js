/*
 * ลบวัตถุในรูป (สติ๊กเกอร์ / ของรก ๆ ฉากหลัง) — ใช้ได้เฉพาะบนคอม
 *
 * หน้าเว็บนี้ไม่มีเซิร์ฟเวอร์หลังบ้าน จึงส่งรูปไปให้ "ตัวช่วย LaMa" ที่รันอยู่บนคอมเครื่องนั้นเอง
 * ที่ http://127.0.0.1:5188 (โฟลเดอร์ lama/ — ตัวเดียวกับปุ่ม 🩹 ลบวัตถุ ของ Dashboard)
 * เครื่องไหนยังไม่มีตัวช่วย จะเด้งถามว่าจะติดตั้งไหม แล้วให้ดาวน์โหลดตัวติดตั้งไปเปิด
 * หน้าเว็บรอจนตัวช่วยตอบแล้วเปิดหน้าลบวัตถุให้เอง
 *
 * หน้าลบวัตถุ: ระบายทับ → "ลบออก" · ซูมได้ละเอียดถึง 1600% ของพิกเซลจริง
 * แปรงกำหนดเป็นขนาดบนจอ ยิ่งซูมเข้า เส้นบนรูปจริงยิ่งเล็ก จึงเก็บขอบวัตถุได้แม่นขึ้นเรื่อย ๆ
 */
(function () {
  'use strict';

  var HELPER = 'http://127.0.0.1:5188';
  var SETUP_URL = 'lama/setup.cmd';
  var SETUP_NAME = 'MarkingPhotos-LaMa-Setup.cmd';

  var ZOOM_MAX = 16;            // ซูมเข้าได้สูงสุด 1600% ของพิกเซลจริง
  var ZOOM_STEPS = 1000;        // ความละเอียดของแถบซูม (สเกล log — ขยับทีละไม่ถึง 1%)
  var ZOOM_BUTTON = 1.1;        // ปุ่ม − / + ทีละ 10%
  var WHEEL_RATE = 0.0015;      // ล้อเมาส์ 1 คลิก ≈ 15%
  var WHEEL_RATE_FINE = 0.0004; // กด Shift ค้าง ≈ 4%
  var BRUSH_MIN = 3, BRUSH_MAX = 240, BRUSH_DEFAULT = 36;
  var MASK_COLOR = '#f43f5e';
  var MASK_ALPHA = 0.45;
  var STAGE_BG = '#0d1219';

  /* ---------------- เครื่องนี้ใช้ได้ไหม ---------------- */

  function isDesktop() {
    var ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
    return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
  }

  function isWindows() { return /Windows/i.test(navigator.userAgent || ''); }

  function health(ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 1800);
    return fetch(HELPER + '/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.app === 'markingphotos-lama') ? j : null; })
      .catch(function () { return null; })
      .then(function (j) { clearTimeout(timer); return j; });
  }

  /* Chrome รุ่นใหม่ถามสิทธิ์ก่อนให้เว็บเรียกเข้าเครื่องตัวเอง ถ้าเคยกดปฏิเสธไว้จะเรียกไม่ติดตลอด */
  function localAccessDenied() {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(false);
    var ask = function (name) {
      return navigator.permissions.query({ name: name })
        .then(function (s) { return s.state === 'denied'; }, function () { return false; });
    };
    return ask('local-network-access').then(function (d) { return d || ask('loopback-network'); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------------- กล่องถามติดตั้ง ---------------- */

  var modal = null;
  var pollTimer = 0;

  function closeModal() {
    clearInterval(pollTimer);
    pollTimer = 0;
    if (modal) { modal.remove(); modal = null; }
  }

  function showModal(title, lines, buttons) {
    closeModal();
    modal = el('div', 'rt-modal');
    var card = el('div', 'rt-card');
    card.appendChild(el('p', 'rt-card__title', title));
    lines.forEach(function (ln) {
      if (Array.isArray(ln)) {
        var ol = el('ol', 'rt-card__steps');
        ln.forEach(function (s) { ol.appendChild(el('li', '', s)); });
        card.appendChild(ol);
      } else {
        card.appendChild(el('p', 'rt-card__text', ln));
      }
    });
    var wait = el('p', 'rt-card__wait');
    wait.hidden = true;
    card.appendChild(wait);
    var row = el('div', 'rt-card__btns');
    buttons.forEach(function (b) {
      var btn = el('button', 'btn ' + (b.primary ? 'btn--primary' : 'btn--ghost'), b.label);
      btn.type = 'button';
      btn.addEventListener('click', function () { b.onClick(btn, wait); });
      row.appendChild(btn);
    });
    card.appendChild(row);
    modal.appendChild(card);
    document.body.appendChild(modal);
  }

  function downloadSetup() {
    var a = document.createElement('a');
    a.href = SETUP_URL + '?t=' + Date.now();
    a.download = SETUP_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function offerInstall(onReady) {
    if (!isWindows()) {
      showModal('ลบวัตถุใช้ได้เฉพาะคอม Windows', [
        'ปุ่มนี้ใช้ AI ที่ต้องติดตั้งลงบนคอมเครื่องนั้นเอง ตอนนี้ทำตัวติดตั้งไว้ให้เฉพาะ Windows'
      ], [{ label: 'ปิด', primary: true, onClick: closeModal }]);
      return;
    }
    showModal('ติดตั้งตัวลบวัตถุ (LaMa) บนเครื่องนี้ไหม?', [
      'ปุ่มลบวัตถุใช้ AI ตัวเดียวกับ Dashboard ซึ่งต้องรันบนคอมเครื่องนี้เอง ติดตั้งครั้งเดียว ' +
        'ใช้เวลาราว 5–15 นาที (ดาวน์โหลดประมาณ 1 GB ถ้าเครื่องยังไม่มี Python + PyTorch)',
      [
        'กด "ติดตั้ง" แล้วเปิดไฟล์ ' + SETUP_NAME + ' ที่ดาวน์โหลดมา',
        'ถ้า Windows ขึ้นกรอบสีฟ้าเตือน ให้กด "ข้อมูลเพิ่มเติม" แล้ว "เรียกใช้ต่อไป"',
        'รอหน้าต่างดำทำงานจนขึ้นว่าเสร็จ หน้านี้จะเปิดหน้าลบวัตถุให้เอง'
      ],
      'ถ้าเคยติดตั้งแล้ว แค่เปิดไฟล์เดิมอีกครั้ง ตัวช่วยจะกลับมาทำงานในไม่กี่วินาที'
    ], [
      { label: 'ไม่ใช่ตอนนี้', onClick: closeModal },
      {
        label: 'ติดตั้ง', primary: true,
        onClick: function (btn, wait) {
          downloadSetup();
          btn.disabled = true;
          btn.textContent = 'รอการติดตั้ง...';
          wait.hidden = false;
          wait.textContent = 'เปิดไฟล์ที่ดาวน์โหลดมาได้เลย หน้านี้กำลังรอตัวช่วยตอบ...';
          clearInterval(pollTimer);
          pollTimer = setInterval(function () {
            health(1500).then(function (h) {
              if (!h || !modal) return;
              if (h.ai === 'ready') {
                closeModal();
                onReady();
              } else {
                wait.textContent = h.ai === 'error'
                  ? 'ตัวช่วยเปิดแล้วแต่โหลดโมเดลไม่ได้: ' + (h.error || '') + ' — ลองเปิดไฟล์ติดตั้งอีกครั้ง'
                  : 'ตัวช่วยเปิดแล้ว กำลังโหลดโมเดล...';
              }
            });
          }, 2500);
        }
      }
    ]);
  }

  function explainBlocked() {
    showModal('เบราว์เซอร์บล็อกการเชื่อมต่อกับตัวช่วยในเครื่อง', [
      'ตัวลบวัตถุติดตั้งอยู่ในคอมเครื่องนี้ แต่เคยกด "บล็อก" ตอนเบราว์เซอร์ถามสิทธิ์ไว้',
      [
        'คลิกไอคอนแม่กุญแจหรือไอคอนตั้งค่าหน้าซ้ายของช่อง URL',
        'หา "อุปกรณ์และแอปในเครื่อง / Local network access" แล้วเปลี่ยนเป็น "อนุญาต"',
        'โหลดหน้านี้ใหม่ แล้วกดลบวัตถุอีกครั้ง'
      ]
    ], [{ label: 'เข้าใจแล้ว', primary: true, onClick: closeModal }]);
  }

  /*
   * ทางเข้าหลัก — แอปเรียกตอนกดปุ่มลบวัตถุ
   * getCanvas() คืนสำเนารูปเต็มความละเอียด (หมุนแล้ว) · onDone(canvas) เมื่อผู้ใช้กด "ใช้รูปนี้"
   */
  function start(getCanvas, onDone) {
    health().then(function (h) {
      if (h) { openEditor(getCanvas(), onDone, h); return; }
      localAccessDenied().then(function (denied) {
        if (denied) explainBlocked();
        else offerInstall(function () { openEditor(getCanvas(), onDone, null); });
      });
    });
  }

  /* ---------------- หน้าลบวัตถุ ---------------- */

  var E = null;   // สถานะของหน้าลบวัตถุที่เปิดอยู่ (เปิดได้ทีละหน้า)

  function openEditor(work, onDone, info) {
    if (E) return;
    var root = el('div', 'rt');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'ลบวัตถุ');
    root.innerHTML =
      '<header class="bar">' +
        '<button type="button" class="icon-btn" data-act="cancel" aria-label="ปิด">✕</button>' +
        '<span class="bar__code bar__code--plain">ลบวัตถุ</span>' +
        '<span class="bar__spacer"></span>' +
      '</header>' +
      '<div class="rt-stage">' +
        '<canvas class="rt-view"></canvas>' +
        '<div class="rt-cursor" hidden></div>' +
        '<div class="rt-busy" hidden><span>กำลังลบและเติมพื้นหลัง...</span></div>' +
      '</div>' +
      '<p class="hint rt-hint">ระบายทับสิ่งที่จะลบ · ล้อเมาส์ = ซูม (Shift = ละเอียด) · คลิกขวาลาก หรือกดเว้นวรรคค้างแล้วลาก = เลื่อนภาพ</p>' +
      '<p class="rt-msg"></p>' +
      '<div class="controls">' +
        '<label class="slider"><span>ขนาดแปรง</span>' +
          '<input type="range" class="rt-brush" min="' + BRUSH_MIN + '" max="' + BRUSH_MAX + '" step="1">' +
          '<b class="rt-val rt-brush-val"></b></label>' +
        '<div class="slider"><span>ซูม</span>' +
          '<button type="button" class="rt-zbtn" data-act="zout" aria-label="ซูมออก">−</button>' +
          '<input type="range" class="rt-zoom" min="0" max="' + ZOOM_STEPS + '" step="1" aria-label="ระดับซูม">' +
          '<button type="button" class="rt-zbtn" data-act="zin" aria-label="ซูมเข้า">+</button>' +
          '<b class="rt-val rt-zoom-val"></b>' +
          '<button type="button" class="chip rt-chip" data-act="fit">พอดีจอ</button>' +
          '<button type="button" class="chip rt-chip" data-act="actual">100%</button>' +
        '</div>' +
      '</div>' +
      '<div class="actions actions--row actions--tight">' +
        '<button type="button" class="btn btn--ghost" data-act="undo">เลิกทำ</button>' +
        '<button type="button" class="btn btn--ghost" data-act="clear">ล้างที่ระบาย</button>' +
        '<button type="button" class="btn btn--soft" data-act="apply">ลบออก</button>' +
      '</div>' +
      '<div class="actions actions--row actions--bottom">' +
        '<button type="button" class="btn btn--ghost" data-act="cancel">ยกเลิก</button>' +
        '<button type="button" class="btn btn--primary" data-act="done">ใช้รูปนี้</button>' +
      '</div>';
    document.body.appendChild(root);

    var mask = document.createElement('canvas');
    mask.width = work.width;
    mask.height = work.height;

    E = {
      root: root,
      stage: root.querySelector('.rt-stage'),
      view: root.querySelector('.rt-view'),
      cursor: root.querySelector('.rt-cursor'),
      busyEl: root.querySelector('.rt-busy'),
      msgEl: root.querySelector('.rt-msg'),
      brushEl: root.querySelector('.rt-brush'),
      zoomEl: root.querySelector('.rt-zoom'),
      work: work,
      mask: mask,
      onDone: onDone,
      strokes: [],         // เส้นที่ระบายตั้งแต่ลบครั้งล่าสุด {r, pts:[{x,y}]} หน่วยพิกเซลของรูป
      current: null,
      hist: [],            // ประวัติสำหรับเลิกทำ: เส้น / ล้าง / การลบแต่ละครั้ง
      z: 1, ox: 0, oy: 0, fitZ: 1,
      brush: BRUSH_DEFAULT,
      pointers: new Map(),
      pan: null, pinch: null,
      space: false,
      busy: false,
      confirmCancel: false,
      raf: 0
    };
    try {
      var saved = parseInt(localStorage.getItem('markingphotos.rt.brush'), 10);
      if (saved >= BRUSH_MIN && saved <= BRUSH_MAX) E.brush = saved;
    } catch (err) { /* ไม่เป็นไร */ }

    E.brushEl.value = String(E.brush);
    syncBrush();
    bindEditor();
    fit();
    syncButtons();
    if (info && info.ai === 'loading') say('ตัวช่วยกำลังโหลดโมเดล ระบายรอได้เลย');
    else if (info && info.ai === 'error') say('⚠ ตัวช่วยโหลดโมเดลไม่ได้ จะใช้วิธีสำรองแทน (คุณภาพต่ำกว่า)');
    else say('');
  }

  function closeEditor() {
    if (!E) return;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(E.raf);
    E.root.remove();
    E.mask.width = 0; E.mask.height = 0;
    E = null;
  }

  function say(text) {
    if (!E) return;
    E.msgEl.textContent = text || '';
    E.msgEl.className = 'rt-msg' + (/^[⚠✕]/.test(text || '') ? ' is-bad' : (text ? ' is-ok' : ''));
  }

  function changed() {
    return E.hist.some(function (h) { return h.k === 'fill'; });
  }

  function syncButtons() {
    var q = function (a) { return E.root.querySelector('[data-act="' + a + '"]'); };
    q('undo').disabled = E.busy || !E.hist.length;
    q('clear').disabled = E.busy || !E.strokes.length;
    q('apply').disabled = E.busy || !E.strokes.length;
    q('done').disabled = E.busy;
    E.busyEl.hidden = !E.busy;
  }

  function syncBrush() {
    E.root.querySelector('.rt-brush-val').textContent = E.brush + ' px';
  }

  /* ---------- ซูม / เลื่อน ---------- */

  function stageSize() {
    return { w: E.stage.clientWidth, h: E.stage.clientHeight };
  }

  function zoomMin() { return Math.min(E.fitZ, 1); }
  function zoomMax() { return Math.max(ZOOM_MAX, E.fitZ * 2); }

  /* แถบซูมเป็นสเกล log — ช่วงซูมกว้างมาก (เช่น 15% ถึง 1600%) ถ้าเป็นเส้นตรงช่วงซูมเข้าจะหยาบมาก */
  function zoomToSlider(z) {
    var a = Math.log(zoomMin()), b = Math.log(zoomMax());
    return Math.round((Math.log(z) - a) / (b - a) * ZOOM_STEPS);
  }

  function sliderToZoom(v) {
    var a = Math.log(zoomMin()), b = Math.log(zoomMax());
    return Math.exp(a + (b - a) * v / ZOOM_STEPS);
  }

  /* รูปเล็กกว่าเวที = อยู่กลาง · ใหญ่กว่า = เลื่อนได้แต่ห้ามเลยขอบจนเห็นที่ว่าง */
  function clampView() {
    var s = stageSize();
    var w = E.work.width * E.z, h = E.work.height * E.z;
    E.ox = w <= s.w ? (s.w - w) / 2 : Math.min(0, Math.max(s.w - w, E.ox));
    E.oy = h <= s.h ? (s.h - h) / 2 : Math.min(0, Math.max(s.h - h, E.oy));
  }

  function zoomAt(z, sx, sy) {
    z = Math.max(zoomMin(), Math.min(zoomMax(), z));
    var ix = (sx - E.ox) / E.z, iy = (sy - E.oy) / E.z;   // จุดบนรูปที่อยู่ใต้เมาส์ ต้องอยู่ที่เดิมหลังซูม
    E.z = z;
    E.ox = sx - ix * z;
    E.oy = sy - iy * z;
    clampView();
    syncZoomUI();
    schedule();
  }

  function zoomCenter(z) {
    var s = stageSize();
    zoomAt(z, s.w / 2, s.h / 2);
  }

  function fit() {
    var s = stageSize();
    E.fitZ = Math.min(s.w / E.work.width, s.h / E.work.height) || 1;
    E.z = E.fitZ;
    clampView();
    syncZoomUI();
    schedule();
  }

  function syncZoomUI() {
    E.zoomEl.value = String(zoomToSlider(E.z));
    var pct = E.z * 100;
    E.root.querySelector('.rt-zoom-val').textContent =
      (pct < 10 ? pct.toFixed(1) : Math.round(pct)) + '%';
  }

  function onResize() {
    if (!E) return;
    var s = stageSize();
    var cx = (s.w / 2 - E.ox) / E.z, cy = (s.h / 2 - E.oy) / E.z;
    E.fitZ = Math.min(s.w / E.work.width, s.h / E.work.height) || 1;
    E.z = Math.max(zoomMin(), Math.min(zoomMax(), E.z));
    E.ox = s.w / 2 - cx * E.z;
    E.oy = s.h / 2 - cy * E.z;
    clampView();
    syncZoomUI();
    schedule();
  }

  /* ---------- วาดหน้าจอ ---------- */

  function schedule() {
    if (!E || E.raf) return;
    E.raf = requestAnimationFrame(render);
  }

  function render() {
    if (!E) return;
    E.raf = 0;
    var s = stageSize();
    var dpr = window.devicePixelRatio || 1;
    var cw = Math.max(1, Math.round(s.w * dpr)), ch = Math.max(1, Math.round(s.h * dpr));
    if (E.view.width !== cw || E.view.height !== ch) { E.view.width = cw; E.view.height = ch; }
    var ctx = E.view.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(dpr * E.z, 0, 0, dpr * E.z, dpr * E.ox, dpr * E.oy);
    // ซูมเข้ามาก ๆ ให้เห็นพิกเซลคม ๆ ไม่เบลอ จะได้ระบายตรงขอบได้แม่น
    ctx.imageSmoothingEnabled = E.z < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(E.work, 0, 0);
    ctx.globalAlpha = MASK_ALPHA;
    ctx.drawImage(E.mask, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* ---------- ระบาย ---------- */

  function toImage(e) {
    var r = E.view.getBoundingClientRect();
    var sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx: sx, sy: sy, x: (sx - E.ox) / E.z, y: (sy - E.oy) / E.z };
  }

  function drawStroke(ctx, st, dx, dy) {
    ctx.save();
    ctx.translate(dx || 0, dy || 0);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = st.r * 2;
    var p = st.pts;
    ctx.beginPath();
    ctx.arc(p[0].x, p[0].y, st.r, 0, Math.PI * 2);
    ctx.fill();
    if (p.length > 1) {
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (var i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redrawMask() {
    var ctx = E.mask.getContext('2d');
    ctx.clearRect(0, 0, E.mask.width, E.mask.height);
    ctx.strokeStyle = MASK_COLOR;
    E.strokes.forEach(function (st) { drawStroke(ctx, st); });
    schedule();
  }

  function strokeSegment(st, a, b) {
    var ctx = E.mask.getContext('2d');
    ctx.save();
    ctx.strokeStyle = MASK_COLOR;
    ctx.fillStyle = MASK_COLOR;
    ctx.lineCap = 'round';
    ctx.lineWidth = st.r * 2;
    ctx.beginPath();
    if (a) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    else { ctx.arc(b.x, b.y, st.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    schedule();
  }

  function showCursor(p) {
    if (!p || E.pan || E.space || E.busy) { E.cursor.hidden = true; return; }
    E.cursor.hidden = false;
    var d = E.brush;
    E.cursor.style.width = d + 'px';
    E.cursor.style.height = d + 'px';
    E.cursor.style.transform = 'translate(' + (p.sx - d / 2) + 'px,' + (p.sy - d / 2) + 'px)';
  }

  function endStroke() {
    if (!E.current) return;
    E.strokes.push(E.current);
    E.hist.push({ k: 'stroke' });
    E.current = null;
    E.confirmCancel = false;
    syncButtons();
  }

  function dropStroke() {
    if (!E.current) return;
    E.current = null;
    redrawMask();
  }

  function pinchInfo() {
    var pts = Array.from(E.pointers.values());
    var r = E.view.getBoundingClientRect();
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      cx: (pts[0].x + pts[1].x) / 2 - r.left,
      cy: (pts[0].y + pts[1].y) / 2 - r.top
    };
  }

  function onDown(e) {
    if (E.busy) return;
    try { E.view.setPointerCapture(e.pointerId); } catch (err) { /* ลากต่อได้อยู่ */ }
    E.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var p = toImage(e);
    e.preventDefault();

    if (E.pointers.size === 2) {          // สองนิ้ว = หยิกซูม + เลื่อน ทิ้งเส้นที่เพิ่งเริ่ม
      dropStroke();
      var pi = pinchInfo();
      E.pinch = { dist: pi.dist, z: E.z, ix: (pi.cx - E.ox) / E.z, iy: (pi.cy - E.oy) / E.z };
      E.pan = null;
      return;
    }
    if (e.button === 1 || e.button === 2 || E.space) {
      E.pan = { sx: e.clientX, sy: e.clientY, ox: E.ox, oy: E.oy };
      E.view.style.cursor = 'grabbing';
      showCursor(null);
      return;
    }
    if (e.button !== 0) return;
    E.current = { r: Math.max(0.5, E.brush / E.z / 2), pts: [{ x: p.x, y: p.y }] };
    strokeSegment(E.current, null, p);
  }

  function onMove(e) {
    var p = toImage(e);
    if (E.pointers.has(e.pointerId)) E.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (E.pinch && E.pointers.size >= 2) {
      var pi = pinchInfo();
      var z = Math.max(zoomMin(), Math.min(zoomMax(), E.pinch.z * pi.dist / (E.pinch.dist || 1)));
      E.z = z;
      E.ox = pi.cx - E.pinch.ix * z;
      E.oy = pi.cy - E.pinch.iy * z;
      clampView();
      syncZoomUI();
      schedule();
      return;
    }
    if (E.pan) {
      E.ox = E.pan.ox + (e.clientX - E.pan.sx);
      E.oy = E.pan.oy + (e.clientY - E.pan.sy);
      clampView();
      schedule();
      return;
    }
    showCursor(p);
    if (E.current) {
      var pts = E.current.pts;
      var last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < E.current.r * 0.15) return;
      pts.push({ x: p.x, y: p.y });
      strokeSegment(E.current, last, p);
    }
  }

  function onUp(e) {
    E.pointers.delete(e.pointerId);
    try { E.view.releasePointerCapture(e.pointerId); } catch (err) { /* ไม่เป็นไร */ }
    if (E.pointers.size < 2) E.pinch = null;
    if (E.pointers.size === 0) {
      if (E.pan) { E.pan = null; E.view.style.cursor = E.space ? 'grab' : ''; }
      endStroke();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var r = E.view.getBoundingClientRect();
    var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;     // บางเมาส์รายงานเป็นบรรทัด
    // ทัชแพดหยิกสองนิ้วส่งมาเป็น wheel + ctrlKey ค่า delta เล็ก ต้องคูณแรงกว่า
    var rate = e.ctrlKey ? 0.01 : (e.shiftKey ? WHEEL_RATE_FINE : WHEEL_RATE);
    zoomAt(E.z * Math.exp(-dy * rate), e.clientX - r.left, e.clientY - r.top);
  }

  function onKey(e) {
    if (!E) return;
    var k = e.key;
    if (k === ' ' && !e.repeat) {
      E.space = true;
      E.view.style.cursor = 'grab';
      E.cursor.hidden = true;
      e.preventDefault();
    } else if (k === '+' || k === '=') { zoomCenter(E.z * ZOOM_BUTTON); e.preventDefault(); }
    else if (k === '-' || k === '_') { zoomCenter(E.z / ZOOM_BUTTON); e.preventDefault(); }
    else if (k === '0') { fit(); e.preventDefault(); }
    else if (k === '1') { zoomCenter(1); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { undo(); e.preventDefault(); }
    else if (k === '[') { setBrush(E.brush - Math.max(1, Math.round(E.brush * 0.1))); e.preventDefault(); }
    else if (k === ']') { setBrush(E.brush + Math.max(1, Math.round(E.brush * 0.1))); e.preventDefault(); }
  }

  function onKeyUp(e) {
    if (E && e.key === ' ') {
      E.space = false;
      if (!E.pan) E.view.style.cursor = '';
    }
  }

  function setBrush(v) {
    E.brush = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(v)));
    E.brushEl.value = String(E.brush);
    syncBrush();
    try { localStorage.setItem('markingphotos.rt.brush', String(E.brush)); } catch (err) { /* ไม่เป็นไร */ }
  }

  /* ---------- เลิกทำ / ล้าง ---------- */

  function undo() {
    if (!E || E.busy || !E.hist.length) return;
    var h = E.hist.pop();
    if (h.k === 'stroke') {
      E.strokes.pop();
    } else if (h.k === 'clear') {
      E.strokes = h.strokes;
    } else if (h.k === 'fill') {
      E.work.getContext('2d').putImageData(h.before, h.x, h.y);
      E.strokes = h.strokes;
      say('ย้อนการลบครั้งล่าสุดแล้ว');
    }
    redrawMask();
    syncButtons();
  }

  function clearStrokes() {
    if (!E.strokes.length) return;
    E.hist.push({ k: 'clear', strokes: E.strokes });
    E.strokes = [];
    redrawMask();
    syncButtons();
  }

  /* ---------- ลบออก ---------- */

  function regionOfStrokes() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    E.strokes.forEach(function (st) {
      st.pts.forEach(function (p) {
        x0 = Math.min(x0, p.x - st.r); y0 = Math.min(y0, p.y - st.r);
        x1 = Math.max(x1, p.x + st.r); y1 = Math.max(y1, p.y + st.r);
      });
    });
    var W = E.work.width, H = E.work.height;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return null;
    // เผื่อบริบทรอบวัตถุให้โมเดลดูพื้นผิวรอบข้าง (ค่าเดียวกับ Dashboard: 60% ของด้านยาว ขั้นต่ำ 48px)
    var pad = Math.max(48, Math.round(0.6 * Math.max(x1 - x0, y1 - y0)));
    var rx = Math.max(0, x0 - pad), ry = Math.max(0, y0 - pad);
    return { x: rx, y: ry, w: Math.min(W, x1 + pad) - rx, h: Math.min(H, y1 + pad) - ry };
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('อ่านรูปผลลัพธ์ไม่ได้')); };
      img.src = src;
    });
  }

  function apply() {
    if (!E || E.busy) return;
    if (!E.strokes.length) { say('⚠ ระบายทับวัตถุที่จะลบก่อน'); return; }
    var R = regionOfStrokes();
    if (!R) { say('⚠ ที่ระบายอยู่นอกรูป'); return; }

    var part = document.createElement('canvas');
    part.width = R.w; part.height = R.h;
    part.getContext('2d').drawImage(E.work, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
    var pm = document.createElement('canvas');
    pm.width = R.w; pm.height = R.h;
    var mctx = pm.getContext('2d');
    mctx.strokeStyle = '#ffffff';
    E.strokes.forEach(function (st) { drawStroke(mctx, st, -R.x, -R.y); });
    var body = JSON.stringify({ image: part.toDataURL('image/png'), mask: pm.toDataURL('image/png') });
    part.width = part.height = pm.width = pm.height = 0;

    E.busy = true;
    E.cursor.hidden = true;
    say('');
    syncButtons();
    var t0 = Date.now();
    var mine = E;
    fetch(HELPER + '/inpaint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) {
        return r.json().catch(function () { throw new Error('ตัวช่วยตอบกลับผิดรูปแบบ (' + r.status + ')'); });
      }, function () {
        throw new Error('ติดต่อตัวช่วยในเครื่องไม่ได้ — อาจถูกปิดไป ให้เปิดไฟล์ติดตั้งอีกครั้ง');
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'ลบไม่สำเร็จ');
        return loadImage(j.image).then(function (img) { return { img: img, method: j.method }; });
      })
      .then(function (res) {
        if (E !== mine) return;
        var ctx = E.work.getContext('2d');
        var before = ctx.getImageData(R.x, R.y, R.w, R.h);
        ctx.drawImage(res.img, R.x, R.y);
        E.hist.push({ k: 'fill', x: R.x, y: R.y, before: before, strokes: E.strokes });
        E.strokes = [];
        redrawMask();
        var how = res.method === 'lama' ? 'AI เติมพื้นหลัง' : 'วิธีสำรอง (ไม่ใช่ AI)';
        say('✓ ลบแล้ว (' + how + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วิ) — ระบายต่อได้ หรือกด "ใช้รูปนี้"');
      })
      .catch(function (err) {
        if (E === mine) say('✕ ' + ((err && err.message) || 'ลบไม่สำเร็จ'));
      })
      .then(function () {
        if (E !== mine) return;
        E.busy = false;
        E.confirmCancel = false;
        syncButtons();
      });
  }

  /* ---------- ปิดหน้า ---------- */

  function cancel() {
    if (E.busy) return;
    if (changed() && !E.confirmCancel) {
      E.confirmCancel = true;
      say('⚠ ยังไม่ได้กด "ใช้รูปนี้" — กดยกเลิกอีกครั้งเพื่อทิ้งสิ่งที่ลบไป');
      return;
    }
    var w = E.work;
    closeEditor();
    w.width = 0; w.height = 0;      // คืนหน่วยความจำของสำเนารูป
  }

  function done() {
    if (E.busy) return;
    var cb = E.onDone, w = E.work, did = changed();
    closeEditor();
    if (did && cb) cb(w);
    else { w.width = 0; w.height = 0; }
  }

  function bindEditor() {
    var v = E.view;
    v.addEventListener('pointerdown', onDown);
    v.addEventListener('pointermove', onMove);
    v.addEventListener('pointerup', onUp);
    v.addEventListener('pointercancel', onUp);
    v.addEventListener('pointerleave', function () { if (E && !E.pointers.size) E.cursor.hidden = true; });
    v.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    v.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', onResize);

    E.brushEl.addEventListener('input', function () { setBrush(parseInt(E.brushEl.value, 10)); });
    E.zoomEl.addEventListener('input', function () { zoomCenter(sliderToZoom(parseInt(E.zoomEl.value, 10))); });

    E.root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-act');
      if (a === 'cancel') cancel();
      else if (a === 'done') done();
      else if (a === 'undo') undo();
      else if (a === 'clear') clearStrokes();
      else if (a === 'apply') apply();
      else if (a === 'zin') zoomCenter(E.z * ZOOM_BUTTON);
      else if (a === 'zout') zoomCenter(E.z / ZOOM_BUTTON);
      else if (a === 'fit') fit();
      else if (a === 'actual') zoomCenter(1);
    });
  }

  window.Retouch = {
    supported: isDesktop,
    start: start,
    health: health,
    isOpen: function () { return !!E; }
  };
})();
