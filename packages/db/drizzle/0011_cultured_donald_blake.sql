CREATE TABLE "shadow_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"pass" text NOT NULL,
	"item_key" text NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"source" text,
	"claim" text,
	"label" text,
	"confidence" real,
	"model" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shadow_reviews" ADD CONSTRAINT "shadow_reviews_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shadow_reviews_chapter_pass_idx" ON "shadow_reviews" USING btree ("chapter_id","pass");