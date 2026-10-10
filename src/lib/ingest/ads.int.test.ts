// Ads storage, the ads/sales join and the advice, against a real database (npm run test:int). Creates two throw-away
// projects and deletes them afterwards. No account, login or AI call is involved.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/lib/db/client";
import { cloneProject } from "@/lib/projects";
import { autoMap } from "./columns";
import { readTable } from "./table";
import { processAds } from "./ads-parse";
import { processSales } from "./validate";
import { adAdvice, loadAdDays, loadUnitProfit, storeAdRows } from "./ads";

let A = "", B = "", C = "";
let adRecords: ReturnType<typeof processAds>["records"] = [];

beforeAll(async () => {
  [A, B] = await Promise.all([db.insert(schema.projects).values({ name: "ads-test A" }).returning(), db.insert(schema.projects).values({ name: "ads-test B" }).returning()]).then((r) => r.map((x) => x[0].id));
  const ads = await readTable(readFileSync("fixtures/ads_sample.csv"), "ads.csv");
  adRecords = processAds(ads.rows, ads.headers, autoMap("ads", ads.headers)).records;
  const s = await readTable(readFileSync("fixtures/acme_sales.csv"), "sales.csv");
  const sales = processSales(s.rows, s.headers, autoMap("sales", s.headers)).records;
  for (let i = 0; i < sales.length; i += 1000) {
    await db.insert(schema.sales).values(sales.slice(i, i + 1000).map((r) => ({ projectId: A, orderDate: r.orderDate, sku: r.sku, units: r.units, revenue: r.revenue.toFixed(2), price: r.price.toFixed(2), returned: r.returned, customerHash: r.customerHash })));
  }
});
afterAll(async () => {
  for (const id of [A, B, C]) if (id) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await pool.end();
});

describe("ads storage and advice", () => {
  it("the sample file parses cleanly", () => {
    expect(adRecords).toHaveLength(1012);
  });

  it("stores the rows and returns one line per day and SKU, joined to sales", async () => {
    expect(await storeAdRows(A, null, adRecords)).toBe(1012);
    const { days, campaigns } = await loadAdDays(A);
    expect(campaigns).toBe(2);
    const withBoth = days.filter((d) => d.spend > 0 && d.rev > 0);
    expect(withBoth.length).toBeGreaterThan(100);       // ads days that also have sales that day
    const total = days.reduce((a, d) => a + d.spend, 0);
    expect(total).toBeCloseTo(adRecords.reduce((a, r) => a + r.spend, 0), 0);
  });

  it("re-uploading the same file updates rows instead of duplicating them", async () => {
    await storeAdRows(A, null, adRecords);
    const rows = await db.select().from(schema.adDaily).where(eq(schema.adDaily.projectId, A));
    expect(rows).toHaveLength(1012);
    const changed = adRecords.map((r, i) => (i === 0 ? { ...r, spend: 999 } : r));
    await storeAdRows(A, null, changed);
    const first = (await db.select().from(schema.adDaily).where(eq(schema.adDaily.projectId, A))).find((r) => r.day === adRecords[0].date && r.sku === adRecords[0].sku && r.campaign === adRecords[0].campaign)!;
    expect(Number(first.spend)).toBe(999);
    await storeAdRows(A, null, adRecords); // put it back
  });

  it("gives every SKU a verdict, with reasons and a plan that never grows the budget", async () => {
    const m = (await adAdvice(A))!;
    expect(m.skus.map((s) => s.sku).sort()).toEqual(["SKU-01", "SKU-02", "SKU-03", "SKU-10", "SKU-12", "SKU-13", "SKU-20", "SKU-35"]);
    expect(m.skus.every((s) => s.reasons.length > 0)).toBe(true);
    expect(m.plan.dailyNext).toBeLessThanOrEqual(m.plan.dailyNow + 1e-6);
    expect(m.totals.tacos).not.toBeNull();               // sales were joined, so total sales exist
    expect(m.missingProfit.length).toBe(m.skus.length);  // nothing entered yet: all margins are assumed
    const bySku = Object.fromEntries(m.skus.map((s) => [s.sku, s]));
    expect(bySku["SKU-12"].verdict).toBe("fix_first");   // lots of clicks, almost nobody buys
    expect(bySku["SKU-13"].verdict).toBe("too_little");  // barely any clicks
    expect(["scale", "hold"]).toContain(bySku["SKU-01"].verdict);
  });

  it("a profit per unit entered by the seller changes the break-even and the advice", async () => {
    const before = (await adAdvice(A))!.skus.find((s) => s.sku === "SKU-02")!;
    await db.insert(schema.skuProfit).values({ projectId: A, sku: "SKU-02", unitProfit: "1" });
    expect(await loadUnitProfit(A)).toEqual({ "SKU-02": 1 });
    const after = (await adAdvice(A))!.skus.find((s) => s.sku === "SKU-02")!;
    expect(after.profitSource).toBe("entered");
    expect(after.breakEvenAcos!).toBeLessThan(before.breakEvenAcos!);
    expect(after.verdict).toBe("cut");                   // 1 profit on a ~1,260 item cannot pay for ads at ~27% ACOS
    await db.delete(schema.skuProfit).where(eq(schema.skuProfit.projectId, A));
  });

  it("never shows one project's ads in another", async () => {
    expect(await adAdvice(B)).toBeNull();
    expect((await loadAdDays(B)).days).toEqual([]);
  });

  it("copying a project copies its ads and profit entries", async () => {
    await db.insert(schema.skuProfit).values({ projectId: A, sku: "SKU-01", unitProfit: "400" });
    C = await cloneProject(A, "ads-test clone");
    const rows = await db.select().from(schema.adDaily).where(eq(schema.adDaily.projectId, C));
    expect(rows).toHaveLength(1012);
    expect(await loadUnitProfit(C)).toEqual({ "SKU-01": 400 });
  });
});
