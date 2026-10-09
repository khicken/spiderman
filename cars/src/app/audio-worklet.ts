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

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

export function loadWorklet(ctx: BaseAudioContext, src: string): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
    p = ctx.audioWorklet
      .addModule(url)
      .then(() => true)
      .catch((e) => {
        console.warn("audio worklet failed", e);
        return false;
      })
      .finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, p);
  }
  return p;
}
