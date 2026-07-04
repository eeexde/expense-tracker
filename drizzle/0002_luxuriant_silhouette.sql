ALTER TABLE `buckets` ADD `type` text DEFAULT 'bucket' NOT NULL;--> statement-breakpoint
ALTER TABLE `installments` ADD `amount_paid` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `installments` SET `amount_paid` = `months_paid` * `monthly_due`;--> statement-breakpoint
UPDATE `buckets` SET `icon` = CASE `icon`
  WHEN '💵' THEN 'cash'
  WHEN '📱' THEN 'phone'
  WHEN '💳' THEN 'card'
  WHEN '🏦' THEN 'bank'
  WHEN '🐷' THEN 'savings'
  WHEN '💰' THEN 'wallet'
  WHEN '👛' THEN 'wallet'
  ELSE 'wallet'
END;--> statement-breakpoint
UPDATE `categories` SET `icon` = CASE `icon`
  WHEN '📶' THEN 'signal'
  WHEN '🚌' THEN 'bus'
  WHEN '⚡' THEN 'zap'
  WHEN '🚰' THEN 'droplet'
  WHEN '🛒' THEN 'cart'
  WHEN '🍽️' THEN 'dining'
  WHEN '📦' THEN 'box'
  WHEN '🌐' THEN 'globe'
  WHEN '🏠' THEN 'home'
  WHEN '🧾' THEN 'receipt'
  WHEN '🤝' THEN 'users'
  WHEN '🗂️' THEN 'folder'
  WHEN '💻' THEN 'laptop'
  WHEN '🛠️' THEN 'wrench'
  ELSE 'tag'
END;
