"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Device } from "./contracts";
import { Corner, DropCap, Flame, FLAME_CORE, FLAME_PATH, Glyph, IlluminatedCapital, InkFrame, Lozenge, Quill, Rule } from "./ui-ink";
import { CREDITS, ENDING_TEXT, fmtTime, LORE_LINES, SHARD_TOTAL, type EndStats } from "./ui-store";

/* -------------------------------------------------------------------- title */

export type TitleAction = "continue" | "new" | "settings" | "controls" | "credits";

export function TitleScreen({ hasSave, onAction, busy }: { hasSave: boolean; onAction(a: TitleAction): void; busy?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const motes = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ left: `${8 + ((i * 53) % 84)}%`, top: `${62 + ((i * 29) % 34)}%`, delay: `${(i * 0.83) % 9}s`, dur: `${8 + (i % 5)}s` })), []);
  return (
    <div className="safe absolute inset-0 overflow-hidden" data-testid="title">
      <div className="hm-drift pointer-events-none absolute inset-[-6%]">
        <div className="absolute" style={{ right: "4%", top: "10%", width: "55%", height: "60%", background: "radial-gradient(ellipse at 60% 55%, rgb(240 138 60 / 0.32), rgb(228 138 91 / 0.12) 40%, transparent 70%)", filter: "blur(10px)" }} />
        <div className="absolute" style={{ left: "30%", top: "-10%", width: "70%", height: "50%", background: "radial-gradient(ellipse at 50% 50%, rgb(143 185 179 / 0.22), transparent 65%)", filter: "blur(14px)" }} />
      </div>
      <div className="hm-title-wash" />
      {motes.map((m, i) => (
        <span key={i} className="hm-mote" style={{ left: m.left, top: m.top, animationDelay: m.delay, animationDuration: m.dur }} />
      ))}
      <Corner pos="tl" color="var(--color-gold)" size="clamp(2.4rem, 8vh, 4.5rem)" />
      <Corner pos="bl" color="var(--color-gold)" size="clamp(2.4rem, 8vh, 4.5rem)" delay={150} />

      <div className="absolute inset-y-0 flex flex-col justify-center" style={{ left: "clamp(2rem, 7vw, 8rem)", width: "min(48rem, 62vw)" }}>
        <div className="hm-wash-in hm-wash-mask" style={{ animationDelay: "60ms" }}>
          <h1 className="flex items-end" aria-label="Hollowmere" style={{ gap: "0.4rem" }}>
            <IlluminatedCapital letter="H" size="clamp(5.2rem, 9vw, 7.4rem)" />
            <span className="font-display hm-foil" style={{ fontSize: "clamp(2.6rem, 4.6vw, 4.4rem)", fontWeight: 600, letterSpacing: "0.12em", lineHeight: 0.85, paddingBottom: "0.32rem", filter: "drop-shadow(0 0.15rem 0.5rem rgb(0 0 0 / 0.5))" }}>
              OLLOWMERE
            </span>
          </h1>
        </div>
        <div className="hm-rise" style={{ animationDelay: "500ms", marginTop: "1rem" }}>
          <Rule color="var(--color-gold)" style={{ width: "100%" }} />
          <p className="font-display italic" style={{ fontSize: "1.65rem", color: "var(--color-parchment)", marginTop: "0.35rem", textShadow: "0 0.1rem 0.6rem rgb(0 0 0 / 0.6)" }}>
            Wake the four beacons.
          </p>
        </div>
        <nav className="flex flex-col gap-[0.55rem]" style={{ marginTop: "clamp(1rem, 4.5vh, 2.6rem)", maxWidth: "24rem" }} aria-label="Title menu">
          {confirm ? (
            <div className="hm-fade flex flex-col gap-[0.55rem]">
              <p className="font-display italic" style={{ fontSize: "1.25rem", color: "var(--color-parchment)" }}>Begin anew? The journey you have will be written over.</p>
              <button className="hm-btn dark primary" data-nav="item" autoFocus onClick={() => onAction("new")} data-testid="confirm-new"><Lozenge />Begin anew</button>
              <button className="hm-btn dark" data-nav="item" onClick={() => setConfirm(false)}><Lozenge />Keep my journey</button>
            </div>
          ) : (
            <>
              {hasSave && (
                <button className="hm-btn dark primary hm-rise" style={{ animationDelay: "650ms" }} data-nav="item" disabled={busy} onClick={() => onAction("continue")} data-testid="continue">
                  <Lozenge />Continue<span className="hm-btn-sub" style={{ color: "var(--color-ember-hi)" }}>your journey</span>
                </button>
              )}
              <button className={`hm-btn dark hm-rise ${hasSave ? "" : "primary"}`} style={{ animationDelay: "720ms" }} data-nav="item" disabled={busy} onClick={() => (hasSave ? setConfirm(true) : onAction("new"))} data-testid="new-game">
                <Lozenge />New Journey
              </button>
              <button className="hm-btn dark hm-rise" style={{ animationDelay: "790ms" }} data-nav="item" onClick={() => onAction("settings")} data-testid="title-settings"><Lozenge />Settings</button>
              <button className="hm-btn dark hm-rise" style={{ animationDelay: "860ms" }} data-nav="item" onClick={() => onAction("controls")} data-testid="title-controls"><Lozenge />Controls</button>
              <button className="hm-btn dark hm-rise" style={{ animationDelay: "930ms" }} data-nav="item" onClick={() => onAction("credits")} data-testid="title-credits"><Lozenge />Credits</button>
            </>
          )}
        </nav>
      </div>
      <div className="hm-label absolute" style={{ right: "max(1.6rem, env(safe-area-inset-right))", bottom: "max(1.2rem, env(safe-area-inset-bottom))", color: "rgb(143 185 179 / 0.7)", fontSize: "0.62rem" }}>
        An island of four beacons · kalebkim.com
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ loading */

const WAVE_W = 600;
function waveY(x: number) {
  return 20 + Math.sin(x / 38) * 5 + Math.sin(x / 13) * 1.4;
}
const WAVE_D = (() => {
  let d = `M0 ${waveY(0).toFixed(2)}`;
  for (let x = 6; x <= WAVE_W; x += 6) d += `L${x} ${waveY(x).toFixed(2)}`;
  return d;
})();

export function LoadingScreen({ progress }: { progress: number }) {
  const [line, setLine] = useState(() => Math.floor(Math.random() * LORE_LINES.length));
  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LORE_LINES.length), 3600);
    return () => clearInterval(t);
  }, []);
  const p = Math.max(0.02, Math.min(1, progress));
  const x = p * WAVE_W;
  return (
    <div className="safe hm-parchment-dark absolute inset-0 flex flex-col items-center justify-center" data-testid="loading">
      <Corner pos="tl" color="var(--color-gold)" />
      <Corner pos="tr" color="var(--color-gold)" />
      <Corner pos="bl" color="var(--color-gold)" />
      <Corner pos="br" color="var(--color-gold)" />
      <div className="hm-label" style={{ color: "var(--color-gold-hi)", marginBottom: "1.2rem" }}>Kindling the lantern</div>
      <div className="relative" style={{ width: "min(40rem, 76vw)" }}>
        <svg viewBox={`0 -10 ${WAVE_W} 50`} className="w-full overflow-visible" style={{ height: "auto" }} aria-hidden>
          <path d={WAVE_D} fill="none" stroke="rgb(232 199 102 / 0.18)" strokeWidth="1" strokeDasharray="2 5" />
          <path d={WAVE_D} fill="none" stroke="var(--color-parchment)" strokeWidth="2.2" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: 1 - p, transition: "stroke-dashoffset 0.5s var(--ease-ink)" }} />
          {[0.25, 0.5, 0.75].map((t) => (
            <circle key={t} cx={t * WAVE_W} cy={waveY(t * WAVE_W)} r="3.2" fill={p >= t ? "var(--color-ember)" : "rgb(248 240 221 / 0.18)"} stroke="var(--color-night-deep)" strokeWidth="1.2" style={{ transition: "fill .4s" }} />
          ))}
          <g style={{ transform: `translate(${x}px, ${waveY(x)}px)`, transition: "transform 0.5s var(--ease-ink)" }}>
            <g className="hm-quill-bob">
              <foreignObject x="-6" y="-42" width="44" height="44">
                <Quill style={{ width: 44, height: 44 }} />
              </foreignObject>
            </g>
          </g>
        </svg>
      </div>
      <div className="relative flex items-center justify-center text-center" style={{ minHeight: "5.5rem", width: "min(36rem, 80vw)", marginTop: "1.8rem" }}>
        <p key={line} className="hm-lore-line font-display italic" style={{ fontSize: "1.55rem", lineHeight: 1.4, color: "var(--color-parchment)" }}>
          “{LORE_LINES[line]}”
        </p>
      </div>
      <div className="font-display tabular-nums" style={{ marginTop: "1rem", fontSize: "1rem", color: "var(--color-mist)" }}>{Math.round(p * 100)}%</div>
    </div>
  );
}

/* -------------------------------------------------------------------- death */

export function DeathScreen({ onRekindle, device }: { onRekindle(): void; device: Device }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1100);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="safe absolute inset-0 flex flex-col items-center justify-center text-center" style={{ background: "radial-gradient(ellipse 60% 55% at 50% 48%, rgb(8 25 28 / 0.55), rgb(8 25 28 / 0.94) 70%), linear-gradient(0deg, rgb(91 58 110 / 0.35), transparent 60%)" }} data-testid="death">
      <div className="relative" style={{ width: "6rem", height: "8rem" }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="hm-smoke absolute left-1/2 top-[1rem]" style={{ width: "1.6rem", height: "1.6rem", marginLeft: "-0.8rem", borderRadius: "50%", background: "radial-gradient(circle, rgb(164 124 198 / 0.5), transparent 70%)", animationDelay: `${0.6 + i * 1.1}s` }} />
        ))}
        <svg viewBox="0 0 24 34" className="absolute inset-0 h-full w-full" aria-hidden>
          <ellipse cx="12" cy="31.5" rx="8" ry="2" fill="var(--color-gold-lo)" />
          <g className="hm-gutter-out">
            <path d={FLAME_PATH} fill="url(#hm-ember-grad)" stroke="var(--color-ink)" strokeWidth="0.8" />
            <path d={FLAME_CORE} fill="var(--color-ember-hi)" />
          </g>
        </svg>
      </div>
      <h2 className="font-display hm-wash-in italic" style={{ fontSize: "clamp(2.8rem, 6vw, 4.4rem)", fontWeight: 600, color: "var(--color-parchment-hi)", marginTop: "0.6rem", textShadow: "0 0.2rem 1rem rgb(0 0 0 / 0.7)" }}>
        The lantern gutters
      </h2>
      <Rule color="var(--color-rubric)" style={{ width: "min(22rem, 60vw)", marginTop: "0.3rem" }} />
      <p className="font-display hm-rise italic" style={{ fontSize: "1.35rem", color: "var(--color-mist)", marginTop: "0.6rem", animationDelay: "500ms" }}>
        But an ember remembers. Rise again at the last flame you lit.
      </p>
      <div style={{ height: "4.5rem", marginTop: "1.4rem" }}>
        {ready && (
          <button className="hm-btn dark primary hm-rise" autoFocus data-nav="item" style={{ width: "auto", paddingRight: "2rem" }} onClick={onRekindle} data-testid="rekindle">
            <Lozenge />Rekindle
            {device !== "touch" && <span style={{ marginLeft: "0.6rem" }}><Glyph device={device} keys="Enter" pad="A" /></span>}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- ending */

export function EndingScreen({ stats, onFree }: { stats: EndStats; onFree(): void }) {
  const [roll, setRoll] = useState(false);
  const freeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!roll) freeRef.current?.focus({ preventScroll: true });
  }, [roll]);
  return (
    <div className="safe absolute inset-0 overflow-hidden" data-testid="ending">
      <div className="hm-dawn absolute inset-0 hm-fade" style={{ animationDuration: "2.4s" }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 100%, rgb(255 192 122 / 0.6), transparent 70%)" }} />
      {!roll ? (
        <div className="hm-scroll absolute inset-0 flex justify-center" style={{ padding: "clamp(0.8rem, 4vh, 3rem) 1rem" }}>
          <InkFrame className="hm-book-in my-auto" style={{ width: "min(46rem, 92vw)", padding: "clamp(1.4rem, 4vh, 3rem) clamp(1.6rem, 4vw, 3.4rem)", animationDelay: "600ms" }}>
            <div className="hm-label text-center" style={{ color: "var(--color-ember-lo)", marginBottom: "0.4rem" }}>The last page</div>
            <h2 className="font-display text-center" style={{ fontSize: "clamp(2.2rem, 4.5vw, 3.2rem)", fontWeight: 600, lineHeight: 1 }}>Hollowmere wakes</h2>
            <Rule color="var(--color-gold)" style={{ margin: "0.6rem 0 1rem" }} />
            <DropCap text={ENDING_TEXT[0]} size="4.2rem" />
            {ENDING_TEXT.slice(1).map((t) => (
              <p key={t} className="font-display" style={{ fontSize: "1.3rem", lineHeight: 1.5, marginTop: "0.6rem", clear: "none" }}>{t}</p>
            ))}
            <div className="grid grid-cols-3" style={{ clear: "both", marginTop: "1.3rem", paddingTop: "0.9rem", borderTop: "1px solid var(--color-ink-faint)" }}>
              {[
                ["Time on the island", fmtTime(stats.playTime)],
                ["Glimmers found", `${stats.glimmers}`],
                ["Heart shards", `${stats.shards} / ${SHARD_TOTAL}`],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col items-center text-center">
                  <span className="font-display tabular-nums" style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--color-ember-lo)" }}>{v}</span>
                  <span className="hm-label" style={{ fontSize: "0.6rem", color: "var(--color-ink-soft)" }}>{k}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-[0.8rem]" style={{ marginTop: "1.4rem" }}>
              <button className="hm-btn" style={{ width: "auto" }} data-nav="item" onClick={() => setRoll(true)} data-testid="roll-credits"><Lozenge />Roll the credits</button>
              <button ref={freeRef} className="hm-btn primary" style={{ width: "auto" }} data-nav="item" onClick={onFree} data-testid="explore"><Lozenge />Explore freely</button>
            </div>
          </InkFrame>
        </div>
      ) : (
        <CreditsRoll onDone={onFree} />
      )}
    </div>
  );
}

function CreditsRoll({ onDone }: { onDone(): void }) {
  return (
    <div className="absolute inset-0 hm-fade" style={{ background: "rgb(8 25 28 / 0.82)" }} data-testid="credits-roll">
      <div className="hm-scroll absolute inset-0 overflow-hidden" style={{ maskImage: "linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent)" }}>
        <div className="hm-credits-roll flex flex-col items-center text-center" style={{ paddingTop: "100vh", ["--hm-roll-t" as string]: "30s" }} onAnimationEnd={onDone}>
          <IlluminatedCapital letter="H" size="6rem" />
          <div className="font-display hm-foil" style={{ fontSize: "3rem", fontWeight: 600, letterSpacing: "0.14em", marginTop: "0.8rem" }}>HOLLOWMERE</div>
          <Rule color="var(--color-gold)" style={{ width: "18rem", margin: "1rem 0 2.5rem" }} />
          {CREDITS.map((c) => (
            <div key={c.role} style={{ marginBottom: "2.6rem" }}>
              <div className="hm-label" style={{ color: "var(--color-gold-hi)", marginBottom: "0.4rem" }}>{c.role}</div>
              {c.names.map((n) => (
                <div key={n} className="font-display" style={{ fontSize: "1.9rem", color: "var(--color-parchment-hi)", lineHeight: 1.3 }}>{n}</div>
              ))}
            </div>
          ))}
          <Flame style={{ width: "2.4rem", height: "3rem", marginTop: "2rem", filter: "drop-shadow(0 0 1rem var(--color-ember))" }} />
          <p className="font-display italic" style={{ fontSize: "1.6rem", color: "var(--color-parchment)", marginTop: "1rem", marginBottom: "50vh" }}>Thank you for carrying the light.</p>
        </div>
      </div>
      <button className="hm-btn dark absolute" style={{ width: "auto", right: "max(1.6rem, env(safe-area-inset-right))", bottom: "max(1.4rem, env(safe-area-inset-bottom))" }} data-nav="item" autoFocus onClick={onDone} data-testid="skip-credits">
        <Lozenge />Explore freely
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- read panel */

export function ReadPanel({ title, text, device, onClose }: { title: string; text: string; device: Device; onClose(): void }) {
  return (
    <div className="safe absolute inset-0 flex items-center justify-center" style={{ background: "rgb(8 25 28 / 0.55)" }} data-testid="read">
      <InkFrame className="hm-book-in" style={{ width: "min(36rem, 88vw)", maxHeight: "86dvh", padding: "2rem 2.6rem 1.6rem", overflow: "auto" }}>
        <div className="hm-label text-center" style={{ color: "var(--color-ember-lo)" }}>A carved stone reads</div>
        <h3 className="font-display text-center" style={{ fontSize: "2.1rem", fontWeight: 600, lineHeight: 1.1, marginTop: "0.2rem" }}>
          <span style={{ color: "var(--color-rubric)" }}>{title[0]}</span>
          {title.slice(1)}
        </h3>
        <Rule color="var(--color-gold)" style={{ margin: "0.5rem 0 0.9rem" }} />
        <p className="font-display italic" style={{ fontSize: "1.4rem", lineHeight: 1.5, textAlign: "center" }}>{text}</p>
        <div className="flex justify-center" style={{ marginTop: "1.3rem" }}>
          <button className="hm-btn" style={{ width: "auto" }} autoFocus data-nav="item" onClick={onClose} data-testid="read-close">
            <Lozenge />Close
            {device !== "touch" && <span style={{ marginLeft: "0.5rem" }}><Glyph device={device} keys="E" pad="B" /></span>}
          </button>
        </div>
      </InkFrame>
    </div>
  );
}

/* ------------------------------------------------------------ rotate prompt */

export function RotatePrompt() {
  return (
    <div className="rotate-prompt hm-parchment-dark safe absolute inset-0 z-50 flex-col items-center justify-center gap-[1.6rem] text-center" data-testid="rotate">
      <Corner pos="tl" color="var(--color-gold)" size="4rem" />
      <Corner pos="tr" color="var(--color-gold)" size="4rem" />
      <Corner pos="bl" color="var(--color-gold)" size="4rem" />
      <Corner pos="br" color="var(--color-gold)" size="4rem" />
      <svg viewBox="0 0 80 80" style={{ width: "6.5rem", height: "6.5rem" }} aria-hidden>
        <path d="M58 14A32 32 0 0 1 70 46" stroke="var(--color-gold)" strokeWidth="1.6" fill="none" strokeDasharray="3 3" />
        <path d="M70 46l-4.5-5M70 46l4-5.5" stroke="var(--color-gold)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <g className="hm-turn" style={{ transformOrigin: "40px 40px" }}>
          <rect x="27" y="14" width="26" height="52" rx="5" fill="rgb(15 46 51 / 0.8)" stroke="var(--color-parchment)" strokeWidth="2" />
          <path d={FLAME_PATH} transform="translate(33 30) scale(0.6)" fill="var(--color-ember)" />
          <path d="M37 60h6" stroke="var(--color-parchment)" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </svg>
      <div>
        <h2 className="font-display italic" style={{ fontSize: "2.4rem", fontWeight: 600, color: "var(--color-parchment-hi)", lineHeight: 1.1 }}>Turn your device sideways</h2>
        <p className="font-display italic" style={{ fontSize: "1.3rem", color: "var(--color-mist)", marginTop: "0.5rem" }}>Hollowmere is wider than it is tall.</p>
      </div>
    </div>
  );
}
