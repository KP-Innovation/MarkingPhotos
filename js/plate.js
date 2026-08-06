/*
 * สร้างรูปป้ายเลขที่งาน (พื้นขาว ตัวอักษรดำ) จากรหัสรูปแบบ XX-YYMM-NNNN
 *
 * พอร์ตมาจาก plate.py ของโปรแกรม PlateStamper บนพีซี ค่าคงที่ทุกตัวคงเดิม
 * เพื่อให้ป้ายที่ได้หน้าตาเหมือนกันเป๊ะทั้งสองโปรแกรม
 */
(function (global) {
  'use strict';

  var REF_CAP_HEIGHT = 220;
  var PLATE_HEIGHT_RATIO = 2.4;
  var SIDE_PADDING_RATIO = 0.35;
  var TRACKING_RATIO = 0.13;
  var DASH_TRACKING_RATIO = 0.09;
  var CORNER_RADIUS_RATIO = 0.06;

  var GLYPH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-';

  var metricsPromise = null;
  var glyphCache = {};
  var plateCache = {};

  function loadMetrics() {
    if (!metricsPromise) {
      metricsPromise = fetch('assets/metrics.json').then(function (r) {
        if (!r.ok) throw new Error('โหลด metrics.json ไม่ได้');
        return r.json();
      });
    }
    return metricsPromise;
  }

  function loadGlyph(ch) {
    if (glyphCache[ch]) return glyphCache[ch];
    var name = ch === '-' ? 'dash' : ch;
    var p = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('โหลดรูปตัวอักษร "' + ch + '" ไม่ได้')); };
      img.src = 'assets/glyphs/' + name + '.png';
    });
    glyphCache[ch] = p;
    return p;
  }

  /* ปัดเป็นตัวพิมพ์ใหญ่ ตัดช่องว่างหัวท้าย */
  function normalize(raw) {
    return String(raw == null ? '' : raw).trim().toUpperCase();
  }

  /*
   * ตรวจว่ารหัสวาดเป็นป้ายได้จริง
   * ไม่บังคับรูปแบบ XX-YYMM-NNNN และไม่เช็คว่าเดือนอยู่ใน 01-12
   * ผู้ใช้พิมพ์อะไรก็ได้ ขอแค่มีรูปตัวอักษรนั้นอยู่ในชุด
   */
  function validateCode(raw) {
    var code = normalize(raw);
    if (!code) throw new Error('ยังไม่ได้กรอกรหัสเลขที่งาน');
    for (var i = 0; i < code.length; i++) {
      if (GLYPH_CHARS.indexOf(code[i]) === -1) {
        throw new Error('ใช้ตัวอักษร "' + code[i] + '" ไม่ได้ — ป้ายมีเฉพาะ A-Z, 0-9 และ -');
      }
    }
    return code;
  }

  /* เติมขีดให้เองถ้าพิมพ์ติดกันมา เช่น LP26090045 -> LP-2609-0045 */
  function autoDash(raw) {
    var code = normalize(raw).replace(/[\s_–—]+/g, '-');
    if (code.indexOf('-') === -1 && /^[A-Z]{2}\d{8}$/.test(code)) {
      return code.slice(0, 2) + '-' + code.slice(2, 6) + '-' + code.slice(6);
    }
    return code;
  }

  /*
   * ตรวจรหัสที่พิมพ์มาทั้งก้อน แล้วบอกว่าใช้ได้ไหม/ผิดตรงไหน
   * level 'ok'    = ตรงรูปแบบ XX-YYMM-NNNN
   *       'warn'  = วาดป้ายได้ แต่ผิดรูปแบบมาตรฐาน (เตือน ไม่บล็อก)
   *       'error' = วาดป้ายไม่ได้เลย (บล็อก)
   */
  function analyzeCode(raw) {
    var code = autoDash(raw);
    if (!code) return { code: '', level: 'empty', message: '' };

    for (var i = 0; i < code.length; i++) {
      if (GLYPH_CHARS.indexOf(code[i]) === -1) {
        return {
          code: code, level: 'error',
          message: 'ใช้ตัวอักษร "' + code[i] + '" ไม่ได้ — ป้ายมีเฉพาะ A-Z, 0-9 และ -'
        };
      }
    }

    if (/^[A-Z]{2}-\d{4}-\d{4}$/.test(code)) {
      return { code: code, level: 'ok', message: '' };
    }

    var parts = code.split('-');
    var why;
    if (code.indexOf('-') === -1) {
      why = 'ไม่มีขีดคั่น ควรเป็นแบบ LP-2609-0045';
    } else if (parts.length !== 3) {
      why = 'ต้องมี 3 ส่วนคั่นด้วยขีด เช่น LP-2609-0045';
    } else if (!/^[A-Z]{2}$/.test(parts[0])) {
      why = 'อักษรนำควรเป็นตัวอักษร 2 ตัว เช่น LP';
    } else if (!/^\d{4}$/.test(parts[1])) {
      why = 'ส่วนกลางควรเป็นตัวเลข 4 หลัก (ปีเดือน) เช่น 2609';
    } else {
      why = 'ลำดับควรเป็นตัวเลข 4 หลัก เช่น 0045';
    }
    return { code: code, level: 'warn', message: why };
  }

  function roundedRectPath(ctx, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arcTo(w, 0, w, r, r);
    ctx.lineTo(w, h - r);
    ctx.arcTo(w, h, w - r, h, r);
    ctx.lineTo(r, h);
    ctx.arcTo(0, h, 0, h - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
  }

  /* เรนเดอร์ป้ายที่ความละเอียดอ้างอิง คืน canvas (ผู้เรียกไปย่อ/ขยายเอง) */
  function renderPlate(rawCode) {
    var code = validateCode(rawCode);
    if (plateCache[code]) return plateCache[code];

    var job = loadMetrics().then(function (metrics) {
      var glyphs = metrics.glyphs;
      var cap = REF_CAP_HEIGHT;
      var tracking = Math.round(cap * TRACKING_RATIO);
      var dashTracking = Math.round(cap * DASH_TRACKING_RATIO);
      var padX = Math.round(cap * SIDE_PADDING_RATIO);
      var plateHeight = Math.round(cap * PLATE_HEIGHT_RATIO);
      var baselineY = Math.round((plateHeight + cap) / 2);

      return Promise.all(Array.prototype.map.call(code, function (ch) {
        var m = glyphs[ch];
        if (!m) throw new Error('ไม่มีข้อมูลตัวอักษร "' + ch + '"');
        return loadGlyph(ch).then(function (img) {
          var scale = cap / m.cap_height;
          return {
            ch: ch,
            img: img,
            ascent: Math.round(cap * m.ascent_ratio),
            w: Math.max(1, Math.round(m.width * scale)),
            h: Math.max(1, Math.round(m.height * scale))
          };
        });
      })).then(function (placed) {
        function gapAt(i) {
          return (code[i] === '-' || code[i + 1] === '-') ? dashTracking : tracking;
        }
        var gaps = 0;
        for (var i = 0; i < code.length - 1; i++) gaps += gapAt(i);
        var textWidth = placed.reduce(function (sum, p) { return sum + p.w; }, 0) + gaps;

        var canvas = document.createElement('canvas');
        canvas.width = textWidth + padX * 2;
        canvas.height = plateHeight;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        roundedRectPath(ctx, canvas.width, canvas.height,
          Math.round(plateHeight * CORNER_RADIUS_RATIO));
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        var x = padX;
        placed.forEach(function (p, idx) {
          ctx.drawImage(p.img, x, baselineY - p.ascent, p.w, p.h);
          x += p.w;
          if (idx < placed.length - 1) x += gapAt(idx);
        });
        return canvas;
      });
    });

    plateCache[code] = job;
    job.catch(function () { delete plateCache[code]; });
    return job;
  }

  global.Plate = {
    DEFAULT_WIDTH_RATIO: 0.55,
    GLYPH_CHARS: GLYPH_CHARS,
    normalize: normalize,
    validateCode: validateCode,
    autoDash: autoDash,
    analyzeCode: analyzeCode,
    renderPlate: renderPlate
  };
})(window);
