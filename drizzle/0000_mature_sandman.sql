CREATE TABLE `buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT '💰' NOT NULL,
	`color` text DEFAULT '#2E7D32' NOT NULL,
	`starting_balance` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT '🏷️' NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_name` text NOT NULL,
	`total_amount` integer NOT NULL,
	`monthly_due` integer NOT NULL,
	`months_total` integer NOT NULL,
	`months_paid` integer DEFAULT 0 NOT NULL,
	`day_due` integer NOT NULL,
	`bucket_id` integer NOT NULL,
	`start_date` text NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`category_id` integer,
	`bucket_id` integer NOT NULL,
	`frequency` text NOT NULL,
	`day_due` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	`last_posted_date` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`bucket_id` integer NOT NULL,
	`to_bucket_id` integer,
	`category_id` integer,
	`note` text,
	`receipt_photo_uri` text,
	`date` text NOT NULL,
	`recurring_id` integer,
	`installment_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_txn_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `idx_txn_bucket` ON `transactions` (`bucket_id`);--> statement-breakpoint
CREATE TABLE `utang` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_name` text NOT NULL,
	`direction` text NOT NULL,
	`original_amount` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `utang_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`utang_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`bucket_id` integer NOT NULL,
	FOREIGN KEY (`utang_id`) REFERENCES `utang`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
