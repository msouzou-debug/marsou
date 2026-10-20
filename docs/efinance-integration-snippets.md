# eFinance integration — the three edits that live in eFinance's own files

`taep.py`, its templates and its seed are self-contained. These three changes are in
eFinance's files, so they are recorded here rather than being lost in a terminal.

Production `app.py` carries twelve modules where GitHub's copy has six, so read the real
file before applying anything. Each edit below is idempotent.

---

## 1. `app.py` — register the module

In the `_MODULES` loop, add `"taep"`. Nothing else.

## 2. `app.py` — the area, so the menu survives

`current_area()` returns `''` for any path in no area's `prefixes`, and the sidebar then
disappears entirely — eFinance's own comment on the `ap` area warns about exactly this.
Add to `AREAS`, last:

```python
    {"key": "taep", "label": "Κοστολόγηση ΤΑΕΠ", "icon": "bi-clipboard2-pulse",
     "home": "/taep/nea", "perms": ("taep.view", "taep.create"),
     "prefixes": ("/taep",),
     "desc": "Κοστολόγηση περιστατικών ΤΑΕΠ για μη δικαιούχους ΓεΣΥ"},
```

`area_visible()` is `any(has_permission(p) for p in perms)`, so the pill appears for
either key — and for `admin`, which bypasses the check.

## 3. `templates/_icons.html` — the module's mark

The pills do not use Bootstrap icons: `area_icon()` holds one line-glyph per area key,
24×24, stroke 1.5, `currentColor`, round caps and joins. The ΤΑΕΠ mark belongs in that
set and is drawn in that language — a cross for emergency care, with a coin overlapping
it for what the module does. Two shapes, which is all that survives at 17px.

Add to `AREA_ICON_PATHS`:

```python
    'taep': '<path d="M8 3h5v5h5v5h-5v5H8v-5H3V8h5z"/><circle cx="18" cy="18" r="4"/>',
```

Two shapes, and only two. The coin sits in the cross's lower-right notch — a Greek cross
leaves each corner empty — so the shapes touch nothing and both survive at 17px. An
inner euro stroke was drawn, rendered and dropped: 1.5 stroke on a 3.8 arc closes to a
blob below about 48px. It stays in the full-colour mark, where there is room.

`static/img/taep-mark.svg` is the same idea in full colour — blue tile, white cross,
green coin — for page headers, print and anywhere the glyph is too small to carry brand
colour. It is not needed for the pill.

---

## 4. `templates/base.html` — the sidebar block

Placed immediately before `<div class="nav-section">{{ t('Σύστημα') }}</div>`.

Links are **literal paths, not `url_for`**. A `url_for` for a missing endpoint raises
`BuildError` inside the shared layout, which would take down every page in eFinance —
not just ΤΑΕΠ. eFinance's design is that a module failing to register does not stop the
app, and `url_for` in `base.html` would quietly undo that.

```jinja
{% if CURRENT_AREA == 'taep' %}
{% if has_permission('taep.create') %}
<a href="/taep/nea" class="nav-link {% if request.path == '/taep/nea' %}active{% endif %}">
    <i class="bi bi-clipboard2-pulse"></i> {{ t('Νέα Καταχώρηση') }}
</a>
{% else %}
<a href="/taep/list" class="nav-link {% if request.path.startswith('/taep/list') %}active{% endif %}">
    <i class="bi bi-clipboard2-pulse"></i> {{ t('Καταχωρήσεις') }}
</a>
{% endif %}
<div id="g-taep">
    {% if has_permission('taep.create') %}
    <a href="/taep/list" class="nav-link nav-sub {% if request.path.startswith('/taep/list') %}active{% endif %}">{{ t('Καταχωρήσεις') }}</a>
    {% endif %}
    {% if has_permission('taep.rates') %}
    <a href="/taep/rates" class="nav-link nav-sub {% if request.path.startswith('/taep/rates') %}active{% endif %}">{{ t('Τιμές') }}</a>
    <a href="/taep/tariff" class="nav-link nav-sub {% if request.path.startswith('/taep/tariff') %}active{% endif %}">{{ t('Τιμοκατάλογος') }}</a>
    {% endif %}
    {% if has_permission('taep.admin') %}
    <a href="/taep/readiness" class="nav-link nav-sub {% if request.path.startswith('/taep/readiness') %}active{% endif %}">{{ t('Έλεγχος Ετοιμότητας') }}</a>
    {% endif %}
</div>
{% endif %}
```

## 5. `app.py` — the permission keys

Still **not applied**, pending the Μονάδα. See `docs/deployment-runbook.md` §3 and the
`_MODULE_KEYS` warning: adding the six keys grants them all to `cfo` and `tester`
wherever `perms_configured` is 0, and both roles see every hospital.
