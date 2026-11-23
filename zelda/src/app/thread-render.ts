import * as THREE from "three";
import type { Look, V3 } from "./contracts";

// All Thread lines, the held line, the aim preview and the aim rings share ONE camera-facing ribbon mesh: one draw call.

export const STYLE = {
  line: 0,
  preview: 1, // dotted
  previewBad: 2, // dotted grey
  ring: 3,
  ringBad: 4,
  held: 5, // faint, Tallow to a pinned end 1
} as const;

const SEG = 24;
const SLOTS = 12; // wickMax lines + held + preview + 2 rings, with spare
const PTS = SEG + 1;
const VERTS = SLOTS * PTS * 2;

const VERT = /* glsl */ `
attribute vec3 aTan;
attribute vec4 aData; // side (-1/1), u along the strand 0..1, strand length m, style
attribute vec4 aInfo; // fire front 0..1, alpha, seed, burning 0/1
uniform float uWidthScale;
varying vec2 vUv;
varying float vLen;
varying float vStyle;
varying vec4 vInfo;
varying float vDepth;
void main() {
  vec3 p = position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 tv = normalize((modelViewMatrix * vec4(aTan, 0.0)).xyz + vec3(1e-5));
  vec3 side = normalize(cross(tv, normalize(mv.xyz)) + vec3(0.0, 1e-5, 0.0));
  float st = aData.w;
  float w = st < 0.5 ? 0.095 : st < 2.5 ? 0.05 : st < 4.5 ? 0.06 : 0.035;
  w *= 1.0 + aInfo.w * 0.7;
  // never thinner than ~2 px (lines) / ~1.5 px (the rest), so distant lines do not shimmer away
  w = max(w, -mv.z * (st < 0.5 ? 0.003 : 0.0022)) * uWidthScale;
  mv.xyz += side * aData.x * w;
  vUv = vec2(aData.y, aData.x);
  vLen = aData.z;
  vStyle = st;
  vInfo = aInfo;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uBright;
uniform float uGloam;
uniform float uDay;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying float vLen;
varying float vStyle;
varying vec4 vInfo;
varying float vDepth;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float v = vUv.y;
  float core = exp(-v * v * 9.0);
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(v));
  float u = vUv.x;
  float st = vStyle;
  vec3 gold = vec3(1.0, 0.70, 0.28);
  vec3 hot = vec3(1.0, 0.93, 0.72);
  vec3 col;
  float a;
  if (st < 0.5 || st > 4.5) {
    float seed = vInfo.z;
    float flick = 0.82 + 0.18 * sin(uTime * 23.0 + u * 31.0 + seed) * sin(uTime * 7.3 + u * 11.0 + seed * 2.0);
    float burn = max(vInfo.w, step(u, vInfo.x));
    vec3 c = mix(gold, hot, core * 0.85);
    vec3 violet = vec3(0.62, 0.36, 0.95);
    c = mix(c, violet * 1.6, uGloam * core * (1.0 - burn));
    vec3 fire = mix(vec3(1.0, 0.42, 0.10), vec3(1.0, 0.85, 0.5), core);
    float lick = 0.6 + 0.4 * hash(floor(u * vLen * 6.0 - uTime * 14.0) + seed);
    c = mix(c, fire * (1.2 + lick), burn);
    float front = vInfo.x > 0.0 && vInfo.x < 1.0 ? exp(-abs(u - vInfo.x) * vLen * 2.0) : 0.0;
    c += hot * front * 3.0;
    col = c * (1.6 + 0.6 * burn) * uBright * flick;
    a = (core * 0.95 + edge * 0.35) * (st > 4.5 ? 0.45 : 1.0);
  } else if (st < 2.5) {
    float dots = step(0.45, fract(u * vLen * 2.2 - uTime * 2.4));
    col = st < 1.5 ? gold * 1.5 * uBright : vec3(0.55, 0.55, 0.58);
    a = dots * (core * 0.8 + edge * 0.3);
  } else {
    float pulse = 0.75 + 0.25 * sin(uTime * 8.0);
    col = st < 3.5 ? gold * 2.0 * uBright * pulse : vec3(0.55, 0.55, 0.58);
    a = core * 0.8 + edge * 0.3;
  }
  // fade out right at the lens (a ride line passes over the chase camera) and in the fog
  float fog = (1.0 - smoothstep(uFogNear, uFogFar, vDepth)) * smoothstep(1.0, 4.5, vDepth);
  // In daylight a glow alone vanishes on bright ground and sky: the ribbon also dims what is behind it (a dark rim
  // around a bright core), so it reads without pushing the core into bloom.
  float occ = uDay * 0.6 * edge * min(1.0, a * 2.5) * (st > 4.5 ? 0.5 : 1.0);
  a *= vInfo.y * fog;
  occ *= vInfo.y * fog;
  gl_FragColor = vec4(col * a, occ);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface ThreadRender {
  readonly mesh: THREE.Mesh;
  /** `day` 0..1: how much the ribbon dims what is behind it, so lines read against bright daylight. */
  begin(camera: THREE.Camera, bright: number, gloam: number, day?: number): void;
  /** A sagging strand from a to b. `mid` (optional) pins the strand through a rider point instead of sagging. */
  strand(a: V3, b: V3, sag: number, style: number, alpha: number, fire: number, burning: boolean, seed: number, mid?: V3 | null): void;
  ring(c: V3, radius: number, style: number, alpha: number): void;
  end(): void;
  readonly used: number;
  dispose(): void;
}

export function createThreadRender(look: Look): ThreadRender {
  const pos = new Float32Array(VERTS * 3);
  const tan = new Float32Array(VERTS * 3);
  const data = new Float32Array(VERTS * 4);
  const info = new Float32Array(VERTS * 4);
  const idx = new Uint16Array(SLOTS * SEG * 6);
  for (let s = 0, k = 0; s < SLOTS; s++) {
    for (let i = 0; i < SEG; i++) {
      const v = (s * PTS + i) * 2;
      idx[k++] = v; idx[k++] = v + 1; idx[k++] = v + 2;
      idx[k++] = v + 2; idx[k++] = v + 1; idx[k++] = v + 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aTan = new THREE.BufferAttribute(tan, 3).setUsage(THREE.DynamicDrawUsage);
  const aData = new THREE.BufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage);
  const aInfo = new THREE.BufferAttribute(info, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", aPos);
  geo.setAttribute("aTan", aTan);
  geo.setAttribute("aData", aData);
  geo.setAttribute("aInfo", aInfo);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);

  const u = look.uniforms;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: u.uTime,
      uFogNear: u.uFogNear,
      uFogFar: u.uFogFar,
      uBright: { value: 1 },
      uGloam: { value: 0 },
      uDay: { value: 0 },
      uWidthScale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor, // premultiplied: alpha dims the background (daylight rim), rgb adds glow
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.name = "thread-lines";

  let n = 0;
  const camR = new THREE.Vector3();
  const camU = new THREE.Vector3();

  const put = (s: number, i: number, x: number, y: number, z: number, tx: number, ty: number, tz: number,
    uu: number, len: number, style: number, fire: number, alpha: number, seed: number, burn: number) => {
    for (let side = 0; side < 2; side++) {
      const v = (s * PTS + i) * 2 + side;
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      tan[v * 3] = tx; tan[v * 3 + 1] = ty; tan[v * 3 + 2] = tz;
      data[v * 4] = side === 0 ? -1 : 1; data[v * 4 + 1] = uu; data[v * 4 + 2] = len; data[v * 4 + 3] = style;
      info[v * 4] = fire; info[v * 4 + 1] = alpha; info[v * 4 + 2] = seed; info[v * 4 + 3] = burn;
    }
  };

  return {
    mesh,
    get used() { return n; },
    begin(camera, bright, gloam, day = 0) {
      n = 0;
      camera.updateMatrixWorld();
      camR.setFromMatrixColumn(camera.matrixWorld, 0);
      camU.setFromMatrixColumn(camera.matrixWorld, 1);
      mat.uniforms.uBright.value = bright;
      mat.uniforms.uGloam.value = gloam;
      mat.uniforms.uDay.value = day;
    },
    strand(a, b, sag, style, alpha, fire, burning, seed, mid) {
      if (n >= SLOTS) return;
      const s = n++;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const burn = burning ? 1 : 0;
      let mu = 0.5;
      if (mid) {
        const l2 = len * len;
        mu = l2 > 1e-6 ? Math.min(0.98, Math.max(0.02, ((mid.x - a.x) * dx + (mid.y - a.y) * dy + (mid.z - a.z) * dz) / l2)) : 0.5;
      }
      let px = a.x, py = a.y, pz = a.z;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        let x: number, y: number, z: number;
        if (mid) {
          const k = t <= mu ? t / mu : (1 - t) / (1 - mu);
          const ox = t <= mu ? a.x : b.x, oy = t <= mu ? a.y : b.y, oz = t <= mu ? a.z : b.z;
          const bend = 1 - (1 - k) * (1 - k);
          x = ox + (mid.x - ox) * k;
          z = oz + (mid.z - oz) * k;
          y = oy + (mid.y - oy) * (0.85 * k + 0.15 * bend);
        } else {
          x = a.x + dx * t; z = a.z + dz * t;
          y = a.y + dy * t - sag * 4 * t * (1 - t);
        }
        let tx = x - px, ty = y - py, tz = z - pz;
        if (i === 0) { tx = dx; ty = dy - sag * 4; tz = dz; }
        put(s, i, x, y, z, tx, ty, tz, t, len, style, fire, alpha, seed, burn);
        px = x; py = y; pz = z;
      }
    },
    ring(c, radius, style, alpha) {
      if (n >= SLOTS) return;
      const s = n++;
      const len = Math.PI * 2 * radius;
      for (let i = 0; i <= SEG; i++) {
        const th = (i / SEG) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        const x = c.x + (camR.x * cs + camU.x * sn) * radius;
        const y = c.y + (camR.y * cs + camU.y * sn) * radius;
        const z = c.z + (camR.z * cs + camU.z * sn) * radius;
        const tx = -camR.x * sn + camU.x * cs, ty = -camR.y * sn + camU.y * cs, tz = -camR.z * sn + camU.z * cs;
        put(s, i, x, y, z, tx, ty, tz, i / SEG, len, style, 0, alpha, 0, 0);
      }
    },
    end() {
      geo.setDrawRange(0, n * SEG * 6);
      if (n > 0) {
        const verts = n * PTS * 2;
        aPos.clearUpdateRanges(); aPos.addUpdateRange(0, verts * 3); aPos.needsUpdate = true;
        aTan.clearUpdateRanges(); aTan.addUpdateRange(0, verts * 3); aTan.needsUpdate = true;
        aData.clearUpdateRanges(); aData.addUpdateRange(0, verts * 4); aData.needsUpdate = true;
        aInfo.clearUpdateRanges(); aInfo.addUpdateRange(0, verts * 4); aInfo.needsUpdate = true;
      }
      mesh.visible = n > 0;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
