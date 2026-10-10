# Seller Growth Agent

An AI growth analyst for e-commerce sellers. Upload sales, reviews and competitor documents; a six-step agent finds what is holding the business back, backs every claim with evidence, estimates impact, and produces a 30-day plan and a report (web + PDF).

The product spec is in [PRD.md](PRD.md) and the build plan in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). This is a PM case-study build, not a shipped product: see *Known limitations*.

## Quick start

Prerequisites: Node 20+, an [Anthropic API key](https://console.anthropic.com), a free [Voyage AI key](https://www.voyageai.com), and a Supabase (Postgres) project with `create extension if not exists vector;` run once.

```bash
npm install
cp .env.example .env.local      # then fill ANTHROPIC_API_KEY, VOYAGE_API_KEY, DATABASE_URL (Supabase *Session pooler* URI)
npm run db:migrate              # create the tables
npm run seed                    # demo seller "Acme Home (demo)": ~1 min, uses Voyage + a little Haiku
npm run dev                     # http://localhost:3000
```

Open the app, click **Use sample data**: the workspace charts appear instantly. Then click **Run AI analysis** on the Overview for the problems, competitor comparison and 30-day plan.

## Accounts

Sign up with an email and a password (at least 8 characters) on `/signup`, sign in on `/login`. Each account owns its projects (up to 20) and cannot see anyone else's: every API route and page checks ownership against the database, and another account's project answers exactly like one that does not exist. Switch projects, see all of them, or start a new one from the project card at the top of the sidebar.

- **Existing projects:** projects created before accounts existed have no owner. The **first account ever created** adopts all of them; after that, new accounts start empty and get their own sample copy.
- **How it works:** passwords are hashed with scrypt; the browser holds a random session token in an httpOnly cookie (30 days) and only a SHA-256 of it is stored. Sign-in is rate limited per address and per account. Sign out ends the session on the server.
- **Forgot password:** "Forgot password?" on the sign-in page emails a one-time link (valid 1 hour, works once). The page answers the same way whether or not the email has an account. Using the link signs the account out everywhere. Signed-in users can change their password at `/account` (the "Password" link in the sidebar); that needs the current password and signs the other devices out.
- **Email setup:** put `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `.env.local` (any SMTP provider works, e.g. a Gmail app password or Brevo/Resend SMTP) and set `APP_URL` to the site's address. Without SMTP settings, in development the email is printed in the terminal running `npm run dev`; in production nothing is sent until SMTP and `APP_URL` are set.
- **Not included:** email verification at sign-up (so a typo'd address can never receive a reset), deleting an account.
- **PDF export** still works: after checking you own the report, the server gives the headless browser a signed link that is valid for that one report for 2 minutes. Set `AUTH_SECRET` (any long random string) to sign it with your own secret; without it the database URL is used.
- `npm run e2e` now needs `E2E_EMAIL` and `E2E_PASSWORD` for an account you created.

## The workspace

A left-hand navigation with seven screens, each answering one question. Filters (period, product) apply to every chart.

| Screen | Answers | Highlights |
|---|---|---|
| Overview | How is my business doing? | Computed headline, 5 KPI cards with sparklines, revenue and a volume-vs-price bridge, ranked problems, best next actions |
| Sales & Price | What did pricing do to sales? | Price and units on a shared axis, detected price changes with plain before/after impact, elasticity only when there is enough data, competitor price positions, product mix |
| Customers | What are customers saying? | Rating and low-rating trends, complaint themes and their trend, real review quotes, returns by product, returns-vs-complaints scatter |
| Reviews | Are ratings rising or falling, why, and what do I do? | Rating and good-vs-bad trends, products pulling ratings down, complaint groups ranked by priority with who can fix each (us or the supplier), per-product verdicts (protect, fix ourselves, escalate to supplier, consider retiring), best-rated products and what customers love |
| Ads | Where should my ad money go? | Ad spend vs ad sales by week, ACOS and TACoS, wasted spend, a budget per SKU with a plain verdict (spend more / keep / spend less / fix the listing first / pause / too little data), per-SKU profit-per-unit box that sets break-even, reasons and charts per SKU, expected extra sales as a range |
| Competitors | How do I compare? | Competitor tracker (price lines over time, discount days, promotions, stock, rating, review activity, recent price moves, link a competitor product to yours), scoreboard, comparison matrix with verdicts, quote-verified evidence cards, coverage gaps |
| Action Plan | What do I do first? | Impact x effort chart, 30-day board (drag an action to another week; it is saved), owners and due dates, KPIs to watch |
| Data | Is my data in, and did the plan work? | Upload with column mapping, instant preview, 30-day before/now check |

Every AI claim and chart number can be clicked to open the **evidence drawer** (the exact query rows or the quoted competitor passage). **Ask the analyst** (top right, or "Ask about this" on any chart) answers questions with the same tools the agent uses and flags any figure it cannot trace to your data. Charts also have a "View data" table. On a phone the navigation becomes a bottom tab bar.

The product name lives in one place, `src/components/brand.tsx`. See `design/BRAND_OPTIONS.pdf` for name and logo options and `design/UI_DESIGN_PLAN.pdf` for the design plan.

## Competitor data

Two ways in, both on the Data page:
- **Competitor documents** (PDF, text, or a one-off price list): chunked, embedded and searched; the AI quotes them.
- **Ads report** (CSV or Excel with one row per day, SKU and campaign, e.g. `date, sku, product_name, campaign_name, impressions, clicks, spend_inr, cpc_inr, orders_attributed, units_sold, sales_attributed_inr, ctr_pct, conversion_rate_pct, acos_pct, roas`). Required: date, SKU, ad spend and sales from ads; campaign, impressions, clicks, orders and units are optional. The ratio columns (CPC, CTR, conversion, ACOS, ROAS) are ignored and recomputed from the raw numbers. Rows that repeat a day, SKU and campaign are added together; re-uploading adds new days and updates matching ones. An ads file uploaded as sales is refused, so ad-attributed sales are never counted as orders. Ads are SKU-level only (no keyword advice). Sample: `fixtures/ads_sample.csv`.
  - **How the advice works (all plain arithmetic, no model):** each SKU's break-even ACOS is its profit per unit divided by its selling price. The seller can type profit per unit for every SKU on the Ads screen; until then 30% of price is assumed and marked "assumed". Over the last 4 weeks of ads data: well under break-even and not worsening means spend more (+25% steps); a little over means spend less; far over means cut hard; lots of clicks that rarely buy means fix the listing first (price gap to a linked competitor and rating are shown as possible causes); a rating under 3.5 means pause; under 100 clicks means too little data. Money freed by cuts funds the raises, so the total never grows. The expected gain is a range that assumes extra spend returns only 30-60% of today's return. The chat analyst can answer questions about the advice from the same numbers. The same advice appears as an "Ad budget moves" card on the Action Plan screen (cuts in week 1, raises in week 2, re-check in week 4) and as an "Ad spend" section in the printable report and PDF. Both are written by code from the ads data, not by the AI, so the AI evidence checks do not apply to them; the report section uses today's ads data rather than a snapshot from analysis time.
- **Competitor tracking data** (CSV or Excel with one row per competitor product per snapshot date, e.g. `snapshot_date, competitor_name, competitor_product_name, category, listed_price, discount_applied, rating, total_reviews, new_reviews, estimated_stock_status, badge_or_promo, data_type`). Any column names work; required are the date, competitor, product and price, the rest are optional. Dates like `10-10-2025` are read day-first unless the file proves month-first. Re-uploading adds new dates and updates matching ones, so you can keep appending fresh snapshots. The snapshots are stored in their own table and charted on the Competitors screen; the analysis reads short, code-written summary passages per product (price trend, discount days, promotions, stock, rating, new reviews) and quotes them exactly, so these facts go through the same evidence checks. A tracker file uploaded as a plain document is refused with a pointer to the right box. Files whose `data_type` says synthetic, sample or demo get a visible warning.

## Deploying to Render (simplest)

`render.yaml` is a Render blueprint, and Render runs the app as an always-on Node server, so nothing else needs setting up.

1. Sign in at render.com with GitHub, choose **New, Blueprint**, and pick this repository.
2. Render lists the environment variables from `render.yaml`. Paste `DATABASE_URL`, `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` (never into chat or the repository). `AUTH_SECRET` is generated for you.
3. After the first deploy, copy the service's address (like `https://growth-agent.onrender.com`) into `APP_URL` and let it redeploy. Reset-password links need it.
4. Open the address, sign up, add the sample project and run an analysis.

Free Render servers go to sleep when nobody is using them, so the first visit after a while takes about a minute, and an analysis stops if the server sleeps mid-run (it resumes when you reopen it). Use a paid instance if that matters. Files are stored in Supabase, so redeploys lose nothing. PDF export uses the browser's Save as PDF there.

## Deploying to Netlify

The app is set up for Netlify with Supabase as the only backing service: pages and API routes run as Netlify functions, files and data live in Supabase Postgres, and the long jobs run in one Netlify **background function**.

1. Push the repository to GitHub and, in Netlify, **Add new site, Import an existing project** and pick it. `netlify.toml` already holds the build command (`npm run build:functions && npm run build`) and Node 22.
2. In **Site configuration, Environment variables** add (never commit these): `DATABASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AUTH_SECRET` (any long random string; it also signs background-job calls), `APP_URL` (the site's own address, e.g. `https://your-site.netlify.app`), plus the model and limit settings from `.env.example` if you change them. For password-reset email add the `SMTP_*` values and `MAIL_FROM`.
3. Run the database migrations once from your laptop (`npm run db:migrate`) against the same `DATABASE_URL`.
4. Deploy. Check `/api/health`, sign up, add a sample project and run an analysis.

How the pieces behave there:
- **Uploads** are stored in the `upload_files` table, not on disk, and are limited to about **5 MB** per file (Netlify caps a request at roughly 6 MB). Split bigger files by date range.
- **The AI analysis, review tagging and document indexing** are started through `/.netlify/functions/job-background` (built from `netlify/job-entry.ts`). That function answers at once and can run up to 15 minutes. Every call is signed with `AUTH_SECRET` and expires after 5 minutes. If a run goes silent for 6 minutes it is started again from its first unfinished step, because finished steps are saved.
- **PDF export** needs an installed Chrome, which Netlify does not have, so the report page offers the browser's own **Save as PDF** (the Print button) instead.
- **Rate limits** are kept in memory per function instance, so they are a soft brake there, not a hard limit. The concurrent-analysis cap is counted in the database and holds.
- The database pool is limited to 2 connections per instance on Netlify. If you see "too many connections", switch `DATABASE_URL` to Supabase's **Transaction pooler** string.
- This has not been run on Netlify from here: the background function was bundled and exercised locally against the real database (signature checks and a job run), and everything else is covered by the unit and integration tests.

## Commands

| Command | What it does | Cost |
|---|---|---|
| `npm test` | 101 unit tests (competitor tracker parsing, summaries and passages, parsers, evidence gate, limiter, report, 30-day comparison, chart aggregation, price-change detection, review verdict rules) | free |
| `npm run test:int` | Database isolation, delete-my-data, 30-day comparison and chart-data (insights) and competitor tracker storage tests | free |
| `npm run eval:rag` | Retrieval quality: 18 questions, keyword vs vector vs hybrid | cents (embeddings) |
| `npm run eval:agent` | Full 6-step run on the demo seller, graded against the 6 planted problems | ~$0.30 |
| `npm run test:resume` | Fails a run on purpose, resumes it, checks nothing re-runs or duplicates | ~$0.30 |
| `npm run test:tracker` | Adds tracker data in the supported format to the demo seller and checks the 6-step run finds, quotes and compares it | ~$0.30 |
| `npm run test:injection` | Plants hostile instructions in a competitor file; agent must ignore them | ~$0.30 |
| `npm run e2e` | Real-browser flow over every workspace screen (needs the app running; `BASE_URL` to point it). `-- --live` also runs a full analysis and the chat | free / ~$0.25 |
| `npm run check:env` | Verifies Anthropic, Voyage and database connections | free |
| `npm run build` | Production build | free |

Costs are estimates on the default Haiku 4.5 model (set `LLM_MODEL_STEPS` to try another).

## How it works

1. **Ingest.** CSV/Excel files with any column names: headers are auto-mapped (name matching, then a cheap AI pass) and you confirm. Rows are validated (dates, numbers, currency, duplicates); thin or broken data is refused. Competitor PDFs/CSVs/text are chunked and embedded into Postgres (pgvector).
2. **Agent.** Steps 1+2 (current state; competitor evidence) run in parallel, then 3+4 (comparison; problems), then 5 (solutions with ROI) and 6 (30-day plan). Each step explores with tools (`sql_kpis`, `vector_search`, `calc`, `calc_roi`), then submits a schema-checked result.
3. **Evidence gate.** Code, not the model, decides what survives: competitor claims need an exact quote that exists in the retrieved passage; metric references must point to queries that actually ran; numbers must trace to tool results or the calculator; ROI figures come only from the ROI tool, whose baseline must come from the seller's data. Failures trigger a repair round, then removal or an "unverified" flag shown in the report.
4. **Report.** Server-rendered page with citations, ROI ranges, a plan editor (adopt, owner, due date) and a frozen KPI baseline for the 30-day re-check. PDF is the same page printed by headless Edge/Chrome.
5. **30-day check.** Saving a plan freezes structured KPIs (revenue, price, returns, ratings, top-product share, complaint themes). After re-uploading fresh files (a re-upload replaces the old ones), the report's *30-day check* recomputes them from the new data and shows before/now/change per KPI. It is plain code and SQL with no model call, and it shows what moved, not proof the plan caused it.

## Limits and safety

- Free tier: 3 analyses per project (`FREE_ANALYSES_LIMIT`, `0` = unlimited); failed runs don't count. Max 3 analyses at once (`MAX_CONCURRENT_ANALYSES`). Per-endpoint rate limits on uploads, search, analyses, PDF.
- Every route validates ids; every query is scoped to a project. **Delete my data** (project page) removes all rows and uploaded files.
- File contents and competitor text are treated as data, never instructions (see `npm run test:injection`).

## Known limitations

- **Netlify is untested end to end.** See Deploying to Netlify for what was and was not verified.
- **Accounts are basic.** Email and password only: no email verification at sign-up and no Google sign-in. Password reset needs SMTP settings to send real email. Fine for a case study; add verification before real use.
- **In-process runner.** Analyses run inside the Node server (no queue); a restart interrupts a run, which then resumes from the last finished step when its page is opened. Needs a long-running Node host (Railway, Fly, Render, a VM): **not** Vercel-style serverless, where a 4-minute background job would be killed.
- **Local file storage and in-memory rate limits** assume a single instance.
- **Speed/cost:** a full analysis takes ~3.5-4.5 minutes and ~$0.30 on Haiku (target was 3 minutes).
- **Voyage free tier** allows 3 requests/minute, so a document upload or search can pause for ~20s. Adding a payment method (the free token allowance stays) removes this.
- The number check proves a figure exists in the data or calculator, not that the surrounding sentence is right. ROI is assumption-based and overlapping, never additive.
- PDF export needs Edge or Chrome on the server (`PDF_BROWSER_PATH` to override); otherwise use the Print button.
- **Price elasticity** is descriptive: it needs 2+ months on each side of a 3%+ price move and is labelled low/medium confidence. A portfolio-average price also moves with product mix, so pick one product for a cleaner reading.
- **Chat** history lives in the browser tab (not saved), is capped at 20 questions an hour per project, and answers in about 10 seconds for about a cent.
- **Review verdicts** (retire, escalate, fix) are transparent rules over ratings, complaint themes, returns and revenue share, listed on the screen. They support a decision; they do not know your margins or stock. Who-can-fix is a rule per complaint theme (quality = supplier, sizing = check first, the rest = ours), not a judgement of each review. Praise themes are keyword matches.
- Not built yet: customers CSV, OCR for scanned PDFs, marketplace integrations.
