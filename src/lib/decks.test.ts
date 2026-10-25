import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { DECKS } from './config'
import { KartickyDB } from './db'
import { DECK_KEY, findDeck, setupChoice, storeDeck, storedDeck } from './decks'
import { Engine } from './engine'
import { GitHub, type FetchFn } from './github'
import { cardState } from './queue'
import type { Summary } from './summary'
import { SUMMARY_PATH } from './sync'
import { FakeGitHub, fakeGitHubs } from './testing/fakeGitHub'

const { czech, spanish } = DECKS
const sampleCz = readFileSync(new URL('../../sample/sample.json', import.meta.url), 'utf8')
const sampleEs = readFileSync(new URL('../../sample/sample-es.json', import.meta.url), 'utf8')

/** Both data repos, and a fine-grained token for each (any other token sees both). */
function github() {
  const cz = new FakeGitHub('karticky-czech')
  const es = new FakeGitHub('karticky-spanish')
  cz.commitFiles({ 'README.md': '# Data\n', 'chapters/sample.json': sampleCz }, 'Initial commit')
  es.commitFiles({ 'README.md': '# karticky-spanish\n', 'chapters/sample.json': sampleEs }, 'Initial commit')
  const fetch = fakeGitHubs([cz, es], { 'cz-token': ['karticky-czech'], 'es-token': ['karticky-spanish'], 'no-token': [] })
  return { cz, es, fetch }
}

class MemoryStore {
  items = new Map<string, string>()
  getItem = (k: string) => this.items.get(k) ?? null
  setItem = (k: string, v: string) => void this.items.set(k, v)
}

describe('the stored deck', () => {
  it('is Czech when nothing, or nothing valid, is stored', () => {
    const store = new MemoryStore()
    expect(storedDeck(store)).toBe(czech)
    store.items.set(DECK_KEY, 'klingon')
    expect(storedDeck(store)).toBe(czech)
    expect(storedDeck(undefined)).toBe(czech)
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(storedDeck(broken)).toBe(czech)
    expect(() => storeDeck(spanish, broken)).not.toThrow()
  })

  it('remembers the deck chosen at Setup', () => {
    const store = new MemoryStore()
    storeDeck(spanish, store)
    expect(store.items.get(DECK_KEY)).toBe('spanish')
    expect(storedDeck(store)).toBe(spanish)
  })
})

describe('finding the deck from a token', () => {
  it('picks the one deck whose repo the token can see', async () => {
    const { fetch } = github()
    expect(await findDeck('cz-token', fetch)).toEqual({ ok: true, deck: czech })
    expect(await findDeck('es-token', fetch)).toEqual({ ok: true, deck: spanish })
  })

  it('refuses a token that sees both repos, or neither', async () => {
    const { fetch } = github()
    expect(await findDeck('any-token', fetch)).toEqual({ ok: false, message: 'This token can see both decks. Make a token for one repository only.' })
    expect(await findDeck('no-token', fetch)).toEqual({ ok: false, message: "This token can't see karticky-czech or karticky-spanish." })
  })

  it('gives the V1 messages for a rejected token, no connection or a rate limit, and picks no deck', async () => {
    const { fetch } = github()
    expect(await findDeck('bad-token', fetch)).toMatchObject({ ok: false, message: expect.stringContaining("didn't accept") })
    expect(await findDeck('es-token', () => Promise.reject(new TypeError('offline')))).toMatchObject({
      ok: false,
      message: expect.stringContaining('offline'),
    })
    // The Czech repo answers but the Spanish one cannot be asked: the token might see both.
    const half: FetchFn = (url, init) => (url.includes('karticky-spanish') ? Promise.reject(new TypeError('offline')) : fetch(url, init))
    expect(await findDeck('cz-token', half)).toMatchObject({ ok: false, message: expect.stringContaining('offline') })
    const limited: FetchFn = async (url, init) =>
      url.includes('karticky-czech') ? new Response('{}', { status: 429, headers: { 'retry-after': '60' } }) : fetch(url, init)
    expect(await findDeck('es-token', limited)).toMatchObject({ ok: false, message: expect.stringContaining('limiting') })
  })
})

describe('taking a token for a deck', () => {
  it("uses the device's own deck, switches an empty device, and refuses the other deck on a device with data", () => {
    expect(setupChoice(czech, true, czech)).toEqual({ kind: 'same' })
    expect(setupChoice(czech, false, spanish)).toEqual({ kind: 'switch' })
    expect(setupChoice(spanish, false, czech)).toEqual({ kind: 'switch' })
    expect(setupChoice(czech, true, spanish)).toEqual({
      kind: 'refuse',
      message: 'This token is for the Spanish deck, but this device studies Czech. Use a separate Chrome profile for Spanish.',
    })
    expect(setupChoice(spanish, true, czech)).toEqual({
      kind: 'refuse',
      message: 'This token is for the Czech deck, but this device studies Spanish. Use a separate Chrome profile for Czech.',
    })
  })
})

describe('a Spanish deck', () => {
  let dbs: KartickyDB[] = []
  let n = 0
  let now = new Date(2026, 9, 26, 8, 0)
  const clock = () => now
  const noSleep = async () => {}
  afterEach(async () => {
    for (const db of dbs) await db.delete()
    dbs = []
  })
  async function device(deck = spanish): Promise<Engine> {
    const db = new KartickyDB(`${deck.db}-test-${++n}`)
    dbs.push(db)
    const engine = new Engine(db, deck, clock)
    await engine.load()
    return engine
  }

  it('syncs the Spanish sample: chapter Sample, 8 words, 16 cards, a summary in es', async () => {
    const { es, fetch } = github()
    const a = await device()
    await a.sync(new GitHub('es-token', spanish.repo, fetch), noSleep)
    expect(a.set.chapters.map((c) => [c.title, c.wordIds.length])).toEqual([['Sample', 8]])
    expect(a.set.errors).toEqual([])
    const summary = JSON.parse(es.file(SUMMARY_PATH)!) as Summary
    expect(summary.cardColumns[2]).toBe('es')
    expect(Object.keys(summary.byDirection)).toEqual(['es-en', 'en-es'])
    expect(summary.totals).toMatchObject({ words: 8, cards: 16 })
  })

  it('merges two Spanish devices that studied offline, keeping every review with one commit per sync', async () => {
    const { es, fetch } = github()
    const gh = new GitHub('es-token', spanish.repo, fetch)
    const a = await device()
    const b = await device()
    await a.sync(gh, noSleep)
    await b.sync(gh, noSleep)
    const before = es.history().length
    await a.record('review', { card: 'sample-005:es-en', r: 3 })
    now = new Date(now.getTime() + 60_000)
    await b.record('review', { card: 'sample-005:es-en', r: 1 })
    await b.record('review', { card: 'sample-001:es-en', r: 4 })
    expect((await a.sync(gh, noSleep)).pushed).toBe(1)
    expect((await b.sync(gh, noSleep)).pushed).toBe(2)
    expect((await a.sync(gh, noSleep)).pushed).toBeNull()
    expect(es.history()).toHaveLength(before + 2)
    for (const e of [a, b]) {
      expect(cardState(e.derived, 'sample-005:es-en').reviews.map((r) => r.r)).toEqual([3, 1])
      expect(e.derived.cards.size).toBe(2)
    }
  })

  it('keeps a Czech and a Spanish deck apart: own database, own repo, and no events from the other', async () => {
    const { cz, es, fetch } = github()
    const czDevice = await device(czech)
    const esDevice = await device(spanish)
    await czDevice.sync(new GitHub('cz-token', czech.repo, fetch), noSleep)
    await esDevice.sync(new GitHub('es-token', spanish.repo, fetch), noSleep)
    await czDevice.record('review', { card: 'sample-001:cz-en', r: 3 })
    await esDevice.record('review', { card: 'sample-001:es-en', r: 3 })
    await czDevice.sync(new GitHub('cz-token', czech.repo, fetch), noSleep)
    await esDevice.sync(new GitHub('es-token', spanish.repo, fetch), noSleep)
    expect(cz.paths().filter((p) => p.startsWith('log/'))).toEqual([`log/${czDevice.deviceId}/2026-10-26.jsonl`])
    expect(es.paths().filter((p) => p.startsWith('log/'))).toEqual([`log/${esDevice.deviceId}/2026-10-26.jsonl`])

    // A Czech log copied into the Spanish repo by mistake is ignored there.
    es.commitFiles({ 'log/stray/2026-10-26.jsonl': cz.file(`log/${czDevice.deviceId}/2026-10-26.jsonl`)! })
    await esDevice.sync(new GitHub('es-token', spanish.repo, fetch), noSleep)
    expect([...esDevice.derived.cards.keys()]).toEqual(['sample-001:es-en'])
    expect(czDevice.set.words.get('sample-001')?.term).toBe('pes')
    expect(esDevice.set.words.get('sample-001')?.term).toBe('el perro')
  })
})
