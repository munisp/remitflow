ALTER TABLE "compliance_email_config" ADD COLUMN "frequency" varchar(32) DEFAULT 'immediate';--> statement-breakpoint
ALTER TABLE "compliance_email_config" ADD COLUMN "include_attachment" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "compliance_email_config" ADD COLUMN "encrypt_attachment" boolean DEFAULT false;