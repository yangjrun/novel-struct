CREATE TABLE "voice_profiles" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"provider" text NOT NULL,
	"voice_id" text NOT NULL,
	"params" text
);
--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_profiles_book_idx" ON "voice_profiles" USING btree ("book_id");