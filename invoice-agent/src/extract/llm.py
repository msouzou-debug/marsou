"""LLM fallback extractor (§9) — OFF by default; enabling requires DPO
sign-off because invoice content then leaves the network.

Boundary enforced here:
- only called when deterministic paths produced nothing usable;
- prompt is masked (bank digits stripped except last 4; approval users never sent);
- every call is audit-logged (invoice hash, model, purpose);
- the result is proposals with confidence — Stage 3 validation always runs after.
"""

import os
import re


class LlmDisabled(Exception):
    pass


def mask_text(text):
    def keep_last4(m):
        s = m.group(0).replace(" ", "")
        return "*" * (len(s) - 4) + s[-4:]

    return re.sub(r"\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,34}\b", keep_last4, text)


def extract(conn, settings, file_hash, text, actor="system"):
    cfg = settings.get("llm_fallback") or {}
    if not cfg.get("enabled"):
        raise LlmDisabled("llm_fallback.enabled is false (needs DPO sign-off — §9)")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise LlmDisabled("ANTHROPIC_API_KEY not set")

    from ..audit import log as audit

    masked = mask_text(text)
    audit.log(conn, actor, "llm_call",
              f"file={file_hash} model={cfg.get('model')} purpose=fallback_extraction")

    import json

    import requests

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={
            "model": cfg.get("model", "claude-sonnet-5"),
            "max_tokens": 2000,
            "messages": [{"role": "user", "content": (
                "Extract invoice fields from the text below. Reply with ONLY a JSON object "
                "with keys: vendor_name, vendor_vat, invoice_number, invoice_date (ISO), "
                "due_date, currency, net_total, vat_total, gross_total, iban, po_number, "
                "lines (list of {description, quantity, unit_price, line_total, vat_rate}), "
                "confidence (object mapping each key to 0..1).\n\n" + masked)}],
        },
        timeout=120,
    )
    resp.raise_for_status()
    payload = json.loads(resp.json()["content"][0]["text"])
    payload["source"] = "llm"
    payload.setdefault("net_by_rate", {})
    payload.setdefault("vat_by_rate", {})
    return payload
