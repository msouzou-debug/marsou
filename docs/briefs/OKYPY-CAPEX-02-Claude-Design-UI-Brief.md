# eCapital — UI brief for Claude Design

Companion to `OKYPY-CAPEX-01-Claude-Code-Build-Brief.md`. Read that first for what the system does. This file is the design contract: what you export here is what Claude Code consumes. Do not invent tokens outside this file.

Load `frontend-design`, `okypy-brand-guidelines`, `design:design-system` and `design:design-handoff`, then `greek-how-to-write` and `hellenic-linguist` for every Greek string and `write-like-a-human` for every English one. The handoff you produce is consumed by an orchestrated build: a Claude Fable 5.1 project-manager agent assigns screens to Opus or Sonnet 4.6 sub-agents, so anything your spec leaves ambiguous gets guessed by someone who cannot ask you. Annotate accordingly.

## 1. Who is looking at the screen

| Persona | Device | In the screen for 30 seconds or 3 hours? | Design consequence |
|---|---|---|---|
| Project engineer | Desktop, two monitors | Hours | Density over whitespace. Tables, keyboard, bulk actions. |
| Head of estates | Desktop, some mobile | Minutes, several times a day | Exceptions first. Never make him hunt for what is wrong. |
| Technician | Phone, in a plant room, gloves on, no signal | Seconds per task | Huge targets, four fields max per screen, offline indicator always visible. |
| Finance | Desktop, Excel open beside it | Hours at month end | Numbers right-aligned, monospace figures, export on every table. |
| Clinical approver | Phone or desktop, between patients | 60 seconds | One screen: what is being shut down, which of my areas, what risk class, approve or return. Nothing else. |
| Executive / Board | Tablet, monthly | 5 minutes | Nine hospitals on one page. No scrolling to the answer. |

## 2. Tokens

Start from `brand-tokens.css` in the project. Extend, don't replace.

```
--k-green      #8BC53F   positive, on-track, approved
--k-blue       #069FEC   primary action, links
--k-blue-deep  #1B75BB   headings, nav
--k-text       #58595B   body
--k-grey       #EAEAEA   borders, zebra rows
--k-red        #C0392B   breach, overrun, rejected
--k-amber      #E8A33D   warning, at-risk, pending approval
--k-purple     #6B5CA5   permit / clinical risk (deliberately outside the brand palette so
                         a live permit is never mistaken for an ordinary status)
```

Type: Lato. Scale 12 / 14 / 16 / 20 / 24 / 32. Numbers in tabular figures (`font-variant-numeric: tabular-nums`) everywhere a column of money or dates appears. Money: `€ 1.234.567` — Greek thousands separator, no decimals above €1.000, right-aligned, red for negative variance with the minus sign, never brackets.

Spacing 4px base. Radius 6px. One shadow level only. No gradients except the brand bar.

RAG is never colour alone: green ✓ / amber ! / red ✕ with a text label, for accessibility and for printing in black and white.

## 3. Screen inventory

Priority 1 ships in the first two milestones.

| # | Screen | Greek label | Priority |
|---|---|---|---|
| S01 | Portfolio dashboard | Χαρτοφυλάκιο έργων | 1 |
| S02 | Project list (filterable table) | Έργα | 1 |
| S03 | Project detail — overview tab | Επισκόπηση έργου | 1 |
| S04 | Project detail — cost tab | Κόστος | 1 |
| S05 | Project detail — schedule / milestones | Χρονοδιάγραμμα | 2 |
| S06 | Project detail — risks & issues | Κίνδυνοι και θέματα | 2 |
| S07 | Contract detail | Σύμβαση | 1 |
| S08 | Variation form & list | Τροποποιήσεις σύμβασης | 1 |
| S09 | Payment certificate | Πιστοποίηση πληρωμής | 1 |
| S10 | SAP import & unmatched queue | Εισαγωγή δαπανών SAP | 1 |
| S11 | Shutdown request wizard | Αίτημα διακοπής | 1 |
| S12 | ICRA wizard (4 steps) | Εκτίμηση κινδύνου λοιμώξεων | 1 |
| S13 | Permit print view (A4) | Άδεια εργασίας | 1 |
| S14 | Approvals inbox | Εγκρίσεις | 1 |
| S15 | Clinical disruption calendar | Ημερολόγιο διαταράξεων | 2 |
| S16 | Asset register | Μητρώο παγίων | 2 |
| S17 | Asset detail (whole-life view) | Καρτέλα παγίου | 2 |
| S18 | Work order list | Εντολές εργασίας | 2 |
| S19 | Work order — mobile execution | Εκτέλεση εντολής | 2 |
| S20 | Defect capture — mobile | Καταγραφή έλλειψης | 2 |
| S21 | Maintenance backlog by risk | Εκκρεμότητες συντήρησης | 3 |
| S22 | Contractor scorecard | Αξιολόγηση αναδόχων | 3 |
| S23 | Reports & exports | Αναφορές | 3 |
| S24 | Admin: users, matrix versions, reference data | Διαχείριση | 3 |
| S25 | Contextual help drawer (every screen) | Βοήθεια | 1 |
| S26 | Help centre — searchable manual | Οδηγός χρήσης | 2 |
| S27 | Language toggle and user preferences | Ρυθμίσεις χρήστη | 2 |

## 4. The six screens that decide whether this works

**S01 Portfolio dashboard.** Top strip: four numbers for the whole organisation — approved budget, committed, spent, forecast — each with % of year elapsed underneath as the honest comparator. Below: a unit table, one row per org unit — nine hospitals and three services — groupable by directorate, sparkline of spend vs plan, RAG counts. Right column: «Χρειάζονται προσοχή» — the exception list, at most eight items, each one sentence and a link. If there are no exceptions, say so in words; do not show an empty box. No pie charts anywhere in this product.

**S04 Project cost tab.** The four ledgers as four columns in one table, by cost category, with variance. Above it, a single horizontal bar: approved | committed | spent, so overcommitment is visible as the bar breaking past the line. Budget warnings appear as an amber strip above the table with the rule that fired in plain Greek, and a dismiss that logs who dismissed it and when. Warnings never block the save button.

**S10 SAP unmatched queue.** This screen earns its keep on speed. Left: unmatched transactions. Right: suggested project or contract with a confidence hint and why it was suggested. Keyboard: `↓/↑` move, `Enter` accept suggestion, `1–9` pick from the shortlist, `s` skip. Multi-select and bulk assign. A running counter «Απομένουν 47 από 312». The engineer should clear a month in fifteen minutes.

**S11–S13 Permit flow.** Wizard, one question per screen, no dense form. Step 3 shows the computed ICRA class as a large coloured badge with the matrix cell that produced it visible underneath — the user must be able to see why they got Class IV, or they will not trust it. The mandatory controls appear as a checklist the requester cannot edit, only acknowledge. S13 prints on one A4 page, portrait, with the class, the controls, the dates, the approvers and a QR code back to the record. It gets taped to a plastic barrier in a corridor, so: big type, high contrast, no light grey.

**S14 Approvals inbox.** Gmail-shaped list, newest first, grouped by type. Each row: what, where, who asked, how long it has been waiting, SLA state. Opening one shows a decision panel, not a full record: the three facts needed to decide, then Έγκριση / Επιστροφή με σχόλια. Keyboard `a` `r` `f` `x`. For clinical approvers on a phone this must be a two-tap decision from the notification.

**S19 Work order — mobile.** One task, one screen. Top: asset name and location, large. Middle: what to do. Bottom: three fat buttons — Έναρξη, Παύση, Ολοκλήρωση. Photo capture is one tap from anywhere on the screen. A persistent offline chip at the top: «Εκτός σύνδεσης — 3 εγγραφές σε αναμονή». Never hide sync state; technicians will not trust the app if they cannot see their work is safe.

## 4.1 Bilingual and help design

The product is Greek and English in full, and the manual is inside it. Two things this imposes on you:

**Design for Greek length.** Greek runs roughly 10–20% longer than English. Every label, button and column header must be laid out at the Greek length, then checked at the English one — not the reverse. Show both in the handoff for anything in a fixed-width component: buttons, tabs, table headers, KPI tile captions. Nothing truncates with an ellipsis in either language.

**S25 help drawer.** Slides in from the right over the current screen, never a modal and never a new page, because people open it mid-task and need to keep seeing the form. Width 380px on desktop, full screen on mobile. Contains the manual section for that screen: two sentences on what the screen is for, the steps, then what goes wrong. Search box at the top scoped to the whole manual. A link to the printable PDF guide for that persona at the bottom. Design the empty state for a screen whose help section has not been written yet — it says so plainly rather than showing a blank drawer.

**S26 help centre.** A normal content page, not an app screen: single column, 680px measure, generous line height, real headings. This is the one place in the product where readability beats density. Search results show the section title and a matching line.

**S27** is a small preferences panel: language, notification defaults, default hospital for users who work across sites.

## 5. Components to export

Table (dense and comfortable variants, sticky header, column chooser, inline edit, export button in the header). KPI tile. Four-ledger cost bar. RAG chip. SLA countdown chip (green → amber → red → breached). ICRA class badge (I–V). Permit state banner. Wizard shell with step rail. Approval decision panel. Timeline / audit trail list. Photo strip with lightbox. Offline chip. Empty state. Confirmation dialog for destructive actions (typed confirmation for anything that deletes cost data). Filter bar with saved views. Asset breadcrumb: Μονάδα › Κτίριο › Όροφος › Χώρος › Πάγιο. The first level is the org unit, which may be a hospital or a service (ΔΥΨΥ, ΠΦΥ, Ασθενοφόρα), so never label it «Νοσοκομείο».

Every table exports to Excel from the same button position, top right, always visible.

## 6. States

Design all five for every screen: loading (skeleton, not a spinner, except under 300ms), empty, error, no-permission, and offline. Empty states carry one sentence and the action that fills them, e.g. «Δεν υπάρχουν ανοιχτές εντολές εργασίας για αυτό το πάγιο.» plus «Νέα εντολή». No illustrations, no jokes.

Error messages say what happened and what to do, in Greek, without a code: «Η εισαγωγή σταμάτησε στη γραμμή 214. Λείπει ο κωδικός WBS. Διορθώστε το αρχείο και ανεβάστε το ξανά.»

## 7. Greek microcopy glossary — fixed, do not vary

| English | Greek | Note |
|---|---|---|
| Project | Έργο | |
| Portfolio | Χαρτοφυλάκιο έργων | |
| Approved budget | Εγκεκριμένος προϋπολογισμός | |
| Commitments | Δεσμεύσεις | |
| Actual spend | Δαπάνες | not «πραγματοποιηθείσες δαπάνες», too heavy for a column header |
| Forecast final cost | Πρόβλεψη τελικού κόστους | |
| Cost to complete | Υπόλοιπο προς δαπάνη | |
| Contract | Σύμβαση | |
| Contractor | Ανάδοχος | |
| Consultant | Μελετητής | |
| Variation | Τροποποίηση σύμβασης | |
| Payment certificate | Πιστοποίηση πληρωμής | |
| Site instruction | Οδηγία εργοταξίου | |
| RFI | Αίτημα διευκρίνισης | |
| Defect / snag | Έλλειψη | plural Ελλείψεις |
| Handover | Παραλαβή έργου | Προσωρινή / Οριστική παραλαβή |
| Retention | Κρατήσεις | |
| Shutdown | Διακοπή συστήματος | |
| Permit to work | Άδεια εργασίας | |
| ICRA | Εκτίμηση κινδύνου λοιμώξεων (ICRA) | keep the abbreviation, staff use it |
| ILSM | Προσωρινά μέτρα ασφάλειας ζωής (ILSM) | |
| Class of precautions | Κατηγορία προφυλάξεων | I–V in Latin numerals |
| Org unit | Μονάδα | hospital or service; never label a unit column «Νοσοκομείο» |
| Directorate | Διεύθυνση | |
| Asset | Πάγιο | plural Πάγια; register = Μητρώο παγίων |
| Criticality | Κρισιμότητα | 1–5 |
| Condition | Φυσική κατάσταση | never plain «Κατάσταση» — that is reserved for status |
| Status | Κατάσταση | |
| Work order | Εντολή εργασίας | |
| Preventive maintenance | Προληπτική συντήρηση | |
| Corrective maintenance | Διορθωτική συντήρηση | |
| Backlog | Εκκρεμότητες συντήρησης | |
| Warranty | Εγγύηση | |
| Commissioning | Θέση σε λειτουργία | |
| Approvals | Εγκρίσεις | |
| Help | Βοήθεια | drawer label |
| User guide | Οδηγός χρήσης | help centre |
| Language | Γλώσσα | |

Buttons, fixed set: Αποθήκευση · Ακύρωση · Υποβολή · Έγκριση · Επιστροφή με σχόλια · Ολοκλήρωση · Προσθήκη · Εξαγωγή σε Excel · Εκτύπωση · Σάρωση QR.

Rules for all Greek strings: monotonic, Greek question mark (;), no accents on all-caps text, no exclamation marks, no καθαρεύουσα, verbs over noun chains («Εγκρίνετε τη διακοπή», not «Έγκριση διενέργειας της διακοπής»). Second person plural for instructions to the user.

## 8. Responsive

Three breakpoints: 390 (phone, field use), 1024 (tablet, executive), 1440+ (desktop, the real working width). S19, S20 and the approval decision panel are designed phone-first and must be usable one-handed. S01 must fit a tablet without horizontal scroll. Everything else is desktop-first and may simply stack on a phone.

## 9. What to hand back

An exported design system with: the token file, the component set above with all five states, the six priority screens at 1440 and the three mobile screens at 390, the A4 permit print sheet, the help drawer and help centre, and a page of Greek microcopy in context, each label shown in Greek and English. Annotate anything where the layout implies a business rule, so Claude Code does not have to guess.

Do not design: pie charts, dark mode, a marketing landing page, contractor-facing screens (v2), or any screen that shows patient-identifiable information. None of those exist in this product.
