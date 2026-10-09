import type { ProcFn } from "./audio-worklet";

export type EngineProfile = {
  cheap: boolean;
  electric: boolean;
  slots: number[]; // cycle phase of each firing, 0..1 over 720 degrees of crank
  bank: number[]; // exhaust bank per slot
  amp: number[]; // static strength per slot
  hdr: number[]; // extra header delay per slot, samples
  bankLen: number[]; // header resonance delay per bank, samples
  pipe: number; // tailpipe delay, samples
  refl: number;
  muffler: number; // Hz
  body: number; // Hz
  width: number; // pulse width, cycle fraction
  jitter: number;
  rasp: number;
  pops: number;
  whine: number;
  tone: number;
  turbo: number; // 0, 1 or 2 chargers
  sc: number; // supercharger level
  flutter: boolean;
  bang: boolean;
  idle: number;
  redline: number;
  gain: number;
  stereo: number;
};

export const ENGINE_PARAMS = ["rpm", "throttle", "load", "gear", "boost", "speed", "skid", "surface", "limiter", "pitch", "interior", "wet", "active"] as const;
export const SURFACES = ["asphalt", "curb", "grass", "gravel", "dirt", "snow", "cobble"] as const;

export const engineProc: ProcFn = (Base, register, sr) => {
  const TAU = Math.PI * 2;
  const NAMES = ["rpm", "throttle", "load", "gear", "boost", "speed", "skid", "surface", "limiter", "pitch", "interior", "wet", "active"];
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  const sat = (x: number) => (x < -3 ? -1 : x > 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));

  class Svf {
    a1 = 0;
    a2 = 0;
    a3 = 0;
    k = 1;
    ic1 = 0;
    ic2 = 0;
    bp = 0;
    hp = 0;
    fs = 48000;
    constructor(fs: number) {
      this.fs = fs;
      this.ic1 = 0;
      this.ic2 = 0;
    }
    set(f: number, q: number) {
      const g = Math.tan((Math.PI * clamp(f, 10, this.fs * 0.45)) / this.fs);
      this.k = 1 / q;
      this.a1 = 1 / (1 + g * (g + this.k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
    run(x: number) {
      const v3 = x - this.ic2;
      const v1 = this.a1 * this.ic1 + this.a2 * v3;
      const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
      this.ic1 = 2 * v1 - this.ic1;
      this.ic2 = 2 * v2 - this.ic2;
      this.bp = v1;
      this.hp = x - this.k * v1 - v2;
      return v2;
    }
  }

  const LUT = 512;
  const sharp = new Float32Array(LUT + 1);
  const soft = new Float32Array(LUT + 1);
  const shape = (out: Float32Array, a: number, b: number) => {
    let peak = 0;
    for (let i = 0; i <= LUT; i++) {
      const x = i / LUT;
      out[i] = Math.pow(x, a) * Math.pow(1 - x, b) - 0.18 * Math.sin(Math.PI * x) * x;
      peak = Math.max(peak, out[i]);
    }
    for (let i = 0; i <= LUT; i++) out[i] /= peak;
  };
  shape(sharp, 0.75, 5);
  shape(soft, 1.3, 2.4);

  class EngineProc extends (Base as unknown as { new (o: { processorOptions: unknown }): { port: MessagePort } }) {
    static get parameterDescriptors() {
      return NAMES.map((name) => ({ name, defaultValue: name === "pitch" ? 1 : name === "active" ? 1 : 0, automationRate: "k-rate" }));
    }
    p: EngineProfile;
    n: number;
    theta = 0;
    rpm = 0;
    thr = 0;
    load = 0;
    boost = 0;
    speed = 0;
    skid = 0;
    inter = 0;
    lastX: Float32Array;
    jit: Float32Array;
    hdrBuf: Float32Array;
    resBuf: Float32Array;
    pipeBuf: Float32Array;
    w = 0;
    seed = 22222;
    mfl: Svf;
    mfr: Svf;
    bodyF: Svf;
    raspHp = 0;
    pipeLp = 0;
    intake: Svf;
    roar: Svf;
    interLp: Svf;
    pop = 0;
    popDecay = 0.99;
    popLp = 0;
    popTone = 0.5;
    offT = 9;
    gate = 0;
    gear = 0;
    cut = 0;
    tPh = 0;
    tPh2 = 0;
    tNoise: Svf;
    bov = 0;
    bovF = 0;
    bovPh = 0;
    bovSvf: Svf;
    thrPrev = 0;
    boostPk = 0;
    scPh = 0;
    gwPh = 0;
    gwPh2 = 0;
    evPh = new Float64Array(4);
    sq1: Svf;
    sq2: Svf;
    sqLfo = 0;
    roll: Svf;
    grain = 0;
    grainLp = 0;
    grainSvf: Svf;
    slide: Svf;
    grainT = 0;
    bumpPh = 0;
    wind: Svf;
    windBp: Svf;
    dc = [0, 0, 0, 0];
    done = false;
    fs = 48000;
    prevL = 0;
    cutS = 1;
    edgeLp = 0;
    edgeSm = 0;
    raspSm = 0;
    constructor(o: { processorOptions: unknown }) {
      super(o);
      const p = o.processorOptions as EngineProfile;
      this.p = p;
      const fs = p.cheap ? sr / 2 : sr;
      this.fs = fs;
      this.n = p.slots.length;
      this.lastX = new Float32Array(Math.max(1, this.n)).fill(1);
      this.jit = new Float32Array(Math.max(1, this.n)).fill(1);
      this.hdrBuf = new Float32Array(512);
      this.resBuf = new Float32Array(512);
      this.pipeBuf = new Float32Array(4096);
      this.theta = 0;
      this.w = 0;
      this.seed = 1 + Math.floor(Math.random() * 1e6);
      this.mfl = new Svf(fs);
      this.mfr = new Svf(fs);
      this.bodyF = new Svf(fs);
      this.intake = new Svf(fs);
      this.roar = new Svf(fs);
      this.interLp = new Svf(fs);
      this.tNoise = new Svf(fs);
      this.bovSvf = new Svf(fs);
      this.sq1 = new Svf(fs);
      this.sq2 = new Svf(fs);
      this.roll = new Svf(fs);
      this.grainSvf = new Svf(fs);
      this.slide = new Svf(fs);
      this.wind = new Svf(fs);
      this.windBp = new Svf(fs);
      this.evPh = new Float64Array(4);
      this.dc = [0, 0, 0, 0];
      this.gear = 0;
      this.offT = 9;
      this.popDecay = 0.99;
      this.rpm = p.idle;
      this.done = false;
      this.port.onmessage = () => {
        this.done = true;
      };
    }
    rnd() {
      let s = this.seed;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      this.seed = s;
      return (s >>> 0) / 4294967296;
    }
    fire(amp: number, tone: number, tau: number) {
      if (amp < this.pop) return;
      this.pop = amp;
      this.popTone = tone;
      this.popDecay = Math.exp(-1 / (this.fs * tau));
    }
    process(_in: Float32Array[][], outs: Float32Array[][], par: Record<string, Float32Array>) {
      if (this.done) return false;
      const sr = this.fs;
      const step = this.p.cheap ? 2 : 1;
      const out = outs[0];
      const L = out[0];
      const R = out[1] || out[0];
      const N = L.length;
      if (par.active[0] < 0.5) {
        L.fill(0);
        if (R !== L) R.fill(0);
        return true;
      }
      const p = this.p;
      const dt = N / step / sr;
      const rpm0 = this.rpm;
      const rpm1 = Math.max(0, par.rpm[0]);
      this.rpm = rpm1;
      const thrT = clamp(par.throttle[0], 0, 1);
      const loadT = clamp(par.load[0], -1, 1);
      const ks = 1 - Math.exp(-dt / 0.03);
      this.thr += (thrT - this.thr) * ks;
      this.load += (loadT - this.load) * ks;
      this.boost += (clamp(par.boost[0], 0, 1) - this.boost) * (1 - Math.exp(-dt / 0.05));
      this.speed += (Math.abs(par.speed[0]) - this.speed) * (1 - Math.exp(-dt / 0.05));
      this.skid += (clamp(par.skid[0], 0, 1) - this.skid) * (1 - Math.exp(-dt / 0.04));
      this.inter += (clamp(par.interior[0], 0, 1) - this.inter) * (1 - Math.exp(-dt / 0.1));
      const thr = this.thr;
      const load = this.load;
      const pitch = clamp(par.pitch[0], 0.5, 2);
      const surf = Math.round(par.surface[0]);
      const wet = clamp(par.wet[0], 0, 1);
      const lim = par.limiter[0] > 0.5;
      const rpmN = clamp((rpm1 - p.idle) / Math.max(1, p.redline - p.idle), 0, 1.1);
      const onLoad = clamp(load, 0, 1);
      const over = thr < 0.08 && rpm1 > p.idle * 1.4 ? 1 : 0;

      const g = par.gear[0];
      if (g !== this.gear) {
        if (g > this.gear && this.gear >= 1) {
          this.cut = 0.075;
          if (p.bang) this.fire(1.6, 0.35, 0.02);
        }
        this.gear = g;
      }
      if (this.cut > 0) this.cut -= dt;
      if (thr > 0.15) this.offT = 0;
      else this.offT += dt;
      if (this.thrPrev - thrT > 0.35 && this.boostPk > 0.4 && p.turbo > 0) {
        this.bov = 1;
        this.bovF = 0;
      }
      this.thrPrev = thrT;
      this.boostPk = Math.max(this.boost, this.boostPk * Math.exp(-dt / 0.6));

      const bright = clamp(0.45 + 0.75 * onLoad + 0.35 * rpmN - 0.3 * over, 0.2, 1.5);
      this.mfl.set(p.muffler * bright * (0.7 + 0.5 * rpmN), 0.75);
      this.bodyF.set(Math.max(30, (rpm1 / 120) * this.n * pitch), 1.2);
      const cheap = p.cheap;
      if (!cheap) {
        this.intake.set(170 + rpm1 * 0.05, 2.2);
        this.roar.set(900 + 2200 * rpmN, 0.9);
        this.interLp.set(500 + 500 * onLoad, 0.7);
      }
      const level = (0.22 + 0.78 * thr) * (0.45 + 0.55 * Math.min(1, rpmN));
      const width = p.width * (1.1 - 0.35 * onLoad);
      const mixS = clamp(onLoad + 0.2, 0, 1);
      const jitAmt = p.jitter * (1.4 - rpmN) + (over ? 0.9 : 0);
      const popP = over ? p.pops * 0.22 * clamp((rpm1 - p.idle * 1.6) / (p.redline * 0.5), 0, 1) * Math.exp(-this.offT / 1.6) : 0;

      const turboLvl = p.turbo > 0 ? 0.05 * Math.pow(this.boost, 1.5) * (0.35 + 0.65 * thr) : 0;
      const tF = (2200 + 7000 * this.boost) * (0.75 + 0.25 * rpmN) * pitch;
      if (turboLvl > 0) this.tNoise.set(tF * 0.5, 6);
      let bovLvl = 0;
      if (this.bov > 0.001) {
        this.bovF += dt;
        this.bov *= Math.exp(-dt / (p.flutter ? 0.32 : 0.22));
        bovLvl = this.bov * 0.22 * Math.min(1, this.bovF / 0.012);
        this.bovSvf.set(p.flutter ? 1100 - 400 * this.bovF : 3200 * Math.exp(-this.bovF * 3) + 700, p.flutter ? 1.6 : 1.2);
      }
      const scLvl = p.sc * 0.035 * (0.3 + 0.7 * thr) * Math.min(1, rpmN + 0.15);
      const scF = (rpm1 / 60) * 8.4 * pitch;
      const gwLvl = p.whine * 0.02 * (0.35 + 0.65 * Math.abs(load)) * Math.min(1, this.speed / 8) * (this.gear > 0 ? 1 : 0);
      const gwF = (rpm1 / 60) * 19 * pitch;
      const gwF2 = this.speed * 23 * pitch;
      const sp = this.speed;
      const sk = this.skid;
      const grip = surf <= 1 || surf === 6;
      const loose = surf === 3 || surf === 4 || surf === 5;
      const sqLvl = grip ? 0.16 * Math.pow(sk, 1.4) * Math.min(1, sp / 5) * (1 - 0.7 * wet) : 0;
      const sqF = (650 + 450 * sk + sp * 3) * pitch;
      this.sq1.set(sqF, 9);
      this.sq2.set(sqF * 1.58, 7);
      const rollLvl = Math.min(1, sp / 45) * (cheap ? 0.025 : 0.05) * (surf === 6 ? 1.6 : surf === 2 ? 0.7 : 1) * (1 + wet * 0.6);
      this.roll.set(110 + sp * 5 + wet * 900, 0.6);
      const grainRate = loose ? (sp * 9 + sk * 500 + 1) / sr : surf === 2 ? (sp * 3 + sk * 120) / sr : 0;
      const grainLvl = (surf === 3 ? 0.4 : surf === 5 ? 0.22 : surf === 2 ? 0.14 : 0.28) * Math.min(1, sp / 6 + sk);
      const slideLvl = loose || surf === 2 ? (surf === 2 ? 0.05 : 0.09) * sk * Math.min(1, sp / 4) : 0;
      if (grainRate > 0) {
        this.grainSvf.set(surf === 5 ? 3800 : surf === 3 ? 2400 : surf === 2 ? 900 : 1300, 0.9);
        this.slide.set(surf === 5 ? 2600 : surf === 3 ? 1700 : surf === 2 ? 650 : 1000, 0.8);
      }
      const bumpF = surf === 1 ? sp / 0.5 : surf === 6 ? sp / 0.16 : 0;
      const bumpLvl = surf === 1 ? 0.14 * Math.min(1, sp / 8) : surf === 6 ? 0.04 * Math.min(1, sp / 8) : 0;
      const windLvl = cheap ? 0 : Math.min(0.11, 0.018 * Math.pow(sp / 30, 2));
      if (windLvl > 0) {
        this.wind.set(350 + sp * 22, 0.6);
        this.windBp.set(1300 + sp * 12, 3);
      }
      this.sqLfo += dt * 6.3;

      const ev = p.electric;
      const evF = (rpm1 / 60) * 4 * pitch;
      const evLvl = ev ? 0.03 * (0.25 + 0.75 * Math.abs(load)) * Math.min(1, rpm1 / 600) : 0;
      const invF = (900 + 150 * Math.floor(Math.min(7, rpm1 / 900))) * pitch;
      const invLvl = ev ? 0.012 * Math.abs(load) * Math.max(0, 1 - rpm1 / 7000) : 0;
      const hum = ev ? 0.05 * p.tone * (0.3 + 0.7 * thr) * Math.min(1, rpm1 / 300 + 0.2) : 0;
      const humF = (48 + rpmN * 160) * pitch;

      const stereo = p.stereo;
      const gain = p.gain;
      const tg = cheap ? 0.19 : 0.25;
      const nSlots = this.n;
      const hb = this.hdrBuf;
      const rb = this.resBuf;
      const pb = this.pipeBuf;
      const muff = this.mfl;
      const bodyF = this.bodyF;
      const pipeLen = p.pipe;
      const refl = p.refl;
      const raspK = p.rasp * (0.15 + 0.85 * onLoad) * (1 - 0.5 * over);
      const gateHz = 19;
      const clickK = level * (3 + 6 * p.rasp) * (0.25 + 0.75 * onLoad) * (1 - 0.7 * over) * (sr / 48000);
      const edgeK = (0.2 + p.rasp) * (0.25 + onLoad) * (1 - 0.6 * over) * 1.3;
      for (let i = 0; i < N; i += step) {
        const rpm = rpm0 + ((rpm1 - rpm0) * i) / N;
        let exA = 0;
        let exB = 0;
        let pulseSum = 0;
        if (!ev && nSlots > 0) {
          this.theta += ((rpm / 60) * pitch) / (2 * sr);
          if (this.theta >= 1) this.theta -= 1;
          if (lim) this.gate = (this.gate + gateHz / sr) % 1;
          this.cutS += ((lim && this.gate < 0.5) || this.cut > 0 ? 0.12 - this.cutS : 1 - this.cutS) * 0.004;
          const cut = this.cutS;
          const w = this.w;
          for (let k = 0; k < nSlots; k++) {
            let x = this.theta - p.slots[k];
            if (x < 0) x += 1;
            x /= width;
            if (x < this.lastX[k]) {
              let j = 1 + jitAmt * (this.rnd() - 0.5) * 0.6;
              if (over && this.rnd() < 0.3) j *= 0.25;
              this.jit[k] = j;
              if (popP > 0 && this.rnd() < popP) this.fire(0.25 + this.rnd() * (this.rnd() < 0.15 ? 1.4 : 0.6), 0.2 + this.rnd() * 0.6, 0.004 + this.rnd() * 0.01);
              if (lim && cut < 0.5 && this.rnd() < p.pops * 0.25) this.fire(0.3 + this.rnd() * 0.5, 0.5, 0.006);
              const a = clickK * p.amp[k] * j * cut;
              const o = (p.bank[k] << 8) + ((w + p.hdr[k]) & 255);
              const b = p.bank[k] << 8;
              hb[o] += a * 0.1;
              hb[b + ((o + 1) & 255)] += a * 0.2;
              hb[b + ((o + 2) & 255)] += a * 0.3;
              hb[b + ((o + 3) & 255)] += a * 0.25;
              hb[b + ((o + 4) & 255)] += a * 0.15;
            }
            this.lastX[k] = x;
            if (x >= 1) continue;
            const f = x * LUT;
            const fi = f | 0;
            const fr = f - fi;
            const s1 = sharp[fi] + (sharp[fi + 1] - sharp[fi]) * fr;
            const s0 = soft[fi] + (soft[fi + 1] - soft[fi]) * fr;
            const v = (s0 + (s1 - s0) * mixS) * p.amp[k] * this.jit[k] * level * cut;
            pulseSum += v;
            hb[((p.bank[k] << 8) + ((w + p.hdr[k]) & 255)) | 0] += v;
          }
          exA = hb[w & 255];
          exB = hb[256 + (w & 255)];
          hb[w & 255] = 0;
          hb[256 + (w & 255)] = 0;
          exA += -0.42 * rb[(w - p.bankLen[0]) & 255];
          exB += -0.42 * rb[256 + ((w - p.bankLen[1]) & 255)];
          rb[w & 255] = exA;
          rb[256 + (w & 255)] = exB;
          this.w = (w + 1) & 0xffff;
        }
        const noise = this.rnd() * 2 - 1;
        // Overrun pops and bangs enter before the tailpipe, so the pipe colors them.
        let popS = 0;
        if (this.pop > 1e-4) {
          this.popLp += (noise - this.popLp) * this.popTone;
          popS = (this.popLp * 1.4 + 0.8) * this.pop;
          this.pop *= this.popDecay;
        }
        const env = Math.abs(pulseSum);
        this.raspHp += (noise * env - this.raspHp) * 0.25;
        this.raspSm += ((noise * env - this.raspHp) * raspK - this.raspSm) * 0.5;
        const rasp = this.raspSm;
        let ex = exA + exB + popS;
        this.edgeLp += (ex - this.edgeLp) * 0.15;
        this.edgeSm += ((ex - this.edgeLp) * edgeK - this.edgeSm) * 0.45;
        const edge = this.edgeSm;
        const pi = this.w & 4095;
        const back = pb[(pi - pipeLen) & 4095];
        this.pipeLp += (back - this.pipeLp) * 0.4;
        ex += refl * this.pipeLp;
        pb[pi] = ex;
        bodyF.run(ex);
        let y = muff.run(ex) + 0.9 * bodyF.bp * (1.2 - p.tone) + rasp * 0.6 + edge;
        y = sat(y * (1.2 + 1.6 * p.rasp * onLoad)) * 0.75;
        let mono = y;
        if (!cheap) {
          const ink = this.intake.run(pulseSum * 0.6) + this.roar.run(noise) * 0.05 * thr * (0.3 + rpmN);
          const inter = this.interLp.run(y) * 1.0 + ink * 0.9;
          mono = y + ink * 0.25;
          mono += (inter - mono) * this.inter;
        }
        if (turboLvl > 0) {
          this.tPh += tF / sr;
          if (this.tPh >= 1) this.tPh -= 1;
          let t = Math.sin(TAU * this.tPh);
          if (p.turbo > 1) {
            this.tPh2 += (tF * 1.06) / sr;
            if (this.tPh2 >= 1) this.tPh2 -= 1;
            t = 0.6 * (t + Math.sin(TAU * this.tPh2));
          }
          this.tNoise.run(noise);
          mono += turboLvl * (t + this.tNoise.bp * 2.5);
        }
        if (bovLvl > 0) {
          this.bovSvf.run(noise);
          let gtr = 1;
          if (p.flutter) {
            this.bovPh += (22 - 12 * Math.min(1, this.bovF * 2)) / sr;
            gtr = this.bovPh % 1 < 0.45 ? 1 : 0.1;
          }
          mono += bovLvl * this.bovSvf.bp * 3 * gtr;
        }
        if (scLvl > 0) {
          this.scPh += scF / sr;
          if (this.scPh >= 1) this.scPh -= 1;
          mono += scLvl * (Math.sin(TAU * this.scPh) + 0.35 * Math.sin(2 * TAU * this.scPh) + 0.15 * noise);
        }
        if (gwLvl > 0 && !cheap) {
          this.gwPh += gwF / sr;
          this.gwPh2 += gwF2 / sr;
          if (this.gwPh >= 1) this.gwPh -= 1;
          if (this.gwPh2 >= 1) this.gwPh2 -= 1;
          mono += gwLvl * (Math.sin(TAU * this.gwPh) + 0.5 * Math.sin(TAU * this.gwPh2));
        }
        if (ev) {
          const ph = this.evPh;
          ph[0] += evF / sr;
          ph[1] += invF / sr;
          ph[2] += humF / sr;
          ph[3] += (humF * 1.505) / sr;
          for (let q = 0; q < 4; q++) if (ph[q] >= 1) ph[q] -= Math.floor(ph[q]);
          const a = TAU * ph[0];
          mono += evLvl * (Math.sin(a) + 0.45 * Math.sin(2 * a) + 0.2 * Math.sin(3 * a) + 0.12 * Math.sin(6 * a));
          mono += invLvl * Math.sin(TAU * ph[1]);
          const tri = 4 * Math.abs(ph[2] - 0.5) - 1;
          mono += hum * (tri + 0.5 * Math.sin(TAU * ph[3]) + 0.3 * Math.sin(2 * TAU * ph[2]));
        }
        mono *= gain;
        const engOnly = mono;
        if (sqLvl > 0.0005) {
          const wob = 1 + 0.25 * Math.sin(this.sqLfo + i * 0.0008);
          this.sq1.run(noise);
          let sq = this.sq1.bp * 3;
          if (!cheap) {
            this.sq2.run(noise);
            sq += this.sq2.bp * 1.5;
          }
          mono += sqLvl * wob * sq;
        }
        const r = this.roll.run(noise);
        mono += rollLvl * r * 3;
        if (grainRate > 0) {
          if (this.rnd() < grainRate) this.grainT = (0.4 + this.rnd()) * (this.rnd() < 0.5 ? -1 : 1);
          this.grainT *= surf === 2 ? 0.995 : 0.985;
          this.grain += (this.grainT - this.grain) * (surf === 2 ? 0.08 : 0.3);
          this.grainLp = this.grainSvf.run(this.grain * noise + this.grain * 0.3);
          mono += grainLvl * (this.grainLp * 2.2 + this.grainSvf.bp);
          if (slideLvl > 0) {
            this.slide.run(noise);
            mono += slideLvl * this.slide.bp * 3;
          }
        }
        if (bumpLvl > 0) {
          this.bumpPh += bumpF / sr;
          if (this.bumpPh >= 1) this.bumpPh -= 1;
          const b = this.bumpPh < 0.3 ? Math.sin((Math.PI * this.bumpPh) / 0.3) : 0;
          mono += bumpLvl * (b - 0.19 + r * 0.6);
        }
        if (windLvl > 0) {
          this.windBp.run(noise);
          mono += windLvl * (this.wind.run(noise) * 1.6 + this.windBp.bp * 0.3);
        }

        mono = engOnly + (mono - engOnly) * tg;
        let l = mono;
        let rr = mono;
        if (stereo > 0) {
          const d = (sat(exA) - sat(exB)) * stereo * 0.5 * (1 - this.inter) * gain;
          l += d;
          rr -= d;
        }
        this.dc[1] = l - this.dc[0] + 0.995 * this.dc[1];
        this.dc[0] = l;
        this.dc[3] = rr - this.dc[2] + 0.995 * this.dc[3];
        this.dc[2] = rr;
        const ol = this.dc[1];
        if (step === 2) {
          L[i] = (ol + this.prevL) * 0.5;
          L[i + 1] = ol;
          this.prevL = ol;
        } else {
          L[i] = ol;
          if (R !== L) R[i] = this.dc[3];
        }
      }
      return true;
    }
  }
  register("car-engine", EngineProc);
};
