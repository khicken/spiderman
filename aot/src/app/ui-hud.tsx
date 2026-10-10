"use client";

import { useId } from "react";
import type { HudState, TitanBlip, TitanKind, TitanPart } from "./contracts";
import type { UiEvent } from "./game";
import type { Character } from "./progression-chars";
import { BOSS, isBoss } from "./titan-waves";
import { Brush, SHIELD_PATH, TitanIcon } from "./ui-art";
import { HELP, keyFor } from "./ui-controls";
import { Key } from "./ui-menu";
import { Tracker } from "./ui-run";

export type Pop = UiEvent & { id: number };
export type Msgs = { banner: Pop | null; radio: Pop | null; callout: Pop | null };
type Lock = NonNullable<HudState["lock"]>;

const PERFECT = 0.85;
const RED = "#ff3b2a";
const BONE = "#efe6d2";
const GLOW = "#9fe3ff";

export const PARTS: Record<TitanPart, { jp: string; en: string }> = {
  nape: { jp: "うなじ", en: "NAPE" },
  eyes: { jp: "目", en: "EYES" },
  armL: { jp: "腕", en: "ARM L" },
  armR: { jp: "腕", en: "ARM R" },
  legL: { jp: "脚", en: "LEG L" },
  legR: { jp: "脚", en: "LEG R" },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pad = (n: number, w: number) =>
  String(Math.max(0, Math.floor(n))).padStart(w, "0");

function arc(r: number, from: number, to: number) {
  const p = (t: number) => {
    const a = t * Math.PI * 2 - Math.PI / 2;
    return `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  };
  const span = Math.min(to - from, 0.9999);
  return `M${p(from)} A${r} ${r} 0 ${span > 0.5 ? 1 : 0} 1 ${p(from + span)}`;
}

export function Hud({
  h,
  pops,
  msgs,
  touch,
  who,
  final,
  onSkip,
}: {
  h: HudState;
  pops: Pop[];
  msgs: Msgs;
  touch: boolean;
  who: Character | null;
  final: boolean;
  onSkip: () => void;
}) {
  if (h.intro) return <Intro onSkip={onSkip} />;
  const b = msgs.banner;
  const free = !h.dead && h.escape === null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-cond text-bone">
      <Vignettes h={h} pops={pops} />
      <Compass blips={h.blips} depots={h.depots} low={lowSupply(h)} />
      {h.boss && <BossBar boss={h.boss} />}
      <WavePanel h={h} />
      <KillPanel h={h} />
      {free && <Crosshair h={h} />}
      {free && msgs.callout?.type === "callout" && <Callout key={msgs.callout.id} text={msgs.callout.text} />}
      {free && !h.shift.active && <Prompt h={h} touch={touch} />}
      <Toasts pops={pops} touch={touch} />
      <ScorePops pops={pops} />
      {h.combo > 1 && <Combo n={h.combo} />}
      <GearPanel h={h} who={who} />
      <SpeedPanel h={h} />
      {msgs.radio?.type === "radio" && <Radio key={msgs.radio.id} who={msgs.radio.who} text={msgs.radio.text} />}
      {h.escape !== null && !h.dead && <Grab escape={h.escape} touch={touch} />}
      {b?.type === "kill" && <KillBanner key={b.id} height={b.height} speed={b.speed} kind={b.kind} />}
      {b?.type === "banner" && <Banner key={b.id} jp={b.jp} en={b.en} text={b.text} />}
      {h.dead && <Dead final={final} />}
    </div>
  );
}

function Intro({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden text-bone">
      <div className="letterbox absolute inset-x-0 top-0 h-[12vh] origin-top bg-black" />
      <div className="letterbox absolute inset-x-0 bottom-0 flex h-[12vh] origin-bottom items-center justify-end gap-4 bg-black px-[4vw]">
        <span data-keyhint className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-bone/60">
          Press <Key>Enter</Key> to skip
        </span>
        <button
          onClick={onSkip}
          className="plate pointer-events-auto cursor-pointer border border-brass/50 bg-char px-5 py-1.5 font-display text-lg uppercase tracking-widest text-bone transition-colors hover:bg-blood"
        >
          Skip
        </button>
      </div>
      <div className="absolute bottom-[17vh] left-[6vw] flex items-stretch gap-4">
        <div className="brush-in w-1.5 bg-blood" />
        <div>
          <div className="slow-fade font-jp text-[clamp(1rem,2.6vh,1.6rem)] font-bold tracking-[0.4em] text-parch">
            シガンシナ区
          </div>
          <div className="brush-in font-display text-[clamp(2.4rem,8vh,5.5rem)] uppercase leading-[0.95] tracking-[0.04em] ink-shadow">
            Shiganshina District
          </div>
          <div className="slow-fade mt-2 flex items-baseline gap-3 text-[clamp(1rem,2.8vh,1.75rem)] text-bone/85 ink-shadow">
            <span className="font-jp font-bold tracking-[0.2em]">845年</span>
            <span className="font-display tracking-[0.12em]">Year 845</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Vignettes({ h, pops }: { h: HudState; pops: Pop[] }) {
  const low = !h.dead && h.health < 0.3;
  return (
    <>
      {low && (
        <div className="blink absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(160,0,0,0.45)_100%)]" />
      )}
      {pops.map((p) =>
        p.type === "hurt" ? (
          <div
            key={p.id}
            className="hurt-flash absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(200,0,0,0.75)_100%)]"
            style={{ opacity: Math.min(1, 0.4 + p.amount * 3) }}
          />
        ) : null,
      )}
      {h.escape !== null && (
        <div className="absolute inset-0 shadow-[inset_0_0_120px_30px_rgba(150,0,0,0.85)]" />
      )}
    </>
  );
}

const SPAN = (100 * Math.PI) / 180;
const lowSupply = (h: HudState) => !h.supply && (h.gas < 0.25 || (h.blades === 0 && h.sharp < 0.5));
const nearest = <T extends { dist: number }>(list: T[]) => list.reduce<T | undefined>((m, d) => (!m || d.dist < m.dist ? d : m), undefined);

export function DepotArrow({ h }: { h: HudState }) {
  const d = nearest(h.depots);
  if (!d || h.dead || !lowSupply(h)) return null;
  return (
    <div className="absolute left-0 top-0 [transform:rotate(var(--depot,0rad))]">
      <div className="absolute left-0 top-[calc(min(30vh,34vw)*-1)] flex -translate-x-1/2 flex-col items-center">
        <div className="mb-1 whitespace-nowrap bg-ink/70 px-2 py-0.5 font-cond text-xs font-semibold uppercase tracking-[0.2em] text-[#bff0c8] [transform:rotate(calc(var(--depot,0rad)*-1))]">
          <span className="mr-1.5 font-jp">補給</span>
          {Math.round(d.dist)}m
        </div>
        <svg viewBox="0 0 24 16" className="blink h-6 w-9 text-[#6fdc8c] drop-shadow-[0_0_6px_rgba(80,220,120,0.95)]">
          <path d="M12 0L24 16L12 10L0 16Z" fill="currentColor" stroke="#0b0807" strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  );
}

function Compass({ blips, depots, low }: { blips: TitanBlip[]; depots: HudState["depots"]; low: boolean }) {
  const depot = nearest(depots);
  const near = [...blips].sort((a, b) => a.dist - b.dist).slice(0, 3);
  return (
    <div className="hud-z absolute left-1/2 top-3 -translate-x-1/2">
      <div className="relative h-[54px] w-[520px] overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-[30px] bg-gradient-to-r from-transparent via-ink/70 to-transparent" />
        <div className="absolute inset-x-6 bottom-[30px] h-px bg-gradient-to-r from-transparent via-brass/70 to-transparent" />
        {Array.from({ length: 15 }, (_, i) => {
          const x = (i / 14) * 100;
          return (
            <div
              key={i}
              className={`absolute bottom-[22px] w-px bg-bone/40 ${i % 7 === 0 ? "h-3" : "h-1.5"}`}
              style={{ left: `${x}%` }}
            />
          );
        })}
        <svg
          viewBox="0 0 10 6"
          className="absolute bottom-[28px] left-1/2 h-2 w-3 -translate-x-1/2 text-brass"
        >
          <path d="M0 0h10L5 6Z" fill="currentColor" />
        </svg>
        {depots.map((d, i) => {
          const behind = Math.abs(d.bearing) > SPAN;
          const x = 50 + (Math.max(-SPAN, Math.min(SPAN, -d.bearing)) / SPAN) * 47;
          return (
            <div
              key={`d${i}`}
              className="absolute bottom-[4px] flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${x}%`, opacity: behind && !(low && d === depot) ? 0.4 : 0.95 }}
            >
              <svg viewBox="0 0 10 14" className={`text-[#6fdc8c] drop-shadow-[0_0_3px_rgba(80,220,120,0.9)] ${low && d === depot ? "blink h-5 w-3.5" : "h-3.5 w-2.5"}`}>
                <path d="M5 0C8 3 9 5 7 8C9 9 8 13 5 14C2 13 1 9 3 8C1 5 2 3 5 0Z" fill="currentColor" />
              </svg>
              <span className={`mt-px font-cond text-[9px] leading-none tabular-nums ${d === depot ? "text-[#bff0c8]" : "text-transparent"}`}>
                {Math.round(d.dist)}m
              </span>
            </div>
          );
        })}
        {blips.map((b, i) => {
          const behind = Math.abs(b.bearing) > SPAN;
          const x =
            50 + (Math.max(-SPAN, Math.min(SPAN, -b.bearing)) / SPAN) * 47;
          const tall = 8 + Math.min(b.height, 20) * 1.15;
          const red = b.kind !== "normal";
          const w = b.kind === "crawler" ? tall * 1.6 : tall / 2;
          const show = near.includes(b);
          return (
            <div
              key={i}
              className="absolute bottom-[4px] flex -translate-x-1/2 flex-col items-center"
              style={{
                left: `${x}%`,
                opacity: behind ? 0.35 : 1 - Math.min(b.dist, 350) / 600,
              }}
            >
              <TitanIcon
                kind={b.kind}
                className={
                  red
                    ? "text-ember drop-shadow-[0_0_4px_rgba(255,40,20,0.9)]"
                    : "text-parch drop-shadow-[0_0_2px_#000]"
                }
                style={{
                  height: b.kind === "crawler" ? tall / 2 : tall,
                  width: w,
                }}
              />
              <span
                className={`mt-px font-cond text-[9px] leading-none tabular-nums ${show ? "text-bone/80" : "text-transparent"}`}
              >
                {Math.round(b.dist)}m
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BossBar({ boss }: { boss: NonNullable<HudState["boss"]> }) {
  return (
    <div className="hud-z absolute left-1/2 top-[66px] w-[560px] -translate-x-1/2">
      <div className="flex items-end justify-between px-1">
        <div className="flex items-baseline gap-3">
          <span className="font-jp text-sm font-black tracking-[0.2em] text-ember">
            {isBoss(boss.kind) ? BOSS[boss.kind].jp : "巨人"}
          </span>
          <span className="font-display text-2xl uppercase tracking-wide ink-shadow">
            {boss.name}
          </span>
        </div>
        {boss.hardened && (
          <span className="blink font-cond text-xs font-semibold uppercase tracking-[0.3em] text-crystal">
            <span className="mr-2 font-jp">硬質化</span>Hardened
          </span>
        )}
      </div>
      <div
        className={`relative mt-1 h-3.5 -skew-x-[20deg] border border-black bg-black/70 ${boss.hardened ? "shadow-[0_0_0_1px_#9fe3ff,0_0_12px_rgba(159,227,255,0.6)]" : "shadow-[0_0_0_1px_rgba(201,162,90,0.5)]"}`}
      >
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${boss.hardened ? "bg-gradient-to-b from-[#d8f6ff] to-[#4fa9d6]" : "bg-gradient-to-b from-[#ff5a3a] to-[#8e0b10]"}`}
          style={{
            width: `${clamp01(boss.health) * 100}%`,
            backgroundImage: boss.hardened
              ? "repeating-linear-gradient(60deg, rgba(255,255,255,0.5) 0 2px, transparent 2px 9px), repeating-linear-gradient(-60deg, rgba(255,255,255,0.5) 0 2px, transparent 2px 9px), linear-gradient(#cdf3ff, #3d8fc0)"
              : undefined,
          }}
        />
        {[0.25, 0.5, 0.75].map((t) => (
          <div
            key={t}
            className="absolute inset-y-0 w-px bg-black/70"
            style={{ left: `${t * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function WavePanel({ h }: { h: HudState }) {
  return (
    <div className="hud-z absolute left-4 top-3 origin-top-left">
      <div className="relative pl-3">
        <div className="absolute bottom-1 left-0 top-1 w-1 bg-blood" />
        {h.wave > 0 && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-cond text-xs font-semibold uppercase tracking-[0.35em] text-brass">
                Wave
              </span>
              <span className="font-jp text-xs font-bold text-bone/50">襲来</span>
            </div>
            <div className="font-display text-5xl leading-none tracking-wide ink-shadow">
              {pad(h.wave, 2)}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm uppercase tracking-[0.15em] ink-shadow">
              <TitanIcon kind="normal" className="h-4 w-2 text-ember" />
              <span className="font-display text-lg tabular-nums tracking-normal">
                {h.left}
              </span>
              <span className="text-bone/70">
                {h.left === 1 ? "titan remains" : "titans remain"}
              </span>
            </div>
          </>
        )}
        {h.breakT > 0 && (
          <div className="mt-1 text-xs uppercase tracking-[0.25em] text-parch/80">
            Next wave in{" "}
            <span className="font-display text-base normal-case tabular-nums tracking-normal text-bone">
              {Math.ceil(h.breakT)}s
            </span>
          </div>
        )}
        {h.wave > 0 && <Tracker run={h.run} />}
      </div>
    </div>
  );
}

function KillPanel({ h }: { h: HudState }) {
  return (
    <div className="hud-z absolute right-4 top-3 origin-top-right text-right">
      <div className="flex items-center justify-end gap-3">
        <div className="font-brush text-3xl leading-none text-ember [writing-mode:vertical-rl] ink-shadow">
          討伐数
        </div>
        <div>
          <div className="font-display text-6xl leading-none tabular-nums ink-shadow">
            {h.kills}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-brass">
            Kills
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-end gap-2 border-t border-brass/40 pt-1">
        <span className="text-[11px] uppercase tracking-[0.3em] text-bone/60">
          Score
        </span>
        <span className="font-display text-2xl tabular-nums tracking-wide ink-shadow">
          {pad(h.score, 7)}
        </span>
      </div>
      <div data-keyhint className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-[0.25em] text-bone/55">
        <Key>{HELP.key}</Key> Controls
      </div>
    </div>
  );
}

function Crosshair({ h }: { h: HudState }) {
  const color = h.aim === "titan" ? RED : BONE;
  const dim = h.aim === "none" ? 0.3 : 0.95;
  const c = h.charge;
  const perfect = c !== null && c >= PERFECT;
  return (
    <div className="hud-z absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg
        viewBox="-60 -60 120 120"
        className="h-[120px] w-[120px] overflow-visible"
      >
        <g opacity={dim} stroke={color} strokeWidth="1.6" fill="none">
          <path d="M-7 0h-4M7 0h4M0 -7v-4M0 7v4" />
          <circle r="1.6" fill={color} stroke="none" />
        </g>
        {([-1, 1] as const).map((s, i) => {
          const on = h.hooks[i];
          return (
            <path
              key={s}
              d={`M${s * 18} -9 L${s * 25} 0 L${s * 18} 9`}
              fill="none"
              strokeWidth={on ? 3 : 2}
              stroke={on ? GLOW : color}
              opacity={on ? 1 : dim * 0.7}
              style={
                on ? { filter: `drop-shadow(0 0 4px ${GLOW})` } : undefined
              }
            />
          );
        })}
        {c !== null && (
          <g>
            <circle
              r="38"
              fill="none"
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="6"
            />
            <path
              d={arc(38, PERFECT, 1)}
              fill="none"
              stroke="#c9a25a"
              strokeWidth="6"
              opacity={perfect ? 1 : 0.55}
            />
            <path
              d={arc(38, 0, Math.max(0.001, clamp01(c)))}
              fill="none"
              stroke={perfect ? "#ffd27a" : BONE}
              strokeWidth="3.5"
              style={
                perfect ? { filter: "drop-shadow(0 0 6px #ffb52e)" } : undefined
              }
            />
          </g>
        )}
      </svg>
      {h.aim !== "none" && (
        <div
          className="absolute left-1/2 top-[104px] -translate-x-1/2 font-cond text-xs tabular-nums tracking-wider ink-shadow"
          style={{ color, opacity: dim }}
        >
          {Math.round(h.aimDist)}m
        </div>
      )}
      {perfect && (
        <div className="absolute left-1/2 top-[-22px] -translate-x-1/2 font-brush text-3xl text-[#ffd27a] ink-shadow">
          斬
        </div>
      )}
    </div>
  );
}

function Prompt({ h, touch }: { h: HudState; touch: boolean }) {
  const hint = h.hint;
  if (!hint) return null;
  return (
    <div className="hud-z prompt plate absolute left-1/2 top-[calc(50%+120px)] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap border-l-4 border-brass bg-ink/80 py-1.5 pl-3 pr-4 text-sm uppercase tracking-[0.15em]">
      {!touch && hint.key && <Key>{hint.key}</Key>}
      {touch ? (hint.touch ?? hint.text) : hint.text}
    </div>
  );
}

function Callout({ text }: { text: string }) {
  return (
    <div
      className="toast-in hud-z absolute left-1/2 top-[calc(50%-96px)] -translate-x-1/2 whitespace-nowrap font-display text-2xl uppercase tracking-wide text-[#ffd27a] ink-shadow"
      style={{ animationDuration: "1.6s" }}
    >
      {text}
    </div>
  );
}

function Radio({ who, text }: { who: string; text: string }) {
  return (
    <div
      className="toast-in hud-z radio absolute bottom-[84px] left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink/60 px-3 py-1 text-sm ink-shadow"
      style={{ animationDuration: "3.2s" }}
    >
      <span className="mr-2 font-semibold uppercase tracking-[0.2em] text-[#8fd6a0]">{who}</span>
      {text}
    </div>
  );
}

function Banner({ jp, en, text }: { jp: string; en: string; text?: string }) {
  return (
    <div className="hud-z absolute left-1/2 top-[22%] w-[min(760px,90vw)] -translate-x-1/2">
      <div className="kill-banner" style={{ animationDuration: "2.8s" }}>
        <div className="relative">
          <Brush className="brush-in absolute -inset-x-8 -inset-y-6 h-[calc(100%+3rem)] w-[calc(100%+4rem)]" />
          <div className="relative flex items-center justify-center gap-5 py-3">
            <span className="font-jp text-5xl font-black leading-none text-black">{jp}</span>
            <span className="font-display text-6xl uppercase leading-none tracking-wide text-bone [text-shadow:4px_4px_0_#000]">{en}</span>
          </div>
        </div>
        {text && <div className="mt-4 text-center font-display text-xl uppercase tracking-widest ink-shadow">{text}</div>}
      </div>
    </div>
  );
}

export function LockReticle({ lock }: { lock: Lock | null }) {
  if (!lock) return null;
  const p = PARTS[lock.part];
  const nape = lock.part === "nape";
  const col = nape ? "#ffcf6b" : RED;
  return (
    <div className="absolute left-0 top-0">
      <svg
        viewBox="-50 -50 100 100"
        className="absolute h-[100px] w-[100px] -translate-x-1/2 -translate-y-1/2 overflow-visible"
      >
        <g className="spin" style={{ transformOrigin: "0 0" }}>
          <circle
            r="34"
            fill="none"
            stroke={col}
            strokeWidth="2"
            strokeDasharray="14 7"
            opacity="0.9"
          />
        </g>
        <g
          className="spin-rev"
          style={{ transformOrigin: "0 0" }}
          stroke={col}
          strokeWidth="2.5"
          fill="none"
        >
          <path d="M-22 -14v-8h8M22 -14v-8h-8M-22 14v8h8M22 14v8h-8" />
        </g>
        <circle r="44" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="4" />
        <path
          d={arc(44, 0, Math.max(0.001, clamp01(lock.health)))}
          fill="none"
          stroke={col}
          strokeWidth="4"
        />
        <path d="M0 -4L4 0L0 4L-4 0Z" fill={col} />
      </svg>
      <div className="absolute left-[54px] top-0 -translate-y-1/2 whitespace-nowrap ink-shadow">
        <div className="flex items-baseline gap-2">
          <span
            className="font-jp text-2xl font-black leading-none"
            style={{ color: col }}
          >
            {p.jp}
          </span>
          <span className="font-display text-xl leading-none tracking-wider text-bone">
            {p.en}
          </span>
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.25em] text-bone/70">
          {lock.name} · {Math.round(lock.height)} m tall
        </div>
      </div>
    </div>
  );
}

function Toasts({ pops, touch }: { pops: Pop[]; touch: boolean }) {
  return (
    <div className="hud-z absolute left-4 top-[34%] flex w-[300px] origin-left flex-col gap-2">
      {pops.map((p) =>
        p.type === "toast" ? (
          <div
            key={p.id}
            className="toast-in plate relative border-l-4 border-blood bg-gradient-to-r from-ink/90 to-ink/40 py-2 pl-3 pr-4"
          >
            <div className="font-display text-lg uppercase leading-tight tracking-wide">
              {p.title}
            </div>
            {(touch ? (p.touch ?? p.text) : p.text) && (
              <div className="text-sm leading-snug text-bone/75">{touch ? (p.touch ?? p.text) : p.text}</div>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}

function ScorePops({ pops }: { pops: Pop[] }) {
  return (
    <div className="hud-z absolute right-6 top-[38%] flex origin-right flex-col items-end gap-1">
      {pops.map((p) =>
        p.type === "score" ? (
          <div
            key={p.id}
            className="score-pop flex items-baseline gap-2 ink-shadow"
          >
            <span className="text-xs uppercase tracking-[0.2em] text-bone/80">
              {p.reason}
            </span>
            <span className="font-display text-2xl text-brass">
              +{p.amount}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

function Combo({ n }: { n: number }) {
  return (
    <div
      key={n}
      className="hud-z absolute right-6 top-[58%] origin-right text-right"
    >
      <div className="rise-in flex items-baseline justify-end gap-2 ink-shadow">
        <span className="font-display text-2xl text-bone/70">×</span>
        <span className="font-display text-6xl italic leading-none text-bone">
          {n}
        </span>
      </div>
      <div className="text-xs font-semibold uppercase tracking-[0.35em] text-ember">
        <span className="mr-2 font-jp">連撃</span>Combo
      </div>
    </div>
  );
}

function Canister({ level }: { level: number }) {
  const id = useId().replace(/:/g, "");
  const low = level < 0.2;
  return (
    <svg viewBox="0 0 24 84" className="h-[84px] w-6">
      <rect x="7" y="0" width="10" height="6" fill="#6d6458" />
      <rect
        x="2"
        y="5"
        width="20"
        height="78"
        rx="9"
        fill="#0f0c0a"
        stroke="#9e9282"
        strokeWidth="1.5"
      />
      <clipPath id={`can${id}`}>
        <rect x="4" y="7" width="16" height="74" rx="7" />
      </clipPath>
      <g clipPath={`url(#can${id})`}>
        <rect
          x="4"
          y={7 + 74 * (1 - level)}
          width="16"
          height={74 * level}
          fill={low ? "#d1281e" : "#bfe6f2"}
          className={low ? "blink" : ""}
        />
        <rect x="6" y="7" width="3" height="74" fill="rgba(255,255,255,0.25)" />
      </g>
      {[0.25, 0.5, 0.75].map((t) => (
        <rect
          key={t}
          x="4"
          y={7 + 74 * t}
          width="5"
          height="1"
          fill="rgba(0,0,0,0.6)"
        />
      ))}
    </svg>
  );
}

function GearPanel({ h, who }: { h: HudState; who: Character | null }) {
  const hp = clamp01(h.health);
  const hpColor = hp > 0.5 ? "#4f8a5b" : hp > 0.25 ? "#d79a2b" : "#c3161c";
  const gas = clamp01(h.gas);
  const sharp = clamp01(h.sharp);
  const sharpColor =
    sharp > 0.5 ? "#dfe8ee" : sharp > 0.2 ? "#e9a23b" : "#e23a2a";
  return (
    <div className="hud-z absolute bottom-4 left-4 origin-bottom-left">
      <div className="plate mb-2 inline-flex items-baseline gap-3 bg-ink/75 py-1 pl-2 pr-3">
        {who && (
          <span className="flex items-baseline gap-2">
            <span className="font-jp text-xs font-bold text-ember">{who.jp}</span>
            <span className="font-display text-lg uppercase leading-none tracking-wide">{who.name}</span>
          </span>
        )}
        {h.squad.max > 0 && (
          <span className="flex items-baseline gap-1.5 text-xs uppercase tracking-[0.2em] text-bone/80">
            <span className="font-jp text-bone/60">分隊</span>
            <span className="font-display text-base tabular-nums tracking-normal text-bone">
              {h.squad.alive}/{h.squad.max}
            </span>
            <span className={h.squad.order === "attack" ? "text-ember" : "text-[#8fd6a0]"}>
              {h.squad.order === "attack" ? "Attack" : "Regroup"}
            </span>
            <span data-keyhint className="ml-1"><Key>G</Key></span>
          </span>
        )}
      </div>
      <ShiftTeam h={h} />
      {h.supply && (
        <div className="blink mb-2 inline-flex items-center gap-2 border border-[#6fbf7f]/60 bg-corps/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#bff0c8]">
          <span className="font-jp">補給</span> Resupplying
        </div>
      )}
      <div className="plate relative flex items-end gap-4 border border-brass/40 bg-gradient-to-br from-ink/85 to-char/60 px-4 pb-3 pt-3">
        <div className="relative h-[96px] w-[92px]">
          <svg viewBox="0 0 200 206" className="absolute inset-0 h-full w-full">
            <clipPath id="hp-clip">
              <path d={SHIELD_PATH} />
            </clipPath>
            <path d={SHIELD_PATH} fill="#120c08" />
            <rect
              clipPath="url(#hp-clip)"
              x="0"
              y={206 * (1 - hp)}
              width="200"
              height={206 * hp}
              fill={hpColor}
              opacity="0.85"
            />
            <path
              d={SHIELD_PATH}
              fill="none"
              stroke="#c9a25a"
              strokeWidth="7"
            />
          </svg>
          <div className="absolute inset-x-0 top-[34%] text-center font-display text-2xl leading-none ink-shadow">
            {Math.round(hp * 100)}
          </div>
          <div className="absolute inset-x-0 bottom-[-2px] text-center text-[9px] font-semibold uppercase tracking-[0.25em] text-bone/70">
            Health
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex gap-1.5">
            <Canister level={clamp01(gas * 2 - 1)} />
            <Canister level={clamp01(gas * 2)} />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 text-[9px] font-semibold uppercase tracking-[0.25em] text-bone/70">
            Gas{" "}
            <span className="font-display text-xs tracking-wide text-bone">
              {Math.round(gas * 100)}
            </span>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-bone/70">
              Spares
            </span>
            <span className="font-display text-sm">{h.blades}</span>
          </div>
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-1">
            {Array.from({ length: 8 }, (_, i) => (
              <svg key={i} viewBox="0 0 10 36" className="h-8 w-[9px]">
                <path
                  d="M2 36V6L8 0V30Z"
                  fill={i < h.blades ? "#dfe8ee" : "rgba(239,230,210,0.12)"}
                  stroke={i < h.blades ? "#5c6770" : "none"}
                  strokeWidth="0.8"
                />
              </svg>
            ))}
          </div>
          <div className="mt-2 h-2 w-[86px] -skew-x-[25deg] border border-black bg-black/70">
            <div
              className="h-full transition-[width] duration-200"
              style={{ width: `${sharp * 100}%`, background: sharpColor }}
            />
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-bone/60">
            Edge
          </div>
        </div>
      </div>
    </div>
  );
}

function Meter({ v, color }: { v: number; color: string }) {
  return (
    <span className="inline-block h-2 w-14 -skew-x-[25deg] border border-black bg-black/70">
      <span className="block h-full" style={{ width: `${clamp01(v) * 100}%`, background: color }} />
    </span>
  );
}

function ShiftTeam({ h }: { h: HudState }) {
  const { meter, active, hp } = h.shift;
  const team = h.squad.max > 0;
  if (!team && meter <= 0 && !active) return null;
  return (
    <div className="plate mb-2 flex items-center gap-4 bg-ink/75 py-1 pl-2 pr-3 text-xs uppercase tracking-[0.2em] text-bone/80">
      <span className={`flex items-center gap-1.5 ${active || meter >= 1 ? "text-ember" : ""}`}>
        <span className="font-jp text-bone/60">巨人</span>
        {active ? "HP" : "Shift"}
        <Meter v={active ? hp : meter} color={active ? "#c3161c" : meter >= 1 ? "#ff8a3a" : "#9e9282"} />
        {!active && meter >= 1 && <span data-keyhint><Key>{keyFor("shift")}</Key></span>}
      </span>
      {team && (
        <span className={`flex items-center gap-1.5 ${h.squad.opening > 0 ? "blink text-[#ffd27a]" : ""}`}>
          <span className="font-jp text-bone/60">連携</span>
          {h.squad.opening > 0 ? (
            <>Nape open <span className="font-display text-sm tabular-nums tracking-normal">{Math.ceil(h.squad.opening)}s</span></>
          ) : h.squad.team > 0 ? (
            <>Team <span className="font-display text-sm tabular-nums tracking-normal text-bone/60">{Math.ceil(h.squad.team)}s</span></>
          ) : (
            <>Team ready</>
          )}
          <span data-keyhint><Key>{keyFor("teamAttack")}</Key></span>
        </span>
      )}
    </div>
  );
}

function SpeedPanel({ h }: { h: HudState }) {
  const s = Math.round(h.speed);
  const hot = s > 120;
  return (
    <div className="hud-z absolute bottom-4 right-5 origin-bottom-right text-right">
      <div className="flex items-baseline justify-end gap-1 ink-shadow">
        <span
          className={`font-display text-6xl italic leading-none tabular-nums ${hot ? "text-ember" : ""}`}
        >
          {s}
        </span>
        <span className="font-cond text-sm uppercase tracking-wider text-bone/70">
          km/h
        </span>
      </div>
      <div className="mt-1 flex justify-end gap-[3px]">
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            className="h-2 w-[6px] -skew-x-[25deg]"
            style={{
              background:
                i < (s / 200) * 16
                  ? i > 9
                    ? RED
                    : BONE
                  : "rgba(239,230,210,0.15)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Grab({ escape, touch }: { escape: number; touch: boolean }) {
  return (
    <div className="hud-z absolute left-1/2 top-[62%] w-[360px] -translate-x-1/2 text-center">
      <div className="font-jp text-lg font-black tracking-[0.3em] text-ember ink-shadow">
        振りほどけ
      </div>
      <div className="mt-1 flex items-center justify-center gap-4">
        <span className="font-display text-5xl uppercase tracking-wider ink-shadow">
          {touch ? "Tap Slash" : "Mash"}
        </span>
        <span className="pulse inline-flex h-14 w-14 items-center justify-center border-2 border-bone bg-blood font-display text-4xl shadow-[0_0_20px_rgba(255,40,20,0.8)]">
          {touch ? <span className="font-jp font-black">斬</span> : "E"}
        </span>
      </div>
      <div className="mx-auto mt-3 h-3 w-[300px] -skew-x-[20deg] border border-black bg-black/70 shadow-[0_0_0_1px_rgba(201,162,90,0.5)]">
        <div
          className="h-full bg-gradient-to-r from-brass to-bone transition-[width] duration-100"
          style={{ width: `${clamp01(escape) * 100}%` }}
        />
      </div>
    </div>
  );
}

function KillBanner({ height, speed, kind }: { height: number; speed: number; kind: TitanKind }) {
  if (isBoss(kind)) return <Banner jp={`${BOSS[kind].jp} 討伐`} en={`${BOSS[kind].name} down`} text={`${Math.round(speed)} km/h`} />;
  return (
    <div className="hud-z absolute left-1/2 top-[22%] w-[min(760px,90vw)] -translate-x-1/2">
      <div className="kill-banner">
        <div className="relative">
          <Brush className="brush-in absolute -inset-x-8 -inset-y-6 h-[calc(100%+3rem)] w-[calc(100%+4rem)]" />
          <div className="relative flex items-center justify-center gap-5 py-3">
            <span className="font-brush text-6xl leading-none text-black">
              討伐
            </span>
            <span className="font-display text-7xl uppercase leading-none tracking-wide text-bone [text-shadow:4px_4px_0_#000]">
              Nape Cut
            </span>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-6 font-display text-xl uppercase tracking-widest ink-shadow">
          <span>{Math.round(height)} m class</span>
          <span className="text-brass">{Math.round(speed)} km/h</span>
        </div>
      </div>
    </div>
  );
}

function Dead({ final }: { final: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(60,0,0,0.55),rgba(0,0,0,0.92))]">
      <div className="rise-in font-brush text-[clamp(6rem,22vh,13rem)] leading-none text-blood [text-shadow:0_0_40px_rgba(195,22,28,0.6)]">
        戦死
      </div>
      <div className="mt-2 font-display text-[clamp(2rem,6vh,3.5rem)] uppercase tracking-[0.12em] text-bone">
        Fallen in the line of duty
      </div>
      {!final && (
        <div className="slow-fade mt-3 text-sm uppercase tracking-[0.35em] text-parch/70">
          Returning to a supply depot
        </div>
      )}
    </div>
  );
}
