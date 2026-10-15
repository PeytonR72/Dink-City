import './phone.css';
import { CONTROLLER_VERSION, isPairCode, readControllerMsg, type ControllerMsg, type Swing } from '../net/controller';
import { motionTuning } from '../input/motionTuning';
import { GestureDetector, rotationSpeed, tiltAim, type Calibration, type MotionSample } from './gesture';
import { controllerUrl } from './url';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const code = new URLSearchParams(location.search).get('pair');
const debug = new URLSearchParams(location.search).has('debug');
let ws: WebSocket | null = null;
let calibration: Calibration | null = null;
let sample: MotionSample | null = null;
let orientation = { pitch: 0, roll: 0, yaw: 0 };
let orientationAt = 0;
let lastMotion = 0;
let lastTilt = 0;
let lastPing = 0;
let enabled = false;
let permissionAttempt = 0;
let wake: WakeLockSentinel | null = null;
let record: MotionSample[] | null = null;
let recordedCalibration: Calibration | null = null;
let recordStarted = 0;
const chart: MotionSample[] = [];
const detector = new GestureDetector(motionTuning);
const status = (message: string) => { el('status').textContent = message; };
const send = (m: ControllerMsg) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
function close() { const old = ws; ws = null; old?.close(1000); void wake?.release(); wake = null; detector.reset(); }
async function awake() { if (document.visibilityState !== 'visible' || !calibration || ws?.readyState !== WebSocket.OPEN) return; try { wake = await navigator.wakeLock?.request('screen') ?? null; } catch {} }
function connect() {
  close();
  if (!code || !isPairCode(code) || !calibration) return;
  status('Connecting to your game…');
  const socket = ws = new WebSocket(controllerUrl(code, 'phone'));
  socket.onopen = () => {
    if (ws !== socket) return;
    lastPing = Date.now(); send({ t: 'hello', version: CONTROLLER_VERSION });
    status('Connected. Swing when the ball arrives.'); void awake();
  };
  socket.onmessage = e => {
    if (ws !== socket) return;
    const m = readControllerMsg(e.data);
    if (m?.t === 'ping') { lastPing = Date.now(); send({ t: 'pong', at: m.at, phoneAt: Date.now() }); }
    else if (m?.t === 'hit') navigator.vibrate?.(35);
  };
  socket.onclose = e => {
    if (ws !== socket) return;
    close();
    status(e.reason === 'replaced' ? 'Another phone replaced this controller. Reconnect to take over.' : e.reason === 'expired' ? 'Pair code expired. Scan a new code on the game screen.' : 'Controller disconnected. Tap Reconnect or scan a new code.');
  };
  socket.onerror = () => { if (ws === socket) status('Cannot reach the relay. Check the connection and Pair code.'); };
}
function calibrate() {
  close(); calibration = null; record = null; el('record').textContent = 'Record trace';
  el('enable').hidden = true; el('playing').hidden = true; el('calibrate').hidden = false;
  status('Hold your phone like a paddle. Pick your hand and tap Ready.');
}
type PermissionAPI = { requestPermission?: () => Promise<string> };
el<HTMLButtonElement>('permission').onclick = async () => {
  if (!isSecureContext) { status('Motion needs HTTPS. Open the HTTPS preview or tunnel, not a plain HTTP LAN address.'); return; }
  if (!('DeviceMotionEvent' in window)) { status('This browser has no motion sensors. Try Safari on iPhone or Chrome on Android.'); return; }
  const attempt = ++permissionAttempt;
  el<HTMLButtonElement>('permission').disabled = true;
  try {
    // Invoke both APIs in the tap stack, before awaiting either (iPhone transient activation).
    const motion = (DeviceMotionEvent as unknown as PermissionAPI).requestPermission?.();
    const orient = typeof DeviceOrientationEvent !== 'undefined' ? (DeviceOrientationEvent as unknown as PermissionAPI).requestPermission?.() : undefined;
    const results = await Promise.all([motion, orient]);
    if (attempt !== permissionAttempt) return;
    if (results.some(result => result && result !== 'granted')) { status('Motion permission denied. Allow Motion & Orientation in browser settings, then try again.'); return; }
    enabled = true; lastMotion = Date.now(); calibrate();
  } catch { status('Motion permission could not be enabled. Check browser permissions and try again.'); }
  finally { if (attempt === permissionAttempt) el<HTMLButtonElement>('permission').disabled = false; }
};
el('ready').onclick = () => {
  if (!sample || Date.now() - sample.at > 1500) { status('No gyroscope samples yet. Move the phone gently; check motion permission.'); return; }
  calibration = { ...sample.orientation, hand: el<HTMLSelectElement>('hand').value === 'left' ? 'left' : 'right' };
  detector.reset(); el('calibrate').hidden = true; el('playing').hidden = false; connect();
};
el('recalibrate').onclick = calibrate;
el('reconnect').onclick = () => { if (calibration) connect(); else calibrate(); };
window.addEventListener('deviceorientation', e => {
  if (!enabled || e.beta === null || e.gamma === null || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
  orientation = { pitch: e.beta, roll: e.gamma, yaw: e.alpha ?? 0 }; orientationAt = Date.now();
});
window.addEventListener('devicemotion', e => {
  if (!enabled || document.hidden) return;
  const r = e.rotationRate;
  if (!r || r.alpha === null || r.beta === null || r.gamma === null) return;
  const now = Date.now();
  const dt = Math.max(0, Math.min(0.05, (now - lastMotion) / 1000)); lastMotion = now;
  if (now - orientationAt > 200) orientation = { pitch: orientation.pitch + r.beta * dt, roll: orientation.roll + r.gamma * dt, yaw: orientation.yaw + r.alpha * dt };
  const a = e.acceleration ?? e.accelerationIncludingGravity;
  sample = { at: now, rotation: { alpha: r.alpha, beta: r.beta, gamma: r.gamma }, acceleration: { x: a?.x ?? 0, y: a?.y ?? 0, z: a?.z ?? 0 }, orientation: { ...orientation } };
  if (debug) { chart.push(sample); if (chart.length > 150) chart.shift(); draw(); }
  if (record) { record.push(sample); if (now - recordStarted >= 60_000 || record.length >= 12_000) saveTrace(); }
  if (!calibration || ws?.readyState !== WebSocket.OPEN) return;
  if (now - lastTilt >= motionTuning.tiltIntervalMs) { lastTilt = now; send({ t: 'tilt', aim: tiltAim(sample, calibration, motionTuning) }); }
  const swing = detector.push(sample, calibration);
  if (swing) { send({ t: 'swing', ...swing }); showSwing(swing); }
});
function showSwing(s: Swing) {
  el('last-swing').textContent = s.type.toUpperCase() + ' · aim ' + s.aim.x.toFixed(2) + ' · strength ' + s.strength.toFixed(2);
  const peak = chart.find(sample => sample.at === s.at);
  if (debug && peak) el('last-peak').textContent = 'Last peak: ' + Math.round(rotationSpeed(peak)) + ' deg/s · ' + s.type + ' · ' + s.at + ' ms';
}
setInterval(() => {
  if (enabled && !document.hidden && Date.now() - lastMotion > 4000) { if (ws) close(); status('No gyroscope data. Check sensor permissions, keep this page visible, then reconnect.'); }
  if (ws?.readyState === WebSocket.OPEN && Date.now() - lastPing > 7000) { close(); status('Connection lost. Tap Reconnect.'); }
}, 1000);
document.addEventListener('visibilitychange', () => {
  detector.reset();
  if (document.hidden) { permissionAttempt++; close(); if (calibration) status('Controller paused while hidden. Return here and tap Reconnect.'); }
  else { lastMotion = Date.now(); el<HTMLButtonElement>('permission').disabled = false; }
});
window.addEventListener('pagehide', () => { permissionAttempt++; close(); });
el('motion-debug').hidden = !debug;
if (debug) {
  for (const key of Object.keys(motionTuning) as (keyof typeof motionTuning)[]) {
    const label = document.createElement('label'); label.textContent = key;
    const range = document.createElement('input'); range.type = 'range'; range.step = key === 'peakFallRatio' || key === 'settleRatio' || key === 'autoMoveSpeed' ? '0.05' : '1'; range.min = key === 'swingLeadMs' ? '-200' : key === 'swingWindowTicks' ? '1' : '0.05'; range.max = String(key === 'peakFallRatio' || key === 'settleRatio' || key === 'autoMoveSpeed' ? 1 : key === 'swingWindowTicks' ? 30 : key === 'swingLeadMs' ? 200 : key === 'aimDegrees' || key === 'lobPitchDegrees' ? 180 : 1500); range.value = String(motionTuning[key]);
    range.onchange = () => { const value = Number(range.value); if (Number.isFinite(value) && value >= Number(range.min) && value <= 5000) { motionTuning[key] = value; detector.reset(); } };
    const valueLabel = document.createElement('output'); valueLabel.textContent = String(motionTuning[key]);
    range.oninput = () => { range.onchange?.call(range, new Event('change')); valueLabel.textContent = range.value; };
    label.append(valueLabel, range); el('tuning').append(label);
  }
}
el('record').onclick = () => {
  if (record) return saveTrace();
  if (!calibration) { status('Calibrate before recording a trace.'); return; }
  if (!el<HTMLInputElement>('participant').value.trim()) { status('Enter a participant alias before recording.'); return; }
  record = []; recordedCalibration = { ...calibration }; recordStarted = Date.now(); el('record').textContent = 'Save trace';
};
function saveTrace() {
  if (!record) return;
  const label = el<HTMLSelectElement>('label').value;
  const trace = { version: 1, source: 'recorded-human', participant: el<HTMLInputElement>('participant').value.trim(), label, calibration: recordedCalibration, tuning: { ...motionTuning }, userAgent: navigator.userAgent, samples: record };
  record = null; el('record').textContent = 'Record trace';
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'motion-' + label + '-' + Date.now() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function draw() {
  const ctx = el<HTMLCanvasElement>('trace').getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, 600, 180);
  for (const [color, value] of [['#c5ed8c', (s: MotionSample) => rotationSpeed(s) / 6], ['#ffb66f', (s: MotionSample) => Math.hypot(...Object.values(s.acceleration)) * 3]] as const) {
    ctx.strokeStyle = color; ctx.beginPath(); chart.forEach((s, i) => { const x = i * 4; const y = 170 - Math.min(160, value(s)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  }
  el('sensor-values').textContent = JSON.stringify(sample, null, 1);
}
if (!isPairCode(code)) { status('Invalid Pair code. Scan the QR code on your game screen.'); el<HTMLButtonElement>('permission').disabled = true; }
