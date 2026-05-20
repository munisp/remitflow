ALTER TABLE "user_lockouts" ADD COLUMN "unlock_token" text;--> statement-breakpoint
ALTER TABLE "user_lockouts" ADD COLUMN "unlock_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_lockouts" ADD COLUMN "unlock_requested_at" timestamp;