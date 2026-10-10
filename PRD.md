# PRD: End-to-End Seller Growth Agent

**Author:** Rahul Kandalgaonkar · **Status:** Draft v1 (PM case study) · **Date:** 6 Oct 2026
**Scope decisions:** marketplace-agnostic (generic CSV), category-agnostic, high-level agent design.

> **Reading note.** Market figures cite sources in §3 and §12. Everything else (metric targets, conversion rates, TAM math) is a **hypothesis or estimate**, labelled as such. Targets from the original brief (+10% revenue, 15% average lift, NPS > 40) are reframed as hypotheses with leading indicators (§7).

---

## 1. Product Summary

**Vision.** Every e-commerce seller, not just those who can afford an analyst, gets a "growth consultant" that reads their numbers, studies their competitors, and says plainly: *here is what is holding you back, here is what to do first, and here is what it is probably worth.*

**Problem statement.** Sellers sit on three data silos: sales, reviews and customer data. They also have no structured view of competitors. Marketplace dashboards report *what happened*, not *why* or *what to do next*. Competitor research is manual and anecdotal. The result is that sellers react to symptoms (a revenue dip) instead of diagnosing causes (e.g. a rating drop caused by a sizing complaint cluster, combined with a competitor's 12% price cut).

**Solution approach.** A web app where a seller uploads their data (CSV) and competitor material (PDFs, price sheets, review exports). A six-step AI agent analyses the seller's current state, retrieves relevant competitor evidence through RAG, compares, diagnoses problems, proposes solutions with ROI estimates, and produces a 30-day action plan. The seller watches the agent's reasoning stream live, receives a report, asks follow-up questions, and re-uploads data 30 days later to measure impact.

**Success metrics (summary; detail in §7).**

| Layer | Metric | Initial target (hypothesis) |
|---|---|---|
| Activation | Time to first completed analysis | < 2 min upload-to-first-streamed-token; < 3 min total |
| Trust | "I would act on at least one recommendation" | ≥ 70% of beta sellers |
| Engagement | Follow-up questions per report | ≥ 2 median |
| Adoption | Recommendations selected for the action plan | ≥ 30% |
| Outcome | Revenue lift vs. baseline at 30 days | Directional +5–15%; *measured, not promised* |
| Satisfaction | NPS | ≥ 40 |

---

## 2. User Personas

### Persona A: Priya, the Solo Starter
*New seller, 8 months in. 1 person, 25 SKUs, ~$3k/month revenue. Sells handmade/home products.*
- **Goals:** Reach consistent monthly sales; understand why some listings sell and others don't; avoid wasting money on ads.
- **Pain points:** Doesn't know what "good" looks like (conversion, return rate, rating); overwhelmed by dashboards; can't afford a consultant or $100+/month tools; copies competitors without knowing if it works.
- **Key needs:** Plain-language diagnosis, very few prioritized actions, minimal setup, low price. Reassurance, not jargon.

### Persona B: Arjun, the Scaling Operator
*3 years in. Team of 4, 200 SKUs, ~$60k/month. Multi-marketplace.*
- **Goals:** Grow 20%+ YoY; improve margin; protect rating while scaling; decide what to restock, reprice, or drop.
- **Pain points:** Data spread over marketplace exports, spreadsheets and a returns log; competitor price tracking is manual; recurring review complaints are never systematically analysed; every decision needs a spreadsheet.
- **Key needs:** Cross-source analysis, competitor comparison, quantified ROI to justify spend, repeatable monthly check-ups.

### Persona C: Meera, the Brand Manager at an Established Seller
*10+ years, 15-person team, 1,500 SKUs, $1M+/month. Has an in-house analyst.*
- **Goals:** Defend category share; spot threats early; get board-ready insights without waiting for the analyst.
- **Pain points:** Analyst bandwidth is the bottleneck; existing tools give data but not synthesis; skeptical of AI that can't show its evidence.
- **Key needs:** Traceable evidence behind every claim, exportable reports, data privacy guarantees, API access (Tier 3).

> **MVP focus:** Priya and Arjun. Meera drives Tier 3 (API, white-label).

---

## 3. Problem Statement (Detailed)

### 3.1 Seller pain points
1. **Data without diagnosis.** Dashboards show revenue and units but not causes. A 15% sales drop could be pricing, stock-outs, rating decay, or a new competitor, and sellers cannot tell which.
2. **Reviews are an unread goldmine.** A seller with 2,000 reviews can't manually find that "runs small" appears in 18% of 1-3★ reviews.
3. **Competitors are a black box.** Price, feature and review comparisons are manual, infrequent and biased toward what the seller already notices.
4. **No ROI framing.** Sellers get lists of "tips" with no expected value, so they cannot prioritize with limited time and money.
5. **No feedback loop.** Few sellers measure whether a change worked.

### 3.2 Why existing solutions don't work
- **Marketplace dashboards** are descriptive, single-source and blind to competitors' strategy.
- **Seller tool suites** (Helium 10, Jungle Scout, Sellerboard) are powerful but oriented to Amazon, aimed at research (keywords, product discovery) or profit tracking, and leave synthesis to the seller (see §12).
- **Generic chatbots** (ChatGPT etc.) can analyse a pasted CSV but have no persistent competitor knowledge base, no structured workflow, no ROI model, and no way to track outcomes.
- **Consultants/agencies** cost thousands per engagement and are unavailable to small sellers.

### 3.3 Opportunity size (estimates, with sources)
- Amazon alone has **~1.9M active sellers** and third-party sales of **~$575B GMV in 2025, ~69% of its marketplace GMV** ([SmartScout](https://www.smartscout.com/blog/amazon-seller-statistics), [Marketplace Pulse](https://www.marketplacepulse.com/articles/amazon-gmv-surpassed-800-billion-in-2025), [AMZPrep](https://amzprep.com/amazon-marketplace-seller-statistics/)).
- India's e-commerce market is projected at **~$136B in 2025, growing ~19% CAGR to ~$327B by 2030**; Flipkart alone cites 200M registered users and ~48% share of Indian online retail (secondary sources, treat as indicative; see [Ecosire](https://ecosire.com/blog/flipkart-india-marketplace)).
- **Illustrative bottom-up (assumption, not a sourced figure):** if 1% of Amazon's 1.9M sellers (19k) paid $99/month, that is ~$22.6M ARR from one marketplace. Adding other marketplaces and Shopify-style storefronts widens this considerably. *This should be validated in beta (willingness-to-pay test), not trusted as a forecast.*

---

## 4. Solution Design

### 4.1 Core Features

| # | Feature | Description |
|---|---|---|
| F1 | **Seller data upload** | Drag-and-drop CSV for sales (date, SKU, units, revenue, price), reviews (date, rating, text, SKU) and customers (customer id, order count, first/last order, city/segment). A column-mapping step makes it marketplace-agnostic; auto-detects common headers, lets the user fix the rest. Validation report (row counts, date range, missing fields) before analysis. |
| F2 | **Competitor data upload** | PDFs (catalogues, price lists, reports), CSV/XLSX price sheets, pasted review exports, URLs (Tier 2). Parsed, chunked, embedded and tagged by competitor and date. |
| F3 | **6-step AI analysis workflow** | Sequential agent: Current State → Retrieve Competitor Data → Compare → Identify Problems → Solutions + ROI → 30-Day Plan. Each step outputs structured JSON consumed by the next. |
| F4 | **RAG for competitive intelligence** | Retrieval over the seller's competitor corpus; every competitor claim in the report carries a citation (document + page/row). |
| F5 | **Streaming "thinking" UI** | Live stepper with a per-step stream of the agent's working notes, tool calls (e.g. "querying 14 chunks about Competitor B pricing") and interim findings. Purpose: trust and perceived speed. See guardrail in §9: shows a *concise reasoning summary*, not raw hidden chain-of-thought. |
| F6 | **Report generation** | Executive summary, current-state scorecard, competitor comparison, ranked problems, solutions with ROI range and confidence, 30-day plan. Web view + PDF export. |
| F7 | **Multi-turn chat** | Follow-up questions grounded in the analysis and the RAG store (e.g. "Why did you rank pricing above shipping?", "What if I only change 5 SKUs?"). |

### 4.2 Key User Workflows

**1. Onboarding.** Sign up (email/Google) → pick goal (grow revenue / improve rating / improve margin) → upload sales CSV → column mapping + validation summary → optionally upload reviews/customers → add competitors → "Run analysis." Target: < 5 min from signup to run, with a sample dataset available for instant demo.

**2. Analysis.** Seller sees a six-step progress bar; each step expands to show streaming findings. They can leave and come back (analysis runs server-side, resumable).

**3. Results review.** Report opens with the one-paragraph "diagnosis" and the top 3 actions. Each problem/recommendation expands to evidence (chart + citations) and assumptions behind the ROI number.

**4. Action planning.** Seller ticks recommendations to adopt, edits owner/date, and the app produces a 30-day plan with weekly milestones, a baseline snapshot of the KPIs to be tracked, and reminders.

**5. Progress tracking.** At day ~30 the app prompts a re-upload. A "before vs. after" view reports the KPI changes, which adopted actions correlate with them, and caveats (seasonality, ad spend, promos), then suggests the next cycle.

### 4.3 Technical Architecture

```
Browser (Next.js, React)
   │  upload (presigned URL) ──────────────► Object storage (S3-compatible, encrypted)
   │  SSE stream (analysis events) ◄──┐
   ▼                                   │
Next.js app (App Router, TypeScript) ──┤
   │ REST/tRPC                          │
   ▼                                   │
Node.js API / worker (TypeScript) ─────┘
   ├─ Ingestion: CSV parse (Papa/csv-parse) + schema map; PDF text extraction (+ OCR fallback)
   ├─ Embedding pipeline: chunk → embed → upsert
   ├─ Agent orchestrator (6 steps, state machine) ──► Claude API (Sonnet-class model, tool use, streaming)
   ├─ Tools: sql_query(seller_data), vector_search(competitor_corpus), calc_roi()
   ▼
Postgres (app data + pgvector)   |   Redis (job queue, stream fan-out)
```

**Frontend.** Next.js (App Router) + TypeScript + Tailwind; shadcn/ui components; Recharts for charts; Server-Sent Events for streaming (simpler than WebSockets for one-way streams; auto-reconnect with `Last-Event-ID`). State saved per step so refresh/resume works.

**Backend.** Node.js (TypeScript). Long-running analyses run in a worker (BullMQ on Redis), not in the request path. The API streams worker events to the client over SSE. Anthropic SDK for Claude (streaming + tool use).

**Data & RAG layer.**
- **Vector store: pgvector on Postgres** (Supabase/Neon). *Chosen over Pinecone/Qdrant because* the corpus per seller is small (hundreds to low thousands of chunks), one datastore means one security/backup model and row-level tenant isolation, and it removes a vendor for a 2-week MVP. Revisit if a single tenant exceeds ~1M chunks.
- **Embeddings:** Voyage AI embeddings (strong retrieval quality, pairs with Claude); abstracted behind an interface so the model can be swapped.
- **Chunking:** ~500–800 tokens, 10–15% overlap, table-aware for price sheets; metadata = `{seller_id, competitor, doc_id, page, date, doc_type}`.
- **Retrieval:** hybrid (vector + keyword/BM25 via Postgres full-text), metadata filter on competitor and recency, top-k 8–12, optional rerank. Freshness date is surfaced to the model and to the user.
- **Seller structured data** lives in Postgres tables and is queried via SQL tools, not stuffed into the prompt. This is more accurate and cheaper than pasting 50k rows.

**Agent orchestration (high-level).** A deterministic state machine runs six steps in order. Each step has (a) a focused system prompt, (b) allowed tools, (c) a JSON output schema validated before moving on, and (d) retry-with-repair on schema failure. Numbers (growth rates, ROI) are **computed by code tools, not by the LLM**; the LLM chooses inputs and interprets. Step outputs are persisted so the chat can reference them.

**Model choice.** A Sonnet-class Claude model for Steps 1–6 and chat (best cost/quality for tool use); a smaller, cheaper model for ingestion tasks (column mapping suggestions, review tagging). Prompt caching on the shared seller context to reduce cost/latency.

**Security.** Encryption in transit and at rest; per-tenant row-level security; no training on seller data; signed, expiring upload URLs; deletion on request.

---

## 5. Detailed Workflow Description

| Step | What the seller sees | What happens under the hood |
|---|---|---|
| **1. Upload seller data** | Upload zone → column-mapping table → validation summary ("1,842 orders, 38 SKUs, 2025-04-01 → 2025-09-30, 3% missing prices"). | CSV parsed, mapped to canonical schema, loaded to Postgres. Review text tagged with sentiment/topic by a cheap model. Errors flagged, not silently dropped. |
| **2. Upload competitor data** | Add competitors by name; drop PDFs/price sheets; each shows "processed, 42 chunks, dated 12 Sep." | Parse → chunk → embed → upsert with metadata. Stale docs (> 90 days, configurable) get a freshness warning. |
| **3. Agent Step 1: Current state** | Streaming notes: "Revenue is down 11% vs prior 30 days; 3 SKUs account for 64% of revenue; average rating fell 4.4→4.1." | SQL tools compute KPIs: revenue trend, SKU concentration, price/mix, return/rating trends, repeat-customer rate, review themes. Output: `current_state.json`. |
| **4. Agent Step 2: RAG retrieval** | "Looking up competitor pricing, features and complaints… 14 relevant passages from 3 documents." Citations appear as chips. | Query generation from Step 1 findings → hybrid retrieval per competitor → dedup/rerank → evidence set with source IDs and dates. |
| **5. Agent Step 3: Compare vs. competitors** | A comparison table: price, rating, key features, review themes, positioning, with source links. | Aligns seller vs. competitor attributes; flags where data is missing instead of guessing. Output: `comparison.json`. |
| **6. Agent Step 4: Identify problems** | Ranked problem list (e.g. "P1: 31% of low-rated reviews cite sizing; competitor B lists a size guide"). Each has severity, evidence, and confidence. | Cross-references Steps 1 and 3; each problem must cite ≥ 1 data source and ≥ 1 metric, otherwise dropped. |
| **7. Agent Step 5: Solutions + ROI** | Per problem: 1–3 solutions with ROI range ("+$900–1,800/month, medium confidence"), effort, and cost; assumptions visible and editable. | `calc_roi()` tool computes from seller baselines × explicit assumptions (conversion, price elasticity ranges, etc.). Outputs ranges and confidence, never single-point promises. |
| **8. Agent Step 6: 30-day plan** | Week-by-week plan, owners, dependencies, KPI to watch for each action, with a baseline snapshot. | Sequences actions by ROI ÷ effort and dependency; creates tracking baseline. |
| **9. Report + follow-ups** | Report page, PDF export, chat panel with suggested questions. | Chat retrieves from stored step outputs, the SQL tools and the vector store; answers cite sources. |
| **10. Track progress** | Day-30 prompt → re-upload → before/after dashboard + next recommendations. | Diff of KPIs vs. baseline; adoption status per action; seasonality/promo caveat prompt; seeds the next analysis. |

**Example end-to-end narrative.** Arjun uploads 6 months of sales, 3,400 reviews and price sheets for two competitors. The agent finds revenue flat while units are up (a discounting problem), a ratings dip tied to packaging-damage complaints, and a competitor offering free shipping above a threshold Arjun lacks. It proposes three fixes with ROI ranges and a 30-day plan; Arjun adopts two; 30 days later the re-upload shows return rate down and AOV up, and the report attributes this cautiously.

---

## 6. Features & Functionality

### Tier 1 (MVP, 2 weeks)
- Auth + single workspace per seller.
- Sales/review CSV upload with column mapping and validation.
- Competitor PDF + CSV upload; parse, embed, retrieve with citations.
- 6-step agent with SSE streaming UI.
- Basic report (web + PDF export).
- Sample dataset for instant demo.
- Usage limit: 3 free analyses.

### Tier 2 (Post-launch)
- Multi-turn chat with tool access.
- Comparison matrix (seller vs. competitors) as a persistent, editable view.
- Feature recommendation engine (from review gaps + competitor features).
- Pricing optimization module (elasticity ranges, margin floor).
- Progress tracking dashboard; competitor URL ingestion.

### Tier 3 (Growth)
- Marketplace API integrations (direct data pull).
- White-label for e-commerce platforms/agencies.
- Real-time pricing alerts.
- Automated competitor monitoring (scheduled re-ingestion, change diffs).

**Prioritization rationale (case-study note).** MVP is the smallest slice that proves the core claim: *"the agent finds a real, non-obvious problem and a credible fix."* Chat is Tier 2 despite being engaging, because the report quality drives trust first; chat on a weak report doesn't help. Integrations are Tier 3 because CSV removes the dependency on marketplace approvals and is enough to test value.

---

## 7. Success Metrics

**MVP (product quality)**

| Metric | Target | How measured |
|---|---|---|
| Time to first analysis | < 2 min to first streamed output; total analysis < 3 min | Server timestamps |
| Report usefulness | ≥ 70% answer "yes, I'd act on at least one recommendation"; ≥ 4/5 relevance rating | In-report survey |
| Engagement | ≥ 2 follow-up questions per report (median); ≥ 60% open ≥ 1 evidence citation | Event analytics |
| Groundedness | ≥ 95% of competitor claims traceable to a source; 0 fabricated numbers in audit of 20 reports | Manual audit + automated citation check |

**Real-world impact (via seller partnerships), framed as hypotheses**

| Hypothesis | Leading indicator (week 1–3) | Lagging outcome (day 30) |
|---|---|---|
| H1: Sellers act when ROI is clear | % of recommendations moved into the action plan (≥ 30%); % implemented by day 14 | Adoption rate (≥ 25% implemented) |
| H2: Fixing diagnosed problems raises conversion/revenue | Listing/price/shipping changes shipped; conversion or click-to-order trend | Revenue vs. baseline: directional **+5–15%**; original ambition of +10% is a stretch goal, not a promise |
| H3: Review-driven fixes lift ratings | Complaint-theme frequency in new reviews | Rating change (e.g. +0.1–0.2★) |
| H4: Better experience brings buyers back | Return/refund rate | Repeat-customer share |

**Measurement caveat (important).** With 5 beta sellers and no control group, a revenue change cannot be attributed to the agent (seasonality, ads, promotions all confound). Mitigations: capture a 60-day pre-period baseline, record promos/ad spend at re-upload, compare each seller to their own prior trend and, where possible, to an untouched control SKU group. Report effect sizes as "observed, not causal."

**Satisfaction.** NPS ≥ 40 (small-n, treat as directional).

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Full analysis < 3 min for ≤ 50k sales rows, ≤ 5k reviews, ≤ 10 competitor docs. First streamed token < 10 s after "Run". |
| Scalability | 1,000+ concurrent analyses via queue-based workers with horizontal scaling; per-tenant rate limits; LLM concurrency/back-pressure and fallback on rate limits. |
| Privacy & security | Encryption at rest/in transit; tenant isolation (RLS); seller data never shared with other sellers or used to train models; data deletion within 30 days of request; PII minimisation (customer IDs hashed, no names/emails required); GDPR/India DPDP-aware consent. |
| Availability | 99% monthly uptime (~7 h/month downtime allowance); analysis jobs resumable after worker restart. |
| Reliability | Schema-validated step outputs; automatic retry/repair; partial results preserved. |
| Cost | Target < $1.50 of LLM+infra cost per analysis (to be validated; free tier = 3 analyses). |
| Accessibility | WCAG 2.1 AA for report and chat. |
| Observability | Per-step latency, token usage, failure rates, citation coverage. |

---

## 9. Dependencies & Risks

**Dependencies:** Claude API availability, rate limits and pricing; embedding provider; Postgres/pgvector performance; PDF parsing quality (OCR for scanned docs); beta sellers willing to share data.

| Risk | Likelihood / Impact | Mitigation |
|---|---|---|
| **Garbage-in data quality** (missing columns, mixed currencies, duplicate rows) | High / High | Column mapping + validation report; refuse to analyse below minimum quality; surface data-quality score in the report; sample templates. |
| **Stale competitor data** (outdated PDFs) | High / Medium | Doc date extraction/entry; freshness badge; down-weight old docs in retrieval; warn when > 90 days; Tier 3 auto-monitoring. |
| **Hallucinated recommendations** | Medium / Very high | Numbers computed by code, not the LLM; evidence-required rule (each problem cites data); ROI as ranges with confidence + visible assumptions; "insufficient data" is an allowed output; citation checker; human audit of first 20 reports. |
| **Over-trust in AI advice** | Medium / High | Show assumptions, label as estimates, no guaranteed outcomes, easy "why?" chat. |
| **Misleading impact claims** (no causality) | High / Medium | Own-baseline comparison, caveats in the progress view (§7). |
| **Thinking-stream exposure** (raw chain-of-thought can be verbose or unreliable) | Medium / Medium | Stream concise step summaries and tool activity, not raw reasoning dumps. |
| **Competitor data legality** (scraping ToS) | Medium / Medium | MVP uses seller-supplied documents only; URL scraping reviewed legally before Tier 2. |
| **LLM cost/latency spikes** | Medium / Medium | Prompt caching, smaller model for cheap tasks, per-analysis token budget. |
| **Privacy incident** | Low / Very high | Tenant isolation, minimal PII, security review before beta. |

---

## 10. Launch Plan

| Week | Milestone | Exit criterion |
|---|---|---|
| 1–2 | Build MVP (Tier 1): upload, parsing, RAG, 6-step agent, streaming UI, basic report | Demo on sample dataset end-to-end, < 3 min |
| 3 | Beta with 5 sellers (onboarded 1:1) | ≥ 3 complete runs on real data; usability notes captured |
| 4 | Measure & iterate: usefulness survey, citation audit, fix top 5 issues; start 30-day tracking clocks | ≥ 70% "would act"; 0 fabricated numbers |
| 5 | Polish and documentation: onboarding, templates, help docs, privacy page, pricing page | Docs complete; no P0 bugs |
| 6 | Public launch | Landing page + community posts live; analytics in place |

*Note:* the 30-day impact measurement cannot finish within the 6-week plan if the beta starts in week 3. Early weeks measure **leading indicators** (§7); true 30-day outcomes arrive in weeks 7–8 and feed the post-launch narrative.

---

## 11. Go-to-Market

- **Communities:** Reddit (r/FulfillmentByAmazon, r/ecommerce, r/AmazonSeller, r/Flipkart-style seller groups), Facebook seller groups. Offer free analyses in exchange for feedback; no spam, disclose being the builder.
- **Marketplace partnerships:** Flipkart Seller Hub / Amazon Seller app-store style listings, long-term; not required for MVP.
- **Content marketing:** "How to read your reviews to find your next fix," "Pricing against competitors without a race to the bottom," teardown posts using anonymised real analyses.
- **Pricing:** Freemium: **3 free analyses**, then **$99/month unlimited**. *Pricing hypotheses to test:* a $29–49 tier for Priya-type sellers (the price may be too high for solo starters; compare with Jungle Scout's $29–49 entry plans), and annual discounts.
- **Funnel assumptions (to validate):** landing → signup 8%; signup → first analysis 50%; free → paid 5–8%.

---

## 12. Competitive Analysis

| Solution | What it does | Pricing (2026, per sources) | Gap vs. our product |
|---|---|---|---|
| **Helium 10** | Amazon seller suite: keyword research, listing optimization, product research, analytics | Platinum $129/mo ($99 annual), Diamond $359/mo; free tier ([Helium 10](https://www.helium10.com/blog/helium10-pricing-plan-vs-jungle-scout-pricing-plan/)) | Research and tooling, not a synthesized diagnosis; Amazon-centric; seller must interpret and prioritize |
| **Jungle Scout (Catalyst)** | Product research, supplier, market intelligence, competitive tools | Starter $49/mo ($29 annual) up to Brand Owner + CI $149/mo ($129 annual) ([EcomCrew](https://www.ecomcrew.com/helium10-vs-junglescout/)) | Market data from its own panel, but no analysis of the seller's own reviews/customers combined with seller-supplied competitor docs |
| **Sellerboard** | Profit and performance analytics for Amazon sellers | From ~$19/mo ([GorillaROI](https://www.gorillaroi.com/compare/helium-10-alternatives)) | Strong on profit tracking; descriptive, no competitive RAG or recommendations with ROI |

Also relevant: generic AI assistants (ChatGPT/Claude chat) and consultants. Pricing details come from third-party comparison pages and vendors change them often; verify before publishing externally.

**Differentiation:** (1) *agentic*, a diagnosed → prioritized → planned flow, not a toolbox; (2) *RAG over the seller's own competitor material* with citations; (3) *ROI-ranked actions* and a 30-day plan; (4) *closed loop* via re-upload; (5) *marketplace-agnostic* CSV entry.

**Positioning:** *"The growth consultant for sellers who can't hire one"*: not a research tool, but the layer that turns your data and competitor intel into the next three things to do. Initially complementary to the existing suites (seller uses Helium 10 for keywords, us for strategy).

**Risk:** incumbents have the data and distribution and could add an AI layer. Our moat must be workflow quality, accumulated outcome data (what actually worked), and speed.

---

## 13. Assumptions
1. Sellers can export sales data (most can via platform dashboards). *Test:* can 5 of 5 beta sellers produce a usable CSV in < 10 min?
2. Sellers want competitive intelligence and will supply competitor documents. *Risk:* sourcing PDFs is friction; may need assisted ingestion (Tier 2).
3. Sellers act on recommendations if ROI is clear. *Test:* adoption rate.
4. AI recommendations are trusted when evidence is visible.
5. 6 months of data is enough to detect trends (min. 90 days assumed).
6. Sellers accept ROI *ranges* and will not demand point forecasts.

---

## 14. Success Criteria
- **MVP shipped in 2 weeks** (Tier 1 complete, demo-able).
- **3–5 sellers actively using by week 3**, ≥ 3 with real-data analyses.
- **Revenue:** observed directional improvement vs. the seller's own baseline by week 4 on leading indicators; the **15% average lift is a stretch hypothesis**, with an honest report of what was and wasn't attributable.
- **NPS ≥ 40**, with ≥ 70% "would act on a recommendation".
- **Zero fabricated numbers** in the audited reports.

---

## Appendix A: Open Questions
1. Minimum data volume for a trustworthy analysis (rows/days)?
2. Is the sellers' main friction uploading competitor docs, and should we auto-discover competitors?
3. Should ROI estimates be shown by default or behind "assumptions" for low-confidence cases?
4. Which price point converts Priya-type sellers?

## Appendix B: Sources
- [SmartScout, Amazon seller statistics](https://www.smartscout.com/blog/amazon-seller-statistics)
- [Marketplace Pulse, Amazon GMV surpassed $800B in 2025](https://www.marketplacepulse.com/articles/amazon-gmv-surpassed-800-billion-in-2025)
- [AMZPrep, 2026 Amazon seller statistics](https://amzprep.com/amazon-marketplace-seller-statistics/)
- [Helium 10 pricing vs. Jungle Scout](https://www.helium10.com/blog/helium10-pricing-plan-vs-jungle-scout-pricing-plan/)
- [EcomCrew, Helium 10 vs Jungle Scout 2026](https://www.ecomcrew.com/helium10-vs-junglescout/)
- [GorillaROI, Helium 10 alternatives](https://www.gorillaroi.com/compare/helium-10-alternatives)
- [Ecosire, Flipkart marketplace guide](https://ecosire.com/blog/flipkart-india-marketplace)
