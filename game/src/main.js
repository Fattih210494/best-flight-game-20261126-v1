// Flight World v1 — Senja Runway. Desert airport, vintage biplane (GLB),
// taxi -> takeoff -> 3 rings -> land -> earn money + XP. Chase view only.
// cameras, full Flight World UI (Hangar / Shop / Jobs / Missions, Engine /
// Reverse Thrust / Brake, virtual joystick, Flaps / Spoilers, money + XP),
// WebAudio synth sounds, keyboard + mouse, static files, no network.
import * as THREE from 'three';
import { clamp, degToRad } from './noise.js';
import { buildWorld, heightAt, RINGS, RING_RADIUS, RUNWAY_Y, SPAWN } from './world.js';
import { loadBiplane, setPaint, createFlight, resetFlight, stepFlight, applyToModel, MAX_SPEED, GEAR_H } from './plane.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { applyShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

// --- Renderer / scene / camera -------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 12000);
scene.add(camera);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const world = buildWorld(scene);
const audio = createAudio();
const input = createInput(canvas);

// --- Economy (localStorage) -----------------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('fw-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fw-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const econ = {
  money: store.get('money', 1000),
  xp: store.get('xp', 0),
  paint: store.get('paint', 0),
  owned: store.get('owned', [0]),
  stats: store.get('stats', { flights: 0, landings: 0, rings: 0, earned: 0 }),
  missions: store.get('missions', { smooth: false, rings: false }),
  job: store.get('job', 0),
  muted: store.get('muted', false),
};
function saveEcon() {
  store.set('money', econ.money);
  store.set('xp', econ.xp);
  store.set('paint', econ.paint);
  store.set('owned', econ.owned);
  store.set('stats', econ.stats);
  store.set('missions', econ.missions);
  store.set('job', econ.job);
  store.set('muted', econ.muted);
}
// (Paint is applied after the GLB loads, in boot().)

const PAINTS = [
  { name: 'Desert Camo', accent: 0xe8641f, tip: 0xd43a24, price: 0, tint: 0xffffff },
  { name: 'Desert Sand', accent: 0xc8a24a, tip: 0x8a6a2a, price: 400, tint: 0xf0d8a0 },
  { name: 'Ocean Teal', accent: 0x1f8a8a, tip: 0x145656, price: 600, tint: 0xb8e0e0 },
  { name: 'Midnight Violet', accent: 0x7a4fd0, tip: 0x4a2a8a, price: 800, tint: 0xd0b8f0 },
];
const JOBS = [
  { name: 'Desert Hop', pay: 850, desc: 'Senja Runway → Mountain Strip and back. A gentle first route.', perfectVs: -3.0 },
  { name: 'Mountain Tour', pay: 1200, desc: 'A scenic loop over the northern peaks. Pays best, lands hardest.', perfectVs: -2.5 },
  { name: 'Sunset Charter', pay: 950, desc: 'An evening hop for a sunset photo crew. Smooth touchdown required.', perfectVs: -3.5 },
];
const MISSIONS = [
  { id: 'smooth', name: 'Smooth Landing', reward: 500, desc: 'Land with a vertical speed better than -3.0 m/s.' },
  { id: 'rings', name: 'Ring Master', reward: 300, desc: 'Fly all 3 rings in one flight.' },
];

// --- Aircraft (loaded async from the GLB; see boot() at the bottom) -----
let planeModel = null;

// --- Game state ------------------------------------------------------------
const flight = createFlight();
const game = {
  state: 'title', // title | flying | over
  camMode: 'chase',
  time: 0,
  nextRing: 0,
  ringsHit: 0,
  panelOpen: false,
  msgTimer: 0,
  mapTimer: 0,
  crashFlash: 0,
  perfectVs: JOBS[econ.job].perfectVs,
};
let titleAngle = 0.6;

// Guide arrow: a cone above the plane pointing at the next objective.
const guide = new THREE.Group();
{
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 4, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }),
  );
  cone.rotation.x = Math.PI / 2;
  guide.add(cone);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.25, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.7 }),
  );
  guide.add(ring);
  scene.add(guide);
}

// Chase view only: the whole biplane stays in frame during play
// (no cockpit mode — the user wants the full plane visible at all times).

// --- HUD -------------------------------------------------------------------
const msgEl = $('toast');
const flashEl = $('flash');
function toast(text, secs = 2.5) {
  msgEl.textContent = text;
  msgEl.style.opacity = '1';
  game.msgTimer = secs;
}
function flash() {
  flashEl.style.opacity = '1';
  setTimeout(() => { flashEl.style.opacity = '0'; }, 150);
}

// Ring-pass burst: a cloud of glowing points that explodes out of the ring
// centre and fades. One reusable THREE.Points, retriggered on each pass.
const BURST_N = 90;
const burstGeo = new THREE.BufferGeometry();
const burstPos = new Float32Array(BURST_N * 3);
const burstVel = [];
for (let i = 0; i < BURST_N; i++) {
  const a = Math.random() * Math.PI * 2;
  const b = Math.acos(2 * Math.random() - 1);
  const sp = 18 + Math.random() * 30;
  burstVel.push(new THREE.Vector3(
    Math.sin(b) * Math.cos(a) * sp,
    Math.cos(b) * sp,
    Math.sin(b) * Math.sin(a) * sp,
  ));
}
burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
const burstMat = new THREE.PointsMaterial({ color: 0xffe066, size: 2.2, transparent: true, opacity: 0, depthWrite: false });
const burst = new THREE.Points(burstGeo, burstMat);
burst.visible = false;
burst.frustumCulled = false;
scene.add(burst);
let burstT = 99; // seconds since the burst started; 99 = idle
const burstCenter = new THREE.Vector3();
function fireBurst(center) {
  burstCenter.copy(center);
  for (let i = 0; i < BURST_N; i++) {
    burstPos[i * 3] = center.x;
    burstPos[i * 3 + 1] = center.y;
    burstPos[i * 3 + 2] = center.z;
  }
  burstGeo.attributes.position.needsUpdate = true;
  burstT = 0;
  burst.visible = true;
}

// Big "+100" popup on a ring pass (held on screen for the ring screenshot).
const ringPopEl = $('ring-pop');
let ringPopTimer = null;
function showRingPop(persist = false) {
  ringPopEl.classList.add('show');
  if (ringPopTimer) clearTimeout(ringPopTimer);
  if (!persist) ringPopTimer = setTimeout(() => ringPopEl.classList.remove('show'), 1400);
}

const STAGES = ['TAXI', 'TAKEOFF', 'RING 1', 'RING 2', 'RING 3', 'LAND'];
function stageIndex() {
  if (game.state !== 'flying') return game.state === 'over' ? 5 : 0;
  if (flight.onGround) return flight.speed > 5 ? 1 : 0;
  return 2 + game.nextRing;
}
function updateHUD() {
  $('money').textContent = '$' + econ.money.toLocaleString('en-US');
  $('xp').textContent = econ.xp.toLocaleString('en-US') + ' XP';
  const alt = Math.max(0, Math.round(flight.pos.y - RUNWAY_Y));
  $('alt').textContent = alt;
  $('spd').textContent = Math.round(flight.speed * 1.94384); // m/s -> kt
  $('hdg').textContent = Math.round(((flight.heading % 360) + 360) % 360);
  $('vs').textContent = flight.vs.toFixed(1);
  $('flaps-val').textContent = flight.flaps;
  $('spoilers-val').textContent = flight.spoilers;
  $('flaps-btn-val').textContent = flight.flaps + ' / 3';
  $('spoilers-btn-val').textContent = flight.spoilers + ' / 2';
  $('chip-flaps').classList.toggle('on', flight.flaps > 0);
  $('chip-spoilers').classList.toggle('on', flight.spoilers > 0);
  $('btn-engine').classList.toggle('on', flight.engineOn);
  $('btn-engine').textContent = flight.engineOn ? '■ Engine Off' : '▶ Engine';
  $('btn-reverse').classList.toggle('on', flight.reverse);
  $('btn-brake').classList.toggle('on', input.isDown('brake'));
  const si = stageIndex();
  $('progress-label').textContent = STAGES[si];
  $('progress-fill').style.width = (si / 5 * 100) + '%';
  // Status line.
  let status = '';
  if (game.state === 'flying') {
    if (!flight.engineOn) status = 'Engine off — press E or tap Engine';
    else if (flight.onGround && flight.speed < 5) status = 'Taxi to the runway — hold W, steer with A / D';
    else if (flight.onGround) status = 'Takeoff roll — pull up (↑) past 36 m/s';
    else if (game.nextRing < 3) status = 'Fly through the glowing rings';
    else status = 'All rings! Line up with runway 36 and land';
  }
  $('status').textContent = status;
  // Target line.
  let target = '';
  if (game.state === 'flying' && !flight.onGround) {
    if (game.nextRing < 3) {
      const r = RINGS[game.nextRing];
      const d = Math.round(Math.hypot(r.x - flight.pos.x, r.y - flight.pos.y, r.z - flight.pos.z));
      target = `◉ Ring ${game.nextRing + 1} / 3 — ${d} m`;
    } else {
      target = '▼ Land on runway 36 — gentle, slow, gear down';
    }
  }
  $('target').textContent = target;
  $('stall').style.display = flight.stalled && game.state === 'flying' ? 'block' : 'none';
}

// --- Minimap ---------------------------------------------------------------
const mapCanvas = $('minimap');
const mapCtx = mapCanvas.getContext('2d');
function drawMinimap() {
  const W = 150, H = 150;
  const S = W / 3600; // world -1800..1800 -> 0..150
  const X = (x) => (x + 1800) * S;
  const Z = (z) => (z + 1800) * S;
  mapCtx.fillStyle = '#b0703f';
  mapCtx.fillRect(0, 0, W, H);
  // Apron.
  mapCtx.fillStyle = '#8f8f8c';
  mapCtx.fillRect(X(-250), Z(90), 190 * S, 420 * S);
  // Runway.
  mapCtx.fillStyle = '#33363b';
  mapCtx.fillRect(X(-30), Z(-600), 60 * S, 1200 * S);
  mapCtx.fillStyle = '#f7c948';
  mapCtx.fillRect(X(-1), Z(-600), 2 * S, 1200 * S);
  // Taxiway.
  mapCtx.fillStyle = '#3a3d42';
  mapCtx.fillRect(X(72), Z(-500), 12 * S, 1100 * S);
  // Rings.
  RINGS.forEach((r, i) => {
    mapCtx.beginPath();
    mapCtx.arc(X(r.x), Z(r.z), 6, 0, Math.PI * 2);
    mapCtx.fillStyle = i < game.nextRing ? '#2aff66' : '#f7b733';
    mapCtx.fill();
  });
  // Plane triangle.
  const px = X(flight.pos.x), pz = Z(flight.pos.z);
  const hRad = degToRad(flight.heading);
  const dx = -Math.sin(hRad), dz = -Math.cos(hRad);
  mapCtx.save();
  mapCtx.translate(px, pz);
  mapCtx.rotate(Math.atan2(dx, -dz));
  mapCtx.fillStyle = '#fff';
  mapCtx.beginPath();
  mapCtx.moveTo(0, -6); mapCtx.lineTo(4, 5); mapCtx.lineTo(-4, 5); mapCtx.closePath();
  mapCtx.fill();
  mapCtx.restore();
}

// --- Panels ----------------------------------------------------------------
function hangarHtml() {
  const p = PAINTS[econ.paint];
  return `<div class="card">
    <h3>Senja Air B-1</h3>
    <p class="muted">Vintage biplane · Livery: <b>${p.name}</b></p>
    <div class="row"><span>Flights</span><b>${econ.stats.flights}</b></div>
    <div class="row"><span>Landings</span><b>${econ.stats.landings}</b></div>
    <div class="row"><span>Rings flown</span><b>${econ.stats.rings}</b></div>
    <div class="row"><span>Total earned</span><b>$${econ.stats.earned.toLocaleString('en-US')}</b></div>
    <div class="row"><span>Current job</span><b>${JOBS[econ.job].name}</b></div>
  </div>`;
}
function shopHtml() {
  return PAINTS.map((p, i) => {
    const owned = econ.owned.includes(i);
    const active = econ.paint === i;
    const btn = active
      ? '<button class="btn" disabled>In use</button>'
      : owned
        ? `<button class="btn" data-act="paint" data-i="${i}">Use</button>`
        : `<button class="btn accent" data-act="buy" data-i="${i}">Buy $${p.price}</button>`;
    return `<div class="card"><div class="row"><h3>${p.name}</h3><span class="price">${owned ? (active ? 'In use' : 'Owned') : '$' + p.price}</span></div>
      <p>A fresh livery tint for the B-1. ${active ? 'This is your current paint.' : ''}</p>${btn}</div>`;
  }).join('');
}
function jobsHtml() {
  return JOBS.map((j, i) => {
    const active = econ.job === i;
    return `<div class="card"><div class="row"><h3>${j.name}</h3><span class="price">$${j.pay}</span></div>
      <p>${j.desc} Perfect landing needs vs better than ${j.perfectVs} m/s.</p>
      ${active ? '<button class="btn" disabled>Selected</button>' : `<button class="btn accent" data-act="job" data-i="${i}">Take job</button>`}</div>`;
  }).join('') + '<p class="muted">Your job pays out on every landing, on top of the ring and landing bonuses.</p>';
}
function missionsHtml() {
  return MISSIONS.map((m) => {
    const done = econ.missions[m.id];
    return `<div class="card"><div class="row"><h3>${m.name}</h3><span class="price">+$${m.reward}</span></div>
      <p>${m.desc}</p>${done ? '<button class="btn" disabled>✓ Complete</button>' : '<button class="btn" disabled>In progress</button>'}</div>`;
  }).join('');
}
function settingsHtml() {
  return `<div class="card"><h3>Sound</h3><p>Engine, wind and alerts are synthesised in your browser.</p>
    <button class="btn" data-act="sound">${econ.muted ? 'Unmute sound' : 'Mute sound'}</button></div>
  <div class="card"><h3>Camera</h3><p>Chase view from behind-above — the whole biplane stays in frame.</p></div>
  <div class="card"><h3>Progress</h3><p>Money, XP, paints and jobs are saved on this device.</p>
    <button class="btn" data-act="reset">Reset all progress</button></div>`;
}
const PANELS = {
  Hangar: hangarHtml, Shop: shopHtml, Jobs: jobsHtml, Missions: missionsHtml, Settings: settingsHtml,
};
function openPanel(name) {
  $('panel-title').textContent = name;
  $('panel-body').innerHTML = PANELS[name]();
  $('panel').classList.add('open');
  game.panelOpen = true;
  audio.click();
}
function closePanel() {
  $('panel').classList.remove('open');
  game.panelOpen = false;
}
$('panel-close').addEventListener('click', closePanel);
$('panel').addEventListener('click', (e) => { if (e.target.id === 'panel') closePanel(); });
$('panel-body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const i = Number(btn.dataset.i);
  if (act === 'buy') {
    const p = PAINTS[i];
    if (econ.money < p.price) { toast('Not enough money — fly a job first!'); return; }
    econ.money -= p.price;
    econ.owned.push(i);
    econ.paint = i;
    if (planeModel) setPaint(planeModel, p);
    saveEcon(); updateHUD();
    audio.cash();
    openPanel('Shop');
    toast(p.name + ' paint applied!');
  } else if (act === 'paint') {
    econ.paint = i;
    if (planeModel) setPaint(planeModel, PAINTS[i]);
    saveEcon(); updateHUD();
    audio.click();
    openPanel('Shop');
  } else if (act === 'job') {
    econ.job = i;
    game.perfectVs = JOBS[i].perfectVs;
    saveEcon(); updateHUD();
    audio.click();
    openPanel('Jobs');
    toast('Job taken: ' + JOBS[i].name + ' — pays $' + JOBS[i].pay + ' per landing');
  } else if (act === 'sound') {
    econ.muted = !econ.muted;
    audio.setMuted(econ.muted);
    saveEcon();
    openPanel('Settings');
  } else if (act === 'reset') {
    if (!btn.dataset.confirm) {
      btn.dataset.confirm = '1';
      btn.textContent = 'Tap again to confirm reset';
      return;
    }
    ['money', 'xp', 'paint', 'owned', 'stats', 'missions', 'job', 'muted'].forEach((k) => { try { localStorage.removeItem('fw-' + k); } catch { /* noop */ } });
    window.location.reload();
  }
});

// --- Menu / control buttons -------------------------------------------------
$('btn-hangar').addEventListener('click', () => openPanel('Hangar'));
$('btn-shop').addEventListener('click', () => openPanel('Shop'));
$('btn-jobs').addEventListener('click', () => openPanel('Jobs'));
$('btn-missions').addEventListener('click', () => openPanel('Missions'));
$('btn-settings').addEventListener('click', () => openPanel('Settings'));
$('btn-flaps').addEventListener('click', () => cycleFlaps());
$('btn-spoilers').addEventListener('click', () => cycleSpoilers());
$('chip-flaps').addEventListener('click', () => cycleFlaps());
$('chip-spoilers').addEventListener('click', () => cycleSpoilers());
$('btn-exit').addEventListener('click', () => { showTitle(); });
$('btn-fly').addEventListener('click', () => { startFlight(); });
$('btn-again').addEventListener('click', () => { startFlight(); });
$('btn-end-hangar').addEventListener('click', () => { $('end').classList.remove('open'); openPanel('Hangar'); });

// Engine / reverse / brake: hold-to-run for brake, toggle for the others.
function toggleEngine() {
  flight.engineOn = !flight.engineOn;
  if (flight.engineOn) { audio.unlock(); audio.engineStart(); }
  updateHUD();
}
$('btn-engine').addEventListener('click', toggleEngine);
$('btn-reverse').addEventListener('click', () => { flight.reverse = !flight.reverse; updateHUD(); });
const brakeBtn = $('btn-brake');
brakeBtn.addEventListener('pointerdown', () => { brakeHeld = true; updateHUD(); });
brakeBtn.addEventListener('pointerup', () => { brakeHeld = false; updateHUD(); });
brakeBtn.addEventListener('pointerleave', () => { brakeHeld = false; updateHUD(); });
let brakeHeld = false;

function cycleFlaps() {
  flight.flaps = (flight.flaps + 1) % 4;
  audio.click();
  updateHUD();
}
function cycleSpoilers() {
  flight.spoilers = (flight.spoilers + 1) % 3;
  audio.click();
  updateHUD();
}
// --- Flow: title / flight / end --------------------------------------------
function showTitle() {
  game.state = 'title';
  document.body.classList.remove('flying');
  $('title').classList.add('open');
  $('end').classList.remove('open');
  closePanel();
  resetFlight(flight, { x: SPAWN.x, y: RUNWAY_Y + GEAR_H, z: SPAWN.z, heading: SPAWN.heading });
  game.nextRing = 0;
  game.ringsHit = 0;
  world.resetRings();
  guide.visible = true;
  updateHUD();
  drawMinimap();
}
function startFlight() {
  audio.unlock();
  game.state = 'flying';
  document.body.classList.add('flying');
  $('title').classList.remove('open');
  $('end').classList.remove('open');
  closePanel();
  resetFlight(flight, { x: SPAWN.x, y: RUNWAY_Y + GEAR_H, z: SPAWN.z, heading: SPAWN.heading });
  game.nextRing = 0;
  game.ringsHit = 0;
  game.perfectVs = JOBS[econ.job].perfectVs;
  world.resetRings();
  econ.stats.flights += 1;
  saveEcon();
  updateHUD();
  drawMinimap();
  toast('Engine on (E), hold W to taxi to runway 36');
}
function showEnd({ title, sub, lines, total, xp }) {
  game.state = 'over';
  document.body.classList.remove('flying');
  $('title').classList.remove('open'); // never show title + end together
  $('end-title').textContent = title;
  $('end-sub').textContent = sub;
  $('end-breakdown').innerHTML = lines.map((l) => `<div>${l}</div>`).join('')
    + `<div class="total">TOTAL +$${total.toLocaleString('en-US')} · +${xp} XP</div>`;
  $('end').classList.add('open');
  updateHUD();
}
function endFlightLanded() {
  const vs = flight.vs;
  const perfect = vs > game.perfectVs;
  const quality = clamp(1 - (-vs) / 4.5, 0, 1);
  const lines = [];
  let total = 0, xp = 0;
  const job = JOBS[econ.job];
  lines.push(`Job — ${job.name}: <b>+$${job.pay}</b>`);
  total += job.pay;
  const ringPay = game.ringsHit * 100;
  lines.push(`Rings ${game.ringsHit} / 3: <b>+$${ringPay}</b>`);
  total += ringPay;
  xp += game.ringsHit * 50;
  const landBonus = Math.round(quality * 200);
  lines.push(`Landing (vs ${vs.toFixed(1)} m/s): <b>+$${landBonus}</b>`);
  total += landBonus;
  xp += 100;
  if (perfect) {
    lines.push(`Perfect landing! <b>+$150</b>`);
    total += 150;
    xp += 50;
  }
  if (!econ.missions.smooth && vs > -3.0) {
    econ.missions.smooth = true;
    lines.push(`Mission — Smooth Landing: <b>+$500</b>`);
    total += 500;
    xp += 100;
  }
  if (!econ.missions.rings && game.ringsHit === 3) {
    econ.missions.rings = true;
    lines.push(`Mission — Ring Master: <b>+$300</b>`);
    total += 300;
    xp += 100;
  }
  econ.money += total;
  econ.xp += xp;
  econ.stats.landings += 1;
  econ.stats.rings += game.ringsHit;
  econ.stats.earned += total;
  saveEcon();
  audio.cash();
  if (perfect) audio.fanfare();
  showEnd({
    title: 'LANDED! ✓',
    sub: 'Senja Air B-1 · Runway 36 · vs ' + vs.toFixed(1) + ' m/s',
    lines, total, xp,
  });
}
function endFlightCrashed() {
  const xp = game.ringsHit * 20;
  econ.xp += xp;
  econ.stats.rings += game.ringsHit;
  saveEcon();
  audio.crash();
  showEnd({
    title: 'CRASHED ✕',
    sub: 'The B-1 is a write-off. No payout — but you keep the ring XP.',
    lines: [`Rings ${game.ringsHit} / 3: <b>+$0</b>`, 'Aircraft: <b>lost</b>'],
    total: 0, xp,
  });
}

// --- Camera ------------------------------------------------------------------
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const hRad = degToRad(flight.heading);
  const fwd = new THREE.Vector3(-Math.sin(hRad), 0, -Math.cos(hRad));
  if (game.state === 'title') {
    titleAngle += dt * 0.12;
    const cx = flight.pos.x + Math.sin(titleAngle) * 18;
    const cz = flight.pos.z + Math.cos(titleAngle) * 18;
    camPos.set(cx, 6, cz);
    camTarget.set(flight.pos.x, 1.5, flight.pos.z);
    camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
    camera.lookAt(camTarget);
    return;
  }
  // Chase: directly behind-above, the whole biplane + both wings in frame.
  const target = flight.pos.clone().addScaledVector(fwd, -13);
  target.y += 5.5;
  const look = flight.pos.clone().addScaledVector(fwd, 8);
  look.y += 0.5;
  if (camera.position.distanceTo(target) > 40) camera.position.copy(target);
  else camera.position.lerp(target, 1 - Math.pow(0.0005, dt));
  camera.lookAt(look);
}

// --- Shot API (for ?shot= states) -------------------------------------------
const shotApi = {
  setCam(mode) { game.camMode = 'chase'; }, // chase only — full plane always in frame
  flyAt(x, y, z, heading, speed, throttle, ringsPassed) {
    game.state = 'flying';
    document.body.classList.add('flying');
    $('title').classList.remove('open');
    $('end').classList.remove('open');
    resetFlight(flight, { x, y, z, heading, speed, throttle, onGround: false, engineOn: true });
    flight.spool = 1;
    game.nextRing = 0;
    game.ringsHit = 0;
    (ringsPassed || []).forEach((hit, i) => {
      if (hit) { game.ringsHit += 1; game.nextRing = i + 1; world.setRingPassed(i); }
    });
    updateHUD();
    drawMinimap();
  },
  showTitle() { showTitle(); },
  celebrateRing(i, persist) {
    world.setRingPassed(i);
    const r = RINGS[i];
    fireBurst(new THREE.Vector3(r.x, r.y, r.z));
    showRingPop(persist);
  },
  showEnd(title, sub, ringsHit, xp, total, money) {
    game.state = 'over';
    document.body.classList.remove('flying');
    $('title').classList.remove('open'); // never show title + end together
    game.ringsHit = ringsHit;
    $('end-title').textContent = title;
    $('end-sub').textContent = sub;
    $('end-breakdown').innerHTML = `<div>Job — ${JOBS[econ.job].name}: <b>+$${JOBS[econ.job].pay}</b></div>`
      + `<div>Rings ${ringsHit} / 3: <b>+$${ringsHit * 100}</b></div>`
      + `<div class="total">TOTAL +$${total.toLocaleString('en-US')} · +${xp} XP</div>`;
    $('end').classList.add('open');
    updateHUD();
  },
};

// --- Main loop ---------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.time += dt;

  // Edge-triggered keys.
  if (input.takePressed('engine') && game.state === 'flying') toggleEngine();
  if (input.takePressed('flaps') && game.state === 'flying') cycleFlaps();
  if (input.takePressed('spoilers') && game.state === 'flying') cycleSpoilers();
  if (input.takePressed('reverse') && game.state === 'flying') { flight.reverse = !flight.reverse; updateHUD(); }
  if (input.takePressed('gear') && game.state === 'flying') { flight.gearDown = !flight.gearDown; toast(flight.gearDown ? 'Gear down' : 'Gear up (fixed on the B-1 — stays down)'); flight.gearDown = true; updateHUD(); }
  if (input.takePressed('start') && game.state === 'title') startFlight();
  if (input.takePressed('close') && game.panelOpen) closePanel();

  if (game.state === 'flying' && !game.panelOpen) {
    const ctrl = input.read();
    const ev = stepFlight(flight, {
      pitch: ctrl.pitch,
      roll: ctrl.roll,
      steer: ctrl.steer,
      throttleUp: ctrl.throttleUp,
      throttleDown: ctrl.throttleDown,
      brake: ctrl.brake || brakeHeld,
    }, dt, RINGS, game.nextRing);
    if (ev === 'takeoff') {
      toast('Airborne! Climb and find ring 1');
      audio.ring();
    } else if (ev === 'ring') {
      const ringIdx = game.nextRing;
      const ringPos = new THREE.Vector3(RINGS[ringIdx].x, RINGS[ringIdx].y, RINGS[ringIdx].z);
      game.ringsHit += 1;
      world.setRingPassed(ringIdx);
      game.nextRing += 1;
      flash();
      fireBurst(ringPos);
      showRingPop();
      audio.ring();
      toast(game.nextRing < 3 ? `Ring ${game.ringsHit} / 3! +$100 on landing` : 'All 3 rings! Now land on runway 36');
      updateHUD();
    } else if (ev === 'landed') {
      audio.touchdown();
      endFlightLanded();
    } else if (ev === 'crash-land') {
      endFlightCrashed();
    }
    audio.update(flight.throttle, flight.spool, flight.speed, !flight.onGround, flight.stalled);
    // Guide arrow: next ring, or the runway threshold once the rings are done.
    const target = game.nextRing < 3
      ? new THREE.Vector3(RINGS[game.nextRing].x, RINGS[game.nextRing].y, RINGS[game.nextRing].z)
      : new THREE.Vector3(0, 8, -300);
    guide.position.copy(flight.pos).add(new THREE.Vector3(0, 5 + Math.sin(game.time * 2) * 0.4, 0));
    guide.lookAt(target);
    guide.visible = true;
  } else {
    guide.visible = game.state === 'title';
    if (game.state === 'title') {
      const target = new THREE.Vector3(RINGS[0].x, RINGS[0].y, RINGS[0].z);
      guide.position.copy(flight.pos).add(new THREE.Vector3(0, 5 + Math.sin(game.time * 2) * 0.4, 0));
      guide.lookAt(target);
    }
  }

  applyToModel(planeModel, flight, dt, game.time);
  // Ring-pass burst: expand the points out of the ring centre and fade.
  if (burstT < 1.6) {
    burstT += dt;
    const t = burstT;
    for (let i = 0; i < BURST_N; i++) {
      burstPos[i * 3] = burstCenter.x + burstVel[i].x * t;
      burstPos[i * 3 + 1] = burstCenter.y + burstVel[i].y * t;
      burstPos[i * 3 + 2] = burstCenter.z + burstVel[i].z * t;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burstMat.opacity = Math.max(0, 1 - t / 1.6);
    if (burstT >= 1.6) burst.visible = false;
  }
  // Pulse the next ring so it beckons from far away.
  if (game.state === 'flying' && game.nextRing < 3) {
    const g = world.ringMeshes[game.nextRing];
    if (g && !g.userData.passed) {
      g.userData.torus.material.emissiveIntensity = 1.2 + Math.sin(game.time * 4) * 0.5;
    }
  }
  updateCamera(dt);
  updateHUD();
  game.mapTimer += dt;
  if (game.mapTimer > 0.12) { game.mapTimer = 0; drawMinimap(); }
  if (game.msgTimer > 0) {
    game.msgTimer -= dt;
    if (game.msgTimer <= 0) msgEl.style.opacity = '0';
  }
  renderer.render(scene, camera);
  if (!window.__gameReady) window.__gameReady = true; // first frame rendered
}

// --- Boot: load the aircraft GLB first (the game must not start before
// the model is in the scene), then show the title / shot state. ------------
async function boot() {
  const loadingEl = $('loading');
  try {
    planeModel = await loadBiplane();
    scene.add(planeModel.group);
    setPaint(planeModel, PAINTS[econ.paint]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[biplane] load failed', err);
    loadingEl.textContent = 'Could not load the aircraft model. Please reload the page.';
    return;
  }
  loadingEl.style.display = 'none';
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (shot) {
    const st = applyShot(shotApi, shot);
    if (st === 'title') { /* title screen */ }
    else if (st) { /* flying / over set by the shot */ }
  } else {
    showTitle();
  }
  updateHUD();
  drawMinimap();
  // Test hook (staging only): lets the Playwright harness read the state.
  window.__game = { game, flight, econ, JOBS, PAINTS, planeModel };
  animate();
}
boot();
