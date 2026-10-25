<script lang="ts">
  import type { WordView } from '../lib/app.svelte'
  import { englishPrompt, partnerLine } from '../lib/format'
  import type { DeckProfile, Direction } from '../lib/types'

  let { word, deck, dir, revealed }: { word: WordView; deck: DeckProfile; dir: Direction; revealed: boolean } = $props()

  const gender = $derived(word.gender ? `g-${word.gender}` : '')
  const partner = $derived(word.term ? partnerLine({ term: word.term, aspect: word.aspect, partner: word.partner }) : null)
</script>

<div class="face">
  {#if dir === 'forward'}
    <p class="prompt term {gender}" lang={deck.lang}>{word.term}</p>
    {#if word.label}<p class="label">{word.label}</p>{/if}
  {:else}
    <p class="prompt en">{word.en ? englishPrompt({ en: word.en, aspect: word.aspect }) : ''}</p>
    {#if word.label}<p class="label">{word.label}</p>{/if}
    {#if word.hint}<p class="hint">{word.hint}</p>{/if}
  {/if}

  {#if revealed}
    <div class="answer">
      {#if dir === 'forward'}
        <p class="meaning">{word.en}</p>
      {:else}
        <p class="meaning term {gender}" lang={deck.lang}>{word.term}</p>
      {/if}
      {#if partner}<p class="partner" lang={deck.lang}>{partner}</p>{/if}
      {#if word.example}
        <p class="example" lang={deck.lang}>{word.example}</p>
        <p class="translation">{word.exampleEn}</p>
      {/if}
      {#if word.note}<p class="note">{word.note}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .face {
    text-align: center;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
  .prompt {
    font-size: clamp(2rem, 8vw, 2.75rem);
    font-weight: 650;
    line-height: 1.15;
  }
  .prompt.en {
    font-size: clamp(1.6rem, 6.5vw, 2.25rem);
  }
  .label {
    width: fit-content;
    margin: 10px auto 0;
    padding: 2px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .hint {
    margin-top: 6px;
    color: var(--muted);
    font-size: 1rem;
  }
  .answer {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .meaning {
    font-size: clamp(1.4rem, 5.5vw, 1.9rem);
    font-weight: 600;
  }
  .partner {
    font-size: 1.05rem;
  }
  .example {
    margin-top: 6px;
    font-size: 1.15rem;
  }
  .translation {
    color: var(--muted);
  }
  .note {
    font-size: 0.95rem;
    color: var(--muted);
    font-style: italic;
  }
  .g-m-anim {
    color: var(--g-m-anim);
  }
  .g-m-inanim {
    color: var(--g-m-inanim);
  }
  .g-f {
    color: var(--g-f);
  }
  .g-n {
    color: var(--g-n);
  }
</style>
