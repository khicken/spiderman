// Run: npx tsx tests/net-latency-sim.ts
// Models a host streaming to one client over a link with fixed bandwidth and RTT, using real packed chunk sizes.
// Before: one FIFO per peer (chunks, block changes and player snapshots in order), 6 chunks per tick, unpaced.
// After: chunks paced on the queue backlog, player snapshots on their own lane.
import { packChunk } from "../src/game/net/codec";
import { generateChunk } from "../src/game/worldgen";

const RTT = Number(process.env.RTT ?? 150);
const BW = Number(process.env.BW ?? 1_000_000); // bytes per second
const TICKS = 200; // 10 s at 20 Hz, all spent flying into new terrain
const CHUNK_BACKLOG = 48 * 1024;
const SNAP = 600; // players message bytes
const BLOCK = 80;

async function main() {
  const sizes: number[] = [];
  for (let i = 0; i < 24; i++) sizes.push((await packChunk(generateChunk(12345, "overworld", i * 3, i))).length);
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  console.log(`packed chunk: avg ${(avg / 1024).toFixed(1)} KB (min ${(Math.min(...sizes) / 1024).toFixed(1)}, max ${(Math.max(...sizes) / 1024).toFixed(1)})`);

  const run = (paced: boolean) => {
    let wireFree = 0; // when the link finishes what it has been given, ms
    let queued = 0; // bytes accepted but not yet on the wire, for pacing
    const snapLat: number[] = [];
    const blockLat: number[] = [];
    let chunks = 0;
    let want = 400;
    const send = (now: number, bytes: number) => {
      const start = Math.max(now, wireFree);
      wireFree = start + (bytes / BW) * 1000;
      return wireFree + RTT / 2;
    };
    for (let tick = 0; tick < TICKS; tick++) {
      const now = tick * 50;
      queued = Math.max(0, (wireFree - now) * BW / 1000);
      for (let n = 0; n < 6 && want > 0; n++) {
        if (paced && queued > CHUNK_BACKLOG) break;
        const b = sizes[chunks % sizes.length];
        send(now, b);
        queued += b;
        chunks++;
        want--;
      }
      if (tick % 10 === 5) blockLat.push(send(now, BLOCK) - now);
      // The fast lane shares bandwidth but not the queue: it only waits for the frame on the wire.
      if (paced) snapLat.push((SNAP / BW) * 1000 + Math.max(0, Math.min(wireFree - now, (16 * 1024 / BW) * 1000)) + RTT / 2);
      else snapLat.push(send(now, SNAP) - now);
    }
    const p = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
    return { chunks, snapP50: p(snapLat, 0.5), snapP95: p(snapLat, 0.95), blockP95: p(blockLat, 0.95) };
  };
  for (const [label, paced] of [["before", false], ["after", true]] as const) {
    const r = run(paced);
    console.log(
      `${label.padEnd(6)} RTT ${RTT} ms, ${(BW / 1e6).toFixed(1)} MB/s: player snapshot one-way p50 ${r.snapP50.toFixed(0)} ms, p95 ${r.snapP95.toFixed(0)} ms; block change p95 ${r.blockP95.toFixed(0)} ms; chunks sent in 10 s ${r.chunks}`,
    );
  }
}

void main();
