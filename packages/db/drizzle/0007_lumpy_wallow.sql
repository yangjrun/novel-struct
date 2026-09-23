CREATE TABLE "foreshadows" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"planted_chapter_id" text NOT NULL,
	"resolved_chapter_id" text,
	"summary" text NOT NULL,
	"source_ref_id" text NOT NULL,
	"parse_run_id" text
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"predicate" text NOT NULL,
	"object_id" text NOT NULL,
	"valid_from_chapter_id" text NOT NULL,
	"valid_to_chapter_id" text,
	"story_time" text,
	"confidence" real NOT NULL,
	"source_ref_id" text NOT NULL,
	"parse_run_id" text,
	"superseded_by" text
);
--> statement-breakpoint
CREATE TABLE "state_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text NOT NULL,
	"chapter_id" text NOT NULL,
	"scene_id" text,
	"source_ref_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"valid_from_chapter_id" text NOT NULL,
	"valid_to_chapter_id" text,
	"story_time" text,
	"confidence" real NOT NULL,
	"source_ref_id" text NOT NULL,
	"parse_run_id" text,
	"superseded_by" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"scene_id" text,
	"type" text NOT NULL,
	"actor_id" text,
	"target_id" text,
	"summary" text NOT NULL,
	"story_time" text,
	"source_ref_id" text NOT NULL,
	"parse_run_id" text
);
--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_planted_chapter_id_chapters_id_fk" FOREIGN KEY ("planted_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_resolved_chapter_id_chapters_id_fk" FOREIGN KEY ("resolved_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreshadows" ADD CONSTRAINT "foreshadows_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_subject_id_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_object_id_entities_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_valid_from_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_from_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_valid_to_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_to_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_superseded_by_relationships_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."relationships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_valid_from_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_from_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_valid_to_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_to_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_facts" ADD CONSTRAINT "state_facts_superseded_by_state_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."state_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_entities_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_target_id_entities_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "foreshadows_book_unresolved_idx" ON "foreshadows" USING btree ("edition_id","resolved_chapter_id");--> statement-breakpoint
CREATE INDEX "relationships_subject_active_idx" ON "relationships" USING btree ("edition_id","subject_id","valid_to_chapter_id");--> statement-breakpoint
CREATE INDEX "state_facts_entity_active_idx" ON "state_facts" USING btree ("edition_id","entity_id","valid_to_chapter_id");--> statement-breakpoint
CREATE INDEX "events_chapter_idx" ON "events" USING btree ("chapter_id");