# SAP import

The screen uploads SAP export files (capital spending lines, FBL1N), or fetches them straight from SAP, and matches their transactions to projects and contracts. Finance and the administrator use it to update commitments and spend every month.

## Steps

1. Open «Cost» in the main navigation and choose the «SAP import» tab.
2. Choose the file, the SAP report and the period. The default is «SAP capital spending lines». The ME2N and KSB1 reports are retired and no longer offered for new imports; their old batches stay in the list.
3. Click «Dry run» to see how many rows match automatically, without saving anything.
4. If the result looks right, click «Import» to record the batch.
5. Open the batch from the list to see the matching queue of transactions that found no project.
6. For each transaction, read the suggested match on the right and press Enter to accept it, or press 1 to 9 for one of the alternatives.
7. Press "s" to skip a transaction, or select several with Space and press Shift+A to bulk-assign them to one project.
8. Or, without a file: in the «Fetch from SAP» card set the fiscal year and the period from and to (1 to 16, the previous month by default) and click «Fetch». The batch appears as it does after a file upload.
9. In the queue, each line shows under the vendor the SAP vendor number and the contract reference (CAP-…) where it has them. Lines that matched by themselves carry the label «Contract reference» or «eFinance invoice».
10. Once every transaction is matched or skipped, click «Complete import».

## VAT

SAP lines carry one amount and the system takes it as including VAT. eFinance invoices carry a net amount and a rate per line, so they are posted with VAT and keep both. Matching to an eFinance invoice accepts either its net or its total with VAT until Finance confirms which SAP sends.

## What can go wrong

- **The «Fetch from SAP» card says the connection is not set up.** The connector key has not been placed on the server yet. It is not your fault: ask IT to place it and use a file meanwhile.
- **The system refuses an ME2N or KSB1 file.** Those reports are retired because SAP holds no WBS elements. Ask SAP for the capital spending lines file.
- **You cannot see the import card.** Only Finance and the administrator import SAP files.
- **The dry run shows exceptions.** Some rows in the file have a format problem — fix the file and try again.
- **The matching queue is view-only.** On a phone the queue lists the transactions but does not assign them — use a computer or tablet.
- **You see no suggestion for a transaction.** Use bulk assign to search for it by hand.
- **"Data did not load".** The API did not respond. Click "Try again".
