import type { Audio } from "./contracts";
import { createBank } from "./audio-bank";
import { createEngine } from "./audio-engine";

let warned = 0;
const safe = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    if (warned++ < 5) console.warn("audio", e);
  }
};

export function createAudio(): Audio {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const bank = createBank(ctx.sampleRate);
  const eng = createEngine(ctx, bank, true);
  let volume = 1;
  let muted = false;
  const apply = () => safe(() => eng.setMaster(muted ? 0 : volume));
  void bank.load();
  const tick = () => safe(() => eng.pump(ctx.currentTime + 0.2));
  const timer = setInterval(tick, 30);
  return {
    sfx: (name, o) => safe(() => eng.sfx(name, o?.volume ?? 1, o?.pan ?? 0)),
    stinger: (name) => safe(() => eng.stinger(name)),
    update: (_dt, s) =>
      safe(() => {
        eng.update(s);
        tick();
      }),
    setMuted(m) {
      muted = m;
      apply();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      apply();
    },
    resume: () => ctx.resume().catch(() => {}),
    dispose() {
      clearInterval(timer);
      bank.stop();
      void ctx.close().catch(() => {});
    },
  };
}
