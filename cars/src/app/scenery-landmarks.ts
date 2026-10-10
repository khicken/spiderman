import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import { addBuilding } from "./scenery-buildings";
import { fbm, Geo, noise2, rng, U, type RoadIndex, type Style } from "./scenery-kit";

// Vertex-colored meshes that glow with their own color at night (Tokyo Tower, summit hotel windows).
export function glowMaterial(key: string, glow: number) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.night;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * ${glow.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => "glow" + key;
  return m;
}

function beam(g: Geo, a: number[], b: number[], w: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  const d = new THREE.Vector3(dx, dy, dz).normalize();
  const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(w / 2);
  const up = new THREE.Vector3().crossVectors(side, d).normalize().multiplyScalar(w / 2);
  const c = (sx: number, sy: number, t: number) => [a[0] + side.x * sx + up.x * sy + dx * t, a[1] + side.y * sx + up.y * sy + dy * t, a[2] + side.z * sx + up.z * sy + dz * t];
  const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [s0, u0] = q[k], [s1, u1] = q[(k + 1) % 4];
    g.quad(c(s0, u0, 0), c(s1, u1, 0), c(s1, u1, 1), c(s0, u0, 1));
  }
  return len;
}

function tokyoTower(g: Geo, x: number, y: number, z: number) {
  const H = 333, orange = "#e0481c", white = "#efefea";
  const half = (h: number) => (h < 125 ? 40 - (h / 125) * 26 : h < 225 ? 14 - ((h - 125) / 100) * 7 : 7 - ((h - 225) / 25) * 3);
  const band = (h: number) => (h < 125 ? (Math.floor(h / 25) % 2 ? white : orange) : Math.floor(h / 14) % 2 ? white : orange);
  const levels: number[] = [];
  for (let h = 0; h < 250; h += h < 125 ? 12.5 : 10) levels.push(h);
  levels.push(250);
  const corner = (h: number, k: number) => {
    const s = half(h), cx = k === 0 || k === 3 ? -s : s, cz = k < 2 ? -s : s;
    return [x + cx, y + h, z + cz];
  };
  for (let l = 0; l < levels.length - 1; l++) {
    const h0 = levels[l], h1 = levels[l + 1];
    g.col.set(band(h0));
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      beam(g, corner(h0, k), corner(h1, k), h0 < 100 ? 2.4 : 1.4);
      beam(g, corner(h0, k), corner(h1, n), 0.6);
      beam(g, corner(h0, n), corner(h1, k), 0.6);
      beam(g, corner(h1, k), corner(h1, n), 0.7);
    }
  }
  g.col.set(white);
  g.box(x, y + 145, z, 20, 12, 20);
  g.col.set("#9aa4ad");
  g.box(x, y + 147, z, 20.5, 6, 20.5);
  g.col.set(white);
  g.box(x, y + 223, z, 12, 7, 12);
  g.col.set(orange);
  g.box(x, y + 250, z, 3.2, 40, 3.2);
  g.col.set(white);
  g.box(x, y + 290, z, 1.6, 43, 1.6);
}

function cylinder(g: Geo, x: number, y: number, z: number, r0: number, r1: number, h: number, sides: number, fluted = 0) {
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
    const f = fluted && k % 2 ? 0.94 : 1;
    const P = (a: number, r: number, yy: number) => [x + Math.cos(a) * r * f, yy, z + Math.sin(a) * r * f];
    g.quad(P(a1, r0, y), P(a0, r0, y), P(a0, r1, y + h), P(a1, r1, y + h));
  }
}

function dome(g: Geo, x: number, y: number, z: number, r: number, h: number) {
  const rings = 5, sides = 12;
  for (let j = 0; j < rings; j++) {
    const t0 = j / rings, t1 = (j + 1) / rings;
    const r0 = Math.cos((t0 * Math.PI) / 2) * r, r1 = Math.cos((t1 * Math.PI) / 2) * r, y0 = y + Math.sin((t0 * Math.PI) / 2) * h, y1 = y + Math.sin((t1 * Math.PI) / 2) * h;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
      g.quad([x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0], [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1]);
    }
  }
}

const rect = (x: number, z: number, w: number, d: number, yaw = 0) => {
  const c = Math.cos(yaw), s = Math.sin(yaw), out: number[] = [];
  for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) out.push(x + lx * c + lz * s, z - lx * s + lz * c);
  return out;
};

export function buildLandmarks(map: MapData, track: Track, roads: RoadIndex, style: Style, facade: Geo, plain: Geo, glow: Geo) {
  const r = rng(555);
  for (const lm of map.landmarks) {
    const name = lm.name.toLowerCase();
    const size = name.includes("tokyo tower") ? 45 : name.includes("casino") ? 40 : name.includes("transamerica") ? 30 : 15;
    let x = lm.x, z = lm.z;
    for (let k = 0; k < 24 && roads.edge(x, z) < size; k++) {
      const a = k * 2.4;
      x = lm.x + Math.cos(a) * (8 + k * 5);
      z = lm.z + Math.sin(a) * (8 + k * 5);
    }
    if (roads.edge(x, z) < size * 0.6) continue;
    const y = track.heightAt(x, z) - 0.5;
    if (name.includes("tokyo tower")) tokyoTower(glow, x, y, z);
    else if (name.includes("casino")) {
      addBuilding(facade, rect(x, z, 56, 30), y, y + 19, 0, "#ecdcb8", 0.3, { roof: "#6f8f86", cornice: true, trim: "#f4ead2" });
      for (const sx of [-24, 24]) {
        addBuilding(facade, rect(x + sx, z + 12, 9, 9), y, y + 27, 0, "#efe0bf", 0.6, { roof: "#6f8f86", cornice: true, trim: "#f4ead2" });
        plain.col.set("#5f8a7e");
        dome(plain, x + sx, y + 27.3, z + 12, 4.6, 6);
        plain.col.set("#d4b04a");
        plain.box(x + sx, y + 33.2, z + 12, 0.5, 2.5, 0.5);
      }
      plain.col.set("#5f8a7e");
      dome(plain, x, y + 19.3, z, 9, 7);
      plain.col.set("#f0e6d0");
      for (let k = -3; k <= 3; k++) plain.box(x + k * 4, y, z + 15.6, 1, 9, 1);
      plain.box(x, y + 9, z + 16, 30, 1.2, 2.2);
    } else if (name.includes("coit")) {
      plain.col.set("#e8e2d2");
      plain.box(x, y, z, 26, 6, 26);
      cylinder(plain, x, y + 6, z, 5.6, 5.1, 52, 24, 1);
      plain.col.set("#3b3a38");
      cylinder(plain, x, y + 52, z, 5.2, 5.2, 4, 24, 1);
      plain.col.set("#e8e2d2");
      cylinder(plain, x, y + 56, z, 5.4, 5.4, 2.5, 24);
      plain.col.set("#e8e2d2");
      plain.box(x, y + 58.5, z, 7, 0.3, 7);
    } else if (name.includes("transamerica")) {
      const H = 212, B = 26, T = 6;
      facade.col.set("#ece9e2");
      facade.top = H;
      facade.fac = [0, 0, 0.42, 1];
      const sq = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
      const cells = Math.round((2 * B) / 2.6);
      for (let k = 0; k < 4; k++) {
        const [px, pz] = sq[k], [qx, qz] = sq[(k + 1) % 4];
        facade.quad([x + px * B, y, z + pz * B], [x + qx * B, y, z + qz * B], [x + qx * T, y + H, z + qz * T], [x + px * T, y + H, z + pz * T], [0, 0, cells, 0, cells * (1 + T / B) / 2, H, cells * (1 - T / B) / 2, H]);
      }
      facade.fac = [0, 0, 0.42, 7];
      facade.col.set("#e6e3dc");
      plain.col.set("#ece9e2");
      plain.box(x, y + H, z, T * 1.2, 0.5, T * 1.2);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2;
        const b = [x, y + H, z], t = [x + Math.cos(ang) * 0.1, y + 260, z + Math.sin(ang) * 0.1];
        beam(plain, [b[0] + Math.cos(ang) * T * 0.8, b[1], b[2] + Math.sin(ang) * T * 0.8], t, 1.2);
      }
      facade.top = 0;
    } else if (name.includes("castle") || name.includes("burg")) {
      plain.col.set("#8a8174");
      cylinder(plain, x, y, z, 7, 6.5, 26, 16);
      plain.col.set("#6f675d");
      cylinder(plain, x, y + 26, z, 7.6, 7.6, 2.5, 16);
      for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
        plain.col.set("#91887a");
        beam(plain, [x + Math.cos(a0) * 28, y + 4, z + Math.sin(a0) * 28], [x + Math.cos(a1) * 28, y + 4, z + Math.sin(a1) * 28], 8);
      }
    } else if (name.includes("station")) {
      addBuilding(facade, rect(x, z, 190, 24), y, y + 17, 0, "#a5503d", 0.2, { roof: "#4c4f52", cornice: true, trim: "#e8e2d4" });
      for (const sx of [-70, 70]) {
        plain.col.set("#4c4f52");
        dome(plain, x + sx, y + 17.3, z, 10, 11);
      }
    } else if (name.includes("diet")) {
      addBuilding(facade, rect(x, z, 120, 40), y, y + 20, 0, "#d8d0bf", 0.3, { roof: "#6a6a66", cornice: true });
      for (let k = 0; k < 4; k++) addBuilding(facade, rect(x, z, 26 - k * 5, 26 - k * 5), y + 20 + k * 9, y + 29 + k * 9, 7, "#d8d0bf", 0.3, { roof: "#6a6a66", cornice: true });
      plain.col.set("#d8d0bf");
      plain.box(x, y + 56, z, 4, 10, 4);
    } else if (name.includes("palace") || name.includes("museum") || name.includes("cathedral")) {
      const big = name.includes("museum");
      addBuilding(facade, rect(x, z, big ? 70 : 90, big ? 34 : 28), y, y + (big ? 24 : 15), 0, "#e9dfc9", 0.5, { roof: "#9c958a", cornice: true, trim: "#f3ecdc" });
      if (name.includes("cathedral")) addBuilding(facade, rect(x - 30, z, 10, 10), y, y + 50, 4, "#cfc6b3", 0.5, { roof: "#55524f", cornice: true });
    } else if (name.includes("clock")) {
      addBuilding(facade, rect(x, z, 30, 26), y, y + 20, 0, "#d9d2c4", 0.8, { roof: "#55524f", cornice: true });
      plain.col.set("#d9d2c4");
      cylinder(plain, x, y + 20, z, 6, 6, 9, 20);
      plain.col.set("#6b7a7a");
      dome(plain, x, y + 29, z, 6.2, 5);
    } else if (lm.kind === "hotel") {
      for (let k = 0; k < 3; k++) {
        const hx = x + (r() - 0.5) * 70, hz = z + (r() - 0.5) * 70;
        if (roads.edge(hx, hz) < 20) continue;
        addBuilding(facade, rect(hx, hz, 28 + r() * 14, 13 + r() * 4, r() * 3), track.heightAt(hx, hz) - 1, track.heightAt(hx, hz) + 11 + r() * 6, 4, "#efe9dd", r(), { roof: "#4b4744", gable: true });
      }
    } else if (lm.kind === "church") {
      addBuilding(facade, rect(x, z, 14, 30), y, y + 12, 4, "#e2dccf", 0.7, { roof: "#4a4440", gable: true });
      addBuilding(facade, rect(x, z - 18, 6, 6), y, y + 28, 4, "#e2dccf", 0.7, { roof: "#4a4440", cornice: true });
      plain.col.set("#3d4a45");
      plain.box(x, y + 28.3, z - 18, 4, 9, 4);
    } else if (lm.kind === "tower") {
      plain.col.set("#c8c4ba");
      cylinder(plain, x, y, z, 4, 2.4, 60, 12);
      plain.col.set("#8a8a88");
      plain.box(x, y + 60, z, 9, 4, 9);
    } else if (lm.kind === "sign") {
      plain.col.set("#2f4f3a");
      plain.box(x, y + 3, z, 8, 2.6, 0.2);
      plain.col.set("#e8e8e4");
      plain.box(x, y + 2.9, z, 8.3, 2.8, 0.15);
      plain.col.set("#55595e");
      plain.box(x - 3.2, y, z, 0.2, 3.2, 0.2);
      plain.box(x + 3.2, y, z, 0.2, 3.2, 0.2);
    } else if (lm.kind === "monument") {
      plain.col.set("#d8d2c4");
      plain.box(x, y, z, 6, 2, 6);
      plain.box(x, y + 2, z, 1.6, 14, 1.6);
    } else if (lm.kind === "stadium") {
      plain.col.set("#c8c6c0");
      cylinder(plain, x, y, z, 70, 76, 22, 32);
    }
  }
}

// A ring of far mountains, hills or a skyline past the terrain grid.
export function buildRing(map: MapData, style: Style) {
  const T = map.terrain;
  const cx = T.x0 + ((T.nx - 1) * T.step) / 2, cz = T.z0 + ((T.nz - 1) * T.step) / 2;
  const R = Math.hypot(((T.nx - 1) * T.step) / 2, ((T.nz - 1) * T.step) / 2) + 1500;
  let lo = 1e9, hi = -1e9;
  for (const h of T.h) (lo = Math.min(lo, h)), (hi = Math.max(hi, h));
  const g = new Geo();
  if (style.ring === "city") {
    const r = rng(31);
    g.fac = [0, 0, 0, 1];
    for (let k = 0; k < 520; k++) {
      const a = r() * Math.PI * 2, d = R * (0.85 + r() * 0.9), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const h = 20 + Math.pow(r(), 3) * 180, w = 20 + r() * 40;
      g.col.set(r() < 0.5 ? "#8e9194" : "#a9a69e");
      g.fac = [0, 0, r(), h > 90 && r() < 0.5 ? 2 : 1];
      addBuilding(g, rect(x, z, w, w * (0.6 + r() * 0.8), a), lo - 5, lo + h, g.fac[3], g.col.getStyle(), r(), { roof: "#4d4d4d" });
    }
    return { geo: g.build(), facade: true };
  }
  const seg = 720, rows = 10;
  const amp = style.ring === "alps" ? 2400 : style.ring === "coast" ? 1100 : style.ring === "bay" ? 380 : 260;
  const base = style.ring === "alps" ? lo - 200 : Math.min(lo, map.waterY) - 30;
  const rock = new THREE.Color(style.ring === "coast" ? "#8d877c" : style.ring === "bay" ? "#a39566" : "#6f6a64"), snow = new THREE.Color("#eef2f6");
  const green = new THREE.Color(style.ring === "bay" ? "#7d7a4e" : style.ring === "coast" ? "#59633f" : style.ring === "alps" ? "#4f5f3a" : "#2c4430");
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let mask = 1;
      if (style.ring === "coast") mask = THREE.MathUtils.smoothstep(-sa, -0.15, 0.35);
      if (style.ring === "bay") mask = 0.35 + 0.65 * THREE.MathUtils.smoothstep(Math.cos(a + 1), -0.6, 0.4);
      const ridge = 1 - Math.abs(fbm(ca * 5 + 11, sa * 5 + 7) * 2 - 1);
      const rough = style.ring === "alps" || style.ring === "coast" ? 1 : 0.25;
      const fine = fbm(ca * 40 + t * 3, sa * 40 - t * 3);
      const peak = (0.3 + 0.7 * (rough === 1 ? ridge * ridge : fbm(ca * 3 + 5, sa * 3 + 2)) + 0.18 * fine * rough) * amp * mask;
      const prof = Math.pow(Math.sin(t * Math.PI), 0.8) * (0.85 + 0.3 * fbm(ca * 20 + t * 9, sa * 20));
      const d = R + t * R * 0.9;
      const y = base + peak * prof;
      pos.push(cx + ca * d, y, cz + sa * d);
      const h = (y - base) / Math.max(1, amp);
      c.copy(green).lerp(rock, THREE.MathUtils.clamp((h * 1.3 - 0.15 + (fine - 0.5) * 0.6) * rough, 0, 1));
      if (style.snowline < 9000 && y > style.snowline - 200 + fine * 400) c.copy(snow);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, d = a + seg + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, facade: false };
}
