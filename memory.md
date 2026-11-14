# memory.md

Standing rules and decisions for this project. Read at the start of every session. Add to it when the owner decides something; keep one line per fact.

## Writing rules (owner's standard, all sessions)

- Any Greek text: load `greek-how-to-write`, `okypy-greek-terms` and `hellenic-linguist` first. The glossary wins over any other wording.
- Any English or Greek text: also load `natural-document-writer`, `write-like-a-human`, `anti-ai-writing` and `humanize`.
- Short, plain, active voice. No em dashes as asides, no promotional words. State assumptions and shortcuts.
- Ask questions before building. Prefer the simple solution.
- Excel outputs: live formulas, auditable.

## Greek terms approved on 13 and 14/11/2026 (also in the `okypy-greek-terms` skill)

| Avoid | Use |
|---|---|
| Αποθήκευση πρόχειρου | Αποθήκευση ως πρόχειρο |
| Προσθήκη αποχωρήσαντος | Προσθήκη ατόμου που αποχώρησε |
| Λήψη (download button) | Κατεβάστε το αρχείο |

| Meaning | Use |
|---|---|
| Withdraw request (button) | Απόσυρση αιτήματος |
| Withdrawn (status) | Αποσύρθηκε |
| Keep my answer (button) | Διατήρηση της απάντησής μου |
| On hold, while the request is with the requester | Σε αναμονή |
| View request (email button, as in eFinance) | Προβολή αιτήματος |
| Is there credit? (step 4 question) | Υπάρχει πίστωση; |
| Commitment article (budget) | Άρθρο δέσμευσης |
| Are funds available? (step 2 question) | Υπάρχει διαθέσιμο κονδύλι; |
| Procedures (ΟΑΥ activity) | Ιατρικές πράξεις |
| Headcount | Αριθμός προσωπικού |
| Annual employer cost | Ετήσιο εργοδοτικό κόστος |
| Round (one resubmission cycle) | Κύκλος {n} |
| Substitute acting for the holder | {who}, αντί για {holder} |
| Tracker states: done, current step, pending, waiting, negative answer | Ολοκληρώθηκε · Τρέχον βήμα · Εκκρεμεί · Περιμένει · Αρνητική απάντηση |
| Draft (status) | Πρόχειρο |
| Audit log | Ημερολόγιο ελέγχου |
| Audit event | Συμβάν |
| Figures typed by hand | Συμπληρώθηκαν χειροκίνητα |
| Out of office: I am back (button) | Επέστρεψα |
| Role holder | Κάτοχος |
| Email log | Καταγραφή email |
| Email footer (as eFinance) | Αυτόματο μήνυμα από το eHR · Οργανισμός Κρατικών Υπηρεσιών Υγείας (ΟΚΥπΥ) |
| Email status labels (as eFinance) | Χρειάζεται ενέργεια · Χρειάζεται προσοχή · Ολοκληρώθηκε · Για ενημέρωση |
| Working days | εργάσιμες ημέρες |

The full glossary lives in the skill. When the owner fixes or approves a term: update the skill, send the owner the updated skill file, and add the row here.

## Project decisions

- The owner of this project is Marios. "The owner" and "Marios" in these files and in the contracts are the same person; he also runs the eFinance server.

- 12/11/2026, Marios: eFinance must not hold HR information for now. eHR is a separate app with its own database. Any link to eFinance is narrow, read-only, without personal data, and agreed through Marios.
- «Έγκριση Θέσεων» (`position-approval`) is the first module of eHR. Briefs: `claude/position-approval-01-…` (build) and `-02-…` (UI), both version 2.
- Stack follows eFinance: Python 3.10, Flask 3.1.3, Jinja, Bootstrap 5.3.3, everything served locally. See `docs/adr/0001-stack.md`.
- Emails never record an action. One button, «Προβολή αιτήματος», then sign-in, then the request.
- Nobody acts on a request they submitted.
- Build runs with Fable 5.2 as orchestrator and the subagents in `.claude/agents/`. Contracts in `docs/contracts/` come first; subagents build against them.
- No real request data, staff names or ΟΑΥ files in a Claude session. Invented sample data only.
- Shared-server rules: own system user, service and port; Marios runs every sudo step; full test suite passes before any install; never restart another app's service.
- Design: Claude Design works from the UI brief. Hand-over points are in `docs/design/coordination-with-claude-design.md`.

- 13/11/2026, owner: yes to O1 to O5 in contract 02 (restart at step 2 on a material change; a return pauses the returner's task; answers can be replaced only after a resubmission in the returned step; comment required on negative answers; escalation informs the line manager and leaves the task where it is).

- 13/11/2026, owner: the Greek budget and tracker terms chosen in Phase 1 are approved (listed above).

- 14/11/2026, owner: the ΟΑΥ figures in the financial table have both sources available: served by eFinance (through the narrow read-only link, once Marios agrees it) or typed by hand. An administrator picks the source in Settings; typing stays the fallback when eFinance has no figures.

- 14/11/2026, Marios: the Greek labels from Phases 4 to 6 are approved (listed above).
- 14/11/2026, Marios: sign-in offers both AD and local accounts. Mail goes through Microsoft Graph. The facility code is the same in eHR and eFinance.
- 14/11/2026, Marios: in number search the Latin letter U stands for Θ, so «ΑΕΘ-2026-0007» is found by typing AEU-2026-0007.
- 14/11/2026, Marios: central roles can create requests (this replaces the earlier assumption that only requesters and Directorate roles can). The conflict-of-interest rule still applies to them.
- 14/11/2026, Marios: times are shown in Cyprus time (Europe/Nicosia) and stored in UTC.
- 14/11/2026, Marios: retention period assumed at 10 years until the DPO confirms. It is recorded as a setting; no deletion job exists or runs.
- Questions for the eFinance side go as a drafted message that Marios passes on.

- 14/11/2026, eFinance session (partial, server unreachable since 12/11): eFinance uses raw SQL and has MySQL settings, production engine not yet confirmed; ports 5004, 5005, 5011, 5012, 5014 and 8080 are taken and 5006 is not confirmed free; it recommends a separate Graph app registration for eHR; whether eFinance holds the ΟΑΥ reports is not confirmed, so keep the ΟΑΥ source on typing. Details in `docs/adr/0001-stack.md`.

- 14/11/2026, Marios (relayed by the eFinance session): eHR mail uses its own Microsoft 365 app registration and its own sender mailbox, separate from eFinance. IT sets it up (Mail.Send, limited by an access policy to eHR's mailbox) through Marios. eHR reads its own `EHR_GRAPH_*` settings and shares nothing with eFinance's mail settings.

- 14/11/2026, eFinance session (full answers, from the code and server): eFinance production runs on SQLite; MySQL 8.0.46 is on the server. Port 5006 is taken; eHR now defaults to 127.0.0.1:5008. LibreOffice 7.3.7 is installed. AD in eFinance is `ldap3` 2.9.1, simple bind as user@domain, local account tried first, first AD sign-in creates an inactive account an admin activates. eFinance does NOT hold ΟΑΥ activity by specialty, so contract 05 cannot be served from it and the figures stay typed until Marios names the source. Details in `docs/adr/0001-stack.md`.

- 14/11/2026, Marios: eHR's database is SQLite, as eFinance runs in production (one gunicorn worker, WAL).
- 14/11/2026, Marios: ΟΑΥ figures are typed by hand for now. Later eFinance will be populated from SAP reports, management accounts and ΟΑΥ reports held in a folder or database, and can then serve eHR. Keep the provider interface; build no loader in eHR.
- 14/11/2026, Marios: build AD sign-in (ldap3, LDAPS with the certificate checked, local account first, new AD users inactive until an administrator activates them).
- 14/11/2026, Marios: emails use the eFinance frame (ΟΚΥπΥ logo, 640 px, status label and 4 px bar, Outlook-safe button, footer) and its four status labels: Χρειάζεται ενέργεια, Χρειάζεται προσοχή, Ολοκληρώθηκε, Για ενημέρωση. These replace the per-event email labels approved earlier (Περιμένει εσάς, Κλιμάκωση για ενημέρωση, Χωρίς υπεύθυνο, Θα αποσυρθεί).

## Status

- 13/11/2026: Phase 0 done (ADR, four contracts, subagent definitions, empty app with tests). All six phases built, plus the decisions of 14/11: SQLite as the production database (WAL, one worker, `flask backup-db`), AD sign-in next to local accounts (`ldap3`, LDAPS with the certificate checked, `flask ad-test`), emails in the eFinance frame with its four status labels, default port 5008. Not done: install on the server, Claude Design restyle. Never tested for real: the AD bind and certificate chain, a Graph tenant, the emails in Outlook, SQLite WAL on the server's disk, Python 3.10 itself. Marios must get from IT: the domain controller name, domain, base DN and internal CA file for AD; the Graph tenant, client id, secret and sender mailbox for eHR's own registration. ΟΑΥ figures stay typed until eFinance can serve them. Known small gaps: `login.locked` has no singular form; number search needs the full digits; ldap3 2.9.1 does not run on Python 3.12.
