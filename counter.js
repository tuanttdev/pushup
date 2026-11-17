// Logic đếm rep hít đất — thuần JS, không phụ thuộc trình duyệt (test được bằng Node).
// Input: 33 landmark của MediaPipe Pose (x,y chuẩn hoá 0..1, visibility 0..1).

export const L = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
};

export const DEFAULTS = {
  view: 'auto',          // 'auto' | 'side' | 'front'
  // Quay ngang: góc khuỷu tay (độ)
  sideDownAngle: 100,    // xuống tới <= góc này mới tính là đủ sâu
  sideUpAngle: 150,      // lên tới >= góc này mới tính là duỗi thẳng
  sidePartialAngle: 130, // xuống dưới mức này nhưng chưa đủ sâu => rep thiếu
  // Quay trước mặt: độ hạ vai (đơn vị = bề rộng vai), ngưỡng thích nghi
  frontMinRange: 0.45,   // biên độ tối thiểu để tính là 1 rep
  frontDownFrac: 0.30,   // phần biên độ: xuống dưới mức này = xuống
  frontUpFrac: 0.70,     // lên trên mức này = lên
  frontWindowSec: 8,     // cửa sổ thời gian để tính biên độ
  minVisibility: 0.5,
  smoothTau: 0.08,       // giây, làm mượt tín hiệu
  minRepSec: 0.35,       // rep nhanh hơn mức này coi là nhiễu
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function angleDeg(a, b, c) {
  // góc ABC tại B
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

const vis = (p) => (p && p.visibility != null ? p.visibility : 1);

export class PushupCounter {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.reset();
  }

  setOptions(opts) {
    const viewChanged = opts.view && opts.view !== this.o.view;
    this.o = { ...this.o, ...opts };
    if (viewChanged) this._resetSignal();
  }

  reset() {
    this.count = 0;
    this.partial = 0;
    this.reps = []; // {t, depth}
    this.view = this.o.view === 'auto' ? null : this.o.view;
    this._ratio = null;
    this._resetSignal();
  }

  _resetSignal() {
    this.phase = 'up';      // 'up' | 'down'
    this.signal = null;     // giá trị đã làm mượt
    this._lastT = null;
    this._lastRepT = -1e9;
    this._extreme = null;   // góc nhỏ nhất / độ sâu trong lượt xuống
    this._hist = [];        // [{t,s}] cho chế độ trước mặt
    this._wentPartial = false;
  }

  // landmarks: mảng 33 điểm; t: giây; aspect = width/height của khung hình
  update(lm, t, aspect = 1) {
    const out = { event: null, valid: false };
    if (!lm || lm.length < 29) return this._result(out);
    // đưa về toạ độ có tỉ lệ đúng (x nhân aspect)
    const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: vis(lm[i]) });
    const p = {};
    for (const k in L) p[k] = P(L[k]);

    // --- Xác định hướng quay ---
    const shW = dist(p.lSh, p.rSh);
    const upperArm = (dist(p.lSh, p.lEl) + dist(p.rSh, p.rEl)) / 2;
    if (upperArm > 0) {
      const r = shW / upperArm;
      this._ratio = this._ratio == null ? r : this._ratio + 0.1 * (r - this._ratio);
    }
    let view = this.o.view;
    if (view === 'auto') {
      if (this.view == null) this.view = this._ratio < 0.7 ? 'side' : 'front';
      else if (this.view === 'front' && this._ratio < 0.55) { this.view = 'side'; this._resetSignal(); }
      else if (this.view === 'side' && this._ratio > 0.9) { this.view = 'front'; this._resetSignal(); }
      view = this.view;
    } else {
      this.view = view;
    }

    const dt = this._lastT == null ? 0 : Math.max(0, t - this._lastT);
    this._lastT = t;
    const smooth = (raw) => {
      if (this.signal == null || dt === 0 || dt > 1) return raw;
      const a = 1 - Math.exp(-dt / this.o.smoothTau);
      return this.signal + a * (raw - this.signal);
    };

    if (view === 'side') this._updateSide(p, t, smooth, out);
    else this._updateFront(p, t, shW, smooth, out);
    return this._result(out);
  }

  _updateSide(p, t, smooth, out) {
    const o = this.o;
    const lv = Math.min(p.lSh.v, p.lEl.v, p.lWr.v);
    const rv = Math.min(p.rSh.v, p.rEl.v, p.rWr.v);
    const best = Math.max(lv, rv);
    if (best < o.minVisibility) return;
    let raw;
    if (lv >= o.minVisibility && rv >= o.minVisibility && Math.abs(lv - rv) < 0.15) {
      raw = (angleDeg(p.lSh, p.lEl, p.lWr) + angleDeg(p.rSh, p.rEl, p.rWr)) / 2;
    } else if (lv > rv) raw = angleDeg(p.lSh, p.lEl, p.lWr);
    else raw = angleDeg(p.rSh, p.rEl, p.rWr);
    if (!Number.isFinite(raw)) return;

    // Thân người phải gần nằm ngang (nếu thấy hông) — tránh đếm khi đang đứng
    const hip = p.lHip.v > p.rHip.v ? p.lHip : p.rHip;
    const sh = p.lSh.v > p.rSh.v ? p.lSh : p.rSh;
    if (hip.v >= o.minVisibility) {
      const tilt = Math.abs((Math.atan2(hip.y - sh.y, Math.abs(hip.x - sh.x)) * 180) / Math.PI);
      out.tilt = tilt;
      if (tilt > 55) { this.signal = smooth(raw); return; }
    }

    const s = (this.signal = smooth(raw));
    out.valid = true;
    if (this.phase === 'up') {
      if (s <= o.sidePartialAngle) this._wentPartial = true;
      if (s <= o.sideDownAngle) { this.phase = 'down'; this._extreme = s; this._wentPartial = false; }
      else if (this._wentPartial && s >= o.sideUpAngle) {
        this._wentPartial = false; this.partial++; out.event = 'partial';
      }
    } else {
      this._extreme = Math.min(this._extreme, s);
      if (s >= o.sideUpAngle) {
        this.phase = 'up';
        this._countRep(t, Math.round(this._extreme), out);
      }
    }
  }

  _updateFront(p, t, shW, smooth, out) {
    const o = this.o;
    const need = [p.lSh, p.rSh, p.lWr, p.rWr];
    if (Math.min(...need.map((q) => q.v)) < o.minVisibility || shW <= 0) return;
    // Khoảng cách dọc từ vai xuống cổ tay, chuẩn hoá theo bề rộng vai.
    // Lên cao => giá trị lớn; hạ xuống sát sàn => giá trị nhỏ.
    const raw = ((p.lWr.y + p.rWr.y) / 2 - (p.lSh.y + p.rSh.y) / 2) / shW;
    if (!Number.isFinite(raw)) return;
    const s = (this.signal = smooth(raw));
    out.valid = true;

    this._hist.push({ t, s });
    while (this._hist.length && this._hist[0].t < t - o.frontWindowSec) this._hist.shift();
    let mn = Infinity, mx = -Infinity;
    for (const h of this._hist) { if (h.s < mn) mn = h.s; if (h.s > mx) mx = h.s; }
    const range = mx - mn;
    out.range = range;
    if (range < o.frontMinRange) return;
    const frac = (s - mn) / range;
    out.frac = frac;

    if (this.phase === 'up') {
      if (frac <= o.frontDownFrac) { this.phase = 'down'; this._extreme = s; }
    } else {
      this._extreme = Math.min(this._extreme, s);
      if (frac >= o.frontUpFrac) {
        this.phase = 'up';
        this._countRep(t, +(mx - this._extreme).toFixed(2), out);
      }
    }
  }

  _countRep(t, depth, out) {
    if (t - this._lastRepT < this.o.minRepSec) return;
    this._lastRepT = t;
    this.count++;
    this.reps.push({ t, depth });
    out.event = 'rep';
  }

  _result(out) {
    return {
      ...out,
      count: this.count,
      partial: this.partial,
      phase: this.phase,
      view: this.view,
      signal: this.signal,
    };
  }
}
