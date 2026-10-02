# Contract

This screen shows one contract: its facts, its bill of quantities, its cost position and its variations. Engineers, estates staff and finance use it to see how far a contract has moved from its original value.

## Steps

1. Open a contract from the "Contracts" card on the project page.
2. Read any warnings at the top of the page first — they never block anything, they only tell you something.
3. In the left column, check the contract's facts — including its budget code — and its bill of quantities, if one has been recorded.
4. In the right column, check the cost bar, the approved and pending variations, the retention and the variations list.
5. Press "Add" on the bill of quantities to enter it line by line, if it is empty.
6. Press the "Contract variations" title to see the full list on S08.
7. Where they appear, use the "Open in eMAP" and "Invoices in eFinance" links under the title. Both open in a new tab.
8. In the right column, under the retention, check the "eFinance link" panel: when the contract was sent, and the four figures eFinance holds for it.
9. Open the "eFinance invoices" tab to see the invoices eFinance has tagged with this contract. Press "Lines" on an invoice to see each line's description, quantity, price, cost centre, budget code and WBS.
10. Open the "eFinance requisitions" tab to see the purchase requisitions eFinance has tagged with this contract, with their amount, status and order number.
11. If you are a system administrator and you have fixed the cause of an error, press "Send to eFinance" to send the contract again. The result appears under the button.

The line above the title gives the contract reference (`CAP-2026-0031`) first and the contract number second. The reference is given by the system, never changes, and is the one eFinance records against an invoice.

**What each eFinance figure means.**

- **Actual spend.** Booked invoices only. These count as spend on the contract.
- **In flight.** Invoices eFinance is still processing that are not booked yet. They are shown for information and say "Not counted": they are in neither Actual spend nor Remaining, because an invoice in flight can still change or be rejected.
- **eFinance commitments.** eFinance's purchase requisitions. They are eFinance's own commitments and are not added to eCapital's Commitments.
- **Remaining.** The contract's current value minus Actual spend minus eFinance commitments, as eFinance works it out.

A dash "—" means eFinance has no figure. It does not mean zero.

## What can go wrong

- **"You do not have access to this page".** The contract is not yours, or it does not exist — this screen does not tell the two apart. Ask the system administrator for access.
- **"The data did not load".** The API did not answer. Press "Try again".
- **The approved variations figure is red.** They have passed 10% of the contract's original value.
- **The performance bond is red and says "Expired".** Its expiry date has passed; ask the contractor to renew it.
- **There is no "Open in eMAP" link.** Either the contract has no eMAP reference recorded — add one from "Edit" — or this server has not been told where eMAP is. eCapital never guesses a host.
- **There is no "Invoices in eFinance" link.** This server has not been told where eFinance is. Ask the system administrator.
- **You do not see an "Edit" button.** Only the project engineer, the head of estates and the system administrator can change a contract's facts.
- **The budget code fact says "Not recorded".** The contract was recorded before this field existed. Open "Edit" and pick a code.
- **The panel says "eFinance link not configured".** This server has no eFinance link set up yet, so eCapital sends nothing to eFinance and reads nothing from it. It is not a fault on the contract; ask the system administrator to set the link up.
- **The panel says "eFinance holds this contract under another unit or budget code".** The contract's reference already exists in eFinance under another unit or budget code, and eFinance refused the send. eCapital does not retry it by itself. Check the project's unit and the contract's budget code, correct whichever is wrong, and ask an administrator to press "Send to eFinance".
- **The panel says "Not sent yet" and there is a warning.** The contract has no budget code, or its contractor has no SAP vendor code. Fill in what is missing; the contract is sent again after the correction.
- **You do not see the "Send to eFinance" button.** Only the system administrator sees it.
- **The "eFinance invoices" and "eFinance requisitions" tabs are empty.** Rows appear once eFinance tags an invoice or a requisition with the contract's reference (`CAP-2026-0031`). Until then there is nothing to show.
- **An invoice says "Reversed".** eFinance cancelled it. It stays in the list with its reason, as history, and does not count as spend.
- **An eFinance figure shows "—".** eFinance has no figure for it yet. It does not mean zero.
