"use client";

import type { Ref } from "react";

// Small HUD pieces that appear from events: the control chip (bottom center) and Tallow's subtitle (at the lantern).

export interface ChipData {
  id: string;
  text: string;
}
export interface SubtitleData {
  id: number;
  who: "tallow" | "oriel" | "mulberry";
  text: string;
}

const WHO: Record<SubtitleData["who"], string> = { tallow: "Tallow", oriel: "Oriel", mulberry: "Mulberry" };

/** One control chip. The guide writes the whole line, for example "WASD Move". */
export function Chip({ chip, touch }: { chip: ChipData; touch: boolean }) {
  return (
    <div key={chip.id} className="hm-chip-in absolute left-1/2" style={{ bottom: touch ? "max(1.2em, env(safe-area-inset-bottom))" : "max(3.4em, calc(env(safe-area-inset-bottom) + 2.4em))", padding: "0.4em 1.3em", background: "rgb(8 25 28 / 0.84)", border: "1px solid rgb(232 199 102 / 0.65)", borderRadius: "2em", boxShadow: "0 0.3em 1em rgb(8 25 28 / 0.5)", whiteSpace: "nowrap" }} data-testid="chip">
      <span className="font-display" style={{ fontSize: "1.25em", fontWeight: 700, color: "var(--color-parchment-hi)", letterSpacing: "0.02em" }}>{chip.text}</span>
    </div>
  );
}

/** Position is written every frame through `boxRef` (the lantern's screen point). */
export function Subtitle({ sub, boxRef }: { sub: SubtitleData | null; boxRef: Ref<HTMLDivElement> }) {
  return (
    <div ref={boxRef} className="absolute left-0 top-0" style={{ opacity: 0, willChange: "transform", maxWidth: "min(22em, 80vw)", transition: "opacity .25s" }} data-testid="subtitle">
      {sub && (
        <div key={sub.id} className="hm-rise" style={{ padding: "0.35em 0.9em 0.4em", background: "rgb(8 25 28 / 0.82)", border: "1px solid rgb(232 199 102 / 0.5)", borderRadius: "0.9em", textAlign: "center" }}>
          <span className="hm-label" style={{ fontSize: "0.55em", color: "var(--color-gold-hi)", display: "block" }}>{WHO[sub.who]}</span>
          <span className="font-display" style={{ fontSize: "1.1em", fontWeight: 600, lineHeight: 1.2, color: "var(--color-parchment-hi)" }}>{sub.text}</span>
        </div>
      )}
    </div>
  );
}
