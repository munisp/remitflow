CREATE TYPE "public"."audit_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('draft', 'processing', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."card_brand" AS ENUM('visa', 'mastercard', 'verve');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('active', 'frozen', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."card_type" AS ENUM('virtual', 'physical');--> statement-breakpoint
CREATE TYPE "public"."case_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('open', 'under_review', 'resolved', 'escalated', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."case_type" AS ENUM('aml_flag', 'fraud_alert', 'sanctions_hit', 'pep_match', 'unusual_activity', 'high_risk_corridor');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."collective_status" AS ENUM('forming', 'active', 'investing', 'completed', 'dissolved');--> statement-breakpoint
CREATE TYPE "public"."community_fund_status" AS ENUM('active', 'completed', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dd_freq" AS ENUM('weekly', 'monthly', 'quarterly', 'annually');--> statement-breakpoint
CREATE TYPE "public"."dd_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'under_review', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('unauthorized', 'duplicate', 'not_received', 'wrong_amount', 'other');--> statement-breakpoint
CREATE TYPE "public"."family_relationship" AS ENUM('spouse', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'uncle_aunt', 'cousin', 'other');--> statement-breakpoint
CREATE TYPE "public"."fraud_alert_status" AS ENUM('pending', 'reviewed', 'blocked', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."fraud_risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."fx_direction" AS ENUM('above', 'below');--> statement-breakpoint
CREATE TYPE "public"."investment_stage" AS ENUM('seed', 'series_a', 'series_b', 'growth', 'ipo_ready');--> statement-breakpoint
CREATE TYPE "public"."investment_status" AS ENUM('open', 'closing', 'funded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."kyc_doc_status" AS ENUM('pending', 'under_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_doc_type" AS ENUM('passport', 'national_id', 'drivers_license', 'utility_bill', 'bank_statement', 'selfie', 'proof_of_address');--> statement-breakpoint
CREATE TYPE "public"."kycTier" AS ENUM('tier0', 'tier1', 'tier2', 'tier3');--> statement-breakpoint
CREATE TYPE "public"."market_category" AS ENUM('electronics', 'fashion', 'food', 'crafts', 'services', 'real_estate', 'agriculture', 'education', 'health', 'other');--> statement-breakpoint
CREATE TYPE "public"."market_listing_status" AS ENUM('active', 'sold', 'cancelled', 'pending');--> statement-breakpoint
CREATE TYPE "public"."market_order_status" AS ENUM('pending_payment', 'paid', 'shipped', 'delivered', 'disputed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notif_type" AS ENUM('transaction', 'security', 'kyc', 'system', 'promotion', 'fx_alert');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'voting', 'approved', 'rejected', 'funded', 'completed');--> statement-breakpoint
CREATE TYPE "public"."rate_lock_status" AS ENUM('active', 'used', 'expired');--> statement-breakpoint
CREATE TYPE "public"."recurring_freq" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'completed', 'rewarded');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."savings_status" AS ENUM('active', 'completed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."scheduled_run_status" AS ENUM('success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."talent_availability" AS ENUM('full_time', 'part_time', 'advisory', 'project_based');--> statement-breakpoint
CREATE TYPE "public"."talent_booking_status" AS ENUM('pending', 'accepted', 'declined', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."talent_engagement" AS ENUM('advisory', 'mentorship', 'consulting', 'speaking', 'training');--> statement-breakpoint
CREATE TYPE "public"."threshold_operator" AS ENUM('below', 'above');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('send', 'receive', 'exchange', 'topup', 'withdrawal', 'fee', 'refund', 'airtime', 'bill', 'savings', 'card');--> statement-breakpoint
CREATE TYPE "public"."va_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."wallet_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TABLE "agent_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_code" varchar(20) NOT NULL,
	"business_name" varchar(200),
	"location" varchar(300),
	"phone" varchar(20),
	"status" varchar(20) DEFAULT 'active',
	"tier" varchar(20) DEFAULT 'basic',
	"commission_rate" numeric(5, 2) DEFAULT '1.50',
	"daily_limit" numeric(18, 2) DEFAULT '1000000.00',
	"total_transactions" integer DEFAULT 0,
	"total_volume" numeric(18, 2) DEFAULT '0.00',
	"rating" numeric(3, 2) DEFAULT '5.00',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "analyticsThresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"threshold" integer NOT NULL,
	"operator" "threshold_operator" DEFAULT 'below' NOT NULL,
	"notifyOwner" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analyticsThresholds_metric_unique" UNIQUE("metric")
);
--> statement-breakpoint
CREATE TABLE "auditLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"targetId" integer,
	"targetType" varchar(64),
	"action" varchar(64) NOT NULL,
	"description" text,
	"ipAddress" varchar(64),
	"userAgent" text,
	"severity" "audit_severity" DEFAULT 'info',
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batchPayments" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"totalAmount" numeric(18, 2),
	"currency" varchar(8) DEFAULT 'NGN',
	"totalRecipients" integer DEFAULT 0,
	"successCount" integer DEFAULT 0,
	"failedCount" integer DEFAULT 0,
	"status" "batch_status" DEFAULT 'draft',
	"payments" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"accountNumber" varchar(64),
	"bankName" varchar(128),
	"bankCode" varchar(16),
	"currency" varchar(8) DEFAULT 'NGN',
	"country" varchar(64),
	"phone" varchar(32),
	"email" varchar(320),
	"isFavorite" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"merchant" varchar(200) NOT NULL,
	"description" varchar(500),
	"total_amount" numeric(18, 2) NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0.00',
	"currency" varchar(10) DEFAULT 'NGN',
	"installments" integer DEFAULT 4,
	"installment_amount" numeric(18, 2),
	"interest_rate" numeric(5, 2) DEFAULT '2.50',
	"status" varchar(20) DEFAULT 'active',
	"next_due_date" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" "card_type" NOT NULL,
	"brand" "card_brand" NOT NULL,
	"last4" varchar(4) NOT NULL,
	"expiryMonth" varchar(2) NOT NULL,
	"expiryYear" varchar(4) NOT NULL,
	"status" "card_status" DEFAULT 'active',
	"currency" varchar(8) DEFAULT 'USD',
	"spendLimit" numeric(18, 2),
	"cardholderName" varchar(128),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caseComments" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"authorId" integer NOT NULL,
	"authorName" varchar(128) NOT NULL,
	"content" text NOT NULL,
	"isInternal" boolean DEFAULT true,
	"parentId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbdc_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" varchar(10) NOT NULL,
	"balance" numeric(18, 2) DEFAULT '0.00',
	"wallet_address" varchar(100),
	"issuer" varchar(200) DEFAULT 'Central Bank',
	"wallet_type" varchar(20) DEFAULT 'retail',
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chatMessages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatSessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(255) DEFAULT 'New Conversation' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_funds" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"country" varchar(64),
	"theme" varchar(100),
	"total_raised" numeric(18, 2) DEFAULT '0',
	"goal_amount" numeric(18, 2),
	"currency" varchar(10) DEFAULT 'USD',
	"contributor_count" integer DEFAULT 0,
	"beneficiary_count" integer DEFAULT 0,
	"sdg_goals" json DEFAULT '[]'::json,
	"status" "community_fund_status" DEFAULT 'active',
	"image_url" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complianceCases" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"transactionId" integer,
	"caseType" "case_type" DEFAULT 'aml_flag' NOT NULL,
	"severity" "case_severity" DEFAULT 'medium' NOT NULL,
	"status" "case_status" DEFAULT 'open' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"riskScore" integer DEFAULT 0,
	"priority" "ticket_priority" DEFAULT 'medium',
	"assignedTo" varchar(255),
	"dueAt" timestamp,
	"resolvedAt" timestamp,
	"escalatedAt" timestamp,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"consent_type" varchar(100) NOT NULL,
	"granted" boolean DEFAULT false,
	"version" varchar(20) DEFAULT '1.0',
	"ip_address" varchar(45),
	"granted_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diaspora_collective_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"collective_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member',
	"my_contribution" numeric(18, 2) DEFAULT '0',
	"currency" varchar(10) DEFAULT 'USD',
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diaspora_collectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"target_amount" numeric(18, 2),
	"total_contributed" numeric(18, 2) DEFAULT '0',
	"currency" varchar(10) DEFAULT 'USD',
	"member_count" integer DEFAULT 1,
	"max_members" integer DEFAULT 20,
	"status" "collective_status" DEFAULT 'forming',
	"investment_focus" varchar(200),
	"country" varchar(64),
	"next_vote_date" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_debit_mandates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"creditor" varchar(255) NOT NULL,
	"creditor_account" varchar(100),
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN',
	"frequency" "dd_freq" DEFAULT 'monthly',
	"status" "dd_status" DEFAULT 'active',
	"next_debit_date" timestamp,
	"last_debit_date" timestamp,
	"mandate_ref" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"transactionId" integer,
	"type" "dispute_type" NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open',
	"resolution" text,
	"fileUrl" text,
	"fileKey" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erasure_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"requested_at" timestamp DEFAULT now(),
	"scheduled_at" timestamp NOT NULL,
	"executed_at" timestamp,
	"cancelled_at" timestamp,
	"status" varchar(30) DEFAULT 'pending',
	"reason" varchar(500),
	"ip_address" varchar(45),
	"anonymized_fields" text,
	"retained_records" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "family_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"family_member_id" integer NOT NULL,
	"monthly_limit" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD',
	"current_month_spent" numeric(18, 2) DEFAULT '0',
	"alert_threshold" integer DEFAULT 80,
	"auto_renew" boolean DEFAULT true,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"relationship" "family_relationship" DEFAULT 'other',
	"country" varchar(64),
	"phone" varchar(30),
	"email" varchar(200),
	"bank_account" varchar(100),
	"bank_name" varchar(200),
	"currency" varchar(10) DEFAULT 'NGN',
	"avatar_url" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"transaction_id" integer,
	"risk_score" integer DEFAULT 0,
	"risk_level" "fraud_risk_level" DEFAULT 'low',
	"status" "fraud_alert_status" DEFAULT 'pending',
	"flagged_reasons" json,
	"transaction_amount" integer DEFAULT 0,
	"reviewer_id" integer,
	"reviewer_notes" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"fund_id" integer NOT NULL,
	"submitted_by_user_id" integer NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"requested_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD',
	"beneficiary_name" varchar(200),
	"beneficiary_country" varchar(64),
	"impact_description" text,
	"status" "proposal_status" DEFAULT 'voting',
	"votes_for" integer DEFAULT 0,
	"votes_against" integer DEFAULT 0,
	"voting_deadline" timestamp,
	"funded_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"vote" varchar(10) NOT NULL,
	"comment" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fxAlerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"fromCurrency" varchar(8) NOT NULL,
	"toCurrency" varchar(8) NOT NULL,
	"targetRate" numeric(18, 6) NOT NULL,
	"direction" "fx_direction" NOT NULL,
	"isActive" boolean DEFAULT true,
	"triggered" boolean DEFAULT false,
	"triggeredAt" timestamp,
	"notifiedAt" timestamp,
	"lastCheckedRate" numeric(18, 6),
	"lastCheckedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fxRateCache" (
	"id" serial PRIMARY KEY NOT NULL,
	"baseCurrency" varchar(8) NOT NULL,
	"rates" json NOT NULL,
	"fetchedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(200) NOT NULL,
	"user_id" integer,
	"operation" varchar(100) NOT NULL,
	"response_status" integer,
	"response_body" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "impersonationTokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"adminId" integer NOT NULL,
	"targetUserId" integer NOT NULL,
	"token" varchar(128) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "impersonationTokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "investment_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"country" varchar(64) NOT NULL,
	"sector" varchar(100),
	"stage" "investment_stage" DEFAULT 'seed',
	"target_amount" numeric(18, 2) NOT NULL,
	"raised_amount" numeric(18, 2) DEFAULT '0',
	"min_investment" numeric(18, 2) DEFAULT '100',
	"currency" varchar(10) DEFAULT 'USD',
	"due_date" timestamp,
	"sdg_alignment" json DEFAULT '[]'::json,
	"expected_return" numeric(5, 2),
	"risk_level" varchar(20) DEFAULT 'medium',
	"image_url" text,
	"status" "investment_status" DEFAULT 'open',
	"investor_count" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyb_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_name" varchar(300) NOT NULL,
	"registration_number" varchar(100),
	"tax_id" varchar(100),
	"incorporation_date" varchar(20),
	"country" varchar(10),
	"industry" varchar(100),
	"website" varchar(300),
	"annual_revenue" numeric(18, 2),
	"employee_count" integer,
	"ubo_name" varchar(200),
	"ubo_ownership" numeric(5, 2),
	"status" varchar(30) DEFAULT 'pending',
	"risk_rating" varchar(20) DEFAULT 'medium',
	"reviewed_by" varchar(100),
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kycDocuments" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"docType" "kyc_doc_type" NOT NULL,
	"status" "kyc_doc_status" DEFAULT 'pending',
	"fileUrl" text,
	"fileKey" text,
	"rejectionReason" text,
	"expiresAt" timestamp,
	"reviewedAt" timestamp,
	"supersededAt" timestamp,
	"extractedData" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" "market_category" DEFAULT 'other' NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"country" varchar(64) NOT NULL,
	"city" varchar(64),
	"image_url" text,
	"status" "market_listing_status" DEFAULT 'active' NOT NULL,
	"view_count" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"buyer_id" integer NOT NULL,
	"seller_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"status" "market_order_status" DEFAULT 'pending_payment' NOT NULL,
	"escrow_held" boolean DEFAULT false,
	"buyer_note" text,
	"seller_note" text,
	"deliveryConfirmedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"rater_id" integer NOT NULL,
	"rated_user_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"review" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_ratings_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "mojaloop_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_id" varchar(100),
	"quote_id" varchar(100),
	"transaction_id" varchar(100),
	"payer_fsp" varchar(100),
	"payee_fsp" varchar(100),
	"payer_identifier" varchar(200),
	"payee_identifier" varchar(200),
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"ilp_packet" text,
	"condition" varchar(200),
	"fulfilment" varchar(200),
	"status" varchar(30) DEFAULT 'PENDING',
	"error_code" varchar(10),
	"error_description" varchar(500),
	"expiration_date" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notificationPreferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"category" varchar(50) NOT NULL,
	"emailEnabled" boolean DEFAULT true,
	"inAppEnabled" boolean DEFAULT true,
	"pushEnabled" boolean DEFAULT false,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"type" "notif_type" DEFAULT 'system',
	"isRead" boolean DEFAULT false,
	"actionUrl" varchar(256),
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"published_at" timestamp,
	"failed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"corridor" varchar(20) NOT NULL,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"avg_processing_ms" integer DEFAULT 0,
	"total_volume" numeric(18, 2) DEFAULT '0.00',
	"period" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pos_terminals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"terminal_id" varchar(50) NOT NULL,
	"merchant_name" varchar(200) NOT NULL,
	"merchant_category" varchar(100),
	"location" varchar(300),
	"status" varchar(20) DEFAULT 'active',
	"serial_number" varchar(100),
	"model" varchar(100),
	"last_seen" timestamp,
	"daily_limit" numeric(18, 2) DEFAULT '500000.00',
	"total_transactions" integer DEFAULT 0,
	"total_volume" numeric(18, 2) DEFAULT '0.00',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"locked_rate" numeric(18, 8) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" "rate_lock_status" DEFAULT 'active',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurringPayments" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"recipientName" varchar(128),
	"recipientAccount" varchar(64),
	"recipientBank" varchar(128),
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'NGN',
	"targetCurrency" varchar(8) DEFAULT 'USD',
	"description" varchar(256),
	"frequency" "recurring_freq" NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC',
	"startDate" timestamp,
	"endDate" timestamp,
	"nextRunAt" timestamp,
	"lastRunAt" timestamp,
	"status" "recurring_status" DEFAULT 'active',
	"lastRunStatus" varchar(16),
	"failureCount" integer DEFAULT 0,
	"executionCount" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrerId" integer NOT NULL,
	"referredId" integer NOT NULL,
	"status" "referral_status" DEFAULT 'pending',
	"rewardAmount" numeric(18, 2) DEFAULT '500.00',
	"rewardCurrency" varchar(8) DEFAULT 'NGN',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savingsGoals" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"emoji" varchar(8) DEFAULT '🎯',
	"targetAmount" numeric(18, 2) NOT NULL,
	"currentAmount" numeric(18, 2) DEFAULT '0.00',
	"currency" varchar(8) DEFAULT 'NGN',
	"targetDate" timestamp,
	"autoSave" boolean DEFAULT false,
	"autoSaveAmount" numeric(18, 2),
	"purpose" varchar(32) DEFAULT 'other',
	"status" "savings_status" DEFAULT 'active',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduledTransferRuns" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduleId" integer NOT NULL,
	"userId" integer NOT NULL,
	"status" "scheduled_run_status" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"targetCurrency" varchar(8),
	"fxRate" numeric(18, 6),
	"transactionId" integer,
	"errorMessage" varchar(512),
	"executedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stablecoin_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"balance" numeric(18, 8) DEFAULT '0.00000000',
	"wallet_address" varchar(200),
	"network" varchar(50) DEFAULT 'Ethereum',
	"protocol" varchar(50) DEFAULT 'ERC-20',
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"subject" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open',
	"priority" "ticket_priority" DEFAULT 'medium',
	"category" varchar(100),
	"agent_id" integer,
	"resolution" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "talent_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"expert_user_id" integer NOT NULL,
	"status" "talent_booking_status" DEFAULT 'pending',
	"message" text,
	"proposed_rate" numeric(10, 2),
	"currency" varchar(10) DEFAULT 'USD',
	"start_date" timestamp,
	"end_date" timestamp,
	"completed_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"posted_by_user_id" integer NOT NULL,
	"institution_name" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"sector" varchar(100),
	"country" varchar(64),
	"engagement_type" "talent_engagement" DEFAULT 'advisory',
	"compensation" numeric(10, 2),
	"currency" varchar(10) DEFAULT 'USD',
	"deadline" timestamp,
	"status" varchar(20) DEFAULT 'open',
	"applicant_count" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bio" text,
	"expertise" json DEFAULT '[]'::json,
	"countries" json DEFAULT '[]'::json,
	"availability" "talent_availability" DEFAULT 'advisory',
	"hourly_rate" numeric(10, 2),
	"currency" varchar(10) DEFAULT 'USD',
	"linkedin_url" text,
	"portfolio_url" text,
	"verified" boolean DEFAULT false,
	"total_bookings" integer DEFAULT 0,
	"avg_rating" numeric(3, 2) DEFAULT '0',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "talent_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" "tx_type" NOT NULL,
	"status" "tx_status" DEFAULT 'pending',
	"fromCurrency" varchar(8) NOT NULL,
	"fromAmount" numeric(18, 2) NOT NULL,
	"toCurrency" varchar(8),
	"toAmount" numeric(18, 2),
	"fee" numeric(18, 2) DEFAULT '0.00',
	"fxRate" numeric(18, 6),
	"reference" varchar(64),
	"description" text,
	"recipientName" varchar(128),
	"recipientAccount" varchar(64),
	"recipientBank" varchar(128),
	"recipientCountry" varchar(64),
	"channel" varchar(32),
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(128) NOT NULL,
	"email" varchar(320),
	"name" varchar(128),
	"phone" varchar(32),
	"avatar" text,
	"loginMethod" varchar(32),
	"role" "role" DEFAULT 'user',
	"kycTier" "kycTier" DEFAULT 'tier0',
	"referralCode" varchar(16),
	"referredBy" integer,
	"twoFactorEnabled" boolean DEFAULT false,
	"twoFactorSecret" varchar(64),
	"address" varchar(256),
	"dateOfBirth" date,
	"defaultCurrency" varchar(8) DEFAULT 'NGN',
	"lastSignedIn" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "virtualAccounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"bank" varchar(128) NOT NULL,
	"accountNumber" varchar(32) NOT NULL,
	"accountName" varchar(128) NOT NULL,
	"routingNumber" varchar(32),
	"sortCode" varchar(16),
	"iban" varchar(64),
	"swiftCode" varchar(16),
	"status" "va_status" DEFAULT 'active',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"balance" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"lockedBalance" numeric(18, 2) DEFAULT '0.00',
	"isDefault" boolean DEFAULT false,
	"status" "wallet_status" DEFAULT 'active',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_funds" ADD CONSTRAINT "community_funds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_collective_members" ADD CONSTRAINT "diaspora_collective_members_collective_id_diaspora_collectives_id_fk" FOREIGN KEY ("collective_id") REFERENCES "public"."diaspora_collectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_collective_members" ADD CONSTRAINT "diaspora_collective_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_collectives" ADD CONSTRAINT "diaspora_collectives_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_budgets" ADD CONSTRAINT "family_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_budgets" ADD CONSTRAINT "family_budgets_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_proposals" ADD CONSTRAINT "fund_proposals_fund_id_community_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."community_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_proposals" ADD CONSTRAINT "fund_proposals_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_votes" ADD CONSTRAINT "fund_votes_proposal_id_fund_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."fund_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_votes" ADD CONSTRAINT "fund_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."market_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_ratings" ADD CONSTRAINT "market_ratings_order_id_market_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."market_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_ratings" ADD CONSTRAINT "market_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_ratings" ADD CONSTRAINT "market_ratings_rated_user_id_users_id_fk" FOREIGN KEY ("rated_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_bookings" ADD CONSTRAINT "talent_bookings_opportunity_id_talent_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."talent_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_bookings" ADD CONSTRAINT "talent_bookings_expert_user_id_users_id_fk" FOREIGN KEY ("expert_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_opportunities" ADD CONSTRAINT "talent_opportunities_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;