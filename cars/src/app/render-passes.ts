import * as THREE from "three";
import { fsMaterial } from "./render-shared";

const VIEW = /* glsl */ `
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
vec3 depthNormal(vec2 uv, vec3 P, vec2 t) {
  vec3 px = viewPos(uv + vec2(t.x, 0.0)), nx = viewPos(uv - vec2(t.x, 0.0));
  vec3 py = viewPos(uv + vec2(0.0, t.y)), ny = viewPos(uv - vec2(0.0, t.y));
  vec3 dx = abs(px.z - P.z) < abs(P.z - nx.z) ? px - P : P - nx;
  vec3 dy = abs(py.z - P.z) < abs(P.z - ny.z) ? py - P : P - ny;
  return normalize(cross(dx, dy));
}
#ifdef PREPASS
uniform sampler2D tNormal;
vec3 surfNormal(vec2 uv, vec3 P, vec2 t) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
#else
vec3 surfNormal(vec2 uv, vec3 P, vec2 t) { return depthNormal(uv, P, t); }
#endif
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const AO = /* glsl */ `
uniform vec2 uRes; uniform float uRadius; varying vec2 vUv;
${VIEW}
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d > 0.99999) { gl_FragColor = vec4(1.0, 6e4, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 t = 1.0 / uRes;
  vec3 N = surfNormal(vUv, P, t);
  float z = -P.z;
  float rPx = clamp(uRadius * uProj[1][1] * 0.5 * uRes.y / z, 2.0, 80.0);
  float a0 = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  float R2 = uRadius * uRadius;
  for (int i = 0; i < SAMPLES; i++) {
    float f = (float(i) + 0.5) / float(SAMPLES);
    float a = a0 + float(i) * 2.3999632;
    vec2 o = vec2(cos(a), sin(a)) * rPx * sqrt(f) * t;
    vec3 v = viewPos(vUv + o) - P;
    float vv = dot(v, v);
    occ += max(0.0, dot(v, N) - 0.002 * z) / (vv + 0.02) * max(0.0, 1.0 - vv / R2);
  }
  float ao = clamp(1.0 - 1.4 * occ / float(SAMPLES), 0.0, 1.0);
  gl_FragColor = vec4(ao, z, 0.0, 1.0);
}`;

const AO_BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec2 c = texture2D(tSrc, vUv).rg;
  float s = c.r * 0.3, w = 0.3;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 a = texture2D(tSrc, vUv + uDir * float(i)).rg;
    float k = (0.3 - 0.06 * abs(float(i))) / (1.0 + abs(a.g - c.g) / c.g * 60.0);
    s += a.r * k;
    w += k;
  }
  gl_FragColor = vec4(s / w, c.g, 0.0, 1.0);
}`;

const SSR = /* glsl */ `
uniform sampler2D tColor; uniform mat4 uCamWorld; uniform vec2 uRes; uniform float uWet; uniform float uMaxDist; uniform float uTime;
varying vec2 vUv;
${VIEW}
void main() {
  float d = texture2D(tDepth, vUv).r;
  gl_FragColor = vec4(0.0);
  if (d > 0.99999) return;
  vec3 P = viewPos(vUv);
  vec2 t = 1.0 / uRes;
  vec3 N = surfNormal(vUv, P, t);
  vec3 Nw = (uCamWorld * vec4(N, 0.0)).xyz;
  float mask = uWet * smoothstep(0.8, 0.95, Nw.y);
#ifdef PREPASS
  mask = max(mask, texture2D(tNormal, vUv).a);
#endif
  if (mask < 0.01) return;
  vec3 V = normalize(P);
  float n0 = ign(gl_FragCoord.xy + uTime * 37.0);
  vec3 R = normalize(reflect(V, N));
  mask *= smoothstep(-0.05, 0.25, -R.z);
  if (mask < 0.01) return;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  float dist = min(uMaxDist, -P.z * 2.0 + 10.0);
  vec2 hit = vec2(-1.0);
  float hitT = 0.0;
  float prev = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + n0) / float(STEPS);
    float tt = dist * f * f;
    vec3 Q = P + R * tt;
    if (Q.z > -0.05) break;
    vec4 c = uProj * vec4(Q, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sz = viewPos(uv).z;
    float th = 0.3 + tt * 0.06;
    if (Q.z < sz && sz - Q.z < th) {
      float lo = prev, hi = tt;
      for (int j = 0; j < REFINE; j++) {
        float m = 0.5 * (lo + hi);
        vec3 Qm = P + R * m;
        vec4 cm = uProj * vec4(Qm, 1.0);
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        if (Qm.z < viewPos(um).z) hi = m; else lo = m;
      }
      vec4 ch = uProj * vec4(P + R * hi, 1.0);
      hit = ch.xy / ch.w * 0.5 + 0.5;
      hitT = hi;
      break;
    }
    prev = tt;
  }
  if (hit.x < 0.0) return;
  vec2 e = smoothstep(0.0, 0.08, hit) * smoothstep(1.0, 0.92, hit);
  float fade = e.x * e.y * (1.0 - smoothstep(0.6, 1.0, hitT / dist));
  gl_FragColor = vec4(min(texture2D(tColor, hit).rgb, vec3(30.0)), mask * (0.12 + 0.88 * fres) * fade);
}`;

const RESOLVE = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tAO; uniform sampler2D tSSR;
uniform vec2 uAORes; uniform float uAO; uniform float uSSR; uniform float uSSRStep; uniform float uNear; uniform float uFar;
varying vec2 vUv;
float viewZ(float d) { return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  if (d < 0.99999) {
    float vz = -viewZ(d);
    if (uAO > 0.0) {
      vec2 p = vUv * uAORes - 0.5;
      vec2 i = floor(p), f = p - i;
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
    if (uSSR > 0.0) {
      vec4 s = texture2D(tSSR, vUv) * 0.3;
      vec2 sx = vec2(uSSRStep * 0.35, 0.0);
      for (int k = 1; k <= 3; k++) {
        vec2 sy = vec2(0.0, float(k) * uSSRStep);
        s += (texture2D(tSSR, vUv + sy) + texture2D(tSSR, vUv - sy) + texture2D(tSSR, vUv + sy + sx) + texture2D(tSSR, vUv - sy - sx)) * (0.18 - 0.04 * float(k));
      }
      s += (texture2D(tSSR, vUv + sx) + texture2D(tSSR, vUv - sx)) * 0.2;
      s /= 1.9;
      col = mix(col, s.rgb, s.a * uSSR);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uPrevVP; uniform mat4 uInvVP;
uniform float uScale; uniform float uRadial; uniform float uNear; uniform float uFar; uniform vec2 uRes; uniform float uAspect;
varying vec2 vUv;
float viewZ(float d) { return -(uNear * uFar) / ((uFar - uNear) * d - uFar); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float nearMask(float z) { return smoothstep(5.0, 13.0, z); }
void main() {
  float d = min(texture2D(tDepth, vUv).r, 0.999999);
  vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  w /= w.w;
  vec4 pc = uPrevVP * w;
  vec2 v = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * uScale;
  float m = nearMask(viewZ(d));
  v *= m;
  vec2 c = vUv - 0.5;
  v += c * uRadial * smoothstep(0.08, 0.45, length(c * vec2(uAspect, 1.0))) * m;
  float len = length(v * uRes);
  vec3 col = texture2D(tColor, vUv).rgb;
  if (len < 0.75) { gl_FragColor = vec4(col, 1.0); return; }
  v *= min(1.0, 48.0 / len);
  float j = ign(gl_FragCoord.xy) - 0.5;
  vec3 sum = col; float ws = 1.0;
  for (int i = 0; i < SAMPLES; i++) {
    float f = (float(i) + 0.5 + j) / float(SAMPLES) - 0.5;
    vec2 uv = vUv + v * f;
    float sm = nearMask(viewZ(min(texture2D(tDepth, uv).r, 0.999999)));
    float k = m > 0.5 ? sm : 1.0;
    sum += texture2D(tColor, uv).rgb * k;
    ws += k;
  }
  gl_FragColor = vec4(sum / ws, 1.0);
}`;

const DOF = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform float uFocus; uniform float uAperture; uniform float uNear; uniform float uFar; uniform vec2 uRes;
varying vec2 vUv;
float viewZ(float d) { return -(uNear * uFar) / ((uFar - uNear) * d - uFar); }
float coc(vec2 uv) { float z = viewZ(texture2D(tDepth, uv).r); return clamp(abs(z - uFocus) / z * uAperture, 0.0, 1.0); }
void main() {
  float c0 = coc(vUv);
  vec3 sum = texture2D(tColor, vUv).rgb; float ws = 1.0;
  float maxR = 9.0 * uRes.y / 900.0;
  for (int i = 0; i < SAMPLES; i++) {
    float f = (float(i) + 0.5) / float(SAMPLES);
    float r = sqrt(f) * maxR;
    float a = float(i) * 2.3999632;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
    float cs = coc(uv) * maxR;
    float k = smoothstep(r - 1.5, r, max(cs, c0 * maxR));
    sum += texture2D(tColor, uv).rgb * k;
    ws += k;
  }
  gl_FragColor = vec4(sum / ws, 1.0);
}`;

export type PassCfg = { aoSamples: number; ssrSteps: number; ssrRefine: number; blurSamples: number; dofSamples: number; prepass: boolean };

const view = () => ({ tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, tNormal: { value: null } });

export function passMaterials(c: PassCfg) {
  const pre: Record<string, number> = c.prepass ? { PREPASS: 1 } : {};
  return {
    ao: fsMaterial(AO, { ...view(), uRes: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 1.6 } }, { ...pre, SAMPLES: c.aoSamples }),
    aoBlur: fsMaterial(AO_BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }),
    ssr: fsMaterial(
      SSR,
      {
        ...view(),
        tColor: { value: null },
        uCamWorld: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(1, 1) },
        uWet: { value: 0 },
        uMaxDist: { value: 90 },
        uTime: { value: 0 },
      },
      { ...pre, STEPS: c.ssrSteps, REFINE: c.ssrRefine },
    ),
    resolve: fsMaterial(RESOLVE, {
      tColor: { value: null },
      tDepth: { value: null },
      tAO: { value: null },
      tSSR: { value: null },
      uAORes: { value: new THREE.Vector2(1, 1) },
      uAO: { value: 0 },
      uSSR: { value: 0 },
      uSSRStep: { value: 0.007 },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
    }),
    blur: fsMaterial(
      BLUR,
      {
        tColor: { value: null },
        tDepth: { value: null },
        uPrevVP: { value: new THREE.Matrix4() },
        uInvVP: { value: new THREE.Matrix4() },
        uScale: { value: 0.5 },
        uRadial: { value: 0 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uAspect: { value: 1 },
      },
      { SAMPLES: Math.max(1, c.blurSamples) },
    ),
    dof: fsMaterial(
      DOF,
      {
        tColor: { value: null },
        tDepth: { value: null },
        uFocus: { value: 5 },
        uAperture: { value: 0.6 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      { SAMPLES: Math.max(1, c.dofSamples) },
    ),
  };
}
export type PassMaterials = ReturnType<typeof passMaterials>;
