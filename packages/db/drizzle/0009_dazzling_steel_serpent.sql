CREATE TABLE "memory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"room" text NOT NULL,
	"entity_id" text,
	"content" text NOT NULL,
	"valid_from_chapter_id" text NOT NULL,
	"valid_to_chapter_id" text,
	"source_fact_table" text NOT NULL,
	"source_fact_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_valid_from_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_from_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_valid_to_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_to_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_items_book_room_idx" ON "memory_items" USING btree ("book_id","edition_id","room");