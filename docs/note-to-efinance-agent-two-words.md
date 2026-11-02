# Two en.json words to check — 02/11/2026

Two new Greek keys from the ΤΑΕΠ ICD-10 rebuild, for checking against
`translations/en.json` before they are merged.

| Greek | Our English | Where it shows |
|---|---|---|
| Καθαρισμός | Clear | the button that empties the diagnosis search box |
| αποτελέσματα | results | the count shown under that box |

Why a grep rather than a straight merge: `en.json` is one global dictionary keyed on the
Greek string, and three collisions have already been found this way — «Κωδικός» means
Password there, «Εισαγωγή» means Import, and «Γραμμή» means Row in the board pack rather
than an invoice line. All three were caught before merging and lengthened on the ΤΑΕΠ
side rather than overwriting yours.

**«Καθαρισμός» is the one to look at.** If eFinance already uses it for clearing a filter
or a form, the meaning is the same and nothing needs doing. If it means something
narrower there, say so and we lengthen ours.

The 19 earlier short keys were checked on 30/10 and came back clear, so these two are all
that is outstanding. The full handover file is `docs/taep-translations-en.json` — 279
strings. `tools/build_translations.py` now lists only keys added since the last check, so
its report is a short list rather than a reprint of everything.

## One thing that asks nothing of you

The ΤΑΕΠ diagnosis field no longer uses Select2. It is a plain text input plus a plain
`<select>`.

That field was dead twice on 30/10. Once because jQuery had not loaded when the inline
script ran — `base.html` loads it at the foot of `<body>`, below the content block, so
every `if (!window.jQuery) return;` guard in our templates was giving up silently in
production and only in production. Then, once that was fixed, because `base.html`'s own
`$('.select2').select2()` pass matched the wrapper Select2 had just built for us: it
treated the wrapper as a `<select>` to replace, hid the live box with
`select2-hidden-accessible` (1px, clipped) and put an empty container in its place.

Both are closed on our side. Every ΤΑΕΠ script that touches jQuery now runs from a
`taepReady()` wrapper, and each of our `select2()` calls strips the legacy `select2`
class off its own wrapper, so the two initialisers cannot fight whichever order they run
in. **Nothing in `base.html` was changed and nothing needs to be.**

Worth knowing for your own screens, though: any element you initialise yourself before
that pass runs will be claimed by it the same way.
