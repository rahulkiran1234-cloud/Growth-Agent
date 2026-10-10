import type { Hit } from "./search";

export const SOURCE_RE = /^chunk:(\d+)$/;
export const isSourceId = (s: unknown): s is string => typeof s === "string" && SOURCE_RE.test(s);


/** Renders hits for an LLM prompt so the model can cite by [chunk:N]. */
export function formatHitsForPrompt(hits: Hit[]): string {
  if (hits.length === 0) return "No relevant passages found.";
  return hits
    .map((h) => `[${h.sourceId}] ${h.competitor} · ${h.title}${h.page ? ` p.${h.page}` : ""} · dated ${h.docDate ?? "unknown"}${h.stale ? " (STALE: over 90 days old)" : ""}\n${h.content}`)
    .join("\n\n---\n\n");
}
