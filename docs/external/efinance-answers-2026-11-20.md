# eFinance: answers for the eHire session, 20/11/2026

Everything here was read from the code on 10.227.56.22 on 20 Nov 2026. The development copy (`/home/administrator/finance`) was used; `base.html`, `app.css` and `_icons.html` are byte-for-byte the same as the live copy in `/opt/finance`. `settings.json` was not read. File references are `file:line` in the development copy.

---

## 1. Look and layout

### 1. Files copied

They are in the `files` folder next to this note:

| File | From | Why |
|---|---|---|
| `base.html` | `templates/base.html` | The base page template. |
| `_icons.html` | `templates/_icons.html` | `base.html` imports it on line 1 (the area icons). It won't render without it. |
| `app.css` | `static/css/app.css` | The only eFinance CSS file that `base.html` loads (`base.html:21`). |
| `efinance-banner.css`, `banner-fonts.css` | `static/css/` | Used only on the sign-in page (`login.html:8-9`). |

`base.html` also loads four library stylesheets from `/static/vendor/` (Bootstrap, Bootstrap Icons, Select2, the Select2 Bootstrap theme, `base.html:8-11`). I didn't copy them because they are the unchanged published files (see answer 10).

**Staff names check:** the copy of `base.html` sent here had one staff username in a template comment; it has been removed from this copy. None of the files hold names or email addresses.

### 2. Left menu

- **Width:** 250px (`--sidebar-w`, `app.css:13`). Fixed to the left, full height, scrolls on its own (`app.css:19-23`).
- **Background:** `#0A2C49` (`--sidebar-bg`, `app.css:12`).
- **Current item:** white text, a light green tint `rgba(139,197,63,0.14)` and a 3px green left border `#8BC53F` (`app.css:39-41`). Sub-items use a lighter tint, 0.10 (`app.css:64`). The `active` class is set in the template by comparing `request.path` or `request.endpoint` (e.g. `base.html:47`).
- **Groups:** Bootstrap "collapse" accordions. You click the group row, and a chevron turns 180° (`base.html:53-60`, `app.css:48-63`). The group that holds the current page opens automatically (`{% if act %}show{% endif %}`).
- **Pinning:** a pin icon appears on hover on each group row. A pinned group stays open on every page. The pins are saved in the browser's `localStorage` under the key `sidebar_pins` (`base.html:443-476`, `app.css:52-59`).
- **Sections:** small upper-case grey labels (`.nav-section`, `app.css:43-46`), e.g. «Σύστημα».
- **What it shows:** only the current "area" (see 3) plus the System/admin group and the manual. Each link is wrapped in `has_permission(...)`, so people never see links they can't open.
- **Collapse to icons:** no. There is no icon-only mode.
- **Phone (≤992px):** the menu is hidden off-screen and slides in from the left (`min(82vw, 320px)` wide) when you tap a burger button in a dark top bar. A dimmed backdrop appears behind it. It closes on a link tap, a backdrop tap, Esc, or when the window gets wide again (`app.css:143-183`, `base.html:27-35`, `412-442`). Touch targets are bigger on phones, and the pin icons are always visible there.

### 3. Top bar

- **Desktop:** there is no classic header. At the top of the content area sits the **area-nav pill bar** (`base.html:366-375`, `app.css:246-286`). It is sticky, has the page-background colour, and a bottom border.
  - It holds one pill per area the user may see (`area_visible()`, `app.py:3256`), in this order: Πληρωμές Πιστωτών (ap), Εφαρμογές, Αιτήματα Προμήθειας, Πύλη Αναφορών, Μισθοδοσία, Οδοιπορικά, Προϋπολογισμός, Αρχειοθέτηση, Κοστολόγηση ΤΑΕΠ, Ταξίδια Εξωτερικού, Ταμείο ΚΥ (`AREAS`, `app.py:3185`).
  - Each pill has a 17px line icon from `_icons.html` and a label.
  - The active pill is filled `#1873B8` with white text. The others are white with a `#cfdae4` border. On phones the pills scroll sideways in one row.
- **Flash messages** (Bootstrap alerts) come right under the pill bar (`base.html:377-388`).
- **User block:** this is in the **sidebar, at the bottom**, not in the top bar (`base.html:340-359`). From top to bottom: person icon and full name, role badge (main role), entity code, EL | EN language switch, «Κωδικός» (change password) link, «Αποσύνδεση» (sign out) link in red.
- **Phone only:** a dark bar (`#0A2C49`, 52px) with the burger button and the word "eFinance" linking to the dashboard. It has no logo (`base.html:27-34`).

### 4. Colours

| Item | Hex | Where |
|---|---|---|
| Menu background | `#0A2C49` | `app.css:12` |
| Menu text | `#9ab8b3` (hover `#e2e8f0`); section labels `#4d7a74` | `app.css:35,38,45` |
| Current item | text `#FFFFFF`, tint `rgba(139,197,63,0.14)`, left border `#8BC53F` | `app.css:39-41` |
| Page background | `#f2f5f8` | `app.css:16` |
| Panel/card | background `#FFFFFF` (Bootstrap default), border `#dbe3ea`, header background `#fff` with border `#e2e8f0` | `app.css:76-77` |
| Primary button | `.btn-brand` `#1873B8`, hover `#155E96`, white text. Some filter buttons use Bootstrap `.btn-primary` (`#0d6efd`). | `app.css:8-9,93-94` |
| Links | not overridden, so Bootstrap 5.3.3's default `#0d6efd` | (none in app.css) |
| Table header | text `#475569`, 0.8rem, upper case, weight 600. No background, except sticky headers in scroll boxes `#f8f9fa`, and `thead.table-light` (Bootstrap `#f8f9fa`). | `app.css:78-81,376-382` |
| Success / warning / danger | Bootstrap defaults `#198754` / `#ffc107` / `#dc3545`. Money columns: positive `#047857`, negative `#b91c1c`. | `app.css:129-130` |
| Other brand tokens | `--brand-soft #069FEC`, `--brand-pale #E7F4FD`, `--accent #8BC53F`. Disabled buttons `#eef2f6` background with `#8fa3b5` text. | `app.css:7-15,316-326` |
| Browser theme colour | `#1B75BB` | `base.html:16` |
| Chart palette | `#1873B8, #2563eb, #dc2626, #d97706, #7c3aed, …` | `base.html:404-405` |

### 5. Font

- **App:** `'Segoe UI', system-ui, -apple-system, sans-serif` (`app.css:16`). These are the computer's own fonts, so nothing is downloaded.
- **Base size:** app.css doesn't set one, so it is Bootstrap's 1rem (16px). Many pieces are set smaller: menu 0.85rem, tables about 0.86rem, form fields 0.88rem. On phones, fields go to 16px so the iPhone doesn't zoom in (`app.css:200-202`).
- **Numbers:** tabular digits (`font-variant-numeric: tabular-nums`) and right-aligned (`app.css:108-128`).
- **Sign-in banner only:** Open Sans (300/400/600) and IBM Plex Mono. These are served from `static/fonts/*.woff2` (`banner-fonts.css`).
- **Internet:** no Google Fonts or CDN links anywhere in `templates/`, `static/css` or `static/js` (searched for googleapis, jsdelivr, unpkg, cdnjs and "cdn.").

### 6. Logos

| File | Where | Size |
|---|---|---|
| `static/img/efinance-mark.svg` | Sidebar brand, before the word "eFinance" (`base.html:39-40`) | 22×22 px (the CSS says 22px is the minimum, `app.css:235-244`) |
| `efinance-mark.svg` | Sign-in card, above the title (`login.html:25-26`) | 56×56 px |
| `static/img/okypy-mark.png` | Sign-in card, next to the organisation name (`login.html:30-31`) | height 26 px, opacity 0.85 |
| `static/img/okypy-mark-only.png` | Sign-in banner across the top (`_banner.html:25`) | 56px wide (32px on phones), banner 180px high (72px on phones) |
| `efinance-mark.svg` / `app-icon-192.png` | Browser tab icon and phone home-screen icon (`base.html:12-13`) | n/a |
| `static/img/okypy-mail-logo.png` | Emails (`mail_layout.py:577`) | n/a |

Top bar: no logo (the phone bar shows text only).

### 7. Detail pages

**Requisition (`templates/requisition_detail.html`)**

- **Top:** a «Επιστροφή στα αιτήματα» back button. Then the page header: title with area icon, and under it the reference in monospace. On the **right of the header** are the **status badge** (green approved, red rejected, grey otherwise) and the amount in bold (`:12-40`).
- **Warnings:** red/yellow alerts under the header (over budget, approver not notified).
- **Two columns:**
  - **Left `col-lg-7`:** «Στοιχεία αιτήματος» card (field grid with a small grey label above each value; an «Τροποποίηση» button in the card header), attachments card, then the action box «Η ενέργειά σας» (reason box plus green Approve / red Reject, `:285-300`), clarifications, linked invoices.
  - **Right `col-lg-5` (the status column, `:522-640`):**
    1. «Θέση κονδυλίου»: a small budget table (budget, spent, committed, available, this request).
    2. «Αλυσίδα έγκρισης»: a numbered list of the steps by role. A finished step has a green row and a ✓ pill. The step that is waiting has a yellow row, an «Εκκρεμεί» badge, and the names of the people who can act. If nobody can act, a red line says so. Missing email shows a «χωρίς email» badge.
    3. «Ιστορικό»: a table (when / who / what / detail). Edits show yellow and denials red.

**Invoice (`templates/invoices_detail.html`)**

- **Header** (`:44-56`): «Τιμολόγιο» plus the number, a document-reference badge, and the **status badge inside the heading**. A «Λίστα» back button sits on the right.
- **Two columns** (`:59`, `:655`):
  - **Left `col-lg-8`:** the invoice record and totals cards, invoice lines, findings, then the card «Αλυσίδα έγκρισης (four-eyes, value-based)». It shows each step with a ✓ / «Απόρριψη» / ⌛ / «preparer» / «—» pill and a «τρέχον βήμα» badge.
  - **Right `col-lg-4`:** «Ροή έγκρισης», a vertical timeline that stays in place while you scroll on desktop (`:655-702`). Each step has a dot (green = done, yellow ring = current, grey = still to come, red = sent back or rejected), a bold title, "time · who", and an optional comment box with a red left border.

### 8. List pages

**Requisitions (`requisitions_list.html`)**

- **Filters:** a row of small buttons, one per status, each with a count badge. The chosen one is `btn-primary`, the rest `btn-outline-secondary`. On the right are «Περιμένουν εμένα» (yellow) and «Τα δικά μου» (brand blue) toggles (`:26-52`). Below that is a search box and a sort dropdown. These use GET, so a filtered list is a link you can share.
- **Display:** a table inside a card (`table-hover`). The whole row is clickable. Codes are in monospace with the name in small grey text under them, and amounts are right-aligned.
- **Status:** a neutral pill, `badge bg-light text-dark border` (`:140`).

**Invoices (`invoices_list.html`)**

- **Filters:** a collapsible «Τι σημαίνει κάθε κατάσταση» legend, the same status-button row, «Η ουρά μου», and a supplier / VAT-number search box.
- **Display:** the table sits in `.table-scroll`, its own scroll box. The header row stays stuck at the top and the sideways scrollbar is always visible (`app.css:364-386`).
- **Status:** coloured badges (`invoices_list.html:5-10`):
  - approved: `bg-success`
  - rejected and on_hold: `bg-danger`
  - review: `bg-warning text-dark`
  - park_ready and parked: `bg-primary`
  - analyzed and validated: `bg-info text-dark`
  - extracted and ingested: `bg-secondary`

**All lists**

- **Paging:** 50 rows per page (`paginate()`, `app.py:2035`), using the shared macro `templates/_pager.html`. It shows "Εγγραφές a–b από n" plus First / Previous / "Σελίδα x / y" / Next / Last. The buttons are disabled at the ends rather than hidden.
- **Badges:** all are pill-shaped: radius 999px, 0.66rem, weight 600 (`app.css:306-312`).
- **Cells:** text is left-aligned and numbers are right-aligned (`app.css:344-348`).

### 9. Screenshots

Not included yet. They need a test copy with invented data; they can follow if eHire still needs them after the template and CSS.

### 10. Libraries

All are served from `static/vendor/<name>-<version>/`. There is no CDN. `static/vendor/MANIFEST.txt` lists a sha256 checksum for each file.

| Library | Version | Loaded |
|---|---|---|
| Bootstrap (CSS + bundle JS) | 5.3.3 | every page |
| Bootstrap Icons | 1.11.3 | every page |
| jQuery | 3.7.1 | every page |
| Select2 | 4.1.0-rc.0 | every page (`.select2` auto-starts, `base.html:400-402`) |
| select2-bootstrap-5-theme | 1.3.0 | every page |
| Chart.js | 4.4.1 (`chart.umd.js`) | every page |
| Leaflet | 1.9.4 | only the travel-claims queue (`perdiem_queue.html:538-542`) |

eFinance's own small scripts are `static/js/pw-toggle.js` (show/hide password eye) and `table-lock.js`. `ky-keys.js` is used by the cash-desk pages. The site also registers a service worker, `/sw.js` (`base.html:480-486`).

---

## 2. Roles and rights

### 11. Roles and what each may do

The roles are in `ROLES` (`app.py:820-850`). The default rights per role are in `DEFAULT_ROLE_PERMISSIONS` (`app.py:980-1031`). The full list of rights is in `PERMISSIONS_CATALOG` (`app.py:862-976`): about 60 keys such as `invoice.view` and `admin.users`, grouped by module.

| Role (code) | Default rights |
|---|---|
| admin | everything (`"*"`) |
| clerk (preparer) | view/run/review invoices; view/review suppliers; view payments and budget; download the two tools. Never approves. |
| accountant | the same plus approve invoices, create the SAP file (`invoice.park`), approve/whitelist/export suppliers |
| chief_accountant | invoices (view/review/approve/run), suppliers incl. import, budget view, board pack view, payments; travel-claim confirm/approve/queue/export; overseas queue/budget/check/export |
| cfo | every module right except `invoice.park`, plus `admin.audit` |
| group_cfo | approve invoices, views, board-pack export, audit log, travel-claim approve/queue/export/manage, overseas queue/budget/export/manage |
| ceo | approve invoices, views, board-pack export, audit log, overseas queue + authorise |
| board_viewer | board pack view + export |
| cc_manager | view invoices, approve as cost-centre owner (`invoice.cc_approve`), budget view, travel-claim confirm/queue, overseas confirm/queue |
| fpa | budget view/transfer/allocate, board pack view/export, view invoices and payments |
| vendor_master | all supplier rights + view invoices |
| viewer | every `*.view` right + the two tool downloads |
| tester (UAT) | every module right + audit log, but none of the admin screens |
| employee | nothing (only areas open to everyone, e.g. own travel claims) |
| perdiem_admin | travel-claim check/queue/export/manage (prepares; does not approve payment) |

Points to note:

- These are the **starting values**. The live rights are whatever is ticked in the `role_permissions` table. All active roles on the live database have been edited by hand (`perms_configured=1`), so live may differ from this table.
- The live database also has two roles that are not in the code: `travel_admin` (overseas queue/budget/check/export/manage/board + `perdiem.manage`) and `cashier` (no rights ticked). It also has some old inactive roles.
- Some areas also check the role name directly, not only rights. Examples: the travel-claims menu (`base.html:137-152`), the archive area (admin/cfo/chief_accountant), and the cash-desk area (admin or desk membership) (`app.py:3185-3255`).

### 12. How rights are stored

Mixed:

- **In code:**
  - the catalogue of rights;
  - the default rights per role;
  - the list of "central" roles that see all entities (`CENTRAL_ROLES`, `app.py:853`: admin, cfo, group_cfo, ceo, board_viewer, fpa, tester);
  - the role checks mentioned above.
- **In editable tables:**
  - which roles exist;
  - which rights each role has;
  - each user's main role, extra roles, entities and cost centres.
- If a role has never been edited, the code defaults apply (`_role_permission_set`, `app.py:1179-1201`).

Tables (columns as on the live database):

- `users`: id, username, password_hash, full_name, email, role (main role), hospital_code (home entity), department, phone, active, auth_source ('local' or 'ad'), registration_status, created_at, must_change_password
- `roles`: code (PK), name, description, sort_order, is_system, is_active, created_at, perms_configured
- `role_permissions`: id, role_code, permission_key, is_granted (unique on role_code + permission_key)
- `user_extra_roles`: id, user_id, role_code, created_at (unique on user_id + role_code)
- `user_entities`: id, user_id, entity_code (unique on user_id + entity_code; `'*'` means all)
- `cost_centre_managers`: id, cost_centre, user_id (the cost centres a person is responsible for)
- `entities`: id, code, name, type, oay_fcode, sort_order, active, company_code
- `activity_log`: id, user_id, username, entity_type, entity_id, action, details, created_at, ip_address

There is no separate "permissions" table. The list of rights lives only in code.

### 13. Admin screens

Menu: Σύστημα → Διαχείριση group (`base.html:280-327`). Each screen has its own right.

| Screen | Route | Template | Right |
|---|---|---|---|
| Users list (entity filter) | `/users` | `users_list.html` | `admin.users` |
| New / edit user | `/users/new`, `/users/<id>/edit` | `user_form.html` | `admin.users` |
| Delete user | POST `/users/<id>/delete` | n/a | `admin.users` |
| Pending sign-ups (AD) | `/users/pending`, POST `.../approve`, `.../reject` | `users_pending.html` | `admin.user_approvals` |
| Roles & rights | `/roles`, `/roles/new`, `/roles/<code>/edit`, POST `/roles/<code>/delete` | `roles_list.html`, `role_form.html` | `admin.roles` |
| Entities | `/entities`, `/entities/new`, `/entities/<id>/edit` | `entities_list.html`, `entity_form.html` | `admin.entities` |
| Settings (incl. AD, mail) | `/settings` | `settings.html` | `admin.settings` |
| Activity log | `/audit` | `audit.html` | `admin.audit` |

**What an admin can change on a user** (`app.py:2787-2842`):

- name, email, phone, department
- main role and extra roles
- home entity and entity ticks
- cost centres they are responsible for
- active on/off
- a password reset, after which the user must pick a new password at the next sign-in

**On a role** (`app.py:3008-3058`): name, description, order, active, and the tick-box matrix of rights grouped by module. The edit page also lists who holds the role. System roles cannot be deleted, only switched off. A role still in use cannot be deleted.

**To give a person a role:**

1. Go to Διαχείριση → Χρήστες and open the person.
2. Pick the main «Ρόλος», or add extra roles with the «+» button.
3. Tick their entities under «Δικαιώματα ανά οντότητα».
4. Save.

The change applies on the person's next page load, because the session reloads roles on each request (`current_roles`, `app.py:1239`). To change what a role can do, go to Ρόλοι & Δικαιώματα → the role → tick the rights → save.

### 14. Ticked entities

**Per user, not per role.**

- The user form has a box «Δικαιώματα ανά οντότητα» (`user_form.html:104-144`). It has an «Όλες οι οντότητες» tick, which also covers entities added later, and one tick per entity.
- «Όλες» is saved as a single `'*'` row in `user_entities` (`_save_user_entities`, `app.py:2681-2696`).
- If no entity is ticked, the user's home entity (`users.hospital_code`) is used (`user_entity_codes`, `app.py:1312-1336`).
- If the **main** role is a central role (admin, cfo, group_cfo, ceo, board_viewer, fpa, tester), the user sees all entities whatever is ticked (`session_entity_codes`, `app.py:1350-1360`).
- Helpers used everywhere:
  - `can_access_entity(code)`;
  - `covered_entities()` for drop-downs;
  - `scoped_entity()`: a screen's entity filter is clamped to the ticks, so editing the URL opens nothing;
  - `_in_codes()` for SQL `IN (...)`. An empty set returns nothing.

### 15. More than one role; one-entity roles

**More than one role:** yes. Each user has one main role (`users.role`) plus any number of extra roles (`user_extra_roles`). Rights are the **union** of all their roles (`has_permission`, `app.py:1268-1287`). Only the main role decides "central = sees all entities", and admin cannot be given as an extra role.

**Limiting a role to one entity:** no. The entity ticks belong to the user and apply to all of that user's roles together. You can't say "approver for entity A but only viewer for entity B". The nearest thing is an area tied to one entity code: the cash-desk area opens through a right only if that entity is ticked (`app.py:3250`, `area_visible`, `app.py:3270-3273`).

### 16. Super-administrator

Yes, the `admin` role:

- `has_permission()` always returns true for it (`app.py:1274-1276`).
- It always sees all entities.

Things only admin can do or be:

- change a person's role while approving a pending AD sign-up (`app.py:2907-2911`);
- the archive and cash-desk areas also open by role name for admin.

Protections around admin:

- admin can never be given as an extra role (`app.py:1152-1158`);
- the last active admin cannot be deleted (`app.py:2864-2871`);
- nobody can switch off or delete their own account.

All the admin screens are ordinary rights (`admin.users`, `admin.roles`, …), so they can be handed to other roles through the matrix. For example, cfo gets `admin.audit` by default.

### 17. Audit of user and role changes

Yes. Changes are written to `activity_log` by `log_activity()` (`app.py:1436`). The fields are user_id, username, entity_type ('user', 'role', 'settings'), entity_id, action, details (free text), created_at, ip_address (real address taken from the proxy headers). Recorded actions:

- **Users:**
  - CREATED: main role, extra roles, entities, cost centres
  - UPDATED: details text has entities, cost centres, extra roles
  - DELETED: logged before the delete
  - AD_REGISTERED, REGISTRATION_SUBMITTED
  - REGISTRATION_APPROVED: with role
  - REGISTRATION_REJECTED
  - LOGIN (marks "(AD)"), LOGOUT
- **Roles:** CREATED, UPDATED, DELETED.
- **Settings:** UPDATED.

Gaps worth copying better in eHire:

- The user UPDATED text does **not** say the main role, the active flag or a password reset changed (`app.py:2833-2835`).
- The role UPDATED text says only "role X updated", not which rights changed (`app.py:3045`).

Screen: `/audit`, with filters for username, action, type, IP and date range.

---

## 3. Active Directory

### 18. Setting names

From the `load_settings()` defaults, `app.py:155-210`:

| Setting | Default |
|---|---|
| `ad_enabled` | False |
| `ad_server` | "" |
| `ad_port` | "389" (636 is used if LDAPS and no port is set) |
| `ad_use_ssl` | False |
| `ad_ca_file` | "" |
| `ad_domain` | "ihcis.local" |
| `ad_base_dn` | "" |
| `ad_uid_attribute` | "sAMAccountName" |

**Bind method:** a simple bind as `username@ad_domain` with the user's own password, using the `ldap3` library (`_ad_authenticate`, `app.py:1811-1882`). The app has no service-account bind. Usernames containing "@" or "\\" are refused.

The live values are set in `settings.json` (not read). The project notes say "AD switch is off; code ready" (`CLAUDE.md:1087`). The real current value is in `settings.json` (not read).

### 19. LDAPS and certificate check

- **Always encrypted.** With `ad_use_ssl` on, it uses LDAPS (636). Otherwise it uses StartTLS on 389. If StartTLS fails there is no plain-text fallback (`app.py:1843-1849`).
- **Certificate always checked:** `ssl.CERT_REQUIRED` plus a check of the server name, against `ad_ca_file` (`_ad_tls`, `app.py:1800-1808`; `CLAUDE.md:933-939`).
- **CA file path:**
  - The code default is empty, which per the code comment means the CAs the eFinance server already trusts (`app.py:172-174`).
  - The Settings page placeholder suggests `/opt/finance/ad-ca.pem` (`settings.html:247`).
  - The real configured path is set in `settings.json` (not read).

### 20. CA file for an `ehire` user

- `/opt/finance/ad-ca.pem` **does not exist** on the server (`ls`: no such file). No other `.pem` or `.crt` file is in `/opt/finance`.
- `/opt/finance` itself is `drwxrwxr-x finance:finance`, so other users can enter it.
- Without knowing the real path from `settings.json`, I can't say whether the `ehire` user could read the file. Not sure.
- The safe choice is for eHire to hold its own readable copy. If IT's CA is put in the server's system trust store instead, an empty setting would work for both apps; that follows from the code comment above.
- eFinance's Settings page warns when the CA file can't be read (`app.py:3654-3657`).

### 21. After a first AD sign-in

`login()`, `app.py:2321-2350`:

1. A good AD password for an unknown user creates an **inactive** account: role `employee`, `auth_source='ad'`, `registration_status='pending'`, with a random password. This is logged as AD_REGISTERED.
2. The person is sent to `/register` to fill in first name, surname, email, phone, home entity and department (`app.py:2359-2400`).
3. On submit, an email «eFinance: Νέα εγγραφή χρήστη προς έγκριση» goes to **everyone holding `admin.user_approvals`**. It has a link to the pending list.
4. The sidebar also shows a red count badge on «Εκκρεμείς Εγγραφές» (`base.html:295-299`, count at `app.py:2278-2283`).
5. The admin activates the account at **`/users/pending`** (`users_pending.html`). They can adjust the entity and department; only the admin role can change the role. They approve or reject. Reject deletes the account.
6. On approval the person gets an email «Ο λογαριασμός σας ενεργοποιήθηκε» (`app.py:2894-2931`).
7. Approval sets only the home entity. Extra entity ticks are added afterwards on the user edit page.

### 22. What is read from AD

Only `displayName` (or `givenName` + `sn`), `mail`, and `telephoneNumber` (or `mobile`). This needs `ad_base_dn` to be set (`app.py:1856-1875`).

Department is **not** read from AD; the person types it on the register form. Groups (`memberOf`) are not read, and no rights come from AD groups. Rights come only from the roles given inside eFinance.

### 23. Route to the domain controller

Not sure. Nothing in the code, `CLAUDE.md` or `TODO.md` says whether the server reaches the DC directly or through a firewall rule. The connection is made directly by `ldap3` (no proxy can apply to LDAP). The Settings page has an AD test button (`/settings/test-ad`) that reports why a connection failed (certificate, StartTLS, no answer, password).

---

## 4. Lists

The lists are in `eFinance-lists-for-eHire-20-11.xlsx`, with sheets `directorates`, `facilities`, `positions`, `cost_centres` and a `read_me`. It is a read-only export of the live database and holds no personal data. The column names are eFinance's own, so map them to the eHire import template where they differ.

### 24. Directorates

eFinance has no separate list of directorates. It has 13 **entities**, and users are given access to these: the 8 hospitals, Mental Health Services (MH), Health Centres (HC), Ambulance Services (AMB), Community Nursing (CNS) and Head Office (HQ). Each has a code, a Greek name and an SAP company code. English names are not stored in the table; they come from eFinance's English screen text and are filled in on the sheet. AMB and CNS are inactive.

### 25. Hospitals and facilities

- The hospitals are entities themselves, and their codes are the site codes you list: HQ, NGH, ARC, LGH, LAR, PAP, FAM, TRD, CHR, MH, HC, CNS. eFinance also has AMB, which is inactive.
- The `facilities` sheet has those 13 (site code = entity code) plus the 30 Health Centres of the cash desk, under HC. Health Centres use Greek three-letter codes (for example ΛΑΤ) and each has its SAP cost centre.

### 26. Cost centres

1,702 cost centres, of which 1,660 are active and 42 inactive. Each has a code, a Greek name and the entity it belongs to. There are no English names in eFinance, so `name_en` is empty.

### 27. Position titles and payroll grades

eFinance holds none. It keeps no HR data. The `positions` sheet is empty.

### 28. Format

Excel, as above. CSV can be produced from the same data if eHire prefers.

---

## 5. Server

### 29. Graph and the web proxy

- `/etc/systemd/system/finance.service` sets only **`PATH`** and **`HOME`**. There are **no proxy variables**, and it has **no drop-in folder**.
- The service listens on `0.0.0.0:5004`.
- Mail through Graph uses Python `requests` straight to `login.microsoftonline.com` and `graph.microsoft.com` with no proxy set (`app.py:1484-1556`).
- The server's `/etc/environment` defines `http_proxy` and `https_proxy`. A code comment notes that systemd services don't read that file (`dms.py:777-781`), so **from the code, the running service calls Microsoft directly, not through the proxy.**
- Whether the firewall lets that direct traffic out, and whether mail is actually set to Graph (`mail_transport`): not sure. That value is set in `settings.json` (not read).
- Only the AI calls use a proxy, through the `ai_proxy` setting.

### 30. Scheduled jobs

These are systemd timers; `systemctl list-timers` confirms all three are active.

| Timer | Schedule | Runs |
|---|---|---|
| `finance-backup.timer` | daily 02:00 (+ up to 5 min random), catches up if missed | `finance-backup.service`: `/opt/finance/backup_db.sh` as user `finance` |
| `finance-pipeline.timer` | daily 06:30 (+ up to 2 min) | `finance-pipeline.service`: `python -m invoices run --now` |
| `finance-heartbeat.timer` | Mondays 07:00 (+ up to 5 min) | `finance-heartbeat.service`: `python -m heartbeat` |

- Each service has a drop-in `onfailure.conf` that triggers `finance-alert@.service`, which emails on failure.
- Cron: `/etc/cron.d/efinance-backup` runs `/usr/local/bin/backup_efinance.py` **as root at 01:30** daily.
- The `finance` user's own crontab can't be read without sudo. Not sure if it has one.

### 31. Nightly backups

1. **`/opt/finance/backup_db.sh` (02:00):**
   - Makes an online SQLite backup of `/opt/finance/finance.db` and checks its integrity.
   - Compresses it to `/opt/finance/backups/finance-<time>.db.gz` and keeps 14 days.
   - On the 1st of the month it also copies one to `/opt/finance/backups/monthly/`, kept for 12 months.
2. **Root cron (01:30), `/usr/local/bin/backup_efinance.py`:**
   - The script is not readable (`rwxr-x--- root`).
   - Per `CLAUDE.md:590-597`, it writes to `/var/backups/efinance/daily/<time>/`: three databases plus uploaded files.

**Off-server copy:** none. `TODO.md` item 1ιβ.3 says no backup leaves the machine. Both copies sit on the same disk as the live database: no network mount, no rsync/rclone. It is still open, waiting for a decision on where copies should go.

### 32. Port 5008

- `ss` shows **`0.0.0.0:5008` listening on all interfaces**.
- It belongs to **eHire**, not eFinance. eHire's `/opt/ehire/current/deploy/gunicorn.conf.py:13` binds to `EHIRE_BIND`, defaulting to `127.0.0.1:5008`. Since it is listening on 0.0.0.0, `EHIRE_BIND` must be set in its service.
- eFinance itself is on 5004 (all interfaces), plus a second process run by the `finance` user on `127.0.0.1:5005`.
- **Firewall:** not sure. `/etc/ufw/user.rules` is root-only (`rw-r-----`), and I didn't use sudo.
