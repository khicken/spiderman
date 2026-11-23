import * as THREE from "three";
import type { FrameCtx, GameEvent, Look, PickupKind, Quality, SiteRegistryV2, ThreadAnchor, V3, World } from "./contracts";
import { LANDMARKS } from "./contracts";
import type { AnimCtx, ChestDef, ClusterDef, Emit, LoreDef, Registry, ShardDef, SiteEnv } from "./landmark-kit";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Mesher, PAL, glowMat, glowTexture, haloSprite, rng, vcMat } from "./landmark-kit";

/** Ambient glimmers the filler tops the world up to. Keyed (trail) clusters come on top of this. */
export const GLIMMER_TOTAL = 120;
const PICK_R = 1.7;
const MAGNET_R = 4.2;
const VIS_R = 70;
/** Chests draw as three instanced meshes per size; they hide when no chest is this close (m). Halos hide a bit sooner. */
const CHEST_DRAW_R = 200;
const HALO_DRAW_R = 120;

interface Interact { id: string; x: number; y: number; z: number; r: number; label: () => string | null; use: () => void }
/** One size of chest: every chest of that size shares body, lid and lock instanced meshes (3 draw calls, not 4 per chest). */
interface ChestClass { s: number; n: number; near: number; body: THREE.InstancedMesh; lid: THREE.InstancedMesh; lock: THREE.InstancedMesh }
interface Chest {
  def: ChestDef; cls: ChestClass; idx: number; base: THREE.Matrix4; lidAngle: number;
  open: number; opening: number; done: boolean; halo: THREE.Sprite; shown: boolean;
}
interface Shard { def: ShardDef; mesh: THREE.Group; halo: THREE.Sprite; got: boolean; phase: number }
interface ArrowBundle { id: string; x: number; y: number; z: number; mesh: THREE.Mesh; got: boolean }
type Anim = (c: AnimCtx) => void;
interface SecretBind { id: string; kind: "trail" | "knots" | "critter" | "chime" | "blight" | "lore"; pos?: V3 }
interface Zone { id: string; x: number; y: number; z: number; r: number; h: number; onEnter: () => void; fired: boolean }

export class Items implements Registry, SiteRegistryV2 {
  readonly group = new THREE.Group();
  /** Thread anchors every site registered. Stable array: sites move `pos` in place. */
  readonly anchors: ThreadAnchor[] = [];
  /** landmarks.ts sets this; Registry.waystone(id) builds through it. */
  waystoneHook: (id: string) => void = () => {};
  prompt: string | null = null;
  private owned: { dispose(): void }[] = [];
  private world: World;
  private look: Look;
  private chests: Chest[] = [];
  private chestClasses: ChestClass[] = [];
  private shards: Shard[] = [];
  private lores: LoreDef[] = [];
  private clusters: ClusterDef[] = [];
  private bundles: ArrowBundle[] = [];
  private acts: Interact[] = [];
  private anims: Anim[] = [];
  private got = new Set<string>();
  private order: string[] = [];
  private out: Emit = () => {};
  readonly glow: THREE.Texture;
  private gx: Float32Array = new Float32Array(0);
  private gy: Float32Array = new Float32Array(0);
  private gz: Float32Array = new Float32Array(0);
  private goff: Float32Array = new Float32Array(0);
  private gDone: Uint8Array = new Uint8Array(0);
  private gIds: string[] = [];
  private gMesh: THREE.InstancedMesh | null = null;
  private gPts: THREE.Points | null = null;
  private gPos: Float32Array = new Float32Array(0);
  private gPosAttr: THREE.BufferAttribute | null = null;
  private finalized = false;
  private tmp: V3 = { x: 0, y: 0, z: 0 };
  private tmpUp: V3 = { x: 0, y: 1, z: 0 };
  private dummy = new THREE.Object3D();
  private active: Interact | null = null;
  private pendingReward: { chest: Chest; t: number }[] = [];
  private zones: Zone[] = [];
  private secrets = new Map<string, SecretBind>();
  private animCtx = { time: 0, dt: 0, px: 0, py: 0, pz: 0, frame: null as unknown as FrameCtx, emit: (() => {}) as Emit };

  constructor(world: World, look: Look) {
    this.world = world;
    this.look = look;
    this.glow = glowTexture();
    this.owned.push(this.glow);
  }

  chest(c: ChestDef) { this.chestDefs.push(c); }
  private chestDefs: ChestDef[] = [];
  lore(l: LoreDef) { this.lores.push(l); this.interact({ id: l.id, x: l.x, y: l.y ?? this.world.heightAt(l.x, l.z), z: l.z, r: 2.6, label: () => "Read", use: () => { this.out({ type: "read", title: l.title, text: l.text }); this.take(l.id); } }); }
  shard(s: ShardDef) { this.shardDefs.push(s); }
  private shardDefs: ShardDef[] = [];
  cluster(c: ClusterDef) { this.clusters.push(c); }
  arrows(id: string, x: number, y: number, z: number) { this.arrowDefs.push({ id, x, y, z }); }
  private arrowDefs: { id: string; x: number; y: number; z: number }[] = [];
  rest(id: string, x: number, y: number, z: number, r: number) {
    this.interact({ id, x, y, z, r, label: () => "Rest", use: () => { this.tmp = { x, y, z }; this.out({ type: "rest", pos: this.tmp }); } });
  }
  interact(def: Interact) { this.acts.push(def); }
  anim(fn: Anim) { this.anims.push(fn); }

  anchor(a: ThreadAnchor): ThreadAnchor { this.anchors.push(a); return a; }
  zone(def: { id: string; x: number; y: number; z: number; r: number; h?: number; onEnter: () => void }) {
    this.zones.push({ ...def, h: def.h ?? 6, fired: false });
  }
  waystone(id: string) { this.waystoneHook(id); }

  /** Completing the item `itemId` (a shard, chest reward, glimmer, lore stone) counts as finishing this secret. */
  bindSecret(itemId: string, s: SecretBind) { this.secrets.set(itemId, s); }

  /** True when the item id was collected (this load). */
  has(id: string) { return this.got.has(id); }

  /** World position of a registered shard, chest or lore stone. */
  itemPos(id: string): V3 | null {
    for (const d of this.shardDefs) if (d.id === id) return { x: d.x, y: d.y, z: d.z };
    for (const d of this.chestDefs) if (d.id === id) return { x: d.x, y: d.y, z: d.z };
    for (const d of this.lores) if (d.id === id) return { x: d.x, y: d.y ?? this.world.heightAt(d.x, d.z), z: d.z };
    return null;
  }

  /** Show a hidden chest (spirit led the player here, puzzle solved). */
  reveal(id: string) {
    for (const c of this.chests) {
      if (c.def.id !== id || c.shown) continue;
      c.shown = true;
      this.syncChest(c);
      if (!c.done) c.halo.visible = true;
    }
  }

  own<T extends { dispose(): void }>(x: T): T { this.owned.push(x); return x; }

  finalize(extraSpots: ClusterDef[] = []) {
    if (this.finalized) return;
    this.finalized = true;
    this.fillGlimmers(extraSpots);
    this.buildGlimmers();
    this.buildChests();
    for (const d of this.shardDefs) this.buildShard(d);
    this.buildBundles();
    this.buildPlainStones(this.lores.filter((l) => l.id === "lore-village" || l.stone));
  }

  get glimmerCount() { return this.gIds.length; }

  private fillGlimmers(extra: ClusterDef[]) {
    let n = 0;
    for (const c of this.clusters) if (!c.key) n += c.n;
    const rand = rng(777);
    const spots: ClusterDef[] = [...extra];
    for (const lm of LANDMARKS) {
      for (let k = 0; k < 6; k++) {
        const a = rand() * Math.PI * 2, rr = lm.r * (0.35 + rand() * 0.6);
        spots.push({ x: lm.x + Math.sin(a) * rr, y: 0, z: lm.z + Math.cos(a) * rr, n: 3 + ((rand() * 3) | 0), spread: 1.6 });
      }
    }
    let i = 0;
    while (n < GLIMMER_TOTAL && i < spots.length) {
      const s = spots[i++];
      const gy = this.world.heightAt(s.x, s.z);
      const w = this.world.waterAt(s.x, s.z);
      if (w > gy - 0.2) continue;
      const take = Math.min(s.n, GLIMMER_TOTAL - n);
      this.clusters.push({ x: s.x, y: s.y > 0 ? s.y : gy + 0.8, z: s.z, n: take, spread: s.spread });
      n += take;
    }
  }

  private buildGlimmers() {
    const rand = rng(4242);
    const total = this.clusters.reduce((a, c) => a + c.n, 0);
    this.gx = new Float32Array(total); this.gy = new Float32Array(total); this.gz = new Float32Array(total);
    this.goff = new Float32Array(total); this.gDone = new Uint8Array(total);
    let i = 0, u = 0;
    for (const c of this.clusters) {
      const sp = c.spread ?? 1.4;
      for (let k = 0; k < c.n; k++, i++, u += c.key ? 0 : 1) {
        const a = (k / c.n) * Math.PI * 2 + rand();
        const r = c.n === 1 ? 0 : sp * (0.5 + rand() * 0.5);
        this.gx[i] = c.x + Math.sin(a) * r;
        this.gz[i] = c.z + Math.cos(a) * r;
        this.gy[i] = c.y + (rand() - 0.5) * 0.5;
        this.goff[i] = rand() * 6.28;
        // unkeyed clusters keep the v1 index ids so old saves still match; keyed ones never shift anything
        this.gIds.push(c.key ? `glimmer:${c.key}:${k}` : `glimmer-${u}`);
      }
    }
    const geo = this.own(new THREE.OctahedronGeometry(0.2, 0).scale(0.8, 1.45, 0.8));
    const mat = this.own(this.look.patch(new THREE.MeshLambertMaterial({ color: PAL.goldHi, emissive: PAL.gold, emissiveIntensity: 1.1 })));
    const im = new THREE.InstancedMesh(geo, mat, total);
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gMesh = im;
    this.group.add(im);
    this.gPos = new Float32Array(total * 3);
    const pg = this.own(new THREE.BufferGeometry());
    this.gPosAttr = new THREE.BufferAttribute(this.gPos, 3);
    this.gPosAttr.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute("position", this.gPosAttr);
    const pm = this.own(new THREE.PointsMaterial({
      map: this.glow, color: PAL.goldHi, size: 1.15, sizeAttenuation: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, opacity: 0.85,
    }));
    const pts = new THREE.Points(pg, pm);
    pts.frustumCulled = false;
    this.gPts = pts;
    this.group.add(pts);
    for (let k = 0; k < total; k++) this.placeGlimmer(k, 0, 0, 0, false);
  }

  private placeGlimmer(i: number, time: number, px: number, pz: number, near: boolean) {
    const d = this.dummy;
    if (this.gDone[i]) {
      d.position.set(0, -9999, 0);
      d.scale.set(0.0001, 0.0001, 0.0001);
      d.updateMatrix();
      this.gMesh!.setMatrixAt(i, d.matrix);
      this.gPos[i * 3 + 1] = -9999;
      return;
    }
    const y = this.gy[i] + Math.sin(time * 2 + this.goff[i]) * 0.1;
    d.position.set(this.gx[i], y, this.gz[i]);
    d.rotation.set(0, time * 1.6 + this.goff[i], 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    this.gMesh!.setMatrixAt(i, d.matrix);
    this.gPos[i * 3] = this.gx[i];
    this.gPos[i * 3 + 1] = y;
    this.gPos[i * 3 + 2] = this.gz[i];
  }

  private chestClass(s: number, n: number): ChestClass {
    const body = new Mesher(11), lidM = new Mesher(12), trim = new Mesher(13), lock = new Mesher(14);
    body.box(0, 0, 0, 1.3 * s, 0.7 * s, 0.85 * s, PAL.wood);
    body.box(0, 0.02, 0, 1.36 * s, 0.1 * s, 0.9 * s, PAL.woodLo);
    for (const x of [-0.5, 0.5]) trim.box(x * s, 0, 0, 0.12 * s, 0.72 * s, 0.9 * s, PAL.gold, 0, { ao: 0 });
    lidM.box(0, 0, 0.42 * s, 1.34 * s, 0.14 * s, 0.9 * s, PAL.woodHi);
    lidM.box(0, 0.14 * s, 0.42 * s, 1.26 * s, 0.14 * s, 0.8 * s, PAL.wood);
    for (const x of [-0.5, 0.5]) trim.box(x * s, 0.0, 0.42 * s, 0.12 * s, 0.3 * s, 0.94 * s, PAL.gold, 0, { ao: 0 });
    lock.box(0, 0.5 * s, 0.46 * s, 0.22 * s, 0.26 * s, 0.1 * s, PAL.goldHi, 0, { ao: 0 });
    const bm = body.build(this.look), tm = trim.build(this.look), lm = lidM.build(this.look), lk = lock.build(this.look);
    // body and trim share the vertex-color material, so they fold into one geometry; the lid and the glowing lock stay apart
    const bodyGeo = this.own(mergeGeometries([bm.geometry, tm.geometry], false)!);
    for (const m of [bm, tm]) m.geometry.dispose();
    this.own(lm.geometry); this.own(lk.geometry);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.name = name;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.visible = false;
      this.group.add(im);
      return im;
    };
    const lockMat = this.own(glowMat(this.look, PAL.goldHi, 0.5)) as THREE.Material;
    const c: ChestClass = { s, n: 0, near: Infinity, body: mk(bodyGeo, vcMat(this.look), "chest-body"), lid: mk(lm.geometry, vcMat(this.look), "chest-lid"), lock: mk(lk.geometry, lockMat, "chest-lock") };
    for (const im of [c.body, c.lid, c.lock]) this.own({ dispose: () => im.dispose() });
    return c;
  }

  private buildChests() {
    const sizes = new Map<number, ChestClass>();
    const counts = new Map<number, number>();
    for (const d of this.chestDefs) { const s = d.big ? 1.35 : 1; counts.set(s, (counts.get(s) ?? 0) + 1); }
    for (const d of this.chestDefs) {
      const s = d.big ? 1.35 : 1;
      let cls = sizes.get(s);
      if (!cls) { cls = this.chestClass(s, counts.get(s)!); sizes.set(s, cls); this.chestClasses.push(cls); }
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(d.x, d.y, d.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw),
        new THREE.Vector3(1, 1, 1),
      );
      const halo = haloSprite(this.glow, PAL.goldHi, d.big ? 4.2 : 3);
      halo.position.set(d.x, d.y + 0.7 * s, d.z);
      this.group.add(halo);
      const c: Chest = { def: d, cls, idx: cls.n++, base, lidAngle: 0, open: 0, opening: 0, done: false, halo, shown: !d.hidden };
      if (d.hidden) halo.visible = false;
      this.chests.push(c);
      this.syncChest(c);
      const gy = d.y;
      this.interact({
        id: d.id, x: d.x, y: gy, z: d.z, r: 2.4,
        label: () => (c.opening || c.done || !c.shown ? null : "Open"),
        use: () => { c.opening = 1; this.pendingReward.push({ chest: c, t: 0.75 }); this.tmp = { x: d.x, y: gy + 0.9, z: d.z }; },
      });
    }
  }

  private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  private static readonly _lm = new THREE.Matrix4();
  private static readonly _rm = new THREE.Matrix4();

  /** Write one chest's body, lock and lid instance matrices (a hidden chest collapses to nothing). */
  private syncChest(c: Chest) {
    const k = c.cls, i = c.idx;
    if (!c.shown) {
      k.body.setMatrixAt(i, Items.ZERO); k.lock.setMatrixAt(i, Items.ZERO); k.lid.setMatrixAt(i, Items.ZERO);
    } else {
      k.body.setMatrixAt(i, c.base); k.lock.setMatrixAt(i, c.base);
      // the lid hinges on the back edge: group * translate(0, .68s, -.42s) * rotateX(angle)
      Items._lm.makeTranslation(0, 0.68 * k.s, -0.42 * k.s).multiply(Items._rm.makeRotationX(c.lidAngle));
      k.lid.setMatrixAt(i, Items._lm.premultiply(c.base));
    }
    k.body.instanceMatrix.needsUpdate = true; k.lock.instanceMatrix.needsUpdate = true; k.lid.instanceMatrix.needsUpdate = true;
  }

  private buildShard(def: ShardDef) {
    const g = new THREE.Group();
    const geo = this.own(new THREE.OctahedronGeometry(0.42, 0).scale(0.7, 1.4, 0.7));
    const core = new THREE.Mesh(geo, this.own(glowMat(this.look, "#ff9ec0", 1.4)) as THREE.Material);
    const rim = new THREE.Mesh(this.own(new THREE.OctahedronGeometry(0.58, 0).scale(0.7, 1.4, 0.7)), this.own(new THREE.MeshBasicMaterial({
      color: "#ffd0e0", transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })));
    g.add(core, rim);
    g.position.set(def.x, def.y, def.z);
    const halo = haloSprite(this.glow, "#ff9ec0", 3.2);
    halo.position.set(def.x, def.y, def.z);
    this.group.add(g, halo);
    this.shards.push({ def, mesh: g, halo, got: false, phase: def.x * 0.37 });
  }

  private buildBundles() {
    if (!this.arrowDefs.length) return;
    const m = new Mesher(21);
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9;
      m.cyl(Math.sin(a) * 0.1, -0.35, Math.cos(a) * 0.1, 0.025, 0.025, 0.9, PAL.woodHi, 4, 0, { rx: Math.sin(a) * 0.08, rz: Math.cos(a) * 0.08 });
      m.cone(Math.sin(a) * 0.1, 0.55, Math.cos(a) * 0.1, 0.05, 0.14, PAL.rockHi, 4);
    }
    m.cyl(0, -0.05, 0, 0.14, 0.14, 0.12, PAL.cloth, 6, 0, { ao: 0 });
    const geo = this.own(m.build(this.look, undefined, "arrows").geometry);
    for (const a of this.arrowDefs) {
      const mesh = new THREE.Mesh(geo, vcMat(this.look));
      mesh.position.set(a.x, a.y + 0.6, a.z);
      mesh.rotation.z = 0.5;
      this.group.add(mesh);
      this.bundles.push({ id: a.id, x: a.x, y: a.y + 0.6, z: a.z, mesh, got: false });
    }
  }

  /** Lore stones merge per 128 m cell: stone and rune are one mesh each per cell, culled by their real bounds. */
  private buildPlainStones(list: LoreDef[]) {
    const cells = new Map<string, { stone: THREE.BufferGeometry[]; rune: THREE.BufferGeometry[] }>();
    for (const l of list) {
      const m = new Mesher(31), glow = new Mesher(32);
      const y = this.world.heightAt(l.x, l.z);
      m.box(l.x, y - 0.4, l.z, 1.0, 2.1, 0.45, PAL.rockHi, l.yaw);
      m.box(l.x, y + 1.6, l.z, 0.8, 0.3, 0.38, PAL.rock, l.yaw);
      glow.boxc(l.x + Math.sin(l.yaw) * 0.24, y + 0.9, l.z + Math.cos(l.yaw) * 0.24, 0.5, 0.7, 0.04, PAL.rune, l.yaw, { ao: 0 });
      const key = `${Math.floor(l.x / 128)},${Math.floor(l.z / 128)}`;
      let c = cells.get(key);
      if (!c) cells.set(key, c = { stone: [], rune: [] });
      c.stone.push(m.build(this.look).geometry);
      c.rune.push(glow.build(this.look).geometry);
      this.world.addBox({ minX: l.x - 0.5, maxX: l.x + 0.5, minZ: l.z - 0.5, maxZ: l.z + 0.5, minY: y - 0.4, maxY: y + 1.7, tag: "solid", owner: "landmarks:lore-village-stone" });
    }
    if (!cells.size) return;
    const runeMat = this.own(glowMat(this.look, PAL.rune, 0.9)) as THREE.Material;
    for (const c of cells.values()) {
      for (const [parts, mat, name] of [[c.stone, vcMat(this.look), "lore-stone"], [c.rune, runeMat, "lore-rune"]] as const) {
        const g = this.own(mergeGeometries(parts as THREE.BufferGeometry[], false)!);
        for (const p of parts) p.dispose();
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
  }

  load(collected: readonly string[]) {
    this.got.clear();
    this.order.length = 0;
    for (const id of collected) { this.got.add(id); this.order.push(id); }
    for (let i = 0; i < this.gIds.length; i++) this.gDone[i] = this.got.has(this.gIds[i]) ? 1 : 0;
    for (const s of this.shards) { s.got = this.got.has(s.def.id); s.mesh.visible = !s.got; s.halo.visible = !s.got; }
    for (const b of this.bundles) { b.got = this.got.has(b.id); b.mesh.visible = !b.got; }
    for (const c of this.chests) {
      c.done = this.got.has(c.def.id);
      c.opening = 0;
      c.open = c.done ? 1 : 0;
      c.lidAngle = c.done ? -1.9 : 0;
      c.shown = !c.def.hidden;
      c.halo.visible = c.shown && !c.done;
      this.syncChest(c);
    }
    for (const z of this.zones) z.fired = false;
    this.pendingReward.length = 0;
  }

  collected(): readonly string[] { return this.order; }

  markCollected(id: string) { this.take(id); }

  private take(id: string) {
    if (this.got.has(id)) return false;
    this.got.add(id);
    this.order.push(id);
    const sec = this.secrets.get(id);
    if (sec) this.out({ type: "secret", id: sec.id, kind: sec.kind, pos: sec.pos ?? this.itemPos(id) ?? { x: 0, y: 0, z: 0 } });
    return true;
  }

  private pickup(kind: PickupKind, amount: number, x: number, y: number, z: number, id: string) {
    this.out({ type: "pickup", kind, amount, pos: { x, y, z }, id } as GameEvent);
  }

  handle(_e: GameEvent) {}

  update(ctx: FrameCtx, emit: Emit) {
    if (!this.finalized) return;
    this.out = emit;
    const p = ctx.player.pos;
    const px = p.x, py = p.y + 0.9, pz = p.z;
    const time = ctx.time, dt = ctx.dt;
    const fx = ctx.fx;

    let any = false;
    const n = this.gIds.length;
    for (let i = 0; i < n; i++) {
      if (this.gDone[i]) continue;
      const dx = this.gx[i] - px, dz = this.gz[i] - pz;
      const d2h = dx * dx + dz * dz;
      if (d2h > VIS_R * VIS_R) continue;
      const dy = this.gy[i] - py;
      const d2 = d2h + dy * dy;
      if (d2 < MAGNET_R * MAGNET_R) {
        const d = Math.sqrt(d2) || 0.001;
        const pull = (1 - d / MAGNET_R) * 7 * dt;
        this.gx[i] -= (dx / d) * pull;
        this.gy[i] -= (dy / d) * pull;
        this.gz[i] -= (dz / d) * pull;
      }
      if (d2 < PICK_R * PICK_R) {
        this.gDone[i] = 1;
        if (this.take(this.gIds[i])) {
          this.pickup("glimmer", 1, this.gx[i], this.gy[i], this.gz[i], this.gIds[i]);
          this.tmp.x = this.gx[i]; this.tmp.y = this.gy[i]; this.tmp.z = this.gz[i];
          fx.burst("glimmer", this.tmp, 6, this.tmpUp, 2.5);
        }
      }
      this.placeGlimmer(i, time, px, pz, true);
      any = true;
    }
    if (any && this.gMesh && this.gPosAttr) {
      this.gMesh.instanceMatrix.needsUpdate = true;
      this.gPosAttr.needsUpdate = true;
    }

    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (s.got) continue;
      const dx = s.def.x - px, dz = s.def.z - pz;
      if (dx * dx + dz * dz > 90 * 90) continue;
      const y = s.def.y + Math.sin(time * 1.6 + s.phase) * 0.14;
      s.mesh.position.y = y;
      s.halo.position.y = y;
      s.mesh.rotation.y = time * 1.1 + s.phase;
      const dy = s.def.y - py;
      if (dx * dx + dz * dz + dy * dy < 2.2 * 2.2) {
        s.got = true;
        s.mesh.visible = false;
        s.halo.visible = false;
        if (this.take(s.def.id)) {
          this.pickup("shard", 1, s.def.x, s.def.y, s.def.z, s.def.id);
          this.tmp.x = s.def.x; this.tmp.y = s.def.y; this.tmp.z = s.def.z;
          fx.burst("heal", this.tmp, 14, this.tmpUp, 3);
        }
      }
    }

    for (let i = 0; i < this.bundles.length; i++) {
      const b = this.bundles[i];
      if (b.got) continue;
      const dx = b.x - px, dz = b.z - pz;
      const d2h = dx * dx + dz * dz;
      if (d2h > 80 * 80) continue;
      b.mesh.rotation.y = time * 1.2;
      b.mesh.position.y = b.y + Math.sin(time * 2 + i) * 0.08;
      const dy = b.y - py;
      if (d2h + dy * dy < 2 * 2) {
        b.got = true;
        b.mesh.visible = false;
        if (this.take(b.id)) this.pickup("arrows", 10, b.x, b.y, b.z, b.id);
      }
    }

    for (let i = this.pendingReward.length - 1; i >= 0; i--) {
      const r = this.pendingReward[i];
      r.t -= dt;
      if (r.t > 0) continue;
      this.pendingReward.splice(i, 1);
      const c = r.chest;
      c.done = true;
      c.halo.visible = false;
      const d = c.def;
      this.take(d.id);
      const rid = d.rewardId ?? d.id;
      if (d.rewardId) this.take(d.rewardId);
      this.pickup(d.reward.kind as PickupKind, d.reward.amount, d.x, d.y + 1, d.z, rid);
      this.tmp.x = d.x; this.tmp.y = d.y + 0.9; this.tmp.z = d.z;
      fx.burst("glimmer", this.tmp, 14, this.tmpUp, 4);
    }
    for (let i = 0; i < this.chests.length; i++) {
      const c = this.chests[i];
      if (c.opening && c.open < 1) {
        c.open = Math.min(1, c.open + dt * 1.6);
        const k = 1 - (1 - c.open) * (1 - c.open);
        c.lidAngle = -1.9 * k;
        this.syncChest(c);
      }
      const dx = c.def.x - px, dz = c.def.z - pz, d2 = dx * dx + dz * dz;
      if (!c.done) {
        c.halo.visible = c.shown && d2 < HALO_DRAW_R * HALO_DRAW_R;
        if (d2 < 60 * 60) c.halo.material.opacity = 0.7 + Math.sin(time * 2.4 + i) * 0.25;
      }
      if (c.shown && d2 < c.cls.near) c.cls.near = d2;
    }
    for (const k of this.chestClasses) {
      k.body.visible = k.lid.visible = k.lock.visible = k.near < CHEST_DRAW_R * CHEST_DRAW_R;
      k.near = Infinity;
    }

    const ac = this.animCtx;
    ac.time = time; ac.dt = dt; ac.px = p.x; ac.py = p.y; ac.pz = p.z; ac.frame = ctx; ac.emit = emit;
    for (let i = 0; i < this.anims.length; i++) this.anims[i](ac);
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.fired) continue;
      const dx = z.x - p.x, dz = z.z - p.z;
      if (dx * dx + dz * dz < z.r * z.r && Math.abs(z.y - p.y) < z.h) { z.fired = true; z.onEnter(); }
    }

    let best: Interact | null = null, bestD = 1e9, label: string | null = null;
    for (let i = 0; i < this.acts.length; i++) {
      const a = this.acts[i];
      const dx = a.x - px, dz = a.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > a.r * a.r || d2 >= bestD) continue;
      if (Math.abs(a.y - p.y) > 4.5) continue;
      const l = a.label();
      if (l === null) continue;
      best = a; bestD = d2; label = l;
    }
    this.active = best;
    this.prompt = label;
    if (best && ctx.input.btn.use.pressed) best.use();
  }

  setQuality(_q: Quality) {}

  dispose() {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}

export function makeSiteEnv(items: Items, world: World, look: Look, quality: Quality, group: THREE.Group): SiteEnv {
  return {
    world, look, quality, group, reg: items, own: (x) => items.own(x), glow: items.glow,
    collected: (id) => items.collected().includes(id), markCollected: (id) => items.markCollected(id),
  };
}
