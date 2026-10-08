"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HudState } from "./contracts";
import { SUITS } from "./hero";
import { QUALITIES, startGame, type Quality, type Settings, type UiEvent } from "./game";
import { Hud, type Pop } from "./ui-hud";
import { ControlsPanel, Menu, SettingsPanel, suitCost, type MenuItem, type Panel, type Wallet } from "./ui-menu";
import { PhotoPanel } from "./ui-photo";
import type { Photo } from "./photo";
import { JournalPanel, MapPanel } from "./ui-map";
import { Tips } from "./ui-tips";

type Game = ReturnType<typeof startGame>;
type Screen = "title" | "playing" | "pause";

const KEY = "spiderman-settings";
const POP_MS = { toast: 2800, penalty: 2800, xp: 1900, hurt: 700, token: 2200 } as const;
const TOKEN_TOAST = /^\+(\d+) TOKENS?$/;

function loadSettings(): Settings {
  const s: Settings = { quality: "medium", suit: SUITS[0].id, muted: false, volume: 0.8, sensitivity: 1, invertY: false };
  try {
    const q = localStorage.getItem("spiderman-quality");
    if (q && q in QUALITIES) s.quality = q as Quality;
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    if (saved.quality && saved.quality in QUALITIES) s.quality = saved.quality;
    if (SUITS.some((x) => x.id === saved.suit)) s.suit = saved.suit!;
    if (typeof saved.muted === "boolean") s.muted = saved.muted;
    if (typeof saved.invertY === "boolean") s.invertY = saved.invertY;
    if (typeof saved.volume === "number") s.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved.sensitivity === "number") s.sensitivity = Math.min(2, Math.max(0.5, saved.sensitivity));
  } catch {}
  return s;
}

export default function SpidermanPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const screenRef = useRef<Screen>("title");
  const combatAt = useRef(-Infinity);
  const [hud, setHud] = useState<HudState | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [screen, setScreenState] = useState<Screen>("title");
  const [panel, setPanel] = useState<Panel>(null);
  const [started, setStarted] = useState(false);
  const [touch, setTouch] = useState(false);
  const [pops, setPops] = useState<Pop[]>([]);
  const [photo, setPhoto] = useState<Photo | null>(null);

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
      const tok = e.type === "toast" ? TOKEN_TOAST.exec(e.title) : null;
      const pop = (tok && e.type === "toast" ? { type: "token", amount: Number(tok[1]), reason: e.text ?? "", id: ++id } : { ...e, id: ++id }) as Pop;
      setPops((list) => [...list.filter((p) => p.type !== pop.type || pop.type === "xp").slice(-6), pop]);
      const h = setTimeout(() => {
        timers.delete(h);
        setPops((list) => list.filter((p) => p.id !== pop.id));
      }, POP_MS[pop.type]);
      timers.add(h);
    };
    const onHud = (h: HudState) => {
      if (h.inCombat) combatAt.current = performance.now();
      setHud(h);
      if (h.playing && screenRef.current !== "playing") setScreen("playing");
      else if (!h.playing && screenRef.current === "playing") {
        setScreen("pause");
        setPanel(null);
      }
    };
    const game: Game = startGame(canvasRef.current!, onHud, onEvent, initial);
    gameRef.current = game;
    const offPhoto = game.photo.onChange((on) => setPhoto(on ? game.photo : null));
    const worn = SUITS.find((x) => x.id === initial.suit);
    if (worn && suitCost(worn) > 0 && !game.unlocks.owned.has(worn.id)) {
      game.setSettings({ suit: SUITS[0].id });
      setSettingsState((s) => (s ? { ...s, suit: SUITS[0].id } : s));
    }
    return () => {
      offPhoto?.();
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
          { id: "map", label: "Map", onSelect: () => toggle("map") },
          { id: "journal", label: "Journal", onSelect: () => toggle("journal") },
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

  const unlocks = gameRef.current?.unlocks;
  const wallet: Wallet | undefined = unlocks && {
    tokens: unlocks.tokens,
    owned: (id) => unlocks.owned.has(id),
    buy: (id) => unlocks.buy(id),
  };

  const showVitals = !!hud && (hud.inCombat || hud.health < 0.999 || performance.now() - combatAt.current < 5000);

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />

      {screen === "playing" && hud && !photo && <Hud h={hud} pops={pops} showVitals={showVitals} tip={<Tips h={hud} />} />}
      {screen === "playing" && photo && <PhotoPanel photo={photo} />}

      {screen !== "playing" && (
        <div className={`absolute inset-0 overflow-y-auto ${screen === "pause" ? "bg-black/45 backdrop-blur-md" : ""}`}>
          <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
          {screen === "title" && <div className="halftone-fade pointer-events-none fixed inset-0" />}
          <div className="relative flex min-h-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-12 lg:flex-row lg:items-center lg:gap-16 lg:px-16">
            <div key={screen} className="panel-in flex shrink-0 flex-col">
              {screen === "title" ? (
                <h1
                  className="logo mb-10 font-cond text-[clamp(4rem,13vw,8.5rem)] font-black uppercase italic leading-[0.82] tracking-[-0.02em]"
                  data-text={"Spider\nMan"}
                >
                  Spider
                  <br />
                  Man
                </h1>
              ) : (
                <div className="mb-6 font-cond text-sm font-black uppercase tracking-[0.35em] text-spider">Paused</div>
              )}
              <Menu key={screen} items={items} active={panel} />
            </div>
            {panel && settings && (
              <div key={panel} className={`w-full ${panel === "map" ? "lg:max-w-[880px]" : "lg:max-w-[680px]"}`}>
                {panel === "settings" && <SettingsPanel s={settings} set={update} onClose={() => setPanel(null)} wallet={wallet} />}
                {panel === "controls" && <ControlsPanel onClose={() => setPanel(null)} />}
                {panel === "map" && hud && <MapPanel h={hud} onClose={() => setPanel(null)} />}
                {panel === "journal" && hud && <JournalPanel h={hud} onClose={() => setPanel(null)} />}
              </div>
            )}
          </div>
          {screen === "title" && (
            <div className="fixed bottom-4 left-4 right-4 flex items-center justify-between gap-4 text-xs text-white/50 sm:left-12 lg:left-16">
              <span>{touch ? "Best with a keyboard and mouse." : ""}</span>
              <a href="https://kalebkim.com" className="cursor-pointer underline hover:text-white">
                home
              </a>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
