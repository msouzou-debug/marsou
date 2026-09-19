# Importing the capital budget from Excel

The import command reads the capital budget workbook and builds the project register out of it, changing nothing in the file itself. Every run produces a reconciliation report in Greek, and nothing reaches the database unless you ask for it with `--commit`.

## Steps

1. **Inspect the file first.** This prints the sheets, the header row and every column with the place it ends up:

   `pnpm --filter @ecapital/api import:capex -- inspect --file /path/MASTER_FILE.xlsx --profile capex_plan_2026_02`

   Read the "what needs attention" section. If no column has moved and the rows come to 113 projects and 3 footer lines, carry on.

2. **Do a dry run.** The command performs the whole import and then undoes it, so the database is untouched:

   `pnpm --filter @ecapital/api import:capex -- --file /path/MASTER_FILE.xlsx --profile capex_plan_2026_02 --as your.name@shso.org.cy --report report.md`

3. **Read the report.** Section 3 shows whether each column adds up to what the file says, to the cent. Section 4 lists the exceptions by rule, each with its row, project and value. Section 7 says whether the import can be committed.

4. **Commit.** The same command with `--commit`:

   `pnpm --filter @ecapital/api import:capex -- --file /path/MASTER_FILE.xlsx --profile capex_plan_2026_02 --as your.name@shso.org.cy --commit --report report.md`

5. **Keep the report.** The same report is stored in the database with the file's SHA-256 fingerprint, so for a year we can say which file each record came from.

Only a system administrator can run the import, because it writes to every unit at once. Running the same file again creates no duplicates: a project is recognised by its unit and its title.

## What can go wrong

- **"X project rows were read … where the profile expects 113".** The shape of the file changed: projects were added or removed, or a footer line was renamed. Nothing was written. Run `inspect`, find what moved and update the profile in `apps/api/src/cli/profiles`.
- **"Cell W holds text where a number belongs".** Somebody typed "about 1.2m" into an amount column, or "during 2026" into a date column. The import does not guess amounts and does not read them as zero: the row stays out. Fix the cell in the file and run again.
- **"The unit is not recognised."** A unit is spelled a new way. Ask the system administrator to add that spelling as an alias of the unit, then run the import again.
- **"The run stayed a dry run."** One of the blocking rules (V04, V06, V07, V10, V11, V12, V13) did not pass. The report says which, and on which row. Fix the file and run again.
- **"This account may not run an import."** You need a system administrator account.
- **"The import needs a user."** `--as` is missing. Every row written is recorded in the audit trail under the person who imported it, so the command will not run without it.
