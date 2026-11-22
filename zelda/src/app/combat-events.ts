import type { GameEvent, Strike, Shot, Team } from "./contracts";

type HitEv = Extract<GameEvent, { type: "hit" }>;
type ArrowHitEv = Extract<GameEvent, { type: "arrowHit" }>;
type PropHitEv = Extract<GameEvent, { type: "propHit" }>;
type PickupEv = Extract<GameEvent, { type: "pickup" }>;
type StopEv = Extract<GameEvent, { type: "hitstop" }>;
type ShakeEv = Extract<GameEvent, { type: "shake" }>;

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
  let hi = 0, ai = 0, pi = 0, ki = 0;

  return {
    events: out as readonly GameEvent[],
    reset() { out.length = 0; hi = ai = pi = ki = 0; stop.seconds = 0; shake.strength = 0; },
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
