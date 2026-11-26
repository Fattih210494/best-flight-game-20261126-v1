# best-flight-game-20261126-v1

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/Fattih210494/best-flight-game-20261126-v1/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/Fattih210494/best-flight-game-20261126-v1/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Flight World — Senja Runway. Start the engine of the Senja Air B-1 vintage biplane, taxi out of the desert airport, take off from runway 36, fly through 3 glowing waypoint rings over the desert and the mountains, then bring her home for a smooth landing and earn money and XP. Chase view from directly behind-above — the full biplane stays in frame during play — a real airport with a marked runway, taxiways, apron, terminal, hangar and ATC tower, and a rich Flight World HUD: flight progress bar, altitude, speed, heading, vertical speed, flaps, spoilers, engine, reverse thrust, brake, a live minimap and a mouse-draggable virtual joystick. Hangar, Shop (livery paints), Jobs (paid routes) and Missions all work, and your money and XP persist between sessions. Keyboard + mouse, WebAudio synth sounds only, static files, no network, no multiplayer. Built with Three.js (vendored) and a detailed biplane model (GLB, loaded by the entry's own small GLB loader, propeller spins in code).

## Run it

```sh
python3 -m http.server 8000 --directory game
# open http://localhost:8000/
```

## Controls

| Key | Action |
| --- | --- |
| W / S | Throttle up / down |
| ↑ / ↓ | Elevator (climb / descend) |
| A / D or ← / → | Steer on the ground, bank in the air |
| E | Engine on / off |
| F | Flaps 0–3 |
| G | Spoilers 0–2 |
| R | Reverse thrust |
| Space | Brake (hold) |
| Mouse | Drag the virtual joystick (bottom-left) |

Every on-screen button works: Hangar, Shop, Jobs, Missions, Settings, Engine, Reverse Thrust, Brake, Flaps, Spoilers, Exit. Money and XP are saved in localStorage.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kangbarii&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
