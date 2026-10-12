import { mainNode, mainProcs } from "./audio-fallback";

// Worklet processors are plain functions turned into source with toString(), so they must not touch imports or module scope.
// Each gets the worklet globals as arguments. Avoid class fields and private members: the compiler may lower them into helpers.

export type ProcBase = {
  new (options?: { processorOptions?: unknown }): { readonly port: MessagePort };
};
export type ProcFn = (base: ProcBase, register: (name: string, ctor: unknown) => void, sr: number) => void;

// fns: [name, factory source]; each factory runs once with the given argument list and its result binds to name.
export function workletSource(libs: [string, (...a: never[]) => unknown, string][], procs: ProcFn[]) {
  const lines = libs.map(([name, fn, args]) => `const ${name} = (${fn.toString()})(${args});`);
  for (const p of procs) lines.push(`(${p.toString()})(AudioWorkletProcessor, registerProcessor, sampleRate);`);
  return lines.join("\n");
}

export type ProcParam = { value: number; setValueAtTime(v: number, t: number): unknown };
export type ProcNode = {
  readonly port: { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };
  readonly parameters: { get(n: string): ProcParam | undefined };
  connect(dest: AudioNode, output?: number): unknown;
  disconnect(): void;
};
export type ProcOpts = { numberOfInputs?: number; numberOfOutputs: number; outputChannelCount: number[]; processorOptions?: unknown };
export type Path = "worklet" | "main" | "none";

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
const paths = new WeakMap<BaseAudioContext, Path>();
export const audioPath = (ctx: BaseAudioContext): Path | "pending" => paths.get(ctx) ?? "pending";

// A realtime context that has no worklet after `wait` ms runs the same processors on the main thread, so the game is never silent.
export function loadWorklet(ctx: BaseAudioContext, src: string, wait = 3000): Promise<boolean> {
  let p = loaded.get(ctx);
  if (p) return p;
  p = new Promise<boolean>((done) => {
    const settle = (path: Path) => {
      if (paths.has(ctx)) return;
      paths.set(ctx, path);
      done(path !== "none");
    };
    const fallback = (why: unknown) => {
      if (paths.has(ctx) || !(ctx instanceof AudioContext)) return settle("none");
      console.warn("audio worklet unavailable, using main thread:", why);
      settle(mainProcs(ctx, src) ? "main" : "none");
    };
    const timer = ctx instanceof AudioContext ? setTimeout(() => fallback("timeout"), wait) : 0;
    if (!ctx.audioWorklet) return fallback("no audioWorklet");
    const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
    ctx.audioWorklet
      .addModule(url)
      .then(() => {
        clearTimeout(timer);
        settle("worklet");
      })
      .catch((e) => {
        clearTimeout(timer);
        fallback(e);
      })
      .finally(() => URL.revokeObjectURL(url));
  });
  loaded.set(ctx, p);
  return p;
}

export function procNode(ctx: BaseAudioContext, name: string, o: ProcOpts): ProcNode {
  if (paths.get(ctx) === "main") return mainNode(ctx as AudioContext, name, o);
  return new AudioWorkletNode(ctx, name, { numberOfInputs: 0, ...o }) as unknown as ProcNode;
}
