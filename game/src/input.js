// Keyboard + virtual joystick input. Edge-triggered keys are consumed with
// takePressed(name) so a single press cycles flaps / spoilers / gear once.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const joy = { active: false, x: 0, y: 0 };

  const KEYMAP = {
    KeyW: 'throttleUp', ArrowUp: 'pitchUp',
    KeyS: 'throttleDown', ArrowDown: 'pitchDown',
    KeyA: 'rollLeft', ArrowLeft: 'rollLeft',
    KeyD: 'rollRight', ArrowRight: 'rollRight',
    Space: 'brake',
    KeyF: 'flaps', KeyG: 'spoilers', KeyR: 'reverse', KeyL: 'gear',
    KeyE: 'engine', Enter: 'start', Escape: 'close',
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    const name = KEYMAP[e.code];
    if (!name) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!keys.has(name)) pressed.add(name);
    keys.add(name);
  }
  function onKeyUp(e) {
    const name = KEYMAP[e.code];
    if (name) keys.delete(name);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Virtual joystick (#joystick): drag X = roll/steer, drag up = climb.
  const el = document.getElementById('joystick');
  const knob = document.getElementById('joy-knob');
  let pid = null;
  function setKnob() {
    if (knob) knob.style.transform = `translate(calc(-50% + ${joy.x * 38}px), calc(-50% + ${joy.y * 38}px))`;
  }
  function updateFromEvent(e) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    joy.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width / 2)));
    joy.y = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height / 2)));
    setKnob();
  }
  el.addEventListener('pointerdown', (e) => {
    pid = e.pointerId;
    el.setPointerCapture(pid);
    joy.active = true;
    updateFromEvent(e);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === pid) updateFromEvent(e); });
  function endJoy(e) {
    if (e.pointerId !== pid) return;
    joy.active = false; joy.x = 0; joy.y = 0;
    setKnob();
  }
  el.addEventListener('pointerup', endJoy);
  el.addEventListener('pointercancel', endJoy);

  return {
    isDown(name) { return keys.has(name); },
    takePressed(name) {
      if (pressed.has(name)) { pressed.delete(name); return true; }
      return false;
    },
    // Per-frame control vector: pitch + = pull up, roll + = bank right,
    // steer + = steer right on the ground.
    read() {
      let pitch = 0, roll = 0, steer = 0;
      if (keys.has('pitchUp')) pitch += 1;
      if (keys.has('pitchDown')) pitch -= 1;
      if (keys.has('rollLeft')) { roll -= 1; steer -= 1; }
      if (keys.has('rollRight')) { roll += 1; steer += 1; }
      if (joy.active) {
        pitch -= joy.y; // drag up = climb
        roll += joy.x;
        steer += joy.x;
      }
      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
        steer: Math.max(-1, Math.min(1, steer)),
        throttleUp: keys.has('throttleUp'),
        throttleDown: keys.has('throttleDown'),
        brake: keys.has('brake'),
      };
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
