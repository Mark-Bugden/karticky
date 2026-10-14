# Chapter file format

Cards reach the app only as UTF-8 JSON chapter files in the `chapters/` folder of `karticky-czech`, one file per chapter. This section is the rulebook for whoever writes those files; copy it verbatim into `CARD_FORMAT.md`.

File names: `chapters/<order, 2 digits>-<slug>.json` (e.g. `chapters/01-greetings.json`), and `chapters/misc.json` for the misc chapter. Names are for humans; the app reads only the contents. A new chapter arrives unticked: the user ticks it in the app when they want to study it. The misc chapter is always studied.

| Top-level field | Required | Meaning |
| --- | --- | --- |
| `format` | Yes | Always `1` |
| `chapter.id` | Yes | Unique across files; lowercase letters, digits and hyphens. `misc` is reserved for the misc chapter. If two files share an id, the later file by file name is skipped and reported |
| `chapter.order` | Yes | Integer ≥ 1; ticked chapters are studied in ascending order; gaps allowed; equal orders are broken by `chapter.id`. Ignored for misc (write `0`) |
| `chapter.title` | Yes | Shown in stats |
| `words` | Yes | Array of words. New cards are introduced in a daily shuffled order, so array order does not matter |

| Word field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable and unique across all files; pattern `^[a-z0-9][a-z0-9-]*$`, e.g. `ch01-006` |
| `cz` | Yes | Czech word or phrase as shown; nouns in nominative singular, verbs in the infinitive |
| `en` | Yes | English meaning(s), comma-separated |
| `gender` | Nouns only | `m-anim`, `m-inanim`, `f` or `n` |
| `aspect` | Verbs only | `impf`, `pf` or `biasp` (biaspectual) |
| `partner` | Optional, verbs only | The aspect partner, e.g. `říct` for `říkat` |
| `hint` | Optional | Short disambiguation shown on the English→Czech prompt only, e.g. `furniture` |
| `label` | Optional | The word's form or register, shown under the word on both sides: a pronoun form's case, named in Czech (`akuzativ, genitiv`), `informal (ty)`, `formal (vy)`, `formal or plural`, `formal`, `informal`, `colloquial` |
| `example` | Yes | One Czech example sentence using the word |
| `exampleEn` | Yes | English translation of the example |
| `note` | Optional | One short line, e.g. an irregular form |
| `tables` | Optional | Conjugation or declension, shown on request wherever the Czech word is on screen; see below |

Rules:

1. Never change or reuse an `id`. Fixing a typo or translation keeps the id, and the card keeps its history.
2. If a fix changes what the card tests (a different word or meaning), give it a new id and remove the old entry.
3. Moving a word to another chapter keeps its id.
4. Removing a word from every file hides its cards and keeps their history. Re-adding the same id brings them back.
5. Each id appears once across all files. A duplicate is skipped (the later one in chapter order) and reported.
6. A word with `gender` is a noun and a word with `aspect` is a verb; a word may not have both, and `partner` requires `aspect`. Phrases and other words carry neither.
7. Unknown fields are ignored, so later versions can add fields.
8. Keep each file under 500 KB.
9. Deliver a file by committing it to `karticky-czech/chapters/`, or by giving it to the user to upload on github.com.
10. Changing any of a word's content fields clears a flag the user set on it, so fix flagged words by editing them in place. A flagged word's cards are hidden until then (or until the user unflags it).
11. Use `label` for what the learner must know on both sides (which case or register), and `hint` only to tell apart English prompts that would otherwise collide.

Tables: `tables` is a list of 1–6 tables, each `{ "title"?, "cols"?, "rows", "note"? }`. `rows` holds 1–24 rows of 2–6 strings; the first string of a row is its heading (a case, a person, "past"). `cols`, if given, are the column headings, the first one above the row headings (usually `""`), and every row has as many strings as `cols`. Keep a word's tables short enough to fit a phone screen without scrolling: about 12 rows in all. Conventions:

- Case names are Czech: `nominativ`, `genitiv`, `dativ`, `akuzativ`, `vokativ`, `lokál`, `instrumentál`. Other headings are English.
- Verbs: a table titled `Present` (`Future` for a perfective verb, `Present / future` for a biaspectual one) with rows `já`, `ty`, `on, ona, ono`, `my`, `vy`, `oni`. Where the future is not formed with budu (být, jít → půjdu), one untitled table with `cols` `["", "present", "future"]` instead. Then `Other forms` with rows `future` (budu + infinitive), `past` and `imperative`. Reflexive se/si and fixed words from the headword follow each form. " / " separates variants, the everyday one first (`pracuju / pracuji`).
- Nouns: `cols` `["", "singular", "plural"]` and the seven case rows; ", " separates variants. Noun phrases (matematicko-fyzikální fakulta) and names give the singular only, plural-only nouns the plural only.
- Adjectives and adjective-like pronouns and numerals: the singular only, one table with `cols` `["singular", "masculine", "feminine", "neuter"]` and no vocative row; "animate / inanimate" in the masculine column where they differ; a `Comparison` table only for an irregular comparative. The app colours the gender headings and, on a screen too narrow for the grid, lists each row's forms in column order instead.
- A pronoun form with its own card (mě) gets the table of the pronoun it comes from, titled with that pronoun (já).

A malformed `tables` field does not skip the word: the word loads without tables and the problem is reported.

```json
{ "id": "ce1-l01-066", "cz": "mě", "en": "me", "label": "akuzativ, genitiv",
  "example": "…", "exampleEn": "…",
  "tables": [{ "title": "já", "rows": [["nominativ", "já"], ["genitiv", "mě, mne"], ["dativ", "mně / mi"],
    ["akuzativ", "mě, mne"], ["lokál", "mně"], ["instrumentál", "mnou"]],
    "note": "After a slash: the short, unstressed form." }] }
```

App behaviour on bad input: a file that is not valid JSON or lacks a valid `format`/`chapter` is skipped whole; an invalid word is skipped alone; everything else loads. Every problem is listed in the summary's `fileErrors` and counted in Settings.

Sample chapter for testing (ship as `sample/sample.json` in the app repo; the user uploads it to `karticky-czech/chapters/sample.json` and deletes it once the first real chapter arrives):

```json
{
  "format": 1,
  "chapter": { "id": "sample", "order": 1, "title": "Sample" },
  "words": [
    { "id": "sample-001", "cz": "pes", "en": "dog", "gender": "m-anim",
      "example": "Náš pes je velký.", "exampleEn": "Our dog is big.",
      "note": "Genitive: psa (the e drops)." },
    { "id": "sample-002", "cz": "stůl", "en": "table", "gender": "m-inanim", "hint": "furniture",
      "example": "Kniha je na stole.", "exampleEn": "The book is on the table." },
    { "id": "sample-003", "cz": "kniha", "en": "book", "gender": "f",
      "example": "Čtu zajímavou knihu.", "exampleEn": "I am reading an interesting book." },
    { "id": "sample-004", "cz": "město", "en": "town, city", "gender": "n",
      "example": "Bydlím ve městě.", "exampleEn": "I live in the city." },
    { "id": "sample-005", "cz": "říkat", "en": "to say, to tell", "aspect": "impf", "partner": "říct",
      "example": "Co říkáš?", "exampleEn": "What are you saying?" },
    { "id": "sample-006", "cz": "koupit", "en": "to buy", "aspect": "pf", "partner": "kupovat",
      "example": "Zítra koupím mléko.", "exampleEn": "I will buy milk tomorrow." },
    { "id": "sample-007", "cz": "dobrý den", "en": "hello, good day",
      "example": "Dobrý den, jak se máte?", "exampleEn": "Hello, how are you?" },
    { "id": "sample-008", "cz": "děkuji", "en": "thank you",
      "example": "Děkuji za pomoc.", "exampleEn": "Thank you for the help." }
  ]
}
```
