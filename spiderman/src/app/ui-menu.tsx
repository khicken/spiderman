"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SUITS } from "./hero";
import { QUALITIES, type Quality, type Settings } from "./game";

export type Panel = "settings" | "controls" | "map" | "journal" | null;
export type MenuItem = { id: string; label: string; onSelect: () => void; disabled?: boolean };

const SUIT_SWATCH: Record<string, string> = {
  miles: "linear-gradient(135deg,#0d0d10 52%,#e2231a 52%)",
  classic: "linear-gradient(135deg,#d0142a 52%,#1d4fb8 52%)",
  symbiote: "linear-gradient(135deg,#050507 60%,#f2f2f2 60%)",
  advanced: "linear-gradient(135deg,#c4121f 46%,#f2f2f5 46% 54%,#0e1f4d 54%)",
  noir: "linear-gradient(135deg,#1a1a1d 50%,#6b6b70 50%)",
  stealth: "linear-gradient(135deg,#08090b 56%,#3fe0c5 56% 62%,#08090b 62%)",
  punk: "linear-gradient(135deg,#d0142a 34%,#1d4fb8 34% 67%,#111 67%)",
  verse: "linear-gradient(135deg,#0a0a0d 50%,#e3132a 50% 58%,#ff3df2 58%)",
  iron: "linear-gradient(135deg,#c4121f 52%,#e8b83a 52%)",
};

const CONTROLS: { group: string; keys: [string[], string][] }[] = [
  {
    group: "Traversal",
    keys: [
      [["Mouse"], "Look"],
      [["W", "A", "S", "D"], "Move, sprint starts by itself"],
      [["LMB"], "Hold to swing"],
      [["Shift"], "Hold to swing"],
      [["Space"], "Jump, web zip in air"],
      [["RMB"], "Web zip to aimed point"],
      [["E"], "Point launch, hold to perch"],
      [["C"], "Web wings"],
      [["Z"], "Hold to dive"],
    ],
  },
  {
    group: "Combat",
    keys: [
      [["LMB"], "Punch when enemies are near"],
      [["T"], "Air trick"],
      [["RMB"], "Web shooter"],
      [["F"], "Web strike, hold to yank"],
      [["Q"], "Dodge"],
      [["X"], "Finisher"],
      [["H"], "Heal"],
      [["G"], "Use gadget"],
      [["Tab"], "Next gadget"],
    ],
  },
  {
    group: "Gamepad",
    keys: [
      [["LS"], "Move"],
      [["RS"], "Look"],
      [["RT"], "Hold to swing"],
      [["A"], "Jump, web zip in air"],
      [["X"], "Punch, or swing"],
      [["Y"], "Web strike, hold to yank"],
      [["B"], "Dodge"],
      [["LB"], "Web zip, web shooter"],
      [["RB"], "Point launch, hold to perch"],
      [["LT"], "Hold to dive"],
      [["L3"], "Web wings"],
      [["R3"], "Finisher"],
      [["Up"], "Use gadget"],
      [["Right"], "Next gadget"],
      [["Down"], "Heal"],
      [["Left"], "Scan"],
      [["Start"], "Pause"],
      [["View"], "Map"],
    ],
  },
  {
    group: "Other",
    keys: [
      [["E"], "Greet a civilian"],
      [["V"], "Scan, ping a signal, take a photo"],
      [["R"], "Hold to go back to the start"],
      [["P"], "Photo mode"],
      [["M"], "Mute"],
      [["Esc"], "Pause"],
    ],
  },
];

export function Key({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-[3px] px-1.5 font-cond text-xs font-bold uppercase leading-none tracking-wide shadow-[0_2px_0_rgba(0,0,0,0.6)] ${dark ? "bg-black/70 text-white ring-1 ring-white/30" : "bg-white text-black"}`}
    >
      {children}
    </kbd>
  );
}

export function Menu({ items, active }: { items: MenuItem[]; active: string | null }) {
  const list = useRef<HTMLDivElement>(null);
  const ready = !items[0]?.disabled;
  useEffect(() => {
    if (ready) list.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [ready]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
  };
  return (
    <div ref={list} onKeyDown={onKey} className="flex flex-col items-start gap-1">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={it.onSelect}
          onMouseEnter={(e) => e.currentTarget.focus()}
          disabled={it.disabled}
          className={`group relative cursor-pointer py-1 pl-4 pr-6 text-left font-cond text-3xl font-black uppercase italic leading-none tracking-tight outline-none transition-colors disabled:cursor-wait disabled:opacity-50 sm:text-4xl ${active === it.id ? "text-white" : "text-white/70 focus:text-white"}`}
        >
          <span
            className={`absolute inset-0 -skew-x-12 bg-spider shadow-[5px_5px_0_#000] transition-transform duration-150 origin-left scale-x-0 group-focus:scale-x-100`}
          />
          {active === it.id && <span className="absolute left-0 top-1/2 h-3/5 w-1.5 -translate-y-1/2 -skew-x-12 bg-spider group-focus:opacity-0" />}
          <span className="relative group-focus:rgb">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PanelFrame({ title, onClose, children, wide, xl }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; xl?: boolean }) {
  return (
    <section className={`panel-in w-full ${xl ? "max-w-[880px]" : wide ? "max-w-[680px]" : "max-w-[520px]"} border-t-4 border-spider bg-black/80 p-5 shadow-[8px_8px_0_rgba(0,0,0,0.6)] backdrop-blur-md sm:p-6`}>
      <header className="mb-5 flex items-center justify-between">
        <h2 className="font-cond text-2xl font-black uppercase italic tracking-tight">{title}</h2>
        <button onClick={onClose} className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white">
          <Key dark>Esc</Key> Back
        </button>
      </header>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{children}</div>;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full cursor-pointer items-center justify-between py-1.5 text-left">
      <span className="font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{label}</span>
      <span className={`relative h-5 w-10 -skew-x-12 transition-colors ${on ? "bg-spider" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 h-4 w-4 bg-white transition-[left] ${on ? "left-5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Slider({ label, value, min, max, step, text, onChange }: { label: string; value: number; min: number; max: number; step: number; text: string; onChange: (v: number) => void }) {
  return (
    <label className="block py-1.5">
      <div className="flex items-center justify-between">
        <span className="font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{label}</span>
        <span className="font-cond text-sm font-bold tabular-nums">{text}</span>
      </div>
      <input
        type="range"
        className="slider mt-2 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export type Wallet = { tokens: number; owned: (id: string) => boolean; buy: (id: string) => boolean };

export const suitCost = (suit: (typeof SUITS)[number]) => suit.cost;

function SuitGrid({ s, set, wallet }: { s: Settings; set: (p: Partial<Settings>) => void; wallet?: Wallet }) {
  const [, redraw] = useState(0);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {SUITS.map((suit) => {
        const cost = suitCost(suit);
        const owned = cost <= 0 || !wallet || wallet.owned(suit.id);
        const worn = s.suit === suit.id;
        const afford = !!wallet && wallet.tokens >= cost;
        const swatch = (
          <span
            className={`h-10 w-10 shrink-0 -skew-x-6 ring-2 ${worn ? "ring-spider" : "ring-white/20"} ${owned ? "" : "opacity-50"}`}
            style={{ background: SUIT_SWATCH[suit.id] ?? "linear-gradient(135deg,#222 52%,#e2231a 52%)" }}
          />
        );
        const name = <span className={`block font-cond text-sm font-black uppercase italic leading-tight ${owned ? "" : "text-white/60"}`}>{suit.label}</span>;
        const card = `flex items-center gap-3 border-l-4 px-3 py-2 text-left transition-colors ${worn ? "border-spider bg-white/10" : owned ? "border-white/15 hover:bg-white/5" : "border-white/10 bg-black/30"}`;
        if (owned)
          return (
            <button key={suit.id} data-suit={suit.id} data-owned="" onClick={() => set({ suit: suit.id })} title={suit.label} className={`cursor-pointer ${card}`}>
              {swatch}
              <span className="min-w-0">
                {name}
                <span className="block font-cond text-[11px] font-bold uppercase tracking-wider text-white/50">{worn ? "Equipped" : "Owned"}</span>
              </span>
            </button>
          );
        return (
          <div key={suit.id} data-suit={suit.id} title={suit.label} className={card}>
            {swatch}
            <span className="min-w-0 flex-1">
              {name}
              <span className="mt-1 flex items-center justify-between gap-2">
                <span className={`font-cond text-xs font-black italic tabular-nums ${afford ? "text-[#ffc21f]" : "text-white/45"}`}>{cost} tokens</span>
                <button
                  disabled={!afford}
                  onClick={() => {
                    if (wallet?.buy(suit.id)) {
                      set({ suit: suit.id });
                      redraw((n) => n + 1);
                    }
                  }}
                  className="cursor-pointer -skew-x-12 bg-[#ffc21f] px-2 py-0.5 font-cond text-[11px] font-black uppercase italic text-black shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40 disabled:shadow-none"
                >
                  Buy
                </button>
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SettingsPanel({ s, set, onClose, wallet }: { s: Settings; set: (p: Partial<Settings>) => void; onClose: () => void; wallet?: Wallet }) {
  return (
    <PanelFrame title="Settings" onClose={onClose}>
      <Label>Graphics</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.keys(QUALITIES) as Quality[]).map((q) => (
          <button
            key={q}
            onClick={() => set({ quality: q })}
            className={`cursor-pointer border-l-4 px-3 py-2 text-left transition-colors ${s.quality === q ? "border-spider bg-white/10" : "border-white/15 hover:bg-white/5"}`}
          >
            <div className="font-cond font-black uppercase italic">{QUALITIES[q].label}</div>
            <div className="text-[11px] leading-snug text-white/55">{QUALITIES[q].detail}</div>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <Label>Suits</Label>
          {wallet && (
            <span className="mb-2 font-cond text-sm font-black italic tabular-nums text-[#ffc21f]" data-tokens={wallet.tokens}>
              {wallet.tokens} tokens
            </span>
          )}
        </div>
        <SuitGrid s={s} set={set} wallet={wallet} />
      </div>

      <div className="mt-5 grid gap-1">
        <Slider label="Volume" value={s.volume} min={0} max={1} step={0.05} text={`${Math.round(s.volume * 100)}%`} onChange={(v) => set({ volume: v })} />
        <Toggle label="Mute" on={s.muted} onChange={(v) => set({ muted: v })} />
        <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.5} max={2} step={0.05} text={`${s.sensitivity.toFixed(2)}x`} onChange={(v) => set({ sensitivity: v })} />
        <Toggle label="Invert Y" on={s.invertY} onChange={(v) => set({ invertY: v })} />
        <Slider label="Field of view" value={s.fov} min={50} max={90} step={1} text={`${s.fov}°`} onChange={(v) => set({ fov: v })} />
        <Toggle label="Hold to chain swings" on={s.holdChain} onChange={(v) => set({ holdChain: v })} />
      </div>
    </PanelFrame>
  );
}

export function ControlsPanel({ onClose }: { onClose: () => void }) {
  return (
    <PanelFrame title="Controls" onClose={onClose} wide>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {CONTROLS.map((g) => (
          <div key={g.group} className={g.group === "Other" || g.group === "Gamepad" ? "sm:col-span-2" : ""}>
            <Label>{g.group}</Label>
            <div className={`grid gap-y-1.5 ${g.group === "Other" || g.group === "Gamepad" ? "sm:grid-cols-2 sm:gap-x-6" : ""}`}>
              {g.keys.map(([keys, action]) => (
                <div key={keys.join() + action} className="flex items-center gap-3">
                  <span className="flex w-[7.5rem] shrink-0 gap-1">
                    {keys.map((k) => (
                      <Key key={k}>{k}</Key>
                    ))}
                  </span>
                  <span className="text-sm leading-tight text-white/85">{action}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}
