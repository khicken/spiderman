import type { ProcNode, ProcOpts, ProcParam } from "./audio-worklet";

type Proc = { process(i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>): boolean };
type Ctor = (new (o: { processorOptions?: unknown }) => Proc) & { parameterDescriptors?: { name: string; defaultValue?: number }[] };

const regs = new WeakMap<AudioContext, Map<string, Ctor>>();
let nextPort: MessagePort | null = null;

class MainBase {
  port: MessagePort;
  constructor() {
    this.port = nextPort!;
  }
}

export function mainProcs(ctx: AudioContext, src: string) {
  if (typeof ctx.createScriptProcessor !== "function") return false;
  try {
    const m = new Map<string, Ctor>();
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", src)(MainBase, (n: string, c: Ctor) => m.set(n, c), ctx.sampleRate);
    regs.set(ctx, m);
    return m.size > 0;
  } catch (e) {
    console.warn("audio main thread", e);
    return false;
  }
}

const B = 128;
const SIZE = 2048;

export function mainNode(ctx: AudioContext, name: string, o: ProcOpts): ProcNode {
  const C = regs.get(ctx)!.get(name)!;
  const ch = new MessageChannel();
  nextPort = ch.port1;
  const proc = new C({ processorOptions: o.processorOptions });
  nextPort = null;
  const params: Record<string, ProcParam> = {};
  const arrs: Record<string, Float32Array> = {};
  for (const d of C.parameterDescriptors ?? []) {
    const a = (arrs[d.name] = new Float32Array(1));
    a[0] = d.defaultValue ?? 0;
    params[d.name] = {
      get value() {
        return a[0];
      },
      set value(v) {
        a[0] = v;
      },
      setValueAtTime(v) {
        a[0] = v;
      },
    };
  }
  const counts = o.outputChannelCount;
  const total = counts.reduce((s, n) => s + n, 0);
  const outs = counts.map((n) => Array.from({ length: n }, () => new Float32Array(B)));
  const sp = ctx.createScriptProcessor(SIZE, 0, total);
  let alive = true;
  sp.onaudioprocess = (e) => {
    const ob = e.outputBuffer;
    if (!alive) {
      for (let c = 0; c < total; c++) ob.getChannelData(c).fill(0);
      return;
    }
    for (let off = 0; off < SIZE; off += B) {
      if (alive) alive = proc.process([], outs, arrs);
      let c = 0;
      for (const out of outs) for (const a of out) ob.getChannelData(c++).set(alive ? a : a.fill(0), off);
    }
  };
  let split: ChannelSplitterNode | null = null;
  const merges: ChannelMergerNode[] = [];
  if (counts.length > 1) {
    split = ctx.createChannelSplitter(total);
    sp.connect(split);
    let c = 0;
    for (const n of counts) {
      const m = ctx.createChannelMerger(n);
      for (let k = 0; k < n; k++) split.connect(m, c++, k);
      merges.push(m);
    }
  }
  return {
    port: ch.port2,
    parameters: { get: (n) => params[n] },
    connect: (dest, i = 0) => (split ? merges[i].connect(dest) : sp.connect(dest)),
    disconnect() {
      alive = false;
      sp.onaudioprocess = null;
      sp.disconnect();
      split?.disconnect();
      for (const m of merges) m.disconnect();
    },
  };
}
