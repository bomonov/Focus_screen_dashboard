// Kana spelled out as romaji the way VocaDB's romanizations write it (Hepburn): long vowels
// doubled (ou, uu, ee), っち as "cch", を as "o", no apostrophes. Our own table: wanakana, the
// usual library, spells loanword sounds apart (ヴァ "vua", ディ "dei", ティー "teii").

// prettier-ignore
const SINGLE: Readonly<Record<string, string>> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
  // Small kana on their own (ねぇ, a stray ゃ) keep their sound.
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
  ゕ: 'ka', ゖ: 'ke'
}

/** A kana with a small one after it (きゃ, ティ), read as one sound. */
// prettier-ignore
const YOON_ROWS: readonly [string, string][] = [
  ['き', 'ky'], ['ぎ', 'gy'], ['に', 'ny'], ['ひ', 'hy'], ['び', 'by'], ['ぴ', 'py'],
  ['み', 'my'], ['り', 'ry'], ['し', 'sh'], ['じ', 'j'], ['ち', 'ch'], ['ぢ', 'j']
]
// prettier-ignore
const LOANWORD_SOUNDS: Readonly<Record<string, string>> = {
  いぇ: 'ye', てぃ: 'ti', でぃ: 'di', てゅ: 'tyu', でゅ: 'dyu', とぅ: 'tu', どぅ: 'du',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', ゔゅ: 'vyu',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', くぁ: 'kwa', ぐぁ: 'gwa'
}

function digraphs(): Record<string, string> {
  const out: Record<string, string> = { ...LOANWORD_SOUNDS }
  for (const [kana, start] of YOON_ROWS) {
    out[`${kana}ゃ`] = `${start}a`
    out[`${kana}ゅ`] = `${start}u`
    out[`${kana}ょ`] = `${start}o`
    out[`${kana}ぇ`] = `${start}e`
  }
  return out
}
const DOUBLE: Readonly<Record<string, string>> = digraphs()

const CONSONANT = /^[bcdfghjkmpqrstvwxyz]/
const VOWEL_AT_END = /[aeiou]$/

/**
 * What one word leaves for the next: a small っ still waiting for its consonant (言っ|た), and the
 * last letter, for a ー that starts the next word.
 */
export interface SpellState {
  double: boolean
  last: string
}

/** Katakana (and ヴ) as hiragana, which sit 0x60 below them, so one table spells both. */
function asHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

function doubled(sound: string): string {
  if (sound.startsWith('ch')) return `c${sound}`
  return CONSONANT.test(sound) ? `${sound[0]}${sound}` : sound
}

/** `kana` as romaji; a space in it is a word break. Anything that isn't kana is kept as is. */
export function kanaToRomaji(
  kana: string,
  state: SpellState = { double: false, last: '' }
): string {
  const chars = [...asHiragana(kana)]
  let out = ''
  let pending = state.double
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? ''
    if (char === 'っ') {
      pending = true
      continue
    }
    if (char === 'ー') {
      const vowel = VOWEL_AT_END.exec(state.last + out)
      if (vowel) out += vowel[0]
      continue
    }
    const pair = DOUBLE[char + (chars[i + 1] ?? '')]
    const sound = pair ?? SINGLE[char]
    if (pair) i++
    if (sound === undefined) {
      pending = false
      out += char
      continue
    }
    out += pending ? doubled(sound) : sound
    pending = false
  }
  state.double = pending
  state.last = (state.last + out).slice(-1)
  return out
}

/** A reading already in romaji (learned from VocaDB), doubled after a waiting っ. */
export function fixedRomaji(romaji: string, state: SpellState): string {
  const out = state.double ? doubled(romaji) : romaji
  state.double = false
  state.last = out.slice(-1) || state.last
  return out
}
