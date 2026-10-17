"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Assists, CarId, CarSpec, MapId, Mode, Weather } from "./contracts";
import {
  Assist, Back, Bars, Bolt, Bot, Camera, Check, Clock, Cloud, Cog, Disc, Flag, Fog, Fwd, Gamepad, Gears, Globe, Laps, Minus, Moon, Pin, Play, Plus, Rain,
  Road, Ruler, Slider, Snow, Speed, Sun, Sunrise, Sunset, Tilt, Touch, Wheel, WeatherIcon,
} from "./ui-icons";
import { ClassBadge, CLASS_COLOR, IconBtn, Segmented, Stepper, TrackLine, carStats, cx, fmtLength, type MapCard } from "./ui-kit";
import { focusByKey, useNavRoot } from "./ui-nav";
import { CAMS, CamGlyph, presetOf, withPreset, type Settings } from "./ui-settings";

// The kit: car, paint and race options. Gears, assists, camera and steering live in Settings.
export type MenuPick = { mode: Mode; map: MapId; car: CarId; paint: string; laps: number; ai: number; skill: number; weather: Weather | "map"; hour: number | "map" };
export type MenuStep = "home" | "maps" | "kit";
// AI skill by level, 0..3. Level 2 is the old fixed field.
export const AI_SKILL = [0.55, 0.72, 0.86, 0.95] as const;
export const AI_MAX_SOLO = 11;
export const HOURS = [7, 13, 19, 23] as const;
export const WEATHERS: readonly Weather[] = ["clear", "overcast", "rain", "fog", "snow"];

type Props = {
  cars: readonly CarSpec[];
  maps: readonly MapCard[];
  pick: MenuPick;
  onPick: (p: MenuPick) => void; // the game shows the picked car and paint behind the menu
  onGo: (p: MenuPick) => void;
  onOnline: () => void;
  onSettings: () => void;
  onControls: () => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  touch: boolean;
  step?: MenuStep;
  onStep?: (s: MenuStep) => void;
  mph?: boolean;
};

export function Menu({ cars, maps, pick, onPick, onGo, onOnline, onSettings, onControls, settings, onSettingsChange, touch, step: initial = "home", onStep, mph = false }: Props) {
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
        onControls={onControls}
      />
    );
  if (step === "maps") return <MapPicker maps={maps} pick={pick} onPick={onPick} onBack={() => setStep("home")} onNext={() => setStep("kit")} mph={mph} />;
  const map = maps.find((m) => m.id === pick.map);
  return (
    <Kit cars={cars} pick={pick} onPick={onPick} settings={settings} onSettings={onSettingsChange} touch={touch} closed={map?.closed} place={map?.name} onBack={() => setStep("maps")} onGo={() => onGo(pick)} />
  );
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

function Home({ onMode, onOnline, onSettings, onControls }: { onMode: (m: Mode) => void; onOnline: () => void; onSettings: () => void; onControls: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref);
  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col bg-gradient-to-r from-black/70 via-black/10 to-transparent">
      <div className="flex items-start justify-between">
        <Logo className="ml-[0.08em] text-[clamp(4.5rem,15vh,9rem)]" />
        <div className="flex gap-2">
          <IconBtn label="Controls" onClick={onControls} className="text-2xl">
            <Gamepad />
          </IconBtn>
          <IconBtn label="Settings" onClick={onSettings} className="text-2xl">
            <Cog />
          </IconBtn>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-3">
          <Tile icon={<Flag />} label="Race" onClick={() => onMode("race")} hot autofocus />
          <Tile icon={<Clock />} label="Time" onClick={() => onMode("time")} />
          <Tile icon={<Road />} label="Free" onClick={() => onMode("free")} />
          <Tile icon={<Globe />} label="Online" onClick={onOnline} />
        </div>
        <a href="https://kalebkim.com" data-nonav tabIndex={-1} className="nav mb-1 shrink-0 rounded-[2px] [@media(max-height:500px)]:hidden border border-transparent px-1 text-xs text-dim hover:text-white">
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
      aria-label={label}
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

function TopBar({ onBack, step, mode, online, place }: { onBack: () => void; step?: 1 | 2; mode: Mode; online?: boolean; place?: string }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <IconBtn label="Back" onClick={onBack}>
        <Back />
      </IconBtn>
      <span className="glass grid h-11 w-11 place-items-center rounded-[3px] text-xl text-hot">{online ? <Globe /> : mode === "race" ? <Flag /> : mode === "time" ? <Clock /> : <Road />}</span>
      {step && (
        <div className="flex gap-1.5" aria-hidden>
          {[1, 2].map((i) => (
            <span key={i} className={cx("h-1 w-8 skew rounded-[1px] transition-colors duration-200", i <= step ? "bg-hot" : "bg-line-hi")} />
          ))}
        </div>
      )}
      {place && <span className="ttl truncate text-xl text-mute">{place}</span>}
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
        <GoButton onClick={onNext} label="Next">
          <Fwd />
        </GoButton>
      </div>
    </div>
  );
}

function GoButton({ onClick, label, children, tall, autofocus }: { onClick: () => void; label: string; children: ReactNode; tall?: boolean; autofocus?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-autofocus={autofocus || undefined}
      className={cx("nav skew flex min-w-36 shrink-0", tall ? "h-16" : "h-14", " items-center justify-center gap-2 rounded-[3px] border border-hot bg-hot px-6 hover:bg-[#ff4d6d]")}
    >
      <span className="unskew ttl flex items-center gap-2 text-3xl">{children}</span>
    </button>
  );
}

const STAT_ICONS = { speed: Speed, handling: Wheel, accel: Bolt, braking: Disc } as const;

function CarCard({ car, pick, onPick }: { car: CarSpec; pick: MenuPick; onPick: (p: MenuPick) => void }) {
  const st = carStats(car);
  return (
    <div key={car.id} className="glass rise w-[clamp(14rem,27vw,23rem)] shrink-0 self-center rounded-[4px] p-[clamp(0.6rem,2vh,1.1rem)]">
      <div className="flex items-center gap-2 text-[clamp(1rem,3vh,1.25rem)]">
        <ClassBadge klass={car.klass} pi={car.pi} />
        <span className="num ml-auto text-mute">{car.year}</span>
      </div>
      <div className="ttl mt-1 truncate text-[clamp(1.6rem,5.5vh,2.75rem)] leading-[1.05]">{car.name}</div>
      <div className="mt-[clamp(0.3rem,1.2vh,0.8rem)] grid gap-[clamp(0.25rem,1vh,0.5rem)]">
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
      <div className="mt-[clamp(0.4rem,1.5vh,0.9rem)] flex flex-wrap gap-2 border-t border-line pt-[clamp(0.4rem,1.5vh,0.9rem)]">
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
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2" role="group" aria-label={label} title={label}>
      <span className="grid w-6 shrink-0 place-items-center text-lg text-mute">{icon}</span>
      <div className="flex min-w-0 flex-1 gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon?: ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cx(
        "nav glass flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-[3px] px-1",
        on ? "bg-white text-black hover:bg-white" : "text-mute",
      )}
    >
      {icon && <span className="shrink-0 text-base">{icon}</span>}
      <span className="ttl truncate text-[0.95rem] leading-none tracking-normal">{label}</span>
    </button>
  );
}

const WEATHER_ICON: Record<Weather, ReactNode> = { clear: <Sun />, overcast: <Cloud />, rain: <Rain />, fog: <Fog />, snow: <Snow /> };
const HOUR_ICON = [<Sunrise key="0" />, <Sun key="1" />, <Sunset key="2" />, <Moon key="3" />];
const HOUR_LABEL = ["Dawn", "Noon", "Dusk", "Night"];

type KitProps = {
  cars: readonly CarSpec[];
  pick: MenuPick;
  onPick: (p: MenuPick) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  touch: boolean;
  onBack: () => void;
  onGo: () => void;
  closed?: boolean; // the map is a circuit, so laps apply
  place?: string;
  online?: boolean; // the host sets laps, AI and weather in the lobby
};

// One screen before every race: car, paint, gears, assists, steering, camera and race options over the live car.
export function Kit({ cars, pick, onPick, settings, onSettings, touch, onBack, onGo, closed, place, online }: KitProps) {
  const ref = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useNavRoot(ref, onBack);
  useCenter(strip, pick.car);
  const car = cars.find((c) => c.id === pick.car) ?? cars[0];
  if (!car) return null;
  const a = settings.assists;
  const setA = (p: Partial<Assists>) => onSettings({ ...settings, assists: { ...a, ...p } });
  const manual = !a.autoGear;
  const preset = presetOf(a);
  const laps = !online && pick.mode !== "free" && closed !== false;
  const field = !online && pick.mode === "race";
  const setCar = (c: CarSpec) => onPick({ ...pick, car: c.id, paint: c.paints[0] });
  const hourIdx = HOURS.findIndex((h) => h === pick.hour);
  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col gap-[clamp(0.4rem,1.5vh,0.75rem)] bg-gradient-to-r from-black/60 via-transparent to-black/60">
      <TopBar onBack={onBack} step={online ? undefined : 2} mode={pick.mode} online={online} place={place} />
      <div className="flex min-h-0 flex-1 items-stretch justify-between gap-3">
        <CarCard car={car} pick={pick} onPick={onPick} />
        <div className="glass rise noscroll flex min-h-0 w-[clamp(18rem,31vw,27rem)] shrink-0 flex-col gap-[clamp(0.3rem,1vh,0.5rem)] self-center overflow-y-auto rounded-[4px] p-[clamp(0.4rem,1.2vh,0.75rem)] [max-height:100%]">
          <Row icon={<Gears />} label="Transmission">
            <Segmented
              small
              className="flex-1"
              label="Transmission"
              value={manual ? "m" : "a"}
              onChange={(v) => setA({ autoGear: v === "a" })}
              options={[
                { v: "a", node: <span className="ttl text-lg">Auto</span>, title: "Auto" },
                { v: "m", node: <span className="ttl text-lg">Manual</span>, title: "Manual" },
              ]}
            />
            {manual && <Chip label="Rev match" icon={<Gears />} on={a.blip !== false} onClick={() => setA({ blip: a.blip === false })} />}
          </Row>
          <Row icon={<Assist />} label="Assists">
            <Segmented
              small
              className="flex-1"
              label="Assists"
              value={preset}
              onChange={(p) => p !== "custom" && onSettings({ ...settings, assists: withPreset(a, p) })}
              options={(["easy", "normal", "pro"] as const).map((p) => ({ v: p, node: <span className="ttl text-lg">{p}</span>, title: p }))}
            />
            <button
              type="button"
              aria-label="More assists"
              aria-expanded={more}
              title="More assists"
              onClick={() => setMore(!more)}
              className={cx("nav glass grid h-10 w-10 shrink-0 place-items-center rounded-[3px] text-lg", (more || preset === "custom") && "text-hot")}
            >
              {more ? <Minus /> : <Plus />}
            </button>
          </Row>
          {more && (
            <div className="grid shrink-0 grid-cols-4 gap-1.5 pl-8">
              <Chip label="ABS" on={a.abs} onClick={() => setA({ abs: !a.abs })} />
              <Chip label="TCS" on={a.tcs} onClick={() => setA({ tcs: !a.tcs })} />
              <Chip label="Stability" on={a.stability} onClick={() => setA({ stability: !a.stability })} />
              <Chip label="Steer" on={a.steer} onClick={() => setA({ steer: !a.steer })} />
            </div>
          )}
          {touch && (
            <Row icon={<Touch />} label="Steering">
              <Segmented
                small
                className="flex-1"
                label="Steering"
                value={settings.steer}
                onChange={(s) => onSettings({ ...settings, steer: s })}
                options={[
                  { v: "tilt", node: <><Tilt /> <span className="ttl text-lg">Tilt</span></>, title: "Tilt" },
                  { v: "slider", node: <><Slider /> <span className="ttl text-lg">Slider</span></>, title: "Slider" },
                ]}
              />
            </Row>
          )}
          <Row icon={<Camera />} label="Camera">
            <Segmented small className="flex-1" label="Camera" value={settings.camera} onChange={(m) => onSettings({ ...settings, camera: m })} options={CAMS.map((m) => ({ v: m, node: <CamGlyph mode={m} className="h-full w-full max-w-10" />, title: m }))} />
          </Row>
          {!online && <div className="shrink-0 border-t border-line" />}
          {(laps || field) && (
            <div className="flex shrink-0 gap-1.5 [&>*]:flex-1">
              {laps && <Stepper small label="Laps" icon={<Laps />} value={pick.laps} min={1} max={20} onChange={(v) => onPick({ ...pick, laps: v })} />}
              {field && <Stepper small label="AI" icon={<Bot />} value={pick.ai} min={0} max={AI_MAX_SOLO} onChange={(v) => onPick({ ...pick, ai: v })} />}
            </div>
          )}
          {field && pick.ai > 0 && (
            <Row icon={<Bot />} label="AI level">
              <Segmented
                small
                className="flex-1"
                label="AI level"
                value={String(pick.skill)}
                onChange={(v) => onPick({ ...pick, skill: +v })}
                options={AI_SKILL.map((_, i) => ({ v: String(i), node: <Bars level={(i + 1) as 1 | 2 | 3 | 4} size="1.25em" />, title: `AI level ${i + 1}` }))}
              />
            </Row>
          )}
          {!online && (
            <Row icon={<Cloud />} label="Weather">
              <Segmented
                small
                className="flex-1"
                label="Weather"
                value={pick.weather}
                onChange={(w) => onPick({ ...pick, weather: w })}
                options={[{ v: "map" as const, node: <Pin />, title: "Map weather" }, ...WEATHERS.map((w) => ({ v: w, node: WEATHER_ICON[w], title: w }))]}
              />
            </Row>
          )}
          {!online && (
            <Row icon={<Clock />} label="Time">
              <Segmented
                small
                className="flex-1"
                label="Time"
                value={hourIdx < 0 ? "map" : String(hourIdx)}
                onChange={(v) => onPick({ ...pick, hour: v === "map" ? "map" : HOURS[+v] })}
                options={[{ v: "map", node: <Pin />, title: "Map time" }, ...HOURS.map((_, i) => ({ v: String(i), node: HOUR_ICON[i], title: HOUR_LABEL[i] }))]}
              />
            </Row>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-end gap-3">
        <div ref={strip} className="noscroll -my-2 -ml-6 flex min-w-0 flex-1 gap-2 overflow-x-auto py-2 pl-6 pr-6 [mask-image:linear-gradient(90deg,transparent,#000_1.5rem,#000_calc(100%-1.5rem),transparent)]">
          {cars.map((c) => {
            const on = c.id === car.id;
            return (
              <button
                key={c.id}
                data-k={c.id}
                type="button"
                data-on={on ? "1" : undefined}
                onFocus={() => focusByKey() && !on && setCar(c)}
                onClick={() => (on ? onGo() : setCar(c))}
                className={cx("nav glass flex h-16 min-w-[clamp(9rem,14vw,12rem)] shrink-0 flex-col justify-center gap-1.5 rounded-[3px] border-l-4 px-3 text-left", !on && "opacity-75 hover:opacity-100")}
                style={{ borderLeftColor: CLASS_COLOR[c.klass] }}
              >
                <span className="ttl whitespace-nowrap text-lg leading-none">{c.name}</span>
                <ClassBadge klass={c.klass} pi={c.pi} className="self-start text-[0.7rem]" />
              </button>
            );
          })}
        </div>
        <GoButton onClick={onGo} label={online ? "Ready" : "Go"} tall autofocus>
          {online ? (
            <>
              <Check className="text-2xl" /> READY
            </>
          ) : (
            <>
              <Play className="text-2xl" /> GO
            </>
          )}
        </GoButton>
      </div>
    </div>
  );
}
