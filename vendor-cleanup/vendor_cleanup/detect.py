"""Duplicate candidate generation (§4 of the brief).

Rules produce weighted pairwise edges; union-find joins them into groups.
The app only proposes — nothing is ever auto-merged.
"""

import hashlib
from collections import defaultdict

from rapidfuzz import fuzz, process

from . import audit
from .normalize import split_ibans


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def _pair(a, b):
    return tuple(sorted((a, b)))


def generate_edges(vendors, settings, whitelist_ibans=(), whitelist_pairs=()):
    """Return list of edges: (supplier_a, supplier_b, rule, detail, weight)."""
    w = settings["detection"]["weights"]
    cutoff = settings["detection"]["fuzzy_name_cutoff"]
    whitelist_ibans = set(whitelist_ibans)
    whitelist_pairs = {tuple(sorted(p)) for p in whitelist_pairs}
    edges = []

    def add(a, b, rule, detail, weight):
        if a != b and _pair(a, b) not in whitelist_pairs:
            edges.append((*_pair(a, b), rule, detail, weight))

    # Rule 1 — same IBAN, different supplier (whitelistable)
    by_iban = defaultdict(list)
    for v in vendors:
        for iban in split_ibans(v["ibans"]):
            by_iban[iban].append(v["supplier"])
    for iban, suppliers in by_iban.items():
        if iban in whitelist_ibans:
            continue
        suppliers = sorted(set(suppliers))
        for i in range(len(suppliers)):
            for j in range(i + 1, len(suppliers)):
                add(suppliers[i], suppliers[j], "same_iban", iban, w["same_iban"])

    # Rule 2 — same VAT number or same TIN
    for field, rule in (("vat_norm", "same_vat"), ("tin_norm", "same_tin")):
        by_id = defaultdict(list)
        for v in vendors:
            if v[field]:
                by_id[v[field]].append(v["supplier"])
        for value, suppliers in by_id.items():
            suppliers = sorted(set(suppliers))
            for i in range(len(suppliers)):
                for j in range(i + 1, len(suppliers)):
                    add(suppliers[i], suppliers[j], rule, value, w[rule])

    # Rule 3 — fuzzy normalized-name match (token-sorted, transliterated)
    named = [v for v in vendors if v["name_norm"]]
    names = [v["name_norm"] for v in named]
    seen = set()
    for i, v in enumerate(named):
        for _, score, j in process.extract(
            names[i], names, scorer=fuzz.token_sort_ratio, score_cutoff=cutoff, limit=None
        ):
            if j <= i:
                continue
            key = _pair(v["supplier"], named[j]["supplier"])
            if key in seen:
                continue
            seen.add(key)
            # weight 0.5 at the cutoff, scaling to 0.8 at a perfect match
            weight = w["fuzzy_name"] + (0.8 - w["fuzzy_name"]) * (score - cutoff) / (100 - cutoff)
            add(*key, "fuzzy_name", f"score={score:.0f}", round(weight, 3))

    # Rule 4 — same telephone: supporting evidence only. Edges are collected but
    # only kept where the pair is already connected by another rule.
    primary_pairs = {(a, b) for a, b, *_ in edges}
    by_phone = defaultdict(list)
    for v in vendors:
        if v["phone_norm"] and len(v["phone_norm"]) >= 6:
            by_phone[v["phone_norm"]].append(v["supplier"])
    for phone, suppliers in by_phone.items():
        suppliers = sorted(set(suppliers))
        for i in range(len(suppliers)):
            for j in range(i + 1, len(suppliers)):
                if _pair(suppliers[i], suppliers[j]) in primary_pairs:
                    add(suppliers[i], suppliers[j], "same_phone", phone, w["same_phone"])

    return edges


def build_groups(edges):
    """Union-find the edges; return {root: {"members": set, "edges": [...]}}."""
    uf = UnionFind()
    for a, b, *_ in edges:
        uf.union(a, b)
    groups = defaultdict(lambda: {"members": set(), "edges": []})
    for edge in edges:
        a, b = edge[0], edge[1]
        root = uf.find(a)
        groups[root]["members"].update((a, b))
        groups[root]["edges"].append(edge)
    return groups


def score_group(group):
    """max rule weight + 0.05 per additional distinct rule, capped at 0.99."""
    rules = {e[2] for e in group["edges"]}
    top = max(e[4] for e in group["edges"])
    return min(0.99, round(top + 0.05 * (len(rules) - 1), 3)), sorted(rules)


def fingerprint(members, vendors_by_supplier):
    """Hash over each member's supplier|name|vat|ibans — a resolved group stays
    resolved across re-imports unless this data changes (§8)."""
    parts = []
    for s in sorted(members):
        v = vendors_by_supplier.get(s)
        parts.append(
            "|".join([s, v["name_norm"], v["vat_norm"], v["ibans"]]) if v else s
        )
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def member_key(members):
    return hashlib.sha256("|".join(sorted(members)).encode("utf-8")).hexdigest()


def propose_survivor(members, vendors_by_supplier, conn=None):
    """§5: more company codes + has IBAN + has VAT wins; blocks count against."""
    def rank(s):
        v = vendors_by_supplier[s]
        codes = len([c for c in v["company_codes"].split(",") if c.strip()])
        return (
            2 * bool(v["ibans"]) + 2 * bool(v["vat_norm"]) + codes - 3 * bool(v["blocked"]),
            codes,
            s,
        )

    return max(sorted(members), key=rank)


def persist_groups(conn, import_id, vendors, settings, actor="system"):
    """Detect and upsert groups; keep resolutions across re-imports (Phase 4)."""
    whitelist_ibans = [
        r["value"] for r in conn.execute("SELECT value FROM whitelist WHERE kind='iban'")
    ]
    whitelist_pairs = [
        tuple(r["value"].split("|"))
        for r in conn.execute("SELECT value FROM whitelist WHERE kind='pair'")
    ]
    edges = generate_edges(vendors, settings, whitelist_ibans, whitelist_pairs)
    groups = build_groups(edges)
    vmap = {v["supplier"]: v for v in vendors}

    stats = {"new": 0, "kept": 0, "reopened": 0, "stale": 0}
    seen_fps = set()
    for g in groups.values():
        members = g["members"]
        fp = fingerprint(members, vmap)
        mk = member_key(members)
        score, rules = score_group(g)
        seen_fps.add(fp)

        existing = conn.execute("SELECT * FROM groups WHERE fingerprint=?", (fp,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE groups SET last_seen_import=?, score=?, rules=? WHERE id=?",
                (import_id, score, ",".join(rules), existing["id"]),
            )
            stats["kept"] += 1
            continue

        # same member set, changed data -> reopen (old resolution no longer safe)
        prior = conn.execute(
            "SELECT * FROM groups WHERE member_key=? ORDER BY id DESC LIMIT 1", (mk,)
        ).fetchone()
        status = "open"
        if prior:
            conn.execute("UPDATE groups SET status='stale' WHERE id=?", (prior["id"],))
            if prior["status"] == "resolved":
                stats["reopened"] += 1
                audit.log(
                    conn, actor, "group_reopened",
                    f"member_key={mk[:12]} old_group={prior['id']} (member data changed)",
                )
        cur = conn.execute(
            """INSERT INTO groups (fingerprint, member_key, rules, score, status,
                                   first_seen_import, last_seen_import)
               VALUES (?,?,?,?,?,?,?)""",
            (fp, mk, ",".join(rules), score, status, import_id, import_id),
        )
        gid = cur.lastrowid
        conn.executemany(
            "INSERT INTO group_members (group_id, supplier) VALUES (?,?)",
            [(gid, s) for s in sorted(members)],
        )
        conn.executemany(
            "INSERT INTO group_edges (group_id, supplier_a, supplier_b, rule, detail, weight) VALUES (?,?,?,?,?,?)",
            [(gid, *e) for e in g["edges"]],
        )
        stats["new"] += 1

    # groups not seen in this import at all (members gone / data changed)
    for row in conn.execute(
        "SELECT id, fingerprint FROM groups WHERE status IN ('open','pending_approval') AND last_seen_import < ?",
        (import_id,),
    ).fetchall():
        if row["fingerprint"] not in seen_fps:
            conn.execute("UPDATE groups SET status='stale' WHERE id=?", (row["id"],))
            stats["stale"] += 1

    conn.commit()
    audit.log(conn, actor, "detect", f"import_id={import_id} " + " ".join(f"{k}={v}" for k, v in stats.items()))
    return groups, stats


def refresh_worklists(conn, import_id, vendors, actor="system"):
    """Three defect worklists (§5): no IBAN, no VAT, blocked-but-active."""
    kinds = {
        "no_iban": lambda v: not v["ibans"],
        "no_vat": lambda v: not v["vat_norm"],
        "blocked_active": lambda v: bool(v["blocked"]) and bool(v["company_codes"].strip()),
    }
    counts = {}
    for kind, pred in kinds.items():
        hits = {v["supplier"] for v in vendors if pred(v)}
        counts[kind] = len(hits)
        for s in sorted(hits):
            conn.execute(
                """INSERT INTO worklist_items (kind, supplier, status, last_seen_import)
                   VALUES (?,?,'open',?)
                   ON CONFLICT(kind, supplier) DO UPDATE SET last_seen_import=excluded.last_seen_import""",
                (kind, s, import_id),
            )
        # item no longer defective in the new snapshot -> auto-close as fixed
        conn.execute(
            """UPDATE worklist_items SET status='gone'
               WHERE kind=? AND status IN ('open','pending_approval') AND last_seen_import < ?""",
            (kind, import_id),
        )
    conn.commit()
    audit.log(conn, actor, "worklists", " ".join(f"{k}={v}" for k, v in counts.items()))
    return counts
