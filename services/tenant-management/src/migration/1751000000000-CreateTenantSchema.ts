import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTenantSchema1751000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(
      `CREATE TYPE "tenant_type_enum" AS ENUM ('bank', 'microfinance', 'fintech', 'mto')`
    );
    await queryRunner.query(
      `CREATE TYPE "tenant_status_enum" AS ENUM ('active', 'inactive', 'onboarding', 'suspended', 'disabled')`
    );
    await queryRunner.query(`CREATE TYPE "tenant_plan_enum" AS ENUM ('standard', 'premium', 'enterprise')`);
    await queryRunner.query(`CREATE TYPE "tenant_billing_period_enum" AS ENUM ('monthly', 'annual')`);
    await queryRunner.query(
      `CREATE TYPE "tenant_branch_status_enum" AS ENUM ('active', 'inactive', 'onboarding', 'suspended', 'disabled')`
    );
    await queryRunner.query(`CREATE TYPE "tenant_feature_flag_name_enum" AS ENUM (
      'auth', 'user_management', 'accounts', 'payments', 'reporting', 'notifications',
      'kyc_kyb', 'compliance', 'audit', 'mobile_banking', 'ussd_banking', 'whatsapp_banking',
      'agent_banking', 'chatbot', 'bill_payments', 'qr_payments', 'bulk_payments',
      'standing_orders', 'remittance', 'card_management', 'virtual_accounts', 'fx',
      'fraud_detection', 'risk_management', 'dispute', 'aml_compliance',
      'sanctions_screening', 'regulatory_reporting', 'travel_rule', 'treasury',
      'reconciliation', 'finance', 'diaspora_banking', 'employee_management',
      'document_management', 'maker_checker', 'open_banking', 'biometric_auth',
      'developer_platform'
    )`);
    await queryRunner.query(
      `CREATE TYPE "tenant_branch_feature_flag_name_enum" AS ENUM (
      'auth', 'user_management', 'accounts', 'payments', 'reporting', 'notifications',
      'kyc_kyb', 'compliance', 'audit', 'mobile_banking', 'ussd_banking', 'whatsapp_banking',
      'agent_banking', 'chatbot', 'bill_payments', 'qr_payments', 'bulk_payments',
      'standing_orders', 'remittance', 'card_management', 'virtual_accounts', 'fx',
      'fraud_detection', 'risk_management', 'dispute', 'aml_compliance',
      'sanctions_screening', 'regulatory_reporting', 'travel_rule', 'treasury',
      'reconciliation', 'finance', 'diaspora_banking', 'employee_management',
      'document_management', 'maker_checker', 'open_banking', 'biometric_auth',
      'developer_platform'
    )`
    );

    await queryRunner.query(`
      CREATE TABLE "tenant_contact" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "phone" varchar(20)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_branding" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "logo_url" varchar,
        "favicon_url" varchar,
        "primary_color" varchar,
        "secondary_color" varchar,
        "domain" varchar
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        "name" varchar(255) NOT NULL UNIQUE,
        "type" "tenant_type_enum",
        "cac_certificate_url" varchar,
        "cbn_license_url" varchar,
        "status" "tenant_status_enum" NOT NULL DEFAULT 'active',
        "plan" "tenant_plan_enum" DEFAULT 'standard',
        "billing_period" "tenant_billing_period_enum" DEFAULT 'monthly',
        "contact_id" uuid UNIQUE REFERENCES "tenant_contact"("id"),
        "branding_id" uuid UNIQUE REFERENCES "tenant_branding"("id"),
        "tenant_id" varchar NOT NULL,
        "tenant_secret" varchar NOT NULL,
        "status_message" varchar,
        "api_configuration" jsonb
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_tenant_id" ON "tenant" ("tenant_id")`);

    await queryRunner.query(`
      CREATE TABLE "tenant_feature_flag" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" "tenant_feature_flag_name_enum" NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT false,
        "tenant_id" integer REFERENCES "tenant"("id"),
        "config" jsonb
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_branch_contact" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "phone" varchar(20)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_branch" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        "name" varchar(255) NOT NULL,
        "code" varchar(255) NOT NULL,
        "webhook_url" varchar(255),
        "callback_url" varchar(255),
        "location" varchar(255) NOT NULL,
        "status" "tenant_branch_status_enum" NOT NULL DEFAULT 'active',
        "contact_id" uuid UNIQUE REFERENCES "tenant_branch_contact"("id"),
        "tenant_id" varchar NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_branch_feature_flag" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" "tenant_branch_feature_flag_name_enum" NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT false,
        "branch_id" integer REFERENCES "tenant_branch"("id"),
        "config" jsonb
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_branch_feature_flag"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_branch"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_branch_contact"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_feature_flag"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_branding"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_contact"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_branch_feature_flag_name_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_feature_flag_name_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_branch_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_billing_period_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_plan_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenant_type_enum"`);
  }
}
