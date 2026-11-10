// Pure helpers for reading regular YouTube (www.youtube.com) videos as songs; no DOM or browser
// APIs here, so they run in unit tests. Added by Bek (bomonov) on top of KennyLewd's extension.

/** Bits YouTube video titles carry that aren't part of the song's name. */
const NOISE =
  /\s*[([](?:official|lyrics?|lyric video|audio|video|music video|mv|hd|hq|4k|visuali[sz]er|live|remaster(?:ed)?|explicit|clean)[^)\]]*[)\]]/gi

/** Strips "(Official Video)", "[Lyrics]" and the like, and trailing "| ..." bits. */
export function cleanTitle(title: string): string {
  return title
    .replace(NOISE, '')
    .replace(/\s*\|.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Drake - Topic", "DrakeVEVO", "Drake Official" → "Drake". */
export function cleanChannel(channel: string): string {
  return channel
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s+official$/i, '')
    .trim()
}

/**
 * A video's song and artist, for lyrics lookups. Music videos are mostly titled
 * "Artist - Song (Official Video)"; otherwise the channel is the best guess at the artist.
 */
export function songFromVideo(title: string, channel: string): { title: string; artist: string } {
  const cleaned = cleanTitle(title)
  const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dash && dash[1] && dash[2]) {
    return { artist: dash[1].trim(), title: dash[2].trim() }
  }
  return { title: cleaned || title.trim(), artist: cleanChannel(channel) }
}

/** The video id from a YouTube watch URL; null on any other page. */
export function watchVideoId(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.hostname !== 'www.youtube.com' || url.pathname !== '/watch') return null
  const id = url.searchParams.get('v')
  return id && /^[\w-]{6,20}$/.test(id) ? id : null
}

/** YouTube's own thumbnail for a video (i.ytimg.com, which the app already accepts as covers). */
export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}
