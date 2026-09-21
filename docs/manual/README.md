# eCapital user manual

One Markdown file per screen, in `el/` and `en/`, the single source `apps/web/src/help/` renders three ways: the S25 contextual help drawer, the S26 help centre, and the sixteen printable PDF guides (R50, ADR-0027). The table below is generated from `apps/web/src/help/map.json` by `scripts/manual-index.mjs` — run `pnpm guides:build` (which runs this script first) after adding a screen or changing a tier, and commit the result; do not hand-edit the table.

## Tiers and what "day one" means for training

Owner decision, 20/09/2026 (docs/briefs/README.md Errata "Screen tiers"): the pilot goes live on a capital-and-maintenance basis, so every screen below is either **day one** or **optional**. A day-one screen is one the pilot's training covers before go-live and every user of that screen's persona is expected to use starting their first day on the system — it is in the persona's PDF guide's main chapters and in the S25/S26 UI's "Ημέρα 1" group. An optional screen is built, shipped and reachable in the app from day one as well, but training treats it as phase two: it sits after the guide's divider page and under S26's "Προαιρετικό" group, and a hospital picks it up once the basic register is running, not before.

## Screens (generated — do not edit by hand)

### Day one

| Screen id | Title (EL) | Title (EN) | Personas |
|---|---|---|---|
| S00 | Σύνδεση | Signing in | estates_head, project_engineer, technician, finance, clinical_approver, executive_readonly, admin, auditor_readonly |
| S01 | Χαρτοφυλάκιο έργων | Portfolio | estates_head, executive_readonly, finance |
| S02 | Έργα | Projects | estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S02a-edit | Νέο έργο και επεξεργασία έργου | New project and editing a project | admin, estates_head, project_engineer, technician, finance, clinical_approver |
| S03 | Επισκόπηση έργου | Project overview | estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S04 | Κόστος | Cost | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S05 | Χρονοδιάγραμμα | Schedule | estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S07 | Σύμβαση | Contract | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S07a-edit | Νέα σύμβαση / Επεξεργασία σύμβασης | New contract / Edit contract | admin, estates_head, project_engineer |
| S07e | Συμβάσεις | Contracts | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S08 | Τροποποιήσεις σύμβασης | Contract variations | admin, estates_head, project_engineer |
| S09 | Πιστοποιήσεις πληρωμής | Payment certificates | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S10 | Εισαγωγή SAP | SAP import | admin, finance |
| S16 | Χώροι μονάδας | Unit areas | estates_head, project_engineer, technician |
| S16a | Μητρώο παγίων | Asset register | admin, estates_head, project_engineer, technician, finance, executive_readonly, auditor_readonly |
| S17 | Πάγιο | Asset | admin, estates_head, project_engineer, technician, finance, executive_readonly, auditor_readonly |
| S17a-edit | Νέο πάγιο / Επεξεργασία παγίου | New asset / Edit asset | admin, estates_head, project_engineer, technician |
| S17b | Ετικέτες παγίων | Asset labels | admin, estates_head, project_engineer, technician, finance |
| S24 | Ανάδοχοι | Contractors | admin, estates_head |
| S24u | Χρήστες | Users | admin |
| S26 | Οδηγός χρήσης | User guide | admin, estates_head, project_engineer, technician, finance, clinical_approver, executive_readonly, auditor_readonly |

### Optional

| Screen id | Title (EL) | Title (EN) | Personas |
|---|---|---|---|
| S06 | Κίνδυνοι και θέματα | Risks and issues | estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S07b | Αιτήματα διευκρίνισης | RFIs | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S07c | Οδηγίες εργοταξίου | Site instructions | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S07d | Ελλείψεις | Defects | admin, estates_head, project_engineer, finance, executive_readonly, auditor_readonly |
| S09a | Δεδουλευμένα | Accruals | admin, estates_head, finance, executive_readonly, auditor_readonly |
| S11 | Διακοπές και άδειες | Shutdowns and permits | admin, estates_head, project_engineer, technician, clinical_approver, executive_readonly, auditor_readonly |
| S11a-edit | Αίτημα διακοπής | Shutdown request | admin, estates_head, project_engineer |
| S12 | Εκτίμηση κινδύνου λοιμώξεων (ICRA) | Infection control risk assessment (ICRA) | admin, estates_head, project_engineer |
| S13 | Άδεια εργασίας (εκτύπωση) | Permit to work (print) | admin, estates_head, project_engineer, technician, clinical_approver |
| S14 | Εγκρίσεις | Approvals | admin, estates_head, clinical_approver |
| S15 | Ημερολόγιο διαταράξεων | Disruption calendar | admin, estates_head, project_engineer, clinical_approver, executive_readonly, auditor_readonly |
| S17c | Πρόβλεψη αντικαταστάσεων | Replacement forecast | estates_head, finance, executive_readonly, admin |

## M4 asset screens — tier decided, not yet in help/map.json

The asset register, asset detail, asset form, the label sheet and the scan route are being added directly on the main checkout by the M4 web agent, in parallel with this change. They have no route in `help/map.json` yet, so `scripts/manual-index.mjs` cannot read a title for them and they are not in the generated table above. The tier decision for them still stands (docs/briefs/README.md Errata "Screen tiers") and is recorded here by hand so it is not lost before M4 lands; once each screen gets its `help/map.json` entry (with its own `tier`), delete its row here and it appears in the generated table on the next `pnpm guides:build`.

| Screen | Planned tier |
|---|---|
| Asset register | Day one |
| Asset detail | Day one |
| Asset form (new / edit) | Day one |
| Label sheet (print) | Day one |
| Scan route | Day one |
| Asset replacement forecast | Optional |
