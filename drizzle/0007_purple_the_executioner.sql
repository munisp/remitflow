CREATE TABLE "corridor_margin_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"corridor_id" varchar(50) NOT NULL,
	"corridor_name" varchar(100) NOT NULL,
	"change_type" varchar(30) NOT NULL,
	"old_value" varchar(100),
	"new_value" varchar(100) NOT NULL,
	"changed_by" integer NOT NULL,
	"changed_by_name" varchar(100),
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corridor_margin_history" ADD CONSTRAINT "corridor_margin_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;