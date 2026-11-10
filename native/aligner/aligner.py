"""Focus Screen's lyrics aligner: times lyric lines against a recording.

English and Japanese songs are aligned with local wav2vec2 CTC models (ctc.py): seconds per song.
Other languages, songs whose language isn't known, and any song the CTC pass can't place go to
Whisper large-v3-turbo instead.

Requests come in on stdin, one JSON object per line:
  {"id":1,"op":"load"}
  {"id":2,"op":"align","wav":"/tmp/song.wav","lines":["first line","second line"],"language":"ja"}
and everything goes out on stdout, one JSON object per line:
  {"type":"ready"}
  {"type":"reply","id":2,"ok":true,"lines":[{"start":12.3,"end":15.1,"words":[...]},null],...}
Each placed line may carry its words as Whisper heard them, in order, spaces included:
  "words":[{"text":"first","start":12.3,"end":12.8},{"text":" line","start":12.9,"end":15.1}]
(left out when any word's timing is unusable, so a line's words are all good or absent).
It exits when stdin closes. Everything runs on this Mac: the models are read from the runtime's
models folder and nothing goes over the network. Replies also say which engine timed the song.
"""
import json
import os
import sys
import time
from pathlib import Path

# `python -I` leaves this folder off the import path; ctc.py lives next to this file.
sys.path.insert(0, str(Path(__file__).resolve().parent))
# No __pycache__ for ctc.py: in the installed app this folder is inside the signed bundle, and a
# new file there breaks the signature. The app also passes -B; this covers any other launcher.
sys.dont_write_bytecode = True

# Where setup.sh installed the environment and model; the app passes it along.
RUNTIME = Path(
    os.environ.get(
        "FOCUS_ALIGNER_RUNTIME",
        Path.home() / "Library/Application Support/Focus Screen/aligner",
    )
)
MODEL = "large-v3-turbo"
LANGUAGES = {"ja", "en", "ko", "zh"}
MAX_LINES = 400
MAX_LINE_CHARS = 300

_model = None
_device = None
_ctc = None  # {language: ctc.Model} once loaded; {} when the CTC models aren't installed
# Below this share of lines placed, the CTC pass is treated as lost and Whisper tries instead.
MIN_CTC_PLACED = 0.5


def _send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _load():
    global _model, _device
    if _model is not None:
        return
    import torch
    import stable_whisper
    import stable_whisper.timing as stable_timing
    import whisper.timing as whisper_timing

    def dtw_any_device(x):
        # Whisper turns this into float64 before leaving the GPU, which Apple's GPU can't do.
        return whisper_timing.dtw_cpu(x.detach().to("cpu").double().numpy())

    whisper_timing.dtw = dtw_any_device
    stable_timing.dtw = dtw_any_device
    _device = "mps" if torch.backends.mps.is_available() else "cpu"
    models = RUNTIME / "models"
    if not (models / f"{MODEL}.pt").exists():
        raise RuntimeError("The Whisper model isn't installed; run native/aligner/setup.sh.")
    _model = stable_whisper.load_model(MODEL, device=_device, download_root=str(models))


def _load_ctc():
    global _ctc
    if _ctc is None:
        import ctc
        import torch

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _ctc = ctc.load_models(RUNTIME / "models", device)
    return _ctc


def _align_ctc(audio, lines, language):
    """The CTC timings, or None when this song should go to Whisper."""
    import ctc

    models = _load_ctc()
    if language not in models:
        return None
    timed = ctc.align(models[language], audio, lines)
    if timed is None or sum(line is not None for line in timed) < MIN_CTC_PLACED * len(lines):
        return None
    return timed


def _detect_language(audio):
    """Whisper's own guess, from 30 s in the middle of the song where the singing usually is."""
    import whisper

    start = max(0, len(audio) // 2 - 16000 * 15)
    clip = whisper.pad_or_trim(audio[start : start + 16000 * 30])
    mel = whisper.log_mel_spectrogram(clip, n_mels=_model.dims.n_mels).to(_device)
    _, probabilities = _model.detect_language(mel)
    return max(probabilities, key=probabilities.get)


def _timed_line(segment):
    """A segment's span, with its words when every one of them has a usable timing."""
    import numpy as np

    line = {"start": round(float(segment.start), 3), "end": round(float(segment.end), 3)}
    words = []
    for word in getattr(segment, "words", None) or []:
        if not np.isfinite([word.start, word.end]).all() or word.end < word.start:
            return line
        words.append(
            {"text": str(word.word), "start": round(float(word.start), 3), "end": round(float(word.end), 3)}
        )
    if words:
        line["words"] = words
    return line


def _align(request):
    import numpy as np
    import soundfile as sf

    lines = request.get("lines")
    if (
        not isinstance(lines, list)
        or not 0 < len(lines) <= MAX_LINES
        or not all(isinstance(line, str) and 0 < len(line.strip()) <= MAX_LINE_CHARS for line in lines)
    ):
        raise ValueError("bad lines")
    language = request.get("language")
    if language is not None and language not in LANGUAGES:
        raise ValueError("bad language")
    audio, rate = sf.read(str(request["wav"]), dtype="float32")
    if rate != 16000 or audio.ndim != 1 or not 0 < len(audio) <= 16000 * 600:
        raise ValueError("bad audio")
    started = time.perf_counter()
    if language in ("en", "ja"):
        try:
            timed = _align_ctc(audio, lines, language)
        except Exception as error:  # Whisper still gets a go at it.
            print(f"CTC alignment failed: {error}"[:300], file=sys.stderr)
            timed = None
        if timed is not None:
            return {
                "lines": timed,
                "language": language,
                "seconds": round(time.perf_counter() - started, 1),
                "device": _load_ctc()[language].device,
                "engine": "ctc",
            }
    _load()
    if language is None:
        language = _detect_language(audio)
    # One line per segment: the text's own line breaks are kept as the split.
    text = "\n".join(line.strip().replace("\n", " ") for line in lines)
    result = _model.align(audio, text, language=language, original_split=True)
    segments = [s for s in result.segments if s.text.strip()]
    timed = [
        _timed_line(s) if np.isfinite([s.start, s.end]).all() and s.end >= s.start else None
        for s in segments[: len(lines)]
    ]
    timed += [None] * (len(lines) - len(timed))
    return {
        "lines": timed,
        "language": language,
        "seconds": round(time.perf_counter() - started, 1),
        "device": _device,
        "engine": "whisper",
    }


def main():
    _send({"type": "ready"})
    for raw in sys.stdin:
        try:
            request = json.loads(raw)
            request_id = request["id"]
        except (ValueError, KeyError, TypeError):
            continue
        try:
            if request.get("op") == "load":
                # Warm up what the next song most likely needs: the CTC models if installed.
                models = _load_ctc()
                if models:
                    reply = {"device": next(iter(models.values())).device, "engine": "ctc"}
                else:
                    _load()
                    reply = {"device": _device, "engine": "whisper"}
            elif request.get("op") == "align":
                reply = _align(request)
            else:
                raise ValueError("bad request")
            _send({"type": "reply", "id": request_id, "ok": True, **reply})
        except Exception as error:  # Reported to the app as a failed song, never a crash.
            _send({"type": "reply", "id": request_id, "ok": False, "error": str(error)[:200]})


if __name__ == "__main__":
    main()
