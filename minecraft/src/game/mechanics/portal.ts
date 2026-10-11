import type { BlockBehavior, BlockState, GameCtx, WorldApi } from "../contracts";
import { AIR, SET_NOTIFY, idOf, metaOf, stateOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import { idn, isPlayerBody, sound, st } from "./util";

const OBSIDIAN = idn("obsidian");
const PORTAL = idn("nether_portal");
const FIRE = idn("fire");
const SOUL_FIRE = idn("soul_fire");
const END_PORTAL = idn("end_portal");
const FRAME = idn("end_portal_frame");

const isEmpty = (s: BlockState) => {
  const id = idOf(s);
  return id === 0 || id === FIRE || id === SOUL_FIRE || id === PORTAL || blockDef(s).shape === "air";
};
const isFrame = (s: BlockState) => idOf(s) === OBSIDIAN;

export interface PortalShape { x: number; y: number; z: number; axis: 1 | 2; width: number; height: number }

function findShape(w: WorldApi, x: number, y: number, z: number, axis: 1 | 2): PortalShape | null {
  const dx = axis === 1 ? 1 : 0, dz = axis === 1 ? 0 : 1;
  if (!isEmpty(w.getBlock(x, y, z))) return null;
  let by = y;
  for (let i = 0; i < 21 && isEmpty(w.getBlock(x, by - 1, z)); i++) by--;
  if (!isFrame(w.getBlock(x, by - 1, z))) return null;
  let left = 0;
  while (left <= 21 && isEmpty(w.getBlock(x - dx * (left + 1), by, z - dz * (left + 1)))) left++;
  if (left > 21 || !isFrame(w.getBlock(x - dx * (left + 1), by, z - dz * (left + 1)))) return null;
  const sx = x - dx * left, sz = z - dz * left;
  let width = 0;
  while (width <= 21) {
    const cx = sx + dx * width, cz = sz + dz * width;
    if (!isEmpty(w.getBlock(cx, by, cz))) break;
    if (!isFrame(w.getBlock(cx, by - 1, cz))) return null;
    width++;
  }
  if (width < 2 || width > 21 || !isFrame(w.getBlock(sx + dx * width, by, sz + dz * width))) return null;
  let height = 0;
  outer: for (; height < 21; height++) {
    const yy = by + height;
    for (let i = 0; i < width; i++) if (!isEmpty(w.getBlock(sx + dx * i, yy, sz + dz * i))) break outer;
    if (!isFrame(w.getBlock(sx - dx, yy, sz - dz)) || !isFrame(w.getBlock(sx + dx * width, yy, sz + dz * width))) return null;
  }
  if (height < 3) return null;
  for (let i = 0; i < width; i++) if (!isFrame(w.getBlock(sx + dx * i, by + height, sz + dz * i))) return null;
  return { x: sx, y: by, z: sz, axis, width, height };
}

export function findPortal(w: WorldApi, x: number, y: number, z: number): PortalShape | null {
  return findShape(w, x, y, z, 1) ?? findShape(w, x, y, z, 2);
}

export function lightPortal(ctx: GameCtx, x: number, y: number, z: number): boolean {
  if (ctx.world.dim === "end" || PORTAL < 0) return false;
  const p = findPortal(ctx.world, x, y, z);
  if (!p) return false;
  const dx = p.axis === 1 ? 1 : 0, dz = p.axis === 1 ? 0 : 1;
  const s = stateOf(PORTAL, p.axis);
  for (let h = 0; h < p.height; h++) {
    for (let i = 0; i < p.width; i++) ctx.world.setBlock(p.x + dx * i, p.y + h, p.z + dz * i, s, 0);
  }
  sound(ctx, "block.portal.trigger", x, y, z, 0.6, 1);
  return true;
}

const keepsPortal = (s: BlockState) => idOf(s) === PORTAL || idOf(s) === OBSIDIAN;

let portalTicks = 0;
let lastInside = -10;
let cooldown = false;

export const NETHER_PORTAL_BEHAVIOR: BlockBehavior = {
  neighborChanged(ctx, x, y, z, s) {
    const w = ctx.world;
    const axis = metaOf(s) === 2 ? 2 : 1;
    const dx = axis === 1 ? 1 : 0, dz = axis === 1 ? 0 : 1;
    const ok = keepsPortal(w.getBlock(x, y + 1, z)) && keepsPortal(w.getBlock(x, y - 1, z)) &&
      keepsPortal(w.getBlock(x + dx, y, z + dz)) && keepsPortal(w.getBlock(x - dx, y, z - dz));
    if (!ok) w.setBlock(x, y, z, AIR, SET_NOTIFY);
  },
  randomTick(ctx, x, y, z) {
    if (ctx.world.dim === "overworld" && ctx.random() < 0.0005) sound(ctx, "block.portal.ambient", x, y, z, 0.5, ctx.random() * 0.4 + 0.8);
    if (ctx.world.dim === "overworld" && ctx.rules.doMobSpawning && ctx.rules.difficulty !== "peaceful" && ctx.random() < 0.001) {
      let by = y;
      while (by > y - 32 && idOf(ctx.world.getBlock(x, by - 1, z)) === PORTAL) by--;
      ctx.entities.spawn("zombified_piglin", x + 0.5, by, z + 0.5);
    }
  },
  entityInside(ctx, x, y, z, _s, body, entity) {
    if (entity || !isPlayerBody(ctx, body)) return;
    const t = ctx.time.tick;
    if (t - lastInside > 1) {
      portalTicks = 0;
      if (t - lastInside > 20) cooldown = false;
    }
    lastInside = t;
    if (cooldown) return;
    portalTicks++;
    if (portalTicks === 1) sound(ctx, "block.portal.trigger", x, y, z, 0.25, 1);
    const need = ctx.player.gameMode === "creative" ? 1 : 80;
    if (portalTicks < need) return;
    portalTicks = 0;
    cooldown = true;
    const p = body.pos;
    if (ctx.world.dim === "nether") ctx.emit({ type: "change_dim", dim: "overworld", x: p.x * 8, y: p.y, z: p.z * 8 });
    else if (ctx.world.dim === "overworld") ctx.emit({ type: "change_dim", dim: "nether", x: p.x / 8, y: p.y, z: p.z / 8 });
  },
};

export const END_PORTAL_BEHAVIOR: BlockBehavior = {
  entityInside(ctx, _x, _y, _z, _s, body, entity) {
    if (entity || !isPlayerBody(ctx, body)) return;
    const t = ctx.time.tick;
    const fresh = t - lastInside > 1;
    lastInside = t;
    if (!fresh && cooldown) return;
    cooldown = true;
    if (ctx.world.dim === "end") {
      const sp = ctx.player.spawn;
      ctx.emit({ type: "change_dim", dim: "overworld", x: sp.x, y: sp.y, z: sp.z });
    } else ctx.emit({ type: "change_dim", dim: "end", x: 100.5, y: 49, z: 0.5 });
  },
};

export function insertEye(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  if (metaOf(s) & 4) return false;
  ctx.world.setBlock(x, y, z, stateOf(FRAME, metaOf(s) | 4), SET_NOTIFY);
  sound(ctx, "block.end_portal_frame.fill", x, y, z);
  completeEndPortal(ctx, x, y, z);
  return true;
}

const hasEye = (w: WorldApi, x: number, y: number, z: number) => {
  const s = w.getBlock(x, y, z);
  return idOf(s) === FRAME && (metaOf(s) & 4) !== 0;
};

function ringComplete(w: WorldApi, cx: number, y: number, cz: number): boolean {
  for (let i = -1; i <= 1; i++) {
    if (!hasEye(w, cx + i, y, cz - 2) || !hasEye(w, cx + i, y, cz + 2)) return false;
    if (!hasEye(w, cx - 2, y, cz + i) || !hasEye(w, cx + 2, y, cz + i)) return false;
  }
  return true;
}

function completeEndPortal(ctx: GameCtx, x: number, y: number, z: number) {
  const w = ctx.world;
  for (let i = -1; i <= 1; i++) {
    for (const [cx, cz] of [[x - i, z + 2], [x - i, z - 2], [x + 2, z - i], [x - 2, z - i]]) {
      if (!ringComplete(w, cx, y, cz)) continue;
      const portal = st("end_portal");
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) w.setBlock(cx + a, y, cz + b, portal, SET_NOTIFY);
      ctx.emit({ type: "sound", name: "block.end_portal.spawn", x: cx + 0.5, y: y + 0.5, z: cz + 0.5, volume: 1 });
      return;
    }
  }
}

export const isEndPortal = (s: BlockState) => idOf(s) === END_PORTAL;
