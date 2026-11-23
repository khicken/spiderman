// Oscillator policy check. Physical sounds are recorded clips, so oscillators may only start from UI cues (tag "ui") and
// magic cues (tag "magic"). Runs every level-check state and fails if any oscillator starts untagged, or if a state that
// should be pure samples (ambience, footsteps, swing, hit, voice, music) starts any "ui" oscillator.
//   node scripts/audio/osc-count.mjs
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const run = spawnSync(process.execPath, [path.join(here, "level-check.mjs")], { encoding: "utf8", maxBuffer: 1 << 26 });
let bad = 0;
let rows = 0;
for (const line of run.stdout.split("\n")) {
  const m = line.match(/^(\S+)\s.*osc (\{.*?\})/);
  if (!m) continue;
  rows++;
  const o = JSON.parse(m[2]);
  const pureSamples = !/^ui$|^mix-/.test(m[1]);
  const fail = o.other > 0 || (pureSamples && o.ui > 0) || (m[1] !== "ui" && o.ui > 0 && !m[1].startsWith("mix-"));
  if (fail) bad++;
  console.log(`${m[1].padEnd(15)} ui ${String(o.ui).padStart(3)}  magic ${String(o.magic).padStart(3)}  untagged ${o.other}  ${fail ? "FAIL" : "ok"}`);
}
if (!rows) { console.error(run.stdout + run.stderr); process.exit(2); }
console.log(bad ? `${bad} state(s) break the oscillator policy` : "oscillator policy holds");
process.exit(bad ? 1 : 0);
