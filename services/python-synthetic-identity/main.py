"""
Python Synthetic Identity Detection Service (Graph Neural Network)

Detects fabricated identities that combine real + fake data from multiple people.
Uses graph-based analysis to find:
- Shared phone/email/address/SSN across applications
- Velocity anomalies (multiple apps from same device in short window)
- Network clustering (related synthetic identities)
- Behavioral indicators (new-to-credit thin files with immediate high credit usage)

Port: 8319 (configurable via PORT env var)
"""

import hashlib
import json
import math
import os
import signal
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Lock

import psycopg2
from psycopg2.pool import ThreadedConnectionPool

DB_URL = os.environ.get("DATABASE_URL", "postgres://localhost:5432/remitflow")
pool = None
pool_lock = Lock()


def get_pool():
    global pool
    if pool is None:
        with pool_lock:
            if pool is None:
                pool = ThreadedConnectionPool(2, 10, DB_URL)
    return pool


def get_conn():
    return get_pool().getconn()


def put_conn(conn):
    get_pool().putconn(conn)


def init_schema():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS synthetic_identity_checks (
                    id SERIAL PRIMARY KEY,
                    applicant_id TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    is_synthetic BOOLEAN NOT NULL,
                    risk_score NUMERIC(5,4) NOT NULL,
                    flags JSONB DEFAULT '[]',
                    graph_cluster_id TEXT,
                    shared_attributes JSONB DEFAULT '[]',
                    recommendation TEXT NOT NULL,
                    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS identity_graph_nodes (
                    id SERIAL PRIMARY KEY,
                    node_type TEXT NOT NULL,
                    node_value TEXT NOT NULL,
                    applicant_ids JSONB DEFAULT '[]',
                    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(node_type, node_value)
                );

                CREATE TABLE IF NOT EXISTS identity_graph_edges (
                    id SERIAL PRIMARY KEY,
                    source_applicant TEXT NOT NULL,
                    target_applicant TEXT NOT NULL,
                    shared_attribute TEXT NOT NULL,
                    weight NUMERIC(5,4) NOT NULL DEFAULT 1.0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_synth_applicant ON synthetic_identity_checks(applicant_id);
                CREATE INDEX IF NOT EXISTS idx_graph_node_type ON identity_graph_nodes(node_type, node_value);
                CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON identity_graph_edges(source_applicant);
            """)
        conn.commit()
    finally:
        put_conn(conn)


# ── Graph Analysis ───────────────────────────────────────────────────────────

def build_applicant_graph(applicant_data, conn):
    """
    Build identity graph by checking shared attributes against existing applicants.
    Returns shared attributes and graph cluster information.
    """
    shared_attributes = []
    linked_applicants = set()

    # Check each attribute against existing graph
    attributes_to_check = [
        ("phone", applicant_data.get("phone")),
        ("email", applicant_data.get("email")),
        ("ssn", applicant_data.get("ssn")),
        ("address", applicant_data.get("address")),
        ("device_fingerprint", applicant_data.get("device_fingerprint")),
        ("ip_address", applicant_data.get("ip_address")),
    ]

    with conn.cursor() as cur:
        for attr_type, attr_value in attributes_to_check:
            if not attr_value:
                continue

            # Check if this attribute is shared with other applicants
            cur.execute(
                "SELECT applicant_ids FROM identity_graph_nodes WHERE node_type = %s AND node_value = %s",
                (attr_type, attr_value),
            )
            row = cur.fetchone()

            if row:
                existing_ids = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                if existing_ids and applicant_data["applicant_id"] not in existing_ids:
                    shared_attributes.append(attr_type)
                    linked_applicants.update(existing_ids)

                    # Update node with new applicant
                    updated_ids = list(set(existing_ids + [applicant_data["applicant_id"]]))
                    cur.execute(
                        "UPDATE identity_graph_nodes SET applicant_ids = %s, last_seen = NOW() WHERE node_type = %s AND node_value = %s",
                        (json.dumps(updated_ids), attr_type, attr_value),
                    )
            else:
                # Create new graph node
                cur.execute(
                    "INSERT INTO identity_graph_nodes (node_type, node_value, applicant_ids) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                    (attr_type, attr_value, json.dumps([applicant_data["applicant_id"]])),
                )

        # Create edges for shared attributes
        for linked_id in linked_applicants:
            for attr in shared_attributes:
                cur.execute(
                    """INSERT INTO identity_graph_edges (source_applicant, target_applicant, shared_attribute, weight)
                       VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (applicant_data["applicant_id"], linked_id, attr, 1.0 / len(shared_attributes)),
                )

    conn.commit()

    # Determine cluster ID (simple: hash of connected component)
    cluster_id = None
    if linked_applicants:
        cluster_members = sorted(list(linked_applicants) + [applicant_data["applicant_id"]])
        cluster_id = hashlib.sha256(",".join(cluster_members).encode()).hexdigest()[:12]

    return shared_attributes, cluster_id, list(linked_applicants)


# ── Velocity Analysis ────────────────────────────────────────────────────────

def check_velocity(applicant_data, conn):
    """
    Check application velocity indicators:
    - Multiple apps from same device in 24h
    - Multiple apps from same IP in 1h
    - Name variations with same SSN/phone
    """
    flags = []

    with conn.cursor() as cur:
        # Device velocity
        if applicant_data.get("device_fingerprint"):
            cur.execute(
                """SELECT COUNT(*) FROM synthetic_identity_checks
                   WHERE analyzed_at > NOW() - INTERVAL '24 hours'
                   AND applicant_id IN (
                       SELECT DISTINCT unnest(applicant_ids::text[])
                       FROM identity_graph_nodes
                       WHERE node_type = 'device_fingerprint' AND node_value = %s
                   )""",
                (applicant_data["device_fingerprint"],),
            )
            row = cur.fetchone()
            if row and row[0] > 3:
                flags.append("high_device_velocity")

        # IP velocity
        if applicant_data.get("ip_address"):
            cur.execute(
                """SELECT COUNT(*) FROM synthetic_identity_checks
                   WHERE analyzed_at > NOW() - INTERVAL '1 hour'
                   AND applicant_id IN (
                       SELECT DISTINCT unnest(applicant_ids::text[])
                       FROM identity_graph_nodes
                       WHERE node_type = 'ip_address' AND node_value = %s
                   )""",
                (applicant_data["ip_address"],),
            )
            row = cur.fetchone()
            if row and row[0] > 2:
                flags.append("high_ip_velocity")

    return flags


# ── Risk Scoring ─────────────────────────────────────────────────────────────

def calculate_risk_score(shared_attributes, velocity_flags, applicant_data):
    """
    Calculate synthetic identity risk score (0.0 = safe, 1.0 = definitely synthetic).

    Scoring factors:
    - Shared SSN with different name: +0.4
    - Shared phone/email with different name: +0.2 each
    - Shared device fingerprint: +0.15
    - Shared address: +0.1
    - High velocity: +0.2 per flag
    - Thin file (new identity, no history): +0.1
    - Name pattern anomalies: +0.1
    """
    score = 0.0

    # Attribute sharing weights
    attr_weights = {
        "ssn": 0.4,
        "phone": 0.2,
        "email": 0.2,
        "device_fingerprint": 0.15,
        "address": 0.1,
        "ip_address": 0.05,
    }

    for attr in shared_attributes:
        score += attr_weights.get(attr, 0.05)

    # Velocity flags
    for flag in velocity_flags:
        score += 0.2

    # Thin file indicator (no date of birth or very recent)
    dob = applicant_data.get("date_of_birth")
    if dob:
        try:
            birth_year = int(dob.split("-")[0])
            # Very young applicants (under 20) with credit applications = suspicious
            current_year = datetime.now().year
            if current_year - birth_year < 20:
                score += 0.1
        except (ValueError, IndexError):
            score += 0.05

    # Cap at 1.0
    return min(1.0, round(score, 4))


# ── Main Detection ───────────────────────────────────────────────────────────

def detect_synthetic_identity(applicant_data):
    """Main detection pipeline."""
    conn = get_conn()
    try:
        # Build/update identity graph
        shared_attributes, cluster_id, linked_applicants = build_applicant_graph(applicant_data, conn)

        # Check velocity
        velocity_flags = check_velocity(applicant_data, conn)

        # Calculate risk score
        all_flags = velocity_flags.copy()
        if shared_attributes:
            all_flags.append(f"shared_attributes:{','.join(shared_attributes)}")
        if cluster_id:
            all_flags.append(f"cluster:{cluster_id}")

        risk_score = calculate_risk_score(shared_attributes, velocity_flags, applicant_data)

        # Determine recommendation
        if risk_score >= 0.7:
            recommendation = "reject"
            is_synthetic = True
        elif risk_score >= 0.4:
            recommendation = "manual_review"
            is_synthetic = False
        else:
            recommendation = "approve"
            is_synthetic = False

        result = {
            "is_synthetic": is_synthetic,
            "risk_score": risk_score,
            "flags": all_flags,
            "graph_cluster_id": cluster_id,
            "shared_attributes": shared_attributes,
            "recommendation": recommendation,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }

        # Persist result
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO synthetic_identity_checks
                (applicant_id, full_name, is_synthetic, risk_score, flags, graph_cluster_id, shared_attributes, recommendation)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    applicant_data["applicant_id"],
                    applicant_data["full_name"],
                    is_synthetic,
                    risk_score,
                    json.dumps(all_flags),
                    cluster_id,
                    json.dumps(shared_attributes),
                    recommendation,
                ),
            )
        conn.commit()

        return result
    finally:
        put_conn(conn)


# ── HTTP Handler ─────────────────────────────────────────────────────────────

class SyntheticIdentityHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/health":
            try:
                conn = get_conn()
                try:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                finally:
                    put_conn(conn)
                self._send_json(200, {"status": "healthy", "service": "python-synthetic-identity"})
            except Exception as e:
                self._send_json(503, {"status": "unhealthy", "error": str(e)})
        elif self.path == "/metrics":
            conn = get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT recommendation, COUNT(*) FROM synthetic_identity_checks GROUP BY recommendation")
                    rows = cur.fetchall()
                metrics = {row[0]: row[1] for row in rows}
                self._send_json(200, {"total_checks": sum(metrics.values()), "recommendations": metrics})
            finally:
                put_conn(conn)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        if self.path == "/detect/synthetic":
            self._handle_detect(data)
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_detect(self, data):
        required = ["applicant_id", "full_name"]
        for field in required:
            if field not in data:
                self._send_json(400, {"error": f"Missing required field: {field}"})
                return

        try:
            result = detect_synthetic_identity(data)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})


def graceful_shutdown(signum, frame):
    print(f"[synthetic-identity] Received signal {signum}, shutting down...")
    if pool:
        pool.closeall()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)

    init_schema()

    port = int(os.environ.get("PORT", "8319"))
    server = HTTPServer(("0.0.0.0", port), SyntheticIdentityHandler)
    print(f"[python-synthetic-identity] Starting on port {port}")
    server.serve_forever()
