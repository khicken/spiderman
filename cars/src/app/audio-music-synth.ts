// Runs inside the audio worklet through toString(): no imports, no module scope.
export type Patch = {
  a: number; // attack s
  d: number; // decay s
  s: number; // sustain 0..1
  r: number; // release s
  cut: number; // filter cutoff Hz
  env: number; // filter env amount, octaves
  fd: number; // filter env decay s
  q: number;
  det: number; // detune cents spread
  gain: number;
  rev: number; // reverb send
  dly: number; // delay send
  wide: number; // stereo spread
  drive: number;
  glide: number; // s
};

export const INST = { pad: 0, pluck: 1, ep: 2, bell: 3, fmbass: 4, reese: 5, acid: 6, lead: 7, brass: 8, stab: 9, clav: 10, sub: 11, kick: 20, snare: 21, clap: 22, hat: 23, ohat: 24, ride: 25, crash: 26, tom: 27, rim: 28, shaker: 29, riser: 30, impact: 31, snap: 32 } as const;

export const musicSynth = (sr: number) => {
  const TAU = Math.PI * 2;
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  const sat = (x: number) => (x < -3 ? -1 : x > 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));
  const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  const blep = (p: number, dt: number) => {
    if (p < dt) {
      const t = p / dt;
      return t + t - t * t - 1;
    }
    if (p > 1 - dt) {
      const t = (p - 1) / dt;
      return t * t + t + t + 1;
    }
    return 0;
  };
  let seed = 987654321;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const noise = () => rnd() * 2 - 1;

  class Svf {
    a1 = 0;
    a2 = 0;
    a3 = 0;
    k = 1;
    s1 = 0;
    s2 = 0;
    bp = 0;
    constructor() {
      this.s1 = 0;
    }
    set(f: number, q: number) {
      const g = Math.tan((Math.PI * clamp(f, 20, sr * 0.45)) / sr);
      this.k = 1 / q;
      this.a1 = 1 / (1 + g * (g + this.k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
    lp(x: number) {
      const v3 = x - this.s2;
      const v1 = this.a1 * this.s1 + this.a2 * v3;
      const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
      this.s1 = 2 * v1 - this.s1;
      this.s2 = 2 * v2 - this.s2;
      this.bp = v1;
      return v2;
    }
    reset() {
      this.s1 = 0;
      this.s2 = 0;
    }
  }

  const SPREAD = [0, -1, 1, -0.62, 0.62, -0.3, 0.3];
  const TRIM = new Float32Array(40).fill(1);
  TRIM[20] = 0.42;
  TRIM[27] = 0.6;
  TRIM[4] = TRIM[5] = TRIM[11] = 0.45;
  TRIM[23] = TRIM[24] = TRIM[29] = 2;
  TRIM[25] = TRIM[26] = 1.6;
  TRIM[21] = TRIM[22] = 1.2;
  TRIM[0] = 1.5;
  TRIM[1] = TRIM[2] = TRIM[3] = TRIM[7] = TRIM[8] = TRIM[9] = TRIM[10] = 1.4;
  const MAXV = 56;

  class Voice {
    on = false;
    inst = 0;
    f = 440;
    ft = 440;
    vel = 1;
    t = 0;
    wait = 0;
    len = 0;
    rel = false;
    env = 0;
    renv = 1;
    pan = 0;
    p: Patch | null = null;
    ph = new Float64Array(8);
    fl = new Svf();
    fr = new Svf();
    x1 = 0;
    x2 = 0;
    id = 0;
    constructor() {
      this.ph = new Float64Array(8);
      this.fl = new Svf();
      this.fr = new Svf();
    }
  }

  class Synth {
    voices: Voice[] = [];
    mL = new Float32Array(128);
    mR = new Float32Array(128);
    dL = new Float32Array(128);
    dR = new Float32Array(128);
    rL = new Float32Array(128);
    rR = new Float32Array(128);
    yL = new Float32Array(128);
    yR = new Float32Array(128);
    dlyL = new Float32Array(sr * 2);
    dlyR = new Float32Array(sr * 2);
    dlyW = 0;
    dlyT = sr * 0.3;
    dlyFb = 0.35;
    dlyLp = [0, 0];
    duck = 0;
    duckUp = false;
    duckDepth = 0;
    duckRel = 0.2;
    busL = new Svf();
    busR = new Svf();
    busCut = 18000;
    level = 1;
    counter = 0;
    constructor() {
      for (let i = 0; i < MAXV; i++) this.voices.push(new Voice());
      this.busL = new Svf();
      this.busR = new Svf();
      this.busL.set(18000, 0.7);
      this.busR.set(18000, 0.7);
      this.dlyLp = [0, 0];
    }
    note(inst: number, midi: number, vel: number, lenS: number, p: Patch, pan: number, wait: number) {
      let v: Voice | null = null;
      if (p.glide > 0) for (const u of this.voices) if (u.on && !u.rel && u.inst === inst && u.p === p) v = u;
      if (v) {
        v.ft = mtof(midi);
        v.len = v.t + Math.max(1, lenS) + wait;
        v.vel = vel;
        return;
      }
      let oldest = this.voices[0];
      for (const u of this.voices) {
        if (!u.on) {
          v = u;
          break;
        }
        if (u.id < oldest.id) oldest = u;
      }
      if (!v) v = oldest;
      v.on = true;
      v.inst = inst;
      v.f = v.ft = mtof(midi);
      v.vel = vel;
      v.t = 0;
      v.wait = Math.max(0, Math.round(wait));
      v.len = Math.max(1, lenS);
      v.rel = false;
      v.env = 0;
      v.renv = 1;
      v.pan = clamp(pan, -1, 1);
      v.p = p;
      v.x1 = 0;
      v.x2 = 0;
      v.id = ++this.counter;
      for (let i = 0; i < 8; i++) v.ph[i] = rnd();
      v.fl.reset();
      v.fr.reset();
    }
    releaseAll(fast: boolean) {
      for (const v of this.voices) if (v.on) {
        if (fast) v.p = Object.assign({}, v.p, { r: 0.05 });
        v.rel = true;
      }
    }
    voiceBlock(v: Voice, n: number) {
      const p = v.p!;
      const drum = v.inst >= 20;
      const oL = drum ? this.dL : this.mL;
      const oR = drum ? this.dR : this.mR;
      const gl = Math.sqrt(0.5 * (1 - v.pan)) * v.vel * p.gain * TRIM[v.inst];
      const gr = Math.sqrt(0.5 * (1 + v.pan)) * v.vel * p.gain * TRIM[v.inst];
      const rs = p.rev;
      const ds = p.dly;
      let i = 0;
      if (v.wait > 0) {
        i = Math.min(n, v.wait);
        v.wait -= i;
        if (i >= n) return;
      }
      const tS = v.t / sr;
      if (v.inst < 20) {
        if (p.glide > 0) v.f += (v.ft - v.f) * Math.min(1, n / (sr * p.glide));
        const fenv = Math.exp(-tS / Math.max(0.001, p.fd));
        const cut = p.cut * Math.pow(2, p.env * fenv * (0.6 + 0.4 * v.vel));
        v.fl.set(cut, p.q);
        if (v.inst === 0) v.fr.set(cut, p.q);
      } else if (v.inst === 21 || v.inst === 22) v.fl.set(v.inst === 21 ? 1900 : 1250, v.inst === 21 ? 0.7 : 1.6);
      else if (v.inst === 23 || v.inst === 24 || v.inst === 29) v.fl.set(v.inst === 29 ? 6500 : 9000, 0.8);
      else if (v.inst === 25) v.fl.set(5200, 1.5);
      else if (v.inst === 26) v.fl.set(6000, 0.5);
      else if (v.inst === 28) v.fl.set(3200, 3);
      else if (v.inst === 30) v.fl.set(300 * Math.pow(30, Math.min(1, v.t / v.len)), 2.5);
      else if (v.inst === 31) v.fl.set(900 * Math.exp(-tS * 3) + 80, 0.7);
      const aS = Math.max(1, p.a * sr);
      const dK = Math.exp(-1 / (sr * Math.max(0.001, p.d)));
      const rK = Math.exp(-1 / (sr * Math.max(0.002, p.r)));
      const f = v.f;
      const dt = f / sr;
      for (; i < n; i++) {
        const t = v.t++;
        if (!v.rel && t >= v.len) v.rel = true;
        let e: number;
        if (drum) {
          e = 1;
          if (t >= v.len * 4 + sr * 3) {
            v.on = false;
            return;
          }
        } else {
          if (t < aS) v.env = t / aS;
          else if (!v.rel) v.env = p.s + (v.env - p.s) * dK;
          if (v.rel) {
            v.renv *= rK;
            if (v.renv < 0.0005) {
              v.on = false;
              return;
            }
          }
          e = v.env * v.renv;
        }
        let l = 0;
        let r = 0;
        const ph = v.ph;
        switch (v.inst) {
          case 0: {
            for (let k = 0; k < 7; k++) {
              const d = dt * (1 + SPREAD[k] * p.det * 0.00058);
              ph[k] += d;
              if (ph[k] >= 1) ph[k] -= 1;
              const s = 2 * ph[k] - 1 - blep(ph[k], d);
              if (k & 1) r += s;
              else l += s;
              if (k === 0) r += s;
            }
            l = v.fl.lp(l * 0.3) * e;
            r = v.fr.lp(r * 0.3) * e;
            break;
          }
          case 1:
          case 9:
          case 8: {
            const nv = v.inst === 8 ? 4 : v.inst === 9 ? 3 : 2;
            let s = 0;
            for (let k = 0; k < nv; k++) {
              const d = dt * (1 + SPREAD[k + 1] * p.det * 0.00058);
              ph[k] += d;
              if (ph[k] >= 1) ph[k] -= 1;
              s += 2 * ph[k] - 1 - blep(ph[k], d);
            }
            if (v.inst === 1) {
              ph[5] += dt * 0.5;
              if (ph[5] >= 1) ph[5] -= 1;
              s += ph[5] < 0.5 ? 0.6 : -0.6;
            }
            s = v.fl.lp(s * (0.9 / nv)) * e;
            if (p.drive > 0) s = sat(s * (1 + p.drive)) / (1 + p.drive * 0.5);
            l = r = s;
            break;
          }
          case 2: {
            ph[0] += dt;
            ph[1] += dt;
            ph[2] += dt * 14;
            ph[3] += dt;
            for (let k = 0; k < 4; k++) if (ph[k] >= 1) ph[k] -= 1;
            const tine = Math.exp(-t / (sr * 0.25));
            const m1 = Math.sin(TAU * ph[1]) * (0.4 + 1.6 * Math.exp(-t / (sr * 0.5)));
            const m2 = Math.sin(TAU * ph[2]) * 1.4 * tine;
            const s = Math.sin(TAU * ph[0] + m1) * 0.75 + Math.sin(TAU * ph[3] + m2) * 0.25 * (0.3 + tine);
            l = r = s * e;
            break;
          }
          case 3: {
            ph[0] += dt;
            ph[1] += dt * 3.5;
            ph[2] += dt * 2;
            for (let k = 0; k < 3; k++) if (ph[k] >= 1) ph[k] -= 1;
            const idx = 2.2 * Math.exp(-t / (sr * 0.6));
            const s = Math.sin(TAU * ph[0] + idx * Math.sin(TAU * ph[1])) + 0.25 * Math.sin(TAU * ph[2]);
            l = r = s * e * 0.7;
            break;
          }
          case 4: {
            ph[0] += dt;
            ph[1] += dt;
            ph[2] += dt * 0.5;
            for (let k = 0; k < 3; k++) if (ph[k] >= 1) ph[k] -= 1;
            const idx = (0.6 + 2.6 * Math.exp(-t / (sr * p.fd))) * (0.5 + 0.5 * v.vel);
            let s = Math.sin(TAU * ph[0] + idx * Math.sin(TAU * ph[1])) * 0.7 + Math.sin(TAU * ph[2]) * 0.15;
            s = v.fl.lp(sat(s * (1 + p.drive))) * e;
            l = r = s;
            break;
          }
          case 5: {
            let s = 0;
            for (let k = 0; k < 2; k++) {
              const d = dt * (k ? 1.0071 : 0.9932);
              ph[k] += d;
              if (ph[k] >= 1) ph[k] -= 1;
              s += 2 * ph[k] - 1 - blep(ph[k], d);
            }
            ph[2] += dt;
            if (ph[2] >= 1) ph[2] -= 1;
            s = v.fl.lp(sat(s * 0.8 * (1 + p.drive))) + Math.sin(TAU * ph[2]) * 0.6;
            l = r = s * e;
            break;
          }
          case 6: {
            ph[0] += dt;
            if (ph[0] >= 1) ph[0] -= 1;
            const s = v.fl.lp(2 * ph[0] - 1 - blep(ph[0], dt));
            l = r = sat(s * (1 + p.drive)) * e * 0.8;
            break;
          }
          case 7: {
            const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * (t / sr)) * Math.min(1, t / (sr * 0.3));
            const d0 = dt * vib;
            const d1 = d0 * 1.006;
            ph[0] += d0;
            ph[1] += d1;
            if (ph[0] >= 1) ph[0] -= 1;
            if (ph[1] >= 1) ph[1] -= 1;
            let s = 2 * ph[0] - 1 - blep(ph[0], d0);
            let q = ph[1] < 0.5 ? 1 : -1;
            q += blep(ph[1], d1) - blep((ph[1] + 0.5) % 1, d1);
            s = v.fl.lp((s + 0.6 * q) * 0.5) * e;
            l = r = s;
            break;
          }
          case 10: {
            ph[0] += dt;
            if (ph[0] >= 1) ph[0] -= 1;
            let s = ph[0] < 0.22 ? 1 : -0.28;
            s += blep(ph[0], dt) * 0.64 - blep((ph[0] + 0.78) % 1, dt) * 0.64;
            s = v.fl.lp(s);
            l = r = (v.fl.bp * 0.8 + s * 0.4) * e;
            break;
          }
          case 11: {
            ph[0] += dt;
            if (ph[0] >= 1) ph[0] -= 1;
            l = r = Math.sin(TAU * ph[0]) * e;
            break;
          }
          case 20: {
            const ts = t / sr;
            const fq = p.cut + (f * 4 - p.cut) * Math.exp(-ts / p.fd);
            ph[0] += fq / sr;
            if (ph[0] >= 1) ph[0] -= 1;
            const a = Math.exp(-ts / p.d) * Math.min(1, t / 24);
            const click = ts < 0.004 ? noise() * (1 - ts / 0.004) * 0.35 : 0;
            l = r = sat((Math.sin(TAU * ph[0]) * a + click) * (1 + p.drive)) * 0.9;
            if (ts > p.d * 7) v.on = false;
            break;
          }
          case 21: {
            const ts = t / sr;
            ph[0] += (185 + 60 * Math.exp(-ts / 0.02)) / sr;
            if (ph[0] >= 1) ph[0] -= 1;
            const tone = Math.sin(TAU * ph[0]) * Math.exp(-ts / 0.045) * 0.6;
            const nz = noise();
            v.fl.lp(nz);
            const s = (tone + v.fl.bp * 1.2 * Math.exp(-ts / p.d) + nz * 0.35 * Math.exp(-ts / (p.d * 0.6))) * Math.min(1, t / 12);
            l = r = sat(s * (1 + p.drive)) * 0.8;
            if (ts > p.d * 7) v.on = false;
            break;
          }
          case 22: {
            const ts = t / sr;
            const burst = ts < 0.03 ? Math.exp(-((ts % 0.0105) / 0.003)) : Math.exp(-(ts - 0.03) / p.d);
            v.fl.lp(noise());
            l = r = v.fl.bp * 2.2 * burst * Math.min(1, t / 8);
            if (ts > 0.03 + p.d * 7) v.on = false;
            break;
          }
          case 23:
          case 24:
          case 29: {
            const ts = t / sr;
            const nz = noise();
            const hp = nz - v.x1;
            v.x1 += (nz - v.x1) * 0.35;
            v.fl.lp(hp);
            const a = v.inst === 29 ? Math.min(1, ts / 0.012) * Math.exp(-ts / p.d) : Math.exp(-ts / p.d) * Math.min(1, t / 6);
            l = r = (hp * 0.5 + v.fl.bp * 0.9) * a;
            if (ts > p.d * 7) v.on = false;
            break;
          }
          case 25: {
            const ts = t / sr;
            ph[0] += 3150 / sr;
            ph[1] += 4730 / sr;
            ph[2] += 6020 / sr;
            for (let k = 0; k < 3; k++) if (ph[k] >= 1) ph[k] -= 1;
            const ping = (Math.sin(TAU * ph[0]) + 0.7 * Math.sin(TAU * ph[1]) + 0.5 * Math.sin(TAU * ph[2])) * 0.12 * Math.exp(-ts / 0.25);
            v.fl.lp(noise());
            l = r = (v.fl.bp * 0.7 * Math.exp(-ts / p.d) + ping) * Math.min(1, t / 6);
            if (ts > p.d * 7) v.on = false;
            break;
          }
          case 26: {
            const ts = t / sr;
            const nz = noise();
            const hp = nz - v.x1;
            v.x1 += (nz - v.x1) * 0.2;
            v.fl.lp(hp);
            l = (hp * 0.6 + v.fl.bp * 0.6) * Math.exp(-ts / p.d) * Math.min(1, t / 20);
            r = l * (0.85 + 0.3 * rnd());
            if (ts > p.d * 7) v.on = false;
            break;
          }
          case 27: {
            const ts = t / sr;
            ph[0] += (f * (1 + 0.6 * Math.exp(-ts / 0.03))) / sr;
            if (ph[0] >= 1) ph[0] -= 1;
            const nz = ts < 0.02 ? noise() * 0.3 * (1 - ts / 0.02) : 0;
            l = r = sat((Math.sin(TAU * ph[0]) * Math.exp(-ts / p.d) + nz) * (1 + p.drive)) * Math.min(1, t / 16);
            if (ts > p.d * 7) v.on = false;
            break;
          }
          case 28:
          case 32: {
            const ts = t / sr;
            v.fl.lp(noise());
            ph[0] += 1750 / sr;
            if (ph[0] >= 1) ph[0] -= 1;
            l = r = (v.fl.bp * 1.5 + (v.inst === 28 ? Math.sin(TAU * ph[0]) * 0.3 : 0)) * Math.exp(-ts / p.d) * Math.min(1, t / 6);
            if (ts > p.d * 8) v.on = false;
            break;
          }
          case 30: {
            const x = Math.min(1, t / v.len);
            v.fl.lp(noise());
            const g = x < 1 ? x * x : Math.exp(-(t - v.len) / (sr * 0.05));
            l = v.fl.bp * g * 1.2;
            r = l;
            if (t > v.len + sr * 0.4) v.on = false;
            break;
          }
          case 31: {
            const ts = t / sr;
            ph[0] += (34 + 40 * Math.exp(-ts / 0.15)) / sr;
            if (ph[0] >= 1) ph[0] -= 1;
            const s = Math.sin(TAU * ph[0]) * Math.exp(-ts / 1.1) + v.fl.lp(noise()) * Math.exp(-ts / 0.4) * 0.8;
            l = r = sat(s * 1.5) * Math.min(1, t / 30);
            if (ts > 6) v.on = false;
            break;
          }
        }
        l *= gl;
        r *= gr;
        if (p.wide > 0 && v.inst !== 0) {
          const w = p.wide * 0.5 * (l - r);
          l += w;
          r -= w;
        }
        oL[i] += l;
        oR[i] += r;
        this.rL[i] += l * rs;
        this.rR[i] += r * rs;
        this.yL[i] += (l + r) * 0.5 * ds;
      }
    }
    render(outL: Float32Array, outR: Float32Array, revL: Float32Array, revR: Float32Array, off: number, n: number) {
      this.mL.fill(0, 0, n);
      this.mR.fill(0, 0, n);
      this.dL.fill(0, 0, n);
      this.dR.fill(0, 0, n);
      this.rL.fill(0, 0, n);
      this.rR.fill(0, 0, n);
      this.yL.fill(0, 0, n);
      for (const v of this.voices) if (v.on) this.voiceBlock(v, n);
      this.busL.set(this.busCut, 0.9);
      this.busR.set(this.busCut, 0.9);
      const dk = Math.exp(-1 / (sr * this.duckRel));
      const dlyLen = this.dlyL.length;
      const T = Math.min(dlyLen - 1, Math.round(this.dlyT));
      const lev = this.level;
      for (let i = 0; i < n; i++) {
        if (this.duckUp) {
          this.duck += (1 - this.duck) * 0.03;
          if (this.duck > 0.97) this.duckUp = false;
        } else this.duck *= dk;
        const g = 1 - this.duckDepth * this.duck;
        let ml = this.mL[i] * g;
        let mr = this.mR[i] * g;
        ml = this.busL.lp(ml);
        mr = this.busR.lp(mr);
        const w = this.dlyW;
        const rd = (w - T + dlyLen) % dlyLen;
        const dl = this.dlyL[rd];
        const dr = this.dlyR[rd];
        this.dlyLp[0] += (dr * this.dlyFb - this.dlyLp[0]) * 0.45;
        this.dlyLp[1] += (dl * this.dlyFb - this.dlyLp[1]) * 0.45;
        this.dlyL[w] = this.yL[i] * g + this.dlyLp[0];
        this.dlyR[w] = this.dlyLp[1];
        this.dlyW = (w + 1) % dlyLen;
        const L = ml + this.dL[i] + dl * 0.8;
        const R = mr + this.dR[i] + dr * 0.8;
        outL[off + i] = sat(L * 0.45 * lev);
        outR[off + i] = sat(R * 0.45 * lev);
        revL[off + i] = (this.rL[i] * g + dl * 0.25) * lev * 0.6;
        revR[off + i] = (this.rR[i] * g + dr * 0.25) * lev * 0.6;
      }
    }
    kick() {
      this.duckUp = true;
    }
  }
  return { Synth, mtof, rnd };
};
