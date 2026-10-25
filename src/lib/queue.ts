// What to study today. Pure functions over the chapter set, the replayed state and a clock,
// following the queue rules in the design document (numbered comments refer to them).

import {
  LEARN_AHEAD_MINUTES,
  LEARN_MORE_COUNT,
  LEARNED_STABILITY_DAYS,
  MOVE_ON_SHARE,
  PRACTICE_AGAIN_GAP,
  PRACTICE_SIBLING_GAP,
} from './config'
import { MISC_ID } from './chapters'
import { cardId, DIRECTIONS, parseCardId, siblingId } from './events'
import { newCardState, State, type CardState, type Derived } from './replay'
import { addDays, dayEnd, studyDay } from './studyDay'
import type { Chapter, ChapterSet, DeckProfile, Grade } from './types'

export interface World {
  now: Date
  deck: DeckProfile
  set: ChapterSet
  derived: Derived
}

const NEW_CARD = newCardState()

export function cardState(d: Derived, id: string): CardState {
  return d.cards.get(id) ?? NEW_CARD
}

const reviewedOn = (c: CardState, day: string) => c.reviews.at(-1)?.day === day
const isLearning = (c: CardState) => c.fsrs.state === State.Learning || c.fsrs.state === State.Relearning

/**
 * Rule 1: suspended cards, cards of deleted words, cards of words in no current chapter file, and
 * cards of flagged words, until the word is fixed (which lapses the flag) or unflagged.
 */
export function isHidden(w: World, id: string): boolean {
  const { wordId } = parseCardId(id)
  if (!w.set.words.has(wordId)) return true
  if (w.derived.words.get(wordId)?.deleted || isFlagged(w, wordId)) return true
  return w.derived.cards.get(id)?.suspended ?? false
}

/** The misc chapter is always studied; any other chapter only while it is ticked. */
export function isIncluded(w: World, chapterId: string): boolean {
  return chapterId === MISC_ID || w.derived.included.has(chapterId)
}

/** Rule 1, paused: cards of an unticked chapter are not shown at all, but keep their history. */
export function isPaused(w: World, id: string): boolean {
  const word = w.set.words.get(parseCardId(id).wordId)
  return word !== undefined && !isIncluded(w, word.chapterId)
}

/** Hidden or paused: left out of today's study entirely. */
const isOut = (w: World, id: string) => isHidden(w, id) || isPaused(w, id)

/** Learned: in review, with FSRS confident in it for at least LEARNED_STABILITY_DAYS. */
export const isLearned = (c: CardState) => c.fsrs.state === State.Review && c.fsrs.stability >= LEARNED_STABILITY_DAYS

/** Rule 2: once either card of a word has been reviewed today, the other waits until tomorrow. */
export function isBuried(w: World, id: string, today = studyDay(w.now)): boolean {
  return !reviewedOn(cardState(w.derived, id), today) && reviewedOn(cardState(w.derived, siblingId(id)), today)
}

/**
 * A word is flagged if its latest flag still matches its current content. A word in no current
 * chapter file has no current content, so its flag has lapsed (this also keeps both devices' summaries identical).
 */
export function isFlagged(w: World, wordId: string): boolean {
  const flag = w.derived.words.get(wordId)?.flagHash
  return !!flag && flag === w.set.words.get(wordId)?.hash
}

function isDueNow(c: CardState, now: Date, today: string): boolean {
  if (c.fsrs.state === State.Review) return studyDay(c.fsrs.due) <= today
  return isLearning(c) && c.fsrs.due <= now
}

/** Rule 3, with rule 2's tie-break: due cards that are not hidden or buried. */
export function dueCards(w: World): string[] {
  const today = studyDay(w.now)
  const out: string[] = []
  for (const [id, c] of w.derived.cards) {
    if (!isDueNow(c, w.now, today) || isOut(w, id) || isBuried(w, id, today)) continue
    const sib = siblingId(id)
    const s = cardState(w.derived, sib)
    const bothDueUnseen =
      isDueNow(s, w.now, today) && !isOut(w, sib) && !reviewedOn(c, today) && !reviewedOn(s, today)
    if (bothDueUnseen) {
      // Show the one due earlier; the forward card on a tie. The other is buried once this one is seen.
      const sibFirst = s.fsrs.due < c.fsrs.due || (s.fsrs.due.getTime() === c.fsrs.due.getTime() && parseCardId(sib).dir === 'forward')
      if (sibFirst) continue
    }
    out.push(id)
  }
  return out
}

/** A 32-bit FNV-1a hash with a final mix, so ids that differ only at the end still scatter. */
function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** The day's shuffle: a fresh order every study day, the same on every device. */
export function dailyShuffle(cards: string[], today: string): string[] {
  const keyed = cards.map((id) => ({ id, key: hash32(`${today}|${id}`) }))
  return keyed.sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1)).map((k) => k.id)
}

/**
 * Rules 4–6: never-reviewed cards that may be introduced now, in the order they would be. Within a
 * chapter the order is shuffled daily, reverse cards of words already started first.
 */
export function eligibleNewCards(w: World): string[] {
  const today = studyDay(w.now)
  const misc: string[] = []
  const chapters: { id: string; cards: string[] }[] = []
  for (const ch of w.set.chapters) {
    // Rule 5: an unticked chapter gives no new cards.
    if (!isIncluded(w, ch.id)) continue
    const started: string[] = []
    const fresh: string[] = []
    for (const wordId of ch.wordIds) {
      for (const dir of DIRECTIONS) {
        const id = cardId(w.deck, wordId, dir)
        if (isHidden(w, id) || cardState(w.derived, id).introduced || isBuried(w, id, today)) continue
        if (dir === 'reverse') {
          const sib = cardId(w.deck, wordId, 'forward')
          const introduced = cardState(w.derived, sib).introduced
          if (isHidden(w, sib)) fresh.push(id)
          else if (introduced && introduced < today) started.push(id)
        } else {
          fresh.push(id)
        }
      }
    }
    const cards = [...dailyShuffle(started, today), ...dailyShuffle(fresh, today)]
    if (ch.id === MISC_ID) misc.push(...cards)
    else if (cards.length > 0) chapters.push({ id: ch.id, cards })
  }
  return [...misc, ...mixChapters(chapters, introducedTodayByChapter(w, today))]
}

/** Cards introduced today in each ticked chapter other than misc, on any device known here. */
function introducedTodayByChapter(w: World, today: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [id, c] of w.derived.cards) {
    if (c.introduced !== today) continue
    const chapterId = w.set.words.get(parseCardId(id).wordId)?.chapterId
    if (chapterId === undefined || chapterId === MISC_ID || !isIncluded(w, chapterId)) continue
    counts.set(chapterId, (counts.get(chapterId) ?? 0) + 1)
  }
  return counts
}

/**
 * Rule 6: about half of the day's new cards come from the lowest ticked chapter that has any, and the
 * rest from the other ticked chapters in turn (the one with fewest introduced today next, then the
 * lower one). Today's earlier introductions count, so the mix holds however often the queue is rebuilt.
 */
function mixChapters(chapters: { id: string; cards: string[] }[], today: Map<string, number>): string[] {
  const count = new Map(today)
  const countOf = (i: number) => count.get(chapters[i].id) ?? 0
  let total = [...today.values()].reduce((a, b) => a + b, 0)
  const next = chapters.map(() => 0)
  const live = chapters.map((_, i) => i) // chapters with cards left, lowest first
  const out: string[] = []
  while (live.length > 0) {
    const lowest = live[0]
    let pick = lowest
    if (live.length > 1 && countOf(lowest) > total - countOf(lowest)) {
      pick = live[1]
      for (const i of live) if (i !== lowest && countOf(i) < countOf(pick)) pick = i
    }
    out.push(chapters[pick].cards[next[pick]++])
    count.set(chapters[pick].id, countOf(pick) + 1)
    total++
    if (next[pick] === chapters[pick].cards.length) live.splice(live.indexOf(pick), 1)
  }
  return out
}

/** Rule 7: new cards still allowed today, counting introductions from every device known here. */
export function newAllowance(w: World): number {
  const today = studyDay(w.now)
  let introducedToday = 0
  for (const c of w.derived.cards.values()) if (c.introduced === today) introducedToday++
  const allowed = w.derived.newPerDay + LEARN_MORE_COUNT * (w.derived.learnMore.get(today) ?? 0)
  return Math.max(0, allowed - introducedToday)
}

/** The next learning or relearning card due after now, if any. */
export function nextLearning(w: World): { id: string; due: Date } | null {
  const today = studyDay(w.now)
  let best: { id: string; due: Date } | null = null
  for (const [id, c] of w.derived.cards) {
    if (!isLearning(c) || c.fsrs.due <= w.now || isOut(w, id) || isBuried(w, id, today)) continue
    if (!best || c.fsrs.due < best.due) best = { id, due: c.fsrs.due }
  }
  return best
}

export interface DayStatus {
  /** Cards due now: review plus learning. */
  due: number
  /** New cards that can still be introduced today. */
  newAvailable: number
  /** Eligible new cards regardless of today's allowance. */
  eligibleNew: number
  nextLearning: Date | null
  /** Rule 10. */
  done: boolean
  /** "Learn more" is offered only when eligible new cards remain. */
  canLearnMore: boolean
}

export function dayStatus(w: World): DayStatus {
  const due = dueCards(w).length
  const eligible = eligibleNewCards(w).length
  const allowance = newAllowance(w)
  const next = nextLearning(w)
  const learningLaterToday = next !== null && next.due < dayEnd(studyDay(w.now))
  const done = due === 0 && !learningLaterToday && (allowance === 0 || eligible === 0)
  return {
    due,
    newAvailable: Math.min(allowance, eligible),
    eligibleNew: eligible,
    nextLearning: next?.due ?? null,
    done,
    canLearnMore: done && eligible > 0,
  }
}

// ---- Session (rules 8 and 9) ----

export type Slot = { kind: 'review'; card: string } | { kind: 'new' }

export interface Plan {
  slots: Slot[]
  pos: number
}

export type Next = { kind: 'card'; card: string } | { kind: 'wait'; until: Date } | { kind: 'done' }

function shuffle<T>(list: T[], random: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

const isReviewState = (w: World, id: string) => cardState(w.derived, id).fsrs.state === State.Review

/** Rule 8: due review cards shuffled, with today's new cards at random, roughly even positions among them. */
export function buildPlan(w: World, random: () => number = Math.random): Plan {
  const reviews = shuffle(
    dueCards(w).filter((id) => isReviewState(w, id)),
    random,
  )
  const newCount = Math.min(newAllowance(w), eligibleNewCards(w).length)
  const slots: Slot[] = reviews.map((card) => ({ kind: 'review', card }))
  const inserts: number[] = []
  for (let i = 0; i < newCount; i++) {
    const lo = Math.floor((i * reviews.length) / newCount)
    const hi = Math.floor(((i + 1) * reviews.length) / newCount)
    inserts.push(lo + Math.floor(random() * (hi - lo + 1)))
  }
  for (let i = inserts.length - 1; i >= 0; i--) slots.splice(inserts[i], 0, { kind: 'new' })
  return { slots, pos: 0 }
}

function firstAvailableNew(w: World): string | null {
  return newAllowance(w) > 0 ? (eligibleNewCards(w)[0] ?? null) : null
}

/** The next card to show. Advances `plan.pos` past the slots it uses or skips. */
export function pickNext(w: World, plan: Plan): Next {
  const due = dueCards(w)
  // Learning and relearning cards jump in as soon as they come due, earliest first.
  const learningNow = due
    .filter((id) => !isReviewState(w, id))
    .sort((a, b) => cardState(w.derived, a).fsrs.due.getTime() - cardState(w.derived, b).fsrs.due.getTime())
  if (learningNow.length > 0) return { kind: 'card', card: learningNow[0] }

  const dueReviews = new Set(due.filter((id) => isReviewState(w, id)))
  while (plan.pos < plan.slots.length) {
    const slot = plan.slots[plan.pos++]
    if (slot.kind === 'review') {
      if (dueReviews.has(slot.card)) return { kind: 'card', card: slot.card }
    } else {
      const card = firstAvailableNew(w)
      if (card) return { kind: 'card', card }
    }
  }

  // Anything the plan did not cover, such as a new card freed up when another was buried.
  const leftover = [...dueReviews][0] ?? firstAvailableNew(w)
  if (leftover) return { kind: 'card', card: leftover }

  // Rule 9: learn ahead if the next learning card is close, otherwise wait for it.
  const next = nextLearning(w)
  if (next) {
    if (next.due.getTime() - w.now.getTime() <= LEARN_AHEAD_MINUTES * 60_000) return { kind: 'card', card: next.id }
    if (next.due < dayEnd(studyDay(w.now))) return { kind: 'wait', until: next.due }
  }
  return { kind: 'done' }
}

// ---- Practice ----
// Practice goes over cards already started, whenever the user likes. Grades are ordinary reviews:
// FSRS gives little credit for a card seen recently, so extra practice cannot inflate the schedule.

export interface PracticeState {
  chapterIds: string[]
  /** Cards still to get right this session, the next one first. */
  queue: string[]
  total: number
  /** Cards answered Hard, Good or Easy the first time they were shown. */
  firstTry: number
  /** Cards shown at least once. */
  seen: Set<string>
}

/** Every started, non-hidden card in the chosen chapters, ticked or not. */
export function practiceCards(w: World, chapterIds: Iterable<string>): string[] {
  const chosen = new Set(chapterIds)
  const out: string[] = []
  for (const ch of w.set.chapters) {
    if (!chosen.has(ch.id)) continue
    for (const wordId of ch.wordIds) {
      for (const dir of DIRECTIONS) {
        const id = cardId(w.deck, wordId, dir)
        if (!isHidden(w, id) && cardState(w.derived, id).introduced) out.push(id)
      }
    }
  }
  return out
}

/** Shuffled, keeping a word's two cards at least PRACTICE_SIBLING_GAP apart where possible. */
export function practiceOrder(cards: string[], random: () => number = Math.random): string[] {
  const pool = shuffle([...cards], random)
  const out: string[] = []
  while (pool.length > 0) {
    const blocked = new Set(out.slice(-PRACTICE_SIBLING_GAP).map(siblingId))
    const i = pool.findIndex((id) => !blocked.has(id))
    out.push(...pool.splice(Math.max(i, 0), 1))
  }
  return out
}

export function startPractice(w: World, chapterIds: string[], random?: () => number): PracticeState {
  const queue = practiceOrder(practiceCards(w, chapterIds), random)
  return { chapterIds, queue, total: queue.length, firstTry: 0, seen: new Set() }
}

/** Again sends the card back a few places; any other grade retires it from the session. */
export function practiceAfterGrade(p: PracticeState, card: string, r: Grade): PracticeState {
  const queue = p.queue.filter((id) => id !== card)
  if (r === 1) queue.splice(Math.min(PRACTICE_AGAIN_GAP, queue.length), 0, card)
  const firstTry = p.firstTry + (r > 1 && !p.seen.has(card) ? 1 : 0)
  return { ...p, queue, firstTry, seen: new Set(p.seen).add(card) }
}

// ---- Streak ----

/** A study day is cleared once no unhidden, unpaused, unburied card is due before the day ends. New cards do not count. */
export function isDayCleared(w: World): boolean {
  const today = studyDay(w.now)
  const end = dayEnd(today)
  for (const [id, c] of w.derived.cards) {
    if (c.fsrs.state === State.New || isOut(w, id) || isBuried(w, id, today)) continue
    const dueToday = c.fsrs.state === State.Review ? studyDay(c.fsrs.due) <= today : c.fsrs.due < end
    if (dueToday) return false
  }
  return true
}

/** Consecutive cleared days ending today if today is cleared, otherwise yesterday. */
export function streak(cleared: Set<string>, today: string): { current: number; longest: number } {
  let current = 0
  for (let d = cleared.has(today) ? today : addDays(today, -1); cleared.has(d); d = addDays(d, -1)) current++
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const d of [...cleared].filter((d) => d <= today).sort()) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  return { current, longest }
}

// ---- Stats ----

export interface ChapterProgress {
  chapter: Chapter
  included: boolean
  /** Cards introduced, out of the chapter's non-hidden cards. */
  introduced: number
  /** Cards FSRS has been confident in for at least LEARNED_STABILITY_DAYS. */
  learned: number
  total: number
}

export function chapterProgress(w: World): ChapterProgress[] {
  return w.set.chapters.map((chapter) => {
    let introduced = 0
    let learned = 0
    let total = 0
    for (const wordId of chapter.wordIds) {
      for (const dir of DIRECTIONS) {
        const id = cardId(w.deck, wordId, dir)
        if (isHidden(w, id)) continue
        total++
        const c = cardState(w.derived, id)
        if (c.introduced) introduced++
        if (isLearned(c)) learned++
      }
    }
    return { chapter, included: isIncluded(w, chapter.id), introduced, learned, total }
  })
}

/**
 * The chapter to suggest studying next: once every ticked chapter is fully introduced and
 * MOVE_ON_SHARE of their cards are learned, the first unticked chapter after the last ticked one.
 */
export function suggestedChapter(progress: ChapterProgress[]): Chapter | null {
  const isTicked = (p: ChapterProgress) => p.included && p.chapter.id !== MISC_ID
  const lastTicked = progress.findLastIndex(isTicked)
  if (lastTicked < 0) return null
  let learned = 0
  let total = 0
  for (const p of progress.filter(isTicked)) {
    if (p.introduced < p.total) return null
    learned += p.learned
    total += p.total
  }
  if (learned < MOVE_ON_SHARE * total) return null
  return progress.slice(lastTicked + 1).find((p) => !p.included && p.chapter.id !== MISC_ID)?.chapter ?? null
}
