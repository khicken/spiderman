// Run: node --experimental-strip-types --import ./scripts/trials/register.mjs scripts/check/save-check.ts
import { BEACON_LANDMARK, SAVE_KEY, SAVE_KEY_V2, WAYSTONES } from "../../src/app/contracts";
import { migrate, readSaveV2, writeSaveV2, sanitizeQuest, clearSave } from "../../src/app/save";
import type { QuestState } from "../../src/app/contracts";
import { BTN_NAMES, newQuest, newProgress, objectiveLines, guard, clockScale } from "../../src/app/state";

let fails = 0;
const ok = (c: boolean, msg: string) => {
  if (!c) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

class Mem implements Storage {
  m = new Map<string, string>();
  quota = Infinity; // max total chars
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) {
    let size = v.length;
    for (const [kk, vv] of this.m) if (kk !== k) size += vv.length;
    if (size > this.quota) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  }
}

const v1 = (over: Record<string, unknown> = {}) => ({
  v: 1, pos: { x: 100, y: 20, z: 50 }, yaw: 1, maxHp: 20, hp: 14, shards: 2, glimmers: 77, arrows: 12, hasBow: true, hasGlider: true,
  quest: { stage: "beacons", beacons: [true, false, true, false], trial: -1, barrierDown: false, wardenDefeated: false, visited: ["shrine", "village"] },
  collected: ["g-1", "shard-3", "chest-bow"], timeOfDay: 13.5, playTime: 1234, ...over,
});

// 1. v1 -> v2, nothing lost
{
  const st = new Mem();
  const old = v1();
  st.setItem(SAVE_KEY, JSON.stringify(old));
  const d = readSaveV2(st)!;
  ok(!!d && d.v === 2, "v1 loads as v2");
  ok(eq(d.quest.beacons, [true, false, true, false]), "v1 beacons kept");
  ok(d.maxHp === 20 && d.hp === 14 && d.shards === 2, "v1 hearts and shards kept");
  ok(eq(d.collected, old.collected) && d.glimmers === 77 && d.arrows === 12 && d.hasBow, "v1 items kept");
  ok(eq(d.quest.visited, ["shrine", "village"]), "v1 visited kept");
  ok(d.quest.prologue === "done" && d.quest.gladeLit === true, "v1 with beacon: prologue done, glade lit");
  ok(d.pos.x === 100 && d.pos.y === 20, "v1 position kept when a beacon is lit");
  ok(st.getItem(SAVE_KEY) === null && st.getItem(SAVE_KEY_V2) !== null, "v1 key removed after migration (one-time)");
  ok(eq(readSaveV2(st), d), "second read is the same v2");
  const fresh = new Mem();
  fresh.setItem(SAVE_KEY, JSON.stringify(v1({ quest: { stage: "awaken", beacons: [false, false, false, false], trial: -1, barrierDown: false, wardenDefeated: false, visited: [] } })));
  const f = readSaveV2(fresh)!;
  ok(f.quest.prologue === "wake" && f.quest.gladeLit === false && f.pos.x === -60, "v1 with no beacon: prologue wake at the gate");
}

// 2. v2 round trip lossless
{
  const st = new Mem();
  const q: Required<QuestState> = { ...newQuest() as Required<QuestState>, stage: "beacons" as const, beacons: [true, true, false, false] as [boolean, boolean, boolean, boolean], prologue: "done" as const, gladeLit: true,
    waystones: ["ws-glade", "ws-ashen"], tracked: { kind: "waystone" as const, id: "ws-ashen" }, autoTrack: false, memories: [0, 1] as (0 | 1)[], visited: ["shrine" as const, "beacon-glade" as const] };
  const src = {
    v: 2 as const, pos: { x: -40, y: 11.5, z: 200 }, yaw: 2.5, maxHp: 28, hp: 20, shards: 3, glimmers: 410, arrows: 22, hasBow: true, hasGlider: true,
    quest: q, collected: ["a", "b", "c"], timeOfDay: 8.25, playTime: 5000,
    progress: { wickOil: 2, seeds: 4, powers: ["long" as const, "burning" as const], hintsSeen: ["move" as const, "thread" as const], glimmersSpent: 130 }, waystone: "ws-glade",
  };
  ok(writeSaveV2(src, st), "v2 write succeeds");
  const rt = readSaveV2(st);
  const norm = (x: unknown) => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  ok(norm(rt) === norm(src), "v2 round trip is lossless (key order ignored)");
  if (norm(rt) !== norm(src)) console.log(norm(rt), "\n", norm(src));
}

// 3. malformed saves: never throw, never return garbage
{
  const bad: [string, unknown][] = [
    ["null", null], ["number", 5], ["array", []], ["string", "x"], ["empty object", {}], ["future v3", { v: 3 }], ["v1 as string", "{"],
    ["NaN pos", v1({ pos: { x: "a", y: NaN, z: null } })], ["huge pos", v1({ pos: { x: 1e12, y: 1e9, z: -1e12 } })],
    ["hp -5", v1({ hp: -5 })], ["hp NaN", v1({ hp: "full" })], ["maxHp 999", v1({ maxHp: 999 })], ["shards 40", v1({ shards: 40 })],
    ["negative glimmers", v1({ glimmers: -4 })], ["arrows Infinity", v1({ arrows: Infinity })],
    ["collected junk", v1({ collected: [1, null, {}, "ok", "ok", "x".repeat(500)] })], ["collected not array", v1({ collected: "abc" })],
    ["quest null", v1({ quest: null })], ["quest stage evil", v1({ quest: { stage: "__proto__", beacons: "yes" } })],
    ["beacons wrong len", v1({ quest: { stage: "beacons", beacons: [true], visited: [{}, 3, "mars"] } })],
    ["timeOfDay -30", v1({ timeOfDay: -30 })], ["timeOfDay 1e9", v1({ timeOfDay: 1e9 })],
  ];
  for (const [name, val] of bad) {
    let d: ReturnType<typeof migrate> = null;
    let threw = false;
    try { d = migrate(val); } catch { threw = true; }
    const clean = d === null || (
      Number.isFinite(d.pos.x) && Number.isFinite(d.pos.y) && Number.isFinite(d.pos.z) && Math.abs(d.pos.x) < 640 && Math.abs(d.pos.z) < 640 &&
      d.hp >= 1 && d.hp <= d.maxHp && d.maxHp >= 12 && d.maxHp <= 36 && d.shards >= 0 && d.shards <= 3 && d.glimmers >= 0 && Number.isFinite(d.arrows) && d.arrows >= 0 && d.arrows <= 30 &&
      d.collected.every((c) => typeof c === "string" && c.length <= 80) && new Set(d.collected).size === d.collected.length &&
      d.quest.beacons.length === 4 && d.quest.beacons.every((b) => typeof b === "boolean") && d.quest.trial === -1 &&
      d.quest.visited.every((v) => typeof v === "string") && d.timeOfDay >= 0 && d.timeOfDay < 24
    );
    ok(!threw && clean, `malformed: ${name}`);
  }
  ok(migrate({ v: 2, pos: {}, quest: { tracked: { kind: "waystone", id: "nope" }, waystones: ["ws-glade", "ws-glade", "bogus"], memories: [0, 9, "x"] }, progress: { powers: ["long", "fly", "long"], hintsSeen: ["move", "zzz"], wickOil: 99, seeds: -3 }, waystone: "bogus" })?.quest.waystones.length === 1, "v2 waystone ids whitelisted and deduped");
  const m = migrate({ v: 2, progress: { powers: ["long", "fly", "long"], hintsSeen: ["move", "zzz"], wickOil: 99, seeds: -3 }, waystone: "bogus" })!;
  ok(eq(m.progress.powers, ["long"]) && eq(m.progress.hintsSeen, ["move"]) && m.progress.wickOil === 3 && m.progress.seeds === 0 && m.waystone === null, "v2 progress whitelisted and clamped");
  const q = sanitizeQuest({ stage: "beacons", beacons: [true, true, true, true], barrierDown: false, trial: 2 });
  ok(q.barrierDown && q.stage === "spire" && q.trial === -1, "4 beacons lit with barrier up is repaired; trial cleared");
  ok(sanitizeQuest({ stage: "boss", beacons: [true, true, true, true] }).stage === "spire", "boss stage reloads as spire");
}

// 4. corrupt JSON in storage
{
  const st = new Mem();
  st.setItem(SAVE_KEY_V2, "{not json");
  ok(readSaveV2(st) === null, "corrupt v2 JSON gives null");
  st.setItem(SAVE_KEY, JSON.stringify(v1()));
  ok(readSaveV2(st)?.glimmers === 77, "corrupt v2 falls back to an intact v1");
  const st2 = new Mem();
  st2.setItem(SAVE_KEY, "garbage");
  ok(readSaveV2(st2) === null, "corrupt v1 JSON gives null");
  ok(readSaveV2(null) === null, "no storage gives null");
}

// 5. full storage
{
  const full = new Mem();
  full.setItem(SAVE_KEY, JSON.stringify(v1()));
  const d = migrate(v1())!;
  full.quota = JSON.stringify(d).length + 20;
  ok(writeSaveV2(d, full) === true, "full storage: write frees the v1 copy and succeeds");
  const tiny = new Mem();
  tiny.quota = 10;
  tiny.setItem("k", "x");
  ok(writeSaveV2(d, tiny) === false, "storage too small: returns false, does not throw");
  const keep = new Mem();
  writeSaveV2(d, keep);
  keep.quota = 5;
  const before = keep.getItem(SAVE_KEY_V2);
  ok(writeSaveV2({ ...d, glimmers: 1 }, keep) === false && keep.getItem(SAVE_KEY_V2) === before, "failed write leaves the old save intact");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } as unknown as Storage;
  ok(readSaveV2(blocked) === null && writeSaveV2(d, blocked) === false, "blocked storage (throws) is handled");
  clearSave(blocked);
}

// 6. state.ts hooks
{
  ok(BTN_NAMES.includes("thread"), "BTN_NAMES has thread");
  const q = newQuest();
  ok(q.prologue === "wake" && q.tracked?.kind === "none" && q.autoTrack === true && Array.isArray(q.waystones), "newQuest has v2 fields");
  ok(eq(newProgress().powers, []), "newProgress");
  ok(objectiveLines(q, false).text === "Light the brazier at the gate", "objective: brazier");
  const b = { ...q, stage: "beacons" as const, beacons: [true, true, true, false] as [boolean, boolean, boolean, boolean] };
  const o = objectiveLines(b, false, { x: 0, z: 0 });
  ok(o.text.startsWith("Light the 4 beacons (3/4). Next: Windward") && o.sub?.includes("bow") === true, `objective: ${o.text} | ${o.sub}`);
  ok(objectiveLines({ ...b, beacons: [false, false, false, false] }, false, { x: -35, z: 240 }).text.includes("Next: ") && !objectiveLines({ ...b, beacons: [false, false, false, false] }, false, { x: -140, z: -400 }).text.includes("Windward"), "objective skips Windward until a bow is held");
  ok(clockScale(q, 0) === 0.5 && clockScale(b, 0) === 1 && clockScale(q, 1600) === 1, "clockScale");
  ok(guard("x", () => { throw new Error("boom"); }, 7) === 7, "guard swallows a throw");
  ok(WAYSTONES.length === 7, "7 waystones");
}

// Playtest #1: the Glade beacon is the prologue beacon, not one of the four. Lighting it keeps beacons [0..3] cold,
// the objective reads 0/4, and a save round trip keeps both facts. Beacon index i maps to BEACON_LANDMARK[i].
{
  const st = new Mem();
  const q: QuestState = { ...newQuest(), stage: "beacons", prologue: "done", gladeLit: true };
  ok(q.beacons.every((b) => !b), "glade: beacons[0..3] stay cold after the Glade");
  const o = objectiveLines(q, false, { x: -35, z: 240 });
  ok(o.text.startsWith("Light the 4 beacons (0/4)"), `glade: objective after the Glade is 0/4 (${o.text})`);
  const src = {
    v: 2 as const, pos: { x: -35, y: 10, z: 240 }, yaw: 0, maxHp: 20, hp: 20, shards: 1, glimmers: 0, arrows: 0, hasBow: false, hasGlider: true,
    quest: q, collected: ["shard-glade"], timeOfDay: 9, playTime: 300,
    progress: { wickOil: 0, seeds: 0, powers: [], hintsSeen: [], glimmersSpent: 0 }, waystone: "",
  };
  ok(writeSaveV2(src as Parameters<typeof writeSaveV2>[0], st), "glade: save write");
  const rt = readSaveV2(st)!;
  ok(rt.quest.gladeLit === true && rt.quest.beacons.every((b) => !b), "glade: save keeps gladeLit and four cold beacons");
  ok(eq(BEACON_LANDMARK, ["beacon-cliff", "beacon-wood", "beacon-lake", "beacon-bluff"]), `glade: BEACON_LANDMARK order ${BEACON_LANDMARK.join(",")}`);
  const one = { ...q, beacons: [true, false, false, false] as [boolean, boolean, boolean, boolean] };
  ok(objectiveLines(one, false, { x: 0, z: 0 }).text.startsWith("Light the 4 beacons (1/4)"), "glade: Cliffwatch lit reads 1/4");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
