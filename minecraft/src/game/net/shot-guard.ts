// Arrows and tridents a remote player fires. The client spawns them, so the host rebuilds their damage, crit
// and effects from its own copy of the shooter's inventory and refuses shots the shooter could not have made.
import type { ItemStack } from "../contracts";
import { POTIONS, EYE_SNEAK, EYE_STAND, ench } from "../player/stats";
import { arrowEffects, bowPower, crossbowCharge } from "../player/ranged";
import { F } from "./protocol";

export const SHOT_TYPES = new Set(["arrow", "spectral_arrow", "trident"]);

export const BOW_SPEED = 3;
export const CROSSBOW_SPEED = 3.15;
export const TRIDENT_SPEED = 2.5;
const TRIDENT_DRAW = 10;
const VOLLEY_MS = 40;
// Ticks of draw time a shot may arrive early by, for network jitter.
const DRAW_SLACK = 5;
// Distance the spawn point may sit from the eye the host last saw: the client moves a tick before it sends.
const ORIGIN_SLACK = 1;

const ARROW_ITEMS = ["arrow", "tipped_arrow", "spectral_arrow"];

export interface ShotState {
  at: number; // performance.now() of the last accepted volley
  n: number; // shots in that volley
}
export const newShotState = (): ShotState => ({ at: -1e9, n: 0 });

export interface Shooter {
  pos: { x: number; y: number; z: number };
  f: number; // protocol F bits
  speed: number; // horizontal blocks per second, recent peak
  eq: { held: string | null; off: string | null };
  invs: unknown[]; // the host's copies of the shooter's inventory, newest first
  creative: boolean; // creative mode or cheats: no ammo needed
  shot: ShotState;
}

export interface ShotClaim {
  type: string;
  x: number;
  y: number;
  z: number;
  vel: unknown;
  data: Record<string, unknown> | null | undefined;
}

export type ShotVerdict =
  | { ok: true; vel: [number, number, number]; data: Record<string, unknown> }
  | { ok: false; why: "type" | "weapon" | "ammo" | "origin" | "speed" | "rate" };

const isStack = (s: unknown): s is ItemStack => !!s && typeof s === "object" && typeof (s as ItemStack).item === "string" && (s as ItemStack).count > 0;

function slotsOf(save: unknown): unknown[] {
  if (save && typeof save === "object" && "slots" in save && Array.isArray((save as { slots: unknown }).slots)) return (save as { slots: unknown[] }).slots;
  return [];
}

// The weapon in a hand: the selected slot or off hand when they match what the client says it holds, else any hotbar slot.
function weaponIn(save: unknown, eq: Shooter["eq"], name: string): { stack: ItemStack; slot: number } | null {
  if (eq.held !== name && eq.off !== name) return null;
  const slots = slotsOf(save);
  const sel = Number((save as { selected?: unknown }).selected) | 0;
  const order = eq.held === name ? [sel, 40, 0, 1, 2, 3, 4, 5, 6, 7, 8] : [40];
  for (const i of order) {
    const s = slots[i];
    if (isStack(s) && s.item === name) return { stack: s, slot: i };
  }
  return null;
}

function findWeapon(sh: Shooter, names: string[]) {
  for (const save of sh.invs) for (const n of names) {
    const w = weaponIn(save, sh.eq, n);
    if (w) return w;
  }
  return null;
}

function ammo(sh: Shooter, ok: (s: ItemStack) => boolean): ItemStack | null {
  for (const save of sh.invs) for (const s of slotsOf(save)) if (isStack(s) && ok(s)) return s;
  return null;
}

function vec(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v.map(Number);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
}

// Launch speed plus what the shooter's own motion adds: horizontal from its recent speed, vertical only while airborne.
function fast(v: [number, number, number], launch: number, sh: Shooter): boolean {
  const air = (sh.f & F.ground) === 0;
  const h = launch + sh.speed / 20 + 0.2;
  if (Math.hypot(v[0], v[2]) > h) return true;
  return v[1] > launch + (air ? 1 : 0.2) || v[1] < -launch - (air ? 4 : 0.2);
}

// Draw time since the last volley, in ticks, with jitter slack. A second shot in the same volley needs multishot.
function drawn(sh: Shooter, now: number, volley: number): number | null {
  if (now - sh.shot.at < VOLLEY_MS) return sh.shot.n < volley ? Infinity : null;
  return (now - sh.shot.at) / 50 + DRAW_SLACK;
}

const potionOk = (p: unknown): p is string => typeof p === "string" && Object.hasOwn(POTIONS, p);

export function checkShot(sh: Shooter, c: ShotClaim, now: number): ShotVerdict {
  if (!SHOT_TYPES.has(c.type)) return { ok: false, why: "type" };
  const v = vec(c.vel);
  if (!v) return { ok: false, why: "speed" };
  const eye = sh.pos.y + (sh.f & F.sneak ? EYE_SNEAK : EYE_STAND) - 0.1;
  const slack = ORIGIN_SLACK + (sh.speed / 20) * 3;
  if (Math.hypot(c.x - sh.pos.x, c.y - eye, c.z - sh.pos.z) > slack + ((sh.f & F.ground) === 0 ? 1 : 0)) return { ok: false, why: "origin" };
  const d = c.data ?? {};

  if (c.type === "trident") {
    const w = findWeapon(sh, ["trident"]);
    if (!w || ench(w.stack, "riptide") > 0) return { ok: false, why: "weapon" };
    const t = drawn(sh, now, 1);
    if (t === null || t < TRIDENT_DRAW) return { ok: false, why: "rate" };
    if (fast(v, TRIDENT_SPEED, sh)) return { ok: false, why: "speed" };
    commit(sh, now);
    return { ok: true, vel: v, data: { owner: "player", item: { ...w.stack, count: 1 }, damage: 8, slot: w.slot, pickup: sh.creative ? 2 : 1 } };
  }

  const crossbow = d.fromCrossbow === true;
  const w = findWeapon(sh, [crossbow ? "crossbow" : "bow"]);
  if (!w) return { ok: false, why: "weapon" };
  const spectral = c.type === "spectral_arrow";
  const loaded = crossbow && w.stack.data?.charged === true ? w.stack.data : null;
  // A charged crossbow holds its own ammo; otherwise the shooter needs arrows of the right kind.
  const want = spectral ? ["spectral_arrow"] : ["arrow", "tipped_arrow"];
  const potion = potionOk(d.potion) ? d.potion : undefined;
  let item: string;
  if (loaded && (spectral ? loaded.projectile === "spectral_arrow" : loaded.projectile !== "spectral_arrow" && loaded.projectile !== "firework_rocket")) {
    item = String(loaded.projectile ?? "arrow");
  } else {
    const tipped = potion ? ammo(sh, (s) => s.item === "tipped_arrow" && s.data?.potion === potion) : null;
    const a = tipped ?? ammo(sh, (s) => want.includes(s.item) && s.item !== "tipped_arrow");
    if (a) item = a.item;
    else if (sh.creative) item = spectral ? "spectral_arrow" : potion ? "tipped_arrow" : "arrow";
    else return { ok: false, why: "ammo" };
  }
  if (!ARROW_ITEMS.includes(item)) item = "arrow";
  const tippedPotion = item === "tipped_arrow" && (loaded ? potionOk(loaded.potion) && loaded.potion === potion : true) ? potion : undefined;

  const multishot = crossbow && ench(w.stack, "multishot") > 0 ? 3 : 1;
  const t = drawn(sh, now, multishot);
  if (t === null) return { ok: false, why: "rate" };
  const fx = tippedPotion ? arrowEffects({ item: "tipped_arrow", count: 1, data: { potion: tippedPotion } }) : undefined;
  const base = { owner: "player", item, potion: tippedPotion, effects: fx };
  if (crossbow) {
    if (t < crossbowCharge(w.stack)) return { ok: false, why: "rate" };
    if (fast(v, CROSSBOW_SPEED, sh)) return { ok: false, why: "speed" };
    commit(sh, now);
    return { ok: true, vel: v, data: { ...base, damage: 2, crit: true, pierce: ench(w.stack, "piercing"), pickup: sh.creative || d.pickup === 2 ? 2 : 1, fromCrossbow: true } };
  }
  const f = bowPower(t);
  if (f < 0.1) return { ok: false, why: "rate" };
  if (fast(v, f * BOW_SPEED, sh)) return { ok: false, why: "speed" };
  commit(sh, now);
  const power = ench(w.stack, "power");
  const infinity = ench(w.stack, "infinity") > 0;
  return {
    ok: true, vel: v,
    data: {
      ...base,
      damage: 2 + (power > 0 ? power * 0.5 + 0.5 : 0),
      crit: d.crit === true && f >= 1,
      punch: ench(w.stack, "punch"),
      fire: ench(w.stack, "flame") > 0,
      pickup: sh.creative || (infinity && item === "arrow") ? 2 : 1,
    },
  };
}

function commit(sh: Shooter, now: number) {
  if (now - sh.shot.at < VOLLEY_MS) sh.shot.n++;
  else Object.assign(sh.shot, { at: now, n: 1 });
}
