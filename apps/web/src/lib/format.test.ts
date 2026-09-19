import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatEUR, formatEURorDash, formatFileSize, formatInt, formatPct } from "./format";

const T = " "; // narrow no-break space

describe("formatEUR", () => {
  it("groups thousands with dots and drops decimals at or above 1.000", () => {
    expect(formatEUR(1234567)).toBe(`1.234.567${T}€`);
    expect(formatEUR(1000)).toBe(`1.000${T}€`);
    expect(formatEUR(999.999)).toBe(`1000,00${T}€`); // below the threshold, so two decimals and no grouping
  });
  it("keeps two decimals with a comma below 1.000", () => {
    expect(formatEUR(845.2)).toBe(`845,20${T}€`);
    expect(formatEUR(0)).toBe(`0,00${T}€`);
  });
  it("uses a leading minus in front of the number, never brackets", () => {
    expect(formatEUR(-12400)).toBe(`-12.400${T}€`);
    expect(formatEUR(-5.5)).toBe(`-5,50${T}€`);
  });
  it("returns a dash for non-finite input", () => {
    expect(formatEUR(NaN)).toBe("—");
  });
});

describe("formatEURorDash", () => {
  it("renders «—» for null, never «0 €» (CAPEX-01 §7)", () => {
    expect(formatEURorDash(null)).toBe("—");
  });
  it("formats a real figure the same way formatEUR does", () => {
    expect(formatEURorDash(1000)).toBe(`1.000${T}€`);
    expect(formatEURorDash(0)).toBe(`0,00${T}€`);
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

describe("formatFileSize", () => {
  it("uses bytes below 1 KB, no decimal", () => {
    expect(formatFileSize(512)).toBe(`512${T}B`);
  });
  it("uses KB/MB with one decimal below 10 of the unit", () => {
    expect(formatFileSize(1536)).toBe(`1,5${T}KB`);
    expect(formatFileSize(3_250_000)).toBe(`3,1${T}MB`);
  });
  it("drops the decimal at 10 or more of a unit", () => {
    expect(formatFileSize(337_100)).toBe(`329${T}KB`);
    expect(formatFileSize(15 * 1024 * 1024)).toBe(`15${T}MB`);
  });
  it("returns a dash for negative or non-finite input", () => {
    expect(formatFileSize(-1)).toBe("—");
    expect(formatFileSize(NaN)).toBe("—");
  });
});
