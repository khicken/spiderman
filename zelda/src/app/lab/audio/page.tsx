"use client";
// Audio lab: start audio, switch game states, fire every SFX, and run an offline level check.
import { useEffect, useRef, useState } from "react";
import type { EnemyKind, FrameCtx, GameEvent, Surface, V3 } from "../../contracts";
import { createAudio, type AudioPlus } from "../../audio";

const P: V3 = { x: 3, y: 0, z: 1 };
const SURF: Surface[] = ["grass", "dirt", "rock", "sand", "stone", "wood", "water", "ash"];
const KINDS: EnemyKind[] = ["brambling", "mossback", "wisp", "warden"];
type HitKind = Extract<GameEvent, { type: "hit" }>["kind"];
const hit = (kind: HitKind, o: { team?: "player" | "enemy"; blocked?: boolean; parried?: boolean } = {}): GameEvent => ({
  type: "hit", team: o.team ?? "player", target: 1, source: -1, damage: 3, pos: P, dir: { x: 1, y: 0, z: 0 }, kind, blocked: !!o.blocked, parried: !!o.parried, knockback: 1,
});

const SFX: [string, GameEvent][] = [
  ...SURF.map((s, i): [string, GameEvent] => ["step " + s, { type: "footstep", pos: P, surface: s, run: i % 2 === 0 }]),
  ["jump", { type: "jump", pos: P }],
  ["land soft", { type: "land", pos: P, speed: 6, surface: "grass" }],
  ["land hard", { type: "land", pos: P, speed: 18, surface: "stone" }],
  ["fall damage", { type: "fallDamage", amount: 4 }],
  ["climb", { type: "climb", on: true }],
  ["glide on", { type: "glide", on: true }],
  ["glide off", { type: "glide", on: false }],
  ["swim on", { type: "swim", on: true }],
  ["splash small", { type: "splash", pos: P, size: 0.3 }],
  ["splash big", { type: "splash", pos: P, size: 1 }],
  ["stamina out", { type: "staminaOut" }],
  ["dodge", { type: "dodge", pos: P }],
  ["push on", { type: "push", on: true }],
  ["push off", { type: "push", on: false }],
  ["block move", { type: "blockMove", id: "b", pos: P }],
  ["plate on", { type: "plate", id: "p", on: true }],
  ["plate off", { type: "plate", id: "p", on: false }],
  ["swing 1", { type: "swing", pos: P, combo: 1 }],
  ["swing 2", { type: "swing", pos: P, combo: 2 }],
  ["swing 3", { type: "swing", pos: P, combo: 3 }],
  ["charge ready", { type: "chargeReady" }],
  ["spin", { type: "spin", pos: P }],
  ["shield up", { type: "shield", on: true }],
  ["shield down", { type: "shield", on: false }],
  ["bow draw", { type: "bowDraw" }],
  ["arrow fired", { type: "arrowFired", pos: P, dir: { x: 1, y: 0, z: 0 } }],
  ["lock on", { type: "lock", id: 1 }],
  ["lock off", { type: "lock", id: -1 }],
  ["hit sword", hit("sword")],
  ["hit riposte", hit("riposte")],
  ["hit blocked", hit("claw", { team: "enemy", blocked: true })],
  ["hit parried", hit("claw", { team: "enemy", parried: true })],
  ["hit claw", hit("claw", { team: "enemy" })],
  ["hit slam", hit("slam", { team: "enemy" })],
  ["hit warden", hit("warden", { team: "enemy" })],
  ["hit bolt", hit("bolt", { team: "enemy" })],
  ["arrow hit enemy", { type: "arrowHit", pos: P, on: "enemy" }],
  ["arrow hit prop", { type: "arrowHit", pos: P, on: "prop" }],
  ["arrow hit ground", { type: "arrowHit", pos: P, on: "ground" }],
  ["arrow hit water", { type: "arrowHit", pos: P, on: "water" }],
  ["prop hit", { type: "propHit", id: "x", pos: P, by: "sword" }],
  ["hurt", { type: "hurt", amount: 2, hp: 10, pos: P }],
  ["heal", { type: "heal", amount: 4, hp: 14 }],
  ["died", { type: "died", pos: P }],
  ["respawned", { type: "respawned", pos: P }],
  ["drowned", { type: "drowned", pos: P }],
  ...KINDS.flatMap((k): [string, GameEvent][] => [
    [k + " alert", { type: "enemyAlert", id: 1, kind: k, pos: P }],
    [k + " windup", { type: "enemyWindup", id: 1, kind: k, pos: P }],
    [k + " hurt", { type: "enemyHurt", id: 1, kind: k, pos: P, hp: 3 }],
    [k + " died", { type: "enemyDied", id: 1, kind: k, pos: P, group: "g" }],
  ]),
  ["boss wake", { type: "bossWake", pos: P }],
  ["boss phase 2", { type: "bossPhase", phase: 2 }],
  ["boss defeated", { type: "bossDefeated", pos: P }],
  ["glimmer", { type: "pickup", kind: "glimmer", amount: 1, pos: P, id: "g" }],
  ["shard", { type: "pickup", kind: "shard", amount: 1, pos: P, id: "s" }],
  ["heart", { type: "pickup", kind: "heart", amount: 1, pos: P, id: "h" }],
  ["arrows", { type: "pickup", kind: "arrows", amount: 5, pos: P, id: "a" }],
  ["bow", { type: "pickup", kind: "bow", amount: 1, pos: P, id: "b" }],
  ["glider", { type: "pickup", kind: "glider", amount: 1, pos: P, id: "gl" }],
  ["area first", { type: "areaEnter", id: "village", name: "Mirebrook Ruin", first: true }],
  ["area again", { type: "areaEnter", id: "village", name: "Mirebrook Ruin", first: false }],
  ["trial start", { type: "trialStart", beacon: 1 }],
  ["trial progress", { type: "trialProgress", beacon: 1, value: 2, total: 4 }],
  ["trial fail", { type: "trialFail", beacon: 1 }],
  ["trial done", { type: "trialDone", beacon: 1 }],
  ["beacon lit", { type: "beaconLit", beacon: 0, pos: { x: 60, y: 30, z: 20 } }],
  ["barrier down", { type: "barrierDown" }],
  ["rest", { type: "rest", pos: P }],
  ["read", { type: "read", title: "t", text: "x" }],
  ["saved", { type: "saved" }],
  ["thunder", { type: "thunder", pos: { x: 120, y: 80, z: -40 }, delay: 0.3 }],
  ["dawn", { type: "dawn" }],
  ["dusk", { type: "dusk" }],
  ["ending", { type: "ending" }],
];
const UI_CUES = ["move", "ok", "back", "open", "close", "error"] as const;

interface Scenario { label: string; boss: number; combat: boolean; daylight: number; menu: boolean; trial: boolean; ending: boolean }
const SCENARIOS: Scenario[] = [
  { label: "day", boss: 0, combat: false, daylight: 1, menu: false, trial: false, ending: false },
  { label: "night", boss: 0, combat: false, daylight: 0, menu: false, trial: false, ending: false },
  { label: "combat", boss: 0, combat: true, daylight: 1, menu: false, trial: false, ending: false },
  { label: "boss 1", boss: 1, combat: false, daylight: 1, menu: false, trial: false, ending: false },
  { label: "boss 2", boss: 2, combat: false, daylight: 1, menu: false, trial: false, ending: false },
  { label: "boss 3", boss: 3, combat: false, daylight: 1, menu: false, trial: false, ending: false },
  { label: "trial", boss: 0, combat: false, daylight: 1, menu: false, trial: true, ending: false },
  { label: "menu", boss: 0, combat: false, daylight: 1, menu: true, trial: false, ending: false },
  { label: "ending", boss: 0, combat: false, daylight: 1, menu: false, trial: false, ending: true },
];

interface Sliders { daylight: number; rain: number; wind: number; alt: number; waterDist: number; waterKind: number; hp: number }
interface Row { name: string; peak: number; rms: number; clipped: number; silent: boolean }

const IDENT = new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0));

function fakeCtx(s: Sliders, sc: Scenario, time: number): FrameCtx {
  const level = [0, 34, 5][s.waterKind];
  const enemies = [] as unknown[];
  if (sc.combat) enemies.push({ alive: true, kind: "brambling", brain: "chase", pos: { x: 8, y: 0, z: 0 }, phase: 1 });
  if (sc.boss) enemies.push({ alive: true, kind: "warden", brain: "attack", pos: { x: 20, y: 0, z: 0 }, phase: sc.boss });
  return {
    dt: 0.033, realDt: 0.033, time,
    world: { areaAt: () => null, waterAt: (x: number) => (x > 0 ? level : -Infinity) },
    player: { pos: { x: -s.waterDist, y: s.alt * 200, z: 0 }, mode: "ground", hp: s.hp, maxHp: 20, action: "none", charge: 0 },
    enemies,
    env: { daylight: s.daylight, rain: s.rain, wind: { x: s.wind * 14, y: 0 }, wet: s.rain },
    camera: { matrixWorld: { elements: IDENT } },
  } as unknown as FrameCtx;
}

async function renderSnippet(name: string, sec: number, setup: (a: AudioPlus, ac: OfflineAudioContext) => void): Promise<Row> {
  const sr = 44100;
  const oac = new OfflineAudioContext(2, Math.floor(sr * sec), sr);
  const a = createAudio(oac as unknown as AudioContext, { manual: true, seed: 11 });
  setup(a, oac);
  const buf = await oac.startRendering();
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      if (v >= 0.999) clipped++;
      sum += v * v;
      n++;
    }
  }
  a.dispose();
  const rms = Math.sqrt(sum / n);
  return { name, peak, rms, clipped, silent: peak < 1e-4 };
}

async function selfTest(): Promise<Row[]> {
  const rows: Row[] = [];
  const base: Sliders = { daylight: 1, rain: 0, wind: 0.2, alt: 0, waterDist: 99, waterKind: 0, hp: 20 };
  for (const sc of SCENARIOS) {
    rows.push(
      await renderSnippet("layer " + sc.label, sc.label === "day" || sc.label === "menu" || sc.label === "ending" ? 36 : 20, (a) => {
        const m = a.lab!.music;
        m.state.menu = sc.menu; m.state.ending = sc.ending; m.state.boss = sc.boss; m.state.combat = sc.combat;
        m.state.trial = sc.trial; m.state.night = sc.daylight < 0.3;
        a.lab!.pump(sc.label === "day" || sc.label === "menu" || sc.label === "ending" ? 36 : 20);
      }),
    );
  }
  for (const [name, e] of SFX) {
    rows.push(await renderSnippet("sfx " + name, 3.5, (a) => a.handle([e])));
  }
  for (const c of UI_CUES) rows.push(await renderSnippet("ui " + c, 1, (a) => a.ui(c)));
  const amb: [string, Partial<Sliders>][] = [
    ["amb wind high", { wind: 0.9, alt: 0.9 }],
    ["amb rain", { rain: 1 }],
    ["amb night", { daylight: 0 }],
    ["amb sea", { waterDist: 3, waterKind: 0 }],
    ["amb river", { waterDist: 3, waterKind: 2 }],
    ["amb day", { daylight: 1 }],
  ];
  for (const [name, o] of amb) {
    rows.push(
      await renderSnippet(name, 8, (a) => {
        const ctx = fakeCtx({ ...base, ...o }, SCENARIOS[0], 0);
        for (let i = 0; i < 40; i++) a.update(ctx);
        a.lab!.amb.set({ daylight: ctx.env.daylight, rain: ctx.env.rain, wind: ctx.env.wind.x / 14, altitude: ctx.player.pos.y / 200, gliding: false, water: o.waterDist ? 0.9 : 0, waterKind: (o.waterKind ?? 0) as 0 | 1 | 2, waterPan: 0, birdy: 1 }, 0, 0.1);
      }),
    );
  }
  rows.push(await renderSnippet("heartbeat", 4, (a) => a.lab!.sfx.update(0, { hp: 2, maxHp: 20, charging: 0, wet: 0 })));
  return rows;
}

export default function AudioLab() {
  const audioRef = useRef<AudioPlus | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const sliders = useRef<Sliders>({ daylight: 1, rain: 0, wind: 0.2, alt: 0, waterDist: 99, waterKind: 0, hp: 20 });
  const scenario = useRef<Scenario>(SCENARIOS[0]);
  const [started, setStarted] = useState(false);
  const [sc, setSc] = useState("day");
  const [sl, setSl] = useState<Sliders>(sliders.current);
  const [counts, setCounts] = useState({ osc: 0, buf: 0 });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const counters = useRef({ osc: 0, buf: 0 });

  useEffect(() => {
    const os = OscillatorNode.prototype.start;
    const bs = AudioBufferSourceNode.prototype.start;
    OscillatorNode.prototype.start = function (this: OscillatorNode, ...a: [number?]) {
      counters.current.osc++;
      return os.apply(this, a);
    };
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: [number?, number?, number?]) {
      counters.current.buf++;
      return bs.apply(this, a);
    };
    const w = window as unknown as Record<string, unknown>;
    w.__audioLab = {
      counters: counters.current,
      get audio() { return audioRef.current; },
      get ac() { return acRef.current; },
      selfTest,
      setScenario: (label: string) => { const s = SCENARIOS.find((x) => x.label === label); if (s) scenario.current = s; },
      fire: (name: string) => { const e = SFX.find((x) => x[0] === name); if (e) audioRef.current?.handle([e[1]]); },
      sfxNames: SFX.map((x) => x[0]),
    };
    const iv = setInterval(() => setCounts({ osc: counters.current.osc, buf: counters.current.buf }), 500);
    return () => {
      clearInterval(iv);
      OscillatorNode.prototype.start = os;
      AudioBufferSourceNode.prototype.start = bs;
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    let t = 0;
    const iv = setInterval(() => {
      t += 0.033;
      const a = audioRef.current;
      if (!a) return;
      const s = scenario.current;
      a.menuMusic(s.menu);
      a.update(fakeCtx({ ...sliders.current, daylight: s.daylight < 1 && sliders.current.daylight === 1 ? s.daylight : sliders.current.daylight }, s, t));
    }, 33);
    return () => clearInterval(iv);
  }, [started]);

  const start = () => {
    try {
      const ac = new AudioContext();
      acRef.current = ac;
      audioRef.current = createAudio(ac);
      setStarted(true);
    } catch (e) {
      setErr(String(e));
    }
  };
  const pick = (s: Scenario) => {
    scenario.current = s;
    setSc(s.label);
    const a = audioRef.current;
    if (a?.lab) {
      a.lab.music.state.ending = s.ending;
      a.lab.music.state.trial = s.trial;
    }
  };
  const setS = (k: keyof Sliders, v: number) => {
    sliders.current = { ...sliders.current, [k]: v };
    setSl(sliders.current);
  };
  const runTest = async () => {
    setRows(null);
    const r = await selfTest();
    (window as unknown as Record<string, unknown>).__audioReport = r;
    setRows(r);
  };

  const btn = "m-0.5 rounded border border-neutral-500 px-2 py-1 text-xs hover:bg-neutral-700";
  return (
    <main className="min-h-screen bg-neutral-900 p-4 text-neutral-100">
      <h1 className="mb-2 text-lg">Hollowmere audio lab</h1>
      <button className={btn} data-testid="start" onClick={start} disabled={started}>Start audio</button>
      <span data-testid="counts" className="ml-3 text-xs">osc starts {counts.osc} / buffer starts {counts.buf}</span>
      {err && <span data-testid="err" className="ml-3 text-red-400">{err}</span>}
      <h2 className="mt-3 text-sm">State (layer)</h2>
      {SCENARIOS.map((s) => (
        <button key={s.label} className={btn + (sc === s.label ? " bg-neutral-600" : "")} onClick={() => pick(s)}>{s.label}</button>
      ))}
      <div className="mt-2 grid max-w-md gap-1 text-xs">
        {(["daylight", "rain", "wind", "alt"] as const).map((k) => (
          <label key={k}>{k} {sl[k].toFixed(2)} <input type="range" min={0} max={1} step={0.01} value={sl[k]} onChange={(e) => setS(k, +e.target.value)} /></label>
        ))}
        <label>water distance {sl.waterDist} <input type="range" min={0} max={99} step={1} value={sl.waterDist} onChange={(e) => setS("waterDist", +e.target.value)} /></label>
        <label>water kind {["sea", "lake", "river"][sl.waterKind]} <input type="range" min={0} max={2} step={1} value={sl.waterKind} onChange={(e) => setS("waterKind", +e.target.value)} /></label>
        <label>hp {sl.hp} <input type="range" min={1} max={20} step={1} value={sl.hp} onChange={(e) => setS("hp", +e.target.value)} /></label>
      </div>
      <h2 className="mt-3 text-sm">Volumes</h2>
      <div className="grid max-w-md gap-1 text-xs">
        {(["master", "music", "sfx"] as const).map((k) => (
          <label key={k}>{k} <input type="range" min={0} max={1} step={0.05} defaultValue={1} onChange={(e) => {
            const v = +e.target.value;
            const cur = (window as unknown as { __vol?: number[] }).__vol ?? [1, 1, 1];
            cur[["master", "music", "sfx"].indexOf(k)] = v;
            (window as unknown as { __vol?: number[] }).__vol = cur;
            audioRef.current?.setVolumes(cur[0], cur[1], cur[2]);
          }} /></label>
        ))}
        <div>
          <button className={btn} onClick={() => audioRef.current?.suspend(true)}>suspend</button>
          <button className={btn} onClick={() => audioRef.current?.suspend(false)}>resume</button>
        </div>
      </div>
      <h2 className="mt-3 text-sm">UI cues</h2>
      {UI_CUES.map((c) => <button key={c} className={btn} onClick={() => audioRef.current?.ui(c)}>{c}</button>)}
      <h2 className="mt-3 text-sm">SFX (every GameEvent that makes sound)</h2>
      <div>{SFX.map(([n, e]) => <button key={n} className={btn} onClick={() => audioRef.current?.handle([e])}>{n}</button>)}</div>
      <h2 className="mt-3 text-sm">Offline level check</h2>
      <button className={btn} data-testid="selftest" onClick={runTest}>Run</button>
      {rows && (
        <table data-testid="report" className="mt-2 text-xs">
          <thead><tr><th className="pr-3 text-left">name</th><th className="pr-3">peak</th><th className="pr-3">rms</th><th>clipped</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.silent || r.clipped ? "text-red-400" : ""}>
                <td className="pr-3">{r.name}</td><td className="pr-3">{r.peak.toFixed(3)}</td><td className="pr-3">{r.rms.toFixed(4)}</td><td>{r.clipped}{r.silent ? " SILENT" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
