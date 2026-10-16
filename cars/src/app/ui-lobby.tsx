"use client";

import { useEffect, useRef, useState } from "react";
import type { CarSpec, Entrant, Lobby as LobbyState } from "./contracts";
import type { Weather } from "./contracts";
import { Back, Bars, Bot, Car, Check, Cloud, Copy, Crown, Fog, Fwd, Laps, Link, Moon, Pencil, Pin, Play, Rain, Snow, Sun, Sunrise, Sunset, Users, pingLevel } from "./ui-icons";
import { CLASS_COLOR, IconBtn, Spinner, Stepper, TrackLine, cx, type MapCard } from "./ui-kit";
import { useNavRoot } from "./ui-nav";
import { MAX_LAPS } from "./net-check";

export type LobbyPlayer = Entrant & { ping?: number | null; host?: boolean; relay?: boolean; ready?: boolean }; // ready undefined: unknown, counts as ready

const MAX = 12;
const WEATHER: readonly (Weather | "map")[] = ["map", "clear", "overcast", "rain", "fog", "snow"];
const WEATHER_ICON = { map: <Pin />, clear: <Sun />, overcast: <Cloud />, rain: <Rain />, fog: <Fog />, snow: <Snow /> };
const HOURS: readonly (number | "map")[] = ["map", 7, 13, 19, 23];
const HOUR_ICON = [<Pin key="m" />, <Sunrise key="0" />, <Sun key="1" />, <Sunset key="2" />, <Moon key="3" />];
const hourIcon = (h: number | "map") => HOUR_ICON[Math.max(0, HOURS.indexOf(h))];

export function inviteUrl(room: string) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((ok, fail) => {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.cssText = "position:fixed;opacity:0;left:0;top:0";
    document.body.appendChild(t);
    t.select();
    const done = document.execCommand("copy");
    t.remove();
    if (done) ok();
    else fail(new Error("copy"));
  });
}

// Phones get the system share sheet, desktops the clipboard.
async function invite(room: string): Promise<boolean> {
  const url = inviteUrl(room);
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  if (coarse && navigator.share) {
    try {
      await navigator.share({ url, title: "Race me" });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  }
  try {
    await copyText(url);
    return true;
  } catch {
    return false;
  }
}

export function Lobby({
  room,
  players,
  lobby,
  host,
  maps,
  cars,
  onName,
  onLobby,
  onStart,
  onLeave,
  onKit,
  ready,
  onReady,
}: {
  room: string;
  players: readonly LobbyPlayer[];
  lobby: LobbyState;
  host: boolean;
  maps: readonly MapCard[];
  cars: readonly CarSpec[];
  onName: (name: string) => void;
  onLobby: (l: LobbyState) => void;
  onStart: () => void;
  onLeave: () => void;
  onKit: () => void;
  ready: boolean;
  onReady: (r: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onLeave);
  const [copied, setCopied] = useState(false);
  const map = maps.find((m) => m.id === lobby.map) ?? maps[0];
  const mi = maps.indexOf(map);
  const humans = players.length;
  const ai = Math.min(lobby.ai, MAX - humans);
  const set = (p: Partial<LobbyState>) => onLobby({ ...lobby, ...p });
  const cycle = (d: number) => set({ map: maps[(mi + d + maps.length) % maps.length].id });
  const next = <T,>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length];
  const guests = players.filter((p) => !p.host);
  const set_ = guests.filter((p) => p.ready !== false).length;
  const allReady = set_ === guests.length;

  const copy = () => {
    void invite(room).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  // back from a race: the host reopens the lobby so late joiners can race the next one
  useEffect(() => {
    if (host && lobby.startAt != null) onLobby({ ...lobby, startAt: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  return (
    <div ref={ref} className="safe fade absolute inset-0 mx-auto flex max-w-[80rem] flex-col gap-3 bg-black/45 backdrop-blur-[2px] [box-shadow:0_0_0_100vmax_rgb(0_0_0/0.45)]">
      <div className="flex items-center gap-3">
        <IconBtn label="Leave" onClick={onLeave}>
          <Back />
        </IconBtn>
        <div className="glass flex h-11 items-center gap-2 rounded-[3px] pl-3 pr-1">
          <Link className="text-lg text-mute" />
          <button type="button" onClick={copy} aria-label="Copy invite link" className="num text-[2rem] leading-none tracking-[0.12em] select-text">{room}</button>
          <button type="button" aria-label="Copy invite link" title="Copy invite link" onClick={copy} className={cx("nav ml-1 grid h-9 w-9 place-items-center rounded-[2px] border border-transparent text-lg", copied && "text-good")}>
            {copied ? <Check /> : <Copy />}
          </button>
        </div>
        <span className="ml-auto flex items-center gap-2 text-mute">
          <span className="num text-2xl text-white">{humans + ai}</span>
          <span className="num text-lg">/{MAX}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="glass noscroll flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[4px] py-1">
          {players.map((p) => (
            <Row key={p.id} p={p} car={cars.find((c) => c.id === p.car)} onName={onName} onCar={onKit} />
          ))}
          {Array.from({ length: ai }, (_, i) => (
            <div key={i} className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 text-dim last:border-b-0">
              <Bot className="text-lg" />
              <span className="num text-lg">{i + 1}</span>
            </div>
          ))}
        </div>

        <div className="flex w-[clamp(16rem,32vw,24rem)] shrink-0 flex-col gap-3">
          <div className="glass relative flex min-h-0 flex-1 flex-col rounded-[4px] p-3">
            <div className="relative min-h-0 flex-1">
              <TrackLine pts={map?.outline} closed={map?.closed} glow className="absolute inset-0 h-full w-full text-white" />
            </div>
            <div className="flex items-end gap-2">
              {host && (
                <IconBtn label="Previous map" onClick={() => cycle(-1)}>
                  <Back />
                </IconBtn>
              )}
              <div className="min-w-0 flex-1 text-center">
                <div className="ttl truncate text-[clamp(1.25rem,4vh,1.75rem)] leading-none">{map?.name}</div>
                <div className="mt-0.5 flex items-center justify-center gap-1 truncate text-sm text-mute">
                  <Pin /> {map?.place}
                </div>
              </div>
              {host && (
                <IconBtn label="Next map" onClick={() => cycle(1)}>
                  <Fwd />
                </IconBtn>
              )}
            </div>
          </div>
          {host ? (
            <>
              <div className="flex gap-2 [&>*]:flex-1">
                <Stepper small label="Laps" icon={<Laps />} value={lobby.laps} min={1} max={MAX_LAPS} onChange={(v) => set({ laps: v })} />
                <Stepper small label="AI" icon={<Bot />} value={ai} min={0} max={MAX - humans} onChange={(v) => set({ ai: v })} />
              </div>
              <div className="flex gap-2 [&>*]:flex-1">
                <button type="button" aria-label="Weather" title="Weather" onClick={() => set({ weather: next(WEATHER, lobby.weather) })} className="nav glass flex h-10 items-center justify-center gap-2 rounded-[3px] text-xl">
                  <Cloud className="text-base text-mute" /> {WEATHER_ICON[lobby.weather]}
                </button>
                <button type="button" aria-label="Time" title="Time" onClick={() => set({ hour: next(HOURS, lobby.hour) })} className="nav glass flex h-10 items-center justify-center gap-2 rounded-[3px] text-xl">
                  <Sun className="text-base text-mute" /> {hourIcon(lobby.hour)}
                </button>
              </div>
              <div className="flex gap-2">
                <KitBtn onClick={onKit} />
                <button
                  type="button"
                  aria-label="Start"
                  data-autofocus
                  onClick={onStart}
                  className={cx("nav skew flex h-14 flex-1 items-center justify-center rounded-[3px] border border-hot bg-hot hover:bg-[#ff4d6d]", !allReady && "opacity-60")}
                >
                  <span className="unskew ttl flex items-center gap-2 text-3xl">
                    <Play className="text-2xl" /> GO
                  </span>
                </button>
              </div>
              {!allReady && (
                <div className="flex items-center justify-center gap-2 text-mute" aria-live="polite">
                  <Users className="text-lg" />
                  <span className="num text-xl text-white">{set_}/{guests.length}</span>
                  <Spinner className="text-lg" />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="glass flex h-10 items-center justify-center gap-4 rounded-[3px] text-mute">
                <span className="flex items-center gap-1.5">
                  <Laps className="text-lg" />
                  <span className="num text-2xl text-white">{lobby.laps}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Bot className="text-lg" />
                  <span className="num text-2xl text-white">{ai}</span>
                </span>
                <span className="text-xl text-white">{WEATHER_ICON[lobby.weather]}</span>
                <span className="text-xl text-white">{hourIcon(lobby.hour)}</span>
              </div>
              <div className="flex gap-2">
                <KitBtn onClick={onKit} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={ready}
                  aria-label="Ready"
                  data-autofocus
                  onClick={() => onReady(!ready)}
                  className={cx("nav skew flex h-14 flex-1 items-center justify-center rounded-[3px] border", ready ? "glass border-good text-good" : "border-hot bg-hot hover:bg-[#ff4d6d]")}
                >
                  <span className="unskew ttl flex items-center gap-2 text-3xl">
                    {ready ? <Spinner className="text-2xl" /> : <Check className="text-2xl" />} READY
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KitBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Kit" title="Kit" onClick={onClick} className="nav glass skew grid h-14 w-16 shrink-0 place-items-center rounded-[3px]">
      <Car className="unskew text-3xl" />
    </button>
  );
}

function Row({ p, car, onName, onCar }: { p: LobbyPlayer; car?: CarSpec; onName: (n: string) => void; onCar: () => void }) {
  const [draft, setDraft] = useState(p.name);
  const commit = () => {
    const n = draft.trim().slice(0, 16);
    if (n && n !== p.name) onName(n);
    else setDraft(p.name);
  };
  return (
    <div className={cx("flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 last:border-b-0", p.me && "bg-hot-soft")}>
      <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-black/40" style={{ background: p.color }} />
      {p.me ? (
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={draft}
            maxLength={16}
            aria-label="Name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="nav min-w-0 flex-1 rounded-[2px] border border-line bg-transparent px-2 py-1 text-lg font-semibold outline-none select-text"
          />
          <Pencil className="shrink-0 text-mute" />
        </label>
      ) : (
        <span className="min-w-0 flex-1 truncate text-lg font-semibold">{p.name}</span>
      )}
      {p.host ? (
        <Crown className="shrink-0 text-lg text-gold" />
      ) : p.ready === true ? (
        <Check aria-label="Ready" className="shrink-0 text-lg text-good" />
      ) : p.ready === false ? (
        <Spinner className="shrink-0 text-lg" />
      ) : null}
      {p.relay && <Cloud aria-label="Relayed" className="shrink-0 text-lg text-mute" />}
      {p.me ? (
        <button type="button" aria-label="Car" onClick={onCar} className="nav flex h-10 shrink-0 items-center gap-2 rounded-[2px] border border-line px-2">
          <Car className="text-lg" style={{ color: car ? CLASS_COLOR[car.klass] : undefined }} />
          <span className="ttl hidden text-base sm:inline">{car?.name}</span>
        </button>
      ) : (
        <span className="flex shrink-0 items-center gap-2 px-2 text-mute">
          <Car className="text-lg" style={{ color: car ? CLASS_COLOR[car.klass] : undefined }} />
          <span className="ttl hidden text-base sm:inline">{car?.name}</span>
        </span>
      )}
      {!p.me && <span className="num w-10 shrink-0 text-right text-base text-mute">{p.ping != null ? Math.round(p.ping) : ""}</span>}
      <Bars level={p.me ? 4 : pingLevel(p.ping)} className={cx("shrink-0 text-lg", (p.ping ?? 0) > 180 ? "text-bad" : "text-good")} />
    </div>
  );
}
