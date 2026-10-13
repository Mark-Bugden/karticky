import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChapterFiles, type RawFile } from './chapters'
import { cardId, makeEvent } from './events'
import {
  buildPlan,
  chapterProgress,
  dayStatus,
  dueCards,
  eligibleNewCards,
  isBuried,
  isDayCleared,
  isFlagged,
  newAllowance,
  pickNext,
  streak,
  type World,
} from './queue'
import { applyEvent, canApplyIncrementally, fromCache, replay, State, toCache } from './replay'
import { studyDay } from './studyDay'
import type { AppEvent, ChapterSet, EventType, Grade, LoadedWord } from './types'

// ---- Fixtures ----

function chapterSet(files: RawFile[]): ChapterSet {
  const { chapters, words, errors } = parseChapterFiles(files)
  const loaded = new Map<string, LoadedWord>()
  for (const [id, w] of words) loaded.set(id, { ...w, hash: `hash-${id}-${w.en}` })
  return { chapters, words: loaded, errors }
}

const words = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
    cz: `${prefix} cz ${i + 1}`,
    en: `${prefix} en ${i + 1}`,
    example: 'Věta.',
    exampleEn: 'Sentence.',
  }))

const chapterFile = (id: string, order: number, n: number): RawFile => ({
  path: `chapters/${id}.json`,
  text: JSON.stringify({ format: 1, chapter: { id, order, title: id.toUpperCase() }, words: words(id, n) }),
})

const sample = (): RawFile => ({
  path: 'chapters/sample.json',
  text: readFileSync(new URL('../../sample/sample.json', import.meta.url), 'utf8'),
})

/** A fake clock plus an event log, replayed on every query. */
class Sim {
  events: AppEvent[] = []
  now: Date

  constructor(
    public set: ChapterSet,
    start = new Date(2026, 9, 13, 8, 0),
  ) {
    this.now = start
  }

  world(): World {
    return { now: this.now, set: this.set, derived: replay(this.events) }
  }

  add(type: EventType, fields: Partial<AppEvent> = {}, dev = 'windows-aaaaaa'): AppEvent {
    const e = makeEvent(dev, type, fields, this.now)
    this.events.push(e)
    this.now = new Date(this.now.getTime() + 1000)
    return e
  }

  review(card: string, r: Grade = 3, dev?: string): AppEvent {
    return this.add('review', { card, r }, dev)
  }

  minutes(m: number) {
    this.now = new Date(this.now.getTime() + m * 60_000)
  }

  /** Moves to 8 am on a later study day. */
  days(n: number) {
    const d = new Date(this.now)
    d.setDate(d.getDate() + n)
    d.setHours(8, 0, 0, 0)
    this.now = d
  }

  /**
   * Studies until nothing is left now (ignoring waits). Each card gets `first` the first time it is
   * shown and Good after that, so Again cards eventually graduate. Returns the cards shown.
   */
  studyAll(first: Grade = 3, limit = 500): string[] {
    const shown: string[] = []
    const plan = buildPlan(this.world(), () => 0)
    for (let i = 0; i < limit; i++) {
      const next = pickNext(this.world(), plan)
      if (next.kind !== 'card') return shown
      this.review(next.card, shown.includes(next.card) ? 3 : first)
      shown.push(next.card)
    }
    throw new Error('studyAll did not finish')
  }
}

const dirs = (cards: string[]) => [...new Set(cards.map((c) => c.split(':')[1]))]

// ---- Replay ----

describe('replay', () => {
  it('derives FSRS state, introduction day and review history', () => {
    const sim = new Sim(chapterSet([sample()]))
    sim.review('sample-001:cz-en', 1)
    sim.minutes(10)
    sim.review('sample-001:cz-en', 3)
    const c = sim.world().derived.cards.get('sample-001:cz-en')!
    expect(c.introduced).toBe('2026-10-13')
    expect(c.fsrs.state).toBe(State.Review)
    expect(c.fsrs.reps).toBe(2)
    expect(c.reviews.map((r) => [r.day, r.r, r.before])).toEqual([
      ['2026-10-13', 1, State.New],
      ['2026-10-13', 3, State.Learning],
    ])
  })

  it('ignores undone reviews, so an undone introduction makes the card new again', () => {
    const sim = new Sim(chapterSet([sample()]))
    const first = sim.review('sample-001:cz-en', 3)
    sim.add('undo', { target: first.id })
    const d = sim.world().derived
    expect(d.cards.get('sample-001:cz-en')).toBeUndefined()
    expect(d.historyWords.has('sample-001')).toBe(true)
    expect(newAllowance(sim.world())).toBe(10)
  })

  it('orders events by time then id, whatever order they arrive in', () => {
    const sim = new Sim(chapterSet([sample()]))
    sim.review('sample-001:cz-en', 1)
    sim.minutes(10)
    sim.review('sample-001:cz-en', 4)
    const a = replay(sim.events)
    const b = replay([...sim.events].reverse())
    expect(b.cards.get('sample-001:cz-en')).toEqual(a.cards.get('sample-001:cz-en'))
  })

  it('applies settings, learn-more, delete, flag and day-cleared events', () => {
    const sim = new Sim(chapterSet([sample()]))
    sim.add('setting', { key: 'newPerDay', value: 99 })
    sim.add('learnMore', { day: '2026-10-13' })
    sim.add('learnMore', { day: '2026-10-13' })
    sim.add('delete', { word: 'sample-002' })
    sim.add('flag', { word: 'sample-003', hash: 'abc' })
    sim.add('dayCleared', { day: '2026-10-13' })
    const d = sim.world().derived
    expect(d.newPerDay).toBe(50)
    expect(d.learnMore.get('2026-10-13')).toBe(2)
    expect(d.words.get('sample-002')?.deleted).toBe(true)
    expect(d.words.get('sample-003')?.flagHash).toBe('abc')
    expect(d.cleared.has('2026-10-13')).toBe(true)
  })

  it('gives the same result incrementally as a full replay', () => {
    const sim = new Sim(chapterSet([sample()]))
    sim.studyAll(3)
    const d = replay(sim.events.slice(0, -1))
    const last = sim.events.at(-1)!
    expect(canApplyIncrementally(d, last)).toBe(true)
    applyEvent(d, last)
    expect(d).toEqual(replay(sim.events))
    expect(canApplyIncrementally(d, { ...last, id: 'older', t: '2000-01-01T00:00:00.000Z' })).toBe(false)
    expect(canApplyIncrementally(d, { ...last, id: 'zzz', type: 'undo', target: last.id })).toBe(false)
  })

  it('survives the cache round trip', () => {
    const sim = new Sim(chapterSet([sample()]))
    sim.studyAll(1)
    sim.add('suspend', { card: 'sample-004:en-cz' })
    const d = sim.world().derived
    const json = JSON.parse(JSON.stringify(toCache(d, 'fp')))
    expect(json.fingerprint).toBe('fp')
    expect(fromCache(json)).toEqual(d)
  })

  it('replays tens of thousands of events well under a second', () => {
    const set = chapterSet([chapterFile('big', 1, 1000)])
    const events: AppEvent[] = []
    let t = new Date(2026, 0, 1, 8).getTime()
    for (let i = 0; i < 30_000; i++) {
      const card = cardId(`big-${String((i % 1000) + 1).padStart(3, '0')}`, i % 2000 < 1000 ? 'cz-en' : 'en-cz')
      events.push({ ...makeEvent('windows-aaaaaa', 'review', { card, r: ((i % 4) + 1) as Grade }), t: new Date(t).toISOString() })
      t += 17 * 60_000
    }
    const start = performance.now()
    const d = replay(events)
    const ms = performance.now() - start
    expect(d.cards.size).toBe(2000)
    expect({ set: set.words.size, fast: ms < 1000 }).toEqual({ set: 1000, fast: true })
    console.info(`replay of 30,000 events: ${ms.toFixed(0)} ms`)
  })
})

// ---- Queue rules ----

describe('new cards', () => {
  it('introduces only Czech→English cards on the first day, and their siblings from the next day', () => {
    const sim = new Sim(chapterSet([sample()]))
    expect(eligibleNewCards(sim.world())).toHaveLength(8)
    const day1 = sim.studyAll()
    expect(day1).toHaveLength(8)
    expect(dirs(day1)).toEqual(['cz-en'])
    expect(dayStatus(sim.world())).toMatchObject({ done: true, canLearnMore: false, due: 0 })

    sim.days(1)
    expect(dirs(eligibleNewCards(sim.world()))).toEqual(['en-cz'])
    const day2 = sim.studyAll()
    expect(dirs(day2)).toEqual(['en-cz'])
    expect(day2).toHaveLength(8)
  })

  it('shows 16 cards for the sample: 8 words, both directions', () => {
    const w = new Sim(chapterSet([sample()])).world()
    expect(chapterProgress(w)).toEqual([{ chapter: expect.objectContaining({ id: 'sample', title: 'Sample' }), introduced: 0, total: 16 }])
  })

  it('allows 10 a day by default, and exactly 5 more per "Learn 5 more"', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 30)]))
    expect(sim.studyAll()).toHaveLength(10)
    expect(dayStatus(sim.world())).toMatchObject({ done: true, canLearnMore: true, newAvailable: 0 })
    sim.add('learnMore', { day: studyDay(sim.now) })
    expect(dayStatus(sim.world()).newAvailable).toBe(5)
    expect(sim.studyAll()).toHaveLength(5)
    expect(newAllowance(sim.world())).toBe(0)
  })

  it('follows the synced newPerDay setting', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 30)]))
    sim.add('setting', { key: 'newPerDay', value: 3 })
    expect(sim.studyAll()).toHaveLength(3)
  })

  it('counts both directions and introductions from another device', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 30)]))
    sim.studyAll()
    sim.days(1)
    sim.review('c1-001:en-cz', 3, 'android-bbbbbb')
    sim.review('c1-020:cz-en', 3, 'android-bbbbbb')
    expect(newAllowance(sim.world())).toBe(8)
  })

  it('takes misc first, then chapters by order with ties by id, then file order', () => {
    const set = chapterSet([chapterFile('b', 2, 1), chapterFile('a', 2, 1), chapterFile('first', 1, 1), chapterFile('misc', 0, 2)])
    const w = new Sim(set).world()
    expect(eligibleNewCards(w)).toEqual(['misc-001:cz-en', 'misc-002:cz-en', 'first-001:cz-en'])
  })

  it('opens a chapter only after every lower chapter is introduced in both directions', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 3), chapterFile('c2', 2, 3)]))
    expect(sim.studyAll()).toEqual(['c1-001:cz-en', 'c1-002:cz-en', 'c1-003:cz-en'])
    sim.days(1)
    // The en-cz cards finish chapter 1, then chapter 2 opens on the same day.
    expect(sim.studyAll().filter((c) => c.endsWith(':en-cz') || c.startsWith('c2'))).toEqual([
      'c1-001:en-cz',
      'c1-002:en-cz',
      'c1-003:en-cz',
      'c2-001:cz-en',
      'c2-002:cz-en',
      'c2-003:cz-en',
    ])
  })

  it('lets the English→Czech card in when its Czech→English sibling is suspended, and still opens later chapters', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 1), chapterFile('c2', 2, 1)]))
    sim.add('suspend', { card: 'c1-001:cz-en' })
    expect(eligibleNewCards(sim.world())).toEqual(['c1-001:en-cz'])
    // Introducing the only remaining card of chapter 1 opens chapter 2 the same day.
    expect(sim.studyAll()).toEqual(['c1-001:en-cz', 'c2-001:cz-en'])
  })

  it('skips hidden cards: deleted words and words removed from the files', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 3)]))
    sim.add('delete', { word: 'c1-002' })
    expect(eligibleNewCards(sim.world())).toEqual(['c1-001:cz-en', 'c1-003:cz-en'])
    sim.studyAll()
    sim.set = chapterSet([chapterFile('c1', 1, 1)]) // c1-003 removed from the file
    sim.days(1)
    expect(eligibleNewCards(sim.world())).toEqual(['c1-001:en-cz'])
    expect(dueCards(sim.world()).filter((c) => c.startsWith('c1-003'))).toEqual([])
  })
})

describe('siblings', () => {
  it('never shows both directions of a word on the same study day', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 5)]))
    for (let day = 0; day < 40; day++) {
      const shown = sim.studyAll(day % 3 === 0 ? 1 : 3)
      const words = shown.map((c) => c.split(':')[0])
      for (const w of new Set(words)) expect(new Set(shown.filter((c) => c.startsWith(`${w}:`))).size).toBe(1)
      sim.days(1)
    }
  })

  it('shows the one due earlier when both are due and neither has been seen', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 1)]))
    sim.review('c1-001:cz-en', 3)
    sim.days(1)
    sim.review('c1-001:en-cz', 3)
    sim.days(30)
    const w = sim.world()
    expect(dueCards(w)).toEqual(['c1-001:cz-en'])
    sim.review('c1-001:cz-en', 3)
    expect(isBuried(sim.world(), 'c1-001:en-cz')).toBe(true)
    expect(dueCards(sim.world())).toEqual([])
  })

  it('lets a card continue its own learning steps after burying its sibling', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 1)]))
    sim.review('c1-001:cz-en', 3)
    sim.days(1)
    sim.review('c1-001:en-cz', 1)
    sim.minutes(11)
    expect(dueCards(sim.world())).toEqual(['c1-001:en-cz'])
  })
})

describe('learning steps and waiting', () => {
  it('brings an Again card back after about 10 minutes, with other cards in between', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 10)]))
    const plan = buildPlan(sim.world(), () => 0)
    const first = pickNext(sim.world(), plan)
    expect(first).toEqual({ kind: 'card', card: 'c1-001:cz-en' })
    sim.review('c1-001:cz-en', 1)
    const between: string[] = []
    for (let i = 0; i < 9; i++) {
      sim.minutes(1)
      const next = pickNext(sim.world(), plan)
      if (next.kind !== 'card') throw new Error('expected a card')
      between.push(next.card)
      sim.review(next.card, 3)
    }
    expect(between).not.toContain('c1-001:cz-en')
    sim.minutes(1)
    expect(pickNext(sim.world(), plan)).toEqual({ kind: 'card', card: 'c1-001:cz-en' })
  })

  it('learns ahead when the next learning card is within 20 minutes and nothing else is left', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 1)]))
    sim.review('c1-001:cz-en', 1)
    const status = dayStatus(sim.world())
    expect(status).toMatchObject({ due: 0, done: false })
    expect(pickNext(sim.world(), { slots: [], pos: 0 })).toEqual({ kind: 'card', card: 'c1-001:cz-en' })
  })

  it('waits with "Next card in N min" when the next learning card is further off', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 1)]))
    sim.review('c1-001:cz-en', 1)
    const w = sim.world()
    const due = new Date(sim.now.getTime() + 45 * 60_000)
    w.derived.cards.get('c1-001:cz-en')!.fsrs.due = due
    expect(pickNext(w, { slots: [], pos: 0 })).toEqual({ kind: 'wait', until: due })
  })

  it('is done for today when a learning card is next due after the day ends', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 1)]), new Date(2026, 9, 14, 3, 30))
    sim.review('c1-001:cz-en', 1)
    const w = sim.world()
    w.derived.cards.get('c1-001:cz-en')!.fsrs.due = new Date(2026, 9, 14, 4, 30)
    expect(pickNext(w, { slots: [], pos: 0 })).toEqual({ kind: 'done' })
    expect(dayStatus(w).done).toBe(true)
  })
})

describe('done for today', () => {
  it('is done when nothing is due, even with fewer new cards than the allowance', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 4)]))
    expect(dayStatus(sim.world())).toMatchObject({ done: false, newAvailable: 4 })
    sim.studyAll()
    expect(dayStatus(sim.world())).toMatchObject({ done: true, canLearnMore: false, newAvailable: 0 })
    expect(pickNext(sim.world(), buildPlan(sim.world()))).toEqual({ kind: 'done' })
  })

  it('rolls over at 4 am local time', () => {
    const sim = new Sim(chapterSet([sample()]))
    sim.studyAll()
    sim.now = new Date(2026, 9, 14, 3, 59)
    expect(eligibleNewCards(sim.world())).toEqual([])
    sim.now = new Date(2026, 9, 14, 4, 0)
    expect(eligibleNewCards(sim.world())).toHaveLength(8)
  })
})

describe('session plan', () => {
  it('shuffles reviews and spreads new cards among them', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 30)]))
    sim.studyAll()
    sim.days(2) // cz-en cards graded Good are due again after two days
    sim.add('setting', { key: 'newPerDay', value: 4 })
    const w = sim.world()
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const plan = buildPlan(w, random)
    const reviews = plan.slots.filter((s) => s.kind === 'review')
    const newSlots = plan.slots.map((s, i) => (s.kind === 'new' ? i : -1)).filter((i) => i >= 0)
    expect(reviews).toHaveLength(10)
    expect(newSlots).toHaveLength(4)
    expect(reviews.map((s) => (s as { card: string }).card)).not.toEqual(dueCards(w))
    // Roughly even: one new card in each quarter of the session.
    newSlots.forEach((pos, i) => expect(pos).toBeGreaterThanOrEqual(Math.floor((i * 10) / 4) + i))
  })

  it('fills a buried new slot with the next eligible new card', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 2)]))
    sim.review('c1-001:cz-en', 3)
    sim.review('c1-002:cz-en', 3)
    sim.days(2)
    // Today c1-001:cz-en is due for review and c1-001:en-cz is a new card; seeing one buries the other.
    sim.review('c1-001:cz-en', 3)
    expect(eligibleNewCards(sim.world())).not.toContain('c1-001:en-cz')
    expect(eligibleNewCards(sim.world())).toContain('c1-002:en-cz')
  })
})

describe('flags', () => {
  it('lapses once the word content no longer matches the flagged hash', () => {
    const sim = new Sim(chapterSet([sample()]))
    const hash = sim.set.words.get('sample-001')!.hash
    sim.add('flag', { word: 'sample-001', hash })
    expect(isFlagged(sim.world(), 'sample-001')).toBe(true)
    sim.set.words.set('sample-001', { ...sim.set.words.get('sample-001')!, hash: 'edited' })
    expect(isFlagged(sim.world(), 'sample-001')).toBe(false)
    sim.add('unflag', { word: 'sample-002' })
    expect(isFlagged(sim.world(), 'sample-002')).toBe(false)
  })
})

describe('streak', () => {
  it('counts consecutive cleared days ending today, or yesterday if today is not cleared yet', () => {
    const cleared = new Set(['2026-10-08', '2026-10-10', '2026-10-11', '2026-10-12'])
    expect(streak(cleared, '2026-10-13')).toEqual({ current: 3, longest: 3 })
    cleared.add('2026-10-13')
    expect(streak(cleared, '2026-10-13')).toEqual({ current: 4, longest: 4 })
    expect(streak(cleared, '2026-10-15')).toEqual({ current: 0, longest: 4 })
    expect(streak(new Set(), '2026-10-13')).toEqual({ current: 0, longest: 0 })
  })

  it('clears a day once no card is due before it ends, ignoring unused new cards', () => {
    const sim = new Sim(chapterSet([chapterFile('c1', 1, 3)]))
    expect(isDayCleared(sim.world())).toBe(true) // nothing introduced, nothing due
    sim.review('c1-001:cz-en', 1)
    expect(isDayCleared(sim.world())).toBe(false) // learning card due in 10 minutes
    sim.minutes(10)
    sim.review('c1-001:cz-en', 3)
    expect(isDayCleared(sim.world())).toBe(true)
  })
})
