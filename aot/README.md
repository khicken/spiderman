# aot

A 3D Attack on Titan game in the browser. Defend Shiganshina with ODM gear and cut titan napes, in an anime toon style. Play it at [kalebkim.com/aot](https://kalebkim.com/aot).

Everything is procedural: three.js geometry, canvas textures, and Web Audio music. There are no asset files.

## Play

Quick start: Q locks on a titan, left click hooks it, hold E and release to strike the nape.

- Mouse: LMB and RMB fire the left and right anchors at the crosshair, else at the locked titan. Hold to reel and swing, let go at speed to slingshot.
- Trackpad or keyboard only: C and V fire the left and right anchors.
- Space adds gas speed while anchored. Gas cannot lift you without an anchor. Shift dashes.
- Q or the mouse wheel picks the part: nape, eyes, arms, legs. Hold Q to clear the lock. T fires a thunder spear. Blades swap by themselves when dull.
- Only a nape cut kills. Cut legs to make a titan kneel, eyes to blind it, arms to stop a grab. Dash as a hand reaches for you to dodge it. If caught, hold E and release when the blades glow.
- Phone or tablet: play in landscape. Use the left stick to move, drag to look, and the right buttons for anchors, gas, slash, and dash.
- Bosses: the Female Titan (wave 4), the Armored Titan (wave 7), the Beast Titan (wave 10), and the Jaw Titan (wave 13). Waves never end after wave 10, and a boss comes every third wave.
- The Jaw Titan crouches and roars before it lunges to bite. Dodge the bite or cut a tendon, then cut the nape while it is open.
- Every third wave after 10, starting at wave 12, is a horde of small fast titans.
- Each level up shows upgrade choices at the screen edge. Press 1, 2, or 3, or tap one, while you keep flying.
- A Survey Corps squad fights with you. F sends them at your target or the nearest titan. With no titan near, F switches them between attack and regroup.
- You have 3 lives. The third death ends the run.
- Pick Eren, Mikasa, Levi, Armin, or a cadet under Soldiers. Ranks unlock Mikasa and Levi.

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
| src/app/allies*.ts | Survey Corps squad AI |
| src/app/progression*.ts | Characters, ranks, run results |
| src/app/page.tsx, ui-*.tsx | Title screen, character select, HUD, touch controls |

Fan project. Not affiliated with Hajime Isayama, Kodansha, or Wit Studio.
