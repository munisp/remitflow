-- wave-15 fix (verifier residual #8): enforce one lifecycle row per user so
-- concurrent capture-session finalizes cannot double-insert.
-- Safety: dedupe first (keep newest row per user), then add the unique index.
-- kyc_lifecycle was introduced in wave-13; duplicate rows should not exist,
-- but the DELETE is guarded and idempotent regardless.
DELETE FROM kyc_lifecycle a
  USING kyc_lifecycle b
  WHERE a.user_id = b.user_id AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS kyc_lifecycle_user_uniq ON kyc_lifecycle (user_id);
