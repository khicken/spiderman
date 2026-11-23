#!/usr/bin/env node
// HOLLOWMERE music: download the recorded instrument notes the score uses.
// Sources (both CC0-1.0, checked on the repo LICENSE at the pinned commit):
//   VSCO-2 Community Edition  https://github.com/sgossner/VSCO-2-CE
//   VCSL (Versilian Community Sample Library)  https://github.com/sgossner/VCSL
// Files are pinned by commit SHA so a rebuild always gets the same notes. Only the notes listed below are fetched.
// Output: raw WAVs in $INST_CACHE (default: <os tmpdir>/hollowmere-inst), never in the repo.
// Next step: python3 scripts/audio/build-instruments.py (trims, tunes, encodes to public/music/inst/*.m4a).
//
// Usage: node scripts/audio/fetch-instruments.mjs [--list]
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const REPOS = {
  vsco: { name: "VSCO-2-CE", sha: "440300901dfe9275fd84e0b7763af1f8443ae62e", url: "https://github.com/sgossner/VSCO-2-CE" },
  vcsl: { name: "VCSL", sha: "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e", url: "https://github.com/sgossner/VCSL" },
};

// instrument id -> { repo, dir, files, len (s kept), kind }
// kind: "pitched" (f0 detected, tuned by playbackRate) | "perc" (no pitch).
const V = "vsco";
const C = "vcsl";
export const INSTRUMENTS = {
  harp: {
    repo: V, dir: "Strings/Harp", len: 4.0, kind: "pitched",
    files: ["D2_mf", "F2_mf", "A2_mf", "C3_mf", "E3_mf", "G3_mf", "B3_mf", "D4_mf", "F4_mf", "A4_mf", "C5_mf", "E5_mf", "G5_mf", "B5_mf", "D6_mf"].map((n) => `KSHarp_${n}.wav`),
  },
  flute: {
    repo: V, dir: "Woodwinds/Flute/susvib", len: 3.2, kind: "pitched",
    files: ["C4_v1_1", "E4_v1_1", "A4_v1_1", "C5_v1_1", "E5_v1_1", "A5_v1_1", "C6_v1_1"].map((n) => `LDFlute_susvib_${n}.wav`),
  },
  violins: {
    repo: V, dir: "Strings/Violin Section/susVib", len: 4.2, kind: "pitched",
    files: ["G2_v1", "B2_v1", "D3_v1", "F#3_v1", "A3_v1", "C4_v1", "E4_v1", "G4_v1", "B4_v1", "D5_v1"].map((n) => `VlnEns_susVib_${n}.wav`),
  },
  violas: {
    repo: V, dir: "Strings/Viola Section/susvib", len: 4.2, kind: "pitched",
    files: ["C2_v1_1", "E2_v1_1", "G2_v1_1", "B2_v1_1", "D3_v1_1", "F3_v1_1", "A3_v1_1", "C4_v1_1"].map((n) => `ViolaEns_susvib_${n}.wav`),
  },
  celli: {
    repo: V, dir: "Strings/Cello Section/susvib", len: 4.2, kind: "pitched",
    files: ["C1_v1_1", "E1_v1_1", "G1_v1_1", "B1_v1_1", "D2_v1_1", "F2_v1_1", "A2_v1_1", "C3_v1_1", "E3_v1_1", "G3_v1_1"].map((n) => `susvib_${n}.wav`),
  },
  vlnPizz: {
    repo: V, dir: "Strings/Violin Section/Pizz", len: 1.1, kind: "pitched",
    files: ["G2", "B2", "D3", "F#3", "A3", "C4", "E4", "G4", "B4", "D5"].map((n) => `VlnEns_Pizz_${n}_v2_rr1.wav`),
  },
  celloPizz: {
    repo: V, dir: "Strings/Cello Section/pizzT", len: 1.3, kind: "pitched",
    files: ["C1", "E1", "G1", "B1", "D2", "F2", "A2", "C3"].map((n) => `pizzT_${n}_v2_RR1.wav`),
  },
  vlnTrem: {
    repo: V, dir: "Strings/Violin Section/Trem", len: 3.2, kind: "pitched",
    files: ["A2_v2", "D3_v2", "F#3_v1", "A3_v2", "C4_v2", "E4_v2", "G4_v2"].map((n) => `VlnEns_Trem_${n}.wav`),
  },
  celloTrem: {
    repo: V, dir: "Strings/Cello Section/trem", len: 3.2, kind: "pitched",
    files: ["E1_v2_1", "G1_v2_1", "D2_v2_1", "F2_v2_1", "A2_v2_1", "C3_v2_1"].map((n) => `trem_${n}.wav`),
  },
  horn: {
    repo: V, dir: "Brass/F Horn/sus", len: 3.6, kind: "pitched",
    files: ["G1_v2_1", "A#1_v2_1", "D2_v2_1", "F2_v2_1", "A2_v2_1", "C3_v2_1", "D4_v1_1", "F4_v1_1"].map((n) => `MOHorn_sus_${n}.wav`),
  },
  // Timpani pitch is the (1,1) mode, measured by hand (the (2,1) mode a fifth above fools the harmonic search).
  timpani: {
    repo: V, dir: "Percussion/Timpani", len: 2.6, kind: "pitched",
    files: ["Timpani1_Hit_v3_rr1_Sum", "Timpani2_Hit_v3_rr1_Sum", "Timpani3_Hit_v3_rr1_Sum", "Timpani4_Hit_v3_rr1_Sum", "Timpani2_Hit_v1_rr1_Sum", "Timpani4_Hit_v1_rr1_Sum"].map((n) => `${n}.wav`),
    tune: { Timpani1: 41.47, Timpani2: 46.75, Timpani3: 49.5, Timpani4: 52.42 },
  },
  timpRoll: {
    repo: V, dir: "Percussion/Timpani/Rolls", len: 3.4, kind: "pitched",
    files: ["Timpani2_Roll_v3_rr1_Sum.wav", "Timpani4_Roll_v3_rr1_Sum.wav"],
    tune: { Timpani2: 47.4, Timpani4: 52.13 },
  },
  glock: {
    repo: V, dir: "Percussion/Glock", len: 2.2, kind: "pitched",
    files: ["G4", "C5", "G5", "C6", "G6", "C7"].map((n) => `glock_medium_${n}.wav`),
  },
  frameDrum: {
    repo: C, dir: "Membranophones/Struck Membranophones/Frame Drum", len: 0.9, kind: "perc",
    files: ["HDrumL_Hit_v3_rr1_Sum", "HDrumL_Hit_v3_rr2_Sum", "HDrumL_Hit_v2_rr1_Sum", "HDrumL_HitMuted_v2_rr1_Sum", "HDrumS_Hit_v2_rr1_Sum", "HDrumS_HitMuted_v2_rr1_Sum"].map((n) => `${n}.wav`),
  },
  kalimba: {
    repo: C, dir: "Idiophones/Plucked Idiophones/Kalimba, Kenya", len: 1.8, kind: "pitched",
    files: ["B2_k8", "C#3_k7", "D#3_k6", "F#3_k5", "G#3_k4", "B3_k3", "C#4_k2", "F#4_k14", "A4_k1"].map((n) => `Mbira6_Normal_MainSpirit_${n}_vl3_rr2.wav`),
  },
  ocarina: {
    repo: C, dir: "Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/SusVib", len: 3.0, kind: "pitched",
    files: ["A3", "C4", "E4", "F#4", "A4", "C5"].map((n) => `StdOcarina_SusVib_${n}.wav`),
  },
  recorder: {
    repo: C, dir: "Aerophones/Edge-blown Aerophones/Baroque Alto Recorder/SusVib", len: 2.8, kind: "pitched",
    files: ["F3", "A#3", "D4", "F#4", "A#4", "D5"].map((n) => `AltRecorder_SusVib_${n}_rr1_Main.wav`),
  },
  psaltery: {
    repo: C, dir: "Chordophones/Zithers/Psaltery, Bowed and Plucked/Pluck", len: 2.2, kind: "pitched",
    files: ["A#3_Main_Pluck_rr1", "D4_Main_Pluck_rr1", "F#4_Main_Pluck_rr1", "A#4_Main_Pluck_rr1", "D5_Main_Pluck_rr1", "F#5_Main_Pluck_rr3"].map((n) => `BowedPsaltery_${n}.wav`),
  },
  bowPsaltery: {
    repo: C, dir: "Chordophones/Zithers/Psaltery, Bowed and Plucked/LongBow", len: 3.0, kind: "pitched",
    files: ["A#3_Main_LongBow_rr2", "D4_Main_LongBow_rr1", "F#4_Main_LongBow_rr1", "A#4_Main_LongBow_rr2", "D5_Main_LongBow_rr2"].map((n) => `BowedPsaltery_${n}.wav`),
  },
  vibes: {
    repo: C, dir: "Idiophones/Struck Idiophones/Vibraphone/Soft Mallets", len: 3.0, kind: "pitched",
    files: ["F2_v1_rr1", "C3_v1_rr2", "E3_v1_rr2", "G3_v1_rr1", "B3_v1_rr1", "D4_v1_rr1", "F4_v1_rr1", "A4_v1_rr1", "C5_v1_rr1"].map((n) => `Vibes_soft_${n}_Main.wav`),
  },
};

export const cacheDir = () => process.env.INST_CACHE || join(tmpdir(), "hollowmere-inst");

const rawUrl = (repo, path) =>
  `https://raw.githubusercontent.com/sgossner/${REPOS[repo].name}/${REPOS[repo].sha}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function get(url, out) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mkdirSync(dirname(out), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
      return;
    } catch (err) {
      if (attempt === 2) throw new Error(`${url}: ${err.message}`);
    }
  }
}

async function main() {
  const root = cacheDir();
  const jobs = [];
  for (const [id, def] of Object.entries(INSTRUMENTS)) {
    for (const f of def.files) jobs.push({ id, path: `${def.dir}/${f}`, repo: def.repo, out: join(root, def.repo, def.dir, f) });
  }
  if (process.argv.includes("--list")) {
    for (const j of jobs) console.log(rawUrl(j.repo, j.path));
    return;
  }
  // license check: both LICENSE files must be CC0 at the pinned commit
  for (const repo of Object.keys(REPOS)) {
    const res = await fetch(rawUrl(repo, "LICENSE"));
    const text = await res.text();
    if (!/CC0 1\.0 Universal/.test(text)) throw new Error(`${REPOS[repo].name} LICENSE is not CC0 1.0 at ${REPOS[repo].sha}`);
    writeFileSync(join(mkdirP(join(root, repo)), "LICENSE"), text);
    console.log(`${REPOS[repo].name}@${REPOS[repo].sha.slice(0, 8)}: LICENSE is CC0 1.0 Universal`);
  }
  let done = 0;
  const queue = jobs.filter((j) => !(existsSync(j.out) && statSync(j.out).size > 1000));
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const j = queue.shift();
      await get(rawUrl(j.repo, j.path), j.out);
      done++;
      if (done % 10 === 0) console.log(`${done} downloaded`);
    }
  });
  await Promise.all(workers);
  console.log(`${jobs.length} notes ready in ${root}`);
}

function mkdirP(d) {
  mkdirSync(d, { recursive: true });
  return d;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
