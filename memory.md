# memory.md

Standing rules and decisions for this project. Read at the start of every session. Add to it when the owner decides something; keep one line per fact.

## Writing rules (owner's standard, all sessions)

- Any Greek text: load `greek-how-to-write`, `okypy-greek-terms` and `hellenic-linguist` first. The glossary wins over any other wording.
- Any English or Greek text: also load `natural-document-writer`, `write-like-a-human`, `anti-ai-writing` and `humanize`.
- Short, plain, active voice. No em dashes as asides, no promotional words. State assumptions and shortcuts.
- Ask questions before building. Prefer the simple solution.
- Excel outputs: live formulas, auditable.

## Greek terms approved on 13/11/2026 (also in the `okypy-greek-terms` skill)

| Avoid | Use |
|---|---|
| Αποθήκευση πρόχειρου | Αποθήκευση ως πρόχειρο |
| Προσθήκη αποχωρήσαντος | Προσθήκη ατόμου που αποχώρησε |

| Meaning | Use |
|---|---|
| Withdraw request (button) | Απόσυρση αιτήματος |
| Withdrawn (status) | Αποσύρθηκε |
| Keep my answer (button) | Διατήρηση της απάντησής μου |
| On hold, while the request is with the requester | Σε αναμονή |
| View request (email button, as in eFinance) | Προβολή αιτήματος |

The full glossary lives in the skill. When the owner fixes or approves a term: update the skill, send the owner the updated skill file, and add the row here.

## Project decisions

- 12/11/2026, Marios: eFinance must not hold HR information for now. eHR is a separate app with its own database. Any link to eFinance is narrow, read-only, without personal data, and agreed through Marios.
- «Έγκριση Θέσεων» (`position-approval`) is the first module of eHR. Briefs: `claude/position-approval-01-…` (build) and `-02-…` (UI), both version 2.
- Stack follows eFinance: Python 3.10, Flask 3.1.3, Jinja, Bootstrap 5.3.3, everything served locally. See `docs/adr/0001-stack.md`.
- Emails never record an action. One button, «Προβολή αιτήματος», then sign-in, then the request.
- Nobody acts on a request they submitted.
- Build runs with Fable 5.2 as orchestrator and the subagents in `.claude/agents/`. Contracts in `docs/contracts/` come first; subagents build against them.
- No real request data, staff names or ΟΑΥ files in a Claude session. Invented sample data only.
- Shared-server rules: own system user, service and port; Marios runs every sudo step; full test suite passes before any install; never restart another app's service.
- Design: Claude Design works from the UI brief. Hand-over points are in `docs/design/coordination-with-claude-design.md`.

## Status

- 13/11/2026: Phase 0 done (ADR, four contracts, subagent definitions, empty app with tests). Waiting on the server pack from Marios and on the owner's answers to O1 to O5 in `docs/contracts/02-state-machine.md`, section 10.
