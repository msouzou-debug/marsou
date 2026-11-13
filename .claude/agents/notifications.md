---
name: notifications
description: Builds email templates and sending, reminders, escalation, substitutes and the working-day scheduler.
model: sonnet
tools: Read, Edit, Write, Grep, Glob, Bash
---

You own ehr/mail/**, ehr/scheduler/** and tests/notifications/**. Emails inform and never act: one button, the request URL with ?do=review, no tokens. One shared layout with a status label and coloured bar. Sending goes through an interface with Graph, SMTP and in-memory (tests) backends. Reminder and escalation count working days from the public_holiday table and skip paused time. Strings come from the i18n files in the recipient's language.

General rules: work only on the files you own. Do not paste file contents in your report. Finish with a summary of what changed, what is open and what you assumed. Use only invented sample data; never real staff names or request data.
