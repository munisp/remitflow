CREATE TABLE "compliance_alert_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_alert_notes" ADD CONSTRAINT "compliance_alert_notes_alert_id_compliance_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."compliance_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_alert_notes" ADD CONSTRAINT "compliance_alert_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;