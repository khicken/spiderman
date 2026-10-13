import * as THREE from "three";
import type { GameCtx } from "../contracts";
import { OPAQUE } from "../blocks/registry";
import { brightnessCurve, lightAt, skyDarken } from "./ai";

const MAX_QUADS = 2048;

const VERT = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

// Round soft disc like the vanilla misc/shadow texture.
function shadowTexture(): THREE.DataTexture {
  const n = 32;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = r >= 1 ? 0 : r < 0.7 ? 1 : 1 - (r - 0.7) / 0.3;
      d[(y * n + x) * 4 + 3] = Math.round(a * 255);
    }
  const t = new THREE.DataTexture(d, n, n);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// Vanilla EntityRenderDispatcher.renderShadow: a disc on the top face of each full block under the entity,
// fading over 16 blocks from the camera and over 2 blocks of height.
export function createShadows() {
  const pos = new Float32Array(MAX_QUADS * 4 * 3);
  const uv = new Float32Array(MAX_QUADS * 4 * 2);
  const alpha = new Float32Array(MAX_QUADS * 4);
  const index = new Uint16Array(MAX_QUADS * 6);
  for (let q = 0; q < MAX_QUADS; q++) {
    const v = q * 4, i = q * 6;
    index[i] = v; index[i + 1] = v + 1; index[i + 2] = v + 2;
    index[i + 3] = v; index[i + 4] = v + 2; index[i + 5] = v + 3;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
  const alphaAttr = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("uv", uvAttr);
  geo.setAttribute("aAlpha", alphaAttr);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const map = shadowTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = "entity-shadows";
  let n = 0;
  let darken = 0;
  let scene: THREE.Scene | null = null;

  function quad(x0: number, z0: number, x1: number, z1: number, y: number, cx: number, cz: number, r: number, a: number) {
    if (n >= MAX_QUADS) return;
    const p = n * 12, t = n * 8, k = n * 4;
    const s = 1 / (2 * r);
    pos[p] = x0; pos[p + 1] = y; pos[p + 2] = z0;
    pos[p + 3] = x0; pos[p + 4] = y; pos[p + 5] = z1;
    pos[p + 6] = x1; pos[p + 7] = y; pos[p + 8] = z1;
    pos[p + 9] = x1; pos[p + 10] = y; pos[p + 11] = z0;
    uv[t] = (x0 - cx) * s + 0.5; uv[t + 1] = (z0 - cz) * s + 0.5;
    uv[t + 2] = (x0 - cx) * s + 0.5; uv[t + 3] = (z1 - cz) * s + 0.5;
    uv[t + 4] = (x1 - cx) * s + 0.5; uv[t + 5] = (z1 - cz) * s + 0.5;
    uv[t + 6] = (x1 - cx) * s + 0.5; uv[t + 7] = (z0 - cz) * s + 0.5;
    alpha[k] = alpha[k + 1] = alpha[k + 2] = alpha[k + 3] = a;
    n++;
  }

  return {
    begin(ctx: GameCtx) {
      const sc = ctx.renderer?.scene ?? null;
      if (sc !== scene) {
        scene?.remove(mesh);
        scene = sc;
        scene?.add(mesh);
      }
      n = 0;
      darken = skyDarken(ctx);
    },
    // radius in blocks, strength 1 for mobs and 0.75 for items, camDistSq from the camera.
    add(ctx: GameCtx, x: number, y: number, z: number, radius: number, strength: number, camDistSq: number) {
      const f = (1 - camDistSq / 256) * strength;
      if (f <= 0 || radius <= 0) return;
      const w = ctx.world;
      const g = Math.min(f / 0.5, radius);
      const x0 = Math.floor(x - radius), x1 = Math.floor(x + radius);
      const z0 = Math.floor(z - radius), z1 = Math.floor(z + radius);
      const y0 = Math.floor(y - g), y1 = Math.floor(y);
      for (let by = y0; by <= y1; by++)
        for (let bz = z0; bz <= z1; bz++)
          for (let bx = x0; bx <= x1; bx++) {
            if (!OPAQUE[w.getBlock(bx, by - 1, bz) & 0xfff] || OPAQUE[w.getBlock(bx, by, bz) & 0xfff]) continue;
            const raw = lightAt(ctx, bx, by, bz, darken);
            if (raw <= 3) continue;
            let a = (f - (y - by) / 2) * 0.5 * brightnessCurve(raw);
            if (a <= 0) continue;
            if (a > 1) a = 1;
            quad(Math.max(bx, x - radius), Math.max(bz, z - radius), Math.min(bx + 1, x + radius), Math.min(bz + 1, z + radius), by + 0.001, x, z, radius, a);
          }
    },
    end() {
      geo.setDrawRange(0, n * 6);
      if (!n) return;
      posAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, n * 12);
      posAttr.needsUpdate = true;
      uvAttr.clearUpdateRanges();
      uvAttr.addUpdateRange(0, n * 8);
      uvAttr.needsUpdate = true;
      alphaAttr.clearUpdateRanges();
      alphaAttr.addUpdateRange(0, n * 4);
      alphaAttr.needsUpdate = true;
    },
    dispose() {
      scene?.remove(mesh);
      scene = null;
      geo.dispose();
      mat.dispose();
      map.dispose();
    },
  };
}

// Vanilla shadowRadius per renderer, scaled from the hitbox for mobs without an entry.
const RADIUS: Record<string, number> = {
  item: 0.15, xp_orb: 0.15, tnt: 0.5, falling_block: 0.5, zombie: 0.5, husk: 0.5, drowned: 0.5, skeleton: 0.5, stray: 0.5,
  creeper: 0.5, spider: 1, cave_spider: 0.7, pig: 0.7, cow: 0.7, mooshroom: 0.7, sheep: 0.7, chicken: 0.3, villager: 0.5,
  iron_golem: 1, wolf: 0.5, horse: 0.75, enderman: 0.5, witch: 0.5, rabbit: 0.3, cat: 0.4, ocelot: 0.4, fox: 0.4, bee: 0.4,
  polar_bear: 0.9, llama: 0.7, goat: 0.7, frog: 0.3, axolotl: 0.5, turtle: 0.7, panda: 0.9, ravager: 1.1, warden: 0.9,
};
const NONE = new Set(["arrow", "spectral_arrow", "trident", "snowball", "egg", "ender_pearl", "potion", "experience_bottle",
  "fireball", "small_fireball", "wind_charge", "breeze_wind_charge", "lightning_bolt", "squid", "glow_squid", "end_crystal",
  "painting", "item_frame", "glow_item_frame", "armor_stand_marker", "area_effect_cloud", "fishing_bobber", "ghast", "phantom"]);

export function shadowRadius(type: string, width: number): number {
  if (NONE.has(type)) return 0;
  return RADIUS[type] ?? Math.min(1.5, width * 0.75);
}
