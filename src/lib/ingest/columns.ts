// Canonical columns for generic (marketplace-agnostic) CSV uploads + header auto-mapping.
export type CsvKind = "sales" | "reviews" | "competitor_tracker" | "ads";

type FieldDef = { label: string; required: boolean; synonyms: string[] };

export const FIELDS: Record<CsvKind, Record<string, FieldDef>> = {
  sales: {
    order_date: { label: "Order date", required: true, synonyms: ["orderdate", "date", "purchasedate", "orderedat", "createdat", "saledate", "day", "orderplaced", "transactiondate"] },
    sku: { label: "SKU / product id", required: true, synonyms: ["sku", "productid", "itemid", "product", "asin", "listingid", "sellersku", "fsn", "itemsku"] },
    units: { label: "Units / quantity (optional, defaults to 1)", required: false, synonyms: ["units", "quantity", "qty", "unitssold", "quantityordered", "unitsordered"] },
    revenue: { label: "Revenue / order total", required: false, synonyms: ["revenue", "sales", "total", "amount", "ordervalue", "gmv", "itemtotal", "totalprice", "orderamount", "lineamount", "ordertotal"] },
    price: { label: "Unit price", required: false, synonyms: ["price", "unitprice", "sellingprice", "itemprice", "saleprice", "priceperunit"] },
    returned: { label: "Returned flag (optional)", required: false, synonyms: ["returned", "isreturned", "return", "refunded", "returnflag", "returnstatus"] },
    customer_id: { label: "Customer id (optional, hashed on import)", required: false, synonyms: ["customerid", "customer", "buyerid", "custid", "userid", "buyer", "customerhash"] },
  },
  reviews: {
    review_date: { label: "Review date", required: true, synonyms: ["reviewdate", "date", "createdat", "reviewedat", "postedon", "submittedat"] },
    rating: { label: "Star rating (1-5)", required: true, synonyms: ["rating", "stars", "score", "starrating", "reviewrating"] },
    body: { label: "Review text", required: true, synonyms: ["text", "review", "reviewtext", "body", "comment", "content", "reviewbody", "comments"] },
    sku: { label: "SKU / product id (optional)", required: false, synonyms: ["sku", "productid", "asin", "itemid", "product", "fsn"] },
  },
  competitor_tracker: {
    snapshot_date: { label: "Snapshot date", required: true, synonyms: ["snapshotdate", "date", "scrapedat", "capturedat", "observedon", "recordedon", "asof", "day", "checkedon"] },
    competitor: { label: "Competitor name", required: true, synonyms: ["competitor", "competitorname", "competitorid", "seller", "sellername", "brand", "store", "retailer"] },
    product: { label: "Competitor product name", required: true, synonyms: ["competitorproductname", "competitorproduct", "productname", "product", "title", "item", "itemname", "listing"] },
    price: { label: "Listed price", required: true, synonyms: ["listedprice", "price", "currentprice", "sellingprice", "saleprice", "mrp", "listprice"] },
    category: { label: "Category (optional)", required: false, synonyms: ["category", "segment", "department", "producttype"] },
    discount_applied: { label: "Discount applied, TRUE/FALSE (optional)", required: false, synonyms: ["discountapplied", "discount", "ondiscount", "onsale", "isdiscounted", "discounted"] },
    rating: { label: "Rating (optional)", required: false, synonyms: ["rating", "avgrating", "averagerating", "stars", "score"] },
    total_reviews: { label: "Total reviews (optional)", required: false, synonyms: ["totalreviews", "reviews", "reviewcount", "numreviews", "ratingscount", "reviewstotal"] },
    new_reviews: { label: "New reviews since last snapshot (optional)", required: false, synonyms: ["newreviews", "reviewsadded", "newratings", "reviewdelta", "reviewssincelast"] },
    stock_status: { label: "Stock status (optional)", required: false, synonyms: ["estimatedstockstatus", "stockstatus", "stock", "availability", "instock", "inventorystatus"] },
    promo: { label: "Badge or promotion (optional)", required: false, synonyms: ["badgeorpromo", "badge", "promo", "promotion", "offer", "deal", "badges"] },
    data_type: { label: "Data type or source (optional)", required: false, synonyms: ["datatype", "source", "type", "datasource"] },
    comparable_sku: { label: "Your comparable SKU (optional)", required: false, synonyms: ["comparablesku", "comparableto", "mysku", "matchedsku", "yoursku", "ourproduct"] },
  },
  ads: {
    date: { label: "Date", required: true, synonyms: ["date", "day", "reportdate", "adsdate", "startdate", "reportingdate"] },
    sku: { label: "SKU", required: true, synonyms: ["sku", "sellersku", "advertisedsku", "itemsku", "asin", "advertisedasin", "fsn", "productid", "listingid"] },
    campaign: { label: "Campaign (optional, defaults to one campaign)", required: false, synonyms: ["campaign", "campaignname", "campaignid", "adgroup", "adgroupname"] },
    spend: { label: "Ad spend", required: true, synonyms: ["spend", "adspend", "amountspent", "spendinr", "totalspend", "adcost", "totalcost"] },
    ad_sales: { label: "Sales from ads", required: true, synonyms: ["adsalesinr", "adsales", "sales", "salesattributed", "attributedsales", "salesattributedinr", "adrevenue", "totalrevenue", "sales7d", "sales14d"] },
    product_name: { label: "Product name (optional)", required: false, synonyms: ["productname", "title", "itemname", "advertisedproduct", "producttitle"] },
    impressions: { label: "Impressions (optional)", required: false, synonyms: ["impressions", "views", "adimpressions"] },
    clicks: { label: "Clicks (optional)", required: false, synonyms: ["clicks", "adclicks"] },
    ad_orders: { label: "Orders from ads (optional)", required: false, synonyms: ["adordersinr", "orders", "ordersattributed", "attributedorders", "adorders", "purchases", "orders7d", "orders14d"] },
    ad_units: { label: "Units sold from ads (optional)", required: false, synonyms: ["adunitsinr", "unitssold", "adunitssold", "attributedunits"] }, // not bare "units": that is usually total units, not ad units
  },
};

export type Mapping = Record<string, string | null>;

export const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function autoMap(kind: CsvKind, headers: string[]): Mapping {
  const fields = FIELDS[kind];
  const mapping: Mapping = Object.fromEntries(Object.keys(fields).map((f) => [f, null]));
  const used = new Set<string>();
  const normed = headers.map((h) => ({ h, n: norm(h) }));

  // Pass 1: exact match on a synonym or the field name itself. Pass 2: loose "contains" match.
  for (const pass of [1, 2]) {
    for (const [field, def] of Object.entries(fields)) {
      if (mapping[field]) continue;
      const syns = [norm(field), ...def.synonyms];
      // Pass 1 prefers the more specific name: the field's own name, then synonyms in the order listed ("ad_orders" before "orders").
      const hit = pass === 1
        ? syns.map((syn) => normed.find(({ h, n }) => !used.has(h) && n === syn)).find(Boolean)
        : normed.find(({ h, n }) => !used.has(h) && n.length > 0 && syns.some((s) => s.length >= 4 && n.includes(s)));
      if (hit) {
        mapping[field] = hit.h;
        used.add(hit.h);
      }
    }
  }
  return mapping;
}

/** Human-readable problems that stop the mapping from being usable. */
export function missingRequired(kind: CsvKind, mapping: Mapping): string[] {
  const out: string[] = [];
  for (const [field, def] of Object.entries(FIELDS[kind])) {
    if (def.required && !mapping[field]) out.push(def.label);
  }
  if (kind === "sales" && !mapping.revenue && !mapping.price) out.push("Revenue or unit price (at least one)");
  return out;
}
