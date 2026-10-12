"use client";

import { useEffect, useRef, useState } from "react";
import type { HudState } from "./contracts";
import { Key } from "./ui-menu";

const STORE = "spiderman-tips";
const TUTORIAL = "spiderman-tutorial";
const SHOW_S = 7;

type Ctx = { t: number; seen: Set<string>; fall: number };
type Tip = { id: string; keys: [string, string][]; when: (h: HudState, c: Ctx) => boolean; done?: (h: HudState) => boolean };

const TIPS: Tip[] = [
  { id: "swing", keys: [["LMB", "Hold to web-swing"]], when: (_h, c) => c.t > 1.5, done: (h) => h.speed > 80 && h.height > 12 },
  { id: "release", keys: [["LMB", "Let go at the flash for a boost"]], when: (h) => h.swingCue > 0.5 },
  { id: "fight", keys: [["LMB", "Punch"], ["F", "Web strike"], ["Q", "Dodge"]], when: (h) => h.inCombat },
  { id: "wall", keys: [["W", "Hold into a wall to run up"], ["Space", "Jump off the wall"]], when: (h) => h.mode === "wall" },
  { id: "glide", keys: [["A", "Steer the glide with A and D"], ["C", "Close the wings"]], when: (h) => h.mode === "wings" },
  { id: "fall", keys: [["LMB", "Swing before you land"], ["C", "Open web wings"]], when: (h, c) => c.fall > 30 && !h.inCombat && h.mode !== "swing" },
  {
    id: "edge",
    keys: [["E", "Point-launch off the ledge"], ["W", "Sprint off the edge to leap"]],
    when: (h, c) => c.seen.has("swing") && !h.inCombat && h.prompts.some((p) => p.key === "E"),
  },
  {
    id: "race",
    keys: [["", "Blue beams start swing races. Land in one"]],
    when: (h, c) => c.t > 12 && !h.objective && h.markers.some((m) => m.kind === "race" && Math.hypot(m.x - h.x, m.z - h.z) < 300),
    done: (h) => !!h.objective,
  },
  { id: "map", keys: [["Esc", "Map and Journal"]], when: (_h, c) => c.t > 75 },
];

type Step = { keys: (h: HudState) => [string, string][]; done: (h: HudState, c: { swingT: number; crimes: number }) => boolean };
const FIGHT: [string, string][] = [["LMB", "Punch"], ["F", "Web strike"], ["Q", "Dodge"]];
const STEPS: Step[] = [
  { keys: () => [["LMB", "Hold to swing, let go to fly"]], done: (_h, c) => c.swingT > 1.5 },
  { keys: () => [["RMB", "Zip to the point you aim at"]], done: (h) => h.mode === "zip" },
  { keys: (h) => (h.inCombat || h.stealth ? FIGHT : [["", "Swing to a red beam to stop a crime"]]), done: (h, c) => (h.progress.completed.crimes ?? 0) > c.crimes },
  { keys: () => [["E", "Walk to a yellow shop door and enter"]], done: (h) => h.inside },
];

const loadStep = () => {
  try {
    return Number(localStorage.getItem(TUTORIAL) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const saveStep = (n: number) => {
  try {
    localStorage.setItem(TUTORIAL, String(n));
  } catch {}
};

// First-run steps. Each one ends when the player does it. K skips the rest.
function useTutorial(h: HudState) {
  const [step, setStep] = useState(-1);
  const swingT = useRef(0);
  const crimes = useRef(0);
  const last = useRef(0);
  const base = useRef(false);
  useEffect(() => setStep(loadStep()), []);
  useEffect(() => {
    const skip = (e: KeyboardEvent) => {
      if (e.code !== "KeyK") return;
      setStep(STEPS.length);
      saveStep(STEPS.length);
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);
  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    if (!base.current) {
      base.current = true;
      crimes.current = h.progress.completed.crimes ?? 0;
    }
    const now = performance.now() / 1000;
    const dt = last.current ? Math.min(0.5, now - last.current) : 0;
    last.current = now;
    if (h.mode === "swing") swingT.current += dt;
    if (!STEPS[step].done(h, { swingT: swingT.current, crimes: crimes.current })) return;
    crimes.current = h.progress.completed.crimes ?? 0;
    setStep(step + 1);
    saveStep(step + 1);
  }, [h, step]);
  return step >= 0 && step < STEPS.length ? step : null;
}

const load = () => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
  } catch {
    return new Set<string>();
  }
};

let startedAt = 0;
let lastHeight = Infinity;

export function Tips({ h }: { h: HudState }) {
  const seen = useRef<Set<string> | null>(null);
  const shownAt = useRef(0);
  const peak = useRef(-Infinity);
  const [tip, setTip] = useState<Tip | null>(null);
  const step = useTutorial(h);

  useEffect(() => {
    if (step !== null) return;
    seen.current ??= load();
    // The tutorial already taught these.
    if (loadStep() >= STEPS.length) for (const id of ["swing", "fight"]) seen.current.add(id);
    const now = performance.now() / 1000;
    if (!startedAt) startedAt = now;
    const prev = lastHeight;
    lastHeight = h.height;
    if (h.height >= prev - 0.05 || h.height > peak.current) peak.current = h.height;
    const fall = peak.current - h.height;
    if (tip) {
      if (now - shownAt.current > SHOW_S || tip.done?.(h)) setTip(null);
      return;
    }
    const next = TIPS.find((x) => !seen.current!.has(x.id) && x.when(h, { t: now - startedAt, seen: seen.current!, fall }));
    if (!next) return;
    seen.current.add(next.id);
    try {
      localStorage.setItem(STORE, JSON.stringify([...seen.current]));
    } catch {}
    shownAt.current = now;
    setTip(next);
  }, [h, tip, step]);

  if (step !== null) return <Card title={`Tutorial ${step + 1}/${STEPS.length}`} keys={[...STEPS[step].keys(h), ["K", "Skip tutorial"]]} />;
  if (!tip) return null;
  return <Card title="Tip" keys={tip.keys} />;
}

function Card({ title, keys }: { title: string; keys: [string, string][] }) {
  return (
    <div key={title + keys[0][1]} className="panel-in pointer-events-none w-full" data-hud="tip">
      <div className="border-l-4 border-spider bg-black/70 px-3 py-2.5 shadow-[4px_4px_0_rgba(0,0,0,0.5)] backdrop-blur-sm">
        <div className="mb-1.5 font-cond text-[10px] font-black uppercase tracking-[0.3em] text-spider">{title}</div>
        <div className="flex flex-col gap-1.5">
          {keys.map(([k, label]) => (
            <div key={k + label} className="flex items-center gap-2">
              {k && <Key>{k}</Key>}
              <span className="text-[13px] font-semibold leading-snug sm:text-sm">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
