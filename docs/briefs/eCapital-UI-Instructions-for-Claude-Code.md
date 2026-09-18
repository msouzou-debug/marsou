# eCapital — UI design instructions for Claude Code

Read before building any screen. This file turns `OKYPY-CAPEX-02-Claude-Design-UI-Brief.md` into build rules. Where this file and the brief disagree, the brief wins; where the brief is silent, this file decides so you do not have to guess. Do not invent tokens, colours, spacing values, labels or components outside these two files.

---

## 0. Working rules

1. Build components first (§4), then screens (§5). No screen may contain a one-off widget that is not in the component set.
2. Every screen ships with all five states (§6) or it is not done.
3. Every string exists in Greek and English at build time, keyed, never hard-coded in JSX. Greek is laid out first; English is checked after.
4. Every table has an export button, top right, always visible, same position.
5. No pie charts, no dark mode, no gradients except the brand bar, no illustrations, no emoji, no unicode glyphs as icons.
6. When a layout implies a business rule, put the rule in a code comment next to the markup (`// RULE: …`). Rules in this file are marked the same way.

---

## 1. Tokens — `src/styles/tokens.css`

Extend `brand-tokens.css`; do not replace it. Everything below is added to `:root`.

```css
/* colour */
--k-green:      #8BC53F;  /* positive, on-track, approved */
--k-blue:       #069FEC;  /* primary action, links */
--k-blue-deep:  #1B75BB;  /* headings, nav */
--k-text:       #58595B;  /* body */
--k-grey:       #EAEAEA;  /* borders, zebra rows */
--k-red:        #C0392B;  /* breach, overrun, rejected */
--k-amber:      #E8A33D;  /* warning, at-risk, pending approval */
--k-purple:     #6B5CA5;  /* permit / clinical risk ONLY */

/* tints — 10% of the status colour on white, for chip and banner backgrounds */
--k-green-bg:   #F3F9EC;
--k-red-bg:     #F9ECEA;
--k-amber-bg:   #FDF6EC;
--k-purple-bg:  #F0EEF6;
--k-blue-bg:    #E6F5FD;

/* neutrals */
--k-white:      #FFFFFF;
--k-surface:    #F7F8F9;  /* page background behind cards on dense screens */
--k-text-muted: #8A8C8F;  /* meta, captions — never for body copy */
--k-ink:        #1F2224;  /* KPI figures, permit print, anything that must be read at 2 m */

/* type */
--k-font:       'Lato', 'Open Sans', system-ui, sans-serif;
--k-font-mono:  'IBM Plex Mono', ui-monospace, monospace;
--fs-12: 12px; --fs-14: 14px; --fs-16: 16px; --fs-20: 20px; --fs-24: 24px; --fs-32: 32px;

/* spacing — 4px base. Never type a bare px value in a component. */
--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px; --s-12: 48px;

--radius: 6px;
--radius-chip: 2px;
--shadow: 0 1px 2px rgba(31,34,36,.08);   /* the only shadow */
--border: 1px solid var(--k-grey);
```

Rules:

- `--k-purple` is used for permits, ICRA class badges and the permit state banner. Nowhere else. **RULE:** a live permit must never be confusable with an ordinary status, so no other chip, tag or button may be purple.
- `--k-blue` appears at most once per view as a filled element (the primary button). Links use it as text. Never as a background wash.
- Body text is `--k-text`, headings `--k-blue-deep`, figures that must be read fast (KPI tiles, permit sheet) `--k-ink`.
- `--k-text-muted` fails contrast at 12px on `--k-surface`; use it only at 14px+ on white.

### Typography

- Family: Lato via Google Fonts, weights 400 / 700 only. (The OKYpY design system uses Open Sans; the brief specifies Lato. Lato ships. Open Sans is the fallback. Flag to the PM if brand requires reversal — it is a one-line change to `--k-font`.)
- Scale: 12 caption/meta · 14 table body and default UI · 16 body copy and form inputs · 20 section titles · 24 page titles · 32 KPI figures.
- Line height: 1.5 for text, 1.2 for headings and figures.
- Headings: sentence case. Eyebrow labels (small caps above titles): uppercase, `letter-spacing: .08em`, 12px, and **no accents on Greek uppercase**.
- Any column of money, dates, counts, or IDs: `font-family: var(--k-font-mono); font-variant-numeric: tabular-nums; text-align: right;`.

### Money — `formatEUR()`

```
€ 1.234.567      ≥ €1.000: no decimals, dot thousands separator, thin space after €
€ 845,20         < €1.000: two decimals, comma decimal
-€ 12.400        negative: leading minus, coloured --k-red. Never brackets.
```

Percentages: `12,4 %` (comma decimal, thin space before %). Dates: `14/03/2026` in both languages. Duration: `3 ημ` / `3 d`.

---

## 2. Layout

Breakpoints: `390` phone · `1024` tablet · `1440` desktop. Design desktop-first except S19, S20 and the approval decision panel, which are phone-first.

Desktop shell (1440+):

```
┌ 56px top bar: logo · unit switcher (Μονάδα) · search · language · user · Βοήθεια ┐
├ 240px nav rail │ page: 32px padding, max-width none                         │
│  (collapses to │ ┌ page title row: eyebrow + h1 left, primary action right  │
│   56px icons   │ ├ filter bar / tabs                                        │
│   at 1024)     │ └ content                                                  │
```

- Nav rail groups: Χαρτοφυλάκιο · Έργα · Συμβάσεις · Διακοπές και άδειες · Πάγια · Συντήρηση · Εγκρίσεις (with count badge) · Αναφορές · Διαχείριση.
- **RULE:** the first organisational level is the **org unit (Μονάδα)** — nine hospitals plus three services (ΔΥΨΥ, ΠΦΥ, Ασθενοφόρα), grouped under directorates (Διεύθυνση). No column, filter, switcher or breadcrumb segment is ever labelled «Νοσοκομείο»; the label is «Μονάδα». Hospital names appear only as the values.
- Density: tables default to **dense** (row height 36px) for engineer and finance screens; **comfortable** (48px) on S01, S14, and anything a clinician or executive sees. Expose a density toggle in the table header; persist per user.
- Phone (390): no nav rail. Bottom tab bar, 4 items, 56px tall, 44px minimum targets. Content padding 16px.
- **RULE:** S01 fits 1024 wide with no horizontal scroll and the exception list visible without scrolling.

---

## 3. Bilingual

- All strings in `src/i18n/el.json` and `src/i18n/en.json`, same keys. Greek is the source file; English is translated from it.
- Greek runs 10–20% longer. Size every fixed-width component (buttons, tabs, table headers, KPI captions) to the Greek string, then verify English. Nothing truncates with an ellipsis in either language; wrap to two lines or widen.
- Use the fixed glossary in the brief §7 verbatim. Notable traps: «Μονάδα» for org unit, never «Νοσοκομείο» as a label; «Δαπάνες» not «πραγματοποιηθείσες δαπάνες»; «Φυσική κατάσταση» for condition, «Κατάσταση» only for status; ICRA and ILSM keep the abbreviation.
- Fixed button set only: Αποθήκευση · Ακύρωση · Υποβολή · Έγκριση · Επιστροφή με σχόλια · Ολοκλήρωση · Προσθήκη · Εξαγωγή σε Excel · Εκτύπωση · Σάρωση QR.
- Greek rules: monotonic; Greek question mark `;`; no accents on all-caps; no exclamation marks; verbs over noun chains; second person plural for instructions.
- Language toggle in the top bar switches instantly, no reload, persists to the user profile (S27).

---

## 4. Component set — `src/components/`

Each component: props table in a header comment, all five states where it holds data, Greek + English story in Storybook (or the equivalent preview).

**Table** — dense/comfortable variant; sticky header; column chooser (persisted); inline edit on double-click for editable cells with `Enter` save / `Esc` cancel; zebra rows `--k-grey` at 40%; numeric columns mono + right-aligned; export button (`Εξαγωγή σε Excel`) top right of the header, always rendered, disabled while loading. Row selection with checkbox column when `selectable`. Keyboard: `↑/↓` move focus, `Enter` open.

**KpiTile** — eyebrow caption (12px uppercase), figure (32px mono `--k-ink`), comparator line beneath (14px `--k-text-muted`), optional trend arrow using an SVG icon, never a glyph. **RULE:** on S01 the comparator is always «% έτους που έχει παρέλθει» so spend is compared against time, not against the plan alone.

**CostBar** (four-ledger) — one horizontal bar, 24px tall. Segments in order: Εγκεκριμένος προϋπολογισμός (outline, `--k-grey` fill), Δεσμεύσεις (`--k-blue-deep` at 30%), Δαπάνες (`--k-blue-deep`). A vertical 2px `--k-ink` line marks the approved budget. **RULE:** if committed or spent exceeds approved, the bar extends past the line and the overflow segment is `--k-red`; the overflow amount is labelled to the right. Forecast is a hollow marker on the same axis. Legend below, four items, values in mono.

**RagChip** — three values: `green` ✓ «Εντός ορίων», `amber` ! «Σε κίνδυνο», `red` ✕ «Παράβαση». Icon is an SVG check / alert / x (Lucide), never a unicode glyph. Text label always rendered; colour is background tint + coloured icon, text stays `--k-ink`. **RULE:** RAG is never colour alone — must survive greyscale print.

**SlaChip** — shows remaining time («Απομένουν 2 ημ» / «2 d left»). Green > 50% of SLA remaining, amber 50–10%, red < 10%, breached: red fill with white text and «Εκπρόθεσμο». Ticks once a minute, not every second.

**IcraBadge** — class I–V, Latin numerals, 48px tall on wizard step 3, 24px in lists. Background `--k-purple` tinted per class (I and II: `--k-purple-bg` with purple text; III: purple outline; IV and V: purple fill, white text). Beneath it, in the wizard only, a 2-row × 1-cell matrix excerpt: «Τύπος εργασίας B × Ομάδα κινδύνου 3 → Κατηγορία IV». **RULE:** the matrix cell must always be visible with the class; the user has to see why.

**PermitBanner** — full-width strip at the top of any record that has a live permit. `--k-purple` fill, white text: state (Σε ισχύ / Εκκρεμεί έγκριση / Έληξε / Ανακλήθηκε), dates, class, link «Εκτύπωση». Cannot be dismissed while the permit is in force.

**WizardShell** — left step rail (desktop) / top progress dots (phone). One question per step; the step body never scrolls on desktop at 1440×900. Back is always available; forward is «Συνέχεια», last step «Υποβολή». Draft autosaves per step; a leaving-the-page prompt is not needed because of that.

**DecisionPanel** — 480px right sheet on desktop, full screen on phone. Header: what and where. Body: exactly three facts (configurable per approval type). Footer: two buttons, `Έγκριση` primary, `Επιστροφή με σχόλια` secondary; the latter opens an inline textarea, comment required. Keyboard `a` approve, `r` return, `f` forward, `x` close. On phone the two buttons are 56px tall and pinned to the bottom. **RULE:** never render the full record here.

**Timeline** — vertical audit trail, newest at top. Each entry: actor, action verb, timestamp (mono), optional diff line. Read-only.

**PhotoStrip** — 88px thumbnails in a horizontal scroll row, tap opens lightbox with swipe, pinch, caption, timestamp, GPS if present. Capture button always first in the strip.

**OfflineChip** — pinned under the top bar on phone, top right on desktop. States: hidden when online with nothing queued; «Εκτός σύνδεσης — 3 εγγραφές σε αναμονή» amber when offline; «Συγχρονισμός…» blue while flushing; red «Αποτυχία συγχρονισμού — 1 εγγραφή» with a retry link. **RULE:** never hide sync state while anything is queued.

**EmptyState** — one sentence + one action button. No illustration, 16px text, centred in the container, max-width 400px.

**ConfirmDialog** — destructive actions: title as a question, one sentence of consequence, `Ακύρωση` + red destructive button. **RULE:** anything that deletes cost data requires typing the record's code into a field before the button enables.

**FilterBar** — chips for active filters, «Αποθηκευμένες προβολές» dropdown, «Αποθήκευση προβολής», clear all. Filter changes update the URL query.

**AssetBreadcrumb** — `Μονάδα › Κτίριο › Όροφος › Χώρος › Πάγιο`, each segment a link, separator is an SVG chevron. Collapses middle segments on phone. **RULE:** the first level is the org unit — a hospital or a service (ΔΥΨΥ, ΠΦΥ, Ασθενοφόρα) — so the segment label is «Μονάδα», never «Νοσοκομείο».

**HelpDrawer** (S25) — see §5.

---

## 5. Screens

Build in this order: S01 · S04 · S10 · S11–S13 · S14 · S19 · S25 · then the rest by priority.

### S01 Χαρτοφυλάκιο έργων — Portfolio dashboard
- Row 1: four KpiTiles — Εγκεκριμένος προϋπολογισμός · Δεσμεύσεις · Δαπάνες · Πρόβλεψη τελικού κόστους. Each comparator: «% έτους που έχει παρέλθει: 62 %».
- Row 2, left (8/12): unit table, twelve rows — nine hospitals and three services — comfortable density. Columns: Μονάδα · Έργα (count) · Εγκεκριμένος · Δαπάνες · Πορεία (sparkline spend vs plan, 96×24 SVG, plan as `--k-grey` line, spend as `--k-blue-deep`) · RAG (three counts as small chips). «Ομαδοποίηση κατά Διεύθυνση» toggle in the table header groups rows under directorate subheaders with subtotals; default ungrouped, sorted by approved budget descending. Rows link to S02 filtered by unit. **RULE:** twelve rows plus the KPI strip must fit 1024×768 without scrolling to the exception list; if grouping is on and it no longer fits, the exception list stays above the table on tablet.
- Row 2, right (4/12): «Χρειάζονται προσοχή». Max eight items, each one sentence plus link. **RULE:** when empty, render the sentence «Δεν υπάρχουν θέματα που χρειάζονται προσοχή.» — never an empty card.
- Tablet 1024: KPI row 2×2, table and exception list stack, exceptions above the table.

### S04 Κόστος — Project cost tab
- Top: CostBar for the whole project.
- Amber warning strip between bar and table when a budget rule fires: rule text in plain Greek («Οι δεσμεύσεις υπερβαίνουν τον εγκεκριμένο προϋπολογισμό κατά € 84.000»), «Απόρριψη» link. **RULE:** dismissing logs user + timestamp to the audit trail and the strip is replaced by a 12px line «Απορρίφθηκε από Μ. Ιωάννου, 14/03/2026 10:42». **RULE:** warnings never disable Αποθήκευση.
- Table, dense: rows = cost categories; columns = Εγκεκριμένος · Δεσμεύσεις · Δαπάνες · Πρόβλεψη · Απόκλιση (forecast − approved, red when negative). Footer row totals, bold. Export top right.

### S10 Εισαγωγή δαπανών SAP — Import and unmatched queue
- Header counter, 20px mono: «Απομένουν 47 από 312».
- Split pane: left 55% unmatched transactions table (dense, selectable), right 45% suggestion panel for the focused row: suggested project/contract, confidence as text («Υψηλή αντιστοιχία — ίδιος κωδικός WBS»), shortlist of up to 9 alternatives numbered 1–9.
- Keyboard, shown in a footer hint bar: `↓/↑` move · `Enter` accept · `1–9` pick · `s` skip · `Space` select · `Shift+A` bulk assign selected.
- Bulk assign opens a compact picker, not a full dialog. Import errors follow the §6 message pattern.
- **RULE:** accepting a suggestion moves focus to the next row immediately; no confirmation.

### S11 Αίτημα διακοπής · S12 ICRA · S13 Άδεια εργασίας
- S11: WizardShell, steps — Σύστημα · Χώροι που επηρεάζονται · Ημερομηνία και διάρκεια · Επισκόπηση. Affected areas step uses AssetBreadcrumb-style pickers, multi-select.
- S12: four steps — Τύπος εργασίας (A–D) · Ομάδα κινδύνου χώρων (1–4) · Κατηγορία (computed, IcraBadge large, matrix cell beneath, controls checklist) · Υποβολή. **RULE:** controls checklist is read-only; each item has an «Ενημερώθηκα» checkbox that must all be ticked before Υποβολή enables. Class and controls come from the active matrix version; show the version id in 12px under the badge.
- S13: A4 portrait, `@page { size: A4; margin: 12mm }`, one page, `print-color-adjust: exact`. Layout: OKYpY logo top left, «ΑΔΕΙΑ ΕΡΓΑΣΙΑΣ» 32px top right; IcraBadge 64px tall; controls as a numbered list at 16px; dates and system at 20px; approvers with role and time; QR (160px) bottom right linking to the record; permit id in mono along the bottom. Minimum text 14px, minimum colour `--k-text` — no `--k-text-muted`, no light grey rules. Preview on screen at 100% before printing.

### S14 Εγκρίσεις — Approvals inbox
- List grouped by type (Διακοπές · Τροποποιήσεις · Πιστοποιήσεις · Άλλα), newest first inside each group. Row: type icon · what · where (unit › area) · who asked · waiting time · SlaChip. Unread rows bold.
- Click or `Enter` opens DecisionPanel. Keyboard in the list: `↑/↓`, `a`, `r`, `f`, `x`; a `?` overlay lists them.
- Phone: list becomes cards; deep link from a push notification opens the DecisionPanel directly. **RULE:** approve from notification is two taps — open, Έγκριση — with no intermediate screen.

### S19 Εκτέλεση εντολής — Work order mobile
- OfflineChip pinned under a 48px header (back, work order id).
- Top block: asset name 24px, location breadcrumb 14px.
- Middle: task description 16px, checklist if any, PhotoStrip.
- Bottom, pinned: three 64px buttons stacked or in a row depending on width — Έναρξη · Παύση · Ολοκλήρωση. Only the valid next actions are enabled. Ολοκλήρωση opens a one-field note + optional photo, then submits.
- Floating camera button bottom right, 56px, above the button bar. **RULE:** photo capture is one tap from any scroll position.
- Everything must work with no network; queue writes and show them in the OfflineChip.

### S25 Βοήθεια — Help drawer
- Slides from the right, 380px desktop, full screen phone, over the current screen with a 20% scrim that does not block the page (clicks pass through on desktop). Never a modal, never a route change.
- Contents: search box scoped to the whole manual · section for the current screen: two sentences purpose, numbered steps, «Τι μπορεί να πάει λάθος» · footer link «Οδηγός PDF για [ρόλος]».
- Empty state when the section is unwritten: «Η βοήθεια για αυτή την οθόνη δεν έχει γραφτεί ακόμη.» plus a link to the help centre.
- Reading typography: 16px, line-height 1.6, headings 20px. Readability beats density here.

### S26 Οδηγός χρήσης — Help centre
Content page: single column 680px measure, 16px/1.6, h2 24px, h3 20px, generous spacing (`--s-10` between sections). Search results: section title + one matching line with the match bolded. Left table of contents on desktop only.

### S27 Ρυθμίσεις χρήστη
Small panel: Γλώσσα (segmented EL / EN), notification defaults (per approval type: email / push / none), default unit (Προεπιλεγμένη μονάδα — hospital or service). Save on change, toast confirmation.

### Remaining screens (S02, S03, S05–S09, S15–S18, S20–S24)
Compose from the component set. S02 is a Table + FilterBar. S03 is a two-column overview: left facts and Timeline, right CostBar and RagChips. S07–S09 are record pages with a Timeline; S09 numbers are mono and right-aligned with retention shown as a separate line, never netted silently. S15 is a week calendar; shutdown blocks are `--k-purple`. S16/S17 use AssetBreadcrumb and S17 shows the whole-life cost as a CostBar variant. S20 is a phone form of four fields max: asset (scan QR), description, photo, priority. S21 is a Table sorted by criticality × condition. S22 is a Table, no gauges. Never show patient-identifiable information anywhere.

---

## 6. States — required for every screen

| State | Rule |
|---|---|
| Loading | Skeleton blocks in the shape of the content. Spinner only if the wait is < 300ms and inside a button. |
| Empty | One sentence + the action that fills it. Example: «Δεν υπάρχουν ανοιχτές εντολές εργασίας για αυτό το πάγιο.» + «Νέα εντολή». |
| Error | What happened + what to do, in Greek, no code: «Η εισαγωγή σταμάτησε στη γραμμή 214. Λείπει ο κωδικός WBS. Διορθώστε το αρχείο και ανεβάστε το ξανά.» Retry button when retry is possible. |
| No permission | «Δεν έχετε πρόσβαση σε αυτή τη σελίδα.» + who to ask (role, not a person) + link back. Never a blank page or a redirect loop. |
| Offline | Read-only cached data with OfflineChip; write actions either queue (S19, S20, approvals) or are disabled with the reason in the button tooltip. |

---

## 7. Accessibility and input

- Contrast ≥ 4.5:1 for text, ≥ 3:1 for 20px+ headings. Check `--k-amber` on white — it fails for text, so amber is only ever a background tint or icon; the label text is `--k-ink`.
- Focus ring: 2px `--k-blue` outline, 2px offset, on everything focusable. Never `outline: none` without a replacement.
- All keyboard shortcuts listed in §5 are also reachable by mouse; shortcuts are shown in a `?` overlay and in tooltips.
- Touch targets ≥ 44px on phone; 56–64px for the S19 action buttons and the DecisionPanel buttons.
- Icons: Lucide, 1.5px stroke, `currentColor`, always with a visible or `aria-label` text. Sizes 20 inline, 24 in buttons and nav.
- Tables have `<th scope>`, sortable headers announce sort state.

---

## 8. Definition of done per screen

- [ ] Renders at its breakpoints (§2) with Greek strings, then English, with no truncation.
- [ ] All five states implemented and reachable in the preview.
- [ ] Only components from §4; only tokens from §1.
- [ ] Every table has export top right; every numeric column is mono and right-aligned.
- [ ] Business rules from §5 are present as `// RULE:` comments next to the code.
- [ ] Keyboard shortcuts work and are listed in the `?` overlay.
- [ ] No pie chart, no purple outside permits, no filled blue except one primary action, no `--k-text-muted` below 14px.
- [ ] Help drawer opens on the screen and either shows its section or the unwritten-section empty state.
