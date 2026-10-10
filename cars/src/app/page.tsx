"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CARS } from "./cars";
import type { Entrant, HudState, Lobby as LobbyState, MapId, Standing } from "./contracts";
import { startGame, type Game } from "./game";
import { MAPS } from "./maps";
import { cleanRoomCode, createNet, newRoomCode, type NetPlus } from "./net";
import { detectQuality } from "./render";
import { ControlHint, Hud, Results, type HudHandle } from "./ui-hud";
import { mapCard, type MapCard } from "./ui-kit";
import { Loading } from "./ui-loading";
import { Lobby, type LobbyPlayer } from "./ui-lobby";
import { CarPicker, Menu, type MenuPick, type MenuStep } from "./ui-menu";
import { nav, type NavDir } from "./ui-nav";
import { Pause } from "./ui-pause";
import { DEFAULT_SETTINGS, SettingsPanel, type Settings } from "./ui-settings";
import { RotateHint, TouchControls, isPhone, useIsTouch } from "./ui-touch";

type Screen = "menu" | "loading" | "lobby" | "lobbyCar" | "race" | "pause" | "results";

const SETTINGS_KEY = "cars-settings";
const PICK_KEY = "cars-pick";
const NAME_KEY = "cars-name";
const HINT_KEY = "cars-hint";
const AI_FIELD = 7;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
// Stored settings may come from an older build or a hand edit: keep each field only when it is valid.
function cleanSettings(raw: Partial<Settings>, base: Settings): Settings {
  const pick = <T,>(v: unknown, ok: readonly T[], d: T) => (ok.includes(v as T) ? (v as T) : d);
  const vol = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : d);
  const a = (raw.assists ?? {}) as Partial<Settings["assists"]>;
  const flag = (k: keyof Settings["assists"]) => (typeof a[k] === "boolean" ? a[k] : base.assists[k]);
  return {
    quality: pick(raw.quality, ["low", "medium", "high", "ultra"] as const, base.quality),
    master: vol(raw.master, base.master),
    music: vol(raw.music, base.music),
    units: pick(raw.units, ["kmh", "mph"] as const, base.units),
    camera: pick(raw.camera, ["chase", "far", "hood", "bumper", "cockpit"] as const, base.camera),
    steer: pick(raw.steer, ["slider", "tilt"] as const, base.steer),
    assists: { abs: flag("abs"), tcs: flag("tcs"), stability: flag("stability"), autoGear: flag("autoGear"), steer: flag("steer") },
  };
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const DEFAULT_PICK: MenuPick = { mode: "race", map: "monaco", car: "gt3", paint: CARS.find((c) => c.id === "gt3")!.paints[0], laps: 3 };

export default function Page() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const hudRef = useRef<HudHandle>(null);
  const netRef = useRef<NetPlus | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [step, setStep] = useState<MenuStep>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [pick, setPick] = useState<MenuPick>(DEFAULT_PICK);
  const [maps, setMaps] = useState<MapCard[]>(() => MAPS.map((m) => mapCard(m)));
  const [hud, setHud] = useState<HudState | null>(null);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ standings: readonly Standing[]; entrants: readonly Entrant[] } | null>(null);
  const [outline, setOutline] = useState<ArrayLike<number> | undefined>();
  const [room, setRoom] = useState<string | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [lobby, setLobby] = useState<LobbyState>({ map: "monaco", mode: "race", laps: 3, weather: "map", hour: "map", startAt: null, ai: 0 });
  const [host, setHost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const busyId = useRef(0);
  const touch = useIsTouch();
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const base: Settings = { ...DEFAULT_SETTINGS, quality: isPhone() ? "low" : detectQuality() };
    const s = cleanSettings(load<Partial<Settings>>(SETTINGS_KEY, {}), base);
    const p = load<MenuPick>(PICK_KEY, DEFAULT_PICK);
    setSettings(s);
    setPick(p);
    const g = startGame(
      canvas.current!,
      {
        hud: setHud,
        hudRef: () => hudRef.current,
        progress: setProgress,
        pause: () => {
          if (screenRef.current === "race") {
            game.current?.pause(true);
            setScreen("pause");
          } else if (screenRef.current === "pause") {
            game.current?.pause(false);
            setScreen("race");
          }
        },
        finished: () => {
          setResults({ standings: g.standings().map((s) => ({ ...s })), entrants: g.entrants() });
          setScreen("results");
        },
      },
      s,
    );
    game.current = g;
    const roomParam = cleanRoomCode(new URLSearchParams(location.search).get("room") ?? "");
    let dead = false;
    void g.showroom(p.map, p.car, p.paint).then(() => {
      if (dead) return;
      if (roomParam) joinRoom(roomParam);
      for (const m of MAPS)
        void m.load().then((d) => !dead && setMaps((l) => l.map((c) => (c.id === m.id ? mapCard(m, d) : c))));
    });
    const gesture = () => g.audioOn();
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    return () => {
      dead = true;
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
      netRef.current?.leave();
      g.dispose();
      game.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useGamepadNav(screen !== "race");

  useEffect(() => {
    if (!touch || screen !== "race") return;
    const check = () => {
      if (innerHeight > innerWidth) {
        game.current?.pause(true);
        setScreen("pause");
      }
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [touch, screen]);

  // Cars still racing finish after the results open, so keep the table live.
  useEffect(() => {
    if (screen !== "results") return;
    const t = setInterval(() => {
      const g = game.current;
      if (g) setResults({ standings: g.standings().map((s) => ({ ...s })), entrants: g.entrants() });
    }, 500);
    return () => clearInterval(t);
  }, [screen]);

  const changeSettings = (s: Settings) => {
    setSettings(s);
    save(SETTINGS_KEY, s);
    game.current?.setSettings(s);
  };

  const onPick = (p: MenuPick) => {
    const prev = pickRef.current;
    setPick(p);
    save(PICK_KEY, p);
    const g = game.current;
    if (!g) return;
    if (p.map !== prev.map) {
      const id = ++busyId.current;
      setBusy(true);
      void g.showroom(p.map, p.car, p.paint).finally(() => id === busyId.current && setBusy(false));
    }
    else if (p.car !== prev.car || p.paint !== prev.paint) g.setCar(p.car, p.paint);
  };

  const begin = useCallback(async (p: MenuPick, net?: NetPlus, startAt?: number) => {
    const g = game.current;
    if (!g) return;
    setResults(null);
    setHud(null);
    setProgress(0);
    setScreen("loading");
    await g.play({ map: p.map, mode: p.mode, laps: p.laps, car: p.car, paint: p.paint, ai: AI_FIELD, net, startAt });
    setOutline(g.outline);
    setScreen("race");
    if (!load(HINT_KEY, { seen: false }).seen) {
      save(HINT_KEY, { seen: true });
      setHint(true);
      setTimeout(() => setHint(false), 4000);
    }
  }, []);

  const toMenu = useCallback(() => {
    const g = game.current;
    netRef.current?.leave();
    netRef.current = null;
    setRoom(null);
    history.replaceState(null, "", location.pathname);
    g?.quit();
    g?.pause(false);
    setScreen("menu");
    setStep("home");
    const p = pickRef.current;
    void g?.showroom(p.map, p.car, p.paint);
  }, []);

  function joinRoom(code: string) {
    const p = pickRef.current;
    const name = load<{ n: string }>(NAME_KEY, { n: `Driver ${Math.floor(Math.random() * 90 + 10)}` }).n;
    const me: Entrant = { id: "", name, color: p.paint, car: p.car, me: true, ai: false };
    const net = createNet(code, me);
    netRef.current = net;
    setRoom(code);
    const q = new URLSearchParams(location.search);
    q.set("room", code);
    history.replaceState(null, "", `${location.pathname}?${q}`);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __net: NetPlus }).__net = net;
    setScreen("lobby");
    const sync = () => {
      setPlayers(net.peers.map((e) => {
        const l = net.link(e.id);
        return { ...e, host: e.id === net.hostId, ping: l?.ping ?? null, relay: l?.relay ?? false };
      }));
      setHost(net.host);
      if (net.lobby) setLobby(net.lobby);
    };
    sync();
    const timer = setInterval(sync, 1000);
    let started: number | null = null;
    net.on((e) => {
      sync();
      if (e.type === "join") game.current?.sfx("join");
      if (e.type === "leave") game.current?.sfx("leave");
      if (e.type === "lobby" && e.lobby.startAt != null && e.lobby.startAt !== started && net.onGrid()) {
        started = e.lobby.startAt;
        const l = e.lobby;
        const next = { ...pickRef.current, map: l.map, mode: l.mode, laps: l.laps };
        setPick(next);
        void begin(next, net, l.startAt!);
      }
    });
    const leave = net.leave.bind(net);
    net.leave = () => {
      clearInterval(timer);
      leave();
    };
  }

  const goOnline = () => {
    joinRoom(newRoomCode());
  };

  const startOnline = () => {
    const net = netRef.current;
    if (!net?.host) return;
    net.start(lobby, pickRef.current.car);
  };

  const setLobbyHost = (l: LobbyState) => {
    setLobby(l);
    netRef.current?.setLobby({ ...l, startAt: null });
  };

  const setName = (n: string) => {
    save(NAME_KEY, { n });
    const net = netRef.current;
    if (!net) return;
    const mine = net.peers.find((p) => p.me);
    if (mine) net.setMe({ ...mine, name: n });
  };

  const current = maps.find((m) => m.id === pick.map) ?? maps[0];

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-night">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />

      {screen === "menu" && !settingsOpen && (
        <Menu
          cars={CARS}
          maps={maps}
          pick={pick}
          step={step}
          onStep={setStep}
          onPick={onPick}
          onGo={(p) => void begin(p)}
          onOnline={goOnline}
          onSettings={() => setSettingsOpen(true)}
          mph={settings.units === "mph"}
        />
      )}

      {screen === "loading" && <Loading map={current} progress={progress} mph={settings.units === "mph"} />}

      {screen === "lobby" && room && !settingsOpen && (
        <Lobby
          room={room}
          players={players}
          lobby={lobby}
          host={host}
          maps={maps}
          cars={CARS}
          onName={setName}
          onLobby={setLobbyHost}
          onStart={startOnline}
          onLeave={toMenu}
          onCar={() => setScreen("lobbyCar")}
        />
      )}

      {screen === "lobbyCar" && (
        <CarPicker
          cars={CARS}
          pick={pick}
          onPick={(p) => {
            onPick(p);
            const net = netRef.current;
            const mine = net?.peers.find((x) => x.me);
            if (net && mine) net.setMe({ ...mine, car: p.car, color: p.paint });
          }}
          onBack={() => setScreen("lobby")}
          onGo={() => setScreen("lobby")}
        />
      )}

      {(screen === "race" || screen === "pause") && hud && (
        <Hud ref={hudRef} h={hud} units={settings.units} outline={outline} touch={touch} />
      )}

      {screen === "race" && hint && hud && <ControlHint device={touch ? "touch" : hud.device} />}

      {screen === "menu" && busy && (
        <span className="pointer-events-none absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 [animation:fade_0.2s_0.3s_both]" aria-hidden>
          <span className="block h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </span>
      )}

      {screen === "race" && touch && (
        <TouchControls
          steer={settings.steer}
          onControls={(t) => {
            if (t.held?.pause) {
              game.current?.pause(true);
              setScreen("pause");
            }
            game.current?.touch(t);
          }}
        />
      )}

      {screen === "pause" && !settingsOpen && (
        <Pause
          onResume={() => {
            game.current?.pause(false);
            setScreen("race");
          }}
          onRestart={netRef.current ? undefined : () => {
            game.current?.pause(false);
            void begin(pickRef.current);
          }}
          onSettings={() => setSettingsOpen(true)}
          onQuit={toMenu}
        />
      )}

      {screen === "results" && results && (
        <Results
          standings={results.standings}
          entrants={results.entrants}
          onRestart={netRef.current ? undefined : () => void begin(pickRef.current)}
          onNext={
            netRef.current
              ? undefined
              : () => {
                  const i = MAPS.findIndex((m) => m.id === pickRef.current.map);
                  const next: MenuPick = { ...pickRef.current, map: MAPS[(i + 1) % MAPS.length].id as MapId };
                  setPick(next);
                  save(PICK_KEY, next);
                  void begin(next);
                }
          }
          onMenu={() => (netRef.current ? setScreen("lobby") : toMenu())}
        />
      )}

      {settingsOpen && <SettingsPanel value={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} device={hud?.device} />}

      {touch && <RotateHint />}
    </main>
  );
}

// D-pad and A/B drive the same focus navigation as the arrow keys, Enter and Esc.
function useGamepadNav(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    // Buttons held when the menu opens (Start that paused, A at the finish) do not fire.
    let prev: Record<string, boolean> | null = null;
    let repeatAt = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const pads = navigator.getGamepads?.() ?? [];
      const p = [...pads].find((x) => x);
      if (!p) return;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      const want: Record<NavDir, boolean> = {
        up: !!p.buttons[12]?.pressed || ay < -0.6,
        down: !!p.buttons[13]?.pressed || ay > 0.6,
        left: !!p.buttons[14]?.pressed || ax < -0.6,
        right: !!p.buttons[15]?.pressed || ax > 0.6,
        ok: !!p.buttons[0]?.pressed,
        back: !!p.buttons[1]?.pressed || !!p.buttons[9]?.pressed,
      };
      if (!prev) return void (prev = { ...want });
      const now = performance.now();
      for (const d of Object.keys(want) as NavDir[]) {
        const held = want[d];
        if (held && (!prev[d] || (d !== "ok" && d !== "back" && now > repeatAt))) {
          nav(d);
          repeatAt = now + (prev[d] ? 120 : 380);
        }
        prev[d] = held;
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [on]);
}
