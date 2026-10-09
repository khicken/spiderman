import * as THREE from "three";
import { createDriver, type DriverPlus } from "./ai";
import { createAudio } from "./audio";
import { createCameraRig } from "./camera";
import { createCarModel } from "./car-model";
import { CARS } from "./cars";
import type {
  Audio, CameraRig, CarId, CarModel, CarSpec, Controls, Entrant, EngineVoice, GameEvent, HudState, MapData, MapId, Mode,
  Quality, Scenery, Track, TrackMesh, VehicleSnap, Weather,
} from "./contracts";
import { createFx } from "./fx";
import { createInput } from "./input";
import { MAPS } from "./maps";
import type { NetPlus } from "./net";
import { createRace, type RacePlus } from "./race";
import { createGhost, type Ghost } from "./race-ghost";
import { createRender } from "./render";
import { createScenery } from "./scenery";
import { createTrack } from "./track";
import { createTrackMesh } from "./track-mesh";
import type { MiniCar } from "./ui-hud";
import type { Settings } from "./ui-settings";
import { collideCars, createVehicle, setWet, type VehicleBody } from "./vehicle";

const DT = 1 / 120;
const REWIND_HZ = 30;
const REWIND_S = 10;
const AI_COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff375f", "#30d158", "#5e5ce6", "#ffd60a"];
const AI_NAMES = ["Rossi", "Kato", "Moreau", "Lindqvist", "Okafor", "Silva", "Brandt", "Nakamura", "Vidal", "Petrov", "Hale"];
const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 1, shiftUp: false, shiftDown: false };

export type Session = { map: MapId; mode: Mode; laps: number; car: CarId; paint: string; ai: number; net?: NetPlus; startAt?: number };
export type GameCallbacks = {
  hud(h: HudState): void;
  hudRef(): { needle(rpm: number): void; minimap(cars: readonly MiniCar[]): void; event(e: GameEvent): void } | null;
  progress(p: number): void;
  pause(): void;
  finished(): void;
};

type Racer = {
  e: Entrant;
  v: VehicleBody;
  m: CarModel;
  ai: DriverPlus | null;
  voice: EngineVoice | null;
  remote: boolean;
  c: Controls;
};

const spec = (id: CarId) => CARS.find((c) => c.id === id) ?? CARS[0];
const v3 = new THREE.Vector3();
const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const dir = new THREE.Vector3();

export function startGame(canvas: HTMLCanvasElement, cb: GameCallbacks, settings: Settings) {
  const view = createRender(canvas);
  const fx = createFx(view.scene);
  const input = createInput(canvas);
  let cur: Settings = { ...settings, assists: { ...settings.assists } };
  view.setQuality(cur.quality);

  let map: MapData | null = null;
  let track: Track | null = null;
  let mesh: TrackMesh | null = null;
  let scenery: Scenery | null = null;
  let rig: CameraRig | null = null;
  let loading: Promise<void> | null = null;
  let loadedId: MapId | null = null;

  let racers: Racer[] = [];
  let me: Racer | null = null;
  let race: RacePlus | null = null;
  let ghost: Ghost | null = null;
  let ghostModel: CarModel | null = null;
  let session: Session | null = null;
  let net: NetPlus | null = null;
  let audio: Audio | null = null;
  let state: "menu" | "race" | "paused" | "results" = "menu";
  let envOverride: { weather?: Weather; hour?: number } = {};

  const rewind: VehicleSnap[][] = [];
  let rewindAcc = 0;
  let rewinding = false;
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let hudAcc = 0;
  let netAcc = 0;
  let t = 0;
  let wasNight = -1;
  let finishedSent = false;
  const snapScratch = new Float32Array(64);
  const mini: MiniCar[] = [];

  async function loadMap(id: MapId) {
    if (loadedId === id && track) return;
    cb.progress(0);
    const info = MAPS.find((m) => m.id === id) ?? MAPS[0];
    const data = await info.load();
    await tick();
    cb.progress(0.2);
    clearRacers();
    mesh?.dispose();
    scenery?.dispose();
    if (mesh) view.scene.remove(mesh.group);
    if (scenery) view.scene.remove(scenery.group);
    fx.clear();
    map = data;
    track = createTrack(data);
    cb.progress(0.35);
    await tick();
    mesh = createTrackMesh(track, cur.quality);
    view.scene.add(mesh.group);
    cb.progress(0.65);
    await tick();
    scenery = createScenery(track, cur.quality);
    view.scene.add(scenery.group);
    cb.progress(0.9);
    rig = createCameraRig(view.camera, track);
    rig.mode = cur.camera;
    applyEnv();
    loadedId = id;
    wasNight = -1;
    await tick();
    cb.progress(1);
  }

  function applyEnv() {
    if (!map) return;
    view.setEnv({
      hour: envOverride.hour ?? map.env.hour,
      weather: envOverride.weather ?? map.env.weather,
      season: map.env.season,
      lat: map.origin[0],
    });
    mesh?.setWet(view.wet);
    setWet(view.wet);
    audio?.ambience(map.id, envOverride.weather ?? map.env.weather, view.night);
  }

  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  function clearRacers() {
    for (const r of racers) {
      view.scene.remove(r.m.group);
      r.m.dispose();
      r.voice?.dispose();
    }
    racers = [];
    me = null;
    if (ghostModel) {
      view.scene.remove(ghostModel.group);
      ghostModel.dispose();
      ghostModel = null;
    }
    ghost = null;
    race = null;
    rewind.length = 0;
  }

  function addRacer(e: Entrant, slot: number, remote: boolean, skill = 0) {
    if (!track) throw new Error("no track");
    const s = spec(e.car);
    const v = createVehicle(s, track, racers.length);
    v.assists = e.me ? { ...cur.assists } : { abs: true, tcs: true, stability: true, autoGear: true, steer: false };
    const g = track.grid[Math.min(slot, track.grid.length - 1)];
    v.place(g.pos, g.yaw, g.s);
    const m = createCarModel(s, e.color, cur.quality, e.me);
    m.setEnv(view.envMap);
    view.scene.add(m.group);
    const r: Racer = { e, v, m, ai: e.ai ? createDriver(track, v, skill) : null, voice: audio ? audio.engine(s, e.me) : null, remote, c: { ...IDLE } };
    racers.push(r);
    if (e.me) me = r;
    return r;
  }

  async function showroom(mapId: MapId, car: CarId, paint: string) {
    state = "menu";
    session = null;
    net = null;
    envOverride = {};
    await loadMap(mapId);
    clearRacers();
    addRacer({ id: "me", name: "You", color: paint, car, me: true, ai: false }, 0, false);
    rig?.cut();
    audio?.music("menu", mapId);
  }

  function setCar(car: CarId, paint: string) {
    if (state !== "menu" || !track) return;
    if (me && me.e.car === car) {
      me.m.setPaint(paint);
      me.e.color = paint;
      return;
    }
    clearRacers();
    addRacer({ id: "me", name: "You", color: paint, car, me: true, ai: false }, 0, false);
  }

  async function play(s: Session) {
    session = s;
    net = s.net ?? null;
    if (net?.lobby) envOverride = { weather: net.lobby.weather === "map" ? undefined : net.lobby.weather, hour: net.lobby.hour === "map" ? undefined : net.lobby.hour };
    else envOverride = {};
    await loadMap(s.map);
    applyEnv();
    clearRacers();
    const entrants: Entrant[] = [];
    if (net) {
      const peers = [...net.peers].sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const p of peers) entrants.push(p.me ? { ...p, car: s.car, color: s.paint } : p);
    } else {
      entrants.push({ id: "me", name: "You", color: s.paint, car: s.car, me: true, ai: false });
      const n = s.mode === "race" ? s.ai : 0;
      const pool = CARS.filter((c) => c.klass === spec(s.car).klass);
      for (let i = 0; i < n; i++) {
        const c = (pool.length > 1 ? pool : CARS)[(i + 1) % (pool.length > 1 ? pool.length : CARS.length)];
        entrants.push({ id: `ai${i}`, name: AI_NAMES[i % AI_NAMES.length], color: AI_COLORS[i % AI_COLORS.length], car: c.id, me: false, ai: true });
      }
    }
    // Solo: the player starts at the back like Forza. Online: grid order by id, same on every client.
    const order = net ? entrants : [...entrants.slice(1), entrants[0]];
    order.forEach((e, i) => addRacer(e, i, !!net && !e.me, 0.86 + 0.12 * (i / Math.max(1, order.length - 1))));
    const myId = me?.e.id ?? "me";
    race = createRace(track!, s.mode, s.laps, racers.map((r) => r.e.id), myId);
    if (s.mode === "time" || s.mode === "free") {
      ghost = createGhost(s.map, s.car);
      ghostModel = createCarModel(spec(s.car), "#9fd8ff", "low");
      ghostModel.group.visible = false;
      ghostModel.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const x of m ? (Array.isArray(m) ? m : [m]) : []) {
          x.transparent = true;
          x.opacity = 0.35;
          x.depthWrite = false;
        }
      });
      view.scene.add(ghostModel.group);
    }
    const startAt = s.startAt != null && net ? s.startAt - net.clockOffset : performance.now() + (s.mode === "free" ? 0 : 3500);
    race.start(startAt);
    finishedSent = false;
    rig?.cut();
    state = "race";
    audio?.music("race", s.map);
  }

  function restart() {
    if (session && !net) void play(session);
  }

  function pushRewind() {
    if (net || !race || race.phase !== "racing") return;
    let frame = rewind.length >= REWIND_S * REWIND_HZ ? rewind.shift()! : [];
    frame.length = racers.length;
    for (let i = 0; i < racers.length; i++) frame[i] = racers[i].v.snap(frame[i]);
    rewind.push(frame);
  }

  function popRewind() {
    const f = rewind.pop();
    if (!f) return;
    for (let i = 0; i < racers.length && i < f.length; i++) racers[i].v.load(f[i]);
    ghost?.restart();
    rig?.cut();
  }

  function route(events: readonly GameEvent[]) {
    for (const e of events) {
      if (e.type === "sfx") audio?.sfx(e.name, { volume: e.volume, at: e.at });
      else if (e.type === "impact") {
        const mine = racers[e.car] === me;
        if (e.speed > 2) fx.sparks(e.at, up.set(0, 1, 0), Math.min(1, e.speed / 20));
        audio?.sfx("impact", { volume: Math.min(1, e.speed / 18), at: mine ? undefined : e.at });
        if (mine) {
          rig?.shake(Math.min(1, e.speed / 15));
          input.rumble(Math.min(1, e.speed / 15), 0.5, 180);
        }
      } else if (e.type === "scrape") {
        fx.sparks(e.at, e.dir, e.amount);
        if (racers[e.car] === me && Math.random() < 0.3) audio?.sfx("scrape", { volume: Math.min(1, e.amount) });
      } else if (e.type === "shake") rig?.shake(e.strength);
      else if (e.type === "shift") {
        if (racers[e.car] === me) audio?.sfx("shift", { volume: 0.6 });
      } else if (e.type === "backfire") {
        const b = racers[e.car];
        if (!b) continue;
        const st = b.v.state;
        fwd.set(0, 0, 1).applyQuaternion(st.quat);
        v3.copy(st.pos).addScaledVector(fwd, -b.v.spec.body.length / 2).setY(st.pos.y - b.v.spec.cgH + 0.35);
        fx.backfire(v3, dir.copy(fwd).negate());
        audio?.sfx("backfire", { volume: 0.7, at: b === me ? undefined : v3 });
      } else if (e.type === "toast") cb.hudRef()?.event(e);
      else if (e.type === "checkpoint" || e.type === "lap" || e.type === "finish") {
        if (e.id !== me?.e.id) continue;
        cb.hudRef()?.event(e);
        if (e.type === "lap" && ghost && me) ghost.lap(e.time, true);
        if (e.type === "finish") {
          if (net && !finishedSent) net.finish(e.time);
          finishedSent = true;
          audio?.music("results", map?.id);
          setTimeout(() => {
            if (state === "race") {
              state = "results";
              cb.finished();
            }
          }, 2500);
        }
      }
    }
  }

  const hud: HudState = {
    speed: 0, gear: "N", rpm: 0, redline: 7000, limiter: 7500, place: 1, total: 1, lap: 1, laps: 1, time: 0, last: 0, best: 0,
    delta: null, countdown: -1, wrongWay: false, phase: "grid", mode: "race", device: "keys",
  };

  function pushHud() {
    if (!me) return;
    const st = me.v.state;
    const sp = me.v.spec;
    const kmh = Math.abs(st.speed) * 3.6;
    hud.speed = Math.round(cur.units === "mph" ? kmh * 0.621371 : kmh);
    hud.gear = st.gear < 0 ? "R" : st.gear === 0 ? "N" : String(st.gear);
    hud.rpm = st.rpm;
    hud.redline = sp.engine.redline;
    hud.limiter = sp.engine.limiter;
    hud.device = input.device;
    if (race) {
      const all = race.standings();
      const mine = all.find((x) => x.id === me!.e.id);
      hud.place = mine?.place ?? 1;
      hud.total = all.length;
      hud.lap = Math.min((mine?.lap ?? 0) + 1, session && track!.closed ? (session.mode === "free" ? 999 : session.laps) : 1);
      hud.laps = !track!.closed ? 1 : session?.mode === "free" ? 0 : session?.laps ?? 1;
      hud.time = race.phase === "racing" || race.phase === "done" ? race.clock - race.lapStart(me.e.id) : 0;
      hud.last = race.lastLap(me.e.id);
      hud.best = mine?.best ?? 0;
      hud.countdown = race.countdown;
      hud.wrongWay = race.wrongWay(me.e.id);
      hud.phase = race.phase;
      hud.mode = session?.mode ?? "race";
      if (ghost?.best && race.phase === "racing") {
        const ratio = Math.max(0, me.v.state.s) / track!.length;
        hud.delta = ratio > 0.02 ? hud.time - ghost.best * ratio : null;
      } else hud.delta = null;
    } else {
      hud.phase = "grid";
      hud.countdown = -1;
    }
    cb.hud({ ...hud });
  }

  const states = new Map<string, import("./contracts").VehicleState>();

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    t += dt;
    if (!track || !rig) {
      view.render();
      return;
    }

    if (input.pressed("pause") && (state === "race" || state === "paused")) cb.pause();
    if (state === "race" && me) {
      if (input.pressed("camera")) rig.cycle();
      if (input.pressed("reset")) {
        me.v.resetToTrack();
        ghost?.restart();
        rig.cut();
      }
      if (input.pressed("horn")) audio?.sfx("horn");
      const hold = input.held("rewind") && !net && race?.phase === "racing";
      if (hold && !rewinding) audio?.sfx("rewind");
      rewinding = hold;
    }

    const live = state === "race" || state === "results" || state === "menu";
    const racing = race?.phase === "racing" || race?.phase === "done";
    if (me && state !== "paused") {
      const c = input.read(dt, me.v.state.speed);
      if (state === "race" && racing && race?.phase !== "done") me.c = c;
      else if (state === "race") me.c = { ...c, handbrake: 1, brake: 0, shiftUp: false, shiftDown: false };
      else me.c = state === "results" ? { ...IDLE, handbrake: 0, brake: 0.6 } : IDLE;
    }

    if (live && state !== "paused") {
      if (rewinding) {
        rewindAcc += dt;
        while (rewindAcc >= 1 / (REWIND_HZ * 2)) {
          popRewind();
          rewindAcc -= 1 / (REWIND_HZ * 2);
        }
      } else {
        for (const r of racers) {
          if (r.ai) {
            if (racing) r.c = r.ai.drive(dt, others());
            else r.c = IDLE;
          }
        }
        acc += dt;
        let steps = 0;
        while (acc >= DT && steps < 8) {
          for (const r of racers) {
            if (r.remote) continue;
            route(r.v.step(DT, r.c));
            r.c.shiftUp = false;
            r.c.shiftDown = false;
          }
          if (racers.length > 1) route(collideCars(racers.map((r) => r.v)));
          acc -= DT;
          steps++;
        }
        if (steps === 8) acc = 0;
        if (state === "race") {
          rewindAcc += dt;
          while (rewindAcc >= 1 / REWIND_HZ) {
            pushRewind();
            rewindAcc -= 1 / REWIND_HZ;
          }
        }
      }
    }

    if (net) {
      for (const r of racers) {
        if (!r.remote) continue;
        const own = r.v.snap(snapScratch);
        if (net.remote(r.e.id, now, own)) {
          r.v.load(own);
          r.m.group.visible = true;
        }
      }
      netAcc += dt;
      if (me && netAcc >= 1 / 30) {
        netAcc = 0;
        net.sendCar(me.v.snap(snapScratch), me.c);
      }
    }

    if (race && state !== "menu") {
      states.clear();
      for (const r of racers) states.set(r.e.id, r.v.state);
      const ev = race.update(now, states);
      route(ev);
      if (racing && me) {
        const all = race.standings();
        const mine = all.find((x) => x.id === me!.e.id);
        for (const r of racers) {
          if (!r.ai) continue;
          const st = all.find((x) => x.id === r.e.id);
          if (st && mine) r.ai.band(st.gap - mine.gap);
        }
      }
      if (ghost && me && race.phase === "racing") {
        const lt = race.clock - race.lapStart(me.e.id);
        ghost.record(lt, me.v.state.pos, me.v.state.quat);
        if (ghostModel) ghostModel.group.visible = ghost.ready && ghost.pose(lt, ghostModel.group.position, ghostModel.group.quaternion);
      }
    }

    const wet = view.wet;
    const night = view.night;
    if (Math.abs(night - wasNight) > 0.02) {
      scenery?.setNight(night);
      wasNight = night;
    }
    for (let i = 0; i < racers.length; i++) {
      const r = racers[i];
      const st = r.v.state;
      r.m.sync(st, dt);
      r.m.setLights(night > 0.4 || st.tunnel || (envOverride.weather ?? map?.env.weather) === "fog");
      for (let w = 0; w < 4; w++) {
        const wh = st.wheels[w];
        if (wh.contact && (wh.skid > 0.05 || wet > 0.2 || wh.surface !== "asphalt")) fx.tire(i, w, wh.pos, st.vel, wh.skid, wh.surface, wet);
      }
      if (r.voice) {
        let skid = 0;
        for (const wh of st.wheels) skid = Math.max(skid, wh.contact ? wh.skid : 0);
        r.voice.update({
          rpm: st.rpm, throttle: st.throttle, load: st.throttle > 0.05 ? st.throttle : -0.6, gear: st.gear, boost: st.boost,
          speed: st.speed, limiter: st.limiter, skid, surface: st.wheels[2].surface, pos: st.pos, tunnel: st.tunnel,
        });
      }
    }

    if (me) {
      const st = me.v.state;
      if (state === "menu") rig.showroom(dt, st.pos, t);
      else rig.update(dt, st, me.v.spec, input.look(), input.held("lookBack"));
      view.frame(dt, st.pos, state === "menu" ? 0 : Math.abs(st.speed));
    }
    if (audio) {
      fwd.set(0, 0, -1).applyQuaternion(view.camera.quaternion);
      up.set(0, 1, 0).applyQuaternion(view.camera.quaternion);
      audio.listener(view.camera.position, fwd, up);
    }
    scenery?.update(dt, view.camera);
    fx.update(dt, view.camera);
    view.render();

    if (state === "race" && me) {
      const h = cb.hudRef();
      if (h) {
        h.needle(me.v.state.rpm);
        mini.length = racers.length;
        for (let i = 0; i < racers.length; i++) {
          const st = racers[i].v.state;
          fwd.set(0, 0, 1).applyQuaternion(st.quat);
          const m = (mini[i] ??= { x: 0, z: 0, yaw: 0, color: "", me: false });
          m.x = st.pos.x;
          m.z = st.pos.z;
          m.yaw = Math.atan2(fwd.x, fwd.z);
          m.color = racers[i].e.color;
          m.me = racers[i] === me;
        }
        h.minimap(mini);
      }
      hudAcc += dt;
      if (hudAcc > 0.1) {
        hudAcc = 0;
        pushHud();
      }
    }
  }

  const otherStates: import("./contracts").VehicleState[] = [];
  function others() {
    otherStates.length = racers.length;
    for (let i = 0; i < racers.length; i++) otherStates[i] = racers[i].v.state;
    return otherStates;
  }

  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);
  view.resize();
  frame();

  const api = {
    showroom,
    setCar,
    play,
    restart,
    loadMap,
    get state() {
      return state;
    },
    get outline() {
      return track?.outline;
    },
    get track() {
      return track;
    },
    get map() {
      return map;
    },
    standings() {
      return race?.standings() ?? [];
    },
    entrants(): Entrant[] {
      return racers.map((r) => r.e);
    },
    pause(on: boolean) {
      if (state === "race" && on) state = "paused";
      else if (state === "paused" && !on) {
        state = "race";
        last = performance.now();
      }
      audio?.setMuted(on);
      if (!on) audio?.setVolume(cur.master, cur.music);
    },
    // Browsers block audio until a gesture, so the page calls this on the first click.
    audioOn() {
      if (audio) return;
      try {
        audio = createAudio();
        audio.setVolume(cur.master, cur.music);
        for (const r of racers) r.voice ??= audio.engine(r.v.spec, r.e.me);
        audio.music(state === "menu" ? "menu" : "race", map?.id);
        if (map) audio.ambience(map.id, envOverride.weather ?? map.env.weather, view.night);
      } catch (e) {
        console.warn("audio:", e);
      }
    },
    music(s: "menu" | "race" | "results") {
      audio?.music(s, map?.id);
    },
    sfx(name: "click" | "hover" | "join" | "leave") {
      audio?.sfx(name);
    },
    touch(tc: Parameters<typeof input.setTouch>[0]) {
      input.setTouch(tc);
    },
    setSettings(s: Settings) {
      const q = s.quality !== cur.quality;
      cur = { ...s, assists: { ...s.assists } };
      if (q) setQuality(s.quality);
      if (me) me.v.assists = { ...cur.assists };
      if (rig) rig.mode = cur.camera;
      audio?.setVolume(cur.master, cur.music);
    },
    quit() {
      clearRacers();
      net?.leave();
      net = null;
      session = null;
      state = "menu";
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      clearRacers();
      mesh?.dispose();
      scenery?.dispose();
      fx.dispose();
      input.dispose();
      audio?.dispose();
      view.dispose();
    },
  };

  function setQuality(q: Quality) {
    view.setQuality(q);
    mesh?.setQuality(q);
    scenery?.setQuality(q);
    fx.setQuality(q);
    for (const r of racers) {
      r.m.setQuality(q);
      r.m.setEnv(view.envMap);
    }
  }

  if (process.env.NODE_ENV !== "production") (window as unknown as { __cars: unknown }).__cars = { api, view, get racers() { return racers; }, get race() { return race; }, input };
  return api;
}

export type Game = ReturnType<typeof startGame>;
export type { CarSpec };
