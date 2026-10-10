import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CarId } from "./contracts";
import { type Ctx, diffuser, exhausts, mirrors, splitter, tubeBumper, wing } from "./car-parts";
import { fin, frontLip, rearBumper, shut, skirts, swanWing } from "./car-kit";
import { LAMP } from "./car-mat";

const HOUSING = 0x24272b, RED = 0x8a0505, CORE = 0xff9a9a, LENS = 0xd8dde2, AMBER = 0xb86a10, WHITE = 0xe8eaec;

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

const front = (c: Ctx, x: number, y: number, sx: number, sy: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 2 as const, sign: 1, c: [x, y] as const, s: [sx, sy] as const, ...o });
const rear = (c: Ctx, x: number, y: number, sx: number, sy: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 2 as const, sign: -1, c: [x, y] as const, s: [sx, sy] as const, ...o });
const top = (x: number, z: number, sx: number, sz: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 1 as const, sign: 1, c: [x, z] as const, s: [sx, sz] as const, ...o });
const side = (z: number, y: number, sz: number, sy: number, o: Partial<Parameters<Ctx["lamp"]>[0]> = {}) => ({ axis: 0 as const, sign: 1, c: [z, y] as const, s: [sz, sy] as const, ...o });

// y in a frame pitched by `t`, for tilted decals aimed at world height y and depth z.
const ty = (t: number, y: number, z: number) => y * Math.cos(t) - z * Math.sin(t);

// Round lamp in a tilted frame, so it can sit on a sloped fender: housing, reflector bowl, projector and DRL dots.
function roundHead(c: Ctx, hx: number, hf: number, r: number, tl: number, dots: number, ring = false) {
  const hz = c.S.zOf(hf), yw = c.S.topY(hf, hx) - r * 0.55, hy = ty(tl, yw, hz);
  c.lamp(front(c, hx, hy, r, r * 0.92, { depth: 0.004, tilt: tl, off: 0.005 }), LAMP.none, 0x1c1f23);
  c.lamp(front(c, hx, hy, r * 0.86, r * 0.8, { depth: 0.03, tilt: tl, off: 0.006 }), LAMP.bowl, 0xaeb4bb);
  c.lamp(front(c, hx, hy, r * 0.36, r * 0.36, { off: 0.04, tilt: tl }), LAMP.head, LENS);
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2 + Math.PI / 4;
    c.lamp(front(c, hx + Math.cos(a) * r * 0.62, hy + Math.sin(a) * r * 0.58, r * 0.16, r * 0.07, { off: 0.032, tilt: tl, rot: a, e: 6 }), LAMP.drl, WHITE);
  }
  if (ring) c.lampStrip(2, 1, Array.from({ length: 33 }, (_, i) => [hx + Math.cos((i / 32) * Math.PI * 2) * r * 0.9, hy + Math.sin((i / 32) * Math.PI * 2) * r * 0.84] as const), 0.008, LAMP.drl, WHITE, 0.03);
  c.head(new THREE.Vector3(hx, yw, hz + 0.06));
}

function headAt(c: Ctx, x: number, y: number) {
  const h = c.hit(2, 1, x, y);
  if (h.ok) c.head(h.p.add(h.n.multiplyScalar(0.03)));
}

const circle = (x: number, y: number, rx: number, ry = rx, n = 32) => Array.from({ length: n + 1 }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * rx, y + Math.sin((i / n) * Math.PI * 2) * ry] as const);

function roundTail(c: Ctx, x: number, y: number, r: number, mid: number, midColor: number) {
  c.lamp(rear(c, x, y, r * 1.12, r * 1.12, { depth: 0.004, off: 0.005 }), LAMP.none, 0x120202);
  c.lamp(rear(c, x, y, r, r, { depth: 0.012, off: 0.006 }), LAMP.tail, RED);
  c.lampStrip(2, -1, circle(x, y, r * 0.72), 0.008, LAMP.core, CORE, 0.016);
  c.lamp(rear(c, x, y, r * 0.3, r * 0.3, { off: 0.018 }), mid, midColor);
}

function plate(c: Ctx, isFront: boolean, y: number) {
  c.lamp({ axis: 2, sign: isFront ? 1 : -1, c: [0, y], s: [0.26, 0.06], e: 8, off: 0.006 }, LAMP.none, 0xdfe2e5, false);
}

export const LOOKS: Record<CarId, (c: Ctx) => void> = {
  hyper(c) {
    const { d, S } = c;
    const tl = 0.95, hf = 0.06, hz = S.zOf(hf);
    for (const x of [0.64]) {
      const yw = S.topY(hf, x) - 0.02, y = ty(tl, yw, hz);
      c.lamp(front(c, x, y, 0.22, 0.05, { e: 8, rot: 0.12, depth: 0.004, off: 0.005, tilt: tl }), LAMP.none, 0x0c0d0f);
      c.lampStrip(2, 1, [[x - 0.19, y - 0.03], [x + 0.18, y + 0.02]], 0.012, LAMP.drl, WHITE, 0.012, true, tl);
      for (const k of [-0.08, 0.02, 0.11]) c.lamp(front(c, x + k, y + 0.01 + k * 0.12, 0.028, 0.014, { e: 6, off: 0.014, tilt: tl }), LAMP.head, LENS);
      c.head(new THREE.Vector3(x, yw, hz + 0.05));
    }
    frontLip(c, (a) => 0.2 + 0.05 * Math.min(1, a * 8), "carbon");
    c.dec("grille", front(c, 0, 0.24, 0.36, 0.06, { e: 6, tile: 0.06, off: 0.016 }), false);
    c.dec("grille", front(c, 0.66, 0.27, 0.16, 0.07, { e: 5, rot: 0.15, tile: 0.06, off: 0.016 }));
    splitter(c, S.floor(0.06) - 0.012, 0.08, 0.6, "carbon");
    c.dec("gloss", top(0, S.zOf(0.2), 0.16, 0.1, { e: 4 }), false);
    skirts(c, 0.14, 0.03, "carbon");
    c.dec("carbon", side(S.zOf(0.71), 0.62, 0.09, 0.04, { e: 4, rot: -0.3 }));
    c.lamp(rear(c, 0, 0.66, 0.84, 0.026, { e: 10, depth: 0.003 }), LAMP.none, 0x140303, false);
    c.lampStrip(2, -1, [[-0.8, 0.665], [0.8, 0.665]], 0.012, LAMP.tail, RED, 0.008, false);
    c.lampStrip(2, -1, [[-0.78, 0.665], [0.78, 0.665]], 0.004, LAMP.core, CORE, 0.011, false);
    c.lamp(rear(c, 0.72, 0.64, 0.12, 0.03, { e: 6, off: 0.009, rot: 0.06 }), LAMP.brake, RED);
    c.lampStrip(2, -1, [[0.62, 0.635], [0.83, 0.65]], 0.005, LAMP.core, CORE, 0.012);
    c.lamp(rear(c, 0.5, 0.64, 0.03, 0.01, { e: 6, off: 0.01 }), LAMP.reverse, WHITE);
    rearBumper(c, 0.5, "carbon", 0.02);
    c.dec("grille", rear(c, 0, 0.56, 0.62, 0.07, { e: 8, tile: 0.05, off: 0.02 }), false);
    exhausts(c, [[0.1, 0.56, 0.06], [-0.1, 0.56, 0.06]]);
    diffuser(c, 8, 0.36, 0.8, "carbon");
    fin(c, 0.7, 0.99, 0.13);
    c.dec("grille", top(0.28, S.zOf(0.86), 0.18, 0.13, { e: 6, tile: 0.05 }));
    wing(c, { f: 0.985, y: 0.86, span: 1.62, chord: 0.26, angle: 0.06, mount: "post", t: "carbon", plate: 0.1 });
    mirrors(c, 0.37, "trim");
    door(c, 0.3, 0.55, false);
    hood(c, 0.27, 0.6);
    deck(c, 0.8, 0.66);
    plate(c, false, 0.44);
  },
  gt3(c) {
    const { d, S } = c;
    roundHead(c, 0.6, 0.05, 0.145, 0.45, 4);
    frontLip(c, (a) => 0.24 + 0.04 * Math.min(1, a * 6), "carbon");
    c.dec("grille", front(c, 0, 0.32, 0.3, 0.075, { e: 5, tile: 0.06, off: 0.016 }), false);
    c.dec("grille", front(c, 0.64, 0.33, 0.16, 0.085, { e: 5, rot: 0.08, tile: 0.06, off: 0.016 }));
    c.dec("trim", top(0.22, d.zF - 0.42, 0.09, 0.1, { e: 5 }));
    splitter(c, c.S.floor(0.06) - 0.012, 0.06, 0.55, "carbon");
    for (const yy of [0.3, 0.4]) {
      const h = c.hit(2, 1, 0.84, yy);
      const g = new RoundedBoxGeometry(0.16, 0.008, 0.12, 1, 0.003);
      g.rotateZ(0.12);
      g.translate(0.86, yy, h.ok ? h.p.z - 0.04 : d.zF - 0.3);
      c.geo("carbon", g, true);
    }
    skirts(c, 0.17, 0.03, "carbon");
    c.lamp(rear(c, 0, 0.73, 0.82, 0.03, { e: 10, depth: 0.004 }), LAMP.none, 0x1a0404, false);
    c.lampStrip(2, -1, [[-0.78, 0.735], [0.78, 0.735]], 0.012, LAMP.tail, RED, 0.008, false);
    c.lampStrip(2, -1, [[-0.74, 0.735], [0.74, 0.735]], 0.004, LAMP.core, CORE, 0.01, false);
    c.lamp(rear(c, 0.74, 0.715, 0.1, 0.035, { e: 6, off: 0.009, rot: -0.08 }), LAMP.brake, RED);
    c.lampStrip(2, -1, [[0.66, 0.72], [0.82, 0.705]], 0.006, LAMP.core, CORE, 0.012);
    c.lamp(rear(c, 0.56, 0.72, 0.03, 0.012, { e: 6, off: 0.01 }), LAMP.reverse, WHITE);
    c.dec("grille", top(0, d.zR + 0.33, 0.42, 0.16, { e: 6, tile: 0.05 }), false);
    rearBumper(c, 0.3, "trim");
    c.dec("grille", rear(c, 0.58, 0.36, 0.16, 0.06, { e: 6, tile: 0.05, off: 0.02 }));
    exhausts(c, [[0.08, 0.36, 0.055], [-0.08, 0.36, 0.055]]);
    diffuser(c, 6, 0.22, 0.55, "carbon");
    plate(c, false, 0.56);
    swanWing(c, { f: 0.93, y: 1.25, span: 1.8, chord: 0.36, angle: 0.2, plate: 0.28 });
    mirrors(c, 0.4);
    door(c, 0.35, 0.6);
    hood(c, 0.35, 0.6, 0.06);
    deck(c, 0.85, 0.64);
    shut(c, 2, -1, [[-0.7, 0.66], [0.7, 0.66]], false);
  },
  jdm(c) {
    const { d } = c;
    rearBumper(c, 0.4);
    frontLip(c, 0.24);
    c.lamp(front(c, 0.58, 0.55, 0.2, 0.065, { e: 3, rot: -0.12, depth: 0.01 }), LAMP.none, HOUSING);
    c.lamp(front(c, 0.52, 0.56, 0.05, 0.04, { off: 0.014 }), LAMP.head, LENS);
    c.lamp(front(c, 0.66, 0.54, 0.05, 0.04, { off: 0.014 }), LAMP.head, LENS);
    headAt(c, 0.58, 0.55);
    c.dec("grille", front(c, 0, 0.32, 0.32, 0.09, { e: 4, tile: 0.08 }), false);
    c.lamp(front(c, 0.62, 0.33, 0.07, 0.035, { e: 4 }), LAMP.amber, AMBER);
    c.lamp(rear(c, 0.57, 0.78, 0.2, 0.1, { e: 3.2, depth: 0.004, off: 0.004 }), LAMP.none, 0x1a0505);
    roundTail(c, 0.49, 0.78, 0.07, LAMP.reverse, WHITE);
    roundTail(c, 0.66, 0.78, 0.07, LAMP.brake, RED);
    c.dec("gloss", rear(c, 0, 0.78, 0.32, 0.07, { e: 6 }), false);
    shut(c, 2, -1, [[-0.36, 0.69], [0.36, 0.69]], false);
    shut(c, 2, -1, [[0.36, 0.69], [0.37, 0.86]]);
    c.dec("gloss", rear(c, 0, 0.55, 0.3, 0.09, { e: 6 }), false);
    exhausts(c, [[-0.52, 0.24, 0.06, 1.3]]);
    diffuser(c, 4, 0.1, 0.4);
    skirts(c, 0.07, 0.015);
    wing(c, { f: 0.955, y: 1.08, span: 1.52, chord: 0.24, angle: 0.06, mount: "post", t: "paint", plate: 0.08 });
    mirrors(c, 0.415);
    door(c, 0.36, 0.635);
    hood(c, 0.37, 0.6, 0.05);
    deck(c, 0.83, 0.62);
    plate(c, false, 0.55);
  },
  muscle(c) {
    const { d } = c;
    rearBumper(c, 0.4);
    frontLip(c, 0.26);
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
    for (const y of [0.8, 0.84]) c.lampStrip(2, -1, [[-0.72, y], [-0.2, y]], 0.005, LAMP.core, CORE, 0.012);
    c.lamp(rear(c, 0.66, 0.82, 0.1, 0.03, { e: 6, off: 0.012 }), LAMP.brake, RED);
    shut(c, 2, -1, [[-0.7, 0.74], [0.7, 0.74]], false);
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
    rearBumper(c, 0.42);
    frontLip(c, 0.3);
    skirts(c, 0.12, 0.01);
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
    c.lamp(rear(c, 0.66, 0.78, 0.13, 0.12, { e: 3.5, rot: 0.05, depth: 0.004, off: 0.004 }), LAMP.none, 0x160303);
    c.lamp(rear(c, 0.68, 0.8, 0.1, 0.09, { e: 3.5, rot: 0.05, depth: 0.012, off: 0.006 }), LAMP.tail, RED);
    c.lampStrip(2, -1, [[0.6, 0.86], [0.76, 0.85], [0.77, 0.74]], 0.01, LAMP.core, CORE, 0.016);
    c.lamp(rear(c, 0.66, 0.76, 0.045, 0.03, { e: 6, off: 0.018 }), LAMP.brake, RED);
    c.lamp(rear(c, 0.7, 0.71, 0.035, 0.016, { e: 6, off: 0.016 }), LAMP.reverse, WHITE);
    c.lamp(rear(c, 0.62, 0.38, 0.05, 0.014, { e: 6, off: 0.016 }), LAMP.tail, RED);
    exhausts(c, [[-0.42, 0.26, 0.07], [-0.27, 0.26, 0.07]]);
    shut(c, 2, -1, [[-0.5, 0.6], [0.5, 0.6]], false);
    shut(c, 2, -1, [[0.5, 0.6], [0.52, 0.92]]);
    c.dec("gloss", rear(c, 0, 0.66, 0.24, 0.05, { e: 6 }), false);
    diffuser(c, 3, 0.08, 0.3);
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
    rearBumper(c, 0.36);
    frontLip(c, 0.2, "gloss");
    skirts(c, 0.08, 0.012);
    c.lamp(top(0.66, d.zF - 0.46, 0.08, 0.24, { e: 4, rot: -0.3, depth: 0.006 }), LAMP.none, HOUSING);
    c.lamp(top(0.66, d.zF - 0.42, 0.03, 0.03, { off: 0.01 }), LAMP.head, LENS);
    c.lamp(top(0.68, d.zF - 0.52, 0.03, 0.03, { off: 0.01 }), LAMP.head, LENS);
    c.lampStrip(1, 1, [[0.58, d.zF - 0.3], [0.71, d.zF - 0.44], [0.74, d.zF - 0.6]], 0.012, LAMP.drl, WHITE, 0.012);
    headAt(c, 0.66, 0.52);
    c.dec("grille", front(c, 0, 0.3, 0.5, 0.11, { e: 4, tile: 0.07 }), false);
    c.dec("trim", side(d.axF - 0.62, 0.62, 0.1, 0.05, { e: 6, rot: -0.3 }));
    splitter(c, c.S.floor(0.06) - 0.01, 0.02, 0.45);
    roundTail(c, 0.52, 0.8, 0.07, LAMP.reverse, WHITE);
    roundTail(c, 0.7, 0.8, 0.07, LAMP.brake, RED);
    shut(c, 2, -1, [[-0.4, 0.7], [0.4, 0.7]], false);
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
    rearBumper(c, 0.44);
    frontLip(c, 0.22);
    skirts(c, 0.1, 0.012);
    c.lamp(front(c, 0.62, 0.6, 0.15, 0.045, { e: 5, rot: -0.1, depth: 0.006 }), LAMP.none, HOUSING);
    c.lamp(front(c, 0.58, 0.6, 0.035, 0.03, { off: 0.012 }), LAMP.head, LENS);
    for (let i = 0; i < 4; i++) c.lamp(front(c, 0.66 + (i % 2) * 0.05, 0.58 + (i >> 1) * 0.04, 0.015, 0.015, { off: 0.012 }), LAMP.drl, WHITE);
    headAt(c, 0.6, 0.6);
    c.dec("grille", front(c, 0, 0.3, 0.42, 0.06, { e: 6, tile: 0.05 }), false);
    c.lamp(rear(c, 0, 0.875, 0.86, 0.034, { e: 10, depth: 0.003, off: 0.004 }), LAMP.none, 0x140303, false);
    c.lampStrip(2, -1, [[-0.82, 0.87], [-0.4, 0.88], [0.4, 0.88], [0.82, 0.87]], 0.02, LAMP.tail, RED, 0.007, false);
    c.lampStrip(2, -1, [[-0.8, 0.872], [-0.4, 0.88], [0.4, 0.88], [0.8, 0.872]], 0.004, LAMP.core, CORE, 0.01, false);
    c.lamp(rear(c, 0.74, 0.855, 0.11, 0.03, { e: 6, off: 0.009 }), LAMP.brake, RED);
    c.lampStrip(2, -1, [[0.64, 0.85], [0.84, 0.855]], 0.006, LAMP.core, CORE, 0.012);
    c.lamp(rear(c, 0.52, 0.86, 0.04, 0.01, { e: 6, off: 0.01 }), LAMP.reverse, WHITE);
    shut(c, 2, -1, [[-0.62, 0.8], [0.62, 0.8]], false);
    c.lampStrip(2, -1, [[0.7, 0.3], [0.82, 0.3]], 0.012, LAMP.tail, RED, 0.014);
    diffuser(c, 5, 0.14, 0.45);
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
    c.lamp(rear(c, 0.56, 0.52, 0.018, 0.018, { off: 0.012 }), LAMP.core, CORE);
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
