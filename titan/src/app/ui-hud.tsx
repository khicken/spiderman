"use client";

import type { HudState } from "./contracts";
import type { UiEvent } from "./game";
import { Key } from "./ui-menu";

export type Pop = UiEvent & { id: number };

const FOV = Math.PI / 2;

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between font-cond text-[11px] font-bold uppercase tracking-[0.25em] text-white/60">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)}</span>
      </div>
      <div className="h-2 w-56 -skew-x-12 bg-black/50 ring-1 ring-white/15">
        <div className={`h-full transition-[width] duration-100 ${tone}`} style={{ width: `${Math.max(0, value) * 100}%` }} />
      </div>
    </div>
  );
}

export function Hud({ h, pops }: { h: HudState; pops: Pop[] }) {
  const toast = [...pops].reverse().find((p) => p.type === "toast");
  const scores = pops.filter((p) => p.type === "score");
  const hurt = pops.find((p) => p.type === "hurt");
  const aimColor = h.aim === "titan" ? "border-blood" : h.aim === "world" ? "border-white" : "border-white/25";

  return (
    <div className="pointer-events-none absolute inset-0 font-cond">
      {hurt && <div key={hurt.id} className="hurt-flash absolute inset-0 shadow-[inset_0_0_160px_rgba(160,0,0,0.75)]" />}

      <div className="absolute left-1/2 top-4 h-8 w-[min(560px,80vw)] -translate-x-1/2 overflow-hidden border-b border-white/25 bg-gradient-to-b from-black/50 to-transparent">
        <div className="absolute left-1/2 top-0 h-2 w-px bg-white/70" />
        {h.blips.map((b, i) => {
          const off = Math.max(-1, Math.min(1, b.bearing / FOV));
          const edge = Math.abs(b.bearing) > FOV;
          const size = 6 + b.height * 0.8;
          return (
            <div
              key={i}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${b.abnormal ? "bg-blood" : "bg-brass"}`}
              style={{ left: `${50 + off * 48}%`, width: size, height: size, opacity: edge ? 0.4 : Math.max(0.35, 1 - b.dist / 300) }}
            />
          );
        })}
      </div>

      <div className="absolute left-4 top-4 sm:left-8 sm:top-6">
        <div className="text-sm font-black uppercase tracking-[0.3em] text-brass">Wave {Math.max(1, h.wave)}</div>
        <div className="text-4xl font-black italic leading-none tabular-nums">{h.left}</div>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/60">{h.breakT > 0 ? `Wave ${h.wave + 1} in ${Math.ceil(h.breakT)}s` : "titans left"}</div>
        <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.25em] text-white/60">
          Score <span className="text-white tabular-nums">{h.score}</span> · Kills <span className="text-white tabular-nums">{h.kills}</span>
        </div>
      </div>

      <div className="absolute right-4 top-4 text-[11px] tabular-nums text-white/35 sm:right-8 sm:top-6">{h.fps} fps</div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="flex items-center gap-3">
          <div className={`h-5 w-2 border-y-2 border-l-2 ${aimColor} ${h.hooks[0] ? "bg-white/40" : ""}`} />
          <div className="h-1 w-1 rounded-full bg-white/80" />
          <div className={`h-5 w-2 border-y-2 border-r-2 ${aimColor} ${h.hooks[1] ? "bg-white/40" : ""}`} />
        </div>
        {h.aim !== "none" && <div className="absolute left-1/2 top-7 -translate-x-1/2 text-[10px] font-bold tabular-nums text-white/60">{Math.round(h.aimDist)} m</div>}
      </div>

      {toast && (
        <div key={toast.id} className="banner-in absolute left-1/2 top-[18%] -translate-x-1/2 text-center">
          <div className="text-4xl font-black uppercase italic tracking-tight drop-shadow-[3px_3px_0_rgba(0,0,0,0.7)] sm:text-5xl">{toast.title}</div>
          {toast.type === "toast" && toast.text && <div className="mt-1 text-sm font-bold uppercase tracking-[0.25em] text-brass">{toast.text}</div>}
        </div>
      )}

      <div className="absolute right-6 top-1/3 flex flex-col items-end gap-1">
        {scores.map((s) => s.type === "score" && (
          <div key={s.id} className="xp-rise text-right">
            <span className="text-2xl font-black italic text-brass tabular-nums">+{s.amount}</span>
            <span className="ml-2 text-xs font-bold uppercase tracking-widest text-white/80">{s.reason}</span>
          </div>
        ))}
      </div>

      {h.escape !== null && (
        <div className="absolute left-1/2 top-[62%] w-72 -translate-x-1/2 text-center">
          <div className="mb-2 flex items-center justify-center gap-2 text-2xl font-black uppercase italic">
            Mash <Key>E</Key> to cut free
          </div>
          <div className="h-3 -skew-x-12 bg-black/60 ring-1 ring-white/30">
            <div className="h-full bg-blood" style={{ width: `${h.escape * 100}%` }} />
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-4 grid gap-3 sm:left-8">
        <Bar label="Health" value={h.health} tone={h.health < 0.3 ? "bg-blood" : "bg-white"} />
        <Bar label="Gas" value={h.gas} tone={h.gas < 0.2 ? "bg-blood" : "bg-sky-200"} />
        <div>
          <div className="mb-1 flex justify-between text-[11px] font-bold uppercase tracking-[0.25em] text-white/60">
            <span>Blades</span>
            <span className="tabular-nums">{h.blades} spare</span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={`h-3 w-5 -skew-x-12 ${i < h.blades ? "bg-white/80" : "bg-white/15"}`} />
            ))}
          </div>
          <div className="mt-1.5 h-1 w-56 -skew-x-12 bg-black/50">
            <div className={`h-full ${h.sharp < 0.25 ? "bg-blood" : "bg-brass"}`} style={{ width: `${h.sharp * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 right-4 text-right sm:right-8">
        <div className="text-6xl font-black italic leading-none tabular-nums">{Math.round(h.speed)}</div>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/60">km/h</div>
        <div className="mt-3 flex flex-col items-end gap-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">
          {h.supply && <span className="text-emerald-300">Resupplying</span>}
          {h.sharp <= 0 && h.blades > 0 && (
            <span className="flex items-center gap-1.5">
              <Key dark>R</Key> Swap blades
            </span>
          )}
          {!h.locked && h.blips.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Key dark>Q</Key> Lock on
            </span>
          )}
        </div>
      </div>

      {h.dead && <div className="absolute inset-0 bg-black/50" />}
    </div>
  );
}
