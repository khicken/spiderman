import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import { eachRecord, Geo, pointIn, rng, U, writeInst, type RoadIndex, type Style, type Tier } from "./scenery-kit";

let normals: THREE.DataTexture | null = null;
// DEM tiles store the sea as a flat 0, so the surface sits a little above it and flat cells count as deep.
const LIFT = 0.6;

function waterNormals() {
  if (normals) return normals;
  const S = 256, data = new Uint8Array(S * S * 4), waves: number[][] = [];
  const r = rng(7);
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((r() * 2 - 1) * (2 + i * 0.5)), ky = Math.round((r() * 2 - 1) * (2 + i * 0.5)) || 1;
    waves.push([kx, ky, r() * Math.PI * 2, 1 / Math.hypot(kx, ky) ** 1.2]);
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let gx = 0, gy = 0;
      for (const [kx, ky, ph, a] of waves) {
        const c = Math.cos((2 * Math.PI * (kx * x + ky * y)) / S + ph) * a;
        gx += c * kx;
        gy += c * ky;
      }
      const nx = -gx * 0.09, ny = -gy * 0.09, l = Math.hypot(nx, ny, 1), o = (y * S + x) * 4;
      data[o] = (nx / l * 0.5 + 0.5) * 255;
      data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return (normals = t);
}

// Depth below the water surface, 0..30 m in a byte grid over the terrain.
function depthTexture(map: MapData) {
  const T = map.terrain, d = new Uint8Array(T.nx * T.nz);
  for (let i = 0; i < d.length; i++) d[i] = T.h[i] <= map.waterY + LIFT ? 255 : Math.max(0, Math.min(255, ((map.waterY + LIFT - T.h[i]) / 30) * 255));
  const t = new THREE.DataTexture(d, T.nx, T.nz, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const FRAG = /* glsl */ `
uniform sampler2D tWaterN; uniform sampler2D tDepth; uniform float uTime; uniform vec4 uTerr; uniform vec3 uShallow; uniform vec3 uDeep;
varying vec3 vWp;
vec3 waterNormal(vec2 p, float dist) {
  vec2 a = texture2D(tWaterN, p / 17.0 + uTime * vec2(0.013, 0.008)).xy * 2.0 - 1.0;
  vec2 b = texture2D(tWaterN, mat2(0.8, -0.6, 0.6, 0.8) * p / 47.0 - uTime * vec2(0.006, -0.009)).xy * 2.0 - 1.0;
  vec2 c = texture2D(tWaterN, p / 5.3 + uTime * vec2(-0.02, 0.017)).xy * 2.0 - 1.0;
  vec2 g = (a * 0.4 + b * 0.55 + c * 0.25 / (1.0 + dist * 0.02)) / (1.0 + dist * 0.004);
  return normalize(vec3(g.x, 1.0, g.y));
}
`;

export function createWaterMaterial(map: MapData) {
  const depth = depthTexture(map);
  const T = map.terrain;
  const sea = map.id === "monaco";
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.04, metalness: 0, envMapIntensity: 1.25 });
  m.onBeforeCompile = (s) => {
    s.uniforms.tWaterN = { value: waterNormals() };
    s.uniforms.tDepth = { value: depth };
    s.uniforms.uTime = U.time;
    s.uniforms.uTerr = { value: new THREE.Vector4(T.x0, T.z0, (T.nx - 1) * T.step, (T.nz - 1) * T.step) };
    s.uniforms.uShallow = { value: new THREE.Color(sea ? "#2f8f95" : map.id === "sanfrancisco" ? "#3c6a6a" : "#3d5a4e") };
    s.uniforms.uDeep = { value: new THREE.Color(sea ? "#062a4a" : map.id === "sanfrancisco" ? "#0e2b38" : "#0f2626") };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 tuv = (vWp.xz - uTerr.xy) / uTerr.zw;
        float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
        float dep = mix(30.0, texture2D(tDepth, (tuv * (vec2(${T.nx - 1}.0, ${T.nz - 1}.0)) + 0.5) / vec2(${T.nx}.0, ${T.nz}.0)).r * 30.0, inside);
        float dist = length(vWp - cameraPosition);
        vec3 wn = waterNormal(vWp.xz, dist);
        float shore = 1.0 - smoothstep(0.0, 0.9, dep);
        float foamN = texture2D(tWaterN, vWp.xz / 3.1 + uTime * 0.03).x;
        float foam = shore * smoothstep(0.45, 0.62, foamN + shore * 0.25 + 0.08 * sin(uTime * 1.3 + dep * 9.0));
        diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.5, 14.0, dep)) * 0.55;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8), foam * 0.55);`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, foam);")
      .replace("#include <normal_fragment_maps>", "normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);");
  };
  m.customProgramCacheKey = () => "water2";
  return { material: m, depth };
}

function yachtGeometry(kind: number) {
  const g = new Geo();
  const L = kind === 0 ? 34 : kind === 1 ? 14 : 12, B = L * (kind === 2 ? 0.3 : 0.24);
  const hull = (y0: number, y1: number, inset: number, col: string) => {
    g.col.set(col);
    const pts = [[-L / 2, -B / 2 + inset], [L * 0.22, -B / 2 + inset], [L / 2, 0], [L * 0.22, B / 2 - inset], [-L / 2, B / 2 - inset]];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const flare = (p: number[]) => [p[0] * 1.02, y1, p[1] * 1.04];
      g.quad([a[0], y0, a[1]], [b[0], y0, b[1]], flare(b), flare(a));
    }
    g.tri(pts[0][0], y1, pts[0][1], pts[4][0], y1, pts[4][1], pts[2][0], y1, pts[2][1]);
    g.tri(pts[0][0], y1, pts[0][1], pts[2][0], y1, pts[2][1], pts[1][0], y1, pts[1][1]);
    g.tri(pts[4][0], y1, pts[4][1], pts[3][0], y1, pts[3][1], pts[2][0], y1, pts[2][1]);
  };
  hull(-1.2, 0.3, 0.4, kind === 1 ? "#1d2a3a" : "#20242a");
  hull(0.3, kind === 0 ? 2.6 : 1.4, 0, "#f4f4f2");
  g.col.set("#d8c9a8");
  if (kind === 0) {
    g.col.set("#f6f6f4");
    g.box(-3, 2.6, 0, L * 0.55, 2.6, B * 0.82);
    g.box(-1.5, 5.2, 0, L * 0.38, 2.3, B * 0.7);
    g.box(-0.5, 7.5, 0, L * 0.2, 1.8, B * 0.5);
    g.col.set("#1c2229");
    g.box(-3, 3.4, 0, L * 0.555, 1.1, B * 0.83);
    g.box(-1.5, 5.8, 0, L * 0.385, 0.9, B * 0.71);
    g.col.set("#bbbbbb");
    g.box(0, 9.3, 0, 0.4, 3, 0.4);
  } else if (kind === 1) {
    g.col.set("#f2f2f0");
    g.box(-0.5, 1.4, 0, L * 0.45, 1.6, B * 0.7);
    g.col.set("#1c2229");
    g.box(0.8, 1.9, 0, L * 0.2, 0.8, B * 0.72);
  } else {
    g.col.set("#c9b48a");
    g.box(-1, 1.4, 0, L * 0.3, 0.7, B * 0.5);
    g.col.set("#d9d9d9");
    g.box(0.8, 1.4, 0, 0.22, L * 1.25, 0.22);
    g.box(-1.6, 3.2, 0, L * 0.38, 0.14, 0.14);
  }
  return g.build(false);
}

export function createWater(map: MapData, track: Track, roads: RoadIndex, style: Style, tier: Tier) {
  const group = new THREE.Group();
  group.name = "water";
  const { material, depth } = createWaterMaterial(map);
  const geos: THREE.BufferGeometry[] = [];
  if (style.ocean) {
    const g = new THREE.PlaneGeometry(60000, 60000, 1, 1).rotateX(-Math.PI / 2);
    g.translate(0, map.waterY + LIFT, 0);
    geos.push(g);
  } else
    eachRecord(map.water, 0, (o, n) => {
      if (n < 3) return;
      const sh = new THREE.Shape();
      for (let k = 0; k < n; k++) (k ? sh.lineTo : sh.moveTo).call(sh, map.water[o + k * 2], -map.water[o + k * 2 + 1]);
      const g = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
      g.translate(0, map.waterY + LIFT, 0);
      geos.push(g);
    });
  for (const g of geos) {
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    group.add(m);
  }

  const yachts: THREE.InstancedMesh[] = [];
  const yachtMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
  yachtMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vec3 ip = instanceMatrix[3].xyz; float ph = uTime * 0.9 + ip.x * 0.3 + ip.z * 0.2;
      transformed.y += sin(ph) * 0.12 + transformed.z * sin(ph * 0.7) * 0.015;`,
    );
  };
  yachtMat.customProgramCacheKey = () => "yacht1";
  if (style.yachts) {
    const r = rng(1234);
    const spots: number[] = [];
    const T = map.terrain;
    const water = (x: number, z: number) => {
      const i = Math.round((x - T.x0) / T.step), j = Math.round((z - T.z0) / T.step);
      if (i < 0 || j < 0 || i >= T.nx || j >= T.nz) return false;
      if (map.water.length) {
        let hit = false;
        eachRecord(map.water, 0, (o, n) => (hit ||= pointIn(map.water, o, n, x, z)));
        if (!hit && !style.ocean) return false;
      }
      return T.h[j * T.nx + i] < map.waterY + 0.05;
    };
    const want = Math.round(160 * tier.props);
    const N = map.center.length / 3;
    for (let t = 0; t < want * 40 && spots.length / 4 < want; t++) {
      const i = Math.floor(r() * N) * 3;
      const a = r() * Math.PI * 2, d = 15 + r() * 320;
      const x = map.center[i] + Math.cos(a) * d, z = map.center[i + 2] + Math.sin(a) * d;
      if (roads.edge(x, z) < 6 || !water(x, z)) continue;
      let near = false;
      for (let k = 0; k < spots.length; k += 4) if (Math.hypot(spots[k] - x, spots[k + 1] - z) < 11) near = true;
      if (near) continue;
      let lx = 0, lz = 0;
      for (let s = 0; s < 8; s++) {
        const b = (s / 8) * Math.PI * 2;
        if (!water(x + Math.cos(b) * 40, z + Math.sin(b) * 40)) (lx += Math.cos(b)), (lz += Math.sin(b));
      }
      if (lx === 0 && lz === 0) continue;
      spots.push(x, z, Math.atan2(lz, -lx), r());
    }
    const n = spots.length / 4;
    for (let kind = 0; kind < 3; kind++) {
      const idx = [];
      for (let k = 0; k < n; k++) if (Math.floor(spots[k * 4 + 3] * 3) === kind) idx.push(k);
      if (!idx.length) continue;
      const m = new THREE.InstancedMesh(yachtGeometry(kind), yachtMat, idx.length);
      idx.forEach((k, j) => writeInst(m.instanceMatrix.array as Float32Array, j, spots[k * 4], map.waterY + LIFT, spots[k * 4 + 1], spots[k * 4 + 2], 0.8 + r() * 0.4));
      m.castShadow = m.receiveShadow = true;
      m.computeBoundingSphere();
      yachts.push(m);
      group.add(m);
    }
  }
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const y of yachts) y.geometry.dispose();
      material.dispose();
      yachtMat.dispose();
      depth.dispose();
    },
  };
}
