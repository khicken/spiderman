// HOLLOWMERE audio: createAudio(ac) wires the rig, the score, the ambience and the SFX to the game.
// Every public method catches its own errors. The AudioContext comes from game.ts (created on the first gesture).
import { LAKE, SEA_LEVEL } from "./contracts";
import type { Audio, FrameCtx, GameEvent } from "./contracts";
import { createAmbience, type AmbInput, type Ambience } from "./audio-ambience";
import { Rig, clamp, createRig } from "./audio-dsp";
import { createMusic, type Music, type MusicState } from "./audio-music";
import { createSfx, type Sfx } from "./audio-sfx";

export interface AudioPlus extends Audio {
  setAmbienceVolume(v: number): void;
  lab: { rig: Rig; music: Music; sfx: Sfx; amb: Ambience; pump(until: number): void } | null;
}

export interface AudioOpts {
  manual?: boolean; // offline rendering: no timers, no voice budget; call lab.pump(until)
  seed?: number;
  lite?: boolean;
}

const ALERTED = new Set(["alert", "chase", "windup", "attack", "recover", "stunned", "hurt"]);
const DIRS = 8;
const RADII = [2, 6, 12, 22, 36];
const DX: number[] = [];
const DZ: number[] = [];
for (let i = 0; i < DIRS; i++) {
  DX.push(Math.cos((i / DIRS) * Math.PI * 2));
  DZ.push(Math.sin((i / DIRS) * Math.PI * 2));
}
const BIRDY: Record<string, number> = { whisperwood: 1, village: 0.8, shrine: 0.6, lake: 0.5, cliffs: 0.25, cinder: 0, spire: 0 };

function silent(): AudioPlus {
  return {
    update() {}, handle() {}, ui() {}, setVolumes() {}, menuMusic() {}, suspend() {}, dispose() {},
    setAmbienceVolume() {}, lab: null,
  };
}

export function createAudio(ac: AudioContext, opts: AudioOpts = {}): AudioPlus {
  try {
    return build(ac, opts);
  } catch (err) {
    console.warn("audio disabled:", err);
    return silent();
  }
}

function build(ac: BaseAudioContext, opts: AudioOpts): AudioPlus {
  const lite =
    opts.lite ?? (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
  const rig = createRig(ac, { manual: opts.manual, lite });
  const music = createMusic(rig, { seed: opts.seed });
  const sfx = createSfx(rig);
  const amb = createAmbience(rig);
  const st: MusicState = music.state;

  let master = 1;
  let musicVol = 1;
  let sfxVol = 1;
  let ambVol = 1;
  let userSuspended = false;
  let hidden = typeof document !== "undefined" && document.hidden;
  let acc = 0;
  let combatT = 0;
  let bossFlag = false;
  let disposed = false;
  const input: AmbInput = { daylight: 1, rain: 0, wind: 0, altitude: 0, gliding: false, water: 0, waterKind: 0, waterPan: 0, birdy: 0.4 };
  const sf = { hp: 0, maxHp: 0, charging: 0, wet: 0 };

  const safe = (fn: () => void) => {
    try { fn(); } catch { /* audio never throws into the game loop */ }
  };

  function applyVolumes(immediate: boolean) {
    const now = ac.currentTime;
    const set = (p: AudioParam, v: number) => {
      if (immediate) p.setValueAtTime(v, now);
      else p.setTargetAtTime(v, now, 0.03);
    };
    set(rig.master.gain, 0.9 * master);
    set(rig.musicBus.gain, 0.42 * musicVol);
    set(rig.sfxBus.gain, 0.9 * sfxVol);
    set(rig.ambBus.gain, 0.55 * sfxVol * ambVol);
  }

  function applyRun() {
    const ctx = ac as AudioContext;
    const want = !(userSuspended || hidden);
    if (!ctx.suspend || !ctx.resume) return;
    if (want && ctx.state !== "running") ctx.resume().catch(() => {});
    else if (!want && ctx.state === "running") ctx.suspend().catch(() => {});
  }
  const onVis = () => {
    hidden = document.hidden;
    safe(applyRun);
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

  applyVolumes(true);
  music.start();

  function pan(x: number, z: number): number {
    const L = rig.listener;
    const dx = x - L.x;
    const dz = z - L.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    return clamp(((dx * L.rx + dz * L.rz) / d) * Math.min(1, d / 6), -0.9, 0.9);
  }

  function slow(ctx: FrameCtx, dt: number) {
    const p = ctx.player;
    let near = 0;
    let boss = 0;
    for (let i = 0; i < ctx.enemies.length; i++) {
      const e = ctx.enemies[i];
      if (!e.alive) continue;
      if (e.kind === "warden") {
        if (e.brain !== "idle") boss = Math.max(boss, clamp(e.phase || 1, 1, 3));
        continue;
      }
      if (!ALERTED.has(e.brain)) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      if (dx * dx + dz * dz < 625) near++;
    }
    combatT = near > 0 ? 6 : Math.max(0, combatT - dt);
    st.combat = combatT > 0;
    st.boss = boss > 0 ? boss : bossFlag ? 1 : 0;
    const dl = ctx.env.daylight;
    if (dl < 0.28) st.night = true;
    else if (dl > 0.42) st.night = false;

    input.daylight = dl;
    input.rain = ctx.env.rain;
    input.wind = Math.min(1, Math.hypot(ctx.env.wind.x, ctx.env.wind.y) / 14);
    input.altitude = clamp(p.pos.y / 200);
    input.gliding = p.mode === "glide";
    const area = ctx.world.areaAt(p.pos.x, p.pos.z);
    input.birdy = area ? (BIRDY[area.id] ?? 0.3) : 0.4;

    let wd = 99;
    let lvl = SEA_LEVEL;
    let wdx = 0;
    let wdz = 0;
    const here = ctx.world.waterAt(p.pos.x, p.pos.z);
    if (here > -Infinity && (p.mode === "swim" || here > p.pos.y - 0.5)) {
      wd = 0;
      lvl = here;
    } else {
      for (let ri = 0; ri < RADII.length && wd === 99; ri++) {
        for (let k = 0; k < DIRS; k++) {
          const w = ctx.world.waterAt(p.pos.x + DX[k] * RADII[ri], p.pos.z + DZ[k] * RADII[ri]);
          if (w > -Infinity) {
            wd = RADII[ri];
            lvl = w;
            wdx = DX[k];
            wdz = DZ[k];
            break;
          }
        }
      }
    }
    input.water = wd === 99 ? 0 : Math.pow(clamp(1 - wd / 40), 1.2);
    input.waterKind = Math.abs(lvl - SEA_LEVEL) < 1 ? 0 : lvl >= LAKE.level - 1 ? 1 : 2;
    input.waterPan = wd === 99 ? 0 : pan(rig.listener.x + wdx * wd, rig.listener.z + wdz * wd);

    amb.set(input, ac.currentTime, dt);
    sf.hp = p.hp;
    sf.maxHp = p.maxHp;
    sf.charging = p.action === "charge" ? p.charge : 0;
    sf.wet = ctx.env.wet;
    sfx.update(ac.currentTime, sf);
  }

  const out: AudioPlus = {
    lab: { rig, music, sfx, amb, pump: (until: number) => music.pump(until) },
    update(ctx) {
      safe(() => {
        const m = ctx.camera?.matrixWorld?.elements;
        const L = rig.listener;
        if (m) {
          L.x = m[12]; L.y = m[13]; L.z = m[14];
          const len = Math.hypot(m[0], m[2]) || 1;
          L.rx = m[0] / len;
          L.rz = m[2] / len;
        } else {
          L.x = ctx.player.pos.x; L.y = ctx.player.pos.y; L.z = ctx.player.pos.z;
        }
        acc += ctx.realDt;
        if (acc < 0.125) return;
        const dt = acc;
        acc = 0;
        slow(ctx, dt);
      });
    },
    handle(events: readonly GameEvent[]) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        safe(() => {
          switch (e.type) {
            case "beaconLit": music.sting("beacon"); break;
            case "bossWake": bossFlag = true; break;
            case "bossDefeated": bossFlag = false; music.sting("victory"); break;
            case "died": music.sting("death"); break;
            case "rest": music.sting("rest"); break;
            case "ending": st.ending = true; break;
            case "trialStart": st.trial = true; break;
            case "trialDone":
            case "trialFail": st.trial = false; break;
            case "thunder": amb.thunder(e.delay, pan(e.pos.x, e.pos.z)); return;
            case "dawn": amb.chirpNow(4); break;
            default: break;
          }
          sfx.handle(e);
        });
      }
    },
    ui(cue) {
      safe(() => sfx.ui(cue));
    },
    setVolumes(m, mu, sf2) {
      safe(() => {
        master = clamp(m);
        musicVol = clamp(mu);
        sfxVol = clamp(sf2);
        applyVolumes(false);
      });
    },
    setAmbienceVolume(v) {
      safe(() => {
        ambVol = clamp(v);
        applyVolumes(false);
      });
    },
    menuMusic(on) {
      st.menu = on;
    },
    suspend(on) {
      safe(() => {
        userSuspended = on;
        applyRun();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      safe(() => {
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
        music.dispose();
        sfx.dispose();
        amb.dispose();
        rig.dispose();
      });
    },
  };
  return out;
}
