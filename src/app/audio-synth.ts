// Procedural instrument voices. Each voice builds a few nodes, plays once, then frees them.

export const NOISE_SEC = 3;
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function shaperCurve(drive: number, out = 1) {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (out * Math.tanh(drive * x)) / norm;
  }
  return c;
}

export function makeBuffers(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate;
  const noise = ctx.createBuffer(1, sr * NOISE_SEC, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const impulse = ctx.createBuffer(2, Math.floor(sr * 2.4), sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const p = i / d.length;
      lp += (0.65 - 0.5 * p) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - p, 2.5) * (i < sr * 0.012 ? 0 : 1);
    }
  }

  const crackle = ctx.createBuffer(1, sr * 4, sr);
  const cd = crackle.getChannelData(0);
  let pop = 0;
  for (let i = 0; i < cd.length; i++) {
    if (Math.random() < 0.0004) pop = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.75);
    cd[i] = pop + (Math.random() * 2 - 1) * 0.012;
    pop *= 0.82;
  }
  return { noise, impulse, crackle };
}

export type Voices = ReturnType<typeof makeVoices>;

export function makeVoices(ctx: BaseAudioContext, noiseBuf: AudioBuffer) {
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.3;
  const vibAmt = ctx.createGain();
  vibAmt.gain.value = 8;
  vib.connect(vibAmt);
  vib.start();

  const g = (v = 1) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };
  const osc = (type: OscillatorType, f: number, t: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    return o;
  };
  const noise = (t: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(t, Math.random() * (NOISE_SEC - 0.5));
    return s;
  };
  const play = (srcs: AudioScheduledSourceNode[], nodes: AudioNode[], t: number, end: number, onEnd?: () => void) => {
    for (const s of srcs) {
      if (!(s instanceof AudioBufferSourceNode)) s.start(t);
      s.stop(end);
    }
    srcs[0].onended = () => {
      for (const s of srcs) s.disconnect();
      for (const n of nodes) n.disconnect();
      onEnd?.();
    };
  };
  const perc = (p: AudioParam, t: number, peak: number, a: number, d: number) => {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(0.0005, t + a + d);
  };
  const hum = () => 0.88 + Math.random() * 0.12;

  // Short filtered noise burst.
  function nz(d: AudioNode, t: number, dur: number, v: number, type: BiquadFilterType, f0: number, f1 = f0, q = 0.7, a = 0.001) {
    const n = noise(t);
    const f = filt(type, f0, q);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + a + dur);
    const e = g(0);
    perc(e.gain, t, v, a, dur);
    n.connect(f).connect(e).connect(d);
    play([n], [f, e], t, t + a + dur + 0.02);
  }
  // Single oscillator blip with pitch glide.
  function tone(d: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, glide: number, v: number, a: number, dur: number) {
    const o = osc(type, f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + Math.max(glide, 0.001));
    const e = g(0);
    perc(e.gain, t, v, a, dur);
    o.connect(e).connect(d);
    play([o], [e], t, t + a + dur + 0.02);
  }

  return {
    nz,
    tone,
    g,
    filt,
    osc,
    noise,
    play,
    perc,
    kick(d: AudioNode, t: number, v: number, punch = 1) {
      const o = osc("sine", 150 + 40 * punch, t);
      o.frequency.exponentialRampToValueAtTime(54, t + 0.06);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.32);
      const og = g(0);
      perc(og.gain, t, v, 0.002, 0.36);
      o.connect(og).connect(d);
      play([o], [og], t, t + 0.4);
      nz(d, t, 0.012, v * 0.28 * punch, "highpass", 2400);
    },
    k808(d: AudioNode, t: number, midi: number, dur: number, v: number, from?: number) {
      const f = mtof(midi);
      const o = osc("sine", f * 3.2, t);
      o.frequency.exponentialRampToValueAtTime(from ? mtof(from) : f, t + 0.05);
      if (from) o.frequency.exponentialRampToValueAtTime(f, t + 0.05 + Math.min(dur * 0.5, 0.18));
      const h = osc("triangle", f * 2, t);
      const hg = g(0.1);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v, t + 0.004);
      e.gain.setTargetAtTime(v * 0.6, t + 0.02, 0.25);
      e.gain.setTargetAtTime(0, t + dur, 0.05);
      o.connect(e);
      h.connect(hg).connect(e);
      e.connect(d);
      play([o, h], [hg, e], t, t + dur + 0.3);
      nz(d, t, 0.01, v * 0.25, "highpass", 3000);
    },
    snare(d: AudioNode, t: number, v: number, clap = false, bright = 1) {
      const n = noise(t);
      const bp = filt("bandpass", clap ? 1250 : 1800 * bright, clap ? 1.3 : 0.6);
      const e = g(0);
      if (clap) {
        const p = e.gain;
        p.setValueAtTime(0, t);
        for (let i = 0; i < 3; i++) {
          p.linearRampToValueAtTime(v * 0.9, t + i * 0.011 + 0.001);
          p.exponentialRampToValueAtTime(v * 0.15, t + i * 0.011 + 0.01);
        }
        p.linearRampToValueAtTime(v, t + 0.035);
        p.exponentialRampToValueAtTime(0.0005, t + 0.22);
      } else perc(e.gain, t, v * 0.75, 0.001, 0.18);
      n.connect(bp).connect(e).connect(d);
      play([n], [bp, e], t, t + 0.26);
      tone(d, t, "triangle", 215, 165, 0.06, v * (clap ? 0.2 : 0.5), 0.001, 0.09);
    },
    rim(d: AudioNode, t: number, v: number) {
      tone(d, t, "square", 1700, 1650, 0.01, v * 0.3, 0.0005, 0.025);
      nz(d, t, 0.02, v * 0.4, "bandpass", 3200, 3200, 2);
    },
    hat(d: AudioNode, t: number, v: number, open = false, hp = 7200) {
      const n = noise(t);
      const f = filt("highpass", hp);
      const pk = filt("peaking", 10500, 1);
      pk.gain.value = 5;
      const e = g(0);
      perc(e.gain, t, v * hum(), 0.001, open ? 0.3 : 0.032);
      n.connect(f).connect(pk).connect(e).connect(d);
      play([n], [f, pk, e], t, t + (open ? 0.34 : 0.05));
    },
    shaker(d: AudioNode, t: number, v: number) {
      nz(d, t, 0.06, v * hum(), "bandpass", 6500, 5500, 1.2, 0.012);
    },
    crash(d: AudioNode, t: number, v: number, len = 1.6) {
      nz(d, t, len, v, "highpass", 4200, 4200, 0.7, 0.002);
    },
    swell(d: AudioNode, t: number, dur: number, v: number) {
      const n = noise(t);
      const f = filt("highpass", 1800);
      f.frequency.exponentialRampToValueAtTime(6000, t + dur);
      const e = g(0);
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(v, t + dur);
      e.gain.linearRampToValueAtTime(0, t + dur + 0.04);
      n.connect(f).connect(e).connect(d);
      play([n], [f, e], t, t + dur + 0.06);
    },
    riser(d: AudioNode, t: number, dur: number, v: number) {
      const n = noise(t);
      const bp = filt("bandpass", 300, 3);
      bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v, t + dur);
      e.gain.linearRampToValueAtTime(0, t + dur + 0.03);
      n.connect(bp).connect(e).connect(d);
      play([n], [bp, e], t, t + dur + 0.05);
    },
    // Taiko or tom: pitched body plus skin noise.
    tom(d: AudioNode, t: number, midi: number, v: number, len = 0.5) {
      const f = mtof(midi);
      tone(d, t, "sine", f * 1.8, f, 0.05, v, 0.002, len);
      tone(d, t, "triangle", f * 2.6, f * 1.5, 0.04, v * 0.25, 0.001, len * 0.3);
      nz(d, t, len * 0.35, v * 0.45, "lowpass", 1400, 300, 0.8);
    },
    timp(d: AudioNode, t: number, midi: number, v: number) {
      const f = mtof(midi);
      tone(d, t, "sine", f * 1.04, f, 0.08, v, 0.004, 1.3);
      tone(d, t, "sine", f * 1.5, f * 1.5, 0, v * 0.3, 0.004, 0.6);
      tone(d, t, "sine", f * 2, f * 2, 0, v * 0.15, 0.004, 0.4);
      nz(d, t, 0.12, v * 0.35, "lowpass", 900, 300);
    },
    bass(d: AudioNode, t: number, midi: number, dur: number, v: number, from?: number, bright = 0.14) {
      const f = mtof(midi);
      const o = osc("sine", from ? mtof(from) : f, t);
      const h = osc("triangle", (from ? mtof(from) : f) * 2, t);
      if (from) {
        o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
        h.frequency.exponentialRampToValueAtTime(f * 2, t + 0.09);
      }
      const hg = g(bright);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v, t + 0.006);
      e.gain.setTargetAtTime(v * 0.55, t + 0.01, 0.3);
      e.gain.setTargetAtTime(0, t + dur, 0.03);
      o.connect(e);
      h.connect(hg).connect(e);
      e.connect(d);
      play([o, h], [hg, e], t, t + dur + 0.2);
    },
    sawBass(d: AudioNode, t: number, midi: number, dur: number, v: number, cut = 900) {
      const o = osc("sawtooth", mtof(midi), t);
      const s = osc("sine", mtof(midi), t);
      const lp = filt("lowpass", cut * 2.5, 4);
      lp.frequency.setTargetAtTime(cut * 0.4, t, 0.07);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v, t + 0.004);
      e.gain.setTargetAtTime(0, t + dur, 0.025);
      o.connect(lp).connect(e);
      s.connect(e);
      e.connect(d);
      play([o, s], [lp, e], t, t + dur + 0.15);
    },
    rhodes(d: AudioNode, t: number, midi: number, dur: number, v: number) {
      const f = mtof(midi);
      const c = osc("sine", f, t);
      const m = osc("sine", f, t);
      const mg = g(0);
      mg.gain.setValueAtTime(f * 1.4, t);
      mg.gain.setTargetAtTime(f * 0.15, t, 0.12);
      m.connect(mg).connect(c.frequency);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v * hum(), t + 0.004);
      e.gain.setTargetAtTime(0, t + 0.004, 0.9);
      e.gain.setTargetAtTime(0, t + dur, 0.08);
      c.connect(e).connect(d);
      play([c, m], [mg, e], t, t + dur + 0.4);
    },
    piano(d: AudioNode, t: number, midi: number, dur: number, v: number) {
      const f = mtof(midi);
      const a = osc("triangle", f, t);
      const b = osc("sine", f * 2.003, t);
      const bg = g(0.35);
      const lp = filt("lowpass", 5000, 0.5);
      lp.frequency.setTargetAtTime(900 + f, t, 0.25);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v * hum(), t + 0.003);
      e.gain.setTargetAtTime(0, t + 0.003, 0.6);
      e.gain.setTargetAtTime(0, t + dur, 0.12);
      a.connect(lp);
      b.connect(bg).connect(lp);
      lp.connect(e).connect(d);
      play([a, b], [bg, lp, e], t, t + dur + 0.6);
    },
    pad(d: AudioNode, t: number, notes: number[], dur: number, v: number, bright = 1, attack = 0.7) {
      const lp = filt("lowpass", 500 * bright, 0.6);
      lp.frequency.linearRampToValueAtTime(1300 * bright, t + dur * 0.6);
      lp.frequency.linearRampToValueAtTime(800 * bright, t + dur);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v, t + attack);
      e.gain.setTargetAtTime(0, t + dur, 0.35);
      const srcs: OscillatorNode[] = [];
      for (const n of notes) {
        for (const det of [-9, 9]) {
          const o = osc("sawtooth", mtof(n), t);
          o.detune.value = det;
          o.connect(lp);
          srcs.push(o);
        }
      }
      lp.connect(e).connect(d);
      play(srcs, [lp, e], t, t + dur + 1.6);
    },
    // Legato strings: slower attack and vibrato.
    strings(d: AudioNode, t: number, notes: number[], dur: number, v: number) {
      const lp = filt("lowpass", 2600, 0.5);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v, t + 0.25);
      e.gain.setTargetAtTime(0, t + dur, 0.2);
      const srcs: OscillatorNode[] = [];
      for (const n of notes) {
        for (const det of [-7, 6]) {
          const o = osc("sawtooth", mtof(n), t);
          o.detune.value = det;
          vibAmt.connect(o.detune);
          o.connect(lp);
          srcs.push(o);
        }
      }
      lp.connect(e).connect(d);
      play(srcs, [lp, e], t, t + dur + 1, () => {
        for (const o of srcs) vibAmt.disconnect(o.detune);
      });
    },
    stac(d: AudioNode, t: number, midi: number, dur: number, v: number) {
      const f = mtof(midi);
      const a = osc("sawtooth", f, t);
      const b = osc("sawtooth", f, t);
      b.detune.value = 9;
      const lp = filt("lowpass", 3400, 1);
      lp.frequency.setTargetAtTime(1500, t, 0.05);
      const e = g(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(v * hum(), t + 0.008);
      e.gain.setTargetAtTime(0, t + Math.min(dur, 0.09), 0.035);
      a.connect(lp);
      b.connect(lp);
      lp.connect(e).connect(d);
      play([a, b], [lp, e], t, t + Math.min(dur, 0.09) + 0.2);
    },
    brass(d: AudioNode, t: number, midi: number, dur: number, v: number, bright = 0.7) {
      const f = mtof(midi);
      const lp = filt("lowpass", 350, 2.2);
      const fp = lp.frequency;
      fp.setValueAtTime(350, t);
      fp.linearRampToValueAtTime(400 + 3200 * bright, t + 0.06);
      fp.setTargetAtTime(900 + 1100 * bright, t + 0.06, 0.15);
      fp.setTargetAtTime(400, t + dur, 0.06);
      const e = g(0);
      const p = e.gain;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(v, t + 0.035);
      p.setTargetAtTime(v * 0.72, t + 0.04, 0.12);
      p.setTargetAtTime(0, t + dur, 0.06);
      const srcs: OscillatorNode[] = [];
      const sub = g(0.35);
      for (const [type, mul, det] of [
        ["sawtooth", 1, -11],
        ["sawtooth", 1, 11],
        ["square", 0.5, 0],
      ] as [OscillatorType, number, number][]) {
        const o = osc(type, f * mul * 0.97, t);
        o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.05);
        o.detune.value = det;
        vibAmt.connect(o.detune);
        o.connect(mul < 1 ? sub : lp);
        srcs.push(o);
      }
      sub.connect(lp);
      lp.connect(e).connect(d);
      play(srcs, [lp, e, sub], t, t + dur + 0.4, () => {
        for (const o of srcs) vibAmt.disconnect(o.detune);
      });
    },
    stab(d: AudioNode, t: number, notes: number[], v: number, len = 0.24) {
      const lp = filt("lowpass", 3200, 1.5);
      lp.frequency.setTargetAtTime(450, t, 0.06);
      const e = g(0);
      perc(e.gain, t, v, 0.004, len);
      const srcs: OscillatorNode[] = [];
      for (const n of notes) {
        const o = osc("sawtooth", mtof(n), t);
        o.connect(lp);
        srcs.push(o);
      }
      lp.connect(e).connect(d);
      play(srcs, [lp, e], t, t + len + 0.06);
    },
    pluck(d: AudioNode, t: number, midi: number, v: number, dec = 0.17, type: OscillatorType = "square") {
      const o = osc(type, mtof(midi), t);
      const lp = filt("lowpass", 3600, 3);
      lp.frequency.setTargetAtTime(500, t, 0.05);
      const e = g(0);
      perc(e.gain, t, v * hum(), 0.003, dec);
      o.connect(lp).connect(e).connect(d);
      play([o], [lp, e], t, t + dec + 0.05);
    },
    bell(d: AudioNode, t: number, midi: number, v: number, dur = 0.9) {
      const f = mtof(midi);
      tone(d, t, "sine", f, f, 0, v, 0.002, dur);
      tone(d, t, "sine", f * 2.76, f * 2.76, 0, v * 0.22, 0.001, dur * 0.3);
      tone(d, t, "sine", f * 5.4, f * 5.4, 0, v * 0.1, 0.001, dur * 0.12);
    },
    sleigh(d: AudioNode, t: number, v: number) {
      for (let i = 0; i < 3; i++) nz(d, t + i * 0.009 + Math.random() * 0.006, 0.07, v * (1 - i * 0.25), "bandpass", 5200 + i * 1900, 5200 + i * 1900, 6, 0.002);
    },
    pulse(d: AudioNode, t: number, midi: number, v: number) {
      tone(d, t, "sine", mtof(midi) * 1.5, mtof(midi), 0.03, v, 0.004, 0.35);
    },
  };
}
