import { z } from "zod";
import type { Roi } from "./ledger";

const level = z.enum(["high", "medium", "low"]);

// Step 1
export const CurrentState = z.object({
  summary: z.string(),
  metrics: z.array(z.object({ name: z.string(), value: z.string(), period: z.string(), evidence_ref: z.string() })).max(10),
  trends: z.array(z.object({ description: z.string(), evidence_ref: z.string() })).max(6),
  top_skus: z.array(z.object({ sku: z.string(), share_pct: z.number(), note: z.string() })),
  review_themes: z.array(z.object({ theme: z.string(), count: z.number(), share_of_low_reviews_pct: z.number(), evidence_ref: z.string() })).max(6),
  data_quality_notes: z.array(z.string()).max(5),
});
export type CurrentState = z.infer<typeof CurrentState>;

// Step 2
export const CompetitorEvidence = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      findings: z.array(
        z.object({
          topic: z.string(),
          fact: z.string().describe("One sentence stating only what the passage says"),
          quote: z.string().describe("Exact words copied from the passage (8-25 words)"),
          source_id: z.string().describe("The [chunk:N] id from the search result"),
        }),
      ).max(10),
    }),
  ),
  coverage_gaps: z.array(z.string()).max(8),
});
export type CompetitorEvidence = z.infer<typeof CompetitorEvidence>;

// Step 3
export const Comparison = z.object({
  comparison: z.array(
    z.object({
      attribute: z.string(),
      seller_value: z.string().nullable(),
      seller_ref: z.string().nullable().describe('e.g. "sql_kpis:sku_trend:SKU-01"; null if the seller value is unknown'),
      competitors: z.array(z.object({ name: z.string(), value: z.string().nullable(), source_id: z.string().nullable() })),
      verdict: z.enum(["seller_ahead", "seller_behind", "parity", "unknown"]),
      note: z.string(),
    }),
  ).max(10),
  missing_data: z.array(z.string()).max(6),
});
export type Comparison = z.infer<typeof Comparison>;

// Step 4
export const Problems = z.object({
  problems: z
    .array(
      z.object({
        id: z.string().describe("P1, P2, ..."),
        title: z.string(),
        severity: level,
        confidence: level,
        description: z.string().describe("2-3 sentences"),
        metric_evidence: z.array(z.object({ ref: z.string(), detail: z.string() })).max(4),
        competitor_evidence: z.array(z.object({ source_id: z.string(), quote: z.string(), detail: z.string() })).max(3),
      }),
    )
    .max(8),
  insufficient_data: z.array(z.string()),
});
export type Problems = z.infer<typeof Problems>;

// Step 5 (the model gives roi_id; the code attaches the numbers from the calc_roi tool)
export const Solutions = z.object({
  solutions: z.array(
    z.object({
      id: z.string().describe("S1, S2, ..."),
      problem_id: z.string(),
      title: z.string(),
      description: z.string().describe("At most 2 sentences"),
      effort: z.enum(["low", "medium", "high"]),
      roi_id: z.string().nullable().describe("The roi_id returned by calc_roi"),
      confidence: level,
      assumptions: z.array(z.string()).max(3),
      risks: z.array(z.string()).max(2),
    }),
  ).max(8),
});
export type Solutions = z.infer<typeof Solutions>;
export type StoredSolution = Solutions["solutions"][number] & { roi: Roi | null; priority: number };

// Step 6
export const ActionPlan = z.object({
  summary: z.string(),
  top_actions: z.array(z.string()).describe("Solution ids, highest priority first"),
  weeks: z.array(
    z.object({
      week: z.number().int().min(1).max(4),
      theme: z.string(),
      actions: z.array(
        z.object({
          solution_id: z.string(),
          task: z.string(),
          owner_role: z.string(),
          kpi_to_track: z.string(),
          how_measured: z.string(),
        }),
      ).max(4),
    }),
  ).max(4),
  baseline_snapshot: z.array(z.object({ kpi: z.string(), value: z.string(), ref: z.string() })).max(8),
});
export type ActionPlan = z.infer<typeof ActionPlan>;
