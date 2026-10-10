import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";
import type { Emitter } from "@/lib/events";
import type { Ledger } from "./ledger";
import { costUsd } from "./pricing";

export type Budget = { maxTokens: number; inTok: number; outTok: number };

export type Ctx = {
  analysisId: string;
  projectId: string;
  emit: Emitter;
  client: Anthropic;
  model: string;
  budget: Budget;
  ledger: Ledger;
  /** Query embeddings already computed in this run (query text -> vector). */
  embedCache: Map<string, number[]>;
  /** Sanitised outputs of completed steps, keyed by step number. */
  prior: Record<number, unknown>;
};

export type StepDef<T> = {
  no: number;
  name: string;
  system: string;
  schema: z.ZodType<T>;
  submit: { name: string; description: string };
  tools: Anthropic.Tool[];
  userMessage(ctx: Ctx): Promise<string> | string;
  /** Runs once per model turn, before that turn's tool calls (e.g. to batch embedding requests). */
  prefetch?(uses: { name: string; input: unknown }[], ctx: Ctx): Promise<void>;
  exec(name: string, input: unknown, ctx: Ctx): Promise<{ content: string; summary: string }>;
  /** Problems with a submission. Non-empty => the model is asked to fix them (up to MAX_REPAIRS). */
  check(out: T, ctx: Ctx): string[];
  /** Deterministically removes whatever is still unsupported; also attaches code-owned fields. */
  sanitize(out: T, ctx: Ctx): { output: unknown; dropped: string[] };
  maxTokens?: number;
};

export type StepResult = { output: unknown; repairs: number; dropped: string[]; warnings: string[] };

/** Marks the end of the conversation as a cache breakpoint, so each turn re-reads the (large,
 *  unchanged) prefix at a fraction of the price instead of paying full input rate again. */
function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  const blocks = (typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : [...last.content]) as Anthropic.ContentBlockParam[];
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  last.content = blocks;
  return out;
}

/** Smaller models sometimes send a nested array/object as a JSON *string*. Undo that one quirk
 *  before validating; the schema check afterwards still rejects anything that isn't right. */
function unstringify(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([k, v]) => {
      if (typeof v === "string" && /^\s*[[{]/.test(v)) {
        try { return [k, JSON.parse(v)]; } catch { /* leave as is */ }
      }
      return [k, v];
    }),
  );
}

/** Input-token equivalents at list price: cache writes cost 1.25x, cache reads 0.1x. */
function billable(u: Anthropic.Usage): number {
  return Math.round(u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1);
}

const MAX_REPAIRS = 2;
/** Prefix of the message steps.ts emits for untraceable numbers. */
export const NUMBER_PROBLEM = "These numbers appear in no tool result";

/** Batches streamed text into sentence-sized progress notes (not one DB row per token). */
function noteBuffer(emit: Emitter, step: number) {
  let buf = "";
  const flush = () => {
    if (buf.trim()) void emit.emit("note", { step, text: buf });
    buf = "";
  };
  return {
    push(delta: string) {
      buf += delta;
      if (/[.!?:]\s+$/.test(buf) || buf.includes("\n") || buf.length > 160) flush();
    },
    flush,
  };
}

export async function runStep<T>(def: StepDef<T>, ctx: Ctx): Promise<StepResult> {
  const cfg = env();
  const t0 = Date.now();
  const stepTok = { in: 0, out: 0 };
  const submitSchema = z.toJSONSchema(def.schema, { target: "draft-7" }) as Anthropic.Tool.InputSchema;
  const submitTool: Anthropic.Tool = { name: def.submit.name, description: def.submit.description, input_schema: submitSchema };

  await ctx.emit.emit("step_started", { step: def.no, name: def.name });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: await def.userMessage(ctx) }];
  let repairs = 0;
  let numberRepairs = 0;
  const repairLog: string[] = [];

  // Two stages. EXPLORE: the model gathers data with tools. SUBMIT: a separate call that offers only
  // the submit tool with the choice forced, which keeps smaller models from drifting off the schema.
  // The last rounds are always reserved for SUBMIT so running out of tool rounds can't fail a step.
  const reserve = MAX_REPAIRS + 1;
  let phase: "explore" | "submit" = def.tools.length ? "explore" : "submit";

  for (let i = 0; i < cfg.MAX_AGENT_LOOP_ITERATIONS + reserve; i++) {
    if (ctx.budget.inTok + ctx.budget.outTok > ctx.budget.maxTokens) {
      throw new Error(`Token budget of ${ctx.budget.maxTokens} exceeded during step ${def.no}`);
    }
    if (phase === "explore" && i >= cfg.MAX_AGENT_LOOP_ITERATIONS) {
      phase = "submit";
      messages.push({ role: "user", content: `You are out of research rounds. Submit now with what you have, marking gaps honestly.` });
    }
    const stream = ctx.client.messages.stream({
      model: ctx.model,
      max_tokens: def.maxTokens ?? 8000,
      system: [{ type: "text", text: def.system, cache_control: { type: "ephemeral" } }],
      messages: withCacheBreakpoint(messages),
      ...(phase === "explore"
        ? { tools: def.tools }
        : { tools: [submitTool], tool_choice: { type: "tool" as const, name: def.submit.name } }),
    });
    const notes = noteBuffer(ctx.emit, def.no);
    stream.on("text", (d) => notes.push(d));
    const msg = await stream.finalMessage();
    notes.flush();
    const inUsed = billable(msg.usage);
    ctx.budget.inTok += inUsed;
    ctx.budget.outTok += msg.usage.output_tokens;
    stepTok.in += inUsed;
    stepTok.out += msg.usage.output_tokens;
    messages.push({ role: "assistant", content: msg.content });
    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (phase === "explore") {
      if (toolUses.length === 0) {
        // The model says it has what it needs: now ask for the structured submission.
        phase = "submit";
        messages.push({ role: "user", content: `Now submit your findings by calling ${def.submit.name}.` });
        continue;
      }
      await def.prefetch?.(toolUses.map((t) => ({ name: t.name, input: t.input })), ctx);
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        await ctx.emit.emit("tool_call", { step: def.no, tool: tu.name, input: tu.input });
        let r: { content: string; summary: string };
        try {
          r = await def.exec(tu.name, tu.input, ctx);
        } catch (e) {
          r = { content: `Tool error: ${(e as Error).message}`, summary: `error: ${(e as Error).message}` };
        }
        await ctx.emit.emit("tool_result", { step: def.no, tool: tu.name, summary: r.summary });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // SUBMIT phase
    const tu = toolUses.find((t) => t.name === def.submit.name);
    if (!tu) throw new Error(`Step ${def.no} ended without submitting a result`);
    const parsed = def.schema.safeParse(unstringify(tu.input));
    const cutOff = msg.stop_reason === "max_tokens";
    const problems = parsed.success
      ? def.check(parsed.data, ctx)
      : [`The submission didn't match the schema${cutOff ? " (your reply was cut off for length: be more concise, with shorter strings and fewer items)" : ""}: ${parsed.error.issues.slice(0, 5).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`];

    // Arithmetic slips cost a full extra round each: allow one repair for them, then keep the
    // figure but flag it as unverified in the gate result (shown in the UI).
    const numericOnly = problems.length > 0 && problems.every((x) => x.startsWith(NUMBER_PROBLEM));
    if (problems.length > 0 && repairs < MAX_REPAIRS && !(numericOnly && numberRepairs >= 1)) {
      repairs++;
      if (numericOnly) numberRepairs++;
      repairLog.push(problems.slice(0, 3).map((x) => x.slice(0, 220)).join(" | "));
      await ctx.emit.emit("note", { step: def.no, text: `Checking my work: ${problems.length} issue${problems.length > 1 ? "s" : ""} found, fixing…` });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Fix these problems and call ${def.submit.name} again:\n- ${problems.join("\n- ")}` }] });
      continue;
    }
    if (!parsed.success) throw new Error(`Step ${def.no} could not produce a valid result after ${repairs} repair attempts. ${problems[0]}`);

    // Whatever is still wrong after the repair attempts is removed, never passed on.
    const { output, dropped } = def.sanitize(parsed.data, ctx);
    const warnings = problems;
    const duration = Date.now() - t0;
    ctx.prior[def.no] = output;
    const spent = costUsd(ctx.model, ctx.budget.inTok, ctx.budget.outTok);
    await db.insert(schema.analysisSteps).values({
      analysisId: ctx.analysisId, stepNo: def.no, status: "done", output: output as object, citations: ctx.ledger,
      inputTokens: stepTok.in, outputTokens: stepTok.out, durationMs: duration,
    });
    await db.update(schema.analyses)
      .set({ inputTokens: ctx.budget.inTok, outputTokens: ctx.budget.outTok, costUsd: spent.toFixed(4), model: ctx.model, currentStep: def.no })
      .where(eq(schema.analyses.id, ctx.analysisId));
    await ctx.emit.emit("step_output", { step: def.no, output, tokens: stepTok, duration_ms: duration, total_cost_usd: +spent.toFixed(4) });
    await ctx.emit.emit("gate", { step: def.no, repairs, repair_log: repairLog, dropped, warnings });
    return { output, repairs, dropped, warnings };
  }
  throw new Error(`Step ${def.no} did not finish within its round limit`);
}
