import { type ProcFn, procNode } from "./audio-worklet";

// Dev capture of the live mix: every input channel is recorded as one mono stem.
export const tapProc: ProcFn = (Base, register) => {
  class Tap extends (Base as unknown as { new (o: unknown): { port: MessagePort } }) {
    on: boolean;
    buf: Float32Array[];
    n: number;
    constructor(o: unknown) {
      super(o);
      this.on = false;
      this.buf = [];
      this.n = 0;
      this.port.onmessage = (e: MessageEvent) => {
        this.on = !!e.data;
        if (!this.on) this.flush();
      };
    }
    flush() {
      if (!this.n) return;
      const out = this.buf.map((b) => b.slice(0, this.n));
      this.port.postMessage(out, out.map((b) => b.buffer));
      this.n = 0;
    }
    process(ins: Float32Array[][]) {
      const inp = ins[0];
      if (!this.on || !inp || !inp.length) return true;
      if (this.buf.length !== inp.length) this.buf = inp.map(() => new Float32Array(8192));
      for (let c = 0; c < inp.length; c++) this.buf[c].set(inp[c], this.n);
      this.n += inp[0].length;
      if (this.n + 128 > 8192) this.flush();
      return true;
    }
  }
  register("car-tap", Tap);
};

const b64 = (a: Float32Array) => {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export function createTap(ctx: AudioContext, stems: [string, AudioNode, number?][]) {
  const n = stems.length;
  const merge = ctx.createChannelMerger(n);
  stems.forEach(([, node, ch], i) => {
    if (ch === undefined) node.connect(merge, 0, i);
    else {
      const s = ctx.createChannelSplitter(2);
      node.connect(s);
      s.connect(merge, ch, i);
    }
  });
  const node = procNode(ctx, "car-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }) as unknown as AudioWorkletNode;
  merge.connect(node);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  return (sec: number) =>
    new Promise<{ sr: number; stems: Record<string, string> }>((done) => {
      const chunks: Float32Array[][] = [];
      let got = 0;
      const want = sec * ctx.sampleRate;
      node.port.onmessage = (e: MessageEvent) => {
        chunks.push(e.data);
        got += e.data[0].length;
        if (got < want) return;
        node.port.postMessage(false);
        node.port.onmessage = null;
        const stemsOut: Record<string, string> = {};
        stems.forEach(([name], i) => {
          const a = new Float32Array(got);
          let o = 0;
          for (const c of chunks) {
            a.set(c[i], o);
            o += c[i].length;
          }
          stemsOut[name] = b64(a);
        });
        done({ sr: ctx.sampleRate, stems: stemsOut });
      };
      node.port.postMessage(true);
    });
}
