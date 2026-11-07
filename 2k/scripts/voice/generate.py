#!/usr/bin/env python3
"""Generate HOOPS announcer/commentary clips with Chatterbox-Turbo (local, offline after first download).

Usage (from the 2k/ folder):
    node scripts/voice/dump-rosters.mjs > scripts/voice/rosters.json   # refresh roster names
    /Users/kaleb/Documents/GitHub/khatterbox/.venv/bin/python scripts/voice/generate.py [--only ID_PREFIX] [--limit N]

- Syncs per-player / per-team name entries from rosters.json into lines.json.
- Idempotent and resumable: a clip is skipped when public/voice/<id>.mp3 exists and its
  text/settings hash matches scripts/voice/.cache.json. Delete a clip (or its cache entry) to redo it.
- Output: mono 24 kHz, silence-trimmed, ~-16 LUFS, 64 kbps MP3, plus public/voice/manifest.json.

Voices are original: both are derived from Chatterbox-Turbo's built-in voice, pitch-shifted and
re-synthesized into reference clips (scripts/voice/refs/pbp.wav, refs/pa.wav). No real person is cloned.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # 2k/
OUT = ROOT / "public" / "voice"
LINES = HERE / "lines.json"
ROSTERS = HERE / "rosters.json"
CACHE = HERE / ".cache.json"
REFS = {"pbp": HERE / "refs" / "pbp.wav", "pa": HERE / "refs" / "pa.wav"}
SR = 24000
TARGET_LUFS = -16.0
SETTINGS_VERSION = "v1"
# Post-processing per speaker: PA is a touch deeper and slower ("drawn-out").
POST = {"pbp": {"semitones": 0.0, "rate": 1.0}, "pa": {"semitones": -1.0, "rate": 0.92}}

# --------------------------------------------------------------------------- names

SAY_AS = {  # phonetic respellings for names the model tends to mangle
    "Knueppel": "Kuh-neppel", "Şengün": "Shen-goon", "Sengun": "Shen-goon", "Vučević": "Voo-cheh-vich",
    "Jović": "Yo-vich", "Bogdanović": "Bog-dan-oh-vich", "Matković": "Mat-ko-vich", "Diabaté": "Dee-ah-bah-tay",
    "Salaün": "Sah-lah-oon", "Traoré": "Trah-oh-ray", "Schröder": "Shro-der", "Okongwu": "Oh-kong-woo",
    "Antetokounmpo": "Ahn-teh-toh-koon-po", "Jokić": "Yo-kich", "Dončić": "Don-chich", "Nurkić": "Noor-kich",
    "Porziņģis": "Por-zing-is", "Valančiūnas": "Vah-lan-chu-nas", "Wembanyama": "Wem-ban-yah-ma",
    "Ejiofor": "Edge-ee-oh-for", "Gilgeous-Alexander": "Gil-jus Alexander", "Hachimura": "Hah-chee-moo-ra",
}
SUFFIX = {"Jr.": "Junior", "Jr": "Junior", "Sr.": "Senior", "II": "the Second", "III": "the Third", "IV": "the Fourth"}
POS_WORD = {"PG": "guard", "SG": "guard", "SF": "forward", "PF": "forward", "C": "center"}
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def num_words(n: int) -> str:
    if n < 20:
        return ONES[n]
    t, o = divmod(n, 10)
    return TENS[t] + ("" if o == 0 else "-" + ONES[o])


def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def say_word(w: str) -> str:
    if w in SAY_AS:
        return SAY_AS[w]
    if w in SUFFIX:
        return SUFFIX[w]
    w2 = ascii_fold(w)
    if re.fullmatch(r"(?:[A-Z]\.){2,}", w2):  # T.J. -> T. J.
        return " ".join(w2.replace(".", " ").split())
    return w2.replace("-", " ")


def say_name(s: str) -> str:
    if s in SAY_AS:
        return SAY_AS[s]
    return " ".join(say_word(w) for w in s.split())


def core_last(last: str) -> str:
    parts = [p for p in last.split() if p not in SUFFIX]
    return " ".join(parts) or last


def sync_rosters(lines: dict) -> dict:
    if not ROSTERS.exists():
        print("rosters.json missing; skipping name clips")
        return lines
    teams = json.loads(ROSTERS.read_text())
    keep = {k: v for k, v in lines.items() if v.get("category") not in ("pa_player", "name", "pa_team", "team")}
    for t in teams:
        full = f"{t['city']} {t['name']}"
        keep[f"pa_team_{t['abbr'].lower()}"] = {
            "text": f"And now... the starting lineup... for the... {say_name(t['city'])} {say_name(t['name'])}!",
            "speaker": "pa", "category": "pa_team", "teamAbbr": t["abbr"], "display": full}
        keep[f"team_{t['abbr'].lower()}"] = {
            "text": f"The {say_name(t['city'])} {say_name(t['name'])}!",
            "speaker": "pbp", "category": "team", "teamAbbr": t["abbr"], "display": full}
        for p in t["players"]:
            pos = POS_WORD.get(p.get("pos", ""), "guard")
            keep[f"pa_{p['id']}"] = {
                "text": f"At {pos}... number {num_words(int(p['jersey']))}... {say_name(p['first'])}... {say_name(p['last']).upper()}!",
                "speaker": "pa", "category": "pa_player", "playerId": p["id"], "teamAbbr": t["abbr"],
                "display": f"{p['first']} {p['last']}"}
            keep[f"name_{p['id']}"] = {
                "text": f"{say_name(core_last(p['last']))}!",
                "speaker": "pbp", "category": "name", "playerId": p["id"], "teamAbbr": t["abbr"],
                "display": p["last"]}
    return keep

# --------------------------------------------------------------------------- audio


def clip_hash(entry: dict) -> str:
    h = hashlib.sha1(f"{SETTINGS_VERSION}|{entry['speaker']}|{entry['text']}|{POST[entry['speaker']]}".encode())
    return h.hexdigest()[:12]


def expected_dur(entry: dict) -> tuple[float, float]:
    words = len(re.findall(r"[A-Za-z']+", re.sub(r"\[[a-z]+\]", "", entry["text"])))
    slow = 1.35 if entry["speaker"] == "pa" else 1.0
    lo = max(0.25, 0.12 * words)
    hi = min(14.0, (1.2 + 0.55 * words) * slow)
    return lo, hi


def trim(y: np.ndarray) -> np.ndarray:
    import librosa
    _, (a, b) = librosa.effects.trim(y, top_db=38, frame_length=512, hop_length=128)
    pad_a, pad_b = int(0.04 * SR), int(0.12 * SR)
    y = y[max(0, a - pad_a): min(len(y), b + pad_b)]
    fade = min(len(y) // 4, int(0.015 * SR))
    if fade > 0:
        y[:fade] *= np.linspace(0, 1, fade)
        y[-fade:] *= np.linspace(1, 0, fade)
    return y


def loudnorm(y: np.ndarray) -> np.ndarray:
    import pyloudnorm as pyln
    try:
        if len(y) / SR >= 0.45:
            lufs = pyln.Meter(SR, block_size=0.4).integrated_loudness(y)
            if np.isfinite(lufs):
                y = y * 10 ** ((TARGET_LUFS - lufs) / 20)
        else:
            rms = np.sqrt(np.mean(y ** 2)) + 1e-9
            y = y * (10 ** (TARGET_LUFS / 20) / rms)
    except Exception as e:  # noqa: BLE001
        print("  loudnorm fallback:", e)
    peak = np.max(np.abs(y)) + 1e-9
    if peak > 0.89:  # ~-1 dBFS ceiling
        y = y * (0.89 / peak)
    return y.astype(np.float32)


def post(y: np.ndarray, speaker: str) -> np.ndarray:
    cfg = POST[speaker]
    if cfg["semitones"] or cfg["rate"] != 1.0:
        import pyrubberband as pyrb
        if cfg["semitones"]:
            y = pyrb.pitch_shift(y, SR, cfg["semitones"])
        if cfg["rate"] != 1.0:
            y = pyrb.time_stretch(y, SR, cfg["rate"])
    return y


def encode_mp3(y: np.ndarray, dst: Path) -> None:
    import soundfile as sf
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    try:
        sf.write(tmp, y, SR, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", str(SR),
                        "-c:a", "libmp3lame", "-b:a", "64k", str(dst)], check=True)
    finally:
        os.unlink(tmp)

# --------------------------------------------------------------------------- model


class Voice:
    def __init__(self):
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.torch = torch
        self.model = ChatterboxTurboTTS.from_pretrained(device=device)
        self.device = device
        self.conds = {}
        for spk, ref in REFS.items():
            self.model.prepare_conditionals(str(ref))
            self.conds[spk] = self.model.conds
        print(f"model ready on {device}")

    def say(self, text: str, speaker: str, seed: int) -> np.ndarray:
        self.torch.manual_seed(seed)
        self.model.conds = self.conds[speaker]
        wav = self.model.generate(text, temperature=0.75 if speaker == "pa" else 0.8)
        return wav.squeeze(0).cpu().numpy().astype(np.float32)

# --------------------------------------------------------------------------- main


def write_manifest(lines: dict, cache: dict) -> int:
    clips = []
    for cid, e in lines.items():
        f = OUT / f"{cid}.mp3"
        c = cache.get(cid)
        if not f.exists() or not c:
            continue
        item = {"id": cid, "file": f"{cid}.mp3", "text": e["text"], "speaker": e["speaker"],
                "category": e["category"], "group": e["category"], "durationSec": c["durationSec"]}
        for k in ("playerId", "teamAbbr", "display"):
            if k in e:
                item[k] = e[k]
        clips.append(item)
    (OUT / "manifest.json").write_text(json.dumps({"version": 1, "sampleRate": SR, "clips": clips}, indent=0, ensure_ascii=False))
    return len(clips)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="only ids starting with this prefix")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--manifest-only", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    lines = sync_rosters(json.loads(LINES.read_text()))
    LINES.write_text(json.dumps(lines, indent=1, ensure_ascii=False))
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}

    todo = [cid for cid, e in lines.items()
            if cid.startswith(args.only)
            and not ((OUT / f"{cid}.mp3").exists() and cache.get(cid, {}).get("hash") == clip_hash(e))]
    # generic commentary first, then team clips, then the long tail of names
    order = {"pa_player": 3, "name": 2, "pa_team": 1, "team": 1}
    todo.sort(key=lambda c: order.get(lines[c]["category"], 0))
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(lines)} lines, {len(todo)} to generate")
    if args.manifest_only or not todo:
        print("manifest clips:", write_manifest(lines, cache))
        return

    voice = Voice()
    t0 = time.time()
    audio_total = 0.0
    for i, cid in enumerate(todo, 1):
        e = lines[cid]
        lo, hi = expected_dur(e)
        best = None
        for attempt in range(4):
            try:
                raw = voice.say(e["text"], e["speaker"], seed=1000 + attempt * 7919 + (zlib.crc32(cid.encode()) & 0xFFFF))
                y = trim(post(trim(raw), e["speaker"]))
                y = loudnorm(y)
            except Exception as ex:  # noqa: BLE001
                print(f"  {cid}: error {ex}")
                continue
            d = len(y) / SR
            if lo <= d <= hi:
                best = y
                break
            print(f"  {cid}: duration {d:.2f}s outside [{lo:.2f},{hi:.2f}] (attempt {attempt + 1})")
            if best is None or abs(d - (lo + hi) / 2) < abs(len(best) / SR - (lo + hi) / 2):
                best = y
        if best is None:
            print(f"FAILED {cid}")
            continue
        dst = OUT / f"{cid}.mp3"
        encode_mp3(best, dst)
        dur = round(len(best) / SR, 3)
        audio_total += dur
        cache[cid] = {"hash": clip_hash(e), "durationSec": dur}
        el = time.time() - t0
        print(f"[{i}/{len(todo)}] {cid} {dur:.2f}s  (elapsed {el:.0f}s, RTF {el / max(audio_total, 1e-3):.2f})", flush=True)
        if i % 20 == 0:
            CACHE.write_text(json.dumps(cache, indent=0))
            write_manifest(lines, cache)
    CACHE.write_text(json.dumps(cache, indent=0))
    print("manifest clips:", write_manifest(lines, cache))


if __name__ == "__main__":
    sys.exit(main())
