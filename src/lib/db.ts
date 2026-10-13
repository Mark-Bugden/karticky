// The browser database (IndexedDB via Dexie). Events are the only source of truth; everything
// else here is a cache that can be rebuilt from the data repo.

import Dexie, { type EntityTable } from 'dexie'
import { compareEvents } from './events'
import type { AppEvent, LoadedWord, Word } from './types'

export interface StoredEvent extends AppEvent {
  /** 1 once the event is in the data repo. Remote events arrive with 1. */
  pushed: 0 | 1
}

/** A file from the data repo, as of the last pull or push. */
export interface CachedFile {
  path: string
  sha: string
  /** Kept for chapter files and the summary; log files are stored as events instead. */
  text?: string
}

/** The last version of a word this device saw, kept after the word leaves the chapter files. */
export interface LastSeenWord extends Partial<Word> {
  id: string
  chapterId: string | null
  hash?: string
}

interface MetaRow {
  key: string
  value: unknown
}

export class KartickyDB extends Dexie {
  events!: EntityTable<StoredEvent, 'id'>
  files!: EntityTable<CachedFile, 'path'>
  lastSeen!: EntityTable<LastSeenWord, 'id'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name = 'karticky') {
    super(name)
    this.version(1).stores({
      events: 'id, [dev+t], pushed, [t+id]',
      files: 'path',
      lastSeen: 'id',
      meta: 'key',
    })
  }
}

/** Values kept in the meta table. The token, device id and sync cache never leave the device. */
export interface Meta {
  deviceId: string
  token: string
  lastPulledCommit: string
  lastPulledTree: string
  lastSyncAt: string
  persistRequested: boolean
  derivedCache: unknown
}

export async function getMeta<K extends keyof Meta>(db: KartickyDB, key: K): Promise<Meta[K] | undefined> {
  return (await db.meta.get(key))?.value as Meta[K] | undefined
}

export async function setMeta<K extends keyof Meta>(db: KartickyDB, key: K, value: Meta[K]): Promise<void> {
  await db.meta.put({ key, value })
}

export async function deleteMeta(db: KartickyDB, key: keyof Meta): Promise<void> {
  await db.meta.delete(key)
}

function detectPlatform(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const ua = (nav?.userAgent ?? '').toLowerCase()
  if (ua.includes('android')) return 'android'
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac os')) return 'mac'
  if (ua.includes('cros')) return 'chromeos'
  if (ua.includes('linux')) return 'linux'
  return 'web'
}

/** `<platform>-<6 hex>`, generated once per browser profile. */
export async function getDeviceId(db: KartickyDB): Promise<string> {
  const existing = await getMeta(db, 'deviceId')
  if (existing) return existing
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('')
  const id = `${detectPlatform()}-${hex}`
  await setMeta(db, 'deviceId', id)
  return id
}

// ---- Events ----

export async function addLocalEvent(db: KartickyDB, event: AppEvent): Promise<void> {
  await db.events.add({ ...event, pushed: 0 })
}

/** Adds events from other devices, ignoring ids already present. Returns how many were new. */
export async function mergeRemoteEvents(db: KartickyDB, events: AppEvent[]): Promise<number> {
  if (events.length === 0) return 0
  return db.transaction('rw', db.events, async () => {
    const ids = events.map((e) => e.id)
    const known = new Set(await db.events.where('id').anyOf(ids).primaryKeys())
    const fresh = new Map<string, StoredEvent>()
    for (const e of events) if (!known.has(e.id)) fresh.set(e.id, { ...e, pushed: 1 })
    await db.events.bulkAdd([...fresh.values()])
    return fresh.size
  })
}

export async function allEvents(db: KartickyDB): Promise<StoredEvent[]> {
  return db.events.orderBy('[t+id]').toArray()
}

export async function unpushedEvents(db: KartickyDB): Promise<StoredEvent[]> {
  return db.events.where('pushed').equals(0).toArray()
}

/** This device's events on one UTC date, sorted, for writing its full log file. */
export async function deviceEventsOnUtcDate(db: KartickyDB, dev: string, date: string): Promise<StoredEvent[]> {
  const events = await db.events.where('[dev+t]').between([dev, `${date}T`], [dev, `${date}T￿`]).toArray()
  return events.sort(compareEvents)
}

export async function markPushed(db: KartickyDB, ids: string[]): Promise<void> {
  await db.events.where('id').anyOf(ids).modify({ pushed: 1 })
}

/** A cheap fingerprint of the event set, used to check the cached replay is current. */
export async function eventsFingerprint(db: KartickyDB): Promise<string> {
  const [count, last] = await Promise.all([db.events.count(), db.events.orderBy('[t+id]').last()])
  return `${count}:${last?.id ?? ''}`
}

// ---- Last-seen words ----

/** Records the current version of every loaded word. */
export async function rememberWords(db: KartickyDB, words: Iterable<LoadedWord>): Promise<void> {
  await db.lastSeen.bulkPut([...words].map((w) => ({ ...w })))
}

/** Fills in words this device has never seen, from the remote summary's card rows. */
export async function seedLastSeen(db: KartickyDB, seeds: LastSeenWord[]): Promise<number> {
  if (seeds.length === 0) return 0
  return db.transaction('rw', db.lastSeen, async () => {
    const known = new Set(await db.lastSeen.where('id').anyOf(seeds.map((s) => s.id)).primaryKeys())
    const fresh = seeds.filter((s) => !known.has(s.id))
    await db.lastSeen.bulkPut(fresh)
    return fresh.length
  })
}
