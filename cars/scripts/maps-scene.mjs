// Scenery from OSM around the track: buildings, other streets, water, green areas, landmarks.
import { overpass } from "./maps-net.mjs";
import { areaOf, clipRect, ringsOf, simplify } from "./maps-geo.mjs";

const ROAD = { motorway: 11, trunk: 10, primary: 10, secondary: 9, tertiary: 8, unclassified: 6, residential: 6.5, living_street: 5, pedestrian: 5, service: 4, motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6 };
const GREEN = { forest: 1, wood: 0.9, scrub: 0.45, heath: 0.15, park: 0.35, garden: 0.3, grass: 0.05, meadow: 0.05, village_green: 0.1, recreation_ground: 0.1 };

const num = (v) => { const m = /^\s*(-?[\d.]+)\s*(m|ft|')?/.exec(v || ""); return m ? +m[1] * (m[2] === "ft" || m[2] === "'" ? 0.3048 : 1) : NaN; };
const hash = (id) => ((Math.imul(id % 2147483647 ^ 0x9e3779b9, 2654435761) >>> 0) / 4294967296);

function heightOf(t, area, id, base) {
  const h = num(t.height);
  if (h > 2 && h < 700) return h;
  const lv = num(t["building:levels"]);
  if (lv > 0 && lv < 200) return lv * 3.2 + (num(t["roof:levels"]) || 0) * 1.6 + 1;
  if (/^(house|detached|garage|garages|shed|hut|cabin|kiosk|toilets|carport)$/.test(t.building)) return 4 + hash(id) * 3;
  if (area < 80) return 4 + hash(id) * 4;
  return Math.max(6, base * (0.55 + hash(id) * 0.9) * (area > 2500 ? 1.25 : 1));
}

export function corridorOf(cx, cz, proj, step = 25) {
  const pts = simplify(cx.map((x, i) => [x, cz[i]]), step, false);
  return pts.map(([x, z]) => proj.ll(x, z).map((v) => v.toFixed(5)).join(",")).join(",");
}

export async function buildScene(cfg, ctx) {
  const { proj, rect, grid, halfW, inTunnel, poly, bbox } = ctx;
  const toXZ = (ring) => ring.map(([la, lo]) => proj.xz(la, lo));
  const trackDist = (x, z) => grid.nearest(x, z, 400);

  // Buildings
  const bj = await overpass(`[out:json][timeout:600];(way["building"](around:${cfg.corridor},${poly});relation["building"]["type"="multipolygon"](around:${cfg.corridor},${poly}););out tags geom qt;`);
  const cand = [];
  for (const el of bj.elements) {
    const t = el.tags || {};
    if (/^(roof|no|construction|ruins|bridge)$/.test(t.building) || t["building:part"] || t.location === "underground") continue;
    for (const ring of ringsOf(el)) {
      let pts = toXZ(ring.slice(0, -1));
      const near = trackDist(pts[0][0], pts[0][1]).d;
      pts = simplify(pts, near < 120 ? 0.6 : 1.5, true);
      if (pts.length < 3) continue;
      let a = areaOf(pts);
      if (Math.abs(a) < (near < 100 ? 20 : 45)) continue;
      if (a > 0) pts.reverse();
      a = Math.abs(a);
      const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
      const n = trackDist(c[0], c[1]);
      if (n.d > cfg.corridor + 40) continue;
      if (!inTunnel(n.i) && pts.some(([x, z]) => { const q = trackDist(x, z); return q.d < halfW(q.i) + 0.5 && !inTunnel(q.i); })) continue;
      if (!inTunnel(n.i) && n.d < halfW(n.i) + 1) continue;
      const h = heightOf(t, a, el.id, cfg.buildingH);
      cand.push({ pts, h, score: (Math.sqrt(a) * (1 + h / 25)) / (1 + n.d / 70) });
    }
  }
  cand.sort((p, q) => q.score - p.score);
  const buildings = [];
  let bytes = 0;
  for (const b of cand) {
    const add = b.pts.length * 13 + 8;
    if (bytes + add > cfg.budget) continue;
    bytes += add;
    buildings.push(b.pts.length, b.h, ...b.pts.flat());
  }

  // Other streets
  const rj = await overpass(`[out:json][timeout:300];way["highway"~"^(${Object.keys(ROAD).join("|")})$"](around:${cfg.roadCorridor},${poly});out tags geom qt;`);
  const roads = [];
  for (const el of rj.elements) {
    const t = el.tags || {};
    if (ctx.trackWays.has(el.id) || (t.tunnel && t.tunnel !== "no") || t.highway === "raceway" || t.area === "yes") continue;
    if (t.bridge && t.bridge !== "no" && /motorway|trunk/.test(t.highway)) continue;
    if (!cfg.service && t.highway === "service") continue;
    const w = num(t.width) > 2.5 && num(t.width) < 30 ? num(t.width) : ROAD[t.highway];
    let run = [];
    const flush = () => { const s = simplify(run, 1.2, false); if (s.length > 1) roads.push(s.length, w, ...s.flat()); run = []; };
    for (const [la, lo] of el.geometry.map((p) => [p.lat, p.lon])) {
      const [x, z] = proj.xz(la, lo), q = trackDist(x, z);
      const out = x < rect[0] || x > rect[2] || z < rect[1] || z > rect[3] || (q.d < halfW(q.i) + w / 2 - 0.5 && !inTunnel(q.i) && !ctx.elevated(q.i));
      if (out) flush(); else run.push([x, z]);
    }
    flush();
  }

  // Water and green areas over the terrain box
  const areas = async (q, keep) => {
    const out = [];
    for (const el of (await overpass(q)).elements) for (const ring of ringsOf(el)) {
      let pts = clipRect(toXZ(ring.slice(0, -1)), ...rect);
      if (pts.length < 3) continue;
      pts = simplify(pts, cfg.areaTol, true);
      if (pts.length < 3 || Math.abs(areaOf(pts)) < 300) continue;
      if (areaOf(pts) > 0) pts.reverse();
      const k = keep(el.tags || {}, pts);
      if (k !== null) out.push({ pts, k });
    }
    return out;
  };
  const wa = await areas(`[out:json][timeout:300];(way["natural"="water"](${bbox});relation["natural"="water"](${bbox});way["waterway"="riverbank"](${bbox});way["landuse"~"^(reservoir|basin)$"](${bbox}););out tags geom qt;`, () => 0);
  const ga = await areas(`[out:json][timeout:300];(way["landuse"~"^(forest|grass|meadow|village_green|recreation_ground)$"](${bbox});way["natural"~"^(wood|scrub|heath)$"](${bbox});way["leisure"~"^(park|garden)$"](${bbox});relation["landuse"="forest"](${bbox});relation["natural"="wood"](${bbox});relation["leisure"="park"](${bbox}););out tags geom qt;`, (t) => GREEN[t.landuse] ?? GREEN[t.natural] ?? GREEN[t.leisure] ?? null);
  const green = [];
  for (const g of ga) green.push(g.pts.length, g.k, ...g.pts.flat());

  // Landmarks: OSM position by exact name when present, else the given lat/lon
  const named = cfg.landmarks.filter((l) => l.osm);
  const lj = named.length ? await overpass(`[out:json][timeout:120];nwr["name"~"^(${named.map((l) => l.osm).join("|")})$"](${bbox});out tags center;`) : { elements: [] };
  const landmarks = cfg.landmarks.map((l) => {
    const e = l.osm && lj.elements.find((e) => e.tags?.name === l.osm && (e.center || e.lat));
    const [x, z] = e ? proj.xz(e.center?.lat ?? e.lat, e.center?.lon ?? e.lon) : proj.xz(...l.ll);
    return { name: l.name, x, z, kind: l.kind };
  });
  return { buildings, roads, waterAreas: wa.map((w) => w.pts), green, landmarks, buildingCount: buildings.length ? countRecords(buildings, 2) : 0 };
}

export function countRecords(a, head) {
  let n = 0;
  for (let i = 0; i < a.length; i += head + a[i] * 2) n++;
  return n;
}
