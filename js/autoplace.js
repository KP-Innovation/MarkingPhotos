/*
 * หาตำแหน่งว่างในรูปเพื่อวางป้ายโดยไม่บังตัวอย่าง
 * พอร์ตมาจาก compose.py (subject_mask + auto_position) ของ PlateStamper
 */
(function (global) {
  'use strict';

  var SEARCH_TOP_RATIO = 0.55;
  var EDGE_MARGIN_RATIO = 0.03;
  var ANALYSIS_MAX_SIDE = 480;   // ย่อก่อนวิเคราะห์ให้เร็วพอบนมือถือ

  function median(values) {
    var copy = Float32Array.from(values);
    copy.sort();
    var mid = copy.length >> 1;
    return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
  }

  /*
   * คืน mask (1 = ไม่ใช่พื้น) ของสิ่งที่วางอยู่บนพื้น เช่น โคมไฟ ฉากวัดระยะ
   *
   * ใช้ "สี" ไม่ใช่ "ลวดลาย" เพราะโคมไฟผิวเรียบสีเทาจะดูเนียนกว่าพื้นไม้
   * ถ้าวัดจากลวดลายอย่างเดียวจะเข้าใจผิดว่าตัวโคมคือที่ว่าง
   */
  function subjectMask(data, n) {
    var c0 = new Float32Array(n), c1 = new Float32Array(n), c2 = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      c0[i] = r - g;
      c1[i] = g - b;
      c2[i] = b - r;
    }
    var m0 = median(c0), m1 = median(c1), m2 = median(c2);

    var dist = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var d0 = c0[i] - m0, d1 = c1[i] - m1, d2 = c2[i] - m2;
      dist[i] = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
    }
    var mid = median(dist);
    var dev = new Float32Array(n);
    for (i = 0; i < n; i++) dev[i] = Math.abs(dist[i] - mid);
    var threshold = Math.max(10.0, 4.0 * median(dev));

    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = dist[i] > threshold ? 1 : 0;
    return mask;
  }

  /*
   * เลือกแถบว่างในครึ่งล่างของรูปที่มีพิกเซลของ "สิ่งของ" น้อยที่สุด
   * ถ้าคะแนนเสมอกันให้เลือกอันล่างสุด
   * source = HTMLImageElement / HTMLCanvasElement / HTMLVideoElement
   * คืน {x, y} เป็นพิกัดในระบบของรูปจริง (photoW x photoH)
   */
  function autoPosition(source, photoW, photoH, plateW, plateH) {
    var margin = Math.round(EDGE_MARGIN_RATIO * photoW);
    var x = Math.max(margin, Math.round((photoW - plateW) / 2));
    var fallback = { x: x, y: Math.max(0, photoH - margin - plateH) };

    var scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(photoW, photoH));
    var w = Math.max(1, Math.round(photoW * scale));
    var h = Math.max(1, Math.round(photoH * scale));

    var pw = Math.max(1, Math.round(plateW * scale));
    var ph = Math.max(1, Math.round(plateH * scale));
    var sMargin = Math.round(margin * scale);
    var searchTop = Math.max(0, Math.round(SEARCH_TOP_RATIO * h));
    var searchBottom = h - sMargin;
    if (searchBottom - searchTop < ph) return fallback;

    var data;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      return fallback;   // รูปจากต่างโดเมนอ่านพิกเซลไม่ได้
    }

    var mask = subjectMask(data, w * h);

    var colStart = Math.max(0, Math.min(w - 1, Math.round(x * scale)));
    var colEnd = Math.min(w, colStart + pw);

    // ผลรวมสะสมของจำนวนพิกเซล "สิ่งของ" ในแต่ละแถว (เฉพาะช่วงคอลัมน์ที่ป้ายจะทับ)
    var cumulative = new Float64Array(h + 1);
    for (var row = 0; row < h; row++) {
      var count = 0;
      var base = row * w;
      for (var col = colStart; col < colEnd; col++) count += mask[base + col];
      cumulative[row + 1] = cumulative[row] + count;
    }

    var best = Infinity;
    var lastTop = searchBottom - ph;
    for (var top = searchTop; top <= lastTop; top++) {
      var score = cumulative[top + ph] - cumulative[top];
      if (score < best) best = score;
    }
    var tolerance = 0.002 * pw * ph;
    var chosen = lastTop;
    for (top = searchTop; top <= lastTop; top++) {
      if (cumulative[top + ph] - cumulative[top] <= best + tolerance) chosen = top;
    }

    return { x: x, y: Math.max(0, Math.min(photoH - plateH, Math.round(chosen / scale))) };
  }

  global.AutoPlace = {
    SEARCH_TOP_RATIO: SEARCH_TOP_RATIO,
    EDGE_MARGIN_RATIO: EDGE_MARGIN_RATIO,
    autoPosition: autoPosition
  };
})(window);
