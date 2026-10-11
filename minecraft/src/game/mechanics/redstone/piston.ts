import { AIR, Face, idOf, MAX_Y, metaOf, MIN_Y, SET_NO_DROP, stateOf, type BlockBehavior, type BlockState, type GameCtx } from "../../contracts";
import { BLOCKS, blockDef, IS_FLUID } from "../../blocks/registry";
import { computeDrops } from "../../items/drops";
import { SIZE, containerType } from "./inventory";
import { observerMoved } from "./observer";
import { signalInto } from "./power";
import { breakBlock, DX, DY, DZ, hold, id, inWorld, isAir, lookNearest, nameOf, notifyNeighbors, OPP, posKey, sound } from "./util";

export const PUSH_LIMIT = 12;
const PISTON = id("piston");
const STICKY = id("sticky_piston");
const HEAD = id("piston_head");
const STICKY_HEAD = id("sticky_piston_head");
const SLIME = id("slime_block");
const HONEY = id("honey_block");
const OBSERVER = id("observer");

// Meta bits 0-2: the Face the head points to. Bit 3: extended. Heads use bits 0-2 only.
const facing = (s: BlockState) => (metaOf(s) & 7) as Face;
const extended = (s: BlockState) => (metaOf(s) & 8) !== 0;
const isBase = (s: BlockState) => idOf(s) === PISTON || idOf(s) === STICKY;
const isHead = (s: BlockState) => idOf(s) === HEAD || idOf(s) === STICKY_HEAD;

const enum Reaction { Normal, Destroy, Block, PushOnly }

const BLOCK_NAMES = new Set(["obsidian", "crying_obsidian", "respawn_anchor", "reinforced_deepslate", "barrier", "light", "grindstone",
  "enchanting_table", "end_portal", "end_gateway", "nether_portal", "piston_head", "sticky_piston_head", "moving_piston", "jigsaw",
  "structure_block", "command_block", "chain_command_block", "repeating_command_block", "structure_void"]);
const DESTROY_SHAPES = new Set(["door", "bed", "cactus", "cake", "sign", "lantern", "flower_pot", "campfire", "carpet", "vine", "ladder", "snow_layer"]);
const DESTROY_NAMES = new Set(["dragon_egg", "bamboo", "pointed_dripstone", "cocoa", "sea_pickle", "turtle_egg", "sniffer_egg", "big_dripleaf",
  "big_dripleaf_stem", "small_dripleaf", "chorus_plant", "chorus_flower", "conduit", "bell", "scaffolding", "frogspawn", "decorated_pot"]);
const BE_NAMES = new Set(["ender_chest", "beacon", "jukebox", "lectern", "spawner", "beehive", "bee_nest", "daylight_detector",
  "inverted_daylight_detector", "sculk_sensor", "calibrated_sculk_sensor", "sculk_shrieker", "sculk_catalyst", "trial_spawner", "vault",
  "chiseled_bookshelf", "enchanting_table", "brewing_stand", "comparator", "powered_comparator"]);

const REACTION = new Uint8Array(4096);
for (const b of BLOCKS) {
  let r = Reaction.Normal;
  if (BLOCK_NAMES.has(b.name)) r = Reaction.Block;
  else if (b.tags?.includes("glazed_terracotta")) r = Reaction.PushOnly;
  else if (DESTROY_NAMES.has(b.name) || DESTROY_SHAPES.has(b.shape) || b.name.includes("banner") || b.tags?.includes("skulls") || b.name.includes("candle")) r = Reaction.Destroy;
  else if (!b.solid && b.shape !== "rail" && b.shape !== "air") r = Reaction.Destroy;
  else if (b.replaceable || IS_FLUID[b.id]) r = Reaction.Destroy;
  REACTION[b.id] = r;
}

function hasBlockEntity(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const name = nameOf(s);
  if (name === "note_block") return false;
  if (SIZE[containerType(name)] || BE_NAMES.has(name) || name.endsWith("shulker_box") || name.endsWith("_sign")) return true;
  return ctx.world.getBlockEntity(x, y, z) !== undefined;
}

export function isPushable(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, dir: Face, allowDestroy: boolean, pistonFacing: Face): boolean {
  if (!inWorld(y)) return false;
  if (isAir(s)) return true;
  const name = nameOf(s);
  if (name === "obsidian" || name === "crying_obsidian" || name === "respawn_anchor" || name === "reinforced_deepslate") return false;
  if ((dir === Face.Down && y === MIN_Y) || (dir === Face.Up && y === MAX_Y)) return false;
  if (!isBase(s)) {
    if (blockDef(s).hardness < 0) return false;
    switch (REACTION[idOf(s)]) {
      case Reaction.Block:
        return false;
      case Reaction.Destroy:
        return allowDestroy;
      case Reaction.PushOnly:
        return dir === pistonFacing;
    }
  } else if (extended(s)) return false;
  return !hasBlockEntity(ctx, x, y, z, s);
}

const isSticky = (s: BlockState) => idOf(s) === SLIME || idOf(s) === HONEY;
function sticksTo(a: BlockState, b: BlockState): boolean {
  if ((idOf(a) === HONEY && idOf(b) === SLIME) || (idOf(a) === SLIME && idOf(b) === HONEY)) return false;
  return isSticky(a) || isSticky(b);
}

class Resolver {
  push: number[] = [];
  destroy: number[] = [];
  private set = new Set<string>();
  constructor(private ctx: GameCtx, private px: number, private py: number, private pz: number, private pistonFacing: Face, private dir: Face, private extending: boolean) {}

  private get(x: number, y: number, z: number) {
    return this.ctx.world.getBlock(x, y, z);
  }
  private isPiston(x: number, y: number, z: number) {
    return x === this.px && y === this.py && z === this.pz;
  }
  private indexOf(x: number, y: number, z: number) {
    if (!this.set.has(posKey(x, y, z))) return -1;
    for (let i = 0; i < this.push.length; i += 3) if (this.push[i] === x && this.push[i + 1] === y && this.push[i + 2] === z) return i / 3;
    return -1;
  }
  private count() {
    return this.push.length / 3;
  }

  resolve(): boolean {
    const d = this.pistonFacing;
    const sx = this.px + DX[d] * (this.extending ? 1 : 2);
    const sy = this.py + DY[d] * (this.extending ? 1 : 2);
    const sz = this.pz + DZ[d] * (this.extending ? 1 : 2);
    const s = this.get(sx, sy, sz);
    if (!isPushable(this.ctx, sx, sy, sz, s, this.dir, false, this.pistonFacing)) {
      if (this.extending && REACTION[idOf(s)] === Reaction.Destroy && inWorld(sy)) {
        this.destroy.push(sx, sy, sz);
        return true;
      }
      return false;
    }
    if (!this.addLine(sx, sy, sz, this.dir)) return false;
    for (let i = 0; i < this.push.length; i += 3) {
      const x = this.push[i], y = this.push[i + 1], z = this.push[i + 2];
      if (isSticky(this.get(x, y, z)) && !this.addBranches(x, y, z)) return false;
    }
    return true;
  }

  private addLine(x: number, y: number, z: number, dir: Face): boolean {
    let s = this.get(x, y, z);
    if (isAir(s)) return true;
    if (!isPushable(this.ctx, x, y, z, s, this.dir, false, dir)) return true;
    if (this.isPiston(x, y, z) || this.indexOf(x, y, z) >= 0) return true;
    let i = 1;
    if (i + this.count() > PUSH_LIMIT) return false;
    const back = OPP[this.dir];
    while (isSticky(s)) {
      const bx = x + DX[back] * i, by = y + DY[back] * i, bz = z + DZ[back] * i;
      const b = this.get(bx, by, bz);
      if (isAir(b) || !sticksTo(s, b) || !isPushable(this.ctx, bx, by, bz, b, this.dir, false, dir) || this.isPiston(bx, by, bz)) break;
      s = b;
      i++;
      if (i + this.count() > PUSH_LIMIT) return false;
    }
    let added = 0;
    for (let k = i - 1; k >= 0; k--) {
      this.add(x + DX[back] * k, y + DY[back] * k, z + DZ[back] * k);
      added++;
    }
    for (let l = 1; ; l++) {
      const nx = x + DX[this.dir] * l, ny = y + DY[this.dir] * l, nz = z + DZ[this.dir] * l;
      const hit = this.indexOf(nx, ny, nz);
      if (hit >= 0) {
        this.reorder(added, hit);
        for (let m = 0; m <= hit + added; m++) {
          const px = this.push[m * 3], py = this.push[m * 3 + 1], pz = this.push[m * 3 + 2];
          if (isSticky(this.get(px, py, pz)) && !this.addBranches(px, py, pz)) return false;
        }
        return true;
      }
      const n = this.get(nx, ny, nz);
      if (isAir(n)) return true;
      if (!isPushable(this.ctx, nx, ny, nz, n, this.dir, true, this.dir) || this.isPiston(nx, ny, nz)) return false;
      if (REACTION[idOf(n)] === Reaction.Destroy) {
        this.destroy.push(nx, ny, nz);
        return true;
      }
      if (this.count() >= PUSH_LIMIT) return false;
      this.add(nx, ny, nz);
      added++;
    }
  }

  private add(x: number, y: number, z: number) {
    this.push.push(x, y, z);
    this.set.add(posKey(x, y, z));
  }

  private reorder(added: number, hit: number) {
    const p = this.push;
    const n = p.length / 3;
    const a = p.slice(0, hit * 3);
    const b = p.slice((n - added) * 3);
    const c = p.slice(hit * 3, (n - added) * 3);
    this.push = [...a, ...b, ...c];
  }

  private addBranches(x: number, y: number, z: number): boolean {
    const s = this.get(x, y, z);
    for (let f = 0; f < 6; f++) {
      if (f === this.dir || f === OPP[this.dir]) continue;
      const nx = x + DX[f], ny = y + DY[f], nz = z + DZ[f];
      if (sticksTo(this.get(nx, ny, nz), s) && !this.addLine(nx, ny, nz, f as Face)) return false;
    }
    return true;
  }
}

function moveBlocks(ctx: GameCtx, x: number, y: number, z: number, f: Face, extending: boolean, sticky: boolean): boolean {
  const dir = (extending ? f : OPP[f]) as Face;
  const r = new Resolver(ctx, x, y, z, f, dir, extending);
  if (!r.resolve()) return false;
  const w = ctx.world;
  const touched: number[] = [];
  hold(ctx, () => {
    const states: BlockState[] = [];
    for (let i = 0; i < r.push.length; i += 3) states.push(w.getBlock(r.push[i], r.push[i + 1], r.push[i + 2]));
    const bes = [];
    for (let i = 0; i < r.push.length; i += 3) bes.push(w.getBlockEntity(r.push[i], r.push[i + 1], r.push[i + 2]));
    for (let i = r.destroy.length - 3; i >= 0; i -= 3) {
      const dx = r.destroy[i], dy = r.destroy[i + 1], dz = r.destroy[i + 2];
      const s = w.getBlock(dx, dy, dz);
      breakBlock(ctx, dx, dy, dz, !IS_FLUID[idOf(s)] && !blockDef(s).replaceable);
      touched.push(dx, dy, dz);
    }
    for (let i = r.push.length - 3; i >= 0; i -= 3) {
      w.setBlock(r.push[i], r.push[i + 1], r.push[i + 2], AIR, SET_NO_DROP);
      touched.push(r.push[i], r.push[i + 1], r.push[i + 2]);
    }
    for (let i = r.push.length - 3; i >= 0; i -= 3) {
      const nx = r.push[i] + DX[dir], ny = r.push[i + 1] + DY[dir], nz = r.push[i + 2] + DZ[dir];
      const s = states[i / 3];
      w.setBlock(nx, ny, nz, s, SET_NO_DROP);
      const be = bes[i / 3];
      if (be) w.setBlockEntity({ ...be, x: nx, y: ny, z: nz }, nx, ny, nz);
      touched.push(nx, ny, nz);
      if (idOf(s) === OBSERVER) observerMoved(ctx, nx, ny, nz, s);
    }
    if (extending) {
      const hx = x + DX[f], hy = y + DY[f], hz = z + DZ[f];
      w.setBlock(hx, hy, hz, stateOf(sticky ? STICKY_HEAD : HEAD, f), SET_NO_DROP);
      w.setBlock(x, y, z, stateOf(sticky ? STICKY : PISTON, f | 8), SET_NO_DROP);
      touched.push(hx, hy, hz, x, y, z);
    }
    const seen = new Set<string>();
    for (let i = 0; i < touched.length; i += 3) {
      const k = posKey(touched[i], touched[i + 1], touched[i + 2]);
      if (seen.has(k)) continue;
      seen.add(k);
      notifyNeighbors(ctx, touched[i], touched[i + 1], touched[i + 2]);
    }
  });
  return true;
}

function shouldExtend(ctx: GameCtx, x: number, y: number, z: number, f: Face): boolean {
  for (let d = 0; d < 6; d++) if (d !== f && signalInto(ctx, x, y, z, d as Face) > 0) return true;
  for (let d = 0; d < 6; d++) if (d !== Face.Down && signalInto(ctx, x, y + 1, z, d as Face) > 0) return true;
  return false;
}

function checkPiston(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const f = facing(s);
  const want = shouldExtend(ctx, x, y, z, f);
  const sticky = idOf(s) === STICKY;
  if (want && !extended(s)) {
    if (!moveBlocks(ctx, x, y, z, f, true, sticky)) return;
    sound(ctx, "block.piston.extend", x, y, z, 0.5, ctx.random() * 0.25 + 0.6);
  } else if (!want && extended(s)) {
    ctx.world.setBlock(x, y, z, stateOf(idOf(s), f), SET_NO_DROP);
    const hx = x + DX[f], hy = y + DY[f], hz = z + DZ[f];
    if (isHead(ctx.world.getBlock(hx, hy, hz))) ctx.world.setBlock(hx, hy, hz, AIR, SET_NO_DROP);
    if (sticky) {
      const bx = x + DX[f] * 2, by = y + DY[f] * 2, bz = z + DZ[f] * 2;
      const b = ctx.world.getBlock(bx, by, bz);
      if (!isAir(b) && isPushable(ctx, bx, by, bz, b, OPP[f] as Face, false, f) && (REACTION[idOf(b)] === Reaction.Normal || isBase(b))) {
        moveBlocks(ctx, x, y, z, f, false, true);
      }
    }
    notifyNeighbors(ctx, x, y, z);
    notifyNeighbors(ctx, hx, hy, hz);
    sound(ctx, "block.piston.contract", x, y, z, 0.5, ctx.random() * 0.15 + 0.6);
  }
}

export const PISTON_BEHAVIOR: BlockBehavior = {
  place: (ctx, _x, _y, _z, info, def) => stateOf(idOf(def), OPP[lookNearest(ctx, info)]),
  onPlaced: checkPiston,
  neighborChanged: checkPiston,
  onRemoved(ctx, x, y, z, s) {
    if (!extended(s)) return;
    const f = facing(s);
    const hx = x + DX[f], hy = y + DY[f], hz = z + DZ[f];
    const h = ctx.world.getBlock(hx, hy, hz);
    if (isHead(h) && facing(h) === f) {
      ctx.world.setBlock(hx, hy, hz, AIR, SET_NO_DROP);
      notifyNeighbors(ctx, hx, hy, hz);
    }
  },
};

function headAttached(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const f = facing(s);
  const b = ctx.world.getBlock(x - DX[f], y - DY[f], z - DZ[f]);
  return isBase(b) && extended(b) && facing(b) === f;
}

export const HEAD_BEHAVIOR: BlockBehavior = {
  canSurvive: headAttached,
  neighborChanged(ctx, x, y, z, s) {
    if (!headAttached(ctx, x, y, z, s)) {
      ctx.world.setBlock(x, y, z, AIR, SET_NO_DROP);
      notifyNeighbors(ctx, x, y, z);
    }
  },
  onRemoved(ctx, x, y, z, s) {
    if (!headAttached(ctx, x, y, z, s)) return;
    const f = facing(s);
    const bx = x - DX[f], by = y - DY[f], bz = z - DZ[f];
    const b = ctx.world.getBlock(bx, by, bz);
    if (ctx.player?.gameMode !== "creative") for (const st of computeDrops(b, null, ctx.random)) ctx.entities.dropItem(st, bx + 0.5, by + 0.5, bz + 0.5);
    ctx.world.setBlock(bx, by, bz, AIR, SET_NO_DROP);
    notifyNeighbors(ctx, bx, by, bz);
  },
};
