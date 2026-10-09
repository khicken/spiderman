import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function mat(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  return _m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)).clone();
}

class Rig {
  parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, bone: number, slot: number, bit = 0, shade = 1) {
    const g = geo.clone();
    g.applyMatrix4(m);
    g.deleteAttribute("uv");
    const n = g.attributes.position.count;
    const part = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      part[i * 3] = bone;
      part[i * 3 + 1] = slot;
      part[i * 3 + 2] = bit ? Math.log2(bit) + 1 : 0;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
    }
    g.setAttribute("aPart", new THREE.BufferAttribute(part, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    geo.dispose();
  }
  build() {
    const g = mergeGeometries(this.parts)!;
    this.parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    return g;
  }
}

/** A small dog, facing +z. Bones: 0 body, 1 head, 2-5 legs (FL, FR, BL, BR), 6 tail. */
export function dogGeometry() {
  const r = new Rig();
  r.add(new THREE.CapsuleGeometry(0.11, 0.3, 2, 8), mat(0, 0.33, 0, 1, 1, 1, Math.PI / 2), 0, 0);
  r.add(new THREE.CylinderGeometry(0.118, 0.118, 0.2, 8, 1, true), mat(0, 0.335, 0.02, 1, 1, 1, Math.PI / 2), 0, 2);
  r.add(new THREE.SphereGeometry(0.1, 8, 6), mat(0, 0.46, 0.27), 1, 0);
  r.add(new THREE.BoxGeometry(0.085, 0.075, 0.11), mat(0, 0.435, 0.37), 1, 0, 0, 0.9);
  r.add(new THREE.BoxGeometry(0.035, 0.03, 0.03), mat(0, 0.455, 0.43), 1, 8);
  for (const s of [-1, 1]) r.add(new THREE.BoxGeometry(0.04, 0.09, 0.06), mat(s * 0.07, 0.53, 0.25, 1, 1, 1, 0.3, 0, s * 0.4), 1, 1);
  const legs: [number, number][] = [[0.07, 0.16], [-0.07, 0.16], [0.07, -0.16], [-0.07, -0.16]];
  legs.forEach(([x, z], k) => r.add(new THREE.CylinderGeometry(0.035, 0.03, 0.28, 5), mat(x, 0.14, z), 2 + k, 0, 0, 0.92));
  r.add(new THREE.CylinderGeometry(0.02, 0.012, 0.2, 4), mat(0, 0.46, -0.27, 1, 1, 1, -0.7), 6, 0);
  return r.build();
}

type Cart = "hotdog" | "pretzel" | "coffee";

/** Vendor cart, long axis along x, serving side +z. Vertex colors only. */
export function cartGeometry(kind: Cart) {
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: number, alt?: number, per = 2) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.applyMatrix4(m);
    g.deleteAttribute("uv");
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c.setHex(alt !== undefined && Math.floor(i / 3 / per) % 2 ? alt : hex, THREE.SRGBColorSpace);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  const steel = 0xc4cad2;
  const dark = 0x1d1f22;
  const wheel = (x: number) => {
    for (const z of [-0.36, 0.36]) add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), mat(x, 0.2, z, 1, 1, 1, Math.PI / 2), dark);
  };
  if (kind === "coffee") {
    add(new THREE.BoxGeometry(1.5, 1.0, 0.8), mat(0, 0.75, 0), 0x1f4f35);
    add(new THREE.BoxGeometry(1.42, 0.3, 0.02), mat(0, 0.95, 0.41), 0x6b3f22);
    add(new THREE.BoxGeometry(1.0, 0.12, 0.02), mat(0, 0.95, 0.425), 0xf2e6c8);
    add(new THREE.BoxGeometry(1.62, 0.05, 0.9), mat(0, 1.27, 0), 0x8a6a48);
    for (const x of [-0.72, 0.72]) for (const z of [-0.36, 0.36]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 5), mat(x, 1.75, z), steel);
    add(new THREE.BoxGeometry(1.8, 0.06, 1.1), mat(0, 2.24, 0.08, 1, 1, 1, 0.12), 0x1f4f35);
    for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.04, 0.03, 0.1, 6), mat(-0.5 + k * 0.14, 1.34, 0.25), 0xffffff);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), mat(0.45, 1.44, -0.1), steel);
    wheel(0.5);
  } else {
    const hot = kind === "hotdog";
    add(new THREE.BoxGeometry(1.5, 0.75, 0.75), mat(0, 0.72, 0), steel);
    add(new THREE.BoxGeometry(1.4, 0.38, 0.02), mat(0, 0.76, 0.385), hot ? 0xf2c230 : 0xc0392b);
    add(new THREE.BoxGeometry(0.9, 0.12, 0.02), mat(0, 0.78, 0.4), hot ? 0x1d5fae : 0xf2e6c8);
    add(new THREE.BoxGeometry(1.62, 0.04, 0.84), mat(0, 1.11, 0), 0x8f969e);
    for (const x of [-0.45, 0.0, 0.45]) add(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 10), mat(x, 1.21, -0.12), steel);
    if (!hot) {
      add(new THREE.BoxGeometry(0.5, 0.3, 0.4), mat(0.45, 1.28, 0.15), 0xbfe3f2);
      for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.06, 0.022, 4, 8), mat(0.32 + k * 0.13, 1.2, 0.15, 1, 1, 1, Math.PI / 2), 0x8a4b1c);
    }
    add(new THREE.CylinderGeometry(0.022, 0.022, 1.4, 5), mat(-0.2, 1.8, 0), steel);
    add(new THREE.ConeGeometry(1.15, 0.42, 8, 1, true), mat(-0.2, 2.6, 0), hot ? 0x1d5fae : 0xc0392b, hot ? 0xf2c230 : 0xf4f1e8, 1);
    add(new THREE.BoxGeometry(0.06, 0.06, 0.7), mat(0.82, 1.0, 0), dark);
    wheel(-0.5);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
}

const HEX = `
vec3 cwHex(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
mat3 cwF(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c); }
mat3 cwZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 cwY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
bool cwHidden(float bit, float mask) {
  return bit > 0.5 && mod(floor(mask / exp2(bit - 1.0)), 2.0) < 0.5;
}
`;

const DOG_BODY = `
int b = int(aPart.x + 0.5);
vec3 n0 = objectNormal;
if (b >= 2 && b <= 5) {
  float off = (b == 2 || b == 5) ? 0.0 : 3.14159;
  vec3 pv = vec3(cwP.x > 0.0 ? 0.07 : -0.07, 0.27, b <= 3 ? 0.16 : -0.16);
  mat3 r = cwF(iA.y * sin(iA.x + off));
  cwP = pv + r * (cwP - pv); n0 = r * n0;
} else if (b == 6) {
  vec3 pv = vec3(0.0, 0.38, -0.2);
  mat3 r = cwY(sin(iA.z) * 0.7);
  cwP = pv + r * (cwP - pv); n0 = r * n0;
} else if (b == 1) {
  vec3 pv = vec3(0.0, 0.42, 0.2);
  mat3 r = cwY(iA.w) * cwF(0.15 * sin(iA.x * 0.5));
  cwP = pv + r * (cwP - pv); n0 = r * n0;
}
cwP.y += abs(sin(iA.x)) * iA.y * 0.05;
objectNormal = n0;
`;

const DOG_COLOR = `(aPart.y < 0.5 ? cwHex(iCol0.x) : aPart.y < 1.5 ? cwHex(iCol0.y) : aPart.y < 2.5 ? cwHex(iCol0.z) : vec3(0.02))`;

function rigMaterial(key: string, attrs: string, body: string, color: string) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec3 aPart;\n${attrs}\n${HEX}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\nvec3 cwP = position;\n${body}`)
      .replace("#include <begin_vertex>", "vec3 transformed = cwP;")
      .replace("#include <color_vertex>", `#include <color_vertex>\nvColor.xyz *= ${color};`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

export type RigMesh = { mesh: THREE.InstancedMesh; attrs: Record<string, THREE.InstancedBufferAttribute> };

function rigMesh(geo: THREE.BufferGeometry, mat: THREE.Material, names: string[], max: number): RigMesh {
  const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  for (const n of names) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(n, a);
    attrs[n] = a;
  }
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.count = 0;
  return { mesh, attrs };
}

export function dogMesh(max: number) {
  const names = ["iA", "iCol0"];
  const decl = names.map((n) => `attribute vec4 ${n};`).join("\n");
  return rigMesh(dogGeometry(), rigMaterial("crowd-dog", decl, DOG_BODY, DOG_COLOR), names, max);
}
