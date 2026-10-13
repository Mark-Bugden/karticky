<script lang="ts">
  import SyncLine from '../components/SyncLine.svelte'
  import { app } from '../lib/app.svelte'
  import { MISC_ID } from '../lib/chapters'

  const st = $derived(app.status)
</script>

<main class="page">
  <header>
    <h1>Kartičky</h1>
    <button class="icon-btn" aria-label="Settings" onclick={() => app.go('settings')}>⚙</button>
  </header>

  <SyncLine />

  {#if app.set.chapters.length === 0}
    <section class="empty">
      {#if app.sync.running}
        <p>Loading cards…</p>
      {:else if app.hasToken && app.sync.lastSyncAt}
        <p>No chapter files yet. Cards arrive as files in the <code>chapters/</code> folder of the data repository.</p>
      {:else}
        <p>Cards will appear after the first sync.</p>
      {/if}
    </section>
  {:else}
    <section class="today">
      <div class="stat">
        <span class="num">{st.due}</span>
        <span class="label">due now</span>
      </div>
      <div class="stat">
        <span class="num">{st.newAvailable}</span>
        <span class="label">new today</span>
      </div>
    </section>

    <section class="actions">
      {#if st.done}
        <p class="done">Done for today</p>
        {#if st.canLearnMore}
          <button class="btn" onclick={() => app.learnMore()}>Learn 5 more</button>
        {/if}
      {:else}
        <button class="btn primary study" onclick={() => app.startStudy()}>Study</button>
      {/if}
    </section>

    <p class="streak">Streak: {app.streakDays} {app.streakDays === 1 ? 'day' : 'days'}</p>

    <section>
      <h2>Chapters</h2>
      <ul class="chapters">
        {#each app.progress as p (p.chapter.id)}
          <li>
            <span>{p.chapter.id === MISC_ID ? p.chapter.title : `${p.chapter.order} · ${p.chapter.title}`}</span>
            <span class="muted">{p.introduced}/{p.total}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  h2 {
    font-size: 1rem;
    color: var(--muted);
    font-weight: 600;
    margin: 28px 0 8px;
  }
  .empty {
    margin-top: 32px;
    color: var(--muted);
  }
  .today {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 20px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .num {
    font-size: 2.2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .label {
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
  }
  .study {
    min-height: 60px;
    font-size: 1.15rem;
  }
  .done {
    margin: 8px 0 0;
    font-size: 1.25rem;
    font-weight: 600;
    text-align: center;
  }
  .streak {
    margin: 20px 0 0;
    font-weight: 550;
  }
  .chapters {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .chapters li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    font-variant-numeric: tabular-nums;
  }
  .chapters li + li {
    border-top: 1px solid var(--border);
  }
</style>
