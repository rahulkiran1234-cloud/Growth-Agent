// Real-browser end-to-end test: npm run e2e [-- --live]
// Drives your installed Edge/Chrome against a running server (BASE_URL, default http://localhost:3000).
// Without --live no AI analysis is started (so it costs ~nothing); with --live it also runs one full analysis.
import { config } from "dotenv";
config({ path: ".env.local" });
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LIVE = process.argv.includes("--live");
const results: { name: string; ok: boolean; err?: string }[] = [];

function browserPath(): string | undefined {
  return [
    process.env.PDF_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p): p is string => !!p && existsSync(p));
}

async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    const err = (e as Error).message.split("\n")[0];
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${err}`);
  }
}

const sectionInput = (page: Page, heading: string) => page.locator(`section:has(h2:has-text("${heading}")) input[type=file]`);

async function main() {
  const exe = browserPath();
  if (!exe) throw new Error("No Edge or Chrome found. Set PDF_BROWSER_PATH.");
  const tmp = mkdtempSync(path.join(tmpdir(), "e2e-"));

  // Small input files so the run stays quick and cheap.
  const sales = path.join(tmp, "sales.csv");
  writeFileSync(sales, readFileSync("fixtures/acme_sales.csv", "utf8"));
  const reviews = path.join(tmp, "reviews.csv");
  writeFileSync(reviews, readFileSync("fixtures/acme_reviews.csv", "utf8").split("\n").slice(0, 61).join("\n"));
  const doc = path.join(tmp, "rival.txt");
  writeFileSync(doc, "RIVAL SHOP CATALOGUE\nDate: 2026-09-15\n\nPAGE 1 - SHIPPING\nRival Shop offers free shipping on all orders above Rs 799 and delivers within 3 days.\n\nPAGE 2 - RETURNS\nRival Shop accepts returns within 21 days and refunds within 4 business days.\n");

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  let projectId = "";
  // Requests made outside the browser reuse the signed-in session cookie.
  let cookieHeader = "";
  const authed = (p: string) => fetch(`${BASE}${p}`, { headers: { cookie: cookieHeader } });
  const api = async (p: string) => (await authed(p)).json();
  const EMAIL = process.env.E2E_EMAIL, PASSWORD = process.env.E2E_PASSWORD;
  if (!EMAIL || !PASSWORD) throw new Error("Sign-in is required now. Create an account in the app, then run with E2E_EMAIL and E2E_PASSWORD set to it.");

  console.log(`E2E against ${BASE}${LIVE ? " (live analysis ON)" : ""}\n`);

  // ---------- onboarding with sample data ----------
  // ---------- sign-in ----------
  await step("signed-out visitors are sent to the sign-in page, and API calls are refused", async () => {
    await page.goto(BASE);
    await page.waitForURL(/\/login/);
    assert.equal((await fetch(`${BASE}/api/projects`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/projects/00000000-0000-0000-0000-000000000000/insights`)).status, 401);
  });

  await step("a wrong password is refused with a generic message", async () => {
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(`${PASSWORD}-wrong`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Email or password is incorrect.").waitFor();
  });

  await step("signing in with your account opens the project list", async () => {
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${BASE}/`);
    cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    assert.ok(cookieHeader.includes("ga_session="), "no session cookie after signing in");
  });

  await step("home page loads and lists projects", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Growth Agent" }).waitFor();
    await page.getByText("Use sample data").waitFor();
  });

  await step("one-click sample data creates a ready project", async () => {
    await page.getByRole("button", { name: "Use sample data" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await page.getByRole("heading", { name: "Overview" }).waitFor({ timeout: 30_000 });
    await page.getByText(/Revenue is (down|up)/).waitFor(); // instant charts, no AI needed
    await page.goto(`${page.url().replace(/\/$/, "")}/data`);
    await page.getByText("3134").first().waitFor();
    await page.getByTestId("usage").waitFor();
    assert.match(await page.getByTestId("usage").innerText(), /free analyses used/);
    assert.ok(await page.getByRole("button", { name: "Run analysis" }).isEnabled(), "Run analysis should be enabled on the sample project");
  });

  // ---------- upload flow on a fresh project ----------
  await step("create a new project from the form", async () => {
    await page.goto(BASE);
    await page.getByPlaceholder("New project name").fill(`E2E ${Date.now()}`);
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
    projectId = page.url().split("/").pop()!;
    await page.getByText("Add your data to see this screen").waitFor(); // friendly empty state, not a broken chart
    await page.goto(`${BASE}/projects/${projectId}/data`);
    assert.ok(await page.getByRole("button", { name: "Run analysis" }).isDisabled(), "Run must be disabled before data is uploaded");
    await page.getByText("Upload a sales CSV").waitFor();
  });

  await step("sales CSV: auto-mapped columns, confirm, validation report", async () => {
    await sectionInput(page, "1. Sales data").setInputFiles(sales);
    await page.getByText("rows found. Check which column holds what").waitFor({ timeout: 60_000 });
    assert.equal(await page.locator("select").first().inputValue(), "order_date", "order_date should be pre-selected");
    await page.getByRole("button", { name: "Confirm and import" }).click();
    await page.getByText("3134 of 3134 rows valid").waitFor({ timeout: 90_000 });
    await page.getByText("No currency detected").waitFor();
    await page.getByRole("button", { name: "Run analysis" }).waitFor();
    await page.getByText("Instant preview from your data").waitFor({ timeout: 30_000 }); // charts appear right after import
  });

  await step("Run analysis unlocks once sales data is in", async () => {
    await page.reload();
    await page.getByText("3134").first().waitFor();
    assert.ok(await page.getByRole("button", { name: "Run analysis" }).isEnabled());
  });

  await step("reviews CSV imports and AI tagging finishes", async () => {
    await sectionInput(page, "2. Customer reviews").setInputFiles(reviews);
    await page.getByText("rows found. Check which column holds what").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Confirm and import" }).click();
    await page.getByText("60 of 60 rows valid").waitFor({ timeout: 60_000 });
    // Wait on the real upload status (not page text): tagging is done when the reviews upload is "ready".
    const t0 = Date.now();
    for (;;) {
      const d = await api(`/api/projects/${projectId}`);
      const up = (d.uploads as { kind: string; status: string; stats?: { tagging?: string; tagged?: number } }[]).find((u) => u.kind === "reviews");
      if (up?.status === "ready" && up.stats?.tagging === "done") {
        assert.ok((up.stats.tagged ?? 0) > 0, "no reviews were tagged");
        break;
      }
      assert.ok(Date.now() - t0 < 120_000, `tagging did not finish (status ${up?.status}, tagging ${up?.stats?.tagging})`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  });

  await step("competitor document uploads, is indexed and searchable", async () => {
    await page.getByPlaceholder("Competitor name").fill("Rival Shop");
    await page.locator('section:has(h2:has-text("3. Competitor documents")) input[type=file]').setInputFiles(doc);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByText(/Added \d+ passages/).waitFor({ timeout: 120_000 });
    await page.getByPlaceholder("e.g. Who offers free shipping?").fill("What is the free shipping threshold?");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByText(/chunk:\d+/).first().waitFor({ timeout: 120_000 });
    assert.match(await page.locator("section:has(h2:has-text(\"4. Try the competitor search\"))").innerText(), /Rs 799/);
  });

  await step("competitor tracker: upload your format, columns auto-map, snapshots chart on the Competitors screen", async () => {
    await page.goto(`${BASE}/projects/${projectId}/data`);
    const tracker = path.join(tmp, "tracker.csv");
    writeFileSync(tracker, readFileSync("fixtures/competitor_tracker_sample.csv", "utf8"));
    await sectionInput(page, "Competitor tracking data").setInputFiles(tracker);
    await page.getByText("rows found. Check which column holds what").waitFor({ timeout: 60_000 });
    const selects = page.locator('section:has(h2:has-text("Competitor tracking data")) select');
    assert.equal(await selects.first().inputValue(), "snapshot_date", "snapshot_date should be pre-selected");
    await page.getByRole("button", { name: "Confirm and import" }).click();
    await page.getByText("42 of 42 rows valid").waitFor({ timeout: 180_000 });
    await page.getByText(/3 competitor products from 3 competitors/).waitFor();
    await page.goto(`${BASE}/projects/${projectId}/competitors`);
    await page.getByText(/tracked competitor products (is|are) cheaper now/).waitFor({ timeout: 30_000 });
    assert.ok((await page.locator("svg.recharts-surface").count()) > 0, "no tracker chart");
    await page.getByText("HomePro Oil Mister 500ml").first().waitFor();
    const d = await api(`/api/projects/${projectId}`);
    assert.ok(d.readiness.counts.chunks > 0, "tracker summaries were not indexed");
  });

  if (LIVE) {
    await step("LIVE: run a full analysis and open the report", async () => {
      await page.getByRole("button", { name: "Run analysis" }).click();
      await page.waitForURL(/\/analysis\/[0-9a-f-]{36}$/);
      await page.getByText("Open your workspace →").waitFor({ timeout: 480_000 });
      if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "analysis.png"), fullPage: true });
      await page.getByText("Printable report").click();
      await page.getByRole("heading", { name: /Growth report/ }).waitFor();
      if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "report.png") });
    });
  }

  // ---------- report, citations, plan on an existing finished analysis ----------
  let analysisId = "";
  await step("find a finished analysis to inspect", async () => {
    const projects = (await api("/api/projects")) as { id: string; name: string }[];
    for (const p of projects.filter((x) => x.name === "Acme Home (demo)" || x.name.startsWith("Sample"))) {
      const d = await api(`/api/projects/${p.id}`);
      const done = (d.analyses as { id: string; status: string }[]).find((a) => a.status === "done");
      if (done) { analysisId = done.id; break; }
    }
    assert.ok(analysisId, "no finished analysis found; run npm run eval:agent first");
  });

  let workspaceId = "";
  await step("workspace: every screen renders charts for a finished analysis, no NaN", async () => {
    workspaceId = (await api(`/api/analyses/${analysisId}/steps`)).analysis.projectId;
    const screens: [string, string, string][] = [["", "Overview", "Revenue by month"], ["/sales-price", "Sales & Price", "Price and units sold"], ["/customers", "Customers", "What unhappy customers mention"], ["/reviews", "Reviews", "Product decisions"], ["/competitors", "Competitors", "Comparison matrix"], ["/plan", "Action Plan", "Impact"]];
    for (const [route, title, marker] of screens) {
      await page.goto(`${BASE}/projects/${workspaceId}${route}`);
      await page.getByRole("heading", { name: title, exact: true }).first().waitFor({ timeout: 30_000 });
      await page.getByText(marker).first().waitFor();
      if (route !== "/competitors" && route !== "/plan") assert.ok((await page.locator("svg.recharts-surface").count()) > 0, `${title}: no chart rendered`);
      const text = await page.locator("main").innerText();
      assert.ok(!/undefined|NaN|\[object/.test(text), `${title} contains undefined/NaN text`);
    }
  });

  await step("price change on SKU-01 is detected and not described as causal", async () => {
    await page.goto(`${BASE}/projects/${workspaceId}/sales-price?sku=SKU-01`);
    await page.getByText(/Impact of the price change in/).waitFor({ timeout: 30_000 });
    const text = await page.locator("main").innerText();
    assert.match(text, /1,499 → 1,319/);
    assert.ok(!/caus(es|ed) the/i.test(text.replace("not what caused it", "")), "page must not claim causation");
  });

  await step("filters scope the charts: product filter changes the headline numbers", async () => {
    await page.goto(`${BASE}/projects/${workspaceId}`);
    await page.getByText("Revenue by month").waitFor({ timeout: 30_000 });
    const card = () => page.getByText(/^Revenue \(\w+\)$/).first().locator("xpath=..").innerText();
    const before = await card();
    await page.getByLabel("Product filter").selectOption("SKU-01");
    await page.waitForTimeout(500);
    assert.notEqual(before, await card(), "KPI cards did not react to the product filter");
  });

  await step("evidence drawer opens from a competitor claim and shows the source passage", async () => {
    await page.goto(`${BASE}/projects/${workspaceId}/competitors`);
    await page.getByRole("button", { name: /source \d+/ }).first().click();
    await page.getByRole("dialog", { name: "Evidence" }).waitFor();
    await page.getByText(/This is the passage from your uploaded competitor file/).waitFor({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "Evidence" }).count(), 0);
  });

  await step("plan board: moving an action to another week persists", async () => {
    await page.goto(`${BASE}/projects/${workspaceId}/plan`);
    const sel = page.getByLabel(/^Week for S\d/).first();
    await sel.waitFor({ timeout: 30_000 });
    const sid = (await sel.getAttribute("aria-label"))!.replace("Week for ", "");
    const target = (await sel.inputValue()) === "4" ? "3" : "4";
    await sel.selectOption(target);
    await page.getByText("✓ Saved").waitFor({ timeout: 15_000 });
    const saved = (await api(`/api/analyses/${analysisId}/plan`)).items.find((i: { solutionId: string }) => i.solutionId === sid);
    assert.equal(saved.week, Number(target));
    await page.reload();
    assert.equal(await page.getByLabel(`Week for ${sid}`).inputValue(), target);
  });

  await step("report renders all sections", async () => {
    await page.goto(`${BASE}/analysis/${analysisId}/report`);
    await page.getByRole("heading", { name: /Growth report/ }).waitFor();
    for (const h of ["Summary", "Where you stand today", "How you compare", "Problems holding you back", "Your 30-day plan", "How this report was checked"]) {
      await page.getByRole("heading", { name: new RegExp(h) }).waitFor();
    }
    const text = await page.locator("body").innerText();
    assert.ok(!/undefined|NaN|\[object/.test(text), "report contains undefined/NaN text");
  });

  await step("citation link jumps to its source passage", async () => {
    const link = page.locator('a[href^="#src-chunk-"]').first();
    const href = (await link.getAttribute("href"))!;
    await link.click();
    assert.ok(page.url().endsWith(href));
    await page.locator(href).waitFor();
    assert.ok(await page.locator(href).isVisible());
  });

  await step("plan editor: select top actions, owner, save, persists after reload", async () => {
    await page.getByRole("button", { name: "Select the top actions" }).click();
    const boxes = page.locator('section:has(h2:has-text("30-day plan")) input[type=checkbox]');
    const checked = await boxes.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length);
    assert.ok(checked >= 1, "top actions should be ticked");
    await page.locator('input[placeholder="Owner"]:not([disabled])').first().fill("E2E Owner");
    await page.getByRole("button", { name: /Save plan/ }).click();
    await page.getByText(/Saved\. We froze today/).waitFor();
    await page.reload();
    const after = await boxes.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length);
    assert.equal(after >= 1, true, "adopted actions must persist after reload");
    assert.equal(await page.locator('input[placeholder="Owner"]:not([disabled])').first().inputValue(), "E2E Owner");
  });

  if (LIVE) {
    await step("LIVE: the analyst chat answers from your data and shows its sources", async () => {
      await page.goto(`${BASE}/projects/${workspaceId}/sales-price?sku=SKU-01`);
      await page.getByRole("button", { name: "Ask the analyst" }).click();
      await page.getByLabel("Your question").fill("What was SKU-01's price in September?");
      await page.getByRole("button", { name: "Send" }).click();
      await page.getByRole("button", { name: /data: sku_trend/ }).first().waitFor({ timeout: 90_000 });
      assert.match(await page.locator("aside[aria-label='Ask the analyst']").innerText(), /1,?319/);
    });
  }

  await step("PDF download works", async () => {
    const r = await ctx.request.get(`${BASE}/api/analyses/${analysisId}/report.pdf`, { timeout: 120_000 });
    assert.equal(r.status(), 200);
    assert.match(r.headers()["content-type"], /pdf/);
    const body = await r.body();
    assert.equal(body.subarray(0, 4).toString(), "%PDF");
    assert.ok(body.length > 50_000, `PDF suspiciously small (${body.length} bytes)`);
  });

  await step("report and project pages fit a phone screen (no sideways scroll)", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [`${BASE}/analysis/${analysisId}/report`, `${BASE}/projects/${workspaceId}`, `${BASE}/projects/${workspaceId}/sales-price`, `${BASE}/projects/${workspaceId}/customers`, `${BASE}/projects/${workspaceId}/reviews`, `${BASE}/projects/${workspaceId}/competitors`, `${BASE}/projects/${workspaceId}/plan`, `${BASE}/projects/${workspaceId}/data`]) {
      await page.goto(url);
      await page.getByRole("heading").first().waitFor();
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${url} overflows by ${overflow}px`);
    }
    await page.setViewportSize({ width: 1200, height: 900 });
  });

  // ---------- limits and error states ----------
  await step("free-tier limit is shown and blocks Run analysis", async () => {
    const projects = (await api("/api/projects")) as { id: string; name: string }[];
    const demo = projects.find((p) => p.name === "Acme Home (demo)");
    assert.ok(demo, "demo project missing");
    await page.goto(`${BASE}/projects/${demo.id}/data`);
    await page.getByText(/You've used all \d+ free analyses/).waitFor();
    assert.ok(await page.getByRole("button", { name: "Run analysis" }).isDisabled());
  });

  await step("unknown project and report show friendly pages", async () => {
    await page.goto(`${BASE}/projects/00000000-0000-0000-0000-000000000000`);
    await page.getByText(/doesn't exist/).waitFor();
    await page.goto(`${BASE}/analysis/not-a-real-id/report`);
    await page.getByText("We couldn't find that").waitFor();
    const r = await authed("/api/projects/not-a-uuid");
    assert.equal(r.status, 404);
  });

  await step("delete my data removes the project", async () => {
    await page.goto(`${BASE}/projects/${projectId}/data`);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Delete project and all data" }).click();
    await page.waitForURL(`${BASE}/`);
    const projects = (await api("/api/projects")) as { id: string }[];
    assert.ok(!projects.some((p) => p.id === projectId), "project still listed after delete");
    assert.equal((await authed(`/api/projects/${projectId}`)).status, 404);
  });

  await step("signing out ends the session", async () => {
    await page.goto(BASE);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    assert.equal((await fetch(`${BASE}/api/projects`, { headers: { cookie: cookieHeader } })).status, 401, "old session cookie still works after signing out");
  });

  await step("no uncaught browser errors during the run", async () => {
    assert.deepEqual(consoleErrors, []);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed -> ${failed.length ? "FAIL" : "PASS"}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
