import * as THREE from "three";
import type { BeaconId, CreateLandmarks, FrameCtx, GameEvent, Landmarks, Look, Prop, QuestState, Quality, V3, World } from "./contracts";
import { BEACON_LANDMARK, LANDMARKS, PLAYER_SPAWN } from "./contracts";
import { buildBeacon } from "./landmark-beacon";
import type { BeaconTower } from "./landmark-beacon";
import type { SiteInfo, TrialHandle } from "./landmark-kit";
import { Items, makeSiteEnv } from "./landmark-items";
import { buildShrine } from "./landmark-shrine";
import { buildVillage } from "./landmark-village";
import { buildSpire } from "./landmark-spire";
import type { SpireHandle } from "./landmark-spire";
import { buildCliffLedge, buildDrownedRuins, buildFlankRuin, buildHollowOak, buildRiverStack } from "./landmark-secrets";
import { buildCliffTrial } from "./landmark-trial-cliff";
import { buildWoodTrial } from "./landmark-trial-wood";
import { buildLakeTrial } from "./landmark-trial-lake";
import { buildBluffTrial } from "./landmark-trial-bluff";

export const LM_OPTIONS = { applyUpdraft: true };

const SITE_DRAW = 260;

interface Site { info: SiteInfo; group: THREE.Group }

export interface LandmarksDev extends Landmarks {
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
  private world: World;
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
        return "Begin trial";
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

  private activeIndex() {
    for (let i = 0; i < this.trials.length; i++) if (this.trials[i].active) return i;
    return -1;
  }

  private onEmit(e: GameEvent) {
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

  checkpoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.lastLit >= 0) {
      const f = this.towers[this.lastLit].front;
      return out.set(f.x, f.y, f.z);
    }
    return out.set(PLAYER_SPAWN.x, this.world.heightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
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
    this.barrier = quest.barrierDown;
    if (quest.barrierDown) this.spire.dropBarrier(false);
    else this.spire.raiseBarrier();
    this.spire.lightPath(quest.barrierDown);
    this.spire.bossAwake(quest.stage === "boss");
    this.spire.defeated(quest.wardenDefeated);
    this.items.load(collected);
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
      if (this.lit[i] || near) t.tick(ctx.dt, ctx.time, near, px, pz, ctx.fx);
      if (near || tr.active) tr.update(ctx, this.emitFn, near);
    }

    this.items.update(ctx, this.emitFn);

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
    }
    this.pending = false;
  }

  setQuality(q: Quality) {
    for (const t of this.trials) t.setQuality(q);
    this.items.setQuality(q);
  }

  dispose() {
    this.items.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

export const createLandmarks: CreateLandmarks = (scene, world, look, quality) => new LandmarksImpl(scene, world, look, quality);
