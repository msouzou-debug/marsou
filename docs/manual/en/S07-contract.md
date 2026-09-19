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

The line above the title gives the contract reference (`CAP-2026-0031`) first and the contract number second. The reference is given by the system, never changes, and is the one eFinance records against an invoice.

## What can go wrong

- **"You do not have access to this page".** The contract is not yours, or it does not exist — this screen does not tell the two apart. Ask the system administrator for access.
- **"The data did not load".** The API did not answer. Press "Try again".
- **The approved variations figure is red.** They have passed 10% of the contract's original value.
- **The performance bond is red and says "Expired".** Its expiry date has passed; ask the contractor to renew it.
- **There is no "Open in eMAP" link.** Either the contract has no eMAP reference recorded — add one from "Edit" — or this server has not been told where eMAP is. eCapital never guesses a host.
- **There is no "Invoices in eFinance" link.** This server has not been told where eFinance is. Ask the system administrator.
- **You do not see an "Edit" button.** Only the project engineer, the head of estates and the system administrator can change a contract's facts.
- **The budget code fact says "Not recorded".** The contract was recorded before this field existed. Open "Edit" and pick a code.
