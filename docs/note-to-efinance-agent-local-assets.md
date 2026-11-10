> **Done, 10/11/2026.** The eFinance session applied this to `base.html` and found three
> CDN uses it did not list — Chart.js, the eVendor module and the map page — which are
> local now too. This note covered only what `base.html` loads for ΤΑΕΠ's screens,
> because that is the part of eFinance visible from the ΤΑΕΠ repository.

# Serving Bootstrap, jQuery and Select2 locally — 09/11/2026

`base.html` loads Bootstrap 5.3.3, Bootstrap Icons 1.11.3, jQuery 3.7.1, Select2
4.1.0-rc.0 and its Bootstrap 5 theme from `cdn.jsdelivr.net`. That is an address outside
the ΟΚΥπΥ network that every page depends on.

It resolves today. If it ever stops, nothing errors: Bootstrap's styling goes, every
Select2 box falls back to a plain list, and the pages keep working well enough that
nobody reports it. ΤΑΕΠ's ICD-10 and service searches went dead for nine days in October
in exactly that silent way — for a different reason (load order, now fixed), but the
symptom a CDN outage would produce is the same.

The ΤΑΕΠ standalone host now serves these files itself. This note is the same change for
`base.html`, which is yours. **Nothing in ΤΑΕΠ changes your file.**

## The files

In the ΤΑΕΠ repository at `static/vendor/`, already on the server in the clone at
`/home/administrator/marsou/static/vendor/` after the next fetch. 948 KB, nine files plus
their licences — all five packages are MIT.

They are the CDN's own bytes. Taken with `npm pack` at the exact pinned versions, which is
what jsdelivr's `/npm/` paths serve, and checked against three independently published
integrity hashes, all identical:

| File | Published hash |
|---|---|
| jquery.min.js 3.7.1 | `sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=` (code.jquery.com) |
| bootstrap.min.css 5.3.3 | `sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH` |
| bootstrap.bundle.min.js 5.3.3 | `sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz` |

`static/vendor/MANIFEST.txt` has the sha256 of every file and the URL each one replaces.

## Order matters

**Do not edit `base.html` first.** If it points at files that are not being served yet,
every eFinance page loses its CSS and JS at once. Copy, prove they are served, then edit.

### 1. Copy the files into eFinance's static folder

```bash
sudo mkdir -p /opt/finance/static
sudo cp -r /home/administrator/marsou/static/vendor /opt/finance/static/
sudo chown -R finance:finance /opt/finance/static/vendor
```

This assumes eFinance serves `/opt/finance/static/` at `/static/`, which a Flask app built
as `Flask(__name__)` in `/opt/finance/app.py` does by default. Step 2 checks it.

### 2. Prove they are served — before touching base.html

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5004/static/vendor/jquery-3.7.1/jquery.min.js
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5004/static/vendor/bootstrap-icons-1.11.3/fonts/bootstrap-icons.woff2
```

Both must print `200`. If they print `404`, eFinance's static folder is elsewhere — stop
here and find where it is before going on. The second one matters: the icon stylesheet
asks for its fonts by a relative path, so they have to sit beside it.

### 3. Replace the seven URLs in base.html

| Replace | With |
|---|---|
| `https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css` | `{{ url_for('static', filename='vendor/bootstrap-5.3.3/bootstrap.min.css') }}` |
| `https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css` | `{{ url_for('static', filename='vendor/bootstrap-icons-1.11.3/bootstrap-icons.min.css') }}` |
| `https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css` | `{{ url_for('static', filename='vendor/select2-4.1.0-rc.0/select2.min.css') }}` |
| `https://cdn.jsdelivr.net/npm/select2-bootstrap-5-theme@1.3.0/dist/select2-bootstrap-5-theme.min.css` | `{{ url_for('static', filename='vendor/select2-bootstrap-5-theme-1.3.0/select2-bootstrap-5-theme.min.css') }}` |
| `https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js` | `{{ url_for('static', filename='vendor/jquery-3.7.1/jquery.min.js') }}` |
| `https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js` | `{{ url_for('static', filename='vendor/bootstrap-5.3.3/bootstrap.bundle.min.js') }}` |
| `https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js` | `{{ url_for('static', filename='vendor/select2-4.1.0-rc.0/select2.min.js') }}` |

`url_for('static', …)` is safe in the shared layout — the `static` endpoint always exists,
unlike a module's endpoint, so it cannot raise `BuildError` the way the sidebar note warns
about.

If `base.html` carries `integrity=` attributes on these tags, they can stay: the files are
byte-identical, so the hashes still match. Drop `crossorigin=` on same-origin files if it
causes trouble; it is harmless either way.

### 4. Check

```bash
grep -c "cdn.jsdelivr" /opt/finance/templates/base.html     # expect 0
```

Then restart and load any page with the browser's developer tools open: no request should
go to `cdn.jsdelivr.net`, the icons should show, and the Select2 boxes should have their
search field.

## Two things to watch

**Content-Security-Policy.** If the clickjacking fix set only `frame-ancestors`, nothing
here is affected. If it also set a `script-src` or `style-src` naming `cdn.jsdelivr.net`,
add `'self'` — and once step 4 is clean, `cdn.jsdelivr.net` can come out of it, which is
the point of the exercise.

**Source maps.** The `.min` files end in a `sourceMappingURL` comment and the `.map` files
are not included. A browser asks for a `.map` only with developer tools open, so it costs a
404 in the console and nothing else. They were left as shipped so the bytes stay checkable
against the CDN.

## Rollback

Put the seven `https://cdn.jsdelivr.net/...` URLs back in `base.html` and restart. The
copied files can stay where they are; nothing loads them unless the layout asks.
