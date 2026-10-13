// Parses and validates chapter files (rules in CARD_FORMAT.md). Bad files and bad words are
// skipped and reported; everything else loads.

import { CHAPTER_FILE_MAX_BYTES } from './config'
import type { Aspect, Chapter, ChapterSet, FileError, Gender, LoadedWord, Word } from './types'

export interface RawFile {
  path: string
  text: string
}

export const MISC_ID = 'misc'
const CHAPTER_ID = /^[a-z0-9-]+$/
const WORD_ID = /^[a-z0-9][a-z0-9-]*$/
const GENDERS: readonly Gender[] = ['m-anim', 'm-inanim', 'f', 'n']
const ASPECTS: readonly Aspect[] = ['impf', 'pf', 'biasp']
const REQUIRED_TEXT = ['cz', 'en', 'example', 'exampleEn'] as const
const OPTIONAL_TEXT = ['partner', 'hint', 'note'] as const

/** The fields that make up a word's content hash, in hashing order. */
export const CONTENT_FIELDS = ['cz', 'en', 'gender', 'aspect', 'partner', 'hint', 'example', 'exampleEn', 'note'] as const

type Parsed = { ok: true; word: Word } | { ok: false; problem: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseWord(raw: Record<string, unknown>): Parsed {
  const word: Record<string, string> = {}
  for (const field of REQUIRED_TEXT) {
    const v = raw[field]
    if (typeof v !== 'string' || v.trim() === '') return { ok: false, problem: `Missing or empty "${field}"` }
    word[field] = v.trim()
  }
  for (const field of OPTIONAL_TEXT) {
    const v = raw[field]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') return { ok: false, problem: `"${field}" must be text` }
    if (v.trim() !== '') word[field] = v.trim()
  }
  if (raw.gender !== undefined) {
    if (!GENDERS.includes(raw.gender as Gender)) {
      return { ok: false, problem: `Invalid gender ${JSON.stringify(raw.gender)} (use m-anim, m-inanim, f or n)` }
    }
    word.gender = raw.gender as string
  }
  if (raw.aspect !== undefined) {
    if (!ASPECTS.includes(raw.aspect as Aspect)) {
      return { ok: false, problem: `Invalid aspect ${JSON.stringify(raw.aspect)} (use impf, pf or biasp)` }
    }
    word.aspect = raw.aspect as string
  }
  if (word.gender && word.aspect) return { ok: false, problem: 'A word may not have both "gender" and "aspect"' }
  if (word.partner && !word.aspect) return { ok: false, problem: '"partner" requires "aspect"' }
  return { ok: true, word: { id: raw.id as string, ...word } as unknown as Word }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Study order: misc first, then ascending order, ties broken by chapter id. */
export function compareChapters(a: Pick<Chapter, 'id' | 'order'>, b: Pick<Chapter, 'id' | 'order'>): number {
  if (a.id === MISC_ID) return b.id === MISC_ID ? 0 : -1
  if (b.id === MISC_ID) return 1
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Parses chapter files without hashing. Words carry their chapter id. */
export function parseChapterFiles(files: RawFile[]): {
  chapters: Chapter[]
  words: Map<string, Word & { chapterId: string }>
  errors: FileError[]
} {
  const errors: FileError[] = []
  const pending: { chapter: Chapter; rawWords: unknown[] }[] = []
  const chapterFiles = new Map<string, string>()

  // Files are checked in file-name order, so a duplicate chapter id skips the later file.
  for (const { path, text } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const fail = (problem: string) => errors.push({ file: path, problem })
    if (byteLength(text) > CHAPTER_FILE_MAX_BYTES) fail('File is larger than 500 KB; it was still loaded')
    let data: unknown
    try {
      data = JSON.parse(text.replace(/^﻿/, ''))
    } catch {
      fail('Not valid JSON; file skipped')
      continue
    }
    if (!isObject(data) || data.format !== 1) {
      fail('Missing or unsupported "format" (must be 1); file skipped')
      continue
    }
    const ch = data.chapter
    if (!isObject(ch)) {
      fail('Missing "chapter"; file skipped')
      continue
    }
    if (typeof ch.id !== 'string' || !CHAPTER_ID.test(ch.id)) {
      fail('"chapter.id" must use lowercase letters, digits and hyphens; file skipped')
      continue
    }
    const isMisc = ch.id === MISC_ID
    if (!isMisc && (typeof ch.order !== 'number' || !Number.isInteger(ch.order) || ch.order < 1)) {
      fail('"chapter.order" must be a whole number of at least 1; file skipped')
      continue
    }
    if (typeof ch.title !== 'string' || ch.title.trim() === '') {
      fail('Missing or empty "chapter.title"; file skipped')
      continue
    }
    if (!Array.isArray(data.words)) {
      fail('"words" must be an array; file skipped')
      continue
    }
    const firstFile = chapterFiles.get(ch.id)
    if (firstFile) {
      fail(`Chapter id "${ch.id}" is already used by ${firstFile}; file skipped`)
      continue
    }
    chapterFiles.set(ch.id, path)
    pending.push({
      chapter: { id: ch.id, order: isMisc ? 0 : (ch.order as number), title: ch.title.trim(), file: path, wordIds: [] },
      rawWords: data.words,
    })
  }

  // Words are checked in chapter order, so a duplicate word id skips the later one.
  pending.sort((a, b) => compareChapters(a.chapter, b.chapter))
  const words = new Map<string, Word & { chapterId: string }>()
  for (const { chapter, rawWords } of pending) {
    rawWords.forEach((raw, i) => {
      const where = `Word ${i + 1}`
      if (!isObject(raw)) {
        errors.push({ file: chapter.file, problem: `${where} is not an object; skipped` })
        return
      }
      if (typeof raw.id !== 'string' || !WORD_ID.test(raw.id)) {
        errors.push({ file: chapter.file, problem: `${where} has a missing or invalid "id"; skipped` })
        return
      }
      const id = raw.id
      const existing = words.get(id)
      if (existing) {
        errors.push({ file: chapter.file, wordId: id, problem: `Duplicate id (already in chapter "${existing.chapterId}"); skipped` })
        return
      }
      const parsed = parseWord(raw)
      if (!parsed.ok) {
        errors.push({ file: chapter.file, wordId: id, problem: `${parsed.problem}; skipped` })
        return
      }
      words.set(id, { ...parsed.word, chapterId: chapter.id })
      chapter.wordIds.push(id)
    })
  }

  return { chapters: pending.map((p) => p.chapter), words, errors }
}

/** First 16 hex characters of SHA-256 over the word's content fields. */
export async function contentHash(word: Partial<Word>): Promise<string> {
  const text = CONTENT_FIELDS.map((f) => word[f] ?? '').join('\u001f')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Parses chapter files and hashes every word. */
export async function loadChapterSet(files: RawFile[]): Promise<ChapterSet> {
  const { chapters, words, errors } = parseChapterFiles(files)
  const loaded = new Map<string, LoadedWord>()
  for (const [id, word] of words) loaded.set(id, { ...word, hash: await contentHash(word) })
  return { chapters, words: loaded, errors }
}
