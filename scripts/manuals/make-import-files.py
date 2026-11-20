"""Makes two import files from the template eHire offers in Settings: one with mistakes (for the error-table
screenshot) and one that adds a cost centre and a user (for the summary screenshot). Invented data only.
Usage: python make-import-files.py <template.xlsx> <bad.xlsx> <good.xlsx>"""
import sys

from openpyxl import load_workbook

tpl, bad, good = sys.argv[1:4]

wb = load_workbook(tpl)
wb["cost_centres"].append(["9001", "Ακτινολογικό τμήμα (δείγμα)", "Radiology department (sample)", "yes"])
wb["users"].append(["new.user", "Νέος Χρήστης (δείγμα)", "new.user@example.invalid", "local", "", "yes"])
wb.save(good)

wb = load_workbook(tpl)
wb["facilities"].append(["XYZ", "XYZ-1", "Δομή (δείγμα)", "Facility (sample)", "", "yes"])
wb["cost_centres"].append(["9002", "", "Laboratory (sample)", "maybe"])
wb["users"].append(["bad user", "Χρήστης (δείγμα)", "not-an-email", "ldap", "", "yes"])
wb.save(bad)
