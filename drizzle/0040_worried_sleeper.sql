CREATE TYPE "public"."swift_gpi_status" AS ENUM('ACCP', 'ACSP', 'ACSC', 'RJCT', 'PDNG');--> statement-breakpoint
CREATE TABLE "swift_transactions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"uetr" uuid NOT NULL,
	"msg_id" varchar(128) NOT NULL,
	"end_to_end_id" varchar(128),
	"tx_id" varchar(128),
	"debtor_name" varchar(200),
	"debtor_account" varchar(100),
	"debtor_bic" varchar(20),
	"creditor_name" varchar(200),
	"creditor_account" varchar(100),
	"creditor_bic" varchar(20),
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"charge_bearer" varchar(10),
	"remittance_info" text,
	"status" "swift_gpi_status" DEFAULT 'ACCP' NOT NULL,
	"message_json" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "swift_transactions_uetr_unique" UNIQUE("uetr")
);
--> statement-breakpoint
ALTER TABLE "swift_transactions" ADD CONSTRAINT "swift_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;