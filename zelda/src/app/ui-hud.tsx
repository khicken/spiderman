"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { GameEvent, HudFrame, HudHandle, HudSnapshot, ScreenPoint } from "./contracts";
import { BEACON_COLOR, PLAYER, THREAD } from "./contracts";
import { Chip, Subtitle, type ChipData, type SubtitleData } from "./ui-chips";
import { Arrow, Diamond, Flame, Glyph, HeartIcon, Quill } from "./ui-ink";
import { beaconName, btnLabel, POWER_INFO, readUiProgress, SHARD_TOTAL, TRIAL_VERB, writeUiProgress } from "./ui-store";
import { WAYSTONES } from "./contracts";

const FOV_DEG = 150;
const FOV = (FOV_DEG * Math.PI) / 180;
const TAU = Math.PI * 2;
const CARDINAL = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const MARKERS = 13; // 4 beacons, spire, glade, 7 waystones
const MAX_TOASTS = 2;
const TOAST_MS = 3000;

type Toast = { id: number; text: string; sub?: string | (() => string); icon: "shard" | "heart" | "quill" | "wick" | "seed" | "bow" | "none"; at: number };
type Banner = { id: number; title: string; sub?: string; kind: "area" | "beacon" | "gloam" | "time"; color?: string; ms: number };
type FrameExtra = HudFrame & { trackedAt?: ScreenPoint; riposteAt?: ScreenPoint };

export interface HudProps {
  snap: HudSnapshot | null;
  visible: boolean;
  touch: boolean;
  showFps: boolean;
  subtitles: boolean;
  hints: boolean;
  handleRef: MutableRefObject<HudHandle | null>;
  onRead?: (title: string, text: string) => void;
}

function norm(a: number) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}
function diff(a: number, b: number) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}
function fmtDist(d: number) {
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
}
function markerKind(i: number, kind?: string) {
  return kind ?? (i < 4 ? "beacon" : i === 4 ? "spire" : i === 5 ? "glade" : "waystone");
}

const CHIPS_SEEN_KEY = "hollowmere.chipsSeen";
function chipSeen(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(CHIPS_SEEN_KEY) ?? "[]") as string[]).includes(id); } catch { return false; }
}
function markChipSeen(id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(CHIPS_SEEN_KEY) ?? "[]") as string[];
    if (!all.includes(id)) localStorage.setItem(CHIPS_SEEN_KEY, JSON.stringify([...all, id]));
  } catch { /* storage unavailable */ }
}

export function Hud({ snap, visible, touch, showFps, subtitles, hints, handleRef, onRead }: HudProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const markerState = useRef<string[]>([]);
  const distRef = useRef<HTMLSpanElement>(null);
  const distText = useRef("");
  const worldRef = useRef<HTMLDivElement>(null);
  const worldText = useRef<HTMLSpanElement>(null);
  const stamBox = useRef<HTMLDivElement>(null);
  const stamArc = useRef<SVGCircleElement>(null);
  const lockBox = useRef<HTMLDivElement>(null);
  const lockArc = useRef<SVGCircleElement>(null);
  const aimBox = useRef<HTMLDivElement>(null);
  const aimArc = useRef<SVGCircleElement>(null);
  const threadBox = useRef<HTMLDivElement>(null);
  const arrowsRef = useRef<HTMLSpanElement>(null);
  const subBox = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  // HUD boxes the world marker must stay out of (objective column, compass, hearts/wick); rects cached every 0.5 s
  const tlRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<HTMLDivElement>(null);
  const avoid = useRef<{ at: number; rects: DOMRect[]; vw: number; vh: number }>({ at: -1e9, rects: [], vw: 1, vh: 1 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [chip, setChip] = useState<ChipData | null>(null);
  const [sub, setSub] = useState<SubtitleData | null>(null);
  const [fizzle, setFizzle] = useState<{ id: number; text: string; x: number; y: number } | null>(null);
  const [ruleCard, setRuleCard] = useState<string | null>(null);
  const [glimShown, setGlimShown] = useState(false);
  const [arrowsPulse, setArrowsPulse] = useState(false);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const optsRef = useRef({ subtitles, hints });
  optsRef.current = { subtitles, hints };
  const lastShown = useRef({ stam: "", lock: "", aim: "", thread: "", arrows: "", sub: "" });
  const aimAt = useRef({ x: 0, y: 0 });
  const subOn = useRef(false);
  const ripBox = useRef<HTMLDivElement>(null);
  const ripUntil = useRef(0);
  const ripOn = useRef(false);
  const lastBeacon = useRef(0);
  const lastRest = useRef(0);
  const rule = useRef<string | null>(null);

  const handle = useMemo<HudHandle>(() => {
    let nextId = 1;
    const prog = readUiProgress();
    const dev = () => snapRef.current?.device ?? "keys";
    const press = () => {
      const d = dev();
      return d === "touch" ? "Tap the Hand button" : `Press ${btnLabel(d, "E", "Y", "")}`;
    };
    const pushToast = (t: Omit<Toast, "id" | "at">) => {
      const now = performance.now();
      setToasts((list) => [...list.filter((x) => now - x.at < TOAST_MS), { ...t, id: nextId++, at: now }].slice(-MAX_TOASTS));
    };
    const showBanner = (b: Omit<Banner, "id">) => setBanner({ ...b, id: nextId++ });
    return {
      frame(f: FrameExtra) {
        // read layout before this frame's style writes, so the read never forces a second layout
        const nowMs = performance.now();
        if (nowMs - avoid.current.at > 500) {
          avoid.current.at = nowMs;
          avoid.current.vw = window.innerWidth;
          avoid.current.vh = window.innerHeight;
          avoid.current.rects = [tlRef.current, compassRef.current, trRef.current].filter((e): e is HTMLDivElement => !!e).map((e) => e.getBoundingClientRect());
        }
        const strip = stripRef.current;
        const h = norm(f.heading) / TAU;
        if (strip) strip.style.transform = `translateX(${-((1 + h) / 3 - FOV_DEG / 2160) * 100}%)`;

        let tracked = -1;
        const n = Math.min(MARKERS, f.markers.length);
        for (let i = 0; i < n; i++) {
          if (f.markers[i].tracked) {
            tracked = i;
            break;
          }
        }
        if (tracked < 0)
          for (let i = 0; i < n; i++) {
            const m = f.markers[i];
            const k = markerKind(i, m.kind);
            if (m.on && !m.lit && (k === "beacon" || k === "glade" || k === "spire")) {
              tracked = i;
              break;
            }
          }
        let trackedX = 50;
        for (let i = 0; i < MARKERS; i++) {
          const el = markerRefs.current[i];
          const m = f.markers[i];
          if (!el) continue;
          if (!m || !m.on) {
            if (markerState.current[i] !== "off") {
              el.style.opacity = "0";
              markerState.current[i] = "off";
            }
            continue;
          }
          const d = diff(m.bearing, f.heading);
          const raw = 50 + (d / FOV) * 100;
          const x = raw < 4 ? 4 : raw > 96 ? 96 : raw;
          el.style.left = `${x}%`;
          const state = `${i === tracked ? "t" : m.lit ? "l" : "d"}${raw < 4 || raw > 96 ? "e" : ""}`;
          if (markerState.current[i] !== state) {
            markerState.current[i] = state;
            el.style.opacity = raw < 4 || raw > 96 ? "0.5" : "1";
            el.dataset.tr = i === tracked ? "1" : "0";
            el.dataset.lit = m.lit ? "1" : "0";
            el.style.zIndex = i === tracked ? "2" : "1";
          }
          if (i === tracked) trackedX = x;
        }
        const dl = distRef.current;
        if (dl) {
          if (tracked >= 0) {
            const t = fmtDist(f.trackedDist ?? f.markers[tracked].dist);
            if (t !== distText.current) {
              distText.current = t;
              dl.textContent = t;
              if (worldText.current) worldText.current.textContent = t;
            }
            dl.style.left = `${trackedX < 10 ? 10 : trackedX > 90 ? 90 : trackedX}%`;
            dl.style.opacity = "1";
          } else dl.style.opacity = "0";
        }
        const wm = worldRef.current;
        if (wm) {
          const on = tracked >= 0 && !!f.trackedAt?.on;
          if (on) {
            // keep the marker inside a safe inset and out of the HUD boxes: slide it below any box it lands in
            const { vw, vh } = avoid.current;
            const HW = 34, HH = 24, PAD = 8;
            let x = Math.min(vw - HW - PAD, Math.max(HW + PAD, f.trackedAt!.x));
            let y = Math.min(vh - HH - PAD, Math.max(HH + PAD, f.trackedAt!.y));
            for (let pass = 0; pass < 2; pass++) for (const r of avoid.current.rects) {
              if (r.width > 0 && x > r.left - HW && x < r.right + HW && y > r.top - HH && y < r.bottom + HH) y = r.bottom + HH + PAD;
            }
            wm.style.transform = `translate(${x}px, ${y}px)`;
          }
          const key = on ? "1" : "0";
          if (wm.dataset.on !== key) {
            wm.dataset.on = key;
            wm.style.opacity = key;
          }
        }

        const sb = stamBox.current, sa = stamArc.current;
        if (sb && sa) {
          const show = f.staminaShow && f.staminaAt.on;
          const key = show ? "1" : "0";
          if (lastShown.current.stam !== key) {
            sb.style.opacity = key;
            lastShown.current.stam = key;
          }
          if (show) {
            sb.style.transform = `translate(${f.staminaAt.x + 26}px, ${f.staminaAt.y - 40}px)`;
            sa.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, f.stamina)) * 100);
            sa.style.stroke = f.exhausted ? "var(--color-rubric)" : f.stamina < 0.3 ? "var(--color-ember)" : "var(--color-gold-hi)";
          }
        }
        const lb = lockBox.current;
        if (lb) {
          const on = f.lockOn && f.lockAt.on;
          const key = on ? "1" : "0";
          if (lastShown.current.lock !== key) {
            lb.style.opacity = key;
            lastShown.current.lock = key;
          }
          if (on) lb.style.transform = `translate(${f.lockAt.x}px, ${f.lockAt.y}px)`;
          if (lockArc.current) lockArc.current.style.strokeDashoffset = String(100 - f.charge * 100);
        }
        const ab = aimBox.current;
        if (ab) {
          const key = f.aiming ? "1" : "0";
          if (lastShown.current.aim !== key) {
            ab.style.opacity = key;
            lastShown.current.aim = key;
          }
          if (aimArc.current) aimArc.current.style.strokeDashoffset = String(100 - f.charge * 100);
        }
        const ar = arrowsRef.current;
        if (ar) {
          const key = f.aiming ? "1" : "0";
          if (lastShown.current.arrows !== key) {
            ar.dataset.aim = key;
            lastShown.current.arrows = key;
          }
        }
        const tb = threadBox.current, ta = f.threadAim;
        if (tb) {
          const show = !!ta && ta.at.on && (ta.reason !== "none" || ta.pending);
          const key = show ? `${ta!.valid ? "v" : "x"}${ta!.pending ? "p" : ""}` : "";
          if (lastShown.current.thread !== key) {
            lastShown.current.thread = key;
            tb.style.opacity = show ? "1" : "0";
            tb.dataset.valid = show && ta!.valid ? "1" : "0";
            tb.dataset.pending = show && ta!.pending ? "1" : "0";
          }
          if (show) tb.style.transform = `translate(${ta!.at.x}px, ${ta!.at.y}px)`;
        }
        if (ta?.at.on) {
          aimAt.current.x = ta.at.x;
          aimAt.current.y = ta.at.y;
        }
        const sx = subBox.current;
        if (sx) {
          const key = subOn.current ? "1" : "0";
          if (lastShown.current.sub !== key) {
            lastShown.current.sub = key;
            sx.style.opacity = key;
          }
          if (subOn.current) {
            const coarse = window.matchMedia("(pointer: coarse)").matches;
            sx.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight - (coarse ? 70 : 120)}px) translate(-50%, -100%)`;
          }
        }
        const rb = ripBox.current;
        if (rb) {
          const on = performance.now() < ripUntil.current;
          const at = f.riposteAt?.on ? f.riposteAt : f.lockOn && f.lockAt.on ? f.lockAt : null;
          const show = on && !!at;
          if (show !== ripOn.current) {
            ripOn.current = show;
            rb.style.opacity = show ? "1" : "0";
          }
          if (show) rb.style.transform = `translate(${at!.x}px, ${at!.y - 44}px)`;
        }
        if (vignette.current) vignette.current.style.opacity = String(f.damageFlash);
      },
      event(e: GameEvent) {
        const now = performance.now();
        const d = dev();
        const s = snapRef.current;
        switch (e.type) {
          case "areaEnter":
            showBanner({ title: e.name, sub: e.first ? "Discovered" : undefined, kind: "area", ms: 2600 });
            break;
          case "beaconLit": {
            lastBeacon.current = now;
            const n = Math.min(4, (s?.shards ?? 0) + 1);
            showBanner({ title: `${beaconName(e.beacon)} lit`, sub: `You got a heart shard (${n}/4)`, kind: "beacon", color: BEACON_COLOR[e.beacon], ms: 4200 });
            break;
          }
          case "trialRule":
            rule.current = e.text;
            setRuleCard(e.text);
            break;
          case "died":
          case "respawned":
            rule.current = null;
            setRuleCard(null);
            break;
          case "trialStart":
            pushToast({ text: "Trial started", icon: "none" });
            break;
          case "trialDone":
            pushToast({ text: "Trial complete", icon: "none" });
            break;
          case "trialFail":
            pushToast({ text: "Trial failed", sub: `${press()} at the pedestal to retry`, icon: "none" });
            break;
          case "barrierDown":
            showBanner({ title: "The Spire barrier is gone", sub: "Climb Mt. Cinder to the Spire", kind: "gloam", ms: 4200 });
            break;
          case "bossWake":
            showBanner({ title: "The Gloam Warden", sub: "Boss", kind: "gloam", ms: 3200 });
            break;
          case "bossPhase":
            if (e.phase > 1) pushToast({ text: `Warden phase ${e.phase}`, sub: "New attacks", icon: "none" });
            break;
          case "dawn":
            showBanner({ title: "Dawn", kind: "time", ms: 2200 });
            break;
          case "dusk":
            showBanner({ title: "Dusk", kind: "time", ms: 2200 });
            break;
          case "pickup":
            if (e.kind === "shard") {
              if (now - lastBeacon.current > 1500) pushToast({ text: `Heart shard (${Math.min(4, (s?.shards ?? 0) + 1)}/4)`, sub: "4 shards = +1 heart", icon: "shard" });
            } else if (e.kind === "heart") pushToast({ text: "+1 heart", sub: "Hearts refilled", icon: "heart" });
            else if (e.kind === "bow") pushToast({ text: "Bow", sub: `Hold ${btnLabel(d, "F", "RT", "Bow")} to aim, release to shoot`, icon: "bow" });
            else if (e.kind === "glider") pushToast({ text: "Glider", sub: `${btnLabel(d, "Press G", "Press A in the air", "Tap Glide")} in the air to glide`, icon: "none" });
            else if (e.kind === "wick") pushToast({ text: "Wick Oil", sub: "+1 wick", icon: "wick" });
            else if (e.kind === "seed") pushToast({ text: "Ember Seed", sub: "+1 stamina ring", icon: "seed" });
            else if (e.kind === "arrows") {
              setArrowsPulse(true);
              setTimeout(() => setArrowsPulse(false), 3000);
            }
            break;
          case "power": {
            const info = POWER_INFO[e.power];
            pushToast({ text: `New power: ${info.name}`, sub: info.effect, icon: "none" });
            break;
          }
          case "saved":
            if (now - lastRest.current > 1500) pushToast({ text: "Game saved", icon: "quill" });
            break;
          case "rest":
            lastRest.current = now;
            pushToast({ text: "Rested", sub: "Hearts refilled. Game saved.", icon: "heart" });
            break;
          case "weather":
            if (e.weather === "storm") pushToast({ text: "Storm", icon: "none" });
            else if (e.weather === "rain") pushToast({ text: "Rain", sub: "Climbing uses more stamina", icon: "none" });
            break;
          case "waystone":
            pushToast({ text: WAYSTONES.find((w) => w.id === e.id)?.name ?? "Waystone", sub: "Travel here from the map", icon: "none" });
            break;
          case "travel":
            pushToast({ text: `Traveled to ${WAYSTONES.find((w) => w.id === e.to)?.name ?? "waystone"}`, icon: "none" });
            break;
          case "memory": {
            if (!prog.memories.includes(e.beacon)) {
              prog.memories.push(e.beacon);
              writeUiProgress(prog);
            }
            pushToast({ text: `Memory found (${prog.memories.length}/4)`, sub: "Open the journal to read it", icon: "none" });
            break;
          }
          case "secret": {
            if (!prog.secrets.includes(e.id)) {
              prog.secrets.push(e.id);
              writeUiProgress(prog);
            }
            pushToast({ text: `Secret found (${prog.secrets.length}/40)`, icon: "none" });
            break;
          }
          case "threadFizzle": {
            const text = e.why === "far" ? "Too far" : e.why === "pair" ? "Can't link those" : e.why === "heavy" ? "Too heavy" : null;
            if (text) setFizzle({ id: nextId++, text, x: aimAt.current.x, y: aimAt.current.y });
            break;
          }
          case "parry":
            ripUntil.current = now + 1500;
            break;
          case "say":
            if (optsRef.current.subtitles || (s ? false : true)) {
              subOn.current = true;
              const id = nextId++;
              setSub({ id, who: e.who, text: e.text });
              setTimeout(() => {
                setSub((c) => {
                  if (c && c.id === id) {
                    subOn.current = false;
                    return null;
                  }
                  return c;
                });
              }, Math.min(6, Math.max(2, e.seconds)) * 1000);
            }
            break;
          case "hint":
            if (optsRef.current.hints && !chipSeen(e.id)) setChip({ id: e.id, text: e.text });
            break;
          case "land":
            setChip((c) => (c && c.id === "glide" ? null : c));
            break;
          case "hintDone":
            markChipSeen(e.id);
            setChip((c) => (c && c.id === e.id ? null : c));
            break;
          case "toast":
            pushToast({ text: e.text, icon: "none" });
            break;
          case "read":
            onReadRef.current?.(e.title, e.text);
            break;
          default:
            break;
        }
      },
    };
  }, []);

  useEffect(() => {
    handleRef.current = handle;
    return () => {
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [handle, handleRef]);

  useEffect(() => {
    if (!toasts.length) return;
    const oldest = Math.min(...toasts.map((t) => t.at));
    const t = setTimeout(() => setToasts((l) => l.filter((x) => performance.now() - x.at < TOAST_MS - 50)), Math.max(50, oldest + TOAST_MS - performance.now()));
    return () => clearTimeout(t);
  }, [toasts]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), banner.ms);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => {
    if (!fizzle) return;
    const t = setTimeout(() => setFizzle((f) => (f && f.id === fizzle.id ? null : f)), 1000);
    return () => clearTimeout(t);
  }, [fizzle]);
  useEffect(() => {
    if (!hints) setChip(null);
  }, [hints]);
  useEffect(() => {
    if (!chip) return;
    const t = setTimeout(() => setChip((c) => (c && c.id === chip.id ? null : c)), 14000);
    return () => clearTimeout(t);
  }, [chip]);

  const glimmers = snap?.glimmers ?? 0;
  const hasSnap = snap !== null;
  // null until the first snapshot: loading a save or Continue sets the count without a pickup
  const prevGlim = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevGlim.current;
    prevGlim.current = hasSnap ? glimmers : null;
    if (prev === null || glimmers <= prev) return;
    setGlimShown(true);
    const t = setTimeout(() => setGlimShown(false), 3000);
    return () => clearTimeout(t);
  }, [glimmers, hasSnap]);

  const strip = useMemo(() => {
    const items: { left: number; label?: string; major: boolean }[] = [];
    for (let c = 0; c < 3; c++)
      for (let d = 0; d < 360; d += 15) {
        const left = ((c * 360 + d) / 1080) * 100;
        items.push({ left, label: d % 45 === 0 ? CARDINAL[d / 45] : undefined, major: d % 90 === 0 });
      }
    return items;
  }, []);
  const stripTicks = useMemo(() => (
    strip.map((t, i) => (
      <div key={i} className="absolute top-0 h-full" style={{ left: `${t.left}%` }}>
        {t.label ? (
          <span className="font-display absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 font-bold leading-none" style={{ fontSize: t.major ? "1.15em" : "0.8em", color: t.label === "N" ? "var(--color-rubric)" : t.major ? "var(--color-ink)" : "var(--color-ink-soft)" }}>
            {t.label}
          </span>
        ) : (
          <span className="absolute left-0 -translate-x-1/2" style={{ top: "34%", height: "32%", width: "1px", background: "var(--color-ink-soft)" }} />
        )}
      </div>
    ))
  ), [strip]);
  const pips = useMemo(() => Array.from({ length: MARKERS }, (_, i) => (
    <div key={i} ref={(el) => { markerRefs.current[i] = el; }} className="hm-pip absolute top-0 h-full -translate-x-1/2" data-kind={markerKind(i)} data-i={i} style={{ left: "50%", opacity: 0 }}>
      {markerKind(i) === "waystone" ? (
        <svg viewBox="0 0 12 12" className="hm-pip-g" aria-hidden><path d="M6 0.8L11.2 6L6 11.2L0.8 6Z" /></svg>
      ) : (
        <svg viewBox="0 0 14 14" className="hm-pip-g" aria-hidden><circle cx="7" cy="7" r="5.2" /></svg>
      )}
    </div>
  )), []);

  const hearts = snap ? Array.from({ length: Math.ceil(snap.maxHp / 4) }, (_, i) => Math.max(0, Math.min(4, snap.hp - i * 4))) : [];
  const danger = !!snap && snap.hp > 0 && snap.hp <= 4;
  const boss = snap?.boss ?? null;
  const trial = snap?.trial ?? null;
  const wickTotal = snap?.wick ?? THREAD.wickStart;
  const wickUsed = Math.min(wickTotal, snap?.wickUsed ?? 0);
  const objSub = snap?.objectiveSub ?? null;
  const ruleRaw = ruleCard ?? snap?.trialRule ?? null;
  const ruleText = ruleRaw && ruleRaw !== objSub && ruleRaw !== snap?.objective ? ruleRaw : null;
  const ruleAt = useRef(0);
  useEffect(() => { ruleAt.current = performance.now(); }, [ruleCard]);
  useEffect(() => {
    if (ruleCard && performance.now() - ruleAt.current > 800) { rule.current = null; setRuleCard(null); }
  }, [snap?.objective]);
  useEffect(() => {
    if (!visible && chip && (chip.id === "map" || chip.id === "journal")) {
      markChipSeen(chip.id);
      setChip(null);
    }
  }, [visible, chip]);
  const edge = "max(1.4em, env(safe-area-inset-left))";
  const edgeR = touch ? "calc(max(0.8em, env(safe-area-inset-right)) + 105px)" : "max(1.6em, env(safe-area-inset-right))";

  return (
    <div className="hm-hud" data-touch={touch ? "1" : "0"} style={{ opacity: visible ? 1 : 0, visibility: visible ? "visible" : "hidden", transition: "opacity .4s" }} data-testid="hud">
      <div ref={vignette} className="hm-vignette" />
      {danger && <div className="hm-lowhp" />}

      {/* top-left: objective, sub-line, then toasts */}
      <div ref={tlRef} className="absolute flex flex-col" style={{ left: edge, top: "max(1.2em, env(safe-area-inset-top))", width: touch ? "min(23em, 31vw)" : "min(25em, 30vw)", gap: "0.45em" }}>
        {snap && (
          <div className="hm-objective" data-testid="objective-box">
            <p className="font-display" style={{ fontSize: touch ? "1.02em" : "1.2em", fontWeight: 700, lineHeight: 1.2 }} data-testid="objective">{snap.objective}</p>
            {objSub && <p style={{ fontSize: touch ? "0.78em" : "0.82em", color: "var(--color-mist)", marginTop: "0.15em", lineHeight: 1.25 }} data-testid="objective-sub">{objSub}</p>}
          </div>
        )}
        {ruleText && (
          <div className="hm-objective" style={{ fontSize: touch ? "0.8em" : "0.88em", borderLeft: "3px solid var(--color-gold)" }} data-testid="rule-card">
            {ruleText}
          </div>
        )}
        <div className="flex flex-col" style={{ gap: "0.35em" }} data-testid="toasts">
          {toasts.map((t) => (
            <div key={t.id} className="hm-toast flex items-center" style={{ gap: "0.55em", padding: "0.4em 0.9em 0.4em 0.6em", background: "rgb(8 25 28 / 0.88)", border: "1px solid rgb(232 199 102 / 0.55)", borderLeft: "3px solid var(--color-gold)", borderRadius: "0.25em", boxShadow: "0 0.2em 0.7em rgb(8 25 28 / 0.5)", maxWidth: "100%" }}>
              <ToastIcon icon={t.icon} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="font-display" style={{ fontSize: "1.08em", fontWeight: 700 }}>{t.text}</span>
                {t.sub && <span style={{ fontSize: "0.76em", color: "var(--color-parchment)" }}>{typeof t.sub === "function" ? t.sub() : t.sub}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* top-center: compass */}
      <div ref={compassRef} className="absolute left-1/2 -translate-x-1/2" style={{ top: "max(1em, env(safe-area-inset-top))", width: touch ? "30%" : "36%" }} data-testid="compass">
        <div className="relative" style={{ height: "2.4em" }}>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden style={{ filter: "drop-shadow(0 0.15em 0.3em rgb(8 25 28 / 0.6))" }}>
            <path d="M12 2H388L398 13L388 24H12L2 13Z" fill="rgb(239 227 200 / 0.9)" stroke="var(--color-ink)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d="M16 4.5H384M16 21.5H384" stroke="var(--color-gold)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.9" />
          </svg>
          <div className="hm-compass-mask absolute inset-x-[2%] inset-y-0 overflow-hidden">
            <div ref={stripRef} className="absolute inset-y-0 left-0" style={{ width: `${(3 * 360 * 100) / FOV_DEG}%`, willChange: "transform" }}>
              {stripTicks}
            </div>
            {pips}
          </div>
          <svg className="absolute left-1/2 -translate-x-1/2" style={{ top: "-0.35em", width: "0.9em", height: "0.6em" }} viewBox="0 0 12 8" aria-hidden>
            <path d="M0 0H12L6 8Z" fill="var(--color-ember)" stroke="var(--color-ink)" strokeWidth="1" />
          </svg>
          <div className="absolute inset-x-[2%]" style={{ top: "2.55em" }}>
            <span ref={distRef} className="hm-dist hm-shadow absolute -translate-x-1/2 whitespace-nowrap font-display" style={{ opacity: 0, left: "50%", fontSize: "0.95em", fontWeight: 700, color: "var(--color-gold-hi)" }} data-testid="track-dist" />
          </div>
        </div>
      </div>

      {/* top-right: hearts, then wick */}
      <div ref={trRef} className="absolute flex flex-col items-end" style={{ right: edgeR, top: touch ? "max(0.7em, env(safe-area-inset-top))" : "max(1.2em, env(safe-area-inset-top))", gap: "0.35em", maxWidth: touch ? "40vw" : "26em" }}>
        <div className="flex flex-wrap items-center justify-end" style={{ gap: "0.12em 0.18em", filter: "drop-shadow(0 0.1em 0.25em rgb(8 25 28 / 0.7))" }} data-testid="hearts" title="Hearts">
          {hearts.map((q, i) => (
            <HeartIcon key={i} id={`h${i}`} q={q} danger={danger && q > 0} size={touch ? 1.55 : 1.8} />
          ))}
        </div>
        {snap && (
          <div className="hm-stat-pill flex items-center" style={{ gap: "0.5em" }} data-testid="wick" title="Wick: how many threads you can have at once">
            <span className="hm-label" style={{ fontSize: "0.75em", color: "var(--color-mist)" }}>Wick</span>
            <span className="flex" style={{ gap: "0.22em" }}>
              {Array.from({ length: wickTotal }, (_, i) => (
                <svg key={i} viewBox="0 0 10 14" style={{ width: "0.75em", height: "1.05em" }} aria-hidden>
                  <path d="M5 0.8C7.6 4 9.2 6 9.2 8.6A4.2 4.2 0 0 1 0.8 8.6C0.8 6 2.4 4 5 0.8Z" fill={i < wickTotal - wickUsed ? "var(--color-ember-hi)" : "transparent"} stroke={i < wickTotal - wickUsed ? "var(--color-ink)" : "var(--color-parchment)"} strokeWidth="1" />
                </svg>
              ))}
            </span>
            {snap.shards > 0 && (
              <span className="flex items-center" style={{ gap: "0.1em", marginLeft: "0.4em" }} title={`Heart shards: ${PLAYER.shardsPerHeart} make a heart`}>
                <span className="hm-label" style={{ fontSize: "0.7em", color: "var(--color-mist)", marginRight: "0.35em" }}>Heart shards {snap.shards}/{PLAYER.shardsPerHeart}</span>
                {Array.from({ length: PLAYER.shardsPerHeart }, (_, i) => (
                  <svg key={i} viewBox="0 0 10 10" style={{ width: "0.6em", height: "0.6em" }}>
                    <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" fill={i < snap.shards ? "#e0533f" : "rgb(248 240 221 / 0.15)"} stroke="var(--color-parchment-hi)" strokeWidth="0.8" />
                  </svg>
                ))}
              </span>
            )}
          </div>
        )}
        {showFps && snap && <Fps snap={snap} />}
        {trial && (
          <div className="hm-fade" style={{ marginTop: "0.5em" }} data-testid="trial">
            <TrialPanel trial={trial} />
          </div>
        )}
      </div>

      {/* bottom-right: glimmers for 3 s on change, arrows while the bow is out */}
      {snap && (
        <div className="absolute flex flex-col items-end" style={touch ? { right: "max(0.8em, env(safe-area-inset-right))", top: "calc(max(0.7em, env(safe-area-inset-top)) + 62px)", gap: "0.2em" } : { right: "max(1.8em, env(safe-area-inset-right))", bottom: "max(1.6em, env(safe-area-inset-bottom))", gap: "0.25em" }} data-testid="counters">
          <span className="hm-shadow flex items-center" style={{ gap: "0.4em", opacity: glimShown ? 1 : 0, transition: "opacity .4s" }}>
            <span key={snap.glimmers} className="hm-pop flex items-center" style={{ gap: "0.4em" }}>
              <Diamond style={{ width: "1.05em", height: "1.3em", filter: "drop-shadow(0 0 0.3em rgb(232 199 102 / 0.6))" }} />
              <span className="font-display tabular-nums" style={{ fontSize: "1.5em", fontWeight: 700, lineHeight: 1 }} data-testid="glimmers">{snap.glimmers}</span>
            </span>
            <span className="hm-label" style={{ fontSize: "0.6em", color: "var(--color-mist)" }}>glimmers</span>
          </span>
          {snap.hasBow && (
            <span ref={arrowsRef} className="hm-arrows hm-shadow flex items-center" data-pulse={arrowsPulse ? "1" : "0"} style={{ gap: "0.4em", color: snap.arrows === 0 ? "var(--color-rubric)" : undefined }}>
              <Arrow style={{ width: "1.1em", height: "1.1em" }} />
              <span className="font-display tabular-nums" style={{ fontSize: "1.2em", fontWeight: 600, lineHeight: 1 }}>{snap.arrows}</span>
              <span className="hm-label" style={{ fontSize: "0.6em", color: "var(--color-mist)" }}>arrows</span>
            </span>
          )}
        </div>
      )}

      {banner && <BannerView key={banner.id} b={banner} />}

      {snap?.prompt && (
        <div key={snap.prompt} className="hm-chip-in absolute left-1/2 flex items-center gap-[0.7em]" style={{ bottom: touch ? "34%" : "18%", transform: "translateX(-50%)", padding: "0.45em 1.3em 0.45em 0.55em", background: "rgb(239 227 200 / 0.94)", color: "var(--color-ink)", border: "1px solid var(--color-gold-lo)", borderRadius: "2em", boxShadow: "0 0.3em 1em rgb(8 25 28 / 0.5), inset 0 0 0 0.18em rgb(248 240 221 / 0.8), inset 0 0 0 calc(0.18em + 1px) var(--color-gold)", whiteSpace: "nowrap" }} data-testid="prompt">
          {snap.device === "touch" ? (
            <svg viewBox="0 0 24 24" style={{ width: "1.6em", height: "1.6em" }} aria-hidden>
              <circle cx="12" cy="12" r="11" fill="var(--color-ink)" />
              <path d="M8 12h8M13 8.5l3.5 3.5-3.5 3.5" stroke="var(--color-parchment-hi)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            <Glyph device={snap.device} keys="E" pad="Y" />
          )}
          <span className="font-display" style={{ fontSize: "1.3em", fontWeight: 700, letterSpacing: "0.03em" }}>{snap.prompt}</span>
        </div>
      )}

      {chip && !snap?.prompt && <Chip chip={chip} touch={touch} />}
      {chip && snap?.prompt && <Chip chip={chip} touch={touch} />}

      {boss && (
        <div className="hm-boss-in absolute left-1/2 -translate-x-1/2" style={touch ? { width: "34%", bottom: "max(0.8em, env(safe-area-inset-bottom))" } : { width: "54%", bottom: "max(2.2em, env(safe-area-inset-bottom))" }} data-testid="boss">
          <BossScroll boss={boss} />
        </div>
      )}

      <Subtitle sub={sub} boxRef={subBox} />

      <div ref={worldRef} className="absolute left-0 top-0" style={{ opacity: 0, transition: "opacity .25s", willChange: "transform" }} data-testid="world-marker">
        <div className="flex -translate-x-1/2 -translate-y-1/2 flex-col items-center hm-shadow" style={{ filter: "drop-shadow(0 0 0.3em rgb(8 25 28 / 0.8))" }}>
          <svg viewBox="0 0 20 24" style={{ width: "1.1em", height: "1.3em" }} aria-hidden>
            <path d="M10 1L18 12L10 23L2 12Z" fill="var(--color-gold-hi)" stroke="var(--color-ink)" strokeWidth="1.4" />
          </svg>
          <span ref={worldText} className="font-display" style={{ fontSize: "0.85em", fontWeight: 700, color: "var(--color-parchment-hi)" }} />
        </div>
      </div>

      <div ref={ripBox} className="absolute left-0 top-0" style={{ opacity: 0, willChange: "transform", transition: "opacity .15s" }} data-testid="riposte">
        <div className="-translate-x-1/2 -translate-y-1/2">
          {snap && snap.device === "touch" ? <span className="hm-shadow font-display" style={{ fontWeight: 700 }}>Sword</span> : <Glyph device={snap?.device ?? "keys"} keys="LMB" pad="X" />}
        </div>
      </div>
      <div ref={threadBox} className="hm-thread-aim absolute left-0 top-0" style={{ opacity: 0, willChange: "transform" }} data-testid="thread-aim">
        <svg viewBox="0 0 32 32" style={{ width: "2em", height: "2em", marginLeft: "-1em", marginTop: "-1em", display: "block" }} aria-hidden>
          <path d="M16 3L29 16L16 29L3 16Z" fill="none" strokeWidth="2.2" />
          <circle cx="16" cy="16" r="3" className="hm-thread-core" />
        </svg>
      </div>
      {fizzle && (
        <span key={fizzle.id} className="hm-shadow font-display absolute whitespace-nowrap" style={{ left: fizzle.x, top: fizzle.y + 26, transform: "translateX(-50%)", fontSize: "0.9em", fontWeight: 700, color: "var(--color-parchment-hi)", background: "rgb(8 25 28 / 0.75)", padding: "0.1em 0.6em", borderRadius: "1em" }} data-testid="thread-fail">
          {fizzle.text}
        </span>
      )}

      <div ref={stamBox} className="absolute left-0 top-0" style={{ opacity: 0, transition: "opacity .35s", width: "2.1em", height: "2.1em", marginLeft: "-1.05em", marginTop: "-1.05em", willChange: "transform" }} data-testid="stamina" title="Stamina">
        <svg viewBox="0 0 36 36" className="h-full w-full" style={{ filter: "drop-shadow(0 0 0.2em rgb(8 25 28 / 0.8))" }}>
          <circle cx="18" cy="18" r="14" fill="rgb(8 25 28 / 0.35)" stroke="rgb(248 240 221 / 0.25)" strokeWidth="4.5" />
          <circle ref={stamArc} cx="18" cy="18" r="14" fill="none" stroke="var(--color-gold-hi)" strokeWidth="4.5" strokeLinecap="round" strokeDasharray="100 100" pathLength={100} transform="rotate(-90 18 18)" />
          <circle cx="18" cy="18" r="16.6" fill="none" stroke="var(--color-ink)" strokeWidth="0.8" />
        </svg>
      </div>
      <div ref={lockBox} className="absolute left-0 top-0" style={{ opacity: 0, transition: "opacity .2s", width: "3.4em", height: "3.4em", marginLeft: "-1.7em", marginTop: "-1.7em", willChange: "transform" }} data-testid="lock">
        <svg viewBox="0 0 48 48" className="h-full w-full" style={{ animation: "hm-spin 6s linear infinite", filter: "drop-shadow(0 0 0.2em rgb(8 25 28 / 0.9))" }}>
          {[0, 90, 180, 270].map((r) => (
            <path key={r} d="M6 15V6H15" transform={`rotate(${r} 24 24)`} stroke="var(--color-gold-hi)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          ))}
          <circle ref={lockArc} cx="24" cy="24" r="9" fill="none" stroke="var(--color-ember)" strokeWidth="2" strokeDasharray="100 100" pathLength={100} transform="rotate(-90 24 24)" />
          <path d="M24 21L27 24L24 27L21 24Z" fill="var(--color-gold-hi)" />
        </svg>
      </div>
      <div ref={aimBox} className="absolute left-1/2 top-1/2" style={{ opacity: 0, transition: "opacity .15s", width: "3em", height: "3em", marginLeft: "-1.5em", marginTop: "-1.5em" }}>
        <svg viewBox="0 0 40 40" className="h-full w-full">
          <circle cx="20" cy="20" r="12" fill="none" stroke="rgb(248 240 221 / 0.35)" strokeWidth="2" />
          <circle ref={aimArc} cx="20" cy="20" r="12" fill="none" stroke="var(--color-ember-hi)" strokeWidth="2.4" strokeDasharray="100 100" pathLength={100} transform="rotate(-90 20 20)" />
          <path d="M20 4v6M20 30v6M4 20h6M30 20h6" stroke="var(--color-parchment-hi)" strokeWidth="1.6" />
          <circle cx="20" cy="20" r="1.4" fill="var(--color-ember-hi)" />
        </svg>
      </div>
    </div>
  );
}

function Fps({ snap }: { snap: HudSnapshot }) {
  return (
    <span className="hm-label hm-shadow tabular-nums" style={{ fontSize: "0.62em", color: "var(--color-mist)" }} data-testid="fps">
      {snap.fps.toFixed(0)} fps · {snap.quality} · {Math.round(snap.scale * 100)}%
    </span>
  );
}

function ToastIcon({ icon }: { icon: Toast["icon"] }) {
  const s = { width: "1.3em", height: "1.5em", flex: "none" } as const;
  if (icon === "quill") return <Quill style={s} />;
  if (icon === "wick") return <Flame style={s} />;
  if (icon === "seed") return <Diamond style={s} />;
  if (icon === "bow") return <Arrow style={s} />;
  if (icon === "heart") return <HeartIcon id="toast" q={4} size={1.4} />;
  if (icon === "shard")
    return (
      <svg viewBox="0 0 20 20" style={s} aria-hidden>
        <path d="M10 1L19 10L10 19L1 10Z" fill="var(--color-ember)" stroke="var(--color-parchment-hi)" strokeWidth="1.2" />
        <path d="M10 5L15 10L10 15" fill="none" stroke="var(--color-ember-hi)" strokeWidth="1.2" />
      </svg>
    );
  return <span style={{ width: "0.4em", height: "0.4em", background: "var(--color-gold)", transform: "rotate(45deg)", flex: "none", margin: "0 0.4em" }} />;
}

function BannerView({ b }: { b: Banner }) {
  const big = b.kind === "beacon" || b.kind === "gloam";
  const tint = b.kind === "gloam" ? "var(--color-gloam-hi)" : b.color ?? "var(--color-gold-hi)";
  return (
    <div className="absolute inset-x-0 flex flex-col items-center text-center" style={{ top: "max(3.2em, 8%)", ["--hm-banner-t" as string]: `${b.ms}ms` }} data-testid="banner">
      <div className="hm-banner absolute left-1/2 -translate-x-1/2" style={{ top: big ? "-2.4em" : "-1.2em", width: big ? "30em" : "28em", height: big ? "16em" : "10em", background: `radial-gradient(ellipse 50% 50% at 50% 55%, ${b.kind === "gloam" ? "rgb(52 30 68 / 0.6)" : big ? "rgb(120 60 20 / 0.45)" : "rgb(8 25 28 / 0.42)"}, transparent 72%)` }} />
      {b.kind === "beacon" && <Flame color={b.color} className="hm-banner" style={{ width: "2.6em", height: "3.2em", marginBottom: "0.4em", filter: `drop-shadow(0 0 1em ${b.color})` }} />}
      <span className="font-display hm-banner hm-shadow relative italic" style={{ fontSize: big ? "3.6em" : b.kind === "area" ? "3.1em" : "2.3em", fontWeight: 600, lineHeight: 1.05, color: b.kind === "gloam" ? "#e5d4f5" : "var(--color-parchment-hi)" }}>
        {b.title}
      </span>
      <svg viewBox="0 0 300 16" className="hm-banner-rule relative" style={{ width: big ? "22em" : "17em", height: "1em", marginTop: "0.4em" }} aria-hidden>
        <path d="M0 8H128M172 8H300" stroke={tint} strokeWidth="1.5" />
        <path d="M128 8C138 0 144 0 150 8C156 16 162 16 172 8" stroke={tint} strokeWidth="1.5" fill="none" />
        <path d="M150 3L155 8L150 13L145 8Z" fill={tint} />
      </svg>
      {b.sub && (b.kind === "area" || b.kind === "time" || big) && (
        <span className={`${b.kind === "area" ? "hm-label" : "font-display italic"} hm-banner hm-shadow relative`} style={{ fontSize: b.kind === "area" ? "0.75em" : "1.25em", marginTop: "0.5em", color: b.kind === "area" ? "var(--color-gold-hi)" : "var(--color-parchment)" }}>
          {b.sub}
        </span>
      )}
    </div>
  );
}

function TrialPanel({ trial }: { trial: NonNullable<HudSnapshot["trial"]> }) {
  const color = BEACON_COLOR[trial.beacon];
  const pips = trial.total <= 10;
  return (
    <div className="flex items-center gap-[0.8em]" style={{ padding: "0.55em 1.1em 0.6em 0.8em", background: "rgb(8 25 28 / 0.72)", border: "1px solid rgb(232 199 102 / 0.5)", borderRadius: "0.2em", boxShadow: "0 0.3em 1em rgb(8 25 28 / 0.5)" }}>
      <Flame color={color} style={{ width: "1.5em", height: "1.9em", filter: `drop-shadow(0 0 0.4em ${color})` }} />
      <div className="flex flex-col gap-[0.3em]">
        <span className="hm-label" style={{ fontSize: "0.62em", color: "var(--color-gold-hi)" }}>Trial · {beaconName(trial.beacon)}</span>
        <div className="flex items-center gap-[0.7em]">
          {pips ? (
            <span className="flex gap-[0.28em]">
              {Array.from({ length: trial.total }, (_, i) => (
                <svg key={i} viewBox="0 0 10 10" style={{ width: "0.8em", height: "0.8em" }}>
                  <path d="M5 0.6L9.4 5L5 9.4L0.6 5Z" fill={i < trial.value ? color : "transparent"} stroke="var(--color-parchment)" strokeWidth="0.9" />
                </svg>
              ))}
            </span>
          ) : (
            <span className="block h-[0.35em] w-[7em] overflow-hidden rounded-full" style={{ background: "rgb(248 240 221 / 0.15)" }}>
              <span className="block h-full" style={{ width: `${(trial.value / Math.max(1, trial.total)) * 100}%`, background: color }} />
            </span>
          )}
          <span className="font-display tabular-nums" style={{ fontSize: "1.1em", fontWeight: 600 }}>
            {trial.value}/{trial.total} <span style={{ fontSize: "0.75em", color: "var(--color-mist)" }}>{TRIAL_VERB[trial.beacon]}</span>
          </span>
          {trial.timeLeft != null && (
            <span className="font-display tabular-nums" data-testid="trial-time" style={{ fontSize: "1.1em", fontWeight: 600, color: trial.timeLeft < 10 ? "var(--color-ember)" : "var(--color-parchment)" }}>
              {Math.ceil(trial.timeLeft)}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function BossScroll({ boss }: { boss: NonNullable<HudSnapshot["boss"]> }) {
  const p = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-[0.8em]" style={{ marginBottom: "0.25em" }}>
        <svg viewBox="0 0 40 10" style={{ width: "2.6em", height: "0.7em" }} aria-hidden><path d="M0 5H28M28 5C32 1 36 1 40 5C36 9 32 9 28 5" stroke="var(--color-gold-hi)" fill="none" strokeWidth="1.2" /></svg>
        <span className="font-display hm-shadow hm-smallcaps" style={{ fontSize: "1.35em", fontWeight: 700, color: "#eadcf7" }}>{boss.name}</span>
        <svg viewBox="0 0 40 10" style={{ width: "2.6em", height: "0.7em", transform: "scaleX(-1)" }} aria-hidden><path d="M0 5H28M28 5C32 1 36 1 40 5C36 9 32 9 28 5" stroke="var(--color-gold-hi)" fill="none" strokeWidth="1.2" /></svg>
      </div>
      <div className="relative flex w-full items-center" style={{ height: "1.9em" }}>
        <ScrollEnd />
        <div className="hm-parchment relative mx-[-0.3em] h-[1.15em] flex-1 overflow-hidden" style={{ borderTop: "1px solid var(--color-ink)", borderBottom: "1px solid var(--color-ink)" }}>
          <div className="absolute inset-y-[0.18em] left-[0.3em] right-[0.3em] overflow-hidden" style={{ background: "rgb(43 33 24 / 0.35)" }}>
            <div className="absolute inset-y-0 left-0" style={{ width: `${p * 100}%`, background: "rgb(232 199 102 / 0.6)", transition: "width 0.9s ease 0.35s" }} />
            <div className="absolute inset-y-0 left-0" style={{ width: `${p * 100}%`, background: "linear-gradient(180deg, #a47cc6 0%, #5b3a6e 55%, #3a2347 100%)", transition: "width 0.15s", boxShadow: "inset 0 1px 0 rgb(229 212 245 / 0.6)" }} />
            {[0.66, 0.33].map((t) => (
              <span key={t} className="absolute inset-y-0" style={{ left: `${t * 100}%`, width: "2px", background: "var(--color-gold-hi)", boxShadow: "0 0 0 1px var(--color-ink)" }} />
            ))}
          </div>
        </div>
        <ScrollEnd flip />
      </div>
      <span className="hm-label hm-shadow" style={{ fontSize: "0.8em", marginTop: "0.2em", color: "#e5d4f5" }}>Phase {Math.max(1, Math.min(3, boss.phase))} of 3</span>
    </div>
  );
}

function ScrollEnd({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 40" style={{ width: "1.15em", height: "1.9em", flex: "none", transform: flip ? "scaleX(-1)" : undefined, zIndex: 1 }} aria-hidden>
      <rect x="6" y="3" width="12" height="34" rx="6" fill="#c9a77a" stroke="var(--color-ink)" strokeWidth="1.3" />
      <path d="M9 6v28" stroke="rgb(255 250 232 / 0.6)" strokeWidth="1.5" />
      <rect x="8" y="0.8" width="8" height="4" rx="1.5" fill="url(#hm-gold-grad)" stroke="var(--color-ink)" strokeWidth="0.9" />
      <rect x="8" y="35.2" width="8" height="4" rx="1.5" fill="url(#hm-gold-grad)" stroke="var(--color-ink)" strokeWidth="0.9" />
    </svg>
  );
}
