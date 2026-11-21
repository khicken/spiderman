# HOLLOWMERE — design

*Wake the four beacons.* A third-person open-world action-adventure on one small island, played in the browser at
kalebkim.com/zelda on laptops and phones. The numbers here match `src/app/contracts.ts`. If the two disagree,
contracts.ts wins. Tell the integrator about the mismatch.

## 1. Pillars

1. **Look anywhere and go there.** Every slope under 50° is walkable, and every steeper face is climbable. The glider
   gets you down from any height. Stamina is the only limit.
2. **Small and dense.** The island is 1.2 km across. You can walk from coast to coast in about 3 minutes. There is
   something worth finding every 60 to 90 m.
3. **A lantern in the dark.** The hero carries the only warm light. At night the island turns deep teal, and the ember
   glow of the lantern lights the grass around Wren.
4. **Readable fights.** Every enemy attack has a wind-up you can see. Block, parry, roll or step away. A parry always
   opens the enemy to a counter.

**Original IP.** Use only our own names: Wren, Hollowmere, glimmers, beacons, the Gloam. Never use names, places,
items, sounds, music motifs or UI layouts from any existing game.

## 2. Story and quest flow

The Gloam, a violet dusk that never lifts, sleeps in the Gloam Spire on top of Mt. Cinder. Long ago the island's four
beacons kept it asleep. Then they went dark. Wren is the last lantern-bearer. Wren wakes in the Hollow Shrine.

| Stage (`QuestState.stage`) | Trigger | Objective line |
| --- | --- | --- |
| `awaken` | new game, at the shrine | "Leave the Hollow Shrine and climb to the ridge" |
| `beacons` | first `areaEnter` outside the shrine | "Wake the four beacons (n/4)" |
| `spire` | 4th `beaconLit` | "The barrier has fallen. Climb Mt. Cinder to the Gloam Spire" |
| `boss` | `bossWake` (Wren enters the Spire arena) | "Defeat the Gloam Warden" |
| `ending` → `free` | `bossDefeated`, then `ending` 5 s later | "Hollowmere is awake. Explore freely" |

- Wren starts with the lantern-blade, buckler and glider. The **bow** waits in a chest in Mirebrook Ruin (`pickup`
  kind `bow`, 15 arrows). The Windward trial needs the bow. Its beacon shows "The targets are out of reach" until
  Wren has one.
- The beacons can be lit in any order. Each beacon has a pedestal. Press **use** at the pedestal to start its trial
  (`trialStart`). Finish the trial (`trialDone`), and the beacon lights (`beaconLit`). Wren then gets one heart shard,
  the beacon becomes a checkpoint, and a column of light rises into the sky in the beacon's color.
- **The trials:**
  1. **Cliffwatch Beacon (climb and glide).** Climb the Ashen Cliffs to the beacon, then glide through 6 lantern rings
     on the way down to a lit brazier on the beach in 75 s. If you touch the ground before the last ring, the trial
     fails. Rising warm air columns at the cliff top push the glider up 6 m/s.
  2. **Thornring Beacon (combat).** In a ring of thorns in Whisperwood, beat 3 waves: 4 bramblings; then 2 bramblings,
     1 mossback and 1 wisp; then 2 mossbacks and 2 wisps. Landmarks requests each wave with `spawn` events
     (group `trial-1`) and counts `enemyDied`. If Wren dies or leaves the ring (r 26 m), the trial fails, and the trial
     sends `despawnGroup`.
  3. **Drowned Beacon (blocks and plates).** In the drowned ruin, 3 stone blocks (2 m cubes, tag `pushable`) sit on a
     grid with 3 pressure plates. Each block slides 2 m per push (0.5 s, no diagonals) and stops at walls. When all 3
     plates are covered, the water gate opens and the beacon stair rises. A lever resets the blocks. One plate is
     under 1.2 m of water, so you have to push a block into the water.
  4. **Windward Beacon (archery).** On the windy north bluff, hit 8 targets in 60 s. The targets are on poles, and
     some of them swing. Hitting the last 2 targets takes a glide shot, because they face the cliff. Landmarks
     exposes the targets as `Prop`s, and combat reports `propHit`.
- **Spire:** once all 4 beacons are lit, the violet barrier dome around the summit cracks and falls (`barrierDown`).
  The path up Mt. Cinder has 2 camps and a climb of 40 m. In the summit arena (flat, r 34 m), the Warden wakes
  (`bossWake`).
- **Ending:** the Gloam lifts. The sky shifts from violet to dawn gold. The UI shows the ending page: an illuminated
  manuscript page, written as a short closing text. It lists the play time, the glimmers found and the heart shards
  found. Then the player can explore freely.
- **Rest:** at the shrine or at any lit beacon, press **use** and choose "Rest". This heals Wren fully, saves the game
  and respawns the enemy camps. Wren can rest until morning (06:00) or until evening (18:00).
- **Death:** "The lantern gutters". Wren respawns at the checkpoint (the shrine, or the last lit beacon) with full
  hearts. Glimmers are kept.
- **Save:** saving is automatic. The game saves every 90 s (not during a trial), on rest, on `beaconLit`, on
  `bossDefeated` and on `pagehide`. Save data is in localStorage `hollowmere.save.v1` (`SaveData`).

## 3. World map

Units are meters. North is −z, and east is +x. The island is centered on (0, 0), with a coast radius of about 560 m
(±40 m of noise). Sea level is y = 0.

```
                 N (-z)
        Windward Beacon (-140,-430)
                     ·             Sunken Lake (230,-300) r95, water 34
   Whisperwood        ·  ▲            Drowned Beacon (250,-330)
   (-330,-150) r190   Mt. Cinder (0,-40) peak 190
   Thornring (-360,-190)  Gloam Spire on the summit
W                                         Ashen Cliffs  x 330..400, z 20..220, top 95   E
         river ~~~                        Cliffwatch Beacon (420,150)
   Mirebrook Ruin (-250,170)
      ~~~ river mouth (-500,420)
                Hollow Shrine (-60,380)  ← start, faces north
                 S (+z)
```

| Landmark | x, z | Area r | Flat r | Height / notes |
| --- | --- | --- | --- | --- |
| Hollow Shrine | −60, 380 | 45 | 22 | glade in a bowl, about 14 m; ring of standing stones, rest altar |
| Mirebrook Ruin | −250, 170 | 70 | 40 | about 10 m; river village ruin, 2 bridges, bow chest in the mill |
| Whisperwood | −330, −150 | 170 | — | rolling, 20–45 m; dense trees, darker grass, low fog |
| Thornring Beacon | −360, −190 | 35 | 26 | arena ring of thorn walls (tag `solid`) |
| Ashen Cliffs | wall from (330, 20) to (400, 220) | 120 | — | base 12, top plateau 95; grey ash rock, ledges every 8–12 m |
| Cliffwatch Beacon | 420, 150 | 30 | 16 | on the cliff-top plateau at 95 |
| Sunken Lake | 230, −300 | 110 | — | bowl, water surface 34, 9 m deep; ruins stick out of the water |
| Drowned Beacon | 250, −330 | 30 | 18 | island ruin in the lake, causeway from the south shore |
| Windward Beacon | −140, −430 | 35 | 20 | north bluff at about 70 m, sea cliffs below |
| Mt. Cinder | 0, −40 | 230 | — | cone with base r 260, peak 190; ash and scree above 120 |
| Gloam Spire | 0, −40 | 40 | 34 | summit arena at 190; spire tower 60 m tall, barrier dome r 38 |

- **River:** 6 points from the mountain flank (−60, 80) to the sea at (−500, 420). It widens from 6 to 24 m. The water
  surface is the bed + 1.2 m, so you can wade across most of it. It is deeper (swim) below the ruin.
- **Biomes** (`World.biomeAt`): `beach` (below 4 m near the coast), `meadow` (default), `forest` (Whisperwood disc),
  `ash` (cliffs and the mountain above 120 m), `highland` (above 60 m elsewhere), `lakeshore` (within 20 m of the lake),
  `summit`, `sea`.
- **Surfaces** (`World.surfaceAt`): footsteps and particles use these. `rock` covers slopes over 40°, `sand` covers
  beaches, and `stone`/`wood` cover landmark boxes.
- **Collectibles** (owner: landmarks):
  - 120 glimmers, in clusters of 3 to 5. The clusters sit on rooftops, ledges and cliff tops, and at the ends of glide
    lines.
  - 12 heart shards. Each of the 4 beacons gives 1. The other 8 are hidden: under the Shrine waterfall, at the top of
    the mill, in the hollow oak of Whisperwood, on the cliff-face ledge at 60 m, in a lake-floor chest (swim down),
    on the summit of the north bluff stack, on a sea stack at the river mouth, and in a ruin on the mountain flank.
  - 4 arrow bundles of +10 near the camps.
  - Every collectible has a stable id, such as `glimmer-12` or `shard-oak`.
- **Enemy camps:** `CAMPS` in contracts.ts. Each camp spawns within 120 m of Wren and sleeps beyond 160 m. A killed camp
  respawns when Wren rests, or after 12 real minutes. Night camps (`night: true`) spawn only between 20:00 and 05:00.

## 4. Player (Wren)

Wren is a young lantern-bearer in a hooded teal cloak. The lantern hangs on the hip. The model is built from about
14 primitives: hood, cloak (a cone with vertex sway), torso, arms and legs. Wren is 1.7 m tall, and the capsule
radius is 0.35 m.

| Action | Number |
| --- | --- |
| walk / run / sprint | 3.0 / 6.0 / 9.0 m/s (stick under 0.5 = walk) |
| jump | 7.2 m/s up with gravity 22, so about 1.18 m high; 0.12 s of coyote time and 0.12 s of jump buffer |
| step up / walkable slope | 0.45 m / normal.y ≥ 0.75 (about 41°) |
| climb | 1.8 m/s on any face steeper than 50° or a box tagged `climbable`/`solid`. **jump** = climb-jump of 3.2 m (0.2 stamina). **dodge** = let go. Rain multiplies the climb cost by 1.5. |
| glide | opens with **glide**, or **jump** in mid-air when at least 2.5 m above the ground: 8.5 m/s forward, 2.0 m/s sink, 0.06 stamina/s. Updrafts push it up 6 m/s. |
| swim | 2.6 m/s (sprint 4.4 at 0.16 stamina/s); 0.05 stamina/s while moving. At 0 stamina Wren drowns: lose 2 quarter hearts and respawn at `lastSafe`. |
| stamina | 1 ring = 1.0. Regen 0.4/s after a 0.6 s delay. At 0, Wren is exhausted: no sprint or climb until the ring is full again (the ring turns rubric red). |
| sprint / dodge / spin cost | 0.18/s, 0.12, 0.30 |
| fall damage | impact over 13 m/s costs 1 quarter heart per 2.2 m/s over (a 10 m drop is about 21 m/s, so 3 quarters). Opening the glider removes it. |
| hearts | starts at 3 hearts (12 quarters), maximum 12 hearts; 4 shards = +1 heart, then a full heal |
| i-frames | 0.9 s after a hurt; dodge roll: 0.32 s i-frames, 0.45 s long, 4.2 m |

**Sword combo:** damage 10 / 10 / 16. Wind-up 0.08 / 0.08 / 0.14 s. Recovery 0.28 / 0.28 / 0.42 s. Reach 2.0 m, arc
126°. Press again inside the recovery window to chain the next hit. **Hold attack** for 0.8 s to charge (the ember
glows, `chargeReady`). Release it for a spin attack: 360°, reach 2.6 m, 26 damage. A sword hit causes 0.06 s of
hitstop.

**Shield:** hold block. It blocks hits from the front 120° and takes no damage. A hit inside the first 0.18 s of
raising the shield is a **parry**: the enemy is stunned for 1.4 s, and the next attack is a riposte for 30 damage.
Wren moves at walk speed while the shield is up.

**Bow:** hold bow to draw (0.55 s to full, 0.25 s minimum). The camera moves over the shoulder. Release to shoot. The
arrow flies at 28 to 60 m/s with arrow gravity 9 and does 8 to 18 damage. Drawing in mid-air slows time to 0.5×. Wren
can carry at most 30 arrows.

**Lock-on:** the lock button picks the enemy nearest the screen center within 30 m with line of sight. The lock drops
beyond 40 m or when the enemy dies. While locked, Wren strafes and faces the target, and dodge rolls to the side.

## 5. Enemies

| | Brambling | Mossback | Wisp archer | Gloam Warden |
| --- | --- | --- | --- | --- |
| look | knee-high plant goblin, leaf ears, twig limbs, red berry eyes | 2.6 m hunched brute with a mossy boulder shell and stone fists | floating hooded flame, violet core, paper-lantern body | 6 m tall armored shade with a crown of broken lanterns and a cloak of violet smoke |
| hp | 30 | 120 | 40 | 600 (3 phases) |
| damage (quarter hearts) | 2 | 6 (slam knocks Wren down) | 3 (bolt) | 4 to 8 |
| patrol / chase speed (m/s) | 2.2 / 6.6 | 1.4 / 3.4 | 2.0 / 4.0 (float 2 to 4 m up) | 2.4 / 5.0 |
| sight / leash (m) | 18 / 40 | 16 / 35 | 32 / 50 | arena |
| reach | 1.4 m swipe | 2.6 m overhead slam (AoE r 2.5) | keeps 12 to 18 m away, shoots a bolt at 16 m/s | 4 m sweeps |
| wind-up / cooldown (s) | 0.35 / 1.0 | 0.9 / 2.2 | 0.8 / 2.6 | 0.75 / 1.6 |
| behavior | packs circle Wren, one attacks at a time (attack token), hops back after a swipe | slow; a shield block shoves Wren 3 m; its back shell takes ×0.5 damage, a hit from behind ×1.5 | drifts sideways and flees when Wren closes in; one arrow puts it out (×2 arrow damage) | see below |
| glimmers dropped | 3 | 10 | 6 | 100 |

**Shared AI:** idle/patrol → alert (a "!" ink flourish, `enemyAlert`, 0.5 s) → chase → wind-up (the body glows
violet, `enemyWindup`) → attack → recover. Parried enemies are stunned. At most 2 enemies attack Wren at once (attack
tokens). Enemies beyond `QualityPreset.enemyLodDist` animate at 10 Hz. Dead enemies dissolve into violet motes over
1.2 s.

**Gloam Warden:**
- **Phase 1 (100–66%):** a 3-hit sword chain (the 3rd hit is a delayed overhead you can parry), a lunge, and a ground
  slam shockwave ring that you jump over.
- **Phase 2 (66–33%):** adds a lantern volley of 5 homing bolts (you can block them, and a parried bolt flies back for
  20 damage). It summons 3 bramblings once.
- **Phase 3 (33–0%):** faster, with wind-ups ×0.8. It adds a spire beam that sweeps the arena (dodge through it, or
  glide over it from the arena pillars). The weak point is its crown: 4 arrow hits to the crown stagger it for 4 s.

Each phase change takes 2 s: the Warden roars (`bossPhase`), the camera pulls back, and the arena edge flares. The boss
bar reads "The Gloam Warden".

## 6. World systems

- **Day and night:** one full day lasts 960 s (16 min). The game starts at 07:30.
  - Sunrise is 05:00–07:00 and sunset is 17:30–19:30.
  - `daylight` is 0 at night, 1 at noon, and smooth in between.
  - At night: the sky is deep teal and stars come out, a moon gives cold light (sunDir follows the moon), the lantern
    light gets stronger (radius 9 m), fireflies appear, night camps spawn, and the music switches to the night layer.
  - `dawn` and `dusk` events fire at 06:00 and 18:00.
- **Weather:** every 3 in-game hours, roll for weather: 60% clear, 20% cloudy, 15% rain, 5% storm.
  - Rain lasts 2 to 4 real minutes, and `rain` fades in and out over 20 s.
  - Rain darkens and wets surfaces (`wet`), shows streaks and ground splashes, makes climbing cost ×1.5, and turns up
    the rain ambience.
  - A storm adds `thunder` (a flash first, then sound after distance/343 s) and stronger wind gusts.
- **Wind:** `env.wind` is a 1 to 6 m/s xz vector that turns slowly. Grass, trees, cloak, glider and particles follow
  it.
- **Grass:** instanced blades, up to 24 per m² next to the camera, thinning out to `grassDist`. They bend away from
  Wren (`uPlayerPos`), and sword swings cut them (leaf particles).
- **Trees:** 4 species. Round oak (meadow), tall pine (highland), twisted willow (river and lake) and gloom-birch
  (Whisperwood). Within `treeDetailDist`, trees use full instanced meshes. Beyond it, they use camera-facing impostor
  cards out to `treeDist`. Trunk colliders are tagged `tree`.
- **Water:** sea, lake and river use a cel water shader: shallow to deep color by depth, white ink foam lines at the
  shore, gentle normal waves (`water` ≥ 1), and refraction on high and above. Swimming starts when the water is deeper
  than 1.1 m.
- **Particles:** one pool and one draw call (`Fx`). Kinds: dust, spark, leaf, splash, ember, glimmer, gloam, heal,
  sap, rain-splash, beacon.

## 7. Art direction — "illuminated manuscript meets watercolor"

**3D look:**
- Soft cel shading in 3 bands (`Look.toon`).
- A warm rim light (`uRimColor`).
- A painterly sky gradient with watercolor cloud cards.
- Ink outlines found in screen space from depth (and normals on high and above), in ink brown `#2b2118`, never black.
  The lines get thinner with distance.
- A faint paper grain and a watercolor edge darkening in post.
- Distant terrain fades into fog that matches the sky color at the horizon.
- No PBR shine. Specular shows only on water and wet surfaces.

**Palette (CSS tokens in globals.css; 3D colors in the second table):**

| Token | Hex | Use |
| --- | --- | --- |
| parchment / -hi / -lo | #efe3c8 / #f8f0dd / #d8c49c | menu pages, HUD text |
| ink / ink-soft / ink-faint | #2b2118 / #5a4a3a / rgb(43 33 24 / .35) | text, borders, outlines |
| gold / -hi / -lo | #c9a13b / #e8c766 / #8f6d22 | gold leaf: frames, beacons, selected items, compass |
| night / night-deep | #0f2e33 / #08191c | page background, night sky top |
| teal / mist | #1f5a5e / #8fb9b3 | Wren's cloak, water, secondary UI |
| ember / -hi / -lo | #f08a3c / #ffc07a / #b4511e | lantern, hearts, stamina, primary call to action |
| rubric | #b8402b | damage, low health, exhaustion (rubrication red) |
| moss | #6f8a4a | grass UI accents |
| gloam / -hi | #5b3a6e / #a47cc6 | enemies, barrier, boss bar |

| 3D material | Hex |
| --- | --- |
| grass near / far | #8fae5a / #a9c26a |
| forest floor | #4d6b3a |
| rock / ash rock | #8d8473 / #6b625a |
| sand / dirt | #e0cc98 / #9c7b55 |
| water shallow / deep / foam | #6fc2b4 / #1c4f5c / #f8f0dd |
| foliage | #4f7a3a, #6f9a46, #8fae4c, gloom-birch #3f5a4a |
| sky day top / horizon | #7fb3c9 / #f3e2bf |
| sky dusk top / horizon | #3c4f7a / #e48a5b |
| sky night top / horizon | #08191c / #1f5a5e |
| Wren cloak / tunic / lantern | #2f5f5a / #c9a77a / #f08a3c |

**Fonts** (`next/font/google`, set in layout.tsx):
- Display: **Cormorant Garamond** (500/600/700 + italic), as `font-display`. Use it for titles, area banners and
  numbers.
- UI: **Manrope** (400–700), as `font-ui`. Use it for labels, settings and small text.
- Root font size scales with the viewport (see globals.css). Size every UI element in rem.

**Menus look like illuminated pages:**
- A parchment card with a 2 px gold border and an inset ink hairline.
- A drop-cap initial in gold leaf with a small vine flourish.
- Ink-drawn corner ornaments, drawn as inline SVG paths that "draw on" with a stroke-dashoffset animation (300 ms).
- Buttons are ink-filled bars with parchment text. Focus and hover show a gold underline flourish.
- The title screen is the live island at dawn, with a slow camera drift, and the title card at the left third.
- Pages: Title (Begin / Continue / Settings / Credits), Pause (Resume / Map / Settings / Controls / Quit to title),
  Map, Settings, Controls, Death, Ending.

**HUD (minimal; everything fades out after 4 s idle in calm exploration):**
- **Hearts:** a row of small lantern flames at the top left. Each flame burns in quarters. The last heart flickers
  rubric red.
- **Stamina:** a thin gold ring (a 28 px SVG arc) beside Wren's shoulder. It follows Wren every frame through
  `HudFrame.staminaAt`, is hidden when full, and turns rubric red when exhausted.
- **Compass ribbon:** at the top center, 40% of the width. It shows a parchment strip with N/E/S/W letters and tick
  marks. Beacon markers are small flames: grey when unlit, colored when lit. Once the stage is `spire`, it also shows
  the spire marker.
- **Top right:** glimmer count (a gold diamond and a number), and the arrow count when Wren has the bow.
- **Bottom center:** a contextual prompt ("Rest", "Open", "Read", "Climb"), with the button glyph for the current
  device.
- **Area banner:** a big italic display line with a gold rule under it, shown for 2.5 s on `areaEnter`.
- **Trial panel:** the trial name and progress (`trial`), with a timer for timed trials.
- **Boss bar:** a long gloam bar at the bottom with the name in small caps.
- **Lock-on reticle:** 4 gold ink brackets around the target.
- **Damage:** a rubric vignette pulse (`damageFlash`).
- **Desktop vs phone:**
  - On phones (landscape), the HUD scale is ×1.15. The compass becomes 55% wide. Prompts move above the touch
    buttons. The objective line is hidden; it shows in the pause menu instead.
  - Everything respects the safe-area insets.
  - A portrait phone shows only a "Turn your device sideways" page.

## 8. Controls

| Action | Keyboard + mouse | Gamepad (standard) | Touch |
| --- | --- | --- | --- |
| move | WASD / arrows | left stick | left virtual stick (floating, appears where the thumb lands in the left 40%) |
| camera | mouse (pointer lock after the first click; without lock, drag) | right stick | drag anywhere on the right half that is not a button |
| sprint | hold Shift | hold B | push the stick past 95% for 0.4 s, or double-tap the stick |
| jump / climb-jump | Space | A | jump button |
| glide | G, or Space in mid-air | A in mid-air | glide button (shows when airborne) |
| attack / charge | LMB or J (hold to charge) | X (hold) | sword button (hold) |
| block / parry | RMB or K | LT | shield button (hold) |
| dodge roll | L or Ctrl | B tap | roll button |
| bow | F or MMB (hold, release) | RT (hold, release) | bow button: hold to aim, drag to aim, release to shoot |
| lock-on | Q or Tab | RB | lock button |
| use / interact | E | Y | hand button (only with a prompt) |
| map | M | View | map icon at the top right |
| pause | Esc or P | Menu | pause icon at the top right |

- Touch buttons are 64 px circles (× `touchScale`). They sit in an arc at the bottom right:
  - sword, the largest, at the corner;
  - jump above it;
  - roll to its left;
  - shield further left;
  - bow and lock above jump.
- The buttons have a parchment fill at 55% opacity and an ink glyph.
- Rumble: hurt 0.6 / 0.2 s, parry 0.4 / 0.1 s, boss slam 1.0 / 0.4 s.
- Pointer lock is optional. The game must play fully without it (headless tests, Safari quirks).

## 9. Audio (Web Audio synthesis only)

- **Score:** an original modal theme in D Dorian at 72 BPM. Instruments: a plucked lute (Karplus-Strong), a soft
  wooden flute (a filtered triangle wave with breath noise) and a low drone. The score has layers that crossfade over
  2 s:
  - **exploration:** day; sparse phrases with long rests;
  - **night:** an Aeolian variant with only flute and bells;
  - **combat:** frame drum and a fast pulse, added when an alerted enemy is within 25 m;
  - **boss:** 3 intensities, one per phase;
  - **trial:** a ticking motif;
  - **beacon lit:** a rising 5-note fanfare.
  The menu has its own title theme.
- **Ambience:**
  - wind (filtered noise that follows `env.wind`);
  - birds by day (chirp synthesis, a few each minute);
  - crickets at night;
  - water lapping near the water;
  - a river hiss near the river;
  - rain beds (light and heavy);
  - thunder.
- **SFX:**
  - footsteps by surface;
  - jump, land, glide flap;
  - sword swish ×3 and the charge hum;
  - spin, shield block thunk, parry ring;
  - bow draw creak, arrow release, arrow hit;
  - enemy alert, enemy wind-up, enemy hurt, enemy death;
  - pickup chimes (glimmer, shard, heart);
  - plate click, block grind;
  - trial start and trial fail;
  - beacon roar;
  - the Warden's roar.
- **Mix:** the master, music and sfx volumes come from Settings. Catch every error inside the audio module.

## 10. Performance and quality

The targets are 60 fps on laptops and 30+ fps on phones.

- `detectQuality(platform)` picks the start preset:
  - `low` for a weak GPU or a phone;
  - `medium` for other touch devices or integrated GPUs;
  - `high` for Apple M-series and discrete GPUs;
  - `ultra` only when the player picks it.
- Dynamic resolution keeps a 1 s average of the frame time. It lowers `renderScale` by 0.05 when the average is over
  the target by 10%, and raises it by 0.05 after 3 s under the target by 25%. The scale stays inside
  `[minScale, maxScale]`.

| Field | low | medium | high | ultra |
| --- | --- | --- | --- | --- |
| pixel ratio cap | 1 | 1.25 | 1.5 | 2 |
| dyn-res scale range | 0.5–1 | 0.6–1 | 0.7–1 | 0.8–1 |
| shadows (map / extent) | off (blob) | 1024 / 40 m | 2048 / 60 m | 4096 / 80 m |
| ink outline | depth, half res | depth | depth + normals | depth + normals |
| bloom | no | no | yes | yes |
| draw distance / fog | 420 / 120–400 | 650 / 180–620 | 900 / 260–880 | 1300 / 360–1250 |
| terrain LOD switches (m) | 80/160/280 | 110/220/400 | 150/300/550 | 200/400/750 |
| grass density / distance | 0.2 / 30 m | 0.4 / 45 m | 0.7 / 65 m | 1 / 90 m |
| trees (impostor beyond / cull) | 45 / 260 | 70 / 420 | 100 / 650 | 150 / 1000 |
| rocks | 140 | 220 | 320 | 450 |
| water | flat | waves + foam | + refraction | + refraction |
| particles / rain drops | 256 / 1200 | 512 / 2500 | 1024 / 5000 | 2048 / 9000 |
| enemy full-rate animation | 40 m | 60 m | 90 m | 140 m |

- **Terrain:**
  - 20 × 20 chunks of 64 m.
  - LOD 0 has 64×64 quads per chunk, LOD 1 32×32, LOD 2 16×16 and LOD 3 8×8.
  - Skirts hide the cracks between LOD levels.
  - Each chunk is culled by distance and the frustum.
  - The heightmap is sampled once at load into a Float32Array of 1281² samples (1 m grid). `heightAt` interpolates it
    bilinearly.
- **Draw calls:** the budget is under 150 on medium.
  - Merge static landmark geometry per material.
  - All vegetation is instanced.
  - All particles are in one pool.
- **Frame loop:** no allocations in the frame loop. Clamp dt to 1/30 s.

## 11. Labs and testing

- Each owner builds a lab at `src/app/lab/<owner>/page.tsx` that mounts only its modules plus mocks from `mock.ts`.
- The dev handle `window.__hm` (dev only) exposes:
  - `ctx`: the live FrameCtx;
  - `game`;
  - `render`;
  - `quest`;
  - `teleport(x, z)`;
  - `emit(event)`.
- Use it in playwright-core scripts to read state and to jump to landmarks.
- Check every change with `npx tsc --noEmit`, then a playwright-core run with screenshots. Look at the screenshots
  yourself.
