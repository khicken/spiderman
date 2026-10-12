import type { BlockState, GameCtx, WorldApi } from "../contracts";
import { AIR, MAX_Y, SET_NOTIFY, idOf, stateOf } from "../contracts";
import { blockDef } from "../blocks/registry";
import { HX, HZ, idn, isAir, isReplaceable, nameOf, randInt, st, tag } from "./util";

interface Grow {
  ctx: GameCtx;
  w: WorldApi;
  log: BlockState;
  leaves: BlockState;
}

const canReplace = (s: BlockState) => isAir(s) || isReplaceable(s) || tag(s, "leaves") || tag(s, "saplings") || nameOf(s) === "vine" ||
  nameOf(s) === "mangrove_propagule" || tag(s, "fungi") || tag(s, "mushrooms");

function setLog(g: Grow, x: number, y: number, z: number, log = g.log) {
  if (y > MAX_Y) return;
  const cur = g.w.getBlock(x, y, z);
  if (canReplace(cur) || idOf(cur) === idOf(log)) g.w.setBlock(x, y, z, log, SET_NOTIFY);
}

function setLeaf(g: Grow, x: number, y: number, z: number, leaf = g.leaves) {
  if (y > MAX_Y) return;
  const cur = g.w.getBlock(x, y, z);
  if (isAir(cur) || (isReplaceable(cur) && blockDef(cur).shape !== "fluid")) g.w.setBlock(x, y, z, leaf, SET_NOTIFY);
}

function clearForTrunk(g: Grow, x: number, y: number, z: number, h: number, size: number): boolean {
  for (let dy = 0; dy <= h; dy++) {
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        if (y + dy > MAX_Y) return false;
        const s = g.w.getBlock(x + dx, y + dy, z + dz);
        if (dy === 0 && size > 1) continue;
        if (!canReplace(s)) return false;
      }
    }
  }
  return true;
}

function dirtBelow(g: Grow, x: number, y: number, z: number) {
  const b = g.w.getBlock(x, y - 1, z);
  const n = nameOf(b);
  if (n === "grass_block" || n === "mycelium" || n === "farmland" || n === "podzol" || n === "moss_block") g.w.setBlock(x, y - 1, z, st("dirt"), SET_NOTIFY);
}

// Vanilla blob foliage: radius 2 for two layers, radius 1 for the top two, random corners.
function blob(g: Grow, x: number, top: number, z: number, radius = 2, height = 4) {
  for (let yy = top - height + 1; yy <= top; yy++) {
    const dy = yy - top;
    const r = dy >= -1 ? radius - 1 : radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 0 || g.ctx.random() < 0.5)) continue;
        setLeaf(g, x + dx, yy, z + dz);
      }
    }
  }
}

function sphere(g: Grow, x: number, y: number, z: number, r: number) {
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const rr = dy === 0 ? r : r - 1;
        if (dx * dx + dz * dz <= rr * rr + 1) setLeaf(g, x + dx, y + dy, z + dz);
      }
    }
  }
}

function trunk(g: Grow, x: number, y: number, z: number, h: number, size = 1) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) setLog(g, x + dx, y + dy, z + dz);
}

function oak(g: Grow, x: number, y: number, z: number, fancy: boolean): boolean {
  const r = g.ctx;
  if (!fancy) {
    const h = 4 + randInt(r, 3);
    if (!clearForTrunk(g, x, y, z, h, 1)) return false;
    dirtBelow(g, x, y, z);
    trunk(g, x, y, z, h);
    blob(g, x, y + h, z);
    return true;
  }
  const h = 6 + randInt(r, 6);
  if (!clearForTrunk(g, x, y, z, h, 1)) return false;
  dirtBelow(g, x, y, z);
  trunk(g, x, y, z, h);
  sphere(g, x, y + h, z, 2);
  const branches = 2 + randInt(r, 3);
  for (let i = 0; i < branches; i++) {
    const h0 = Math.floor(h * 0.5) + randInt(r, Math.max(1, Math.floor(h * 0.4)));
    const d = randInt(r, 4);
    const len = 2 + randInt(r, 2);
    let bx = x, by = y + h0, bz = z;
    for (let j = 1; j <= len; j++) {
      bx += HX[d];
      bz += HZ[d];
      if (j % 2 === 0) by++;
      setLog(g, bx, by, bz, stateOf(idOf(g.log), d & 1 ? 1 : 2));
    }
    sphere(g, bx, by + 1, bz, 2);
  }
  return true;
}

function spruce(g: Grow, x: number, y: number, z: number): boolean {
  const h = 6 + randInt(g.ctx, 4);
  if (!clearForTrunk(g, x, y, z, h, 1)) return false;
  dirtBelow(g, x, y, z);
  trunk(g, x, y, z, h);
  setLeaf(g, x, y + h, z);
  const start = 1 + randInt(g.ctx, 2);
  let r = 0;
  let maxR = 1;
  for (let yy = y + h - 1; yy >= y + start; yy--) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (r > 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        setLeaf(g, x + dx, yy, z + dz);
      }
    }
    if (r >= maxR) {
      r = 1;
      maxR = Math.min(3, maxR + 1);
    } else r++;
  }
  return true;
}

function megaSpruce(g: Grow, x: number, y: number, z: number): boolean {
  const h = 13 + randInt(g.ctx, 12);
  if (!clearForTrunk(g, x, y, z, h, 2)) return false;
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) dirtBelow(g, x + dx, y, z + dz);
  trunk(g, x, y, z, h, 2);
  const cone = Math.floor(h * 0.6);
  for (let i = 0; i < cone; i++) {
    const yy = y + h - i;
    const r = Math.min(4, Math.floor(i / 2.5)) + (i % 3 === 0 ? 0 : 1);
    for (let dx = -r; dx <= r + 1; dx++) {
      for (let dz = -r; dz <= r + 1; dz++) {
        const cx = dx <= 0 ? -dx : dx - 1, cz = dz <= 0 ? -dz : dz - 1;
        if (cx * cx + cz * cz <= r * r) setLeaf(g, x + dx, yy, z + dz);
      }
    }
  }
  return true;
}

function jungle(g: Grow, x: number, y: number, z: number): boolean {
  const h = 4 + randInt(g.ctx, 8);
  if (!clearForTrunk(g, x, y, z, h, 1)) return false;
  dirtBelow(g, x, y, z);
  trunk(g, x, y, z, h);
  blob(g, x, y + h, z);
  const cocoa = idn("cocoa");
  if (cocoa >= 0 && h > 5) {
    for (let dy = 1; dy < h - 2; dy++) {
      for (let d = 0; d < 4; d++) {
        if (randInt(g.ctx, 4) !== 0) continue;
        const cx = x + HX[d], cz = z + HZ[d];
        if (isAir(g.w.getBlock(cx, y + dy, cz))) g.w.setBlock(cx, y + dy, cz, stateOf(cocoa, ((d + 2) & 3) | (randInt(g.ctx, 3) << 2)), SET_NOTIFY);
      }
    }
  }
  return true;
}

function megaJungle(g: Grow, x: number, y: number, z: number): boolean {
  const h = 10 + randInt(g.ctx, 20);
  if (!clearForTrunk(g, x, y, z, h, 2)) return false;
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) dirtBelow(g, x + dx, y, z + dz);
  trunk(g, x, y, z, h, 2);
  for (let i = 0; i < 3; i++) {
    const r = 4 - i;
    for (let dx = -r; dx <= r + 1; dx++) for (let dz = -r; dz <= r + 1; dz++) {
      const cx = dx <= 0 ? -dx : dx - 1, cz = dz <= 0 ? -dz : dz - 1;
      if (cx * cx + cz * cz <= r * r) setLeaf(g, x + dx, y + h - 1 + i, z + dz);
    }
  }
  for (let by = y + h / 2; by < y + h - 2; by += 2 + randInt(g.ctx, 3)) {
    const d = randInt(g.ctx, 4);
    const bx = x + HX[d] * 3, bz = z + HZ[d] * 3;
    setLog(g, x + HX[d] * 2, Math.floor(by), z + HZ[d] * 2, stateOf(idOf(g.log), d & 1 ? 1 : 2));
    sphere(g, bx, Math.floor(by) + 1, bz, 2);
  }
  return true;
}

function darkOak(g: Grow, x: number, y: number, z: number): boolean {
  const h = 6 + randInt(g.ctx, 3);
  if (!clearForTrunk(g, x, y, z, h, 2)) return false;
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) dirtBelow(g, x + dx, y, z + dz);
  trunk(g, x, y, z, h, 2);
  for (let dy = -1; dy <= 1; dy++) {
    const r = dy === 1 ? 2 : 3;
    for (let dx = -r; dx <= r + 1; dx++) for (let dz = -r; dz <= r + 1; dz++) {
      const corner = (dx === -r || dx === r + 1) && (dz === -r || dz === r + 1);
      if (corner && (dy !== -1 || g.ctx.random() < 0.5)) continue;
      setLeaf(g, x + dx, y + h + dy, z + dz);
    }
  }
  return true;
}

function acacia(g: Grow, x: number, y: number, z: number): boolean {
  const h = 5 + randInt(g.ctx, 3);
  if (!clearForTrunk(g, x, y, z, h, 1)) return false;
  dirtBelow(g, x, y, z);
  const d = randInt(g.ctx, 4);
  const bend = h - randInt(g.ctx, 3) - 1;
  const lean = 1 + randInt(g.ctx, 3);
  let tx = x, tz = z;
  for (let dy = 0; dy < h; dy++) {
    if (dy >= bend && lean > dy - bend) {
      tx += HX[d];
      tz += HZ[d];
    }
    setLog(g, tx, y + dy, tz);
  }
  const top = y + h;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dz) < 4) setLeaf(g, tx + dx, top - 1, tz + dz);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) setLeaf(g, tx + dx, top, tz + dz);
  const d2 = (d + 1 + randInt(g.ctx, 3)) & 3;
  if (d2 !== d) {
    let bx = x, bz = z, by = y + bend - 1 - randInt(g.ctx, 2);
    for (let i = 0; i < 2 + randInt(g.ctx, 2); i++) {
      bx += HX[d2];
      bz += HZ[d2];
      by++;
      setLog(g, bx, by, bz);
    }
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dz) < 4) setLeaf(g, bx + dx, by + 1, bz + dz);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) setLeaf(g, bx + dx, by + 2, bz + dz);
  }
  return true;
}

function cherry(g: Grow, x: number, y: number, z: number): boolean {
  const h = 4 + randInt(g.ctx, 3);
  if (!clearForTrunk(g, x, y, z, h, 1)) return false;
  dirtBelow(g, x, y, z);
  trunk(g, x, y, z, h);
  const tops: [number, number, number][] = [[x, y + h, z]];
  const n = 1 + randInt(g.ctx, 2);
  for (let i = 0; i < n; i++) {
    const d = (randInt(g.ctx, 4) + i * 2) & 3;
    let bx = x, by = y + h - 2, bz = z;
    for (let j = 0; j < 3; j++) {
      bx += HX[d];
      bz += HZ[d];
      if (j > 0) by++;
      setLog(g, bx, by, bz, stateOf(idOf(g.log), d & 1 ? 1 : 2));
    }
    tops.push([bx, by + 1, bz]);
  }
  for (const [tx, ty, tz] of tops) {
    for (let dy = -1; dy <= 1; dy++) {
      const r = dy === 1 ? 2 : 3;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        setLeaf(g, tx + dx, ty + dy, tz + dz);
      }
    }
  }
  return true;
}

function mangrove(g: Grow, x: number, y: number, z: number): boolean {
  const h = 4 + randInt(g.ctx, 5);
  if (!clearForTrunk(g, x, y, z, h + 2, 1)) return false;
  const roots = st("mangrove_roots");
  const base = y + 2;
  for (let d = 0; d < 4; d++) {
    for (let j = 0; j <= 2; j++) {
      const rx = x + HX[d] * (j === 2 ? 2 : 1), rz = z + HZ[d] * (j === 2 ? 2 : 1);
      const ry = base - j;
      if (roots && canReplace(g.w.getBlock(rx, ry, rz))) g.w.setBlock(rx, ry, rz, roots, SET_NOTIFY);
    }
  }
  if (roots) for (let dy = 0; dy < 2; dy++) setLog(g, x, y + dy, z, roots);
  trunk(g, x, base, z, h);
  blob(g, x, base + h, z, 3, 4);
  return true;
}

function azalea(g: Grow, x: number, y: number, z: number): boolean {
  const h = 4 + randInt(g.ctx, 2);
  if (!clearForTrunk(g, x, y, z, h, 1)) return false;
  if (nameOf(g.w.getBlock(x, y - 1, z)) !== "clay") g.w.setBlock(x, y - 1, z, st("rooted_dirt"), SET_NOTIFY);
  const log = st("oak_log");
  let tx = x, tz = z;
  const d = randInt(g.ctx, 4);
  for (let dy = 0; dy < h; dy++) {
    if (dy === h - 2 && g.ctx.random() < 0.5) {
      tx += HX[d];
      tz += HZ[d];
    }
    setLog(g, tx, y + dy, tz, log);
  }
  const leaves = st("azalea_leaves");
  const flowering = st("flowering_azalea_leaves");
  for (let dy = -1; dy <= 1; dy++) {
    const r = dy === 1 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r && g.ctx.random() < 0.5) continue;
      setLeaf(g, tx + dx, y + h + dy, tz + dz, g.ctx.random() < 0.25 ? flowering : leaves);
    }
  }
  return true;
}

function hugeFungus(g: Grow, x: number, y: number, z: number, warped: boolean): boolean {
  const h = 4 + randInt(g.ctx, 9);
  if (!clearForTrunk(g, x, y, z, h + 1, 1)) return false;
  const stem = st(warped ? "warped_stem" : "crimson_stem");
  const wart = st(warped ? "warped_wart_block" : "nether_wart_block");
  const light = st("shroomlight");
  for (let dy = 0; dy < h; dy++) setLog(g, x, y + dy, z, stem);
  const capH = Math.min(h, 3 + randInt(g.ctx, 2));
  for (let i = 0; i <= capH; i++) {
    const yy = y + h - i;
    const r = i === 0 ? 1 : i < 2 ? 2 : 3;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const edge = Math.abs(dx) === r || Math.abs(dz) === r;
      if (i > 0 && !edge && i > 1) continue;
      if (Math.abs(dx) === r && Math.abs(dz) === r && g.ctx.random() < 0.6) continue;
      setLeaf(g, x + dx, yy, z + dz, g.ctx.random() < 0.08 ? light : wart);
    }
  }
  return true;
}

function hugeMushroom(g: Grow, x: number, y: number, z: number, red: boolean): boolean {
  const h = 4 + randInt(g.ctx, 3) * (randInt(g.ctx, 12) === 0 ? 2 : 1);
  if (!clearForTrunk(g, x, y, z, h + 1, 1)) return false;
  const stem = st("mushroom_stem");
  const cap = st(red ? "red_mushroom_block" : "brown_mushroom_block");
  for (let dy = 0; dy < h; dy++) setLog(g, x, y + dy, z, stem);
  if (red) {
    for (let dy = h - 3; dy < h; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      setLeaf(g, x + dx, y + dy, z + dz, cap);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) setLeaf(g, x + dx, y + h, z + dz, cap);
  } else {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      setLeaf(g, x + dx, y + h, z + dz, cap);
    }
  }
  return true;
}

const LOG_FOR: Record<string, string> = {
  oak_sapling: "oak", spruce_sapling: "spruce", birch_sapling: "birch", jungle_sapling: "jungle", acacia_sapling: "acacia",
  dark_oak_sapling: "dark_oak", cherry_sapling: "cherry", mangrove_propagule: "mangrove",
};

function find2x2(w: WorldApi, x: number, y: number, z: number, id: number): [number, number] | null {
  for (let ox = 0; ox >= -1; ox--) {
    for (let oz = 0; oz >= -1; oz--) {
      let ok = true;
      for (let dx = 0; dx < 2 && ok; dx++) for (let dz = 0; dz < 2 && ok; dz++) ok = idOf(w.getBlock(x + ox + dx, y, z + oz + dz)) === id;
      if (ok) return [x + ox, z + oz];
    }
  }
  return null;
}

export function growTree(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  const s = w.getBlock(x, y, z);
  const name = nameOf(s);
  if (name === "crimson_fungus" || name === "warped_fungus") {
    if (!nameOf(w.getBlock(x, y - 1, z)).endsWith("_nylium")) return false;
    w.setBlock(x, y, z, AIR, 0);
    const ok = hugeFungus({ ctx, w, log: AIR, leaves: AIR }, x, y, z, name === "warped_fungus");
    if (!ok) w.setBlock(x, y, z, s, 0);
    return ok;
  }
  if (name === "red_mushroom" || name === "brown_mushroom") {
    w.setBlock(x, y, z, AIR, 0);
    const ok = hugeMushroom({ ctx, w, log: AIR, leaves: AIR }, x, y, z, name === "red_mushroom");
    if (!ok) w.setBlock(x, y, z, s, 0);
    return ok;
  }
  if (name === "azalea" || name === "flowering_azalea") {
    w.setBlock(x, y, z, AIR, 0);
    const ok = azalea({ ctx, w, log: AIR, leaves: AIR }, x, y, z);
    if (!ok) w.setBlock(x, y, z, s, 0);
    return ok;
  }
  const wood = LOG_FOR[name];
  if (!wood) return false;
  const g: Grow = { ctx, w, log: st(`${wood}_log`), leaves: st(`${wood}_leaves`) };
  if (wood === "dark_oak" || wood === "spruce" || wood === "jungle") {
    const at = find2x2(w, x, y, z, idOf(s));
    if (at) {
      const [ax, az] = at;
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) w.setBlock(ax + dx, y, az + dz, AIR, 0);
      const ok = wood === "dark_oak" ? darkOak(g, ax, y, az) : wood === "spruce" ? megaSpruce(g, ax, y, az) : megaJungle(g, ax, y, az);
      if (!ok) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) w.setBlock(ax + dx, y, az + dz, s, 0);
      return ok;
    }
    if (wood === "dark_oak") return false;
  }
  w.setBlock(x, y, z, AIR, 0);
  let ok: boolean;
  switch (wood) {
    case "oak": ok = oak(g, x, y, z, randInt(ctx, 10) === 0); break;
    case "birch": {
      const h = 5 + randInt(ctx, 3);
      ok = clearForTrunk(g, x, y, z, h, 1);
      if (ok) {
        dirtBelow(g, x, y, z);
        trunk(g, x, y, z, h);
        blob(g, x, y + h, z);
      }
      break;
    }
    case "spruce": ok = spruce(g, x, y, z); break;
    case "jungle": ok = jungle(g, x, y, z); break;
    case "acacia": ok = acacia(g, x, y, z); break;
    case "cherry": ok = cherry(g, x, y, z); break;
    case "mangrove": ok = mangrove(g, x, y, z); break;
    default: ok = false;
  }
  if (!ok) w.setBlock(x, y, z, s, 0);
  return ok;
}
