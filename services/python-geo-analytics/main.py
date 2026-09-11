"""
RemitFlow Geo Analytics Service (Python, stdlib-only) — Wave 10 C6

HTTP service on GEO_PORT (default 8114).

Endpoints:
  GET  /health              — liveness (unauthenticated)
  POST /corridor-coverage   — per-corridor agent/float coverage statistics
  POST /agent-heatmap       — grid aggregation of agent float

Security (fail closed):
  - POST endpoints require header X-Service-Key matching INTERNAL_SERVICE_KEY
    (constant-time compare). INTERNAL_SERVICE_KEY unset -> 503 on every POST.

Honesty discipline:
  - NEVER fabricate geo data. Empty/invalid input -> empty result + "warning".
  - Optional GeoLibre (`geolib`) import is guarded: when unavailable the core
    statistics are still computed with stdlib haversine math and the response
    carries geoEngine:"haversine-stdlib" (vs "geolib" when the enhanced engine
    is actually used).

Telemetry (Wave 11, fail-soft):
  - OpenTelemetry via the shared guarded helper (services/_shared/otel_helper.py).
    When the opentelemetry packages (or the helper itself) are unavailable the
    service boots and serves normally, logs one WARN, and /health honestly
    reports telemetry:"disabled-no-sdk" — telemetry is never faked.
  - Per-request server spans (method+path) on every endpoint, tenant.id from
    the X-Tenant-Id header, and child spans around the corridor-coverage /
    agent-heatmap computations carrying the engine-honesty flag as an attribute.
"""

import contextlib
import hmac
import json
import math
import os
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Optional

PORT = int(os.getenv("GEO_PORT", "8114"))

# ─── Optional GeoLibre engine (guarded) ──────────────────────────────────────
try:
    import geolib  # type: ignore  # GeoLibre — optional enhanced spatial ops

    _HAS_GEOLIB = True
except ImportError:
    geolib = None  # type: ignore
    _HAS_GEOLIB = False


# ─── Shared OpenTelemetry helper (guarded; inline no-op shim fallback) ────────
class _OtelShim:
    """No-op stand-in used only when services/_shared/otel_helper.py cannot be
    imported at all (e.g. a minimal container that copies just this directory).
    Keeps every call site identical to the real helper's disabled mode."""

    OTEL_AVAILABLE = False

    @staticmethod
    def init_telemetry(*_a: Any, **_k: Any) -> bool:
        return False

    @staticmethod
    def telemetry_status() -> str:
        return "disabled-no-sdk"

    @staticmethod
    @contextlib.contextmanager
    def span(*_a: Any, **_k: Any):
        yield None

    @staticmethod
    def set_span_attributes(*_a: Any, **_k: Any) -> None:
        return None

    @staticmethod
    def set_tenant(*_a: Any, **_k: Any) -> None:
        return None

    @staticmethod
    def record_request(*_a: Any, **_k: Any) -> None:
        return None


try:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from _shared import otel_helper as otel
except Exception:  # helper file absent → run without telemetry, honestly
    otel = _OtelShim()  # type: ignore

OTEL_ENABLED = otel.init_telemetry("python-geo-analytics", service_version="1.0.0")
if not OTEL_ENABLED:
    print(
        "[python-geo-analytics] WARN: OpenTelemetry SDK unavailable — "
        "telemetry disabled (fail-soft; service boots and serves normally)"
    )

# ─── Geo math (stdlib) ───────────────────────────────────────────────────────

EARTH_RADIUS_KM = 6371.0088
KM_PER_DEG_LAT = 111.32  # mean meridional degree length (equirectangular approx)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (WGS84 mean radius)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    a = min(1.0, max(0.0, a))
    return 2.0 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _geolib_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> Optional[float]:
    """Best-effort GeoLibre distance; None when unavailable or incompatible."""
    if not _HAS_GEOLIB:
        return None
    try:
        # GeoLibre exposes a haversine-style helper in recent releases; guard
        # every access so API drift degrades to stdlib, never to an error.
        fn = getattr(geolib, "haversine", None) or getattr(geolib, "getDistance", None)
        if not callable(fn):
            return None
        d = fn((lat1, lon1), (lat2, lon2))
        d = float(d)
        # Normalize: some builds return meters.
        return d / 1000.0 if d > 10000.0 else d
    except Exception:
        return None


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple:
    """Returns (distance_km, engine_used)."""
    d = _geolib_distance_km(lat1, lon1, lat2, lon2)
    if d is not None:
        return d, "geolib"
    return haversine_km(lat1, lon1, lat2, lon2), "haversine-stdlib"


def point_to_segment_km(
    plat: float, plon: float,
    alat: float, alon: float,
    blat: float, blon: float,
) -> float:
    """
    Approximate distance (km) from point P to the great-circle segment A->B.

    Uses a local equirectangular projection centered on A (accurate to well
    under 1% for corridor-scale distances), then planar point-to-segment.
    Pure stdlib math — no fabricated geometry.
    """
    lat0 = math.radians(alat)
    kx = KM_PER_DEG_LAT * math.cos(lat0)  # km per degree longitude at A
    ky = KM_PER_DEG_LAT                   # km per degree latitude

    px, py = (plon - alon) * kx, (plat - alat) * ky
    ax, ay = 0.0, 0.0
    bx, by = (blon - alon) * kx, (blat - alat) * ky

    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))
    closest_x, closest_y = ax + t * dx, ay + t * dy
    return math.hypot(px - closest_x, py - closest_y)


# ─── Input validation (never fabricate; skip invalid, report honestly) ───────

def _valid_coord(lat: Any, lon: Any) -> bool:
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    return -90.0 <= la <= 90.0 and -180.0 <= lo <= 180.0


def _parse_agents(raw: Any) -> tuple:
    """Returns (agents, skipped, missing_float)."""
    agents, skipped, missing_float = [], 0, 0
    if not isinstance(raw, list):
        return agents, skipped, missing_float
    for i, a in enumerate(raw):
        if not isinstance(a, dict) or not _valid_coord(a.get("lat"), a.get("lon")):
            skipped += 1
            continue
        agent_id = a.get("id", f"agent-{i}")
        float_usd = a.get("floatUsd")
        try:
            float_usd = float(float_usd)
            if float_usd < 0:
                raise ValueError
        except (TypeError, ValueError):
            float_usd = 0.0
            missing_float += 1
        agents.append({
            "id": str(agent_id),
            "lat": float(a["lat"]),
            "lon": float(a["lon"]),
            "floatUsd": float_usd,
            "country": str(a.get("country", "")) or None,
        })
    return agents, skipped, missing_float


def _parse_corridors(raw: Any) -> tuple:
    """Returns (corridors, skipped)."""
    corridors, skipped = [], 0
    if not isinstance(raw, list):
        return corridors, skipped
    for i, c in enumerate(raw):
        if not isinstance(c, dict):
            skipped += 1
            continue
        if not all(_valid_coord(c.get(k), c.get(k2)) for k, k2 in
                   (("originLat", "originLon"), ("destLat", "destLon"))):
            skipped += 1
            continue
        corridors.append({
            "code": str(c.get("code", f"corridor-{i}")),
            "originLat": float(c["originLat"]),
            "originLon": float(c["originLon"]),
            "destLat": float(c["destLat"]),
            "destLon": float(c["destLon"]),
        })
    return corridors, skipped


def _positive_float(value: Any, default: float, cap: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if v <= 0 or v > cap:
        return default
    return v


# ─── Analytics ───────────────────────────────────────────────────────────────

def corridor_coverage(body: dict) -> dict:
    """
    Per-corridor agent coverage: agents within radiusKm of the corridor path
    (origin->destination segment), float totals, density ratios, and the
    underserved corridor list per caller-supplied thresholds.
    """
    agents, agents_skipped, missing_float = _parse_agents(body.get("agents"))
    corridors, corridors_skipped = _parse_corridors(body.get("corridors"))
    radius_km = _positive_float(body.get("radiusKm"), 25.0, 500.0)
    min_agents = int(_positive_float(body.get("minAgentsPerCorridor"), 1.0, 1e6))
    min_float_per_km = _positive_float(body.get("minFloatUsdPerKm"), 0.0, 1e9)

    warnings = []
    if agents_skipped:
        warnings.append(f"{agents_skipped} agent record(s) skipped (invalid coordinates)")
    if corridors_skipped:
        warnings.append(f"{corridors_skipped} corridor record(s) skipped (invalid coordinates)")
    if missing_float:
        warnings.append(f"{missing_float} agent record(s) missing/invalid floatUsd; counted as 0")
    if not agents or not corridors:
        warnings.append("empty input: no agents or no corridors supplied; result is empty (no data fabricated)")

    engine_used = "geolib" if _HAS_GEOLIB else "haversine-stdlib"
    results = []
    underserved = []
    assigned_agent_ids = set()

    for c in corridors:
        corridor_km, eng = distance_km(c["originLat"], c["originLon"], c["destLat"], c["destLon"])
        if eng == "haversine-stdlib":
            engine_used = "haversine-stdlib"  # any stdlib fallback marks the run
        near, near_float, nearest = [], 0.0, None
        for a in agents:
            d = point_to_segment_km(
                a["lat"], a["lon"],
                c["originLat"], c["originLon"],
                c["destLat"], c["destLon"],
            )
            if nearest is None or d < nearest:
                nearest = d
            if d <= radius_km:
                near.append(a)
                near_float += a["floatUsd"]
                assigned_agent_ids.add(a["id"])
        count = len(near)
        float_per_km = (near_float / corridor_km) if corridor_km > 0 else None
        agents_per_100km = (count / corridor_km * 100.0) if corridor_km > 0 else None
        is_underserved = count < min_agents or (
            min_float_per_km > 0 and float_per_km is not None and float_per_km < min_float_per_km
        ) or (min_float_per_km > 0 and float_per_km is None and count == 0)
        if is_underserved:
            underserved.append(c["code"])
        results.append({
            "code": c["code"],
            "corridorKm": round(corridor_km, 3),
            "agentsWithinRadius": count,
            "agentIds": [a["id"] for a in near],
            "floatUsdWithinRadius": round(near_float, 2),
            "agentsPer100Km": round(agents_per_100km, 4) if agents_per_100km is not None else None,
            "floatUsdPerKm": round(float_per_km, 2) if float_per_km is not None else None,
            "fleetShare": round(count / len(agents), 4) if agents else None,
            "nearestAgentKm": round(nearest, 3) if nearest is not None else None,
            "underserved": is_underserved,
        })

    return {
        "geoEngine": engine_used,
        "radiusKm": radius_km,
        "thresholds": {
            "minAgentsPerCorridor": min_agents,
            "minFloatUsdPerKm": min_float_per_km,
        },
        "summary": {
            "agentsTotal": len(agents),
            "corridorsTotal": len(corridors),
            "corridorsUnderserved": len(underserved),
            "agentsOutsideAllCorridors": len([a for a in agents if a["id"] not in assigned_agent_ids]),
        },
        "corridors": results,
        "underservedCorridors": underserved,
        "warnings": warnings,
    }


def agent_heatmap(body: dict) -> dict:
    """Grid aggregation of agent float over a square lat/lon grid."""
    agents, agents_skipped, missing_float = _parse_agents(body.get("agents"))
    cell_size_km = _positive_float(body.get("cellSizeKm"), 50.0, 2000.0)
    cell_deg = cell_size_km / KM_PER_DEG_LAT

    warnings = []
    if agents_skipped:
        warnings.append(f"{agents_skipped} agent record(s) skipped (invalid coordinates)")
    if missing_float:
        warnings.append(f"{missing_float} agent record(s) missing/invalid floatUsd; counted as 0")
    if not agents:
        warnings.append("empty input: no agents supplied; heatmap is empty (no data fabricated)")

    cells: dict = {}
    for a in agents:
        key = (math.floor(a["lat"] / cell_deg), math.floor(a["lon"] / cell_deg))
        cell = cells.setdefault(key, {"agentCount": 0, "totalFloatUsd": 0.0})
        cell["agentCount"] += 1
        cell["totalFloatUsd"] += a["floatUsd"]

    out = []
    for (ilat, ilon), agg in sorted(cells.items()):
        lat0, lon0 = ilat * cell_deg, ilon * cell_deg
        out.append({
            "cell": {
                "latMin": round(lat0, 6),
                "latMax": round(lat0 + cell_deg, 6),
                "lonMin": round(lon0, 6),
                "lonMax": round(lon0 + cell_deg, 6),
            },
            "center": {
                "lat": round(lat0 + cell_deg / 2.0, 6),
                "lon": round(lon0 + cell_deg / 2.0, 6),
            },
            "agentCount": agg["agentCount"],
            "totalFloatUsd": round(agg["totalFloatUsd"], 2),
        })

    return {
        "geoEngine": "grid-equirectangular-stdlib",
        "cellSizeKm": cell_size_km,
        "summary": {"agentsTotal": len(agents), "cellsTotal": len(out)},
        "cells": out,
        "warnings": warnings,
    }


# ─── HTTP server (mirrors python-p2p-intelligence structure) ─────────────────

class GeoAnalyticsHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass  # suppress default logging

    def _send_json(self, data: dict, status: int = 200) -> None:
        self._last_status = status  # observed by the per-request span/metrics
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > 10 * 1024 * 1024:
            return {}
        return json.loads(self.rfile.read(length))

    def _check_service_key(self) -> bool:
        """Fail closed: key unset -> 503; mismatch -> 401 (constant-time)."""
        expected = os.environ.get("INTERNAL_SERVICE_KEY")
        if not expected:
            self._send_json({"error": "INTERNAL_SERVICE_KEY not configured; service fails closed"}, 503)
            return False
        provided = self.headers.get("X-Service-Key", "")
        if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
            self._send_json({"error": "unauthorized"}, 401)
            return False
        return True

    def _start_request_span(self, method: str):
        """Per-request server span (method+path) + tenant.id propagation."""
        self._last_status = 200
        self._req_start = time.monotonic()
        ctx = otel.span(
            f"{method} {self.path}",
            kind="server",
            attributes={"http.request.method": method, "url.path": self.path},
        )
        ctx.__enter__()
        otel.set_tenant(self.headers.get("X-Tenant-Id"))
        return ctx

    def _finish_request_span(self, method: str, ctx) -> None:
        try:
            ctx.__exit__(*sys.exc_info())
        finally:
            otel.record_request(
                method,
                self.path,
                getattr(self, "_last_status", 200),
                time.monotonic() - getattr(self, "_req_start", time.monotonic()),
            )

    def do_GET(self) -> None:
        ctx = self._start_request_span("GET")
        try:
            if self.path == "/health":
                self._send_json({
                    "status": "ok",
                    "service": "geo-analytics",
                    "geoEngine": "geolib" if _HAS_GEOLIB else "haversine-stdlib",
                    "telemetry": otel.telemetry_status(),
                    "authConfigured": bool(os.environ.get("INTERNAL_SERVICE_KEY")),
                    "endpoints": ["/corridor-coverage", "/agent-heatmap"],
                    "model_version": "1.0.0",
                })
            else:
                self._send_json({"error": "Not found"}, 404)
        finally:
            self._finish_request_span("GET", ctx)

    def do_POST(self) -> None:
        ctx = self._start_request_span("POST")
        try:
            if not self._check_service_key():
                return
            try:
                body = self._read_body()
            except (json.JSONDecodeError, ValueError):
                self._send_json({"error": "Invalid JSON"}, 400)
                return
            if not isinstance(body, dict):
                self._send_json({"error": "JSON object body required"}, 400)
                return

            if self.path == "/corridor-coverage":
                with otel.span("compute.corridor-coverage", kind="internal") as child:
                    result = corridor_coverage(body)
                    summary = result.get("summary", {})
                    otel.set_span_attributes(child, {
                        "geo.corridors.count": summary.get("corridorsTotal", 0),
                        "geo.agents.count": summary.get("agentsTotal", 0),
                        "geo.corridors.underserved": summary.get("corridorsUnderserved", 0),
                        # engine-honesty flag surfaced as a span attribute:
                        "geo.engine": result.get("geoEngine"),
                    })
                self._send_json(result)
            elif self.path == "/agent-heatmap":
                with otel.span("compute.agent-heatmap", kind="internal") as child:
                    result = agent_heatmap(body)
                    summary = result.get("summary", {})
                    otel.set_span_attributes(child, {
                        "geo.agents.count": summary.get("agentsTotal", 0),
                        "geo.cells.count": summary.get("cellsTotal", 0),
                        # engine-honesty flag surfaced as a span attribute:
                        "geo.engine": result.get("geoEngine"),
                    })
                self._send_json(result)
            else:
                self._send_json({"error": "Not found"}, 404)
        finally:
            self._finish_request_span("POST", ctx)


# Graceful shutdown handling
_shutdown_flag = False


def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    print(f"[python-geo-analytics] Received signal {signum}, shutting down...")


signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), GeoAnalyticsHandler)
    server.timeout = 0.5  # lets the loop observe _shutdown_flag (SIGTERM-safe stop)
    print(f"[Geo Analytics Python] Running on port {PORT}")
    print(f"[Geo Analytics Python] Endpoints: /health, /corridor-coverage, /agent-heatmap")
    print(f"[Geo Analytics Python] geo engine: {'geolib (GeoLibre)' if _HAS_GEOLIB else 'haversine-stdlib'}")
    print(f"[Geo Analytics Python] telemetry: {otel.telemetry_status()}")
    while not _shutdown_flag:
        server.handle_request()
    server.server_close()
    print("[Geo Analytics Python] stopped cleanly")
