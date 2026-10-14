export type Gender = 'm-anim' | 'm-inanim' | 'f' | 'n'
export type Aspect = 'impf' | 'pf' | 'biasp'
export type Direction = 'cz-en' | 'en-cz'
export type Grade = 1 | 2 | 3 | 4

/** One entry in a chapter file. */
export interface Word {
  id: string
  cz: string
  en: string
  gender?: Gender
  aspect?: Aspect
  partner?: string
  hint?: string
  /** Grammatical form or register, shown with the word on both sides, e.g. "dative" or "formal (vy)". */
  label?: string
  example: string
  exampleEn: string
  note?: string
  /** Conjugation or declension, shown on request wherever the Czech word is on screen. */
  tables?: FormTable[]
}

/** A small grid of forms. Each row starts with its heading. */
export interface FormTable {
  title?: string
  /** Column headings; the first sits above the row headings and may be empty. */
  cols?: string[]
  rows: string[][]
  note?: string
}

/** A word from a current chapter file, with its chapter and content hash. */
export interface LoadedWord extends Word {
  chapterId: string
  hash: string
}

export interface Chapter {
  id: string
  /** 0 for the misc chapter. */
  order: number
  title: string
  file: string
  wordIds: string[]
}

export interface FileError {
  file: string
  wordId?: string
  problem: string
}

/** The chapters currently in the data repo, in study order (misc first). */
export interface ChapterSet {
  chapters: Chapter[]
  words: Map<string, LoadedWord>
  errors: FileError[]
}

export type EventType =
  | 'review'
  | 'undo'
  | 'suspend'
  | 'unsuspend'
  | 'delete'
  | 'flag'
  | 'unflag'
  | 'learnMore'
  | 'setting'
  | 'dayCleared'

/** An immutable record of something the user did. Never edited or deleted. */
export interface AppEvent {
  id: string
  /** ISO 8601 UTC with milliseconds. */
  t: string
  dev: string
  type: EventType
  card?: string
  word?: string
  r?: Grade
  target?: string
  hash?: string
  day?: string
  key?: string
  value?: number
}
