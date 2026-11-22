"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, GameEvent, HudFrame, HudHandle, HudSnapshot } from "./contracts";
import { startGame } from "./game";
import { readSave, readSettings } from "./state";

// Minimal menu + HUD so the scaffold runs. The ui builder replaces this with ui-app.tsx (swap line in page.tsx).

type Screen = "title" | "loading" | "play" | "paused" | "dead" | "ending";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const ringBox = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Screen>("title");
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    setHasSave(readSave() !== null);
    const canvas = canvasRef.current!, overlay = overlayRef.current!;
    let bannerT = 0;
    const handle: HudHandle = {
      frame(f: HudFrame) {
        const box = ringBox.current, ring = ringRef.current;
        if (box && ring) {
          box.style.opacity = f.staminaShow && f.staminaAt.on ? "1" : "0";
          box.style.transform = `translate(${f.staminaAt.x + 34}px, ${f.staminaAt.y - 34}px)`;
          ring.style.strokeDashoffset = String(100 - f.stamina * 100);
          ring.style.stroke = f.exhausted ? "var(--color-rubric)" : "var(--color-gold-hi)";
        }
        if (compassRef.current) compassRef.current.textContent = `${Math.round(((f.heading * 180) / Math.PI + 360) % 360)}°`;
        if (lockRef.current) {
          lockRef.current.style.opacity = f.lockOn && f.lockAt.on ? "1" : "0";
          lockRef.current.style.transform = `translate(${f.lockAt.x - 14}px, ${f.lockAt.y - 14}px)`;
        }
        if (bannerRef.current && bannerT > 0 && performance.now() > bannerT) {
          bannerRef.current.style.opacity = "0";
          bannerT = 0;
        }
      },
      event(e: GameEvent) {
        if (e.type === "areaEnter" && bannerRef.current) {
          bannerRef.current.textContent = e.name;
          bannerRef.current.style.opacity = "1";
          bannerT = performance.now() + 2500;
        }
      },
    };
    const game = startGame(canvas, overlay, {
      hud: setHud,
      hudRef: () => handle,
      progress: () => {},
      pause: () => {
        game.pause(true);
        setScreen("paused");
      },
      map: () => {},
      died: () => {
        game.pause(true);
        setScreen("dead");
      },
      ending: () => {
        game.pause(true);
        setScreen("ending");
      },
    }, readSettings());
    gameRef.current = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const begin = async (cont: boolean) => {
    const g = gameRef.current;
    if (!g) return;
    g.unlockAudio();
    setScreen("loading");
    await g.start(cont ? readSave() : null);
    g.pause(false);
    setScreen("play");
  };
  const resume = () => {
    gameRef.current?.pause(false);
    setScreen("play");
  };

  const hearts = hud ? Array.from({ length: hud.maxHp / 4 }, (_, i) => Math.max(0, Math.min(4, hud.hp - i * 4))) : [];

  return (
    <main className="fixed inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={overlayRef} className="safe pointer-events-none absolute inset-0">
        {screen === "play" && hud && (
          <>
            <div className="absolute left-6 top-5 flex gap-1.5" data-testid="hearts">
              {hearts.map((q, i) => (
                <span key={i} className="block h-5 w-3.5 rounded-t-full rounded-b-sm" style={{ background: `linear-gradient(to top, var(--color-ember) ${q * 25}%, var(--color-ink-faint) ${q * 25}%)` }} />
              ))}
            </div>
            <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-veil px-4 py-1 font-display text-lg text-parchment" ref={compassRef} />
            <div className="absolute right-6 top-5 text-right text-sm text-parchment" data-testid="hud-text">
              <div className="font-display text-base">{hud.glimmers} glimmers</div>
              <div className="opacity-80">{hud.objective}</div>
              <div className="opacity-60">{hud.fps.toFixed(0)} fps · {hud.quality}</div>
            </div>
            {hud.prompt && <div className="absolute bottom-24 left-1/2 -translate-x-1/2 font-display text-xl">{hud.prompt}</div>}
          </>
        )}
        <div ref={ringBox} className="absolute left-0 top-0 opacity-0 transition-opacity duration-300">
          <svg width="28" height="28" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-ink-faint)" strokeWidth="4" />
            <circle ref={ringRef} cx="18" cy="18" r="15.9" fill="none" strokeWidth="4" strokeDasharray="100 100" pathLength={100} transform="rotate(-90 18 18)" />
          </svg>
        </div>
        <div ref={lockRef} className="absolute left-0 top-0 h-7 w-7 rounded-full border-2 border-gold-hi opacity-0" />
        <div ref={bannerRef} className="absolute left-1/2 top-[22%] -translate-x-1/2 font-display text-4xl italic text-parchment opacity-0 transition-opacity duration-700" />
      </div>

      {screen !== "play" && (
        <div className="safe absolute inset-0 flex items-center justify-center bg-veil">
          <div className="w-[min(30rem,90vw)] border-2 border-gold bg-parchment px-10 py-8 text-center text-ink shadow-2xl" style={{ outline: "1px solid var(--color-ink-soft)", outlineOffset: "-8px" }}>
            {screen === "title" && (
              <>
                <h1 className="font-display text-5xl font-semibold tracking-[0.18em]">HOLLOWMERE</h1>
                <p className="mt-2 font-display text-xl italic text-ink-soft">Wake the four beacons.</p>
                <div className="mt-8 flex flex-col gap-3">
                  <button className="border border-ink bg-ink px-6 py-2.5 font-display text-xl text-parchment" onClick={() => begin(false)} data-testid="new-game">Begin a new journey</button>
                  {hasSave && <button className="border border-ink px-6 py-2.5 font-display text-xl" onClick={() => begin(true)}>Continue</button>}
                </div>
              </>
            )}
            {screen === "loading" && <p className="font-display text-2xl italic">Kindling the lantern…</p>}
            {screen === "paused" && (
              <>
                <h2 className="font-display text-4xl">Paused</h2>
                <button className="mt-6 border border-ink bg-ink px-6 py-2.5 font-display text-xl text-parchment" onClick={resume}>Resume</button>
              </>
            )}
            {screen === "dead" && (
              <>
                <h2 className="font-display text-4xl italic">The lantern gutters</h2>
                <button className="mt-6 border border-ink bg-ink px-6 py-2.5 font-display text-xl text-parchment" onClick={() => { gameRef.current?.respawn(); setScreen("play"); }}>Rekindle</button>
              </>
            )}
            {screen === "ending" && <h2 className="font-display text-4xl italic">Hollowmere wakes.</h2>}
          </div>
        </div>
      )}

      <div className="rotate-prompt safe absolute inset-0 z-50 items-center justify-center bg-night text-center font-display text-2xl italic text-parchment">
        Turn your device sideways to play.
      </div>
    </main>
  );
}
