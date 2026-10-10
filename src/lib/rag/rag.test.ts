import { describe, expect, it } from "vitest";
import { queryTerms, recencyFactor, toOrQuery } from "./pure";
import { formatHitsForPrompt, isSourceId } from "./format";
import type { Hit } from "./search";

describe("queryTerms / toOrQuery", () => {
  it("drops stopwords and short words, dedupes, lowercases", () => {
    expect(queryTerms("What is the Free shipping threshold at UrbanHaus? free")).toEqual(["free", "shipping", "threshold", "urbanhaus"]);
  });
  it("builds an OR tsquery, or null when nothing is left", () => {
    expect(toOrQuery(["free", "shipping"])).toBe("free | shipping");
    expect(toOrQuery([])).toBeNull();
    expect(toOrQuery(queryTerms("what is the"))).toBeNull();
  });
});

describe("recencyFactor", () => {
  const now = Date.parse("2026-10-07");
  it("down-weights older documents and unknown dates", () => {
    expect(recencyFactor("2026-09-12", now)).toBe(1);
    expect(recencyFactor("2026-05-01", now)).toBe(0.95);
    expect(recencyFactor("2025-01-01", now)).toBe(0.85);
    expect(recencyFactor(null, now)).toBe(0.9);
  });
});

describe("citations", () => {
  it("validates source ids strictly", () => {
    expect(isSourceId("chunk:42")).toBe(true);
    for (const bad of ["chunk:", "chunk:4a", "42", "doc:1", "chunk:1; drop table", undefined, 7]) expect(isSourceId(bad)).toBe(false);
  });
  it("formats hits with ids and flags stale documents", () => {
    const hit: Hit = { sourceId: "chunk:7", chunkId: 7, content: "Free shipping above Rs 999", page: 2, competitor: "UrbanHaus", title: "cat.pdf", docDate: "2025-01-01", score: 1, vectorRank: 1, keywordRank: null, stale: true };
    const out = formatHitsForPrompt([hit]);
    expect(out).toContain("[chunk:7] UrbanHaus · cat.pdf p.2");
    expect(out).toContain("STALE");
    expect(formatHitsForPrompt([])).toMatch(/No relevant passages/);
  });
});
