"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Assist, Camera, Gears, Handbrake, Link, Pin, Rewind, Ruler, WeatherIcon } from "./ui-icons";
import { TrackLine, fmtLength, type MapCard } from "./ui-kit";
import { Logo } from "./ui-menu";

const TIPS: { icon: ReactNode; text: string }[] = [
  { icon: <Rewind />, text: "Rewind any mistake" },
  { icon: <Camera />, text: "Try the hood camera" },
  { icon: <Handbrake />, text: "Handbrake for hairpins" },
  { icon: <Assist />, text: "Fewer assists, faster laps" },
  { icon: <Gears />, text: "Manual shifts gain time" },
  { icon: <Link />, text: "Share the room link" },
];

export function Loading({ map, progress, mph }: { map: MapCard; progress: number; mph?: boolean }) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 3500);
    return () => clearInterval(t);
  }, []);
  const p = Math.max(0, Math.min(1, progress));
  const t = TIPS[tip];

  return (
    <div className="safe fade absolute inset-0 flex flex-col bg-[radial-gradient(ellipse_at_70%_40%,#1a1f28_0%,var(--color-night)_70%)]">
      <div className="pointer-events-none absolute inset-y-[6%] right-[4%] aspect-square max-w-[60%]">
        <TrackLine pts={map.outline} closed={map.closed} glow width={3} className="h-full w-full text-white/90" />
      </div>
      <Logo className="self-start text-[clamp(2rem,6vh,3rem)]" />
      <div className="relative flex flex-1 flex-col justify-end gap-[clamp(0.5rem,2vh,1rem)]">
        <div className="flex items-center gap-1.5 text-[clamp(1rem,3vh,1.4rem)] text-mute">
          <Pin /> {map.place}
        </div>
        <div className="ttl text-[clamp(3rem,13vh,7rem)] leading-[0.85]">{map.name}</div>
        <div className="flex items-center gap-4 text-[clamp(1rem,3vh,1.4rem)] text-mute">
          {map.weather && <WeatherIcon weather={map.weather} hour={map.hour ?? 12} className="text-white" />}
          {map.length != null && (
            <span className="num flex items-center gap-1.5 text-white">
              <Ruler className="text-mute" /> {fmtLength(map.length, !!mph)}
            </span>
          )}
        </div>
        <div className="mt-[clamp(0.5rem,3vh,2rem)] flex items-center gap-4">
          <div className="relative h-1 flex-1 overflow-hidden bg-line">
            <div className="absolute inset-y-0 left-0 bg-hot transition-[width] duration-300 ease-out" style={{ width: `${p * 100}%` }} />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.35),transparent)] bg-[length:50%_100%] [animation:shimmer_1.4s_linear_infinite]" />
          </div>
          <span className="num w-14 text-right text-2xl">{Math.round(p * 100)}</span>
        </div>
        <div key={tip} className="rise flex h-8 items-center gap-2.5 text-[clamp(0.95rem,2.8vh,1.2rem)] text-mute">
          <span className="text-hot">{t.icon}</span>
          {t.text}
        </div>
      </div>
    </div>
  );
}
