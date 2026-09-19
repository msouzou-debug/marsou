# ADR-0021 — The cost module: a seam for SAP, four ledgers that never collapse, and warnings that never block

**Status:** accepted · 19/09/2026

## Context

M2 is the cost engine: R11 (payment certificates), R13 (four ledgers), R14 (the SAP extract import and its unmatched queue), R15 (a swappable cost source), R16 (forecast and cost to complete), R17 (cash flow), R18 (year-end accruals) and R31 (warn-and-flag rules).

Three sentences in CAPEX-01 set most of what follows. §7: *"Four independent ledgers per project and per contract. Never collapse them into one number."* §7 again, on ingestion: *"Phase 2: swap the file reader for the SAP MCP interface behind the same `CostSource` interface. Nothing above the interface changes."* And §1: *"Budget control is warn-and-flag, never a hard block."*

`packages/shared/src/cost.ts` was written before the API and is the contract with the web app. It is implemented field for field; where this ADR adds something, it says so and says why.

## Decision

### 1. The cost source is an interface, and only one file knows what a file is

`CostSourceReader.read(input): AsyncIterable<RawCostRow>` in `src/cost/source/cost-source.ts`. Two implementations: `SapExtractReader`, which reads .xlsx with exceljs and .csv with fifty lines of its own, and `SapMcpReader`, which implements the same interface and throws `errors.costSourceNotConfigured`.

The stub is not decoration. It is registered beside the file reader, the pipeline reaches it through the same call, and a test drives it. The claim "the source is swappable" is otherwise something nobody finds out is false until the day it matters.

`CostSourceRequest.payload` is `unknown` and travels through the pipeline untouched. The controller that received an upload is the only thing that ever looks inside it. `CostImportsService` never mentions a buffer, a file name or a sheet; it takes a hash and a display name as metadata and asks the reader for rows.

**A row that cannot be read is still a row.** The reader attaches problems to it rather than throwing, because one unreadable amount in a three-thousand-line extract must not cost the other two thousand nine hundred and ninety-nine. The rule underneath it is ADR-0016's, and it matters more than any of the formats: **a cell that cannot be read is refused, never coerced.** A reader that answers `0` for «περίπου 3.000» produces a reconciliation that ties perfectly to a file that is wrong.

### 2. The column map is a YAML profile, one per report

`src/cost/profiles/{me2n,ksb1,fbl1n}.yaml`, loaded and validated by zod at load time, exactly as ADR-0016 does for the capex plan. A column that moved is an edit to a YAML file; a genuinely new kind of cell is a code change, because a profile may only name a target the reader already knows how to fill.

Two differences from the capex profile, both because a SAP list is not a form:

- **Columns are matched by header text, not by letter.** The columns come out in whatever order the layout the clerk saved puts them in. Headers are folded — accents off, capitals down, punctuation dropped — so «Έγγραφο αγοράς», «ΕΓΓΡΑΦΟ ΑΓΟΡΑΣ» and «Εγγραφο αγορας» are one column.
- **The profile carries the number format, the date format and the sign convention.** A Greek client writes «1.234,56», puts the minus on the right («2.400,00-») and dates documents «31.03.2026». FBL1N posts a vendor invoice as a credit on the vendor account, so its profile says `sign: invert` and the ledger gets spend as positive and a credit note as negative, which is what CAPEX-01 §12's "credits negative" means. ME2N and KSB1 post debits and say `as_posted`.

### 3. The matching order is WBS, then PO, then cost centre, then what somebody decided last month

CAPEX-01 §7 gives the first three. The remembered rule goes last on purpose: a WBS element, a purchase order and a cost centre are facts SAP is carrying this month, and a rule is a judgement somebody made in September. **A judgement yields to a fact.**

- **WBS** matches `project.sap_wbs` exactly, then as the longest prefix ending on a separator, because SAP hangs sub-elements off a WBS and the posting carries the leaf.
- **PO** matches `contract.sap_po_number`, and the contract names the project.
- **Cost centre** matches `project.cost_centre`, **a column CAPEX-01 §4 does not have.** It is added by migration 0011. Without it the third step has nothing to compare against and every KSB1 row with no WBS and no PO falls straight through to the queue.
- **Rule** is `allocation_rule`: the folded vendor name plus the folded narrative, pointing at a project and optionally a contract. The narrative is folded with its digits and punctuation removed, so «ΤΙΜΟΛΟΓΙΟ 4417/ΜΑΡΤΙΟΣ» and «Τιμολόγιο 4692 / Απρίλιος» are the same rule and next month's invoice matches the one somebody placed by hand this month.

The folding is written twice — `ecapital.normalise` in SQL and `normalise` in `src/cost/text.ts` — because the rule's key is folded when it is stored and the incoming row is folded before it is looked up. A test asserts the two answer the same for the awkward strings. If they ever disagreed, every remembered rule would quietly stop matching and the queue would grow again with nobody able to say why.

### 4. A row with no project belongs to no unit

`cost_txn.org_unit_id` becomes nullable. A row in the unmatched queue is not in anybody's unit, because nobody knows yet which unit it is in — that is what the queue is for. Two predicates carry the consequence:

- `can_read_unallocated()` — everyone who may open the cost screens, the two read-only roles included.
- `can_allocate_unallocated()` — the three roles that import, plus the engineers, who CAPEX-01 §1 has running ten to twenty projects each.

**An engineer may allocate a row only to a project in their own units, and that is not checked in the service.** The policy's `USING` clause lets them pick up a row that belongs to nobody; the `WITH CHECK`, evaluated after the trigger has copied the project's unit onto the row, refuses to let them put it down anywhere they may not write. An engineer at Larnaca pointing a row at a Nicosia project gets 404, not 403, because a project they may not see does not exist for them (ADR-0010).

### 5. The dry run is the default, and the same file twice is refused

ADR-0016's reasoning, unchanged: reading what would happen is the normal case and writing is the exception you ask for. A dry run writes nothing at all — not even the batch — and answers the same `ImportBatch` summary with a synthetic id and the first fifty exceptions.

A committed import is refused if a batch already carries the file's SHA-256 for the same report: 409, `errors.costImportDuplicate`. A unique index backs the check, so a race between two clerks loses the second one rather than posting the month twice. A dry run of the same file is allowed, because re-reading a file is how somebody checks what changed.

**A batch with nothing unmatched is COMMITTED on arrival.** There is no queue to work, and asking somebody to press «Ολοκλήρωση» on an empty list is ceremony.

### 6. Skipping is not rejecting

`POST /cost/imports/:id/skip` leaves the rows unmatched and stops the queue offering them, so the next row can be dealt with. They stay in the batch and in the reconciliation, and allocating one later puts it straight back in the ledger. On commit, whatever is still unmatched becomes an `import_exception` with rule `SKIPPED`, so the reconciliation says what was left behind and next month's allocator can find it.

### 7. The four ledgers, and why they are full of nulls

- **Approved** — the `BUDGET` lines of the latest vintage, summed across years and available per year.
- **Committed** — the contracts' `current_value`, or the SAP purchase-order balance once an extract has posted one against the project. `committedSource` says which, because CAPEX-01 §7 asks for the provenance so nobody mixes the contract ledger with the SAP balance without knowing.
- **Spent** — the `ACTUAL` postings.
- **Forecast** — committed + submitted variations × `pendingVariationWeight` + contingency. The **approved** variations are deliberately not added: `contract.current_value` already includes them (ADR-0015) and the SAP balance is what SAP is holding, so adding them again would count every approved change twice.
- **Cost to complete** — forecast − spent.

**A ledger with no source is null, never zero.** A project nobody has committed anything on has no commitment; €0 would read as "we have committed nothing", which is a claim the system has not got. This is the existing convention on the contract screens and it is kept here without exception, including in the Excel export, where such a cell is empty rather than a zero somebody could add up.

**The vintage.** Vintages sort by id — «2025-prior», «2026-02» — and the system vintage `ecapital`, which is what somebody typed in eCapital rather than imported, sorts last on purpose: a correction made here supersedes the revision it was made against, and the imported vintages are never rewritten.

**The categories.** `budget_line.category` was typed as `project_category` in migration 0005, which is the wrong vocabulary and which nothing ever wrote. It becomes text with a closed list — `works`, `equipment`, `fees`, `contingency`, `other` — in the lower-case spelling the interface uses as an i18n key suffix. Money with no category lands in `uncategorised`, «Χωρίς κατηγορία».

A contract has no cost category: CAPEX-01 §4 gives it a type and a value and nothing else. So contract-sourced commitment, the weighted variations and the contingency all land in `uncategorised` rather than being spread across categories by a rule nobody agreed. That keeps the column adding up to the headline ledger, which matters more than a tidier-looking table.

**One budget line per project, vintage and year.** The unique index migration 0005 created says so, and `PUT /projects/:id/budget-lines` validates the same thing, so a project-year carries one category. Widening that index would break the capex importer's `ON CONFLICT`; if finance ever needs a category split within a year, it is a migration and an ADR, not a quiet change.

### 8. Warnings are rows, they fire on read, and they never block

All five rules of R31 are evaluated on read — opening the cost screen is how somebody finds out — and again on every write that can move one: an import commit, an allocation, a variation approval, a payment-certificate transition and a change to the budget lines. The variation hook lives in `ContractsService.decideVariation` and calls into `CostWarningsService` rather than growing a second implementation of the five rules.

They are **rows** so a dismissal survives the next page load, and the sentence is stored in both languages because the system never machine-translates (CAPEX-01 §6.1) and the figures inside it were formatted when it fired.

`ecapital.record_cost_warning` is `SECURITY DEFINER`. A read-only account must be able to open the cost screen, and it cannot be the one to insert the warning row that opening it produces — under its own policy it would be refused and the screen would fail. The audit trigger still records the caller as the actor, which is what R42 needs.

**A dismissed rule that moves fires again as a new row** beside the dismissed one, which is how somebody who waved away «€40.000 over» hears about €900.000. A rule that stops holding has its live row deleted; the audit log keeps the `DELETE` with its before-image, which is the record that it ever fired.

**`commitmentOverYearBudget` fires on the worst year only.** A five-year project whose profile is out by a thousand euro in each year would otherwise produce five identical sentences. The year's commitment is what SAP holds open against it where an extract exists, and otherwise the contracts that start in that year — a contract commits the organisation from the day it starts, whatever SAP has caught up with.

### 9. The email to the head of estates is a row, not a message

CAPEX-01 §7 says each rule "fires a flag on the project, an entry in the exceptions list and an email to the head of estates". The flag and the entry are the warning row. **There is no SMTP server configured for eCapital and this milestone does not add one.** Inventing one would either send mail nobody asked for or fail every write that produces a warning.

`email_outbox` gets a row per newly fired warning, addressed to the active heads of estates of the project's unit, written by `ecapital.queue_email` inside the same transaction as the warning. Nothing sends it. When there is a mail server, the sender reads the table and stamps `sent_at`; until then the row is the record that the organisation decided to tell somebody, which is the part an auditor asks about.

### 10. The derived figures on a payment certificate are the API's

`PaymentCertCreate` carries the period, the work done and the materials on site, and nothing else. The API computes, per the comment on `PaymentCert` in `packages/shared`:

```
retentionHeld     = retentionPct × (workDone + materials)
previousCertified = Σ (workDone + materials) of the earlier certificates
netPayable        = workDone + materials − retentionHeld − previousCertified
```

`workDoneValue` is cumulative to date, which is why the earlier certificates come off the top: the certificate pays for the difference. Retention is returned as well as subtracted, because CAPEX-02 §7 keeps it as its own line and never nets it silently. They are stored columns and not a view, because they are what was certified on the day — a retention percentage that changes next year must not rewrite last year's certificate.

**The build brief's §7 sentence and the shared contract disagree about the retention base.** The brief's shorthand is retention on the work done; the contract says `retentionPct × (workDone + materials)`. The contract is what the web app is built against and it is what is implemented; the Errata records it.

The number is allocated by `ecapital.allocate_payment_cert_number` behind a transaction-scoped advisory lock on the contract — the same machinery and the same reasoning as ADR-0015's variation number.

**The segregation rule is written three times, exactly as ADR-0015 said it would be here:** in `PaymentCertsService.transition` where the 403 and the sentence come from, as the CHECK constraint `payment_cert_approver_not_creator`, and as the role list on the route. The forward-only rule is a trigger as well, because a CHECK cannot see where a row came from.

### 11. `retentionReleased` on the transition body

`PaymentCertTransition` in the shared contract carries the invoice reference and the paid date. Releasing the retention is the one other thing that happens to a certificate, it happens on the same screen and at the same moment, and R31 gives it a rule of its own. The API's `PaymentCertTransitionBody` adds an **optional** `retentionReleased`, so a body written against the shared schema is still valid and the web app can adopt it when it needs it. Released before the defects-liability period ends fires `retentionBeforeDlpEnd` and **does not block**: the money has already left, and what the system can do is make sure somebody knows.

### 12. Cash flow is twelfths

R17's plan is the year's budget line spread evenly over its twelve months. Nobody at ΟΚΥπΥ profiles a capital budget by month, and inventing an S-curve would be the system making up a forecast nobody agreed. Twelfths are obviously a straight line, which is honest. The «after 2028» sentinel year 9999 (CAPEX-03 §2) has no months to spread over and is left out of the profile; it is still in the approved total.

### 13. The exports carry formulas, not answers

R18's accrual proposal and the project's category table are written with exceljs. The accrual column is `=Fn-Gn` in the cell and the totals are `=SUM(...)`; the variance column is `=En-Bn`. **Nothing writes a calculated value into a calculated column.** A pasted number is not auditable, and the point of the file is that whoever receives it can change a figure and watch the total move. Greek headers in row 1, English in row 2, `#,##0.00` on every money column.

Invoiced can exceed certified net (a contractor billed ahead of what has been certified), and a negative accrual is not a smaller accrual, it is over-invoicing — the API clamps `accrual` to `max(0, certifiedNet − invoiced)`, the exported formula is `=MAX(0,Fn-Gn)`, and the row carries a new `overInvoiced` flag the accruals screen shows as a note rather than a negative euro figure (screenshot review 19/09/2026).

## Consequences

- Swapping the file reader for the SAP MCP interface is work in `SapMcpReader` and nowhere else. If it turns out to be work in three other files as well, the seam was wrong and this ADR was optimistic.
- A SAP layout that moves a column is a YAML edit. A layout that means something new is a code change and another ADR.
- `cost_txn.org_unit_id` is nullable, so every future query over the ledger has to decide what it means by a row with no unit. The two policy predicates are the only place that decision is written down.
- Warnings are written on read, so a `GET` can produce audit rows. That is deliberate — the rule fired, and the log should say when — and it is why `record_cost_warning` returns early when nothing has moved, so opening the same screen twice does not grow the trail.
- `email_outbox` will hold unsent rows until somebody builds a sender. That is visible, which is the point; a silent `TODO` in a service would not be.
- The capex importer's reconciliation report moved from `import_batch.report` to `import_batch.report_json`, because `report` is now the SAP report a cost extract came from. One column rename, in migration 0011, with the CLI following in the same commit.
