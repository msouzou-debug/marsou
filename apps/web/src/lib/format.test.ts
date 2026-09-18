import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatEUR, formatEURorDash, formatInt, formatPct } from "./format";

const T = " "; // narrow no-break space

describe("formatEUR", () => {
  it("groups thousands with dots and drops decimals at or above 1.000", () => {
    expect(formatEUR(1234567)).toBe(`€${T}1.234.567`);
    expect(formatEUR(1000)).toBe(`€${T}1.000`);
    expect(formatEUR(999.999)).toBe(`€${T}1000,00`); // below the threshold, so two decimals and no grouping
  });
  it("keeps two decimals with a comma below 1.000", () => {
    expect(formatEUR(845.2)).toBe(`€${T}845,20`);
    expect(formatEUR(0)).toBe(`€${T}0,00`);
  });
  it("uses a leading minus, never brackets", () => {
    expect(formatEUR(-12400)).toBe(`-€${T}12.400`);
    expect(formatEUR(-5.5)).toBe(`-€${T}5,50`);
  });
  it("returns a dash for non-finite input", () => {
    expect(formatEUR(NaN)).toBe("—");
  });
});

describe("formatEURorDash", () => {
  it("renders «—» for null, never «€ 0» (CAPEX-01 §7)", () => {
    expect(formatEURorDash(null)).toBe("—");
  });
  it("formats a real figure the same way formatEUR does", () => {
    expect(formatEURorDash(1000)).toBe(`€${T}1.000`);
    expect(formatEURorDash(0)).toBe(`€${T}0,00`);
  });
});

describe("formatPct", () => {
  it("uses a comma decimal and a thin space before the sign", () => {
    expect(formatPct(12.4)).toBe(`12,4${T}%`);
    expect(formatPct(62)).toBe(`62,0${T}%`);
    expect(formatPct(62, 0)).toBe(`62${T}%`);
  });
});

describe("formatDate", () => {
  it("renders DD/MM/YYYY in Europe/Nicosia", () => {
    expect(formatDate("2026-03-14T00:00:00Z")).toBe("14/03/2026");
  });
  it("renders time after the date", () => {
    expect(formatDateTime("2026-03-14T08:42:00Z")).toBe("14/03/2026 10:42");
  });
});

describe("formatInt", () => {
  it("groups thousands", () => {
    expect(formatInt(113)).toBe("113");
    expect(formatInt(276481892)).toBe("276.481.892");
  });
});
