import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KartickyDB, unpushedEvents } from './db'
import { Engine } from './engine'
import { checkAccess, GitHub, GitHubError } from './github'
import { cardState, isFlagged, isHidden } from './queue'
import { State } from './replay'
import type { Summary } from './summary'
import { SUMMARY_PATH, SyncQueue } from './sync'
import { FakeGitHub } from './testing/fakeGitHub'

const sampleText = readFileSync(new URL('../../sample/sample.json', import.meta.url), 'utf8')
const editSample = (fn: (data: { words: Record<string, unknown>[] }) => void) => {
  const data = JSON.parse(sampleText)
  fn(data)
  return JSON.stringify(data, null, 2)
}

let server: FakeGitHub
let now: Date
let dbs: KartickyDB[] = []
let n = 0
const clock = () => now
const noSleep = vi.fn(async (_ms: number) => {})

beforeEach(() => {
  server = new FakeGitHub()
  server.commitFiles({ 'README.md': '# Data\n', 'chapters/sample.json': sampleText }, 'Initial commit')
  now = new Date(2026, 9, 13, 8, 0)
  noSleep.mockClear()
})
afterEach(async () => {
  for (const db of dbs) await db.delete()
  dbs = []
})

async function device(): Promise<Engine> {
  const db = new KartickyDB(`sync-test-${++n}`)
  dbs.push(db)
  const engine = new Engine(db, clock)
  await engine.load()
  return engine
}

const gh = (token = 'good-token') => new GitHub(token, server.fetch)
const sync = (e: Engine) => e.sync(gh(), noSleep)
const tick = (minutes = 1) => {
  now = new Date(now.getTime() + minutes * 60_000)
}
const remoteSummary = () => JSON.parse(server.file(SUMMARY_PATH)!) as Summary

describe('sync', () => {
  it('loads the sample chapter on first sync and pushes a summary in one commit', async () => {
    const a = await device()
    const result = await sync(a)
    expect(result.changes.chapters).toBe(true)
    expect(a.set.chapters.map((c) => c.title)).toEqual(['Sample'])
    expect(a.set.words.size).toBe(8)
    expect(server.history()).toEqual(['Initial commit', `sync ${a.deviceId}: 0 events`])
    expect(remoteSummary().cards).toHaveLength(16)
  })

  it('does not commit when an idle device syncs again', async () => {
    const a = await device()
    await sync(a)
    const requestsBefore = server.requests.length
    expect((await sync(a)).pushed).toBeNull()
    expect((await sync(a)).pushed).toBeNull()
    expect(server.history()).toHaveLength(2)
    // An unchanged head costs one request.
    expect(server.requests.length - requestsBefore).toBe(2)
  })

  it('pushes the summary again only when its content changes', async () => {
    const a = await device()
    await sync(a)
    now = new Date(2026, 9, 14, 8, 0) // a new day changes the streak window but not the content here
    expect((await sync(a)).pushed).toBeNull()
    await a.record('suspend', { card: 'sample-001:en-cz' })
    expect((await sync(a)).pushed).toBe(1)
    expect(remoteSummary().lists.suspended).toEqual(['sample-001:en-cz'])
  })

  it('merges two devices that studied offline, keeping every review with one commit per sync', async () => {
    const a = await device()
    const b = await device()
    await sync(a)
    await sync(b)
    const before = server.history().length

    for (const card of ['sample-001:cz-en', 'sample-002:cz-en', 'sample-003:cz-en']) {
      await a.record('review', { card, r: 3 })
      tick()
    }
    for (const card of ['sample-004:cz-en', 'sample-001:cz-en']) {
      await b.record('review', { card, r: 1 })
      tick()
    }

    expect((await sync(a)).pushed).toBe(3)
    expect((await sync(b)).pushed).toBe(2)
    expect(server.history().length).toBe(before + 2)
    expect((await sync(a)).pushed).toBeNull()

    for (const e of [a, b]) {
      expect(cardState(e.derived, 'sample-001:cz-en').reviews.map((r) => r.r)).toEqual([3, 1])
      expect(cardState(e.derived, 'sample-004:cz-en').fsrs.state).toBe(State.Learning)
      expect(e.derived.cards.size).toBe(4)
    }
    expect(server.paths().filter((p) => p.startsWith('log/'))).toEqual(
      [`log/${a.deviceId}/2026-10-13.jsonl`, `log/${b.deviceId}/2026-10-13.jsonl`].sort(),
    )
    expect(await unpushedEvents(a.db)).toEqual([])
    expect(await unpushedEvents(b.db)).toEqual([])
  })

  it('starts again after a 422 on the branch update, waiting 2 seconds first', async () => {
    const a = await device()
    await sync(a)
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    server.respondOnce('PATCH', /\/git\/refs\/heads\/main$/, () =>
      new Response(JSON.stringify({ message: 'Update is not a fast forward' }), { status: 422 }),
    )
    const result = await sync(a)
    expect(result.pushed).toBe(1)
    expect(noSleep.mock.calls).toEqual([[2000]])
    expect(server.history().filter((m) => m.startsWith('sync'))).toHaveLength(2)
  })

  it('pulls commits made by another device between its head check and its push', async () => {
    const a = await device()
    const b = await device()
    await sync(a)
    await sync(b)
    await b.record('review', { card: 'sample-002:cz-en', r: 3 })
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })

    // B's whole sync lands after A has read the head but before A moves the branch.
    let bDone: Promise<unknown> | null = null
    const realFetch = server.fetch
    server.fetch = async (url, init) => {
      if (!bDone && init.method === 'POST' && url.endsWith('/git/commits')) {
        server.fetch = realFetch
        bDone = b.sync(new GitHub('t', realFetch), noSleep)
        await bDone
      }
      return realFetch(url, init)
    }
    const result = await a.sync(new GitHub('t', (u, i) => server.fetch(u, i)), noSleep)
    expect(bDone).not.toBeNull()
    expect(result.pushed).toBe(1)
    expect(noSleep).toHaveBeenCalledTimes(1)
    expect(cardState(a.derived, 'sample-002:cz-en').reviews).toHaveLength(1)
    // A's first sync, then B's push mid-way through A's, then A's retried push. B's first sync had nothing new.
    expect(server.history().filter((m) => m.startsWith('sync'))).toHaveLength(3)
  })

  it('gives up after three retries and leaves events unpushed', async () => {
    const a = await device()
    await sync(a)
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    for (let i = 0; i < 4; i++) {
      server.respondOnce('PATCH', /refs\/heads\/main$/, () => new Response(JSON.stringify({ message: 'not a fast forward' }), { status: 422 }))
    }
    await expect(sync(a)).rejects.toMatchObject({ kind: 'conflict' })
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000, 8000])
    expect(await unpushedEvents(a.db)).toHaveLength(1)
  })

  it('marks events pushed only after the branch update succeeds', async () => {
    const a = await device()
    await sync(a)
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    server.respondOnce('PATCH', /refs\/heads\/main$/, () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(sync(a)).rejects.toMatchObject({ kind: 'offline' })
    expect(await unpushedEvents(a.db)).toHaveLength(1)
    expect((await sync(a)).pushed).toBe(1)
    expect(await unpushedEvents(a.db)).toEqual([])
  })

  it('writes one full log file per UTC date, sorted by time', async () => {
    const a = await device()
    await sync(a)
    now = new Date('2026-10-13T23:59:00.000Z')
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    now = new Date('2026-10-14T00:01:00.000Z')
    await a.record('review', { card: 'sample-002:cz-en', r: 3 })
    await sync(a)
    tick()
    await a.record('review', { card: 'sample-003:cz-en', r: 4 })
    await sync(a)
    const day1 = server.file(`log/${a.deviceId}/2026-10-13.jsonl`)!.trim().split('\n')
    const day2 = server.file(`log/${a.deviceId}/2026-10-14.jsonl`)!.trim().split('\n')
    expect(day1.map((l) => JSON.parse(l).card)).toEqual(['sample-001:cz-en'])
    expect(day2.map((l) => JSON.parse(l).card)).toEqual(['sample-002:cz-en', 'sample-003:cz-en'])
    expect(JSON.parse(day2[0])).not.toHaveProperty('pushed')
  })

  it('applies an undo of a grade that has already synced, on every device', async () => {
    const a = await device()
    const b = await device()
    await sync(a)
    const review = await a.record('review', { card: 'sample-001:cz-en', r: 1 })
    await sync(a)
    await a.record('undo', { target: review.id })
    await sync(a)
    await sync(b)
    for (const e of [a, b]) expect(cardState(e.derived, 'sample-001:cz-en').introduced).toBeNull()
  })

  it('updates a card when its word is edited, keeps its history, and clears its flag', async () => {
    const a = await device()
    await sync(a)
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    await a.record('flag', { word: 'sample-001', hash: a.set.words.get('sample-001')!.hash })
    expect(isFlagged(a.world(), 'sample-001')).toBe(true)
    await sync(a)
    expect(remoteSummary().lists.flagged).toEqual(['sample-001'])

    server.commitFiles({ 'chapters/sample.json': editSample((d) => (d.words[0].en = 'dog, hound')) })
    await sync(a)
    expect(a.set.words.get('sample-001')!.en).toBe('dog, hound')
    expect(cardState(a.derived, 'sample-001:cz-en').reviews).toHaveLength(1)
    expect(isFlagged(a.world(), 'sample-001')).toBe(false)
    expect(remoteSummary().lists.flagged).toEqual([])
  })

  it('hides the cards of a word removed from the files and lists it as removed', async () => {
    const a = await device()
    await sync(a)
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    server.commitFiles({ 'chapters/sample.json': editSample((d) => d.words.shift()) })
    await sync(a)
    expect(isHidden(a.world(), 'sample-001:cz-en')).toBe(true)
    const summary = remoteSummary()
    expect(summary.lists.removed).toEqual(['sample-001'])
    expect(summary.cards.find((c) => c[0] === 'sample-001:cz-en')?.slice(1, 4)).toEqual(['sample', 'pes', 'dog'])
  })

  it('names removed words for a device that never saw them, so both devices write the same summary', async () => {
    const a = await device()
    await sync(a)
    await a.record('review', { card: 'sample-001:cz-en', r: 3 })
    server.commitFiles({ 'chapters/sample.json': editSample((d) => d.words.shift()) })
    await sync(a)
    const commits = server.history().length

    const fresh = await device() // e.g. after its browser data was cleared
    expect((await sync(fresh)).pushed).toBeNull()
    expect(fresh.lastSeen.get('sample-001')?.cz).toBe('pes')
    expect((await sync(a)).pushed).toBeNull()
    expect(server.history()).toHaveLength(commits)
  })

  it('drops a chapter whose file is deleted', async () => {
    const a = await device()
    await sync(a)
    server.commitFiles({ 'chapters/sample.json': null })
    await sync(a)
    expect(a.set.chapters).toEqual([])
  })
})

describe('GitHub errors', () => {
  it('explains Setup failures', async () => {
    expect(await checkAccess('good-token', server.fetch)).toEqual({ ok: true })
    expect(await checkAccess('bad-token', server.fetch)).toMatchObject({ ok: false, message: expect.stringContaining("didn't accept") })
    server.repoVisible = false
    expect(await checkAccess('good-token', server.fetch)).toMatchObject({ ok: false, message: expect.stringContaining("can't see") })
    expect(await checkAccess('good-token', () => Promise.reject(new TypeError('offline')))).toMatchObject({
      ok: false,
      message: expect.stringContaining('offline'),
    })
  })

  it('recognises rate limits only from retry-after or an exhausted limit', async () => {
    const reply = (status: number, headers: Record<string, string>) => () =>
      new Response(JSON.stringify({ message: 'x' }), { status, headers })
    const g = new GitHub('t', server.fetch, () => 1_000_000)

    server.respondOnce('GET', /ref\/heads/, reply(403, { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '999' }))
    await expect(g.getHead()).rejects.toMatchObject({ kind: 'token' })

    server.respondOnce('GET', /ref\/heads/, reply(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }))
    await expect(g.getHead()).rejects.toMatchObject({ kind: 'rate-limited', retryAt: 2_000_000 })

    server.respondOnce('GET', /ref\/heads/, reply(429, { 'retry-after': '30' }))
    await expect(g.getHead()).rejects.toMatchObject({ kind: 'rate-limited', retryAt: 1_030_000 })
  })

  it('reports an empty data repo', async () => {
    const empty = new FakeGitHub()
    const a = await device()
    await expect(a.sync(new GitHub('t', empty.fetch), noSleep)).rejects.toMatchObject({ kind: 'empty-repo' })
    expect(new GitHubError('empty-repo', 'x')).toBeInstanceOf(Error)
  })

  it('sends the token only in the Authorization header, with no-store on every GET', async () => {
    const seen: RequestInit[] = []
    const g = new GitHub('secret-token', (url, init) => {
      seen.push(init)
      expect(url.startsWith('https://api.github.com/')).toBe(true)
      expect(url).not.toContain('secret-token')
      return server.fetch(url, init)
    })
    await g.getHead()
    await g.createBlob('x')
    expect(new Headers(seen[0].headers).get('authorization')).toBe('Bearer secret-token')
    expect(new Headers(seen[0].headers).get('x-github-api-version')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(seen[0].cache).toBe('no-store')
    expect(seen[1].cache).toBeUndefined()
  })
})

describe('SyncQueue', () => {
  it('runs one sync at a time and queues a single follow-up', async () => {
    let runs = 0
    let release!: () => void
    const queue = new SyncQueue(async () => {
      runs++
      if (runs === 1) await new Promise<void>((r) => (release = r))
    })
    const first = queue.trigger()
    void queue.trigger()
    void queue.trigger()
    expect(queue.busy).toBe(true)
    release()
    await first
    expect(runs).toBe(2)
    expect(queue.busy).toBe(false)
  })
})
