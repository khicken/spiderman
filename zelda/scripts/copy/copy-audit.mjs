#!/usr/bin/env node
// Copy audit (v2/copy-rule.md): scans player-facing strings in src/app for banned words and long lines.
// Usage: node scripts/copy/copy-audit.mjs [--json] [dir]   Exit 1 if any banned word is found.
// Lore flavor is exempt (lore stones, ending text, loading lore): see EXEMPT.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const dir = args.find((a) => !a.startsWith("--")) ?? join(ROOT, "src", "app");

/** Banned in player text. `why` is what to say instead (DESIGN-V2 section 1 names table). */
const BANNED = [
  { re: /\bwak(e|es|ing)\b(?! up)/i, why: "use 'light' for beacons (\"Glade Beacon lit\")" },
  { re: /\bawake\b/i, why: "say what happened in plain words" },
  { re: /\bgutter(s|ed|ing)?\b/i, why: "say 'You fell'" },
  { re: /\brekindl/i, why: "say 'Continue'" },
  { re: /\blantern[- ]bearer/i, why: "the player is Wren" },
  { re: /\bember ?thread\b|\bember line\b/i, why: "the power is 'Thread'" },
  { re: /\blast flame\b/i, why: "name the checkpoint (beacon, waystone or shrine)" },
  { re: /\bflames?\b/i, why: "heart / brazier / beacon: never 'flame'" },
  { re: /\bfalters?\b/i, why: "say 'Trial failed'" },
  { re: /\bloose\b/i, why: "say 'shoot'" },
  { re: /\bthe spirit\b/i, why: "the lantern is 'Tallow'" },
  { re: /\brune ?stones?\b/i, why: "fast travel stones are 'waystones'" },
];
const MAX_LEN = 56; // a toast or objective fits one line on a phone
const MAX_WORDS_SAY = 8;

/** Files or string patterns where flavor text is allowed (copy-rule.md: lore stones, ending, loading lore). */
const EXEMPT = [
  { file: /landmark-(secrets|village|spire)\.ts$/, ctx: /\b(text|title):\s*$/ }, // lore stone bodies
  { file: /ui-store\.ts$/, decl: /^(ENDING_TEXT|LORE_LINES)$/ },
  { file: /companion\.ts$/, ctx: /L\("mem\d"/ }, // memory story lines (DESIGN-V2 section 8)
  { file: /contracts\.ts$/ }, // types and comments, plus landmark names checked elsewhere
  { file: /\/lab\// },
];

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(n)) acc.push(p);
  }
  return acc;
}

/** Pull string literals, template literals (with ${} as "#") and JSX text out of a source file. */
function strings(src, tsx) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'") {
      const at = line, s0 = i; let s = ""; i++;
      while (i < n && src[i] !== c) { if (src[i] === "\\") { s += src[i + 1]; i += 2; continue; } if (src[i] === "\n") break; s += src[i++]; }
      i++;
      out.push({ text: s, line: at, kind: "str", pos: s0 });
      continue;
    }
    if (c === "`") {
      const at = line, s0 = i; let s = ""; i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") { s += src[i + 1]; i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") { let depth = 1; i += 2; while (i < n && depth) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; if (src[i] === "\n") line++; i++; } s += "#"; continue; }
        if (src[i] === "\n") line++;
        s += src[i++];
      }
      i++;
      out.push({ text: s, line: at, kind: "tpl", pos: s0 });
      continue;
    }
    if (tsx && c === ">") {
      let j = i + 1, s = "";
      while (j < n && src[j] !== "<" && src[j] !== "{" && src[j] !== "}" && src[j] !== ";" && src[j] !== "(" && src[j] !== ")" && src[j] !== "=") s += src[j++];
      if ((src[j] === "<" || src[j] === "{") && /[A-Za-z]{2,}/.test(s)) {
        out.push({ text: s.replace(/\s+/g, " ").trim(), line, kind: "jsx", pos: i });
      }
    }
    i++;
  }
  return out;
}

/** Heuristic: is this literal shown to the player? Two or more words, starts with a letter, not code or CSS. */
function isPlayerText(t) {
  const s = t.trim();
  if (s.length < 4 || !/\s/.test(s)) return false;
  if ((s.match(/[\d.]/g) ?? []).length > s.length * 0.4) return false; // svg paths, numbers
  if (!/^[A-Z0-9+"'(#<.]/.test(s) && !/[.!?]$/.test(s)) return false;
  if (/(var\(--|rgba?\(|px\b|\bvec[234]\b|#include|gl_|uniform |=>|\bfunction\b|import |export |\bnew [A-Z]|\bconst\b|\bdeg\b|%\s|^\.|\bease\b|^\s*[a-z-]+:\s)/.test(s)) return false;
  if (/^[a-z0-9 -]+$/.test(s) && !/[.!?]$/.test(s)) return false; // class lists, ids
  return true;
}

const files = walk(dir).sort();
const errors = [], warns = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  const ex = EXEMPT.filter((e) => e.file.test(f));
  if (ex.some((e) => !e.ctx && !e.decl)) continue;
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");
  for (const s of strings(src, f.endsWith(".tsx"))) {
    const before = src.slice(Math.max(0, s.pos - 200), s.pos);
    const lineText = lines[s.line - 1] ?? "";
    // single capitalized words count when they sit in a label slot: label="Flames", button text "Rekindle"
    const word = /^[A-Z][a-z]+$/.test(s.text.trim()) && (s.kind === "jsx" || /(label|title|kicker|text|button|name|aria-label)=?\s*[:=]?\s*\{?\s*$/.test(before));
    if (!word && !isPlayerText(s.text)) continue;
    const decl = [...src.slice(0, s.pos).matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)/g)].pop()?.[1] ?? "";
    if (ex.some((e) => (e.ctx && (e.ctx.test(lineText) || e.ctx.test(before))) || (e.decl && e.decl.test(decl)))) continue;
    if (/copy-ok/.test(lineText)) continue;
    for (const b of BANNED) {
      const m = s.text.match(b.re);
      if (m) errors.push({ file: rel, line: s.line, text: s.text, word: m[0], why: b.why });
    }
    const say = /companion\.ts$/.test(f) && /^\s*L\(/.test(lineText) && s.text.includes(" ");
    if (say && s.text.split(/\s+/).length > MAX_WORDS_SAY) warns.push({ file: rel, line: s.line, text: s.text, why: `over ${MAX_WORDS_SAY} words` });
    if (/^(guide|companion|state|ui-hud|ui-screens|landmarks|landmark-prologue)\.tsx?$/.test(f.split("/").pop()) && s.text.length > MAX_LEN && s.kind !== "jsx")
      warns.push({ file: rel, line: s.line, text: s.text, why: `${s.text.length} chars, over ${MAX_LEN} (one phone line)` });
  }
}

if (asJson) {
  console.log(JSON.stringify({ errors, warns, files: files.length }, null, 2));
} else {
  for (const e of errors) console.log(`FAIL ${e.file}:${e.line}  "${e.word}" in "${e.text.slice(0, 90)}"  -> ${e.why}`);
  for (const w of warns) console.log(`warn ${w.file}:${w.line}  ${w.why}: "${w.text.slice(0, 90)}"`);
  console.log(`copy-audit: ${files.length} files, ${errors.length} banned, ${warns.length} warnings`);
}
process.exit(errors.length ? 1 : 0);
