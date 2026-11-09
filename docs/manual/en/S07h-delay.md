# Deadlines and penalties

This screen shows when a contract has to be finished, which extensions of time have been approved, and how much delay penalty has built up. Engineers and the head of estates use it to record sections and extensions, and finance uses it to see the amount before the payment certificate.

## Steps

1. Open a contract and press the "Deadlines and penalties" tab.
2. Read the deadlines table. Each row is a section, or the contract itself if it has none. The due date is the contractual completion plus the extensions. Days late run from the due date to handover, or to today while the works have not been handed over.
3. "Penalty accruing" is the days late times the penalty per day. It is shown for information. Finance withholds it on the payment certificate.
4. Press "Add section" to record a code, a title, the contractual completion, the handover date and, if it differs from the contract's, a penalty per day. Use "Edit" and "Delete" to change or remove a section.
5. Press "Add extension" to record an approved extension of time: the section (or the whole contract), the days, the date approved, who approved it (ΤΕΑΑ, ΚΕΑΑ, Project engineer or Other), their name and the reason.
6. Always answer "Contractor at fault". The answer has no default, because it is a judgement that has to be on record.
7. If you are the head of estates or the system administrator, press "Activate penalty" on a row, give a date and a note and save.

On the contract's Overview, "Extensions of time" is the sum of the extensions on this tab. It is not typed anywhere else.

## What can go wrong

- **You do not see the add, edit or delete buttons.** Only the project engineer, the head of estates and the system administrator see them.
- **You do not see the "Activate penalty" button.** Only the head of estates and the system administrator see it, and only on a row that has not been activated yet.
- **The penalty says "—".** No penalty per day has been recorded, on the contract or on the section, so the amount cannot be worked out. Fill in the rate from "Edit" on the contract or the section.
- **The contract has sections and no deadline of its own.** When there are sections, each has its own deadline and the contract has none.
- **"The section code is already used".** Two sections of one contract cannot share a code. Pick another.
- **The contract already has sections, or the activation is refused.** The screen shows the sentence the server sends. Activate the penalty on the section, not on the contract.
- **You deleted an extension.** Its days come off the due date and the penalty is counted again.
- **"Fill in this field".** Every field of an extension is required.
