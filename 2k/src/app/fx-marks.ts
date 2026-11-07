// HOOPS fx: in-world indicators drawn as flat decals in one instanced draw call.
// user ring + stamina arc, pass target, icon-pass rings, defensive mark ring, rim glow while gathering a shot.
// Owner: audio-fx.
import * as THREE from "three";
import type { Indicators, SimView } from "./contracts";
import { COURT } from "./contracts";

const MAX = 10;
const T = { user: 0, pass: 1, icon: 2, mark: 3, rim: 4, ball: 5 } as const;
// icon glyph colors, in pick order 0..3 (A, B, X, Y / 1..4)
const ICON_COLORS = ["#3ddc84", "#ff4d5e", "#3fa9ff", "#ffc93c"];

const VERT = /* glsl */ `
attribute vec4 iPos;  // xyz, radius
attribute vec4 iCol;  // rgb, alpha
attribute vec4 iData; // type, param, yaw, pulse phase
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vData;
void main() {
  vec2 q = position.xy * 2.0;
  vUv = q;
  vCol = iCol;
  vData = iData;
  float c = cos(iData.z), s = sin(iData.z);
  vec2 rq = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * iPos.w;
  vec3 w = iPos.xyz + vec3(rq.x, 0.0, rq.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vData;
float ring(float r, float c, float w) { return smoothstep(w, 0.0, abs(r - c)); }
void main() {
  float type = vData.x, param = vData.y;
  float r = length(vUv);
  if (r > 1.0) discard;
  float ang = atan(vUv.x, -vUv.y); // 0 at the back, +-pi at the front
  vec3 col = vCol.rgb;
  float a = 0.0;
  float glow = 0.0;
  float pulse = 0.5 + 0.5 * sin(uTime * 5.0 + vData.w);
  if (type < 0.5) {
    // user: bright ring, soft inner disc, rotating ticks, stamina arc on the outside
    a = ring(r, 0.74, 0.07) + 0.12 * smoothstep(0.74, 0.0, r);
    float ticks = step(0.82, fract((ang / 6.2831) * 12.0 + uTime * 0.25)) * ring(r, 0.74, 0.11);
    a += ticks * 0.5;
    glow = ring(r, 0.74, 0.25) * 0.5;
    float frac = abs(ang) / 3.14159;
    float st = step(frac, param) * ring(r, 0.92, 0.045);
    vec3 stc = mix(vec3(1.0, 0.25, 0.2), mix(vec3(1.0, 0.8, 0.2), vec3(0.35, 1.0, 0.55), smoothstep(0.4, 0.75, param)), smoothstep(0.15, 0.4, param));
    float bg = ring(r, 0.92, 0.045) * 0.25;
    col = mix(col, stc, clamp(st * 2.0, 0.0, 1.0));
    a = max(a, st + bg);
  } else if (type < 1.5) {
    // pass target: thin ring with 3 inward chevrons
    a = ring(r, 0.8, 0.06) * 0.85;
    float k = fract(ang / 6.2831 * 3.0 + uTime * 0.4);
    float chev = step(abs(k - 0.5), 0.07) * step(0.5, r) * step(r, 0.72);
    a = max(a, chev);
    glow = ring(r, 0.8, 0.2) * 0.4;
  } else if (type < 2.5) {
    // icon pass ring, pulsing
    a = ring(r, 0.78, 0.09) * (0.7 + 0.3 * pulse) + 0.18 * smoothstep(0.78, 0.0, r);
    glow = ring(r, 0.78, 0.3) * (0.4 + 0.4 * pulse);
  } else if (type < 3.5) {
    // mark: dashed ring
    float dash = step(0.45, fract(ang / 6.2831 * 16.0 - uTime * 0.6));
    a = ring(r, 0.8, 0.05) * dash * 0.7;
  } else if (type < 4.5) {
    // rim glow while a shot gathers: hot ring on the rim plus a halo
    a = ring(r, 0.5, 0.05) * (0.6 + 0.4 * pulse);
    glow = ring(r, 0.5, 0.45) * (0.5 + 0.5 * pulse);
  } else {
    // ball shadow-glow under the handler (subtle)
    a = smoothstep(1.0, 0.0, r) * 0.25;
  }
  a *= vCol.a;
  glow *= vCol.a;
  vec3 outc = col * a + col * glow * 1.4;
  float outa = clamp(a, 0.0, 1.0) * 0.85;
  if (outa + glow < 0.003) discard;
  gl_FragColor = vec4(outc, outa);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createMarks(scene: THREE.Scene) {
  const posA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const colA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const datA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("iPos", posA);
  geo.setAttribute("iCol", colA);
  geo.setAttribute("iData", datA);
  geo.instanceCount = 0;
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 25;
  mesh.name = "fx-marks";
  scene.add(mesh);

  const colCache = new Map<string, THREE.Color>();
  const color = (hex: string) => {
    let c = colCache.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      // floor rings must read on light maple: lift very dark team colors
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      if (hsl.l < 0.42) c.setHSL(hsl.h, Math.max(hsl.s, 0.6), 0.5);
      colCache.set(hex, c);
    }
    return c;
  };
  const white = new THREE.Color(1, 1, 1);
  const rimC = new THREE.Color("#ff7a2e");

  // smoothed visibility per instance role so rings fade instead of popping
  const vis = new Float32Array(MAX);
  const want = new Uint8Array(MAX);
  let n = 0;
  let time = 0;

  function put(i: number, x: number, y: number, z: number, r: number, c: THREE.Color, a: number, type: number, param: number, yaw: number) {
    const o = n * 4;
    const P = posA.array as Float32Array, C = colA.array as Float32Array, D = datA.array as Float32Array;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = r;
    C[o] = c.r; C[o + 1] = c.g; C[o + 2] = c.b; C[o + 3] = a;
    D[o] = type; D[o + 1] = param; D[o + 2] = yaw; D[o + 3] = i * 1.7;
    n++;
  }

  return {
    update(dt: number, view: SimView | null, ind: Indicators) {
      time += dt;
      uniforms.uTime.value = time;
      n = 0;
      if (!view) {
        geo.instanceCount = 0;
        return;
      }
      const k = 1 - Math.exp(-dt * 12);
      // role 0 user, 1 pass target, 2..5 icons, 6 mark, 7 rim
      want[0] = ind.user >= 0 ? 1 : 0;
      want[1] = ind.passTarget >= 0 && !ind.icons ? 1 : 0;
      want[2] = want[3] = want[4] = want[5] = ind.icons ? 1 : 0;
      want[6] = ind.mark >= 0 ? 1 : 0;
      want[7] = ind.shotTarget !== 0 ? 1 : 0;
      for (let i = 0; i < 8; i++) vis[i] += (want[i] - vis[i]) * k;
      const Y = 0.012;
      if (ind.user >= 0 && ind.user < view.players.length) {
        const p = view.players[ind.user];
        put(0, p.pos.x, Y, p.pos.z, 0.62 + p.radius * 0.4, color(ind.userColor), vis[0], T.user, p.stamina, p.facing);
      }
      if (vis[1] > 0.01 && ind.passTarget >= 0 && ind.passTarget < view.players.length) {
        const p = view.players[ind.passTarget];
        put(1, p.pos.x, Y, p.pos.z, 0.55, white, vis[1] * 0.9, T.pass, 0, time * 0.5);
      }
      if (ind.icons || vis[2] > 0.01) {
        const us = ind.user >= 0 ? ind.user : 0;
        const baseSlot = us < 5 ? 0 : 5;
        let j = 0;
        for (let s = baseSlot; s < baseSlot + 5 && j < 4; s++) {
          if (s === us) continue;
          const p = view.players[s];
          if (p) put(2 + j, p.pos.x, Y, p.pos.z, 0.58, color(ICON_COLORS[j]), vis[2 + j], T.icon, 0, 0);
          j++;
        }
      }
      if (vis[6] > 0.01 && ind.mark >= 0 && ind.mark < view.players.length) {
        const p = view.players[ind.mark];
        put(6, p.pos.x, Y, p.pos.z, 0.6, white, vis[6] * 0.6, T.mark, 0, 0);
      }
      if (vis[7] > 0.01 && ind.shotTarget !== 0) {
        put(7, ind.shotTarget * COURT.rimX, COURT.rimHeight + 0.005, 0, COURT.rimRadius * 2.4, rimC, vis[7], T.rim, 0, 0);
      }
      geo.instanceCount = n;
      if (n) posA.needsUpdate = colA.needsUpdate = datA.needsUpdate = true;
    },
    clear() {
      n = 0;
      geo.instanceCount = 0;
      vis.fill(0);
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      base.dispose();
      mat.dispose();
    },
  };
}
export type Marks = ReturnType<typeof createMarks>;
