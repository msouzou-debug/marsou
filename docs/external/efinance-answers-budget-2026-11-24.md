# eFinance answers to eHire: the 11 budget questions (24/11/2026)

These answer the 11 questions in `request-to-efinance-2026-11-23.md`. The zip itself never reached the eFinance side, so the questions were taken from the summary Marios passed on. **We have not seen the contract**, so question 9 proposes a shape instead of commenting on yours.

Everything below comes from the live code and a read-only look at the live database. No personal data was involved.

## The one thing to know first

**eFinance doesn't track payroll spending.** «Spent» in eFinance counts only invoices that went through eFinance. Salaries are paid through payroll and SAP, never as invoices, so on every payroll line «spent» is always zero and «available» shows the whole budget. A hiring decision made on that figure would be wrong. Questions 3 and 4 explain this, and question 9 proposes what to do about it.

## 1. Budget lines

Three tables hold the budget:

| Table | Columns that matter |
|---|---|
| `budget_codes` | `code`, `description`, `category`, `is_operational`, `is_active` |
| `budget_allocations` | `budget_code_id` (→ budget_codes.id), `hospital_code` (the entity), `fiscal_year`, `allocated_amount`, `updated_at` |
| `gl_budget_map` | `gl_account` → `budget_code` (550 rows; links SAP GL accounts to budget codes) |

**A budget line is budget code + entity + year.** Cost centres play no part (see question 6). «Spent» and «committed» are not stored: they are worked out on each request from the invoices (see question 4).

Invented example:

| code | description | hospital_code | fiscal_year | allocated_amount |
|---|---|---|---|---|
| 2102 | BASIC PAY | LGH | 2027 | 4.250.000,00 |

**Live state today:** 207 budget codes, but only **3 budget lines loaded, all test lines** (HQ, 2026). Real budgets haven't been entered yet.

## 2. Article

eFinance calls it a **budget code** («κονδύλι», `budget_code`). It's 4 digits, for example 2102, matching the SAP commitment item. The description is the SAP English short text, cut at 20 characters, for example «BASIC PAY» or «SOCIAL INS.FUND-8.3%». Only 2 of the 207 have Greek text, so for now **there is no Greek name per code**.

## 3. Payroll lines

There is no flag or category for payroll; the `category` column is empty for these codes. **They can be told apart by range: 2102 to 2499** (39 codes). This covers basic pay, 13th salary, allowances, overtime, shifts, and employer contributions (Social Insurance, Cohesion Fund, pension and provident funds, ΓεΣΥ). 2302 and 2490 are hourly-paid staff. 43 GL accounts map to these codes, for example 511010 → 2102.

Two nearby codes are **not** pay: 1870/1876 (contributions received) and 3003/3004 (subsistence and commuted allowances, which are travel). If eHire lists 2102–2499 first, Finance should confirm the range.

## 4. Available

```
available = budget − spent − open requisitions
```

- **spent**: invoices in status `parked` or `approved`, invoice year = budget year, including VAT (shared out line by line), only on GL accounts that map to the code.
- **open requisitions**: requisitions not closed, not rejected, draft or cancelled. **So yes, requisitions still in approval count**, less whatever has already been invoiced and approved against them, so nothing is counted twice.
- **invoices still being checked** (`extracted`, `review`, `on_hold`, `analyzed`, `park_ready`) are shown on screen as «committed» but **not subtracted**. They count once approved.

When no budget is loaded for a line, «budget» and «available» come back empty, not zero, so a screen can say "no budget loaded".

## 5. Freshness

**Budgets are not loaded from SAP.** Finance enters them by hand on the eFinance budget page (`/budget/allocate`), one line at a time. «Spent» comes only from eFinance's own invoices, so it is always up to date, but it isn't SAP's total.

For "figures as of", each budget line has `updated_at`, the time it was last changed by hand. eFinance has no SAP load timestamp. The SAP connector being built now (its budget check covers payments since 21/11) could later provide real SAP actuals, but that isn't connected yet.

## 6. Level

**Per entity, not per cost centre.** `budget_allocations` has no cost-centre column, and the GL-to-budget map has none filled either. A cost centre belongs to one entity (`cost_centres.entity_code`; 1.702 cost centres across 12 entities), so for a cost centre eHire should show **the budget lines of its entity**. Say so on screen: "budget of the whole hospital, not of this department".

## 7. Year

`fiscal_year` is a whole number, the **calendar year**. Next year's budget exists only once Finance enters it. Nothing loads it automatically before January, so eHire must cope with "no budget for 2027 yet".

## 8. Cost centres

- **The `active` flag changes only by hand.** The import adds new cost centres and updates names and entities, but never switches one off. 42 of 1.702 are switched off today.
- **Never deleted.** **Renamed**: yes, the name is overwritten on each import, and the code stays.
- Once SAP sends its "expired" notice (their open item 3, still waiting), the plan is to switch the flag off automatically.

## 9. Shape

Without the contract in front of us, here is the shape that fits eFinance's data. eHire can compare it with its own.

**`GET /api/ehire/cost-centres`**

```json
{"as_of": "2026-11-24T09:00:00Z",
 "items": [{"code": "1000000100", "name": "…", "entity_code": "HQ", "active": true}]}
```

**`GET /api/ehire/budget?cost_centre=1000000100&year=2027`**

```json
{"cost_centre": "1000000100", "entity_code": "HQ", "year": 2027,
 "level": "entity",
 "lines": [{"budget_code": "2102", "description": "BASIC PAY", "payroll": true,
            "budget": 4250000.00, "spent": 0.00, "open_requisitions": 0.00,
            "available": 4250000.00, "budget_updated_at": "2026-12-15T10:00:00Z",
            "spent_covers": "efinance_invoices_only"}]}
```

- **`level: "entity"`** says plainly that the figures belong to the whole entity.
- **`payroll: true`** comes from the 2102–2499 range.
- **`spent_covers`** says that «spent» excludes salaries. Our advice: on payroll lines, eHire shows only «budget» and leaves «spent» and «available» out until SAP actuals are connected.
- **`budget: null`** means no budget has been loaded.

No personal data travels in either direction.

## 10. Token

Yes, eFinance has one pattern, already used for eArchive's callback (`/api/dms/events`):

- the call is accepted **only from the same server**; eFinance refuses anything that comes through nginx or Cloudflare;
- `Authorization: Bearer <token>`, compared in constant time;
- the token sits in eFinance's settings file. Each side reads it from its own protected file, and it is never sent by email or chat.

eHire would get its own token, used only for these two calls.

## 11. Effort and risk

Small: about **a day, tests included**. It means two read-only services and one token check, built on code that already exists (the budget sums are the same ones the requisition page uses). **It doesn't touch the approval, payment or SAP posting code**, and it writes nothing.

The real limits are in the data, not the code: real budgets haven't been entered, and payroll actuals aren't in eFinance.

**Building it needs Marios's go-ahead.**
