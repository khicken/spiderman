// Centerline processing: even resampling, curvature-aware smoothing, elevation and deck ranges.

export function resample(xs, zs, closed, step) {
  const n = xs.length, m = closed ? n + 1 : n, s = [0];
  for (let i = 1; i < m; i++) s.push(s[i - 1] + Math.hypot(xs[i % n] - xs[i - 1], zs[i % n] - zs[i - 1]));
  const L = s[m - 1], N = Math.max(2, Math.round(L / step)), d = closed ? L / N : L / (N - 1);
  const ox = [], oz = [], src = [];
  for (let k = 0, j = 0; k < N; k++) {
    const t = k * d;
    while (j < m - 2 && s[j + 1] < t) j++;
    const u = Math.min(1, (t - s[j]) / (s[j + 1] - s[j] || 1));
    ox.push(xs[j] + (xs[(j + 1) % n] - xs[j]) * u);
    oz.push(zs[j] + (zs[(j + 1) % n] - zs[j]) * u);
    src.push(u < 0.5 ? j : (j + 1) % n);
  }
  return { xs: ox, zs: oz, src, length: L };
}

// Gaussian smoothing; sigma is in samples, a number or a per-sample array. Open lines use a truncated window.
export function gauss(a, sigma, closed) {
  const n = a.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const sg = typeof sigma === "number" ? sigma : sigma[i];
    if (sg < 0.3) { out[i] = a[i]; continue; }
    const r = Math.ceil(sg * 3);
    let sw = 0, sv = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      const w = Math.exp((-k * k) / (2 * sg * sg));
      sw += w; sv += w * a[j];
    }
    out[i] = sv / sw;
  }
  return out;
}

export function median(a, half, closed) {
  const n = a.length;
  return a.map((_, i) => {
    const w = [];
    for (let k = -half; k <= half; k++) { let j = i + k; if (closed) j = ((j % n) + n) % n; else j = Math.min(n - 1, Math.max(0, j)); w.push(a[j]); }
    return w.sort((p, q) => p - q)[half];
  });
}

// Signed curvature per sample from neighbors `h` samples away.
export function curvature(xs, zs, closed, h = 1) {
  const n = xs.length;
  return xs.map((_, i) => {
    const a = closed ? (i - h + n) % n : Math.max(0, i - h), b = closed ? (i + h) % n : Math.min(n - 1, i + h);
    if (a === i || b === i) return 0;
    const ax = xs[i] - xs[a], az = zs[i] - zs[a], bx = xs[b] - xs[i], bz = zs[b] - zs[i];
    const cr = ax * bz - az * bx, la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]);
    return (2 * cr) / (la * lb * lc || 1);
  });
}

// Removes OSM vertex kinks without opening hairpins: sigma follows the local corner radius.
export function smoothLine(xs, zs, closed, step, fine, minR = 0) {
  let r = resample(xs, zs, closed, 2.5);
  const tags = r.src;
  let x = gauss(r.xs, 1.2, closed), z = gauss(r.zs, 1.2, closed);
  const k = curvature(gauss(x, 4, closed), gauss(z, 4, closed), closed, 4).map(Math.abs);
  const sig = gauss(k.map((v) => Math.min(fine[1], Math.max(fine[0], 0.3 / Math.max(v, 1e-4))) / 2.5), 6, closed);
  for (let it = 0; it < 2; it++) { x = gauss(x, sig, closed); z = gauss(z, sig, closed); }
  if (minR) ({ xs: x, zs: z } = openHairpins(x, z, closed, 2.5, minR));
  const f = resample(x, z, closed, step);
  return { xs: f.xs, zs: f.zs, length: f.length, src: f.src.map((j) => tags[j]) };
}

export function ranges(flags) {
  const out = [], n = flags.length;
  for (let i = 0; i < n; i++) if (flags[i] && (i === 0 || !flags[i - 1])) { let j = i; while (j + 1 < n && flags[j + 1]) j++; out.push([i, j]); }
  return out;
}

// Steepest allowed step maxDy: mean of the upper and lower envelopes, both of which keep the limit.
export function limitGrade(y, maxDy, closed) {
  const n = y.length, laps = closed ? 2 : 1;
  const env = (pick, sign) => {
    const e = y.slice();
    for (let lap = 0; lap < laps; lap++) {
      for (let i = 1; i < n + (closed ? 1 : 0); i++) { const k = i % n; e[k] = pick(e[k], e[i - 1] + sign * maxDy); }
      for (let i = n - 2 + (closed ? 1 : 0); i >= 0; i--) { const k = (i + 1) % n; e[i] = pick(e[i], e[k] + sign * maxDy); }
    }
    return e;
  };
  const up = env(Math.min, 1), lo = env(Math.max, -1);
  return y.map((_, i) => (up[i] + lo[i]) / 2);
}

// Pushes apart points closer than a circle of radius minR allows, which opens V-shaped hairpins into round ones.
export function openHairpins(xs, zs, closed, step, minR, iters = 300) {
  const n = xs.length, w = Math.ceil((Math.PI * minR * 1.5) / step), x = xs.slice(), z = zs.slice();
  const target = (k) => 2 * minR * Math.sin(Math.min((k * step) / (2 * minR), Math.PI / 2));
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) for (let k = 2; k <= w; k++) {
      let j = i + k;
      if (closed) j %= n; else if (j >= n) break;
      const dx = x[j] - x[i], dz = z[j] - z[i], d = Math.hypot(dx, dz) || 1e-6, t = target(k);
      if (d >= t) continue;
      const f = (0.5 * (t - d)) / d;
      x[i] -= dx * f * 0.5; z[i] -= dz * f * 0.5; x[j] += dx * f * 0.5; z[j] += dz * f * 0.5;
      moved = Math.max(moved, t - d);
    }
    const sx = gauss(x, 1, closed), sz = gauss(z, 1, closed);
    for (let i = 0; i < n; i++) { x[i] = x[i] * 0.5 + sx[i] * 0.5; z[i] = z[i] * 0.5 + sz[i] * 0.5; }
    if (moved < 0.05) break;
  }
  return { xs: x, zs: z };
}
