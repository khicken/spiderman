"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { GameEvent, HudFrame, HudHandle, HudSnapshot } from "./contracts";
import { BEACON_COLOR } from "./contracts";
import { Arrow, Diamond, Flame, Glyph, HeartFlame, Quill } from "./ui-ink";
import { beaconName, TRIAL_VERB } from "./ui-store";

const FOV_DEG = 150;
const FOV = (FOV_DEG * Math.PI) / 180;
const TAU = Math.PI * 2;
const CARDINAL = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const MARKER_COLOR = [...BEACON_COLOR, "#a47cc6"];

type Toast = { id: number; text: string; sub?: string; icon: "glimmer" | "shard" | "arrow" | "quill" | "flame" | "none"; n?: number; at: number };
type Banner = { id: number; title: string; sub?: string; kind: "area" | "beacon" | "trial" | "fail" | "gloam" | "time"; color?: string; ms: number };

export interface HudProps {
  snap: HudSnapshot | null;
  visible: boolean;
  touch: boolean;
  showFps: boolean;
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

export function Hud({ snap, visible, touch, showFps, handleRef, onRead }: HudProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const distRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const stamBox = useRef<HTMLDivElement>(null);
  const stamArc = useRef<SVGCircleElement>(null);
  const lockBox = useRef<HTMLDivElement>(null);
  const lockArc = useRef<SVGCircleElement>(null);
  const aimBox = useRef<HTMLDivElement>(null);
  const aimArc = useRef<SVGCircleElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [calm, setCalm] = useState(false);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const lastShown = useRef({ stam: "", lock: "", aim: "" });

  const handle = useMemo<HudHandle>(() => {
    let nextId = 1;
    const pushToast = (t: Omit<Toast, "id" | "at">) => {
      const now = performance.now();
      setToasts((list) => {
        // merge repeated glimmer / arrow pickups into one counting toast
        if (t.icon === "glimmer" || t.icon === "arrow") {
          const i = list.findIndex((x) => x.icon === t.icon && now - x.at < 2200);
          if (i >= 0) {
            const n = (list[i].n ?? 0) + (t.n ?? 0);
            const merged = { ...list[i], n, text: t.icon === "glimmer" ? `+${n} Glimmers` : `+${n} Arrows`, at: now, id: nextId++ };
            return [...list.slice(0, i), ...list.slice(i + 1), merged].slice(-4);
          }
        }
        return [...list, { ...t, id: nextId++, at: now }].slice(-4);
      });
    };
    const showBanner = (b: Omit<Banner, "id">) => setBanner({ ...b, id: nextId++ });
    return {
      frame(f: HudFrame) {
        const strip = stripRef.current;
        const h = norm(f.heading) / TAU;
        if (strip) strip.style.transform = `translateX(${-((1 + h) / 3 - FOV_DEG / 2160) * 100}%)`;
        for (let i = 0; i < 5; i++) {
          const el = markerRefs.current[i];
          const m = f.markers[i];
          if (!el || !m) continue;
          if (!m.on) {
            el.style.opacity = "0";
            continue;
          }
          const d = diff(m.bearing, f.heading);
          const raw = 50 + (d / FOV) * 100;
          const x = raw < 4 ? 4 : raw > 96 ? 96 : raw;
          el.style.left = `${x}%`;
          el.style.opacity = raw < 4 || raw > 96 ? "0.45" : "1";
          const dl = distRefs.current[i];
          if (dl) {
            const near = Math.abs(d) < 0.2;
            dl.style.opacity = near ? "1" : "0";
            if (near) dl.textContent = m.dist < 1000 ? `${Math.round(m.dist)} m` : `${(m.dist / 1000).toFixed(1)} km`;
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
        if (vignette.current) vignette.current.style.opacity = String(f.damageFlash);
      },
      event(e: GameEvent) {
        switch (e.type) {
          case "areaEnter":
            showBanner({ title: e.name, sub: e.first ? "Discovered" : undefined, kind: "area", ms: 2600 });
            break;
          case "beaconLit":
            showBanner({ title: `${beaconName(e.beacon)} wakes`, sub: "A heart shard warms in your lantern", kind: "beacon", color: BEACON_COLOR[e.beacon], ms: 4200 });
            break;
          case "trialStart":
            showBanner({ title: "The trial begins", sub: beaconName(e.beacon), kind: "trial", color: BEACON_COLOR[e.beacon], ms: 2400 });
            break;
          case "trialDone":
            showBanner({ title: "Trial complete", sub: beaconName(e.beacon), kind: "trial", color: BEACON_COLOR[e.beacon], ms: 2400 });
            break;
          case "trialFail":
            showBanner({ title: "The trial falters", sub: "Return to the pedestal to try again", kind: "fail", ms: 2800 });
            break;
          case "barrierDown":
            showBanner({ title: "The barrier falls", sub: "The way to the Gloam Spire is open", kind: "gloam", ms: 4200 });
            break;
          case "bossWake":
            showBanner({ title: "The Gloam Warden", sub: "Keeper of the long dusk", kind: "gloam", ms: 3600 });
            break;
          case "bossPhase":
            if (e.phase > 1) pushToast({ text: "The Warden's fury rises", icon: "flame" });
            break;
          case "dawn":
            showBanner({ title: "Dawn", sub: "06:00", kind: "time", ms: 2200 });
            break;
          case "dusk":
            showBanner({ title: "Dusk falls", sub: "18:00", kind: "time", ms: 2200 });
            break;
          case "pickup":
            if (e.kind === "glimmer") pushToast({ text: `+${e.amount} Glimmers`, icon: "glimmer", n: e.amount });
            else if (e.kind === "arrows") pushToast({ text: `+${e.amount} Arrows`, icon: "arrow", n: e.amount });
            else if (e.kind === "shard") pushToast({ text: "Heart shard", sub: "Four make a new flame", icon: "shard" });
            else if (e.kind === "heart") pushToast({ text: "A new flame", sub: "Your lantern burns brighter", icon: "flame" });
            else if (e.kind === "bow") pushToast({ text: "Mirebrook longbow", sub: "Hold to draw, release to loose", icon: "arrow" });
            else if (e.kind === "glider") pushToast({ text: "Glider", icon: "none" });
            break;
          case "saved":
            pushToast({ text: "Journey saved", icon: "quill" });
            break;
          case "rest":
            pushToast({ text: "You rest by the flame", sub: "Hearts restored", icon: "flame" });
            break;
          case "weather":
            if (e.weather === "storm") pushToast({ text: "A storm gathers", icon: "none" });
            else if (e.weather === "rain") pushToast({ text: "Rain on the island", sub: "Climbing tires you faster", icon: "none" });
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
    const t = setTimeout(() => setToasts((l) => l.filter((x) => performance.now() - x.at < 3150)), Math.max(50, oldest + 3200 - performance.now()));
    return () => clearTimeout(t);
  }, [toasts]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), banner.ms);
    return () => clearTimeout(t);
  }, [banner]);

  // calm exploration: fade the HUD after 4 s of nothing happening
  const sig = snap ? `${snap.hp}|${snap.maxHp}|${snap.glimmers}|${snap.arrows}|${snap.shards}|${!!snap.boss}|${!!snap.trial}|${snap.prompt}` : "";
  useEffect(() => {
    setCalm(false);
    if (!snap) return;
    if (snap.hp < snap.maxHp || snap.boss || snap.trial) return;
    const t = setTimeout(() => setCalm(true), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const strip = useMemo(() => {
    const items: { left: number; label?: string; major: boolean }[] = [];
    for (let c = 0; c < 3; c++)
      for (let d = 0; d < 360; d += 15) {
        const left = ((c * 360 + d) / 1080) * 100;
        items.push({ left, label: d % 45 === 0 ? CARDINAL[d / 45] : undefined, major: d % 90 === 0 });
      }
    return items;
  }, []);
  // same element identity every render, so React skips the 72 ticks on each HUD snapshot
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

  const hearts = snap ? Array.from({ length: Math.ceil(snap.maxHp / 4) }, (_, i) => Math.max(0, Math.min(4, snap.hp - i * 4))) : [];
  const danger = !!snap && snap.hp > 0 && snap.hp <= 4;
  const boss = snap?.boss ?? null;
  const trial = snap?.trial ?? null;

  return (
    <div className="hm-hud" data-touch={touch ? "1" : "0"} data-calm={calm ? "1" : "0"} style={{ opacity: visible ? 1 : 0, visibility: visible ? "visible" : "hidden", transition: "opacity .4s" }} data-testid="hud">
      <div ref={vignette} className="hm-vignette" />
      {danger && <div className="hm-lowhp" />}

      {/* hearts never fade with the calm HUD: health must always be readable during play */}
      <div className="absolute flex flex-col gap-[0.5em]" style={{ left: "max(1.6em, env(safe-area-inset-left))", top: "max(1.2em, env(safe-area-inset-top))" }}>
        <div className="flex flex-wrap items-end gap-x-[0.28em] gap-y-[0.2em]" style={{ maxWidth: "19em", filter: "drop-shadow(0 0.1em 0.25em rgb(8 25 28 / 0.7))" }} data-testid="hearts">
          {hearts.map((q, i) => (
            <HeartFlame key={i} id={`h${i}`} q={q} danger={danger && q > 0} />
          ))}
          {snap && snap.shards > 0 && (
            <span className="ml-[0.3em] flex items-center gap-[0.12em] self-center" title="Heart shards">
              {[0, 1, 2, 3].map((i) => (
                <svg key={i} viewBox="0 0 10 10" style={{ width: "0.78em", height: "0.78em", transform: `rotate(${i * 90}deg)` }}>
                  <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" fill={i < snap.shards ? "var(--color-ember)" : "rgb(248 240 221 / 0.15)"} stroke="var(--color-parchment-hi)" strokeWidth="0.8" />
                </svg>
              ))}
            </span>
          )}
        </div>
        {touch && snap && <div className="hm-calm"><Counters snap={snap} touch /></div>}
      </div>

      <div className="hm-calm-soft absolute left-1/2 -translate-x-1/2 transition-opacity duration-1000" style={{ top: "max(1em, env(safe-area-inset-top))", width: touch ? "55%" : "40%" }} data-testid="compass">
        <div className="relative" style={{ height: "2.6em" }}>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden style={{ filter: "drop-shadow(0 0.15em 0.3em rgb(8 25 28 / 0.6))" }}>
            <path d="M12 2H388L398 13L388 24H12L2 13Z" fill="rgb(239 227 200 / 0.88)" stroke="var(--color-ink)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d="M16 4.5H384M16 21.5H384" stroke="var(--color-gold)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.9" />
          </svg>
          <div className="hm-compass-mask absolute inset-x-[2%] inset-y-0 overflow-hidden">
            <div ref={stripRef} className="absolute inset-y-0 left-0" style={{ width: `${(3 * 360 * 100) / FOV_DEG}%`, willChange: "transform" }}>
              {stripTicks}
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} ref={(el) => { markerRefs.current[i] = el; }} className="absolute top-0 h-full -translate-x-1/2" style={{ left: "50%", opacity: 0 }}>
                <Flame color={MARKER_COLOR[i]} lit={snap ? (i < 4 ? snap.beacons[i] : true) : false} style={{ width: "1.05em", height: "1.4em", marginTop: "0.6em", filter: "drop-shadow(0 0 0.25em rgb(240 138 60 / 0.5))" }} />
              </div>
            ))}
          </div>
          <svg className="absolute left-1/2 -translate-x-1/2" style={{ top: "-0.35em", width: "0.9em", height: "0.6em" }} viewBox="0 0 12 8" aria-hidden>
            <path d="M0 0H12L6 8Z" fill="var(--color-ember)" stroke="var(--color-ink)" strokeWidth="1" />
          </svg>
          <div className="absolute inset-x-0 flex justify-center" style={{ top: "2.75em" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} ref={(el) => { distRefs.current[i] = el; }} className="hm-label hm-shadow absolute" style={{ opacity: 0, fontSize: "0.62em" }} />
            ))}
          </div>
        </div>
        {snap && (
          <p className="font-display hm-objective mx-auto w-fit max-w-full text-center italic" style={{ marginTop: "1.05em", fontSize: touch ? "0.98em" : "1.15em" }} data-testid="objective">
            <span style={{ color: "var(--color-gold-hi)" }}>❧ </span>
            {snap.objective}
          </p>
        )}
      </div>

      {!touch && snap && (
        <div className="hm-calm absolute flex flex-col items-end gap-[0.3em]" style={{ right: "max(1.8em, env(safe-area-inset-right))", top: "max(1.2em, env(safe-area-inset-top))" }}>
          <Counters snap={snap} touch={false} />
          {showFps && <Fps snap={snap} />}
        </div>
      )}
      {touch && snap && showFps && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: "max(0.4em, env(safe-area-inset-bottom))" }}>
          <Fps snap={snap} />
        </div>
      )}

      {trial && (
        <div className="hm-fade absolute" style={touch ? { right: "max(1.2em, env(safe-area-inset-right))", top: "calc(max(1em, env(safe-area-inset-top)) + 4.4em)" } : { right: "max(1.8em, env(safe-area-inset-right))", top: "9em" }} data-testid="trial">
          <TrialPanel trial={trial} />
        </div>
      )}

      <div className="absolute flex flex-col gap-[0.4em]" style={{ left: "max(1.6em, env(safe-area-inset-left))", top: touch ? "9.5em" : "6.4em" }} data-testid="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="hm-toast flex items-center gap-[0.6em] pr-[1.4em]" style={{ background: "linear-gradient(90deg, rgb(8 25 28 / 0.82), rgb(8 25 28 / 0.55) 70%, transparent)", padding: "0.4em 1.6em 0.4em 0.6em", borderLeft: "2px solid var(--color-gold)" }}>
            <ToastIcon icon={t.icon} />
            <span className="flex flex-col leading-tight">
              <span className="font-display" style={{ fontSize: "1.1em", fontWeight: 600 }}>{t.text}</span>
              {t.sub && <span style={{ fontSize: "0.72em", color: "var(--color-mist)" }}>{t.sub}</span>}
            </span>
          </div>
        ))}
      </div>

      {banner && <BannerView key={banner.id} b={banner} />}

      {snap?.prompt && (
        <div key={snap.prompt} className="hm-chip-in absolute left-1/2 flex items-center gap-[0.7em]" style={{ bottom: touch ? "34%" : "14%", transform: "translateX(-50%)", padding: "0.45em 1.3em 0.45em 0.55em", background: "rgb(239 227 200 / 0.94)", color: "var(--color-ink)", border: "1px solid var(--color-gold-lo)", borderRadius: "2em", boxShadow: "0 0.3em 1em rgb(8 25 28 / 0.5), inset 0 0 0 0.18em rgb(248 240 221 / 0.8), inset 0 0 0 calc(0.18em + 1px) var(--color-gold)" }} data-testid="prompt">
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

      {boss && (
        <div className="hm-boss-in absolute left-1/2 -translate-x-1/2" style={touch ? { width: "50%", top: "calc(max(1em, env(safe-area-inset-top)) + 3.4em)" } : { width: "54%", bottom: "max(2.2em, env(safe-area-inset-bottom))" }} data-testid="boss">
          <BossScroll boss={boss} />
        </div>
      )}

      {/* stamina ring, lock reticle, aim reticle (per-frame, DOM refs) */}
      <div ref={stamBox} className="absolute left-0 top-0" style={{ opacity: 0, transition: "opacity .35s", width: "2.1em", height: "2.1em", marginLeft: "-1.05em", marginTop: "-1.05em", willChange: "transform" }} data-testid="stamina">
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

function Counters({ snap, touch }: { snap: HudSnapshot; touch: boolean }) {
  return (
    <div className={`flex ${touch ? "flex-row items-center gap-[1em]" : "flex-col items-end gap-[0.2em]"}`} data-testid="counters">
      <span key={snap.glimmers} className="hm-pop hm-shadow flex items-center gap-[0.4em]">
        <Diamond style={{ width: "1.05em", height: "1.3em", filter: "drop-shadow(0 0 0.3em rgb(232 199 102 / 0.6))" }} />
        <span className="font-display tabular-nums" style={{ fontSize: "1.5em", fontWeight: 700, lineHeight: 1 }} data-testid="glimmers">{snap.glimmers}</span>
      </span>
      {snap.hasBow && (
        <span className="hm-shadow flex items-center gap-[0.4em]" style={{ color: snap.arrows === 0 ? "var(--color-rubric)" : undefined }}>
          <Arrow style={{ width: "1.1em", height: "1.1em" }} />
          <span className="font-display tabular-nums" style={{ fontSize: "1.2em", fontWeight: 600, lineHeight: 1 }}>{snap.arrows}</span>
        </span>
      )}
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
  if (icon === "glimmer") return <Diamond style={s} />;
  if (icon === "arrow") return <Arrow style={s} />;
  if (icon === "quill") return <Quill style={s} />;
  if (icon === "flame") return <Flame style={s} />;
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
  const tint = b.kind === "gloam" ? "var(--color-gloam-hi)" : b.kind === "fail" ? "var(--color-rubric)" : b.color ?? "var(--color-gold-hi)";
  return (
    <div className="absolute inset-x-0 flex flex-col items-center text-center" style={{ top: big ? "24%" : "21%", ["--hm-banner-t" as string]: `${b.ms}ms` }} data-testid="banner">
      <div className="hm-banner absolute left-1/2 -translate-x-1/2" style={{ top: big ? "-5em" : "-2.5em", width: big ? "30em" : "28em", height: big ? "16em" : "10em", background: `radial-gradient(ellipse 50% 50% at 50% 55%, ${b.kind === "gloam" ? "rgb(52 30 68 / 0.6)" : big ? "rgb(120 60 20 / 0.45)" : "rgb(8 25 28 / 0.42)"}, transparent 72%)` }} />
      {b.kind === "beacon" && <Flame color={b.color} className="hm-banner" style={{ width: "2.6em", height: "3.2em", marginBottom: "0.4em", filter: `drop-shadow(0 0 1em ${b.color})` }} />}
      {b.sub && b.kind !== "area" && b.kind !== "time" && (
        <span className="hm-label hm-banner hm-shadow relative" style={{ color: tint, fontSize: "0.78em", marginBottom: "0.3em" }}>{b.kind === "trial" || b.kind === "fail" ? b.sub : ""}</span>
      )}
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
      <span className="hm-label hm-shadow" style={{ fontSize: "0.55em", marginTop: "0.2em", color: "var(--color-gloam-hi)" }}>Phase {["I", "II", "III"][Math.max(0, Math.min(2, boss.phase - 1))]}</span>
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
