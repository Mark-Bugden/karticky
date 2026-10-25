import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChapterFiles } from './chapters'
import { DECKS } from './config'
import type { LastSeenWord } from './db'
import { makeEvent } from './events'
import type { World } from './queue'
import { includeKey, replay } from './replay'
import { buildSummary, cardColumns, sameSummary, seedsFromSummary, summaryText } from './summary'
import type { AppEvent, ChapterSet, EventType, Grade, LoadedWord } from './types'

const sampleText = readFileSync(new URL('../../sample/sample.json', import.meta.url), 'utf8')
const czech = DECKS.czech

function sampleSet(extraFiles: { path: string; text: string }[] = []): ChapterSet {
  const { chapters, words, errors } = parseChapterFiles([{ path: 'chapters/sample.json', text: sampleText }, ...extraFiles], czech)
  const loaded = new Map<string, LoadedWord>()
  for (const [id, w] of words) loaded.set(id, { ...w, hash: `hash-${id}` })
  return { chapters, words: loaded, errors }
}

class Log {
  events: AppEvent[] = []
  constructor(public now = new Date(2026, 9, 1, 8, 0)) {}
  add(type: EventType, fields: Partial<AppEvent> = {}) {
    this.events.push(makeEvent('windows-aaaaaa', type, fields, this.now))
    this.now = new Date(this.now.getTime() + 1000)
  }
  review(card: string, r: Grade) {
    this.add('review', { card, r })
  }
  at(day: number, hour = 8) {
    this.now = new Date(2026, 9, day, hour, 0)
  }
  world(set = sampleSet()): World {
    return { now: this.now, deck: czech, set, derived: replay(this.events) }
  }
}

const row = (s: ReturnType<typeof buildSummary>, card: string) => {
  const r = s.cards.find((c) => c[0] === card)!
  return Object.fromEntries(cardColumns(czech).map((name, i) => [name, r[i]]))
}

describe('summary', () => {
  it('has the documented fields in order and one row per card', () => {
    const s = buildSummary(new Log().world(), 'windows-aaaaaa', new Map())
    expect(Object.keys(s)).toEqual([
      'format',
      'generatedAt',
      'device',
      'settings',
      'streak',
      'totals',
      'byChapter',
      'byDirection',
      'cardColumns',
      'cards',
      'lists',
      'fileErrors',
    ])
    expect(s.format).toBe(1)
    expect(s.device).toBe('windows-aaaaaa')
    expect(s.settings).toEqual({ newPerDay: 10, retention: 0.9 })
    expect(s.cardColumns).toEqual(['card', 'chapter', 'cz', 'en', 'state', 'introduced', 'due', 'stability', 'difficulty', 'reps', 'lapses', 'reviews'])
    expect(s.cards).toHaveLength(16)
    expect(row(s, 'sample-001:cz-en')).toEqual({
      card: 'sample-001:cz-en',
      chapter: 'sample',
      cz: 'pes',
      en: 'dog',
      state: 'new',
      introduced: null,
      due: null,
      stability: null,
      difficulty: null,
      reps: 0,
      lapses: 0,
      reviews: '',
    })
  })

  it('records review history as study days and grades, leaving out undone reviews', () => {
    const log = new Log()
    log.at(12, 23)
    log.review('sample-001:cz-en', 1)
    log.at(13, 2) // before 4 am: still the 12th's study day
    log.review('sample-001:cz-en', 3)
    log.add('undo', { target: log.events.at(-1)!.id })
    log.review('sample-001:cz-en', 4)
    log.at(15)
    log.review('sample-001:cz-en', 3)
    const s = buildSummary(log.world(), 'd', new Map())
    const r = row(s, 'sample-001:cz-en')
    expect(r.reviews).toBe('2026-10-12:1 2026-10-12:4 2026-10-15:3')
    expect(r).toMatchObject({ state: 'review', introduced: '2026-10-12', reps: 3, lapses: 0 })
    expect(r.due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(String(r.stability)).toMatch(/^\d+(\.\d)?$/)
    expect(String(r.difficulty)).toMatch(/^\d+(\.\d)?$/)
  })

  it('contains no times of day or durations apart from generatedAt', () => {
    const log = new Log()
    log.review('sample-001:cz-en', 1)
    log.review('sample-002:cz-en', 3)
    const s = buildSummary(log.world(), 'd', new Map())
    const { generatedAt, ...rest } = s
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(JSON.stringify(rest)).not.toMatch(/T\d{2}:\d{2}|\d{2}:\d{2}:\d{2}/)
  })

  it('counts only non-hidden cards in group metrics, flagged words being hidden, but lists hidden cards', () => {
    const log = new Log()
    log.review('sample-001:cz-en', 3)
    log.add('suspend', { card: 'sample-001:en-cz' })
    log.add('delete', { word: 'sample-002' })
    log.add('flag', { word: 'sample-003', hash: 'hash-sample-003' })
    log.add('flag', { word: 'sample-004', hash: 'stale' })
    const s = buildSummary(log.world(), 'd', new Map())
    expect(s.totals).toEqual({ words: 6, cards: 11, introduced: 1, reviews: 1, lapses: 0, dueToday: 0 })
    expect(s.cards).toHaveLength(16)
    expect(s.lists).toEqual({
      struggling: [],
      flagged: ['sample-003'],
      deleted: ['sample-002'],
      removed: [],
      suspended: ['sample-001:en-cz'],
    })
    expect(s.byChapter).toEqual([
      expect.objectContaining({ id: 'sample', title: 'Sample', order: 1, words: 6, cards: 11, introduced: 1 }),
    ])
    expect(s.byDirection['cz-en']).toMatchObject({ cards: 6, introduced: 1 })
    expect(s.byDirection['en-cz']).toMatchObject({ cards: 5, introduced: 0 })
  })

  it('marks ticked chapters and leaves paused cards out of dueToday', () => {
    const log = new Log()
    log.add('setting', { key: includeKey('sample'), value: 1 })
    log.review('sample-001:cz-en', 3)
    log.at(10)
    let s = buildSummary(log.world(), 'd', new Map())
    expect(s.byChapter[0]).toMatchObject({ id: 'sample', included: true, introduced: 1, learned: 0 })
    expect(s.totals.dueToday).toBe(1)
    log.add('setting', { key: includeKey('sample'), value: 0 })
    s = buildSummary(log.world(), 'd', new Map())
    expect(s.byChapter[0].included).toBe(false)
    expect(s.totals.dueToday).toBe(0)
  })

  it('names removed words from the last-seen copy, or null if never seen', () => {
    const log = new Log()
    log.review('gone-1:cz-en', 3)
    log.review('gone-2:cz-en', 3)
    const lastSeen = new Map<string, LastSeenWord>([['gone-1', { id: 'gone-1', chapterId: 'old', term: 'kočka', en: 'cat' }]])
    const s = buildSummary(log.world(), 'd', lastSeen)
    expect(s.lists.removed).toEqual(['gone-1', 'gone-2'])
    expect(row(s, 'gone-1:cz-en')).toMatchObject({ chapter: 'old', cz: 'kočka', en: 'cat' })
    expect(row(s, 'gone-2:en-cz')).toMatchObject({ chapter: null, cz: null, en: null })
    expect(s.totals.cards).toBe(16)
  })

  it('computes retention, maturity, difficulty and struggling cards', () => {
    const log = new Log()
    // Card A: Good, then a lapse, relearned, then remembered.
    log.at(1)
    log.review('sample-001:cz-en', 3)
    log.at(5)
    log.review('sample-001:cz-en', 1) // a review-state card forgotten: counts against retention
    log.now = new Date(log.now.getTime() + 10 * 60_000)
    log.review('sample-001:cz-en', 3) // relearning: not counted
    log.at(10)
    log.review('sample-001:cz-en', 3) // review-state, remembered
    // Card B: Easy three times far apart becomes mature.
    log.at(1)
    log.review('sample-002:cz-en', 4)
    log.at(12)
    log.review('sample-002:cz-en', 4)
    log.at(28)
    log.review('sample-002:cz-en', 4)
    // Card C: four lapses.
    log.at(2)
    log.review('sample-003:cz-en', 3)
    for (let d = 4; d < 12; d += 2) {
      log.at(d)
      log.review('sample-003:cz-en', 1)
      log.now = new Date(log.now.getTime() + 10 * 60_000)
      log.review('sample-003:cz-en', 3)
    }
    log.at(29)
    const w = log.world()
    const s = buildSummary(w, 'd', new Map())
    expect(row(s, 'sample-003:cz-en').lapses).toBe(4)
    expect(s.lists.struggling).toContain('sample-003:cz-en')
    expect(row(s, 'sample-002:cz-en').stability as number).toBeGreaterThanOrEqual(21)
    expect(s.byChapter[0].mature).toBe(1)
    // Review-state reviews in the last 30 days: A (1, 3), B (4, 4), C (1, 1, 1, 1) → 3 of 8 recalled.
    expect(s.byChapter[0].retention30d).toBe(0.375)
    expect(s.byChapter[0].avgDifficulty).toBeGreaterThan(0)
    expect(s.byDirection['en-cz']).toMatchObject({ retention30d: null, avgDifficulty: null })
  })

  it('reports streaks and chapter-file problems', () => {
    const log = new Log()
    for (const day of ['2026-09-29', '2026-09-30', '2026-10-01']) log.add('dayCleared', { day })
    const set = sampleSet([{ path: 'chapters/bad.json', text: 'nope' }])
    const s = buildSummary(log.world(set), 'd', new Map())
    expect(s.streak).toEqual({ current: 3, longest: 3 })
    expect(s.fileErrors).toEqual([{ file: 'chapters/bad.json', problem: expect.stringContaining('Not valid JSON') }])
  })

  it('compares summaries ignoring generatedAt and device', () => {
    const w = new Log().world()
    const a = summaryText(buildSummary(w, 'windows-aaaaaa', new Map()))
    const b = summaryText(buildSummary({ ...w, now: new Date(w.now.getTime() + 60_000) }, 'android-bbbbbb', new Map()))
    expect(a).not.toBe(b)
    expect(sameSummary(a, b)).toBe(true)
    expect(sameSummary(a, undefined)).toBe(false)
    const log = new Log()
    log.add('suspend', { card: 'sample-001:cz-en' })
    expect(sameSummary(a, summaryText(buildSummary(log.world(), 'd', new Map())))).toBe(false)
  })

  it('yields last-seen seeds from a summary', () => {
    const s = summaryText(buildSummary(new Log().world(), 'd', new Map()))
    const seeds = seedsFromSummary(s, czech)
    expect(seeds).toHaveLength(8)
    expect(seeds[0]).toEqual({ id: 'sample-001', chapterId: 'sample', term: 'pes', en: 'dog' })
    expect(seedsFromSummary('not json', czech)).toEqual([])
  })
})
