import * as THREE from "three";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { blit, fsMaterial, noiseTexture, releaseNoise, target } from "./render-shared";
import { passMaterials, type PassMaterials } from "./render-passes";

export type Tier = {
  msaa: number;
  ao: 0 | 1 | 2; // off, half res, full res
  aoSamples: number;
  ssr: 0 | 1 | 2;
  ssrSteps: number;
  ssrRefine: number;
  bloom: number; // mip levels, 0 off
  blur: number; // motion blur samples, 0 off
  dof: number;
  aa: "fxaa" | "smaa";
  lens: boolean; // chromatic aberration, rain drops, ghosts
  prepass: boolean;
};

const GRADE = /* glsl */ `
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * rrt(I * c), 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 grade(vec3 hdr) {
  vec3 col = srgb(aces(hdr * 1.6));
  float l = luma(col);
  col = mix(vec3(l), col, 1.12);
  col += vec3(-0.012, 0.002, 0.022) * (1.0 - l) * (1.0 - l);
  col *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), l * l);
  col = clamp(col, 0.0, 1.0);
  return mix(col, col * col * (3.0 - 2.0 * col), 0.18);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tBloom; uniform sampler2D tLum; uniform sampler2D tDepth; uniform sampler2D tNoise;
uniform vec2 uTexel; uniform float uBloom; uniform vec3 uExpo; uniform float uAspect; uniform float uTime;
uniform vec2 uSunUv; uniform vec3 uFlare; uniform float uCA; uniform float uDrops; uniform float uVignette; uniform float uGrain;
varying vec2 vUv;
${GRADE}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 tap(vec2 uv) { return texture2D(tColor, uv).rgb; }
float tl(vec3 c) { float l = luma(c) * uExpo.x * 4.0; return l / (1.0 + l); }
vec3 fxaa(vec2 uv) {
  vec2 t = uTexel;
  vec3 nw = tap(uv + vec2(-1.0, -1.0) * t), ne = tap(uv + vec2(1.0, -1.0) * t), sw = tap(uv + vec2(-1.0, 1.0) * t), se = tap(uv + vec2(1.0, 1.0) * t), m = tap(uv);
  float lnw = tl(nw), lne = tl(ne), lsw = tl(sw), lse = tl(se), lm = tl(m);
  float lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (hi - lo < max(0.0312, hi * 0.125)) return m;
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * t;
  vec3 a = 0.5 * (tap(uv - dir / 6.0) + tap(uv + dir / 6.0));
  vec3 b = a * 0.5 + 0.25 * (tap(uv - dir * 0.5) + tap(uv + dir * 0.5));
  float lb = tl(b);
  return (lb < lo || lb > hi) ? a : b;
}
vec2 drops(vec2 uv) {
  vec2 q = uv * vec2(uAspect, 1.0) * 9.0;
  vec2 off = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    float s = 1.0 + float(k) * 1.7;
    vec2 p = q * s + vec2(0.0, uTime * (0.05 + 0.25 * float(k)));
    vec2 id = floor(p);
    float h = hash(id + float(k) * 13.0);
    float cyc = fract(uTime * (0.15 + 0.2 * h) + h);
    vec2 c = (vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5) * 0.5;
    vec2 f = fract(p) - 0.5 - c;
    float r = (0.06 + 0.1 * hash(id + 5.1)) * (1.0 - cyc * 0.6) / s * 1.4;
    float dm = smoothstep(r, r * 0.4, length(f * vec2(1.0, 0.8))) * step(0.78, h) * smoothstep(1.0, 0.7, cyc);
    off += f * dm * 0.9 / s;
  }
  return off * uDrops / vec2(uAspect, 1.0) / 9.0;
}
float sky(vec2 uv) { return step(0.99999, texture2D(tDepth, clamp(uv, vec2(0.001), vec2(0.999))).r); }
void main() {
  vec2 uv = vUv;
#ifdef LENS
  if (uDrops > 0.0) uv += drops(uv) * 4.0;
#endif
  vec2 cv = uv - 0.5;
#ifdef FXAA
  vec3 col = fxaa(uv);
#elif defined(LENS)
  vec2 ca = cv * dot(cv, cv) * uCA;
  vec3 col = vec3(tap(uv - ca).r, tap(uv).g, tap(uv + ca).b);
#else
  vec3 col = tap(uv);
#endif
#ifdef BLOOM
  col += texture2D(tBloom, uv).rgb * uBloom;
#endif
  float lum = texture2D(tLum, vec2(0.5)).r;
  col *= clamp(uExpo.x / exp(lum), uExpo.y, uExpo.z);
  if (uFlare.x > 0.0) {
    vec2 o = vec2(0.01 / uAspect, 0.01);
    float vis = (sky(uSunUv) + sky(uSunUv + o) + sky(uSunUv - o) + sky(uSunUv + vec2(o.x, -o.y)) + sky(uSunUv - vec2(o.x, -o.y))) * 0.2;
    vec2 dd = (uv - uSunUv) * vec2(uAspect, 1.0);
    float r = length(dd);
    float glow = 0.05 * exp(-r * 5.0) + 0.25 * exp(-r * 28.0);
    float streak = 0.05 * exp(-abs(dd.y) * 140.0) * exp(-abs(dd.x) * 2.5);
    vec3 f = vec3(1.0, 0.7, 0.45) * (glow + streak);
#ifdef LENS
    vec2 axis = 0.5 - uSunUv;
    for (int i = 0; i < 5; i++) {
      float k = 0.4 + float(i) * 0.38;
      vec2 g = (uv - (uSunUv + axis * k * 2.0)) * vec2(uAspect, 1.0);
      float sz = 0.02 + 0.03 * fract(float(i) * 0.618);
      vec3 tint = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.5, 0.2), fract(float(i) * 0.37));
      f += tint * smoothstep(sz, sz * 0.6, length(g)) * 0.012;
    }
    float halo = smoothstep(0.03, 0.0, abs(length((uv - 0.5 - axis * 0.25) * vec2(uAspect, 1.0)) - 0.42));
    f += vec3(0.6, 0.8, 1.0) * halo * 0.006;
#endif
    col += f * vis * uFlare;
  }
  col = grade(col);
  col *= 1.0 - dot(cv, cv) * uVignette;
  float gn = hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5;
  col += gn * uGrain * (1.0 - luma(col) * 0.7) + gn / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const LUM = /* glsl */ `
uniform sampler2D tSrc; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float w = 0.25 + exp(-dot(vUv - vec2(0.5, 0.45), vUv - vec2(0.5, 0.45)) * 8.0);
  gl_FragColor = vec4(log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4)) * w, w, 0.0, 1.0);
}`;
const DOWN4 = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec2 s = vec2(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) s += texture2D(tSrc, vUv + (vec2(float(x), float(y)) - 1.5) * uTexel).rg;
  gl_FragColor = vec4(s / 16.0, 0.0, 1.0);
}`;
const ADAPT = /* glsl */ `
uniform sampler2D tPrev; uniform sampler2D tCur; uniform float uDt; uniform float uReset; varying vec2 vUv;
void main() {
  vec2 c = texture2D(tCur, vec2(0.5)).rg;
  float target = c.r / max(c.g, 1e-4);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float rate = target > prev ? 2.2 : 1.1;
  float v = uReset > 0.5 ? target : prev + (target - prev) * (1.0 - exp(-uDt * rate));
  gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
}`;
const RESAMPLE = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uOut; varying vec2 vUv;
void main() {
  vec2 o = 0.25 / uOut;
  vec3 c = texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + o).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

class Bloom {
  levels: THREE.WebGLRenderTarget[] = [];
  private pre = fsMaterial(
    /* glsl */ `
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
    vec3 knee(vec3 c) { float b = max(c.r, max(c.g, c.b)); float s = clamp(b - uThreshold, 0.0, 1.5 * uThreshold + 1.0); return c * s / max(b, 1e-4); }
    void main() {
      vec3 c = knee(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb) + knee(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb)
             + knee(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb) + knee(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
      gl_FragColor = vec4(min(c * 0.25, vec3(60.0)), 1.0);
    }`,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 } },
  );
  private down = fsMaterial(
    /* glsl */ `
    uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
      c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
      c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
      gl_FragColor = vec4(c / 8.0, 1.0);
    }`,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
  );
  private up = fsMaterial(
    /* glsl */ `
    uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      vec2 t = uTexel;
      vec3 c = texture2D(tSrc, vUv + vec2(-2.0 * t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(2.0 * t.x, 0.0)).rgb;
      c += texture2D(tSrc, vUv + vec2(0.0, -2.0 * t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0 * t.y)).rgb;
      c += (texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb
          + texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb) * 2.0;
      gl_FragColor = vec4(c / 12.0, 1.0);
    }`,
    { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
  );
  threshold = 1.5;

  constructor(n: number) {
    for (let i = 0; i < n; i++) this.levels.push(target());
    this.up.blending = THREE.AdditiveBlending;
    this.up.transparent = true;
  }

  setSize(w: number, h: number) {
    this.levels.forEach((t, i) => t.setSize(Math.max(1, Math.round(w / 2 ** (i + 1))), Math.max(1, Math.round(h / 2 ** (i + 1)))));
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, src: THREE.Texture, sw: number, sh: number, dst: THREE.WebGLRenderTarget) {
    m.uniforms.tSrc.value = src;
    m.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    blit(r, m, dst);
  }

  render(r: THREE.WebGLRenderer, src: THREE.Texture, w: number, h: number) {
    const L = this.levels;
    this.pre.uniforms.uThreshold.value = this.threshold;
    this.pass(r, this.pre, src, w, h, L[0]);
    for (let i = 1; i < L.length; i++) this.pass(r, this.down, L[i - 1].texture, L[i - 1].width, L[i - 1].height, L[i]);
    for (let i = L.length - 2; i >= 0; i--) this.pass(r, this.up, L[i + 1].texture, L[i + 1].width, L[i + 1].height, L[i]);
  }

  dispose() {
    this.levels.forEach((t) => t.dispose());
    this.pre.dispose();
    this.down.dispose();
    this.up.dispose();
  }
}

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();

export type FrameInfo = {
  dt: number;
  time: number;
  sunDir: THREE.Vector3;
  sunUp: number; // 0..1, flare strength
  wet: number;
  speed: number; // m/s
  drops: number;
  focusDist: number;
  showroom: boolean;
  key: number; // exposure key
  minE: number;
  maxE: number;
  bloom: number;
  threshold: number;
};

export class Post {
  readonly scene: THREE.WebGLRenderTarget;
  normal: THREE.WebGLRenderTarget | null = null;
  private aoA: THREE.WebGLRenderTarget | null = null;
  private aoB: THREE.WebGLRenderTarget | null = null;
  private ssrT: THREE.WebGLRenderTarget | null = null;
  private comp = target();
  private comp2 = target();
  private ldr: THREE.WebGLRenderTarget | null = null;
  private aaT: THREE.WebGLRenderTarget | null = null;
  private bloom: Bloom | null;
  private smaa: SMAAPass | null = null;
  private lum = [64, 16, 4, 1].map(() => target(THREE.HalfFloatType, THREE.NearestFilter));
  private adapt = [target(THREE.HalfFloatType, THREE.NearestFilter), target(THREE.HalfFloatType, THREE.NearestFilter)];
  private adaptI = 0;
  private reset = true;
  private m: PassMaterials;
  private lumM = fsMaterial(LUM, { tSrc: { value: null } });
  private downM = fsMaterial(DOWN4, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private adaptM = fsMaterial(ADAPT, { tPrev: { value: null }, tCur: { value: null }, uDt: { value: 0 }, uReset: { value: 1 } });
  private resampleM = fsMaterial(RESAMPLE, { tSrc: { value: null }, uOut: { value: new THREE.Vector2(1, 1) } });
  readonly final: THREE.ShaderMaterial;
  private prevVP = new THREE.Matrix4();
  private prevPos = new THREE.Vector3();
  private hasPrev = false;
  width = 1;
  height = 1;
  outW = 1;
  outH = 1;

  constructor(readonly tier: Tier) {
    const t = tier;
    this.scene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: t.msaa });
    this.scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    if (t.prepass) {
      this.normal = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    }
    if (t.ao) {
      this.aoA = target(THREE.HalfFloatType, THREE.NearestFilter);
      this.aoB = target(THREE.HalfFloatType, THREE.NearestFilter);
    }
    if (t.ssr) this.ssrT = target();
    this.bloom = t.bloom ? new Bloom(t.bloom) : null;
    if (t.aa === "smaa") {
      this.smaa = new SMAAPass();
      this.ldr = target(THREE.UnsignedByteType);
    }
    this.m = passMaterials({ aoSamples: t.aoSamples, ssrSteps: t.ssrSteps, ssrRefine: t.ssrRefine, blurSamples: t.blur, dofSamples: t.dof, prepass: t.prepass });
    const defines: Record<string, number> = {};
    if (t.aa === "fxaa") defines.FXAA = 1;
    if (t.lens) defines.LENS = 1;
    if (t.bloom) defines.BLOOM = 1;
    this.final = fsMaterial(
      FINAL,
      {
        tColor: { value: null },
        tBloom: { value: this.bloom?.levels[0].texture ?? null },
        tLum: { value: null },
        tDepth: { value: this.scene.depthTexture },
        tNoise: { value: noiseTexture() },
        uTexel: { value: new THREE.Vector2() },
        uBloom: { value: 0 },
        uExpo: { value: new THREE.Vector3(0.2, 0.3, 3) },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uSunUv: { value: new THREE.Vector2(-9, -9) },
        uFlare: { value: new THREE.Color(0, 0, 0) },
        uCA: { value: 0 },
        uDrops: { value: 0 },
        uVignette: { value: 0.55 },
        uGrain: { value: 0.025 },
      },
      defines,
    );
  }

  setSize(w: number, h: number, outW: number, outH: number) {
    this.width = w;
    this.height = h;
    this.outW = outW;
    this.outH = outH;
    this.scene.setSize(w, h);
    this.normal?.setSize(w, h);
    const aoDiv = this.tier.ao === 2 ? 1 : 2;
    const aw = Math.max(1, Math.round(w / aoDiv)), ah = Math.max(1, Math.round(h / aoDiv));
    this.aoA?.setSize(aw, ah);
    this.aoB?.setSize(aw, ah);
    this.m.ao.uniforms.uRes.value.set(aw, ah);
    this.m.resolve.uniforms.uAORes.value.set(aw, ah);
    const sd = this.tier.ssr === 2 ? 1 : 2;
    const sw = Math.max(1, Math.round(w / sd)), sh = Math.max(1, Math.round(h / sd));
    this.ssrT?.setSize(sw, sh);
    this.m.ssr.uniforms.uRes.value.set(sw, sh);
    this.comp.setSize(w, h);
    this.comp2.setSize(w, h);
    this.ldr?.setSize(w, h);
    this.smaa?.setSize(w, h);
    if (this.smaa && (w !== outW || h !== outH)) {
      this.aaT ??= target(THREE.UnsignedByteType);
      this.aaT.setSize(w, h);
    }
    this.bloom?.setSize(w, h);
    this.lum.forEach((t, i) => t.setSize([64, 16, 4, 1][i], [64, 16, 4, 1][i]));
    this.adapt.forEach((t) => t.setSize(1, 1));
    this.m.blur.uniforms.uRes.value.set(w, h);
    this.m.dof.uniforms.uRes.value.set(w, h);
    this.final.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.resampleM.uniforms.uOut.value.set(outW, outH);
  }

  resetHistory() {
    this.reset = true;
    this.hasPrev = false;
  }

  private setView(u: Record<string, THREE.IUniform>, camera: THREE.PerspectiveCamera) {
    u.tDepth.value = this.scene.depthTexture;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    if (this.normal) u.tNormal.value = this.normal.texture;
  }

  render(r: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, f: FrameInfo) {
    const t = this.tier;
    const m = this.m;
    let src: THREE.Texture = this.scene.texture;
    const depth = this.scene.depthTexture!;
    const near = camera.near, far = camera.far;

    if (this.aoA && this.aoB) {
      this.setView(m.ao.uniforms, camera);
      blit(r, m.ao, this.aoA);
      const res = m.ao.uniforms.uRes.value as THREE.Vector2;
      m.aoBlur.uniforms.tSrc.value = this.aoA.texture;
      m.aoBlur.uniforms.uDir.value.set(1 / res.x, 0);
      blit(r, m.aoBlur, this.aoB);
      m.aoBlur.uniforms.tSrc.value = this.aoB.texture;
      m.aoBlur.uniforms.uDir.value.set(0, 1 / res.y);
      blit(r, m.aoBlur, this.aoA);
    }
    const ssrOn = !!this.ssrT && (f.wet > 0.02 || t.prepass);
    if (ssrOn) {
      const u = m.ssr.uniforms;
      this.setView(u, camera);
      u.tColor.value = src;
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uWet.value = f.wet;
      u.uTime.value = f.time % 100;
      blit(r, m.ssr, this.ssrT);
    }
    if (this.aoA || ssrOn) {
      const u = m.resolve.uniforms;
      u.tColor.value = src;
      u.tDepth.value = depth;
      u.tAO.value = this.aoA?.texture ?? null;
      u.tSSR.value = this.ssrT?.texture ?? null;
      u.uAO.value = this.aoA ? 0.8 : 0;
      u.uSSR.value = ssrOn ? 1 : 0;
      u.uNear.value = near;
      u.uFar.value = far;
      blit(r, m.resolve, this.comp);
      src = this.comp.texture;
    }

    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const jump = this.hasPrev && camera.position.distanceToSquared(this.prevPos) > 400;
    if (t.blur && this.hasPrev && !jump) {
      const u = m.blur.uniforms;
      u.tColor.value = src;
      u.tDepth.value = depth;
      u.uPrevVP.value.copy(this.prevVP);
      u.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      u.uScale.value = THREE.MathUtils.clamp(0.5 / 60 / Math.max(f.dt, 1 / 240), 0.15, 0.6);
      u.uRadial.value = 0.035 * THREE.MathUtils.smoothstep(f.speed, 45, 90);
      u.uNear.value = near;
      u.uFar.value = far;
      u.uAspect.value = camera.aspect;
      const dst = src === this.comp.texture ? this.comp2 : this.comp;
      blit(r, m.blur, dst);
      src = dst.texture;
    }
    this.prevVP.copy(_m);
    this.prevPos.copy(camera.position);
    this.hasPrev = true;

    if (t.dof && f.showroom) {
      const u = m.dof.uniforms;
      u.tColor.value = src;
      u.tDepth.value = depth;
      u.uFocus.value = f.focusDist;
      u.uAperture.value = 0.3;
      u.uNear.value = near;
      u.uFar.value = far;
      const dst = src === this.comp.texture ? this.comp2 : this.comp;
      blit(r, m.dof, dst);
      src = dst.texture;
    }

    this.lumM.uniforms.tSrc.value = src;
    blit(r, this.lumM, this.lum[0]);
    for (let i = 1; i < 4; i++) {
      this.downM.uniforms.tSrc.value = this.lum[i - 1].texture;
      this.downM.uniforms.uTexel.value.set(1 / this.lum[i - 1].width, 1 / this.lum[i - 1].height);
      blit(r, this.downM, this.lum[i]);
    }
    const a = this.adaptM.uniforms;
    a.tPrev.value = this.adapt[this.adaptI].texture;
    a.tCur.value = this.lum[3].texture;
    a.uDt.value = f.dt;
    a.uReset.value = this.reset ? 1 : 0;
    this.reset = false;
    this.adaptI ^= 1;
    blit(r, this.adaptM, this.adapt[this.adaptI]);

    const on = !!this.bloom && f.bloom > 0.005;
    if (on) {
      this.bloom!.threshold = f.threshold;
      this.bloom!.render(r, src, this.width, this.height);
    }
    const u = this.final.uniforms;
    u.tColor.value = src;
    u.tLum.value = this.adapt[this.adaptI].texture;
    u.uBloom.value = on ? f.bloom : 0;
    u.uExpo.value.set(f.key, f.minE, f.maxE);
    u.uAspect.value = camera.aspect;
    u.uTime.value = f.time % 1000;
    u.uCA.value = t.lens ? 0.004 + 0.02 * THREE.MathUtils.smoothstep(f.speed, 40, 90) : 0;
    u.uDrops.value = t.lens ? f.drops : 0;
    camera.getWorldDirection(_f);
    const facing = THREE.MathUtils.smoothstep(_f.dot(f.sunDir), 0.2, 0.8) * f.sunUp;
    u.uFlare.value.setRGB(facing, facing, facing);
    if (facing > 0) {
      _v.copy(camera.position).addScaledVector(f.sunDir, 1000).project(camera);
      u.uSunUv.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    }
    if (!this.smaa) {
      blit(r, this.final, null);
      return;
    }
    blit(r, this.final, this.ldr);
    this.smaa.renderToScreen = !this.aaT;
    this.smaa.render(r, this.aaT!, this.ldr!, 0, false);
    if (this.aaT) {
      this.resampleM.uniforms.tSrc.value = this.aaT.texture;
      blit(r, this.resampleM, null);
    }
  }

  dispose() {
    this.scene.depthTexture?.dispose();
    this.scene.dispose();
    this.normal?.dispose();
    this.aoA?.dispose();
    this.aoB?.dispose();
    this.ssrT?.dispose();
    this.comp.dispose();
    this.comp2.dispose();
    this.ldr?.dispose();
    this.aaT?.dispose();
    this.bloom?.dispose();
    this.smaa?.dispose();
    this.lum.forEach((t) => t.dispose());
    this.adapt.forEach((t) => t.dispose());
    for (const k of Object.values(this.m)) k.dispose();
    this.lumM.dispose();
    this.downM.dispose();
    this.adaptM.dispose();
    this.resampleM.dispose();
    this.final.dispose();
    releaseNoise();
  }
}
