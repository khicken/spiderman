import * as THREE from "three";
import type { WorldApi } from "../contracts";
import { warmEnoughToRain } from "../entities/light";
import { rng } from "./sky-art";
import { artOr } from "./pack-art";

const VERT = /* glsl */ `
attribute vec4 aCol;
attribute vec2 aKind;
uniform vec3 uCam;
uniform float uTime;
varying vec2 vUv;
varying float vKind;
varying float vFade;
uniform float uRadius;
void main() {
  vec2 c = aCol.xy + 0.5;
  vec2 to = uCam.xz - c;
  float len = max(length(to), 1e-3);
  vec2 n = to / len;
  vec2 right = vec2(n.y, -n.x);
  float y = aCol.z + position.y * aCol.w;
  vec3 w = vec3(c.x + right.x * position.x, y, c.y + right.y * position.x);
  float seed = aKind.y;
  float u = position.x + 0.5;
  float v;
  if (aKind.x < 0.5) {
    v = y * 0.25 - uTime * 20.0 / 32.0 * (3.0 + seed);
  } else {
    v = y * 0.25 - uTime * 20.0 / 512.0;
    u += seed + uTime * 0.01 * (seed - 0.5) * 4.0;
  }
  vUv = vec2(u, v);
  vKind = aKind.x;
  float t = len / uRadius;
  vFade = (1.0 - t * t) * 0.5 + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uRain;
uniform sampler2D uSnow;
uniform float uAlpha;
uniform float uLight;
varying vec2 vUv;
varying float vKind;
varying float vFade;
void main() {
  vec4 t = vKind < 0.5 ? texture2D(uRain, vUv) : texture2D(uSnow, vUv);
  float a = t.a * uAlpha * vFade;
  if (a < 0.01) discard;
  gl_FragColor = sRGBTransferEOTF(vec4(t.rgb * uLight, a));
  #include <colorspace_fragment>
}`;

export function paintWeather(kind: "rain" | "snow"): Uint8Array {
  const w = 64, h = 256, px = new Uint8Array(w * h * 4);
  const rand = rng(kind === "rain" ? 5 : 9);
  const n = kind === "rain" ? 70 : 90;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
    if (kind === "rain") {
      const len = 6 + Math.floor(rand() * 10);
      for (let k = 0; k < len; k++) {
        const j = (((y + k) % h) * w + x) * 4;
        px[j] = 150; px[j + 1] = 175; px[j + 2] = 255; px[j + 3] = 140 + Math.floor((k / len) * 100);
      }
    } else {
      const s = rand() < 0.3 ? 2 : 1;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const j = (((y + dy) % h) * w + ((x + dx) % w)) * 4;
          px[j] = 255; px[j + 1] = 255; px[j + 2] = 255; px[j + 3] = 230;
        }
    }
  }
  return px;
}

function paint(kind: "rain" | "snow") {
  const a = artOr(`environment/${kind}`, () => ({ data: paintWeather(kind), w: 64, h: 256 }));
  const t = new THREE.DataTexture(a.data, a.w, a.h, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const MAX_R = 10;
const MAX_COLS = (MAX_R * 2 + 1) ** 2;

export function createWeather(scene: THREE.Scene, world: WorldApi, splash: (x: number, y: number, z: number) => void) {
  let rainTex = paint("rain");
  let snowTex = paint("snow");
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  const cols = new Float32Array(MAX_COLS * 4);
  const kinds = new Float32Array(MAX_COLS * 2);
  const colAttr = new THREE.InstancedBufferAttribute(cols, 4).setUsage(THREE.DynamicDrawUsage);
  const kindAttr = new THREE.InstancedBufferAttribute(kinds, 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aCol", colAttr);
  geo.setAttribute("aKind", kindAttr);
  geo.instanceCount = 0;

  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRadius: { value: 10 },
    uAlpha: { value: 0 },
    uLight: { value: 1 },
    uRain: { value: rainTex },
    uSnow: { value: snowTex },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100000;
  scene.add(mesh);

  let radius = 10;
  let lastX = NaN, lastY = NaN, lastZ = NaN, sinceScan = 0;
  let rainCols = 0;
  const rainTops = new Float32Array(MAX_COLS * 3);
  const rand = rng(99);

  function scan(bx: number, by: number, bz: number) {
    let n = 0;
    rainCols = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = bx + dx, z = bz + dz;
        if (!world.isLoaded(x, z)) continue;
        const biome = world.getBiome(x, z);
        if (biome.precipitation === "none") continue;
        const top = world.topY(x, z) + 1;
        const yb = Math.max(top, by - radius), yt = Math.max(top, by + radius);
        if (yb >= yt) continue;
        const snow = biome.precipitation === "snow" || !warmEnoughToRain(biome.temperature, top);
        cols[n * 4] = x; cols[n * 4 + 1] = z; cols[n * 4 + 2] = yb; cols[n * 4 + 3] = yt - yb;
        const h = Math.imul(x * 3121 + z * 45238971, 0x9e3779b1) >>> 0;
        kinds[n * 2] = snow ? 1 : 0; kinds[n * 2 + 1] = (h % 1000) / 1000;
        if (!snow && top > by - radius) {
          rainTops[rainCols * 3] = x; rainTops[rainCols * 3 + 1] = top; rainTops[rainCols * 3 + 2] = z;
          rainCols++;
        }
        n++;
      }
    geo.instanceCount = n;
    colAttr.clearUpdateRanges(); colAttr.addUpdateRange(0, n * 4); colAttr.needsUpdate = true;
    kindAttr.clearUpdateRanges(); kindAttr.addUpdateRange(0, n * 2); kindAttr.needsUpdate = true;
  }

  function update(dt: number, cam: THREE.Vector3, time: number, rain: number, light: number) {
    mesh.visible = rain > 0.001;
    if (!mesh.visible) { lastX = NaN; return; }
    const bx = Math.floor(cam.x), by = Math.floor(cam.y), bz = Math.floor(cam.z);
    sinceScan += dt;
    if (bx !== lastX || by !== lastY || bz !== lastZ || sinceScan > 0.5) {
      lastX = bx; lastY = by; lastZ = bz; sinceScan = 0;
      scan(bx, by, bz);
    }
    uniforms.uCam.value.copy(cam);
    uniforms.uTime.value = time;
    uniforms.uRadius.value = radius;
    uniforms.uAlpha.value = rain;
    uniforms.uLight.value = light;
    if (rainCols) {
      let spawn = rain * dt * 60;
      while (spawn > 0 && (spawn >= 1 || rand() < spawn)) {
        const k = Math.floor(rand() * rainCols) * 3;
        splash(rainTops[k] + rand(), rainTops[k + 1] + 0.05, rainTops[k + 2] + rand());
        spawn--;
      }
    }
  }

  return {
    update,
    setRadius(r: number) { radius = Math.min(MAX_R, Math.max(3, r)); lastX = NaN; },
    reloadArt() {
      rainTex.dispose(); snowTex.dispose();
      rainTex = paint("rain");
      snowTex = paint("snow");
      uniforms.uRain.value = rainTex;
      uniforms.uSnow.value = snowTex;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose(); base.dispose(); mat.dispose(); rainTex.dispose(); snowTex.dispose();
    },
  };
}

export type Weather = ReturnType<typeof createWeather>;
