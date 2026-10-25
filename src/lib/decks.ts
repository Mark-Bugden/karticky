// Which deck a device studies. Setup finds it from the token, which sees only one deck's repo, and it
// is remembered in localStorage; a device with no remembered deck studies Czech, as every install did
// before there was a second deck.

import { DECKS } from './config'
import { checkAccess, type FetchFn } from './github'
import type { DeckProfile } from './types'

export const DECK_KEY = 'karticky-deck'

type DeckStore = Pick<Storage, 'getItem' | 'setItem'>
const localStore = (): DeckStore | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage)
const byId = (id: string | null): DeckProfile | undefined => Object.values(DECKS).find((d) => d.id === id)

/** The deck this device studies; Czech if none is stored or it cannot be read. */
export function storedDeck(store: DeckStore | undefined = localStore()): DeckProfile {
  try {
    return byId(store?.getItem(DECK_KEY) ?? null) ?? DECKS.czech
  } catch {
    return DECKS.czech
  }
}

export function storeDeck(deck: DeckProfile, store: DeckStore | undefined = localStore()): void {
  try {
    store?.setItem(DECK_KEY, deck.id)
  } catch {
    // Not stored: the next start falls back to Czech, and Setup switches back with the same token.
  }
}

export type FoundDeck = { ok: true; deck: DeckProfile } | { ok: false; message: string }

/** Setup's check: the deck whose repo this token can see. It must see exactly one. */
export async function findDeck(token: string, fetchFn?: FetchFn): Promise<FoundDeck> {
  const decks = Object.values(DECKS)
  const results = await Promise.all(decks.map((d) => checkAccess(token, d.repo, fetchFn)))
  const seen = decks.filter((_, i) => results[i].ok)
  if (seen.length > 1) return { ok: false, message: 'This token can see both decks. Make a token for one repository only.' }
  // Offline, rate-limited or a rejected token: no answer yet about the other repo, so no deck either.
  const failed = results.find((r) => !r.ok && r.kind !== 'not-found')
  if (failed && !failed.ok) return { ok: false, message: failed.message }
  if (seen.length === 1) return { ok: true, deck: seen[0] }
  return { ok: false, message: `This token can't see ${decks.map((d) => d.repo).join(' or ')}.` }
}

export type SetupChoice = { kind: 'same' } | { kind: 'switch' } | { kind: 'refuse'; message: string }

/**
 * Whether the token's deck may be used on this device. A device that already holds one deck's token or
 * events never takes the other's, so two histories never mix and nothing is deleted.
 */
export function setupChoice(open: DeckProfile, openHasData: boolean, tokenDeck: DeckProfile): SetupChoice {
  if (tokenDeck.id === open.id) return { kind: 'same' }
  if (!openHasData) return { kind: 'switch' }
  return {
    kind: 'refuse',
    message: `This token is for the ${tokenDeck.name} deck, but this device studies ${open.name}. Use a separate Chrome profile for ${tokenDeck.name}.`,
  }
}
