import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CarId } from "./contracts";
import type { Surface } from "./car-body";
import { createProjector, decal, strip, type Axis, type DecalOpts, type Projector } from "./car-decal";
import type { Style } from "./car-styles";
import type { Pen } from "./car-tex";
import { finish, lerp, mirrorX, paint, prep } from "./car-curve";
import { LOOKS } from "./car-looks";

export type Parts = {
  paint: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  carbon: THREE.BufferGeometry[];
  lamp: THREE.BufferGeometry[];
  grille: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  heads: THREE.Vector3[];
  panel: (p: Pen) => void;
};
// trim, chrome, gloss, rubber and interior all land in the trim mesh with their own vertex roughness and metalness.
export type Target = "paint" | "trim" | "gloss" | "rubber" | "chrome" | "carbon" | "grille" | "interior" | "glass";
const FINISH: Partial<Record<Target, readonly [number, number, number, number]>> = {
  trim: [0x0c0d0e, 0.62, 0, 0],
  gloss: [0x060607, 0.12, 0, 0.6],
  rubber: [0x0a0a0a, 0.9, 0, 0],
  chrome: [0xd8dadc, 0.06, 1, 0],
  interior: [0x161618, 0.8, 0, 0],
};

export type Ctx = ReturnType<typeof makeCtx>;

export type Lamp = DecalOpts & { tilt?: number };

function makeCtx(S: Surface, P: Projector, st: Style, lod: number, out: Parts, pens: ((p: Pen) => void)[], proxy: THREE.BufferGeometry) {
  const d = S.d;
  const tilted = new Map<number, { P: Projector; back: THREE.Matrix4 }>();
  // Projector in a frame pitched by `tilt` about x. Front rays then travel down and back.
  const frame = (tilt: number) => {
    let f = tilted.get(tilt);
    if (!f) {
      const m = new THREE.Matrix4().makeRotationX(tilt);
      tilted.set(tilt, (f = { P: createProjector(proxy, m), back: m.clone().invert() }));
    }
    return f;
  };
  const project = (o: Lamp, rings: number, segs: number) => {
    if (!o.tilt) return decal(P, { rings, segs, ...o });
    const f = frame(o.tilt);
    const g = decal(f.P, { rings, segs, ...o });
    return g ? g.applyMatrix4(f.back) : null;
  };
  const tag = (g: THREE.BufferGeometry, id: number, color: number) => {
    paint(g, color);
    g.setAttribute("lamp", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
    return prep(g);
  };
  const bin = (t: Target | "lamp") => (t === "carbon" ? (st.carbon ? out.carbon : out.trim) : t !== "lamp" && FINISH[t] ? out.trim : out[t as "paint" | "grille" | "glass" | "lamp"]);
  const push = (t: Target | "lamp", g: THREE.BufferGeometry | null, sym: boolean) => {
    if (!g) return;
    const list = bin(t);
    list.push(g);
    if (sym) list.push(mirrorX(g));
  };
  const colored = (t: Target, g: THREE.BufferGeometry, color?: number) => {
    const f = FINISH[t] ?? (t === "carbon" && !st.carbon ? FINISH.gloss : null);
    if (f) {
      if (color !== undefined) paint(g, color);
      finish(g, f[0], f[1], f[2], f[3]);
    }
    return prep(g);
  };
  const hp = { p: new THREE.Vector3(), n: new THREE.Vector3(), ok: false };
  const c = {
    S, P, d, st, lod, out,
    // Body-relative helpers
    z: (f: number) => S.zOf(f),
    hit(axis: Axis, sign: number, u: number, v: number) {
      P.hit(axis, sign, u, v, hp);
      return { p: hp.p.clone(), n: hp.n.clone(), ok: hp.ok };
    },
    lamp(o: Lamp, id: number, color: number, sym = true) {
      const g = project(o, o.rings ?? (lod > 1 ? 6 : 4), o.segs ?? (lod > 1 ? 40 : 24));
      if (g) push("lamp", tag(g, id, color), sym);
      return g;
    },
    lampStrip(axis: Axis, sign: number, path: readonly (readonly [number, number])[], w: number, id: number, color: number, off = 0.006, sym = true, tilt = 0) {
      const f = tilt ? frame(tilt) : null;
      const g = strip(f ? f.P : P, axis, sign, path, w, off);
      if (g && f) g.applyMatrix4(f.back);
      if (g) push("lamp", tag(g, id, color), sym);
    },
    dec(t: Target, o: Lamp, sym = true, color?: number) {
      const g = project(o, o.rings ?? (lod > 1 ? 5 : 3), o.segs ?? (lod > 1 ? 36 : 20));
      if (g) push(t, colored(t, g, color), sym);
      return g;
    },
    strip(t: Target, axis: Axis, sign: number, path: readonly (readonly [number, number])[], w: number, off = 0.004, sym = true, color?: number) {
      const g = strip(P, axis, sign, path, w, off, 0.3);
      if (g) push(t, colored(t, g, color), sym);
    },
    geo(t: Target, g: THREE.BufferGeometry, sym = false, color?: number) {
      push(t, colored(t, g, color), sym);
    },
    lampGeo(g: THREE.BufferGeometry, id: number, color: number, sym = false) {
      push("lamp", tag(g, id, color), sym);
    },
    head(p: THREE.Vector3) {
      out.heads.push(p.clone(), p.clone().setX(-p.x));
    },
    pen(fn: (p: Pen) => void) {
      pens.push(fn);
    },
  };
  return c;
}

export function buildParts(id: CarId, S: Surface, P: Projector, st: Style, lod: number, proxy: THREE.BufferGeometry): Parts {
  const out: Parts = { paint: [], trim: [], carbon: [], lamp: [], grille: [], glass: [], heads: [], panel: () => {} };
  const pens: ((p: Pen) => void)[] = [];
  const c = makeCtx(S, P, st, lod, out, pens, proxy);
  cabinFloor(c);
  if (lod > 1) interior(c);
  LOOKS[id](c);
  out.panel = (p) => pens.forEach((fn) => fn(p));
  return out;
}

// The body top inside the cabin shows through the glass: paint it black.
function cabinFloor(c: Ctx) {
  const g = c.S.sh.gh;
  const [f0, f3] = g ? [g.f[0] + 0.012, g.fG ?? g.f[3]] : [0, 0];
  if (!g) return;
  const wb = g.wb;
  c.pen((p) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const f = lerp(f0, f3, i / 40);
      const s = (f - g.f[0]) / (g.f[3] - g.f[0]);
      const xb = (wbAt(wb, s) * c.d.W) / 2 - 0.01;
      pts.push([f, c.S.vTop(f, xb)]);
    }
    pts.push([f3, 1.02], [f0, 1.02]);
    p.fill(pts, "#050505");
  });
}

function wbAt(k: readonly (readonly [number, number])[], s: number) {
  for (let i = 0; i < k.length - 1; i++) if (s <= k[i + 1][0]) return lerp(k[i][1], k[i + 1][1], (s - k[i][0]) / (k[i + 1][0] - k[i][0] || 1));
  return k[k.length - 1][1];
}

function interior(c: Ctx) {
  const { S, d, st } = c;
  const g = S.sh.gh;
  const fw = g ? g.f[0] : 0.5, f1 = g ? g.f[1] : 0.56, f2 = g ? g.f[2] : 0.68;
  const seatZ = S.zOf(lerp(f1, f2, 0.62));
  const floor = d.ride + 0.1;
  const belt = S.topY(S.fAt(seatZ), d.W * 0.4);
  const x = Math.min(0.38, d.W * 0.2);
  for (const sx of [1, -1]) {
    c.geo("interior", new RoundedBoxGeometry(0.5, 0.12, 0.5, 2, 0.05).translate(x * sx, floor + 0.12, seatZ + 0.1), false, st.seat);
    const back = new RoundedBoxGeometry(0.5, Math.max(0.45, belt - floor + 0.05), 0.12, 2, 0.05);
    back.rotateX(-0.32);
    back.translate(x * sx, floor + 0.12 + Math.max(0.45, belt - floor + 0.05) / 2, seatZ - 0.18);
    c.geo("interior", back, false, st.seat);
    c.geo("interior", new RoundedBoxGeometry(0.28, 0.16, 0.1, 2, 0.04).translate(x * sx, belt + 0.12, seatZ - 0.3), false, st.seat);
  }
  const dz = S.zOf(lerp(fw, f1, 0.55));
  const dy = S.topY(S.fAt(dz), 0) - 0.02;
  c.geo("interior", new RoundedBoxGeometry(d.W * 0.86, 0.2, 0.4, 2, 0.06).translate(0, dy - 0.1, dz), false, 0x141416);
  c.geo("interior", new RoundedBoxGeometry(0.22, 0.3, 0.9, 2, 0.05).translate(0, floor + 0.15, seatZ + 0.25), false, 0x18181a);
  const wheel = new THREE.TorusGeometry(0.17, 0.018, 8, 32);
  wheel.rotateX(-0.3);
  wheel.translate(x, dy - 0.05, dz - 0.32);
  c.geo("interior", wheel, false, S.sh.gh ? 0x111112 : 0x6a3c1c);
  c.geo("interior", new THREE.CylinderGeometry(0.03, 0.04, 0.3, 8).rotateX(Math.PI / 2 - 0.3).translate(x, dy - 0.02, dz - 0.18), false, 0x111112);
}

// ---- reusable exterior parts

export function mirrors(c: Ctx, f: number, color: "paint" | "trim" = "paint") {
  const { S } = c;
  const z = S.zOf(f);
  const gh = S.sh.gh;
  const xw = gh ? Math.min(S.width(f) - 0.02, (gh.wb[0][1] * c.d.W) / 2 + 0.1) : S.width(f);
  const y = S.topY(f, xw) + 0.1;
  const shell = new THREE.SphereGeometry(1, 20, 12);
  shell.scale(0.1, 0.06, 0.065);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) * 0.35);
  shell.computeVertexNormals();
  shell.rotateY(-0.12);
  shell.translate(xw + 0.06, y, z);
  c.geo(color, shell, true);
  const glass = new THREE.CircleGeometry(1, 20);
  glass.scale(0.085, 0.048, 1);
  glass.rotateY(Math.PI - 0.12);
  glass.translate(xw + 0.06, y, z - 0.024);
  c.geo("chrome", glass, true, 0x9aa4ae);
  const arm = new RoundedBoxGeometry(0.12, 0.025, 0.05, 2, 0.01);
  arm.translate(xw - 0.02, y - 0.03, z + 0.01);
  c.geo(color, arm, true);
}

export function wing(c: Ctx, o: { f: number; y: number; span: number; chord: number; angle?: number; plate?: number; mount?: "swan" | "post" | "none"; t?: Target }) {
  const { S } = c;
  const z = S.zOf(o.f);
  const sh = new THREE.Shape();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const th = 0.12 * 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
    sh[i ? "lineTo" : "moveTo"](t * o.chord, th * o.chord + Math.sin(t * Math.PI) * 0.04 * o.chord);
  }
  for (let i = n - 1; i > 0; i--) {
    const t = i / n;
    const th = 0.12 * 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
    sh.lineTo(t * o.chord, -th * o.chord * 0.6 + Math.sin(t * Math.PI) * 0.04 * o.chord);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: o.span, bevelEnabled: false, curveSegments: 4 });
  g.rotateY(Math.PI / 2);
  g.rotateX(o.angle ?? 0.12);
  g.translate(-o.span / 2, o.y, z + o.chord / 2);
  const t = o.t ?? "trim";
  c.geo(t, g);
  if (o.plate) {
    const ep = new RoundedBoxGeometry(0.012, o.plate, o.chord * 1.15, 1, 0.004);
    ep.translate(o.span / 2, o.y - o.plate * 0.3, z);
    c.geo(t, ep, true);
  }
  const mx = Math.min(0.42, o.span * 0.24);
  if (o.mount === "swan") {
    const base = S.topY(o.f - 0.05, mx);
    const h = o.y - base;
    const sw = new THREE.Shape();
    sw.moveTo(0, 0), sw.lineTo(0.22, 0), sw.quadraticCurveTo(0.12, h * 0.6, 0.05, h + 0.06), sw.lineTo(-0.06, h + 0.06), sw.quadraticCurveTo(0.0, h * 0.5, 0, 0);
    const sg = new THREE.ExtrudeGeometry(sw, { depth: 0.012, bevelEnabled: false, curveSegments: 6 });
    sg.rotateY(Math.PI / 2);
    sg.translate(mx, base - 0.02, z + 0.12);
    c.geo("trim", sg, true);
  } else if (o.mount === "post") {
    const base = S.topY(o.f, mx);
    const h = o.y - base + 0.02;
    const pg = new RoundedBoxGeometry(0.03, h, o.chord * 0.5, 1, 0.008);
    pg.translate(mx, base + h / 2 - 0.02, z);
    c.geo(t, pg, true);
  }
}

// Plate under the nose that follows the front outline.
export function splitter(c: Ctx, y: number, reach: number, depth = 0.45, t: Target = "trim") {
  const pts: THREE.Vector2[] = [];
  const W = c.S.width(0.04) * 0.92;
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const x = -W + (2 * W * i) / n;
    const h = c.hit(2, 1, x, y + 0.03);
    pts.push(new THREE.Vector2(x, (h.ok ? h.p.z : c.d.zF - 0.2) + reach));
  }
  const back = c.d.zF - depth;
  const sh = new THREE.Shape([new THREE.Vector2(-W, back), ...pts, new THREE.Vector2(W, back)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, y + 0.018, 0);
  c.geo(t, g);
}

export function diffuser(c: Ctx, fins: number, rise: number, len = 0.55, t: Target = "trim") {
  const { d } = c;
  const W = c.S.width(0.95) * 0.8;
  const z1 = d.zR + 0.06, z0 = z1 + len;
  const y0 = c.S.floor(0.8) + 0.005, y1 = y0 + rise;
  const plate = new THREE.BufferGeometry();
  plate.setAttribute("position", new THREE.Float32BufferAttribute([-W, y0, z0, W, y0, z0, -W, y1, z1, W, y1, z1], 3));
  plate.setIndex([0, 2, 1, 1, 2, 3]);
  plate.computeVertexNormals();
  c.geo(t, plate);
  for (let i = 0; i <= fins; i++) {
    const x = -W + (2 * W * i) / fins;
    const s = new THREE.Shape();
    s.moveTo(0, 0), s.lineTo(len, 0), s.lineTo(len, rise);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(x - 0.006, y0, z0);
    c.geo(t, g);
  }
}

// Round or oval tailpipes pushed through the rear face.
export function exhausts(c: Ctx, list: readonly (readonly [number, number, number, number?])[]) {
  for (const [x, y, r, oval = 1] of list) {
    const h = c.hit(2, -1, x, y);
    const z = (h.ok ? h.p.z : c.d.zR) - 0.03;
    const prof = [
      new THREE.Vector2(r * 0.86, 0.25),
      new THREE.Vector2(r * 0.86, -0.0),
      new THREE.Vector2(r, -0.01),
      new THREE.Vector2(r * 1.04, 0.03),
      new THREE.Vector2(r, 0.25),
    ];
    const g = new THREE.LatheGeometry(prof, 24);
    g.rotateX(Math.PI / 2);
    g.scale(1, 1 / oval, 1);
    g.translate(x, y, z);
    c.geo("chrome", g, false, 0xc9cbce);
    const cap = new THREE.CircleGeometry(r * 0.86, 20);
    cap.rotateY(Math.PI);
    cap.scale(1, 1 / oval, 1);
    cap.translate(x, y, z + 0.08);
    c.geo("trim", cap);
  }
}

// Chrome tube bumper along the outline at height y.
export function tubeBumper(c: Ctx, front: boolean, y: number, half: number, r = 0.022) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = -half + (2 * half * i) / 12;
    const h = c.hit(2, front ? 1 : -1, x, y);
    if (h.ok) pts.push(new THREE.Vector3(x, y, h.p.z + (front ? 0.035 : -0.035)));
  }
  if (pts.length < 3) return;
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 10, false);
  c.geo("chrome", g, false, 0xe8eaec);
}
