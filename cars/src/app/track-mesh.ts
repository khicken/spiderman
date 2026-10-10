import * as THREE from "three";
import { FOG_C } from "./render-chunks";
import { cancelJob, runNow, runSoon } from "./render-shared";
import type { Quality, Track, TrackMesh } from "./contracts";
import { CURB_W, F_CURBL, F_CURBR, F_ELEV, F_TUNNEL, F_GRAVL, F_GRAVR, VERGE, curbLift, trackTables, type TrackTables } from "./track";
import { TEX, groundMaterial, gravelMaterial, roadMaterial, type GroundUniforms, type RoadUniforms } from "./track-mat";
import { buildProps } from "./track-props";
import { Rib, lat, rowList, shoulderY } from "./track-rib";
import { buildTerrain } from "./track-terrain";
import { concreteTex } from "./track-tex";

const DETAIL: Record<Quality, { row: number; cols: number; blend: number }> = {
  low: { row: 2, cols: 2, blend: 2 },
  medium: { row: 2, cols: 4, blend: 3 },
  high: { row: 1, cols: 6, blend: 4 },
  ultra: { row: 1, cols: 8, blend: 6 },
};

function roadGeo(tb: TrackTables, rows: number[], line: Float32Array, cols: number) {
  const r = new Rib(cols + 1);
  const dark = new Float32Array(tb.M);
  for (let i = 0; i < tb.M; i++) if (tb.flag[i] & F_TUNNEL) for (let k = -12; k <= 12; k++) dark[(i + k + tb.M) % tb.M] += 1 / 25;
  for (const k of rows) {
    const i = k % tb.M, s = k * tb.h, hw = tb.hw[i];
    for (let c = 0; c <= cols; c++) {
      const u = hw - (2 * hw * c) / cols, l = lat(tb, i, u);
      r.v(tb.px[i] + tb.lx[i] * l, tb.py[i] + tb.ly[i] * l, tb.pz[i] + tb.lz[i] * l, u, s);
      r.nor.push(tb.ux[i], tb.uy[i], tb.uz[i]);
      r.info.push(hw, line[i], Math.min(1, dark[i]));
    }
    r.row();
  }
  return r.geo();
}

// Verge and shoulder down to the terrain on each side, with a skirt under the outer edge.
function shoulderGeo(tb: TrackTables, rows: number[], blend: number) {
  const out: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const ds: number[] = [0, VERGE];
    for (let k = 1; k <= blend; k++) ds.push(VERGE + k / blend);
    const n = ds.length + 1;
    const r = new Rib(n);
    for (const k of rows) {
      const i = k % tb.M;
      if (tb.flag[i] & (F_ELEV | F_TUNNEL)) { r.brk(); continue; }
      const D = side > 0 ? tb.dL[i] : tb.dR[i];
      const pts: number[] = [];
      for (const f of ds) {
        const d = f <= VERGE ? f : VERGE + (f - VERGE) * D;
        const l = lat(tb, i, side * (tb.hw[i] + d));
        pts.push(tb.px[i] + tb.lx[i] * l, shoulderY(tb, i, side, d), tb.pz[i] + tb.lz[i] * l);
      }
      const o = pts.length - 3;
      const sk = [pts[o], pts[o + 1] - 1.2, pts[o + 2]];
      const all = side > 0 ? [...sk, ...[...Array(ds.length)].flatMap((_, j) => pts.slice((ds.length - 1 - j) * 3, (ds.length - j) * 3))] : [...pts, ...sk];
      for (let c = 0; c < n; c++) r.v(all[c * 3], all[c * 3 + 1], all[c * 3 + 2], 0, 0);
      r.row();
    }
    const g = r.geo();
    if (g) out.push(g);
  }
  return out;
}

function curbGeo(tb: TrackTables, closed: boolean) {
  const W = CURB_W;
  const prof = [0, 0.25 * W, 0.85 * W, W, W];
  const r = new Rib(prof.length);
  const red = [0.62, 0.04, 0.03], white = [0.86, 0.86, 0.84];
  const end = closed ? tb.M : tb.M - 1;
  for (const side of [1, -1]) {
    const f = side > 0 ? F_CURBL : F_CURBR;
    for (let k = 0; k < end; k++) {
      const i = k % tb.M, j = (k + 1) % tb.M;
      if (!(tb.flag[i] & f) || !(tb.flag[j] & f)) continue;
      const c = Math.floor(k / 1.5) % 2 ? red : white;
      r.brk();
      for (const q of [i, j]) {
        const ord = side > 0 ? [...prof.keys()].reverse() : [...prof.keys()];
        for (const p of ord) {
          const d = prof[p];
          const l = lat(tb, q, side * (tb.hw[q] + d));
          const y = tb.py[q] + side * tb.hw[q] * tb.ly[q] + (p === prof.length - 1 ? -0.08 : curbLift(Math.min(d, W - 1e-3)) + 0.004);
          r.v(tb.px[q] + tb.lx[q] * l, y, tb.pz[q] + tb.lz[q] * l, 0, 0);
          r.col.push(...c);
        }
        r.row();
      }
    }
  }
  return r.geo();
}

function gravelGeo(tb: TrackTables, rows: number[]) {
  const r = new Rib(4);
  for (const side of [1, -1]) {
    const f = side > 0 ? F_GRAVL : F_GRAVR;
    r.brk();
    for (const k of rows) {
      const i = k % tb.M;
      const d0 = CURB_W + 0.5, d1 = tb.run[i] - 1;
      if (!(tb.flag[i] & f) || d1 < d0 + 2) { r.brk(); continue; }
      const ds = [0, 1, 2, 3].map((c) => d0 + ((d1 - d0) * c) / 3);
      if (side > 0) ds.reverse();
      for (const d of ds) {
        const l = lat(tb, i, side * (tb.hw[i] + d));
        const x = tb.px[i] + tb.lx[i] * l, z = tb.pz[i] + tb.lz[i] * l;
        r.v(x, shoulderY(tb, i, side, d) + 0.03, z, x, z);
      }
      r.row();
    }
  }
  return r.geo();
}

function sidewalkGeo(tb: TrackTables, rows: number[]) {
  const r = new Rib(4, true);
  for (const side of [1, -1]) {
    r.brk();
    for (const k of rows) {
      const i = k % tb.M;
      if (tb.flag[i] & F_ELEV) { r.brk(); continue; }
      const d0 = tb.run[i] + 0.45;
      const inner = tb.curv[i] * side > 0 ? 0.9 / Math.abs(tb.curv[i]) - tb.hw[i] : Infinity;
      const d1 = Math.min(d0 + 3.2, inner);
      if (d1 < d0 + 0.5) { r.brk(); continue; }
      const p = (d: number, dy: number) => {
        const l = lat(tb, i, side * (tb.hw[i] + d));
        const x = tb.px[i] + tb.lx[i] * l, z = tb.pz[i] + tb.lz[i] * l;
        return [x, shoulderY(tb, i, side, d) + dy, z] as const;
      };
      const a = p(d0, -0.1), b = p(d0, 0.15), c = p(d0, 0.15), d = p(d1, 0.15);
      const seq = side > 0 ? [b, a, d, c] : [a, b, c, d];
      for (const q of seq) r.v(q[0], q[1], q[2], q[0], q[2]);
      r.row();
    }
  }
  return r.geo();
}

export function createTrackMesh(track: Track, quality: Quality): TrackMesh {
  const tb = trackTables(track);
  const group = new THREE.Group();
  group.name = "track";
  const wet = { value: 0 };
  const style = tb.style;
  const ru: RoadUniforms = {
    uWet: wet,
    uStart: { value: tb.startS },
    uLen: { value: track.length },
    uClosed: { value: track.closed ? 1 : 0 },
    uMarks: { value: style.marks === "circuit" ? 0 : style.marks === "tokyo" ? 2 : track.map.id === "sanfrancisco" ? 3 : 1 },
    uWear: { value: style.circuit ? 1 : 0.5 },
    uSheen: { value: track.map.id === "tokyo" ? 0.85 : style.urban ? 0.5 : 0 },
  };
  const env = track.map.env;
  const gu: GroundUniforms = {
    uWet: wet,
    uSnowLine: { value: track.map.id === "stelvio" ? 2820 : 1e5 },
    uAlpine: { value: track.map.id === "stelvio" ? 2150 : 1e5 },
    uAutumn: { value: env.season === "autumn" ? 1 : 0 },
    uWinter: { value: env.season === "winter" ? 1 : 0 },
  };
  let disposables: { dispose(): void }[] = [];
  let lo = Infinity;
  for (const h of track.map.terrain.h) lo = Math.min(lo, h);
  FOG_C[3] = track.map.water.length ? Math.max(track.map.waterY, lo) : lo;

  // Builds into a staging group, then swaps, so a quality switch can run across frames.
  function* build(q: Quality): Generator<void, void> {
    const det = DETAIL[q];
    const rows = rowList(tb, track.closed, det.row);
    const out = new THREE.Group();
    const own: { dispose(): void }[] = [];
    const add = (g: THREE.BufferGeometry | null, m: THREE.Material, name: string, cast = false) => {
      if (!g) return;
      const mesh = new THREE.Mesh(g, m);
      mesh.name = name;
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      out.add(mesh);
      own.push(g);
    };
    const road = roadMaterial(q, ru);
    yield;
    const ground = groundMaterial(q, gu, -1);
    yield;
    const gravel = gravelMaterial(q);
    const curb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    own.push(road.mat, ...road.tex, ground.mat, ground.strip, ...ground.tex, gravel.mat, gravel.tex, curb);
    add(roadGeo(tb, rows, track.line, det.cols), road.mat, "road");
    for (const g of shoulderGeo(tb, rows, det.blend)) add(g, ground.strip, "shoulder");
    if (style.circuit) add(curbGeo(tb, track.closed), curb, "curbs");
    add(gravelGeo(tb, rows), gravel.mat, "gravel");
    if (style.urban) {
      const t = concreteTex(TEX[q].ground, TEX[q].aniso, false);
      t.repeat.set(1 / 3, 1 / 3);
      const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, color: 0xc8c4bc });
      own.push(t, m);
      add(sidewalkGeo(tb, rows), m, "sidewalk");
    }
    yield;
    for (const g of buildTerrain(track, q)) add(g, ground.mat, "terrain");
    yield;
    const props = buildProps(track, q, wet);
    out.add(props.group);
    own.push(props);
    clear();
    group.add(...out.children);
    disposables = own;
  }

  const clear = () => {
    for (const d of disposables) d.dispose();
    disposables = [];
    group.clear();
  };
  let job: Generator<void, void> | null = null;
  runNow(build(quality));
  return {
    group,
    setWet: (w) => void (wet.value = w),
    setQuality: (q) => {
      cancelJob(job);
      job = runSoon(build(q));
    },
    dispose: () => {
      cancelJob(job);
      clear();
    },
  };
}
