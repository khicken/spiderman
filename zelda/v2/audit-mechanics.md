# HOLLOWMERE mechanics and game-feel audit (branch `zelda-v2`)

Scope: movement, traversal, combat, camera, input, feedback. Bar: the best modern open-air adventure games. Original IP only.

## How this was measured, and what it does not cover

- I sampled `window.__hm.player.state` and the camera every rAF frame (60 fps, headless Chromium with Metal) while sending real key presses through playwright-core. Times are game time (`ctx.time`).
- **Measured in play:** run and sprint accel and stop, reverse and 90° turns, jump tap and hold, run-jump, dodge roll (L, Shift tap, mashed), camera auto-follow while strafing, camera distance and FOV, climb speed, stamina drain, climb-jump, exhaustion fall, vault and mantle on shrine boxes, glide entry, sink, speed and turning, and the cliff-fall death.
- **Code-derived, not measured:** the coordinator stopped browser runs because the owner's GPU was overloaded, and one page crashed. So coyote time, swim, fall-damage thresholds, every combat timing (startup, active, recovery, parry, hitstop, knockback), enemy telegraphs and lock-on come from the source. Each such row is marked **(code)**. Re-measure these with a lighter session before tuning.
- **Screenshots I looked at:** title start, wall climb and glide. I took no attack frame strips, because of the stop request.

---

## 1. Locomotion

### 1.1 Start, stop and speed (measured)

| | Now |
| --- | --- |
| run 0 to 6 m/s | 0.13 s (linear, 40 m/s²) |
| sprint 0 to 9 m/s | 0.20 s |
| stop from run | 0.12 s, slides 0.28 m |
| stop from sprint | 0.17 s, slides 0.67 m |
| walk / run threshold | stick 0.5, 3 / 6 m/s |

**Why it feels off.** Wren responds instantly, but she has no weight. Speed changes in a straight line between 0 and full in about 8 frames. There is no ease-in, no lean-into-stop and no skid. Keyboard input is digital, so on keys she is always at 0 or 6 m/s, and walking does not exist.

**Target.**
- Start: an ease-out curve from 0 to 6 m/s in 0.18–0.22 s. Give the first 2 frames a forward lean and a push-off foot-plant.
- Stop from run: 0.15 s with a short heel plant. Stop from sprint: 0.3 s and 1.2 m, with a skid pose, dust puffs and a scuff sound.
- Add a walk modifier on keys: hold Alt or Caps to toggle walk.

### 1.2 Turning (measured)

| | Now |
| --- | --- |
| 180° reverse at run | yaw flips in 0.23 s (about 690°/s). Velocity passes through 0 in 0.1 s. No pivot animation. |
| 90° turn at run | speed dips to 4.2 m/s, then the turn completes in about 0.5 s |
| turn rate | 12 rad/s (0.75× above 7 m/s) |

**Why it feels off.** The reverse is a snap. The body spins in place like a turret, with no pivot.

**Target.**
- Above 4.5 m/s, if input is more than 135° from facing, play a 0.18 s skid-turn: plant, dust burst and cloak swing, then relaunch at 70% speed.
- Below that speed, keep the snap turn.
- At sprint, cap the turn rate at 7 rad/s and lean the body up to 12° into the turn. `anim.turn` exists, so feed it to a hips roll.

### 1.3 Camera auto-follow while strafing (measured), the biggest feel bug

Hold D (or stick right) with no mouse input. After 1.1 s the camera yaw swings toward Wren's facing at about **150°/s** (`damp(1.7)` applied to a 90° error). Wren then runs a **circle 4.6 m across**, and both she and the camera spin about once every 2.4 s. It reads as "the controls fight me".

**Target.**
- Strafing should curve gently. Cap the auto-follow yaw speed at 25–35°/s, and scale it by lateral input. Never follow when |move.x| > 0.8 and move.y ≈ 0.
- The follow delay is 1.1 s. Use 1.6 s after mouse input, and 0.6 s after stick input.
- Add a "recenter behind Wren" key: middle-click or R3. A tap snaps the camera behind her over 0.25 s.

### 1.4 Jump (measured)

| | Now | Design |
| --- | --- | --- |
| full jump apex | 1.00 m, 0.30 s up, 0.62 s airtime | 1.18 m |
| tap jump | 0.32 m apex, 0.35 s airtime | – |
| running jump distance | 3.7 m | – |
| coyote / buffer | 0.12 s / 0.12 s **(code)** | same |
| fall gravity | ×1.08 on the way down | – |

**Why it feels off.** The early-release cut (`vy *= 0.5`) gives a big gap between a tap (0.32 m) and a hold (1.0 m). A quick key press, about 40 ms, gives a hop that clears almost nothing. The descent is almost as floaty as the rise. The apex also sits 0.18 m under the design number.

**Target.**
- Min jump 0.6 m: cut to ×0.65, and only after 0.08 s of rise.
- Full jump 1.2 m (jumpV 7.6).
- Fall gravity ×1.35, so the arc stays snappy and the airtime stays about 0.6 s.
- Coyote 0.15 s. Buffer 0.15 s, and let the buffer also cover landing from a roll.
- Juice: a takeoff squash of 2 frames, a landing squash scaled by impact (it exists), and a soft cloth-flap sound at the apex.

### 1.5 Dodge roll (measured)

| | Now |
| --- | --- |
| roll | 0.45 s, 4.16 m, peak 11.7 m/s, exits at 5.8 m/s, cost 0.12 |
| i-frames | 0.32 s from frame 0 **(code)** |
| input buffering | **none**. A roll pressed during a roll is dropped. Mashing every 250 ms gave 2 rolls per second, not 4. |
| Shift-tap roll | fires on **key release**. Latency equals the hold time (about 90 ms in the test, up to 180 ms). The gamepad B-tap also fires on release. |

**Why it feels off.** On keys and pad, the roll feels late. Inputs during a roll vanish. The roll leads straight into full-speed running, with no recovery.

**Target.**
- Fire the roll on press. Sprint starts only after the key or button is held 0.2 s.
- Buffer any action pressed in the last 0.15 s of a roll: roll, attack or jump.
- Shape it as: i-frames 0.05–0.35 s, a 0.1 s recovery that you can cancel into attack (a roll-attack is a natural combo starter), and a 0.25 s cooldown before back-to-back rolls on the same direction.
- Locked-on, no input: a backstep of 2.2 m in 0.3 s instead of a backward roll.
- Juice: a dust trail, a whoosh, and a 15 ms rumble at the start.

### 1.6 Step, vault and mantle (measured on shrine boxes)

| | Now |
| --- | --- |
| 1.1 m box | Wren hits it and **stops dead at 0 m/s**. 0.11 s later climb mode starts, then a 0.42 s vault. She resumes from 0 m/s, so the whole action costs about 0.55 s with a dead stop. |
| 2.1 m box | Dead stop for 0.12 s, then a climb of 0.5 s, then a 0.3 s mantle. About 0.8 s in all. |
| trigger | you must push into the wall for 0.14 s (`wallPushT`) |

**Why it feels off.** Every waist-high obstacle becomes a speed bump. This is the most common action in an open world, so it should flow.

**Target.**
- If speed is above 3 m/s and the obstacle is 0.45–1.3 m: start the vault on contact, with no push timer. Make it 0.3 s, keep 80% of the horizontal speed, and use a one-hand plant pose.
- For 1.3–2.2 m: a 0.45 s mantle, then exit at 50% speed.
- Juice: a hand-plant dust puff, a cloth whoosh, and a low grunt.

### 1.7 Climb (measured)

| | Now |
| --- | --- |
| climb start | 0.5 s after walking into the cliff, needing 0.14 s of push |
| speed | 1.78 m/s up |
| drain | 0.110 stamina/s, so 9.1 s and **16 m of wall per full ring** |
| climb-jump | +2.2 m in 0.34 s, costs 0.20 |
| exhaustion | at 0 stamina Wren lets go **instantly**, with no warning beat. In the test she fell 16 m and took fall damage. |
| camera | 5.2 m away and level with the wall. The rock fills about 100% of the frame (screenshot). You cannot see the top, the next ledge or how far you have climbed. |

**Why it feels off.**
- The climb speed is right for the genre. Range is the issue: the Ashen Cliffs are about 80 m tall, and one ring covers only 16 m.
- The camera hides the goal.
- Exhaustion is binary and cruel.
- There is no ledge grab when falling past an edge.

**Target.**
- Climb 2.0 m/s.
- Drain 0.08/s, so one ring covers 25 m. Climb-jump +2.6 m for 0.15.
- Rest ledges every 20–25 m on long faces (stand on them to regen).
- Camera on climb: pull back to 7 m, pitch 0.15 rad down (looking up the wall), with a slight offset away from the wall so the summit is visible.
- **Last-gasp:** below 0.15 stamina, flash the ring red, pulse a heartbeat sound and shake the arms (the `exhausted` flag exists). At 0, hang for 0.6 s more before letting go, and let one climb-jump input still fire.
- **Ledge catch:** while falling past a ledge top that is within 0.6 m of the hands, catch it and auto-mantle.

### 1.8 Glide (measured)

| | Now |
| --- | --- |
| open | G any time in the air above 2.5 m. Space in the air also works. Wren reached vy −2.7 m/s before opening at 0.3 s. |
| speed | 8.5 m/s holding forward, 6.8 m/s hands-off, 4.3 m/s holding back (code) |
| sink | 2.0 m/s steady, reached in about 0.8 s |
| glide ratio | 4.25 : 1 |
| stamina | 0.06/s, so 16.7 s and about 140 m of range per ring |
| turn | 2.4 rad/s. The camera follows a 200° turn with a lag of about 80°. |
| FOV | 60 to 66 |
| **bug (seen twice)** | A glide opened with **Space** in mid-air closed by itself about 0.4 s later, with no further input. Wren then fell from 90 m to her death. A glide opened with G was stable. Possible cause: the Space press reaches both the jump buffer and the glide toggle. Reproduce by hand and fix first. |
| no glide = death | Walking off the 80 m cliff without gliding kills Wren. There is no auto-prompt and no warning. |

**Why it feels off.** The glide numbers are reasonable, but the glide has no expression. There is no dive, no flare and no speed or lift trade, so it feels like a slow elevator. Holding back nearly stops forward motion, so a player who tries to "brake" feels stuck. The glider is a thin bar in the screenshot and reads as a stick, not a sail.

**Target.**
- Speed 9 m/s hands-off.
- Hold back = flare: 5 m/s forward and 1.2 m/s sink, at stamina ×1.5.
- Hold forward with pitch-down (or a dive button) = dive: up to 16 m/s with 6 m/s sink. Releasing converts speed into a short climb of up to 3 m. This is the single change that makes the glide feel freeing.
- Banking: roll the model up to 25° into turns. Raise the turn rate to 3 rad/s.
- Juice: wind-noise volume and pitch by speed, speed lines above 11 m/s, a cloak flutter, and a sail thump on open.
- Falling faster than 14 m/s with more than 8 m to go: show a one-time "Open the glider" prompt with the glyph.

### 1.9 Swim (code, not measured)

- Speed 2.6 m/s, fast 4.4 m/s at 0.16/s; 0.05/s while moving.
- Regen only when idle.
- Drowning at 0 costs 2 quarters and respawns you.

**Why it feels off.** The fast swim is held Shift, the same as sprint, so there is no rhythm. Treading water is free, which makes the stamina meaning murky.

**Target.**
- Make dodge a 1.2 s dash-stroke for 0.2 stamina. The touch label already says "Dash".
- Treading water drains 0.02/s, so the player sees that water is a stamina space.

### 1.10 Fall damage (code)

- Damage starts at 13 m/s impact, about 3.8 m. A 10 m drop costs 3 quarters.
- Landing over 9 m/s locks Wren in `land` for 0.28 s at 35% speed.

**Why it feels off.** A 4–5 m ledge, which is common on rooftops and ruins, already hurts. That fights pillar 1, "Look anywhere and go there".

**Target.**
- Damage starts at 17 m/s, about 6.5 m.
- Roll-landing: press dodge within 0.15 s of touchdown to take no damage and keep your speed.

---

## 2. Combat (code-derived, not measured)

### 2.1 Sword combo

| | hit 1 | hit 2 | hit 3 | riposte |
| --- | --- | --- | --- | --- |
| startup (wind-up to hit frame) | 0.08 s | 0.08 s | 0.14 s | 0.06 s |
| active | **1 frame** (one `strike()` call) | 1 frame | 1 frame | 1 frame |
| recovery | 0.28 s | 0.28 s | 0.42 s | 0.40 s |
| chain window | press after 50% of the wind-up; next swing starts at wind-up + 0.13 s | same | – | – |
| lunge | 3.2 m/s, decays at 14/s | 3.2 | 4.5 | 5 |
| damage | 10 | 10 | 16 | 30 |

**Problems.**
1. **The hit lands before the blade.** `attackPose` spends only 5% of the swing in the wind-up. The arc then plays over 0.11 s after the hit frame, behind a 30/s pose filter. So the damage, flash and sparks fire about 80–120 ms before the blade visually crosses the target. Hits feel "detached" and unclear.
2. **No anticipation pose.** An 80 ms wind-up is shorter than the pose blend, so the player never sees a raise.
3. **The combo cadence is mushy.** A queued press fires at a fixed wind-up + 0.13 s. Pressing late in the recovery (0.2–0.28 s) also chains, so mashing and timing feel the same.
4. **One-frame active.** A fast-moving brambling (6.5 m/s lunge) can pass through the arc between frames.

**Target.**
- Startup: 0.12 / 0.10 / 0.20 s with a clear raise pose (blade back 70°, torso coiled).
- Active window: 0.06 / 0.06 / 0.09 s, sweeping the arc so the hit lands where the blade is.
- Recovery: 0.22 / 0.22 / 0.45 s.
- Cancel windows: attack-to-dodge after the active window ends. The chain input window is 0.25 s after active. Give a "perfect" late press (last 0.1 s) +20% damage and a gold trail.
- Hit-confirm frame matched to the blade. Put the impact spark at the blade tip, not at the enemy center.
- Juice per hit: a squash of the enemy mesh for 60 ms, a 2-frame white flash (exists), a slash-mark decal for 0.2 s, a pitch-rising hit sound across hits 1→2→3, rumble 0.25/0.06 s (0.5/0.12 s on hit 3), and a camera nudge of 0.1 m along the swing direction.

### 2.2 Hitstop

- Normal hit 0.06 s; hit 3 0.096 s; spin 0.1 s; riposte and parry 0.14 s.
- Hitstop is a global time scale of 0.08, not a freeze.

**Problem.** The values are good. But a whole-world slow also slows the camera and particles, so the stop smears instead of punching. The player's hurt hitstop goes up to 0.12 s, which feels like lag when you are the one hit.

**Target.**
- Freeze only the attacker and the victim: 0.05 / 0.05 / 0.09 s. The world keeps running.
- Player-hurt hitstop at most 0.05 s.
- Add a 0.12 s time-dilation tail at 0.5× after a parry.

### 2.3 Charge and spin

- Hold 0.32 s after hit 1 to start charging. Full charge at 0.8 s. Spin is 0.55 s and hits at 0.1 s: 26 damage, reach 2.6 m, cost 0.3.

**Problems.**
- To charge you must first swing hit 1. A hold always spends a swing.
- The charge-ready cue is only an event. Check that it has a distinct sound plus a flash on the blade.

**Target.**
- Holding from idle charges without swinging. Hold through a combo hit and the charge continues.
- At ready: a ringing chime, the ember blade flaring, and a 1-frame screen-edge glow.

### 2.4 Shield, parry and riposte

- Parry window: the first 0.18 s of raising the shield.
- On parry: 1.4 s stun, riposte 30 damage, spark burst plus white flash, hitstop 0.14 s, shake 0.45.
- Block: no damage, shoved by 60% of the knockback.
- Rumble fires **only on hurt**. Parry and block have none, although DESIGN specifies parry 0.4/0.1 s.

**Problems.**
- The parry window is fine.
- The riposte prompt is invisible. Nothing tells the player "now".
- Because the shield only works on the ground, an attack while jumping cannot be blocked, with no feedback.

**Target.**
- Keep 0.18 s, and widen it to 0.22 s on touch.
- On parry: a 0.35 s slow-mo at 0.4×, a gold ring flash on the enemy, the attack button glyph pulsing over the enemy, and a "clang + choir" sound.
- Add the parry rumble 0.4/0.1 s and the block rumble 0.2/0.05 s.

### 2.5 Knockback and hit reactions

- Player sword knockback is 4 m/s (spin ×1.6, riposte ×1.4). Brambling hurt lasts 0.3 s, mossback 0.5 s.
- A brambling hops back at 5 m/s after its own swipe.
- Big hits knock Wren up 4 m/s, with 1.15 s of hurt.

**Target.**
- Enemies: knockback 5 / 5 / 8 m/s, with a 0.08 s rise on hit 3 for light enemies.
- Wren hurt: 0.3 s (big hits 0.9 s), with a get-up you can cancel by rolling after 0.5 s.

### 2.6 Enemy telegraphs (code)

| | wind-up | strike lands | visible cue |
| --- | --- | --- | --- |
| brambling | 0.35 s, then lunges 6.5 m/s | 0.06 s into the attack, so **0.41 s total** | the body glows violet (ramps over 0.27 s), then it backs off at 0.4 m/s |
| mossback | 0.9 s | at `ATTACK_T` | the glow plus a ground ring at the slam point (good) |
| wisp | 0.8 s | bolt at 16 m/s | the glow plus a hand orb |

**Problems.**
- A brambling's 0.41 s from cue to hit, with a lunge that closes 1 m, is below human reaction (0.25 s) plus the parry rise. In a pack it reads as unfair.
- The glow is the only brambling cue. Violet on dark forest grass is low contrast.
- The "!" alert exists but has no "about to attack" sound.

**Target.**
- Brambling wind-up 0.5 s: a crouch and head-down pose plus a distinct rising rattle sound. Add a 1-frame gold glint on the claw at 0.15 s before the hit (the "parry now" moment).
- Wisp: a charging whine.
- Mossback: keep the ring, and add a 0.15 s pre-hold at the top of the wind-up.
- One shared sound per attack class teaches the player.

### 2.7 Lock-on and camera in combat

- Pick: the nearest to screen center within 30 m with line of sight. Drop at 40 m.
- Camera yaw to target at damp 7. Pitch clamped 0.12–0.75. Distance grows by up to +3.5 m.
- While locked, Wren faces the target on the ground (turn 12 rad/s). With no input, the roll goes backward.

**Problems.**
- There is no soft-lock. Attacks without a lock aim at the stick direction only, so on keys, swings miss enemies that are 30° off.
- Switching targets is by mouse flick only (`pickSwitch`). There is no keyboard or pad button switch shown in the controls.

**Target.**
- Soft-lock: with no hard lock, attack snaps the yaw up to 45° toward the best enemy within 3.5 m.
- Hard lock: target switch on mouse wheel or right-stick flick.
- Show the next target's bracket faintly.

---

## 3. Camera (measured unless marked)

| | Now |
| --- | --- |
| base distance / FOV | 6.2 m / 60 |
| run follow lag | +0.29 m (follow rate 18/s), effectively locked to Wren |
| sprint | +0.8 m, FOV 65 (0.6 s ease) |
| glide | +2.2 m, FOV 66 |
| auto-follow | starts 1.1 s after the last look input, about 150°/s when strafing (see 1.3) |
| climb | 5.2 m, eye 1.7 m: the wall fills the frame |

**Target.**
- Add a small lead: offset the pivot 0.6 m along the velocity at run.
- Sprint FOV 66.
- Slow the auto-follow (1.3).
- Climb framing (1.7).
- Add a landing dip: 0.1 m × impact.
- Add the recenter button.

---

## 4. Missing mechanics for the "magical, seamless" feel

1. **Contextual prompts everywhere.** A HUD slot exists. Show it consistently: "Climb" when facing a climbable wall, "Glide" when falling more than 6 m, "Grab" next to a pushable block, and "Talk", "Open", "Read" and "Rest". Fade it in at 0.15 s, with the device glyph. Highlight the target with a soft gold rim.
2. **Interact and pickup feel.** Glimmers should be **magnetized**: within 2.5 m they fly to the lantern over 0.25 s, with an ascending note per glimmer in a cluster (a pentatonic run). Chests get a 1.2 s open with a held light shaft. A shard gets a 0.6 s held-up pose and a fanfare stinger.
3. **Ledge catch** while falling (1.7), plus **auto-vault at speed** (1.6).
4. **Wall jump.** Do not add a free wall jump; it breaks the climb economy. Instead add a **climb-dash sideways** (climb-jump with left or right input moves 2.5 m to the side).
5. **Clear stamina UI.** The 28 px ring by the shoulder is right in spirit. Add:
   - a ghost segment that previews the cost of the next action (climb-jump, roll);
   - a red tick pulse below 25%;
   - a "wheeze" sound;
   - a ring that grows 1.3× while it is being drained;
   - a clear refill chime when the exhaustion lock ends.
6. **Enemy readability.** Every enemy needs: an idle tell (eyes glow when it notices you), a wind-up pose plus sound, a gold "parry glint", a stagger state you can see (stars or a violet crack), and a health pip bar only after the first hit.
7. **Sprint-jump momentum and a roll-landing** (1.10).
8. **Shield surf / slope slide.** Walking on steep slopes already slides. Make it a deliberate crouch-slide (dodge on a slope) with speed gain. It is cheap and joyful.
9. **Whistle / beacon recall.** There is no fast travel; lit beacons are checkpoints only. On a 1.2 km map this is optional. A "warp from a lit beacon" option at the rest menu is enough.

---

## 5. Signature ability: **Kindle** (the lantern's ember-thread)

The lantern stores ember-light. Hold the **lantern** button to aim a thread of light. Release to **Kindle** a target. In this world, light and memory are the same thing. Kindled objects **remember their past state for 8 seconds**, then fade back.

**What Kindling does.**
- **Gloam-dead things wake.** A dead vine-bridge regrows for 8 s, a dry fountain flows, a collapsed stair rebuilds, and a withered sky-bloom opens into an updraft column.
- **Shadows become solid.** Kindle a lantern post, and the shadow it casts from your light becomes a walkable dark-glass platform for 8 s. Move or turn the lantern, and the shadow moves. This is the unique puzzle space: you shape platforms by where you stand relative to the light.
- **Enemies.** Kindling a Gloam creature shows its "memory" for 3 s, as a ghostly afterimage of its next attack. It is a stamina-costed read on any enemy. On the Warden, Kindle the crown lanterns to stun it. This replaces "shoot the crown 4 times".
- **Traversal.** Kindle a far ember-sconce, and the thread becomes a zipline you glide along.

**Cost and feel.** Kindling uses its own **ember** meter: 3 pips, refilled at braziers, lantern posts and glimmers. It does not use stamina, so traversal and puzzle resources stay separate. Juice: the thread draws as a gold ink brushstroke, with a soft bell when it lands. The restored object paints back in watercolor bleed over 0.4 s and drains back out in the last 1.5 s with a ticking tone.

**Why it fits.** It ties pillar 3 (the lantern), the illuminated-manuscript look (ink and gold strokes) and the Gloam story (forgetting) into one verb. It works in combat, traversal and puzzles.

---

## 6. Controls review

**Keyboard and mouse.**
- Shift is both sprint (hold) and dodge (tap on release). This causes the dodge latency in 1.5 and accidental sprint bursts. Use **Space = jump, Shift = sprint, Ctrl or C = roll on press**, and keep L as an alternate.
- J, K and L for attack, block and dodge are unusual on a mouse layout. Keep LMB, RMB and Ctrl as the primary binds, and show them first in the Controls page.
- G to glide is fine. Space in the air opens the glider too, which collides with the jump buffer (the Space-glide bug in 1.8). Make Space-in-air open the glider only on a **fresh press after the apex** (vy ≤ 0), and let G toggle it.
- Q for lock-on works, and so does Tab, but Tab conflicts with browser focus in windowed play. Add MMB-click for lock and use the wheel to switch.
- E for use is fine.
- No walk key (1.1). No camera recenter (1.3).

**Gamepad.**
- B-hold sprint / B-tap roll on release has the same latency problem. Better: **B = roll on press, L3 or B-hold after 0.2 s = sprint**.
- RB lock, LT shield, RT bow and X attack are conventional and good.
- Rumble fires only on hurt. Add hit, parry, block, land and glide-open rumble.
- There is no button to switch targets. Use a right-stick flick and show it.

**Touch.**
- The 9-button arc (sword, jump, roll, shield, bow, lock, glide and the contextual use) is crowded for thumbs. The double-tap-stick sprint toggle and "push past 95% for 0.4 s" are hidden gestures.
- Simplify:
  - auto-sprint when the stick is at full tilt for 1 s on open ground;
  - make jump become glide automatically in the air (one button, label swap);
  - lock-on as a tap on the enemy;
  - parry window +0.04 s.
- The touch overlay was not exercised in this audit.

---

## 7. Ranked top 15

1. **Fix the camera auto-follow spiral.** Strafing runs a 4.6 m circle at about 150°/s. Cap it at 30°/s and skip it on pure strafes.
2. **Fix the Space-opened glide that closes by itself** (seen twice, fatal at height). Also auto-prompt "Glide" on high falls.
3. **Sync the hit frame to the blade.** Make the active window sweep the arc. Add a visible wind-up pose (startup 0.12/0.10/0.20 s).
4. **Fire the dodge on press**, not on Shift/B release. Buffer roll, attack and jump inputs for 0.15 s.
5. **Momentum vaults and mantles.** No dead stop. Vault 0.3 s keeping 80% speed, on contact.
6. **Climb range and camera.** Drain 0.08/s (25 m per ring). Pull the camera back to show the top. Add a last-gasp 0.6 s hang plus a ledge catch.
7. **Brambling telegraph.** Wind-up 0.5 s, plus a pose, a sound and a gold parry glint. Do the same per attack class.
8. **Glide expression.** Dive to 16 m/s, flare to 5 m/s, banking, speed-scaled wind sound.
9. **Combat rumble and juice.** Rumble on hit, parry and block. Per-hit sound pitch ladder, slash decals, local (attacker and victim) hitstop.
10. **Parry payoff readability.** Slow-mo 0.35 s, a riposte glyph over the enemy, a distinct sound.
11. **Turn and stop weight.** Add a skid-turn above 4.5 m/s, an ease-in start of 0.2 s, and a sprint-stop skid.
12. **Soft-lock aim assist** within 3.5 m / 45°. Add a target-switch button on wheel or stick.
13. **Stamina UI clarity.** Cost preview, red low-pulse, a refill chime, a bigger ring when draining.
14. **Fall damage threshold** up to 17 m/s, plus a roll-landing. Jump min height 0.6 m and full height 1.2 m, with faster fall gravity.
15. **Kindle** (the lantern memory-thread) as the signature verb, plus magnetized glimmer pickups and contextual prompts.
