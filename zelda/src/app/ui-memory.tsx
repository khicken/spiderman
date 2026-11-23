"use client";

import type { LanternPower } from "./contracts";
import { MEMORIES, POWER_INFO, SECRET_TOTAL, WICK_OIL_TOTAL } from "./ui-store";

// Journal panel: Wick Oil, powers, memories and secrets. Counts only.

export interface CollectData {
  wickOil: number;
  powers: readonly LanternPower[];
  memories: readonly number[];
  secrets: number;
}

function Count({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="flex items-baseline justify-between" style={{ padding: "0.2rem 0", borderBottom: "1px dashed var(--color-ink-faint)" }}>
      <span className="font-display" style={{ fontSize: "1.2rem", fontWeight: 600 }}>{label}</span>
      <span className="font-display tabular-nums" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--color-ember-lo)" }} data-testid={`count-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}/{total}</span>
    </div>
  );
}

export function Collection({ d }: { d: CollectData }) {
  const all = Object.keys(POWER_INFO) as LanternPower[];
  return (
    <div data-testid="collection">
      <Count label="Wick Oil" value={Math.min(WICK_OIL_TOTAL, d.wickOil)} total={WICK_OIL_TOTAL} />
      <Count label="Memories" value={d.memories.length} total={MEMORIES.length} />
      <Count label="Secrets" value={Math.min(SECRET_TOTAL, d.secrets)} total={SECRET_TOTAL} />
      <div className="hm-label" style={{ color: "var(--color-ember-lo)", margin: "0.8rem 0 0.3rem" }}>Lantern powers · {d.powers.length}/{all.length}</div>
      <ul>
        {all.map((p) => {
          const has = d.powers.includes(p);
          return (
            <li key={p} style={{ opacity: has ? 1 : 0.4, marginBottom: "0.25rem" }}>
              <span className="font-display" style={{ fontSize: "1.1rem", fontWeight: 600 }}>{has ? POWER_INFO[p].name : "Not found"}</span>
              {has && <span style={{ fontSize: "0.82rem", color: "var(--color-ink-soft)", marginLeft: "0.5rem" }}>{POWER_INFO[p].effect}</span>}
            </li>
          );
        })}
      </ul>
      {d.memories.length > 0 && (
        <>
          <div className="hm-label" style={{ color: "var(--color-ember-lo)", margin: "0.8rem 0 0.3rem" }}>Memories</div>
          <ul>
            {MEMORIES.filter((m) => d.memories.includes(m.beacon)).map((m) => (
              <li key={m.beacon} className="font-display" style={{ fontSize: "1.05rem", lineHeight: 1.4, marginBottom: "0.3rem", color: "var(--color-ink-soft)" }}>{m.line}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
