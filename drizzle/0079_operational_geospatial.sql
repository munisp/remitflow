-- Tenant-isolated operational mapping for agent availability, corridor health, and fraud-response incidents.
-- Geographic records contain only approved operational coordinates; no customer location is inferred or exposed.

CREATE TABLE IF NOT EXISTS operational_geo_locations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  location_type TEXT NOT NULL CHECK (location_type IN ('agent', 'partner', 'corridor_origin', 'corridor_destination', 'fraud_incident')),
  external_ref TEXT NOT NULL,
  display_label TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  latitude NUMERIC(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  operational_status TEXT NOT NULL DEFAULT 'active' CHECK (operational_status IN ('active', 'degraded', 'inactive', 'investigating')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, location_type, external_ref)
);

CREATE TABLE IF NOT EXISTS operational_geo_corridors (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  corridor_code TEXT NOT NULL,
  origin_location_id BIGINT NOT NULL REFERENCES operational_geo_locations(id) ON DELETE RESTRICT,
  destination_location_id BIGINT NOT NULL REFERENCES operational_geo_locations(id) ON DELETE RESTRICT,
  operational_status TEXT NOT NULL DEFAULT 'active' CHECK (operational_status IN ('active', 'degraded', 'suspended', 'investigating')),
  p95_completion_seconds INTEGER,
  failure_rate_bps INTEGER CHECK (failure_rate_bps BETWEEN 0 AND 10000),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, corridor_code)
);

CREATE INDEX IF NOT EXISTS operational_geo_locations_tenant_type_status_idx
  ON operational_geo_locations (tenant_id, location_type, operational_status, observed_at DESC);
CREATE INDEX IF NOT EXISTS operational_geo_corridors_tenant_status_idx
  ON operational_geo_corridors (tenant_id, operational_status, observed_at DESC);

ALTER TABLE operational_geo_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_geo_locations FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_geo_corridors ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_geo_corridors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operational_geo_locations_tenant_isolation ON operational_geo_locations;
CREATE POLICY operational_geo_locations_tenant_isolation ON operational_geo_locations
  USING (app_bypass_rls() OR tenant_id::TEXT = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR tenant_id::TEXT = app_current_tenant_id());

DROP POLICY IF EXISTS operational_geo_corridors_tenant_isolation ON operational_geo_corridors;
CREATE POLICY operational_geo_corridors_tenant_isolation ON operational_geo_corridors
  USING (app_bypass_rls() OR tenant_id::TEXT = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR tenant_id::TEXT = app_current_tenant_id());

DROP TRIGGER IF EXISTS operational_geo_locations_audit_trig ON operational_geo_locations;
CREATE TRIGGER operational_geo_locations_audit_trig
  AFTER INSERT OR UPDATE OR DELETE ON operational_geo_locations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS operational_geo_corridors_audit_trig ON operational_geo_corridors;
CREATE TRIGGER operational_geo_corridors_audit_trig
  AFTER INSERT OR UPDATE OR DELETE ON operational_geo_corridors
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
