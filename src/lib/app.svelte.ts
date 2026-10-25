// App state for the screens: wraps the Engine, runs sync triggers and timers, and holds the
// current study session. Screens read these fields and call these methods.

import { MISC_ID } from './chapters'
import { DECKS, GITHUB_OWNER, SYNC_INTERVAL_MS } from './config'
import { getMeta, KartickyDB, setMeta, unpushedCount, type LastSeenWord } from './db'
import { emptyChapterSet, Engine } from './engine'
import { parseCardId } from './events'
import { minutesUntil, timeAgo } from './format'
import { checkAccess, GitHub, GitHubError, type ProblemKind } from './github'
import {
  buildPlan,
  chapterProgress,
  dayStatus,
  isFlagged,
  isHidden,
  pickNext,
  practiceAfterGrade,
  startPractice,
  streak,
  suggestedChapter,
  type Plan,
  type PracticeState,
  type World,
} from './queue'
import { emptyDerived, includeKey, type Derived } from './replay'
import { dayEnd, formatLocalDate, studyDay } from './studyDay'
import type { ChapterSet, DeckProfile, Direction, Grade, Word } from './types'
import { SyncQueue } from './sync'

export type Screen = 'loading' | 'setup' | 'home' | 'study' | 'settings' | 'chapters' | 'practice'

/** The word content shown on a card, frozen when the card appears. */
export type WordView = Partial<Word> & { id: string; term?: string; en?: string }

export interface StudyState {
  plan: Plan
  view: 'card' | 'wait' | 'done'
  card: string | null
  dir: Direction | null
  word: WordView | null
  revealed: boolean
  waitUntil: Date | null
  /** Set when practising chosen chapters instead of following today's plan. */
  practice: PracticeState | null
}

interface SyncStatus {
  running: boolean
  lastSyncAt: Date | null
  problem: { kind: ProblemKind; message: string } | null
  unpushed: number
  online: boolean
  retryAt: number | null
}

function describeProblem(e: unknown, deck: DeckProfile): { kind: ProblemKind; message: string } {
  const repo = `${GITHUB_OWNER}/${deck.repo}`
  if (!(e instanceof GitHubError)) return { kind: 'http', message: 'Sync failed. It will try again later.' }
  const messages: Record<ProblemKind, string> = {
    offline: 'Offline',
    token: 'Sync paused: token not accepted',
    'not-found': `Sync paused: the token cannot see ${repo}`,
    'empty-repo': `Sync paused: ${repo} is empty. Add a README to it on github.com.`,
    'rate-limited': 'GitHub is limiting requests; sync will try again later',
    conflict: 'Sync could not finish; it will try again later',
    http: 'Sync failed; it will try again later',
  }
  return { kind: e.kind, message: messages[e.kind] }
}

class AppState {
  /** The deck this device studies. */
  readonly deck: DeckProfile = DECKS.czech
  screen = $state<Screen>('loading')
  /** Setup was opened to replace the token, so it can be cancelled back to this screen. */
  setupReturn = $state<Screen | null>(null)
  fatal = $state<string | null>(null)
  now = $state(new Date())
  hasToken = $state(false)

  set = $state.raw<ChapterSet>(emptyChapterSet())
  derived = $state.raw<Derived>(emptyDerived())
  lastSeen = $state.raw<Map<string, LastSeenWord>>(new Map())

  sync = $state<SyncStatus>({ running: false, lastSyncAt: null, problem: null, unpushed: 0, online: true, retryAt: null })
  study = $state.raw<StudyState | null>(null)
  /** The last grade, for Undo, with the practice session as it was before that grade. */
  lastGrade = $state.raw<{ eventId: string; card: string; practice: PracticeState | null } | null>(null)
  /** newPerDay while the stepper is being tapped, before it is recorded. */
  pendingNewPerDay = $state<number | null>(null)

  world: World = $derived({ now: this.now, deck: this.deck, set: this.set, derived: this.derived })
  status = $derived(dayStatus(this.world))
  progress = $derived(chapterProgress(this.world))
  /** Ticked chapters other than misc, in study order. */
  ticked = $derived(this.progress.filter((p) => p.included && p.chapter.id !== MISC_ID))
  suggestion = $derived(suggestedChapter(this.progress))
  streakDays = $derived(streak(this.derived.cleared, studyDay(this.now)).current)
  newPerDay = $derived(this.pendingNewPerDay ?? this.derived.newPerDay)
  notSynced = $derived(this.sync.unpushed > 0 && (!this.sync.online || this.sync.problem !== null))
  /** Flagged words, hidden until Claude fixes them or the user unflags them. */
  flagged = $derived(
    [...this.derived.words.keys()]
      .filter((wordId) => isFlagged(this.world, wordId))
      .map((wordId) => ({ wordId, term: this.set.words.get(wordId)?.term ?? wordId })),
  )
  suspended = $derived(
    [...this.derived.cards]
      .filter(([, c]) => c.suspended)
      .map(([card]) => {
        const { wordId, dir } = parseCardId(card)
        return { card, dir, term: this.set.words.get(wordId)?.term ?? this.lastSeen.get(wordId)?.term ?? wordId }
      }),
  )

  private engine!: Engine
  private db!: KartickyDB
  private token: string | null = null
  private syncQueue = new SyncQueue(() => this.runSync())
  private busy = false
  private timers: { tick?: ReturnType<typeof setInterval>; sync?: ReturnType<typeof setInterval>; day?: ReturnType<typeof setTimeout>; wait?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout>; setting?: ReturnType<typeof setTimeout> } = {}

  async init(): Promise<void> {
    try {
      this.db = new KartickyDB(this.deck.db)
      this.engine = new Engine(this.db, this.deck)
      await this.engine.load()
      this.refresh()
      this.token = (await getMeta(this.db, 'token')) ?? null
      this.hasToken = this.token !== null
      const last = await getMeta(this.db, 'lastSyncAt')
      this.sync.lastSyncAt = last ? new Date(last) : null
      this.sync.online = navigator.onLine
      await this.requestPersistentStorage()
      this.screen = this.token ? 'home' : 'setup'
      this.listen()
      this.scheduleDayRollover()
      await this.afterChange()
      this.triggerSync()
    } catch (e) {
      console.error(e)
      this.fatal = 'Kartičky could not open its storage on this device. Try closing and reopening the app.'
    }
  }

  // ---- Plumbing ----

  private refresh(): void {
    this.set = this.engine.set
    this.derived = this.engine.derived
    this.lastSeen = this.engine.lastSeen
  }

  private tick(): void {
    const before = studyDay(this.now)
    this.now = new Date()
    if (studyDay(this.now) !== before) this.onNewDay()
  }

  private onNewDay(): void {
    this.scheduleDayRollover()
    this.rebuildStudyPlan()
    void this.afterChange()
  }

  /** Rebuilds the queue at 4 am, even mid-session. */
  private scheduleDayRollover(): void {
    clearTimeout(this.timers.day)
    const ms = dayEnd(studyDay(new Date())).getTime() - Date.now()
    this.timers.day = setTimeout(() => this.tick(), Math.min(ms + 1000, 2 ** 31 - 1))
  }

  private async requestPersistentStorage(): Promise<void> {
    if (await getMeta(this.db, 'persistRequested')) return
    try {
      await navigator.storage?.persist?.()
    } catch {
      // Not supported: nothing to do.
    }
    await setMeta(this.db, 'persistRequested', true)
  }

  private listen(): void {
    const visible = () => document.visibilityState === 'visible'
    this.timers.tick = setInterval(() => visible() && this.tick(), 30_000)
    this.timers.sync = setInterval(() => visible() && navigator.onLine && this.triggerSync(), SYNC_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (visible()) {
        void this.catchUp()
        this.tick()
        this.scheduleDayRollover()
        if (this.study?.view === 'wait') this.advance()
      } else {
        void this.flushSetting()
        void this.engine.flushCache()
      }
      this.triggerSync() // on opening, and best effort on leaving
    })
    window.addEventListener('pagehide', () => {
      void this.engine.flushCache()
      this.triggerSync()
    })
    window.addEventListener('online', () => {
      this.sync.online = true
      this.triggerSync()
    })
    window.addEventListener('offline', () => (this.sync.online = false))
    window.addEventListener('popstate', () => this.showHome())
  }

  /** Picks up changes another window of the app made while this one was in the background. */
  private async catchUp(): Promise<void> {
    if (await this.engine.refreshFromDb()) {
      this.refresh()
      this.rebuildStudyPlan()
    }
  }

  /** Records today's dayCleared event if earned, and refreshes the unpushed count. */
  private async afterChange(): Promise<void> {
    if (await this.engine.checkDayCleared()) this.refresh()
    this.sync.unpushed = await unpushedCount(this.db)
  }

  // ---- Navigation ----

  go(screen: Screen): void {
    if (screen === this.screen) return
    if (this.screen === 'study') this.leaveStudy()
    if (this.screen === 'settings') void this.flushSetting()
    // One history entry above Home lets the Android back gesture return to Home.
    if (this.screen === 'home' && screen !== 'home' && screen !== 'setup') history.pushState({ karticky: 1 }, '')
    if (screen === 'home' && history.state?.karticky) {
      history.back() // popstate then shows Home
      return
    }
    this.screen = screen
  }

  private showHome(): void {
    if (this.screen === 'study') this.leaveStudy()
    if (this.screen === 'settings') void this.flushSetting()
    if (this.screen !== 'setup' || this.hasToken) this.screen = 'home'
  }

  // ---- Sync ----

  triggerSync(): void {
    if (!this.token) return
    void this.syncQueue.trigger()
  }

  private async runSync(): Promise<void> {
    if (!this.token) return
    if (this.sync.retryAt && Date.now() < this.sync.retryAt) return
    this.sync.running = true
    const before = { set: this.engine.set, derived: this.engine.derived }
    try {
      const gh = new GitHub(this.token, this.deck.repo)
      // One sync at a time across every window of the app on this device.
      const run = () => this.engine.sync(gh)
      await (navigator.locks ? navigator.locks.request(this.deck.syncLock, run) : run())
      this.sync.problem = null
      this.sync.retryAt = null
      this.sync.online = true
      this.sync.lastSyncAt = new Date()
      await setMeta(this.db, 'lastSyncAt', this.sync.lastSyncAt.toISOString())
    } catch (e) {
      this.sync.problem = describeProblem(e, this.deck)
      if (e instanceof GitHubError && e.kind === 'offline') this.sync.online = false
      if (e instanceof GitHubError && e.kind === 'rate-limited' && e.retryAt) {
        this.sync.retryAt = e.retryAt
        clearTimeout(this.timers.retry)
        this.timers.retry = setTimeout(() => this.triggerSync(), e.retryAt - Date.now() + 1000)
      }
    } finally {
      this.sync.running = false
      // Remote changes may have been merged even if the push failed.
      if (this.engine.set !== before.set || this.engine.derived !== before.derived) {
        this.refresh()
        this.rebuildStudyPlan()
      }
      await this.afterChange()
    }
  }

  /** Setup: checks the token can see the data repo, stores it, then runs the first sync. */
  async saveToken(token: string): Promise<string | null> {
    const result = await checkAccess(token, this.deck.repo)
    if (!result.ok) return result.message
    await setMeta(this.db, 'token', token)
    this.token = token
    this.hasToken = true
    this.sync.problem = null
    this.sync.retryAt = null
    this.setupReturn = null
    this.go('home')
    this.triggerSync()
    return null
  }

  replaceToken(): void {
    this.setupReturn = this.screen
    this.screen = 'setup'
  }

  cancelSetup(): void {
    this.screen = this.setupReturn ?? 'home'
    this.setupReturn = null
  }

  /** The sync line on Home and in Settings. */
  syncLine = $derived.by((): { text: string; tone: 'ok' | 'warn'; setup?: boolean } => {
    if (!this.hasToken) return { text: 'Set up sync', tone: 'warn', setup: true }
    const p = this.sync.problem
    if (p && (p.kind === 'token' || p.kind === 'not-found')) return { text: p.message, tone: 'warn', setup: true }
    if (p && p.kind !== 'offline') return { text: p.message, tone: 'warn' }
    if (this.sync.running && !this.sync.lastSyncAt) return { text: 'Syncing…', tone: 'ok' }
    if (this.sync.lastSyncAt) return { text: `Synced ${timeAgo(this.sync.lastSyncAt, this.now)}`, tone: 'ok' }
    return { text: p ? 'Offline: not synced yet' : 'Not synced yet', tone: 'warn' }
  })

  // ---- Study ----

  startStudy(): void {
    this.tick()
    this.lastGrade = null
    this.study = { plan: buildPlan(this.world), view: 'card', card: null, dir: null, word: null, revealed: false, waitUntil: null, practice: null }
    this.go('study')
    this.advance()
  }

  /** Practice: the started cards of the chosen chapters in random order, graded as normal reviews. */
  startPractice(chapterIds: string[]): void {
    this.tick()
    this.lastGrade = null
    const practice = startPractice(this.world, chapterIds)
    this.study = { plan: { slots: [], pos: 0 }, view: 'card', card: null, dir: null, word: null, revealed: false, waitUntil: null, practice }
    this.go('study')
    this.advance()
  }

  private wordView(card: string): WordView {
    const { wordId } = parseCardId(card)
    return { ...(this.set.words.get(wordId) ?? this.lastSeen.get(wordId) ?? {}), id: wordId }
  }

  private show(card: string, revealed: boolean): void {
    if (!this.study) return
    clearTimeout(this.timers.wait)
    this.study = { ...this.study, view: 'card', card, dir: parseCardId(card).dir, word: this.wordView(card), revealed, waitUntil: null }
  }

  private advance(): void {
    const s = this.study
    if (!s) return
    this.tick()
    clearTimeout(this.timers.wait)
    if (s.practice) {
      const card = s.practice.queue[0]
      if (card) this.show(card, false)
      else this.study = { ...s, view: 'done', card: null, dir: null, word: null, revealed: false, waitUntil: null }
      return
    }
    const next = pickNext(this.world, s.plan)
    if (next.kind === 'card') {
      this.show(next.card, false)
    } else if (next.kind === 'wait') {
      this.study = { ...s, view: 'wait', card: null, dir: null, word: null, revealed: false, waitUntil: next.until }
      this.timers.wait = setTimeout(() => this.advance(), next.until.getTime() - Date.now() + 500)
    } else {
      this.study = { ...s, view: 'done', card: null, dir: null, word: null, revealed: false, waitUntil: null }
    }
  }

  /** After a sync or at 4 am: a fresh queue for today, keeping the current card on screen. */
  private rebuildStudyPlan(): void {
    const s = this.study
    if (!s || s.practice) return
    this.study = { ...s, plan: buildPlan(this.world) }
    if (s.view !== 'card') this.advance()
  }

  private leaveStudy(): void {
    clearTimeout(this.timers.wait)
    this.study = null
    this.lastGrade = null
  }

  reveal(): void {
    const s = this.study
    if (s?.view === 'card' && !s.revealed) this.study = { ...s, revealed: true }
  }

  /** Turns the card over: reveals it, or turns a revealed card back to its question side. */
  flip(): void {
    const s = this.study
    if (s?.view === 'card') this.study = { ...s, revealed: !s.revealed }
  }

  /** Writes the grade to IndexedDB before the next card renders. */
  async grade(r: Grade): Promise<void> {
    const s = this.study
    if (!s || s.view !== 'card' || !s.revealed || !s.card || this.busy) return
    this.busy = true
    try {
      const card = s.card
      const event = await this.engine.record('review', { card, r })
      this.lastGrade = { eventId: event.id, card, practice: s.practice }
      if (s.practice) this.study = { ...s, practice: practiceAfterGrade(s.practice, card, r) }
      this.refresh()
      await this.afterChange()
      this.advance()
    } finally {
      this.busy = false
    }
  }

  /** Reverts the most recent grade and shows that card again, revealed. */
  async undo(): Promise<void> {
    const g = this.lastGrade
    if (!g || !this.study || this.busy) return
    this.busy = true
    try {
      await this.engine.record('undo', { target: g.eventId })
      this.lastGrade = null
      if (g.practice && this.study) this.study = { ...this.study, practice: g.practice }
      this.refresh()
      this.show(g.card, true)
      await this.afterChange()
    } finally {
      this.busy = false
    }
  }

  async suspendCurrent(): Promise<void> {
    const card = this.study?.card
    if (!card) return
    await this.engine.record('suspend', { card })
    this.refresh()
    this.dropHiddenFromPractice()
    await this.afterChange()
    this.advance()
  }

  async deleteCurrentWord(): Promise<void> {
    const card = this.study?.card
    if (!card) return
    await this.engine.record('delete', { word: parseCardId(card).wordId })
    this.refresh()
    this.dropHiddenFromPractice()
    await this.afterChange()
    this.advance()
  }

  /** After a suspend, delete or flag in practice, the hidden cards leave the session. */
  private dropHiddenFromPractice(): void {
    const s = this.study
    if (!s?.practice) return
    this.study = { ...s, practice: { ...s.practice, queue: s.practice.queue.filter((id) => !isHidden(this.world, id)) } }
  }

  /** Flags the current word for Claude to fix; it is hidden until then, so the next card shows. */
  async flagCurrent(): Promise<void> {
    const card = this.study?.card
    if (!card) return
    const wordId = parseCardId(card).wordId
    const hash = this.set.words.get(wordId)?.hash
    if (!hash) return
    await this.engine.record('flag', { word: wordId, hash })
    this.refresh()
    this.dropHiddenFromPractice()
    await this.afterChange()
    this.advance()
  }

  /** Brings a flagged word back as it is. */
  async unflag(wordId: string): Promise<void> {
    await this.engine.record('unflag', { word: wordId })
    this.refresh()
    await this.afterChange()
  }

  async learnMore(): Promise<void> {
    await this.engine.record('learnMore', { day: studyDay(new Date()) })
    this.refresh()
    await this.afterChange()
    if (this.study && !this.study.practice) {
      this.study = { ...this.study, plan: buildPlan(this.world) }
      this.advance()
    }
  }

  /** Minutes until the waiting card, for "Next card in N min". */
  waitMinutes = $derived(this.study?.waitUntil ? minutesUntil(this.study.waitUntil, this.now) : 0)

  // ---- Settings ----

  stepNewPerDay(delta: number): void {
    this.pendingNewPerDay = Math.min(50, Math.max(1, this.newPerDay + delta))
    clearTimeout(this.timers.setting)
    this.timers.setting = setTimeout(() => void this.flushSetting(), 1500)
  }

  private async flushSetting(): Promise<void> {
    clearTimeout(this.timers.setting)
    const value = this.pendingNewPerDay
    if (value === null) return
    if (value !== this.derived.newPerDay) await this.engine.record('setting', { key: 'newPerDay', value })
    this.pendingNewPerDay = null
    this.refresh()
    await this.afterChange()
  }

  /** Ticks or unticks a chapter on every device. */
  async setIncluded(chapterId: string, on: boolean): Promise<void> {
    if (on === this.derived.included.has(chapterId)) return
    await this.engine.record('setting', { key: includeKey(chapterId), value: on ? 1 : 0 })
    this.refresh()
    await this.afterChange()
  }

  async restore(card: string): Promise<void> {
    await this.engine.record('unsuspend', { card })
    this.refresh()
    await this.afterChange()
  }

  downloadSummary(): void {
    const text = this.engine.summaryText(new Date())
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `karticky-summary-${formatLocalDate(new Date())}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

export const app = new AppState()
