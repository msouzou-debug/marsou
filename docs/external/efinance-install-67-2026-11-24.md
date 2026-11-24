# Install 67: eFinance answers eHire's two questions (24/11/2026)

## What it does

eHire can now ask eFinance two things:
- the list of cost centres;
- the salary budget lines of a hospital or Directorate, for a given year.

eFinance only answers questions that come from programs on the same server, and only when they bring the right key. It changes nothing in eFinance and sends no personal data. It doesn't touch approvals, payments or SAP.

The install also creates eHire's key inside eFinance's settings file, without showing it to anyone.

## Run

```powershell
ssh -t administrator@10.227.56.22 "sudo bash /tmp/deploy67.sh"
```

It ends with eFinance «active», and the new address `/api/ehire/cost-centres` showing **HTTP 401**. That's correct: the check calls it without the key, so it's refused.

## Then

1. Send eHire the note `eFinance-to-eHire-link-ready-deploy67-24-11.md`.
2. eHire sends you a small script that copies the key across to eHire's own settings, file to file. Run it, then eHire's steps A to D.
3. Ask Finance to enter the 2026 and 2027 salary budgets. Until they do, eHire shows "no budget loaded" on every request.

Tests: 584, all passed.
