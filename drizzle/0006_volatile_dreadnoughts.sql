ALTER TABLE "products" ADD COLUMN "age_ranges" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "recommended_age" text;--> statement-breakpoint
CREATE INDEX "products_age_ranges_idx" ON "products" USING gin ("age_ranges");