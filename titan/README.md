# titan

A 3D Attack on Titan game in the browser. Fly through a walled town with ODM gear and cut titan napes. Play it at [kalebkim.com/titan](https://kalebkim.com/titan).

Everything is procedural: three.js geometry, canvas textures, and Web Audio music. There are no asset files.

## Play

- Hold left or right click to fire the left or right hook. The hook reels you in.
- Hold Shift to boost with gas. Space jumps, or gives a gas burst in the air.
- E or F slashes. Q locks on to a nape. R swaps blades. M mutes. Esc pauses.
- Only a nape cut kills a titan. Hit faster to cut deeper.
- Cut a leg to make a titan kneel. Cut an arm to stop it from grabbing you.
- If a titan grabs you, mash E to cut free.
- Green flares mark supply depots. Stand near one to refill gas, blades, and health.

## Run

```
cd titan
npm install
npm run dev
```

Open http://localhost:3000/titan. A desktop browser with a keyboard and mouse is needed.

## Code

| File | Contents |
| --- | --- |
| src/app/game.ts | Game loop, event routing, HUD state |
| src/app/player.ts | ODM gear physics, hooks, gas, blades, slash |
| src/app/scout.ts | Player model and poses |
| src/app/titans.ts | Titan AI, waves, grabs, stomps, damage |
| src/app/titan-model.ts | Titan body and hit spheres |
| src/app/world.ts | Town, wall, forest, supply depots, raycast |
| src/app/render.ts | Renderer, sky, light, quality presets |
| src/app/fx.ts | Steam and gas particles |
| src/app/audio.ts | Music and sound effects |
| src/app/page.tsx, ui-*.tsx | Menu and HUD |

Fan project. Not affiliated with Hajime Isayama, Kodansha, or Wit Studio.
