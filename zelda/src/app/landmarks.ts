import * as THREE from "three";
import type { BeaconId, CreateLandmarks, FrameCtx, GameEvent, LandmarksV2, Look, Prop, QuestState, Quality, ThreadAnchor, TrackTarget, V3, World } from "./contracts";
import { BEACON_LANDMARK, LANDMARKS, PLAYER_SPAWN, PROLOGUE } from "./contracts";
import { buildBeacon } from "./landmark-beacon";
import type { BeaconTower } from "./landmark-beacon";
import type { SiteEnv, SiteInfo, TrialHandle } from "./landmark-kit";
import { Mesher, PAL, flameCards } from "./landmark-kit";
import { Items, makeSiteEnv } from "./landmark-items";
import { buildShrine } from "./landmark-shrine";
import { buildVillage } from "./landmark-village";
import { buildSpire } from "./landmark-spire";
import type { SpireHandle } from "./landmark-spire";
import { buildEmberTrails, buildPrologueSite } from "./landmark-trail";
import type { EmberTrails, PrologueSite } from "./landmark-trail";
import { GATE_USE_R } from "./guide";
import { buildWaystone } from "./landmark-waystone";
import type { WaystoneHandle } from "./landmark-waystone";
import { SECRETS, V1_SECRETS, WAYSTONE_LIST } from "./landmark-paths";
import { buildSecretSet } from "./landmark-secrets";
import type { SecretSet } from "./landmark-secrets";
import { buildCliffLedge, buildDrownedRuins, buildFlankRuin, buildHollowOak, buildRiverStack } from "./landmark-secrets";
import { buildCliffTrial } from "./landmark-trial-cliff";
import { buildWoodTrial } from "./landmark-trial-wood";
import { buildLakeTrial } from "./landmark-trial-lake";
import { buildBluffTrial } from "./landmark-trial-bluff";
import { buildGladeTrial } from "./landmark-trial-glade";
import type { GladeTrialHandle } from "./landmark-trial-glade";

export const LM_OPTIONS = { applyUpdraft: true };

const SITE_DRAW = 260;

interface Site { info: SiteInfo; group: THREE.Group }

export interface LandmarksDev extends LandmarksV2 {
  readonly towers: readonly BeaconTower[];
  readonly trials: readonly TrialHandle[];
  readonly spire: SpireHandle;
  readonly items: Items;
  readonly siteList: readonly SiteInfo[];
  readonly trialTimeLeft: number | null;
  updraftAt(x: number, y: number, z: number): number;
}

class LandmarksImpl implements LandmarksDev {
  readonly group = new THREE.Group();
  readonly props: Prop[] = [];
  readonly towers: BeaconTower[] = [];
  readonly trials: TrialHandle[] = [];
  readonly items: Items;
  readonly spire: SpireHandle;
  readonly gladeTower: BeaconTower;
  readonly glade: GladeTrialHandle;
  private gladeGroup = new THREE.Group();
  private gladeLit = false;
  private world: World;
  private waystones = new Map<string, WaystoneHandle>();
  private foundWs = new Set<string>();
  private trails: EmberTrails | null = null;
  private trackedPath = -2;
  private paid = new Set<string>();
  private prologue: PrologueSite | null = null;
  private secrets: SecretSet | null = null;
  private sky = new THREE.Group();
  private sites: Site[] = [];
  private trialGroups: THREE.Group[] = [];
  private cliffUpdraft: (x: number, y: number, z: number) => number;
  private queued: GameEvent[] = [];
  private out: GameEvent[] = [];
  private lit: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private lastLit = -1;
  private lastArea = "";
  private barrier = false;
  private wakeSent = false;
  private emitFn = (e: GameEvent) => { this.out.push(e); this.onEmit(e); };
  private queueFn = (e: GameEvent) => { this.queued.push(e); this.onEmit(e); };
  private pending = false;
  private spireGroup: THREE.Group | null = null;

  constructor(scene: THREE.Scene, world: World, look: Look, quality: Quality) {
    this.world = world;
    this.group.name = "landmarks";
    this.sky.name = "landmarks-sky";
    this.items = new Items(world, look);
    this.group.add(this.items.group, this.sky);
    scene.add(this.group);

    const mk = (build: (env: ReturnType<typeof makeSiteEnv>) => SiteInfo) => {
      const g = new THREE.Group();
      this.group.add(g);
      const info = build(makeSiteEnv(this.items, world, look, quality, g));
      this.sites.push({ info, group: g });
    };
    mk(buildShrine);
    mk(buildVillage);
    mk(buildHollowOak);
    mk(buildCliffLedge);
    mk(buildRiverStack);
    mk(buildFlankRuin);
    mk(buildDrownedRuins);

    const sg = new THREE.Group();
    this.group.add(sg);
    const spire = buildSpire(makeSiteEnv(this.items, world, look, quality, sg));
    this.sites.push({ info: spire.info, group: sg });
    this.spireGroup = sg;
    this.spire = spire;

    // waystones are built on demand through the registry (SiteRegistryV2.waystone)
    this.items.waystoneHook = (id) => {
      const def = WAYSTONE_LIST.find((w) => w.id === id);
      if (!def || this.waystones.has(id)) return;
      const wg = new THREE.Group();
      this.group.add(wg);
      const h = buildWaystone(makeSiteEnv(this.items, world, look, quality, wg), def, {
        isFound: (k) => this.foundWs.has(k),
        find: (k) => { const first = !this.foundWs.has(k); this.foundWs.add(k); return first; },
      });
      this.waystones.set(id, h);
      this.sites.push({ info: { x: def.x, z: def.z, radius: 12 }, group: wg });
    };
    for (const w of WAYSTONE_LIST) this.items.waystone(w.id);

    {
      const pg = new THREE.Group();
      this.group.add(pg);
      const penv = makeSiteEnv(this.items, world, look, quality, pg);
      this.prologue = buildPrologueSite(penv);
      this.buildGate(penv, pg, this.prologue.gate);
      this.sites.push({ info: { x: -50, z: 300, radius: 70 }, group: pg });
      const tg = new THREE.Group();
      this.group.add(tg);
      this.trails = buildEmberTrails(makeSiteEnv(this.items, world, look, quality, tg));
      this.trails.setTracked(-1);
      const sg2 = new THREE.Group();
      this.group.add(sg2);
      this.secrets = buildSecretSet(makeSiteEnv(this.items, world, look, quality, sg2), this.items, SECRETS);
      for (const p of this.secrets.props) this.props.push(p);
      for (const v of V1_SECRETS) this.items.bindSecret(v.item, { id: v.id, kind: v.kind });
    }

    const builders = [buildCliffTrial, buildWoodTrial, buildLakeTrial, buildBluffTrial] as const;
    let updraft: (x: number, y: number, z: number) => number = () => 0;
    for (let i = 0; i < 4; i++) {
      const bg = new THREE.Group();
      this.group.add(bg);
      const tower = buildBeacon(makeSiteEnv(this.items, world, look, quality, bg), this.sky, i as BeaconId);
      this.towers.push(tower);
      const tg = new THREE.Group();
      this.group.add(tg);
      this.trialGroups.push(tg);
      const env = makeSiteEnv(this.items, world, look, quality, tg);
      const trial = builders[i](env, tower, this.sky) as TrialHandle & { updraftAt?: (x: number, y: number, z: number) => number };
      if (trial.updraftAt) updraft = trial.updraftAt.bind(trial);
      this.trials.push(trial);
      for (const p of trial.props) this.props.push(p);
      this.registerPedestal(tower, trial);
    }
    this.cliffUpdraft = updraft;

    // Glade Beacon: the small first goal of the prologue. T5 owns the trial; the tower is built here, cold until lit.
    const gg = this.gladeGroup;
    this.group.add(gg);
    this.gladeTower = buildBeacon(makeSiteEnv(this.items, world, look, quality, gg), this.sky, 4 as BeaconId);
    const glg = new THREE.Group();
    this.group.add(glg);
    this.trialGroups.push(glg);
    this.glade = buildGladeTrial(makeSiteEnv(this.items, world, look, quality, glg), this.gladeTower, this.sky);
    for (const p of this.glade.props) this.props.push(p);
    this.items.finalize();
    this.items.load([]);
  }

  get prompt() { return this.items.prompt; }

  get siteList(): readonly SiteInfo[] { return this.sites.map((s) => s.info); }

  get trialTimeLeft(): number | null {
    for (const t of this.trials) if (t.active) return t.timeLeft;
    return null;
  }

  updraftAt(x: number, y: number, z: number) { return this.cliffUpdraft(x, y, z); }

  private registerPedestal(tower: BeaconTower, trial: TrialHandle) {
    const p = tower.pedestal;
    const i = tower.index;
    this.items.interact({
      id: `pedestal-${i}`, x: p.x, y: p.y, z: p.z, r: 3.4,
      label: () => {
        if (this.lit[i]) return "Rest";
        if (trial.active) return null;
        if (this.activeIndex() >= 0) return null;
        return "Start trial";
      },
      use: () => {
        if (this.lit[i]) { this.emitFn({ type: "rest", pos: { x: p.x, y: p.y, z: p.z } }); return; }
        if (trial.active || this.activeIndex() >= 0) return;
        const why = trial.canStart(this.ctxRef!);
        if (why) { this.emitFn({ type: "toast", text: why }); return; }
        trial.start(this.ctxRef!, this.emitFn);
      },
    });
  }

  private ctxRef: FrameCtx | null = null;

  /** Gate brazier prompt and look. The trail site keeps the bowl; here the unlit bowl goes dark (no gold spark, ash cap over
   *  the gold rim) and the lit bowl gets layered flame cards. Prompt reach matches the guide's "near" (GATE_USE_R). */
  private buildGate(env: SiteEnv, pg: THREE.Group, gate: ThreadAnchor) {
    const P = PROLOGUE.gateBrazier;
    const gg = this.world.heightAt(P.x, P.z);
    for (const o of [...pg.children]) {
      if (o.name === "gate-flame") o.removeFromParent();
      else if (o instanceof THREE.Sprite && Math.abs(o.position.x - P.x) < 0.01 && Math.abs(o.position.z - P.z) < 0.01 && Math.abs(o.position.y - (gg + 1.6)) < 0.05) o.removeFromParent();
    }
    const cap = new Mesher(5191);
    cap.cyl(P.x, gg + 1.13, P.z, 1.0, 1.0, 0.14, PAL.ashLo, 8, 0, { ao: 0 });
    cap.cyl(P.x, gg + 1.05, P.z, 0.62, 0.7, 0.16, PAL.ash, 7, 0, { ao: 0 });
    const capMesh = cap.build(env.look, undefined, "gate-ash");
    env.own(capMesh.geometry);
    pg.add(capMesh);
    const flame = flameCards(env, P.x, gg + 1.15, P.z, 1.1);
    env.reg.interact({
      id: "prologue-gate-light",
      x: P.x,
      y: gg + 1,
      z: P.z,
      r: GATE_USE_R,
      label: () => (gate.lit ? null : "Light"),
      use: () => { gate.lit = true; },
    });
    env.reg.anim((c) => {
      capMesh.visible = !gate.lit;
      flame.lit = gate.lit;
      flame.tick(c.time, c.dt);
    });
  }

  private activeIndex() {
    for (let i = 0; i < this.trials.length; i++) if (this.trials[i].active) return i;
    return -1;
  }

  private onEmit(e: GameEvent) {
    if (e.type === "gladeLit") { this.gladeLit = true; return; }
    if (e.type === "waystone") { this.foundWs.add(e.id); return; }
    if (e.type !== "trialDone") return;
    const i = e.beacon;
    if (this.lit[i]) return;
    this.lit[i] = true;
    this.lastLit = i;
    const t = this.towers[i];
    t.setLit(true, true);
    this.trials[i].solved(true);
    const sink = this.pending ? this.queued : this.out;
    const f = t.flame;
    sink.push({ type: "beaconLit", beacon: i as BeaconId, pos: { x: f.x, y: f.y, z: f.z } });
    const sid = `shard-beacon-${i}`;
    if (!this.items.collected().includes(sid)) {
      sink.push({ type: "pickup", kind: "shard", amount: 1, pos: { x: f.x, y: t.pedestal.y + 1, z: f.z }, id: sid });
      this.items.markCollected(sid);
    }
    if (this.lit.every(Boolean) && !this.barrier) {
      this.barrier = true;
      this.spire.dropBarrier(true);
      this.spire.lightPath(true);
      sink.push({ type: "barrierDown" });
    }
  }

  /** Respawn point: the reached checkpoint nearest to where Wren fell (spawn, lit beacons, the lit Glade, found waystones). */
  private nearestCheckpoint(out: THREE.Vector3): string {
    const pp = this.ctxRef?.player.pos;
    let best = Infinity;
    let name = "Hollow Shrine";
    out.set(PLAYER_SPAWN.x, this.world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
    if (!pp) return name;
    const consider = (x: number, y: number, z: number, n: string) => {
      const d = (x - pp.x) * (x - pp.x) + (z - pp.z) * (z - pp.z);
      if (d >= best) return;
      best = d;
      name = n;
      out.set(x, y, z);
    };
    consider(out.x, out.y, out.z, name);
    for (let i = 0; i < this.towers.length; i++) {
      if (!this.lit[i]) continue;
      const f = this.towers[i].front;
      consider(f.x, f.y, f.z, LANDMARKS.find((l) => l.id === BEACON_LANDMARK[i])?.name ?? "Beacon");
    }
    if (this.gladeLit) { const f = this.gladeTower.front; consider(f.x, f.y, f.z, "Glade Beacon"); }
    for (const id of this.foundWs) {
      const w = this.waystones.get(id);
      const d = WAYSTONE_LIST.find((k) => k.id === id);
      if (w && d) consider(w.pos.x, this.world.heightAt(w.pos.x, w.pos.z), w.pos.z, d.name);
    }
    return name;
  }

  checkpoint(out: THREE.Vector3): THREE.Vector3 {
    this.nearestCheckpoint(out);
    return out;
  }

  checkpointName(): string {
    return this.nearestCheckpoint(this.tmpCp);
  }
  private tmpCp = new THREE.Vector3();

  get anchors(): readonly ThreadAnchor[] { return this.items.anchors; }

  waystonePos(id: string, out: THREE.Vector3): boolean {
    const w = this.waystones.get(id);
    if (!w || !this.foundWs.has(id)) return false;
    out.set(w.pos.x, this.world.heightAt(w.pos.x, w.pos.z), w.pos.z);
    return true;
  }

  targetPos(t: TrackTarget, out: THREE.Vector3): boolean {
    const h = (x: number, z: number) => out.set(x, this.world.heightAt(x, z), z);
    switch (t.kind) {
      case "beacon": { const k = this.towers[t.id]; out.set(k.cx, k.gy, k.cz); return true; }
      case "glade": if (this.glade.taskPos(out)) return true; out.set(this.gladeTower.cx, this.gladeTower.gy, this.gladeTower.cz); return true;
      case "spire": { const a = this.spire.arena; out.set(a.x, a.y, a.z); return true; }
      case "waystone": { const d = WAYSTONE_LIST.find((w) => w.id === t.id); if (!d) return false; h(d.x, d.z); return true; }
      case "item": {
        if (t.id === "gate-brazier") { h(PROLOGUE.gateBrazier.x, PROLOGUE.gateBrazier.z); return true; }
        const p = this.items.itemPos(t.id);
        if (!p) return false;
        out.set(p.x, p.y, p.z);
        return true;
      }
      default: return false;
    }
  }

  load(quest: QuestState, collected: readonly string[]) {
    for (const t of this.trials) t.abort();
    this.queued.length = 0;
    this.lastArea = "";
    this.wakeSent = quest.stage === "boss" || quest.stage === "ending" || quest.stage === "free";
    this.lastLit = -1;
    for (let i = 0; i < 4; i++) {
      const on = quest.beacons[i];
      this.lit[i] = on;
      this.towers[i].setLit(on, false);
      if (on) { this.trials[i].solved(false); this.lastLit = i; }
    }
    this.glade.abort();
    this.gladeLit = !!quest.gladeLit;
    this.gladeTower.setLit(this.gladeLit, false);
    if (this.gladeLit) this.glade.solved(false);
    if (collected.includes("glade-rings")) this.glade.markBonusDone();
    this.foundWs.clear();
    for (const id of quest.waystones ?? []) this.foundWs.add(id);
    for (const [id, h] of this.waystones) h.setFound(this.foundWs.has(id));
    if (this.prologue) this.prologue.gate.lit = quest.prologue ? quest.prologue !== "wake" && quest.prologue !== "gate" : quest.beacons.some(Boolean) || !!quest.gladeLit;
    this.barrier = quest.barrierDown;
    if (quest.barrierDown) this.spire.dropBarrier(false);
    else this.spire.raiseBarrier();
    this.spire.lightPath(quest.barrierDown);
    this.spire.bossAwake(quest.stage === "boss");
    this.spire.defeated(quest.wardenDefeated);
    this.items.load(collected);
    this.paid = new Set(collected);
  }

  collected() { return this.items.collected(); }

  update(ctx: FrameCtx): readonly GameEvent[] {
    this.ctxRef = ctx;
    this.out.length = 0;
    this.pending = false;
    for (let i = 0; i < this.queued.length; i++) this.out.push(this.queued[i]);
    this.queued.length = 0;

    const p = ctx.player.pos;
    const px = p.x, pz = p.z;

    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      const dx = px - s.info.x, dz = pz - s.info.z;
      // the spire is the island's skyline anchor; keep it visible from anywhere
      const lim = s.group === this.spireGroup ? 1e5 : s.info.radius + SITE_DRAW;
      s.group.visible = dx * dx + dz * dz < lim * lim;
    }

    const quest = ctx.quest;
    for (let i = 0; i < 4; i++) {
      const t = this.towers[i], tr = this.trials[i];
      const dx = px - t.cx, dz = pz - t.cz;
      const near = dx * dx + dz * dz < 260 * 260;
      this.trialGroups[i].visible = near || tr.active;
      t.tick(ctx.dt, ctx.time, near, px, pz, ctx.fx);
      if (near || tr.active) tr.update(ctx, this.emitFn, near);
    }

    {
      const t = this.gladeTower, g = this.glade;
      const dx = px - t.cx, dz = pz - t.cz;
      const near = dx * dx + dz * dz < 260 * 260;
      this.trialGroups[4].visible = near || g.active;
      t.tick(ctx.dt, ctx.time, near, px, pz, ctx.fx);
      if (near || g.active) g.update(ctx, this.emitFn, near);
    }

    this.items.update(ctx, this.emitFn);
    this.secrets?.update({ frame: ctx, emit: this.emitFn, time: ctx.time, dt: ctx.dt });
    {
      const tr = ctx.quest.tracked;
      const want = tr && tr.kind === "beacon" ? tr.id : -1;
      if (want !== this.trackedPath) { this.trackedPath = want; this.trails?.setTracked(want); }
    }

    if (LM_OPTIONS.applyUpdraft && ctx.player.mode === "glide") {
      const up = this.cliffUpdraft(px, p.y, pz);
      if (up > 0) p.y += up * ctx.dt;
    }

    const area = this.world.areaAt(px, pz);
    const id = area ? area.id : "";
    if (id !== this.lastArea) {
      this.lastArea = id;
      if (area) this.out.push({ type: "areaEnter", id: area.id, name: area.name, first: !quest.visited.includes(area.id) });
    }

    if (quest.stage === "spire" && !this.wakeSent) {
      const a = this.spire.arena;
      const dx = px - a.x, dz = pz - a.z;
      if (dx * dx + dz * dz < (a.r - 4) * (a.r - 4) && Math.abs(p.y - a.y) < 8) {
        this.wakeSent = true;
        this.spire.bossAwake(true);
        this.out.push({ type: "bossWake", pos: { x: a.x, y: a.y, z: a.z } });
      }
    }
    // integrator: a trial reward already paid in an earlier session (its pickup id is saved) is never paid again
    let w = 0;
    for (let r = 0; r < this.out.length; r++) {
      const e = this.out[r];
      if (e.type === "pickup" && e.id && this.paid.has(e.id)) continue;
      this.out[w++] = e;
    }
    this.out.length = w;
    return this.out;
  }

  handle(events: readonly GameEvent[]) {
    this.pending = true;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === "bossDefeated") { this.spire.defeated(true); this.spire.flare(); }
      else if (e.type === "bossPhase") this.spire.flare();
      else if (e.type === "died" && this.wakeSent && this.ctxRef?.quest.stage === "spire") {
        // enemies despawn the Warden on death; arm the arena again so it wakes when the player returns
        this.wakeSent = false;
        this.spire.bossAwake(false);
      }
      for (let k = 0; k < this.trials.length; k++) this.trials[k].handle(e, this.queueFn);
      this.glade.handle(e, this.queueFn);
      this.secrets?.handle(e);
      if (e.type === "pickup" && e.id) {
        this.items.markCollected(e.id);
        this.paid.add(e.id);
      }
    }
    this.pending = false;
  }

  setQuality(q: Quality) {
    for (const t of this.trials) t.setQuality(q);
    this.glade.setQuality(q);
    this.items.setQuality(q);
  }

  dispose() {
    this.items.dispose();
    this.group.removeFromParent();
    const mats = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
      else if (mm) mats.add(mm);
    });
    for (const m of mats) {
      // canvas textures (halos, hex barrier, stripes) are made per instance
      for (const v of Object.values(m)) if (v instanceof THREE.CanvasTexture) v.dispose();
      m.dispose();
    }
  }
}

export const createLandmarks: CreateLandmarks = (scene, world, look, quality) => new LandmarksImpl(scene, world, look, quality);
