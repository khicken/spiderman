import * as THREE from "three";

// Street and tunnel lamps light every lit material through one shared uniform array: the N lamps nearest the view.
// Typed arrays stay shared by reference when three clones uniforms, so one write per frame reaches all materials.
const N = 32;
const data = new Float32Array(N * 8); // per lamp: x, y, z, range | r, g, b, 0 (color × intensity)
const cfg = new Float32Array([0, 0, 0, 0]); // count
let cap = 24;

export function patchLamps() {
  const C = THREE.ShaderChunk;
  if (C.lights_pars_begin.includes("uLamps")) return;
  const extra = { uLamps: { value: data }, uLampCfg: { value: cfg } };
  Object.assign(THREE.UniformsLib.lights, extra);
  for (const sh of Object.values(THREE.ShaderLib)) if ("directionalLights" in sh.uniforms) Object.assign(sh.uniforms, extra);
  C.lights_pars_begin += `\nuniform vec4 uLamps[${N * 2}];\nuniform vec4 uLampCfg;\n`;
  C.lights_fragment_begin += /* glsl */ `
{
  int lampN = int(uLampCfg.x);
  if (lampN > 0) {
    mat3 lampR = mat3(viewMatrix);
    vec3 lampW = transpose(lampR) * (geometryPosition - viewMatrix[3].xyz);
    for (int k = 0; k < ${N}; k++) {
      if (k >= lampN) break;
      vec4 la = uLamps[k * 2];
      vec3 lv = la.xyz - lampW;
      float d2 = dot(lv, lv);
      if (d2 > la.w * la.w) continue;
      float d = sqrt(d2);
      vec3 ld = lv / d;
      float win = 1.0 - d2 * d2 / (la.w * la.w * la.w * la.w);
      float lobe = smoothstep(0.45, 0.97, ld.y);
      lobe *= lobe;
      IncidentLight lampL;
      lampL.direction = lampR * ld;
      lampL.color = uLamps[k * 2 + 1].rgb * (lobe * win * win / max(d2, 1.0));
      lampL.visible = true;
      RE_Direct(lampL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    }
  }
}
`;
}

type Set = { pts: Float32Array; night: boolean }; // pts: x, y, z, range, r, g, b, intensity
const sets = new Map<string, Set>();
const best = new Float32Array(N + 1);
const bestI = new Int32Array(N + 1);
const bestS: (Set | null)[] = new Array(N + 1).fill(null);
const at = new THREE.Vector3();
const dir = new THREE.Vector3();
const dbg = { freeze: false };
let lastX = 1e9, lastZ = 1e9, lastNight = -1;

// night: true for street lamps that switch on with the dark, false for tunnel lights that are always on.
export function setLamps(tag: string, pts: Float32Array | null, night: boolean) {
  if (pts && pts.length) sets.set(tag, { pts, night });
  else sets.delete(tag);
  lastX = 1e9;
}

// Removes a set only while it is still the registered one, so a rebuilt owner keeps its new lamps.
export function dropLamps(tag: string, pts: Float32Array) {
  if (sets.get(tag)?.pts === pts) setLamps(tag, null, true);
}

export function setLampCap(n: number) {
  cap = Math.max(0, Math.min(N, n));
  lastX = 1e9;
}

// Picks the lamps nearest a point 30 m ahead of the camera. Lamps near the cut fade out, so nothing pops.
export function updateLamps(camera: THREE.Camera, night: number) {
  if (dbg.freeze) return;
  camera.getWorldDirection(dir);
  at.copy(camera.position).addScaledVector(dir, 30);
  if (Math.abs(at.x - lastX) + Math.abs(at.z - lastZ) < 1.5 && Math.abs(night - lastNight) < 0.01) return;
  lastX = at.x;
  lastZ = at.z;
  lastNight = night;
  const want = cap + 1;
  let n = 0;
  for (const st of sets.values()) {
    if (st.night && night < 0.02) continue;
    const p = st.pts;
    for (let i = 0; i < p.length; i += 8) {
      const dx = p[i] - at.x, dy = p[i + 1] - at.y, dz = p[i + 2] - at.z;
      const d = dx * dx + dy * dy * 4 + dz * dz + (dy < -3 ? 1600 : 0);
      if (n === want && d >= best[n - 1]) continue;
      let j = n < want ? n++ : n - 1;
      while (j > 0 && best[j - 1] > d) {
        best[j] = best[j - 1];
        bestI[j] = bestI[j - 1];
        bestS[j] = bestS[j - 1];
        j--;
      }
      best[j] = d;
      bestI[j] = i;
      bestS[j] = st;
    }
  }
  const used = Math.min(n, cap);
  const edge = n > cap ? Math.sqrt(best[cap]) : 1e9;
  for (let k = 0; k < used; k++) {
    const st = bestS[k]!, p = st.pts, i = bestI[k];
    const fade = (1 - THREE.MathUtils.smoothstep(Math.sqrt(best[k]), edge * 0.75, edge)) * (st.night ? THREE.MathUtils.smoothstep(night, 0.02, 0.6) : 1);
    const o = k * 8;
    data[o] = p[i];
    data[o + 1] = p[i + 1];
    data[o + 2] = p[i + 2];
    data[o + 3] = p[i + 3];
    data[o + 4] = p[i + 4] * p[i + 7] * fade;
    data[o + 5] = p[i + 5] * p[i + 7] * fade;
    data[o + 6] = p[i + 6] * p[i + 7] * fade;
  }
  cfg[0] = used;
}
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __lamps: unknown }).__lamps = { data, cfg, sets, setLampCap, dbg };
