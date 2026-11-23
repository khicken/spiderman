# GAME-DESIGN.md

Design and feel rules for every game in this repo. They come from what went wrong in spiderman, aot, cars, minecraft, 2k (HOOPS) and zelda (HOLLOWMERE), and how we fixed it.

- `AGENTS.md` covers code, performance, audio files and test setup. Read it too.
- A game folder can add its own rules (see `aot/CLAUDE.md`). The game file wins where the two disagree.
- Each rule names its evidence: a PR number, a commit, or an audit in `zelda/v2/`. "Target" means a proposed number that no game has measured yet.
- Add a rule here when a lesson applies to more than one game.

## 1. The first minute

A new player must know what to do, and do it, without help from outside the game.

- The player knows the goal within 30 s, uses the core moves within 2 min, and gets the first win within about 2 min. Zelda v1 failed all three: the nearest goal was 450-800 m away (audit-playtest).
- Start with a short opening that shows the goal, then give control. Do not drop the player into silence (audit-design).
- Show the goal before the player completes it. Mark each target so the player can see it from far away (a beam or smoke column). Zelda showed the beacon beam only after the beacon was lit (audit-design).
- Track one target at a time. Show it with a world marker, a compass icon and a live distance. A number that jumps between targets looks broken (audit-playtest).
- Never make an objective that completes by accident ("Leave the shrine" completed after 45 m of walking). Never show a counter that does not move (audit-design).
- Put a reward every 30-60 s of travel: a pickup, a secret, an enemy, a view. In 10 min of zelda v1 there was nothing (audit-playtest).
- Teach each control in the world, at the place that needs it. Show one chip with the key and 3 words or fewer. Show it once, and store a "seen" flag in localStorage (aot #30 #33, audit-design).
- Give a skippable first-run tutorial when the game has many verbs (spiderman #22, HOOPS #35).
- Teach progression in the world too. In aot, players never upgraded until the depot smoke, a glowing counter and a drill step showed them how (#30).
- In a drill, stop allies from doing the lesson for the player (aot #33).
- Start the first session in daylight (audit-playtest).
- Do not let enemies attack at a quest start point before the quest starts (audit-design).
- Put a soft boundary or a warning at the world edge, not a silent death (audit-playtest, aot #9).

## 2. Always show what to do next

- If an action is available, the HUD shows its key (aot/CLAUDE.md).
- Rank "next up" by urgency, not by distance. Spiderman pointed at the nearest photo spot while a boss fight waited (#22).
- Keep content close and dense. Spiderman crimes now spawn 60-250 m away, 4 at a time (#22).
- Name every HUD icon. If a toast mentions stamina, show a stamina bar (audit-playtest).
- When play stops (whistle, foul, wave hold), say why. The player can always see why a wave has not ended (HOOPS #35, aot/CLAUDE.md).
- Put a choice before a session on one screen, not in buried settings (cars pre-race kit, #26).

## 3. Text

Say what happened and what to do next. Use the right words, not more words.

- Bad: "The lantern gutters. But an ember remembers. Rise again at the last flame you lit."
- Good: "You fell. Respawning at the last beacon you lit." (zelda/v2/copy-rule.md)

Rules:
- Each line answers one question: what happened, what to do, where to go, or what you got.
- Give each thing one plain name, and use it the same way in the HUD, journal, toasts and map.
- Put lore and flavor only in optional places (item text, journal). Never put it in prompts, objectives, death screens or tutorials.
- Keep strings to 10 words or fewer, in the active voice with common words. One line must fit on a phone.
- Show no text for what the world, a sound or the HUD already shows. A refusal plays a fail sound (aot #23 #29).
- Say each fact once. Do not repeat it in a toast, a voice line and a banner (aot #33).
- Text must match the real state. The zelda death screen named a flame the player never lit, and the journal showed 36 shard slots for 12 shards (audit-design).
- Prompts name the real button for the current device. On phones, name the touch button (spiderman #20). Never show an empty key box (#2).
- Keep the center of the screen clear in combat. Put lasting info at the edges (aot/CLAUDE.md).
- Toasts must not crop at the screen edge, and need a dark backing for contrast (zelda f552353, audit-playtest).
- Remove dev readouts (fps counter) before release (aot #23).

## 4. Controls

- Fire an action on the press, not on the release or after a hold check. Tap-to-hit in spiderman is 87-131 ms (#8). The zelda dodge on release added 90-180 ms (audit-mechanics).
- Buffer presses. Spiderman keeps a press live for 0.4 s, which cut missed presses from 30% to 5% (#8). Target for action games: buffer jump, attack and dodge for 0.15 s. Use coyote time of 0.15 s.
- Hitstop and menus must not eat a press (spiderman #20, cars #18).
- Give each input one job. Spamming a key that does five things wins fights (aot #27). Overload a key only when the context is clear on screen (aot #29).
- A hold does one thing. Spiderman webs that re-attached to empty sky while the button was held were the top bug (#1 #2 #4).
- Keep the control count small. Spiderman went from 17 to 12 desktop binds and from 14 to 9 phone buttons (#20).
- Do not bind Ctrl, Tab or other keys the browser uses. Ctrl+W closes the tab (spiderman #1 #20).
- On macOS, clear held keys after a Cmd shortcut. A click that captures the mouse must not also attack (minecraft #32 #36).
- The first click captures the mouse, and the game says so. After a menu closes, capture the mouse again or show "Click to look around" (audit-playtest).
- HUD clicks must not trigger gameplay (aot #33).
- Support keyboard and mouse, trackpad (no mouse), gamepad and touch (spiderman #8).
- Touch: fewer buttons, auto-sprint at full stick, tap an enemy to lock on, and wider timing windows (+0.04 s parry). Do not hide actions behind gestures nobody can discover (audit-mechanics).
- Tilt steering needs a recenter button, a permission flow and a fallback when no sensor data arrives. Emulators cannot prove it (cars #26).
- Make every useful action discoverable, for example hold brake at a stop to reverse (cars #26).
- A resource drains only when the player asks for it. In aot, hooks and slashes used gas quietly (#33).
- Escapes use one clear timing with a visible window. Do not use button mashing or hidden meters. A wrong press gives a sound (spiderman #20, aot #28).

## 5. Movement and camera

- Never change speed in one frame. Stacked assists in spiderman caused 450-1700 m/s² spikes. An eased pull and a damped catch fixed them (#19).
- Use projectiles with real travel time, not a fixed delay. Press-to-pull dropped from 68-80 ms to 34-63 ms (spiderman #19).
- Carry the player's momentum into attacks, so skill sets damage. An aot cut reset speed to a fixed lunge (#33).
- Run physics at a fixed step (spiderman uses 120 Hz).
- Sliding along walls beats sticking to them. A wall must cost speed, or riding the wall beats steering (spiderman #2, cars #25).
- Small obstacles must not stop the player dead. Target: vault a waist-high box in 0.3 s at 80% speed (audit-mechanics).
- When the player cannot do something, show it: a "too steep" animation or a slide. Thin props under 0.6 m are not climbable. A lamp post trapped the zelda player at spawn (audit-design).
- Small drops do not hurt. Target: fall damage starts at about 6.5 m (audit-mechanics).
- Jump target: 0.6 m minimum, 1.2 m full, fall gravity x1.35 (audit-mechanics).
- A glider or mode change opens only on a fresh press. A zelda glide closed by itself and killed the player (audit-mechanics).
- The camera follows the look direction. Cap auto-follow while strafing at 25-35 deg/s, and turn it off on a pure strafe. At 150 deg/s the zelda camera turned the player in circles (audit-mechanics).
- The camera collides with every large solid, never goes inside the character's head, and caps pitch on slopes (spiderman #20, zelda f552353).
- Fade objects between the camera and the player (zelda f552353).
- When the player is held or grabbed, point the camera at the threat (aot #28).
- Key depth of field and menu blur to game state, not to speed (cars #25).

## 6. Combat and feedback

- Every enemy attack has a tell: a pose, a sound and a glow. Target: a 0.5 s wind-up. Snipers and bosses need tells that the player can see from far away (spiderman #4 #8, aot #33, audit-mechanics).
- Hard means learn the pattern, not unfair numbers. A player who knows the pattern wins on the first try. A player who ignores it dies (aot/CLAUDE.md).
- Give each boss phase 2-3 punish windows, and show its weak point on the body, not in text (spiderman #4, aot #33).
- The hit lands when the blade arrives. Zelda hits landed 80-120 ms early (audit-mechanics). Show a visible wind-up.
- Auto-aim stays inside a cone around the camera (aot uses about 55 deg). It never picks targets behind or off screen (spiderman #19, aot #27). Target for melee: soft lock within 3.5 m and 45 deg.
- A weak input still works but pays less. In aot, a tap does 0.3 + 0.7 × charge of full damage (#27).
- Hitstop freezes only the attacker and the victim, not the world. Targets: 0.05-0.09 s per hit, at most 0.05 s when the player is hurt (audit-mechanics).
- Make a parry and its counter obvious: a short slow-motion, a ring, a button glyph and a distinct sound (audit-mechanics).
- Rumble on hits, blocks and parries, not only when the player is hurt (audit-mechanics).
- Show state on bodies and in the world: blade glow, steam, depot smoke (aot #28 #30).
- A HUD timing ring reads the same constant as the gameplay code. The aot ring filled before the real window ended (#28).
- Use hysteresis on state flips. Aot hardening turns on under 45 m and off over 50 m (#33).
- Every state machine resets on every exit path: interrupt, stun, death, abort. List the exits and test each one. Most aot and zelda bugs were missed resets (aot #33, zelda f552353).

## 7. Progression and flow

- Never pause play or open a modal in combat. Pick upgrades with one key or tap while moving (aot #23 #30 #33).
- Each upgrade changes something the player feels in the next fight. Cut hidden percentages (aot #33).
- Keep breaks short. The aot wave break went from 15 s to 6 s, and the last 3 enemies hunt the player (#33).
- Death and respawn are fast. The player is back in play within a few seconds (aot/CLAUDE.md).
- Ally actions count toward the player's objectives (aot #33).
- A scoring change breaks old leaderboards. Version the scores or accept a reset (aot #23).

## 8. Audio

- Target levels: full mix -18 LUFS integrated, true peak at or below -1 dBFS (audit-audio).
- Combat is louder than exploring. Day and night are within 1.5 dB. The menu is not louder than play. Zelda v1 broke all three (audit-audio).
- Targets by layer (short-term LUFS): explore music -24, combat music -21 to -22, ambience -30, footsteps -30, stings -18, voice -18 (audit-audio).
- Duck music under voice (-8 dB) and stings (-6 to -10 dB) (audit-audio).
- Check levels with an offline script. Measure the spectrum and the stereo width, not only the peaks (audit-audio).
- A level check is not listening. The owner listens before audio ships (HOOPS #35, minecraft #32).
- Use real recordings for ambience, crowds, footsteps and impacts. A synthesized 4 s noise loop sounds frozen. Use several takes per sound, and never play the same take twice in a row (audit-audio, AGENTS.md).
- Synthesized engines and tones need their harsh upper harmonics removed (cars #25).
- Handle tab switches and Safari: do not play a queue of old sounds at once on resume (minecraft #36). Mute on pause with gain. Suspend the context only for a hidden tab (zelda f552353).

## 9. Graphics

- Light every hour like the best-looking hour. Keep ambient low and the key light strong. High ambient gives a flat look (audit-graphics).
- Custom shader materials must receive shadows. Without shadows, trees float (audit-graphics).
- Anti-alias on every device. Use FXAA or SMAA on phones (audit-graphics).
- Outlines: never on grass or foliage. Thin them with distance, or remove them (audit-graphics).
- On presets without bloom, fake glow with soft sprites (audit-graphics).
- Add variety with 6-8 mesh variants per species. This does not change the draw count (audit-graphics).
- Fog, clouds, particles and underwater light must agree (minecraft #36 #37).
- Cap particles per frame and fade them near the camera. Big near smoke eats fill rate and hides the road (cars #26, aot #9).
- Keep sunlight and shadow seams out of tunnels and interiors (cars #26).
- Lift ground layers a few cm to stop z-fighting (spiderman #20).

## 10. Performance and robustness

- Default phones to the low preset. Mark the top tier as "needs a strong desktop GPU" (cars #25).
- Use adaptive quality. If fps stays under 55 for 3 s, lower the preset, then the pixel ratio. Raise it again when there is headroom (aot #6, zelda #40).
- Wrap the frame loop in try/catch and always render. One out-of-range array index froze aot on phones (#6).
- Assert every capacity limit (pool size, slots) against the real maximum (aot #6, zelda f552353).
- Push HUD state to React only when a shown value changes. This removed 25-55 ms spikes (zelda f552353).
- Move heavy work (meshing, baking) to workers, and transfer buffers instead of copying (minecraft #36).
- Throttle far entities, and cap the work per tick for chain reactions (minecraft #24 #36).
- Recover from WebGL context loss: save and restart, never show a white screen (minecraft #36).
- Measure GPU cost while the GPU is busy. Watch the heap over a 2-minute run (spiderman #7 #19).

## 11. Saves

- Give saves a version number and a one-time migration (spiderman #7, minecraft #37).
- Match saved items by name, not by index (spiderman #7).
- Validate everything on load: a whitelist for enums and clamps for numbers. Handle full storage (cars #18, zelda f552353).
- Write the save after every module has handled the frame's events (zelda f552353).
- Clear quest and trial flags on abort, so the player cannot soft-lock (zelda f552353).

## 12. Multiplayer

- Validate all peer data. The host owns damage, items, drops and reach checks (cars afdbd4d, minecraft #32-#38).
- Give every exploit a test that fails before the fix (minecraft #36).
- Send movement on its own unordered channel. The slowest 5% of movement updates dropped from 2.8 s to 132 ms (minecraft #36).
- Show remote players about 100 ms in the past, interpolated. Stamp snapshots with tick time, not wall time (minecraft #36 #39).
- Compensate lag on the host: check hits where the attacker saw the target (minecraft #36).
- A rate limiter never starves position updates (minecraft #39).
- Rejoin with a token in localStorage (minecraft #36).
- Peer-to-peer needs a relay fallback. No free public TURN server works (cars #18).
- Copy the room code with one click (minecraft #39).

## 13. Process

- Run a blind first-time playtest before calling a game done. Scripts and tsc passed on zelda v1, but a new player was lost for 10 minutes (audit-playtest).
- Test with real input and compare against `main` in a table of numbers (spiderman #8 #19).
- Run an independent review after merging parallel work. It found real bugs every time (minecraft #36-#38, zelda f552353).
- Add headless simulations for logic that has no visuals (cars #18).
- In each PR, list what was fixed and what was not tested: real phone, two machines, sound by ear (spiderman #20, minecraft #24-#39).
- Do not chase a bug you cannot reproduce. Name the likely cause and move on (spiderman #22).
- Keep at most 1-2 headless GPU browsers at a time. More of them overloads the machine (zelda v2).
