"use client";
// UI lab: every screen with mock data. ?s=<screen>&touch=1&bar=0, or ?app=1 for the real App.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Device, GameEvent, HudFrame, HudHandle, HudSnapshot, QuestState, Settings } from "../../contracts";
import { LAKE, LANDMARKS, MOUNTAIN, WORLD } from "../../contracts";
import { App } from "../../ui-app";
import { Book, type BookTab } from "../../ui-book";
import { Hud } from "../../ui-hud";
import { InkDefs } from "../../ui-ink";
import type { MapData } from "../../ui-map";
import { bookPages } from "../../ui-pages";
import { DeathScreen, EndingScreen, LoadingScreen, ReadPanel, RotatePrompt, TitleScreen } from "../../ui-screens";
import type { LoreEntry, UiPrefs } from "../../ui-store";

const SCREENS = [
  "title", "title-save", "title-settings", "title-controls", "title-credits", "loading",
  "hud", "hud-combat", "hud-boss", "hud-trial", "hud-lowhp", "hud-events", "read",
  "journal", "lore", "map", "settings", "controls", "death", "ending", "rotate",
] as const;
type LabScreen = (typeof SCREENS)[number];

const SETTINGS: Settings = { quality: "auto", dynamicRes: true, master: 0.8, music: 0.6, sfx: 0.9, lookSens: 1, invertY: false, touchScale: 1, showFps: false };

const QUEST: QuestState = { stage: "beacons", beacons: [true, false, true, false], trial: -1, barrierDown: false, wardenDefeated: false, visited: ["shrine", "village", "whisperwood", "cliffs", "beacon-cliff", "lake", "beacon-lake"] };

const LORE: LoreEntry[] = [
  { title: "The Shrine Stone", text: "Four flames once ringed the island. When the gloam rose from the mountain, the keepers carried each flame to a high place and waited for someone to return." },
  { title: "A Fisher's Note", text: "The lake swallowed the old pier in a single night. Push the stones, my grandmother said, and the water remembers where the path was." },
  { title: "Carved in the Cliff", text: "Climb while the wind is with you. Rest where the rock is warm." },
];

function baseSnap(over: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    hp: 20, maxHp: 24, shards: 2, glimmers: 347, arrows: 18, hasBow: true, beacons: [true, false, true, false],
    objective: "Light the Thornring Beacon in Whisperwood", area: "Whisperwood", timeOfDay: 16.5, weather: "clear",
    prompt: null, boss: null, trial: null, device: "keys", fps: 60, scale: 1, quality: "high", ...over,
  };
}

function noise(x: number, z: number) {
  return Math.sin(x * 0.021 + Math.cos(z * 0.017) * 2) * Math.cos(z * 0.019 - Math.sin(x * 0.013)) ;
}

/** Stand-in terrain shaped like the contract's island, for painting the map. */
function labHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const coast = WORLD.islandR + noise(x * 2, z * 2) * 40;
  if (r > coast) return WORLD.oceanFloor * Math.min(1, (r - coast) / 80);
  let h = 6 + Math.min(1, (coast - r) / 60) * 10 + noise(x, z) * 6;
  const dm = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
  if (dm < MOUNTAIN.baseR) h += MOUNTAIN.peak * Math.pow(1 - dm / MOUNTAIN.baseR, 1.4);
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r * 1.4) h = Math.min(h, LAKE.level - LAKE.depth + (dl / LAKE.r) * 12 + 20);
  const dc = Math.hypot(x - 370, z - 110);
  if (dc < 130) h += 40 * (1 - dc / 130);
  return h;
}

function fakeFrame(t: number, kind: LabScreen, w: number, h: number): HudFrame {
  const heading = (t * 0.08) % (Math.PI * 2);
  const beacons = LANDMARKS.filter((l) => l.id.startsWith("beacon")).concat(LANDMARKS.filter((l) => l.id === "spire"));
  const px = -120, pz = 60;
  const markers = beacons.map((l, i) => ({ bearing: Math.atan2(l.x - px, -(l.z - pz)), dist: Math.hypot(l.x - px, l.z - pz), lit: i === 0 || i === 2, on: i < 4 || kind === "hud-boss" }));
  const combat = kind === "hud-combat" || kind === "hud-boss";
  const stam = kind === "hud-lowhp" ? 0.18 : 0.5 + 0.5 * Math.sin(t * 0.6);
  return {
    stamina: stam, staminaShow: kind !== "hud-boss", exhausted: kind === "hud-lowhp",
    staminaAt: { x: w * 0.5, y: h * 0.52, on: true }, heading, markers,
    lockAt: { x: w * 0.58 + Math.sin(t) * 8, y: h * 0.44, on: true }, lockOn: combat,
    charge: kind === "hud-combat" ? (t * 0.5) % 1 : 0, aiming: kind === "hud-combat" && Math.sin(t * 0.3) > 0.6,
    damageFlash: kind === "hud-lowhp" ? 0.35 + 0.25 * Math.sin(t * 3) : kind === "hud-combat" ? Math.max(0, Math.sin(t * 1.3) - 0.85) * 5 : 0,
  };
}

const P0 = { x: 0, y: 0, z: 0 };
const EVENTS: GameEvent[] = [
  { type: "areaEnter", id: "whisperwood", name: "Whisperwood", first: true },
  { type: "pickup", kind: "glimmer", amount: 5, pos: P0, id: "g1" },
  { type: "pickup", kind: "shard", amount: 1, pos: P0, id: "s1" },
  { type: "saved" },
];

export default function UiLabPage() {
  const [app, setApp] = useState<boolean | null>(null);
  useEffect(() => setApp(new URLSearchParams(location.search).get("app") === "1"), []);
  if (app === null) return null;
  return app ? <App /> : <UiLab />;
}

function UiLab() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const [s, setS] = useState<LabScreen>(() => {
    const scr = q.get("s") as LabScreen | null;
    return scr && SCREENS.includes(scr) ? scr : "title";
  });
  const [touch, setTouch] = useState(() => q.get("touch") === "1" || matchMedia("(pointer: coarse)").matches);
  const bar = q.get("bar") !== "0";
  const [settings, setSettings] = useState(SETTINGS);
  const [prefs, setPrefs] = useState<UiPrefs>(() => ({ reduceMotion: q.get("reduce") === "1" }));
  const [titleTab, setTitleTab] = useState<BookTab>("settings");
  const [bookTab, setBookTab] = useState<BookTab>("journal");
  const handle = useRef<HudHandle | null>(null);

  useEffect(() => {
    if (s === "title-settings") setTitleTab("settings");
    if (s === "title-controls") setTitleTab("controls");
    if (s === "title-credits") setTitleTab("credits");
    if (s === "journal" || s === "lore") setBookTab("journal");
    if (s === "map" || s === "settings" || s === "controls") setBookTab(s);
    const u = new URL(location.href);
    u.searchParams.set("s", s);
    history.replaceState(null, "", u);
  }, [s]);

  useEffect(() => {
    if (!s.startsWith("hud")) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      handle.current?.frame(fakeFrame((performance.now() - t0) / 1000, s, innerWidth, innerHeight));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const timers: number[] = [];
    if (s === "hud-events") EVENTS.forEach((e, i) => timers.push(window.setTimeout(() => handle.current?.event(e), 300 + i * 450)));
    if (s === "hud-trial") timers.push(window.setTimeout(() => handle.current?.event({ type: "trialStart", beacon: 1 }), 300));
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [s]);

  const device: Device = touch ? "touch" : "keys";
  const snap = useMemo(() => {
    const d = { device };
    switch (s) {
      case "hud-combat": return baseSnap({ ...d, hp: 13, prompt: null, area: "Whisperwood", weather: "rain" });
      case "hud-boss": return baseSnap({ ...d, hp: 16, beacons: [true, true, true, true], objective: "Defeat the Gloam Warden", area: "Gloam Spire", boss: { name: "The Gloam Warden", hp: 62, maxHp: 100, phase: 2 }, timeOfDay: 21 });
      case "hud-trial": return baseSnap({ ...d, trial: { beacon: 1, value: 3, total: 5 }, objective: "Defeat the bramble guard" });
      case "hud-lowhp": return baseSnap({ ...d, hp: 3, prompt: "Read", timeOfDay: 5.5 });
      case "hud-events": return baseSnap({ ...d, prompt: "Open" });
      default: return baseSnap({ ...d, prompt: "Talk" });
    }
  }, [s, device]);

  const map: MapData = useMemo(() => ({ heightAt: labHeight, player: { x: -120, z: 60 }, heading: 0.8, beacons: QUEST.beacons, visited: QUEST.visited, barrierDown: false, stage: "beacons" }), []);
  const ctx = { quest: QUEST, snap, lore: LORE, map, settings, onSettings: setSettings, prefs, onPrefs: setPrefs, device, touch };
  const isHud = s.startsWith("hud");
  const inTitle = s.startsWith("title");
  const book = s.startsWith("title-") && s !== "title-save" ? bookPages(titleTab, ctx) : ["journal", "lore", "map", "settings", "controls"].includes(s) ? bookPages(bookTab, ctx) : null;

  return (
    <main className="hm-root fixed inset-0 overflow-hidden" data-reduce={prefs.reduceMotion ? "1" : "0"}>
      <InkDefs />
      <Backdrop night={s === "hud-boss" || s === "death"} />
      {(isHud || s === "read") && <Hud snap={snap} visible touch={touch} showFps={settings.showFps} handleRef={handle} onRead={() => setS("read")} />}
      {touch && isHud && <TouchStandIn />}
      {inTitle && <TitleScreen hasSave={s !== "title"} onAction={(a) => (a === "continue" || a === "new" ? setS("loading") : setS(`title-${a}` as LabScreen))} />}
      {s.startsWith("title-") && s !== "title-save" && book && <Book tabs={["settings", "controls", "credits"]} tab={titleTab} onTab={setTitleTab} left={book.left} right={book.right} closeLabel="Back" onClose={() => setS("title-save")} />}
      {s === "loading" && <LoadingProgress />}
      {!inTitle && book && <Book tabs={["journal", "map", "settings", "controls"]} tab={bookTab} onTab={setBookTab} left={book.left} right={book.right} closeLabel="Resume" onClose={() => setS("hud")} onQuit={() => setS("title-save")} />}
      {s === "read" && <ReadPanel title={LORE[0].title} text={LORE[0].text} device={device} onClose={() => setS("hud")} />}
      {s === "death" && <DeathScreen device={device} onRekindle={() => setS("hud")} />}
      {s === "ending" && <EndingScreen stats={{ playTime: 2 * 3600 + 17 * 60 + 41, glimmers: 1284, shards: 14 }} onFree={() => setS("hud")} />}
      <RotatePrompt />
      {s === "rotate" && <div className="absolute inset-0 flex items-center justify-center text-white">Rotate prompt shows in portrait on touch screens.</div>}
      {bar && (
        <div className="absolute left-1/2 top-1 z-[60] flex max-w-[96vw] -translate-x-1/2 flex-wrap justify-center gap-1 rounded bg-black/70 p-1 font-mono text-[10px] text-white">
          {SCREENS.map((k) => (
            <button key={k} onClick={() => setS(k)} className={`rounded px-1.5 py-0.5 ${k === s ? "bg-amber-600" : "bg-white/10"}`}>{k}</button>
          ))}
          <button onClick={() => setTouch((v) => !v)} className="rounded bg-teal-700 px-1.5 py-0.5">touch {touch ? "on" : "off"}</button>
          <button onClick={() => setPrefs((p) => ({ reduceMotion: !p.reduceMotion }))} className="rounded bg-teal-700 px-1.5 py-0.5">reduce {prefs.reduceMotion ? "on" : "off"}</button>
        </div>
      )}
    </main>
  );
}

function LoadingProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setP((v) => (v >= 1 ? 0 : Math.min(1, v + 0.012))), 60);
    return () => clearInterval(id);
  }, []);
  return <LoadingScreen progress={p} />;
}

/** Painted stand-in for the live 3D scene. */
function Backdrop({ night }: { night: boolean }) {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="lab-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? "#0c1c2a" : "#5f9fb0"} />
          <stop offset="0.62" stopColor={night ? "#3a2a4a" : "#f1d9a8"} />
          <stop offset="1" stopColor={night ? "#2a1f30" : "#e7b57c"} />
        </linearGradient>
        <linearGradient id="lab-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={night ? "#1f3a33" : "#7f9a55"} />
          <stop offset="1" stopColor={night ? "#0e1f1c" : "#3d5a34"} />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#lab-sky)" />
      <circle cx="1180" cy="330" r="60" fill={night ? "#d8d2ff" : "#fff1c8"} opacity="0.75" />
      <path d="M0 560 L260 470 L420 520 L640 300 L760 250 L880 300 L1100 500 L1320 460 L1600 540 V900 H0Z" fill={night ? "#2c2b45" : "#8a9bb0"} opacity="0.85" />
      <path d="M720 268 L760 160 L800 268Z" fill={night ? "#5b3a6e" : "#4a4060"} />
      <path d="M0 640 Q300 580 600 630 T1200 610 T1600 640 V900 H0Z" fill="url(#lab-ground)" />
      <path d="M0 760 Q400 700 800 750 T1600 730 V900 H0Z" fill={night ? "#0b1816" : "#2f4a2a"} />
      {Array.from({ length: 18 }, (_, i) => (
        <path key={i} d={`M${60 + i * 92} ${700 + (i % 3) * 18} l22 -90 l22 90Z`} fill={night ? "#0a1614" : "#28402a"} />
      ))}
    </svg>
  );
}

/** Rough copy of input-camera's touch layout, so overlap is visible in the lab. */
function TouchStandIn() {
  const b = (right: string, bottom: string, size: string, label: string) => (
    <div className="absolute flex items-center justify-center rounded-full border border-white/40 bg-black/25 text-[11px] text-white/80" style={{ right, bottom, width: size, height: size }}>{label}</div>
  );
  return (
    <div className="pointer-events-none absolute inset-0" style={{ paddingRight: "env(safe-area-inset-right)" }}>
      <div className="absolute rounded-full border border-white/25" style={{ left: "8%", bottom: "12%", width: "26vh", height: "26vh" }} />
      {b("calc(4% + env(safe-area-inset-right))", "8%", "17vh", "A")}
      {b("calc(4% + 19vh + env(safe-area-inset-right))", "5%", "14vh", "B")}
      {b("calc(4% + 2vh + env(safe-area-inset-right))", "calc(8% + 19vh)", "14vh", "X")}
      {b("calc(4% + 19vh + env(safe-area-inset-right))", "calc(5% + 17vh)", "12vh", "Y")}
      {b("calc(2% + env(safe-area-inset-right))", "86%", "9vh", "II")}
      {b("calc(2% + 11vh + env(safe-area-inset-right))", "86%", "9vh", "M")}
    </div>
  );
}
