// Run: npx tsx --test tests/audio.test.ts
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createAudio } from "../src/game/audio";

// Minimal Web Audio stand-in: enough graph surface for createAudio, with every source recorded.
class Param {
  value: number;
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}

class Node {
  outs = new Set<Node>();
  connect<T extends Node>(n: T): T { this.outs.add(n); return n; }
  disconnect() { this.outs.clear(); }
}

interface Src extends Node { loop: boolean; started: boolean; stopAt: number | null; onended: (() => void) | null }

class FakeCtx {
  static last: FakeCtx;
  sampleRate = 8000;
  currentTime = 0;
  state: "running" | "suspended" | "closed" = "running";
  resumes = 0;
  destination = new Node();
  sources: Src[] = [];
  listener = { positionX: new Param(0), positionY: new Param(0), positionZ: new Param(0), forwardX: new Param(0), forwardY: new Param(0), forwardZ: new Param(-1), upX: new Param(0), upY: new Param(1), upZ: new Param(0) };
  constructor() { FakeCtx.last = this; }
  createGain() { return Object.assign(new Node(), { gain: new Param(1) }); }
  createBiquadFilter() { return Object.assign(new Node(), { type: "lowpass", frequency: new Param(350), Q: new Param(1) }); }
  createConvolver() { return Object.assign(new Node(), { normalize: true, buffer: null }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createPanner() {
    return Object.assign(new Node(), { panningModel: "", distanceModel: "", refDistance: 1, maxDistance: 1, rolloffFactor: 1, positionX: new Param(0), positionY: new Param(0), positionZ: new Param(0) });
  }
  createBuffer(ch: number, len: number, sr: number) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { length: len, sampleRate: sr, duration: len / sr, numberOfChannels: ch, getChannelData: (i: number) => data[i] };
  }
  private source(): Src {
    const s = Object.assign(new Node(), { loop: false, started: false, stopAt: null as number | null, onended: null as (() => void) | null });
    const api = Object.assign(s, {
      start: () => { s.started = true; },
      stop: (t = 0) => { s.stopAt = t; },
    });
    this.sources.push(api);
    return api;
  }
  createBufferSource() { return Object.assign(this.source(), { buffer: null as unknown, playbackRate: new Param(1) }); }
  createOscillator() { return Object.assign(this.source(), { type: "sine", frequency: new Param(440), detune: new Param(0) }); }
  resume() { this.resumes++; this.state = "running"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  live() { return this.sources.filter((s) => s.started && s.stopAt === null); }
}

const listeners = new Map<string, Set<() => void>>();
const target = {
  addEventListener: (t: string, f: () => void) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
  removeEventListener: (t: string, f: () => void) => { listeners.get(t)?.delete(f); },
};
const fire = (t: string) => { for (const f of listeners.get(t) ?? []) f(); };
const g = globalThis as unknown as Record<string, unknown>;
g.window = { ...target, AudioContext: FakeCtx };
g.document = { ...target, visibilityState: "visible" };

const made: ReturnType<typeof createAudio>[] = [];
function fresh() {
  const a = createAudio();
  made.push(a);
  a.resume();
  return { a, ctx: FakeCtx.last };
}
// A failed assertion skips the test's own dispose; its timers would keep the runner alive.
afterEach(() => {
  for (const a of made.splice(0)) a.dispose();
});

test("leaving a paused world while underwater leaves no water loop in the menu", () => {
  const { a, ctx } = fresh();
  a.setUnderwater(true);
  assert.equal(ctx.live().filter((s) => s.loop).length, 1);
  a.setPaused(true);
  a.stopAll();
  a.setPaused(false);
  assert.equal(ctx.live().filter((s) => s.loop).length, 0);
  a.dispose();
});

test("voice cap holds under a flood of sounds", () => {
  const { a, ctx } = fresh();
  for (let i = 0; i < 200; i++) a.play("block.stone.break");
  assert.ok(ctx.live().length <= 32, `live voices ${ctx.live().length}`);
  a.dispose();
});

test("rendered buffers are cached per variant", () => {
  const { a, ctx } = fresh();
  for (let i = 0; i < 50; i++) a.play("block.grass.step");
  const bufs = new Set(ctx.sources.map((s) => (s as unknown as { buffer: unknown }).buffer));
  assert.ok(bufs.size <= 6, `distinct buffers ${bufs.size}`);
  a.dispose();
});

test("a long-suspended context drops one-shots instead of queueing a burst", async () => {
  const { a, ctx } = fresh();
  await new Promise((r) => setTimeout(r, 1100));
  ctx.state = "suspended";
  const before = ctx.sources.length;
  for (let i = 0; i < 10; i++) a.play("block.stone.break");
  assert.equal(ctx.sources.length, before);
  a.dispose();
});

test("context is resumed again after a tab switch and on later gestures", () => {
  const { a, ctx } = fresh();
  ctx.state = "suspended";
  fire("visibilitychange");
  assert.equal(ctx.state, "running");
  ctx.state = "suspended";
  fire("pointerdown");
  assert.equal(ctx.state, "running");
  a.dispose();
  assert.equal(listeners.get("pointerdown")?.size ?? 0, 0);
});

test("far positional sounds are culled, near ones are positioned", () => {
  const { a, ctx } = fresh();
  const n = ctx.sources.length;
  a.play("block.stone.break", 100, 0, 0);
  assert.equal(ctx.sources.length, n);
  a.play("block.stone.break", 3, 0, 0);
  assert.equal(ctx.sources.length, n + 1);
  a.dispose();
});

test("paused game plays no world sounds but keeps UI clicks", () => {
  const { a, ctx } = fresh();
  a.setPaused(true);
  const n = ctx.sources.length;
  a.play("block.stone.break");
  assert.equal(ctx.sources.length, n);
  a.play("ui.button.click");
  assert.equal(ctx.sources.length, n + 1);
  a.dispose();
});
