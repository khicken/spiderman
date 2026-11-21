import * as THREE from "three";
import type { QualityPreset } from "./contracts";

// Post chain: scene -> HDR target (+depth texture) -> [bloom: bright pass + 2 blurs at 1/4 res] -> composite to screen.
// The composite draws depth-edge ink lines (ink brown, thinner with distance, fading into fog), watercolor edge
// darkening and paper grain, a color grade, the thunder flash and a soft shoulder tone curve.

const FS_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSITE = /* glsl */ `
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom;
uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform vec3 uInk; uniform vec3 uFog; uniform float uFogFar;
uniform float uBloom; uniform float uTime; uniform float uSat; uniform vec3 uTint; uniform float uFlash; uniform float uRain;
uniform float uInkScale; uniform vec2 uRes;
varying vec2 vUv;
float vz(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return d >= 0.99999 ? uFar * 4.0 : -perspectiveDepthToViewZ(d, uNear, uFar);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 uv = vUv;
  vec2 px = uv * uRes;
#if HM_INK > 0
  // watercolor bleed: a sub-pixel wobble on the color lookup only
  vec2 wob = vec2(vnoise(px * 0.045), vnoise(px * 0.045 + 31.7)) - 0.5;
  vec3 col = texture2D(tColor, uv + wob * uTexel * 1.3).rgb;
#else
  vec3 col = texture2D(tColor, uv).rgb;
#endif

  // ink: second difference of 1/z picks up silhouettes and creases; width shrinks with distance
  float zc = vz(uv);
  float w = mix(1.35, 0.75, smoothstep(4.0, 40.0, zc)) * uInkScale;
  vec2 o = uTexel * w;
  float ic = 1.0 / zc;
  float l = 1.0 / vz(uv - vec2(o.x, 0.0)), r = 1.0 / vz(uv + vec2(o.x, 0.0));
  float u = 1.0 / vz(uv + vec2(0.0, o.y)), dn = 1.0 / vz(uv - vec2(0.0, o.y));
  float lap = abs(l + r - 2.0 * ic) + abs(u + dn - 2.0 * ic);
  float mx = max(max(l, r), max(max(u, dn), ic));
#if HM_INK > 1
  float a = 1.0 / vz(uv + o), b = 1.0 / vz(uv - o), e = 1.0 / vz(uv + vec2(o.x, -o.y)), f = 1.0 / vz(uv + vec2(-o.x, o.y));
  lap += 0.5 * (abs(a + b - 2.0 * ic) + abs(e + f - 2.0 * ic));
  mx = max(mx, max(max(a, b), max(e, f)));
  float edge = smoothstep(0.045, 0.11, lap / max(mx, 1e-6));
#else
  float edge = smoothstep(0.04, 0.1, lap / max(mx, 1e-6));
#endif
  float zn = 1.0 / mx;
  float fade = 1.0 - smoothstep(uFogFar * 0.25, uFogFar * 0.8, zn);
  edge *= fade * (0.55 + 0.45 * vnoise(px * 0.3));
  vec3 inkC = mix(uInk, col * 0.45, 0.25);
  col = mix(col, inkC, edge * 0.85);

#if HM_INK > 0
  // watercolor edge darkening where pigment pools at color boundaries
  vec3 cl = texture2D(tColor, uv - vec2(uTexel.x, 0.0)).rgb, cr = texture2D(tColor, uv + vec2(uTexel.x, 0.0)).rgb;
  vec3 cu = texture2D(tColor, uv + vec2(0.0, uTexel.y)).rgb, cd = texture2D(tColor, uv - vec2(0.0, uTexel.y)).rgb;
  float lc = dot(col, vec3(0.3, 0.55, 0.15));
  float gl = abs(dot(cl + cr + cu + cd, vec3(0.3, 0.55, 0.15)) - 4.0 * lc);
  col *= 1.0 - clamp(gl * 0.9, 0.0, 0.16);
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
  #include <colorspace_fragment>
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
  /** Size of the drawing buffer (device px) and the render scale for the scene target. */
  setSize(w: number, h: number, scale: number): void;
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

export function createPost(renderer: THREE.WebGLRenderer, preset: QualityPreset): Post {
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
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: black },
      uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uInk: { value: new THREE.Color("#2b2118") },
      uFog: { value: new THREE.Color() }, uFogFar: { value: 600 }, uBloom: { value: 0.85 }, uTime: { value: 0 }, uSat: { value: 1 },
      uTint: { value: new THREE.Color() }, uFlash: { value: 0 }, uRain: { value: 0 }, uInkScale: { value: 1 }, uRes: { value: new THREE.Vector2() },
    },
    defines: { HM_INK: 1, HM_BLOOM: 0 },
    depthTest: false,
    depthWrite: false,
  });
  const bright = new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: BRIGHT,
    uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.25 } },
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
  let W = 1, H = 1, S = 1;

  const makeTarget = () => {
    const s = p.outline === 2 && p.bloom ? 4 : 0;
    if (s === samples) return;
    samples = s;
    target.depthTexture?.dispose();
    target.dispose();
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    target = new THREE.WebGLRenderTarget(1, 1, { ...hdr(), depthBuffer: true, depthTexture: depth, samples: s });
    resizeTargets();
  };

  const resizeTargets = () => {
    const w = Math.max(1, Math.round(W * S)), h = Math.max(1, Math.round(H * S));
    target.setSize(w, h);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    bloomA.setSize(bw, bh);
    bloomB.setSize(bw, bh);
    comp.uniforms.uTexel.value.set(1 / w, 1 / h);
    comp.uniforms.uRes.value.set(w, h);
    comp.uniforms.uInkScale.value = Math.max(0.75, Math.min(1.6, h / 900));
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
      comp.defines = { HM_INK: p.outline === 0 ? 0 : p.outline, HM_BLOOM: p.bloom ? 1 : 0 };
      comp.needsUpdate = true;
      makeTarget();
    },
    setSize(w, h, scale) {
      if (w === W && h === H && scale === S) return;
      W = w; H = h; S = scale;
      resizeTargets();
    },
    render(scene, camera, g, time) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const U = comp.uniforms;
      if (p.bloom) {
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
      U.tDepth.value = target.depthTexture;
      U.uNear.value = camera.near;
      U.uFar.value = camera.far;
      U.uFog.value.copy(g.fog);
      U.uFogFar.value = g.fogFar;
      U.uTime.value = time;
      U.uSat.value = g.sat;
      U.uTint.value.copy(g.tint);
      U.uFlash.value = g.flash;
      U.uRain.value = g.rain;
      pass(comp, null);
    },
    dispose() {
      target.depthTexture?.dispose();
      target.dispose();
      bloomA.dispose();
      bloomB.dispose();
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
