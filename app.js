import { FilesetResolver, PoseLandmarker } from './vendor/vision_bundle.mjs';
import { PushupCounter } from './counter.js';

const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};
const VIDEO_FPS = 15; // số khung hình phân tích mỗi giây video

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const stage = $('stage'), msg = $('msg');

const state = {
  mode: 'camera',
  view: 'auto',
  facing: 'environment',
  stream: null,
  running: false,
  analyzing: false,
  cancel: false,
  frames: [],      // kết quả phân tích video để xem lại
  replayRaf: 0,
  startTime: 0,
};

const counter = new PushupCounter({ view: state.view });

// Ảnh xám thu nhỏ 24x32 của khung hình: giúp đếm khi đầu áp sát camera (MediaPipe không thấy người)
const thumbCv = document.createElement('canvas');
thumbCv.width = 24; thumbCv.height = 32;
const thumbCtx = thumbCv.getContext('2d', { willReadFrequently: true });
const thumbBuf = new Float32Array(24 * 32);
function grabThumb() {
  try {
    thumbCtx.drawImage(video, 0, 0, 24, 32);
    const d = thumbCtx.getImageData(0, 0, 24, 32).data;
    for (let i = 0; i < thumbBuf.length; i++) thumbBuf[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
    return thumbBuf;
  } catch { return null; }
}

// ---------- Service worker (chạy offline) ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------- Mô hình ----------
let fileset = null;
const landmarkers = {};
let lastTs = 0;
const nextTs = (ms) => (lastTs = Math.max(lastTs + 1, Math.round(ms)));

async function getLandmarker(kind) {
  if (landmarkers[kind]) return landmarkers[kind];
  fileset ??= await FilesetResolver.forVisionTasks('./vendor/wasm');
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URLS[kind], delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    landmarkers[kind] = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch (e) {
    console.warn('GPU không dùng được, chuyển sang CPU', e);
    landmarkers[kind] = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
  }
  return landmarkers[kind];
}

// ---------- Giọng nói ----------
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang?.toLowerCase().startsWith('vi')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text) {
  if (!$('sound').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = 'vi-VN'; if (voice) u.voice = voice; u.rate = 1.15;
  speechSynthesis.speak(u);
}
function unlockSpeech() { // iOS cần 1 lần nói trong thao tác chạm
  if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
}

// ---------- Vẽ ----------
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
const ARM = new Set(['11-13', '13-15', '12-14', '14-16']);

function fitStage(w, h) {
  if (!w || !h) return;
  canvas.width = w; canvas.height = h;
  stage.style.aspectRatio = `${w} / ${h}`;
  stage.style.maxWidth = `calc(60vh * ${w / h})`;
}

function draw(lm, phase) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  const W = canvas.width, H = canvas.height;
  const s = Math.max(2, Math.round(Math.min(W, H) / 160));
  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    const p = lm[a], q = lm[b];
    if ((p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    ctx.strokeStyle = ARM.has(`${a}-${b}`) ? (phase === 'down' ? '#4aa3ff' : '#3ddc84') : 'rgba(255,255,255,.75)';
    ctx.lineWidth = s * 2;
    ctx.beginPath(); ctx.moveTo(p.x * W, p.y * H); ctx.lineTo(q.x * W, q.y * H); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = lm[i]; if ((p.visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(p.x * W, p.y * H, s * 2, 0, Math.PI * 2); ctx.fill();
  }
}

const VIEW_NAME = { side: 'Ngang người', front: 'Trước mặt' };
const GATE_TEXT = {
  upright: 'Đang đứng: tạm dừng đếm',
  hands: 'Tay giơ cao: tạm dừng đếm',
  moving: 'Máy đang di chuyển: chờ ổn định',
  lost: 'Không thấy người: chờ…',
  settle: 'Đang ổn định…',
};
function showHud(r) {
  const el = $('count');
  if (el.textContent !== String(r.count)) {
    el.textContent = r.count;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  $('bView').textContent = r.view ? `Góc: ${VIEW_NAME[r.view]}` : 'Góc: —';
  const ph = $('bPhase');
  if (r.gate && GATE_TEXT[r.gate]) { ph.textContent = GATE_TEXT[r.gate]; ph.className = 'badge warn'; }
  else if (!r.valid) { ph.textContent = 'Chưa thấy rõ tư thế'; ph.className = 'badge warn'; }
  else { ph.textContent = r.phase === 'down' ? 'Đang xuống' : 'Đang lên'; ph.className = `badge ${r.phase}`; }
  $('bSignal').textContent = r.view === 'side'
    ? (r.signal == null ? '—' : `Khuỷu tay: ${Math.round(r.signal)}°`)
    : r.signal == null ? (r.valid ? 'Đang đo biên độ…' : '—')
    : `Độ cao: ${Math.round(r.signal * 100)}%${r.cues?.length ? ` · theo ${r.cues.join(', ')}` : ''}`;
  const bp = $('bPartial');
  bp.classList.toggle('hidden', !r.partial);
  bp.textContent = `Chưa đủ sâu: ${r.partial}`;
}

function onEvent(r) {
  if (r.event === 'rep') say(r.count);
  else if (r.event === 'partial') say('Xuống sâu hơn');
}

function resetCounter() {
  counter.reset();
  showHud({ count: 0, partial: 0, phase: 'up', view: null, signal: null, valid: false, gate: null, cues: null });
  $('count').textContent = '0';
}

// ---------- Camera ----------
let wakeLock = null;
async function startCamera() {
  stopReplay();
  try {
    msg.textContent = 'Đang mở camera…'; msg.classList.remove('hidden');
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    msg.textContent = 'Không mở được camera. Hãy cho phép quyền camera (Cài đặt › Safari › Camera) rồi thử lại.';
    return;
  }
  video.removeAttribute('src'); video.controls = false;
  video.srcObject = state.stream;
  await video.play().catch(() => {});
  stage.classList.toggle('mirror', state.facing === 'user');
  fitStage(video.videoWidth, video.videoHeight);
  msg.classList.add('hidden');
  const lmk = await getLandmarker('lite');
  state.running = true; state.startTime = performance.now();
  $('btnStart').textContent = 'Dừng';
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

  const loop = () => {
    if (!state.running) return;
    if (video.readyState >= 2) {
      if (canvas.width !== video.videoWidth) fitStage(video.videoWidth, video.videoHeight);
      const now = performance.now();
      const res = lmk.detectForVideo(video, nextTs(now));
      const lm = res.landmarks?.[0];
      const r = counter.update(lm, now / 1000, video.videoWidth / video.videoHeight, grabThumb());
      draw(lm, r.phase); showHud(r); onEvent(r);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function stopCamera() {
  state.running = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null; video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  $('btnStart').textContent = 'Bắt đầu';
  msg.textContent = counter.count ? `Xong! ${counter.count} rep.` : 'Bấm “Bắt đầu” để mở camera.';
  msg.classList.remove('hidden');
}

$('btnStart').onclick = () => {
  unlockSpeech();
  state.running ? stopCamera() : startCamera();
};
$('btnFlip').onclick = async () => {
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  if (state.running) { stopCamera(); await startCamera(); }
};
$('btnReset').onclick = resetCounter;

// ---------- Video ----------
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function waitEvent(el, ev, timeout = 3000) {
  return new Promise((res) => {
    const done = () => { el.removeEventListener(ev, done); clearTimeout(tm); res(); };
    const tm = setTimeout(done, timeout);
    el.addEventListener(ev, done, { once: true });
  });
}

async function seek(t) {
  const p = waitEvent(video, 'seeked', 2000);
  video.currentTime = t;
  await p;
}

$('file').onchange = async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  unlockSpeech();
  await analyzeVideo(f);
};

async function analyzeVideo(file) {
  stopReplay();
  state.analyzing = true; state.cancel = false;
  $('btnPick').classList.add('hidden'); $('btnCancel').classList.remove('hidden');
  $('result').classList.add('hidden'); $('vidHint').classList.add('hidden');
  const bar = $('progress'); bar.style.display = 'block'; bar.firstElementChild.style.width = '0%';
  msg.textContent = 'Đang tải mô hình…'; msg.classList.remove('hidden');
  stage.classList.remove('mirror');

  video.srcObject = null; video.controls = false; video.muted = true;
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  await waitEvent(video, 'loadeddata', 8000);
  // iOS: cần play/pause một lần để seek trả về khung hình
  try { await video.play(); video.pause(); } catch {}
  fitStage(video.videoWidth, video.videoHeight);

  const lmk = await getLandmarker('full');
  resetCounter();
  const dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) { msg.textContent = 'Không đọc được video này.'; return finishAnalyze(); }
  msg.classList.add('hidden');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

  const aspect = video.videoWidth / video.videoHeight;
  const frames = [];
  const step = 1 / VIDEO_FPS;
  let lastPaint = 0;
  for (let t = 0; t < dur && !state.cancel; t += step) {
    await seek(t);
    const res = lmk.detectForVideo(video, nextTs(lastTs + step * 1000));
    const lm = res.landmarks?.[0];
    const r = counter.update(lm, t, aspect, grabThumb());
    frames.push({ t, lm: lm ? lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })) : null, count: r.count, partial: r.partial, phase: r.phase, view: r.view, signal: r.signal, valid: r.valid, gate: r.gate, cues: r.cues });
    const now = performance.now();
    if (now - lastPaint > 60) { draw(lm, r.phase); showHud(r); bar.firstElementChild.style.width = `${(100 * t) / dur}%`; lastPaint = now; }
    if (r.event === 'rep') showHud(r);
  }
  wakeLock?.release?.().catch(() => {}); wakeLock = null;

  if (state.cancel) { msg.textContent = 'Đã huỷ.'; msg.classList.remove('hidden'); return finishAnalyze(); }
  bar.firstElementChild.style.width = '100%';
  state.frames = frames;
  showResult(dur);
  say(`${counter.count} cái`);
  finishAnalyze();
  await seek(0);
  video.controls = true;
  startReplay();
}

function finishAnalyze() {
  state.analyzing = false;
  $('btnPick').classList.remove('hidden'); $('btnCancel').classList.add('hidden');
  setTimeout(() => ($('progress').style.display = 'none'), 600);
}
$('btnCancel').onclick = () => (state.cancel = true);

function showResult(dur) {
  $('result').classList.remove('hidden');
  $('rCount').textContent = counter.count;
  $('rPartial').textContent = counter.partial;
  $('rPartialBox').classList.toggle('hidden', counter.view !== 'side');
  const reps = counter.reps;
  const span = reps.length > 1 ? reps.at(-1).t - reps[0].t : 0;
  $('rPace').textContent = span > 0 ? Math.round(((reps.length - 1) / span) * 60) : '–';
  const ul = $('repList'); ul.innerHTML = '';
  reps.forEach((r, i) => {
    const li = document.createElement('li');
    const detail = counter.view === 'side' ? `góc thấp nhất ${r.depth}°` : `biên độ ${r.depth} lần bề rộng vai`;
    li.innerHTML = `<b>Rep ${i + 1}</b><span>${fmt(r.t)} · ${detail}</span>`;
    li.onclick = () => { video.currentTime = Math.max(0, r.t - 1.2); video.play(); };
    ul.appendChild(li);
  });
  if (!reps.length) ul.innerHTML = '<li><span>Không đếm được rep nào. Thử chọn đúng góc quay, hoặc quay rõ người hơn.</span></li>';
}

function startReplay() {
  const fr = state.frames;
  const loop = () => {
    const t = video.currentTime;
    let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (fr[m].t <= t) lo = m; else hi = m - 1; }
    const f = fr[lo];
    if (f) { draw(f.lm, f.phase); showHud(f); }
    state.replayRaf = requestAnimationFrame(loop);
  };
  state.replayRaf = requestAnimationFrame(loop);
}
function stopReplay() { cancelAnimationFrame(state.replayRaf); state.replayRaf = 0; }

// ---------- Chuyển chế độ / góc quay ----------
function setSeg(segId, attr, val) {
  for (const b of $(segId).querySelectorAll('button')) b.classList.toggle('on', b.dataset[attr] === val);
}

$('modeSeg').onclick = (e) => {
  const m = e.target.dataset.mode; if (!m || m === state.mode || state.analyzing) return;
  state.mode = m; setSeg('modeSeg', 'mode', m);
  $('camCtl').classList.toggle('hidden', m !== 'camera');
  $('vidCtl').classList.toggle('hidden', m !== 'video');
  stopReplay();
  if (state.running) stopCamera();
  video.pause(); video.controls = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resetCounter();
  msg.classList.remove('hidden');
  msg.textContent = m === 'camera' ? 'Bấm “Bắt đầu” để mở camera.' : 'Chọn một video hít đất từ thư viện.';
  if (m === 'video') { $('result').classList.add('hidden'); $('vidHint').classList.remove('hidden'); video.removeAttribute('src'); video.load(); }
  else { video.removeAttribute('src'); video.load(); }
};

$('viewSeg').onclick = (e) => {
  const v = e.target.dataset.view; if (!v || state.analyzing) return;
  state.view = v; setSeg('viewSeg', 'view', v);
  counter.setOptions({ view: v });
  counter.reset();
  resetCounter();
};

// ---------- Khởi động ----------
(async () => {
  try {
    await getLandmarker('lite');
    msg.textContent = 'Bấm “Bắt đầu” để mở camera.';
    $('btnStart').disabled = false;
    // tải sẵn mô hình "full" (cho phân tích video) để lần sau dùng offline
    setTimeout(() => fetch(MODEL_URLS.full, { mode: 'cors' }).catch(() => {}), 3000);
  } catch (e) {
    console.error(e);
    msg.textContent = 'Không tải được mô hình AI. Lần đầu mở app cần có mạng — kiểm tra kết nối rồi mở lại.';
  }
})();
