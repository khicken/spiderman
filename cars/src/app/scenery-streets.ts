import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import { canvasTex, eachRecord, Geo, rng, type RoadIndex, type Style } from "./scenery-kit";

function asphaltTexture() {
  const t = canvasTex(256, 256, (g) => {
    const r = rng(3);
    g.fillStyle = "#4a4a4a";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const l = 50 + r() * 50;
      g.fillStyle = `rgba(${l},${l},${l},0.6)`;
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(20,20,20,${0.05 + r() * 0.08})`;
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 20 + r() * 50, 10 + r() * 30, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function paverTexture(base: string) {
  const t = canvasTex(256, 256, (g) => {
    const r = rng(11);
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32)
      for (let x = (y / 32) % 2 ? 0 : -32; x < 256; x += 64) {
        const l = r() * 0.12 - 0.06;
        g.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`;
        g.fillRect(x + 1, y + 1, 62, 30);
      }
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 2;
    for (let y = 0; y <= 256; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
      for (let x = (y / 32) % 2 ? 0 : -32; x < 256; x += 64) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 32);
        g.stroke();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Other streets as ribbons on the terrain, with sidewalks in towns and cable car rails in San Francisco.
export function buildStreets(map: MapData, track: Track, roads: RoadIndex, style: Style) {
  const p: number[] = [], uv: number[] = [], c: number[] = [];
  const side = new Geo();
  const urban = map.id === "monaco" || map.id === "tokyo" || map.id === "sanfrancisco";
  const walk = urban ? 2.6 : 0;
  const lines: number[][] = [];
  const tri = (A: number[], B: number[], C: number[], col: number[]) => {
    for (const V of [A, B, C]) {
      p.push(V[0], V[1], V[2]);
      uv.push(V[3], V[4]);
      c.push(col[0], col[1], col[2]);
    }
  };
  const asphalt = [1, 1, 1], paint = [3.2, 3.2, 3.0];
  let longest: [number, number, number][] = [];
  eachRecord(map.roads, 1, (o, n, head) => {
    const w = map.roads[head + 1];
    let total = 0;
    for (let k = 0; k < n - 1; k++) {
      const ax = map.roads[o + k * 2], az = map.roads[o + k * 2 + 1], bx = map.roads[o + k * 2 + 2], bz = map.roads[o + k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      total += len;
      if (len < 0.5) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, ox = -dz, oz = dx;
      const steps = Math.max(1, Math.ceil(len / 6));
      for (let s = 0; s < steps; s++) {
        const t0 = (s / steps) * len, t1 = ((s + 1) / steps) * len;
        const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
        if (roads.edge(x0, z0) < 0.5 || roads.edge(x1, z1) < 0.5) continue;
        const P = (x: number, z: number, o2: number, u: number, lift: number) => {
          const X = x + ox * o2, Z = z + oz * o2;
          return [X, track.heightAt(X, Z) + lift, Z, u, 0];
        };
        const half = w / 2;
        const A = P(x0, z0, -half, -half / 4, 0.1), B = P(x0, z0, half, half / 4, 0.1), C = P(x1, z1, half, half / 4, 0.1), D = P(x1, z1, -half, -half / 4, 0.1);
        A[4] = B[4] = t0 / 4;
        C[4] = D[4] = t1 / 4;
        tri(A, B, C, asphalt);
        tri(A, C, D, asphalt);
        if (w >= 7 && Math.floor(t0 / 6) % 2 === 0) {
          const a = P(x0, z0, -0.08, 0, 0.11), b = P(x0, z0, 0.08, 0, 0.11), cc = P(x1, z1, 0.08, 0, 0.11), d = P(x1, z1, -0.08, 0, 0.11);
          tri(a, b, cc, paint);
          tri(a, cc, d, paint);
        }
        if (walk)
          for (const sgn of [-1, 1]) {
            const i0 = sgn * half, i1 = sgn * (half + walk);
            const E = P(x0, z0, i0, 0, 0.25), F = P(x0, z0, i1, 0, 0.25), G = P(x1, z1, i1, 0, 0.25), H = P(x1, z1, i0, 0, 0.25);
            const Eb = P(x0, z0, i0, 0, 0.0), Hb = P(x1, z1, i0, 0, 0.0);
            side.col.set(sgn > 0 ? "#b9b4aa" : "#b3aea4");
            const up = (V: number[], W: number[], X: number[], Y: number[]) => {
              const ny = (W[2] - V[2]) * (X[0] - V[0]) - (W[0] - V[0]) * (X[2] - V[2]);
              if (ny > 0) side.quad(V, W, X, Y);
              else side.quad(Y, X, W, V);
            };
            up(E, F, G, H);
            side.col.set("#8f8b84");
            side.quad(Eb, Hb, H, E);
            side.quad(Hb, Eb, E, H);
          }
      }
    }
    if (style.cable && total > 300) longest.push([o, n, total]);
  });
  longest = longest.sort((a, b) => b[2] - a[2]).slice(0, 3);
  const pave: number[] = [];
  if (urban) {
    const N = map.center.length / 3, P = map.center;
    const skip = new Uint8Array(N);
    for (const [a, b] of [...map.tunnels, ...map.elevated]) for (let i = a; i <= b && i < N; i++) skip[i] = 1;
    const L = (i: number) => {
      const a = (i + N) % N, b = (a + 1) % N, c = (a + N - 1) % N;
      const dx = P[b * 3] - P[c * 3], dz = P[b * 3 + 2] - P[c * 3 + 2], l = Math.hypot(dx, dz) || 1;
      return [dz / l, -dx / l];
    };
    for (let i = 0; i < N - (map.closed ? 0 : 1); i++) {
      const j = (i + 1) % N;
      if (skip[i] || skip[j]) continue;
      const li = L(i), lj = L(j);
      for (const s of [-1, 1]) {
        const o = (k: number, l: number[], d: number) => {
          const off = (map.width[k] / 2 + map.runoff[k] + d) * s, x = P[k * 3] + l[0] * off, z = P[k * 3 + 2] + l[1] * off;
          return [x, track.heightAt(x, z) + 0.07, z];
        };
        const A = o(i, li, 0.3), B = o(j, lj, 0.3), C = o(j, lj, 7), D = o(i, li, 7);
        if (roads.edge(C[0], C[2]) < 5 || roads.edge(D[0], D[2]) < 5) continue;
        if (Math.abs(C[1] - B[1]) > 1.2 || Math.abs(D[1] - A[1]) > 1.2) continue;
        const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        for (const V of ny > 0 ? [A, B, C, A, C, D] : [A, C, B, A, D, C]) pave.push(V[0], V[1], V[2]);
      }
    }
  }
  const rails = new Geo();
  for (const [o, n] of longest) {
    for (let k = 0; k < n - 1; k++) {
      const ax = map.roads[o + k * 2], az = map.roads[o + k * 2 + 1], bx = map.roads[o + k * 2 + 2], bz = map.roads[o + k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, ox = -dz, oz = dx;
      for (let t = 0; t < len; t += 4) {
        const t1 = Math.min(len, t + 4);
        for (const off of [-0.72, 0.72, 0]) {
          const x0 = ax + dx * t + ox * off, z0 = az + dz * t + oz * off, x1 = ax + dx * t1 + ox * off, z1 = az + dz * t1 + oz * off;
          if (roads.edge(x0, z0) < 0.5) continue;
          const y0 = track.heightAt(x0, z0) + 0.115, y1 = track.heightAt(x1, z1) + 0.115, hw = off === 0 ? 0.03 : 0.05;
          rails.col.set(off === 0 ? "#151515" : "#a8acb0");
          rails.quad([x0 - ox * hw, y0, z0 - oz * hw], [x0 + ox * hw, y0, z0 + oz * hw], [x1 + ox * hw, y1, z1 + oz * hw], [x1 - ox * hw, y1, z1 - oz * hw]);
        }
      }
      lines.push([ax, az, bx, bz]);
    }
  }
  const r = rng(77);
  for (let k = 0; k < Math.min(3, lines.length); k++) {
    const [ax, az, bx, bz] = lines[Math.floor(r() * lines.length)];
    const x = (ax + bx) / 2, z = (az + bz) / 2;
    if (roads.edge(x, z) < 15) continue;
    const yaw = Math.atan2(-(bz - az), bx - ax), y = track.heightAt(x, z) + 0.1;
    rails.col.set("#7a1f24");
    rails.box(x, y + 0.5, z, 8.5, 1.3, 2.4, yaw);
    rails.col.set("#e9dcb8");
    rails.box(x, y + 1.8, z, 8.5, 1.0, 2.4, yaw);
    rails.col.set("#2a2420");
    rails.box(x, y + 2.8, z, 8.9, 0.25, 2.5, yaw);
    rails.col.set("#1a1d22");
    rails.box(x, y + 1.95, z, 8.55, 0.6, 2.45, yaw);
  }
  const group = new THREE.Group();
  group.name = "streets";
  const disposables: { dispose(): void }[] = [];
  if (p.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const tex = asphaltTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
    disposables.push(g, tex, mat);
  }
  if (pave.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pave, 3));
    const uv2: number[] = [];
    for (let k = 0; k < pave.length; k += 3) uv2.push(pave[k] / 3, pave[k + 2] / 3);
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv2, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const tex = paverTexture(map.id === "tokyo" ? "#8f8f8c" : map.id === "monaco" ? "#c9bfae" : "#a9a59e");
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
    disposables.push(g, tex, mat);
  }
  for (const geo of [side, rails]) {
    if (!geo.count) continue;
    const g = geo.build(false);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: geo === rails ? 0.4 : 0.85, metalness: geo === rails ? 0.5 : 0 });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = geo === rails;
    group.add(m);
    disposables.push(g, mat);
  }
  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
