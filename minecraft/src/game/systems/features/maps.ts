import type { Dim, GameCtx, ItemStack } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { findNear } from "../../worldgen/structure-grid";
import { mapColorOf } from "./map-colors";

export interface MapData {
  cx: number;
  cz: number;
  scale: number;
  dim: Dim;
  locked: boolean;
  colors: Uint8Array; // 128 * 128, byte = color * 4 + shade, row-major from the north-west corner
  version: number;
  marker?: { x: number; z: number; kind: string };
}

const maps = new Map<number, MapData>();
let nextId = 0;
let cursor = 0;
const WATER = 12;

export const mapById = (id: number) => maps.get(id);

function center(v: number, scale: number) {
  const size = 128 << scale;
  return Math.floor((v + 64) / size) * size + size / 2 - 64;
}

export function createMap(x: number, z: number, scale: number, dim: Dim): number {
  const id = nextId++;
  maps.set(id, { cx: center(x, scale), cz: center(z, scale), scale, dim, locked: false, colors: new Uint8Array(128 * 128), version: 0 });
  return id;
}

const EXPLORER: [RegExp, string, string][] = [[/Ocean Explorer/, "ocean_monument", "monument"], [/Woodland Explorer/, "woodland_mansion", "mansion"], [/Trial/, "trial_chambers", "trial_chambers"]];

// Cartography table zoom, lock and explorer maps change data on the stack; this gives the stack a map that matches it.
export function resolveMap(ctx: GameCtx, stack: ItemStack): MapData | null {
  const d = (stack.data ??= {});
  let id = typeof d.map === "number" ? d.map : -1;
  let m = maps.get(id);
  const scale = Number(d.scale ?? m?.scale ?? 0);
  if (!m) {
    const name = String(stack.name ?? d.name ?? "");
    const ex = EXPLORER.find(([re]) => re.test(name));
    const p = ctx.player.body.pos;
    const s = ex ? findNear(ctx.world.seed, ex[1], p.x, p.z, 5000) : null;
    id = createMap(s ? s.x : p.x, s ? s.z : p.z, s ? 2 : scale, ctx.world.dim);
    m = maps.get(id)!;
    if (s && ex) m.marker = { x: s.x, z: s.z, kind: ex[2] };
    d.map = id;
    d.scale = m.scale;
  } else if (m.scale !== scale || (!!d.locked && !m.locked)) {
    const nid = createMap(m.cx, m.cz, scale, m.dim);
    const n = maps.get(nid)!;
    if (scale === m.scale) n.colors.set(m.colors);
    n.locked = !!d.locked;
    d.map = nid;
    m = n;
  }
  return m;
}

export function useEmptyMap(ctx: GameCtx, slot: number): boolean {
  const st = ctx.inventory.slots[slot];
  if (!st || st.item !== "map") return false;
  const p = ctx.player.body.pos;
  const id = createMap(p.x, p.z, 0, ctx.world.dim);
  const filled: ItemStack = { item: "filled_map", count: 1, data: { map: id, scale: 0 } };
  if (ctx.player.gameMode !== "creative") {
    if (st.count > 1) {
      ctx.inventory.setSlot(slot, { ...st, count: st.count - 1 });
      const rest = ctx.inventory.add(filled);
      if (rest) ctx.entities.dropItem(rest, p.x, p.y + 1, p.z);
    } else ctx.inventory.setSlot(slot, filled);
  } else ctx.inventory.add(filled);
  ctx.emit({ type: "sound", name: "ui.cartography_table.take_result", x: p.x, y: p.y, z: p.z, volume: 0.5 });
  updateMap(ctx, maps.get(id)!, 128);
  return true;
}

function surface(ctx: GameCtx, x: number, z: number, out: { y: number; c: number; depth: number }) {
  const w = ctx.world;
  let y = w.topY(x, z);
  const nether = w.dim === "nether";
  if (nether) {
    y = 120;
    while (y > 0 && w.getBlock(x, y, z) !== 0) y--;
    while (y > 0 && w.getBlock(x, y, z) === 0) y--;
  }
  let c = 0;
  for (; y > -64; y--) {
    c = mapColorOf(w.getBlock(x, y, z));
    if (c) break;
  }
  let depth = 0;
  if (c === WATER) {
    let yy = y - 1;
    while (yy > -64 && depth < 16 && blockDef(w.getBlock(x, yy, z)).name === "water") {
      yy--;
      depth++;
    }
  }
  out.y = y;
  out.c = c;
  out.depth = depth;
}

const col = { y: 0, c: 0, depth: 0 };

// Vanilla MapItem.update: a radius around the holder fills in; height against the north neighbor picks the shade.
export function updateMap(ctx: GameCtx, m: MapData, columns = 16) {
  if (m.locked || m.dim !== ctx.world.dim) return;
  const s = 1 << m.scale;
  const p = ctx.player.body.pos;
  const px = Math.floor((p.x - m.cx) / s) + 64, pz = Math.floor((p.z - m.cz) / s) + 64;
  const r = 128 / s;
  let changed = false;
  for (let k = 0; k < columns; k++) {
    const ix = (cursor + k) & 127;
    if (Math.abs(ix - px) > r) continue;
    let prevY = -9999;
    for (let iz = Math.max(0, pz - r - 1); iz < Math.min(128, pz + r); iz++) {
      const dx = ix - px, dz = iz - pz;
      const inside = dx * dx + dz * dz <= r * r;
      const wx = m.cx + (ix - 64) * s, wz = m.cz + (iz - 64) * s;
      if (!ctx.world.isLoaded(wx, wz)) {
        prevY = -9999;
        continue;
      }
      surface(ctx, wx, wz, col);
      const y = col.y;
      if (prevY === -9999) {
        surface(ctx, wx, wz - s, col);
        prevY = col.y;
        surface(ctx, wx, wz, col);
      }
      if (inside && iz >= 0) {
        let shade = 1;
        if (col.c === WATER) {
          const d = col.depth * 0.1 + ((ix + iz) & 1) * 0.2;
          shade = d < 0.5 ? 2 : d > 0.9 ? 0 : 1;
        } else {
          const d = ((y - prevY) * 4) / (m.scale + 4) + (((ix + iz) & 1) - 0.5) * 0.4;
          shade = d > 0.6 ? 2 : d < -0.6 ? 0 : 1;
        }
        const v = col.c ? col.c * 4 + shade : 0;
        const i = iz * 128 + ix;
        if (m.colors[i] !== v) {
          m.colors[i] = v;
          changed = true;
        }
      }
      prevY = y;
    }
  }
  cursor = (cursor + columns) & 127;
  if (changed) m.version++;
}

export function tickMaps(ctx: GameCtx) {
  const inv = ctx.inventory;
  for (const st of [inv.held(), inv.slots[40]]) {
    if (st?.item !== "filled_map") continue;
    const m = resolveMap(ctx, st);
    if (m) updateMap(ctx, m);
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encode(a: Uint8Array): string {
  let s = "";
  for (let i = 0; i < a.length; i += 3) {
    const n = (a[i] << 16) | ((a[i + 1] ?? 0) << 8) | (a[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  return s;
}
function decode(s: string, out: Uint8Array) {
  for (let i = 0, j = 0; i < s.length && j < out.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | (B64.indexOf(s[i + 2]) << 6) | B64.indexOf(s[i + 3]);
    out[j++] = (n >> 16) & 255;
    if (j < out.length) out[j++] = (n >> 8) & 255;
    if (j < out.length) out[j++] = n & 255;
  }
}

export function saveMaps() {
  return { next: nextId, maps: [...maps].map(([id, m]) => ({ id, cx: m.cx, cz: m.cz, scale: m.scale, dim: m.dim, locked: m.locked, marker: m.marker, colors: encode(m.colors) })) };
}

export function loadMaps(data: unknown) {
  maps.clear();
  const d = (data ?? {}) as { next?: number; maps?: { id: number; cx: number; cz: number; scale: number; dim: Dim; locked: boolean; marker?: MapData["marker"]; colors: string }[] };
  nextId = Number(d.next ?? 0);
  for (const m of d.maps ?? []) {
    const colors = new Uint8Array(128 * 128);
    decode(m.colors ?? "", colors);
    maps.set(m.id, { cx: m.cx, cz: m.cz, scale: m.scale, dim: m.dim, locked: !!m.locked, marker: m.marker, colors, version: 1 });
  }
}
