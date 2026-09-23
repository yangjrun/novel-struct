CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "scene_embeddings" (
	"scene_id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scene_embeddings" ADD CONSTRAINT "scene_embeddings_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_embeddings" ADD CONSTRAINT "scene_embeddings_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_embeddings" ADD CONSTRAINT "scene_embeddings_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_embeddings_book_model_idx" ON "scene_embeddings" USING btree ("book_id","model");--> statement-breakpoint
CREATE INDEX "scene_embeddings_cosine_idx" ON "scene_embeddings" USING hnsw ("embedding" vector_cosine_ops);
