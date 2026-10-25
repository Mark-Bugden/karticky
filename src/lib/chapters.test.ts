import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentHash, loadChapterSet, parseChapterFiles, type RawFile } from './chapters'
import { DECKS } from './config'

const sampleText = readFileSync(new URL('../../sample/sample.json', import.meta.url), 'utf8')
const czech = DECKS.czech
const spanish = DECKS.spanish
const sampleEsText = readFileSync(new URL('../../sample/sample-es.json', import.meta.url), 'utf8')

const word = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  cz: `cz ${id}`,
  en: `en ${id}`,
  example: 'Příklad.',
  exampleEn: 'Example.',
  ...extra,
})

const file = (path: string, chapter: Record<string, unknown>, words: unknown[]): RawFile => ({
  path,
  text: JSON.stringify({ format: 1, chapter, words }),
})

describe('parseChapterFiles', () => {
  it('loads the sample chapter: 8 words, no errors', () => {
    const { chapters, words, errors } = parseChapterFiles([{ path: 'chapters/sample.json', text: sampleText }], czech)
    expect(errors).toEqual([])
    expect(chapters).toHaveLength(1)
    expect(chapters[0]).toMatchObject({ id: 'sample', order: 1, title: 'Sample', file: 'chapters/sample.json' })
    expect(chapters[0].wordIds).toHaveLength(8)
    expect(words.get('sample-005')).toMatchObject({ term: 'říkat', aspect: 'impf', partner: 'říct', chapterId: 'sample' })
    expect(words.get('sample-002')).toMatchObject({ gender: 'm-inanim', hint: 'furniture' })
  })

  it('orders chapters misc first, then by order, ties by id', () => {
    const { chapters } = parseChapterFiles([
      file('chapters/02-b.json', { id: 'b', order: 2, title: 'B' }, []),
      file('chapters/02-a.json', { id: 'a', order: 2, title: 'A' }, []),
      file('chapters/01-z.json', { id: 'z', order: 1, title: 'Z' }, []),
      file('chapters/misc.json', { id: 'misc', order: 0, title: 'Misc' }, []),
    ], czech)
    expect(chapters.map((c) => c.id)).toEqual(['misc', 'z', 'a', 'b'])
    expect(chapters[0].order).toBe(0)
  })

  it('skips a whole file that is not JSON or lacks a valid format or chapter', () => {
    const { chapters, errors } = parseChapterFiles([
      { path: 'chapters/bad.json', text: '{ nope' },
      { path: 'chapters/fmt.json', text: JSON.stringify({ format: 2, chapter: { id: 'x', order: 1, title: 'X' }, words: [] }) },
      file('chapters/id.json', { id: 'Bad Id', order: 1, title: 'X' }, []),
      file('chapters/order.json', { id: 'o', order: 0, title: 'X' }, []),
      file('chapters/title.json', { id: 't', order: 1, title: ' ' }, []),
      { path: 'chapters/words.json', text: JSON.stringify({ format: 1, chapter: { id: 'w', order: 1, title: 'W' } }) },
      file('chapters/ok.json', { id: 'ok', order: 1, title: 'OK' }, [word('ok-1')]),
    ], czech)
    expect(chapters.map((c) => c.id)).toEqual(['ok'])
    expect(errors.map((e) => e.file).sort()).toEqual(
      ['chapters/bad.json', 'chapters/fmt.json', 'chapters/id.json', 'chapters/order.json', 'chapters/title.json', 'chapters/words.json'],
    )
  })

  it('accepts a byte-order mark and ignores unknown fields', () => {
    const text = '﻿' + JSON.stringify({ format: 1, extra: true, chapter: { id: 'c', order: 1, title: 'C', x: 1 }, words: [word('c-1', { future: 'x' })] })
    const { words, errors } = parseChapterFiles([{ path: 'chapters/c.json', text }], czech)
    expect(errors).toEqual([])
    expect(words.get('c-1')).not.toHaveProperty('future')
  })

  it('skips the later file by name when two files share a chapter id', () => {
    const { chapters, errors } = parseChapterFiles([
      file('chapters/02-dup.json', { id: 'dup', order: 1, title: 'Second' }, [word('w-2')]),
      file('chapters/01-dup.json', { id: 'dup', order: 1, title: 'First' }, [word('w-1')]),
    ], czech)
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('First')
    expect(errors).toEqual([{ file: 'chapters/02-dup.json', problem: expect.stringContaining('already used by chapters/01-dup.json') }])
  })

  it('skips the later duplicate word id in chapter order and reports it', () => {
    const { chapters, words, errors } = parseChapterFiles([
      file('chapters/a.json', { id: 'second', order: 2, title: 'Second' }, [word('same', { en: 'later' })]),
      file('chapters/b.json', { id: 'first', order: 1, title: 'First' }, [word('same', { en: 'earlier' })]),
    ], czech)
    expect(words.get('same')?.en).toBe('earlier')
    expect(chapters.find((c) => c.id === 'second')?.wordIds).toEqual([])
    expect(errors).toEqual([{ file: 'chapters/a.json', wordId: 'same', problem: expect.stringContaining('Duplicate id') }])
  })

  it('skips invalid words alone and keeps the rest', () => {
    const { words, errors } = parseChapterFiles([
      file('chapters/c.json', { id: 'c', order: 1, title: 'C' }, [
        word('good'),
        'not an object',
        word('Bad_ID'),
        { ...word('no-example'), example: '' },
        word('both', { gender: 'f', aspect: 'pf' }),
        word('partner-only', { partner: 'x' }),
        word('bad-gender', { gender: 'x' }),
        word('bad-aspect', { aspect: 'perfect' }),
        word('bad-note', { note: 3 }),
        word('noun', { gender: 'n' }),
      ]),
    ], czech)
    expect([...words.keys()]).toEqual(['good', 'noun'])
    expect(errors).toHaveLength(8)
    expect(errors.find((e) => e.wordId === 'both')?.problem).toMatch(/both "gender" and "aspect"/)
    expect(errors.find((e) => e.wordId === 'partner-only')?.problem).toMatch(/"partner" requires "aspect"/)
    expect(errors.find((e) => e.problem.startsWith('Word 2'))).toBeDefined()
    expect(errors.find((e) => e.problem.startsWith('Word 3'))?.problem).toMatch(/invalid "id"/)
  })

  it('loads a label and well-formed tables', () => {
    const tables = [
      { title: 'Present', rows: [['já', 'mám'], ['ty', 'máš']] },
      { cols: ['', 'singular', 'plural'], rows: [['nominative', ' pes ', 'psi']], note: 'Animate.' },
    ]
    const { words, errors } = parseChapterFiles([
      file('chapters/c.json', { id: 'c', order: 1, title: 'C' }, [word('me', { label: ' accusative, genitive ', tables })]),
    ], czech)
    expect(errors).toEqual([])
    expect(words.get('me')).toMatchObject({
      label: 'accusative, genitive',
      tables: [
        { title: 'Present', rows: [['já', 'mám'], ['ty', 'máš']] },
        { cols: ['', 'singular', 'plural'], rows: [['nominative', 'pes', 'psi']], note: 'Animate.' },
      ],
    })
  })

  it('keeps a word whose tables are malformed, without them, and reports it', () => {
    const bad = [
      word('not-list', { tables: { rows: [] } }),
      word('no-rows', { tables: [{ title: 'X', rows: [] }] }),
      word('short-row', { tables: [{ rows: [['only heading']] }] }),
      word('ragged', { tables: [{ cols: ['', 'sg', 'pl'], rows: [['nom', 'a']] }] }),
      word('number', { tables: [{ rows: [['nom', 3]] }] }),
    ]
    const { words, errors } = parseChapterFiles([file('chapters/c.json', { id: 'c', order: 1, title: 'C' }, bad)], czech)
    expect([...words.keys()]).toEqual(['not-list', 'no-rows', 'short-row', 'ragged', 'number'])
    for (const w of words.values()) expect(w).not.toHaveProperty('tables')
    expect(errors).toHaveLength(5)
    for (const e of errors) expect(e.problem).toMatch(/tables left out$/)
  })

  it('reports a file over 500 KB but still loads it', () => {
    const big = word('big', { note: 'x'.repeat(520 * 1024) })
    const { words, errors } = parseChapterFiles([file('chapters/big.json', { id: 'big', order: 1, title: 'Big' }, [big])], czech)
    expect(words.has('big')).toBe(true)
    expect(errors).toEqual([{ file: 'chapters/big.json', problem: expect.stringContaining('500 KB') }])
  })
})

describe('contentHash', () => {
  it('is 16 hex characters and changes when content changes', async () => {
    const a = await contentHash(word('h'))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await contentHash(word('h'))).toBe(a)
    expect(await contentHash(word('h', { en: 'other' }))).not.toBe(a)
    expect(await contentHash(word('h', { note: 'added' }))).not.toBe(a)
  })

  it('keeps the hash of a word without the later fields, so existing flags still match', async () => {
    // ce1-l01-057 as flagged on 14 Oct 2026, before label and tables existed.
    const v = { term: 'v + L', en: 'in', example: 'Petr je v kanceláři.', exampleEn: 'Petr is in the office.', note: 'Before v, f and some groups: ve, e.g. ve firmě.' }
    expect(await contentHash(v)).toBe('84671a7ffc56af82')
    expect(await contentHash({ ...v, label: 'locative' })).not.toBe('84671a7ffc56af82')
    expect(await contentHash({ ...v, tables: [{ rows: [['a', 'b']] }] })).not.toBe('84671a7ffc56af82')
    expect(await contentHash({ ...v, tables: [{ rows: [['a', 'c']] }] })).not.toBe(await contentHash({ ...v, tables: [{ rows: [['a', 'b']] }] }))
  })

  it('ignores the id and fields outside the content list', async () => {
    expect(await contentHash(word('one'))).not.toBe(await contentHash(word('two'))) // cz/en differ
    const base = { term: 'a', en: 'b', example: 'c', exampleEn: 'd' }
    expect(await contentHash({ ...base, id: 'x' })).toBe(await contentHash({ ...base, id: 'y' }))
  })
})

describe('loadChapterSet', () => {
  it('hashes every loaded word', async () => {
    const set = await loadChapterSet([{ path: 'chapters/sample.json', text: sampleText }], czech)
    expect(set.words.size).toBe(8)
    for (const w of set.words.values()) expect(w.hash).toMatch(/^[0-9a-f]{16}$/)
  })
})

const esWord = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  es: `es ${id}`,
  en: `en ${id}`,
  example: 'Ejemplo.',
  exampleEn: 'Example.',
  ...extra,
})

describe('Spanish chapter files', () => {
  it('loads the Spanish sample chapter: 8 words, 16 cards, no errors', async () => {
    const set = await loadChapterSet([{ path: 'chapters/sample.json', text: sampleEsText }], spanish)
    expect(set.errors).toEqual([])
    expect(set.chapters).toMatchObject([{ id: 'sample', order: 1, title: 'Sample' }])
    expect(set.chapters[0].wordIds).toHaveLength(8)
    expect(set.words.get('sample-001')).toMatchObject({ term: 'el perro', en: 'dog', gender: 'm' })
    expect(set.words.get('sample-003')).toMatchObject({ term: 'el agua', gender: 'f', note: expect.stringContaining('stressed a') })
    expect(set.words.get('sample-005')).toMatchObject({ term: 'hablar', verb: true })
    expect(set.words.get('sample-005')?.tables?.map((t) => t.title ?? t.cols?.join('|'))).toEqual(['|present|preterite|imperfect', 'Other forms'])
    expect(set.words.get('sample-006')).toMatchObject({ term: 'acordarse de', verb: true, note: 'o → ue: me acuerdo.' })
    expect(set.words.get('sample-007')).toMatchObject({ label: 'informal' })
    for (const id of ['sample-007', 'sample-008']) {
      expect(set.words.get(id)).not.toHaveProperty('gender')
      expect(set.words.get(id)).not.toHaveProperty('verb')
    }
  })

  it('reads the word from "es", not "cz"', () => {
    const { words, errors } = parseChapterFiles([file('chapters/c.json', { id: 'c', order: 1, title: 'C' }, [word('cz-only')])], spanish)
    expect(words.size).toBe(0)
    expect(errors).toEqual([{ file: 'chapters/c.json', wordId: 'cz-only', problem: 'Missing or empty "es"; skipped' }])
  })

  it('skips and reports aspect, partner, Czech genders, and a verb with a gender', () => {
    const { words, errors } = parseChapterFiles(
      [
        file('chapters/c.json', { id: 'c', order: 1, title: 'C' }, [
          esWord('noun-m', { gender: 'm' }),
          esWord('noun-f', { gender: 'f' }),
          esWord('verb', { verb: true }),
          esWord('phrase', { verb: null }),
          esWord('aspect', { verb: true, aspect: 'impf' }),
          esWord('partner', { partner: 'x' }),
          esWord('neuter', { gender: 'n' }),
          esWord('anim', { gender: 'm-anim' }),
          esWord('both', { gender: 'm', verb: true }),
          esWord('verb-false', { verb: false }),
          esWord('verb-text', { verb: 'yes' }),
        ]),
      ],
      spanish,
    )
    expect([...words.keys()]).toEqual(['noun-m', 'noun-f', 'verb', 'phrase'])
    expect(words.get('phrase')).not.toHaveProperty('verb')
    const problem = (id: string) => errors.find((e) => e.wordId === id)?.problem
    expect(problem('aspect')).toBe('Spanish words have no "aspect" or "partner"; skipped')
    expect(problem('partner')).toBe('Spanish words have no "aspect" or "partner"; skipped')
    expect(problem('neuter')).toBe('Invalid gender "n" (use m or f); skipped')
    expect(problem('anim')).toBe('Invalid gender "m-anim" (use m or f); skipped')
    expect(problem('both')).toBe('A word may not have both "gender" and "verb"; skipped')
    expect(problem('verb-false')).toBe('Invalid "verb" (use true, or leave it out); skipped')
    expect(problem('verb-text')).toBe('Invalid "verb" (use true, or leave it out); skipped')
    expect(errors).toHaveLength(7)
  })

  it('skips and reports a Czech word marked "verb", and a Czech word with a Spanish gender', () => {
    const { words, errors } = parseChapterFiles(
      [file('chapters/c.json', { id: 'c', order: 1, title: 'C' }, [word('v', { aspect: 'impf', verb: true }), word('m', { gender: 'm' })])],
      czech,
    )
    expect(words.size).toBe(0)
    expect(errors.map((e) => e.problem)).toEqual([
      'Czech words have no "verb"; a verb has "aspect"; skipped',
      'Invalid gender "m" (use m-anim, m-inanim, f or n); skipped',
    ])
  })

  it('hashes "verb" only when a word has it', async () => {
    const base = { term: 'hablar', en: 'to speak', example: 'Hablo.', exampleEn: 'I speak.' }
    expect(await contentHash({ ...base, verb: true })).not.toBe(await contentHash(base))
    expect(await contentHash({ ...base, verb: undefined })).toBe(await contentHash(base))
  })
})
