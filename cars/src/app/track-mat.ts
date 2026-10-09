import * as THREE from "three";
import type { Quality } from "./contracts";
import { asphaltTex, dirtTex, grassTex, gravelTex, rockTex, snowTex } from "./track-tex";

export const TEX: Record<Quality, { n: number; aniso: number; ground: number }> = {
  low: { n: 256, aniso: 2, ground: 256 },
  medium: { n: 512, aniso: 4, ground: 512 },
  high: { n: 1024, aniso: 8, ground: 512 },
  ultra: { n: 2048, aniso: 16, ground: 1024 },
};

const NOISE = /* glsl */ `
float tkHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tkNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tkHash(i), tkHash(i + vec2(1.0, 0.0)), f.x), mix(tkHash(i + vec2(0.0, 1.0)), tkHash(i + 1.0), f.x), f.y);
}
float tkFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * tkNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float tkBand(float x, float a, float b) { float w = fwidth(x) * 0.8 + 0.002; return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
`;

export type RoadUniforms = {
  uWet: { value: number };
  uStart: { value: number };
  uLen: { value: number };
  uClosed: { value: number };
  uMarks: { value: number }; // 0 circuit, 1 public dashed, 2 tokyo, 3 double yellow
  uWear: { value: number };
};

// Asphalt with procedural markings, grid boxes, tire wear, oil and wet puddles. uv = (lateral, s) in m, aInfo = (half width, racing line, tunnel shade).
export function roadMaterial(q: Quality, u: RoadUniforms) {
  const t = asphaltTex(TEX[q].n, TEX[q].aniso);
  for (const x of [t.map, t.normal, t.rough]) x.repeat.set(1 / 6, 1 / 6);
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.normalScale.set(1.2, 1.2);
  m.customProgramCacheKey = () => "tk-road";
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aInfo;\nvarying vec2 vRoad;\nvarying vec3 vInfo;\nvarying vec3 vWP;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvRoad = uv; vInfo = aInfo;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vRoad; varying vec3 vInfo; varying vec3 vWP;
uniform float uWet, uStart, uLen, uClosed, uMarks, uWear;
${NOISE}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float u = vRoad.x, s = vRoad.y, au = abs(u), hw = vInfo.x, ln = vInfo.y;
vec2 wxz = mod(vWP.xz, 2048.0);
float macro = tkFbm(wxz * 0.035);
diffuseColor.rgb *= 0.86 + 0.28 * macro;
float patchN = tkHash(floor(vec2(u / 3.5 + 7.0, mod(s, 4096.0) / 9.0)));
diffuseColor.rgb *= 1.0 + (patchN > 0.93 ? -0.16 : patchN > 0.88 ? 0.08 : 0.0) * step(0.45, tkNoise(wxz * 0.008));
float wd = abs(u - ln);
float wear = exp(-pow((wd - 0.8) / 0.5, 2.0)) * uWear * (0.7 + 0.3 * tkNoise(vec2(u * 3.0, mod(s, 1024.0) * 0.2)));
diffuseColor.rgb *= 1.0 - 0.42 * wear;
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.82, wear);
float oil = smoothstep(0.62, 0.82, tkFbm(vec2(u * 2.0, mod(s, 1024.0) * 0.06))) * exp(-wd * wd / 0.25);
diffuseColor.rgb *= 1.0 - 0.25 * oil;
roughnessFactor -= 0.15 * oil;
diffuseColor.rgb *= mix(0.92, 1.0, smoothstep(hw - 0.2, hw - 1.6, au));
vec3 white = vec3(0.86), yellow = vec3(0.86, 0.62, 0.12);
float paint = 0.0; vec3 pc = white;
float edge = tkBand(au, hw - 0.42, hw - 0.27);
if (uMarks < 1.5) {
  paint = edge;
  if (uMarks > 0.5) paint = max(paint, tkBand(au, 0.0, 0.07) * step(fract(s / 12.0), 0.33));
} else if (uMarks < 2.5) {
  paint = edge;
  pc = u > 0.0 && au > hw - 1.0 ? yellow : white;
  paint = max(paint, tkBand(au, 0.0, 0.08) * step(fract(s / 12.0), 0.5));
} else {
  paint = edge;
  float dy = tkBand(au, 0.06, 0.16);
  if (dy > 0.0) pc = yellow;
  paint = max(paint, dy);
}
float ds = s - uStart;
if (uClosed > 0.5) ds = mod(ds + uLen * 0.5, uLen) - uLen * 0.5;
float sl = tkBand(ds, -0.35, 0.35) * step(au, hw - 0.27);
if (sl > 0.0 && uMarks < 0.5) {
  float ch = mod(floor(u / 0.35) + floor((ds + 0.35) / 0.35), 2.0);
  pc = mix(vec3(0.05), white, ch);
}
paint = max(paint, sl);
float b = -ds;
float kf = floor((b - 3.0) / 4.0);
if (kf >= 0.0 && kf <= 11.0) {
  float lat = (mod(kf, 2.0) < 0.5 ? 1.0 : -1.0) * min(3.0, hw * 0.44);
  float bf = 6.0 + 4.0 * kf - 2.5;
  float box = tkBand(b, bf - 0.08, bf + 0.08) * step(abs(u - lat), 1.3);
  box = max(box, tkBand(abs(u - lat), 1.18, 1.3) * step(bf - 0.08, b) * step(b, bf + 1.2));
  if (box > paint) pc = white;
  paint = max(paint, box);
}
paint *= 0.75 + 0.25 * tkNoise(wxz * 6.0);
paint *= 1.0 - 0.6 * wear;
diffuseColor.rgb = mix(diffuseColor.rgb, pc, paint);
roughnessFactor = mix(roughnessFactor, 0.55, paint);
float pud = smoothstep(0.56, 0.66, tkFbm(wxz * 0.085) + 0.16 * smoothstep(hw - 2.5, hw, au) + 0.08 * wear - 0.12 * (1.0 - uWet)) * smoothstep(0.15, 0.7, uWet);
diffuseColor.rgb *= mix(1.0, 0.52, uWet) * (1.0 - 0.15 * pud);
roughnessFactor = mix(roughnessFactor, 0.3, uWet * 0.85);
roughnessFactor = clamp(mix(roughnessFactor, 0.03, pud), 0.02, 1.0);`,
      )
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, pud * 0.95 + uWet * 0.3));")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= 1.0 - 0.85 * vInfo.z;\nreflectedLight.indirectDiffuse *= 1.0 - 0.6 * vInfo.z;");
  };
  return { mat: m, tex: [t.map, t.normal, t.rough] };
}

export type GroundUniforms = { uWet: { value: number }; uSnowLine: { value: number }; uAutumn: { value: number }; uWinter: { value: number } };

// Terrain shading from world position: grass, dirt, rock by slope, snow by height and season.
export function groundMaterial(q: Quality, u: GroundUniforms, offset: number) {
  const n = TEX[q].ground, a = TEX[q].aniso;
  const tex = { tGrass: { value: grassTex(n, a) }, tDirt: { value: dirtTex(n, a) }, tRock: { value: rockTex(n, a) }, tSnow: { value: snowTex(n, a) } };
  const make = (off: number) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, polygonOffset: off !== 0, polygonOffsetFactor: off, polygonOffsetUnits: off });
    m.customProgramCacheKey = () => "tk-ground";
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, tex);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vWP; varying vec3 vWN;
uniform float uWet, uSnowLine, uAutumn, uWinter;
uniform sampler2D tGrass, tDirt, tRock, tSnow;
${NOISE}`,
        )
        .replace(
          "#include <map_fragment>",
          `vec2 w = vWP.xz;
vec3 wn = normalize(vWN);
float slope = 1.0 - wn.y;
float n1 = tkFbm(mod(w, 4096.0) * 0.018);
vec2 wr = mat2(0.8, -0.6, 0.6, 0.8) * w;
float mixN = smoothstep(0.35, 0.65, tkNoise(mod(w, 4096.0) * 0.03));
vec3 g = mix(texture2D(tGrass, w / 7.0).rgb, texture2D(tGrass, wr / 11.3).rgb, mixN) * (0.8 + 0.4 * texture2D(tGrass, w / 61.0).a);
g *= mix(vec3(0.9, 0.95, 0.82), vec3(1.08, 1.04, 1.0), n1);
g = mix(g, g * vec3(1.45, 1.1, 0.55), uAutumn * (0.6 + 0.4 * n1));
vec3 d = mix(texture2D(tDirt, w / 5.0).rgb, texture2D(tDirt, wr / 8.1).rgb, mixN);
vec3 bw = pow(abs(wn), vec3(4.0)); bw /= bw.x + bw.y + bw.z;
vec3 rk = texture2D(tRock, vWP.zy / 9.0).rgb * bw.x + texture2D(tRock, w / 9.0).rgb * bw.y + texture2D(tRock, vWP.xy / 9.0).rgb * bw.z;
vec3 sn = texture2D(tSnow, w / 9.0).rgb;
float dirtW = smoothstep(0.62, 0.8, n1 + slope * 0.9);
float rockW = smoothstep(0.3, 0.48, slope + (n1 - 0.5) * 0.25);
float snowW = max(uWinter * (0.85 + 0.15 * n1), smoothstep(uSnowLine - 40.0, uSnowLine + 40.0, vWP.y + n1 * 80.0)) * (1.0 - smoothstep(0.5, 0.75, slope));
vec3 col = mix(g, d, dirtW);
col = mix(col, rk, rockW);
col = mix(col, sn, snowW);
col *= 0.88 + 0.24 * texture2D(tDirt, w * 0.9).a;
diffuseColor.rgb *= col;
float gr = mix(mix(0.95, 0.88, dirtW), 0.8, rockW);
gr = mix(gr, 0.55, snowW);`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
roughnessFactor = gr * mix(1.0, 0.82, uWet * (1.0 - snowW));
diffuseColor.rgb *= mix(1.0, 0.7, uWet * (1.0 - snowW));`,
        );
    };
    return m;
  };
  return { mat: make(0), strip: make(offset), tex: Object.values(tex).map((t) => t.value) };
}

export function gravelMaterial(q: Quality) {
  const t = gravelTex(TEX[q].ground, TEX[q].aniso);
  t.repeat.set(1 / 2.5, 1 / 2.5);
  return { mat: new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), tex: t };
}
