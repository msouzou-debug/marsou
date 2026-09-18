# ADR-0006 — Purple for permits, outside the brand palette

**Status:** accepted · 18/09/2026

## Context
The OKYπY brand guidelines say purple is off-brand and should not be used for decoration. CAPEX-02 §2 introduces `--k-purple #6B5CA5` for permits and ICRA class badges "deliberately outside the brand palette so a live permit is never mistaken for an ordinary status".

## Decision
Follow CAPEX-02. Purple is allowed in exactly two components, IcraBadge and PermitBanner, and in the shutdown blocks on the disruption calendar (S15). Nowhere else, and never as decoration.

## Consequences
- A reviewer seeing purple anywhere else treats it as a defect.
- The brand skill's QA checklist item "no stray purple" is read as "no purple outside permits" in this product.
