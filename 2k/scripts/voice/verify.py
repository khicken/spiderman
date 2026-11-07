#!/usr/bin/env python3
"""Check the generated voice pack: durations for every clip, faster-whisper transcription for generic lines.

    python scripts/voice/verify.py [--all] [--sample N] [--fix]

--fix deletes flagged clips (mp3 + cache entry) so the next generate.py run redoes them.
Name clips are only duration-checked unless --all (whisper rarely spells surnames right).
"""
import argparse
import json
import random
import re
from difflib import SequenceMatcher
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "public" / "voice"
CACHE = HERE / ".cache.json"


def words(s: str) -> list[str]:
    s = re.sub(r"\[[a-z]+\]", " ", s.lower()).replace("-", " ")
    return re.findall(r"[a-z0-9']+", s)


def score(expected: str, heard: str) -> float:
    return SequenceMatcher(None, words(expected), words(heard)).ratio()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--min", type=float, default=0.6)
    args = ap.parse_args()

    manifest = json.loads((OUT / "manifest.json").read_text())["clips"]
    bad: dict[str, str] = {}
    for c in manifest:
        d = c["durationSec"]
        cap = 12.0 if c["category"] not in ("intro",) else 14.0
        if d < 0.25 or d > cap:
            bad[c["id"]] = f"duration {d:.2f}s"

    todo = [c for c in manifest if args.all or not (c.get("playerId") or c.get("teamAbbr"))]
    if args.sample:
        random.seed(7)
        todo = random.sample(todo, min(args.sample, len(todo)))
    from faster_whisper import WhisperModel
    model = WhisperModel("base", device="cpu", compute_type="int8")
    total = 0.0
    for c in todo:
        segs, _ = model.transcribe(str(OUT / c["file"]), language="en", beam_size=5)
        heard = " ".join(s.text.strip() for s in segs)
        r = score(c["text"], heard)
        total += r
        flag = r < args.min
        if flag:
            bad.setdefault(c["id"], f"match {r:.2f}")
        print(f"{'BAD ' if flag else 'ok  '}{r:.2f}  {c['id']:<28} expected: {c['text']!r}  heard: {heard!r}")
    if todo:
        print(f"\nmean match {total / len(todo):.3f} over {len(todo)} clips")
    print(f"flagged {len(bad)}: {bad}")
    if args.fix and bad:
        cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
        for cid in bad:
            (OUT / f"{cid}.mp3").unlink(missing_ok=True)
            cache.pop(cid, None)
        CACHE.write_text(json.dumps(cache, indent=0))
        print("deleted flagged clips; rerun generate.py")


if __name__ == "__main__":
    main()
