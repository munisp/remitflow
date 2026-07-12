CREATE TYPE "public"."p2p_alias_status" AS ENUM('active', 'pending_verification', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."p2p_alias_type" AS ENUM('phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."p2p_request_status" AS ENUM('pending', 'approved', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."p2p_transfer_rail" AS ENUM('internal', 'mojaloop', 'papss', 'mpesa', 'upi', 'pix', 'sepa', 'fednow', 'swift', 'batch', 'ilp_stream', 'escrow', 'favorite', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."p2p_transfer_status" AS ENUM('initiated', 'alias_resolved', 'quoted', 'compliance_cleared', 'debited', 'fx_converted', 'settling', 'completed', 'failed', 'compensated', 'disputed', 'escrowed', 'streaming', 'scheduled', 'pending', 'cancelled', 'favorite');--> statement-breakpoint
CREATE TABLE "builder_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"company_name" varchar(300) NOT NULL,
	"cac_registration_no" varchar(50),
	"cac_verified" boolean DEFAULT false,
	"director_names" json DEFAULT '[]'::json,
	"director_ids_verified" boolean DEFAULT false,
	"registered_address" text,
	"phone" varchar(30),
	"email" varchar(200),
	"website" varchar(300),
	"years_in_operation" integer DEFAULT 0,
	"projects_completed" integer DEFAULT 0,
	"projects_in_progress" integer DEFAULT 0,
	"average_rating" numeric(3, 2) DEFAULT '0.00',
	"total_reviews" integer DEFAULT 0,
	"financial_health_score" numeric(5, 2),
	"insurance_policy_no" varchar(100),
	"insurance_verified" boolean DEFAULT false,
	"kyb_status" varchar(20) DEFAULT 'pending',
	"kyb_submitted_at" timestamp,
	"kyb_verified_at" timestamp,
	"kyb_rejection_reason" text,
	"documents" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_payment_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"escrow_plan_id" integer NOT NULL,
	"installment_number" integer NOT NULL,
	"due_date" timestamp NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"amount_local" numeric(24, 2),
	"fx_rate_used" numeric(18, 8),
	"status" varchar(20) DEFAULT 'scheduled',
	"paid_at" timestamp,
	"transaction_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidence_id" varchar(50) NOT NULL,
	"milestone_id" integer NOT NULL,
	"submitted_by" integer NOT NULL,
	"evidence_type" varchar(30) NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(300),
	"file_size_bytes" bigint,
	"description" text,
	"gps_latitude" numeric(10, 7),
	"gps_longitude" numeric(10, 7),
	"metadata" json DEFAULT '{}'::json,
	"verified" boolean DEFAULT false,
	"verified_by" integer,
	"verified_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_evidence_evidence_id_unique" UNIQUE("evidence_id")
);
--> statement-breakpoint
CREATE TABLE "p2p_payment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"requester_alias" varchar(320) NOT NULL,
	"payer_alias" varchar(320) NOT NULL,
	"payer_id" integer,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"note" varchar(500),
	"status" "p2p_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp,
	"transfer_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "p2p_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"sender_alias" varchar(320),
	"receiver_alias" varchar(320) NOT NULL,
	"receiver_id" integer,
	"receiver_fsp_id" varchar(64),
	"send_amount" numeric(18, 2) NOT NULL,
	"send_currency" varchar(8) NOT NULL,
	"receive_amount" numeric(18, 2),
	"receive_currency" varchar(8),
	"fx_rate" numeric(18, 8),
	"fee" numeric(18, 2) DEFAULT '0.00',
	"rail" "p2p_transfer_rail",
	"corridor_code" varchar(10),
	"status" "p2p_transfer_status" DEFAULT 'initiated' NOT NULL,
	"mojaloop_transfer_id" varchar(64),
	"ilp_condition" varchar(128),
	"ilp_fulfillment" varchar(128),
	"aml_check_id" varchar(64),
	"fraud_score" numeric(5, 4),
	"payment_request_id" integer,
	"note" varchar(500),
	"idempotency_key" varchar(128),
	"completed_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "p2p_transfers_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payment_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"alias_type" "p2p_alias_type" NOT NULL,
	"alias_value" varchar(320) NOT NULL,
	"normalized_value" varchar(320) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"wallet_id" integer,
	"country" varchar(3) NOT NULL,
	"fsp_id" varchar(64) DEFAULT 'remitflow-fsp',
	"status" "p2p_alias_status" DEFAULT 'active' NOT NULL,
	"is_primary" boolean DEFAULT false,
	"verified_at" timestamp,
	"mojaloop_registered" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_escrow_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" varchar(50) NOT NULL,
	"escrow_plan_id" integer NOT NULL,
	"milestone_id" integer,
	"raised_by" integer NOT NULL,
	"dispute_type" varchar(30) NOT NULL,
	"severity" varchar(10) DEFAULT 'medium',
	"description" text NOT NULL,
	"evidence_ids" json DEFAULT '[]'::json,
	"status" varchar(30) DEFAULT 'open',
	"resolution" text,
	"refund_amount_usd" numeric(18, 2),
	"refund_initiated_at" timestamp,
	"refund_completed_at" timestamp,
	"assigned_mediator" integer,
	"cure_deadline" timestamp,
	"auto_refund_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "property_escrow_disputes_dispute_id_unique" UNIQUE("dispute_id")
);
--> statement-breakpoint
CREATE TABLE "property_escrow_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" varchar(50) NOT NULL,
	"buyer_id" integer NOT NULL,
	"builder_id" integer NOT NULL,
	"listing_id" integer NOT NULL,
	"total_price_ngn" numeric(24, 2) NOT NULL,
	"total_price_usd" numeric(18, 2) NOT NULL,
	"deposit_pct" numeric(5, 2) DEFAULT '10.00',
	"deposit_paid" boolean DEFAULT false,
	"payment_currency" varchar(10) DEFAULT 'GBP',
	"installment_count" integer NOT NULL,
	"installment_amount" numeric(18, 2) NOT NULL,
	"installment_frequency" varchar(20) DEFAULT 'monthly',
	"fx_rate_locked" numeric(18, 8),
	"fx_lock_expires_at" timestamp,
	"smart_contract_id" varchar(50),
	"agreement_id" integer,
	"tigerbeetle_escrow_account" bigint,
	"total_paid_usd" numeric(18, 2) DEFAULT '0.00',
	"total_released_usd" numeric(18, 2) DEFAULT '0.00',
	"status" varchar(30) DEFAULT 'draft',
	"next_payment_date" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "property_escrow_plans_plan_id_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
CREATE TABLE "property_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"milestone_id" varchar(50) NOT NULL,
	"escrow_plan_id" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"release_pct" numeric(5, 2) NOT NULL,
	"release_amount_usd" numeric(18, 2) NOT NULL,
	"deadline" timestamp NOT NULL,
	"verification_type" varchar(30) DEFAULT 'inspector',
	"status" varchar(30) DEFAULT 'pending',
	"cure_notice_sent_at" timestamp,
	"cure_notice_expires_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp,
	"rejected_reason" text,
	"funds_released" boolean DEFAULT false,
	"funds_released_at" timestamp,
	"tigerbeetle_transfer_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "property_milestones_milestone_id_unique" UNIQUE("milestone_id")
);
--> statement-breakpoint
CREATE TABLE "apisix_route_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" varchar(128) NOT NULL,
	"path" varchar(256) NOT NULL,
	"upstream_url" varchar(256) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dapr_state_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_name" varchar(128) NOT NULL,
	"key" varchar(256) NOT NULL,
	"operation" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluvio_offsets" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"partition" integer NOT NULL,
	"consumer_group" varchar(128) NOT NULL,
	"offset" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keycloak_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"token" text NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "keycloak_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "lakehouse_sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" varchar(128) NOT NULL,
	"last_sync_id" bigint NOT NULL,
	"status" varchar(32) NOT NULL,
	"records_synced" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "openappsec_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"action" varchar(32) NOT NULL,
	"score" integer NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"path" varchar(256) NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "openappsec_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "permify_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" varchar(128) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"permission" varchar(64) NOT NULL,
	"allowed" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redis_cache_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_pattern" varchar(128) NOT NULL,
	"operation" varchar(32) NOT NULL,
	"hit_count" integer DEFAULT 0,
	"miss_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" varchar(256) NOT NULL,
	"run_id" varchar(256) NOT NULL,
	"workflow_type" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporal_executions_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tb_account_id" bigint NOT NULL,
	"ledger" integer NOT NULL,
	"code" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_accounts_tb_account_id_unique" UNIQUE("tb_account_id")
);
--> statement-breakpoint
CREATE TABLE "tigerbeetle_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tb_transfer_id" bigint NOT NULL,
	"debit_account_id" bigint NOT NULL,
	"credit_account_id" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"ledger" integer NOT NULL,
	"code" integer NOT NULL,
	"status" varchar(30) DEFAULT 'posted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_transfers_tb_transfer_id_unique" UNIQUE("tb_transfer_id")
);
--> statement-breakpoint
ALTER TABLE "builder_profiles" ADD CONSTRAINT "builder_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_payment_schedule" ADD CONSTRAINT "escrow_payment_schedule_escrow_plan_id_property_escrow_plans_id_fk" FOREIGN KEY ("escrow_plan_id") REFERENCES "public"."property_escrow_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_payment_schedule" ADD CONSTRAINT "escrow_payment_schedule_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_evidence" ADD CONSTRAINT "milestone_evidence_milestone_id_property_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."property_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_evidence" ADD CONSTRAINT "milestone_evidence_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_evidence" ADD CONSTRAINT "milestone_evidence_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_disputes" ADD CONSTRAINT "property_escrow_disputes_escrow_plan_id_property_escrow_plans_id_fk" FOREIGN KEY ("escrow_plan_id") REFERENCES "public"."property_escrow_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_disputes" ADD CONSTRAINT "property_escrow_disputes_milestone_id_property_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."property_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_disputes" ADD CONSTRAINT "property_escrow_disputes_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_disputes" ADD CONSTRAINT "property_escrow_disputes_assigned_mediator_users_id_fk" FOREIGN KEY ("assigned_mediator") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_plans" ADD CONSTRAINT "property_escrow_plans_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_plans" ADD CONSTRAINT "property_escrow_plans_builder_id_builder_profiles_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builder_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_escrow_plans" ADD CONSTRAINT "property_escrow_plans_listing_id_real_estate_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."real_estate_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_milestones" ADD CONSTRAINT "property_milestones_escrow_plan_id_property_escrow_plans_id_fk" FOREIGN KEY ("escrow_plan_id") REFERENCES "public"."property_escrow_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_milestones" ADD CONSTRAINT "property_milestones_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keycloak_sessions" ADD CONSTRAINT "keycloak_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tigerbeetle_accounts" ADD CONSTRAINT "tigerbeetle_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_builder_profiles_user" ON "builder_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_builder_profiles_status" ON "builder_profiles" USING btree ("kyb_status");--> statement-breakpoint
CREATE INDEX "idx_escrow_schedule_plan" ON "escrow_payment_schedule" USING btree ("escrow_plan_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_schedule_due" ON "escrow_payment_schedule" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_escrow_schedule_status" ON "escrow_payment_schedule" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_evidence_milestone" ON "milestone_evidence" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "idx_evidence_submitted" ON "milestone_evidence" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "p2p_payment_requests_payer_idx" ON "p2p_payment_requests" USING btree ("payer_alias");--> statement-breakpoint
CREATE INDEX "p2p_payment_requests_requester_idx" ON "p2p_payment_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "p2p_payment_requests_status_idx" ON "p2p_payment_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "p2p_transfers_sender_idx" ON "p2p_transfers" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "p2p_transfers_receiver_idx" ON "p2p_transfers" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "p2p_transfers_status_idx" ON "p2p_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "p2p_transfers_idempotency_idx" ON "p2p_transfers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "p2p_transfers_corridor_idx" ON "p2p_transfers" USING btree ("corridor_code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_aliases_normalized_unique" ON "payment_aliases" USING btree ("normalized_value","alias_type");--> statement-breakpoint
CREATE INDEX "payment_aliases_user_idx" ON "payment_aliases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_aliases_country_idx" ON "payment_aliases" USING btree ("country");--> statement-breakpoint
CREATE INDEX "idx_prop_disputes_plan" ON "property_escrow_disputes" USING btree ("escrow_plan_id");--> statement-breakpoint
CREATE INDEX "idx_prop_disputes_status" ON "property_escrow_disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_prop_disputes_raised" ON "property_escrow_disputes" USING btree ("raised_by");--> statement-breakpoint
CREATE INDEX "idx_escrow_plans_buyer" ON "property_escrow_plans" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_plans_builder" ON "property_escrow_plans" USING btree ("builder_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_plans_listing" ON "property_escrow_plans" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_plans_status" ON "property_escrow_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_milestones_plan" ON "property_milestones" USING btree ("escrow_plan_id");--> statement-breakpoint
CREATE INDEX "idx_milestones_status" ON "property_milestones" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_milestones_deadline" ON "property_milestones" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "apisix_route_logs_route_idx" ON "apisix_route_logs" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "dapr_state_audit_key_idx" ON "dapr_state_audit" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "fluvio_offsets_unique_idx" ON "fluvio_offsets" USING btree ("topic","partition","consumer_group");--> statement-breakpoint
CREATE INDEX "keycloak_sessions_user_idx" ON "keycloak_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "keycloak_sessions_session_idx" ON "keycloak_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "lakehouse_sync_table_idx" ON "lakehouse_sync_jobs" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "openappsec_events_ip_idx" ON "openappsec_events" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "openappsec_events_action_idx" ON "openappsec_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "permify_audit_subject_idx" ON "permify_audit_logs" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "permify_audit_entity_idx" ON "permify_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "redis_cache_audit_pattern_idx" ON "redis_cache_audit" USING btree ("key_pattern");--> statement-breakpoint
CREATE INDEX "temporal_exec_workflow_idx" ON "temporal_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "temporal_exec_status_idx" ON "temporal_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tb_accounts_user_idx" ON "tigerbeetle_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tb_accounts_ledger_idx" ON "tigerbeetle_accounts" USING btree ("ledger");--> statement-breakpoint
CREATE INDEX "tb_transfers_debit_idx" ON "tigerbeetle_transfers" USING btree ("debit_account_id");--> statement-breakpoint
CREATE INDEX "tb_transfers_credit_idx" ON "tigerbeetle_transfers" USING btree ("credit_account_id");