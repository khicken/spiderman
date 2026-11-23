# HOLLOWMERE v2: design audit and proposal

Branch `zelda-v2`. Written by the lead design pass on 2026-11-22.
Sources: `DESIGN.md`, `src/app/contracts.ts`, `game.ts`, `state.ts`, `landmarks.ts`, `landmark-*.ts`, `ui-*.tsx`.
I also played the opening twice in Chromium (Metal ANGLE, 1280x720) through playwright-core.
The coordinator asked me to stop early because the owner's GPU was overloaded. So I played about 4 minutes on foot and
used `__hm.teleport` to visit every beacon. I did not play a full 10 minutes in real time.
The screenshots are in the session scratchpad, not in the repo.

Owner feedback this answers:
- "It is unclear what needs to happen."
- "We start by doing what? The player has no idea what to do."
- "Make it feel more magical, seamless and unique."

Every proposal is original IP. There are no names, items, places, music or set pieces from any existing game. We borrow
only genre craft: teach through space, pull the eye, reward curiosity often.

---

## Part 1. Audit

### 1.1 What I saw when I played

| Time | What happened | Evidence |
| --- | --- | --- |
| 0:00 | The title screen is strong. It shows a live island, the dark Spire on the mountain, and the "Wake the four beacons." tagline. | `01-title.png` |
| 0:02 | **New Journey** drops you straight into play. There is no cut, no camera move and no line of story. Wren stands on a path between lamp posts. Trees block the view of the mountain. | `03-first-frame.png` |
| 0:02 | The only guidance is one italic line: "Leave the Hollow Shrine and head out into Hollowmere". The compass shows "802 M" under N with no readable icon. The unlit beacon flame is grey on parchment, so you cannot see it. | `03-first-frame.png` |
| 0:05–0:30 | Run 1: I turned the camera and walked forward. Wren walked into a path lamp post and went into **climb** mode. Wren stayed stuck on the post for 26 s, at the same position the whole time. Every `solid` box can be climbed, and that includes thin lamp posts. | `10-sprint-18s.png`, `11-walk-26s.png`, log `mode:"climb"` |
| 0:10 | Run 2: I faced north and walked out. After about 60 m the objective changed to "Wake the four beacons (0/4)". There was no sound, no banner and no beat. | log at 28 s |
| 0:45 | Outside the shrine, the scene is a meadow of grass. No beacon, light or landmark shows on screen. | `06-after-leave.png` |
| 0:45–1:30 | I sprinted 40 s toward the nearest beacon (Cliffwatch, 526 m). I collected **0 glimmers** and met nothing to find. A grey cliff showed up at about 300 m. | log `gl:0`; `11-to-cliff-27s.png` |
| Thornring | Hostile camps ate one heart on arrival. "Begin trial" started 4 bramblings at once. Wren died within about 9 s while idle. The death text says "Rise again at the last flame you lit" when no flame has been lit. | `17`, `19-wood-trial-9s.png` |
| Windward | Pressing **use** with no bow showed no visible feedback in the HUD sample. The gate is a toast you can miss. | `bluff-no-bow` |
| Pause | The journal is the clearest screen in the game. It names all 4 trials. But the player has to open it to learn any of that. It shows "Heart shards 0/36", while only 12 shards exist. | `14-pause-journal.png` |
| Map | Pressing M a second time did not close the book. Time of day stayed frozen until I clicked Resume. | log `tod` frozen at 8.55 |

### 1.2 Diagnosis by topic

**The opening.**
- No cold open exists. `ui-app.tsx` `begin()` goes from the loading screen straight to play. `game.ts` starts at `stage:"awaken"`.
- The story lives only in DESIGN.md and in 5 lore stones. The player never learns who Wren is, what the Gloam is, or why the beacons matter.
- The shrine is a bowl of trees. Its exit and the mountain are not framed.

**The first goal.**
- "Leave the Hollow Shrine" is a non-goal. It fires on `dist > 45 m` (`game.ts:223`), so it finishes by accident.
- The next goal is to wake four beacons with no order. The nearest is 526 m away, and none of them can be seen.
- Choice without information is not freedom. It is paralysis. That is the root of "the player has no idea what to do".

**How the controls are taught.**
- They are not taught. The game has no prompt for move, camera, jump, climb, glide, attack, block, dodge or lock. Controls live only in a pause tab.
- Glide, parry, charge spin, climb-jump and the mid-air bow slow-mo are deep verbs that most players will never find.

**Visual guidance.**
- The beacon column of light exists only once a beacon is lit (`landmark-beacon.ts` sets `column.visible = false` when unlit). The goals are invisible until you finish them, which is the wrong way round.
- Beacon sites draw only within 260 m (`SITE_DRAW` in `landmarks.ts`). Only the Spire stays visible from anywhere.
- No paths connect the places. The only path is the short lamp-lit walk in the shrine.
- The compass flame markers are tiny and grey while unlit.

**Reward pacing.**
- 120 glimmers sit in clusters at landmarks. Glimmers buy nothing: the code has no shop and no use for them.
- The first real reward, a heart shard, comes only after you finish a whole trial or find a hidden spot.
- I ran 40 s across open meadow and found nothing. DESIGN pillar 2 says there is something every 60–90 m. That promise is not kept between landmarks.

**Density.**
- The landmarks are rich: the village, the hollow oak, the drowned ruins and the shrine waterfall.
- The 300–500 m between them is grass, trees and flowers.

**Clarity of objectives.**
- The objective line never changes as you move: it reads "(0/4)" for the whole beacon stage.
- No line answers "where" or "what next". The bow hint appears only once a beacon is lit (`state.ts:98`), after the player may already have walked to Windward and been refused.

**How the 4 trials are introduced.**
- The only introduction is a pedestal labeled "Begin trial". The trial's rules appear only in the journal text (`ui-store BEACON_TRIALS`).
- Cliffwatch is a 75 s ring course. The game has never taught glide or updrafts.
- Thornring throws 3 waves at a player who has never been taught to block.
- Drowned is a Sokoban puzzle that needs **19 pushes** (`landmark-trial-lake.ts` header). That is far too long for a browser game, and it does not reward exploration.
- Windward is gated by a bow in a chest the player has no reason to visit.
- The 4 trials share no common mechanic. They feel like 4 minigames, not one game's identity.

**Story.**
- The premise is solid ("the Gloam sleeps while the beacons burn") but invisible.
- There are no characters besides Wren, no voice, no stakes shown on screen and no change in the world as you progress. Only the sky columns change.

**Emotional hook.**
- Nothing to care about. There is no one to save and no one with you. The lantern is the game's symbol ("A lantern in the dark") but does nothing in play: it is a hip light.

**Bugs that hurt the first minute:**
- Climbable lamp posts, a 0.24 m box at the spawn path, trap the player.
- The "0/36" heart shard count is wrong.
- The death text refers to a flame that was never lit.
- Pressing M does not close the map.

### 1.3 What to keep

The art direction, the illuminated-book UI (the journal and map pages are lovely), Wren's moveset, the day and night
cycle, weather, the village and the secret sites, the combat numbers, the Warden fight and the audio system are all good.
v2 is a **design and structure pass**, not a rewrite.

---

## Part 2. v2 design proposal

### 2.1 The hook in one line

> The Gloam is drinking the island's light. The last flame of the old keepers lives in Wren's lantern, and it is going
> out. Carry it to the four beacons before it does.

The companion is **Tallow**, a small flame-spirit who lives in the lantern.
- Tallow is curious and a little vain. Tallow talks in short lines (8 words or fewer) and remembers nothing at the start.
- Each beacon gives back one memory.
- The stakes are personal and visible. Tallow's flame (the lantern glow) is dim and blue-violet at the start. It grows warmer and brighter with every beacon.
- The player is not saving "the world". The player is keeping a friend alive.

### 2.2 The signature mechanic: the **Emberthread**

The lantern can spin out a thread of living light. Wren pins one end to a point, pins the other end to a second point,
and the thread pulls taut between them. **One verb, three uses:**

| Use | What it does |
| --- | --- |
| **Traversal: ride it** | A thread from a high point to a lower one is a slide line. Jump on and Wren slides down hanging from the lantern. Threads can be pinned only to **wick-knots**: small brass rings with an ember glow, set in the world on cliff tops, tree crowns and ruins. The rule is readable: if you see a wick-knot, there is a line to ride. |
| **Puzzles: pull it** | A thread pinned to a movable thing (a block, a lantern-float, a drawbridge, a bell) and to a fixed knot pulls the lighter one toward the heavier one. A thread between two braziers carries fire, so you can light one from the other. Light flowing along a thread opens Gloam-sealed doors. |
| **Combat: bind it** | Pin a thread to an enemy, then to a second enemy or a wall. The thread yanks them together and staggers both (2 s). Pin a thread to an enemy and then to a lit brazier, and the enemy catches fire (damage over time, and it burns brambles away). Gloam creatures cannot cross a burning thread. A thread becomes a fence. |

Limits keep the mechanic readable:
- **Wick**: a small meter around the lantern icon, with 2 threads at the start.
- Each thread lasts 12 s, or until Wren pins a new one.
- Upgrades give more threads, longer threads and stronger pulls.
- The range at the start is 18 m.

Controls:
- **Thread** is one button: R on keys, LB on a gamepad, a lantern button on touch.
- Press it once to pin the first end where the reticle points. Press it again to pin the second end.
- Hold it to recall all threads.
- While you aim, a soft ember arc previews the line. A pin point snaps to valid targets (knots, blocks, enemies, braziers).

Why it is ours:
- It grows out of the game's own symbol, the lantern.
- It joins traversal, puzzles and combat under one rule: *light connects things*.
- The rule plays out in the story too: the beacons are the island's own threads.

**Size: L.**
- `player.ts`: new mode `thread-ride`, ~250 LOC.
- New `thread.ts`: thread sim, pins, tension and render (instanced tube or ribbon), ~450 LOC.
- `combat.ts`: bind and burn, ~120 LOC.
- `input*.ts`: new `thread` button, ~60 LOC.
- `contracts.ts`:
  - `Btn` `thread`;
  - new events `threadPin`, `threadCut`, `threadRide`;
  - `ColliderTag` `knot`;
  - `Prop.kind`.
- `landmark-kit.ts` `reg.knot()`: ~40 LOC.
- `audio-sfx.ts`: thread pluck, hum and snap, ~60 LOC.

### 2.3 Cold open and the first 10 minutes, beat by beat

The rule: **every verb is taught by a space that needs it, and only one verb at a time.**
- On-screen text is a glyph chip of 3 words or fewer, shown only until the player first uses that verb.
- Tallow's lines carry the "why".

| t | Camera | The player sees | The player does | The player learns | Text and Tallow |
| --- | --- | --- | --- | --- | --- |
| 0:00 | Black. Then the camera pulls slowly out of the lantern glass. | It is **night**, not 07:30. Violet Gloam mist covers the shrine floor. Wren is asleep on the altar. The lantern is barely lit. | Nothing (8 s, any key skips). | The mood: dark, cold, and one small warm light. | Tallow (a weak voice-chirp plus subtitle): "...hello? Oh. You're awake. Good." |
| 0:08 | The camera settles behind Wren. One glowing **wick-knot** hangs on the shrine gate, 15 m ahead. Everything else is dim. | The only bright thing is the gate. | Move. | Movement. The eye follows light. | Chip `WASD Move` (gone after 2 m of movement). Tallow: "Go to the glowing ring on the gate." |
| 0:20 | | The gate is sealed by a Gloam film. A cold brazier stands beside it, and the lantern sits on Wren's hip. | Walk up. The prompt reads **"Kindle"**. Press use. | Use, and the fact that the lantern holds fire. | Tallow: "I lit it. The gate is open." The brazier lights, the film burns off, and the shrine **warms in color**. This is the first magic beat. |
| 0:40 | The gate opens onto a **framed vista** cut through the trees. Mt. Cinder sits dead center with the dark Spire on top. **4 cold beacon towers** stand on the horizon, each wrapped in a thin violet **smoke column** you can see from anywhere. | The whole goal in one picture. | Look around. | The camera. The 4 goals. | Chip `Mouse Look` until the player turns 90°. Tallow: "Four beacons. All dark. We must light them." |
| 1:00 | | Stepping stones over a stream, then a 1.2 m ledge. | Jump. | Jump. | Chip `Space Jump` at the first gap only. |
| 1:30 | | A short rock face (6 m) with a glinting glimmer cluster on top. | Climb. | Climb, and stamina (the ring appears with a gentle pulse). | Chip `Climb: walk into the wall`. Glimmers chime as you collect them: the first reward at about 90 s. |
| 2:00 | Wide shot from the top: a wick-knot on this rock, and a second knot on a dead tree 30 m down the slope. | The arc preview shows the line. | **Emberthread**: pin, pin, ride. | The signature verb, taught in a safe space. | Chip `R Thread`. Tallow: "Press R on this ring, then on that tree." |
| 2:30 | | The slide drops you beside a **Gloam Wisp shell** (an easy brambling) guarding a chest. | Attack. Then it winds up, and you block. | Attack, then block. The wind-up glow means "block now". | `LMB Strike`, then `RMB Shield` appears during the first enemy wind-up only. The chest holds a **Wick Oil** (+1 thread). |
| 3:30 | | A second brambling and a lit brazier. | Thread the enemy to the brazier. It burns. | Combat use of the thread. | No chip. Tallow: "Thread the enemy to the fire." (only if 10 s pass without success). |
| 4:30 | | The **Lamplighter's Rest**: a small waystone camp with a friendly spirit NPC, **Oriel the Ferrier**, a moth-spirit who keeps the ferry posts. Oriel gives the journal and marks the nearest beacon. | Talk (use). | The journal, and that NPCs give direction. | Oriel: "Start with Cliffwatch Beacon, east, on the cliffs." The journal opens with a **suggested order** (not forced). |
| 5:30 | | A lantern-lit **ember path** (glowing stones every 15 m) leads east toward Cliffwatch's violet column. Tallow's light leans toward it. | Travel. Sprint. | Sprint, and that the lantern points the way. | Chip `Shift Sprint` once, on the first long straight. |
| 6:00–9:00 | | On the way: a fox spirit that runs to a buried chest, a wind-chime tree (ring it for glimmers), a ruined arch with a wick-knot slide, and a 3-hit lore stone. One small thing every 30–45 s. | Explore or go straight. | The world rewards detours. | No text except item chips. |
| 9:00 | | The base of the Ashen Cliffs. A sheer wall with knots climbing it. The beacon's violet column fills the top of the frame. | Begin the first trial. | — | Tallow: "The beacon is on top. Climb up." |
| 9:30 | Glide is taught on the cliff top, before the trial's final descent (see 2.6). | | | | |

Implementation notes for the opening:
- Move the start from `START_HOUR 7.5` to night (`3.5`), so the first beacon trip ends at dawn. This is a natural "sun rises as you act" beat.
- The vista cut, the stream, the climb rock, the knots and Oriel's rest are new hand-built content in a new file
  `landmark-prologue.ts`.
- The shrine needs to face its exit toward Mt. Cinder: `landmark-shrine.ts` tree clearing plus a `viewCut` flag in `nature-trees.ts`.

### 2.4 Always knowing the next step, without hand-holding

Five layers. Each adds detail only when the previous one is not enough.

1. **The world (always on).**
   - Every unlit beacon has a thin **violet smoke column** that is always visible, like the Spire.
   - When a beacon is lit, it turns into a warm color column, as now.
   - Draw the columns from anywhere: keep them in the `sky` group past `SITE_DRAW`.
   - Ember **paths** of faintly glowing stones link the shrine, the Rest, and each beacon. Paths are the "default route". Leaving them is the "explore" choice.
2. **The lantern pull (always on, subtle).**
   - Tallow's flame leans toward the **current target**: the tracked beacon, or the nearest unread story beat.
   - Embers drift off the lantern in that direction while Wren walks.
   - Zero UI, fully diegetic.
3. **The compass (HUD).**
   - Make the tracked target large and pulsing.
   - Show the other targets small.
   - Unlit beacons are drawn as **violet smoke glyphs**, not grey flames. Lit beacons are warm flames.
   - Add discovered NPCs and shrines as small ink icons.
4. **The objective line (HUD).**
   - Always say *where* and *what*. For example: "Cliffwatch Beacon: climb the Ashen Cliffs (east)".
   - When you arrive, it changes to the trial's own rule ("Ride the threads to the brazier below").
   - Hide it after 6 s of calm. It returns when the objective changes or the player stands still for 10 s.
5. **The journal (pause).**
   - Lists the tracked target, the suggested order, every NPC tip heard, and rumors ("Oriel says a bow rests in the Mirebrook mill").
   - **Track** any entry to retarget the lantern and the compass.

The suggested order (soft, never forced) runs from teach to test:
1. Cliffwatch (traversal);
2. Thornring (combat);
3. Drowned (puzzle);
4. Windward (everything, plus the bow).

Any order still works. Each trial's teaching room makes it self-contained.

### 2.5 Core loop

```
see a column on the horizon → travel along the ember path (find a mini-secret every 30–60 s) → meet a spirit, who gives a tip
→ reach the beacon → the teaching room for this trial's thread use → the trial → the beacon lights:
a memory scene for Tallow, a new lantern power, a heart shard, a warm column, and the region's color returns
→ the lantern turns toward the next target → rest and upgrade at a waystone → repeat
```

Every beacon changes the world visibly:
- The region's grass and sky shift from Gloam-desaturated to full color (`render-look.ts` gets a per-region `gloam`
  saturation uniform).
- Night camps in that region stop spawning.
- A new NPC appears.

### 2.6 The 4 trials, redesigned. Each teaches the thread, then tests it.

Each trial has the same shape:
1. A **teaching room**, safe with no timer. It has one idea and one solution.
2. A **test** that combines that idea with what the player already knows.
3. **One optional "flourish"** for a bonus reward.

| Beacon | Thread facet | Teaching room | Test | Flourish | What changes from v1 |
| --- | --- | --- | --- | --- | --- |
| **Cliffwatch** (east, first) | **Ride.** Chain lines. Glide. | Three knots in a row on the cliff face. Wren rides knot 1 to 2, then pins 2 to 3, all over a soft sandbank. Then the glider: Tallow puffs the cloak open the first time Wren falls more than 4 m ("Spread out!"). | The descent from the beacon to the beach brazier. Chain 5 threads and glide through 3 updrafts. There is no timer. Touching the ground just drops you to the last knot, so the test fails soft. | A ring route through 6 lantern rings in 60 s gives a heart shard. | Drop the hard 75 s fail timer. The rings become optional. Glide is taught here. `landmark-trial-cliff.ts` is refit. M. |
| **Thornring** (west, second) | **Bind and burn.** | A dummy pair of bramblings inside a thorn pen. Bind them together and they stagger. Then a brazier: burn the thorn gate. Parry is taught by a single mossback that telegraphs a slow 1.2 s slam, with the chip `RMB just before it hits`. | 2 waves, not 3: bramblings plus wisps, then a mossback. Braziers ring the arena. Burning threads make temporary walls. | Win without taking damage for a heart shard. | Enemies spawn in sequence (2 at a time), and the nearby camp `wood-2` is moved away from the pedestal. The death text is fixed. `landmark-trial-wood.ts`, `CAMPS`. M. |
| **Drowned** (north-east, third) | **Pull.** Light flow. | Room 1: one block, one plate, one knot. Thread the block to the knot, and it slides. Room 2: a lantern-float on the water. Pull it under a dark lamp, and the light flows along the thread and opens a door. | Room 3: 3 blocks and 3 plates, solvable in **6 moves or fewer**. One plate is underwater: pull a block in from the shore. A reset lever stays. | The floor chest (dive) holds a heart shard. | Replace the 19-push Sokoban puzzle. Keep the courtyard art and plates. `landmark-trial-lake.ts`: rewrite the puzzle data, keep the build. M–L. |
| **Windward** (north, last) | **Thread arrows.** Everything together. | The bow is found **on the critical path**: in Mirebrook mill, which the ember path to Windward passes. Oriel and the journal both say so. A pier range teaches the draw with 3 static targets. | On the bluff, strike 6 targets. Each hit **spins a thread** from the target to the next sea stack, building a light bridge. Cross it and glide-shoot the last 2 targets. | A 45 s run gives a heart shard. | The trial makes a bridge, so it has a reason, not a quota. `canStart` gives a voiced line plus a journal rumor instead of a toast. `landmark-trial-bluff.ts`, `landmark-village.ts`. M. |

Every trial gets:
- **On arrival**: a 3 s camera pan of the whole arena, plus Tallow's one-line rule. The HUD trial panel shows the rule as text until the first progress tick.
- **On success**: the beacon lights.
  - A **memory**: a 4-line illuminated page with an ink vignette.
  - A **lantern power**, from Section 2.8.
  - A **heart shard**.
  - The region regains its color.

### 2.7 Story, light and original

**Cast:**
- **Wren**: silent. Expression comes through animation.
- **Tallow**: the lantern flame. Speaks in short lines. Starts forgetful and anxious. Ends brave.
- **Oriel the Ferrier**: a moth-spirit who keeps the waystones. Gives direction.
- **The Gloam Warden**: the island's last keeper, consumed by the Gloam long ago. Tallow was the Warden's flame.

**The four memories** (one per beacon, each a 4-line page):
1. **Cliffwatch**: "I was bigger once. I lit ships home." Shows that Tallow was a great fire.
2. **Thornring**: "Someone carried me. Someone kind." Shows that Tallow had a keeper before Wren.
3. **Drowned**: "The water rose. They chose the lamp over the boat." Shows that the keeper sacrificed for the light.
4. **Windward**: "Their name was... I gave it to the dark." Shows that the Warden *is* that keeper, and that Tallow left to survive.

This gives the boss a reason to exist and the finale a choice to carry.

**Tallow's line bank.** Lines follow the copy rule in 2.13. Any line that guides the player (where to go, what to
press, what happened) is plain and literal. Jokes and feelings go only in the optional idle and ambient lines below.
- ~60 lines, each 8 words or fewer, triggered by events. Examples:
  - first glide: "We're flying! Are we flying?";
  - low hearts: "I'm flickering. You're flickering.";
  - night: "I'm brighter now. Show-off hour.";
  - rain: "Keep me dry. Please.";
  - idle for 20 s near the target: "It's right there. I can taste it."
- A cooldown of at least 45 s between idle lines.
- Each line is shown as a small ink subtitle at the lantern's screen point, with a synthesized 3-note chirp. There is no voice acting.

**Size:**
- New `companion.ts`: the line bank, triggers and cooldown, ~250 LOC.
- `ui-hud.tsx` subtitle: ~60 LOC.
- `audio-sfx.ts` chirp: ~40 LOC.
- New `ui-memory.tsx` page: ~120 LOC.

### 2.8 World density and the upgrade path

**Spacing rule:** something every 30–60 s of travel (about 150–300 m at sprint, so place one about every 120 m along
paths). It cycles between 6 "mini-secret" kinds. All of them are cheap and re-skinnable per region:

| Kind | What it is | Reward |
| --- | --- | --- |
| Glimmer trail | A curving trail of 8 glimmers leading somewhere odd | Glimmers plus the destination |
| Wick-knot shortcut | A pair of knots that saves a climb | Fun |
| Spirit critter | A fox, heron or moth spirit that runs; follow it to a dig spot | A chest |
| Chime tree / bell stone | Hit it, and notes play; match a 3-note phrase from a nearby one | A heart shard piece or Wick Oil |
| Gloam blight | A violet patch with 2 enemies; burn the blight with a thread to a brazier | It restores color in a small area, plus glimmers |
| Lore stone | As now, but each one also marks one secret on the map | Map knowledge |

**What each region holds (new content in bold):**
- **Shrine and meadow (south).** The prologue run, **Oriel's waystone**, a **chime tree**, and the waterfall shard (exists).
- **Mirebrook (south-west).**
  - The village and the mill bow (exists).
  - A **spirit innkeeper, Mulberry**, who trades glimmers for upgrades. This is the glimmer sink.
  - A **ferry post** for fast travel between waystones.
- **Whisperwood (west).**
  - The hollow oak (exists).
  - **Three Gloam blights**.
  - A **night-only moth grove**, where fireflies form a trail to a shard.
- **Ashen Cliffs (east).** The cliff ledge shard (exists), and a **wick-knot "web" across the cliff face** as a free practice playground.
- **Sunken Lake (north-east).** The drowned ruins (exist), and **lantern-floats** you can thread across the water as stepping stones.
- **Windward bluff (north).** **Sea-stack knots**, and a **kite spirit** who races you down the slope.
- **Mt. Cinder flank.** The ring ruin (exists), and **2 waystones** on the climb to the Spire.

The world needs ~40 mini-secrets in all. Place them by hand with a new `landmark-trail.ts` placer and seeded jitter, with
tables per region. **Size: L** (content-heavy, low risk).

**Waystones** (6 in all, one per region):
- Rest, save, fast travel, and a Tallow upgrade menu.
- Replace "rest only at the shrine or a lit beacon".

**The upgrade path:**

| Track | Source | Steps |
| --- | --- | --- |
| Hearts | 4 shards = 1 heart (as now). 4 from beacons, 8 hidden (exist), 12 new from flourishes and mini-secrets, 24 in all. | 3 → 9 hearts |
| Stamina | **Ember Seeds** from chime trees and blights. 3 seeds = +1/3 of a ring. | 1 → 2 rings |
| Wick (threads) | Wick Oil in chests. Mulberry sells 2 for glimmers. | 2 → 5 threads |
| Lantern powers | One per beacon, and each one is used in the next region. | Cliffwatch: **Long Thread** (18 → 30 m). Thornring: **Burning Thread** (threads burn on their own). Drowned: **Heavy Pull** (move big blocks and drag a mossback). Windward: **Thread Arrow** (arrows carry threads). |
| Glimmers | Spent at Mulberry: Wick Oil, arrow quiver +10, cloak dyes. | — |

Fix the journal count. `SHARD_TOTAL` must count the shards that exist, not the heart slots (`ui-store.ts:100`).

### 2.9 The boss and the ending

**The Warden: keep the 3-phase fight. Retheme it with the thread.**
- **Phase 1:** as now, a sword chain plus a slam. Parry is the core skill.
- **Phase 2:** the Warden chains itself to 4 arena pillars with **Gloam threads**. Burn each chain by threading a pillar brazier to it. Each burnt chain staggers the Warden.
- **Phase 3:** the spire beam sweeps the arena. Wren rides threads between the pillars (set as knots) to dodge, and thread-arrows the crown.
- When the Warden falls, it kneels. The Warden is **not killed**.

**The ending (one choice, no fail state):**
- Tallow says: "I think... they're still in there."
- The player chooses with the lantern:
  - **Thread the Warden to the lantern.** Tallow goes back to its keeper. The Warden becomes a gold flame-shade who lights the Spire. Wren walks on alone, but now carries a new small spark.
  - **Thread the lantern to the sky.** Tallow becomes the island's fifth beacon above Mt. Cinder, a column you can see forever. Tallow speaks one last line from it whenever Wren rests.
- In both endings, dawn comes and the Gloam lifts (as now).
- The illuminated ending page shows the choice, the stats and the heart shards found, counted correctly.
- Then free play: the Gloam blights stay as optional cleanup.

**Size:**
- `enemy-warden.ts` phase 2 and 3 changes: ~200 LOC.
- `landmark-spire.ts` pillar knots and braziers: ~120 LOC.
- `ui-screens.tsx` choice plus ending variants: ~120 LOC.
- `QuestState.endingChoice`.

### 2.10 HUD and UI changes for clarity

| Change | Why | File | Size |
| --- | --- | --- | --- |
| Verb chips: a glyph plus 3 words or fewer, shown once per verb, triggered by context volumes in the prologue and by the first enemy wind-up. A seen-set is saved. | Controls are taught in the world | new `ui-chips.tsx`, plus `hints` in `SaveData`; `game.ts` routes `hint` events | M |
| A tracked target in the compass: large, pulsing, with its distance. Unlit beacons drawn as violet smoke glyphs. NPC and waystone icons. | Next step at a glance | `ui-hud.tsx` compass, `HudFrame.markers` extended (`kind`, `tracked`) | M |
| The objective line says where and what. It shows on change, then hides when calm. | Clarity without clutter | `state.ts objectiveText` gets per-beacon and per-subgoal text; the `ui-hud.tsx` hm-calm rule | S |
| Tallow subtitles at the lantern's screen point | Story and guidance with a voice | `ui-hud.tsx`, `HudFrame.lanternAt` | S |
| A Wick meter: a small arc around the lantern glyph next to the hearts | The thread resource | `ui-hud.tsx` | S |
| A trial rule card, shown at trial start until the first progress tick | Trial intro | `ui-hud.tsx` trial panel, `HudSnapshot.trial.rule` | S |
| A memory page modal after each beacon | Story payoff | new `ui-memory.tsx` | S |
| Journal: suggested order, Track button, rumors, correct shard total | The fallback for "what now" | `ui-pages.tsx`, `ui-store.ts` | M |
| Gated-pedestal feedback is a Tallow line plus a journal rumor, not a toast you can miss | Windward without a bow | `landmarks.ts` `registerPedestal` | S |
| The death text adapts ("at the shrine" or "at the last waystone") | Accuracy | `ui-screens.tsx` | S |
| M toggles the map closed | Bug | `ui-app.tsx` key handler | S |

### 2.11 World guidance: light, landmarks and paths

- **Columns:** unlit beacons get a violet smoke column, and lit ones keep the warm column. Draw both from anywhere. In `landmark-beacon.ts`, add a second `smoke` mesh in `sky`. In `landmarks.ts`, keep tower sky meshes outside `SITE_DRAW`. Size: S.
- **Ember paths:** new instanced glowing path stones along splines from the shrine to each beacon. Add a `PATHS` constant in `contracts.ts`. `terrain-shader.ts` tints a dirt band along the spline. Size: M.
- **The opening vista:** cut a clear line of sight from the shrine gate to Mt. Cinder. `nature-trees.ts` needs an exclusion corridor. Size: S.
- **Lantern pull:** a lean and ember drift toward the tracked target. `player-model.ts` lantern bone plus `render-fx.ts` emitter. Size: S.
- **Regional color:** the Gloam desaturates each unlit region, and lighting a beacon restores it. `render-look.ts`/`terrain-shader.ts` get a `uGloam[4]` uniform weighted by region. Size: M.
- **Night start:** `START_HOUR` goes to 3.5, so the first sunrise comes during the first trip. Size: S.

### 2.12 Bugs to fix first (before any v2 content)

1. **Lamp posts and thin props are climbable.** Wren gets stuck in climb mode at the spawn path. Fix: make boxes narrower than 0.6 m non-climbable, or tag decor `decor` and skip it in the climb test (`player.ts` climb test; `ColliderTag`). S.
2. **Journal shard total.** It shows 36 slots, while 12 shards exist (`ui-store.ts:100`). S.
3. **Death copy.** It refers to an unlit flame (`ui-screens.tsx`). S.
4. **M does not close the map.** Time stays paused (`ui-app.tsx`). S.
5. **Thornring arrival.** The `wood-2` and `night-wood` camps attack at the pedestal, so you lose hearts before the trial starts (`CAMPS`). S.

### 2.13 Copy pass: plain player-facing text

The rule comes from `zelda/v2/copy-rule.md`. Every line must say what happened, what to do, where to go, or what you
got. Flavor is allowed only in lore stones, the loading lore and the ending page.

**One name per thing.** v1 calls a heart a "flame", a "heart", a "new flame" and "your lantern" in different places.
Use these names everywhere:

| Thing | Use | Never use |
| --- | --- | --- |
| health unit | **heart** | flame, lantern, ember |
| heart piece | **heart shard** | — |
| beacon | **beacon**, and "light the beacon" | flame, fire, "wakes" |
| respawn point | **beacon** or **shrine** | "last flame" |
| trial | **trial** | — |

**Every unclear string in v1, with a plain replacement:**

| File:line | v1 text | Replacement |
| --- | --- | --- |
| `ui-screens.tsx:150` | "The lantern gutters" | "You fell" |
| `ui-screens.tsx:154` | "But an ember remembers. Rise again at the last flame you lit." | "Respawning at the last beacon you lit." If no beacon is lit: "Respawning at the Hollow Shrine." |
| `ui-screens.tsx:159` | button "Rekindle" | "Continue" |
| `ui-stub.tsx:149-150` | "The lantern gutters" / "Rekindle" | Same as above, so the stub matches |
| `state.ts:95` | "Leave the Hollow Shrine and head out into Hollowmere" | "Light the beacon by the gate" in v2. In v1, without the prologue: "Walk north out of the shrine" |
| `state.ts:99` | "Wake the four beacons (n/4)" | "Light the 4 beacons (n/4). Next: Cliffwatch, east" (the tracked target goes after "Next") |
| `state.ts:98` | "...Search Mirebrook Ruin for a bow" | "Find the bow in the Mirebrook mill (west)" |
| `state.ts:102` | "The barrier has fallen. Climb Mt. Cinder to the Gloam Spire" | "Climb Mt. Cinder to the Gloam Spire (center)" |
| `state.ts:104` | "Defeat the Gloam Warden" | Keep |
| `state.ts:107` | "Hollowmere is awake. Explore freely" | "Main quest done. Explore the island" |
| `ui-hud.tsx:141` (beaconLit) | "<Beacon> wakes" / "A heart shard warms in your lantern" | "<Beacon> lit" / "You got a heart shard" |
| `ui-hud.tsx:144` | "The trial begins" | "Trial started", with a sub-line giving the rule (for example "Defeat 2 waves") |
| `ui-hud.tsx:147` | "Trial complete" | Keep |
| `ui-hud.tsx:150` | "The trial falters" / "Return to the pedestal to try again" | "Trial failed" / "Press E at the pedestal to retry" (use the device glyph) |
| `ui-hud.tsx:153` | "The barrier falls" / "The way to the Gloam Spire is open" | "The Spire barrier is gone" / "Climb Mt. Cinder to the Spire" |
| `ui-hud.tsx:156` | "The Gloam Warden" / "Keeper of the long dusk" | "The Gloam Warden" / "Boss" (or drop the sub-line) |
| `ui-hud.tsx:159` | "The Warden's fury rises" | "Warden phase 2" (or 3), with "New attacks" |
| `ui-hud.tsx:165` | "Dusk falls" | "Dusk" (to match "Dawn") |
| `ui-hud.tsx:170` | "Heart shard" / "Four make a new flame" | "Heart shard (n/4)" / "4 shards = +1 heart" |
| `ui-hud.tsx:171` | "A new flame" / "Your lantern burns brighter" | "+1 heart" / "Hearts refilled" |
| `ui-hud.tsx:172` | "Mirebrook longbow" / "Hold to draw, release to loose" | "Bow" / "Hold F to aim, release to shoot" (use the device glyph) |
| `ui-hud.tsx:176` | "Journey saved" | "Game saved" |
| `ui-hud.tsx:179` | "You rest by the flame" / "Hearts restored" | "Rested" / "Hearts refilled. Game saved." |
| `ui-hud.tsx:182` | "A storm gathers" | "Storm: lightning can strike you" (only if that is true; otherwise "Storm") |
| `ui-hud.tsx:183` | "Rain on the island" / "Climbing tires you faster" | "Rain" / "Climbing uses more stamina" |
| `landmark-trial-bluff.ts:252` | "The targets are out of reach" | "You need a bow. Find it in the Mirebrook mill." |
| `landmarks.ts:129` (pedestal prompt) | "Begin trial" | "Start trial" |
| `ui-pages.tsx:70` | kicker "The lantern-bearer's book" | "Journal" (or drop it) |
| `ui-pages.tsx:77` | "Leave the Hollow Shrine" / "Walk out of the glade into the wider land." | "Leave the Hollow Shrine" / "Walk north out of the shrine." |
| `ui-pages.tsx:86` | "The Windward targets are out of reach. The mill at Mirebrook Ruin may hold one." | "Windward Beacon needs a bow. It is in the Mirebrook mill (west)." |
| `ui-pages.tsx:87-90` | "Face the Gloam Warden" | "Defeat the Gloam Warden" (to match the objective line) |
| `ui-pages.tsx:111` | kicker "What the island told you" / title "Gleanings" | "Collection" / "Items and lore" |
| `ui-pages.tsx:115` | stat "Flames" | "Hearts" |
| `ui-pages.tsx:116`, `ui-store.ts:100` | "Heart shards 0/36" (wrong total) | "Heart shards 0/12": count the shards that exist |
| `ui-pages.tsx:122` | "Look for carved stones that hum when the lantern comes near." | "Lore stones glow blue. Press E next to one to read it." |
| `ui-pages.tsx:164` | "You stand in <area>" | "You are in <area>" |
| `ui-pages.tsx:186` | "Uncharted" | "Not visited" |
| `ui-pages.tsx:238` | settings title "Sight" | "Graphics" |
| `ui-pages.tsx:255` | hint "Stills shimmer, drift and flicker in menus and the HUD" | "Turns off shimmer, drift and flicker in menus and the HUD" |
| `ui-pages.tsx:268` | settings title "Sound & Hand" | "Sound & controls" |
| `ui-pages.tsx:357` | kicker "Colophon" | "About" |
| `ui-store.ts:60-63` | `BEACON_TRIALS` (for example "strike eight targets before the sand runs out") | Rules as verbs and numbers: "Glide through 6 rings to the beach brazier in 75 s", "Defeat 3 waves inside the thorn ring", "Push 3 blocks onto 3 plates", "Hit 8 targets in 60 s. Needs the bow." |
| `ui-store.ts:73-82` | `LORE_LINES` on the loading screen (pure flavor) | Keep 3 lore lines. Replace the rest with plain tips: "Hold RMB just before a hit to parry.", "Jump in mid-air to glide.", "Rest at a lit beacon to save and heal." |

**Allowed as flavor** (optional reading, keep as is):
- the lore stone texts (`landmark-secrets.ts:157,400,570`, `landmark-village.ts:661`, `landmark-spire.ts:226`);
- `ENDING_TEXT` (`ui-store.ts:85-89`);
- the title tagline.

**Size: S.** About 45 string edits, plus one branch for the death line: `respawnAt` from `landmarks.checkpoint`, passed
to `DeathScreen`.


---

## Part 3. Build plan and module map

Sizes: S is under 150 LOC, M is 150–500, L is over 500 or content-heavy.

| # | Work | Files | Size | Depends on |
| --- | --- | --- | --- | --- |
| 0a | Copy pass (2.13) | `ui-screens.tsx`, `ui-hud.tsx`, `ui-pages.tsx`, `ui-store.ts`, `state.ts`, `landmark-trial-bluff.ts`, `landmarks.ts` | S | — |
| 0 | Bug fixes (2.12) | `player.ts`, `ui-store.ts`, `ui-screens.tsx`, `ui-app.tsx`, `contracts.ts` CAMPS | S | — |
| 1 | Visual guidance: smoke columns, view cut, night start, compass glyphs | `landmark-beacon.ts`, `landmarks.ts`, `nature-trees.ts`, `contracts.ts`, `ui-hud.tsx` | M | — |
| 2 | Objective text and journal tracking | `state.ts`, `game.ts`, `ui-pages.tsx`, `ui-store.ts`, `contracts.ts` (`QuestState.tracked`, `subgoal`) | M | — |
| 3 | Emberthread core | new `thread.ts`, `player.ts`, `input*.ts`, `combat.ts`, `contracts.ts`, `landmark-kit.ts`, `audio-sfx.ts` | L | — |
| 4 | Tallow companion and subtitles | new `companion.ts`, `ui-hud.tsx`, `audio-sfx.ts`, `game.ts` routing | M | — |
| 5 | Verb chips | new `ui-chips.tsx`, `SaveData.hints`, `game.ts` | M | 3 |
| 6 | Prologue (cold open to Oriel) | new `landmark-prologue.ts`, `landmark-shrine.ts`, `ui-app.tsx` intro camera, `camera.ts` scripted shots | L | 3, 4, 5 |
| 7 | Trial refits | `landmark-trial-cliff.ts`, `landmark-trial-wood.ts`, `landmark-trial-lake.ts`, `landmark-trial-bluff.ts` | L (4 × M) | 3 |
| 8 | Ember paths and regional color | `contracts.ts` PATHS, new `nature-paths.ts`, `terrain-shader.ts`, `render-look.ts` | M | — |
| 9 | Density: ~40 mini-secrets, 6 waystones, Oriel, Mulberry, critters | new `landmark-trail.ts`, `landmark-waystone.ts`, `enemy-models.ts` (critters), `ui-pages.tsx` (shop) | L | 3 |
| 10 | Upgrades: Ember Seeds, Wick Oil, lantern powers | `player.ts`, `contracts.ts` (`SaveData.v2`: seeds, wick, powers), `state.ts` migration | M | 3, 9 |
| 11 | Memories and ending choice | new `ui-memory.tsx`, `ui-screens.tsx`, `enemy-warden.ts`, `landmark-spire.ts`, `QuestState.endingChoice` | M–L | 3, 4 |

**Parallel tracks** (each can go to its own agent):
- A: 0, 1, 2, 8.
- B: 3, then 7.
- C: 4, then 5, then 6.
- D: 9, then 10.
- E: 11 after B.

The save version moves to `v: 2`. Write a migration in `state.ts`: old saves keep beacons and collectibles, and new fields
default.

**Success test for v2.** A new player who has never seen the game, given no instructions:
1. Within 30 s, knows what they are trying to do.
2. Within 2 minutes, has used move, look, jump, climb and the thread.
3. Within 10 minutes, reaches the first trial without opening the pause menu.
4. Never travels more than 60 s without a pickup or a discovery.

Check this with a scripted playwright run (time-to-verb log) and with 3 people who have not played it.
