CREATE TABLE "kyc_liveness_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kyc_doc_id" integer,
	"passive_score" numeric(5, 4),
	"passive_passed" boolean,
	"passive_spoofing_type" varchar(50),
	"active_blink_count" integer,
	"active_head_movement_deg" numeric(6, 2),
	"active_passed" boolean,
	"deepfake_score" numeric(5, 4),
	"deepfake_method" varchar(100),
	"deepfake_indicators" json,
	"deepfake_passed" boolean,
	"overall_live" boolean DEFAULT false NOT NULL,
	"source" varchar(30) DEFAULT 'trpc_extract',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kyc_liveness_audit" ADD CONSTRAINT "kyc_liveness_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_liveness_audit" ADD CONSTRAINT "kyc_liveness_audit_kyc_doc_id_kycDocuments_id_fk" FOREIGN KEY ("kyc_doc_id") REFERENCES "public"."kycDocuments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_liveness_audit_user_idx" ON "kyc_liveness_audit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_liveness_audit_doc_idx" ON "kyc_liveness_audit" USING btree ("kyc_doc_id");--> statement-breakpoint
CREATE INDEX "kyc_liveness_audit_created_idx" ON "kyc_liveness_audit" USING btree ("created_at");