"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContainerView, HudState } from "../game/contracts";
import type { GameHandle } from "../game/game";
import { createAudio, type GameAudio } from "../game/audio";
import {
  Chat, LeaveBedButton, ContainerScreen, CreateWorldScreen, Crosshair, DEFAULT_SETTINGS, DeathScreen, DebugOverlay, GuiRoot, Hud, LoadingScreen,
  OptionsScreen, PauseScreen, SelectWorldScreen, TitleScreen, completeCommand, computeGuiScale, setUiClickSound,
  type ChatMessage, type NewWorldOptions, type Settings, type TimedText, type WorldListEntry,
} from "../game/ui";
import { Panorama } from "../game/ui/panorama";
import { StatisticsScreen } from "../game/ui/menus-extra";
import { AdvancementsScreen } from "../game/ui/advancements-screen";
import { CreditsScreen } from "../game/ui/credits-screen";
import { TOAST_MS, Toasts, type ToastEntry } from "../game/ui/toasts";
import { mergeSettings, setActiveKeys } from "../game/ui/settings";
import { createWorldMeta, deleteWorld, listWorlds, loadMeta, saveMeta, type WorldMeta } from "../game/world/save";
import { HideWhileSigning, SignEditScreen } from "../game/ui/sign-screen";

type Screen = "title" | "select" | "create" | "options" | "game";
type Overlay = null | "pause" | "options" | "chat" | "bed" | "advancements" | "statistics";

const SETTINGS_KEY = "mc-settings";

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return mergeSettings(JSON.parse(raw));
  } catch {}
  if (window.matchMedia?.("(pointer: coarse)").matches && navigator.maxTouchPoints > 0) return { ...DEFAULT_SETTINGS, renderDistance: 6, graphics: "fast", clouds: false };
  return DEFAULT_SETTINGS;
}

function writeSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

function useWindowSize() {
  const [size, setSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

export default function Page() {
  const [screen, setScreen] = useState<Screen>("title");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [worlds, setWorlds] = useState<WorldMeta[]>([]);
  const [meta, setMeta] = useState<WorldMeta | null>(null);
  const [loading, setLoading] = useState<number | null>(0);
  const [hud, setHud] = useState<HudState | null>(null);
  const [view, setView] = useState<ContainerView | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [chatInit, setChatInit] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState<(TimedText & { subtitle?: string }) | undefined>();
  const [actionBar, setActionBar] = useState<TimedText | undefined>();
  const [hurtAt, setHurtAt] = useState<number | undefined>();
  const [freshWorld, setFreshWorld] = useState(false);
  const advFromPause = useRef(false);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [credits, setCredits] = useState(false);
  const [death, setDeath] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [hideGui, setHideGui] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameHandle | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const msgId = useRef(0);
  const overlayRef = useRef<Overlay>(null);
  overlayRef.current = overlay;
  const asleep = (hud?.sleeping ?? 0) > 0;
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    if (asleep && !overlayRef.current) {
      setChatInit("");
      g.setInputBlocked(true);
      document.exitPointerLock?.();
      setOverlay("bed");
    } else if (!asleep && overlayRef.current === "bed") {
      setOverlay(null);
      g.setInputBlocked(false);
      g.lock();
    }
  }, [asleep]);
  const { w, h } = useWindowSize();
  const guiScale = computeGuiScale(settings.guiScale, w, h);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setSettings(readSettings());
    setMounted(true);
  }, []);

  const audio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = createAudio();
      setUiClickSound(() => audioRef.current?.play("ui.button.click", undefined, undefined, undefined, 0.25));
    }
    audioRef.current.resume();
    return audioRef.current;
  }, []);

  useEffect(() => {
    const first = () => {
      const a = audio();
      a.setVolume(settings.master, settings.volumes.music, 1);
      a.setCategories(settings.volumes);
      if (!gameRef.current) a.setMusic("menu");
    };
    window.addEventListener("pointerdown", first, { once: true });
    window.addEventListener("keydown", first, { once: true });
    return () => {
      window.removeEventListener("pointerdown", first);
      window.removeEventListener("keydown", first);
    };
  }, [audio, settings.master, settings.volumes]);

  useEffect(() => setActiveKeys(settings.keys), [settings.keys]);

  const refreshWorlds = useCallback(() => {
    listWorlds().then(setWorlds).catch(() => setWorlds([]));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeSettings(next);
      gameRef.current?.setSettings(next);
      audioRef.current?.setVolume(next.master, next.volumes.music, 1);
      audioRef.current?.setCategories(next.volumes);
      return next;
    });
  }, []);

  const addChat = useCallback((text: string) => {
    setMessages((m) => [...m.slice(-99), { id: ++msgId.current, text, at: performance.now() }]);
  }, []);

  useEffect(() => {
    if (screen !== "game" || !meta || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let game: GameHandle | null = null;
    let cancelled = false;
    void import("../game/game").then(({ startGame }) => {
      if (cancelled) return;
      game = startGame(canvas, {
        meta,
        settings,
        audio: audio(),
        ui: {
          hud: setHud,
          phase: (p, progress) => {
            setLoading(p === "loading" ? progress : null);
            if (p === "playing") setFreshWorld(false);
          },
          container: (v) => setView(v),
          chat: (text) => addChat(text),
          title: (text, subtitle) => setTitle({ text, subtitle, at: performance.now() }),
          actionBar: (text) => setActionBar({ text, at: performance.now() }),
          hurt: () => setHurtAt(performance.now()),
          died: (message) => setDeath(message),
          toast: (t) => {
            const id = ++msgId.current;
            setToasts((l) => [...l, { ...t, id }]);
            setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), TOAST_MS);
          },
          credits: () => {
            game?.setPaused(true);
            document.exitPointerLock?.();
            setCredits(true);
          },
          action: (a) => {
            if (a === "pause") {
              if (overlayRef.current) return;
              game?.setPaused(true);
              setOverlay("pause");
            } else if (a === "chat" || a === "command") {
              setChatInit(a === "command" ? "/" : "");
              game?.setInputBlocked(true);
              document.exitPointerLock?.();
              setOverlay("chat");
            } else if (a === "debug") {
              setDebug((d) => {
                game?.setDebug(!d);
                return !d;
              });
            } else if (a === "hide_gui") setHideGui((v) => !v);
            else if (a === "advancements") {
              if (overlayRef.current) return;
              game?.setPaused(true);
              document.exitPointerLock?.();
              advFromPause.current = false;
              setOverlay("advancements");
            }
          },
        },
      });
      gameRef.current = game;
    });
    return () => {
      cancelled = true;
      game?.dispose();
      gameRef.current = null;
    };
  }, [screen, meta]);

  const play = useCallback((m: WorldMeta) => {
    audio().setMusic("none");
    setHud(null);
    setView(null);
    setDeath(null);
    setOverlay(null);
    setMessages([]);
    setLoading(0);
    setFreshWorld(!m.player);
    setMeta(m);
    setScreen("game");
  }, [audio]);

  const onCreate = useCallback(async (o: NewWorldOptions) => {
    const m = await createWorldMeta(o.name, o.seed, o.gameMode, { hardcore: o.hardcore, cheats: o.cheats, rules: { ...o.rules, difficulty: o.difficulty } });
    play(m);
  }, [play]);

  const onPlayWorld = useCallback(async (id: string) => {
    const m = await loadMeta(id);
    if (!m) return;
    m.lastPlayed = Date.now();
    await saveMeta(m).catch(() => {});
    play(m);
  }, [play]);

  const quit = useCallback(async () => {
    const g = gameRef.current;
    gameRef.current = null;
    if (g) await g.quit();
    if (document.pointerLockElement) document.exitPointerLock();
    setOverlay(null);
    setMeta(null);
    setScreen("title");
    refreshWorlds();
    audioRef.current?.setMusic("menu");
  }, [refreshWorlds]);

  const resume = useCallback(() => {
    setOverlay(null);
    gameRef.current?.setPaused(false);
    gameRef.current?.lock();
  }, []);

  const entries: WorldListEntry[] = worlds.map((m) => ({ id: m.id, name: m.name, lastPlayed: m.lastPlayed, gameMode: m.gameMode, hardcore: m.hardcore, cheats: m.cheats, icon: m.icon }));
  const g = gameRef.current;
  const inv = g?.ctx.inventory;

  if (!mounted) return <main />;
  if (screen !== "game") {
    return (
      <>
      <Panorama blur={screen !== "title"} />
      <GuiRoot guiScale={settings.guiScale} style={{ pointerEvents: "auto" }}>
        {screen === "title" && (
          <TitleScreen
            onSingleplayer={() => {
              audio();
              refreshWorlds();
              setScreen("select");
            }}
            onOptions={() => setScreen("options")}
          />
        )}
        {screen === "select" && (
          <SelectWorldScreen
            worlds={entries}
            onPlay={(id) => void onPlayWorld(id)}
            onCreate={() => setScreen("create")}
            onDelete={(id) => void deleteWorld(id).then(refreshWorlds)}
            onCancel={() => setScreen("title")}
          />
        )}
        {screen === "create" && <CreateWorldScreen onCreate={(o) => void onCreate(o)} onCancel={() => setScreen("select")} />}
        {screen === "options" && <OptionsScreen settings={settings} onChange={updateSettings} onDone={() => setScreen("title")} />}
      </GuiRoot>
      </>
    );
  }

  const playing = loading === null;
  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", display: "block", cursor: "none" }}
        onClick={() => {
          if (playing && !overlay && !view && !death) gameRef.current?.lock();
        }}
      />
      {playing && !hideGui && !view && !death && !credits && (!overlay || overlay === "chat" || overlay === "bed") && <HideWhileSigning><Crosshair scale={guiScale} /></HideWhileSigning>}
      <GuiRoot guiScale={settings.guiScale}>
        {playing && hud && !hideGui && <Hud state={hud} title={title} actionBar={actionBar} hurtAt={hurtAt} vignette={settings.graphics === "fancy"} />}
        {playing && !hideGui && <Toasts toasts={toasts} />}
        {credits && (
          <CreditsScreen
            onDone={() => {
              setCredits(false);
              gameRef.current?.setPaused(false);
              gameRef.current?.lock();
            }}
          />
        )}
        {playing && debug && hud?.debug && <DebugOverlay lines={hud.debug} width={Math.ceil(w / guiScale)} />}
        {playing && !death && (
          <div style={{ pointerEvents: overlay === "chat" || overlay === "bed" ? "auto" : "none" }}>
            <Chat
              messages={messages}
              open={overlay === "chat" || overlay === "bed"}
              keepOpen={overlay === "bed"}
              initial={chatInit}
              complete={(line) => (g ? completeCommand(g.ctx, line) : [])}
              textOpacity={settings.chatOpacity}
              bgOpacity={settings.chatBackground}
              lineSpacing={settings.chatLineSpacing}
              chatWidth={settings.chatWidth}
              onSend={(line) => {
                const t = line.trim();
                if (!t) return;
                if (t.startsWith("/")) for (const out of gameRef.current?.command(t) ?? []) addChat(out);
                else addChat(`<Player> ${t}`);
              }}
              onClose={() => {
                if (overlayRef.current === "bed") {
                  gameRef.current?.leaveBed();
                  return;
                }
                setOverlay(null);
                gameRef.current?.setInputBlocked(false);
                gameRef.current?.lock();
              }}
            />
            {overlay === "bed" && <LeaveBedButton onLeave={() => gameRef.current?.leaveBed()} />}
          </div>
        )}
        {playing && view && inv && (
          <div style={{ pointerEvents: "auto" }}>
            <ContainerScreen
              view={view}
              onClick={(i, c) => inv.clickSlot(i, c)}
              onClose={() => {
                gameRef.current?.closeContainer();
                gameRef.current?.lock();
              }}
              onOption={(id) => inv.chooseOption(id)}
              advanced={settings.advancedTooltips}
              creative={
                view.kind === "creative"
                  ? {
                      tabs: inv.creativeTabs(),
                      items: (tab, search) => inv.creativeItems(tab, search),
                      onTake: (stack, click) => inv.takeCreative(stack, click),
                      onDestroy: (all) => {
                        if (all) for (let i = 0; i < 41; i++) inv.setSlot(i, null);
                      },
                    }
                  : undefined
              }
            />
          </div>
        )}
        {playing && !death && <SignEditScreen game={g} />}
        {playing && death && (
          <div style={{ pointerEvents: "auto" }}>
            <DeathScreen
              message={death}
              score={g?.ctx.player.xpTotal ?? 0}
              hardcore={meta?.hardcore}
              onRespawn={() => {
                if (meta?.hardcore && g) g.ctx.player.gameMode = "spectator";
                gameRef.current?.respawn();
                setDeath(null);
                gameRef.current?.lock();
              }}
              onTitle={() => void quit()}
            />
          </div>
        )}
        {playing && overlay === "pause" && (
          <div style={{ pointerEvents: "auto" }}>
            <PauseScreen onResume={resume} onOptions={() => setOverlay("options")} onQuit={() => void quit()} onAdvancements={() => {
              advFromPause.current = true;
              setOverlay("advancements");
            }} onStatistics={() => setOverlay("statistics")} />
          </div>
        )}
        {playing && overlay === "advancements" && (
          <div style={{ pointerEvents: "auto" }}>
            <AdvancementsScreen done={(g?.systems.parts.find((p) => p.name === "advancements")?.save?.() as Record<string, number> | undefined) ?? {}} onDone={() => (advFromPause.current ? setOverlay("pause") : resume())} />
          </div>
        )}
        {playing && overlay === "statistics" && (
          <div style={{ pointerEvents: "auto" }}>
            <StatisticsScreen general={statsRows(g)} onDone={() => setOverlay("pause")} />
          </div>
        )}
        {playing && overlay === "options" && (
          <div style={{ pointerEvents: "auto" }}>
            <OptionsScreen
              settings={settings}
              onChange={updateSettings}
              onDone={() => setOverlay("pause")}
              inGame
              difficulty={g?.ctx.rules.difficulty}
              difficultyLocked={meta?.hardcore}
              onDifficulty={(d) => {
                if (g) g.ctx.rules.difficulty = d;
              }}
            />
          </div>
        )}
        {!playing && (
          <div style={{ pointerEvents: "auto" }}>
            <LoadingScreen progress={loading ?? 0} title={freshWorld ? "Generating world" : "Loading terrain..."} status={freshWorld ? "Building terrain" : undefined} />
          </div>
        )}
      </GuiRoot>
    </>
  );
}

function fmtTime(ticks: number): string {
  const s = ticks / 20;
  if (s < 60) return `${s.toFixed(2)} s`;
  if (s < 3600) return `${(s / 60).toFixed(2)} m`;
  if (s < 86400) return `${(s / 3600).toFixed(2)} h`;
  return `${(s / 86400).toFixed(2)} d`;
}

function statsRows(g: GameHandle | null): [string, string][] {
  if (!g) return [];
  const c = g.ctx;
  return [
    ["Time Played", fmtTime(c.time.tick)],
    ["Days Played", String(c.time.day)],
    ["Experience Level", String(c.player.xpLevel)],
    ["Total Experience", String(c.player.xpTotal)],
  ];
}
