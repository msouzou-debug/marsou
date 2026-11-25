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
- `outpatient-dashboards/SHSO-Outpatient-Dashboard-LGH-v3.2.html`: Larnaca General Hospital. Loads the Plan B
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
- Larnaca answers (23 Nov 2026): no Saturday clinics; file comes monthly, always from 1 January; threshold of 2-3
  appointments accepted (kept at 3); specialties outside the LGH Directorate are to be excluded (exact list pending);
  the full pack goes to the ΕΓΔΔ and ΕΔ, and is isolated per specialty for clinic meetings; clinic hours not available.
- The re-sent workbook has two sheets, `Data` and `Data_updated`. The tool reads only one (v3.1). In `Data_updated`
  afternoon appointments sit under clinic lists with specialty NULL (e.g. «ΟΡΘΟΠΕΔΙΚΟΙ ΑΠΟΓΕΥΜΑ Α»), not under doctors.
- Rules confirmed by Larnaca on 25 Nov 2026, held in the `RULES` constant of the LGH tool (v3.2):
  outside the LGH Directorate and excluded by default: Οδοντιατρική, Ψυχολόγος, Κλινικός Ψυχολόγος, Παιδοψυχιατρική,
  Νοσηλευτής Ψυχικής Υγείας, Εργοθεραπεία, Γενική Ιατρική, Φαρμακείο, Παραπομπές από άλλα νοσοκομεία.
  Merged names: Γυναικολογία+Μαιευτική, Παιδιατρική (3 names), Φυσιοθεραπεία ΓεΣΥ+εκτός, Διαιτολογία+Κλινικός
  Διαιτολόγος, Πνευμονολογία+Φυματίωση, ΩΡΛ+Ακουογραφήματα.
  Micro-procedures (Ortho, General Surgery, Ophthalmology, Urology) are Day Care booked as outpatients: kept as
  their own line, outside the clinic's outpatient average, but inside that clinic's pack.
  Dr Γιάλλουρος is a plastic surgeon. Γεωργίου Ιωάννα and Κωνσταντίνου Μαρλέν are not Pathology staff.
  Comparison line with the hospital total stays. Default pack: laptop report, PowerPoint, Excel.
- «ΓΡΗΓΟΡΙΟΣ ΚΛΙΝΙΚΗ» is the Gregorios Clinic (HIV/AIDS); its drugs are reimbursed by the HIO (ΟΑΥ). Keep the name
  as it is in reports; do not add a diagnosis label.
- Open questions sent to Larnaca: `outpatient-dashboards/docs/LGH-Erotiseis-Neo-Arxeio-2026-11-19.docx`.

## Pitfalls to remember

- Dates: never use SheetJS `cellDates:true` or `toISOString()` for day keys. On a PC set to Cyprus time both
  shift dates to the previous day. Read serial numbers and build local dates.
- SheetJS cannot write formulas to .xls. Use .xlsx for live formulas.
- ExcelJS writes dates in UTC. Convert local dates to UTC midnight first (`xlDate`), or they land on the previous day.
