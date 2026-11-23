import type { GameEvent, Strike, Shot, Team } from "./contracts";
import { SWORD } from "./contracts";

type HitEv = Extract<GameEvent, { type: "hit" }>;
type ArrowHitEv = Extract<GameEvent, { type: "arrowHit" }>;
type PropHitEv = Extract<GameEvent, { type: "propHit" }>;
type PickupEv = Extract<GameEvent, { type: "pickup" }>;
type StopEv = Extract<GameEvent, { type: "hitstop" }>;
type ShakeEv = Extract<GameEvent, { type: "shake" }>;
type ParryEv = Extract<GameEvent, { type: "parry" }>;
type SlowEv = Extract<GameEvent, { type: "slowmo" }>;

const HITS = 64, ARROW_HITS = 32, PROP_HITS = 32, PICKUPS = 32;

/** Preallocated event objects. A frame's events are valid until the next reset(); consumers must copy what they keep. */
export function createEmitter() {
  const out: GameEvent[] = [];
  const hits: HitEv[] = Array.from({ length: HITS }, () => ({
    type: "hit", team: "player", target: 0, source: 0, damage: 0, pos: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 },
    kind: "sword", blocked: false, parried: false, knockback: 0,
  }));
  const arrowHits: ArrowHitEv[] = Array.from({ length: ARROW_HITS }, () => ({ type: "arrowHit", pos: { x: 0, y: 0, z: 0 }, on: "ground" }));
  const propHits: PropHitEv[] = Array.from({ length: PROP_HITS }, () => ({ type: "propHit", id: "", pos: { x: 0, y: 0, z: 0 }, by: "arrow" }));
  const pickups: PickupEv[] = Array.from({ length: PICKUPS }, () => ({ type: "pickup", kind: "glimmer", amount: 0, pos: { x: 0, y: 0, z: 0 }, id: "" }));
  const stop: StopEv = { type: "hitstop", seconds: 0 };
  const shake: ShakeEv = { type: "shake", strength: 0 };
  const parryEv: ParryEv = { type: "parry", id: -1, pos: { x: 0, y: 0, z: 0 } };
  const slow: SlowEv = { type: "slowmo", scale: 1, seconds: 0 };
  let parried = false, slowed = false;
  let hi = 0, ai = 0, pi = 0, ki = 0;

  return {
    events: out as readonly GameEvent[],
    reset() { out.length = 0; hi = ai = pi = ki = 0; stop.seconds = 0; shake.strength = 0; parried = slowed = false; },
    /** A parry this frame (one per frame): `id` is the parried enemy. */
    parry(id: number, px: number, py: number, pz: number) {
      if (parried) return;
      parried = true;
      parryEv.id = id; parryEv.pos.x = px; parryEv.pos.y = py; parryEv.pos.z = pz;
      out.push(parryEv);
    },
    /** World time scale request; Wren and the camera keep real time. */
    slowmo(scale: number, seconds: number) {
      if (slowed) return;
      slowed = true;
      slow.scale = scale; slow.seconds = seconds;
      out.push(slow);
    },
    hit(
      team: Team, target: number, source: number, damage: number, px: number, py: number, pz: number,
      dx: number, dy: number, dz: number, kind: Strike["kind"] | Shot["kind"], blocked: boolean, parried: boolean, knockback: number,
    ) {
      const e = hits[hi++ % HITS];
      e.team = team; e.target = target; e.source = source; e.damage = damage;
      e.pos.x = px; e.pos.y = py; e.pos.z = pz; e.dir.x = dx; e.dir.y = dy; e.dir.z = dz;
      e.kind = kind; e.blocked = blocked; e.parried = parried; e.knockback = knockback;
      out.push(e);
    },
    arrowHit(px: number, py: number, pz: number, on: ArrowHitEv["on"]) {
      const e = arrowHits[ai++ % ARROW_HITS];
      e.pos.x = px; e.pos.y = py; e.pos.z = pz; e.on = on;
      out.push(e);
    },
    propHit(id: string, px: number, py: number, pz: number, by: PropHitEv["by"]) {
      const e = propHits[pi++ % PROP_HITS];
      e.id = id; e.pos.x = px; e.pos.y = py; e.pos.z = pz; e.by = by;
      out.push(e);
    },
    pickup(id: string, amount: number, px: number, py: number, pz: number) {
      const e = pickups[ki++ % PICKUPS];
      e.id = id; e.amount = amount; e.pos.x = px; e.pos.y = py; e.pos.z = pz;
      out.push(e);
    },
    /** Keep the strongest request of the frame; flush() emits one event of each. */
    feel(hitstop: number, shk: number) {
      if (hitstop > stop.seconds) stop.seconds = hitstop;
      if (shk > shake.strength) shake.strength = Math.min(1, shk);
    },
    flush() {
      if (stop.seconds > 0) out.push(stop);
      if (shake.strength > 0) out.push(shake);
    },
  };
}
export type Emitter = ReturnType<typeof createEmitter>;

// ---------------------------------------------------------------------------------------------------------------------
// v2 pure combat rules. No three.js, no allocation per frame: the player module, enemies and scripts/sim share them.
// ---------------------------------------------------------------------------------------------------------------------

type SwordPhase = "idle" | "startup" | "active" | "recovery";

/** Hitstop for one landed hit, in seconds. Only the attacker and the victim freeze; the world keeps running. */
export function hitstopFor(kind: Strike["kind"] | Shot["kind"], knockback: number): number {
  switch (kind) {
    case "spin": case "riposte": return SWORD.hitstopLocal[2];
    case "sword": return knockback >= SWORD.knockbackStep[2] ? SWORD.hitstopLocal[2] : SWORD.hitstopLocal[0];
    case "arrow": return 0.03;
    case "bind": case "burn": case "bolt": return 0;
    default: return SWORD.hitstopHurtMax; // enemy blows on Wren
  }
}

/**
 * Wren's 3-step combo clock (SWORD.startup / active / recovery). The player module calls press() on the frame the
 * attack button goes down, then update(dt) every frame, and submits a Strike every frame while `activeNow` is true,
 * using arcSlice() so the hit lands where the blade is. cancel() on every exit path: hurt, dodge, death, stun, shield.
 * Chain rule: a press inside the last SWORD.chainWindow s of recovery (or buffered 0.15 s before it) queues the next
 * step, which starts the frame recovery ends. A press in the last 0.08 s gives +SWORD.lateBonus damage.
 */
export function createSwordTimer() {
  const BUFFER = 0.15, LATE = 0.08;
  let pressStart = 0;
  const s = {
    phase: "idle" as SwordPhase,
    step: 0, // 1..3 while swinging, 0 idle
    t: 0, // s inside the current phase
    queued: false,
    late: false, // the queued press was a late (perfect) press
    lateNow: false, // the current step was started by a late press
    activeNow: false, // strike this frame
    u0: 0, u1: 0, // arc progress covered this frame (0..1) while active
    started: 0, // step that started this frame, 0 none (fire "swing" event)
    ended: false, // the combo ended this frame (back to idle)
    /** Damage of the current step, with the late bonus. */
    damage(): number {
      const i = Math.max(0, Math.min(2, s.step - 1));
      return SWORD.combo[i] * (s.lateNow ? 1 + SWORD.lateBonus : 1);
    },
    knockback(): number {
      return SWORD.knockbackStep[Math.max(0, Math.min(2, s.step - 1))];
    },
    /** Seconds left until recovery ends (Infinity while idle). */
    left(): number {
      if (s.phase === "idle") return Infinity;
      const i = s.step - 1;
      const r = SWORD.recovery[i];
      if (s.phase === "recovery") return r - s.t;
      if (s.phase === "active") return SWORD.active[i] - s.t + r;
      return SWORD.startup[i] - s.t + SWORD.active[i] + r;
    },
    press(): void {
      if (s.phase === "idle") { begin(1, false); pressStart = 1; return; }
      const left = s.left();
      if (left > SWORD.chainWindow + BUFFER || s.queued) return; // too early: ignored, so mashing does not chain
      s.queued = true;
      s.late = left <= LATE;
    },
    update(dt: number): void {
      s.started = pressStart;
      pressStart = 0;
      s.ended = false;
      s.activeNow = false;
      if (s.phase === "idle") return;
      let rem = dt;
      // walk through phase boundaries inside one frame so totals stay exact at any dt
      for (let guard = 0; guard < 6 && rem > 0; guard++) {
        const i = s.step - 1;
        const dur = s.phase === "startup" ? SWORD.startup[i] : s.phase === "active" ? SWORD.active[i] : SWORD.recovery[i];
        const room = dur - s.t;
        if (rem < room) {
          if (s.phase === "active") { s.activeNow = true; s.u0 = s.t / dur; s.u1 = (s.t + rem) / dur; }
          s.t += rem;
          rem = 0;
          break;
        }
        if (s.phase === "active") {
          if (!s.activeNow) s.u0 = s.t / dur;
          s.activeNow = true;
          s.u1 = 1;
        }
        rem -= room;
        s.t = 0;
        if (s.phase === "startup") s.phase = "active";
        else if (s.phase === "active") s.phase = "recovery";
        else if (s.queued) begin(s.step >= 3 ? 1 : s.step + 1, s.late);
        else { s.cancel(); s.ended = true; return; }
      }
    },
    cancel(): void {
      pressStart = 0;
      s.phase = "idle";
      s.step = 0;
      s.t = 0;
      s.queued = s.late = s.lateNow = s.activeNow = false;
      s.u0 = s.u1 = 0;
    },
  };
  function begin(step: number, late: boolean) {
    s.phase = "startup";
    s.step = step;
    s.t = 0;
    s.queued = false;
    s.late = false;
    s.lateNow = late;
    s.started = step;
  }
  return s;
}
export type SwordTimer = ReturnType<typeof createSwordTimer>;

/**
 * The part of the swing arc the blade covers between progress u0 and u1 (0..1). Step 1 sweeps right to left, step 2
 * left to right, step 3 is an overhead chop (the whole narrow arc at once). Writes yaw and arc into `out`.
 */
export function arcSlice(step: number, yaw: number, u0: number, u1: number, out: { yaw: number; arc: number }): void {
  const arc = SWORD.arc;
  if (step >= 3) { out.yaw = yaw; out.arc = arc * 0.6; return; }
  const dir = step === 2 ? 1 : -1;
  const a0 = -dir * arc / 2 + dir * arc * u0, a1 = -dir * arc / 2 + dir * arc * u1;
  out.yaw = yaw + (a0 + a1) / 2;
  out.arc = Math.abs(a1 - a0) + 0.35; // blade width
}

/**
 * Melee soft lock (aim assist): with no hard lock, a swing turns up to 45 deg toward the best enemy within 3.5 m.
 * Returns the enemy id, or -1. Writes the yaw to face into `out.yaw`.
 */
export function softLockPick(
  px: number, pz: number, yaw: number,
  enemies: readonly { id: number; alive: boolean; lockable: boolean; pos: { x: number; z: number } }[],
  out: { yaw: number }, reach = 3.5, cone = Math.PI / 4,
): number {
  let best = -1, bestS = 1e9;
  out.yaw = yaw;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive || !e.lockable) continue;
    const dx = e.pos.x - px, dz = e.pos.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > reach) continue;
    const a = Math.atan2(dx, dz);
    let da = a - yaw;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > cone) continue;
    const score = d + Math.abs(da) * 2;
    if (score < bestS) { bestS = score; best = e.id; out.yaw = a; }
  }
  return best;
}
