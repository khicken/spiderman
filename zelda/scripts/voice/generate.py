#!/usr/bin/env python3
"""Generate HOLLOWMERE's optional voice lines (Oriel and Tallow) with Chatterbox-Turbo, offline after first download.

Usage (from zelda/):
    /Users/kaleb/Documents/GitHub/khatterbox/.venv/bin/python scripts/voice/generate.py [--only PREFIX] [--force]

- Idempotent: a clip is skipped when public/voice/<id>.mp3 exists and its text/settings hash matches .cache.json.
- Output: mono 24 kHz, silence-trimmed, -16 LUFS integrated, 56 kbps MP3, plus public/voice/manifest.json.
- Voices are original: both start from the Chatterbox-Turbo reference clips that 2k derived from the model's built-in
  voice (refs/oriel-base.wav, refs/tallow-base.wav). Tallow's is raised in pitch; both get a light chorus and a high
  shelf so they read as spirits. The shrine reverb is added at run time by audio-space.ts, not baked in.
  No real person is cloned.
- The game falls back to a wordless chirp plus subtitle for any line whose clip is missing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "public" / "voice"
LINES = HERE / "lines.json"
CACHE = HERE / ".cache.json"
SR = 24000
TARGET_LUFS = -16.0
VERSION = "v1"
REFS = {"oriel": HERE / "refs" / "oriel.wav", "tallow": HERE / "refs" / "tallow.wav"}
BASES = {"oriel": HERE / "refs" / "oriel-base.wav", "tallow": HERE / "refs" / "tallow-base.wav"}
# ffmpeg filters on the reference clip, per speaker (pitch by sample-rate trick, then back to 24 kHz)
REF_FX = {"oriel": "aresample=24000", "tallow": "asetrate=24000*1.28,aresample=24000"}
# ffmpeg filters on the finished line
POST = {
    "oriel": "chorus=0.7:0.9:48|62:0.3|0.25:0.25|0.3:2|1.5,treble=g=2.5:f=3500",
    "tallow": "chorus=0.6:0.9:40|55:0.35|0.3:0.35|0.4:2.5|2,treble=g=3.5:f=4200",
}


def ff(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def make_refs() -> None:
    for spk, base in BASES.items():
        if not REFS[spk].exists():
            ff(["-i", str(base), "-af", REF_FX[spk], "-ac", "1", "-ar", str(SR), str(REFS[spk])])


def clip_hash(e: dict) -> str:
    return hashlib.sha1(f"{VERSION}|{e['speaker']}|{e['text']}|{POST[e['speaker']]}|{REF_FX[e['speaker']]}".encode()).hexdigest()[:12]


def trim(y: np.ndarray) -> np.ndarray:
    import librosa
    _, (a, b) = librosa.effects.trim(y, top_db=38, frame_length=512, hop_length=128)
    y = y[max(0, a - int(0.04 * SR)): min(len(y), b + int(0.10 * SR))].copy()
    fade = min(len(y) // 4, int(0.015 * SR))
    if fade > 0:
        y[:fade] *= np.linspace(0, 1, fade)
        y[-fade:] *= np.linspace(1, 0, fade)
    return y


def finish(y: np.ndarray, speaker: str, dst: Path) -> float:
    import pyloudnorm as pyln
    import soundfile as sf
    with tempfile.TemporaryDirectory() as td:
        a, b = os.path.join(td, "a.wav"), os.path.join(td, "b.wav")
        sf.write(a, y, SR, subtype="PCM_16")
        ff(["-i", a, "-af", POST[speaker], "-ac", "1", "-ar", str(SR), b])
        z, _ = sf.read(b, dtype="float32")
    z = trim(z)
    lufs = pyln.Meter(SR, block_size=0.4).integrated_loudness(z) if len(z) / SR >= 0.45 else None
    z = z * 10 ** ((TARGET_LUFS - (lufs if lufs is not None and np.isfinite(lufs) else -20)) / 20)
    peak = float(np.max(np.abs(z))) + 1e-9
    if peak > 0.89:
        z = z * (0.89 / peak)
    with tempfile.TemporaryDirectory() as td:
        w = os.path.join(td, "o.wav")
        sf.write(w, z.astype(np.float32), SR, subtype="PCM_16")
        ff(["-i", w, "-ac", "1", "-ar", str(SR), "-c:a", "libmp3lame", "-b:a", "56k", str(dst)])
    return round(len(z) / SR, 3)


class Voice:
    def __init__(self) -> None:
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        self.torch = torch
        self.model = ChatterboxTurboTTS.from_pretrained(device=dev)
        self.conds = {}
        for spk, ref in REFS.items():
            self.model.prepare_conditionals(str(ref))
            self.conds[spk] = self.model.conds
        print("model ready on", dev, flush=True)

    def say(self, text: str, speaker: str, seed: int) -> np.ndarray:
        self.torch.manual_seed(seed)
        self.model.conds = self.conds[speaker]
        wav = self.model.generate(text, temperature=0.7)
        return wav.squeeze(0).cpu().numpy().astype(np.float32)


_WHISPER = None


def heard(path: Path) -> str:
    """Transcribe a finished clip with faster-whisper (base). Used to reject mangled takes. Empty when unavailable."""
    global _WHISPER
    try:
        if _WHISPER is None:
            from faster_whisper import WhisperModel
            _WHISPER = WhisperModel("small", device="cpu", compute_type="int8")
        segs, _ = _WHISPER.transcribe(str(path), language="en", beam_size=5)
        return " ".join(s.text.strip() for s in segs)
    except Exception as ex:  # noqa: BLE001
        print("  whisper unavailable:", ex)
        return ""


def similarity(a: str, b: str) -> float:
    import re
    wa = re.findall(r"[a-z']+", a.lower())
    wb = re.findall(r"[a-z']+", b.lower())
    if not wb:
        return 0.0
    from difflib import SequenceMatcher
    return SequenceMatcher(None, wa, wb).ratio()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    make_refs()
    lines = json.loads(LINES.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [c for c, e in lines.items() if c.startswith(args.only)
            and (args.force or not ((OUT / f"{c}.mp3").exists() and cache.get(c, {}).get("hash") == clip_hash(e)))]
    print(f"{len(lines)} lines, {len(todo)} to generate", flush=True)
    if todo:
        v = Voice()
        for c in todo:
            e = lines[c]
            words = len(e["text"].split())
            lo, hi = 0.14 * words, 1.4 + 0.6 * words
            best, bestd, bests = None, 0.0, -1.0
            for attempt in range(8):
                raw = v.say(e["text"], e["speaker"], 1000 + attempt * 7919 + (zlib.crc32(c.encode()) & 0xFFFF))
                tmp = OUT / f".{c}.try.mp3"
                d = finish(trim(raw), e["speaker"], tmp)
                sim = similarity(heard(tmp), e["text"]) if lo <= d <= hi else 0.0
                print(f"  {c}: attempt {attempt + 1} {d:.2f}s match {sim:.2f}", flush=True)
                if sim > bests:
                    bests, bestd = sim, d
                    os.replace(tmp, OUT / f".{c}.tmp.mp3")
                if sim >= 0.95:
                    break
            best = OUT / f".{c}.tmp.mp3"
            print(f"{c}: kept match {bests:.2f}", flush=True)
            os.replace(best, OUT / f"{c}.mp3")
            cache[c] = {"hash": clip_hash(e), "durationSec": bestd}
            print(f"{c} {bestd:.2f}s", flush=True)
    CACHE.write_text(json.dumps(cache, indent=0))
    clips = {}
    for c, e in lines.items():
        if (OUT / f"{c}.mp3").exists() and c in cache:
            clips[c] = {"files": [f"{c}.mp3"], "text": e["text"], "who": e["who"], "seconds": cache[c]["durationSec"]}
    (OUT / "manifest.json").write_text(json.dumps({"version": 1, "sampleRate": SR, "boot": [], "clips": clips}, indent=1))
    print("manifest clips:", len(clips))
    return 0


if __name__ == "__main__":
    sys.exit(main())
