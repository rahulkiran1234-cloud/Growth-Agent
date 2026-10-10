CREATE TABLE "competitor_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"upload_id" uuid,
	"snapshot_date" date NOT NULL,
	"product" text NOT NULL,
	"category" text,
	"price" numeric(12, 2) NOT NULL,
	"discount_applied" boolean,
	"rating" numeric(3, 2),
	"total_reviews" integer,
	"new_reviews" integer,
	"stock_status" text,
	"promo" text,
	"data_type" text,
	"comparable_sku" text
);
--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comp_snap_uq" ON "competitor_snapshots" USING btree ("project_id","competitor_id","product","snapshot_date");--> statement-breakpoint
CREATE INDEX "comp_snap_project_idx" ON "competitor_snapshots" USING btree ("project_id","snapshot_date");