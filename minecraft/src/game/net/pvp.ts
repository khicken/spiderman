import * as THREE from "three";
import type { DamageSource, Dim, Entity, GameCtx, GameEvent, GameMode, ItemStack, PlayerApi, Rules } from "../contracts";
import { knockBody, playerKbResist } from "../entities/combat";
import { segmentBox } from "../entities/geom";
import type { PlayerState } from "../player/state";
import { CREATIVE_ENTITY_BONUS, ENTITY_REACH, EYE_SNEAK, EYE_STAND, attackStats, attackStrength, ench, enchantDamageBonus, toolOf } from "../player/stats";
import type { Health } from "./host-health";
import type { GameInternals, Inventory } from "./index";
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
  | { ok: true; s: number; total: number; crit: boolean; sprint: boolean; sweep: number; knock: number };

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
  const sweep = charged && !crit && !sprint && (a.f & F.ground) !== 0 && sword ? (1 + dmg * (ratio / (ratio + 1)) + enchantDamageBonus(held, "player")) * s : 0;
  return { ok: true, s, total: dmg + bonus, crit, sprint, sweep, knock: ench(held, "knockback") + (sprint ? 1 : 0) };
}

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
  const g = d.g;

  function hostFighter(): HostFighter {
    const p = g.player as unknown as PlayerState & PlayerApi;
    const f = (p.sneaking ? F.sneak : 0) | (p.sprinting ? F.sprint : 0) | (p.body.onGround ? F.ground : 0) | (p.dead ? F.dead : 0) | (p.flying ? F.fly : 0) | (p.body.inWater ? F.swim : 0);
    return { id: 0, name: d.hostName, dim: g.dim, pos: p.body.pos, yaw: p.yaw, f, gameMode: p.gameMode, dead: p.dead, held: g.inventory.held(), effect: (id) => p.hasEffect(id), player: p, remote: null };
  }

  function remoteFighter(r: PvpRemote): HostFighter {
    const level = (id: string) => {
      for (const [e, a] of r.hp.effects) if (e === id) return a + 1;
      return 0;
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
    t.player.damage(amount, source, asEntity(a));
    return before <= 10 && invuln(t) === 20;
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
    const v = meleeVerdict(a, t, { pvp: pvpOn(g.ctx.rules), tick, last, claim, ray: (o, dir, max) => w.raycast(o, dir, max, false) });
    if (!v.ok) return v.why;
    if (v.sprint) sound(a, "entity.player.attack.knockback");
    const hp = health(t);
    const fresh = strike(a, t, v.total, "player", a.pos);
    if (!fresh && health(t) >= hp) {
      sound(a, "entity.player.attack.nodamage");
      return "nodamage";
    }
    hurtSound(t);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if (fresh) {
      knock(t, t.pos.x - a.pos.x, t.pos.z - a.pos.z, 0.4);
      if (v.knock > 0) knock(t, fx, fz, v.knock * 0.5);
    }
    if (v.sweep > 0) {
      for (const o of all()) {
        if (o.id === a.id || o.id === t.id || o.dim !== a.dim || !vulnerable(o)) continue;
        const near = Math.abs(o.pos.x - t.pos.x) <= 1.6 && Math.abs(o.pos.z - t.pos.z) <= 1.6 && o.pos.y < t.pos.y + 2.05 && o.pos.y + 1.8 > t.pos.y - 0.25;
        if (!near || o.pos.distanceToSquared(a.pos) >= 9) continue;
        if (strike(a, o, v.sweep, "player", a.pos)) knock(o, fx, fz, 0.4);
        hurtSound(o);
      }
      sound(a, "entity.player.attack.sweep");
      emit(a.dim, { type: "particles", kind: "sweep", x: a.pos.x + fx, y: a.pos.y + 0.9, z: a.pos.z + fz });
    }
    const snd = v.crit ? "entity.player.attack.crit" : v.sweep || v.sprint ? null : v.s > 0.9 ? "entity.player.attack.strong" : "entity.player.attack.weak";
    if (snd) sound(a, snd);
    if (v.crit) emit(a.dim, { type: "particles", kind: "crit", x: t.pos.x, y: t.pos.y + 0.9, z: t.pos.z, count: 12 });
    if (enchantDamageBonus(a.held, "player") > 0) emit(a.dim, { type: "particles", kind: "crit", x: t.pos.x, y: t.pos.y + 0.9, z: t.pos.z, count: 12, color: 0x8fd8ff });
    return "hit";
  }

  function hook(): PvpHook {
    return {
      pick: (eye, dir, max) => pickPlayer(eye, dir, max, d.others()),
      attack: (id, c) => void melee(0, id, c),
      targets(ctx) {
        if (!pvpOn(g.ctx.rules)) return [];
        const shooter = fighterOf(ctx.player);
        if (!shooter) return [];
        return all().filter((o) => o.id !== shooter.id && o.dim === shooter.dim && vulnerable(o)).map((o) => o.player);
      },
      shot(ctx, target, amount, source, from, push) {
        const a = fighterOf(ctx.player), t = fighterOf(target);
        if (!a || !t || a.id === t.id || !pvpOn(g.ctx.rules)) return;
        // Projectile damage comes from client-spawned entity data; vanilla tops out near 25 for a Power V crit.
        const fresh = strike(a, t, Math.min(25, Math.max(0, amount)), source, from);
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

  return { melee, hook, fighter };
}
