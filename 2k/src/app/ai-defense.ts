import * as THREE from "three";
import type { Dir, PlayerState, TeamSide } from "./contracts";
import { COURT, DIFFICULTY, distToBasket } from "./contracts";
import type { Ctx, SlotMem, TeamBrain } from "./ai-core";
import { HALF_U, chance, clamp, dist2, isBig, keepIn, rand, rimFloor, segDist, shooter3, steer, uOf } from "./ai-core";

// HOOPS defense: man-to-man with help, switch or drop on ball screens, closeouts, contests, blocks, steals, charges,
// doubles on hot scorers and post threats, transition get-back, full-court press and intentional fouls late.

const RIM = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const segTo = [0];
const SHOT_ACTIONS = new Set(["jumpShot", "layup", "dunk", "floater", "hook"]);

/** Smooth each team's perception of the floor. Slow eyes = reaction lag on crossovers and cuts. */
export function perceive(ctx: Ctx, b: TeamBrain, dt: number): void {
  const { sim } = ctx;
  const tau = Math.max(0.02, b.reaction * 0.55);
  const k = 1 - Math.exp(-dt / tau);
  const lead = 0.08 + b.iq * 0.22; // anticipation: read where the man is going
  for (let i = 0; i < 10; i++) {
    const p = sim.players[i];
    const pp = b.perceived[i];
    const tx = p.pos.x + p.vel.x * lead;
    const tz = p.pos.z + p.vel.z * lead;
    pp.x += (tx - pp.x) * k;
    pp.z += (tz - pp.z) * k;
    pp.y = 0;
  }
  const bp = b.perceivedBall;
  bp.x += (sim.ball.pos.x - bp.x) * k;
  bp.y = sim.ball.pos.y;
  bp.z += (sim.ball.pos.z - bp.z) * k;
}

export function snapPerception(ctx: Ctx, b: TeamBrain): void {
  for (let i = 0; i < 10; i++) b.perceived[i].copy(ctx.sim.players[i].pos).setY(0);
  b.perceivedBall.copy(ctx.sim.ball.pos);
}

function defenderOf(ctx: Ctx, b: TeamBrain, man: number): number {
  for (let k = 0; k < 5; k++) if (b.marks[k] === man) return b.side * 5 + k;
  return -1;
}

/** Reset marks to the natural position matchups (slot k guards slot k). */
export function resetMarks(b: TeamBrain): void {
  for (let k = 0; k < 5; k++) b.marks[k] = (1 - b.side) * 5 + k;
}

function matchCost(def: PlayerState, man: PlayerState, b: TeamBrain): number {
  const pp = b.perceived[man.slot];
  let c = dist2(def.pos.x, def.pos.z, pp.x, pp.z);
  const dh = man.height - def.height;
  if (dh > 0.1) c += (dh - 0.1) * 14; // little guy on a big
  if (dh < -0.14) c += (-dh - 0.14) * 6 * (man.data.ratings.speed / 80); // big on a quick guard
  c += Math.max(0, man.data.ratings.overall - 80) * Math.max(0, 75 - def.data.ratings.perimeterD) * 0.01;
  return c;
}

/** Pairwise swap improvement of matchups. Transition: cheap threshold; halfcourt: only clear mismatches. */
function fixMatchups(ctx: Ctx, b: TeamBrain, transition: boolean): void {
  const { sim } = ctx;
  const thr = transition ? 1.6 : 3.8;
  const user = sim.userSlot;
  for (let a = 0; a < 5; a++) {
    const sa = b.side * 5 + a;
    if (sa === user) continue;
    for (let c = a + 1; c < 5; c++) {
      const sc = b.side * 5 + c;
      if (sc === user) continue;
      const pa = sim.players[sa];
      const pc = sim.players[sc];
      const ma = sim.players[b.marks[a]];
      const mc = sim.players[b.marks[c]];
      if (!transition) {
        // halfcourt: never scramble around the ball
        const bh = sim.state.ballHandler;
        if (bh === ma.slot || bh === mc.slot) continue;
      }
      const now = matchCost(pa, ma, b) + matchCost(pc, mc, b);
      const sw = matchCost(pa, mc, b) + matchCost(pc, ma, b);
      if (sw < now - thr) {
        const t = b.marks[a];
        b.marks[a] = b.marks[c];
        b.marks[c] = t;
      }
    }
  }
  // the human defender guards whoever he is actually on: hand his old man to the AI defender left free
  if (user >= 0 && sim.players[user].team === b.side) {
    const uk = user % 5;
    const u = sim.players[user];
    const myMan = sim.players[b.marks[uk]];
    const dMine = dist2(u.pos.x, u.pos.z, myMan.pos.x, myMan.pos.z);
    if (dMine > 3.2) {
      let best = -1;
      let bestD = 1.9;
      for (let k = 0; k < 5; k++) {
        if (k === uk) continue;
        const man = sim.players[b.marks[k]];
        const dd = dist2(u.pos.x, u.pos.z, man.pos.x, man.pos.z);
        if (dd < bestD) {
          const owner = sim.players[b.side * 5 + k];
          if (dist2(owner.pos.x, owner.pos.z, man.pos.x, man.pos.z) > dd + 0.6) {
            bestD = dd;
            best = k;
          }
        }
      }
      if (best >= 0) {
        const t = b.marks[best];
        b.marks[best] = b.marks[uk];
        b.marks[uk] = t;
      }
    }
  }
}

/** Intentional-foul decision for a trailing team late. */
export function wantsFoul(ctx: Ctx, b: TeamBrain): boolean {
  const s = ctx.sim.state;
  if (!b.cpu || s.period < 4 || !ctx.settings.fouls) return false;
  const deficit = s.score[1 - b.side] - s.score[b.side];
  if (deficit <= 0) return false;
  if (s.clock < 50 && deficit >= 4 && deficit <= 9) return true;
  if (s.clock < 28 && deficit <= 3 && s.shotClockOn && s.clock > s.shotClock + 1.5) return true;
  return false;
}

function wantsPress(ctx: Ctx, b: TeamBrain): boolean {
  const s = ctx.sim.state;
  const deficit = s.score[1 - b.side] - s.score[b.side];
  if (s.period >= 4 && s.clock < 150 && deficit >= 4 && deficit <= 16) return b.iq > 0.3;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Event reactions
// ---------------------------------------------------------------------------------------------------------------------
export function onPossession(ctx: Ctx, b: TeamBrain): void {
  const { sim } = ctx;
  b.helper = -1;
  b.doubler = -1;
  b.matchT = 0;
  // coverage: switch with a switchable lineup, else drop the big
  let hMin = 9;
  let hMax = 0;
  for (let k = 0; k < 5; k++) {
    const h = sim.players[b.side * 5 + k].height;
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h);
  }
  b.coverage = hMax - hMin < 0.16 || chance(0.25) ? "switch" : "drop";
  for (let k = 0; k < 5; k++) {
    const m = ctx.mem[b.side * 5 + k];
    m.helping = false;
    m.closeT = -1;
    m.closeActive = 0;
    m.contestT = -1;
    m.contestOn = 0;
    m.doubleT = 0;
    m.dropT = 0;
    m.gambleT = 0;
  }
}

export function onPass(ctx: Ctx, b: TeamBrain, from: number, to: number): void {
  const { sim, mem } = ctx;
  const diff = DIFFICULTY[ctx.settings.difficulty];
  const def = defenderOf(ctx, b, to);
  if (def >= 0 && def !== sim.userSlot) {
    const m = mem[def];
    const pd = sim.players[def].data.ratings.perimeterD;
    m.closeT = b.reaction * rand(0.7, 1.15) * (1.25 - pd / 200);
    m.closeActive = 1.7;
  }
  if (b.helper >= 0) {
    mem[b.helper].helping = false;
    b.helper = -1;
  }
  if (b.doubler >= 0) {
    mem[b.doubler].doubleT = 0;
    b.doubler = -1;
  }
  // jump the passing lane: a gambler near the line goes for the pick
  const pa = sim.players[from];
  const pb = sim.players[to];
  const len = dist2(pa.pos.x, pa.pos.z, pb.pos.x, pb.pos.z);
  if (len < 3.5) return;
  for (let k = 0; k < 5; k++) {
    const s = b.side * 5 + k;
    if (s === sim.userSlot) continue;
    const p = sim.players[s];
    const sd = segDist(p.pos.x, p.pos.z, pa.pos.x, pa.pos.z, pb.pos.x, pb.pos.z, segTo);
    if (sd < 1.5 && segTo[0] > 0.3 && segTo[0] < 0.88) {
      const steal = p.data.ratings.steal / 100;
      const mult = b.cpu ? diff.cpuSteal : 1;
      if (chance(steal * steal * 0.7 * mult * (0.5 + b.iq * 0.5))) {
        const m = mem[s];
        m.gambleT = 0.55;
        m.gamble.set(pa.pos.x + (pb.pos.x - pa.pos.x) * segTo[0], 0, pa.pos.z + (pb.pos.z - pa.pos.z) * segTo[0]);
      }
    }
  }
}

export function onShotStart(ctx: Ctx, b: TeamBrain, shooter: number): void {
  const { sim, mem } = ctx;
  const sh = sim.players[shooter];
  const d = sim.dir(sh.team);
  const r = distToBasket(sh.pos.x, sh.pos.z, d);
  let first = -1;
  let second = -1;
  let d1 = 1e9;
  let d2 = 1e9;
  for (let k = 0; k < 5; k++) {
    const s = b.side * 5 + k;
    if (s === sim.userSlot) continue;
    const p = sim.players[s];
    const dd = dist2(p.pos.x, p.pos.z, sh.pos.x, sh.pos.z);
    if (dd < d1) {
      second = first;
      d2 = d1;
      first = s;
      d1 = dd;
    } else if (dd < d2) {
      second = s;
      d2 = dd;
    }
  }
  const arm = (s: number, dd: number) => {
    if (s < 0 || dd > 5) return;
    const p = sim.players[s];
    const m = mem[s];
    const rt = p.data.ratings;
    const skill = r < 3 ? rt.interiorD : rt.perimeterD;
    m.contestT = b.reaction * rand(0.55, 1.0) * (1.25 - skill / 200);
    const nearRim = r < 3.2;
    const blocker = rt.block / 100;
    m.blockPlan =
      dd < (nearRim ? 2.4 : 1.7) &&
      chance(nearRim ? 0.25 + blocker * 0.65 : blocker * 0.45) &&
      chance(0.45 + b.iq * 0.55);
  };
  arm(first, d1);
  arm(second, d2);
}

export function onScreen(ctx: Ctx, b: TeamBrain, screener: number, forSlot: number): void {
  const { sim, mem } = ctx;
  const dScr = defenderOf(ctx, b, screener);
  const dHan = defenderOf(ctx, b, forSlot);
  if (dScr < 0 || dHan < 0) return;
  const hs = sim.players[dScr].height;
  const hh = sim.players[dHan].height;
  const doSwitch = b.coverage === "switch" || Math.abs(hs - hh) < 0.1 || chance(0.15);
  if (doSwitch) {
    const ks = dScr % 5;
    const kh = dHan % 5;
    const t = b.marks[ks];
    b.marks[ks] = b.marks[kh];
    b.marks[kh] = t;
  } else if (dScr !== sim.userSlot) {
    mem[dScr].dropT = 1.4 + b.iq * 0.6;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-step team defense
// ---------------------------------------------------------------------------------------------------------------------
export function defend(ctx: Ctx, t: TeamSide, dt: number): void {
  const { sim, mem } = ctx;
  const b = ctx.brains[t];
  const opp = (1 - t) as TeamSide;
  const d: Dir = sim.dir(opp);
  const diff = DIFFICULTY[ctx.settings.difficulty];
  rimFloor(d, RIM);
  const ball = sim.ball;
  const st = sim.state;
  const holder = ball.holder >= 0 && sim.players[ball.holder].team === opp ? ball.holder : -1;
  const passTo = ball.mode === "pass" && ball.pass ? ball.pass.to : -1;
  const bp = b.perceivedBall;
  const ballU = uOf(d, ball.pos.x);
  const backcourt = ballU > HALF_U + 0.2;
  b.press = b.cpu && wantsPress(ctx, b);
  b.foulMode = wantsFoul(ctx, b) && st.phase === "live";

  b.matchT -= dt;
  if (b.matchT <= 0) {
    const trans = backcourt || ballU > 9.5;
    fixMatchups(ctx, b, trans);
    b.matchT = trans ? 0.35 : 0.9;
  }

  // a new ball handler (catch): clear doubles and help
  if (holder !== b.lastHolder) {
    b.lastHolder = holder;
    if (b.helper >= 0) mem[b.helper].helping = false;
    b.helper = -1;
    if (b.doubler >= 0) mem[b.doubler].doubleT = 0;
    b.doubler = -1;
  }

  // ---- help: the driver beat his man
  if (holder >= 0) {
    const h = sim.players[holder];
    const hr = distToBasket(h.pos.x, h.pos.z, d);
    const onBall = defenderOf(ctx, b, holder);
    const ob = onBall >= 0 ? sim.players[onBall] : null;
    const obr = ob ? distToBasket(ob.pos.x, ob.pos.z, d) : 99;
    const beaten = !!ob && (obr > hr + 0.25 || dist2(ob.pos.x, ob.pos.z, h.pos.x, h.pos.z) > 2.4);
    if (b.helper < 0 && hr < 6.2 && beaten) {
      let best = -1;
      let bestC = 1e9;
      A.subVectors(RIM, h.pos).setY(0).normalize().multiplyScalar(Math.min(1.3, hr * 0.5)).add(h.pos);
      for (let k = 0; k < 5; k++) {
        const s = t * 5 + k;
        if (s === onBall || s === sim.userSlot) continue;
        const p = sim.players[s];
        const man = sim.players[b.marks[k]];
        let c = dist2(p.pos.x, p.pos.z, A.x, A.z);
        const mr = distToBasket(man.pos.x, man.pos.z, d);
        if (mr > COURT.threeR - 0.3) c += shooter3(man) * 3.2; // do not leave shooters
        if (isBig(p)) c -= 1.2;
        if (c < bestC) {
          bestC = c;
          best = s;
        }
      }
      if (best >= 0 && bestC < 6.5 && chance(0.4 + b.iq * 0.6)) {
        b.helper = best;
        mem[best].helping = true;
        mem[best].helpT = b.reaction * rand(0.6, 1.1);
      }
    } else if (b.helper >= 0 && (hr > 7.2 || !beaten && hr > 4.5)) {
      mem[b.helper].helping = false;
      b.helper = -1;
    }
    // double the post or a scorer on fire
    if (b.doubler < 0 && b.helper < 0) {
      const postThreat = h.action === "postUp" && h.data.ratings.postScoring >= 84 && hr < 4.6;
      const hot = h.onFire >= 0.85 && hr < 8.5;
      if ((postThreat || hot) && chance(dt * (0.5 + b.iq))) {
        let best = -1;
        let bestV = -1e9;
        for (let k = 0; k < 5; k++) {
          const s = t * 5 + k;
          if (s === onBall || s === sim.userSlot) continue;
          const man = sim.players[b.marks[k]];
          const dm = dist2(man.pos.x, man.pos.z, h.pos.x, h.pos.z);
          const v = dm * 0.3 - shooter3(man) * 4 - dist2(sim.players[s].pos.x, sim.players[s].pos.z, h.pos.x, h.pos.z) * 0.4;
          if (v > bestV) {
            bestV = v;
            best = s;
          }
        }
        if (best >= 0) {
          b.doubler = best;
          mem[best].doubleT = 2.6;
        }
      }
    }
  } else if (b.helper >= 0 && ball.mode !== "dribble" && ball.mode !== "held") {
    mem[b.helper].helping = false;
    b.helper = -1;
  }

  // intentional foul chaser = nearest AI defender to the ball
  let fouler = -1;
  if (b.foulMode && holder >= 0) {
    let bd = 1e9;
    for (let k = 0; k < 5; k++) {
      const s = t * 5 + k;
      if (s === sim.userSlot) continue;
      const p = sim.players[s];
      const dd = dist2(p.pos.x, p.pos.z, sim.players[holder].pos.x, sim.players[holder].pos.z);
      if (dd < bd) {
        bd = dd;
        fouler = s;
      }
    }
  }

  // help rotation: when a helper leaves his man, the weak-side defender farthest from the ball sinks to cover him
  let rotator = -1;
  let rotMan = -1;
  if (b.helper >= 0 && holder >= 0 && mem[b.helper].helpT <= 0) {
    rotMan = b.marks[b.helper % 5];
    let far = -1;
    for (let k = 0; k < 5; k++) {
      const s = t * 5 + k;
      if (s === b.helper || s === sim.userSlot || b.marks[k] === holder) continue;
      const man = sim.players[b.marks[k]];
      const dd = dist2(man.pos.x, man.pos.z, bp.x, bp.z);
      if (dd > far) {
        far = dd;
        rotator = s;
      }
    }
    if (far < 6) rotator = -1;
  }

  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    const p = sim.players[s];
    const it = sim.intents[s];
    const m = mem[s];
    const manSlot = b.marks[k];
    // the human's defender: AI only drives his feet while his stick is idle (assist 1) or he holds lock-on (assist 2)
    const assist = s === sim.userSlot ? (it.assist ?? 0) : 0;
    if (s === sim.userSlot) {
      it.mark = manSlot;
      if (assist === 0) continue;
    }
    const keepCmd = it.cmd;
    const keepHands = it.handsUp;
    const keepIntense = it.intense;
    const man = sim.players[manSlot];
    const M = b.perceived[manSlot];
    const r = p.data.ratings;
    it.mark = manSlot;
    it.post = false;
    it.cut = false;
    it.target = -1;
    it.handsUp = false;
    it.intense = false;
    m.tight = true;
    m.faceOn = true;
    m.face.copy(man.pos);
    m.stealCd -= dt;
    m.chargeCd -= dt;
    m.dropT -= dt;
    m.gambleT -= dt;
    m.doubleT -= dt;
    if (m.closeT >= 0) m.closeT -= dt;
    if (m.closeT < 0 && m.closeActive > 0) m.closeActive -= dt;
    if (m.helping) m.helpT -= dt;
    let urg = 0.45;
    const manHasBall = manSlot === holder;
    const mr = distToBasket(M.x, M.z, d);

    // ---- base man position
    if (manHasBall) {
      let gap = 1.05;
      if (mr > COURT.threeR + 0.2) gap += clamp((74 - man.data.ratings.three) / 28, 0, 1) * 1.3;
      if (mr > 9.2) gap += (mr - 9.2) * 0.35;
      if (man.data.ratings.speed > r.speed + 10) gap += 0.25; // respect the blow-by
      const intense = st.clutch || (st.shotClockOn && st.shotClock < 7) || (r.perimeterD > 82 && b.iq > 0.6);
      if (intense) gap -= 0.18;
      gap = clamp(gap, 0.72, 3.2);
      A.subVectors(RIM, M).setY(0);
      const l = A.length();
      if (l > 1e-3) A.multiplyScalar(Math.min(gap, l * 0.85) / l);
      m.target.copy(M).add(A);
      it.intense = intense;
      it.handsUp = mr < 9 && mr > 3.5;
      urg = 0.75;
      // pick up full court only when pressing
      if (backcourt && !b.press) {
        const u = uOf(d, m.target.x);
        if (u > HALF_U + 2.5) m.target.x = d * (COURT.rimX - (HALF_U + 2.5));
      }
      // on-ball steal attempt
      const close = dist2(p.pos.x, p.pos.z, man.pos.x, man.pos.z);
      if (close < 1.4 && m.stealCd <= 0 && ball.mode === "dribble") {
        const mult = b.cpu ? diff.cpuSteal : 1;
        const rate = 0.16 * Math.pow(r.steal / 75, 1.6) * mult * (1.2 - man.data.ratings.handle / 160) * (0.55 + b.iq * 0.6);
        if (chance(rate * 0.25)) it.cmd = "steal";
        m.stealCd = 0.25 + (it.cmd === "steal" ? rand(0.8, 1.6) : 0);
      }
    } else {
      const ballD = dist2(M.x, M.z, bp.x, bp.z);
      let kR: number;
      let kB: number;
      if (mr < 3.4) {
        kR = 0.2;
        kB = 0.3; // three-quarter front the post
      } else if (ballD < 7.2) {
        kR = 0.2;
        kB = 0.17; // one pass away: deny
      } else {
        kR = 0.3 + b.iq * 0.06;
        kB = 0.27; // help side
      }
      m.target.set(M.x + (RIM.x - M.x) * kR + (bp.x - M.x) * kB, 0, M.z + (RIM.z - M.z) * kR + (bp.z - M.z) * kB);
      // sag more off non-shooters on the perimeter
      if (mr > COURT.threeR - 0.2) {
        const sag = (1 - shooter3(man)) * 0.9;
        A.subVectors(RIM, m.target).setY(0);
        const l = A.length();
        if (l > 0.5) m.target.addScaledVector(A, Math.min(sag, l - 0.5) / l);
      }
      m.face.set((man.pos.x + ball.pos.x) * 0.5, 0, (man.pos.z + ball.pos.z) * 0.5);
      if (backcourt && !b.press) {
        const u = uOf(d, m.target.x);
        if (u > HALF_U - 1) m.target.x = d * (COURT.rimX - (HALF_U - 1));
      }
      if (b.press && st.phase === "inbound") {
        // deny the inbound: body between the ball and the man
        m.target.set(M.x + (bp.x - M.x) * 0.3, 0, M.z + (bp.z - M.z) * 0.3);
      }
      urg = 0.45;
    }

    // ---- transition: get back first
    const myU = uOf(d, p.pos.x);
    const inTransition = ballU > 7.5 && st.phase === "live";
    if (inTransition && myU > ballU - 0.5) {
      urg = 1;
      if (myU > ballU + 4) {
        // way behind the play: sprint back to the paint first, but each to his own lane (toward his man's side,
        // staggered in depth) so four defenders never pile onto the same spot under the rim
        const tz = clamp(M.z * 0.45 + (k - 2) * 1.15, -3.4, 3.4);
        A.set(d * (COURT.rimX - 2.2 - (k % 3) * 1.3), 0, tz);
        m.target.copy(A);
      }
    }

    // ---- overrides, lowest to highest priority
    if (m.dropT > 0 && holder >= 0) {
      const h = sim.players[holder];
      A.subVectors(RIM, h.pos).setY(0);
      const l = A.length();
      if (l > 1) m.target.copy(h.pos).addScaledVector(A, Math.min(3.2, l * 0.55) / l);
      m.face.copy(h.pos);
      it.handsUp = true;
      urg = 0.8;
    }
    if (m.doubleT > 0 && holder >= 0 && s === b.doubler) {
      const h = sim.players[holder];
      A.subVectors(RIM, h.pos).setY(0).normalize();
      // come from the baseline / help side
      m.target.set(h.pos.x + A.x * 0.9 - A.z * 0.7, 0, h.pos.z + A.z * 0.9 + A.x * 0.7);
      m.face.copy(h.pos);
      it.handsUp = true;
      it.intense = true;
      urg = 1;
    } else if (s === b.doubler && m.doubleT <= 0) {
      b.doubler = -1;
    }
    if (m.helping && m.helpT <= 0 && holder >= 0) {
      const h = sim.players[holder];
      A.subVectors(RIM, h.pos).setY(0);
      const l = A.length();
      if (l > 0.3) m.target.copy(h.pos).addScaledVector(A, Math.min(1.25, l * 0.6) / l);
      m.face.copy(h.pos);
      it.handsUp = true;
      urg = 1;
      // set feet and take the charge
      if (m.chargeCd <= 0 && p.vel.lengthSq() < 0.8) {
        const hd = dist2(p.pos.x, p.pos.z, h.pos.x, h.pos.z);
        const toward = (p.pos.x - h.pos.x) * h.vel.x + (p.pos.z - h.pos.z) * h.vel.z;
        const outside = distToBasket(p.pos.x, p.pos.z, d) > COURT.restrictedR + 0.15;
        if (hd < 1.9 && toward > 3.2 * hd && outside && chance(0.18 + b.iq * 0.25)) it.cmd = "takeCharge";
        m.chargeCd = 2.5;
      }
    }
    if (m.closeT < 0 && m.closeActive > 0 && (manHasBall || passTo === manSlot)) {
      // closeout: sprint, then chop the feet short of the shooter
      const tx = passTo === manSlot && ball.pass ? ball.pass.end.x : man.pos.x;
      const tz = passTo === manSlot && ball.pass ? ball.pass.end.z : man.pos.z;
      B.set(tx, 0, tz);
      A.subVectors(RIM, B).setY(0);
      const l = A.length();
      const stop = clamp(0.9 + (72 - man.data.ratings.three) / 30, 0.8, 2.4);
      if (l > 0.1) m.target.copy(B).addScaledVector(A, Math.min(stop, l) / l);
      const far = dist2(p.pos.x, p.pos.z, m.target.x, m.target.z);
      urg = far > 2.2 ? 1 : 0.55;
      it.handsUp = far < 3.5;
      m.face.copy(B);
      if (man.vel.lengthSq() > 9 && manHasBall) m.closeActive = 0; // he put it on the floor: recover, no flying by
    }
    if (m.gambleT > 0 && ball.mode === "pass") {
      m.target.copy(m.gamble);
      urg = 1;
    }
    if (m.contestT >= 0) {
      m.contestT -= dt;
      if (m.contestT < 0) {
        m.contestOn = 1.0;
        const sh = ball.mode === "shot" && ball.shot ? sim.players[ball.shot.shooter] : holder >= 0 ? sim.players[holder] : null;
        if (m.blockPlan && sh && dist2(p.pos.x, p.pos.z, sh.pos.x, sh.pos.z) < 2.1) it.cmd = "block";
        m.blockPlan = false;
      }
    }
    if (m.contestOn > 0) {
      m.contestOn -= dt;
      const sh = ball.mode === "shot" && ball.shot ? sim.players[ball.shot.shooter] : holder >= 0 ? sim.players[holder] : null;
      if (sh && sh.team === opp) {
        A.subVectors(RIM, sh.pos).setY(0);
        const l = A.length();
        if (l > 0.1) m.target.copy(sh.pos).addScaledVector(A, Math.min(0.65, l) / l);
        m.face.copy(sh.pos);
        it.handsUp = true;
        urg = 1;
      }
    }
    // fallback contest trigger when the shooter is gathering and no event reached us
    if (holder >= 0 && manHasBall && m.contestT < 0 && m.contestOn <= 0 && SHOT_ACTIONS.has(man.action) && man.actionT < 0.2) {
      m.contestT = b.reaction * rand(0.5, 0.9);
    }
    if (s === fouler) {
      const h = sim.players[holder];
      m.target.copy(h.pos);
      urg = 1;
      it.intense = true;
      it.foul = true;
      if (m.stealCd <= 0 && dist2(p.pos.x, p.pos.z, h.pos.x, h.pos.z) < 1.5) {
        it.cmd = "steal";
        m.stealCd = 0.4;
      }
    } else it.foul = false;

    // pass interception: hands on the ball when it flies by
    if (ball.mode === "pass" && m.stealCd <= 0) {
      const bd = dist2(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
      const ps = ball.pass;
      if (ps && bd < 1.1 && ball.pos.y < p.reach + 0.3 && ps.to !== s) {
        // only a real jump on the lane: the ball is still well short of the receiver and I am closer to it than he is
        const rcv = sim.players[ps.to];
        const toRcv = dist2(ball.pos.x, ball.pos.z, rcv.pos.x, rcv.pos.z);
        if (toRcv > 1.4 && bd < toRcv - 0.3) {
          const mult = b.cpu ? diff.cpuSteal : 1;
          if (chance((0.2 + r.steal / 200) * mult * (0.5 + b.iq * 0.5))) it.cmd = "steal";
        }
        m.stealCd = 0.9;
      }
    }

    if (s === rotator && rotMan >= 0) {
      const rm = sim.players[rotMan];
      A.subVectors(RIM, rm.pos).setY(0);
      const l = A.length();
      B.copy(rm.pos).addScaledVector(A, l > 0.1 ? Math.min(1.6, l * 0.4) / l : 0);
      m.target.lerp(B, 0.6);
      urg = Math.max(urg, 0.85);
    }

    keepIn(m.target, 0.2);
    m.urgency = urg;
    steer(p, it, m, null);
    if (s !== fouler && it.sprint === 0 && urg >= 1 && p.stamina > 0.25) it.sprint = 1;
    if (assist > 0) {
      // never act for the human: buttons stay his
      it.cmd = keepCmd;
      it.handsUp = keepHands;
      it.intense = keepIntense;
      it.foul = false;
      it.target = -1;
      if (assist === 2) {
        // lock-on: shadow the man at defensive speed, the stick still steers half of it
        it.move.multiplyScalar(0.5).addScaledVector(it.aim, 0.5);
        const ml = it.move.length();
        if (ml > 1) it.move.multiplyScalar(1 / ml);
        it.sprint = Math.max(it.sprint, 0.6);
      } else if (urg < 1) it.sprint = Math.min(it.sprint, 0.5);
    }
  }
}

/** Box outs while the shot is up, then everybody hunts the landing spot of a loose ball. */
export function rebound(ctx: Ctx, landing: THREE.Vector3, shooterTeam: TeamSide | -1, flying: boolean, dt: number): void {
  const { sim, mem } = ctx;
  const shot = sim.ball.shot;
  const side = shot ? shot.target : (sim.ball.pos.x >= 0 ? 1 : -1);
  rimFloor(side as Dir, RIM);
  // per team: rank by distance to the landing spot, top 2-3 go for it
  for (let t = 0 as TeamSide; t <= 1; t = (t + 1) as TeamSide) {
    const b = ctx.brains[t];
    const offense = t === shooterTeam;
    let crashers = 0;
    for (let k = 0; k < 5; k++) {
      const s = t * 5 + k;
      const it = sim.intents[s];
      // an idle human defender boxes out / hunts the ball like the AI would (his buttons stay his)
      if (s === sim.userSlot && (offense || !it.assist)) continue;
      const user = s === sim.userSlot;
      const keepCmd = it.cmd;
      const keepHeld = it.shootHeld;
      const keepHands = it.handsUp;
      const p = sim.players[s];
      const m = mem[s];
      const rt = p.data.ratings;
      it.handsUp = false;
      it.intense = false;
      it.post = false;
      it.target = -1;
      it.cut = false;
      it.shootHeld = false;
      m.shooting = false;
      m.tight = false;
      m.faceOn = true;
      m.face.copy(RIM);
      const dl = dist2(p.pos.x, p.pos.z, landing.x, landing.z);
      const pr = dist2(p.pos.x, p.pos.z, RIM.x, RIM.z);
      if (flying) {
        if (!offense) {
          // box out the man: get between him and the rim, then hold
          const man = sim.players[b.marks[k]];
          const mrr = dist2(man.pos.x, man.pos.z, RIM.x, RIM.z);
          if (mrr < 6.5) {
            A.subVectors(RIM, man.pos).setY(0);
            const l = A.length();
            m.target.copy(man.pos).addScaledVector(A, Math.min(0.75, l * 0.5) / Math.max(l, 1e-3));
            m.urgency = 0.85;
          } else if (pr < 7) {
            A.set(RIM.x - side * 1.8, 0, clamp(p.pos.z, -2.4, 2.4));
            m.target.copy(A);
            m.urgency = 0.6;
          } else {
            m.target.copy(p.pos);
            m.urgency = 0.2;
          }
        } else {
          const crash = (rt.offReb >= 64 || isBig(p)) && pr < 7.5 && (crashers < 1 || (crashers < 2 && rt.offReb >= 78));
          if (crash) {
            crashers++;
            const sz = shot ? -Math.sign(shot.from.z || 1) : 1;
            m.target.set(RIM.x - side * rand(0.9, 1.6), 0, sz * rand(0.6, 1.8));
            m.urgency = 0.9;
          } else if (k === 0 || rt.offReb < 45) {
            // get back for balance
            m.target.set(-side * 2.5, 0, clamp(p.pos.z * 0.4, -3, 3));
            m.urgency = 0.7;
          } else {
            m.target.copy(p.pos);
            m.urgency = 0.2;
          }
        }
      } else {
        // loose: hunt the landing spot when close enough
        // the defense is already inside: it pursues longer rebounds than the offense does
        const want = offense ? dl < 4.2 + rt.offReb / 40 || (rt.offReb > 80 && dl < 6.5) : dl < 6.5 + rt.defReb / 35 || (rt.defReb > 78 && dl < 9);
        if (want) {
          m.target.copy(landing);
          m.urgency = 1;
          m.tight = true;
        } else if (!offense && k === 0) {
          // outlet: the point guard leaks toward the near wing
          m.target.set(RIM.x - side * 8.5, 0, landing.z > 0 ? 5 : -5);
          m.urgency = 0.6;
        } else {
          m.target.copy(p.pos);
          m.urgency = 0.3;
        }
        m.face.copy(sim.ball.pos).setY(0);
      }
      keepIn(m.target, 0.25);
      steer(p, it, m, null);
      if (user) {
        it.cmd = keepCmd;
        it.shootHeld = keepHeld;
        it.handsUp = keepHands;
        if (it.assist === 2) {
          it.move.multiplyScalar(0.5).addScaledVector(it.aim, 0.5);
          const ml = it.move.length();
          if (ml > 1) it.move.multiplyScalar(1 / ml);
        }
      }
    }
  }
  void dt;
}
