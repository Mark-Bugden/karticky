// Fixed values from the design document. Change them here, not in the code that uses them.

export const GITHUB_OWNER = 'mark-bugden'
export const GITHUB_REPO = 'karticky-czech'
export const GITHUB_BRANCH = 'main'
export const GITHUB_API = 'https://api.github.com'
/** Newest REST API version on 13 Oct 2026; none of its breaking changes touch the endpoints we use. */
export const GITHUB_API_VERSION = '2026-03-10'

/** The study day rolls over at this local hour, as in Anki. */
export const ROLLOVER_HOUR = 4

export const RETENTION = 0.9
export const LEARNING_STEPS = ['10m'] as const
export const RELEARNING_STEPS = ['10m'] as const

export const NEW_PER_DAY_DEFAULT = 10
export const NEW_PER_DAY_MIN = 1
export const NEW_PER_DAY_MAX = 50
export const LEARN_MORE_COUNT = 5
/** If only learning cards remain and the next is due within this many minutes, show it now. */
export const LEARN_AHEAD_MINUTES = 20

export const SYNC_INTERVAL_MS = 5 * 60 * 1000
export const SYNC_RETRY_DELAYS_MS = [2000, 4000, 8000]

export const MATURE_STABILITY_DAYS = 21
/** A card counts as learned once FSRS is confident in it for this many days: remembered after a gap, roughly. */
export const LEARNED_STABILITY_DAYS = 7
/** The next chapter is suggested once this share of the ticked chapters' cards is learned. */
export const MOVE_ON_SHARE = 0.8
export const STRUGGLING_LAPSES = 4
export const STRUGGLING_DIFFICULTY = 8
export const RETENTION_WINDOW_DAYS = 30

export const CHAPTER_FILE_MAX_BYTES = 500 * 1024
