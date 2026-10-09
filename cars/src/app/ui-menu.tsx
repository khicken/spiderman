"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CarId, CarSpec, MapId, Mode } from "./contracts";
import { Back, Bolt, Cog, Disc, Flag, Fwd, Globe, Laps, Pin, Play, Road, Ruler, Speed, Wheel, WeatherIcon } from "./ui-icons";
import { ClassBadge, CLASS_COLOR, IconBtn, Stepper, TrackLine, carStats, cx, fmtLength, type MapCard } from "./ui-kit";
import { focusByKey, useNavRoot } from "./ui-nav";

export type MenuPick = { mode: Mode; map: MapId; car: CarId; paint: string; laps: number };
export type MenuStep = "home" | "maps" | "cars";

type Props = {
  cars: readonly CarSpec[];
  maps: readonly MapCard[];
  pick: MenuPick;
  onPick: (p: MenuPick) => void; // the game shows the picked car and paint behind the menu
  onGo: (p: MenuPick) => void;
  onOnline: () => void;
  onSettings: () => void;
  step?: MenuStep;
  onStep?: (s: MenuStep) => void;
  mph?: boolean;
};

export function Menu({ cars, maps, pick, onPick, onGo, onOnline, onSettings, step: initial = "home", onStep, mph = false }: Props) {
  const [step, setStepRaw] = useState<MenuStep>(initial);
  const setStep = (s: MenuStep) => {
    setStepRaw(s);
    onStep?.(s);
  };
  useEffect(() => setStepRaw(initial), [initial]);

  if (step === "home")
    return (
      <Home
        onMode={(mode) => {
          onPick({ ...pick, mode });
          setStep("maps");
        }}
        onOnline={onOnline}
        onSettings={onSettings}
      />
    );
  if (step === "maps") return <MapPicker maps={maps} pick={pick} onPick={onPick} onBack={() => setStep("home")} onNext={() => setStep("cars")} mph={mph} />;
  return <CarPicker cars={cars} pick={pick} onPick={onPick} onBack={() => setStep("maps")} onGo={() => onGo(pick)} />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("relative select-none leading-none", className)} aria-label="Cars">
      <div className="absolute inset-y-[18%] -left-[18%] w-[60%] overflow-hidden" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="absolute right-0 h-[0.06em] rounded-full bg-gradient-to-l from-hot to-transparent"
            style={{ top: `${18 + i * 20}%`, width: `${100 - i * 18}%`, animation: `speed ${1.6 + i * 0.3}s ${i * 0.25}s cubic-bezier(.3,.6,.3,1) infinite` }}
          />
        ))}
      </div>
      <span className="ttl relative block text-[1em] tracking-[-0.02em] [text-shadow:0_0.04em_0.3em_rgb(0_0_0/0.5)]">
        CAR<span className="text-hot">S</span>
      </span>
      <span className="relative mt-[0.04em] block h-[0.05em] w-full bg-gradient-to-r from-hot via-hot/60 to-transparent [transform:skewX(-20deg)]" />
    </div>
  );
}

function Home({ onMode, onOnline, onSettings }: { onMode: (m: Mode) => void; onOnline: () => void; onSettings: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref);
  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col bg-gradient-to-r from-black/70 via-black/10 to-transparent">
      <div className="flex items-start justify-between">
        <Logo className="ml-[0.08em] text-[clamp(4.5rem,15vh,9rem)]" />
        <IconBtn label="Settings" onClick={onSettings} className="text-2xl">
          <Cog />
        </IconBtn>
      </div>
      <div className="flex-1" />
      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-3">
          <Tile icon={<Flag />} label="Race" onClick={() => onMode("race")} hot autofocus />
          <Tile icon={<Road />} label="Free" onClick={() => onMode("free")} />
          <Tile icon={<Globe />} label="Online" onClick={onOnline} />
        </div>
        <a href="https://kalebkim.com" className="nav mb-1 rounded-[2px] border border-transparent px-1 text-xs text-dim hover:text-white">
          kalebkim.com
        </a>
      </div>
    </div>
  );
}

function Tile({ icon, label, onClick, hot, autofocus }: { icon: ReactNode; label: string; onClick: () => void; hot?: boolean; autofocus?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-autofocus={autofocus || undefined}
      className={cx(
        "nav rise group skew flex h-[clamp(6.5rem,24vh,11rem)] w-[clamp(8rem,22vw,15rem)] flex-col justify-between rounded-[3px] border p-4 text-left",
        hot ? "border-hot bg-gradient-to-br from-hot to-[#b3002a] hover:bg-hot" : "glass",
      )}
    >
      <span className="unskew block text-[clamp(2rem,6vh,3.25rem)]">{icon}</span>
      <span className="unskew ttl block text-[clamp(1.5rem,4.5vh,2.5rem)] leading-none">{label}</span>
    </button>
  );
}

function TopBar({ onBack, step, mode }: { onBack: () => void; step: 1 | 2; mode: Mode }) {
  return (
    <div className="flex items-center gap-3">
      <IconBtn label="Back" onClick={onBack}>
        <Back />
      </IconBtn>
      <span className="glass grid h-11 w-11 place-items-center rounded-[3px] text-xl text-hot">{mode === "race" ? <Flag /> : <Road />}</span>
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2].map((i) => (
          <span key={i} className={cx("h-1 w-8 skew rounded-[1px] transition-colors duration-200", i <= step ? "bg-hot" : "bg-line-hi")} />
        ))}
      </div>
    </div>
  );
}

function useCenter(ref: React.RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-k="${key}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [ref, key]);
}

export function MapPicker({ maps, pick, onPick, onBack, onNext, mph }: { maps: readonly MapCard[]; pick: MenuPick; onPick: (p: MenuPick) => void; onBack: () => void; onNext: () => void; mph?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onBack);
  useCenter(strip, pick.map);
  const cur = maps.find((m) => m.id === pick.map) ?? maps[0];
  const laps = pick.mode === "race" && cur?.closed !== false;
  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col gap-3 bg-gradient-to-t from-black/70 via-transparent to-black/40">
      <TopBar onBack={onBack} step={1} mode={pick.mode} />
      <div ref={strip} className="noscroll -mx-6 flex min-h-0 flex-1 snap-x snap-mandatory items-center gap-4 overflow-x-auto px-[50vw] py-4">
        {maps.map((m, i) => {
          const on = m.id === pick.map;
          return (
            <button
              key={m.id}
              data-k={m.id}
              type="button"
              data-autofocus={on || undefined}
              data-on={on ? "1" : undefined}
              onFocus={() => focusByKey() && onPick({ ...pick, map: m.id })}
              onClick={() => (on ? onNext() : onPick({ ...pick, map: m.id }))}
              className={cx(
                "nav rise glass flex aspect-[4/5] h-full max-h-[24rem] min-h-0 shrink-0 snap-center flex-col rounded-[4px] p-[clamp(0.6rem,2vh,1.1rem)] text-left",
                on ? "scale-100" : "scale-[0.92] opacity-70 hover:opacity-100",
              )}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="relative min-h-0 flex-1">
                <TrackLine pts={m.outline} closed={m.closed} glow={on} className={cx("absolute inset-0 h-full w-full transition-colors duration-200", on ? "text-white" : "text-mute")} />
              </div>
              <div className="ttl truncate text-[clamp(1.4rem,4.4vh,2.1rem)] leading-none">{m.name}</div>
              <div className="mt-1 flex items-center gap-1 truncate text-[clamp(0.85rem,2.4vh,1rem)] text-mute">
                <Pin className="shrink-0" /> {m.place}
              </div>
              <div className="mt-2 flex items-center gap-3 border-t border-line pt-2 text-[clamp(0.9rem,2.6vh,1.1rem)] text-mute">
                {m.weather && <WeatherIcon weather={m.weather} hour={m.hour ?? 12} className="text-white" />}
                {m.length != null && (
                  <span className="num flex items-center gap-1 text-white">
                    <Ruler className="text-mute" />
                    {fmtLength(m.length, !!mph)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-3">
        {laps && <Stepper label="Laps" icon={<Laps />} value={pick.laps} min={1} max={20} onChange={(v) => onPick({ ...pick, laps: v })} />}
        <GoButton onClick={onNext} label="Next">
          <Fwd />
        </GoButton>
      </div>
    </div>
  );
}

function GoButton({ onClick, label, children, tall }: { onClick: () => void; label: string; children: ReactNode; tall?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cx("nav skew flex min-w-36", tall ? "h-16" : "h-14", " items-center justify-center gap-2 rounded-[3px] border border-hot bg-hot px-6 hover:bg-[#ff4d6d]")}
    >
      <span className="unskew ttl flex items-center gap-2 text-3xl">{children}</span>
    </button>
  );
}

const STAT_ICONS = { speed: Speed, handling: Wheel, accel: Bolt, braking: Disc } as const;

export function CarPicker({ cars, pick, onPick, onBack, onGo, goIcon }: { cars: readonly CarSpec[]; pick: MenuPick; onPick: (p: MenuPick) => void; onBack: () => void; onGo: () => void; goIcon?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onBack);
  useCenter(strip, pick.car);
  const car = cars.find((c) => c.id === pick.car) ?? cars[0];
  if (!car) return null;
  const st = carStats(car);
  const setCar = (c: CarSpec) => onPick({ ...pick, car: c.id, paint: c.paints[0] });
  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col gap-3 bg-gradient-to-r from-black/60 via-transparent to-transparent">
      <TopBar onBack={onBack} step={2} mode={pick.mode} />
      <div className="flex min-h-0 flex-1 items-center">
        <div key={car.id} className="glass rise w-[clamp(15rem,30vw,24rem)] rounded-[4px] p-[clamp(0.75rem,2.4vh,1.25rem)]">
          <div className="flex items-center gap-2 text-[clamp(1rem,3vh,1.25rem)]">
            <ClassBadge klass={car.klass} pi={car.pi} />
            <span className="num ml-auto text-mute">{car.year}</span>
          </div>
          <div className="ttl mt-1 truncate text-[clamp(1.75rem,6vh,3rem)] leading-[1.05]">{car.name}</div>
          <div className="mt-[clamp(0.4rem,1.5vh,1rem)] grid gap-[clamp(0.3rem,1.2vh,0.6rem)]">
            {(Object.keys(STAT_ICONS) as (keyof typeof STAT_ICONS)[]).map((k) => {
              const I = STAT_ICONS[k];
              const v = st[k];
              return (
                <div key={k} className="flex items-center gap-2.5" title={k}>
                  <I className="shrink-0 text-lg text-mute" />
                  <div className="flex h-2 flex-1 gap-[2px]">
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        key={i}
                        className="skew flex-1 rounded-[1px] transition-colors duration-200"
                        style={{ background: i < Math.round(v * 10) ? (i >= 8 ? "var(--color-hot)" : "white") : "var(--color-line)" }}
                      />
                    ))}
                  </div>
                  <span className="num w-8 text-right text-lg">{(v * 10).toFixed(1)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-[clamp(0.5rem,1.8vh,1rem)] flex flex-wrap gap-2 border-t border-line pt-[clamp(0.5rem,1.8vh,1rem)]">
            {car.paints.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={p}
                data-on={p === pick.paint ? "1" : undefined}
                onClick={() => onPick({ ...pick, paint: p })}
                className="nav h-8 w-8 rounded-full border-2 border-white/25"
                style={{ background: `radial-gradient(circle at 35% 30%, rgb(255 255 255/0.45), transparent 45%), ${p}` }}
              >
                {p === pick.paint && <span className="absolute inset-[-5px] rounded-full border-2 border-white" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div ref={strip} className="noscroll -my-2 flex min-w-0 flex-1 gap-2 overflow-x-auto py-2">
          {cars.map((c) => {
            const on = c.id === car.id;
            return (
              <button
                key={c.id}
                data-k={c.id}
                type="button"
                data-autofocus={on || undefined}
                data-on={on ? "1" : undefined}
                onFocus={() => focusByKey() && !on && setCar(c)}
                onClick={() => (on ? onGo() : setCar(c))}
                className={cx("nav glass flex h-16 w-[clamp(9rem,14vw,12rem)] shrink-0 flex-col justify-center gap-1.5 rounded-[3px] border-l-4 px-3 text-left", !on && "opacity-75 hover:opacity-100")}
                style={{ borderLeftColor: CLASS_COLOR[c.klass] }}
              >
                <span className="ttl truncate text-lg leading-none">{c.name}</span>
                <ClassBadge klass={c.klass} pi={c.pi} className="self-start text-[0.7rem]" />
              </button>
            );
          })}
        </div>
        <GoButton onClick={onGo} label="Go" tall>
          {goIcon ?? (
            <>
              <Play className="text-2xl" /> GO
            </>
          )}
        </GoButton>
      </div>
    </div>
  );
}
