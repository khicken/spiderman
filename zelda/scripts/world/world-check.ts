// @ts-nocheck
// Offline world check: node --experimental-strip-types scripts/world/world-check.ts
// Builds the real world and the real landmarks (stub DOM and Look) and tests the v2 layout rules.
import { register } from "node:module";
register("./ts-loader.mjs", import.meta.url);

const g = globalThis as Record<string, unknown>;
const ctx2d = new Proxy({}, { get: (_t, k) => (typeof k === "string" && k.startsWith("create") ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };

const THREE = await import("three");
const { createWorld } = await import("../../src/app/world.ts");
const C = await import("../../src/app/contracts.ts");
const { createLandmarks } = await import("../../src/app/landmarks.ts");
const P = await import("../../src/app/landmark-paths.ts");

const world = createWorld(1337);
const boxes: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; tag: string; owner: string }[] = [];
const addBox = world.addBox.bind(world);
(world as { addBox: typeof world.addBox }).addBox = (b) => { boxes.push(b as (typeof boxes)[number]); return addBox(b); };

const look = { uniforms: {}, glsl: "", toon: () => new THREE.MeshLambertMaterial(), patch: <M,>(m: M) => m } as never;
const lm = createLandmarks(new THREE.Scene(), world, look, "high" as never) as never as {
  towers: { cx: number; cz: number; gy: number; height: number; pedestal: { x: number; z: number } }[];
  gladeTower: { cx: number; cz: number; gy: number; height: number };
  anchors: readonly { id: string; pos: { x: number; y: number; z: number } }[];
  items: { itemPos(id: string): { x: number; y: number; z: number } | null; glimmerCount: number };
  props: { id: string }[];
};

let fails = 0;
const ok = (name: string, pass: boolean, detail: string) => { if (!pass) fails++; console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`); };
const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// 1. Glade beacon near spawn
const gl = { x: lm.gladeTower.cx, z: lm.gladeTower.cz, cx: lm.gladeTower.cx, cz: lm.gladeTower.cz, gy: lm.gladeTower.gy, height: lm.gladeTower.height };
ok("glade beacon from spawn", d2(gl, C.PLAYER_SPAWN) <= 150, `${d2(gl, C.PLAYER_SPAWN).toFixed(0)} m (limit 150), gate to beacon ${d2(gl, C.PROLOGUE.gateBrazier).toFixed(0)} m`);

// 2. Knots
const kA = lm.anchors.find((a) => a.id === "prologue:knot-a")!, kB = lm.anchors.find((a) => a.id === "prologue:knot-b")!;
const hz = Math.hypot(kA.pos.x - kB.pos.x, kA.pos.z - kB.pos.z), dy = kA.pos.y - kB.pos.y;
const d3 = Math.hypot(hz, dy);
ok("knot A to B", Math.abs(d3 - 26) <= 1 && Math.abs(dy - 5) <= 0.5, `distance ${d3.toFixed(2)} m (horizontal ${hz.toFixed(2)}), drop ${dy.toFixed(2)} m`);
ok("thread range", d3 <= C.THREAD.maxLen && hz <= 30, `3D ${d3.toFixed(1)} m of maxLen ${C.THREAD.maxLen}`);

// 3. Waystone near every pedestal
for (let i = 0; i < 4; i++) {
  const p = lm.towers[i].pedestal;
  let best = 1e9, id = "";
  for (const w of P.WAYSTONE_LIST) { const d = d2(w, p); if (d < best) { best = d; id = w.id; } }
  ok(`waystone near pedestal ${i}`, best <= 80, `${id} at ${best.toFixed(0)} m`);
}
for (const w of P.WAYSTONE_LIST) ok(`waystone dry ${w.id}`, world.waterAt(w.x, w.z) < world.heightAt(w.x, w.z) - 0.2, `h ${world.heightAt(w.x, w.z).toFixed(1)}`);

// 4. Secrets along ember paths
const v1 = P.V1_SECRETS.map((s) => ({ id: s.id, ...(lm.items.itemPos(s.item) ?? { x: NaN, y: 0, z: NaN }) }));
const all = [...P.SECRETS.map((s) => ({ id: s.id, x: s.x, z: s.z })), ...v1];
ok("secret total", all.length >= 38 && all.length <= 42, `${all.length} (${P.SECRETS.length} new + ${v1.length} v1); v1 positions missing: ${v1.filter((v) => !Number.isFinite(v.x)).map((v) => v.id).join(",") || "none"}`);
for (let i = 0; i < C.EMBER_PATHS.length; i++) {
  const L = P.pathLength(i);
  const s = all.filter((a) => Number.isFinite(a.x)).map((a) => P.nearestOnPath(i, a.x, a.z)).filter((n) => n.d <= 60).map((n) => n.s).sort((a, b) => a - b);
  const pts = [0, ...s, L];
  let gap = 0;
  for (let k = 1; k < pts.length; k++) gap = Math.max(gap, pts[k] - pts[k - 1]);
  ok(`secret gap path ${i}`, gap <= 140, `max gap ${gap.toFixed(0)} m over ${L.toFixed(0)} m, ${s.length} secrets (~${(gap / 6).toFixed(0)} s at 6 m/s)`);
}

// 5. Camps
const prologue = P.PROLOGUE_LINE;
const segDist = (x: number, z: number) => {
  let best = 1e9;
  for (let i = 0; i < prologue.length - 1; i++) {
    const a = prologue[i], b = prologue[i + 1], bx = b.x - a.x, bz = b.z - a.z, l2 = bx * bx + bz * bz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * bx + (z - a.z) * bz) / l2));
    best = Math.min(best, Math.hypot(x - a.x - bx * t, z - a.z - bz * t));
  }
  return best;
};
const nodes = [...lm.towers.map((t, i) => ({ n: `pedestal ${i}`, x: t.pedestal.x, z: t.pedestal.z })), { n: "glade beacon", x: gl.cx, z: gl.cz }, ...P.WAYSTONE_LIST.map((w) => ({ n: w.id, x: w.x, z: w.z }))];
for (const c of C.CAMPS) {
  let worst = "";
  for (const n of nodes) if (d2(c, n) < 45) worst += ` ${n.n} ${d2(c, n).toFixed(0)}m`;
  if (segDist(c.x, c.z) < 45) worst += ` prologue ${segDist(c.x, c.z).toFixed(0)}m`;
  ok(`camp ${c.id}`, worst === "", worst || "clear");
}

// 6. Thin props not climbable
let thin = 0, bad = 0;
for (const b of boxes) {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  if (b.tag === "decor" || ((b.tag === "solid") && Math.min(w, d) < 0.6)) {
    thin++;
    if (world.isClimbable({ x: 0, y: 0, z: 1 }, { ...b, id: 0 } as never)) bad++;
  }
}
ok("thin props not climbable", bad === 0 && thin > 0, `${thin} thin or decor boxes, ${bad} climbable`);

// 7. Vista from the gate to the Glade beacon
{
  const ox = -60, oz = 346, oy = world.heightAt(ox, oz) + 1.7;
  const tx = gl.cx, tz = gl.cz, ty = gl.gy + gl.height;
  const n = Math.round(Math.hypot(tx - ox, tz - oz));
  let blocked = 0, worstClear = 1e9, outside = 0;
  for (let i = 1; i < n - 8; i++) {
    const t = i / n, x = ox + (tx - ox) * t, z = oz + (tz - oz) * t, y = oy + (ty - oy) * t;
    const clear = y - world.heightAt(x, z);
    worstClear = Math.min(worstClear, clear);
    if (clear < 0.5) blocked++;
    if (!P.inViewCut(x, z)) outside++;
  }
  ok("vista terrain", blocked === 0, `lowest clearance ${worstClear.toFixed(1)} m`);
  ok("vista inside view cut", outside === 0, `${outside} samples outside VIEW_CUTS[0] (trees are cleared by the nature track)`);
  const hit = { dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null, kind: "" };
  const dx = tx - ox, dy2 = ty - oy, dz = tz - oz, L = Math.hypot(dx, dy2, dz);
  const r = { hit: false } as { hit: boolean };
  const rr = world.raycast(ox, oy, oz, dx / L, dy2 / L, dz / L, L - 12, hit, false);
  r.hit = rr;
  ok("vista raycast (terrain and boxes)", !rr, rr ? `blocked: ${hit.dist.toFixed(0)} m along the ray at ${hit.point.x.toFixed(0)},${hit.point.z.toFixed(0)}` : "clear");
}

// 8. Secret placement: dry and gentle
{
  let wet = 0, steep = 0;
  const n = new THREE.Vector3();
  for (const s of P.SECRETS) {
    if (world.waterAt(s.x, s.z) >= world.heightAt(s.x, s.z) - 0.2) wet++;
    world.normalAt(s.x, s.z, n);
    if (Math.acos(n.y) * 57.3 > 25) steep++;
  }
  ok("secrets reachable ground", wet === 0 && steep === 0, `${wet} wet, ${steep} steep of ${P.SECRETS.length}`);
  const shards = P.SECRETS.filter((s) => s.reward === "shard").length, wick = P.SECRETS.filter((s) => s.reward === "wick").length;
  console.log(`INFO new shards ${shards}, wick oil ${wick}, chime props ${lm.props.filter((p) => p.id.startsWith("chime-")).length}, glimmers ${lm.items.glimmerCount}`);
}

console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
