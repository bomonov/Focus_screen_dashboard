// The little of kuromoji (0.1.2, no types of its own) that the romaji maker uses.
declare module 'kuromoji' {
  export interface IpadicToken {
    surface_form: string
    /** Part of speech, then its details, as IPADIC names them ('名詞', '数'). */
    pos: string
    pos_detail_1: string
    /** In katakana; missing (or '*') for words the dictionary doesn't know. */
    reading?: string
    word_type: 'KNOWN' | 'UNKNOWN'
  }

  export interface Tokenizer {
    tokenize(text: string): IpadicToken[]
  }

  interface Builder {
    build(callback: (error: Error | null, tokenizer: Tokenizer) => void): void
  }

  const kuromoji: { builder(options: { dicPath: string }): Builder }
  export default kuromoji
}
