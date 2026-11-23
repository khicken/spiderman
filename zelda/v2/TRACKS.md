# HOLLOWMERE v2 build tracks

14 parallel tracks. Each track owns its files outright: no two tracks edit the same file. Shared types live in
`src/app/contracts.ts`, which only the integrator edits. The design is in `v2/DESIGN-V2.md`; section numbers below
point there.

## Rules for every track

- Edit only the files your track owns. If you need a change in another track's file or in contracts.ts, write it as a
  request at the top of your final report. Do not make it.
- New module APIs are `XV2 extends X` interfaces in contracts.ts. Implement the V2 interface; keep the old one working
  until merge.
- Fields marked "v2 optional until merge" in contracts.ts may be read as optional. Your track writes them; the
  integrator makes them required after merge.
- A lab page at `src/app/lab/<track-id>/page.tsx` is allowed and owned by your track. Delete it before you hand in.
- Run `npx tsc --noEmit` in `zelda/` before you hand in. It must exit 0.
- Prefer offline checks (node scripts with `node --experimental-strip-types`, pure functions, simulated frames).
- **Browser slots:** at most 2 tracks may run a headless browser at once. Slot A and slot B below. A track not in a
  slot must not start a browser or dev server. A slot track starts its dev server with
  `NEXT_DIST_DIR=.next-<port> npx next dev --turbopack -p <port>` and restores `tsconfig.json` afterwards
  (`git checkout -- zelda/tsconfig.json`). Chromium flags: `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
- Player text follows `v2/copy-rule.md` and the names in DESIGN-V2 section 1.
- No commits unless the user asks.

## Browser schedule

| Slot | Port | Order |
| --- | --- | --- |
| A | 3101 | T1 perf, then T3 sky/water/fx, then T6 onboarding |
| B | 3102 | T2 look, then T14 hero, then T10 UI |

Tracks waiting for a slot do their offline work first and take the slot when the previous holder reports done.

## Track summary

| Id | Track | Files | GPU browser |
| --- | --- | --- | --- |
| T1 | Perf, AA, outline removal | 6 | yes, slot A first |
| T2 | Render look and lighting | 10 | yes, slot B first |
| T3 | Sky, water, ambient fx | 7 | yes, slot A second |
| T4 | World layout, landmarks, secrets | 14 | no |
| T5 | Trials | 6 | no |
| T6 | Onboarding, cold open, Tallow, copy | 6 | yes, slot A third |
| T7 | Player movement, camera, input | 9 | no |
| T8 | Combat and enemies | 13 | no |
| T9 | Thread | 4 | no |
| T10 | HUD, UI, map, journal | 13 | yes, slot B third |
| T11 | Music | 6 plus `public/music/**` | no |
| T12 | SFX, ambience, voice, mix | 12 plus `public/sfx/**`, `public/voice/**` | no |
| T13 | Bug fixes and save | 4 | no |
| T14 | Hero model | 2 | yes, slot B second |

All paths below are relative to `zelda/`. "(new)" marks files the track creates.

---

## T1. Perf, AA and outline removal

**Goal:** phone low preset holds ~60 fps; desktop GPU no longer pinned at 100%. DESIGN-V2 section 11.

**Owns:**
- `src/app/render.ts`
- `src/app/render-post.ts`
- `src/app/render-timing.ts` (new): GPU timer queries per pass
- `src/app/nature-grass.ts` (grass and flower cost, plus flower cards from fix 16)
- `scripts/perf/perf-run.mjs` (new): scripted flyover and Glade fight, logs per-pass GPU ms, calls, triangles
- `scripts/perf/budget.json` (new): budgets per preset from section 11

**Implements:** `RenderV2` (shouldRender, setFpsCap, setRegionColor, setTiming), `RenderStats.gpu`,
`QualityPreset` fields aa, msaa, maxPixels, fpsCap, heroOutline, fakeGlow, and `FRAME_GOVERNOR`.

**Uses:** `QUALITY`, `FRAME_GOVERNOR`, `Settings.fpsCap`, `HeroModel.setOutline` (T14), the look uniform helper from
`render-look.ts` (T2). render.ts calls T2's exported helpers; it does not copy shader code.

**Work:**
- Measure first: per-pass GPU timings for all 4 presets, saved as the "before" table.
- Delete the depth-laplacian ink pass. Hero and enemy outline only through `heroOutline` on medium and up.
- AA per preset: MSAA render target (WebGL2 `samples`) on high and ultra, SMAA on medium, FXAA on low.
- Frame cap and governor: idle, paused and hidden-tab throttling. Dynamic resolution that actually changes the
  drawing buffer size, inside `maxPixels`.
- Grass: density and distance from `QUALITY`, masked out of every pass but the main one, cheaper overdraw.
- Fake glow sprites on low instead of bloom.
- Measure again, saved as the "after" table.

**Acceptance:**
- `perf-run.mjs` shows every preset inside its `budget.json` row; before and after tables in the hand-in report.
- Hidden tab renders 0 frames (rAF count over 5 s); paused renders ≤10 fps.
- Screenshot at phone viewport shows no stair-stepped edges on the shrine arch.

**GPU browser:** yes, slot A, first.

---

## T2. Render look and lighting

**Goal:** two-temperature light, painterly trees, height fog. DESIGN-V2 section 12, fixes 1, 2, 4, 5, 6, 7, 15.

**Owns:**
- `src/app/render-look.ts` (HM_GLSL, `hmShadow`, `hmFogF`, exported uniform helper for render.ts)
- `src/app/render-env.ts` (palette keys, blending)
- `src/app/render-blob.ts`
- `src/app/terrain.ts`
- `src/app/terrain-shader.ts`
- `src/app/terrain-textures.ts`
- `src/app/nature.ts`
- `src/app/nature-util.ts`
- `src/app/nature-trees.ts`
- `src/app/nature-props.ts`

**Implements:** the look half of `RenderV2.setRegionColor` (region desaturation by beacon state, exposed as a uniform
helper T1 calls), the `QUALITY` shadow and canopy-map paths.

**Uses:** `QUALITY`, `LANDMARKS`, `world` heights, beacon state from `FrameCtx`.

**Work:** palette table per hour with fog tint and blue-hour key; blend instead of snap. Ambient down, key up, ramp
0.28 / 0.62 / 1.0, shade toward `cShade`. Shared `hmShadow(worldPos)` with a baked 512² canopy shadow map on low.
Height fog and aerial perspective; fix the dark sea-horizon band. Trees: seeded crown variants, spherical normals,
leaf-card fringe, Poisson placement, hero trees, wind sway. Blue-noise near fade. Rock stripe fix and colors.
Gloam regions desaturated until their beacon is lit.

**Water handoff:** terrain.ts keeps importing the current water from `terrain-water.ts` (T3). T3 keeps the same export
names, so no edit is needed in terrain.ts. If T3 must rename, the integrator switches the import at merge.

**Acceptance:**
- Screenshots at 05:30, 08:00, 12:30, 17:00, 18:36, 19:36 and 00:00 from 3 fixed cameras (shrine, glade, Whisperwood).
  Each frame shows a warm side and a cool side and no grey-green shade.
- Draw calls and triangles do not exceed T1's budget for the preset (run T1's script when T1 has landed, else report
  counts).

**GPU browser:** yes, slot B, first.

---

## T3. Sky, water and ambient fx

**Goal:** painted sky, living water, motes, shafts and gloam smoke. DESIGN-V2 section 12, fixes 3, 9, 11, 17, plus
geometry light shafts.

**Owns:**
- `src/app/render-sky.ts`
- `src/app/render-rain.ts`
- `src/app/render-fx.ts`
- `src/app/terrain-water.ts`
- `src/app/nature-life.ts`
- `src/app/render-clouds.ts` (new): instanced cloud cards
- `src/app/render-shafts.ts` (new): geometry light shafts with motes

**Implements:** the fx handlers for `FxKind` (existing members only; new kinds are a request to the integrator because
render-fx has a `Record` over `FxKind`), ambient particle families, the moon, rain and rainbow.

**Uses:** `QUALITY.particles`, `Weather`, palette from `render-env.ts` (T2, read-only import), `LANDMARKS`.

**Acceptance:**
- One instanced draw for clouds, one for all particles, ≤2 for shafts.
- Screenshots: dawn sky, noon river, golden-hour forest with shafts, night with fireflies, rain with puddles.
- No posterize bands in the sky gradient (pixel check: no step larger than 3/255 across a vertical sky strip).

**GPU browser:** yes, slot A, second.

---

## T4. World layout, landmarks and secrets

**Goal:** the island reads like DESIGN-V2 section 4: prologue path, Glade, waystones, ember paths, ~40 secrets.

**Owns:**
- `src/app/world.ts`
- `src/app/world-gen.ts`
- `src/app/world-noise.ts`
- `src/app/landmarks.ts`
- `src/app/landmark-kit.ts`
- `src/app/landmark-items.ts`
- `src/app/landmark-beacon.ts`
- `src/app/landmark-secrets.ts`
- `src/app/landmark-village.ts`
- `src/app/landmark-spire.ts`
- `src/app/landmark-trail.ts` (new): ember stones and glimmer trails
- `src/app/landmark-waystone.ts` (new)
- `src/app/landmark-paths.ts` (new): builds `EMBER_PATHS` and `VIEW_CUTS` into the terrain and props
- `scripts/world/world-check.ts` (new)

**Implements:** `LandmarksV2` (anchors, waystonePos, targetPos, checkpointName), `SiteRegistryV2` on the landmark-kit
`Registry` (anchor, zone, waystone), `PROLOGUE` geometry (gate brazier, stones, ledge, climb rock, knots A and B),
the Glade site shell (beacon tower and 3 room floors; the trial logic is T5), `WAYSTONES`, `EMBER_PATHS`, `VIEW_CUTS`,
`ColliderTag "decor"` and `"knot"`, gold-leaf rune palette in `PAL`, landmark rebuilds from fix 10.

**Uses:** `LANDMARKS`, `PROLOGUE`, `WAYSTONES`, `EMBER_PATHS`, `VIEW_CUTS`, `ThreadAnchor`, `TELL.questStartSafeR`,
`CAMPS`.

**Acceptance (offline, `world-check.ts`):**
- Glade beacon within 150 m of spawn; climb rock top to knot B is 26 m ±1 and 5 m ±0.5 lower.
- Every main beacon has a waystone within 80 m.
- Along each ember path, the gap between secrets is ≤140 m; total secrets 38-42.
- No camp within 45 m of a pedestal, waystone or the prologue path.
- No lamp post collider is climbable.
- The vista from (-60, 346) to the Glade beacon is not blocked by terrain or trees (ray test).

**GPU browser:** no.

---

## T5. Trials

**Goal:** five trials, each with teach, test and bonus. DESIGN-V2 section 5.

**Owns:**
- `src/app/landmark-trial-cliff.ts`
- `src/app/landmark-trial-wood.ts` (Thornring)
- `src/app/landmark-trial-lake.ts` (Drowned)
- `src/app/landmark-trial-bluff.ts` (Windward)
- `src/app/landmark-trial-glade.ts` (new)
- `scripts/trials/drowned-solver.ts` (new): breadth-first search over block states

**Implements:** `TrialHandle` per trial, `trialRule` events with the rule text, anchors registered through
`SiteRegistryV2.anchor`, rewards (`power`, `memory`, heart shard, Wick Oil).

**Uses:** `SiteEnv`, `Registry & SiteRegistryV2` (cast `env.reg`), `THREAD`, `BEACON_POWER`, `ENEMY`, `TELL`.

**Acceptance (offline):**
- Solver: Drowned test solvable in ≤6 pulls; bonus plate unsolvable without Heavy Thread and solvable with it.
- Each trial file exports a pure plan function that a script can call with a fake world, and the plan has all 3 parts.
- Windward without the bow returns the prompt "You need a bow. Find it in the Mirebrook mill."
- Cliffwatch has no timer.

**GPU browser:** no.

---

## T6. Onboarding, cold open, Tallow and copy

**Goal:** the first 10 minutes in DESIGN-V2 section 2, and plain copy everywhere.

**Owns:**
- `src/app/landmark-shrine.ts`
- `src/app/landmark-prologue.ts` (new): prologue step machine and triggers
- `src/app/companion.ts` (new): Tallow's line bank, triggers, cooldown
- `src/app/guide.ts` (new): chips, objective text, tracked target, hints
- `scripts/copy/copy-audit.mjs` (new): scans player strings for banned words and long lines
- `scripts/onboard/first-10.mjs` (new): scripted first-10-minutes run that reads HUD text

**Implements:** `Guide` / `CreateGuide`, `Companion` / `CreateCompanion`, `PrologueStep` flow, events `say`, `hint`,
`hintDone`, `prologue`, `objective`, `track`, `cine`. Objective table and chip table in section 10 (as data in
guide.ts; T10 renders it).

**Uses:** `PROLOGUE`, `HintId`, `TrackTarget`, `Progress.hintsSeen`, `CameraRigV2.cine` (T7), `InputV2.glyph` (T7).

**Acceptance:**
- `first-10.mjs` reads the objective "Light the brazier at the gate" by 0:06 and "Light the Glade Beacon" by 0:22,
  with a tracked marker present.
- The scripted route performs move, look, jump, climb, thread and ride by 2:00.
- `copy-audit.mjs` passes over `src/app/**` (banned: flame for heart, wakes, gutters, rekindle, lantern-bearer).
- One blind run log (a fresh agent that has not read the design) reaches the Cliffwatch pedestal by 10:00 without
  opening pause.

**GPU browser:** yes, slot A, third. Most work (step machine, guide data, copy audit) is offline first.

---

## T7. Player movement, camera and input

**Goal:** movement and camera feel from DESIGN-V2 section 6.

**Owns:**
- `src/app/player.ts`
- `src/app/camera.ts`
- `src/app/camera-collide.ts`
- `src/app/camera-lock.ts`
- `src/app/camera-shake.ts`
- `src/app/input.ts`
- `src/app/input-pad.ts`
- `src/app/input-touch.ts`
- `scripts/sim/player-sim.ts` (new)

**Implements:** `PLAYER` v2 fields (skid, vault, mantle, jump cut, coyote, buffer, glide flare and dive, last gasp,
roll land, backstep), `MoveMode "ride"` (position comes from T9's `ThreadState.ride`), `PlayerAction` additions,
`PlayerState` aimOrigin, aimDir, staminaRings, softLockId, `CAMERA`, `CameraRigV2` (recenter, cine), `InputV2`
(relock, glyph), the `thread` button (R / LB / touch lantern), dodge on C or L, bow on F, lock on Q or MMB.

**Uses:** `THREAD` ride numbers, `ThreadState` (read-only), `Settings.cameraFollow`.

**Acceptance (`player-sim.ts`, fixed 60 Hz steps):**
- Full jump apex 1.3 m ±0.05; tapped jump 0.65 m ±0.1.
- Jump pressed 0.15 s before landing still jumps; jump 0.15 s after leaving a ledge still jumps.
- Fall of 6.4 m: no damage. Fall of 7 m: damage, unless a roll is pressed within 0.15 s of landing.
- Vault triggers for 0.45-1.3 m ledges at a run.
- Camera auto-follows after 1.6 s with no mouse input.
- Tab and Ctrl are never bound (grep check).

**GPU browser:** no.

---

## T8. Combat and enemies

**Goal:** readable, fair combat. DESIGN-V2 section 7, fix 14.

**Owns:**
- `src/app/combat.ts`
- `src/app/combat-events.ts`
- `src/app/combat-flash.ts`
- `src/app/combat-projectiles.ts`
- `src/app/combat-props.ts`
- `src/app/enemies.ts`
- `src/app/enemy-brain.ts`
- `src/app/enemy-fx.ts`
- `src/app/enemy-geo.ts`
- `src/app/enemy-models.ts`
- `src/app/enemy-rig.ts`
- `src/app/enemy-warden.ts`
- `scripts/sim/combat-sim.ts` (new)

**Implements:** `SWORD` v2 timings (startup, active, recovery, chain window, late bonus, local hitstop, parry slow-mo),
`TELL` (glint, mossback pre-hold, 2 attack tokens), `EnemiesV2.anchors` (enemy anchors for Thread), strike kinds
`bind` and `burn`, events `parry`, `slowmo`, `tell`, `threadBind` handling, Warden phases and the phase 3 brazier
threads, new `CAMPS` positions, enemy model rework.

**Uses:** `ENEMY`, `CAMPS`, `THREAD` bind and burn numbers, `ThreadState`.

**Acceptance (`combat-sim.ts`):**
- 3-hit combo with perfect presses lands in startup+active+recovery totals from `SWORD` ±1 frame.
- Never more than 2 enemies in windup or attack on Wren (100 simulated fights, 5 enemies each).
- Every enemy attack emits a `tell` event 0.15 s before its hit frame.
- Parry inside 0.18 s stuns 1.4 s; outside it blocks only.
- No camp spawns or aggro within 45 m of a pedestal.

**GPU browser:** no.

---

## T9. Thread

**Goal:** the signature mechanic exactly as DESIGN-V2 section 3.

**Owns:**
- `src/app/thread.ts` (new): rules, pairs, wick, ride physics, pulls, burn
- `src/app/thread-aim.ts` (new): cone and snap targeting
- `src/app/thread-render.ts` (new): line ribbons, preview line, sparks (one merged draw for all lines)
- `scripts/sim/thread-sim.ts` (new)

**Implements:** `Thread` / `CreateThread`, `ThreadState`, `ThreadAnchor`, `ThreadUse`, `ThreadLine`, `LanternPower`,
events `threadPin`, `threadLink`, `threadCut`, `threadRide`, `threadFizzle`, `threadFire`, `threadBind`.

**Uses:** `THREAD`, `BEACON_POWER`, `FrameCtx.anchors` (from T4 and T8 via game.ts), `PlayerState.aimOrigin` and
`aimDir` (T7), `Progress.wickOil` and `powers`.

**Acceptance (`thread-sim.ts`):**
- Every row of the pair table in section 3 produces the listed use; invalid pairs produce `"pair"` with no pip spent.
- Wick: 2 pips at start; a pip returns when its line ends; recall after a 0.4 s hold cuts all.
- Ride on a 26 m line 5 m downhill takes 2.0-2.6 s and ends with the exit boost.
- Pull speeds 3 / 2 / 1.2 m/s by weight, stop 1.5 m short; weight 3 needs Heavy.
- Line life 12 s, except while ridden.

**GPU browser:** no. The lab page may be checked by a slot track on request.

---

## T10. HUD, UI, map and journal

**Goal:** the HUD layout and every string in DESIGN-V2 section 10.

**Owns:**
- `src/app/ui-app.tsx`
- `src/app/ui-book.tsx`
- `src/app/ui-hud.tsx`
- `src/app/ui-ink.tsx`
- `src/app/ui-map.tsx`
- `src/app/ui-nav.ts`
- `src/app/ui-pages.tsx`
- `src/app/ui-screens.tsx`
- `src/app/ui-store.ts`
- `src/app/ui-stub.tsx`
- `src/app/globals.css`
- `src/app/ui-chips.tsx` (new)
- `src/app/ui-memory.tsx` (new)

**Implements:** `HudSnapshot` v2 fields (objectiveSub, gladeLit, wick, wickUsed, seeds, trialRule, checkpointName),
`HudFrame` v2 fields (markers with kind and tracked, 13 markers, lanternAt, threadAim, trackedDist), the death screen
with `died(where)`, the map (M opens and closes, track, travel), the journal (24 shards, Wick Oil, powers, memories,
secrets), the ending choice screen, settings for voice, subtitles, hints, camera follow and fps cap, CC BY credits.

**Uses:** the string tables in section 10 (T6 owns the objective and chip data in guide.ts; T10 renders it).

**Acceptance:**
- Screenshots: desktop and phone, at 0:06, during a ride, in the Glade fight, map open, journal open, death screen.
- No string in ui-*.tsx fails T6's `copy-audit.mjs`.
- Per-frame UI (markers, lantern subtitle, thread aim) is written to DOM refs, not React state (grep check).

**GPU browser:** yes, slot B, third.

---

## T11. Music

**Goal:** the recorded score in DESIGN-V2 section 13.

**Owns:**
- `src/app/audio-music.ts`
- `src/app/audio-inst.ts` (new): sampled instrument voices
- `src/app/audio-score.ts` (new): the theme, region cues, combat layers, stings, transitions
- `scripts/audio/fetch-instruments.mjs` (new): downloads VSCO-2-CE and VCSL samples
- `scripts/audio/build-instruments.py` (new): trims, normalizes and encodes to OGG
- `scripts/audio/originality.mjs` (new): theme originality guard
- `public/music/**` including `public/music/CREDITS.md`

**Implements:** music side of `AudioV2` (region and state cues, silence gaps, stings, combat layers, boss phases).

**Uses:** `MIX`, `SampleBank` (from T12's audio-samples.ts), events `beaconLit`, `trialRule`, `objective`, `parry`,
`threadRide`.

**Acceptance (offline):**
- Zero `OscillatorNode.start` from the music path (script count in an OfflineAudioContext render).
- Rendered explore, combat and boss stems hit `MIX` targets ±2 LU (uses T12's `level-check.mjs`).
- Originality guard passes.
- CREDITS.md has one line per sample set with URL and CC0 license.

**GPU browser:** no.

---

## T12. SFX, ambience, voice and mix

**Goal:** real recorded sound and a mix on target. DESIGN-V2 section 13.

**Owns:**
- `src/app/audio.ts`
- `src/app/audio-dsp.ts`
- `src/app/audio-sfx.ts`
- `src/app/audio-ambience.ts`
- `src/app/audio-samples.ts` (new): the one sample loader, take rotation
- `src/app/audio-space.ts` (new): HRTF, occlusion, reverb IRs
- `src/app/audio-mix.ts` (new): buses, ducking, high-pass, levels()
- `src/app/audio-voice.ts` (new)
- `scripts/audio/fetch-sfx.mjs` (new)
- `scripts/audio/level-check.mjs` (new)
- `scripts/voice/` (new): Chatterbox generation for optional voice lines
- `scripts/audio/osc-count.mjs` (new)
- `public/sfx/**` including `public/sfx/CREDITS.md`, `public/voice/**`

**Implements:** `SampleBank`, `MIX`, `AudioV2` (setVolumes with voice, levels with oscStarts), sounds for every
`GameEvent` including all Thread events, Tallow's chirp, UI cues in D Lydian pentatonic.

**Uses:** `MIX`, `Settings.voice` and `subtitles`.

**Acceptance (offline):**
- `level-check.mjs` passes every state within 2 LU; true peak ≤ -1 dBFS.
- Never the same take twice in a row (unit test over 1,000 picks).
- `osc-count.mjs`: oscillators only from UI and magic cues.
- Every clip in CREDITS.md with source URL and license; no Sonniss.

**GPU browser:** no.

---

## T13. Bug fixes and save

**Goal:** every bug in the audits fixed or assigned, and save v2 with migration.

**Owns:**
- `src/app/state.ts`
- `src/app/save.ts` (new)
- `scripts/check/bug-ledger.json` (new): every audit bug, its owning track, status
- `scripts/check/save-check.ts` (new)

**Implements:** `BTN_NAMES` gets `"thread"`, `newQuest()` with the v2 quest fields, `Progress`, `SaveDataV2`,
migration from `hollowmere.save` v1 to `SAVE_KEY_V2`, `START_HOUR` and `FIRST_DAY_SCALE`, objective state hooks that
T6's guide reads.

**Uses:** `SaveDataV2`, `QuestState`, `Progress`, `WAYSTONES`.

**Work:** read all five audits and list every bug in the ledger with file:line, owner track and status. Fix the ones in
state.ts and save. Send the rest to their owners through the integrator. Known: climbable lamp posts (T4), journal
0/36 shards (T10), death copy (T10), M does not close the map (T10), Thornring camps (T8), missing thread button
(T13).

**Acceptance:**
- `save-check.ts`: a v1 save loads into v2 with no lost beacons, hearts or shards; a v2 round trip is lossless.
- The ledger has no bug without an owner; every T13 row is closed.

**GPU browser:** no.

---

## T14. Hero model

**Goal:** Wren rebuilt to DESIGN-V2 section 12 fix 12, at most 4 draw calls.

**Owns:**
- `src/app/player-model.ts`
- `scripts/hero/hero-shot.mjs` (new): turntable screenshots of the lab page

**Implements:** `HeroModel` and `HeroAnimIn` (lean, skid, vault, rideT, pinAim, lanternLean, glideMode), sockets
(lanternWorld, handWorld, bladeTipWorld, bowHandWorld), `setOutline` for T1, the ride pose hanging from Tallow.

**Uses:** `PlayerState`, `PlayerAction`.

**Acceptance:**
- Draw calls for the hero ≤4 (renderer info in the lab page).
- Turntable shots in idle, run, climb, glide, ride and attack poses.
- Keeps exporting the v1 `WrenAnimIn` path until the integrator switches game.ts.

**GPU browser:** yes, slot B, second.

---

## Integrator

**Owns:** `src/app/game.ts`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/contracts.ts`,
`src/app/OWNERSHIP.md`, `src/app/icon.svg`, `next.config.ts`, `package.json`, the lockfile, `tsconfig.json`,
`v2/*.md`.

**Must finish at merge:**
- Wire `RenderV2.shouldRender` into the rAF loop and pass the frame governor state.
- Put `threads`, `progress`, `anchors` and `worldScale` into `FrameCtx`; route all new events.
- Switch save to `SaveDataV2`.
- HUD markers to length 13 (4 beacons, spire at 4, glade at 5, waystones at 6-12).
- Switch `WrenAnimIn` to `HeroAnimIn`.
- Make every "v2 optional until merge" field required and fix the compile errors that follow.
- Add any `FxKind` members T3 or T8 requested, together with the render-fx `Record` entries.
- Delete every `src/app/lab/**` page.
- Run every track's offline script and both browser runs (first-10 and perf) on the merged build.

## Merge order

Each step: merge, `npx tsc --noEmit`, run that track's offline check, then continue.

1. T13 bugs and save (state and save shape everything else reads)
2. T7 player, camera, input (thread button, aim origin)
3. T14 hero model
4. T9 Thread
5. T8 combat and enemies
6. T4 world, landmarks, secrets
7. T5 trials
8. T6 onboarding, Tallow, copy
9. T10 HUD and UI
10. T1 perf, AA, outline
11. T2 look and lighting
12. T3 sky, water, fx
13. T12 SFX, ambience, mix
14. T11 music (last, so the level check runs on the full mix)

Then the integrator wiring list above, then the full success tests in DESIGN-V2 section 14.
