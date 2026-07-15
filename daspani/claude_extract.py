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
προς τον ΟΚΥπΥ για τη «Δαπάνη Ειδικών Αστυφυλάκων».

Διάβασε προσεκτικά και επίστρεψε ΜΟΝΟ ένα JSON αντικείμενο (χωρίς άλλο κείμενο, χωρίς markdown) με τα πεδία:
{
  "minas_misthon": "μήνας μισθών με ελληνικά κεφαλαία, π.χ. ΑΠΡΙΛΙΟΣ",
  "minas_epidomaton": "μήνας επιδομάτων (συνήθως 2 μήνες πριν), π.χ. ΦΕΒΡΟΥΑΡΙΟΣ",
  "etos": "έτος, π.χ. 2026",
  "vasikoi": "Βασικοί Μισθοί",
  "timarithmiko": "Τιμαριθμικό Επίδομα",
  "auxisi": "Αύξηση Μισθού 1,5%",
  "vardia": "Επίδομα Βάρδιας",
  "kyriaki": "Επίδομα Κυριακής & Δημόσιας Αργίας",
  "eisfora": "Εισφορά Εργοδότη",
  "dioikitika": "Διοικητικά Έξοδα 10%",
  "geniko_synolo": "Γενικό Σύνολο"
}
Τα ποσά γράψε τα ακριβώς όπως εμφανίζονται (κείμενο), με 2 δεκαδικά. \
Αγνόησε τυχόν χειρόγραφα σύμβολα ✓ δίπλα στα ποσά — δεν είναι ψηφία."""

TABLE_PROMPT = """Βλέπεις τμήμα σαρωμένου ονομαστικού πίνακα «Δαπάνη Ειδικών Αστυφυλάκων» \
(Αστυνομία Κύπρου). Στήλες: Α/Α, Α.Κ.Α., Ε/Αστ., Ονοματεπώνυμο, Ημερομηνία Τοποθέτησης, \
Βασικός Μισθός, Τιμάριθμος 12,67%, Αύξηση Μισθού, Επίδομα Βάρδιας, Επίδ. Κυριακής & Δ. Αργίας, Παρατηρήσεις.

Μετάφερε ΟΛΕΣ τις γραμμές του πίνακα που βλέπεις σε JSON. Επίστρεψε ΜΟΝΟ έναν JSON πίνακα \
(χωρίς άλλο κείμενο, χωρίς markdown), ένα αντικείμενο ανά γραμμή:
{"aa": "...", "aka": "...", "east": "...", "name": "...", "date": "...",
 "basic": "...", "tim": "...", "auxisi": "...", "bardia": "...", "kyriaki": "...", "remarks": "..."}

Κανόνες:
- Αγνόησε τα χειρόγραφα ✓ (μαύρο μελάνι) δίπλα στα ποσά — δεν είναι ψηφία.
- Κράτα τα ποσά ακριβώς όπως γράφονται, με 2 δεκαδικά. Κενό ή παύλα => "0.00".
- Συμπεριέλαβε και τις γραμμές «ΑΝΑΛΟΓΙΑ ΜΙΣΘΟΥ ...» ή «ΕΠΙΔΟΜΑΤΑ ...» και τυχόν αρνητικές \
διορθωτικές γραμμές — μην τις παραλείψεις. Βάλε την περιγραφή τους στο πεδίο name ή remarks.
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
    merged: list[TableRow] = []
    seen: set[tuple] = set()
    for chunk in chunks:
        for row in chunk:
            key = row.dedupe_key()
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)

    def sort_key(r: TableRow):
        try:
            return (0, int(re.sub(r"\D", "", r.aa) or 0))
        except ValueError:
            return (1, 0)

    merged.sort(key=sort_key)
    return merged
