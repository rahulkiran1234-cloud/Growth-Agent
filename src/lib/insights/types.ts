// Chart-ready data for the workspace UI. Everything here is computed by SQL/code from the seller's data,
// never by the model. Arrays are aligned to `months` so the browser can filter by period and product cheaply.
export type SkuSeries = { sku: string; revenue: number[]; units: number[]; orders: number[]; returned: number[] };

/** Reviews aggregated by (month, sku). `t` counts topic tags on 1-3 star reviews only. */
export type ReviewRow = {
  m: number; sku: string | null; n: number; rs: number; low: number; tagged: number; t: Record<string, number>;
  /** 4-5 star reviews, and how many of them match each praise keyword bucket. */
  posN: number; pos: Record<string, number>;
};

export type Quote = { rating: number; date: string; sku: string | null; text: string };

export type Insights = {
  months: string[];
  skus: SkuSeries[];
  reviewRows: ReviewRow[];
  quotes: Record<string, Quote[]>;
  /** Recent distinct 5-star reviews with some substance. */
  praise: Quote[];
  dataThrough: { sales: string | null; reviews: string | null };
  counts: { sales: number; reviews: number; skus: number };
};

/** One row per month for the current filter. Rates are null when there is no data for that month. */
export type MonthPoint = {
  month: string; revenue: number; units: number; orders: number; price: number | null; returnRate: number | null;
  reviews: number; avgRating: number | null; lowPct: number | null;
};

export type PriceEvent = {
  month: string; index: number; priceBefore: number; priceAfter: number; pricePct: number;
  unitsBefore: number; unitsAfter: number; unitsPct: number | null; revenueBefore: number; revenueAfter: number; revenuePct: number | null;
  monthsBefore: number; monthsAfter: number;
  elasticity: number | null; confidence: "low" | "medium" | null;
};
