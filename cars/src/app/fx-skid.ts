import * as THREE from "three";

const MAX = 4096;
const KEYS = 64;

const VERT = /* glsl */ `
attribute vec3 aInfo;
uniform float uTime; uniform float uFade;
varying vec3 vInfo; varying float vAge;
#include <fog_pars_vertex>
void main() {
  vInfo = aInfo;
  vAge = (uTime - aInfo.z) / uFade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform vec3 uRubber; uniform vec3 uRut;
varying vec3 vInfo; varying float vAge;
#include <fog_pars_fragment>
void main() {
  float k = abs(vInfo.x) * (1.0 - smoothstep(0.4, 1.0, vAge)) * smoothstep(1.0, 0.35, abs(vInfo.y)) * (0.75 + 0.25 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5));
  if (k < 0.01) discard;
  vec3 col = mix(uRubber, uRut, step(vInfo.x, 0.0));
  gl_FragColor = vec4(col, min(k, 0.85));
  #include <fog_fragment>
}`;

// Rut marks on loose surfaces store a negative strength.
export function createSkids() {
  const pos = new Float32Array(MAX * 4 * 3);
  const info = new Float32Array(MAX * 4 * 3).fill(-1e6);
  for (let i = 0; i < MAX * 4; i++) info[i * 3] = 0;
  const idx = new Uint32Array(MAX * 6);
  for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const ia = new THREE.BufferAttribute(info, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pa);
  geo.setAttribute("aInfo", ia);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uFade: { value: 40 }, uRubber: { value: new THREE.Color(0.012, 0.012, 0.013) }, uRut: { value: new THREE.Color(0.09, 0.07, 0.05) } },
    ]),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    fog: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  const last = Array.from({ length: KEYS }, () => new THREE.Vector3());
  const live = new Uint8Array(KEYS);
  const lastL = new Float32Array(KEYS * 2);
  let head = 0;
  let cap = 1024;
  let time = 0;
  let lo = Infinity, hi = -1;

  const put = (o: number, px: number, py: number, pz: number, side: number, strength: number) => {
    pos[o] = px;
    pos[o + 1] = py + 0.02;
    pos[o + 2] = pz;
    info[o] = strength;
    info[o + 1] = side;
    info[o + 2] = time;
  };
  const quad = (k: number, x: number, y: number, z: number, w: number, strength: number) => {
    const a = last[k];
    const dx = x - a.x, dz = z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = (-dz / len) * w * 0.5, sz = (dx / len) * w * 0.5;
    const i = head;
    head = (head + 1) % cap;
    const o = i * 12;
    const ax = lastL[k * 2] || sx, az = lastL[k * 2 + 1] || sz;
    put(o + 0, a.x + ax, a.y, a.z + az, 1, strength);
    put(o + 3, a.x - ax, a.y, a.z - az, -1, strength);
    put(o + 6, x + sx, y, z + sz, 1, strength);
    put(o + 9, x - sx, y, z - sz, -1, strength);
    lastL[k * 2] = sx;
    lastL[k * 2 + 1] = sz;
    lo = Math.min(lo, i);
    hi = Math.max(hi, i);
  };

  return {
    mesh,
    add(car: number, wheel: number, p: THREE.Vector3, strength: number, width: number) {
      const k = (car * 4 + wheel) % KEYS;
      if (strength === 0) {
        live[k] = 0;
        return;
      }
      if (!live[k] || last[k].distanceToSquared(p) > 9) {
        live[k] = 1;
        last[k].copy(p);
        lastL[k * 2] = lastL[k * 2 + 1] = 0;
        return;
      }
      if (last[k].distanceToSquared(p) < 0.09) return;
      quad(k, p.x, p.y, p.z, width, strength);
      last[k].copy(p);
    },
    update(dt: number) {
      time += dt;
      mat.uniforms.uTime.value = time;
      if (hi < 0) return;
      pa.clearUpdateRanges();
      ia.clearUpdateRanges();
      pa.addUpdateRange(lo * 12, (hi - lo + 1) * 12);
      ia.addUpdateRange(lo * 12, (hi - lo + 1) * 12);
      pa.needsUpdate = ia.needsUpdate = true;
      lo = Infinity;
      hi = -1;
    },
    setBudget(n: number, fade: number) {
      cap = Math.min(MAX, n);
      head %= cap;
      mat.uniforms.uFade.value = fade;
      geo.setDrawRange(0, cap * 6);
    },
    clear() {
      for (let i = 0; i < MAX * 4; i++) info[i * 3] = 0;
      live.fill(0);
      lo = 0;
      hi = MAX - 1;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
