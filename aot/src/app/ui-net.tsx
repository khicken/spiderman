"use client";

import { useEffect, useState } from "react";
import type { SquadInfo } from "./net";
import { Label, PanelFrame } from "./ui-menu";

const NAME_KEY = "aot-lb-name";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const field = "min-w-0 flex-1 border border-bone/25 bg-ink/70 px-2 py-1.5 font-cond text-sm uppercase tracking-wider outline-none focus:border-brass";
const button = "cursor-pointer border border-brass/50 bg-blood/80 px-4 py-1.5 font-display text-lg uppercase hover:bg-blood disabled:cursor-default disabled:opacity-40";

function newCode() {
  return Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
}

export function SquadPanel({
  info,
  onOpen,
  onLeave,
  onPlay,
  onClose,
}: {
  info: SquadInfo | null;
  onOpen: (name: string, code: string, create: boolean) => void;
  onLeave: () => void;
  onPlay: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);
  const nm = name.trim() || "Scout";
  const open = (c: string, create: boolean) => {
    try {
      if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    } catch {}
    onOpen(nm, c, create);
  };

  return (
    <PanelFrame title="Squad" jp="分隊" onClose={onClose}>
      {!info ? (
        <>
          <Label>Your name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 12))}
            placeholder="Scout"
            maxLength={12}
            aria-label="Your name"
            className={`${field} mb-5 w-full`}
          />
          <Label>Host a room</Label>
          <button onClick={() => open(newCode(), true)} className={`${button} mb-5`}>
            Create room
          </button>
          <Label>Join a room</Label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 4) open(code, false);
            }}
            className="flex gap-2"
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              placeholder="CODE"
              aria-label="Room code"
              className={field}
            />
            <button type="submit" disabled={code.length !== 4} className={button}>
              Join
            </button>
          </form>
          <p className="mt-4 text-[11px] leading-snug text-bone/55">2 to 4 players. The host runs the titans. Solo play needs no room.</p>
        </>
      ) : (
        <>
          <Label>Room code</Label>
          <div className="mb-4 font-display text-6xl tracking-[0.2em]">{info.code}</div>
          {info.ended ? (
            <div className="mb-4 font-cond text-sm uppercase tracking-wider text-blood">{info.ended}</div>
          ) : !info.ready ? (
            <div className="mb-4 font-cond text-sm uppercase tracking-wider text-bone/50">Connecting</div>
          ) : (
            <>
              <Label>Scouts {info.names.length} / 4</Label>
              <ol className="mb-4">
                {info.names.map((n, i) => (
                  <li key={i} className="flex items-baseline gap-2 border-b border-bone/10 py-1 font-cond text-sm uppercase tracking-wider">
                    <span className="w-5 text-right tabular-nums text-brass">{i + 1}</span>
                    <span className="flex-1 truncate">{n}</span>
                    {i === 0 && <span className="text-[10px] text-bone/50">Host</span>}
                  </li>
                ))}
              </ol>
              <p className="mb-4 text-[11px] leading-snug text-bone/55">
                {info.host ? "Share the code. Press Play when your squad is in." : "Press Play. The host leads the waves."}
              </p>
            </>
          )}
          <div className="flex gap-2">
            {info.ready && (
              <button onClick={onPlay} className={button}>
                Play
              </button>
            )}
            <button onClick={onLeave} className="cursor-pointer border border-bone/25 px-4 py-1.5 font-display text-lg uppercase text-bone/75 hover:text-bone">
              Leave
            </button>
          </div>
        </>
      )}
    </PanelFrame>
  );
}
