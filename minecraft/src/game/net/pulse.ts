// Browsers stop animation frames in a hidden tab and slow its timers to about one per second.
// A dedicated worker's timer keeps its pace, so it drives the game while the tab is hidden.
const PERIOD_MS = 50;

export interface Pulse {
  stop(): void;
}

export function startPulse(fn: () => void, period = PERIOD_MS): Pulse {
  if (typeof document === "undefined") return { stop() {} };
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let url = "";
  const start = () => {
    if (worker || timer) return;
    try {
      url ||= URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${period});`], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = () => fn();
    } catch {
      worker = null;
      timer = setInterval(fn, period);
    }
  };
  const halt = () => {
    worker?.terminate();
    worker = null;
    if (timer) clearInterval(timer);
    timer = null;
  };
  const sync = () => (document.hidden ? start() : halt());
  document.addEventListener("visibilitychange", sync);
  sync();
  return {
    stop() {
      document.removeEventListener("visibilitychange", sync);
      halt();
      if (url) URL.revokeObjectURL(url);
    },
  };
}
