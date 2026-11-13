# eHR

Read `memory.md` first: it holds the owner's writing rules, approved Greek terms and project decisions.

@memory.md

- Briefs: `claude/`. Contracts: `docs/contracts/`. Stack decision: `docs/adr/0001-stack.md`.
- Tests: `scripts/test.sh` (prints failures only). Set up with `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
- Run locally: `.venv/bin/gunicorn -c deploy/gunicorn.conf.py wsgi:app`, then open `http://127.0.0.1:5006/`.
- `ehr/workflow/` is pure Python. No Flask, database or I/O imports there; a test enforces it.
- Every user-facing string goes in `ehr/i18n/el.json` and `en.json`. No Greek in templates or code.
