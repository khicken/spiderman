// Vanilla BiomeAmbientSoundsHandler for the nether: a looping bed that fades over 2 s per biome,
// additions at 0.0111 per tick, and a mood sound every few minutes in the dark.
export interface BiomeAmbientDeps {
  ctx: AudioContext;
  out: AudioNode;
  loopBuffer(name: string): AudioBuffer | null;
  play(name: string, volume: number): void;
  level(): number;
}

interface Loop { src: AudioBufferSourceNode; gain: GainNode }

function seamless(ctx: AudioContext, b: AudioBuffer, fade: number): AudioBuffer {
  const n = b.length, f = Math.min(Math.floor(fade * b.sampleRate), Math.floor(n / 3));
  const out = ctx.createBuffer(1, n - f, b.sampleRate);
  const src = b.getChannelData(0), dst = out.getChannelData(0);
  dst.set(src.subarray(0, n - f));
  for (let i = 0; i < f; i++) {
    const k = i / f;
    dst[i] = src[i] * k + src[n - f + i] * (1 - k);
  }
  return out;
}

export function createBiomeAmbient(d: BiomeAmbientDeps) {
  let biome: string | null = null;
  let loop: Loop | null = null;
  const cache = new Map<string, AudioBuffer | null>();
  let nextMood = 0, last = 0;

  function fadeOut(l: Loop) {
    const now = d.ctx.currentTime;
    try {
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setValueAtTime(l.gain.gain.value, now);
      l.gain.gain.linearRampToValueAtTime(0, now + 2);
      l.src.stop(now + 2.1);
    } catch { /* already stopped */ }
    l.src.onended = () => {
      try { l.gain.disconnect(); } catch { /* gone */ }
    };
  }

  function start(name: string) {
    let buf = cache.get(name);
    if (buf === undefined) {
      const raw = d.loopBuffer(name);
      buf = raw ? seamless(d.ctx, raw, 0.75) : null;
      cache.set(name, buf);
    }
    if (!buf) return;
    const gain = d.ctx.createGain();
    gain.gain.value = 0;
    const src = d.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain).connect(d.out);
    src.start();
    gain.gain.linearRampToValueAtTime(0.6 * d.level(), d.ctx.currentTime + 2);
    loop = { src, gain };
  }

  return {
    set(next: string | null, paused: boolean) {
      const want = paused ? null : next;
      if (want !== biome) {
        if (loop) fadeOut(loop);
        loop = null;
        biome = want;
        if (want) start(`ambient.${want}.loop`);
      } else if (loop) loop.gain.gain.setTargetAtTime(0.6 * d.level(), d.ctx.currentTime, 0.5);
      const now = d.ctx.currentTime;
      const dt = Math.min(1, last ? now - last : 0);
      last = now;
      if (!biome) return;
      if (nextMood === 0) nextMood = now + 120 + Math.random() * 300;
      if (Math.random() < 1 - Math.pow(1 - 0.0111, dt * 20)) d.play(`ambient.${biome}.additions`, 1);
      if (now >= nextMood) {
        nextMood = now + 180 + Math.random() * 300;
        d.play(`ambient.${biome}.mood`, 1);
      }
    },
    stop() {
      if (loop) fadeOut(loop);
      loop = null;
      biome = null;
    },
  };
}
