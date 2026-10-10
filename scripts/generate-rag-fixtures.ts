// Extra competitor documents + 18 evaluation questions for the retrieval test (npm run eval:rag).
import { writeFileSync } from "node:fs";

const pages = (title: string, date: string, items: string[]) =>
  `${title}\nDate: ${date}\n\n` + items.map((t, i) => `PAGE ${i + 1} - ${t.split("\n")[0]}\n${t.split("\n").slice(1).join("\n")}`).join("\n\n") + "\n";

writeFileSync(
  "fixtures/competitor_nestco_catalogue.txt",
  pages("NESTCO HOME - 2026 CATALOGUE", "2026-08-20", [
    "ABOUT NESTCO\nFounded in 2012 in Pune, NestCo runs three warehouses and stocks about 450 products across home decor, lighting and soft furnishings.",
    "WARRANTY\nAll lamps and electrical items carry a 2-year warranty. Textiles carry a 6-month warranty. Claims are filed in the app and a replacement is shipped within 7 days.",
    "RETURNS\nNestCo offers 15-day returns. The customer pays return shipping unless the item is defective. Refunds are issued in 5-7 business days after the item is received.",
    "DELIVERY\nMetro cities receive orders in 2 days; the rest of India in 5-7 days. Same-day delivery is available in Pune and Mumbai for orders placed before 11am. Shipping costs Rs 79 on orders under Rs 799.",
    "PRICING\nCushion sets from Rs 949, rugs from Rs 1,199 and lamps from Rs 1,299. A price-match guarantee covers any lower price found within 7 days of purchase.",
    "MATERIALS AND SUSTAINABILITY\nProducts use recycled cotton and FSC-certified wood. NestCo has shipped in plastic-free packaging since 2025.",
    "LOYALTY PROGRAMME\nNestClub members earn 1 point per Rs 100 spent. 500 points are worth Rs 50 off. Members get a 10% birthday discount.",
    "FESTIVE OFFERS\nThe Diwali sale runs 20-26 October with flat 25% off on rugs. A bundle of 3 cushions is Rs 2,499.",
    "CUSTOMER SUPPORT\nWhatsApp support is open 9am to 9pm. Average first response time is 4 minutes and CSAT is 4.6 out of 5.",
    "REVIEWS SNAPSHOT\nAverage rating 4.3 across 3,100 reviews. Most praised: colour accuracy. Most common complaint: delayed delivery to rural pin codes.",
    "SIZING AND DIMENSIONS\nRugs come in 3x5, 5x7 and 6x9 ft. Cushion covers come in 16, 18 and 20 inch. Every listing includes a measuring video.",
    "BULK AND CORPORATE\nOrders above 50 units receive a 12% discount. Corporate gifting packs can be customised with a logo.",
  ]),
);

writeFileSync(
  "fixtures/competitor_brightnest_policies.txt",
  pages("BRIGHTNEST - SELLER POLICIES AND PERFORMANCE", "2026-09-05", [
    "PRICING POLICY\nBrightNest drops prices on its top sellers every week. Its stated promise is to stay 10% under the leading marketplace listing at all times.",
    "SHIPPING\nFree shipping on orders above Rs 999. Standard delivery takes 3-5 days. Express delivery costs Rs 149.",
    "RETURNS AND EXCHANGES\nBrightNest allows 7-day returns with free pickup. Size issues can be exchanged within 10 days.",
    "QUALITY CONTROL\nEvery item passes 3 inspection checkpoints. The reported defect rate is 2.1%.",
    "PACKAGING\nItems ship in standard cartons with bubble wrap only. Damage claims run at 3.8% of orders.",
    "MARKETING\nBrightNest spends heavily on Instagram influencers. About 30% of its sales come from sponsored placements.",
    "REVIEWS SNAPSHOT\nAverage rating 4.2 across 2,400 reviews. Most praised: low prices. Most common complaints: thin material and packaging damage.",
    "STOCK AND PROMOTIONS\nThe in-stock rate is 94%. Flash sales run every Friday at 6pm.",
  ]),
);

// Each question lists acceptable evidence: a chunk counts as correct if it matches `regex`
// (and belongs to `competitor` when given). Several are paraphrases that share few exact words
// with the source, so pure keyword search should struggle and pure vector search should shine.
const q = (question: string, regex: string, competitor?: string) => ({ question, regex, competitor });
writeFileSync(
  "fixtures/rag-eval.json",
  JSON.stringify(
    [
      q("Who promises a true-to-size fit and free returns when something doesn't fit?", "true-to-size", "UrbanHaus"),
      q("What is the free shipping threshold at UrbanHaus?", "Free shipping on all orders above Rs 999", "UrbanHaus"),
      q("Which competitor gives the longest warranty on lamps?", "2-year warranty", "NestCo"),
      q("Can I get my order delivered the same day?", "Same-day delivery", "NestCo"),
      q("How quickly will I get my money back after a return?", "Refunds are issued in 5-7", "NestCo"),
      q("What do NestCo rugs cost?", "rugs from Rs 1,199", "NestCo"),
      q("Does anyone use packaging without plastic?", "plastic-free packaging", "NestCo"),
      q("How does the points reward scheme work?", "1 point per Rs 100", "NestCo"),
      q("When is the Diwali sale?", "Diwali sale runs 20-26 October", "NestCo"),
      q("How fast does WhatsApp support reply?", "first response time is 4 minutes", "NestCo"),
      q("What do customers dislike about BrightNest products?", "thin material", "BrightNest"),
      q("Which competitor has the highest rate of damaged parcels?", "Damage claims run at 3.8%", "BrightNest"),
      q("Is there a discount for buying many units at once?", "12% discount", "NestCo"),
      q("How often does BrightNest hold flash sales?", "Flash sales run every Friday", "BrightNest"),
      q("Which competitor says it will always undercut the big marketplace price?", "10% under the leading marketplace", "BrightNest"),
      // Exact identifiers: where keyword matching should earn its place.
      q("What does the BrightNest listing comparable to SKU-02 cost?", "comparable_to: SKU-02", "BrightNest"),
      q("Which competitor charges shipping below Rs 799?", "Rs 799", "NestCo"),
      q("BrightNest Cushion 3 price", "BrightNest Cushion 3", "BrightNest"),
    ],
    null,
    2,
  ),
);
console.log("wrote nestco + brightnest docs and rag-eval.json (18 questions)");
