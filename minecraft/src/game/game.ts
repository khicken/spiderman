import type { ContainerView, Dim, EntityApi, GameCtx, GameEvent, HudState, Quality, RendererApi } from "./contracts";
import { AIR, DAY_TICKS, MIN_Y, SET_NOTIFY, idOf, stateOf } from "./contracts";
import { BLOCKS, OPAQUE, SOLID, blockDef, blockId } from "./blocks/registry";
import { itemDef } from "./items/registry";
import { createAudio, type GameAudio } from "./audio";
import { createEntities } from "./entities";
import { createHostileWorld } from "./entities/hostile";
import { createInventory } from "./items";
import { BEHAVIORS } from "./mechanics";
import { createInput, createPlayer } from "./player";
import { createRenderer } from "./render";
import { runCommand } from "./ui/commands";
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
  hurt(): void;
  died(message: string): void;
  action(a: string): void; // input actions the page handles: pause, chat, command, debug, hide_gui
}

export interface GameOptions {
  meta: WorldMeta;
  settings: Settings;
  ui: GameUi;
  audio?: GameAudio;
}

type Meta = WorldMeta & { hostile?: unknown };

const TICK = 1 / 20;
const MAX_TICKS = 4;
const AUTOSAVE_MS = 30000;
const FURNACE_LIKE = new Set(["furnace", "lit_furnace", "blast_furnace", "lit_blast_furnace", "smoker", "lit_smoker", "brewing_stand", "hopper"]);
const FACING = ["north (Towards negative Z)", "east (Towards positive X)", "south (Towards positive Z)", "west (Towards negative X)"];
const r2 = (v: number) => v.toFixed(3);

export function startGame(canvas: HTMLCanvasElement, opts: GameOptions) {
  const meta = opts.meta as Meta;
  const ui = opts.ui;
  let settings = opts.settings;
  const ownAudio = !opts.audio;
  const audio = opts.audio ?? createAudio();
  const input = createInput(canvas);
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
  }

  function disposeStage() {
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
    switch (e.type) {
      case "sound":
        audio.play(e.name, e.x, e.y, e.z, e.volume, e.pitch);
        return;
      case "particles":
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
      case "advancement":
        ui.chat(`Player has made the advancement §a[${e.title}]`);
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
    const quality: Quality = settings.graphics === "fancy" ? "high" : "medium";
    renderer.setOptions({ fov: settings.fov, quality, clouds: settings.clouds, brightness: settings.brightness });
    renderer.setRenderDistance(settings.renderDistance);
    audio.setVolume(settings.master, settings.music, settings.sound);
    if (ctx.player) {
      const p = ctx.player as ReturnType<typeof createPlayer>;
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
  let hudAt = 0;
  let saveAt = last + AUTOSAVE_MS;
  let lastView = -1;
  let dark = false;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    frames++;
    if (now - fpsAt >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
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
        if (queued.length) {
          const e = queued.shift()!;
          queued.length = 0;
          changeDim(e as Extract<GameEvent, { type: "change_dim" }>);
          return;
        }
      }
      const pt = paused ? 1 : acc / TICK;
      player.frame(dt, pt);
      entities.frame(dt, pt);
      world.update(player.body.pos.x, player.body.pos.z, settings.renderDistance);
      renderer.setTime(time.day * DAY_TICKS + time.dayTime);
      renderer.setWeather(time.rain, time.thunder);
      renderer.render(dt);
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

  function hudState(): HudState {
    const inv = inventory;
    const held = inv.held();
    const p = player as typeof player & { frozenTicks?: number };
    const bossBars: HudState["bossBars"] = [];
    for (const e of entities.all()) {
      const b = e.data.bossbar as HudState["bossBars"][number] | undefined;
      if (b && !e.dead) bossBars.push(b);
    }
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
      heldName: held ? held.name ?? itemDef(held.item)?.displayName ?? held.item : undefined,
      underwater: player.air < 300,
      dead: player.dead,
      sleeping: player.sleeping ? 1 : 0,
    };
    if (debugOn) h.debug = debugLines();
    return h;
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
    const out: Record<string, string> = {
      "l:0": "Minecraft 1.21 (vanilla)",
      "l:1": `${fps} fps T: ${settings.renderDistance} chunks`,
      "l:2": `C: ${world.loadedChunks()} loaded, ${world.pendingChunks()} pending, ${renderer.meshQueue()} mesh queue`,
      "l:3": `E: ${[...entities.all()].length}, draws ${info.render.calls}, tris ${info.render.triangles}`,
      "l:4": `Dimension: minecraft:${dim}`,
      "l:5": "",
      "l:6": `XYZ: ${r2(pos.x)} / ${pos.y.toFixed(5)} / ${r2(pos.z)}`,
      "l:7": `Block: ${bx} ${by} ${bz}`,
      "l:8": `Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      "l:9": `Facing: ${FACING[f]} (${yawDeg.toFixed(1)} / ${((-player.pitch * 180) / Math.PI).toFixed(1)})`,
      "l:10": `Client Light: ${Math.max(world.getSkyLight(bx, by + 1, bz), world.getBlockLight(bx, by + 1, bz))} (${world.getSkyLight(bx, by + 1, bz)} sky, ${world.getBlockLight(bx, by + 1, bz)} block)`,
      "l:11": `Biome: minecraft:${biome.name}`,
      "l:12": `Local Difficulty: ${meta.rules.difficulty} (Day ${time.day})`,
      "l:13": `Time: ${time.dayTime}`,
      "r:0": `Display: ${canvas.width}x${canvas.height}`,
    };
    if (t) {
      out["r:2"] = "";
      out["r:3"] = `Targeted Block: ${t.x}, ${t.y}, ${t.z}`;
      out["r:4"] = `minecraft:${blockDef(t.state).name}`;
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
      if (dim !== "overworld") {
        player.respawn();
        changeDim({ type: "change_dim", dim: "overworld", x: player.spawn.x, y: player.spawn.y, z: player.spawn.z });
        arrival = "saved";
        target = { x: player.spawn.x + 0.5, y: player.spawn.y, z: player.spawn.z + 0.5 };
        return;
      }
      player.respawn();
      resume();
    },
    save,
    async quit() {
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
      input.dispose();
      if (ownAudio) audio.dispose();
      else audio.setMusic("menu");
      if (typeof window !== "undefined") delete (window as { __mc?: unknown }).__mc;
    },
  };

  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __mc: unknown }).__mc = {
      ctx,
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
    };
  }

  return handle;
}

export type GameHandle = ReturnType<typeof startGame>;
