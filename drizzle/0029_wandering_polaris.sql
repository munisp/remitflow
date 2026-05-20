CREATE TABLE "user_lockouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp,
	"lock_expires_at" timestamp,
	"last_failed_at" timestamp,
	"unlocked_at" timestamp,
	"unlocked_by_admin_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_lockouts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user_lockouts" ADD CONSTRAINT "user_lockouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;