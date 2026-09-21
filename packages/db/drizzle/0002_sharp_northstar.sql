CREATE INDEX "parse_runs_chapter_status_idx" ON "parse_runs" USING btree ("chapter_id","status");--> statement-breakpoint
CREATE INDEX "entities_book_status_idx" ON "entities" USING btree ("book_id","status");--> statement-breakpoint
CREATE INDEX "source_refs_chapter_idx" ON "source_refs" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "entity_mentions_chapter_idx" ON "entity_mentions" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "entity_mentions_entity_idx" ON "entity_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "segments_speaker_entity_idx" ON "segments" USING btree ("speaker_entity_id");