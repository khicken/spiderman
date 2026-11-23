#!/usr/bin/env python3
"""HOLLOWMERE music: turn the fetched VSCO-2-CE / VCSL notes into small game samples.

For every note listed in fetch-instruments.mjs:
  - decode with ffmpeg (mono, 44.1 kHz), cut the silence before the attack,
  - measure the real pitch (harmonic-sum search near the file-name note, then a parabolic peak refine), so file-name
    octave conventions and tuning drift never reach the game,
  - keep only `len` seconds with a cosine fade, normalize every note of one instrument to the same loudness
    (RMS of the first second, peak capped at -1 dBFS),
  - encode AAC-LC in .m4a (plays in Safari, Chrome and Firefox) at 64 kb/s,
  - write public/music/manifest.json.

Needs: python3 with numpy, ffmpeg on PATH, node (to read the instrument table). No other packages.
Usage: python3 scripts/audio/build-instruments.py  (INST_CACHE must match the fetch step; default <tmp>/hollowmere-inst)
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "music")
SR = 44100
BITRATE = "64k"
TARGET_RMS_DB = -20.0  # RMS of the first second of each note
PEAK_CAP = 10 ** (-1 / 20)

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# instruments whose notes go in the boot set (the explore palette); the rest load right after
BOOT = {"harp", "flute", "violins", "celli", "glock"}
# lowest plausible fundamental (Hz) per instrument family, used to reject sub-octave errors
FLOOR = {"celli": 60, "celloPizz": 60, "celloTrem": 60, "horn": 80, "timpani": 70, "timpRoll": 70, "vibes": 80}


def table():
    js = (
        "import('" + os.path.join(HERE, "fetch-instruments.mjs") + "').then(m => "
        "console.log(JSON.stringify({ inst: m.INSTRUMENTS, repos: m.REPOS, cache: m.cacheDir() })))"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def label_midi(fname):
    import re
    m = re.search(r"_([A-G]#?)(-?\d)(?=[_.])", fname)
    if not m:
        return None
    return 12 * (int(m.group(2)) + 1) + NOTE[m.group(1)]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def spectrum(x, t0, t1):
    seg = x[int(t0 * SR): int(t1 * SR)]
    if len(seg) < 2048:
        seg = np.pad(seg, (0, 2048 - len(seg)))
    n = 1 << int(math.ceil(math.log2(len(seg) * 4)))
    mag = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    return mag, SR / n


def peak_near(mag, df, f, tol_cents=60):
    lo = int(f * 2 ** (-tol_cents / 1200) / df)
    hi = int(f * 2 ** (tol_cents / 1200) / df) + 1
    if hi >= len(mag) - 1 or lo < 1:
        return None, 0.0
    k = lo + int(np.argmax(mag[lo:hi]))
    a, b, c = np.log(mag[k - 1] + 1e-12), np.log(mag[k] + 1e-12), np.log(mag[k + 1] + 1e-12)
    d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
    return (k + d) * df, mag[k]


def detect(x, inst, fname, octave=None):
    """Sounding pitch as a float MIDI number. `octave` pins the octave offset from the file-name note."""
    lab = label_midi(fname)
    dur = len(x) / SR
    t0, t1 = (0.08, min(0.7, dur)) if inst not in ("timpani", "timpRoll") else (0.05, min(0.9, dur))
    mag, df = spectrum(x, t0, t1)
    floor = FLOOR.get(inst, 50)
    cands = []
    if lab is not None:
        cands = [lab + 12 * k for k in ((-2, -1, 0, 1, 2) if octave is None else (octave,))]
    else:
        cands = list(range(36, 60))  # timpani: C2..B3
    best, best_score = None, -1
    for m in cands:
        f = hz(m)
        if f < floor or f > 5000:
            continue
        score = 0.0
        for h in range(1, 7):
            _, a = peak_near(mag, df, f * h, 70)
            score += a / h ** 0.5
        # a sub-octave candidate gets credit from the true pitch's harmonics, so ask for its odd harmonic too
        _, fund = peak_near(mag, df, f, 70)
        score *= 0.5 + 0.5 * min(1.0, fund / (mag.max() * 0.05 + 1e-12))
        if score > best_score:
            best, best_score = m, score
    if best is None:
        return None
    f, _ = peak_near(mag, df, hz(best), 70)
    if f is None:
        return float(best)
    # bowed and blown notes wobble at a weak fundamental: take the median over the strong harmonics
    est = []
    for h in range(1, 5):
        fh, a = peak_near(mag, df, hz(best) * h, 60)
        if fh and a > mag.max() * 0.05:
            est.append(fh / h)
    f = float(np.median(est)) if est else f
    return 69 + 12 * math.log2(f / 440.0)


def trim(x, keep):
    peak = np.max(np.abs(x)) + 1e-12
    on = np.argmax(np.abs(x) > peak * 0.02)
    start = max(0, on - int(0.004 * SR))
    y = x[start: start + int(keep * SR)].copy()
    fade = min(len(y) // 3, int(0.45 * SR))
    if fade > 0:
        y[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, math.pi, fade)))
    y[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return y


def rms_db(y):
    s = y[: SR]
    return 20 * math.log10(math.sqrt(np.mean(s * s)) + 1e-12)


def encode(y, out):
    with tempfile.NamedTemporaryFile(suffix=".f32", delete=False) as fh:
        fh.write(y.astype(np.float32).tobytes())
        tmp = fh.name
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", tmp,
             "-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart", out],
            check=True,
        )
    finally:
        os.unlink(tmp)


def main():
    t = table()
    cache = os.environ.get("INST_CACHE", t["cache"])
    inst_dir = os.path.join(OUT, "inst")
    os.makedirs(inst_dir, exist_ok=True)
    for f in os.listdir(inst_dir):
        if f.endswith(".m4a"):
            os.unlink(os.path.join(inst_dir, f))
    manifest = {
        "version": 1,
        "note": "HOLLOWMERE score instruments. Built by scripts/audio/build-instruments.py. Sources in CREDITS.md.",
        "boot": [],
        "clips": {},
        "instruments": {},
    }
    total = 0
    for inst, d in t["inst"].items():
        notes = []
        for fname in d["files"]:
            src = os.path.join(cache, d["repo"], d["dir"], fname)
            if not os.path.exists(src):
                print(f"missing {src}; run fetch-instruments.mjs first", file=sys.stderr)
                sys.exit(1)
            x = decode(src)
            y = trim(x, d["len"])
            tune = next((v for k, v in d.get("tune", {}).items() if fname.startswith(k + "_")), None)
            midi = tune if tune is not None else detect(y, inst, fname) if d["kind"] == "pitched" else None
            notes.append((fname, y, midi))
        # Low bowed, blown and plucked notes have a weak fundamental and read an octave high on their own. Each set uses
        # one octave convention in its file names, so take the most common offset and re-measure every note with it.
        offs = [round((m - label_midi(f)) / 12) for f, _, m in notes if m is not None and label_midi(f) is not None]
        if offs:
            octave = max(set(offs), key=offs.count)
            notes = [(f, y, detect(y, inst, f, octave) if m is not None and label_midi(f) is not None else m) for f, y, m in notes]
        # one loudness for every note of an instrument, then a shared peak cap
        gains = [10 ** ((TARGET_RMS_DB - rms_db(y)) / 20) for _, y, _ in notes]
        info = []
        for i, ((fname, y, midi), g) in enumerate(zip(notes, gains)):
            y = y * g
            pk = np.max(np.abs(y))
            if pk > PEAK_CAP:
                y *= PEAK_CAP / pk
            if midi is not None:
                near = int(round(midi))
                cid = f"{inst}-{NAMES[near % 12].replace('#', 's')}{near // 12 - 1}"
            else:
                cid = f"{inst}-{i + 1}"
            if cid in manifest["clips"]:
                cid = f"{cid}-{i + 1}"
            out = os.path.join(inst_dir, cid + ".m4a")
            encode(y, out)
            size = os.path.getsize(out)
            total += size
            manifest["clips"][cid] = {"file": f"inst/{cid}.m4a"}
            if inst in BOOT:
                manifest["boot"].append(cid)
            info.append({"id": cid, "midi": None if midi is None else round(midi, 2), "len": round(len(y) / SR, 2),
                         "src": f"{t['repos'][d['repo']]['name']}/{d['dir']}/{fname}"})
            print(f"{cid:22s} {'' if midi is None else f'{midi:6.2f}':>7s}  {size / 1024:6.1f} KB  {fname}")
        info.sort(key=lambda n: n["midi"] if n["midi"] is not None else 0)
        manifest["instruments"][inst] = {"kind": d["kind"], "notes": info}
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"total {total / 1024 / 1024:.2f} MB in {len(manifest['clips'])} clips")


if __name__ == "__main__":
    main()
