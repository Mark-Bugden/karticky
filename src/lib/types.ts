/** Czech: m-anim, m-inanim, f, n. Spanish: m, f. */
export type Gender = 'm-anim' | 'm-inanim' | 'f' | 'n' | 'm'
export type Aspect = 'impf' | 'pf' | 'biasp'
/** Forward: the deck's language → English. Reverse: English → the deck's language. */
export type Direction = 'forward' | 'reverse'
export type Grade = 1 | 2 | 3 | 4

/** A deck: a data repo and the language its cards teach. Everything that differs between decks is here. */
export interface DeckProfile {
  /** Stored on the device to remember which deck it studies. */
  id: string
  /** The data repo, under GITHUB_OWNER. */
  repo: string
  /** Names the word's field in chapter files, the direction in card ids ("cz-en"), and the summary's word column. */
  code: string
  /** The language's English name, as in "Czech → English". */
  name: string
  /** The `lang` attribute on text in the deck's language. */
  lang: string
  /** The genders a noun may have in this deck's chapter files. */
  genders: readonly Gender[]
  /** Whether verbs have an aspect, and may name an aspect partner. Otherwise a verb is marked with `verb`. */
  aspect: boolean
  /** Table column headings that name a gender, with the gender whose colour they take. */
  tableGenders: Readonly<Record<string, Gender>>
  /** The tables button's name for a word that is not a verb. */
  formsButton: string
  /** The IndexedDB database holding this deck's events, cache and token. */
  db: string
  /** The Web Lock that keeps the windows of the app on one device from syncing at once. */
  syncLock: string
}

/** One entry in a chapter file. */
export interface Word {
  id: string
  /** The word or phrase in the deck's language; chapter files name this field by the deck's code. */
  term: string
  en: string
  gender?: Gender
  aspect?: Aspect
  partner?: string
  /** Marks a verb in a deck without aspect (Spanish). */
  verb?: boolean
  hint?: string
  /** Grammatical form or register, shown with the word on both sides, e.g. "dative" or "formal (vy)". */
  label?: string
  example: string
  exampleEn: string
  note?: string
  /** Conjugation or declension, shown on request wherever the word in the deck's language is on screen. */
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
