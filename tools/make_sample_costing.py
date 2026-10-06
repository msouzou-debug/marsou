# -*- coding: utf-8 -*-
"""
Builds the specimen printed costing documents.

They are produced by driving the real routes through the test harness, so a specimen is
what a clerk's printer puts out and not a mock-up. Two cases, chosen to show both ends of
the range and every block that can appear:

  docs/sample_kostologisi.pdf            weight 12, category 600, with a tariff charge
  docs/sample_kostologisi_diaologi.pdf   triage only, category 603, registration fee
  docs/TAEP_deigmata_kostologisis.pdf    the two above merged, for circulation

The long values in the first case are deliberate. The relative's name and contact number
are what used to run off the right edge of the page.

    python3 tools/make_sample_costing.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import taep                        # noqa: E402
from taep_harness import Harness   # noqa: E402

# A chest pain that turns into a cardiology referral: investigation category 2,
# treatment category 4, so the matrix gives weight 12 — the high band, which puts the
# longest band label on the page.
HIGH_SERVICES = ["AED001", "AED006", "AED008",            # ΗΚΓ, αιματολογία, βιοχημεία
                 "AET003", "AET004", "AET057", "AET078"]  # φλεβοκαθετήρας,
#                                     παρακολούθηση, οξυγόνο, ενδοφλέβιο φάρμακο
# Category 600 may also carry tariff charges, so the specimen shows that section too.
TARIFF = {"tariff_code": ["SHSO-ER1"], "tariff_quantity": ["1"]}

PATIENT_A = {
    "episode_number": "2026/0014872",
    "last_name": "Παπαδόπουλος",
    "first_name": "Ανδρέας",
    "date_of_birth": "1968-03-11",
    "gender": "Άρρεν",
    "phone": "99123456",
    "address": "Λεωφόρος Αρχιεπισκόπου Μακαρίου Γ΄ 142, 2311 Λακατάμια, Λευκωσία",
    "id_type": "Ταυτότητα",
    "id_number": "1048372",
    "id_country": "Κύπρος",
    "id_expiry": "2029-07-30",
    "next_of_kin_type": "Σύζυγος",
    "next_of_kin_details": "Μαρία Παπαδοπούλου 99654321",
    "comments": "Προσήλθε με πόνο στο στήθος. Παραπέμφθηκε στο Καρδιολογικό.",
    "admission_at": "2026-09-14T21:40",
    "examination_at": "2026-09-14T22:05",
    "discharge_at": "2026-09-15T00:50",
}

PATIENT_B = {
    "episode_number": "2026/0014905",
    "last_name": "Ahmed",
    "first_name": "Yusuf",
    "date_of_birth": "1995-02-20",
    "gender": "Άρρεν",
    "phone": "96887712",
    "address": "Οδός Ερμού 18, 1016 Λευκωσία",
    "id_type": "Δελτίο αιτητή ασύλου",
    "id_number": "AS-2026-10448",
    "id_country": "Συρία",
    "id_expiry": "2027-01-31",
    "next_of_kin_type": "",
    "next_of_kin_details": "",
    "comments": "Διαλογή και παραπομπή σε Κέντρο Υγείας. Δεν χρειάστηκε θεραπεία.",
    "admission_at": "2026-09-16T09:12",
    "examination_at": "2026-09-16T09:25",
    "discharge_at": "2026-09-16T09:40",
}


def build(harness, category_code, patient, services, tariff):
    ctx = harness.ctx
    category = next(c for c in taep.list_ae_categories(ctx)
                    if c["code_new"] == category_code)
    form = dict(patient)
    form["taep_unit_code"] = "NIC-ADULT"
    form["financial_category_id"] = str(category["id"])

    response = harness.client.post("/taep/nea", data=form, follow_redirects=False)
    assert response.status_code == 302, response.get_data(as_text=True)[:500]
    episode_id = int(response.headers["Location"].rstrip("/").split("/")[-1])

    if services:
        harness.client.post("/taep/%d/services" % episode_id,
                            data={"service_code": services}, follow_redirects=True)
    for path in ("calculate", "finalise"):
        response = harness.client.post("/taep/%d/%s" % (episode_id, path), data=tariff,
                                       follow_redirects=True)
        assert response.status_code == 200, (path, response.status_code)

    episode = taep.get_episode(ctx, episode_id)
    assert episode["status"] == "FINALISED", episode["status"]
    return episode_id, episode


def main():
    written = []
    with Harness() as harness:
        # Triage only: no services selected at all, which is how a triage-only visit is
        # entered. Category 603 carries the €10 registration fee.
        for name, category_code, patient, services, tariff in (
            ("sample_kostologisi", "600", PATIENT_A, HIGH_SERVICES, TARIFF),
            ("sample_kostologisi_diaologi", "603", PATIENT_B, [], {}),
        ):
            episode_id, episode = build(harness, category_code, patient, services,
                                        tariff)
            out = ROOT / "docs" / ("%s.pdf" % name)
            out.write_bytes(taep.render_costing_pdf(harness.ctx, episode_id))
            written.append(out)
            print("wrote %s — %s" % (out.name, episode["costing_number"]))

    from pypdf import PdfWriter
    merged = ROOT / "docs" / "TAEP_deigmata_kostologisis.pdf"
    writer = PdfWriter()
    for path in written:
        writer.append(str(path))
    writer.add_metadata({"/Title": "ΤΑΕΠ — Δείγματα κοστολόγησης", "/Author": "ΟΚΥπΥ"})
    with open(merged, "wb") as handle:
        writer.write(handle)
    print("wrote %s — %d pages" % (merged.name, len(writer.pages)))


if __name__ == "__main__":
    main()
