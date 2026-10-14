<script lang="ts">
  import type { FormTable } from '../lib/types'

  let { tables }: { tables: FormTable[] } = $props()
</script>

{#each tables as t, i (i)}
  <section class="block">
    {#if t.title}<h3>{t.title}</h3>{/if}
    <div class="scroll">
      <!-- Heading and form pairs get a fixed heading width, so their forms line up from table to table. -->
      <table class:pairs={t.rows.every((row) => row.length === 2)}>
        {#if t.cols}
          <thead>
            <tr>
              {#each t.cols as c, j (j)}<th scope="col">{c}</th>{/each}
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
    </div>
    {#if t.note}<p class="note">{t.note}</p>{/if}
  </section>
{/each}

<style>
  .block + .block {
    margin-top: 18px;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--muted);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 1rem;
  }
  th,
  td {
    padding: 7px 10px 7px 0;
    text-align: left;
    vertical-align: top;
  }
  thead th {
    font-size: 0.85rem;
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
    width: 8.5em;
  }
  tbody tr + tr > * {
    border-top: 1px solid var(--border);
  }
  .note {
    margin: 8px 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
