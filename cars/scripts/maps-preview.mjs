// Top-down SVG of a built map for a visual check: terrain shade, water, green, buildings, roads, track.
import { writeFileSync } from "node:fs";

export function writePreview(m, file) {
  const t = m.terrain, W = 1400, sc = W / ((t.nx - 1) * t.step), H = Math.round((t.nz - 1) * t.step * sc);
  const X = (x) => ((x - t.x0) * sc).toFixed(1), Z = (z) => ((z - t.z0) * sc).toFixed(1);
  let lo = Infinity, hi = -Infinity;
  for (const v of t.h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font:12px sans-serif">`;
  const cs = Math.max(2, Math.ceil(t.nx / 220));
  for (let j = 0; j < t.nz; j += cs) for (let i = 0; i < t.nx; i += cs) {
    const v = Math.round(60 + ((t.h[j * t.nx + i] - lo) / (hi - lo || 1)) * 180);
    s += `<rect x="${X(t.x0 + i * t.step)}" y="${Z(t.z0 + j * t.step)}" width="${(cs * t.step * sc + 1).toFixed(1)}" height="${(cs * t.step * sc + 1).toFixed(1)}" fill="rgb(${v},${v},${v})"/>`;
  }
  const polys = (a, head, fill) => { for (let i = 0; i < a.length; ) { const n = a[i]; const p = []; for (let k = 0; k < n; k++) p.push(X(a[i + head + 2 * k]) + "," + Z(a[i + head + 2 * k + 1])); s += `<polygon points="${p.join(" ")}" fill="${typeof fill === "function" ? fill(a[i + 1]) : fill}"/>`; i += head + 2 * n; } };
  polys(m.green, 2, (d) => `rgba(40,140,40,${0.25 + d * 0.5})`);
  polys(m.water, 1, "#3a7bd5");
  polys(m.buildings, 2, (h) => `hsl(20,60%,${Math.max(25, 75 - h)}%)`);
  for (let i = 0; i < m.roads.length; ) { const n = m.roads[i], w = m.roads[i + 1], p = []; for (let k = 0; k < n; k++) p.push(X(m.roads[i + 2 + 2 * k]) + "," + Z(m.roads[i + 3 + 2 * k])); s += `<polyline points="${p.join(" ")}" fill="none" stroke="#fff" stroke-width="${Math.max(0.6, w * sc).toFixed(1)}"/>`; i += 2 + 2 * n; }
  const c = m.center, N = c.length / 3, flag = new Uint8Array(N);
  for (const [a, b] of m.tunnels) for (let i = a; i <= b; i++) flag[i] = 1;
  for (const [a, b] of m.elevated) for (let i = a; i <= b; i++) flag[i] = 2;
  for (let i = 0; i < N - (m.closed ? 0 : 1); i++) { const j = (i + 1) % N; s += `<line x1="${X(c[i * 3])}" y1="${Z(c[i * 3 + 2])}" x2="${X(c[j * 3])}" y2="${Z(c[j * 3 + 2])}" stroke="${["#e00", "#00f", "#f0f"][flag[i]]}" stroke-width="${Math.max(2, m.width[i] * sc).toFixed(1)}" stroke-linecap="round"/>`; }
  const st = m.start * 3;
  s += `<circle cx="${X(c[st])}" cy="${Z(c[st + 2])}" r="7" fill="#ff0" stroke="#000"/>`;
  const q = ((m.start + 8) % N) * 3;
  s += `<line x1="${X(c[st])}" y1="${Z(c[st + 2])}" x2="${X(c[q])}" y2="${Z(c[q + 2])}" stroke="#000" stroke-width="3"/>`;
  for (const l of m.landmarks) s += `<circle cx="${X(l.x)}" cy="${Z(l.z)}" r="5" fill="#000"/><text x="${+X(l.x) + 7}" y="${+Z(l.z) + 4}" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${l.name}</text>`;
  s += `<text x="10" y="20" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke" font-size="16">${m.name}: ${N} pts, terrain ${t.nx}x${t.nz} @${t.step} m, ${Math.round(lo)}..${Math.round(hi)} m</text>`;
  writeFileSync(file, s + "</svg>");
}
