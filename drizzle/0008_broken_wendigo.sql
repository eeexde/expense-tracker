ALTER TABLE `transactions` ADD `fee_for_transaction_id` integer REFERENCES transactions(id);--> statement-breakpoint
CREATE INDEX `idx_txn_fee_for` ON `transactions` (`fee_for_transaction_id`);