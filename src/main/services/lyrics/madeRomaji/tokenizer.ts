import { createRequire } from 'module'
import { dirname, join } from 'path'
import kuromoji from 'kuromoji'
import type { Token } from './readings'

export type Tokenize = (text: string) => Token[]

/** kuromoji's IPADIC dictionary, next to its code (inside the app's asar when packaged). */
function dictionaryPath(): string {
  const require = createRequire(__filename)
  return join(dirname(require.resolve('kuromoji/package.json')), 'dict')
}

/**
 * kuromoji with its dictionary loaded (about 0.2 s), splitting text into words with their
 * readings. It holds about 400 MB once loaded, so only the romaji maker's own process loads it.
 */
export function loadTokenizer(dicPath = dictionaryPath()): Promise<Tokenize> {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((error, tokenizer) => {
      if (error) {
        reject(error)
        return
      }
      resolve((text) =>
        tokenizer.tokenize(text).map((token) => ({
          surface: token.surface_form,
          pos: token.pos,
          detail: token.pos_detail_1,
          ...(token.reading && token.reading !== '*' ? { kana: token.reading } : {})
        }))
      )
    })
  })
}
