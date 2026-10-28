import type { Entity } from "../contracts";

// Entity ids change on every load, so saves hold links to other entities as data.uuid strings.
const LINKS = ["mount", "owner", "hooked", "caravanHead", "target"];
const PREFIX = "u:";
let counter = 0;

const newUuid = () => `${PREFIX}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function uuidOf(e: Entity): string {
  if (typeof e.data.uuid !== "string") e.data.uuid = newUuid();
  return e.data.uuid as string;
}

export function linksToSave(saved: Map<number, Entity>, out: { e: Entity; data: Record<string, unknown> }[]) {
  const ref = (id: unknown) => {
    const t = typeof id === "number" ? saved.get(id) : undefined;
    return t ? uuidOf(t) : undefined;
  };
  for (const { data } of out) {
    for (const k of LINKS) if (typeof data[k] === "number") data[k] = ref(data[k]);
    const l = data.leash as { entity?: unknown } | undefined;
    if (l && typeof l === "object" && !Array.isArray(l) && "entity" in l) data.leash = ref(l.entity) ? { ...l, entity: ref(l.entity) } : undefined;
  }
  for (const { e, data } of out) if (typeof e.data.uuid === "string") data.uuid = e.data.uuid;
}

// Raw numeric ids come from saves made before uuids and point at nothing now.
export function linksFromSave(loaded: Entity[]) {
  const byUuid = new Map<string, Entity>();
  for (const e of loaded) if (typeof e.data.uuid === "string") byUuid.set(e.data.uuid, e);
  const id = (v: unknown) => (typeof v === "string" && v.startsWith(PREFIX) ? byUuid.get(v)?.id : undefined);
  for (const e of loaded) {
    const d = e.data;
    for (const k of LINKS) if (typeof d[k] === "number" || (typeof d[k] === "string" && (d[k] as string).startsWith(PREFIX))) d[k] = id(d[k]);
    const l = d.leash as { entity?: unknown } | undefined;
    if (l && typeof l === "object" && !Array.isArray(l) && "entity" in l) {
      const t = id(l.entity);
      d.leash = t === undefined ? undefined : { ...l, entity: t };
    }
    if (e.type === "trader_llama" && typeof d.trader === "number") {
      d.trader = undefined;
      const tr = nearestTrader(loaded, e);
      if (tr) d.leash = { entity: tr.id };
    }
  }
}

// Old saves linked a trader llama by data.trader, a raw id; its trader spawned 2 blocks away.
function nearestTrader(loaded: Entity[], e: Entity) {
  let best: Entity | undefined, bd = 16 * 16;
  for (const o of loaded) {
    if (o.type !== "wandering_trader") continue;
    const p = o.body.pos, q = e.body.pos;
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}
