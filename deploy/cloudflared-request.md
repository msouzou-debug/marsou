# Request to whoever administers the cloudflared box

eCapital needs one new public hostname added to the cloudflared tunnel
configuration on its box (a separate server from 10.227.56.22, the same way
`finance.shso.online` and the eMAP/eQuality hostnames are already set up).

Unlike eFinance, eCapital sits behind nginx on `10.227.56.22` itself (see
`docs/deploy/RUNBOOK-10.227.56.22.md` for the nginx server block Marios
installs). So this request points cloudflared at nginx's port on that host,
not directly at eCapital's own port.

## What to add

| | |
|---|---|
| Public hostname | `capital.shso.online` |
| Target | `http://10.227.56.22:<nginx port for eCapital>` |
| Origin protocol | **Plain HTTP** — there is nothing to configure for TLS on the origin side |

The hostname itself, and which nginx port fronts eCapital, are Marios's
call — fill in the actual port once he has set up the server block. Do not
point this at `10.227.56.22:5013` directly; eCapital's own web process binds
to `127.0.0.1` only and is not reachable from outside the host at all.

```yaml
# ingress entry, in the shape the existing entries already use
- hostname: capital.shso.online
  service: http://10.227.56.22:<nginx port>
```

## Notes for whoever makes the change

- TLS terminates at Cloudflare. The server at 10.227.56.22 speaks plain HTTP
  on nginx's port and knows nothing about certificates — same as eFinance's
  `finance.shso.online → http://10.227.56.22:5004`.
- eCapital's web app (Next.js, port 5013) and its API (NestJS, port 5015)
  both bind to `127.0.0.1` only. Nginx on `10.227.56.22` is what actually
  answers the port cloudflared reaches; neither eCapital process is
  reachable directly from outside the host.

## After the change

A quick check from any machine, once DNS/Cloudflare have picked it up:

```bash
curl -I https://capital.shso.online/sign-in
```

A `200` (or a redirect to a sign-in route) means the tunnel is wired
correctly. If it times out or 502s, the origin (nginx on 10.227.56.22) is
either not running, not yet configured for this hostname, or eCapital's own
web process behind it is down — check `systemctl status ecapital-web` and
`sudo nginx -t` on 10.227.56.22 first.
