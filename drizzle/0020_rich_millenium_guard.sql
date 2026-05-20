CREATE TYPE "public"."agreement_status" AS ENUM('draft', 'sent', 'viewed', 'digitally_signed', 'physically_signed', 'fully_executed', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."signature_method" AS ENUM('digital_checkbox', 'drawn', 'typed', 'uploaded');--> statement-breakpoint
CREATE TABLE "agreement_signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_doc_id" integer NOT NULL,
	"signer_type" varchar(20) DEFAULT 'partner' NOT NULL,
	"signer_user_id" integer,
	"signer_name" varchar(255) NOT NULL,
	"signer_email" varchar(255) NOT NULL,
	"signer_title" varchar(100),
	"method" "signature_method" DEFAULT 'digital_checkbox' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"checkbox_confirmed" boolean DEFAULT false NOT NULL,
	"signature_data" text,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"verification_hash" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "agreement_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" varchar(20) DEFAULT '1.0' NOT NULL,
	"type" varchar(50) DEFAULT 'revenue_share' NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_digital_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"template_id" integer,
	"tenant_id" integer NOT NULL,
	"status" "agreement_status" DEFAULT 'draft' NOT NULL,
	"agreement_text" text NOT NULL,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"digitally_signed_at" timestamp,
	"physically_signed_at" timestamp,
	"fully_executed_at" timestamp,
	"expires_at" timestamp,
	"partner_name" varchar(255) NOT NULL,
	"partner_email" varchar(255) NOT NULL,
	"partner_title" varchar(100),
	"partner_company" varchar(255),
	"partner_ip_address" varchar(45),
	"partner_user_agent" text,
	"platform_signed_by" integer,
	"platform_signed_at" timestamp,
	"signed_document_url" text,
	"signed_document_key" text,
	"physical_document_url" text,
	"physical_document_key" text,
	"audit_trail" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_agreement_doc_id_partner_digital_agreements_id_fk" FOREIGN KEY ("agreement_doc_id") REFERENCES "public"."partner_digital_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_templates" ADD CONSTRAINT "agreement_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_platform_signed_by_users_id_fk" FOREIGN KEY ("platform_signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;