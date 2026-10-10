import type { MapId, Weather } from "./contracts";
import { type C, clamp, filter, gain, noiseBuffer, rng } from "./audio-dsp";

type Bed = "wind" | "crowd" | "city" | "rain" | "water" | "crickets";
type Ev = "birds" | "traffic" | "foghorn" | "gulls" | "cheer";
type Profile = Partial<Record<Bed | Ev, number>>;

const MAPS: Record<MapId, Profile> = {
  monaco: { crowd: 0.45, city: 0.35, water: 0.35, gulls: 0.5, cheer: 0.5 },
  nordschleife: { crowd: 0.25, wind: 0.35, birds: 0.8, cheer: 0.3 },
  tokyo: { city: 0.75, traffic: 1 },
  sanfrancisco: { city: 0.5, traffic: 0.7, foghorn: 0.6, gulls: 0.6, water: 0.15, wind: 0.2 },
  stelvio: { wind: 0.7, birds: 1 },
  spa: { crowd: 0.4, wind: 0.3, birds: 0.6, cheer: 0.4 },
};

function crackleBuffer(c: C) {
  const sr = c.sampleRate;
  const b = c.createBuffer(2, sr * 3, sr);
  const r = rng(5);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let pop = 0;
    for (let i = 0; i < d.length; i++) {
      if (r() < 0.0025) pop = (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.85);
      d[i] = pop + (r() * 2 - 1) * 0.05;
      pop *= 0.7;
    }
  }
  return b;
}

export function createAmbience(c: C, out: AudioNode) {
  const r = rng(77);
  const master = gain(c, out, 1);
  const loop = (dest: AudioNode, buf: AudioBuffer, rate = 1) => {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(0, r() * buf.duration);
    return s;
  };
  const lfo = (target: AudioParam, f: number, depth: number) => {
    const o = c.createOscillator();
    o.frequency.value = f;
    o.connect(gain(c, target, depth));
    o.start();
    return o;
  };
  const nb = noiseBuffer(c);
  const srcs: AudioScheduledSourceNode[] = [];
  const beds = {} as Record<Bed, GainNode>;

  beds.wind = gain(c, master, 0);
  const gust = gain(c, beds.wind, 0.65);
  const windLp = filter(c, gust, "lowpass", 420, 0.8);
  srcs.push(loop(windLp, nb, 0.5), lfo(windLp.frequency, 0.06, 160), lfo(gust.gain, 0.11, 0.35));

  beds.crowd = gain(c, master, 0);
  for (const [f, q, rate] of [[380, 1.5, 0.9], [850, 2, 1], [1900, 2.5, 1.1]] as const) {
    const g = gain(c, beds.crowd, 0.6);
    srcs.push(loop(filter(c, g, "bandpass", f, q), nb, rate), lfo(g.gain, 0.2 + r() * 0.4, 0.35));
  }

  beds.city = gain(c, master, 0);
  srcs.push(loop(filter(c, gain(c, beds.city, 1.4), "lowpass", 160, 0.7), nb, 0.7));
  srcs.push(loop(filter(c, gain(c, beds.city, 0.35), "bandpass", 700, 0.6), nb, 0.9));
  const mains = c.createOscillator();
  mains.frequency.value = 100;
  mains.connect(gain(c, beds.city, 0.004));
  mains.start();
  srcs.push(mains);

  beds.rain = gain(c, master, 0);
  srcs.push(loop(filter(c, gain(c, beds.rain, 0.5), "highpass", 1200), nb, 1));
  srcs.push(loop(filter(c, gain(c, beds.rain, 0.6), "bandpass", 3500, 0.7), crackleBuffer(c), 1));
  srcs.push(loop(filter(c, gain(c, beds.rain, 0.4), "lowpass", 300), nb, 0.6));

  beds.water = gain(c, master, 0);
  const lap = gain(c, beds.water, 0.6);
  const wl = filter(c, lap, "lowpass", 600, 0.7);
  srcs.push(loop(wl, nb, 0.4), lfo(lap.gain, 0.17, 0.4), lfo(wl.frequency, 0.23, 250));

  beds.crickets = gain(c, master, 0);
  const ck = c.createOscillator();
  ck.frequency.value = 4400;
  const ckAm = gain(c, beds.crickets, 0);
  ck.connect(ckAm);
  ck.start();
  const pulse = c.createOscillator();
  pulse.type = "square";
  pulse.frequency.value = 28;
  const slow = c.createOscillator();
  slow.frequency.value = 0.7;
  const pg = gain(c, ckAm.gain, 0.5);
  pulse.connect(pg);
  slow.connect(gain(c, pg.gain, 0.5));
  pulse.start();
  slow.start();
  srcs.push(ck, pulse, slow);

  let prof: Profile = {};
  let night = 0;
  let weather: Weather = "clear";
  const nextAt: Partial<Record<Ev, number>> = {};

  function one(t: number, dur: number, fn: (o: AudioNode, end: number) => AudioScheduledSourceNode[], pan: number, v: number) {
    const p = c.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    const g = gain(c, p, v);
    p.connect(master);
    const list = fn(g, t + dur);
    list[0].onended = () => {
      for (const s of list) s.disconnect();
      g.disconnect();
      p.disconnect();
    };
  }
  const tone = (o: AudioNode, t: number, end: number, type: OscillatorType, f: number) => {
    const s = c.createOscillator();
    s.type = type;
    s.frequency.setValueAtTime(f, t);
    s.connect(o);
    s.start(t);
    s.stop(end);
    return s;
  };
  const nz = (o: AudioNode, t: number, end: number) => {
    const s = c.createBufferSource();
    s.buffer = nb;
    s.loop = true;
    s.connect(o);
    s.start(t, r());
    s.stop(end);
    return s;
  };

  const EVENTS: Record<Ev, { every: number; fire: (t: number, v: number) => void }> = {
    birds: {
      every: 2.5,
      fire(t, v) {
        const n = 2 + Math.floor(r() * 5);
        const base = 2500 + r() * 2500;
        one(t, n * 0.12 + 0.2, (o, end) => {
          const e = gain(c, o, 0);
          const s = tone(e, t, end, "sine", base);
          for (let i = 0; i < n; i++) {
            const a = t + i * (0.08 + r() * 0.06);
            s.frequency.setValueAtTime(base * (0.9 + r() * 0.3), a);
            s.frequency.exponentialRampToValueAtTime(base * (1.2 + r() * 0.4), a + 0.05);
            e.gain.setValueAtTime(0, a);
            e.gain.linearRampToValueAtTime(0.5, a + 0.01);
            e.gain.linearRampToValueAtTime(0, a + 0.06);
          }
          return [s];
        }, r() * 1.6 - 0.8, v * 0.05);
      },
    },
    gulls: {
      every: 9,
      fire(t, v) {
        one(t, 1.2, (o, end) => {
          const e = gain(c, filter(c, o, "bandpass", 1500, 1.2), 0);
          const s = tone(e, t, end, "sawtooth", 1300);
          for (let i = 0; i < 3; i++) {
            const a = t + i * 0.32;
            s.frequency.setValueAtTime(1500, a);
            s.frequency.exponentialRampToValueAtTime(900, a + 0.25);
            e.gain.setValueAtTime(0, a);
            e.gain.linearRampToValueAtTime(0.4, a + 0.03);
            e.gain.linearRampToValueAtTime(0, a + 0.26);
          }
          return [s];
        }, r() * 1.6 - 0.8, v * 0.04);
      },
    },
    traffic: {
      every: 3,
      fire(t, v) {
        const dur = 2.5 + r() * 2;
        one(t, dur, (o, end) => {
          const bp = filter(c, o, "bandpass", 500, 0.9);
          bp.frequency.setValueAtTime(400, t);
          bp.frequency.linearRampToValueAtTime(900, t + dur / 2);
          bp.frequency.linearRampToValueAtTime(350, end);
          const e = gain(c, bp, 0);
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(1, t + dur / 2);
          e.gain.linearRampToValueAtTime(0, end);
          return [nz(e, t, end)];
        }, r() * 2 - 1, v * 0.07);
      },
    },
    foghorn: {
      every: 45,
      fire(t, v) {
        one(t, 3.2, (o, end) => {
          const e = gain(c, filter(c, o, "lowpass", 600, 1), 0);
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(1, t + 0.3);
          e.gain.setValueAtTime(1, t + 2.4);
          e.gain.linearRampToValueAtTime(0, end);
          return [tone(e, t, end, "sawtooth", 155), tone(e, t, end, "sawtooth", 233)];
        }, -0.6, v * 0.05);
      },
    },
    cheer: {
      every: 20,
      fire(t, v) {
        one(t, 3, (o, end) => {
          const e = gain(c, filter(c, o, "bandpass", 1100, 0.8), 0);
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(1, t + 0.8);
          e.gain.linearRampToValueAtTime(0, end);
          return [nz(e, t, end)];
        }, r() - 0.5, v * 0.06);
      },
    },
  };

  function levels() {
    const p = prof;
    const now = c.currentTime;
    const wet = weather === "rain" ? 1 : 0;
    const day = 1 - night;
    const set = (b: Bed, v: number) => beds[b].gain.setTargetAtTime(v, now, 1.2);
    set("wind", (p.wind ?? 0.12) * 0.08 * (weather === "snow" ? 1.4 : 1) * (1 + 0.5 * wet));
    set("crowd", (p.crowd ?? 0) * 0.05 * (0.4 + 0.6 * day));
    set("city", (p.city ?? 0) * 0.07);
    set("rain", wet * 0.035);
    set("water", (p.water ?? 0) * 0.05);
    set("crickets", !p.city && night > 0.5 && weather !== "rain" && weather !== "snow" ? 0.004 : 0);
  }

  return {
    set(map: MapId, w: Weather, n: number) {
      prof = MAPS[map] ?? {};
      weather = w;
      night = clamp(n);
      levels();
    },
    tick() {
      const now = c.currentTime;
      for (const k of Object.keys(EVENTS) as Ev[]) {
        let v = prof[k] ?? 0;
        if (k === "birds" || k === "gulls") v *= (1 - night) * (weather === "rain" || weather === "snow" ? 0.2 : 1);
        if (k === "foghorn") v *= weather === "fog" ? 1.5 : 1;
        if (v <= 0) continue;
        const at = nextAt[k] ?? now + r() * EVENTS[k].every;
        if (at <= now + 0.3) {
          EVENTS[k].fire(Math.max(at, now + 0.02), v);
          nextAt[k] = now + EVENTS[k].every * (0.4 + r() * 1.2);
        } else nextAt[k] = at;
      }
    },
    setTunnel(t: number) {
      master.gain.setTargetAtTime(1 - 0.8 * t, c.currentTime, 0.3);
    },
    dispose() {
      for (const s of srcs) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
        s.disconnect();
      }
      master.disconnect();
    },
  };
}
