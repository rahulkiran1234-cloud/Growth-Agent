import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";

export const TOPICS = ["sizing_fit", "packaging_damage", "delivery", "quality", "price_value", "customer_support", "other"] as const;
const BATCH = 60;
const CONCURRENCY = 4;
export const MAX_TAGGED = 3000; // cost guard

const TOOL: Anthropic.Tool = {
  name: "tag_reviews",
  description: "Return topics and sentiment for each review id.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            topics: { type: "array", items: { type: "string", enum: [...TOPICS] } },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          },
          required: ["id", "topics", "sentiment"],
        },
      },
    },
    required: ["items"],
  },
};

/** Tags reviews with a fixed topic taxonomy using the cheap model. Returns token usage. */
export async function tagReviews(projectId: string): Promise<{ tagged: number; skipped: number; inputTokens: number; outputTokens: number }> {
  const cfg = env();
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
  const pending = await db
    .select({ id: schema.reviews.id, body: schema.reviews.body, rating: schema.reviews.rating })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.projectId, projectId), isNull(schema.reviews.topics)))
    .limit(MAX_TAGGED);
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from reviews where project_id = ${projectId} and topics is null`)).rows as { n: number }[];
  const skipped = Math.max(0, n - pending.length);

  const batches: (typeof pending)[] = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));

  let tagged = 0, inputTokens = 0, outputTokens = 0, next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const res = await client.messages.create({
        model: cfg.LLM_MODEL_FAST,
        max_tokens: 4096,
        system: `Tag each customer review with topics from the allowed list and an overall sentiment. Use "other" only if nothing fits. Reviews can have several topics. Call tag_reviews once with one item per review id.`,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "tag_reviews" },
        messages: [{ role: "user", content: batch.map((r) => `[${r.id}] (${r.rating}★) ${r.body.slice(0, 400)}`).join("\n") }],
      });
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;
      const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const items = ((tu?.input as { items?: { id: number; topics: string[]; sentiment: string }[] })?.items ?? []).filter((it) => batch.some((b) => b.id === it.id));
      if (items.length === 0) continue;
      const payload = JSON.stringify(items.map((it) => ({ id: it.id, t: it.topics, s: it.sentiment })));
      await db.execute(sql`
        update reviews r set topics = array(select jsonb_array_elements_text(v.t)), sentiment = v.s
        from jsonb_to_recordset(${payload}::jsonb) as v(id bigint, t jsonb, s text)
        where r.id = v.id and r.project_id = ${projectId}`);
      tagged += items.length;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { tagged, skipped, inputTokens, outputTokens };
}
