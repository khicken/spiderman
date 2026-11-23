import type {
  BeaconId, BtnName, CreateGuide, Device, FrameCtx, GameEvent, Guide, HintId, Progress, PrologueStep, QuestState, Settings,
  TrackTarget, V3,
} from "./contracts";
import { LANDMARKS, PLAYER_SPAWN, PROLOGUE } from "./contracts";
import { BEAT, GATE_ANCHOR, GATE_ITEM, PROLOGUE_ORDER, stepPrologue } from "./landmark-prologue";
import type { PrologueFacts } from "./landmark-prologue";

// ---------------------------------------------------------------------------------------------------------------------
// Data tables (DESIGN-V2.md section 10). The HUD renders these; it does not write its own copy.
// ---------------------------------------------------------------------------------------------------------------------

/** Chip text per device. Each chip is 3 words or fewer. */
export const CHIPS: Record<HintId, { btn: BtnName | "move" | "look"; keys: string; pad: string; touch: string }> = {
  move: { btn: "move", keys: "WASD Move", pad: "Left stick Move", touch: "Drag Move" },
  look: { btn: "look", keys: "Mouse Look", pad: "Right stick Look", touch: "Drag Look" },
  use: { btn: "use", keys: "E Light", pad: "Y Light", touch: "Hand Light" },
  jump: { btn: "jump", keys: "Space Jump", pad: "A Jump", touch: "Jump" },
  climb: { btn: "move", keys: "Walk into wall", pad: "Push into wall", touch: "Push into wall" },
  thread: { btn: "thread", keys: "R Thread", pad: "LB Thread", touch: "Thread" },
  ride: { btn: "jump", keys: "Jump to ride", pad: "A to ride", touch: "Jump to ride" },
  attack: { btn: "attack", keys: "Click Attack", pad: "X Attack", touch: "Attack" },
  block: { btn: "block", keys: "Right mouse Shield", pad: "LT Shield", touch: "Shield" },
  parry: { btn: "block", keys: "Shield on glint", pad: "LT on glint", touch: "Shield on glint" },
  dodge: { btn: "dodge", keys: "C Dodge", pad: "B Dodge", touch: "Dodge" },
  sprint: { btn: "sprint", keys: "Shift Sprint", pad: "Hold B Sprint", touch: "Double-tap Sprint" },
  glide: { btn: "glide", keys: "G Glide", pad: "A Glide", touch: "Glide" },
  lock: { btn: "lock", keys: "Q Lock on", pad: "RB Lock on", touch: "Tap enemy" },
  bow: { btn: "bow", keys: "Hold F Aim", pad: "Hold RT Aim", touch: "Hold Bow" },
  map: { btn: "map", keys: "M Map", pad: "View Map", touch: "Map" },
  journal: { btn: "pause", keys: "Esc Journal", pad: "Menu Journal", touch: "Pause Journal" },
  recall: { btn: "thread", keys: "Hold R Recall", pad: "Hold LB Recall", touch: "Recall thread" },
  edge: { btn: "move", keys: "Turn back", pad: "Turn back", touch: "Turn back" },
};

export function chipText(id: HintId, device: Device): string {
  const c = CHIPS[id];
  return device === "pad" ? c.pad : device === "touch" ? c.touch : c.keys;
}

export const BEACON_NAME: readonly string[] = ["Cliffwatch", "Thornring", "Drowned", "Windward"];
const BEACON_POS = (["beacon-cliff", "beacon-wood", "beacon-lake", "beacon-bluff"] as const).map((id) => LANDMARKS.find((l) => l.id === id)!);
const GLADE_POS = PROLOGUE.glade;

const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;
/** Compass word for a vector on xz. Island north is -z. */
export function compassWord(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz);
  return DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
/** Suggested order: teach to test (DESIGN-V2.md section 4). */
export const BEACON_ORDER: readonly BeaconId[] = [0, 1, 2, 3];

export const OBJ = {
  gate: "Light the brazier at the gate",
  glade: "Light the Glade Beacon",
  gladeSub: "Follow the ember stones",
  roomsSub: "Finish the 3 tasks by the beacon",
  bowSub: "Find the bow in the Mirebrook mill (west)",
  spire: "Climb Mt. Cinder to the Gloam Spire (center)",
  boss: "Defeat the Gloam Warden",
  done: "Main quest done. Explore the island",
} as const;

const lit = (q: QuestState) => q.beacons.filter(Boolean).length;

/** The next main beacon: the tracked one if it is still dark, else the first dark one in the suggested order. */
export function nextBeacon(q: QuestState): BeaconId | null {
  const t = q.tracked;
  if (t && t.kind === "beacon" && !q.beacons[t.id]) return t.id;
  for (const b of BEACON_ORDER) if (!q.beacons[b]) return b;
  return null;
}

/** Objective line and sub-line for a quest state. Pure. `roomSub` is the Glade trial's current room rule; `from` is
 *  where the direction word is measured from (the Glade when absent). */
export function objectiveFor(
  q: QuestState, hasBow: boolean, roomSub: string | null = null, from: { x: number; z: number } = GLADE_POS,
): { text: string; sub: string | null } {
  switch (q.stage) {
    case "awaken": {
      const s = q.prologue ?? "wake";
      if (s === "wake" || s === "gate") return { text: OBJ.gate, sub: null };
      if (s === "vista" || s === "stones" || s === "climb" || s === "ride") return { text: OBJ.glade, sub: OBJ.gladeSub };
      if (s !== "done") return { text: OBJ.glade, sub: roomSub ?? OBJ.roomsSub };
      return beaconsLine(q, hasBow, from);
    }
    case "beacons":
      return beaconsLine(q, hasBow, from);
    case "spire":
      return { text: OBJ.spire, sub: null };
    case "boss":
      return { text: OBJ.boss, sub: null };
    default:
      return { text: OBJ.done, sub: null };
  }
}

function beaconsLine(q: QuestState, hasBow: boolean, from: { x: number; z: number }): { text: string; sub: string | null } {
  const n = lit(q);
  const b = nextBeacon(q);
  if (b === null) return { text: OBJ.spire, sub: null };
  const dir = compassWord(BEACON_POS[b].x - from.x, BEACON_POS[b].z - from.z);
  const text = `Light the 4 beacons (${n}/4). Next: ${BEACON_NAME[b]}, ${dir}`;
  return { text, sub: b === 3 && !hasBow ? OBJ.bowSub : null };
}

/** What the compass and lantern should point at. */
export function autoTarget(q: QuestState, step: PrologueStep, hasBow: boolean): TrackTarget {
  if (q.stage === "awaken" && step !== "done") {
    if (step === "wake" || step === "gate") return { kind: "item", id: GATE_ITEM };
    return { kind: "glade" };
  }
  if (q.stage === "awaken" || q.stage === "beacons") {
    const b = nextBeacon(q);
    if (b === null) return { kind: "spire" };
    if (b === 3 && !hasBow) return { kind: "item", id: "chest-bow" };
    return { kind: "beacon", id: b };
  }
  if (q.stage === "spire" || q.stage === "boss") return { kind: "spire" };
  return { kind: "none" };
}

const sameTarget = (a: TrackTarget, b: TrackTarget) =>
  a.kind === b.kind && (a as { id?: unknown }).id === (b as { id?: unknown }).id;

// ---------------------------------------------------------------------------------------------------------------------
// Guide: prologue step machine, chips, objective line, auto-track, cinematics.
// ---------------------------------------------------------------------------------------------------------------------

/** "Light" prompt radius at the gate brazier. landmarks.ts registers the prompt with the same radius. */
export const GATE_USE_R = 3.5;

const CHIP_SHOW = 8; // s on screen before it fades by itself
const LOOK_SHOW = 6; // the look chip is a nudge: it retires after 6 s and never comes back
/** Chips that step aside at once when a place-based chip (Jump at the stones, Climb at the rock) is asked for. */
const SOFT = new Set<HintId>(["move", "look"]);
/** Second thread chip, after knot A is pinned in the prologue (the chip id stays "thread"). */
const LINK_TEXT = { keys: "R Link to next knot", pad: "LB Link to next knot", touch: "Thread next knot" } as const;
const CHIP_RETURN = 20; // s after fading, an unused chip comes back once

const COMBAT = new Set<HintId>(["attack", "block", "parry", "dodge", "lock"]);

interface ChipSlot { id: HintId; t: number; returns: number }

const GLADE_BEACON = LANDMARKS.find((l) => l.id === "beacon-glade")!;

export interface GuideV2 extends Guide {
  setSettings(s: Settings): void;
  readonly step: PrologueStep;
}

export const createGuide: CreateGuide = (progress: Progress, settings: Settings): GuideV2 => {
  let hints = settings.hints;
  const seen = new Set<HintId>(progress.hintsSeen);
  // two buffers swapped each update: the caller reads the returned one before the next update clears it
  let out: GameEvent[] = [];
  let ret: GameEvent[] = [];

  let started = false;
  let step: PrologueStep = "wake";
  let stepT = 0;
  let time = 0;

  // chips
  let chip: ChipSlot | null = null;
  const queue: HintId[] = [];
  const faded: { id: HintId; at: number }[] = [];
  const asked = new Set<HintId>();

  // facts gathered from events (handle) and frames (update)
  let gateLit = false;
  let gladeLit = false;
  let riding = false;
  // Glade trial room (T5 landmark-trial-glade): its first rule starts pull, plate "glade:plate" on starts fight,
  // and the rule after a "glade-fight" kill starts carry. Counting rules alone breaks when the trial is aborted and restarted.
  let gladeRoom: 0 | 1 | 2 | 3 = 0;
  let gladeKills = 0;
  let roomSub: string | null = null;
  let movedT = 0;
  let movedAt = -1;
  let lookAcc = 0;
  let walkT = 0;
  let rideFails = 0;
  let rodeFromA = false;
  let mapAt = -1;
  let journalAt = -1;
  let linkShown = false;
  let device: Device = "keys";
  const used = new Set<HintId>(); // verbs done this session (an event may land before its chip shows)

  let objText = "";
  let objSub: string | null = null;
  let objectiveOn = false;
  let tracked: TrackTarget = { kind: "none" };
  let lastObjCheck = -1;
  // direction words are measured from where Wren stood when the target last changed (or she moved 150 m), so the
  // line does not flicker between "north" and "north-east" while she walks
  const dirFrom: { x: number; z: number } = { x: GLADE_POS.x, z: GLADE_POS.z };
  let dirFor = -1;

  const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

  function emitHint(id: HintId, device: Device) {
    chip = { id, t: 0, returns: chip?.id === id ? chip.returns : 0 };
    out.push({ type: "hint", id, btn: CHIPS[id].btn, text: chipText(id, device) });
  }

  /** Ask for a chip. Shown once ever, one at a time; later asks wait in a short queue. */
  function ask(id: HintId) {
    if (!hints || seen.has(id) || asked.has(id) || used.has(id)) return;
    asked.add(id);
    if (chip || queue.length) queue.push(id);
    else queue.unshift(id);
  }

  /** Ask for a chip that matters right now: it replaces a non-combat chip on screen instead of waiting its turn. */
  function urgent(id: HintId) {
    if (!hints || seen.has(id) || used.has(id)) return;
    if (chip && chip.id === id) return;
    asked.add(id);
    const qi = queue.indexOf(id);
    if (qi >= 0) queue.splice(qi, 1);
    if (chip && !COMBAT.has(chip.id)) {
      queue.unshift(chip.id); // the bumped chip comes back after
      chip = null;
    }
    if (chip) queue.unshift(id);
    else urgentNow = id;
  }
  let urgentNow: HintId | null = null;

  /** Ask for a chip tied to where Wren stands: a move/look chip on screen steps aside for it. */
  function place(id: HintId) {
    if (!hints || seen.has(id) || asked.has(id) || used.has(id)) return;
    if (chip && SOFT.has(chip.id)) {
      if (chip.returns === 0 && chip.id !== "look") faded.push({ id: chip.id, at: time });
      chip = null;
    }
    asked.add(id);
    queue.unshift(id);
  }

  function done(id: HintId) {
    used.add(id);
    if (seen.has(id)) return;
    if (!asked.has(id) && !(chip && chip.id === id)) {
      seen.add(id); // used it before we asked: never teach it
      out.push({ type: "hintDone", id });
      return;
    }
    seen.add(id);
    out.push({ type: "hintDone", id });
    if (chip && chip.id === id) chip = null;
    const qi = queue.indexOf(id);
    if (qi >= 0) queue.splice(qi, 1);
    for (let i = faded.length - 1; i >= 0; i--) if (faded[i].id === id) faded.splice(i, 1);
  }

  function setStep(s: PrologueStep) {
    if (s === step) return;
    step = s;
    stepT = 0;
    out.push({ type: "prologue", step: s });
  }

  function cine(ctx: FrameCtx, shot: "wake" | "vista" | "arena", seconds: number) {
    const H = (x: number, z: number) => ctx.world.heightAt(x, z);
    if (shot === "wake") {
      const s = PLAYER_SPAWN;
      out.push({ type: "cine", shot, pos: v3(s.x + 2.5, H(s.x, s.z) + 1.6, s.z + 3), look: v3(s.x, H(s.x, s.z) + 0.6, s.z), seconds });
    } else if (shot === "vista") {
      const v = PROLOGUE.vista;
      out.push({ type: "cine", shot, pos: v3(v.x, H(v.x, v.z) + 9, v.z + 6), look: v3(v.lookAt.x, H(v.lookAt.x, v.lookAt.z) + 6, v.lookAt.z), seconds });
    } else {
      const g = PROLOGUE.glade;
      out.push({ type: "cine", shot, pos: v3(g.x + 6, H(g.x, g.z + 26) + 8, g.z + 26), look: v3(GLADE_BEACON.x, H(GLADE_BEACON.x, GLADE_BEACON.z) + 8, GLADE_BEACON.z), seconds });
    }
  }

  function anyInput(ctx: FrameCtx): boolean {
    const i = ctx.input;
    if (Math.abs(i.move.x) + Math.abs(i.move.y) > 0.2) return true;
    for (const k in i.btn) if (i.btn[k as BtnName].pressed) return true;
    return false;
  }

  function updateChips(ctx: FrameCtx, dt: number) {
    const device = ctx.input.device;
    if (chip) {
      chip.t += dt;
      if (chip.id === "look" && chip.t >= LOOK_SHOW) {
        // retire it: hintDone clears it from the HUD now instead of at the HUD's own 14 s timeout
        seen.add("look");
        out.push({ type: "hintDone", id: "look" });
        chip = null;
      } else if (chip.t >= CHIP_SHOW) {
        if (chip.returns === 0) faded.push({ id: chip.id, at: time });
        chip = null;
      }
    }
    if (!chip) {
      for (let i = 0; i < faded.length; i++) {
        if (time - faded[i].at >= CHIP_RETURN) {
          const id = faded[i].id;
          faded.splice(i, 1);
          if (!seen.has(id) && hints) {
            emitHint(id, device);
            chip!.returns = 1;
          }
          break;
        }
      }
    }
    if (!chip && urgentNow && hints) {
      const id = urgentNow;
      urgentNow = null;
      if (!seen.has(id)) emitHint(id, device);
    }
    if (!chip && queue.length && hints) {
      const id = queue.shift()!;
      if (!seen.has(id)) emitHint(id, device);
    }
  }

  function updateObjective(ctx: FrameCtx) {
    const q = ctx.quest;
    // the gate line stays up through the vista cine; the Glade line lands when control returns (0:22)
    const shown: PrologueStep = step === "vista" ? "gate" : step;
    const stage = step === "done" && q.stage === "awaken" && gladeLit ? "beacons" : q.stage;
    const qq: QuestState = q.prologue === shown && q.stage === stage ? q : { ...q, prologue: shown, stage };
    const nb = qq.stage === "beacons" ? nextBeacon(qq) ?? -1 : -1;
    const pp = ctx.player.pos;
    if (nb !== dirFor || Math.hypot(pp.x - dirFrom.x, pp.z - dirFrom.z) > 150) {
      dirFor = nb;
      dirFrom.x = pp.x;
      dirFrom.z = pp.z;
    }
    const o = objectiveFor(qq, ctx.player.hasBow, roomSub, dirFrom);
    // the compass pip and distance lead the objective line: the brazier is marked from the first frame (DESIGN-V2 14)
    if (q.autoTrack !== false) {
      const t = autoTarget(qq, step, ctx.player.hasBow);
      if (!sameTarget(t, tracked)) {
        tracked = t;
        out.push({ type: "track", target: t, auto: true });
      }
    }
    if (!objectiveOn) return;
    if (o.text !== objText || o.sub !== objSub) {
      objText = o.text;
      objSub = o.sub;
      out.push({ type: "objective", text: o.text, sub: o.sub });
    }
  }

  return {
    get step() { return step; },

    setSettings(s: Settings) {
      hints = s.hints;
      if (!hints && chip) {
        out.push({ type: "hintDone", id: chip.id });
        chip = null;
      }
    },

    objective(q: QuestState, hasBow: boolean) {
      return objectiveFor(q, hasBow, roomSub, dirFrom);
    },

    update(ctx: FrameCtx): readonly GameEvent[] {
      const dt = ctx.realDt;
      const p = ctx.player;
      const inp = ctx.input;
      device = inp.device;
      time += dt;

      if (!started) {
        started = true;
        const q = ctx.quest;
        gladeLit = !!q.gladeLit || q.stage !== "awaken";
        step = gladeLit ? "done" : q.prologue ?? "wake";
        if (step === "wake") {
          out.push({ type: "prologue", step });
          cine(ctx, "wake", BEAT.wakeSecs);
        } else {
          objectiveOn = true; // loaded mid-game: show it now
        }
        if (PROLOGUE_ORDER.indexOf(step) > PROLOGUE_ORDER.indexOf("gate")) gateLit = true;
      }
      stepT += dt;

      // gate brazier: the anchor reports lit, or Wren pressed use next to it
      if (!gateLit && step === "gate") {
        const g = PROLOGUE.gateBrazier;
        const near = Math.hypot(p.pos.x - g.x, p.pos.z - g.z) < GATE_USE_R;
        const a = ctx.anchors?.find((x) => x.id === GATE_ANCHOR);
        if ((a && a.lit) || (near && inp.btn.use.pressed)) {
          gateLit = true;
          if (!(a && a.lit)) out.push({ type: "threadFire", anchor: GATE_ANCHOR, pos: v3(g.x, ctx.world.heightAt(g.x, g.z) + 1, g.z) });
          done("use");
        }
      }

      // step machine
      const facts: PrologueFacts = {
        stepT, x: p.pos.x, y: p.pos.y, z: p.pos.z, ground: ctx.world.heightAt(p.pos.x, p.pos.z),
        anyInput: anyInput(ctx), gateLit, riding, gladeLit, gladeRoom,
      };
      const prev = step;
      setStep(stepPrologue(step, facts));
      if (step !== prev) {
        if (step === "gate") objectiveOn = false;
        if (step === "glade") cine(ctx, "arena", BEAT.arenaSecs);
        if (step === "done") mapAt = time + 30; // Oriel's waystone usually asks first
      }
      if (step !== prev) lastObjCheck = -1;
      if (step === "gate" && !objectiveOn && stepT >= BEAT.objectiveDelay) {
        objectiveOn = true;
        lastObjCheck = -1;
        ask("move");
      }
      if (step === "vista" && prev === "vista" && stepT - dt < BEAT.litToVista && stepT >= BEAT.litToVista) {
        cine(ctx, "vista", BEAT.vistaSecs);
      }
      if (step === "wake") objectiveOn = false;

      // verbs done from the frame
      const mv = Math.hypot(inp.move.x, inp.move.y);
      if (mv > 0.3) {
        movedT += dt;
        if (movedT > 0.5 && movedAt < 0) movedAt = time;
        if (movedT > 0.5) done("move");
      }
      lookAcc += Math.abs(inp.look.x) + Math.abs(inp.look.y);
      if (lookAcc > 0.5) done("look");
      if (movedAt >= 0 && time - movedAt > 2 && lookAcc < 0.3 && step !== "wake") ask("look");
      if (p.sprinting) done("sprint");
      if (inp.btn.map.pressed) done("map");
      if (inp.btn.pause.pressed) done("journal");
      if (inp.btn.jump.pressed) done("jump");
      if (p.lockId >= 0) done("lock");

      // chips the world asks for
      const P = PROLOGUE;
      const dxz = (x: number, z: number) => Math.hypot(p.pos.x - x, p.pos.z - z);
      if ((step === "stones" || step === "climb") && dxz(P.stones.x, P.stones.z) < BEAT.stonesR) place("jump");
      if ((step === "stones" || step === "climb") && dxz(P.ledge.x, P.ledge.z) < BEAT.stonesR) place("jump");
      if (step === "climb" && dxz(P.climbRock.x, P.climbRock.z) < BEAT.climbR) place("climb");
      if (step === "ride" && !riding && !rodeFromA) ask("thread");
      if (step === "done" && p.mode === "ground" && mv > 0.8 && !p.sprinting) {
        walkT += dt;
        if (walkT > 4) ask("sprint");
      } else walkT = 0;
      // the glide chip comes from player.ts, which checks fall speed and drop height; a queued ask could land on the ground
      const th = ctx.threads;
      if (th && inp.btn.thread.pressed && th.used >= th.wick && th.wick > 0) ask("recall");
      if (mapAt >= 0 && time >= mapAt) {
        mapAt = -1;
        ask("map");
        journalAt = time + 40;
      }
      if (journalAt >= 0 && time >= journalAt && used.has("map")) {
        journalAt = -1;
        ask("journal");
      }
      // ride fails: let go of the line short of the glade three times, the ride chip comes back
      if (rideFails >= 3) {
        rideFails = 0;
        if (seen.has("ride")) {
          seen.delete("ride");
          asked.delete("ride");
          used.delete("ride");
          ask("ride");
        }
      }

      updateChips(ctx, dt);
      if (time - lastObjCheck >= 0.25) {
        lastObjCheck = time;
        updateObjective(ctx);
      }

      const r = out;
      out = ret;
      ret = r;
      out.length = 0;
      return r;
    },

    handle(events: readonly GameEvent[]) {
      for (const e of events) {
        switch (e.type) {
          case "jump": done("jump"); break;
          case "climb": if (e.on) done("climb"); break;
          case "threadPin":
            // first pin in the prologue: knot A holds, now say where the other end goes
            if (!linkShown && hints && !seen.has("thread") && (step === "climb" || step === "ride") && e.end === 1 && e.anchor.startsWith("prologue:knot")) {
              linkShown = true;
              const qi = queue.indexOf("thread");
              if (qi >= 0) queue.splice(qi, 1);
              for (let i = faded.length - 1; i >= 0; i--) if (faded[i].id === "thread") faded.splice(i, 1);
              asked.add("thread");
              chip = { id: "thread", t: 0, returns: 1 };
              out.push({ type: "hint", id: "thread", btn: "thread", text: device === "pad" ? LINK_TEXT.pad : device === "touch" ? LINK_TEXT.touch : LINK_TEXT.keys });
            } else done("thread");
            break;
          case "threadLink":
            done("thread");
            if (e.use === "ride") ask("ride");
            break;
          case "threadRide":
            riding = e.on;
            if (e.on) {
              done("ride");
              rodeFromA = true;
            } else if (step === "ride" && Math.hypot(e.pos.x - PROLOGUE.glade.x, e.pos.z - PROLOGUE.glade.z) > BEAT.gladeR) {
              rideFails++;
            }
            break;
          case "threadCut": if (e.why === "recall") done("recall"); break;
          case "swing": done("attack"); break;
          case "shield": if (e.on) done("block"); break;
          case "parry": done("parry"); break;
          case "dodge": done("dodge"); break;
          case "glide": if (e.on) done("glide"); break;
          case "bowDraw": done("bow"); break;
          case "lock": if (e.id >= 0) done("lock"); break;
          case "pickup": if (e.kind === "bow") ask("bow"); break;
          case "trialRule":
            if (e.trial === "glade") {
              roomSub = e.text;
              if (gladeRoom === 0) gladeRoom = 1;
              else if (gladeRoom === 2 && gladeKills > 0) gladeRoom = 3;
            }
            break;
          case "plate":
            if (e.id === "glade:plate" && e.on && gladeRoom === 1) {
              gladeRoom = 2;
              gladeKills = 0;
              ask("attack");
            }
            break;
          case "enemyDied":
            if (e.group === "glade-fight" && gladeRoom === 2) gladeKills++;
            break;
          case "tell":
          case "enemyWindup":
            // first fight: the shield chip lands on the first glint, ahead of any non-combat chip still waiting
            if (used.has("attack") || gladeRoom === 2) urgent("block");
            if (gladeLit && used.has("block")) ask("parry");
            if (gladeLit && used.has("parry")) ask("dodge");
            break;
          case "enemyAlert": if (gladeLit) ask("lock"); break;
          case "gladeLit":
            gladeLit = true;
            roomSub = null;
            break;
          case "waystone":
            if (e.id === "ws-glade" && !used.has("map")) mapAt = time;
            break;
          case "threadFire": if (e.anchor === GATE_ANCHOR) gateLit = true; break;
        }
      }
    },

    dispose() {
      out.length = 0;
      queue.length = 0;
      faded.length = 0;
    },
  };
};
