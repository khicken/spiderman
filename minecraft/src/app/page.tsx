"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContainerView, HudState } from "../game/contracts";
import type { GameHandle } from "../game/game";
import { createAudio, type GameAudio } from "../game/audio";
import {
  Chat, ContainerScreen, CreateWorldScreen, Crosshair, DEFAULT_SETTINGS, DeathScreen, DebugOverlay, GuiRoot, Hud, LoadingScreen,
  OptionsScreen, PauseScreen, SelectWorldScreen, TitleScreen, completeCommand, computeGuiScale, setUiClickSound,
  type ChatMessage, type NewWorldOptions, type Settings, type TimedText, type WorldListEntry,
} from "../game/ui";
import { createWorldMeta, deleteWorld, listWorlds, loadMeta, saveMeta, type WorldMeta } from "../game/world/save";

type Screen = "title" | "select" | "create" | "options" | "game";
type Overlay = null | "pause" | "options" | "chat";

const SETTINGS_KEY = "mc-settings";

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
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
  const [hurtAt, setHurtAt] = useState<number | undefined>();
  const [death, setDeath] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [hideGui, setHideGui] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameHandle | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const msgId = useRef(0);
  const overlayRef = useRef<Overlay>(null);
  overlayRef.current = overlay;
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
      a.setVolume(settings.master, settings.music, settings.sound);
      if (!gameRef.current) a.setMusic("menu");
    };
    window.addEventListener("pointerdown", first, { once: true });
    window.addEventListener("keydown", first, { once: true });
    return () => {
      window.removeEventListener("pointerdown", first);
      window.removeEventListener("keydown", first);
    };
  }, [audio, settings.master, settings.music, settings.sound]);

  const refreshWorlds = useCallback(() => {
    listWorlds().then(setWorlds).catch(() => setWorlds([]));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeSettings(next);
      gameRef.current?.setSettings(next);
      audioRef.current?.setVolume(next.master, next.music, next.sound);
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
          phase: (p, progress) => setLoading(p === "loading" ? progress : null),
          container: (v) => setView(v),
          chat: (text) => addChat(text),
          title: (text, subtitle) => setTitle({ text, subtitle, at: performance.now() }),
          hurt: () => setHurtAt(performance.now()),
          died: (message) => setDeath(message),
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
    setMeta(m);
    setScreen("game");
  }, [audio]);

  const onCreate = useCallback(async (o: NewWorldOptions) => {
    const m = await createWorldMeta(o.name, o.seed, o.gameMode, { hardcore: o.hardcore, cheats: o.cheats, rules: { difficulty: o.difficulty } });
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

  const entries: WorldListEntry[] = worlds.map((m) => ({ id: m.id, name: m.name, lastPlayed: m.lastPlayed, gameMode: m.gameMode, hardcore: m.hardcore, cheats: m.cheats }));
  const g = gameRef.current;
  const inv = g?.ctx.inventory;

  if (!mounted) return <main />;
  if (screen !== "game") {
    return (
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
      {playing && !hideGui && !view && !death && overlay !== "pause" && overlay !== "options" && <Crosshair scale={guiScale} />}
      <GuiRoot guiScale={settings.guiScale}>
        {playing && hud && !hideGui && <Hud state={hud} title={title} hurtAt={hurtAt} />}
        {playing && debug && hud?.debug && <DebugOverlay lines={hud.debug} width={Math.ceil(w / guiScale)} />}
        {playing && !death && (
          <div style={{ pointerEvents: overlay === "chat" ? "auto" : "none" }}>
            <Chat
              messages={messages}
              open={overlay === "chat"}
              initial={chatInit}
              complete={(line) => (g ? completeCommand(g.ctx, line) : [])}
              onSend={(line) => {
                const t = line.trim();
                if (!t) return;
                if (t.startsWith("/")) for (const out of gameRef.current?.command(t) ?? []) addChat(out);
                else addChat(`<Player> ${t}`);
              }}
              onClose={() => {
                setOverlay(null);
                gameRef.current?.setInputBlocked(false);
                gameRef.current?.lock();
              }}
            />
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
            <PauseScreen onResume={resume} onOptions={() => setOverlay("options")} onQuit={() => void quit()} />
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
            <LoadingScreen progress={loading ?? 0} title="Loading terrain..." status={meta?.name} />
          </div>
        )}
      </GuiRoot>
    </>
  );
}
