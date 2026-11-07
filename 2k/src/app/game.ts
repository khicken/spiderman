import * as THREE from "three";
import { createAI } from "./ai";
import { createArena } from "./arena";
import { createAudio } from "./audio";
import { createCamera } from "./camera";
import type {
  AI, Arena, Audio, FinalReport, Game, GameCallbacks, GameEvent, HudSnapshot, Indicators, MatchSetup, MeterView,
  PlayerData, ScreenPoint, ScreenTag, Settings, Sim, StatLine, TeamData, TeamSide,
} from "./contracts";
import { HUD_HZ, MAX_FRAME_DT, SIM_DT } from "./contracts";
import { ALL_TEAMS } from "./data";
import { createFx } from "./fx";
import { createInput } from "./input";
import { createMockSim } from "./mock";
import { createPlayers } from "./players";
import { createRender } from "./render";
import { createSim } from "./sim";
import { emptyHud, hudPlayer, newStatLine, periodLabel } from "./state";

// The one requestAnimationFrame loop. Owns module lifetimes and routes events. Owner: lead / integrator.
// Menu: a mock sim keeps players warming up behind the menus while the camera orbits.
// Match: input -> sim.control -> (ai.update, sim.step) x N fixed steps -> modules handle events -> render -> HUD.

const MAX_STEPS = 8;
const PAD_GLYPHS = ["A", "B", "X", "Y"];
const KEY_GLYPHS = ["1", "2", "3", "4"];

type Mode = "menu" | "match" | "ended";

export function startGame(canvas: HTMLCanvasElement, cb: GameCallbacks, settings: Settings): Game {
  let cur: Settings = { ...settings };
  const render = createRender(canvas, cur.quality);
  const input = createInput(canvas);
  input.setVibration(cur.vibration);
  const rig = createCamera(render.camera);
  rig.setMode(cur.camera);
  rig.setReplays?.(cur.replays ?? true);
  const players = createPlayers(render.scene, cur.quality);
  players.setEnv(render.envMap);
  const fx = createFx(render.scene, cur.quality);
  let audio: Audio | null = null;
  let arena: Arena | null = null;

  let mode: Mode = "menu";
  let paused = false;
  let sim: Sim | null = null;
  let ai: AI | null = null;
  let setup: MatchSetup | null = null;
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let t = 0;
  let acc = 0;
  let hudAcc = 0;
  let endTimer = -1;

  const frameEvents: GameEvent[] = [];
  const aiEvents: GameEvent[] = [];
  const mates: number[] = [];
  const v3 = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, on: false };
  const meter: MeterView = { on: false, x: 0, y: 0, fill: 0, target: 0, window: 0, grade: "none", fade: 0 };
  const tags: ScreenTag[] = Array.from({ length: 5 }, () => ({ on: false, x: 0, y: 0, text: "", kind: "name" as const, color: "#fff" }));
  const ind: Indicators = { user: -1, userColor: "#ffffff", passTarget: -1, icons: false, shotTarget: 0, mark: -1 };
  let hud: HudSnapshot | null = null;

  function dressFor(home: TeamData, away: TeamData) {
    if (!arena) arena = createArena(render, home, away, cur.quality);
    else arena.setTeams(home, away);
    players.setTeams(home, away);
  }

  function dropMatch() {
    ai?.dispose();
    sim?.dispose();
    ai = null;
    sim = null;
    fx.clear();
    frameEvents.length = aiEvents.length = 0;
    acc = 0;
    endTimer = -1;
  }

  function menuSetup(home: TeamData, away: TeamData): MatchSetup {
    return { home, away, userTeam: -1, mode: "exhibition", settings: cur };
  }

  function route(events: readonly GameEvent[]) {
    if (!sim || events.length === 0) return;
    rig.handle(events, sim);
    arena?.handle(events);
    players.handle(events);
    fx.handle(events, sim);
    audio?.handle(events, sim);
    // controller rumble: input maps every event to its own pulse (the sim's raw "rumble" events would double them)
    input.handle?.(events, sim);
    const h = cb.hudRef();
    for (const e of events) {
      if (e.type === "shake") rig.shake(e.strength);
      else if (e.type === "gameEnd" && mode === "match") endTimer = 3.5;
      h?.event(e);
    }
  }

  function overlays(frame: ReturnType<typeof input.read>) {
    const h = cb.hudRef();
    if (!sim || !h || mode === "menu") {
      ind.user = ind.passTarget = ind.mark = -1;
      ind.icons = false;
      ind.shotTarget = 0;
      if (sim) fx.indicators(sim, ind);
      return;
    }
    const us = sim.userSlot;
    const u = us >= 0 ? sim.players[us] : null;
    meter.on = false;
    if (u && (u.meter.active || u.meter.shownT < 1.2)) {
      players.headPos(us, v3);
      rig.toScreen(v3, sp);
      meter.on = sp.on;
      meter.x = sp.x + 0.035;
      meter.y = sp.y + 0.06;
      meter.fill = u.meter.fill;
      meter.target = u.meter.target;
      meter.window = u.meter.window;
      meter.grade = u.meter.grade;
      meter.fade = u.meter.active ? 1 : Math.max(0, 1 - u.meter.shownT / 1.2);
    }
    if (!cur.shotMeter && meter.grade === "none") meter.on = false;
    h.meter(meter);
    for (const tg of tags) tg.on = false;
    const offense = !!u && sim.state.possession === u.team;
    const icons = offense && frame.icon.down && !!u?.hasBall;
    if (u && cur.playerNames && !icons) {
      players.headPos(us, v3);
      rig.toScreen(v3, sp);
      const tg = tags[0];
      tg.on = sp.on;
      tg.x = sp.x;
      tg.y = sp.y;
      tg.text = u.data.last.toUpperCase();
      tg.kind = "name";
      tg.color = sim.teams[u.team].data.primary;
    }
    if (u && icons) {
      sim.mates(us, mates);
      for (let i = 0; i < 4 && i < mates.length; i++) {
        players.headPos(mates[i], v3);
        rig.toScreen(v3, sp);
        const tg = tags[i + 1];
        tg.on = sp.on;
        tg.x = sp.x;
        tg.y = sp.y;
        tg.text = (frame.device === "pad" ? PAD_GLYPHS : KEY_GLYPHS)[i];
        tg.kind = "icon";
        tg.color = "#ffffff";
      }
    }
    h.tags(tags);
    ind.user = us;
    ind.userColor = u ? sim.teams[u.team].data.primary : "#ffffff";
    ind.icons = icons;
    ind.passTarget = -1;
    ind.mark = u && !offense ? u.mark : -1;
    ind.shotTarget = u && u.meter.active ? sim.dir(u.team) : 0;
    fx.indicators(sim, ind);
  }

  function pushHud() {
    if (!sim || !setup || mode === "menu") return;
    if (!hud) hud = emptyHud(setup.home, setup.away);
    const s = sim.state;
    hud.phase = s.phase;
    hud.period = s.period;
    hud.periodLabel = periodLabel(s.period);
    hud.clock = s.clock;
    hud.shotClock = s.shotClock;
    hud.shotClockOn = s.shotClockOn;
    for (const side of [0, 1] as TeamSide[]) {
      const ht = hud.teams[side];
      ht.score = s.score[side];
      ht.timeouts = s.timeouts[side];
      ht.fouls = s.teamFouls[side];
      ht.bonus = s.bonus[side];
      const list = hud.onCourt[side];
      list.length = 5;
      for (let k = 0; k < 5; k++) {
        const p = sim.players[side * 5 + k];
        list[k] = hudPlayer(p, sim.teams[side].box[p.rosterIndex], list[k]);
      }
    }
    hud.possession = s.possession;
    hud.arrow = s.arrow;
    hud.userTeam = sim.userTeam;
    const us = sim.userSlot;
    hud.user = us >= 0 ? hud.onCourt[us < 5 ? 0 : 1][us % 5] : null;
    const ft = s.freeThrow;
    hud.freeThrow = ft ? { name: sim.players[ft.shooter].data.last, index: ft.index, total: ft.total } : null;
    hud.play = s.possession === -1 ? null : ai?.playName(s.possession as TeamSide) ?? null;
    hud.device = input.device;
    hud.camera = rig.mode;
    hud.cinematic = rig.cinematic;
    hud.replay = !!rig.replayView;
    hud.clutch = s.clutch;
    hud.fps = Math.round(render.stats().fps);
    // fresh top-level object so React sees a change; nested arrays are copied shallowly
    cb.hud({ ...hud, teams: [{ ...hud.teams[0] }, { ...hud.teams[1] }], onCourt: [hud.onCourt[0].map((p) => ({ ...p })), hud.onCourt[1].map((p) => ({ ...p }))] });
  }

  function report(): FinalReport | null {
    if (!sim || !setup) return null;
    const s = sim.state;
    const box = [sim.teams[0].box, sim.teams[1].box] as [StatLine[], StatLine[]];
    const totals = [newStatLine(), newStatLine()] as [StatLine, StatLine];
    for (const side of [0, 1] as TeamSide[])
      for (const l of box[side]) for (const k of Object.keys(l) as (keyof StatLine)[]) totals[side][k] += l[k];
    const winner: TeamSide = s.winner !== -1 ? s.winner : s.score[0] >= s.score[1] ? 0 : 1;
    let mvp = { team: winner, rosterIndex: 0 };
    let best = -1e9;
    box[winner].forEach((l, i) => {
      const gs = l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.oreb + 0.3 * l.dreb + l.stl + 0.7 * l.ast + 0.7 * l.blk - l.tov;
      if (gs > best) {
        best = gs;
        mvp = { team: winner, rosterIndex: i };
      }
    });
    return {
      home: setup.home, away: setup.away, score: [s.score[0], s.score[1]], periods: [[...s.periodScores[0]], [...s.periodScores[1]]],
      box, totals, winner, mvp, userTeam: setup.userTeam,
    };
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
    last = now;
    t += dt;

    const f = input.read(dt);
    if (mode === "match" && f.pause.pressed && !paused) cb.pause();
    if (mode === "match" && f.camera.pressed && !paused) rig.cycle();

    frameEvents.length = 0;
    const replayV = rig.replayView ?? null;
    const ts = rig.timeScale ?? 1;
    if (replayV && mode === "match" && !paused && f.any) rig.skip?.();
    if (sim && !paused && !replayV) {
      if (mode === "match") {
        rig.stickToWorld(f.move.x, f.move.y, f.moveWorld).multiplyScalar(f.move.mag);
        if (f.flick) rig.stickToWorld(f.flickDir.x, f.flickDir.y, f.flickWorld).normalize();
        else f.flickWorld.set(0, 0, 0);
        sim.control(f);
      }
      acc += dt * ts;
      let steps = 0;
      while (acc >= SIM_DT && steps < MAX_STEPS) {
        ai?.update(SIM_DT, aiEvents);
        const evs = sim.step(SIM_DT);
        aiEvents.length = 0;
        for (const e of evs) {
          aiEvents.push(e);
          frameEvents.push(e);
        }
        acc -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;
      route(frameEvents);
    }

    if (mode === "menu" || !sim) rig.menu(dt, t);
    else rig.update(dt, sim);
    if (replayV && !paused) players.update(dt * ts, replayV);
    else if (sim) players.update(dt * ts, sim);
    arena?.update(dt, mode === "menu" ? null : sim, render.camera);
    overlays(f);
    fx.update(dt, render.camera);
    audio?.update(dt, mode === "menu" ? null : sim, render.camera);
    render.setCinematic(rig.focus, rig.cinematic ? 1 : 0, rig.cinematic ? 1 : 0);
    render.render(dt);

    hudAcc += dt;
    if (hudAcc >= 1 / HUD_HZ) {
      hudAcc = 0;
      pushHud();
    }
    if (endTimer > 0) {
      endTimer -= dt;
      if (endTimer <= 0 && mode === "match") {
        mode = "ended";
        audio?.music("final");
        const r = report();
        if (r) cb.ended(r);
      }
    }
  }

  const onResize = () => render.resize();
  window.addEventListener("resize", onResize);
  raf = requestAnimationFrame(frame);

  const game: Game = {
    showcase(home: TeamData, away: TeamData, featured?: PlayerData | null) {
      if (disposed) return;
      dropMatch();
      mode = "menu";
      paused = false;
      setup = null;
      hud = null;
      dressFor(home, away);
      sim = createMockSim(menuSetup(home, away));
      players.showcase(featured ?? null, featured ? home : null);
      rig.cut();
      audio?.music("menu");
    },
    async start(s: MatchSetup) {
      if (disposed) return;
      cb.progress(0);
      dropMatch();
      setup = { ...s, settings: { ...s.settings } };
      cur = setup.settings;
      hud = null;
      dressFor(s.home, s.away);
      players.showcase(null, null);
      cb.progress(0.4);
      await new Promise((r) => setTimeout(r, 0));
      if (disposed) return;
      sim = createSim(setup);
      ai = createAI(sim, cur);
      rig.setMode(cur.camera);
      rig.setReplays?.(cur.replays ?? true);
      cb.progress(0.7);
      try {
        await render.renderer.compileAsync(render.scene, render.camera);
      } catch (e) {
        console.warn("shader warm:", e);
      }
      if (disposed) return;
      mode = "match";
      paused = false;
      sim.begin();
      rig.cue("intro");
      rig.cut();
      audio?.music("game");
      cb.progress(1);
    },
    pause(on) {
      paused = on;
      if (!on) last = performance.now();
      audio?.music(on ? "timeout" : mode === "match" ? "game" : "menu");
    },
    get paused() {
      return paused;
    },
    setSettings(s) {
      const q = s.quality !== cur.quality;
      cur = { ...s };
      if (q) {
        render.setQuality(cur.quality);
        arena?.setQuality(cur.quality);
        players.setQuality(cur.quality);
        fx.setQuality(cur.quality);
      }
      rig.setMode(cur.camera);
      rig.setReplays?.(cur.replays ?? true);
      input.setVibration(cur.vibration);
      audio?.setVolume(cur.master, cur.music, cur.crowd, cur.sfx);
      sim?.setSettings(cur);
      ai?.setSettings(cur);
    },
    restart() {
      if (setup) void game.start({ ...setup, settings: cur });
    },
    quit() {
      const s = setup;
      const home = s?.home ?? ALL_TEAMS[0];
      const away = s?.away ?? ALL_TEAMS[1] ?? ALL_TEAMS[0];
      if (home && away) game.showcase(home, away);
    },
    substitute(team, slot, rosterIndex) {
      return sim && mode === "match" ? sim.substitute(team, slot, rosterIndex) : false;
    },
    callTimeout() {
      if (!sim || !setup || setup.userTeam === -1) return false;
      return sim.callTimeout(setup.userTeam);
    },
    report,
    input,
    get audio() {
      return audio;
    },
    unlockAudio() {
      if (!audio) {
        audio = createAudio();
        audio.setVolume(cur.master, cur.music, cur.crowd, cur.sfx);
        audio.music(mode === "match" ? "game" : "menu");
      }
      audio.resume();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      dropMatch();
      arena?.dispose();
      players.dispose();
      fx.dispose();
      audio?.dispose();
      input.dispose();
      render.dispose();
    },
  };
  return game;
}
