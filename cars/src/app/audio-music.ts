import type { MapId, MusicState } from "./contracts";
import { type ProcFn, procNode } from "./audio-worklet";
import type { musicSynth } from "./audio-music-synth";
import type { musicStyles } from "./audio-music-styles";

declare const SYN: ReturnType<typeof musicSynth>;
declare const STY: ReturnType<typeof musicStyles>;

export type MusicCmd = { state: MusicState; map?: MapId; at?: number };

export const musicProc: ProcFn = (Base, register, sr) => {
  type Cmd = { state: string; map?: string; at?: number };
  class MusicProc extends (Base as unknown as { new (o: { processorOptions: unknown }): { port: MessagePort } }) {
    syn = new SYN.Synth();
    song = new STY.Song();
    state = "off";
    map = "";
    style = "";
    pending: Cmd | null = null;
    script: Cmd[] = [];
    time = 0;
    pos = 0;
    target = 0;
    live = false;
    cut = 18000;
    cutT = 18000;
    seed = 1;
    constructor(o: { processorOptions: unknown }) {
      super(o);
      this.syn = new SYN.Synth();
      this.song = new STY.Song();
      const opt = (o.processorOptions || {}) as { script?: Cmd[]; seed?: number };
      this.script = (opt.script || []).slice();
      this.seed = opt.seed || 1 + Math.floor(Math.random() * 1e9);
      this.port.onmessage = (e: MessageEvent) => {
        this.pending = e.data as Cmd;
      };
      this.syn.level = 0;
    }
    styleOf(c: Cmd) {
      if (c.state === "menu") return "menu";
      if (c.state === "results") return "results";
      return c.map || "tokyo";
    }
    begin(name: string, final: boolean) {
      this.syn.releaseAll(false);
      this.song.start(name, final, this.seed++);
      const st = this.song.st;
      this.syn.dlyT = st.dly * this.song.spStep;
      this.syn.dlyFb = st.dlyFb;
      this.syn.duckDepth = st.duck;
      this.syn.duckRel = st.duckRel;
      this.style = name;
      this.pos = 0;
    }
    apply() {
      const c = this.pending;
      if (!c) return;
      const s = this.song.secStep;
      if (c.state === "off") {
        this.target = 0;
        this.state = "off";
        this.pending = null;
        return;
      }
      const name = this.styleOf(c);
      const wasOff = !this.live || this.target === 0;
      if (name === this.style && !wasOff) {
        if (c.state === "final" && !this.song.final && s % 16 === 0) this.song.goFinal();
        else if (c.state !== "final" && this.song.final && s % 16 === 0) this.song.final = false;
        else if (s % 16 !== 0) return;
      } else {
        if (!wasOff && c.state !== "results" && s % 4 !== 0) return;
        this.begin(name, c.state === "final");
      }
      this.state = c.state;
      this.map = c.map || "";
      this.target = 1;
      this.live = true;
      this.pending = null;
    }
    process(_in: Float32Array[][], outs: Float32Array[][]) {
      const [L, R] = outs[0];
      const [rl, rr] = outs[1];
      const N = L.length;
      while (this.script.length && (this.script[0].at || 0) * sr <= this.time) this.pending = this.script.shift()!;
      this.time += N;
      if (!this.live) {
        L.fill(0);
        R.fill(0);
        rl.fill(0);
        rr.fill(0);
        if (this.pending) this.apply();
        return true;
      }
      let off = 0;
      while (off < N) {
        if (this.pos <= 0) {
          this.apply();
          this.cutT = this.song.step(this.syn);
          this.pos += this.song.spStep;
        }
        const n = Math.min(N - off, 32, Math.ceil(this.pos));
        this.cut += (this.cutT - this.cut) * 0.08;
        this.syn.busCut = this.cut;
        const fade = this.target > this.syn.level ? 1 - Math.exp(-n / (sr * 0.4)) : 1 - Math.exp(-n / (sr * 0.6));
        this.syn.level += (this.target - this.syn.level) * fade;
        this.syn.render(L, R, rl, rr, off, n);
        this.pos -= n;
        off += n;
      }
      if (this.target === 0 && this.syn.level < 1e-4) {
        this.live = false;
        this.syn.releaseAll(true);
        this.style = "";
      }
      return true;
    }
  }
  register("car-music", MusicProc);
};


export function musicNode(ctx: BaseAudioContext, dest: AudioNode, verb: AudioNode, opts: { script?: MusicCmd[]; seed?: number } = {}) {
  const node = procNode(ctx, "car-music", { numberOfOutputs: 2, outputChannelCount: [2, 2], processorOptions: opts });
  node.connect(dest, 0);
  node.connect(verb, 1);
  return node;
}
