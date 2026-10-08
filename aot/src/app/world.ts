import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Box } from "./contracts";
import { bark, cobble, grass, muscle, plaster, roofTiles, rng, stone } from "./world-textures";

export const WALL_IN = 360;
export const WALL_OUT = 372;
export const WALL_H = 50;
export const GATE = 14;
const CELL = 32;

type Uv = "box" | "roof" | "trunk";

function finish(g: THREE.BufferGeometry, tint: THREE.Color, tu: number, tv: number, mode: Uv = "box") {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute("uv");
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const nz = Math.abs(n.getZ(i));
    let u = x;
    let v = y;
    if (mode === "trunk") u = Math.atan2(n.getZ(i), n.getX(i)) * 2;
    else if (mode === "roof") u = nx > nz ? z : x;
    else if (ny > 0.7) v = z;
    else if (nx > nz) u = z;
    uv[i * 2] = u / tu;
    uv[i * 2 + 1] = v / tv;
    col.set([tint.r, tint.g, tint.b], i * 3);
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

function boxGeo(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  return new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ).translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
}

// Gable roof over a box top. The ridge runs along the long side.
function gable(minX: number, minZ: number, maxX: number, maxZ: number, y: number, rh: number) {
  const o = 0.5;
  const alongX = maxX - minX >= maxZ - minZ;
  const a = [minX - o, minZ - o, maxX + o, maxZ + o];
  const roof: number[] = [];
  const ends: number[] = [];
  const q = (p: number[][]) => roof.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  if (alongX) {
    const mz = (minZ + maxZ) / 2;
    q([[a[0], y, a[1]], [a[0], y + rh, mz], [a[2], y + rh, mz], [a[2], y, a[1]]]);
    q([[a[2], y, a[3]], [a[2], y + rh, mz], [a[0], y + rh, mz], [a[0], y, a[3]]]);
    ends.push(minX, y, maxZ, minX, y + rh, mz, minX, y, minZ, maxX, y, minZ, maxX, y + rh, mz, maxX, y, maxZ);
  } else {
    const mx = (minX + maxX) / 2;
    q([[a[0], y, a[3]], [mx, y + rh, a[3]], [mx, y + rh, a[1]], [a[0], y, a[1]]]);
    q([[a[2], y, a[1]], [mx, y + rh, a[1]], [mx, y + rh, a[3]], [a[2], y, a[3]]]);
    ends.push(minX, y, minZ, mx, y + rh, minZ, maxX, y, minZ, maxX, y, maxZ, mx, y + rh, maxZ, minX, y, maxZ);
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute("position", new THREE.Float32BufferAttribute(roof, 3));
  const e = new THREE.BufferGeometry();
  e.setAttribute("position", new THREE.Float32BufferAttribute(ends, 3));
  return { roof: r, ends: e };
}

export function createWorld() {
  const r = rng(7);
  const group = new THREE.Group();
  const boxes: Box[] = [];
  const walls: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];
  const stones: THREE.BufferGeometry[] = [];
  const trunks: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const wood: THREE.BufferGeometry[] = [];
  const white = new THREE.Color(1, 1, 1);

  const solid = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boxes.push({ minX, minY, minZ, maxX, maxY, maxZ });

  const house = (minX: number, minZ: number, maxX: number, maxZ: number, floors: number) => {
    const h = floors * 3.2;
    const rh = 2.5 + Math.min(maxX - minX, maxZ - minZ) * 0.22;
    const tint = new THREE.Color().setHSL(0.08 + r() * 0.06, 0.25 + r() * 0.3, 0.75 + r() * 0.2);
    walls.push(finish(boxGeo(minX, 0, minZ, maxX, h, maxZ), tint, 4, 3.2));
    const g = gable(minX, minZ, maxX, maxZ, h, rh);
    roofs.push(finish(g.roof, new THREE.Color().setHSL(0.03 + r() * 0.03, 0.5, 0.5 + r() * 0.35), 2, 1.4, "roof"));
    walls.push(finish(g.ends, tint, 4, 3.2));
    solid(minX, 0, minZ, maxX, h + rh * 0.5, maxZ);
  };

  // Town blocks: 44 m squares on a 60 m pitch, streets on multiples of 60.
  const forest = (x: number, z: number) => x > 90 && z < -90;
  for (let i = 0; i < 12; i++)
    for (let j = 0; j < 12; j++) {
      const cx = -330 + i * 60;
      const cz = -330 + j * 60;
      if (forest(cx, cz)) continue;
      if (Math.abs(cx) < 40 && Math.abs(cz) < 40) continue;
      const tall = Math.max(0, 1 - Math.hypot(cx, cz) / 300);
      const xs = [cx - 22];
      while (xs[xs.length - 1] < cx + 22 - 10) xs.push(Math.min(cx + 22, xs[xs.length - 1] + 9 + r() * 8));
      xs[xs.length - 1] = cx + 22;
      for (let k = 0; k + 1 < xs.length; k++) {
        const zs = [cz - 22];
        while (zs[zs.length - 1] < cz + 22 - 10) zs.push(Math.min(cz + 22, zs[zs.length - 1] + 9 + r() * 8));
        zs[zs.length - 1] = cz + 22;
        for (let m = 0; m + 1 < zs.length; m++) {
          const inner = k > 0 && k + 2 < xs.length && m > 0 && m + 2 < zs.length;
          if (inner && r() < 0.6) continue;
          const floors = 2 + Math.floor(r() * (1.6 + tall * 3));
          house(xs[k] + 0.3, zs[m] + 0.3, xs[k + 1] - 0.3, zs[m + 1] - 0.3, floors);
        }
      }
    }

  // Church on the plaza: nave and bell tower.
  house(-34, -38, -16, -8, 4);
  const tower = { minX: -34, maxX: -22, minZ: -50, maxZ: -38 };
  walls.push(finish(boxGeo(tower.minX, 0, tower.minZ, tower.maxX, 38, tower.maxZ), new THREE.Color("#f2e6cc"), 4, 3.2));
  const spire = new THREE.ConeGeometry(8.6, 16, 4, 1).rotateY(Math.PI / 4).translate(-28, 46, -44);
  roofs.push(finish(spire, new THREE.Color("#5f7f78"), 2, 1.4, "roof"));
  solid(tower.minX, 0, tower.minZ, tower.maxX, 40, tower.maxZ);
  stones.push(finish(new THREE.CylinderGeometry(5, 5.5, 1.2, 16).translate(0, 0.6, -20), white, 4, 2));
  solid(-4.5, 0, -24.5, 4.5, 1.2, -15.5);

  // The wall, with the gate breached.
  const wallBox = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    stones.push(finish(boxGeo(minX, 0, minZ, maxX, WALL_H, maxZ), white, 8, 4));
    solid(minX, 0, minZ, maxX, WALL_H, maxZ);
  };
  wallBox(-WALL_OUT, -WALL_OUT, WALL_OUT, -WALL_IN);
  wallBox(-WALL_OUT, WALL_IN, -GATE, WALL_OUT);
  wallBox(GATE, WALL_IN, WALL_OUT, WALL_OUT);
  wallBox(-WALL_OUT, -WALL_IN, -WALL_IN, WALL_IN);
  wallBox(WALL_IN, -WALL_IN, WALL_OUT, WALL_IN);
  for (let i = 0; i < 9; i++) {
    const s = 2 + r() * 4;
    const x = (r() - 0.5) * 34;
    const z = WALL_IN - 6 + r() * 20;
    stones.push(finish(new THREE.DodecahedronGeometry(s, 0).translate(x, s * 0.5, z), white, 8, 4));
    solid(x - s * 0.7, 0, z - s * 0.7, x + s * 0.7, s * 1.2, z + s * 0.7);
  }

  // Giant trees in the north-east.
  for (let x = 110; x < 350; x += 30)
    for (let z = -345; z < -100; z += 30) {
      const tx = x + (r() - 0.5) * 16;
      const tz = z + (r() - 0.5) * 16;
      const rad = 2.2 + r() * 1.2;
      const h = 70 + r() * 25;
      trunks.push(finish(new THREE.CylinderGeometry(rad * 0.8, rad * 1.25, h, 10, 1).translate(tx, h / 2, tz), white, 4, 8, "trunk"));
      const k = rad * 0.85;
      solid(tx - k, 0, tz - k, tx + k, h, tz + k);
      for (let b = 0; b < 4; b++) {
        const a = r() * Math.PI * 2;
        const y = 28 + r() * 30;
        const len = 9 + r() * 8;
        const br = new THREE.CylinderGeometry(0.35, 0.8, len, 6).translate(0, len / 2, 0).rotateZ(-1.1).rotateY(a).translate(tx, y, tz);
        wood.push(finish(br, white, 4, 8, "trunk"));
      }
      for (let c = 0; c < 6; c++) {
        const cr = 7 + r() * 6;
        const geo = new THREE.IcosahedronGeometry(cr, 1).scale(1, 0.7, 1).translate(tx + (r() - 0.5) * 16, h - 6 + (r() - 0.3) * 14, tz + (r() - 0.5) * 16);
        leaves.push(finish(geo, new THREE.Color().setHSL(0.27 + r() * 0.06, 0.45, 0.22 + r() * 0.1), 6, 6));
      }
    }

  // Supply depots sit on street crossings.
  const supplies = [new THREE.Vector3(0, 0, 40), new THREE.Vector3(-240, 0, -180), new THREE.Vector3(180, 0, 120), new THREE.Vector3(-240, 0, 240), new THREE.Vector3(60, 0, -300)];
  for (const s of supplies) {
    wood.push(finish(boxGeo(s.x - 2.5, 0.6, s.z - 1.2, s.x + 2.5, 1.8, s.z + 1.2), new THREE.Color("#a67b4f"), 2, 2));
    for (let c = 0; c < 3; c++) {
      const cx = s.x - 1.6 + c * 1.6;
      wood.push(finish(boxGeo(cx - 0.6, 1.8, s.z - 0.6, cx + 0.6, 3, s.z + 0.6), new THREE.Color("#c99a62"), 2, 2));
    }
    solid(s.x - 2.5, 0, s.z - 1.2, s.x + 2.5, 3, s.z + 1.2);
  }

  const texWall = plaster();
  const texRoof = roofTiles();
  const texStone = stone();
  const texBark = bark();
  const mesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    for (const g of geos) g.dispose();
    return m;
  };
  mesh(walls, new THREE.MeshStandardMaterial({ map: texWall, vertexColors: true, roughness: 0.92 }));
  mesh(roofs, new THREE.MeshStandardMaterial({ map: texRoof, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  mesh(stones, new THREE.MeshStandardMaterial({ map: texStone, vertexColors: true, roughness: 0.95 }));
  mesh(trunks, new THREE.MeshStandardMaterial({ map: texBark, vertexColors: true, roughness: 1 }));
  mesh(wood, new THREE.MeshStandardMaterial({ map: texBark, vertexColors: true, roughness: 0.9 }));
  mesh(leaves, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));

  const texGrass = grass();
  texGrass.repeat.set(500, 500);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: texGrass, roughness: 1 }));
  ground.receiveShadow = true;
  group.add(ground);
  const texCobble = cobble();
  texCobble.repeat.set(180, 180);
  const street = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_IN * 2, WALL_IN * 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: texCobble, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  street.receiveShadow = true;
  group.add(street);

  const flareMat = new THREE.MeshBasicMaterial({ color: "#7dff9a", transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const flareGeo = new THREE.CylinderGeometry(0.6, 1.4, 140, 8, 1, true).translate(0, 70, 0);
  for (const s of supplies) {
    const f = new THREE.Mesh(flareGeo, flareMat);
    f.position.copy(s);
    group.add(f);
  }

  // The Colossal Titan looks over the breached gate.
  const colossal = new THREE.Group();
  const flesh = new THREE.MeshStandardMaterial({ map: muscle(), roughness: 0.7, color: "#d08a7a" });
  const head = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 24), flesh);
  head.scale.set(0.95, 1.15, 0.9);
  head.position.set(0, WALL_H + 2, WALL_OUT + 40);
  const eyeMat = new THREE.MeshStandardMaterial({ color: "#fff4d0", emissive: "#ffcf6a", emissiveIntensity: 0.6 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), eyeMat);
    eye.position.set(sx * 5.5, 3, -13);
    head.add(eye);
  }
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(15, 4, 2), new THREE.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.5 }));
  teeth.position.set(0, -7, -13);
  head.add(teeth);
  colossal.add(head);
  for (const sx of [-1, 1]) {
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(10.5, 12, 3), flesh);
    palm.position.set(0, -6, 0);
    hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4, 4, 8), flesh);
      finger.rotation.x = Math.PI / 2;
      finger.position.set((f - 1.5) * 2.4, 0.9, -3.5);
      hand.add(finger);
    }
    hand.position.set(sx * 26, WALL_H, WALL_OUT + 1.5);
    colossal.add(hand);
  }
  colossal.traverse((o) => (o.castShadow = true));
  group.add(colossal);
  solid(-14, WALL_H - 18, WALL_OUT + 26, 14, WALL_H + 20, WALL_OUT + 54);

  const grid = new Map<number, Box[]>();
  const key = (a: number, b: number) => a * 4096 + b;
  for (const b of boxes)
    for (let a = Math.floor(b.minX / CELL); a <= Math.floor(b.maxX / CELL); a++)
      for (let c = Math.floor(b.minZ / CELL); c <= Math.floor(b.maxZ / CELL); c++) {
        if (!grid.has(key(a, c))) grid.set(key(a, c), []);
        grid.get(key(a, c))!.push(b);
      }
  const found = new Set<Box>();
  const near = (x: number, z: number, radius: number) => {
    found.clear();
    const n = Math.ceil(radius / CELL);
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = gx - n; a <= gx + n; a++) for (let b = gz - n; b <= gz + n; b++) grid.get(key(a, b))?.forEach((bx) => found.add(bx));
    return found;
  };

  return {
    group,
    boxes,
    near,
    supplies,
    colossalHead: head.position.clone(),
    spawn: new THREE.Vector3(-50, WALL_H + 1, (WALL_IN + WALL_OUT) / 2),
    breach: new THREE.Vector3(0, 0, WALL_OUT),
  };
}

export type World = ReturnType<typeof createWorld>;

let tMin = 0;
let tMax = 0;
let hitAxis = 0;
let hitSign = 0;
function slab(o: number, d: number, lo: number, hi: number, axis: number) {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) [a, b] = [b, a];
  if (a > tMin) {
    tMin = a;
    hitAxis = axis;
    hitSign = d > 0 ? -1 : 1;
  }
  if (b < tMax) tMax = b;
  return tMin <= tMax;
}

export function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box, n?: THREE.Vector3) {
  tMin = -Infinity;
  tMax = Infinity;
  hitAxis = -1;
  if (!slab(o.x, d.x, b.minX, b.maxX, 0) || !slab(o.y, d.y, b.minY, b.maxY, 1) || !slab(o.z, d.z, b.minZ, b.maxZ, 2)) return -1;
  if (tMin < 0) return -1;
  n?.set(hitAxis === 0 ? hitSign : 0, hitAxis === 1 ? hitSign : 0, hitAxis === 2 ? hitSign : 0);
  return tMin;
}

const _n = new THREE.Vector3();
// Hits boxes and the ground plane. Returns the distance, or -1.
export function raycast(world: World, o: THREE.Vector3, d: THREE.Vector3, maxT: number, n?: THREE.Vector3) {
  let best = -1;
  if (d.y < -1e-6 && o.y > 0) {
    const t = -o.y / d.y;
    if (t <= maxT) {
      best = t;
      n?.set(0, 1, 0);
    }
  }
  for (const b of world.near(o.x + (d.x * maxT) / 2, o.z + (d.z * maxT) / 2, maxT / 2 + 2)) {
    const t = rayBox(o, d, b, _n);
    if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
      best = t;
      n?.copy(_n);
    }
  }
  return best;
}
