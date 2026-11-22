# HOLLOWMERE: file ownership

Ten builders work in parallel. Each builder edits ONLY the files it owns. Read these first, in this order:

1. `/AGENTS.md` (repo root): the repo rules.
2. `zelda/DESIGN.md`: the game, its numbers and its art direction.
3. `contracts.ts`: the spec. Your factory must match its type exactly.

You can copy and adapt freely from `../../2k`, `../../aot`, `../../cars` and `../../spiderman` (render passes, input,
audio, UI kit). Never import from another game.

## Frozen files (integrator only)

| File | Purpose |
| --- | --- |
| `contracts.ts` | every shared type, module interface, world layout, tuning and quality tables |
| `state.ts` | constructors (`newPlayerState`, `newEnemyState`, `newQuest`, `newEnv`, `newInputState`), save/settings storage, `detectPlatform`, `objectiveText`, `bearing`, `angleDiff` |
| `mock.ts` | a stand-in for every module, with the REAL export names. Lab pages use it as `import * as mock from "../../mock"`. |
| `game.ts` | the one RAF loop. It creates every module, runs the quest reducer, saves, and routes events. Its top block holds the SWAP LINES. |
| `page.tsx` | mounts the UI. Its one line is the ui swap line. |
| `layout.tsx` | fonts (Cormorant Garamond as `--font-display`, Manrope as `--font-ui`), metadata, canonical `/zelda`, viewport |
| `ui-stub.tsx` | the placeholder menu and HUD. It stays as a reference after the swap. |
| `../DESIGN.md`, `../next.config.ts`, `../package.json` | design doc and config |

Need a change in a frozen file? Do not edit it. Export extra things from your own file (`type PlayerPlus = Player & {...}`)
and list the request in your final summary. Adding a dependency counts as a frozen-file change. Ask; do not run
`npm install`.

## Builders

Each builder creates its entry file and replaces the mock with it. Keep the export name and signature exactly as in
`contracts.ts`. When your module works in your lab, tell the integrator. The integrator then changes your swap line in
`game.ts`.

| Owner | Owns | Entry file → exports (contract type) | game.ts swap line | Lab page | Port |
| --- | --- | --- | --- | --- | --- |
| terrain | `world.ts`, `world-*.ts`, `terrain.ts`, `terrain-*.ts` (heightmap, biomes, collider hash, raycast, chunk meshes and LOD, sea/lake/river water shader) | `terrain.ts` → `createWorld` (`CreateWorld`, may live in world.ts and be re-exported), `createTerrain` (`CreateTerrain`) | `import { createWorld, createTerrain } from "./terrain";` | `src/app/lab/terrain/page.tsx` | 3301 |
| nature | `nature.ts`, `nature-*.ts` (grass, flowers, bushes, trees and impostors, rocks, driftwood, fireflies, birds) | `nature.ts` → `createNature` (`CreateNature`) | `import { createNature } from "./nature";` | `src/app/lab/nature/page.tsx` | 3302 |
| landmarks | `landmarks.ts`, `landmark-*.ts` (shrine, ruin, beacons, the 4 trials, spire and barrier, boss arena, collectibles, chests, lore stones, prompts, checkpoints) | `landmarks.ts` → `createLandmarks` (`CreateLandmarks`) | `import { createLandmarks } from "./landmarks";` | `src/app/lab/landmarks/page.tsx` | 3303 |
| player | `player.ts`, `player-*.ts` (movement state machine, collisions, climb/glide/swim, stamina, sword/shield/bow inputs, Wren's model, cloak, lantern, animation) | `player.ts` → `createPlayer` (`CreatePlayer`) | `import { createPlayer } from "./player";` | `src/app/lab/player/page.tsx` | 3304 |
| combat | `combat.ts`, `combat-*.ts` (strike resolution, block/parry, projectiles and their meshes, props, knockback, hitstop and shake events) | `combat.ts` → `createCombat` (`CreateCombat`) | `import { createCombat } from "./combat";` | `src/app/lab/combat/page.tsx` | 3305 |
| enemies | `enemies.ts`, `enemy-*.ts` (pool, camps, brains, attack tokens, the 3 enemy models, the Gloam Warden and its phases) | `enemies.ts` → `createEnemies` (`CreateEnemies`) | `import { createEnemies } from "./enemies";` | `src/app/lab/enemies/page.tsx` | 3306 |
| input-camera | `input.ts`, `input-*.ts` (keys, mouse and pointer lock, gamepad, touch overlay DOM), `camera.ts`, `camera-*.ts` (orbit, collision, lock-on, aim, shake, cinematics) | `input.ts` → `createInput` (`CreateInput`); `camera.ts` → `createCamera` (`CreateCamera`) | `import { createInput } from "./input";` and `import { createCamera } from "./camera";` | `src/app/lab/input-camera/page.tsx` | 3307 |
| render | `render.ts`, `render-*.ts` (renderer, Look/toon materials, sky, sun/moon, day/night, weather and rain, particle pool, ink outline post, bloom, dynamic resolution, quality detection) | `render.ts` → `createRender` (`CreateRender`), `detectQuality` (`DetectQuality`) | `import { createRender, detectQuality } from "./render";` | `src/app/lab/render/page.tsx` | 3308 |
| audio | `audio.ts`, `audio-*.ts` (adaptive score, ambience, SFX, UI cues, all synthesis) | `audio.ts` → `createAudio` (`CreateAudio`) | `import { createAudio } from "./audio";` | `src/app/lab/audio/page.tsx` | 3309 |
| ui | `ui-*.tsx` and `ui-*.ts` (except `ui-stub.tsx`), `globals.css` (design tokens: append, never rename or remove), `icon.svg` | `ui-app.tsx` → `App` (React component, takes no props) | in `page.tsx`: `import { App } from "./ui-app";` | `src/app/lab/ui/page.tsx` | 3310 |

**Start your dev server** from the `zelda` folder:

```
NEXT_DIST_DIR=.next-<port> npx next dev --turbopack -p <port>
```

Your lab is at `http://localhost:<port>/zelda/lab/<owner>`. Next rewrites `tsconfig.json` when it starts. Restore the
file when you stop your server: `git checkout -- zelda/tsconfig.json`. Stop your server when you finish.

## How the modules talk (read-only, through contracts)

- **World is the source of truth for the ground.** Everyone uses `heightAt`, `groundAt`, `raycast` and `near`.
  - Terrain flattens every `LANDMARKS` site inside its `flat` radius, and builds `MOUNTAIN`, `CLIFFS`, `LAKE`,
    `RIVER` and `FOREST` exactly at the contract numbers.
  - Landmarks and nature place things with `world.heightAt` after `createWorld`.
- **Colliders:** landmarks and nature add boxes with `world.addBox` and an `owner` prefix (`"landmarks:..."`,
  `"nature:..."`).
  - Push blocks are `pushable` boxes. The player sets `pushBox`/`pushDir`; landmarks moves the box with `moveBox`.
  - The spire barrier is a `barrier` box that landmarks removes on `barrierDown`.
  - `world.near()` returns ONE shared Set. Do not nest calls to it.
- **Look:** every mesh uses `look.toon(...)` or `look.patch(material)`. Custom ShaderMaterials (terrain, grass,
  water, impostors) paste `look.glsl` and spread `look.uniforms` into their uniforms.
  - Every custom ShaderMaterial needs the `tonemapping_fragment` and `colorspace_fragment` includes.
  - The mock Look is plain Lambert. Your module must still look right once the real render lands. Test against both.
- **Combat flow:**
  1. Player and enemies call `ctx.combat.strike()` / `ctx.combat.shoot()` during their update.
  2. Combat resolves the strikes and shots in its update, in the same frame, and emits `hit`, `arrowHit` and
     `propHit`.
  3. The player applies `hit` with team `enemy` and target −1. Enemies apply `hit` with team `player`.
  4. Combat never edits hp.
  5. Parry rule: a hit on the player is a parry when `player.shieldUp && player.parryT < SWORD.parryWindow` and the
     hit comes from the front `SWORD.blockArc`. Combat sets `parried: true`, and enemies apply the stun.
- **Lock-on:** the camera owns target choice (`CameraRig.lockId`). game.ts copies it to `PlayerState.lockId` before
  the player updates.
- **Environment:** render owns `EnvState` (clock, weather, wind) and writes the shared uniforms. Everyone reads
  `ctx.env`.
- **Particles:** use `ctx.fx.burst(...)` directly for local effects (dust on land, sparks on parry). Otherwise react to
  events in `render.handle`.
- **Quest:** only game.ts changes `QuestState`, in `reduce()`.
  - Landmarks emits `trialStart`, `trialProgress`, `trialDone`, `trialFail`, `beaconLit`, `barrierDown` and
    `bossWake`.
  - Enemies emits `bossDefeated`.
  - game.ts emits `ending` 5 s later.
- **Spawning for trials and the boss:** landmarks emits `spawn` and `despawnGroup` requests. Enemies spawns the Warden
  on `bossWake`.
- **Touch overlay:** input builds it as plain DOM inside the `overlay` element that the UI passes to `startGame`.
  - The overlay is `pointer-events: none`. Set `pointer-events: auto` on your own controls.
  - Style the controls with inline styles that read the globals.css tokens (`var(--color-parchment)` and so on).
  - The UI never draws touch buttons.
- **HUD:** React gets a `HudSnapshot` at 10 Hz through `cb.hud`.
  - Per-frame data (stamina ring position, compass heading, lock reticle) comes through `HudHandle.frame`. Write it to
    DOM refs, never to React state.
  - The UI calls `game.unlockAudio()` on the first click or tap.

## Rules for everyone

- **Original IP: HOLLOWMERE.** Do not use names, places, items, logos, sounds, music motifs or HUD layouts from any
  existing game.
- **No asset files.** Use three.js geometry, canvas textures and Web Audio synthesis.
- **No allocations in per-frame code.** Dispose every GPU resource and every listener in `dispose()`. React Strict
  Mode mounts the page twice in development.
- **Do not commit.** The integrator deletes the lab pages before the commit.
- **Do not edit another owner's files.**
- **Before you finish,** run `npx tsc --noEmit` in the `zelda` folder. Then drive your lab with playwright-core
  (Chromium flags `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`), and look at your screenshots.
