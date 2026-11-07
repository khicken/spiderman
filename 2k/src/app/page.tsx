"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Device, FinalReport, Game, GameEvent, HudHandle, HudSnapshot, PlayerData, Settings, TeamSide } from "./contracts";
import { DEFAULT_SETTINGS } from "./contracts";
import { ALL_TEAMS, topPlayers } from "./data";
import { startGame } from "./game";
import { padFamily } from "./ui-glyphs";
import { Hud } from "./ui-hud";
import { Loading } from "./ui-loading";
import { MainMenu, Title } from "./ui-menu";
import { nav, setNavSound } from "./ui-nav";
import { PauseMenu, type PendingSubs } from "./ui-pause";
import { FinalScreen, PeriodBreak } from "./ui-results";
import { ControlsPanel, OverlayScreen, SettingsPanel } from "./ui-settings";
import { TeamSelect, type Matchup } from "./ui-teams";

type Screen = "title" | "menu" | "teams" | "loading" | "game" | "final";
type Overlay = null | "settings" | "controls";

const SKEY = "hoops.settings.v1";
const MKEY = "hoops.matchup.v1";

function load<T>(k: string): Partial<T> | null {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as Partial<T>) : null;
  } catch {
    return null;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

function defaultMatchup(): Matchup {
  const top = topPlayers(12);
  const home = top[0]?.team ?? ALL_TEAMS[0];
  const away = top.find((x) => x.team !== home)?.team ?? ALL_TEAMS[1] ?? ALL_TEAMS[0];
  return { home, away, user: 0, difficulty: DEFAULT_SETTINGS.difficulty, quarterMinutes: DEFAULT_SETTINGS.quarterMinutes };
}

function randomMatchup(base: Matchup): Matchup {
  const a = Math.floor(Math.random() * ALL_TEAMS.length);
  let b = Math.floor(Math.random() * (ALL_TEAMS.length - 1));
  if (b >= a) b++;
  return { ...base, home: ALL_TEAMS[a], away: ALL_TEAMS[b], user: base.user === -1 ? 0 : base.user };
}

export default function Page() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const hudRef = useRef<HudHandle>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>("title");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [match, setMatch] = useState<Matchup>(defaultMatchup);
  const [featured, setFeatured] = useState<PlayerData | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [report, setReport] = useState<FinalReport | null>(null);
  const [live, setLive] = useState<FinalReport | null>(null);
  const [brk, setBrk] = useState<{ period: number; r: FinalReport } | null>(null);
  const [pending, setPending] = useState<PendingSubs>({});
  const [device, setDevice] = useState<Device>("keys");
  const [padName, setPadName] = useState<string | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const resumedAt = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const family = padFamily(padName);

  const openPause = useCallback(() => {
    const g = gameRef.current;
    if (!g || screenRef.current !== "game" || pausedRef.current) return;
    if (performance.now() - resumedAt.current < 350) return;
    g.pause(true);
    setLive(g.report());
    setPaused(true);
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const saved = load<Settings>(SKEY);
    const s0: Settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
    const savedM = load<{ home: string; away: string; user: TeamSide | -1 }>(MKEY);
    const g = startGame(
      c,
      {
        hud: (h) => setHud(h),
        hudRef: () => hudRef.current,
        progress: (p) => setProgress(p),
        pause: () => openPause(),
        ended: (r) => {
          setReport(r);
          setPaused(false);
          setScreen("final");
        },
      },
      s0,
    );
    gameRef.current = g;
    setSettings(s0);
    let m = defaultMatchup();
    m = { ...m, difficulty: s0.difficulty, quarterMinutes: s0.quarterMinutes };
    if (savedM) {
      const h = ALL_TEAMS.find((t) => t.abbr === savedM.home);
      const a = ALL_TEAMS.find((t) => t.abbr === savedM.away);
      if (h && a && h !== a) m = { ...m, home: h, away: a, user: savedM.user ?? 0 };
    }
    setMatch(m);
    g.showcase(m.home, m.away);
    setNavSound((snd) => g.audio?.sfx(snd));
    // input also emits keyboard nav; ui-nav handles keys itself, so only pad edges are forwarded
    const off = g.input.onNav((d, src?: Device) => {
      if ((src ?? g.input.device) !== "pad") return;
      setDevice("pad");
      setPadName(g.input.padName);
      nav(d, "pad");
    });
    const onKey = () => setDevice((d) => (d === "keys" ? d : "keys"));
    const onPad = (e: GamepadEvent) => setPadName(e.gamepad.id);
    window.addEventListener("keydown", onKey);
    window.addEventListener("gamepadconnected", onPad);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __hoops: Game }).__hoops = g;
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gamepadconnected", onPad);
      setNavSound(null);
      g.dispose();
      gameRef.current = null;
    };
  }, [openPause]);

  useEffect(() => {
    if (hud && screen === "game" && hud.device !== device) setDevice(hud.device);
  }, [hud, screen, device]);

  // debounced: re-dressing the arena rebuilds canvas textures
  useEffect(() => {
    if (screen !== "menu" && screen !== "teams" && screen !== "title") return;
    const g = gameRef.current;
    if (!g) return;
    const t = window.setTimeout(() => g.showcase(match.home, match.away, featured && match.home.players.includes(featured) ? featured : null), 220);
    return () => clearTimeout(t);
  }, [match.home, match.away, featured, screen]);

  const applySettings = useCallback((s: Settings) => {
    setSettings(s);
    save(SKEY, s);
    gameRef.current?.setSettings(s);
  }, []);

  const changeMatch = useCallback((m: Matchup) => {
    setMatch(m);
    save(MKEY, { home: m.home.abbr, away: m.away.abbr, user: m.user });
    const s = settingsRef.current;
    if (m.difficulty !== s.difficulty || m.quarterMinutes !== s.quarterMinutes) {
      const n = { ...s, difficulty: m.difficulty, quarterMinutes: m.quarterMinutes };
      setSettings(n);
      save(SKEY, n);
    }
  }, []);

  const startMatch = useCallback(async (m: Matchup) => {
    const g = gameRef.current;
    if (!g) return;
    const s = { ...settingsRef.current, difficulty: m.difficulty, quarterMinutes: m.quarterMinutes };
    applySettings(s);
    setReady(false);
    setProgress(0);
    setPending({});
    setBrk(null);
    setReport(null);
    setHud(null);
    setPaused(false);
    setOverlay(null);
    setScreen("loading");
    g.unlockAudio();
    try {
      await g.start({ home: m.home, away: m.away, userTeam: m.user, mode: "exhibition", settings: s });
    } catch (e) {
      console.error("start failed", e);
    }
    if (screenRef.current !== "loading" || gameRef.current !== g) return;
    g.pause(true);
    setReady(true);
  }, [applySettings]);

  const tipOff = useCallback(() => {
    setScreen("game");
    resumedAt.current = performance.now();
    window.setTimeout(() => gameRef.current?.pause(false), 60);
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    resumedAt.current = performance.now();
    window.setTimeout(() => gameRef.current?.pause(false), 60);
  }, []);

  const toMenu = useCallback((to: Screen) => {
    setPaused(false);
    setReport(null);
    setHud(null);
    setBrk(null);
    gameRef.current?.quit();
    setScreen(to);
  }, []);

  const onEvent = useCallback((e: GameEvent) => {
    const g = gameRef.current;
    if (!g) return;
    if (e.type === "periodEnd") {
      const r = g.report();
      if (r) setBrk({ period: e.period, r });
    } else if (e.type === "periodStart" || e.type === "gameEnd") setBrk(null);
  }, []);

  useEffect(() => {
    if (!hud || !Object.keys(pending).length) return;
    let changed = false;
    const next: PendingSubs = {};
    for (const [k, ri] of Object.entries(pending)) {
      const slot = +k;
      const p = hud.onCourt[slot < 5 ? 0 : 1]?.[slot % 5];
      if (p && p.rosterIndex === ri) changed = true;
      else next[slot] = ri;
    }
    if (changed) setPending(next);
  }, [hud, pending]);

  const g = gameRef.current;
  const menuActive = overlay === null;
  const bg = useMemo(() => screen === "game" || screen === "loading" ? null : <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_120%,rgb(255_90_31/0.12),transparent_60%)]" />, [screen]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-night text-ink">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {bg}

      {screen === "title" && (
        <Title
          padName={padName}
          onStart={() => {
            gameRef.current?.unlockAudio();
            setScreen("menu");
          }}
        />
      )}

      {screen === "menu" && (
        <MainMenu
          active={menuActive}
          home={match.home}
          away={match.away}
          device={device}
          family={family}
          onPlay={() => setScreen("teams")}
          onQuick={() => {
            const m = randomMatchup(match);
            changeMatch(m);
            void startMatch(m);
          }}
          onSettings={() => setOverlay("settings")}
          onControls={() => setOverlay("controls")}
          onBack={() => setScreen("title")}
        />
      )}

      {screen === "teams" && (
        <TeamSelect
          active={menuActive}
          value={match}
          onChange={changeMatch}
          onStart={() => void startMatch(match)}
          onBack={() => {
            setFeatured(null);
            setScreen("menu");
          }}
          onFeature={(p) => setFeatured(p)}
          device={device}
          family={family}
        />
      )}

      {screen === "loading" && (
        <Loading
          home={match.home}
          away={match.away}
          user={match.user}
          progress={progress}
          ready={ready}
          onContinue={tipOff}
          device={device}
          family={family}
          difficulty={match.difficulty}
          quarterMinutes={match.quarterMinutes}
        />
      )}

      {screen === "game" && (
        <>
          <Hud ref={hudRef} h={hud} home={match.home} away={match.away} family={family} shotMeter={settings.shotMeter} onEvent={onEvent} />
          {brk && hud?.phase === "periodBreak" && !paused && <PeriodBreak r={brk.r} period={brk.period} />}
          {paused && (
            <PauseMenu
              hud={hud}
              report={live}
              home={match.home}
              away={match.away}
              settings={settings}
              onSettings={applySettings}
              onResume={resume}
              onQuit={() => toMenu("menu")}
              onRestart={() => void startMatch(match)}
              onTimeout={() => g?.callTimeout() ?? false}
              onSub={(team, slot, ri) => g?.substitute(team, slot, ri) ?? false}
              pending={pending}
              setPending={setPending}
              device={device}
              family={family}
            />
          )}
        </>
      )}

      {screen === "final" && report && (
        <FinalScreen
          r={report}
          active={true}
          device={device}
          family={family}
          onRematch={() => void startMatch(match)}
          onNew={() => toMenu("teams")}
          onMenu={() => toMenu("menu")}
        />
      )}

      {overlay === "settings" && (
        <OverlayScreen title="Settings" eyebrow="Game options" onBack={() => setOverlay(null)} device={device} family={family}>
          <SettingsPanel
            value={settings}
            onChange={(s) => {
              applySettings(s);
              setMatch((m) => ({ ...m, difficulty: s.difficulty, quarterMinutes: s.quarterMinutes }));
            }}
          />
        </OverlayScreen>
      )}
      {overlay === "controls" && (
        <OverlayScreen title="Controls" eyebrow="How to play" onBack={() => setOverlay(null)} device={device} family={family}>
          <ControlsPanel device={device} family={family} />
        </OverlayScreen>
      )}
    </main>
  );
}

