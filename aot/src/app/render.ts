import * as THREE from "three";
import type { Quality, Render } from "./contracts";

export const SUN_DIR = new THREE.Vector3(0.62, 0.74, -0.27).normalize();
export const HORIZON = new THREE.Color("#cfe2ee");
export const ZENITH = new THREE.Color("#1d55c4");

const PRESET: Record<Quality, { ratio: number; samples: number; shadow: number; ink: boolean; range: number }> = {
  low: { ratio: 1, samples: 0, shadow: 0, ink: false, range: 0 },
  medium: { ratio: 1.5, samples: 2, shadow: 2048, ink: true, range: 260 },
  high: { ratio: 2, samples: 4, shadow: 4096, ink: true, range: 340 },
};

const FS_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const INK_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 texel; uniform float near; uniform float far; uniform float ink; uniform vec3 inkColor; uniform vec3 haze;
varying vec2 vUv;
float W(vec2 uv) { float d = texture2D(tDepth, uv).x; return d >= 1.0 ? 0.0 : -1.0 / perspectiveDepthToViewZ(d, near, far); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  if (ink > 0.5) {
    vec2 o = texel;
    float c = W(vUv);
    float l = W(vUv - vec2(o.x, 0.0)), r = W(vUv + vec2(o.x, 0.0)), u = W(vUv + vec2(0.0, o.y)), dn = W(vUv - vec2(0.0, o.y));
    float a = W(vUv + o), b = W(vUv - o), e = W(vUv + vec2(o.x, -o.y)), f = W(vUv + vec2(-o.x, o.y));
    float m = max(max(c, max(l, r)), max(u, dn));
    float lap = abs(l + r - 2.0 * c) + abs(u + dn - 2.0 * c) + 0.5 * (abs(a + b - 2.0 * c) + abs(e + f - 2.0 * c));
    float edge = smoothstep(0.035, 0.09, lap / max(m, 1e-6));
    float z = m > 0.0 ? 1.0 / m : far;
    float fade = 1.0 - smoothstep(120.0, 1400.0, z) * 0.85;
    vec3 inkC = mix(inkColor, haze * 0.55, 1.0 - fade);
    col = mix(col, inkC, edge * (0.35 + 0.65 * fade));
  }
  gl_FragColor = vec4(col, 1.0);
  gl_FragDepth = d;
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tColor; uniform float time; uniform float speed; uniform float aspect; uniform float impact; uniform float impactKind; uniform float impactPhase; uniform float vignette;
varying vec2 vUv;
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 g = mix(vec3(lum), col, 1.12);
  g = mix(g * vec3(0.86, 0.89, 1.12), g * vec3(1.05, 1.0, 0.93), smoothstep(0.12, 0.65, lum));
  col = clamp(g, 0.0, 1.0);
  vec2 p = vUv - 0.5; p.x *= aspect;
  float r = length(p);
  float ang = atan(p.y, p.x) / 6.28318 + 0.5;
  if (speed > 0.01) {
    float cells = 140.0;
    float id = floor(ang * cells);
    float fr = fract(ang * cells);
    float h = hash(id + floor(time * 18.0) * 13.7);
    float h2 = hash(id * 3.1 + floor(time * 18.0));
    float inner = mix(1.0, 0.5, speed) + 0.25 * h2;
    float on = step(1.0 - speed * 0.5, h) * smoothstep(inner, inner + 0.2, r) * step(abs(fr - 0.5), 0.08 + 0.14 * h2);
    col = mix(col, vec3(1.0), on * 0.8);
  }
  col *= 1.0 - vignette * smoothstep(0.45, 1.05, r);
  if (impact > 0.5) {
    float cells = impactKind > 1.5 ? 70.0 : 46.0;
    float id = floor(ang * cells);
    float h = hash(id + impactPhase * 7.0);
    float ray = step(0.5, h) * smoothstep(0.18 + 0.25 * h, 0.75, r) * step(abs(fract(ang * cells) - 0.5), 0.12 + 0.3 * h);
    float red = step(2.6 * max(col.g, col.b), col.r) * step(0.2, col.r);
    float bw = step(0.32, lum);
    bool inv = impactKind > 1.5 ? mod(impactPhase, 2.0) < 0.5 : impactPhase < 0.5;
    vec3 o = inv ? vec3(1.0 - bw) : vec3(bw);
    if (impactKind < 0.5) o = mix(col, o, 0.65);
    o = mix(o, vec3(0.86, 0.04, 0.06), red);
    vec3 rc = impactKind > 0.5 ? (inv ? vec3(1.0) : vec3(0.0)) : vec3(0.0);
    col = mix(o, rc, ray * (impactKind > 0.5 ? 1.0 : 0.6));
    if (impactKind > 1.5 && impactPhase > 2.5) col = mix(col, vec3(0.9, 0.05, 0.08), 0.35 * smoothstep(0.3, 0.9, r));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const SKY_VERT = /* glsl */ `varying vec3 vDir; void main() { vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`;

const SKY_FRAG = /* glsl */ `
uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon;
varying vec3 vDir;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec4 layer(vec2 q, float base, float scale, float density, float seed) {
  q /= scale;
  float b = base / scale;
  float cell = floor(q.x);
  float best = 1e3; float near = 1e3; vec2 bn = vec2(0.0, 1.0);
  for (int k = -1; k <= 1; k++) {
    float cx = cell + float(k);
    if (h1(vec2(cx, seed)) > density) continue;
    float w = 0.45 + 0.5 * h1(vec2(cx, seed + 3.0));
    float off = (h1(vec2(cx, seed + 5.0)) - 0.5) * (1.0 - w);
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float u = (fi / 7.0 - 0.5) * 0.9 + (h1(vec2(cx + fi, seed + 2.3)) - 0.5) * 0.1;
      float prof = 1.0 - 4.0 * u * u;
      float rr = w * (0.07 + 0.13 * prof * (0.55 + 0.6 * h1(vec2(cx, seed + fi * 1.3))));
      float y = b + rr * 0.35 + w * 0.16 * prof * prof * h1(vec2(cx + 7.0, seed + fi));
      vec2 c = vec2(cx + 0.5 + off + u * w, y);
      float d = length(q - c) - rr;
      best = smin(best, d, 0.025);
      if (d < near) { near = d; bn = (q - c) / rr; }
    }
  }
  best = max(best, (b - q.y) * 2.0);
  return vec4(best, bn, (q.y - b) / 0.25);
}
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  float el = asin(clamp(e, -1.0, 1.0));
  vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.7, e), 0.4));
  col = mix(col, horizon * 1.04, smoothstep(0.08, -0.02, e) * 0.6);
  float s = dot(d, sunDir);
  col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.9965, 0.9975, s));
  col += vec3(1.0, 0.9, 0.7) * pow(max(s, 0.0), 40.0) * 0.18;
  float az = atan(d.z, d.x);
  vec2 sd = normalize(vec2(sunDir.x, sunDir.z));
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float scale = L == 0 ? 0.55 : 0.32;
    float base = L == 0 ? -0.01 : 0.22;
    vec2 q = vec2(az * (L == 0 ? 1.0 : 1.3) + fl * 2.0, el);
    vec4 c = layer(q, base, scale, L == 0 ? 0.85 : 0.4, 11.0 + fl * 5.0);
    float aa = 0.0045;
    float m = smoothstep(aa, -aa, c.x);
    if (m <= 0.0) continue;
    vec2 bn = normalize(c.yz + vec2(0.0, 0.001));
    float side = sign(dot(normalize(vec2(-d.z, d.x)), sd));
    float lit = 0.55 * bn.y + 0.3 * bn.x * side + 0.6 * (c.w - 0.3) + 0.15 * smoothstep(0.0, -0.08, c.x - 0.0) * 0.0;
    vec3 shade = mix(vec3(0.62, 0.66, 0.84), vec3(0.83, 0.86, 0.96), step(-0.05, lit));
    shade = mix(shade, vec3(1.0, 0.99, 0.96), step(0.3, lit));
    shade = mix(shade, horizon, (L == 0 ? 0.3 : 0.08) * (1.0 - smoothstep(0.0, 0.5, c.w)));
    col = mix(col, shade, m);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function createRender(canvas: HTMLCanvasElement): Render {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON.clone(), 260, 2600);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.9);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x8a9cf0, 0x9a7f66, 1.9);
  scene.add(hemi);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { sunDir: { value: SUN_DIR }, zenith: { value: ZENITH }, horizon: { value: HORIZON } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const fsGeo = new THREE.BufferGeometry();
  fsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fsGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const inkMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: INK_FRAG,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      texel: { value: new THREE.Vector2() },
      near: { value: camera.near },
      far: { value: camera.far },
      ink: { value: 1 },
      inkColor: { value: new THREE.Color("#1b1622") },
      haze: { value: HORIZON },
    },
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.AlwaysDepth,
  });
  const finalMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: FINAL_FRAG,
    uniforms: {
      tColor: { value: null },
      time: { value: 0 },
      speed: { value: 0 },
      aspect: { value: 1 },
      impact: { value: 0 },
      impactKind: { value: 0 },
      impactPhase: { value: 0 },
      vignette: { value: 0.28 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const inkQuad = new THREE.Mesh(fsGeo, inkMat);
  const finalQuad = new THREE.Mesh(fsGeo, finalMat);
  inkQuad.frustumCulled = finalQuad.frustumCulled = false;

  let preset = PRESET.medium;
  let rtA: THREE.WebGLRenderTarget | null = null;
  let rtB: THREE.WebGLRenderTarget | null = null;
  let w = 1;
  let h = 1;

  const build = () => {
    rtA?.dispose();
    rtA?.depthTexture?.dispose();
    rtB?.dispose();
    const pr = Math.min(window.devicePixelRatio || 1, preset.ratio);
    const pw = Math.max(1, Math.floor(w * pr));
    const ph = Math.max(1, Math.floor(h * pr));
    rtA = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: preset.samples, depthTexture: new THREE.DepthTexture(pw, ph, THREE.UnsignedIntType) });
    rtB = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, depthBuffer: true });
    inkMat.uniforms.tColor.value = rtA.texture;
    inkMat.uniforms.tDepth.value = rtA.depthTexture;
    inkMat.uniforms.texel.value.set(Math.max(1, pr * 0.8) / pw, Math.max(1, pr * 0.8) / ph);
    finalMat.uniforms.tColor.value = rtB.texture;
  };

  const resize = () => {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.ratio));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    finalMat.uniforms.aspect.value = w / h;
    build();
  };

  const setQuality = (q: Quality) => {
    preset = PRESET[q];
    renderer.shadowMap.enabled = preset.shadow > 0;
    sun.castShadow = preset.shadow > 0;
    if (preset.shadow > 0) {
      sun.shadow.mapSize.set(preset.shadow, preset.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      const s = sun.shadow.camera;
      s.left = s.bottom = -preset.range / 2;
      s.right = s.top = preset.range / 2;
      s.near = 1;
      s.far = 1400;
      s.updateProjectionMatrix();
    }
    inkMat.uniforms.ink.value = preset.ink ? 1 : 0;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m)) m.needsUpdate = true;
    });
    resize();
  };

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  right.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  up.crossVectors(SUN_DIR, right).normalize();
  const snapped = new THREE.Vector3();

  let time = 0;
  let impactFrames = 0;
  let impactTotal = 0;
  let scanT = 0;

  // Transparent and noInk objects keep layer 0 so THREE.Raycaster still sees them; they skip the ink pass by hiding.
  const late: THREE.Object3D[] = [];
  const lateVis: boolean[] = [];
  const markLayer = (o: THREE.Object3D) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m || Array.isArray(m)) return;
    if (m.transparent || m.userData.noInk) {
      o.layers.enable(1);
      late.push(o);
    } else o.layers.disable(1);
  };

  const frame = (dt: number, focus: THREE.Vector3, speed01: number) => {
    time += dt;
    const texel = preset.range / Math.max(1, preset.shadow);
    const a = texel > 0 ? Math.round(focus.dot(right) / texel) * texel : 0;
    const b = texel > 0 ? Math.round(focus.dot(up) / texel) * texel : 0;
    const c = focus.dot(SUN_DIR);
    snapped.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(SUN_DIR, c);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(SUN_DIR, 600);
    sun.target.updateMatrixWorld();
    const sp = finalMat.uniforms.speed;
    sp.value += (speed01 - sp.value) * Math.min(1, dt * 8);
    finalMat.uniforms.time.value = time;
    scanT -= dt;
    if (scanT <= 0) {
      scanT = 0.5;
      late.length = 0;
      scene.traverse(markLayer);
    }
  };

  const render = () => {
    if (!rtA || !rtB) return;
    sky.position.copy(camera.position);
    if (impactFrames > 0) {
      finalMat.uniforms.impact.value = 1;
      finalMat.uniforms.impactPhase.value = impactTotal - impactFrames;
      impactFrames--;
    } else finalMat.uniforms.impact.value = 0;
    if (preset.ink) {
      camera.layers.set(0);
      for (let i = 0; i < late.length; i++) {
        lateVis[i] = late[i].visible;
        late[i].visible = false;
      }
      renderer.setRenderTarget(rtA);
      renderer.render(scene, camera);
      for (let i = 0; i < late.length; i++) late[i].visible = lateVis[i];
      renderer.setRenderTarget(rtB);
      renderer.render(inkQuad, fsCam);
      camera.layers.set(1);
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
      camera.layers.enableAll();
    } else {
      camera.layers.enableAll();
      renderer.setRenderTarget(rtB);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(null);
    renderer.render(finalQuad, fsCam);
  };

  const impact = (kind: "hit" | "crit" | "kill") => {
    const k = kind === "hit" ? 0 : kind === "crit" ? 1 : 2;
    const n = k === 0 ? 2 : k === 1 ? 3 : 5;
    if (impactFrames > 0 && finalMat.uniforms.impactKind.value > k) return;
    finalMat.uniforms.impactKind.value = k;
    impactFrames = impactTotal = n;
  };

  setQuality("medium");

  return {
    scene,
    camera,
    setQuality,
    resize,
    frame,
    impact,
    render,
    dispose() {
      rtA?.dispose();
      rtA?.depthTexture?.dispose();
      rtB?.dispose();
      fsGeo.dispose();
      inkMat.dispose();
      finalMat.dispose();
      renderer.dispose();
    },
  };
}
