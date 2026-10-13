// The summary file for Claude: every card's history and state plus group totals. Dates only:
// apart from generatedAt (when the file was written) it holds no times of day or durations.

import { MISC_ID } from './chapters'
import {
  MATURE_STABILITY_DAYS,
  RETENTION,
  RETENTION_WINDOW_DAYS,
  STRUGGLING_DIFFICULTY,
  STRUGGLING_LAPSES,
} from './config'
import type { LastSeenWord } from './db'
import { cardId, DIRECTIONS, parseCardId } from './events'
import { cardState, isFlagged, isHidden, streak, type World } from './queue'
import { State, type CardState } from './replay'
import { addDays, dayEnd, studyDay } from './studyDay'
import type { Direction, FileError } from './types'

export const CARD_COLUMNS = [
  'card',
  'chapter',
  'cz',
  'en',
  'state',
  'introduced',
  'due',
  'stability',
  'difficulty',
  'reps',
  'lapses',
  'reviews',
] as const

type CardRow = [
  string,
  string | null,
  string | null,
  string | null,
  string,
  string | null,
  string | null,
  number | null,
  number | null,
  number,
  number,
  string,
]

export interface GroupMetrics {
  words: number
  cards: number
  introduced: number
  mature: number
  reviews: number
  lapses: number
  retention30d: number | null
  avgDifficulty: number | null
}

export interface Summary {
  format: 1
  generatedAt: string
  device: string
  settings: { newPerDay: number; retention: number }
  streak: { current: number; longest: number }
  totals: { words: number; cards: number; introduced: number; reviews: number; lapses: number; dueToday: number }
  byChapter: ({ id: string; title: string; order: number } & GroupMetrics)[]
  byDirection: Record<Direction, GroupMetrics>
  cardColumns: typeof CARD_COLUMNS
  cards: CardRow[]
  lists: { struggling: string[]; flagged: string[]; deleted: string[]; removed: string[]; suspended: string[] }
  fileErrors: FileError[]
}

const STATE_NAME: Record<State, string> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

const round1 = (x: number) => Math.round(x * 10) / 10
const isNew = (c: CardState) => c.fsrs.state === State.New

function metrics(ids: string[], w: World, today: string): GroupMetrics {
  const since = addDays(today, -(RETENTION_WINDOW_DAYS - 1))
  const words = new Set<string>()
  let introduced = 0
  let mature = 0
  let reviews = 0
  let lapses = 0
  let recalled = 0
  let counted = 0
  let difficultySum = 0
  for (const id of ids) {
    const c = cardState(w.derived, id)
    words.add(parseCardId(id).wordId)
    reviews += c.reviews.length
    lapses += c.fsrs.lapses
    if (c.introduced) {
      introduced++
      difficultySum += c.fsrs.difficulty
    }
    if (c.fsrs.state === State.Review && c.fsrs.stability >= MATURE_STABILITY_DAYS) mature++
    for (const r of c.reviews) {
      if (r.before !== State.Review || r.day < since || r.day > today) continue
      counted++
      if (r.r >= 2) recalled++
    }
  }
  return {
    words: words.size,
    cards: ids.length,
    introduced,
    mature,
    reviews,
    lapses,
    retention30d: counted ? Math.round((recalled / counted) * 1000) / 1000 : null,
    avgDifficulty: introduced ? round1(difficultySum / introduced) : null,
  }
}

export function buildSummary(w: World, deviceId: string, lastSeen: Map<string, LastSeenWord>): Summary {
  const today = studyDay(w.now)
  const end = dayEnd(today)

  // Every word in a current file (study order), then every word known only from history.
  const currentWords = w.set.chapters.flatMap((ch) => ch.wordIds)
  const removed = [...w.derived.historyWords].filter((id) => !w.set.words.has(id)).sort()
  const allCards = [...currentWords, ...removed].flatMap((wordId) => DIRECTIONS.map((d) => cardId(wordId, d)))
  const visible = allCards.filter((id) => !isHidden(w, id))

  const cards: CardRow[] = allCards.map((id) => {
    const { wordId } = parseCardId(id)
    const word = w.set.words.get(wordId) ?? lastSeen.get(wordId)
    const c = cardState(w.derived, id)
    return [
      id,
      word?.chapterId ?? null,
      word?.cz ?? null,
      word?.en ?? null,
      STATE_NAME[c.fsrs.state],
      c.introduced,
      isNew(c) ? null : studyDay(c.fsrs.due),
      isNew(c) ? null : round1(c.fsrs.stability),
      isNew(c) ? null : round1(c.fsrs.difficulty),
      c.fsrs.reps,
      c.fsrs.lapses,
      c.reviews.map((r) => `${r.day}:${r.r}`).join(' '),
    ]
  })

  const totals = metrics(visible, w, today)
  const dueToday = visible.filter((id) => {
    const c = cardState(w.derived, id)
    if (isNew(c)) return false
    return c.fsrs.state === State.Review ? studyDay(c.fsrs.due) <= today : c.fsrs.due < end
  }).length

  const wordsOf = (cardIds: string[]) => new Set(cardIds.map((id) => parseCardId(id).wordId))
  const allWords = [...wordsOf(allCards)]

  return {
    format: 1,
    generatedAt: w.now.toISOString(),
    device: deviceId,
    settings: { newPerDay: w.derived.newPerDay, retention: RETENTION },
    streak: streak(w.derived.cleared, today),
    totals: {
      words: totals.words,
      cards: totals.cards,
      introduced: totals.introduced,
      reviews: totals.reviews,
      lapses: totals.lapses,
      dueToday,
    },
    byChapter: w.set.chapters.map((ch) => {
      const ids = ch.wordIds.flatMap((wordId) => DIRECTIONS.map((d) => cardId(wordId, d))).filter((id) => !isHidden(w, id))
      return { id: ch.id, title: ch.title, order: ch.id === MISC_ID ? 0 : ch.order, ...metrics(ids, w, today) }
    }),
    byDirection: {
      'cz-en': metrics(visible.filter((id) => id.endsWith(':cz-en')), w, today),
      'en-cz': metrics(visible.filter((id) => id.endsWith(':en-cz')), w, today),
    },
    cardColumns: CARD_COLUMNS,
    cards,
    lists: {
      struggling: allCards.filter((id) => {
        const c = cardState(w.derived, id)
        return !isNew(c) && (c.fsrs.lapses >= STRUGGLING_LAPSES || c.fsrs.difficulty >= STRUGGLING_DIFFICULTY)
      }),
      flagged: allWords.filter((id) => isFlagged(w, id)),
      deleted: allWords.filter((id) => w.derived.words.get(id)?.deleted).sort(),
      removed,
      suspended: allCards.filter((id) => w.derived.cards.get(id)?.suspended),
    },
    fileErrors: w.set.errors,
  }
}

export function summaryText(s: Summary): string {
  return JSON.stringify(s) + '\n'
}

/** Two summaries match if they agree on everything except generatedAt and device. */
export function sameSummary(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  const strip = (text: string) => {
    try {
      const { generatedAt: _g, device: _d, ...rest } = JSON.parse(text)
      return JSON.stringify(rest)
    } catch {
      return text
    }
  }
  return strip(a) === strip(b)
}

/** Last-seen copies for words a device never saw, taken from another device's summary. */
export function seedsFromSummary(text: string): LastSeenWord[] {
  try {
    const s = JSON.parse(text) as Partial<Summary>
    const cols = s.cardColumns as readonly string[] | undefined
    if (!Array.isArray(s.cards) || !cols) return []
    const at = (name: string) => cols.indexOf(name)
    const [iCard, iChapter, iCz, iEn] = [at('card'), at('chapter'), at('cz'), at('en')]
    const seeds = new Map<string, LastSeenWord>()
    for (const row of s.cards as unknown[][]) {
      const card = row[iCard]
      const cz = row[iCz]
      if (typeof card !== 'string' || typeof cz !== 'string') continue
      const id = parseCardId(card).wordId
      const chapter = row[iChapter]
      const en = row[iEn]
      seeds.set(id, { id, chapterId: typeof chapter === 'string' ? chapter : null, cz, en: typeof en === 'string' ? en : undefined })
    }
    return [...seeds.values()]
  } catch {
    return []
  }
}
