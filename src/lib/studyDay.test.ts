import { describe, expect, it } from 'vitest'
import { addDays, dayEnd, dayStart, studyDay, utcDate } from './studyDay'

describe('study day', () => {
  it('runs tests in the Prague time zone', () => {
    // Set in vitest.config.ts so daylight-saving cases are reproducible on any machine.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-120)
  })

  it('rolls over at 4 am local time', () => {
    expect(studyDay(new Date(2026, 9, 13, 3, 59, 59))).toBe('2026-10-12')
    expect(studyDay(new Date(2026, 9, 13, 4, 0, 0))).toBe('2026-10-13')
    expect(studyDay(new Date(2026, 9, 13, 23, 59))).toBe('2026-10-13')
    expect(studyDay(new Date(2026, 0, 1, 2, 0))).toBe('2025-12-31')
  })

  it('keeps the rollover at 4 am on daylight-saving change days', () => {
    // Clocks go forward at 02:00 on 29 March 2026 and back at 03:00 on 25 October 2026.
    expect(studyDay(new Date(2026, 2, 29, 3, 30))).toBe('2026-03-28')
    expect(studyDay(new Date(2026, 2, 29, 4, 0))).toBe('2026-03-29')
    expect(studyDay(new Date(2026, 9, 25, 3, 30))).toBe('2026-10-24')
    expect(studyDay(new Date(2026, 9, 25, 4, 0))).toBe('2026-10-25')
  })

  it('adds days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-10-13', 0)).toBe('2026-10-13')
  })

  it('gives the start and end of a study day', () => {
    expect(dayStart('2026-10-13')).toEqual(new Date(2026, 9, 13, 4))
    expect(dayEnd('2026-10-13')).toEqual(new Date(2026, 9, 14, 4))
    expect(dayEnd('2026-10-24').getTime() - dayStart('2026-10-24').getTime()).toBe(25 * 3600 * 1000)
  })

  it('takes the UTC date of a timestamp', () => {
    expect(utcDate('2026-10-13T23:30:00.000Z')).toBe('2026-10-13')
  })
})
