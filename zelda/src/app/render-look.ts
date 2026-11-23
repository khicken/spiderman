import * as THREE from "three";
import type { BeaconId, Look, SharedUniforms, ToonOpts } from "./contracts";
import { BEACON_LANDMARK, LANDMARKS } from "./contracts";

// The art style in one handle: soft 3-band cel ramp, cool ambient shadows, warm rim, lantern light, wet sheen, and
// sun-aware fog. Built-in materials get the same shading through onBeforeCompile, custom ShaderMaterials paste HM_GLSL.

export function createSharedUniforms(): SharedUniforms {
  const u: SharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color("#fff1d6") },
    uSkyColor: { value: new THREE.Color("#9cc3cf") },
    uGroundColor: { value: new THREE.Color("#5d6b3a") },
    uRimColor: { value: new THREE.Color("#ffd9a0") },
    uFogColor: { value: new THREE.Color("#f3e2bf") },
    uFogNear: { value: 180 },
    uFogFar: { value: 620 },
    uWind: { value: new THREE.Vector2(1.5, 0.6) },
    uRain: { value: 0 },
    uPlayerPos: { value: new THREE.Vector3() },
    uLanternPos: { value: new THREE.Vector3(0, -999, 0) },
    uLanternColor: { value: new THREE.Color(0, 0, 0) },
  };
  // v2 look uniforms ride along on the shared object, so every `...look.uniforms` spread picks them up
  return Object.assign(u, HM_LOOK);
}

/** Extra uniform shared by every patched material and the sky: the true sun position (for fog glow). */
export const HM_EXTRA_UNIFORMS = {
  uHazeColor: { value: new THREE.Color("#ffd9a0") }, // glow added to fog toward the sun
};

// ---------------------------------------------------------------------------------------------------------------------
// v2 look state. One module-level set (there is one renderer). render-env writes it every palette update through
// writeLook(); nature writes the canopy map; terrain (or render.ts via setRegionColor) writes the region colors.
// ---------------------------------------------------------------------------------------------------------------------
const CANOPY_EMPTY = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** Gloam region centres (beacon landmarks) and radii, by BeaconId. */
const REGION_R = [130, 175, 120, 120];
const REGION_C = BEACON_LANDMARK.map((id) => {
  const l = LANDMARKS.find((m) => m.id === id);
  return l ? [l.x, l.z] : [0, 0];
});

export const HM_LOOK = {
  uHmAmbSky: { value: new THREE.Color("#7f9bc0") }, // ambient from above, already scaled (0.75)
  uHmAmbGnd: { value: new THREE.Color("#3a3a2a") }, // bounce from below, already scaled (0.55)
  uHmShade: { value: new THREE.Color("#5a6f9e") }, // cool shade hue the dark bands lean toward
  uHmGlow: { value: new THREE.Color("#ffe08a") }, // backlight and sun-side haze
  uHmFogTint: { value: new THREE.Color("#d9e4e8") }, // aerial perspective color
  uHmFog: { value: new THREE.Vector4(6, 0.045, 0.0016, 0.55) }, // floor y, falloff /m, aerial density /m, height-fog strength
  uHmCanopy: { value: CANOPY_EMPTY as THREE.Texture },
  uHmCanopyRect: { value: new THREE.Vector4(-640, -640, 1 / 1280, 0) }, // x0, z0, 1/size, strength
  uHmRegion: { value: new THREE.Vector4(0, 0, 0, 0) }, // color restored per BeaconId, 0 = Gloam grey
};

/** Palette subset the look needs. render-env passes its Palette. */
export interface LookPalette {
  amb: THREE.Color; gnd: THREE.Color; cShade: THREE.Color; glow: THREE.Color; fog: THREE.Color;
  flash: number; daylight: number; rain: number;
}

/** Called by render-env after every palette update. */
export function writeLook(p: LookPalette): void {
  const L = HM_LOOK;
  L.uHmAmbSky.value.copy(p.amb).multiplyScalar(0.75);
  L.uHmAmbGnd.value.copy(p.gnd).multiplyScalar(0.55);
  if (p.flash > 0) {
    L.uHmAmbSky.value.r += p.flash * 0.9;
    L.uHmAmbSky.value.g += p.flash * 0.95;
    L.uHmAmbSky.value.b += p.flash * 1.05;
  }
  L.uHmShade.value.copy(p.cShade);
  L.uHmGlow.value.copy(p.glow);
  L.uHmFogTint.value.copy(p.fog);
  // valley mist is thickest at dawn and in rain, thin at noon
  const mist = 0.35 + 0.4 * (1 - p.daylight) + 0.3 * p.rain;
  L.uHmFog.value.set(4 + 6 * p.daylight, 0.05, 0.0012 + 0.0012 * p.rain, Math.min(0.8, mist));
}

/** Region color for a main beacon: 0 = full Gloam (desaturated) .. 1 = restored. The wash grows outward with t. */
export function setRegionColor(beacon: BeaconId, t: number): void {
  const v = HM_LOOK.uHmRegion.value;
  const c = Math.min(1, Math.max(0, t));
  if (beacon === 0) v.x = c;
  else if (beacon === 1) v.y = c;
  else if (beacon === 2) v.z = c;
  else v.w = c;
}

/** Canopy shadow map (written once by nature at build). r = cover, g = crown top ((y + 20) / 280). */
/** Points the canopy sampler back at the empty texture when `tex` is the one bound (call before disposing `tex`). */
export function clearCanopyMap(tex: THREE.Texture): void {
  if (HM_LOOK.uHmCanopy.value !== tex) return;
  HM_LOOK.uHmCanopy.value = CANOPY_EMPTY;
  HM_LOOK.uHmCanopyRect.value.w = 0;
}
export function setCanopyMap(tex: THREE.Texture, x0: number, z0: number, size: number, strength: number): void {
  HM_LOOK.uHmCanopy.value = tex;
  HM_LOOK.uHmCanopyRect.value.set(x0, z0, 1 / size, strength);
}

const f1 = (n: number) => n.toFixed(1);
const REGION_GLSL = REGION_C.map((c, i) => `hmRegionW(wp.xz, vec2(${f1(c[0])}, ${f1(c[1])}), ${f1(REGION_R[i])}, uHmRegion[${i}])`).join(" +\n    ");

// HM_RIM (float), HM_BANDS (2|3|4) and HM_FOLIAGE (wrap light + backlight) can be set as material defines.
export const HM_GLSL = /* glsl */ `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor;
uniform vec3 uRimColor; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec2 uWind;
uniform float uRain; uniform vec3 uPlayerPos; uniform vec3 uLanternPos; uniform vec3 uLanternColor;
uniform vec3 uHmAmbSky; uniform vec3 uHmAmbGnd; uniform vec3 uHmShade; uniform vec3 uHmGlow; uniform vec3 uHmFogTint;
uniform vec4 uHmFog; uniform sampler2D uHmCanopy; uniform vec4 uHmCanopyRect; uniform vec4 uHmRegion;
#ifndef HM_RIM
#define HM_RIM 0.35
#endif
#ifndef HM_BANDS
#define HM_BANDS 3
#endif
float hmBand(float x, float e, float w) { return smoothstep(e - w, e + w, x); }
float hmRamp(float ndl) {
#if HM_BANDS == 2
  return hmBand(ndl, 0.08, 0.05);
#elif HM_BANDS == 4
  return 0.3 * hmBand(ndl, -0.12, 0.05) + 0.35 * hmBand(ndl, 0.2, 0.05) + 0.35 * hmBand(ndl, 0.55, 0.06);
#else
  // with the 0.28 floor below this gives the v2 ramp 0.28 / 0.62 / 1.0
  return 0.474 * hmBand(ndl, -0.02, 0.07) + 0.526 * hmBand(ndl, 0.36, 0.08);
#endif
}
float hmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hmNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hmHash(i), hmHash(i + vec2(1.0, 0.0)), f.x), mix(hmHash(i + vec2(0.0, 1.0)), hmHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** Baked canopy shadow: 1 = open sky, lower under tree crowns, with drifting dapples. Sampled toward the sun so
 *  shadows fall on the far side of a crown and reach the trunk base. */
float hmShadow(vec3 wp) {
  if (uHmCanopyRect.w <= 0.0) return 1.0;
  float sy = max(uSunDir.y, 0.3);
  vec2 p = wp.xz + uSunDir.xz / sy * 5.0;
  vec4 c = texture2D(uHmCanopy, (p - uHmCanopyRect.xy) * uHmCanopyRect.z);
  float top = c.g * 280.0 - 20.0;
  float cover = c.r * smoothstep(0.3, 2.5, top - wp.y);
  float l = length(uWind);
  vec2 drift = uWind * uTime * 0.12 + vec2(sin(uTime * 0.6), cos(uTime * 0.47)) * (0.15 + 0.05 * l);
  float dap = hmNoise(wp.xz * 0.55 + drift) * 0.65 + hmNoise(wp.xz * 1.7 - drift * 1.6) * 0.35;
  cover *= 1.0 - 0.75 * smoothstep(0.58, 0.74, dap);
  return 1.0 - cover * uHmCanopyRect.w;
}
float hmRegionW(vec2 xz, vec2 c, float r, float t) {
  float d = length(xz - c);
  float inside = 1.0 - smoothstep(r * 0.8, r, d);
  float wash = t * (r + 40.0);
  return inside * smoothstep(wash - 30.0, wash, d);
}
/** Gloam weight 0..1 at a world position (unlit beacon regions). */
float hmGloam(vec3 wp) {
  return clamp(
    ${REGION_GLSL}, 0.0, 1.0);
}
vec3 hmGloamTint(vec3 c, vec3 wp) {
  float g = hmGloam(wp);
  if (g <= 0.0) return c;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, vec3(l) * vec3(0.84, 0.8, 1.0), g * 0.42);
}
/** Cel shade with a shadow factor (1 = lit, 0 = in shadow). n and viewDir are world-space unit vectors. */
vec3 hmShadeS(vec3 albedo, vec3 n, vec3 worldPos, vec3 viewDir, float shadow) {
  float ndl = dot(n, uSunDir);
#ifdef HM_FOLIAGE
  ndl = (ndl + 0.5) / 1.5;
#endif
  float k = hmRamp(ndl) * shadow;
  float band = 0.28 + 0.72 * k;
  // wet surfaces: darker albedo, most on faces that catch the rain
  float wet = uRain * (0.75 + 0.25 * clamp(n.y, 0.0, 1.0));
  vec3 alb = hmGloamTint(albedo, worldPos) * (1.0 - 0.32 * wet);
  // two temperatures: the key is warm sun, the shade leans toward the cool cShade hue (never grey-green)
  float up = smoothstep(-0.6, 0.8, n.y);
  vec3 amb = mix(uHmAmbGnd, uHmAmbSky, up);
  vec3 shadeHue = uHmShade / max(dot(uHmShade, vec3(0.299, 0.587, 0.114)), 0.04);
  vec3 tint = mix(mix(vec3(1.0), shadeHue, 0.55), vec3(1.0), smoothstep(0.3, 1.0, band));
  vec3 light = (amb + uSunColor) * band * tint;
  // lantern: an ember point light, banded like the sun
  vec3 ld = uLanternPos - worldPos;
  float dl = length(ld);
  float att = 1.0 - smoothstep(0.6, 9.0, dl);
  att *= att;
  light += uLanternColor * att * hmBand(dot(n, ld / max(dl, 1e-3)), -0.25, 0.2);
  vec3 col = alb * light;
  // warm rim: a soft cel band on silhouettes, strongest against the light, only on lit edges
  float fres = 1.0 - clamp(dot(n, viewDir), 0.0, 1.0);
  float rim = smoothstep(0.58, 0.78, fres) * (0.45 + 0.55 * clamp(dot(-viewDir, uSunDir) * 0.5 + 0.5, 0.0, 1.0));
  col += uRimColor * (HM_RIM * rim * (0.2 + 0.8 * k)) * (0.6 + 0.4 * albedo);
#ifdef HM_FOLIAGE
  // subsurface: leaves glow when the sun is behind them
  float bl = pow(max(dot(-viewDir, uSunDir), 0.0), 4.0);
  col += uHmGlow * alb * bl * 0.35 * (0.4 + 0.6 * shadow);
#endif
  // wet sheen: a hard cel highlight, only in the rain
  vec3 h = normalize(uSunDir + viewDir);
  float sp = smoothstep(0.93, 0.95, dot(n, h));
  col += uSunColor * sp * 0.45 * wet * shadow;
  return col;
}
vec3 hmShade(vec3 albedo, vec3 n, vec3 worldPos, vec3 viewDir) {
  return hmShadeS(albedo, n, worldPos, viewDir, hmShadow(worldPos));
}
// Eased curve keeps mid-distance (aerial views) clear and still reaches full fog before the far cut.
float hmFogF(float dist) { float f = smoothstep(uFogNear, uFogFar, dist); return f * f * (1.6 - 0.6 * f); }
/** Distance-only fog (no position): aerial tint first, then the horizon color. */
vec3 hmFog(vec3 c, float dist) {
  float a = (1.0 - exp(-dist * uHmFog.z)) * 0.55;
  c = mix(c, uHmFogTint, a);
  return mix(c, uFogColor, hmFogF(dist));
}
/** Positional fog: aerial perspective (cool away from the sun, warm toward it), valley height fog, then the horizon
 *  color, which is the sky's horizon color, so far land meets the sky without a band. */
vec3 hmFogP(vec3 c, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float s = max(dot(dir, uSunDir), 0.0);
  float hAvg = 0.5 * (cameraPosition.y + wp.y);
  float hf = exp(-max(hAvg - uHmFog.x, 0.0) * uHmFog.y);
  float lowRay = exp(-max(max(cameraPosition.y, wp.y) - uHmFog.x, 0.0) * uHmFog.y);
  vec3 aer = mix(uHmFogTint * vec3(0.93, 0.97, 1.06), uHmFogTint + uHmGlow * 0.18, s * s);
  float a = (1.0 - exp(-dist * uHmFog.z)) * mix(0.3, 0.5, hf);
  c = mix(c, aer, a);
  c = mix(c, aer, (1.0 - exp(-dist * 0.006)) * lowRay * uHmFog.w * 0.3);
  vec3 fogc = uFogColor + uHmGlow * (s * s * s * 0.3);
  float f = hmFogF(dist);
  // high rays (aerial views) see through more air before turning to horizon color
  f *= mix(1.0, 0.72, smoothstep(40.0, 180.0, hAvg) * (1.0 - smoothstep(0.7, 1.0, dist / uFogFar)));
  return mix(c, fogc, f);
}
`;

// Extra chunk for patched built-ins: fog that glows toward the sun, matching the sky at the horizon.
const HM_GLSL_EXTRA = /* glsl */ `
uniform vec3 uHazeColor;
varying vec3 vHmWorld;
vec3 hmFogW(vec3 c, vec3 wp) { return hmFogP(c, wp); }
`;

const VERT_WORLD = /* glsl */ `
#include <project_vertex>
{
  vec4 hmW = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  hmW = batchingMatrix * hmW;
  #endif
  #ifdef USE_INSTANCING
  hmW = instanceMatrix * hmW;
  #endif
  vHmWorld = (modelMatrix * hmW).xyz;
}`;

const FRAG_SHADE = /* glsl */ `
{
  vec3 hmN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 hmV = normalize(cameraPosition - vHmWorld);
  float hmSh = hmShadow(vHmWorld);
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  hmSh *= receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
  #endif
  outgoingLight = hmShadeS(diffuseColor.rgb, hmN, vHmWorld, hmV, hmSh) + totalEmissiveRadiance * 1.6;
}
#include <opaque_fragment>
#ifdef OPAQUE
  // the post pass reads 1 - alpha as a glow mask for bloom
  gl_FragColor.a = 1.0 - clamp(dot(totalEmissiveRadiance, vec3(0.6)), 0.0, 1.0);
#endif`;

const FRAG_FOG = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = hmFogW(gl_FragColor.rgb, vHmWorld);
#endif`;

type Shader = THREE.WebGLProgramParametersWithUniforms;

function inject(sh: Shader, uniforms: SharedUniforms) {
  Object.assign(sh.uniforms, uniforms, HM_EXTRA_UNIFORMS);
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vHmWorld;")
    .replace("#include <project_vertex>", VERT_WORLD);
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\n" + HM_GLSL + HM_GLSL_EXTRA)
    .replace("#include <opaque_fragment>", FRAG_SHADE)
    .replace("#include <fog_fragment>", FRAG_FOG);
}

const LIT = (m: THREE.Material) =>
  (m as THREE.MeshLambertMaterial).isMeshLambertMaterial ||
  (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
  (m as THREE.MeshPhongMaterial).isMeshPhongMaterial ||
  (m as THREE.MeshToonMaterial).isMeshToonMaterial;

export type LookInternal = Look & { dispose(): void; readonly materials: ReadonlySet<THREE.Material> };

export function createLook(uniforms: SharedUniforms): LookInternal {
  const cache = new Map<string, THREE.Material>();
  const all = new Set<THREE.Material>();

  const patch = <M extends THREE.Material>(m: M): M => {
    if (m.userData.hmLook || !LIT(m)) return m;
    m.userData.hmLook = true;
    const prev = m.onBeforeCompile;
    const baseKey = m.customProgramCacheKey(); // read before onBeforeCompile is replaced: the default key is its source

    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      inject(sh, uniforms);
    };
    m.customProgramCacheKey = () => "hm|" + baseKey;
    m.needsUpdate = true;
    all.add(m);
    return m;
  };

  const toon = (o: ToonOpts): THREE.Material => {
    const key = [
      new THREE.Color(o.color).getHexString(),
      o.emissive !== undefined ? new THREE.Color(o.emissive).getHexString() : "",
      o.emissiveIntensity ?? 1, o.vertexColors ? 1 : 0, o.map?.uuid ?? "", o.side ?? THREE.FrontSide,
      o.transparent ? 1 : 0, o.opacity ?? 1, o.rim ?? 0.35, o.bands ?? 3,
    ].join("|");
    let m = cache.get(key);
    if (m) return m;
    const lm = new THREE.MeshLambertMaterial({
      color: o.color,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      vertexColors: o.vertexColors ?? false,
      map: o.map ?? null,
      side: o.side ?? THREE.FrontSide,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      depthWrite: !(o.transparent && (o.opacity ?? 1) < 0.99),
    });
    lm.defines = { HM_RIM: (o.rim ?? 0.35).toFixed(3), HM_BANDS: String(o.bands ?? 3) };
    m = patch(lm);
    cache.set(key, m);
    return m;
  };

  return {
    uniforms,
    glsl: HM_GLSL,
    toon,
    patch,
    materials: all,
    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
      all.clear();
    },
  };
}
