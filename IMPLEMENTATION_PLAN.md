# Implementation Plan: Seller Growth Agent (MVP, 2 weeks)

Companion to [PRD.md](PRD.md). Scope = PRD Tier 1 only. Principle: **build the thinnest vertical slice first (Day 1–3), then widen.** The agent quality is the product; everything else exists to feed it and display it.

## 0. Decisions (defaults, change if you disagree)

| Area | Decision | Why |
|---|---|---|
| Repo | Single Next.js (App Router, TypeScript) app + separate `worker` process in one repo (npm workspaces) | One deploy unit to start, worker splits cleanly later |
| DB | Postgres + pgvector (Supabase or Neon; Docker Postgres locally) | Per PRD §4.3 |
| ORM/migrations | Drizzle | Light, SQL-first, good pgvector support |
| Queue | BullMQ + Redis (Upstash or local Docker) | Long-running jobs off the request path |
| Streaming | SSE; events persisted to DB (`analysis_events`) so refresh/resume replays | Resumability for free |
| LLM | `claude-sonnet-5-5` for steps + chat; `claude-haiku-4-5-20251001` for tagging/column-mapping | Cost/quality split |
| Embeddings | Voyage AI behind an `Embedder` interface | Swappable |
| Auth | Auth.js (email magic link + Google) | Fast |
| Storage | S3-compatible (Supabase Storage / R2); local disk in dev | Presigned uploads |
| PDF parsing | `pdf-parse`/`unpdf`; OCR fallback deferred to Tier 2 | MVP simplicity |
| Validation | Zod for every step output | Schema-validated agent steps |
| UI | Tailwind + shadcn/ui + Recharts | Speed |
| Tests | Vitest (unit), Playwright (1 e2e happy path) | Enough for MVP |
| Hosting | Vercel (web) + Railway/Fly (worker, Redis) | Easy |

**Needs from you before Day 1:** Anthropic API key, Voyage API key, a Postgres (Supabase/Neon) URL, Redis URL. Keys go in `.env.local` (git-ignored), never in code.

## 1. Repo layout

```
growth-agent/
├─ apps/
│  ├─ web/                    # Next.js app
│  │  ├─ app/(auth)/, app/(app)/projects/[id]/{upload,analysis,report,chat}
│  │  ├─ app/api/{uploads,analyses,events,chat}/route.ts
│  │  └─ components/{upload,stepper,stream-panel,report,chat}
│  └─ worker/                 # BullMQ consumers
│     └─ jobs/{ingest-sales,ingest-reviews,ingest-doc,run-analysis}.ts
├─ packages/
│  ├─ db/                     # drizzle schema, migrations, queries
│  ├─ ingest/                 # csv mapping, validators, pdf parse, chunker
│  ├─ rag/                    # embedder, hybrid search, citation types
│  ├─ agent/                  # orchestrator, steps/, prompts/, tools/, schemas/
│  └─ shared/                 # types, event contracts, config
├─ fixtures/                  # synthetic sales/reviews/competitor docs (see §6)
├─ docs/ (PRD.md, this file)
└─ docker-compose.yml         # postgres+pgvector, redis
```

## 2. Data model (v1)

- `users`, `projects` (seller workspace; goal enum: revenue | rating | margin)
- `uploads` (id, project_id, kind: sales|reviews|customers|competitor_doc, status, storage_key, mapping_json, stats_json, error)
- `sales` (project_id, order_date, sku, units, revenue, price, returned bool?) · `reviews` (project_id, date, sku, rating, text, topics text[], sentiment) · `customers` (project_id, customer_hash, orders, first_order, last_order, segment)
- `competitors` (project_id, name) · `documents` (competitor_id, upload_id, doc_date, doc_type) · `chunks` (document_id, content, page, embedding vector(1024), tsv tsvector, metadata jsonb) with HNSW + GIN indexes
- `analyses` (project_id, status, current_step, started_at, finished_at, cost_tokens) · `analysis_steps` (analysis_id, step_no, status, output_json, citations_json, tokens, duration) · `analysis_events` (analysis_id, seq, type, payload) · `report_exports` · `chat_messages` · `action_plan_items` (recommendation_id, adopted, owner, due_date, baseline_json)
- Tenant isolation: every table keyed by `project_id`; queries go through a repo layer that requires it. RLS on top once on Supabase.

## 3. Agent design (implementation level)

Orchestrator = deterministic loop over 6 step modules. Each `Step` exports `{ id, systemPrompt, tools, outputSchema(Zod), run(ctx) }`.

| # | Step | Tools it may call | Output (Zod schema) |
|---|---|---|---|
| 1 | current_state | `sql_kpis(…)`, `sql_query(readonly, templated)`, `review_themes()` | KPIs, trends, SKU concentration, rating/return trends, top review themes, data-quality notes |
| 2 | retrieve_competitors | `vector_search(competitor, query, k)` | Evidence set: passages with `source_id`, page, doc_date |
| 3 | compare | none (reasons over 1+2) | Attribute table seller vs competitors; `missing_data[]` |
| 4 | identify_problems | `sql_query` for verification | Ranked problems; each requires `evidence[]` (metric ref + citation) or it is dropped |
| 5 | solutions_roi | `calc_roi(baseline, assumptions)` | Per problem: solutions, ROI low/high, confidence, assumptions, effort |
| 6 | action_plan | none | 30-day plan by week, KPI to track per action, baseline snapshot |

Rules baked into code (not just prompts):
1. **Numbers come from tools.** The LLM never does arithmetic that ends up in the report; `calc_roi` and SQL do.
2. **Evidence gate:** a post-step validator rejects problems/claims with no resolvable `source_id` or metric ref → one repair retry → else dropped and noted.
3. **Insufficient data is a valid output.**
4. **Streaming:** use the Anthropic streaming API; emit events `step_started`, `note` (short human-readable summary), `tool_call`, `evidence`, `step_output`, `step_failed`, `done`. No raw chain-of-thought is forwarded; the `note` is a prompted one-sentence progress summary.
5. Persist each step output before starting the next; resume from the last completed step on worker restart.
6. Prompt-cache the shared seller-context prefix (steps 1–6 + chat).

## 4. Milestones and tasks

### Phase 0: Foundation (Day 1)
- [ ] Init repo, workspaces, TS config, lint/prettier, Vitest.
- [ ] `docker-compose` (pgvector + redis); Drizzle schema + first migration.
- [ ] `.env.example`, config loader with Zod validation of env.
- [ ] Auth.js working; empty project dashboard.
- **Done when:** `npm run dev` shows login → empty projects list; migrations apply cleanly.

### Phase 1: Walking skeleton (Day 2–3) ← the most important phase
Hard-code a fixture dataset and run **steps 1 and 3 only** end-to-end with streaming to a bare page. Proves: queue → worker → Claude streaming → SSE → UI.
- [ ] `run-analysis` job + `analysis_events` table + SSE endpoint with `Last-Event-ID` replay.
- [ ] Step 1 with `sql_kpis` tool; basic stream panel.
- **Done when:** clicking "Run" streams live notes and persists a validated `current_state` JSON. Reload mid-run replays events.

### Phase 2: Ingestion (Day 4–5)
- [ ] Presigned upload + `uploads` state machine.
- [ ] CSV parse + header auto-mapping (fuzzy match, Haiku suggestion fallback) + mapping UI + validation report (row counts, date range, null rates, duplicate rows, currency check). Block analysis below minimum quality (≥ 30 days, ≥ 100 orders; tunable).
- [ ] Reviews ingestion + Haiku topic/sentiment tagging in batches.
- [ ] Competitor docs: PDF/CSV parse → chunk (~600 tokens, 12% overlap, table-aware for CSV rows) → embed → upsert; doc date extraction/manual field.
- **Done when:** uploading the fixture CSVs/PDFs via UI yields populated tables and chunk counts; bad files show actionable errors.

### Phase 3: RAG (Day 6)
- [ ] Hybrid search (vector + `tsvector`), metadata filters, simple rerank (RRF), top-k.
- [ ] Retrieval eval: 15 hand-written questions over fixture docs; target recall@8 ≥ 0.85.
- [ ] Citation type + resolver (`source_id` → doc, page).

### Phase 4: Full 6-step agent (Day 7–9)
- [ ] Steps 2–6 with Zod schemas, tools (`vector_search`, `calc_roi`, verification SQL), evidence gate, repair retry.
- [ ] Orchestrator resume logic, per-analysis token budget and timeout, failure surfaced in UI.
- [ ] Prompt iteration against fixtures; record golden outputs for regression.
- **Done when:** full run on fixtures < 3 min, all outputs schema-valid, every problem cited.

### Phase 5: UI + report (Day 10–11)
- [ ] 6-step stepper with expandable stream per step, citation chips, evidence drawer.
- [ ] Report page (exec summary, scorecard, comparison table, problems, solutions + ROI ranges and assumptions, 30-day plan) + PDF export (server-side print of the report route via headless Chromium/Playwright).
- [ ] Action plan: adopt/skip toggles, baseline snapshot saved.
- [ ] Sample-dataset button on onboarding.

### Phase 6: Hardening and beta prep (Day 12–14)
- [ ] Free-tier counter (3 analyses); rate limits; per-analysis token/cost logging.
- [ ] Error states, empty states, mobile-readable report.
- [ ] Security pass: tenant isolation tests (user A cannot read user B), signed URLs expire, no PII in logs, delete-my-data endpoint.
- [ ] Playwright happy-path e2e; deploy web + worker; smoke test on production.
- [ ] Citation-coverage audit script (fraction of claims with valid sources).
- **Done when:** a stranger can sign up, use the sample dataset, and get a report without help.

Post-MVP (Tier 2, not in this plan): chat with tools, comparison matrix view, pricing module, day-30 re-upload tracking UI. The schema already holds `chat_messages` and baselines so these don't need migrations. *Note:* the PRD lists chat as Tier 2; if beta sellers need it early, it can be slotted into Day 12 as a minimal read-only Q&A over stored step outputs.

## 5. Testing strategy

- **Unit:** CSV mapping, validators, chunker, `calc_roi`, evidence gate, SSE replay.
- **Agent regression:** run the 6 steps against fixtures with a recorded/mocked Claude client for fast CI; a separate manual "live" suite compares to golden JSON by structure + key facts (not exact text).
- **Hallucination checks:** automated: every number in the report must be traceable to a tool result; every citation must resolve. Manual: read the first 20 real reports.
- **E2E:** one Playwright flow: signup → sample data → run → report.

## 6. Fixtures (build on Day 1–2 so everyone tests on the same data)

Synthetic seller "Acme Home" with **planted, known problems** so we can verify the agent finds them:
- 6 months of sales, 38 SKUs, a mid-period revenue decline concentrated in 3 SKUs.
- ~2,500 reviews where ~30% of low-rated ones mention "size runs small" and packaging damage.
- 2 competitors: price sheet CSV (one undercuts by ~12% on top SKUs) + a PDF catalogue (offers a size guide and free shipping above a threshold).
- Expected findings checklist stored in `fixtures/expected.md` used as the acceptance test for Phase 4.

## 7. Risks to the 2-week schedule

| Risk | Mitigation / cut line |
|---|---|
| Messy real-world CSVs eat Phase 2 | Ship strict template + mapping UI; fuzzy auto-map only if time remains |
| Prompt iteration is open-ended | Time-box to 2 days; schemas + evidence gate make bad output fail loudly rather than silently |
| PDF parsing quality | Text PDFs only for MVP; OCR deferred |
| PDF export of report | Fallback: browser "Print to PDF" CSS |
| Streaming/resume complexity | Persisted events are the source of truth; polling fallback if SSE misbehaves |
| Cut line if behind | Drop customers CSV, drop PDF export, drop Google login; **never** drop evidence gate or citations |

## 8. Definition of done for MVP
- Fixture run finds all planted problems in `expected.md` (≥ 80%).
- Full analysis < 3 min; first streamed token < 10 s.
- 0 uncited competitor claims; 0 untraceable numbers.
- Tenant-isolation tests pass; deployed and demo-able from a public URL.

## 9. Open questions
1. Hosting accounts: do you already have Supabase/Neon, Vercel, Railway accounts, or should I keep it local-first (Docker) until the demo?
2. Is the free tier counted per user or per project?
3. Do you want me to scaffold Phase 0 + fixtures now?
