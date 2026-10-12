import { MIN_Y } from "../contracts";
import { blockId as I } from "../blocks/registry";
import { chest, faceOf, fill, fillFn, frame, get, hz, insideL, logA, logB, mob, put, S, stairs, type Frame } from "./build";
import { B } from "./ids";
import { overworldGen, type ChunkCtx } from "./overworld";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";
import { BI } from "./surface";

interface Style {
  name: string;
  found: number;
  floor: number;
  wall: number;
  corner: number;
  roof: number;
  roofTop: number;
  flat: boolean;
  path: number;
  door: number;
  fence: number;
  accent: number;
  bed: number;
  crops: number[];
  loot: string;
}

const STYLES: Record<string, Style> = {
  plains: {
    name: "plains", found: B.cobblestone, floor: B.oak_planks, wall: B.oak_planks, corner: B.oak_log, roof: B.oak_stairs, roofTop: B.oak_slab, flat: false,
    path: B.dirt_path, door: B.oak_door, fence: B.oak_fence, accent: I("white_wool"), bed: I("red_bed"), crops: [B.wheat, B.wheat, B.carrots, B.potatoes, I("beetroots")], loot: "village_plains_house",
  },
  desert: {
    name: "desert", found: B.sandstone, floor: B.smooth_sandstone, wall: B.sandstone, corner: B.cut_sandstone, roof: B.sandstone_stairs, roofTop: B.smooth_sandstone, flat: true,
    path: B.smooth_sandstone, door: I("jungle_door"), fence: B.sandstone_wall, accent: I("orange_terracotta"), bed: I("green_bed"), crops: [B.wheat, I("beetroots")], loot: "village_desert_house",
  },
  savanna: {
    name: "savanna", found: B.cobblestone, floor: B.acacia_planks, wall: B.acacia_planks, corner: B.acacia_log, roof: B.acacia_stairs, roofTop: I("acacia_slab"), flat: false,
    path: B.dirt_path, door: I("acacia_door"), fence: B.acacia_fence, accent: I("orange_terracotta"), bed: I("orange_bed"), crops: [B.wheat, I("melon_stem")], loot: "village_savanna_house",
  },
  taiga: {
    name: "taiga", found: B.cobblestone, floor: B.spruce_planks, wall: B.spruce_planks, corner: B.spruce_log, roof: B.spruce_stairs, roofTop: I("spruce_slab"), flat: false,
    path: B.dirt_path, door: B.spruce_door, fence: B.spruce_fence, accent: B.cobblestone, bed: I("brown_bed"), crops: [I("pumpkin_stem"), B.potatoes, I("sweet_berry_bush")], loot: "village_taiga_house",
  },
  snowy: {
    name: "snowy", found: I("stripped_spruce_log"), floor: B.spruce_planks, wall: I("white_terracotta"), corner: I("stripped_spruce_log"), roof: B.spruce_stairs, roofTop: B.snow_block, flat: false,
    path: B.dirt_path, door: B.spruce_door, fence: B.spruce_fence, accent: B.packed_ice, bed: I("light_blue_bed"), crops: [I("beetroots"), B.potatoes], loot: "village_snowy_house",
  },
};

const JOBS: [number, string, string | null][] = [
  [B.composter, "farmer", null], [I("lectern"), "librarian", null], [I("blast_furnace"), "armorer", "village_armorer"],
  [I("smithing_table"), "toolsmith", "village_toolsmith"], [I("grindstone"), "weaponsmith", "village_weaponsmith"], [I("smoker"), "butcher", "village_butcher"],
  [I("cartography_table"), "cartographer", "village_cartographer"], [I("fletching_table"), "fletcher", "village_fletcher"], [I("loom"), "shepherd", "village_shepherd"],
  [I("cauldron"), "leatherworker", "village_tannery"], [I("stonecutter"), "mason", "village_mason"], [I("brewing_stand"), "cleric", "village_temple"],
  [B.barrel, "fisherman", "village_fisher"],
];

const CLEAR = idTable(B.short_grass, B.tall_grass, B.tall_grass_upper, B.fern, B.large_fern, B.large_fern_upper, B.dandelion, B.poppy, B.snow,
  B.oak_leaves, B.birch_leaves, B.spruce_leaves, B.acacia_leaves, B.cornflower, B.azure_bluet, B.oxeye_daisy, B.dead_bush, B.cactus, B.sugar_cane,
  B.sunflower, B.sunflower_upper, B.pumpkin, B.allium, B.sweet_berry_bush, B.oak_log, B.birch_log, B.spruce_log, B.acacia_log, B.lilac, B.lilac_upper,
  B.rose_bush, B.rose_bush_upper, B.peony, B.peony_upper, B.red_tulip, B.orange_tulip, B.white_tulip, B.pink_tulip, B.lily_of_the_valley, B.melon);
const PATH_ON = idTable(B.grass_block, B.dirt, B.sand, B.coarse_dirt, B.podzol, B.snow_block, B.gravel, B.red_sand, B.mud);
const SOLIDISH = idTable(B.stone, B.dirt, B.grass_block, B.sand, B.sandstone, B.gravel, B.deepslate, B.granite, B.diorite, B.andesite, B.podzol,
  B.coarse_dirt, B.snow_block, B.clay, B.terracotta, B.red_sand, B.tuff, B.calcite, B.mud, B.packed_ice, B.ice);

function styleFor(biome: number): Style {
  if (biome === BI.desert) return STYLES.desert;
  if (biome === BI.savanna) return STYLES.savanna;
  if (biome === BI.taiga) return STYLES.taiga;
  if (biome === BI.snowyPlains) return STYLES.snowy;
  return STYLES.plains;
}

interface Plot {
  kind: number; // < 0 lamp, else the roll that picks the building
  x: number;
  y: number;
  z: number;
  rot: number;
  seed: number;
}
interface Layout {
  arms: number[];
  plots: Plot[];
}

const ARMS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const layouts = new Map<number, Layout>();

function layout(s: Start): Layout {
  const got = layouts.get(s.seed);
  if (got) return got;
  const { ow } = overworldGen(s.ws);
  const r = createRng(s.seed);
  const out: Layout = { arms: [], plots: [] };
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = ARMS[k];
    const len = 26 + r.int(16);
    out.arms.push(len);
    let t = 14 + r.int(3);
    while (t + 4 <= len) {
      for (const side of [1, -1]) {
        const kind = r.next();
        const bseed = r.int(0x7fffffff);
        const lampHere = r.chance(0.35);
        const sx = s.x + dx * t - dz * side * 3, sz = s.z + dz * t + dx * side * 3;
        if (lampHere) {
          const lx = s.x + dx * (t + 4) - dz * side * 2, lz = s.z + dz * (t + 4) + dx * side * 2;
          out.plots.push({ kind: -1, x: lx, y: ow.surfaceY(lx, lz), z: lz, rot: 0, seed: bseed });
        }
        const by = ow.surfaceY(sx - dz * side * 4, sz + dx * side * 4);
        if (by < 62 || Math.abs(by - s.y) > 8) continue;
        out.plots.push({ kind, x: sx, y: by, z: sz, rot: dirRot(-dz * side, dx * side), seed: bseed });
      }
      t += 10 + r.int(3);
    }
  }
  if (layouts.size > 32) layouts.clear();
  layouts.set(s.seed, out);
  return out;
}

export function village(ctx: ChunkCtx, w: Writer, s: Start) {
  const st = styleFor(s.biome);
  const x0 = s.x, z0 = s.z;
  const lay = layout(s);
  const f0 = frame(w, x0, s.y, z0, 0, s.seed);
  meeting(f0, st);
  mob(f0, 3, 1, 3, "iron_golem");
  mob(f0, -3, 1, 3, "villager", { profession: "none" });
  mob(f0, 3, 1, -3, "villager", { profession: "nitwit" });
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = ARMS[k];
    for (let t = 4; t <= lay.arms[k]; t++) {
      for (let q = -1; q <= 1; q++) road(ctx, w, x0 + dx * t - dz * q, z0 + dz * t + dx * q, st, s.seed);
    }
  }
  for (const p of lay.plots) {
    if (p.x < w.ox - 16 || p.x > w.ox + 31 || p.z < w.oz - 16 || p.z > w.oz + 31) continue;
    const f = frame(w, p.x, p.y, p.z, p.rot, p.seed);
    const br = createRng(p.seed);
    const kind = p.kind;
    if (kind < 0) lamp(f, st);
    else if (kind < 0.22) farm(f, br, st, kind < 0.08);
    else if (kind < 0.3) pen(f, br, st);
    else if (kind < 0.42) smith(f, br, st);
    else house(f, br, st, kind < 0.6 ? 1 : kind < 0.85 ? 2 : 3);
  }
}

function dirRot(dx: number, dz: number): number {
  if (dz > 0) return 0;
  if (dx < 0) return 1;
  if (dz < 0) return 2;
  return 3;
}

function road(ctx: ChunkCtx, w: Writer, x: number, z: number, st: Style, seed: number) {
  if (!w.inside(x, z)) return;
  const lx = x - w.ox, lz = z - w.oz;
  const y = ctx.surface[(lz << 4) | lx];
  const i = ((y - MIN_Y) << 8) | (lz << 4) | lx;
  if (y < 62) {
    if ((ctx.blocks[i + 256 * (63 - y)] & 0xfff) === B.water) ctx.blocks[i + 256 * (63 - y)] = S(I(st.name === "desert" ? "birch_planks" : "oak_planks"));
    return;
  }
  const b = ctx.blocks[i] & 0xfff;
  if (PATH_ON[b] || CLEAR[b]) ctx.blocks[i] = S(st.name === "desert" && ((x * 31 + z * 17 + seed) & 3) === 0 ? B.sandstone : st.path);
  for (let k = 1; k < 5; k++) {
    const j = i + k * 256;
    if (CLEAR[ctx.blocks[j] & 0xfff]) ctx.blocks[j] = 0;
  }
}

function pad(f: Frame, a0: number, b0: number, a1: number, b1: number, found: number, height = 10) {
  fillFn(f, a0, -6, b0, a1, -1, b1, (_a, y, _b, x, wy, z) => {
    const cur = f.w.get(x, wy, z);
    if (cur === 0 || CLEAR[cur & 0xfff] || (cur & 0xfff) === B.water || y === -1) return S(y === -1 ? found : SOLIDISH[cur & 0xfff] ? cur & 0xfff : found);
    return -1;
  });
  fill(f, a0, 0, b0, a1, height, b1, 0);
}

function meeting(f: Frame, st: Style) {
  pad(f, -3, -3, 3, 3, B.cobblestone, 8);
  fill(f, -3, 0, -3, 3, 0, 3, S(st.path));
  if (st.name === "taiga" || st.name === "snowy") {
    fill(f, -1, 0, -1, 1, 0, 1, S(B.cobblestone));
    put(f, 0, 1, 0, S(I("campfire")));
    for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      put(f, a, 1, b, S(st.fence));
      put(f, a, 2, b, S(st.fence));
      put(f, a, 3, b, S(B.lantern));
    }
    put(f, 0, 1, 2, S(B.cobblestone));
    put(f, 0, 2, 2, S(B.bell));
    if (st.name === "snowy") for (const [a, b] of [[-1, -2], [1, -2], [-2, 0], [2, 0]]) put(f, a, 1, b, S(B.packed_ice));
    return;
  }
  const rim = st.name === "desert" ? B.cut_sandstone : B.cobblestone;
  fill(f, -2, -3, -2, 2, 1, 2, S(rim));
  fill(f, -1, -2, -1, 1, 1, 1, S(B.water));
  for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    put(f, a, 2, b, S(st.fence));
    put(f, a, 3, b, S(st.fence));
  }
  fill(f, -2, 4, -2, 2, 4, 2, S(st.name === "desert" ? B.smooth_sandstone : I("cobblestone_slab")));
  put(f, 0, 3, 0, S(B.bell));
}

function lamp(f: Frame, st: Style) {
  if (!insideL(f, 0, 0)) return;
  if (st.name === "desert") {
    put(f, 0, 1, 0, S(B.sandstone_wall));
    put(f, 0, 2, 0, S(B.sandstone_wall));
    put(f, 0, 3, 0, S(I("glowstone")));
    return;
  }
  put(f, 0, 1, 0, S(st.fence));
  put(f, 0, 2, 0, S(st.fence));
  if (st.name === "plains") {
    put(f, 0, 3, 0, S(I("black_wool")));
    for (let h = 0; h < 4; h++) put(f, h === 0 ? 0 : h === 1 ? -1 : h === 2 ? 0 : 1, 3, h === 0 ? 1 : h === 1 ? 0 : h === 2 ? -1 : 0, S(B.wall_torch, 1 + hz(f, h)));
  } else {
    put(f, 0, 3, 0, S(st.fence));
    put(f, 0, 4, 0, S(B.lantern));
  }
}

function farm(f: Frame, r: Rng, st: Style, big: boolean) {
  const hw = big ? 6 : 3, d = 9;
  pad(f, -hw - 1, 0, hw + 1, d + 1, B.dirt, 4);
  const crop = st.crops[r.int(st.crops.length)];
  const crop2 = st.crops[r.int(st.crops.length)];
  const border = st.name === "desert" ? B.smooth_sandstone : st.corner;
  fillFn(f, -hw, 0, 1, hw, 1, d, (a, y, b) => {
    const edge = Math.abs(a) === hw || b === 1 || b === d;
    if (y === 0) {
      if (edge) return Math.abs(a) === hw ? logB(f, border) : logA(f, border);
      return a === 0 || (big && Math.abs(a) === 3) ? S(B.water) : S(B.farmland, 7);
    }
    if (edge || a === 0 || (big && Math.abs(a) === 3)) return 0;
    const c = big && a > 0 ? crop2 : crop;
    if (c === I("sweet_berry_bush")) return S(c, 3);
    return S(c, c === I("beetroots") ? 3 : 7);
  });
  if (r.chance(0.5)) {
    put(f, hw, 1, 1, S(B.composter));
    put(f, -hw, 1, d, S(B.hay_block));
  }
}

function pen(f: Frame, r: Rng, st: Style) {
  pad(f, -4, 1, 4, 9, st.found, 4);
  fillFn(f, -4, 0, 1, 4, 1, 9, (a, y, b) => {
    const edge = Math.abs(a) === 4 || b === 1 || b === 9;
    if (y === 0) return S(st.name === "desert" ? B.sand : B.grass_block);
    if (edge) return a === 0 && b === 1 ? S(I("oak_fence_gate"), hz(f, 2)) : S(st.fence);
    return -1;
  });
  put(f, 2, 1, 7, S(B.hay_block));
  put(f, -3, 1, 8, S(I("water_cauldron"), 3));
  const animal = ["cow", "sheep", "pig", "chicken"][r.int(4)];
  mob(f, -1, 1, 5, animal);
  mob(f, 1, 1, 4, animal);
}

function house(f: Frame, r: Rng, st: Style, size: number) {
  const hw = size === 1 ? 2 : 3, d = size === 1 ? 5 : size === 2 ? 7 : 8;
  const h = size === 3 ? 7 : 4;
  shell(f, st, hw, d, h);
  roof(f, st, hw, d, h);
  const job = JOBS[r.int(JOBS.length)];
  const beds = size === 1 ? 1 : 2;
  for (let k = 0; k < beds; k++) bed(f, st, -hw + 1 + k * 2, 1, d - 2);
  put(f, hw - 1, 1, d - 1, S(job[0], job[0] === I("lectern") || job[0] === B.barrel || job[0] === I("blast_furnace") || job[0] === I("smoker") ? faceOf(f, 2) : 0));
  chest(f, hw - 1, 1, 2, 3, st.loot, B.chest);
  put(f, 0, h - 1, Math.floor(d / 2), S(B.lantern, 1));
  put(f, -hw + 1, 1, 1, S(B.crafting_table));
  if (size === 3) {
    fill(f, -hw + 1, 4, 1, hw - 1, 4, d - 1, S(st.floor));
    for (let y = 1; y <= 4; y++) put(f, -hw + 1, y, 2, S(B.ladder, hz(f, 3)));
    put(f, -hw + 1, 4, 2, S(B.ladder, hz(f, 3)));
    bed(f, st, hw - 2, 5, d - 3);
    put(f, 0, 6, 2, S(B.lantern, 1));
  }
  mob(f, 0, 1, Math.floor(d / 2), "villager", { profession: job[1], level: 1 });
  if (beds > 1) mob(f, -1, 1, 3, "villager", { profession: JOBS[r.int(JOBS.length)][1], level: 1 });
  put(f, 0, 0, -1, S(st.name === "desert" ? B.smooth_sandstone : B.cobblestone));
  if (!st.flat) put(f, 0, 0, -1, stairs(f, I(st.name === "snowy" || st.name === "taiga" ? "cobblestone_stairs" : "cobblestone_stairs"), 0));
}

function smith(f: Frame, r: Rng, st: Style) {
  const hw = 4, d = 8;
  shell(f, st, hw, d, 4, true);
  roof(f, st, hw, d, 4);
  const [site, prof, loot] = JOBS[2 + r.int(3)];
  put(f, hw - 1, 1, d - 1, S(site));
  put(f, -hw + 1, 1, d - 1, S(B.furnace, faceOf(f, 0)));
  put(f, -hw + 2, 1, d - 1, S(B.furnace, faceOf(f, 0)));
  fill(f, -1, 0, d - 2, 1, 0, d - 1, S(B.cobblestone));
  put(f, 0, 0, d - 1, S(B.lava));
  fill(f, -1, 1, d - 2, 1, 1, d - 2, S(I("iron_bars")));
  chest(f, hw - 1, 1, 1, 3, loot ?? "village_weaponsmith", B.chest);
  bed(f, st, -hw + 1, 1, 2);
  put(f, 0, 3, 3, S(B.lantern, 1));
  mob(f, 0, 1, 3, "villager", { profession: prof, level: 1 });
}

function bed(f: Frame, st: Style, a: number, y: number, b: number) {
  put(f, a, y, b, S(st.bed, hz(f, 0)));
  put(f, a, y, b + 1, S(st.bed, hz(f, 0) | 4));
}

function shell(f: Frame, st: Style, hw: number, d: number, h: number, open = false) {
  pad(f, -hw, 0, hw, d, st.found, h + 6);
  fillFn(f, -hw, 0, 0, hw, h, d, (a, y, b) => {
    const ea = Math.abs(a) === hw, eb = b === 0 || b === d;
    if (y === 0) return S(ea || eb ? st.found : st.floor);
    if (ea && eb) return st.corner === B.cut_sandstone ? S(st.corner) : S(st.corner);
    if (!ea && !eb) return 0;
    if (y === h) return S(ea || eb ? (st.flat ? st.corner : st.wall) : 0);
    if (open && b === 0 && y < h && Math.abs(a) < hw) return 0;
    if (y === 2 && ((ea && (b === 2 || b === d - 2)) || (eb && Math.abs(a) === hw - 1 && b === d))) return S(st.name === "desert" ? 0 : B.glass_pane);
    if (y === 2 && eb && b === 0 && Math.abs(a) === hw - 1) return S(st.name === "desert" ? 0 : B.glass_pane);
    if (st.name === "desert" && y === h - 1) return S(st.accent);
    return S(y === 1 && st.name === "taiga" ? st.accent : st.wall);
  });
  if (!open) {
    put(f, 0, 1, 0, S(st.door, hz(f, 0)));
    put(f, 0, 2, 0, S(st.door, 8));
    put(f, 0, 3, -1, S(B.wall_torch, 1 + hz(f, 2)));
  }
}

function roof(f: Frame, st: Style, hw: number, d: number, h: number) {
  if (st.flat) {
    fill(f, -hw, h, 0, hw, h, d, S(st.roofTop));
    fillFn(f, -hw, h + 1, 0, hw, h + 1, d, (a, _y, b) => (Math.abs(a) === hw || b === 0 || b === d ? S(B.sandstone_slab) : -1));
    return;
  }
  for (let k = 0; k <= hw; k++) {
    const y = h + k;
    if (k === hw) {
      fill(f, 0, y, -1, 0, y, d + 1, st.roofTop === B.snow_block ? S(B.spruce_planks) : S(st.roofTop));
      if (st.name === "snowy") fill(f, 0, y + 1, -1, 0, y + 1, d + 1, S(B.snow));
      break;
    }
    fill(f, -hw - 1 + k, y, -1, -hw - 1 + k, y, d + 1, stairs(f, st.roof, 3));
    fill(f, hw + 1 - k, y, -1, hw + 1 - k, y, d + 1, stairs(f, st.roof, 1));
    if (st.name === "snowy") {
      fill(f, -hw - 1 + k, y + 1, -1, -hw - 1 + k, y + 1, d + 1, S(B.snow));
      fill(f, hw + 1 - k, y + 1, -1, hw + 1 - k, y + 1, d + 1, S(B.snow));
    }
    if (k > 0) {
      for (const b of [0, d]) fill(f, -hw + k, y, b, hw - k, y, b, S(st.wall));
    }
  }
  if (get(f, 0, h + 1, 0) >= 0 && h + 1 < h + hw) put(f, 0, h + 1, 0, S(B.glass_pane));
}

export function villageRects(s: Start, out: number[]) {
  const lay = layout(s);
  out.push(s.x - 6, s.z - 6, s.x + 6, s.z + 6);
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = ARMS[k], len = lay.arms[k];
    const ex = s.x + dx * len, ez = s.z + dz * len;
    out.push(Math.min(s.x, ex) - 2, Math.min(s.z, ez) - 2, Math.max(s.x, ex) + 2, Math.max(s.z, ez) + 2);
  }
  for (const p of lay.plots) out.push(p.x - 11, p.z - 11, p.x + 11, p.z + 11);
}
