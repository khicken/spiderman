"use client";

import { useState } from "react";
import { PHOTO_FILTERS, PHOTO_FRAMES, type Photo, type PhotoFilter, type PhotoFrame } from "./photo";
import { Key } from "./ui-menu";

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer -skew-x-12 px-2.5 py-1 font-cond text-xs font-black uppercase italic transition-colors ${on ? "bg-spider text-white shadow-[3px_3px_0_#000]" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
    >
      {label}
    </button>
  );
}

export function PhotoPanel({ photo }: { photo: Photo }) {
  const [filter, setFilter] = useState<PhotoFilter>(photo.filter);
  const [frame, setFrame] = useState<PhotoFrame>("none");
  const [fov, setFov] = useState(Math.round(photo.fov));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const blob = await photo.capture(frame);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spiderman-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn("Photo capture failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {frame === "white" && <div className="pointer-events-none absolute inset-[2vmin] border-[2vmin] border-white" />}
      {frame === "comic" && (
        <>
          <div className="pointer-events-none absolute inset-0 border-[4vmin] border-[#f4f1e8]" />
          <div className="pointer-events-none absolute inset-[3.25vmin] border-[1.5vmin] border-black" />
          <div className="pointer-events-none absolute inset-x-[4vmin] bottom-[4vmin] h-[2vmin] bg-spider" />
        </>
      )}
      <div className="pointer-events-none absolute left-1/2 top-[calc(5vmin+8px)] -translate-x-1/2 font-cond text-xs font-black uppercase tracking-[0.35em] text-white/80 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
        Photo mode
      </div>
      <section
        data-photo-panel
        className="panel-in absolute bottom-4 left-1/2 w-[min(560px,calc(100%-32px))] -translate-x-1/2 border-t-4 border-spider bg-black/75 p-3 shadow-[6px_6px_0_rgba(0,0,0,0.5)] backdrop-blur-md sm:p-4"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-12 font-cond text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Filter</span>
          {PHOTO_FILTERS.map((f) => (
            <Chip
              key={f.id}
              on={filter === f.id}
              label={f.label}
              onClick={() => {
                photo.setFilter(f.id);
                setFilter(f.id);
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-12 font-cond text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Frame</span>
          {PHOTO_FRAMES.map((f) => (
            <Chip key={f.id} on={frame === f.id} label={f.label} onClick={() => setFrame(f.id)} />
          ))}
        </div>
        <label className="mt-2 flex items-center gap-3">
          <span className="w-12 font-cond text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">FOV</span>
          <input
            type="range"
            className="slider flex-1"
            min={20}
            max={100}
            step={1}
            value={fov}
            style={{ ["--fill" as string]: `${((fov - 20) / 80) * 100}%` }}
            onChange={(e) => {
              const v = Number(e.target.value);
              photo.setFov(v);
              setFov(v);
            }}
          />
          <span className="w-8 text-right font-cond text-sm font-bold tabular-nums">{fov}</span>
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-wider text-white/55 sm:flex">
            <span className="flex items-center gap-1">
              <Key dark>W</Key>
              <Key dark>A</Key>
              <Key dark>S</Key>
              <Key dark>D</Key> Fly
            </span>
            <span className="flex items-center gap-1">
              <Key dark>Space</Key>
              <Key dark>Z</Key> Up, down
            </span>
            <span>Drag to look</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={photo.exit} className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white">
              <Key dark>Esc</Key> Back
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="cursor-pointer -skew-x-12 bg-white px-4 py-1.5 font-cond text-sm font-black uppercase italic text-black shadow-[4px_4px_0_#e2231a] disabled:cursor-wait disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
