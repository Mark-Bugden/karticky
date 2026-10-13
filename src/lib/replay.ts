// Rebuilds card state by replaying events in order (by `t`, then `id`). Card state is never
// stored as truth; this is the only place it comes from.

import { createEmptyCard, fsrs, State, type Card } from 'ts-fsrs'
import { LEARNING_STEPS, NEW_PER_DAY_DEFAULT, NEW_PER_DAY_MAX, NEW_PER_DAY_MIN, RELEARNING_STEPS, RETENTION } from './config'
import { compareEvents, parseCardId } from './events'
import { studyDay } from './studyDay'
import type { AppEvent, Grade } from './types'

export { State }

export const scheduler = fsrs({
  request_retention: RETENTION,
  learning_steps: [...LEARNING_STEPS],
  relearning_steps: [...RELEARNING_STEPS],
})

export interface ReviewEntry {
  /** Study day of the review. */
  day: string
  r: Grade
  /** The card's state just before this review. */
  before: State
}

export interface CardState {
  fsrs: Card
  /** Study day of the first review that was not undone. */
  introduced: string | null
  suspended: boolean
  reviews: ReviewEntry[]
}

export interface WordState {
  deleted: boolean
  /** Hash recorded by the latest flag, or null if unflagged. */
  flagHash: string | null
}

export interface Derived {
  /** Only cards that appear in events; any other card is new. */
  cards: Map<string, CardState>
  /** Only words with word-level events. */
  words: Map<string, WordState>
  /** Every word id mentioned by any event (its cards or itself). */
  historyWords: Set<string>
  newPerDay: number
  learnMore: Map<string, number>
  cleared: Set<string>
  /** The last event applied, to tell whether a new event can be applied on top. */
  last: { t: string; id: string } | null
  /** How many events have been replayed, including undone ones. */
  count: number
}

export function emptyDerived(): Derived {
  return {
    cards: new Map(),
    words: new Map(),
    historyWords: new Set(),
    newPerDay: NEW_PER_DAY_DEFAULT,
    learnMore: new Map(),
    cleared: new Set(),
    last: null,
    count: 0,
  }
}

/** Matches eventsFingerprint() in db.ts when this state reflects exactly the stored events. */
export function fingerprintOf(d: Derived): string {
  return `${d.count}:${d.last?.id ?? ''}`
}

export function newCardState(): CardState {
  return { fsrs: createEmptyCard(new Date(0)), introduced: null, suspended: false, reviews: [] }
}

function cardFor(d: Derived, id: string): CardState {
  let c = d.cards.get(id)
  if (!c) {
    c = newCardState()
    d.cards.set(id, c)
  }
  return c
}

function wordFor(d: Derived, id: string): WordState {
  let w = d.words.get(id)
  if (!w) {
    w = { deleted: false, flagHash: null }
    d.words.set(id, w)
  }
  return w
}

/** Applies one event that sorts after every event already applied. Undone reviews must be skipped by the caller. */
export function applyEvent(d: Derived, e: AppEvent): void {
  if (e.card) d.historyWords.add(parseCardId(e.card).wordId)
  if (e.word) d.historyWords.add(e.word)
  switch (e.type) {
    case 'review': {
      const c = cardFor(d, e.card!)
      const at = new Date(e.t)
      const day = studyDay(at)
      c.reviews.push({ day, r: e.r!, before: c.fsrs.state })
      c.fsrs = scheduler.next(c.fsrs, at, e.r!).card
      c.introduced ??= day
      break
    }
    case 'suspend':
    case 'unsuspend':
      cardFor(d, e.card!).suspended = e.type === 'suspend'
      break
    case 'delete':
      wordFor(d, e.word!).deleted = true
      break
    case 'flag':
      wordFor(d, e.word!).flagHash = e.hash!
      break
    case 'unflag':
      wordFor(d, e.word!).flagHash = null
      break
    case 'learnMore':
      d.learnMore.set(e.day!, (d.learnMore.get(e.day!) ?? 0) + 1)
      break
    case 'setting':
      if (e.key === 'newPerDay' && Number.isInteger(e.value)) {
        d.newPerDay = Math.min(NEW_PER_DAY_MAX, Math.max(NEW_PER_DAY_MIN, e.value!))
      }
      break
    case 'dayCleared':
      d.cleared.add(e.day!)
      break
    case 'undo':
      break // handled by replay(): the target review is skipped
  }
  d.last = { t: e.t, id: e.id }
  d.count++
}

/** Full replay of every event. */
export function replay(events: AppEvent[]): Derived {
  const sorted = [...events].sort(compareEvents)
  const undone = new Set(sorted.filter((e) => e.type === 'undo').map((e) => e.target))
  const d = emptyDerived()
  for (const e of sorted) {
    if (e.type === 'review' && undone.has(e.id)) {
      d.historyWords.add(parseCardId(e.card!).wordId)
      d.last = { t: e.t, id: e.id }
      d.count++
      continue
    }
    applyEvent(d, e)
  }
  return d
}

/** Whether an event sorts after everything already applied, so applyEvent can add it without a full replay. */
export function canApplyIncrementally(d: Derived, e: AppEvent): boolean {
  return e.type !== 'undo' && (d.last === null || compareEvents(d.last, e) < 0)
}

// ---- Cache (plain JSON so it fits in IndexedDB) ----

interface CachedCard extends Omit<CardState, 'fsrs'> {
  fsrs: Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string }
}

export interface DerivedCache {
  fingerprint: string
  cards: [string, CachedCard][]
  words: [string, WordState][]
  historyWords: string[]
  newPerDay: number
  learnMore: [string, number][]
  cleared: string[]
  last: Derived['last']
  count: number
}

export function toCache(d: Derived): DerivedCache {
  return {
    fingerprint: fingerprintOf(d),
    cards: [...d.cards].map(([id, c]) => [
      id,
      { ...c, fsrs: { ...c.fsrs, due: c.fsrs.due.toISOString(), last_review: c.fsrs.last_review?.toISOString() } },
    ]),
    words: [...d.words],
    historyWords: [...d.historyWords],
    newPerDay: d.newPerDay,
    learnMore: [...d.learnMore],
    cleared: [...d.cleared],
    last: d.last,
    count: d.count,
  }
}

export function fromCache(c: DerivedCache): Derived {
  return {
    cards: new Map(
      c.cards.map(([id, card]) => [
        id,
        {
          ...card,
          fsrs: {
            ...card.fsrs,
            due: new Date(card.fsrs.due),
            last_review: card.fsrs.last_review ? new Date(card.fsrs.last_review) : undefined,
          },
        },
      ]),
    ),
    words: new Map(c.words),
    historyWords: new Set(c.historyWords),
    newPerDay: c.newPerDay,
    learnMore: new Map(c.learnMore),
    cleared: new Set(c.cleared),
    last: c.last,
    count: c.count,
  }
}
