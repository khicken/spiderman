import type { ContainerView, Dim, EntityApi, GameCtx, GameEvent, HudState, Quality, RendererApi } from "./contracts";
import { AIR, DAY_TICKS, MIN_Y, SET_NOTIFY, idOf, stateOf } from "./contracts";
import { BLOCKS, OPAQUE, SOLID, blockDef, blockId } from "./blocks/registry";
import { itemDef } from "./items/registry";
import { isPotionItem, potionItemName, potionOf } from "./items/potions";
import { createAudio, type GameAudio } from "./audio";
import { createEntities } from "./entities";
import { createHostileWorld } from "./entities/hostile";
import { createInventory } from "./items";
import { BEHAVIORS } from "./mechanics";
import { bedStandSpot, type BedSpawn } from "./mechanics/interact";
import { createInput, createPlayer } from "./player";
import { setKeyBinds } from "./player/input";
import { createTouchControls, isTouchDevice } from "./player/touch";
import { CAVE_CULL } from "./render/cave-cull";
import { createRenderer } from "./render";
import { createSystems } from "./systems";
import { uiBridge, type Toast } from "./systems/ui-bridge";
import { runCommand } from "./ui/commands";
import { computeGuiScale } from "./ui/gui";
import type { Settings } from "./ui/settings";
import { createWorld, type World } from "./world";
import { loadEntities, saveEntities, saveMeta, type WorldMeta } from "./world/save";
import { findSpawn } from "./worldgen";

export type GamePhase = "loading" | "playing";

export interface GameUi {
  hud(h: HudState): void;
  phase(p: GamePhase, progress: number): void;
  container(view: ContainerView | null): void;
  chat(text: string, color?: string): void;
  title(text: string, subtitle?: string): void;
  actionBar?(text: string): void;
  hurt(): void;
  died(message: string): void;
  action(a: string): void; // input actions the page handles: pause, chat, command, debug, hide_gui
  toast?(t: Toast): void;
  credits?(): void;
}

export interface GameOptions {
  meta: WorldMeta;
  settings: Settings;
  ui: GameUi;
  audio?: GameAudio;
}

type Meta = WorldMeta & { hostile?: unknown; systems?: unknown };

const TICK = 1 / 20;
const MAX_TICKS = 4;
const AUTOSAVE_MS = 30000;
const FURNACE_LIKE = new Set(["furnace", "lit_furnace", "blast_furnace", "lit_blast_furnace", "smoker", "lit_smoker", "brewing_stand", "hopper"]);
const FACING = ["north (Towards negative Z)", "east (Towards positive X)", "south (Towards positive Z)", "west (Towards negative X)"];
const r2 = (v: number) => v.toFixed(3);

export function startGame(canvas: HTMLCanvasElement, opts: GameOptions) {
  const meta = opts.meta as Meta;
  const ui = opts.ui;
  uiBridge.toast = (t) => ui.toast?.(t);
  uiBridge.credits = () => ui.credits?.();
  let settings = opts.settings;
  const ownAudio = !opts.audio;
  const audio = opts.audio ?? createAudio();
  const input = createInput(canvas);
  const touch = isTouchDevice() ? createTouchControls(input, () => computeGuiScale(settings.guiScale, window.innerWidth, window.innerHeight)) : null;
  input.enabled = false;
  const hostile = createHostileWorld();
  hostile.load(meta.hostile);

  let dim: Dim = meta.dim ?? "overworld";
  let world: World = null!;
  let renderer: RendererApi = null!;
  let entities: EntityApi = null!;
  let offWorld: (() => void) | null = null;

  const time = { tick: meta.tick ?? 0, dayTime: meta.dayTime ?? 0, day: Math.floor((meta.tick ?? 0) / DAY_TICKS), rain: meta.rain ?? 0, thunder: meta.thunder ?? 0 };
  const queued: GameEvent[] = [];
  let containerOpen = false;
  let disposed = false;
  let paused = false;

  const ctx = {
    rules: meta.rules,
    time,
    random: Math.random,
    behaviors: BEHAVIORS,
    audio,
    emit: (e: GameEvent) => route(e),
  } as unknown as GameCtx;
  const getCtx = () => ctx;
  const systems = createSystems(getCtx);
  let staged = false;

  const inventory = createInventory(getCtx);
  ctx.inventory = inventory;
  const rawOpen = inventory.open.bind(inventory);
  const rawClose = inventory.close.bind(inventory);
  inventory.open = (kind, at) => {
    rawOpen(kind, at);
    if (inventory.view()) route({ type: "open_container", kind, ...at });
  };
  inventory.close = () => {
    const was = !!inventory.view();
    rawClose();
    if (was) route({ type: "close_container" });
  };

  function buildStage(d: Dim) {
    dim = d;
    world = createWorld({ seed: meta.seed, dim: d, worldId: meta.id, behaviors: BEHAVIORS, getCtx });
    ctx.world = world;
    renderer = createRenderer(canvas, world);
    ctx.renderer = renderer;
    renderer.resize(window.innerWidth, window.innerHeight);
    applySettings();
    entities = createEntities(getCtx);
    ctx.entities = entities;
    offWorld = world.on((e) => {
      if (e.type !== "loaded") return;
      const list = world.takeEntities(e.cx, e.cz);
      if (list) for (const s of list) entities.spawn(s.type, s.x, s.y, s.z, { ...(s.data ?? {}), yaw: s.yaw });
    });
    staged = false;
  }

  function disposeStage() {
    if (staged) systems.unstage();
    staged = false;
    offWorld?.();
    entities.dispose();
    renderer.dispose();
    world.dispose();
  }

  buildStage(dim);
  if (meta.inventory) inventory.load(meta.inventory);

  const player = createPlayer(getCtx, input);
  ctx.player = player;
  player.gameMode = meta.gameMode;
  if (meta.player) player.load(meta.player);
  systems.load(meta.systems);
  const hasSave = !!meta.player;
  const sp = findSpawn(meta.seed);
  if (!meta.spawn) meta.spawn = { x: sp.x, y: 80, z: sp.z };
  if (!hasSave) player.spawn = { ...meta.spawn };

  let phase: GamePhase = "loading";
  let target = hasSave ? { x: player.body.pos.x, y: player.body.pos.y, z: player.body.pos.z } : { x: meta.spawn.x + 0.5, y: NaN, z: meta.spawn.z + 0.5 };
  let arrival: "spawn" | "portal" | "end" | "saved" = hasSave ? "saved" : "spawn";
  let loadStart = performance.now();
  let entitiesToLoad: Dim | null = dim;

  function setPhase(p: GamePhase, progress: number) {
    phase = p;
    ui.phase(p, progress);
  }

  function route(e: GameEvent) {
    systems.onEvent(e);
    switch (e.type) {
      case "sound":
        audio.play(e.name, e.x, e.y, e.z, e.volume, e.pitch);
        return;
      case "particles":
        if (settings.particles === "minimal" ? Math.random() < 0.9 : settings.particles === "decreased" && Math.random() < 0.5) return;
        renderer?.addParticles(e);
        return;
      case "block_changed": {
        const name = BLOCKS[idOf(e.to)]?.name;
        if (name && FURNACE_LIKE.has(name)) inventory.trackBlockEntity(e.x, e.y, e.z);
        return;
      }
      case "open_container":
        containerOpen = true;
        input.enabled = false;
        if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
        ui.container(inventory.view());
        return;
      case "close_container":
        if (inventory.view()) rawClose();
        containerOpen = false;
        ui.container(null);
        resume();
        return;
      case "player_hurt":
        ui.hurt();
        return;
      case "player_died":
        input.enabled = false;
        if (document.pointerLockElement) document.exitPointerLock();
        ui.died(e.message);
        return;
      case "chat":
        ui.chat(e.text, e.color);
        return;
      case "title":
        ui.title(e.text, e.subtitle);
        return;
      case "action_bar":
        ui.actionBar?.(e.text);
        return;
      case "advancement":
        return;
      case "change_dim":
        queued.push(e);
        return;
      case "explosion":
        return;
    }
  }

  const offAction = input.onAction((a) => {
    if (a === "inventory") {
      if (player.dead) return;
      inventory.open(player.gameMode === "creative" ? "creative" : "inventory");
      return;
    }
    if (a === "fullscreen") {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen().catch(() => {});
      return;
    }
    if (a === "screenshot") {
      renderer.render(0);
      const link = document.createElement("a");
      link.download = `minecraft-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      ui.chat(`Saved screenshot as ${link.download}`);
      return;
    }
    if (a === "pause" || a === "chat" || a === "command" || a === "debug" || a === "hide_gui") ui.action(a);
  });

  function applySettings() {
    const quality: Quality = touch ? "low" : settings.graphics === "fancy" ? "high" : "medium";
    renderer.setOptions({ fov: settings.fov, quality, clouds: settings.clouds, brightness: settings.brightness });
    renderer.setRenderDistance(settings.renderDistance);
    audio.setVolume(settings.master, settings.volumes?.music ?? settings.music, 1);
    if (settings.volumes) audio.setCategories(settings.volumes);
    if (settings.keys) setKeyBinds(settings.keys, { sneak: !!settings.toggleSneak, sprint: !!settings.toggleSprint });
    if (ctx.player) {
      const p = ctx.player as ReturnType<typeof createPlayer>;
      p.fovEffects = settings.fovEffects ?? 1;
      p.sensitivity = settings.sensitivity;
      p.invertY = settings.invertMouse;
      p.fov = settings.fov;
      p.viewBobbing = settings.viewBobbing;
    }
  }


  function changeDim(e: Extract<GameEvent, { type: "change_dim" }>) {
    void saveEntities(meta.id, dim, entities.save()).catch(() => {});
    void world.save().catch(() => {});
    if (inventory.view()) inventory.close();
    disposeStage();
    buildStage(e.dim);
    meta.dim = e.dim;
    target = { x: e.x, y: e.y, z: e.z };
    arrival = e.dim === "end" ? "end" : e.dim === "overworld" && e.x === player.spawn.x && e.z === player.spawn.z ? "spawn" : "portal";
    if (arrival === "spawn") target.y = NaN;
    entitiesToLoad = e.dim;
    player.teleport(e.x, e.y, e.z);
    loadStart = performance.now();
    input.enabled = false;
    setPhase("loading", 0);
  }

  function solidAt(x: number, y: number, z: number) {
    const id = idOf(world.getBlock(x, y, z));
    return !!SOLID[id] && !!OPAQUE[id];
  }
  const free = (x: number, y: number, z: number) => {
    const s = world.getBlock(x, y, z);
    return s === AIR || blockDef(s).replaceable === true;
  };

  function findPortalBlock(x: number, y: number, z: number): [number, number, number] | null {
    const portal = blockId("nether_portal");
    const top = dim === "nether" ? 126 : 319;
    let best: [number, number, number] | null = null;
    let bestD = Infinity;
    for (let dx = -16; dx <= 16; dx++) {
      for (let dz = -16; dz <= 16; dz++) {
        for (let yy = Math.max(MIN_Y, dim === "nether" ? 1 : MIN_Y); yy <= top; yy++) {
          if (idOf(world.getBlock(x + dx, yy, z + dz)) !== portal) continue;
          if (idOf(world.getBlock(x + dx, yy - 1, z + dz)) === portal) continue;
          const d = dx * dx + dz * dz + (yy - y) * (yy - y);
          if (d < bestD) {
            bestD = d;
            best = [x + dx, yy, z + dz];
          }
        }
      }
    }
    return best;
  }

  function buildPortal(x: number, z: number, yHint: number): [number, number, number] {
    let y = -1;
    const lo = dim === "nether" ? 32 : Math.max(MIN_Y + 8, 0);
    const hi = dim === "nether" ? 110 : Math.min(world.topY(x, z) + 1, 300);
    const ok = (yy: number) => solidAt(x, yy - 1, z) && solidAt(x + 1, yy - 1, z) && [0, 1, 2, 3].every((h) => free(x - 1, yy + h, z) && free(x, yy + h, z) && free(x + 1, yy + h, z) && free(x + 2, yy + h, z));
    let bestD = Infinity;
    for (let yy = lo; yy <= hi; yy++) if (ok(yy) && Math.abs(yy - yHint) < bestD) {
      bestD = Math.abs(yy - yHint);
      y = yy;
    }
    const obsidian = stateOf(blockId("obsidian"));
    if (y < 0) {
      y = dim === "nether" ? 70 : Math.max(70, world.topY(x, z) + 1);
      for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 1; dz++) {
        world.setBlock(x + dx, y - 1, z + dz, obsidian, SET_NOTIFY);
        for (let h = 0; h < 4; h++) world.setBlock(x + dx, y + h, z + dz, AIR, SET_NOTIFY);
      }
    }
    for (let i = -1; i <= 2; i++) {
      world.setBlock(x + i, y - 1, z, obsidian, 0);
      world.setBlock(x + i, y + 3, z, obsidian, 0);
    }
    for (let h = 0; h < 3; h++) {
      world.setBlock(x - 1, y + h, z, obsidian, 0);
      world.setBlock(x + 2, y + h, z, obsidian, 0);
    }
    const portal = stateOf(blockId("nether_portal"), 1);
    for (let h = 0; h < 3; h++) for (let i = 0; i < 2; i++) world.setBlock(x + i, y + h, z, portal, 0);
    return [x, y, z];
  }

  function placeEndPlatform() {
    const obsidian = stateOf(blockId("obsidian"));
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      world.setBlock(100 + dx, 48, dz, obsidian, 0);
      for (let h = 1; h <= 3; h++) world.setBlock(100 + dx, 48 + h, dz, AIR, 0);
    }
  }

  function standable(x: number, z: number): number {
    const y = world.topY(x, z);
    if (y <= MIN_Y) return NaN;
    const s = world.getBlock(x, y, z);
    const def = blockDef(s);
    if (!def.opaque || !def.solid || def.tags?.includes("logs")) return NaN;
    return y + 1;
  }

  function safeSpot(x: number, z: number): [number, number, number] {
    for (let r = 0; r <= 32; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const y = standable(x + dx, z + dz);
          if (Number.isFinite(y) && world.ready(x + dx, z + dz)) return [x + dx, y, z + dz];
        }
      }
    }
    const y = world.topY(x, z) + 1;
    return [x, y > MIN_Y ? y : 80, z];
  }

  function arrive() {
    const tx = Math.floor(target.x), tz = Math.floor(target.z);
    if (arrival === "end") {
      placeEndPlatform();
      player.teleport(100.5, 49, 0.5);
    } else if (arrival === "portal") {
      const found = findPortalBlock(tx, Number.isFinite(target.y) ? Math.floor(target.y) : 64, tz) ?? buildPortal(tx, tz, Math.floor(target.y));
      player.teleport(found[0] + 0.5, found[1], found[2] + 0.5);
    } else if (arrival === "spawn") {
      const [sx, sy, sz] = safeSpot(tx, tz);
      if (!hasSave && player.spawn.y === 80) player.spawn = { x: sx, y: sy, z: sz };
      meta.spawn = { ...player.spawn };
      player.teleport(sx + 0.5, sy, sz + 0.5);
    } else {
      player.teleport(target.x, target.y, target.z);
    }
    if (entitiesToLoad) {
      const d = entitiesToLoad;
      entitiesToLoad = null;
      void loadEntities(meta.id, d).then((list) => {
        if (!disposed && dim === d && list.length) entities.load(list);
      }).catch(() => {});
    }
    audio.setMusic(dim === "nether" ? "nether" : dim === "end" ? "end" : player.gameMode === "creative" ? "creative" : "overworld");
    if (!staged) {
      staged = true;
      systems.stage();
    }
    setPhase("playing", 1);
    resume();
  }

  function loadingProgress(): number {
    const tx = target.x, tz = target.z;
    const loaded = world.loadedChunks();
    const pend = world.pendingChunks();
    const chunkP = loaded / Math.max(1, loaded + pend);
    const q = renderer.meshQueue();
    const meshP = 1 / (1 + q / 40);
    const ready = world.ready(tx, tz) && world.ready(tx + 16, tz) && world.ready(tx - 16, tz) && world.ready(tx, tz + 16) && world.ready(tx, tz - 16);
    return ready ? Math.min(1, 0.6 + 0.4 * meshP) : Math.min(0.6, chunkP * 0.6);
  }

  function loadingDone(): boolean {
    const tx = target.x, tz = target.z;
    const ready = world.ready(tx, tz) && world.ready(tx + 16, tz) && world.ready(tx - 16, tz) && world.ready(tx, tz + 16) && world.ready(tx, tz - 16);
    if (!ready) return false;
    return renderer.meshQueue() < 8 || performance.now() - loadStart > 15000;
  }

  function resume() {
    if (phase !== "playing" || containerOpen || paused || player.dead) return;
    input.enabled = true;
  }


  let raining = time.rain > 0.5, thundering = time.thunder > 0.5;
  let rainTimer = 12000 + Math.floor(Math.random() * 168000), thunderTimer = 12000 + Math.floor(Math.random() * 168000);
  let lastRain = time.rain, lastThunder = time.thunder;

  function tickWeather() {
    if (Math.abs(time.rain - lastRain) > 0.02) {
      raining = time.rain > 0.5;
      rainTimer = raining ? 12000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
    }
    if (Math.abs(time.thunder - lastThunder) > 0.02) {
      thundering = time.thunder > 0.5;
      thunderTimer = thundering ? 3600 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
    }
    if (--rainTimer <= 0) {
      raining = !raining;
      rainTimer = raining ? 12000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
    }
    if (--thunderTimer <= 0) {
      thundering = !thundering;
      thunderTimer = thundering ? 3600 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
    }
    time.rain = Math.max(0, Math.min(1, time.rain + (raining ? 0.01 : -0.01)));
    time.thunder = Math.max(0, Math.min(1, time.thunder + (raining && thundering ? 0.01 : -0.01)));
    lastRain = time.rain;
    lastThunder = time.thunder;
  }


  function tick() {
    time.tick++;
    world.tick(ctx);
    entities.tick(ctx);
    hostile.tick(ctx);
    inventory.tick(ctx);
    player.tick(ctx);
    systems.tick();
    tickPortalFx();
    if (meta.rules.doDaylightCycle && dim === "overworld") {
      if (++time.dayTime >= DAY_TICKS) {
        time.dayTime = 0;
        time.day++;
      }
    }
    if (dim === "overworld") tickWeather();
  }

  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let frames = 0, fps = 0, fpsAt = last;
  const prof = { frame: 0, worst: 0, worstAcc: 0, tick: 0, ticks: 0, entities: 0, world: 0, render: 0 };
  const ema = (a: number, b: number) => a + (b - a) * 0.1;
  let hudAt = 0;
  let saveAt = last + AUTOSAVE_MS;
  let lastView = -1;
  let dark = false;

  let drawnAt = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const cap = settings.maxFps ?? 260;
    if (cap < 260 && now - drawnAt < 1000 / cap - 2) return;
    drawnAt = now;
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    frames++;
    prof.frame = ema(prof.frame, dt * 1000);
    if (dt * 1000 > prof.worstAcc) prof.worstAcc = dt * 1000;
    if (now - fpsAt >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
      prof.worst = prof.worstAcc;
      prof.worstAcc = 0;
    }
    try {
      if (phase === "loading") {
        world.update(target.x, target.z, settings.renderDistance);
        renderer.camera.position.set(target.x, Number.isFinite(target.y) ? target.y + 1.6 : 100, target.z);
        renderer.render(dt);
        if (loadingDone()) arrive();
        else if (now - hudAt > 100) {
          hudAt = now;
          ui.phase("loading", loadingProgress());
        }
        return;
      }
      const p0 = performance.now();
      if (!paused) {
        acc += dt;
        let n = 0;
        while (acc >= TICK && n < MAX_TICKS) {
          tick();
          acc -= TICK;
          n++;
          if (queued.length) break;
        }
        if (acc > TICK) acc = TICK;
        prof.ticks = ema(prof.ticks, n);
        if (queued.length) {
          const e = queued.shift()!;
          queued.length = 0;
          changeDim(e as Extract<GameEvent, { type: "change_dim" }>);
          return;
        }
      }
      const pt = paused ? 1 : acc / TICK;
      touch?.update(input.enabled);
      const p1 = performance.now();
      player.frame(dt, pt);
      entities.frame(dt, pt);
      systems.frame(dt);
      const p2 = performance.now();
      world.update(player.body.pos.x, player.body.pos.z, settings.renderDistance);
      const p3 = performance.now();
      renderer.setTime(time.day * DAY_TICKS + time.dayTime);
      renderer.setWeather(time.rain, time.thunder);
      renderer.render(dt);
      const p4 = performance.now();
      prof.tick = ema(prof.tick, p1 - p0);
      prof.entities = ema(prof.entities, p2 - p1);
      prof.world = ema(prof.world, p3 - p2);
      prof.render = ema(prof.render, p4 - p3);
      if (containerOpen && inventory.version !== lastView) {
        lastView = inventory.version;
        ui.container(inventory.view());
      }
      if (now - hudAt > 100) {
        hudAt = now;
        const pos = player.body.pos;
        const isDark = dim !== "overworld" || world.getSkyLight(Math.floor(pos.x), Math.floor(pos.y + 1), Math.floor(pos.z)) < 8;
        if (isDark !== dark) dark = isDark;
        audio.setAmbient({ dark, rain: dim === "overworld" ? time.rain : 0 });
        ui.hud(hudState());
      }
      if (now > saveAt) {
        saveAt = now + AUTOSAVE_MS;
        void save();
      }
    } catch (err) {
      console.error(err);
    }
  }


  let debugOn = false;
  let portalFx = 0;
  const portalId = blockId("nether_portal");

  function tickPortalFx() {
    const p = player.body.pos;
    const inside = idOf(world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) === portalId || idOf(world.getBlock(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))) === portalId;
    portalFx = inside ? Math.min(1, portalFx + 0.0125) : Math.max(0, portalFx - 0.05);
  }

  function lightAtEye(): number {
    const p = player.body.pos;
    const x = Math.floor(p.x), y = Math.floor(p.y + 1.62), z = Math.floor(p.z);
    const sky = dim === "overworld" ? world.getSkyLight(x, y, z) : 0;
    return Math.max(sky, world.getBlockLight(x, y, z)) / 15;
  }

  // Vanilla saves a 64x64 icon.png from the last frame when the world closes.
  function worldIcon(): string | undefined {
    try {
      renderer.render(0);
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      if (!g) return undefined;
      const s = Math.min(canvas.width, canvas.height);
      g.imageSmoothingQuality = "high";
      g.drawImage(canvas, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s, 0, 0, 64, 64);
      return c.toDataURL("image/jpeg", 0.85);
    } catch {
      return undefined;
    }
  }

  function hudState(): HudState {
    const inv = inventory;
    const held = inv.held();
    const p = player as typeof player & { frozenTicks?: number };
    const bossBars: HudState["bossBars"] = [];
    for (const e of entities.all()) {
      const b = e.data.bossbar as HudState["bossBars"][number] | undefined;
      if (b && !e.dead) bossBars.push(b);
    }
    systems.bossBars(bossBars);
    const h: HudState = {
      health: player.health,
      maxHealth: player.maxHealth,
      food: player.food,
      saturation: player.saturation,
      armor: inv.armorPoints(),
      air: player.air,
      xpLevel: player.xpLevel,
      xpProgress: player.xpProgress,
      hotbar: inv.slots.slice(0, 9),
      offhand: inv.slots[40] ?? null,
      selected: inv.selected,
      gameMode: player.gameMode,
      effects: player.effects.slice(),
      hardcore: meta.hardcore,
      poisoned: player.effects.some((e) => e.id === "poison"),
      withered: player.effects.some((e) => e.id === "wither"),
      frozen: (p.frozenTicks ?? 0) > 0,
      bossBars,
      heldName: held ? held.name ?? (isPotionItem(held.item) ? potionItemName(held.item, potionOf(held)) : itemDef(held.item)?.displayName ?? held.item) : undefined,
      underwater: player.air < 300,
      dead: player.dead,
      sleeping: player.sleeping ? 1 : 0,
      pumpkin: inv.slots[36]?.item === "carved_pumpkin" && player.thirdPerson === 0,
      spyglass: (player as typeof player & { using?: { kind: string } | null }).using?.kind === "spyglass" && player.thirdPerson === 0,
      freeze: Math.min(1, (p.frozenTicks ?? 0) / 140),
      portal: portalFx,
      light: lightAtEye(),
      mountHealth: player.mountHealth(),
      mountJump: player.mountJump(),
    };
    if (debugOn) h.debug = debugLines();
    return h;
  }

  let gpu = "";
  function gpuName(): string {
    if (gpu) return gpu;
    try {
      const gl = renderer.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    } catch {
      gpu = "unknown";
    }
    return gpu.slice(0, 60);
  }

  function debugLines(): Record<string, string> {
    const pos = player.body.pos;
    const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
    const dir = player.lookDir();
    const f = Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 1 : 3) : dir.z > 0 ? 2 : 0;
    const yawDeg = ((((-player.yaw * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
    const biome = world.getBiome(bx, bz);
    const info = renderer.renderer.info;
    const t = player.target;
    const sky = world.getSkyLight(bx, by + 1, bz), blk = world.getBlockLight(bx, by + 1, bz);
    const diffId = { peaceful: 0, easy: 1, normal: 2, hard: 3 }[meta.rules.difficulty];
    let ld = 0.75 + Math.max(0, Math.min(1, (time.tick - 72000) / 1440000)) * 0.25;
    if (diffId === 1) ld *= 0.5;
    const local = diffId * ld;
    const clamped = local < 2 ? 0 : local > 4 ? 1 : (local - 2) / 2;
    const cx = bx >> 4, cz = bz >> 4;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number; totalJSHeapSize: number } }).memory;
    const MB = 1048576;
    const out: Record<string, string> = {
      "l:0": "Minecraft 1.21 (1.21/vanilla)",
      "l:1": `${fps} fps T: ${(settings.maxFps ?? 260) >= 260 ? "inf" : settings.maxFps} ${settings.graphics} ${settings.clouds ? "fancy-clouds" : ""} B: 2`,
      "l:2": `C: ${world.loadedChunks()}/${world.loadedChunks() + world.pendingChunks()} D: ${settings.renderDistance}, pU: ${renderer.meshQueue()}`,
      "l:3": `E: ${[...entities.all()].length}, SD: ${settings.simulationDistance ?? 12}`,
      "l:4": `P: ${info.render.calls} draws, ${info.render.triangles} tris`,
      "l:5": `minecraft:${dim} FC: 0`,
      "l:6": "",
      "l:7": `XYZ: ${r2(pos.x)} / ${pos.y.toFixed(5)} / ${r2(pos.z)}`,
      "l:8": `Block: ${bx} ${by} ${bz} [${bx & 15} ${by & 15} ${bz & 15}]`,
      "l:9": `Chunk: ${cx} ${by >> 4} ${cz} [${cx & 31} ${cz & 31} in r.${cx >> 5}.${cz >> 5}.mca]`,
      "l:10": `Facing: ${FACING[f]} (${yawDeg.toFixed(1)} / ${((-player.pitch * 180) / Math.PI).toFixed(1)})`,
      "l:11": `Client Light: ${Math.max(sky, blk)} (${sky} sky, ${blk} block)`,
      "l:12": `Biome: minecraft:${biome.name}`,
      "l:13": `Local Difficulty: ${local.toFixed(2)} // ${clamped.toFixed(2)} (Day ${time.day})`,
      "r:0": `Browser: ${navigator.userAgent.includes("Firefox") ? "Firefox" : navigator.userAgent.includes("Chrome") ? "Chrome" : "WebKit"} 64bit`,
      "r:1": mem ? `Mem: ${Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)}% ${Math.round(mem.usedJSHeapSize / MB)}/${Math.round(mem.jsHeapSizeLimit / MB)}MB` : "Mem: n/a",
      "r:2": mem ? `Allocated: ${Math.round((mem.totalJSHeapSize / mem.jsHeapSizeLimit) * 100)}% ${Math.round(mem.totalJSHeapSize / MB)}MB` : "",
      "r:3": "",
      "r:4": `CPU: ${navigator.hardwareConcurrency || 1}x`,
      "r:5": "",
      "r:6": `Display: ${canvas.width}x${canvas.height} (WebGL)`,
      "r:7": gpuName(),
      "r:8": "WebGL 2.0",
    };
    const rs = renderer.stats?.();
    const ms = (v: number) => v.toFixed(2);
    out["r:9"] = "";
    out["r:10"] = `Frame: ${ms(prof.frame)} ms avg, ${ms(prof.worst)} ms worst`;
    out["r:11"] = `Tick: ${ms(prof.tick)} ms (${prof.ticks.toFixed(1)}/frame) Entities: ${ms(prof.entities)} ms`;
    out["r:12"] = `World: ${ms(prof.world)} ms Render: ${ms(prof.render)} ms`;
    if (rs) {
      out["r:13"] = `Sky: ${ms(rs.atmosphere)} Upload: ${ms(rs.upload)} Draw: ${ms(rs.draw)} ms`;
      out["r:14"] = `Sections: ${rs.visible}/${rs.sections} visible, ${rs.pages} pages ${Math.round((rs.verts / 1e6) * 10) / 10}M verts`;
      out["r:15"] = `Mesh: ${rs.queued} queued, ${rs.inFlight} in ${rs.workers} workers, ${rs.results} to upload`;
    }
    if (t) {
      const def = blockDef(t.state);
      out["r:16"] = "";
      out["r:17"] = `§nTargeted Block: ${t.x}, ${t.y}, ${t.z}`;
      out["r:18"] = `minecraft:${def.name}`;
      (def.tags ?? []).slice(0, 6).forEach((tag, i) => (out[`r:${19 + i}`] = `#minecraft:${tag}`));
    }
    return out;
  }


  async function save() {
    try {
      meta.lastPlayed = Date.now();
      meta.dayTime = time.dayTime;
      meta.tick = time.tick;
      meta.rain = time.rain;
      meta.thunder = time.thunder;
      meta.dim = dim;
      meta.player = player.save();
      meta.inventory = inventory.save();
      meta.spawn = { ...player.spawn };
      meta.hostile = hostile.save();
      meta.systems = systems.save();
      meta.gameMode = player.gameMode;
      await Promise.all([world.save(), saveEntities(meta.id, dim, entities.save()), saveMeta(meta)]);
    } catch (err) {
      console.warn("save failed", err);
    }
  }

  const onResize = () => renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", onResize);
  setPhase("loading", 0);
  raf = requestAnimationFrame(frame);

  const handle = {
    ctx,
    systems,
    audio,
    input,
    get phase() {
      return phase;
    },
    get fps() {
      return fps;
    },
    setSettings(s: Settings) {
      settings = s;
      applySettings();
    },
    setDebug(on: boolean) {
      debugOn = on;
    },
    setPaused(p: boolean) {
      paused = p;
      if (p) input.enabled = false;
      else resume();
    },
    setInputBlocked(b: boolean) {
      if (b) input.enabled = false;
      else resume();
    },
    lock() {
      input.requestLock();
    },
    command(line: string): string[] {
      return runCommand(ctx, line);
    },
    clickSlot: (i: number, c: Parameters<typeof inventory.clickSlot>[1]) => inventory.clickSlot(i, c),
    closeContainer() {
      inventory.close();
      if (containerOpen) route({ type: "close_container" });
    },
    respawn() {
      const r = systems.respawn();
      if (r) {
        player.respawn();
        if (r.dim !== dim) {
          changeDim({ type: "change_dim", dim: r.dim, x: r.x, y: r.y, z: r.z });
          arrival = "saved";
          target = { x: r.x, y: r.y, z: r.z };
          return;
        }
        player.teleport(r.x, r.y, r.z);
        resume();
        return;
      }
      if (dim !== "overworld") {
        player.respawn();
        changeDim({ type: "change_dim", dim: "overworld", x: player.spawn.x, y: player.spawn.y, z: player.spawn.z });
        arrival = "saved";
        target = { x: player.spawn.x + 0.5, y: player.spawn.y, z: player.spawn.z + 0.5 };
        return;
      }
      const sp = player.spawn as BedSpawn;
      if (sp.bed && !bedStandSpot(ctx, Math.floor(sp.x), Math.floor(sp.y), Math.floor(sp.z))) {
        ui.chat("You have no home bed or charged respawn anchor, or it was obstructed");
        const ws = findSpawn(meta.seed);
        const [wx, wy, wz] = safeSpot(ws.x, ws.z);
        player.spawn = { x: wx, y: wy, z: wz };
      }
      player.respawn();
      resume();
    },
    save,
    async quit() {
      meta.icon = worldIcon() ?? meta.icon;
      await save();
      handle.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      offAction();
      player.dispose();
      inventory.dispose();
      hostile.dispose();
      disposeStage();
      systems.dispose();
      touch?.dispose();
      input.dispose();
      if (ownAudio) audio.dispose();
      else audio.setMusic("menu");
      if (typeof window !== "undefined") delete (window as { __mc?: unknown }).__mc;
    },
  };

  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __mc: unknown }).__mc = {
      ctx,
      systems,
      game: handle,
      meta,
      tp: (x: number, y: number, z: number) => player.teleport(x, y, z),
      time: (t: number) => {
        time.dayTime = ((t % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
      },
      look: (yawDeg: number, pitchDeg: number) => {
        player.yaw = (yawDeg * Math.PI) / 180;
        player.pitch = (pitchDeg * Math.PI) / 180;
      },
      cmd: (line: string) => runCommand(ctx, line),
      block: (x: number, y: number, z: number) => blockDef(world.getBlock(x, y, z)).name,
      fps: () => fps,
      caveCull: CAVE_CULL,
      prof: () => ({ fps, ...prof, ...renderer.stats?.(), calls: renderer.renderer.info.render.calls, tris: renderer.renderer.info.render.triangles, loaded: world.loadedChunks(), pending: world.pendingChunks() }),
    };
  }

  return handle;
}

export type GameHandle = ReturnType<typeof startGame>;
