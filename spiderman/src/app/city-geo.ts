export type Pt = readonly [number, number];
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Borough = "Manhattan" | "Brooklyn" | "Queens" | "Roosevelt Island";
export type GeoRoad = { axis: 0 | 1; line: number; min: number; max: number; name: string };
export type GeoBlock = Rect & { district: string; borough: Borough; tag?: "park" | "times"; cut: boolean };
export type Plaza = Rect & { name: string };
export type LandmarkKind = "tower" | "building" | "plaza" | "park" | "sign" | "bridge";
export type GeoLandmark = { name: string; x: number; z: number; kind: LandmarkKind; alias?: string };
export type Bridge = { name: string; a: Pt; b: Pt; deckY: number; width: number };
export type DeckBox = Rect & { maxY: number; minY: number };
export type Water = "Hudson River" | "East River" | "Harlem River";

export const ROAD_W = 22;
export const SIDEWALK = 4;
export const SHORE_GAP = 6;
const INSET = ROAD_W / 2 + SIDEWALK;
const MIN_SIDE = 14;
const STRIP = 190;
const SLICE = 16;
const SLICE_N = { n: 0 };

const TH = (29 * Math.PI) / 180;
const COS = Math.cos(TH);
const SIN = Math.sin(TH);

export function project(lat: number, lon: number): [number, number] {
  const dx = (lon + 73.9855) * 84336;
  const dy = (lat - 40.758) * 111050;
  return [(dx * COS - dy * SIN) / 6, -(dx * SIN + dy * COS) / 6];
}

export const streetZ = (n: number) => 606.7 - 13.47 * n;

export const AVENUES = { "12th Ave": -214, "10th Ave": -138, "8th Ave": -46, "6th Ave": 46, "5th Ave": 97, "Lexington Ave": 177, "1st Ave": 268 } as const;
const AV = AVENUES;
const STREETS = [14, 18, 23, 28, 34, 42, 47, 53, 59, 66, 72, 79, 86, 91, 96, 103, 110, 116, 125, 130];
const DOWNTOWN = { "8th St": 495, Houston: 602, Spring: 665, Canal: 728, Worth: 790, Chambers: 850, Fulton: 931, Wall: 995, "State St": 1050 } as const;

const ll = (a: [number, number][]): Pt[] => a.map(([la, lo]) => project(la, lo));

const MAN_SHORE = ll([
  [40.7003, -74.0165], [40.7035, -74.018], [40.709, -74.019], [40.7145, -74.0178], [40.719, -74.0155], [40.724, -74.013],
  [40.729, -74.012], [40.735, -74.0108], [40.742, -74.0095], [40.748, -74.0085], [40.754, -74.0068], [40.759, -74.0045],
  [40.764, -74.0015], [40.771, -73.9958], [40.777, -73.9915], [40.782, -73.988], [40.788, -73.9848], [40.795, -73.98],
  [40.802, -73.975], [40.809, -73.97], [40.816, -73.9635], [40.821, -73.96], [40.83, -73.955], [40.834, -73.946],
  [40.826, -73.937], [40.814, -73.932], [40.805, -73.9295], [40.7995, -73.9282], [40.7955, -73.9298], [40.79, -73.9345],
  [40.784, -73.94], [40.777, -73.9422], [40.771, -73.9472], [40.765, -73.9522], [40.759, -73.9578], [40.753, -73.9628],
  [40.748, -73.9668], [40.743, -73.9708], [40.738, -73.9732], [40.733, -73.9738], [40.729, -73.9722], [40.724, -73.9712],
  [40.718, -73.9732], [40.713, -73.9762], [40.711, -73.98], [40.7095, -73.987], [40.7085, -73.995], [40.707, -74.0],
  [40.704, -74.006], [40.701, -74.012],
]);

const BK_SHORE = ll([
  [40.686, -74.0045], [40.6935, -74.0015], [40.699, -73.9988], [40.702, -73.9962], [40.704, -73.9935], [40.7046, -73.989],
  [40.704, -73.985], [40.703, -73.98], [40.7032, -73.974], [40.706, -73.9702], [40.71, -73.9692], [40.714, -73.969],
  [40.718, -73.9655], [40.722, -73.9618], [40.727, -73.9602], [40.733, -73.961], [40.7362, -73.9605],
]);
const QN_SHORE = ll([
  [40.7392, -73.9592], [40.742, -73.961], [40.7454, -73.9592], [40.75, -73.9558], [40.754, -73.9503], [40.757, -73.9468],
  [40.762, -73.9428], [40.7665, -73.9398], [40.77, -73.9372], [40.774, -73.9356], [40.7768, -73.9298], [40.779, -73.9252],
  [40.783, -73.9208], [40.786, -73.915], [40.788, -73.905],
]);

const FAR_X = 1400;
const MANHATTAN: Pt[] = MAN_SHORE;
const CREEK_S = BK_SHORE[BK_SHORE.length - 1][1];
const CREEK_N = CREEK_S - 18;
const BROOKLYN: Pt[] = [...BK_SHORE, [FAR_X, CREEK_S], [FAR_X, 1600], [BK_SHORE[0][0], 1600]];
const QUEENS: Pt[] = [[FAR_X, CREEK_N], [QN_SHORE[0][0] - 12, CREEK_N], ...QN_SHORE, [FAR_X, QN_SHORE[QN_SHORE.length - 1][1]]];
const RI_S = project(40.7503, -73.9614);
const RI_N = project(40.7726, -73.9405);
const ROOSEVELT: Pt[] = (() => {
  const [ax, az] = RI_S;
  const [bx, bz] = RI_N;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const prof: [number, number][] = [[0, 4], [0.04, 15], [0.15, 20], [0.85, 20], [0.96, 13], [1, 3]];
  const side = (s: number) => prof.map(([t, w]) => [ax + ux * L * t - uz * w * s, az + uz * L * t + ux * w * s] as Pt);
  return [...side(1), ...side(-1).reverse()];
})();

export const LAND: { borough: Borough; poly: Pt[]; shore: Pt[] }[] = [
  { borough: "Manhattan", poly: MANHATTAN, shore: MAN_SHORE },
  { borough: "Brooklyn", poly: BROOKLYN, shore: BK_SHORE },
  { borough: "Queens", poly: QUEENS, shore: QN_SHORE },
  { borough: "Roosevelt Island", poly: ROOSEVELT, shore: ROOSEVELT },
];

function inPoly(p: Pt[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

function edgeDist(p: Pt[], x: number, z: number, closed = true) {
  let d = Infinity;
  const n = closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}

export function boroughAt(x: number, z: number): Borough | null {
  for (const l of LAND) if (inPoly(l.poly, x, z)) return l.borough;
  return null;
}

export const onLand = (x: number, z: number) => boroughAt(x, z) !== null;

export function shoreDist(x: number, z: number) {
  let d = Infinity;
  for (const l of LAND) d = Math.min(d, edgeDist(l.poly, x, z));
  return d;
}

const stripDist = (x: number, z: number, shore: Pt[]) => edgeDist(shore, x, z, false);

const ok = (poly: Pt[], x: number, z: number, gap: number) => inPoly(poly, x, z) && edgeDist(poly, x, z) >= gap;

function rectOn(poly: Pt[], r: Rect, gap: number) {
  for (const [x, z] of poly) if (x > r.minX - gap && x < r.maxX + gap && z > r.minZ - gap && z < r.maxZ + gap) return false;
  const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / 3)), nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / 3));
  for (let i = 0; i <= nx; i++) {
    const x = r.minX + ((r.maxX - r.minX) * i) / nx;
    if (!ok(poly, x, r.minZ, gap) || !ok(poly, x, r.maxZ, gap)) return false;
  }
  for (let k = 0; k <= nz; k++) {
    const z = r.minZ + ((r.maxZ - r.minZ) * k) / nz;
    if (!ok(poly, r.minX, z, gap) || !ok(poly, r.maxX, z, gap)) return false;
  }
  return true;
}

const big = (r: Rect) => r.maxX - r.minX >= MIN_SIDE && r.maxZ - r.minZ >= MIN_SIDE;
const area = (rs: Rect[]) => rs.reduce((a, r) => a + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);

function crossings(poly: Pt[], v: number, axis: 0 | 1) {
  const out: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const av = axis === 0 ? a[1] : a[0], bv = axis === 0 ? b[1] : b[0];
    if (av > v !== bv > v) {
      const t = (v - av) / (bv - av);
      out.push(axis === 0 ? a[0] + t * (b[0] - a[0]) : a[1] + t * (b[1] - a[1]));
    }
  }
  return out.sort((p, q) => p - q);
}

function sliceFit(poly: Pt[], r: Rect, gap: number, alongZ: boolean): Rect[] {
  const lo = alongZ ? r.minZ : r.minX, hi = alongZ ? r.maxZ : r.maxX;
  const n = SLICE_N.n || Math.max(1, Math.round((hi - lo) / SLICE));
  const out: Rect[] = [];
  for (let s = 0; s < n; s++) {
    const s0 = lo + ((hi - lo) * s) / n, s1 = lo + ((hi - lo) * (s + 1)) / n;
    let a = alongZ ? r.minX : r.minZ, b = alongZ ? r.maxX : r.maxZ;
    for (let v = s0 - gap; v <= s1 + gap + 0.01; v += 1.5) {
      const xs = crossings(poly, v, alongZ ? 0 : 1);
      let best: [number, number] | null = null;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const o = Math.min(b, xs[k + 1]) - Math.max(a, xs[k]);
        if (o > 0 && (!best || o > best[1] - best[0])) best = [xs[k], xs[k + 1]];
      }
      if (!best) { a = b; break; }
      a = Math.max(a, best[0] + gap);
      b = Math.min(b, best[1] - gap);
      if (b - a < MIN_SIDE) break;
    }
    if (b - a < MIN_SIDE) continue;
    const piece = alongZ ? { minX: a, maxX: b, minZ: s0, maxZ: s1 } : { minX: s0, maxX: s1, minZ: a, maxZ: b };
    const prev = out[out.length - 1];
    if (prev && alongZ && Math.abs(prev.minX - a) < 0.5 && Math.abs(prev.maxX - b) < 0.5 && Math.abs(prev.maxZ - s0) < 0.01) prev.maxZ = s1;
    else if (prev && !alongZ && Math.abs(prev.minZ - a) < 0.5 && Math.abs(prev.maxZ - b) < 0.5 && Math.abs(prev.maxX - s0) < 0.01) prev.maxX = s1;
    else out.push(piece);
  }
  return out.filter((p) => big(p) && rectOn(poly, p, gap - 0.01));
}

function narrow(poly: Pt[], r: Rect, gap: number, alongZ: boolean): Rect[] {
  const save = SLICE_N.n;
  SLICE_N.n = 1;
  const out = sliceFit(poly, r, gap, alongZ);
  SLICE_N.n = save;
  return out;
}

function fitLand(poly: Pt[], r: Rect, gap = SHORE_GAP): Rect[] {
  if (!big(r)) return [];
  if (rectOn(poly, r, gap)) return [r];
  const a = sliceFit(poly, r, gap, true), b = sliceFit(poly, r, gap, false);
  const best = area(a) >= area(b) ? a : b;
  if (best.length < 2) return best;
  const one = [...narrow(poly, r, gap, true), ...narrow(poly, r, gap, false)].sort((p, q) => area([q]) - area([p]))[0];
  return one && area([one]) >= 0.8 * area(best) ? [one] : best;
}

function subtract(r: Rect, h: Rect): Rect[] {
  if (h.minX >= r.maxX || h.maxX <= r.minX || h.minZ >= r.maxZ || h.maxZ <= r.minZ) return [r];
  const out: Rect[] = [];
  if (h.minZ > r.minZ) out.push({ ...r, maxZ: h.minZ });
  if (h.maxZ < r.maxZ) out.push({ ...r, minZ: h.maxZ });
  const z0 = Math.max(r.minZ, h.minZ), z1 = Math.min(r.maxZ, h.maxZ);
  if (h.minX > r.minX) out.push({ minX: r.minX, maxX: h.minX, minZ: z0, maxZ: z1 });
  if (h.maxX < r.maxX) out.push({ minX: h.maxX, maxX: r.maxX, minZ: z0, maxZ: z1 });
  return out.filter(big);
}

const subtractAll = (rs: Rect[], holes: Rect[]) => holes.reduce((acc, h) => acc.flatMap((r) => subtract(r, h)), rs);

export const BOUNDS: Rect = { minX: -330, maxX: 880, minZ: streetZ(130) - 30, maxZ: 1210 };
const EDGE = 20;

export const CENTRAL_PARK: Rect = { minX: AV["8th Ave"], maxX: AV["5th Ave"], minZ: streetZ(110), maxZ: streetZ(59) };

const BROADWAY: Pt[] = [[145, streetZ(14)], [AV["5th Ave"], streetZ(23)], [AV["6th Ave"], streetZ(34) + 4], [1, -10], [AV["8th Ave"], streetZ(59)]];
const SQUARES = [
  { name: "Union Square", z0: streetZ(18), z1: streetZ(14), w: 34, dx: 12 },
  { name: "Madison Square", z0: streetZ(26), z1: streetZ(23), w: 34, dx: 32 },
  { name: "Herald Square", z0: streetZ(34) - 10, z1: streetZ(34) + 26, w: 22, dx: 0 },
  { name: "Times Square", z0: streetZ(47), z1: streetZ(42), w: 26, dx: 0 },
];
const BWAY_W = 13;

export function broadwayX(z: number) {
  const P = BROADWAY;
  if (z >= P[0][1]) return P[0][0];
  for (let i = 1; i < P.length; i++) {
    if (z >= P[i][1]) {
      const t = (z - P[i - 1][1]) / (P[i][1] - P[i - 1][1]);
      return P[i - 1][0] + t * (P[i][0] - P[i - 1][0]);
    }
  }
  return P[P.length - 1][0];
}

type Zone = { borough: Borough; xs: number[]; zs: number[]; z0: number; z1: number; strip?: Pt[]; roads?: boolean };

const MAN_ZS = [...STREETS.map(streetZ), ...Object.values(DOWNTOWN)].sort((a, b) => a - b);
const zsIn = (z0: number, z1: number) => MAN_ZS.filter((z) => z >= z0 - 0.01 && z <= z1 + 0.01);
const D = DOWNTOWN;
const S14 = streetZ(14);
const N_XS = Object.values(AV);

const grid = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

const ZONES: Zone[] = [
  { borough: "Manhattan", xs: N_XS, zs: zsIn(streetZ(130), S14), z0: streetZ(130), z1: S14 },
  { borough: "Manhattan", xs: [-138, -46, 46, 97, 145, 204, 268, 370], zs: zsIn(S14, D["8th St"]), z0: S14, z1: D["8th St"] },
  { borough: "Manhattan", xs: [-138, -46, 46, 145, 204, 268, 370], zs: zsIn(D["8th St"], D.Houston), z0: D["8th St"], z1: D.Houston },
  { borough: "Manhattan", xs: [-46, 46, 100, 145, 220, 268, 330, 400], zs: zsIn(D.Houston, D.Canal), z0: D.Houston, z1: D.Canal },
  { borough: "Manhattan", xs: [20, 90, 145, 232, 300], zs: zsIn(D.Canal, D.Chambers), z0: D.Canal, z1: D.Chambers },
  { borough: "Manhattan", xs: [20, 100, 145, 210], zs: [...zsIn(D.Chambers, D["State St"]), 1e4], z0: D.Chambers, z1: 1e4 },
  { borough: "Brooklyn", xs: grid(340, 900, 82), zs: grid(250, 1170, 76), z0: CREEK_S, z1: 1600, strip: BK_SHORE },
  { borough: "Queens", xs: grid(440, 900, 82), zs: grid(-930, 150, 77), z0: -1e4, z1: CREEK_N, strip: QN_SHORE },
  { borough: "Roosevelt Island", xs: [], zs: grid(-560, 0, 70), z0: -1e4, z1: 1e4, roads: false },
];

const polyOf = (b: Borough) => LAND.find((l) => l.borough === b)!.poly;
const STEP = 2;

function lineIntervals(poly: Pt[], axis: 0 | 1, line: number, lo: number, hi: number, strip?: Pt[]) {
  const out: [number, number][] = [];
  let start = NaN;
  const h = ROAD_W / 2;
  for (let s = lo; s <= hi + 0.01; s += STEP) {
    const x = axis === 0 ? s : line, z = axis === 0 ? line : s;
    const ox = axis === 0 ? 0 : h, oz = axis === 0 ? h : 0;
    const good =
      ok(poly, x, z, 2) && ok(poly, x + ox, z + oz, 2) && ok(poly, x - ox, z - oz, 2) && (!strip || stripDist(x, z, strip) <= STRIP + 20);
    if (good && Number.isNaN(start)) start = s;
    if ((!good || s + STEP > hi + 0.01) && !Number.isNaN(start)) {
      const end = good ? s : s - STEP;
      if (end - start >= 30) out.push([start, end]);
      start = NaN;
    }
  }
  return out;
}

function avenueName(x: number, z: number) {
  for (const [n, v] of Object.entries(AV)) if (Math.abs(v - x) < 1 && z <= S14) return n;
  if (Math.abs(x - 145) < 1) return "Broadway";
  if (Math.abs(x - 46) < 1) return "6th Ave";
  return "";
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

function streetName(z: number, borough: Borough) {
  if (borough !== "Manhattan") return "";
  for (const n of STREETS) if (Math.abs(streetZ(n) - z) < 0.5) return `${n}${ordinal(n)} St`;
  for (const [n, v] of Object.entries(DOWNTOWN)) if (Math.abs(v - z) < 0.5) return n === "8th St" ? n : `${n} St`;
  return "";
}

function buildRoads() {
  const roads: GeoRoad[] = [];
  const add = (r: GeoRoad) => {
    const m = roads.find((o) => o.axis === r.axis && Math.abs(o.line - r.line) < 0.01 && r.min <= o.max + 0.01 && r.max >= o.min - 0.01);
    if (m) {
      m.min = Math.min(m.min, r.min);
      m.max = Math.max(m.max, r.max);
    } else roads.push(r);
  };
  for (const zn of ZONES) {
    if (zn.roads === false) continue;
    const poly = polyOf(zn.borough);
    const zlo = Math.max(zn.z0, BOUNDS.minZ + EDGE), zhi = Math.min(zn.z1, BOUNDS.maxZ - EDGE);
    for (const x of zn.xs) for (const [a, b] of lineIntervals(poly, 1, x, zlo, zhi, zn.strip)) add({ axis: 1, line: x, min: a, max: b, name: avenueName(x, (a + b) / 2) });
    for (const z of zn.zs) {
      if (z < zlo - 0.01 || z > zhi + 0.01) continue;
      for (const [a, b] of lineIntervals(poly, 0, z, BOUNDS.minX + EDGE, BOUNDS.maxX - EDGE, zn.strip)) add({ axis: 0, line: z, min: a, max: b, name: streetName(z, zn.borough) });
    }
  }
  const P = CENTRAL_PARK, h = ROAD_W / 2;
  const cut: GeoRoad[] = [];
  for (const r of roads) {
    const inPark = r.axis === 1 ? r.line > P.minX + h && r.line < P.maxX - h : r.line > P.minZ + h && r.line < P.maxZ - h;
    const [lo, hi] = r.axis === 1 ? [P.minZ, P.maxZ] : [P.minX, P.maxX];
    if (!inPark || r.max <= lo || r.min >= hi) { cut.push(r); continue; }
    if (lo - r.min >= 30) cut.push({ ...r, max: lo });
    if (r.max - hi >= 30) cut.push({ ...r, min: hi });
  }
  return cut;
}

export const ROADS: GeoRoad[] = buildRoads();

const roadRect = (r: GeoRoad, pad = 0): Rect =>
  r.axis === 0
    ? { minX: r.min - pad, maxX: r.max + pad, minZ: r.line - ROAD_W / 2 - pad, maxZ: r.line + ROAD_W / 2 + pad }
    : { minX: r.line - ROAD_W / 2 - pad, maxX: r.line + ROAD_W / 2 + pad, minZ: r.min - pad, maxZ: r.max + pad };

export const BRIDGES: Bridge[] = [
  { name: "Brooklyn Bridge", a: project(40.7085, -73.9985), b: project(40.7036, -73.9925), deckY: 26, width: 20 },
  { name: "Manhattan Bridge", a: project(40.7112, -73.9928), b: project(40.7022, -73.9878), deckY: 30, width: 24 },
  { name: "Williamsburg Bridge", a: project(40.7148, -73.9795), b: project(40.7114, -73.9655), deckY: 30, width: 24 },
  { name: "Queensboro Bridge", a: [AV["1st Ave"] + 12, streetZ(59) - 10], b: [QN_SHORE[5][0] + 30, streetZ(59) - 10], deckY: 32, width: 24 },
];

export function deckBoxes(br: Bridge, step = 3): DeckBox[] {
  const [ax, az] = br.a, [bx, bz] = br.b;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const sa = Math.abs(uz), ca = Math.abs(ux), h = br.width / 2;
  const out: DeckBox[] = [];
  if (sa < 0.03 || ca < 0.03) {
    const hx = sa < 0.03 ? L / 2 : h, hz = sa < 0.03 ? h : L / 2;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    return [{ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, maxY: br.deckY, minY: br.deckY - 3.5 }];
  }
  const hx = Math.min(h / (2 * sa), L / 2), hz = Math.min(h / (2 * ca), L / 2);
  const along = hx * ca + hz * sa;
  const n = Math.max(1, Math.ceil((L - 2 * along) / step));
  for (let i = 0; i <= n; i++) {
    const t = along + ((L - 2 * along) * i) / n;
    const cx = ax + ux * t, cz = az + uz * t;
    out.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, maxY: br.deckY, minY: br.deckY - 3.5 });
  }
  return out;
}

const DECKS = BRIDGES.map((b) => deckBoxes(b, 6));

function bridgeHoles(): Rect[] {
  const out: Rect[] = [];
  for (const d of DECKS) for (const b of d) out.push({ minX: b.minX - 2, maxX: b.maxX + 2, minZ: b.minZ - 2, maxZ: b.maxZ + 2 });
  return out;
}

export function districtAt(x: number, z: number): string {
  const b = boroughAt(x, z);
  if (!b) return "";
  if (b === "Roosevelt Island") return b;
  if (b === "Brooklyn") return z > 960 ? "Brooklyn Heights" : z > 830 ? "DUMBO" : "Williamsburg";
  if (b === "Queens") return z > -360 ? "Long Island City" : "Astoria";
  const P = CENTRAL_PARK;
  if (x >= P.minX && x <= P.maxX && z >= P.minZ && z <= P.maxZ) return "Central Park";
  if (z < streetZ(110) || (z < streetZ(96) && x > AV["5th Ave"])) return "Harlem";
  if (z < streetZ(59)) return x < 25 ? "Upper West Side" : "Upper East Side";
  if (z <= streetZ(34)) return x < AV["8th Ave"] ? "Hell's Kitchen" : "Midtown";
  if (z <= S14) return x < AV["6th Ave"] ? "Chelsea" : "Midtown";
  if (z > D.Chambers || (z > D.Worth && x < 110)) return "Financial District";
  if (z > 650 && x >= 110 && x < 250) return "Chinatown";
  if (x >= 145) return "Lower East Side";
  return "Greenwich Village";
}

export const DISTRICT_NAMES = [
  "Central Park", "Harlem", "Upper West Side", "Upper East Side", "Hell's Kitchen", "Midtown", "Greenwich Village", "Chinatown",
  "Lower East Side", "Financial District", "Chelsea", "DUMBO", "Brooklyn Heights", "Williamsburg", "Long Island City", "Astoria",
  "Roosevelt Island",
] as const;

const PARKS: { name: string; x: number; z: number }[] = [
  { name: "Washington Square", ...xz(project(40.7308, -73.9973)) },
  { name: "Battery", x: 150, z: 1090 },
  { name: "Bryant Park", x: 72, z: 60 },
];
function xz(p: [number, number]) {
  return { x: p[0], z: p[1] };
}

function buildBlocks() {
  const holes: Rect[] = [...ROADS.map((r) => roadRect(r, SIDEWALK)), ...bridgeHoles()];
  const plazas: Plaza[] = [];
  const blocks: GeoBlock[] = [];
  for (const zn of ZONES) {
    const poly = polyOf(zn.borough);
    const inset = zn.roads === false ? 0 : INSET;
    const xs = [-1e4, ...zn.xs, 1e4];
    const zs = zn.zs.filter((z) => z >= zn.z0 - 0.01 && z <= zn.z1 + 0.01);
    if (zs[0] > zn.z0 + 0.01) zs.unshift(zn.z0);
    if (zs[zs.length - 1] < zn.z1 - 0.01) zs.push(zn.z1);
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < zs.length; j++) {
        const cell: Rect = {
          minX: Math.max(xs[i] + inset, BOUNDS.minX + EDGE), maxX: Math.min(xs[i + 1] - inset, BOUNDS.maxX - EDGE),
          minZ: Math.max(zs[j] + inset, BOUNDS.minZ + EDGE), maxZ: Math.min(zs[j + 1] - inset, BOUNDS.maxZ - EDGE),
        };
        if (cell.maxX - cell.minX < MIN_SIDE || cell.maxZ - cell.minZ < MIN_SIDE) continue;
        const P = CENTRAL_PARK;
        if (zn.borough === "Manhattan" && cell.minX >= P.minX && cell.maxX <= P.maxX && cell.minZ >= P.minZ && cell.maxZ <= P.maxZ) continue;
        let parts = fitLand(poly, cell);
        if (zn.strip) parts = parts.filter((p) => stripDist((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2, zn.strip!) <= STRIP);
        parts = subtractAll(parts, holes);
        if (zn.borough === "Manhattan") parts = parts.flatMap((p) => carveBroadway(p, plazas));
        const cut = parts.length !== 1 || parts[0].minX !== cell.minX || parts[0].maxX !== cell.maxX || parts[0].minZ !== cell.minZ || parts[0].maxZ !== cell.maxZ;
        for (const p of parts) blocks.push({ ...p, district: districtAt((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2), borough: zn.borough, cut });
      }
    }
  }
  const P = CENTRAL_PARK;
  blocks.push({ minX: P.minX + INSET, maxX: P.maxX - INSET, minZ: P.minZ + INSET, maxZ: P.maxZ - INSET, district: "Central Park", borough: "Manhattan", tag: "park", cut: false });
  for (const pk of PARKS) {
    const b = blocks.find((k) => pk.x >= k.minX && pk.x <= k.maxX && pk.z >= k.minZ && pk.z <= k.maxZ);
    if (b) b.tag = "park";
  }
  const ts = plazas.find((p) => p.name === "Times Square");
  if (ts) {
    const near = blocks.filter((b) => b.maxX <= ts.minX + 0.1 && b.minZ < ts.maxZ && b.maxZ > ts.minZ).sort((a, b) => b.maxX - a.maxX)[0];
    if (near) near.tag = "times";
  }
  return { blocks, plazas };
}

function carveBroadway(r: Rect, plazas: Plaza[]): Rect[] {
  const top = BROADWAY[0][1], bottom = BROADWAY[BROADWAY.length - 1][1];
  if (r.minZ > top || r.maxZ < bottom) return [r];
  const lo = Math.min(broadwayX(r.minZ), broadwayX(r.maxZ)) - 30, hi = Math.max(broadwayX(r.minZ), broadwayX(r.maxZ)) + 30;
  if (hi < r.minX || lo > r.maxX) return [r];
  const n = Math.max(1, Math.round((r.maxZ - r.minZ) / 14));
  const out: Rect[] = [];
  for (let s = 0; s < n; s++) {
    const z0 = r.minZ + ((r.maxZ - r.minZ) * s) / n, z1 = r.minZ + ((r.maxZ - r.minZ) * (s + 1)) / n;
    const zm = (z0 + z1) / 2;
    const sq = SQUARES.find((q) => zm >= q.z0 && zm <= q.z1);
    const w = sq ? sq.w : BWAY_W;
    const dx = sq ? sq.dx : 0;
    let p0 = Math.min(broadwayX(z0), broadwayX(z1)) + dx - w / 2, p1 = Math.max(broadwayX(z0), broadwayX(z1)) + dx + w / 2;
    if (p1 <= r.minX || p0 >= r.maxX) { out.push({ ...r, minZ: z0, maxZ: z1 }); continue; }
    if (p0 - r.minX < MIN_SIDE) p0 = r.minX;
    if (r.maxX - p1 < MIN_SIDE) p1 = r.maxX;
    if (p0 > r.minX) out.push({ minX: r.minX, maxX: p0, minZ: z0, maxZ: z1 });
    if (p1 < r.maxX) out.push({ minX: p1, maxX: r.maxX, minZ: z0, maxZ: z1 });
    if (p1 - p0 >= 4) plazas.push({ minX: p0, maxX: p1, minZ: z0, maxZ: z1, name: sq ? sq.name : "Broadway" });
  }
  return out.filter((p) => p.maxZ - p.minZ >= 6 && p.maxX - p.minX >= MIN_SIDE);
}

const built = buildBlocks();
export const BLOCKS: GeoBlock[] = built.blocks;
export const PLAZAS: Plaza[] = built.plazas;

const LM: [string, number, number, LandmarkKind, string?][] = [
  ["Empire State Building", 40.7484, -73.9857, "tower", "Empire Tower"],
  ["Chrysler Building", 40.7516, -73.9755, "tower"],
  ["One World Trade Center", 40.7127, -74.0134, "tower", "Downtown Tower"],
  ["Flatiron Building", 40.7411, -73.9897, "building"],
  ["Times Square", 40.758, -73.9855, "plaza"],
  ["Grand Central", 40.7527, -73.9772, "building"],
  ["United Nations", 40.7489, -73.968, "building"],
  ["Rockefeller Center", 40.7587, -73.9787, "plaza", "Holiday Plaza"],
  ["Washington Square", 40.7308, -73.9973, "park"],
  ["Union Square", 40.7359, -73.9911, "plaza"],
  ["City Hall", 40.7128, -74.006, "building"],
  ["Battery", 40.7033, -74.0155, "park"],
  ["Hudson Yards", 40.7536, -74.0021, "tower", "Construction Site"],
  ["Apollo Theater", 40.81, -73.95, "sign"],
  ["DUMBO", 40.7033, -73.9894, "plaza"],
  ["Brooklyn Heights Promenade", 40.696, -73.9975, "park"],
  ["Domino Park", 40.7142, -73.968, "park"],
  ["Gantry Plaza", 40.7454, -73.958, "park"],
  ["One Court Square", 40.7472, -73.9439, "tower"],
  ["Astoria Park", 40.779, -73.923, "park"],
  ["Pepsi-Cola Sign", 40.747, -73.959, "sign"],
  ["Central Park", 40.7812, -73.9665, "park"],
  ["Frozen Pond", 40.7678, -73.9746, "park"],
  ["Harlem", 40.8075, -73.9465, "plaza"],
];

export function blockAt(x: number, z: number): GeoBlock | null {
  const c = cellOf(x, z);
  for (const i of BLOCK_GRID.get(c) ?? NONE) {
    const b = BLOCKS[i];
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return b;
  }
  return null;
}

const CELL = 64;
const NONE: number[] = [];
const cellOf = (x: number, z: number) => Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
function index(rects: Rect[], pad: number) {
  const m = new Map<number, number[]>();
  rects.forEach((r, i) => {
    for (let cx = Math.floor((r.minX - pad) / CELL); cx <= Math.floor((r.maxX + pad) / CELL); cx++) {
      for (let cz = Math.floor((r.minZ - pad) / CELL); cz <= Math.floor((r.maxZ + pad) / CELL); cz++) {
        const k = cx * 4096 + cz;
        const l = m.get(k);
        if (l) l.push(i);
        else m.set(k, [i]);
      }
    }
  });
  return m;
}
const BLOCK_GRID = index(BLOCKS, 0);
const ROAD_GRID = index(ROADS.map((r) => roadRect(r)), CELL);

function snapToBlock(x: number, z: number): [number, number] {
  if (blockAt(x, z)) return [x, z];
  let best: GeoBlock | null = null, bd = Infinity;
  for (const b of BLOCKS) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const d = Math.hypot(dx, dz);
    if (d < bd) [bd, best] = [d, b];
  }
  if (!best) return [x, z];
  return [Math.min(Math.max(x, best.minX + 4), best.maxX - 4), Math.min(Math.max(z, best.minZ + 4), best.maxZ - 4)];
}

export const LANDMARKS: GeoLandmark[] = LM.map(([name, la, lo, kind, alias]) => {
  let [x, z] = project(la, lo);
  if (kind === "tower" || kind === "building" || (kind !== "bridge" && !onLand(x, z))) [x, z] = snapToBlock(x, z);
  const l: GeoLandmark = { name, x: Math.round(x), z: Math.round(z), kind };
  if (alias) l.alias = alias;
  return l;
});
for (const b of BRIDGES) LANDMARKS.push({ name: b.name, x: Math.round((b.a[0] + b.b[0]) / 2), z: Math.round((b.a[1] + b.b[1]) / 2), kind: "bridge" });

export function streetDist(x: number, z: number) {
  let d = Infinity;
  for (const i of ROAD_GRID.get(cellOf(x, z)) ?? NONE) {
    const r = ROADS[i];
    const a = r.axis === 0 ? x : z, l = r.axis === 0 ? z : x;
    const along = a < r.min ? r.min - a : a > r.max ? a - r.max : 0;
    const v = along > 0 ? Math.hypot(along, l - r.line) : Math.abs(l - r.line);
    if (v < d) d = v;
  }
  return d;
}

function nearestLine(axis: 0 | 1, v: number, cross: number) {
  let best: GeoRoad | null = null, bd = Infinity;
  for (const r of ROADS) {
    if (r.axis !== axis) continue;
    if (!Number.isNaN(cross) && (cross < r.min - 1 || cross > r.max + 1)) continue;
    const d = Math.abs(r.line - v);
    if (d < bd) [bd, best] = [d, r];
  }
  return best;
}

export const nearestAvenue = (x: number, z = NaN) => nearestLine(1, x, z);
export const nearestStreet = (z: number, x = NaN) => nearestLine(0, z, x);

export function crossingsOf(r: GeoRoad) {
  const out: number[] = [];
  for (const o of ROADS) {
    if (o.axis === r.axis) continue;
    if (o.line >= r.min - 1 && o.line <= r.max + 1 && r.line >= o.min - 1 && r.line <= o.max + 1) out.push(o.line);
  }
  return out.sort((a, b) => a - b);
}

export function waterAt(x: number, z: number): Water | null {
  if (onLand(x, z)) return null;
  if (z < streetZ(110) && x > 150 && x < 560) return "Harlem River";
  const xs = crossings(MANHATTAN, z, 0);
  if (xs.length >= 2 ? x < xs[0] : x < 150) return "Hudson River";
  return "East River";
}

export const SPAWN = (() => {
  const b = blockAt(72, streetZ(44.5)) ?? blockAt(AV["5th Ave"] + 40, streetZ(44.5));
  return b ? { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 } : { x: 72, z: 7 };
})();

export function districtRects() {
  return DISTRICT_NAMES.map((name) => {
    const bs = BLOCKS.filter((b) => b.district === name);
    return {
      name,
      minX: Math.min(...bs.map((b) => b.minX)), maxX: Math.max(...bs.map((b) => b.maxX)),
      minZ: Math.min(...bs.map((b) => b.minZ)), maxZ: Math.max(...bs.map((b) => b.maxZ)),
    };
  });
}
