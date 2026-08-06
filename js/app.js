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

  /* ประเภทรูป — ต่อท้ายเลขงานเป็นชื่อไฟล์ เลือกหรือไม่เลือกก็ได้ */
  var PHOTO_TYPES = ['Front', 'Front-Ruler', 'Rear-Ruler', 'Horizental-Side', 'Vertical-Ruler'];

  var state = {
    code: '',
    photoType: '',
    placement: { widthRatio: window.Plate.DEFAULT_WIDTH_RATIO, xRatio: 0, yRatio: 0 },
    plateCanvas: null,     // ป้ายความละเอียดเต็มของรหัสปัจจุบัน (ใช้ตอนรวมภาพ ไม่เอาลง DOM)
    plateURL: '',          // ภาพป้ายสำหรับแสดงผล — แต่ละกล่องมี <img> ของตัวเอง
    photoCanvas: null,     // รูปดิบที่กำลังตรวจอยู่ (ยังไม่มีป้าย)
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

  /* ---------------- ตัวควบคุมตำแหน่งป้าย ---------------- */

  /*
   * ผูกป้ายเข้ากับกรอบรูปหนึ่งกรอบ ให้ลากย้าย/หยิกย่อขยายได้
   * ตำแหน่งเก็บเป็นสัดส่วนของรูป (0-1) จึงใช้ได้ทั้งตอนพรีวิวและตอนบันทึกจริง
   */
  function PlacementController(layerEl, frameEl, sliderEl) {
    this.layer = layerEl;
    this.frame = frameEl;
    this.slider = sliderEl;
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

  PlacementController.prototype.render = function () {
    if (!state.plateCanvas) return;
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
    this.layer.setPointerCapture(e.pointerId);
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

  /* ---------------- กล้องสด ---------------- */

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
    }
    state.stream = null;
    state.track = null;
    $('video').srcObject = null;
  }

  function startCamera() {
    stopCamera();
    $('cam-error').textContent = '';
    var constraints = {
      audio: false,
      video: {
        facingMode: { ideal: state.facing },
        width: { ideal: 3840 },
        height: { ideal: 2160 }
      }
    };
    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      state.stream = stream;
      state.track = stream.getVideoTracks()[0];
      var video = $('video');
      video.srcObject = stream;
      return video.play().catch(function () { /* บางเบราว์เซอร์เล่นเองอยู่แล้ว */ });
    }).then(function () {
      setupCapabilities();
      camPlacement.render();
    }).catch(function (err) {
      var msg = 'เปิดกล้องไม่ได้: ' + (err && err.name === 'NotAllowedError'
        ? 'ยังไม่ได้อนุญาตให้เว็บใช้กล้อง'
        : (err && err.message) || 'ไม่ทราบสาเหตุ');
      $('cam-error').textContent = msg;
    });
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

  /* ตัดภาพจากกล้องเป็นสี่เหลี่ยมจัตุรัสกลางจอ ตามที่เห็นในกรอบพรีวิว */
  function captureSquare() {
    var video = $('video');
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    var side = Math.min(vw, vh) / state.digitalZoom;
    var sx = (vw - side) / 2;
    var sy = (vh - side) / 2;
    var size = Math.round(side);

    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');

    var needBrighten = Math.abs(state.digitalBrightness - 1) > 0.001;
    var canFilter = 'filter' in ctx;
    if (needBrighten && canFilter) ctx.filter = 'brightness(' + state.digitalBrightness + ')';
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
    if (needBrighten && !canFilter) brightenManually(ctx, size, size, state.digitalBrightness);

    return canvas;
  }

  /* ---------------- หน้าตรวจรูป ---------------- */

  function openReview(photoCanvas, source) {
    state.photoCanvas = photoCanvas;
    state.source = source;
    $('btn-again').hidden = source !== 'live';
    var frame = $('review-frame');
    frame.style.aspectRatio = photoCanvas.width + ' / ' + photoCanvas.height;

    var display = $('review-canvas');
    display.width = photoCanvas.width;
    display.height = photoCanvas.height;
    display.getContext('2d').drawImage(photoCanvas, 0, 0);

    $('review-code').textContent = state.code;
    syncTypeChips();
    showScreen('screen-review');
    requestAnimationFrame(function () {
      reviewPlacement.clamp(state.placement);
      reviewPlacement.render();
    });
  }

  function autoPlaceReview() {
    if (!state.photoCanvas || !state.plateCanvas) return;
    var pw = state.photoCanvas.width, ph = state.photoCanvas.height;
    var plateW = Math.max(32, Math.round(state.placement.widthRatio * pw));
    var plateH = Math.max(1, Math.round(plateW * state.plateCanvas.height / state.plateCanvas.width));
    var pos = window.AutoPlace.autoPosition(state.photoCanvas, pw, ph, plateW, plateH);
    state.placement.xRatio = pos.x / pw;
    state.placement.yRatio = pos.y / ph;
    reviewPlacement.clamp(state.placement);
    reviewPlacement.render();
    saveStore({ placement: state.placement });
  }

  /* รวมรูป + ป้าย เป็นภาพเดียวที่ความละเอียดเต็มของรูป */
  function composeFinal() {
    var photo = state.photoCanvas;
    var plate = state.plateCanvas;
    var out = document.createElement('canvas');
    out.width = photo.width;
    out.height = photo.height;
    var ctx = out.getContext('2d');
    ctx.drawImage(photo, 0, 0);

    var p = state.placement;
    var w = Math.max(1, Math.round(p.widthRatio * photo.width));
    var h = Math.max(1, Math.round(w * plate.height / plate.width));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(plate, Math.round(p.xRatio * photo.width),
      Math.round(p.yRatio * photo.height), w, h);
    return out;
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

    canvasToBlob(composeFinal()).then(function (blob) {
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
    work.then(function (source) {
      var w = source.width || source.naturalWidth;
      var h = source.height || source.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(source, 0, 0);
      if (source.close) source.close();
      openReview(canvas, 'file');
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
      if (state.placement.xRatio === 0 && state.placement.yRatio === 0) {
        camPlacement.resetToBottom();
      } else {
        camPlacement.clamp(state.placement);
        camPlacement.render();
      }
    });
  }

  /* ---------------- ผูกปุ่มทั้งหมด ---------------- */

  function init() {
    camPlacement = new PlacementController($('cam-plate'), $('cam-frame'), $('sl-size'));
    reviewPlacement = new PlacementController($('review-plate'), $('review-frame'),
      $('sl-review-size'));

    setupCodeScreen();

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
      var shot = captureSquare();
      if (!shot) { toast('กล้องยังไม่พร้อม ลองอีกครั้ง'); return; }
      stopCamera();
      openReview(shot, 'live');
    });

    // ถ่ายรูปถัดไปได้ทันทีโดยไม่ต้องย้อนกลับไปหน้ากรอกรหัส
    $('btn-again').addEventListener('click', openCamera);

    $('btn-review-back').addEventListener('click', function () {
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

    // กล้องหยุดเองเมื่อสลับไปแอปอื่น กลับมาแล้วต้องเปิดใหม่
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if ($('screen-camera').classList.contains('is-active') && !state.stream) startCamera();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ใช้ต่อได้แม้ลงทะเบียนไม่สำเร็จ */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
