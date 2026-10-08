# aot

A 3D Attack on Titan game in the browser. Defend Shiganshina with ODM gear and cut titan napes, in an anime toon style. Play it at [kalebkim.com/aot](https://kalebkim.com/aot).

Everything is procedural: three.js geometry, canvas textures, and Web Audio music. There are no asset files.

## Play

- Hold left or right click to fire the left or right anchor. Holding reels you in. Let go at speed to slingshot.
- Hold Space to boost with gas. Shift dashes. WASD steers swings and runs on walls.
- Q locks on to a titan. Tab or the mouse wheel picks the part: nape, eyes, arms, legs. F fires both anchors at it.
- Hold E to charge and let go to strike. Let go in the perfect window for a critical hit.
- Only a nape cut kills. Hit faster to cut deeper. Cut legs to make a titan kneel, cut eyes to blind it, cut arms to stop a grab.
- If a titan grabs you, mash E. R swaps blades. Green smoke marks supply depots.
- Wave 4 brings the Female Titan. Her nape stays hardened until you cut two limbs.

## Run

```
cd aot
npm install
npm run dev
```

Open http://localhost:3000/aot. A desktop browser with a keyboard and mouse is needed.

## Code

| Files | Contents |
| --- | --- |
| src/app/contracts.ts | Interfaces between all modules |
| src/app/game.ts | Game loop, intro cinematic, event routing, HUD state |
| src/app/render.ts, toon.ts | Toon shading, ink outlines, sky, speed lines, impact frames |
| src/app/world*.ts | Shiganshina district, wall, Colossal Titan, collision |
| src/app/titan*.ts | Titan bodies, animation, AI, waves, boss |
| src/app/player*.ts, scout.ts, camera.ts, input.ts | ODM gear, combat, scout model, camera, controls |
| src/app/fx.ts | Steam, blood, gas, dust, slash arcs |
| src/app/audio*.ts | Procedural battle music and sound effects |
| src/app/page.tsx, ui-*.tsx | Title screen and HUD |

Fan project. Not affiliated with Hajime Isayama, Kodansha, or Wit Studio.
