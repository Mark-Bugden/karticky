import { describe, expect, it } from 'vitest'
import { DECKS } from './config'
import { directionLabel, englishPrompt, formsButton, partnerLine } from './format'

const { czech, spanish } = DECKS

describe('wording from the deck', () => {
  it('names the directions after the deck', () => {
    expect(directionLabel(czech, 'forward')).toBe('Czech → English')
    expect(directionLabel(czech, 'reverse')).toBe('English → Czech')
    expect(directionLabel(spanish, 'forward')).toBe('Spanish → English')
    expect(directionLabel(spanish, 'reverse')).toBe('English → Spanish')
  })

  it('calls the tables Conjugation for a verb, otherwise Declension in Czech and Forms in Spanish', () => {
    expect(formsButton(czech, { aspect: 'impf' })).toBe('Conjugation')
    expect(formsButton(czech, {})).toBe('Declension')
    expect(formsButton(spanish, { verb: true })).toBe('Conjugation')
    expect(formsButton(spanish, {})).toBe('Forms')
  })

  it('shows aspect and the partner line only for a word with an aspect', () => {
    expect(englishPrompt({ en: 'to say, to tell', aspect: 'impf' })).toBe('to say, to tell (impf.)')
    expect(englishPrompt({ en: 'to speak, to talk' })).toBe('to speak, to talk')
    expect(partnerLine({ term: 'říkat', aspect: 'impf', partner: 'říct' })).toBe('říkat (impf.) · říct (pf.)')
    expect(partnerLine({ term: 'hablar' })).toBeNull()
  })
})
