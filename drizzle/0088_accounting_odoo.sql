-- Wave 10 follow-up: Odoo (open-source, self-hostable) accounting provider.
-- ADDITIVE ONLY — one nullable-equivalent jsonb column with a safe default;
-- no existing column, table, or enum modified.
--
-- accounting_connections.metadata carries per-connection, non-secret provider
-- extras. For odoo: {"apiUrl": "https://books.tenant.example", "username":
-- "api-user"}. The Odoo database name reuses realm_id; the API key is stored
-- secretBox-encrypted in access_token_encrypted (same as OAuth tokens).

ALTER TABLE accounting_connections
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
