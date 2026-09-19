# Request to whoever administers the cloudflared box

eCapital needs one new public hostname added to the cloudflared tunnel
configuration on its box (a separate server from 10.227.56.22, the same way
`finance.shso.online` and the eMAP/eQuality hostnames are already set up).

## What to add

| | |
|---|---|
| Public hostname | `capital.shso.online` |
| Target | `http://10.227.56.22:5005` |
| Origin protocol | **Plain HTTP** — there is nothing to configure for TLS on the origin side |

```yaml
# ingress entry, in the shape the existing entries already use
- hostname: capital.shso.online
  service: http://10.227.56.22:5005
```

## Notes for whoever makes the change

- TLS terminates at Cloudflare. The server at 10.227.56.22 speaks plain HTTP
  on port 5005 and knows nothing about certificates — same as eFinance's
  `finance.shso.online → http://10.227.56.22:5004`.
- Port 5005 is eCapital's web app (Next.js), bound to `0.0.0.0` for exactly
  this purpose. Nothing else should point at it.
- No nginx sits in front of eCapital on 10.227.56.22 either. eFinance's own
  note is "χωρίς nginx vhost — το cloudflared χτυπά κατευθείαν το port", and
  eCapital follows the same default unless told otherwise (nothing in the
  eFinance notes says nginx should front a sibling app, so we are not adding
  one).
- eCapital's API (NestJS, port 5015) is **not** part of this request — it
  binds to `127.0.0.1` only and is never reached from outside the host.

## After the change

A quick check from any machine, once DNS/Cloudflare have picked it up:

```bash
curl -I https://capital.shso.online/sign-in
```

A `200` (or a redirect to a sign-in route) means the tunnel is wired
correctly. If it times out or 502s, the origin (10.227.56.22:5005) is either
not running yet or not reachable from the cloudflared box — check
`systemctl status ecapital-web` on 10.227.56.22 first.
