"use client";

import { useEffect, useRef, useState } from "react";
import type { HudState, PlayerMode } from "./contracts";
import { Key } from "./ui-menu";

const STORE = "spiderman-tips";
const SHOW_S = 7;

type H = HudState & { mode?: PlayerMode };
type Ctx = { t: number; seen: Set<string>; fall: number };
type Tip = { id: string; keys: [string, string][]; when: (h: H, c: Ctx) => boolean; done?: (h: H) => boolean };

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

  useEffect(() => {
    seen.current ??= load();
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
  }, [h, tip]);

  if (!tip) return null;
  return (
    <div key={tip.id} className="panel-in pointer-events-none w-full" data-hud="tip">
      <div className="border-l-4 border-spider bg-black/70 px-3 py-2.5 shadow-[4px_4px_0_rgba(0,0,0,0.5)] backdrop-blur-sm">
        <div className="mb-1.5 font-cond text-[10px] font-black uppercase tracking-[0.3em] text-spider">Tip</div>
        <div className="flex flex-col gap-1.5">
          {tip.keys.map(([k, label]) => (
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
