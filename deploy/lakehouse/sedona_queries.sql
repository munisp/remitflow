-- ═══════════════════════════════════════════════════════════════════════════
-- RemitFlow Wave-10 (C6) — Apache Sedona corridor-density / agent-coverage
-- analysis over the bronze lakehouse written by rust-lakehouse-writer.
--
-- Prerequisites:
--   * Spark session with Sedona registered (SedonaContext.create(spark)).
--   * Bronze parquet at ${LAKE_DIR}/bronze/... (hive-style dt= partitions).
--   * Agent / corridor geography exported from the relational side
--     (drizzle tables operational_geo_locations / operational_geo_corridors)
--     into parquet — see silver_transforms.md ("geo dimensions export").
--     Sedona reads ONLY what exists; these queries never fabricate rows.
--
-- Execute top-to-bottom; each TEMP VIEW builds on the previous one.
-- Parameter placeholders use ${VAR} — substitute at job submission time.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Bronze ledger events with geometry ───────────────────────────────────
-- The rust writer flattens JSON into scalar columns; ledger events carry
-- origin/destination coordinates as numeric fields. Column names shown here
-- are the canonical producer contract (server emitters):
--   origin_lat, origin_lon, dest_lat, dest_lon, amount, currency,
--   corridor_code, event_type
-- ST_GeomFromWKT materializes WGS-84 points (Sedona default SRID 4326 when
-- set explicitly via ST_SetSRID).
CREATE OR REPLACE TEMP VIEW bronze_ledger_geo AS
SELECT
  _offset,
  dt,
  corridor_code,
  event_type,
  amount,
  currency,
  ST_SetSRID(ST_GeomFromWKT(
    concat('POINT(', cast(origin_lon as string), ' ', cast(origin_lat as string), ')')
  ), 4326) AS origin_geom,
  ST_SetSRID(ST_GeomFromWKT(
    concat('POINT(', cast(dest_lon as string), ' ', cast(dest_lat as string), ')')
  ), 4326) AS dest_geom
FROM parquet.`${LAKE_DIR}/bronze/ledger-events-bronze`
WHERE dt >= date_sub(current_date(), 30)
  AND origin_lat IS NOT NULL AND origin_lon IS NOT NULL
  AND dest_lat   IS NOT NULL AND dest_lon   IS NOT NULL
  -- Coordinate validity guard: drop (never coerce) out-of-range records.
  AND cast(origin_lat as double) BETWEEN -90 AND 90
  AND cast(origin_lon as double) BETWEEN -180 AND 180
  AND cast(dest_lat   as double) BETWEEN -90 AND 90
  AND cast(dest_lon   as double) BETWEEN -180 AND 180;

-- ── 2. Corridor segments from the relational export ─────────────────────────
-- silver.geo_corridors is the parquet export of operational_geo_corridors
-- JOINed to operational_geo_locations (origin + destination points).
CREATE OR REPLACE TEMP VIEW corridor_segments AS
SELECT
  corridor_code,
  ST_SetSRID(ST_GeomFromWKT(concat('POINT(', cast(origin_lon as string), ' ',
                                   cast(origin_lat as string), ')')), 4326) AS origin_geom,
  ST_SetSRID(ST_GeomFromWKT(concat('POINT(', cast(dest_lon as string), ' ',
                                   cast(dest_lat as string), ')')), 4326) AS dest_geom
FROM parquet.`${LAKE_DIR}/silver/geo_corridors`
WHERE operational_status = 'active';

-- ── 3. Corridor length + event density ──────────────────────────────────────
-- ST_Distance on SRID 4326 returns degrees; multiply by 111.195 for an
-- approximate km conversion (documented approximation — for sub-percent
-- precision, ST_Transform to a local projected SRID first, e.g. 3857 or the
-- corridor's UTM zone, then ST_Distance is already in meters).
CREATE OR REPLACE TEMP VIEW corridor_density AS
SELECT
  s.corridor_code,
  ST_Distance(s.origin_geom, s.dest_geom) * 111.195 AS corridor_km_approx,
  count(e._offset)                                  AS events_30d,
  sum(e.amount)                                     AS amount_30d,
  CASE
    WHEN ST_Distance(s.origin_geom, s.dest_geom) > 0
    THEN count(e._offset) / (ST_Distance(s.origin_geom, s.dest_geom) * 111.195) * 100
    ELSE NULL
  END                                               AS events_per_100km,
  CASE
    WHEN ST_Distance(s.origin_geom, s.dest_geom) > 0
    THEN sum(e.amount) / (ST_Distance(s.origin_geom, s.dest_geom) * 111.195)
    ELSE NULL
  END                                               AS amount_per_km
FROM corridor_segments s
LEFT JOIN bronze_ledger_geo e
  ON e.corridor_code = s.corridor_code
GROUP BY s.corridor_code, s.origin_geom, s.dest_geom;

-- ── 4. Agent coverage: agents within radius of each corridor ────────────────
-- silver.geo_agents is the parquet export of operational_geo_locations rows
-- with location_type = 'agent' (plus float metadata).
-- Coverage rule: agent origin point within ${COVERAGE_RADIUS_KM} km of the
-- corridor ORIGIN or DESTINATION endpoint (conservative: endpoint-anchored
-- coverage; for full path-buffer coverage use ST_Buffer on the segment in a
-- projected SRID + ST_Within — see commented variant below).
CREATE OR REPLACE TEMP VIEW corridor_agent_coverage AS
SELECT
  s.corridor_code,
  count(DISTINCT a.agent_id)    AS agents_within_radius,
  sum(a.float_usd)              AS float_usd_within_radius
FROM corridor_segments s
LEFT JOIN parquet.`${LAKE_DIR}/silver/geo_agents` a
  ON ST_Within(
       ST_SetSRID(ST_GeomFromWKT(concat('POINT(', cast(a.lon as string), ' ',
                                        cast(a.lat as string), ')')), 4326),
       -- Endpoint buffer in degree units (radius_km / 111.195). Approximate;
       -- use ST_Transform + meter-based ST_Buffer for production runs.
       ST_Buffer(s.origin_geom, ${COVERAGE_RADIUS_KM} / 111.195)
     )
  OR ST_Within(
       ST_SetSRID(ST_GeomFromWKT(concat('POINT(', cast(a.lon as string), ' ',
                                        cast(a.lat as string), ')')), 4326),
       ST_Buffer(s.dest_geom, ${COVERAGE_RADIUS_KM} / 111.195)
     )
GROUP BY s.corridor_code;

-- Full path-buffer variant (requires projected SRID for meter accuracy):
--   WITH seg AS (
--     SELECT corridor_code,
--            ST_Buffer(
--              ST_Transform(ST_MakeLine(origin_geom, dest_geom), 'epsg:4326', 'epsg:3857'),
--              ${COVERAGE_RADIUS_KM} * 1000) AS path_buf
--     FROM corridor_segments)
--   SELECT s.corridor_code, count(DISTINCT a.agent_id)
--   FROM seg s JOIN geo_agents a
--     ON ST_Within(ST_Transform(a.geom, 'epsg:4326', 'epsg:3857'), s.path_buf)
--   GROUP BY s.corridor_code;

-- ── 5. Underserved corridors ────────────────────────────────────────────────
-- Underserved = fewer than ${MIN_AGENTS_PER_CORRIDOR} agents within radius
-- OR float density below ${MIN_FLOAT_USD_PER_KM}. Thresholds are explicit
-- parameters — never inferred from nothing.
SELECT
  d.corridor_code,
  d.corridor_km_approx,
  d.events_30d,
  d.events_per_100km,
  coalesce(c.agents_within_radius, 0)  AS agents_within_radius,
  coalesce(c.float_usd_within_radius, 0) AS float_usd_within_radius,
  CASE WHEN d.corridor_km_approx > 0
       THEN coalesce(c.float_usd_within_radius, 0) / d.corridor_km_approx
       ELSE NULL END                  AS float_usd_per_km
FROM corridor_density d
LEFT JOIN corridor_agent_coverage c USING (corridor_code)
WHERE coalesce(c.agents_within_radius, 0) < ${MIN_AGENTS_PER_CORRIDOR}
   OR (d.corridor_km_approx > 0
       AND coalesce(c.float_usd_within_radius, 0) / d.corridor_km_approx
             < ${MIN_FLOAT_USD_PER_KM})
ORDER BY events_30d DESC;

-- ── 6. ST_KNN: nearest agents to a corridor origin ──────────────────────────
-- Use case: "who can service a spike on corridor X right now?" — k nearest
-- active agents to the corridor origin point. ST_KNN(geom_a, geom_b, k)
-- is true when geom_b is among the k nearest neighbors of geom_a; requires a
-- Sedona spatial join (broadcast the single origin point).
-- SELECT a.agent_id, a.lat, a.lon,
--        ST_Distance(o.origin_geom, a.geom) * 111.195 AS distance_km_approx
-- FROM (SELECT origin_geom FROM corridor_segments
--       WHERE corridor_code = '${CORRIDOR_CODE}') o
-- JOIN geo_agents a
--   ON ST_KNN(o.origin_geom, a.geom, ${K_NEAREST})
-- ORDER BY distance_km_approx;

-- ── 7. Bill-capture extraction quality (non-spatial sanity view) ────────────
-- Bronze coverage of the OCR pipeline: extraction confidence distribution by
-- day — feeds the silver cleaning thresholds (see silver_transforms.md).
CREATE OR REPLACE TEMP VIEW bill_capture_daily AS
SELECT
  dt,
  count(*)                                       AS records,
  sum(CASE WHEN _raw_json IS NULL THEN 1 ELSE 0 END) AS raw_only_records,
  avg(cast(confidence as double))                AS avg_confidence
FROM parquet.`${LAKE_DIR}/bronze/bill-capture-extracted`
GROUP BY dt
ORDER BY dt DESC;
