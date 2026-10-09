import * as THREE from "three";
import { prep, paint } from "./car-curve";
import { mergeAll } from "./car-body";

export type RimKind = "y5" | "ten" | "mesh" | "five" | "six" | "multi" | "aero" | "wire";
export type WheelLook = { rim: RimKind; inch: number; face: number; lip: number; caliper: number; lock?: boolean; tread: "street" | "slick" | "rally" | "classic"; dish?: number };

// Wheel parts, axle along +x, outer face toward +x, centered on the wheel.
export function buildWheel(R: number, width: number, look: WheelLook, lod: number) {
  const rimR = Math.min(R - 0.06, (look.inch * 0.0254) / 2);
  const seg = lod > 1 ? 72 : lod > 0 ? 48 : 28;
  return { tire: tire(R, rimR, width, seg, lod > 0 ? 36 : 16), rim: rim(rimR, width, look, seg, lod), brake: brake(rimR, look.caliper, seg) };
}

function lathe(prof: readonly (readonly [number, number])[], seg: number, uScale = 1, colors?: readonly number[]) {
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const n = prof.length;
  let total = 0;
  const acc = [0];
  for (let i = 1; i < n; i++) acc.push((total += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])));
  const c = new THREE.Color();
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const [x, r] = prof[i];
      pos.push(x, Math.cos(a) * r, Math.sin(a) * r);
      uv.push((s / seg) * uScale, acc[i] / (total || 1));
      if (colors) c.set(colors[i]), col.push(c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < seg; s++)
    for (let i = 0; i < n - 1; i++) {
      const p = s * n + i, q = p + n;
      idx.push(p, p + 1, q, q, p + 1, q + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function smoothProfile(pts: readonly (readonly [number, number])[], n: number) {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, "centripetal");
  return c.getSpacedPoints(n).map((p) => [p.x, p.y] as const);
}

function tire(R: number, rimR: number, w: number, seg: number, np: number) {
  const h = w / 2, sd = R - rimR;
  const prof = smoothProfile(
    [
      [-h + 0.012, rimR - 0.004],
      [-h - 0.004, rimR + sd * 0.25],
      [-h - 0.006, rimR + sd * 0.55],
      [-h + 0.004, R - 0.02],
      [-h + 0.03, R - 0.002],
      [0, R],
      [h - 0.03, R - 0.002],
      [h - 0.004, R - 0.02],
      [h + 0.006, rimR + sd * 0.55],
      [h + 0.004, rimR + sd * 0.25],
      [h - 0.012, rimR - 0.004],
    ],
    np,
  );
  return prep(lathe(prof, seg * 2, 7), false);
}

function chaikin(p: [number, number][], it: number) {
  for (let k = 0; k < it; k++) {
    const o: [number, number][] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = o;
  }
  return p;
}

// One spoke window between spokes of constant width `sw`.
function windowPath(th: number, n: number, r0: number, r1: number, sw: number, k = 8, it = 2) {
  const half = (r: number) => Math.max(0.02, Math.PI / n - sw / 2 / r);
  const p: [number, number][] = [];
  const at = (r: number, a: number): [number, number] => [Math.cos(th + a) * r, Math.sin(th + a) * r];
  for (let i = 0; i <= k; i++) p.push(at(r1, -half(r1) + (2 * half(r1) * i) / k));
  for (let i = 1; i < k; i++) {
    const r = r1 + ((r0 - r1) * i) / k;
    p.push(at(r, half(r)));
  }
  for (let i = 0; i <= k; i++) p.push(at(r0, half(r0) - (2 * half(r0) * i) / k));
  for (let i = 1; i < k; i++) {
    const r = r0 + ((r1 - r0) * i) / k;
    p.push(at(r, -half(r)));
  }
  return chaikin(p, it);
}

function rim(rimR: number, w: number, look: WheelLook, seg: number, lod: number) {
  const h = w / 2;
  const xo = h - 0.004;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    lathe(
      [
        [xo - 0.03, rimR * 0.9],
        [xo - 0.004, rimR - 0.006],
        [xo + 0.004, rimR + 0.004],
        [xo + 0.002, rimR + 0.014],
        [xo - 0.012, rimR + 0.016],
        [xo - 0.022, rimR - 0.002],
        [-h + 0.02, rimR - 0.012],
        [-h + 0.004, rimR + 0.012],
        [-h - 0.004, rimR + 0.01],
      ],
      seg,
      1,
      [look.face, look.lip, look.lip, look.lip, look.lip, 0x2a2b2e, 0x2a2b2e, 0x3a3b3e, 0x3a3b3e],
    ),
  );
  const faceX = xo - 0.045;
  const dish = look.dish ?? 0.03;
  if (look.rim === "wire") {
    const sp = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4, 1, true);
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const N = lod > 0 ? 40 : 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const lean = (i % 2 ? 1 : -1) * 0.35;
      const row = i % 4 < 2 ? 0.02 : -0.04;
      const p0 = new THREE.Vector3(faceX + row, Math.cos(a + lean) * 0.05, Math.sin(a + lean) * 0.05);
      const p1 = new THREE.Vector3(faceX - 0.02, Math.cos(a) * rimR * 0.93, Math.sin(a) * rimR * 0.93);
      v.subVectors(p1, p0);
      const g = sp.clone();
      q.setFromUnitVectors(up, v.clone().normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, v.length(), 1)));
      parts.push(paint(g, look.face));
    }
    parts.push(paint(lathe([[faceX + 0.05, 0], [faceX + 0.05, 0.03], [faceX + 0.03, 0.06], [faceX - 0.03, 0.065], [faceX - 0.03, 0]], 24), look.lip));
    const ear = new THREE.BoxGeometry(0.012, 0.025, 0.11);
    ear.translate(faceX + 0.06, 0, 0);
    parts.push(paint(ear, look.lip), paint(ear.clone().rotateX(Math.PI / 2), look.lip));
  } else {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rimR * 0.93, 0, Math.PI * 2, false);
    const holes = (n: number, r0: number, r1: number, sw: number, off = 0) => {
      for (let i = 0; i < n; i++) shape.holes.push(new THREE.Path(windowPath(((i + off) / n) * Math.PI * 2, n, r0 * rimR, r1 * rimR, sw * rimR, lod > 1 ? 8 : lod > 0 ? 5 : 3, lod > 1 ? 2 : 1).map(([x, y]) => new THREE.Vector2(x, y))));
    };
    switch (look.rim) {
      case "y5":
        holes(5, 0.42, 0.88, 0.2);
        for (let i = 0; i < 5; i++) shape.holes.push(new THREE.Path(windowPath(((i + 0.5) / 5) * Math.PI * 2, 32, 0.5 * rimR, 0.86 * rimR, 0.012).map(([x, y]) => new THREE.Vector2(x, y))));
        break;
      case "ten": holes(10, 0.36, 0.89, 0.11); break;
      case "mesh": holes(10, 0.3, 0.6, 0.08), holes(20, 0.64, 0.9, 0.06, 0.5); break;
      case "five": holes(5, 0.38, 0.88, 0.22); break;
      case "six": holes(6, 0.4, 0.86, 0.24); break;
      case "multi": holes(15, 0.34, 0.9, 0.075); break;
      case "aero": holes(5, 0.72, 0.9, 0.5); break;
    }
    const ex = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: lod > 1 ? 3 : 1, curveSegments: lod > 1 ? 64 : lod > 0 ? 40 : 20 });
    ex.rotateY(Math.PI / 2);
    ex.translate(faceX - 0.022, 0, 0);
    const p = ex.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getY(i), p.getZ(i)) / rimR;
      p.setX(i, p.getX(i) - dish * (1 - r) * (1 - r));
    }
    ex.computeVertexNormals();
    parts.push(paint(prep(ex, false), look.face));
    if (look.lock) {
      parts.push(paint(lathe([[faceX - dish + 0.06, 0], [faceX - dish + 0.06, 0.035], [faceX - dish + 0.03, 0.045], [faceX - dish, 0.045]], 6), 0xc8c9cc));
    } else {
      parts.push(paint(lathe([[faceX - dish + 0.03, 0], [faceX - dish + 0.03, 0.035], [faceX - dish + 0.02, 0.05], [faceX - dish, 0.055]], 24), look.face));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const nut = new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6).rotateZ(Math.PI / 2);
        nut.translate(faceX - dish * 0.7 + 0.02, Math.cos(a) * 0.075, Math.sin(a) * 0.075);
        parts.push(paint(nut, 0xb0b2b5));
      }
    }
  }
  return mergeAll(parts.map((g) => prep(g.index ? g : g, false)).map((g) => (g.attributes.color ? g : paint(g, look.face))));
}

function brake(rimR: number, caliper: number, seg: number) {
  const rd = rimR * 0.84, t = 0.028;
  const disc = lathe([[0, rd * 0.42], [0, rd], [-t, rd], [-t, rd * 0.42]], seg);
  const uv = disc.attributes.uv, p = disc.attributes.position;
  const uv1: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const u = 0.5 + (p.getZ(i) / rd) * 0.48, v = 0.5 + (p.getY(i) / rd) * 0.48;
    uv.setXY(i, u, v);
    uv1.push(u, v);
  }
  disc.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
  paint(disc, 0xffffff);
  const hat = lathe([[0.015, 0], [0.015, rd * 0.42], [-t, rd * 0.42]], 32);
  paint(hat, 0x2c2d30);
  const sh = new THREE.Shape();
  const a0 = Math.PI / 2 - 0.5, a1 = Math.PI / 2 + 0.5;
  sh.absarc(0, 0, rd * 1.08, a0, a1, false);
  sh.absarc(0, 0, rd * 0.7, a1, a0, true);
  const cal = new THREE.ExtrudeGeometry(sh, { depth: 0.075, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 16 });
  cal.rotateY(Math.PI / 2);
  cal.translate(-0.06, 0, 0);
  prep(cal, false);
  const cu = cal.attributes.uv;
  for (let i = 0; i < cu.count; i++) cu.setXY(i, 0.004, 0.996);
  cal.setAttribute("uv1", new THREE.Float32BufferAttribute(new Float32Array(cu.count * 2).fill(0.996), 2));
  paint(cal, caliper);
  for (const g of [disc, hat]) if (!g.attributes.uv1) g.setAttribute("uv1", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).fill(0.5), 2));
  return mergeAll([disc, hat, cal]);
}
