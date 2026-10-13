# Kartičky

A personal flashcard app for learning Czech vocabulary. It installs from Chrome, works with no
connection, and keeps two devices in step through a private GitHub repository.

- App: https://mark-bugden.github.io/karticky/
- Cards and progress: the private repository `mark-bugden/karticky-czech`
- Card file rules: [CARD_FORMAT.md](CARD_FORMAT.md)

## One-time setup

1. Create a public repository `karticky` under `mark-bugden`. In its Settings → Pages → Build and
   deployment, set Source to "GitHub Actions". *(Done 13 Oct 2026.)*
2. Create a private repository `karticky-czech`. Sync needs it to have at least one commit; adding a
   README or any file does that. *(Done 13 Oct 2026; the sample chapter was its first commit.)*
3. In `karticky-czech`, choose Add file → Create new file, name it `chapters/sample.json`, paste the
   contents of [sample/sample.json](sample/sample.json), and commit. *(Done 13 Oct 2026.)*
4. On each device, create a token on github.com: profile picture → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token.
   - Name: "Kartičky laptop" or "Kartičky phone".
   - Expiration: No expiration.
   - Repository access: Only select repositories → `karticky-czech`.
   - Permissions → Repository permissions → Contents: Read and write.

   One token per device means no secret moves between devices, and either can be revoked alone.
   Paste the token only into the app, never anywhere else.
5. Laptop: open https://mark-bugden.github.io/karticky/ in Chrome and click the install icon in the
   address bar (or ⋮ → Cast, save and share → Install page as app). Open the app and paste the token.
6. Phone: open the same address in Chrome, then ⋮ → Add to Home screen → Install. If nothing happens
   on a Xiaomi phone, allow it: Settings → Apps → Manage apps → Chrome → Other permissions → Home
   screen shortcuts → Allow. Open the app from the home screen and paste the token.
7. When the first real chapter is added, delete `chapters/sample.json` from `karticky-czech`. Its
   cards then disappear from the app.

**Keep every GitHub Pages site under `mark-bugden.github.io` free of third-party scripts** (analytics,
comment widgets, embeds). All those sites share one browser origin with this app, so any script on
any of them could read the token.

## Using the app

- **Reveal**: double-tap the card on the phone (a single tap does nothing); Space or double-click on
  the laptop.
- **Grade**: tap Again, Hard, Good or Easy; keys 1–4 on the laptop.
- **Undo** reverts the last grade and shows that card again. **⋯** on the card: Suspend this card,
  Flag the word for fixing, or Delete the word.
- New cards: 10 a day by default (Settings). Czech→English cards come first; their English→Czech
  cards arrive from the next day. A chapter starts once the previous one is fully introduced.
- Sync runs on its own (on opening, every 5 minutes, when the connection returns, and on leaving).
  "Not synced" means there are reviews on this device that haven't reached GitHub yet; studying
  always works offline.
- **App updates** take effect the next time the app starts from closed. On the phone, swipe it away
  from recent apps and reopen it; switching away and back is not enough.

## Cards and the summary for Claude

- Claude writes chapter files following [CARD_FORMAT.md](CARD_FORMAT.md) and they are committed to
  `karticky-czech/chapters/`. Problems with a file are listed in Settings → Chapter-file problems.
- Every sync also writes `summary/summary.json` to `karticky-czech`: each card's review history and
  state, totals per chapter and direction, and the flagged, deleted, removed, suspended and
  struggling lists. Settings → Download summary saves the same file as
  `karticky-summary-YYYY-MM-DD.json`. It holds dates only; `generatedAt` is the one timestamp.

## For developers

Svelte 5 + TypeScript, built with Vite, no SvelteKit. Requires Node 24.

```sh
npm ci            # install
npm run dev       # local dev server (http://localhost:5173/karticky/)
npm test          # unit tests (Vitest)
npm run check     # type checks
npm run build     # production build in dist/
npm run icons     # regenerate PNG icons from public/icon.svg
```

Pushing to `main` runs `.github/workflows/deploy.yml`: type checks, tests, build, then deploy to
GitHub Pages.

| Path | What it is |
| --- | --- |
| `src/lib/chapters.ts` | Chapter-file parser and validator, content hash |
| `src/lib/events.ts`, `src/lib/db.ts` | Event shape and the IndexedDB store (Dexie) |
| `src/lib/replay.ts` | Rebuilds card state from events (ts-fsrs) and caches it |
| `src/lib/queue.ts` | Queue rules, session order, streak, chapter progress (pure functions) |
| `src/lib/summary.ts` | The summary file |
| `src/lib/github.ts`, `src/lib/sync.ts` | GitHub Git Data API client and the sync protocol |
| `src/lib/engine.ts` | Data core without UI: load, record, replay, sync |
| `src/lib/app.svelte.ts` | App state for the screens: timers, sync triggers, study session |
| `src/screens/`, `src/components/` | Setup, Home, Study, Settings |
| `src/lib/testing/fakeGitHub.ts` | In-memory GitHub used by the sync tests |

Card state is never stored as truth: it is rebuilt by replaying the append-only event log. Each device
writes only its own log files (`log/<deviceId>/<UTC date>.jsonl`), so the only shared file is the
summary.

### Implementation choices and their reasons

- **Study day**: the day rolls over at 4 am on the local wall clock. The design says "local date of
  (time − 4 hours)", which differs only on daylight-saving change days, when it would roll over at
  3 am or 5 am. The wall clock keeps it at 4 am.
- **GitHub API version** pinned to `2026-03-10`, the newest on 13 Oct 2026. None of its breaking
  changes touch the endpoints used.
- **Retries**: after a 422 on the branch update, sync starts again up to three more times, waiting 2,
  4 and 8 seconds.
- **Summary for a device that never saw a removed word** (approved 13 Oct 2026): it fills in the
  word's chapter, Czech and English from the remote summary, so both devices write the same summary
  and an idle device never commits.
- **Flags on removed words count as lapsed**: a word in no chapter file has no current content to
  match the flag's hash. This also keeps both devices' summaries identical.
- **Content hash**: SHA-256 of the nine content fields joined with the U+001F separator, a missing
  field counting as empty; first 16 hex characters.
- **Replay cache**: the replayed state is saved in IndexedDB with a fingerprint (event count and last
  event id) and replayed again whenever the fingerprint no longer matches. Measured: 30,000 events
  replay in about 120 ms on the laptop.
- **New cards per day**: the stepper records one `setting` event after a short pause or on leaving
  Settings, not one per tap.
- **Chapter files over 500 KB** are reported in the summary and Settings but still load.
- **Misc does not gate chapters**: chapter gating looks only at chapters with a lower `order`.
- **Both directions due, neither seen today**: the one due earlier is shown; on a tie,
  Czech→English.
- **Navigation**: Study has a ✕ to return Home and Settings has a back arrow; the Android back
  gesture and Esc also return Home.
- **Several windows** of the app on one device (for example a browser tab and the installed app)
  share one database: syncs are serialised with a Web Lock, and a window reloads its state when it
  falls behind.
- **Content Security Policy** in the built page: scripts only from the app itself, network only to
  the app and `api.github.com`.

## Later

Ideas noted while building V1, not built:

- A keyboard shortcut for Undo on the laptop (for example U).
- Show how many reviews are waiting to sync next to "Not synced".
- Tune FSRS parameters to the review history once there is enough of it.
- A clearer settings icon (the system gear glyph varies by platform).
