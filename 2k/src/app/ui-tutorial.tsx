"use client";

import { useEffect, useRef, useState } from "react";
import type { Device, Difficulty, GameEvent, HudSnapshot, TeamData } from "./contracts";
import { DIFFICULTY } from "./contracts";
import { Glyph, Hints, type PadFamily } from "./ui-glyphs";
import { Emblem, cx, vivid } from "./ui-kit";
import { useNavRoot } from "./ui-nav";
import { Parts } from "./ui-coach";
import { acquireProbe, defenseOf } from "./tutorial-input";
import { STEPS, type Hit, type StepCtx } from "./tutorial-steps";

// v2 onboarding: Learn to Play. The coach card never takes keyboard focus (the player is steering the game), so it is
// not a nav root. Interstitials (part break, finish, first launch) pause the game and are nav roots.

export type Bus = { on(fn: (e: GameEvent) => void): () => void };

type Say = { id: number; text: string; tone: "good" | "bad" | "info" };

/** One step's coach card. Mount with key={index} so progress resets per step. */
export function TutorialCoach({
  index, h, bus, device, family, onDone,
}: {
  index: number;
  h: HudSnapshot | null;
  bus: Bus;
  device: Device;
  family: PadFamily;
  onDone: () => void;
}) {
  const step = STEPS[index];
  const [prog, setProg] = useState(0);
  const [say, setSay] = useState<Say | null>(null);
  const [done, setDone] = useState(false);
  const progRef = useRef(0);
  const attempts = useRef(0);
  const hRef = useRef(h);
  hRef.current = h;
  const lastT = useRef(performance.now());
  const probeRef = useRef<ReturnType<typeof acquireProbe> | null>(null);
  const doneRef = useRef(false);
  const seq = useRef(0);

  const ctx = (): StepCtx => {
    const s = hRef.current;
    const ut = s?.userTeam ?? 0;
    return {
      h: s,
      coach: s?.coach,
      probe: probeRef.current!,
      userSlot: s?.user?.slot ?? -1,
      userTeam: ut,
      defense: !!s && s.possession !== -1 && s.possession !== ut,
      attempts: attempts.current,
    };
  };

  const apply = (r: Hit) => {
    if (!r || doneRef.current) return;
    if (r.attempt) attempts.current++;
    if (r.say) {
      const id = ++seq.current;
      setSay({ id, text: r.say, tone: r.tone ?? "info" });
    }
    if (r.add) add(r.add);
  };

  const add = (n: number) => {
    if (doneRef.current) return;
    progRef.current = Math.min(step.goal, progRef.current + n);
    setProg(progRef.current);
    if (progRef.current >= step.goal - 1e-6) {
      doneRef.current = true;
      setDone(true);
      window.setTimeout(onDone, 2100);
    }
  };

  useEffect(() => {
    const probe = acquireProbe();
    probeRef.current = probe;
    const offP = probe.on((b, dev) => {
      if (!step.press || !probeRef.current) return;
      apply(step.press(b, defenseOf(b, dev), ctx()));
    });
    const offE = bus.on((e) => {
      if (!step.event || !probeRef.current) return;
      apply(step.event(e, ctx()));
    });
    return () => {
      offP();
      offE();
      probe.release();
      probeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus, index]);

  // time-based checks run at HUD rate
  useEffect(() => {
    const now = performance.now();
    const dt = Math.min(0.3, (now - lastT.current) / 1000);
    lastT.current = now;
    if (!step.tick || !probeRef.current || doneRef.current) return;
    if (h && h.phase !== "live" && step.part === "offense" && step.id !== "move" && step.id !== "sprint") return;
    const n = step.tick(ctx(), dt);
    if (n > 0) add(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h]);

  const c = probeRef.current ? ctx() : null;
  const waiting = !done && step.wait && c ? step.wait(c) : null;
  const pct = Math.min(1, prog / step.goal);
  const partSteps = STEPS.filter((s) => s.part === step.part);
  const partIdx = partSteps.indexOf(step);

  return (
    <div className="pointer-events-none absolute left-[1.5rem] top-[1.4rem]">
      <div key={index} className="tut-card relative flex w-[min(31rem,92vw)] flex-col overflow-hidden rounded-[5px] border border-white/15 bg-night/88 shadow-[0_1.4rem_3.5rem_rgb(0_0_0/0.6)] backdrop-blur-md">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
          <span className={cx("rounded-[2px] px-2 py-0.5 text-[0.66rem] font-black uppercase tracking-[0.2em] text-night", step.part === "offense" ? "bg-hot" : "bg-ice")}>
            {step.part === "offense" ? "Part 1 · Offense" : "Part 2 · Defense"}
          </span>
          <span className="flex gap-1">
            {partSteps.map((s, i) => (
              <span key={s.id} className={cx("h-1.5 w-6 skew-x-[-20deg]", i < partIdx || (i === partIdx && done) ? "bg-good" : i === partIdx ? "bg-white" : "bg-white/15")} />
            ))}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-mute">
            <Glyph act="pause" device={device} family={family} /> Skip
          </span>
        </div>
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="eyebrow text-gold">
              Step {partIdx + 1} of {partSteps.length} · {step.title}
            </span>
            {done ? (
              <span className="tut-say ttl text-[1.6rem] leading-[1.02] text-good">{step.done}</span>
            ) : waiting ? (
              <span className="ttl flex flex-wrap items-center gap-y-1 text-[1.6rem] leading-[1.08] text-white/85">
                <Parts parts={waiting} device={device} family={family} />
              </span>
            ) : (
              <span className="ttl flex flex-wrap items-center gap-y-1 text-[1.85rem] leading-[1.08] text-white">
                <Parts parts={c && step.alt?.(c) ? step.alt(c)! : step.prompt} device={device} family={family} />
              </span>
            )}
            {!done && <span className="text-[0.82rem] leading-snug text-ink/80">{step.tip}</span>}
          </div>
          <div className="grid h-[4.2rem] w-[4.2rem] flex-none place-items-center self-start">
            {done ? (
              <svg key="ok" viewBox="0 0 48 48" className="tut-check h-full w-full" aria-label="Done">
                <circle cx="24" cy="24" r="22" fill="var(--color-good)" />
                <path d="M13 25l7 7 15-16" fill="none" stroke="#05060a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90" aria-label={`${Math.round(pct * 100)} percent`}>
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="5" />
                <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-gold)" strokeWidth="5" strokeLinecap={pct > 0.02 ? "round" : "butt"} pathLength={100} strokeDasharray={`${pct * 100} 100`} style={{ transition: "stroke-dasharray 150ms linear" }} />
                {step.unit === "count" && (
                  <text x="24" y="-20" transform="rotate(90)" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" style={{ fontFamily: "var(--font-display)" }}>
                    {Math.floor(prog)}/{step.goal}
                  </text>
                )}
              </svg>
            )}
          </div>
        </div>
        {say && !done && (
          <div key={say.id} className={cx("tut-say flex items-center gap-2 border-t px-4 py-2 text-[0.92rem] font-bold", say.tone === "good" ? "border-good/30 bg-good/15 text-good" : say.tone === "bad" ? "border-bad/30 bg-bad/15 text-[#ff8e9a]" : "border-white/10 bg-white/5 text-white/85")}>
            <span className={cx("h-2 w-2 rotate-45", say.tone === "good" ? "bg-good" : say.tone === "bad" ? "bg-bad" : "bg-white/60")} />
            {say.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({ children, onBack, wide }: { children: React.ReactNode; onBack?: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, { back: onBack });
  return (
    <div ref={ref} className="absolute inset-0 grid place-items-center">
      {/* the game is paused under this: dim it hard and keep the panel solid so it never reads as part of live play */}
      <div className="fade absolute inset-0 bg-[rgb(5_6_10/0.78)] backdrop-blur-md" />
      <div className={cx("pop-in relative flex flex-col gap-5 rounded-[6px] border border-white/15 bg-[#0b0e15] p-8 shadow-[0_2rem_5rem_rgb(0_0_0/0.7)]", wide ? "w-[min(58rem,94vw)]" : "w-[min(44rem,92vw)]")}>{children}</div>
    </div>
  );
}

function Choice({ title, sub, onClick, primary, auto, badge }: { title: string; sub: string; onClick: () => void; primary?: boolean; auto?: boolean; badge?: string }) {
  return (
    <button
      type="button"
      data-autofocus={auto ? "1" : undefined}
      onClick={onClick}
      className={cx("nav relative flex min-h-[5.6rem] flex-col justify-center gap-1 rounded-[4px] border px-5 py-3 text-left", primary ? "glow-primary border-gold/60 bg-gold/12" : "tile border-white/10")}
    >
      {badge && <span className="absolute right-3 top-3 rounded-[2px] bg-gold px-1.5 py-0.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-night">{badge}</span>}
      <span className="ttl text-[1.9rem] text-white">{title}</span>
      <span className="text-[0.85rem] text-ink/75">{sub}</span>
    </button>
  );
}

/** First launch: "New to HOOPS?" */
export function Welcome({ onTutorial, onJumpIn, onVeteran, device, family }: { onTutorial: () => void; onJumpIn: () => void; onVeteran: () => void; device: Device; family: PadFamily }) {
  return (
    <Modal onBack={onVeteran}>
      <div className="flex flex-col gap-1">
        <span className="eyebrow text-hot">Welcome to HOOPS</span>
        <span className="ttl text-[3.4rem] italic leading-none">New here?</span>
        <span className="mt-1 text-[1rem] text-ink/80">Two minutes on the practice court teaches you everything you need: moving, shooting with the meter, passing and defense.</span>
      </div>
      <div className="flex flex-col gap-3">
        <Choice auto primary badge="2 min" title="Learn to play" sub="Interactive tutorial on the practice court, step by step" onClick={onTutorial} />
        <div className="grid grid-cols-2 gap-3">
          <Choice title="Jump in" sub={`${DIFFICULTY.rookie.label} difficulty, coach tips on`} onClick={onJumpIn} />
          <Choice title="I've played before" sub="Go to the main menu" onClick={onVeteran} />
        </div>
      </div>
      <Hints items={[["ok", "Select"], ["navigate4", "Move"]]} device={device} family={family} />
    </Modal>
  );
}

/** Between part 1 and part 2. */
export function TutorialBreak({ onContinue, onPlay, device, family }: { onContinue: () => void; onPlay: () => void; device: Device; family: PadFamily }) {
  return (
    <Modal>
      <div className="flex flex-col gap-1">
        <span className="eyebrow text-good">Part 1 complete · Offense</span>
        <span className="ttl text-[3.2rem] italic leading-none">Now, defense</span>
        <span className="mt-1 text-[1rem] text-ink/80">
          Live defense on Rookie. You'll switch to the man with the ball, stay in front of him, reach for a steal and contest a shot.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Choice auto primary title="Continue" sub="Part 2: defense drill" onClick={onContinue} />
        <Choice title="Play a game" sub={`Skip defense, ${DIFFICULTY.rookie.label}, 4 min quarters`} onClick={onPlay} />
      </div>
      <Hints items={[["ok", "Select"], ["navigate4", "Move"]]} device={device} family={family} />
    </Modal>
  );
}

/** Tutorial finished. */
export function TutorialDone({ team, onPlay, onPractice, onMenu, device, family }: { team: TeamData; onPlay: () => void; onPractice: () => void; onMenu: () => void; device: Device; family: PadFamily }) {
  return (
    <Modal onBack={onMenu} wide>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 48 48" className="tut-check h-[5.5rem] w-[5.5rem] flex-none" aria-hidden>
          <circle cx="24" cy="24" r="22" fill="var(--color-good)" />
          <path d="M13 25l7 7 15-16" fill="none" stroke="#05060a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-good">Tutorial complete</span>
          <span className="ttl text-[3.4rem] italic leading-none">You're ready</span>
          <span className="mt-1 text-[1rem] text-ink/80">Your first games keep the coach tips on. Change that any time in Settings, Button hints.</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Choice auto primary title="Play a game" sub={`${team.name}, ${DIFFICULTY.rookie.label}, 4 min quarters`} onClick={onPlay} />
        <Choice title="Free practice" sub="Shootaround, no clock" onClick={onPractice} />
        <Choice title="Main menu" sub="Pick your own matchup" onClick={onMenu} />
      </div>
      <Hints items={[["ok", "Select"], ["navigate4", "Move"]]} device={device} family={family} />
    </Modal>
  );
}

/** Loading screen for the practice court and the drills. */
export function PracticeLoading({ team, title, sub, progress, ready, onContinue, onBack, device, family, difficulty }: { team: TeamData; title: string; sub: string; progress: number; ready: boolean; onContinue: () => void; onBack?: () => void; device: Device; family: PadFamily; difficulty?: Difficulty }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 700);
    return () => clearTimeout(t);
  }, []);
  const go = ready && shown;
  useNavRoot(ref, { any: go ? onContinue : () => {}, back: onBack, autofocus: false });
  // like the match loading screen: continue on its own after a few seconds
  useEffect(() => {
    if (!go) return;
    const t = window.setTimeout(onContinue, 6000);
    return () => clearTimeout(t);
  }, [go, onContinue]);
  const p = Math.max(0.04, Math.min(1, progress));
  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-night" onPointerDown={() => go && onContinue()}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(90% 80% at 30% 40%, ${vivid(team)}33, transparent 70%)` }} />
      <div className="stripes absolute inset-0" />
      <div className="safe absolute inset-0 flex flex-col justify-center gap-8">
        <div className="slide-l flex items-center gap-8">
          <Emblem team={team} size="9rem" />
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-hot">{sub}</span>
            <span className="ttl text-[5.4rem] italic leading-[0.9]">{title}</span>
            <span className="text-[1.05rem] font-semibold uppercase tracking-[0.18em] text-white/70">
              You play as the {team.city} {team.name}
              {difficulty ? ` · ${DIFFICULTY[difficulty].label}` : ""}
            </span>
          </div>
        </div>
        <div className="flex w-[min(40rem,80vw)] flex-col gap-2">
          {go ? (
            <button type="button" onClick={onContinue} className="blink ttl flex w-fit items-center gap-2 text-[1.5rem] tracking-[0.18em]">
              {device === "pad" ? (
                <>
                  <Glyph act="ok" device={device} family={family} /> Start
                </>
              ) : (
                <>
                  Click or <Glyph act="ok" device={device} family={family} /> to start
                </>
              )}
            </button>
          ) : (
            <span className="text-[0.75rem] font-bold uppercase tracking-[0.2em] text-mute">{ready ? "Ready" : "Setting up the court"}</span>
          )}
          <div className="relative h-1.5 w-full overflow-hidden bg-white/10">
            <div className={cx("absolute inset-y-0 left-0 bg-hot transition-[width] duration-500", !ready && "loadbar")} style={{ width: `${(ready ? 1 : p) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
