<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { app } from '../lib/app.svelte'
  import { chapterLabel } from '../lib/format'

  // The last choice is a per-device convenience, so it lives in localStorage.
  const STORAGE_KEY = 'karticky:practice-chapters'

  function remembered(): string[] {
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
      return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  const available = $derived(app.progress.filter((p) => p.introduced > 0))
  const chosen = new SvelteSet<string>(remembered())
  const picked = $derived(available.filter((p) => chosen.has(p.chapter.id)))
  const count = $derived(picked.reduce((n, p) => n + p.introduced, 0))

  function start() {
    const ids = picked.map((p) => p.chapter.id)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    } catch {
      // Not remembered this time; practice still starts.
    }
    app.startPractice(ids)
  }
</script>

<main class="page">
  <header>
    <button class="icon-btn" aria-label="Back to Home" onclick={() => app.go('home')}>←</button>
    <h1>Practise</h1>
  </header>

  <p class="muted intro">
    Go over words you've already started, in random order. Answers count as reviews, but a word you saw recently earns
    little, so practise as much as you like. Words you miss come back until you get them.
  </p>

  {#if available.length === 0}
    <p class="muted">Nothing to practise yet. Words appear here once daily study has introduced them.</p>
  {:else}
    <button class="btn primary start" disabled={count === 0} onclick={start}>
      {count === 0 ? 'Choose chapters below' : `Practise ${count} ${count === 1 ? 'card' : 'cards'}`}
    </button>

    <ul class="list">
      {#each available as p (p.chapter.id)}
        <li>
          <label class="row">
            <input
              type="checkbox"
              checked={chosen.has(p.chapter.id)}
              onchange={(e) => (e.currentTarget.checked ? chosen.add(p.chapter.id) : chosen.delete(p.chapter.id))}
            />
            <span class="text">
              <span>{chapterLabel(p.chapter)}</span>
              <span class="muted small">{p.introduced} {p.introduced === 1 ? 'card' : 'cards'} started{p.included ? '' : ' · paused'}</span>
            </span>
          </label>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .intro {
    margin: 12px 0 20px;
  }
  .start {
    width: 100%;
    margin-bottom: 16px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 56px;
    padding: 10px 16px;
    cursor: pointer;
  }
  input {
    flex: none;
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: var(--accent);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: 0.85rem;
  }
</style>
