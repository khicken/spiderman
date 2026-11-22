import * as THREE from "three";
import type { BeaconId, FrameCtx, GameEvent, Look, Prop, Quality, ToonOpts, World } from "./contracts";

// Shared helpers for every landmark-*.ts file: a vertex-color mesh builder (merge per material), the palette, a seeded
// random, glow textures, and the registry that site builders use to hand collectibles / prompts to landmarks.ts.

export const PAL = {
  rock: "#8d8473", rockHi: "#a89f8b", rockLo: "#6e665a", ash: "#6b625a", ashLo: "#4a443f", ashHi: "#85796d",
  sand: "#e0cc98", dirt: "#9c7b55", dirtLo: "#6f553a", wood: "#8a6a45", woodLo: "#5e4630", woodHi: "#a98557",
  moss: "#6f8a4a", mossLo: "#4d6b3a", mossHi: "#8fae5a", leaf: "#4f7a3a", leafHi: "#6f9a46", birch: "#3f5a4a",
  gold: "#c9a13b", goldHi: "#e8c766", goldLo: "#8f6d22", teal: "#1f5a5e", tealHi: "#3f8a86", mist: "#8fb9b3",
  ember: "#f08a3c", emberHi: "#ffc07a", emberLo: "#b4511e", rubric: "#b8402b", gloam: "#5b3a6e", gloamHi: "#a47cc6",
  gloamLo: "#2e1d3a", parchment: "#efe3c8", ink: "#2b2118", cloth: "#b8402b", water: "#6fc2b4", foam: "#f8f0dd",
  rune: "#7fe0d0",
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Seeded random
// ---------------------------------------------------------------------------------------------------------------------
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mesher: accumulates transformed, vertex-colored, non-indexed primitives and builds ONE geometry.
// All coordinates are world coordinates unless a builder translates the finished mesh. `y0` means the BASE of a shape.
// ---------------------------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const colCache = new Map<string, THREE.Color>();
export function col(hex: string): THREE.Color {
  let c = colCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colCache.set(hex, c);
  }
  return c;
}
const _hsl = { h: 0, s: 0, l: 0 };
const _c = new THREE.Color();

const unitCache = new Map<string, THREE.BufferGeometry>();
function unit(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = unitCache.get(key);
  if (!g) {
    let b = make();
    if (b.index) b = b.toNonIndexed();
    b.computeBoundingBox();
    b.userData.shared = true; // module cache, outlives any one Landmarks instance
    unitCache.set(key, b);
    g = b;
  }
  return g;
}
const U = {
  box: () => unit("box", () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  cyl: (seg: number, ratio: number) => unit(`cyl${seg}:${ratio.toFixed(3)}`, () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1).translate(0, 0.5, 0)),
  ball: (det: number) => unit(`ball${det}`, () => new THREE.IcosahedronGeometry(1, det)),
  torus: (seg: number, tube: number, ratio: number) => unit(`tor${seg}:${tube}:${ratio.toFixed(3)}`, () => new THREE.TorusGeometry(1, ratio, tube, seg)),
  prism: () => unit("prism", () => {
    // triangular prism: base width 1 (x), ridge height 1 (y), length 1 (z), base at y 0, centered on x and z
    const g = new THREE.BufferGeometry();
    const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0, 1, -0.5], d = [-0.5, 0, 0.5], e = [0.5, 0, 0.5], f = [0, 1, 0.5];
    const tri = (...v: number[][]) => v.flat();
    const pos = new Float32Array([
      ...tri(a, c, b), ...tri(d, e, f), // end caps
      ...tri(a, d, f), ...tri(a, f, c), // left slope
      ...tri(b, c, f), ...tri(b, f, e), // right slope
      ...tri(a, b, e), ...tri(a, e, d), // bottom
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }),
};

export interface PrimOpts {
  rx?: number; rz?: number; // extra tilt (radians), applied after ry
  jit?: number; // lightness jitter (default 0.05)
  ao?: number; // darkening of the base of the shape (default 0.14)
  sx?: number; sz?: number; // extra non-uniform scale on x / z (cyl, ball)
}

export class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  colr: number[] = [];
  private rnd: () => number;
  constructor(seed = 1) {
    this.rnd = rng(seed);
  }
  get empty() { return this.pos.length === 0; }

  private push(g: THREE.BufferGeometry, color: THREE.Color, jit: number, ao: number) {
    const pa = g.attributes.position as THREE.BufferAttribute;
    const na = g.attributes.normal as THREE.BufferAttribute;
    const bb = g.boundingBox!;
    const hy = bb.max.y - bb.min.y || 1;
    _nm.getNormalMatrix(_m);
    // per-primitive lightness jitter
    color.getHSL(_hsl);
    const l0 = _hsl.l + (this.rnd() - 0.5) * 2 * jit;
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i);
      const t = (_v.y - bb.min.y) / hy;
      _v.applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      const k = 1 - ao * (1 - t) * (1 - t);
      _c.setHSL(_hsl.h, _hsl.s, Math.min(1, Math.max(0, l0 * k)));
      this.colr.push(_c.r, _c.g, _c.b);
    }
  }
  private set(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, o?: PrimOpts) {
    _p.set(x, y, z);
    _e.set(o?.rx ?? 0, ry, o?.rz ?? 0, "YXZ");
    _q.setFromEuler(_e);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
  }

  /** Box with its base center at (cx, y0, cz). */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: string, ry = 0, o?: PrimOpts) {
    this.set(cx, y0, cz, w, h, d, ry, o);
    this.push(U.box(), col(color), o?.jit ?? 0.05, o?.ao ?? 0.14);
  }
  /** Box centered on (cx, cy, cz). */
  boxc(cx: number, cy: number, cz: number, w: number, h: number, d: number, color: string, ry = 0, o?: PrimOpts) {
    this.box(cx, cy - h / 2, cz, w, h, d, color, ry, o);
  }
  /** Box from min/max corners (axis aligned). */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, o?: PrimOpts) {
    this.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, 0, o);
  }
  /** Cylinder / frustum: base radius rb at y0, top radius rt. */
  cyl(cx: number, y0: number, cz: number, rb: number, rt: number, h: number, color: string, seg = 8, ry = 0, o?: PrimOpts) {
    this.set(cx, y0, cz, rb * (o?.sx ?? 1), h, rb * (o?.sz ?? 1), ry, o);
    this.push(U.cyl(seg, rb > 0 ? rt / rb : 0), col(color), o?.jit ?? 0.05, o?.ao ?? 0.14);
  }
  cone(cx: number, y0: number, cz: number, r: number, h: number, color: string, seg = 6, ry = 0, o?: PrimOpts) {
    this.cyl(cx, y0, cz, r, 0, h, color, seg, ry, o);
  }
  /** Rounded blob (icosphere). rx radius on xz, ry radius on y. */
  ball(cx: number, cy: number, cz: number, r: number, color: string, sy = 1, det = 1, ry = 0, o?: PrimOpts) {
    this.set(cx, cy, cz, r * (o?.sx ?? 1), r * sy, r * (o?.sz ?? 1), ry, o);
    this.push(U.ball(det), col(color), o?.jit ?? 0.05, o?.ao ?? 0.1);
  }
  /** Torus, R = ring radius, r = tube radius. Default plane: the xy plane (a ring you fly through along z). */
  torus(cx: number, cy: number, cz: number, R: number, r: number, color: string, rx = 0, ry = 0, rz = 0, seg = 18, tube = 6) {
    _p.set(cx, cy, cz);
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _s.set(R, R, R);
    _m.compose(_p, _q, _s);
    this.push(U.torus(seg, tube, r / R), col(color), 0.03, 0);
  }
  /** Triangular roof prism: base width w (x) and length d (z) centered on (cx, cz), ridge h above y0. */
  prism(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: string, ry = 0, o?: PrimOpts) {
    this.set(cx, y0, cz, w, h, d, ry, o);
    this.push(U.prism(), col(color), o?.jit ?? 0.05, o?.ao ?? 0.08);
  }
  /** Beam between two points with a square cross section of the given thickness. */
  beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, color: string, o?: PrimOpts) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    _p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    _v.set(dx, dy, dz).normalize();
    _q.setFromUnitVectors(_s.set(0, 1, 0), _v);
    _s.set(t, len, t);
    _m.compose(_p, _q, _s);
    // unit box is base-aligned, so shift down half a unit along local y
    _m.multiply(_hold.makeTranslation(0, -0.5, 0));
    this.push(U.box(), col(color), o?.jit ?? 0.05, o?.ao ?? 0.1);
  }

  /** Build the merged mesh. `mat` defaults to the shared vertex-color toon material. */
  build(look: Look, mat?: THREE.Material | ToonOpts, name = "merged"): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colr, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    let material: THREE.Material;
    if (!mat) material = vcMat(look);
    else if (mat instanceof THREE.Material) material = mat;
    else material = look.toon(mat);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
const _hold = new THREE.Matrix4();

const vcMats = new WeakMap<Look, THREE.Material>();
/** The one shared vertex-color material for solid scenery. */
export function vcMat(look: Look): THREE.Material {
  let m = vcMats.get(look);
  if (!m) {
    m = look.toon({ color: "#ffffff", vertexColors: true });
    vcMats.set(look, m);
  }
  return m;
}
/** Two-sided vertex-color material (cloth, leaves, thin sheets). */
export function vcMat2(look: Look): THREE.Material {
  return look.toon({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide });
}
/** Emissive flat color material (glyphs, flames, crystals). */
export function glowMat(look: Look, color: string, intensity = 1, opts?: Partial<ToonOpts>): THREE.Material {
  return look.toon({ color, emissive: color, emissiveIntensity: intensity, rim: 0, ...opts });
}

// ---------------------------------------------------------------------------------------------------------------------
// Terrain helpers
// ---------------------------------------------------------------------------------------------------------------------
/** Lowest terrain height under a rotated-free footprint (center, half sizes). Use for foundations on slopes. */
export function groundMin(world: World, x: number, z: number, hw: number, hd: number): number {
  let m = Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) m = Math.min(m, world.heightAt(x + i * hw, z + j * hd));
  return m;
}
export function groundMax(world: World, x: number, z: number, hw: number, hd: number): number {
  let m = -Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) m = Math.max(m, world.heightAt(x + i * hw, z + j * hd));
  return m;
}

/** Add a visible AND solid wall/box from the ground up. Returns the collider id. `hole` extends the foundation down. */
export function solidBox(
  world: World, mesher: Mesher | null, owner: string, cx: number, cz: number, w: number, d: number, yTop: number,
  color: string, tag: "solid" | "climbable" = "solid", opts?: { y0?: number; ry?: number; collide?: boolean; o?: PrimOpts },
): number {
  const y0 = opts?.y0 ?? groundMin(world, cx, cz, w / 2, d / 2) - 0.6;
  if (mesher) mesher.box(cx, y0, cz, w, yTop - y0, d, color, opts?.ry ?? 0, opts?.o);
  if (opts?.collide === false) return -1;
  return world.addBox({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y0, maxY: yTop, tag, owner });
}

// ---------------------------------------------------------------------------------------------------------------------
// Textures: soft glow, hex barrier, water stripes. Cached per page; created on demand.
// ---------------------------------------------------------------------------------------------------------------------
export function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Additive halo sprite. Not lit, no fog: it is a light, not an object. */
export function haloSprite(tex: THREE.Texture, color: string, size: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Registry: how site builders hand things to landmarks.ts. Every id is stable across sessions (saved in `collected`).
// ---------------------------------------------------------------------------------------------------------------------
export type InteractKind = "rest" | "chest" | "lore" | "pedestal" | "lever" | "sign";

export interface ChestDef {
  id: string; // e.g. "chest-bow"
  x: number; y: number; z: number; // ground position of the chest center
  yaw: number; // faces (sin yaw, cos yaw)
  reward: { kind: "bow" | "glimmer" | "shard" | "arrows" | "heart" | "glider"; amount: number };
  big?: boolean;
  /** Optional collectible id for the reward heart shard (e.g. "shard-lake"); default = the chest id. */
  rewardId?: string;
}
export interface LoreDef { id: string; x: number; z: number; y?: number; yaw: number; title: string; text: string }
export interface ShardDef { id: string; x: number; y: number; z: number }
export interface ClusterDef { x: number; y: number; z: number; n: number; spread?: number }

export interface Registry {
  chest(c: ChestDef): void;
  lore(l: LoreDef): void;
  shard(s: ShardDef): void;
  /** n glimmers scattered around (x, y, z) within `spread` meters (default 1.4). y is the world y of the cluster center. */
  cluster(c: ClusterDef): void;
  /** Arrow bundle (+10). */
  arrows(id: string, x: number, y: number, z: number): void;
  /** Rest point: heals, saves, respawns camps. `label` is the HUD prompt. */
  rest(id: string, x: number, y: number, z: number, r: number): void;
  /** A use-button interaction (beacon pedestal, lever). `label` returns the HUD prompt or null (hidden); `use` runs on press. */
  interact(def: { id: string; x: number; y: number; z: number; r: number; label: () => string | null; use: () => void }): void;
  /** Per-frame animation hook; only called while the site is within draw distance. */
  anim(fn: (ctx: { time: number; dt: number; px: number; py: number; pz: number }) => void): void;
}

export interface SiteEnv {
  world: World;
  look: Look;
  quality: Quality;
  /** The site's own group. landmarks.ts shows/hides it by distance. Add every mesh here. */
  group: THREE.Group;
  reg: Registry;
  /** Anything with a dispose() (geometries, textures, materials you created) goes here. */
  own<T extends { dispose(): void }>(x: T): T;
  /** The stable `glowTexture()` shared by all sites. */
  glow: THREE.Texture;
}

/** Result of a site builder: where it sits, how far it can be seen from. */
export interface SiteInfo { x: number; z: number; radius: number }

export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
export function smooth(t: number) { const k = clamp(t, 0, 1); return k * k * (3 - 2 * k); }

export type Emit = (e: GameEvent) => void;

export interface TrialHandle {
  readonly beacon: BeaconId;
  readonly active: boolean;
  /** Stable array, owned by the trial; orchestrator concatenates it into Landmarks.props. */
  readonly props: Prop[];
  /** Seconds left for timed trials (HUD), else null. */
  readonly timeLeft: number | null;
  /** null = may start, else a short toast explaining why not (e.g. no bow). */
  canStart(ctx: FrameCtx): string | null;
  /** Pedestal used. Emits trialStart. */
  start(ctx: FrameCtx, emit: Emit): void;
  /** Called every frame while active, and every frame the player is within `near` range (cheap exit otherwise). Emits trialProgress / trialDone / trialFail. */
  update(ctx: FrameCtx, emit: Emit, near: boolean): void;
  /** Receives every game event (propHit, enemyDied, died, respawned, trialFail...). Emit via `emit`. */
  handle(e: GameEvent, emit: Emit): void;
  /** Silent reset to the untouched state (no events). Also used for trial fail cleanup. */
  abort(): void;
  /** Beacon lit: show the solved state (stair risen, gate open, etc.). `animated` true right after trialDone, false on load. */
  solved(animated: boolean): void;
  setQuality(q: Quality): void;
}
