<script lang="ts">
  import SyncLine from '../components/SyncLine.svelte'
  import { app } from '../lib/app.svelte'
  import { MISC_ID } from '../lib/chapters'
  import { NEW_PER_DAY_MAX, NEW_PER_DAY_MIN } from '../lib/config'
  import { directionLabel } from '../lib/format'

  const errors = $derived(app.set.errors)
</script>

<main class="page">
  <header>
    <button class="icon-btn" aria-label="Back to Home" onclick={() => app.go('home')}>←</button>
    <h1>Settings</h1>
  </header>

  <section>
    <h2>New cards per day</h2>
    <div class="stepper">
      <button class="btn" aria-label="Fewer" disabled={app.newPerDay <= NEW_PER_DAY_MIN} onclick={() => app.stepNewPerDay(-1)}>−</button>
      <span class="value" aria-live="polite">{app.newPerDay}</span>
      <button class="btn" aria-label="More" disabled={app.newPerDay >= NEW_PER_DAY_MAX} onclick={() => app.stepNewPerDay(1)}>+</button>
    </div>
    <p class="muted small">Applies on both devices.</p>
  </section>

  <section>
    <h2>Chapters</h2>
    <p class="muted small">{app.ticked.length} of {app.progress.filter((p) => p.chapter.id !== MISC_ID).length} ticked.</p>
    <button class="btn" onclick={() => app.go('chapters')}>Choose chapters</button>
  </section>

  <section>
    <h2>Suspended cards</h2>
    {#if app.suspended.length === 0}
      <p class="muted">None.</p>
    {:else}
      <ul class="list">
        {#each app.suspended as item (item.card)}
          <li>
            <span><span lang="cs">{item.cz}</span> <span class="muted small">{directionLabel(item.dir)}</span></span>
            <button class="btn small" onclick={() => app.restore(item.card)}>Restore</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>Flagged words</h2>
    {#if app.flagged.length === 0}
      <p class="muted">None.</p>
    {:else}
      <p class="muted small">Hidden until Claude fixes them. Unflag a word to study it as it is.</p>
      <ul class="list">
        {#each app.flagged as item (item.wordId)}
          <li>
            <span lang="cs">{item.cz}</span>
            <button class="btn small" onclick={() => app.unflag(item.wordId)}>Unflag</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>Sync</h2>
    <SyncLine />
    <p class="muted small">
      Last successful sync: {app.sync.lastSyncAt ? app.sync.lastSyncAt.toLocaleString() : 'never'}
    </p>
    <div class="row">
      <button class="btn" disabled={!app.hasToken || app.sync.running} onclick={() => app.triggerSync()}>
        {app.sync.running ? 'Syncing…' : 'Sync now'}
      </button>
      <button class="btn" onclick={() => app.replaceToken()}>Replace token</button>
    </div>
  </section>

  <section>
    <h2>Summary for Claude</h2>
    <button class="btn" onclick={() => app.downloadSummary()}>Download summary</button>
  </section>

  <section>
    <h2>Chapter-file problems</h2>
    {#if errors.length === 0}
      <p class="muted">None.</p>
    {:else}
      <p>{errors.length} {errors.length === 1 ? 'problem' : 'problems'}</p>
      <ul class="list problems">
        {#each errors as e, i (i)}
          <li>
            <span>
              <code>{e.file}</code>{#if e.wordId}&nbsp;· <code>{e.wordId}</code>{/if}<br />
              <span class="muted small">{e.problem}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <p class="version muted small">Version {__BUILD_DATE__} · {__BUILD_COMMIT__}</p>
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
  h2 {
    font-size: 1rem;
    margin: 28px 0 10px;
  }
  .small {
    font-size: 0.85rem;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .stepper .btn {
    width: 56px;
    font-size: 1.4rem;
  }
  .value {
    min-width: 2.5ch;
    text-align: center;
    font-size: 1.5rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .problems li {
    align-items: flex-start;
  }
  code {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .version {
    margin-top: 36px;
  }
</style>
