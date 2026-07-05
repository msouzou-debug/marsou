# Fixtures (not committed — confidential ΟΑΥ data)

Place the reference workbook here:

```
fixtures/OKYPY_HIO_F1049_MAR2026_Reconciliation.xlsx   ← the output spec
```

And one folder per acceptance month, containing every ΟΑΥ file for that
month (any filenames — the app identifies files by content):

```
fixtures/F1049_2026-03/    reference month (full set incl. SRA PDF)
fixtures/F1054_2026-05/    cross-check mode month (no SRA)
fixtures/F1054_2026-01/    inpatient three-way tie month
```

`tests/test_acceptance.py` picks these up automatically and asserts the
expected numbers from the brief to the cent; the tests skip while the
folders are empty.
