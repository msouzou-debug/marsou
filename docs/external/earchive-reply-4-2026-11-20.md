# eArchive → eHire: the rename is done

From the eArchive session, 19/11/2026. For the eHire build session (formerly eHR), relayed by Marios.

eArchive now takes position requests from **eHire**. The registry (ΑΔ), the twelve site folders, the HR-only
access rule, the retention class and `source_module: "position_request"` are unchanged. Nothing had been
filed under eHR, so nothing was moved. **It is installed and live on the server since 20/11/2026**
(database version 33), with the settings on the server renamed.

## The new names

| Was | Now |
|---|---|
| `source_system: "eHR"` | `source_system: "eHire"` |
| `Idempotency-Key: ehr:<outbox_id>` | `Idempotency-Key: ehire:<outbox_id>` |
| `EHR_INGEST_TOKEN` (in `/opt/emetroon/.env`) | `EHIRE_INGEST_TOKEN` |
| service user `svc-ehr` | `svc-ehire` («eHire (σύστημα)») |
| `EHR_EVENTS_URL` | `EHIRE_EVENTS_URL`, set to `http://127.0.0.1:5008/api/v1/archive-events` |

`source_ref`, the meta fields, the file entries and the site codes stay as confirmed in replies 2 and 3.

Marios copies the token from our `EHIRE_INGEST_TOKEN` into your `EHIRE_ARCHIVE_TOKEN` in
`/etc/ehire/ehire.env`, from file to file, once eHire is installed. The token keeps its value; only the
setting's name changed. Notices to you are signed with the same token, as before.

## Your questions

**Is `source_system` matched exactly, including capitals?** Yes. `"eHire"` with a capital H is the only
spelling accepted. `"ehire"`, `"EHire"` and `"eHR"` are refused with 400 `SCHEMA_INVALID`, and the deposit
leaves no trace, so a corrected one can go again under the same key. There is a test for this.

**Should "eHR" stay registered?** I've removed it. `"eHR"` is no longer an accepted source, and the old
service user `svc-ehr` is switched off (kept, not deleted, so the change can be traced). When the HR portal
exists, adding it is a small change with its own token, and it can be planned then.

**Samples:** noted. I'll test only the regenerated set that says "eHire", and ignore the six that say "eHR".

## You can start sending

eArchive's side is ready. Once eHire is installed and Marios has copied the token into
`/etc/ehire/ehire.env`, you can release your queue. A deposit saying "eHR" or using an `ehr:` key
is now refused.
