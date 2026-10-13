import * as THREE from "three";
import { idOf } from "../contracts";
import type { BlockDef, BlockState, GameEvent, WorldApi } from "../contracts";
import { blockDef, IS_FLUID, OPAQUE, SOLID } from "../blocks/registry";

const NX = [1, -1, 0, 0, 0, 0], NY = [0, 0, 1, -1, 0, 0], NZ = [0, 0, 0, 0, 1, -1];
import { textureLayer } from "../textures";
import { PARTICLE_PATHS, paintParticleSheet, SPRITE, SPRITE_LAYERS } from "./particle-art";
import { tileOr } from "./pack-art";
import { lightmap } from "../mesh/lightmap";

const LM: [number, number, number] = [1, 1, 1];

type ParticleEvent = Extract<GameEvent, { type: "particles" }>;

const enum Beh { Normal, Portal, Bubble, Drip, Fall }
const enum Anim { Fixed, Fwd, Rev }
const COLLIDE = 1, BRIGHT = 2, GROUND = 4, SHRINK = 8;
const TICK = 1 / 20;
const FIELDS = [
  "x", "y", "z", "px", "py", "pz", "vx", "vy", "vz", "ox", "oy", "oz", "age", "life", "size", "grav", "drag",
  "r", "g", "b", "a", "u0", "v0", "du", "layer", "src", "frames", "anim", "beh", "flags", "light",
] as const;
type Field = (typeof FIELDS)[number];
type Pool = Record<Field, Float32Array>;

const VERT = /* glsl */ `
attribute vec4 aPos;
attribute vec4 aColor;
attribute vec4 aUv;
attribute vec2 aTex;
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vTex;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = aPos.xyz + (right * position.x + up * position.y) * aPos.w;
  vUv = aUv.xy + vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5) * aUv.zw;
  vColor = aColor;
  vTex = aTex;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2DArray uSheet;
uniform sampler2DArray uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vTex;
void main() {
  vec4 t = vTex.y < 0.5 ? texture(uSheet, vec3(vUv, vTex.x)) : texture(uAtlas, vec3(vUv, vTex.x));
  float a = t.a * vColor.a;
  if (a < 0.1) discard;
  gl_FragColor = vec4(t.rgb * sRGBTransferEOTF(vec4(vColor.rgb, 1.0)).rgb, a);
  #include <colorspace_fragment>
}`;

const TINTS: Record<string, number> = { birch: 0x80a755, spruce: 0x619961, stem: 0x9fbf3e, redstone: 0xc81010 };

function particleTexture(def: BlockDef) {
  if (def.name === "grass_block") return "dirt";
  if (def.name === "water") return "water_still";
  if (def.name === "lava") return "lava_still";
  const t = def.textures;
  return t.side ?? t.all ?? t.top ?? t.end ?? t.front ?? t.north ?? def.name;
}

function touch(a: THREE.BufferAttribute, n: number) {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n);
  a.needsUpdate = true;
}

export function createParticles(scene: THREE.Scene, world: WorldApi, atlas: () => THREE.DataArrayTexture | null) {
  const makeSheet = () => {
    const data = paintParticleSheet();
    for (const [layer, path] of PARTICLE_PATHS) {
      const art = tileOr(path, 16, 16);
      if (art) data.set(art.data, layer * 1024);
    }
    const t = new THREE.DataArrayTexture(data, 16, 16, SPRITE_LAYERS);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  let sheet = makeSheet();

  const mat = new THREE.ShaderMaterial({
    uniforms: { uSheet: { value: sheet }, uAtlas: { value: null } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
  });
  const base = new THREE.PlaneGeometry(2, 2);
  let cap = 0;
  let p: Pool = {} as Pool;
  let geo = new THREE.InstancedBufferGeometry();
  let aPos!: THREE.InstancedBufferAttribute, aColor!: THREE.InstancedBufferAttribute;
  let aUv!: THREE.InstancedBufferAttribute, aTex!: THREE.InstancedBufferAttribute;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);

  let count = 0;
  let acc = 0;
  let tickNo = 0;
  const rand = Math.random;

  function setBudget(n: number) {
    if (n === cap) return;
    cap = n;
    count = 0;
    p = {} as Pool;
    for (const f of FIELDS) p[f] = new Float32Array(n);
    geo.dispose();
    geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    aColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    aUv = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    aTex = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPos", aPos);
    geo.setAttribute("aColor", aColor);
    geo.setAttribute("aUv", aUv);
    geo.setAttribute("aTex", aTex);
    geo.instanceCount = 0;
    mesh.geometry = geo;
  }

  const solidAt = (x: number, y: number, z: number) => SOLID[idOf(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))] === 1;

  function brightness(x: number, y: number, z: number) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    let sky = world.getSkyLight(bx, by, bz), blk = world.getBlockLight(bx, by, bz);
    if (sky === 0 && blk === 0 && OPAQUE[idOf(world.getBlock(bx, by, bz))]) {
      for (let k = 0; k < 6; k++) {
        const nx = bx + NX[k], ny = by + NY[k], nz = bz + NZ[k];
        sky = Math.max(sky, world.getSkyLight(nx, ny, nz));
        blk = Math.max(blk, world.getBlockLight(nx, ny, nz));
      }
    }
    lightmap(sky, blk, LM);
    return (LM[0] + LM[1] + LM[2]) / 3;
  }

  function add(x: number, y: number, z: number, vx: number, vy: number, vz: number, spread: boolean): number {
    if (count >= cap) return -1;
    const i = count++;
    p.x[i] = p.px[i] = p.ox[i] = x;
    p.y[i] = p.py[i] = p.oy[i] = y;
    p.z[i] = p.pz[i] = p.oz[i] = z;
    if (spread) {
      let ax = vx + (rand() * 2 - 1) * 0.4, ay = vy + (rand() * 2 - 1) * 0.4, az = vz + (rand() * 2 - 1) * 0.4;
      const d = (rand() + rand() + 1) * 0.15;
      const e = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      ax = (ax / e) * d * 0.4; ay = (ay / e) * d * 0.4 + 0.1; az = (az / e) * d * 0.4;
      vx = ax; vy = ay; vz = az;
    }
    p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz;
    p.age[i] = 0;
    p.life[i] = Math.floor(4 / (rand() * 0.9 + 0.1));
    p.size[i] = 0.1 * (rand() * 0.5 + 0.5) * 2;
    p.grav[i] = 0;
    p.drag[i] = 0.98;
    p.r[i] = p.g[i] = p.b[i] = p.a[i] = 1;
    p.u0[i] = 0; p.v0[i] = 0; p.du[i] = 1;
    p.layer[i] = SPRITE.generic + Math.floor(rand() * 8);
    p.src[i] = 0;
    p.frames[i] = 1;
    p.anim[i] = Anim.Fixed;
    p.beh[i] = Beh.Normal;
    p.flags[i] = COLLIDE;
    p.light[i] = brightness(x, y, z);
    return i;
  }

  function color(i: number, hex: number, k = 1) {
    p.r[i] = (((hex >> 16) & 255) / 255) * k;
    p.g[i] = (((hex >> 8) & 255) / 255) * k;
    p.b[i] = ((hex & 255) / 255) * k;
  }

  function sprite(i: number, layer: number, frames: number, anim: Anim) {
    p.layer[i] = layer; p.frames[i] = frames; p.anim[i] = anim;
  }

  function blockParticles(e: ParticleEvent) {
    const state: BlockState = e.state ?? 0;
    if (!idOf(state)) return;
    const def = blockDef(state);
    const layer = textureLayer(particleTexture(def));
    let tint = 0xffffff;
    if (def.tint && def.name !== "grass_block") {
      const biome = world.getBiome(Math.floor(e.x), Math.floor(e.z));
      tint = def.tint === "grass" ? biome.grassColor : def.tint === "foliage" ? biome.foliageColor : def.tint === "water" ? biome.waterColor : TINTS[def.tint] ?? 0xffffff;
    }
    const dust = (x: number, y: number, z: number, vx: number, vy: number, vz: number) => {
      const i = add(x, y, z, vx, vy, vz, true);
      if (i < 0) return -1;
      p.grav[i] = 1;
      color(i, tint, 0.6);
      p.size[i] /= 2;
      p.layer[i] = layer;
      p.src[i] = 1;
      p.du[i] = 0.25;
      p.u0[i] = Math.floor(rand() * 3 * 4) / 16;
      p.v0[i] = Math.floor(rand() * 3 * 4) / 16;
      return i;
    };
    if (e.count === undefined) {
      const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
          for (let k = 0; k < 4; k++) {
            const h = (i + 0.5) / 4, v = (j + 0.5) / 4, w = (k + 0.5) / 4;
            dust(bx + h, by + v, bz + w, h - 0.5, v - 0.5, w - 0.5);
          }
      return;
    }
    for (let n = 0; n < e.count; n++) {
      const i = dust(e.x + (rand() - 0.5) * 0.2, e.y + (rand() - 0.5) * 0.2, e.z + (rand() - 0.5) * 0.2, 0, 0, 0);
      if (i < 0) return;
      p.vx[i] *= 0.2; p.vy[i] *= 0.2; p.vz[i] *= 0.2;
      p.size[i] *= 0.6;
    }
  }

  const jit = (n: number, s: number) => (n > 1 ? (rand() - 0.5) * s : 0);

  function addParticles(e: ParticleEvent) {
    if (!cap) return;
    const n = Math.max(1, e.count ?? 1);
    switch (e.kind) {
      case "block": blockParticles(e); return;
      case "smoke":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 0.3), e.y + jit(n, 0.3), e.z + jit(n, 0.3), 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] = p.vx[i] * 0.1; p.vy[i] = p.vy[i] * 0.1; p.vz[i] = p.vz[i] * 0.1;
          const c = rand() * 0.3;
          p.r[i] = p.g[i] = p.b[i] = c;
          p.size[i] *= 0.75;
          p.life[i] = Math.max(1, Math.floor(8 / (rand() * 0.8 + 0.2)));
          p.grav[i] = -0.1;
          p.drag[i] = 0.96;
          p.flags[i] = 0;
          sprite(i, SPRITE.generic, 8, Anim.Rev);
        }
        return;
      case "flame":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + (rand() - rand()) * 0.05 + jit(n, 0.3), e.y + (rand() - rand()) * 0.05, e.z + (rand() - rand()) * 0.05 + jit(n, 0.3), 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] *= 0.01; p.vy[i] *= 0.01; p.vz[i] *= 0.01;
          p.life[i] = Math.floor(8 / (rand() * 0.8 + 0.2)) + 4;
          p.drag[i] = 0.96;
          p.flags[i] = BRIGHT | SHRINK;
          sprite(i, SPRITE.flame, 1, Anim.Fixed);
        }
        return;
      case "explosion": {
        const big = e.count === undefined ? 16 : n;
        for (let k = 0; k < big; k++) {
          const spread = big > 1 ? 4 : 0;
          const i = add(e.x + (rand() - rand()) * spread, e.y + (rand() - rand()) * spread, e.z + (rand() - rand()) * spread, 0, 0, 0, false);
          if (i < 0) return;
          p.age[i] = -Math.floor(k / 6);
          p.life[i] = 6 + Math.floor(rand() * 4);
          const g = rand() * 0.6 + 0.4;
          p.r[i] = p.g[i] = p.b[i] = g;
          p.size[i] = 2 * (1 - (k / Math.max(1, big)) * 0.5);
          p.flags[i] = BRIGHT;
          sprite(i, SPRITE.explosion, 16, Anim.Fwd);
        }
        return;
      }
      case "splash":
        for (let k = 0; k < n; k++) rainSplash(e.x + jit(n, 0.6), e.y, e.z + jit(n, 0.6), true);
        return;
      case "bubble":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 0.6), e.y + jit(n, 0.6), e.z + jit(n, 0.6), 0, 0, 0, false);
          if (i < 0) return;
          p.size[i] *= rand() * 0.6 + 0.2;
          p.vx[i] = (rand() * 2 - 1) * 0.02; p.vy[i] = (rand() * 2 - 1) * 0.02; p.vz[i] = (rand() * 2 - 1) * 0.02;
          p.life[i] = Math.floor(8 / (rand() * 0.8 + 0.2));
          p.drag[i] = 0.85;
          p.beh[i] = Beh.Bubble;
          sprite(i, SPRITE.bubble, 1, Anim.Fixed);
        }
        return;
      case "heart":
      case "angry":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 1), e.y + (e.kind === "angry" ? 0.5 : 0) + jit(n, 0.5), e.z + jit(n, 1), 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] *= 0.01; p.vy[i] = p.vy[i] * 0.01 + 0.1; p.vz[i] *= 0.01;
          p.size[i] *= 1.5;
          p.life[i] = 16;
          p.drag[i] = 0.86;
          p.flags[i] = 0;
          sprite(i, e.kind === "heart" ? SPRITE.heart : SPRITE.angry, 1, Anim.Fixed);
        }
        return;
      case "crit": {
        const m = e.count ?? 16;
        for (let k = 0; k < m; k++) {
          let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
          const l = Math.hypot(dx, dy, dz) || 1;
          dx /= l; dy /= l; dz /= l;
          const i = add(e.x + dx * 0.3, e.y + dy * 0.3, e.z + dz * 0.3, 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] = p.vx[i] * 0.1 + dx * 0.4; p.vy[i] = p.vy[i] * 0.1 + dy * 0.4; p.vz[i] = p.vz[i] * 0.1 + dz * 0.4;
          const c = rand() * 0.3 + 0.6;
          p.r[i] = p.g[i] = p.b[i] = c;
          if (e.color !== undefined) color(i, e.color, c);
          p.size[i] *= 0.75;
          p.life[i] = Math.max(1, Math.floor(6 / (rand() * 0.8 + 0.6)));
          p.grav[i] = 0.5;
          p.drag[i] = 0.7;
          sprite(i, SPRITE.crit, 1, Anim.Fixed);
        }
        return;
      }
      case "portal":
        for (let k = 0; k < n; k++) {
          const i = add(e.x, e.y, e.z, (rand() - 0.5) * 2, (rand() - 0.5) * 2, (rand() - 0.5) * 2, false);
          if (i < 0) return;
          const j = rand() * 0.6 + 0.4;
          p.r[i] = j * 0.9; p.g[i] = j * 0.3; p.b[i] = j;
          if (e.color !== undefined) color(i, e.color, j);
          p.life[i] = Math.floor(rand() * 10) + 40;
          p.size[i] = 0.1 * (rand() * 0.2 + 0.5);
          p.beh[i] = Beh.Portal;
          p.flags[i] = BRIGHT;
          p.x[i] = p.px[i] = e.x + p.vx[i];
          p.y[i] = p.py[i] = e.y + p.vy[i] + 1;
          p.z[i] = p.pz[i] = e.z + p.vz[i];
        }
        return;
      case "drip":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 0.6), e.y, e.z + jit(n, 0.6), 0, 0, 0, false);
          if (i < 0) return;
          color(i, e.color ?? 0x3355ff);
          if (e.color === 0xff6a00 || e.color === 0xffa500) p.flags[i] |= BRIGHT;
          p.life[i] = 40;
          p.grav[i] = 0;
          p.beh[i] = Beh.Drip;
          sprite(i, SPRITE.dripHang, 1, Anim.Fixed);
        }
        return;
      case "note":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 0.6), e.y, e.z + jit(n, 0.6), 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] *= 0.01; p.vy[i] = p.vy[i] * 0.01 + 0.2; p.vz[i] *= 0.01;
          if (e.color !== undefined) color(i, e.color);
          else {
            const h = Math.floor(rand() * 25) / 24;
            p.r[i] = Math.max(0, Math.sin(h * Math.PI * 2) * 0.65 + 0.35);
            p.g[i] = Math.max(0, Math.sin((h + 1 / 3) * Math.PI * 2) * 0.65 + 0.35);
            p.b[i] = Math.max(0, Math.sin((h + 2 / 3) * Math.PI * 2) * 0.65 + 0.35);
          }
          p.size[i] *= 1.5;
          p.life[i] = 6;
          p.drag[i] = 0.66;
          p.flags[i] = 0;
          sprite(i, SPRITE.note, 1, Anim.Fixed);
        }
        return;
      case "dust":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 0.5), e.y + jit(n, 0.5), e.z + jit(n, 0.5), 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] *= 0.1; p.vy[i] *= 0.1; p.vz[i] *= 0.1;
          color(i, e.color ?? 0xff0000, rand() * 0.4 + 0.6);
          p.size[i] *= 0.75;
          p.life[i] = Math.max(1, Math.floor(8 / (rand() * 0.8 + 0.2)));
          p.drag[i] = 0.96;
          p.flags[i] = 0;
          sprite(i, SPRITE.generic, 8, Anim.Rev);
        }
        return;
      case "gust":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 1.5), e.y + jit(n, 1.5), e.z + jit(n, 1.5), 0, 0, 0, false);
          if (i < 0) return;
          p.age[i] = -Math.floor(k / 2);
          p.size[i] = 1;
          p.life[i] = 12;
          p.flags[i] = BRIGHT;
          sprite(i, SPRITE.gust, 12, Anim.Fwd);
        }
        return;
      case "trial_omen":
        for (let k = 0; k < n; k++) {
          const i = add(e.x + jit(n, 0.8), e.y + jit(n, 0.8), e.z + jit(n, 0.8), 0, 0, 0, true);
          if (i < 0) return;
          p.vx[i] *= 0.1; p.vy[i] = p.vy[i] * 0.1 + 0.02; p.vz[i] *= 0.1;
          color(i, e.color ?? 0x4ee6d4, rand() * 0.3 + 0.7);
          p.life[i] = Math.max(1, Math.floor(8 / (rand() * 0.8 + 0.2)));
          p.drag[i] = 0.96;
          p.flags[i] = BRIGHT;
          sprite(i, SPRITE.spark, 1, Anim.Fixed);
        }
        return;
    }
  }

  function rainSplash(x: number, y: number, z: number, water: boolean) {
    const i = add(x, y, z, 0, 0, 0, true);
    if (i < 0) return;
    p.vx[i] *= 0.3; p.vy[i] = rand() * 0.2 + 0.1; p.vz[i] *= 0.3;
    if (!water) p.vy[i] *= 0.3;
    p.grav[i] = 0.06 / 0.04;
    p.life[i] = Math.floor(8 / (rand() * 0.8 + 0.2));
    sprite(i, SPRITE.splash + Math.floor(rand() * 4), 1, Anim.Fixed);
  }

  function kill(i: number) {
    const last = --count;
    if (i === last) return;
    for (const f of FIELDS) p[f][i] = p[f][last];
  }

  function move(i: number) {
    let x = p.x[i], y = p.y[i], z = p.z[i];
    const vx = p.vx[i], vy = p.vy[i], vz = p.vz[i];
    if (!(p.flags[i] & COLLIDE)) {
      p.x[i] = x + vx; p.y[i] = y + vy; p.z[i] = z + vz;
      return;
    }
    if (solidAt(x + vx, y, z)) p.vx[i] = 0; else x += vx;
    if (solidAt(x, y + vy, z)) {
      if (vy < 0) {
        y = Math.floor(y + vy) + 1 + 0.01;
        p.flags[i] |= GROUND;
      }
      p.vy[i] = 0;
    } else {
      y += vy;
      p.flags[i] &= ~GROUND;
    }
    if (solidAt(x, y, z + vz)) p.vz[i] = 0; else z += vz;
    p.x[i] = x; p.y[i] = y; p.z[i] = z;
  }

  function tick() {
    tickNo++;
    for (let i = count - 1; i >= 0; i--) {
      p.px[i] = p.x[i]; p.py[i] = p.y[i]; p.pz[i] = p.z[i];
      const age = ++p.age[i];
      if (age <= 0) continue;
      if (age >= p.life[i]) {
        if (p.beh[i] === Beh.Drip) {
          p.beh[i] = Beh.Fall;
          p.life[i] = age + 200;
          p.grav[i] = 0.06;
          p.layer[i] = SPRITE.dripFall;
          continue;
        }
        kill(i);
        continue;
      }
      const beh = p.beh[i];
      if (beh === Beh.Portal) {
        const t = age / p.life[i];
        const q = 1 - (-t + t * t * 2);
        p.x[i] = p.ox[i] + p.vx[i] * q;
        p.y[i] = p.oy[i] + p.vy[i] * q + (1 - t);
        p.z[i] = p.oz[i] + p.vz[i] * q;
        continue;
      }
      if (beh === Beh.Drip) continue;
      if (beh === Beh.Fall) p.vy[i] -= p.grav[i];
      else p.vy[i] -= 0.04 * p.grav[i];
      if (beh === Beh.Bubble) p.vy[i] += 0.002;
      move(i);
      if (beh === Beh.Bubble && !IS_FLUID[idOf(world.getBlock(Math.floor(p.x[i]), Math.floor(p.y[i]), Math.floor(p.z[i])))]) {
        kill(i);
        continue;
      }
      if (beh === Beh.Fall && p.flags[i] & GROUND) {
        p.beh[i] = Beh.Normal;
        p.layer[i] = SPRITE.dripLand;
        p.life[i] = age + 4 + Math.floor(rand() * 4);
        p.vx[i] = p.vy[i] = p.vz[i] = 0;
        p.grav[i] = 0;
        continue;
      }
      const d = p.drag[i];
      p.vx[i] *= d; p.vy[i] *= d; p.vz[i] *= d;
      if (p.flags[i] & GROUND) { p.vx[i] *= 0.7; p.vz[i] *= 0.7; }
      if (!(p.flags[i] & BRIGHT) && (i & 3) === (tickNo & 3)) p.light[i] = brightness(p.x[i], p.y[i], p.z[i]);
    }
  }

  function update(dt: number) {
    if (!cap) return;
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 5) { tick(); acc -= TICK; steps++; }
    if (acc > TICK) acc = 0;
    const t = acc / TICK;
    mat.uniforms.uAtlas.value = atlas();
    const P = aPos.array as Float32Array, C = aColor.array as Float32Array, U = aUv.array as Float32Array, X = aTex.array as Float32Array;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const age = p.age[i];
      if (age < 0) continue;
      const life = p.life[i];
      const f = p.flags[i];
      let size = p.size[i];
      if (f & SHRINK) { const s = (age + t) / life; size *= 1 - s * s * 0.5; }
      P[n * 4] = p.px[i] + (p.x[i] - p.px[i]) * t;
      P[n * 4 + 1] = p.py[i] + (p.y[i] - p.py[i]) * t;
      P[n * 4 + 2] = p.pz[i] + (p.z[i] - p.pz[i]) * t;
      P[n * 4 + 3] = size;
      const light = f & BRIGHT ? 1 : p.light[i];
      C[n * 4] = p.r[i] * light; C[n * 4 + 1] = p.g[i] * light; C[n * 4 + 2] = p.b[i] * light; C[n * 4 + 3] = p.a[i];
      const du = p.du[i];
      U[n * 4] = p.u0[i]; U[n * 4 + 1] = p.v0[i]; U[n * 4 + 2] = du; U[n * 4 + 3] = du;
      const frames = p.frames[i];
      let layer = p.layer[i];
      if (frames > 1) {
        const k = Math.min(frames - 1, Math.floor((age / life) * frames));
        layer += p.anim[i] === Anim.Rev ? frames - 1 - k : k;
      }
      X[n * 2] = layer; X[n * 2 + 1] = p.src[i];
      n++;
    }
    geo.instanceCount = n;
    touch(aPos, n * 4); touch(aColor, n * 4); touch(aUv, n * 4); touch(aTex, n * 2);
    mesh.visible = n > 0;
  }

  // Biome ambient particles: 0 white ash, 1 ash, 2 crimson spore, 3 warped spore (vanilla BaseAshSmoke and Suspended particles).
  function ambient(kind: number, x: number, y: number, z: number) {
    if (count > cap * 0.6) return;
    const i = add(x, y, z, 0, 0, 0, false);
    if (i < 0) return;
    p.flags[i] = 0;
    if (kind <= 1) {
      const white = kind === 0;
      p.vx[i] = white ? rand() * -1.9 * rand() * 0.1 : 0;
      p.vy[i] = white ? rand() * -0.5 * rand() * 0.1 * 5 : 0;
      p.vz[i] = white ? rand() * -1.9 * rand() * 0.1 : 0;
      p.vx[i] += (rand() * 2 - 1) * 0.01; p.vy[i] -= rand() * 0.01; p.vz[i] += (rand() * 2 - 1) * 0.01;
      if (white) { p.r[i] = 0.73 + rand() * 0.05; p.g[i] = 0.69 + rand() * 0.05; p.b[i] = 0.76 + rand() * 0.05; } else { const c = rand() * 0.5; p.r[i] = p.g[i] = p.b[i] = c; }
      p.size[i] *= 0.75 * (white ? 1 : 0.5);
      p.life[i] = Math.max(1, Math.floor((20 / (rand() * 0.8 + 0.2)) * (white ? 1 : 0.5)));
      p.grav[i] = white ? 0.0125 : 0.1;
      p.drag[i] = 0.96;
      sprite(i, SPRITE.generic, 4, Anim.Rev);
      return;
    }
    p.vx[i] = 0; p.vz[i] = 0;
    p.vy[i] = kind === 3 ? rand() * -1.9 * rand() * 0.01 : 0;
    if (kind === 2) color(i, 0xe66680); else color(i, 0x1a8ca8);
    p.size[i] *= rand() * 0.6 + 0.2;
    p.life[i] = Math.floor(16 / (rand() * 0.8 + 0.2));
    p.grav[i] = 0;
    p.drag[i] = 1;
    sprite(i, SPRITE.generic + 1, 1, Anim.Fixed);
  }

  return {
    addParticles,
    ambient,
    rainSplash: (x: number, y: number, z: number) => rainSplash(x, y, z, false),
    update,
    setBudget,
    setLighting(_day: number, _g: number) {},
    count: () => count,
    clear() { count = 0; },
    reloadArt() {
      sheet.dispose();
      sheet = makeSheet();
      mat.uniforms.uSheet.value = sheet;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose(); base.dispose(); mat.dispose(); sheet.dispose();
    },
  };
}

export type Particles = ReturnType<typeof createParticles>;
