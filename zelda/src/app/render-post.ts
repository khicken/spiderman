import * as THREE from "three";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import type { QualityPreset } from "./contracts";
import type { RenderTiming } from "./render-timing";

// Post chain: scene -> HDR target (MSAA samples on high/ultra) -> [bloom: bright pass + 2 blurs at 1/4 res] ->
// composite (grade, flash, shoulder, paper grain, vignette; FXAA folded in on low) -> screen. On medium the composite
// writes an 8-bit sRGB target and SMAA (edges, weights, blend) takes it to the screen.
// v2 removed the depth-laplacian ink: it inked every grass blade and cost ~13 depth taps per pixel.

const FS_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tBloom;
uniform vec2 uTexel; uniform float uBloom; uniform float uSat; uniform vec3 uTint; uniform float uFlash; uniform float uRain;
uniform vec2 uRes;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
#if HM_FXAA
// FXAA on the linear HDR scene, with luma taken in a gamma-like space (sqrt) so dark edges are found too.
float fl(vec3 c) { return sqrt(clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0)); }
vec3 tc(vec2 uv) { return min(texture2D(tColor, uv).rgb, vec3(4.0)); }
vec3 fxaa(vec2 uv) {
  vec2 px = uTexel;
  vec3 cM = tc(uv);
  vec3 cNW = tc(uv + vec2(-px.x, -px.y)), cNE = tc(uv + vec2(px.x, -px.y));
  vec3 cSW = tc(uv + vec2(-px.x, px.y)), cSE = tc(uv + vec2(px.x, px.y));
  float lM = fl(cM), lNW = fl(cNW), lNE = fl(cNE), lSW = fl(cSW), lSE = fl(cSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return cM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, -8.0, 8.0) * px;
  vec3 a = 0.5 * (tc(uv - dir * (1.0 / 6.0)) + tc(uv + dir * (1.0 / 6.0)));
  vec3 b = a * 0.5 + 0.25 * (tc(uv - dir * 0.5) + tc(uv + dir * 0.5));
  float lb = fl(b);
  return (lb < lMin || lb > lMax) ? a : b;
}
#endif
void main() {
  vec2 uv = vUv;
  vec2 px = uv * uRes;
#if HM_FXAA
  vec3 col = fxaa(uv);
#else
  vec3 col = texture2D(tColor, uv).rgb;
#endif

#if HM_BLOOM
  col += texture2D(tBloom, uv).rgb * uBloom;
#endif

  // grade: lift shadows toward the time-of-day tint, saturation, rain greys and cools
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSat);
  col += uTint * 0.06 * (1.0 - smoothstep(0.0, 0.45, lum));
  col = mix(col, col * vec3(0.92, 0.97, 1.02), uRain * 0.6);
  col = mix(col, vec3(0.85, 0.9, 1.0) * max(lum, 0.6) * 1.5, uFlash * 0.45);

  // soft shoulder: keeps mid tones, rolls highlights to paper white
  vec3 hi = 0.78 + 0.22 * (1.0 - exp(-(col - 0.78) / 0.22));
  col = mix(col, hi, step(0.78, col));

  // paper: fiber grain, a warm vignette
  float g = vnoise(px * 0.55) * 0.6 + vnoise(px * 0.13 + 7.0) * 0.4;
  col *= 0.975 + 0.05 * g;
  vec2 q = uv - 0.5;
  float vig = smoothstep(0.35, 0.85, length(q * vec2(1.0, 0.8)));
  col = mix(col, col * vec3(0.86, 0.8, 0.7), vig * 0.38);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
#if HM_SMAA
  // SMAA reads and writes display-encoded color and writes straight to the screen
  gl_FragColor = sRGBTransferOETF(gl_FragColor);
#else
  #include <colorspace_fragment>
#endif
}`;

const BRIGHT = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold;
varying vec2 vUv;
vec3 pick(vec2 uv) {
  vec4 c = texture2D(tColor, uv);
  float glow = 1.0 - c.a;
  float l = max(c.r, max(c.g, c.b));
  float k = max(0.0, l - uThreshold) / max(l, 1e-4);
  return c.rgb * max(glow, k);
}
void main() {
  vec2 o = uTexel;
  vec3 s = pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(min(s * 0.25, vec3(8.0)), 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tColor, vUv).rgb * 0.227;
  s += (texture2D(tColor, vUv + uDir * 1.385).rgb + texture2D(tColor, vUv - uDir * 1.385).rgb) * 0.316;
  s += (texture2D(tColor, vUv + uDir * 3.231).rgb + texture2D(tColor, vUv - uDir * 3.231).rgb) * 0.07;
  gl_FragColor = vec4(s, 1.0);
}`;

export interface PostGrade {
  sat: number;
  tint: THREE.Color;
  flash: number;
  rain: number;
  fog: THREE.Color;
  fogFar: number;
}

export interface Post {
  readonly target: THREE.WebGLRenderTarget;
  setPreset(p: QualityPreset): void;
  /** Size of the drawing buffer in device px. The scene target matches it: dynamic resolution resizes the buffer. */
  setSize(w: number, h: number): void;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, g: PostGrade, time: number): void;
  dispose(): void;
}

const hdr = (): THREE.RenderTargetOptions => ({
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  generateMipmaps: false,
});

export function createPost(renderer: THREE.WebGLRenderer, preset: QualityPreset, timing?: RenderTiming): Post {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  tri.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  const comp = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: COMPOSITE,
    uniforms: {
      tColor: { value: null }, tBloom: { value: black },
      uTexel: { value: new THREE.Vector2() }, uBloom: { value: 0.7 }, uSat: { value: 1 },
      uTint: { value: new THREE.Color() }, uFlash: { value: 0 }, uRain: { value: 0 }, uRes: { value: new THREE.Vector2() },
    },
    defines: { HM_BLOOM: 0, HM_FXAA: 0, HM_SMAA: 0 },
    depthTest: false,
    depthWrite: false,
  });
  const bright = new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: BRIGHT,
    uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.4 } },
    depthTest: false, depthWrite: false,
  });
  const blur = new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: BLUR,
    uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false,
  });

  const quad = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(tri, comp);
  quad.frustumCulled = false;

  let p = preset;
  let samples = -1;
  let target = new THREE.WebGLRenderTarget(1, 1);
  const bloomA = new THREE.WebGLRenderTarget(1, 1, hdr());
  const bloomB = new THREE.WebGLRenderTarget(1, 1, hdr());
  let smaa: SMAAPass | null = null;
  let ldr: THREE.WebGLRenderTarget | null = null;
  let W = 1, H = 1;

  const makeTarget = () => {
    const s = p.aa === "msaa" ? p.msaa : 0;
    if (s === samples) return;
    samples = s;
    target.dispose();
    target = new THREE.WebGLRenderTarget(1, 1, { ...hdr(), depthBuffer: true, samples: s });
    resizeTargets();
  };

  const makeSmaa = () => {
    if (p.aa === "smaa" && !smaa) {
      smaa = new SMAAPass();
      smaa.renderToScreen = true;
      ldr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false });
    } else if (p.aa !== "smaa" && smaa) {
      smaa.dispose();
      ldr?.dispose();
      smaa = null;
      ldr = null;
    }
  };

  const resizeTargets = () => {
    const w = Math.max(1, W), h = Math.max(1, H);
    target.setSize(w, h);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    bloomA.setSize(bw, bh);
    bloomB.setSize(bw, bh);
    ldr?.setSize(w, h);
    smaa?.setSize(w, h);
    comp.uniforms.uTexel.value.set(1 / w, 1 / h);
    comp.uniforms.uRes.value.set(w, h);
    bright.uniforms.uTexel.value.set(1 / w, 1 / h);
  };

  const pass = (m: THREE.Material, out: THREE.WebGLRenderTarget | null) => {
    quad.material = m;
    renderer.setRenderTarget(out);
    renderer.render(quad, cam);
  };

  const post: Post = {
    get target() {
      return target;
    },
    setPreset(np) {
      p = np;
      comp.defines = { HM_BLOOM: p.bloom ? 1 : 0, HM_FXAA: p.aa === "fxaa" ? 1 : 0, HM_SMAA: p.aa === "smaa" ? 1 : 0 };
      comp.needsUpdate = true;
      makeSmaa();
      makeTarget();
      resizeTargets();
    },
    setSize(w, h) {
      if (w === W && h === H) return;
      W = w; H = h;
      resizeTargets();
    },
    render(scene, camera, g) {
      timing?.switch("shadow");
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const U = comp.uniforms;
      if (p.bloom) {
        timing?.switch("bloom");
        bright.uniforms.tColor.value = target.texture;
        pass(bright, bloomA);
        blur.uniforms.tColor.value = bloomA.texture;
        blur.uniforms.uDir.value.set(1.6 / bloomA.width, 0);
        pass(blur, bloomB);
        blur.uniforms.tColor.value = bloomB.texture;
        blur.uniforms.uDir.value.set(0, 1.6 / bloomA.height);
        pass(blur, bloomA);
        U.tBloom.value = bloomA.texture;
      } else U.tBloom.value = black;
      U.tColor.value = target.texture;
      U.uSat.value = g.sat;
      U.uTint.value.copy(g.tint);
      U.uFlash.value = g.flash;
      U.uRain.value = g.rain;
      timing?.switch("post");
      if (smaa && ldr) {
        pass(comp, ldr);
        timing?.switch("aa");
        smaa.render(renderer, null as unknown as THREE.WebGLRenderTarget, ldr, 0, false);
      } else pass(comp, null);
    },
    dispose() {
      target.dispose();
      bloomA.dispose();
      bloomB.dispose();
      smaa?.dispose();
      ldr?.dispose();
      tri.dispose();
      comp.dispose();
      bright.dispose();
      blur.dispose();
      black.dispose();
    },
  };
  post.setPreset(preset);
  return post;
}
