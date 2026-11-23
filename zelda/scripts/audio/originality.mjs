#!/usr/bin/env node
// HOLLOWMERE music: originality guard. Reads every melody in src/app/audio-score.ts and compares its interval runs with
// the opening phrases of well-known game and film themes (written from memory as semitone steps; transposition and
// rhythm do not matter). Each line is tested in every mode it is played in. Fails on any shared run of 5 notes
// (4 intervals) that contains a leap; plain scale runs are common to all music and are not a theme. Also lists 4-note
// matches inside the theme's first 8 notes, which a person should listen to before shipping.
// Usage: node scripts/audio/originality.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KNOWN = {
  "Zelda overworld": [-5, 5, 0, 2, 2, 1, 2],
  "Zelda's Lullaby": [3, -5, -2, 2, 2, 3, -5],
  "Song of Storms": [3, 9, -12, 3, 9, -10, 1, -1, 1, -1, -4, -3],
  "Saria's Song": [4, 2, -6, 4, 2, -6, 4, 2, 5, -2],
  "Epona's Song": [-3, -2, 5, -3, -2, 5, -3, -2],
  "Song of Time": [-7, 3, 4, -7, 3, 4, 2, 1, -1, -2],
  "Song of Healing": [-2, -4, 6, -2, -4, 6, -2, -5, -2, 2],
  "Zelda secret jingle": [-1, -3, -6, -1, -4, 4, 4],
  "Super Mario Bros. overworld": [0, 0, -4, 4, 3, -12],
  "Tetris (Korobeiniki)": [-5, 1, 2, -2, -1, -2, 0, 3, 4, -2, -2, -1, 1, 2, 2, -4, -3, 0],
  "Final Fantasy prelude": [2, 2, 3, 5, 2, 2, 3, 5],
  "Final Fantasy victory": [0, 0, 0, -4, 2, 2, -2, 2],
  "Megalovania": [0, 12, -5, -1, -1, -2, -3, 3, 2],
  "Star Wars main title": [0, 0, 5, 7, -2, -1, -2, 10, -5],
  "Hedwig's Theme": [5, 3, -1, -2, 7, -2, -3],
  "Ode to Joy": [0, 1, 2, 0, -2, -1, -2, -2, 0, 2, 2, 0, -2, 0],
};

const MODES = { lydian: [0, 2, 4, 6, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
const midi = (deg, mode) => 62 + 12 * Math.floor(deg / 7) + MODES[mode][deg - 7 * Math.floor(deg / 7)];

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "..", "src", "app", "audio-score.ts"), "utf8");

// A phrase block is `[...]` right after `NAME: Phrase =` or `motif: [`; the degrees are the first number of each pair.
function degreesAfter(i) {
  let depth = 0;
  let j = src.indexOf("[", i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "[") depth++;
    else if (src[j] === "]" && --depth === 0) break;
  }
  const body = src.slice(start, j + 1).replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/\[\s*(-?\d+|null)\s*,\s*\d+\s*\]/g)].map((m) => (m[1] === "null" ? null : Number(m[1])));
}

const melodies = [];
const ALL = Object.keys(MODES);
const r0 = src.indexOf("export const REGIONS");
const themeModes = new Set(["dorian"]);
for (const m of src.slice(r0).matchAll(/\n {2}(\w+): \{\s*mode: "(\w+)", nightMode: "(\w+)"(?:(?!\n {2}\w+: \{)[^])*?motif: (THEME|\[)/g)) {
  if (m[4] === "THEME") [m[2], m[3]].forEach((x) => themeModes.add(x));
  else melodies.push({ name: m[1] + " motif", i: r0 + m.index + m[0].length - 1, modes: [m[2], m[3]] });
}
for (const m of src.matchAll(/export const (\w+): Phrase = /g)) {
  const modes = m[1] === "THEME" ? [...themeModes] : m[1].startsWith("BOSS") ? ["phrygian"] : m[1].startsWith("C2") ? ["dorian"] : ALL;
  melodies.push({ name: m[1], i: m.index, modes });
}

const steps = (notes) => notes.slice(1).map((n, k) => n - notes[k]);
const runs = (iv, n) => iv.slice(0, iv.length - n + 1).map((_, k) => iv.slice(k, k + n).join(","));

let fail = 0;
let checked = 0;
for (const mel of melodies) {
  const deg = degreesAfter(mel.i).filter((d) => d !== null);
  checked++;
  for (const mode of new Set(mel.modes)) {
  const iv = steps(deg.map((d) => midi(d, mode)));
  for (const [name, known] of Object.entries(KNOWN)) {
    const kr = new Set(runs(known, 4));
    for (const r of runs(iv, 4)) {
      if (kr.has(r) && r.split(",").some((x) => Math.abs(Number(x)) >= 3)) {
        console.log(`FAIL ${mel.name} (${mode}): 5-note run [${r}] matches ${name}`);
        fail++;
      }
    }
    if (mel.name === "THEME" && mode === "lydian") {
      const k3 = new Set(runs(known, 3));
      for (const r of runs(iv.slice(0, 7), 3)) if (k3.has(r)) console.log(`note THEME first 8 notes: 4-note run [${r}] also in ${name} (listen)`);
    }
  }
  }
}
if (!checked) {
  console.log("FAIL no melodies found in audio-score.ts");
  process.exit(1);
}
console.log(fail ? `${fail} match(es): rewrite the melody` : `ok: ${checked} melodies, no 5-note run shared with ${Object.keys(KNOWN).length} known themes`);
process.exit(fail ? 1 : 0);
