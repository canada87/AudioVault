ALTER TABLE `tags` ADD COLUMN `parent_id` integer REFERENCES tags(id) ON UPDATE no action ON DELETE set null;
