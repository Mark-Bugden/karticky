// Sync with the data repo: pull, merge, rebuild, then push everything as one commit.
// Each device writes only its own log files, so the only shared file is the derived summary.

import { SYNC_RETRY_DELAYS_MS } from './config'
import {
  deviceEventsOnUtcDate,
  getMeta,
  markPushed,
  mergeRemoteEvents,
  seedLastSeen,
  setMeta,
  unpushedEvents,
  type CachedFile,
  type KartickyDB,
} from './db'
import { parseLogFile, toLogLine } from './events'
import { GitHubError, type GitHub } from './github'
import { utcDate } from './studyDay'
import { sameSummary, seedsFromSummary } from './summary'
import type { DeckProfile } from './types'

export const SUMMARY_PATH = 'summary/summary.json'
const isChapterPath = (p: string) => p.startsWith('chapters/') && p.endsWith('.json')
const isLogPath = (p: string) => p.startsWith('log/') && p.endsWith('.jsonl')

export interface RemoteChanges {
  events: boolean
  chapters: boolean
  summary: boolean
}

export interface SyncDeps {
  db: KartickyDB
  /** For the deck's repo. */
  gh: GitHub
  deck: DeckProfile
  deviceId: string
  /** Called after remote changes are stored, so the app can reload chapters and replay events. */
  onRemoteChange: (changes: RemoteChanges) => Promise<void>
  /** The summary as it should be now, built from the app's current state. */
  buildSummary: () => string
  sleep?: (ms: number) => Promise<void>
}

export interface SyncResult {
  changes: RemoteChanges
  /** Number of events pushed, or null if nothing was pushed. */
  pushed: number | null
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Runs one sync, retrying from the start if the branch moved during the push. */
export async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const sleep = deps.sleep ?? defaultSleep
  const changes: RemoteChanges = { events: false, chapters: false, summary: false }
  for (let attempt = 0; ; attempt++) {
    try {
      const pushed = await attempt_(deps, changes)
      return { changes, pushed }
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'conflict' && attempt < SYNC_RETRY_DELAYS_MS.length) {
        await sleep(SYNC_RETRY_DELAYS_MS[attempt])
        continue
      }
      throw e
    }
  }
}

async function attempt_(deps: SyncDeps, changes: RemoteChanges): Promise<number | null> {
  const { db, gh } = deps
  const head = await gh.getHead()
  const lastPulled = await getMeta(db, 'lastPulledCommit')
  let headTree = head === lastPulled ? await getMeta(db, 'lastPulledTree') : undefined

  if (head !== lastPulled || !headTree) {
    headTree = await gh.getCommitTree(head)
    const pulled = await pull(deps, headTree)
    changes.events ||= pulled.events
    changes.chapters ||= pulled.chapters
    changes.summary ||= pulled.summary
    if (pulled.events || pulled.chapters || pulled.summary) await deps.onRemoteChange(pulled)
    await setMeta(db, 'lastPulledCommit', head)
    await setMeta(db, 'lastPulledTree', headTree)
  }

  // Push if there are unpushed events, or if the summary has changed in substance.
  const unpushed = await unpushedEvents(db)
  const summary = deps.buildSummary()
  const remoteSummary = (await db.files.get(SUMMARY_PATH))?.text
  if (unpushed.length === 0 && sameSummary(summary, remoteSummary)) return null

  const files: CachedFile[] = []
  for (const date of [...new Set(unpushed.map((e) => utcDate(e.t)))].sort()) {
    const events = await deviceEventsOnUtcDate(db, deps.deviceId, date)
    const text = events.map((e) => toLogLine(e) + '\n').join('')
    files.push({ path: `log/${deps.deviceId}/${date}.jsonl`, sha: '', text })
  }
  files.push({ path: SUMMARY_PATH, sha: '', text: summary })

  for (const f of files) f.sha = await gh.createBlob(f.text!)
  const tree = await gh.createTree(headTree, files)
  const commit = await gh.createCommit(`sync ${deps.deviceId}: ${unpushed.length} events`, tree, head)
  await gh.updateHead(commit) // 422 here means the branch moved: syncOnce starts again

  // Only now is the push real.
  await markPushed(
    db,
    unpushed.map((e) => e.id),
  )
  await db.files.bulkPut(files.map((f) => (f.path === SUMMARY_PATH ? f : { path: f.path, sha: f.sha })))
  await setMeta(db, 'lastPulledCommit', commit)
  await setMeta(db, 'lastPulledTree', tree)
  return unpushed.length
}

/** Downloads every chapter, log and summary file whose blob changed, and merges it. */
async function pull(deps: SyncDeps, treeSha: string): Promise<RemoteChanges> {
  const { db, gh } = deps
  const changes: RemoteChanges = { events: false, chapters: false, summary: false }
  const entries = (await gh.getTree(treeSha)).filter((e) => e.type === 'blob')
  const cached = new Map((await db.files.toArray()).map((f) => [f.path, f]))
  const present = new Set<string>()

  for (const entry of entries) {
    const { path, sha } = entry
    const relevant = isChapterPath(path) || isLogPath(path) || path === SUMMARY_PATH
    if (!relevant) continue
    present.add(path)
    if (cached.get(path)?.sha === sha) continue
    const text = await gh.getBlob(sha)
    if (isLogPath(path)) {
      if ((await mergeRemoteEvents(db, parseLogFile(text, deps.deck))) > 0) changes.events = true
      await db.files.put({ path, sha })
    } else {
      await db.files.put({ path, sha, text })
      if (path === SUMMARY_PATH) {
        changes.summary = true
        await seedLastSeen(db, seedsFromSummary(text, deps.deck))
      } else {
        changes.chapters = true
      }
    }
  }

  // A chapter file that vanished takes its words with it (they become orphaned).
  for (const path of cached.keys()) {
    if (present.has(path)) continue
    await db.files.delete(path)
    if (isChapterPath(path)) changes.chapters = true
  }
  return changes
}

/** Runs one sync at a time; a trigger during a sync queues a single follow-up. */
export class SyncQueue {
  private running: Promise<void> | null = null
  private again = false

  constructor(private run: () => Promise<void>) {}

  trigger(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.run()
        } while (this.again)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  get busy(): boolean {
    return this.running !== null
  }
}
