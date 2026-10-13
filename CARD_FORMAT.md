# Chapter file format

Cards reach the app only as UTF-8 JSON chapter files in the `chapters/` folder of `karticky-czech`, one file per chapter. This section is the rulebook for whoever writes those files; copy it verbatim into `CARD_FORMAT.md`.

File names: `chapters/<order, 2 digits>-<slug>.json` (e.g. `chapters/01-greetings.json`), and `chapters/misc.json` for the misc chapter. Names are for humans; the app reads only the contents. A new chapter arrives unticked: the user ticks it in the app when they want to study it. The misc chapter is always studied.

| Top-level field | Required | Meaning |
| --- | --- | --- |
| `format` | Yes | Always `1` |
| `chapter.id` | Yes | Unique across files; lowercase letters, digits and hyphens. `misc` is reserved for the misc chapter. If two files share an id, the later file by file name is skipped and reported |
| `chapter.order` | Yes | Integer ≥ 1; ticked chapters are studied in ascending order; gaps allowed; equal orders are broken by `chapter.id`. Ignored for misc (write `0`) |
| `chapter.title` | Yes | Shown in stats |
| `words` | Yes | Array of words; array order is introduction order |

| Word field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable and unique across all files; pattern `^[a-z0-9][a-z0-9-]*$`, e.g. `ch01-006` |
| `cz` | Yes | Czech word or phrase as shown; nouns in nominative singular, verbs in the infinitive |
| `en` | Yes | English meaning(s), comma-separated |
| `gender` | Nouns only | `m-anim`, `m-inanim`, `f` or `n` |
| `aspect` | Verbs only | `impf`, `pf` or `biasp` (biaspectual) |
| `partner` | Optional, verbs only | The aspect partner, e.g. `říct` for `říkat` |
| `hint` | Optional | Short disambiguation shown on the English→Czech prompt, e.g. `furniture` |
| `example` | Yes | One Czech example sentence using the word |
| `exampleEn` | Yes | English translation of the example |
| `note` | Optional | One short line, e.g. an irregular form |

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
10. Changing any of a word's content fields clears a flag the user set on it, so fix flagged words by editing them in place.

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
