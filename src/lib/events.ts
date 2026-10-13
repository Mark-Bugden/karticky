import type { AppEvent, Direction, EventType, Grade } from './types'

export const DIRECTIONS: readonly Direction[] = ['cz-en', 'en-cz']

export const cardId = (wordId: string, dir: Direction) => `${wordId}:${dir}`

export function parseCardId(id: string): { wordId: string; dir: Direction } {
  const i = id.lastIndexOf(':')
  return { wordId: id.slice(0, i), dir: id.slice(i + 1) as Direction }
}

export function siblingId(id: string): string {
  const { wordId, dir } = parseCardId(id)
  return cardId(wordId, dir === 'cz-en' ? 'en-cz' : 'cz-en')
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
const isCard = (v: unknown) => str(v) && /:(cz-en|en-cz)$/.test(v)

/** Checks the shape of an event read from another device's log file. */
export function isValidEvent(x: unknown): x is AppEvent {
  if (typeof x !== 'object' || x === null) return false
  const e = x as Record<string, unknown>
  if (!str(e.id) || !str(e.dev) || typeof e.t !== 'string' || !TIMESTAMP.test(e.t)) return false
  switch (e.type) {
    case 'review':
      return isCard(e.card) && [1, 2, 3, 4].includes(e.r as Grade)
    case 'undo':
      return str(e.target)
    case 'suspend':
    case 'unsuspend':
      return isCard(e.card)
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
export function parseLogFile(text: string): AppEvent[] {
  const events: AppEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const e = JSON.parse(line)
      if (isValidEvent(e)) events.push(e)
    } catch {
      // A damaged line loses only itself.
    }
  }
  return events
}
