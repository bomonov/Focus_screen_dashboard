import { useLayoutEffect, type RefObject } from 'react'

const cut = (element: HTMLElement | null): boolean =>
  element !== null && element.scrollWidth > element.clientWidth + 1

/** Each pill's own refit, so the pill row can lay a pill out before measuring it. */
const refitters = new WeakMap<HTMLElement, () => void>()

/** Fits a pill's parts to its room now (the pill row does, before it measures a morph). */
export function refit(pill: HTMLElement): void {
  refitters.get(pill)?.()
}

/** A pill whose width is being animated: its parts stay as they are, clipped, till it lands. */
export const isMorphing = (pill: HTMLElement): boolean => pill.dataset.morphing !== undefined

/**
 * Another pill in the row is short of room: a part dropped (Next class), or one wrapped out of
 * sight (Next bus and the shuttle). A bubble's leftovers don't count: it shows only its icon.
 */
function othersShort(pill: HTMLElement): boolean {
  return [...(pill.parentElement?.children ?? [])].some(
    (other) =>
      other !== pill &&
      !other.classList.contains('next-class--bubble') &&
      (other.querySelector('.next-class__part[hidden]') !== null ||
        [...other.querySelectorAll<HTMLElement>('.next-bus__parts')].some(
          (parts) => parts.scrollHeight > parts.clientHeight + 1
        ))
  )
}

/**
 * Shows as many of a pill's parts as fit, dropping whole ones from the end ("LSE 104", then
 * "in 25 min"), so nothing is ever cut off mid-word. A name that's being cut short counts as
 * not fitting too: the name keeps its room before any part does. A pill that gives way (the
 * weather) also drops its parts while any other pill is short, unless it's held open.
 */
function fitParts(
  pill: HTMLElement,
  partSelector: string,
  nameSelector: string,
  giveWay: boolean
): void {
  if (isMorphing(pill)) return
  const parts = [...pill.querySelectorAll<HTMLElement>(partSelector)]
  const name = pill.querySelector<HTMLElement>(nameSelector)
  const hiddenBefore = parts.filter((part) => part.hidden).length
  const yields = giveWay && !pill.classList.contains('next-class--held')
  for (const part of parts) part.hidden = false
  for (let index = parts.length - 1; index >= 0; index--) {
    if (!cut(pill) && !cut(name) && !(yields && othersShort(pill))) break
    parts[index]?.setAttribute('hidden', '')
  }
  // Room handed back: the others may fit whole now.
  if (yields && parts.filter((part) => part.hidden).length > hiddenBefore) {
    for (const other of pill.parentElement?.children ?? []) {
      if (other !== pill && other instanceof HTMLElement) refit(other)
    }
  }
}

/**
 * Keeps a pill's parts fitted as it or the top bar changes size. CSS can't drop whole flex
 * items: it only shrinks or wraps them, which cut them off or hid the wrong ones. With
 * `giveWay`, the pill's parts go before any other pill's (the weather's place, say): it watches
 * the other pills too, since one dropping a part leaves the row's size as it was.
 */
export function useDropToFit(
  ref: RefObject<HTMLElement | null>,
  partSelector: string,
  nameSelector: string,
  giveWay = false
): void {
  useLayoutEffect(() => {
    const pill = ref.current
    if (!pill) return
    const fit = (): void => fitParts(pill, partSelector, nameSelector, giveWay)
    refitters.set(pill, fit)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(pill)
    if (pill.parentElement) observer.observe(pill.parentElement)
    if (giveWay) {
      for (const other of pill.parentElement?.children ?? []) {
        if (other !== pill) observer.observe(other)
      }
    }
    return () => {
      observer.disconnect()
      refitters.delete(pill)
    }
  })
}
