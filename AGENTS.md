# AGENTS.md

Rules and lessons for all games in this repo. Add a lesson here when it applies to more than one game.

## Layout

- Each game is a folder with its own Next.js app, `package.json`, and lockfile.
- Each app sets `basePath: "/<folder>"` in `next.config.ts`.
- Each game is its own Vercel project. Set the project Root Directory to the game folder.
- kalebkim.com serves a game through a rewrite in `website/next.config.ts`.
- Games do not import code from each other. To reuse a module, copy it and adapt it. If a third game needs the same module, move it to a shared package.

## Architecture

- Use no asset files. Build everything with three.js geometry, canvas textures, and Web Audio.
- Exception: recorded voice clips. Do not use the browser speechSynthesis voice. Generate voice lines one time with a local TTS model (Chatterbox) and ship them in `public/voice/` with a manifest. See `2k/scripts/voice/`.
- Exception: real recorded sound effects, when synthesis sounds fake (crowds, ball, rim, whistles). Use only CC0 or CC BY clips, list each one in `public/sfx/CREDITS.md`, and show CC BY credits in the game. See `2k/public/sfx/`.
- Exception: recorded sound effects and crowd audio. Synthesized crowds, ball bounces and whistles sound fake. Ship real recordings (CC0 or CC BY) in `public/sfx/`, load them through one sample module (`2k/src/app/audio-samples.ts`), credit every clip in `public/sfx/CREDITS.md`, and show the CC BY credits in the game's settings. Keep synthesis only for UI cues.
- Each module is a `createX()` factory that returns a plain object with `update` and `dispose`.
- `game.ts` owns the one `requestAnimationFrame` loop. Modules return `GameEvent[]`, and `game.ts` routes them to audio, camera, and UI.
- React renders only the menu and the HUD. Push HUD state at 8 to 10 Hz.
- For UI that must move every frame, such as a lock-on ring, write the style to a DOM ref. Do not use React state.
- Put shared types in `contracts.ts`. Write the module interfaces there first. Then several agents can build modules in parallel without file conflicts.
- When agents work in parallel, give each one a lab page at `src/app/lab/<area>/page.tsx` that mounts only its modules with mocks. Delete the lab pages before you commit.

## Performance

- Merge static geometry per material with `mergeGeometries`. The town in aot has about 1,000 houses in 6 draw calls.
- Compute UVs from world position, so one tiling texture fits boxes of all sizes.
- Share geometries and materials between repeated actors.
- Do not allocate objects in the frame loop. Reuse module-level scratch vectors.
- Use axis-aligned box colliders in a spatial hash grid. Use a slab test for raycasts.
- Clamp the frame time to 1/30 s. Use substeps for fast movement, so the player does not pass through thin walls.
- Put all heavy settings in one quality preset table: pixel ratio, shadow map size, post passes, fog distance, and particle budget.
- Snap the shadow camera to texels when it follows the player. This stops shadow shimmer.
- Draw all particles from one pool in one draw call.
- For ink outlines on merged geometry, detect edges in screen space from depth. Outline meshes per object do not scale to a merged town.

## Traps

- `world.near()` returns one shared `Set`. Do not call it again while you loop over its result.
- A `ShaderMaterial` needs the `tonemapping_fragment` and `colorspace_fragment` includes, or it looks wrong next to standard materials.
- After you turn shadows on or off, set `needsUpdate` on all materials, or they keep the old shader.
- React Strict Mode mounts the page two times in development. `dispose()` must remove every listener and free every GPU resource.
- Browsers block audio until a user gesture. Create the `AudioContext` when the player clicks Play.
- Pointer lock fails in headless browsers. The game must keep running without it.
- An `AudioScheduledSourceNode.stop()` before `start()` throws, and the throw stops the game loop. Catch errors inside the audio module.
- A dev-only `window.__aot` handle lets test scripts read state and move the player. Keep it behind `NODE_ENV !== "production"`.

## Check a change

1. Run `npx tsc --noEmit` in the game folder.
2. Start the dev server and drive the game with `playwright-core`.
3. Launch Chromium with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, or WebGL falls back to slow software rendering.
4. Read the HUD text from the page, and save screenshots of each step.
5. Look at the screenshots. A passing script does not prove that the scene looks right.
6. Parallel agents: Next 16 locks `.next/dev`, so two dev servers on one folder fail. Start each one with its own build
   folder: `NEXT_DIST_DIR=.next-<port> npx next dev --turbopack -p <port>` (2k reads it in `next.config.ts`). Next adds
   that folder to `tsconfig.json` `include`; remove those lines before you commit.

## Recorded audio

- Never layer synthesized music, organ stings or drum loops over a recorded crowd: next to real recordings they sound
  fake at once. Keep synthesis to short UI cues, and count `OscillatorNode.start` per game phase in test scripts, since
  a play-count check of buffer sources cannot see oscillators.
- Build a crowd from as few venues as possible: beds from one long arena recording, reactions from one crowd session,
  all in stereo, and send the reactions through the same reverb as the court.
- Play each crowd bed as one seamless loop (crossfade the seam offline) and only ride its gain. Re-slicing short clips
  into overlapping crossfaded segments sounds phasey.
- Ship several takes per reaction and avoid the last ones picked. A take that is already playing gets louder; it does not
  start a second copy.
- Take every variant of one sound (all dribbles, for example) from one source, so the room and mic never change between
  hits. Make soft and hard versions with gain and a low-pass.
- Take crowd recordings from the same sport. A hockey or soccer arena carries an organ, goal horns, PA music and chants
  that sound wrong under a basketball game. Scan candidates for sustained narrowband lines (80-2000 Hz, 0.8 s or longer):
  a music or organ bed shows 10+ per minute, a plain crowd 2-5.
- A crowd that reacts to every play sounds canned. Save the loud takes for home baskets, blocks, steals and dunks; give
  misses and routine stops a swell of the bed; and cap each reaction kind (one per 8 s) and all small ones (one per 4 s).
- Next 16 rewrites `tsconfig.json` for every `NEXT_DIST_DIR`, even when a `.next-*` wildcard is already listed. Restore
  the file (`git checkout -- 2k/tsconfig.json`) after a parallel dev server.
