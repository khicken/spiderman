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
- Each module is a `createX()` factory that returns a plain object with `update` and `dispose`.
- `game.ts` owns the one `requestAnimationFrame` loop. Modules return `GameEvent[]`, and `game.ts` routes them to audio, camera, and UI.
- React renders only the menu and the HUD. Push HUD state at 8 to 10 Hz.
- For UI that must move every frame, such as a lock-on ring, write the style to a DOM ref. Do not use React state.
- Put shared types in `contracts.ts`.

## Performance

- Merge static geometry per material with `mergeGeometries`. The titan town has about 1,000 houses in 6 draw calls.
- Compute UVs from world position, so one tiling texture fits boxes of all sizes.
- Share geometries and materials between repeated actors.
- Do not allocate objects in the frame loop. Reuse module-level scratch vectors.
- Use axis-aligned box colliders in a spatial hash grid. Use a slab test for raycasts.
- Clamp the frame time to 1/30 s. Use substeps for fast movement, so the player does not pass through thin walls.
- Put all heavy settings in one quality preset table: pixel ratio, shadow map size, post passes, fog distance, and particle budget.
- Snap the shadow camera to texels when it follows the player. This stops shadow shimmer.
- Draw all particles from one `THREE.Points` pool with a ring buffer.

## Traps

- `world.near()` returns one shared `Set`. Do not call it again while you loop over its result.
- A `ShaderMaterial` needs the `tonemapping_fragment` and `colorspace_fragment` includes, or it looks wrong next to standard materials.
- After you turn shadows on or off, set `needsUpdate` on all materials, or they keep the old shader.
- React Strict Mode mounts the page two times in development. `dispose()` must remove every listener and free every GPU resource.
- Browsers block audio until a user gesture. Create the `AudioContext` when the player clicks Play.
- Pointer lock fails in headless browsers. The game must keep running without it.

## Check a change

1. Run `npx tsc --noEmit` in the game folder.
2. Start the dev server and drive the game with `playwright-core`.
3. Launch Chromium with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, or WebGL falls back to slow software rendering.
4. Read the HUD text from the page, and save screenshots of each step.
5. Look at the screenshots. A passing script does not prove that the scene looks right.
