import * as THREE from "three";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import type { QualityPreset } from "./contracts";

// HDR post chain: scene -> half-float MSAA target (+depth) -> mip bloom -> composite (DOF, letterbox, ACES, grade,
// vignette, grain, edge fringe) -> optional FXAA -> screen.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uPrefilter;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
  float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
  return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}
void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (uPrefilter > 0.5) {
    col = karis(j, k, l, m) * 0.5 + karis(a, b, d, e) * 0.125 + karis(b, c, e, f) * 0.125 + karis(d, e, g, h) * 0.125 + karis(e, f, h, i) * 0.125;
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(64.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tLow; uniform sampler2D tCur; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D(tLow, vUv).rgb * 4.0;
  c += (texture2D(tLow, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(t.x, 0.0)).rgb
      + texture2D(tLow, vUv + vec2(0.0, -t.y)).rgb + texture2D(tLow, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tLow, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb
     + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(texture2D(tCur, vUv).rgb + c / 16.0, 1.0);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tBloom; uniform sampler2D tBlur; uniform sampler2D tDepth;
uniform float uBloom; uniform float uExposure; uniform float uTime; uniform float uVignette; uniform float uGrain;
uniform float uFringe; uniform float uDof; uniform float uFocus; uniform float uNear; uniform float uFar;
uniform float uLetterbox; uniform float uAspect; uniform float uFlash; uniform vec3 uFlashColor; uniform vec2 uDofPx;
varying vec2 vUv;
vec3 aces(vec3 color) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = I * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  return clamp(O * (a / b), 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float cocAt(float z) { return clamp(abs(z - uFocus) / max(uFocus * 0.55, 0.5) - 0.15, 0.0, 1.0) * uDof; }
void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  vec3 col;
  if (uFringe > 0.0) {
    vec2 off = dc * dot(dc, dc) * uFringe;
    col = vec3(texture2D(tColor, uv - off).r, texture2D(tColor, uv).g, texture2D(tColor, uv + off).b);
  } else col = texture2D(tColor, uv).rgb;
  if (uDof > 0.001) {
    float z = linDepth(texture2D(tDepth, uv).r);
    float coc = cocAt(z);
    vec3 bc = texture2D(tBlur, uv).rgb;
    // near-aware gather: the blur buffer smears in-focus figures over the background around them (a light halo).
    // Where nearer surfaces sit inside the blur footprint, the blurred color may not get brighter than this pixel's
    // own sharp color (the coc itself is left alone, so no hard sharp/blur seam appears around the figure).
    if (coc > 0.05) {
      float nearN = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982 + 0.39;
        vec2 o = vec2(cos(a), sin(a)) * uDofPx * (i < 4 ? 0.6 : 1.0);
        float zn = linDepth(texture2D(tDepth, uv + o).r);
        nearN += step(zn, z - 0.6);
      }
      bc = mix(bc, min(bc, col + 0.025), smoothstep(0.0, 0.5, nearN / 8.0));
    }
    col = mix(col, bc, coc);
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  col += uFlashColor * uFlash;
  col = aces(col * uExposure);
  float l = luma(col);
  col = mix(vec3(l), col, 1.1);
  col += vec3(-0.010, 0.002, 0.018) * (1.0 - l) * (1.0 - l);
  col *= mix(vec3(1.0), vec3(1.035, 1.0, 0.95), l * l);
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.14);
  if (uVignette > 0.0) {
    vec2 v = dc * vec2(uAspect, 1.0) / max(uAspect, 1.0);
    col *= mix(1.0, smoothstep(0.95, 0.25, length(v) * 1.15), uVignette);
  }
  col = srgb(col);
  float n = hash(uv * 1024.0 + fract(uTime * 7.31) * 113.0) - 0.5;
  col += n * (uGrain * (1.0 - abs(l - 0.5) * 1.2) + 1.0 / 255.0);
  if (uLetterbox > 0.0) {
    float bar = uLetterbox * 0.11;
    col *= step(bar, uv.y) * step(uv.y, 1.0 - bar);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Post {
  /** Target the scene is rendered into (linear HDR). */
  readonly target: THREE.WebGLRenderTarget;
  setSize(w: number, h: number): void;
  setPreset(p: QualityPreset): void;
  readonly params: {
    exposure: number;
    bloom: number;
    threshold: number;
    dof: number;
    focus: number;
    letterbox: number;
    flash: number;
    flashColor: THREE.Color;
  };
  /** Composite target -> screen. */
  finish(camera: THREE.PerspectiveCamera, time: number): void;
  dispose(): void;
}

const hdrOpts = (): THREE.RenderTargetOptions => ({
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  generateMipmaps: false,
});

export function createPost(renderer: THREE.WebGLRenderer, preset: QualityPreset): Post {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const mk = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

  const downMat = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uPrefilter: { value: 0 } });
  const upMat = mk(UP, { tLow: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
  const finalMat = mk(FINAL, {
    tColor: { value: null }, tBloom: { value: null }, tBlur: { value: null }, tDepth: { value: null },
    uBloom: { value: 0 }, uExposure: { value: 1 }, uTime: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 },
    uFringe: { value: 0 }, uDof: { value: 0 }, uDofPx: { value: new THREE.Vector2(0.006, 0.01) }, uFocus: { value: 20 }, uNear: { value: 0.1 }, uFar: { value: 400 },
    uLetterbox: { value: 0 }, uAspect: { value: 1 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
  });
  const fxaaMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FXAAShader.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false,
  });
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  let p = preset;
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const target = new THREE.WebGLRenderTarget(1, 1, { ...hdrOpts(), depthBuffer: true, depthTexture: depth, samples: p.msaa });
  const MIPS = 6;
  const down: THREE.WebGLRenderTarget[] = [];
  const up: THREE.WebGLRenderTarget[] = [];
  for (let i = 0; i < MIPS; i++) {
    down.push(new THREE.WebGLRenderTarget(1, 1, hdrOpts()));
    up.push(new THREE.WebGLRenderTarget(1, 1, hdrOpts()));
  }
  const blur = new THREE.WebGLRenderTarget(1, 1, hdrOpts());
  const blur2 = new THREE.WebGLRenderTarget(1, 1, hdrOpts());
  const ldr = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  let W = 1;
  let H = 1;

  const params = { exposure: 1, bloom: 0.06, threshold: 1.1, dof: 0, focus: 20, letterbox: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1) };

  function pass(mat: THREE.Material, out: THREE.WebGLRenderTarget | null) {
    quad.material = mat;
    renderer.setRenderTarget(out);
    renderer.render(quad, ortho);
  }

  function setSize(w: number, h: number) {
    W = Math.max(1, Math.floor(w));
    H = Math.max(1, Math.floor(h));
    target.setSize(W, H);
    let mw = W;
    let mh = H;
    for (let i = 0; i < MIPS; i++) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      down[i].setSize(mw, mh);
      up[i].setSize(mw, mh);
    }
    blur.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    blur2.setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
    ldr.setSize(W, H);
    (fxaaMat.uniforms.resolution.value as THREE.Vector2).set(1 / W, 1 / H);
  }

  function bloom() {
    const n = p.textureSize >= 1024 ? MIPS : 5;
    downMat.uniforms.uThreshold.value = params.threshold;
    let src: THREE.Texture = target.texture;
    let sw = W;
    let sh = H;
    for (let i = 0; i < n; i++) {
      downMat.uniforms.tSrc.value = src;
      (downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
      downMat.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
      pass(downMat, down[i]);
      src = down[i].texture;
      sw = down[i].width;
      sh = down[i].height;
    }
    let low: THREE.Texture = down[n - 1].texture;
    for (let i = n - 2; i >= 0; i--) {
      upMat.uniforms.tLow.value = low;
      upMat.uniforms.tCur.value = down[i].texture;
      (upMat.uniforms.uTexel.value as THREE.Vector2).set(1 / down[i + 1].width, 1 / down[i + 1].height);
      pass(upMat, up[i]);
      low = up[i].texture;
    }
    return low;
  }

  function dofBlur() {
    downMat.uniforms.uPrefilter.value = 0;
    downMat.uniforms.tSrc.value = target.texture;
    (downMat.uniforms.uTexel.value as THREE.Vector2).set(2 / W, 2 / H);
    pass(downMat, blur);
    downMat.uniforms.tSrc.value = blur.texture;
    (downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / blur.width, 1 / blur.height);
    pass(downMat, blur2);
    upMat.uniforms.tLow.value = blur2.texture;
    upMat.uniforms.tCur.value = black;
    (upMat.uniforms.uTexel.value as THREE.Vector2).set(1 / blur2.width, 1 / blur2.height);
    upMat.uniforms.uRadius.value = 1.5;
    pass(upMat, blur);
    upMat.uniforms.uRadius.value = 1;
    return blur.texture;
  }

  return {
    target,
    params,
    setSize,
    setPreset(next) {
      p = next;
      if (target.samples !== next.msaa) {
        target.samples = next.msaa;
        target.dispose();
      }
    },
    finish(camera, time) {
      const u = finalMat.uniforms;
      u.tColor.value = target.texture;
      u.tBloom.value = p.bloom && params.bloom > 0 ? bloom() : black;
      u.uBloom.value = p.bloom ? params.bloom : 0;
      const dof = p.dof ? params.dof : 0;
      u.uDof.value = dof;
      u.tBlur.value = dof > 0.001 ? dofBlur() : black;
      u.tDepth.value = depth;
      u.uFocus.value = params.focus;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uExposure.value = params.exposure;
      u.uTime.value = time;
      u.uVignette.value = p.vignette ? 0.55 : 0;
      u.uGrain.value = p.grain ? 0.035 : 0;
      u.uFringe.value = p.grain ? 0.005 : 0;
      u.uLetterbox.value = params.letterbox;
      u.uAspect.value = W / H;
      (u.uDofPx.value as THREE.Vector2).set(10 / W, 10 / H);
      u.uFlash.value = params.flash;
      (u.uFlashColor.value as THREE.Color).copy(params.flashColor);
      if (p.aa === "fxaa" || (p.aa === "smaa" && p.msaa === 0)) {
        pass(finalMat, ldr);
        fxaaMat.uniforms.tDiffuse.value = ldr.texture;
        pass(fxaaMat, null);
      } else pass(finalMat, null);
    },
    dispose() {
      tri.dispose();
      downMat.dispose();
      upMat.dispose();
      finalMat.dispose();
      fxaaMat.dispose();
      black.dispose();
      target.dispose();
      depth.dispose();
      for (const r of down) r.dispose();
      for (const r of up) r.dispose();
      blur.dispose();
      blur2.dispose();
      ldr.dispose();
    },
  };
}
