CREATE INDEX `idx_pending_status` ON `pending_notifications` (`status`);--> statement-breakpoint
CREATE INDEX `idx_txn_notif_key` ON `transactions` (`source_notif_key`);