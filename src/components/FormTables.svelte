<script lang="ts">
  import { tick } from 'svelte'
  import type { FormTable } from '../lib/types'

  let { tables }: { tables: FormTable[] } = $props()

  /** Column headings that name a gender are shown in the gender colours. */
  const GENDER_CLASS: Record<string, string> = { masculine: 'g-m-anim', feminine: 'g-f', neuter: 'g-n' }
  const genderClass = (heading: string | undefined) => (heading ? (GENDER_CLASS[heading] ?? '') : '')
  /** Between forms in a stacked row: a line may break after the dot, never before it. */
  const SEP = ' · '

  let root: HTMLElement
  /** Tables too wide for the screen are shown row by row, the forms of each row in column order. */
  let stacked = $state<boolean[]>([])

  async function fit() {
    stacked = tables.map(() => false)
    await tick()
    stacked = [...root.querySelectorAll<HTMLElement>('.scroll')].map((el) => el.scrollWidth > el.clientWidth + 1)
  }

  $effect(() => {
    void tables
    void fit()
    let width = root.clientWidth
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === width) return // only a change of width can change what fits
      width = root.clientWidth
      void fit()
    })
    observer.observe(root)
    return () => observer.disconnect()
  })
</script>

<div bind:this={root}>
  {#each tables as t, i (i)}
    <section class="block">
      {#if t.title}<h3>{t.title}</h3>{/if}
      <div class="scroll">
        {#if stacked[i] && t.cols}
          <table>
            <thead>
              <tr>
                <th scope="col">{t.cols[0]}</th>
                <th scope="col">
                  {#each t.cols.slice(1) as c, k (k)}{#if k > 0}<span class="sep">{SEP}</span>{/if}<span class={genderClass(c)}>{c}</span>{/each}
                </th>
              </tr>
            </thead>
            <tbody>
              {#each t.rows as row, j (j)}
                <tr>
                  <th scope="row">{row[0]}</th>
                  <td lang="cs">
                    {#each row.slice(1) as cell, k (k)}{#if k > 0}<span class="sep">{SEP}</span>{/if}<span class="form {genderClass(t.cols[k + 1])}">{cell}</span>{/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <!-- Heading and form pairs get a fixed heading width, so their forms line up from table to table. -->
          <table class:pairs={t.rows.every((row) => row.length === 2)}>
            {#if t.cols}
              <thead>
                <tr>
                  {#each t.cols as c, j (j)}<th scope="col" class={genderClass(c)}>{c}</th>{/each}
                </tr>
              </thead>
            {/if}
            <tbody>
              {#each t.rows as row, j (j)}
                <tr>
                  <th scope="row">{row[0]}</th>
                  {#each row.slice(1) as cell, k (k)}<td lang="cs">{cell}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      {#if t.note}<p class="note">{t.note}</p>{/if}
    </section>
  {/each}
</div>

<style>
  .block + .block {
    margin-top: 12px;
  }
  h3 {
    margin: 0 0 2px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--muted);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.95rem;
  }
  th,
  td {
    padding: 5px 8px 5px 0;
    text-align: left;
    vertical-align: top;
  }
  thead th {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  tbody th {
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
  }
  .pairs tbody th {
    width: 8em;
  }
  tbody tr + tr > * {
    border-top: 1px solid var(--border);
  }
  .sep {
    color: var(--muted);
  }
  .note {
    margin: 6px 0 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  thead .g-m-anim,
  .form.g-m-anim {
    color: var(--g-m-anim);
  }
  thead .g-f,
  .form.g-f {
    color: var(--g-f);
  }
  thead .g-n,
  .form.g-n {
    color: var(--g-n);
  }
</style>
