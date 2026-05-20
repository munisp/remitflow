ALTER TABLE "compliance_alerts" ADD COLUMN "assigned_to" integer;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD COLUMN "sar_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD COLUMN "sar_reference" varchar(64);--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;