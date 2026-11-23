import * as THREE from "three";
import { FOREST, LANDMARKS } from "./contracts";
import type { Palette } from "./render-env";

// Geometry light shafts: thin additive gradient ribbons slanted along the sun (or the moon at night), recycled around
// the camera and kept to places that have canopy: Whisperwood, the shrine and the Glade. One instanced draw.
// The mesh is a child of the sky dome (world matrix pinned to identity by update), so no one has to add it.

const VERT = /* glsl */ `
attribute vec4 aBase;  // base xyz (on the ground), seed
attribute vec4 aShape; // rise (m), half-width, strength, unused
uniform vec3 uAxis; uniform float uTime;
varying vec2 vUv; varying float vK; varying float vSeed; varying vec3 vWp;
void main() {
  vec3 base = aBase.xyz;
  vec3 top = base + uAxis * aShape.x; // uAxis has y = 1: aShape.x is the vertical rise
  vec3 mid = (base + top) * 0.5;
  vec3 ax = normalize(uAxis);
  vec3 toCam = normalize(cameraPosition - mid);
  vec3 side = cross(ax, toCam);
  float sl = length(side);
  side = side / max(sl, 1e-3);
  vec3 wp = mix(base, top, position.y * 0.5 + 0.5) + side * position.x * aShape.y;
  vUv = vec2(position.x, position.y * 0.5 + 0.5);
  vSeed = aBase.w;
  vWp = wp;
  // looking along the beam stacks the whole ribbon into one bright wedge: fade it well before it goes end-on
  float along = smoothstep(0.4, 0.8, sl);
  // camera inside or right beside the beam: fade the whole ribbon (distance from the camera to the beam's axis)
  vec3 rel = cameraPosition - base;
  float t = clamp(dot(rel, ax), 0.0, length(top - base));
  float axisD = length(rel - ax * t);
  float inside = smoothstep(aShape.y * 1.5 + 1.5, aShape.y * 3.0 + 7.0, axisD);
  // facing the sun, every ribbon in view is backlit and they stack into one glare sheet (worst with bloom on)
  vec2 vh = mid.xz - cameraPosition.xz;
  float toSun = dot(vh / max(length(vh), 1e-3), normalize(ax.xz + vec2(1e-4)));
  float back = 1.0 - 0.6 * smoothstep(0.1, 0.85, toSun);
  vK = aShape.z * along * inside * back;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uPower; uniform float uFogFar;
varying vec2 vUv; varying float vK; varying float vSeed; varying vec3 vWp;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  across *= across;
  // soft where it meets the ground, fading out toward the canopy
  float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  // dapple: slow bands sliding down the beam, so it breathes like light through moving leaves
  float dap = 0.55 + 0.45 * noise(vec2(vUv.x * 2.0 + vSeed * 40.0, vUv.y * 3.5 - uTime * 0.18 + vSeed * 9.0));
  float d = distance(cameraPosition, vWp);
  float nearF = smoothstep(6.0, 20.0, d);
  float farF = 1.0 - smoothstep(uFogFar * 0.18, uFogFar * 0.4, d);
  float a = across * along * dap * vK * nearF * farF * uPower;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

export interface Shafts {
  readonly mesh: THREE.Mesh;
  setLow(low: boolean): void;
  update(cam: THREE.Vector3, pal: Palette, sunDir: THREE.Vector3, daylight: number, rain: number, time: number, fogFar: number): void;
  dispose(): void;
}

const SHRINE = LANDMARKS.find((l) => l.id === "shrine")!;
const GLADE = LANDMARKS.find((l) => l.id === "beacon-glade")!;
const NEAR = 46;

// Terrain height for shaft bases; render.ts hands it the world each frame. Without it the bases sit under the camera.
let groundAt: ((x: number, z: number) => number) | null = null;
export function setShaftGround(fn: ((x: number, z: number) => number) | null): void {
  groundAt = fn;
}

function canopy(x: number, z: number): number {
  if (Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r - 8) return 1;
  if (Math.hypot(x - SHRINE.x, z - SHRINE.z) < 26) return 1;
  if (Math.hypot(x - GLADE.x, z - GLADE.z) < 20) return 0.25; // open clearing: a few faint beams, not a curtain
  return 0;
}

export function createShafts(): Shafts {
  const MAX = 24;
  let live = 14;
  let lowQ = false;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const A = new Float32Array(MAX * 4), S = new Float32Array(MAX * 4);
  geo.setAttribute("aBase", new THREE.InstancedBufferAttribute(A, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(S, 4).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = MAX;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uAxis: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uPower: { value: 0 }, uFogFar: { value: 400 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  mesh.visible = false;
  let cursor = 0;
  const axis = new THREE.Vector3();
  const place = (i: number, cx: number, cy: number, cz: number): void => {
    for (let t = 0; t < 8; t++) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.sqrt(Math.random()) * (NEAR - 5);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const c = canopy(x, z);
      if (c <= 0) continue;
      const gy = groundAt ? groundAt(x, z) : cy - 3;
      A[i * 4] = x; A[i * 4 + 1] = gy - 0.3; A[i * 4 + 2] = z; A[i * 4 + 3] = Math.random();
      S[i * 4] = 13 + Math.random() * 8;
      S[i * 4 + 1] = 0.8 + Math.random() * 1.6;
      S[i * 4 + 2] = (0.5 + Math.random() * 0.5) * c;
      return;
    }
    S[i * 4 + 2] = 0;
  };
  let seeded = false;
  return {
    mesh,
    setLow(low) {
      lowQ = low;
      live = low ? 8 : MAX - 4;
      geo.instanceCount = live;
    },
    update(cam, pal, sunDir, daylight, rain, time, fogFar) {
      mesh.matrixWorld.identity();
      const U = mat.uniforms;
      // sun by day, a weaker blue moon shaft by night; the 0.1 gap in between keeps the swap invisible
      const sunY = sunDir.y;
      const day = THREE.MathUtils.smoothstep(sunY, 0.06, 0.3) * (1 - 0.55 * THREE.MathUtils.smoothstep(sunY, 0.55, 0.95)) * THREE.MathUtils.smoothstep(daylight, 0.15, 0.4);
      const moon = pal.moonPos.y > 0.2 ? THREE.MathUtils.smoothstep(pal.moonPos.y, 0.2, 0.5) * (1 - THREE.MathUtils.smoothstep(daylight, 0.0, 0.2)) * 0.32 : 0;
      const power = (day + moon) * (1 - Math.min(1, rain) * 0.9) * (1 - pal.cloud * 0.5);
      mesh.visible = power > 0.01;
      if (!mesh.visible) return;
      if (moon > day) {
        axis.copy(pal.moonPos);
        U.uColor.value.set(0.55, 0.7, 1.0).multiplyScalar(0.9);
      } else {
        axis.copy(sunDir);
        U.uColor.value.copy(pal.glow).lerp(pal.sun, 0.35).multiplyScalar(1.25);
      }
      // steep beams only: a low sun would lay them nearly flat across the view
      axis.y = Math.max(axis.y, 0.62);
      axis.normalize();
      U.uAxis.value.copy(axis).multiplyScalar(1 / axis.y);
      // a hint of light in the air, never a sheet: peak add stays well under the bloom threshold
      U.uPower.value = power * (lowQ ? 0.32 : 0.2); // high adds more ribbons and bloom on top: each one is fainter
      U.uTime.value = time;
      U.uFogFar.value = fogFar;
      if (!seeded) {
        for (let i = 0; i < MAX; i++) place(i, cam.x, cam.y, cam.z);
        seeded = true;
      }
      // recycle two slots per frame: anything far behind the camera moves to a fresh spot near it
      for (let k = 0; k < 2; k++) {
        const i = cursor;
        cursor = (cursor + 1) % MAX;
        if (S[i * 4 + 2] <= 0 || Math.hypot(A[i * 4] - cam.x, A[i * 4 + 2] - cam.z) > NEAR + 4) place(i, cam.x, cam.y, cam.z);
      }
      (geo.getAttribute("aBase") as THREE.InstancedBufferAttribute).needsUpdate = true;
      (geo.getAttribute("aShape") as THREE.InstancedBufferAttribute).needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
