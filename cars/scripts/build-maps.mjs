// Builds src/app/maps/<id>.ts from OpenStreetMap (Overpass) and AWS Terrain Tiles. Usage: node scripts/build-maps.mjs [id ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { overpass } from "./maps-net.mjs";
import { createDem, createPointGrid, createProjection } from "./maps-geo.mjs";
import { createGraph, route } from "./maps-route.mjs";
import { curvature, gauss, limitGrade, median, ranges, smoothLine } from "./maps-line.mjs";
import { buildScene, corridorOf } from "./maps-scene.mjs";
import { CONFIGS } from "./maps-config.mjs";
import { writePreview } from "./maps-preview.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "../src/app/maps");
const STEP = 5;
const CREDIT = "© OpenStreetMap contributors · Terrain: Mapzen Terrain Tiles (SRTM, EU-DEM, USGS 3DEP and others) via AWS Open Data";

const r1 = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? 0 : r; };
const arr = (a, per = 24) => {
  const parts = [];
  for (let i = 0; i < a.length; i += per) parts.push(a.slice(i, i + per).map(r1).join(","));
  return "[\n    " + parts.join(",\n    ") + "\n  ]";
};
const isTunnel = (t) => (t.tunnel && t.tunnel !== "no") || t.covered === "yes";
const isBridge = (t) => t.bridge && t.bridge !== "no";

async function buildTrack(cfg) {
  const j = await overpass(cfg.track);
  const rel = j.elements.find((e) => e.type === "relation");
  const pit = new Set((rel?.members || []).filter((m) => /pit/.test(m.role)).map((m) => m.ref));
  const ways = j.elements.filter((e) => e.type === "way");
  const graph = createGraph(ways, { oneway: cfg.oneway, join: cfg.join || 0, cost: (t, w) => (pit.has(w.id) || (cfg.skip && cfg.skip(t)) ? 0 : 1) });
  const startNode = j.elements.find((e) => e.type === "node" && rel?.members.some((m) => m.type === "node" && m.ref === e.id && m.role === "start"));
  const r = route(graph, cfg.wps, cfg.closed);
  return { pts: r.pts, start: startNode ? [startNode.lat, startNode.lon] : cfg.start };
}

function elevation(cfg, xs, zs, tags, heightAt, proj) {
  const n = xs.length, raw = xs.map((x, i) => heightAt(x, zs[i])), y = raw.slice();
  const tun = tags.map(isTunnel), bri = tags.map(isBridge);
  const deck = tags.map((t, i) => tun[i] || bri[i]);
  if (cfg.deck === "layer") {
    const ground = gauss(median(raw, 8, cfg.closed), 60 / STEP, cfg.closed);
    for (let i = 0; i < n; i++) {
      const L = parseInt(tags[i].layer) || (bri[i] ? 1 : tun[i] ? -1 : 0);
      y[i] = ground[i] + (L > 0 ? 8 + 5 * (Math.min(L, 3) - 1) : L < 0 ? -8 - 5 * (Math.min(-L, 2) - 1) : 0);
    }
  } else {
    for (const [a, b] of ranges(deck)) {
      const pa = cfg.closed ? (a - 3 + n) % n : Math.max(0, a - 3), pb = cfg.closed ? (b + 3) % n : Math.min(n - 1, b + 3);
      const ya = raw[pa], yb = raw[pb], len = b + 3 - (a - 3);
      for (let k = a - 2; k <= b + 2; k++) { const i = cfg.closed ? (k + n) % n : Math.min(n - 1, Math.max(0, k)); y[i] = ya + ((yb - ya) * (k - a + 3)) / len; }
    }
  }
  let s = gauss(median(y, cfg.med, cfg.closed), cfg.sigmaY / STEP, cfg.closed);
  // Pinned heights where the DEM mixes sea and roofs: shift the profile piecewise linearly along s.
  if (cfg.anchors) {
    if (cfg.anchorsOnly) s = s.map(() => 0);
    const pins = cfg.anchors.map(([la, lo, e]) => { const [ax, az] = proj.xz(la, lo); let bi = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (xs[i] - ax) ** 2 + (zs[i] - az) ** 2; if (d < bd) { bd = d; bi = i; } } return [bi, e - s[bi]]; }).sort((p, q) => p[0] - q[0]);
    console.log("  anchors at", pins.map((p) => p[0]).join(" "));
    const m = pins.length;
    s = s.map((v, i) => {
      let k = pins.findIndex((p) => p[0] > i);
      if (k < 0) k = m;
      const [ia, da] = pins[(k - 1 + m) % m], [ib, db] = pins[k % m];
      const span = (ib - ia + n) % n || n, t = ((i - ia + n) % n) / span;
      return v + da + (db - da) * t;
    });
  }
  s = gauss(limitGrade(s, cfg.maxGrade * STEP, cfg.closed), 8 / STEP, cfg.closed);
  // Stacked decks: keep 7 m between a road and any part of itself it crosses.
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j += 1) {
        const ds = Math.abs(i - j), sep = cfg.closed ? Math.min(ds, n - ds) : ds;
        if (sep < 30 || j <= i) continue;
        if (Math.hypot(xs[i] - xs[j], zs[i] - zs[j]) > cfg.width) continue;
        const dy = s[i] - s[j];
        if (Math.abs(dy) >= 7) continue;
        const up = (parseInt(tags[i].layer) || 0) > (parseInt(tags[j].layer) || 0) || ((parseInt(tags[i].layer) || 0) === (parseInt(tags[j].layer) || 0) && dy >= 0) ? i : j;
        const need = 7.2 - Math.abs(dy);
        for (let k = -30; k <= 30; k++) { const q = cfg.closed ? (up + k + n) % n : up + k; if (q >= 0 && q < n) s[q] += need * Math.exp(-(k * k) / (2 * 9 * 9)); }
        moved = true;
      }
    }
    if (!moved) break;
  }
  const minRun = (flags, m) => ranges(flags).filter(([a, b]) => b - a + 1 >= m);
  return { y: s, tunnels: minRun(tun, 3), elevated: minRun(bri, cfg.deck === "layer" ? 3 : 4) };
}

async function buildMap(cfg) {
  console.log(`\n== ${cfg.id}`);
  const { pts, start } = await buildTrack(cfg);
  let s = 90, w = 180, nn = -90, e = -180;
  for (const p of pts) { s = Math.min(s, p.lat); nn = Math.max(nn, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
  const origin = [+((s + nn) / 2).toFixed(6), +((w + e) / 2).toFixed(6)], proj = createProjection(...origin);
  const xz = pts.map((p) => proj.xz(p.lat, p.lon));
  const keep = xz.map((p, i) => i === 0 || Math.hypot(p[0] - xz[i - 1][0], p[1] - xz[i - 1][1]) > 0.05);
  const P = pts.filter((_, i) => keep[i]), X = xz.filter((_, i) => keep[i]);
  const line = smoothLine(X.map((p) => p[0]), X.map((p) => p[1]), cfg.closed, STEP, cfg.fine, cfg.minR);
  const { xs, zs } = line, n = xs.length;
  const tags = line.src.map((j) => (P[j].way || P[(j + 1) % P.length].way)?.tags || {});

  // Terrain box
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); z0 = Math.min(z0, zs[i]); z1 = Math.max(z1, zs[i]); }
  const st = cfg.step;
  x0 = Math.floor((x0 - cfg.margin) / st) * st; z0 = Math.floor((z0 - cfg.margin) / st) * st;
  const nx = Math.ceil((x1 + cfg.margin - x0) / st) + 1, nz = Math.ceil((z1 + cfg.margin - z0) / st) + 1;
  const rect = [x0, z0, x0 + (nx - 1) * st, z0 + (nz - 1) * st];
  const [la0, lo0] = proj.ll(rect[0], rect[3]), [la1, lo1] = proj.ll(rect[2], rect[1]);
  const dem = createDem(cfg.zoom);
  await dem.load(la0 - 0.002, lo0 - 0.002, la1 + 0.002, lo1 + 0.002);
  const h = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h.push(dem.at(...proj.ll(x0 + i * st, z0 + j * st)));
  // Where the DEM includes rooftops, take a low percentile of the neighborhood as the ground.
  if (cfg.despike) {
    const r = Math.round(cfg.despike / st), src = h.slice();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const w = [];
      for (let b = Math.max(0, j - r); b <= Math.min(nz - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) w.push(src[b * nx + a]);
      w.sort((p, q) => p - q);
      h[j * nx + i] = Math.max(cfg.minH ?? -1e9, w[Math.floor(w.length * 0.3)]);
    }
  }
  const gridAt = (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / st)), fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / st)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (h[j * nx + i] * (1 - u) + h[j * nx + i + 1] * u) * (1 - v) + (h[(j + 1) * nx + i] * (1 - u) + h[(j + 1) * nx + i + 1] * u) * v;
  };

  const { y, tunnels, elevated } = elevation(cfg, xs, zs, tags, cfg.despike ? gridAt : (x, z) => dem.at(...proj.ll(x, z)), proj);
  const k = curvature(xs, zs, cfg.closed, 2);
  const width = xs.map(() => cfg.width);
  const runoff = gauss(k.map((v) => cfg.runoff(Math.abs(v))), 30 / STEP, cfg.closed);
  const grid = createPointGrid(xs, zs, 25);
  const [sx, sz] = proj.xz(...start), startIdx = cfg.closed ? grid.nearest(sx, sz, 5000).i : 0;

  const inRange = (rs) => { const f = new Uint8Array(n); for (const [a, b] of rs) for (let i = a; i <= b; i++) f[i] = 1; return (i) => i >= 0 && f[i] === 1; };
  const scene = await buildScene(cfg, {
    proj, rect, grid, halfW: (i) => (i >= 0 ? width[i] / 2 : 0), inTunnel: inRange(tunnels), elevated: inRange(elevated),
    poly: corridorOf(X.map((p) => p[0]), X.map((p) => p[1]), proj), bbox: [la0, lo0, la1, lo1].map((v) => v.toFixed(5)).join(","),
    trackWays: new Set(P.map((p) => p.way?.id).filter(Boolean)),
  });

  // Water: OSM polygons plus sea cells from the DEM, merged into rectangles.
  // Inland maps: one water level from the DEM under the lakes; polygons far off that level are dropped.
  let waterY = cfg.waterY, areas = scene.waterAreas;
  if (waterY === "auto") {
    const lvl = areas.map((p) => { const v = p.map(([x, z]) => gridAt(x, z)).sort((a, b) => a - b); return v[v.length >> 1]; });
    const big = areas.map((p, i) => [Math.abs(p.reduce((a, q, k) => a + q[0] * p[(k + 1) % p.length][1] - p[(k + 1) % p.length][0] * q[1], 0)), lvl[i]]).sort((a, b) => b[0] - a[0]);
    waterY = big.length ? Math.round(big[0][1] - 1) : Math.round(Math.min(...h) - 50);
    areas = areas.filter((_, i) => Math.abs(lvl[i] - 1 - waterY) < 4);
  }
  const water = [];
  for (const p of areas) water.push(p.length, ...p.flat());
  if (cfg.sea) {
    let open = new Map();
    const emit = (r) => { const xa = x0 + (r.i0 - 0.5) * st, xb = x0 + (r.i1 + 0.5) * st, za = z0 + (r.j0 - 0.5) * st, zb = z0 + (r.j1 + 0.5) * st; water.push(4, xa, za, xa, zb, xb, zb, xb, za); };
    for (let j = 0; j < nz; j++) {
      const next = new Map();
      for (let i = 0; i < nx; ) {
        if (h[j * nx + i] >= 0.3) { i++; continue; }
        let b = i; while (b + 1 < nx && h[j * nx + b + 1] < 0.3) b++;
        const key = i + ":" + b, r = open.get(key);
        if (r) { r.j1 = j; open.delete(key); next.set(key, r); } else next.set(key, { i0: i, i1: b, j0: j, j1: j });
        i = b + 1;
      }
      for (const r of open.values()) emit(r);
      open = next;
    }
    for (const r of open.values()) emit(r);
  }

  const map = {
    id: cfg.id, name: cfg.name, place: cfg.place, origin, closed: cfg.closed, laps: cfg.laps,
    center: xs.flatMap((x, i) => [x, y[i], zs[i]]), width, runoff, start: startIdx, tunnels, elevated,
    terrain: { x0, z0, step: st, nx, nz, h }, buildings: scene.buildings, roads: scene.roads, water, waterY,
    green: scene.green, landmarks: scene.landmarks.map((l) => ({ ...l, x: r1(l.x), z: r1(l.z) })), env: cfg.env, credit: CREDIT,
  };
  const src = `import type { MapData } from "../contracts";

// Generated by scripts/build-maps.mjs from OpenStreetMap and AWS Terrain Tiles. Do not edit by hand.
export const MAP: MapData = {
  id: "${map.id}",
  name: ${JSON.stringify(map.name)},
  place: ${JSON.stringify(map.place)},
  origin: [${origin.join(", ")}],
  closed: ${map.closed},
  laps: ${map.laps},
  center: ${arr(map.center, 30)},
  width: ${arr(width, 40)},
  runoff: ${arr(runoff, 40)},
  start: ${startIdx},
  tunnels: ${JSON.stringify(tunnels)},
  elevated: ${JSON.stringify(elevated)},
  terrain: { x0: ${x0}, z0: ${z0}, step: ${st}, nx: ${nx}, nz: ${nz}, h: ${arr(h, 40)} },
  buildings: ${arr(scene.buildings, 30)},
  roads: ${arr(scene.roads, 30)},
  water: ${arr(water, 30)},
  waterY: ${waterY},
  green: ${arr(scene.green, 30)},
  landmarks: [
${map.landmarks.map((l) => `    { name: ${JSON.stringify(l.name)}, x: ${l.x}, z: ${l.z}, kind: "${l.kind}" },`).join("\n")}
  ],
  env: ${JSON.stringify(cfg.env).replace(/"(\w+)":/g, "$1: ")},
  credit: ${JSON.stringify(CREDIT)},
};
`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${cfg.id}.ts`), src);
  writePreview(map, join(ROOT, ".cache", `preview-${cfg.id}.svg`));

  // Stats
  const L = line.length;
  let gmax = 0, kmax = 0, dk = 0;
  for (let i = 0; i < n; i++) {
    const a = cfg.closed ? (i + n - 1) % n : Math.max(0, i - 1), b = cfg.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    if (a !== i && b !== i) gmax = Math.max(gmax, Math.abs(y[b] - y[a]) / Math.hypot(xs[b] - xs[a], zs[b] - zs[a]));
    kmax = Math.max(kmax, Math.abs(k[i]));
    if (a !== i) dk = Math.max(dk, Math.abs(k[i] - k[a]) / STEP);
  }
  const stats = { id: cfg.id, length: Math.round(L), real: cfg.real, err: ((L / cfg.real - 1) * 100).toFixed(1) + "%", points: n, minY: r1(Math.min(...y)), maxY: r1(Math.max(...y)), maxGrade: (gmax * 100).toFixed(1) + "%", maxCurv: kmax.toFixed(3), minRadius: (1 / kmax).toFixed(1) + "m", maxDkDs: dk.toFixed(4), buildings: scene.buildingCount, tunnels: tunnels.length, elevated: elevated.length, kb: Math.round(src.length / 1024) };
  console.log(stats);
  return stats;
}

const ids = process.argv.slice(2);
const all = [];
for (const cfg of CONFIGS) if (!ids.length || ids.includes(cfg.id)) all.push(await buildMap(cfg));
console.table(all);
