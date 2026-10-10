import {
  pgTable, uuid, text, integer, numeric, timestamp, date, boolean, jsonb,
  vector, index, uniqueIndex, customType, primaryKey, bigserial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Single demo user for the MVP; every table hangs off a project.
/** Accounts: email + password (scrypt hash). No email verification in this version. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Login sessions. Only a SHA-256 of the random cookie token is stored, so a database leak cannot be replayed. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/** One-time password reset links. Only a SHA-256 of the emailed token is stored; a link works once and expires after an hour. */
export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("password_resets_user_idx").on(t.userId)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Owner. Null only for projects created before accounts existed; the first account to sign up adopts them. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  goal: text("goal", { enum: ["revenue", "rating", "margin"] }).notNull().default("revenue"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["sales", "reviews", "customers", "competitor_doc", "competitor_tracker", "ads"] }).notNull(),
  status: text("status", { enum: ["uploaded", "mapped", "processing", "ready", "failed"] }).notNull().default("uploaded"),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  mapping: jsonb("mapping"),
  stats: jsonb("stats"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** The original uploaded file (CSV, Excel, PDF, text), kept in Postgres so uploads survive on serverless hosts with no disk. */
export const uploadFiles = pgTable("upload_files", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sales = pgTable("sales", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  orderDate: date("order_date").notNull(),
  sku: text("sku").notNull(),
  units: integer("units").notNull(),
  revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull(),
  price: numeric("price", { precision: 12, scale: 2 }),
  returned: boolean("returned").default(false),
  customerHash: text("customer_hash"),
}, (t) => [index("sales_project_date_idx").on(t.projectId, t.orderDate)]);

export const reviews = pgTable("reviews", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reviewDate: date("review_date").notNull(),
  sku: text("sku"),
  rating: integer("rating").notNull(),
  body: text("body").notNull(),
  topics: text("topics").array(),
  sentiment: text("sentiment"),
}, (t) => [index("reviews_project_idx").on(t.projectId, t.reviewDate)]);

export const customers = pgTable("customers", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  customerHash: text("customer_hash").notNull(),
  orders: integer("orders").notNull(),
  firstOrder: date("first_order"),
  lastOrder: date("last_order"),
  segment: text("segment"),
}, (t) => [primaryKey({ columns: [t.projectId, t.customerHash] })]);

export const competitors = pgTable("competitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

/** Competitor price/promo/stock/review snapshots over time (one row per competitor product per snapshot date). */
export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  competitorId: uuid("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
  snapshotDate: date("snapshot_date").notNull(),
  product: text("product").notNull(),
  category: text("category"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  discountApplied: boolean("discount_applied"),
  rating: numeric("rating", { precision: 3, scale: 2 }),
  totalReviews: integer("total_reviews"),
  newReviews: integer("new_reviews"),
  stockStatus: text("stock_status"),
  promo: text("promo"),
  dataType: text("data_type"),
  /** Which of the seller's SKUs this competitor product competes with (optional, set by the seller). */
  comparableSku: text("comparable_sku"),
}, (t) => [
  uniqueIndex("comp_snap_uq").on(t.projectId, t.competitorId, t.product, t.snapshotDate),
  index("comp_snap_project_idx").on(t.projectId, t.snapshotDate),
]);

/** Advertising report rows: one per day, SKU and campaign. Re-uploading the same day, SKU and campaign replaces the row. */
export const adDaily = pgTable("ad_daily", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
  day: date("day").notNull(),
  sku: text("sku").notNull(),
  campaign: text("campaign").notNull().default(""),
  productName: text("product_name"),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  spend: numeric("spend", { precision: 14, scale: 2 }).notNull(),
  orders: integer("orders").notNull().default(0),
  units: integer("units").notNull().default(0),
  adSales: numeric("ad_sales", { precision: 14, scale: 2 }).notNull(),
}, (t) => [
  uniqueIndex("ad_daily_uq").on(t.projectId, t.day, t.sku, t.campaign),
  index("ad_daily_project_idx").on(t.projectId, t.day),
]);

/** Profit per unit the seller earns on a SKU BEFORE paying for ads (entered on screen). It sets the break-even ad cost. */
export const skuProfit = pgTable("sku_profit", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  unitProfit: numeric("unit_profit", { precision: 12, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.sku] })]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  competitorId: uuid("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  docType: text("doc_type", { enum: ["pdf", "csv", "text"] }).notNull(),
  docDate: date("doc_date"),
});

export const chunks = pgTable("chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  page: integer("page"),
  metadata: jsonb("metadata"),
  embedding: vector("embedding", { dimensions: 1024 }),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', content)`),
}, (t) => [
  index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("chunks_tsv_idx").using("gin", t.tsv),
  index("chunks_project_idx").on(t.projectId),
]);

export const analyses = pgTable("analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull().default("queued"),
  currentStep: integer("current_step").default(0),
  model: text("model"),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  costUsd: numeric("cost_usd", { precision: 8, scale: 4 }).default("0"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export const analysisSteps = pgTable("analysis_steps", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  stepNo: integer("step_no").notNull(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
  output: jsonb("output"),
  citations: jsonb("citations"),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  durationMs: integer("duration_ms"),
});

// Source of truth for streaming: SSE replays from here (Last-Event-ID = seq).
export const analysisEvents = pgTable("analysis_events", {
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.analysisId, t.seq] })]);

export const chatMessages = pgTable("chat_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const actionPlanItems = pgTable("action_plan_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  recommendationId: text("recommendation_id").notNull(),
  adopted: boolean("adopted").default(false),
  owner: text("owner"),
  dueDate: date("due_date"),
  /** Week (1-4) the seller scheduled this action in; null = use the AI's suggested week. */
  week: integer("week"),
  baseline: jsonb("baseline"),
});
