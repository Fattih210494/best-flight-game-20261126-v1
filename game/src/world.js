// Flight World v1 — desert airport. Reddish-brown ground, blue sky, thin
// clouds, distant mountains. One long wide runway (white markings, yellow
// centreline), connected taxiways (yellow lines), apron, parking, terminal,
// hangar, ATC tower, runway lights. The playable area is flat; mountains
// rise beyond r ~ 2400.
import * as THREE from 'three';
import { mulberry32, fbm2, clamp, degToRad } from './noise.js';

export const SEED = 20261126;
export const RUNWAY_Y = 0;
export const RUNWAY = { x: 0, width: 60, length: 1200, zMin: -600, zMax: 600 };
export const TAXIWAY = { x: 78, width: 12, zMin: -500, zMax: 600 };
export const SPAWN = { x: 78, y: RUNWAY_Y, z: 300, heading: 180 }; // on the taxiway, facing south
export const RING_RADIUS = 24;
// h = the heading the plane approaches the ring from; the ring faces it.
export const RINGS = [
  { x: -400, y: 150, z: -900, h: 22 },
  { x: 500, y: 180, z: -1400, h: -61 },
  { x: 0, y: 120, z: 800, h: 167 },
];

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < 2400) return 0;
  const m = clamp((r - 2400) / 900, 0, 1);
  const ridge = fbm2(x * 0.0004, z * 0.0004, SEED) * 0.5 + 0.5;
  return m * m * (180 + ridge * 420);
}

export function isOverRunway(x, z) {
  return Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2 && z >= RUNWAY.zMin && z <= RUNWAY.zMax;
}
export function isOverTaxiway(x, z) {
  return Math.abs(x - TAXIWAY.x) <= TAXIWAY.width / 2 && z >= TAXIWAY.zMin && z <= TAXIWAY.zMax;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function runwayTexture() {
  return canvasTexture(256, 1024, (g, w, h) => {
    g.fillStyle = '#33363b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b2e33';
    for (let i = 0; i < 40; i++) g.fillRect(0, i * 26, w, 2);
    // Edge lines.
    g.fillStyle = '#f5f5f0';
    g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
    // Centreline dashes (yellow).
    g.fillStyle = '#f7c948';
    for (let y = 20; y < h; y += 64) g.fillRect(w / 2 - 4, y, 8, 34);
    // Threshold bars at both ends.
    g.fillStyle = '#f5f5f0';
    for (const y0 of [18, h - 58]) {
      for (let i = 0; i < 6; i++) g.fillRect(22 + i * 36, y0, 22, 40);
    }
    // Touchdown bars.
    for (const y0 of [150, h - 190]) {
      g.fillRect(48, y0, 30, 26); g.fillRect(w - 78, y0, 30, 26);
    }
    // Runway numbers "36" (south end) and "18" (north end).
    g.fillStyle = '#f5f5f0';
    g.font = 'bold 64px sans-serif';
    g.textAlign = 'center';
    g.save(); g.translate(w / 2, 110); g.fillText('36', 0, 0); g.restore();
    g.save(); g.translate(w / 2, h - 70); g.rotate(Math.PI); g.fillText('18', 0, 0); g.restore();
  });
}

function taxiwayTexture() {
  return canvasTexture(64, 512, (g, w, h) => {
    g.fillStyle = '#3a3d42'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f7c948';
    for (let y = 10; y < h; y += 48) g.fillRect(w / 2 - 2, y, 4, 26);
  });
}

export function buildWorld(scene) {
  const rng = mulberry32(SEED);
  const group = new THREE.Group();
  scene.add(group);

  // --- Ground: reddish-brown desert, huge disc.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6000, 64),
    new THREE.MeshStandardMaterial({ color: 0xa4643c, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // A lighter desert patch under the airport.
  const apronGround = new THREE.Mesh(
    new THREE.CircleGeometry(900, 48),
    new THREE.MeshStandardMaterial({ color: 0xb0703f, roughness: 1 }),
  );
  apronGround.rotation.x = -Math.PI / 2;
  apronGround.position.y = 0.01;
  apronGround.receiveShadow = true;
  group.add(apronGround);

  // --- Runway + taxiway + connectors.
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length),
    new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.9 }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(RUNWAY.x, 0.05, 0);
  runway.receiveShadow = true;
  group.add(runway);

  const taxiway = new THREE.Mesh(
    new THREE.PlaneGeometry(TAXIWAY.width, TAXIWAY.zMax - TAXIWAY.zMin),
    new THREE.MeshStandardMaterial({ map: taxiwayTexture(), roughness: 0.9 }),
  );
  taxiway.rotation.x = -Math.PI / 2;
  taxiway.position.set(TAXIWAY.x, 0.05, (TAXIWAY.zMin + TAXIWAY.zMax) / 2);
  taxiway.receiveShadow = true;
  group.add(taxiway);

  for (const cz of [-400, 100, 450]) {
    const conn = new THREE.Mesh(
      new THREE.PlaneGeometry(TAXIWAY.x - RUNWAY.x, 10),
      new THREE.MeshStandardMaterial({ map: taxiwayTexture(), roughness: 0.9 }),
    );
    conn.rotation.x = -Math.PI / 2;
    conn.position.set((RUNWAY.x + TAXIWAY.x) / 2, 0.05, cz);
    conn.receiveShadow = true;
    group.add(conn);
  }

  // --- Apron + parking stands.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 420),
    new THREE.MeshStandardMaterial({ color: 0x8f8f8c, roughness: 0.95 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-155, 0.04, 300);
  apron.receiveShadow = true;
  group.add(apron);
  const standMat = new THREE.MeshBasicMaterial({ color: 0xf7c948 });
  for (const sz of [150, 250, 350, 450]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(60, 1.2), standMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(-120, 0.08, sz);
    group.add(line);
  }

  // --- Runway edge lights (white) + threshold lights (green/red) + PAPI.
  const lightGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const edgeLights = new THREE.InstancedMesh(lightGeo, edgeMat, 84);
  {
    const m = new THREE.Matrix4();
    let i = 0;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 42; k++) {
        m.makeTranslation(sx * 31, 0.5, -600 + k * 29.3);
        edgeLights.setMatrixAt(i++, m);
      }
    }
    edgeLights.instanceMatrix.needsUpdate = true;
  }
  group.add(edgeLights);
  const thrMat = new THREE.MeshBasicMaterial({ color: 0x2aff66 });
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const l = new THREE.Mesh(lightGeo, thrMat);
      l.position.set(sx * (12 + k * 8), 0.5, -598);
      group.add(l);
    }
  }
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const l = new THREE.Mesh(lightGeo, redMat);
      l.position.set(sx * (12 + k * 8), 0.5, 598);
      group.add(l);
    }
  }
  // PAPI (4 lights beside the runway, south end).
  const papiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let k = 0; k < 4; k++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), papiMat);
    l.position.set(38 + k * 3, 0.6, -480);
    group.add(l);
  }

  // --- Terminal (glass front + orange sign band).
  const terminal = new THREE.Group();
  {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(70, 14, 26),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }),
    );
    body.position.y = 7;
    body.castShadow = true;
    terminal.add(body);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(70, 7, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x7fb8d8, roughness: 0.2, metalness: 0.4 }),
    );
    glass.position.set(0, 6, 13.2);
    terminal.add(glass);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(70, 2.2, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xe8641f, roughness: 0.6 }),
    );
    band.position.set(0, 12.5, 13.2);
    terminal.add(band);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(74, 1, 30),
      new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.9 }),
    );
    roof.position.y = 14.5;
    terminal.add(roof);
  }
  terminal.position.set(-290, 0, 300);
  group.add(terminal);

  // --- Hangar (box + half-cylinder arch roof).
  const hangar = new THREE.Group();
  {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(44, 12, 30),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.7, metalness: 0.3 }),
    );
    body.position.y = 6;
    body.castShadow = true;
    hangar.add(body);
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 15, 44, 24, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x7d838a, roughness: 0.6, metalness: 0.4 }),
    );
    arch.rotation.z = Math.PI / 2; // half-cylinder arch over the box (no rotation.y)
    arch.position.y = 12;
    arch.castShadow = true;
    hangar.add(arch);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(30, 9, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.7, metalness: 0.5 }),
    );
    door.position.set(0, 4.5, 15.2);
    hangar.add(door);
  }
  hangar.position.set(-210, 0, -120);
  group.add(hangar);

  // --- ATC tower (shaft + glass cab + antenna).
  const tower = new THREE.Group();
  {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 6, 34, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }),
    );
    shaft.position.y = 17;
    shaft.castShadow = true;
    tower.add(shaft);
    const cab = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 7, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x5a90b8, roughness: 0.2, metalness: 0.4 }),
    );
    cab.position.y = 37;
    cab.castShadow = true;
    tower.add(cab);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(8.5, 8.5, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.9 }),
    );
    cap.position.y = 40.5;
    tower.add(cap);
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
    );
    ant.position.y = 45;
    tower.add(ant);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    );
    beacon.position.y = 49;
    tower.add(beacon);
  }
  tower.position.set(-180, 0, 480);
  group.add(tower);

  // --- Windsock.
  {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xcccccc }),
    );
    pole.position.set(45, 5, 200);
    group.add(pole);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(1.1, 4.5, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }),
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(47.2, 9.5, 200);
    group.add(sock);
  }

  // --- Rocks (instanced, airport kept clear).
  {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a5a38, roughness: 1 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 220);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    let placed = 0;
    let guard = 0;
    while (placed < 220 && guard++ < 4000) {
      const a = rng() * Math.PI * 2;
      const r = 700 + rng() * 2200;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 350 && z > -700 && z < 700) continue; // keep the airport clear
      const sc = 1 + rng() * 4;
      e.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      q.setFromEuler(e);
      s.set(sc, sc * (0.6 + rng() * 0.6), sc);
      m.compose(new THREE.Vector3(x, sc * 0.4, z), q, s);
      rocks.setMatrixAt(placed++, m);
    }
    rocks.count = placed;
    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = true;
    group.add(rocks);
  }

  // --- Distant mountains (cones).
  {
    const mtnMat = new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 1 });
    const mtnMat2 = new THREE.MeshStandardMaterial({ color: 0x6a3e28, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
      const r = 3000 + rng() * 1000;
      const h = 250 + rng() * 350;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(300 + rng() * 350, h, 7), i % 2 ? mtnMat : mtnMat2);
      cone.position.set(Math.cos(a) * r, h / 2 - 10, Math.sin(a) * r);
      group.add(cone);
    }
  }

  // --- Clouds (soft sprites).
  const cloudTex = canvasTexture(128, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (const [cx, cy, r] of [[40, 40, 22], [64, 34, 26], [90, 42, 20], [56, 46, 24]]) {
      const grad = g.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
  });
  for (let i = 0; i < 22; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.75, depthWrite: false }));
    const a = rng() * Math.PI * 2;
    const r = 800 + rng() * 2200;
    sp.position.set(Math.cos(a) * r, 260 + rng() * 180, Math.sin(a) * r);
    sp.scale.set(220 + rng() * 260, 70 + rng() * 60, 1);
    group.add(sp);
  }

  // --- Sky dome (blue gradient) + sun disc + halo.
  {
    const skyGeo = new THREE.SphereGeometry(5200, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fb8) },
        bottom: { value: new THREE.Color(0xcfe4f2) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float t = clamp(vP.y / 5200.0 * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    group.add(sky);
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(120, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false }),
    );
    sun.position.set(-2600, 1500, -4200);
    sun.lookAt(0, 0, 0);
    group.add(sun);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0xfff2c8, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
    halo.position.copy(sun.position);
    halo.scale.set(900, 900, 1);
    group.add(halo);
  }

  // --- Lights + fog.
  const sunLight = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sunLight.position.set(-1200, 1800, -800);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -500; sunLight.shadow.camera.right = 500;
  sunLight.shadow.camera.top = 500; sunLight.shadow.camera.bottom = -500;
  sunLight.shadow.camera.far = 5000;
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0xbfd8ee, 0x8a5a38, 0.9));
  scene.fog = new THREE.Fog(0xcfd8e0, 2200, 5200);

  // --- Waypoint rings: big glowing gold torus + halo + glow sprite + inner
  // disc, facing the approach heading. They read from far away; when flown
  // through they flash bright green (setRingPassed) and stay lit.
  const ringGroup = new THREE.Group();
  const ringGlowTex = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,210,80,0.85)');
    grad.addColorStop(0.4, 'rgba(255,180,40,0.35)');
    grad.addColorStop(1, 'rgba(255,180,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const rings = RINGS.map((r) => {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS, 2.2, 14, 56),
      new THREE.MeshStandardMaterial({ color: 0xffc93e, emissive: 0xcc7a00, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 }),
    );
    g.add(torus);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS + 9, 1.2, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0xffc93e, transparent: true, opacity: 0.45 }),
    );
    g.add(halo);
    // Glow sprite at the centre so the ring reads from far away.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringGlowTex, transparent: true, opacity: 0.55, depthWrite: false }));
    glow.scale.set(90, 90, 1);
    g.add(glow);
    // Faint inner disc (a portal feel).
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(RING_RADIUS - 2, 40),
      new THREE.MeshBasicMaterial({ color: 0xffc93e, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }),
    );
    g.add(disc);
    g.position.set(r.x, r.y, r.z);
    g.rotation.y = degToRad(r.h);
    g.userData.passed = false;
    g.userData.baseY = r.y;
    g.userData.torus = torus;
    g.userData.halo = halo;
    g.userData.glow = glow;
    g.userData.disc = disc;
    ringGroup.add(g);
    return g;
  });
  group.add(ringGroup);

  // Repaint a ring gold (unflown) or bright green (flown through).
  function paintRing(g, passed) {
    const gold = 0xffc93e, green = 0x7dff9a;
    const torus = g.userData.torus, halo = g.userData.halo, glow = g.userData.glow, disc = g.userData.disc;
    if (passed) {
      torus.material.color.set(green);
      torus.material.emissive.set(0x1a8a3a);
      torus.material.emissiveIntensity = 2.0;
      halo.material.color.set(green);
      halo.material.opacity = 0.7;
      glow.material.color.set(0x7dff9a);
      glow.material.opacity = 0.8;
      glow.scale.set(120, 120, 1);
      disc.material.color.set(green);
      disc.material.opacity = 0.18;
    } else {
      torus.material.color.set(gold);
      torus.material.emissive.set(0xcc7a00);
      torus.material.emissiveIntensity = 1.2;
      halo.material.color.set(gold);
      halo.material.opacity = 0.45;
      glow.material.color.set(0xffffff);
      glow.material.opacity = 0.55;
      glow.scale.set(90, 90, 1);
      disc.material.color.set(gold);
      disc.material.opacity = 0.10;
    }
    g.userData.passed = passed;
  }

  return {
    ringMeshes: rings,
    setRingPassed(i) { if (rings[i]) paintRing(rings[i], true); },
    resetRings() { rings.forEach((g) => paintRing(g, false)); },
  };
}
