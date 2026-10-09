import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { fsMaterial, halfTarget } from "./render-post";

const AO = /* glsl */ `
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform vec2 uRes; uniform float uRadius;
varying vec2 vUv;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d > 0.99999) { gl_FragColor = vec4(1.0, 6e4, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 t = 1.0 / uRes;
  vec3 px = viewPos(vUv + vec2(t.x, 0.0)), nx = viewPos(vUv - vec2(t.x, 0.0));
  vec3 py = viewPos(vUv + vec2(0.0, t.y)), ny = viewPos(vUv - vec2(0.0, t.y));
  vec3 dx = abs(px.z - P.z) < abs(P.z - nx.z) ? px - P : P - nx;
  vec3 dy = abs(py.z - P.z) < abs(P.z - ny.z) ? py - P : P - ny;
  vec3 N = normalize(cross(dx, dy));
  float z = -P.z;
  float rPx = clamp(uRadius * uProj[1][1] * 0.5 * uRes.y / z, 3.0, 40.0);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float a0 = ign * 6.2831853;
  float occ = 0.0;
  float R2 = uRadius * uRadius;
  for (int i = 0; i < 10; i++) {
    float f = (float(i) + 0.5) / 10.0;
    float a = a0 + float(i) * 2.3999632;
    vec2 o = vec2(cos(a), sin(a)) * rPx * sqrt(f) * t;
    vec3 v = viewPos(vUv + o) - P;
    float vv = dot(v, v);
    occ += max(0.0, dot(v, N) - 0.03 * z * 0.01) / (vv + 0.05) * max(0.0, 1.0 - vv / R2);
  }
  float ao = clamp(1.0 - 1.6 * occ / 10.0, 0.0, 1.0);
  gl_FragColor = vec4(ao, z, 0.0, 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec2 c = texture2D(tSrc, vUv).rg;
  float s = c.r * 0.3, w = 0.3;
  for (int i = -2; i <= 2; i++) {
    if (i == 0) continue;
    vec2 a = texture2D(tSrc, vUv + uDir * float(i)).rg;
    float k = (i == 1 || i == -1 ? 0.25 : 0.1) / (1.0 + abs(a.g - c.g) / c.g * 60.0);
    s += a.r * k;
    w += k;
  }
  gl_FragColor = vec4(s / w, c.g, 0.0, 1.0);
}`;

export class Ao {
  readonly a = halfTarget();
  readonly b = halfTarget();
  private quad = new FullScreenQuad();
  private ao = fsMaterial(AO, {
    tDepth: { value: null },
    uProj: { value: new THREE.Matrix4() },
    uInvProj: { value: new THREE.Matrix4() },
    uRes: { value: new THREE.Vector2(1, 1) },
    uRadius: { value: 2.2 },
  });
  private blur = fsMaterial(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });

  constructor() {
    for (const t of [this.a, this.b]) t.texture.minFilter = t.texture.magFilter = THREE.NearestFilter;
  }

  get texture() {
    return this.a.texture;
  }

  setSize(w: number, h: number) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.a.setSize(hw, hh);
    this.b.setSize(hw, hh);
    this.ao.uniforms.uRes.value.set(hw, hh);
  }

  render(r: THREE.WebGLRenderer, depth: THREE.Texture, camera: THREE.PerspectiveCamera) {
    const u = this.ao.uniforms;
    u.tDepth.value = depth;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.quad.material = this.ao;
    r.setRenderTarget(this.a);
    this.quad.render(r);
    const res = u.uRes.value;
    this.quad.material = this.blur;
    this.blur.uniforms.tSrc.value = this.a.texture;
    this.blur.uniforms.uDir.value.set(1 / res.x, 0);
    r.setRenderTarget(this.b);
    this.quad.render(r);
    this.blur.uniforms.tSrc.value = this.b.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / res.y);
    r.setRenderTarget(this.a);
    this.quad.render(r);
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.ao.dispose();
    this.blur.dispose();
    this.quad.dispose();
  }
}
