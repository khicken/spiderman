import * as THREE from "three";
import type { Fx, Quality, Surface } from "./contracts";
import { createSkids } from "./fx-skid";
import { patchFog } from "./render-chunks";
import { QUALITY } from "./render";
import { LAYER, LIGHT, noiseTexture, releaseNoise } from "./render-shared";

const KIND = { smoke: 0, dust: 1, mist: 2, snow: 3, chunk: 4, grass: 5, spark: 6, flame: 7, glow: 8, gravel: 9, drop: 10 } as const;

const VERT = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iVel;
attribute vec4 iData;
varying vec2 vUv;
varying vec4 vData;
varying float vZ;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
  vec3 vv = mat3(viewMatrix) * iVel.xyz;
  vec2 q = position.xy * 2.0;
  float sz = iPos.w;
  if (iVel.w > 0.0) {
    vec2 sv = vv.xy * iVel.w;
    float sl = length(sv);
    vec2 sd = sl > 1e-5 ? sv / sl : vec2(0.0, 1.0);
    vec2 sn = vec2(sd.y, -sd.x);
    mvPosition.xy += sn * (q.x * sz) + sd * (q.y * (sz + sl));
  } else {
    float a = iData.y * 6.2831 + iData.x * (iData.y - 0.5) * 2.0;
    mvPosition.xy += mat2(cos(a), sin(a), -sin(a), cos(a)) * q * sz;
  }
  vUv = q;
  vData = iData;
  vZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D tNoise; uniform sampler2D tDepth; uniform vec4 uDepth; uniform float uSoft;
uniform vec3 uSunView; uniform vec3 uSunCol; uniform vec3 uAmb;
varying vec2 vUv;
varying vec4 vData;
varying float vZ;
#include <fog_pars_fragment>
float viewZ(float d) { return (uDepth.x * uDepth.y) / ((uDepth.y - uDepth.x) * d - uDepth.y); }
void main() {
  float t = vData.x, seed = vData.y, kind = vData.z, alpha = vData.w;
  float r = length(vUv);
  if (r > 1.0) discard;
  vec3 col; float a;
#ifdef ADDITIVE
  if (kind < 6.5) {
    float core = smoothstep(1.0, 0.0, abs(vUv.x)) * smoothstep(1.0, 0.3, abs(vUv.y));
    col = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.7, 0.35), 1.0 - t) * 10.0;
    a = core * (1.0 - t);
  } else if (kind < 7.5) {
    float n = texture2D(tNoise, vUv * 0.3 + seed + t * 0.4).r;
    float m = smoothstep(1.0, 0.1, r + (n - 0.5) * 0.8);
    col = mix(vec3(1.0, 0.9, 0.6) * 30.0, vec3(1.0, 0.25, 0.05) * 8.0, smoothstep(0.0, 0.7, t + r * 0.4));
    a = m * (1.0 - t);
  } else {
    col = vec3(1.0, 0.5, 0.2) * 3.0;
    a = exp(-r * r * 5.0) * (1.0 - t);
  }
  a *= alpha;
#else
  vec3 alb;
  if (kind < 0.5) alb = vec3(0.88, 0.88, 0.9);
  else if (kind < 1.5) alb = vec3(0.5, 0.4, 0.29);
  else if (kind < 2.5) alb = vec3(0.82, 0.86, 0.9);
  else if (kind < 3.5) alb = vec3(0.96, 0.97, 1.0);
  else if (kind < 4.5) alb = vec3(0.16, 0.13, 0.1);
  else if (kind < 5.5) alb = vec3(0.17, 0.27, 0.08);
  else if (kind < 9.5) alb = vec3(0.62, 0.58, 0.52);
  else alb = vec3(0.75, 0.8, 0.85);
  if (kind > 3.5 && kind < 5.5) {
    vec2 q = abs(vUv);
    a = step(max(q.x * (0.7 + seed * 0.6), q.y * (1.3 - seed * 0.6)) + texture2D(tNoise, vUv * 0.15 + seed * 3.0).a * 0.35, 0.85);
    col = alb * (uSunCol * 0.3 + uAmb);
  } else if (kind > 9.5) {
    a = smoothstep(1.0, 0.0, abs(vUv.x)) * smoothstep(1.0, 0.5, abs(vUv.y)) * 0.6;
    col = alb * (uSunCol * 0.4 + uAmb * 1.5);
  } else {
    vec2 nu = vUv * 0.22 + vec2(seed * 7.0, seed * 3.0) + vec2(t * 0.06, -t * 0.1);
    float n = texture2D(tNoise, nu).b * 0.65 + texture2D(tNoise, nu * 2.3).r * 0.35;
    float edge = r + (n - 0.5) * (0.9 + t * 0.6);
    a = smoothstep(1.0, 0.15, edge);
    vec3 nrm = normalize(vec3(vUv * 0.9 + (n - 0.5) * 0.6, sqrt(max(0.0, 1.0 - r * r)) + 0.2));
    float wrap = clamp(dot(nrm, uSunView) * 0.5 + 0.5, 0.0, 1.0);
    float self = mix(1.0, 0.55 + 0.45 * n, a);
    float back = pow(max(-uSunView.z, 0.0), 4.0) * (1.0 - a) * 0.6;
    col = alb * (uSunCol * (wrap * 0.75 + back) * 0.32 * self + uAmb * (0.8 + 0.4 * vUv.y));
  }
  a *= alpha;
#endif
  if (uSoft > 0.5) {
    float sz = -viewZ(texture2D(tDepth, gl_FragCoord.xy / uDepth.zw).r);
    a *= clamp((sz - vZ) / 0.6, 0.0, 1.0);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
#ifndef ADDITIVE
  #include <fog_fragment>
#endif
}`;

function createPool(max: number, additive: boolean, noise: THREE.Texture, base: THREE.BufferGeometry) {
  const px = new Float32Array(max), py = new Float32Array(max), pz = new Float32Array(max);
  const vx = new Float32Array(max), vy = new Float32Array(max), vz = new Float32Array(max);
  const size = new Float32Array(max), grow = new Float32Array(max), life = new Float32Array(max), age = new Float32Array(max);
  const kind = new Float32Array(max), seed = new Float32Array(max), drag = new Float32Array(max), grav = new Float32Array(max);
  const alpha = new Float32Array(max), floor = new Float32Array(max), stretch = new Float32Array(max);
  const posA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const velA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const datA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("iPos", posA);
  geo.setAttribute("iVel", velA);
  geo.setAttribute("iData", datA);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { tNoise: { value: noise }, uSunView: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uSoft: { value: 0 } },
    ]),
    defines: additive ? { ADDITIVE: 1 } : {},
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
  mat.uniforms.tDepth = LIGHT.tDepth;
  mat.uniforms.uDepth = LIGHT.depthInfo;
  mat.uniforms.uSoft = LIGHT.soft;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.fx);
  mesh.renderOrder = additive ? 21 : 20;
  let n = 0;
  let cap = max;

  return {
    mesh,
    mat,
    get count() {
      return n;
    },
    setCap(c: number) {
      cap = Math.min(max, c);
      n = Math.min(n, cap);
    },
    spawn(x: number, y: number, z: number, ux: number, uy: number, uz: number, s: number, g: number, l: number, k: number, d: number, gr: number, a: number, fl: number, st: number) {
      if (n >= cap) return;
      const i = n++;
      px[i] = x; py[i] = y; pz[i] = z; vx[i] = ux; vy[i] = uy; vz[i] = uz;
      size[i] = s; grow[i] = g; life[i] = l; age[i] = 0; kind[i] = k; seed[i] = Math.random(); drag[i] = d; grav[i] = gr;
      alpha[i] = a; floor[i] = fl; stretch[i] = st;
    },
    update(dt: number) {
      const P = posA.array as Float32Array, V = velA.array as Float32Array, D = datA.array as Float32Array;
      let i = 0;
      while (i < n) {
        age[i] += dt;
        if (age[i] >= life[i]) {
          const j = --n;
          px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
          size[i] = size[j]; grow[i] = grow[j]; life[i] = life[j]; age[i] = age[j]; kind[i] = kind[j]; seed[i] = seed[j];
          drag[i] = drag[j]; grav[i] = grav[j]; alpha[i] = alpha[j]; floor[i] = floor[j]; stretch[i] = stretch[j];
          continue;
        }
        const k = Math.exp(-drag[i] * dt);
        vx[i] *= k; vz[i] *= k;
        vy[i] = vy[i] * k - grav[i] * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        if (py[i] < floor[i]) {
          py[i] = floor[i];
          vy[i] = Math.abs(vy[i]) * 0.3;
          vx[i] *= 0.5; vz[i] *= 0.5;
        }
        const t = age[i] / life[i];
        size[i] += grow[i] * dt * (1 - t * 0.85);
        const o = i * 4;
        P[o] = px[i]; P[o + 1] = py[i]; P[o + 2] = pz[i]; P[o + 3] = size[i];
        V[o] = vx[i]; V[o + 1] = vy[i]; V[o + 2] = vz[i]; V[o + 3] = stretch[i];
        D[o] = t; D[o + 1] = seed[i]; D[o + 2] = kind[i];
        D[o + 3] = alpha[i] * Math.min(1, age[i] * 8) * (t > 0.4 ? 1 - (t - 0.4) / 0.6 : 1);
        i++;
      }
      geo.instanceCount = n;
      posA.needsUpdate = velA.needsUpdate = datA.needsUpdate = true;
      posA.clearUpdateRanges(); velA.clearUpdateRanges(); datA.clearUpdateRanges();
      posA.addUpdateRange(0, n * 4); velA.addUpdateRange(0, n * 4); datA.addUpdateRange(0, n * 4);
    },
    clear() {
      n = 0;
      geo.instanceCount = 0;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

const RATE: Record<Quality, number> = { low: 0.35, medium: 0.6, high: 1, ultra: 1.6 };
const SKID: Record<Quality, [number, number]> = { low: [512, 15], medium: [1024, 30], high: [2048, 45], ultra: [4096, 70] };
const KEYS = 64;
const PAVED: Record<Surface, boolean> = { asphalt: true, curb: true, cobble: true, grass: false, gravel: false, dirt: false, snow: false };
const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;

export function createFx(scene: THREE.Scene): Fx {
  patchFog();
  const noise = noiseTexture();
  const base = new THREE.PlaneGeometry(1, 1);
  const soft = createPool(6000, false, noise, base);
  const add = createPool(2000, true, noise, base);
  const skids = createSkids();
  const pools = [soft, add];
  const flashLight = new THREE.PointLight(0xff7a30, 0, 9, 2);
  scene.add(soft.mesh, add.mesh, skids.mesh, flashLight);
  const acc = new Float32Array(KEYS * 3);
  let rate = 1;
  let flash = 0;
  let lastDt = 1 / 60;
  const sunView = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const emit = (k: number, slot: number, perSec: number) => {
    const i = k * 3 + slot;
    acc[i] += perSec * lastDt * rate;
    const n = Math.floor(acc[i]);
    acc[i] -= n;
    return n;
  };

  const dust = (x: number, y: number, z: number, ux: number, uz: number, surface: Surface, a: number, big: number) => {
    const k = surface === "snow" ? 3 : surface === "gravel" ? 9 : surface === "grass" ? 1 : 1;
    soft.spawn(x + rnd(0.3), y + 0.2, z + rnd(0.3), ux * 0.3 + rnd(1.5), 0.6 + Math.random() * 1.2, uz * 0.3 + rnd(1.5), 0.5 * big, 1.6 * big, 2 + Math.random() * 2.5, k, 1.1, -0.05, a, y + 0.1, 0);
  };

  const fx: Fx = {
    tire(car, wheel, pos, vel, skid, surface, wet) {
      const k = (car * 4 + wheel) % KEYS;
      const sp = vel.length();
      const paved = PAVED[surface];
      if (paved) {
        const s = Math.max(0, skid - 0.15);
        const dry = 1 - Math.min(1, wet * 1.5);
        if (s > 0 && dry > 0) {
          const n = emit(k, 0, 70 * Math.pow(s, 1.3) * dry);
          for (let i = 0; i < n; i++) {
            soft.spawn(
              pos.x + rnd(0.2), pos.y + 0.15, pos.z + rnd(0.2),
              vel.x * 0.2 + rnd(1.2), 0.4 + Math.random() * 0.8, vel.z * 0.2 + rnd(1.2),
              0.35 + Math.random() * 0.3, 0.7 + s * 0.9, 2.5 + s * 3.5 + Math.random() * 1.5, KIND.smoke, 0.9, -0.12, 0.35 + 0.45 * s, pos.y + 0.1, 0,
            );
          }
        }
        if (wet > 0.2 && sp > 4) {
          const n = emit(k, 1, wet * sp * 2.2);
          for (let i = 0; i < n; i++) {
            soft.spawn(
              pos.x + rnd(0.15), pos.y + 0.1, pos.z + rnd(0.15),
              -vel.x * 0.08 + vel.x * 0.55 + rnd(1.5), 1.5 + Math.random() * 3, -vel.z * 0.08 + vel.z * 0.55 + rnd(1.5),
              0.025, 0, 0.35 + Math.random() * 0.3, KIND.drop, 0.4, 9.8, 0.7, pos.y - 0.5, 0.03,
            );
            if (i % 3 === 0)
              soft.spawn(pos.x, pos.y + 0.3, pos.z, vel.x * 0.5 + rnd(1), 0.8, vel.z * 0.5 + rnd(1), 0.4, 2.2, 0.9 + Math.random() * 0.5, KIND.mist, 2.5, -0.2, 0.18 * wet, pos.y, 0);
          }
        }
        skids.add(car, wheel, pos, skid > 0.3 ? Math.min(1, (skid - 0.3) * 2) * 0.9 : 0, 0.3);
      } else {
        const n = emit(k, 0, (sp * 0.6 + skid * 25) * (surface === "grass" ? 0.25 : 1) * (sp > 2 ? 1 : 0));
        for (let i = 0; i < n; i++) dust(pos.x, pos.y, pos.z, vel.x, vel.z, surface, 0.35 + skid * 0.3, surface === "snow" ? 0.8 : 1);
        const m = emit(k, 2, skid * sp * 1.2);
        for (let i = 0; i < m; i++) {
          const kk = surface === "grass" ? KIND.grass : surface === "snow" ? KIND.snow : KIND.chunk;
          soft.spawn(pos.x, pos.y + 0.1, pos.z, -vel.x * 0.15 + rnd(2), 1.5 + Math.random() * 3, -vel.z * 0.15 + rnd(2), 0.012 + Math.random() * 0.025, 0, 0.8 + Math.random(), kk, 0.3, 9.8, 1, pos.y + 0.02, 0);
        }
        skids.add(car, wheel, pos, skid > 0.25 || sp > 3 ? -Math.min(1, 0.25 + skid) * 0.6 : 0, 0.3);
      }
    },
    sparks(pos, dir, amount) {
      const n = Math.min(40, Math.round(amount * 14 * rate) + 1);
      for (let i = 0; i < n; i++) {
        const s = 4 + Math.random() * 10;
        add.spawn(pos.x, pos.y, pos.z, dir.x * s + rnd(3), dir.y * s + Math.random() * 3, dir.z * s + rnd(3), 0.025, 0, 0.25 + Math.random() * 0.45, KIND.spark, 0.5, 9.8, 1, pos.y - 0.4, 0.035);
      }
      add.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.5, 1, 0.1, KIND.glow, 0, 0, Math.min(1, amount), -1e9, 0);
    },
    backfire(pos, dir) {
      const n = Math.round(8 * Math.max(0.5, rate));
      for (let i = 0; i < n; i++) {
        const s = 5 + Math.random() * 6;
        add.spawn(pos.x, pos.y, pos.z, dir.x * s + rnd(1), dir.y * s + rnd(1), dir.z * s + rnd(1), 0.05 + Math.random() * 0.07, 1.4, 0.06 + Math.random() * 0.08, KIND.flame, 6, -1, 1, -1e9, 0);
      }
      add.spawn(pos.x + dir.x * 0.25, pos.y, pos.z + dir.z * 0.25, 0, 0, 0, 0.3, 1.2, 0.1, KIND.glow, 0, 0, 0.8, -1e9, 0);
      soft.spawn(pos.x, pos.y, pos.z, dir.x * 2, 0.3, dir.z * 2, 0.15, 0.8, 1.2, KIND.smoke, 2, -0.2, 0.25, pos.y - 0.3, 0);
      flashLight.position.copy(tmp.copy(pos).addScaledVector(dir, 0.4));
      flash = 1;
    },
    debris(pos, amount, surface) {
      const n = Math.min(60, Math.round(amount * 24 * rate) + 2);
      const kk = surface === "grass" ? KIND.grass : surface === "snow" ? KIND.snow : KIND.chunk;
      for (let i = 0; i < n; i++)
        soft.spawn(pos.x, pos.y, pos.z, rnd(4), 2 + Math.random() * 5, rnd(4), 0.015 + Math.random() * 0.035, 0, 1 + Math.random() * 1.2, kk, 0.2, 9.8, 1, pos.y - 0.6, 0);
      for (let i = 0; i < Math.ceil(n / 5); i++) dust(pos.x, pos.y, pos.z, 0, 0, PAVED[surface] ? "gravel" : surface, 0.45, 1.2);
    },
    update(dt, camera) {
      lastDt = Math.min(dt, 0.1) || 1 / 60;
      soft.update(dt);
      add.update(dt);
      skids.update(dt);
      sunView.copy(LIGHT.sunDir.value).transformDirection(camera.matrixWorldInverse);
      for (const p of pools) {
        const u = p.mat.uniforms;
        u.uSunView.value.copy(sunView);
        u.uSunCol.value.copy(LIGHT.sunColor.value);
        u.uAmb.value.copy(LIGHT.ambient.value);
      }
      flash = Math.max(0, flash - dt * 14);
      flashLight.intensity = flash * flash * 60;
    },
    setQuality(q) {
      const b = QUALITY[q].particles;
      soft.setCap(b);
      add.setCap(Math.max(150, Math.round(b / 3)));
      rate = RATE[q];
      skids.setBudget(...SKID[q]);
      flashLight.visible = q !== "low";
    },
    clear() {
      soft.clear();
      add.clear();
      skids.clear();
      acc.fill(0);
    },
    dispose() {
      scene.remove(soft.mesh, add.mesh, skids.mesh, flashLight);
      soft.dispose();
      add.dispose();
      skids.dispose();
      base.dispose();
      flashLight.dispose();
      releaseNoise();
    },
  };
  fx.setQuality("medium");
  return fx;
}
