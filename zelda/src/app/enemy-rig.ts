import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { inflate } from "./enemy-geo";

// Instanced rigid-part rig. Every part of a kind is merged into one geometry per material (a part-index vertex
// attribute tags each vertex), so a kind costs one draw call per material group, not per part. A pose is a set of part
// matrices relative to the root, written by the kind's animator into a per-enemy Float32Array. That pose goes into a
// float data texture (one row per enemy, 4 texels per part); the vertex shader fetches the part matrix by gl_InstanceID
// and aPart, and the instance matrix carries only the root transform, so far enemies can refresh their pose at 10 Hz
// while still moving smoothly. Glow shells (wind-up, hurt flash, dissolve) are one more merged mesh with its own
// compacted pose rows. An optional inverted-hull outline is one more draw over the shadow-casting groups.

export interface PartDef {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  glow?: boolean; // gets an additive glow shell (wind-up, hurt flash, dissolve)
  shadow?: boolean;
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _p = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

const POSE_GLSL = `
attribute float aPart;
uniform sampler2D uPose;
mat4 rigPose() {
  int c = int(aPart + 0.5) * 4;
  return mat4(texelFetch(uPose, ivec2(c, gl_InstanceID), 0), texelFetch(uPose, ivec2(c + 1, gl_InstanceID), 0),
    texelFetch(uPose, ivec2(c + 2, gl_InstanceID), 0), texelFetch(uPose, ivec2(c + 3, gl_InstanceID), 0));
}`;

type ShaderLike = { uniforms: Record<string, { value: unknown }>; vertexShader: string };

function injectPose(sh: ShaderLike, tex: THREE.Texture, extra?: string): void {
  sh.uniforms.uPose = { value: tex };
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\n" + POSE_GLSL)
    .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = mat3(rigPose()) * objectNormal;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = (rigPose() * vec4(transformed, 1.0)).xyz;" + (extra ?? ""));
}

/** Clone of a (possibly shared, look-patched) material whose vertex stage reads its part matrix from `tex`. */
function posedMaterial(src: THREE.Material, tex: THREE.Texture, tag: string, extra?: string): THREE.Material {
  const m = src.clone();
  const prev = src.onBeforeCompile, prevKey = src.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    injectPose(sh, tex, extra);
  };
  m.customProgramCacheKey = () => prevKey + "|rig" + tag;
  return m;
}

function poseTexture(parts: number, rows: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Float32Array(parts * 4 * rows * 4), parts * 4, rows, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Merge parts into one non-indexed geometry (position, normal, optional color) tagged with aPart. */
function mergeParts(list: { geo: THREE.BufferGeometry; part: number }[], color: boolean): THREE.BufferGeometry {
  const gs = list.map(({ geo, part }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && !(color && k === "color")) g.deleteAttribute(k);
    g.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count).fill(part), 1));
    return g;
  });
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  if (!out) throw new Error("enemy-rig: merge failed");
  out.computeBoundingSphere();
  return out;
}

export class Rig {
  readonly parts: number;
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly shells: { mesh: THREE.InstancedMesh; part: number }[] = [];
  private n = 0;
  private sn = 0;
  private readonly tex: THREE.DataTexture;
  private readonly shellTex: THREE.DataTexture | null;
  private shellMesh: THREE.InstancedMesh | null = null;
  private outlineMesh: THREE.InstancedMesh | null = null;
  private readonly all: THREE.InstancedMesh[] = [];
  private readonly ownGeo: THREE.BufferGeometry[] = [];
  private readonly ownMat: THREE.Material[] = [];
  private readonly ownTex: THREE.Texture[] = [];

  readonly cap: number;

  constructor(defs: PartDef[], cap: number, group: THREE.Group, shellMat: THREE.Material) {
    this.cap = cap;
    this.parts = defs.length;
    const P = defs.length;
    this.tex = poseTexture(P, cap);
    this.ownTex.push(this.tex);

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.receiveShadow = false;
      m.count = 0;
      this.ownGeo.push(geo);
      this.all.push(m);
      group.add(m);
      return m;
    };

    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (sh) => injectPose(sh, this.tex);
    depth.customProgramCacheKey = () => "rig-depth";
    this.ownMat.push(depth);

    // One mesh per (material, shadow) group.
    const groups = new Map<string, { mat: THREE.Material; shadow: boolean; list: { geo: THREE.BufferGeometry; part: number }[] }>();
    const matIds = new Map<THREE.Material, number>();
    defs.forEach((d, i) => {
      if (!matIds.has(d.mat)) matIds.set(d.mat, matIds.size);
      const shadow = d.shadow ?? true;
      const key = matIds.get(d.mat) + (shadow ? "s" : "n");
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { mat: d.mat, shadow, list: [] }));
      g.list.push({ geo: d.geo, part: i });
    });
    const hull: { geo: THREE.BufferGeometry; part: number }[] = [];
    for (const g of groups.values()) {
      const vc = !!(g.mat as THREE.MeshLambertMaterial).vertexColors;
      const geo = mergeParts(g.list, vc);
      const mat = posedMaterial(g.mat, this.tex, "");
      this.ownMat.push(mat);
      const m = mk(geo, mat);
      m.castShadow = g.shadow;
      if (g.shadow) m.customDepthMaterial = depth;
      this.meshes.push(m);
      if (g.shadow) hull.push(...g.list);
    }

    const glowList: { geo: THREE.BufferGeometry; part: number }[] = [];
    defs.forEach((d, i) => {
      if (!d.glow) return;
      const inf = inflate(d.geo, 0.05);
      glowList.push({ geo: inf, part: i });
    });
    if (glowList.length) {
      this.shellTex = poseTexture(P, cap);
      this.ownTex.push(this.shellTex);
      const geo = mergeParts(glowList, false);
      for (const g of glowList) g.geo.dispose();
      const sm = posedMaterial(shellMat, this.shellTex, "-shell");
      this.ownMat.push(sm);
      const s = mk(geo, sm);
      s.setColorAt(0, _col.setRGB(0, 0, 0));
      s.castShadow = false;
      s.renderOrder = 2;
      this.shellMesh = s;
      glowList.forEach((g) => this.shells.push({ mesh: s, part: g.part }));
    } else this.shellTex = null;

    // Outline: back faces of every shadow-casting part pushed out along the normal, faded out with distance.
    const om = new THREE.MeshBasicMaterial({ color: 0x1c140f, side: THREE.BackSide });
    om.onBeforeCompile = (sh) => {
      injectPose(
        sh,
        this.tex,
        `
        {
          vec3 hmN = normalize(mat3(rigPose()) * normal);
          float hmD = distance(cameraPosition, (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz);
          float hmF = 1.0 - smoothstep(18.0, 25.0, hmD);
          transformed += hmN * 0.014 * hmF * (1.0 + hmD * 0.03);
        }`,
      );
    };
    om.customProgramCacheKey = () => "rig-outline";
    this.ownMat.push(om);
    const o = mk(mergeParts(hull, false), om);
    o.castShadow = false;
    o.visible = false;
    this.outlineMesh = o;
  }

  /** Thin inverted-hull ink outline over the lit parts (one extra draw call per kind). Default off. */
  setOutline(on: boolean): void {
    if (this.outlineMesh) this.outlineMesh.visible = on;
  }

  begin(): void {
    this.n = 0;
    this.sn = 0;
  }

  /** Write one enemy: root transform times its cached local pose. `glow` is the additive shell color (0 = none). */
  draw(pose: Float32Array, x: number, y: number, z: number, yaw: number, scale: number, gr: number, gg: number, gb: number): void {
    if (this.n >= this.cap) return;
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _r.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale));
    const n = this.n++;
    const stride = this.parts * 16;
    (this.tex.image.data as Float32Array).set(pose.length > stride ? pose.subarray(0, stride) : pose, n * stride);
    for (const m of this.meshes) _r.toArray(m.instanceMatrix.array as Float32Array, n * 16);
    if (this.outlineMesh) _r.toArray(this.outlineMesh.instanceMatrix.array as Float32Array, n * 16);
    if (this.shellMesh && gr + gg + gb > 0.01) {
      const sn = this.sn++;
      _col.setRGB(gr, gg, gb);
      (this.shellTex!.image.data as Float32Array).set(pose.length > stride ? pose.subarray(0, stride) : pose, sn * stride);
      _r.toArray(this.shellMesh.instanceMatrix.array as Float32Array, sn * 16);
      this.shellMesh.setColorAt(sn, _col);
    }
  }

  end(): void {
    for (const m of this.meshes) {
      m.count = this.n;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.outlineMesh) {
      this.outlineMesh.count = this.n;
      this.outlineMesh.instanceMatrix.needsUpdate = true;
    }
    // no upload while no instance draws; a row-range upload is one GL call per row and these textures are at most 20 rows
    if (this.n > 0) this.tex.needsUpdate = true;
    if (this.shellMesh) {
      const s = this.shellMesh;
      s.count = this.sn;
      s.instanceMatrix.needsUpdate = true;
      if (s.instanceColor) s.instanceColor.needsUpdate = true;
      if (this.sn > 0) this.shellTex!.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.all) {
      m.removeFromParent();
      m.dispose();
    }
    for (const g of this.ownGeo) g.dispose();
    for (const m of this.ownMat) m.dispose();
    for (const t of this.ownTex) t.dispose();
  }
}

/** Writes part matrices (relative to the root) into a pose buffer. Parent index -1 = root. */
export class Poser {
  buf!: Float32Array;

  set(buf: Float32Array): this {
    this.buf = buf;
    return this;
  }

  part(i: number, parent: number, tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): void {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_v.set(tx, ty, tz), _q, _s.set(sx, sy, sz));
    if (parent >= 0) {
      _p.fromArray(this.buf, parent * 16);
      _m.premultiply(_p);
    }
    _m.toArray(this.buf, i * 16);
  }

  /** Hide a part (zero scale). */
  hide(i: number): void {
    const b = this.buf, o = i * 16;
    for (let k = 0; k < 16; k++) b[o + k] = 0;
    b[o + 15] = 1;
  }
}
