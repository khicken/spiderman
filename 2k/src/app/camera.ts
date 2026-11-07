import * as THREE from "three";
import type { CameraCue, CameraMode, CameraRig, Dir, GameEvent, PlayerState, ScreenPoint, SimView, TeamSide, V3 } from "./contracts";
import { COURT } from "./contracts";
import { createReplay } from "./camera-replay";
import {
  clamp, kick, mix, smooth, smoother, snap, snap3, spring, spring3, spring3To, springAngle, springTo, wobble,
} from "./camera-spring";

// Camera director. Owner: input-camera.
// Gameplay shots (by mode) + phase shots (tip-off, free throw, timeout, period break, final) + event shots (intro
// flyover, slam cam, buzzer-beater slow-mo, instant replay). Shots change by broadcast-style cuts, or short eased blends
// where a cut would disorient during play. All motion runs through critically damped springs.
// World: broadcast side is -z looking +z, so screen-right is world -x there (stickToWorld handles it).

const MODES: CameraMode[] = ["broadcast", "broadcastHigh", "baseline", "follow", "skycam"];
type Shot =
  | "game" | "intro" | "tipoff" | "freeThrow" | "timeout" | "periodBreak" | "final" | "slam" | "buzzer" | "replay" | "menu";
const CINEMATIC: Record<Shot, boolean> = {
  game: false, intro: true, tipoff: true, freeThrow: false, timeout: true, periodBreak: true, final: true, slam: true,
  buzzer: true, replay: true, menu: false,
};

interface SideRig {
  back: number; // distance behind the near sideline
  h: number;
  truck: number; // how much of the focus x the camera dolly follows (rest is pan)
  minW: number; // half-width of court framed, meters
  maxW: number;
  aimY: number;
  nearPad: number; // court depth kept below the focus (m): keeps the ball clear of the bottom HUD band
}
const BROADCAST: SideRig = { back: 12.8, h: 7.3, truck: 0.62, minW: 6.6, maxW: 11.8, aimY: 0.95, nearPad: 7.2 };
const HIGH: SideRig = { back: 16, h: 13.5, truck: 0.5, minW: 8.4, maxW: 15, aimY: 0.3, nearPad: 8.2 };
const SKY: SideRig = { back: 6, h: 16, truck: 0.9, minW: 8.6, maxW: 15, aimY: 0, nearPad: 9.8 };

const INTRO_T = 5.4;
const DEG = 180 / Math.PI;

export function createCamera(camera: THREE.PerspectiveCamera): CameraRig {
  let mode: CameraMode = "broadcast";
  let shot: Shot = "menu";
  let shotT = 0;
  let cutNext = true;
  let inMenu = true;
  let src: SimView | null = null;
  let lastTime = 0;
  let realT = 0;

  // final pose
  const pos = new THREE.Vector3(0, 8, -20);
  const aim = new THREE.Vector3();
  let fov = 36;
  const ctrlF = new THREE.Vector3(0, 0, 1);
  let focusDist = 20;

  // per-shot targets
  const wantPos = new THREE.Vector3();
  const wantAim = new THREE.Vector3();
  let wantFov = 36;
  let subject = 20;

  // blends
  const fromPos = new THREE.Vector3();
  const fromAim = new THREE.Vector3();
  let fromFov = 36;
  let blendT = 1;
  let blendDur = 0;

  // gameplay springs
  const fx = spring();
  const fz = spring(0.7);
  const zoomW = spring(9);
  const ballVx = spring();
  const yaw = spring(Math.PI / 2);
  const follow3 = spring3();
  const cue3 = spring3();
  const cueAim3 = spring3();
  const prevBall = new THREE.Vector3();
  let snapGame = true;
  let lastDir: Dir = 1;

  // juice
  let trauma = 0;
  const fovKick = spring();
  let hitT = 0;
  let hitScale = 1;
  const ts = spring(1);
  let slowTarget = 1;

  // intro
  const introPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-19, 13, 9), new THREE.Vector3(-13.5, 6.4, 3.8), new THREE.Vector3(-7.2, 2.6, -3.2),
      new THREE.Vector3(-0.8, 2.3, -7.6), new THREE.Vector3(0, 4.4, -12.8),
    ],
    false, "centripetal",
  );
  const introAim = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-12.7, 3.1, 0), new THREE.Vector3(-11.2, 2.5, 0), new THREE.Vector3(-3.5, 1.6, 0),
      new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(0, 2.4, 0),
    ],
    false, "centripetal",
  );
  let introOn = false;
  let introT = 0;

  // forced cue (cue() with a duration)
  let forced: Shot | null = null;
  let forcedLeft = 0;
  const forcedAt = new THREE.Vector3();
  let forcedHasAt = false;

  // slam cam (live, used when replays are off)
  let slamOn = false;
  let slamSlot = -1;
  let slamSide: Dir = 1;
  let slamUntil = 0;
  let slamZ = 1;

  // buzzer beater
  let buzzOn = false;
  let buzzShooter = -1;
  let buzzTarget: Dir = 1;
  const buzzFrom = new THREE.Vector3();
  let buzzHold = -1;

  // timeout / final
  let timeoutTeam: TeamSide = 0;
  let winner: TeamSide | -1 = -1;

  // replay
  const replay = createReplay(720);
  let replaysOn = false;
  let pendT = -1; // sim time of the highlight moment, -1 none
  let pendScore = 0;
  let pendKind: "dunk" | "ankle" | "block" | "buzzer" = "dunk";
  const pendAt = new THREE.Vector3();
  let pendSide: Dir = 1;
  let pendSlot = -1;
  let lastReplayAt = -1e9;
  let replayEventT = 0;
  let replayKind: "dunk" | "ankle" | "block" | "buzzer" = "dunk";
  const replayAt = new THREE.Vector3();
  let replaySide: Dir = 1;
  let replaySlot = -1;
  let replayA0 = 0;
  const replaySpeed = spring(1);

  // scratch
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const dev = new Float32Array(10);

  const basketX = (d: Dir) => d * COURT.rimX;
  const aspect = () => (camera.aspect > 0.1 ? camera.aspect : 16 / 9);
  /** vertical fov (deg) that frames `halfW` meters horizontally at `dist`. */
  const fovFor = (halfW: number, dist: number, lo = 16, hi = 52) =>
    clamp(2 * Math.atan(Math.tan(Math.atan(halfW / Math.max(1, dist))) / aspect()) * DEG, lo, hi);

  function resetMatch() {
    shot = "game";
    shotT = 0;
    introOn = false;
    slamOn = false;
    buzzOn = false;
    buzzHold = -1;
    forced = null;
    pendT = -1;
    lastReplayAt = -1e9;
    replay.reset();
    hitT = 0;
    slowTarget = 1;
    snap(ts, 1);
    snap(replaySpeed, 1);
    snapGame = true;
    cutNext = true;
    winner = -1;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // gameplay
  // ---------------------------------------------------------------------------------------------------------------
  function attackDir(view: SimView): Dir {
    const p = view.state.possession;
    if (p === 0 || p === 1) lastDir = view.dir(p);
    return lastDir;
  }

  /** Smoothed focus x/z and framing half-width from the ball, its motion and the spread of players. */
  function gameFocus(view: SimView, dt: number) {
    const s = view.state;
    const b = view.ball;
    const d = attackDir(view);
    let tx = b.pos.x;
    let tz = b.pos.z;
    let om = 2.8;
    if (b.mode === "shot" && b.shot) {
      tx = mix(b.pos.x, basketX(b.shot.target), 0.5);
      om = 3.4;
    } else if (b.mode === "pass" && b.pass) {
      tx = mix(b.pos.x, b.pass.end.x, 0.55);
      tz = mix(b.pos.z, b.pass.end.z, 0.5);
      om = 3.4;
    } else {
      tx += clamp(ballVx.x * 0.42, -3.6, 3.6);
      const halfcourt = b.pos.x * d > 0.5 && Math.abs(ballVx.x) < 3.5;
      if (halfcourt) tx = mix(tx, d * (COURT.rimX - 4.2), 0.32);
    }
    if (s.phase === "inbound" && s.inbound) {
      tx = mix(tx, s.inbound.spot.x, 0.4);
      tz = mix(tz, s.inbound.spot.z, 0.4);
    }
    // skycam: aim at a weighted centre of the ball and the ten, so the off-ball players are not cut off
    if (mode === "skycam") {
      let cx = 0;
      for (let i = 0; i < view.players.length && i < 10; i++) cx += view.players[i].pos.x;
      tx = mix(tx, cx / Math.max(1, Math.min(10, view.players.length)), 0.4);
    }
    const lim = COURT.halfL - 4.4;
    tx = clamp(tx, -lim, lim);
    // depth focus: between the ball and the centroid of the ten, biased to the ball
    let cz = 0;
    let cn = 0;
    for (let i = 0; i < view.players.length && i < 10; i++) {
      cz += view.players[i].pos.z;
      cn++;
    }
    if (cn) cz /= cn;
    tz = clamp(mix(tz, cz, 0.35), -COURT.halfW + 1.2, COURT.halfW - 0.8);

    // framing: cover the 8 players nearest the focus plus the ball
    let n = 0;
    for (let i = 0; i < view.players.length && i < 10; i++) dev[n++] = Math.abs(view.players[i].pos.x - tx);
    dev.sort();
    let need = Math.max(n >= 8 ? dev[7] : n ? dev[n - 1] : 6, Math.abs(b.pos.x - tx) + 0.8) + 2.0;
    if (s.clutch) need *= 0.95;
    const u = view.userSlot >= 0 ? view.players[view.userSlot] : null;
    if (u && u.meter.active) need *= 0.92;

    if (snapGame) {
      snap(fx, tx);
      snap(fz, tz);
      snap(zoomW, need);
    } else {
      springTo(fx, tx, om, dt);
      springTo(fz, tz, 2, dt);
      springTo(zoomW, need, need > zoomW.x ? 2.2 : 1.3, dt);
    }
  }

  function sidePose(r: SideRig) {
    // the dolly creeps toward the sideline when the play is on the far side
    const fzz = fz.x;
    const pull = clamp(fzz, 0, 6) * 0.4;
    wantPos.set(fx.x * r.truck, r.h, -(COURT.halfW + r.back - pull));
    // vertical: frame a band of court depth around the play (ball-biased), not the whole floor, so the action sits
    // in the middle third instead of riding the top edge with empty floor and front-row heads below it
    const zNear = Math.max(-COURT.halfW - 0.8, fzz - r.nearPad);
    const zFar = Math.min(COURT.halfW + 0.4, fzz + 5.6);
    const dNear = Math.max(0.5, zNear - wantPos.z);
    const dFar = zFar - wantPos.z;
    const aNear = Math.atan2(r.h, dNear);
    const aFar = Math.atan2(r.h - 2.3, dFar);
    const pitch = (aNear + aFar) / 2;
    const depth = -wantPos.z + 0.4;
    const dx = fx.x - wantPos.x;
    wantAim.set(fx.x, r.h - Math.tan(pitch) * Math.hypot(depth, dx), wantPos.z + depth);
    const dist = wantPos.distanceTo(wantAim);
    const vSpan = (aNear - aFar) * 1.1 * DEG;
    wantFov = clamp(Math.max(vSpan, fovFor(clamp(zoomW.x, r.minW, r.maxW), dist, 14, 50)), 16, 50);
    ctrlF.set(0, 0, 1);
  }

  function gamePose(view: SimView, dt: number) {
    gameFocus(view, dt);
    const b = view.ball;
    if (mode === "broadcast" || mode === "broadcastHigh" || mode === "skycam") {
      sidePose(mode === "broadcast" ? BROADCAST : mode === "skycam" ? SKY : HIGH);
      wantAim.y += clamp(b.pos.y - 3, 0, 4) * 0.1;
      // a jumper in flight: tilt up and open the lens so the ball's arc stays inside the frame
      if (b.mode === "shot") {
        const up = clamp(b.pos.y - 2.2, 0, 5);
        wantAim.y += up * 0.28;
        wantFov = Math.min(54, wantFov + up * 1.4);
      }
    } else if (mode === "baseline") {
      const d = attackDir(view);
      const target = d > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (snapGame) snap(yaw, target);
      else springAngle(yaw, target, 2.6, dt);
      const sx = Math.sin(yaw.x);
      const sz = Math.cos(yaw.x);
      const ax = clamp(mix(b.pos.x, d * COURT.rimX, 0.25), -COURT.halfL + 1, COURT.halfL - 1);
      const az = b.pos.z * 0.35;
      wantPos.set(ax - sx * 10.5, 6.6, az - sz * 10.5);
      wantPos.x = clamp(wantPos.x, -COURT.halfL - 3, COURT.halfL + 3);
      wantAim.set(ax + sx * 5.5, 0.9, az * 0.6 + sz * 5.5);
      wantFov = 44;
      ctrlF.set(sx, 0, sz);
    } else {
      // player cam: behind the user, toward the basket on offense, toward the ball from the rim on defense
      let u: PlayerState | null = view.userSlot >= 0 ? view.players[view.userSlot] : null;
      if (!u && view.state.ballHandler >= 0) u = view.players[view.state.ballHandler];
      if (!u) {
        sidePose(BROADCAST);
        return;
      }
      const offense = view.state.possession === u.team;
      if (offense) v.set(basketX(view.dir(u.team)) - u.pos.x, 0, -u.pos.z);
      else {
        const defended = basketX(view.dir((1 - u.team) as TeamSide));
        v.set(b.pos.x - defended, 0, b.pos.z);
      }
      if (v.lengthSq() > 2.5 * 2.5 || snapGame) {
        const target = Math.atan2(v.x, v.z);
        if (snapGame) snap(yaw, target);
        else springAngle(yaw, target, 2.3, dt);
      }
      w.set(u.pos.x, 0, u.pos.z);
      if (snapGame) snap3(follow3, w);
      const fp = spring3To(follow3, w, 7, snapGame ? 0 : dt, w);
      const sx = Math.sin(yaw.x);
      const sz = Math.cos(yaw.x);
      wantPos.set(fp.x - sx * 6.3, 3.3, fp.z - sz * 6.3);
      // never behind the end line (the stanchion fills the lens there) and never under a backboard
      const lim = COURT.halfL - 0.5;
      if (Math.abs(wantPos.x) > lim) wantPos.x = Math.sign(wantPos.x) * lim;
      wantPos.z = clamp(wantPos.z, -COURT.halfW - 1.5, COURT.halfW + 1.5);
      const underBoard = Math.abs(wantPos.x) > COURT.rimX - 1.8 && Math.abs(wantPos.z) < 2.6;
      if (underBoard) wantPos.y = 5.2;
      wantAim.set(fp.x + sx * 4.5, 1.25, fp.z + sz * 4.5);
      wantFov = 52;
      ctrlF.set(sx, 0, sz);
    }
    subject = wantPos.distanceTo(b.pos);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // phase and event shots
  // ---------------------------------------------------------------------------------------------------------------
  function centroid(view: SimView, team: TeamSide, out: THREE.Vector3) {
    out.set(0, 0, 0);
    for (let k = 0; k < 5; k++) out.add(view.players[team * 5 + k].pos);
    return out.multiplyScalar(0.2).setY(0);
  }

  function tipoffPose() {
    // low, tight, slightly off-axis on the center circle (about a 35 mm look); letterbox + depth of field
    // blur the stands so the two jumpers own the frame, then the rig blends out to broadcast on the tap
    wantPos.set(3.1, 2.35, -8.2);
    wantAim.set(0, 2.15, 0);
    wantFov = 31;
    subject = Math.hypot(3.1, 8.2);
  }

  function freeThrowPose(view: SimView) {
    const ft = view.state.freeThrow;
    if (!ft) {
      tipoffPose();
      return;
    }
    const d = view.dir(ft.team);
    const behind = view.userTeam !== -1 && ft.team === view.userTeam;
    if (behind) {
      const shooter = view.players[ft.shooter];
      wantPos.set(d * (COURT.ftLineX - 3.6), 3.0, clamp(shooter.pos.z, -1, 1) * 0.5 + 0.6);
      wantAim.set(basketX(d), COURT.rimHeight - 0.85, 0);
      wantFov = 36;
      ctrlF.set(d, 0, 0);
    } else {
      wantPos.set(d * (COURT.rimX - 7.4), 4.3, -9.8);
      wantAim.set(d * (COURT.rimX - 2.8), 1.75, 0.4);
      wantFov = 31;
      ctrlF.set(0, 0, 1);
    }
    subject = wantPos.distanceTo(wantAim);
  }

  /** Keep floor-level cinematic cameras on the court side of the first row. */
  function inBowl() {
    wantPos.x = clamp(wantPos.x, -COURT.halfL - 2, COURT.halfL + 2);
    wantPos.z = clamp(wantPos.z, -COURT.halfW - 2.2, COURT.halfW + 1.5);
  }

  function timeoutPose(view: SimView) {
    centroid(view, timeoutTeam, v);
    const a = -0.5 + shotT * 0.09;
    const r = 8;
    wantPos.set(v.x + Math.sin(a) * r, 2.3 + Math.sin(shotT * 0.2) * 0.3, v.z - Math.cos(a) * r);
    inBowl();
    wantAim.set(v.x, 1.45, v.z);
    wantFov = 34;
    subject = r;
  }

  function periodPose(view: SimView) {
    const side = view.state.period % 2 === 0 ? 1 : -1;
    const u = smoother(clamp(shotT / 10, 0, 1));
    wantPos.set(side * mix(20, 12, u), mix(16, 11.5, u), mix(-21, -17, u));
    wantAim.set(side * mix(4, 1, u), 0.6, 1.5);
    wantFov = 44;
    subject = wantPos.length();
  }

  function finalPose(view: SimView) {
    if (winner === 0 || winner === 1) centroid(view, winner, v);
    else v.set(0, 0, 0);
    const a = shotT * 0.075;
    const r = 11 - Math.min(3, shotT * 0.15);
    wantPos.set(v.x + Math.sin(a) * r, 3.2 + Math.min(3.5, shotT * 0.12), v.z - Math.cos(a) * r);
    inBowl();
    wantAim.set(v.x, 1.4, v.z);
    wantFov = 38;
    subject = r;
  }

  function introPose(dt: number, view: SimView | null) {
    const fast = view && view.state.phase === "live" ? 2.4 : 1;
    introT += dt * fast;
    const u = smoother(clamp(introT / INTRO_T, 0, 1));
    introPath.getPoint(u, wantPos);
    introAim.getPoint(u, wantAim);
    wantFov = mix(50, fovFor(5.2, 13.2, 28, 44), u);
    subject = wantPos.distanceTo(wantAim);
    if (introT >= INTRO_T) introOn = false;
  }

  function slamPose(view: SimView, dt: number) {
    const p = view.players[slamSlot];
    const rx = basketX(slamSide);
    // low on the baseline, opposite the dunker's lane so we see him rise toward the lens
    wantPos.set(slamSide * (COURT.halfL - 0.9), 1.15, slamZ * 3.4);
    v.set(mix(rx, p.pos.x, 0.45), mix(COURT.rimHeight - 0.2, 1.9 + p.pos.y, 0.5), mix(0, p.pos.z, 0.45));
    if (shotT === 0) snap3(cueAim3, v);
    spring3To(cueAim3, v, 6, dt, wantAim);
    wantFov = 50;
    ctrlF.set(slamSide, 0, 0);
    subject = wantPos.distanceTo(wantAim);
  }

  function buzzerPose(view: SimView, dt: number) {
    const rx = basketX(buzzTarget);
    v.set(buzzFrom.x - rx, 0, buzzFrom.z).normalize();
    wantPos.set(buzzFrom.x + v.x * 3.6, 2.4, buzzFrom.z + v.z * 3.6);
    if (Math.abs(wantPos.z) > COURT.halfW + 2) wantPos.z = Math.sign(wantPos.z) * (COURT.halfW + 2);
    w.copy(view.ball.pos);
    w.x = mix(w.x, rx, 0.35);
    w.y = Math.max(w.y, 2.2);
    if (shotT === 0) snap3(cueAim3, w);
    spring3To(cueAim3, w, 5, dt, wantAim);
    wantFov = 44;
    subject = wantPos.distanceTo(view.ball.pos);
  }

  function replayPose(view: SimView, dt: number) {
    const rv = replay.view ?? view;
    const t = replay.t - replayEventT; // negative before the highlight moment
    if (replaySlot >= 0 && replayKind !== "buzzer") w.copy(rv.players[replaySlot].pos).setY(1.3 + rv.players[replaySlot].pos.y);
    else w.copy(rv.ball.pos);
    const a = replayA0 + t * 0.32;
    if (replayKind === "dunk") {
      const rx = basketX(replaySide);
      const r = 5.6;
      // beside the rim on the near side (profile of the dunker), sweeping out toward the court
      const phi = a * 0.9 + 0.15;
      wantPos.set(rx - replaySide * Math.sin(phi) * r, mix(1.3, 2.7, smooth((t + 2) / 3.2)), -Math.cos(phi) * r);
      v.set(mix(rx, w.x, 0.6), clamp(mix(COURT.rimHeight - 0.3, w.y, 0.5), 1.6, 4), w.z * 0.6);
      wantFov = 42;
    } else {
      const r = 5.6;
      wantPos.set(replayAt.x + Math.sin(a) * r, 1.6 + smooth((t + 2) / 3) * 0.8, replayAt.z - Math.cos(a) * r);
      v.set(mix(replayAt.x, w.x, 0.6), clamp(w.y, 1.2, 3.2), mix(replayAt.z, w.z, 0.6));
      wantFov = 40;
    }
    if (Math.abs(wantPos.z) > COURT.halfW + 2.5) wantPos.z = Math.sign(wantPos.z) * (COURT.halfW + 2.5);
    if (Math.abs(wantPos.x) > COURT.halfL + 1.5) wantPos.x = Math.sign(wantPos.x) * (COURT.halfL + 1.5);
    if (shotT === 0) snap3(cueAim3, v);
    spring3To(cueAim3, v, 5, dt, wantAim);
    subject = wantPos.distanceTo(wantAim);
  }

  function forcedPose(view: SimView, s: Shot, dt: number) {
    if (s === "freeThrow") freeThrowPose(view);
    else if (s === "timeout") timeoutPose(view);
    else if (s === "periodBreak") periodPose(view);
    else if (s === "final") finalPose(view);
    else if (s === "tipoff") tipoffPose();
    else if (s === "slam" && forcedHasAt) {
      const r = 5;
      const a = shotT * 0.35;
      wantPos.set(forcedAt.x - Math.cos(a) * r * Math.sign(forcedAt.x || 1), 1.6, forcedAt.z + Math.sin(a) * r);
      v.set(forcedAt.x, Math.max(1.5, forcedAt.y), forcedAt.z);
      if (shotT === 0) snap3(cueAim3, v);
      spring3To(cueAim3, v, 5, dt, wantAim);
      wantFov = 42;
      subject = r;
    } else gamePose(view, dt);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // shot selection, transitions
  // ---------------------------------------------------------------------------------------------------------------
  function decide(view: SimView): Shot {
    if (replay.active) return "replay";
    if (introOn) return "intro";
    if (forced) return forced;
    if (buzzOn) return "buzzer";
    if (slamOn) return "slam";
    switch (view.state.phase) {
      case "pregame":
      case "tipoff":
        return "tipoff";
      case "freeThrow":
        return view.state.freeThrow ? "freeThrow" : "game";
      case "timeout":
        return "timeout";
      case "periodBreak":
        return "periodBreak";
      case "final":
        return "final";
      default:
        return "game";
    }
  }

  function enter(next: Shot) {
    const prev = shot;
    shot = next;
    shotT = 0;
    // blends where a cut would lose the player; cuts everywhere else (that is how a broadcast switches cameras)
    let blend = 0;
    if (prev === "intro" && !cutNext) blend = 1.1;
    else if (prev === "tipoff" && next === "game") blend = 0.9;
    else if (prev === "freeThrow" && next === "game") blend = 0.55;
    if (blend > 0) {
      fromPos.copy(pos);
      fromAim.copy(aim);
      fromFov = fov;
      blendT = 0;
      blendDur = blend;
    } else {
      cutNext = true;
      blendDur = 0;
    }
    if (next === "game") snapGame = blend === 0 || snapGame;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // replay scheduling
  // ---------------------------------------------------------------------------------------------------------------
  function highlight(view: SimView, kind: typeof pendKind, score: number, at: V3, side: Dir, slot: number) {
    if (!replaysOn) return;
    if (pendT >= 0 && pendScore > score && view.time - pendT < 6) return;
    pendT = view.time;
    pendScore = score;
    pendKind = kind;
    pendAt.set(at.x, at.y, at.z);
    pendSide = side;
    pendSlot = slot;
  }

  function tryReplay(view: SimView) {
    if (pendT < 0) return;
    const age = view.time - pendT;
    if (age > 7) {
      pendT = -1;
      return;
    }
    const ph = view.state.phase;
    if (age < 1.1 || ph === "live" || ph === "tipoff" || ph === "final") return;
    if (pendScore < 4 && view.time - lastReplayAt < 40) {
      pendT = -1;
      return;
    }
    const pre = pendKind === "dunk" ? 2.2 : pendKind === "buzzer" ? 2.6 : 1.8;
    if (replay.start(pendT - pre, pendT + 1.1)) {
      replayEventT = pendT;
      replayKind = pendKind;
      replayAt.copy(pendAt);
      replaySide = pendSide;
      replaySlot = pendSlot;
      replayA0 = (Math.random() - 0.5) * 0.8;
      lastReplayAt = view.time;
      snap(replaySpeed, 1);
    }
    pendT = -1;
  }

  function stepReplay(dt: number) {
    const near = Math.abs(replay.t - replayEventT) < 0.6;
    springTo(replaySpeed, near ? 0.32 : 1, 6, dt);
    if (!replay.advance(dt * replaySpeed.x)) {
      replay.stop();
      snapGame = true;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // output
  // ---------------------------------------------------------------------------------------------------------------
  function write(dt: number) {
    if (cutNext) {
      pos.copy(wantPos);
      aim.copy(wantAim);
      fov = wantFov;
      cutNext = false;
      blendDur = 0;
    } else if (blendDur > 0 && blendT < blendDur) {
      blendT += dt;
      const k = smoother(blendT / blendDur);
      pos.lerpVectors(fromPos, wantPos, k);
      aim.lerpVectors(fromAim, wantAim, k);
      fov = mix(fromFov, wantFov, k);
    } else {
      pos.copy(wantPos);
      aim.copy(wantAim);
      fov = wantFov;
    }
    if (pos.y < 0.5) pos.y = 0.5;
    focusDist = subject;

    // shake (trauma squared) and zoom punch
    trauma = Math.max(0, trauma - dt * 1.5);
    const sh = trauma * trauma;
    springTo(fovKick, 0, 7, dt);
    camera.position.copy(pos);
    if (sh > 0.0001) {
      camera.position.x += wobble(realT, 1) * sh * 0.16;
      camera.position.y += wobble(realT, 2) * sh * 0.12;
      camera.position.z += wobble(realT, 3) * sh * 0.08;
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(aim);
    if (sh > 0.0001) camera.rotateZ(wobble(realT, 4) * sh * 0.012);
    const f = clamp(fov + fovKick.x, 10, 75);
    if (Math.abs(camera.fov - f) > 0.005) {
      camera.fov = f;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  function updateTime(dt: number) {
    if (hitT > 0) {
      hitT -= dt;
      snap(ts, hitScale);
      if (hitT <= 0) hitScale = 1;
    } else springTo(ts, slowTarget, 7, dt);
  }

  function hit(scale: number, dur: number) {
    if (hitT > 0 && hitScale <= scale) {
      hitT = Math.max(hitT, dur);
      return;
    }
    hitScale = scale;
    hitT = dur;
  }

  // ---------------------------------------------------------------------------------------------------------------
  const rig: CameraRig = {
    get mode() {
      return mode;
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      snapGame = true;
      if (shot === "game") cutNext = true;
    },
    cycle() {
      rig.setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
      return mode;
    },

    update(dt, view) {
      realT += dt;
      if (view !== src || inMenu) {
        if (view !== src) {
          src = view;
          lastTime = view.time;
          const keepIntro = introOn;
          resetMatch();
          introOn = keepIntro;
          prevBall.copy(view.ball.pos);
        }
        inMenu = false;
      }
      const simDt = clamp(view.time - lastTime, 0, 0.25);
      lastTime = view.time;
      if (simDt > 0) springTo(ballVx, clamp((view.ball.pos.x - prevBall.x) / simDt, -12, 12), 4, simDt);
      prevBall.copy(view.ball.pos);

      if (replay.active) stepReplay(dt);
      else if (replaysOn && simDt > 0) replay.record(view);
      if (!replay.active) tryReplay(view);
      updateTime(dt);

      if (forced) {
        forcedLeft -= dt;
        if (forcedLeft <= 0) forced = null;
      }
      if (slamOn && (view.time > slamUntil || view.state.phase === "freeThrow")) slamOn = false;
      if (buzzOn && buzzHold >= 0) {
        buzzHold += dt;
        if (buzzHold > 1.7) {
          buzzOn = false;
          buzzHold = -1;
          slowTarget = 1;
        } else if (buzzHold > 0.5) slowTarget = 1;
      }

      const next = decide(view);
      if (next !== shot) enter(next);

      // shots on the play clock advance in sim time (freeze with pause); pure cinematics in real time
      const cueDt = shot === "slam" || shot === "game" || shot === "freeThrow" ? simDt : dt;
      switch (shot) {
        case "intro":
          introPose(dt, view);
          break;
        case "tipoff":
          tipoffPose();
          break;
        case "freeThrow":
          freeThrowPose(view);
          break;
        case "timeout":
          timeoutPose(view);
          break;
        case "periodBreak":
          periodPose(view);
          break;
        case "final":
          finalPose(view);
          break;
        case "slam":
          if (forced === "slam") forcedPose(view, "slam", dt);
          else slamPose(view, dt);
          break;
        case "buzzer":
          buzzerPose(view, dt);
          break;
        case "replay":
          replayPose(view, dt);
          break;
        default:
          if (forced) forcedPose(view, forced, dt);
          else gamePose(view, dt);
      }
      // keep the gameplay springs warm under cue shots, so the cut back lands on a settled frame
      if (shot !== "game") gameFocus(view, dt);
      snapGame = false;
      shotT += cueDt;
      write(dt);
    },

    menu(dt, t) {
      realT += dt;
      if (!inMenu) {
        inMenu = true;
        shot = "menu";
        introOn = false;
        forced = null;
        slamOn = buzzOn = false;
        replay.stop();
        snap(ts, 1);
        slowTarget = 1;
        hitT = 0;
        cutNext = true;
      }
      const SHOT = 9;
      const k = Math.floor(t / SHOT) % 4;
      const u = (t % SHOT) / SHOT;
      if (k === 0) {
        const a = t * 0.05 - 0.4;
        wantPos.set(Math.sin(a) * 23, 9.5 + Math.sin(t * 0.07) * 1.2, -Math.cos(a) * 23);
        wantAim.set(0, 0.8, 0);
        wantFov = 38;
      } else if (k === 1) {
        const e = smooth(u);
        wantPos.set(mix(-7, 6, e), 1.3, -9.4);
        wantAim.set(mix(1, 12.7, e * 0.8 + 0.2), 2.3, 0.6);
        wantFov = 40;
      } else if (k === 2) {
        const a = 0.55 + u * 0.7;
        wantPos.set(COURT.rimX - Math.cos(a) * 3.8, 1.9 + u * 0.9, -Math.sin(a) * 3.8);
        wantAim.set(COURT.rimX, COURT.rimHeight - 0.25, 0);
        wantFov = 38;
      } else {
        const e = smoother(u);
        wantPos.set(mix(-3, 3, e), mix(1, 6.8, e), -8.6);
        wantAim.set(0, mix(1.4, 3.2, e), 0);
        wantFov = 46;
      }
      ctrlF.set(0, 0, 1);
      subject = wantPos.distanceTo(wantAim);
      const boundary = (t % SHOT) < dt * 1.5;
      if (boundary) cutNext = true;
      write(dt);
    },

    handle(events, view) {
      for (const e of events) handleOne(e, view);
    },

    cue(kind: CameraCue, at?: V3, seconds?: number) {
      const dur = seconds ?? 4;
      if (kind === "intro") {
        introOn = true;
        introT = 0;
        cutNext = true;
        return;
      }
      if (kind === "inbound") return;
      if (kind === "dunk") {
        if (src && at) highlight(src, "dunk", 5, at, at.x >= 0 ? 1 : -1, -1);
        if (!replaysOn) {
          forced = "slam";
          forcedLeft = seconds ?? 2.2;
          forcedHasAt = !!at;
          if (at) forcedAt.set(at.x, at.y, at.z);
        }
        return;
      }
      forced = kind === "freeThrow" ? "freeThrow" : kind === "timeout" ? "timeout" : kind === "periodEnd" ? "periodBreak"
        : kind === "gameEnd" ? "final" : "tipoff";
      forcedLeft = dur;
      forcedHasAt = !!at;
      if (at) forcedAt.set(at.x, at.y, at.z);
    },

    shake(strength) {
      trauma = clamp(Math.max(trauma, strength), 0, 1);
    },
    cut() {
      cutNext = true;
      snapGame = true;
    },

    stickToWorld(x, y, out) {
      // right = forward x up, with forward flattened onto the floor
      const fwx = ctrlF.x;
      const fwz = ctrlF.z;
      const m = Math.hypot(fwx, fwz) || 1;
      const fX = fwx / m;
      const fZ = fwz / m;
      return out.set(-fZ * x + fX * y, 0, fX * x + fZ * y);
    },

    toScreen(world, out) {
      v.set(world.x, world.y, world.z).project(camera);
      out.x = (v.x + 1) / 2;
      out.y = (1 - v.y) / 2;
      out.on = v.z > -1 && v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
      return out;
    },

    get focus() {
      return focusDist;
    },
    get cinematic() {
      return CINEMATIC[shot];
    },
    get timeScale() {
      return replay.active ? replaySpeed.x : clamp(ts.x, 0.05, 1);
    },
    get replayView() {
      return replay.view;
    },
    setReplays(on) {
      replaysOn = on;
      if (!on) {
        replay.stop();
        pendT = -1;
      }
    },
    skip() {
      if (replay.active) {
        replay.stop();
        snapGame = true;
        cutNext = true;
      } else if (introOn) {
        introOn = false;
        cutNext = false;
      }
    },
    get bug() {
      return replay.active ? "REPLAY" : null;
    },
  };

  function handleOne(e: GameEvent, view: SimView) {
    switch (e.type) {
      case "shotStart": {
        if (replaysOn || (e.kind !== "dunk" && e.kind !== "alleyOopDunk")) break;
        const p = view.players[e.slot];
        const mine = view.userTeam !== -1 && p.team === view.userTeam;
        const big = e.kind === "alleyOopDunk" || view.state.clutch || view.state.hype > 0.75;
        if (!(mine || big || Math.random() < 0.3)) break;
        slamOn = true;
        slamSlot = e.slot;
        slamSide = view.dir(p.team);
        slamUntil = view.time + 2.4;
        slamZ = p.pos.z >= 0 ? -1 : 1;
        break;
      }
      case "dunk": {
        hit(0.1, 0.085);
        rig.shake(0.5);
        kick(fovKick, -2.4, 7);
        if (slamOn) slamUntil = view.time + 0.95;
        const p = view.players[e.slot];
        const mine = view.userTeam !== -1 && p.team === view.userTeam;
        const style = e.style === "windmill" || e.style === "tomahawk" || e.style === "reverse" || e.style === "cuff";
        highlight(view, "dunk", 2 + (mine ? 2 : 0) + (style ? 1 : 0) + (view.state.clutch ? 1 : 0), e.at, e.side, e.slot);
        break;
      }
      case "block":
        if (e.goaltend) break;
        hit(0.2, 0.07);
        rig.shake(0.3);
        kick(fovKick, -1.2, 8);
        highlight(view, "block", view.userTeam !== -1 && view.players[e.by].team === view.userTeam ? 3 : 2, e.at, e.at.x >= 0 ? 1 : -1, e.by);
        break;
      case "ankleBreaker": {
        hit(0.3, 0.2);
        kick(fovKick, -1.8, 6);
        const vp = view.players[e.victim].pos;
        const mine = view.userTeam !== -1 && view.players[e.by].team === view.userTeam;
        highlight(view, "ankle", mine ? 4 : 3, vp, vp.x >= 0 ? 1 : -1, e.by);
        break;
      }
      case "steal":
        kick(fovKick, -0.8, 8);
        break;
      case "buzzer":
        if (e.kind !== "shotClock" && view.ball.mode === "shot" && view.ball.shot) {
          buzzOn = true;
          buzzHold = -1;
          buzzShooter = view.ball.shot.shooter;
          buzzTarget = view.ball.shot.target;
          buzzFrom.copy(view.ball.shot.from);
          slowTarget = 0.4;
        }
        break;
      case "make":
        if (buzzOn && buzzHold < 0 && e.slot === buzzShooter) {
          buzzHold = 0;
          highlight(view, "buzzer", 6, e.at, e.side, e.slot);
          rig.shake(0.25);
        } else if (view.state.clutch && e.points === 3) rig.shake(0.15);
        break;
      case "miss":
        if (buzzOn && buzzHold < 0 && e.slot === buzzShooter) buzzHold = 0.3;
        break;
      case "timeout":
        timeoutTeam = e.team;
        break;
      case "gameEnd":
        winner = e.winner;
        break;
      default:
        break;
    }
  }

  return rig;
}
