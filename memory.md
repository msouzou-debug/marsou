# Memory

## Writing standards (apply in every chat, Claude Code session and project)

Greek text: always use these skills
- /greek-how-to-write
- /okypy-greek-terms
- /hellenic-linguist

English and Greek text: always use these skills
- /natural-document-writer
- /write-like-a-human
- /anti-ai-writing
- /humanize

## Working preferences

- Context: hospital sector, national health service organisation (ΟΚΥπΥ / SHSO, Cyprus).
- Ask clarifying questions before building anything.
- Short answers, simple solutions first. State assumptions and shortcuts.
- Excel outputs: live formulas, dynamic and auditable.

## Projects in this repo

- `outpatient-dashboards/SHSO-Outpatient-Dashboard-FGH-v2.3.html`: Famagusta General Hospital.
  Loads Medico (.xls) and Ewave (.xlsx) extracts in the browser.
- `outpatient-dashboards/SHSO-Outpatient-Dashboard-LGH-v3.0.html`: Larnaca General Hospital. Loads the Plan B
  workbook (Morning / Evenings sheets with Date, Doctor, Specialty, Day, Count).
- Naming: `SHSO-Outpatient-Dashboard-<hospital code>-v<major>.<minor>.html`. Exports follow
  `SHSO-Outpatient-<code>-v<version>-<what>-<date>`.
- Reports: both tools share one report module (`RPT`, identical code in each file) fed by a per-hospital
  `rptPayload()`. It makes HTML laptop, HTML phone, PowerPoint (PptxGenJS 3.12.0 embedded) and PDF (print dialog).
  `rptChecks()` holds the accuracy checks; the Excel exports carry the same checks as live formulas.
  Change the module in both files together.
- Versioning: each file has a `TOOL` constant (code, hospital, version, date) and a version history comment
  at the top of its script. Minor (+0.1) for fixes and small changes, major (+1.0) for new tabs, new data
  sources or changed calculation rules. On every change: bump `TOOL`, add a history line, rename the file.
- Both are single HTML files with the libraries embedded (SheetJS 0.20.3; html2canvas in the Famagusta file)
  and a Content-Security-Policy that blocks all network connections.
  They run offline. No patient data is stored in the repo.

## Rules confirmed by the hospital (Famagusta, Nov 2026)

- Episode time is the registration time, not the examination time.
- Afternoon = 15:00 onwards.
- Ewave payment: "In person" = Μη δικαιούχοι; "Insured" = everything else (ΓεΣΥ, Ευρωκάρτα, Αρμόδιες Αρχές κ.λπ.).
- Health certificates are booked under IT staff accounts, so those names appear in the doctor column.
  They are not clinicians and must not be counted as ΙΛ. The list sits in `CFG.itAccounts` in the Famagusta file.
- Φαρμακείο belongs with labs and support departments.

## Larnaca rules (v3.0, Nov 2026)

- New source file: sheet `Data` with Ημερομηνία, Ημέρα, Doctor, Spec, Ραντεβού Πρωί, Εγγραφές Πρωί, Ραντεβού Απόγευμα,
  Εγγραφές Απόγευμα. The old Plan B layout is still read.
- Scheduled clinic = morning with at least 3 appointments (`CFG.minAppt`), in specialties that have appointments.
  Specialties with no appointments keep the estimate. Registrations on other days count in volume, not in the average.
- Mornings with appointments but no registrations stay out of the average and are reported separately.
- Afternoons use registrations only; afternoon appointments in the file are incomplete.
- Clinic packs: one folder per specialty name as it stands in the file (no grouping), doctor names shown,
  hospital shown only as one comparison line. Famagusta has the same pack per specialty.
- Open questions sent to Larnaca: `outpatient-dashboards/docs/LGH-Erotiseis-Neo-Arxeio-2026-11-19.docx`.

## Pitfalls to remember

- Dates: never use SheetJS `cellDates:true` or `toISOString()` for day keys. On a PC set to Cyprus time both
  shift dates to the previous day. Read serial numbers and build local dates.
- SheetJS cannot write formulas to .xls. Use .xlsx for live formulas.
- ExcelJS writes dates in UTC. Convert local dates to UTC midnight first (`xlDate`), or they land on the previous day.
