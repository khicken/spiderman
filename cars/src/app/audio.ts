import type * as THREE from "three";
import type { Audio, CarId, CarSpec, EngineVoice, MapId, MusicState, Sfx, Weather } from "./contracts";
import { createAmbience } from "./audio-ambience";
import { workletCode } from "./audio-code";
import { type Space, clamp, gain, impulse, masterChain } from "./audio-dsp";
import { type Ears, type VoiceCtl, createVoice } from "./audio-engine";
import { musicNode } from "./audio-music";
import { HORN_CARS, SFX, bakeSfx } from "./audio-sfx";
import { loadWorklet } from "./audio-worklet";

let warned = 0;
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    if (warned++ < 8) console.warn("audio", e);
    return fallback;
  }
}

const CITY: MapId[] = ["tokyo", "sanfrancisco", "monaco"];
const SFX_ORDER: Sfx[] = ["click", "hover", "beep", "go", "shift", "impact", "scrape", "curb", "backfire", "blowoff", "land", "checkpoint", "lap", "best", "finish", "horn", "rewind", "splash", "join", "leave"];

export function createAudio(): Audio {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  void ctx.resume().catch(() => {});
  const m = masterChain(ctx, ctx.destination);
  const mix = gain(ctx, m.input, 1);
  const engineBus = gain(ctx, mix, 0.9);
  const sfxBus = gain(ctx, mix, 0.8);
  const ambBus = gain(ctx, mix, 0.9);
  const musicVol = gain(ctx, mix, 0.7);
  const musicDuck = gain(ctx, musicVol, 1);
  const musicVerb = ctx.createConvolver();
  musicVerb.buffer = impulse(ctx, "hall");
  musicVerb.connect(musicDuck);

  const envSend = gain(ctx, null, 1);
  engineBus.connect(gain(ctx, envSend, 0.5));
  sfxBus.connect(gain(ctx, envSend, 0.35));
  const spaces = {} as Record<Space, AudioBuffer>;
  const spaceOf = (s: Space) => (spaces[s] ||= impulse(ctx, s));
  const envA = ctx.createConvolver();
  envA.buffer = spaceOf("open");
  const envAGain = gain(ctx, mix, 0.25);
  envA.connect(envAGain);
  envSend.connect(envA);
  let tunnelVerb: ConvolverNode | null = null;
  const tunnelGain = gain(ctx, mix, 0);
  const tunnelOn = (on: boolean) => {
    if (on && !tunnelVerb) {
      tunnelVerb = ctx.createConvolver();
      tunnelVerb.buffer = spaceOf("tunnel");
      tunnelVerb.connect(tunnelGain);
      envSend.connect(tunnelVerb);
    }
    const t = ctx.currentTime;
    tunnelGain.gain.setTargetAtTime(on ? 0.7 : 0, t, on ? 0.25 : 0.4);
    envAGain.gain.setTargetAtTime(on ? 0.05 : 0.25, t, 0.3);
    engineBus.gain.setTargetAtTime(on ? 1.15 : 0.9, t, 0.3);
    amb.setTunnel(on ? 1 : 0);
  };

  const ready = loadWorklet(ctx, workletCode());
  let music: AudioWorkletNode | null = null;
  let musicWant: { state: MusicState; map?: MapId } | null = null;
  void ready.then((ok) => {
    if (!ok || closed) return;
    safe(() => {
      music = musicNode(ctx, musicDuck, musicVerb);
      if (musicWant) music.port.postMessage(musicWant);
    }, undefined);
  });

  const sr = Math.min(ctx.sampleRate, 48000);
  const bank = new Map<string, AudioBuffer>();
  let closed = false;
  void (async () => {
    for (const name of SFX_ORDER) {
      for (let k = 0; k < SFX[name].n; k++) {
        if (closed) return;
        try {
          bank.set(`${name}:${k}`, await bakeSfx(sr, name, k));
        } catch (e) {
          if (warned++ < 8) console.warn("sfx bake", name, e);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  })();

  const amb = createAmbience(ctx, ambBus);
  const ears: Ears = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, wet: 0 };
  let earT = -1;
  const voices = new Set<VoiceCtl>();
  let player: VoiceCtl | null = null;
  let playerCar: CarId = "gt3";
  let inTunnel = false;
  let sfxDuck = 0;

  const live = new Map<Sfx, { end: number; g: GainNode }[]>();
  const last = new Map<Sfx, number>();
  let scrape: { g: GainNode; src: AudioBufferSourceNode; until: number } | null = null;

  function play(name: Sfx, volume: number, at?: THREE.Vector3) {
    const t = ctx.currentTime;
    if (volume <= 0.01) return;
    if (name === "scrape") return scrapeOn(volume);
    if (t - (last.get(name) ?? -1) < 0.035) return;
    const d = SFX[name];
    const k = name === "horn" ? Math.max(0, HORN_CARS.indexOf(playerCar)) : name === "impact" ? (volume > 0.5 ? 2 : 0) + Math.floor(Math.random() * 2) : Math.floor(Math.random() * d.n);
    const buf = bank.get(`${name}:${k}`) ?? bank.get(`${name}:0`);
    if (!buf) return;
    last.set(name, t);
    const list = (live.get(name) ?? []).filter((v) => v.end > t);
    if (list.length >= 4) list.shift()!.g.gain.setTargetAtTime(0, t, 0.02);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const fixed = name === "horn" || d.dur < 0.1 || name === "beep" || name === "go" || name === "checkpoint" || name === "lap" || name === "best" || name === "finish" || name === "join" || name === "leave";
    if (!fixed) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.08;
    const g = gain(ctx, null, d.g * Math.min(1.5, volume));
    src.connect(g);
    let pan: PannerNode | null = null;
    if (at) {
      pan = ctx.createPanner();
      pan.panningModel = "equalpower";
      pan.distanceModel = "inverse";
      pan.refDistance = 6;
      pan.rolloffFactor = 1.2;
      pan.positionX.value = at.x;
      pan.positionY.value = at.y;
      pan.positionZ.value = at.z;
      g.connect(pan).connect(sfxBus);
    } else g.connect(sfxBus);
    src.start(t);
    const end = t + buf.duration;
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      pan?.disconnect();
    };
    list.push({ end, g });
    live.set(name, list);
    if (name === "finish" || name === "best" || name === "lap") sfxDuck = Math.max(sfxDuck, 0.45);
    else if (name === "impact" && volume > 0.6) sfxDuck = Math.max(sfxDuck, 0.25);
  }

  function scrapeOn(volume: number) {
    const t = ctx.currentTime;
    const buf = bank.get("scrape:0");
    if (!buf) return;
    if (!scrape) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = gain(ctx, sfxBus, 0);
      src.connect(g);
      src.start(t, Math.random() * buf.duration);
      scrape = { g, src, until: t };
    }
    scrape.g.gain.setTargetAtTime(SFX.scrape.g * Math.min(1.2, volume), t, 0.02);
    scrape.until = t + 0.15;
  }

  function tick() {
    const t = ctx.currentTime;
    amb.tick();
    if (scrape && t > scrape.until) {
      const s = scrape;
      scrape = null;
      s.g.gain.setTargetAtTime(0, t, 0.06);
      try {
        s.src.stop(t + 0.5);
      } catch {
        /* already stopped */
      }
      s.src.onended = () => {
        s.src.disconnect();
        s.g.disconnect();
      };
    }
    const lvl = player ? player.level : 0;
    musicDuck.gain.setTargetAtTime((1 - 0.22 * lvl) * (1 - sfxDuck), t, sfxDuck > 0 ? 0.03 : 0.25);
    sfxDuck = Math.max(0, sfxDuck - 0.06);
    const tun = !!player?.tunnel;
    if (tun !== inTunnel) {
      inTunnel = tun;
      tunnelOn(tun);
    }
  }
  const timer = setInterval(() => safe(tick, undefined), 100);

  let volume = 1;
  let muted = false;
  const applyVol = () => m.vol.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  const L = ctx.listener;

  return {
    engine(spec: CarSpec, isPlayer: boolean): EngineVoice {
      return safe(
        () => {
          const v = createVoice(ctx, engineBus, spec, isPlayer, ears, ready);
          voices.add(v);
          if (isPlayer) {
            player = v;
            playerCar = spec.id;
          }
          return {
            update: (i) => v.update(i),
            dispose: () =>
              safe(() => {
                voices.delete(v);
                if (player === v) player = null;
                v.dispose();
              }, undefined),
          };
        },
        { update() {}, dispose() {} },
      );
    },
    sfx: (name, o) => safe(() => play(name, o?.volume ?? 1, o?.at), undefined),
    music(state, map) {
      safe(() => {
        musicWant = { state, map };
        music?.port.postMessage(musicWant);
      }, undefined);
    },
    listener(pos, fwd, up) {
      safe(() => {
        const t = ctx.currentTime;
        const dt = earT < 0 ? 0 : t - earT;
        if (dt > 0.001) {
          const k = Math.min(1, dt / 0.08);
          ears.vel.x += ((pos.x - ears.pos.x) / dt - ears.vel.x) * k;
          ears.vel.y += ((pos.y - ears.pos.y) / dt - ears.vel.y) * k;
          ears.vel.z += ((pos.z - ears.pos.z) / dt - ears.vel.z) * k;
        }
        earT = t;
        ears.pos.x = pos.x;
        ears.pos.y = pos.y;
        ears.pos.z = pos.z;
        if (L.positionX) {
          L.positionX.value = pos.x;
          L.positionY.value = pos.y;
          L.positionZ.value = pos.z;
          L.forwardX.value = fwd.x;
          L.forwardY.value = fwd.y;
          L.forwardZ.value = fwd.z;
          L.upX.value = up.x;
          L.upY.value = up.y;
          L.upZ.value = up.z;
        } else {
          L.setPosition(pos.x, pos.y, pos.z);
          L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
        }
      }, undefined);
    },
    ambience(map: MapId, weather: Weather, night: number) {
      safe(() => {
        amb.set(map, weather, night);
        ears.wet = weather === "rain" ? 1 : weather === "snow" ? 0.4 : 0;
        envA.buffer = spaceOf(CITY.includes(map) ? "city" : "open");
      }, undefined);
    },
    setVolume(master, mus) {
      safe(() => {
        volume = clamp(master);
        musicVol.gain.setTargetAtTime(0.7 * clamp(mus), ctx.currentTime, 0.05);
        applyVol();
      }, undefined);
    },
    setMuted(v) {
      safe(() => {
        muted = v;
        applyVol();
        if (!v) void ctx.resume().catch(() => {});
      }, undefined);
    },
    dispose() {
      closed = true;
      clearInterval(timer);
      safe(() => {
        for (const v of voices) v.dispose();
        voices.clear();
        amb.dispose();
        music?.port.postMessage({ state: "off" });
      }, undefined);
      void ctx.close().catch(() => {});
    },
  };
}
