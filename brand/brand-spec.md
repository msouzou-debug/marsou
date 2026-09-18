# OKYπY / SHSO — Full Brand Spec

Canonical values. Screen work uses the **hex**; print work uses the **CMYK**
(taken from the official logo colour sheet, `assets/logo/okypy_brand_sheet_cmyk.png`).

## Colour palette

| Name | Hex | RGB | CMYK (official) | Role |
|---|---|---|---|---|
| Brand Green | `#8BC53F` | 139, 197, 63 | C50 M0 Y100 K0 | Identity colour; positive figures, accents, highlights |
| Blue Bright | `#069FEC` | 6, 159, 236 | ≈ C70 M15 Y0 K0 (light stop) | Primary accent bar, headers, links |
| Blue Logo | `#25A3DC` | 37, 163, 220 | — | Logo mid-blue; secondary fills |
| Blue Deep | `#1B75BB` | 27, 117, 187 | ≈ C85 M50 Y0 K0 (dark stop) | Header gradients, dark bars, chart series |
| Text Grey | `#58595B` | 88, 89, 91 | C0 M0 Y0 K80 | Body text |
| Light Grey | `#EAEAEA` | 234, 234, 234 | — | Zebra rows, dividers, panel fills |
| White | `#FFFFFF` | 255, 255, 255 | — | Background |

The logo blue is a **gradient** — deep `#1B75BB` → bright `#069FEC`. Use the
gradient for large fills; a single flat blue is fine for small elements (pick
`#069FEC`).

Positive / negative convention for finance tables: positive = green `#8BC53F`,
negative = a muted red (`#C0392B`) — red is allowed for data semantics only, not
decoration.

## Typography

Priority chain: **Lato → Source Sans Pro → Open Sans → Arial**.

CSS font stack:
```
font-family: "Lato","Source Sans Pro","Open Sans",Arial,"Helvetica Neue",sans-serif;
```

Google Fonts import (HTML):
```
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&family=Source+Sans+Pro:wght@400;600;700&display=swap');
```

Weight guide: titles 700–900, subheads 600–700, body 400, captions 300–400.
Do not mix in a serif or a display font. Office files: Arial is the safe
substitute when Lato can't embed.

## Logo assets (`assets/logo/`)

| File | What | When |
|---|---|---|
| `okypy_logo_full.png` | Mark + ΟΚΥπΥ + bilingual tagline | Default, footers, title slides, doc headers |
| `okypy_icon.png` | Figure mark only | Tight spaces, favicons, watermarks |
| `okypy_logo_white.png` | Reversed full logo | On blue/dark backgrounds |
| `okypy_icon_white.png` | Reversed mark | On blue/dark backgrounds |
| `okypy_brand_sheet_cmyk.png` | Official colour sheet | Reference only |

Clear space ≈ height of the figure's head on every side. Never stretch,
recolour, rotate, add effects, or rebuild the wordmark.

## Layout system

**Content slide / page:** white bg → thin grey rule under title → content →
full-width bright-blue bar at bottom → full logo centred over the bar → date
bottom-left, page number bottom-right.

**Title slide:** logo top-centre → large centred title (Blue Deep or Grey) →
italic grey subtitle → bottom accent bar → date + number.

**Section / divider:** vertical bright-blue bar down the left edge, logo bottom-centre.

**Grid:** keep generous margins (≥ 5% of width). Don't crowd edges.

## Numbers, dates, language

- Dates: DD/MM/YYYY.
- Greek numbers: 1.234.567,89 (dot thousands, comma decimal). Euro after number: `1.234 €`.
- Org name: Οργανισμός Κρατικών Υπηρεσιών Υγείας (ΟΚΥπΥ) / State Health Services Organisation (SHSO).
- Bilingual by default; Greek primary for board/regulator work.
