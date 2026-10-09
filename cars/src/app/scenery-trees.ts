import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import type { Blocker } from "./scenery-buildings";
import { centerAt, eachRecord, fbm, noise2, pointIn, rng, U, writeInst, type RoadIndex, type Style, type Tier, type TreeKind } from "./scenery-kit";
import { HEIGHT, impostorAtlas, KINDS, LEAF_COL, treeAtlas, treeGeometry, WIDTH } from "./scenery-treegeo";

const F = 6; // floats per tree: x, y, z, scale, yaw, kind
const CELL = 128;

const AUTUMN: Partial<Record<TreeKind, string[]>> = {
  beech: ["#c8742a", "#b8561e", "#d9a03a", "#9a6a2a"],
  oak: ["#9a6a2a", "#b07a30", "#7d6a2a"],
  larch: ["#d0a040", "#c89030"],
  plane: ["#b89a3a", "#a87a2a"],
};

function swayPatch(m: THREE.Material, far: boolean) {
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.uniforms.uSnow = U.snow;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying float vSnowK;\n${far ? "attribute float aKind;" : "attribute float aLeaf;"}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        float ph = uTime * 1.4 + ip.x * 0.07 + ip.z * 0.05;
        float k = position.y * position.y * ${far ? "0.006" : "0.0009"};
        transformed.x += (sin(ph) + 0.4 * sin(ph * 2.3 + 1.0)) * k;
        transformed.z += cos(ph * 0.8) * k * 0.6;
        vSnowK = ${far ? "uv.y * 0.6" : "smoothstep(0.35, 0.9, objectNormal.y) * aLeaf"};`,
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSnow; varying float vSnowK;")
      .replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.85, 0.9), uSnow * vSnowK);");
    if (far) {
      s.vertexShader = s.vertexShader.replace("#include <uv_vertex>", `#include <uv_vertex>\nvMapUv.x = (vMapUv.x + aKind) / ${KINDS.length}.0;`);
      s.fragmentShader = s.fragmentShader.replace(
        "#include <color_fragment>",
        "diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, smoothstep(-0.01, 0.05, diffuseColor.g - diffuseColor.r));",
      );
    } else s.vertexShader = s.vertexShader.replace("#include <color_vertex>", "vColor = vec4(1.0);\nvColor.rgb *= color;\nvColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aLeaf);");
    // Sharpened alpha keeps thin leaves solid in the distance instead of eroding away in the mips.
    s.fragmentShader = s.fragmentShader.replace(
      "#include <alphatest_fragment>",
      "diffuseColor.a = clamp((diffuseColor.a - 0.45) / max(fwidth(diffuseColor.a), 0.0001) + 0.5, 0.0, 1.0);\n#include <alphatest_fragment>",
    );
  };
  m.customProgramCacheKey = () => (far ? "treeFar1" : "treeNear1");
}

function crossGeometry() {
  const g = new THREE.BufferGeometry();
  const p: number[] = [], n: number[] = [], uv: number[] = [];
  for (const a of [0, Math.PI / 2]) {
    const c = Math.cos(a) * 0.5, s = Math.sin(a) * 0.5;
    const q = [[-c, 0, -s, 0, 0], [c, 0, s, 1, 0], [c, 1, s, 1, 1], [-c, 1, -s, 0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      p.push(q[i][0], q[i][1], q[i][2]);
      n.push(q[i][0] * 0.6, 0.8 + q[i][1] * 0.4, q[i][2] * 0.6);
      uv.push(q[i][3], q[i][4]);
    }
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export function scatterTrees(map: MapData, track: Track, roads: RoadIndex, style: Style, blocker: Blocker, budget: number) {
  const out = new Float32Array(budget * F);
  let count = 0;
  const r = rng(map.center.length * 31 + 7);
  const waterRecs: number[][] = [];
  eachRecord(map.water, 0, (o, n) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < n; k++) {
      x0 = Math.min(x0, map.water[o + k * 2]); x1 = Math.max(x1, map.water[o + k * 2]);
      z0 = Math.min(z0, map.water[o + k * 2 + 1]); z1 = Math.max(z1, map.water[o + k * 2 + 1]);
    }
    waterRecs.push([o, n, x0, x1, z0, z1]);
  });
  const greens: number[][] = [];
  eachRecord(map.green, 1, (o, n, head) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < n; k++) {
      x0 = Math.min(x0, map.green[o + k * 2]); x1 = Math.max(x1, map.green[o + k * 2]);
      z0 = Math.min(z0, map.green[o + k * 2 + 1]); z1 = Math.max(z1, map.green[o + k * 2 + 1]);
    }
    greens.push([o, n, x0, x1, z0, z1, map.green[head + 1]]);
  });
  const T = map.terrain;
  const tx0 = T.x0, tx1 = T.x0 + (T.nx - 1) * T.step, tz0 = T.z0, tz1 = T.z0 + (T.nz - 1) * T.step;
  const greenAt = (x: number, z: number) => {
    for (const [o, n, x0, x1, z0, z1, d] of greens) if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && pointIn(map.green, o, n, x, z)) return d;
    return 0;
  };
  const kindAt = (x: number, z: number, y: number) => {
    const list = style.trees;
    if (style.treeline < 9000 && y > style.treeline - 350) return KINDS.indexOf("larch");
    const k = Math.floor(noise2(x / 140, z / 140) * list.length * 1.6 + hashMix(x, z) * 0.6) % list.length;
    return KINDS.indexOf(list[Math.max(0, k)]);
  };
  const hashMix = (x: number, z: number) => noise2(x * 0.11, z * 0.13);
  const add = (x: number, z: number, kind: number, scale: number) => {
    if (count >= budget) return;
    if (x < tx0 || x > tx1 || z < tz0 || z > tz1) return;
    if (roads.edge(x, z) < 1.5 + HEIGHT[KINDS[kind]] * WIDTH[KINDS[kind]] * scale * 0.5) return;
    const y = track.heightAt(x, z);
    if (y > style.treeline + (r() - 0.5) * 120) return;
    if (blocker.blocked(x, z)) return;
    if (y < map.waterY + 0.3 && waterRecs.length) return;
    for (const [o, n, x0, x1, z0, z1] of waterRecs) if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && pointIn(map.water, o, n, x, z)) return;
    const i = count++ * F;
    out[i] = x; out[i + 1] = y - 0.3; out[i + 2] = z; out[i + 3] = scale; out[i + 4] = r() * Math.PI * 2; out[i + 5] = kind;
  };
  const pos = new THREE.Vector3(), left = new THREE.Vector3();
  const N = map.center.length / 3;
  const roadside = style.wild > 0;
  if (style.street) {
    const sk = KINDS.indexOf(style.street);
    eachRecord(map.roads, 1, (o, n, head) => {
      const w = map.roads[head + 1];
      for (let k = 0; k < n - 1; k++) {
        const ax = map.roads[o + k * 2], az = map.roads[o + k * 2 + 1], bx = map.roads[o + k * 2 + 2], bz = map.roads[o + k * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1) continue;
        const ox = -(bz - az) / len, oz = (bx - ax) / len;
        for (let d = r() * 14; d < len; d += 13 + r() * 6)
          for (const s of [-1, 1]) if (r() < 0.6) add(ax + ((bx - ax) * d) / len + ox * s * (w / 2 + 1.8), az + ((bz - az) * d) / len + oz * s * (w / 2 + 1.8), sk, 0.75 + r() * 0.4);
      }
    });
    if (map.id === "monaco")
      for (let i = 0; i < N; i += 3) {
        centerAt(map, i, pos, left);
        const off = map.width[i] / 2 + map.runoff[i] + 3.5;
        for (const s of [-1, 1]) if (r() < 0.25) add(pos.x + left.x * off * s, pos.z + left.z * off * s, sk, 0.8 + r() * 0.35);
      }
  }
  if (roadside) {
    const tries = budget * 8;
    for (let t = 0; t < tries && count < budget; t++) {
      centerAt(map, Math.floor(r() * N), pos, left);
      const s = r() < 0.5 ? -1 : 1;
      const d = map.width[0] / 2 + 3 + 360 * Math.pow(r(), 2.2);
      const along = (r() - 0.5) * 10;
      const x = pos.x + left.x * d * s - left.z * along, z = pos.z + left.z * d * s + left.x * along;
      const g = greenAt(x, z);
      const forest = style.wild > 0 ? THREE.MathUtils.smoothstep(fbm(x / 420, z / 420) + style.wild * 0.55, 0.78, 0.86) : 0;
      const dens = Math.max(g, forest * style.wild, style.wild > 0 ? 0.03 : 0);
      if (r() > dens) continue;
      const y = track.heightAt(x, z);
      add(x, z, kindAt(x, z, y), 0.7 + r() * 0.55);
    }
  }
  for (const [o, n, x0, x1, z0, z1, d] of greens) {
    const area = (x1 - x0) * (z1 - z0), want = Math.min(area * d * 0.012, budget * 0.1);
    for (let t = 0; t < want * 2 && count < budget; t++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!pointIn(map.green, o, n, x, z)) continue;
      add(x, z, kindAt(x, z, track.heightAt(x, z)), 0.6 + r() * 0.6);
    }
  }
  return { data: out, count };
}

export function createTrees(map: MapData, track: Track, roads: RoadIndex, style: Style, blocker: Blocker, tier: Tier) {
  const group = new THREE.Group();
  group.name = "trees";
  const { data, count } = scatterTrees(map, track, roads, style, blocker, tier.trees);
  const kinds = [...new Set(Array.from({ length: count }, (_, i) => data[i * F + 5]))];
  const atlas = treeAtlas();
  const near = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  swayPatch(near, false);
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
  const imp = impostorAtlas();
  const farMat = new THREE.MeshStandardMaterial({ map: imp, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  swayPatch(farMat, true);
  const perKind = new Map<number, number>();
  for (let i = 0; i < count; i++) perKind.set(data[i * F + 5], (perKind.get(data[i * F + 5]) ?? 0) + 1);
  const tint = new Float32Array(count * 3);
  const r = rng(77);
  const c = new THREE.Color(), base = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const kind = KINDS[data[i * F + 5]];
    const au = AUTUMN[kind];
    const v = 0.85 + r() * 0.3;
    if (au && r() < style.autumn) {
      base.set(LEAF_COL[kind]);
      c.set(au[Math.floor(r() * au.length)]);
      tint[i * 3] = (c.r / base.r) * v; tint[i * 3 + 1] = (c.g / base.g) * v; tint[i * 3 + 2] = (c.b / base.b) * v;
    } else (tint[i * 3] = v * (0.95 + r() * 0.1)), (tint[i * 3 + 1] = v), (tint[i * 3 + 2] = v * (0.9 + r() * 0.15));
  }
  const nearMesh = new Map<number, THREE.InstancedMesh>();
  for (const k of kinds) {
    const m = new THREE.InstancedMesh(treeGeometry(KINDS[k], tier.detail), near, perKind.get(k)!);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perKind.get(k)! * 3), 3);
    m.customDepthMaterial = depth;
    m.castShadow = tier.treeShadow;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    nearMesh.set(k, m);
    group.add(m);
  }
  const farGeo = crossGeometry();
  const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1);
  farGeo.setAttribute("aKind", kindAttr);
  const farMesh = new THREE.InstancedMesh(farGeo, farMat, Math.max(1, count));
  farMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3);
  farMesh.frustumCulled = false;
  farMesh.receiveShadow = false;
  farMesh.count = 0;
  group.add(farMesh);

  // Bucket the trees by grid cell, so an LOD pass only visits cells within reach.
  const tx0 = map.terrain.x0, tz0 = map.terrain.z0;
  const cnx = Math.ceil(((map.terrain.nx - 1) * map.terrain.step) / CELL) + 1, cnz = Math.ceil(((map.terrain.nz - 1) * map.terrain.step) / CELL) + 1;
  const cellOf = (i: number) => Math.min(cnz - 1, Math.max(0, Math.floor((data[i * F + 2] - tz0) / CELL))) * cnx + Math.min(cnx - 1, Math.max(0, Math.floor((data[i * F] - tx0) / CELL)));
  const start = new Uint32Array(cnx * cnz + 1);
  for (let i = 0; i < count; i++) start[cellOf(i) + 1]++;
  for (let i = 0; i < cnx * cnz; i++) start[i + 1] += start[i];
  const order = new Uint32Array(count), fill = start.slice(0, cnx * cnz);
  for (let i = 0; i < count; i++) order[fill[cellOf(i)]++] = i;

  const last = new THREE.Vector3(1e9, 0, 0);
  let nearR = tier.treeNear, farR = Math.min(tier.treeFar, tier.far);
  let timer = 0;
  const fill2 = new Map<number, number>();
  function refresh(cam: THREE.Vector3) {
    for (const k of kinds) fill2.set(k, 0);
    let fc = 0;
    const n2 = nearR * nearR, f2 = farR * farR;
    const cx0 = Math.max(0, Math.floor((cam.x - farR - tx0) / CELL)), cx1 = Math.min(cnx - 1, Math.floor((cam.x + farR - tx0) / CELL));
    const cz0 = Math.max(0, Math.floor((cam.z - farR - tz0) / CELL)), cz1 = Math.min(cnz - 1, Math.floor((cam.z + farR - tz0) / CELL));
    const fa = farMesh.instanceMatrix.array as Float32Array, fcol = farMesh.instanceColor!.array as Float32Array, ka = kindAttr.array as Float32Array;
    for (let gz = cz0; gz <= cz1; gz++)
      for (let gx = cx0; gx <= cx1; gx++) {
        const cell = gz * cnx + gx;
        for (let o = start[cell]; o < start[cell + 1]; o++) {
          const i = order[o], b = i * F;
          const dx = data[b] - cam.x, dz = data[b + 2] - cam.z, d2 = dx * dx + dz * dz;
          if (d2 > f2) continue;
          const k = data[b + 5], s = data[b + 3];
          if (d2 < n2) {
            const m = nearMesh.get(k)!, j = fill2.get(k)!;
            writeInst(m.instanceMatrix.array as Float32Array, j, data[b], data[b + 1], data[b + 2], data[b + 4], s);
            const ca = m.instanceColor!.array as Float32Array;
            ca[j * 3] = tint[i * 3]; ca[j * 3 + 1] = tint[i * 3 + 1]; ca[j * 3 + 2] = tint[i * 3 + 2];
            fill2.set(k, j + 1);
          } else {
            const kind = KINDS[k], h = HEIGHT[kind] * s;
            writeInst(fa, fc, data[b], data[b + 1], data[b + 2], Math.atan2(dx, dz), h * WIDTH[kind] * 1.15, h, h * WIDTH[kind] * 1.15);
            fcol[fc * 3] = tint[i * 3]; fcol[fc * 3 + 1] = tint[i * 3 + 1]; fcol[fc * 3 + 2] = tint[i * 3 + 2];
            ka[fc] = k;
            fc++;
          }
        }
      }
    for (const [k, m] of nearMesh) {
      m.count = fill2.get(k)!;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
    }
    farMesh.count = fc;
    farMesh.instanceMatrix.needsUpdate = true;
    farMesh.instanceColor!.needsUpdate = true;
    kindAttr.needsUpdate = true;
  }

  return {
    group,
    count,
    update(dt: number, cam: THREE.Vector3) {
      timer -= dt;
      if (timer > 0 && last.distanceToSquared(cam) < 100) return;
      timer = 0.5;
      last.copy(cam);
      refresh(cam);
    },
    setTier(t: Tier) {
      nearR = t.treeNear;
      farR = Math.min(t.treeFar, t.far);
      for (const m of nearMesh.values()) m.castShadow = t.treeShadow;
      last.set(1e9, 0, 0);
    },
    dispose() {
      for (const m of nearMesh.values()) m.geometry.dispose();
      farGeo.dispose();
      near.dispose();
      farMat.dispose();
      depth.dispose();
      atlas.dispose();
      imp.dispose();
    },
  };
}
