"""Bake docs/MANUAL.md into the single-file app — GENERATES webapp/js/manual.js.

The manual is written once, in `docs/MANUAL.md`.  This renders it to the HTML
the app shows in its «Εγχειρίδιο» panel, so the tool and the repository can
never tell the user two different things.

    python tools/embed_manual.py && python webapp/build_single.py

Only the markdown the manual actually uses is supported — headings, paragraphs,
lists, tables, fenced code, blockquotes, `code`, **bold**, *italic*.  Anything
richer belongs in the repository docs, not on the screen.
"""
from __future__ import annotations

import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "MANUAL.md"
OUT = ROOT / "webapp" / "js" / "manual.js"

_HEADER = """/* The user manual — GENERATED FILE, DO NOT EDIT.
 *
 * Written in docs/MANUAL.md and rendered here by tools/embed_manual.py, so the
 * panel in the app and the manual in the repository are one text. */

const MANUAL_HTML = %s;
"""


def _inline(s: str) -> str:
    out = html.escape(s)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![*\w])\*([^*]+)\*(?!\w)", r"<em>\1</em>", out)
    return out


def _table(rows: list) -> str:
    """A markdown table, header row first, the |---| separator already dropped."""
    def cells(line: str) -> list:
        return [c.strip() for c in line.strip().strip("|").split("|")]

    head = "".join(f"<th>{_inline(c)}</th>" for c in cells(rows[0]))
    body = "".join(
        "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in cells(r)) + "</tr>"
        for r in rows[1:])
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _opens_block(line: str) -> bool:
    """Whether the line starts something that is not a paragraph.  Prose may
    begin with a `code span`, so this asks what the branches below ask —
    never a character class that a backtick or a dash falls into."""
    s = line.strip()
    return (s.startswith(("```", "#", "---", "|", ">"))
            or bool(re.match(r"^([*-]|\d+\.)\s", s)))


def render(md: str) -> str:
    out: list = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
        elif stripped.startswith("```"):
            block = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(html.escape(lines[i]))
                i += 1
            i += 1
            out.append("<pre><code>" + "\n".join(block) + "</code></pre>")
        elif stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            # the page already has an <h2> above the panel, so shift down one
            tag = f"h{min(level + 1, 6)}"
            out.append(f"<{tag}>{_inline(stripped[level:].strip())}</{tag}>")
            i += 1
        elif stripped.startswith("---"):
            out.append("<hr>")
            i += 1
        elif stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not re.fullmatch(r"[|\s:-]+", lines[i].strip()):
                    rows.append(lines[i])
                i += 1
            out.append(_table(rows))
        elif stripped.startswith(">"):
            block = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                block.append(lines[i].strip()[1:].strip())
                i += 1
            out.append(f"<blockquote>{_inline(' '.join(block))}</blockquote>")
        elif re.match(r"^([*-]|\d+\.)\s", stripped):
            ordered = bool(re.match(r"^\d+\.\s", stripped))
            items: list = []
            while i < len(lines):
                cur = lines[i].strip()
                if re.match(r"^([*-]|\d+\.)\s", cur):
                    items.append(re.sub(r"^([*-]|\d+\.)\s+", "", cur))
                elif cur and lines[i].startswith((" ", "\t")) and items:
                    items[-1] += " " + cur          # a wrapped list item
                else:
                    break
                i += 1
            tag = "ol" if ordered else "ul"
            body = "".join(f"<li>{_inline(x)}</li>" for x in items)
            out.append(f"<{tag}>{body}</{tag}>")
        else:
            para = [stripped]
            i += 1          # always advance: a line reaching here is prose
            while i < len(lines) and lines[i].strip() and not _opens_block(lines[i]):
                para.append(lines[i].strip())
                i += 1
            out.append(f"<p>{_inline(' '.join(para))}</p>")
    return "\n".join(out)


def main() -> int:
    body = render(SRC.read_text(encoding="utf-8"))
    literal = ("'" + body.replace("\\", "\\\\").replace("'", "\\'")
               .replace("\n", "\\n") + "'")
    OUT.write_text(_HEADER % literal, encoding="utf-8")
    print(f"wrote {OUT} ({len(body) / 1000:.1f} kB of manual)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
