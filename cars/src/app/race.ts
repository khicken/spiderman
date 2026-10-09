import type { GameEvent, Mode, Race, Standing, Track, TrackFrame, VehicleState } from "./contracts";
import * as THREE from "three";

export const DNF_AFTER = 30; // s after the winner
const MAX_JUMP = 30; // m of s per update, more is a reset, a rewind or a cut
const WRONG_SPEED = 3;
const WRONG_TIME = 2;
const GATE_SLACK = 4; // m past the barrier line

export type RaceStanding = Standing & { dnf: boolean };
export interface RacePlus extends Race {
  standings(): readonly RaceStanding[];
  readonly lapStart: (id: string) => number; // race clock
  readonly lastLap: (id: string) => number;
  readonly splits: (id: string) => readonly number[];
  readonly dnfAt: number | null; // race clock when the rest get DNF
}

type Car = {
  st: RaceStanding;
  s: number;
  has: boolean;
  started: boolean;
  next: number;
  lap: number; // completed
  lapStart: number;
  last: number;
  best: number;
  splits: number[];
  bestSplits: number[] | null;
  marks: number[]; // race clock at each gate pass, for gaps
  wrong: number;
  lapDist: number;
};

export function createRace(track: Track, mode: Mode, laps: number, ids: readonly string[], me?: string): RacePlus {
  const L = track.length;
  const closed = track.closed;
  const totalLaps = !closed ? 1 : mode === "free" ? Infinity : Math.max(1, laps);
  const gates = closed ? [...track.checkpoints] : [...track.checkpoints, Math.max(0, L - 2)];
  const start = track.checkpoints[0] ?? 0;
  const ng = gates.length;
  const fr: TrackFrame = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), left: new THREE.Vector3(), up: new THREE.Vector3(), width: 0, runoff: 0 };
  const events: GameEvent[] = [];

  const cars = new Map<string, Car>();
  const list: RaceStanding[] = [];
  for (const id of ids) {
    const c: Car = {
      st: { id, place: 0, lap: 1, progress: 0, finished: false, time: 0, best: 0, gap: 0, dnf: false },
      s: 0, has: false, started: false, next: 0, lap: 0, lapStart: 0, last: 0, best: 0,
      splits: new Array(ng).fill(0), bestSplits: null, marks: [], wrong: 0, lapDist: 0,
    };
    cars.set(id, c);
    list.push(c.st);
  }

  let at: number | null = null;
  let phase: Race["phase"] = "grid";
  let clock = 0;
  let countdown = -1;
  let lastBeep = 4;
  let finishers = 0;
  let dnfAt: number | null = null;

  const sfx = (id: string, name: "lap" | "best" | "finish" | "checkpoint") => { if (id === me) events.push({ type: "sfx", name }); };

  function crossGate(id: string, c: Car, g: number) {
    if (g !== c.next) return;
    if (g === 0 && !c.started) {
      c.started = true;
      c.next = 1 % ng;
      c.lapStart = clock;
      return;
    }
    c.next = (g + 1) % ng;
    c.marks.push(clock);
    const split = clock - c.lapStart;
    const lapDone = closed ? g === 0 : g === ng - 1;
    if (!lapDone) {
      c.splits[g] = split;
      const delta = c.bestSplits ? split - c.bestSplits[g] : null;
      events.push({ type: "checkpoint", id, split, delta });
      sfx(id, "checkpoint");
      return;
    }
    c.lap++;
    c.last = split;
    const best = c.best === 0 || split < c.best;
    if (best) {
      c.best = split;
      c.bestSplits = c.splits.slice();
    }
    c.lapStart = clock;
    events.push({ type: "lap", id, lap: c.lap, time: split, best });
    if (c.lap >= totalLaps) finish(id, c);
    else sfx(id, best && c.lap > 1 ? "best" : "lap");
  }

  function finish(id: string, c: Car) {
    c.st.finished = true;
    c.st.time = clock;
    finishers++;
    c.st.place = finishers;
    if (dnfAt === null && mode === "race") dnfAt = clock + DNF_AFTER;
    events.push({ type: "finish", id, place: finishers, time: clock });
    sfx(id, "finish");
  }

  function track1(id: string, c: Car, v: VehicleState) {
    if (c.st.finished) return;
    if (!c.has) {
      c.s = v.s;
      c.has = true;
      const ahead = track.delta(start, v.s);
      if (ahead >= 0 && ahead < MAX_JUMP) {
        c.started = true;
        c.next = 1 % ng;
      }
      return;
    }
    const d = track.delta(c.s, v.s);
    const prev = c.s;
    c.s = v.s;
    track.frame(v.s, fr);
    const along = v.vel.x * fr.fwd.x + v.vel.y * fr.fwd.y + v.vel.z * fr.fwd.z;
    c.wrong = along < -WRONG_SPEED ? c.wrong + dtLast : 0;
    if (Math.abs(d) > MAX_JUMP || d === 0) return;
    const inside = Math.abs(v.lateral) <= fr.width / 2 + fr.runoff + GATE_SLACK;
    if (d > 0) {
      const g = c.next;
      const a = track.delta(prev, gates[g]);
      if (a > 0 && a <= d && inside) crossGate(id, c, g);
    } else if (c.started) {
      const g = (c.next - 1 + ng) % ng;
      const a = track.delta(prev, gates[g]);
      if (g !== 0 && a < 0 && a >= d) c.next = g; // backed over a gate: pass it again
    }
  }

  let dtLast = 0;
  let lastNow = 0;

  function update(now: number, states: ReadonlyMap<string, VehicleState>): GameEvent[] {
    events.length = 0;
    dtLast = lastNow ? Math.min(0.1, Math.max(0, (now - lastNow) / 1000)) : 0;
    lastNow = now;
    if (at === null) return events;
    const t = (now - at) / 1000;
    if (t < 0) {
      phase = t < -3 ? "grid" : "countdown";
      countdown = t < -3 ? -1 : Math.ceil(-t);
      if (phase === "countdown" && countdown < lastBeep) {
        lastBeep = countdown;
        events.push({ type: "sfx", name: "beep" });
      }
      clock = 0;
      for (const [id, v] of states) { const c = cars.get(id); if (c) { c.s = v.s; c.has = false; } }
      rank();
      return events;
    }
    if (phase === "grid" || phase === "countdown") {
      phase = "racing";
      lastBeep = 0;
      events.push({ type: "sfx", name: "go" });
    }
    countdown = t < 1 ? 0 : -1;
    if (phase === "done") return events;
    clock = t;
    for (const [id, v] of states) {
      const c = cars.get(id);
      if (c) track1(id, c, v);
    }
    if (dnfAt !== null && clock >= dnfAt) {
      for (const c of cars.values()) if (!c.st.finished) { c.st.finished = true; c.st.dnf = true; c.st.time = clock; }
    }
    rank();
    if (mode !== "free" && list.length && list.every((s) => s.finished)) phase = "done";
    return events;
  }

  const lapLen = closed ? L : Math.max(1, L - start);
  function lapDist(c: Car) {
    const x = track.delta(start, c.s);
    if (!c.started || !closed) return x;
    return x < 0 ? x + L : x;
  }

  function rank() {
    for (const c of cars.values()) {
      const s = c.st;
      c.lapDist = lapDist(c);
      if (!s.finished) {
        s.lap = Math.min(c.lap + 1, totalLaps === Infinity ? c.lap + 1 : totalLaps);
        s.time = clock;
      }
      s.progress = Math.min(1, Math.max(0, c.lapDist / lapLen));
      s.best = c.best;
    }
    list.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : a.dnf ? score(b) - score(a) : a.time - b.time;
      return score(b) - score(a);
    });
    const leader = list[0] ? cars.get(list[0].id) : undefined;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s.place = i + 1;
      const c = cars.get(s.id)!;
      if (i === 0 || !leader) { s.gap = 0; continue; }
      const k = c.marks.length - 1;
      s.gap = k >= 0 && leader.marks[k] !== undefined ? c.marks[k] - leader.marks[k] : 0;
      if (s.finished && list[0].finished && !s.dnf) s.gap = s.time - list[0].time;
    }
  }

  function score(s: Standing) {
    const c = cars.get(s.id)!;
    return c.lap * L + c.lapDist;
  }

  return {
    get phase() { return phase; },
    get clock() { return clock; },
    get countdown() { return countdown; },
    get dnfAt() { return dnfAt; },
    start(t: number) {
      at = t;
      phase = "grid";
      lastBeep = 4;
      finishers = 0;
      dnfAt = null;
      for (const c of cars.values()) {
        Object.assign(c.st, { place: 0, lap: 1, progress: 0, finished: false, time: 0, best: 0, gap: 0, dnf: false });
        Object.assign(c, { has: false, started: false, next: 0, lap: 0, lapStart: 0, last: 0, best: 0, bestSplits: null, marks: [], wrong: 0 });
      }
    },
    update,
    standings: () => list,
    wrongWay: (id: string) => (cars.get(id)?.wrong ?? 0) > WRONG_TIME,
    lapStart: (id: string) => cars.get(id)?.lapStart ?? 0,
    lastLap: (id: string) => cars.get(id)?.last ?? 0,
    splits: (id: string) => cars.get(id)?.splits ?? [],
  };
}
