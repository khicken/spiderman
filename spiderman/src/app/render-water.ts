import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { fsMaterial, halfTarget } from "./render-post";

export const WATER = {
  time: { value: 0 },
  level: { value: NaN },
  normals: null as THREE.DataTexture | null,
};

function waterNormals() {
  if (WATER.normals) return WATER.normals;
  const S = 256;
  const waves: number[][] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rnd() * 2 - 1) * (2 + i * 0.5));
    const ky = Math.round((rnd() * 2 - 1) * (2 + i * 0.5)) || 1;
    waves.push([kx, ky, rnd() * Math.PI * 2, 1 / Math.hypot(kx, ky) ** 1.2]);
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let gx = 0, gy = 0;
      for (const [kx, ky, ph, a] of waves) {
        const c = Math.cos((2 * Math.PI * (kx * x + ky * y)) / S + ph) * a;
        gx += c * kx;
        gy += c * ky;
      }
      const n = new THREE.Vector3(-gx * 0.09, -gy * 0.09, 1).normalize();
      const o = (y * S + x) * 4;
      data[o] = (n.x * 0.5 + 0.5) * 255;
      data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return (WATER.normals = t);
}

const NORMAL = /* glsl */ `
uniform sampler2D tWaterN; uniform float uWaterT;
vec3 waterNormal(vec2 p, float dist) {
  vec2 a = texture2D(tWaterN, p / 19.0 + uWaterT * vec2(0.013, 0.008)).xy * 2.0 - 1.0;
  vec2 b = texture2D(tWaterN, mat2(0.8, -0.6, 0.6, 0.8) * p / 53.0 - uWaterT * vec2(0.006, -0.009)).xy * 2.0 - 1.0;
  vec2 g = (a * 0.35 + b * 0.5) / (1.0 + dist * 0.006);
  return normalize(vec3(g.x, 1.0, g.y));
}
`;

// The Fidelity reflection pass finds water pixels by the plane height y.
export function createRiverMaterial(o: { y: number; color?: THREE.ColorRepresentation }) {
  WATER.level.value = o.y;
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? "#1d3346", roughness: 0.07, metalness: 0, envMapIntensity: 1.6 });
  m.onBeforeCompile = (s) => {
    s.uniforms.tWaterN = { value: waterNormals() };
    s.uniforms.uWaterT = WATER.time;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterW;\n" + NORMAL)
      .replace("#include <normal_fragment_maps>", "normal = normalize((viewMatrix * vec4(waterNormal(vWaterW.xz, length(vWaterW - cameraPosition)), 0.0)).xyz);");
  };
  m.customProgramCacheKey = () => "river1";
  return m;
}

const SSR = /* glsl */ `
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform mat4 uView;
uniform float uLevel; uniform float uNear; uniform float uFar;
varying vec2 vUv;
${NORMAL}
float sceneZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
void main() {
  gl_FragColor = vec4(0.0);
  float d = texture2D(tDepth, vUv).r;
  if (d > 0.99999) return;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 P = vp.xyz / vp.w;
  vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
  if (abs(W.y - uLevel) > 0.12) return;
  vec3 cam = uCamWorld[3].xyz;
  vec3 V = normalize(W - cam);
  vec3 N = normalize(mix(waterNormal(W.xz, length(W - cam)), vec3(0.0, 1.0, 0.0), 0.5));
  vec3 R = reflect(V, N);
  R.y = max(R.y, 0.02);
  vec3 Rv = normalize((uView * vec4(R, 0.0)).xyz);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = 0.6 + ign * 0.8;
  float prev = 0.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < 22; i++) {
    vec3 q = P + Rv * t;
    vec4 c = uProj * vec4(q, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (c.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float dz = -q.z - sceneZ(uv);
    if (dz > 0.0 && dz < max(1.5, t * 0.08)) {
      float lo = prev, hi = t;
      for (int j = 0; j < 4; j++) {
        float m = 0.5 * (lo + hi);
        vec3 qm = P + Rv * m;
        vec4 cm = uProj * vec4(qm, 1.0);
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        if (-qm.z - sceneZ(um) > 0.0) { hi = m; uv = um; } else lo = m;
      }
      hit = uv;
      break;
    }
    prev = t;
    t *= 1.32;
  }
  if (hit.x < 0.0) return;
  vec2 e = min(hit, 1.0 - hit);
  float fade = smoothstep(0.0, 0.08, min(e.x, e.y));
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  gl_FragColor = vec4(texture2D(tColor, hit).rgb, fade * clamp(F * 1.4, 0.0, 0.85));
}`;

export class WaterSSR {
  readonly target = halfTarget();
  private quad = new FullScreenQuad();
  private mat = fsMaterial(SSR, {
    tColor: { value: null },
    tDepth: { value: null },
    tWaterN: { value: null },
    uWaterT: WATER.time,
    uProj: { value: new THREE.Matrix4() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uView: { value: new THREE.Matrix4() },
    uLevel: WATER.level,
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
  });

  get active() {
    return !Number.isNaN(WATER.level.value);
  }

  setSize(w: number, h: number) {
    this.target.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  }

  render(r: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.Texture, camera: THREE.PerspectiveCamera) {
    const u = this.mat.uniforms;
    u.tColor.value = color;
    u.tDepth.value = depth;
    u.tWaterN.value = waterNormals();
    u.uProj.value.copy(camera.projectionMatrix);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uView.value.copy(camera.matrixWorldInverse);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    this.quad.material = this.mat;
    r.setRenderTarget(this.target);
    this.quad.render(r);
  }

  dispose() {
    this.target.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
