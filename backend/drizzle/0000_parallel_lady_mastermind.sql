CREATE TABLE `daily_limits` (
	`date` text PRIMARY KEY NOT NULL,
	`llm_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processing_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` integer NOT NULL,
	`action` text NOT NULL,
	`triggered_by` text NOT NULL,
	`status` text NOT NULL,
	`error_msg` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `record_tags` (
	`record_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`record_id`, `tag_id`),
	FOREIGN KEY (`record_id`) REFERENCES `records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_name` text NOT NULL,
	`display_name` text,
	`recorded_at` integer NOT NULL,
	`file_path` text NOT NULL,
	`audio_deleted` integer DEFAULT 0 NOT NULL,
	`transcription` text,
	`summary` text,
	`notes` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`transcribed_at` integer,
	`processed_at` integer,
	`duration_seconds` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);