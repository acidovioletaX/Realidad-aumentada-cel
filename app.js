'use strict';
const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('stage'), ctx = canvas.getContext('2d');

const PALETTES = [
  ['#b6ff00', '#ff1fa9', '#00f0ff', '#2a0050'],
  ['#ff6a00', '#fff200', '#ff1fa9', '#3a0030'],
  ['#00f0ff', '#8a2bff', '#b6ff00', '#001a40'],
  ['#ff1fa9', '#00f0ff', '#fff200', '#200040'],
  ['#fff200', '#ff3b00', '#8a2bff', '#30002a'],
];
// pentatónica menor, notas en Hz
const SCALE = [110, 130.8, 146.8, 164.8, 196, 220, 261.6, 293.7, 329.6, 392, 440];

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.width = Math.round(innerWidth * DPR);
  H = canvas.height = Math.round(innerHeight * DPR);
}
addEventListener('resize', resize); resize();

/* ---------- sprites del orbe (mandala + sombreado) ---------- */
const S = 512;
function makeMandala(pal) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = S / 2;
  g.translate(r, r);
  g.beginPath(); g.arc(0, 0, r - 2, 0, 7); g.clip();
  const bg = g.createRadialGradient(0, 0, 0, 0, 0, r);
  bg.addColorStop(0, pal[2]); bg.addColorStop(.5, pal[3]); bg.addColorStop(1, pal[3]);
  g.fillStyle = bg; g.fillRect(-r, -r, S, S);
  const rings = 6 + (Math.random() * 3 | 0);
  for (let i = rings; i >= 1; i--) {
    const rr = r * i / rings, n = 6 + ((Math.random() * 4 | 0) * 2) + i * 2;
    const col = pal[i % 3], col2 = pal[(i + 1) % 3];
    const kind = (Math.random() * 3) | 0;
    g.save(); g.rotate(Math.random() * 6.28);
    for (let k = 0; k < n; k++) {
      g.save(); g.rotate(k * 6.2832 / n);
      g.beginPath();
      const w = rr * Math.PI / n * (kind === 0 ? .95 : .75);
      if (kind === 2) { g.moveTo(0, -rr); g.lineTo(w, -rr * .55); g.lineTo(0, -rr * .28); g.lineTo(-w, -rr * .55); }
      else { g.moveTo(0, -rr * .45); g.quadraticCurveTo(w * 1.5, -rr * .75, 0, -rr); g.quadraticCurveTo(-w * 1.5, -rr * .75, 0, -rr * .45); }
      g.closePath();
      g.fillStyle = col; g.fill();
      g.lineWidth = 3; g.strokeStyle = col2; g.stroke();
      g.beginPath(); g.arc(0, -rr * .72, rr * .045, 0, 7); g.fillStyle = col2; g.fill();
      g.restore();
    }
    g.restore();
    g.beginPath(); g.arc(0, 0, rr, 0, 7); g.lineWidth = 4; g.strokeStyle = pal[(i + 2) % 3]; g.stroke();
  }
  g.beginPath(); g.arc(0, 0, r * .09, 0, 7); g.fillStyle = '#fff'; g.fill();
  return c;
}
const shade = (() => {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = S / 2;
  let q = g.createRadialGradient(r * .7, r * .6, r * .05, r, r, r);
  q.addColorStop(0, 'rgba(255,255,255,.0)'); q.addColorStop(.55, 'rgba(0,0,0,.0)');
  q.addColorStop(.85, 'rgba(0,0,0,.45)'); q.addColorStop(1, 'rgba(0,0,0,.8)');
  g.fillStyle = q; g.beginPath(); g.arc(r, r, r, 0, 7); g.fill();
  q = g.createRadialGradient(r * .62, r * .5, 0, r * .62, r * .5, r * .38);
  q.addColorStop(0, 'rgba(255,255,255,.85)'); q.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = q; g.beginPath(); g.arc(r, r, r, 0, 7); g.fill();
  return c;
})();

/* ---------- audio ---------- */
let ac, master, delay, wet, muted = false, recDest;
function initAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = .8;
  const comp = ac.createDynamicsCompressor();
  delay = ac.createDelay(1); delay.delayTime.value = .33;
  const fb = ac.createGain(); fb.gain.value = .42;
  wet = ac.createGain(); wet.gain.value = .35;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
  delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet);
  master.connect(comp); wet.connect(comp); master.connect(delay);
  comp.connect(ac.destination);
  recDest = ac.createMediaStreamDestination(); comp.connect(recDest);
}
function makeVoice(freq) {
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const m = ac.createOscillator(); m.type = 'sine'; m.frequency.value = freq * 2.01;
  const mg = ac.createGain(); mg.gain.value = freq * .6; m.connect(mg); mg.connect(o.frequency);
  const lfo = ac.createOscillator(); lfo.frequency.value = .15 + Math.random() * .5;
  const lg = ac.createGain(); lg.gain.value = .5; lfo.connect(lg);
  const amp = ac.createGain(); amp.gain.value = 0; lg.connect(amp.gain);
  const bias = ac.createConstantSource ? ac.createConstantSource() : null;
  const pan = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
  o.connect(amp); amp.connect(pan); pan.connect(master);
  o.start(); m.start(); lfo.start();
  return { o, m, mg, lfo, amp, pan, gainNode: amp };
}
function pluck(freq, pan = 0, vol = .25) {
  if (!ac || muted) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  const p = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(freq * 2, t); o.frequency.exponentialRampToValueAtTime(freq, t + .08);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .9);
  if (p.pan) p.pan.value = pan;
  o.connect(g); g.connect(p); p.connect(master); o.start(t); o.stop(t + 1);
}

/* ---------- orbes ---------- */
const orbs = [];
let tilt = { x: 0, y: 0 };
function spawn(x, y) {
  const pal = PALETTES[(Math.random() * PALETTES.length) | 0];
  const base = Math.min(innerWidth, innerHeight);
  const radius = (.09 + Math.random() * .16) * base;
  const note = SCALE[(Math.random() * SCALE.length) | 0];
  const orb = {
    x: x ?? (.15 + Math.random() * .7) * innerWidth, y: y ?? (.15 + Math.random() * .6) * innerHeight,
    vx: (Math.random() - .5) * 40, vy: (Math.random() - .5) * 40, r: radius,
    spin: (Math.random() < .5 ? -1 : 1) * (.15 + Math.random() * .5), a: Math.random() * 6.28,
    depth: .3 + Math.random() * .7, ph: Math.random() * 6.28, sprite: makeMandala(pal), note,
    voice: ac ? makeVoice(note) : null, grab: false, born: performance.now(),
  };
  orbs.push(orb);
  if (orbs.length > 12) { const old = orbs.shift(); killVoice(old); }
  pluck(note * 2, (orb.x / innerWidth) * 2 - 1);
}
function killVoice(o) {
  if (!o.voice) return;
  const v = o.voice, t = ac.currentTime;
  v.amp.gain.cancelScheduledValues(t);
  setTimeout(() => { try { v.o.stop(); v.m.stop(); v.lfo.stop(); } catch (e) {} }, 300);
}

function update(dt, now) {
  for (const o of orbs) {
    if (!o.grab) {
      o.x += o.vx * dt; o.y += o.vy * dt;
      o.vx *= .999; o.vy *= .999;
      if (Math.hypot(o.vx, o.vy) < 12) { o.vx += (Math.random() - .5) * 20 * dt; o.vy += (Math.random() - .5) * 20 * dt; }
      let hit = false;
      if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); hit = true; }
      if (o.x > innerWidth - o.r) { o.x = innerWidth - o.r; o.vx = -Math.abs(o.vx); hit = true; }
      if (o.y < o.r) { o.y = o.r; o.vy = Math.abs(o.vy); hit = true; }
      if (o.y > innerHeight - o.r) { o.y = innerHeight - o.r; o.vy = -Math.abs(o.vy); hit = true; }
      if (hit) pluck(o.note * 2, (o.x / innerWidth) * 2 - 1, .12);
    }
    o.a += o.spin * dt;
    if (o.voice) {
      const t = ac.currentTime, v = o.voice;
      const g = muted ? 0 : .06 + (o.r / Math.min(innerWidth, innerHeight)) * .25;
      v.amp.gain.setTargetAtTime(g, t, .1);
      v.o.frequency.setTargetAtTime(o.note * (1 + Math.sin(now / 1500 + o.ph) * .004 + (1 - o.y / innerHeight) * .12), t, .1);
      if (v.pan.pan) v.pan.pan.setTargetAtTime((o.x / innerWidth) * 2 - 1, t, .1);
    }
  }
  // choques entre orbes
  for (let i = 0; i < orbs.length; i++) for (let j = i + 1; j < orbs.length; j++) {
    const a = orbs[i], b = orbs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = (a.r + b.r) * .9;
    if (d < min && d > 0) {
      const nx = dx / d, ny = dy / d, rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        a.vx += nx * rel; a.vy += ny * rel; b.vx -= nx * rel; b.vy -= ny * rel;
        if (!a._c || now - a._c > 400) { a._c = now; pluck((a.note + b.note) / 2 * 4, ((a.x + b.x) / innerWidth) - 1, .15); }
      }
    }
  }
}

function drawVideo() {
  if (video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(W / vw, H / vh);
    const dw = vw * s, dh = vh * s;
    ctx.save();
    if (facing === 'user') { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1a0033'); g.addColorStop(1, '#001a2a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function drawOrb(o, now) {
  const bob = Math.sin(now / 1200 + o.ph) * o.r * .06;
  const px = (o.x + tilt.x * 60 * o.depth) * DPR, py = (o.y + bob + tilt.y * 60 * o.depth) * DPR, r = o.r * DPR;
  const grow = Math.max(0, Math.min(1, (now - o.born) / 500)), rr = r * (1 - Math.pow(1 - grow, 3));
  // sombra proyectada en el "suelo"
  ctx.save();
  ctx.translate(px + rr * .25, py + rr * 1.05);
  ctx.scale(1, .22);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, rr * .95);
  sg.addColorStop(0, 'rgba(0,0,0,.6)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, rr * .95, 0, 7); ctx.fill();
  ctx.restore();
  // resplandor
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = rr * .25; ctx.shadowOffsetX = rr * .08; ctx.shadowOffsetY = rr * .12;
  ctx.translate(px, py); ctx.rotate(o.a);
  ctx.drawImage(o.sprite, -rr, -rr, rr * 2, rr * 2);
  ctx.restore();
  ctx.drawImage(shade, px - rr, py - rr, rr * 2, rr * 2);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  update(dt, now);
  drawVideo();
  for (const o of orbs.slice().sort((a, b) => a.depth - b.depth)) drawOrb(o, now);
  requestAnimationFrame(frame);
}

/* ---------- cámara ---------- */
let facing = 'environment', stream;
async function startCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play();
  } catch (e) {
    $('err').textContent = 'Sin cámara (' + (e.message || e.name) + '). Funciona igual con fondo oscuro; la cámara requiere HTTPS.';
  }
}

/* ---------- interacción ---------- */
let drag = null, downAt = 0, moved = false;
function hit(x, y) { return orbs.slice().reverse().find(o => Math.hypot(o.x - x, o.y - y) < o.r); }
canvas.addEventListener('pointerdown', e => {
  const o = hit(e.clientX, e.clientY); downAt = performance.now(); moved = false;
  drag = o ? { o, dx: o.x - e.clientX, dy: o.y - e.clientY, px: e.clientX, py: e.clientY, pt: downAt } : null;
  if (o) o.grab = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return; moved = true;
  const t = performance.now(), o = drag.o;
  o.x = e.clientX + drag.dx; o.y = e.clientY + drag.dy;
  const d = Math.max(16, t - drag.pt); o.vx = (e.clientX - drag.px) / d * 1000; o.vy = (e.clientY - drag.py) / d * 1000;
  drag.px = e.clientX; drag.py = e.clientY; drag.pt = t;
});
canvas.addEventListener('pointerup', e => {
  if (drag) { drag.o.grab = false; const s = Math.hypot(drag.o.vx, drag.o.vy); if (s > 900) { drag.o.vx *= 900 / s; drag.o.vy *= 900 / s; } }
  else if (!moved) spawn(e.clientX, e.clientY);
  drag = null;
});
addEventListener('deviceorientation', e => {
  if (e.gamma == null) return;
  tilt.x += ((e.gamma / 45) - tilt.x) * .1; tilt.y += (((e.beta - 60) / 45) - tilt.y) * .1;
});

/* ---------- grabación ---------- */
let rec, chunks = [], tInt, t0;
function toggleRec() {
  if (rec && rec.state === 'recording') { rec.stop(); return; }
  if (!window.MediaRecorder) { alert('Tu navegador no soporta grabación. Usa la grabación de pantalla del móvil.'); return; }
  const vs = canvas.captureStream(30);
  if (recDest) recDest.stream.getAudioTracks().forEach(t => vs.addTrack(t));
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t));
  rec = new MediaRecorder(vs, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
  chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    clearInterval(tInt); $('timer').textContent = ''; $('rec').classList.remove('on');
    const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'orbes-' + Date.now() + (blob.type.includes('mp4') ? '.mp4' : '.webm'); a.click();
  };
  rec.start(1000); t0 = Date.now(); $('rec').classList.add('on');
  tInt = setInterval(() => { const s = (Date.now() - t0) / 1000 | 0; $('timer').textContent = '● ' + (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); }, 500);
}

/* ---------- arranque ---------- */
$('start').onclick = async () => {
  initAudio(); await ac.resume();
  if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) { try { await DeviceOrientationEvent.requestPermission(); } catch (e) {} }
  await startCamera();
  $('intro').hidden = true; $('ui').hidden = false;
  for (let i = 0; i < 4; i++) setTimeout(() => spawn(), i * 350);
  requestAnimationFrame(frame);
};
$('add').onclick = () => spawn();
$('clear').onclick = () => { orbs.splice(0).forEach(killVoice); };
$('flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
$('mute').onclick = () => { muted = !muted; $('mute').classList.toggle('off', muted); };
$('rec').onclick = toggleRec;
