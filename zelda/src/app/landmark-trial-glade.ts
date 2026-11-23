import * as THREE from "three";
import { PROLOGUE, THREAD } from "./contracts";
import type { FrameCtx, GameEvent, Prop, Quality, SiteRegistryV2, ThreadAnchor, V3 } from "./contracts";
import { Mesher, PAL, glowMat, type Emit, type Registry, type SiteEnv, type TrialHandle } from "./landmark-kit";

// Glade Beacon trial (DESIGN-V2.md 5.1): Pull (teach) -> Fight (test) -> Carry (finale), plus a ring bonus.
// planGladeTrial and createGladeMachine are pure (no THREE) so scripts/trials/glade-sim.ts can run them in node.
// buildGladeTrial wires them to meshes, thread anchors and the TrialHandle the landmarks orchestrator drives.

const GROUP = "glade-fight";
const ID_BLOCK = "glade:block";
const ID_POST = "glade:post";
const ID_BRAZIER = "glade:room-brazier";
const ID_BOWL = "glade:bowl";
const ID_RIM_A = "glade:rim-a";
const ID_RIM_B = "glade:rim-b";
const ID_PLATE = "glade:plate";
const ID_RINGS = "glade-rings";
const RADIUS = 30; // glade radius (PROLOGUE.glade); leaving it fails the fight
const PLATE_R = 0.9;
const RING_HIT = 2.5;
const RING_R = 2.0;
const STUCK_DIST = 14;
const STUCK_SECS = 5;
const HINT_SECS = 90;
const REFIGHT_SECS = 3;
const BRAZIER_BOWL = 14;

export type GladeRoom = "idle" | "pull" | "fight" | "carry" | "lit" | "bonus";
export type Out = GameEvent;

export interface GladeRing { pos: V3; yaw: number }
export interface GladePlan {
  cx: number; cz: number; radius: number;
  pull: { rule: string; hint: string; block: V3; post: V3; plate: V3 };
  fight: { rule: string; hint: string; brazier: V3; spawns: [V3, V3] };
  carry: { rule: string; hint: string; brazier: V3; bowl: V3; distance: number };
  bonus: { rings: [GladeRing, GladeRing, GladeRing]; rimKnots: [V3, V3] };
}

/** Everything the trial needs, from terrain height only. All rooms sit inside 26 m of (cx, cz); north is -z. */
export function planGladeTrial(world: { heightAt(x: number, z: number): number }, cx: number, cz: number): GladePlan {
  const at = (dx: number, dz: number, dy: number): V3 => {
    const x = cx + dx, z = cz + dz;
    return { x, y: world.heightAt(x, z) + dy, z };
  };
  // Room 1 (south-west): block, plate, post in a row. The plate sits exactly where the block stops (pullStop short of the post).
  const post = at(-8, 14, 1.5);
  const plate = at(-8 - THREAD.pullStop, 14, 0);
  // Room 2 and 3 share one brazier at the north edge; the cold bowl stands 14 m south of it, at the foot of the beacon
  // tower (plinth radius 5), so the carry ends at the landmark the player has been walking toward.
  const brazier = at(0, -21, 1.1);
  const bowl = at(0, -21 + BRAZIER_BOWL, 1.2);
  const rimA = at(25, 6, 2.0);
  const rimB = at(3, 24, 0.8);
  const dx = rimB.x - rimA.x, dz = rimB.z - rimA.z;
  const yaw = Math.atan2(dx, dz);
  const ring = (t: number): GladeRing => ({
    pos: { x: rimA.x + dx * t, y: rimA.y + (rimB.y - rimA.y) * t - 0.8, z: rimA.z + dz * t },
    yaw,
  });
  return {
    cx, cz, radius: RADIUS,
    pull: { rule: "Pull the block onto the plate.", hint: "Thread the block, then the post.", block: at(-20, 14, 0.55), post, plate },
    fight: { rule: "Defeat the bramblings.", hint: "Thread a brambling to the fire.", brazier, spawns: [at(-7, -15, 0), at(7, -15, 0)] },
    carry: { rule: "Bring fire to the beacon.", hint: "Thread the fire to the beacon.", brazier, bowl, distance: BRAZIER_BOWL },
    bonus: { rings: [ring(0.25), ring(0.5), ring(0.75)], rimKnots: [rimA, rimB] },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------------------------------------------------
export interface GladeIn {
  px: number; py: number; pz: number;
  /** Same shape as ctx.threads.pulls. Only "glade:block" is read. */
  pulls?: readonly { anchor: string; to: V3; speed: number }[];
  /** Room brazier state from its anchor; false in fight/carry makes the machine ask for a relight. Default true. */
  brazierLit?: boolean;
}
export interface GladeMachineOpts {
  heightAt?: (x: number, z: number) => number;
  /** Ring bonus already paid (save). */
  bonusDone?: boolean;
  /** Shared "already awarded" ids; pass a module-level Set so rebuilt machines do not pay twice. */
  awarded?: Set<string>;
  hintSecs?: number;
}
export interface GladeState {
  room: GladeRoom;
  plateOn: boolean;
  block: V3;
  deaths: number;
  kills: number;
  armed: boolean; // fight reset, waiting to re-release
  rings: number; // rings collected this visit
  ringGot: [boolean, boolean, boolean];
  bowlLit: boolean;
  brazierLit: boolean;
  roomT: number; // s in this attempt
  hinted: boolean;
  respawnIn: number; // s until the fight re-releases (while armed)
}
export interface GladeMachine {
  start(): Out[];
  step(input: GladeIn, dt: number): Out[];
  onEvent(e: GameEvent): Out[];
  abort(): Out[];
  reload(solved: boolean): Out[];
  resetBlock(): Out[];
  canResetBlock(): boolean;
  snapshot(): GladeState;
  /** Live state (no copy). Read only. */
  readonly state: Readonly<GladeState>;
}

const NONE: Out[] = []; // shared empty result; callers must not push into it

export function createGladeMachine(plan: GladePlan, opts: GladeMachineOpts = {}): GladeMachine {
  const awarded = opts.awarded ?? new Set<string>();
  const hintSecs = opts.hintSecs ?? HINT_SECS;
  const s: GladeState = {
    room: "idle", plateOn: false, block: { ...plan.pull.block }, deaths: 0, kills: 0, armed: false, rings: 0,
    ringGot: [false, false, false], bowlLit: false, brazierLit: true, roomT: 0, hinted: false, respawnIn: 0,
  };
  const killIds = new Set<number>();
  let awayT = 0;
  let hold = false; // player is dead: wait for "respawned" before the fight re-releases
  let out: Out[] = NONE;
  const emit = (e: Out) => {
    if (out === NONE) out = [];
    out.push(e);
  };
  const flush = () => {
    const r = out;
    out = NONE;
    return r;
  };
  const v3 = (p: V3): V3 => ({ x: p.x, y: p.y, z: p.z });
  const rule = (text: string): Out => ({ type: "trialRule", trial: "glade", text });
  const blockY = (x: number, z: number) => (opts.heightAt ? opts.heightAt(x, z) + 0.55 : plan.pull.block.y);
  const placeBlock = (x: number, z: number) => {
    s.block.x = x;
    s.block.z = z;
    s.block.y = blockY(x, z);
    emit({ type: "blockMove", id: ID_BLOCK, pos: v3(s.block) });
  };
  const attempt = () => {
    s.roomT = 0;
    s.hinted = false;
  };
  const resetAll = () => {
    s.room = "idle";
    s.plateOn = false;
    s.block.x = plan.pull.block.x;
    s.block.y = plan.pull.block.y;
    s.block.z = plan.pull.block.z;
    s.kills = 0;
    s.armed = false;
    s.rings = 0;
    s.ringGot[0] = s.ringGot[1] = s.ringGot[2] = false;
    s.bowlLit = false;
    s.brazierLit = true;
    s.respawnIn = 0;
    killIds.clear();
    awayT = 0;
    hold = false;
    attempt();
  };
  const spawnPair = () => {
    for (const p of plan.fight.spawns) emit({ type: "spawn", kind: "brambling", pos: v3(p), group: GROUP });
  };
  const blockOnPlate = () => Math.hypot(s.block.x - plan.pull.plate.x, s.block.z - plan.pull.plate.z) <= PLATE_R;
  const toFight = () => {
    s.block.x = plan.pull.plate.x;
    s.block.z = plan.pull.plate.z;
    s.block.y = blockY(s.block.x, s.block.z);
    emit({ type: "blockMove", id: ID_BLOCK, pos: v3(s.block) });
    s.plateOn = true;
    emit({ type: "plate", id: ID_PLATE, on: true });
    s.room = "fight";
    s.kills = 0;
    s.armed = false;
    killIds.clear();
    attempt();
    emit(rule(plan.fight.rule));
    spawnPair();
  };
  const failFight = () => {
    emit({ type: "despawnGroup", group: GROUP });
    s.plateOn = false;
    emit({ type: "plate", id: ID_PLATE, on: false });
    s.kills = 0;
    killIds.clear();
    s.armed = true;
    s.respawnIn = REFIGHT_SECS;
    attempt();
  };
  const toCarry = () => {
    s.room = "carry";
    attempt();
    emit(rule(plan.carry.rule));
    relight();
  };
  const relight = () => {
    if (s.brazierLit) return;
    s.brazierLit = true;
    emit({ type: "threadFire", anchor: ID_BRAZIER, pos: v3(plan.carry.brazier) });
  };
  const lightBowl = () => {
    s.room = "lit";
    s.bowlLit = true;
    s.rings = 0;
    s.ringGot[0] = s.ringGot[1] = s.ringGot[2] = false;
    emit({ type: "gladeLit", pos: v3(plan.carry.bowl) });
    emit({ type: "toast", text: "Glade lit. Now light the 4 beacons." });
    emit({ type: "pickup", kind: "shard", amount: 1, pos: v3(plan.carry.bowl), id: "shard-glade" });
  };

  const m: GladeMachine = {
    state: s,
    start() {
      if (s.room !== "idle") return NONE;
      resetAll();
      s.room = "pull";
      emit(rule(plan.pull.rule));
      return flush();
    },
    step(inp, dt) {
      if (s.room === "idle") return NONE;
      const inside = Math.hypot(inp.px - plan.cx, inp.pz - plan.cz) <= plan.radius;
      const playing = s.room === "pull" || s.room === "fight" || s.room === "carry";
      if (playing) {
        s.roomT += dt;
        if (!s.hinted && s.roomT >= hintSecs) {
          s.hinted = true;
          emit({ type: "toast", text: s.room === "pull" ? plan.pull.hint : s.room === "fight" ? plan.fight.hint : plan.carry.hint });
        }
      }
      if (s.room === "pull") {
        let moved = false;
        const pulls = inp.pulls;
        if (pulls) {
          for (let i = 0; i < pulls.length; i++) {
            const p = pulls[i];
            if (p.anchor !== ID_BLOCK) continue;
            const dx = p.to.x - s.block.x, dz = p.to.z - s.block.z;
            const d = Math.hypot(dx, dz);
            if (d <= THREAD.pullStop) continue;
            const mv = Math.min(p.speed * dt, d - THREAD.pullStop);
            s.block.x += (dx / d) * mv;
            s.block.z += (dz / d) * mv;
            moved = true;
          }
        }
        if (moved) {
          s.block.y = blockY(s.block.x, s.block.z);
          emit({ type: "blockMove", id: ID_BLOCK, pos: v3(s.block) });
        }
        if (blockOnPlate()) toFight();
        else {
          const far = Math.hypot(s.block.x - plan.pull.block.x, s.block.z - plan.pull.block.z) > STUCK_DIST;
          awayT = far ? awayT + dt : 0;
          if (awayT >= STUCK_SECS) {
            awayT = 0;
            placeBlock(plan.pull.block.x, plan.pull.block.z);
          }
        }
      } else if (s.room === "fight") {
        if (inp.brazierLit === false) {
          s.brazierLit = false;
          relight();
        }
        if (!s.armed && !inside) failFight();
        if (s.armed && !hold && inside) {
          s.respawnIn -= dt;
          if (s.respawnIn <= 0) {
            s.respawnIn = 0;
            s.plateOn = true;
            emit({ type: "plate", id: ID_PLATE, on: true });
            s.armed = false;
            attempt();
            spawnPair();
          }
        }
      } else if (s.room === "carry") {
        if (inp.brazierLit === false) {
          s.brazierLit = false;
          relight();
        }
      } else {
        if (!inside) {
          if (s.rings > 0) {
            s.rings = 0;
            s.ringGot[0] = s.ringGot[1] = s.ringGot[2] = false;
          }
          s.room = "lit";
        } else {
          for (let i = 0; i < 3; i++) {
            if (s.ringGot[i]) continue;
            const r = plan.bonus.rings[i].pos;
            const d = Math.hypot(inp.px - r.x, inp.py - r.y, inp.pz - r.z);
            if (d > RING_HIT) continue;
            s.ringGot[i] = true;
            s.rings++;
            s.room = "bonus";
            if (s.rings === 3 && !opts.bonusDone && !awarded.has(ID_RINGS)) {
              awarded.add(ID_RINGS);
              emit({ type: "pickup", kind: "glimmer", amount: 30, pos: v3(plan.bonus.rings[2].pos), id: ID_RINGS });
            }
          }
        }
      }
      return flush();
    },
    onEvent(e) {
      switch (e.type) {
        case "died":
          s.deaths++;
          if (s.room === "fight") {
            hold = true;
            failFight();
          } else if (s.room === "carry") attempt(); // nothing earned is lost: plate stays down, fight stays cleared
          break;
        case "respawned":
          hold = false;
          break;
        case "enemyDied":
          if (s.room === "fight" && !s.armed && e.group === GROUP && !killIds.has(e.id)) {
            killIds.add(e.id);
            s.kills = killIds.size;
            if (s.kills >= 2) toCarry();
          }
          break;
        case "threadFire":
          if (s.room === "carry" && e.anchor === ID_BOWL) lightBowl();
          break;
        case "threadLink":
          if (s.room === "carry" && e.use === "carry" && (e.a === ID_BOWL || e.b === ID_BOWL)) lightBowl();
          break;
        case "plate":
          if (s.room === "pull" && e.id === ID_PLATE && e.on) toFight();
          break;
      }
      return flush();
    },
    abort() {
      if (s.room === "idle") return NONE;
      if (s.room === "fight") emit({ type: "despawnGroup", group: GROUP });
      if (s.plateOn) emit({ type: "plate", id: ID_PLATE, on: false });
      const moved = s.block.x !== plan.pull.block.x || s.block.z !== plan.pull.block.z;
      resetAll();
      if (moved) emit({ type: "blockMove", id: ID_BLOCK, pos: v3(s.block) });
      return flush();
    },
    reload(solved) {
      resetAll();
      if (solved) {
        s.room = "lit";
        s.plateOn = true;
        s.bowlLit = true;
        s.block.x = plan.pull.plate.x;
        s.block.z = plan.pull.plate.z;
        s.block.y = blockY(s.block.x, s.block.z);
      }
      return NONE;
    },
    resetBlock() {
      if (s.room !== "pull") return NONE;
      awayT = 0;
      placeBlock(plan.pull.block.x, plan.pull.block.z);
      return flush();
    },
    canResetBlock() {
      return s.room === "pull" && Math.hypot(s.block.x - plan.pull.block.x, s.block.z - plan.pull.block.z) > 0.5;
    },
    snapshot() {
      return { ...s, block: v3(s.block), ringGot: [s.ringGot[0], s.ringGot[1], s.ringGot[2]] };
    },
  };
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scene glue
// ---------------------------------------------------------------------------------------------------------------------
/** BeaconTower-compatible, structural. */
export interface GladeSite {
  cx: number; cz: number; gy: number;
  flame: V3; front: V3;
  pedestal?: V3;
  setLit?(on: boolean, animated: boolean): void;
}
export type GladeTrialHandle = Omit<TrialHandle, "beacon"> & {
  readonly beacon: "glade";
  /** The ring bonus was already paid in the save. */
  markBonusDone(): void;
  /** Where the current task happens (block, fight brazier, beacon bowl), for the compass and world marker. False when no task runs. */
  taskPos(out: { x: number; y: number; z: number }): boolean;
};

const awardedIds = new Set<string>(); // module level: a rebuilt trial never pays the ring bonus twice
const NO_PULLS: readonly { anchor: string; to: V3; speed: number }[] = [];

export function buildGladeTrial(env: SiteEnv, tower: GladeSite, sky: THREE.Group): GladeTrialHandle {
  void sky;
  const { world, look, group } = env;
  const regV2 = env.reg as Registry & Partial<SiteRegistryV2>;
  // The arena center comes from PROLOGUE.glade; the beacon tower stands on the plinth at its north edge.
  const cx = PROLOGUE.glade.x, cz = PROLOGUE.glade.z;
  const plan = planGladeTrial(world, cx, cz);
  const machine = createGladeMachine(plan, { heightAt: (x, z) => world.heightAt(x, z), awarded: awardedIds });
  const st = machine.state;

  const mk = (a: ThreadAnchor): ThreadAnchor => (typeof regV2.anchor === "function" ? regV2.anchor(a) : a);
  const aBlock = mk({ id: ID_BLOCK, kind: "block", pos: { ...plan.pull.block }, weight: 1, lit: false, enabled: false });
  const aPost = mk({ id: ID_POST, kind: "knot", pos: { ...plan.pull.post }, weight: 0, lit: false, enabled: false });
  const aBrazier = mk({ id: ID_BRAZIER, kind: "brazier", pos: { ...plan.carry.brazier }, weight: 0, lit: true, enabled: false });
  const aBowl = mk({ id: ID_BOWL, kind: "brazier", pos: { ...plan.carry.bowl }, weight: 0, lit: false, enabled: false });
  const aRimA = mk({ id: ID_RIM_A, kind: "knot", pos: { ...plan.bonus.rimKnots[0] }, weight: 0, lit: false, enabled: false });
  const aRimB = mk({ id: ID_RIM_B, kind: "knot", pos: { ...plan.bonus.rimKnots[1] }, weight: 0, lit: false, enabled: false });

  const gy = (x: number, z: number) => world.heightAt(x, z);
  const stone = new Mesher(9101);
  const knots = new Mesher(9102);
  const post = plan.pull.post, plate = plan.pull.plate, brz = plan.carry.brazier, bowl = plan.carry.bowl;
  stone.cyl(post.x, gy(post.x, post.z) - 0.4, post.z, 0.5, 0.36, post.y - gy(post.x, post.z) + 0.1, PAL.rockLo, 7);
  knots.torus(post.x, post.y, post.z, 0.34, 0.07, PAL.goldHi, 0, 0.6, 0);
  stone.cyl(plate.x, gy(plate.x, plate.z) - 0.2, plate.z, 1.25, 1.15, 0.3, PAL.rockLo, 12);
  stone.cyl(brz.x, gy(brz.x, brz.z) - 0.4, brz.z, 0.75, 0.5, brz.y - gy(brz.x, brz.z) - 0.2, PAL.rock, 8);
  stone.cyl(brz.x, brz.y - 0.3, brz.z, 0.55, 0.85, 0.35, PAL.ashLo, 8);
  stone.cyl(bowl.x, gy(bowl.x, bowl.z) - 0.4, bowl.z, 1.0, 0.7, bowl.y - gy(bowl.x, bowl.z) - 0.1, PAL.rock, 8);
  stone.cyl(bowl.x, bowl.y - 0.45, bowl.z, 0.7, 1.1, 0.5, PAL.ashLo, 10);
  stone.ball(bowl.x, bowl.y - 0.1, bowl.z, 0.55, PAL.ash, 0.35, 1);
  for (const k of plan.bonus.rimKnots) {
    const g = gy(k.x, k.z);
    stone.cyl(k.x, g - 0.4, k.z, 0.4, 0.3, k.y - g + 0.3, PAL.rockLo, 7);
    knots.torus(k.x, k.y, k.z, 0.34, 0.07, PAL.goldHi, 0, 0.6, 0);
  }
  const mStone = stone.build(look, undefined, "glade-stone");
  const mKnots = knots.build(look, glowMat(look, PAL.goldHi, 1.2), "glade-knots");
  mKnots.castShadow = false;

  const blk = new Mesher(9103);
  blk.boxc(0, 0, 0, 1.1, 1.1, 1.1, PAL.rock, 0.2);
  blk.boxc(0, 0, 0, 1.16, 0.16, 1.16, PAL.gold, 0.2);
  blk.boxc(0, 0.58, 0, 0.5, 0.06, 0.5, PAL.goldHi, 0.2);
  const mBlock = blk.build(look, undefined, "glade-block");
  mBlock.position.set(st.block.x, st.block.y, st.block.z);

  const pl = new Mesher(9104);
  pl.cyl(0, 0, 0, 0.9, 0.85, 0.16, PAL.rockHi, 12);
  const mPlate = pl.build(look, undefined, "glade-plate");
  const plateUp = gy(plate.x, plate.z) + 0.12;
  const plateDown = plateUp - 0.13;
  mPlate.position.set(plate.x, plateUp, plate.z);
  const plateRingM = new Mesher(9105);
  plateRingM.torus(0, 0, 0, 1.0, 0.05, PAL.rune, Math.PI / 2, 0, 0, 20, 4);
  const mPlateGlow = plateRingM.build(look, glowMat(look, PAL.rune, 1.4), "glade-plate-glow");
  mPlateGlow.position.set(plate.x, plateUp + 0.1, plate.z);
  mPlateGlow.visible = false;

  const flameGeo = () => {
    const f = new Mesher(9106);
    f.cone(0, 0, 0, 0.5, 1.2, PAL.ember, 7, 0, { jit: 0, ao: 0 });
    f.cone(0, 0, 0, 0.3, 1.6, PAL.emberHi, 6, 0, { jit: 0, ao: 0 });
    return f.build(look, glowMat(look, PAL.ember, 1.7), "glade-flame");
  };
  const mFlame = flameGeo();
  mFlame.position.set(brz.x, brz.y + 0.05, brz.z);
  mFlame.castShadow = false;
  const mBowlFlame = flameGeo();
  mBowlFlame.position.set(bowl.x, bowl.y, bowl.z);
  mBowlFlame.scale.setScalar(0.001);
  mBowlFlame.visible = false;
  mBowlFlame.castShadow = false;

  const mRings: THREE.Mesh[] = [];
  const ringMat = glowMat(look, PAL.rune, 1.3);
  for (let i = 0; i < 3; i++) {
    const rm = new Mesher(9110 + i);
    rm.torus(0, 0, 0, RING_R, 0.12, PAL.rune, 0, 0, 0, 24, 6);
    const mesh = rm.build(look, ringMat, "glade-ring");
    mesh.castShadow = false;
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = plan.bonus.rings[i].yaw;
    mesh.position.set(plan.bonus.rings[i].pos.x, plan.bonus.rings[i].pos.y, plan.bonus.rings[i].pos.z);
    mesh.visible = false;
    mRings.push(mesh);
  }
  const all: THREE.Mesh[] = [mStone, mKnots, mBlock, mPlate, mPlateGlow, mFlame, mBowlFlame, ...mRings];
  for (const mesh of all) {
    env.own(mesh.geometry);
    group.add(mesh);
  }

  let emitRef: Emit | null = null;
  const pend: GameEvent[] = [];
  let solvedFlag = false;
  let wantStart = false;
  let lastRoom: GladeRoom = "idle";
  let bowlK = 0;
  const hasZone = typeof regV2.zone === "function";
  const inp: GladeIn = { px: 0, py: 0, pz: 0, pulls: NO_PULLS, brazierLit: true };

  const send = (outs: readonly GameEvent[]) => {
    for (let i = 0; i < outs.length; i++) {
      const e = outs[i];
      if (e.type === "gladeLit") {
        solvedFlag = true;
        tower.setLit?.(true, true);
      }
      if (emitRef) emitRef(e);
      else pend.push(e);
    }
  };
  const syncRoom = () => {
    const r = st.room;
    if (r === lastRoom) return;
    lastRoom = r;
    const pull = r === "pull", fire = r === "fight" || r === "carry", lit = r === "lit" || r === "bonus";
    aBlock.enabled = pull;
    aPost.enabled = pull;
    aBrazier.enabled = fire;
    aBowl.enabled = r === "carry";
    aRimA.enabled = lit;
    aRimB.enabled = lit;
    aBowl.lit = st.bowlLit;
    for (let i = 0; i < 3; i++) mRings[i].visible = lit && !st.ringGot[i];
    if (r === "idle" || r === "pull") {
      mBlock.position.set(st.block.x, st.block.y, st.block.z);
    }
  };
  const visuals = (time: number, dt: number, near: boolean) => {
    aBlock.pos.x = st.block.x; aBlock.pos.y = st.block.y; aBlock.pos.z = st.block.z;
    aBowl.lit = st.bowlLit;
    if (!near) return;
    mBlock.position.set(st.block.x, st.block.y, st.block.z);
    mPlate.position.y = st.plateOn ? plateDown : plateUp;
    mPlateGlow.visible = st.plateOn;
    const f = 1 + Math.sin(time * 9) * 0.06 + Math.sin(time * 5.3) * 0.05;
    mFlame.scale.set(f, f * 1.05, f);
    if (st.bowlLit && bowlK < 1) bowlK = Math.min(1, bowlK + dt / THREAD.carrySecs);
    else if (!st.bowlLit && bowlK > 0) bowlK = 0;
    mBowlFlame.visible = bowlK > 0;
    if (bowlK > 0) {
      const g = bowlK * 1.3 * (1 + Math.sin(time * 8) * 0.06);
      mBowlFlame.scale.set(g, g * 1.1, g);
    }
    const lit = st.room === "lit" || st.room === "bonus";
    for (let i = 0; i < 3; i++) {
      const mesh = mRings[i];
      mesh.visible = lit && !st.ringGot[i];
      if (mesh.visible) mesh.rotation.z = time * 0.8 + i;
    }
  };

  if (hasZone) {
    regV2.zone!({ id: "glade:arena", x: cx, y: gy(cx, cz), z: cz, r: 27, h: 30, onEnter: () => { wantStart = true; } });
  }
  const mid = { x: (plan.pull.block.x + post.x) / 2, z: post.z };
  env.reg.interact({
    id: "glade:reset-block", x: mid.x, y: gy(mid.x, mid.z) + 1, z: mid.z, r: 8,
    label: () => (machine.canResetBlock() ? "Reset block" : null),
    use: () => send(machine.resetBlock()),
  });

  const props: Prop[] = [];
  const h: GladeTrialHandle = {
    beacon: "glade",
    get active() {
      const r = st.room;
      return r === "pull" || r === "fight" || r === "carry";
    },
    props,
    timeLeft: null,
    canStart: () => null,
    start(_ctx: FrameCtx, emit: Emit) {
      emitRef = emit;
      if (solvedFlag) return;
      send(machine.start());
      syncRoom();
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      emitRef = emit;
      if (pend.length) {
        for (let i = 0; i < pend.length; i++) emit(pend[i]);
        pend.length = 0;
      }
      const p = ctx.player.pos;
      if (st.room === "idle" && !solvedFlag) {
        if (wantStart || (!hasZone && Math.hypot(p.x - cx, p.z - cz) <= 27)) {
          wantStart = false;
          send(machine.start());
        }
      }
      if (st.room !== "idle") {
        inp.px = p.x; inp.py = p.y; inp.pz = p.z;
        inp.pulls = ctx.threads ? ctx.threads.pulls : NO_PULLS;
        inp.brazierLit = aBrazier.lit;
        send(machine.step(inp, ctx.dt));
        if (st.room === "fight" || st.room === "carry") aBrazier.lit = true; // permanent
      }
      syncRoom();
      visuals(ctx.time, ctx.dt, near || st.room !== "idle");
    },
    handle(e: GameEvent, emit: Emit) {
      emitRef = emit;
      send(machine.onEvent(e));
      syncRoom();
    },
    abort() {
      send(machine.abort());
      wantStart = false;
      solvedFlag = false;
      bowlK = 0;
      lastRoom = "lit"; // force a resync
      syncRoom();
      mBlock.position.set(st.block.x, st.block.y, st.block.z);
      mPlate.position.y = plateUp;
      mPlateGlow.visible = false;
      mBowlFlame.visible = false;
      aBrazier.lit = true;
      aBowl.lit = false;
    },
    solved(animated: boolean) {
      if (animated && st.room !== "idle" && solvedFlag) return;
      machine.reload(true);
      solvedFlag = true;
      wantStart = false;
      tower.setLit?.(true, false);
      lastRoom = "idle";
      bowlK = 1;
      syncRoom();
      visuals(0, 0, true);
    },
    setQuality(q: Quality) {
      void q;
    },
    markBonusDone() {
      awardedIds.add(ID_RINGS);
    },
    taskPos(out) {
      const p = st.room === "pull" ? st.block : st.room === "fight" ? plan.fight.brazier : st.room === "carry" ? plan.carry.bowl : null;
      if (!p) return false;
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
      return true;
    },
  };
  return h;
}
