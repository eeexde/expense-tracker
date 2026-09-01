CREATE TABLE `recurring_buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recurring_id` integer NOT NULL,
	`bucket_id` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recurring_bucket_pos` ON `recurring_buckets` (`recurring_id`,`position`);--> statement-breakpoint
CREATE TABLE `recurring_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recurring_id` integer NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`bucket_id` integer,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recurring_event_due` ON `recurring_events` (`recurring_id`,`date`);