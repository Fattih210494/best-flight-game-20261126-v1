// Flight World v1 aircraft: the user's vintage BIPLANE (GLB supplied by
// him, desert-camo, two stacked wings, radial propeller engine, fixed gear,
// open cockpits). Loaded with the entry's own minimal GLB loader
// (game/src/glb-loader.js, written for this model); the propeller blades are
// found geometrically (no prop/blade node names exist in the file), pivoted
// at their union-bbox centre, and spun in code. The model is scaled from
// its measured bounding box (longest side -> 9 units) and centred so the
// wheels sit at -GEAR_H. Forward in model space is +X; the model is turned
// rotation.y = +PI/2 so the nose faces the game's -Z forward.
// Plus the arcade flight model: taxi -> takeoff -> 3 rings -> land on
// runway 36, with engine on/off, flaps 0-3, spoilers 0-2, reverse thrust
// and ground steering. (Flaps / spoilers / gear stay flight-model values in
// the UI; the fixed-gear biplane does not animate them.)
import * as THREE from 'three';
import { loadGLB } from './glb-loader.js';
import { clamp, degToRad } from './noise.js';
import { heightAt, isOverRunway, RUNWAY, RUNWAY_Y, RINGS, RING_RADIUS, SPAWN } from './world.js';

export const MAX_SPEED = 92;    // m/s (~179 kt)
export const CRUISE_SPEED = 58;
export const STALL_SPEED = 26;
export const TAKEOFF_SPEED = 36;
export const GEAR_H = 1.5;      // model centre above ground on its fixed gear
const TARGET_LONGEST = 9;       // scale the model so its longest side is 9 units

// Find the propeller blades: thin, long meshes at the nose, near the radial
// engine's axis. The file has no prop/blade node names, so this is geometric.
// Note: node names arrive exactly as written in the file ('Radial Engine 9').
// The regex below accepts a space or an underscore, so it also matches the
// underscored form other loaders produce.
function findPropBlades(gltfScene) {
  let engineObj = null;
  gltfScene.traverse((o) => { if (/^Radial[ _]Engine[ _]9$/.test(o.name)) engineObj = o; });
  if (!engineObj) return { blades: [], engineObj: null, engineCenter: null };
  const engineBox = new THREE.Box3().setFromObject(engineObj);
  const engineCenter = engineBox.getCenter(new THREE.Vector3());
  const blades = [];
  const tmpBox = new THREE.Box3();
  gltfScene.traverse((o) => {
    if (!o.isMesh) return;
    tmpBox.setFromObject(o);
    const size = tmpBox.getSize(new THREE.Vector3());
    const center = tmpBox.getCenter(new THREE.Vector3());
    const thinX = size.x < 16;
    const longBlade = size.y > 40;
    const atNose = tmpBox.max.x > engineCenter.x + 5;
    const nearAxis = Math.abs(center.y - engineCenter.y) < 70
      && Math.abs(center.z - engineCenter.z) < 70;
    if (thinX && longBlade && atNose && nearAxis) blades.push(o);
  });
  return { blades, engineObj, engineCenter };
}

export async function loadBiplane() {
  const gltf = await loadGLB('models/airplane.glb');
  const scene = gltf.scene;

  // --- Propeller: pivot the blades at their union-bbox centre and spin
  // the pivot around the model X axis (the forward axis).
  scene.updateMatrixWorld(true);
  const { blades, engineObj, engineCenter } = findPropBlades(scene);
  let propPivot = null;
  if (blades.length > 0) {
    const union = new THREE.Box3();
    blades.forEach((b) => union.expandByObject(b));
    const center = union.getCenter(new THREE.Vector3());
    propPivot = new THREE.Group();
    propPivot.position.copy(center);
    scene.add(propPivot);
    scene.updateMatrixWorld(true);
    blades.forEach((b) => propPivot.attach(b));
    // eslint-disable-next-line no-console
    console.log('[biplane] prop blades found:', blades.length, 'pivot at', center.toArray().map((v) => v.toFixed(1)));
  } else if (engineObj) {
    // Fallback: spin the whole front engine group around its centre.
    propPivot = new THREE.Group();
    propPivot.position.copy(engineCenter);
    scene.add(propPivot);
    scene.updateMatrixWorld(true);
    propPivot.attach(engineObj);
    // eslint-disable-next-line no-console
    console.log('[biplane] no blades found — spinning the engine group as fallback');
  } else {
    // eslint-disable-next-line no-console
    console.log('[biplane] WARNING: no Radial Engine 9 node found, prop will not spin');
  }

  // --- Scale from the measured bounding box, face -Z, centre on the origin
  // with the wheels at -GEAR_H.
  const group = new THREE.Group();
  const meshGroup = new THREE.Group();
  meshGroup.rotation.y = Math.PI / 2; // model +X (nose) -> game -Z (forward)
  meshGroup.add(scene);
  group.add(meshGroup);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(meshGroup);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const scale = TARGET_LONGEST / longest;
  meshGroup.scale.setScalar(scale);
  group.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(meshGroup);
  const center2 = box2.getCenter(new THREE.Vector3());
  meshGroup.position.set(-center2.x, -box2.min.y - GEAR_H, -center2.z);
  // eslint-disable-next-line no-console
  console.log('[biplane] bbox size', size.toArray().map((v) => v.toFixed(1)), 'scale', scale.toFixed(5));

  scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group, propPivot, materials: collectMaterials(scene) };
}

function collectMaterials(scene) {
  const mats = new Set();
  scene.traverse((o) => {
    if (o.isMesh && o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    }
  });
  return [...mats];
}

// Repaint: tint the model's materials (the shop paints). The default paint
// is white (no tint) — the original desert camo stays as supplied.
export function setPaint(model, paint) {
  const tint = paint.tint ?? 0xffffff;
  for (const m of model.materials) {
    if (m.color) m.color.set(tint);
  }
}

// --- Flight model ---------------------------------------------------------
export function createFlight() {
  return {
    pos: new THREE.Vector3(SPAWN.x, RUNWAY_Y + GEAR_H, SPAWN.z),
    heading: SPAWN.heading, // degrees: 0 = -Z (north), 180 = +Z (south)
    pitch: 0,               // degrees, + = nose up
    roll: 0,                // degrees, + = bank right
    speed: 0,               // m/s
    throttle: 0,
    vs: 0,                  // vertical speed m/s
    onGround: true,
    engineOn: false,
    spool: 0,               // engine spool 0..1 (takes ~2.5 s to spool up)
    gearDown: true,
    gearAnim: 1,            // fixed gear on the biplane — stays 1
    flaps: 0,               // 0..3, cycled with F
    spoilers: 0,            // 0..2, cycled with G
    reverse: false,         // reverse thrust (ground only), toggled with R
    stalled: false,
    ctrlPitch: 0, ctrlRoll: 0, ctrlSteer: 0, // last control inputs
  };
}

export function resetFlight(f, spot) {
  f.pos.set(spot.x, spot.y, spot.z);
  f.heading = spot.heading;
  f.pitch = 0; f.roll = 0;
  f.speed = spot.speed ?? 0;
  f.throttle = spot.throttle ?? 0;
  f.vs = 0;
  f.onGround = spot.onGround ?? true;
  f.engineOn = spot.engineOn ?? false;
  f.spool = 0;
  f.gearDown = true; f.gearAnim = 1;
  f.flaps = 0; f.spoilers = 0; f.reverse = false;
  f.stalled = false;
  f.ctrlPitch = 0; f.ctrlRoll = 0; f.ctrlSteer = 0;
}

// input: { pitch: -1..1 (pull up positive), roll: -1..1 (right positive),
//          steer: -1..1 (ground steering, right positive),
//          throttleUp, throttleDown, brake (hold) } — dt in seconds.
// State that lives on f: engineOn, gearDown, flaps, spoilers, reverse.
// Returns an event string: 'takeoff' | 'ring' | 'crash-land' | 'landed' | null.
export function stepFlight(f, input, dt, rings, nextRing) {
  f.ctrlPitch = input.pitch ?? 0;
  f.ctrlRoll = input.roll ?? 0;
  f.ctrlSteer = input.steer ?? 0;

  // Engine spool: ~2.5 s to full power, ~2.5 s to wind down.
  f.spool = clamp(f.spool + (f.engineOn ? 0.45 : -0.45) * dt, 0, 1);

  // Throttle (only matters once the engine is spooled).
  if (input.throttleUp) f.throttle = clamp(f.throttle + dt * 0.55, 0, 1);
  if (input.throttleDown) f.throttle = clamp(f.throttle - dt * 0.55, 0, 1);

  const thrust = f.throttle * f.spool;
  const targetSpeed = thrust * MAX_SPEED;
  const accel = f.onGround ? 14 : 9;
  // Drag: flaps + spoilers bite hardest when fast or on the ground.
  const drag = 10 + f.flaps * 8 + f.spoilers * 14;
  if (f.speed < targetSpeed) f.speed = Math.min(targetSpeed, f.speed + accel * dt);
  else f.speed = Math.max(targetSpeed, f.speed - drag * dt);
  // Brake (hold) and reverse thrust (ground only) kill speed fast.
  if (input.brake) f.speed = Math.max(0, f.speed - 12 * dt);
  if (f.reverse && f.onGround) f.speed = Math.max(0, f.speed - 10 * dt);

  // Pitch / roll toward the input, with limits.
  const pitchRate = f.onGround ? 0 : 34;
  f.pitch = clamp(f.pitch + input.pitch * pitchRate * dt, -24, 26);
  f.pitch = clamp(f.pitch - Math.sign(f.pitch) * 5 * dt, -24, 26); // gentle auto-centre
  f.roll = clamp(f.roll + input.roll * 70 * dt, -70, 70);
  f.roll = clamp(f.roll - Math.sign(f.roll) * 16 * dt, -70, 70);

  // Bank turns the heading; pitch changes climb. Arcade-friendly turn
  // authority: min turn radius ~125 m at full bank.
  const turnRate = -f.roll * 0.6 * (f.speed / MAX_SPEED);
  f.heading = (f.heading + turnRate * dt + 360) % 360;

  // Ground steering (nose wheel): A/D or joystick X while rolling.
  // Positive steer = right turn = heading decreases (same sense as the air
  // turn: banking right decreases the heading).
  if (f.onGround) {
    f.heading = (f.heading - f.ctrlSteer * clamp(f.speed / 6, 0, 1) * 28 * dt + 360) % 360;
  }

  const hRad = degToRad(f.heading);
  const forward = new THREE.Vector3(-Math.sin(hRad), 0, -Math.cos(hRad));
  // Climb: pitch converts speed into vertical speed; below stall speed the
  // wing gives up and the plane sinks. Flaps lower the stall speed.
  const stall = STALL_SPEED - f.flaps * 2;
  f.stalled = !f.onGround && f.speed < stall;
  const stallFactor = clamp((f.speed - stall) / 18, 0, 1);
  let climb = Math.sin(degToRad(f.pitch)) * f.speed * stallFactor;
  if (f.speed < stall && !f.onGround) climb -= (stall - f.speed) * 0.55;
  if (f.flaps > 0 && !f.onGround) climb += f.flaps * 0.5; // flaps add lift low down
  if (f.spoilers > 0 && !f.onGround) climb -= f.spoilers * 1.5; // spoilers kill lift
  f.vs = climb;

  f.pos.addScaledVector(forward, f.speed * dt * Math.cos(degToRad(f.pitch)));
  f.pos.y += f.vs * dt;

  const ground = heightAt(f.pos.x, f.pos.z);

  // Takeoff roll / ground handling.
  if (f.onGround) {
    f.pos.y = ground + GEAR_H;
    f.pitch = 0;
    if (f.speed > TAKEOFF_SPEED && f.pitch >= 0 && input.pitch > 0.15) {
      f.onGround = false;
      f.pitch = 8;
      return 'takeoff';
    }
    if (f.pos.y <= 0.5) f.pos.y = 0.5;
  }

  // Ring pass: within the torus disc.
  if (nextRing >= 0 && nextRing < rings.length) {
    const r = rings[nextRing];
    const dx = f.pos.x - r.x, dy = f.pos.y - r.y, dz = f.pos.z - r.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < RING_RADIUS) return 'ring';
  }

  // Terrain collision / touchdown.
  if (!f.onGround) {
    if (f.pos.y <= ground + GEAR_H - 0.2) {
      if (isOverRunway(f.pos.x, f.pos.z) && f.pos.y <= RUNWAY_Y + GEAR_H + 0.2) {
        // Touchdown on the runway: judge it — gentle, slow, gear down.
        if (f.vs > -4.5 && f.speed < 55 && f.gearAnim > 0.9) {
          f.onGround = true;
          f.pos.y = RUNWAY_Y + GEAR_H;
          return 'landed';
        }
        return 'crash-land';
      }
      return 'crash-land';
    }
    if (f.pos.y < 1.2) return 'crash-land';
  }
  return null;
}

export function applyToModel(model, f, dt, time) {
  const g = model.group;
  g.position.copy(f.pos);
  g.rotation.order = 'YXZ';
  g.rotation.y = degToRad(f.heading);
  g.rotation.x = degToRad(-f.pitch);
  g.rotation.z = degToRad(-f.roll);
  // Propeller spins faster with throttle and spool.
  if (model.propPivot) {
    model.propPivot.rotation.x += dt * (4 + f.throttle * f.spool * 55);
  }
}
