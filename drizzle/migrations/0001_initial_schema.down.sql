-- Rollback: Drop all tables created in 0001_initial_schema.sql
-- WARNING: This destroys ALL data. Only use in development/testing.

DROP TABLE IF EXISTS feature_flags CASCADE;
DROP TABLE IF EXISTS nostro_accounts CASCADE;
DROP TABLE IF EXISTS compliance_filings CASCADE;
DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS kyc_documents CASCADE;
DROP TABLE IF EXISTS transfers CASCADE;
DROP TABLE IF EXISTS beneficiaries CASCADE;
DROP TABLE IF EXISTS users CASCADE;
