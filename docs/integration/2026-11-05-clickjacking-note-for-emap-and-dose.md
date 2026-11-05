# To eMAP and the dose application — clickjacking finding of 05/11/2026, and the fix eCapital applied

5 November 2026. The penetration test reported that `emap.shso.online/login`
and `dose.shso.online/login` can be loaded inside a frame on another site
(CVSS 2.1, clickjacking). eCapital was not named but had the same gap and
closed it today; this note says what was done so the three systems answer
the same way.

## What the test wants

Two response headers on every page and every route:

```
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

`frame-ancestors` is the current control; `X-Frame-Options` is the same
rule for older browsers. Use `'self'` and `SAMEORIGIN` only if the
application frames its own pages (a print preview in an iframe, for
example); otherwise `'none'` and `DENY`.

## Two ways to set them

**In the application**, which is what eCapital did: the headers ship with
the release and nobody edits the server.

- Next.js: `headers()` in `next.config.ts` with `source: "/(.*)"`.
- Express or NestJS: one middleware that sets the two headers before any
  handler, or `helmet()` with `frameguard` and `contentSecurityPolicy`
  limited to `frame-ancestors`.
- Python (FastAPI, Flask, Django): Django has `X_FRAME_OPTIONS = "DENY"`
  and `SECURE_*` settings; FastAPI and Flask take a two-line middleware.

**In nginx**, in the server block of the hostname, if the application
cannot be changed quickly. Paste-ready, then `sudo nginx -t` before
`sudo systemctl reload nginx`:

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Frame-Options "DENY" always;
```

Note that `add_header` in a `location` block replaces every `add_header`
of the enclosing `server` block, so put these at the level where the other
headers already are, or repeat them in each `location`.

## While you are there

The same scan will usually also ask for `X-Content-Type-Options: nosniff`
and a `Referrer-Policy`. eCapital added both in the same change. If the
application already sets a full `Content-Security-Policy`, add
`frame-ancestors 'none'` to it rather than sending a second policy.

## How to check

From any machine on the internet:

```bash
curl -sI https://emap.shso.online/login | grep -i "x-frame-options\|content-security-policy"
```

Two lines back, `DENY` and `frame-ancestors 'none'`, closes the finding.
