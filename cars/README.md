# cars

A racing game in the browser on six real roads, solo against AI or online with friends. Play it at [kalebkim.com/cars](https://kalebkim.com/cars).

Everything is procedural: three.js geometry, canvas and shader textures, and Web Audio engines and music. The maps come from OpenStreetMap roads and buildings plus AWS terrain tiles, baked into `src/app/maps/*.ts` by `npm run maps`.

## Play

- Keyboard: W or Up to accelerate, S or Down to brake and reverse, A and D to steer, Space for the handbrake.
- E and Q shift up and down when auto gears is off. C changes the camera, B looks back, hold R to rewind, Backspace resets the car, H is the horn, Esc pauses.
- Gamepad: RT and LT for gas and brake, left stick to steer, A handbrake, B and X shift, Y rewind, RB camera, LB look back, Start pause.
- Phone or tablet: play in landscape. Steer on the left, gas, brake and handbrake on the right.
- Online: press Online and send the invite link. Up to 8 players race in one room. The host picks the map and the AI count.
- Graphics: Low runs on phones. Ultra needs a strong desktop GPU.

Maps: Monaco, Nordschleife, Shuto C1 (Tokyo), San Francisco, Stelvio Pass, and Spa.

## Run

```
cd cars
npm install
npm run dev
```

Open http://localhost:3000/cars.

Online play uses WebRTC through public nostr signaling, with a public MQTT relay when a direct link fails. To add a TURN server, set `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USER` and `NEXT_PUBLIC_TURN_PASS`.

## Code

| Files | Contents |
| --- | --- |
| src/app/contracts.ts | Interfaces between all modules |
| src/app/game.ts, page.tsx | Game loop, event routing, screen flow |
| src/app/track*.ts | Track math, racing line, road, curbs, barriers, terrain |
| src/app/scenery*.ts | Buildings, trees, water, landmarks, crowds, street lights |
| src/app/cars.ts, vehicle*.ts | Car specs, tire model, drivetrain, assists, collisions |
| src/app/car-*.ts | Procedural car bodies, wheels, paint and lights |
| src/app/render*.ts, fx*.ts | Sky, shadows, weather, post effects, quality presets, particles, skid marks |
| src/app/audio*.ts | Engine synthesis, effects, ambience, music |
| src/app/net*.ts | Rooms, sync, interpolation, relay fallback |
| src/app/race*.ts, ai.ts | Laps, standings, ghost, AI drivers |
| src/app/ui-*.tsx | Menus, HUD, lobby, touch controls, settings |
| scripts/build-maps.mjs | Builds the map data from OpenStreetMap and terrain tiles |

Map data © OpenStreetMap contributors. Terrain from AWS Terrain Tiles (Mapzen). Fan project. No real car brands are used.
