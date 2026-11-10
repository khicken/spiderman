"use client";

import type { Device, HudSnapshot, TeamData } from "./contracts";
import { Glyph, type Act, type PadFamily } from "./ui-glyphs";
import { alpha, cx, inkOn, vivid } from "./ui-kit";
import { actionsFor } from "./tutorial-prompts";
import type { PromptBit } from "./tutorial-steps";

// v2 onboarding: in-game teaching layer. Action bar, coach chip, possession chip, attack arrows, tip-off intro,
// off-screen arrow, the hold-Tab controls card.

/** Prompt text with button glyphs inline. */
export function Parts({ parts, device, family }: { parts: PromptBit[]; device: Device; family: PadFamily }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="mx-[0.15em] inline-flex align-middle text-[1.1em]">
            <Glyph act={p.a} device={device} family={family} />
          </span>
        ),
      )}
    </>
  );
}

/**
 * Where the user's team attacks on screen: 1 right, -1 left, 0 unknown (no CoachView yet, or a camera that looks down
 * the court). `cue` is the screen side from the camera's last "attack" BroadcastCue, used when CoachView is missing.
 */
export function attackSide(h: HudSnapshot, cue: -1 | 0 | 1 = 0): -1 | 0 | 1 {
  if (h.userTeam === -1) return 0;
  const c = h.coach;
  if (c) return c.attackScreenX > 0.15 ? 1 : c.attackScreenX < -0.15 ? -1 : 0;
  return cue;
}

export function Chevron({ dir, className, style }: { dir: -1 | 1; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ width: "1em", height: "1em", transform: dir < 0 ? "scaleX(-1)" : undefined, ...style }} aria-hidden>
      <path d="M7 3l9 9-9 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Always-on strip of the 2 to 4 buttons that matter right now. */
export function ActionBar({ h, family, tabHint }: { h: HudSnapshot; family: PadFamily; tabHint: boolean }) {
  const acts = actionsFor(h, h.coach);
  const offense = h.possession === h.userTeam;
  if (!acts.length) return null;
  return (
    <div className="fade absolute bottom-[1.6rem] right-[1.5rem] flex flex-col items-end gap-1.5">
      <div className="flex items-stretch overflow-hidden rounded-[3px] border border-white/10 bg-night/80 shadow-[0_0.8rem_2rem_rgb(0_0_0/0.45)] backdrop-blur">
        <span className={cx("flex items-center px-2.5 text-[0.62rem] font-black uppercase tracking-[0.2em] [writing-mode:vertical-rl] rotate-180", offense ? "bg-hot text-night" : "bg-ice text-night")}>
          {offense ? "Offense" : "Defense"}
        </span>
        {acts.map(([a, l]) => (
          <span key={a + l} className="flex flex-col items-center justify-center gap-1 border-l border-white/10 px-3 py-2">
            <span className="text-[1.15rem]">
              <Glyph act={a} device={h.device} family={family} />
            </span>
            <span className="whitespace-nowrap text-[0.66rem] font-bold uppercase tracking-[0.12em] text-ink/90">{l}</span>
          </span>
        ))}
      </div>
      {tabHint && h.device === "keys" && (
        <span className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-white/45">Hold Tab: all controls</span>
      )}
    </div>
  );
}

const OFF_CARD: [Act, string][] = [
  ["move", "Move"], ["sprint", "Sprint"], ["shoot", "Shoot (hold, release)"], ["pass", "Pass"], ["bounce", "Bounce pass"], ["lob", "Lob"],
  ["dribble", "Dribble moves"], ["icon", "Icon pass"], ["screen", "Call screen"], ["post", "Post up"],
];
const DEF_CARD: [Act, string][] = [
  ["move", "Move"], ["sprint", "Sprint"], ["switch", "Switch player"], ["steal", "Steal"], ["block", "Block / contest"],
  ["handsUp", "Hands up"], ["intense", "Intense D"], ["charge", "Take charge"],
];

/** Full controls card (keyboard: hold Tab). */
export function ControlsCard({ h, family }: { h: HudSnapshot; family: PadFamily }) {
  const off = h.possession === h.userTeam;
  return (
    <div className="pop-in absolute bottom-[7.5rem] right-[1.5rem] flex w-[25rem] flex-col gap-2 rounded-[4px] border border-white/10 bg-night/88 p-4 shadow-[0_1rem_3rem_rgb(0_0_0/0.55)] backdrop-blur-md">
      <span className={cx("eyebrow", off ? "text-hot" : "text-ice")}>{off ? "Offense controls" : "Defense controls"}</span>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {(off ? OFF_CARD : DEF_CARD).map(([a, l]) => (
          <span key={a + l} className="flex items-center gap-2 text-[0.95rem]">
            <Glyph act={a} device={h.device} family={family} />
            <span className="text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-ink/90">{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Coach prompt chip. Over the user's head when his tag is on screen, else above the scorebug. */
export function CoachChip({ parts, urgent, device, family, floating }: { parts: PromptBit[]; urgent?: boolean; device: Device; family: PadFamily; floating?: boolean }) {
  return (
    <div
      className={cx(
        "coach-chip flex items-center gap-2 whitespace-nowrap rounded-[3px] border px-3 py-1.5 text-[1.02rem] font-bold text-white shadow-[0_0.6rem_1.6rem_rgb(0_0_0/0.55)] backdrop-blur",
        urgent ? "border-bad/70 bg-[#2a0c12]/90" : "border-gold/50 bg-night/88",
        floating ? "" : "absolute bottom-[8.4rem] left-1/2 -translate-x-1/2",
      )}
    >
      <span className={cx("h-2 w-2 flex-none rotate-45", urgent ? "bg-bad" : "bg-gold")} />
      <span className="flex items-center">
        <Parts parts={parts} device={device} family={family} />
      </span>
    </div>
  );
}

/** Slides out of the scorebug on each change of possession. */
export function PossessionChip({ offense, team, dir }: { offense: boolean; team: TeamData; dir: -1 | 0 | 1 }) {
  const col = vivid(team);
  return (
    <div className="poss-chip absolute bottom-[6.7rem] left-1/2 flex -translate-x-1/2 items-center gap-3 overflow-hidden rounded-[3px] bg-night/88 pr-4 shadow-[0_0.8rem_2rem_rgb(0_0_0/0.5)] backdrop-blur">
      <span className="flex h-full items-center self-stretch px-3 py-1.5" style={{ background: offense ? col : "var(--color-ice)", color: offense ? inkOn(col) : "#05060a" }}>
        <span className="ttl text-[1.35rem] italic">{offense ? "Offense" : "Defense"}</span>
      </span>
      <span className="text-[0.82rem] font-bold uppercase tracking-[0.16em] text-white/90">{offense ? `${team.abbr} ball` : "Get back, find your man"}</span>
      {offense && dir !== 0 && (
        <span className="flex items-center gap-1 text-[0.72rem] font-black uppercase tracking-[0.16em] text-gold">
          {dir < 0 && <Chevron dir={-1} className="text-[1rem]" />}
          Attack
          {dir > 0 && <Chevron dir={1} className="text-[1rem]" />}
        </span>
      )}
    </div>
  );
}

/** Big chevrons across the screen pointing at the basket the user attacks. */
export function AttackFlash({ dir, text }: { dir: -1 | 1; text: string }) {
  return (
    <div className="attack-flash pointer-events-none absolute inset-x-0 top-[38%] flex flex-col items-center gap-2">
      <div className={cx("flex items-center text-[5.5rem] text-gold", dir < 0 && "flex-row-reverse")} style={{ filter: "drop-shadow(0 0.3rem 1rem rgb(0 0 0 / 0.6))" }}>
        {[0, 1, 2].map((i) => (
          <Chevron key={i} dir={dir} className="attack-chev -mx-4" style={{ animationDelay: `${i * 110}ms` }} />
        ))}
      </div>
      <span className="ttl rounded-[2px] bg-night/80 px-4 py-1 text-[1.5rem] italic tracking-[0.06em] text-white">{text}</span>
    </div>
  );
}

/** Tip-off card: which team you are and where you attack. */
export function IntroCard({ team, dir, device, family }: { team: TeamData; dir: -1 | 0 | 1; device: Device; family: PadFamily }) {
  const col = vivid(team);
  return (
    <div className="intro-card pointer-events-none absolute inset-x-0 top-[16%] flex justify-center">
      <div className="flex items-stretch overflow-hidden rounded-[4px] border border-white/15 bg-night/88 shadow-[0_1.2rem_3rem_rgb(0_0_0/0.6)] backdrop-blur-md">
        <span className="w-3" style={{ background: col }} />
        <div className="flex flex-col gap-1 px-7 py-4">
          <span className="eyebrow text-gold">You play as</span>
          <span className="ttl text-[3rem] italic leading-none text-white">
            {team.city} {team.name}
          </span>
          <span className="mt-1 flex items-center gap-3 text-[0.95rem] font-semibold text-ink/90">
            {dir !== 0 && (
              <span className="flex items-center gap-1 font-black uppercase tracking-[0.14em] text-gold">
                {dir < 0 && <Chevron dir={-1} />}
                Attack the {dir < 0 ? "left" : "right"} basket
                {dir > 0 && <Chevron dir={1} />}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-mute">
              Look for the gold <b className="text-gold">YOU</b> ring · <Glyph act="pause" device={device} family={family} /> controls
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Edge arrow toward the user when he is off screen. */
export function EdgeArrow({ x, y, jersey, color }: { x: number; y: number; jersey: string; color: string }) {
  const cx0 = 0.5;
  const cy0 = 0.5;
  const dx = x - cx0;
  const dy = y - cy0;
  const k = Math.max(Math.abs(dx) / 0.46, Math.abs(dy) / 0.42, 1e-3);
  const px = cx0 + dx / k;
  const py = cy0 + dy / k;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <div className="pointer-events-none absolute" style={{ left: `${px * 100}%`, top: `${py * 100}%`, transform: "translate(-50%,-50%)" }}>
      <div className="relative grid h-14 w-14 place-items-center">
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" style={{ transform: `rotate(${ang}deg)` }} aria-hidden>
          <path d="M36 20L22 9v7H6v8h16v7z" fill="#ffd166" stroke="#05060a" strokeWidth="1.5" />
        </svg>
        <span className="num relative grid h-8 w-8 place-items-center rounded-full border-2 border-gold text-[1rem]" style={{ background: alpha(color, 0.95), color: inkOn(color) }}>
          {jersey}
        </span>
      </div>
    </div>
  );
}
