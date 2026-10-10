import * as THREE from "three";
import { dropAfterUpload } from "./render-shared";
import type { MapData, Track } from "./contracts";
import { canvasTex, eachRecord, rng, type RoadIndex } from "./scenery-kit";

const C = 8;

function groundTexture(base: string) {
  const t = canvasTex(512, 512, (g) => {
    const r = rng(21);
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40; i++) {
      const l = r() * 0.16 - 0.08;
      g.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`;
      g.fillRect(Math.floor(r() * 8) * 64, Math.floor(r() * 8) * 64, 64 * (1 + Math.floor(r() * 3)), 64 * (1 + Math.floor(r() * 2)));
    }
    for (let i = 0; i < 12000; i++) {
      const l = r() * 0.1;
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${l})` : `rgba(255,255,255,${l * 0.6})`;
      g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
    }
    g.strokeStyle = "rgba(0,0,0,0.18)";
    g.lineWidth = 2;
    for (let k = 0; k <= 512; k += 64) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, 512);
      g.moveTo(0, k);
      g.lineTo(512, k);
      g.stroke();
    }
    for (let i = 0; i < 25; i++) {
      g.fillStyle = `rgba(30,25,20,${0.05 + r() * 0.08})`;
      g.beginPath();
      g.ellipse(r() * 512, r() * 512, 10 + r() * 50, 6 + r() * 25, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Paved ground between town buildings, so a city does not sit on a lawn. Edges fray into the terrain with a noise cut.
export function buildGround(map: MapData, track: Track, roads: RoadIndex) {
  const T = map.terrain;
  const x0 = T.x0, z0 = T.z0, nx = Math.floor(((T.nx - 1) * T.step) / C), nz = Math.floor(((T.nz - 1) * T.step) / C);
  const occ = new Float32Array((nx + 1) * (nz + 1));
  const mark = (x: number, z: number, v: number) => {
    const i = Math.round((x - x0) / C), j = Math.round((z - z0) / C);
    if (i >= 0 && j >= 0 && i <= nx && j <= nz) occ[j * (nx + 1) + i] = Math.max(occ[j * (nx + 1) + i], v);
  };
  eachRecord(map.buildings, 1, (o, n) => {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (let k = 0; k < n; k++) {
      a = Math.min(a, map.buildings[o + k * 2]); b = Math.max(b, map.buildings[o + k * 2]);
      c = Math.min(c, map.buildings[o + k * 2 + 1]); d = Math.max(d, map.buildings[o + k * 2 + 1]);
    }
    for (let x = a; x <= b + C; x += C) for (let z = c; z <= d + C; z += C) mark(Math.min(x, b), Math.min(z, d), 1);
  });
  eachRecord(map.roads, 1, (o, n, head) => {
    const w = map.roads[head + 1];
    for (let k = 0; k < n - 1; k++) {
      const ax = map.roads[o + k * 2], az = map.roads[o + k * 2 + 1], bx = map.roads[o + k * 2 + 2], bz = map.roads[o + k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= len; t += C * 0.7) mark(ax + ((bx - ax) * t) / (len || 1), az + ((bz - az) * t) / (len || 1), w > 6 ? 0.8 : 0.6);
    }
  });
  const blur = new Float32Array(occ.length);
  const R = 3;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      let s = 0;
      for (let b = -R; b <= R; b++)
        for (let a = -R; a <= R; a++) {
          const ii = i + a, jj = j + b;
          if (ii >= 0 && jj >= 0 && ii <= nx && jj <= nz) s = Math.max(s, occ[jj * (nx + 1) + ii] * (1 - Math.hypot(a, b) / (R + 1.5)));
        }
      blur[j * (nx + 1) + i] = s;
    }
  const p: number[] = [], uv: number[] = [], u: number[] = [], idx: number[] = [];
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const vtx = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (vid[k] >= 0) return vid[k];
    const x = x0 + i * C, z = z0 + j * C;
    p.push(x, track.heightAt(x, z) + 0.05, z);
    uv.push(x / 12, z / 12);
    u.push(blur[k]);
    return (vid[k] = p.length / 3 - 1);
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i;
      if (Math.max(blur[k], blur[k + 1], blur[k + nx + 1], blur[k + nx + 2]) < 0.25) continue;
      const cx = x0 + (i + 0.5) * C, cz = z0 + (j + 0.5) * C;
      if (roads.edge(cx, cz) < 3 || roads.edge(cx - C / 2, cz - C / 2) < 1 || roads.edge(cx + C / 2, cz + C / 2) < 1) continue;
      if (track.heightAt(cx, cz) < map.waterY + 1.2) continue;
      const a = vtx(i, j), b = vtx(i, j + 1), c = vtx(i + 1, j + 1), d = vtx(i + 1, j);
      idx.push(a, b, c, a, c, d);
    }
  if (!p.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  dropAfterUpload(g);
  const tex = groundTexture(map.id === "monaco" ? "#b9b0a0" : map.id === "tokyo" ? "#85878a" : "#9a9894");
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aU; varying float vU; varying vec2 vGp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvU = aU; vGp = position.xz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vU; varying vec2 vGp;\nfloat gh(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5); }")
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nvec2 gq = vGp / 3.0; vec2 gf = fract(gq); gf = gf * gf * (3.0 - 2.0 * gf);\nfloat gn = mix(mix(gh(gq), gh(gq + vec2(1, 0)), gf.x), mix(gh(gq + vec2(0, 1)), gh(gq + vec2(1, 1)), gf.x), gf.y);\nif (vU + (gn - 0.5) * 0.35 < 0.42) discard;",
      );
  };
  m.customProgramCacheKey = () => "ground1";
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return { mesh, dispose: () => (g.dispose(), tex.dispose(), m.dispose()) };
}
