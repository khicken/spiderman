"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HudState } from "./contracts";
import {
  QUALITIES,
  startGame,
  type Game,
  type Quality,
  type Settings,
  type UiEvent,
} from "./game";
import { getCharacter } from "./progression-chars";
import { isBoss } from "./titan-waves";
import {
  bankRun,
  loadCareer,
  newlyUnlocked,
  unlocked,
  type Career,
  type RunStats,
} from "./progression";
import {
  CharacterSelect,
  RankBadge,
  ResultsCard,
  type Results,
} from "./ui-char";
import { Hud, LockReticle, type Msgs, type Pop } from "./ui-hud";
import { Drill, LevelUp } from "./ui-run";
import {
  ControlsPanel,
  Disclaimer,
  Menu,
  SettingsPanel,
  TitleLogo,
  type MenuItem,
  type Panel,
} from "./ui-menu";
import {
  RotateHint,
  TouchControls,
  TouchHelp,
  enterFullscreen,
  isPhone,
  isTouch,
} from "./ui-touch";

type Screen = "title" | "playing" | "pause" | "results";

const KEY = "aot-settings";
const POP_MS = { toast: 2800, score: 1900, hurt: 700, kill: 2200, banner: 2800, radio: 3200, callout: 1600 } as const;
const MAX_TOASTS = 2;

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  return s;
}

function loadSettings(): Settings {
  const s: Settings = {
    quality: isPhone() ? "low" : "medium",
    muted: false,
    volume: 0.8,
    sensitivity: 1,
    invertY: false,
    character: "cadet",
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(KEY) ?? "{}",
    ) as Partial<Settings>;
    if (saved.quality && saved.quality in QUALITIES)
      s.quality = saved.quality as Quality;
    if (typeof saved.muted === "boolean") s.muted = saved.muted;
    if (typeof saved.invertY === "boolean") s.invertY = saved.invertY;
    if (typeof saved.volume === "number")
      s.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.sensitivity === "number")
      s.sensitivity = Math.min(2, Math.max(0.5, saved.sensitivity));
    const ch = getCharacter(saved.character);
    if (unlocked(ch, loadCareer())) s.character = ch.id;
  } catch {}
  return s;
}

export default function TitanPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const screenRef = useRef<Screen>("title");
  const [hud, setHud] = useState<HudState | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [screen, setScreenState] = useState<Screen>("title");
  const [panel, setPanel] = useState<Panel>(null);
  const [started, setStarted] = useState(false);
  const [touch, setTouch] = useState(false);
  const [pops, setPops] = useState<Pop[]>([]);
  const [msgs, setMsgs] = useState<Msgs>({ banner: null, radio: null, callout: null });
  const [career, setCareer] = useState<Career | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [run, setRun] = useState(0);
  const runRef = useRef<RunStats & { dead: boolean; over: boolean }>(null!);

  const setScreen = (s: Screen) => {
    screenRef.current = s;
    setScreenState(s);
  };

  const endRun = useCallback((reason: Results["reason"]) => {
    const r = runRef.current;
    if (r.over) return;
    r.over = true;
    screenRef.current = "results";
    gameRef.current?.pause();
    const before = loadCareer();
    const after = bankRun(r);
    setCareer(after);
    setResults({
      run: { ...r },
      before,
      after,
      reason,
      unlocks: newlyUnlocked(before, after).map((c) => c.name),
    });
    setPanel(null);
    setScreen("results");
  }, []);

  useEffect(() => {
    const initial = loadSettings();
    setSettingsState(initial);
    setCareer(loadCareer());
    runRef.current = { kills: 0, bestSpeed: 0, bestCombo: 0, score: 0, deaths: 0, xp: 0, level: 1, objectives: 0, objectiveCount: 0, dead: false, over: false };
    const coarse = isTouch();
    setTouch(coarse);
    const portrait = window.matchMedia("(orientation: portrait)");
    const onTurn = () => {
      if (coarse && portrait.matches && screenRef.current === "playing")
        gameRef.current?.pause();
    };
    const noZoom = (e: Event) => e.preventDefault();
    portrait.addEventListener("change", onTurn);
    document.addEventListener("gesturestart", noZoom);
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const h = setTimeout(() => {
        timers.delete(h);
        fn();
      }, ms);
      timers.add(h);
    };
    const addPop = (pop: Pop, ms: number, done?: () => void) => {
      setPops((list) => [...list.slice(-12), pop]);
      later(() => {
        setPops((list) => list.filter((p) => p.id !== pop.id));
        done?.();
      }, ms);
    };
    const toastsOn: Pop[] = [];
    const toastQ: Pop[] = [];
    let lowT = -1e9;
    const same = (a: Pop, b: UiEvent) => a.type === "toast" && b.type === "toast" && a.title === b.title && a.text === b.text;
    const pumpToasts = () => {
      while (toastsOn.length < MAX_TOASTS && toastQ.length) {
        const p = toastQ.shift()!;
        toastsOn.push(p);
        addPop(p, POP_MS.toast, () => {
          toastsOn.splice(toastsOn.indexOf(p), 1);
          pumpToasts();
        });
      }
    };
    const bannerQ: Pop[] = [];
    let banner: Pop | null = null;
    const showBanner = () => {
      if (banner || !bannerQ.length) return;
      const b = (banner = bannerQ.shift()!);
      setMsgs((m) => ({ ...m, banner: b }));
      later(() => {
        if (banner !== b) return;
        banner = null;
        setMsgs((m) => ({ ...m, banner: null }));
        showBanner();
      }, b.type === "kill" && !isBoss(b.kind) ? POP_MS.kill : POP_MS.banner);
    };
    const flash = (slot: "radio" | "callout", p: Pop) => {
      setMsgs((m) => ({ ...m, [slot]: p }));
      later(() => setMsgs((m) => (m[slot] === p ? { ...m, [slot]: null } : m)), POP_MS[slot]);
    };
    const onEvent = (e: UiEvent) => {
      const pop = { ...e, id: ++id } as Pop;
      if (e.type === "toast") {
        if (toastsOn.some((p) => same(p, e)) || toastQ.some((p) => same(p, e))) return;
        if (e.low) {
          const now = performance.now();
          if (now - lowT < 2000 || toastsOn.length || toastQ.length) return;
          lowT = now;
        }
        toastQ.splice(0, toastQ.length - 3);
        toastQ.push(pop);
        pumpToasts();
      } else if (e.type === "kill") {
        if (banner?.type === "banner") bannerQ.unshift({ ...banner, id: ++id });
        banner = null;
        bannerQ.unshift(pop);
        showBanner();
      } else if (e.type === "banner") {
        bannerQ.push(pop);
        showBanner();
      } else if (e.type === "radio" || e.type === "callout") flash(e.type, pop);
      else addPop(pop, POP_MS[e.type]);
    };
    let shownQ = initial.quality;
    const onHud = (h: HudState) => {
      setHud(h);
      if (h.quality !== shownQ) {
        shownQ = h.quality;
        setSettingsState((s) => (s ? save({ ...s, quality: h.quality }) : s));
      }
      const r = runRef.current;
      if (h.playing && !h.intro && !r.over) {
        r.kills = h.kills;
        r.score = h.score;
        r.bestSpeed = Math.max(r.bestSpeed, h.speed);
        r.bestCombo = Math.max(r.bestCombo, h.combo);
        r.xp = h.run.total;
        r.level = h.run.level;
        r.objectives = h.run.done;
        r.objectiveCount = h.run.count;
        if (h.dead && !r.dead && ++r.deaths >= 3)
          timers.add(setTimeout(() => endRun("fallen"), 1600));
        r.dead = h.dead;
      }
      if (h.playing && screenRef.current !== "playing") setScreen("playing");
      else if (!h.playing && screenRef.current === "playing") {
        setScreen("pause");
        setPanel(null);
      }
    };
    const game = startGame(canvasRef.current!, onHud, onEvent, initial);
    game.bindReticle(reticleRef.current);
    gameRef.current = game;
    return () => {
      portrait.removeEventListener("change", onTurn);
      document.removeEventListener("gesturestart", noZoom);
      timers.forEach(clearTimeout);
      setPops([]);
      setMsgs({ banner: null, radio: null, callout: null });
      game.dispose();
      gameRef.current = null;
    };
  }, [run, endRun]);

  const update = useCallback((p: Partial<Settings>) => {
    setSettingsState((s) => save({ ...s!, ...p }));
    gameRef.current?.setSettings(p);
  }, []);

  useEffect(() => {
    if (screen === "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel) setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, panel]);

  const play = () => {
    setStarted(true);
    setPanel(null);
    if (touch) enterFullscreen();
    gameRef.current?.play();
  };
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  const items: MenuItem[] =
    screen === "pause"
      ? [
          { id: "resume", label: "Resume", jp: "再開", onSelect: play },
          {
            id: "settings",
            label: "Settings",
            jp: "設定",
            onSelect: () => toggle("settings"),
          },
          {
            id: "controls",
            label: "Controls",
            jp: "操作",
            onSelect: () => toggle("controls"),
          },
          {
            id: "quit",
            label: "Quit",
            jp: "撤退",
            onSelect: () => endRun("retreat"),
          },
        ]
      : [
          {
            id: "play",
            label: hud ? (started ? "Continue" : "Play") : "Loading",
            jp: started ? "続行" : "出撃",
            onSelect: play,
            disabled: !hud,
          },
          {
            id: "characters",
            label: "Soldiers",
            jp: "兵士",
            onSelect: () => toggle("characters"),
          },
          {
            id: "settings",
            label: "Settings",
            jp: "設定",
            onSelect: () => toggle("settings"),
          },
          {
            id: "controls",
            label: "Controls",
            jp: "操作",
            onSelect: () => toggle("controls"),
          },
        ];
  const closeResults = () => {
    setResults(null);
    setStarted(false);
    setHud(null);
    setScreen("title");
    setRun((n) => n + 1);
  };

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-ink text-bone">
      <canvas
        key={run}
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />
      <div
        ref={reticleRef}
        className="pointer-events-none absolute left-0 top-0 h-0 w-0 opacity-0"
      >
        {screen === "playing" && hud && !hud.intro && (
          <LockReticle lock={hud.lock} />
        )}
      </div>

      {screen === "playing" && hud && (
        <div className={touch ? "touch-hud" : undefined}>
          <Hud
            h={hud}
            pops={pops}
            msgs={msgs}
            touch={touch}
            who={settings ? getCharacter(settings.character) : null}
            final={runRef.current.deaths >= 3}
            onSkip={() => gameRef.current?.skipIntro()}
          />
          {!hud.intro && (
            <div className="pointer-events-none absolute left-1/2 top-[74px] -translate-x-1/2 font-display text-[11px] uppercase tracking-[0.2em] text-bone/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
              {hud.fps} fps · {QUALITIES[hud.quality].label}
            </div>
          )}
        </div>
      )}
      {touch && screen === "playing" && hud && !hud.intro && !hud.dead && (
        <TouchControls
          pad={gameRef.current!.virtual}
          onOrder={() => gameRef.current?.order()}
          h={hud}
          onPause={() => gameRef.current?.pause()}
        />
      )}
      {screen === "playing" && hud && (hud.run.choice || hud.run.drill) && !hud.intro && (
        <div className={touch ? "touch-hud" : undefined}>
          <Drill run={hud.run} onSkip={() => gameRef.current?.skipDrill()} />
          <LevelUp run={hud.run} onPick={(i) => gameRef.current?.pick(i)} />
        </div>
      )}

      {screen !== "playing" && (
        <div
          key={screen === "results" ? "results" : "menu"}
          className={`grain absolute inset-0 overflow-y-auto ${screen === "pause" ? "bg-ink/55 backdrop-blur-sm" : ""}`}
        >
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_70%_40%,transparent_20%,rgba(40,0,0,0.55)_70%,rgba(0,0,0,0.9)_100%)]" />
          <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
          {screen === "results" && results ? (
            <div className={`relative flex min-h-full items-center justify-center ${touch ? "touch-menu py-3" : "px-4 py-10"}`}>
              <ResultsCard r={results} onClose={closeResults} />
            </div>
          ) : panel === "characters" && settings && career ? (
            <div className={`relative flex min-h-full items-center justify-center ${touch ? "touch-menu py-2" : "px-4 py-10 sm:px-12"}`}>
              <div className="w-full max-w-[980px]">
                <CharacterSelect
                  pick={settings.character}
                  career={career}
                  onPick={(id) => update({ character: id })}
                  onClose={() => setPanel(null)}
                />
              </div>
            </div>
          ) : (
          <div
            className={`relative flex min-h-full ${touch ? "touch-menu flex-row items-center gap-6 py-6" : "flex-col gap-8 px-4 pb-20 pt-10 sm:px-12 lg:flex-row lg:items-center lg:gap-14 lg:px-16"}`}
          >
            <div
              key={screen}
              className="flex shrink-0 flex-col"
              style={touch && panel ? { zoom: 0.6 } : undefined}
            >
              {screen === "title" ? (
                <div className="mb-8" style={{ zoom: panel ? 0.72 : 1 }}>
                  <TitleLogo />
                  {career && <RankBadge career={career} />}
                </div>
              ) : (
                <div className="panel-in mb-8">
                  <div className="font-jp text-lg font-black tracking-[0.4em] text-blood">
                    一時停止
                  </div>
                  <div className="logo-text font-display text-7xl uppercase leading-none">
                    Paused
                  </div>
                </div>
              )}
              <Menu key={screen} items={items} active={panel} />
            </div>
            {panel && settings && (
              <div
                key={panel}
                className={touch ? "min-w-0 flex-1" : "w-full lg:max-w-[720px]"}
              >
                {panel === "settings" && (
                  <SettingsPanel
                    qualities={QUALITIES}
                    s={settings}
                    set={update}
                    onClose={() => setPanel(null)}
                  />
                )}
                {panel === "controls" &&
                  (touch ? (
                    <TouchHelp onClose={() => setPanel(null)} />
                  ) : (
                    <ControlsPanel onClose={() => setPanel(null)} />
                  ))}
              </div>
            )}
          </div>
          )}
          {screen === "title" && panel !== "characters" && (
            <div className="fixed bottom-4 left-4 right-4 flex items-end justify-between gap-4 text-xs text-bone/50 sm:left-12 lg:left-16">
              <Disclaimer />
              <a
                href="https://kalebkim.com"
                className="pointer-events-auto cursor-pointer underline hover:text-bone"
              >
                home
              </a>
            </div>
          )}
        </div>
      )}
      {touch && <RotateHint />}
    </main>
  );
}
