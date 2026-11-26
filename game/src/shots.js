// Screenshot states (?shot=action|start|play|end). Staging + kit dossier
// use these so the screenshots are reproducible. The API is the one main.js
// exposes: setCam, flyAt, showTitle, showEnd.
export function applyShot(api, name) {
  if (name === 'start') {
    api.setCam('chase');
    return 'title';
  }
  if (name === 'action') {
    // Chase view over the runway: the biplane large in frame, the airport
    // ahead, terminal and tower to the left, desert and mountains beyond.
    api.setCam('chase');
    api.flyAt(80, 70, 650, 350, 58, 0.7, [false, false, false]);
    return 'flying';
  }
  if (name === 'play') {
    // Cockpit view on the way to ring 2: the ring ahead, the desert below,
    // the minimap and the systems chips lit.
    api.setCam('cockpit');
    api.flyAt(200, 170, -1000, -50, 55, 0.65, [true, false, false]);
    return 'flying';
  }
  if (name === 'ring') {
    // Lit-ring proof shot (verification only, not in the 4 dossier shots):
    // the plane 50 m before ring 1, ring 1 already passed (bright green)
    // with the +100 popup held on screen and the burst firing.
    api.setCam('chase');
    api.flyAt(-400, 150, -850, 22, 55, 0.65, [true, false, false]);
    api.celebrateRing(0, true);
    return 'flying';
  }
  if (name === 'end') {
    api.setCam('chase');
    api.showEnd('LANDED! ✓', 'Senja Air B-1 · Runway 36 · vs -2.1 m/s', 3, 180, 150, 1480);
    return 'over';
  }
  return null;
}

export const SHOTS = [
  { name: '1-action.jpg', query: '?shot=action' },
  { name: '2-start.jpg', query: '?shot=start' },
  { name: '3-rings.jpg', query: '?shot=play' },
  { name: '4-end.jpg', query: '?shot=end' },
];
