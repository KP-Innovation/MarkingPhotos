# -*- coding: utf-8 -*-
"""
ตัวช่วยลบวัตถุ (LaMa) ของเว็บป้ายเลขที่งาน — รันบนคอมของผู้ใช้เอง

หน้าเว็บอยู่บน Cloudflare Pages ซึ่งรัน Python ไม่ได้ จึงให้เว็บส่งรูปมาที่ตัวนี้
ผ่าน http://127.0.0.1:5188 (ฟังเฉพาะในเครื่อง คนอื่นในวงแลนเรียกไม่ได้)

วิธีลบวัตถุเหมือนปุ่ม "🩹 ลบวัตถุ" ของ Dashboard (T:\\Dashboard\\app\\inpaint_engine.py) ทุกขั้น
แต่เรียกโมเดล big-lama.pt ด้วย torch ตรง ๆ ไม่ผ่านแพ็กเกจ simple-lama-inpainting
เพราะแพ็กเกจนั้นล็อก pillow<10 และ numpy<2 ไว้ ติดตั้งบน Python รุ่นใหม่ไม่ได้

    pythonw lama_helper.py              รันเป็นเบื้องหลัง (ตัวติดตั้งตั้งให้เปิดเองตอนเข้า Windows)
    python  lama_helper.py --check      ตรวจว่าโหลดโมเดลและลบวัตถุได้จริง
    python  lama_helper.py --download   โหลดโมเดลอย่างเดียว (โชว์ความคืบหน้า)
"""
import base64
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.request
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = '1.0.0'
PORT = int(os.environ.get('MP_LAMA_PORT', '5188'))
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, 'helper.log')
MODEL_NAME = 'big-lama.pt'
MODEL_URL = os.environ.get(
    'LAMA_MODEL_URL',
    'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt')
MAX_BODY = 160 * 1024 * 1024

# torch รุ่นใหม่เตือนว่า jit.load จะเลิกใช้ แต่ไฟล์โมเดลมีให้แค่แบบ TorchScript
warnings.filterwarnings('ignore', category=FutureWarning)

# เว็บที่ยอมให้เรียก — ตัวจริง, ลิงก์ preview ของ Cloudflare, และตอนทดสอบในเครื่อง
ORIGIN_OK = re.compile(
    r'^(https://([a-z0-9-]+\.)?markingphotos\.pages\.dev'
    r'|https?://(localhost|127\.0\.0\.1)(:\d+)?)$', re.I)

# pythonw ไม่มีหน้าจอ print ไปไหนไม่ได้ ต้องลงไฟล์แทน
if sys.stdout is None or sys.stderr is None:
    try:
        _log = open(LOG_PATH, 'a', encoding='utf-8', buffering=1)
        sys.stdout = sys.stderr = _log
    except OSError:
        pass


def log(*a):
    try:
        print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)
    except Exception:
        pass


# ───────────────────────── โมเดล ─────────────────────────

_STATE = {'ai': 'loading', 'error': ''}
_MODEL = None
_LOAD_LOCK = threading.Lock()
_RUN_LOCK = threading.Lock()


def model_candidates():
    env = os.environ.get('LAMA_MODEL')
    if env:
        yield env
    yield os.path.join(HERE, MODEL_NAME)
    # ที่เก็บของ torch hub — เครื่องที่เคยใช้ Dashboard มีไฟล์นี้อยู่แล้ว ไม่ต้องโหลดซ้ำ 200MB
    yield os.path.join(os.path.expanduser('~'), '.cache', 'torch', 'hub', 'checkpoints', MODEL_NAME)


def find_model():
    for p in model_candidates():
        if p and os.path.isfile(p) and os.path.getsize(p) > 100 * 1024 * 1024:
            return p
    return None


def download_model(progress=False):
    dest = os.path.join(HERE, MODEL_NAME)
    tmp = dest + '.part'
    log('downloading model', MODEL_URL)
    with urllib.request.urlopen(MODEL_URL, timeout=60) as r, open(tmp, 'wb') as f:
        total = int(r.headers.get('Content-Length') or 0)
        got = 0
        last = 0
        while True:
            chunk = r.read(1024 * 256)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if progress and total and time.time() - last > 0.5:
                last = time.time()
                sys.stdout.write('\r  %5.1f%%  %d / %d MB   ' % (got * 100.0 / total, got >> 20, total >> 20))
                sys.stdout.flush()
    if progress:
        sys.stdout.write('\n')
    if total and got != total:
        raise IOError('โหลดโมเดลไม่ครบ (%d/%d bytes)' % (got, total))
    os.replace(tmp, dest)
    return dest


def get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _LOAD_LOCK:
        if _MODEL is not None:
            return _MODEL
        try:
            import torch
            try:
                torch.set_num_threads(max(1, os.cpu_count() or 4))
            except Exception:
                pass
            path = find_model() or download_model()
            m = torch.jit.load(path, map_location='cpu')
            m.eval()
            _MODEL = m
            _STATE.update(ai='ready', error='')
            log('model ready', path)
        except Exception as e:
            _STATE.update(ai='error', error=str(e))
            log('model load failed:', e)
            traceback.print_exc()
    return _MODEL


def lama_run(rgb, mask):
    """rgb uint8 HxWx3, mask uint8 HxW -> rgb uint8 HxWx3 (ขั้นเดียวกับ simple_lama)."""
    import numpy as np
    import torch
    model = get_model()
    if model is None:
        return None
    h, w = rgb.shape[:2]
    ph, pw = (-h) % 8, (-w) % 8                      # โมเดลต้องการด้านที่หารด้วย 8 ลงตัว
    img = np.pad(rgb.astype(np.float32) / 255.0, ((0, ph), (0, pw), (0, 0)), mode='symmetric')
    msk = np.pad((mask > 0).astype(np.float32), ((0, ph), (0, pw)), mode='symmetric')
    ti = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)))[None]
    tm = torch.from_numpy(np.ascontiguousarray(msk))[None, None]
    with torch.inference_mode():
        out = model(ti, tm)[0].permute(1, 2, 0).cpu().numpy()
    return np.clip(out[:h, :w] * 255.0, 0, 255).astype(np.uint8)


# ─────────────── ลบวัตถุ (ยกมาจาก Dashboard inpaint_engine.py) ───────────────

def _match_grain(orig_crop, filled_crop, cmask):
    import cv2
    import numpy as np
    try:
        ring = cv2.dilate(cmask, np.ones((9, 9), np.uint8), iterations=2)
        ring = cv2.subtract(ring, cmask)
        sel = ring > 0
        if int(sel.sum()) < 64:
            return filled_crop
        g = cv2.cvtColor(orig_crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
        hf = g - cv2.GaussianBlur(g, (0, 0), 1.2)
        sigma = min(float(np.std(hf[sel])), 7.0)
        if sigma < 0.6:
            return filled_crop
        m = cmask > 0
        noise = np.random.normal(0.0, sigma, filled_crop.shape[:2]).astype(np.float32)
        out = filled_crop.astype(np.float32)
        for c in range(3):
            out[..., c][m] += noise[m]
        return np.clip(out, 0, 255).astype(np.uint8)
    except Exception:
        return filled_crop


def inpaint(img_bgr, mask, pad_frac=0.6, min_pad=48, max_side=1280, feather=2.5):
    import cv2
    import numpy as np
    h, w = img_bgr.shape[:2]
    m = (mask > 10).astype(np.uint8) * 255
    if m.shape[:2] != (h, w):
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
    if int(m.sum()) == 0:
        return img_bgr.copy(), 'noop'
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)

    ys, xs = np.where(m > 0)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    pad = int(max(min_pad, pad_frac * max(x1 - x0 + 1, y1 - y0 + 1)))
    cy0, cy1 = max(0, y0 - pad), min(h, y1 + pad + 1)
    cx0, cx1 = max(0, x0 - pad), min(w, x1 + pad + 1)
    crop = img_bgr[cy0:cy1, cx0:cx1].copy()
    cmask = m[cy0:cy1, cx0:cx1].copy()
    ch, cw = crop.shape[:2]

    method, out_crop = 'cv2_ns', None
    if get_model() is not None:
        try:
            scale = min(1.0, max_side / float(max(ch, cw)))
            if scale < 1.0:
                sw, sh = max(8, int(round(cw * scale))), max(8, int(round(ch * scale)))
                cs = cv2.resize(crop, (sw, sh), interpolation=cv2.INTER_AREA)
                ms = cv2.resize(cmask, (sw, sh), interpolation=cv2.INTER_NEAREST)
            else:
                cs, ms = crop, cmask
            with _RUN_LOCK:
                r = lama_run(cv2.cvtColor(cs, cv2.COLOR_BGR2RGB), ms)
            if r is not None:
                r = cv2.cvtColor(r, cv2.COLOR_RGB2BGR)
                if r.shape[:2] != (ch, cw):
                    r = cv2.resize(r, (cw, ch), interpolation=cv2.INTER_CUBIC)
                out_crop, method = r, 'lama'
        except Exception as e:
            log('LaMa run failed, fallback:', e)
            out_crop = None
    if out_crop is None:
        out_crop = cv2.inpaint(crop, cmask, 5, cv2.INPAINT_NS)

    out_crop = _match_grain(crop, out_crop, cmask)
    a = (cmask > 0).astype(np.float32)
    if feather > 0:
        a = cv2.GaussianBlur(a, (0, 0), feather)
    a = np.clip(a, 0.0, 1.0)[..., None]
    blended = (crop.astype(np.float32) * (1 - a) + out_crop.astype(np.float32) * a).astype(np.uint8)
    res = img_bgr.copy()
    res[cy0:cy1, cx0:cx1] = blended
    return res, method


def decode_data_url(s, flags):
    import cv2
    import numpy as np
    if ',' in s[:100]:
        s = s.split(',', 1)[1]
    buf = np.frombuffer(base64.b64decode(s), np.uint8)
    img = cv2.imdecode(buf, flags)
    if img is None:
        raise ValueError('อ่านรูปไม่ได้')
    return img


def handle_inpaint(payload):
    import cv2
    img = decode_data_url(payload['image'], cv2.IMREAD_COLOR)
    raw = decode_data_url(payload['mask'], cv2.IMREAD_UNCHANGED)
    # หน้าเว็บส่ง mask เป็น PNG พื้นโปร่งใส ระบายตรงไหนตรงนั้นทึบ → ใช้ช่อง alpha
    if raw.ndim == 3 and raw.shape[2] == 4:
        mask = raw[..., 3]
    elif raw.ndim == 3:
        mask = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    else:
        mask = raw
    t = time.time()
    out, method = inpaint(img, mask)
    ok, png = cv2.imencode('.png', out)
    if not ok:
        raise ValueError('สร้างไฟล์ผลลัพธ์ไม่ได้')
    log('inpaint %dx%d %s %.1fs' % (img.shape[1], img.shape[0], method, time.time() - t))
    return {'ok': True, 'method': method,
            'image': 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode('ascii')}


# ───────────────────────── เว็บเซิร์ฟเวอร์ ─────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = 'MarkingPhotosLaMa/' + VERSION

    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        origin = self.headers.get('Origin') or ''
        if ORIGIN_OK.match(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Max-Age', '600')
            # Chrome: เว็บสาธารณะเรียกเข้าเครื่องตัวเองได้เมื่อปลายทางตอบรับข้อนี้
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/health'):
            self._json(200, {'ok': True, 'app': 'markingphotos-lama', 'version': VERSION,
                             'ai': _STATE['ai'], 'error': _STATE['error']})
        else:
            self._json(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if self.path.split('?')[0] != '/inpaint':
            self._json(404, {'ok': False, 'error': 'not found'})
            return
        origin = self.headers.get('Origin') or ''
        if origin and not ORIGIN_OK.match(origin):
            self._json(403, {'ok': False, 'error': 'origin not allowed'})
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n <= 0 or n > MAX_BODY:
                raise ValueError('ขนาดข้อมูลไม่ถูกต้อง')
            payload = json.loads(self.rfile.read(n).decode('utf-8'))
            self._json(200, handle_inpaint(payload))
        except Exception as e:
            log('inpaint error:', e)
            traceback.print_exc()
            self._json(500, {'ok': False, 'error': str(e)})


def self_check():
    import numpy as np
    img = np.full((96, 128, 3), 180, np.uint8)
    img[30:60, 40:80] = (20, 40, 200)
    mask = np.zeros((96, 128), np.uint8)
    mask[28:62, 38:82] = 255
    out, method = inpaint(img, mask)
    if method != 'lama':
        raise SystemExit('LaMa ใช้ไม่ได้: ' + (_STATE['error'] or method))
    left = float(abs(out[30:60, 40:80].astype(int) - 180).mean())
    print('OK  LaMa พร้อมใช้ (ส่วนต่างหลังลบ %.1f)' % left)


def main():
    if '--download' in sys.argv:
        if find_model():
            print('  มีโมเดลอยู่แล้ว:', find_model())
        else:
            print('  ที่เก็บ:', download_model(progress=True))
        return
    if '--check' in sys.argv:
        self_check()
        return
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        log('port %d busy — another helper is already running' % PORT)
        return
    srv.daemon_threads = True
    log('MarkingPhotos LaMa helper %s listening on 127.0.0.1:%d' % (VERSION, PORT))
    threading.Thread(target=get_model, daemon=True).start()   # โหลดโมเดลรอไว้ คำขอแรกจะได้ไม่ช้า
    srv.serve_forever()


if __name__ == '__main__':
    main()
