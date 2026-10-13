<script lang="ts">
  import { app } from '../lib/app.svelte'

  const line = $derived(app.syncLine)
</script>

<p class="sync" class:warn={line.tone === 'warn'}>
  {#if app.notSynced}<span class="badge">Not synced</span>{/if}
  {#if line.setup}
    <button class="link" onclick={() => app.replaceToken()}>{line.text}</button>
  {:else}
    <span>{line.text}</span>
  {/if}
</p>

<style>
  .sync {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 4px 0 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .warn {
    color: var(--warn);
  }
  .warn .link {
    color: var(--warn);
  }
</style>
