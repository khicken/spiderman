"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Entry } from "./api/leaderboard/route";

const API = "/aot/api/leaderboard";
const NAME_KEY = "aot-lb-name";

type Run = { score: number; wave: number; level: number };

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export function Leaderboard({ run }: { run?: Run }) {
  const [top, setTop] = useState<Entry[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState("");
  const [runId] = useState(newId);
  const [sent, setSent] = useState<"no" | "sending" | "yes">("no");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
    fetch(API)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { top: Entry[] }) => setTop(d.top))
      .catch(() => setOffline(true));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!run || sent !== "no") return;
    const n = name.trim();
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
    setSent("sending");
    setError("");
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, name: n, ...run }),
    }).catch(() => null);
    if (r?.ok) {
      setTop(((await r.json()) as { top: Entry[] }).top);
      setSent("yes");
      return;
    }
    setSent(r?.status === 409 ? "yes" : "no");
    setError(r?.status === 429 ? "Too many sends. Wait a few minutes." : r?.status === 503 || !r ? "Board offline." : "Send failed.");
  };

  const valid = /^[A-Za-z0-9 -]{1,12}$/.test(name.trim());
  return (
    <section className="hud-z panel-in w-full max-w-[360px] border border-brass/40 bg-gradient-to-b from-char/95 to-ink/95 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-md">
      <header className="mb-2 flex items-baseline gap-3 border-b border-brass/25 pb-1.5">
        <h2 className="font-display text-2xl uppercase tracking-wide">Top scouts</h2>
        <span className="font-jp text-sm font-bold tracking-[0.25em] text-blood">番付</span>
      </header>
      {offline ? (
        <div className="font-cond text-xs uppercase tracking-wider text-bone/50">Leaderboard offline</div>
      ) : (
        <>
          {run && run.score > 0 && sent !== "yes" && (
            <form onSubmit={submit} className="mb-2 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 12))}
                placeholder="Your name"
                maxLength={12}
                aria-label="Your name"
                className="min-w-0 flex-1 border border-bone/25 bg-ink/70 px-2 py-1 font-cond text-sm uppercase tracking-wider outline-none focus:border-brass"
              />
              <button
                type="submit"
                disabled={!valid || sent === "sending"}
                className="cursor-pointer border border-brass/50 bg-blood/80 px-3 font-display text-lg uppercase hover:bg-blood disabled:cursor-default disabled:opacity-40"
              >
                Send
              </button>
            </form>
          )}
          {error && <div className="mb-2 font-cond text-xs uppercase tracking-wider text-blood">{error}</div>}
          {!top ? (
            <div className="font-cond text-xs uppercase tracking-wider text-bone/50">Loading</div>
          ) : top.length === 0 ? (
            <div className="font-cond text-xs uppercase tracking-wider text-bone/50">No scores yet</div>
          ) : (
            <ol className="max-h-[42vh] overflow-y-auto">
              {top.map((t, i) => (
                <li key={i} className="flex items-baseline gap-2 border-b border-bone/10 py-0.5 font-cond text-sm">
                  <span className="w-5 text-right tabular-nums text-brass">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate uppercase tracking-wider">{t.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-bone/50">W{t.wave} L{t.level}</span>
                  <span className="w-16 text-right font-display text-lg leading-none tabular-nums">{t.score.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
