import * as THREE from "three";
import type { Look, SharedUniforms, ToonOpts } from "./contracts";

// The art style in one handle: soft 3-band cel ramp, cool ambient shadows, warm rim, lantern light, wet sheen, and
// sun-aware fog. Built-in materials get the same shading through onBeforeCompile, custom ShaderMaterials paste HM_GLSL.

export function createSharedUniforms(): SharedUniforms {
  return {
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
}

/** Extra uniform shared by every patched material and the sky: the true sun position (for fog glow). */
export const HM_EXTRA_UNIFORMS = {
  uHazeColor: { value: new THREE.Color("#ffd9a0") }, // glow added to fog toward the sun
};

// HM_RIM (float) and HM_BANDS (2|3|4) can be set as material defines before the chunk.
export const HM_GLSL = /* glsl */ `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor;
uniform vec3 uRimColor; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec2 uWind;
uniform float uRain; uniform vec3 uPlayerPos; uniform vec3 uLanternPos; uniform vec3 uLanternColor;
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
  return 0.45 * hmBand(ndl, -0.02, 0.06) + 0.55 * hmBand(ndl, 0.38, 0.07);
#endif
}
/** Cel shade with a shadow factor (1 = lit, 0 = in shadow). n and viewDir are world-space unit vectors. */
vec3 hmShadeS(vec3 albedo, vec3 n, vec3 worldPos, vec3 viewDir, float shadow) {
  float ndl = dot(n, uSunDir);
  float t = hmRamp(ndl) * mix(0.0, 1.0, shadow);
  // wet surfaces: darker albedo, most on faces that catch the rain
  float wet = uRain * (0.75 + 0.25 * clamp(n.y, 0.0, 1.0));
  vec3 alb = albedo * (1.0 - 0.32 * wet);
  // ambient: cool sky from above, warm bounce from below, with a soft band so shadow sides stay flat like a wash
  float up = smoothstep(-0.6, 0.8, n.y);
  vec3 light = mix(uGroundColor, uSkyColor, up) + uSunColor * t;
  // lantern: an ember point light, banded like the sun
  vec3 ld = uLanternPos - worldPos;
  float dl = length(ld);
  float att = 1.0 - smoothstep(0.6, 9.0, dl);
  att *= att;
  light += uLanternColor * att * hmBand(dot(n, ld / max(dl, 1e-3)), -0.25, 0.2);
  vec3 col = alb * light;
  // warm rim: a soft cel band on silhouettes, strongest against the light
  float fres = 1.0 - clamp(dot(n, viewDir), 0.0, 1.0);
  float rim = smoothstep(0.58, 0.78, fres) * (0.45 + 0.55 * clamp(dot(-viewDir, uSunDir) * 0.5 + 0.5, 0.0, 1.0));
  col += uRimColor * (HM_RIM * rim * (0.35 + 0.65 * shadow)) * (0.6 + 0.4 * albedo);
  // wet sheen: a hard cel highlight, only in the rain
  vec3 h = normalize(uSunDir + viewDir);
  float sp = smoothstep(0.93, 0.95, dot(n, h));
  col += uSunColor * sp * 0.45 * wet * shadow;
  return col;
}
vec3 hmShade(vec3 albedo, vec3 n, vec3 worldPos, vec3 viewDir) { return hmShadeS(albedo, n, worldPos, viewDir, 1.0); }
// Eased curve keeps mid-distance (aerial views) clear and still reaches full fog before the far cut.
float hmFogF(float dist) { float f = smoothstep(uFogNear, uFogFar, dist); return f * f * (1.6 - 0.6 * f); }
vec3 hmFog(vec3 c, float dist) { return mix(c, uFogColor, hmFogF(dist)); }
`;

// Extra chunk for patched built-ins: fog that glows toward the sun, matching the sky at the horizon.
const HM_GLSL_EXTRA = /* glsl */ `
uniform vec3 uHazeColor;
varying vec3 vHmWorld;
vec3 hmFogW(vec3 c, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  float s = max(dot(d / max(dist, 1e-3), uSunDir), 0.0);
  vec3 fogc = uFogColor + uHazeColor * (s * s * s * 0.35);
  return mix(c, fogc, hmFogF(dist));
}
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
  float hmSh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  hmSh = receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
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
