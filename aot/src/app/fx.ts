import * as THREE from "three";
import type { Fx, Quality } from "./contracts";

export type { Fx };

export const PUFF = { steam: 0, gas: 1, blood: 2, dust: 3, flare: 4 } as const;

const PUFF_VERT = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iData;
varying vec2 vP;
varying vec4 vData;
#include <fog_pars_vertex>
void main() {
  float a = iData.y * 6.2831;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy;
  vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
  float dist = -mvPosition.z;
  // Near the camera a puff would fill the screen and cost fill rate: cap its size and fade it out.
  mvPosition.xy += q * min(iPos.w, max(dist, 0.0) * 0.6);
  vP = q * 2.0;
  vData = iData;
  vData.w *= smoothstep(1.0, 4.0, dist);
  gl_Position = vData.w > 0.0 ? projectionMatrix * mvPosition : vec4(0.0, 0.0, 2.0, 1.0);
  #include <fog_vertex>
}`;

const PUFF_FRAG = /* glsl */ `
varying vec2 vP;
varying vec4 vData;
#include <fog_pars_fragment>
float hh(float n) { return fract(sin(n * 91.7) * 43758.5); }
void main() {
  float age = vData.x, seed = vData.y, kind = vData.z, alpha = vData.w;
  float best = 1e3; float near = 1e3; vec2 bn = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float an = fi * 1.3 + seed * 9.0;
    float rad = i == 0 ? 0.0 : 0.3 + 0.12 * hh(seed + fi);
    vec2 c = vec2(cos(an), sin(an)) * rad;
    float rr = i == 0 ? 0.5 : 0.28 + 0.12 * hh(seed * 3.0 + fi);
    float d = length(vP - c) - rr;
    float h = clamp(0.5 + 0.5 * (best - d) / 0.12, 0.0, 1.0);
    best = mix(best, d, h) - 0.12 * h * (1.0 - h);
    if (d < near) { near = d; bn = (vP - c) / rr; }
  }
  best /= 0.5;
  float erode = smoothstep(0.6, 1.0, age) * 0.5;
  float edge = best + erode * (0.75 + 0.25 * sin(vP.x * 7.0 + seed * 20.0) * sin(vP.y * 6.0 - seed * 13.0));
  float aa = fwidth(edge) * 1.2 + 0.02;
  float m = smoothstep(aa, -aa, edge);
  if (m < 0.01) discard;
  vec3 n = vec3(bn, sqrt(max(0.0, 1.0 - dot(bn, bn))));
  float lit = 0.35 * dot(n, normalize(vec3(0.4, 0.8, 0.45))) + 0.75 * vP.y + 0.15;
  vec3 hi, mid, lo;
  if (kind < 0.5) { hi = vec3(1.0); mid = vec3(0.86, 0.87, 0.93); lo = vec3(0.66, 0.66, 0.76); }
  else if (kind < 1.5) { hi = vec3(0.97, 0.98, 1.0); mid = vec3(0.82, 0.84, 0.9); lo = vec3(0.7, 0.72, 0.8); }
  else if (kind < 2.5) {
    float s = smoothstep(0.3, 0.6, age);
    hi = mix(vec3(0.85, 0.06, 0.05), vec3(1.0, 0.92, 0.92), s);
    mid = mix(vec3(0.6, 0.02, 0.03), vec3(0.88, 0.8, 0.84), s);
    lo = mix(vec3(0.35, 0.0, 0.03), vec3(0.7, 0.62, 0.7), s);
  }
  else if (kind < 3.5) { hi = vec3(0.86, 0.78, 0.62); mid = vec3(0.7, 0.62, 0.5); lo = vec3(0.52, 0.46, 0.44); }
  else { hi = vec3(0.55, 0.95, 0.5); mid = vec3(0.3, 0.75, 0.35); lo = vec3(0.16, 0.48, 0.3); }
  vec3 col = lit > 0.35 ? hi : lit > -0.15 ? mid : lo;
  gl_FragColor = vec4(col, m * alpha);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

let puffGeo: THREE.PlaneGeometry | null = null;

export type Puffs = ReturnType<typeof createPuffs>;

// Struct-of-arrays particle pool drawn as one instanced billboard mesh.
export function createPuffs(max: number) {
  const px = new Float32Array(max), py = new Float32Array(max), pz = new Float32Array(max);
  const vx = new Float32Array(max), vy = new Float32Array(max), vz = new Float32Array(max);
  const size = new Float32Array(max), grow = new Float32Array(max), life = new Float32Array(max), age = new Float32Array(max);
  const kind = new Float32Array(max), seed = new Float32Array(max), drag = new Float32Array(max), grav = new Float32Array(max), alpha = new Float32Array(max);
  const posAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const dataAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  puffGeo ??= new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = puffGeo.index;
  geo.setAttribute("position", puffGeo.getAttribute("position"));
  geo.setAttribute("iPos", posAttr);
  geo.setAttribute("iData", dataAttr);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.userData.noInk = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  let n = 0;
  let cap = max;

  const spawn = (x: number, y: number, z: number, ux: number, uy: number, uz: number, s: number, g: number, l: number, k: number, d: number, gr: number, a = 1) => {
    if (n >= cap) return;
    const i = n++;
    px[i] = x; py[i] = y; pz[i] = z; vx[i] = ux; vy[i] = uy; vz[i] = uz;
    size[i] = s; grow[i] = g; life[i] = l; age[i] = 0; kind[i] = k; seed[i] = Math.random(); drag[i] = d; grav[i] = gr; alpha[i] = a;
  };

  const update = (dt: number) => {
    const P = posAttr.array as Float32Array;
    const D = dataAttr.array as Float32Array;
    let i = 0;
    while (i < n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        const j = --n;
        px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
        size[i] = size[j]; grow[i] = grow[j]; life[i] = life[j]; age[i] = age[j]; kind[i] = kind[j]; seed[i] = seed[j]; drag[i] = drag[j]; grav[i] = grav[j]; alpha[i] = alpha[j];
        continue;
      }
      const k = Math.exp(-drag[i] * dt);
      vx[i] *= k; vz[i] *= k;
      vy[i] = vy[i] * k - grav[i] * dt;
      if (kind[i] === PUFF.blood && age[i] > life[i] * 0.35) {
        vy[i] += 9 * dt;
        grow[i] = Math.max(grow[i], size[i] * 0.9);
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (py[i] < 0.1) { py[i] = 0.1; vy[i] = Math.abs(vy[i]) * 0.2; }
      size[i] += grow[i] * dt;
      const t = age[i] / life[i];
      P[i * 4] = px[i]; P[i * 4 + 1] = py[i]; P[i * 4 + 2] = pz[i]; P[i * 4 + 3] = size[i] * Math.min(1, age[i] * 12 + 0.3);
      D[i * 4] = t; D[i * 4 + 1] = seed[i]; D[i * 4 + 2] = kind[i]; D[i * 4 + 3] = alpha[i] * (t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1);
      i++;
    }
    geo.instanceCount = n;
    posAttr.needsUpdate = true;
    dataAttr.needsUpdate = true;
    posAttr.clearUpdateRanges();
    dataAttr.clearUpdateRanges();
    posAttr.addUpdateRange(0, n * 4);
    dataAttr.addUpdateRange(0, n * 4);
  };

  return {
    mesh,
    spawn,
    update,
    get count() { return n; },
    setCap(c: number) { cap = Math.min(max, c); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

const SLASH_VERT = /* glsl */ `
attribute vec2 aTS;
varying vec2 vTS;
void main() { vTS = aTS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SLASH_FRAG = /* glsl */ `
uniform float uAge;
varying vec2 vTS;
void main() {
  float t = vTS.x, s = vTS.y;
  float head = uAge * 1.6 - 0.35;
  if (t < head) discard;
  float core = smoothstep(0.0, 0.35, s);
  vec3 col = mix(vec3(0.55, 0.85, 1.0), vec3(1.0), core);
  float a = (1.0 - smoothstep(0.75, 1.0, uAge)) * smoothstep(head, head + 0.15, t);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const SEG = 24;
const QUAL: Record<Quality, { cap: number; rate: number }> = { low: { cap: 260, rate: 0.4 }, medium: { cap: 800, rate: 0.75 }, high: { cap: 1600, rate: 1 } };

export function createFx(scene: THREE.Scene): Fx {
  const puffs = createPuffs(1600);
  scene.add(puffs.mesh);
  let rate = 0.75;

  type Emitter = { on: boolean; pos: THREE.Vector3; at: (() => THREE.Vector3 | null) | null; size: number; dur: number; t: number; acc: number };
  const emitters: Emitter[] = Array.from({ length: 96 }, () => ({ on: false, pos: new THREE.Vector3(), at: null, size: 1, dur: 0, t: 0, acc: 0 }));
  const free = () => emitters.find((e) => !e.on) ?? null;

  const steamPuff = (x: number, y: number, z: number, s: number, burst: number) => {
    const r = s * 0.5;
    const ang = Math.random() * Math.PI * 2;
    const out = burst * s * (0.5 + Math.random());
    puffs.spawn(
      x + Math.cos(ang) * r * Math.random(), y + (Math.random() - 0.3) * r, z + Math.sin(ang) * r * Math.random(),
      Math.cos(ang) * out + 0.8, s * (0.35 + Math.random() * 0.4) + burst * s * 0.5, Math.sin(ang) * out,
      s * (0.5 + Math.random() * 0.5), s * 0.45, 1.6 + Math.random() * 1.4 + s * 0.08, PUFF.steam, 0.9, -0.3,
    );
  };

  type Slash = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; pos: THREE.BufferAttribute; age: number };
  const slashes: Slash[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const ts = new Float32Array((SEG + 1) * 2 * 2);
    const idx: number[] = [];
    for (let k = 0; k <= SEG; k++) {
      ts.set([k / SEG, 0, k / SEG, 1], k * 4);
      if (k < SEG) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    g.setAttribute("position", pos);
    g.setAttribute("aTS", new THREE.BufferAttribute(ts, 2));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ vertexShader: SLASH_VERT, fragmentShader: SLASH_FRAG, uniforms: { uAge: { value: 1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.userData.noInk = true;
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 6;
    scene.add(mesh);
    slashes.push({ mesh, mat, pos, age: 1 });
  }
  const p1 = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  return {
    steam(pos, s, duration) {
      if (duration <= 0.35) {
        const count = Math.ceil((4 + s * 1.5) * rate);
        for (let i = 0; i < count; i++) steamPuff(pos.x, pos.y, pos.z, s, 1);
        return;
      }
      const e = free();
      if (!e) return;
      e.on = true; e.at = null; e.pos.copy(pos); e.size = s; e.dur = duration; e.t = 0; e.acc = 0;
    },
    steamFollow(at, s, duration) {
      const e = free();
      if (!e) return;
      e.on = true; e.at = at; e.size = s; e.dur = duration; e.t = 0; e.acc = 0;
    },
    blood(pos, dir, s) {
      const count = Math.ceil((10 + s * 4) * rate);
      for (let i = 0; i < count; i++) {
        const sp = (8 + Math.random() * 14) * Math.sqrt(s);
        tmp.set(dir.x + (Math.random() - 0.5) * 0.9, dir.y + (Math.random() - 0.2) * 0.9, dir.z + (Math.random() - 0.5) * 0.9).normalize();
        puffs.spawn(pos.x, pos.y, pos.z, tmp.x * sp, tmp.y * sp + 3, tmp.z * sp, s * (0.3 + Math.random() * 0.4), 0.1, 0.9 + Math.random() * 0.9, PUFF.blood, 1.6, 14);
      }
      steamPuff(pos.x, pos.y, pos.z, s * 0.8, 0.6);
    },
    gas(pos, dir, strength) {
      const count = Math.max(1, Math.round((1 + strength * 3) * rate));
      for (let i = 0; i < count; i++) {
        const sp = 4 + strength * 8 * Math.random();
        puffs.spawn(pos.x, pos.y, pos.z, dir.x * sp + (Math.random() - 0.5) * 2, dir.y * sp + (Math.random() - 0.5) * 2, dir.z * sp + (Math.random() - 0.5) * 2, 0.35 + strength * 0.4, 1.4 + strength, 0.45 + Math.random() * 0.35, PUFF.gas, 4, -0.5, 0.9);
      }
    },
    dust(pos, s) {
      const count = Math.ceil((5 + s * 2) * rate);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = s * (2 + Math.random() * 3);
        puffs.spawn(pos.x + Math.cos(a) * s * 0.3, pos.y + 0.3, pos.z + Math.sin(a) * s * 0.3, Math.cos(a) * sp, Math.random() * s * 0.8, Math.sin(a) * sp, s * (0.4 + Math.random() * 0.4), s * 0.6, 0.9 + Math.random() * 0.8, PUFF.dust, 2.5, 0.4);
      }
    },
    slash(a, b, c) {
      let sl = slashes[0];
      for (const s of slashes) if (s.age > sl.age) sl = s;
      p1.copy(b).multiplyScalar(2).addScaledVector(a, -0.5).addScaledVector(c, -0.5);
      inward.copy(a).add(c).addScaledVector(p1, -2);
      const chord = a.distanceTo(c);
      if (inward.lengthSq() < 1e-6) inward.set(0, -1, 0);
      inward.normalize();
      const P = sl.pos.array as Float32Array;
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        const u = 1 - t;
        tmp.copy(a).multiplyScalar(u * u).addScaledVector(p1, 2 * u * t).addScaledVector(c, t * t);
        const wdt = chord * 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.8) * (0.35 + 0.65 * t);
        tmp2.copy(tmp).addScaledVector(inward, wdt);
        P.set([tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z], k * 6);
      }
      sl.pos.needsUpdate = true;
      sl.age = 0;
      sl.mat.uniforms.uAge.value = 0;
      sl.mesh.visible = true;
    },
    update(dt) {
      for (const e of emitters) {
        if (!e.on) continue;
        e.t += dt;
        const p = e.at ? e.at() : e.pos;
        if (!p || e.t > e.dur) { e.on = false; e.at = null; continue; }
        e.acc += dt * (3 + e.size * 1.6) * rate;
        while (e.acc >= 1) {
          e.acc -= 1;
          steamPuff(p.x, p.y, p.z, e.size, 0.15);
        }
      }
      for (const s of slashes) {
        if (!s.mesh.visible) continue;
        s.age += dt / 0.22;
        s.mat.uniforms.uAge.value = s.age;
        if (s.age >= 1) s.mesh.visible = false;
      }
      puffs.update(dt);
    },
    setQuality(q) {
      rate = QUAL[q].rate;
      puffs.setCap(QUAL[q].cap);
    },
    dispose() {
      puffs.dispose();
      for (const s of slashes) {
        s.mesh.geometry.dispose();
        s.mat.dispose();
      }
    },
  };
}
