CREATE TABLE "book_locks" (
	"book_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"worker_id" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_locks" ADD CONSTRAINT "book_locks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;