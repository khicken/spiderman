import * as THREE from "three";
import { Bucket, Bulbs, Tiled, blinkify, box } from "./city-kit";
import { crossTexture, lampTexture, noiseTexture, parkTexture, pavingTexture, roadTexture, shopTexture, signAtlas, softDot, tickerTexture, SHOP_H } from "./city-textures";
import { SNOW, genHarlem, genIndustrial, genLandmark, genPlaza, billboardWall, face, floors, mass, ticker, timesSteps, type Block, type Box, type Ctx } from "./city-build";
import { genChinatown, genFiDi, genGreenwich, genHellsKitchen, genLES, genLots, genMidtownTowers, genUpperSide, type Profile } from "./city-districts";
import { genConstruction, loadMeshes } from "./city-cranes";
import { LAMPS, blockStreet, groundGeometry, parkBlock, plazaProps, shoreEdge, signals, steam, treeMeshes, type District } from "./city-props";
import { dominoSign, pepsiSign, signMesh } from "./city-river";
import { chrysler, flatiron, grandCentral, hudsonYards, landmarkBlock, oneCourtSquare, oneWtc, reserved, unitedNations } from "./city-towers";
import { bridges } from "./city-bridges";
import { skyline } from "./city-skyline";
import { createTraffic, type Road } from "./city-cars";
import { FACADES, FACADE_SETS, STYLE, facadeMaterial } from "./city-facades";
import { createRiverMaterial } from "./render-water";
import { SKY } from "./sky-state";
import * as G from "./city-geo";

export type { Box } from "./city-build";
export type { Road } from "./city-cars";
export { LANES, PARK_LANE } from "./city-cars";

const MAX_CARS = 320;
const TILE = 400;
const TILE0 = -1600;
const TREE_TILE = 700;
const CELL = 64;
const SMALL_RANGE = [0, 380, 650];
export const WATER_Y = -0.6;

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = FACADE_SETS;
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];
const P: Record<string, Profile> = {
  fidi: { styles: [STYLE.granite, STYLE.limestone, STYLE.deco, STYLE.office, STYLE.darkglass], h: [60, 180], corner: 70, tower: 0.6, towerStyles: [...S.glassTower, ...S.deco] },
  upper: { styles: [STYLE.limestone, STYLE.tanbrick, STYLE.deco, STYLE.brick, STYLE.granite], h: [28, 62], corner: 45, tower: 0 },
  hk: { styles: [STYLE.brick, STYLE.brick, STYLE.painted, STYLE.tanbrick], h: [18, 42], corner: 36, tower: 0 },
  greenwich: { styles: [STYLE.brick, STYLE.painted, STYLE.tanbrick], h: [14, 36], corner: 34, tower: 0 },
  chinatown: { styles: [STYLE.painted, STYLE.brick, STYLE.tanbrick], h: [16, 40], corner: 36, tower: 0 },
  les: { styles: [STYLE.brick, STYLE.painted, STYLE.modern], h: [16, 44], corner: 36, tower: 0.25, towerStyles: [STYLE.modern, STYLE.glass] },
  harlem: { styles: [STYLE.brick, STYLE.limestone, STYLE.brick], h: [14, 40], corner: 36, tower: 0 },
  heights: { styles: S.brownstone, h: [12, 26], corner: 30, tower: 0 },
  warehouse: { styles: S.warehouse, h: [14, 40], corner: 30, tower: 0 },
  waterfront: { styles: S.glassTower, h: [60, 130], corner: 60, tower: 0.8 },
  astoria: { styles: [STYLE.brick, STYLE.tanbrick, STYLE.painted], h: [10, 24], corner: 28, tower: 0 },
  island: { styles: [STYLE.modern, STYLE.brick, STYLE.tanbrick], h: [20, 45], corner: 40, tower: 0 },
};

const midScale = (x: number, z: number) => 0.55 + 0.85 * Math.exp(-((Math.hypot(x - 100, z - 60) / 280) ** 2));
const midtown = (x: number, z: number): Profile => {
  const s = midScale(x, z);
  return { styles: [STYLE.office, STYLE.limestone, STYLE.ribbon, STYLE.granite, STYLE.modern, STYLE.glass, STYLE.darkglass], h: [40 * s, 150 * s], corner: 50 * s, tower: 0.6, towerStyles: [...S.glassTower, ...S.deco] };
};

const KIND: Record<string, District> = {
  Midtown: "midtown", "Financial District": "fidi", Chinatown: "chinatown", "Greenwich Village": "greenwich", "Hell's Kitchen": "hk", Chelsea: "hk",
  "Lower East Side": "les", Harlem: "harlem", "Upper West Side": "upper", "Upper East Side": "upper", "Brooklyn Heights": "greenwich", DUMBO: "industrial",
  Williamsburg: "industrial", "Long Island City": "downtown", Astoria: "hk", "Roosevelt Island": "upper", "Central Park": "park",
};

const STAND_IN: Record<string, (c: Ctx, b: Block) => void> = {
  "Empire State Building": genLandmark,
  "Chrysler Building": chrysler,
  "One World Trade Center": oneWtc,
  "One Court Square": oneCourtSquare,
  "United Nations": unitedNations,
  "Flatiron Building": flatiron,
  "Grand Central": grandCentral,
  "Hudson Yards": hudsonYards,
  "Pepsi-Cola Sign": pepsiSign,
  "Domino Park": dominoSign,
  "City Hall": (c, b) => lowMass(c, b, 22, STYLE.limestone),
};

function lowMass(c: Ctx, b: Block, h: number, style: number) {
  const top = floors(style, SHOP_H, Math.round((h - SHOP_H) / FACADES[style].ch));
  mass(c, b.x0, b.x1, b.z0, b.z1, 0, top, { style, shop: 2, vBase: SHOP_H, parapet: 0xb7a888 });
}

function timesNeighbor(c: Ctx, b: Block, tx: number, tz: number) {
  const r = c.r;
  const W = b.x1 - b.x0, D = b.z1 - b.z0;
  const split = Math.max(W, D) > 34;
  const lots: [number, number, number, number][] = !split
    ? [[b.x0, b.x1, b.z0, b.z1]]
    : W >= D
      ? [[b.x0, b.x0 + W / 2 - 0.3, b.z0, b.z1], [b.x0 + W / 2 + 0.3, b.x1, b.z0, b.z1]]
      : [[b.x0, b.x1, b.z0, b.z0 + D / 2 - 0.3], [b.x0, b.x1, b.z0 + D / 2 + 0.3, b.z1]];
  for (const [x0, x1, z0, z1] of lots) {
    const style = [STYLE.darkglass, STYLE.office, STYLE.glass][Math.floor(r() * 3)];
    const h = floors(style, SHOP_H, Math.round((50 + r() * 80) / FACADES[style].ch));
    mass(c, x0, x1, z0, z1, 0, h, { style, shop: r() < 0.5 ? 0 : 2, vBase: SHOP_H });
    for (let f = 0; f < 4; f++) {
      const F = face(f, x0, x1, z0, z1);
      const mx = F.ox + (F.dx * F.len) / 2, mz = F.oz + (F.dz * F.len) / 2;
      const toward = (F.nx * (tx - mx) + F.nz * (tz - mz)) / (Math.hypot(tx - mx, tz - mz) || 1);
      if (toward > 0.2) billboardWall(c, F, 6, Math.min(h - 3, 40), 0.95);
      else if (toward > -0.3) billboardWall(c, F, 6, Math.min(h - 3, 16), 0.3);
    }
    box(c.solid, x0 + 3, h + 0.7, z0 + 3, 2.6, 1.4, 1.8, 0x8d9096);
    box(c.solid, x0 + 3, h + 1.42, z0 + 3, 2.6, 0.05, 1.8, SNOW);
  }
}

function roadMask(b: Block) {
  let m = 0;
  for (let f = 0; f < 4; f++) {
    const F = face(f, b.x0, b.x1, b.z0, b.z1);
    for (const t of [0.25, 0.5, 0.75]) {
      const x = F.ox + F.dx * F.len * t + F.nx * (G.SIDEWALK + 3), z = F.oz + F.dz * F.len * t + F.nz * (G.SIDEWALK + 3);
      if (G.streetDist(x, z) < G.ROAD_W / 2) {
        m |= 1 << f;
        break;
      }
    }
  }
  return m;
}

function fillBlocks(c: Ctx, park: Bucket, vents: { x: number; z: number; stack: boolean }[]) {
  const r = c.r;
  const times = G.PLAZAS.filter((p) => p.name === "Times Square");
  const tx = times.reduce((a, p) => a + (p.minX + p.maxX) / 2, 0) / Math.max(1, times.length);
  const tz = times.reduce((a, p) => a + (p.minZ + p.maxZ) / 2, 0) / Math.max(1, times.length);
  const lmBlock = new Map<G.GeoBlock, G.GeoLandmark>();
  for (const lm of G.LANDMARKS) {
    const gb = landmarkBlock(lm.name) ?? G.blockAt(lm.x, lm.z);
    if (gb && (STAND_IN[lm.name] || lm.alias === "Holiday Plaza" || lm.alias === "Construction Site")) lmBlock.set(gb, lm);
  }
  const frozen = G.LANDMARKS.find((l) => l.name === "Frozen Pond")!;

  G.BLOCKS.forEach((gb, k) => {
    const b: Block = { i: k, j: 0, x0: gb.minX, x1: gb.maxX, z0: gb.minZ, z1: gb.maxZ };
    const W = b.x1 - b.x0, D = b.z1 - b.z0, m = Math.min(W, D);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const d = gb.district;
    let kind: District = KIND[d] ?? "midtown";
    const lm = lmBlock.get(gb);
    if (gb.tag === "park") {
      kind = "park";
      if (d === "Central Park")
        parkBlock(c, b, park, {
          drives: [b.x0 + 20, b.x1 - 20],
          ponds: [
            { x: frozen.x, z: frozen.z, rx: 15, rz: 13 },
            { x: cx, z: G.streetZ(91), rx: 36, rz: 58 },
            { x: cx - 18, z: G.streetZ(75), rx: 22, rz: 14 },
          ],
          ring: { x: cx + 10, z: G.streetZ(72) + 6 },
          density: 0.008,
        });
      else parkBlock(c, b, park);
    } else if (lm && STAND_IN[lm.name]) STAND_IN[lm.name](c, b);
    else if (lm?.alias === "Holiday Plaza") {
      kind = "plaza";
      genPlaza(c, b);
    } else if (lm?.alias === "Construction Site") {
      kind = "site";
      genConstruction(c, b, true);
    } else if (gb.borough === "Manhattan" && Math.hypot(cx - tx, cz - tz) < 60) {
      kind = "times";
      timesNeighbor(c, b, tx, tz);
      if (gb.tag === "times") ticker(c, b.x0, b.x1, b.z0, b.z1, 11);
    } else if (m >= 40 && (d === "Midtown" || d === "Long Island City" || d === "Williamsburg") && r() < 0.04) {
      kind = "build";
      genConstruction(c, b, false);
    } else if (!reserved(gb)) build(c, b, gb, W, D, m, cx, cz);
    blockStreet(c, b, kind, vents, roadMask(b));
  });

  return { x: tx, z0: times.length ? Math.min(...times.map((p) => p.maxZ)) - 4 : -Infinity };
}

/** Low far blocks on the Brooklyn and Queens land past the street strip. */
function backdrop(c: Ctx) {
  const r = c.r;
  const step = 62, size = 44;
  for (let x = 300; x < 1340; x += step) {
    for (let z = -1150; z < 1560; z += step) {
      const cx = x + size / 2, cz = z + size / 2;
      const b = G.boroughAt(cx, cz);
      if ((b !== "Brooklyn" && b !== "Queens") || G.shoreDist(cx, cz) < 40 || G.streetDist(cx, cz) < 40) continue;
      if ([[x, z], [x + size, z], [x, z + size], [x + size, z + size]].some(([px, pz]) => !G.onLand(px, pz) || G.blockAt(px, pz))) continue;
      const style = pick(r, [...S.warehouse, ...S.brownstone]);
      const top = floors(style, 0, 3 + Math.floor(r() * 7));
      mass(c, x, x + size, z, z + size, 0, top, { style, parapet: null, detail: false, spot: false });
    }
  }
}

function build(c: Ctx, b: Block, gb: G.GeoBlock, W: number, D: number, m: number, cx: number, cz: number) {
  const r = c.r;
  const CP = G.CENTRAL_PARK;
  const d = gb.district;
  const big = m >= 36;
  if (d === "Midtown") return m >= 30 ? genMidtownTowers(c, b, midScale(cx, cz)) : genLots(c, b, midtown(cx, cz));
  if (d === "Financial District") return m >= 30 ? genFiDi(c, b, false) : genLots(c, b, P.fidi);
  if (d === "Upper West Side" || d === "Upper East Side") {
    const inPark = b.z1 > CP.minZ && b.z0 < CP.maxZ;
    const face = inPark && Math.abs(b.x1 - (CP.minX - 15)) < 3 ? 1 : inPark && Math.abs(b.x0 - (CP.maxX + 15)) < 3 ? 3 : -1;
    return big && W >= 40 ? genUpperSide(c, b, face) : genLots(c, b, P.upper);
  }
  if (d === "Hell's Kitchen" || d === "Chelsea") {
    if (cx < -170 && m >= 20) return genIndustrial(c, b, S.warehouse, 6, 11);
    return big ? genHellsKitchen(c, b) : genLots(c, b, P.hk);
  }
  if (d === "Greenwich Village") return m >= 32 && r() < 0.7 ? genGreenwich(c, b) : genLots(c, b, P.greenwich);
  if (d === "Chinatown") return m >= 33 ? genChinatown(c, b) : genLots(c, b, P.chinatown);
  if (d === "Lower East Side") return big ? genLES(c, b) : genLots(c, b, P.les);
  if (d === "Harlem") return W >= 40 && D >= 36 && r() < 0.7 ? genHarlem(c, b) : genLots(c, b, P.harlem);
  if (d === "Brooklyn Heights") return m >= 32 && r() < 0.75 ? genGreenwich(c, b) : genLots(c, b, P.heights);
  if (d === "DUMBO" || d === "Williamsburg") {
    if (d === "Williamsburg" && G.shoreDist(cx, cz) < 90 && r() < 0.4) return genLots(c, b, P.waterfront);
    return m >= 18 && r() < 0.7 ? genIndustrial(c, b, S.warehouse, 3, 9) : genLots(c, b, P.warehouse);
  }
  if (d === "Long Island City") return G.shoreDist(cx, cz) < 160 ? genLots(c, b, P.waterfront) : genIndustrial(c, b, S.warehouse, 2, 7);
  if (d === "Astoria") return genLots(c, b, P.astoria);
  if (d === "Roosevelt Island") return genLots(c, b, P.island);
  return genLots(c, b, midtown(cx, cz));
}

const HASH = /* glsl */ `
float cgHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const GROUND_FRAG = /* glsl */ `
#include <map_fragment>
vec2 gw = vGW.xz;
vec4 gA = texture2D(uNoise, gw * (1.0 / 53.0));
vec4 gB = texture2D(uNoise, mat2(0.8, -0.6, 0.6, 0.8) * gw * (1.0 / 17.0) + 0.31);
float gNight = smoothstep(0.3, 1.0, uNight);
float gSnow = 0.0;
float gWet = 0.0;
#if GK == 0
  diffuseColor.rgb *= (0.93 + 0.12 * cgHash(floor(gw / 1.5))) * mix(0.84, 1.06, gA.b);
  gSnow = smoothstep(0.55, 0.6, gA.g * 0.6 + gB.g * 0.4 + 0.1 * (gB.r - 0.5));
  gWet = (1.0 - gSnow) * smoothstep(0.5, 0.65, gA.a) * 0.5;
#else
  diffuseColor.rgb *= mix(0.84, 1.1, gA.b) * (0.96 + 0.08 * gB.g);
  vec2 pc = floor(gw / vec2(4.3, 3.7));
  vec2 pf = fract(gw / vec2(4.3, 3.7));
  float ph = cgHash(pc + 7.7);
  vec2 pe = min(pf, 1.0 - pf) * vec2(4.3, 3.7);
  float pin = step(0.9, ph) * step(0.35 * cgHash(pc + 1.3), min(pe.x, pe.y));
  diffuseColor.rgb *= 1.0 - 0.2 * pin;
  gWet = smoothstep(0.45, 0.66, gB.b);
#endif
#if GK == 1
  float gAcross = min(vMapUv.x, 1.0 - vMapUv.x) * 22.0;
  float gAlong = vMapUv.y * 22.0;
  vec4 gC = texture2D(uNoise, vec2(gAlong * (1.0 / 13.0), vMapUv.x > 0.5 ? 0.27 : 0.71));
  float gBank = 0.45 + 1.1 * gC.g + 0.45 * (gC.r - 0.5);
  gSnow = 1.0 - smoothstep(gBank - 0.05, gBank + 0.05, gAcross);
  float gSlush = (1.0 - smoothstep(gBank, gBank + 0.5 + 0.9 * gC.a, gAcross)) * (1.0 - gSnow);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.058, 0.055), gSlush * 0.55);
  gWet = max(gWet, gSlush);
#endif
gWet *= 0.35 + 0.65 * gNight;
diffuseColor.rgb *= 1.0 - 0.3 * gWet;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.9) * (0.94 + 0.08 * gB.r), gSnow);
`;

/** World-space stains, snow, wet patches and lamp pools for land (0), roads (1) and crossings (2). */
function groundPatch(m: THREE.MeshStandardMaterial, kind: 0 | 1 | 2, noise: THREE.Texture, lamp: { tex: THREE.Texture; rect: THREE.Vector4 }) {
  m.defines = { GK: kind };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uNoise: { value: noise }, uLamp: { value: lamp.tex }, uLampR: { value: lamp.rect }, uNight: SKY.night });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uNoise; uniform sampler2D uLamp; uniform vec4 uLampR; uniform float uNight; varying vec3 vGW;" + HASH)
      .replace("#include <map_fragment>", GROUND_FRAG)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.14, gWet * 0.85), 0.62, gSnow);")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  float gL = texture2D(uLamp, (gw - uLampR.xy) * uLampR.zw).r;
  totalEmissiveRadiance += vec3(1.0, 0.68, 0.38) * gL * gNight * (diffuseColor.rgb * 1.5 + 0.06 + 0.3 * gWet * gL);
}`,
      );
  };
  m.customProgramCacheKey = () => "ground" + kind;
  return m;
}

const SOLID_VERT = /* glsl */ `
{
  vec4 sp = vec4(transformed, 1.0);
  vec3 sn = objectNormal;
  #ifdef USE_INSTANCING
    sp = instanceMatrix * sp;
    sn = mat3(instanceMatrix) * sn;
  #endif
  vSW = (modelMatrix * sp).xyz;
  vSN = normalize(mat3(modelMatrix) * sn);
}
`;

const SOLID_FRAG = /* glsl */ `
#include <color_fragment>
vec3 sAn = abs(vSN);
vec2 sUv = sAn.y > 0.7 ? vSW.xz : vec2(sAn.x > sAn.z ? vSW.z : vSW.x, vSW.y);
vec4 sG = texture2D(uNoise, sUv * (1.0 / 2.3));
vec4 sM = texture2D(uNoise, sUv * (1.0 / 29.0) + 0.43);
float sNight = smoothstep(0.3, 1.0, uNight);
float sSnow = smoothstep(0.6, 0.72, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * smoothstep(0.55, 0.85, vSN.y);
diffuseColor.rgb *= 1.0 + (sG.r - 0.5) * mix(0.32, 0.07, sSnow);
diffuseColor.rgb *= mix(mix(0.84, 1.08, sM.b) * (1.0 - 0.12 * smoothstep(0.55, 0.8, sM.a) * (1.0 - sAn.y)), 0.88 + 0.16 * sM.g, sSnow);
float sH = sG.r;
`;

/** Triplanar grain, stains and bump on flat vertex-color meshes, with snow glints on bright tops. */
function solidPatch(m: THREE.MeshStandardMaterial, noise: THREE.Texture, key: string) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uNoise: { value: noise }, uNight: SKY.night });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSW; varying vec3 vSN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n" + SOLID_VERT);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uNoise; uniform float uNight; varying vec3 vSW; varying vec3 vSN;" + HASH)
      .replace("#include <color_fragment>", SOLID_FRAG)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= 0.88 + 0.24 * sG.g;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(sH), dFdy(sH)) * mix(0.9, 0.6, sSnow);
  vec3 sx = normalize(dFdx(-vViewPosition));
  vec3 sy = normalize(dFdy(-vViewPosition));
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
  if (sSnow > 0.01) {
    float hx = texture2D(uNoise, (sUv + vec2(0.6, 0.0)) * (1.0 / 29.0) + 0.43).g - sM.g;
    float hz = texture2D(uNoise, (sUv + vec2(0.0, 0.6)) * (1.0 / 29.0) + 0.43).g - sM.g;
    vec3 wn = normalize(vec3(-hx * 4.0, 1.0, -hz * 4.0));
    normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), sSnow));
  }
}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec3 sV = normalize(cameraPosition - vSW);
  vec2 sc = sUv * 11.0;
  float sp = cgHash(floor(sc) + floor(sV.xz * 7.0 + sV.y * 3.0) * 13.1) * step(length(fract(sc) - 0.5), 0.16);
  float sFade = 1.0 - smoothstep(0.2, 0.7, length(fwidth(sc)));
  totalEmissiveRadiance += step(0.985, sp) * sSnow * sFade * mix(vec3(1.4), vec3(0.3, 0.36, 0.5), sNight);
}`,
      );
  };
  m.customProgramCacheKey = () => key;
  return m;
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
    anchors: [],
    loads: [],
  };
  const park = new Bucket();
  LAMPS.length = 0;
  const vents: { x: number; z: number; stack: boolean }[] = [];

  const times = fillBlocks(c, park, vents);
  const tx = times.x;
  backdrop(c);
  for (const p of G.PLAZAS) plazaProps(c, p);
  if (times.z0 > -Infinity) timesSteps(c, tx, times.z0);
  bridges(c);
  shoreEdge(c, G.LAND, (x, z) => x > G.BOUNDS.maxX + 300 || z > G.BOUNDS.maxZ + 200);

  const noise = noiseTexture();
  const shopT = shopTexture(r);
  const shadowed = (m: THREE.Mesh, cast = true) => {
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  };
  for (let i = 0; i < FACADES.length; i++) if (c.facade[i].tris) group.add(shadowed(new THREE.Mesh(c.facade[i].build(), facadeMaterial(FACADES[i], r, noise))));
  group.add(shadowed(new THREE.Mesh(c.shop.build(), new THREE.MeshStandardMaterial({ map: shopT.map, emissiveMap: shopT.emissive, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.5, vertexColors: true }))));
  const solidMat = solidPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }), noise, "solid");
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
  group.add(shadowed(new THREE.Mesh(park.build(), solidPatch(new THREE.MeshStandardMaterial({ map: parkTex, roughness: 0.95 }), noise, "park")), false));
  group.add(signMesh(), skyline());

  const gg = groundGeometry(G.LAND, G.ROADS, G.PLAZAS, G.ROAD_W);
  const lamps = lampTexture(LAMPS);
  const landMesh = shadowed(new THREE.Mesh(gg.land, groundPatch(new THREE.MeshStandardMaterial({ map: pavingTexture(), vertexColors: true, roughness: 0.8, metalness: 0.02 }), 0, noise, lamps)), false);
  const eye = new THREE.Vector3(0, 0, 0);
  landMesh.onBeforeRender = (_r, _s, cam) => {
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) eye.copy(cam.position);
  };
  group.add(landMesh);
  group.add(shadowed(new THREE.Mesh(gg.roads, groundPatch(new THREE.MeshStandardMaterial({ map: roadTexture(G.ROAD_W), roughness: 0.72, metalness: 0.05 }), 1, noise, lamps)), false));
  group.add(shadowed(new THREE.Mesh(gg.cross, groundPatch(new THREE.MeshStandardMaterial({ map: crossTexture(G.ROAD_W), roughness: 0.72, metalness: 0.05 }), 2, noise, lamps)), false));

  const B = G.BOUNDS;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2).translate((B.minX + B.maxX) / 2, WATER_Y, (B.minZ + B.maxZ) / 2),
    createRiverMaterial({ y: WATER_Y }),
  );
  water.receiveShadow = true;
  group.add(water);

  const loads = c.loads;
  const [cables, hooks] = loadMeshes(loads.length, solidMat);
  cables.count = hooks.count = loads.length;
  hooks.castShadow = true;
  group.add(cables, hooks);
  const swayQ = new THREE.Quaternion(), swayE = new THREE.Euler(), swayP = new THREE.Vector3(), swayS = new THREE.Vector3(), swayM = new THREE.Matrix4();
  const sway = (t: number) => {
    for (let i = 0; i < loads.length; i++) {
      const L = loads[i];
      const w = Math.sqrt(9.8 / L.len);
      swayE.set(0.035 * Math.sin(t * w + i * 1.7), L.ry + 0.25 * Math.sin(t * 0.13 + i), 0.03 * Math.sin(t * w * 1.07 + i * 2.9), "YXZ");
      swayQ.setFromEuler(swayE);
      swayP.set(L.x, L.y, L.z);
      cables.setMatrixAt(i, swayM.compose(swayP, swayQ, swayS.set(1, L.len, 1)));
      swayP.set(0, -L.len, 0).applyQuaternion(swayQ).add(swayS.set(L.x, L.y, L.z));
      hooks.setMatrixAt(i, swayM.compose(swayP, swayQ, swayS.set(1, 1, 1)));
    }
    cables.instanceMatrix.needsUpdate = true;
    hooks.instanceMatrix.needsUpdate = true;
  };
  sway(0);
  cables.computeBoundingSphere();
  hooks.computeBoundingSphere();
  const districts = G.districtRects().filter((d) => Number.isFinite(d.minX));

  const trees = treeMeshes(c, TREE_TILE, TILE0);
  group.add(...trees.meshes, trees.pines);
  const treeCounts = trees.meshes.map((m) => m.count);
  const sigGroup = new THREE.Group();
  const sig = signals(c, gg.crossings, sigGroup);
  group.add(sigGroup);
  const dot = softDot();
  const st = steam(c, vents, dot);
  group.add(st.points);
  const bulbs = c.bulbs.build(time, dot);
  group.add(bulbs);

  const roads: (Road & { name: string })[] = G.ROADS.map((rd) => ({ ...rd }));
  const traffic = createTraffic({ r, max: MAX_CARS, time });
  group.add(traffic.group);

  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 4096 + cz;
  const allBoxes = c.boxes;
  allBoxes.forEach((b, i) => {
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++) {
      for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
        const k = key(cx, cz);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(i);
      }
    }
  });
  const stamps = new Uint32Array(allBoxes.length);
  let stamp = 0;
  // Pass `out` to reuse an array in hot loops. It is cleared and returned.
  const near = (x: number, z: number, radius: number, out: Box[] = []) => {
    out.length = 0;
    if (++stamp === 0xffffffff) {
      stamps.fill(0);
      stamp = 1;
    }
    const n = Math.ceil(radius / CELL);
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = gx - n; a <= gx + n; a++) {
      for (let b = gz - n; b <= gz + n; b++) {
        const l = grid.get(key(a, b));
        if (!l) continue;
        for (let j = 0; j < l.length; j++) {
          const i = l[j];
          if (stamps[i] === stamp) continue;
          stamps[i] = stamp;
          out.push(allBoxes[i]);
        }
      }
    }
    return out;
  };

  const roofSpots = c.roofSpots.filter((s) => !near(s.x, s.z, 1).some((b) => s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.maxZ && b.maxY > s.y + 0.5));
  const topAt = (x: number, z: number, rad: number) => near(x, z, rad).reduce((y, b) => (x > b.minX - rad && x < b.maxX + rad && z > b.minZ - rad && z < b.maxZ + rad ? Math.max(y, b.maxY) : y), 0);
  const builtLm = c.landmarks;
  const landmarks = G.LANDMARKS.map((l) => {
    const built = builtLm.find((m) => m.name === l.name || m.name === l.alias);
    const y = l.kind === "tower" || l.kind === "building" ? topAt(l.x, l.z, 2) : 0;
    return { name: l.name, alias: l.alias, pos: built?.pos.clone() ?? new THREE.Vector3(l.x, y, l.z) };
  });
  const spawn = roofSpots.reduce((a, b) => (b.y > 25 && b.y < 70 && Math.hypot(b.x - G.SPAWN.x, b.z - G.SPAWN.z) < Math.hypot(a.x - G.SPAWN.x, a.z - G.SPAWN.z) ? b : a));

  let clock = 0;
  let external = false;
  let detail: 0 | 1 | 2 = 1;
  const animate = (t: number) => {
    time.value = t;
    st.time.value = t;
    tickerTex.offset.x = (t * 0.04) % 1;
    sway(t);
    const range = SMALL_RANGE[detail];
    for (const m of small.children as THREE.Mesh[]) {
      const sp = m.geometry.boundingSphere!;
      m.visible = Math.hypot(sp.center.x - eye.x, sp.center.z - eye.z) < range + sp.radius;
    }
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
    detail = level;
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
    roofSpots,
    streetSpots: c.streetSpots,
    roads,
    landmarks,
    anchors: c.anchors,
    districts,
    districtAt: G.districtAt,
    blocks: G.BLOCKS,
    plazas: G.PLAZAS,
    spawn,
    waterY: WATER_Y,
    bounds: { ...G.BOUNDS },
    updateTraffic,
    setTraffic,
    carsNear: traffic.near,
    setCarObstacle: traffic.setObstacle,
    update,
    setDetail,
  };
}

export type City = ReturnType<typeof createCity>;
