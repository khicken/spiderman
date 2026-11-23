# HOLLOWMERE graphics audit (v2)

Art-direction audit of branch `zelda-v2`. I captured 49 screenshots at 1440x900 on the desktop preset (high) and at 844x390 phone landscape on the `low` preset. All of them are in `zelda/v2/shots/`. Some freecam shots are camera-placement errors on my side and are not counted as game bugs: 06 and 09 (inside canopies), 14 (camera against the cliff face), 18 (underground) and 40 (under the river surface).

Phone low preset result: about 60 fps, 114 draw calls and 155k triangles in the meadow (`render.stats()`). There is room in the budget, so most fixes below can ship on phones.

## 1. Verdict in one paragraph

The game reads as a clean low-poly toy, not a magical place. Five causes do almost all of the damage:

1. Nothing in the world casts a shadow on anything else.
2. The ambient term is so strong that every surface sits in the same mid value, so noon is a flat lime wash.
3. The sky has visible posterize rings, and its clouds converge like searchlights.
4. Every tree of a species is the same mesh, laid out on what reads as a grid.
5. There is no ambient magic: no motes, no light shafts, no spirit glow and no wind you can see.

The ink outline and the paper grade are good foundations. The dusk hero shot (32) proves the look can work, with warm rim light, golden grass and readable values. The v2 job is to make every hour look like 32.

## 2. What is off, and why

### Palette
- Noon is dominated by one yellow-lime (`#7f9f4e`, `#93ad5c`, `#aaa55c` grass, plus tree greens of the same hue). There is almost no hue shift between near and far, or between sun and shade. See 03, 05 and 08.
- The accent colors fight the manuscript direction in DESIGN.md §7. The rune color `#7fe0d0` (landmark-kit PAL) is a neon sci-fi cyan (04, 12, 15, 31). Gloam `#5b3a6e` is used as flat lavender plastic (20, 41).
- The hero's sword has an orange stripe that reads as a toy (55).
- Night (`top #061519`, `hor #1b4a50`, `amb #2d5a63`) is a single teal that covers everything (25, 26, 56).

### Values and contrast
- `render.ts writeUniforms` multiplies sky ambient by 1.45 and ground ambient by 1.3. The 3-band ramp in `render-look.ts` then only spans about 0.45 to 1.0. As a result the shadow side of a tree is about 80% as bright as the lit side.
- The forest floor is as bright as the open meadow (10, 34, 35). There is no clear dark mass anywhere in a noon frame, so the eye has nowhere to rest and nothing pops.

### Lighting and shadows
- Shadows only reach `hmLook` Lambert materials (`scanShadows`). Terrain, trees, rocks, grass and water are custom ShaderMaterials that call `hmShade` with shadow fixed at 1.0. So trees float, landmarks float, and there is no dappled light under canopies (04, 10, 28, 35).
- There are no god rays, no sun shafts through trees and no bounce light.

### Cel shading
- The ramp boundaries are fine, but with this much ambient the bands collapse.
- The faceted low-poly tree blobs show every flat face as its own band, which reads as "low-poly asset pack", not painterly (34, 35).
- Rim light (`HM_RIM 0.35`) is only visible at dusk.

### Outlines
- The depth-laplacian ink is good on silhouettes (huts, hero, rocks).
- On grass it draws a line on every blade, which turns into scratchy noise in mid and near distance (06, 28, 34). It also draws hard lines along terrain facet creases on cliffs (14).

### Sky
- `render-sky.ts` posterizes the gradient: `mix(t, floor(t*7+.5)/7, 0.18)`. This makes concentric rings that are visible in almost every sky shot. Worst: 05, 14, 19, 23, 24.
- Clouds are fbm on a plane projected by `d.xz/(e+0.16)`. They stretch radially and pinch toward the zenith, so they read as searchlight beams or contrails, not clouds (24, 27).
- There are no cloud volumes or cards near the horizon.
- The moon is a grey disc with a heavy grey halo (25).

### Fog and atmosphere
- Fog depends on distance only.
  - From altitude the whole island turns to beige soup and Mt Cinder disappears (21).
  - Elevated views show a dirty dark-grey band at the sea horizon (11, 16).
  - At ground level the far trees do not cool or lighten enough to separate the layers.
- There is no height fog in valleys, no mist over water and no aerial-perspective hue shift.

### Vegetation and tree variety
- There are 5 species. Each is one fixed list of primitives, varied only by scale (0.82–1.24), yaw and tint. The result is lollipop clones in a near-grid (03, 07, 08, 11, 34).
  - Birches are white poles with green blobs. Whisperwood looks like a model railroad (10, 38-wisp, 55).
  - Pines are stacked lampshade tiers with flat black undersides (17, 19).
- Close up, the canopy blobs are faceted polyhedra with hard ink. They look like a stock low-poly pack.
- Bushes are smooth green blobs with red hexagons for berries (38-wisp).
- The near-fade screen-door dither (IGN in `nature-util` MESH_FS) shows as a coarse dot pattern on trunks and canopies whenever the camera is close. This is very visible in 38-wisp, where the whole birch trunk turns into dot noise, and also in 09, 10, 12, 17, 22 and 28.
- Flowers are flat 5-point star stickers. They are oversized near the camera (30, 31, 41).
- Grass is the best vegetation asset. It is dense and moves, but the tint is uniform and there is no color patching.

### Terrain texture
- The meadow has no visible texture at mid distance. It is a flat lime plane under the grass.
- The Ashen Cliffs read as one dark grey slab with repeating vertical stripes, like a concrete retaining wall (13).
- Heightfield faceting shows as a zigzag on steep faces (14).
- Paths are fine in color but have hard edges.

### Water
- The river reads as a pale grey or white road (08, 22).
- At the mouth there is a straight, hard water-sheet edge, ruler-straight foam streaks, and a box-shaped sea stack (22).
- The lake shows square blocky artifacts from sampling the low-res `heightLo` for shore depth (15).
- The shrine pond is a flat turquoise plane, and the shrine waterfall is a translucent rectangle with grid lines (02, 30).
- Seen from below, the water surface renders as an opaque white plane (40, camera error, but it shows there is no underside treatment).

### Characters
- **Hero (29–31, 55):** reads as Playmobil.
  - The head is a sphere, the face has dot eyes, and the hood is a sphere with a cone tip.
  - The body is a cylinder, and there is no silhouette break at the waist.
  - From behind, the hood sphere fills the phone screen when the camera closes in (55).
- **Brambling (34–36):** the best enemy. It has glowing red eyes and a readable spiky silhouette. Its body is still a plain sphere with cone thorns.
- **Wisp (38-wisp, 41):** has a nice lantern idea, but its gloam aura is a big flat purple translucent sphere with hard edges (41). It reads as a rendering bug, not magic.
- **Mossback (39):** a boulder-brute with okay mass. Its moss cap is a flat green lid.

### Animation
- From stills: the combat swing (35, 36) has leaf particles and a white slash spark but no smear or arc trail with weight.
- Hits have no squash, no hit-flash color and no impact ring.

### Landmark scale and design
- **Mt Cinder:** reads small and bald from the meadow (05). Its skirt of pines is on a grid, and the summit spire is tiny.
- **Ashen Cliffs:** the beacon sits on top and looks miniature (13).
- **Gloam Spire:** monochrome lavender plastic, with a generic hex-dome sci-fi shield (20).
- **Thornring:** the walls are a caterpillar of green and brown spheres, and the beacon tower is a plain grey cylinder (12).
- **Village (07, 08):** the huts are tiny against a wall of identical oaks. There are no chimneys with smoke, no banners and no paths with wear.
- **Shrine (03):** in the aerial view it is a boxy cliff block with a flat cyan rectangle for water.

### Composition
- There is no foreground, midground and background value structure. Foreground grass, mid trees and far hills all share one value.
- There are no leading lines (paths fade into the same green) and no landmark framing.
- The follow cam clips into canopies and into the hero's head (06, 55). On phones it also hides the hero behind bushes (56).

### VFX
- There is one pool of utility particles (dust, sparks, splashes). There is no ambient magic layer.
- Fireflies at night are large white blobs with no color or flicker falloff (26, 41, 56).
- Gloam is a flat sphere (41).
- Beacon flames are fine.

### Post-processing
- The grade, paper grain and warm vignette are tasteful, but the grain cannot carry a flat frame.
- Bloom exists only on high, so phones get no glow at all. Lanterns, eyes and runes go dead (56).
- The phone at pixelRatio 1.25 on a 3x screen shows stair-stepped edges on trunks and the compass (52, 55), because there is no AA on low.

## 3. v2 visual direction

**One sentence:** a hand-painted illuminated manuscript you can walk into, made of warm gold light, cool violet-blue shade, deep ink shapes, and the land itself breathing small sparks of light.

### Pillars
1. **Two-temperature light.** Sun is warm gold. Shade is cool blue-violet, never grey-green. Every frame has a clear warm side and a clear cool side.
2. **Value masses before detail.** Every frame has one dark mass (a canopy, cliff or shadow pool), one light mass (sky or a sunlit clearing) and one accent (gold, ember or spirit light).
3. **Painterly, not low-poly.** Foliage reads as clumps of brushed leaves with soft broken edges, not as polyhedra. Ink is for silhouettes, not texture.
4. **The world is alive.** Wind waves move through grass and trees, motes drift, light shafts move, and water glints.
5. **Gold leaf is the magic color.** Runes, beacons, quest marks and sacred places glow in gilded amber with ember cores. Gloam is the corrupting counter-color: bruised violet-black with sickly green-gold edges, never flat lavender.

### Palette per time of day (replace KEYS in render-env.ts)

| Key (h) | top | hor | sun | sunI | amb | gnd | rim | cLit | cShade | glow | fog tint | grade notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Night 0.0 | #0b1330 | #23305a | #9fb4ff (moon) | 0.35 | #2a3566 | #141a2e | #8fa8ff | #d7defa | #1d2548 | #ffb357 | #1a2244 | sat 0.85, lift shadows toward blue-violet, keep warm lights at full sat |
| Dawn 5.8 | #3d4f86 | #f4b48a | #ffcf9a | 0.8 | #6c6fa0 | #5a4a52 | #ffd2a8 | #fff1df | #4d5488 | #ffd27a | #e9b7a0 | rose-gold horizon, violet shade, sat 1.05 |
| Morning 8.0 | #5f9fd6 | #f1e6c8 | #fff0cf | 1.15 | #7f9bc0 | #6a6a4e | #fff4dc | #fffaf0 | #5a6f9e | #ffe08a | #d9e4e8 | crisp, cool shade |
| Noon 12.5 | #4c95d0 | #e3eef0 | #fff6e0 | 1.3 | #8aa6c8 | #6b7050 | #ffffff | #fffbe8 | #4f6890 | #ffe9a0 | #cfe0ea | highest contrast of the day, sat 1.0 |
| Golden 17.0 | #5a84c0 | #f6d39a | #ffc477 | 1.2 | #7d86b0 | #6e5a40 | #ffd08a | #fff0d0 | #5a5a90 | #ffc860 | #f1d2a4 | warm tint +0.08, sat 1.1 |
| Dusk 18.6 | #2e3c78 | #f08a5c | #ff9a5a | 0.9 | #6a5a8c | #4a3a40 | #ffb07a | #ffe0c0 | #463e78 | #ffb050 | #c98a86 | keep the current dusk rim, remove the mauve fog wash |
| Blue hour 19.6 | #1a2552 | #6a5a9a | #c0a0ff | 0.4 | #3a4478 | #20223a | #b0a0ff | #e0dcff | #262c5a | #ffb357 | #3d3f72 | windows and lanterns switch on here |

Terrain base colors for v2:
- Meadow grass: hue-shift by slope and patches. Sunlit grass `#9cbc54`, cool grass `#5f8a4e`, dry patches `#c2b46a`. Add sparse warm clover patches `#7fa84a` that carry flower clusters.
- Forest floor: `#3f5a38` with moss `#56743c` and leaf litter `#7a6440`, darkened by canopy AO (see below).
- Rock: warm `#b0a492` in light, `#5d5f78` in shade, ash rock `#6d6872` with ember-orange cracks near Cinder.
- Sand: `#e6d3a0`, wet sand `#b8a27a`.

### Shading model
- Keep the Lambert patch, the 3-band ramp and ink, but rebalance:
  - Ambient multipliers down to about 0.75 (sky) and 0.55 (ground).
  - Key light up through `sunI`.
  - Shadow band floor at 0.28, mid band at 0.62, lit at 1.0.
  - Tint the shadow band toward `cShade`, not toward black.
- Add a **shared shadow chunk** in `HM_GLSL` so that terrain, nature meshes, grass and water all call `hmShadow(worldPos)`.
  - On medium and high, use the existing directional shadow map, tightened to a 60–80 m frustum around the player, with one cascade.
  - On low, use a baked **canopy shadow texture**: a 512² top-down map of tree crowns, written once at world build, blurred, with an animated noise offset for dapples. Every ground shader multiplies by it. It costs one texture tap, gives dappled forest floors and grounded trees, and runs on phones.
- Add **wrap lighting** on foliage, `(NdotL + 0.5) / 1.5`, and a cheap **subsurface backlight**: when looking toward the sun through leaves, add `glow * pow(max(dot(V, -L), 0), 4) * 0.35` on foliage and grass. Canopies glow at golden hour.
- On foliage, replace per-face normals with **spherical normals from the crown center**. This removes the faceted look and gives soft, painterly banding with zero extra geometry.
- Rim light stays at 0.35 but is tinted by `rim` and gated by the shadow term, so rims only show on lit edges.

### Outlines
- Keep the depth-laplacian ink in `#2b2118`.
- Mask grass, flowers and particles out of the outline pass. Write them with an alpha flag of 0 in the glow or outline mask.
- Scale line weight by distance: 2 px near, 1 px mid, none beyond about 120 m. Fade the ink color toward fog color with distance so far ridgelines get pale blue ink (aerial perspective in the linework).
- Add a normal-threshold term only for characters and landmarks, so interior creases (hood, cloak hem, stone blocks) get lines. Terrain facets do not.

### Sky and clouds
- Remove the 7-step posterize. Use a smooth 3-stop gradient (zenith, mid, horizon) with a broad warm Mie glow around the sun. Add a soft ozone band just above the horizon at dawn and dusk.
- Replace plane-fbm with **painted cloud cards**: 12–20 large camera-facing quads on a ring 600–900 m out, at 2–4 heights.
  - Each card uses a canvas-generated cumulus texture with 3 value bands (lit top, mid, cool underside) and an ink-soft edge.
  - Cards are lit by sun direction, by picking the band offset with `dot(cardToSun)`.
  - They drift slowly, and dusk tints them from the palette.
  - Cost: one draw call, instanced.
- Keep one high, thin cirrus layer as fbm, but sample it in a **spherical** mapping, `d.xz/(d.y+0.35)` with a horizon fade, not the pinching plane. It stays subtle (alpha ≤ 0.25).
- Moon: a sharp, pale gold-white disc `#f3ecd2` with a cool soft halo `#8fa8ff` at 15% alpha, plus a faint painted crater texture. Stars twinkle and are clustered along a soft milky band.

### Fog and atmosphere
- Use **height fog**: density = `base * exp(-max(worldY - fogFloor, 0) * falloff)`. Valleys and water stay misty, and summits and aerial views stay clear.
- Use **aerial perspective color**: blend toward `fog tint` with distance, cooler and bluer in shade, warmer toward the sun. That is the existing haze term, extended.
- At dawn, add low ground mist over the lake and river: a few soft additive cards that hug the water.

### God rays and light shafts
- Medium and high: a screen-space radial blur of the sky and bright mask toward the sun's screen position, at half resolution with 16 taps, folded into the bloom pass. Strength rises at golden hour and in the forest.
- All presets, including low: **geometry shafts**. In forests and at the shrine, place additive, soft, gradient cone-cards (thin quads) angled along the sun direction, with dust motes inside. They fade by view angle and by time of day. This is very cheap, and it is the single most magical element available to phones.

### Particle language
Three ambient families plus the existing combat pool.
1. **Pollen and motes (day):** small warm-gold points drifting upward, densest in sunlit clearings and inside light shafts. 60–120 particles around the camera, recycled in a 25 m box. One instanced point draw.
2. **Spirit wisps (dusk and night, sacred places):** soft cyan-white to gold glows with a short trail. They orbit shrines and beacons and drift slowly toward the player when a quest object is near. They double as wayfinding.
3. **Fireflies (night, meadow and wood edges):** warm `#ffd27a` points 2–4 px wide with a sine blink, not white blobs. They are dimmer and more numerous than now.

Rules for all of them:
- Additive blending, no ink.
- Size in screen pixels, clamped to 2–6 px so phones never get blobs.
- Gold means good and sacred. Violet-black with green-gold sparks means gloam.
- Gloam aura: replace the purple sphere with smoky violet sprites. Use dark cores with multiply blending and a thin bright violet edge, plus a few drifting ash flakes.

### Wind
- One global wind uniform: `uWind` (direction, strength, gust phase), driven by weather.
- Grass: keep the sway, but add a large-scale **gust wave**, a low-frequency noise traveling along the wind direction. It brightens tips as it passes, so the meadow visibly "breathes".
- Trees: the crown sways by height-weighted vertex offset. Leaves flutter with high-frequency noise at the crown edges. Trunks stay still.
- The cloak, hood tip and grass near the hero all react to the same wind.
- Particles (leaves, pollen) advect with `uWind`.

### Foliage
- **Crowns:** build each crown from 3–7 random clumps (icosphere level 1, normals made spherical) jittered per instance from a seed, so no two trees match. Generate 6–8 variants per species at load and pick per instance. The instance cost stays the same.
- **Edges:** add a shell of alpha-tested leaf cards around each clump, with a canvas brush-stroke leaf texture and noise alpha. This breaks the polyhedral silhouette into a painterly fringe. On low, use the cards only on the 30 nearest trees.
- **Species shapes:**
  - Oak: broad and lopsided, with a visible branch fork.
  - Birch: a slim trunk with dark bark marks, and loose, airy clumps with gaps.
  - Pine: a tapered, irregular, layered silhouette. The undersides of the tiers get `cShade`, not black.
  - Willow: drooping card curtains that sway.
  - Ash: a tall, open crown.
- **Placement:** Poisson-disc sampling with clustering noise, so groves, clearings and lone trees appear. Add 2–3 "hero trees" (huge, old, gnarled) at landmarks.
- **Near fade:** replace the IGN dither with a smooth alpha fade on a blue-noise texture tiled at 64 px and animated per frame, or with alpha-to-coverage where MSAA is on. Better still, fade only when the tree is between the camera and the player.
- **Flowers:** a cross of two cards with a canvas-painted petal texture, at 40–60% of the current size near the camera. Group them in patches by color, not uniformly spread.

### Water
- **River:** deep teal-green `#2f6a6a` in the channel, lighter `#6fb3a8` at the banks. Add flow-aligned, scrolling sparkle lines (cel specular streaks) along the flow, and white foam only at rocks and banks, using a noise-shaped mask, never straight lines.
- **Shore:** sample the full-res heightmap (or a bilinear-smoothed `heightLo`) for depth, so the blocks go away. Add a soft wet-sand darkening band and a lapping foam line that pulses with time.
- **Sea:** a deep-to-shallow gradient by depth, sun glint dots (a stylized star specular) toward the sun, and a curved, noise-broken shoreline.
- **Waterfalls:** a vertical scrolling ribbon with a canvas streak texture, a white foam lip at the top, and a mist puff particle emitter plus a ring ripple card at the base.
- **Underside:** if the camera is below the surface, render the back face as a dark teal tint, or keep the camera above water.

### Characters
**Hero target proportions:** 5.5 heads tall, a slightly large head, and a strong cloak silhouette (Ghibli or Hat-in-Time scale, not Playmobil).
- Head: an ovoid, slightly taller than wide.
  - The face is a flat-shaded mask plane, with almond eyes from a small canvas texture, eyebrows and a nose tip.
  - Skin is warm `#e9c8a4` with a cheek blush.
- Hood: built from a cone lathe with a soft drooping tip that sways with wind. It is open at the front so the face shows.
- Cloak: a lathe flare from the shoulders to the knees, with an inner lining in a warm color `#b8463a` that shows on turns. The hem has a scalloped or torn edge and a 2-bone sway.
- Body: a tapered torso with a belt (gold buckle) and a visible waist break. Arms are slightly long; boots are chunky.
- Sword: a clean steel blade `#d7dde2` with a gold guard and a leather grip. No orange stripe. A gilded rune glow appears only when charged.
- Camera: keep at least 2.6 m distance and fade the hero to 50% dither only below 1.2 m. Push the camera along the spring arm through foliage instead of colliding with it.

**Enemies:**
- **Brambling:** keep it. Add a twisted bark body made from a few stretched spheres, 2-tone thorns (dark tip, red base) and leaf tufts. Add a blink to the eyes.
- **Wisp:** keep the lantern. Replace the purple sphere with smoky gloam sprites. The lantern core is sickly green-gold `#c6e26a` on a violet-black body `#2a1a3a`.
- **Mossback:** a mossy top as uneven clumps with tiny flowers, a stone body with ink cracks, and glowing amber eyes.

### Animation and feedback
- Sword arc: a 6–8 frame smear ribbon in warm white to gold, with additive blending and a tapered tail.
- On hit: a 60 ms white flash on the enemy material (uniform), an expanding ink ring card, 3–6 leaf or bark chips, a 40 ms hit-stop and a small camera kick.
- Footsteps: puffs of pollen in the meadow, dust on paths, splashes in water.

### Landmarks
- **Mt Cinder:**
  - Scale it up 1.5–2× vertically, or lower the camera FOV toward it.
  - Add a smoldering crater glow, a slow smoke plume (instanced soft cards) and ember-orange lava cracks in the ash rock.
  - Remove the grid-aligned pine skirt and use clustered placement.
- **Ashen Cliffs:**
  - Add strata ledges as stepped geometry with lit tops and dark undersides, and break the stripe repeat with world-space noise.
  - Make the beacon 2× bigger, with a gilded brazier and a light shaft when lit.
- **Gloam Spire:** a black-violet obsidian body with green-gold veins, smoke rising, and a cracked halo ring instead of the hex dome.
- **Thornring:** woven bramble arches (tube geometry along splines) with thorns and red berries. The beacon is a carved stone tower with banding, a gold cap and a brazier.
- **Shrine:** a carved stone arch with gold-leaf runes, a stepped pool with a waterfall ribbon, and a sacred tree overhead with permanent light shafts and spirit wisps.
- **Village:** chimneys with smoke, warm window glow from dusk onward (emissive quads flagged into bloom), lanterns on poles, banners in the wind, and a worn path texture.

### Gold-leaf rune system
- Replace `rune #7fe0d0` with gilded amber `#f1c45a` lines on a dark ink base `#3a2a1c`.
- When active, they gain a hot core `#fff1b8` and send drifting gold motes upward.
- Dormant runes are dull bronze `#8a6a3a`.

### Night
- The night palette shifts to moonlit blue-violet (see the table), with warm lights at full saturation.
- Village windows glow, every lantern lights, beacons cast colored light cards on the ground, and fireflies are warm.
- Moon shafts appear in forests (the same geometry shafts, tinted blue).

### Weather
- **Rain:** darken and cool the palette.
  - Add wet sheen: higher specular, darkened albedo and reflective puddles in terrain hollows, using a noise mask and a screen-space or sky-color reflection.
  - Add rain streak cards near the camera and a mist veil at distance.
  - Clouds become low, heavy, dark cards.
- **Clear after rain:** a rainbow arc card and extra glints.

## 4. Cheap tricks with a big phone win

1. **Baked canopy shadow map** (one 512² texture tap in ground, grass and rock shaders). It gives instant grounding and dappled forests, with no shadow map.
2. **Spherical foliage normals.** No new geometry, and the faceted low-poly look disappears.
3. **Ambient down, key up, shade tinted blue.** Uniform changes only. It is the largest single change to perceived quality.
4. **Remove sky posterize, add cloud cards.** One instanced draw.
5. **Height fog.** A few ALU operations in the existing fog function.
6. **Geometry light shafts and gold motes.** Additive cards and points, 1–2 draws.
7. **Fake bloom on low:** for emissive things (lanterns, eyes, runes, windows, fireflies, beacons), add a camera-facing soft glow sprite. No post pass.
8. **Mask grass out of the outline pass.** Removes noise and saves fill rate.
9. **Blue-noise fade instead of IGN dither.**
10. **FXAA, or render at pixelRatio 1.5 with an FXAA pass on low.** The 52 and 55 stair-steps go away; the budget allows it at 60 fps and 155k triangles.
11. **Vertex-color AO** at the base of trunks, rocks and huts, plus a dark contact disc. Zero runtime cost.
12. **Tree variety by seed at load** (6–8 variants per species). Same draw count.

## 5. Per-file change requests, ranked by visual impact

1. **`src/app/render-look.ts` + `src/app/render.ts` (`writeUniforms`, `scanShadows`).** Rebalance ambient (0.75 sky / 0.55 ground), raise sunI, set the ramp floor to 0.28 and tint shade toward `cShade`. Add a shared `hmShadow(worldPos)` to `HM_GLSL` that uses the shadow map on medium and high and a baked canopy shadow texture on low. Add wrap light and backlight terms for foliage.
2. **`src/app/terrain-shader.ts`, `src/app/nature-util.ts` (MESH_FS), `src/app/nature-grass.ts`.** Call `hmShadow` instead of the fixed 1.0. Multiply in the canopy shadow and AO maps. Add grass color patching and gust brightening.
3. **`src/app/render-sky.ts`.** Remove the `floor(t*7+.5)/7` posterize. Use a smooth 3-stop gradient with Mie glow. Replace the plane-projected fbm with instanced painted cloud cards plus a faint spherical-mapped cirrus layer. Redo the moon disc and halo.
4. **`src/app/render-env.ts`.** Replace KEYS with the v2 palette table above. Add a fog tint per key and a blue-hour key. Make `setTime` and `setWeather` blend instead of snapping.
5. **`src/app/render.ts` fog uniforms and `hmFogF` in render-look.ts.** Add height fog with a floor and falloff, plus aerial-perspective color by view and sun angle. Fix the dark sea-horizon band (fog color must match the sky's horizon color at the horizon).
6. **`src/app/nature-trees.ts`.** Generate 6–8 seeded crown variants per species from jittered clumps with spherical normals. Add leaf-card fringe shells. Re-do pine undersides and birch crowns. Place trees by Poisson-disc sampling plus cluster noise. Add hero trees. Add a height-weighted wind sway.
7. **`src/app/nature-util.ts`.** Replace the IGN screen-door near-fade with a blue-noise or soft alpha fade, triggered only for trees between the camera and the player.
8. **`src/app/render-post.ts`.** Mask grass, flowers and particles out of the outline. Scale ink by distance and fade it to fog color. Add a normal edge term for characters and landmarks only. Add half-res radial sun shafts on medium and high. Add FXAA on low.
9. **`src/app/render-fx.ts` + `src/app/nature-life.ts` ambient layer.** Add three ambient families: gold motes in shafts and clearings, spirit wisps at sacred places, and warm blinking fireflies with a screen-pixel size clamp. Replace the gloam sphere with smoky sprites. Add a sword smear ribbon, hit flash, ink ring and footstep puffs. Add fake-bloom glow sprites for emissives on low.
10. **`src/app/landmark-kit.ts` PAL and all `src/app/landmark-*.ts`.** Swap the cyan rune for gilded amber, with dormant bronze and an active hot core. Rebuild the Ashen Cliffs with strata ledges, Mt Cinder with scale, crater glow and smoke, and the Gloam Spire as obsidian with green-gold veins. Rebuild the Thornring as bramble arches and a carved stone tower. Rebuild the shrine with a stone arch, a waterfall ribbon and a sacred tree. Add village chimney smoke, window glow, lanterns and banners.
11. **`src/app/terrain-water.ts` + `src/app/terrain.ts` (heightLo).** Use full-res or smoothed depth for shores. Color the river channel. Add flow-aligned sparkle streaks, noise-shaped foam, a pulsing lap line and wet sand. Add a waterfall ribbon material. Add a dark underside.
12. **`src/app/player-model.ts`.** Rebuild to 5.5 heads: ovoid head, face mask with almond eyes, open lathe hood with a swaying tip, flared cloak with a warm lining and scalloped hem, belted torso, clean steel sword with a gold guard.
13. **`src/app/camera.ts` + `src/app/camera-collide.ts`.** Use a minimum distance of 2.6 m, push through foliage instead of colliding with canopies and bushes, and fade the hero only at very close range (06, 55, 56).
14. **`src/app/enemy-models.ts`.** Brambling: a bark body, 2-tone thorns and eye blinks. Wisp: gloam smoke, a green-gold lantern and a violet-black body. Mossback: clumped moss with flowers, ink cracks and amber eyes. Add a hit-flash uniform to every enemy material.
15. **`src/app/terrain-shader.ts` rock and cliff.** Break the vertical stripe repeat with world-space noise. Make rock warm in light and blue-violet in shade. Add ember cracks near Cinder. Soften facet zigzag on steep faces with a smoothed normal.
16. **`src/app/nature-grass.ts` flowers.** Use crossed cards with a painted petal texture, 40–60% of the current near size, grouped in color patches.
17. **`src/app/render-env.ts` + `src/app/render-rain.ts`.** Rain: wet sheen, puddles, streak cards and low heavy cloud cards. A rainbow card after rain.


## 6. Worst offenders (screenshots)

All paths are under `/Users/kaleb/Documents/GitHub/spiderman/zelda/v2/shots/`.

| Issue | Shots |
|---|---|
| Sky posterize rings and searchlight clouds | `05-meadow-noon-to-cinder.png`, `24-meadow-dusk.png`, `23-meadow-dawn.png`, `19-cinder-flank-ash.png` |
| No world shadows, flat values | `04-shrine-ground-noon.png`, `10-whisperwood-inside.png`, `35-combat-swing.png` |
| Lime wash noon, clone trees on a grid | `03-shrine-aerial-noon.png`, `08-village-aerial.png`, `11-whisperwood-aerial.png` |
| Aerial fog soup, dark sea horizon band | `21-island-aerial.png`, `16-drowned-beacon-aerial.png` |
| Dither dot noise near foliage | `38-enemy-wisp.png`, `10-whisperwood-inside.png`, `28-rain-follow.png` |
| Concrete river, straight foam, box sea stack | `22-beach.png`, `08-village-aerial.png` |
| Blocky lake shore | `15-lake-shore.png` |
| Concrete Ashen Cliffs, tiny beacon | `13-ashen-cliffs-base.png` |
| Flat lavender Gloam Spire, hex dome | `20-gloam-spire.png` |
| Neon cyan runes, caterpillar Thornring | `12-thornring.png`, `31-hero-closeB.png` |
| Playmobil hero, orange-stripe sword | `30-hero-closeA.png`, `55-phone-low-wood.png` |
| Flat purple gloam sphere, white-blob fireflies | `41-night-wisps.png` |
| Teal monochrome night, grey moon | `25-meadow-night.png`, `26-village-night.png`, `56-phone-low-night.png` |
| Grey-green rain, no sheen | `27-rain-meadow.png` |
| Phone camera hidden by bush, aliasing | `56-phone-low-night.png`, `52-phone-low-meadow.png` |
| Reference for the target look | `32-hero-dusk.png` |
