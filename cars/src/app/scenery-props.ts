import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import type { Blocker } from "./scenery-buildings";
import { canvasTex, centerAt, eachRecord, Geo, noise2, pick, rng, U, writeInst, type RoadIndex, type Style, type Tier } from "./scenery-kit";

// Instanced meshes whose `aTint` vertices take the instance color; the rest keep the vertex color.
export function tintMaterial(key: string, bob = 0) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aTint; uniform float uTime;")
      .replace("#include <color_vertex>", "vColor = vec4(1.0);\nvColor.rgb *= color;\nvColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz; float hb = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        transformed.y += ${bob.toFixed(3)} * max(0.0, sin(uTime * (3.0 + hb * 4.0) + hb * 40.0)) * step(0.7, hb);`,
      );
  };
  m.customProgramCacheKey = () => "tint" + key;
  return m;
}

export function tintGeo(g: Geo, tint: number[]) {
  const b = g.build(false);
  b.setAttribute("aTint", new THREE.Float32BufferAttribute(tint, 1));
  return b;
}

function carGeo() {
  const g = new Geo(), t: number[] = [];
  const mark = (v: number) => {
    while (t.length < g.count) t.push(v);
  };
  g.col.set("#ffffff");
  g.box(0, 0.32, 0, 4.3, 0.7, 1.78);
  g.box(-0.25, 1.02, 0, 2.3, 0.08, 1.5);
  mark(1);
  g.col.set("#1a1f25");
  g.box(-0.25, 1.0, 0, 2.2, 0.5, 1.52);
  g.col.set("#ffffff");
  mark(0);
  g.box(-0.25, 1.48, 0, 1.9, 0.06, 1.42);
  mark(1);
  g.col.set("#0d0d0d");
  for (const x of [-1.35, 1.35]) for (const z of [-0.78, 0.78]) g.box(x, 0, z, 0.66, 0.66, 0.26);
  g.col.set("#d8d8d0");
  g.box(2.14, 0.6, 0.6, 0.06, 0.15, 0.3);
  g.box(2.14, 0.6, -0.6, 0.06, 0.15, 0.3);
  mark(0);
  return tintGeo(g, t);
}

const ICO = new THREE.IcosahedronGeometry(1, 1).attributes.position;

function rock(g: Geo, x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number) {
  const P: number[][] = [];
  for (let i = 0; i < ICO.count; i++) {
    const vx = ICO.getX(i), vy = ICO.getY(i), vz = ICO.getZ(i);
    const k = 0.75 + 0.5 * noise2(vx * 1.7 + seed, vz * 1.7 + vy * 2.3 - seed);
    P.push([x + vx * sx * k, y + Math.max(vy, -0.3) * sy * k, z + vz * sz * k]);
  }
  for (let i = 0; i < P.length; i += 3) g.tri(P[i][0], P[i][1], P[i][2], P[i + 1][0], P[i + 1][1], P[i + 1][2], P[i + 2][0], P[i + 2][1], P[i + 2][2]);
}

function cone(g: Geo, x: number, y: number, z: number) {
  g.col.set("#1b1b1b");
  g.box(x, y, z, 0.4, 0.04, 0.4);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    for (const [h0, h1, r0, r1, c] of [[0.04, 0.3, 0.16, 0.11, "#ff5a14"], [0.3, 0.45, 0.11, 0.07, "#f2f2f2"], [0.45, 0.7, 0.07, 0.02, "#ff5a14"]] as const) {
      g.col.set(c);
      g.quad([x + Math.cos(a1) * r0, y + h0, z + Math.sin(a1) * r0], [x + Math.cos(a0) * r0, y + h0, z + Math.sin(a0) * r0], [x + Math.cos(a0) * r1, y + h1, z + Math.sin(a0) * r1], [x + Math.cos(a1) * r1, y + h1, z + Math.sin(a1) * r1]);
    }
  }
}

function poleGeo(arm: number, h: number) {
  const g = new Geo();
  g.col.set("#5c6066");
  g.box(0, 0, 0, 0.2, h, 0.2);
  g.box(arm / 2, h - 0.12, 0, arm, 0.12, 0.12);
  g.col.set("#3a3d42");
  g.box(arm - 0.15, h - 0.3, 0, 0.75, 0.22, 0.32);
  return g.build(false);
}

export function createProps(map: MapData, track: Track, roads: RoadIndex, style: Style, blocker: Blocker, tier: Tier) {
  const group = new THREE.Group();
  group.name = "props";
  const r = rng(map.center.length + 99);
  const N = map.center.length / 3;
  const pos = new THREE.Vector3(), left = new THREE.Vector3();
  const tunnel = new Uint8Array(N), elev = new Uint8Array(N);
  for (const [a, b] of map.tunnels) for (let i = a; i <= b && i < N; i++) tunnel[i] = 1;
  for (const [a, b] of map.elevated) for (let i = a; i <= b && i < N; i++) elev[i] = 1;
  const edgeOff = (i: number) => map.width[i] / 2 + map.runoff[i];
  const disposables: { dispose(): void }[] = [];
  const add = <T extends THREE.Object3D>(o: T) => (group.add(o), o);

  // Street lights: one mesh for the poles, one for the glowing heads, one for the pools of light on the road.
  const lamps: number[] = []; // x, y, z, yaw, poolX, poolY, poolZ
  if (style.lights) {
    const every = map.id === "tokyo" ? 8 : 6;
    for (let i = 0; i < N; i += every) {
      if (tunnel[i]) continue;
      centerAt(map, i, pos, left);
      const s = map.id === "monaco" ? (Math.floor(i / every) % 3 === 0 ? -1 : 1) : (Math.floor(i / every) % 2 ? 1 : -1);
      const off = edgeOff(i) + 1.1;
      const x = pos.x + left.x * off * s, z = pos.z + left.z * off * s;
      if (roads.edge(x, z) < -0.2 || blocker.blocked(x, z)) continue;
      const y = elev[i] ? pos.y + 0.8 : track.heightAt(x, z);
      const yaw = Math.atan2(left.z * s, -left.x * s);
      lamps.push(x, y, z, yaw, pos.x + left.x * (off - 3.2) * s, pos.y + 0.04, pos.z + left.z * (off - 3.2) * s);
    }
    eachRecord(map.roads, 1, (o, n, head) => {
      const w = map.roads[head + 1];
      for (let k = 0; k < n - 1; k++) {
        const ax = map.roads[o + k * 2], az = map.roads[o + k * 2 + 1], bx = map.roads[o + k * 2 + 2], bz = map.roads[o + k * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 5) continue;
        const ox = -(bz - az) / len, oz = (bx - ax) / len;
        for (let d = 10; d < len; d += 32) {
          const x = ax + ((bx - ax) * d) / len + ox * (w / 2 + 0.6), z = az + ((bz - az) * d) / len + oz * (w / 2 + 0.6);
          if (roads.edge(x, z) < 2 || blocker.blocked(x, z) || r() > tier.props) continue;
          const y = track.heightAt(x, z);
          lamps.push(x, y, z, Math.atan2(-oz, ox) + Math.PI, x - ox * 3, y + 0.04, z - oz * 3);
        }
      }
    });
  }
  const nL = lamps.length / 7;
  const poleH = map.id === "tokyo" ? 10 : 8.5, arm = 2.2;
  let headMat: THREE.MeshStandardMaterial | null = null, poolMat: THREE.MeshBasicMaterial | null = null;
  if (nL) {
    const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 });
    const poles = add(new THREE.InstancedMesh(poleGeo(arm, poleH), propMat, nL));
    headMat = new THREE.MeshStandardMaterial({ color: "#d9d6cc", emissive: "#ffc98a", emissiveIntensity: 0, roughness: 0.3 });
    const heads = add(new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.05, 0.26).translate(arm - 0.15, poleH - 0.32, 0), headMat, nL));
    const pool = canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,200,140,0.9)");
      gr.addColorStop(0.5, "rgba(255,180,110,0.35)");
      gr.addColorStop(1, "rgba(255,170,100,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    });
    poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
    const pools = add(new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), poolMat, nL));
    pools.renderOrder = 2;
    for (let k = 0; k < nL; k++) {
      const o = k * 7;
      writeInst(poles.instanceMatrix.array as Float32Array, k, lamps[o], lamps[o + 1], lamps[o + 2], lamps[o + 3], 1);
      writeInst(heads.instanceMatrix.array as Float32Array, k, lamps[o], lamps[o + 1], lamps[o + 2], lamps[o + 3], 1);
      writeInst(pools.instanceMatrix.array as Float32Array, k, lamps[o + 4], lamps[o + 5], lamps[o + 6], 0, 1);
    }
    poles.castShadow = true;
    for (const m of [poles, heads, pools]) m.computeBoundingSphere();
    disposables.push(propMat, headMat, poolMat, pool, poles.geometry, heads.geometry, pools.geometry);
  }

  // Merged static clutter: brake boards, marshal posts, stone guard posts.
  const g = new Geo();
  const P = map.center;
  const heading = (i: number) => {
    const a = ((i % N) + N) % N, b = (a + 1) % N;
    return Math.atan2(P[b * 3 + 2] - P[a * 3 + 2], P[b * 3] - P[a * 3]);
  };
  if (map.id !== "stelvio" && map.id !== "tokyo" && map.id !== "sanfrancisco") {
    let cool = 0;
    for (let i = 0; i < N; i++) {
      if (cool-- > 0) continue;
      let turn = heading(i + 12) - heading(i);
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (Math.abs(turn) < 0.75) continue;
      const side = turn > 0 ? 1 : -1;
      for (const [d, stripes] of [[20, 1], [30, 2], [40, 3]]) {
        const j = (i - d + N) % N;
        if (tunnel[j]) continue;
        centerAt(map, j, pos, left);
        const off = edgeOff(j) + 1.2;
        const x = pos.x + left.x * off * side, z = pos.z + left.z * off * side;
        if (roads.edge(x, z) < 0.5) continue;
        const y = elev[j] ? pos.y : track.heightAt(x, z), yaw = Math.atan2(-left.z, left.x);
        g.col.set("#3a3d42");
        g.box(x, y, z, 0.12, 1.6, 0.12, yaw);
        g.col.set("#f2f2f0");
        g.box(x, y + 1.6, z, 1.4, 1.0, 0.06, yaw);
        g.col.set("#1b1b1b");
        for (let s = 0; s < stripes; s++) g.box(x, y + 1.7 + s * 0.28, z, 1.2, 0.14, 0.08, yaw);
      }
      cool = 60;
    }
  }
  if (style.marshal)
    for (let i = 30; i < N; i += 70) {
      if (tunnel[i]) continue;
      centerAt(map, i, pos, left);
      const s = i % 140 < 70 ? 1 : -1, off = edgeOff(i) + 3;
      const x = pos.x + left.x * off * s, z = pos.z + left.z * off * s;
      if (roads.edge(x, z) < 1.5 || blocker.blocked(x, z)) continue;
      const y = track.heightAt(x, z), yaw = Math.atan2(-left.z, left.x);
      g.col.set("#e8e6e0");
      g.box(x, y, z, 2.4, 2.4, 2.0, yaw);
      g.col.set("#e2591e");
      g.box(x, y + 2.4, z, 2.8, 0.25, 2.4, yaw);
      g.col.set("#2a2d33");
      g.box(x + left.x * s * 1.01, y + 1.2, z + left.z * s * 1.01, 1.8, 0.7, 0.1, yaw);
      g.col.set("#c9c9c9");
      g.box(x + left.x * 1.4, y, z + left.z * 1.4, 0.08, 4, 0.08, yaw);
      for (let c = 0; c < 3; c++) {
        const cx = x + left.x * s * (1.6 + c * 0.1) + left.z * (c - 1) * 0.6, cz = z + left.z * s * (1.6 + c * 0.1) - left.x * (c - 1) * 0.6;
        cone(g, cx, track.heightAt(cx, cz), cz);
      }
    }
  if (map.id === "stelvio")
    for (let i = 0; i < N; i += 2) {
      if (tunnel[i]) continue;
      centerAt(map, i, pos, left);
      for (const s of [-1, 1]) {
        if (map.runoff[i] > 2 && r() < 0.7) continue;
        const off = edgeOff(i) + 0.35;
        const x = pos.x + left.x * off * s, z = pos.z + left.z * off * s;
        if (roads.edge(x, z) < 0.1) continue;
        const y = Math.max(pos.y - 0.3, track.heightAt(x, z) - 0.2);
        g.col.set(pick(r, ["#d8d4cb", "#cfc9bd", "#e2ded6"]));
        g.box(x, y, z, 0.38, 0.75, 0.32, Math.atan2(-left.z, left.x) + (r() - 0.5) * 0.2);
      }
    }
  if (map.id === "stelvio" || map.id === "nordschleife" || map.id === "spa") {
    const want = Math.round(500 * tier.props);
    for (let k = 0, t = 0; k < want && t < want * 10; t++) {
      centerAt(map, Math.floor(r() * N), pos, left);
      const s = r() < 0.5 ? -1 : 1, off = edgeOff(0) + 4 + r() * 250;
      const x = pos.x + left.x * off * s, z = pos.z + left.z * off * s;
      if (roads.edge(x, z) < 3) continue;
      const y = track.heightAt(x, z);
      if (map.id !== "stelvio" && r() < 0.8) continue;
      k++;
      const sz = 0.8 + r() * r() * 5;
      g.col.set(pick(r, ["#8a8680", "#77736d", "#9a958c", "#6d6a66"]));
      rock(g, x, y - sz * 0.35, z, sz * (1 + r()), sz * (0.6 + r() * 0.5), sz * (1 + r()), r() * 100);
    }
  }
  // Parked cars along the other streets, never close to the circuit.
  const cars: number[] = [];
  const maxCars = Math.round(500 * tier.props);
  eachRecord(map.roads, 1, (o, n, head) => {
    const w = map.roads[head + 1];
    if (w < 5) return;
    for (let k = 0; k < n - 1 && cars.length / 4 < maxCars; k++) {
      const ax = map.roads[o + k * 2], az = map.roads[o + k * 2 + 1], bx = map.roads[o + k * 2 + 2], bz = map.roads[o + k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 8) continue;
      const ox = -(bz - az) / len, oz = (bx - ax) / len, yaw = Math.atan2(-(bz - az), bx - ax);
      for (let d = 4; d < len - 4; d += 5.6)
        for (const s of [-1, 1]) {
          if (r() > 0.45) continue;
          const x = ax + ((bx - ax) * d) / len + ox * s * (w / 2 - 1.1), z = az + ((bz - az) * d) / len + oz * s * (w / 2 - 1.1);
          if (roads.edge(x, z) < 15 || blocker.blocked(x, z)) continue;
          if (r() < 0.015) {
            for (let c = 0; c < 4; c++) cone(g, x + (bx - ax) / len * c * 1.5, track.heightAt(x, z), z + (bz - az) / len * c * 1.5);
            continue;
          }
          cars.push(x, track.heightAt(x, z), z, yaw + (s < 0 ? Math.PI : 0) + (r() - 0.5) * 0.05);
        }
    }
  });
  let carMat: THREE.Material | null = null;
  if (cars.length) {
    carMat = tintMaterial("car");
    const n = cars.length / 4;
    const m = add(new THREE.InstancedMesh(carGeo(), carMat, n));
    const pal = ["#e8e8e8", "#1b1b1d", "#8c9096", "#5a6068", "#9a1b1b", "#1d3a6a", "#c9c3b2", "#2f4a3a", "#f0f0ea", "#3a3a3c"];
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      writeInst(m.instanceMatrix.array as Float32Array, k, cars[k * 4], cars[k * 4 + 1], cars[k * 4 + 2], cars[k * 4 + 3], 1);
      m.setColorAt(k, col.set(pick(r, pal)));
    }
    m.castShadow = m.receiveShadow = true;
    m.computeBoundingSphere();
    disposables.push(m.geometry, carMat);
  }

  if (g.count) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    const mesh = add(new THREE.Mesh(g.build(false), mat));
    mesh.castShadow = mesh.receiveShadow = true;
    disposables.push(mat, mesh.geometry);
  }

  return {
    group,
    setNight(n: number) {
      if (headMat) headMat.emissiveIntensity = n * 6;
      if (poolMat) poolMat.opacity = n * 0.55;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
