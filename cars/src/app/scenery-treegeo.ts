import * as THREE from "three";
import { canvasTex, rng, type TreeKind } from "./scenery-kit";

// Atlas regions in uv (u0, v0, u1, v1). CanvasTexture flips y, so canvas top is v = 1.
const reg = (x: number, y: number, w: number, h: number) => [x / 1024, 1 - (y + h) / 1024, (x + w) / 1024, 1 - y / 1024];
const NEEDLE = reg(0, 0, 512, 512), LEAF = reg(512, 0, 512, 512), FROND = reg(0, 512, 512, 512), BARK = reg(520, 520, 496, 240), TUFT = reg(512, 768, 512, 256);

export const KINDS: TreeKind[] = ["spruce", "pine", "larch", "oak", "beech", "palm", "plane", "cypress"];
export const HEIGHT: Record<TreeKind, number> = { spruce: 24, pine: 20, larch: 20, oak: 15, beech: 18, palm: 11, plane: 16, cypress: 14 };
export const WIDTH: Record<TreeKind, number> = { spruce: 0.36, pine: 0.45, larch: 0.32, oak: 0.85, beech: 0.75, palm: 0.95, plane: 0.8, cypress: 0.2 };
export const LEAF_COL: Record<TreeKind, string> = {
  spruce: "#2d4f31", pine: "#3d5e33", larch: "#62874a", oak: "#3f5926", beech: "#4c6a2a", palm: "#4f6b30", plane: "#4d6a2e", cypress: "#2f4d2c",
};
const BARK_COL: Record<TreeKind, string> = { spruce: "#4a3b2e", pine: "#7a5236", larch: "#5a4232", oak: "#4d443a", beech: "#8a8a80", palm: "#7d6a52", plane: "#9a9283", cypress: "#4f4032" };

export function treeAtlas() {
  return canvasTex(1024, 1024, (g) => {
    const r = rng(42);
    g.clearRect(0, 0, 1024, 1024);
    const twig = (x0: number, y0: number, x1: number, y1: number, len: number, w: number) => {
      g.strokeStyle = "rgb(95,85,70)";
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
      for (let i = 0; i < l * 1.6; i++) {
        const t = r(), px = x0 + dx * t, py = y0 + dy * t, s = r() < 0.5 ? -1 : 1, nl = len * (1 - t * 0.5) * (0.6 + r() * 0.5);
        const k = 0.55 + r() * 0.45;
        g.strokeStyle = `rgb(${Math.round(190 * k)},${Math.round(220 * k)},${Math.round(185 * k)})`;
        g.lineWidth = 1.6 + r() * 1.4;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + (nx * s + (dx / l) * 0.5) * nl, py + (ny * s + (dy / l) * 0.5) * nl);
        g.stroke();
      }
    };
    g.lineCap = "round";
    twig(256, 505, 256, 20, 26, 5);
    for (let k = 0; k < 12; k++) {
      const t = 0.08 + (k / 12) * 0.85, y = 505 - t * 485, s = k % 2 ? -1 : 1, reach = (1 - t * 0.6) * 220;
      twig(256, y, 256 + s * reach, y - reach * 0.55, 20 * (1 - t * 0.4), 3);
    }
    // broadleaf cluster
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 220;
      const x = 768 + Math.cos(a) * d, y = 256 + Math.sin(a) * d * 0.95;
      const l = 0.55 + r() * 0.45 + (y < 256 ? 0.1 : -0.1);
      g.fillStyle = `rgb(${Math.round(215 * l)},${Math.round(235 * l)},${Math.round(200 * l)})`;
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, 0, 11 + r() * 7, 6 + r() * 3, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // palm frond: rib along the length, leaflets angled toward the tip
    g.strokeStyle = "rgb(190,190,150)";
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(256, 1020);
    g.lineTo(256, 520);
    g.stroke();
    for (let i = 0; i < 150; i++) {
      const t = i / 150, y = 1015 - t * 490, span = Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * 235;
      for (const s of [-1, 1]) {
        const l = 0.6 + r() * 0.4;
        g.strokeStyle = `rgb(${Math.round(200 * l)},${Math.round(230 * l)},${Math.round(170 * l)})`;
        g.lineWidth = 3 + r() * 2;
        g.beginPath();
        g.moveTo(256, y);
        g.lineTo(256 + s * span, y - 40 - r() * 30);
        g.stroke();
      }
    }
    // bark, opaque
    g.fillStyle = "rgb(150,150,150)";
    g.fillRect(512, 512, 512, 256);
    for (let i = 0; i < 1500; i++) {
      const l = 90 + r() * 120;
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.fillRect(512 + r() * 512, 512 + r() * 256, 2 + r() * 4, 10 + r() * 60);
    }
    // pine tufts
    for (let k = 0; k < 7; k++) {
      const cx = 560 + r() * 420, cy = 800 + r() * 180;
      for (let i = 0; i < 90; i++) {
        const a = -Math.PI / 2 + (r() - 0.5) * 3.2, d = 30 + r() * 45, l = 0.6 + r() * 0.4;
        g.strokeStyle = `rgb(${Math.round(190 * l)},${Math.round(220 * l)},${Math.round(180 * l)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        g.stroke();
      }
    }
  });
}

class TB {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  c: number[] = [];
  leaf: number[] = [];
  col = new THREE.Color();
  isLeaf = 0;
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z);
    this.n.push(nx / l, ny / l, nz / l);
    this.uv.push(u, w);
    this.c.push(this.col.r, this.col.g, this.col.b);
    this.leaf.push(this.isLeaf);
  }
  // Card from base point along `len`, spread by `side`; normals bend away from `cen`.
  card(b: THREE.Vector3, len: THREE.Vector3, side: THREE.Vector3, rect: number[], cen: THREE.Vector3, taper = 1) {
    const q = [
      [b.x - side.x * taper, b.y - side.y * taper, b.z - side.z * taper, rect[0], rect[1]],
      [b.x + side.x * taper, b.y + side.y * taper, b.z + side.z * taper, rect[2], rect[1]],
      [b.x + len.x + side.x, b.y + len.y + side.y, b.z + len.z + side.z, rect[2], rect[3]],
      [b.x + len.x - side.x, b.y + len.y - side.y, b.z + len.z - side.z, rect[0], rect[3]],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z, u, w] = q[i];
      this.v(x, y, z, x - cen.x, y - cen.y + 0.6 * Math.hypot(x - cen.x, z - cen.z) + 0.3, z - cen.z, u, w);
    }
  }
  tube(pts: THREE.Vector3[], r0: number, r1: number, sides: number) {
    for (let s = 0; s < pts.length - 1; s++) {
      const ra = r0 + (r1 - r0) * (s / (pts.length - 1)), rb = r0 + (r1 - r0) * ((s + 1) / (pts.length - 1));
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
        const P = pts[s], Q = pts[s + 1];
        const u0 = BARK[0] + (BARK[2] - BARK[0]) * (k / sides), u1 = BARK[0] + (BARK[2] - BARK[0]) * ((k + 1) / sides);
        const w0 = BARK[1] + (BARK[3] - BARK[1]) * (s / pts.length), w1 = BARK[1] + (BARK[3] - BARK[1]) * ((s + 1) / pts.length);
        const A = [P.x + Math.cos(a0) * ra, P.y, P.z + Math.sin(a0) * ra, Math.cos(a0), Math.sin(a0), u0, w0];
        const B = [P.x + Math.cos(a1) * ra, P.y, P.z + Math.sin(a1) * ra, Math.cos(a1), Math.sin(a1), u1, w0];
        const C = [Q.x + Math.cos(a1) * rb, Q.y, Q.z + Math.sin(a1) * rb, Math.cos(a1), Math.sin(a1), u1, w1];
        const D = [Q.x + Math.cos(a0) * rb, Q.y, Q.z + Math.sin(a0) * rb, Math.cos(a0), Math.sin(a0), u0, w1];
        for (const V of [A, C, B, A, D, C]) this.v(V[0], V[1], V[2], V[3], 0, V[4], V[5], V[6]);
      }
    }
  }
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const P = ico.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      this.v(cx + x * rx, cy + y * ry, cz + z * rz, x, y + 0.3, z, BARK[0] + 0.01, BARK[1] + 0.01);
    }
    ico.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("aLeaf", new THREE.Float32BufferAttribute(this.leaf, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function conifer(t: TB, kind: TreeKind, r: () => number, detail: number) {
  const H = HEIGHT[kind], larch = kind === "larch";
  t.col.set(BARK_COL[kind]);
  t.tube([V(0, -0.5, 0), V(0, H * 0.5, 0), V(0, H, 0)], 0.42, 0.06, 6);
  const leaf = new THREE.Color(LEAF_COL[kind]);
  t.isLeaf = 1;
  t.col.copy(leaf).multiplyScalar(0.22);
  const Rmax = larch ? 3.2 : 4.3;
  const core = (y: number) => (1 - (y - 1.5) / (H - 1.5)) * Rmax * 0.36;
  for (let k = 0; k < 7; k++) {
    const y0 = 1.5 + (k / 7) * (H - 1.5), y1 = 1.5 + ((k + 1) / 7) * (H - 1.5);
    for (let s = 0; s < 7; s++) {
      const a0 = (s / 7) * Math.PI * 2, a1 = ((s + 1) / 7) * Math.PI * 2;
      const P = (a: number, y: number) => [Math.cos(a) * core(y), y, Math.sin(a) * core(y)];
      const A = P(a0, y0), B = P(a1, y0), C = P(a1, y1), D = P(a0, y1);
      for (const Q of [A, C, B, A, D, C]) t.v(Q[0], Q[1], Q[2], Q[0], 0.15, Q[2], BARK[0] + 0.01, BARK[1] + 0.01);
    }
  }
  const step = detail >= 3 ? 0.62 : detail >= 2 ? 0.8 : 1.1;
  const per = larch ? 5 : 7;
  const b = V(), len = V(), side = V(), cen = V();
  for (let y = 1.6, lvl = 0; y < H - 0.4; y += step * (0.85 + r() * 0.3), lvl++) {
    const tt = (y - 1.6) / (H - 2);
    const R = Rmax * Math.pow(1 - tt, 0.95) + 0.4;
    for (let k = 0; k < per; k++) {
      const a = lvl * 2.399 + (k / per) * Math.PI * 2 + r() * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a), l = R * (0.8 + r() * 0.3);
      b.set(ca * 0.15, y, sa * 0.15);
      len.set(ca * l, -l * (larch ? 0.4 : 0.32), sa * l);
      const w = Math.max(0.9, l * 0.75), tilt = 0.35 + r() * 0.45;
      side.set(-sa * Math.cos(tilt) * w, Math.sin(tilt) * w * 0.6, ca * Math.cos(tilt) * w);
      cen.set(0, y + 1.5, 0);
      t.col.copy(leaf).multiplyScalar(0.75 + r() * 0.45 + tt * 0.25);
      t.card(b, len, side, NEEDLE, cen, 0.25);
    }
  }
  t.col.copy(leaf);
  b.set(0, H - 1.6, 0);
  len.set(0, 2.2, 0);
  side.set(0.7, 0, 0);
  cen.set(0, H - 2, 0);
  t.card(b, len, side, NEEDLE, cen, 0.6);
  side.set(0, 0, 0.7);
  t.card(b, len, side, NEEDLE, cen, 0.6);
}

function crowned(t: TB, kind: TreeKind, r: () => number, detail: number) {
  const H = HEIGHT[kind], pine = kind === "pine", cyp = kind === "cypress";
  t.col.set(BARK_COL[kind]);
  const trunkTop = pine ? 0.82 : cyp ? 0.5 : 0.5;
  t.tube([V(0, -0.5, 0), V(0.1, H * trunkTop * 0.5, 0), V(-0.1, H * trunkTop, 0.1)], pine ? 0.32 : 0.38, 0.14, 6);
  if (!pine && !cyp)
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + r(), e = H * (0.6 + r() * 0.15);
      t.tube([V(0, H * 0.42, 0), V(Math.cos(a) * H * 0.18, e, Math.sin(a) * H * 0.18)], 0.16, 0.06, 4);
    }
  const cy = pine ? H * 0.85 : cyp ? H * 0.52 : H * 0.66;
  const rx = pine ? H * 0.2 : cyp ? H * 0.11 : H * 0.34, ry = pine ? H * 0.12 : cyp ? H * 0.47 : H * 0.3;
  const leaf = new THREE.Color(LEAF_COL[kind]);
  t.isLeaf = 1;
  t.col.copy(leaf).multiplyScalar(0.4);
  t.blob(0, cy, 0, rx * 0.72, ry * 0.72, rx * 0.72);
  const n = Math.round((pine ? 50 : cyp ? 60 : 120) * (detail >= 2 ? 1 : 0.55));
  const b = V(), len = V(), side = V(), cen = V(0, cy, 0), dir = V(), up = V();
  const size = pine ? H * 0.15 : cyp ? H * 0.12 : H * 0.16;
  const rect = pine ? TUFT : cyp ? NEEDLE : LEAF;
  for (let i = 0; i < n; i++) {
    dir.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    const d = 0.55 + 0.45 * Math.pow(r(), 0.5);
    const px = dir.x * rx * d, py = dir.y * ry * d + (pine ? 0 : ry * 0.1), pz = dir.z * rx * d;
    up.set(r() - 0.5, 1, r() - 0.5).normalize().multiplyScalar(size);
    side.copy(up).cross(dir).normalize().multiplyScalar(size * 0.5);
    b.set(px, cy + py, pz).addScaledVector(up, -0.5);
    len.copy(up);
    t.col.copy(leaf).multiplyScalar(0.7 + r() * 0.35 + Math.max(0, dir.y) * 0.35);
    t.card(b, len, side, rect, cen, 1);
  }
}

function palm(t: TB, r: () => number) {
  const H = HEIGHT.palm;
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 8; k++) {
    const s = k / 8;
    pts.push(V(H * 0.07 * s * s, s * H, 0));
  }
  pts[0].y = -0.5;
  t.col.set(BARK_COL.palm);
  t.tube(pts, 0.5, 0.36, 8);
  const top = pts[8];
  t.col.set("#5a5038");
  t.blob(top.x, top.y - 0.4, top.z, 0.75, 0.9, 0.75);
  const leaf = new THREE.Color(LEAF_COL.palm);
  const b = V(), len = V(), side = V(), cen = V(top.x, top.y + 1, top.z);
  const fronds = 18;
  for (let i = 0; i < fronds + 5; i++) {
    const dead = i >= fronds;
    const a = i * 2.399 + r() * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = dead ? 3.2 : 4.8 + r() * 1.2;
    let el = dead ? -1.25 : 0.75 - (i / fronds) * 1.3;
    b.copy(top);
    t.isLeaf = dead ? 0 : 1;
    for (let s = 0; s < 4; s++) {
      const seg = L / 4;
      len.set(ca * Math.cos(el) * seg, Math.sin(el) * seg, sa * Math.cos(el) * seg);
      const w = (dead ? 0.35 : 1.0) * Math.sin(Math.PI * (0.15 + (s + 0.5) / 5));
      side.set(-sa * w, 0.18 * w, ca * w);
      t.col.copy(dead ? new THREE.Color("#7a6440") : leaf).multiplyScalar(0.8 + r() * 0.35);
      const rect = [FROND[0], FROND[1] + ((FROND[3] - FROND[1]) * s) / 4, FROND[2], FROND[1] + ((FROND[3] - FROND[1]) * (s + 1)) / 4];
      t.card(b, len, side, rect, cen, s === 0 ? 0.3 : 1);
      b.add(len);
      el -= dead ? 0.1 : 0.32;
    }
  }
}

export function treeGeometry(kind: TreeKind, detail: number) {
  const t = new TB(), r = rng(KINDS.indexOf(kind) * 97 + 5);
  if (kind === "spruce" || kind === "larch") conifer(t, kind, r, detail);
  else if (kind === "palm") palm(t, r);
  else crowned(t, kind, r, detail);
  return t.build();
}

// Far impostors: one painted silhouette per kind in a strip, one column per kind in KINDS order.
export function impostorAtlas() {
  const W = 256, Hh = 512;
  return canvasTex(W * KINDS.length, Hh, (g) => {
    const r = rng(9);
    KINDS.forEach((kind, i) => {
      const x0 = i * W, cx = x0 + W / 2, leaf = new THREE.Color(LEAF_COL[kind]);
      const col = (l: number) => `rgb(${Math.min(255, Math.round(leaf.r * 470 * l))},${Math.min(255, Math.round(leaf.g * 470 * l))},${Math.min(255, Math.round(leaf.b * 470 * l))})`;
      const bark = BARK_COL[kind];
      g.fillStyle = bark;
      if (kind === "palm") {
        g.strokeStyle = bark;
        g.lineWidth = 12;
        g.beginPath();
        g.moveTo(cx, Hh);
        g.quadraticCurveTo(cx, Hh * 0.4, cx + 14, Hh * 0.18);
        g.stroke();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, dx = Math.cos(a) * 110, dy = Math.sin(a) * 30 + 40;
          g.strokeStyle = col(0.8 + r() * 0.6);
          g.lineWidth = 9;
          g.beginPath();
          g.moveTo(cx + 14, Hh * 0.18);
          g.quadraticCurveTo(cx + 14 + dx * 0.6, Hh * 0.18 - 40, cx + 14 + dx, Hh * 0.18 + dy);
          g.stroke();
        }
        return;
      }
      g.fillRect(cx - 6, Hh * 0.45, 12, Hh * 0.55);
      const conifer = kind === "spruce" || kind === "larch";
      if (conifer || kind === "cypress") {
        for (let k = 0; k < 1600; k++) {
          const v = r(), u = r() * 2 - 1, y = Hh * (0.02 + v * 0.9);
          const half = conifer ? W * 0.47 * (y / Hh) * (0.75 + 0.25 * Math.abs(Math.sin(y * 0.09))) : W * 0.2 * Math.sin(Math.PI * Math.min(1, v * 1.05 + 0.03));
          g.fillStyle = col(0.55 + 0.5 * (1 - y / Hh) + r() * 0.3 + (u > 0 ? 0.12 : -0.08));
          g.beginPath();
          g.arc(cx + u * half, y, 3 + r() * 5, 0, Math.PI * 2);
          g.fill();
        }
        return;
      }
      const top = kind === "pine" ? 0.04 : 0.03, bottom = kind === "pine" ? 0.34 : 0.66;
      const blobs: number[][] = [];
      for (let k = 0; k < 9; k++) {
        const v = top + (bottom - top) * (0.2 + 0.6 * r()), rad = W * (0.13 + r() * 0.1);
        const span = Math.sin(Math.PI * ((v - top) / (bottom - top))) * (W / 2 - rad);
        blobs.push([cx + (r() * 2 - 1) * span, Hh * v, rad]);
      }
      for (const [bx, by, rad] of blobs)
        for (let k = 0; k < 260; k++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, x = bx + Math.cos(a) * d, y = by + Math.sin(a) * d;
          g.fillStyle = col(0.6 + 0.55 * (1 - (y - by + rad) / (2 * rad)) + r() * 0.3 + (x > cx ? 0.1 : -0.1));
          g.beginPath();
          g.arc(x, y, 3 + r() * 5, 0, Math.PI * 2);
          g.fill();
        }
    });
  });
}
