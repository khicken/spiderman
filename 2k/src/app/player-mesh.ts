import * as THREE from "three";
import type { Body } from "./player-skel";
import { ARM, B, LEG, SX } from "./player-skel";
import type { Look, Rect } from "./player-tex";
import { R } from "./player-tex";

// Procedural athlete geometry: lofted, smoothly skinned tubes (torso, arms, legs, shorts) plus rigid parts (head,
// hair, hands, shoes). Everything lands in one BufferGeometry with skinIndex/skinWeight and atlas UVs.

const PAD = 1.5 / 1024; // uv inset against mip bleed

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, b0: number, b1: number, t: number) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (b0 === b1 || t <= 0) {
      this.si.push(b0, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    } else if (t >= 1) {
      this.si.push(b1, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    } else {
      this.si.push(b0, b1, 0, 0);
      this.sw.push(1 - t, t, 0, 0);
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** atlas uv for local (u, v) in rect (v up). */
function au(r: Rect, u: number): number {
  return r[0] + PAD + u * (r[2] - 2 * PAD);
}
function av(r: Rect, v: number): number {
  return 1 - (r[1] + PAD + (1 - v) * (r[3] - 2 * PAD));
}

type V3 = [number, number, number];
interface Ring {
  c: V3;
  ax: V3; // ring "side" axis (theta = 0)
  az: V3; // ring "front" axis (theta = pi/2)
  rx: number;
  rz: number;
  n?: number; // superellipse exponent (2 = ellipse)
  bulge?: (th: number) => number;
  b0: number;
  b1: number;
  t: number;
}
interface Section {
  from: number; // ring index (inclusive)
  to: number; // ring index (inclusive)
  rect: Rect;
}

function se(c: number, n: number) {
  return Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
}

/** Lofted tube through rings. Sections duplicate their boundary rings so each can use its own atlas rect. */
function tube(b: Builder, rings: Ring[], segs: number, sections: Section[]) {
  const nr = rings.length;
  const P = new Float32Array(nr * segs * 3);
  for (let i = 0; i < nr; i++) {
    const r = rings[i];
    const n = r.n ?? 2;
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const k = r.bulge ? r.bulge(th) : 1;
      const cx = se(Math.cos(th), n) * r.rx * k;
      const cz = se(Math.sin(th), n) * r.rz * k;
      const o = (i * segs + j) * 3;
      P[o] = r.c[0] + r.ax[0] * cx + r.az[0] * cz;
      P[o + 1] = r.c[1] + r.ax[1] * cx + r.az[1] * cz;
      P[o + 2] = r.c[2] + r.ax[2] * cx + r.az[2] * cz;
    }
  }
  const N = new Float32Array(nr * segs * 3);
  const g = (i: number, j: number, c: number) => P[(i * segs + (((j % segs) + segs) % segs)) * 3 + c];
  let orient = 0;
  for (let i = 0; i < nr; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(nr - 1, i + 1);
    for (let j = 0; j < segs; j++) {
      const ux = g(i, j + 1, 0) - g(i, j - 1, 0);
      const uy = g(i, j + 1, 1) - g(i, j - 1, 1);
      const uz = g(i, j + 1, 2) - g(i, j - 1, 2);
      let vx = g(i1, j, 0) - g(i0, j, 0);
      let vy = g(i1, j, 1) - g(i0, j, 1);
      let vz = g(i1, j, 2) - g(i0, j, 2);
      if (vx * vx + vy * vy + vz * vz < 1e-12) {
        const r = rings[Math.min(nr - 1, i + 1)];
        const q = rings[Math.max(0, i - 1)];
        vx = r.c[0] - q.c[0];
        vy = r.c[1] - q.c[1];
        vz = r.c[2] - q.c[2];
      }
      let nx = vy * uz - vz * uy;
      let ny = vz * ux - vx * uz;
      let nz = vx * uy - vy * ux;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const o = (i * segs + j) * 3;
      N[o] = nx;
      N[o + 1] = ny;
      N[o + 2] = nz;
      if (i > 0 && i < nr - 1) {
        const c = rings[i].c;
        orient += nx * (P[o] - c[0]) + ny * (P[o + 1] - c[1]) + nz * (P[o + 2] - c[2]);
      }
    }
  }
  const flip = orient < 0 ? -1 : 1;
  // arc length per ring for v
  const len = new Float32Array(nr);
  for (let i = 1; i < nr; i++) {
    const a = rings[i - 1].c;
    const c = rings[i].c;
    len[i] = len[i - 1] + Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) + 1e-6;
  }
  for (const s of sections) {
    const base = b.count;
    const l0 = len[s.from];
    const l1 = len[s.to];
    for (let i = s.from; i <= s.to; i++) {
      const r = rings[i];
      const v = (len[i] - l0) / Math.max(1e-6, l1 - l0);
      for (let j = 0; j <= segs; j++) {
        const jj = j % segs;
        const o = (i * segs + jj) * 3;
        b.vert(P[o], P[o + 1], P[o + 2], N[o] * flip, N[o + 1] * flip, N[o + 2] * flip, au(s.rect, 1 - j / segs), av(s.rect, v), r.b0, r.b1, r.t);
      }
    }
    const row = segs + 1;
    // winding: make the geometric normal agree with the vertex normal
    const a0 = base;
    const pa = (k: number, c: number) => b.pos[k * 3 + c];
    const e1 = [pa(a0 + 1, 0) - pa(a0, 0), pa(a0 + 1, 1) - pa(a0, 1), pa(a0 + 1, 2) - pa(a0, 2)];
    const e2 = [pa(a0 + row, 0) - pa(a0, 0), pa(a0 + row, 1) - pa(a0, 1), pa(a0 + row, 2) - pa(a0, 2)];
    let midI = Math.floor((s.from + s.to) / 2);
    if (midI === s.from && s.to > s.from) midI = s.from;
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const nk = (a0 + 0) * 3;
    let ccw = cx * b.nrm[nk] + cy * b.nrm[nk + 1] + cz * b.nrm[nk + 2] > 0;
    if (Math.abs(cx) + Math.abs(cy) + Math.abs(cz) < 1e-10) {
      // degenerate first ring: test one row further
      const k1 = a0 + row;
      const f1 = [pa(k1 + 1, 0) - pa(k1, 0), pa(k1 + 1, 1) - pa(k1, 1), pa(k1 + 1, 2) - pa(k1, 2)];
      const f2 = [pa(k1 + row, 0) - pa(k1, 0), pa(k1 + row, 1) - pa(k1, 1), pa(k1 + row, 2) - pa(k1, 2)];
      const dx = f1[1] * f2[2] - f1[2] * f2[1];
      const dy = f1[2] * f2[0] - f1[0] * f2[2];
      const dz = f1[0] * f2[1] - f1[1] * f2[0];
      ccw = dx * b.nrm[k1 * 3] + dy * b.nrm[k1 * 3 + 1] + dz * b.nrm[k1 * 3 + 2] > 0;
    }
    for (let i = 0; i < s.to - s.from; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * row + j;
        const bb = a + 1;
        const c = a + row + 1;
        const d = a + row;
        if (ccw) b.idx.push(a, bb, c, a, c, d);
        else b.idx.push(a, c, bb, a, d, c);
      }
    }
  }
}

/** Append a rigid (single bone) geometry, transformed by m, uvs remapped into rect (or a fixed uv). */
function rigid(b: Builder, geo: THREE.BufferGeometry, m: THREE.Matrix4, bone: number, rect: Rect, fixedUv?: [number, number], keep?: (i: number) => boolean) {
  const g = geo.index ? geo : geo;
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const base = b.count;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    const u0 = fixedUv ? fixedUv[0] : uv ? uv.getX(i) : 0.5;
    const v0 = fixedUv ? fixedUv[1] : uv ? uv.getY(i) : 0.5;
    b.vert(v.x, v.y, v.z, w.x, w.y, w.z, au(rect, u0), av(rect, v0), bone, bone, 0);
  }
  const det = m.determinant();
  const push = (a: number, c: number, d: number) => {
    if (keep && !(keep(a) && keep(c) && keep(d))) return;
    if (det < 0) b.idx.push(base + a, base + d, base + c);
    else b.idx.push(base + a, base + c, base + d);
  };
  if (g.index) {
    const ix = g.index;
    for (let i = 0; i < ix.count; i += 3) push(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2));
  } else for (let i = 0; i < p.count; i += 3) push(i, i + 1, i + 2);
}

const gauss = (x: number) => Math.exp(-x * x);

/** Unit head sphere with face features, seam at the back. Returns geometry in unit-ish coords (not scaled). */
function headSphere(ws: number, hs: number, shell = 0): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, ws, hs, Math.PI * 1.5);
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    if (y < -0.2) {
      const t = (-0.2 - y) / 0.8;
      x *= 1 - 0.3 * t;
      if (z < 0) z *= 1 - 0.35 * t;
    }
    if (y > -0.15 && z < 0) z *= 1.07;
    if (shell === 0) {
      const front = z > 0 ? 1 : 0;
      z += front * 0.1 * gauss(x / 0.32) * gauss((y + 0.86) / 0.16); // chin
      z += front * 0.21 * gauss(x / 0.1) * gauss((y + 0.24) / 0.2); // nose
      z += front * 0.06 * gauss((y - 0.22) / 0.08) * Math.max(0, z - 0.55) * 2.2; // brow ridge
      for (const s of [-1, 1]) {
        z -= front * 0.055 * gauss((x - s * 0.38) / 0.13) * gauss((y - 0.07) / 0.09); // eye sockets
        x += s * 0.035 * gauss((x - s * 0.62) / 0.2) * gauss((y + 0.12) / 0.14) * front; // cheekbones
        if (x * s > 0.75) x += s * 0.16 * gauss(y / 0.2) * gauss((z + 0.06) / 0.16); // ears
      }
      z += front * 0.035 * gauss(x / 0.2) * gauss((y + 0.52) / 0.08); // lips
    }
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export interface MeshOpts {
  detail: 0 | 1 | 2;
}

/** Build the full skinned body geometry for an athlete (or a referee when look.ref). */
export function buildBody(body: Body, look: Look, opts: MeshOpts): THREE.BufferGeometry {
  const b = new Builder();
  const { H, g, rest } = body;
  const d = opts.detail;
  const segT = [10, 16, 22][d];
  const segL = [8, 12, 16][d];
  const rp = (bone: number): V3 => [rest[bone * 3], rest[bone * 3 + 1], rest[bone * 3 + 2]];
  const X: V3 = [1, 0, 0];
  const Z: V3 = [0, 0, 1];
  const Y: V3 = [0, 1, 0];
  const gs = Math.sqrt(g);
  const ls = 1.08 * g * Math.pow(H / 2, 0.5); // limb radius scale

  // ---- torso: crotch to the base of the skull --------------------------------------------------------------------
  const shY = body.shY;
  const chest = (th: number) => 1 + 0.07 * Math.pow(Math.max(0, Math.sin(th)), 2) * (1 - Math.abs(Math.cos(th)) * 0.5) + 0.03 * Math.pow(Math.max(0, -Math.sin(th)), 2);
  const glute = (th: number) => 1 + 0.1 * Math.pow(Math.max(0, -Math.sin(th)), 2);
  const T = (y: number, rx: number, rz: number, z: number, b0: number, b1: number, t: number, n = 2.2, bulge?: (th: number) => number): Ring => ({
    c: [0, y, z], ax: X, az: Z, rx, rz, n, b0, b1, t, bulge,
  });
  const neckR = 0.067 * gs;
  const torso: Ring[] = [
    T(0.458 * H, 0.03 * H * g, 0.03 * H * g, 0, B.hips, B.hips, 0),
    T(0.472 * H, 0.074 * H * g, 0.058 * H * g, -0.004, B.hips, B.hips, 0, 2.2, glute),
    T(0.5 * H, 0.087 * H * g, 0.067 * H * g, -0.006, B.hips, B.hips, 0, 2.3, glute),
    T(0.53 * H, 0.09 * H * g, 0.068 * H * g, -0.004, B.hips, B.hips, 0, 2.3, glute),
    T(0.565 * H, 0.083 * H * g, 0.063 * H * g, 0, B.hips, B.spine, 0.35, 2.3),
    T(0.598 * H, 0.075 * H * g, 0.059 * H * g, 0.002, B.hips, B.spine, 0.7, 2.25), // 5 waistband
    T(0.635 * H, 0.077 * H * g, 0.06 * H * g, 0.003, B.spine, B.spine, 0, 2.2),
    T(0.675 * H, 0.086 * H * g, 0.065 * H * g, 0.004, B.spine, B.chest, 0.5, 2.25, chest), // lats flare
    T(0.715 * H, 0.094 * H * g, 0.071 * H * g, 0.007, B.chest, B.chest, 0, 2.25, chest),
    T(0.75 * H, 0.099 * H * g, 0.073 * H * g, 0.006, B.chest, B.chest, 0, 2.2, chest),
    T(shY - 0.06, 0.1 * H * g, 0.067 * H * g, -0.002, B.chest, B.chest, 0, 2.1, chest),
    T(shY - 0.025, 0.094 * H * g, 0.058 * H * g, -0.008, B.chest, B.chest, 0, 2.0), // rounded shoulder line
    T(shY + 0.004, 0.078 * H * g, 0.052 * H * g, -0.012, B.chest, B.neck, 0.15, 2.0), // 12 trapezius slope
    T(shY + 0.02, neckR * 1.4, neckR * 1.15, -0.014, B.chest, B.neck, 0.45, 2), // 13 trap / neck base
    T(shY + 0.045, neckR, neckR * 0.95, -0.012, B.neck, B.neck, 0, 2),
    T(body.chinY + 0.005, neckR * 0.94, neckR * 0.92, -0.006, B.neck, B.head, 0.5, 2),
    T(body.chinY + 0.06, neckR * 0.85, neckR * 0.85, -0.01, B.head, B.head, 0, 2),
  ];
  tube(b, torso, segT, [
    { from: 0, to: 5, rect: look.ref ? R.legL : R.shorts },
    { from: 5, to: 13, rect: R.jersey },
    { from: 13, to: 16, rect: R.skin },
  ]);

  // ---- arms ------------------------------------------------------------------------------------------------------
  for (let s = 0; s < 2; s++) {
    const sx = SX[s];
    const a = ARM[s];
    const sh = rp(a.arm);
    const el = rp(a.fore);
    const wr = rp(a.hand);
    const dir1: V3 = norm([el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]]);
    const dir2: V3 = norm([wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]]);
    const ax1 = norm(cross(Z, dir1));
    const ax2 = norm(cross(Z, dir2));
    const at = (o: V3, dir: V3, dd: number): V3 => [o[0] + dir[0] * dd, o[1] + dir[1] * dd, o[2] + dir[2] * dd];
    const up = body.upper;
    const fo = body.fore;
    const biceps = (th: number) => 1 + 0.12 * Math.pow(Math.max(0, Math.sin(th)), 2) + 0.06 * Math.pow(Math.max(0, -Math.sin(th)), 2);
    const fore = (th: number) => 1 + 0.08 * Math.pow(Math.max(0, Math.cos(th) * sx), 2);
    // arms read thin at broadcast distance: a little extra girth, more on the upper arm than the wrist
    const AK = 1.1;
    const A = (c: V3, ax: V3, r: number, b0: number, b1: number, t: number, bulge?: (th: number) => number, rz = r): Ring => ({
      c, ax, az: Z, rx: r * ls * AK, rz: rz * ls * AK, b0, b1, t, bulge,
    });
    const dome: V3 = [sh[0] - sx * 0.014, sh[1] + 0.036, sh[2]];
    const rings: Ring[] = [
      A(dome, ax1, 0.014, a.clav, a.arm, 0.5),
      A(at(sh, dir1, -0.055), ax1, 0.05, a.clav, a.arm, 0.7, undefined, 0.055),
      A(at(sh, dir1, -0.028), ax1, 0.064, a.arm, a.arm, 0, undefined, 0.066), // deltoid cap
      A(at(sh, dir1, 0.005), ax1, 0.066, a.arm, a.arm, 0, undefined, 0.064),
      A(at(sh, dir1, 0.06), ax1, 0.057, a.arm, a.arm, 0, undefined, 0.053),
      A(at(sh, dir1, 0.12), ax1, 0.047, a.arm, a.arm, 0, biceps),
      A(at(sh, dir1, up * 0.6), ax1, 0.046, a.arm, a.arm, 0, biceps),
      A(at(sh, dir1, up - 0.045), ax1, 0.039, a.arm, a.fore, 0.15),
      A(el, ax1, 0.036, a.arm, a.fore, 0.5, undefined, 0.038),
      A(at(el, dir2, 0.035), ax2, 0.04, a.arm, a.fore, 0.85),
      A(at(el, dir2, 0.085), ax2, 0.049, a.fore, a.fore, 0, fore),
      A(at(el, dir2, fo * 0.55), ax2, 0.04, a.fore, a.fore, 0, fore),
      A(at(el, dir2, fo - 0.025), ax2, 0.027, a.fore, a.fore, 0, undefined, 0.024),
      A(at(el, dir2, fo + 0.012), ax2, 0.025, a.fore, a.hand, 0.6, undefined, 0.022),
    ];
    const hasSleeve = look.armSleeve !== 0 && ((look.armSleeve === 1 && s === 1) || (look.armSleeve === -1 && s === 0));
    const sections: Section[] = look.ref
      ? [
          { from: 0, to: 6, rect: R.acc },
          { from: 6, to: 13, rect: R.skin },
        ]
      : hasSleeve
        ? [
            { from: 0, to: 5, rect: R.skin },
            { from: 5, to: 13, rect: R.acc },
          ]
        : [{ from: 0, to: 13, rect: R.skin }];
    if (look.ref) for (let i = 1; i <= 5; i++) {
      rings[i].rx *= 1.12;
      rings[i].rz *= 1.12;
    }
    tube(b, rings, segL, sections);
    hand(b, body, s, d);
  }

  // ---- legs ------------------------------------------------------------------------------------------------------
  for (let s = 0; s < 2; s++) {
    const sx = SX[s];
    const l = LEG[s];
    const hp = rp(l.thigh);
    const kn = rp(l.shin);
    const an = rp(l.foot);
    const d1 = norm([kn[0] - hp[0], kn[1] - hp[1], kn[2] - hp[2]]);
    const d2 = norm([an[0] - kn[0], an[1] - kn[1], an[2] - kn[2]]);
    const ax: V3 = [sx, 0, 0];
    const at = (o: V3, dir: V3, dd: number): V3 => [o[0] + dir[0] * dd, o[1] + dir[1] * dd, o[2] + dir[2] * dd];
    const th = body.thigh;
    const sh = body.shin;
    const pants = look.ref ? 1.18 : 1;
    const calf = (t: number) => 1 + 0.16 * Math.pow(Math.max(0, -Math.sin(t)), 2) * (look.ref ? 0.2 : 1) + 0.04 * Math.pow(Math.cos(t) * -1 > 0 ? Math.cos(t) : 0, 2);
    const quad = (t: number) => 1 + 0.07 * Math.pow(Math.max(0, Math.sin(t)), 2);
    const Lr = (c: V3, r: number, b0: number, b1: number, t: number, bulge?: (th: number) => number, rz = r): Ring => ({
      c, ax, az: Z, rx: r * ls * pants, rz: rz * ls * pants, b0, b1, t, bulge,
    });
    const rings: Ring[] = [
      Lr(at(hp, d1, -0.08), 0.07, B.hips, l.thigh, 0.35),
      Lr(at(hp, d1, 0), 0.088, B.hips, l.thigh, 0.75, quad),
      Lr(at(hp, d1, 0.09), 0.085, l.thigh, l.thigh, 0, quad),
      Lr(at(hp, d1, th * 0.5), 0.074, l.thigh, l.thigh, 0, quad),
      Lr(at(hp, d1, th - 0.1), 0.06, l.thigh, l.thigh, 0, quad),
      Lr(at(hp, d1, th - 0.035), 0.052, l.thigh, l.shin, 0.2),
      Lr(kn, 0.05, l.thigh, l.shin, 0.5, undefined, 0.052),
      Lr(at(kn, d2, 0.045), 0.049, l.thigh, l.shin, 0.85),
      Lr(at(kn, d2, 0.11), 0.054, l.shin, l.shin, 0, calf),
      Lr(at(kn, d2, sh * 0.32), 0.052, l.shin, l.shin, 0, calf),
      Lr(at(kn, d2, sh * 0.6), 0.04, l.shin, l.shin, 0, calf),
      Lr(at(kn, d2, sh - 0.05), 0.031, l.shin, l.shin, 0),
      Lr(an, 0.03, l.shin, l.foot, 0.5),
      Lr(at(an, d2, 0.02), 0.03, l.foot, l.foot, 0),
    ];
    if (!look.ref) for (let i = 0; i <= 3; i++) {
      rings[i].rx *= 0.86;
      rings[i].rz *= 0.86;
    }
    let sections: Section[];
    const legRect = s === 0 ? R.legL : R.legR;
    if (look.ref) sections = [{ from: 0, to: 13, rect: legRect }];
    else {
      const sockFrom = look.highSocks ? 9 : 10;
      const sleeve = look.legSleeve !== 0 && ((look.legSleeve === 1 && s === 1) || (look.legSleeve === -1 && s === 0));
      sections = sleeve
        ? [
            { from: 0, to: 3, rect: R.skin },
            { from: 3, to: sockFrom, rect: R.acc },
            { from: sockFrom, to: 13, rect: R.sock },
          ]
        : [
            { from: 0, to: sockFrom, rect: R.skin },
            { from: sockFrom, to: 13, rect: R.sock },
          ];
      if (look.highSocks) {
        // socks a little thicker than the calf they cover
        for (let i = sockFrom; i < 13; i++) {
          rings[i].rx *= 1.04;
          rings[i].rz *= 1.04;
        }
      }
    }
    tube(b, rings, segL, sections);

    // shorts leg: baggy, hem above the knee
    if (!look.ref) {
      const hemDrop = look.longShorts ? 0.004 * H : 0.035 * H;
      const hemY = kn[1] + hemDrop;
      const len = (hp[1] + 0.07 - hemY) / Math.max(0.2, -d1[1]);
      const o: V3 = [hp[0] - sx * 0.008, hp[1] + 0.07, hp[2] - 0.004];
      const SR = (dd: number, r: number, t: number, rz = r): Ring => ({
        c: at(o, d1, dd), ax, az: Z, rx: r * ls, rz: rz * ls, n: 2.1, b0: B.hips, b1: l.thigh, t,
      });
      const shorts: Ring[] = [
        SR(0, 0.095, 0.25, 0.088),
        SR(len * 0.12, 0.122, 0.45, 0.106),
        SR(len * 0.35, 0.132, 0.7, 0.118),
        SR(len * 0.75, 0.128, 0.88, 0.116),
        SR(len, 0.122, 0.94, 0.112),
        SR(len - 0.002, 0.114, 0.94, 0.104),
        SR(len - 0.04, 0.108, 0.92, 0.098),
      ];
      tube(b, shorts, segT, [{ from: 0, to: 4, rect: legRect }, { from: 4, to: 6, rect: legRect }]);
    }
    shoe(b, body, look, s, d);
  }

  head(b, body, look, d);
  return b.build();
}

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: V3, c: V3): V3 {
  return [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

function place(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

function hand(b: Builder, body: Body, s: number, d: number) {
  const a = ARM[s];
  const sx = SX[s];
  const r = body.rest;
  const wx = r[a.hand * 3];
  const wy = r[a.hand * 3 + 1];
  const wz = r[a.hand * 3 + 2];
  const k = Math.pow(body.H / 2, 0.8);
  const tilt = Math.atan(body.armTilt) * sx; // rotate about z so -y follows the arm
  const skinUv: [number, number] = [0.5, 0.5];
  const frame = new THREE.Matrix4().compose(new THREE.Vector3(wx, wy, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, tilt)), new THREE.Vector3(1, 1, 1));
  const add = (geo: THREE.BufferGeometry, local: THREE.Matrix4) => {
    const m = new THREE.Matrix4().multiplyMatrices(frame, local);
    rigid(b, geo, m, a.hand, R.skin, skinUv);
  };
  const sphere = new THREE.SphereGeometry(1, d === 0 ? 8 : 12, d === 0 ? 6 : 9);
  // palm: thickness along x (palm faces -sx), width along z, length along -y
  add(sphere, place(-sx * 0.002, -0.05 * k, 0.004, 0, 0, 0, 0.025 * k, 0.056 * k, 0.048 * k));
  if (d === 0) {
    add(sphere, place(-sx * 0.006, -0.115 * k, 0.004, 0, 0, 0, 0.019 * k, 0.045 * k, 0.042 * k));
    sphere.dispose();
    return;
  }
  const cap = new THREE.CapsuleGeometry(0.0105 * k, 0.045 * k, 3, d === 2 ? 8 : 6);
  const zs = [0.031, 0.0105, -0.0105, -0.03];
  const ls = [0.98, 1.08, 1.0, 0.8];
  for (let i = 0; i < 4; i++) {
    const L = 0.04 * k * ls[i];
    const curl = 0.32 + i * 0.05;
    // finger from the knuckle line, curled toward the palm side (-sx)
    const bx = -sx * Math.sin(curl) * L * 0.5;
    const by = -0.094 * k - Math.cos(curl) * L * 0.5;
    add(cap, place(bx - sx * 0.002, by, zs[i] * k, 0, 0, -sx * curl, 1, ls[i], 1));
  }
  // thumb: from the palm's front edge, angled forward and toward the palm
  add(cap, place(-sx * 0.012, -0.045 * k, 0.04 * k, -0.55, 0, -sx * 0.35, 1.05, 0.95, 1.05));
  cap.dispose();
  sphere.dispose();
}

function shoe(b: Builder, body: Body, look: Look, s: number, d: number) {
  const l = LEG[s];
  const r = body.rest;
  const ax = r[l.foot * 3];
  const ay = r[l.foot * 3 + 1];
  const az = r[l.foot * 3 + 2];
  const k = Math.pow(body.H / 2, 0.7);
  const heel = -body.heelBack;
  const toe = body.footLen - body.heelBack;
  const segs = [8, 12, 16][d];
  const prof = (t: number) => {
    // half width, top height (above the floor)
    const hw = t < 0.12 ? 0.033 + t * 0.12 : t < 0.7 ? 0.047 + (t - 0.12) * 0.012 : 0.054 - (t - 0.7) * 0.07;
    const top = t < 0.3 ? body.ankleH + 0.06 - t * 0.05 : t < 0.6 ? body.ankleH + 0.045 - (t - 0.3) * 0.17 : 0.085 - (t - 0.6) * 0.1;
    return [hw * k, top];
  };
  const soleTop = 0.028;
  const ts = [0, 0.04, 0.12, 0.25, 0.4, 0.55, 0.7, 0.82, 0.92, 0.975, 1];
  const upper: Ring[] = [];
  const sole: Ring[] = [];
  const XA: V3 = [1, 0, 0];
  const YA: V3 = [0, 1, 0];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const z = az + heel + (toe - heel) * t;
    const [hw0, top0] = prof(t);
    const endK = i === 0 ? 0.35 : i === ts.length - 1 ? 0.3 : 1;
    const hw = hw0 * endK;
    const top = soleTop + (top0 - soleTop) * (i === ts.length - 1 ? 0.6 : 1);
    const cy = (soleTop + top) / 2 - 0.004;
    const hh = ((top - soleTop) / 2) * (i === 0 || i === ts.length - 1 ? 0.75 : 1);
    upper.push({ c: [ax, cy, z], ax: XA, az: YA, rx: hw, rz: hh + 0.004, n: 2.6, b0: l.foot, b1: l.foot, t: 0 });
    const sk = i === 0 || i === ts.length - 1 ? 0.5 : 1;
    sole.push({ c: [ax, soleTop / 2, z + (i === 0 ? -0.006 : i === ts.length - 1 ? 0.006 : 0)], ax: XA, az: YA, rx: (hw0 + 0.006) * sk, rz: soleTop / 2, n: 5, b0: l.foot, b1: l.foot, t: 0 });
  }
  // close the ends
  upper.unshift({ ...upper[0], rx: 0.004, rz: 0.004, c: [ax, upper[0].c[1], upper[0].c[2] - 0.004] });
  upper.push({ ...upper[upper.length - 1], rx: 0.004, rz: 0.004, c: [ax, upper[upper.length - 1].c[1] - 0.004, upper[upper.length - 1].c[2] + 0.004] });
  sole.unshift({ ...sole[0], rx: 0.004, rz: 0.004 });
  sole.push({ ...sole[sole.length - 1], rx: 0.004, rz: 0.004 });
  // move to foot-bone space: ground is y = 0 in model space already (rest ankle at ankleH)
  void ay;
  tube(b, upper, segs, [{ from: 0, to: upper.length - 1, rect: R.shoe }]);
  tube(b, sole, segs, [{ from: 0, to: sole.length - 1, rect: R.sole }]);
  void look;
}

function head(b: Builder, body: Body, look: Look, d: number) {
  const [ws, hs] = [
    [12, 9],
    [20, 15],
    [30, 22],
  ][d];
  const [hx, hy, hz] = body.headR;
  const [cx, cy, cz] = body.headC;
  const geo = headSphere(ws, hs);
  const m = place(cx, cy, cz, 0, 0, 0, hx, hy, hz);
  rigid(b, geo, m.clone(), B.head, R.face);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  // hair volume shells
  const style = look.hairStyle;
  const row = (i: number) => 1 - uv.getY(i); // 0 top .. 1 chin
  const hairline = (i: number) => {
    const u = uv.getX(i);
    const front = Math.cos((u - 0.5) * Math.PI * 2); // 1 at the face, -1 at the back
    return front > 0.3 ? 0.3 + (1 - front) * 0.25 : 0.62;
  };
  const keepHair = (i: number) => row(i) <= hairline(i) + 0.02;
  if (style === "short" || style === "braids" || style === "locs" || style === "long" || style === "afro") {
    const shell = headSphere(ws, hs, 1);
    const sp = shell.getAttribute("position") as THREE.BufferAttribute;
    let sxk = 1.055, syk = 1.05, szk = 1.05, lift = 0.004;
    if (style === "braids") {
      sxk = syk = szk = 1.035;
      lift = 0.002;
    } else if (style === "afro") {
      sxk = 1.3;
      syk = 1.32;
      szk = 1.26;
      lift = 0.03;
    } else if (style === "locs" || style === "long") {
      sxk = 1.09;
      syk = 1.08;
      szk = 1.08;
      lift = 0.006;
    }
    for (let i = 0; i < sp.count; i++) {
      // afro grows mostly up and back
      const y = sp.getY(i);
      const grow = style === "afro" ? 0.75 + 0.25 * Math.max(0, y) : 1;
      sp.setXYZ(i, sp.getX(i) * (1 + (sxk - 1) * grow), y * (1 + (syk - 1) * grow), sp.getZ(i) * (1 + (szk - 1) * grow) - (style === "afro" ? 0.04 : 0));
    }
    shell.computeVertexNormals();
    rigid(b, shell, place(cx, cy + lift, cz, 0, 0, 0, hx, hy, hz), B.head, R.hair, undefined, keepHair);
    shell.dispose();
    if ((style === "locs" || style === "long") && d > 0) {
      const n = style === "locs" ? (d === 2 ? 18 : 10) : 0;
      const cap = new THREE.CapsuleGeometry(0.012, 0.16, 2, 5);
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (0.35 + (i / (n - 1)) * 1.3); // around the back half
        const px = Math.cos(a) * hx * 1.02;
        const pz = -Math.abs(Math.sin(a)) * hz * 0.95 + cz;
        const len = 0.9 + ((i * 7) % 5) * 0.06;
        rigid(b, cap, place(cx + px, cy - 0.06 - len * 0.04, pz, -0.25, 0, Math.cos(a) * 0.25, 1, len, 1), B.head, R.hair, [0.5, 0.5]);
      }
      cap.dispose();
    }
    if (style === "long") {
      const slab = new THREE.SphereGeometry(1, 10, 8);
      rigid(b, slab, place(cx, cy - 0.06, cz - hz * 0.8, 0.2, 0, 0, hx * 1.05, 0.13, 0.04), B.head, R.hair, [0.5, 0.5]);
      slab.dispose();
    }
  }
  if (look.beard && d > 0) {
    const sh = headSphere(ws, hs, 0);
    const p2 = sh.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p2.count; i++) p2.setXYZ(i, p2.getX(i) * 1.035, p2.getY(i) * 1.02 - 0.01, p2.getZ(i) * 1.04);
    sh.computeVertexNormals();
    const keep = (i: number) => {
      const r = row(i);
      const u = uv.getX(i);
      return r > 0.6 && Math.abs(u - 0.5) < 0.2 && !(r < 0.72 && Math.abs(u - 0.5) < 0.04);
    };
    rigid(b, sh, place(cx, cy, cz, 0, 0, 0, hx, hy, hz), B.head, R.hair, undefined, keep);
    sh.dispose();
  }
  if (look.headband) {
    const tor = new THREE.TorusGeometry(1, 0.13, d === 0 ? 4 : 6, d === 2 ? 28 : 16);
    // ring in the xz plane around the forehead, a bit higher at the front
    rigid(b, tor, place(cx, cy + 0.05, cz + 0.004, Math.PI / 2 - 0.12, 0, 0, hx * 1.08, hz * 1.08, 0.09), B.head, R.acc);
    tor.dispose();
  }
  void pos;
  geo.dispose();
}

/** Rest-pose ball-ready check helper for labs: total vertex count of a body geometry. */
export function vertexCount(g: THREE.BufferGeometry): number {
  return g.getAttribute("position").count;
}

