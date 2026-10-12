import * as THREE from "three";

// Axis-aligned ray projection onto the body, for lights, grilles and trims that must sit on the paint.
// axis 0: rays along x (2D coords z, y). axis 1: along y (x, z). axis 2: along z (x, y).
export type Axis = 0 | 1 | 2;
const UV: readonly (readonly [number, number])[] = [[2, 1], [0, 2], [0, 1]];
const CELL = 0.06;

export type Hit = { p: THREE.Vector3; n: THREE.Vector3; ok: boolean };

// m: optional frame change, so axis rays can hit sloped panels head on.
export function createProjector(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
  if (m) g = g.clone().applyMatrix4(m);
  const pos = g.attributes.position.array as Float32Array;
  const nrm = g.attributes.normal.array as Float32Array;
  const idx = g.index!.array;
  const grids = UV.map(([iu, iv]) => {
    const m = new Map<number, number[]>();
    for (let t = 0; t < idx.length; t += 3) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const o = idx[t + k] * 3;
        u0 = Math.min(u0, pos[o + iu]), u1 = Math.max(u1, pos[o + iu]);
        v0 = Math.min(v0, pos[o + iv]), v1 = Math.max(v1, pos[o + iv]);
      }
      for (let a = Math.floor(u0 / CELL); a <= Math.floor(u1 / CELL); a++)
        for (let b = Math.floor(v0 / CELL); b <= Math.floor(v1 / CELL); b++) {
          const key = a * 4096 + b;
          let l = m.get(key);
          if (!l) m.set(key, (l = []));
          l.push(t);
        }
    }
    return m;
  });
  // Outermost surface point toward `sign` along `axis` at 2D coords (u, v).
  const hit = (axis: Axis, sign: number, u: number, v: number, out: Hit) => {
    const [iu, iv] = UV[axis];
    const l = grids[axis].get(Math.floor(u / CELL) * 4096 + Math.floor(v / CELL));
    let best = -Infinity;
    out.ok = false;
    if (!l) return out;
    for (const t of l) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = pos[a + iu], ay = pos[a + iv], bx = pos[b + iu], by = pos[b + iv], cx = pos[c + iu], cy = pos[c + iv];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const w0 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / det;
      const w1 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / det;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const d = (w0 * pos[a + axis] + w1 * pos[b + axis] + w2 * pos[c + axis]) * sign;
      if (d <= best) continue;
      best = d;
      out.ok = true;
      out.p.setComponent(iu, u).setComponent(iv, v).setComponent(axis, d * sign);
      out.n.set(w0 * nrm[a] + w1 * nrm[b] + w2 * nrm[c], w0 * nrm[a + 1] + w1 * nrm[b + 1] + w2 * nrm[c + 1], w0 * nrm[a + 2] + w1 * nrm[b + 2] + w2 * nrm[c + 2]).normalize();
    }
    return out;
  };
  return { hit };
}
export type Projector = ReturnType<typeof createProjector>;

export type DecalOpts = {
  axis: Axis;
  sign: number;
  c: readonly [number, number]; // center in the 2D coords
  s: readonly [number, number]; // half size
  e?: number; // superellipse exponent, 2 = ellipse, high = rectangle
  rot?: number;
  off?: number; // lift along the surface normal
  depth?: number; // extra push toward the normal at the center, gives a bulged lens
  shape?: (t: number) => readonly [number, number]; // custom outline on the unit square, t 0..1
  rings?: number;
  segs?: number;
  tile?: number; // uv meters per repeat
};

const h: Hit = { p: new THREE.Vector3(), n: new THREE.Vector3(), ok: false };

// A disc-topology patch projected onto the body.
export function decal(P: Projector, o: DecalOpts): THREE.BufferGeometry | null {
  const rings = o.rings ?? 6, segs = o.segs ?? 32, e = o.e ?? 2, rot = o.rot ?? 0, off = o.off ?? 0.004, tile = o.tile ?? 1;
  const [iu, iv] = UV[o.axis];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const outline = o.shape ?? ((t: number) => {
    const a = t * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    return [Math.sign(c) * Math.pow(Math.abs(c), 2 / e), Math.sign(s) * Math.pow(Math.abs(s), 2 / e)] as const;
  });
  let miss = 0;
  const put = (lu: number, lv: number, r: number) => {
    const du = lu * o.s[0], dv = lv * o.s[1];
    const u = o.c[0] + du * cr - dv * sr, v = o.c[1] + du * sr + dv * cr;
    P.hit(o.axis, o.sign, u, v, h);
    if (!h.ok) {
      miss++;
      h.p.setComponent(iu, u).setComponent(iv, v);
      h.n.set(0, 0, 0).setComponent(o.axis, o.sign);
    }
    const lift = off + (o.depth ?? 0) * (1 - r * r);
    pos.push(h.p.x + h.n.x * lift, h.p.y + h.n.y * lift, h.p.z + h.n.z * lift);
    nrm.push(h.n.x, h.n.y, h.n.z);
    uv.push((du + o.s[0]) / tile, (dv + o.s[1]) / tile);
  };
  put(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const rr = r / rings;
    for (let k = 0; k < segs; k++) {
      const [a, b] = outline(k / segs);
      put(a * rr, b * rr, rr);
    }
  }
  if (miss > pos.length / 6) return null;
  for (let k = 0; k < segs; k++) idx.push(0, 1 + k, 1 + ((k + 1) % segs));
  for (let r = 1; r < rings; r++)
    for (let k = 0; k < segs; k++) {
      const a = 1 + (r - 1) * segs + k, b = 1 + (r - 1) * segs + ((k + 1) % segs);
      idx.push(a, a + segs, b, b, a + segs, b + segs);
    }
  return orient(build(pos, nrm, uv, idx));
}

// A ribbon along a 2D path, projected onto the body.
export function strip(P: Projector, axis: Axis, sign: number, path: readonly (readonly [number, number])[], width: number, off = 0.004, tile = 1): THREE.BufferGeometry | null {
  const [iu, iv] = UV[axis];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  let len = 0;
  for (let i = 0; i < path.length; i++) {
    const p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(path.length - 1, i + 1)];
    let tu = p1[0] - p0[0], tv = p1[1] - p0[1];
    const l = Math.hypot(tu, tv) || 1;
    (tu /= l), (tv /= l);
    if (i > 0) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    for (const s of [-1, 1]) {
      const u = path[i][0] - tv * width * 0.5 * s, v = path[i][1] + tu * width * 0.5 * s;
      P.hit(axis, sign, u, v, h);
      if (!h.ok) h.p.setComponent(iu, u).setComponent(iv, v), h.n.set(0, 0, 0).setComponent(axis, sign);
      pos.push(h.p.x + h.n.x * off, h.p.y + h.n.y * off, h.p.z + h.n.z * off);
      nrm.push(h.n.x, h.n.y, h.n.z);
      uv.push(len / tile, (s + 1) / 2);
    }
    if (i < path.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  return orient(build(pos, nrm, uv, idx));
}

function build(pos: number[], nrm: number[], uv: number[], idx: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), tn = new THREE.Vector3();

// Make every triangle face along its vertex normal.
export function orient(g: THREE.BufferGeometry) {
  const p = g.attributes.position, n = g.attributes.normal, idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    ta.fromBufferAttribute(p, a);
    tb.fromBufferAttribute(p, b).sub(ta);
    tc.fromBufferAttribute(p, c).sub(ta);
    tn.crossVectors(tb, tc);
    if (tn.x * n.getX(a) + tn.y * n.getY(a) + tn.z * n.getZ(a) < 0) idx.setX(i + 1, c), idx.setX(i + 2, b);
  }
  return g;
}
