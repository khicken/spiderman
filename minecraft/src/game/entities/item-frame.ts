import { Face, type Entity, type GameCtx, type ItemStack } from "../contracts";
import { containerChanged } from "../mechanics/redstone/inventory";
import { mapById } from "../systems/features/maps";

const N: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const near: Entity[] = [];
const isFrameType = (t: string) => t === "item_frame" || t === "glow_item_frame";
const cellKey = (e: Entity) => `${e.data.x},${e.data.y},${e.data.z}`;

// Vanilla ItemFrame.getAnalogOutput: rotation + 1 while it holds an item. -1 means no frame in that cell facing that way.
export function frameOutput(ctx: GameCtx, x: number, y: number, z: number, face: Face): number {
  ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 1.5, near);
  for (const e of near) {
    if (e.dead || !isFrameType(e.type) || !e.data.placed || e.data.face !== face) continue;
    if (e.data.x !== x || e.data.y !== y || e.data.z !== z) continue;
    return e.data.item ? (((e.data.rot as number) ?? 0) & 7) + 1 : 0;
  }
  return -1;
}

function mapOf(s: ItemStack | undefined) {
  return s?.item === "filled_map" && typeof s.data?.map === "number" ? s.data.map : -1;
}

// Vanilla MapItemSavedData frame markers: a green arrow at each frame holding the map, pointing out of the wall.
export function syncFrameMarker(e: Entity, item: ItemStack | undefined) {
  const key = cellKey(e);
  const prev = e.data._mapMark as number | undefined;
  const id = e.dead ? -1 : mapOf(item);
  if (prev !== undefined && prev !== id) {
    const old = mapById(prev);
    if (old?.frames?.[key]) {
      delete old.frames[key];
      old.version++;
    }
  }
  e.data._mapMark = id >= 0 ? id : undefined;
  const m = mapById(id);
  if (!m) return;
  const x = e.data.x as number, z = e.data.z as number;
  const s = 1 << m.scale;
  const inside = Math.abs((x - m.cx) / s) <= 63 && Math.abs((z - m.cz) / s) <= 63;
  const n = N[(e.data.face as Face) ?? Face.North];
  const rot = n[1] !== 0 ? Math.PI / 2 : Math.atan2(n[0], -n[2]);
  const cur = m.frames?.[key];
  if (!inside) {
    if (cur) {
      delete m.frames![key];
      m.version++;
    }
    return;
  }
  if (cur && cur.x === x && cur.z === z && cur.rot === rot) return;
  (m.frames ??= {})[key] = { x, z, rot };
  m.version++;
}

export function frameChanged(ctx: GameCtx, e: Entity, item: ItemStack | undefined) {
  syncFrameMarker(e, item);
  const n = N[(e.data.face as Face) ?? Face.North];
  containerChanged(ctx, (e.data.x as number) - n[0], (e.data.y as number) - n[1], (e.data.z as number) - n[2]);
}
