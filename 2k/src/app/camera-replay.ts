import type { Action, BallMode, BallState, DunkStyle, PlayerState, SimView, TeamSide } from "./contracts";
import { ACTION_DUR } from "./contracts";

// Instant replay: a ring buffer of the last few seconds of the live SimView (players + ball), and a SimView that
// plays it back with interpolation. The camera owns one; game.ts poses players from `view` while a replay runs.
// Owner: input-camera. No allocations per frame after the first record of a match.

const ACTIONS = Object.keys(ACTION_DUR) as Action[];
const ACTION_ID = new Map<Action, number>(ACTIONS.map((a, i) => [a, i]));
const MODES: BallMode[] = ["held", "dribble", "pass", "shot", "loose", "dead"];
const MODE_ID = new Map<BallMode, number>(MODES.map((m, i) => [m, i]));
const DUNKS: (DunkStyle | null)[] = [null, "oneHand", "twoHand", "tomahawk", "windmill", "reverse", "cuff", "putback"];
const DUNK_ID = new Map<DunkStyle | null, number>(DUNKS.map((d, i) => [d, i]));

// per player floats
const P_POS = 0, P_VEL = 3, P_FACE = 6, P_TURN = 7, P_ACT = 8, P_AT = 9, P_ADUR = 10, P_AP = 11, P_SIDE = 12, P_VAR = 13,
  P_DUNK = 14, P_CROUCH = 15, P_HANDS = 16, P_LOOK = 17, P_BALL = 20, P_USER = 21, P_STAM = 22, P_FIRE = 23, P_STUN = 24;
const PF = 25;
// ball floats
const B_POS = 0, B_VEL = 3, B_SPIN = 6, B_MODE = 9, B_HOLD = 10, B_HAND = 11, B_PHASE = 12, B_NET = 13, B_SIDE = 14;
const BF = 15;
const FRAME = 10 * PF + BF;

export interface Replay {
  /** Record the live view (call once per rendered frame while the sim runs). */
  record(view: SimView): void;
  /** Recorded span available, in sim seconds. */
  span(): [number, number];
  /** Start playback of [from, to] (sim time). Returns false if the buffer does not cover it. */
  start(from: number, to: number): boolean;
  /** Advance playback by `simDt` seconds of recorded time. Returns false when it reached the end. */
  advance(simDt: number): boolean;
  readonly active: boolean;
  readonly t: number; // current playback time (sim seconds)
  readonly view: SimView | null; // non-null while active
  stop(): void;
  reset(): void;
}

export function createReplay(capacity = 720): Replay {
  const data = new Float32Array(capacity * FRAME);
  const times = new Float64Array(capacity);
  let head = 0; // next write
  let count = 0;
  let src: SimView | null = null;
  let active = false;
  let t = 0;
  let end = 0;
  let cursor = 0; // ring index of the frame at or before t
  let rplayers: PlayerState[] = [];
  let rball: BallState | null = null;
  let rview: SimView | null = null;

  const idx = (k: number) => (head - count + k + capacity * 2) % capacity; // k = 0 oldest

  function build(live: SimView) {
    rplayers = live.players.map((p) => ({
      ...p,
      pos: p.pos.clone(), vel: p.vel.clone(), lookAt: p.lookAt.clone(),
      meter: { ...p.meter, active: false, grade: "none" as const, shownT: 99 },
    }));
    const b = live.ball;
    rball = { ...b, pos: b.pos.clone(), vel: b.vel.clone(), spin: b.spin.clone(), shot: null, pass: null };
    const players = rplayers;
    const ball = rball;
    rview = {
      get state() {
        return live.state;
      },
      ball,
      players,
      get teams() {
        return live.teams;
      },
      get userTeam() {
        return live.userTeam;
      },
      userSlot: -1,
      get time() {
        return t;
      },
      get difficulty() {
        return live.difficulty;
      },
      get mode() {
        return live.mode;
      },
      dir: (team: TeamSide) => live.dir(team),
      shotChance: () => 0,
      mates: (slot: number, out: number[]) => live.mates(slot, out),
    };
  }

  function record(view: SimView) {
    if (view !== src) {
      src = view;
      head = count = 0;
      active = false;
      build(view);
    }
    const now = view.time;
    if (count > 0 && now <= times[(head - 1 + capacity) % capacity] + 1e-6) return;
    const o = head * FRAME;
    for (let s = 0; s < 10; s++) {
      const p = view.players[s];
      const b = o + s * PF;
      data[b + P_POS] = p.pos.x; data[b + P_POS + 1] = p.pos.y; data[b + P_POS + 2] = p.pos.z;
      data[b + P_VEL] = p.vel.x; data[b + P_VEL + 1] = p.vel.y; data[b + P_VEL + 2] = p.vel.z;
      data[b + P_FACE] = p.facing; data[b + P_TURN] = p.turnRate;
      data[b + P_ACT] = ACTION_ID.get(p.action) ?? 0; data[b + P_AT] = p.actionT; data[b + P_ADUR] = p.actionDur;
      data[b + P_AP] = p.actionP; data[b + P_SIDE] = p.actionSide; data[b + P_VAR] = p.variant;
      data[b + P_DUNK] = DUNK_ID.get(p.dunkStyle) ?? 0; data[b + P_CROUCH] = p.crouch; data[b + P_HANDS] = p.handsUp;
      data[b + P_LOOK] = p.lookAt.x; data[b + P_LOOK + 1] = p.lookAt.y; data[b + P_LOOK + 2] = p.lookAt.z;
      data[b + P_BALL] = p.hasBall ? 1 : 0; data[b + P_USER] = p.user ? 1 : 0; data[b + P_STAM] = p.stamina;
      data[b + P_FIRE] = p.onFire; data[b + P_STUN] = p.stunned;
    }
    const bb = o + 10 * PF;
    const ball = view.ball;
    data[bb + B_POS] = ball.pos.x; data[bb + B_POS + 1] = ball.pos.y; data[bb + B_POS + 2] = ball.pos.z;
    data[bb + B_VEL] = ball.vel.x; data[bb + B_VEL + 1] = ball.vel.y; data[bb + B_VEL + 2] = ball.vel.z;
    data[bb + B_SPIN] = ball.spin.x; data[bb + B_SPIN + 1] = ball.spin.y; data[bb + B_SPIN + 2] = ball.spin.z;
    data[bb + B_MODE] = MODE_ID.get(ball.mode) ?? 0; data[bb + B_HOLD] = ball.holder; data[bb + B_HAND] = ball.dribbleHand;
    data[bb + B_PHASE] = ball.dribblePhase; data[bb + B_NET] = ball.inNet; data[bb + B_SIDE] = ball.side;
    times[head] = now;
    head = (head + 1) % capacity;
    if (count < capacity) count++;
  }

  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  const lerpCycle = (a: number, b: number, k: number) => (Math.abs(b - a) > 0.5 ? (k < 0.5 ? a : b) : lerp(a, b, k));

  function apply() {
    if (!rball) return;
    // find frames a (<= t) and b (> t), moving the cursor forward
    while (cursor < count - 1 && times[idx(cursor + 1)] <= t) cursor++;
    const ia = idx(cursor);
    const ib = idx(Math.min(count - 1, cursor + 1));
    const ta = times[ia];
    const tb = times[ib];
    const k = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    const oa = ia * FRAME;
    const ob = ib * FRAME;
    const near = k < 0.5 ? oa : ob;
    for (let s = 0; s < 10; s++) {
      const p = rplayers[s];
      const a = oa + s * PF;
      const b = ob + s * PF;
      const n = near + s * PF;
      p.pos.set(lerp(data[a], data[b], k), lerp(data[a + 1], data[b + 1], k), lerp(data[a + 2], data[b + 2], k));
      p.vel.set(lerp(data[a + P_VEL], data[b + P_VEL], k), lerp(data[a + P_VEL + 1], data[b + P_VEL + 1], k), lerp(data[a + P_VEL + 2], data[b + P_VEL + 2], k));
      p.facing = lerpAngle(data[a + P_FACE], data[b + P_FACE], k);
      p.turnRate = lerp(data[a + P_TURN], data[b + P_TURN], k);
      const actA = data[a + P_ACT];
      const same = actA === data[b + P_ACT];
      p.action = ACTIONS[data[n + P_ACT]] ?? "idle";
      p.actionT = same ? lerp(data[a + P_AT], data[b + P_AT], k) : data[n + P_AT];
      p.actionDur = data[n + P_ADUR];
      p.actionP = same ? lerpCycle(data[a + P_AP], data[b + P_AP], k) : data[n + P_AP];
      p.actionSide = data[n + P_SIDE] < 0 ? -1 : 1;
      p.variant = data[n + P_VAR];
      p.dunkStyle = DUNKS[data[n + P_DUNK]] ?? null;
      p.crouch = lerp(data[a + P_CROUCH], data[b + P_CROUCH], k);
      p.handsUp = lerp(data[a + P_HANDS], data[b + P_HANDS], k);
      p.lookAt.set(lerp(data[a + P_LOOK], data[b + P_LOOK], k), lerp(data[a + P_LOOK + 1], data[b + P_LOOK + 1], k), lerp(data[a + P_LOOK + 2], data[b + P_LOOK + 2], k));
      p.hasBall = data[n + P_BALL] > 0.5;
      p.user = false;
      p.stamina = data[n + P_STAM];
      p.onFire = data[n + P_FIRE];
      p.stunned = data[n + P_STUN];
      if (src) {
        const live = src.players[s];
        p.data = live.data;
        p.rosterIndex = live.rosterIndex;
        p.height = live.height;
        p.reach = live.reach;
        p.radius = live.radius;
      }
    }
    const ba = oa + 10 * PF;
    const bb = ob + 10 * PF;
    const bn = near + 10 * PF;
    const ball = rball;
    ball.pos.set(lerp(data[ba], data[bb], k), lerp(data[ba + 1], data[bb + 1], k), lerp(data[ba + 2], data[bb + 2], k));
    ball.vel.set(data[bn + B_VEL], data[bn + B_VEL + 1], data[bn + B_VEL + 2]);
    ball.spin.set(data[bn + B_SPIN], data[bn + B_SPIN + 1], data[bn + B_SPIN + 2]);
    ball.mode = MODES[data[bn + B_MODE]] ?? "loose";
    ball.holder = data[bn + B_HOLD];
    ball.dribbleHand = data[bn + B_HAND] < 0 ? -1 : 1;
    ball.dribblePhase = lerpCycle(data[ba + B_PHASE], data[bb + B_PHASE], k);
    ball.inNet = lerp(data[ba + B_NET], data[bb + B_NET], k);
    const side = data[bn + B_SIDE];
    ball.side = side > 0.5 ? 1 : side < -0.5 ? -1 : 0;
  }

  return {
    record,
    span() {
      if (count === 0) return [0, 0];
      return [times[idx(0)], times[idx(count - 1)]];
    },
    start(from, to) {
      if (count < 8 || !rview) return false;
      const a = times[idx(0)];
      const b = times[idx(count - 1)];
      const s = Math.max(from, a);
      const e = Math.min(to, b);
      if (e - s < 0.6) return false;
      t = s;
      end = e;
      cursor = 0;
      active = true;
      apply();
      return true;
    },
    advance(simDt) {
      if (!active) return false;
      t += simDt;
      if (t >= end) {
        t = end;
        apply();
        return false;
      }
      apply();
      return true;
    },
    get active() {
      return active;
    },
    get t() {
      return t;
    },
    get view() {
      return active ? rview : null;
    },
    stop() {
      active = false;
    },
    reset() {
      head = count = 0;
      active = false;
      src = null;
    },
  };
}
