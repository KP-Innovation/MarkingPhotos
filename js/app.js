/*
 * ป้ายเลขที่งาน — แอปกล้องมือถือ (PWA)
 *
 * สองโหมด
 *   1. กล้องสด   — เห็นป้ายลอยอยู่ในภาพตั้งแต่ตอนเล็ง กะระยะได้ก่อนกด
 *   2. กล้องเครื่อง — เรียกแอปกล้องของเครื่อง (ภาพคมเต็มคุณภาพ) แล้วมาวางป้ายทีหลัง
 *
 * ทั้งสองโหมดจบที่หน้าเดียวกัน: ป้ายยังขยับ/ย่อขยายได้จนกว่าจะกดบันทึก
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE_KEY = 'markingphotos.v1';
  var JPEG_QUALITY = 0.95;

  /* ต้องตรงกับ BUILD ใน sw.js และ ?v= ใน index.html — โชว์บนหน้าจอไว้เช็กว่าเครื่องได้ของใหม่แล้ว */
  var BUILD = '20260810f';

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

  var CROP_MAX_ZOOM = 6;         // ซูมกรอบตัดเข้าได้สูงสุดกี่เท่า

  var BAND_FILL = 0.62;          // ป้ายสูงกี่ส่วนของแถบ ที่เหลือเป็นขอบบน-ล่างเท่า ๆ กัน
  var BAND_MIN = 0.06;
  var BAND_MAX = 0.28;
  var BAND_PLATE_MAX_W = 0.92;   // ป้ายกว้างได้ไม่เกินนี้เทียบความกว้างภาพ
  var BAND_BG = '#12161c';

  var state = {
    code: '',
    photoType: '',
    aspect: '4:3',         // สัดส่วนกรอบภาพ ดู ASPECTS
    crop: { scale: 1, cx: 0.5, cy: 0.5 },   // กรอบตัด: ระดับซูม + จุดกึ่งกลาง (สัดส่วน 0-1 ของรูป)
    plateMode: 'band',     // 'band' = ป้ายใต้ภาพ, 'inside' = ป้ายทับอยู่ในภาพ (แบบโปรแกรมพีซี)
    bandHeight: 0.12,      // ความสูงแถบเทียบความสูงภาพ (แยกจาก placement.widthRatio ของโหมดทับภาพ)
    placement: { widthRatio: window.Plate.DEFAULT_WIDTH_RATIO, xRatio: 0, yRatio: 0 },
    plateCanvas: null,     // ป้ายความละเอียดเต็มของรหัสปัจจุบัน (ใช้ตอนรวมภาพ ไม่เอาลง DOM)
    plateURL: '',          // ภาพป้ายสำหรับแสดงผล — แต่ละกล่องมี <img> ของตัวเอง
    photoSource: null,     // รูปดิบที่กำลังตรวจอยู่ (ImageBitmap หรือ canvas) — เก็บก้อนเดียว
    rotation: 0,           // 0/90/180/270 องศา สำหรับรูปที่มาเอียง
    stream: null,
    track: null,
    facing: 'environment',
    digitalZoom: 1,
    hardwareZoom: false,
    digitalBrightness: 1,
    hardwareExposure: false,
    saving: false,
    source: 'live'         // รูปที่กำลังตรวจมาจากไหน: 'live' หรือ 'file'
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
    ['screen-code', 'screen-camera', 'screen-review'].forEach(function (s) {
      $(s).classList.toggle('is-active', s === id);
    });
  }

  /* ---------------- หน้าเลขที่งาน ---------------- */

  function setActionsEnabled(on) {
    ['btn-live', 'btn-native', 'btn-pick'].forEach(function (id) { $(id).disabled = !on; });
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

  function aspectDef() {
    for (var i = 0; i < ASPECTS.length; i++) {
      if (ASPECTS[i].id === state.aspect) return ASPECTS[i];
    }
    return ASPECTS[0];
  }

  /*
   * กรอบตัดกลางภาพตามสัดส่วนที่เลือก — "ตัด" อย่างเดียว ไม่มีการยืดหรือบีบ
   * สัดส่วนพลิกตามแนวของภาพเอง ภาพตั้งกับภาพนอนจึงกินพื้นที่เซนเซอร์เท่ากัน
   */
  function cropOf(w, h) {
    var a = aspectDef();
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
  }

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
   * จัดขนาดกล่อง .shot ให้พอดีเวทีทั้งกว้างและสูง
   * ต้องคิดเป็น px เอง เพราะ aspect-ratio ของ CSS ทำ "contain" สองแกนพร้อมกันไม่ได้
   */
  function applyShot(shotEl, bandEl, imgW, imgH) {
    var L = shotLayout(imgW, imgH);
    if (!L.w || !L.h) return L;

    var stage = shotEl.parentElement;
    var availW = Math.max(1, stage.clientWidth - 8);      // เผื่อ padding ของเวที
    var availH = Math.max(1, stage.clientHeight - 8);
    var w = Math.min(availW, availH * (L.w / L.h));
    shotEl.style.width = Math.round(w) + 'px';
    shotEl.style.height = Math.round(w * L.h / L.w) + 'px';

    bandEl.hidden = !L.band;
    if (L.band) {
      bandEl.style.height = (L.band / L.h * 100) + '%';
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
    if (!state.plateCanvas) return;
    this.layout();
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

  var camPlacement = null;
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
    ['cam-aspect', 'review-aspect'].forEach(function (id) {
      var chips = $(id).children;
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle('is-on', chips[i].getAttribute('data-aspect') === state.aspect);
      }
    });
  }

  /*
   * เปลี่ยนสัดส่วนได้ทั้งตอนเล็งและตอนตรวจรูป
   * ตอนตรวจรูปคือการตัดรูปที่ถ่ายมาแล้ว จึงตัดได้แคบลงอย่างเดียว ขยายคืนไม่ได้
   */
  function setAspect(id) {
    state.aspect = id;
    saveStore({ aspect: id });
    syncAspectChips();
    if (camPlacement) camPlacement.render();
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
    if (camPlacement) camPlacement.render();
    if (reviewPlacement) reviewPlacement.render();
  }

  function syncModeUI() {
    ['cam-mode', 'review-mode'].forEach(function (id) {
      var btns = $(id).children;
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('is-on', btns[i].getAttribute('data-mode') === state.plateMode);
      }
    });
    // ปุ่มจัดตำแหน่งไม่มีความหมายในโหมดแถบ ป้ายอยู่กลางแถบตายตัว
    var band = state.plateMode === 'band';
    $('btn-reset-plate').hidden = band;
    $('btn-auto').hidden = band;

    // สไลเดอร์ตัวเดียวกันแต่คุมคนละอย่าง จึงต้องเปลี่ยนทั้งช่วงค่าและป้ายกำกับ
    [['sl-size', 'lb-size'], ['sl-review-size', 'lb-review-size']].forEach(function (pair) {
      var sl = $(pair[0]);
      sl.min = band ? BAND_MIN : 0.15;
      sl.max = band ? BAND_MAX : 0.95;
      sl.step = band ? 0.005 : 0.01;
      sl.value = String(sliderValue());
      $(pair[1]).textContent = band ? 'ความสูงแถบ' : 'ขนาดป้าย';
    });
  }

  function bindModeSeg(id) {
    $(id).addEventListener('click', function (e) {
      var btn = e.target.closest('.seg__btn');
      if (btn) setPlateMode(btn.getAttribute('data-mode'));
    });
  }

  /* ---------------- กล้องสด ---------------- */

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
    }
    state.stream = null;
    state.track = null;
    $('video').srcObject = null;
  }

  /*
   * ขอภาพ 4:3 ตามเซนเซอร์ ไม่ใช่ 16:9
   *
   * เดิมขอ 3840x2160 (16:9) ทั้งที่กล้องมือถือเป็น 4:3 เบราว์เซอร์เลยครอปบน-ล่างทิ้ง 25%
   * แล้วโค้ดยังครอปเป็นจัตุรัสซ้ำอีกชั้น เหลือแนวนอนแค่ ~56% ของที่กล้องเห็นจริง
   * ผลคือภาพเหมือนถูกซูมค้างไว้เกือบสองเท่า ต้องถอยห่างกว่าใช้แอปกล้องของเครื่อง
   *
   * resizeMode 'none' = ห้ามเบราว์เซอร์ครอป/ย่อให้ ขอโหมดดิบของกล้องมาเลย (Chrome รองรับ)
   * ใช้ ideal ทุกตัวเพื่อไม่ให้ OverconstrainedError บนเครื่องที่ไม่มีโหมดนั้น
   */
  function cameraConstraints() {
    return {
      audio: false,
      video: {
        facingMode: { ideal: state.facing },
        width: { ideal: 4032 },
        height: { ideal: 3024 },
        resizeMode: { ideal: 'none' }
      }
    };
  }

  function startCamera() {
    stopCamera();
    $('cam-error').textContent = '';
    $('cam-format').textContent = '';

    var open = navigator.mediaDevices.getUserMedia(cameraConstraints())
      .catch(function (err) {
        // เครื่องที่ไม่มีโหมดตามที่ขอ ให้เปิดแบบไม่ระบุอะไรเลยดีกว่าเปิดไม่ได้
        if (err && (err.name === 'OverconstrainedError' || err.name === 'NotReadableError')) {
          return navigator.mediaDevices.getUserMedia({
            audio: false, video: { facingMode: { ideal: state.facing } }
          });
        }
        throw err;
      });

    return open.then(function (stream) {
      state.stream = stream;
      state.track = stream.getVideoTracks()[0];
      var video = $('video');
      video.srcObject = stream;
      return video.play().catch(function () { /* บางเบราว์เซอร์เล่นเองอยู่แล้ว */ });
    }).then(function () {
      setupCapabilities();
      syncCameraFormat();
      camPlacement.render();
    }).catch(function (err) {
      var msg = 'เปิดกล้องไม่ได้: ' + (err && err.name === 'NotAllowedError'
        ? 'ยังไม่ได้อนุญาตให้เว็บใช้กล้อง'
        : (err && err.message) || 'ไม่ทราบสาเหตุ');
      $('cam-error').textContent = msg;
    });
  }

  /* หาชื่อสัดส่วนที่คนอ่านรู้เรื่อง จากขนาดจริงที่กล้องส่งมา */
  function ratioName(w, h) {
    var r = Math.max(w, h) / Math.min(w, h);
    var known = [[4 / 3, '4:3'], [16 / 9, '16:9'], [3 / 2, '3:2'], [1, '1:1'], [5 / 4, '5:4']];
    for (var i = 0; i < known.length; i++) {
      if (Math.abs(r - known[i][0]) < 0.03) return known[i][1];
    }
    return r.toFixed(2) + ':1';
  }

  /*
   * โชว์ขนาด/สัดส่วนที่ได้จริง เพราะแต่ละรุ่นให้ไม่เหมือนกัน
   * ถ้าขึ้น 16:9 แปลว่าเครื่องนั้นไม่มีโหมด 4:3 ให้เว็บใช้ — จะได้รู้ทันทีว่ามุมมองหายไปเพราะอะไร
   */
  function syncCameraFormat() {
    var video = $('video');
    var w = video.videoWidth, h = video.videoHeight;
    var el = $('cam-format');
    if (!w || !h) { el.textContent = ''; return; }
    el.textContent = w + '×' + h + '  (' + ratioName(w, h) + ')';
  }

  /*
   * ดูว่ากล้องตัวนี้ปรับซูม/แสง/ไฟฉายจากฮาร์ดแวร์ได้ไหม
   * Safari บน iOS ยังไม่รองรับทั้งสามอย่าง จึงต้องมีทางสำรองแบบดิจิทัล
   */
  function setupCapabilities() {
    var caps = {};
    if (state.track && state.track.getCapabilities) {
      try { caps = state.track.getCapabilities() || {}; } catch (err) { caps = {}; }
    }

    var zoomSlider = $('sl-zoom');
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      state.hardwareZoom = true;
      zoomSlider.min = caps.zoom.min;
      zoomSlider.max = caps.zoom.max;
      zoomSlider.step = caps.zoom.step || 0.1;
      zoomSlider.value = caps.zoom.min;
      $('lb-zoom').textContent = 'ซูม';
    } else {
      state.hardwareZoom = false;
      zoomSlider.min = 1;
      zoomSlider.max = 4;
      zoomSlider.step = 0.05;
      zoomSlider.value = 1;
      $('lb-zoom').textContent = 'ซูม (ดิจิทัล)';
    }
    state.digitalZoom = 1;
    applyZoom();

    var expSlider = $('sl-exposure');
    var range = caps.exposureCompensation;
    if (range && range.max > range.min) {
      state.hardwareExposure = true;
      expSlider.min = range.min;
      expSlider.max = range.max;
      expSlider.step = range.step || 0.1;
      expSlider.value = 0;
      $('lb-exposure').textContent = 'แสง';
    } else {
      state.hardwareExposure = false;
      expSlider.min = 0.6;
      expSlider.max = 1.8;
      expSlider.step = 0.02;
      expSlider.value = 1;
      $('lb-exposure').textContent = 'แสง (ดิจิทัล)';
    }
    state.digitalBrightness = 1;
    applyExposure();

    $('btn-torch').hidden = !caps.torch;
    $('btn-torch').classList.remove('is-on');
  }

  function applyZoom() {
    var value = parseFloat($('sl-zoom').value);
    if (state.hardwareZoom && state.track) {
      state.digitalZoom = 1;
      $('video').style.transform = '';
      state.track.applyConstraints({ advanced: [{ zoom: value }] }).catch(function () {});
    } else {
      state.digitalZoom = value;
      $('video').style.transform = 'scale(' + value + ')';
    }
  }

  function applyExposure() {
    var value = parseFloat($('sl-exposure').value);
    if (state.hardwareExposure && state.track) {
      state.digitalBrightness = 1;
      $('video').style.filter = '';
      state.track.applyConstraints({ advanced: [{ exposureCompensation: value }] })
        .catch(function () {});
    } else {
      state.digitalBrightness = value;
      $('video').style.filter = 'brightness(' + value + ')';
    }
  }

  function toggleTorch() {
    if (!state.track) return;
    var on = !$('btn-torch').classList.contains('is-on');
    state.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
      $('btn-torch').classList.toggle('is-on', on);
    }).catch(function () {
      toast('เปิดไฟฉายไม่ได้บนกล้องตัวนี้');
    });
  }

  /* ปรับความสว่างทีละพิกเซล สำหรับเบราว์เซอร์ที่ ctx.filter ใช้ไม่ได้ */
  function brightenManually(ctx, w, h, factor) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, d[i] * factor);
      d[i + 1] = Math.min(255, d[i + 1] * factor);
      d[i + 2] = Math.min(255, d[i + 2] * factor);
    }
    ctx.putImageData(img, 0, 0);
  }

  /* พื้นที่ภาพที่กล้องกำลังให้อยู่ หลังตัดตามสัดส่วนที่เลือกแล้ว */
  function cameraCrop() {
    var video = $('video');
    return cropOf(video.videoWidth, video.videoHeight);
  }

  /*
   * เก็บภาพ "เต็มเฟรม" ไว้ก่อนเสมอ ตัดเฉพาะส่วนที่ซูมดิจิทัลเข้าไปจริง ๆ
   *
   * ไม่ตัดตามสัดส่วนตั้งแต่ตอนถ่าย เพราะถ้าตัดทิ้งเลยจะเลื่อนกรอบทีหลังไม่ได้
   * ต้องถ่ายให้ตรงเป๊ะครั้งเดียวจบซึ่งใช้งานจริงลำบาก
   * หน้าตรวจรูปจะตัดตามสัดส่วนให้เอง โดยเริ่มที่กลางภาพ = ตรงกับที่เห็นในกรอบเล็งพอดี
   * แล้วผู้ใช้ค่อยลากเลื่อน/ซูมเลือกส่วนที่ต้องการได้ตามใจ
   *
   * ย่อลงไม่เกิน MAX_OUTPUT_SIDE ตั้งแต่ตอนถ่าย เพราะยังไงตอนบันทึกก็ไม่ได้ใหญ่กว่านี้
   * และ canvas 12 ล้านพิกเซลคือต้นเหตุที่ iOS เคยฆ่าหน้าเว็บทิ้ง
   */
  function captureFrame() {
    var video = $('video');
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    var zoom = Math.max(1, state.digitalZoom);
    var cw = vw / zoom, ch = vh / zoom;
    var sx = (vw - cw) / 2;
    var sy = (vh - ch) / 2;
    var out = fitted({ w: cw, h: ch }, MAX_OUTPUT_SIDE);

    var canvas = document.createElement('canvas');
    canvas.width = out.w;
    canvas.height = out.h;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    var needBrighten = Math.abs(state.digitalBrightness - 1) > 0.001;
    var canFilter = 'filter' in ctx;
    if (needBrighten && canFilter) ctx.filter = 'brightness(' + state.digitalBrightness + ')';
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, out.w, out.h);
    if (needBrighten && !canFilter) brightenManually(ctx, out.w, out.h, state.digitalBrightness);

    return canvas;
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

  function openReview(source, mode) {
    releasePhoto(source);
    state.photoSource = source;
    state.rotation = 0;
    resetCrop();          // รูปใหม่เริ่มที่กลางภาพเสมอ = ตรงกับกรอบที่เห็นตอนเล็ง
    state.source = mode;
    $('btn-again').hidden = mode !== 'live';

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

  /*
   * บันทึกลงอัลบั้ม
   * iOS ไม่มี API เขียนลง Photos โดยตรง ทางที่ใกล้ที่สุดคือ share sheet
   * แล้วให้ผู้ใช้แตะ "Save Image" อีกหนึ่งครั้ง — ข้ามขั้นนี้ไม่ได้
   */
  function saveResult() {
    if (state.saving) return;
    state.saving = true;
    $('btn-save').disabled = true;

    var work = composeFinal();
    canvasToBlob(work).then(function (blob) {
      work.width = 0;          // คืนหน่วยความจำทันทีที่ได้ไฟล์แล้ว
      work.height = 0;
      var name = outputName();
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
    }).catch(function (err) {
      toast(err.message || 'บันทึกไม่สำเร็จ');
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
      openReview(source, 'file');
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

  /* เปิดหน้ากล้องสด ใช้ทั้งตอนเริ่มถ่ายและตอนกด "ถ่ายต่อ" */
  function openCamera() {
    if (!state.plateCanvas) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('เบราว์เซอร์นี้เปิดกล้องสดไม่ได้ ลองโหมดกล้องเครื่องแทน');
      return;
    }
    $('cam-code').textContent = state.code;
    showScreen('screen-camera');
    return startCamera().then(function () {
      if (state.plateMode === 'inside' &&
          state.placement.xRatio === 0 && state.placement.yRatio === 0) {
        camPlacement.resetToBottom();
      } else {
        camPlacement.clamp(state.placement);
        camPlacement.render();
      }
    });
  }

  /* ---------------- ผูกปุ่มทั้งหมด ---------------- */

  function init() {
    camPlacement = new PlacementController(
      $('cam-plate'), $('cam-frame'), $('sl-size'), $('cam-shot'), $('cam-band'),
      cameraCrop);
    reviewPlacement = new PlacementController(
      $('review-plate'), $('review-frame'), $('sl-review-size'), $('review-shot'), $('review-band'),
      cropRect);

    setupCodeScreen();
    bindModeSeg('cam-mode');
    bindModeSeg('review-mode');
    syncModeUI();
    buildAspectChips('cam-aspect');
    buildAspectChips('review-aspect');
    syncAspectChips();

    // ขนาดภาพจากกล้องรู้ได้หลัง metadata มาถึง และเปลี่ยนอีกทีเมื่อหมุนเครื่อง
    ['loadedmetadata', 'resize'].forEach(function (ev) {
      $('video').addEventListener(ev, function () {
        syncCameraFormat();
        camPlacement.render();
      });
    });

    $('btn-live').addEventListener('click', openCamera);

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

    $('btn-cam-back').addEventListener('click', function () {
      stopCamera();
      showScreen('screen-code');
      refreshPreview();   // ดึงรูปป้ายกลับมาไว้ในกล่องตัวอย่าง
    });
    $('btn-flip').addEventListener('click', function () {
      state.facing = state.facing === 'environment' ? 'user' : 'environment';
      startCamera();
    });
    $('sl-zoom').addEventListener('input', applyZoom);
    $('sl-exposure').addEventListener('input', applyExposure);
    $('btn-torch').addEventListener('click', toggleTorch);
    $('btn-reset-plate').addEventListener('click', function () { camPlacement.resetToBottom(); });

    $('btn-shutter').addEventListener('click', function () {
      var shot = captureFrame();
      if (!shot) { toast('กล้องยังไม่พร้อม ลองอีกครั้ง'); return; }
      stopCamera();
      openReview(shot, 'live');
    });

    // ถ่ายรูปถัดไปได้ทันทีโดยไม่ต้องย้อนกลับไปหน้ากรอกรหัส
    $('btn-again').addEventListener('click', function () {
      releasePhoto();
      openCamera();
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
      if (state.source === 'live') {
        openCamera();          // มาจากกล้องสด ย้อนกลับไปที่กล้อง ไม่ใช่หน้าแรก
      } else {
        showScreen('screen-code');
        refreshPreview();
      }
    });

    // แตะรหัสบนแถบกล้องเพื่อกลับไปแก้เลขงาน
    $('cam-code').addEventListener('click', function () {
      stopCamera();
      showScreen('screen-code');
      refreshPreview();
    });
    $('btn-auto').addEventListener('click', autoPlaceReview);
    $('btn-save').addEventListener('click', saveResult);
    $('btn-reset').addEventListener('click', hardReset);

    // กล้องหยุดเองเมื่อสลับไปแอปอื่น กลับมาแล้วต้องเปิดใหม่
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if ($('screen-camera').classList.contains('is-active') && !state.stream) startCamera();
    });

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
