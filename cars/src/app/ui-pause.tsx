"use client";

import { useRef, type ReactNode } from "react";
import { Cog, Exit, Pause as PauseIcon, Play, Restart } from "./ui-icons";
import { cx } from "./ui-kit";
import { useNavRoot } from "./ui-nav";

export function Pause({ onResume, onRestart, onSettings, onQuit }: { onResume: () => void; onRestart?: () => void; onSettings: () => void; onQuit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onResume);
  return (
    <div ref={ref} className="safe fade absolute inset-0 flex flex-col items-center justify-center gap-[clamp(1rem,5vh,2.5rem)] bg-black/55 backdrop-blur-md">
      <PauseIcon className="text-[clamp(2.5rem,9vh,4.5rem)] text-white/90" />
      <div className="flex gap-[clamp(0.5rem,1.5vw,1rem)]">
        <Tile icon={<Play />} label="Resume" onClick={onResume} hot autofocus />
        {onRestart && <Tile icon={<Restart />} label="Restart" onClick={onRestart} />}
        <Tile icon={<Cog />} label="Settings" onClick={onSettings} />
        <Tile icon={<Exit />} label="Quit" onClick={onQuit} />
      </div>
    </div>
  );
}

function Tile({ icon, label, onClick, hot, autofocus }: { icon: ReactNode; label: string; onClick: () => void; hot?: boolean; autofocus?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-autofocus={autofocus || undefined}
      className={cx(
        "nav rise skew grid h-[clamp(5rem,22vh,8.5rem)] w-[clamp(5rem,22vh,8.5rem)] place-items-center rounded-[3px] border text-[clamp(2rem,8vh,3.25rem)]",
        hot ? "border-hot bg-hot hover:bg-[#ff4d6d]" : "glass",
      )}
    >
      <span className="unskew">{icon}</span>
    </button>
  );
}
