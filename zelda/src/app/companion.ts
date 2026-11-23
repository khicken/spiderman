import type { BeaconId, CreateCompanion, FrameCtx, GameEvent, Progress, PrologueStep } from "./contracts";
import { PROLOGUE } from "./contracts";
import { BEAT, offPath } from "./landmark-prologue";

/** Tallow's (and Oriel's) lines. 8 words or fewer (memory lines are the story text from DESIGN-V2 section 8).
 *  Guide lines are plain; jokes only in idle and ambient lines.
 *  `voice` lines have a recorded clip at public/voice/<id>.* (T12 manifest); the rest are chirp plus subtitle. */
export interface Line { id: string; text: string; kind: "guide" | "react" | "idle"; voice?: boolean; who?: "tallow" | "oriel" }

const L = (id: string, text: string, kind: Line["kind"], voice = false, who: Line["who"] = "tallow"): Line => ({ id, text, kind, voice, who });

export const LINES: readonly Line[] = [
  // prologue guide
  L("wake", "There you are. Up you get.", "guide", true),
  L("gate", "Light the brazier at the gate.", "guide", true),
  L("gateIdle", "Walk to the brazier.", "guide"),
  L("vista", "Look. The Glade Beacon. Let's light it.", "guide", true),
  L("stones", "Follow the ember stones.", "guide"),
  L("offPath", "The beacon is that way.", "guide"),
  L("wade", "Wet feet are fine. Keep going.", "react"),
  L("climb", "Walk into the rock to climb.", "guide"),
  L("knot", "Thread this knot to the one below.", "guide"),
  L("ride", "Jump onto the line. I'll hold you.", "guide", true),
  L("rideFail", "Get close to the line, then jump.", "guide"),
  L("glade", "Three tasks, then the beacon.", "guide"),
  L("hintPull", "Thread the block, then the post.", "guide"),
  L("hintFight", "Thread a brambling to the fire.", "guide"),
  L("hintCarry", "Thread the fire to the beacon.", "guide"),
  L("fightFire", "Thread it to the fire.", "guide"),
  L("gladeLit", "The Glade Beacon is lit!", "guide", true),
  L("onward", "Four beacons left. Follow the ember path.", "guide"),
  // Oriel at the Glade Waystone
  L("oriel-1", "Four beacons ring the mountain.", "guide", true, "oriel"),
  L("oriel-2", "Light them and the Spire barrier falls.", "guide", true, "oriel"),
  L("oriel-3", "Touch a waystone to travel back here.", "guide", true, "oriel"),
  // memories (one per main beacon, BeaconId order)
  L("mem0", "I was bigger once. I lit ships home.", "guide", true),
  L("mem1", "Someone carried me. Someone kind.", "guide", true),
  L("mem2", "The water rose. They chose the lamp over the boat.", "guide", true),
  L("mem3", "Their name was... I gave it to the dark.", "guide", true),
  // reactions
  L("beaconLit", "Beacon lit. Next one on the compass.", "react"),
  L("noWick", "No wick left. Recall a thread first.", "react"),
  L("tooFar", "Too far. Get closer.", "react"),
  L("lowHearts", "You're hurt. Rest at a waystone.", "react"),
  L("staminaOut", "Out of stamina. Wait a moment.", "react"),
  L("rain", "Rain. Climbing uses more stamina.", "react"),
  L("dusk", "It's getting dark.", "react"),
  L("dawn", "Morning. Finally.", "react"),
  L("waystone", "A waystone. We can travel back here.", "react"),
  L("respawn", "Up again. Try another way.", "react"),
  L("enemy", "Enemy! Shield when you see the glint.", "react"),
  L("parry", "Nice parry!", "react"),
  L("shard", "A heart shard. Four make a heart.", "react"),
  L("secret", "Ooh, a secret.", "react"),
  L("barrier", "The barrier is gone. To the Spire.", "react"),
  L("boss", "That's the Warden. Shield on the glint.", "react"),
  L("bow", "The bow! Now we can reach Windward.", "react"),
  L("swim", "I don't love water.", "react"),
  L("glide", "Wheee! Sorry. Wheee.", "react"),
  L("rideOn", "Hold tight!", "react"),
  L("glimmer", "Glimmers! Grab them all.", "react"),
  // idle (45 s apart at most)
  L("idle1", "I'm a lantern, not a torch. Careful.", "idle"),
  L("idle2", "Do you hear that? Me neither.", "idle"),
  L("idle3", "My wick itches.", "idle"),
  L("idle4", "You walk loud for a hero.", "idle"),
  L("idle5", "I could light this whole hill.", "idle"),
  L("idle6", "Nice view. Shame about the gloam.", "idle"),
  L("idle7", "Fireflies keep asking if I'm single.", "idle"),
  L("idle8", "I used to be bigger, I think.", "idle"),
  L("idle9", "Your cloak smells like smoke. Sorry.", "idle"),
  L("idle10", "Left, right, left. You've got this.", "idle"),
  L("idle11", "If I flicker, that's just me thinking.", "idle"),
  L("idle12", "The mountain is looking at us.", "idle"),
];

const BY_ID = new Map(LINES.map((l) => [l.id, l]));
const IDLE = LINES.filter((l) => l.kind === "idle");
/** Clip id for public/voice: "tallow-wake", "oriel-1". */
export const voiceId = (l: Line) => (l.who === "oriel" ? l.id : `tallow-${l.id}`);
export const VOICED: readonly string[] = LINES.filter((l) => l.voice).map(voiceId);

const COOL = { guide: 8, idle: 45, gap: 4, stale: 3 } as const;
/** s after gladeLit that the shard line may play: the beacon line's 1.5 s delay plus the 4 s gap between lines. */
const SHARD_AFTER_GLADE = 1.5 + COOL.gap + 0.1;
const secsFor = (text: string) => Math.min(5, 1.6 + text.split(" ").length * 0.35);
const ROOM_HINT: Partial<Record<PrologueStep, string>> = { gladePull: "hintPull", gladeFight: "hintFight", gladeCarry: "hintCarry" };

export const createCompanion: CreateCompanion = (_seen: Progress) => {
  // two buffers swapped each update: the caller reads the returned one before the next update clears it
  let out: GameEvent[] = [];
  let ret: GameEvent[] = [];
  const said = new Set<string>();
  let time = 0;
  let lastAny = -99;
  let lastGuide = -99;
  let lastIdle = 0;
  let step: PrologueStep | null = null;
  let stepAt = 0;
  let stillT = 0;
  let offPathAt = -99;
  let roomHinted: PrologueStep | null = null;
  let rideFails = 0;
  let hurtAt = -99;
  let gladeLitAt = -99;
  let idleIx = 0;
  const pending: { id: string; at: number; force: boolean }[] = [];

  /** Queue a line to play `delay` s from now. `force` lines skip cooldowns (scripted beats). */
  function want(id: string, delay = 0, force = false, once = true) {
    if (once && said.has(id)) return;
    if (once) said.add(id);
    pending.push({ id, at: time + delay, force });
  }

  /** Forget queued lines the player has already acted on. */
  function drop(...ids: string[]) {
    for (let i = pending.length - 1; i >= 0; i--) if (ids.includes(pending[i].id)) pending.splice(i, 1);
  }

  function speak(l: Line) {
    out.push({
      type: "say", who: l.who ?? "tallow", line: l.id, text: l.text,
      voice: l.voice ? voiceId(l) : null, seconds: secsFor(l.text),
    });
    lastAny = time;
    if (l.kind === "idle") lastIdle = time;
    else lastGuide = time;
  }

  function flush() {
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      if (time < p.at) continue;
      const l = BY_ID.get(p.id);
      if (!l || time - p.at > COOL.stale + (p.force ? 6 : 0)) {
        pending.splice(i--, 1); // dropped, not queued past 3 s
        continue;
      }
      if (time - lastAny < COOL.gap) continue;
      if (!p.force && l.kind !== "idle" && time - lastGuide < COOL.guide) continue;
      pending.splice(i, 1);
      speak(l);
      return;
    }
  }

  return {
    update(ctx: FrameCtx): readonly GameEvent[] {
      const dt = ctx.realDt;
      time += dt;
      const p = ctx.player;
      const moving = Math.hypot(ctx.input.move.x, ctx.input.move.y) > 0.2;

      if (step === "gate") {
        stillT = moving ? 0 : stillT + dt;
        if (stillT > 10 && time - stepAt > 10) want("gateIdle", 0, true);
      }
      if (step && step !== "done" && step !== "wake" && step !== "gate" && step !== "vista") {
        if (offPath(p.pos.x, p.pos.z) > BEAT.offPathR && time - offPathAt > 30) {
          offPathAt = time;
          want("offPath", 0, false, false);
        }
      }
      const room = step ? ROOM_HINT[step] : undefined;
      if (room && roomHinted !== step && time - stepAt > 90) {
        roomHinted = step;
        want(room, 0, true);
      }
      if (!step || step === "done") {
        if (time - lastIdle > COOL.idle && time - lastAny > 20 && !ctx.enemies.some((e) => e.alive && e.brain !== "idle" && e.brain !== "patrol" && e.brain !== "dead")) {
          lastIdle = time;
          want(IDLE[idleIx++ % IDLE.length].id, 0, false, false);
        }
      }
      if (p.hp > 0 && p.hp <= 4 && time - hurtAt > 120 && p.maxHp > 4) {
        hurtAt = time;
        want("lowHearts", 0, false, false);
      }

      flush();
      const r = out;
      out = ret;
      ret = r;
      out.length = 0;
      return r;
    },

    handle(events: readonly GameEvent[]) {
      for (const e of events) {
        switch (e.type) {
          case "prologue":
            step = e.step;
            stepAt = time;
            stillT = 0;
            if (e.step === "wake") want("wake", 1.2, true);
            else if (e.step === "gate") want("gate", 2.5, true);
            else if (e.step === "stones") want("vista", 0, true);
            else if (e.step === "climb") want("climb", 0.5, true);
            else if (e.step === "ride") want("knot", 0.8, true);
            else if (e.step === "glade") want("glade", 2.8, true);
            // early: the fight often ends inside 10 s, and the line is useless once the bramblings are gone
            else if (e.step === "gladeFight") want("fightFire", 4, true);
            else if (e.step === "gladeCarry") drop("fightFire");
            else if (e.step === "done") lastIdle = time;
            break;
          case "threadLink":
            if (e.use === "ride" && step === "ride") want("ride", 0, true);
            break;
          case "threadRide":
            if (e.on) {
              drop("knot", "ride");
              want("rideOn", 0);
            }
            else if (step === "ride" && Math.hypot(e.pos.x - PROLOGUE.glade.x, e.pos.z - PROLOGUE.glade.z) > BEAT.gladeR) {
              if (++rideFails >= 3) {
                rideFails = 0;
                want("rideFail", 0.5, true, false);
              }
            }
            break;
          case "threadFizzle":
            if (e.why === "far") want("tooFar", 0, false, false);
            break;
          case "gladeLit": {
            gladeLitAt = time;
            want("gladeLit", 1.5, true);
            // the Glade's heart shard lands in the same moment: its line waits until the beacon line is said
            const sh = pending.find((q) => q.id === "shard");
            if (sh) { sh.at = Math.max(sh.at, time + SHARD_AFTER_GLADE); sh.force = true; }
            break;
          }
          case "waystone":
            if (e.id === "ws-glade") {
              want("oriel-1", 0.5, true);
              want("oriel-2", 5, true);
              want("oriel-3", 9.5, true);
              want("onward", 14, true);
            } else if (e.first) want("waystone", 0.5);
            break;
          case "beaconLit":
            want(`mem${e.beacon as BeaconId}`, 3, true);
            break;
          case "pickup":
            if (e.kind === "shard" && time - gladeLitAt < 2) want("shard", SHARD_AFTER_GLADE - (time - gladeLitAt), true); // forced past the 8 s guide cooldown
            else if (e.kind === "shard") want("shard", 0.6);
            else if (e.kind === "bow") want("bow", 0.6);
            else if (e.kind === "glimmer") want("glimmer", 0.8);
            break;
          case "staminaOut": want("staminaOut"); break;
          case "weather": if (e.weather === "rain") want("rain", 0.5); break;
          case "dusk": want("dusk", 0.5); break;
          case "dawn": if (step === "done") want("dawn", 0.5); break;
          case "respawned": want("respawn", 1, false, false); break;
          case "enemyAlert": want("enemy", 0.3); break;
          case "parry": want("parry", 0.2); break;
          case "barrierDown": want("barrier", 2, true); break;
          case "bossWake": want("boss", 2, true); break;
          case "swim": if (e.on) want("swim", 0.5); break;
          case "glide": if (e.on) want("glide", 0.5); break;
        }
      }
    },

    dispose() {
      out.length = 0;
      pending.length = 0;
    },
  };
};
