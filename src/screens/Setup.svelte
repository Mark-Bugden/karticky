<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { GITHUB_OWNER, GITHUB_REPO } from '../lib/config'

  let token = $state('')
  let error = $state<string | null>(null)
  let checking = $state(false)

  async function save(e: SubmitEvent) {
    e.preventDefault()
    const value = token.trim()
    if (!value || checking) return
    checking = true
    error = await app.saveToken(value)
    checking = false
  }
</script>

<main class="page">
  <h1>Kartičky</h1>
  <p>Your cards and progress are kept in your private GitHub repository <strong>{GITHUB_OWNER}/{GITHUB_REPO}</strong>.</p>
  <p>Paste this device's fine-grained token for it below. The token stays on this device.</p>

  <form onsubmit={save}>
    <label for="token">GitHub token</label>
    <input
      id="token"
      type="password"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      bind:value={token}
      disabled={checking}
    />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row">
      <button class="btn primary" type="submit" disabled={checking || !token.trim()}>{checking ? 'Checking…' : 'Save'}</button>
      {#if app.setupFromSettings}
        <button class="btn" type="button" onclick={() => app.cancelSetup()}>Cancel</button>
      {/if}
    </div>
  </form>
</main>

<style>
  h1 {
    font-size: 1.6rem;
    margin: 8px 0 16px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 24px;
  }
  label {
    font-weight: 600;
  }
  input {
    min-height: 48px;
    padding: 0 12px;
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .error {
    margin: 0;
    color: var(--warn);
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }
</style>
