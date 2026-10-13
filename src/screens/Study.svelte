<script lang="ts">
  import CardFace from '../components/CardFace.svelte'
  import { app } from '../lib/app.svelte'
  import { LEARN_MORE_COUNT } from '../lib/config'
  import type { Grade } from '../lib/types'

  const GRADES: { r: Grade; label: string }[] = [
    { r: 1, label: 'Again' },
    { r: 2, label: 'Hard' },
    { r: 3, label: 'Good' },
    { r: 4, label: 'Easy' },
  ]
  const touch = matchMedia('(pointer: coarse)').matches

  let menuOpen = $state(false)
  let confirmDelete = $state(false)
  let lastPointer = 'mouse'
  let down: { x: number; y: number } | null = null

  const s = $derived(app.study)

  function onPointerDown(e: PointerEvent) {
    lastPointer = e.pointerType
    down = { x: e.clientX, y: e.clientY }
  }

  // On a touch screen one tap on the card reveals it. Mouse users press Space or double-click.
  function onPointerUp(e: PointerEvent) {
    const start = down
    down = null
    if (e.pointerType === 'mouse' || !start || menuOpen) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return // a scroll, not a tap
    if ((e.target as Element).closest('button, .menu')) return
    app.reveal()
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (menuOpen || confirmDelete) {
      if (e.key === 'Escape') menuOpen = confirmDelete = false
      return
    }
    if (e.key === ' ') {
      e.preventDefault()
      ;(document.activeElement as HTMLElement | null)?.blur()
      if (!e.repeat) app.reveal()
    } else if (['1', '2', '3', '4'].includes(e.key) && !e.repeat) {
      void app.grade(Number(e.key) as Grade)
    } else if (e.key === 'Escape') {
      app.go('home')
    }
  }

  function grade(e: MouseEvent, r: Grade) {
    ;(e.currentTarget as HTMLElement).blur()
    void app.grade(r)
  }

  async function act(action: () => Promise<void>) {
    menuOpen = false
    await action()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="study">
  <header>
    <button class="icon-btn" aria-label="Back to Home" onclick={() => app.go('home')}>✕</button>
    <span class="count">
      {#if s?.practice}Practice · {s.practice.queue.length} left{:else}{app.status.due} due · {app.status.newAvailable} new{/if}
    </span>
    <span class="right">
      {#if app.notSynced}<span class="badge">Not synced</span>{/if}
      {#if app.lastGrade}
        <button class="btn small" onclick={(e) => ((e.currentTarget as HTMLElement).blur(), app.undo())}>Undo</button>
      {/if}
    </span>
  </header>

  {#if s?.view === 'card' && s.word && s.dir}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
      class="card"
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
      ondblclick={() => lastPointer === 'mouse' && app.reveal()}
    >
      <div class="card-top">
        {#if app.currentFlagged}<span class="flag" title="Flagged for Claude to fix">⚑ Flagged</span>{/if}
        <button
          class="icon-btn menu-btn"
          aria-label="Card actions"
          aria-expanded={menuOpen}
          onpointerup={(e) => e.stopPropagation()}
          onclick={() => (menuOpen = !menuOpen)}>⋯</button
        >
      </div>
      <div class="content">
        <CardFace word={s.word} dir={s.dir} revealed={s.revealed} />
      </div>
      {#if menuOpen}
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => act(() => app.suspendCurrent())}>Suspend this card</button>
          <button role="menuitem" onclick={() => act(() => app.toggleFlagCurrent())}>
            {app.currentFlagged ? 'Unflag word' : 'Flag word for fixing'}
          </button>
          <button role="menuitem" class="danger" onclick={() => ((menuOpen = false), (confirmDelete = true))}>Delete word…</button>
        </div>
      {/if}
    </section>

    <footer>
      {#if s.revealed}
        <div class="grades">
          {#each GRADES as g (g.r)}
            <button class="grade" onclick={(e) => grade(e, g.r)}>{g.label}</button>
          {/each}
        </div>
      {:else}
        <p class="reveal-hint">{touch ? 'Tap to reveal' : 'Space to reveal'}</p>
      {/if}
    </footer>
  {:else if s?.view === 'wait'}
    <div class="center">
      <p class="big">Next card in {app.waitMinutes} min</p>
      <button class="btn" onclick={() => app.go('home')}>Home</button>
    </div>
  {:else if s?.view === 'done' && s.practice}
    {@const p = s.practice}
    <div class="center">
      <p class="big">Practice done</p>
      <p class="muted score">{p.firstTry} of {p.total} right first time</p>
      <button class="btn primary" onclick={() => app.startPractice(p.chapterIds)}>Practise again</button>
      <button class="btn" onclick={() => app.go('home')}>Home</button>
    </div>
  {:else if s?.view === 'done'}
    <div class="center">
      <p class="big">Done for today</p>
      {#if app.status.canLearnMore}
        <button class="btn primary" onclick={() => app.learnMore()}>Learn {LEARN_MORE_COUNT} more</button>
      {/if}
      <button class="btn" onclick={() => app.go('home')}>Home</button>
    </div>
  {/if}

  {#if menuOpen}
    <button class="backdrop" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
  {/if}

  {#if confirmDelete}
    <div class="modal-backdrop">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
        <p id="delete-title">Hide this word for good? It will be flagged for removal.</p>
        <div class="modal-actions">
          <button class="btn" onclick={() => (confirmDelete = false)}>Cancel</button>
          <button
            class="btn primary"
            onclick={async () => {
              confirmDelete = false
              await app.deleteCurrentWord()
            }}>Hide word</button
          >
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .study {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    min-height: 52px;
  }
  .count {
    flex: 1;
    color: var(--muted);
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin: 0 12px;
    padding: 8px 16px 24px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-height: 44px;
  }
  .flag {
    margin-right: auto;
    color: var(--warn);
    font-size: 0.9rem;
    font-weight: 600;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .content > :global(.face) {
    margin: auto 0;
    padding: 8px 0;
  }
  .menu {
    position: absolute;
    top: 48px;
    right: 12px;
    z-index: 3;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.18);
  }
  .menu button {
    min-height: 48px;
    padding: 0 14px;
    border: none;
    border-radius: 10px;
    background: none;
    text-align: left;
  }
  .menu button:hover {
    background: var(--bg);
  }
  .menu .danger {
    color: var(--danger);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2;
    border: none;
    background: transparent;
    cursor: default;
  }
  footer {
    padding: 12px;
  }
  .reveal-hint {
    margin: 0;
    min-height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .grades {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .grade {
    min-height: 56px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    font-weight: 600;
  }
  .grade:active {
    background: var(--bg);
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
  }
  .big {
    margin: 0 0 8px;
    font-size: 1.5rem;
    font-weight: 600;
  }
  .score {
    margin: -12px 0 8px;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.45);
  }
  .modal {
    width: 100%;
    max-width: 380px;
    padding: 20px;
    background: var(--surface);
    border-radius: 16px;
  }
  .modal p {
    margin: 0 0 18px;
    font-size: 1.05rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
