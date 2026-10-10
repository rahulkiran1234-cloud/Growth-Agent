import { describe, expect, it } from "vitest";
import { checkDate, fmtNum, fmtRange, summarizeGates } from "./format";

describe("format helpers", () => {
  it("formats numbers and ranges deterministically", () => {
    expect(fmtNum(1234567.6)).toBe("1,234,568");
    expect(fmtRange(10652, 15978)).toBe("10,652–15,978");
    expect(fmtRange(null, 5)).toBe("not estimated");
    expect(fmtRange(undefined, undefined)).toBe("not estimated");
  });
  it("computes the 30-day re-check date across month ends", () => {
    expect(checkDate("2026-10-08")).toBe("2026-11-07");
    expect(checkDate("2026-12-15")).toBe("2027-01-14");
    expect(checkDate("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("summarises gate results", () => {
    const s = summarizeGates([
      { step: 1, repairs: 2, dropped: [], warnings: [] },
      { step: 2, repairs: 1, dropped: ["a", "b"], warnings: ["x"] },
      { step: 3, repairs: 0, dropped: [], warnings: [] },
    ]);
    expect(s).toEqual({ steps: 3, repairs: 3, removed: 2, unverified: 1, cleanSteps: 2 });
  });
});
