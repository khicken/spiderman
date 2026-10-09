import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

// Shared typed arrays: UniformsUtils.clone copies them by reference, so every fog material sees updates.
export const FOG_SUN = new Float32Array([0, -1, 1]);
export const FOG_WARM = new Float32Array([0.85, 0.64, 0.49]);

export function patchFog() {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes("vFogPos")) return;
  const extra = { uFogSun: { value: FOG_SUN }, uFogWarm: { value: FOG_WARM } };
  Object.assign(THREE.UniformsLib.fog, extra);
  for (const sh of Object.values(THREE.ShaderLib)) if ("fogColor" in sh.uniforms) Object.assign(sh.uniforms, extra);
  C.fog_pars_vertex = "#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogPos;\n#endif";
  C.fog_vertex = "#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogPos = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif";
  C.fog_pars_fragment = "#ifdef USE_FOG\n uniform vec3 fogColor;\n uniform vec3 uFogSun;\n uniform vec3 uFogWarm;\n varying float vFogDepth;\n varying vec3 vFogPos;\n #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear;\n  uniform float fogFar;\n #endif\n#endif";
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogY = max( cameraPosition.y + vFogPos.y, 0.0 );
    float fogH = exp( - fogY / 90.0 );
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth * mix( 0.55, 1.12, fogH ) );
    fogFactor = max( fogFactor, smoothstep( fogFar * 0.82, fogFar, vFogDepth ) );
  #endif
  float fogSun = pow( max( dot( normalize( vFogPos.xz + 1e-4 ), uFogSun.xy ), 0.0 ), 6.0 ) * uFogSun.z;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, uFogWarm, fogSun * 0.6 ), fogFactor );
#endif`;
}

// One grade for every mode: the post pass and the Performance tone mapping chunk share it.
const GRADE = /* glsl */ `
vec3 pgRrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 pgAces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * pgRrt(I * c), 0.0, 1.0);
}
vec3 pgSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }
vec3 pgLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float pgLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 pgGrade(vec3 hdr, float exposure) {
  vec3 col = pgSrgb(pgAces(hdr * exposure / 0.6));
  float l = pgLuma(col);
  col = mix(vec3(l), col, 1.1);
  col += vec3(-0.016, 0.0, 0.026) * (1.0 - l) * (1.0 - l);
  col *= mix(vec3(1.0), vec3(1.045, 1.0, 0.93), l * l);
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.32);
  return col * 0.992 + vec3(0.004, 0.002, 0.009);
}
`;

export function patchToneMapping(renderer: THREE.WebGLRenderer) {
  const C = THREE.ShaderChunk;
  if (!C.tonemapping_pars_fragment.includes("pgGrade")) {
    C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(
      "vec3 CustomToneMapping( vec3 color ) { return color; }",
      GRADE + "vec3 CustomToneMapping( vec3 color ) { return pgLinear( clamp( pgGrade( color, toneMappingExposure ), 0.0, 1.0 ) ); }",
    );
  }
  renderer.toneMapping = THREE.CustomToneMapping;
}

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function fsMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
}

export const halfTarget = (type: THREE.TextureDataType = THREE.HalfFloatType) =>
  new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

class Bloom {
  levels: THREE.WebGLRenderTarget[] = [];
  private pre = fsMaterial(
    /* glsl */ `
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
    vec3 knee(vec3 c) { float b = max(c.r, max(c.g, c.b)); float s = clamp(b - uThreshold, 0.0, 1.5 * uThreshold + 1.0); return c * s / max(b, 1e-4); }
    void main() {
      vec3 c = knee(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb) + knee(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb)
             + knee(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb) + knee(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
      gl_FragColor = vec4(min(c * 0.25, vec3(40.0)), 1.0);
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
  private quad = new FullScreenQuad();
  threshold = 1.4;

  constructor(n: number) {
    for (let i = 0; i < n; i++) this.levels.push(halfTarget());
    this.up.blending = THREE.AdditiveBlending;
    this.up.transparent = true;
  }

  setSize(w: number, h: number) {
    this.levels.forEach((t, i) => t.setSize(Math.max(1, Math.round(w / 2 ** (i + 1))), Math.max(1, Math.round(h / 2 ** (i + 1)))));
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, src: THREE.Texture, sw: number, sh: number, dst: THREE.WebGLRenderTarget, clear: boolean) {
    m.uniforms.tSrc.value = src;
    m.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    this.quad.material = m;
    r.setRenderTarget(dst);
    if (clear) r.clear(true, false, false);
    this.quad.render(r);
  }

  render(r: THREE.WebGLRenderer, src: THREE.Texture, w: number, h: number) {
    const L = this.levels;
    this.pre.uniforms.uThreshold.value = this.threshold;
    this.pass(r, this.pre, src, w, h, L[0], false);
    for (let i = 1; i < L.length; i++) this.pass(r, this.down, L[i - 1].texture, L[i - 1].width, L[i - 1].height, L[i], false);
    for (let i = L.length - 2; i >= 0; i--) this.pass(r, this.up, L[i + 1].texture, L[i + 1].width, L[i + 1].height, L[i], false);
  }

  dispose() {
    this.levels.forEach((t) => t.dispose());
    this.pre.dispose();
    this.down.dispose();
    this.up.dispose();
    this.quad.dispose();
  }
}

const FINAL = /* glsl */ `
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom; uniform sampler2D tAO; uniform sampler2D tSSR;
uniform float uExposure; uniform float uVignette; uniform vec2 uSunUv; uniform float uSunGlow; uniform float uAspect;
uniform float uBloom; uniform float uAO; uniform float uSSR; uniform vec2 uAORes; uniform float uNear; uniform float uFar;
uniform float uSpeed; uniform float uTime; uniform float uWaterY; uniform mat4 uInvProj; uniform mat4 uCamWorld;
varying vec2 vUv;
${GRADE}
float sky(vec2 uv) { return step(0.99999, texture2D(tDepth, clamp(uv, vec2(0.001), vec2(0.999))).r); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  float vz = -perspectiveDepthToViewZ(d, uNear, uFar);
  if (uSSR > 0.0 && d < 0.99999) {
    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    float wy = (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).y;
    if (abs(wy - uWaterY) < 0.12) {
      vec4 s = texture2D(tSSR, vUv);
      col = mix(col, s.rgb, s.a);
    }
  }
  if (uAO > 0.0 && d < 0.99999) {
    vec2 p = vUv * uAORes - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    float sum = 0.0, wsum = 1e-4;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
      vec2 a = texture2D(tAO, (i + o + 0.5) / uAORes).rg;
      float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y) + 1e-3;
      w /= 1e-3 + abs(a.g - vz) / vz * 40.0;
      sum += a.r * w;
      wsum += w;
    }
    col *= mix(1.0, sum / wsum, uAO);
  }
  if (uBloom > 0.0) col += texture2D(tBloom, vUv).rgb * uBloom;
  if (uSunGlow > 0.0) {
    vec2 o = vec2(0.012 / uAspect, 0.012);
    float vis = (sky(uSunUv) + sky(uSunUv + o) + sky(uSunUv - o) + sky(uSunUv + vec2(o.x, -o.y)) + sky(uSunUv - vec2(o.x, -o.y))) / 5.0;
    vec2 dd = (vUv - uSunUv) * vec2(uAspect, 1.0);
    float r = length(dd);
    float glow = 0.06 * exp(-r * 7.0) + 0.2 * exp(-r * 26.0);
    float streak = 0.04 * exp(-abs(dd.y) * 90.0) * exp(-abs(dd.x) * 3.0);
    col += vec3(1.0, 0.62, 0.36) * (glow + streak) * vis * uSunGlow;
  }
  col = pgGrade(col, uExposure);
  vec2 v = vUv - 0.5;
  if (uSpeed > 0.0) {
    vec2 q = v * vec2(uAspect, 1.0);
    float r = length(q);
    float k = (atan(q.y, q.x) + 3.14159) * 9.549;
    float id = floor(k);
    float h = fract(sin(id * 91.7) * 43758.5);
    float lane = smoothstep(0.55, 1.0, 1.0 - abs(fract(k) - 0.5) * 2.0);
    float flow = fract(r * 1.4 - uTime * (1.6 + h) + h * 7.0);
    float seg = smoothstep(0.0, 0.15, flow) * smoothstep(0.65, 0.3, flow);
    float edge = smoothstep(0.34, 0.66, r) * step(0.5, h);
    col = mix(col, vec3(1.0), lane * seg * edge * uSpeed * 0.3);
  }
  col *= 1.0 - dot(v, v) * uVignette;
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export type PostOpts = { samples: number; bloomLevels: number };

export class Post {
  readonly target: THREE.WebGLRenderTarget;
  bloom: Bloom | null;
  bloomStrength = 0;
  glow = 1;
  speed = 0;
  width = 1;
  height = 1;
  private quad = new FullScreenQuad();
  readonly final = fsMaterial(FINAL, {
    tColor: { value: null },
    tDepth: { value: null },
    tBloom: { value: null },
    tAO: { value: null },
    tSSR: { value: null },
    uExposure: { value: 1 },
    uVignette: { value: 0.85 },
    uSunUv: { value: new THREE.Vector2(-9, -9) },
    uSunGlow: { value: 0 },
    uAspect: { value: 1 },
    uBloom: { value: 0 },
    uAO: { value: 0 },
    uSSR: { value: 0 },
    uAORes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uSpeed: { value: 0 },
    uTime: { value: 0 },
    uWaterY: { value: -0.6 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
  });

  constructor(o: PostOpts) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: o.samples });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.bloom = o.bloomLevels ? new Bloom(o.bloomLevels) : null;
    const u = this.final.uniforms;
    u.tColor.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    if (this.bloom) u.tBloom.value = this.bloom.levels[0].texture;
  }

  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.target.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, t: number) {
    const u = this.final.uniforms;
    u.uExposure.value = renderer.toneMappingExposure;
    u.uAspect.value = camera.aspect;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uSpeed.value = this.speed;
    u.uTime.value = t % 1000;
    camera.getWorldDirection(_f);
    const facing = _f.dot(sunDir);
    u.uSunGlow.value = THREE.MathUtils.smoothstep(facing, 0.35, 0.85) * this.glow;
    if (facing > 0) {
      _v.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      u.uSunUv.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    }
  }

  renderScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
  }

  renderBloom(renderer: THREE.WebGLRenderer) {
    const on = !!this.bloom && this.bloomStrength > 0.01;
    this.final.uniforms.uBloom.value = on ? this.bloomStrength : 0;
    if (on) this.bloom!.render(renderer, this.target.texture, this.width, this.height);
  }

  renderFinal(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(null);
    this.quad.material = this.final;
    this.quad.render(renderer);
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.bloom?.dispose();
    this.final.dispose();
    this.quad.dispose();
  }
}
