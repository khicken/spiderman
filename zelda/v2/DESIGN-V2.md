# HOLLOWMERE v2 design

This is the build spec for v2. Builders implement it in parallel tracks (see `TRACKS.md`). Numbers that code reads
live in `src/app/contracts.ts`. When this file and contracts.ts disagree, contracts.ts wins and the integrator fixes
this file.

Sources: `v2/audit-design.md`, `audit-mechanics.md`, `audit-audio.md`, `audit-graphics.md`, `audit-playtest.md`,
`copy-rule.md`, the repo-level `GAME-DESIGN.md` and `AGENTS.md`.

Fixed decisions (not open for debate): WebGL2 and GLSL only, no WebGPU. The ink outline pass is removed. Recorded CC0
instruments and SFX. One lantern mechanic: Thread. All player text follows `copy-rule.md`. Original IP only.

---

## 1. Pillars and names

**What v2 must feel like:** you wake at dawn holding a small living lantern. Within 30 seconds you know where to go.
Within 2 minutes you have ridden a line of fire across a valley. Every place you look has a small light that pulls
you toward it.

Pillars:
1. **One clear goal on screen at all times.** One tracked target, shown as a marker, a compass pip and a distance.
2. **One verb that is ours.** Thread links two things with a line of fire. Movement, puzzles and combat all use it.
3. **Teach by doing, never by reading.** A control appears as a chip the first time the world asks for it. Never a
   wall of text.
4. **Something every 30-60 seconds.** Along any path there is a secret, a glimmer trail or a view every ~120 m.
5. **Warm light against cool shade.** Gold light is good and sacred. Bruised violet is the gloam.
6. **Quiet, real sound.** Recorded instruments, real foley, and silence between music cues.

### One name per thing (use these everywhere: HUD, journal, toasts, map, prompts)

| Thing | Name | Never |
| --- | --- | --- |
| Player | Wren | lantern-bearer |
| Lantern companion | Tallow | the flame, the spirit |
| Signature power | Thread | Emberthread, ember line, tether (except the Tether use name) |
| Thread charges | wick (shown as pips) | flames, embers |
| Fixed point you can thread | knot | anchor, rune |
| Fire bowl | brazier | flame, fire, altar |
| Health unit | heart | flame, ember |
| Heart piece | heart shard | — |
| Big objective tower | beacon | flame, fire |
| Fast-travel stone | waystone | shrine, rune stone |
| Respawn point | beacon, waystone or shrine | last flame |
| Currency | glimmers | — |
| Stamina | stamina (ring by the hero) | breath, will |
| Challenge at a beacon | trial | — |
| Corruption | gloam | darkness, rot |
| Mentor at the Glade waystone | Oriel the Ferrier | — |
| Cat spirit in Mirebrook | Mulberry | — |
| Boss | the Gloam Warden | — |

---

## 2. The first 10 minutes

Spawn is the Hollow Shrine at (-60, 380), at 05:30 (`START_HOUR 5.5`). The first day runs at half speed
(`FIRST_DAY_SCALE 0.5`) until the first main beacon is lit or 25 minutes pass, so dusk cannot come before ~17 minutes.
Positions come from `PROLOGUE` in contracts.ts.

Rules for this section:
- Only one chip at a time. A chip is 3 words or fewer, sits bottom-center, shows once, and fades after the player does
  the action (or after 8 s, then it returns once after 20 s of not doing it).
- The objective line (top-left) never goes blank.
- No enemy can aggro within `TELL.questStartSafeR` (45 m) of the prologue path.
- The pause menu is never needed.

### Timeline

| Time | What the player sees and hears | Goal shown | Control taught |
| --- | --- | --- | --- |
| 0:00 | Black. A single harp note, then the shrine pool fades in. Wren lies on the steps. Tallow (a small lantern) sputters awake beside her and floats up into her hand. Cine is skippable after 1 s (any key). | none yet | — |
| 0:04 | Camera swings behind Wren. Tallow chirps, a 3-note rising call. Ahead, 30 m north, the gate brazier smolders with a gold glint. | — | — |
| 0:06 | Objective fades in. Compass pip on the brazier, distance in meters. | **Light the brazier at the gate** | Chip: **Move** (WASD / left stick / touch pad) |
| 0:10 | Player walks. If no input for 5 s, Tallow drifts 2 m toward the brazier and back. | same | Chip: **Look** after first move, only if the camera has not been turned |
| 0:15 | At 3 m from the brazier, prompt shows. | same | Prompt: **E Light** |
| 0:16 | Wren holds Tallow to the bowl. Fire roars up. Tallow brightens and two gold wick pips appear by the hearts. Sting: "beacon" short, -18 LUFS. | — | — |
| 0:18 | Vista cine, 3 s, skippable: camera rises over the gate. The `VIEW_CUTS` gap shows a cold stone beacon in a glade 110 m north, and Mt. Cinder with the Gloam Spire far beyond. A row of small ember stones glows on the path. | — | — |
| 0:22 | Control returns. | **Light the Glade Beacon** / sub: **Follow the ember stones** | — |
| 0:30 | **Success check: the player knows the goal.** Marker on the glade beacon, compass pip, "112 m". | same | — |
| 0:40 | The sun clears the ridge to the east. Long gold light, violet shade. The explore theme's first phrase starts (harp and flute). | same | — |
| 0:45 | Stepping stones over a shallow rill (0.4 m deep, gaps 2.4 m, 4 stones). Falling in costs nothing. | same | Chip: **Jump** (Space / A / touch jump) |
| 0:55 | A 1.2 m ledge across the path. Wren vaults it at a run (vault 0.45-1.3 m). | same | none (vault is automatic) |
| 1:05 | A glimmer trail of 8 glimmers curves left to a small view rock. Picking one up gives a soft chime that climbs the scale. | same | none |
| 1:15 | A 6 m climb rock blocks the path. Handholds are lit gold. | same | Chip: **Climb** (walk into the wall). The stamina ring appears for the first time. |
| 1:28 | Top of the rock. A carved knot glows on top (knot A, y 6.6). 26 m north and 5 m lower stands knot B. | same | — |
| 1:30 | Aiming at knot B shows a gold dotted line from Tallow to it. | same | Chip: **R Thread** |
| 1:33 | Player presses R twice (knot A, then knot B). A line of fire draws between them with a rising pluck. | same | — |
| 1:36 | Standing at the line. | same | Chip: **Jump to ride** |
| 1:40 | Wren hangs from Tallow and slides 26 m down the line, cloak flapping, music lifts one step. Lands with a roll in the glade. | — | — |
| 1:45 | Arena pan, 2.5 s, skippable: the cold Glade Beacon, three stone rooms around it. Trial rule card. | **Light the Glade Beacon** / sub: **Clear the 3 rooms** | — |
| 2:00 | **Success check: core moves done** (move, look, jump, climb, thread, ride). | | |
| 2:00-2:40 | Room 1, Pull (see 5.1). | sub: **Pull the block onto the plate** | Chip: **Thread block to post** once |
| 2:40-3:40 | Room 2, Fight. Two bramblings. | sub: **Defeat the bramblings** | Chips: **Click Strike** (J also works), then **Right mouse Shield**. The third chip is **Thread it to the fire**. |
| 3:40-4:30 | Room 3, Carry. Thread the lit room brazier to the cold beacon bowl. | sub: **Bring fire to the beacon** | none (the player now knows Thread) |
| 4:30 | The beacon roars alight. A gold shaft rises. Region color washes outward 40 m. Reward: heart shard, Journal unlocked. Sting: trial done. | toast **Glade Beacon lit** / **You got a heart shard (1/4)** | — |
| 4:40 | Oriel the Ferrier waits at the Glade Waystone. She speaks 3 short lines (see 8). The waystone activates. The map opens on the island once. | **Light the 4 beacons (0/4). Next: Cliffwatch, east** | Chip: **M Map** |
| 5:00-9:00 | An ember path (`EMBER_PATHS[0]`) leads east. Every ~120 m there is a reward: a chime tree (0:5:30), a knot shortcut over a gully (6:15), a fox spirit to a chest with Wick Oil (7:00), a lore stone (7:40), the Ashen Waystone (8:20). | same | Chip: **Shift Sprint** at the first long straight (5:05) |
| ~9:00 | Cliffwatch pedestal. | same | — |
| ≤10:00 | **Success check: first main trial reached without the pause menu.** | | |

### Fallbacks

- No move after 10 s: Tallow says "Walk to the brazier." with an arrow from Tallow to it.
- Off the ember path by more than 40 m during the prologue: the compass pip pulses and Tallow says "The beacon is
  that way."
- Fails the ride 3 times: knot B moves to a spot 2 m lower and the chip returns.
- Stuck in a Glade room for 90 s: Tallow gives the room's one-line hint (listed in 5.1).

---

## 3. Thread (the signature mechanic)

**In 3 lines:** press R on one thing, then R on another, and a line of fire joins them. What the line does depends on
the pair: knot to knot you ride it, block to post you pull it, enemy to enemy you bind them, enemy to a lit brazier you
burn it. Each line costs one wick pip, lasts 12 s, and holding R pulls every line back.

### Controls

| Action | Keyboard and mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Pin end 1 / end 2 | R (tap) | LB | Lantern button |
| Recall all lines | hold R 0.4 s | hold LB | hold lantern button |
| Ride a line | Jump while within 1.2 m of it | A | Jump |
| Drop off a ride | Jump | A | Jump |

### Aim

- The target is the anchor nearest the screen center inside a 0.14 rad cone (`aimCone`), within 18 m (`range`, 30 m
  with the Long power).
- Soft snap: anchors within 2.5 m (`aimSnapR`) of the aim ray are picked even outside the cone.
- On a valid target, a gold dotted preview line runs from Tallow to the anchor and the anchor rings gold.
- Invalid target: the preview is grey and a tiny label says **Too far** or **Can't link those**.
- Pending end 1 waits 6 s (`pendingLife`). If no second pin is made, it fizzles with a soft puff and refunds the pip.

### Anchors

| Kind | Weight | Examples |
| --- | --- | --- |
| knot | fixed | carved stone knots on rocks, trees, ruins |
| brazier | fixed | fire bowls, lit or cold |
| lamp | fixed | village lamp posts, shrine lamps |
| block | 1-3 | stone blocks, crates, logs |
| float | 1 | drifting lilies and buoys on water |
| enemy | by enemy (brambling 1, wisp 1, mossback 3) | living enemies |
| target | fixed | archery and switch targets |
| chain | fixed | gate chains and drawbridges |

### What a pair does

| End 1 | End 2 | Use | Rule |
| --- | --- | --- | --- |
| knot | knot | Ride | Jump onto the line to slide along it. Speed 10 m/s, up to 16 m/s downhill, accel 9. Uphill only up to slope 0.44, at 5 m/s, costing 0.15 stamina/s. Exit gives a 1.0 m/s boost. Max length 40 m. A ridden line does not age. |
| block or float | knot, brazier, lamp or chain | Pull | The movable end slides toward the fixed end at 3 / 2 / 1.2 m/s for weight 1 / 2 / 3. It stops 1.5 m short. Weight 3 needs the Heavy power. |
| chain | knot | Pull | Pulls a gate or drawbridge open. |
| enemy | enemy | Bind | Both yank toward each other at 6 m/s, collide for 8 damage, and stagger for 2 s. |
| enemy | knot, lamp, block | Tether | The enemy cannot move more than the line's length from the anchor. Stagger 1 s on link. |
| any | lit brazier | Burn | Fire runs along the line. An enemy end burns 6 per s for 4 s. Brambles, blight and webs burn away in 1 s. A cold brazier, lamp or beacon bowl at the other end lights. |
| lit brazier | cold brazier, lamp or bowl | Carry | Same as Burn: fire crosses in 0.8 s (`carrySecs`) and lights it. |
| anything | the same anchor, or two fixed anchors that are not knots | none | Shows **Can't link those**. No pip spent. |

### Wick (charges)

- Start with 2 pips (`wickStart`). Wick Oil upgrades raise it to 5 (`wickMax`).
- A pip is spent when a line forms. It returns when the line ends (life 12 s, recall, or the anchor breaks).
- Lines in use show as hollow pips.
- At night and in the gloam, a line glows brighter but rules do not change.

### Powers (one from each main beacon, `BEACON_POWER`)

| Beacon | Power | Effect |
| --- | --- | --- |
| Cliffwatch | Long Thread | range 30 m |
| Thornring | Burning Thread | every line burns, no brazier needed, 2 s per line |
| Drowned | Heavy Thread | can pull weight 3 |
| Windward | Thread Arrow | an arrow that hits a knot or target pins end 1 there |

### Feel

- Pin: a short pluck, rising pitch for end 2, and a gold spark at the anchor.
- Line: a slightly sagging, flickering ribbon with embers dropping off it. The color is gold, and in the gloam it has a
  violet core.
- Ride: Tallow hangs from the line, Wren hangs from Tallow. Wind rush rises with speed. The camera pulls to 6.5 m.
- Fizzle: a puff of smoke and a dull tap.

---

## 4. World layout

The island is about 1 km across. Spawn is in the north. Mt. Cinder and the Gloam Spire sit at the center, visible from
everywhere.

### Rules

- The first beacon trial (Glade) is 112 m from the gate and ~140 m from spawn, reached at ~1:45.
- Every beacon has a tall light shaft once lit, and a cold grey silhouette with a gold glint before. Both are visible
  from 400 m.
- Every main beacon has a waystone within 80 m of its pedestal.
- An ember path (glowing stones every 8 m) runs from the Glade or Mirebrook to each beacon (`EMBER_PATHS`). The path
  for the tracked beacon glows; the others are dim.
- Reward spacing: one secret every ~120 m along every path, cycling the 6 kinds below. About 40 secrets on the island.
- Camps are kept 45 m from pedestals, waystones and the prologue path (`TELL.questStartSafeR`).
- Lamp posts are decor colliders (`ColliderTag "decor"`), never climbable.

### Places

| Place | Where | Role |
| --- | --- | --- |
| Hollow Shrine | (-60, 380) | Spawn, cold open. Respawn before any beacon is lit. |
| Gate brazier | (-60, 350) | First thing to light. |
| Glade Beacon | (-35, 240) | Tutorial trial, 3 rooms. |
| Glade Waystone | (-58, 226) | Oriel. First fast-travel point. |
| Mirebrook Ruin | (-250, 170) | Village, Mulberry, the mill with the bow. |
| Whisperwood | (-330, -150) | Forest. Thornring beacon. |
| Ashen Cliffs | (370, 110) | Cliffwatch beacon. |
| Sunken Lake | (230, -300) | Drowned beacon. |
| Windward Bluff | (-140, -430) | Windward beacon. |
| Mt. Cinder and Gloam Spire | (0, -40) | Final climb and boss. Barrier until 4 beacons are lit. |

### Suggested order and guidance

After the Glade, the tracked target goes to Cliffwatch (east, nearest, teaches glide). After each beacon the next
target is the nearest unlit one, with Windward last because it needs the bow from Mirebrook. The player can change the
tracked target on the map at any time (`GameV2.track`).

### Secret kinds

| Kind | What it is | Reward |
| --- | --- | --- |
| Glimmer trail | 8 glimmers curving to an odd spot | glimmers plus what is at the end |
| Knot shortcut | a knot pair that skips a climb | time |
| Spirit critter | a fox, heron or moth spirit; follow it to a dig spot | chest |
| Chime tree | hit it to play 3 notes; match a nearby bell stone's phrase | heart shard or Wick Oil |
| Gloam blight | violet patch with 2 enemies; burn it with a thread to a brazier | color returns in 30 m, glimmers |
| Lore stone | a carved stone with 2 lines of lore | journal entry |

---

## 5. Trials

Each trial has three parts: a **teach** room that shows the idea with no fail state, a **test** that uses it under
light pressure, and an optional **bonus** that rewards mastery. Every trial shows its rule as a card on start
(`trialRule` event). Failing a test resets only that part.

### 5.1 Glade Beacon (tutorial, ~3 min)

| Part | Layout | Rule shown | Hint after 90 s |
| --- | --- | --- | --- |
| Pull (teach) | A weight-1 block, a knot post, a pressure plate between them | Pull the block onto the plate | "Thread the block, then the post." |
| Fight (test) | 2 bramblings released when the plate sinks. A lit brazier in the room. | Defeat the bramblings | "Thread a brambling to the fire." |
| Carry (finale) | The room brazier and the cold beacon bowl, 14 m apart | Bring fire to the beacon | "Thread the fire to the beacon." |
| Bonus | 3 glimmer rings over the glade, reachable from a knot pair on the rim | none shown | — |

Reward: heart shard, Journal. Lit state: `gladeLit`.

### 5.2 Cliffwatch (climb and glide)

- Teach: a short wall with a ledge, then a 10 m drop with the **G Glide** chip (press G in the air).
- Test: ride two knot lines up the cliff face, climb the last 12 m, glide across the gap to the beacon. No timer.
- Bonus: 6 updraft rings on the descent. Optional. Reward: 50 glimmers.
- Reward: heart shard, Long Thread, memory 1.

### 5.3 Thornring (combat)

- Teach: a mossback alone in a ring. Its slam has a 1.0 s windup with a 0.15 s freeze at the top. Chip **Shield on
  the glint** teaches the parry (shield is right mouse or K).
- Test: 2 waves. Wave 1 is 3 bramblings. Wave 2 is 2 bramblings and a wisp. Burning and binding are shown by the
  layout (a brazier in the middle, enemies arriving in pairs).
- Bonus: clear wave 2 without taking damage. Reward: Wick Oil.
- Reward: heart shard, Burning Thread, memory 2.

### 5.4 Drowned (block puzzle)

- Teach: one block, one plate, one post.
- Test: three plates in a flooded court. Floats carry blocks across water. Solvable in at most 6 pulls. The offline
  solver (T5) must prove it.
- Bonus: a fourth plate under a heavy block, solvable only after Heavy Thread is earned (return visit).
- Reward: heart shard, Heavy Thread, memory 3.

### 5.5 Windward (bow)

- Needs the bow from the Mirebrook mill. Without it, the pedestal says **You need a bow. Find it in the Mirebrook mill.**
- Teach: three still targets at 10 m.
- Test: targets on swinging chains, then a gap with no knot on the far side. Shoot a target there, then thread to it
  to make the bridge.
- Bonus: 3 targets hit in one glide. Reward: Wick Oil.
- Reward: heart shard, Thread Arrow, memory 4.

---

## 6. Movement and camera

All numbers in `PLAYER` and `CAMERA` in contracts.ts.

- Jump: 1.3 m full jump. Release within 0.08 s to cut to ~0.65 m. Fall gravity x1.35.
- Coyote time and jump buffer: 0.15 s each.
- Start ease 0.2 s. Skid when turning more than 135 degrees above 4.5 m/s, lasting 0.18 s, then relaunch at 70%.
- Sprint turns at 7 rad/s with a 0.22 rad lean.
- Vault: automatic for ledges 0.45-1.3 m at a run, 0.3 s, keeps 80% speed. Mantle up to 2.2 m in 0.45 s.
- Climb at 2.0 m/s, climb jump 2.6 m. Walls must be at least 0.6 m wide. Stamina drains 0.08/s. At 15% stamina a last
  gasp; at zero Wren hangs for 0.6 s before letting go. Ledge catch reach 0.6 m.
- Glide: forward 9 m/s. Flare (pull back) trades 5 m/s for 1.2 m height. Dive to 16 m/s, then climb 3 m on pull-up.
  Bank 0.44 rad. A glide prompt appears at 14 m/s fall speed with 8 m to fall.
- Fall damage starts at 6.5 m. A roll within 0.15 s of landing removes it.
- Swim: dash 1.2 s for 0.2 stamina. Treading costs 0.02/s.
- Dodge: i-frames from 0.05 to 0.35 s, recover 0.1 s, cooldown 0.25 s. With no direction it is a 2.2 m backstep.
- Camera: 5.2 m behind (5.8 sprinting, 7 climbing, 6.5 gliding or riding). Auto-follow after 1.6 s of no mouse input
  or 0.6 s of no stick. Q or middle mouse recenters in 0.25 s when there is no lock target. Minimum distance 0.9 m;
  the camera pushes through foliage instead of colliding.

---

## 7. Combat and enemies

### Wren's sword (numbers in `SWORD`)

| Step | Startup | Active | Recovery | Damage | Knockback | Hitstop (attacker and victim only) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.12 s | 0.06 s | 0.22 s | 10 | 5 m/s | 0.05 s |
| 2 | 0.10 s | 0.06 s | 0.22 s | 10 | 5 m/s | 0.05 s |
| 3 | 0.20 s | 0.09 s | 0.45 s | 16 | 8 m/s | 0.09 s |

- Chain by pressing in the last 0.25 s of recovery (buffered 0.15 s). A press in the last 0.08 s gives +20% damage.
- Charge 0.8 s for a spin: 26 damage, 2.6 m reach.
- Shield blocks the front 120 degrees fully. Parry: raise the shield within 0.18 s (0.22 s on touch) of the hit.
  A parry stuns for 1.4 s, slows the world to 40% for 0.35 s (Wren stays full speed), and opens a 30-damage riposte.
- Hurt: 0.3 s. A big hit is 0.9 s, cancellable by dodge after 0.5 s. Hitstop on Wren is at most 0.05 s.

### Telegraphs (`TELL`)

Every enemy attack shows a pose, a sound and a gold glint on the weapon 0.15 s before the hit frame. The glint means
"shield or dodge now". At most 2 enemies attack Wren at once (attack tokens, 0.4 s cooldown).

### Enemies (numbers in `ENEMY`)

| Enemy | HP | Damage (quarter hearts) | Windup | Notes | Thread weakness |
| --- | --- | --- | --- | --- | --- |
| Brambling | 30 | 2 | 0.5 s | Fast lunge, chase 6 m/s. Comes in groups. | Burns in 1 s; bind two together. |
| Wisp | 40 | 3 | 0.8 s | Shoots bolts from 18 m. Hovers. | Tether it to a knot to pull it down. |
| Mossback | 120 | 6 | 1.0 s + 0.15 s freeze | Slow slam, 2.6 m reach. Parry teacher. | Too heavy to pull; burn its moss. |
| Gloam Warden | 600 | 6 | 0.75 s | Boss, 3 phases at 66% and 33%. | See 8. |

Camps respawn after rest or 12 real minutes. Night camps appear only at night.

---

## 8. Story, boss and ending

- Tallow was once a great fire that lit ships home. Its keeper carried it; when the water rose, the keeper chose the
  lamp over the boat. To survive, Tallow gave the keeper's name to the dark. That keeper became the Gloam Warden.
- Each main beacon returns one memory (journal page and a 6 s cine with Tallow's line):
  1. Cliffwatch: "I was bigger once. I lit ships home."
  2. Thornring: "Someone carried me. Someone kind."
  3. Drowned: "The water rose. They chose the lamp over the boat."
  4. Windward: "Their name was... I gave it to the dark."
- Oriel's 3 lines at the Glade Waystone (plain, they guide): "Four beacons ring the mountain." / "Light them and the
  Spire barrier falls." / "Touch a waystone to travel back here."
- The Warden: phase 1 sword and shield duels; phase 2 adds gloam bolts and summons 2 bramblings; phase 3 the arena
  floods with gloam and the Warden pins its own threads to the 4 arena braziers, which Wren must cut by burning them.
- Ending choice (`endingChoice`): **Keep Tallow** (Tallow stays as your lantern; post-game free roam with night
  wisps) or **Return Tallow to the sky** (Tallow becomes a fifth beacon over the Spire; the island turns to permanent
  golden hour). Both unlock free roam. Copy for the choice: "Keep Tallow" / "Return Tallow to the sky".
- Tallow's line bank: ~60 lines, 8 words or fewer, 45 s cooldown between idle lines. Guide lines are plain. Jokes only
  in idle and ambient lines.

---

## 9. Progression and upgrades

| Thing | Start | Max | How |
| --- | --- | --- | --- |
| Hearts | 3 | 9 | 4 heart shards = +1 heart. 24 shards on the island: 5 from beacons, 19 from secrets and the shop. |
| Stamina rings | 1 | 2 | Ember Seed from Mulberry for 300 glimmers (one seed only). |
| Wick pips | 2 | 5 | 3 Wick Oil: Cliffwatch path chest, Thornring bonus, Windward bonus, and one in a chime-tree secret (4 exist, 3 needed). |
| Thread powers | none | 4 | One per main beacon (section 3). |
| Bow | none | 1 | Mirebrook mill. |

Glimmers buy from Mulberry in Mirebrook: heart shard (2, 200 each), Ember Seed (300), arrows (20 for 10).

---

## 10. HUD and all strings

### Layout (desktop; phone moves touch controls to the bottom corners and keeps the same slots)

- **Top-left:** objective line and one sub-line. Below it, toasts stack (max 2, 3 s each).
- **Top-center:** compass strip. Tracked target is a gold pip with distance in meters. Other known beacons are grey
  pips. Waystones are small blue diamonds. 
- **Top-right:** hearts row, then wick pips under it.
- **Beside the hero:** stamina ring, shown only when stamina is used or below full.
- **Bottom-center:** one chip at a time.
- **Bottom-right:** glimmer count (shown for 3 s on change), arrows when the bow is out.
- **On the world:** the tracked marker (diamond with distance), interact prompt over the thing (glyph + verb),
  Tallow's subtitle at the lantern's screen point.
- Nothing else. No minimap. The map opens with M.

### Objective table

| State | Objective | Sub-line |
| --- | --- | --- |
| prologue wake/gate | Light the brazier at the gate | — |
| prologue vista to ride | Light the Glade Beacon | Follow the ember stones |
| glade trial | Light the Glade Beacon | Clear the 3 rooms (room sub-line replaces this) |
| beacons 0-3 lit, no bow, next is Windward | Light the 4 beacons (n/4). Next: Windward, south | Find the bow in the Mirebrook mill (west) |
| beacons 0-3 lit | Light the 4 beacons (n/4). Next: <Beacon>, <direction> | — |
| barrier down | Climb Mt. Cinder to the Gloam Spire (center) | — |
| boss | Defeat the Gloam Warden | — |
| done | Main quest done. Explore the island | — |

### Chips (`HintId`, each shown once)

| Id | Desktop | Gamepad | Touch |
| --- | --- | --- | --- |
| move | WASD Move | Left stick Move | Drag Move |
| look | Mouse Look | Right stick Look | Drag Look |
| use | E Light (or E + verb) | Y + verb | Hand + verb |
| jump | Space Jump | A Jump | Jump |
| climb | Walk into wall | Push into wall | Push into wall |
| thread | R Thread | LB Thread | Lantern Thread |
| ride | Jump to ride | A to ride | Jump to ride |
| attack | Click Strike | X Strike | Sword Strike |
| block | Right mouse Shield | LT Shield | Shield |
| parry | Shield on the glint | LT on the glint | Shield on the glint |
| dodge | C Dodge | B Dodge | Dodge |
| sprint | Shift Sprint | Hold B Sprint | Double-tap Sprint |
| glide | G Glide | A in air Glide | Glide |
| lock | Q Lock on | RB Lock on | Tap enemy |
| bow | Hold F Aim | Hold RT Aim | Hold Bow |
| map | M Map | View Map | Map |
| journal | Esc Journal | Menu Journal | Pause Journal |
| recall | Hold R Recall | Hold LB Recall | Hold Lantern Recall |

### Toasts and screens

| Event | Line 1 | Line 2 |
| --- | --- | --- |
| beacon lit | <Beacon> lit | You got a heart shard (n/4) |
| power | New power: <Power> | <one-line effect, e.g. "Threads reach 30 m"> |
| trial start | Trial started | <rule, e.g. "Defeat 2 waves"> |
| trial done | Trial complete | — |
| trial failed | Trial failed | Press E at the pedestal to retry |
| heart shard | Heart shard (n/4) | 4 shards = +1 heart |
| new heart | +1 heart | Hearts refilled |
| wick oil | Wick Oil | +1 wick |
| ember seed | Ember Seed | +1 stamina ring |
| bow | Bow | Hold F to aim, release to shoot |
| waystone | <Name> Waystone | Travel here from the map |
| travel | Traveled to <Name> Waystone | — |
| rest | Rested | Hearts refilled. Game saved. |
| save | Game saved | — |
| barrier | The Spire barrier is gone | Climb Mt. Cinder to the Spire |
| boss | The Gloam Warden | Boss |
| boss phase | Warden phase 2 (or 3) | New attacks |
| time | Dawn / Dusk | — |
| rain | Rain | Climbing uses more stamina |
| storm | Storm | — |
| memory | Memory found (n/4) | Open the journal to read it |
| thread fail | Too far / Can't link those | — (small, at the aim point) |
| death | You fell | Respawning at <checkpoint name>. Button: Continue |
| secret | Secret found (n/40) | — |

Journal shows: hearts and shards (n/24), Wick Oil (n/3), powers, memories (n/4), secrets (n/40). The journal must
count 24 shards, not 36 (v1 bug).

Map: M opens and M closes (v1 bug). Click a beacon or waystone to track it. Click a lit waystone and press
**Travel** to fast travel.

---

## 11. Performance budgets

Measured on the scripted flyover route and the Glade fight, with GPU timer queries (`EXT_disjoint_timer_query_webgl2`)
per pass. Numbers per frame, 95th percentile.

| Preset | Target | Draw calls | Triangles | GPU ms total | AA | Max pixels | FPS cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| low (phones) | 60 fps | ≤90 | ≤150k | ≤11 | FXAA | 1.1 M | 60 |
| medium | 60 fps | ≤160 | ≤400k | ≤12 | SMAA | 2.1 M | 60 |
| high | 60+ fps | ≤220 | ≤900k | ≤9 on the reference desktop | MSAA 4x | 3.7 M | off |
| ultra | 60+ fps | ≤300 | ≤1.8 M | ≤12 on the reference desktop | MSAA 4x | 8.3 M | off |

Per-pass budget on low: shadow 0 (baked canopy map), opaque 5 ms, grass 1.5 ms, water 1 ms, sky 0.5 ms, particles
0.8 ms, post (FXAA, grade, fake glow) 1.5 ms.

Frame governor (`FRAME_GOVERNOR`): idle (no input 20 s) caps at 30 fps; paused at 10 fps; hidden tab renders nothing.
Dynamic resolution drops 0.05 scale after 3 s below 55 fps and raises 0.05 after 6 s above 59 fps, inside the preset's
max pixels.

Rules: the ink outline pass is gone. A thin hero and enemy outline (inverted hull, faded out by 25 m) only on medium
and up. The hero is at most 4 draw calls. Grass is masked out of everything but the main pass. All particles are one
pool, one draw.

---

## 12. Art direction and graphics fix list

**One sentence:** a hand-painted illuminated manuscript you can walk into: warm gold light, cool violet-blue shade,
deep ink shapes, and the land breathing small sparks of light.

- Two-temperature light: gold sun, blue-violet shade, never grey-green.
- Value masses: each frame has one dark mass, one light mass and one gold accent.
- Gold leaf is magic: runes become gilded amber `#f1c45a` on ink `#3a2a1c`, dormant bronze `#8a6a3a`, active core
  `#fff1b8`. The cyan rune `#7fe0d0` goes away.
- Gloam: bruised violet-black with green-gold edges, smoky sprites, never a flat lavender sphere.
- Palette per hour: use the table in `audit-graphics.md` section 3 (night, dawn 5.8, morning, noon, golden, dusk, blue
  hour). Blend keys, never snap.

Ranked fix list (owner track in brackets):
1. Rebalance light: ambient 0.75 sky / 0.55 ground, ramp 0.28 / 0.62 / 1.0, shade tinted to `cShade`. Shared
   `hmShadow(worldPos)`: real shadow map on medium and up, baked 512² canopy shadow map on low. [T2]
2. Terrain, foliage and grass call `hmShadow`, with canopy AO, grass color patches and gust brightening. [T2, T1 for grass cost]
3. Sky: remove posterize, smooth 3-stop gradient with Mie glow, 12-20 painted cloud cards in one instanced draw,
   spherical cirrus, new moon. [T3]
4. New palette keys with fog tint and a blue-hour key; blend on time and weather. [T2]
5. Height fog and aerial perspective; fix the dark sea-horizon band. [T2]
6. Trees: 6-8 seeded crown variants per species, spherical normals, leaf-card fringe, Poisson placement, hero trees,
   wind sway. [T2]
7. Blue-noise near fade instead of IGN dither, only for trees between camera and hero. [T2]
8. Post: remove ink pass, add AA per preset, half-res sun shafts on medium and up, fake glow sprites on low. [T1]
9. Particles: gold motes, spirit wisps, warm fireflies, smoky gloam, sword smear, hit flash, footstep puffs. [T3]
10. Landmarks: gold-leaf runes, rebuilt Cliffs strata, Cinder plume and crater glow, obsidian Spire, bramble-arch
    Thornring, shrine arch with waterfall, village smoke and lamps. [T4 geometry, T2 shared palette]
11. Water: smoothed shore depth, river color, flow sparkle, noise foam, wet sand, waterfall ribbon. [T3]
12. Hero: 5.5 heads, ovoid head, face mask with almond eyes, open hood with swaying tip, flared cloak with warm lining,
    clean steel sword with a gold guard. Merged into at most 4 draws. [T14]
13. Camera: min distance and push through foliage. [T7]
14. Enemies: bark brambling, gloam wisp, mossy mossback, hit-flash uniform. [T8]
15. Rock: break the stripe repeat, warm lit and violet shade, ember cracks near Cinder. [T2]
16. Flowers: crossed painted cards in color patches. [T1, inside nature-grass.ts]
17. Rain: wet sheen, puddles, streaks, heavy cloud cards, rainbow after rain. [T3]

Geometry light shafts (additive cone cards with motes) at the shrine and in forests on all presets. They are the
single most magical element on phones. [T3]

---

## 13. Audio direction and mix

**Direction:** small chamber ensemble, recorded, never synth. Silence between cues. Each region has its own mode and
lead instrument, all sharing one theme.

### Theme: "The Hollow Light"

- D Lydian, 3/4, 84 BPM. Opening leap A up to F# (a major sixth), rhythm cell long-short-short-long.
- 8 bars, peak in bar 5. Original: the melody must pass the originality guard in the music script (no 5-note run
  matching a known theme list).
- First heard at 0:40 (sunrise) on harp and flute. Full statement when the Glade Beacon is lit.

### Regions

| Region | Mode | Lead | Notes |
| --- | --- | --- | --- |
| Shrine and Glade | D Lydian | harp, flute | theme home |
| Mirebrook | Dorian, 6/8 | psaltery, recorder | village |
| Whisperwood | Dorian add9 | kalimba, violin canon | |
| Sunken Lake | Lydian, 60 BPM | glockenspiel, vibes, harp | |
| Ashen Cliffs | Mixolydian | horn, cello | theme interval inverted |
| Cinder and Spire | Phrygian | timpani, low strings | Eb-D pull |
| Trials | trial ostinato | — | climbs one step per goal |
| Night | Dorian | ocarina | within 1.5 dB of day |

- Silence gaps of 30-90 s between explore cues.
- Combat: layers C0 / C1 / C2, metric modulation 84 to 112 BPM, +2 to +4 LU over explore.
- Boss: Phrygian; phase 3 in 7/8.
- Stings at -18 LUFS ±1: beacon, discovery, trial done, rest, death, victory.
- Transitions land on the phrase grid, with pickups, tails and pivot chords. No hard cuts.

### Sources and rules

- Instruments: VSCO-2-CE and VCSL (CC0), rendered to OGG in `public/music/`.
- SFX and ambience: Freesound CC0 and Kenney CC0 in `public/sfx/`. Sonniss is not allowed (it forbids redistribution).
- `public/sfx/CREDITS.md` and `public/music/CREDITS.md`: one line per clip with source URL and license, verified.
- One sample loader (`audio-samples.ts`). Several takes per sound; never the same take twice in a row. All variants of
  one sound from one source.
- Synthesis only for UI cues (D Lydian pentatonic) and magic (Thread pluck and hum). Test scripts count
  `OscillatorNode.start` per state; music must use zero.
- Voice (optional): Oriel's 3 lines and Tallow's memory lines via Chatterbox, -16 LUFS mono 24 kHz in `public/voice/`.
  Tallow's other lines are a wordless chirp plus subtitle.

### Mix targets (`MIX`)

| Bus or state | Target |
| --- | --- |
| Full mix, integrated | -18 to -16 LUFS, true peak ≤ -1 dBFS |
| Music explore / combat / boss | -24 / -21 / -20 LUFS |
| Stings | -18 |
| Voice | -18 |
| Ambience day / night | -30 / -31 |
| Footsteps | -30 |
| Swing / hit | -20 / -17 |
| UI | -26 |

Ducking: voice ducks music 8 dB and ambience 4 dB; stings duck music 6-10 dB; impacts duck 3 dB; combat ducks ambience
6 dB. 3D: HRTF within 30 m, air absorption beyond. Occlusion checked every 125 ms: -6 dB and a 1.2 kHz low-pass.
Reverb IRs: 0.8 s (open), 1.4 s (forest), 2.6 s (ruin), 3.8 s (cave and Spire). High-pass music at 35 Hz and SFX at
30 Hz. `level-check.mjs` fails when any state is more than 2 LU off target.

---

## 14. Success tests

| Test | Pass when | How |
| --- | --- | --- |
| Goal known in 30 s | Objective, marker and compass pip for the brazier are on screen by 0:06, and the Glade Beacon goal by 0:22 | Scripted run reads HUD text at 0:30 (T6) |
| Core moves in 2 min | move, look, jump, climb, thread and ride all performed by 2:00 on the scripted route, and a blind tester does them by 2:30 | Scripted route plus one blind tester log (T6) |
| First main trial in 10 min | Cliffwatch pedestal reached by 10:00, pause menu never opened | Blind tester log (T6) |
| Phone 60 fps | Low preset, phone viewport, 95th percentile frame ≤16.7 ms on the reference phone and ≤11 ms GPU in the emulated run | T1 perf script |
| No synth music | 0 `OscillatorNode.start` in music; UI and magic only | T11 and T12 offline scripts |
| Mix on target | Every state within 2 LU | `level-check.mjs` (T12) |
| Plain copy | Copy audit script finds no banned words (flame for heart, wakes, gutters, rekindle, ember for beacon) in player strings | T6 copy-audit script |
| Every audit bug fixed | Bug ledger all closed | T13 |
| Drowned solvable | Solver finds a solution in ≤6 pulls | T5 offline solver |

---

## 15. Open questions (for the user)

1. Voice: Chatterbox voice for Oriel and Tallow's memory lines, or chirp plus subtitles only?
2. Ending choice "Keep Tallow" or "Return Tallow to the sky": keep it?
3. Which phone is the 60 fps reference device?
4. The cold open is at dawn, not night. OK?
5. In-game name "Thread" or "Emberthread"? This spec uses "Thread".
