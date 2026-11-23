# HOLLOWMERE blind playtest (first-time player, desktop only)

Scope and limits. The coordinator stopped the session early because the owner's GPU was overloaded. I played about 10 minutes of real time on desktop (1440x900, real keyboard and mouse via playwright, Chrome). I did NOT do the 5-minute phone session. I did NOT read DESIGN.md, so there is no intent-vs-experience section. I did not wake a single beacon. Everything below is what I saw before stopping. Screenshots are in the session scratchpad: /private/tmp/claude-501/-Users-kaleb--claude-spares-spare-TyibKv/e8e6cbbc-e011-4104-af78-0371784e7d38/scratchpad/shots/

## Timeline (what I saw, thought, did)

- 0:00 Title screen. Beautiful (001-load.png). Menu: New Journey, Settings, Controls, Credits. Tagline "Wake the four beacons." I clicked New Journey. A loading screen with a quote ran for a couple of seconds. Fine.
- 0:20 Spawn in the Hollow Shrine glade (003-idle.png). Pretty, lanterns, pillars. HUD: 3 flames top-left, compass top-centre, one pill saying "Leave the Hollow Shrine and head out into Hollowmere", a gold counter top-right. No control hints at all. I did not know what a flame meant (health?), what the gold number was, or how to look around.
- 0:30 WASD moves. Mouse does nothing. Arrow keys move the character (they are not camera keys). I assumed the mouse was broken. I only got camera control after clicking the canvas (pointer lock). Nothing told me to click.
- 1:00 Sprint with Shift works. Objective pill silently changed to "Wake the four beacons (0/4)" after ~20 m of walking, with no sound or flourish that I noticed. I did not know what a beacon is or where to go. The compass shows faint flame icons, but they are low contrast.
- 1:30 I tried Esc and found the Journal (017-esc.png). This is the first screen that actually explains the game: four named beacons with a one-line hint each, plus Find a Bow and the Gloam Spire. It is excellent, but I only found it by guessing. The Controls tab (018-controls.png) is also good (Glide G, parry K, dodge L, etc). The Map tab (019-map.png) lists distances to each beacon.
- 2:00-4:00 I walked north toward "802 m". The distance readouts jumped around (802, 712, 556, 679, 602). I climbed a grassy cliff step, got stuck against a steep rock slope running in place (024-1.png, 027-jump.png). Jump did nothing. No feedback such as "too steep". The camera went almost top-down on the slope and a tree trunk sat between me and the camera (014-full.png). A toast "Rain on the island - Climbing tires you faster" appeared, but there is no stamina bar anywhere, so I did not know what it meant. The toast is also cropped at the left edge and low contrast (015-3.png).
- 4:00 Rain began with no warning. Visibility dropped, ground went flat grey-green.
- 4:30-6:00 I held A to strafe and the camera/character swung round in circles (028-2.png). I opened the map and it told me Thornring was 445 m to the north-west, so I headed NW.
- 6:00 I walked straight off the west coast into the sea (035-3.png). No invisible wall, no warning, no UI. Swimming drained a flame (health) within seconds. I turned around by guess.
- 7:00 Region banner "Whisperwood" appeared (037.png). Nice touch. The compass said the beacon was 85 m, then 38 m.
- 7:30-9:00 I ran into thorn-ruin pillars at the top-left of the screen (039-4.png), then lost them. I stood half inside a boulder with the rock drawn over my character (039-4.png). Against a tree the camera collapsed into the back of the character's head and blocked the whole screen (041-2.png). I overshot the beacon: the map later showed it 167 m behind me. I never saw a beacon, a glow, a light column or any landmark pointing to it.
- 9:00 Dusk came on quickly. By ~9 min the forest was very dark and the beacon was invisible. I opened the map again; the click on Resume did not recapture the mouse, so I was blind to camera control again until I clicked once more (046-map.png, 047-3.png).
- ~10:00 Stopped by coordinator. Zero beacons woken, zero enemies met, zero items found, gold counter still 0.

## Confusion points

1. Start: no instruction on how to move, look, or that you must click to capture the mouse. Mouse look is dead until a click. After closing the map/pause menu it is dead again until another click.
2. The first objective ("Leave the Hollow Shrine") has no marker. The second ("Wake the four beacons") is generic: it does not say which beacon, what "waking" means, or where to go. The only guidance is a faint compass icon and a number.
3. Distance numbers: the HUD number changes among targets and also seems stale (the "38 m" stayed fixed while I walked 60+ m). I could not tell which beacon it referred to.
4. The Journal (the actual tutorial) is behind Esc and nothing points to it.
5. Meaning of the 3 flame icons (health?), the gold diamond counter (glimmers?), "Heart shards 0/36", "Flames 3" on the Gleanings page. The HUD never explains them.
6. "Climbing tires you faster" with no stamina UI. Steep slopes: no sign whether they are climbable, or why I stopped.
7. The map shows the Windward beacon in the east while the Journal says "windy north bluff". Unclear whether the map is north-up.
8. Falling into the sea: no signal that the island edge is a hazard.
9. Beacons are invisible from range. The Thornring ring was in a forest and I walked within ~38 m without seeing it.

## Boring / empty / unrewarding

- 10 minutes, no enemy, no NPC, no pickup, no sound cue I noticed, no reward. The only events were a region banner, a weather toast and a health loss from swimming.
- The nearest beacon is 450-800 m away at spawn. That is a very long first walk with only grass and trees.
- The beacon objective gives no sense of progress or small wins on the way (no chests, glimmers or lore stones appeared on my path).
- Day to dusk happens in ~10 min of play, so the first session goes dark while still lost.
- Flowers/grass are pretty but nothing is interactive.

## Janky

- Camera: clips into trees and goes inside the player's head when you stand against a trunk. It goes near top-down on slopes. Strafing (A/D) makes the camera orbit around the character instead of staying fixed. Mouse sensitivity is high (about 7 px per degree measured, fine).
- Collision: player sinks into boulders and the rock mesh draws over the player (039-4.png). Player runs in place against steep ground with no animation change or message.
- Arrow keys act as movement keys, not camera keys. Many players expect camera.
- Pointer lock is not re-requested on Resume. Mouse look dies after every menu close.
- Rain toast is cropped at the screen edge (015-3.png).
- Sound: I could not hear audio (headless), so I cannot judge it.

## Top 10 changes for the first 10 minutes

1. Add a first-10-seconds control prompt (WASD, Shift, Space, click to look) and make the first click capture the mouse. Re-capture on Resume or show "Click to resume looking".
2. Re-lock the pointer automatically on Resume, and show a visible hint when it is released.
3. Make the objective specific: "Walk north to Thornring Beacon (X m)" with ONE tracked target, an on-screen world marker and a bold compass marker. The distance must update live.
4. Put a bright light column or beam above each beacon, visible from far away, so you see where to go.
5. Put the nearest beacon much closer to spawn (under 150 m) or add a short starter beacon. The first win must land in about 2 minutes.
6. Put something to do on the way in the first 90 seconds: a lantern, a lore stone, a small enemy, a chest, some glimmers with a sound and a popup, to prove the game rewards exploring.
7. Surface the Journal: a first-time "Press Esc for your Journal" prompt, and a short goal line from the Journal under the objective pill.
8. Explain the HUD: label flames as health, gold as glimmers, and add a stamina bar (or remove the stamina toast). Fix the cropped weather toast.
9. Fix camera: collide properly with trees and rocks (pull in without entering the head), cap the downward pitch on slopes, and stop orbiting when strafing. Fix the player sinking into boulders and show "too steep" feedback.
10. Add a soft boundary at the coast (a mist, a warning line, a bounce back) instead of silent drowning, and slow the day cycle or add a lantern light for the first dusk.

## Not covered

- No phone/touch session.
- No combat, no beacon puzzle, no bow, no shrine content.
- No DESIGN.md comparison.
