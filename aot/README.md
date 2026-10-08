# aot

A 3D Attack on Titan game in the browser. Defend Shiganshina with ODM gear and cut titan napes, in an anime toon style. Play it at [kalebkim.com/aot](https://kalebkim.com/aot).

Everything is procedural: three.js geometry, canvas textures, and Web Audio music. There are no asset files.

## Play

Quick start: Q locks on a titan, F hooks it, hold E and release to strike the nape.

- Mouse: LMB and RMB fire the left and right anchors. Hold to reel and swing, let go at speed to slingshot.
- Trackpad or keyboard only: F fires both anchors at the locked titan, or at the crosshair.
- Space adds gas speed while anchored. Gas cannot lift you without an anchor. Shift dashes.
- Tab or the mouse wheel picks the part: nape, eyes, arms, legs. R swaps blades.
- Only a nape cut kills. Cut legs to make a titan kneel, eyes to blind it, arms to stop a grab. Mash E or Space when grabbed.
- Phone or tablet: play in landscape. Use the left stick to move, drag to look, and the right buttons for anchors, gas, slash, and dash.
- Wave 4 brings the Female Titan. Her nape stays hardened until you cut two limbs.

## Run

```
cd aot
npm install
npm run dev
```

Open http://localhost:3000/aot. It works with a mouse, a trackpad, or a touch screen.

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
