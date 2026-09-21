CREATE TYPE "public"."chapter_kind" AS ENUM('chapter', 'prologue', 'extra', 'front_matter');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('active', 'merged');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('character', 'location', 'organization', 'item', 'skill', 'realm', 'species', 'concept', 'event');--> statement-breakpoint
CREATE TYPE "public"."parse_pass" AS ENUM('structure', 'consistency');--> statement-breakpoint
CREATE TYPE "public"."parse_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."segment_kind" AS ENUM('narration', 'dialogue', 'thought');--> statement-breakpoint
CREATE TABLE "book_editions" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"label" text NOT NULL,
	"source_format" text NOT NULL,
	"source_filename" text,
	"source_hash" text NOT NULL,
	"source_encoding" text NOT NULL,
	"normalizer_version" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"universe_id" text,
	"series_id" text,
	"series_index" integer,
	"title" text NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"volume_id" text,
	"index" integer NOT NULL,
	"kind" "chapter_kind" NOT NULL,
	"number" integer,
	"heading_raw" text,
	"title" text,
	"text" text NOT NULL,
	"char_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_edition_index" UNIQUE("edition_id","index")
);
--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"universe_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universes" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volumes" (
	"id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"index" integer NOT NULL,
	"number" integer,
	"title" text,
	"heading_raw" text NOT NULL,
	CONSTRAINT "volumes_edition_index" UNIQUE("edition_id","index")
);
--> statement-breakpoint
CREATE TABLE "parse_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"pass" "parse_pass" NOT NULL,
	"attributor" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"status" "parse_run_status" NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"type" "entity_type" NOT NULL,
	"canonical_name" text NOT NULL,
	"description" text,
	"confidence" real NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"first_chapter_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_book_type_name" UNIQUE("book_id","type","canonical_name")
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"alias" text NOT NULL,
	"valid_from_chapter_id" text,
	"valid_to_chapter_id" text,
	"source_ref_id" text,
	CONSTRAINT "entity_aliases_entity_alias" UNIQUE("entity_id","alias")
);
--> statement-breakpoint
CREATE TABLE "source_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"edition_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"quote" text NOT NULL,
	"weknora_chunk_id" text
);
--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"scene_id" text,
	"source_ref_id" text NOT NULL,
	"surface" text NOT NULL,
	"confidence" real NOT NULL,
	"parse_run_id" text
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"edition_id" text NOT NULL,
	"index" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"location" text,
	"time_hint" text,
	"summary" text,
	"parse_run_id" text,
	CONSTRAINT "scenes_chapter_index" UNIQUE("chapter_id","index")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"index" integer NOT NULL,
	"kind" "segment_kind" NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"text" text NOT NULL,
	"speaker_entity_id" text,
	"speaker_surface" text,
	"speaker_confidence" real,
	"emotion_type" text,
	"emotion_intensity" real,
	"parse_run_id" text,
	CONSTRAINT "segments_chapter_index" UNIQUE("chapter_id","index")
);
--> statement-breakpoint
ALTER TABLE "book_editions" ADD CONSTRAINT "book_editions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_volume_id_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."volumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_universe_id_universes_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universes" ADD CONSTRAINT "universes_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD CONSTRAINT "parse_runs_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD CONSTRAINT "parse_runs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_entities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_first_chapter_id_chapters_id_fk" FOREIGN KEY ("first_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_valid_from_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_from_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_valid_to_chapter_id_chapters_id_fk" FOREIGN KEY ("valid_to_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_refs" ADD CONSTRAINT "source_refs_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_refs" ADD CONSTRAINT "source_refs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_source_ref_id_source_refs_id_fk" FOREIGN KEY ("source_ref_id") REFERENCES "public"."source_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_edition_id_book_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."book_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_speaker_entity_id_entities_id_fk" FOREIGN KEY ("speaker_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;