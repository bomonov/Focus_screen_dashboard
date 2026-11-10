"""Baseline: the app's offline aligner (native/aligner/aligner.py) on every recording with
LRCLIB timings, with the app's own text preparation. Prints one JSON line per song and a summary.

    "$HOME/Library/Application Support/Focus Screen/aligner/.venv/bin/python" lyrics-sync/eval/evaluate.py

Any new approach should print the same metrics (see score.py) so results compare directly.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from score import ground_truth_samples, heard_mask, load_sample, score  # noqa: E402
from textprep import align_language, companion_lines, sung_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "native/aligner/aligner.py"


def main():
    proc = subprocess.Popen(
        [sys.executable, "-I", str(WORKER)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env={**os.environ},
    )
    proc.stdout.readline()  # {"type":"ready"}

    def ask(message):
        proc.stdin.write(json.dumps(message) + "\n")
        proc.stdin.flush()
        while True:
            reply = json.loads(proc.stdout.readline())
            if reply.get("id") == message["id"]:
                return reply

    totals = []
    for number, base in enumerate(ground_truth_samples(), start=1):
        details, lines, audio, rate = load_sample(base)
        texts = [l["text"] for l in lines]
        companions = companion_lines(texts)
        started = time.perf_counter()
        reply = ask(
            {
                "id": number,
                "op": "align",
                "wav": str(base) + ".wav",
                "lines": [sung_text(t) for t, c in zip(texts, companions) if not c],
                "language": align_language(texts),
            }
        )
        spans = iter(reply.get("lines", []) if reply.get("ok") else [])
        starts, last = [], 0.0
        for companion in companions:
            if companion:
                starts.append(last + 0.01)
            else:
                span = next(spans, None)
                starts.append(span["start"] if span else None)
                last = starts[-1] if starts[-1] is not None else last
        mask, cell = heard_mask(audio, rate)
        result = {
            "song": base.name[16:46],
            "seconds": round(time.perf_counter() - started, 1),
            **score([l["timeSec"] for l in lines], starts, mask, cell),
        }
        totals.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    proc.stdin.close()
    proc.wait(timeout=30)
    heard = sum(r["heard"] for r in totals)
    if heard:
        for key in ("within_0.3s", "within_0.5s", "within_1s"):
            share = sum(r.get(key, 0) * r["heard"] for r in totals) / heard
            print(f"overall {key}: {share:.0%} of {heard} heard lines")


if __name__ == "__main__":
    main()
