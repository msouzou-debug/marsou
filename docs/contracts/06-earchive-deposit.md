# 06 – Depositing requests in eArchive

Status: eHR side built (16/11/2026). eArchive's side is not known. This page is the proposal for the eArchive agent and Marios. Nothing here guesses eArchive's interface.

## What eHR deposits, and when

Marios decided on 16/11/2026:

- A deposit is one PDF of the request plus the supporting documents the requester attached.
- Two deposits per request at most. **`submitted`**: when the request is first submitted. **`approved`**: when the final approval is given. A resubmission after a return does not create another `submitted` deposit; that deposit is the state at the first submission.
- Rejected and withdrawn requests are not deposited at their end. A request that was deposited at submission and later ends without approval keeps its first deposit. eHR records on that deposit that the request ended as `rejected` or `withdrawn`, so eArchive can be told once its interface allows it. eHR does not ask eArchive to delete anything.
- If eArchive is down, eHR queues the deposit and retries. The user's action is never blocked or failed.

## The PDF

Greek, A4, made on the eHR server from the request: title and number, the status at the moment of the deposit, every field of the request as an approver sees it, the people who left (name, date, employment status, employer cost when entered), the financial table with its source line and ratio, the checks and opinions (who, on whose behalf, when, comment), the full history (replaced answers are marked), the list of attached documents (name, size, SHA-256, round, who, when) and a line saying when it was generated. Dates are dd/mm/yyyy in Cyprus time, amounts are 1.234,56 €.

The PDF is kept in eHR's storage folder with its SHA-256, so a retry sends the same bytes. Ordinary users never receive it; administrators can open it from Settings.

## Personal data

The deposit holds the full record, as decided: names of people who left, their leave dates and employment status, their annual employer cost, all comments, and the names of the requester and of everyone who acted. The supporting documents are whatever the requester attached. eArchive should treat the deposit as personal data under the same rules as eHR (retention is assumed to be 10 years until the DPO confirms).

## The manifest

`manifest.json`, UTF-8, sorted keys:

| Field | Meaning |
|---|---|
| `schema` | 1 |
| `key` | Idempotency key: `<request number>:<kind>`, for example `ΑΕΘ-2026-0007:approved` |
| `request_number`, `kind`, `round`, `status` | Number, `submitted` or `approved`, round of the request at that moment, status at that moment |
| `folder` | The same key in plain ASCII (`AEU-2026-0007-approved`): Θ is written U as in number search |
| `submitted_at`, `decided_at` | UTC, `2026-11-16T09:30:00Z`. `decided_at` only on `approved` |
| `directorate`, `facility` | `{code, name}` (Greek name) |
| `cost_centre_code`, `staff_category`, `position_title`, `positions_count`, `requester_name` | As entered |
| `files` | The PDF first (`role: request_pdf`), then each document (`role: document`) |

Each file: `stored_as` (name inside the deposit, unique), `name` (as the requester called it), `mime`, `size`, `sha256`; documents also `document_id`, `round`, `uploaded_by`, `uploaded_at`. The manifest does not change between retries, so its hash identifies the deposit. It does not carry the later outcome (`rejected`, `withdrawn`).

## What a transport does

One call: `deposit(manifest, files) -> reference`. `files` are the files named in the manifest. It must be idempotent on `key`: a retry, or the same deposit arriving twice, must not make a second record. It returns a text reference that eHR stores and shows on the request page (`Αριθμός στο eArchive: …`). It signals failure by raising; eHR records the message and tries again at the next run (every 5 minutes, up to 10 attempts, then an administrator presses a button).

Transports built: `none` (default; sends nothing, deposits wait), `folder` (writes `<number>-<kind>/` with `manifest.json`, the PDF and the documents into a drop folder; temporary name then rename; the same manifest again is a successful retry; a different manifest for the same name is refused, never overwritten; the reference is the folder name), and `http` (an empty class that says it is not written). The `http` class is written when the answers below exist.

## How it runs

The request page and the user's action never wait for it. The deposit row is written in the same transaction as the action. The PDF is made after the commit by `flask send-archive` (cron, every 5 minutes), because LibreOffice needs seconds. The same command hands the deposit to the transport. Requests submitted before this feature existed have no `submitted` deposit; only their final approval is deposited.

## Open questions only eArchive can answer

1. How does eArchive accept a record: an HTTP call (URL, authentication, size limit), a watched folder, a database, a file share?
2. Can it take several files and a metadata record as one unit, and does it want the metadata in this manifest shape or its own?
3. Does it deduplicate on a key we send? If not, what do we send so that a retry cannot create a second record?
4. What does it return that identifies the record (a number, a URL)? Is it stable?
5. Which metadata fields does it need that eHR does not supply (document type, classification, retention class, access group)?
6. How should a later outcome be told (the request was rejected or withdrawn after the `submitted` deposit): a status update, a new version, a note? eHR holds the fact and sends nothing until this is answered.
7. How are deposits of one request linked (`submitted` and `approved`): same folder, a version, a related-record field?
8. Maximum file size and allowed types (eHR accepts PDF, Word, Excel and images up to 20 MB each).
9. Which account does eHR use, and who sets it up (Marios and IT)?
10. Does eArchive's retention match eHR's assumed 10 years?
