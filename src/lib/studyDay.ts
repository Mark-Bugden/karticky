import { ROLLOVER_HOUR } from './config'

const pad = (n: number) => String(n).padStart(2, '0')

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The study day (YYYY-MM-DD) a moment belongs to: the local date, rolling over at 4 am.
 * Uses the local wall clock, so the rollover stays at 4 am on daylight-saving change days too.
 */
export function studyDay(d: Date): string {
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getHours() < ROLLOVER_HOUR ? 1 : 0))
  return formatLocalDate(shifted)
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The moment a study day starts: 4 am local time on that date. */
export function dayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, ROLLOVER_HOUR)
}

/** The moment a study day ends (the next day's 4 am). */
export function dayEnd(day: string): Date {
  return dayStart(addDays(day, 1))
}

/** The UTC date of an ISO timestamp, used to name log files. */
export function utcDate(t: string): string {
  return t.slice(0, 10)
}
