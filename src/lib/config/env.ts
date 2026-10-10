import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),
  VOYAGE_MODEL: z.string().default("voyage-3.5"),
  DATABASE_URL: z.string().url(),
  LLM_MODEL_STEPS: z.string().default("claude-haiku-4-5-20251001"),
  LLM_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),
  MAX_TOKENS_PER_ANALYSIS: z.coerce.number().default(250000),
  MAX_AGENT_LOOP_ITERATIONS: z.coerce.number().default(12),
  AUTH_SECRET: z.string().optional(),
  FREE_ANALYSES_LIMIT: z.coerce.number().int().min(0).default(3),
  MAX_CONCURRENT_ANALYSES: z.coerce.number().int().min(1).default(3),
});

export type Env = z.infer<typeof schema>;

// Not cached: parsing 10 fields is trivial, and a cache served stale config after edits in dev.
export function env(): Env {
  return schema.parse(process.env);
}
