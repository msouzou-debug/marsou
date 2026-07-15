"""Οπτική ανάγνωση (vision) των σελίδων μέσω του Claude API."""

from __future__ import annotations

import base64
import json
import os
import re
import time

import anthropic

from .models import GREEK_MONTHS, LetterTotals, TableRow, normalize_month, parse_amount

DEFAULT_MODEL = os.environ.get("DASPANI_MODEL", "claude-sonnet-4-6")
MAX_TOKENS = 16000

TOTALS_PROMPT = """Βλέπεις τη σελίδα 1 (συνοδευτική επιστολή) μηνιαίας επιστολής της Αστυνομίας Κύπρου \
προς τον ΟΚΥπΥ με θέμα «Δαπάνη για τους Ειδικούς Αστυφύλακες».

Η επιστολή αναφέρει το συνολικό ζητούμενο ποσό (Γενικό Σύνολο) και ανάλυση σε: \
α) Βασικοί Μισθοί, β) Τιμαριθμικά Επιδόματα, γ) Αύξηση μισθού 1,5%, δ) Επίδομα Βάρδιας, \
ε) Αποζημίωση Κυριακής & Δημόσιας Αργίας, στ) Εισφορά Τ.Κ.Α. 24,25% κ.λπ. (εργοδότη), \
η) Διοικητικά Έξοδα 10%. Υπάρχουν και ενδιάμεσα μερικά αθροίσματα δεξιά — μην τα μπερδέψεις \
με τις επιμέρους γραμμές.

Διάβασε προσεκτικά και επίστρεψε ΜΟΝΟ ένα JSON αντικείμενο (χωρίς άλλο κείμενο, χωρίς markdown):
{
  "minas_misthon": "μήνας ΜΙΣΘΩΝ με ελληνικά κεφαλαία, π.χ. ΑΠΡΙΛΙΟΣ",
  "minas_epidomaton": "μήνας επιδομάτων βάρδιας/Κυριακής (συνήθως 2 μήνες πριν), π.χ. ΦΕΒΡΟΥΑΡΙΟΣ",
  "etos": "έτος μισθών, π.χ. 2026",
  "vasikoi": "ποσό α) Βασικοί Μισθοί",
  "timarithmiko": "ποσό β) Τιμαριθμικά Επιδόματα",
  "auxisi": "ποσό γ) Αύξηση μισθού 1,5%",
  "vardia": "ποσό δ) Επίδομα Βάρδιας",
  "kyriaki": "ποσό ε) Αποζημίωση Κυριακής & Δημόσιας Αργίας",
  "eisfora": "ποσό στ) Εισφορά Τ.Κ.Α./εργοδότη",
  "dioikitika": "ποσό η) Διοικητικά Έξοδα 10%",
  "geniko_synolo": "το συνολικό ζητούμενο ποσό της επιστολής"
}
Τα ποσά γράψε τα ακριβώς όπως εμφανίζονται (κείμενο). \
Αγνόησε τυχόν χειρόγραφα σύμβολα/σημειώσεις με μελάνι — δεν είναι ψηφία."""

TABLE_PROMPT = """Βλέπεις σελίδα σαρωμένου ονομαστικού καταλόγου Ειδικών Αστυφυλάκων \
(Αστυνομία Κύπρου προς Ο.Κ.Υπ.Υ). Στήλες: Α/Α, Α.Κ.Α., Ε/Αστ., Ονοματεπώνυμο, \
Ημερομηνία Τοποθέτησης, Βασικός Μισθός ΕΥΡΩ, Τιμάριθμος ΕΥΡΩ, ΑΥΞΗΣΗ ΜΙΣΘΟΥ, \
Επίδομα Βάρδιας, Επίδ. Κυριακής & Δ. Αργίας, ΠΑΡΑΤΗΡΗΣΕΙΣ (νοσηλευτήριο/σταθμός).

Μετάφερε ΟΛΕΣ τις γραμμές του πίνακα που βλέπεις σε JSON. Επίστρεψε ΜΟΝΟ έναν JSON πίνακα \
(χωρίς άλλο κείμενο, χωρίς markdown), ένα αντικείμενο ανά γραμμή:
{"aa": "...", "aka": "...", "east": "...", "name": "...", "date": "...",
 "basic": "...", "tim": "...", "auxisi": "...", "bardia": "...", "kyriaki": "...", "remarks": "..."}

Κανόνες:
- Δίπλα σε κάθε ποσό υπάρχει χειρόγραφο ✓ (μελάνι) — αγνόησέ το, δεν είναι ψηφίο.
- Κράτα τα ποσά ακριβώς όπως γράφονται, με 2 δεκαδικά. Κενό ή παύλα => "0.00".
- Υπάρχουν και ΜΗ αριθμημένες (συχνά έντονες/bold) πρόσθετες γραμμές διορθώσεων ή αναδρομικών \
για το ίδιο πρόσωπο — π.χ. με παρατήρηση «ΜΙΣΘΟΣ 3/2026» ή «ΑΝΑΔΡΟΜΙΚΑ ΕΠΙΔΟΜΑΤΑ 1/2026», \
ενδεχομένως με ΑΡΝΗΤΙΚΑ ποσά (π.χ. -262.54). Συμπεριέλαβέ τες ΟΠΩΣΔΗΠΟΤΕ, με aa="" και το \
πρόσημο σωστά. Το ίδιο και γραμμές «ΑΝΑΛΟΓΙΑ ...».
- Η Ημερομηνία Τοποθέτησης μπορεί να είναι «dd/mm/yyyy» ή «ΑΠΟ dd/mm/yyyy» — κράτα το κείμενο όπως είναι.
- Στο remarks βάλε ολόκληρο το κείμενο της στήλης ΠΑΡΑΤΗΡΗΣΕΙΣ (π.χ. «ΛΕΥΚΩΣΙΑ-Ε.Ο.Φ. ΜΑΚΑΡΙΟ \
ΝΟΣΟΚΟΜΕΙΟ», «ΛΕΜΕΣΟΣ-ΣΤΑΘΜΟΣ ΠΟΛΕΜΙΔΙΩΝ-ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ») και τυχόν «ΜΙΣΘΟΣ x/xxxx» κ.λπ.
- ΜΗΝ συμπεριλάβεις γραμμές κεφαλίδας ή γραμμές συνόλων (ΣΥΝΟΛΟ/ΟΛΙΚΟ).
- Αν μια γραμμή είναι μισοκομμένη στο πάνω ή κάτω άκρο της εικόνας και δεν διαβάζεται πλήρως, παράλειψέ την."""


class ExtractionError(RuntimeError):
    pass


def _client() -> anthropic.Anthropic:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ExtractionError(
            "Δεν βρέθηκε ANTHROPIC_API_KEY στο περιβάλλον. "
            "Ορίστε το με: export ANTHROPIC_API_KEY=sk-ant-..."
        )
    # Το SDK κάνει αυτόματα retry με backoff σε 429/5xx/σφάλματα δικτύου.
    return anthropic.Anthropic(max_retries=4)


def _vision_call(client: anthropic.Anthropic, model: str, png_bytes: bytes, prompt: str) -> str:
    image_b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    response = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        temperature=0,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
                },
                {"type": "text", "text": prompt},
            ],
        }],
    )
    if response.stop_reason == "max_tokens":
        raise ExtractionError("Η απάντηση του μοντέλου κόπηκε (max_tokens) — δοκιμάστε τεμαχισμό σελίδας.")
    return next(b.text for b in response.content if b.type == "text")


def _parse_json(text: str):
    """Απομονώνει και κάνει parse το JSON, ανεχόμενο τυχόν ```json περιβλήματα."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    start = min((i for i in (t.find("["), t.find("{")) if i >= 0), default=-1)
    if start > 0:
        t = t[start:]
    return json.loads(t)


def _call_json(client, model, png_bytes, prompt):
    """Κλήση vision με ένα επιπλέον retry αν το JSON δεν κάνει parse."""
    last_error = None
    for attempt in range(2):
        text = _vision_call(client, model, png_bytes, prompt)
        try:
            return _parse_json(text)
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = exc
            time.sleep(2)
            prompt = prompt + "\n\nΠΡΟΣΟΧΗ: Επίστρεψε ΑΠΟΚΛΕΙΣΤΙΚΑ έγκυρο JSON, τίποτα άλλο."
    raise ExtractionError(f"Μη έγκυρο JSON από το μοντέλο: {last_error}")


def extract_totals(png_bytes: bytes, model: str = DEFAULT_MODEL) -> LetterTotals:
    """Διαβάζει τη σελίδα 1 και επιστρέφει τα σύνολα-ελέγχου της επιστολής."""
    data = _call_json(_client(), model, png_bytes, TOTALS_PROMPT)
    if not isinstance(data, dict):
        raise ExtractionError("Αναμενόταν JSON αντικείμενο για τα σύνολα της επιστολής.")
    totals = LetterTotals(
        basic=parse_amount(data.get("vasikoi")),
        tim=parse_amount(data.get("timarithmiko")),
        auxisi=parse_amount(data.get("auxisi")),
        bardia=parse_amount(data.get("vardia")),
        kyriaki=parse_amount(data.get("kyriaki")),
        eisfora=parse_amount(data.get("eisfora")),
        dioikitika=parse_amount(data.get("dioikitika")),
        geniko=parse_amount(data.get("geniko_synolo")),
        minas_misthon=normalize_month(str(data.get("minas_misthon", ""))) or "",
        minas_epidomaton=normalize_month(str(data.get("minas_epidomaton", ""))) or "",
        etos=str(data.get("etos", "")).strip(),
    )
    return totals


def extract_table_rows(png_bytes: bytes, model: str = DEFAULT_MODEL) -> list[TableRow]:
    """Διαβάζει μία εικόνα πίνακα (ή τμήμα της) και επιστρέφει τις γραμμές."""
    data = _call_json(_client(), model, png_bytes, TABLE_PROMPT)
    if isinstance(data, dict):
        data = data.get("rows", [data])
    if not isinstance(data, list):
        raise ExtractionError("Αναμενόταν JSON πίνακας για τις γραμμές.")
    rows = []
    for item in data:
        if not isinstance(item, dict):
            continue
        row = TableRow(
            aa=str(item.get("aa", "") or "").strip(),
            aka=str(item.get("aka", "") or "").strip(),
            east=str(item.get("east", "") or "").strip(),
            name=str(item.get("name", "") or "").strip(),
            date=str(item.get("date", "") or "").strip(),
            remarks=str(item.get("remarks", "") or "").strip(),
        )
        try:
            row.basic = parse_amount(item.get("basic"))
            row.tim = parse_amount(item.get("tim"))
            row.auxisi = parse_amount(item.get("auxisi"))
            row.bardia = parse_amount(item.get("bardia"))
            row.kyriaki = parse_amount(item.get("kyriaki"))
        except ValueError as exc:
            row.flag(f"Μη αναγνωρίσιμο ποσό ({exc})")
        rows.append(row)
    return rows


def merge_rows(chunks: list[list[TableRow]]) -> list[TableRow]:
    """Ενώνει γραμμές από πολλά τμήματα, αφαιρώντας διπλές (λόγω επικάλυψης)."""
    # Διατηρείται η σειρά του PDF (οι μη αριθμημένες διορθωτικές γραμμές
    # πρέπει να μείνουν δίπλα στο πρόσωπο που αφορούν) — μόνο αφαίρεση διπλών.
    merged: list[TableRow] = []
    seen: set[tuple] = set()
    for chunk in chunks:
        for row in chunk:
            key = row.dedupe_key()
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)
    return merged
