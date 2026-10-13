import type { Aspect, Direction, Word } from './types'

const ASPECT_LABEL: Record<Aspect, string> = { impf: 'impf.', pf: 'pf.', biasp: 'biasp.' }
const PARTNER_ASPECT: Partial<Record<Aspect, Aspect>> = { impf: 'pf', pf: 'impf' }

/** "to say, to tell (impf.)" for verbs, the plain meaning otherwise. */
export function englishPrompt(w: Pick<Word, 'en' | 'aspect'>): string {
  return w.aspect ? `${w.en} (${ASPECT_LABEL[w.aspect]})` : w.en
}

/** "říkat (impf.) · říct (pf.)"; a biaspectual verb shows "(biasp.)" and its partner only if one is given. */
export function partnerLine(w: Pick<Word, 'cz' | 'aspect' | 'partner'>): string | null {
  if (!w.aspect) return null
  const own = `${w.cz} (${ASPECT_LABEL[w.aspect]})`
  if (!w.partner) return own
  const other = PARTNER_ASPECT[w.aspect]
  return `${own} · ${w.partner}${other ? ` (${ASPECT_LABEL[other]})` : ''}`
}

export const directionLabel = (d: Direction) => (d === 'cz-en' ? 'Czech → English' : 'English → Czech')

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export function timeAgo(then: Date, now: Date): string {
  const min = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

/** Whole minutes until a moment, at least 1. */
export function minutesUntil(then: Date, now: Date): number {
  return Math.max(1, Math.ceil((then.getTime() - now.getTime()) / 60_000))
}
