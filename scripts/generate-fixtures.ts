// Generates "Acme Home", a synthetic seller with PLANTED problems (see fixtures/expected.md).
// Deterministic: same output every run. Run: npm run fixtures
import { mkdirSync, writeFileSync } from "node:fs";

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");

mkdirSync("fixtures", { recursive: true });

// 38 SKUs. SKU-01..03 = top sellers (the "problem" SKUs).
const skus = Array.from({ length: 38 }, (_, i) => {
  const id = `SKU-${String(i + 1).padStart(2, "0")}`;
  const price = i < 3 ? [1499, 1299, 999][i] : 300 + Math.round(rnd() * 1200);
  const weight = i < 3 ? 12 : 1 + rnd() * 2;
  return { id, price, weight };
});
const totalW = skus.reduce((s, k) => s + k.weight, 0);
const pickSku = () => {
  let r = rnd() * totalW;
  for (const k of skus) if ((r -= k.weight) <= 0) return k;
  return skus[0];
};

const start = new Date("2026-04-01");
const days = 183; // Apr 1 - Sep 30
const fmt = (d: Date) => d.toISOString().slice(0, 10);

// SALES — PLANTED #1: from Aug 1, top-3 SKU volume drops ~35% and avg realised price falls (discounting) -> revenue down, units not.
// PLANTED #2: returns on top-3 SKUs ~18% (sizing) vs ~5% elsewhere.
const sales: (string | number)[][] = [["order_date", "order_id", "sku", "units", "price", "revenue", "returned", "customer_id"]];
let orderId = 1000;
for (let d = 0; d < days; d++) {
  const date = new Date(start.getTime() + d * 864e5);
  const late = date >= new Date("2026-08-01");
  const n = Math.round(14 + rnd() * 8);
  for (let i = 0; i < n; i++) {
    const k = pickSku();
    const top = k.id <= "SKU-03";
    if (late && top && rnd() < 0.35) continue; // volume drop on top SKUs
    const units = 1 + Math.floor(rnd() * 2);
    const price = late && top ? Math.round(k.price * 0.88) : k.price; // unplanned self-discounting
    const returned = rnd() < (top ? 0.18 : 0.05) ? 1 : 0;
    const cust = `C${String(1 + Math.floor(rnd() * (rnd() < 0.2 ? 150 : 900))).padStart(4, "0")}`;
    sales.push([fmt(date), orderId++, k.id, units, price, units * price, returned, cust]);
  }
}
writeFileSync("fixtures/acme_sales.csv", csv(sales));

// REVIEWS — PLANTED #3: ~30% of 1-3 star reviews mention sizing; ~15% packaging damage.
const sizing = ["Runs small, had to return.", "Size chart is wrong, way too small.", "Ordered my usual size and it didn't fit.", "Much smaller than expected, no size guide."];
const packaging = ["Arrived damaged, box was crushed.", "Packaging was poor, item scratched.", "Broken seal and dented box on arrival."];
const other = ["Average quality for the price.", "Delivery was slow.", "Colour differs from photos.", "Okay but not great.", "Customer support never replied."];
const good = ["Great quality, love it!", "Value for money.", "Looks premium and works well.", "Fast delivery, happy with it.", "Exactly as described."];
const reviews: (string | number)[][] = [["review_date", "sku", "rating", "text"]];
for (let i = 0; i < 2500; i++) {
  const date = fmt(new Date(start.getTime() + Math.floor(rnd() * days) * 864e5));
  const k = rnd() < 0.5 ? skus[Math.floor(rnd() * 3)] : pickSku();
  const late = date >= "2026-07-01";
  const lowP = (k.id <= "SKU-03" ? 0.34 : 0.14) + (late ? 0.06 : 0);
  if (rnd() < lowP) {
    const r = rnd();
    const text = r < 0.3 ? pick(sizing) : r < 0.45 ? pick(packaging) : pick(other);
    reviews.push([date, k.id, 1 + Math.floor(rnd() * 3), text]);
  } else {
    reviews.push([date, k.id, 4 + Math.floor(rnd() * 2), pick(good)]);
  }
}
writeFileSync("fixtures/acme_reviews.csv", csv(reviews));

// COMPETITOR A — PLANTED #4: undercuts Acme by ~12% on top SKUs (price sheet CSV).
const compA: (string | number)[][] = [["product", "comparable_to", "price", "rating", "free_shipping_over"]];
skus.slice(0, 12).forEach((k, i) => compA.push([`BrightNest ${["Lamp", "Rug", "Cushion", "Vase", "Shelf", "Mat"][i % 6]} ${i + 1}`, k.id, Math.round(k.price * (i < 3 ? 0.88 : 0.99)), (4.2 + rnd() * 0.5).toFixed(1), 999]));
writeFileSync("fixtures/competitor_brightnest_prices.csv", csv(compA));

// COMPETITOR B — PLANTED #5/#6: offers size guide + free shipping above Rs 999 (text doc standing in for a PDF catalogue).
writeFileSync(
  "fixtures/competitor_urbanhaus_catalogue.txt",
  `URBANHAUS HOME - 2026 AUTUMN CATALOGUE
Date: 2026-09-12

PAGE 1 - WHY URBANHAUS
Every product ships with a printed size guide and a true-to-size promise. If it doesn't fit, returns are free within 30 days.

PAGE 2 - SHIPPING
Free shipping on all orders above Rs 999. Orders are packed in double-wall cartons with corner guards; damage rate below 1%.

PAGE 3 - PRICING
Cushion sets from Rs 1,099. Lamps from Rs 1,349. Rugs from Rs 1,249. Everyday low price, no seasonal discounting.

PAGE 4 - REVIEWS SNAPSHOT
Average rating 4.5 (1,820 reviews). Most-praised: fit accuracy, packaging, fast dispatch. Most common complaint: limited colour range.
`,
);

writeFileSync(
  "fixtures/expected.md",
  `# Planted problems (acceptance checklist for the agent)

1. Revenue on SKU-01..03 fell from Aug 1; self-discounting (~12% lower realised price) with fewer units.
2. SKU-01..03 return rate ~18% vs ~5% elsewhere.
3. ~30% of 1-3 star reviews cite sizing ("runs small", wrong size chart); ~15% cite packaging damage.
4. BrightNest undercuts Acme by ~12% on the top SKUs (competitor price CSV).
5. UrbanHaus provides a size guide + true-to-size promise (competitor catalogue p.1).
6. UrbanHaus offers free shipping above Rs 999 and double-wall packaging (<1% damage) (p.2).

Pass = agent surfaces >= 80% of these, each with a citation or metric reference; no fabricated numbers.
`,
);

console.log(`sales rows: ${sales.length - 1}, reviews: ${reviews.length - 1}`);
