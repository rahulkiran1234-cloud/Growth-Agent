import { describe, expect, it } from "vitest";
import { compareMetrics, fmtMetric, type Metric } from "./metrics-pure";

const m = (key: string, value: number, better: "up" | "down", unit: Metric["unit"] = "pct"): Metric => ({ key, label: key, value, unit, better, period: "2026-09" });

describe("compareMetrics", () => {
  it("judges direction by what is better for each metric", () => {
    const r = compareMetrics(
      [m("rev", 100, "up", "money"), m("returns", 10, "down"), m("rating", 4, "up", "rating"), m("lowpct", 20, "down")],
      [m("rev", 120, "up", "money"), m("returns", 12, "down"), m("rating", 4.2, "up", "rating"), m("lowpct", 15, "down")],
    );
    expect(r.map((x) => x.verdict)).toEqual(["improved", "worse", "improved", "improved"]);
    expect(r[0]).toMatchObject({ delta: 20, deltaPct: 20 });
  });
  it("treats a move within 1% as flat", () => {
    expect(compareMetrics([m("rev", 1000, "up", "money")], [m("rev", 1005, "up", "money")])[0].verdict).toBe("flat");
  });
  it("marks metrics missing from the new data instead of inventing a value", () => {
    const r = compareMetrics([m("topic:size", 30, "down")], [])[0];
    expect(r).toMatchObject({ verdict: "missing", after: null, delta: null });
  });
  it("handles a zero starting value", () => {
    expect(compareMetrics([m("x", 0, "down")], [m("x", 5, "down")])[0]).toMatchObject({ verdict: "worse", deltaPct: null });
    expect(compareMetrics([m("x", 0, "down")], [m("x", 0, "down")])[0].verdict).toBe("flat");
  });
});

describe("fmtMetric", () => {
  it("formats by unit", () => {
    expect(fmtMetric(12.5, "pct")).toBe("12.5%");
    expect(fmtMetric(4.1, "rating")).toBe("4.10");
    expect(fmtMetric(123456.4, "money")).toBe("123,456");
  });
});
