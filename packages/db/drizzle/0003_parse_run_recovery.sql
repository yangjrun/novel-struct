ALTER TYPE "public"."parse_run_status" ADD VALUE 'interrupted';--> statement-breakpoint
ALTER TABLE "parse_runs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;