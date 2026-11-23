import * as THREE from "three";
import type { EnvState, GameEvent, Weather } from "./contracts";
import { DAY_SECONDS } from "./contracts";
import { writeLook } from "./render-look";

// Day/night clock, weather rolls, wind, and the color-graded palette for the current hour and weather.

type Key = {
  h: number;
  top: string; hor: string; sun: string; sunI: number; amb: string; gnd: string; rim: string;
  cLit: string; cShade: string; glow: string; fog: string; stars: number; sat: number; tint: string;
};

// v2 palette (audit-graphics.md section 3): warm gold key, cool blue-violet shade, a fog tint per hour and a blue-hour
// key. tint = grade color for the shadows in post (lifted toward it), sat = post saturation, fog = aerial perspective.
const NIGHT = { top: "#0b1330", hor: "#23305a", sun: "#9fb4ff", sunI: 0.35, amb: "#2a3566", gnd: "#141a2e", rim: "#8fa8ff", cLit: "#d7defa", cShade: "#1d2548", glow: "#ffb357", fog: "#1a2244", stars: 1, sat: 0.85, tint: "#1a1f48" };
const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 4.6, ...NIGHT, top: "#101a3c", hor: "#2c3866" },
  { h: 5.8, top: "#3d4f86", hor: "#f4b48a", sun: "#ffcf9a", sunI: 0.8, amb: "#6c6fa0", gnd: "#5a4a52", rim: "#ffd2a8", cLit: "#fff1df", cShade: "#4d5488", glow: "#ffd27a", fog: "#e9b7a0", stars: 0.15, sat: 1.05, tint: "#4a3a66" },
  { h: 8, top: "#5f9fd6", hor: "#f1e6c8", sun: "#fff0cf", sunI: 1.15, amb: "#7f9bc0", gnd: "#6a6a4e", rim: "#fff4dc", cLit: "#fffaf0", cShade: "#5a6f9e", glow: "#ffe08a", fog: "#d9e4e8", stars: 0, sat: 1.02, tint: "#3e4f78" },
  { h: 12.5, top: "#4c95d0", hor: "#e3eef0", sun: "#fff6e0", sunI: 1.3, amb: "#8aa6c8", gnd: "#6b7050", rim: "#ffffff", cLit: "#fffbe8", cShade: "#4f6890", glow: "#ffe9a0", fog: "#cfe0ea", stars: 0, sat: 1.0, tint: "#3a4c74" },
  { h: 15.2, top: "#5090cc", hor: "#ebeae0", sun: "#ffefd2", sunI: 1.26, amb: "#86a0c4", gnd: "#6d6a4c", rim: "#fff2d8", cLit: "#fff6e4", cShade: "#525f90", glow: "#ffdf96", fog: "#dfe2e0", stars: 0, sat: 1.04, tint: "#404c78" },
  { h: 17, top: "#5a84c0", hor: "#f6d39a", sun: "#ffc477", sunI: 1.2, amb: "#7d86b0", gnd: "#6e5a40", rim: "#ffd08a", cLit: "#fff0d0", cShade: "#5a5a90", glow: "#ffc860", fog: "#f1d2a4", stars: 0, sat: 1.1, tint: "#4c4278" },
  { h: 18.6, top: "#2e3c78", hor: "#f08a5c", sun: "#ff9a5a", sunI: 0.9, amb: "#6a5a8c", gnd: "#4a3a40", rim: "#ffb07a", cLit: "#ffe0c0", cShade: "#463e78", glow: "#ffb050", fog: "#c98a86", stars: 0.05, sat: 1.06, tint: "#4a3068" },
  { h: 19.6, top: "#1a2552", hor: "#6a5a9a", sun: "#c0a0ff", sunI: 0.4, amb: "#3a4478", gnd: "#20223a", rim: "#b0a0ff", cLit: "#e0dcff", cShade: "#262c5a", glow: "#ffb357", fog: "#3d3f72", stars: 0.5, sat: 0.95, tint: "#262a5a" },
  { h: 20.8, ...NIGHT, hor: "#27335e" },
  { h: 24, ...NIGHT },
];

type CKey = "top" | "hor" | "sun" | "amb" | "gnd" | "rim" | "cLit" | "cShade" | "glow" | "fog" | "tint";
const CKEYS: CKey[] = ["top", "hor", "sun", "amb", "gnd", "rim", "cLit", "cShade", "glow", "fog", "tint"];
// palette colors converted once to linear THREE.Color
const LIN = KEYS.map((k) => {
  const o = {} as Record<CKey, THREE.Color>;
  for (const c of CKEYS) o[c] = new THREE.Color(k[c]);
  return o;
});

export interface Palette {
  top: THREE.Color; hor: THREE.Color; sun: THREE.Color; amb: THREE.Color; gnd: THREE.Color; rim: THREE.Color;
  cLit: THREE.Color; cShade: THREE.Color; glow: THREE.Color; tint: THREE.Color;
  fog: THREE.Color; // v2: aerial perspective tint (look reads it)
  daylight: number; rain: number; // copies for the look
  stars: number; sat: number; cloud: number; // cloud cover 0..1
  sunPos: THREE.Vector3; moonPos: THREE.Vector3; // true sky positions (unit)
  fogScale: number; // fog distance multiplier (rain pulls it in)
  lantern: number; // lantern intensity from darkness
  flash: number; // thunder flash 0..1
}

const OVERCAST = new THREE.Color("#a2a6b4");
const OVERCAST_NIGHT = new THREE.Color("#1c2238");
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export interface EnvSim {
  readonly env: EnvState;
  readonly pal: Palette;
  setTime(h: number): void;
  setWeather(w: Weather, snap: boolean): void;
  /** Advance by dt game seconds (realDt drives the rain timers). Pushes env events into `out`. */
  update(dt: number, realDt: number, px: number, pz: number, out: GameEvent[]): void;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export function createEnvSim(env: EnvState): EnvSim {
  const pal: Palette = {
    top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), amb: new THREE.Color(), gnd: new THREE.Color(),
    rim: new THREE.Color(), cLit: new THREE.Color(), cShade: new THREE.Color(), glow: new THREE.Color(), tint: new THREE.Color(),
    fog: new THREE.Color(), daylight: 1, rain: 0,
    stars: 0, sat: 1, cloud: 0.3, sunPos: new THREE.Vector3(), moonPos: new THREE.Vector3(), fogScale: 1, lantern: 0, flash: 0,
  };
  let rollT = 3; // game hours until the next weather roll
  let rainLeft = 0; // real seconds of rain/storm left
  let thunderT = 8;
  let rainTarget = 0;
  let cloudTarget = 0.3;
  let cloud = 0.3;
  let windAng = Math.atan2(env.wind.y, env.wind.x);
  let windT = 0;
  let gust = 0;

  const setWeather = (w: Weather, snap: boolean) => {
    env.weather = w;
    rainTarget = w === "rain" ? 0.8 : w === "storm" ? 1 : 0;
    cloudTarget = w === "clear" ? 0.28 : w === "cloudy" ? 0.62 : w === "rain" ? 0.9 : 1;
    rainLeft = rainTarget > 0 ? 120 + Math.random() * 120 : 0;
    thunderT = 4 + Math.random() * 6;
    if (snap) {
      env.rain = rainTarget;
      env.wet = rainTarget > 0 ? 1 : 0;
      cloud = cloudTarget;
    }
  };

  const palette = () => {
    const h = ((env.timeOfDay % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smooth(Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h))));
    const A = LIN[i], B = LIN[i + 1];
    for (const c of CKEYS) pal[c].copy(A[c]).lerp(B[c], t);
    pal.sun.multiplyScalar(a.sunI + (b.sunI - a.sunI) * t);
    pal.stars = a.stars + (b.stars - a.stars) * t;
    pal.sat = a.sat + (b.sat - a.sat) * t;

    // sun: rises in the east (+x) at 6, highest at 12 toward the south (+z), sets in the west at 18
    const sa = ((h - 6) / 12.6) * Math.PI;
    pal.sunPos.set(Math.cos(sa), Math.sin(sa) * 0.88, 0.38).normalize();
    const ma = ((h - 18.6) / 11.4) * Math.PI;
    pal.moonPos.set(Math.cos(ma) * 0.8, Math.sin(ma) * 0.9 + 0.08, -0.32).normalize();
    env.daylight = Math.min(1, Math.max(0, smooth(Math.min(1, Math.max(0, (pal.sunPos.y + 0.1) / 0.55)))));

    // light direction: the sun by day, the moon by night, swung over the top in between
    const k = smooth(Math.min(1, Math.max(0, (pal.sunPos.y + 0.12) / 0.16)));
    const ld = env.sunDir;
    ld.copy(pal.moonPos).lerp(pal.sunPos, k).addScaledVector(UP, Math.sin(Math.PI * k) * 0.8);
    if (ld.y < 0.14) ld.y = 0.14;
    ld.normalize();

    // weather grade: overcast greys the sky, flattens the sun, lifts the ambient
    const rain = env.rain;
    const over = Math.min(1, Math.max(0, (cloud - 0.5) / 0.5)) * 0.55 + rain * 0.45;
    if (over > 0.001) {
      const lum = 0.35 + 0.65 * env.daylight;
      tmpC.copy(OVERCAST_NIGHT).lerp(OVERCAST, lum);
      pal.top.lerp(tmpC, over * 0.85).multiplyScalar(1 - over * 0.12);
      pal.hor.lerp(tmpC, over * 0.8);
      pal.cLit.lerp(tmpC, over * 0.6);
      pal.cShade.lerp(tmpC, over * 0.4).multiplyScalar(1 - 0.25 * over);
      pal.fog.lerp(tmpC, over * 0.7);
      pal.glow.multiplyScalar(1 - over * 0.8);
      pal.sun.multiplyScalar(1 - over * 0.7);
      pal.amb.lerp(tmpC, over * 0.4).multiplyScalar(1 + over * 0.25);
      pal.rim.multiplyScalar(1 - over * 0.6);
      pal.stars *= 1 - over;
      pal.sat *= 1 - over * 0.28;
    }
    pal.cloud = cloud;
    pal.fogScale = 1 - rain * 0.45;
    pal.lantern = 1 - smooth(env.daylight) * 0.94;
    pal.daylight = env.daylight;
    pal.rain = rain;
    writeLook(pal);
  };

  const sim: EnvSim = {
    env,
    pal,
    setTime(hrs) {
      env.timeOfDay = ((hrs % 24) + 24) % 24;
      palette();
    },
    setWeather(w, snap) {
      setWeather(w, snap);
      rollT = 3;
      palette();
    },
    update(dt, realDt, px, pz, out) {
      const before = env.timeOfDay;
      const dh = (dt * 24) / DAY_SECONDS;
      env.timeOfDay = (env.timeOfDay + dh) % 24;
      const after = env.timeOfDay;
      const crossed = (mark: number) => (before < mark && after >= mark) || (before > after && (mark > before || mark <= after));
      if (dh > 0) {
        if (crossed(6)) out.push({ type: "dawn" });
        if (crossed(18)) out.push({ type: "dusk" });
      }

      // weather: roll every 3 game hours while clear or cloudy; rain and storms run on a real-time timer
      if (env.weather === "rain" || env.weather === "storm") {
        rainLeft -= realDt;
        if (rainLeft <= 0) {
          setWeather("cloudy", false);
          rollT = 3;
          out.push({ type: "weather", weather: "cloudy" });
        }
      } else {
        rollT -= dh;
        if (rollT <= 0) {
          rollT = 3;
          const r = Math.random();
          const w: Weather = r < 0.6 ? "clear" : r < 0.8 ? "cloudy" : r < 0.95 ? "rain" : "storm";
          if (w !== env.weather) {
            setWeather(w, false);
            out.push({ type: "weather", weather: w });
          }
        }
      }
      const fade = realDt / 20;
      env.rain += Math.max(-fade, Math.min(fade, rainTarget - env.rain));
      const wetRate = env.rain > env.wet ? realDt / 30 : realDt / 90;
      env.wet += Math.max(-wetRate, Math.min(wetRate, Math.max(env.rain, 0) - env.wet));
      cloud += (cloudTarget - cloud) * Math.min(1, realDt / 25);

      // wind: slow turning, gusts; storms blow harder
      windT += realDt;
      windAng += (Math.sin(windT * 0.031) * 0.02 + Math.sin(windT * 0.0071 + 1.3) * 0.015) * realDt;
      gust += ((Math.sin(windT * 0.37) * Math.sin(windT * 0.113 + 2) > 0.45 ? 1 : 0) - gust) * Math.min(1, realDt * 0.8);
      const storm = env.weather === "storm" ? 1 : env.weather === "rain" ? 0.4 : 0;
      const speed = Math.min(6, Math.max(1, 2.2 + Math.sin(windT * 0.05) * 0.9 + gust * (1.2 + storm * 2) + storm * 1.5));
      env.wind.set(Math.cos(windAng) * speed, Math.sin(windAng) * speed);

      // thunder: flash now, sound after distance / 343 s
      pal.flash = Math.max(0, pal.flash - realDt * 3.2);
      if (env.weather === "storm" && env.rain > 0.5) {
        thunderT -= realDt;
        if (thunderT <= 0) {
          thunderT = 7 + Math.random() * 16;
          const ang = Math.random() * Math.PI * 2;
          const dist = 220 + Math.random() * 700;
          out.push({ type: "thunder", pos: { x: px + Math.cos(ang) * dist, y: 120, z: pz + Math.sin(ang) * dist }, delay: dist / 343 });
          pal.flash = 0.55 + 0.45 * (1 - dist / 920);
        }
      }
      palette();
    },
  };
  setWeather(env.weather, true);
  palette();
  return sim;
}
