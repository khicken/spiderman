# HOOPS: file ownership

Seven builders work in parallel. Each builder edits ONLY the files it owns. Read `contracts.ts` first: it is the spec.
Read `/AGENTS.md` (repo root) and follow it. Copy and adapt freely from `../../cars/src/app` (UI kit, render passes,
input, audio), but never import from another game.

## Frozen files (lead / integrator only)

| File | Purpose |
| --- | --- |
| `contracts.ts` | every shared type, module interface, court geometry, quality and difficulty tables |
| `state.ts` | canonical constructors: `newPlayerState`, `newBallState`, `newGameState`, `newIntent`, `newInputFrame`, `newStatLine`, `physicalOf`, `assignPlayer`, `hudPlayer`, `periodLabel` |
| `mock.ts` | `createMockSim(setup)`: a fake `Sim` (players jog, dribble, shoot) for lab pages and the menu background |
| `game.ts` | the one RAF loop; wires all factories; routes events |
| `layout.tsx` | fonts (Big Shoulders display, Inter Tight UI), metadata, canonical `/2k` |
| `data/types.ts`, `data/index.ts` | roster types and helpers (`ALL_TEAMS`, `teamByAbbr`, `starters`, `starterIndices`, `topPlayers`, `heightLabel`) |
| `data/teams-0..5.ts` | research agents |

Need a change in a frozen file? Do not edit it. Export extra things from your own file (`type SimPlus = Sim & {...}`)
and list the request in your final summary.

## Builders

Each entry file below exists now as a small STUB written by the lead so the app type-checks and runs.
Replace the stub completely. Keep the exported factory name and signature exactly as in `contracts.ts`.

| Builder | Owns | Entry export (contract type) | Lab page | Dev port |
| --- | --- | --- | --- | --- |
| arena | `arena.ts`, `arena-*.ts`, `render.ts`, `render-*.ts` | `createArena` (`CreateArena`), `createRender` + `detectQuality` (`CreateRender`) | `src/app/lab/arena/page.tsx` | 3041 |
| players | `players.ts`, `player-*.ts` (models, uniforms, animation, ball mesh) | `createPlayers` (`CreatePlayers`) | `src/app/lab/players/page.tsx` | 3042 |
| sim | `sim.ts`, `sim-*.ts` (rules, clocks, ball physics, movement, shots, fouls, stats, user control) | `createSim` (`CreateSim`) | `src/app/lab/sim/page.tsx` | 3043 |
| ai | `ai.ts`, `ai-*.ts` (offense sets, defense, rebounding, coach, subs, timeouts) | `createAI` (`CreateAI`) | `src/app/lab/ai/page.tsx` | 3044 |
| input-camera | `input.ts`, `input-*.ts`, `camera.ts`, `camera-*.ts` | `createInput` (`CreateInput`), `createCamera` (`CreateCamera`) | `src/app/lab/input/page.tsx` | 3045 |
| ui | `ui-*.tsx`, `page.tsx`, `icon.svg`, `globals.css` (append classes, keep existing tokens) | default `Page`; `ui-hud.tsx` implements `HudHandle` | `src/app/lab/ui/page.tsx` | 3046 |
| audio-fx | `audio.ts`, `audio-*.ts`, `fx.ts`, `fx-*.ts` | `createAudio` (`CreateAudio`), `createFx` (`CreateFx`) | `src/app/lab/audio/page.tsx` | 3047 |

Start your dev server with `npx next dev --turbopack -p <port>` from the `2k` folder. The app's basePath is `/2k`,
so your lab is at `http://localhost:<port>/2k/lab/<area>`. Stop your server when you finish.
Lab pages mount only your modules plus mocks (`createMockSim`, real rosters from `data`). Delete nothing that is not
yours. Lab pages are deleted by the integrator before the commit.

## Dependencies between builders (read-only, through contracts)

- sim reads `COURT`, `DIFFICULTY`, `ACTION_DUR` and the roster ratings. It never imports arena/players/camera.
- players and arena place geometry exactly at `COURT` positions; sim collides against the same numbers.
- The ball's position is always computed by sim (`BallState.pos`, also while dribbling or held). players poses the
  hands to meet it.
- ai only writes `sim.intents[slot]` for CPU slots and calls `sim.substitute` / `sim.callTimeout`.
- camera converts sticks to world directions (`stickToWorld`) and projects points for DOM overlays (`toScreen`).
- Every module reacts to `GameEvent`s in its own `handle()`. game.ts only forwards them.
- React renders the menu and the HUD. The HUD receives `HudSnapshot` at 10 Hz and per-frame calls on `HudHandle`.

## Rules for everyone

- Original game named HOOPS. No existing game names, league or team logos, copied HUD layouts, art or music.
  Real player names, team city + nickname as plain text, team colors and public stats are fine.
- No asset files. three.js geometry, canvas textures, Web Audio. Two exceptions: recorded voice clips in `public/voice/`
  (`audio-voice.ts`), and recorded sound effects and crowd audio in `public/sfx/`, loaded only through `audio-samples.ts`
  and credited in `public/sfx/CREDITS.md`. Do not replace recorded sounds with synthesis.
- No allocations in per-frame code. Dispose every GPU resource and listener.
- Run `npx tsc --noEmit` in the `2k` folder before you finish. Do not commit. Do not `npm install`.
