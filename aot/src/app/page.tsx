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
import { Hud, LockReticle, type Pop } from "./ui-hud";
import {
  ControlsPanel,
  Disclaimer,
  Menu,
  SettingsPanel,
  TitleLogo,
  type MenuItem,
  type Panel,
} from "./ui-menu";

type Screen = "title" | "playing" | "pause";

const KEY = "aot-settings";
const POP_MS = { toast: 2800, score: 1900, hurt: 700, kill: 2200 } as const;

function loadSettings(): Settings {
  const s: Settings = {
    quality: "medium",
    muted: false,
    volume: 0.8,
    sensitivity: 1,
    invertY: false,
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

  const setScreen = (s: Screen) => {
    screenRef.current = s;
    setScreenState(s);
  };

  useEffect(() => {
    const initial = loadSettings();
    setSettingsState(initial);
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onEvent = (e: UiEvent) => {
      const pop = { ...e, id: ++id } as Pop;
      setPops((list) => [
        ...list
          .filter((p) => p.type !== e.type || e.type === "score")
          .slice(-6),
        pop,
      ]);
      const h = setTimeout(() => {
        timers.delete(h);
        setPops((list) => list.filter((p) => p.id !== pop.id));
      }, POP_MS[e.type]);
      timers.add(h);
    };
    const onHud = (h: HudState) => {
      setHud(h);
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
      timers.forEach(clearTimeout);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const update = useCallback((p: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s!, ...p };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
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
            onSelect: () => {
              setPanel(null);
              setScreen("title");
            },
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

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-ink text-bone">
      <canvas
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
        <Hud h={hud} pops={pops} onSkip={() => gameRef.current?.skipIntro()} />
      )}

      {screen !== "playing" && (
        <div
          className={`grain absolute inset-0 overflow-y-auto ${screen === "pause" ? "bg-ink/55 backdrop-blur-sm" : ""}`}
        >
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_70%_40%,transparent_20%,rgba(40,0,0,0.55)_70%,rgba(0,0,0,0.9)_100%)]" />
          <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="relative flex min-h-full flex-col gap-8 px-4 pb-20 pt-10 sm:px-12 lg:flex-row lg:items-center lg:gap-14 lg:px-16">
            <div key={screen} className="flex shrink-0 flex-col">
              {screen === "title" ? (
                <div className="mb-10" style={{ zoom: panel ? 0.72 : 1 }}>
                  <TitleLogo />
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
              <div key={panel} className="w-full lg:max-w-[720px]">
                {panel === "settings" && (
                  <SettingsPanel
                    qualities={QUALITIES}
                    s={settings}
                    set={update}
                    onClose={() => setPanel(null)}
                  />
                )}
                {panel === "controls" && (
                  <ControlsPanel onClose={() => setPanel(null)} />
                )}
              </div>
            )}
          </div>
          {screen === "title" && (
            <div className="fixed bottom-4 left-4 right-4 flex items-end justify-between gap-4 text-xs text-bone/50 sm:left-12 lg:left-16">
              <div>
                {touch && (
                  <div className="mb-1">Best with a keyboard and mouse.</div>
                )}
                <Disclaimer />
              </div>
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
    </main>
  );
}
