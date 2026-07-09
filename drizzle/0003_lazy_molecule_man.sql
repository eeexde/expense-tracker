CREATE TABLE `category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword` text NOT NULL,
	`category_id` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notification_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket_id` integer NOT NULL,
	`package_name` text NOT NULL,
	`match_keyword` text,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pending_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`raw_title` text,
	`raw_text` text NOT NULL,
	`parsed_amount` integer,
	`parsed_merchant` text,
	`parsed_type` text,
	`notif_key` text NOT NULL,
	`posted_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `notification_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_notifications_notif_key_unique` ON `pending_notifications` (`notif_key`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `source_notif_key` text;