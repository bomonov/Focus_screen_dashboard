"""Lyric text preparation, mirroring src/main/services/autosync/lines.ts (sungText, lyricLines,
companionLines, alignLanguage). lines.ts is the source of truth: change both together."""
import re

CJK = re.compile(r"[぀-ヿ一-鿿가-힯]")
LATIN = re.compile(r"[A-Za-z]")
ALL_BRACKETS = re.compile(r"\s*[(（\[［【].*[)）\]］】]\s*")
ASIDE = re.compile(r"[(（\[［【][^()（）\[\]［］【】]*[)）\]］】]")
DECORATION = re.compile(r"[→←×～〜♪♫☆★※\"“”「」『』]")
COMPANION_SHARE = 0.35
ENGLISH_WORDS = set(
    "the and you i to a me my it in of is that on your we be all for love so just what with "
    "don’t don't can this like no when know oh up now never feel are".split()
)


def lyric_lines(plain):
    """The plain lyrics without stanza breaks."""
    return [line.strip() for line in plain if line.strip()]


def sung_text(line):
    """A line as it's sung: no bracketed asides (alternate readings, romaji) or decorations."""
    sung = DECORATION.sub(" ", ASIDE.sub(" ", line))
    sung = re.sub(r"\s+", " ", sung).strip()
    return sung or line.strip()


def companion_lines(texts):
    """Translation/romaji lines under each CJK line (if ≥35% of lines), and all-bracket lines."""
    under = [
        i > 0 and not CJK.search(t) and bool(LATIN.search(t)) and bool(CJK.search(texts[i - 1]))
        for i, t in enumerate(texts)
    ]
    pairs = sum(under) / max(1, len(texts)) >= COMPANION_SHARE
    return [bool(ALL_BRACKETS.fullmatch(t)) or (pairs and under[i]) for i, t in enumerate(texts)]


def align_language(texts):
    text = "\n".join(texts)
    if re.search(r"[぀-ヿ]", text):
        return "ja"
    if re.search(r"[가-힯]", text):
        return "ko"
    if re.search(r"[一-鿿]", text):
        return "zh"
    words = re.findall(r"[a-z’']+", text.lower())
    if not words:
        return None
    return "en" if sum(w in ENGLISH_WORDS for w in words) / len(words) >= 0.15 else None
