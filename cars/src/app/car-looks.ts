import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CarId } from "./contracts";
import { type Ctx, diffuser, exhausts, mirrors, splitter, tubeBumper, wing } from "./car-parts";
import { LAMP } from "./car-mat";

const HOUSING = 0x24272b, RED = 0x7a0606, LENS = 0xd8dde2, AMBER = 0xb86a10, WHITE = 0xe8eaec;

// Panel gaps: door outline and handle.
function door(c: Ctx, f0: number, f1: number, handle = true, flush = false) {
  const g = c.S.sh.gh;
  const top = (f: number) => (g ? c.S.vTop(f, (c.d.W / 2) * 0.82) : 0.6);
  c.pen((p) => {
    p.line(f0, 0.21, f0 + 0.004, top(f0));
    p.line(f1, 0.21, f1 - 0.01, top(f1));
    p.line(f0, 0.21, f1, 0.21);
    if (handle) {
      if (flush) p.slot(f1 - 0.07, 0.43, 0.045, 0.012);
      else p.slot(f1 - 0.06, 0.44, 0.035, 0.008);
    }
  });
}

function hood(c: Ctx, fBack: number, vEdge: number, fFront = 0.03) {
  c.pen((p) => {
    p.line(fFront, vEdge, fBack, vEdge + 0.02);
    p.line(fBack, vEdge + 0.02, fBack, 1.0);
  });
}

function deck(c: Ctx, f0: number, vEdge: number, f1 = 0.985) {
  c.pen((p) => {
    p.line(f0, vEdge, f1, vEdge);
    p.line(f0, vEdge, f0, 1.0);
  });
}

function intake(c: Ctx, pts: readonly (readonly [number, number])[]) {
  c.pen((p) => p.fill(pts, "#060606"));
}

const front = (c: Ctx, x: number, y: number, sx: number, sy: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 2 as const, sign: 1, c: [x, y] as const, s: [sx, sy] as const, ...o });
const rear = (c: Ctx, x: number, y: number, sx: number, sy: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 2 as const, sign: -1, c: [x, y] as const, s: [sx, sy] as const, ...o });
const top = (x: number, z: number, sx: number, sz: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 1 as const, sign: 1, c: [x, z] as const, s: [sx, sz] as const, ...o });
const side = (z: number, y: number, sz: number, sy: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 0 as const, sign: 1, c: [z, y] as const, s: [sz, sy] as const, ...o });

// y in a frame pitched by `t`, for tilted decals aimed at world height y and depth z.
const ty = (t: number, y: number, z: number) => y * Math.cos(t) - z * Math.sin(t);

function headAt(c: Ctx, x: number, y: number) {
  const h = c.hit(2, 1, x, y);
  if (h.ok) c.head(h.p.add(h.n.multiplyScalar(0.03)));
}

// Black lower rear bumper, so the tail does not read as one painted tub.
function valance(c: Ctx, top: number, half: number) {
  const y0 = c.S.floor(0.97);
  c.dec("trim", { axis: 2, sign: -1, c: [0, (y0 + top) / 2], s: [half, (top - y0) / 2], e: 8 }, false);
}

function plate(c: Ctx, isFront: boolean, y: number) {
  c.lamp({ axis: 2, sign: isFront ? 1 : -1, c: [0, y], s: [0.26, 0.06], e: 8, off: 0.006 }, LAMP.none, 0xdfe2e5, false);
}

export const LOOKS: Record<CarId, (c: Ctx) => void> = {
  hyper(c) {
    const { d } = c;
    c.lamp(top(0.63, d.zF - 0.34, 0.07, 0.17, { e: 6, rot: -0.45, depth: 0.004 }), LAMP.none, HOUSING);
    c.lamp(top(0.6, d.zF - 0.29, 0.025, 0.025, { off: 0.008 }), LAMP.head, LENS);
    c.lamp(top(0.65, d.zF - 0.36, 0.025, 0.025, { off: 0.008 }), LAMP.head, LENS);
    c.lampStrip(1, 1, [[0.54, d.zF - 0.2], [0.7, d.zF - 0.4]], 0.01, LAMP.drl, WHITE, 0.01);
    headAt(c, 0.6, 0.42);
    c.dec("grille", front(c, 0.5, 0.22, 0.24, 0.07, { e: 6, rot: 0.1, tile: 0.08 }));
    c.dec("grille", front(c, 0, 0.2, 0.22, 0.05, { e: 6, tile: 0.08 }), false);
    splitter(c, c.S.floor(0.06) - 0.01, 0.03, 0.5);
    intake(c, [[0.6, 0.32], [0.73, 0.32], [0.75, 0.47], [0.62, 0.4]]);
    c.dec("grille", side(d.axR + 0.62, 0.55, 0.17, 0.09, { e: 6, tile: 0.08, off: 0.003 }));
    c.pen((p) => {
      for (let i = 0; i < 3; i++) p.slot(0.16 + i * 0.03, 0.86, 0.018, 0.08);
    });
    c.lampStrip(2, -1, [[-0.7, 0.86], [-0.3, 0.88], [0.3, 0.88], [0.7, 0.86]], 0.025, LAMP.tail, RED, 0.006, false);
    c.lamp(rear(c, 0.78, 0.8, 0.1, 0.035, { e: 6 }), LAMP.brake, RED);
    c.lamp(rear(c, 0.55, 0.8, 0.05, 0.02, { e: 6 }), LAMP.reverse, WHITE);
    c.dec("grille", rear(c, 0, 0.62, 0.7, 0.12, { e: 8, tile: 0.06 }), false);
    exhausts(c, [[0.09, 0.62, 0.05], [-0.09, 0.62, 0.05]]);
    diffuser(c, 6, 0.24, 0.7);
    wing(c, { f: 0.955, y: 0.95, span: 1.6, chord: 0.3, angle: 0.08, mount: "post", t: "paint" });
    mirrors(c, 0.36, "trim");
    door(c, 0.29, 0.53, false);
    hood(c, 0.27, 0.62);
    deck(c, 0.72, 0.7);
    plate(c, false, 0.48);
  },
  gt3(c) {
    const { d } = c;
    const tl = 0.75, hx = 0.6, hz = d.zF - 0.3, hy = ty(tl, 0.72, hz);
    c.lamp(front(c, hx, hy, 0.11, 0.1, { depth: 0.012, tilt: tl }), LAMP.none, 0x8d939b);
    c.lamp(front(c, hx, hy, 0.065, 0.06, { off: 0.016, tilt: tl }), LAMP.head, LENS);
    for (let i = 0; i < 4; i++) c.lamp(front(c, hx + Math.cos(i * 1.57 + 0.78) * 0.085, hy + Math.sin(i * 1.57 + 0.78) * 0.075, 0.016, 0.012, { off: 0.016, tilt: tl }), LAMP.drl, WHITE);
    c.head(new THREE.Vector3(hx, 0.72, hz + 0.05));
    c.dec("grille", front(c, 0, 0.3, 0.28, 0.08, { e: 5, tile: 0.06 }), false);
    c.dec("grille", front(c, 0.62, 0.3, 0.18, 0.08, { e: 5, rot: 0.1, tile: 0.06 }));
    c.dec("trim", top(0, d.zF - 0.35, 0.3, 0.12, { e: 5 }), false);
    splitter(c, c.S.floor(0.06) - 0.01, 0.05, 0.5);
    for (const yy of [0.3, 0.38]) {
      const h = c.hit(2, 1, 0.82, yy);
      const g = new RoundedBoxGeometry(0.16, 0.008, 0.1, 1, 0.003);
      g.rotateZ(0.12);
      g.translate(0.84, yy, h.ok ? h.p.z - 0.03 : d.zF - 0.3);
      c.geo("trim", g, true);
    }
    c.lampStrip(2, -1, [[-0.6, 0.83], [0.6, 0.83]], 0.018, LAMP.tail, RED, 0.006, false);
    c.lamp(rear(c, 0.72, 0.8, 0.13, 0.04, { e: 6 }), LAMP.brake, RED);
    c.lamp(rear(c, 0.55, 0.8, 0.03, 0.02, { e: 6 }), LAMP.reverse, WHITE);
    c.dec("grille", top(0, d.zR + 0.3, 0.45, 0.16, { e: 6, tile: 0.05 }), false);
    c.dec("trim", rear(c, 0, 0.3, 0.8, 0.13, { e: 8 }), false);
    exhausts(c, [[0.07, 0.4, 0.055], [-0.07, 0.4, 0.055]]);
    diffuser(c, 5, 0.18, 0.5);
    wing(c, { f: 0.955, y: 1.28, span: 1.86, chord: 0.36, angle: 0.15, plate: 0.22, mount: "swan" });
    mirrors(c, 0.355);
    door(c, 0.305, 0.58);
    hood(c, 0.3, 0.6, 0.06);
    deck(c, 0.8, 0.66);
    plate(c, false, 0.55);
  },
  jdm(c) {
    const { d } = c;
    valance(c, 0.36, 0.66);
    c.lamp(front(c, 0.58, 0.55, 0.2, 0.065, { e: 3, rot: -0.12, depth: 0.01 }), LAMP.none, HOUSING);
    c.lamp(front(c, 0.52, 0.56, 0.05, 0.04, { off: 0.014 }), LAMP.head, LENS);
    c.lamp(front(c, 0.66, 0.54, 0.05, 0.04, { off: 0.014 }), LAMP.head, LENS);
    headAt(c, 0.58, 0.55);
    c.dec("grille", front(c, 0, 0.32, 0.32, 0.09, { e: 4, tile: 0.08 }), false);
    c.lamp(front(c, 0.62, 0.33, 0.07, 0.035, { e: 4 }), LAMP.amber, AMBER);
    for (const x of [0.48, 0.66]) {
      c.lamp(rear(c, x, 0.78, 0.075, 0.075, { depth: 0.008 }), LAMP.tail, RED);
      c.lamp(rear(c, x, 0.78, 0.028, 0.028, { off: 0.012 }), x < 0.6 ? LAMP.reverse : LAMP.brake, x < 0.6 ? WHITE : RED);
    }
    c.dec("trim", rear(c, 0, 0.78, 0.36, 0.08, { e: 6 }), false);
    exhausts(c, [[-0.5, 0.33, 0.055, 1.3]]);
    wing(c, { f: 0.955, y: 1.08, span: 1.52, chord: 0.24, angle: 0.06, mount: "post", t: "paint", plate: 0.08 });
    mirrors(c, 0.415);
    door(c, 0.36, 0.635);
    hood(c, 0.37, 0.6, 0.05);
    deck(c, 0.83, 0.62);
    plate(c, false, 0.55);
  },
  muscle(c) {
    const { d } = c;
    valance(c, 0.36, 0.78);
    c.dec("grille", front(c, 0, 0.72, 0.74, 0.14, { e: 8, tile: 0.07 }), false);
    for (const x of [0.6, 0.42]) {
      c.lamp(front(c, x, 0.72, 0.075, 0.075, { off: 0.008, depth: 0.01 }), LAMP.none, HOUSING);
      c.lamp(front(c, x, 0.72, 0.05, 0.05, { off: 0.016 }), LAMP.head, LENS);
      c.lampStrip(2, 1, Array.from({ length: 25 }, (_, i) => [x + Math.cos((i / 24) * Math.PI * 2) * 0.072, 0.72 + Math.sin((i / 24) * Math.PI * 2) * 0.072] as const), 0.01, LAMP.drl, WHITE, 0.018);
    }
    headAt(c, 0.6, 0.72);
    c.dec("grille", front(c, 0, 0.36, 0.5, 0.07, { e: 6, tile: 0.07 }), false);
    c.dec("trim", rear(c, 0, 0.82, 0.78, 0.1, { e: 10 }), false);
    c.lampStrip(2, -1, [[-0.74, 0.82], [0.74, 0.82]], 0.07, LAMP.tail, RED, 0.008, false);
    c.lamp(rear(c, 0.66, 0.82, 0.1, 0.03, { e: 6, off: 0.012 }), LAMP.brake, RED);
    c.lamp(rear(c, 0.12, 0.82, 0.08, 0.025, { e: 6, off: 0.012 }), LAMP.reverse, WHITE);
    exhausts(c, [[0.55, 0.32, 0.05], [0.42, 0.32, 0.05], [-0.42, 0.32, 0.05], [-0.55, 0.32, 0.05]]);
    wing(c, { f: 0.975, y: 1.01, span: 1.5, chord: 0.12, angle: -0.25, mount: "none", t: "paint" });
    mirrors(c, 0.445);
    door(c, 0.39, 0.665);
    hood(c, 0.41, 0.58, 0.02);
    c.pen((p) => p.fill([[0.12, 0.92], [0.3, 0.9], [0.3, 1.02], [0.12, 1.02]], "#0d0d0d"));
    deck(c, 0.86, 0.6);
    plate(c, false, 0.6);
  },
  rally(c) {
    const { d } = c;
    valance(c, 0.34, 0.72);
    c.lamp(front(c, 0.58, 0.68, 0.16, 0.055, { e: 5, rot: 0.08, depth: 0.008 }), LAMP.none, HOUSING);
    c.lamp(front(c, 0.6, 0.68, 0.045, 0.035, { off: 0.014 }), LAMP.head, LENS);
    c.lampStrip(2, 1, [[0.44, 0.66], [0.66, 0.65], [0.72, 0.69]], 0.012, LAMP.drl, WHITE, 0.014);
    headAt(c, 0.58, 0.68);
    c.dec("grille", front(c, 0, 0.66, 0.36, 0.05, { e: 6, tile: 0.06 }), false);
    c.dec("grille", front(c, 0, 0.38, 0.46, 0.12, { e: 5, tile: 0.06 }), false);
    for (const x of [-0.42, -0.14, 0.14, 0.42]) {
      const h = c.hit(2, 1, x, 0.52);
      const z = (h.ok ? h.p.z : d.zF) + 0.06;
      const can = new THREE.CylinderGeometry(0.085, 0.07, 0.07, 24);
      can.rotateX(Math.PI / 2);
      can.translate(x, 0.52, z);
      c.geo("trim", can);
      const lens = new THREE.CircleGeometry(0.075, 24);
      lens.translate(x, 0.52, z + 0.036);
      c.lampGeo(lens, LAMP.aux, 0xf0f2f4);
    }
    c.geo("trim", new RoundedBoxGeometry(1.0, 0.025, 0.03, 1, 0.01).translate(0, 0.52, (c.hit(2, 1, 0, 0.52).p.z || d.zF) + 0.05));
    c.lamp(rear(c, 0.6, 0.76, 0.13, 0.065, { e: 4, rot: 0.05, depth: 0.008 }), LAMP.tail, RED);
    c.lamp(rear(c, 0.56, 0.77, 0.05, 0.025, { e: 6, off: 0.012 }), LAMP.brake, RED);
    c.lamp(rear(c, 0.68, 0.74, 0.03, 0.02, { e: 6, off: 0.012 }), LAMP.reverse, WHITE);
    exhausts(c, [[-0.45, 0.3, 0.06]]);
    const rf = c.S.zOf(0.62);
    const scoop = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    scoop.scale(0.22, 0.07, 0.3);
    scoop.translate(0, d.H - 0.012, rf);
    c.geo("paint", scoop);
    c.geo("trim", new THREE.CircleGeometry(1, 16, 0, Math.PI).scale(0.17, 0.05, 1).translate(0, d.H - 0.005, rf + 0.25));
    wing(c, { f: 0.9, y: d.H * 0.985, span: 1.25, chord: 0.24, angle: -0.08, plate: 0.06, mount: "none", t: "paint" });
    for (const z of [d.axF - 0.42, d.axR - 0.42]) {
      const g = new RoundedBoxGeometry(0.24, 0.26, 0.012, 1, 0.004);
      g.translate(d.tf / 2, d.ride + 0.06, z);
      c.geo("trim", g, true);
    }
    mirrors(c, 0.31, "trim");
    door(c, 0.33, 0.58);
    c.pen((p) => p.line(0.58, 0.21, 0.82, 0.21));
    hood(c, 0.27, 0.62, 0.04);
    plate(c, false, 0.55);
  },
  v12(c) {
    const { d } = c;
    valance(c, 0.3, 0.7);
    c.lamp(top(0.66, d.zF - 0.46, 0.08, 0.24, { e: 4, rot: -0.3, depth: 0.006 }), LAMP.none, HOUSING);
    c.lamp(top(0.66, d.zF - 0.42, 0.03, 0.03, { off: 0.01 }), LAMP.head, LENS);
    c.lamp(top(0.68, d.zF - 0.52, 0.03, 0.03, { off: 0.01 }), LAMP.head, LENS);
    c.lampStrip(1, 1, [[0.58, d.zF - 0.3], [0.71, d.zF - 0.44], [0.74, d.zF - 0.6]], 0.012, LAMP.drl, WHITE, 0.012);
    headAt(c, 0.66, 0.52);
    c.dec("grille", front(c, 0, 0.3, 0.5, 0.11, { e: 4, tile: 0.07 }), false);
    c.dec("trim", side(d.axF - 0.62, 0.62, 0.1, 0.05, { e: 6, rot: -0.3 }));
    splitter(c, c.S.floor(0.06) - 0.01, 0.02, 0.45);
    for (const x of [0.5, 0.7]) {
      c.lamp(rear(c, x, 0.8, 0.07, 0.07, { depth: 0.008 }), LAMP.tail, RED);
      c.lamp(rear(c, x, 0.8, 0.026, 0.026, { off: 0.012 }), x < 0.6 ? LAMP.reverse : LAMP.brake, x < 0.6 ? WHITE : RED);
    }
    exhausts(c, [[0.18, 0.36, 0.05], [0.31, 0.36, 0.05], [-0.18, 0.36, 0.05], [-0.31, 0.36, 0.05]]);
    diffuser(c, 4, 0.14, 0.45);
    mirrors(c, 0.46);
    door(c, 0.39, 0.66);
    hood(c, 0.42, 0.58, 0.04);
    deck(c, 0.86, 0.66);
    plate(c, false, 0.5);
  },
  ev(c) {
    const { d } = c;
    valance(c, 0.36, 0.76);
    c.lamp(front(c, 0.62, 0.6, 0.15, 0.045, { e: 5, rot: -0.1, depth: 0.006 }), LAMP.none, HOUSING);
    c.lamp(front(c, 0.58, 0.6, 0.035, 0.03, { off: 0.012 }), LAMP.head, LENS);
    for (let i = 0; i < 4; i++) c.lamp(front(c, 0.66 + (i % 2) * 0.05, 0.58 + (i >> 1) * 0.04, 0.015, 0.015, { off: 0.012 }), LAMP.drl, WHITE);
    headAt(c, 0.6, 0.6);
    c.dec("grille", front(c, 0, 0.3, 0.42, 0.06, { e: 6, tile: 0.05 }), false);
    c.lampStrip(2, -1, [[-0.8, 0.87], [-0.4, 0.88], [0.4, 0.88], [0.8, 0.87]], 0.028, LAMP.tail, RED, 0.006, false);
    c.lamp(rear(c, 0.72, 0.85, 0.12, 0.035, { e: 6, off: 0.01 }), LAMP.brake, RED);
    c.lamp(rear(c, 0.5, 0.86, 0.04, 0.012, { e: 6, off: 0.01 }), LAMP.reverse, WHITE);
    diffuser(c, 3, 0.1, 0.4);
    mirrors(c, 0.35, "trim");
    door(c, 0.29, 0.515, true, true);
    door(c, 0.525, 0.73, true, true);
    hood(c, 0.27, 0.6, 0.04);
    deck(c, 0.88, 0.62);
    plate(c, false, 0.55);
  },
  classic(c) {
    const { d, S } = c;
    for (const x of [0.5]) {
      c.lamp(front(c, x, 0.62, 0.1, 0.1, { depth: 0.015, rings: 6 }), LAMP.none, 0xc8ccd0);
      c.lamp(front(c, x, 0.62, 0.065, 0.065, { off: 0.02 }), LAMP.head, LENS);
    }
    headAt(c, 0.5, 0.62);
    c.dec("grille", front(c, 0, 0.42, 0.24, 0.11, { e: 2.4, tile: 0.08, depth: -0.01 }), false);
    c.strip("chrome", 2, 1, [[-0.24, 0.42], [0.24, 0.42]], 0.018, 0.02, false, 0xe8eaec);
    c.lamp(front(c, 0.58, 0.42, 0.04, 0.025, { e: 3 }), LAMP.amber, AMBER);
    tubeBumper(c, true, 0.4, 0.62);
    tubeBumper(c, false, 0.38, 0.6);
    c.lamp(rear(c, 0.56, 0.52, 0.05, 0.05, { depth: 0.006 }), LAMP.tail, RED);
    c.lamp(rear(c, 0.56, 0.44, 0.03, 0.03, { off: 0.008 }), LAMP.brake, RED);
    exhausts(c, [[0.12, 0.26, 0.035], [-0.12, 0.26, 0.035]]);
    const fw = 0.5;
    const zb = S.zOf(fw), yb = S.topY(fw, 0) - 0.01;
    const hw = S.width(fw) * 0.8, ht = 0.34, lean = 0.6;
    const g = new THREE.PlaneGeometry(2 * hw, ht, 16, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), t = (p.getY(i) + ht / 2) / ht;
      const wrap = (x / hw) ** 2 * 0.12;
      p.setXYZ(i, x * (1 - t * 0.12), yb + t * ht * Math.cos(lean * 0.6), zb - t * ht * Math.sin(lean) - wrap);
    }
    g.computeVertexNormals();
    c.geo("glass", g);
    const edge: THREE.Vector3[] = [];
    for (const [u, v] of [[-1, 0], [-1, 1], [1, 1], [1, 0]] as const) {
      const t = v, x = u * hw * (1 - t * 0.12);
      edge.push(new THREE.Vector3(x, yb + t * ht * Math.cos(lean * 0.6), zb - t * ht * Math.sin(lean) - 0.12));
    }
    c.geo("chrome", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, false, "catmullrom", 0.2), 40, 0.012, 8), false, 0xe8eaec);
    c.pen((p) => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 20; i++) pts.push([0.5 + (i / 20) * 0.2, S.vTop(0.5 + (i / 20) * 0.2, S.width(0.6) * 0.76)]);
      pts.push([0.7, 1.02], [0.5, 1.02]);
      p.fill(pts, "#120d0b");
    });
    mirrors(c, 0.5);
    door(c, 0.5, 0.66);
    hood(c, 0.47, 0.6, 0.06);
    deck(c, 0.78, 0.62);
  },
};
