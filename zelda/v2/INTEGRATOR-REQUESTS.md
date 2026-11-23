# Requests to the integrator, collected from track reports

## T13 (save, bugs) — done
- game.ts:299 frame() no try/catch → wrap steps with guard() from state.ts.
- game.ts:138 freshSave, :412 start() → switch to readSaveV2/SaveDataV2/writeSaveV2 (save.ts).
- game.ts:419 start(): loaded save → pos.y = world.heightAt(x,z).
- game.ts: day clock uses clockScale(quest, playTime) (first day half speed).
- game.ts:293: objectiveText(quest, hasBow, {x,z}) or objectiveLines().
- DESIGN-V2 objective table says Windward "south"; it is north (z=-430). Code follows coordinates.
- contracts.ts: PLAYER.shardsPerHeart=4 vs comment 24 shards vs ledger 12 → reconcile.
- Ledger scripts/check/bug-ledger.json: 119 bugs with owners; check open items after merge.
- Test: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/check/save-check.ts

## T5 (trials) — done. Sims: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/trials/<cliff|wood|lake|bluff|glade>-sim.ts
- T4 landmarks.ts: wire buildGladeTrial(env, tower, sky); TrialHandle.beacon → BeaconId | "glade"; concat props; update while near/active with all events; on load solved(false) if gladeLit, markBonusDone() if glade-rings collected; pass tower.cx/cz/gy; keep clear spot at (cx, cz-24) for beacon bowl; arena centred on PROLOGUE.glade.
- T4 landmark-kit.ts: add Registry.anchor, zone, waystone (trials guard with typeof).
- Integrator: SiteEnv needs collected(id)/markCollected(id) so trial bonuses persist across reload.
- T9: emit threadLink use:"pull" with anchor ids lake:block-N / lake:post-N; use:"ride" + threadRide; threadFire for glade:bowl. pulls.to = fixed anchor pos.
- T10: rule card stays visible between parts and after trialDone; clear on died; show trialRule trial:"glade".
- T6: glade emits no prologue/trialStart. Drive gladePull/gladeFight/gladeCarry from plate id glade:plate, enemyDied group glade-fight, gladeLit, trialRule trial:"glade".
- Integrator: confirm trial pickup glimmer/wick grants item; check double award of power event.
- T7/integrator: Cliffwatch fall needs teleport to last knot.
- T8: despawnGroup must not emit enemyDied. Groups: trial-1-teach, trial-1-test, glade-fight.
- Unverified: Cliffwatch knot slopes vs ride limit 0.44; Windward gap no side walls; Thornring bind/burn are layout hints only.

## T9 (Thread) — done. Sim: node --experimental-strip-types --expose-gc scripts/sim/thread-sim.ts
- Lead decision: end 2 of a knot-knot pair may be measured from end 1 (max 30 m) → sent back to T9.
- contracts: "heavy" in aimReason and threadFizzle.why ("Too heavy") → sent back to T9.
- T7: while ctx.threads.ride.on feet = ride.pos; ignore jump; on threadRide off take ride.vel → air; drain stamina 0.15/s uphill; Thread reads player.exhausted.
- T8: threadBind fires at line form (tether b=-1); enemies handle yank/leash/stagger.
- T4/T5: bramble walls burn off lines with burning:true.
- Integrator: createThread(scene, world, look); feed ctx.anchors, ctx.progress, player.aimOrigin/aimDir; pass arrowHit to handle().

## T6 (onboarding) — done offline, no browser run. Tests: node scripts/copy/copy-audit.mjs ; node scripts/onboard/first-10.mjs [--url]
- layout.tsx:9 "Wake the four beacons." → "Light the four beacons."
- game.ts: createGuide(progress, settings), createCompanion(progress); prologue → quest.prologue; hintDone → progress.hintsSeen; objective → snapshot objective/objectiveSub; track → quest.tracked; cine → rig.cine (skippable).
- T13 state.ts objectiveLines duplicates guide.ts objectiveFor → make one call the other (integrator).
- T4: buildPrologue(env, gateAnchor) in landmarks.ts, anchor "prologue:gate-brazier", light on threadFire; targetPos resolves "gate-brazier"; landmarks.ts:129 "Begin trial" → "Start trial". Knot B lowering after 3 failed rides not built.
- T10: string swaps (sent); HUD chips from guide.ts CHIPS; controls table must not bind Ctrl/Tab.
- T12: voice ids in companion.ts VOICED (12).
- Not built: Tallow drifting to brazier when idle; compass marker pulse.

## T9 follow-up — done (86 checks)
- Ride range from end 1 (30 m / Long 40 m). "heavy" in contracts aimReason + threadFizzle.why.
- T10 ui-hud.tsx:345 add "Too heavy" (sent). Integrator: optional Tallow line for "heavy" in companion.ts:215 (T6 done).

## T8 (combat) — done. Sim: node --experimental-strip-types scripts/sim/combat-sim.ts
- T7 player.ts: createSwordTimer() from combat-events.ts (press/update/activeNow/arcSlice; cancel on hurt/dodge/death/stun/shield; softLockPick()). (sent)
- Integrator: hitstop on Wren only; slowmo → ctx.worldScale; rumble parry SWORD.rumbleParry, block rumbleBlock, hit 0.25/0.06, hit3 0.5/0.12; type enemies as EnemiesV2, merge .anchors into ctx.anchors (warden:chain-0..3); CAMPS in contracts → wood-1 (-255,-44), cliff-base (300,107), lake-shore (126,-266), bluff (-58,-380), cinder-path (60,17); route parry/tell/threadBind to enemies, HUD, audio.
- T4: lit braziers on spire rim near 4 chain anchors (arena center r 22 m). (sent)
- T9 (done): burning line with warden:chain-* end cuts chain → integrator check thread.ts.
- T10: riposte glyph over parry event id. (sent)
- T12: sounds for tell and enemyWindup per enemy kind. (sent)
- Gaps: flood ring does nothing; Warden volley bolts 2-5, slam shockwaves, beam sweep have no tell.

## T4 (world) — done. Check: node --experimental-strip-types scripts/world/world-check.ts
- Wired: buildGladeTrial, buildPrologue, gate-brazier target, "Start trial", spire braziers, burning-line secrets.
- Integrator: contracts WAYSTONES data wrong; T4 overrides in landmark-paths.ts WAYSTONE_AT → sync contracts to (246,-346) sunken, (350,158) ashen, (-320,-150) whisperwood, (75,110) cinder.
- Camps village-bridge (-300,200), lake-ruin, lake-shore stand in water → move (T8 done; integrator).
- T7/integrator: soft world edge via edgeAt + EDGE_BAND in world.ts. (sent T7)
- T2: consume VIEW_CUTS for vista trees. (sent)  T3: render RILL ford. (sent)  T12: propHit chime-* plays notes. (sent)
- Not done: cliff strata, cinder plume, obsidian spire palette, village smoke; blight spawns; glimmer total check; sec-v1-lake item pos.

## T2 (look) — done. Shots v2/shots/t2/
- Integrator: terrain.ts swap waterFrag → T3 waterFragV2, keep fog call hmFogP(col, vWorld).
- T3: sky/cloud shader compile error "ERROR: 0:79: 'flat' : syntax error" (sent).
- T1: RenderV2.setRegionColor → call setRegionColor(beacon,t) from render-look.ts; render.ts ×1.45/×1.3 sky/ground no longer used (sent).
- Open: phone low 194k tris vs 150k budget; noon flat/lime; Whisperwood grey while unlit (judge in play).

## T10 (HUD) — done. Shots v2/shots/t10/
- contracts HudFrame: add trackedAt?: ScreenPoint, riposteAt?: ScreenPoint.
- game.ts: cb.died(where); send 13 markers; fill v2 snapshot fields; route say/hint/trialRule/secret/memory/parry to HUD; optional HudSnapshot.secrets.
- layout.tsx:9 copy fix (still open).
- CREDITS.md in /sfx and /music (T11/T12).
- input.ts re-lock pointer on Resume (sent T7).
- Shader error seen: "nearF" undeclared in world shader.
- Unverified: GameV2.track/travel/chooseEnding exist only in contract.

## T7 (player, camera, input) — done
- HUD: player emits hint {id:"glide", btn:"jump", text:"Glide"} on long falls. Show as chip with input.glyph().
- contracts.ts: add HintId for world-edge "Turn back" (soft edge pushes Wren with no message now).
- Thread: Cliffwatch respawn uses Player.place(pos, yaw, hp). Stamina 0 on uphill ride sets `exhausted`; Thread must drop the line.
- game.ts: hitstop on Wren only (player uses ctx.dt as given).
- game.ts: map/journal resume must use pause()+setEnabled(true) or input.relock().
- Camera -> T14: call hero mesh fade when camera distance < 1.2 m.
- Unverified: pad/touch changes, touch tap-to-lock not done. Check in browser playtest.

## T14 (hero model) — done
- game.ts: switch to HeroAnimIn / newHeroAnimIn(); call model.setOutline(QualityPreset.heroOutline).
- game.ts: call model.setCameraDistance(d) each frame (fade <1.2 m, hidden <=0.7 m). Unverified in browser.
- Playtest: check sword visible in attack pose (one shot showed none), glider sail, bow, glow/trail vs post pass.
- Shots in v2/shots/t14/ (45 files). Decide keep/delete before commit.

## T3 (sky, water, fx) — done, browser check re-run on slot B
- terrain.ts: import waterFragV2 instead of waterFrag.
- Fireflies are a separate Points draw (nature-life.ts); merging into fx pool = optional follow-up.
- Shaft bases use cam.y-7 (no terrain height lookup); check float/clip on slopes.

## T12 (sfx, ambience, voice, mix) — done
- zelda/package.json: add devDependency node-web-audio-api ^1 (scripts only).
- game.ts: call setVolumes(master, music, sfx, Settings.voice); route `say` events to audio.handle; audio.ready promise.
- Settings: show CC0 credit note (public/sfx/CREDITS.md).
- tsc: player-sim.ts errors T12 saw are gone (tsc clean at T12 finish).
- Playtest by ear: chirp, HRTF/occlusion, duck depth, beds for traffic/voices. Nobody listened yet.

## T11 (music) — done
- No requests. audio.ts calls music.handle/update. Listen in playtest: theme opening vs Tetris falling run, stretched-note pitch, held-note seams, 30-90 s silences, Safari .m4a decode.
- T3 browser pass: 0 console errors, ~61 fps, 137 draws on high. Camera inside a teal/brown dome mesh near shrine (shrine-spirit-high.png) — find owner. waterFragV2 still unwired.
