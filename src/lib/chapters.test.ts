import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentHash, loadChapterSet, parseChapterFiles, type RawFile } from './chapters'

const sampleText = readFileSync(new URL('../../sample/sample.json', import.meta.url), 'utf8')

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
    const { chapters, words, errors } = parseChapterFiles([{ path: 'chapters/sample.json', text: sampleText }])
    expect(errors).toEqual([])
    expect(chapters).toHaveLength(1)
    expect(chapters[0]).toMatchObject({ id: 'sample', order: 1, title: 'Sample', file: 'chapters/sample.json' })
    expect(chapters[0].wordIds).toHaveLength(8)
    expect(words.get('sample-005')).toMatchObject({ cz: 'říkat', aspect: 'impf', partner: 'říct', chapterId: 'sample' })
    expect(words.get('sample-002')).toMatchObject({ gender: 'm-inanim', hint: 'furniture' })
  })

  it('orders chapters misc first, then by order, ties by id', () => {
    const { chapters } = parseChapterFiles([
      file('chapters/02-b.json', { id: 'b', order: 2, title: 'B' }, []),
      file('chapters/02-a.json', { id: 'a', order: 2, title: 'A' }, []),
      file('chapters/01-z.json', { id: 'z', order: 1, title: 'Z' }, []),
      file('chapters/misc.json', { id: 'misc', order: 0, title: 'Misc' }, []),
    ])
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
    ])
    expect(chapters.map((c) => c.id)).toEqual(['ok'])
    expect(errors.map((e) => e.file).sort()).toEqual(
      ['chapters/bad.json', 'chapters/fmt.json', 'chapters/id.json', 'chapters/order.json', 'chapters/title.json', 'chapters/words.json'],
    )
  })

  it('accepts a byte-order mark and ignores unknown fields', () => {
    const text = '﻿' + JSON.stringify({ format: 1, extra: true, chapter: { id: 'c', order: 1, title: 'C', x: 1 }, words: [word('c-1', { future: 'x' })] })
    const { words, errors } = parseChapterFiles([{ path: 'chapters/c.json', text }])
    expect(errors).toEqual([])
    expect(words.get('c-1')).not.toHaveProperty('future')
  })

  it('skips the later file by name when two files share a chapter id', () => {
    const { chapters, errors } = parseChapterFiles([
      file('chapters/02-dup.json', { id: 'dup', order: 1, title: 'Second' }, [word('w-2')]),
      file('chapters/01-dup.json', { id: 'dup', order: 1, title: 'First' }, [word('w-1')]),
    ])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('First')
    expect(errors).toEqual([{ file: 'chapters/02-dup.json', problem: expect.stringContaining('already used by chapters/01-dup.json') }])
  })

  it('skips the later duplicate word id in chapter order and reports it', () => {
    const { chapters, words, errors } = parseChapterFiles([
      file('chapters/a.json', { id: 'second', order: 2, title: 'Second' }, [word('same', { en: 'later' })]),
      file('chapters/b.json', { id: 'first', order: 1, title: 'First' }, [word('same', { en: 'earlier' })]),
    ])
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
    ])
    expect([...words.keys()]).toEqual(['good', 'noun'])
    expect(errors).toHaveLength(8)
    expect(errors.find((e) => e.wordId === 'both')?.problem).toMatch(/both "gender" and "aspect"/)
    expect(errors.find((e) => e.wordId === 'partner-only')?.problem).toMatch(/"partner" requires "aspect"/)
    expect(errors.find((e) => e.problem.startsWith('Word 2'))).toBeDefined()
    expect(errors.find((e) => e.problem.startsWith('Word 3'))?.problem).toMatch(/invalid "id"/)
  })

  it('reports a file over 500 KB but still loads it', () => {
    const big = word('big', { note: 'x'.repeat(520 * 1024) })
    const { words, errors } = parseChapterFiles([file('chapters/big.json', { id: 'big', order: 1, title: 'Big' }, [big])])
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

  it('ignores the id and fields outside the content list', async () => {
    expect(await contentHash(word('one'))).not.toBe(await contentHash(word('two'))) // cz/en differ
    const base = { cz: 'a', en: 'b', example: 'c', exampleEn: 'd' }
    expect(await contentHash({ ...base, id: 'x' })).toBe(await contentHash({ ...base, id: 'y' }))
  })
})

describe('loadChapterSet', () => {
  it('hashes every loaded word', async () => {
    const set = await loadChapterSet([{ path: 'chapters/sample.json', text: sampleText }])
    expect(set.words.size).toBe(8)
    for (const w of set.words.values()) expect(w.hash).toMatch(/^[0-9a-f]{16}$/)
  })
})
