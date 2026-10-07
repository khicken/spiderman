import * as THREE from "three";

class Grow {
  a: Float32Array;
  n = 0;
  constructor(cap = 8192) {
    this.a = new Float32Array(cap);
  }
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new Float32Array(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
}

export type Col = number | THREE.Color;
export type Blink = readonly [number, number];
export type Rect = readonly [number, number, number, number];

const tc = new THREE.Color();
const nm = new THREE.Matrix3();
const NO_BLINK: Blink = [0, 0];

function rgb(c: Col, k = 1) {
  if (typeof c === "number") tc.setHex(c);
  else tc.copy(c);
  return tc.multiplyScalar(k);
}

export class Bucket {
  pos = new Grow();
  nor = new Grow();
  uv = new Grow();
  col = new Grow();
  blk = new Grow();
  constructor(
    public whiteUV: readonly [number, number] = [0, 0],
    public withBlink = false,
  ) {}

  get tris() {
    return this.pos.n / 9;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color, b: Blink) {
    this.pos.reserve(3);
    this.nor.reserve(3);
    this.uv.reserve(2);
    this.col.reserve(3);
    const p = this.pos;
    p.a[p.n++] = x;
    p.a[p.n++] = y;
    p.a[p.n++] = z;
    const n = this.nor;
    n.a[n.n++] = nx;
    n.a[n.n++] = ny;
    n.a[n.n++] = nz;
    const t = this.uv;
    t.a[t.n++] = u;
    t.a[t.n++] = v;
    const k = this.col;
    k.a[k.n++] = c.r;
    k.a[k.n++] = c.g;
    k.a[k.n++] = c.b;
    if (this.withBlink) {
      this.blk.reserve(2);
      this.blk.a[this.blk.n++] = b[0];
      this.blk.a[this.blk.n++] = b[1];
    }
  }

  /** Adds a transformed geometry. uv maps the source 0..1 uvs into an atlas rect. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: Col, k = 1, blink: Blink = NO_BLINK, uv?: Rect) {
    const c = rgb(color, k);
    nm.getNormalMatrix(m);
    const e = m.elements;
    const ne = nm.elements;
    const P = geo.attributes.position.array;
    const N = geo.attributes.normal.array;
    const U = geo.attributes.uv?.array;
    const idx = geo.index?.array;
    const count = idx ? idx.length : P.length / 3;
    const [wu, wv] = this.whiteUV;
    for (let i = 0; i < count; i++) {
      const j = idx ? idx[i] : i;
      const x = P[j * 3];
      const y = P[j * 3 + 1];
      const z = P[j * 3 + 2];
      const a = N[j * 3];
      const b = N[j * 3 + 1];
      const d = N[j * 3 + 2];
      let nx = ne[0] * a + ne[3] * b + ne[6] * d;
      let ny = ne[1] * a + ne[4] * b + ne[7] * d;
      let nz = ne[2] * a + ne[5] * b + ne[8] * d;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      let u = wu;
      let v = wv;
      if (uv && U) {
        u = uv[0] + U[j * 2] * (uv[2] - uv[0]);
        v = uv[1] + U[j * 2 + 1] * (uv[3] - uv[1]);
      }
      this.vert(
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
        nx,
        ny,
        nz,
        u,
        v,
        c,
        blink,
      );
    }
  }

  /** Quad p0..p3 counter-clockwise from the front. uv: p0=(u0,v0), p2=(u1,v1). */
  quad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    uv: Rect, color: Col, k = 1, blink: Blink = NO_BLINK,
  ) {
    const c = rgb(color, k);
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x3 - x0, by = y3 - y0, bz = z3 - z0;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const [u0, v0, u1, v1] = uv;
    this.vert(x0, y0, z0, nx, ny, nz, u0, v0, c, blink);
    this.vert(x1, y1, z1, nx, ny, nz, u1, v0, c, blink);
    this.vert(x2, y2, z2, nx, ny, nz, u1, v1, c, blink);
    this.vert(x0, y0, z0, nx, ny, nz, u0, v0, c, blink);
    this.vert(x2, y2, z2, nx, ny, nz, u1, v1, c, blink);
    this.vert(x3, y3, z3, nx, ny, nz, u0, v1, c, blink);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.a.slice(0, this.pos.n), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.nor.a.slice(0, this.nor.n), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(this.uv.a.slice(0, this.uv.n), 2));
    g.setAttribute("color", new THREE.BufferAttribute(this.col.a.slice(0, this.col.n), 3));
    if (this.withBlink) g.setAttribute("blink", new THREE.BufferAttribute(this.blk.a.slice(0, this.blk.n), 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Bucket split into square tiles so each tile is frustum culled on its own. */
export class Tiled extends Bucket {
  tiles = new Map<number, Bucket>();
  constructor(
    public size: number,
    public origin: number,
  ) {
    super();
  }
  at(x: number, z: number) {
    const k = Math.floor((x - this.origin) / this.size) * 1000 + Math.floor((z - this.origin) / this.size);
    let b = this.tiles.get(k);
    if (!b) this.tiles.set(k, (b = new Bucket()));
    return b;
  }
  override get tris() {
    let n = 0;
    for (const b of this.tiles.values()) n += b.tris;
    return n;
  }
  override add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: Col, k = 1, blink: Blink = NO_BLINK, uv?: Rect) {
    this.at(m.elements[12], m.elements[14]).add(geo, m, color, k, blink, uv);
  }
  override quad(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number, x3: number, y3: number, z3: number,
    uv: Rect, color: Col, k = 1, blink: Blink = NO_BLINK,
  ) {
    this.at(x0, z0).quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, uv, color, k, blink);
  }
  meshes(mat: THREE.Material) {
    return [...this.tiles.values()].filter((b) => b.tris).map((b) => new THREE.Mesh(b.build(), mat));
  }
}

export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  cone6: new THREE.ConeGeometry(1, 1, 6, 1),
  cone8: new THREE.ConeGeometry(1, 1, 8, 1),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  ball: new THREE.IcosahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  plane: new THREE.PlaneGeometry(1, 1),
  disc: new THREE.CircleGeometry(1, 10),
  torus: new THREE.TorusGeometry(1, 0.28, 3, 8),
  prism: new THREE.CylinderGeometry(1, 1, 1, 3, 1, true),
  tube: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true),
};

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();

export function mat(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
  E.set(rx, ry, rz, "YXZ");
  Q.setFromEuler(E);
  return M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz));
}

export function box(b: Bucket, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Col, ry = 0, k = 1, blink?: Blink) {
  b.add(UNIT.box, mat(x, y, z, sx, sy, sz, ry), color, k, blink);
}

export function slab(b: Bucket, x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: Col, ry = 0) {
  b.add(UNIT.box, mat(x, y0 + sy / 2, z, sx, sy, sz, ry), color);
}

export function beam(b: Bucket, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, color: Col, k = 1, blink?: Blink, geo: THREE.BufferGeometry = UNIT.box) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  V.set(dx / len, dy / len, dz / len);
  Q.setFromUnitVectors(S.set(0, 1, 0), V);
  M.compose(V.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Q, S.set(t, len, t));
  b.add(geo, M, color, k, blink);
}

export function cyl(b: Bucket, geo: THREE.BufferGeometry, x: number, y0: number, z: number, r: number, h: number, color: Col, k = 1, blink?: Blink) {
  b.add(geo, mat(x, y0 + h / 2, z, r, h, r), color, k, blink);
}

/** MeshBasicMaterial patch: per-vertex blink (x: hz, >0 flash, <0 soft twinkle; y: phase). */
export function blinkify<T extends THREE.Material>(m: T, time: { value: number }) {
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 blink;\nuniform float uTime;\nvarying float vBlink;")
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
        float ph = blink.y;
        #ifdef USE_INSTANCING
          ph += float(gl_InstanceID) * 0.618;
        #endif
        float bf = abs(blink.x);
        vBlink = bf == 0.0 ? 1.0 : blink.x > 0.0 ? mix(0.06, 1.0, step(0.5, fract(uTime * bf + ph))) : 0.5 + 0.5 * sin(6.2832 * (uTime * bf + ph));`,
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBlink;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vBlink;");
  };
  m.customProgramCacheKey = () => "blink";
  return m;
}

export class Bulbs {
  pos: number[] = [];
  col: number[] = [];
  data: number[] = [];
  add(x: number, y: number, z: number, color: Col, k: number, size: number, blink: Blink = NO_BLINK) {
    const c = rgb(color, k);
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.data.push(size, blink[0], blink[1]);
  }
  get count() {
    return this.pos.length / 3;
  }
  build(time: { value: number }, dot: THREE.Texture) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("data", new THREE.Float32BufferAttribute(this.data, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, uMap: { value: dot } }]),
      vertexShader: `
        attribute vec3 color;
        attribute vec3 data;
        uniform float uTime;
        uniform float uScale;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float f = abs(data.y);
          float b = f == 0.0 ? 1.0 : data.y > 0.0 ? mix(0.06, 1.0, step(0.5, fract(uTime * f + data.z))) : 0.5 + 0.5 * sin(6.2832 * (uTime * f + data.z));
          float px = data.x * uScale / -mvPosition.z;
          gl_PointSize = max(px, 2.0);
          vColor = color * b * min(1.0, px / 2.0 + 0.35);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          if (a < 0.05) discard;
          gl_FragColor = vec4(vColor * a, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    m.uniforms.uTime = time;
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    const size = new THREE.Vector2();
    p.onBeforeRender = (renderer, _s, camera) => {
      renderer.getDrawingBufferSize(size);
      m.uniforms.uScale.value = size.y / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
    };
    return p;
  }
}
