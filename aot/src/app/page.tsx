"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HudState } from "./contracts";
import { QUALITIES, startGame, type Game, type Quality, type Settings, type UiEvent } from "./game";
import { Hud, type Pop } from "./ui-hud";
import { ControlsPanel, Menu, SettingsPanel, type MenuItem, type Panel } from "./ui-menu";

type Screen = "title" | "playing" | "pause";

const KEY = "aot-settings";
const POP_MS = { toast: 2800, score: 1900, hurt: 700 } as const;

function loadSettings(): Settings {
  const s: Settings = { quality: "medium", muted: false, volume: 0.8, sensitivity: 1, invertY: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    if (saved.quality && saved.quality in QUALITIES) s.quality = saved.quality as Quality;
    if (typeof saved.muted === "boolean") s.muted = saved.muted;
    if (typeof saved.invertY === "boolean") s.invertY = saved.invertY;
    if (typeof saved.volume === "number") s.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.sensitivity === "number") s.sensitivity = Math.min(2, Math.max(0.5, saved.sensitivity));
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
      setPops((list) => [...list.filter((p) => p.type !== e.type || e.type === "score").slice(-6), pop]);
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
          { id: "resume", label: "Resume", onSelect: play },
          { id: "settings", label: "Settings", onSelect: () => toggle("settings") },
          { id: "controls", label: "Controls", onSelect: () => toggle("controls") },
          {
            id: "quit",
            label: "Quit to title",
            onSelect: () => {
              setPanel(null);
              setScreen("title");
            },
          },
        ]
      : [
          { id: "play", label: hud ? (started ? "Continue" : "Play") : "Loading", onSelect: play, disabled: !hud },
          { id: "settings", label: "Settings", onSelect: () => toggle("settings") },
          { id: "controls", label: "Controls", onSelect: () => toggle("controls") },
        ];

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <div
        ref={reticleRef}
        className="pointer-events-none absolute left-0 top-0 h-10 w-10 rounded-full border-2 border-blood opacity-0 shadow-[0_0_12px_rgba(211,58,44,0.8)]"
      />

      {screen === "playing" && hud && <Hud h={hud} pops={pops} />}

      {screen !== "playing" && (
        <div className={`absolute inset-0 overflow-y-auto ${screen === "pause" ? "bg-black/45 backdrop-blur-md" : ""}`}>
          <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
          <div className="relative flex min-h-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-12 lg:flex-row lg:items-center lg:gap-16 lg:px-16">
            <div key={screen} className="panel-in flex shrink-0 flex-col">
              {screen === "title" ? (
                <>
                  <div className="mb-2 font-cond text-sm font-black uppercase tracking-[0.5em] text-brass">Survey Corps</div>
                  <h1 className="logo mb-10 font-cond text-[clamp(3.5rem,11vw,7.5rem)] font-black uppercase leading-[0.85] tracking-[-0.01em]">
                    Attack
                    <br />
                    on Titan
                  </h1>
                </>
              ) : (
                <div className="mb-6 font-cond text-sm font-black uppercase tracking-[0.35em] text-brass">Paused</div>
              )}
              <Menu key={screen} items={items} active={panel} />
            </div>
            {panel && settings && (
              <div key={panel} className="w-full lg:max-w-[680px]">
                {panel === "settings" && <SettingsPanel s={settings} set={update} onClose={() => setPanel(null)} />}
                {panel === "controls" && <ControlsPanel onClose={() => setPanel(null)} />}
              </div>
            )}
          </div>
          {screen === "title" && (
            <div className="fixed bottom-4 left-4 right-4 flex items-center justify-between gap-4 text-xs text-white/50 sm:left-12 lg:left-16">
              <span>{touch ? "Best with a keyboard and mouse." : ""}</span>
              <a href="https://kalebkim.com" className="pointer-events-auto cursor-pointer underline hover:text-white">
                home
              </a>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
