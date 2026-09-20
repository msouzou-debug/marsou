// Unit tests for scripts/check-help-mapping.mjs's pure helpers. Run with
// `node --test scripts/check-help-mapping.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findInvalidTiers } from "./check-help-mapping.mjs";

test("findInvalidTiers accepts day-one and optional", () => {
  const map = {
    S01: { route: "/", section: "S01-portfolio", tier: "day-one", persona: [] },
    S06: { route: "/risks", section: "S06-risks-issues", tier: "optional", persona: [] },
  };
  assert.deepEqual(findInvalidTiers(map), []);
});

test("findInvalidTiers flags a missing tier", () => {
  const map = { S01: { route: "/", section: "S01-portfolio", persona: [] } };
  const problems = findInvalidTiers(map);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /S01/);
  assert.match(problems[0], /missing/);
});

test("findInvalidTiers flags an unknown tier value", () => {
  const map = { S01: { route: "/", section: "S01-portfolio", tier: "phase-2", persona: [] } };
  const problems = findInvalidTiers(map);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"phase-2"/);
});
