#!/usr/bin/env python3
"""
RemitFlow - APISIX stablecoin route loader.
Applies infra/apisix/stablecoin-routes.yaml via the Admin API. Idempotent:
routes/upstreams are PUT by ID. Only plugins shipped with apache/apisix:3.9
are applied; anything else is stripped with a loud warning.
Usage: apply-stablecoin-routes.py [ADMIN_URL] [YAML_PATH]
Env: APISIX_ADMIN_KEY (required), APISIX_ADMIN_URL, APP_UPSTREAM
"""
import json, os, sys, urllib.error, urllib.request
import yaml

ALLOWED_PLUGINS = {"limit-count","limit-req","api-breaker","hmac-auth","key-auth",
    "jwt-auth","cors","proxy-rewrite","response-rewrite","ip-restriction",
    "openid-connect","prometheus"}

def fail(msg):
    print(f"[stablecoin-routes] ERROR: {msg}", file=sys.stderr); sys.exit(1)

def admin_request(method, url, key, payload):
    req = urllib.request.Request(url, method=method, data=json.dumps(payload).encode(),
        headers={"X-API-KEY": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        fail(f"APISIX Admin API unreachable at {url}: {e}")

def sanitize_plugins(route_id, plugins):
    kept, dropped = {}, []
    for name, conf in (plugins or {}).items():
        (kept.__setitem__(name, conf) if name in ALLOWED_PLUGINS else dropped.append(name))
    if dropped:
        print(f"[stablecoin-routes] WARN route {route_id}: dropped non-stock plugins {dropped}")
    return kept

def main():
    admin_url = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("APISIX_ADMIN_URL", "")).rstrip("/")
    yaml_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(__file__), "..", "..", "infra", "apisix", "stablecoin-routes.yaml")
    admin_key = os.environ.get("APISIX_ADMIN_KEY", "")
    if not admin_url: fail("APISIX admin URL not provided (argv[1] or APISIX_ADMIN_URL)")
    if not admin_key: fail("APISIX_ADMIN_KEY is not set - refusing to configure the gateway without credentials")
    if not os.path.exists(yaml_path): fail(f"route file not found: {yaml_path}")
    with open(yaml_path) as fh: doc = yaml.safe_load(fh)
    for upstream in doc.get("upstreams", []):
        uid = upstream["id"]
        nodes = {f"{n['host']}:{n['port']}": n.get("weight", 1) for n in upstream.get("nodes", [])}
        override = os.environ.get("APP_UPSTREAM")
        if override and uid == "remitflow-backend":
            nodes = {override.replace("http://", "").replace("https://", ""): 1}
        body = {"id": uid, "type": upstream.get("type", "roundrobin"),
                "scheme": "http", "nodes": nodes, "pass_host": "pass"}
        if upstream.get("health_check"): body["checks"] = upstream["health_check"]
        status, resp = admin_request("PUT", f"{admin_url}/apisix/admin/upstreams/{uid}", admin_key, body)
        if status >= 400: fail(f"upstream {uid} rejected: HTTP {status} {resp.decode(errors='replace')}")
        print(f"[stablecoin-routes] upstream {uid} applied (HTTP {status})")
    for route in doc.get("routes", []):
        rid = route["id"]
        body = {"id": rid, "uri": route["uri"], "methods": route.get("methods", ["GET"]),
                "upstream_id": route["upstream_id"],
                "plugins": sanitize_plugins(rid, route.get("plugins", {})), "status": 1}
        status, resp = admin_request("PUT", f"{admin_url}/apisix/admin/routes/{rid}", admin_key, body)
        if status >= 400: fail(f"route {rid} rejected: HTTP {status} {resp.decode(errors='replace')}")
        print(f"[stablecoin-routes] route {rid} applied (HTTP {status})")
    print(f"[stablecoin-routes] done - {len(doc.get('routes', []))} routes, "
          f"{len(doc.get('upstreams', []))} upstreams from {yaml_path}")

if __name__ == "__main__":
    main()
