import * as THREE from "three";
import { LANDMARKS, RIVER } from "./contracts";
import { PAL, Mesher, rng, groundMin, groundMax, glowMat, haloSprite, vcMat2, clamp, lerp } from "./landmark-kit";
import type { PrimOpts, SiteEnv, SiteInfo } from "./landmark-kit";

const OWNER = "landmarks:village";

type Map2 = (a: number, b: number) => [number, number];
type Tag = "solid" | "climbable";
type Style = "stone" | "timber" | "collapse";

const PLASTER = ["#d9c79b", "#cdb98a", "#d4c08f"];
const ROOFS = ["#b39656", "#9b4a35", "#6b5038"];
const COLD = "#8d9190";

// Mirebrook Ruin. Everything is laid out in a river frame (t along the river, n across it) and snapped to world axes,
// because colliders are AABBs: houses, the mill and the footbridges are all axis aligned.
export function buildVillage(env: SiteEnv): SiteInfo {
  const { world, look, group, reg } = env;
  const L = LANDMARKS.find((l) => l.id === "village")!;
  const vx = L.x, vz = L.z;
  const R = rng(9137);
  const H = (x: number, z: number) => world.heightAt(x, z);
  const S = new Mesher(21), E = new Mesher(22), C = new Mesher(23), Wm = new Mesher(24);

  const rv = { d: 0, w: 0, px: 0, pz: 0, tx: 1, tz: 0 };
  const near = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < RIVER.length - 1; i++) {
      const a = RIVER[i], b = RIVER[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        const l = Math.sqrt(l2);
        rv.d = d; rv.w = lerp(a.w, b.w, t); rv.px = px; rv.pz = pz; rv.tx = dx / l; rv.tz = dz / l;
      }
    }
    return rv;
  };
  near(vx, vz);
  const Px = rv.px, Pz = rv.pz, Tx = rv.tx, Tz = rv.tz;
  let Nx = -Tz, Nz = Tx;
  if ((vx - Px) * Nx + (vz - Pz) * Nz < 0) { Nx = -Nx; Nz = -Nz; }
  const loc = (t: number, n: number): [number, number] => [Px + Tx * t + Nx * n, Pz + Tz * t + Nz * n];

  const occ: [number, number, number, number][] = [];
  const free = (x0: number, z0: number, x1: number, z1: number, m: number) =>
    !occ.some((o) => x0 - m < o[2] && x1 + m > o[0] && z0 - m < o[3] && z1 + m > o[1]);
  const take = (x0: number, z0: number, x1: number, z1: number) => { occ.push([x0, z0, x1, z1]); };
  const ringOK = (x0: number, z0: number, x1: number, z1: number, r: number) =>
    Math.hypot(clamp(vx, x0, x1) - vx, clamp(vz, z0, z1) - vz) >= r;
  const riverOK = (x0: number, z0: number, x1: number, z1: number, minC: number, minK: number) => {
    if (near((x0 + x1) / 2, (z0 + z1) / 2).d < minC) return false;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) if (near(x, z).d < minK) return false;
    return true;
  };
  const faceOf = (x: number, z: number): [number, number] => {
    const dx = vx - x, dz = vz - z;
    return Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
  };
  const find = (t0: number, n0: number, test: (x: number, z: number) => boolean): [number, number] | null => {
    for (let a = 0; a < 60; a++) {
      const t = t0 + (a ? (R() - 0.5) * a * 1.1 : 0);
      const n = n0 + (a ? Math.sign(n0 || 1) * R() * a * 0.5 + (R() - 0.5) * 2 : 0);
      const p = loc(t, n);
      if (test(p[0], p[1])) return p;
    }
    return null;
  };

  const ID: Map2 = (a, b) => [a, b];
  const rect = (m: Map2, a0: number, b0: number, a1: number, b1: number): [number, number, number, number] => {
    const p = m(a0, b0), q = m(a1, b1);
    return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
  };
  const vis = (m: Map2, a0: number, b0: number, a1: number, b1: number, y0: number, y1: number, color: string, o?: PrimOpts, mesher: Mesher = S) => {
    const r = rect(m, a0, b0, a1, b1);
    mesher.aabb(r[0], y0, r[1], r[2], y1, r[3], color, o);
  };
  const coll = (m: Map2, a0: number, b0: number, a1: number, b1: number, y0: number, y1: number, tag: Tag = "solid") => {
    const r = rect(m, a0, b0, a1, b1);
    world.addBox({ minX: r[0], maxX: r[2], minZ: r[1], maxZ: r[3], minY: y0, maxY: y1, tag, owner: OWNER });
  };
  const stoneCols = [PAL.rock, PAL.rockHi, PAL.rockLo, PAL.ashHi, PAL.rock, PAL.mossLo];

  // Courses of hand-laid blocks; one collider for the whole piece.
  const masonry = (m: Map2, a0: number, b0: number, a1: number, b1: number, y0: number, y1: number, tag: Tag | null, ragged = false, pal = stoneCols, course = 0.55) => {
    const alongA = a1 - a0 >= b1 - b0;
    const lo = alongA ? a0 : b0, len = alongA ? a1 - a0 : b1 - b0;
    let y = y0;
    while (y < y1 - 0.02) {
      const h = Math.min(course * (0.85 + R() * 0.3), y1 - y);
      const last = y + h >= y1 - 0.02;
      const n = Math.max(1, Math.round(len / 1.5));
      const cuts = [0];
      for (let i = 1; i < n; i++) cuts.push((i + (R() - 0.5) * 0.5) / n);
      cuts.push(1);
      for (let i = 0; i < n; i++) {
        const s0 = lo + len * cuts[i], s1 = lo + len * cuts[i + 1], ins = R() * 0.05;
        const hh = last && ragged ? h * (0.45 + 0.55 * R()) : h;
        const c = pal[(R() * pal.length) | 0];
        if (alongA) vis(m, s0, b0 + ins, s1, b1 - ins, y, y + hh, c, { jit: 0.06, ao: 0.1 });
        else vis(m, a0 + ins, s0, a1 - ins, s1, y, y + hh, c, { jit: 0.06, ao: 0.1 });
      }
      y += h;
    }
    if (tag) coll(m, a0, b0, a1, b1, y0, y1, tag);
  };

  const timberWall = (m: Map2, a0: number, b0: number, a1: number, b1: number, y0: number, y1: number, tag: Tag | null) => {
    const base = y0 + 0.85;
    masonry(m, a0, b0, a1, b1, y0, Math.min(base, y1), null);
    if (y1 - base > 0.1) {
      const alongA = a1 - a0 >= b1 - b0;
      const lo = alongA ? a0 : b0, len = alongA ? a1 - a0 : b1 - b0;
      const pc = PLASTER[(R() * PLASTER.length) | 0];
      if (alongA) vis(m, a0, b0 + 0.1, a1, b1 - 0.1, base, y1, pc, { ao: 0.05 });
      else vis(m, a0 + 0.1, b0, a1 - 0.1, b1, base, y1, pc, { ao: 0.05 });
      const np = Math.max(2, Math.ceil(len / 1.3) + 1);
      for (let i = 0; i < np; i++) {
        const s = lo + (len * i) / (np - 1), c0 = s - 0.1, c1 = s + 0.1;
        const top = y1 - (R() < 0.3 ? R() * 0.3 : 0);
        if (alongA) vis(m, clamp(c0, a0, a1), b0, clamp(c1, a0, a1), b1, base, top, PAL.woodLo);
        else vis(m, a0, clamp(c0, b0, b1), a1, clamp(c1, b0, b1), base, top, PAL.woodLo);
      }
      for (const yy of [base, y1 - 0.2]) {
        if (alongA) vis(m, a0, b0 - 0.02, a1, b1 + 0.02, yy, yy + 0.2, PAL.wood);
        else vis(m, a0 - 0.02, b0, a1 + 0.02, b1, yy, yy + 0.2, PAL.wood);
      }
      if (len > 1.6 && y1 - base > 1.2) {
        const bm = (s: number, y: number): [number, number, number] => {
          const p = alongA ? m(s, (b0 + b1) / 2) : m((a0 + a1) / 2, s);
          return [p[0], y, p[1]];
        };
        const p = bm(lo + 0.15, base + 0.2), q = bm(lo + len * 0.5, y1 - 0.2);
        S.beam(p[0], p[1], p[2], q[0], q[1], q[2], 0.14, PAL.wood);
      }
    }
    if (tag) coll(m, a0, b0, a1, b1, y0, y1, tag);
  };

  const MH = 8.5;
  let mx = vx, mz = vz;
  {
    let ok = false;
    for (const t of [-10, -12, -8, -14, -6, -16, -4, 4, 8, 12, 16, -18]) {
      const p = loc(t, 12);
      const x0 = p[0] - 3.5, x1 = p[0] + 3.5, z0 = p[1] - 3.5, z1 = p[1] + 3.5;
      const dc = near(p[0], p[1]).d;
      if (dc < 9.4 || dc > 13 || !riverOK(x0, z0, x1, z1, 9, 7.2) || !ringOK(x0, z0, x1, z1, 7) || Math.hypot(p[0] - vx, p[1] - vz) > 36) continue;
      mx = p[0]; mz = p[1]; ok = true;
      break;
    }
    if (!ok) { const p = loc(-10, 12); mx = p[0]; mz = p[1]; }
  }
  const mfl = groundMax(world, mx, mz, 3.5, 3.5);
  const myb = groundMin(world, mx, mz, 3.5, 3.5) - 0.4;
  const mtop = mfl + MH;
  const dvx = vx - mx, dvz = vz - mz;
  const [ux, uz]: [number, number] = Math.abs(dvx) > Math.abs(dvz) ? [Math.sign(dvx) || 1, 0] : [0, Math.sign(dvz) || 1];
  const vxm = -uz, vzm = ux;
  const mm: Map2 = (a, b) => [mx + ux * a + vxm * b, mz + uz * a + vzm * b];
  take(mx - 4.5, mz - 4.5, mx + 4.5, mz + 4.5);

  const wp = near(mx, mz);
  const toR = [wp.px - mx, wp.pz - mz];
  const axes: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const rl = Math.hypot(toR[0], toR[1]) || 1;
  const wheelDir = axes
    .filter((a) => !(a[0] === ux && a[1] === uz))
    .sort((a, b) => (b[0] * toR[0] + b[1] * toR[1]) / rl - (a[0] * toR[0] + a[1] * toR[1]) / rl)[0];
  take(mx + wheelDir[0] * 6 - 3, mz + wheelDir[1] * 6 - 3, mx + wheelDir[0] * 6 + 3, mz + wheelDir[1] * 6 + 3);

  masonry(mm, -3.5, -3.5, -2.5, 3.5, myb, mtop, "climbable", false, stoneCols, 0.7);
  masonry(mm, -2.5, -3.5, 2.5, -2.5, myb, mtop, "climbable", false, stoneCols, 0.7);
  masonry(mm, -2.5, 2.5, 0.9, 3.5, myb, mtop, "climbable", false, stoneCols, 0.7);
  masonry(mm, 0.9, 2.5, 2.5, 3.5, myb, mfl + 5.0, "climbable", true, stoneCols, 0.7);
  masonry(mm, 2.5, -3.5, 3.5, -1.1, myb, mtop, "climbable", false, stoneCols, 0.7);
  masonry(mm, 2.5, 1.1, 3.5, 1.9, myb, mtop, "climbable", false, stoneCols, 0.7);
  masonry(mm, 2.5, 1.9, 3.5, 2.7, myb, mfl + 6.6, "climbable", true, stoneCols, 0.7);
  masonry(mm, 2.5, 2.7, 3.5, 3.5, myb, mfl + 5.2, "climbable", true, stoneCols, 0.7);
  masonry(mm, 2.5, -1.1, 3.5, 1.1, mfl + 2.6, mtop, "climbable", false, stoneCols, 0.7);
  vis(mm, 2.35, -1.45, 3.65, 1.45, mfl + 2.6, mfl + 3.2, PAL.woodLo, { jit: 0.03 });
  vis(mm, 2.5, -1.1, 3.5, -0.85, mfl, mfl + 2.6, PAL.wood);
  vis(mm, 2.5, 0.85, 3.5, 1.1, mfl, mfl + 2.6, PAL.wood);
  vis(mm, -2.5, -2.5, 2.5, 2.5, mfl, mfl + 0.08, "#7c7262", { ao: 0 });
  vis(mm, 3.5, -1.5, 4.3, 1.5, mfl, mfl + 0.2, PAL.rockHi);
  vis(mm, 4.3, -1.3, 4.9, 1.3, mfl, mfl + 0.1, PAL.rock);
  for (const [a, b, y] of [[-3.53, 0, 4.5], [0, -3.53, 5.0], [-1.2, 3.53, 4.4]] as const) {
    vis(mm, a - (a === -3.53 ? 0.03 : 0.25), b - (b === 0 ? 0.25 : 0.03), a + (a === -3.53 ? 0 : 0.25), b + (b === 0 ? 0.25 : 0), mfl + y, mfl + y + 1.2, PAL.ink, { ao: 0, jit: 0 });
  }
  const apex = mtop + 3.8;
  const corners: [number, number][] = [[-3, -3], [-3, 3], [3, -3]];
  for (const [a, b] of corners) {
    const p = mm(a, b), q = mm(0, 0);
    S.beam(p[0], mtop, p[1], q[0], apex, q[1], 0.3, PAL.woodLo);
    const e = mm(a * 0.55, b * 0.55);
    S.beam(e[0], mtop + 2.1, e[1], mm(a * 0.55, -b * 0.55)[0], mtop + 2.1, mm(a * 0.55, -b * 0.55)[1], 0.16, PAL.wood);
  }
  for (const [a0, b0, a1, b1] of [[-3, -3, 3, -3], [3, -3, 3, -1.2], [-3, -3, -3, -0.8], [-3, 0.8, -3, 3], [-3, 3, 0.4, 3]] as const) {
    const p = mm(a0, b0), q = mm(a1, b1);
    S.beam(p[0], mtop + 0.12, p[1], q[0], mtop + 0.12, q[1], 0.26, PAL.woodLo);
  }
  const kp = mm(0, 0);
  S.beam(kp[0], apex, kp[1], kp[0], apex - 1.5, kp[1], 0.24, PAL.woodLo);
  for (const a of [-1.8, 0.4]) {
    const p = mm(a, -2.5), q = mm(a, 2.5);
    S.beam(p[0], mtop - 1.6, p[1], q[0], mtop - 1.6, q[1], 0.32, PAL.woodLo);
  }
  vis(mm, -2.5, -2.5, -1.0, 2.5, mtop - 1.45, mtop - 1.33, PAL.wood, { jit: 0.08 });
  {
    const sp = mm(-3, 0);
    S.cyl(sp[0], mtop, sp[1], 0.5, 0.45, 0.07, PAL.gold, 8, 0, { ao: 0, jit: 0.02 });
    reg.shard({ id: "shard-mill", x: sp[0], y: mtop + 1.1, z: sp[1] });
    const cp = mm(0, -3);
    reg.cluster({ x: cp[0], y: mtop + 0.9, z: cp[1], n: 4, spread: 0.9 });
  }
  const ms = mm(0.4, -1.5);
  S.cyl(ms[0], mfl + 0.08, ms[1], 1.15, 1.1, 0.42, PAL.rockLo, 12, 0, { jit: 0.03 });
  S.ball(ms[0], mfl + 0.52, ms[1], 0.3, PAL.ink, 0.3, 1);
  for (const [a, b] of [[-2.0, 1.9], [-1.4, 2.0], [-2.1, 1.2]] as const) {
    const p = mm(a, b);
    S.ball(p[0], mfl + 0.35, p[1], 0.42, "#c9b98a", 0.85, 1, R() * 3, { jit: 0.06 });
  }
  {
    const p = mm(-1.9, 0);
    reg.chest({ id: "chest-bow", x: p[0], y: mfl + 0.08, z: p[1], yaw: Math.atan2(ux, uz), reward: { kind: "bow", amount: 15 }, big: true });
  }
  const WR = 2.6;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (const z of [-0.5, 0.5]) Wm.boxc(Math.cos(a) * WR, Math.sin(a) * WR, z, 2 * WR * Math.sin(Math.PI / 12) * 1.04, 0.24, 0.16, PAL.woodLo, 0, { rz: a + Math.PI / 2 });
    if (k % 4 !== 3 || k === 3) Wm.boxc(Math.cos(a) * (WR + 0.2), Math.sin(a) * (WR + 0.2), 0, 0.1, 0.7, 1.15, PAL.woodHi, 0, { rz: a - Math.PI / 2 });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    for (const z of [-0.45, 0.45]) if (!(k === 5 && z > 0)) Wm.beam(0, 0, z, Math.cos(a) * WR, Math.sin(a) * WR, z, 0.15, PAL.wood);
  }
  Wm.beam(0, 0, -1.2, 0, 0, 1.0, 0.5, PAL.woodLo);
  const wheel = Wm.build(look, undefined, "mill-wheel");
  const wcx = mx + wheelDir[0] * 4.15, wcz = mz + wheelDir[1] * 4.15;
  wheel.position.set(wcx, mfl + 2.0, wcz);
  if (wheelDir[0] !== 0) wheel.rotation.y = Math.PI / 2;
  env.own(wheel.geometry);
  group.add(wheel);

  const bridges: { s0: number; s1: number; top: number; pt: Map2 }[] = [];
  const bridge = (pref: "x" | "z", tc: number) => {
    const q = loc(tc, 0);
    near(q[0], q[1]);
    const qx = rv.px, qz = rv.pz;
    const axis = Math.abs(rv.tx) > Math.abs(rv.tz) + 0.08 ? "z" : Math.abs(rv.tz) > Math.abs(rv.tx) + 0.08 ? "x" : pref;
    const fixed = axis === "z" ? qx : qz, s = axis === "z" ? qz : qx;
    const pt: Map2 = (a, b) => (axis === "z" ? [fixed + b, a] : [a, fixed + b]);
    let lo = s, hi = s;
    for (let i = 0; i < 80; i++) {
      const p = pt(lo, 0);
      if (i > 2 && near(p[0], p[1]).d - rv.w / 2 >= 1.0) break;
      lo -= 0.5;
    }
    for (let i = 0; i < 80; i++) {
      const p = pt(hi, 0);
      if (i > 2 && near(p[0], p[1]).d - rv.w / 2 >= 1.0) break;
      hi += 0.5;
    }
    lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
    const r = rect(pt, lo, -2.2, hi, 2.2);
    if (!free(r[0], r[1], r[2], r[3], 2)) return false;
    take(r[0], r[1], r[2], r[3]);
    const pe0 = pt(lo, 0), pe1 = pt(hi, 0);
    const top = Math.max(H(pe0[0], pe0[1]), H(pe1[0], pe1[1])) + 0.2;
    for (const c of [-0.8, 0.8]) {
      const p = pt(lo - 0.3, c), qq = pt(hi + 0.3, c);
      S.beam(p[0], top - 0.4, p[1], qq[0], top - 0.4, qq[1], 0.3, PAL.woodLo);
    }
    for (let a = lo; a < hi - 0.1; a += 0.32) {
      if (R() < 0.05) continue;
      vis(pt, a, -1.3, a + 0.28, 1.3, top - 0.16, top, R() < 0.2 ? PAL.woodLo : R() < 0.5 ? PAL.wood : PAL.woodHi, { jit: 0.07, ao: 0.05 });
    }
    for (let a = lo; a < hi - 0.05; a += 2) coll(pt, a, -1.2, Math.min(a + 2, hi), 1.2, top - 0.4, top);
    const span = hi - lo;
    for (const f of [1 / 3, 2 / 3]) {
      for (const c of [-1.0, 1.0]) {
        const p = pt(lo + span * f, c);
        S.beam(p[0], top - 0.3, p[1], p[0], Math.min(H(p[0], p[1]) - 0.4, top - 1.5), p[1], 0.3, PAL.woodLo);
      }
      const p = pt(lo + span * f, -1.0), qq = pt(lo + span * f, 1.0);
      S.beam(p[0], top - 0.7, p[1], qq[0], top - 1.5, qq[1], 0.14, PAL.wood);
    }
    for (const [end, dir] of [[lo, -1], [hi, 1]] as const) {
      const pe = pt(end, 0), hend = H(pe[0], pe[1]);
      const yb = groundMin(world, pe[0], pe[1], 1.5, 1.5) - 0.6;
      const a0 = dir < 0 ? end - 0.2 : end - 1.2, a1 = dir < 0 ? end + 1.2 : end + 0.2;
      vis(pt, a0, -1.5, a1, 1.5, yb, top - 0.16, PAL.rockLo);
      const D = top - 0.16 - hend;
      const n = clamp(Math.ceil(D / 0.4), 0, 6);
      for (let k = 1; k <= n; k++) {
        const yTop = top - 0.16 - (k * D) / (n + 1);
        const a = dir < 0 ? end - 0.2 - k * 0.9 : end + 0.2 + (k - 1) * 0.9;
        vis(pt, a, -1.5, a + 0.9, 1.5, yb, yTop, PAL.rock);
        coll(pt, a, -1.5, a + 0.9, 1.5, yb, yTop);
      }
    }
    for (const c of [-1.2, 1.2]) {
      const posts: [number, number, number][] = [];
      for (let a = lo + 0.4; a <= hi - 0.3; a += 2) {
        const broken = R() < 0.15, p = pt(a, c);
        const h = broken ? 0.45 : 1.05;
        S.box(p[0], top - 0.1, p[1], 0.14, h + 0.1, 0.14, PAL.woodLo, 0, { rx: (R() - 0.5) * 0.08, rz: (R() - 0.5) * 0.08 });
        posts.push([p[0], p[1], broken ? 0 : 1]);
      }
      for (let i = 0; i + 1 < posts.length; i++) {
        const p = posts[i], qq = posts[i + 1];
        if (!p[2] || !qq[2]) continue;
        for (const hh of [0.55, 0.95]) {
          if (R() < 0.18) continue;
          const droop = R() < 0.12 ? 0.35 : 0;
          S.beam(p[0], top + hh, p[1], qq[0], top + hh - droop, qq[1], 0.07, PAL.wood);
        }
      }
    }
    if (!bridges.length) {
      const mp = pt((lo + hi) / 2, 1.2);
      reg.cluster({ x: mp[0], y: top + 1.4, z: mp[1], n: 3, spread: 0.8 });
    }
    bridges.push({ s0: lo, s1: hi, top, pt });
    return true;
  };
  bridge("z", 14) || bridge("z", 18) || bridge("z", 10);
  bridge("x", -26) || bridge("x", -30) || bridge("x", 28) || bridge("x", -22);

  interface House { x: number; z: number; fx: number; fz: number; hd: number; fl: number; ridge: number }
  const houses: House[] = [];
  const buildHouse = (x: number, z: number, w: number, d: number, style: Style, hasWindow: boolean) => {
    const [fx, fz] = faceOf(x, z);
    const rx = -fz, rz = fx;
    const map: Map2 = (a, b) => [x + rx * a + fx * b, z + rz * a + fz * b];
    const hw = w / 2, hd = d / 2, t = 0.5;
    const fl = H(x, z);
    const yb = groundMin(world, x, z, Math.abs(rx) * hw + Math.abs(fx) * hd, Math.abs(rz) * hw + Math.abs(fz) * hd) - 0.3;
    const WH = 2.7, RH = 1.7;
    const cover = R() < 0.5 ? 1 : -1;
    const doorC = (R() - 0.5) * 1.0, dg = 0.75;
    const wall = (a0: number, b0: number, a1: number, b1: number, h: number, ragged: boolean) => {
      if (h <= 0.05) return;
      if (style === "timber") timberWall(map, a0, b0, a1, b1, yb, fl + h, "solid");
      else masonry(map, a0, b0, a1, b1, yb, fl + h, "solid", ragged);
    };
    const rnd = (lo: number, hi: number) => lo + R() * (hi - lo);

    for (const [b0, b1, sgn] of [[hd - t, hd, 1], [-hd, -hd + t, -1]] as const) {
      const full = sgn === cover;
      if (sgn === 1) {
        wall(-hw, b0, doorC - dg, b1, full ? WH : rnd(0.9, 2.1), !full);
        wall(doorC + dg, b0, hw, b1, full ? WH : rnd(0.9, 2.2), !full);
        if (full) {
          masonry(map, doorC - dg, b0, doorC + dg, b1, fl + 2.35, fl + WH, "solid");
          vis(map, doorC - dg - 0.1, b0 - 0.05, doorC + dg + 0.1, b1 + 0.05, fl + 2.15, fl + 2.45, PAL.woodLo);
        }
      } else {
        const split = rnd(-hw * 0.4, hw * 0.4);
        wall(-hw, b0, split, b1, full ? WH : rnd(1.0, 2.3), !full);
        wall(split, b0, hw, b1, full ? WH : rnd(0.7, 1.8), !full);
      }
      if (full) {
        const c = map(0, (b0 + b1) / 2);
        S.prism(c[0], fl + WH, c[1], w, RH, t, style === "timber" ? PLASTER[0] : PAL.rock, fx !== 0 ? Math.PI / 2 : 0);
      }
    }
    for (const sd of [-1, 1]) {
      const a0 = sd < 0 ? -hw : hw - t, a1 = sd < 0 ? -hw + t : hw;
      const covLo = cover > 0 ? 0 : -hd + t, covHi = cover > 0 ? hd - t : 0;
      const unLo = cover > 0 ? -hd + t : 0, unHi = cover > 0 ? 0 : hd - t;
      if (hasWindow && sd > 0) {
        wall(a0, covLo, a1, covLo + (covHi - covLo) * 0.35, WH, false);
        wall(a0, covLo + (covHi - covLo) * 0.35, a1, covLo + (covHi - covLo) * 0.65, 0.95, false);
        wall(a0, covLo + (covHi - covLo) * 0.65, a1, covHi, WH, false);
        vis(map, a0 - 0.05, covLo + (covHi - covLo) * 0.35, a1 + 0.05, covLo + (covHi - covLo) * 0.65, fl + 2.1, fl + 2.4, PAL.woodLo);
      } else wall(a0, covLo, a1, covHi, WH, false);
      const mid = (unLo + unHi) / 2 + rnd(-0.4, 0.4);
      wall(a0, unLo, a1, mid, rnd(0.8, 2.4), true);
      wall(a0, mid, a1, unHi, rnd(0.5, 2.0), true);
    }
    const roofC = ROOFS[(R() * ROOFS.length) | 0];
    const bc = (cover * (0.2 + hd + 0.4)) / 2;
    const rc = map(0, bc);
    S.prism(rc[0], fl + WH - 0.05, rc[1], w + 1.0, RH + 0.1, hd + 0.2 + 0.4, roofC, fx !== 0 ? Math.PI / 2 : 0, { jit: 0.07 });
    for (let b = cover * 0.2; Math.abs(b) < hd; b -= cover * 0.9) {
      for (const sd of [-1, 1]) {
        if (R() < 0.2) continue;
        const e = map(sd * (hw + 0.3), b), k = map(0, b);
        const f = R() < 0.3 ? 0.6 : 1;
        S.beam(e[0], fl + WH - 0.1, e[1], lerp(e[0], k[0], f), lerp(fl + WH - 0.1, fl + WH + RH, f), lerp(e[1], k[1], f), 0.14, PAL.woodLo);
      }
    }
    {
      const p = map(0, cover * 0.2), q = map(0, -cover * (hd - 0.7));
      S.beam(p[0], fl + WH + RH, p[1], q[0], fl + WH + RH, q[1], 0.2, PAL.woodLo);
    }
    {
      const cb = rnd(-hd * 0.4, hd * 0.4);
      const ch = style === "stone" ? WH + 1.9 : WH + 1.5;
      masonry(map, hw, cb - 0.5, hw + 0.9, cb + 0.5, yb, fl + ch, "solid", true, stoneCols, 0.45);
      vis(map, hw + 0.1, cb - 0.3, hw + 0.7, cb + 0.1, fl + ch, fl + ch + 0.25, PAL.rockLo);
    }
    if (style === "collapse") {
      timberWall(map, -hw, -hd, -hw + t, 0.2, fl + WH, fl + WH + 2.6, null);
      timberWall(map, -hw, -hd, 0.6, -hd + t, fl + WH, fl + WH + 2.6, null);
      coll(map, -hw, -hd, -hw + t, 0.2, fl + WH, fl + WH + 2.6, "solid");
      coll(map, -hw, -hd, 0.6, -hd + t, fl + WH, fl + WH + 2.6, "solid");
      for (let b = -hd + 0.3; b < hd - 0.3; b += 0.95) {
        if (b > 0.4 && R() < 0.6) continue;
        const p = map(-hw, b), q = map(hw, b);
        S.beam(p[0], fl + WH, p[1], q[0], fl + WH, q[1], 0.22, PAL.woodLo);
      }
      vis(map, -hw + t, -hd + t, hw - t, -0.2, fl + WH + 0.2, fl + WH + 0.32, PAL.wood, { jit: 0.08 });
      for (let k = 0; k < 4; k++) {
        const a = rnd(-hw + 0.8, hw - 0.8), b = rnd(-hd + 0.8, hd - 1.0);
        const p = map(a, b), q = map(a + rnd(-1.4, 1.4), b + rnd(0.8, 1.8));
        S.beam(p[0], fl + 0.2, p[1], q[0], fl + rnd(1.0, 1.8), q[1], 0.16, PAL.woodLo);
      }
      for (let k = 0; k < 6; k++) {
        const p = map(rnd(-hw + 0.6, hw - 0.6), rnd(-hd + 0.6, hd - 1.2));
        S.ball(p[0], fl + 0.25, p[1], rnd(0.3, 0.55), PAL.rockLo, 0.6, 1);
      }
    } else {
      const items = [
        () => { const p = map(-hw + 0.9, -hd + 0.9); S.box(p[0], fl, p[1], 1.2, 0.5, 0.7, PAL.woodLo, 0, { jit: 0.06 }); S.box(p[0], fl + 0.5, p[1], 1.2, 0.08, 0.7, PAL.wood); },
        () => { const p = map(hw - 0.8, -hd + 0.8); S.cyl(p[0], fl, p[1], 0.36, 0.34, 0.8, PAL.wood, 8); },
        () => { const p = map(rnd(-0.5, 0.5), -0.2); S.box(p[0], fl, p[1], 0.9, 0.7, 0.9, PAL.woodLo, R() * 3); S.box(p[0], fl + 0.7, p[1], 1.1, 0.07, 1.1, PAL.wood, 0.3); },
      ];
      items[(R() * items.length) | 0]();
      items[(R() * items.length) | 0]();
    }
    for (let k = 0; k < 4; k++) {
      const p = map(rnd(-hw - 1.2, hw + 1.2), rnd(-hd - 1.2, hd + 1.2));
      if (Math.abs(p[0] - x) < hw && Math.abs(p[1] - z) < hd) continue;
      S.ball(p[0], H(p[0], p[1]) + 0.1, p[1], rnd(0.25, 0.5), R() < 0.5 ? PAL.mossLo : PAL.rockLo, 0.6, 1);
    }
    for (let k = 0; k < 2; k++) {
      const p = map(rnd(-hw, hw), rnd(-hd - 0.4, hd + 0.4));
      S.box(p[0], fl + WH - 1.0, p[1], 0.35, 0.5, 0.05, R() < 0.5 ? PAL.cloth : COLD, R() * 3, { rx: 0.3, jit: 0.08 });
    }
    const ridgeP = map(0, cover * hd * 0.45);
    houses.push({ x, z, fx, fz, hd, fl, ridge: fl + WH + RH });
    return ridgeP;
  };

  const houseCfg: { t: number; n: number; w: number; d: number; style: Style; win: boolean }[] = [
    { t: -22, n: 25, w: 5.2, d: 6.4, style: "stone", win: false },
    { t: -6, n: 30, w: 5.0, d: 6.0, style: "timber", win: true },
    { t: 15, n: 26, w: 5.6, d: 6.2, style: "collapse", win: false },
    { t: 32, n: 22, w: 5.0, d: 5.6, style: "stone", win: true },
    { t: -14, n: -21, w: 5.2, d: 6.0, style: "timber", win: false },
    { t: 8, n: -23, w: 5.0, d: 6.4, style: "stone", win: true },
    { t: 26, n: -19, w: 4.8, d: 5.6, style: "timber", win: false },
  ];
  let firstRidge: [number, number, number] | null = null;
  for (const hc of houseCfg) {
    const p = find(hc.t, hc.n, (x, z) => {
      const [fx, fz] = faceOf(x, z);
      const hx = (Math.abs(fz) * hc.w + Math.abs(fx) * hc.d) / 2 + 0.9, hz = (Math.abs(fx) * hc.w + Math.abs(fz) * hc.d) / 2 + 0.2;
      const x0 = x - hx, x1 = x + hx, z0 = z - hz, z1 = z + hz;
      return Math.hypot(x - vx, z - vz) <= 42 && riverOK(x0, z0, x1, z1, 14.5, 11) && ringOK(x0, z0, x1, z1, 6.5) && free(x0, z0, x1, z1, 2);
    });
    if (!p) continue;
    const [fx, fz] = faceOf(p[0], p[1]);
    const hx = (Math.abs(fz) * hc.w + Math.abs(fx) * hc.d) / 2 + 0.9, hz = (Math.abs(fx) * hc.w + Math.abs(fz) * hc.d) / 2 + 0.2;
    take(p[0] - hx, p[1] - hz, p[0] + hx, p[1] + hz);
    const rp = buildHouse(p[0], p[1], hc.w, hc.d, hc.style, hc.win);
    if (!firstRidge) firstRidge = [rp[0], houses[houses.length - 1].ridge + 0.7, rp[1]];
  }
  if (firstRidge) reg.cluster({ x: firstRidge[0], y: firstRidge[1], z: firstRidge[2], n: 4, spread: 1.0 });

  const spot = (t: number, n: number, hw: number, hd: number, minRiver = 9): [number, number] | null =>
    find(t, n, (x, z) => {
      const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
      return riverOK(x0, z0, x1, z1, minRiver + 1, minRiver) && ringOK(x0, z0, x1, z1, 6.5) && free(x0, z0, x1, z1, 0.6) && Math.hypot(x - vx, z - vz) < 44;
    });

  {
    const p = spot(9, 20, 1.3, 1.3);
    if (p) {
      take(p[0] - 1.3, p[1] - 1.3, p[0] + 1.3, p[1] + 1.3);
      const g = groundMin(world, p[0], p[1], 1, 1) - 0.3, f = H(p[0], p[1]);
      S.cyl(p[0], g, p[1], 1.05, 0.95, f + 1.0 - g, PAL.rock, 10, 0, { jit: 0.06 });
      S.cyl(p[0], f + 0.9, p[1], 0.72, 0.72, 0.03, "#243d3d", 10, 0, { ao: 0, jit: 0 });
      for (let k = 0; k < 3; k++) S.ball(p[0] + (R() - 0.5) * 3, f + 0.2, p[1] + (R() - 0.5) * 3, 0.3 + R() * 0.2, PAL.rockLo, 0.6, 1);
      for (const sd of [-1, 1]) S.box(p[0] + sd * 0.95, f + 0.8, p[1], 0.18, 1.9, 0.18, PAL.woodLo, 0, { rz: sd * 0.03 });
      S.beam(p[0] - 0.95, f + 2.5, p[1], p[0] + 0.95, f + 2.5, p[1], 0.18, PAL.wood);
      S.prism(p[0] - 0.6, f + 2.6, p[1], 1.5, 0.5, 1.4, ROOFS[0], 0, { rz: 0.1 });
      S.beam(p[0], f + 2.4, p[1], p[0], f + 1.6, p[1] + 0.02, 0.03, PAL.ash);
      S.cyl(p[0] + 0.05, f + 1.2, p[1] + 0.02, 0.18, 0.15, 0.3, PAL.woodLo, 7);
      coll(ID, p[0] - 1.05, p[1] - 1.05, p[0] + 1.05, p[1] + 1.05, g, f + 1.0, "solid");
      reg.cluster({ x: p[0], y: f + 1.8, z: p[1], n: 3, spread: 0.9 });
    }
  }
  let stallPivot: [number, number, number] | null = null;
  {
    const p = spot(-8, 20, 2.2, 1.6);
    if (p) {
      take(p[0] - 2.2, p[1] - 1.6, p[0] + 2.2, p[1] + 1.6);
      const f = H(p[0], p[1]);
      for (const [a, b] of [[-1.7, -1.1], [1.7, -1.1], [-1.7, 1.1], [1.7, 1.1]] as const)
        S.box(p[0] + a, f - 0.2, p[1] + b, 0.18, 2.7, 0.18, PAL.woodLo, 0, { rx: (R() - 0.5) * 0.06, rz: (R() - 0.5) * 0.06 });
      S.beam(p[0] - 1.8, f + 2.4, p[1] - 1.1, p[0] + 1.8, f + 2.45, p[1] - 1.1, 0.14, PAL.wood);
      S.beam(p[0] - 1.8, f + 2.4, p[1] + 1.1, p[0] + 0.4, f + 2.3, p[1] + 1.1, 0.14, PAL.wood);
      S.beam(p[0] - 1.7, f + 2.4, p[1] - 1.1, p[0] - 1.7, f + 2.4, p[1] + 1.1, 0.14, PAL.wood);
      S.box(p[0], f, p[1] - 0.6, 3.0, 0.9, 0.8, PAL.wood, 0, { jit: 0.06 });
      S.box(p[0] - 0.3, f + 0.9, p[1] - 0.6, 3.1, 0.06, 0.9, PAL.woodHi);
      for (const a of [-0.9, 0.4, 1.1]) S.ball(p[0] + a, f + 1.0, p[1] - 0.6, 0.18, a > 0 ? "#b4511e" : PAL.goldLo, 0.8, 1);
      coll(ID, p[0] - 1.5, p[1] - 1.0, p[0] + 1.5, p[1] - 0.2, f, f + 0.95, "solid");
      stallPivot = [p[0], f + 2.45, p[1]];
      for (const [ux2, ul, tilt] of [[-1.3, 1.1, 0.04], [-0.5, 0.7, -0.05], [0.3, 1.5, 0.03], [1.2, 0.9, -0.03]] as const)
        C.box(ux2, -ul - 0.05, -1.1, 0.7, ul, 0.04, ux2 < 0 ? PAL.rubric : PAL.cloth, 0, { rz: tilt, jit: 0.06, ao: 0.05 });
      reg.cluster({ x: p[0], y: f + 2.9, z: p[1], n: 4, spread: 1.0 });
    }
  }
  {
    const p = spot(22, 14, 1.0, 1.0, 11);
    if (p) {
      take(p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1);
      const f = H(p[0], p[1]), lean = 0.11, h = 4.0;
      S.box(p[0], f - 0.3, p[1], 0.3, h + 0.3, 0.3, PAL.woodLo, 0, { rz: lean });
      const tx = p[0] - Math.sin(lean) * h, ty = f + Math.cos(lean) * h;
      S.box(tx, ty - 0.05, p[1], 1.1, 0.9, 1.1, PAL.wood, 0, { rz: lean, jit: 0.06 });
      S.prism(tx - Math.sin(lean) * 0.9, ty + 0.85, p[1], 1.4, 0.7, 1.3, ROOFS[1], 0, { rz: lean });
      for (const hx of [-0.3, 0.3]) S.box(tx + hx - 0.1, ty + 0.2, p[1] + 0.56, 0.18, 0.22, 0.04, PAL.ink, 0, { ao: 0, jit: 0, rz: lean });
      S.beam(tx - 0.2, ty + 0.1, p[1] + 0.6, tx + 0.2, ty + 0.1, p[1] + 0.85, 0.04, PAL.woodHi);
      coll(ID, p[0] - 0.4, p[1] - 0.4, p[0] + 0.4, p[1] + 0.4, f - 0.3, f + 3.8, "solid");
    }
  }
  {
    const p = spot(-2, -17, 1.6, 1.0);
    if (p) {
      take(p[0] - 1.6, p[1] - 1.0, p[0] + 1.6, p[1] + 1.0);
      const f = H(p[0], p[1]);
      S.box(p[0], f + 0.3, p[1], 2.4, 0.18, 1.3, PAL.wood, 0, { rx: 1.25, jit: 0.06 });
      S.box(p[0], f, p[1] + 0.35, 2.3, 0.12, 0.08, PAL.woodLo, 0);
      S.beam(p[0] + 1.2, f + 0.5, p[1] + 0.3, p[0] + 3.2, f + 0.3, p[1] + 0.4, 0.14, PAL.woodLo);
      S.torus(p[0] - 0.3, f + 0.62, p[1] + 0.82, 0.55, 0.07, PAL.woodLo, 0, 0, 0.3, 14, 5);
      S.torus(p[0] + 1.9, f + 0.1, p[1] - 0.6, 0.55, 0.07, PAL.woodLo, Math.PI / 2, 0, 0, 14, 5);
      for (let k = 0; k < 3; k++) S.box(p[0] + (R() - 0.5) * 2, f, p[1] - 0.9 - R() * 0.6, 0.5, 0.4, 0.5, PAL.wood, R() * 3);
      coll(ID, p[0] - 1.3, p[1] - 0.8, p[0] + 1.3, p[1] + 0.9, f, f + 1.1, "solid");
    }
  }
  const barrel = (x: number, z: number) => {
    const f = H(x, z);
    S.cyl(x, f, z, 0.36, 0.43, 0.43, PAL.wood, 8, 0, { jit: 0.06 });
    S.cyl(x, f + 0.43, z, 0.43, 0.36, 0.43, PAL.wood, 8, 0, { jit: 0.06, ao: 0 });
    S.cyl(x, f + 0.12, z, 0.405, 0.405, 0.05, "#5a5650", 8, 0, { ao: 0, jit: 0 });
    S.cyl(x, f + 0.68, z, 0.405, 0.405, 0.05, "#5a5650", 8, 0, { ao: 0, jit: 0 });
    coll(ID, x - 0.4, z - 0.4, x + 0.4, z + 0.4, f, f + 0.88, "solid");
  };
  const crate = (x: number, z: number, s: number) => {
    const f = H(x, z), ry = 0;
    S.box(x, f, z, s, s, s, PAL.wood, ry, { jit: 0.06 });
    S.box(x, f + s * 0.2, z, s * 1.02, 0.07, s * 1.02, PAL.woodLo, ry, { ao: 0 });
    S.box(x, f + s * 0.7, z, s * 1.02, 0.07, s * 1.02, PAL.woodLo, ry, { ao: 0 });
    coll(ID, x - s / 2, z - s / 2, x + s / 2, z + s / 2, f, f + s, "solid");
  };
  for (const [t, n, k] of [[-13, 14, 3], [4, 12, 2], [20, 20, 3], [-10, -16, 3], [12, -15, 2]] as const) {
    const p = spot(t, n, 1.6, 1.6);
    if (!p) continue;
    take(p[0] - 1.6, p[1] - 1.6, p[0] + 1.6, p[1] + 1.6);
    for (let i = 0; i < k; i++) {
      const ox = p[0] + (i % 2) * 0.95 - 0.4, oz = p[1] + (i >> 1) * 0.95 - 0.4;
      if (i === 2 && k === 3) crate(ox, oz, 0.75);
      else if (R() < 0.6) barrel(ox, oz);
      else crate(ox, oz, 0.8);
    }
  }
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.ceil(len / 1.6));
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i <= n; i++) {
      const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n), f = H(x, z), broken = R() < 0.2;
      S.box(x, f - 0.1, z, 0.14, broken ? 0.6 : 1.2, 0.14, PAL.woodLo, 0, { rx: (R() - 0.5) * 0.12, rz: (R() - 0.5) * 0.12 });
      if (i < n) {
        const xn = lerp(x0, x1, (i + 1) / n), zn = lerp(z0, z1, (i + 1) / n);
        if (broken || R() < 0.2) continue;
        for (const hh of [0.45, 0.9]) S.beam(x, f + hh, z, xn, H(xn, zn) + hh, zn, 0.07, PAL.wood);
        const a = alongX ? Math.min(x, xn) : x - 0.1, b = alongX ? z - 0.1 : Math.min(z, zn);
        world.addBox({ minX: a, maxX: alongX ? Math.max(x, xn) : x + 0.1, minZ: b, maxZ: alongX ? z + 0.1 : Math.max(z, zn), minY: f, maxY: f + 1.0, tag: "solid", owner: OWNER });
      }
    }
  };
  const run = (t: number, n: number, len: number, alongX: boolean, wall: boolean) => {
    const hw = alongX ? len / 2 : 0.6, hd = alongX ? 0.6 : len / 2;
    const p = spot(t, n, hw + 0.4, hd + 0.4);
    if (!p) return;
    take(p[0] - hw - 0.4, p[1] - hd - 0.4, p[0] + hw + 0.4, p[1] + hd + 0.4);
    if (!wall) { fence(p[0] - hw, p[1] - hd, p[0] + hw, p[1] + hd); return; }
    const f = groundMin(world, p[0], p[1], hw, hd);
    let s = -len / 2;
    while (s < len / 2 - 0.9) {
      const l = Math.min(len / 2 - s, 1.6 + R() * 1.4), h = 0.7 + R() * 1.1;
      const a = alongX ? p[0] + s : p[0] - 0.25, b = alongX ? p[1] - 0.25 : p[1] + s;
      const w2 = alongX ? l : 0.5, d2 = alongX ? 0.5 : l;
      masonry(ID, a, b, a + w2, b + d2, f - 0.3, f + h, "solid", true, stoneCols, 0.5);
      s += l + (R() < 0.4 ? 1.0 + R() : 0.05);
    }
  };
  run(-24, 14, 7, true, false);
  run(34, 14, 6, false, false);
  run(18, -22, 7, true, true);
  run(-6, -14, 5, false, true);
  run(-18, 17, 5, true, true);
  run(28, 28, 6, true, false);

  const litHalo = haloSprite(env.glow, PAL.ember, 4.5);
  env.own(litHalo.material);
  const lantern = (x: number, z: number, lit: boolean, armDir: number) => {
    const f = groundMin(world, x, z, 0.1, 0.1) - 0.1;
    S.box(x, f, z, 0.16, 2.6, 0.16, PAL.woodLo, 0, { jit: 0.04 });
    S.box(x, f, z, 0.34, 0.22, 0.34, PAL.rockLo);
    const ax = x + Math.cos(armDir) * 0.45, az = z + Math.sin(armDir) * 0.45;
    S.beam(x, f + 2.5, z, ax, f + 2.5, az, 0.08, PAL.woodLo);
    S.beam(ax, f + 2.5, az, ax, f + 2.35, az, 0.025, PAL.goldLo);
    const cap = lit ? PAL.gold : "#6f7270";
    S.box(ax, f + 2.3, az, 0.26, 0.05, 0.26, cap, 0, { ao: 0 });
    S.box(ax, f + 1.9, az, 0.26, 0.05, 0.26, cap, 0, { ao: 0 });
    if (lit) {
      E.box(ax, f + 1.95, az, 0.2, 0.35, 0.2, PAL.emberHi, 0, { jit: 0, ao: 0 });
      litHalo.position.set(ax, f + 2.1, az);
    } else S.box(ax, f + 1.95, az, 0.2, 0.35, 0.2, COLD, 0, { jit: 0.03 });
    coll(ID, x - 0.12, z - 0.12, x + 0.12, z + 0.12, f, f + 2.6, "solid");
  };
  {
    const door = mm(5.6, 2.6);
    lantern(door[0], door[1], true, Math.atan2(-uz, -ux));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5, r = 7.6 + R() * 1.2;
      const x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
      const x0 = x - 0.4, x1 = x + 0.4, z0 = z - 0.4, z1 = z + 0.4;
      if (!riverOK(x0, z0, x1, z1, 10, 9) || !free(x0, z0, x1, z1, 0.3)) continue;
      take(x0, z0, x1, z1);
      lantern(x, z, false, a + 1.6);
    }
  }
  litHalo.castShadow = false;
  group.add(litHalo);

  for (let i = 1; i < houses.length + 1; i++) {
    const h = houses[i % houses.length];
    if (!h) break;
    const cx = h.x - h.fx * (h.hd + 1.9), cz = h.z - h.fz * (h.hd + 1.9);
    if (near(cx, cz).d < 12 || !free(cx - 0.8, cz - 0.8, cx + 0.8, cz + 0.8, 0.2)) continue;
    take(cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2);
    reg.chest({ id: "chest-village", x: cx, y: H(cx, cz), z: cz, yaw: Math.atan2(-h.fx, -h.fz), reward: { kind: "glimmer", amount: 20 } });
    barrel(cx - h.fz * 1.4 - h.fx * 0.3, cz + h.fx * 1.4 - h.fz * 0.3);
    crate(cx + h.fz * 1.5 - h.fx * 0.3, cz - h.fx * 1.5 - h.fz * 0.3, 0.8);
    break;
  }
  {
    const p = spot(5, 24, 0.8, 0.8) ?? loc(5, 24);
    take(p[0] - 0.8, p[1] - 0.8, p[0] + 0.8, p[1] + 0.8);
    reg.lore({
      id: "lore-village", x: p[0], z: p[1], yaw: Math.atan2(vx - p[0], vz - p[1]), title: "The Millers Tally",
      text: "Forty-one sacks a season, the miller scratched here, until the river learned a quieter name. Wren, the lantern-bearers came through at every dusk and left one flame burning on the bridge, so no cart would lose the road. The flame outlasted the last of us. Keep it.",
    });
  }

  const sheetMat = vcMat2(look);
  const clothMesh = C.build(look, sheetMat, "village-cloth");
  if (stallPivot) clothMesh.position.set(stallPivot[0], stallPivot[1], stallPivot[2]);
  clothMesh.castShadow = false;
  const solid = S.build(look, undefined, "village-stone");
  const embers = E.build(look, glowMat(look, PAL.emberHi, 1.0523), "village-embers");
  embers.castShadow = false;
  const emberMat = embers.material as THREE.Material & { emissiveIntensity: number };
  for (const m of [solid, embers, clothMesh]) {
    env.own(m.geometry);
    group.add(m);
  }
  const base = 4.5;
  reg.anim(({ time, dt }) => {
    wheel.rotation.z += dt * 0.35;
    const f = 1 + 0.08 * Math.sin(time * 7.3) + 0.05 * Math.sin(time * 17.1);
    litHalo.scale.set(base * f, base * f, 1);
    emberMat.emissiveIntensity = 1.0523 + 0.25 * Math.sin(time * 6.1);
    clothMesh.rotation.z = 0.05 * Math.sin(time * 1.4);
    clothMesh.rotation.x = 0.04 * Math.sin(time * 1.9 + 0.7);
  });

  return { x: vx, z: vz, radius: 62 };
}
