CREATE TABLE `project_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `folder_id` integer REFERENCES project_folders(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `project_folders_name_unique` ON `project_folders` (`name`);
