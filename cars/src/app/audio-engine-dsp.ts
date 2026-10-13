import type { ProcFn } from "./audio-worklet";

export type EngineProfile = {
  cheap: boolean;
  electric: boolean;
  slots: number[]; // cycle phase of each firing, 0..1 over 720 degrees of crank
  bank: number[]; // exhaust bank per slot
  amp: number[]; // static strength per slot
  width: number; // pulse length as a share of the firing interval
  minMs: number; // shortest pulse, caps the deterministic brightness at high rpm
  maxMs: number; // longest pulse, keeps the idle punchy
  jitter: number; // cycle to cycle strength spread
  timeJit: number; // cycle to cycle timing spread, share of the firing interval
  hdr: number[]; // header delay per bank, samples
  hdrR: number;
  bankB: number; // level of the second bank, below 1 when the listener is nearer one side
  pipe: number; // tailpipe delay, samples
  pipeR: number;
  loopHz: number; // damping inside the pipe loops
  muffler: number; // Hz at full load
  body: number; // firing-locked low end
  noise: number; // combustion noise per firing
  noiseHz: number;
  noiseQ: number;
  rasp: number; // share of the firing noise that skips the muffler
  roar: number; // load roar
  roarHz: number;
  intake: number;
  intakeHz: number;
  drive: number;
  asym: number;
  tilt: number; // final low pass Hz
  pops: number;
  turbo: number; // 0, 1 or 2 chargers
  sc: number; // supercharger whine level
  hybrid: number; // motor whine under the engine
  whine: number; // gear whine
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
      return v2;
    }
  }

  // Smooth firing pulse: zero value and slope at both ends, so the pulse train rolls off fast above a few firing harmonics.
  const LUT = 1024;
  const shape = new Float32Array(LUT + 2);
  let peak = 0;
  for (let i = 0; i <= LUT; i++) {
    const x = i / LUT;
    shape[i] = x * x * Math.pow(1 - x, 4) * (1 - 0.25 * Math.sin(TAU * x));
    peak = Math.max(peak, shape[i]);
  }
  for (let i = 0; i <= LUT; i++) shape[i] /= peak;
  const POOL = 24;

  class EngineProc extends (Base as unknown as { new (o: { processorOptions: unknown }): { port: MessagePort } }) {
    static get parameterDescriptors() {
      return NAMES.map((name) => ({ name, defaultValue: name === "pitch" ? 1 : name === "active" ? 1 : 0, automationRate: "k-rate" }));
    }
    p: EngineProfile;
    n: number;
    fs: number;
    seed: number;
    done: boolean;
    theta: number;
    rpm: number;
    rpmT: number;
    thr: number;
    load: number;
    boost: number;
    speed: number;
    skid: number;
    inter: number;
    gear: number;
    cut: number;
    cutS: number;
    gate: number;
    offT: number;
    lastX: Float32Array;
    pt: Float64Array;
    pd: Float64Array;
    pa: Float32Array;
    pn: Float32Array;
    pb: Uint8Array;
    pc: number;
    walk: number;
    hbuf: Float32Array;
    hlp: Float32Array;
    pbuf: Float32Array;
    plp: number;
    w: number;
    nzF: Svf;
    bodyF: Svf;
    muf: Svf;
    muf2: Svf;
    roarF: Svf;
    intF: Svf;
    interLp: Svf;
    tiltLp: number;
    tiltR: number;
    hp: number[];
    pop: number;
    popDecay: number;
    popLp: number;
    popTone: number;
    tPh: number;
    tPh2: number;
    whoosh: Svf;
    bov: number;
    bovF: number;
    bovPh: number;
    bovSvf: Svf;
    thrPrev: number;
    boostPk: number;
    scPh: number;
    gwPh: number;
    gwPh2: number;
    evPh: Float64Array;
    evNoise: Svf;
    sqPh: number;
    sqWalk: number;
    sqAm: number;
    sqF: Svf;
    sqLp: Svf;
    roll: Svf;
    rollLo: Svf;
    grain: number;
    grainT: number;
    grainSvf: Svf;
    slide: Svf;
    bumpPh: number;
    wind: Svf;
    gust: number;
    prevL: number;
    prevR: number;
    constructor(o: { processorOptions: unknown }) {
      super(o);
      const p = o.processorOptions as EngineProfile;
      this.p = p;
      const fs = p.cheap ? sr / 2 : sr;
      this.fs = fs;
      this.n = p.slots.length;
      this.seed = 1 + Math.floor(Math.random() * 1e6);
      this.done = false;
      this.theta = 0;
      this.rpm = p.idle;
      this.rpmT = p.idle;
      this.thr = 0;
      this.load = 0;
      this.boost = 0;
      this.speed = 0;
      this.skid = 0;
      this.inter = 0;
      this.gear = 0;
      this.cut = 0;
      this.cutS = 1;
      this.gate = 0;
      this.offT = 9;
      this.lastX = new Float32Array(Math.max(1, this.n)).fill(1);
      this.pt = new Float64Array(POOL);
      this.pd = new Float64Array(POOL);
      this.pa = new Float32Array(POOL);
      this.pn = new Float32Array(POOL);
      this.pb = new Uint8Array(POOL);
      this.pc = 0;
      this.walk = 0;
      this.hbuf = new Float32Array(2048);
      this.hlp = new Float32Array(2);
      this.pbuf = new Float32Array(4096);
      this.plp = 0;
      this.w = 0;
      this.nzF = new Svf(fs);
      this.bodyF = new Svf(fs);
      this.muf = new Svf(fs);
      this.muf2 = new Svf(fs);
      this.roarF = new Svf(fs);
      this.intF = new Svf(fs);
      this.interLp = new Svf(fs);
      this.tiltLp = 0;
      this.tiltR = 0;
      this.hp = [0, 0, 0, 0, 0, 0, 0, 0];
      this.pop = 0;
      this.popDecay = 0.99;
      this.popLp = 0;
      this.popTone = 0.5;
      this.tPh = 0;
      this.tPh2 = 0;
      this.whoosh = new Svf(fs);
      this.bov = 0;
      this.bovF = 0;
      this.bovPh = 0;
      this.bovSvf = new Svf(fs);
      this.thrPrev = 0;
      this.boostPk = 0;
      this.scPh = 0;
      this.gwPh = 0;
      this.gwPh2 = 0;
      this.evPh = new Float64Array(5);
      this.evNoise = new Svf(fs);
      this.sqPh = 0;
      this.sqWalk = 0;
      this.sqAm = 0;
      this.sqF = new Svf(fs);
      this.sqLp = new Svf(fs);
      this.sqLp.set(2600, 0.6);
      this.roll = new Svf(fs);
      this.rollLo = new Svf(fs);
      this.grain = 0;
      this.grainT = 0;
      this.grainSvf = new Svf(fs);
      this.slide = new Svf(fs);
      this.bumpPh = 0;
      this.wind = new Svf(fs);
      this.gust = 0;
      this.prevL = 0;
      this.prevR = 0;
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
    spawn(t: number, d: number, a: number, nz: number, bank: number) {
      if (this.pc >= POOL) return;
      const i = this.pc++;
      this.pt[i] = t;
      this.pd[i] = d;
      this.pa[i] = a;
      this.pn[i] = nz;
      this.pb[i] = bank;
    }
    process(_in: Float32Array[][], outs: Float32Array[][], par: Record<string, Float32Array>) {
      if (this.done) return false;
      const fs = this.fs;
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
      const dt = N / step / fs;
      this.rpmT = Math.max(0, par.rpm[0]);
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
      const onLoad = clamp(load, 0, 1);
      const pitch = clamp(par.pitch[0], 0.5, 2);
      const surf = Math.round(par.surface[0]);
      const wet = clamp(par.wet[0], 0, 1);
      const lim = par.limiter[0] > 0.5;
      const rpmRef = this.rpm;
      const rpmN = clamp((rpmRef - p.idle) / Math.max(1, p.redline - p.idle), 0, 1.1);
      const over = thr < 0.08 && rpmRef > p.idle * 1.4 ? 1 : 0;
      const cheap = p.cheap;

      const g = par.gear[0];
      if (g !== this.gear) {
        if (g > this.gear && this.gear >= 1) {
          this.cut = 0.07;
          if (p.bang) this.fire(1.3, 0.3, 0.018);
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

      const level = (0.18 + 0.82 * Math.max(thr, onLoad)) * (0.55 + 0.45 * Math.min(1, rpmN)) * (over ? 0.45 : 1);
      const nzAmt = p.noise * (0.3 + 0.7 * onLoad) * (0.6 + 0.6 * rpmN) * (over ? 0.6 : 1);
      const jit = p.jitter * (1.3 - 0.6 * Math.min(1, rpmN)) + (over ? 0.35 : 0);
      const tj = p.timeJit * (1.4 - 0.8 * Math.min(1, rpmN));
      
      this.nzF.set(p.noiseHz * (0.7 + 0.6 * rpmN) * pitch, p.noiseQ);
      const fFire = ((rpmRef / 60) * pitch * Math.max(1, this.n)) / 2;
      const popP = over ? (p.pops * 8 * clamp((rpmRef - p.idle * 1.6) / (p.redline * 0.5), 0, 1) * Math.exp(-this.offT / 1.2)) / Math.max(20, fFire) : 0;
      const mufHz = p.muffler * (0.5 + 0.35 * onLoad + 0.25 * rpmN) * (over ? 0.8 : 1) * pitch;
      this.muf.set(mufHz, 0.7);
      this.muf2.set(mufHz * 2.5, 0.5);
      this.bodyF.set(Math.max(35, fFire * 1.15), 0.9);
      if (!cheap) {
        this.roarF.set(p.roarHz * (0.8 + 0.5 * rpmN) * pitch, 0.8);
        this.intF.set(p.intakeHz * (0.8 + 0.6 * rpmN) * pitch, 1.6);
        this.interLp.set(420 + 380 * onLoad, 0.7);
      }
      const roarLvl = cheap ? 0 : p.roar * (0.1 + 0.9 * onLoad * thr) * (0.3 + 0.9 * rpmN);
      const intakeLvl = cheap ? 0 : p.intake * (0.2 + 0.8 * thr) * (0.4 + 0.8 * rpmN);
      const tiltK = 1 - Math.exp((-TAU * p.tilt) / fs);
      const hpK = Math.exp((-TAU * 28) / fs);

      const turboLvl = p.turbo > 0 ? 0.006 * Math.pow(this.boost, 2) * (0.35 + 0.65 * thr) : 0;
      const tF = (3000 + 4500 * this.boost) * (0.8 + 0.2 * rpmN) * pitch;
      const whooshLvl = p.turbo > 0 ? 0.045 * this.boost * (0.3 + 0.7 * thr) : 0;
      if (whooshLvl > 0) this.whoosh.set((900 + 1600 * this.boost) * pitch, 0.9);
      let bovLvl = 0;
      if (this.bov > 0.001) {
        this.bovF += dt;
        this.bov *= Math.exp(-dt / (p.flutter ? 0.3 : 0.2));
        bovLvl = this.bov * 0.16 * Math.min(1, this.bovF / 0.012);
        this.bovSvf.set(p.flutter ? 900 - 300 * Math.min(1, this.bovF * 2) : 2400 * Math.exp(-this.bovF * 3) + 600, p.flutter ? 1.4 : 1.1);
      }
      const scLvl = p.sc * 0.012 * (0.3 + 0.7 * thr) * Math.min(1, rpmN + 0.15);
      const scF = (rpmRef / 60) * 6.2 * pitch;
      const gwLvl = p.whine * 0.006 * (0.35 + 0.65 * Math.abs(load)) * Math.min(1, this.speed / 8) * (this.gear > 0 ? 1 : 0);
      const gwF = (rpmRef / 60) * 11 * pitch;
      const gwF2 = this.speed * 17 * pitch;
      const hyLvl = p.hybrid * (0.3 + 0.7 * Math.abs(load)) * Math.min(1, this.speed / 5);
      const hyF = this.speed * 52 * pitch;

      const sp = this.speed;
      const sk = this.skid;
      const grip = surf <= 1 || surf === 6;
      const loose = surf === 3 || surf === 4 || surf === 5;
      const sqLvl = grip ? 0.8 * Math.pow(sk, 1.4) * Math.min(1, sp / 5) * (1 - 0.75 * wet) : 0;
      const sqBase = (430 + 260 * sk + Math.min(40, sp) * 2.5) * pitch;
      if (sqLvl > 0) this.sqF.set(sqBase * 1.2, 1.4);
      const rollLvl = Math.min(1, sp / 40) * (cheap ? 0.03 : 0.055) * (surf === 6 ? 1.6 : surf === 2 ? 0.8 : 1) * (1 + wet * 0.6);
      this.roll.set(160 + sp * 6 + wet * 900, 0.7);
      this.rollLo.set(60 + sp * 1.2, 0.8);
      const grainRate = loose ? (sp * 7 + sk * 380 + 1) / fs : surf === 2 ? (sp * 3 + sk * 100) / fs : 0;
      const grainLvl = (surf === 3 ? 0.45 : surf === 5 ? 0.24 : surf === 2 ? 0.14 : 0.33) * Math.min(1, sp / 6 + sk);
      const slideLvl = loose || surf === 2 ? (surf === 2 ? 0.04 : 0.07) * sk * Math.min(1, sp / 4) : 0;
      if (grainRate > 0) {
        this.grainSvf.set(surf === 5 ? 2400 : surf === 3 ? 1500 : surf === 2 ? 700 : 1000, 0.8);
        this.slide.set(surf === 5 ? 1800 : surf === 3 ? 1100 : surf === 2 ? 500 : 800, 0.7);
      }
      const bumpF = surf === 1 ? sp / 0.5 : surf === 6 ? sp / 0.16 : 0;
      const bumpLvl = surf === 1 ? 0.12 * Math.min(1, sp / 8) : surf === 6 ? 0.035 * Math.min(1, sp / 8) : 0;
      const windLvl = Math.min(0.3, 0.056 * Math.pow(sp / 30, 2)) * (cheap ? 0.5 : 1);
      if (windLvl > 0) this.wind.set(250 + sp * 14, 0.5);

      const ev = p.electric;
      const evF = (rpmRef / 60) * 4 * pitch;
      const evLvl = ev ? 0.022 * (0.25 + 0.75 * Math.abs(load)) * Math.min(1, rpmRef / 600) : 0;
      const invF = (1100 + 140 * Math.floor(Math.min(7, rpmRef / 1100))) * pitch;
      const invLvl = ev ? 0.004 * Math.abs(load) * Math.max(0, 1 - rpmRef / 6000) * Math.min(1, this.speed / 2) : 0;
      const hum = ev ? 0.03 * (0.3 + 0.7 * thr) * Math.min(1, rpmRef / 300 + 0.2) : 0;
      const humF = (55 + rpmN * 150) * pitch;
      if (ev) this.evNoise.set(evF * 2, 4);

      const stereo = p.stereo;
      const gain = p.gain;
      const tg = cheap ? 0.19 : 0.25;
      const nSlots = this.n;
      const hb = this.hbuf;
      const pbuf = this.pbuf;
      const hdr0 = p.hdr[0] | 0;
      const hdr1 = (p.hdr[1] ?? p.hdr[0]) | 0;
      const loopK = 1 - Math.exp((-TAU * p.loopHz) / fs);
      const pipeLen = p.pipe | 0;
      const rpmK = 1 - Math.exp(-1 / (fs * 0.012));
      for (let i = 0; i < N; i += step) {
        this.rpm += (this.rpmT - this.rpm) * rpmK;
        const rpm = this.rpm;
        let exA = 0;
        let exB = 0;
        let det = 0;
        let nzEnv = 0;
        if (!ev && nSlots > 0) {
          const inc = ((rpm / 60) * pitch) / (2 * fs);
          this.theta += inc;
          if (this.theta >= 1) this.theta -= 1;
          if (lim) this.gate = (this.gate + 17 / fs) % 1;
          this.cutS += ((lim && this.gate < 0.5) || this.cut > 0 ? 0.1 - this.cutS : 1 - this.cutS) * 0.004;
          const interval = 1 / (inc * nSlots);
          const dur = clamp(p.width * interval, p.minMs * fs * 0.001, p.maxMs * fs * 0.001);
          for (let k = 0; k < nSlots; k++) {
            let x = this.theta - p.slots[k];
            if (x < 0) x += 1;
            if (x < this.lastX[k]) {
              this.walk += (this.rnd() - 0.5) * 0.3 - this.walk * 0.15;
              let a = p.amp[k] * (1 + jit * ((this.rnd() - 0.5) * 1.2 + this.walk)) * level * this.cutS;
              if (over && this.rnd() < 0.18) a *= 0.2;
              if (a < 0) a = 0;
              const late = this.rnd() * tj * interval;
              this.spawn(x / inc - late, dur * (0.9 + 0.2 * this.rnd()), a, a * nzAmt * (0.6 + 0.8 * this.rnd()), p.bank[k]);
              if (popP > 0 && this.rnd() < popP) this.fire(0.2 + this.rnd() * (this.rnd() < 0.15 ? 1.2 : 0.5), 0.15 + this.rnd() * 0.5, 0.004 + this.rnd() * 0.012);
              if (lim && this.cutS < 0.5 && this.rnd() < p.pops * 0.2) this.fire(0.25 + this.rnd() * 0.4, 0.4, 0.006);
            }
            this.lastX[k] = x;
          }
          for (let q = 0; q < this.pc; ) {
            const t = this.pt[q];
            const d = this.pd[q];
            if (t >= d) {
              const last = --this.pc;
              this.pt[q] = this.pt[last];
              this.pd[q] = this.pd[last];
              this.pa[q] = this.pa[last];
              this.pn[q] = this.pn[last];
              this.pb[q] = this.pb[last];
              continue;
            }
            if (t > 0) {
              const f = (t / d) * LUT;
              const fi = f | 0;
              const s = shape[fi] + (shape[fi + 1] - shape[fi]) * (f - fi);
              const v = s * this.pa[q];
              if (this.pb[q]) exB += v;
              else exA += v;
              nzEnv += s * this.pn[q];
            }
            this.pt[q] = t + 1;
            q++;
          }
          det = exA + exB;
        }
        const noise = this.rnd() * 2 - 1;
        const nz = this.nzF.run(noise * nzEnv);
        const nzBp = this.nzF.bp * 0.7 + nz * 0.3;
        let popS = 0;
        if (this.pop > 1e-4) {
          this.popLp += (noise - this.popLp) * this.popTone;
          popS = (this.popLp * 1.2 + 0.6) * this.pop;
          this.pop *= this.popDecay;
        }
        const w = this.w;
        const hA = exA + nzBp * 0.5;
        const hB = exB + nzBp * 0.5;
        this.hlp[0] += (hb[(w - hdr0) & 1023] - this.hlp[0]) * loopK;
        this.hlp[1] += (hb[1024 + ((w - hdr1) & 1023)] - this.hlp[1]) * loopK;
        const yA = hA + p.hdrR * this.hlp[0];
        const yB = hB + p.hdrR * this.hlp[1];
        hb[w & 1023] = yA;
        hb[1024 + (w & 1023)] = yB;
        let ex = yA + p.bankB * yB + popS;
        this.plp += (pbuf[(w - pipeLen) & 4095] - this.plp) * loopK;
        ex += p.pipeR * this.plp;
        pbuf[w & 4095] = ex;
        this.w = (w + 1) & 0xffff;

        const bodyV = this.bodyF.run(det);
        let y = this.muf2.run(this.muf.run(ex) + bodyV * p.body);
        y += nzBp * p.rasp;
        y = sat(y * p.drive + p.asym * y * y * p.drive) / p.drive;
        let mono = y;
        if (!cheap) {
          const ink = this.intF.run(noise * (det * 0.6 + 0.05)) * intakeLvl + this.roarF.bp * roarLvl;
          this.roarF.run(noise * (0.4 + Math.abs(det)));
          mono += ink;
          const inter = this.interLp.run(mono) * 1.1;
          mono += (inter - mono) * this.inter;
        }
        if (turboLvl > 0) {
          this.tPh += tF / fs;
          if (this.tPh >= 1) this.tPh -= 1;
          let t = Math.sin(TAU * this.tPh);
          if (p.turbo > 1) {
            this.tPh2 += (tF * 1.04) / fs;
            if (this.tPh2 >= 1) this.tPh2 -= 1;
            t = 0.6 * (t + Math.sin(TAU * this.tPh2));
          }
          mono += turboLvl * t;
        }
        if (whooshLvl > 0) {
          this.whoosh.run(noise);
          mono += whooshLvl * this.whoosh.bp * 1.6;
        }
        if (bovLvl > 0) {
          this.bovSvf.run(noise);
          let gtr = 1;
          if (p.flutter) {
            this.bovPh += (20 - 10 * Math.min(1, this.bovF * 2)) / fs;
            const ph = this.bovPh % 1;
            gtr = ph < 0.4 ? Math.sin((Math.PI * ph) / 0.4) : 0.08;
          }
          mono += bovLvl * this.bovSvf.bp * 2.4 * gtr;
        }
        if (scLvl > 0) {
          this.scPh += scF / fs;
          if (this.scPh >= 1) this.scPh -= 1;
          mono += scLvl * (Math.sin(TAU * this.scPh) + 0.2 * Math.sin(2 * TAU * this.scPh));
        }
        if (gwLvl > 0 && !cheap) {
          this.gwPh += gwF / fs;
          this.gwPh2 += gwF2 / fs;
          if (this.gwPh >= 1) this.gwPh -= 1;
          if (this.gwPh2 >= 1) this.gwPh2 -= 1;
          mono += gwLvl * (Math.sin(TAU * this.gwPh) + 0.6 * Math.sin(TAU * this.gwPh2));
        }
        if (hyLvl > 0 && !cheap) {
          const ph = this.evPh;
          ph[4] += hyF / fs;
          if (ph[4] >= 1) ph[4] -= 1;
          mono += hyLvl * Math.sin(TAU * ph[4]);
        }
        if (ev) {
          const ph = this.evPh;
          ph[0] += evF / fs;
          ph[1] += invF / fs;
          ph[2] += humF / fs;
          ph[3] += (humF * 1.5) / fs;
          for (let q = 0; q < 4; q++) if (ph[q] >= 1) ph[q] -= 1;
          const a = TAU * ph[0];
          this.evNoise.run(noise);
          mono += evLvl * (Math.sin(a) + 0.3 * Math.sin(2 * a) + 0.12 * Math.sin(3 * a) + 0.6 * this.evNoise.bp);
          mono += invLvl * Math.sin(TAU * ph[1]);
          ph[4] += (evF * 1.335) / fs;
          if (ph[4] >= 1) ph[4] -= 1;
          mono += evLvl * 0.35 * Math.sin(TAU * ph[4]);
          mono += hum * (Math.sin(TAU * ph[2]) + 0.35 * Math.sin(TAU * ph[3]));
        }
        mono *= gain;
        let tire = 0;
        if (sqLvl > 0.0005) {
          // Stick-slip howl: a wandering tone with partials and chatter.
          this.sqWalk += (this.rnd() - 0.5) * 0.004 - this.sqWalk * 0.0004;
          this.sqAm += (this.rnd() - this.sqAm) * 0.02;
          this.sqPh += (sqBase * (1 + this.sqWalk)) / fs;
          if (this.sqPh >= 1) this.sqPh -= 1;
          const a = TAU * this.sqPh;
          this.sqF.run(noise);
          const tone = Math.sin(a) + 0.5 * Math.sin(2 * a + 0.5) + 0.22 * Math.sin(3 * a + 1.1) + 0.08 * Math.sin(4 * a);
          tire += sqLvl * this.sqLp.run(tone * (0.45 + 0.55 * this.sqAm) + this.sqF.bp * 2.2);
        }
        const r = this.roll.run(noise);
        const rl = this.rollLo.run(noise);
        tire += rollLvl * (r * 2 + rl * 3);
        if (grainRate > 0) {
          if (this.rnd() < grainRate) this.grainT = (0.4 + this.rnd()) * (this.rnd() < 0.5 ? -1 : 1);
          this.grainT *= surf === 2 ? 0.995 : 0.988;
          this.grain += (this.grainT - this.grain) * (surf === 2 ? 0.06 : 0.2);
          const gl = this.grainSvf.run(this.grain * noise + this.grain * 0.4);
          tire += grainLvl * (gl * 2 + this.grainSvf.bp * 0.6);
          if (slideLvl > 0) tire += slideLvl * this.slide.run(noise) * 3;
        }
        if (bumpLvl > 0) {
          this.bumpPh += bumpF / fs;
          if (this.bumpPh >= 1) this.bumpPh -= 1;
          const b = this.bumpPh < 0.3 ? Math.sin((Math.PI * this.bumpPh) / 0.3) : 0;
          tire += bumpLvl * (b - 0.19 + r * 0.5);
        }
        if (windLvl > 0) {
          this.gust += ((this.rnd() - 0.5) * 0.4 - this.gust) * 0.0005;
          tire += windLvl * this.wind.run(noise) * 1.6 * (1 + this.gust);
        }
        mono += tire * tg;
        let l = mono;
        let rr = mono;
        if (stereo > 0) {
          const d = (exA - exB) * stereo * 0.15 * (1 - this.inter) * gain;
          l += d;
          rr -= d;
        }
        this.tiltLp += (l - this.tiltLp) * tiltK;
        this.tiltR += (rr - this.tiltR) * tiltK;
        l = this.tiltLp;
        rr = this.tiltR;
        // Two one pole high passes at 28 Hz drop the half-order rumble that only eats headroom.
        const h = this.hp;
        h[1] = hpK * (h[1] + l - h[0]);
        h[0] = l;
        h[3] = hpK * (h[3] + h[1] - h[2]);
        h[2] = h[1];
        h[6] = hpK * (h[6] + rr - h[5]);
        h[5] = rr;
        h[7] = hpK * (h[7] + h[6] - this.prevR);
        this.prevR = h[6];
        const ol = h[3];
        if (step === 2) {
          L[i] = (ol + this.prevL) * 0.5;
          L[i + 1] = ol;
          this.prevL = ol;
        } else {
          L[i] = ol;
          if (R !== L) R[i] = h[7];
        }
      }
      return true;
    }
  }
  register("car-engine", EngineProc);
};
