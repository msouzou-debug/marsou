# ADR 0001: Stack for eHR

Status: accepted for Phase 0, with open items · 13/11/2026

## Context

eHR is a new app, separate from eFinance, because eFinance must not hold HR data (Marios, 12/11/2026). It runs on the same shared Linux server. Its first module is «Έγκριση Θέσεων». Build brief v2, section 5, says to copy eFinance's stack and patterns without sharing its code or database.

The server could not be inspected: the VPN was down. The facts below were stated by the eFinance session on 12/11/2026 and have not been checked by this build.

## Decision

| Area | Choice | Basis |
|---|---|---|
| Language | Python, code written to run on 3.10 | eFinance runs 3.10 |
| Web | Flask 3.1.3, Jinja templates, gunicorn, one worker | Same as eFinance |
| UI kit | Bootstrap 5.3.3, Bootstrap Icons 1.11.3, later jQuery and Select2, all in `ehr/static/vendor` with checksums | Same as eFinance; nothing loads from outside |
| Database access | SQLAlchemy 2.1 through Flask-SQLAlchemy | Lets the engine be chosen later without rewriting queries |
| Database engine | **Open.** SQLite for development and tests | Waiting for Marios to say what eFinance uses |
| Workflow rules | `ehr/workflow/`, pure Python, no Flask, database or I/O imports. A test enforces it | Build brief sections 5 and 7 |
| Strings | `ehr/i18n/el.json` and `en.json`, looked up with `t('key')`. Tests check that both files have the same keys and that no Greek sits in templates or code | Build brief section 4 |
| Login | Own users table with hashed passwords, optional AD, session cookie `ehr_session`, `login_required` and `permission_required(key)`, `next` checked to stay in the app | eFinance pattern. Built in Phase 1 |
| Mail | One layout module; Microsoft Graph or SMTP by setting | eFinance pattern. Built in Phase 4 |
| Service | Own system user `ehr`, own service, port 5006 proposed | Shared-server rules; 5004 and 5005 are taken |

## Differences from the server, to resolve

1. This build environment has Python 3.11, not 3.10. Code avoids anything newer than 3.10. The full suite must be run on 3.10 before the first install.
2. Whether eFinance uses SQLAlchemy or raw SQL is unknown. If it uses raw SQL, eHR still keeps SQLAlchemy; the two apps share no code.
3. gunicorn is pinned at 27.0.1 here. Match the server's version if Marios prefers.

## Open items (build brief section 16)

Database engine and version, port and service name, AD only or local accounts as well, whether eFinance excerpts may be shared with a build session.

## Consequences

Phase 0 and the pure workflow engine don't depend on any open item. Phase 1 (login, lists) needs the database engine and the sign-in answer before it is installed on the server, though it can be built and demonstrated on SQLite.
