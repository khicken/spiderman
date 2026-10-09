import type { MapData } from "../contracts";

// Lab only: a 3 km hilly loop with a tunnel, a bridge, buildings, water and trees. Delete before commit.
export function mockMap(): MapData {
  const center: number[] = [];
  const width: number[] = [];
  const runoff: number[] = [];
  const N = 640;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 420 + 120 * Math.sin(3 * a) + 40 * Math.cos(5 * a);
    const x = Math.cos(a) * r * 1.3;
    const z = Math.sin(a) * r;
    const y = 30 + 18 * Math.sin(2 * a) + 6 * Math.sin(7 * a);
    center.push(x, y, z);
    width.push(12 + 3 * Math.sin(4 * a));
    runoff.push(i % 160 < 80 ? 0 : 14);
  }
  const step = 20;
  const nx = 160;
  const nz = 120;
  const x0 = -1600;
  const z0 = -1200;
  const h: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      h.push(Math.round((25 + 20 * Math.sin(x / 300) * Math.cos(z / 260) + 0.00002 * (x * x + z * z) * 3) * 10) / 10);
    }
  const buildings: number[] = [];
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2;
    const r = 520 + 140 * Math.sin(3 * a) + 60;
    const cx = Math.cos(a) * r * 1.3;
    const cz = Math.sin(a) * r;
    const s = 10 + (k % 5) * 4;
    buildings.push(4, 12 + (k % 7) * 9, cx - s, cz - s, cx + s, cz - s, cx + s, cz + s, cx - s, cz + s);
  }
  const water = [4, -300, -200, 300, -200, 300, 200, -300, 200];
  const green = [4, 0.7, 700, 600, 1400, 600, 1400, 1100, 700, 1100];
  const roads = [3, 8, -900, 0, -1200, 300, -1500, 300];
  return {
    id: "monaco",
    name: "Test Loop",
    place: "Lab",
    origin: [0, 0],
    closed: true,
    laps: 3,
    center,
    width,
    runoff,
    start: 10,
    tunnels: [[200, 240]],
    elevated: [[400, 440]],
    terrain: { x0, z0, step, nx, nz, h },
    buildings,
    roads,
    water,
    waterY: 2,
    green,
    landmarks: [{ name: "Tower", x: 0, z: 0, kind: "tower" }],
    env: { hour: 17.5, weather: "clear", season: "summer" },
    credit: "Lab data",
  };
}
