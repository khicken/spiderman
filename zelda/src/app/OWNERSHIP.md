# HOLLOWMERE v2: file ownership

Fourteen tracks build v2 in parallel. Each track edits ONLY the files it owns. The full brief for each track (goal,
interfaces, acceptance checks, browser slot) is in `zelda/v2/TRACKS.md`. Read these first, in this order:

1. `/AGENTS.md` (repo root): code, perf and test rules.
2. `/GAME-DESIGN.md` (repo root): design and feel rules.
3. `zelda/v2/DESIGN-V2.md`: the v2 game, its numbers and every player string.
4. `zelda/v2/copy-rule.md`: how player text must read.
5. `contracts.ts`: the spec. Implement the `XV2` interfaces exactly. Fields marked "v2 optional until merge" are
   written by the owning track and made required by the integrator.

Never import from another game in this repo. Copying and adapting is fine.

## Integrator only

| File | Purpose |
| --- | --- |
| `contracts.ts` | every shared type, module interface, layout, tuning and quality table |
| `game.ts` | the one rAF loop; creates modules, runs the quest reducer, routes events, saves |
| `page.tsx`, `layout.tsx`, `icon.svg` | app shell |
| `OWNERSHIP.md` | this file |
| `next.config.ts`, `package.json`, lockfile, `tsconfig.json` | config |
| `zelda/v2/*.md` | design docs |

Need a change in one of these? Put the request at the top of your hand-in report.

## Tracks

| Track | Owns (in `src/app/` unless a path is given; "new" = create it) | Browser |
| --- | --- | --- |
| T1 Perf, AA, outline | `render.ts`, `render-post.ts`, `render-timing.ts` (new), `nature-grass.ts`, `scripts/perf/perf-run.mjs` (new), `scripts/perf/budget.json` (new) | slot A, 1st |
| T2 Look and lighting | `render-look.ts`, `render-env.ts`, `render-blob.ts`, `terrain.ts`, `terrain-shader.ts`, `terrain-textures.ts`, `nature.ts`, `nature-util.ts`, `nature-trees.ts`, `nature-props.ts` | slot B, 1st |
| T3 Sky, water, fx | `render-sky.ts`, `render-rain.ts`, `render-fx.ts`, `terrain-water.ts`, `nature-life.ts`, `render-clouds.ts` (new), `render-shafts.ts` (new) | slot A, 2nd |
| T4 World and landmarks | `world.ts`, `world-gen.ts`, `world-noise.ts`, `landmarks.ts`, `landmark-kit.ts`, `landmark-items.ts`, `landmark-beacon.ts`, `landmark-secrets.ts`, `landmark-village.ts`, `landmark-spire.ts`, `landmark-trail.ts` (new), `landmark-waystone.ts` (new), `landmark-paths.ts` (new), `scripts/world/world-check.ts` (new) | none |
| T5 Trials | `landmark-trial-cliff.ts`, `landmark-trial-wood.ts`, `landmark-trial-lake.ts`, `landmark-trial-bluff.ts`, `landmark-trial-glade.ts` (new), `scripts/trials/drowned-solver.ts` (new) | none |
| T6 Onboarding and copy | `landmark-shrine.ts`, `landmark-prologue.ts` (new), `companion.ts` (new), `guide.ts` (new), `scripts/copy/copy-audit.mjs` (new), `scripts/onboard/first-10.mjs` (new) | slot A, 3rd |
| T7 Player, camera, input | `player.ts`, `camera.ts`, `camera-collide.ts`, `camera-lock.ts`, `camera-shake.ts`, `input.ts`, `input-pad.ts`, `input-touch.ts`, `scripts/sim/player-sim.ts` (new) | none |
| T8 Combat and enemies | `combat.ts`, `combat-events.ts`, `combat-flash.ts`, `combat-projectiles.ts`, `combat-props.ts`, `enemies.ts`, `enemy-brain.ts`, `enemy-fx.ts`, `enemy-geo.ts`, `enemy-models.ts`, `enemy-rig.ts`, `enemy-warden.ts`, `scripts/sim/combat-sim.ts` (new) | none |
| T9 Thread | `thread.ts` (new), `thread-aim.ts` (new), `thread-render.ts` (new), `scripts/sim/thread-sim.ts` (new) | none |
| T10 HUD and UI | `ui-app.tsx`, `ui-book.tsx`, `ui-hud.tsx`, `ui-ink.tsx`, `ui-map.tsx`, `ui-nav.ts`, `ui-pages.tsx`, `ui-screens.tsx`, `ui-store.ts`, `globals.css`, `ui-chips.tsx` (new), `ui-memory.tsx` (new) | slot B, 3rd |
| T11 Music | `audio-music.ts`, `audio-inst.ts` (new), `audio-score.ts` (new), `scripts/audio/fetch-instruments.mjs` (new), `scripts/audio/build-instruments.py` (new), `scripts/audio/originality.mjs` (new), `public/music/**` | none |
| T12 SFX, ambience, voice, mix | `audio.ts`, `audio-dsp.ts`, `audio-sfx.ts`, `audio-ambience.ts`, `audio-samples.ts` (new), `audio-space.ts` (new), `audio-mix.ts` (new), `audio-voice.ts` (new), `scripts/audio/fetch-sfx.mjs` (new), `scripts/audio/level-check.mjs` (new), `scripts/audio/osc-count.mjs` (new), `scripts/voice/**` (new), `public/sfx/**`, `public/voice/**` | none |
| T13 Bugs and save | `state.ts`, `save.ts` (new), `scripts/check/bug-ledger.json` (new), `scripts/check/save-check.ts` (new) | none |
| T14 Hero model | `player-model.ts`, `scripts/hero/hero-shot.mjs` (new) | slot B, 2nd |

Each track may also create and own `src/app/lab/<track-id>/page.tsx` for testing with mocks. Delete it before hand-in.

## Boundaries that are easy to get wrong

- **Objective text:** T6's `guide.ts` owns the objective and chip strings (`objectiveFor`), and game.ts reads it through
  `guide.objective()`. `state.ts` (T13) keeps quest state only; its `objectiveLines`/`objectiveText` delegate to `objectiveFor`.
- **Fog and lighting uniforms:** the GLSL and uniform helper live in `render-look.ts` (T2). `render.ts` (T1) calls the
  helper; it does not copy shader code.
- **Water:** `terrain-water.ts` belongs to T3. T3 keeps its export names so `terrain.ts` (T2) does not change. A rename
  is switched by the integrator at merge.
- **Grass and flowers:** `nature-grass.ts` belongs to T1 (cost) and includes the flower card change. T2 provides
  `hmShadow` in `render-look.ts` for it to call.
- **Thread anchors:** T4 registers world anchors through `SiteRegistryV2.anchor`, T5 registers trial anchors the same
  way, T8 exposes enemy anchors through `EnemiesV2.anchors`. T9 only reads them from `FrameCtx.anchors`.
- **Tallow:** lines and triggers are T6 (`companion.ts`). The lantern mesh and socket are T14. The chirp sound is T12.
  The subtitle on screen is T10.
- **FxKind:** `render-fx.ts` has a `Record` over `FxKind`. New kinds are an integrator change in contracts.ts plus a
  T3 entry, landed together.

## Headless browser rule

At most 2 tracks run a browser at once: slot A (port 3101) and slot B (port 3102), in the order above. Everyone else
checks offline. Slot tracks start their server with `NEXT_DIST_DIR=.next-<port> npx next dev --turbopack -p <port>`
and restore `tsconfig.json` when done.

## Merge order

T13, T7, T14, T9, T8, T4, T5, T6, T10, T1, T2, T3, T12, T11. Run `npx tsc --noEmit` and the track's offline check
after each. The integrator's wiring list is at the end of `zelda/v2/TRACKS.md`.
