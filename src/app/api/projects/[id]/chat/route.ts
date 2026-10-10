import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";
import { answerQuestion } from "@/lib/chat/answer";
import { buildReport } from "@/lib/report/build";
import { adAdvice } from "@/lib/ingest/ads";
import { adsChatContext } from "@/lib/insights/ads";

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(20),
  screen: z.string().max(40).default("Overview"),
  focus: z.string().max(200).nullable().default(null),
});

// "Ask about this chart": a small tool-using analyst. Capped per project so a runaway client cannot spend the budget.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const lim = rateLimit(`chat:${id}`, 20, 60 * 60_000);
  if (!lim.ok) return tooMany(lim.retryAfterSec);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return Response.json({ error: "Invalid message" }, { status: 400 });

  const done = (await db.select({ id: schema.analyses.id, status: schema.analyses.status, startedAt: schema.analyses.startedAt }).from(schema.analyses).where(eq(schema.analyses.projectId, id)))
    .filter((a) => a.status === "done").sort((a, b) => +b.startedAt - +a.startedAt)[0];
  const report = done ? await buildReport(done.id) : null;
  const analysisContext = report && {
    summary: report.s6?.summary, current_state: report.s1?.summary,
    problems: report.s4?.problems.map((p) => ({ id: p.id, title: p.title, severity: p.severity, description: p.description })),
    solutions: report.s5?.solutions.map((s) => ({ id: s.id, title: s.title, effort: s.effort, gain_low_monthly: s.roi?.gain_low_monthly, gain_high_monthly: s.roi?.gain_high_monthly })),
    comparison: report.s3?.comparison.map((c) => ({ attribute: c.attribute, seller: c.seller_value, verdict: c.verdict, competitors: c.competitors.map((x) => ({ name: x.name, value: x.value })) })),
  };

  const ads = await adAdvice(id).catch(() => null);

  try {
    return Response.json(await answerQuestion({ projectId: id, messages: parsed.data.messages, screen: parsed.data.screen, focus: parsed.data.focus, analysisContext, adsContext: ads ? adsChatContext(ads) : null }));
  } catch (e) {
    return Response.json({ error: `The assistant is unavailable right now (${(e as Error).message.slice(0, 120)}).` }, { status: 502 });
  }
}
