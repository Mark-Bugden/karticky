# Kartičky

A personal flashcard app for learning vocabulary, with two decks: Czech and Spanish, each studied
against English. It installs from Chrome, works with no connection, and keeps a learner's devices in
step through a private GitHub repository, one per deck.

- App: https://mark-bugden.github.io/karticky/
- Cards and progress: the private repositories `mark-bugden/karticky-czech` and
  `mark-bugden/karticky-spanish`
- Card file rules: [CARD_FORMAT.md](CARD_FORMAT.md)

Each device studies one deck, chosen by its token: a fine-grained token sees only its own deck's
repository. To study both decks on one computer, use a separate Chrome profile for each.

## One-time setup

1. Create a public repository `karticky` under `mark-bugden`. In its Settings → Pages → Build and
   deployment, set Source to "GitHub Actions". *(Done 13 Oct 2026.)*
2. Create a private repository `karticky-czech`. Sync needs it to have at least one commit; adding a
   README or any file does that. *(Done 13 Oct 2026; the sample chapter was its first commit.)*
3. In `karticky-czech`, choose Add file → Create new file, name it `chapters/sample.json`, paste the
   contents of [sample/sample.json](sample/sample.json), and commit. *(Done 13 Oct 2026.)*
4. On each device, create a fine-grained token on github.com:
   1. Click your profile picture (top right), then **Settings**.
   2. In the left sidebar, click **Developer settings**.
   3. In the left sidebar, under **Personal access tokens**, click **Fine-grained tokens**.
   4. Click **Generate new token**.
   5. **Token name**: "Kartičky computer" or "Kartičky phone".
   6. **Expiration**: No expiration.
   7. **Resource owner**: Mark-Bugden.
   8. **Repository access**: Only select repositories, then pick `karticky-czech`.
   9. **Permissions**: use the search box to add **Contents** and set it to **Read and write**.
      GitHub adds Metadata: Read by itself.
   10. Click **Generate token** and copy the token.

   One token per device means no secret moves between devices, and either can be revoked alone.
   Paste the token only into the app, never anywhere else.
5. Computer: open https://mark-bugden.github.io/karticky/ in Chrome and click the install icon in the
   address bar (or ⋮ → Cast, save and share → Install page as app). Open the app and paste the token.
6. Phone: open the same address in Chrome and open the ⋮ menu. Choose **Install**, not "Create
   shortcut" (a shortcut only opens a Chrome tab). If no icon appears on a Xiaomi phone, allow it:
   Settings → Apps → Manage apps → Chrome → Other permissions → Home screen shortcuts → Allow.
   Open the app from the home screen and paste the phone token. If you created that token on the
   computer, don't send it to the phone: on the phone, open the token on github.com, choose
   **Regenerate token** and copy the new value there.
7. When the first real chapter is added, delete `chapters/sample.json` from `karticky-czech`. Its
   cards then disappear from the app.

**Keep every GitHub Pages site under `mark-bugden.github.io` free of third-party scripts** (analytics,
comment widgets, embeds). All those sites share one browser origin with this app, so any script on
any of them could read the tokens of either deck.

### The Spanish deck

1. Create a private repository `karticky-spanish` under `mark-bugden` and tick "Add a README file".
   *(Done 25 Oct 2026.)*
2. In `karticky-spanish`, choose Add file → Create new file, name it `chapters/sample.json`, paste
   the contents of [sample/sample-es.json](sample/sample-es.json), and commit. Skip this if the real
   chapters are already there.
3. For each Spanish device, create a fine-grained token as in step 4 above, with two differences:
   name it "Kartičky Spanish laptop" or "Kartičky Spanish phone", and under **Repository access**
   pick only `karticky-spanish`. A token that can see both repositories is refused.
4. Create each token on the device it is for: sign in to github.com there, generate the token, paste
   it into the app, then sign out of GitHub on that device. No token travels between devices.
5. Laptop: open https://mark-bugden.github.io/karticky/ in Chrome, install it from the address bar,
   open it and paste the token. The app sees which deck the token is for.
6. Phone: open the same address in Chrome, choose ⋮ → **Install** (not "Create shortcut"), open it
   from the home screen and paste the token. If no icon appears, allow home-screen shortcuts as in
   step 6 above.
7. When the first real chapter arrives, delete `chapters/sample.json` from `karticky-spanish`.

A device that already studies one deck refuses a token for the other and asks for a separate Chrome
profile, so two decks' histories never mix and nothing is deleted.

## Using the app

- **Reveal**: tap the card or swipe sideways across it on the phone; Space or double-click on the
  computer. A sideways swipe (Space on the computer) also turns a revealed card back.
- **Pull down to refresh** works only on Home, so a downward drag never reloads the app mid-session.
- **Labels**: a grey tag under the word gives its form or register, on both sides of the card: the
  case of a pronoun form (mě: akuzativ, genitiv), formal (vy) or informal (ty), formal or
  colloquial.
- **Conjugation / Declension**: wherever the Czech word is on screen (a Czech→English card, or an
  English→Czech card once revealed), the button at the top left of the card shows the verb's
  conjugation or the declension of a noun, adjective or pronoun, sized to fit the screen without
  scrolling: cases named in Czech, adjectives and noun phrases in the singular only. On a narrow
  screen a long adjective lists each case's forms in the gender colours instead of a grid. Tap
  anywhere to close it.
- **Gender colours** (as in Czech Express): light blue masculine animate, dark purple-blue masculine
  inanimate, red feminine, green neuter.
- **Spanish deck**: the button reads Conjugation for a verb and Forms for an adjective or pronoun;
  masculine nouns are blue and feminine nouns red (the Czech masculine-animate blue and feminine
  red). A noun with one form for both sexes (el/la estudiante) is in the normal text colour.
- **Grade**: tap Again, Hard, Good or Easy; keys 1–4 on the computer.
- **Undo** reverts the last grade and shows that card again. **⋯** on the card: Suspend this card,
  Flag the word for fixing, or Delete the word. A flagged word is hidden on both devices until Claude
  fixes it; Settings → Flagged words lists them, with Unflag to study one as it is.
- **Chapters**: tick the chapters to study under Home → Choose (or Settings → Choose chapters), for
  example when you've done a lesson in class. New chapter files arrive unticked. An unticked chapter
  is paused: none of its cards are shown, and they keep their history for when it is ticked again.
- **Moving on**: once every ticked chapter is fully introduced and 80% of its cards are learned
  (remembered after a gap, so the scheduler is confident for 7+ days), Home suggests the next
  chapter, with one tap to add it.
- New cards: 10 a day by default (Settings), mixed over the ticked chapters: about half from the
  lowest ticked chapter that still has new cards, the rest from the others in turn. Within a chapter
  the order is shuffled afresh each day (the same on both devices). Czech→English cards come first;
  a word's English→Czech card arrives from the next day, ahead of new words from its chapter. Once
  you're done for the day, **Learn 10 more** adds ten more new cards.
- **Practise** (Home): go over the words you've already started in the chapters you pick, in random
  order, whenever you like. Missed cards come back a few cards later until you get them; the end shows
  how many you got right first time. Answers count as ordinary reviews: the scheduler gives little
  credit for a word you saw recently, so extra practice never inflates the schedule, while a miss
  counts in full.
- Sync runs on its own (on opening, every 5 minutes, when the connection returns, and on leaving).
  "Not synced" means there are reviews on this device that haven't reached GitHub yet; studying
  always works offline.
- **App updates** take effect the next time the app starts from closed. On the phone, swipe it away
  from recent apps and reopen it; switching away and back is not enough.

## Cards and the summary for Claude

- Claude writes chapter files following [CARD_FORMAT.md](CARD_FORMAT.md) and they are committed to
  the deck's repo, in `chapters/`. Problems with a file are listed in Settings → Chapter-file
  problems.
- The conjugation and declension tables come from Wiktionary, checked by proofreading; the scripts
  that build them are in each data repo's `tools/`.
- Every sync also writes `summary/summary.json` to the deck's repo: each card's review history and
  state, totals per chapter and direction, and the flagged, deleted, removed, suspended and
  struggling lists. The word column and the direction keys are named by the deck (`cz`, `cz-en`,
  `en-cz`; `es`, `es-en`, `en-es`). Settings → Download summary saves the same file as
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
| `src/lib/config.ts` | Fixed values, including the two decks' profiles |
| `src/lib/decks.ts` | Which deck a device studies: the stored choice and Setup's token check |
| `src/lib/chapters.ts` | Chapter-file parser and validator, content hash |
| `src/lib/events.ts`, `src/lib/db.ts` | Event shape and the IndexedDB store (Dexie) |
| `src/lib/replay.ts` | Rebuilds card state from events (ts-fsrs) and caches it |
| `src/lib/queue.ts` | Queue rules, session order, streak, chapter progress and the next-chapter suggestion (pure functions) |
| `src/lib/summary.ts` | The summary file |
| `src/lib/github.ts`, `src/lib/sync.ts` | GitHub Git Data API client and the sync protocol |
| `src/lib/engine.ts` | Data core without UI: load, record, replay, sync |
| `src/lib/app.svelte.ts` | App state for the screens: timers, sync triggers, study session |
| `src/screens/`, `src/components/` | Setup, Home, Study (also runs practice), Settings, Chapters, Practise; the card face and the conjugation/declension tables |
| `src/lib/testing/fakeGitHub.ts` | In-memory GitHub used by the sync tests, serving either data repo |

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
  field counting as empty; first 16 hex characters. Fields added later (`label`, `tables`) join the
  hash only when a word has them, so adding them leaves every other word's hash, and any flag on it,
  unchanged.
- **Flags hide the word** like a suspended card, in study, practice, the streak and the chapter
  totals, until its content changes (the flag lapses) or it is unflagged in Settings.
- **Daily shuffle**: within a chapter, new cards are ordered by a hash of the study day and card id,
  so the order is new each day, the same on both devices, and stable however often the queue is
  rebuilt. English→Czech cards of words already started go ahead of new words.
- **Swipe to turn over**: the card and its scrolling content use `touch-action: pan-y pinch-zoom`, so
  vertical drags scroll and sideways drags reach the app as swipes (at least 60 px, mostly sideways).
- **Pull-to-refresh** is switched off outside Home with `overscroll-behavior-y: none` on the page,
  set by a class on `<html>` that follows the current screen.
- **Deck profiles**: everything that differs between decks (repo, language, genders, aspect, database)
  is in a profile in `src/lib/config.ts`. Inside the app a card's direction is forward or reverse;
  only card ids, log files and the summary use the deck's code (`cz-en`, `en-cz`). A card's direction
  and its sibling are read from the shape of its id, so only building a card id and checking another
  device's events need the profile.
- **Deck choice**: Setup asks GitHub about both data repos and takes the token's deck only when the
  token sees exactly one. If one repo answers and the other cannot be asked (offline, rate limit),
  Setup shows that problem and chooses nothing, since the token might see both. The deck is kept in
  `localStorage` (`karticky-deck`); a missing value means Czech. Chrome lists the expected 404 for
  the other repo in the console.
- **Replay cache**: the replayed state is saved in IndexedDB with a fingerprint (event count and last
  event id) and a format version, and replayed again whenever either no longer matches. Measured: 30,000 events
  replay in about 120 ms on the development computer.
- **New cards per day**: the stepper records one `setting` event after a short pause or on leaving
  Settings, not one per tap.
- **Chapter files over 500 KB** are reported in the summary and Settings but still load.
- **New-card mix**: misc first, then ticked chapters mixed so that the lowest one with new cards
  left gets about half. Cards introduced earlier today (on any device known here) count towards the
  mix, so it holds however often the queue is rebuilt. Misc is always studied and has no tick box.
- **Ticks are `setting` events** with key `include:<chapter id>` and value 1 or 0, so a device still
  on an older version keeps them in its database instead of dropping them.
- **Both directions due, neither seen today**: the one due earlier is shown; on a tie,
  Czech→English.
- **Navigation**: Study has a ✕ to return Home and Settings, Chapters and Practise have a back arrow; the Android back
  gesture and Esc also return Home.
- **Several windows** of the app on one device (for example a browser tab and the installed app)
  share one database: syncs are serialised with a Web Lock, and a window reloads its state when it
  falls behind.
- **Gender colours** come from the publisher's Čeština expres 3 vocabulary list (`#00aeef`,
  `#24408f`, `#d2232a`, `#40ad49`). Printed on paper they are fine, but on screen some fall below
  4.5:1 contrast: light theme darkens the light blue to `#0177a5` and the green to `#04811f`; dark theme
  lightens the dark blue to `#6588de` and the red to `#f84d4a`. Hue is kept; only lightness changes.
- **Dark manifest colours**: Chrome on Android colours an installed app's bottom navigation bar
  from the manifest, which has no dark variant, so a light value left a white bar under the dark
  theme. `theme_color` and `background_color` are therefore dark (`#14171b`); in light mode the bar
  is dark too. The page's `theme-color` meta still sets the top bar.
- **Content Security Policy** in the built page: scripts only from the app itself, network only to
  the app and `api.github.com`.

## Later

Ideas noted while building V1, not built:

- A keyboard shortcut for Undo on the computer (for example U).
- Show how many reviews are waiting to sync next to "Not synced".
- Tune FSRS parameters to the review history once there is enough of it.
- A clearer settings icon (the system gear glyph varies by platform).
- An animation for turning a card over (the user plans one).

Left out of the Spanish deck, not built:

- Two decks on one device, or switching decks in the app; a separate Chrome profile serves instead.
- Cards against Czech, or menus in a language other than English.
