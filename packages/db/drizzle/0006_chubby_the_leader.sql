CREATE TABLE "weknora_documents" (
	"chapter_id" text PRIMARY KEY NOT NULL,
	"knowledge_id" text NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weknora_knowledge_bases" (
	"edition_id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weknora_documents" ADD CONSTRAINT "weknora_documents_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weknora_knowledge_bases" ADD CONSTRAINT "weknora_knowledge_bases_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;