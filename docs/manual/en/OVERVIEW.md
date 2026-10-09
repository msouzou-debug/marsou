# How eCapital works

eCapital is ΟΚΥπΥ's system for the projects, contracts, permits to work and assets of its hospitals and services. It follows the life of a building or technical element from idea to replacement: project, contract, construction, handover, asset register, maintenance, replacement. Today that life lives in Excel files held by each hospital, with cost arriving from SAP weeks late. This guide explains in one read what the system does, who does what and where each thing lives.

## The basic idea

Everything belongs to a unit («Μονάδα»): one of the eight hospitals, three services or Central Administration. You see only the units you have been given. The database enforces that, not the screen, so a link to another unit's project answers «not found» and never shows the data.

A project moves through phases: Idea, Preparation, Approved, Tendered, Awarded, In progress, Practical completion, Defects liability, Closed. One phase at a time. Tendering happens in the public procurement system, not here; eCapital picks the contract up at award.

A project's cost is read as four figures: approved budget, commitments («Δεσμεύσεις»), spend («Δαπάνες»), forecast final cost. Commitments come from the contracts, spend from SAP and eFinance, the forecast from the contract plus pending variations plus contingency. Where there is no source, the screen shows «—», never zero.

## The roles

- **Head of estates.** Sees the unit's portfolio, approves contract variations, watches defects and assets.
- **Project engineer.** Records projects, contracts, milestones, risks, variations, requests for information, site instructions, defects. Requests shutdown permits.
- **Technician.** From a phone: records an asset's condition and readings, logs fault calls and runs work orders.
- **Finance.** Imports the SAP files, matches postings to projects, changes the approved budget, receives and pays payment certificates, produces the accruals.
- **Clinical approver.** Approves the shutdown permits that touch their area: infection control, nursing, unit director. The nursing side also logs fault calls.
- **Executive** and **Auditor.** See everything, change nothing. The auditor also sees the full audit trail.
- **System administrator.** Users, roles, units, contractors, the eFinance link.

Roles are given by the system administrator inside eCapital, on «Διαχείριση › Χρήστες». Active Directory only says who you are.

What each role sees and does in each area is set out in one table on the «Διαχείριση › Ρόλοι και δικαιώματα» tab.

## The menu, top to bottom

1. **Χαρτοφυλάκιο (Portfolio).** One row per unit with the four cost figures and a RAG colour. Where the executive and the head of estates start.
2. **Έργα (Projects).** The project list with filters, search, saved views and an Excel export. Each project has overview, cost, schedule, risks and issues.
3. **Συμβάσεις (Contracts).** Each contract with its value, bill of quantities, variations, RFIs, site instructions, defects, payment certificates and eFinance invoices.
4. **Διακοπές και άδειες (Shutdowns and permits).** A shutdown request, the infection-control risk assessment (ICRA), routing to approvers, an A4 permit print, closeout with a checklist, the disruption calendar.
5. **Πάγια (Assets).** The asset register per unit: identity, location, criticality, condition, warranty, readings, history, QR labels, replacement forecast.
6. **Συντήρηση (Maintenance).** Work orders with the contract's three timers, logging a call and running an order from a phone, preventive maintenance with the agreement and the systems catalogue, the maintenance backlog by risk band, and the contractor scorecard.
7. **Κόστος (Cost).** For finance: SAP import, the matching queue, accruals.
8. **Εγκρίσεις (Approvals).** Everything waiting for your decision: permits, variations, certificates. With keyboard shortcuts.
9. **Αναφορές (Reports).** The seven management reports: capital programme by unit, project exceptions, contractor scorecard, maintenance backlog by risk band, asset lifecycle, clinical disruption, statutory compliance. Each one downloads as Excel with live formulas and prints to PDF. For the head of estates, finance, the executive, the auditor and the administrator.
10. **Διαχείριση (Administration).** Users, contractors, eFinance.
11. **Οδηγοί (Guides).** The printable guides per role, this guide and the test scenarios.

The «Βοήθεια» button or the `?` key opens the help for the screen you are on. EN/ΕΛ switches the language of the whole system. The unit picker at the top left filters the screen you are on to one unit or returns to the whole of ΟΚΥπΥ.

## A typical flow

1. The project engineer records the project with title, category, unit and budget. It gets a code like `NGH-2026-012`.
2. They add milestones, one of them a phase gate, and the risks they see.
3. After award, they record the contract with the contractor, value, retention and budget code. The project's commitments update.
4. On site they record RFIs with a deadline, instructions and, when an instruction costs money, a variation. The variation is approved by somebody other than the person who submitted it.
5. If the work needs a system shutdown, they request a permit. The system derives the ICRA class and sends the permit to the right approvers. Work starts only on an approved permit and inside the approved period.
6. Finance imports the SAP files every month. Postings that do not match by themselves go to the queue, where they are matched with the keyboard. The project's spend rises.
7. The engineer approves the works on a payment certificate; finance receives and pays it.
8. At handover the defects are recorded with a risk band and a cost. What stays unfunded is the input to the next capital programme.
9. The equipment handed over enters the asset register with its source project and contract, and its life starts there: condition, readings, replacement year.
10. Maintenance runs under the unit's maintenance agreement. The programme issues the preventive orders. A fault is logged as a call and the timers count from the time of the call. When an asset fails a third time within twelve months, the system drafts a replacement in the maintenance backlog, and from there the replacement becomes a new project.

## Rules that apply everywhere

- Every change goes to the audit trail with who, when, before and after. It is never deleted.
- Nobody approves what they submitted: variations, certificates, permits.
- After approval, only finance changes the approved budget.
- A cost warning or a permit clash tells you; it does not block you. If you dismiss it, the dismissal is recorded with a reason.
- Amounts as «1.234,56 €», dates as dd/mm/yyyy, Cyprus time.
- The system holds no patient data.

## The other systems

eCapital works with three ΟΚΥπΥ systems. From **eFinance** it reads each contract's invoices, requisitions and budget position, and it will send contracts to eFinance once the register holds real projects. To **eArchive** it sends documents for protocol numbering and keeps the number, holding no archive of its own. To **eMAP** it links out for the procurement process.

## What does not exist yet

Running work orders offline, sending contracts to eFinance (switched on once the real projects are loaded), Active Directory sign-in (waiting on the IT department), reports sent by email on a schedule. The reports are here now: open them, download them as Excel and print them whenever you need them.
