import * as THREE from "three";
import type { DamageSource, Dim, Entity, GameCtx, GameEvent, GameMode, ItemStack, PlayerApi, Rules } from "../contracts";
import { knockBody, playerKbResist } from "../entities/combat";
import { segmentBox } from "../entities/geom";
import type { PlayerState } from "../player/state";
import { mobDef } from "../entities/registry";
import { CREATIVE_ENTITY_BONUS, ENTITY_REACH, EYE_SNEAK, EYE_STAND, POTIONS, attackStats, attackStrength, ench, enchantDamageBonus, toolOf } from "../player/stats";
import type { Health } from "./host-health";
import type { GameInternals, Inventory } from "./index";
import { INTERP_DELAY_MS } from "./interp";
import { F, type ClientMsg, type Equip, type HostMsg } from "./protocol";
import type { PvpHook } from "./pvp-hook";

// Player-vs-player melee and projectile hits, Java 1.21 rules. The host decides every hit; clients only send what they swung at.

export const pvpOn = (rules: Pick<Rules, "pvp">) => rules.pvp !== false;

// Death messages name the attacker by entity type; a player attacker's type is "@" + its name.
export const PLAYER_TYPE = "@";

export interface Fighter {
  id: number; // 0 is the host
  name: string;
  dim: Dim;
  pos: THREE.Vector3;
  yaw: number;
  f: number; // protocol F bits
  gameMode: GameMode;
  dead: boolean;
  held: ItemStack | null;
  effect(id: string): number; // amplifier + 1, 0 when absent
}

export interface MeleeClaim {
  s: number;
  crit: boolean;
}

export type Ray = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => { dist: number } | null;

export type Verdict =
  | { ok: false; why: "pvp" | "self" | "dim" | "attacker" | "target" | "reach" | "sight" | "weak" }
  | { ok: true; s: number; total: number; crit: boolean; sprint: boolean; sweep: number; sweepBase: number; knock: number };

// Ticks of attack-cooldown slack for a client whose swing reaches the host a little late.
const COOLDOWN_SLACK = 3;
// Reach past vanilla's 3 blocks for movement the host has not seen yet, as in host.ts canReach.
const REACH_SLACK = 1;

const eyeY = (f: Fighter) => f.pos.y + (f.f & F.sneak ? EYE_SNEAK : EYE_STAND);
const height = (f: Fighter) => (f.f & F.sneak ? 1.5 : 1.8);
const vulnerable = (f: Fighter) => !f.dead && (f.gameMode === "survival" || f.gameMode === "adventure");

function boxDist2(x: number, y: number, z: number, t: Fighter) {
  const dx = Math.max(t.pos.x - 0.3 - x, 0, x - t.pos.x - 0.3);
  const dy = Math.max(t.pos.y - y, 0, y - t.pos.y - height(t));
  const dz = Math.max(t.pos.z - 0.3 - z, 0, z - t.pos.z - 0.3);
  return dx * dx + dy * dy + dz * dz;
}

// Vanilla sweep: the target's box inflated 1 x 0.25 x 1 touches o's box, and o stands within 3 blocks of the attacker.
export interface SweepBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}
export function inSweep(t: SweepBox, o: SweepBox, a: { x: number; y: number; z: number }) {
  const r = t.w / 2 + 1 + o.w / 2;
  if (Math.abs(o.x - t.x) >= r || Math.abs(o.z - t.z) >= r) return false;
  if (o.y >= t.y + t.h + 0.25 || o.y + o.h <= t.y - 0.25) return false;
  const dx = o.x - a.x, dy = o.y - a.y, dz = o.z - a.z;
  return dx * dx + dy * dy + dz * dz < 9;
}

const rayO = new THREE.Vector3();
const rayD = new THREE.Vector3();

// Clear when any of the target's eye, middle or feet can be seen from the attacker's eye.
export function canSeeFighter(a: Fighter, t: Fighter, ray: Ray): boolean {
  for (const k of [0.9, 0.5, 0.1]) {
    rayO.set(a.pos.x, eyeY(a), a.pos.z);
    rayD.set(t.pos.x, t.pos.y + height(t) * k, t.pos.z).sub(rayO);
    const d = rayD.length();
    if (d < 1e-6) return true;
    rayD.divideScalar(d);
    const hit = ray(rayO, rayD, d);
    if (!hit || hit.dist >= d - 0.3) return true;
  }
  return false;
}

// Vanilla Player.attack on a player target, checked on the host. last: host tick of the attacker's previous swing.
export function meleeVerdict(a: Fighter, t: Fighter, o: { pvp: boolean; tick: number; last: number; claim: MeleeClaim; ray: Ray }): Verdict {
  if (!o.pvp) return { ok: false, why: "pvp" };
  if (a.id === t.id) return { ok: false, why: "self" };
  if (a.dim !== t.dim) return { ok: false, why: "dim" };
  if (a.dead || a.gameMode === "spectator") return { ok: false, why: "attacker" };
  if (!vulnerable(t)) return { ok: false, why: "target" };
  const reach = (a.gameMode === "creative" ? ENTITY_REACH + CREATIVE_ENTITY_BONUS : ENTITY_REACH) + REACH_SLACK;
  if (boxDist2(a.pos.x, eyeY(a), a.pos.z, t) > reach * reach) return { ok: false, why: "reach" };
  if (!canSeeFighter(a, t, o.ray)) return { ok: false, why: "sight" };
  const held = a.held;
  const st = attackStats(held);
  const claimed = Number.isFinite(o.claim.s) ? Math.max(0, Math.min(1, o.claim.s)) : 0;
  const s = Math.min(claimed, attackStrength(o.tick - o.last + COOLDOWN_SLACK, st.speed));
  let dmg = st.damage + a.effect("strength") * 3 - a.effect("weakness") * 4;
  let bonus = enchantDamageBonus(held, "player");
  dmg *= 0.2 + s * s * 0.8;
  bonus *= s;
  if (dmg <= 0 && bonus <= 0) return { ok: false, why: "weak" };
  const charged = s > 0.9;
  const sprint = charged && (a.f & F.sprint) !== 0;
  // The host only sees flags, not fall distance: a crit needs the claim and an airborne, non-sprinting attacker.
  const crit = charged && o.claim.crit === true && !(a.f & (F.ground | F.sprint | F.swim | F.fly)) && !a.effect("blindness");
  if (crit) dmg *= 1.5;
  const sword = toolOf(held)?.kind === "sword";
  const ratio = ench(held, "sweeping_edge");
  const sweepBase = charged && !crit && !sprint && (a.f & F.ground) !== 0 && sword ? 1 + dmg * (ratio / (ratio + 1)) : 0;
  const sweep = sweepBase > 0 ? (sweepBase + enchantDamageBonus(held, "player")) * s : 0;
  return { ok: true, s, total: dmg + bonus, crit, sprint, sweep, sweepBase, knock: ench(held, "knockback") + (sprint ? 1 : 0) };
}

// Lag compensation: attackers aim at where they saw the target, INTERP_DELAY_MS plus a round trip ago.
export const HISTORY_MS = 500;
export const REWIND_MAX_MS = 300;

export interface PastPose {
  t: number;
  x: number;
  y: number;
  z: number;
  f: number;
}

// Recent positions of each fighter as the host saw them.
export function createPoseHistory() {
  const byId = new Map<number, PastPose[]>();
  return {
    record(id: number, t: number, pos: { x: number; y: number; z: number }, f: number) {
      const list = byId.get(id) ?? [];
      byId.set(id, list);
      list.push({ t, x: pos.x, y: pos.y, z: pos.z, f });
      while (list.length > 2 && list[1].t < t - HISTORY_MS) list.shift();
    },
    at(id: number, t: number): PastPose | null {
      const list = byId.get(id);
      if (!list?.length) return null;
      if (t <= list[0].t) return list[0];
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        if (a.t > t) continue;
        const b = list[i + 1];
        if (!b) return a;
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, f: k < 0.5 ? a.f : b.f };
      }
      return null;
    },
    // Drops fighters that are gone.
    keep(ids: Set<number>) {
      for (const id of byId.keys()) if (!ids.has(id)) byId.delete(id);
    },
  };
}

// How far back the attacker saw the world: the interpolation delay plus the round trip of the snapshot out and the swing back.
export const rewindMs = (rtt: number) => Math.min(REWIND_MAX_MS, INTERP_DELAY_MS + Math.max(0, rtt));

const segEnd = new THREE.Vector3();

export function pickPlayer(eye: THREE.Vector3, dir: THREE.Vector3, maxDist: number, list: Iterable<{ id: number; x: number; y: number; z: number; f?: number }>) {
  segEnd.copy(dir).multiplyScalar(maxDist);
  let best: { id: number; dist: number } | null = null;
  for (const p of list) {
    if ((p.f ?? 0) & F.dead) continue;
    const h = (p.f ?? 0) & F.sneak ? 1.5 : 1.8;
    const t = segmentBox(eye.x, eye.y, eye.z, segEnd.x, segEnd.y, segEnd.z, p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + h, p.z + 0.3);
    if (t < 0) continue;
    const dist = t * maxDist;
    if (!best || dist < best.dist) best = { id: p.id, dist };
  }
  return best;
}

export function clientPvpHook(others: () => Iterable<{ id: number; x: number; y: number; z: number; f?: number }>, send: (m: ClientMsg) => void): PvpHook {
  return {
    pick: (eye, dir, max) => pickPlayer(eye, dir, max, others()),
    attack: (id, c) => send({ t: "pvp", id, s: c.s, crit: c.crit }),
    sweep: (box, s) => send({ t: "psweep", x: box.x, y: box.y, z: box.z, w: box.w, h: box.h, s }),
  };
}

export interface PvpRemote {
  num: number;
  name: string;
  dim: Dim;
  pos: THREE.Vector3;
  yaw: number;
  f: number;
  eq: Equip;
  inv: Inventory;
  hp: Health;
  proxy: PlayerApi;
}

export interface HostPvpDeps {
  g: GameInternals;
  hostName: string;
  remotes(): Iterable<PvpRemote>;
  ctxFor(d: Dim): GameCtx | null;
  send(r: PvpRemote, m: HostMsg): void;
  tick(): number;
  now?(): number; // ms clock for lag compensation, performance.now() by default
  rtt?(r: PvpRemote): number; // round trip to a remote in ms, -1 when unknown
  as?(r: PvpRemote, fn: () => void): void; // runs fn with the remote as ctx.player, so mobs it hurts credit it
  others(): Iterable<{ id: number; x: number; y: number; z: number; f?: number }>; // avatars the host player sees
}

interface HostFighter extends Fighter {
  player: PlayerApi;
  remote: PvpRemote | null;
}

function remoteHeld(r: PvpRemote): ItemStack | null {
  const name = r.eq.held;
  if (!name) return null;
  const sel = r.inv.held();
  if (sel?.item === name) return sel;
  for (let i = 0; i < 9; i++) if (r.inv.slots[i]?.item === name) return r.inv.slots[i];
  return null;
}

export function createHostPvp(d: HostPvpDeps) {
  const lastSwing = new Map<number, number>();
  const history = createPoseHistory();
  const now = () => d.now?.() ?? performance.now();
  const g = d.g;

  function hostFighter(): HostFighter {
    const p = g.player as unknown as PlayerState & PlayerApi;
    const f = (p.sneaking ? F.sneak : 0) | (p.sprinting ? F.sprint : 0) | (p.body.onGround ? F.ground : 0) | (p.dead ? F.dead : 0) | (p.flying ? F.fly : 0) | (p.body.inWater ? F.swim : 0);
    return { id: 0, name: d.hostName, dim: g.dim, pos: p.body.pos, yaw: p.yaw, f, gameMode: p.gameMode, dead: p.dead, held: g.inventory.held(), effect: (id) => p.hasEffect(id), player: p, remote: null };
  }

  function remoteFighter(r: PvpRemote): HostFighter {
    const level = (id: string) => {
      let claimed = 0;
      for (const [e, a] of r.hp.effects) if (e === id) claimed = a + 1;
      if (id !== "strength" && id !== "weakness") return claimed;
      // The client's effect list is only a claim: strength counts up to what the host granted, weakness at least that much.
      const g = r.hp.granted.get(id);
      const granted = g && r.hp.now <= g.until ? g.amp + 1 : 0;
      return id === "strength" ? Math.min(claimed, granted) : Math.max(claimed, granted);
    };
    const gm = r.proxy.gameMode;
    return { id: r.num, name: r.name, dim: r.dim, pos: r.pos, yaw: r.yaw, f: r.f, gameMode: gm, dead: r.hp.dead || (r.f & F.dead) !== 0, held: remoteHeld(r), effect: level, player: r.proxy, remote: r };
  }

  function fighter(id: number): HostFighter | null {
    if (id === 0) return hostFighter();
    for (const r of d.remotes()) if (r.num === id) return remoteFighter(r);
    return null;
  }

  function fighterOf(p: PlayerApi): HostFighter | null {
    if (p === (g.player as unknown)) return hostFighter();
    for (const r of d.remotes()) if (r.proxy === p) return remoteFighter(r);
    return null;
  }

  function all(): HostFighter[] {
    return [hostFighter(), ...[...d.remotes()].map(remoteFighter)];
  }

  // A stand-in attacker entity, so shields, death messages and hurt direction see who hit.
  function asEntity(a: Fighter): Entity {
    return { id: -1000 - a.id, type: PLAYER_TYPE + a.name, body: { pos: a.pos.clone(), vel: new THREE.Vector3(), width: 0.6, height: 1.8, onGround: true }, data: { held: a.held?.item }, dead: a.dead, effects: [], yaw: a.yaw, pitch: 0 } as unknown as Entity;
  }

  const health = (t: HostFighter) => (t.remote ? t.remote.hp.health : t.player.health);
  const invuln = (t: HostFighter) => (t.remote ? t.remote.hp.invulnerable : (t.player as unknown as PlayerState).invulnerable);

  // Deals the hit. True when it started fresh hurt frames, which is when vanilla knocks back.
  function strike(a: HostFighter, t: HostFighter, amount: number, source: DamageSource, from: { x: number; y: number; z: number }): boolean {
    const before = invuln(t);
    t.player.damageFrom = { x: from.x, y: from.y, z: from.z };
    reflecting(a, t, () => t.player.damage(amount, source, asEntity(a)));
    return before <= 10 && invuln(t) === 20;
  }

  // Thorns hurts the attacker through ctx.entities.damage by entity id, which the stand-in attacker does not have; route it to the attacking player.
  function reflecting(a: HostFighter, t: HostFighter, fn: () => void) {
    const ents = d.ctxFor(t.dim)?.entities;
    if (!ents) return fn();
    const id = asEntity(a).id;
    const orig = ents.damage;
    ents.damage = (eid, amount, source, by) => {
      if (eid !== id) return orig.call(ents, eid, amount, source, by);
      a.player.damageFrom = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
      a.player.damage(amount, source, asEntity(t));
    };
    try {
      fn();
    } finally {
      ents.damage = orig;
    }
  }

  function ignite(t: HostFighter, ticks: number) {
    if (t.remote) d.send(t.remote, { t: "fire", ticks });
    else {
      const p = t.player as unknown as PlayerState;
      p.fireTicks = Math.max(p.fireTicks ?? 0, ticks);
    }
  }

  // Vanilla Arrow.doPostHurtEffects: instant effects act at once, the rest are added.
  function effectOn(a: HostFighter, t: HostFighter, id: string, amp: number, ticks: number) {
    if (id === "instant_damage") t.player.damage(6 << amp, "magic", asEntity(a));
    else if (id === "instant_health") t.player.heal(4 << amp);
    else (t.player as unknown as { addEffect(id: string, amp: number, ticks: number): void }).addEffect(id, amp, ticks);
  }

  // Arrow data on the host comes from shot-guard.ts for remote shooters, so it is the shooter's real ammo.
  function arrowHit(a: HostFighter, t: HostFighter, arrow: Entity) {
    if (arrow.data.fire) ignite(t, 100);
    if (arrow.type === "spectral_arrow" || arrow.data.type === "spectral_arrow") effectOn(a, t, "glowing", 0, 200);
    const fx = Array.isArray(arrow.data.effects)
      ? (arrow.data.effects as { id: string; amplifier: number; ticks: number }[])
      : (POTIONS[String(arrow.data.potion ?? "")] ?? []).map(([id, sec, amp]) => ({ id, amplifier: amp, ticks: Math.max(1, Math.round((sec * 20) / 8)) }));
    for (const f of fx) if (typeof f.id === "string" && f.amplifier >= 0 && f.amplifier <= 255) effectOn(a, t, f.id, f.amplifier, Math.max(1, Math.min(f.ticks | 0, 20 * 60 * 8)));
  }

  // Mobs and armor stands in a sweep, judged on the host with its own entities. base: sweep damage before enchantment bonus and attack strength.
  function sweepMobs(a: HostFighter, box: SweepBox, s: number, base: number) {
    const ctx = d.ctxFor(a.dim);
    if (!ctx) return;
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const fire = ench(a.held, "fire_aspect");
    const run = () => {
      for (const o of ctx.entities.near?.(box.x, box.y, box.z, 4, []) ?? []) {
        if (o.dead || !(mobDef(o.type) || o.type === "armor_stand") || o.data.marker) continue;
        if (!inSweep(box, { x: o.body.pos.x, y: o.body.pos.y, z: o.body.pos.z, w: o.body.width, h: o.body.height }, a.pos)) continue;
        ctx.entities.knockback(o.id, fx, fz, 0.4);
        ctx.entities.damage(o.id, (base + enchantDamageBonus(a.held, o.type)) * s, "player", "player");
        if (fire > 0) o.data._fire = Math.max(Number(o.data._fire ?? 0), fire * 80);
      }
    };
    if (a.remote && d.as) d.as(a.remote, run);
    else run();
  }

  // Players in a sweep. skip: the one hit directly.
  function sweepPlayers(a: HostFighter, box: SweepBox, amount: number, skip?: number) {
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const fire = ench(a.held, "fire_aspect");
    for (const o of all()) {
      if (o.id === a.id || o.id === skip || o.dim !== a.dim || !vulnerable(o)) continue;
      if (!inSweep(box, { x: o.pos.x, y: o.pos.y, z: o.pos.z, w: 0.6, h: height(o) }, a.pos)) continue;
      const hp = health(o);
      const fresh = strike(a, o, amount, "player", a.pos);
      if (fresh) knock(o, fx, fz, 0.4);
      if (fresh || health(o) < hp) {
        hurtSound(o);
        if (fire > 0) ignite(o, fire * 80);
      }
    }
  }

  function knock(t: HostFighter, dx: number, dz: number, s: number) {
    if (t.remote) {
      const b = t.remote.proxy.body;
      b.onGround = (t.f & F.ground) !== 0;
      knockBody(b, dx, dz, s, playerKbResist({ inventory: t.remote.inv } as unknown as GameCtx));
    } else knockBody(t.player.body, dx, dz, s, playerKbResist(g.ctx));
  }

  const emit = (dim: Dim, e: GameEvent) => d.ctxFor(dim)?.emit(e);

  // The target's own game plays its hurt sound; everyone else hears it from here.
  function hurtSound(t: HostFighter) {
    const { x, y, z } = t.pos;
    const pitch = (Math.random() - Math.random()) * 0.2 + 1;
    if (t.remote && t.dim === g.dim) g.ctx.audio.play("entity.player.hurt", x, y, z, 1, pitch);
    for (const r of d.remotes()) {
      if (r === t.remote || r.dim !== t.dim) continue;
      const dx = r.pos.x - x, dz = r.pos.z - z;
      if (dx * dx + dz * dz < 48 * 48) d.send(r, { t: "sound", name: "entity.player.hurt", x, y, z, volume: 1, pitch });
    }
  }

  const sound = (a: Fighter, name: string) => emit(a.dim, { type: "sound", name, x: a.pos.x, y: a.pos.y, z: a.pos.z });

  function melee(attackerId: number, targetId: number, claim: MeleeClaim): string {
    const a = fighter(attackerId), t = fighter(targetId);
    if (!a || !t) return "missing";
    const tick = d.tick();
    const last = lastSwing.get(attackerId) ?? -1e9;
    lastSwing.set(attackerId, tick);
    const w = d.ctxFor(a.dim)?.world;
    if (!w) return "dim";
    const opts = { pvp: pvpOn(g.ctx.rules), tick, last, claim, ray: (o: THREE.Vector3, dir: THREE.Vector3, max: number) => w.raycast(o, dir, max, false) };
    let v = meleeVerdict(a, t, opts);
    // Out of reach or sight now, but maybe not where the attacker saw the target.
    if (!v.ok && (v.why === "reach" || v.why === "sight")) {
      const past = history.at(t.id, now() - rewindMs(a.remote ? (d.rtt?.(a.remote) ?? -1) : 0));
      if (past) {
        const then = meleeVerdict(a, { ...t, pos: new THREE.Vector3(past.x, past.y, past.z), f: past.f }, opts);
        if (then.ok) v = then;
      }
    }
    if (!v.ok) return v.why;
    if (v.sprint) sound(a, "entity.player.attack.knockback");
    const hp = health(t);
    const fresh = strike(a, t, v.total, "player", a.pos);
    if (!fresh && health(t) >= hp) {
      sound(a, "entity.player.attack.nodamage");
      return "nodamage";
    }
    hurtSound(t);
    const fire = ench(a.held, "fire_aspect");
    if (fire > 0) ignite(t, fire * 80);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if (fresh) {
      knock(t, t.pos.x - a.pos.x, t.pos.z - a.pos.z, 0.4);
      if (v.knock > 0) knock(t, fx, fz, v.knock * 0.5);
    }
    if (v.sweep > 0) {
      const box = { x: t.pos.x, y: t.pos.y, z: t.pos.z, w: 0.6, h: height(t) };
      sweepPlayers(a, box, v.sweep, t.id);
      sweepMobs(a, box, v.s, v.sweepBase);
      sound(a, "entity.player.attack.sweep");
      emit(a.dim, { type: "particles", kind: "sweep", x: a.pos.x + fx, y: a.pos.y + 0.9, z: a.pos.z + fz });
    }
    const snd = v.crit ? "entity.player.attack.crit" : v.sweep || v.sprint ? null : v.s > 0.9 ? "entity.player.attack.strong" : "entity.player.attack.weak";
    if (snd) sound(a, snd);
    if (v.crit) emit(a.dim, { type: "particles", kind: "crit", x: t.pos.x, y: t.pos.y + 0.9, z: t.pos.z, count: 12 });
    if (enchantDamageBonus(a.held, "player") > 0) emit(a.dim, { type: "particles", kind: "crit", x: t.pos.x, y: t.pos.y + 0.9, z: t.pos.z, count: 12, color: 0x8fd8ff });
    return "hit";
  }

  // The attacker's sword hit a mob: players beside the mob take the sweep. The host rechecks reach, sight, cooldown and the sweep rules.
  function sweepAround(attackerId: number, box: SweepBox, s: number): string {
    const a = fighter(attackerId);
    if (!a) return "missing";
    if (![box.x, box.y, box.z].every(Number.isFinite) || !(box.w > 0 && box.w <= 4) || !(box.h > 0 && box.h <= 4)) return "box";
    const tick = d.tick();
    const last = lastSwing.get(attackerId) ?? -1e9;
    lastSwing.set(attackerId, tick);
    const w = d.ctxFor(a.dim)?.world;
    if (!w) return "dim";
    const mob: Fighter = { id: -1, name: "", dim: a.dim, pos: new THREE.Vector3(box.x, box.y, box.z), yaw: 0, f: F.ground, gameMode: "survival", dead: false, held: null, effect: () => 0 };
    const ray = (o: THREE.Vector3, dir: THREE.Vector3, max: number) => w.raycast(o, dir, max, false);
    const v = meleeVerdict(a, mob, { pvp: pvpOn(g.ctx.rules), tick, last, claim: { s, crit: false }, ray });
    if (!v.ok) return v.why;
    if (!(v.sweep > 0)) return "nosweep";
    sweepPlayers(a, box, v.sweep);
    return "hit";
  }

  function hook(): PvpHook {
    return {
      pick: (eye, dir, max) => pickPlayer(eye, dir, max, d.others()),
      attack: (id, c) => void melee(0, id, c),
      sweep: (box, s) => void sweepAround(0, box, s),
      targets(ctx) {
        if (!pvpOn(g.ctx.rules)) return [];
        const shooter = fighterOf(ctx.player);
        if (!shooter) return [];
        return all().filter((o) => o.id !== shooter.id && o.dim === shooter.dim && vulnerable(o)).map((o) => o.player);
      },
      shot(ctx, target, amount, source, from, push, arrow) {
        const a = fighterOf(ctx.player), t = fighterOf(target);
        if (!a || !t || a.id === t.id || !pvpOn(g.ctx.rules)) return;
        const hp = health(t);
        // Projectile damage comes from client-spawned entity data; vanilla tops out near 25 for a Power V crit.
        const fresh = strike(a, t, Math.min(25, Math.max(0, amount)), source, from);
        if (arrow && (fresh || health(t) < hp)) arrowHit(a, t, arrow);
        if (!fresh) return;
        hurtSound(t);
        if (push) {
          const b = t.player.body;
          b.vel.x += push.x;
          b.vel.z += push.z;
          b.vel.y = Math.max(b.vel.y, 0.1);
        }
      },
    };
  }

  // Called once per host tick.
  function record() {
    const t = now();
    const live = new Set<number>();
    for (const f of all()) {
      history.record(f.id, t, f.pos, f.f);
      live.add(f.id);
    }
    history.keep(live);
  }

  return { melee, sweepAround, hook, fighter, record };
}
