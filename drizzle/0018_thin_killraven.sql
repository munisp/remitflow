ALTER TABLE "transactions" ADD COLUMN "idempotency_key" varchar(200);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;