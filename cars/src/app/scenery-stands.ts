import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import { addBuilding, type Blocker } from "./scenery-buildings";
import { canvasTex, centerAt, Geo, pick, rng, writeInst, type RoadIndex, type Style, type Tier } from "./scenery-kit";
import { tintGeo, tintMaterial } from "./scenery-props";

function personGeo() {
  const g = new Geo(), t: number[] = [];
  const mark = (v: number) => {
    while (t.length < g.count) t.push(v);
  };
  g.col.set("#ffffff");
  g.box(-0.04, 0.47, 0, 0.22, 0.5, 0.36);
  g.box(-0.04, 0.9, 0, 0.18, 0.08, 0.42);
  mark(1);
  g.col.set("#c69c7c");
  g.box(-0.02, 1.0, 0, 0.1, 0.06, 0.1);
  g.box(-0.02, 1.06, 0, 0.19, 0.2, 0.16);
  g.col.set("#3a2a20");
  g.box(-0.05, 1.2, 0, 0.2, 0.07, 0.17);
  g.col.set("#2a2c33");
  g.box(0.18, 0.4, -0.09, 0.42, 0.13, 0.15);
  g.box(0.18, 0.4, 0.09, 0.42, 0.13, 0.15);
  g.box(0.38, 0, -0.09, 0.11, 0.42, 0.13);
  g.box(0.38, 0, 0.09, 0.11, 0.42, 0.13);
  g.col.set("#c69c7c");
  g.box(0.12, 0.62, -0.23, 0.32, 0.08, 0.08);
  g.box(0.12, 0.62, 0.23, 0.32, 0.08, 0.08);
  mark(0);
  return tintGeo(g, t);
}

function chainTexture() {
  const t = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(170,175,180,1)";
    g.lineWidth = 2;
    g.beginPath();
    for (let k = -128; k <= 128; k += 16) {
      g.moveTo(k, 0);
      g.lineTo(k + 128, 128);
      g.moveTo(k + 128, 0);
      g.lineTo(k, 128);
    }
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createStands(map: MapData, track: Track, roads: RoadIndex, style: Style, blocker: Blocker, tier: Tier, facade: Geo) {
  const group = new THREE.Group();
  group.name = "stands";
  const r = rng(map.center.length * 3 + 1);
  const N = map.center.length / 3;
  const pos = new THREE.Vector3(), left = new THREE.Vector3(), pos2 = new THREE.Vector3(), left2 = new THREE.Vector3();
  const tunnel = new Uint8Array(N);
  for (const [a, b] of map.tunnels) for (let i = a; i <= b && i < N; i++) tunnel[i] = 1;
  const edgeOff = (i: number) => map.width[i] / 2 + map.runoff[i];
  const wrap = (i: number) => (map.closed ? ((i % N) + N) % N : Math.max(0, Math.min(N - 1, i)));
  const g = new Geo();
  const disposables: { dispose(): void }[] = [];
  const people: number[] = [];

  const clear = (i0: number, i1: number, s: number, o0: number, o1: number) => {
    for (let i = i0; i <= i1; i += 2) {
      const j = wrap(i);
      if (tunnel[j]) return false;
      centerAt(map, j, pos, left);
      for (const o of [o0, (o0 + o1) / 2, o1]) {
        const x = pos.x + left.x * (edgeOff(j) + o) * s, z = pos.z + left.z * (edgeOff(j) + o) * s;
        if (roads.edge(x, z) < 1 || blocker.blocked(x, z)) return false;
      }
    }
    return true;
  };

  const seatCols = ["#1f4fa0", "#c8c8c8", "#b3232a", "#1f4fa0", "#e0b62a"];
  function grandstand(i0: number, i1: number, s: number) {
    const rows = 14, depth = 0.85, rise = 0.5, gap = 3.5;
    let y0 = -1e9;
    for (let i = i0; i <= i1; i++) y0 = Math.max(y0, map.center[wrap(i) * 3 + 1]);
    y0 += 0.4;
    const pt = (p: THREE.Vector3, l: THREE.Vector3, j: number, d: number, y: number) => [p.x + l.x * (edgeOff(j) + gap + d) * s, y, p.z + l.z * (edgeOff(j) + gap + d) * s];
    const seat = pick(r, seatCols);
    const D = rows * depth, top = y0 + rows * rise;
    for (let i = i0; i < i1; i += 2) {
      const a = wrap(i), b = wrap(i + 2);
      centerAt(map, a, pos, left);
      centerAt(map, b, pos2, left2);
      const quad = (d0: number, d1: number, ya: number, yb: number, yc: number, yd: number) => {
        const A = pt(pos, left, a, d0, ya), B = pt(pos2, left2, b, d0, yb), C = pt(pos2, left2, b, d1, yc), Dd = pt(pos, left, a, d1, yd);
        if (s > 0) g.quad(A, B, C, Dd);
        else g.quad(B, A, Dd, C);
      };
      g.col.set("#9c9a95");
      const ga = pt(pos, left, a, 0, 0), gb = pt(pos2, left2, b, 0, 0);
      quad(0, 0, track.heightAt(ga[0], ga[2]) - 1, track.heightAt(gb[0], gb[2]) - 1, y0, y0);
      for (let k = 0; k < rows; k++) {
        const y = y0 + k * rise;
        g.col.set("#8e8c87");
        quad(k * depth, k * depth, y, y, y + rise, y + rise);
        g.col.set(k % 6 === 5 ? "#8e8c87" : seat).multiplyScalar(0.9 + (k % 2) * 0.1);
        const A = pt(pos, left, a, k * depth, y + rise), B = pt(pos2, left2, b, k * depth, y + rise), C = pt(pos2, left2, b, (k + 1) * depth, y + rise), Dd = pt(pos, left, a, (k + 1) * depth, y + rise);
        if (s > 0) g.quad(A, B, C, Dd);
        else g.quad(B, A, Dd, C);
        if (k % 6 === 5) continue;
        const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
        for (let d = 0.3; d < len; d += 0.62) {
          if (r() > tier.crowd * 0.9) continue;
          const t = d / len, px = A[0] + (B[0] - A[0]) * t, pz = A[2] + (B[2] - A[2]) * t;
          people.push(px + left.x * s * 0.3, y + rise, pz + left.z * s * 0.3, Math.atan2(left.z * s, -left.x * s) + (r() - 0.5) * 0.4);
        }
      }
      g.col.set("#b8b6b0");
      quad(D, D, y0 - 6, y0 - 6, top + 4, top + 4);
      g.col.set("#e8e8e6");
      const ra = pt(pos, left, a, -1.5, top + 3.4), rb = pt(pos2, left2, b, -1.5, top + 3.4), rc = pt(pos2, left2, b, D + 0.3, top + 4.2), rd = pt(pos, left, a, D + 0.3, top + 4.2);
      if (s > 0) (g.quad(ra, rb, rc, rd), g.quad(rd, rc, rb, ra));
      else (g.quad(rb, ra, rd, rc), g.quad(rc, rd, ra, rb));
      if (((i - i0) / 2) % 2 === 0) {
        const c = pt(pos, left, a, -1.2, 0);
        g.col.set("#d0d0cc");
        g.box(c[0], y0, c[2], 0.3, top + 3.4 - y0, 0.3);
      }
    }
    for (const [j, l, p, flip] of [[wrap(i0), left, pos, 1], [wrap(i1), left2, pos2, -1]] as const) {
      centerAt(map, j, p, l);
      const A = pt(p, l, j, 0, y0), B = pt(p, l, j, D, y0), C = pt(p, l, j, D, top + 4), Dd = pt(p, l, j, 0, y0 + rise);
      g.col.set("#b8b6b0");
      if (flip * s > 0) g.quad(B, A, Dd, C);
      else g.quad(A, B, C, Dd);
    }
  }

  const st = map.start;
  const sideOf = r() < 0.5 ? 1 : -1;
  let placed = 0;
  for (let k = 0; k < 12 && placed < style.stands; k++) {
    const i0 = st - 18 + (k >> 1) * 26 * (k % 4 < 2 ? 1 : -1), s = k % 2 ? -sideOf : sideOf;
    const len = 14 + Math.floor(r() * 8);
    if (!clear(i0, i0 + len, s, 3, 16)) continue;
    grandstand(i0, i0 + len, s);
    placed++;
  }

  if (style.pit) {
    for (let k = 0; k < 6; k++) {
      const s = k % 2 ? sideOf : -sideOf, o = 14 + (k >> 1) * 8;
      const a = wrap(st - 25), b = wrap(st + 25);
      if (!clear(st - 25, st + 25, s, o, o + 16)) continue;
      centerAt(map, a, pos, left);
      centerAt(map, b, pos2, left2);
      const P = (p: THREE.Vector3, l: THREE.Vector3, j: number, d: number) => [p.x + l.x * (edgeOff(j) + d) * s, p.z + l.z * (edgeOff(j) + d) * s];
      const pts = [...P(pos, left, a, o), ...P(pos2, left2, b, o), ...P(pos2, left2, b, o + 16), ...P(pos, left, a, o + 16)];
      let lo = 1e9, hi = -1e9;
      for (let q = 0; q < 4; q++) {
        const y = track.heightAt(pts[q * 2], pts[q * 2 + 1]);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      addBuilding(facade, pts, lo - 0.5, hi + 9, 5, "#e4e4e0", r(), { roof: "#5a5d62", cornice: true, trim: "#d8d8d4" });
      break;
    }
  }

  const fenceIdx: number[] = [];
  if (style.fence)
    for (let i = 0; i < N - (map.closed ? 0 : 1); i++) {
      if (tunnel[i] || tunnel[wrap(i + 1)]) continue;
      const near = Math.abs(((i - st + N + N / 2) % N) - N / 2) < 90;
      if (map.id === "monaco" || near) fenceIdx.push(i);
    }
  let fenceMat: THREE.MeshStandardMaterial | null = null;
  if (fenceIdx.length && tier.detail >= 1) {
    const chain = chainTexture();
    fenceMat = new THREE.MeshStandardMaterial({ map: chain, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.8, roughness: 0.4, color: "#8a8e92" });
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: chain, alphaTest: 0.5 });
    const p: number[] = [], uv: number[] = [], nrm: number[] = [];
    let u = 0;
    for (const i of fenceIdx) {
      const j = wrap(i + 1);
      centerAt(map, i, pos, left);
      centerAt(map, j, pos2, left2);
      const seg = pos.distanceTo(pos2);
      for (const s of [-1, 1]) {
        const o1 = edgeOff(i) + 0.25, o2 = edgeOff(j) + 0.25;
        const A = [pos.x + left.x * o1 * s, pos.y + 1.0, pos.z + left.z * o1 * s], B = [pos2.x + left2.x * o2 * s, pos2.y + 1.0, pos2.z + left2.z * o2 * s];
        const C = [B[0] - left2.x * 0.7 * s, pos2.y + 4.4, B[2] - left2.z * 0.7 * s], D = [A[0] - left.x * 0.7 * s, pos.y + 4.4, A[2] - left.z * 0.7 * s];
        for (const V of [A, B, C, A, C, D]) p.push(V[0], V[1], V[2]);
        const U0 = u / 0.9, U1 = (u + seg) / 0.9, V1 = 3.4 / 0.9;
        uv.push(U0, 0, U1, 0, U1, V1, U0, 0, U1, V1, U0, V1);
        for (let k = 0; k < 6; k++) nrm.push(-left.x * s, 0.2, -left.z * s);
        if (i % 3 === 0) {
          g.col.set("#55595e");
          g.box(A[0], pos.y + 0.6, A[2], 0.12, 3.9, 0.12);
        }
      }
      u += seg;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    fg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    fg.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    fg.computeBoundingSphere();
    const fm = new THREE.Mesh(fg, fenceMat);
    fm.castShadow = true;
    fm.customDepthMaterial = depthMat;
    group.add(fm);
    disposables.push(fg, fenceMat, depthMat, chain);
    const banners = ["#1f4fa0", "#b3232a", "#f2f2f2", "#1b1b1b", "#2a7a3a", "#e0b62a"];
    for (let k = 0; k < fenceIdx.length; k += 6) {
      const i = fenceIdx[k];
      if (Math.abs(((i - st + N + N / 2) % N) - N / 2) > 60 || r() > 0.7) continue;
      const s = r() < 0.5 ? -1 : 1;
      const c1 = pick(r, banners), c2 = pick(r, banners);
      for (let q = 0; q < 3; q++) {
        const a = wrap(i + q), b = wrap(i + q + 1);
        centerAt(map, a, pos, left);
        centerAt(map, b, pos2, left2);
        const o1 = edgeOff(a) + 0.18, o2 = edgeOff(b) + 0.18;
        const A = [pos.x + left.x * o1 * s, pos.y + 1.05, pos.z + left.z * o1 * s], B = [pos2.x + left2.x * o2 * s, pos2.y + 1.05, pos2.z + left2.z * o2 * s];
        const up = (V: number[], h: number) => [V[0], V[1] + h, V[2]];
        g.col.set(c1);
        if (s > 0) g.quad(B, A, up(A, 0.9), up(B, 0.9));
        else g.quad(A, B, up(B, 0.9), up(A, 0.9));
        g.col.set(c2);
        if (s > 0) g.quad(up(B, 0.6), up(A, 0.6), up(A, 0.75), up(B, 0.75));
        else g.quad(up(A, 0.6), up(B, 0.6), up(B, 0.75), up(A, 0.75));
      }
    }
  }

  if (style.soundWall)
    for (let i = 0; i < N - (map.closed ? 0 : 1); i++) {
      const j = wrap(i + 1);
      if (tunnel[i] || tunnel[j]) continue;
      centerAt(map, i, pos, left);
      centerAt(map, j, pos2, left2);
      for (const s of [-1, 1]) {
        const o1 = edgeOff(i) + 0.35, o2 = edgeOff(j) + 0.35;
        const A = [pos.x + left.x * o1 * s, pos.y + 0.9, pos.z + left.z * o1 * s], B = [pos2.x + left2.x * o2 * s, pos2.y + 0.9, pos2.z + left2.z * o2 * s];
        const up = (V: number[], h: number) => [V[0], V[1] + h, V[2]];
        g.col.set(i % 2 ? "#9da59f" : "#959d97");
        g.quad(A, B, up(B, 2.2), up(A, 2.2));
        g.quad(B, A, up(A, 2.2), up(B, 2.2));
        g.col.set("#6f8a92");
        g.quad(up(A, 2.2), up(B, 2.2), up(B, 3.1), up(A, 3.1));
        g.quad(up(B, 2.2), up(A, 2.2), up(A, 3.1), up(B, 3.1));
        if (i % 2 === 0) {
          g.col.set("#5d625f");
          g.box(A[0], A[1] - 0.1, A[2], 0.2, 3.3, 0.2);
        }
      }
    }

  if (g.count) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g.build(false), mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    disposables.push(m.geometry, mat);
  }
  if (people.length) {
    const mat = tintMaterial("crowd", 0.12);
    const n = people.length / 4;
    const m = new THREE.InstancedMesh(personGeo(), mat, n);
    const shirts = ["#d8d8d8", "#202226", "#b3232a", "#1f4fa0", "#e0b62a", "#2a7a3a", "#f2f2f2", "#7a7f86", "#e06a1a", "#3a2a5a"];
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      writeInst(m.instanceMatrix.array as Float32Array, k, people[k * 4], people[k * 4 + 1], people[k * 4 + 2], people[k * 4 + 3], 0.95 + r() * 0.12);
      m.setColorAt(k, c.set(pick(r, shirts)));
    }
    m.computeBoundingSphere();
    m.castShadow = tier.detail >= 2;
    group.add(m);
    disposables.push(m.geometry, mat);
  }
  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
