<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from './lib/app.svelte'
  import Chapters from './screens/Chapters.svelte'
  import Home from './screens/Home.svelte'
  import Settings from './screens/Settings.svelte'
  import Setup from './screens/Setup.svelte'
  import Study from './screens/Study.svelte'

  onMount(() => {
    void app.init()
  })
</script>

{#if app.fatal}
  <main class="page">
    <h1>Kartičky</h1>
    <p>{app.fatal}</p>
  </main>
{:else if app.screen === 'setup'}
  <Setup />
{:else if app.screen === 'home'}
  <Home />
{:else if app.screen === 'study'}
  <Study />
{:else if app.screen === 'settings'}
  <Settings />
{:else if app.screen === 'chapters'}
  <Chapters />
{/if}
