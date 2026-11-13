# Working with Claude Design

Design and build run side by side. The UI brief (`claude/position-approval-02-claude-design-ui-brief.md`) is the instruction to Claude Design. This note says how the two meet, so neither waits on the other.

## What the build needs back, in this order

| # | From design | Lands in | Needed by |
|---|---|---|---|
| 1 | Final token values as Bootstrap 5.3 variable overrides | `ehr/static/css/ehr-tokens.css` (a draft from the UI brief is there now) | Phase 1 |
| 2 | Route tracker: HTML structure and CSS for every state, horizontal, vertical and miniature | `ehr/templates/components/tracker.html`, `ehr/static/css/tracker.css` | Phase 1 (form preview), Phase 2 (request page) |
| 3 | List row and status chip | `ehr/templates/requests/list.html` | Phase 1 |
| 4 | New request form layout, 1280 and 390 px | `ehr/templates/requests/new.html` | Phase 1 |
| 5 | Request page and the shared action card frame | `ehr/templates/requests/detail.html`, `components/action_card.html` | Phase 2 |
| 6 | Document viewer | Phase 3 templates | Phase 3 |
| 7 | Email layout and the sign-in screen | `ehr/mail/layout.py`, `auth/login.html` | Phase 4 (sign-in: Phase 1) |
| 8 | eHR mark and module icon as SVG | `ehr/static/img/` | Any time |

## Rules both sides keep

- Bootstrap 5.3.3 classes and variables first. Custom CSS only for the tracker and what Bootstrap can't do.
- No outside URLs: fonts, icons and scripts are local. A test fails the build otherwise.
- No text in design files that isn't in section 9 of the UI brief or `docs/contracts/04-string-keys.md`. New wording goes to the owner first, then into `okypy-greek-terms`.
- State names in the design match `docs/contracts/02-state-machine.md` (request states, stop states, task states).
- Sample data: the invented cases in section 11 of the UI brief. The build seeds the same cases, so screens can be compared one to one.

## How hand-over works

Claude Design can't be messaged from the build session. The owner carries things across:

1. Give Claude Design the UI brief and this file, plus `docs/contracts/02-state-machine.md` and `04-string-keys.md`.
2. Bring back the exported HTML/CSS (or the artifact link). The build's `forms-ui` agent turns it into Jinja templates and reports every place it had to depart from the design.
3. Until design arrives, the build uses plain Bootstrap with the draft tokens. Screens work and pass tests; only the look changes later.
