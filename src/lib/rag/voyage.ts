import { env } from "@/lib/config/env";

const MAX_ITEMS = 64;
// The no-payment tier allows only 10K tokens/minute, so keep each request well under it.
const MAX_BATCH_TOKENS = 6000;
const estTokens = (t: string) => Math.ceil(t.length / 3.5);

function makeBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [], tok = 0;
  for (const t of texts) {
    const n = estTokens(t);
    if (cur.length && (cur.length >= MAX_ITEMS || tok + n > MAX_BATCH_TOKENS)) {
      batches.push(cur);
      cur = [];
      tok = 0;
    }
    cur.push(t);
    tok += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// Behind a tiny interface so the provider can be swapped (see PRD §4.3).
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const cfg = env();
  const out: number[][] = [];
  for (const batch of makeBatches(texts)) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.VOYAGE_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ input: batch, model: cfg.VOYAGE_MODEL, input_type: inputType, truncation: true }),
      });
      // Voyage's no-payment tier allows 3 requests/min: wait out the window instead of failing.
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, 21_000));
        continue;
      }
      if (!res.ok) throw new Error(`Embedding request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      j.data.sort((a, b) => a.index - b.index).forEach((d) => out.push(d.embedding));
      break;
    }
  }
  return out;
}
