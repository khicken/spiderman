import * as THREE from "three";
import { Bucket, Bulbs, Tiled, blinkify } from "./city-kit";
import { FACADES, facadeTextures, groundTexture, parkTexture, shopTexture, signAtlas, softDot, tickerTexture, waterNormal } from "./city-textures";
import {
  genDowntown, genFiller, genHarlem, genIndustrial, genLandmark, genMidtown, genPlaza, genSite, genTimes, genUpper,
  billboardWall, face, floors, mass, type Block, type Box, type Ctx,
} from "./city-build";
import { blockStreet, parkBlock, signals, steam, treeMeshes, type District } from "./city-props";
import { bridge, promenade } from "./city-river";
import { createTraffic, type Road } from "./city-cars";
import { STYLE, SHOP_H } from "./city-textures";

export type { Box } from "./city-build";
export type { Road } from "./city-cars";
export { LANES, PARK_LANE } from "./city-cars";

export const BLOCK = 64;
export const STREET = 22;
export const PERIOD = BLOCK + STREET;
export const BLOCKS = 14;
export const HALF = (BLOCKS * PERIOD) / 2;
const MAX_CARS = 320;
const TILE = PERIOD * 9;
const TILE0 = -HALF - 2 * PERIOD;
const OUT = 2;
const RIVER_W = HALF + 30;
const FAR = -HALF + 18 * PERIOD;
const RIVER_E = FAR - 30;

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lineAt = (k: number) => -HALF + k * PERIOD;

function district(i: number, j: number): District {
  if (i === 7 && j === 7) return "landmark";
  if (i === 8 && j === 7) return "plaza";
  if (i === 6 && j === 8) return "times";
  if (i === 10 && j === 9) return "site";
  if (i >= 5 && i <= 8 && j >= 2 && j <= 4) return "park";
  if (j === 5 && i >= 5 && i <= 8) return "cps";
  if (j <= 1 || (j <= 5 && (i <= 1 || i >= 12))) return "harlem";
  if (j <= 5) return "upper";
  if ((j >= 11 && i >= 8) || (i >= 12 && j >= 9)) return "downtown";
  if ((i <= 2 && j >= 6) || j >= 11) return "industrial";
  return "midtown";
}

function blockAt(i: number, j: number): Block {
  return { i, j, x0: lineAt(i) + STREET / 2 + 4, x1: lineAt(i + 1) - STREET / 2 - 4, z0: lineAt(j) + STREET / 2 + 4, z1: lineAt(j + 1) - STREET / 2 - 4 };
}

function genTimesNeighbor(c: Ctx, b: Block, towardTimes: number, maxH: number) {
  const r = c.r;
  const split = r() < 0.6;
  const lots: [number, number, number, number][] = split
    ? [[b.x0, b.x0 + 27.6, b.z0, b.z1], [b.x0 + 28.4, b.x1, b.z0, b.z1]]
    : [[b.x0, b.x1, b.z0, b.z1]];
  lots.forEach(([x0, x1, z0, z1], k) => {
    const style = [STYLE.darkglass, STYLE.office, STYLE.glass][Math.floor(r() * 3)];
    const h = k === 0 && maxH < 80 ? floors(style, SHOP_H, 11) : floors(style, SHOP_H, Math.round((35 + r() * (maxH - 35)) / FACADES[style].ch));
    mass(c, x0, x1, z0, z1, 0, h, { style, shop: r() < 0.5 ? 0 : 2, vBase: SHOP_H });
    for (let f = 0; f < 4; f++) {
      const F = face(f, x0, x1, z0, z1);
      const outer = (f === 0 && z0 <= b.z0) || (f === 2 && z1 >= b.z1) || (f === 1 && x1 >= b.x1) || (f === 3 && x0 <= b.x0);
      if (!outer) continue;
      billboardWall(c, F, 6, Math.min(h - 3, f === towardTimes ? 34 : 18), f === towardTimes ? 0.9 : 0.3);
    }
  });
}

export function createCity(seed = 7) {
  const r = rng(seed);
  const group = new THREE.Group();
  const time = { value: 0 };
  const atlas = signAtlas(r);
  const wu = atlas.white;
  const c: Ctx = {
    r,
    atlas,
    facade: FACADES.map(() => new Bucket()),
    shop: new Bucket(),
    solid: new Tiled(TILE, TILE0),
    small: new Tiled(TILE, TILE0),
    glow: new Bucket(wu, true),
    glowSmall: new Bucket(wu, true),
    ice: new Bucket(),
    ticker: new Bucket(),
    bulbs: new Bulbs(),
    boxes: [],
    roofSpots: [],
    streetSpots: [],
    landmarks: [],
    trees: [],
    pines: [],
  };
  const park = new Bucket();
  const vents: { x: number; z: number; stack: boolean }[] = [];

  for (let i = -OUT; i < BLOCKS + OUT; i++) {
    for (let j = -OUT; j < BLOCKS + OUT; j++) {
      const b = blockAt(i, j);
      const inside = i >= 0 && j >= 0 && i < BLOCKS && j < BLOCKS;
      if (!inside) {
        if (i >= BLOCKS) continue;
        genFiller(c, b, i < 0 && j > 5 ? "ind" : j < 0 ? "brick" : "mixed", j >= BLOCKS ? 0.8 : 1);
        continue;
      }
      const d = district(i, j);
      if (d === "landmark") genLandmark(c, b);
      else if (d === "plaza") genPlaza(c, b);
      else if (d === "times") genTimes(c, b);
      else if (d === "site") genSite(c, b);
      else if (d === "park") parkBlock(c, b, park, i === 6 && j === 3);
      else if (d === "harlem") genHarlem(c, b);
      else if (d === "upper" || d === "cps") genUpper(c, b, d === "cps");
      else if (d === "industrial") genIndustrial(c, b);
      else if (d === "downtown") genDowntown(c, b, i === 11 && j === 12);
      else if (Math.abs(i - 6) + Math.abs(j - 8) === 1) genTimesNeighbor(c, b, i < 6 ? 1 : i > 6 ? 3 : j < 8 ? 2 : 0, i === 7 ? 70 : 130);
      else genMidtown(c, b, 0.55 + 0.85 * Math.exp(-((Math.hypot(i - 7, j - 7) / 3.2) ** 2)));
      blockStreet(c, b, d, vents);
    }
  }
  const parkC = blockAt(6, 3);
  c.landmarks.push({ name: "Central Park", pos: new THREE.Vector3(parkC.x1 + STREET / 2 + 4, 0, parkC.z1 + STREET / 2 + 4) });
  const harlem = blockAt(7, 0);
  c.landmarks.push({ name: "Harlem", pos: new THREE.Vector3((harlem.x0 + harlem.x1) / 2, 0, harlem.z1 + 2) });

  for (let i = 0; i < 4; i++) {
    for (let j = -OUT; j < BLOCKS + OUT; j++) {
      const x0 = FAR + STREET / 2 + 4 + i * PERIOD;
      const z0 = lineAt(j) + STREET / 2 + 4;
      genFiller(c, { i: 100 + i, j, x0, x1: x0 + BLOCK - 8, z0, z1: z0 + BLOCK - 8 }, r() < 0.5 ? "ind" : r() < 0.7 ? "brick" : "mixed", 0.9);
    }
  }
  const bridgeZ = lineAt(12);
  bridge(c, RIVER_W, RIVER_E, bridgeZ);
  promenade(c, RIVER_W, lineAt(-OUT), lineAt(BLOCKS + OUT), bridgeZ);

  const facades = facadeTextures(r);
  const shopT = shopTexture(r);
  const shadowed = (m: THREE.Mesh, cast = true) => {
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  };
  FACADES.forEach((f, i) => {
    if (!c.facade[i].tris) return;
    const mat = new THREE.MeshStandardMaterial({
      map: facades[i].map,
      emissiveMap: facades[i].emissive,
      emissive: 0xffffff,
      emissiveIntensity: f.glow,
      roughness: f.rough,
      metalness: f.metal,
      vertexColors: true,
      envMapIntensity: f.env ?? 1,
    });
    group.add(shadowed(new THREE.Mesh(c.facade[i].build(), mat)));
  });
  group.add(shadowed(new THREE.Mesh(c.shop.build(), new THREE.MeshStandardMaterial({ map: shopT.map, emissiveMap: shopT.emissive, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.5, vertexColors: true }))));
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
  for (const m of (c.solid as Tiled).meshes(solidMat)) group.add(shadowed(m));
  const small = new THREE.Group();
  for (const m of (c.small as Tiled).meshes(solidMat)) small.add(shadowed(m, false));
  group.add(small);
  const glowMat = blinkify(new THREE.MeshBasicMaterial({ map: atlas.tex, vertexColors: true, toneMapped: false }), time);
  group.add(new THREE.Mesh(c.glow.build(), glowMat));
  const glowSmall = new THREE.Mesh(c.glowSmall.build(), glowMat);
  group.add(glowSmall);
  const tickerTex = tickerTexture();
  group.add(new THREE.Mesh(c.ticker.build(), new THREE.MeshBasicMaterial({ map: tickerTex, vertexColors: true, toneMapped: false })));
  const iceMat = new THREE.MeshStandardMaterial({ color: "#d5e6f3", roughness: 0.06, metalness: 0.25 });
  group.add(shadowed(new THREE.Mesh(c.ice.build(), iceMat), false));
  const parkTex = parkTexture(r);
  group.add(shadowed(new THREE.Mesh(park.build(), new THREE.MeshStandardMaterial({ map: parkTex, roughness: 0.95 })), false));

  const ground = new Bucket();
  const gq = (x0: number, x1: number, z0: number, z1: number, y = 0, uv?: [number, number, number, number]) => {
    const u = uv ?? [(x0 + HALF) / PERIOD, (z0 + HALF) / PERIOD, (x1 + HALF) / PERIOD, (z1 + HALF) / PERIOD];
    ground.vert(x0, y, z1, 0, 1, 0, u[0], u[3], new THREE.Color(1, 1, 1), [0, 0]);
    ground.vert(x1, y, z1, 0, 1, 0, u[2], u[3], new THREE.Color(1, 1, 1), [0, 0]);
    ground.vert(x1, y, z0, 0, 1, 0, u[2], u[1], new THREE.Color(1, 1, 1), [0, 0]);
    ground.vert(x0, y, z1, 0, 1, 0, u[0], u[3], new THREE.Color(1, 1, 1), [0, 0]);
    ground.vert(x1, y, z0, 0, 1, 0, u[2], u[1], new THREE.Color(1, 1, 1), [0, 0]);
    ground.vert(x0, y, z0, 0, 1, 0, u[0], u[1], new THREE.Color(1, 1, 1), [0, 0]);
  };
  const ZE = lineAt(BLOCKS + OUT) + 40;
  gq(lineAt(-OUT) - 40, RIVER_W, -ZE, ZE);
  gq(RIVER_E, FAR + 4 * PERIOD + 40, -ZE, ZE);
  const flat: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
  gq(-4000, RIVER_W, -4000, -ZE, -0.05, flat);
  gq(-4000, RIVER_W, ZE, 4000, -0.05, flat);
  gq(-4000, lineAt(-OUT) - 40, -ZE, ZE, -0.05, flat);
  gq(RIVER_E, 4000, -4000, -ZE, -0.05, flat);
  gq(RIVER_E, 4000, ZE, 4000, -0.05, flat);
  gq(FAR + 4 * PERIOD + 40, 4000, -ZE, ZE, -0.05, flat);
  const groundTex = groundTexture(PERIOD, STREET);
  group.add(shadowed(new THREE.Mesh(ground.build(), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.78, metalness: 0.05 })), false));

  const wn = waterNormal();
  wn.repeat.set(60, 60);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(RIVER_E - RIVER_W, 8000).rotateX(-Math.PI / 2).translate((RIVER_W + RIVER_E) / 2, -0.6, 0),
    new THREE.MeshStandardMaterial({ color: "#3a5670", emissive: "#0c1a28", roughness: 0.22, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 2.5 }),
  );
  water.receiveShadow = true;
  group.add(water);

  const trees = treeMeshes(c, TILE, TILE0);
  group.add(...trees.meshes, trees.pines);
  const treeCounts = trees.meshes.map((m) => m.count);
  const sigGroup = new THREE.Group();
  const sig = signals(c, lineAt, BLOCKS + 1, sigGroup);
  group.add(sigGroup);
  const dot = softDot();
  const st = steam(c, vents, dot);
  group.add(st.points);
  const bulbs = c.bulbs.build(time, dot);
  group.add(bulbs);

  const roads: Road[] = [];
  for (let k = 0; k <= BLOCKS; k++) {
    roads.push({ axis: 0, line: lineAt(k), min: lineAt(-OUT) + STREET / 2, max: HALF + 8 });
    roads.push({ axis: 1, line: lineAt(k), min: lineAt(-OUT) + STREET / 2, max: lineAt(BLOCKS + OUT) - STREET / 2 });
  }
  const traffic = createTraffic({ r, roads, lineAt, lines: BLOCKS + 1, max: MAX_CARS, time });
  group.add(traffic.group);

  const grid = new Map<number, Box[]>();
  const key = (cx: number, cz: number) => cx * 1000 + cz;
  for (const b of c.boxes) {
    for (let cx = Math.floor(b.minX / PERIOD); cx <= Math.floor(b.maxX / PERIOD); cx++) {
      for (let cz = Math.floor(b.minZ / PERIOD); cz <= Math.floor(b.maxZ / PERIOD); cz++) {
        const k = key(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(b);
      }
    }
  }
  const near = (x: number, z: number, radius: number) => {
    const out = new Set<Box>();
    const n = Math.ceil(radius / PERIOD);
    const gx = Math.floor(x / PERIOD);
    const gz = Math.floor(z / PERIOD);
    for (let a = gx - n; a <= gx + n; a++) for (let b = gz - n; b <= gz + n; b++) grid.get(key(a, b))?.forEach((bx) => out.add(bx));
    return [...out];
  };

  let clock = 0;
  let external = false;
  const animate = (t: number) => {
    time.value = t;
    st.time.value = t;
    tickerTex.offset.x = (t * 0.04) % 1;
    wn.offset.set((t * 0.004) % 1, (t * 0.011) % 1);
  };
  const updateTraffic = (dt: number) => {
    clock += Math.min(dt, 0.1);
    traffic.update(dt, clock);
    sig.update(clock);
    if (!external) animate(clock);
  };
  const update = (dt: number, t: number) => {
    external = true;
    animate(t);
  };
  const setTraffic = (n: number) => traffic.setCount(n);
  const setDetail = (level: 0 | 1 | 2) => {
    small.visible = level > 0;
    glowSmall.visible = level > 0;
    st.points.visible = level > 0;
    trees.meshes.forEach((m, i) => {
      m.count = level === 0 ? Math.floor(treeCounts[i] * 0.5) : treeCounts[i];
      m.castShadow = level === 2;
    });
  };

  return {
    group,
    boxes: c.boxes,
    near,
    roofSpots: c.roofSpots,
    streetSpots: c.streetSpots,
    roads,
    landmarks: c.landmarks,
    updateTraffic,
    setTraffic,
    update,
    setDetail,
  };
}

export type City = ReturnType<typeof createCity>;
