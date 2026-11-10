import * as THREE from "three";
import type {
  BroadcastCue, CameraCue, CameraMode, CameraRig, Dir, GameEvent, PlayerState, ScreenPoint, SimView, StatLine, TeamSide, V3,
} from "./contracts";
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
  halfIn: number; // half-width of court framed in a half-court set, meters (about midcourt to baseline)
  halfOut: number; // half-width framed in transition
  pitch: number; // downward tilt, degrees
  maxYaw: number; // pan limit off perpendicular to the sideline, degrees
}
// Zoom follows the state of play (half court vs transition), never the spread of the ten: a broadcast holds its lens.
const BROADCAST: SideRig = { back: 11.5, h: 9.0, truck: 0.9, halfIn: 9.5, halfOut: 11.2, pitch: 25, maxYaw: 12 };
const HIGH: SideRig = { back: 14.5, h: 14.5, truck: 0.8, halfIn: 10.8, halfOut: 12.6, pitch: 33, maxYaw: 12 };
const SKY: SideRig = { back: 2.2, h: 19, truck: 0.92, halfIn: 11.2, halfOut: 13, pitch: 62, maxYaw: 8 };

// pregame intro: flyover with the matchup card, then each starting five
const FLY_T = 3.6;
const LINEUP_T = 4.0;
// replay wipe: seconds to cover the frame, then to reveal it
const WIPE_IN = 0.3;
const WIPE_OUT = 0.34;

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
  const wide = spring(0.5); // 0 half-court framing .. 1 transition framing
  let wideWant = 0.5;
  let gameFov = 30;
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
  let introPart = -1; // 0 flyover, 1 away five, 2 home five
  let lineupK = -1; // starter on camera during a lineup part
  let poseSub = 0; // sub-shot index inside a multi-part shot (timeout: crane, then huddle)

  // presentation cues for the HUD (BroadcastCue), drained by takeCues()
  const cueQ: BroadcastCue[] = [];
  const cueOut: BroadcastCue[] = [];
  let lastPossession: TeamSide | -1 = -1;
  let lastFtCue = -1e9;
  const milestone = [new Uint8Array(32), new Uint8Array(32)]; // per team, per roster index: last points milestone shown (/5)

  // replay wipe: -1 idle, 0..1 covering, 1..2 revealing; the pending action fires at full cover
  let wipe = -1;
  let wipeAct: 0 | 1 | 2 = 0; // 1 start the replay, 2 end it
  let wipeRate = 1;
  let wipeFrom = 0;
  let wipeTo = 0;

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
  let lastReplayPeriod = -1;
  let replayEventT = 0;
  let replayKind: "dunk" | "ankle" | "block" | "buzzer" = "dunk";
  const replayAt = new THREE.Vector3();
  let replaySide: Dir = 1;
  let replaySlot = -1;
  let replayA0 = 0;
  let replayZs: 1 | -1 = 1; // dunk replay: which side of the lane the camera stands on
  let replayPicked = false;
  const replaySpeed = spring(1);

  // scratch
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();

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
    lastReplayPeriod = -1;
    replay.reset();
    hitT = 0;
    slowTarget = 1;
    snap(ts, 1);
    snap(replaySpeed, 1);
    snapGame = true;
    cutNext = true;
    winner = -1;
    wipe = -1;
    wipeAct = 0;
    lastPossession = -1;
    lastFtCue = -1e9;
    milestone[0].fill(0);
    milestone[1].fill(0);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // gameplay
  // ---------------------------------------------------------------------------------------------------------------
  function attackDir(view: SimView): Dir {
    const p = view.state.possession;
    if (p === 0 || p === 1) lastDir = view.dir(p);
    return lastDir;
  }

  /** Smoothed focus x/z from the ball and its motion, and the half-court / transition framing factor. */
  function gameFocus(view: SimView, dt: number) {
    const s = view.state;
    const b = view.ball;
    const d = attackDir(view);
    let tx = b.pos.x;
    let tz = b.pos.z;
    const trans = Math.abs(ballVx.x) > 3.5;
    const front = b.pos.x * d > -2; // past the 28 ft mark of the attack half
    if (b.mode === "shot" && b.shot) {
      tx = mix(b.pos.x, basketX(b.shot.target), 0.5);
    } else if (b.mode === "pass" && b.pass) {
      tx = mix(b.pos.x, b.pass.end.x, 0.55);
      tz = mix(b.pos.z, b.pass.end.z, 0.5);
    } else {
      tx += clamp(ballVx.x * 0.3, -3, 3);
    }
    // half court: lean toward the attacked rim so the basket sits about three quarters across the frame
    if (front && !trans) tx = mix(tx, d * (COURT.rimX - 5.5), 0.45);
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
    const lim = COURT.halfL - 5;
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

    // framing from the state of play, held while a shot is in the air
    if (b.mode !== "shot") {
      const ph = s.phase;
      if (ph === "live") wideWant = trans ? 1 : front ? 0 : 0.45;
      else if (ph === "freeThrow") wideWant = 0.1;
      else wideWant = 0.35;
    }

    if (snapGame) {
      snap(fx, tx);
      snap(fz, tz);
      snap(wide, wideWant);
    } else {
      springTo(fx, tx, 3.4, dt);
      springTo(fz, tz, 2, dt);
      springTo(wide, wideWant, 1.0, dt);
    }
  }

  function sidePose(r: SideRig) {
    // sideline rail: the dolly trucks with most of the play and creeps in a little when the play is on the far side
    const fzz = fz.x;
    wantPos.set(fx.x * r.truck, r.h, -(COURT.halfW + r.back - clamp(fzz, 0, 6) * 0.25));
    // frame centre on the play's depth (not the near floor), within a pitch band that keeps the crowd strip thin
    const aimY = 1.0;
    const centreZ = fzz * 0.5 + 0.6;
    const pitch = clamp(Math.atan2(r.h - aimY, centreZ - wantPos.z), (r.pitch - 3.5) / DEG, (r.pitch + 2) / DEG);
    const reach = (r.h - aimY) / Math.tan(pitch); // floor distance of the frame centre
    let yaw = Math.atan2(fx.x - wantPos.x, fzz * 0.5 - wantPos.z);
    const ym = r.maxYaw / DEG;
    yaw = clamp(yaw, -ym, ym);
    wantAim.set(wantPos.x + Math.sin(yaw) * reach, aimY, wantPos.z + Math.cos(yaw) * reach);
    const halfW = mix(r.halfIn, r.halfOut, clamp(wide.x, 0, 1));
    const dist = Math.hypot(fx.x - wantPos.x, r.h - aimY, fzz * 0.5 - wantPos.z);
    wantFov = fovFor(halfW, dist, 14, 50);
    ctrlF.set(0, 0, 1);
  }

  function gamePose(view: SimView, dt: number) {
    gameFocus(view, dt);
    const b = view.ball;
    if (mode === "broadcast" || mode === "broadcastHigh" || mode === "skycam") {
      sidePose(mode === "broadcast" ? BROADCAST : mode === "skycam" ? SKY : HIGH);
      // a jumper in flight: a small tilt only, the frame holds still while the user shoots
      let up = clamp(b.pos.y - 3, 0, 4) * 0.08;
      if (b.mode === "shot") up += clamp(b.pos.y - 2.2, 0, 5) * 0.12;
      wantAim.y += Math.min(0.6, up);
      // the lens never breathes faster than 4 deg/s in live play
      if (snapGame) gameFov = wantFov;
      else gameFov += clamp(wantFov - gameFov, -4 * dt, 4 * dt);
      wantFov = gameFov;
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
      wantPos.set(fp.x - sx * 6.9, 3.7, fp.z - sz * 6.9);
      // never behind the end line (the stanchion fills the lens there) and never under a backboard
      const lim = COURT.halfL - 0.5;
      if (Math.abs(wantPos.x) > lim) wantPos.x = Math.sign(wantPos.x) * lim;
      wantPos.z = clamp(wantPos.z, -COURT.halfW - 1.5, COURT.halfW + 1.5);
      const underBoard = Math.abs(wantPos.x) > COURT.rimX - 1.8 && Math.abs(wantPos.z) < 2.6;
      if (underBoard) wantPos.y = 5.2;
      wantAim.set(fp.x + sx * 4.5, 1.3, fp.z + sz * 4.5);
      wantFov = 50;
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
    if (shotT < 2.8) {
      const u = smoother(shotT / 2.8);
      wantPos.set(mix(-7, 5, u), mix(5.5, 8.5, u), -COURT.halfW - 7.5);
      wantAim.set(mix(-3, 2, u), mix(1.2, 1.9, u), 2.5);
      wantFov = 48;
      subject = 18;
      ctrlF.set(0, 0, 1);
      return;
    }
    if (poseSub === 0) {
      poseSub = 1;
      cutNext = true;
    }
    centroid(view, timeoutTeam, v);
    const a = -0.5 + (shotT - 2.8) * 0.09;
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

  function introPose(dt: number, view: SimView) {
    introT += dt;
    // without the pregame hold (sim already tossing the ball) only a short flyover fits before the jump
    const held = view.state.phase === "pregame";
    if (!held && introT > 1.1) {
      endIntro();
      tipoffPose();
      return;
    }
    // short games get a short intro: about 6 s when quarters are 3 minutes or less
    const k = view.state.periodLength <= 180 ? 0.55 : 1;
    const FLY = FLY_T * k;
    const LINE = LINEUP_T * k;
    const part = introT < FLY ? 0 : introT < FLY + LINE ? 1 : 2;
    if (part !== introPart) {
      if (introPart >= 0) cutNext = true;
      introPart = part;
      lineupK = -1;
      if (part === 0) push({ kind: "matchup", seconds: FLY - 0.3 });
      else push({ kind: "lineup", team: part === 1 ? 1 : 0, seconds: LINE - 0.15 });
    }
    if (part === 0) {
      const u = smoother(clamp(introT / FLY, 0, 1));
      introPath.getPoint(u, wantPos);
      introAim.getPoint(u, wantAim);
      wantFov = mix(50, fovFor(5.2, 13.2, 28, 44), u);
      subject = wantPos.distanceTo(wantAim);
    } else {
      // each starter in turn from over his shoulder (name and number on the back), a cut between players
      const team: TeamSide = part === 1 ? 1 : 0;
      const local = introT - (part === 1 ? FLY : FLY + LINE);
      const seg = LINE / 5;
      const k = clamp(Math.floor(local / seg), 0, 4);
      if (k !== lineupK) {
        if (lineupK >= 0) cutNext = true;
        lineupK = k;
      }
      const f = clamp(local / seg - k, 0, 1);
      const p = view.players[team * 5 + k];
      const fx0 = Math.sin(p.facing);
      const fz0 = Math.cos(p.facing);
      const side = k % 2 === 0 ? 1 : -1;
      const slide = side * mix(0.55, 1.05, f);
      wantPos.set(p.pos.x - fx0 * 3.1 - fz0 * slide, 1.75 - f * 0.12, p.pos.z - fz0 * 3.1 + fx0 * slide);
      inBowl();
      wantAim.set(p.pos.x + fx0 * 0.6, 1.5 + p.height * 0.05, p.pos.z + fz0 * 0.6);
      wantFov = 30;
      subject = wantPos.distanceTo(wantAim);
    }
    ctrlF.set(0, 0, 1);
    if (introT >= FLY + LINE * 2) endIntro();
  }

  function endIntro() {
    if (!introOn) return;
    introOn = false;
    introPart = -1;
    cutNext = true;
  }

  // the same card twice inside 1.5 s (two events for one moment) would restart its animation: drop the repeat
  const cueSeen = new Map<string, number>();
  function push(c: BroadcastCue) {
    const r = c as { kind: string; title?: string; team?: number; on?: boolean };
    const key = `${r.kind}|${r.title ?? ""}|${r.team ?? ""}|${r.on ?? ""}`;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - (cueSeen.get(key) ?? -1e9) < 1500) return;
    cueSeen.set(key, now);
    if (cueQ.length < 16) cueQ.push(c);
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

  /** Players standing between a camera at (cx, cz) and the target (tx, tz), the subject excluded. */
  function occluders(rv: SimView, cx: number, cz: number, tx: number, tz: number, skip: number): number {
    const dx = tx - cx, dz = tz - cz;
    const L2 = dx * dx + dz * dz || 1;
    let n = 0;
    for (let i = 0; i < rv.players.length; i++) {
      if (i === skip) continue;
      const p = rv.players[i].pos;
      const k = clamp(((p.x - cx) * dx + (p.z - cz) * dz) / L2, 0, 1);
      if (k < 0.15 || k > 0.97) continue;
      const ex = cx + dx * k - p.x, ez = cz + dz * k - p.z;
      if (ex * ex + ez * ez < 0.75 * 0.75) n++;
    }
    return n;
  }

  /** Once per replay: the orbit side and start angle with the fewest bodies between the lens and the subject. */
  function pickReplayAngle(rv: SimView) {
    replayPicked = true;
    const sub = replaySlot >= 0 ? rv.players[replaySlot].pos : rv.ball.pos;
    let best = 1e9;
    if (replayKind === "dunk") {
      const rx = basketX(replaySide);
      for (const zs of [1, -1] as const) {
        for (const a0 of [-0.3, 0.1, 0.5]) {
          const phi = a0 * 0.9 + 0.15;
          const n = occluders(rv, rx - replaySide * Math.sin(phi) * 5.6, -zs * Math.cos(phi) * 5.6, sub.x, sub.z, replaySlot) + Math.random() * 0.3;
          if (n < best) {
            best = n;
            replayA0 = a0;
            replayZs = zs;
          }
        }
      }
      return;
    }
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2;
      const cx = replayAt.x + Math.sin(a0) * 5.6, cz = replayAt.z - Math.cos(a0) * 5.6;
      // stay on the floor side of the stands
      const off = Math.abs(cz) > COURT.halfW + 2.5 || Math.abs(cx) > COURT.halfL + 1.5 ? 2 : 0;
      const n = occluders(rv, cx, cz, sub.x, sub.z, replaySlot) + off + Math.random() * 0.3;
      if (n < best) {
        best = n;
        replayA0 = a0;
      }
    }
  }

  function replayPose(view: SimView, dt: number) {
    const rv = replay.view ?? view;
    if (!replayPicked && replay.view) pickReplayAngle(rv);
    const t = replay.t - replayEventT; // negative before the highlight moment
    // follow the shooter through his release, then the ball to the rim (never the crowd of players at the other end)
    if (replaySlot >= 0 && (replayKind !== "buzzer" || t < -0.9)) w.copy(rv.players[replaySlot].pos).setY(1.3 + rv.players[replaySlot].pos.y);
    else w.copy(rv.ball.pos);
    const a = replayA0 + t * 0.32;
    if (replayKind === "dunk") {
      const rx = basketX(replaySide);
      const r = 5.6;
      // beside the rim on the near side (profile of the dunker), sweeping out toward the court
      const phi = a * 0.9 + 0.15;
      wantPos.set(rx - replaySide * Math.sin(phi) * r, mix(1.3, 2.7, smooth((t + 2) / 3.2)), -replayZs * Math.cos(phi) * r);
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
    poseSub = 0;
    let blend = 0;
    if (prev === "freeThrow" && next === "game") blend = 0.45;
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
    // broadcast restraint: at most one auto replay per quarter, and only for a dunk; a buzzer-beater always gets one
    const per = view.state.period;
    if (pendKind !== "buzzer" && (pendKind !== "dunk" || per === lastReplayPeriod || view.time - lastReplayAt < 40)) {
      pendT = -1;
      return;
    }
    const pre = pendKind === "dunk" ? 2.2 : pendKind === "buzzer" ? 2.6 : 1.8;
    const [a, b] = replay.span();
    if (Math.min(pendT + 1.1, b) - Math.max(pendT - pre, a) >= 0.6 && wipe < 0) {
      wipeFrom = pendT - pre;
      wipeTo = pendT + 1.1;
      replayEventT = pendT;
      replayKind = pendKind;
      replayAt.copy(pendAt);
      replaySide = pendSide;
      replaySlot = pendSlot;
      startWipe(1, 1);
    }
    pendT = -1;
  }

  function startWipe(act: 1 | 2, speed: number) {
    wipe = 0;
    wipeAct = act;
    wipeRate = speed;
    // the HUD hides as the wipe starts covering the frame, not after: no scorebug ghosting under the wipe
    if (act === 1) push({ kind: "replay", on: true });
  }

  /** Advance the wipe in real time; the cut (replay start or end) happens under full cover. */
  function stepWipe(dt: number) {
    if (wipe < 0) return;
    const before = wipe;
    wipe += (dt * wipeRate) / (wipe < 1 ? WIPE_IN : WIPE_OUT);
    if (before < 1 && wipe >= 1) {
      wipe = 1;
      if (wipeAct === 1) {
        if (replay.start(wipeFrom, wipeTo)) {
          replayA0 = (Math.random() - 0.5) * 0.8;
          replayZs = 1;
          replayPicked = false;
          lastReplayAt = src ? src.time : 0;
          lastReplayPeriod = src ? src.state.period : -1;
          snap(replaySpeed, 1);
        } else push({ kind: "replay", on: false });
      } else if (wipeAct === 2) {
        replay.stop();
        snapGame = true;
        push({ kind: "replay", on: false });
      }
      wipeAct = 0;
      cutNext = true;
    }
    if (wipe >= 2) wipe = -1;
  }

  function stepReplay(dt: number) {
    const near = Math.abs(replay.t - replayEventT) < 0.6;
    springTo(replaySpeed, near ? 0.32 : 1, 6, dt);
    // the last frame holds under the outgoing wipe
    if (!replay.advance(dt * replaySpeed.x) && wipe < 0) startWipe(2, 1);
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
    camera.userData.wipe = wipe < 0 ? 0 : wipe;
    camera.userData.replay = replay.active ? 1 : 0;

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
      if (!replay.active && wipe < 0) tryReplay(view);
      stepWipe(dt);
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
          // runs on the match clock: frozen while the game sits paused behind the pregame screen
          introPose(simDt > 0 ? dt : 0, view);
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
      attackCue(view);
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
        wipe = -1;
        wipeAct = 0;
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
        introPart = -1;
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
        if (wipe < 0) startWipe(2, 1.6);
      } else if (introOn && introT > 0.6) {
        endIntro();
        push({ kind: "clear" });
      }
    },
    get bug() {
      return replay.active ? "REPLAY" : null;
    },
    get introActive() {
      return introOn;
    },
    takeCues() {
      cueOut.length = 0;
      for (const c of cueQ) cueOut.push(c);
      cueQ.length = 0;
      return cueOut;
    },
  };

  /** The user's team just won the ball: tell the HUD which way is up the floor on screen. */
  function attackCue(view: SimView) {
    const p = view.state.possession;
    if (p === lastPossession) return;
    lastPossession = p;
    const ut = view.userTeam;
    if (ut === -1 || p !== ut || introOn || shot !== "game") return;
    const d = view.dir(ut);
    v.set(basketX(d), 1, 0).project(camera);
    w.set(-basketX(d), 1, 0).project(camera);
    push({ kind: "attack", team: ut, screen: v.x >= w.x ? 1 : -1, seconds: 1.4 });
  }

  const nameOf = (view: SimView, slot: number) => {
    const d = view.players[slot].data;
    return `${d.first ? d.first[0] + ". " : ""}${d.last}`.toUpperCase();
  };
  const boxOf = (view: SimView, slot: number): StatLine | null => {
    const p = view.players[slot];
    return view.teams[p.team].box[p.rosterIndex] ?? null;
  };
  function statLine(l: StatLine, withFt: boolean) {
    let t = `${l.pts} PTS · ${l.fgm}-${l.fga} FG`;
    if (l.tpa >= 2) t += ` · ${l.tpm}-${l.tpa} 3PT`;
    if (withFt && l.fta > 0) t += ` · ${l.ftm}-${l.fta} FT`;
    const reb = l.oreb + l.dreb;
    if (reb >= 4) t += ` · ${reb} REB`;
    if (l.ast >= 4) t += ` · ${l.ast} AST`;
    return t;
  }
  const pct = (m: number, a: number) => (a > 0 ? `${Math.round((100 * m) / a)}%` : "-");
  function periodTitle(period: number) {
    if (period === 2) return "HALFTIME";
    if (period === 1) return "END OF 1ST";
    if (period === 3) return "END OF 3RD";
    if (period === 4) return "END OF REGULATION";
    return `END OF ${period === 5 ? "" : period - 4}OT`;
  }

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
      case "make": {
        const p = view.players[e.slot];
        const l = boxOf(view, e.slot);
        const m = milestone[p.team];
        if (l && p.rosterIndex < m.length && e.kind !== "freeThrow") {
          const step = Math.floor(l.pts / 5);
          if (l.pts >= 10 && step > m[p.rosterIndex]) {
            m[p.rosterIndex] = step;
            push({ kind: "lowerThird", team: p.team, slot: e.slot, title: nameOf(view, e.slot), line: statLine(l, true), seconds: 3 });
          }
        }
        if (buzzOn && buzzHold < 0 && e.slot === buzzShooter) {
          buzzHold = 0;
          highlight(view, "buzzer", 6, e.at, e.side, e.slot);
          rig.shake(0.25);
        } else if (view.state.clutch && e.points === 3) rig.shake(0.15);
        break;
      }
      case "miss":
        if (buzzOn && buzzHold < 0 && e.slot === buzzShooter) buzzHold = 0.3;
        break;
      case "timeout": {
        timeoutTeam = e.team;
        // the calling team's leading scorer
        let best = -1;
        let bp = -1;
        for (let s = e.team * 5; s < e.team * 5 + 5; s++) {
          const l = boxOf(view, s);
          if (l && l.pts > bp) {
            bp = l.pts;
            best = s;
          }
        }
        const l = best >= 0 ? boxOf(view, best) : null;
        if (l && l.fga > 0) {
          const t = view.teams[e.team].data;
          push({ kind: "lowerThird", team: e.team, slot: best, title: nameOf(view, best), line: `LEADS ${t.abbr.toUpperCase()} · ${statLine(l, true)}`, seconds: 4.5 });
        }
        break;
      }
      case "freeThrowStart": {
        if (e.index !== 1 || view.time - lastFtCue < 3) break;
        lastFtCue = view.time;
        const l = boxOf(view, e.slot);
        const p = view.players[e.slot];
        if (!l) break;
        const line = l.fga + l.fta > 0
          ? `TONIGHT · ${statLine(l, true)}`
          : `SEASON · ${p.data.season.ppg.toFixed(1)} PPG · ${Math.round(p.data.season.ftPct > 1 ? p.data.season.ftPct : p.data.season.ftPct * 100)}% FT`;
        push({ kind: "lowerThird", team: p.team, slot: e.slot, title: nameOf(view, e.slot), line, seconds: 3.2 });
        break;
      }
      case "periodEnd": {
        if (view.state.phase === "final") break;
        const h = view.teams[0].totals;
        const a = view.teams[1].totals;
        push({
          kind: "compare", title: periodTitle(e.period), seconds: 5,
          rows: [
            { label: "FG", home: `${h.fgm}-${h.fga}  ${pct(h.fgm, h.fga)}`, away: `${a.fgm}-${a.fga}  ${pct(a.fgm, a.fga)}` },
            { label: "3PT", home: `${h.tpm}-${h.tpa}`, away: `${a.tpm}-${a.tpa}` },
            { label: "REB", home: `${h.oreb + h.dreb}`, away: `${a.oreb + a.dreb}` },
            { label: "AST", home: `${h.ast}`, away: `${a.ast}` },
            { label: "TOV", home: `${h.tov}`, away: `${a.tov}` },
          ],
        });
        break;
      }
      case "gameEnd":
        winner = e.winner;
        break;
      default:
        break;
    }
  }

  return rig;
}
