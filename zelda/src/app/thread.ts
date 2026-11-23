import * as THREE from "three";
import { PLAYER, THREAD } from "./contracts";
import type {
  AnchorKind, FrameCtx, GameEvent, LanternPower, Look, Strike, Thread, ThreadAnchor, ThreadLine, ThreadState,
  ThreadUse, V3, World,
} from "./contracts";
import { enemyIdOf, pickAim } from "./thread-aim";
import { createThreadRender, STYLE } from "./thread-render";

// Thread (DESIGN-V2 section 3). Moves nothing it does not own: pulls, binds and tethers go out as ThreadState.pulls and
// events, and landmarks / enemies move their own objects. Damage goes through combat strikes.

export interface Powers { long: boolean; burning: boolean; heavy: boolean; arrow: boolean }

export interface PairOut {
  use: ThreadUse;
  burning: boolean;
  fromLit: 0 | 1 | 2; // end the fire runs in from (1 = a, 2 = b); 0 = the whole line burns at once
  mover: 0 | 1 | 2; // end that moves on a pull
  heavy: boolean; // refused only because the mover is weight 3 without Heavy Thread
}

const knotLike = (k: AnchorKind) => k === "knot" || k === "target";
const movable = (k: AnchorKind) => k === "block" || k === "float";
const isLit = (x: ThreadAnchor) => x.kind === "brazier" && x.lit;
const isCold = (x: ThreadAnchor) => (x.kind === "brazier" || x.kind === "lamp") && !x.lit;
const canPull = (m: ThreadAnchor, p: Powers, out: PairOut) => !(out.heavy = m.weight >= 3 && !p.heavy);

/** The pair table, symmetric. False = "Can't link those". */
export function pairRule(a: ThreadAnchor, b: ThreadAnchor, p: Powers, out: PairOut): boolean {
  out.use = "inert"; out.burning = false; out.fromLit = 0; out.mover = 0; out.heavy = false;
  if (a === b || a.id === b.id) return false;
  const la = isLit(a), lb = isLit(b);
  if (la && lb) return false;
  if (la || lb) {
    const o = la ? b : a;
    out.burning = true;
    out.fromLit = la ? 1 : 2;
    switch (o.kind) {
      case "enemy": out.use = "tether"; return true;
      case "block": case "float": out.use = "pull"; out.mover = la ? 2 : 1; return canPull(o, p, out);
      case "brazier": case "lamp": out.use = "carry"; return !o.lit;
      default: out.use = "inert"; return true; // knot, target, chain: the line only burns (brambles, Warden chains)
    }
  }
  const ka = a.kind, kb = b.kind;
  out.burning = p.burning;
  if (knotLike(ka) && knotLike(kb)) { out.use = "ride"; return true; }
  if (ka === "enemy" && kb === "enemy") { out.use = "bind"; return true; }
  if (ka === "enemy" || kb === "enemy") {
    out.use = "tether";
    return (ka === "enemy" ? kb : ka) !== "chain";
  }
  if (movable(ka) || movable(kb)) {
    if (movable(ka) && movable(kb)) return false;
    out.use = "pull";
    out.mover = movable(ka) ? 1 : 2;
    return canPull(movable(ka) ? a : b, p, out);
  }
  if ((ka === "chain" && knotLike(kb)) || (kb === "chain" && knotLike(ka))) {
    out.use = "pull";
    out.mover = ka === "chain" ? 1 : 2;
    return true;
  }
  if (p.burning && ((knotLike(ka) && isCold(b)) || (knotLike(kb) && isCold(a)))) {
    out.use = "carry";
    out.fromLit = knotLike(ka) ? 1 : 2;
    return true;
  }
  return false;
}

export const RIDE_HANG = 1.9; // m from the line down to Wren's feet (Tallow on the line, Wren hanging from Tallow)
export const RIDE_DIP = 0.22; // m the line bows under the rider (render only)
const RIDE_RANGE = 30, RIDE_RANGE_LONG = 40; // m from end 1 to end 2 of a ride
const RIDE_END = 0.8; // m short of the far knot
const RIDE_MIN_ENTRY = 4; // m/s
const RIDE_SLOPE_FULL = 0.35; // downhill slope that reaches rideMax

export interface RideRun { s: number; dir: 1 | -1; v: number }

/** One ride step along the straight a->b line. True when the far end is reached. */
export function rideStep(r: RideRun, a: V3, b: V3, dt: number, exhausted: boolean): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 2 * RIDE_END) return true;
  const h = Math.max(0.01, Math.sqrt(dx * dx + dz * dz));
  let slope = (r.dir * dy) / h;
  if (slope > THREAD.rideUpMaxSlope || (slope > 0.02 && exhausted)) {
    r.dir = r.dir > 0 ? -1 : 1;
    r.v = 0;
    slope = -slope;
  }
  const target = slope > 0.02
    ? THREAD.rideUpSpeed
    : slope < -0.02
      ? THREAD.rideSpeed + (THREAD.rideMax - THREAD.rideSpeed) * Math.min(1, -slope / RIDE_SLOPE_FULL)
      : THREAD.rideSpeed;
  r.v = r.v < target ? Math.min(target, r.v + THREAD.rideAccel * dt) : Math.max(target, r.v - THREAD.rideAccel * 1.5 * dt);
  r.s += r.dir * r.v * dt;
  if (r.dir > 0 ? r.s >= len - RIDE_END : r.s <= RIDE_END) {
    r.s = r.dir > 0 ? len - RIDE_END : RIDE_END;
    return true;
  }
  return false;
}

interface Live extends ThreadLine {
  ea: ThreadAnchor;
  eb: ThreadAnchor;
  enemyA: number;
  enemyB: number;
  mover: 0 | 1 | 2;
  fromLit: 0 | 1 | 2;
  fire: number; // 0..1 front from the lit end
  burnLeft: number; // Infinity when fed by a lit brazier
  done: boolean;
  tetherLen: number;
  seed: number;
  ember: number;
}

interface Pull { anchor: string; to: V3; speed: number }
interface BurnSlot { anchor: ThreadAnchor | null; left: number; tick: number }

const POOL = THREAD.wickMax + 3;
const BURN_SLOTS = 8;
const TOUCH_R = 0.8;
const bodyR = (a: ThreadAnchor) => (a.weight >= 3 ? 1.1 : 0.45); // ENEMY radius: mossback 1.1, others ~0.45
const GRAB_COOL = 0.5;
// Grab: distance from the line to Wren's body (feet + BODY_LO up to raised hands at feet + BODY_HI).
const BODY_LO = 0.1, BODY_HI = 2.4;
const GRAB_SNAP_R = Math.max(THREAD.rideGrabR, 2.4); // m: Jump pressed this close to a ride line grabs it
const GRAB_JUMP_BUF = 0.4; // s after a Jump press that the snap radius still applies (a running jump reaches the line)
const GRAB_AIR_R = 0.9; // m: in the air without a Jump press (stepping off, falling past, mid-jump)
const WARN_SECS = 3; // s before a line expires that it dims and flickers
const HANG_EASE = 3.5; // m of ride over which a high grab settles into the full hang
const ENEMY_MAX = 128;

const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };
const _m = { x: 0, y: 0, z: 0 };

const v3 = (p: V3): V3 => ({ x: p.x, y: p.y, z: p.z });
const dist = (a: V3, b: V3) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

function segClosest(a: V3, b: V3, px: number, py: number, pz: number, res: { t: number; d: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-9 ? ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + dx * t - px, cy = a.y + dy * t - py, cz = a.z + dz * t - pz;
  res.t = t;
  res.d = Math.sqrt(cx * cx + cy * cy + cz * cz);
}

export function createThread(scene: THREE.Scene, world: World, look: Look): Thread {
  const render = createThreadRender(look);
  const group = new THREE.Group();
  group.name = "thread";
  group.add(render.mesh);
  scene.add(group);

  const powers: Powers = { long: false, burning: false, heavy: false, arrow: false };
  let wickBase: number = THREAD.wickStart;
  let nextId = 1;

  const lines: Live[] = [];
  const free: Live[] = [];
  for (let i = 0; i < POOL; i++) {
    const a: ThreadAnchor = { id: "", kind: "knot", pos: { x: 0, y: 0, z: 0 }, weight: 0, lit: false, enabled: false };
    free.push({
      id: 0, a: "", b: "", use: "inert", burning: false, age: 0, len: 0, ea: a, eb: a, enemyA: -1, enemyB: -1,
      mover: 0, fromLit: 0, fire: 0, burnLeft: 0, done: false, tetherLen: 0, seed: 0, ember: 0,
    });
  }
  const pullPool: Pull[] = [];
  for (let i = 0; i < POOL * 2; i++) pullPool.push({ anchor: "", to: { x: 0, y: 0, z: 0 }, speed: 0 });
  const pulls: Pull[] = [];
  const burns: BurnSlot[] = [];
  for (let i = 0; i < BURN_SLOTS; i++) burns.push({ anchor: null, left: 0, tick: 0 });
  const touchCool = new Float32Array(ENEMY_MAX);

  const ride = { on: false, line: -1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0 };
  const run: RideRun = { s: 0, dir: 1, v: 0 };
  let rideLine: Live | null = null;
  let rideTime = 0;
  let grabCool = 0;
  let hangOff = 0; // m Wren's feet sat above the hang when she grabbed; eased out over HANG_EASE m of ride
  let hangS0 = 0;
  let jumpBuf = 0; // s left in which a Jump press still grabs from GRAB_SNAP_R

  const state: ThreadState = {
    wick: wickBase, used: 0, lines, pending: null, aimAnchor: null, aimValid: false, aimReason: "none", ride, pulls,
  };

  let pending: ThreadAnchor | null = null;
  let pendingT = 0;
  let recallDone = false;
  let anchorsRef: readonly ThreadAnchor[] | null = null;
  let aimed: ThreadAnchor | null = null;
  let gloam = 0;
  let gloamT = 0;
  const pair: PairOut = { use: "inert", burning: false, fromLit: 0, mover: 0, heavy: false };
  const seg = { t: 0, d: 0 };
  const events: GameEvent[] = [];
  const queued: GameEvent[] = [];
  const strike: Strike = {
    team: "player", source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: 1, arc: Math.PI * 2, height: 1.2,
    damage: 0, kind: "burn", knockback: 0,
  };

  const range = () => (powers.long ? THREAD.rangeLong : THREAD.range);
  // lead decision: a ride's end 2 is measured from end 1, not from Wren
  const rideRange = () => (powers.long ? RIDE_RANGE_LONG : RIDE_RANGE);
  const wick = () => Math.min(THREAD.wickMax, Math.max(1, wickBase));

  const exitRide = (boost: boolean, jump: boolean) => {
    if (!ride.on) return;
    const sp = run.v + (boost ? THREAD.rideExitBoost : 0);
    if (rideLine) {
      const l = rideLine;
      const inv = 1 / Math.max(0.01, dist(l.ea.pos, l.eb.pos));
      ride.vel.set((l.eb.pos.x - l.ea.pos.x) * inv, (l.eb.pos.y - l.ea.pos.y) * inv, (l.eb.pos.z - l.ea.pos.z) * inv)
        .multiplyScalar(run.dir * sp);
    }
    if (jump) ride.vel.y += PLAYER.jumpV * 0.7;
    ride.on = false;
    events.push({ type: "threadRide", on: false, id: ride.line, pos: v3(ride.pos) });
    ride.line = -1;
    rideLine = null;
    grabCool = GRAB_COOL;
  };

  const cutAt = (i: number, why: "expired" | "recall" | "replaced" | "broken") => {
    const l = lines[i];
    if (l === rideLine) exitRide(false, false);
    for (let j = i; j < lines.length - 1; j++) lines[j] = lines[j + 1];
    lines.length--;
    free.push(l);
    events.push({ type: "threadCut", id: l.id, why });
  };

  const cutPending = () => {
    if (!pending) return;
    events.push({ type: "threadCut", id: -1, why: "pending" });
    pending = null;
  };

  const cutAll = (why: "recall" | "broken") => {
    cutPending();
    while (lines.length > 0) cutAt(lines.length - 1, why);
  };

  const trimToWick = () => {
    while (lines.length > wick()) cutAt(oldestIndex(), "replaced");
  };

  const oldestIndex = () => {
    for (let i = 0; i < lines.length; i++) if (lines[i] !== rideLine) return i;
    return 0;
  };

  const find = (anchors: readonly ThreadAnchor[], id: string): ThreadAnchor | null => {
    for (let i = 0; i < anchors.length; i++) if (anchors[i].id === id) return anchors[i];
    return null;
  };

  const refreshBurn = (a: ThreadAnchor) => {
    let slot: BurnSlot | null = null;
    for (const s of burns) if (s.anchor === a) { slot = s; break; }
    if (!slot) for (const s of burns) if (!s.anchor) { slot = s; slot.anchor = a; slot.tick = 0; break; }
    if (slot) slot.left = THREAD.burnTime;
  };

  const hit = (ctx: FrameCtx, x: number, y: number, z: number, reach: number, damage: number, kind: "bind" | "burn", kb: number) => {
    strike.origin.x = x; strike.origin.y = y; strike.origin.z = z;
    strike.reach = reach; strike.damage = damage; strike.kind = kind; strike.knockback = kb;
    ctx.combat.strike(strike);
  };

  const pin1 = (ctx: FrameCtx, a: ThreadAnchor) => {
    pending = a;
    pendingT = 0;
    events.push({ type: "threadPin", end: 1, anchor: a.id, kind: a.kind, pos: v3(a.pos) });
    ctx.fx.burst("spark", a.pos, 10);
  };

  const link = (ctx: FrameCtx, a: ThreadAnchor, b: ThreadAnchor) => {
    while (lines.length >= wick()) cutAt(oldestIndex(), "replaced");
    const l = free.pop()!;
    l.id = nextId++;
    l.a = a.id; l.b = b.id; l.ea = a; l.eb = b;
    l.use = pair.use; l.burning = pair.burning; l.fromLit = pair.fromLit; l.mover = pair.mover;
    l.age = 0; l.len = dist(a.pos, b.pos);
    l.enemyA = a.kind === "enemy" ? enemyIdOf(a.id) : -1;
    l.enemyB = b.kind === "enemy" ? enemyIdOf(b.id) : -1;
    l.fire = l.fromLit ? 0 : 1;
    l.burnLeft = !l.burning ? 0 : (isLit(a) || isLit(b)) ? Infinity : 2;
    l.done = false;
    l.tetherLen = l.len;
    l.seed = Math.random() * 100;
    l.ember = 0;
    lines.push(l);
    events.push({ type: "threadPin", end: 2, anchor: b.id, kind: b.kind, pos: v3(b.pos) });
    events.push({ type: "threadLink", id: l.id, use: l.use, a: a.id, b: b.id, burning: l.burning });
    ctx.fx.burst("spark", b.pos, 14);
    if (l.use === "tether") {
      const e = l.enemyA >= 0 ? l.ea : l.eb;
      events.push({ type: "threadBind", a: l.enemyA >= 0 ? l.enemyA : l.enemyB, b: -1, pos: v3(e.pos) });
    } else if (l.use === "bind") {
      events.push({ type: "threadBind", a: l.enemyA, b: l.enemyB, pos: v3(a.pos) });
    }
  };

  const press = (ctx: FrameCtx) => {
    const t = aimed;
    if (!t) {
      _p.x = _o.x + _d.x * 8; _p.y = _o.y + _d.y * 8; _p.z = _o.z + _d.z * 8;
      events.push({ type: "threadFizzle", why: "none", pos: v3(_p) });
      return;
    }
    if (state.aimReason !== "ok") {
      events.push({ type: "threadFizzle", why: state.aimReason, pos: v3(t.pos) });
      ctx.fx.burst("dust", t.pos, 5);
      return;
    }
    if (!pending) { pin1(ctx, t); return; }
    pairRule(pending, t, powers, pair);
    link(ctx, pending, t);
    pending = null;
  };

  // with end 1 pinned, an anchor that would link (and is in range) beats one that would not
  const pairTry: PairOut = { use: "inert", burning: false, fromLit: 0, mover: 0, heavy: false };
  let aimLantern: V3 = { x: 0, y: 0, z: 0 };
  const preferEnd2 = (a: ThreadAnchor) => {
    if (!pending || !pairRule(pending, a, powers, pairTry)) return false;
    if (pairTry.use === "ride" && knotLike(pending.kind)) return dist(pending.pos, a.pos) <= rideRange();
    return dist(aimLantern, a.pos) <= range() && dist(pending.pos, a.pos) <= THREAD.maxLen;
  };

  const updateAim = (ctx: FrameCtx, anchors: readonly ThreadAnchor[]) => {
    const pl = ctx.player;
    if (pl.aimOrigin && pl.aimDir) { _o.copy(pl.aimOrigin); _d.copy(pl.aimDir); }
    else { _o.copy(ctx.camera.position); ctx.camera.getWorldDirection(_d); }
    const r = range();
    const rideFrom = pending && knotLike(pending.kind) ? pending : null;
    const rr = rideRange();
    const reach = rideFrom ? Math.max(r * 1.5, dist(_o, rideFrom.pos) + rr) + 8 : r * 1.5 + 8;
    aimLantern = pl.lanternPos;
    const i = pickAim(anchors, _o.x, _o.y, _o.z, _d.x, _d.y, _d.z, THREAD.aimCone, THREAD.aimSnapR, reach, pl.lockId, pending, pending ? preferEnd2 : null);
    aimed = i >= 0 ? anchors[i] : null;
    if (!aimed) {
      state.aimAnchor = null; state.aimValid = false; state.aimReason = "none";
      return;
    }
    state.aimAnchor = aimed.id;
    let reason: ThreadState["aimReason"] = "ok";
    if (!pending && movable(aimed.kind) && aimed.weight >= 3 && !powers.heavy) reason = "heavy";
    else if (pending && !pairRule(pending, aimed, powers, pair)) reason = pair.heavy ? "heavy" : "pair";
    else if (rideFrom && pair.use === "ride") { if (dist(rideFrom.pos, aimed.pos) > rr) reason = "far"; }
    else if (dist(pl.lanternPos, aimed.pos) > r) reason = "far";
    else if (pending && dist(pending.pos, aimed.pos) > THREAD.maxLen) reason = "far";
    state.aimReason = reason;
    state.aimValid = reason === "ok";
  };

  // Body capsule for grabbing a ride line: feet to raised hands. The line can pass anywhere along it.
  const lineToBody = (a: V3, b: V3, px: number, y0: number, y1: number, pz: number, res: { t: number; d: number }) => {
    // the squared distance from the line point at t to the vertical segment is convex in t: ternary search
    let lo = 0, hi = 1;
    const f = (t: number) => {
      const x = a.x + (b.x - a.x) * t - px, z = a.z + (b.z - a.z) * t - pz, y = a.y + (b.y - a.y) * t;
      const v = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      return x * x + z * z + v * v;
    };
    for (let k = 0; k < 28; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (f(m1) <= f(m2)) hi = m2; else lo = m1;
    }
    res.t = (lo + hi) / 2;
    res.d = Math.sqrt(f(res.t));
  };

  const tryGrab = (ctx: FrameCtx) => {
    const pl = ctx.player;
    if (grabCool > 0 || pl.mode === "dead" || pl.mode === "swim") return;
    const airborne = pl.mode === "air" || pl.mode === "glide";
    if (ctx.input.btn.jump.pressed) jumpBuf = GRAB_JUMP_BUF;
    const jumped = jumpBuf > 0;
    if (!jumped && !airborne) return;
    // Jump pressed (or just pressed) near a ride line snaps on from a generous radius; drifting through one in the air
    // catches closer in.
    const reach = jumped ? GRAB_SNAP_R : GRAB_AIR_R;
    let best: Live | null = null;
    let bestD = reach;
    let bestT = 0;
    for (const l of lines) {
      if (l.use !== "ride") continue;
      lineToBody(l.ea.pos, l.eb.pos, pl.pos.x, pl.pos.y + BODY_LO, pl.pos.y + BODY_HI, pl.pos.z, seg);
      if (seg.d <= bestD) { best = l; bestD = seg.d; bestT = seg.t; }
    }
    if (!best) return;
    const a = best.ea.pos, b = best.eb.pos;
    const len = Math.max(0.01, dist(a, b));
    const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len, tz = (b.z - a.z) / len;
    let fx = pl.aimDir ? pl.aimDir.x : Math.sin(pl.yaw), fz = pl.aimDir ? pl.aimDir.z : Math.cos(pl.yaw);
    if (pl.vel.x * pl.vel.x + pl.vel.z * pl.vel.z > 4) { fx = pl.vel.x; fz = pl.vel.z; }
    const f = fx * tx + fz * tz;
    const h = Math.sqrt(tx * tx + tz * tz);
    let dir: 1 | -1 = Math.abs(f) > 0.2 * h ? (f > 0 ? 1 : -1) : ty < 0 ? 1 : -1;
    run.s = Math.min(len - RIDE_END, Math.max(RIDE_END, bestT * len));
    const ahead = dir > 0 ? len - run.s : run.s;
    if (ahead < RIDE_END + 1.5) dir = dir > 0 ? -1 : 1;
    if (h > 0.01 && (dir * ty) / h > THREAD.rideUpMaxSlope) dir = dir > 0 ? -1 : 1;
    run.dir = dir;
    const along = Math.abs(pl.vel.x * tx + pl.vel.y * ty + pl.vel.z * tz);
    run.v = Math.min(THREAD.rideMax, Math.max(RIDE_MIN_ENTRY, along));
    rideLine = best;
    rodeOnce = true;
    rideTime = 0;
    jumpBuf = 0;
    ride.on = true;
    ride.line = best.id;
    // ease from where Wren is into the hang over the first meters, so a grab at chest height does not drop her
    hangS0 = run.s;
    hangOff = 0;
    placeRider();
    hangOff = Math.min(2.5, Math.max(-1, pl.pos.y - ride.pos.y));
    placeRider();
    events.push({ type: "threadRide", on: true, id: best.id, pos: v3(ride.pos) });
  };

  const placeRider = () => {
    const l = rideLine!;
    const a = l.ea.pos, b = l.eb.pos;
    const len = Math.max(0.01, dist(a, b));
    const t = run.s / len;
    ride.t = t;
    const u = Math.min(1, Math.abs(run.s - hangS0) / HANG_EASE);
    ride.pos.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - RIDE_DIP - RIDE_HANG + hangOff * (1 - u * u), a.z + (b.z - a.z) * t);
    if (world.heightAt) {
      const g = world.heightAt(ride.pos.x, ride.pos.z) + 0.05;
      if (ride.pos.y < g) ride.pos.y = g;
    }
    const k = (run.dir * run.v) / len;
    ride.vel.set((b.x - a.x) * k, (b.y - a.y) * k, (b.z - a.z) * k);
  };

  const pushPull = (anchor: string, x: number, y: number, z: number, speed: number) => {
    if (pulls.length >= pullPool.length) return;
    const p = pullPool[pulls.length];
    p.anchor = anchor; p.to.x = x; p.to.y = y; p.to.z = z; p.speed = speed;
    pulls.push(p);
  };

  const fireOn = (l: Live) => l.burning && l.fire >= 1;
  // The prologue ride (knot A to knot B) does not age until Wren has ridden a line once: the first ride is the lesson.
  let rodeOnce = false;
  const firstRide = (l: Live) => !rodeOnce && l.use === "ride" && l.a.startsWith("prologue:knot") && l.b.startsWith("prologue:knot");

  const stepLines = (ctx: FrameCtx, dt: number) => {
    pulls.length = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const a = l.ea.pos, b = l.eb.pos;
      l.len = l.use === "tether" ? l.tetherLen : dist(a, b);
      if (l !== rideLine && !firstRide(l)) l.age += dt;
      if (l.age >= THREAD.life) { cutAt(i, "expired"); continue; }
      if (l.burning) {
        if (l.fire < 1) l.fire = Math.min(1, l.fire + dt / THREAD.carrySecs);
        l.burnLeft -= dt;
        if (l.burnLeft <= 0) l.burning = false;
      }
      switch (l.use) {
        case "pull": {
          const m = l.mover === 1 ? l.ea : l.eb, f = l.mover === 1 ? l.eb : l.ea;
          if (Math.hypot(m.pos.x - f.pos.x, m.pos.z - f.pos.z) > THREAD.pullStop + 0.05) {
            const w = m.weight;
            const speed = w >= 1 ? THREAD.pullSpeed[Math.min(3, w) - 1] : THREAD.pullSpeed[1];
            pushPull(m.id, f.pos.x, f.pos.y, f.pos.z, speed); // to = the fixed end; owners stop pullStop short
          }
          break;
        }
        case "bind": {
          // enemies.ts yanks the pair on threadBind and stops them at radius sum + 0.2; the hit lands there
          const touch = bodyR(l.ea) + bodyR(l.eb) + 0.35;
          if (Math.hypot(a.x - b.x, a.z - b.z) <= touch) {
            _m.x = (a.x + b.x) / 2; _m.y = (a.y + b.y) / 2 + 0.8; _m.z = (a.z + b.z) / 2;
            hit(ctx, _m.x, _m.y, _m.z, touch / 2 + 0.6, THREAD.bindDamage, "bind", 2);
            ctx.fx.burst("spark", _m, 24);
            l.done = true;
            if (fireOn(l)) { refreshBurn(l.ea); refreshBurn(l.eb); }
            cutAt(i, "expired");
            continue;
          }
          break;
        }
        case "carry": {
          const dst = l.fromLit === 1 ? l.eb : l.ea;
          if (!l.done && l.fire >= 1 && l.burning) {
            l.done = true;
            events.push({ type: "threadFire", anchor: dst.id, pos: v3(dst.pos) });
            ctx.fx.burst("beacon", dst.pos, 18);
          }
          break;
        }
        default: break;
      }
      if (fireOn(l)) {
        if (l.enemyA >= 0) refreshBurn(l.ea);
        if (l.enemyB >= 0) refreshBurn(l.eb);
        touchBurn(ctx, l);
      }
    }
  };

  const touchBurn = (ctx: FrameCtx, l: Live) => {
    const en = ctx.enemies;
    for (let i = 0; i < en.length; i++) {
      const e = en[i];
      if (!e.alive || e.id === l.enemyA || e.id === l.enemyB || e.id >= ENEMY_MAX || touchCool[e.id] > 0) continue;
      segClosest(l.ea.pos, l.eb.pos, e.pos.x, e.pos.y + 0.8, e.pos.z, seg);
      if (seg.d > TOUCH_R) continue;
      touchCool[e.id] = 1;
      hit(ctx, e.pos.x, e.pos.y + 0.8, e.pos.z, 0.6, THREAD.burnTouchDamage, "burn", 5);
    }
  };

  const stepBurns = (ctx: FrameCtx, dt: number) => {
    for (let i = 0; i < ENEMY_MAX; i++) if (touchCool[i] > 0) touchCool[i] -= dt;
    for (const s of burns) {
      const a = s.anchor;
      if (!a) continue;
      if (!a.enabled || s.left <= 0) { s.anchor = null; continue; }
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick += 1;
        hit(ctx, a.pos.x, a.pos.y + 0.8, a.pos.z, 0.5, THREAD.burnDps, "burn", 0);
        ctx.fx.burst("ember", a.pos, 4);
      }
      s.left -= dt;
    }
  };

  const draw = (ctx: FrameCtx, dt: number) => {
    const daylight = ctx.env.daylight;
    render.begin(ctx.camera, 1 + 0.5 * (1 - daylight) + 0.3 * gloam, gloam, Math.max(0, Math.min(1, daylight)) * (1 - gloam));
    for (const l of lines) {
      const fromB = l.fromLit === 2;
      const a = fromB ? l.eb.pos : l.ea.pos, b = fromB ? l.ea.pos : l.eb.pos;
      // last 3 s: the line dims and flickers so its end is no surprise
      const left = THREAD.life - l.age;
      const warn = left < WARN_SECS ? (0.3 + 0.7 * left / WARN_SECS) * (0.75 + 0.25 * Math.cos(l.age * 14)) : 1;
      const fade = Math.max(0, warn) * Math.min(1, l.age * 8 + 0.3);
      const taut = l.use === "pull" || l.use === "bind" || l.use === "tether";
      const sag = taut ? 0.02 * l.len : 0.12 + 0.025 * l.len;
      const fire = l.burning && l.fromLit ? l.fire : 0;
      const full = l.burning && !l.fromLit;
      if (l === rideLine) {
        const ea = l.ea.pos, eb = l.eb.pos, rt = ride.t;
        _m.x = ea.x + (eb.x - ea.x) * rt; _m.y = ea.y + (eb.y - ea.y) * rt - RIDE_DIP; _m.z = ea.z + (eb.z - ea.z) * rt;
        render.strand(a, b, 0, STYLE.line, fade, fire, full, l.seed, _m);
      } else {
        render.strand(a, b, sag, STYLE.line, fade, fire, full, l.seed);
      }
      l.ember += dt * (l.burning ? 9 : 2.5) * Math.min(2, l.len / 10);
      if (l.ember >= 1) {
        l.ember -= 1;
        const t = Math.random();
        _p.x = a.x + (b.x - a.x) * t; _p.y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t); _p.z = a.z + (b.z - a.z) * t;
        ctx.fx.burst(l.burning ? "spark" : "ember", _p, 1);
      }
    }
    const lantern = ctx.player.lanternPos;
    if (pending) {
      const pulse = 0.55 + 0.25 * Math.sin(pendingT * 9);
      render.strand(lantern, pending.pos, 0.1 + 0.02 * dist(lantern, pending.pos), STYLE.held, pulse, 0, false, 3);
      render.ring(pending.pos, 0.32, STYLE.ring, pulse);
    }
    if (aimed) {
      const ok = state.aimValid;
      if (aimed !== pending) render.strand(pending ? pending.pos : lantern, aimed.pos, 0, ok ? STYLE.preview : STYLE.previewBad, ok ? 0.9 : 0.6, 0, false, 0);
      render.ring(aimed.pos, aimed.kind === "enemy" ? 0.7 : 0.45, ok ? STYLE.ring : STYLE.ringBad, ok ? 1 : 0.6);
    }
    render.end();
  };

  const thread: Thread = {
    state,
    group,
    update(ctx) {
      events.length = 0;
      for (const e of queued) events.push(e);
      queued.length = 0;
      const dt = ctx.dt;
      const pr = ctx.progress;
      if (pr) {
        wickBase = THREAD.wickStart + pr.wickOil;
        powers.long = pr.powers.includes("long");
        powers.burning = pr.powers.includes("burning");
        powers.heavy = pr.powers.includes("heavy");
        powers.arrow = pr.powers.includes("arrow");
      }
      trimToWick();
      state.wick = wick();

      const anchors = ctx.anchors ?? [];
      if (ctx.anchors && anchors !== anchorsRef) {
        anchorsRef = anchors;
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = lines[i];
          const na = find(anchors, l.a), nb = find(anchors, l.b);
          if (!na || !nb) { cutAt(i, "broken"); continue; }
          l.ea = na; l.eb = nb;
        }
        if (pending) {
          const np = find(anchors, pending.id);
          if (np) pending = np; else cutPending();
        }
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].ea.enabled || !lines[i].eb.enabled) cutAt(i, "broken");
      }
      if (pending && !pending.enabled) cutPending();

      gloamT -= ctx.realDt;
      if (gloamT <= 0) {
        gloamT = 0.5;
        const ar = world.areaAt(ctx.player.pos.x, ctx.player.pos.z);
        gloam = ar && ar.id === "spire" ? 1 : 0;
      }

      updateAim(ctx, anchors);

      const btn = ctx.input.btn.thread;
      if (btn.pressed) press(ctx);
      if (btn.down && btn.held >= THREAD.recallHold && !recallDone) {
        recallDone = true;
        if (lines.length > 0 || pending) cutAll("recall");
        updateAim(ctx, anchors);
      }
      if (!btn.down) recallDone = false;

      if (pending) {
        pendingT += dt;
        if (pendingT >= THREAD.pendingLife) {
          ctx.fx.burst("dust", pending.pos, 6);
          cutPending();
        }
      }

      if (grabCool > 0) grabCool -= dt;
      if (jumpBuf > 0) jumpBuf -= dt;
      if (ride.on && rideLine) {
        rideTime += dt;
        if (ctx.input.btn.jump.pressed && rideTime > 0.12) exitRide(true, true);
        else {
          const ended = rideStep(run, rideLine.ea.pos, rideLine.eb.pos, dt, ctx.player.exhausted);
          placeRider();
          if (ended) exitRide(true, false);
        }
      } else {
        tryGrab(ctx);
      }

      stepLines(ctx, dt);
      stepBurns(ctx, dt);
      state.used = lines.length;
      state.pending = pending ? pending.id : null;
      draw(ctx, ctx.realDt);
      return events;
    },
    handle(evs) {
      for (const e of evs) {
        switch (e.type) {
          case "died": case "respawned": case "travel": cutAll("broken"); break;
          case "power":
            setPower(e.power);
            break;
          case "upgrade":
            if (e.kind === "wick") { wickBase = THREAD.wickStart + e.level; trimToWick(); }
            break;
          case "arrowHit":
            if (powers.arrow && anchorsRef && !pending) arrowPin(e.pos);
            break;
          default: break;
        }
      }
    },
    setWick(n) {
      wickBase = n;
      trimToWick();
      state.wick = wick();
    },
    setPowers(p) {
      powers.long = powers.burning = powers.heavy = powers.arrow = false;
      for (const x of p) setPower(x);
    },
    cutAll() {
      cutAll("recall");
    },
    dispose() {
      scene.remove(group);
      render.dispose();
    },
  };

  const setPower = (p: LanternPower) => { powers[p] = true; };

  const arrowPin = (pos: V3) => {
    let best: ThreadAnchor | null = null;
    let bestD = 1.2;
    for (const a of anchorsRef!) {
      if (!a.enabled || (a.kind !== "knot" && a.kind !== "target")) continue;
      const d = dist(a.pos, pos);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (!best) return;
    pending = best;
    pendingT = 0;
    queued.push({ type: "threadPin", end: 1, anchor: best.id, kind: best.kind, pos: v3(best.pos) });
  };

  return thread;
}
