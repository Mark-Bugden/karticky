import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  KartickyDB,
  addLocalEvent,
  allEvents,
  deviceEventsOnUtcDate,
  eventsFingerprint,
  getDeviceId,
  getMeta,
  markPushed,
  mergeRemoteEvents,
  rememberWords,
  seedLastSeen,
  setMeta,
  unpushedEvents,
} from './db'
import { DECKS } from './config'
import { cardId, compareEvents, DIRECTIONS, isValidEvent, makeEvent, parseCardId, parseLogFile, siblingId, toLogLine } from './events'
import type { AppEvent } from './types'

const czech = DECKS.czech

let db: KartickyDB
let n = 0
beforeEach(() => {
  db = new KartickyDB(`test-${++n}`)
})
afterEach(async () => {
  await db.delete()
})

const ev = (id: string, t: string, dev = 'windows-aaaaaa', extra: Partial<AppEvent> = {}): AppEvent => ({
  id,
  t,
  dev,
  type: 'review',
  card: 'w1:cz-en',
  r: 3,
  ...extra,
})

describe('card ids', () => {
  it('builds, parses and flips card ids', () => {
    expect(cardId(czech, 'ch01-006', 'reverse')).toBe('ch01-006:en-cz')
    expect(parseCardId('ch01-006:en-cz')).toEqual({ wordId: 'ch01-006', dir: 'reverse' })
    expect(siblingId('ch01-006:cz-en')).toBe('ch01-006:en-cz')
    expect(siblingId('ch01-006:en-cz')).toBe('ch01-006:cz-en')
  })

  it('keeps the names every existing Czech card id, database and sync lock already use', () => {
    expect(czech).toMatchObject({ repo: 'karticky-czech', code: 'cz', db: 'karticky', syncLock: 'karticky-sync' })
    expect(DIRECTIONS.map((d) => cardId(czech, 'w', d))).toEqual(['w:cz-en', 'w:en-cz'])
    expect(DIRECTIONS.map((d) => parseCardId(cardId(czech, 'w', d)).dir)).toEqual(['forward', 'reverse'])
  })
})

describe('events', () => {
  it('makes events with a uuid and a millisecond UTC timestamp', () => {
    const e = makeEvent('android-3f9a1c', 'review', { card: 'w:cz-en', r: 1 }, new Date('2026-10-13T08:00:00Z'))
    expect(e).toMatchObject({ t: '2026-10-13T08:00:00.000Z', dev: 'android-3f9a1c', type: 'review', card: 'w:cz-en', r: 1 })
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(isValidEvent(e, czech)).toBe(true)
  })

  it('sorts by timestamp, then id', () => {
    const list = [ev('b', '2026-10-13T08:00:00.000Z'), ev('a', '2026-10-13T08:00:00.000Z'), ev('c', '2026-10-12T08:00:00.000Z')]
    expect(list.sort(compareEvents).map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('rejects malformed events', () => {
    const ok = ev('x', '2026-10-13T08:00:00.000Z')
    expect(isValidEvent(ok, czech)).toBe(true)
    expect(isValidEvent({ ...ok, r: 5 }, czech)).toBe(false)
    expect(isValidEvent({ ...ok, t: '2026-10-13' }, czech)).toBe(false)
    expect(isValidEvent({ ...ok, card: 'w1' }, czech)).toBe(false)
    expect(isValidEvent({ ...ok, type: 'teleport' }, czech)).toBe(false)
    expect(isValidEvent({ id: 'f', t: ok.t, dev: 'd', type: 'flag', word: 'w1' }, czech)).toBe(false)
    expect(isValidEvent({ id: 'f', t: ok.t, dev: 'd', type: 'flag', word: 'w1', hash: 'abc' }, czech)).toBe(true)
    expect(isValidEvent({ id: 's', t: ok.t, dev: 'd', type: 'setting', key: 'newPerDay', value: 12 }, czech)).toBe(true)
    expect(isValidEvent({ id: 'l', t: ok.t, dev: 'd', type: 'learnMore', day: '2026-10-13' }, czech)).toBe(true)
  })

  it('round-trips through a log file and skips damaged lines', () => {
    const a = ev('a', '2026-10-13T08:00:00.000Z')
    const b = ev('b', '2026-10-13T09:00:00.000Z', 'd', { type: 'undo', card: undefined, r: undefined, target: 'a' })
    const text = [toLogLine(a), '{broken', '', toLogLine(b), JSON.stringify({ id: 'z' })].join('\n') + '\n'
    expect(parseLogFile(text, czech)).toEqual([a, { id: 'b', t: b.t, dev: 'd', type: 'undo', target: 'a' }])
    expect(toLogLine({ ...a, pushed: 0 } as AppEvent)).not.toContain('pushed')
  })
})

describe('database', () => {
  it('generates one device id and keeps it', async () => {
    const id = await getDeviceId(db)
    expect(id).toMatch(/^[a-z]+-[0-9a-f]{6}$/)
    expect(await getDeviceId(db)).toBe(id)
  })

  it('stores settings in the meta table', async () => {
    expect(await getMeta(db, 'token')).toBeUndefined()
    await setMeta(db, 'token', 'secret')
    expect(await getMeta(db, 'token')).toBe('secret')
  })

  it('tracks unpushed local events and marks them pushed', async () => {
    await addLocalEvent(db, ev('a', '2026-10-13T08:00:00.000Z'))
    await addLocalEvent(db, ev('b', '2026-10-13T09:00:00.000Z'))
    expect((await unpushedEvents(db)).map((e) => e.id).sort()).toEqual(['a', 'b'])
    await markPushed(db, ['a'])
    expect((await unpushedEvents(db)).map((e) => e.id)).toEqual(['b'])
  })

  it('merges remote events by id, ignoring duplicates, as already pushed', async () => {
    await addLocalEvent(db, ev('a', '2026-10-13T08:00:00.000Z'))
    const added = await mergeRemoteEvents(db, [
      ev('a', '2026-10-13T08:00:00.000Z'),
      ev('r1', '2026-10-13T07:00:00.000Z', 'android-111111'),
      ev('r1', '2026-10-13T07:00:00.000Z', 'android-111111'),
    ])
    expect(added).toBe(1)
    expect((await allEvents(db)).map((e) => e.id)).toEqual(['r1', 'a'])
    expect((await db.events.get('r1'))?.pushed).toBe(1)
    expect((await db.events.get('a'))?.pushed).toBe(0)
  })

  it("selects one device's events on a UTC date, sorted", async () => {
    await addLocalEvent(db, ev('late', '2026-10-13T23:59:59.999Z'))
    await addLocalEvent(db, ev('early', '2026-10-13T00:00:00.000Z'))
    await addLocalEvent(db, ev('next', '2026-10-14T00:00:00.000Z'))
    await mergeRemoteEvents(db, [ev('other', '2026-10-13T12:00:00.000Z', 'android-111111')])
    const list = await deviceEventsOnUtcDate(db, 'windows-aaaaaa', '2026-10-13')
    expect(list.map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('changes the fingerprint when events are added', async () => {
    const empty = await eventsFingerprint(db)
    await addLocalEvent(db, ev('a', '2026-10-13T08:00:00.000Z'))
    const one = await eventsFingerprint(db)
    expect(one).not.toBe(empty)
    await mergeRemoteEvents(db, [ev('b', '2026-10-12T08:00:00.000Z', 'x')])
    expect(await eventsFingerprint(db)).not.toBe(one)
  })

  it('remembers words and seeds only unknown ones', async () => {
    await rememberWords(db, [
      { id: 'w1', term: 'pes', en: 'dog', example: 'e', exampleEn: 'e', chapterId: 'c1', hash: 'h1' },
    ])
    const added = await seedLastSeen(db, [
      { id: 'w1', term: 'WRONG', en: 'WRONG', chapterId: 'x' },
      { id: 'w2', term: 'kočka', en: 'cat', chapterId: 'c1' },
    ])
    expect(added).toBe(1)
    expect((await db.lastSeen.get('w1'))?.term).toBe('pes')
    expect((await db.lastSeen.get('w2'))?.term).toBe('kočka')
  })

  it('upgrades a version 1 database, renaming cz to term in last-seen words and keeping the rest', async () => {
    const name = `v1-${++n}`
    const v1 = new Dexie(name)
    v1.version(1).stores({ events: 'id, [dev+t], pushed, [t+id]', files: 'path', lastSeen: 'id', meta: 'key' })
    await v1.table('lastSeen').bulkPut([
      { id: 'w1', chapterId: 'c1', cz: 'pes', en: 'dog', example: 'Náš pes.', exampleEn: 'Our dog.', hash: 'h1' },
      { id: 'w2', chapterId: null, cz: 'kočka', en: 'cat' },
    ])
    await v1.table('meta').put({ key: 'deviceId', value: 'windows-aaaaaa' })
    await v1.table('events').add({ ...ev('a', '2026-10-13T08:00:00.000Z'), pushed: 1 })
    v1.close()

    const v2 = new KartickyDB(name)
    expect(await v2.lastSeen.toArray()).toEqual([
      { id: 'w1', chapterId: 'c1', term: 'pes', en: 'dog', example: 'Náš pes.', exampleEn: 'Our dog.', hash: 'h1' },
      { id: 'w2', chapterId: null, term: 'kočka', en: 'cat' },
    ])
    expect(await getDeviceId(v2)).toBe('windows-aaaaaa')
    expect(await allEvents(v2)).toEqual([{ ...ev('a', '2026-10-13T08:00:00.000Z'), pushed: 1 }])
    await v2.delete()
  })
})
