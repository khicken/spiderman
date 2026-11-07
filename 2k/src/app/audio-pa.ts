// HOOPS audio: the announcer switch. All voice audio comes from the pre-recorded Chatterbox clips in
// public/voice (see audio-voice.ts). The browser speechSynthesis voice is not used.
// Owner: audio-fx.

import type { Voice } from "./audio-voice";

export interface Announcer {
  /** Free-text calls are not spoken. The voice director picks recorded clips from sim events. */
  say(text: string, priority?: number): void;
  setVolume(v: number): void;
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  cancel(): void;
  dispose(): void;
}

export function createAnnouncer(voice: Voice): Announcer {
  let on = true;
  let vol = 0.8;
  return {
    say() {},
    setVolume(v) {
      vol = Math.max(0, Math.min(1, v));
      voice.setVolume(on ? vol : 0);
    },
    setEnabled(v) {
      on = v;
      voice.setVolume(on ? vol : 0);
      if (!v) voice.stop();
    },
    get enabled() {
      return on;
    },
    cancel() {
      voice.stop();
    },
    dispose() {
      voice.dispose();
    },
  };
}

const ORD = ["", "first", "second", "third", "fourth"];
export function periodName(p: number) {
  return p <= 4 ? `${ORD[p]} quarter` : p === 5 ? "overtime" : `overtime number ${p - 4}`;
}
