import { describe, expect, it, vi } from 'vitest'
import { cardMenuItems, type MenuContext } from './menu'

// The menu builders only read from the context; the app and the window code never run here.
vi.mock('electron', () => ({ app: {}, Menu: {} }))
vi.mock('./paths', () => ({ isDev: false }))

function musicContext(lyrics: Partial<MenuContext['lyrics']> = {}): MenuContext {
  return {
    music: { showLyrics: true, cover: 'record', spinSpeed: 'normal' },
    setMusic: vi.fn(),
    connectBrowser: vi.fn(),
    lyrics: {
      setVisible: vi.fn(),
      nudge: vi.fn(),
      reset: vi.fn(),
      pickOther: vi.fn(),
      canPickOther: true,
      colorCode: vi.fn(),
      canColorCode: true,
      ...lyrics
    }
  } as unknown as MenuContext
}

function labels(ctx: MenuContext): (string | undefined)[] {
  return cardMenuItems(ctx, 'music').map((item) => item.label)
}

describe('the Music menu’s lyrics items', () => {
  it('has Color-Code Lyrics after Pick Other Lyrics', () => {
    const all = labels(musicContext())
    const pick = all.indexOf('Pick Other Lyrics…')
    expect(pick).toBeGreaterThan(-1)
    expect(all[pick + 1]).toBe('Color-Code Lyrics…')
  })

  it('opens the window when it’s chosen', () => {
    const colorCode = vi.fn()
    const item = cardMenuItems(musicContext({ colorCode }), 'music').find(
      (entry) => entry.label === 'Color-Code Lyrics…'
    )
    expect(item?.enabled).toBe(true)
    item?.click?.({} as never, undefined, {} as never)
    expect(colorCode).toHaveBeenCalledOnce()
  })

  it('is off without a song with lyrics', () => {
    const item = cardMenuItems(musicContext({ canColorCode: false }), 'music').find(
      (entry) => entry.label === 'Color-Code Lyrics…'
    )
    expect(item?.enabled).toBe(false)
  })
})
