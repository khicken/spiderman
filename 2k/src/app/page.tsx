"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Device, Difficulty, FinalReport, Game, GameEvent, HintMode, HudHandle, HudSnapshot, MatchSetup, PlayerData, Settings, TeamData, TeamSide } from "./contracts";
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
import { PracticeLoading, TutorialBreak, TutorialCoach, TutorialDone, Welcome, type Bus } from "./ui-tutorial";
import { STEPS } from "./tutorial-steps";
import { coachOn, readOnboarding, writeOnboarding } from "./tutorial-store";

type Screen = "title" | "menu" | "teams" | "loading" | "game" | "final";
type Overlay = null | "settings" | "controls";
/** exhibition: a real game. practice: free shootaround. tutorial: Learn to Play part 1. defense: Learn to Play part 2. */
type Kind = "exhibition" | "practice" | "tutorial" | "defense";

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

function createBus(): Bus & { emit(e: GameEvent): void } {
  const ls = new Set<(e: GameEvent) => void>();
  return {
    on(fn) {
      ls.add(fn);
      return () => ls.delete(fn);
    },
    emit(e) {
      for (const l of ls) l(e);
    },
  };
}

/** The user's team for drills: always seated as home (practice runs on the home side). */
function drillTeams(m: Matchup): { team: TeamData; other: TeamData } {
  const team = m.user === 1 ? m.away : m.home;
  return { team, other: team === m.home ? m.away : m.home };
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
  // v2 onboarding
  const [kind, setKind] = useState<Kind>("exhibition");
  const [playing, setPlaying] = useState<{ home: TeamData; away: TeamData; user: TeamSide | -1 }>(() => {
    const m = defaultMatchup();
    return { home: m.home, away: m.away, user: m.user };
  });
  const [tutIdx, setTutIdx] = useState<number | null>(null);
  const [tutModal, setTutModal] = useState<null | "break" | "done">(null);
  const [welcome, setWelcome] = useState(false);
  const [newbie, setNewbie] = useState(false);
  const [games, setGames] = useState(0);
  const bus = useMemo(createBus, []);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const resumedAt = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tutIdxRef = useRef(tutIdx);
  tutIdxRef.current = tutIdx;
  const kindRef = useRef(kind);
  kindRef.current = kind;
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
    // first launch: no saved settings yet, so start new players on Rookie with coach tips on
    const s0: Settings = saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS, difficulty: "rookie", hints: "first" };
    const savedM = load<{ home: string; away: string; user: TeamSide | -1 }>(MKEY);
    const ob = readOnboarding();
    setNewbie(!ob.tutorialDone);
    setGames(ob.games);
    const g = startGame(
      c,
      {
        hud: (h) => setHud(h),
        hudRef: () => hudRef.current,
        progress: (p) => setProgress(p),
        pause: () => openPause(),
        ended: (r) => {
          if (kindRef.current === "defense" && tutIdxRef.current !== null) {
            gameRef.current?.pause(true);
            setTutModal("done");
            return;
          }
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

  // each offense drill step starts with the ball back in the same player's hands at its own spot, so a rebound by a
  // teammate never leaves the user somewhere odd (or as somebody else)
  useEffect(() => {
    const g = gameRef.current;
    if (kind !== "tutorial" || tutIdx === null || screen !== "game" || tutModal) return;
    const at = STEPS[tutIdx]?.startAt;
    if (!at || !g?.practiceGive) return;
    const t = window.setTimeout(() => g.practiceGive?.(at), 250);
    return () => clearTimeout(t);
  }, [kind, tutIdx, screen, tutModal]);

  // the jumper drill: after each shot lands, the ball comes back on the wing spot
  useEffect(() => {
    if (kind !== "tutorial" || tutIdx === null || screen !== "game" || tutModal) return;
    const step = STEPS[tutIdx];
    if (step?.id !== "jumper" || !step.startAt) return;
    const at = step.startAt;
    let t = 0;
    const off = bus.on((e) => {
      if (e.type !== "make" && e.type !== "miss") return;
      window.clearTimeout(t);
      t = window.setTimeout(() => gameRef.current?.practiceGive?.(at), 1300);
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [kind, tutIdx, screen, tutModal, bus]);

  // the tutorial's floor target follows the current step
  useEffect(() => {
    const g = gameRef.current;
    if (!g?.setCoachSpot) return;
    const spot = kind === "tutorial" && tutIdx !== null && screen === "game" && !tutModal ? STEPS[tutIdx]?.spot ?? null : null;
    g.setCoachSpot(spot);
  }, [kind, tutIdx, screen, tutModal]);

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

  const lastStart = useRef<{ m: Matchup; k: Kind }>({ m: defaultMatchup(), k: "exhibition" });

  const startMatch = useCallback(async (m: Matchup, k: Kind = "exhibition") => {
    const g = gameRef.current;
    if (!g) return;
    lastStart.current = { m, k };
    let s: Settings;
    let setup: MatchSetup;
    if (k === "exhibition") {
      s = { ...settingsRef.current, difficulty: m.difficulty, quarterMinutes: m.quarterMinutes };
      applySettings(s);
      setup = { home: m.home, away: m.away, userTeam: m.user, mode: "exhibition", settings: s };
      setPlaying({ home: m.home, away: m.away, user: m.user });
      if (m.user !== -1) {
        const ob = writeOnboarding({ games: readOnboarding().games + 1 });
        setGames(ob.games);
      }
    } else {
      // drills run on Rookie and never touch the saved settings
      const { team, other } = drillTeams(m);
      s = { ...settingsRef.current, difficulty: "rookie", quarterMinutes: k === "defense" ? 3 : settingsRef.current.quarterMinutes };
      g.setSettings(s);
      setup =
        k === "defense"
          ? { home: team, away: other, userTeam: 0, mode: "exhibition", settings: s, drill: "defense1v1" }
          : { home: team, away: other, userTeam: 0, mode: "practice", settings: s };
      setPlaying({ home: team, away: other, user: 0 });
    }
    setKind(k);
    setReady(false);
    setProgress(0);
    setPending({});
    setBrk(null);
    setReport(null);
    setHud(null);
    setPaused(false);
    setOverlay(null);
    setTutModal(null);
    setScreen("loading");
    g.unlockAudio();
    try {
      await g.start(setup);
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
    setTutIdx(null);
    setTutModal(null);
    setKind("exhibition");
    gameRef.current?.setCoachSpot?.(null);
    gameRef.current?.setSettings(settingsRef.current);
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

  // ------------------------------------------------------------------------------------------------------------------
  // v2 onboarding: Learn to Play
  // ------------------------------------------------------------------------------------------------------------------
  const finishTutorial = useCallback(() => {
    const ob = writeOnboarding({ tutorialDone: true, welcomed: true });
    setNewbie(!ob.tutorialDone);
  }, []);

  const startTutorial = useCallback(() => {
    writeOnboarding({ welcomed: true });
    setWelcome(false);
    setTutIdx(0);
    void startMatch(match, "tutorial");
  }, [match, startMatch]);

  const startPractice = useCallback(() => {
    setTutIdx(null);
    void startMatch(match, "practice");
  }, [match, startMatch]);

  const rookieGame = useCallback((hints?: HintMode, difficulty: Difficulty = "rookie") => {
    const cur = settingsRef.current;
    const s: Settings = { ...cur, difficulty, hints: hints ?? (cur.hints === "off" ? "first" : cur.hints) };
    settingsRef.current = s;
    applySettings(s);
    setTutIdx(null);
    const m: Matchup = { ...match, user: match.user === -1 ? 0 : match.user, difficulty, quarterMinutes: Math.min(match.quarterMinutes, 4) };
    changeMatch(m);
    void startMatch(m, "exhibition");
  }, [match, applySettings, changeMatch, startMatch]);

  const stepDone = useCallback(() => {
    const i = tutIdxRef.current;
    if (i === null) return;
    const next = STEPS[i + 1];
    if (!next) {
      gameRef.current?.pause(true);
      finishTutorial();
      setTutModal("done");
      return;
    }
    setTutIdx(i + 1);
    if (next.part !== STEPS[i].part) {
      gameRef.current?.pause(true);
      setTutModal("break");
    }
  }, [finishTutorial]);

  const skipStep = useCallback(() => {
    setPaused(false);
    resumedAt.current = performance.now();
    const i = tutIdxRef.current;
    const next = i === null ? undefined : STEPS[i + 1];
    if (!next || (i !== null && next.part !== STEPS[i].part)) {
      stepDone();
      return;
    }
    stepDone();
    window.setTimeout(() => gameRef.current?.pause(false), 60);
  }, [stepDone]);

  useEffect(() => {
    if (screen !== "menu" || overlay) return;
    if (!readOnboarding().welcomed) setWelcome(true);
  }, [screen, overlay]);

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
  const menuActive = overlay === null && !welcome;
  const bg = useMemo(() => screen === "game" || screen === "loading" ? null : <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_120%,rgb(255_90_31/0.12),transparent_60%)]" />, [screen]);
  const drill = kind !== "exhibition";
  const inTutorial = (kind === "tutorial" || kind === "defense") && tutIdx !== null;
  const coaching = coachOn(settings.hints, games, drill);
  const userTeamData = playing.user === 1 ? playing.away : playing.home;

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
          newbie={newbie}
          onPlay={() => setScreen("teams")}
          onLearn={startTutorial}
          onPractice={startPractice}
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

      {screen === "menu" && welcome && !overlay && (
        <Welcome
          device={device}
          family={family}
          onTutorial={startTutorial}
          onJumpIn={() => {
            writeOnboarding({ welcomed: true });
            setWelcome(false);
            rookieGame("always");
          }}
          onVeteran={() => {
            writeOnboarding({ welcomed: true });
            setWelcome(false);
          }}
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

      {screen === "loading" && !drill && (
        <Loading
          home={match.home}
          away={match.away}
          user={match.user}
          progress={progress}
          ready={ready}
          onContinue={tipOff}
          onBack={() => toMenu("teams")}
          device={device}
          family={family}
          difficulty={match.difficulty}
          quarterMinutes={match.quarterMinutes}
        />
      )}
      {screen === "loading" && drill && (
        <PracticeLoading
          team={userTeamData}
          title={kind === "tutorial" ? "Learn to play" : kind === "defense" ? "Defense drill" : "Practice court"}
          sub={kind === "tutorial" ? "Part 1 · Offense" : kind === "defense" ? "Part 2 · Defense" : "Shootaround · no clock"}
          progress={progress}
          ready={ready}
          onContinue={tipOff}
          onBack={() => toMenu("menu")}
          device={device}
          family={family}
          difficulty="rookie"
        />
      )}

      {screen === "game" && (
        <>
          <Hud
            ref={hudRef}
            h={hud}
            home={playing.home}
            away={playing.away}
            family={family}
            shotMeter={settings.shotMeter || inTutorial}
            coach={coaching}
            quiet={inTutorial}
            practice={kind === "practice" || kind === "tutorial"}
            onEvent={onEvent}
            onRaw={bus.emit}
          />
          {inTutorial && !tutModal && !paused && tutIdx !== null && STEPS[tutIdx] && (
            <TutorialCoach key={tutIdx} index={tutIdx} h={hud} bus={bus} device={hud?.device ?? device} family={family} onDone={stepDone} />
          )}
          {brk && hud?.phase === "periodBreak" && !paused && !drill && <PeriodBreak r={brk.r} period={brk.period} />}
          {paused && (
            <PauseMenu
              hud={hud}
              report={live}
              home={playing.home}
              away={playing.away}
              settings={settings}
              onSettings={applySettings}
              onResume={resume}
              onQuit={() => toMenu("menu")}
              onRestart={() => void startMatch(lastStart.current.m, lastStart.current.k)}
              onTimeout={() => g?.callTimeout() ?? false}
              onSub={(team, slot, ri) => g?.substitute(team, slot, ri) ?? false}
              pending={pending}
              setPending={setPending}
              device={device}
              family={family}
              practice={kind === "practice" || kind === "tutorial"}
              onTutorial={startTutorial}
              tutorial={
                inTutorial && tutIdx !== null
                  ? {
                      step: STEPS[tutIdx]?.title ?? "",
                      onSkip: skipStep,
                      onExit: () => toMenu("menu"),
                    }
                  : null
              }
            />
          )}
          {tutModal === "break" && (
            <TutorialBreak
              device={device}
              family={family}
              onContinue={() => void startMatch(match, "defense")}
              onPlay={() => {
                finishTutorial();
                rookieGame();
              }}
            />
          )}
          {tutModal === "done" && (
            <TutorialDone
              team={userTeamData}
              device={device}
              family={family}
              onPlay={() => rookieGame()}
              onPractice={startPractice}
              onMenu={() => toMenu("menu")}
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
