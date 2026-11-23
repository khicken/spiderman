"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeathCause, Device, Game, GameEvent, GameV2, HudFrame, HudHandle, HudSnapshot, LanternPower, Settings, TrackTarget, V3 } from "./contracts";
import { BEACON_POWER } from "./contracts";
import { startGame } from "./game";
import { clearSave, readSave, readSettings, writeSettings } from "./state";
import { Book, type BookTab } from "./ui-book";
import { Hud } from "./ui-hud";
import { InkDefs } from "./ui-ink";
import type { MapData, MapPick } from "./ui-map";
import { navigate, type NavDir } from "./ui-nav";
import { bookPages } from "./ui-pages";
import { DeathScreen, EndingScreen, LoadingScreen, ReadPanel, RotatePrompt, TitleScreen, type TitleAction } from "./ui-screens";
import { addLore, clearLore, clearUiProgress, endStats, readUiProgress, osReducedMotion, readLore, readPrefs, writePrefs, type EndStats, type LoreEntry, type UiPrefs } from "./ui-store";

type Screen = "title" | "loading" | "play" | "paused" | "dead" | "ending";
const GAME_TABS: readonly BookTab[] = ["journal", "map", "settings", "controls"];
const TITLE_TABS: readonly BookTab[] = ["settings", "controls", "credits"];
const MIN_LOADING_MS = 650;

export function App() {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const hudHandle = useRef<HudHandle | null>(null);
  const heading = useRef(0);
  const resumeAt = useRef(0);
  const keyAt = useRef(0);

  const [screen, setScreen] = useState<Screen>("title");
  const [titleTab, setTitleTab] = useState<BookTab | null>(null);
  const [bookTab, setBookTab] = useState<BookTab>("journal");
  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  const [progress, setProgress] = useState(0);
  const [hasSave, setHasSave] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [prefs, setPrefs] = useState<UiPrefs>({ reduceMotion: false });
  const [lore, setLore] = useState<LoreEntry[]>([]);
  const [read, setRead] = useState<LoreEntry | null>(null);
  const [stats, setStats] = useState<EndStats>({ playTime: 0, glimmers: 0, shards: 0 });
  const [busy, setBusy] = useState(false);
  const [touchPlatform, setTouchPlatform] = useState(false);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [deathWhere, setDeathWhere] = useState("");
  const [deathCause, setDeathCause] = useState<DeathCause | undefined>(undefined);
  const [selected, setSelected] = useState<MapPick | null>(null);
  const [credits, setCredits] = useState("");
  const [tracked, setTracked] = useState<TrackTarget | undefined>(undefined);

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const readRef = useRef(read);
  readRef.current = read;
  const titleTabRef = useRef(titleTab);
  titleTabRef.current = titleTab;
  const bookTabRef = useRef(bookTab);
  bookTabRef.current = bookTab;
  const resumeRef = useRef<() => void>(() => {});

  const ui = (cue: "move" | "ok" | "back" | "open" | "close" | "error") => {
    try {
      gameRef.current?.audio?.ui(cue);
    } catch {}
  };

  const openBook = useCallback((tab: BookTab) => {
    const g = gameRef.current;
    if (!g || screenRef.current !== "play" || readRef.current) return;
    if (performance.now() - resumeAt.current < 300) return;
    g.pause(true);
    g.input.setTouchVisible(false);
    setBookTab(tab);
    setScreen("paused");
    ui("open");
  }, []);

  useEffect(() => {
    setHasSave(readSave() !== null);
    const pr = readPrefs();
    setPrefs(pr);
    if (pr.reduceMotion) setSettings((s) => (s.reduceMotion ? s : { ...s, reduceMotion: true }));
    setLore(readLore());
    const canvas = canvasRef.current!, overlay = overlayRef.current!;
    const relay: HudHandle = {
      frame(f: HudFrame) {
        heading.current = f.heading;
        hudHandle.current?.frame(f);
      },
      event(e: GameEvent) {
        hudHandle.current?.event(e);
      },
    };
    const game = startGame(
      canvas,
      overlay,
      {
        hud: setSnap,
        hudRef: () => relay,
        progress: setProgress,
        pause: () => openBook("journal"),
        map: () => openBook("map"),
        died: (where?: string, cause?: DeathCause) => {
          setDeathWhere(where ?? "");
          setDeathCause(cause);
          game.pause(true);
          game.input.setTouchVisible(false);
          setRead(null);
          setScreen("dead");
        },
        ending: () => {
          game.pause(true);
          game.input.setTouchVisible(false);
          let s = null;
          try {
            s = game.save();
          } catch {}
          setStats(endStats(s, null));
          setScreen("ending");
        },
      },
      readSettings(),
    );
    gameRef.current = game;
    game.menuCamera(true);
    setTouchPlatform(game.platform.touch);
    game.input.setTouchVisible(false);

    const offNav = game.input.onNav((d) => onNavRef.current(d));
    const onKey = (e: KeyboardEvent) => {
      keyAt.current = performance.now();
      if ((e.code === "KeyM" || e.code === "KeyP") && !e.repeat && screenRef.current === "paused" && !readRef.current && performance.now() - resumeAt.current > 200) {
        const t = e.target as HTMLElement | null;
        if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
        if (e.code === "KeyM" ? bookTabRef.current === "map" : true) resumeRef.current();
      }
    };
    const onFirst = () => {
      game.unlockAudio();
      if (screenRef.current === "title") game.audio?.menuMusic(true);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onFirst, { once: true });
    window.addEventListener("keydown", onFirst, { once: true });
    return () => {
      offNav();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
      game.dispose();
      gameRef.current = null;
    };
  }, [openBook]);

  const heightAt = useMemo(() => (x: number, z: number) => gameRef.current?.world.heightAt(x, z) ?? -30, []);
  const v3 = useRef<V3>({ x: 0, y: 0, z: 0 });
  useEffect(() => {
    const g = gameRef.current;
    if (screen !== "paused" || !g) return;
    const p = g.playerPos(v3.current);
    const q = g.quest;
    setMapData({ heightAt, player: { x: p.x, z: p.z }, heading: heading.current, beacons: [...q.beacons], visited: [...q.visited], barrierDown: q.barrierDown, stage: q.stage, gladeLit: q.gladeLit, waystones: q.waystones ? [...q.waystones] : [] });
    setTracked(q.tracked);
    setSelected(null);
  }, [screen, heightAt]);

  useEffect(() => {
    if (!titleTab || titleTab !== "credits" || credits) return;
    let off = false;
    Promise.all(["/zelda/sfx/CREDITS.md", "/zelda/music/CREDITS.md"].map((u) => fetch(u).then((r) => (r.ok ? r.text() : "")).catch(() => ""))).then((t) => {
      if (!off) setCredits(t.filter(Boolean).join("\n\n") || "No asset credits found.");
    });
    return () => {
      off = true;
    };
  }, [titleTab, credits]);

  const resume = () => {
    const g = gameRef.current;
    if (!g) return;
    resumeAt.current = performance.now();
    g.pause(false);
    g.input.setTouchVisible(g.platform.touch);
    setScreen("play");
    ui("close");
  };
  resumeRef.current = resume;

  const begin = async (cont: boolean) => {
    const g = gameRef.current;
    if (!g || busy) return;
    setBusy(true);
    g.unlockAudio();
    g.audio?.menuMusic(false);
    ui("ok");
    if (!cont) {
      clearSave();
      clearLore();
      clearUiProgress();
      setLore([]);
    }
    setProgress(0);
    setTitleTab(null);
    setScreen("loading");
    const t0 = performance.now();
    try {
      await g.start(cont ? readSave() : null);
    } catch (err) {
      console.error(err);
      // a half-started world is not playable: go back to the title instead of a dead play screen
      g.pause(true);
      g.menuCamera(true);
      g.audio?.menuMusic(true);
      setHasSave(readSave() !== null);
      setScreen("title");
      setBusy(false);
      return;
    }
    const wait = MIN_LOADING_MS - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    resumeAt.current = performance.now();
    g.pause(false);
    g.input.setTouchVisible(g.platform.touch);
    setScreen("play");
    setBusy(false);
  };

  const quit = () => {
    const g = gameRef.current;
    if (!g) return;
    try {
      g.save();
    } catch {}
    g.pause(true);
    g.input.setTouchVisible(false);
    setHasSave(readSave() !== null);
    setScreen("title");
    g.menuCamera(true);
    g.audio?.menuMusic(true);
    ui("back");
  };

  const onTitle = (a: TitleAction) => {
    if (a === "continue") void begin(true);
    else if (a === "new") void begin(false);
    else {
      ui("open");
      setTitleTab(a);
    }
  };

  const onSettings = (s: Settings) => {
    if (s.reduceMotion !== settings.reduceMotion) onPrefs({ ...prefs, reduceMotion: s.reduceMotion });
    setSettings(s);
    writeSettings(s);
    gameRef.current?.setSettings(s);
  };
  const onPrefs = (p: UiPrefs) => {
    setPrefs(p);
    writePrefs(p);
  };

  const onRead = useCallback((title: string, text: string) => {
    const g = gameRef.current;
    if (!g || screenRef.current !== "play") return;
    g.pause(true);
    g.input.setTouchVisible(false);
    setLore(addLore({ title, text }));
    setRead({ title, text });
    ui("open");
  }, []);
  const closeRead = () => {
    setRead(null);
    resume();
  };

  const onTrack = (t: TrackTarget) => {
    const g = gameRef.current as GameV2 | null;
    if (!g) return;
    if (typeof g.track === "function") g.track(t);
    setTracked(t);
    ui("ok");
  };
  const onTravel = (id: string) => {
    const g = gameRef.current as GameV2 | null;
    if (!g || typeof g.travel !== "function") return;
    g.travel(id);
    resume();
  };
  const onChoose = (c: "keeper" | "sky") => {
    const g = gameRef.current as GameV2 | null;
    if (g && typeof g.chooseEnding === "function") g.chooseEnding(c);
    ui("ok");
  };

  const rekindle = () => {
    const g = gameRef.current;
    if (!g) return;
    resumeAt.current = performance.now();
    g.respawn();
    g.input.setTouchVisible(g.platform.touch);
    setScreen("play");
    ui("ok");
  };

  const onNavRef = useRef<(d: NavDir) => void>(() => {});
  onNavRef.current = (d: NavDir) => {
    const s = screenRef.current;
    const keyboard = performance.now() - keyAt.current < 60;
    if (d === "back") {
      if (readRef.current) closeRead();
      else if (s === "paused") resume();
      else if (s === "title" && titleTabRef.current) {
        setTitleTab(null);
        ui("back");
      }
      return;
    }
    if (s === "play" && !readRef.current) return;
    if (navigate(rootRef.current, d, keyboard) && d !== "ok") ui("move");
  };

  const device: Device = snap?.device ?? (touchPlatform ? "touch" : "keys");
  const touch = device === "touch" || (touchPlatform && device !== "pad");
  const reduce = settings.reduceMotion || prefs.reduceMotion || osReducedMotion();

  const gv2 = gameRef.current as GameV2 | null;
  const uiProg = screen === "paused" ? readUiProgress() : { secrets: [], memories: [] };
  const q0 = gameRef.current?.quest ?? null;
  const litPowers = (q0?.beacons ?? []).flatMap((on, i) => (on ? [BEACON_POWER[i]] : []));
  const powers: LanternPower[] = gv2?.progress?.powers ?? litPowers;
  const wickOil = gv2?.progress?.wickOil ?? Math.max(0, (snap?.wick ?? 0) - 2);
  const memories = Array.from(new Set([...(q0?.memories ?? []), ...uiProg.memories]));
  const pageCtx = {
    collect: { wickOil, powers, memories, secrets: uiProg.secrets.length },
    selected,
    onSelect: setSelected,
    onTrack,
    onTravel,
    tracked,
    credits: credits || "Loading credits.",
    quest: gameRef.current?.quest ?? null,
    snap,
    lore,
    map: mapData,
    settings,
    onSettings,
    prefs,
    onPrefs,
    device,
    touch: touchPlatform,
  };

  const book = screen === "paused" ? bookPages(bookTab, pageCtx) : titleTab ? bookPages(titleTab, pageCtx) : null;

  return (
    <main ref={rootRef} className="hm-root fixed inset-0 overflow-hidden" data-reduce={reduce ? "1" : "0"} data-screen={screen}>
      <InkDefs />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <Hud snap={snap} visible={screen === "play" && !read} touch={touch} showFps={settings.showFps} subtitles={settings.subtitles || settings.voice === 0} hints={settings.hints} handleRef={hudHandle} onRead={onRead} />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />

      {screen === "title" && <TitleScreen hasSave={hasSave} onAction={onTitle} busy={busy} />}
      {screen === "title" && titleTab && book && (
        <Book tabs={TITLE_TABS} tab={titleTab} onTab={(t) => { setTitleTab(t); ui("move"); }} left={book.left} right={book.right} closeLabel="Back" onClose={() => { setTitleTab(null); ui("back"); }} />
      )}
      {screen === "loading" && <LoadingScreen progress={progress} />}
      {screen === "paused" && book && (
        <Book tabs={GAME_TABS} tab={bookTab} onTab={(t) => { setBookTab(t); ui("move"); }} left={book.left} right={book.right} closeLabel="Resume" onClose={resume} onQuit={quit} />
      )}
      {read && <ReadPanel title={read.title} text={read.text} device={device} onClose={closeRead} />}
      {screen === "dead" && <DeathScreen device={device} cause={deathCause} where={deathWhere || snap?.checkpointName || "the last beacon you lit"} onContinue={rekindle} />}
      {screen === "ending" && <EndingScreen stats={stats} onFree={resume} onChoose={onChoose} />}
      <RotatePrompt />
    </main>
  );
}
