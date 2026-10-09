import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const RIG = { hipY: 0.94, hipX: 0.095, kneeY: 0.5, shX: 0.205, shY: 1.42, elbY: 1.14, neckY: 1.5, handY: 0.84, headY: 1.63 };

export const ACC = {
  beanie: 1, hat: 2, scarf: 4, longCoat: 8, bagL: 16, bagR: 32, backpack: 64, phone: 128, longHair: 256, earmuffs: 512,
  puffer: 1024, hood: 2048, cane: 4096, cap: 8192, ponytail: 16384, bun: 32768, beard: 65536, glasses: 131072,
  shortHair: 262144, skirt: 524288, satchel: 1048576, belly: 2097152, afro: 4194304,
} as const;

// Color slots: 0 skin, 1 coat, 2 pants, 3 hat, 4 scarf, 5 shoes, 6 hair, 7 bag, 8 hand, 9 shirt, 10 accent, 11 inner, 12 dark, 13 white, 14 wood.
export const SLOT = { skin: 0, coat: 1, pants: 2, hat: 3, scarf: 4, shoes: 5, hair: 6, bag: 7, hand: 8, shirt: 9, accent: 10, inner: 11, dark: 12, white: 13, wood: 14 };
const S = SLOT;
const QUILT = 1, ZIP = 2, RIB = 3, FACE = 4, STRIPE = 5, SOLE = 6;
// Bones: 0 chest, 1 head, 2 armL, 3 armR, 4 foreL, 5 foreR, 6 thighL, 7 thighR, 8 shinL, 9 shinR, 10 pelvis.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function mat(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)).clone();
}

class Rig {
  parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, bone: number, slot: number, bit = 0, shade = 1, pattern = 0) {
    const g = geo.clone();
    geo.dispose();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    const n = g.attributes.position.count;
    const part = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) part.set([bone, slot, bit ? Math.log2(bit) + 1 : 0, shade + pattern * 2], i * 4);
    g.setAttribute("aPart", new THREE.BufferAttribute(part, 4));
    this.parts.push(g);
  }
  build() {
    const g = mergeGeometries(this.parts)!;
    this.parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    return g;
  }
}

const V = (r: number, y: number) => new THREE.Vector2(r, y);
const CHEST = [V(0, 0.93), V(0.17, 0.935), V(0.168, 1.0), V(0.158, 1.1), V(0.168, 1.22), V(0.188, 1.33), V(0.19, 1.39), V(0.165, 1.45), V(0.09, 1.495), V(0, 1.5)];

/** Person template, +z forward, 1.76 m tall. Accessories are baked in and hidden by the instance mask. lo = far LOD. */
export function personGeometry(lo = false) {
  const r = new Rig();
  const seg = lo ? 5 : 8;
  const cap = (rad: number, len: number, s = seg) => new THREE.CapsuleGeometry(rad, len, lo ? 1 : 2, s);
  const sph = (rad: number, w = seg, h = lo ? 4 : 6) => new THREE.SphereGeometry(rad, w, h);
  const lathe = (pts: THREE.Vector2[], k = 1) => new THREE.LatheGeometry(pts.map((p) => V(p.x * k, p.y)), lo ? 7 : 12);

  r.add(lathe([V(0, 0.8), V(0.12, 0.81), V(0.155, 0.88), V(0.158, 0.95), V(0.14, 1.0), V(0, 1.0)]), mat(0, 0, 0, 1, 1, 0.66), 10, S.pants);
  r.add(lathe(CHEST), mat(0, 0, 0, 1, 1, 0.66), 0, S.coat, 0, 1, ZIP);
  r.add(new THREE.CylinderGeometry(0.172, 0.174, 0.05, lo ? 7 : 12, 1, true), mat(0, 0.94, 0, 1, 1, 0.68), 0, S.accent, 0, 0.9);
  if (!lo) r.add(new THREE.TorusGeometry(0.062, 0.02, 4, lo ? 6 : 10), mat(0, 1.475, 0.005, 1, 1, 0.9, Math.PI / 2), 0, S.shirt);
  r.add(new THREE.CylinderGeometry(0.046, 0.05, 0.12, lo ? 5 : 8), mat(0, 1.52, 0), 0, S.skin, 0, 0.92);
  if (!lo) r.add(sph(0.16), mat(0, 1.06, 0.045, 1.02, 1.0, 0.95), 0, S.coat, ACC.belly);
  const puff: THREE.Vector2[] = [V(0, 0.9)];
  for (let y = 0.91; y <= 1.43; y += lo ? 0.08 : 0.026) {
    const base = y < 1.0 ? 0.172 : y < 1.2 ? 0.165 : 0.18 + (y - 1.2) * 0.1;
    puff.push(V(base * 1.12 + 0.012 * Math.abs(Math.sin(((y - 0.91) * Math.PI) / 0.085)), y));
  }
  puff.push(V(0.16, 1.47), V(0, 1.48));
  r.add(new THREE.LatheGeometry(puff, lo ? 7 : 12), mat(0, 0, 0, 1, 1, 0.74), 0, S.coat, ACC.puffer, 1, QUILT);
  r.add(new THREE.TorusGeometry(0.075, 0.032, lo ? 3 : 5, lo ? 6 : 12), mat(0, 1.47, 0.0, 1.05, 1, 0.95, Math.PI / 2), 0, S.coat, ACC.puffer, 0.9);
  r.add(sph(0.12), mat(0, 1.47, -0.1, 1.1, 0.75, 0.75), 0, S.coat, ACC.hood, 0.88);
  if (!lo) r.add(new THREE.BoxGeometry(0.2, 0.11, 0.03), mat(0, 1.02, 0.115), 0, S.coat, ACC.hood, 0.85);
  if (!lo) for (const s of [-1, 1]) r.add(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 3), mat(s * 0.03, 1.38, 0.125, 1, 1, 1, 0.12), 0, S.white, ACC.hood);
  // Long coat skirts ride the thighs so they swing with the stride.
  for (const s of [1, -1]) r.add(new THREE.CylinderGeometry(0.115, 0.15, 0.5, lo ? 6 : 10, 1, true), mat(s * 0.085, 0.72, 0, 1, 1, 0.95), s > 0 ? 6 : 7, S.coat, ACC.longCoat, 0.95);
  r.add(new THREE.CylinderGeometry(0.17, 0.27, 0.42, lo ? 7 : 12, 1, true), mat(0, 0.78, 0, 1, 1, 0.82), 10, S.accent, ACC.skirt, 0.95);
  r.add(new THREE.BoxGeometry(0.27, 0.34, 0.13), mat(0, 1.2, -0.175), 0, S.bag, ACC.backpack, 0.9);
  if (!lo) r.add(new THREE.BoxGeometry(0.2, 0.12, 0.05), mat(0, 1.1, -0.255), 0, S.bag, ACC.backpack, 0.75);
  if (!lo) for (const s of [-1, 1]) r.add(new THREE.BoxGeometry(0.03, 0.2, 0.012), mat(s * 0.09, 1.33, 0.117, 1, 1, 1, 0.3), 0, S.dark, ACC.backpack);
  if (!lo) r.add(new THREE.BoxGeometry(0.03, 0.5, 0.012), mat(0.0, 1.21, 0.118, 1, 1, 1, 0.1, 0, 0.78), 0, S.dark, ACC.satchel);
  if (!lo) r.add(new THREE.BoxGeometry(0.22, 0.17, 0.07), mat(-0.17, 0.93, 0.05, 1, 1, 1, 0, -0.3), 10, S.bag, ACC.satchel, 0.9);
  r.add(new THREE.TorusGeometry(0.068, 0.036, lo ? 3 : 5, lo ? 6 : 12), mat(0, 1.485, 0.005, 1, 1, 0.9, Math.PI / 2), 0, S.scarf, ACC.scarf, 1, STRIPE);
  if (!lo) r.add(new THREE.BoxGeometry(0.08, 0.28, 0.03), mat(0.065, 1.33, 0.13, 1, 1, 1, 0.12, 0, 0.06), 0, S.scarf, ACC.scarf, 0.95, STRIPE);

  // The face is painted in the fragment shader from rest-space coordinates, so hair and hats must stay above the brows.
  const H = RIG.headY;
  r.add(sph(0.112, lo ? 8 : 14, lo ? 6 : 10), mat(0, H, 0, 0.96, 1.1, 1), 1, S.skin, 0, 1, FACE);
  r.add(sph(0.09, lo ? 7 : 12, lo ? 5 : 8), mat(0, H - 0.05, 0.022, 0.9, 0.82, 0.95), 1, S.skin, 0, 1, FACE);
  if (!lo) r.add(sph(0.022, 6, 4), mat(0, H - 0.012, 0.108, 0.75, 1, 1.1), 1, S.skin, 0, 0.94);
  if (!lo) for (const s of [-1, 1]) r.add(sph(0.026, 6, 4), mat(s * 0.104, H - 0.008, -0.005, 0.5, 1, 0.75), 1, S.skin, 0, 0.9);
  r.add(new THREE.SphereGeometry(0.121, lo ? 8 : 14, lo ? 4 : 7, 0, Math.PI * 2, 0, Math.PI * 0.56), mat(0, H + 0.016, -0.012, 0.98, 1.06, 1.05, -0.55), 1, S.hair, ACC.shortHair);
  r.add(sph(0.125), mat(0, H - 0.075, -0.05, 1.04, 1.5, 0.66), 1, S.hair, ACC.longHair);
  r.add(new THREE.SphereGeometry(0.124, lo ? 8 : 14, lo ? 4 : 7, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0, H + 0.012, -0.008, 1.0, 1.08, 1.06, -0.55), 1, S.hair, ACC.longHair);
  if (!lo) r.add(cap(0.035, 0.12, 6), mat(0, H - 0.07, -0.145, 1, 1, 1, 0.35), 1, S.hair, ACC.ponytail);
  if (!lo) r.add(sph(0.05), mat(0, H + 0.115, -0.06), 1, S.hair, ACC.bun);
  r.add(sph(0.14), mat(0, H + 0.05, -0.045, 1.08, 0.98, 1.0), 1, S.hair, ACC.afro);
  if (!lo) r.add(new THREE.SphereGeometry(0.098, lo ? 8 : 12, 5, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4), mat(0, H - 0.03, 0.02, 0.98, 1.05, 1.06), 1, S.hair, ACC.beard);
  if (!lo) {
    for (const s of [-1, 1]) r.add(new THREE.TorusGeometry(0.021, 0.0045, 3, 10), mat(s * 0.041, H + 0.012, 0.118), 1, S.dark, ACC.glasses);
    r.add(new THREE.BoxGeometry(0.03, 0.005, 0.005), mat(0, H + 0.016, 0.12), 1, S.dark, ACC.glasses);
  }
  r.add(new THREE.SphereGeometry(0.131, lo ? 8 : 14, lo ? 4 : 7, 0, Math.PI * 2, 0, Math.PI * 0.52), mat(0, H + 0.05, -0.005, 1, 1.1, 1.02), 1, S.hat, ACC.beanie, 1, RIB);
  r.add(new THREE.CylinderGeometry(0.135, 0.135, 0.055, lo ? 8 : 14, 1, true), mat(0, H + 0.065, -0.005, 0.97, 1, 1.0), 1, S.hat, ACC.beanie, 0.85, RIB);
  if (!lo) r.add(sph(0.042, 7, 5), mat(0, H + 0.205, -0.01), 1, S.accent, ACC.beanie);
  r.add(new THREE.CylinderGeometry(0.2, 0.2, 0.015, lo ? 8 : 14), mat(0, H + 0.085, 0), 1, S.hat, ACC.hat, 0.85);
  r.add(new THREE.CylinderGeometry(0.105, 0.122, 0.12, lo ? 8 : 12), mat(0, H + 0.15, 0), 1, S.hat, ACC.hat);
  if (!lo) r.add(new THREE.CylinderGeometry(0.123, 0.123, 0.03, lo ? 8 : 12, 1, true), mat(0, H + 0.105, 0), 1, S.accent, ACC.hat);
  r.add(new THREE.SphereGeometry(0.126, lo ? 8 : 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(0, H + 0.045, 0, 1, 0.9, 1.04), 1, S.hat, ACC.cap);
  if (!lo) r.add(new THREE.CylinderGeometry(0.09, 0.09, 0.012, lo ? 6 : 10, 1, false, -Math.PI / 2, Math.PI), mat(0, H + 0.05, 0.1, 1, 1, 1.15, 0.12), 1, S.hat, ACC.cap, 0.8);
  if (!lo) for (const s of [-1, 1]) r.add(sph(0.045, 7, 5), mat(s * 0.11, H, 0, 0.6, 1, 1), 1, S.accent, ACC.earmuffs);
  if (!lo) r.add(new THREE.TorusGeometry(0.125, 0.012, 3, 10, Math.PI), mat(0, H + 0.005, 0, 1, 1.18, 1, 0, Math.PI / 2), 1, S.dark, ACC.earmuffs);

  for (const s of [1, -1]) {
    const L = s > 0;
    const up = L ? 2 : 3;
    const fo = L ? 4 : 5;
    const x = s * RIG.shX;
    if (!lo) r.add(sph(0.062), mat(x - s * 0.01, RIG.shY - 0.01, 0, 1, 0.85, 0.95), up, S.coat);
    r.add(cap(0.056, 0.22), mat(x, 1.29, 0), up, S.coat);
    r.add(cap(0.074, 0.2), mat(x, 1.29, 0), up, S.coat, ACC.puffer, 1, QUILT);
    r.add(cap(0.049, 0.2), mat(x, 1.0, 0), fo, S.coat, 0, 0.96);
    r.add(cap(0.064, 0.17), mat(x, 1.01, 0), fo, S.coat, ACC.puffer, 0.96, QUILT);
    if (!lo) r.add(new THREE.CylinderGeometry(0.051, 0.051, 0.04, lo ? 5 : 8, 1, true), mat(x, 0.905, 0), fo, S.coat, 0, 0.8, RIB);
    r.add(sph(0.044, lo ? 6 : 8, lo ? 4 : 6), mat(x, RIG.handY - 0.025, 0.008, 0.62, 1.15, 1), fo, S.hand);
    if (!lo) r.add(cap(0.016, 0.03, 5), mat(x - s * 0.008, RIG.handY - 0.005, 0.04, 1, 1, 1, 0.5), fo, S.hand, 0, 0.95);
    r.add(new THREE.BoxGeometry(0.24, 0.27, 0.1), mat(s * (RIG.shX + 0.04), 0.62, 0.02), fo, S.bag, L ? ACC.bagL : ACC.bagR, L ? 1 : 0.8);
    if (!lo) r.add(new THREE.TorusGeometry(0.055, 0.008, 3, 8, Math.PI), mat(s * (RIG.shX + 0.04), 0.755, 0.02), fo, S.dark, L ? ACC.bagL : ACC.bagR);
  }
  if (!lo) r.add(new THREE.BoxGeometry(0.075, 0.14, 0.014), mat(-RIG.shX, RIG.handY + 0.005, 0.06, 1, 1, 1, -0.4), 5, S.dark, ACC.phone);
  if (!lo) r.add(new THREE.PlaneGeometry(0.062, 0.12), mat(-RIG.shX, RIG.handY + 0.005, 0.069, 1, 1, 1, -0.4), 5, S.white, ACC.phone, 1.7);
  r.add(new THREE.CylinderGeometry(0.014, 0.012, 0.8, 5), mat(-RIG.shX, RIG.handY - 0.42, 0.03), 5, S.wood, ACC.cane);
  if (!lo) r.add(new THREE.TorusGeometry(0.035, 0.012, 4, 6, Math.PI), mat(-RIG.shX, RIG.handY - 0.01, 0.0, 1, 1, 1, 0, Math.PI / 2), 5, S.wood, ACC.cane);

  for (const s of [1, -1]) {
    const L = s > 0;
    const x = s * RIG.hipX;
    r.add(cap(0.077, 0.32), mat(x, 0.72, 0), L ? 6 : 7, S.pants);
    r.add(new THREE.CylinderGeometry(0.062, 0.046, 0.42, seg), mat(x, 0.3, 0), L ? 8 : 9, S.pants, 0, 0.94);
    if (!lo) r.add(sph(0.058), mat(x, 0.5, 0.005, 1, 0.9, 1), L ? 8 : 9, S.pants, 0, 0.94);
    r.add(new THREE.BoxGeometry(0.1, 0.085, 0.2, 1, 1, 1), mat(x, 0.043, 0.02), L ? 8 : 9, S.shoes, 0, 1, SOLE);
    if (!lo) r.add(sph(0.052, lo ? 6 : 8, 5), mat(x, 0.045, 0.115, 0.95, 0.82, 1.1), L ? 8 : 9, S.shoes, 0, 1, SOLE);
  }
  return r.build();
}

const SHADER_LIB = `
vec3 cwHex(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
mat3 cwF(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c); }
mat3 cwZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 cwY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
bool cwHidden(float bit, float mask) { return bit > 0.5 && mod(floor(mask / exp2(bit - 1.0)), 2.0) < 0.5; }
vec3 cwPal(float s) {
  if (s > 11.5) return s < 12.5 ? vec3(0.018) : s < 13.5 ? vec3(0.85) : vec3(0.2, 0.1, 0.045);
  vec4 c = s < 3.5 ? iCol0 : s < 7.5 ? iCol1 : iCol2;
  float k = mod(s, 4.0);
  return cwHex(k < 0.5 ? c.x : k < 1.5 ? c.y : k < 2.5 ? c.z : c.w);
}
`;

const PERSON_VERT = `
int b = int(aPart.x + 0.5);
vec3 n0 = objectNormal;
vec3 cwP = position;
vRest = position;
if (cwHidden(aPart.z, iD.z)) cwP = vec3(0.0);
if (b >= 6 && b <= 9) {
  bool L = b == 6 || b == 8;
  float sd = L ? 1.0 : -1.0;
  vec3 knee = vec3(${RIG.hipX} * sd, ${RIG.kneeY}, 0.0);
  vec3 hip = vec3(${RIG.hipX} * sd, ${RIG.hipY}, 0.0);
  if (b >= 8) { mat3 r = cwF(-(L ? iD.x : iD.y)); cwP = knee + r * (cwP - knee); n0 = r * n0; }
  mat3 r = cwF(L ? iC.z : iC.w);
  cwP = hip + r * (cwP - hip); n0 = r * n0;
} else {
  if (b == 1) {
    vec3 neck = vec3(0.0, ${RIG.neckY}, 0.0);
    mat3 r = cwY(iA.y) * cwF(iA.z) * cwZ(iE.y);
    cwP = neck + r * ((cwP - neck) * iD.w); n0 = r * n0;
  } else if (b >= 2 && b <= 5) {
    bool L = b == 2 || b == 4;
    float sd = L ? 1.0 : -1.0;
    vec3 sh = vec3(${RIG.shX} * sd, ${RIG.shY}, 0.0);
    vec3 el = vec3(${RIG.shX} * sd, ${RIG.elbY}, 0.0);
    if (b >= 4) { mat3 r = cwF(L ? iB.z : iC.y); cwP = el + r * (cwP - el); n0 = r * n0; }
    mat3 r = cwF(L ? iB.x : iB.w) * cwZ(sd * (L ? iB.y : iC.x));
    cwP = sh + r * (cwP - sh); n0 = r * n0;
  }
  if (b != 10) { mat3 r = cwY(iE.x); cwP = r * cwP; n0 = r * n0; }
  vec3 hc = vec3(0.0, ${RIG.hipY}, 0.0);
  mat3 r = cwF(-iA.x) * cwZ(iA.w);
  cwP = hc + r * (cwP - hc); n0 = r * n0;
}
objectNormal = n0;
float cwPat = floor(aPart.w * 0.5);
vCw = cwPal(aPart.y) * (aPart.w - cwPat * 2.0);
vInfo = vec4(aPart.y, cwPat, iE.z, iE.w);
vHair = cwHex(iCol1.z);
`;

const PERSON_FRAG = `
vec3 cwC = vCw;
float cwPat = vInfo.y;
if (cwPat > 0.5) {
  vec3 q = vRest;
  if (cwPat < 1.5) {
    float band = abs(fract((q.y - 0.91) / 0.085) - 0.5) * 2.0;
    cwC *= mix(0.68, 1.06, smoothstep(0.05, 0.6, band));
  } else if (cwPat < 2.5) {
    float w = fwidth(q.x) + 0.0015;
    float zip = (1.0 - smoothstep(0.004, 0.004 + w, abs(q.x))) * step(0.0, q.z) * step(q.y, 1.44);
    cwC = mix(cwC, cwC * 0.4, zip);
    cwC *= 0.9 + 0.1 * smoothstep(0.93, 1.06, q.y);
  } else if (cwPat < 3.5) {
    cwC *= 0.86 + 0.14 * abs(sin(atan(q.x, q.z) * 16.0));
  } else if (cwPat < 4.5) {
    vec3 f = q - vec3(0.0, ${RIG.headY}, 0.0);
    if (f.z > 0.02) {
      float browK = floor(vInfo.z * 0.5);
      float blink = vInfo.z - browK * 2.0;
      float ax = abs(f.x);
      vec2 e = vec2((ax - 0.041) / 0.021, (f.y - 0.01) / (0.0135 * (1.0 - blink) + 0.0008));
      float de = length(e);
      float aw = fwidth(de) + 0.02;
      float white = 1.0 - smoothstep(1.0 - aw, 1.0 + aw, de);
      float lash = (1.0 - smoothstep(1.0, 1.35 + aw, de)) * step(0.0, f.y - 0.012);
      vec2 ic = vec2(ax - 0.04, f.y - 0.01);
      float ir = length(ic) / 0.0098;
      float iris = (1.0 - smoothstep(1.0 - fwidth(ir) - 0.05, 1.0 + fwidth(ir), ir)) * white;
      float hl = (1.0 - smoothstep(0.7, 1.0, length(ic - vec2(0.003, 0.003)) / 0.0032)) * iris;
      cwC = mix(cwC, cwC * 0.45, lash * 0.85);
      cwC = mix(cwC, vec3(0.9, 0.88, 0.85), white);
      cwC = mix(cwC, vec3(0.05, 0.032, 0.022), iris);
      cwC = mix(cwC, vec3(1.0), hl);
      float lift = browK > 1.5 ? (0.068 - ax) * 0.28 : browK > 0.5 ? 0.007 : (ax - 0.04) * 0.05;
      float by = f.y - 0.04 - lift;
      float bw = fwidth(by) + 0.0008;
      float brow = (1.0 - smoothstep(0.0028, 0.0028 + bw, abs(by))) * smoothstep(0.014, 0.018, ax) * (1.0 - smoothstep(0.064, 0.07, ax));
      cwC = mix(cwC, vHair * 0.75, brow);
      float mo = vInfo.w;
      float smile = browK > 0.5 && browK < 1.5 ? 9.0 : browK > 1.5 ? -5.0 : 3.0;
      float my = f.y + 0.054 - f.x * f.x * smile;
      float dm = length(vec2(f.x / 0.019, my / (0.0022 + 0.013 * mo)));
      float mw = fwidth(dm) + 0.05;
      float mouth = 1.0 - smoothstep(1.0 - mw, 1.0 + mw, dm);
      cwC = mix(cwC, mo > 0.15 ? vec3(0.16, 0.035, 0.035) : cwC * vec3(0.62, 0.36, 0.34), mouth);
      float ch = 1.0 - smoothstep(0.0, 1.0, length(vec2(ax - 0.06, f.y + 0.026)) / 0.028);
      cwC *= mix(vec3(1.0), vec3(1.07, 0.88, 0.86), ch * 0.6);
    }
  } else if (cwPat < 5.5) {
    cwC = mix(cwC, vec3(0.86, 0.84, 0.8), step(0.5, fract(q.y * 16.0)) * 0.5);
  } else {
    cwC = mix(cwC, vec3(0.82, 0.8, 0.76), 1.0 - smoothstep(0.016, 0.022, q.y));
  }
}
diffuseColor.rgb *= cwC;
`;

const PERSON_GLOW = `totalEmissiveRadiance += diffuseColor.rgb * (vInfo.x < 0.5 ? 0.16 : 0.06);`;

const ATTRS = ["iA", "iB", "iC", "iD", "iE", "iCol0", "iCol1", "iCol2"];

function personMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.74, metalness: 0 });
  const decl = ATTRS.map((n) => `attribute vec4 ${n};`).join("\n");
  const vary = "varying vec3 vCw;\nvarying vec3 vRest;\nvarying vec3 vHair;\nvarying vec4 vInfo;";
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec4 aPart;\n${decl}\n${vary}\n${SHADER_LIB}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${PERSON_VERT}`)
      .replace("#include <begin_vertex>", "vec3 transformed = cwP;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${vary}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${PERSON_FRAG}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${PERSON_GLOW}`);
  };
  m.customProgramCacheKey = () => "crowd-person-v2";
  return m;
}

export type PersonMesh = { mesh: THREE.InstancedMesh; attrs: Record<string, THREE.InstancedBufferAttribute> };

export function personMesh(max: number, lo: boolean, material: THREE.Material): PersonMesh {
  const geo = personGeometry(lo);
  const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  for (const n of ATTRS) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(n, a);
    attrs[n] = a;
  }
  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.count = 0;
  return { mesh, attrs };
}

export { personMaterial };
