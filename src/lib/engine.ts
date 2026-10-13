// The app's data core without any UI: loads chapters and events from IndexedDB, keeps the
// replayed state current, records new events and runs syncs. The Svelte store wraps one of these.

import { loadChapterSet } from './chapters'
import {
  addLocalEvent,
  allEvents,
  eventsFingerprint,
  getDeviceId,
  getMeta,
  rememberWords,
  setMeta,
  type KartickyDB,
  type LastSeenWord,
} from './db'
import { makeEvent } from './events'
import type { GitHub } from './github'
import { isDayCleared, type World } from './queue'
import {
  applyEvent,
  CACHE_VERSION,
  canApplyIncrementally,
  emptyDerived,
  fingerprintOf,
  fromCache,
  replay,
  toCache,
  type Derived,
  type DerivedCache,
} from './replay'
import { studyDay } from './studyDay'
import { buildSummary, summaryText } from './summary'
import { syncOnce, type SyncResult } from './sync'
import type { AppEvent, ChapterSet, EventType } from './types'

export const emptyChapterSet = (): ChapterSet => ({ chapters: [], words: new Map(), errors: [] })

export class Engine {
  deviceId = ''
  set: ChapterSet = emptyChapterSet()
  derived: Derived = emptyDerived()
  lastSeen = new Map<string, LastSeenWord>()
  /** The data-repo commit the loaded chapters came from. */
  private knownCommit: string | undefined
  private cacheTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    public db: KartickyDB,
    public clock: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    this.deviceId = await getDeviceId(this.db)
    this.knownCommit = await getMeta(this.db, 'lastPulledCommit')
    await this.reloadChapters()
    const fingerprint = await eventsFingerprint(this.db)
    const cache = (await getMeta(this.db, 'derivedCache')) as DerivedCache | undefined
    if (cache?.version === CACHE_VERSION && cache.fingerprint === fingerprint) this.derived = fromCache(cache)
    else await this.replayAll()
  }

  /** Re-reads the chapter files from the sync cache and records the last-seen copy of every word. */
  async reloadChapters(): Promise<void> {
    const files = await this.db.files.where('path').startsWith('chapters/').toArray()
    this.set = await loadChapterSet(files.map((f) => ({ path: f.path, text: f.text ?? '' })))
    await rememberWords(this.db, this.set.words.values())
    await this.loadLastSeen()
  }

  /**
   * Catches up with changes another window of the app made to the same database.
   * Returns whether anything was reloaded.
   */
  async refreshFromDb(): Promise<boolean> {
    let changed = false
    const commit = await getMeta(this.db, 'lastPulledCommit')
    if (commit !== this.knownCommit) {
      this.knownCommit = commit
      await this.reloadChapters()
      changed = true
    }
    if ((await eventsFingerprint(this.db)) !== fingerprintOf(this.derived)) {
      await this.replayAll()
      changed = true
    }
    return changed
  }

  async loadLastSeen(): Promise<void> {
    this.lastSeen = new Map((await this.db.lastSeen.toArray()).map((w) => [w.id, w]))
  }

  async replayAll(): Promise<void> {
    this.derived = replay(await allEvents(this.db))
    this.saveCacheSoon()
  }

  world(now: Date = this.clock()): World {
    return { now, set: this.set, derived: this.derived }
  }

  /** Writes an event to IndexedDB, then updates the replayed state. */
  async record(type: EventType, fields: Omit<AppEvent, 'id' | 't' | 'dev' | 'type'>): Promise<AppEvent> {
    const event = makeEvent(this.deviceId, type, fields, this.clock())
    await addLocalEvent(this.db, event)
    if (canApplyIncrementally(this.derived, event)) {
      applyEvent(this.derived, event)
      this.derived = { ...this.derived } // a new reference so the UI notices
      this.saveCacheSoon()
    } else {
      await this.replayAll()
    }
    return event
  }

  /** Records today's dayCleared event the first time nothing is left to review today. */
  async checkDayCleared(): Promise<boolean> {
    const now = this.clock()
    const today = studyDay(now)
    if (this.set.chapters.length === 0 || this.derived.cleared.has(today) || !isDayCleared(this.world(now))) return false
    await this.record('dayCleared', { day: today })
    return true
  }

  summaryText(now: Date = this.clock()): string {
    return summaryText(buildSummary(this.world(now), this.deviceId, this.lastSeen))
  }

  async sync(gh: GitHub, sleep?: (ms: number) => Promise<void>): Promise<SyncResult> {
    await this.refreshFromDb()
    const result = await syncOnce({
      db: this.db,
      gh,
      deviceId: this.deviceId,
      sleep,
      buildSummary: () => this.summaryText(),
      onRemoteChange: async (changes) => {
        if (changes.chapters) await this.reloadChapters()
        else if (changes.summary) await this.loadLastSeen()
        if (changes.events) await this.replayAll()
      },
    })
    this.knownCommit = await getMeta(this.db, 'lastPulledCommit')
    return result
  }

  saveCacheSoon(): void {
    if (this.cacheTimer) clearTimeout(this.cacheTimer)
    this.cacheTimer = setTimeout(() => void this.flushCache(), 2000)
  }

  async flushCache(): Promise<void> {
    if (this.cacheTimer) clearTimeout(this.cacheTimer)
    this.cacheTimer = null
    await setMeta(this.db, 'derivedCache', toCache(this.derived))
  }
}
