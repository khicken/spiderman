import * as THREE from "three";
import type { MapData, Quality, Track } from "./contracts";
import type { Blocker } from "./scenery-buildings";
import { canvasTex, rng, U, type RoadIndex } from "./scenery-kit";
import { trackTables } from "./track";

// Grass tufts in a ring of cells around the camera. A cell keeps its tufts until the camera leaves it behind, so nothing pops.
const CELL = 4;
const CFG: Record<Quality, { r: number; k: number }> = { low: { r: 0, k: 0 }, medium: { r: 36, k: 12 }, high: { r: 56, k: 20 }, ultra: { r: 84, k: 26 } };
const BASE: Partial<Record<MapData["id"], [string, string]>> = {
  nordschleife: ["#5a7a2a", "#94993f"],
  spa: ["#4f7428", "#86a03e"],
  stelvio: ["#5f7a2c", "#93984a"],
};

function bladeTex() {
  return canvasTex(256, 128, (g) => {
    const r = rng(7);
    g.clearRect(0, 0, 256, 128);
    g.lineCap = "round";
    for (let i = 0; i < 130; i++) {
      const x = 8 + r() * 240, h = (30 + r() * 96) * (1 - Math.pow(Math.abs(x - 128) / 128, 2) * 0.75), lean = (x - 128) * 0.25 + (r() - 0.5) * 40, l = 0.55 + r() * 0.45;
      g.strokeStyle = `rgb(${Math.round(255 * l)},${Math.round(255 * l)},${Math.round(255 * l)})`;
      g.lineWidth = 3 + r() * 3;
      g.beginPath();
      g.moveTo(x, 128);
      g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
      g.stroke();
    }
  });
}

function tuftGeo() {
  const p: number[] = [], uv: number[] = [], n: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.6, s = Math.sin(a) * 0.6;
    const q = [[-c, 0, -s, 0, 0], [c, 0, s, 1, 0], [c, 1, s, 1, 1], [-c, 1, -s, 0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      p.push(q[i][0], q[i][1], q[i][2]);
      uv.push(q[i][3], q[i][4]);
      n.push(0, 1, 0);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  return g;
}

export function createGrass(map: MapData, track: Track, roads: RoadIndex, blocker: Blocker, q: Quality) {
  const base = BASE[map.id];
  const cfg = CFG[q];
  const group = new THREE.Group();
  group.name = "grass";
  if (!base || !cfg.r) return { group, update() {}, dispose() {} };
  const tb = trackTables(track);
  const G = Math.ceil((2 * cfg.r) / CELL) + 1, K = cfg.k, N = G * G * K;
  const geo = tuftGeo();
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const aR = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
  aP.setUsage(THREE.DynamicDrawUsage);
  aR.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aP", aP);
  geo.setAttribute("aR", aR);
  geo.instanceCount = N;
  const owner = new Int32Array(G * G).fill(0x7fffffff);
  const owner2 = new Int32Array(G * G);
  const tex = bladeTex();
  const lo = new THREE.Color(base[0]), hi = new THREE.Color(base[1]);
  const uR = { value: cfg.r };
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, alphaToCoverage: q !== "medium", side: THREE.DoubleSide, roughness: 0.9 });
  mat.customProgramCacheKey = () => "grass1";
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uLo: { value: lo }, uHi: { value: hi }, uR, uTime: U.time });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aP; attribute vec2 aR; uniform float uR, uTime; uniform vec3 uLo, uHi; varying vec3 vTint; varying float vH;")
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = position;
float gd = length(aP.xz - cameraPosition.xz);
float gs = aP.w * smoothstep(uR, uR * 0.72, gd);
float cy = cos(aR.x), sy = sin(aR.x);
transformed = vec3(cy * position.x + sy * position.z, position.y * (0.75 + 0.5 * fract(aR.y * 7.0)), -sy * position.x + cy * position.z) * gs;
float sway = sin(uTime * 1.7 + aP.x * 0.35 + aP.z * 0.27) * 0.5 + sin(uTime * 3.1 + aP.x * 0.9) * 0.2;
transformed.xz += vec2(0.09, 0.05) * sway * uv.y * uv.y * gs;
transformed += aP.xyz;
vH = uv.y;
vTint = mix(uLo, uHi, fract(aR.y));
if (fract(aR.y * 13.0) > 0.93) vTint = vec3(-1.0, fract(aR.y * 29.0), 0.0);`,
      )
      .replace("#include <defaultnormal_vertex>", "vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLo; varying vec3 vTint; varying float vH;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
diffuseColor.a *= smoothstep(0.5, 0.36, abs(vMapUv.x - 0.5) * (0.7 + 0.6 * vH)) * mix(1.0, 0.72, smoothstep(12.0, 45.0, length(vViewPosition)));
vec3 gt = vTint;
if (gt.x < 0.0) gt = vH > 0.82 ? (gt.y > 0.6 ? vec3(0.85, 0.82, 0.75) : gt.y > 0.3 ? vec3(0.8, 0.62, 0.08) : vec3(0.42, 0.25, 0.6)) : uLo;
diffuseColor.rgb *= gt * mix(0.6, 1.1, vH);`,
      )
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  group.add(mesh);

  const snowY = map.id === "stelvio" ? 2850 : 1e9, alpine = map.id === "stelvio" ? 2150 : 1e9;
  const P = aP.array as Float32Array, R = aR.array as Float32Array;
  const fill = (slot: number, cx: number, cz: number) => {
    const r = rng((cx * 73856093) ^ (cz * 19349663));
    for (let k = 0; k < K; k++) {
      const o = slot * K + k;
      const x = (cx + r()) * CELL, z = (cz + r()) * CELL, yaw = r() * 6.283, tint = r();
      P[o * 4 + 3] = 0;
      const e = roads.edge(x, z);
      const i = roads.nearest;
      if (i >= 0) {
        const fromAsphalt = e + map.runoff[i] + 0.6;
        if (fromAsphalt < 1.1 || (map.runoff[i] >= 6 && e < 0)) continue;
      }
      if (tb.inWater(x, z) || blocker.blocked(x, z)) continue;
      const y = track.heightAt(x, z);
      if (y > snowY + (r() - 0.5) * 120) continue;
      const slope = Math.abs(track.heightAt(x + 1, z) - y) + Math.abs(track.heightAt(x, z + 1) - y);
      if (slope > 1.1) continue;
      const high = y > alpine;
      P[o * 4] = x;
      P[o * 4 + 1] = y - 0.06;
      P[o * 4 + 2] = z;
      P[o * 4 + 3] = (high ? 0.38 : 0.55) * (0.65 + r() * 0.5) * (r() < 0.08 ? 1.4 : 1);
      R[o * 2] = yaw;
      R[o * 2 + 1] = high ? tint * 0.6 + 0.3 : tint * 0.8;
    }
  };

  let lastX = 1e9, lastZ = 1e9;
  return {
    group,
    update(cam: THREE.Vector3) {
      const ccx = Math.floor(cam.x / CELL), ccz = Math.floor(cam.z / CELL);
      if (ccx === lastX && ccz === lastZ) return;
      lastX = ccx;
      lastZ = ccz;
      const h = (G - 1) >> 1;
      let changed = false;
      for (let dz = -h; dz <= h; dz++)
        for (let dx = -h; dx <= h; dx++) {
          const cx = ccx + dx, cz = ccz + dz;
          const slot = (((cz % G) + G) % G) * G + (((cx % G) + G) % G);
          if (owner[slot] === cx && owner2[slot] === cz) continue;
          owner[slot] = cx;
          owner2[slot] = cz;
          fill(slot, cx, cz);
          changed = true;
        }
      if (changed) {
        aP.needsUpdate = true;
        aR.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
