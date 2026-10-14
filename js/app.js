/*
 * ป้ายเลขที่งาน — แอปมือถือ (PWA)
 *
 * รูปเข้าได้สองทาง แล้วไปจบที่หน้าตรวจรูปหน้าเดียวกัน
 *   1. ถ่ายด้วยกล้องของเครื่อง — เรียกแอปกล้องเนทีฟ ได้ภาพคมเต็มคุณภาพและสัดส่วนจริงของเครื่อง
 *   2. เลือกรูปที่ถ่ายไว้แล้ว จากอัลบั้มหรือโฟลเดอร์
 *
 * เคยมีโหมด "กล้องสด" (getUserMedia + ป้ายลอยตอนเล็ง) แต่ถอดออกแล้ว 2026-08-25
 * เพราะภาพที่ได้แคบและด้อยกว่ากล้องเนทีฟจริง ๆ (ไม่ผ่าน Smart HDR/Deep Fusion
 * และ iOS ไม่ให้ปรับซูม/แสงจากฮาร์ดแวร์) — ของเดิมยังอยู่ในประวัติ git ถ้าอยากได้คืน
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE_KEY = 'markingphotos.v1';

  /*
   * ค่าที่ค้างอยู่ในเครื่องบางตัวเป็นของ "กล้องสด" ที่ถอดออกไปแล้ว ต้องล้างครั้งเดียวตอนอัปรุ่น
   * โดยเฉพาะ aspect: กล้องสดเคยเซฟ '1:1' ทับให้เองทุกครั้งที่กดชัตเตอร์
   * ถ้าปล่อยไว้ รูปจากกล้องเครื่องจะโดนครอปเป็นจัตุรัสทิ้งโดยที่ผู้ใช้ไม่ได้สั่งเลย
   */
  var STORE_MIGRATION = 'nolivecam';
  var JPEG_QUALITY = 0.95;

  /* ต้องตรงกับ BUILD ใน sw.js และ ?v= ใน index.html — โชว์บนหน้าจอไว้เช็กว่าเครื่องได้ของใหม่แล้ว */
  var BUILD = '20261014b';

  // ให้ตัวกู้โค้ดค้างใน index.html รู้ว่าไฟล์นี้เป็นรุ่นไหน (ดูคำอธิบายในไฟล์นั้น)
  window.MarkingPhotosBuild = BUILD;

  /* ประเภทรูป — ต่อท้ายเลขงานเป็นชื่อไฟล์ เลือกหรือไม่เลือกก็ได้ */
  var PHOTO_TYPES = ['Front', 'Front-Ruler', 'Rear-Ruler', 'Horizental-Side', 'Vertical-Ruler'];

  /*
   * โหมดแถบ: ต่อแถบใต้ภาพแล้ววางป้ายในแถบ ภาพจึงไม่ถูกป้ายบังและไม่ต้องครอปทิ้ง
   *
   * สไลเดอร์ในโหมดนี้คุม "ความสูงแถบเทียบกับความสูงภาพ" ไม่ใช่ความกว้างป้ายเทียบความกว้างภาพ
   * เพราะถ้าอิงความกว้าง รูปแนวนอนจะได้แถบหนากว่ารูปแนวตั้งเกือบเท่าตัวทั้งที่เลื่อนเท่ากัน
   */
  /*
   * สัดส่วนกรอบที่เลือกได้ เก็บเป็น "ด้านยาว:ด้านสั้น" แล้วค่อยพลิกตามแนวของภาพเอง
   * รูปนอนได้ 4:3 รูปตั้งได้ 3:4 — หมุนเครื่องแล้วพื้นที่ภาพเท่าเดิม ไม่มีการบีบ
   */
  var ASPECTS = [
    { id: 'full', label: 'เต็มภาพ', long: 0, short: 0 },
    { id: '1:1', label: '1:1', long: 1, short: 1 },
    { id: '4:3', label: '4:3', long: 4, short: 3 },
    { id: '16:9', label: '16:9', long: 16, short: 9 }
  ];

  var CROP_MAX_ZOOM = 10;        // ซูมกรอบตัดเข้าได้สูงสุดกี่เท่า
  var CROP_WHEEL_RATE = 0.0015;  // ล้อเมาส์บนคอม: 1 คลิก ≈ 15% · กด Shift ค้าง = ละเอียดขึ้น
  var CROP_WHEEL_RATE_FINE = 0.0004;

  var BAND_FILL = 0.62;          // ป้ายสูงกี่ส่วนของแถบ ที่เหลือเป็นขอบบน-ล่างเท่า ๆ กัน
  var BAND_MIN = 0.06;
  var BAND_MAX = 0.28;
  var BAND_PLATE_MAX_W = 0.92;   // ป้ายกว้างได้ไม่เกินนี้เทียบความกว้างภาพ
  var BAND_BG = '#12161c';

  var state = {
    code: '',
    photoType: '',
    aspect: 'full',        // สัดส่วนกรอบภาพ ดู ASPECTS — ตั้งต้นคือไม่ตัดอะไรเลย
    crop: { scale: 1, cx: 0.5, cy: 0.5 },   // กรอบตัด: ระดับซูม + จุดกึ่งกลาง (สัดส่วน 0-1 ของรูป)
    plateMode: 'band',     // 'band' = ป้ายใต้ภาพ, 'inside' = ป้ายทับอยู่ในภาพ (แบบโปรแกรมพีซี)
    bandHeight: 0.12,      // ความสูงแถบเทียบความสูงภาพ (แยกจาก placement.widthRatio ของโหมดทับภาพ)
    placement: { widthRatio: window.Plate.DEFAULT_WIDTH_RATIO, xRatio: 0, yRatio: 0 },
    plateCanvas: null,     // ป้ายความละเอียดเต็มของรหัสปัจจุบัน (ใช้ตอนรวมภาพ ไม่เอาลง DOM)
    plateURL: '',          // ภาพป้ายสำหรับแสดงผล — แต่ละกล่องมี <img> ของตัวเอง
    photoSource: null,     // รูปดิบที่กำลังตรวจอยู่ (ImageBitmap หรือ canvas) — เก็บก้อนเดียว
    rotation: 0,           // 0/90/180/270 องศา สำหรับรูปที่มาเอียง
    saveDir: null,         // โฟลเดอร์ประจำบนคอม (FileSystemDirectoryHandle) ถ้าตั้งไว้
    saving: false
  };

  /* ---------------- เก็บค่าล่าสุด ---------------- */

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (err) { return {}; }
  }

  function saveStore(patch) {
    var data = loadStore();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) data[k] = patch[k];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (err) { /* โหมดส่วนตัว */ }
  }

  /* ---------------- ข้อความแจ้งเตือน ---------------- */

  /*
   * ต้องมีทางออกให้ผู้ใช้เสมอเมื่อมีอะไรพัง
   * ไม่งั้นแอปที่ติดตั้งบนหน้าโฮมจะเปิดไม่ขึ้นแล้วผู้ใช้แก้เองไม่ได้เลย
   */
  function showFatal(message) {
    var bar = document.getElementById('fatal');
    if (!bar) return;
    document.getElementById('fatal-msg').textContent =
      String((message && message.message) || message || 'ไม่ทราบสาเหตุ');
    bar.hidden = false;
  }

  function hardReset() {
    var jobs = [];
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ไม่เป็นไร */ }
    if (window.caches) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).catch(function () {}));
    }
    if (navigator.serviceWorker) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.unregister(); }));
      }).catch(function () {}));
    }
    Promise.all(jobs).then(function () {
      location.replace(location.pathname + '?fresh=' + Date.now());
    });
  }

  /*
   * บังคับดึงโค้ดรุ่นใหม่โดยไม่ต้องให้ผู้ใช้ไปล้างแคชเบราว์เซอร์เอง
   * บน iOS แอปที่เปิดจากหน้าโฮมแทบไม่เคยเช็ก sw.js ตัวใหม่ให้เลย จึงต้องมีปุ่มสั่งเอง
   */
  function checkUpdate() {
    var btn = $('btn-update');
    btn.disabled = true;
    btn.textContent = 'กำลังตรวจ...';

    var job = navigator.serviceWorker
      ? navigator.serviceWorker.getRegistration().then(function (reg) {
          if (!reg) return null;
          return reg.update().then(function () {
            var fresh = reg.installing || reg.waiting;
            if (fresh) fresh.postMessage('skip-waiting');
            return fresh;
          });
        }).catch(function () { return null; })
      : Promise.resolve(null);

    // ให้เวลา service worker ติดตั้งตัวใหม่สักพัก แล้วค่อยโหลดหน้าใหม่แบบเลี่ยงแคช
    job.then(function () { return new Promise(function (r) { setTimeout(r, 1500); }); })
      .then(function () {
        location.replace(location.pathname + '?u=' + Date.now());
      });
  }

  window.addEventListener('error', function (e) { showFatal(e.message); });
  window.addEventListener('unhandledrejection', function (e) { showFatal(e.reason); });

  var toastTimer = null;
  function toast(message, ms) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3200);
  }

  function showScreen(id) {
    ['screen-code', 'screen-review'].forEach(function (s) {
      $(s).classList.toggle('is-active', s === id);
    });
  }

  /* ---------------- หน้าเลขที่งาน ---------------- */

  function setActionsEnabled(on) {
    ['btn-native', 'btn-pick'].forEach(function (id) { $(id).disabled = !on; });
  }

  /*
   * ทุกที่ที่โชว์ป้ายต้องมี <img> ของตัวเอง ห้ามใช้ node เดียวกันร่วมกัน
   * ไม่งั้นพอ resize (เช่นคีย์บอร์ดเด้งบนมือถือ) กล่องหนึ่งจะดึงป้ายไปจากอีกกล่อง
   */
  function plateImage(alt) {
    var img = new Image();
    img.alt = alt || '';
    img.decoding = 'async';
    img.src = state.plateURL;
    return img;
  }

  var previewToken = 0;

  function refreshPreview() {
    var info = window.Plate.analyzeCode($('in-code').value);
    state.code = info.code;

    var input = $('in-code');
    var note = $('code-note');
    input.classList.toggle('is-warn', info.level === 'warn');
    input.classList.toggle('is-error', info.level === 'error');
    note.className = 'note' +
      (info.level === 'warn' ? ' is-warn' : info.level === 'error' ? ' is-error' : '');
    note.textContent = info.level === 'empty' ? 'พิมพ์ได้เลย เช่น LP-2609-0045' : info.message;

    // ผิดรูปแบบแค่เตือน ยังถ่ายต่อได้ — วาดป้ายไม่ได้เท่านั้นที่บล็อก
    var usable = info.level === 'ok' || info.level === 'warn';
    setActionsEnabled(usable);
    updateNamePreview();

    var token = ++previewToken;
    if (!usable) {
      state.plateCanvas = null;
      $('plate-preview').innerHTML = '';
      return;
    }

    window.Plate.renderPlate(info.code).then(function (canvas) {
      if (token !== previewToken) return;
      state.plateCanvas = canvas;
      state.plateURL = canvas.toDataURL('image/png');
      var box = $('plate-preview');
      box.innerHTML = '';
      box.appendChild(plateImage(info.code));
    }).catch(function (err) {
      if (token !== previewToken) return;
      state.plateCanvas = null;
      $('plate-preview').innerHTML = '';
      note.className = 'note is-error';
      note.textContent = err.message;
      setActionsEnabled(false);
    });
  }

  function setupCodeScreen() {
    var store = loadStore();
    if (store.migration !== STORE_MIGRATION) {
      store.aspect = null;
      saveStore({ migration: STORE_MIGRATION, aspect: null });
    }
    var input = $('in-code');
    input.value = store.code || '';
    if (store.placement) state.placement = store.placement;
    if (store.aspect && ASPECTS.some(function (a) { return a.id === store.aspect; })) {
      state.aspect = store.aspect;
    }
    if (store.plateMode === 'inside' || store.plateMode === 'band') state.plateMode = store.plateMode;
    if (typeof store.bandHeight === 'number') state.bandHeight = store.bandHeight;
    state.photoType = store.photoType || '';

    input.addEventListener('input', function () {
      // เติมขีดให้เองเมื่อพิมพ์ติดกันมาครบ และเคอร์เซอร์อยู่ท้ายสุด
      if (input.selectionStart === input.value.length) {
        var dashed = window.Plate.autoDash(input.value);
        if (dashed !== window.Plate.normalize(input.value)) input.value = dashed;
      }
      refreshPreview();
      saveStore({ code: input.value });
    });

    input.addEventListener('blur', function () {
      var dashed = window.Plate.autoDash(input.value);
      if (dashed !== input.value) {
        input.value = dashed;
        refreshPreview();
        saveStore({ code: input.value });
      }
    });

    buildTypeChips();
    refreshPreview();
  }

  /* ---------------- ประเภทรูป + ชื่อไฟล์ ---------------- */

  function buildTypeChips() {
    var box = $('type-chips');
    box.innerHTML = '';
    PHOTO_TYPES.forEach(function (name) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = name;
      chip.addEventListener('click', function () {
        // แตะซ้ำที่อันเดิม = ยกเลิก กลับไปไม่ระบุประเภท
        state.photoType = (state.photoType === name) ? '' : name;
        syncTypeChips();
        saveStore({ photoType: state.photoType });
      });
      box.appendChild(chip);
    });
    syncTypeChips();
  }

  function syncTypeChips() {
    var chips = $('type-chips').children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', chips[i].textContent === state.photoType);
    }
    updateNamePreview();
  }

  /* เลขงาน + ประเภทรูป เช่น LP-2609-0045_Front-Ruler.jpg */
  function outputName() {
    var base = state.code || 'plate';
    if (state.photoType) base += '_' + state.photoType;
    return base.replace(/[^A-Za-z0-9_-]/g, '_') + '.jpg';
  }

  function updateNamePreview() {
    $('name-preview').textContent = outputName();
  }

  /* ---------------- สัดส่วนกรอบภาพ ---------------- */

  function aspectDef(id) {
    var want = id || state.aspect;
    for (var i = 0; i < ASPECTS.length; i++) {
      if (ASPECTS[i].id === want) return ASPECTS[i];
    }
    return ASPECTS[0];
  }

  /*
   * กรอบตัดกลางภาพตามสัดส่วนที่เลือก — "ตัด" อย่างเดียว ไม่มีการยืดหรือบีบ
   * สัดส่วนพลิกตามแนวของภาพเอง ภาพตั้งกับภาพนอนจึงกินพื้นที่เซนเซอร์เท่ากัน
   */
  function cropOf(w, h, aspectId) {
    var a = aspectDef(aspectId);
    if (!a.long || !w || !h) return { x: 0, y: 0, w: w, h: h };
    var r = (w >= h) ? (a.long / a.short) : (a.short / a.long);
    var cw = Math.round(Math.min(w, h * r));
    var ch = Math.round(Math.min(h, cw / r));
    return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch };
  }

  /*
   * กรอบตัดของรูปที่กำลังตรวจอยู่ (คิดหลังหมุนแล้ว)
   *
   * state.crop เก็บเป็น "จุดกึ่งกลางกรอบ + ระดับซูม" เทียบสัดส่วนของรูป
   * จึงไม่ผูกกับขนาดพิกเซล เปลี่ยนสัดส่วนหรือหมุนรูปแล้วยังอ้างอิงจุดเดิมได้
   * scale = 1 คือกรอบใหญ่สุดเท่าที่สัดส่วนนี้จะกินได้ ซูมเข้าได้อย่างเดียว ขยายเกินรูปไม่ได้
   */
  function cropRect() {
    var s = sourceSize();
    if (!s.w || !s.h) return { x: 0, y: 0, w: 0, h: 0 };
    var base = cropOf(s.w, s.h);
    var w = base.w / state.crop.scale;
    var h = base.h / state.crop.scale;
    return {
      x: Math.round(state.crop.cx * s.w - w / 2),
      y: Math.round(state.crop.cy * s.h - h / 2),
      w: Math.max(1, Math.round(w)),
      h: Math.max(1, Math.round(h))
    };
  }

  /* กันกรอบหลุดออกนอกรูป — บีบที่จุดกึ่งกลาง ไม่ใช่ที่ผลลัพธ์ ตำแหน่งจะได้ไม่ไหลทีละนิด */
  function clampCrop() {
    var s = sourceSize();
    if (!s.w || !s.h) return;
    state.crop.scale = Math.max(1, Math.min(CROP_MAX_ZOOM, state.crop.scale));
    var base = cropOf(s.w, s.h);
    var hx = (base.w / state.crop.scale / 2) / s.w;
    var hy = (base.h / state.crop.scale / 2) / s.h;
    state.crop.cx = Math.max(hx, Math.min(1 - hx, state.crop.cx));
    state.crop.cy = Math.max(hy, Math.min(1 - hy, state.crop.cy));
  }

  function resetCrop() {
    state.crop = { scale: 1, cx: 0.5, cy: 0.5 };
  }

  /* วาดใหม่แค่เฟรมละครั้งระหว่างลาก ไม่งั้นรูปใหญ่ ๆ จะหน่วง */
  var cropRenderReq = 0;
  function scheduleCropRender() {
    if (cropRenderReq) return;
    cropRenderReq = requestAnimationFrame(function () {
      cropRenderReq = 0;
      renderReview();
      reviewPlacement.clamp(state.placement);
      reviewPlacement.render();
    });
  }

  /*
   * ลากรูปเพื่อเลื่อนกรอบ หยิกสองนิ้วเพื่อซูม — เหมือนตอนครอปรูปในแอปทั่วไป
   * ผูกไว้กับพื้นที่ภาพ ส่วนป้าย (โหมดทับภาพ) มีตัวลากของตัวเองที่กันเหตุการณ์ไม่ให้ทะลุลงมา
   */
  function CropController(frameEl) {
    this.frame = frameEl;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    var self = this;
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (ev) {
      frameEl.addEventListener(ev, function (e) { self.handle(ev, e); });
    });
    // บนคอมไม่มีการหยิกสองนิ้ว ใช้ล้อเมาส์ซูมแทน โดยยึดจุดใต้เมาส์ไว้ที่เดิม
    frameEl.addEventListener('wheel', function (e) { self.wheel(e); }, { passive: false });
  }

  CropController.prototype.wheel = function (e) {
    if (!state.photoSource) return;
    e.preventDefault();
    var s = sourceSize();
    var before = cropRect();
    var box = this.frame.getBoundingClientRect();
    if (!box.width || !box.height || !s.w) return;
    var fx = (e.clientX - box.left) / box.width;
    var fy = (e.clientY - box.top) / box.height;
    var ix = before.x + fx * before.w;           // จุดบนรูปที่อยู่ใต้เมาส์
    var iy = before.y + fy * before.h;
    var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    var rate = e.ctrlKey ? 0.01 : (e.shiftKey ? CROP_WHEEL_RATE_FINE : CROP_WHEEL_RATE);
    state.crop.scale *= Math.exp(-dy * rate);
    clampCrop();
    var base = cropOf(s.w, s.h);
    var w = base.w / state.crop.scale, h = base.h / state.crop.scale;
    state.crop.cx = (ix - fx * w + w / 2) / s.w;
    state.crop.cy = (iy - fy * h + h / 2) / s.h;
    clampCrop();
    scheduleCropRender();
  };

  CropController.prototype.handle = function (type, e) {
    if (!state.photoSource) return;
    if (type === 'pointerdown') {
      // บางเบราว์เซอร์โยน error ถ้าจับ pointer ไม่ได้ ห้ามให้ทั้งท่าลากพังตาม
      try { this.frame.setPointerCapture(e.pointerId); } catch (err) { /* ลากต่อได้อยู่ */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.drag = { x: e.clientX, y: e.clientY, cx: state.crop.cx, cy: state.crop.cy };
      } else if (this.pointers.size === 2) {
        this.pinch = { dist: this.distance(), scale: state.crop.scale };
        this.drag = null;
      }
      e.preventDefault();
      return;
    }
    if (type === 'pointermove') {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2 && this.pinch) {
        var d = this.distance();
        if (this.pinch.dist > 0 && d > 0) {
          state.crop.scale = this.pinch.scale * (d / this.pinch.dist);
          clampCrop();
          scheduleCropRender();
        }
      } else if (this.drag) {
        var s = sourceSize();
        var c = cropRect();
        var box = this.frame.getBoundingClientRect();
        if (!box.width || !box.height || !s.w) return;
        // ลากรูปไปทางขวา = อยากเห็นของที่อยู่ทางซ้าย กรอบจึงเลื่อนสวนทางนิ้ว
        state.crop.cx = this.drag.cx - (e.clientX - this.drag.x) * (c.w / box.width) / s.w;
        state.crop.cy = this.drag.cy - (e.clientY - this.drag.y) * (c.h / box.height) / s.h;
        clampCrop();
        scheduleCropRender();
      }
      e.preventDefault();
      return;
    }
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.drag = null;
  };

  CropController.prototype.distance = function () {
    var pts = Array.from(this.pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  /* ---------------- โหมดป้ายใต้ภาพ ---------------- */

  /* ค่าที่สไลเดอร์กำลังคุมอยู่ — คนละความหมายกันในสองโหมด */
  function sliderValue() {
    return state.plateMode === 'band' ? state.bandHeight : state.placement.widthRatio;
  }

  /*
   * คำนวณกล่องผลลัพธ์จากขนาดภาพ: ภาพอยู่บน แถบป้ายต่อล่าง
   * ใช้ทั้งตอนพรีวิว (หน่วย px บนจอ) และตอนรวมภาพจริง (หน่วยพิกเซลของไฟล์)
   * โหมด 'inside' คืนขนาดเท่าภาพเดิม ไม่มีแถบ
   */
  function shotLayout(imgW, imgH) {
    var plain = { w: imgW, h: imgH, band: 0, plateW: 0, plateH: 0 };
    if (state.plateMode !== 'band' || !state.plateCanvas || !imgW || !imgH) return plain;

    var aspect = state.plateCanvas.width / state.plateCanvas.height;
    var plateH = state.bandHeight * BAND_FILL * imgH;
    var plateW = plateH * aspect;
    if (plateW > BAND_PLATE_MAX_W * imgW) {          // รหัสยาว ๆ บนรูปแคบ ต้องหดลงมาให้พอดี
      plateW = BAND_PLATE_MAX_W * imgW;
      plateH = plateW / aspect;
    }
    plateW = Math.max(1, Math.round(plateW));
    plateH = Math.max(1, Math.round(plateH));
    var band = Math.max(1, Math.round(plateH / BAND_FILL));
    return { w: imgW, h: imgH + band, band: band, plateW: plateW, plateH: plateH };
  }

  /*
   * ที่ว่างจริงของเวทีที่กล่อง .shot จะกินได้
   *
   * ⚠️ ต้องหักความสูงของพี่น้องในเวที (บรรทัดคำใบ้ / ข้อความ error) กับ gap ออกก่อน
   * เคยคิดจาก stage.clientHeight ดื้อ ๆ แล้วสั่งความสูงเกินที่มีจริง flex เลยบีบกล่องให้เตี้ยลงเงียบ ๆ
   * (สั่ง 347px ได้จริง 330px) → กรอบผิดสัดส่วน object-fit ตัดหัวท้ายรูปทิ้งในพรีวิว
   * แต่ไฟล์ที่บันทึกได้ภาพครบ ป้ายกับภาพจึงเลื่อนไม่ตรงกับที่เห็นบนจอ
   */
  function stageRoom(shotEl) {
    var stage = shotEl.parentElement;
    var cs = window.getComputedStyle(stage);
    var gap = parseFloat(cs.rowGap) || 0;
    var w = stage.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var h = stage.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    var kids = stage.children;
    var used = 0, boxes = 0;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el === shotEl) { boxes++; continue; }
      var kh = el.getBoundingClientRect().height;
      if (kh <= 0.5) continue;            // <p> ที่ยังไม่มีข้อความไม่กินที่และไม่นับ gap
      used += kh;
      boxes++;
    }
    h -= used + gap * Math.max(0, boxes - 1);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  /*
   * จัดขนาดกล่อง .shot ให้พอดีเวทีทั้งกว้างและสูง
   * ต้องคิดเป็น px เอง เพราะ aspect-ratio ของ CSS ทำ "contain" สองแกนพร้อมกันไม่ได้
   *
   * ใช้ scale ตัวเดียวคูณทุกส่วน (ภาพ + แถบ) และคง px เป็นทศนิยม
   * กรอบภาพจึงได้สัดส่วนตรงกับรูปเป๊ะ ๆ ไม่ต้องพึ่งการปัดเศษให้บังเอิญลงตัว
   */
  function applyShot(shotEl, bandEl, imgW, imgH) {
    var L = shotLayout(imgW, imgH);
    if (!L.w || !L.h) return L;

    var room = stageRoom(shotEl);
    // หน้าจอยังซ่อนอยู่ = วัดขนาดไม่ได้ อย่าเขียนค่ามั่ว ๆ ทับของเดิม เดี๋ยวโผล่มาแล้วกล่องเหลือ 1px
    if (room.w < 2 || room.h < 2) return L;
    var scale = Math.min(room.w / L.w, room.h / L.h);
    var frameH = imgH * scale;                 // พื้นที่ภาพล้วน — ต้องเท่าสัดส่วนรูปเป๊ะ
    var bandH = L.band * scale;
    shotEl.style.width = (L.w * scale).toFixed(2) + 'px';
    shotEl.style.height = (frameH + bandH).toFixed(2) + 'px';

    bandEl.hidden = !L.band;
    if (L.band) {
      bandEl.style.height = bandH.toFixed(2) + 'px';   // px ไม่ใช่ % เศษจะได้ไม่ไปโผล่ที่กรอบภาพ
      var img = bandEl.firstElementChild;
      if (!img || img.tagName !== 'IMG') {
        bandEl.innerHTML = '';
        img = plateImage(state.code);
        bandEl.appendChild(img);
      } else if (img.getAttribute('src') !== state.plateURL) {
        img.setAttribute('src', state.plateURL);
      }
      img.style.width = (L.plateW / L.w * 100) + '%';
    }
    return L;
  }

  /* ---------------- ตัวควบคุมตำแหน่งป้าย ---------------- */

  /*
   * ผูกป้ายเข้ากับกรอบรูปหนึ่งกรอบ ให้ลากย้าย/หยิกย่อขยายได้
   * ตำแหน่งเก็บเป็นสัดส่วนของรูป (0-1) จึงใช้ได้ทั้งตอนพรีวิวและตอนบันทึกจริง
   */
  function PlacementController(layerEl, frameEl, sliderEl, shotEl, bandEl, imageSize) {
    this.layer = layerEl;
    this.frame = frameEl;
    this.slider = sliderEl;
    this.shot = shotEl;
    this.band = bandEl;
    this.imageSize = imageSize;   // ขนาดภาพจริงหน่วยพิกเซล คืน {w,h}
    this.pointers = new Map();
    this.pinchStart = null;
    this.dragStart = null;
    var self = this;

    layerEl.addEventListener('pointerdown', function (e) { self.onDown(e); });
    layerEl.addEventListener('pointermove', function (e) { self.onMove(e); });
    layerEl.addEventListener('pointerup', function (e) { self.onUp(e); });
    layerEl.addEventListener('pointercancel', function (e) { self.onUp(e); });

    if (sliderEl) {
      sliderEl.addEventListener('input', function () {
        self.setWidthRatio(parseFloat(sliderEl.value));
      });
    }
    window.addEventListener('resize', function () { self.render(); });
  }

  PlacementController.prototype.frameSize = function () {
    var r = this.frame.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  /* สัดส่วนความสูงของป้ายเทียบกับความสูงรูป */
  PlacementController.prototype.heightRatio = function (widthRatio) {
    var size = this.frameSize();
    if (!state.plateCanvas || !size.w || !size.h) return 0;
    var aspect = state.plateCanvas.width / state.plateCanvas.height;
    return (widthRatio * size.w / aspect) / size.h;
  };

  /* กันไม่ให้ป้ายหลุดออกนอกขอบรูป */
  PlacementController.prototype.clamp = function (p) {
    var hr = this.heightRatio(p.widthRatio);
    p.xRatio = Math.max(0, Math.min(1 - p.widthRatio, p.xRatio));
    p.yRatio = Math.max(0, Math.min(1 - hr, p.yRatio));
    return p;
  };

  /* จัดขนาดกล่องภาพ+แถบให้ตรงกับภาพที่กำลังแสดง เรียกได้บ่อยเท่าที่ต้องการ */
  PlacementController.prototype.layout = function () {
    var s = this.imageSize();
    if (!s.w || !s.h) return;
    applyShot(this.shot, this.band, s.w, s.h);
  };

  PlacementController.prototype.render = function () {
    // จัดกล่องก่อนเสมอ แม้ยังไม่มีป้าย — ไม่งั้นกล่องภาพค้างขนาดผิดตั้งแต่ครั้งแรก
    this.layout();
    if (!state.plateCanvas) return;
    if (state.plateMode === 'band') {
      this.layer.hidden = true;                        // ป้ายอยู่ในแถบ ไม่ต้องมีตัวลากทับภาพ
      if (this.slider) this.slider.value = String(state.bandHeight);
      return;
    }
    var size = this.frameSize();
    var p = state.placement;
    this.layer.hidden = false;
    this.layer.style.width = (p.widthRatio * size.w) + 'px';
    this.layer.style.left = (p.xRatio * size.w) + 'px';
    this.layer.style.top = (p.yRatio * size.h) + 'px';
    var img = this.layer.firstElementChild;
    if (!img || img.tagName !== 'IMG') {
      this.layer.innerHTML = '';
      img = plateImage(state.code);
      this.layer.appendChild(img);
    } else if (img.getAttribute('src') !== state.plateURL) {
      img.setAttribute('src', state.plateURL);
    }
    if (this.slider) this.slider.value = String(p.widthRatio);
  };

  /* เปลี่ยนขนาดโดยยึดจุดกึ่งกลางป้ายไว้ที่เดิม (เหมือนล้อเมาส์ในโปรแกรมพีซี) */
  PlacementController.prototype.setWidthRatio = function (next) {
    if (state.plateMode === 'band') {
      // ในแถบป้ายอยู่กลางเสมอ เลื่อนแล้วแถบหนา/บางตาม ไม่มีเรื่องตำแหน่งให้คิด
      state.bandHeight = Math.max(BAND_MIN, Math.min(BAND_MAX, next));
      this.render();
      saveStore({ bandHeight: state.bandHeight });
      return;
    }
    next = Math.max(0.15, Math.min(0.95, next));
    var p = state.placement;
    var oldH = this.heightRatio(p.widthRatio);
    var newH = this.heightRatio(next);
    p.xRatio += (p.widthRatio - next) / 2;
    p.yRatio += (oldH - newH) / 2;
    p.widthRatio = next;
    this.clamp(p);
    this.render();
    saveStore({ placement: p });
  };

  PlacementController.prototype.onDown = function (e) {
    if (state.plateMode === 'band') return;
    // กันไม่ให้การลากป้ายทะลุลงไปเลื่อนกรอบตัดของรูปด้วย
    e.stopPropagation();
    try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* ลากต่อได้อยู่ */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.layer.classList.add('is-dragging');
    if (this.pointers.size === 1) {
      var size = this.frameSize();
      this.dragStart = {
        x: e.clientX, y: e.clientY,
        xRatio: state.placement.xRatio, yRatio: state.placement.yRatio,
        w: size.w, h: size.h
      };
    } else if (this.pointers.size === 2) {
      this.pinchStart = { dist: this.pointerDistance(), widthRatio: state.placement.widthRatio };
      this.dragStart = null;
    }
    e.preventDefault();
  };

  PlacementController.prototype.pointerDistance = function () {
    var pts = Array.from(this.pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  PlacementController.prototype.onMove = function (e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.stopPropagation();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2 && this.pinchStart) {
      var dist = this.pointerDistance();
      if (this.pinchStart.dist > 0 && dist > 0) {
        this.setWidthRatio(this.pinchStart.widthRatio * (dist / this.pinchStart.dist));
      }
    } else if (this.dragStart) {
      var d = this.dragStart;
      var p = state.placement;
      p.xRatio = d.xRatio + (e.clientX - d.x) / d.w;
      p.yRatio = d.yRatio + (e.clientY - d.y) / d.h;
      this.clamp(p);
      this.render();
    }
    e.preventDefault();
  };

  PlacementController.prototype.onUp = function (e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) {
      this.layer.classList.remove('is-dragging');
      this.dragStart = null;
      saveStore({ placement: state.placement });
    }
  };

  /* วางป้ายกลางล่างของรูป เว้นขอบ 3% เหมือนค่าเริ่มต้นของโปรแกรมพีซี */
  PlacementController.prototype.resetToBottom = function () {
    if (state.plateMode === 'band') return;
    var p = state.placement;
    var hr = this.heightRatio(p.widthRatio);
    p.xRatio = (1 - p.widthRatio) / 2;
    p.yRatio = 1 - window.AutoPlace.EDGE_MARGIN_RATIO - hr;
    this.clamp(p);
    this.render();
    saveStore({ placement: p });
  };

  var reviewPlacement = null;

  /* ---------------- เลือกสัดส่วนภาพ ---------------- */

  function buildAspectChips(id) {
    var box = $(id);
    box.innerHTML = '';
    ASPECTS.forEach(function (a) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = a.label;
      chip.setAttribute('data-aspect', a.id);
      chip.addEventListener('click', function () { setAspect(a.id); });
      box.appendChild(chip);
    });
  }

  function syncAspectChips() {
    var chips = $('review-aspect').children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', chips[i].getAttribute('data-aspect') === state.aspect);
    }
  }

  /*
   * เปลี่ยนสัดส่วนของรูปที่ถ่ายมาแล้ว จึงตัดได้แคบลงอย่างเดียว ขยายคืนไม่ได้
   * (กล้องของแอปล็อก 1:1 ไว้ ไม่มีให้เลือกตรงนั้น)
   */
  function setAspect(id) {
    state.aspect = id;
    saveStore({ aspect: id });
    syncAspectChips();
    if (state.photoSource) {
      clampCrop();          // สัดส่วนใหม่อาจทำให้กรอบเดิมล้นออกนอกรูป
      renderReview();
      reviewPlacement.clamp(state.placement);
      reviewPlacement.render();
    }
  }

  /* ---------------- สลับโหมดป้าย ---------------- */

  function setPlateMode(mode) {
    if (mode !== 'band' && mode !== 'inside') return;
    state.plateMode = mode;
    saveStore({ plateMode: mode });
    syncModeUI();
    if (reviewPlacement) reviewPlacement.render();
  }

  function syncModeUI() {
    var btns = $('review-mode').children;
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('is-on', btns[i].getAttribute('data-mode') === state.plateMode);
    }
    // ปุ่มจัดตำแหน่งไม่มีความหมายในโหมดแถบ ป้ายอยู่กลางแถบตายตัว
    var band = state.plateMode === 'band';
    $('btn-auto').hidden = band;

    // สไลเดอร์ตัวเดียวกันแต่คุมคนละอย่าง จึงต้องเปลี่ยนทั้งช่วงค่าและป้ายกำกับ
    var sl = $('sl-review-size');
    sl.min = band ? BAND_MIN : 0.15;
    sl.max = band ? BAND_MAX : 0.95;
    sl.step = band ? 0.005 : 0.01;
    sl.value = String(sliderValue());
    $('lb-review-size').textContent = band ? 'ความสูงแถบ' : 'ขนาดป้าย';
  }

  function bindModeSeg(id) {
    $(id).addEventListener('click', function (e) {
      var btn = e.target.closest('.seg__btn');
      if (btn) setPlateMode(btn.getAttribute('data-mode'));
    });
  }

  /* ---------------- หน้าตรวจรูป ---------------- */

  /*
   * ขนาดรูปในเครื่อง Safari บนมือถือมีเพดานหน่วยความจำ canvas
   * รูป 12 ล้านพิกเซลกินราว 48MB ต่อ canvas หนึ่งใบ ถ้าเปิดพร้อมกันหลายใบ
   * (ตัวรูป + ตัวแสดงผล + ตัวรวมภาพ) iOS จะฆ่าหน้าเว็บทิ้ง แล้วเปิดใหม่ไม่ขึ้น
   * จึงต้องคุมทั้งขนาดที่แสดงผลและขนาดไฟล์ที่บันทึก และเก็บรูปดิบไว้ก้อนเดียว
   */
  var MAX_OUTPUT_SIDE = 3000;   // ด้านยาวสุดของไฟล์ที่บันทึก
  var MAX_PREVIEW_SIDE = 1400;  // ด้านยาวสุดของภาพที่โชว์บนหน้าจอ

  /* ขนาดรูปหลังหมุนแล้ว */
  function sourceSize() {
    var s = state.photoSource;
    if (!s) return { w: 0, h: 0 };
    var w = s.width || s.naturalWidth || 0;
    var h = s.height || s.naturalHeight || 0;
    var turned = (state.rotation === 90 || state.rotation === 270);
    return { w: turned ? h : w, h: turned ? w : h };
  }

  function fitted(size, maxSide) {
    var k = Math.min(1, maxSide / Math.max(size.w, size.h, 1));
    return { w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
  }

  /*
   * วาดรูปดิบลง ctx: หมุนตามที่ผู้ใช้สั่ง แล้วตัดตามกรอบสัดส่วนที่เลือก
   * ใช้ scale ตัวเดียวกันทั้งแกน x และ y จึงไม่มีทางบีบภาพไม่ว่ากรณีใด
   */
  function drawPhotoInto(ctx, outW, outH) {
    var full = sourceSize();          // ขนาดรูปหลังหมุน (ยังไม่ตัด)
    var crop = cropRect();            // กรอบตัด ในพิกัดเดียวกัน
    if (!full.w || !crop.w) return;
    var scale = outW / crop.w;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(-crop.x * scale, -crop.y * scale);   // เลื่อนให้กรอบตัดมาอยู่มุมซ้ายบน

    var rot = state.rotation;
    var turned = (rot === 90 || rot === 270);
    var fw = full.w * scale, fh = full.h * scale;
    if (rot === 90) { ctx.translate(fw, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(fw, fh); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, fh); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(state.photoSource, 0, 0, turned ? fh : fw, turned ? fw : fh);
    ctx.restore();
  }

  /* คืนหน่วยความจำของรูปเก่า ไม่งั้นถ่ายไปเรื่อย ๆ แล้วแอปจะโดนระบบฆ่า */
  function releasePhoto(keep) {
    var old = state.photoSource;
    if (old && old !== keep) {
      if (typeof old.close === 'function') old.close();
      else if (old.tagName === 'CANVAS') { old.width = 0; old.height = 0; }
    }
    if (!keep) state.photoSource = null;
  }

  function renderReview() {
    var view = fitted(cropRect(), MAX_PREVIEW_SIDE);
    if (!view.w) return;
    var display = $('review-canvas');
    display.width = view.w;
    display.height = view.h;
    drawPhotoInto(display.getContext('2d'), view.w, view.h);
    reviewPlacement.layout();
  }

  function openReview(source) {
    releasePhoto(source);
    state.photoSource = source;
    state.rotation = 0;
    resetCrop();          // รูปใหม่เริ่มที่กลางภาพเสมอ

    renderReview();
    $('review-code').textContent = state.code;
    syncTypeChips();
    showScreen('screen-review');
    requestAnimationFrame(function () {
      reviewPlacement.clamp(state.placement);
      reviewPlacement.render();
    });
  }

  /* หมุนรูปทีละ 90 องศา สำหรับรูปจากอัลบั้มที่มาผิดทิศ */
  function rotatePhoto() {
    if (!state.photoSource) return;
    state.rotation = (state.rotation + 90) % 360;
    // หมุนจุดกึ่งกลางกรอบตามไปด้วย ผู้ใช้จะได้ไม่เสียส่วนที่อุตส่าห์เลื่อนไว้
    var c = state.crop;
    var cx = 1 - c.cy;
    c.cy = c.cx;
    c.cx = cx;
    clampCrop();
    renderReview();
    requestAnimationFrame(function () {
      reviewPlacement.clamp(state.placement);
      reviewPlacement.render();
    });
  }

  /* ---------------- ลบวัตถุ (เฉพาะบนคอม) ---------------- */

  /* สำเนารูปเต็มความละเอียดที่หมุนแล้ว แต่ยังไม่ตัดกรอบ — ให้หน้าลบวัตถุแก้บนพิกัดเดียวกับกรอบตัด */
  function rotatedCopy() {
    var s = sourceSize();
    var c = document.createElement('canvas');
    c.width = s.w;
    c.height = s.h;
    var ctx = c.getContext('2d');
    var rot = state.rotation;
    if (rot === 90) { ctx.translate(s.w, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(s.w, s.h); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, s.h); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(state.photoSource, 0, 0);
    return c;
  }

  /*
   * รูปที่ลบวัตถุแล้วมาแทนรูปดิบเลย การหมุนจึงถูกอบลงไปในรูปแล้ว ต้องตั้งกลับเป็น 0
   * กรอบตัดเก็บเป็นสัดส่วนของรูปหลังหมุนอยู่แล้ว จึงอยู่ตำแหน่งเดิมพอดี ไม่ต้องแปลง
   */
  function useRetouched(canvas) {
    releasePhoto(canvas);
    state.photoSource = canvas;
    state.rotation = 0;
    clampCrop();
    renderReview();
    requestAnimationFrame(function () {
      reviewPlacement.clamp(state.placement);
      reviewPlacement.render();
    });
    toast('ใช้รูปที่ลบวัตถุแล้ว');
  }

  function openRetouch() {
    if (!state.photoSource || !window.Retouch) return;
    window.Retouch.start(rotatedCopy, useRetouched);
  }

  function autoPlaceReview() {
    var display = $('review-canvas');
    if (state.plateMode === 'band') return;   // ในโหมดแถบป้ายไม่ได้ทับภาพ ไม่ต้องหาที่ว่าง
    if (!state.photoSource || !state.plateCanvas || !display.width) return;
    var pw = display.width, ph = display.height;
    var plateW = Math.max(32, Math.round(state.placement.widthRatio * pw));
    var plateH = Math.max(1, Math.round(plateW * state.plateCanvas.height / state.plateCanvas.width));
    var pos = window.AutoPlace.autoPosition(display, pw, ph, plateW, plateH);
    state.placement.xRatio = pos.x / pw;
    state.placement.yRatio = pos.y / ph;
    reviewPlacement.clamp(state.placement);
    reviewPlacement.render();
    saveStore({ placement: state.placement });
  }

  /* รวมรูป + ป้าย เป็นภาพเดียว สร้าง canvas ชั่วคราวใบเดียวตอนบันทึกเท่านั้น */
  function composeFinal() {
    var out = fitted(cropRect(), MAX_OUTPUT_SIDE);
    var plate = state.plateCanvas;
    var L = shotLayout(out.w, out.h);

    var canvas = document.createElement('canvas');
    canvas.width = L.w;
    canvas.height = L.h;
    var ctx = canvas.getContext('2d');
    drawPhotoInto(ctx, out.w, out.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (L.band) {
      ctx.fillStyle = BAND_BG;
      ctx.fillRect(0, out.h, L.w, L.band);
      ctx.drawImage(plate,
        Math.round((L.w - L.plateW) / 2),
        Math.round(out.h + (L.band - L.plateH) / 2),
        L.plateW, L.plateH);
      return canvas;
    }

    var p = state.placement;
    var w = Math.max(1, Math.round(p.widthRatio * out.w));
    var h = Math.max(1, Math.round(w * plate.height / plate.width));
    ctx.drawImage(plate, Math.round(p.xRatio * out.w), Math.round(p.yRatio * out.h), w, h);
    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('สร้างไฟล์รูปไม่สำเร็จ'));
      }, 'image/jpeg', JPEG_QUALITY);
    });
  }

  /* ---------------- บันทึกลงโฟลเดอร์ (เฉพาะเบราว์เซอร์บนคอม) ---------------- */

  /*
   * Chrome/Edge บนคอมเขียนไฟล์ลงโฟลเดอร์ที่ผู้ใช้เลือกได้เอง (File System Access API)
   * ไม่มีบน Safari, Firefox และมือถือทุกตัว — จึงต้องมีทางเดิม (share sheet / ดาวน์โหลด) สำรองไว้เสมอ
   *
   * ตั้งโฟลเดอร์ประจำไว้ครั้งเดียว หลังจากนั้นกดบันทึกแล้วไฟล์ลงโฟลเดอร์นั้นเลย ไม่มีหน้าต่างถาม
   * ตัว handle เก็บลง IndexedDB (localStorage เก็บไม่ได้ เพราะไม่ใช่ข้อความ) จึงอยู่ข้ามการปิดเปิดแอป
   */
  var CAN_PICK_FILE = typeof window.showSaveFilePicker === 'function';
  var CAN_PICK_DIR = typeof window.showDirectoryPicker === 'function';
  var DIR_DB = 'markingphotos';
  var DIR_STORE = 'handles';
  var DIR_KEY = 'outdir';

  function dirStore(mode) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('เครื่องนี้ไม่มี IndexedDB')); return; }
      var req = indexedDB.open(DIR_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DIR_STORE)) req.result.createObjectStore(DIR_STORE);
      };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result;
        var tx = db.transaction(DIR_STORE, mode);
        tx.oncomplete = function () { db.close(); };
        resolve(tx.objectStore(DIR_STORE));
      };
    });
  }

  function loadSaveDir() {
    if (!CAN_PICK_DIR) return Promise.resolve(null);
    return dirStore('readonly').then(function (store) {
      return new Promise(function (resolve) {
        var req = store.get(DIR_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function storeSaveDir(handle) {
    return dirStore('readwrite').then(function (store) {
      if (handle) store.put(handle, DIR_KEY);
      else store.delete(DIR_KEY);
    }).catch(function () {
      // จำไม่ได้ก็ยังใช้งานรอบนี้ได้ แต่ต้องบอก ไม่งั้นผู้ใช้จะงงว่าทำไมเปิดใหม่แล้วโฟลเดอร์หาย
      if (handle) toast('ตั้งโฟลเดอร์ให้รอบนี้ได้ แต่จำข้ามการเปิดใหม่ไม่ได้');
    });
  }

  /*
   * สิทธิ์เขียนโฟลเดอร์หมดอายุเมื่อปิดแท็บ ต้องขอใหม่ครั้งแรกของแต่ละรอบ
   * และต้องขอ "ตอนที่ผู้ใช้เพิ่งกดปุ่ม" เท่านั้น เบราว์เซอร์ถึงจะยอมเปิดกล่องถาม
   */
  function ensureDirPermission(handle) {
    if (!handle || !handle.queryPermission) return Promise.resolve(false);
    var opts = { mode: 'readwrite' };
    return handle.queryPermission(opts).then(function (level) {
      if (level === 'granted') return true;
      return handle.requestPermission(opts).then(function (next) { return next === 'granted'; });
    }).catch(function () { return false; });
  }

  function setSaveDir(handle) {
    state.saveDir = handle || null;
    storeSaveDir(state.saveDir);
    syncSaveDirUI();
  }

  function syncSaveDirUI() {
    var row = $('savedir');
    row.hidden = !(CAN_PICK_DIR || CAN_PICK_FILE);
    if (row.hidden) return;
    var has = !!state.saveDir;
    $('savedir-name').textContent = has ? state.saveDir.name : 'ถามที่เก็บทุกครั้ง';
    $('btn-savedir').textContent = has ? 'เปลี่ยนโฟลเดอร์' : 'ตั้งโฟลเดอร์ประจำ';
    $('btn-savedir').hidden = !CAN_PICK_DIR;
    $('btn-savedir-clear').hidden = !has;
  }

  function chooseSaveDir() {
    window.showDirectoryPicker({ mode: 'readwrite', startIn: 'pictures' }).then(function (handle) {
      return ensureDirPermission(handle).then(function (ok) {
        if (!ok) { toast('ยังไม่ได้อนุญาตให้เขียนลงโฟลเดอร์นี้'); return; }
        setSaveDir(handle);
        toast('ต่อไปกดบันทึกแล้วไฟล์จะลง "' + handle.name + '" เลย');
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;      // ผู้ใช้กดยกเลิกเอง
      toast('เลือกโฟลเดอร์ไม่ได้: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
    });
  }

  /* ไม่เขียนทับของเดิม — ถ่ายซ้ำประเภทเดิมให้ได้ _2 _3 ต่อท้ายไปเรื่อย ๆ */
  function freeName(dir, name) {
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var step = function (n) {
      var candidate = n === 1 ? name : base + '_' + n + ext;
      if (n > 99) return Promise.resolve(candidate);
      return dir.getFileHandle(candidate).then(
        function () { return step(n + 1); },      // ชื่อนี้มีอยู่แล้ว ลองเลขถัดไป
        function () { return candidate; }         // หาไม่เจอ = ว่าง ใช้ชื่อนี้ได้
      );
    };
    return step(1);
  }

  function writeInto(dir, name, blob) {
    return freeName(dir, name).then(function (finalName) {
      return dir.getFileHandle(finalName, { create: true }).then(function (fh) {
        return fh.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).then(function () {
        toast('บันทึก ' + finalName + ' ลง "' + dir.name + '" แล้ว');
      });
    });
  }

  /* ---------------- บันทึก ---------------- */

  /*
   * บันทึกรูป — ไล่จากทางที่ดีที่สุดที่เครื่องนั้นทำได้ลงมา
   *   1. โฟลเดอร์ประจำที่ตั้งไว้ (คอม) — ไม่มีหน้าต่างถามเลย ได้ชื่อไฟล์ที่ตั้งไว้ครบ
   *   2. หน้าต่างเลือกที่เก็บของระบบ (คอม) — เติมชื่อไฟล์ให้เสร็จแล้ว
   *   3. share sheet (มือถือ) — iOS ไม่มี API เขียนลง Photos ต้องแตะ "Save Image" อีกหนึ่งครั้ง
   *   4. ดาวน์โหลดธรรมดา
   *
   * ⚠️ หน้าต่างเลือกไฟล์กับกล่องขอสิทธิ์ ต้องเรียก "ก่อน" ไปรวมภาพ
   * เบราว์เซอร์ยอมเปิดให้เฉพาะจังหวะที่ผู้ใช้เพิ่งกดปุ่มเท่านั้น
   * ถ้าไปรอ canvas.toBlob ของรูป 3000px ก่อน จังหวะนั้นหมดอายุแล้วจะโดนบล็อกเงียบ ๆ
   */
  function saveResult() {
    if (state.saving) return;
    state.saving = true;
    $('btn-save').disabled = true;

    var name = outputName();
    var target = state.saveDir
      ? ensureDirPermission(state.saveDir).then(function (ok) {
          if (ok) return { dir: state.saveDir };
          setSaveDir(null);
          toast('โฟลเดอร์เดิมใช้ไม่ได้แล้ว ตั้งใหม่อีกครั้ง');
          return {};
        })
      : Promise.resolve({});

    target.then(function (dest) {
      if (dest.dir || !CAN_PICK_FILE) return dest;
      return window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'รูป JPEG', accept: { 'image/jpeg': ['.jpg'] } }]
      }).then(function (file) { return { file: file }; },
              function (err) { return { aborted: !!(err && err.name === 'AbortError') }; });
    }).then(function (dest) {
      if (dest.aborted) return;

      var work = composeFinal();
      return canvasToBlob(work).then(function (blob) {
        work.width = 0;          // คืนหน่วยความจำทันทีที่ได้ไฟล์แล้ว
        work.height = 0;
        if (dest.dir) return writeInto(dest.dir, name, blob);
        if (dest.file) {
          return dest.file.createWritable().then(function (w) {
            return w.write(blob).then(function () { return w.close(); });
          }).then(function () { toast('บันทึก ' + dest.file.name + ' แล้ว'); });
        }

        var file = new File([blob], name, { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file] }).then(function () {
            toast('แตะ "Save Image" เพื่อเก็บลงอัลบั้ม');
          }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            downloadBlob(blob, name);
          });
        }
        downloadBlob(blob, name);
      });
    }).catch(function (err) {
      toast((err && err.message) || 'บันทึกไม่สำเร็จ');
    }).then(function () {
      state.saving = false;
      $('btn-save').disabled = false;
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('บันทึกไฟล์แล้ว — ดูในแอป Files/ดาวน์โหลด');
  }

  /* ---------------- รูปจากกล้องเครื่อง / อัลบั้ม ---------------- */

  function loadPhotoFile(file) {
    if (!file) return;
    toast('กำลังเปิดรูป...', 1500);
    var work;
    if (window.createImageBitmap) {
      work = createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return loadViaImgTag(file);
      });
    } else {
      work = loadViaImgTag(file);
    }
    // เก็บรูปดิบไว้ตรง ๆ ไม่ก็อปลง canvas อีกใบ (ประหยัดหน่วยความจำครึ่งหนึ่ง)
    work.then(function (source) {
      openReview(source);
      autoPlaceReview();
    }).catch(function () {
      toast('เปิดรูปนี้ไม่ได้');
    });
  }

  function loadViaImgTag(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('โหลดรูปไม่ได้')); };
      img.src = url;
    });
  }

  /* ---------------- ผูกปุ่มทั้งหมด ---------------- */

  function init() {
    reviewPlacement = new PlacementController(
      $('review-plate'), $('review-frame'), $('sl-review-size'), $('review-shot'), $('review-band'),
      cropRect);

    setupCodeScreen();
    bindModeSeg('review-mode');
    syncModeUI();
    buildAspectChips('review-aspect');
    syncAspectChips();

    $('btn-native').addEventListener('click', function () { $('file-native').click(); });
    $('btn-pick').addEventListener('click', function () { $('file-pick').click(); });
    $('file-native').addEventListener('change', function (e) {
      loadPhotoFile(e.target.files[0]);
      e.target.value = '';
    });
    $('file-pick').addEventListener('change', function (e) {
      loadPhotoFile(e.target.files[0]);
      e.target.value = '';
    });

    $('btn-rotate').addEventListener('click', rotatePhoto);
    new CropController($('review-frame'));
    $('btn-crop-reset').addEventListener('click', function () {
      if (!state.photoSource) return;
      resetCrop();
      scheduleCropRender();
    });

    $('btn-review-back').addEventListener('click', function () {
      releasePhoto();
      showScreen('screen-code');
      refreshPreview();       // ดึงรูปป้ายกลับมาไว้ในกล่องตัวอย่าง
    });

    $('btn-auto').addEventListener('click', autoPlaceReview);

    // ปุ่มลบวัตถุโผล่เฉพาะบนคอม — มือถือเรียกตัวช่วยบนคอมไม่ได้ ซ่อนไว้ไม่ให้หน้าจอเปลี่ยน
    if (window.Retouch && window.Retouch.supported()) {
      $('btn-retouch').hidden = false;
      $('btn-retouch').addEventListener('click', openRetouch);
      document.querySelector('#screen-review .hint').textContent =
        'ลากรูปเพื่อเลื่อนกรอบ · หมุนล้อเมาส์เพื่อซูม (กด Shift ค้าง = ละเอียด)';
    }
    $('btn-save').addEventListener('click', saveResult);

    syncSaveDirUI();
    loadSaveDir().then(function (handle) { if (handle) { state.saveDir = handle; syncSaveDirUI(); } });
    $('btn-savedir').addEventListener('click', chooseSaveDir);
    $('btn-savedir-clear').addEventListener('click', function () {
      setSaveDir(null);
      toast('กลับไปถามที่เก็บทุกครั้ง');
    });
    $('btn-reset').addEventListener('click', hardReset);

    $('build-id').textContent = 'รุ่น ' + BUILD;
    $('btn-update').addEventListener('click', checkUpdate);
    $('btn-hardreset').addEventListener('click', hardReset);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // เช็กรุ่นใหม่ทุกครั้งที่กลับเข้าแอป ไม่ต้องรอให้เบราว์เซอร์นึกได้เอง
        reg.update().catch(function () {});
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) reg.update().catch(function () {});
        });
      }).catch(function () { /* ใช้ต่อได้แม้ลงทะเบียนไม่สำเร็จ */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
