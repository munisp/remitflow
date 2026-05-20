CREATE TABLE "split_bill_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" varchar(64) NOT NULL,
	"creator_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"note" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "split_bill_groups_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE "split_bill_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(255),
	"share_amount" numeric(18, 2) NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "split_bill_participants_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "split_bill_groups" ADD CONSTRAINT "split_bill_groups_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;