import * as THREE from "three";
import { farPatch, U } from "./scenery-kit";

// One material for every building: windows, shutters, balconies, roofs and lit windows come from the aFac attribute.
const FRAG = /* glsl */ `
varying vec4 vFac; varying float vTop; varying vec3 vWp; varying vec3 vNw;
uniform float uNight; uniform float uLit; uniform float uTime;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float boxm(vec2 p, vec4 r, vec2 aa) {
  vec2 a = smoothstep(r.xy - aa, r.xy + aa, p) * (1.0 - smoothstep(r.zw - aa, r.zw + aa, p));
  return a.x * a.y;
}
`;

const MAIN = /* glsl */ `
float st = floor(vFac.w + 0.5); float seed = vFac.z;
float gN = vn(vWp.xz * 0.35 + vWp.y * 0.21) * 0.6 + vn(vWp.xz * 2.3 + vWp.y * 1.7) * 0.4;
float win = 0.0; float lit = 0.0; vec3 litCol = vec3(0.0); float gloss = 0.0; float metal = 0.0; vec3 glass = vec3(0.0);
vec3 wall = diffuseColor.rgb * (0.88 + 0.22 * gN);
if (st > 5.5 && st < 6.5) {
  wall *= 0.85 + 0.3 * vn(vWp.xz * 0.8);
} else if (st > 7.5) {
  float bars = fract(vFac.x * 8.0);
  if (bars > 0.22 && vFac.y > 0.12 && vFac.y < 0.92) discard;
  wall = vec3(0.06, 0.06, 0.055); gloss = 0.3; metal = 0.6;
} else if (st < 6.5) {
  float fh = st < 0.5 ? 3.4 : st < 1.5 ? 3.6 : st < 2.5 ? 3.8 : st < 3.5 ? 3.3 : st < 4.5 ? 3.0 : 4.5;
  vec4 wr = st < 0.5 ? vec4(0.3, 0.16, 0.7, 0.82) : st < 1.5 ? vec4(0.06, 0.28, 0.94, 0.86) : st < 2.5 ? vec4(0.03, 0.05, 0.97, 0.96)
    : st < 3.5 ? vec4(0.3, 0.2, 0.7, 0.86) : st < 4.5 ? vec4(0.34, 0.25, 0.66, 0.75) : vec4(0.1, 0.3, 0.9, 0.85);
  float gH = st < 1.5 || st > 4.5 ? 4.6 : st < 2.5 ? 5.0 : 0.6;
  float topCut = vTop - 1.1;
  vec2 cuv; vec4 r = wr; float shop = 0.0;
  if (vFac.y < gH && st != 3.0 && st != 4.0) { cuv = vec2(vFac.x, vFac.y / gH); r = st > 4.5 ? vec4(0.06, 0.0, 0.94, 0.8) : vec4(0.05, 0.08, 0.95, 0.82); shop = 1.0; }
  else cuv = vec2(vFac.x, (vFac.y - gH) / fh);
  vec2 cell = floor(cuv); vec2 f = fract(cuv);
  vec2 aa = max(fwidth(cuv) * 0.8, vec2(0.002));
  float farF = clamp((max(aa.x, aa.y) - 0.05) * 6.0, 0.0, 1.0);
  float rnd = h21(cell + seed * 37.7), rnd2 = h21(cell.yx * 1.7 + seed * 11.3);
  float m = boxm(f, r, aa);
  if (vFac.y > topCut || vFac.x < 0.0) m = 0.0;
  float frame = boxm(f, r + vec4(-0.05, -0.06, 0.05, 0.03), aa) - m;
  float reveal = smoothstep(r.w - 0.12, r.w, f.y) + smoothstep(r.x + 0.06, r.x, f.x);
  vec3 trim = st < 0.5 ? vec3(0.93, 0.9, 0.84) : st > 2.5 && st < 3.5 ? vec3(0.96, 0.95, 0.92) : wall * 0.75;
  wall = mix(wall, trim, clamp(frame, 0.0, 1.0) * (1.0 - farF) * (st < 1.5 || st > 2.5 ? 1.0 : 0.0));
  if (st > 2.5 && st < 3.5) wall *= 0.9 + 0.1 * smoothstep(0.35, 0.5, abs(fract(vFac.y * 4.5) - 0.5)) ;
  if (st < 0.5 && shop < 0.5) {
    float sh = h21(vec2(seed, 3.0));
    vec3 shc = sh < 0.4 ? vec3(0.22, 0.32, 0.22) : sh < 0.65 ? vec3(0.42, 0.44, 0.3) : sh < 0.85 ? vec3(0.45, 0.3, 0.2) : vec3(0.3, 0.38, 0.45);
    float closed = step(0.62, rnd);
    float sL = boxm(f, vec4(0.13, r.y, 0.29, r.w), aa) * (1.0 - closed), sR = boxm(f, vec4(0.71, r.y, 0.87, r.w), aa) * (1.0 - closed);
    float slat = 0.85 + 0.15 * step(0.5, fract(f.y * 28.0));
    float shut = max(sL, sR);
    if (vFac.y > topCut || vFac.x < 0.0) shut = 0.0;
    wall = mix(wall, shc * slat, shut * (1.0 - farF * 0.6));
    if (closed > 0.5) { wall = mix(wall, shc * slat, m); m = 0.0; }
    float bal = step(0.45, h21(vec2(seed, cell.y))) * (1.0 - smoothstep(0.05, 0.08, f.y)) * step(0.0, cell.y);
    wall *= 1.0 - 0.35 * bal * step(vFac.y, topCut);
  }
  float curtain = step(0.55, rnd2) * (st < 1.5 || st > 2.5 ? 1.0 : 0.0);
  vec3 sky = mix(vec3(0.16, 0.19, 0.23), vec3(0.32, 0.36, 0.42), smoothstep(0.0, 1.0, f.y));
  glass = sky * (0.55 + 0.6 * rnd);
  glass = mix(glass, vec3(0.62, 0.56, 0.47) * (0.7 + 0.3 * rnd), curtain * smoothstep(0.55, 0.6, f.y) * (1.0 - shop) * 0.85);
  if (st > 1.5 && st < 2.5) {
    float tint = h21(vec2(seed, 9.0));
    glass = mix(vec3(0.1, 0.16, 0.2), tint < 0.5 ? vec3(0.18, 0.26, 0.3) : vec3(0.22, 0.2, 0.16), 0.5 + 0.3 * rnd);
    metal = 0.75;
    wall = mix(wall, vec3(0.5, 0.52, 0.55), 0.7);
  }
  if (shop > 0.5) glass = vec3(0.1, 0.09, 0.08) + vec3(0.25, 0.2, 0.15) * rnd;
  glass *= 1.0 - 0.45 * clamp(reveal, 0.0, 1.0) * step(st, 1.5);
  win = m;
  gloss = m * (st > 1.5 && st < 2.5 ? 0.96 : 0.9);
  float far = farF;
  win = mix(win, 0.35, far);
  float on = step(1.0 - uLit * (shop > 0.5 ? 1.2 : 1.0), h21(cell * 1.31 + seed * 5.1 + floor(rnd2 * 3.0)));
  vec3 warm = mix(vec3(1.0, 0.68, 0.36), vec3(1.0, 0.85, 0.62), rnd2);
  vec3 cool = vec3(0.75, 0.88, 1.0);
  float mull = st > 1.5 && st < 2.5 ? mix(1.0, 0.3, step(fract(f.x * 3.0), 0.07)) : 1.0;
  litCol = mix(warm, cool, step(0.6, rnd)) * (0.15 + 0.85 * rnd2 * rnd2) * mix(1.0, 0.75 + 0.25 * f.y, curtain) * (0.5 + 0.5 * smoothstep(0.3, 0.95, f.y)) * mull;
  lit = mix(on * m, uLit * 0.12, far);
  wall *= 1.0 - 0.25 * smoothstep(3.0, 0.0, vFac.y);
  wall *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.25, fract(cuv.y + 0.02))) * step(gH, vFac.y) * (1.0 - win);
}
diffuseColor.rgb = mix(wall, glass, win);
`;

export function createFacadeMaterial(far = false) {
  const lit = { value: 0.5 };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 1 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.night;
    s.uniforms.uTime = U.time;
    s.uniforms.uLit = lit;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aFac; attribute float aTop; varying vec4 vFac; varying float vTop; varying vec3 vWp; varying vec3 vNw;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvFac = aFac; vTop = aTop; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vNw = normalize(mat3(modelMatrix) * objectNormal);",
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + MAIN)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0 - gloss, win);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = max(metalnessFactor, metal * win);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += litCol * lit * uNight * 0.9;");
    if (far) farPatch(s);
  };
  m.customProgramCacheKey = () => (far ? "facadeFar1" : "facade1");
  return { material: m, lit };
}
