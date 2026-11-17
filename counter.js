// Logic đếm rep hít đất — thuần JS, không phụ thuộc trình duyệt (test được bằng Node).
// Input: 33 landmark của MediaPipe Pose (x,y chuẩn hoá 0..1, visibility 0..1).

export const L = {
  nose: 0, lEye: 3, rEye: 6, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
};

export const DEFAULTS = {
  view: 'auto',          // 'auto' | 'side' | 'front'
  // Quay ngang: góc khuỷu tay (độ)
  sideDownAngle: 100,    // xuống tới <= góc này mới tính là đủ sâu
  sideUpAngle: 150,      // lên tới >= góc này mới tính là duỗi thẳng
  sidePartialAngle: 130, // xuống dưới mức này nhưng chưa đủ sâu => rep thiếu
  // Quay trước mặt: kết hợp nhiều tín hiệu (đơn vị = bề rộng vai), ngưỡng thích nghi
  frontMinRange: 0.45,      // biên độ tối thiểu: cổ tay so với vai
  frontElbowMinRange: 0.25, // biên độ tối thiểu: khuỷu tay so với vai (khuỷu gập lại)
  frontHeadMinRange: 0.30,  // biên độ tối thiểu: đầu / vai hạ xuống
  frontDownFrac: 0.30,   // phần biên độ: xuống dưới mức này = xuống
  frontUpFrac: 0.70,     // lên trên mức này = lên
  frontWindowSec: 5,     // cửa sổ thời gian để tính biên độ
  frontSettleSec: 0.8,   // sau khi đứng dậy / chỉnh máy: chờ ổn định bấy nhiêu giây mới đếm
  frontLostSec: 0.4,     // mất dấu người lâu hơn mức này => bắt đầu lại
  frontMaxDownSec: 5,    // ở dưới lâu hơn mức này (nằm nghỉ) => huỷ lượt đó
  frontMaxSideSpeed: 2.0,  // người/khung hình trượt ngang nhanh hơn (bề rộng vai/giây) => đang chỉnh máy
  frontMaxVertSpeed: 6.0,  // mọi điểm cùng giật dọc nhanh hơn mức này => đang chỉnh máy
  frontMaxTiltDeg: 30,     // đường vai nghiêng quá mức này => máy bị xoay / đang chỉnh
  frontUprightLegRatio: 2.0, // thấy rõ chân, chân thấp hơn vai > 2 lần bề rộng vai => đang đứng
  frontUprightHipRatio: 1.4, // thấy rõ hông, hông thấp hơn vai > 1,4 lần bề rộng vai => đang đứng
  minVisibility: 0.5,
  smoothTau: 0.08,       // giây, làm mượt tín hiệu
  minRepSec: 0.35,       // rep nhanh hơn mức này coi là nhiễu
};

// Các tín hiệu cho góc trước mặt. kind 'arm' = theo tay, 'body' = theo đầu/vai.
const FRONT_CUES = [
  { key: 'wrist', name: 'cổ tay', kind: 'arm', w: 1.0, min: 'frontMinRange' },
  { key: 'elbow', name: 'khuỷu tay', kind: 'arm', w: 1.0, min: 'frontElbowMinRange' },
  { key: 'shoulder', name: 'vai', kind: 'body', w: 0.7, min: 'frontHeadMinRange' },
  { key: 'head', name: 'đầu', kind: 'body', w: 0.7, min: 'frontHeadMinRange' },
];

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
    this._viewScore = null;
    this._scale = null;   // bề rộng vai (đã làm mượt), dùng cho góc trước mặt
    this._earK = 2.5;     // tỉ lệ bề rộng vai / khoảng cách 2 tai (tự học)
    this._eyeK = 4.5;     // tỉ lệ bề rộng vai / khoảng cách 2 khoé mắt ngoài (tự học)
    this._resetSignal();
  }

  _resetSignal() {
    this.phase = 'up';      // 'up' | 'down'
    this.signal = null;     // giá trị đã làm mượt
    this._lastT = null;
    this._lastRepT = -1e9;
    this._extreme = null;   // góc nhỏ nhất trong lượt xuống (quay ngang)
    this._wentPartial = false;
    this._frontReset(null);
  }

  // Bắt đầu lại phần theo dõi của góc trước mặt (sau khi đứng dậy, chỉnh máy, mất dấu…)
  _frontReset(t) {
    this.phase = 'up';
    this._armed = true;     // false sau khi nằm nghỉ quá lâu: phải lên hẳn rồi mới tính lượt xuống mới
    this._f = {
      cues: {},             // key -> {s, t, hist:[{t,s}], mn, mx}
      prev: {},             // vị trí điểm ở khung trước (để đo tốc độ)
      prevT: null,
      speedX: 0, speedY: 0,
      lastSeen: t,
      settleUntil: t == null ? -1e9 : t + this.o.frontSettleSec,
      downT: 0,
    };
  }

  // landmarks: mảng 33 điểm; t: giây; aspect = width/height của khung hình
  update(lm, t, aspect = 1) {
    const out = { event: null, valid: false };
    if (!lm || lm.length < 29) {
      if (this.view === 'front') this._frontLost(t);
      return this._result(out);
    }
    // đưa về toạ độ có tỉ lệ đúng (x nhân aspect); in = điểm nằm trong khung hình
    const inF = (q) => q.x > -0.02 && q.x < 1.02 && q.y > -0.02 && q.y < 1.02;
    const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: vis(lm[i]), in: inF(lm[i]) });
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
      const vote = this._viewVote(p);
      if (vote != null) this._viewScore = this._viewScore == null ? vote : this._viewScore + 0.1 * (vote - this._viewScore);
      const sc = this._viewScore;
      if (this.view == null) { if (sc != null) this.view = sc >= 0 ? 'front' : 'side'; }
      else if (this.view === 'front' && sc < -0.5) { this.view = 'side'; this._resetSignal(); }
      else if (this.view === 'side' && sc > 0.5) { this.view = 'front'; this._resetSignal(); }
      view = this.view;
      if (view == null) return this._result(out);
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
    else this._updateFront(p, t, out);
    return this._result(out);
  }

  // Phiếu bầu cho hướng quay: > 0 nghiêng về "trước mặt", < 0 nghiêng về "ngang".
  // Dùng tỉ lệ bề rộng vai / cánh tay, và hướng mặt (thấy 2 tai, mũi nằm giữa => nhìn thẳng).
  // Hướng mặt vẫn dùng được khi ở quá gần camera hoặc bị che 1 bên vai.
  _viewVote(p) {
    const mv = this.o.minVisibility;
    let v = 0, n = 0;
    const armOK = Math.max(p.lEl.v, p.rEl.v) >= mv;
    if (p.lSh.v >= mv && p.rSh.v >= mv && armOK && this._ratio != null) {
      v += Math.max(-1, Math.min(1, (this._ratio - 0.7) / 0.2)); n++;
    }
    if (p.nose.v >= mv) {
      const le = p.lEar.v >= mv && p.lEar.in, re = p.rEar.v >= mv && p.rEar.in;
      if (le && re) {
        const lo = Math.min(p.lEar.x, p.rEar.x), hi = Math.max(p.lEar.x, p.rEar.x), w = hi - lo;
        const m = w > 0 ? Math.min(p.nose.x - lo, hi - p.nose.x) / w : -1;
        v += m > 0.2 ? 1.5 : -1.5; n++;
      } else if (le !== re) { v -= 0.5; n++; }
    }
    return n ? v : null;
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

  _frontLost(t) {
    const F = this._f;
    if (F.lastSeen != null && t - F.lastSeen > this.o.frontLostSec) { this._frontReset(t); this.signal = null; }
  }

  // Góc trước mặt: kết hợp 4 tín hiệu, mỗi tín hiệu có ngưỡng thích nghi riêng
  //  - cổ tay so với vai; khuỷu tay so với vai (khuỷu gập lại khi xuống)
  //  - độ cao của vai; độ cao của đầu (dùng được khi quá gần camera / không thấy cổ tay / bị che 1 vai)
  // và chặn đếm thừa khi đang đứng, đang chỉnh máy hoặc mất dấu người.
  _updateFront(p, t, out) {
    const o = this.o;
    const ok = (q) => q.v >= o.minVisibility && q.in;

    // --- Thước đo: bề rộng vai, hoặc suy ra từ khoảng cách 2 tai / 2 mắt khi bị che 1 vai ---
    const lS = ok(p.lSh), rS = ok(p.rSh);
    const earW = ok(p.lEar) && ok(p.rEar) ? Math.abs(p.lEar.x - p.rEar.x) : 0;
    const eyeW = ok(p.lEye) && ok(p.rEye) ? Math.abs(p.lEye.x - p.rEye.x) : 0;
    let sc = 0;
    if (lS && rS) {
      sc = dist(p.lSh, p.rSh);
      if (earW > 0) { const k = sc / earW; if (k > 1.2 && k < 5) this._earK += 0.05 * (k - this._earK); }
      if (eyeW > 0) { const k = sc / eyeW; if (k > 2 && k < 9) this._eyeK += 0.05 * (k - this._eyeK); }
    } else if (earW > 0) sc = earW * this._earK;
    else if (eyeW > 0) sc = eyeW * this._eyeK;
    else if (this._scale == null) {
      // chưa có thước đo nào: tạm lấy theo cánh tay trên đang thấy (bề rộng vai ≈ 1,3 lần)
      const arm = [[p.lSh, p.lEl], [p.rSh, p.rEl]].find(([a, b]) => ok(a) && ok(b));
      if (arm) sc = 1.3 * dist(arm[0], arm[1]);
    }
    if (sc > 0) this._scale = this._scale == null ? sc : this._scale + 0.1 * (sc - this._scale);
    const S = this._scale;

    // --- Giá trị thô của từng tín hiệu (lớn = đang lên) ---
    const wr = [], el = [];
    for (const [sh, e, w, shOK] of [[p.lSh, p.lEl, p.lWr, lS], [p.rSh, p.rEl, p.rWr, rS]]) {
      if (!shOK) continue;
      if (ok(e)) el.push(e.y - sh.y);
      if (ok(w)) wr.push(w.y - sh.y);
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const shY = lS && rS ? (p.lSh.y + p.rSh.y) / 2 : lS ? p.lSh.y : rS ? p.rSh.y : null;
    const raw = {};
    if (wr.length) raw.wrist = mean(wr);
    if (el.length) raw.elbow = mean(el);
    if (shY != null) raw.shoulder = -shY;
    if (ok(p.nose)) raw.head = -p.nose.y;

    if (!S || !Object.keys(raw).length) { this._frontLost(t); return; }
    this._frontLost(t);
    const F = this._f;
    F.lastSeen = t;

    // --- Chặn: đang đứng / đang chỉnh máy ---
    const gate = this._frontGate(p, t, S, sc, shY, ok);
    if (gate) {
      this._frontReset(t);
      this.signal = null;
      out.gate = gate;
      return;
    }

    // --- Làm mượt + lịch sử cho từng tín hiệu ---
    for (const k in raw) {
      let c = F.cues[k];
      if (!c || t - c.t > o.frontLostSec) c = F.cues[k] = { s: raw[k], t, hist: [] };
      else {
        c.s += (1 - Math.exp(-(t - c.t) / o.smoothTau)) * (raw[k] - c.s);
        c.t = t;
      }
      c.hist.push({ t, s: c.s });
      while (c.hist.length && c.hist[0].t < t - o.frontWindowSec) c.hist.shift();
      let mn = Infinity, mx = -Infinity;
      for (const h of c.hist) { if (h.s < mn) mn = h.s; if (h.s > mx) mx = h.s; }
      c.mn = mn; c.mx = mx;
    }
    out.valid = true;

    // Nếu thấy tay (đủ lâu) mà tay không hề gập => đầu/vai di chuyển là do máy bị xê dịch
    // hoặc người chỉ cúi đầu, không phải hít đất => bỏ qua tín hiệu đầu/vai.
    let armSeen = false, armMoving = false;
    for (const cue of FRONT_CUES) {
      if (cue.kind !== 'arm') continue;
      const c = F.cues[cue.key];
      if (!c || c.t !== t || c.hist[c.hist.length - 1].t - c.hist[0].t < 1) continue;
      armSeen = true;
      if (c.mx - c.mn >= 0.5 * o[cue.min] * S) armMoving = true;
    }
    const bodyAllowed = !armSeen || armMoving;

    let wsum = 0, fsum = 0, amp = 0;
    const used = [];
    for (const cue of FRONT_CUES) {
      const c = F.cues[cue.key];
      if (!c || c.t !== t) continue;
      if (cue.kind === 'body' && !bodyAllowed) continue;
      const range = c.mx - c.mn;
      if (range < o[cue.min] * S) continue;
      wsum += cue.w; fsum += (cue.w * (c.s - c.mn)) / range; amp += (cue.w * range) / S;
      used.push(cue.name);
    }
    out.cues = used;
    if (!wsum) { this.signal = null; return; }
    const frac = fsum / wsum;
    this.signal = frac;
    out.frac = frac;
    if (t < F.settleUntil) { out.gate = 'settle'; return; }

    if (this.phase === 'up') {
      if (frac >= o.frontUpFrac) this._armed = true;
      else if (frac <= o.frontDownFrac && this._armed) { this.phase = 'down'; F.downT = t; }
    } else if (t - F.downT > o.frontMaxDownSec) {
      this.phase = 'up'; this._armed = false; // nằm nghỉ quá lâu: không tính lượt này
    } else if (frac >= o.frontUpFrac) {
      this.phase = 'up';
      this._countRep(t, +(amp / wsum).toFixed(2), out);
    }
  }

  // Trả về lý do tạm dừng đếm ('upright' | 'hands' | 'moving'), hoặc null nếu bình thường
  _frontGate(p, t, S, sc, shY, ok) {
    const o = this.o, F = this._f;
    let gate = null;

    if (shY != null) {
      // Đang đứng: thấy rõ chân/hông nằm thấp hơn vai rất nhiều (thân người dựng đứng)
      const legs = [p.lKnee, p.rKnee, p.lAnk, p.rAnk].filter((q) => q.v >= 0.7 && q.in);
      if (legs.length >= 2 && (Math.max(...legs.map((q) => q.y)) - shY) / S > o.frontUprightLegRatio) gate = 'upright';
      const hips = [p.lHip, p.rHip].filter((q) => q.v >= 0.8 && q.in);
      if (!gate && hips.length && (hips.reduce((a, q) => a + q.y, 0) / hips.length - shY) / S > o.frontUprightHipRatio) gate = 'upright';
      // Tay giơ cao hơn vai (với tay chỉnh máy, vẫy tay…): không phải tư thế hít đất
      if (!gate && [p.lWr, p.rWr].some((q) => ok(q) && q.y < shY - 0.25 * S)) gate = 'hands';
    }

    // Đang chỉnh máy: cả khung hình trượt / giật nhanh, máy bị xoay, hoặc khoảng cách đổi đột ngột
    const dt = F.prevT == null ? 0 : t - F.prevT;
    const vx = [], vy = [];
    for (const k of ['nose', 'lSh', 'rSh']) {
      const q = p[k], pr = F.prev[k];
      if (ok(q) && pr && dt > 0 && dt < 0.5) { vx.push(Math.abs(q.x - pr.x) / dt); vy.push(Math.abs(q.y - pr.y) / dt); }
      F.prev[k] = ok(q) ? { x: q.x, y: q.y } : null;
    }
    F.prevT = t;
    if (vx.length) {
      vx.sort((a, b) => a - b);
      const a = 1 - Math.exp(-dt / 0.15);
      F.speedX += a * (vx[vx.length >> 1] - F.speedX);
      F.speedY += a * (Math.min(...vy) - F.speedY); // lấy nhỏ nhất: chỉ cao khi MỌI điểm cùng giật
    }
    if (!gate && (F.speedX / S > o.frontMaxSideSpeed || F.speedY / S > o.frontMaxVertSpeed)) gate = 'moving';
    if (!gate && ok(p.lSh) && ok(p.rSh)) {
      const tilt = (Math.atan2(Math.abs(p.lSh.y - p.rSh.y), Math.abs(p.lSh.x - p.rSh.x)) * 180) / Math.PI;
      if (tilt > o.frontMaxTiltDeg) gate = 'moving';
    }
    if (!gate && sc > 0 && (sc / S > 1.8 || sc / S < 0.55)) gate = 'moving';
    return gate;
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
      gate: out.gate || null,
      cues: out.cues || null,
    };
  }
}
