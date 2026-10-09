"use client";

import { useEffect, useRef, useState } from "react";
import type { HudState } from "./contracts";
import { Key } from "./ui-menu";

const STORE = "spiderman-tips";
const SHOW_S = 7;

type Tip = { id: string; keys: [string, string][]; when: (h: HudState, t: number, seen: Set<string>) => boolean; done?: (h: HudState) => boolean };

const TIPS: Tip[] = [
  { id: "swing", keys: [["LMB", "Hold to web-swing"]], when: (_h, t) => t > 1.5, done: (h) => h.speed > 80 && h.height > 12 },
  { id: "launch", keys: [["E", "Tap to point-launch off a ledge"]], when: (_h, t, seen) => seen.has("swing") && t > 20 },
  {
    id: "race",
    keys: [["", "Blue beams start swing races. Land in one"]],
    when: (h, t) => t > 12 && !h.objective && h.markers.some((m) => m.kind === "race" && Math.hypot(m.x - h.x, m.z - h.z) < 300),
    done: (h) => !!h.objective,
  },
  { id: "fight", keys: [["LMB", "Punch"], ["F", "Web strike"], ["Q", "Dodge"]], when: (h) => h.inCombat },
  { id: "map", keys: [["Esc", "Map and Journal"]], when: (_h, t) => t > 75 },
];

const load = () => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
  } catch {
    return new Set<string>();
  }
};

let startedAt = 0;

export function Tips({ h }: { h: HudState }) {
  const seen = useRef<Set<string> | null>(null);
  const shownAt = useRef(0);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    seen.current ??= load();
    const now = performance.now() / 1000;
    if (!startedAt) startedAt = now;
    if (tip) {
      if (now - shownAt.current > SHOW_S || tip.done?.(h)) setTip(null);
      return;
    }
    const next = TIPS.find((x) => !seen.current!.has(x.id) && x.when(h, now - startedAt, seen.current!));
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
