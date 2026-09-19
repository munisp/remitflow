-- 0093_wave13b.sql — Wave-13 C6: encrypted-at-rest BVN/NIN for immigrant_worker_kyc (additive only; idempotent)
-- Plaintext bvn/nin varchar(11) columns are left in place for legacy rows but
-- are no longer written; new writes go to the _enc text columns (AES-256-GCM
-- via server/_core/secretBox.ts encryptField). Reads prefer _enc with decrypt,
-- falling back to legacy plaintext via decryptField passthrough.
ALTER TABLE immigrant_worker_kyc ADD COLUMN IF NOT EXISTS bvn_enc text;
ALTER TABLE immigrant_worker_kyc ADD COLUMN IF NOT EXISTS nin_enc text;
