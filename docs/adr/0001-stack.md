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

## Update, 14/11/2026: second reply from the eFinance session

Facts it read from the code on 9 and 10 November. Items it marked pending need the server, which has been unreachable since 12/11.

- **Database:** eFinance uses raw SQL through its own helper, tests on SQLite, and its settings carry MySQL fields (port 3306). The engine production runs on, its version and the driver are pending. MySQL is the likely answer, not a confirmed one. eHR keeps SQLAlchemy; nothing in eFinance prevents it.
- **Ports in use on the server:** 5004 eFinance, 5005 eVendor, 5011 and 5012 eArchive, 5014 eHealth, 8080 nginx. Whether 5006 is free is pending. Do not take it until confirmed.
- **Layout pattern:** code in `/opt/finance` under its own service user, virtualenv inside it, logs in `/var/log/finance/`. eHR's `/opt/ehr` and `/var/log/ehr` follow the same pattern. The settings file location is pending.
- **Proxy:** eFinance is reached directly on 5004 over HTTP and trusts forwarded headers from cloudflared; eVendor sits behind Apache. The full picture, and whether LibreOffice is installed, are pending.
- **Mail:** eFinance has a `graph` or `smtp` setting; IT asked on 28/08 that all mail go through Graph. The eFinance session recommends that eHR gets its own app registration, limited by an access policy to its own sender mailbox. That is IT's decision.
- **AD:** eFinance has an AD path next to local accounts. Library, bind method, attributes and TLS are pending.
- **ΟΑΥ link:** whether eFinance holds the ΟΑΥ reports at all is pending. If it does: call `http://127.0.0.1:5004/...` (same machine, never leaves it), eFinance accepts the route only from 127.0.0.1 plus the token, stores only the token's hash, and accepts two tokens during rotation. eHR's client already allows plain HTTP for loopback only, sends a bearer token read from its own settings file, and defaults to typing by hand, so nothing depends on the link yet.

## Update, 14/11/2026 (later): full answers from the eFinance session

Read from the eFinance code and the server on 14/11. These replace the pending items above.

- **Database:** eFinance production runs on SQLite 3.37.2 (WAL, one gunicorn worker). MySQL 8.0.46 runs on the server for other apps, and port 5432 is in use, so a PostgreSQL may be there too. eHR's engine is still Marios's choice: see the open decision below.
- **Port:** 5006 is taken (board tool). 5008 and 5009 are free. eHR's default is now `127.0.0.1:5008`. Publishing eHR means an nginx block with a name and certificate from IT, when Marios says go.
- **LibreOffice:** 7.3.7 is installed at `/usr/bin/soffice`. Office previews will work.
- **Settings:** eFinance keeps secrets in `/opt/finance/settings.json`, mode 0600, never in the database or git. eHR does the same with `/etc/ehr/ehr.env`.
- **AD:** eFinance uses `ldap3` 2.9.1 with a simple bind as `<username>@<domain>` using the user's own credentials, no service account. It tries the local account first, then AD. A first AD sign-in creates an inactive account that an administrator activates. eFinance does not verify the LDAP server's certificate; eHR should use LDAPS on 636 with the certificate checked against the ΟΚΥπΥ internal CA.
- **Graph:** app-only client credentials and `sendMail` from a sender mailbox, as eHR already does. eHR gets its own registration and mailbox (Marios, 14/11).
- **ΟΑΥ activity:** eFinance does **not** hold visits, procedures or revenue by facility and specialty. The endpoint in contract 05 cannot be served from eFinance. The source for those figures is elsewhere; until Marios names it, the figures are typed.
- **Requisition wording:** statuses Υποβλήθηκε, Σε έγκριση, Εγκρίθηκε, Απορρίφθηκε, Έκλεισε, Ακυρώθηκε. Number `R-ENTITY-BUDGETCODE-DDMMYY-NN`. Email status labels: Χρειάζεται ενέργεια, Χρειάζεται προσοχή, Ολοκληρώθηκε, Για ενημέρωση. Email frame: 640 px, logo and status label on top, a 4 px bar in the status colour, footer line, a 6 px blue bar, Outlook-safe button 40 px high.

### Open decision: eHR's database engine

The app refuses to start in production on SQLite, a rule added in Phase 6 before this answer arrived. Two simple options:

1. **SQLite, as eFinance does.** No database server to run, backup is one file plus the storage folder. Needs the production guard relaxed, WAL and a busy timeout switched on, and one gunicorn worker.
2. **MySQL 8.0.46, already on the server.** Proper row locks for numbering, room for more workers. Needs a database, a user and a driver, and the suite run against it.
