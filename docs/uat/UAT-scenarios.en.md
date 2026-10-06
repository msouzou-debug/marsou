# eCapital — User acceptance test scenarios (UAT)

Version 06/10/2026. For the test installation at `ecapital.shso.online` with the sample data (41 projects, 17 contracts, 8 permits, 26 assets, the Nicosia maintenance agreement with three months of orders). Nothing in it is real. The Greek file `UAT-scenarios.el.md` is the one testers use; this is the same list in English, with the Greek screen names kept as they appear on screen.

## Before you start

- The system administrator has given you a username and password, or set a password on one of the sample accounts in the table.
- Use Chrome or Edge. For the phone scenarios, your phone or the browser window narrowed to 390 px.
- Every scenario has an expected result. Mark it Passed, Failed or Passed with a remark, and write two lines about anything that surprised you. Each screen's help opens from the «Βοήθεια» button or the `?` key.

| Account | Role | Sees |
|---|---|---|
| `admin@ecapital.test` | Administrator | Every unit and the admin area |
| `estates.nicosia@ecapital.test` | Head of estates | Nicosia General |
| `engineer.larnaca@ecapital.test` | Project engineer | Larnaca General |
| `engineer.nicosia@ecapital.test` | Project engineer | Nicosia General |
| `technician.nicosia@ecapital.test` | Technician | Nicosia, field records only |
| `clinical.nicosia@ecapital.test` | Clinical approver (infection control) | Nicosia permits |
| `nursing.nicosia@ecapital.test` | Clinical approver (nursing) | Nicosia permits |
| `director.nicosia@ecapital.test` | Clinical approver (hospital director) | Nicosia permits |
| `finance@ecapital.test` | Finance | Cost, every unit |
| `auditor@ecapital.test` | Auditor | Everything, read only |
| `executive@ecapital.test` | Executive | Everything, read only |

Columns of every table: Steps, Expected, Result (you fill it in).

## A. Sign-in and access (everybody)

| # | Steps | Expected | Result |
|---|---|---|---|
| A1 | Open the page. Type your username and a wrong password. | «Το όνομα χρήστη ή ο κωδικός δεν είναι σωστά». Nothing more. | |
| A2 | Type the right password. | You land on the portfolio. Your name shows top right. | |
| A3 | As `engineer.larnaca`, open the unit switcher top left. | Larnaca only. As `admin`, all twelve units. | |
| A4 | Switch language with the EN/ΕΛ button. | The whole screen changes. Amounts stay «1.234,56 €», dates dd/mm/yyyy. | |
| A5 | Press `?` on any screen. | That screen's help opens, in the language you chose. | |
| A6 | Press «Οδηγοί» in the menu. | A list of PDFs: the general guide, the UAT scenarios and one guide per role and language. Download yours. | |
| A7 | Press «Αποσύνδεση», then the browser's back button. | You are back on the sign-in page, never on data. | |
| A8 | As `admin`, type a wrong password five times for a test account, then the right one. | The right one is refused too. After fifteen minutes it works. | |

## B. Portfolio and projects (head of estates, engineer, executive)

| # | Steps | Expected | Result |
|---|---|---|---|
| B1 | As `estates.nicosia`, look at the portfolio. | One row per unit you see, with approved, commitments, spend, forecast and a RAG colour. Where there is no source, «—» and never 0. | |
| B2 | Press the Nicosia row. | The project list opens, filtered to Nicosia. | |
| B3 | In projects, filter by phase «Σε εξέλιξη» and search «χειρουργ». | The list shrinks. «Ανακαίνιση χειρουργείων» is there. | |
| B4 | Open the project. Look at the tabs: overview, schedule, risks and issues, cost. | The overview's amounts agree with the cost tab. | |
| B5 | Press «Νέο έργο». Leave the title empty and save. | A message on the field, not a general error. | |
| B6 | Fill in title, category, unit, budget. Save. | The project gets a code like `NGH-2026-0xx` and opens. | |
| B7 | On the schedule, add a milestone dated before the previous one. | The system accepts it or warns, but loses nothing. Note what you saw. | |
| B8 | On risks, add a risk with likelihood 4 and impact 5. | It shows with a red score at the top of the list. | |
| B9 | As `executive`, try to change a project's title. | There is no edit button, or the save is refused with a read-only message. | |
| B10 | As `engineer.larnaca`, paste the link of a Nicosia project into the address bar. | A not-found message. Never the data. | |

## C. Contracts (engineer, head of estates, finance)

| # | Steps | Expected | Result |
|---|---|---|---|
| C1 | Open contracts. Open one with a `CAP-…` reference. | Contract value, variations, certificates, and the eFinance block saying not sent, or the equivalent. | |
| C2 | As `engineer.nicosia`, on the variations tab submit a variation of 5.000,00 €. | Saved as submitted. The approve button is not shown to you. | |
| C3 | As `estates.nicosia`, approve that variation. | Approved. The contract value changes. On the portfolio the unit's commitments change accordingly. | |
| C4 | As `engineer.nicosia`, try to approve your own variation. | Refused: nobody approves what they submitted. | |
| C5 | RFI tab. Open one with a red timer. | The SLA timer shows days overdue. Answer it. The timer stops. | |
| C6 | Instructions tab. Turn an instruction into a variation. | A variation is created with a link to the instruction. | |
| C7 | Defects tab. Add a defect with risk band high and an estimated cost. | It joins the list, band coloured. | |
| C8 | As `finance`, payment certificates tab. Create a certificate with 10% retention (Κρατήσεις). | The net amount is right. Draft to approved to paid, with a date. | |
| C9 | As `engineer.larnaca`, try to change a project's approved budget. | Refused: only finance changes it. | |

## D. Cost (finance)

| # | Steps | Expected | Result |
|---|---|---|---|
| D1 | Cost › SAP import. Look at the two batches. | One has 12 unmatched lines in the queue. | |
| D2 | Open the queue. Match a line to a project with the keyboard (arrows, Enter). | The line leaves the queue. The project's spend rises. | |
| D3 | Tick «remember this rule» on a match. | The next batch with the same cost centre matches by itself. | |
| D4 | On a project, cost tab. Look at the warnings. | The two flagged warnings show. Dismiss one with a reason. The dismissal is recorded. | |
| D5 | Cost › accruals. Download the Excel. | The file opens. Formulas are live, not values. The amount never goes below 0. | |
| D6 | As `estates.nicosia`, look for the cost menu. | It is not shown. | |

## E. Shutdowns and permits (engineer, clinical approvers, technician)

| # | Steps | Expected | Result |
|---|---|---|---|
| E1 | As `engineer.nicosia`, new shutdown. Pick a system, an area, a window tomorrow 08:00 to 12:00. | The ICRA wizard gives a class and measures. The permit is created as awaiting approval, routed to the approvers. | |
| E2 | Look at the permit's window again. | 08:00 shows as 08:00, not 11:00. | |
| E3 | As `clinical.nicosia`, approvals. Approve with the keyboard (A). | The row leaves. The badge in the menu drops by one. | |
| E4 | As `nursing.nicosia` and `director.nicosia`, approve your own line. | After the last approval the permit becomes approved. | |
| E5 | As `engineer.nicosia`, try to approve your own permit. | No button. You are the requester. | |
| E6 | Print the permit (S13). | One A4 page with every measure and signature line. | |
| E7 | Create a second permit in the same area, same window. | A clash warning. It does not block, it tells you. | |
| E8 | Disruption calendar («Ημερολόγιο διαταράξεων»). | Both show on the right day. | |
| E9 | After the window, close the permit with the checklist. | Without every box ticked it does not close. With all of them, it is closed. | |
| E10 | On the project with an open permit, try to change phase. | A message that a permit is open. | |

## F. Assets (head of estates, engineer, technician)

| # | Steps | Expected | Result |
|---|---|---|---|
| F1 | Assets. Search «ψύκτης». | «Ψύκτης Ψ-Λ1, δώμα νέας πτέρυγας» appears. | |
| F2 | Open it. | Location, criticality, condition, warranty, source project and contract, history. | |
| F3 | As `technician.nicosia` on a phone, record condition «Κακή» and a running-hours reading. | Saved. The history shows it under your name. | |
| F4 | As `technician.nicosia`, try to rename the asset. | Not allowed. | |
| F5 | Print a QR label sheet for five assets. | Five labels, each QR opens the asset from a phone. | |
| F6 | Replacement forecast. | Assets by year, with estimated cost. | |

## G. Administration (administrator)

| # | Steps | Expected | Result |
|---|---|---|---|
| G1 | Admin › users. Add a user with the project engineer role and no unit. | Refused: the role needs a unit. | |
| G2 | Add them with Larnaca. Open them again and set a 7-character password. | Refused: at least 8. With 8 or more, «Ο κωδικός ορίστηκε». | |
| G3 | Sign in as the new user in another window. | They get in and see Larnaca only. | |
| G4 | Deactivate them. In the other window, reload. | The user lands on the sign-in page. | |
| G5 | Try to remove your own administrator role. | Refused. | |
| G6 | Try to tick the auditor role on somebody. | The box is locked. | |
| G7 | Admin › contractors. Search a vendor in the eFinance field. | A vendor list with codes. One marked blocked in eFinance cannot be picked. | |
| G8 | Admin › eFinance. Press sync. | A last-run time and zero errors. | |

## H. Auditor and executive

| # | Steps | Expected | Result |
|---|---|---|---|
| H1 | As `auditor`, open a project and its audit trail. | Every change with who, when, before and after. Nothing from tests B to G is missing. | |
| H2 | As `auditor`, try any save. | Refused with a read-only message. | |
| H3 | As `executive`, portfolio. | Every unit. The amounts agree with what `admin` sees. | |

## I. Phone (390 px)

| # | Steps | Expected | Result |
|---|---|---|---|
| I1 | Open the portfolio on a phone. | A bottom bar with portfolio, approvals, maintenance, more. No horizontal scroll. | |
| I2 | Approvals on a phone. | Each row with approve and reject buttons a thumb can press. | |
| I3 | Project list on a phone. | Cards instead of a table. | |

## J. Maintenance (head of estates, engineer, technician, nursing)

| # | Steps | Expected | Result |
|---|---|---|---|
| J1 | As `estates.nicosia`, Συντήρηση. | Six tiles at the top and the work order list with the newest calls first. Each corrective order has three timers: response, restore, written report. A preventive order has only its programme date. | |
| J2 | As `nursing.nicosia` on a phone, Νέα κλήση. Find a lift by its name, write «Σταματά ανάμεσα σε ορόφους». | The unit is already picked and the source is «Νοσηλευτική υπηρεσία». Before submitting, the three deadlines show, counted from the call time. | |
| J3 | Submit. | The new order opens with a ref like `NGH-WO-2026-…`. As `nursing.nicosia` you see no action buttons: you log calls, you do not move them on. | |
| J4 | As `technician.nicosia` on a phone, open the same order and press «Εκτέλεση από κινητό». Press «Έναρξη», then «Παύση» and «Συνέχιση». | Large buttons at the bottom, only the valid ones each time. The camera shows wherever you are on the page. No horizontal scroll. | |
| J5 | Take a photo with the camera button. | The photo shows in the strip and in the order's history under your name. | |
| J6 | Press «Αποκατάσταση», then «Ολοκλήρωση» without codes. | The restore is recorded and its timer stops. Completion stays disabled until you pick the failure, cause and remedy codes. With all three, the order becomes «Ολοκληρώθηκε». | |
| J7 | As `estates.nicosia`, Νέα κλήση on a critical system, with the call time two hours earlier. | The response timer shows «Εκπρόθεσμο» and the «Εκπρόθεσμη ανταπόκριση» tile goes up by one. Within the next hour the order is marked «Κλιμάκωση». | |
| J8 | On an open corrective order, under «Εργασία και κόστος», set a 5-day extension with no reason. Then with a reason. | Without a reason it does not save. With one, the restore deadline moves and the response deadline does not. | |
| J9 | Cancel an open order with no reason, then with one. | Without a reason it is not cancelled. With one it becomes «Ακυρώθηκε» and the reason shows in the history. | |
| J10 | As `estates.nicosia`, Πρόγραμμα προληπτικής. | Agreement Α.Ο 42/24 with 24/7 cover, hours 07:30–15:00 and availability 8.600 hours. The catalogue with its 48 systems and the «Ρήτρες προς επιβεβαίωση» mark. | |
| J11 | Download the Excel template, clear one row's band, upload it. | The result table names the row that was not imported and why. The others are updated and no system is doubled. | |
| J12 | Press «Έκδοση τώρα» twice. | The first time issues the orders that are close to their date. The second issues none and says how many lines already had an open order. As `technician.nicosia` the button is not there. | |
| J13 | Εκκρεμότητες. As `engineer.nicosia` open an automatic draft. Then as `estates.nicosia` press «Σε έργο». | Totals by unit and risk band. The engineer does not see «Σε έργο». The head of estates confirms, a project is created at the Idea phase and the item becomes «Χρηματοδοτήθηκε». | |
| J14 | Αξιολόγηση, agreement Α.Ο 42/24, «Προηγούμενο τρίμηνο». Press «Εξαγωγή σε Excel». | On-time percentages with the «out of» counts, downtime hours and the «ρήτρες ελλιπείς» note. The Excel has formulas for the percentages and penalties. As `finance` the same amounts. | |

## K. Reports (head of estates, finance, executive, auditor)

| # | Steps | Expected | Result |
|---|---|---|---|
| K1 | As `executive`, Αναφορές. | Seven cards: capital programme by unit, project exceptions, contractor scorecard, maintenance backlog by risk band, asset lifecycle, clinical disruption, statutory compliance. Each card says who it is for and which filters it takes. | |
| K2 | As `engineer.nicosia`, look at the menu. Then type `/reports/capital-programme` in the address bar. | The menu has no «Αναφορές». The address shows «Δεν έχετε πρόσβαση σε αυτή τη σελίδα». | |
| K3 | As `finance`, capital programme by unit, «ΟΚΥπΥ — όλες οι μονάδες», year 2026. | One row per unit and a «Σύνολο» row. The approved budget per unit agrees with the portfolio. Where there is no SAP spend the cell shows «—», not 0. The meta line names the unit, the year and the time generated. | |
| K4 | Press «Λήψη Excel» and open the file. | The same figures as the screen. Totals, percentages and slippage are formulas, not numbers. Where the screen shows «—» the cell is blank. | |
| K5 | Press «Εκτύπωση / PDF» and choose «Save as PDF». | An A4 landscape page with no menu, filters or buttons. On every page the title, the meta line, the table headers and the page number. No row is split across pages. | |
| K6 | As `estates.nicosia`, contractor scorecard, «Προηγούμενο τρίμηνο». | A capital contractors table with «—» where the register has no data. A card for agreement Α.Ο 42/24 with the same percentages the maintenance scorecard shows for the same quarter, and the «ρήτρες ελλιπείς» note. | |
| K7 | As `auditor`, statutory compliance, Nicosia General Hospital. Print. | Four categories with done out of due, overdue and a percentage in green, amber or red. The printout comes out on A4 portrait. | |

## Not tested in this version

- Active Directory sign-in. Waiting on IT.
- Sending contracts to eFinance. The switch stays off while the data is sample data.
- Reports sent by email on a schedule. Reports open, download and print from the screen only.
- Running work orders offline. In this version the phone needs signal for every action.
- The maintenance agreement's penalty amounts. They are missing from the copy of the contract; the scorecard counts late items and does not price them.
- Sending documents to eArchive from the samples. Documents are recorded and queued.

## How to report a finding

One finding per line: scenario number, account, what you did, what you expected, what you saw, a screenshot. Send them to Technical Services with the subject «eCapital UAT».
