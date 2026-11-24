# Request to the SAP administrator: ZSHSO_FI_POST_UPL_V1 for ΤΑΕΠ billing

**From:** the ΤΑΕΠ costing tool project (OKYpY / SHSO)
**Date:** 24/11/2026
**Subject:** Specification of the upload programme ZSHSO_FI_POST_UPL_V1, so ΤΑΕΠ costings
and receipts can be posted to SAP per patient

## Why we are asking

Today SAP only receives the total cash collected at the ΤΑΕΠ, not the costings. An unpaid
or part-paid costing appears in SAP neither as revenue nor as a receivable. The aim is that
every costing and every receipt is posted to SAP **per patient**.

The decision (16/11/2026) is that the ΤΑΕΠ costing tool posts to SAP itself, the same way
eFinance does: an upload file for ZSHSO_FI_POST_UPL_V1 first, a live connection later.
We will not design the file until we have your specification.

What the tool already holds per costing: hospital, ΤΑΕΠ unit, costing number, financial
category, patient name and ID, finalisation date, total, the €100 deposit, each payment
(amount, date, method, receipt number) and each refund (amount, date, method, refund
number). Revisions and cancellations of a finalised costing are recorded too.

## What we need from you

### 1. The file itself
- File format (xlsx, csv or fixed-width text), sheet names, and whether it has a header
  line, one line per document, or header and item lines.
- Every column: its name, the SAP field it fills, data type, length, whether mandatory,
  and the allowed values.
- Character encoding (patient names are in Greek), date format, decimal separator, and how
  debit and credit are shown (posting key, sign, or separate columns).
- Limits: maximum lines per file and per document.
- **A sample file that has posted successfully**, ideally from eFinance.

### 2. Documents and periods
- Document type(s) to use for: a costing (revenue + receivable), a receipt, a refund, and
  a reversal or correction.
- Which date is the document date and which the posting date, and the rules for posting
  into a closed period.

### 3. Accounts and organisation
- Company code for each hospital. We hold them from eFinance's entities table; please
  confirm the full list.
- Revenue GL account(s) for ΤΑΕΠ self-pay. Say whether the weight charge and the
  price-list charges post to different accounts.
- The receivable: a customer account per patient, a one-time customer (CPD), or a GL
  account with the patient in the assignment field.
- The account for the €100 deposit taken at registration, the cash/bank account per
  hospital cashier, and the account for refunds.
- Profit centre / cost centre for each hospital and ΤΑΕΠ unit (adult and paediatric).
- Tax code for the services (we assume exempt medical services; please confirm).

### 4. Payers other than the patient
- Customer accounts and posting rules for Ευρωκάρτα (602), Βρετανικές Βάσεις (640), and
  the public-health categories, if those are to be posted from the tool as well.

### 5. References and personal data
- Which fields should carry the costing number, the patient ID and the patient name (for
  example reference, assignment, item text), and any limits on putting patient data in
  SAP.

### 6. Corrections
- How a posted costing is reversed or corrected when it is revised or cancelled: by a
  reversal line in the file, or manually in SAP.

### 7. Running it
- Who runs the upload, how often (daily or monthly), and where the file is placed.
- The format of the result or error log, and **how we get back the SAP document number
  for each line**, so the tool can reconcile what was posted.

### 8. Testing and the live connection
- Access to a test/QA client to try files before production, and a contact person.
- For the later live connection: whether we may post through a BAPI/RFC (for example
  BAPI_ACC_DOCUMENT_POST) or an OData service, and what service user and authorisations
  that would need.

### 9. Timing
- When the specification can be sent. The move of ΤΑΕΠ to its own portal is planned for
  January–March 2027 and the SAP posting is part of it.

---
*The SAP field and BAPI names above are the standard ones and are given only as examples;
please use whatever ZSHSO_FI_POST_UPL_V1 actually expects.*
