"""Scoring shared by every experiment: line starts vs LRCLIB's, counting only lines the
recording actually heard (unheard parts of a recording are exact zeros)."""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLES = Path.home() / "Library/Developer/FocusScreen/autosync-samples"


def load_sample(base):
    """(details, non-empty synced lines, int16 audio, rate) for a recording's base path."""
    base = str(base)
    details = json.loads(Path(base + ".json").read_text())
    lyrics = details.get("lyrics") or {}
    lines = [l for l in lyrics.get("lines", []) if isinstance(l, dict) and l["text"].strip()]
    audio, rate = sf.read(base + ".wav", dtype="int16")
    return details, lines, audio, rate


def ground_truth_samples():
    """Recordings whose lyrics came with LRCLIB timings, so they can be scored."""
    out = []
    for path in sorted(SAMPLES.glob("*.json")):
        details = json.loads(path.read_text())
        if (details.get("lyrics") or {}).get("kind") == "synced":
            out.append(path.with_suffix(""))
    return out


def heard_mask(audio, rate, cell=0.1):
    size = int(rate * cell)
    cells = len(audio) // size
    return np.array([np.any(audio[i * size : (i + 1) * size] != 0) for i in range(cells)]), cell


def score(reference, predicted, mask, cell):
    """reference/predicted: line start seconds (predicted may hold None)."""
    usable = []
    for ref, got in zip(reference, predicted):
        index = int(ref / cell)
        heard = bool(mask[index : index + int(1 / cell)].all()) if index < len(mask) else False
        if heard:
            usable.append((ref, got))
    aligned = [(r, g) for r, g in usable if g is not None]
    out = {"lines": len(reference), "heard": len(usable), "aligned": len(aligned)}
    if aligned:
        errors = np.array([g - r for r, g in aligned])
        absolute = np.abs(errors)
        out.update(
            {
                "within_0.3s": round(float((absolute <= 0.3).mean()), 3),
                "within_0.5s": round(float((absolute <= 0.5).mean()), 3),
                "within_1s": round(float((absolute <= 1.0).mean()), 3),
                "median_abs_ms": round(float(np.median(absolute)) * 1000),
                "median_signed_ms": round(float(np.median(errors)) * 1000),
                "p90_abs_ms": round(float(np.percentile(absolute, 90)) * 1000),
            }
        )
    return out
