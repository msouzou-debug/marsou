# Deployment notes

Examples only. Nothing here is installed by the app; Marios runs every step on the server.

## Scheduled jobs

Two jobs keep the timers and the mail moving. They run as the eHR system user, in the app folder, with the same environment file as the service. Paths are examples.

```
# Reminders, escalations, returned-request warnings and automatic withdrawal. Hourly on working hours.
0 7-17 * * 1-5  cd /srv/ehr && .venv/bin/flask --app wsgi:app run-timers >> /var/log/ehr/timers.log 2>&1

# Send queued email (also retries failed ones, up to 5 attempts). Every 5 minutes.
*/5 * * * *     cd /srv/ehr && .venv/bin/flask --app wsgi:app send-mail >> /var/log/ehr/mail.log 2>&1
```

- `run-timers` counts working days from the `public_holiday` table (Monday to Friday, minus holidays) and never counts paused time. Each reminder, escalation and warning goes once per clock start, so running it more often is safe. `--at 2026-03-02T09:00:00+00:00` runs it as if it were that time (testing only).
- The web app also tries to send right after a successful action. A failure there is never shown to the user; the cron job is the safety net.
- Queued mail older than `MAIL_MAX_AGE_HOURS` (48) is marked failed, not sent, when a real backend is turned on. This stops a backlog of test mail reaching real people.

## Email settings

The `mail_backend` row in the `setting` table chooses the backend: `outbox_only` (default, nothing leaves the app), `smtp` or `graph`. Secrets come from the environment only.

| Variable | Used by | Meaning |
|---|---|---|
| `EHR_BASE_URL` | all | Address in the email button, for example `https://ehr.example.invalid` |
| `EHR_SMTP_HOST`, `EHR_SMTP_PORT` (587), `EHR_SMTP_USER`, `EHR_SMTP_PASSWORD`, `EHR_SMTP_STARTTLS` (1) | smtp | Mail server |
| `EHR_MAIL_FROM` | smtp | Sender address |
| `EHR_GRAPH_TENANT`, `EHR_GRAPH_CLIENT_ID`, `EHR_GRAPH_CLIENT_SECRET`, `EHR_GRAPH_SENDER` | graph | App registration with the `Mail.Send` application permission, and the mailbox that sends |
