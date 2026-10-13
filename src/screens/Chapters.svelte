<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { MISC_ID } from '../lib/chapters'
  import { chapterLabel, learnedPercent } from '../lib/format'
  import type { ChapterProgress } from '../lib/queue'

  const progressText = (p: ChapterProgress) =>
    p.introduced === 0 ? `${p.total} cards` : `${p.introduced}/${p.total} introduced · ${learnedPercent(p)}% learned`
</script>

<main class="page">
  <header>
    <button class="icon-btn" aria-label="Back to Home" onclick={() => app.go('home')}>←</button>
    <h1>Chapters</h1>
  </header>

  <p class="muted intro">
    New cards come from ticked chapters, in order. An unticked chapter is paused: its cards are not shown, and they keep
    their history. Applies on both devices.
  </p>

  {#if app.progress.length === 0}
    <p class="muted">No chapters yet.</p>
  {:else}
    <ul class="list">
      {#each app.progress as p (p.chapter.id)}
        <li>
          {#if p.chapter.id === MISC_ID}
            <div class="row">
              <input type="checkbox" checked disabled aria-label="Always studied" />
              <span class="text">
                <span>{chapterLabel(p.chapter)}</span>
                <span class="muted small">Always studied · {progressText(p)}</span>
              </span>
            </div>
          {:else}
            <label class="row">
              <input
                type="checkbox"
                checked={p.included}
                onchange={(e) => app.setIncluded(p.chapter.id, e.currentTarget.checked)}
              />
              <span class="text">
                <span>{chapterLabel(p.chapter)}</span>
                <span class="muted small">{progressText(p)}</span>
              </span>
            </label>
          {/if}
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
  }
  label.row {
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
