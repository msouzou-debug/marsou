# Questions for eMAP: how eCapital and eMAP will talk

19 November 2026. From the eCapital side. Today the two systems share
nothing but a link: eCapital opens `{emap_url}/contracts?q=CON-…` from a
contract that carries an eMAP reference, and eFinance routes `CON-` to eMAP
and `CAP-` to eCapital by prefix. Everything below asks whether that should
stay a link or become data, and on what terms. Where eCapital already has a
position it is stated, so eMAP can say yes, no or otherwise.

Context eMAP may not have: eCapital holds the capital project from idea to
closure and the construction contract from award: BOQ, variations, payment
certificates, RFIs, site instructions, defects, sections, extensions of
time, delay penalties, claims. It links out and never copies another
system's records (INTEGRATION-eFinance-eMAP-eCapital.md §1).

## A. Where a capital contract is born

1. Does every construction and E&M contract of ΟΚΥπΥ pass through eMAP, or
   do some run outside it (tenders run by the Τμήμα Δημοσίων Έργων, direct
   awards below a threshold, framework call-offs)? eCapital needs to know
   which contracts will never have a `CON-` reference.
2. Is `CON-YYYY-NNNN` the one and only reference for a contract, allocated
   at award and never reissued? What happens on a renewal, a framework
   call-off or an amendment: new `CON-`, suffix, or the same number?
3. At award, which of these does eMAP hold as fields, not as text in a PDF:
   award date, award decision number, contractor, contractor's SAP vendor
   number, contract value excluding VAT, contract number on the papers,
   start date, contractual completion date, duration, defects liability
   period, performance bond value and expiry, retention percentage,
   liquidated damages rate per day, sections or phases with their own
   completion dates. eCapital types all of these today. Whatever eMAP holds,
   eCapital would rather read than retype.

## B. Direction and mechanism

4. Should an award in eMAP create a draft contract in eCapital? eCapital's
   proposal: eMAP does nothing on its side; eCapital reads
   `GET /api/contracts/{con_ref}` on loopback with a token, the way it reads
   eFinance (ADR-0022), and the engineer confirms the draft. Does such a
   read route exist, or could it?
5. If a push is preferred instead, what event would eMAP send (award
   signed, PO released, contract closed) and in what shape? eCapital can
   expose a loopback endpoint with the same rules it holds for eArchive:
   token, idempotency key, refuse forwarded-edge headers.
6. Is eMAP on the same host (10.227.56.22) and which port does it listen on
   for loopback calls? Is there a test instance?
7. Who keys a contract in eMAP to the hospital: which unit codes does eMAP
   use today? eCapital and eFinance moved to one set on 19/10/2026 (`PAP`,
   `TRD`, `ARC`, `CHR`, `MH`, `HC`, the rest unchanged, ADR-0034).

## C. Contractors

8. Where is the contractor master: eMAP's supplier list, eFinance's vendor
   list, or SAP? eCapital keys contractors on the SAP vendor number and
   reads them through eFinance. Does eMAP hold the SAP vendor number on each
   supplier, and the VAT number?
9. Does eMAP hold an exclusion or blacklist status that eCapital should
   respect when a contract is recorded?

## D. Purchase orders and money

10. For a construction contract, does eMAP raise one `PO-` per contract, one
    per payment certificate, or none? Does the PO carry the WBS element and
    cost centre?
11. eCapital's committed ledger reads SAP purchase orders today (ME2N
    extract). Would eMAP serve its POs by `CON-` reference, so the match is
    by key and not by text?
12. When eCapital approves a variation the contract's current value changes.
    Does eMAP need that figure, and who approves the change on eMAP's side
    (ΚΕΑΑ)? eCapital's position: eCapital holds the current value, eMAP
    keeps the award value, and the link shows both.
13. Payment certificates are eCapital's and become invoices in eFinance.
    Does eMAP need to see them at all?

## E. Extensions of time, penalties, claims (the ΜΕΕ findings)

14. Where is an extension of time recorded today: in eMAP, in the minutes of
    ΤΕΑΑ/ΚΕΑΑ, or nowhere structured? Since 09/11/2026 eCapital records each
    one with approver, date, reason and a contractor-culpable answer
    (ADR-0035). If eMAP also records it, one of the two must be the source.
15. Same question for the delay penalty activation and for claims and
    counterclaims. eCapital computes the accrued penalty and shows it to
    finance; it never deducts.
16. Does eMAP hold the Πιστοποιητικό Παραλαβής (handover) date per contract
    or per section? eCapital's delay clock stops on it.

## F. Links in both directions

17. `{emap_url}/contracts?q=<CON-ref>` is what eCapital opens today. Is that
    route stable, and does it need a signed-in eMAP user?
18. Would eMAP add the mirror link: from a contract that has a capital
    counterpart, open `{ecapital_url}/contracts/lookup?q=<CAP-ref>`? That
    route exists and resolves a `CAP-` reference. It needs one setting on
    eMAP's side, the same as eFinance's `CAP-` routing rule.
19. Should eMAP store the `CAP-` reference on its contract, and eCapital the
    `CON-` reference on its (it does already), so the two keys live on both
    records?

## G. Documents

20. Does eMAP file the award decision and the signed contract to eArchive?
    eCapital files the award decision too (`source_module: award`). If eMAP
    files it first, eCapital should carry eMAP's protocol number instead of
    filing a second copy. Which of the two files, and who tells the other?

## H. People

21. Are eMAP's users the same people as eCapital's contract coordinators and
    engineers? Does eMAP plan Active Directory sign-in? eCapital has LDAP
    designed and waits on IT.

## I. Operations

22. Error envelope, token placement and rotation, and the contact person for
    integration changes on eMAP's side.
23. Release cadence: how much notice does eMAP give before a route changes?
24. If eMAP is unreachable, eCapital shows «δεν απαντά» and carries on. Is
    the reverse acceptable for eMAP?

## What eCapital will do with the answers

Write the agreed shape into `INTEGRATION-eFinance-eMAP-eCapital.md` §4 as
"eCapital ↔ eMAP" with routes, keys and who owns which field, and build the
read of the award (question 4) first if eMAP offers it. Nothing else is
started before both sides have signed the section.
