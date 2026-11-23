import * as THREE from "three";
import type { EnemyKind, EnemyState, EnemiesV2, FrameCtx, GameEvent, Look, Quality, QualityPreset, Shot, Strike, ThreadAnchor, V3, World } from "./contracts";
import { CAMPS, COUNTER, ENEMY, LANDMARKS, PLAYER_SPAWN, PROLOGUE, QUALITY, SWORD, TELL, THREAD, WAYSTONES } from "./contracts";
import { hitstopFor } from "./combat-events";
import { newEnemyState } from "./state";
import { alert, animate, giveUp, newRt, resetAttack, v3, wispHand } from "./enemy-brain";
import type { EnemyRt, Host } from "./enemy-brain";
import { think } from "./enemy-brain";
import { EnemyFx } from "./enemy-fx";
import { brambling, mossback, wisp } from "./enemy-models";
import { Poser, Rig } from "./enemy-rig";
import { Warden } from "./enemy-warden";

const SLOTS = 32;
const SPAWN_R = 120;
const SLEEP_R = 160;
const RESPAWN_S = 720;
const AI_R = 90;
const BOSS = "boss";
const ARENA = { x: 0, z: -40 };
/** Slots camps leave free so trial waves, summons and the Warden spawn without evicting. */
const RESERVE = 6;

/** Quest-safe points (TELL.questStartSafeR): beacon pedestals, waystones, the spawn and the prologue path. */
export const SAFE_POINTS: readonly { x: number; z: number }[] = [
  ...LANDMARKS.filter((l) => l.id.startsWith("beacon-")).map((l) => ({ x: l.x, z: l.z })),
  ...WAYSTONES.map((w) => ({ x: w.x, z: w.z })),
  { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z },
  PROLOGUE.gateBrazier, PROLOGUE.stones, PROLOGUE.ledge, PROLOGUE.climbRock, PROLOGUE.knotB, PROLOGUE.glade, PROLOGUE.oriel,
];

/** Camp spots pushed out of every safe radius (+ a camp's own 6 m spread + 2 m margin). Pure; the sim checks it. */
export function campSpots(): { x: number; z: number }[] {
  const R = TELL.questStartSafeR + 8;
  return CAMPS.map((c) => {
    let x = c.x, z = c.z;
    for (let it = 0; it < 24; it++) {
      let moved = false;
      for (const s of SAFE_POINTS) {
        const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
        x = s.x + ux * (R + 0.5);
        z = s.z + uz * (R + 0.5);
        moved = true;
      }
      if (!moved) break;
    }
    return { x: Math.round(x), z: Math.round(z) };
  });
}

/** Wren stands within TELL.questStartSafeR of a safe point. */
export function inSafeZone(x: number, z: number): boolean {
  const r2 = TELL.questStartSafeR * TELL.questStartSafeR;
  for (const s of SAFE_POINTS) if ((x - s.x) ** 2 + (z - s.z) ** 2 < r2) return true;
  return false;
}

interface CampRt {
  slots: Int16Array; // pool slot per member, -1 none
  killed: Uint8Array;
  killedAt: Float64Array;
}

export function createEnemies(scene: THREE.Scene, world: World, look: Look, quality: Quality): EnemiesV2 {
  const group = new THREE.Group();
  group.name = "enemies";
  scene.add(group);
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const rigs: Record<Exclude<EnemyKind, "warden">, Rig> = {
    brambling: new Rig(brambling(look), 20, group, shellMat),
    mossback: new Rig(mossback(look), 8, group, shellMat),
    wisp: new Rig(wisp(look), 12, group, shellMat),
  };
  const warden = new Warden(group, look);
  const fx = new EnemyFx(group, world, look);
  const poser = new Poser();
  let preset: QualityPreset = QUALITY[quality];

  const list: EnemyState[] = [];
  const rts: EnemyRt[] = [];
  for (let i = 0; i < SLOTS; i++) {
    list.push(newEnemyState(i));
    rts.push(newRt(8));
  }
  const spots = campSpots();
  const camps: CampRt[] = CAMPS.map((c) => ({
    slots: new Int16Array(c.kinds.length).fill(-1),
    killed: new Uint8Array(c.kinds.length),
    killedAt: new Float64Array(c.kinds.length),
  }));

  const bufA: GameEvent[] = [];
  const bufB: GameEvent[] = [];
  let flip = false;
  const pending: GameEvent[] = [];
  let clock = 0;
  let campT = 0;
  let bossId = -1;
  let tokensMax: number = TELL.maxAttackers;
  const tokCool = new Float32Array(TELL.maxAttackers); // returned tokens wait TELL.tokenCooldown before reuse
  // one Thread anchor per slot (live position = aimPoint), then the Warden's 4 chain anchors. Stable array.
  const anchors: ThreadAnchor[] = list.map((e, i) => ({ id: `enemy:${i}`, kind: "enemy" as const, pos: e.aimPoint, weight: 1 as const, lit: false, enabled: false }));
  const rank = new Float32Array(SLOTS);

  const strike: Strike = { team: "enemy", source: 0, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: 1, arc: 1, height: 1, damage: 1, kind: "claw", knockback: 0, unblockable: false };
  const shot: Shot = { team: "enemy", source: 0, kind: "bolt", pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, damage: 1, gravity: 0 };
  const host: Host = {
    out: pending,
    fx,
    strike,
    shot,
    rally(src: EnemyState) {
      for (let i = 0; i < SLOTS; i++) {
        const e = list[i], rt = rts[i];
        if (!e.alive || rt.aggro || e === src || e.group !== src.group) continue;
        if (e.pos.distanceToSquared(src.pos) < 30 * 30) alert(e, rt, host);
      }
    },
    release(rt: EnemyRt) {
      if (!rt.token) return;
      rt.token = false;
      for (let k = 0; k < tokCool.length; k++) if (tokCool[k] <= 0) { tokCool[k] = TELL.tokenCooldown; break; }
    },
    playerSafe: false,
  };
  anchors.push(...warden.chains);

  function setBrain(e: EnemyState, b: EnemyState["brain"]): void {
    e.brain = b;
    e.brainT = 0;
  }

  function freeCount(): number {
    let n = 0;
    for (let i = 0; i < SLOTS; i++) if (!rts[i].busy) n++;
    return n;
  }

  function freeSlot(): number {
    for (let i = 0; i < SLOTS; i++) if (!rts[i].busy) return i;
    return -1;
  }

  /**
   * Trial waves and the Warden must spawn or their fights never end. Take the slot of the farthest camp enemy
   * (camps respawn), else the farthest enemy of another group. Never the Warden or the group being spawned.
   */
  function evictSlot(grp: string): number {
    const pp = lastCtx?.player.pos;
    let best = -1, bestD = -1;
    for (let i = 0; i < SLOTS; i++) {
      if (!rts[i].busy || i === bossId || list[i].group === grp) continue;
      const d = (pp ? (list[i].pos.x - pp.x) ** 2 + (list[i].pos.z - pp.z) ** 2 : 0) + (rts[i].camp >= 0 ? 1e9 : 0);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) free(best);
    return best;
  }

  function spawn(kind: EnemyKind, x: number, z: number, grp: string, camp: number, member: number, emerge: boolean, must = false): number {
    let i = freeSlot();
    if (i < 0 && must) i = evictSlot(grp);
    if (i < 0) return -1;
    const e = list[i], rt = rts[i], s = ENEMY[kind];
    const gy = world.heightAt(x, z);
    e.kind = kind;
    e.alive = true;
    e.lockable = true;
    e.hp = e.maxHp = s.hp;
    e.pos.set(x, kind === "wisp" ? Math.max(gy, world.waterAt(x, z)) + 2.8 : world.groundAt(x, gy + 2, z), z);
    e.vel.set(0, 0, 0);
    e.home.set(x, gy, z);
    e.yaw = Math.random() * Math.PI * 2;
    e.group = grp;
    e.stun = 0;
    e.phase = 1;
    setBrain(e, "idle");
    rt.busy = true;
    rt.camp = camp;
    rt.member = member;
    rt.cd = 0.8 + Math.random();
    rt.token = rt.want = false;
    rt.think = Math.random() * 0.3;
    rt.seen = rt.aggro = false;
    rt.wait = Math.random() * 2;
    rt.glow = rt.flash = 0;
    rt.dying = -1;
    rt.silent = false;
    rt.emerge = emerge ? 0 : 1;
    rt.lodAcc = 1;
    rt.hitDone = false;
    rt.poise = 0;
    rt.knock.set(0, 0, 0);
    rt.leash = camp >= 0 ? s.leash : 999;
    rt.target.set(x, 0, z);
    rt.speed = 0;
    rt.told = false;
    rt.glint = rt.freeze = rt.riposte = rt.burnFx = rt.low = 0;
    rt.bindTo = rt.bindLine = rt.tether = -1;
    e.aimPoint.set(x, e.pos.y + s.height * 0.55, z);
    if (emerge) {
      ctxFx?.burst("gloam", v3(x, gy + 0.2, z), 16, v3(0, 1, 0), 3);
    }
    return i;
  }

  function free(i: number): void {
    const rt = rts[i], e = list[i];
    resetAttack(rt, host);
    rt.busy = false;
    rt.bindTo = -1;
    e.alive = false;
    e.lockable = false;
    if (rt.camp >= 0) {
      const c = camps[rt.camp];
      if (c.slots[rt.member] === i) c.slots[rt.member] = -1;
    }
    rt.camp = -1;
    if (i === bossId) {
      bossId = -1;
      warden.sleep();
    }
  }

  /** Start the dissolve. `silent` = despawn: no event, no drops. */
  function kill(i: number, silent: boolean): void {
    const e = list[i], rt = rts[i];
    if (!rt.busy || rt.dying >= 0) return;
    e.alive = false;
    e.lockable = false;
    resetAttack(rt, host);
    rt.bindTo = -1;
    rt.dying = 0;
    rt.silent = silent;
    rt.glow = 0;
    e.vel.set(0, 0, 0);
    setBrain(e, "dead");
    if (silent) return;
    const p = v3(e.pos.x, e.pos.y, e.pos.z);
    pending.push({ type: "enemyDied", id: e.id, kind: e.kind, pos: p, group: e.group });
    if (rt.camp >= 0) {
      const c = camps[rt.camp];
      c.killed[rt.member] = 1;
      c.killedAt[rt.member] = clock;
    }
  }

  function despawnGroup(g: string): void {
    for (let i = 0; i < SLOTS; i++) {
      if (!rts[i].busy || list[i].group !== g) continue;
      if (i === bossId) free(i);
      else kill(i, true);
    }
  }

  function wakeBoss(pos: V3): void {
    if (bossId >= 0) return;
    const near = Math.hypot(pos.x - ARENA.x, pos.z - ARENA.z) < 45;
    const hx = near ? ARENA.x : pos.x, hz = near ? ARENA.z : pos.z;
    const i = spawn("warden", near ? ARENA.x : pos.x, near ? ARENA.z : pos.z, BOSS, -1, -1, false, true);
    if (i < 0) return;
    bossId = i;
    const e = list[i], rt = rts[i];
    e.home.set(hx, world.heightAt(hx, hz), hz);
    e.pos.y = world.groundAt(e.pos.x, e.home.y + 3, e.pos.z);
    e.yaw = Math.atan2(pos.x - e.pos.x, pos.z - e.pos.z) || 0;
    warden.wake(e, rt);
    tokensMax = 1;
  }

  let ctxFx: FrameCtx["fx"] | null = null;
  let lastCtx: FrameCtx | null = null;

  function applyHit(ev: Extract<GameEvent, { type: "hit" }>): void {
    if (ev.team === "enemy") {
      if (!ev.parried || ev.source < 0 || ev.source >= SLOTS) return;
      const e = list[ev.source], rt = rts[ev.source];
      if (!e.alive) return;
      if (ev.source === bossId) {
        if (ev.kind !== "bolt") warden.parried(e);
        return;
      }
      if (ev.kind === "bolt") return;
      e.stun = SWORD.parryStun;
      rt.riposte = SWORD.parryStun;
      resetAttack(rt, host);
      setBrain(e, "stunned");
      rt.knock.set(-Math.sin(e.yaw) * 4, 0, -Math.cos(e.yaw) * 4);
      return;
    }
    if (ev.target < 0 || ev.target >= SLOTS) return;
    const e = list[ev.target], rt = rts[ev.target];
    if (!e.alive) return;
    let dmg = ev.damage;
    const fx0 = Math.sin(e.yaw), fz0 = Math.cos(e.yaw);
    const behind = ev.dir.x * fx0 + ev.dir.z * fz0 > 0.35;
    rt.freeze = Math.max(rt.freeze, hitstopFor(ev.kind, ev.knockback));
    const thread = ev.kind === "bind" || ev.kind === "burn";
    if (ev.kind === "burn" && e.kind === "brambling") dmg *= 5; // bark burns away in about a second
    if (ev.target === bossId) {
      dmg = warden.damage(e, dmg, ev.kind, ev.pos.y, pending);
      if (dmg > 0 && !thread) rt.flash = 1;
      if (dmg <= 0) {
        ctxFx?.burst("spark", ev.pos, 6);
        return;
      }
      e.hp -= dmg;
      pending.push({ type: "enemyHurt", id: e.id, kind: e.kind, pos: v3(e.pos.x, e.pos.y, e.pos.z), hp: Math.max(0, e.hp) });
      if (e.hp <= 0) {
        e.hp = 0;
        e.alive = false;
        e.lockable = false;
        warden.die(e, host);
        despawnGroup("boss-summon");
        tokensMax = TELL.maxAttackers;
      }
      return;
    }
    if (e.kind === "mossback") {
      if (ev.kind === "arrow") {
        if (behind || ev.pos.y > e.pos.y + 1.9) dmg *= 0.5;
      } else if (ev.kind === "burn") dmg *= COUNTER.mossbackBurn;
      else if (behind) dmg *= COUNTER.mossbackBehind;
    } else if (e.kind === "wisp") {
      if (ev.kind === "arrow") dmg = Math.max(dmg * 2, e.hp);
      else if (!thread) rt.low = Math.max(rt.low, COUNTER.wispHurtHold);
    }
    e.hp -= dmg;
    if (ev.kind === "burn") rt.burnFx = 0.3;
    else rt.flash = 1;
    const mass = e.kind === "mossback" ? COUNTER.mossbackKnock : e.kind === "wisp" ? 0.7 : 1;
    rt.knock.x += ev.dir.x * ev.knockback * mass;
    rt.knock.z += ev.dir.z * ev.knockback * mass;
    ctxFx?.burst(e.kind === "wisp" ? "gloam" : "blood-sap", ev.pos, 8, ev.dir, 3);
    if (!rt.aggro && e.hp > 0) {
      alert(e, rt, host);
      host.rally(e);
    }
    if (e.hp <= 0) {
      e.hp = 0;
      kill(ev.target, false);
      return;
    }
    pending.push({ type: "enemyHurt", id: e.id, kind: e.kind, pos: v3(e.pos.x, e.pos.y, e.pos.z), hp: e.hp });
    if (e.brain === "stunned" || thread) return;
    const heavy = dmg >= 25 || ev.kind === "spin" || ev.kind === "riposte";
    const busyAtk = e.brain === "windup" || e.brain === "attack";
    if (e.kind !== "mossback" || !busyAtk || heavy) {
      resetAttack(rt, host);
      setBrain(e, "hurt");
    }
  }

  function manageCamps(ctx: FrameCtx): void {
    const p = ctx.player.pos;
    const h = ctx.env.timeOfDay;
    const night = h >= 20 || h < 5;
    for (let c = 0; c < CAMPS.length; c++) {
      const camp = CAMPS[c], cr = camps[c], cx = spots[c].x, cz = spots[c].z;
      const d = Math.hypot(p.x - cx, p.z - cz);
      for (let m = 0; m < camp.kinds.length; m++) {
        if (cr.killed[m] && clock - cr.killedAt[m] > RESPAWN_S) cr.killed[m] = 0;
      }
      const allowed = !camp.night || night;
      if (d < SPAWN_R && allowed) {
        for (let m = 0; m < camp.kinds.length; m++) {
          if (cr.killed[m] || cr.slots[m] >= 0) continue;
          if (freeCount() <= RESERVE) break;
          const a = m * 2.4 + c, r = m === 0 ? 0.5 : 2.5 + (m % 2) * 1.5;
          const i = spawn(camp.kinds[m], cx + Math.sin(a) * r, cz + Math.cos(a) * r, camp.id, c, m, false);
          if (i >= 0) cr.slots[m] = i;
        }
      } else if (d > SLEEP_R || !allowed) {
        let fighting = false;
        for (let m = 0; m < camp.kinds.length; m++) {
          const i = cr.slots[m];
          if (i >= 0 && rts[i].aggro && list[i].alive) fighting = true;
        }
        if (fighting && allowed) continue;
        for (let m = 0; m < camp.kinds.length; m++) {
          const i = cr.slots[m];
          if (i < 0) continue;
          if (rts[i].dying < 0) {
            if (allowed) free(i);
            else kill(i, true); // dawn: night wisps fade out
          }
        }
      }
    }
  }

  function slotOf(id: string): number {
    if (!id.startsWith("enemy:")) return -1;
    const i = +id.slice(6);
    return i >= 0 && i < SLOTS && i !== bossId && list[i].alive ? i : -1;
  }

  function anchorPos(id: string, ctx: FrameCtx): V3 | null {
    const all = ctx.anchors;
    if (all) for (let k = 0; k < all.length; k++) if (all[k].id === id) return all[k].pos;
    for (let k = 0; k < anchors.length; k++) if (anchors[k].id === id) return anchors[k].pos;
    return null;
  }

  /** Thread effects on enemies: pulls, bind yanks, tether leashes, burning threads on the Warden's chains. */
  function threads(ctx: FrameCtx): void {
    const dt = ctx.dt;
    for (let i = 0; i < SLOTS; i++) {
      const rt = rts[i], e = list[i];
      if (rt.bindTo < 0) continue;
      const j = rt.bindTo, o = list[j];
      if (!e.alive || !o.alive || rts[j].bindTo !== i) { rt.bindTo = -1; continue; }
      if (j < i) continue; // each pair once
      const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, dz) + 1e-6;
      const touch = ENEMY[e.kind].radius + ENEMY[o.kind].radius + 0.2;
      if (d <= touch) {
        // contact: both reel (the bind strike from the thread module carries the damage)
        for (const k of [i, j]) {
          rts[k].bindTo = -1;
          list[k].stun = THREAD.bindStagger;
          setBrain(list[k], "stunned");
        }
        ctx.fx.burst("spark", v3((e.pos.x + o.pos.x) / 2, e.pos.y + 0.8, (e.pos.z + o.pos.z) / 2), 14, v3(0, 1, 0), 4);
        host.out.push({ type: "shake", strength: 0.3 });
        continue;
      }
      const wa = e.kind === "mossback" ? 3 : 1, wb = o.kind === "mossback" ? 3 : 1;
      const step = Math.min(THREAD.bindYank * dt * 2, d - touch) / 2;
      const ka = (2 * wb) / (wa + wb), kb = (2 * wa) / (wa + wb); // the heavier one moves less
      e.pos.x += (dx / d) * step * ka; e.pos.z += (dz / d) * step * ka;
      o.pos.x -= (dx / d) * step * kb; o.pos.z -= (dz / d) * step * kb;
      e.stun = Math.max(e.stun, 0.2);
      o.stun = Math.max(o.stun, 0.2);
    }
    const th = ctx.threads;
    if (!th) return;
    for (let k = 0; k < th.pulls.length; k++) {
      const pl = th.pulls[k], i = slotOf(pl.anchor);
      if (i < 0) continue;
      const e = list[i], dx = pl.to.x - e.pos.x, dz = pl.to.z - e.pos.z, d = Math.hypot(dx, dz);
      if (d <= THREAD.pullStop) continue;
      const step = Math.min(pl.speed * dt, d - THREAD.pullStop);
      e.pos.x += (dx / d) * step;
      e.pos.z += (dz / d) * step;
    }
    for (let k = 0; k < th.lines.length; k++) {
      const ln = th.lines[k];
      if (ln.burning && bossId >= 0) {
        if (ln.a.startsWith("warden:")) warden.cutChain(ln.a, list[bossId], host.out);
        if (ln.b.startsWith("warden:")) warden.cutChain(ln.b, list[bossId], host.out);
      }
      if (ln.use !== "tether") continue;
      // leash: the enemy end cannot move beyond the thread length from the fixed end
      let i = slotOf(ln.a), other = ln.b;
      if (i < 0) { i = slotOf(ln.b); other = ln.a; }
      if (i < 0) continue;
      const fp = anchorPos(other, ctx);
      if (!fp) continue;
      const e = list[i], dx = e.pos.x - fp.x, dz = e.pos.z - fp.z, d = Math.hypot(dx, dz);
      const len = Math.max(1, ln.len);
      if (d > len) {
        e.pos.x = fp.x + (dx / d) * len;
        e.pos.z = fp.z + (dz / d) * len;
      }
      if (e.kind === "wisp") {
        e.pos.y += (Math.max(fp.y + 0.6, world.heightAt(e.pos.x, e.pos.z) + 0.6) - e.pos.y) * Math.min(1, dt * 3);
        rts[i].low = Math.max(rts[i].low, 0.2); // tethered: held at sword height (hover would lift it back to 2.8 m)
      }
    }
  }

  /** "threadBind": a and b fly together (b = -1: a is tethered to a fixed anchor). */
  function bind(a: number, b: number): void {
    const ok = (i: number) => i >= 0 && i < SLOTS && i !== bossId && list[i].alive && rts[i].dying < 0;
    if (!ok(a)) return;
    if (b < 0 || !ok(b)) {
      resetAttack(rts[a], host);
      list[a].stun = Math.max(list[a].stun, THREAD.tetherStagger);
      setBrain(list[a], "stunned");
      return;
    }
    for (const [i, j] of [[a, b], [b, a]]) {
      resetAttack(rts[i], host);
      rts[i].bindTo = j;
      list[i].stun = 3; // safety: contact sets bindStagger
      setBrain(list[i], "stunned");
    }
  }

  function summon(kind: EnemyKind, x: number, z: number): void {
    const i = spawn(kind, x, z, "boss-summon", -1, -1, true, true);
    if (i >= 0) {
      const e = list[i], rt = rts[i];
      alert(e, rt, host);
      e.yaw = Math.atan2(lastCtx!.player.pos.x - x, lastCtx!.player.pos.z - z);
    }
  }

  function update(ctx: FrameCtx): readonly GameEvent[] {
    const out = flip ? bufA : bufB;
    flip = !flip;
    out.length = 0;
    for (let i = 0; i < pending.length; i++) out.push(pending[i]);
    pending.length = 0;
    host.out = out;
    ctxFx = ctx.fx;
    lastCtx = ctx;
    const dt = ctx.dt;
    clock += ctx.realDt;
    preset = ctx.quality;
    const p = ctx.player.pos;
    host.playerSafe = inSafeZone(p.x, p.z);
    for (let k = 0; k < tokCool.length; k++) tokCool[k] -= dt;

    campT -= ctx.realDt;
    if (campT <= 0) {
      campT = 0.5;
      manageCamps(ctx);
    }
    fx.begin();

    // distances and the AI cap: nearest N inside AI_R run full brains
    for (let i = 0; i < SLOTS; i++) {
      const e = list[i], rt = rts[i];
      rt.dist = rt.busy ? Math.hypot(p.x - e.pos.x, p.z - e.pos.z) : 1e9;
      rank[i] = rt.busy && e.alive ? rt.dist : 1e9;
    }
    const cap = preset.enemyLodDist < 60 ? 12 : 20;
    for (let i = 0; i < SLOTS; i++) {
      const rt = rts[i];
      if (rank[i] > AI_R) {
        rt.active = i === bossId && list[i].alive;
        continue;
      }
      let closer = 0;
      for (let j = 0; j < SLOTS; j++) if (rank[j] < rank[i] || (rank[j] === rank[i] && j < i)) closer++;
      rt.active = closer < cap || i === bossId || rt.aggro;
    }

    for (let i = 0; i < SLOTS; i++) {
      const e = list[i], rt = rts[i];
      if (!rt.busy) continue;
      rt.flash = Math.max(0, rt.flash - dt * 6);
      rt.glint = Math.max(0, rt.glint - dt);
      rt.riposte = e.brain === "stunned" ? Math.max(0, rt.riposte - dt) : 0;
      rt.burnFx = Math.max(0, rt.burnFx - dt);
      if (rt.freeze > 0) {
        // local hitstop: only the victim (and Wren, in the player module) freezes; the world runs on
        rt.freeze -= ctx.realDt;
        continue;
      }
      if (i === bossId) {
        if (warden.active) warden.think(ctx, e, rt, host, summon);
        continue;
      }
      if (rt.dying >= 0) {
        rt.dying += dt;
        if (rt.dying < 1.2 && Math.random() < 0.6) {
          const s = ENEMY[e.kind];
          ctx.fx.burst("gloam", v3(e.pos.x + (Math.random() - 0.5) * s.radius * 2, e.pos.y + Math.random() * s.height, e.pos.z + (Math.random() - 0.5) * s.radius * 2), 2, v3(0, 1, 0), 1.5);
        }
        if (rt.dying >= 1.2) free(i);
        continue;
      }
      if (!e.alive) continue;
      if (rt.active) think(ctx, e, rt, host);
      else {
        e.vel.set(0, 0, 0);
        rt.speed = 0;
        if (rt.token || e.brain === "windup" || e.brain === "attack") {
          resetAttack(rt, host);
          setBrain(e, rt.aggro ? "chase" : "idle");
        }
      }
    }
    threads(ctx);

    // attack tokens: hand free ones to the nearest enemies that asked
    let held = 0;
    for (let i = 0; i < SLOTS; i++) if (rts[i].token) {
      if (!list[i].alive || !rts[i].aggro) host.release(rts[i]);
      else held++;
    }
    for (let k = 0; k < tokCool.length; k++) if (tokCool[k] > 0) held++;
    while (held < tokensMax) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < SLOTS; i++) {
        const rt = rts[i];
        if (rt.want && !rt.token && list[i].alive && rt.dist < bd) {
          bd = rt.dist;
          best = i;
        }
      }
      if (best < 0) break;
      rts[best].token = true;
      held++;
    }

    // separation between enemies, and from the player
    for (let i = 0; i < SLOTS; i++) {
      const a = list[i];
      if (!a.alive || !rts[i].active || i === bossId) continue;
      const ra = ENEMY[a.kind].radius;
      for (let j = 0; j < SLOTS; j++) {
        if (j === i) continue;
        const b = list[j];
        if (!b.alive || !rts[j].busy) continue;
        const rr = ra + ENEMY[b.kind].radius;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (rr - d) * (j === bossId ? 1 : 0.5);
        a.pos.x += (dx / d) * push;
        a.pos.z += (dz / d) * push;
      }
      if (ctx.player.mode !== "dead" && a.kind !== "wisp") {
        const rr = ra + 0.4;
        const dx = a.pos.x - p.x, dz = a.pos.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6 && Math.abs(a.pos.y - p.y) < 1.5) {
          const d = Math.sqrt(d2);
          a.pos.x = p.x + (dx / d) * rr;
          a.pos.z = p.z + (dz / d) * rr;
        }
      }
    }

    rigs.brambling.begin();
    rigs.mossback.begin();
    rigs.wisp.begin();
    const lod = preset.enemyLodDist;
    for (let i = 0; i < SLOTS; i++) {
      const e = list[i], rt = rts[i];
      if (!rt.busy) continue;
      if (i === bossId) {
        warden.draw(ctx, e, rt);
        warden.drawCrown(e, host, ctx.time);
        if (warden.dying && !warden.active) free(i);
        continue;
      }
      const s = ENEMY[e.kind];
      rt.lodAcc += dt;
      if (rt.dist < lod || rt.lodAcc >= 0.1 || rt.dying >= 0) {
        animate(e, rt, poser, rt.lodAcc);
        rt.lodAcc = 0;
      }
      let scale = 1, sink = 0;
      if (rt.emerge < 1) {
        const k = rt.emerge;
        scale = 0.35 + 0.65 * k;
        sink = (1 - k) * s.height * 0.6;
      }
      let gr = 0, gg = 0, gb = 0;
      const g = rt.glow;
      if (g > 0) {
        gr += 0.42 * g;
        gg += 0.06 * g;
        gb += 0.85 * g;
      }
      if (rt.flash > 0) {
        gr += 0.9 * rt.flash;
        gg += 0.85 * rt.flash;
        gb += 0.8 * rt.flash;
      }
      if (rt.dying >= 0) {
        const k = Math.min(1, rt.dying / 1.2);
        scale *= 1 - k * 0.75;
        sink += k * k * s.height * 0.5;
        const f = Math.sin(Math.min(1, k * 2.2) * Math.PI) * 0.9 + 0.25 * (1 - k);
        gr += 0.45 * f;
        gg += 0.1 * f;
        gb += 0.9 * f;
      } else if (e.brain === "stunned") {
        const f = 0.18 + 0.1 * Math.sin(ctx.time * 12);
        gr += f * 0.8;
        gg += f * 0.75;
        gb += f * 0.4;
        // dizzy stars over the head
        const top = e.pos.y + s.height * (e.kind === "wisp" ? 0.7 : 1.05);
        for (let k = 0; k < 3; k++) {
          const a = ctx.time * 4 + (k * Math.PI * 2) / 3, r = s.radius * 0.9 + 0.15;
          fx.orb(e.pos.x + Math.sin(a) * r, top + Math.sin(a * 2) * 0.05, e.pos.z + Math.cos(a) * r, 0.07, 1.2, 1.0, 0.45);
        }
      }
      if (rt.glint > 0 && rt.dying < 0) {
        // the tell: a gold glint on the weapon, TELL.glintLead before the hit frame
        const k = rt.glint / 0.14, fx0 = Math.sin(e.yaw), fz0 = Math.cos(e.yaw);
        let gx = e.pos.x + fx0 * s.radius * 1.1, gy = e.pos.y + s.height * 0.75, gz = e.pos.z + fz0 * s.radius * 1.1;
        if (e.kind === "wisp") {
          const hand = wispHand(e, _h);
          gx = hand.x; gy = hand.y; gz = hand.z;
        } else if (e.kind === "mossback") gy = e.pos.y + s.height * 1.05;
        fx.orb(gx, gy, gz, 0.22 + 0.25 * k, 1.5 * k, 1.15 * k, 0.4 * k);
        fx.orb(gx, gy, gz, 0.08 + 0.08 * k, 1.4, 1.4, 1.3);
      }
      if (rt.riposte > 0 && rt.dying < 0) {
        // riposte window: a gold ring under the parried enemy for the whole stun
        const k = Math.min(1, rt.riposte / 0.3);
        fx.ring(e.pos.x, world.heightAt(e.pos.x, e.pos.z), e.pos.z, s.radius + 0.6, 0, 1.1 * k, 0.8 * k, 0.25 * k);
      }
      if (rt.burnFx > 0 && Math.random() < 0.5) ctx.fx.burst("ember", v3(e.pos.x, e.pos.y + Math.random() * s.height, e.pos.z), 2, v3(0, 1, 0), 1.5);
      rigs[e.kind as "brambling"].draw(rt.pose, e.pos.x, e.pos.y - sink, e.pos.z, e.yaw, scale, gr, gg, gb);
      if (e.kind === "wisp" && rt.dying < 0) {
        const hand = wispHand(e, _h);
        const charge = e.brain === "windup" ? Math.min(1, e.brainT / s.windup) : e.brain === "attack" ? 1 - e.brainT / 0.12 : 0;
        if (charge > 0.01) {
          const pul = 1 + 0.15 * Math.sin(ctx.time * 30);
          fx.orb(hand.x, hand.y, hand.z, (0.1 + 0.22 * charge) * pul, 0.7 * charge, 0.35 * charge, 1.1 * charge);
          fx.orb(hand.x, hand.y, hand.z, (0.05 + 0.08 * charge) * pul, 1.1, 1.0, 1.2);
        }
      }
      if (e.alive) e.aimPoint.set(e.pos.x, e.pos.y + (e.kind === "wisp" ? 0 : s.height * 0.55), e.pos.z);
    }
    for (let i = 0; i < SLOTS; i++) {
      const e = list[i], rt = rts[i], a = anchors[i];
      a.enabled = rt.busy && e.alive && rt.dying < 0 && e.kind !== "warden";
      a.weight = e.kind === "mossback" ? 3 : 1;
    }
    rigs.brambling.end();
    rigs.mossback.end();
    rigs.wisp.end();
    fx.update(ctx, out);
    fx.end();
    return out;
  }
  const _h = new THREE.Vector3();

  function handle(events: readonly GameEvent[]): void {
    host.out = pending;
    for (let n = 0; n < events.length; n++) {
      const ev = events[n];
      switch (ev.type) {
        case "hit":
          applyHit(ev);
          break;
        case "spawn":
          if (ev.kind === "warden") wakeBoss(ev.pos);
          else {
            const i = spawn(ev.kind, ev.pos.x, ev.pos.z, ev.group, -1, -1, true, true);
            if (i >= 0) {
              alert(list[i], rts[i], host);
              if (lastCtx) list[i].yaw = Math.atan2(lastCtx.player.pos.x - ev.pos.x, lastCtx.player.pos.z - ev.pos.z);
            }
          }
          break;
        case "despawnGroup":
          despawnGroup(ev.group);
          break;
        case "threadBind":
          bind(ev.a, ev.b);
          break;
        case "bossWake":
          wakeBoss(ev.pos);
          break;
        case "rest":
          for (const c of camps) c.killed.fill(0);
          break;
        case "died":
          despawnGroup(BOSS);
          despawnGroup("boss-summon");
          tokensMax = TELL.maxAttackers;
          for (let i = 0; i < SLOTS; i++) if (list[i].alive && rts[i].aggro) giveUp(list[i], rts[i], host);
          break;
      }
    }
  }

  function clear(): void {
    for (let i = 0; i < SLOTS; i++) if (rts[i].busy) free(i);
    for (const c of camps) {
      c.slots.fill(-1);
      c.killed.fill(0);
    }
    pending.length = 0;
    bossId = -1;
    tokensMax = TELL.maxAttackers;
    tokCool.fill(0);
    warden.sleep();
    fx.clear();
    campT = 0;
  }

  const api: EnemiesV2 = {
    list,
    anchors,
    group,
    update,
    handle,
    boss() {
      if (bossId < 0) return null;
      const e = list[bossId];
      if (!e.alive) return null;
      return { name: "The Gloam Warden", hp: Math.max(0, e.hp), maxHp: e.maxHp, phase: warden.phase };
    },
    clear,
    setQuality(q: Quality) {
      preset = QUALITY[q];
    },
    setOutline(on: boolean) {
      for (const r of Object.values(rigs)) r.setOutline(on);
    },
    dispose() {
      clear();
      rigs.brambling.dispose();
      rigs.mossback.dispose();
      rigs.wisp.dispose();
      warden.dispose();
      fx.dispose();
      shellMat.dispose();
      group.removeFromParent();
    },
  };
  return Object.assign(api, {
    lab: {
      warden,
      get bossId() {
        return bossId;
      },
      rts,
      spots,
    },
  });
}
