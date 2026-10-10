import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";

/** Free tier: analyses per project (no accounts in this demo). 0 means unlimited. Failed runs don't count. */
export async function freeUsage(projectId: string): Promise<{ used: number; limit: number; spentUsd: number }> {
  const [r] = await db
    .select({ used: sql<number>`count(*)::int`, spent: sql<string>`coalesce(sum(${schema.analyses.costUsd}), 0)` })
    .from(schema.analyses)
    .where(and(eq(schema.analyses.projectId, projectId), inArray(schema.analyses.status, ["queued", "running", "done"])));
  return { used: r.used, limit: env().FREE_ANALYSES_LIMIT, spentUsd: Number(Number(r.spent).toFixed(2)) };
}

export const FREE_LIMIT_MESSAGE = (limit: number) =>
  `You've used all ${limit} free analyses for this project. Unlimited analyses are part of the paid plan ($99/month), which isn't available in this demo.`;
