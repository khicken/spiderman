import * as THREE from "three";
import type { Fx, FxKind, SharedUniforms, V3 } from "./contracts";
import { HM_GLSL } from "./render-look";

// One particle pool, one instanced draw call. Every particle is a camera-facing capsule from `pos` to `pos + tail`,
// so sparks, rain splashes and sword/arrow trail segments share the quad with dots, leaves and stars.
// Premultiplied blending lets additive and alpha particles mix in the same call.

const SHAPE = { dot: 0, streak: 1, leaf: 2, star: 3, glow: 4 } as const;

interface KindDef {
  shape: number;
  colors: THREE.Color[];
  hdr: number; // color multiplier (>1 blooms)
  lit: boolean; // multiplied by scene light
  add: boolean;
  alpha: number;
  size: [number, number];
  grow: number; // size change per second (fraction)
  life: [number, number];
  grav: number;
  drag: number;
  wind: number; // how much the wind pushes it
  speed: number; // default burst speed
  up: number; // upward bias added to the burst direction
  stretch: number; // tail = -velocity * stretch
}

const C = (...hex: string[]) => hex.map((h) => new THREE.Color(h));

const KINDS: Record<FxKind | "trail" | "trail-arrow", KindDef> = {
  dust: { shape: SHAPE.dot, colors: C("#d8c49c", "#c7b08a", "#e0cfa8"), hdr: 1, lit: true, add: false, alpha: 0.55, size: [0.25, 0.45], grow: 1.4, life: [0.6, 1.1], grav: -0.4, drag: 3.5, wind: 0.4, speed: 2.2, up: 0.5, stretch: 0 },
  spark: { shape: SHAPE.streak, colors: C("#ffd27a", "#ffe8b0", "#ffb35a"), hdr: 3.2, lit: false, add: true, alpha: 1, size: [0.035, 0.06], grow: -0.6, life: [0.18, 0.38], grav: 9, drag: 1.5, wind: 0, speed: 7, up: 0.35, stretch: 0.035 },
  leaf: { shape: SHAPE.leaf, colors: C("#6f9a46", "#8fae4c", "#4f7a3a", "#a9c26a"), hdr: 1, lit: true, add: false, alpha: 1, size: [0.09, 0.15], grow: 0, life: [1.4, 2.4], grav: 1.6, drag: 2.2, wind: 0.9, speed: 3, up: 0.8, stretch: 0 },
  splash: { shape: SHAPE.dot, colors: C("#e8f4f0", "#bfe0da", "#f8f0dd"), hdr: 1.1, lit: true, add: false, alpha: 0.85, size: [0.08, 0.16], grow: -0.4, life: [0.45, 0.75], grav: 14, drag: 0.6, wind: 0.1, speed: 4.5, up: 1.4, stretch: 0.02 },
  ember: { shape: SHAPE.glow, colors: C("#f08a3c", "#ffc07a", "#ff9a4a"), hdr: 2.6, lit: false, add: true, alpha: 1, size: [0.05, 0.09], grow: -0.3, life: [1.1, 2], grav: -1.3, drag: 1.2, wind: 0.6, speed: 1.4, up: 0.8, stretch: 0 },
  glimmer: { shape: SHAPE.star, colors: C("#e8c766", "#fff0b0", "#c9a13b"), hdr: 2.4, lit: false, add: true, alpha: 1, size: [0.12, 0.22], grow: -0.5, life: [0.7, 1.2], grav: -0.6, drag: 2.5, wind: 0, speed: 2.4, up: 0.6, stretch: 0 },
  gloam: { shape: SHAPE.dot, colors: C("#5b3a6e", "#a47cc6", "#3e2850"), hdr: 1.3, lit: false, add: false, alpha: 0.7, size: [0.28, 0.5], grow: 0.8, life: [0.9, 1.6], grav: -1, drag: 2.5, wind: 0.3, speed: 2.5, up: 0.5, stretch: 0 },
  heal: { shape: SHAPE.star, colors: C("#c8eda0", "#f8f0dd", "#9fd48a"), hdr: 1.8, lit: false, add: true, alpha: 1, size: [0.1, 0.18], grow: -0.3, life: [0.9, 1.4], grav: -2.2, drag: 1.5, wind: 0, speed: 1.2, up: 1, stretch: 0 },
  "blood-sap": { shape: SHAPE.dot, colors: C("#b4511e", "#d9822e", "#8f3a14"), hdr: 1, lit: true, add: false, alpha: 1, size: [0.05, 0.1], grow: -0.2, life: [0.4, 0.7], grav: 13, drag: 0.8, wind: 0, speed: 4, up: 0.6, stretch: 0.03 },
  "rain-splash": { shape: SHAPE.streak, colors: C("#e6f0ef", "#cfe2e0"), hdr: 1, lit: true, add: false, alpha: 0.55, size: [0.015, 0.025], grow: 0, life: [0.16, 0.26], grav: 9, drag: 0.5, wind: 0, speed: 1.8, up: 1.6, stretch: 0.05 },
  beacon: { shape: SHAPE.glow, colors: C("#ffc07a", "#e8c766", "#f08a3c"), hdr: 3, lit: false, add: true, alpha: 1, size: [0.08, 0.16], grow: -0.2, life: [1.8, 3], grav: -4, drag: 0.4, wind: 0.2, speed: 1, up: 2, stretch: 0.05 },
  trail: { shape: SHAPE.streak, colors: C("#fff6e0"), hdr: 1.5, lit: false, add: true, alpha: 0.55, size: [0.09, 0.09], grow: -2.5, life: [0.16, 0.16], grav: 0, drag: 0, wind: 0, speed: 0, up: 0, stretch: 0 },
  "trail-arrow": { shape: SHAPE.streak, colors: C("#f8f0dd"), hdr: 1.2, lit: false, add: true, alpha: 0.4, size: [0.025, 0.025], grow: -2, life: [0.22, 0.22], grav: 0, drag: 0, wind: 0, speed: 0, up: 0, stretch: 0 },
};

const VERT = /* glsl */ `
attribute vec4 iA; // head xyz, size
attribute vec4 iB; // tail offset xyz, alpha (negative = additive)
attribute vec4 iC; // rgb, shape + 8 * lit + fract = rotation
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vAdd;
varying float vDist;
void main() {
  vec4 h = viewMatrix * vec4(iA.xyz, 1.0);
  vec4 t = viewMatrix * vec4(iA.xyz + iB.xyz, 1.0);
  float size = iA.w;
  vec2 ax = t.xy - h.xy;
  float L = length(ax);
  vec4 p = h;
  if (L > size * 0.3) {
    vec2 dir = ax / L;
    vec2 perp = vec2(-dir.y, dir.x);
    float a = position.y * 0.5 + 0.5;
    p = mix(h, t, a);
    p.xy += perp * position.x * size + dir * (position.y * size);
  } else {
    float r = fract(iC.w) * 6.2831853;
    float c = cos(r), s = sin(r);
    p.xy += mat2(c, s, -s, c) * position.xy * size;
  }
  vUv = position.xy;
  float w = floor(iC.w);
  float lit = step(7.5, w);
  vShape = w - lit * 8.0;
  vec3 col = iC.rgb;
  if (lit > 0.5) col *= uSkyColor + uSunColor * 0.75 + uLanternColor * 0.4;
  vCol = vec4(col, abs(iB.w));
  vAdd = step(iB.w, 0.0);
  vDist = -p.z;
  gl_Position = projectionMatrix * p;
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vAdd;
varying float vDist;
void main() {
  vec2 p = vUv;
  float a;
  if (vShape < 0.5) {
    float r = length(p);
    a = smoothstep(1.0, 0.72, r) * (0.8 + 0.2 * smoothstep(0.9, 0.5, r));
  } else if (vShape < 1.5) {
    a = smoothstep(1.0, 0.3, abs(p.x)) * smoothstep(1.0, 0.6, abs(p.y));
  } else if (vShape < 2.5) {
    float w = (1.0 - p.y * p.y) * 0.55;
    a = smoothstep(w, w - 0.12, abs(p.x));
    a *= 1.0 - 0.3 * smoothstep(0.08, 0.0, abs(p.x));
  } else if (vShape < 3.5) {
    float st = abs(p.x * p.y) * 9.0 + length(p) * 0.6;
    a = smoothstep(0.75, 0.25, st);
  } else {
    float r = length(p);
    a = smoothstep(0.55, 0.15, r) + 0.45 * exp(-r * r * 4.0);
  }
  a *= vCol.a;
  if (a < 0.004) discard;
  vec3 col = vCol.rgb;
  if (vAdd < 0.5) col = hmFog(col, vDist);
  else a *= 1.0 - smoothstep(uFogNear, uFogFar, vDist);
  gl_FragColor = vec4(col * a, vAdd > 0.5 ? 0.0 : a);
}`;

const TRAIL_IDS = 32;

export interface FxPool extends Fx {
  readonly mesh: THREE.Mesh;
  setBudget(n: number): void;
  update(dt: number, wind: THREE.Vector2): void;
  count(): number;
  dispose(): void;
}

export function createFx(uniforms: SharedUniforms, budget: number): FxPool {
  let max = 0;
  let px!: Float32Array, py!: Float32Array, pz!: Float32Array, vx!: Float32Array, vy!: Float32Array, vz!: Float32Array;
  let size!: Float32Array, grow!: Float32Array, age!: Float32Array, life!: Float32Array, grav!: Float32Array, drag!: Float32Array;
  let wnd!: Float32Array, str!: Float32Array, alpha!: Float32Array, rot!: Float32Array, spin!: Float32Array;
  let tx!: Float32Array, ty!: Float32Array, tz!: Float32Array;
  let cr!: Float32Array, cg!: Float32Array, cb!: Float32Array, cw!: Float32Array;
  let attrA!: THREE.InstancedBufferAttribute, attrB!: THREE.InstancedBufferAttribute, attrC!: THREE.InstancedBufferAttribute;
  let n = 0;

  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.instanceCount = 0;

  const alloc = (m: number) => {
    if (max > 0) geo.dispose(); // frees the old instance buffers; the geometry re-uploads on the next draw
    max = m;
    const f = () => new Float32Array(m);
    px = f(); py = f(); pz = f(); vx = f(); vy = f(); vz = f(); size = f(); grow = f(); age = f(); life = f();
    grav = f(); drag = f(); wnd = f(); str = f(); alpha = f(); rot = f(); spin = f(); tx = f(); ty = f(); tz = f();
    cr = f(); cg = f(); cb = f(); cw = f();
    attrA = new THREE.InstancedBufferAttribute(new Float32Array(m * 4), 4).setUsage(THREE.DynamicDrawUsage);
    attrB = new THREE.InstancedBufferAttribute(new Float32Array(m * 4), 4).setUsage(THREE.DynamicDrawUsage);
    attrC = new THREE.InstancedBufferAttribute(new Float32Array(m * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iA", attrA);
    geo.setAttribute("iB", attrB);
    geo.setAttribute("iC", attrC);
    n = 0;
    geo.instanceCount = 0;
  };
  alloc(budget);

  const mat = new THREE.ShaderMaterial({
    vertexShader: HM_GLSL + VERT,
    fragmentShader: HM_GLSL + FRAG,
    uniforms: { ...uniforms },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  const spawn = (k: KindDef, x: number, y: number, z: number, dx: number, dy: number, dz: number, sp: number) => {
    if (n >= max) return -1;
    const i = n++;
    px[i] = x; py[i] = y; pz[i] = z;
    vx[i] = dx * sp; vy[i] = dy * sp; vz[i] = dz * sp;
    size[i] = k.size[0] + Math.random() * (k.size[1] - k.size[0]);
    grow[i] = k.grow;
    age[i] = 0;
    life[i] = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
    grav[i] = k.grav; drag[i] = k.drag; wnd[i] = k.wind; str[i] = k.stretch;
    alpha[i] = k.add ? -k.alpha : k.alpha;
    rot[i] = Math.random(); spin[i] = k.shape === SHAPE.leaf ? (Math.random() - 0.5) * 2.4 : 0;
    tx[i] = 0; ty[i] = 0; tz[i] = 0;
    const c = k.colors[(Math.random() * k.colors.length) | 0];
    cr[i] = c.r * k.hdr; cg[i] = c.g * k.hdr; cb[i] = c.b * k.hdr;
    cw[i] = k.shape + (k.lit ? 8 : 0);
    return i;
  };

  const trailPrev = new Float32Array(TRAIL_IDS * 3);
  const trailOn = new Uint8Array(TRAIL_IDS);

  const mark = (at: THREE.InstancedBufferAttribute) => {
    at.clearUpdateRanges();
    at.addUpdateRange(0, Math.max(4, n * 4));
    at.needsUpdate = true;
  };

  const pool: FxPool = {
    mesh,
    burst(kind: FxKind, pos: V3, count: number, dir?: V3, speed?: number) {
      const k = KINDS[kind];
      if (!k) return;
      const sp = speed ?? k.speed;
      for (let j = 0; j < count; j++) {
        let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        if (dir) {
          dx = dir.x + dx * 0.45; dy = dir.y + dy * 0.45; dz = dir.z + dz * 0.45;
        }
        dy += k.up;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        const s = sp * (0.45 + Math.random() * 0.75);
        const jr = 0.12;
        if (spawn(k, pos.x + (Math.random() - 0.5) * jr, pos.y + (Math.random() - 0.5) * jr, pos.z + (Math.random() - 0.5) * jr, dx / l2, dy / l2, dz / l2, s) < 0) return;
      }
    },
    trail(id: number, pos: V3, on: boolean) {
      if (id < 0 || id >= TRAIL_IDS) return;
      const o = id * 3;
      if (on && trailOn[id]) {
        const i = spawn(id === 0 ? KINDS.trail : KINDS["trail-arrow"], pos.x, pos.y, pos.z, 0, 0, 0, 0);
        if (i >= 0) {
          tx[i] = trailPrev[o] - pos.x; ty[i] = trailPrev[o + 1] - pos.y; tz[i] = trailPrev[o + 2] - pos.z;
        }
      }
      trailOn[id] = on ? 1 : 0;
      trailPrev[o] = pos.x; trailPrev[o + 1] = pos.y; trailPrev[o + 2] = pos.z;
    },
    setBudget(b: number) {
      if (b === max) return;
      alloc(b);
    },
    count: () => n,
    update(dt: number, wind: THREE.Vector2) {
      const A = attrA.array as Float32Array, B = attrB.array as Float32Array, Cc = attrC.array as Float32Array;
      let i = 0;
      while (i < n) {
        age[i] += dt;
        if (age[i] >= life[i]) {
          const j = --n;
          px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
          size[i] = size[j]; grow[i] = grow[j]; age[i] = age[j]; life[i] = life[j]; grav[i] = grav[j]; drag[i] = drag[j];
          wnd[i] = wnd[j]; str[i] = str[j]; alpha[i] = alpha[j]; rot[i] = rot[j]; spin[i] = spin[j];
          tx[i] = tx[j]; ty[i] = ty[j]; tz[i] = tz[j]; cr[i] = cr[j]; cg[i] = cg[j]; cb[i] = cb[j]; cw[i] = cw[j];
          continue;
        }
        const dr = Math.max(0, 1 - drag[i] * dt);
        vx[i] = vx[i] * dr + wind.x * wnd[i] * dt;
        vz[i] = vz[i] * dr + wind.y * wnd[i] * dt;
        vy[i] = vy[i] * dr - grav[i] * dt;
        if (spin[i] !== 0) {
          vx[i] += Math.sin(age[i] * 5 + rot[i] * 20) * 1.5 * dt;
          rot[i] += spin[i] * dt;
        }
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        const t = age[i] / life[i];
        const sz = Math.max(0.001, size[i] * (1 + grow[i] * age[i]));
        const fade = Math.min(1, t * 12) * (1 - t * t);
        const o = i * 4;
        A[o] = px[i]; A[o + 1] = py[i]; A[o + 2] = pz[i]; A[o + 3] = sz;
        if (str[i] > 0) {
          B[o] = -vx[i] * str[i]; B[o + 1] = -vy[i] * str[i]; B[o + 2] = -vz[i] * str[i];
        } else {
          B[o] = tx[i]; B[o + 1] = ty[i]; B[o + 2] = tz[i];
        }
        B[o + 3] = alpha[i] * fade;
        Cc[o] = cr[i]; Cc[o + 1] = cg[i]; Cc[o + 2] = cb[i];
        Cc[o + 3] = cw[i] + (((rot[i] % 1) + 1) % 1) * 0.999;
        i++;
      }
      geo.instanceCount = n;
      mark(attrA);
      mark(attrB);
      mark(attrC);
    },
    dispose() {
      quad.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
  return pool;
}
