// Dumps rosters to JSON for generate.py: node scripts/voice/dump-rosters.mjs > scripts/voice/rosters.json
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const out = [];
for (let i = 0; i < 6; i++) {
  try {
    const m = await jiti.import(`../../src/app/data/teams-${i}.ts`);
    const arr = m[`TEAMS_${i}`] || Object.values(m).find(Array.isArray) || [];
    for (const t of arr) out.push({ abbr: t.abbr, city: t.city, name: t.name, players: (t.players || []).map((p) => ({ id: p.id, first: p.first, last: p.last, jersey: p.jersey, pos: p.pos, starter: !!p.starter })) });
  } catch (e) { console.error(`teams-${i}: ${e.message}`); }
}
process.stdout.write(JSON.stringify(out, null, 1));
