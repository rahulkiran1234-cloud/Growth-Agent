CREATE TABLE "ad_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"upload_id" uuid,
	"day" date NOT NULL,
	"sku" text NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"product_name" text,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_profit" (
	"project_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"unit_profit" numeric(12, 2) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sku_profit_project_id_sku_pk" PRIMARY KEY("project_id","sku")
);
--> statement-breakpoint
ALTER TABLE "ad_daily" ADD CONSTRAINT "ad_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_daily" ADD CONSTRAINT "ad_daily_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_profit" ADD CONSTRAINT "sku_profit_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_daily_uq" ON "ad_daily" USING btree ("project_id","day","sku","campaign");--> statement-breakpoint
CREATE INDEX "ad_daily_project_idx" ON "ad_daily" USING btree ("project_id","day");