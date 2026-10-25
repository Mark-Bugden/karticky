import type { AppEvent, DeckProfile, Direction, EventType, Grade } from './types'

// A card id is the word id and the direction as the deck's code names it: "ce1-l01-006:cz-en" is
// forward (Czech → English), "ce1-l01-006:en-cz" reverse.

export const DIRECTIONS: readonly Direction[] = ['forward', 'reverse']

/** "cz-en" forward, "en-cz" reverse: the direction in card ids and the summary. */
export const directionCode = (deck: DeckProfile, dir: Direction) => (dir === 'forward' ? `${deck.code}-en` : `en-${deck.code}`)

export const cardId = (deck: DeckProfile, wordId: string, dir: Direction) => `${wordId}:${directionCode(deck, dir)}`

export function parseCardId(id: string): { wordId: string; dir: Direction } {
  const i = id.lastIndexOf(':')
  return { wordId: id.slice(0, i), dir: id.startsWith('en-', i + 1) ? 'reverse' : 'forward' }
}

/** The word's card in the other direction: "cz-en" and "en-cz" swap. */
export function siblingId(id: string): string {
  const i = id.lastIndexOf(':')
  const [from, to] = id.slice(i + 1).split('-')
  return `${id.slice(0, i)}:${to}-${from}`
}

type EventFields = Omit<AppEvent, 'id' | 't' | 'dev' | 'type'>

export function makeEvent(dev: string, type: EventType, fields: EventFields, now: Date = new Date()): AppEvent {
  return { id: crypto.randomUUID(), t: now.toISOString(), dev, type, ...fields }
}

/** Events sort by timestamp, then id. */
export function compareEvents(a: Pick<AppEvent, 't' | 'id'>, b: Pick<AppEvent, 't' | 'id'>): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown): v is string => typeof v === 'string' && v !== ''
/** A card of this deck; an event naming another deck's card is invalid. */
const isCard = (deck: DeckProfile, v: unknown) => str(v) && DIRECTIONS.some((d) => v.endsWith(`:${directionCode(deck, d)}`))

/** Checks the shape of an event read from another device's log file. */
export function isValidEvent(x: unknown, deck: DeckProfile): x is AppEvent {
  if (typeof x !== 'object' || x === null) return false
  const e = x as Record<string, unknown>
  if (!str(e.id) || !str(e.dev) || typeof e.t !== 'string' || !TIMESTAMP.test(e.t)) return false
  switch (e.type) {
    case 'review':
      return isCard(deck, e.card) && [1, 2, 3, 4].includes(e.r as Grade)
    case 'undo':
      return str(e.target)
    case 'suspend':
    case 'unsuspend':
      return isCard(deck, e.card)
    case 'delete':
    case 'unflag':
      return str(e.word)
    case 'flag':
      return str(e.word) && str(e.hash)
    case 'learnMore':
    case 'dayCleared':
      return typeof e.day === 'string' && DAY.test(e.day)
    case 'setting':
      return str(e.key) && typeof e.value === 'number' && Number.isFinite(e.value)
    default:
      return false
  }
}

/** Only the event's own fields, in a stable order, for writing to a log file. */
export function toLogLine(e: AppEvent): string {
  const { id, t, dev, type, card, word, r, target, hash, day, key, value } = e
  return JSON.stringify({ id, t, dev, type, card, word, r, target, hash, day, key, value })
}

/** Parses a JSONL log file, skipping blank or invalid lines. */
export function parseLogFile(text: string, deck: DeckProfile): AppEvent[] {
  const events: AppEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const e = JSON.parse(line)
      if (isValidEvent(e, deck)) events.push(e)
    } catch {
      // A damaged line loses only itself.
    }
  }
  return events
}
