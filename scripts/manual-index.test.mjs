// Unit tests for scripts/manual-index.mjs's pure helpers. Run with
// `node --test scripts/manual-index.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReadme, buildRows } from "./manual-index.mjs";

test("buildRows collapses several ids naming the same section into one row", () => {
  const map = {
    S09: { route: "/certs", section: "S09-payment-certs", tier: "day-one", persona: ["finance"] },
    "S09-new": { route: "/certs/new", section: "S09-payment-certs", tier: "day-one", persona: ["admin"] },
  };
  // buildRows reads titles off disk (docs/manual/{el,en}/<section>.md), so
  // this test uses the real, always-present S01/S09 sections rather than a
  // synthetic one — the same approach apps/web/src/help/load-section.test.ts
  // takes for the same reason (no fixture manual to keep in sync).
  const rows = buildRows(map);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "S09");
  assert.deepEqual(rows[0].persona, ["finance", "admin"]);
});

test("buildRows sorts rows by screen id", () => {
  const map = {
    S09: { route: "/certs", section: "S09-payment-certs", tier: "day-one", persona: ["finance"] },
    S01: { route: "/", section: "S01-portfolio", tier: "day-one", persona: ["finance"] },
  };
  const rows = buildRows(map);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["S01", "S09"],
  );
});

test("buildRows reads both languages' titles", () => {
  const map = { S01: { route: "/", section: "S01-portfolio", tier: "day-one", persona: ["finance"] } };
  const rows = buildRows(map);
  assert.equal(rows[0].titleEl, "Χαρτοφυλάκιο έργων");
  assert.equal(rows[0].titleEn, "Portfolio");
});

test("buildReadme puts each row's tier under the matching heading", () => {
  const rows = [
    { id: "S01", titleEl: "Χαρτοφυλάκιο έργων", titleEn: "Portfolio", tier: "day-one", persona: ["finance"] },
    { id: "S06", titleEl: "Κίνδυνοι", titleEn: "Risks", tier: "optional", persona: ["estates_head"] },
  ];
  const readme = buildReadme(rows, []);
  const dayOneIndex = readme.indexOf("### Day one");
  const optionalIndex = readme.indexOf("### Optional");
  const s01Index = readme.indexOf("| S01 |");
  const s06Index = readme.indexOf("| S06 |");
  assert.ok(dayOneIndex < s01Index && s01Index < optionalIndex);
  assert.ok(optionalIndex < s06Index);
});

test("buildReadme lists the planned M4 screens with their tier", () => {
  const readme = buildReadme([], [{ label: "Asset register", tier: "day-one" }]);
  assert.match(readme, /\| Asset register \| Day one \|/);
});

test("buildReadme escapes a pipe in a title so it cannot break the table", () => {
  const rows = [{ id: "S01", titleEl: "A | B", titleEn: "A | B", tier: "day-one", persona: [] }];
  const readme = buildReadme(rows, []);
  assert.match(readme, /A \\\| B/);
});
