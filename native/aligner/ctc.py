"""The aligner's fast path: CTC forced alignment of a whole song with local wav2vec2 models.

English uses wav2vec2-large-960h-lv60-self (letters). Japanese uses reazon's
japanese-wav2vec2-base-rs35kh (characters). Every sung line's tokens are aligned in order against
the whole recording (one Viterbi pass), then mapped back to the line's own words, so the card can
sweep them.

Measured on 24 recordings with LRCLIB answer keys (lyrics-sync claude-worktree,
eval/bounds/ctc_align.py, 2026-10-19):
- 64.9% of lines within 0.5 s, against Whisper's 59.9%;
- 82.9% within 1 s, against 76.7%;
- about 2–5 s per song, against about 10–80 s.
"""
import json
import unicodedata
from pathlib import Path

import numpy as np

RATE, STRIDE = 16000, 320  # 20 ms frames
CHUNK_SEC, CONTEXT_SEC = 20.0, 2.0
# A line's last letter is only a short spike in a CTC path; let the line ring on a little after it.
LINE_TAIL_SEC = 0.3
MAX_WORDS = 200
MAX_WORD_CHARS = 100
MODELS = {"en": "wav2vec2-large-960h-lv60-self", "ja": "reazon-base-rs35kh"}
VOCAB_SIZES = {"en": 32, "ja": 3003}


class Model:
    """One local checkpoint, with the processor that normalizes its audio and spells its tokens."""

    def __init__(self, path, language, device):
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        config = json.loads((path / "config.json").read_text())
        if (
            config.get("model_type") != "wav2vec2"
            or config.get("vocab_size") != VOCAB_SIZES[language]
            or config.get("pad_token_id") != 0
        ):
            raise RuntimeError(f"unexpected {language} alignment model")
        self.torch, self.device, self.language = torch, device, language
        self.processor = Wav2Vec2Processor.from_pretrained(str(path), local_files_only=True)
        self.model = (
            Wav2Vec2ForCTC.from_pretrained(str(path), local_files_only=True, use_safetensors=True)
            .eval()
            .to(device)
        )
        self.model.config.apply_spec_augment = False
        self.blank = config["pad_token_id"]
        self.vocab_size = config["vocab_size"]
        self.vocab = self.processor.tokenizer.get_vocab()
        self.special = set(self.processor.tokenizer.all_special_ids) | {self.blank}

    def emissions(self, audio):
        """Log posteriors, one row per 20 ms frame, in 20 s chunks with 2 s of context each side."""
        chunk, context = int(CHUNK_SEC * RATE), int(CONTEXT_SEC * RATE)
        out = []
        for start in range(0, len(audio), chunk):
            lo, hi = max(0, start - context), min(len(audio), start + chunk + context)
            inputs = self.processor(audio[lo:hi], sampling_rate=RATE, return_tensors="pt")
            with self.torch.inference_mode():
                logits = self.model(inputs.input_values.to(self.device)).logits[0]
            logp = logits.float().log_softmax(-1).cpu().numpy()
            first = (start - lo) // STRIDE
            out.append(logp[first : first + min(chunk, len(audio) - start) // STRIDE])
        return np.concatenate(out)[: len(audio) // STRIDE]


def load_models(models_dir, device):
    """Both languages' models, or none when either is missing (the aligner then uses Whisper)."""
    paths = {language: Path(models_dir) / name for language, name in MODELS.items()}
    if not all((path / "model.safetensors").is_file() for path in paths.values()):
        return {}
    return {language: Model(path, language, device) for language, path in paths.items()}


def english_units(model, text):
    """The line's words, each with its letter tokens; Whisper-style leading spaces kept."""
    units = []
    for n, word in enumerate(text.split()):
        letters = [model.vocab[c] for c in word.upper() if c in model.vocab and c != "|"]
        units.append([word if n == 0 else " " + word, letters])
    return units


def japanese_units(model, text):
    """Each token's characters, mapped back to the line's own text (punctuation and spaces go
    with the character before them). None if the tokenizer's spelling can't be followed."""
    tokenizer = model.processor.tokenizer
    cleaned, origin = [], []
    for index, char in enumerate(text):
        for part in unicodedata.normalize("NFKC", char).lower():
            if unicodedata.category(part)[0] in "LN":
                cleaned.append(part)
                origin.append(index)
    cleaned = "".join(cleaned)
    if not cleaned:
        return []
    spans, at = [], 0
    for token in tokenizer(cleaned, add_special_tokens=False).input_ids:
        piece = tokenizer.convert_ids_to_tokens(token).replace("▁", "")
        known = token not in model.special and 0 <= token < model.vocab_size and piece != ""
        width = len(piece) if known else 1
        if at + width > len(cleaned) or (known and cleaned[at : at + width] != piece):
            return None
        spans.append((origin[at], [token] if known else []))
        at += width
    if at != len(cleaned):
        return None
    starts = [first for first, _ in spans] + [len(text)]
    return [[text[0 if k == 0 else first : starts[k + 1]], tokens] for k, (first, tokens) in enumerate(spans)]


def merge_silent(units):
    """Units nothing can be heard for (digits, unknown characters) join the unit before them, or
    the one after when they come first, so every unit left has a token to time it by."""
    merged = []
    for text, tokens in units:
        if tokens or not merged:
            merged.append([text, list(tokens)])
        else:
            merged[-1][0] += text
    while len(merged) > 1 and not merged[0][1]:
        text, _ = merged.pop(0)
        merged[0][0] = text + merged[0][0]
    return merged


def line_tokens(model, text):
    """(tokens to align, units with the index of their first token) for one line; units is None
    when the line's words can't be mapped (its start is still timed)."""
    units = english_units(model, text) if model.language == "en" else japanese_units(model, text)
    if units is None:
        # The spelling couldn't be followed: align the characters the model knows, without words.
        cleaned = "".join(
            c for c in unicodedata.normalize("NFKC", text).lower() if unicodedata.category(c)[0] in "LN"
        )
        ids = model.processor.tokenizer(cleaned, add_special_tokens=False).input_ids
        return [t for t in ids if t not in model.special and 0 <= t < model.vocab_size], None
    tokens, words = [], []
    for part, ids in merge_silent(units):
        if model.language == "en" and tokens and ids:
            tokens.append(model.vocab["|"])
        words.append((part, len(tokens)))
        tokens += ids
    return tokens, (words if tokens else None)


def viterbi(logp, lines, blank):
    """CTC Viterbi over every line's tokens in order: each token's first and last frame, per line.
    None when the recording is too short to hold them all."""
    ext, owner = [blank], [(-1, -1)]
    for n, ids in enumerate(lines):
        for k, token in enumerate(ids):
            ext += [token, blank]
            owner += [(n, k), (-1, -1)]
    ext = np.array(ext)
    states, frames = len(ext), len(logp)
    if states == 1 or frames < (states - 1) // 2:
        return None
    skip = np.zeros(states, bool)
    skip[2:] = (ext[2:] != blank) & (ext[2:] != ext[:-2])
    alpha = np.full(states, -np.inf)
    alpha[0], alpha[1] = logp[0, ext[0]], logp[0, ext[1]]
    back = np.zeros((frames, states), np.int8)
    for t in range(1, frames):
        step = np.concatenate(([-np.inf], alpha[:-1]))
        jump = np.where(skip, np.concatenate(([-np.inf, -np.inf], alpha[:-2])), -np.inf)
        best = np.stack([alpha, step, jump])
        choice = np.argmax(best, axis=0)
        alpha = best[choice, np.arange(states)] + logp[t, ext]
        back[t] = choice
    state = states - 1 if alpha[-1] >= alpha[-2] else states - 2
    spans = [[None] * len(ids) for ids in lines]
    for t in range(frames - 1, -1, -1):
        n, k = owner[state]
        if n >= 0:
            first, last = spans[n][k] or (t, t)
            spans[n][k] = (t, last)
        state -= int(back[t, state])
    return spans


def align(model, audio, texts):
    """Line spans with words, in the reply format; None for lines with nothing to hear."""
    logp = model.emissions(audio)
    prepared = [line_tokens(model, text) for text in texts]
    spans = viterbi(logp, [tokens for tokens, _ in prepared], model.blank)
    if spans is None:
        return None
    seconds = lambda frame: round(frame * STRIDE / RATE, 3)
    starts = [seconds(line[0][0]) if line else None for line in spans]
    duration = len(audio) / RATE
    timed = []
    for n, ((tokens, units), line) in enumerate(zip(prepared, spans)):
        if not tokens:
            timed.append(None)
            continue
        start = starts[n]
        later = next((s for s in starts[n + 1 :] if s is not None), duration)
        end = round(max(start, min(seconds(line[-1][1] + 1) + LINE_TAIL_SEC, later, duration)), 3)
        entry = {"start": start, "end": end}
        if units and len(units) <= MAX_WORDS and all(0 < len(text) <= MAX_WORD_CHARS for text, _ in units):
            word_starts = [seconds(line[first][0]) for _, first in units]
            entry["words"] = [
                {"text": text, "start": word_start, "end": next_start}
                for (text, _), word_start, next_start in zip(units, word_starts, word_starts[1:] + [end])
            ]
        timed.append(entry)
    return timed
