# SAP import

The screen uploads SAP export files (ME2N, KSB1, FBL1N) and matches their transactions to projects and contracts. Finance and the administrator use it to update commitments and spend every month.

## Steps

1. Open «Cost» in the main navigation and choose the «SAP import» tab.
2. Choose the file, the SAP report and the period.
3. Click «Dry run» to see how many rows match automatically, without saving anything.
4. If the result looks right, click «Import» to record the batch.
5. Open the batch from the list to see the matching queue of transactions that found no project.
6. For each transaction, read the suggested match on the right and press Enter to accept it, or press 1 to 9 for one of the alternatives.
7. Press "s" to skip a transaction, or select several with Space and press Shift+A to bulk-assign them to one project.
8. Once every transaction is matched or skipped, click «Complete import».

## What can go wrong

- **You cannot see the import card.** Only Finance and the administrator import SAP files.
- **The dry run shows exceptions.** Some rows in the file have a format problem — fix the file and try again.
- **The matching queue is view-only.** On a phone the queue lists the transactions but does not assign them — use a computer or tablet.
- **You see no suggestion for a transaction.** Use bulk assign to search for it by hand.
- **"Data did not load".** The API did not respond. Click "Try again".
