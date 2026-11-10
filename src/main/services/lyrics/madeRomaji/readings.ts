// Romaji for a Japanese line, from a dictionary's readings (kuromoji, IPADIC), for songs VocaDB
// hasn't romanized. Measured on 7,501 lines of the user's songs that VocaDB has romanized: 87% of
// lines exactly as VocaDB writes them, against 69% from the dictionary's readings word by word.
// Most of what's left is VocaDB's own text differing (typos, extra words), or a reading only the
// singer picks (明日 asu, 永遠 towa).
import { fixedRomaji, kanaToRomaji, type SpellState } from './kana'

/** A word as the dictionary splits a line, with its reading. */
export interface Token {
  surface: string
  /** Part of speech and its first detail, as IPADIC names them ('名詞', '数'). */
  pos: string
  detail: string
  /** In katakana; missing for words the dictionary doesn't know. */
  kana?: string
}

interface ReadToken extends Token {
  /** A number read with its counter (一人): its reading is ours, not a word to learn. */
  number?: boolean
  /** Joins the word before it, as one word (空|回り, 謎|々). */
  glued?: boolean
}

/**
 * Readings VocaDB writes where the dictionary says otherwise, learned from the user's own
 * VocaDB romaji (`learnReadings`), by `learnedKey`.
 */
export type LearnedReadings = ReadonlyMap<string, string>

export const learnedKey = (token: Token, ours: string): string =>
  `${token.surface}|${token.pos}${token.detail}|${ours}`

// With the kanji past the basic block too (𠮟, 𩸽), which take two UTF-16 units.
const KANJI = /[㐀-鿿々〆\u{20000}-\u{3FFFF}]/u
const KANA_ONLY = /^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/
const KATAKANA_ONLY = /^[ァ-ヺー・]+$/
const SMALL_START = /^[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/
const LATIN = /^[a-z0-9'’.-]+$/i

/** は, へ and を as particles are sung wa, e and o. */
const PARTICLE: Readonly<Record<string, string>> = { は: 'わ', へ: 'え', を: 'お' }

/** A reading written in brackets after its kanji: 運命(さだめ), 星（スター）. */
const RUBY = /([㐀-鿿々〆\u{20000}-\u{3FFFF}]+)\s*\(([ぁ-ゖァ-ヺー]+)\)/gu
/** Poetic kanji for 行く the dictionary doesn't know as verbs: 征く, 往く, 逝く. */
const YUKU = /[征往逝](?=[かきくけこっ])/g
/** 千切れる, which the dictionary reads as the number 千. */
const CHIGIRU = /千切(?=[らりるれろっ])/g

/** The line as the dictionary reads it: readings in brackets in place of their kanji. */
export function textToRead(line: string): string {
  return line
    .normalize('NFKC')
    .replace(RUBY, (_, _kanji: string, reading: string) => reading)
    .replace(YUKU, 'ゆ')
    .replace(CHIGIRU, 'ちぎ')
}

// ---- numbers and their counters

// prettier-ignore
const DIGIT: Readonly<Record<string, number>> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}
const UNIT: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000, 万: 10_000, 億: 1e8 }
const ONES = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう']

function parseNumber(text: string): number | null {
  let total = 0
  let section = 0
  let digit = 0
  for (const char of text) {
    const value = DIGIT[char]
    const unit = UNIT[char]
    if (value !== undefined) digit = digit * 10 + value
    else if (unit === undefined) return null
    else if (unit >= 10_000) {
      total += (section + digit || 1) * unit
      section = 0
      digit = 0
    } else {
      section += (digit || 1) * unit
      digit = 0
    }
  }
  return total + section + digit
}

function readBelow10000(n: number): string {
  const thousands = Math.floor(n / 1000) % 10
  const hundreds = Math.floor(n / 100) % 10
  const tens = Math.floor(n / 10) % 10
  const ones = n % 10
  let out = ''
  if (thousands) {
    const special: Record<number, string> = { 1: 'せん', 3: 'さんぜん', 8: 'はっせん' }
    out += special[thousands] ?? `${ONES[thousands]}せん`
  }
  if (hundreds) {
    const special: Record<number, string> = {
      1: 'ひゃく',
      3: 'さんびゃく',
      6: 'ろっぴゃく',
      8: 'はっぴゃく'
    }
    out += special[hundreds] ?? `${ONES[hundreds]}ひゃく`
  }
  if (tens) out += `${tens === 1 ? '' : ONES[tens]}じゅう`
  return out + (ONES[ones] ?? '')
}

function readNumber(n: number): string {
  if (n === 0) return 'ゼロ'
  let out = ''
  let rest = n
  if (rest >= 1e8) {
    out += `${readBelow10000(Math.floor(rest / 1e8))}おく`
    rest %= 1e8
  }
  if (rest >= 10_000) {
    out += `${readBelow10000(Math.floor(rest / 10_000))}まん`
    rest %= 10_000
  }
  return out + readBelow10000(rest)
}

/** 一, 六, 八 and 十 clipped to a small っ before some counters (いっかい, ろっぽん, じゅっぷん). */
function clipped(n: number, counter: string, clipSix: boolean): string | null {
  const stem = readNumber(n)
  const last = n % 10
  if (n % 100 === 10) return stem.replace(/じゅう$/, 'じゅっ') + counter
  if (last === 1 && n % 100 !== 11) return stem.replace(/いち$/, 'いっ') + counter
  if (last === 6 && clipSix) return stem.replace(/ろく$/, 'ろっ') + counter
  if (last === 8) return stem.replace(/はち$/, 'はっ') + counter
  return null
}

/** Counters read the native way after one and two: 一粒 hitotsubu, 二言 futakoto. */
// prettier-ignore
const NATIVE: Readonly<Record<string, string>> = {
  粒: 'つぶ', 言: 'こと', 口: 'くち', 筋: 'すじ', 滴: 'しずく', 雫: 'しずく', 息: 'いき', 目: 'め',
  晩: 'ばん', 声: 'こえ', 色: 'いろ', 欠片: 'かけら'
}
/** Counters starting with h: p after a clipped number, b (some) or p (others) after three. */
// prettier-ignore
const H_COUNTERS: Readonly<Record<string, { kana: string; p: string; three: string }>> = {
  歩: { kana: 'ほ', p: 'ぽ', three: 'ぽ' },
  本: { kana: 'ほん', p: 'ぽん', three: 'ぼん' },
  杯: { kana: 'はい', p: 'ぱい', three: 'ばい' },
  分: { kana: 'ふん', p: 'ぷん', three: 'ぷん' },
  匹: { kana: 'ひき', p: 'ぴき', three: 'びき' },
  発: { kana: 'はつ', p: 'ぱつ', three: 'ぱつ' },
  遍: { kana: 'へん', p: 'ぺん', three: 'べん' }
}
/** Counters starting with k (clipped after 1, 6, 8, 10), or s or t (after 1, 8, 10). */
// prettier-ignore
const CLIPPED_COUNTERS: Readonly<Record<string, string>> = {
  回: 'かい', 個: 'こ', 階: 'かい', 曲: 'きょく', 歳: 'さい', 才: 'さい', 週: 'しゅう',
  足: 'そく', 瞬: 'しゅん', 生: 'しょう', 緒: 'しょ', 層: 'そう', 体: 'たい'
}
// prettier-ignore
const PLAIN_COUNTERS: Readonly<Record<string, string>> = {
  度: 'ど', 秒: 'びょう', 番: 'ばん', 枚: 'まい', 倍: 'ばい', 夜: 'や', 年: 'ねん', 時: 'じ'
}
// prettier-ignore
const DAYS: Readonly<Record<number, string>> = {
  1: 'いちにち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか',
  8: 'ようか', 9: 'ここのか', 10: 'とおか', 20: 'はつか'
}
// prettier-ignore
const THINGS: Readonly<Record<number, string>> = {
  1: 'ひとつ', 2: 'ふたつ', 3: 'みっつ', 4: 'よっつ', 5: 'いつつ', 6: 'むっつ', 7: 'ななつ',
  8: 'やっつ', 9: 'ここのつ'
}

function counted(n: number, counter: string): string | null {
  if (counter === '人') {
    return n === 1 ? 'ひとり' : n === 2 ? 'ふたり' : n === 4 ? 'よにん' : `${readNumber(n)}にん`
  }
  if (counter === '日') return DAYS[n] ?? `${readNumber(n)}にち`
  if (counter === 'つ') return THINGS[n] ?? null
  if ((counter === '歳' || counter === '才') && n === 20) return 'はたち'
  if (counter === '時' && (n === 4 || n === 7 || n === 9)) {
    return { 4: 'よじ', 7: 'しちじ', 9: 'くじ' }[n] ?? null
  }
  if (counter === '年' && n === 4) return 'よねん'
  const native = NATIVE[counter]
  if (native) return (n === 1 ? 'ひと' : n === 2 ? 'ふた' : readNumber(n)) + native
  const h = H_COUNTERS[counter]
  if (h) {
    if (n % 10 === 3) return readNumber(n) + h.three
    if (n % 10 === 4 && counter === '分') return readNumber(n) + h.p
    return clipped(n, h.p, true) ?? readNumber(n) + h.kana
  }
  const clip = CLIPPED_COUNTERS[counter]
  if (clip) return clipped(n, clip, /^[かきくけこ]/.test(clip)) ?? readNumber(n) + clip
  const plain = PLAIN_COUNTERS[counter]
  return plain ? readNumber(n) + plain : null
}

/** Numbers the dictionary splits digit by digit (一|人, 三|千) read whole, with their counter. */
function readNumbers(tokens: ReadToken[]): ReadToken[] {
  const out: ReadToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    if (token.detail !== '数' || parseNumber(token.surface) === null) {
      out.push(token)
      continue
    }
    let text = token.surface
    let j = i + 1
    for (let next = tokens[j]; next; next = tokens[++j]) {
      if (next.detail !== '数' || parseNumber(text + next.surface) === null) break
      text += next.surface
    }
    const n = parseNumber(text) ?? 0
    const counter = tokens[j]
    const reading = counter ? counted(n, counter.surface) : null
    if (counter && reading) {
      out.push({ ...token, surface: text + counter.surface, kana: reading, number: true })
      i = j
    } else {
      out.push({ ...token, surface: text, kana: readNumber(n), number: true })
      i = j - 1
    }
  }
  return out
}

// ---- readings songs use that a dictionary of written Japanese gets wrong

const PRONOUN = /^(我|僕|君|彼|私|俺|貴方|あなた|あたし|わたし|ぼく|おれ|きみ|彼女)$/

function songReadings(tokens: ReadToken[]): void {
  tokens.forEach((token, i) => {
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    const s = token.surface
    if (
      s === '何' &&
      next &&
      (/^[ノデダテトドンジ]/.test(next.kana ?? '') || next.detail === '接尾')
    ) {
      token.kana = 'ナン'
      // One word as sung: nande, nandemo, nanda, nante.
      if (/^(で|だ|て|と)$/.test(next.surface)) {
        next.glued = true
        const after = tokens[i + 2]
        if (next.surface === 'で' && after?.surface === 'も') after.glued = true
      }
    } else if (s === '良い' || s === '善い') {
      token.kana = 'イイ'
    } else if (s === '君' && token.kana === 'クン' && prev?.detail !== '固有名詞') {
      token.kana = 'キミ'
    } else if (s === '今' && token.pos === '接頭詞') {
      token.kana = 'イマ'
    } else if (s === '後' && token.kana === 'ノチ') {
      token.kana = 'アト'
    } else if (
      s === '側' &&
      (!prev || prev.detail === '代名詞' || prev.pos === '助詞' || prev.pos === '記号')
    ) {
      // そばに, not a side of something: a word of its own.
      token.kana = 'ソバ'
      token.detail = '一般'
    } else if (s === '空' && next && /^[回廻振騒]/.test(next.surface)) {
      token.kana = 'カラ'
      next.glued = true
    } else if (s === '着' && token.pos === '動詞' && next?.surface === 'い') {
      // 着い is only ever 着く's: 辿り着いた.
      token.kana = 'ツ'
      if (prev?.pos === '動詞') token.glued = true
    } else if (s === '々' && prev?.kana && KANJI.test(prev.surface)) {
      token.kana = prev.kana
      token.glued = true
    } else if (s === '理' && token.pos === '名詞' && token.detail === '一般') {
      token.kana = 'コトワリ'
    } else if (s === '如何') {
      token.kana = 'ドウ'
    } else if (
      (s === '等' || s === '達') &&
      token.detail === '接尾' &&
      prev &&
      PRONOUN.test(prev.surface)
    ) {
      token.kana = s === '等' ? 'ラ' : 'タチ'
      if (prev.surface === '我') prev.kana = 'ワレ'
    }
  })
}

/** A small kana the dictionary split off (と|ぅ) goes back onto the sound before it. */
function withSmallKana(tokens: readonly Token[]): ReadToken[] {
  const out: ReadToken[] = []
  for (const token of tokens) {
    const prev = out[out.length - 1]
    if (
      prev &&
      SMALL_START.test(token.surface) &&
      KANA_ONLY.test(token.surface) &&
      (prev.kana || KANA_ONLY.test(prev.surface))
    ) {
      prev.kana = (prev.kana ?? prev.surface) + token.surface
      prev.surface += token.surface
    } else out.push({ ...token })
  }
  return out
}

// ---- spelling and spacing

export interface Piece {
  token: Token
  text: string
  /** For a word with kanji in it, read by the dictionary: what its learned reading is kept by. */
  key?: string
  glue?: 'before' | 'after'
  /** Joins the word before it (`ReadToken.glued`). */
  joined?: boolean
}

// prettier-ignore
const PUNCTUATION: Readonly<Record<string, { text: string; glue: 'before' | 'after' }>> = {
  '、': { text: ',', glue: 'before' }, ',': { text: ',', glue: 'before' },
  '。': { text: '.', glue: 'before' }, '.': { text: '.', glue: 'before' },
  '!': { text: '!', glue: 'before' }, '?': { text: '?', glue: 'before' },
  '…': { text: '…', glue: 'before' },
  '「': { text: '"', glue: 'after' }, '『': { text: '"', glue: 'after' },
  '“': { text: '"', glue: 'after' },
  '」': { text: '"', glue: 'before' }, '』': { text: '"', glue: 'before' },
  '”': { text: '"', glue: 'before' }
}

/** The reading a word is spelled from, or null for one with kanji the dictionary can't read. */
function kanaOf(token: ReadToken): string | null | undefined {
  const s = token.surface
  if (token.pos === '助詞' && PARTICLE[s]) return PARTICLE[s]
  // Loanwords as written: the dictionary's readings of them are sometimes off (メロデイ).
  if (KATAKANA_ONLY.test(s)) return s.replace(/・/g, ' ')
  if (token.kana && (KANJI.test(s) || KANA_ONLY.test(s))) return token.kana
  if (KANA_ONLY.test(s)) return s
  if (KANJI.test(s)) return null
  return undefined
}

/** The line's words spelled out, one piece per word, or null when a kanji has no reading. */
export function spell(tokens: readonly Token[], learned?: LearnedReadings): Piece[] | null {
  const read = withSmallKana(tokens)
  songReadings(read)
  const words = readNumbers(read)
  const pieces: Piece[] = []
  const state: SpellState = { double: false, last: '' }
  for (const token of words) {
    const kana = kanaOf(token)
    if (kana === null) return null
    if (kana === undefined) {
      // English, digits and punctuation, as written; anything else is left out.
      state.double = false
      const mark = PUNCTUATION[token.surface]
      const text = LATIN.test(token.surface) ? token.surface : (mark?.text ?? '')
      pieces.push({ token, text, ...(mark ? { glue: mark.glue } : {}) })
      if (text) state.last = text.slice(-1)
      continue
    }
    const key =
      KANJI.test(token.surface) && !token.number ? learnedKey(token, kanaToRomaji(kana)) : undefined
    const theirs = key === undefined ? undefined : learned?.get(key)
    const text = theirs ? fixedRomaji(theirs, state) : kanaToRomaji(kana, state)
    pieces.push({ token, text, ...(key ? { key } : {}), ...(token.glued ? { joined: true } : {}) })
  }
  return pieces
}

const VERB_LIKE = /^(動詞|形容詞|助動詞)$/
const STANDALONE_AUXILIARY = /^(だ|です|だろ|でしょ|だろう|でしょう)$/
const VERB_ENDING = /^(て|で|ちゃ|じゃ|ば|たり|だり)$/

/** Whether a word joins the one before it, as VocaDB spaces romaji: endings on their verb. */
function attaches(token: Token, prev: Piece): boolean {
  if (/[っッ]$/.test(prev.text ? (prev.token.kana ?? prev.token.surface) : '')) return true
  if (/^[ー]/.test(token.surface)) return true
  // The ん of "iku n da", "pakkaan": VocaDB writes it onto the word before.
  if (token.surface === 'ん' && /^(助動詞|名詞)$/.test(token.pos)) return true
  const after = prev.token
  const verbLike = VERB_LIKE.test(after.pos)
  if (token.pos === '助動詞') return verbLike && !STANDALONE_AUXILIARY.test(token.surface)
  if (token.pos === '助詞' && token.detail === '接続助詞') {
    return verbLike && VERB_ENDING.test(token.surface)
  }
  if (token.pos === '動詞' && (token.detail === '非自立' || token.detail === '接尾')) {
    return after.pos === '動詞'
  }
  if (token.pos === '形容詞' && (token.detail === '非自立' || token.detail === '接尾')) {
    return verbLike
  }
  return token.pos === '名詞' && token.detail === '接尾' && after.pos === '名詞'
}

export function joinWords(pieces: readonly Piece[]): string {
  let out = ''
  let prev: Piece | null = null
  for (const piece of pieces) {
    if (!piece.text) {
      // A space between words keeps them apart, whatever they are.
      if (piece.token.surface.trim() === '') prev = null
      continue
    }
    const glued =
      prev !== null &&
      (prev.glue === 'after' ||
        piece.glue === 'before' ||
        (piece.glue === undefined && (piece.joined === true || attaches(piece.token, prev))))
    out += out && !glued ? ` ${piece.text}` : piece.text
    prev = piece
  }
  return out
}

/** The romaji of a line the dictionary has split, or null when a kanji in it has no reading. */
export function lineRomaji(tokens: readonly Token[], learned?: LearnedReadings): string | null {
  const pieces = spell(tokens, learned)
  return pieces && joinWords(pieces)
}
