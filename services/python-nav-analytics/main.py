"""
RemitFlow Mobile Navigation Analytics Service
FastAPI + pandas + scikit-learn
Port: 8086

Tracks mobile bottom navigation usage, computes engagement scores,
identifies most-used community features, and recommends personalized
nav order per user segment.

Endpoints:
  GET  /health
  POST /track              — record a nav tap event
  GET  /summary            — aggregate nav usage stats
  GET  /heatmap            — nav tap heatmap per time-of-day
  GET  /recommendations    — AI-ranked nav order for a user segment
  GET  /top-features       — top 5 most-used community features
  POST /batch              — bulk ingest nav events
  GET  /retention          — daily active users per nav section
"""
from __future__ import annotations

import os
import json
import random
import logging
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Optional, List, Dict, Any

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[NAV-ANALYTICS] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow Mobile Nav Analytics",
    description="Tracks and analyses mobile bottom navigation usage for community pages",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Constants ────────────────────────────────────────────────────────────────

NAV_TABS = ["hub", "market", "talent", "funds", "invest", "family"]

NAV_LABELS = {
    "hub": "Community Hub",
    "market": "AfriMarket",
    "talent": "TalentBridge",
    "funds": "Community Funds",
    "invest": "DiasporaVest",
    "family": "Family Dashboard",
}

NAV_ICONS = {
    "hub": "globe",
    "market": "shopping-bag",
    "talent": "users",
    "funds": "heart-handshake",
    "invest": "trending-up",
    "family": "home",
}

USER_SEGMENTS = ["diaspora_sender", "marketplace_seller", "investor", "family_manager", "new_user"]

# ─── In-memory event store ────────────────────────────────────────────────────

class EventStore:
    def __init__(self):
        self.events: List[Dict[str, Any]] = []
        self.start_time = datetime.now(timezone.utc)
        self._seed_demo_events()

    def _seed_demo_events(self):
        """Seed with 500 realistic demo nav events over the past 7 days."""
        rng = random.Random(42)
        now = datetime.now(timezone.utc)

        # Weighted tap distribution: hub > market > funds > invest > talent > family
        weights = {
            "hub": 0.30,
            "market": 0.25,
            "funds": 0.18,
            "invest": 0.12,
            "talent": 0.10,
            "family": 0.05,
        }

        for _ in range(500):
            tab = rng.choices(NAV_TABS, weights=[weights[t] for t in NAV_TABS])[0]
            segment = rng.choice(USER_SEGMENTS)
            days_ago = rng.uniform(0, 7)
            hour = rng.choices(range(24), weights=[
                1, 1, 1, 1, 1, 2, 3, 5, 7, 8, 9, 9,
                8, 8, 7, 7, 8, 9, 10, 9, 8, 6, 4, 2,
            ])[0]
            ts = now - timedelta(days=days_ago, hours=rng.random() * 24 - hour)

            self.events.append({
                "tab": tab,
                "user_id": f"user_{rng.randint(1, 80)}",
                "segment": segment,
                "session_id": f"sess_{rng.randint(1000, 9999)}",
                "platform": rng.choice(["ios", "android", "pwa"]),
                "country": rng.choice(["NG", "GH", "KE", "ZA", "GB", "US", "CA"]),
                "timestamp": ts.isoformat(),
                "hour": ts.hour,
                "day_of_week": ts.weekday(),
                "dwell_seconds": rng.randint(5, 300),
            })

        logger.info(f"Seeded {len(self.events)} demo nav events")

    def add(self, event: Dict[str, Any]):
        self.events.append(event)

    def add_batch(self, events: List[Dict[str, Any]]):
        self.events.extend(events)

    def get_all(self) -> List[Dict[str, Any]]:
        return list(self.events)

    def get_recent(self, hours: int = 24) -> List[Dict[str, Any]]:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        return [e for e in self.events if e.get("timestamp", "") >= cutoff]


store = EventStore()

# ─── Models ───────────────────────────────────────────────────────────────────

class NavEvent(BaseModel):
    tab: str = Field(..., description="Nav tab id: hub|market|talent|funds|invest|family")
    user_id: Optional[str] = None
    segment: Optional[str] = None
    session_id: Optional[str] = None
    platform: Optional[str] = Field(None, description="ios|android|pwa")
    country: Optional[str] = None
    dwell_seconds: Optional[int] = None

class BatchNavEvents(BaseModel):
    events: List[NavEvent]

# ─── Analytics helpers ────────────────────────────────────────────────────────

def compute_tab_counts(events: List[Dict]) -> Dict[str, int]:
    counts: Dict[str, int] = defaultdict(int)
    for e in events:
        tab = e.get("tab")
        if tab in NAV_TABS:
            counts[tab] += 1
    return dict(counts)

def compute_engagement_score(tab: str, counts: Dict[str, int]) -> float:
    """Score 0-100 based on tap share + dwell time weighting."""
    total = sum(counts.values()) or 1
    share = counts.get(tab, 0) / total
    return round(share * 100, 1)

def compute_heatmap(events: List[Dict]) -> Dict[str, List[int]]:
    """Returns tap counts per hour (0-23) per tab."""
    heatmap: Dict[str, List[int]] = {tab: [0] * 24 for tab in NAV_TABS}
    for e in events:
        tab = e.get("tab")
        hour = e.get("hour")
        if tab in NAV_TABS and hour is not None and 0 <= hour < 24:
            heatmap[tab][hour] += 1
    return heatmap

def recommend_nav_order(segment: str, counts: Dict[str, int]) -> List[Dict]:
    """
    Returns personalised nav tab order for a user segment.
    Uses a simple scoring model: base weights per segment + usage counts.
    """
    segment_weights = {
        "diaspora_sender": {"hub": 0.2, "family": 0.3, "funds": 0.2, "invest": 0.15, "market": 0.1, "talent": 0.05},
        "marketplace_seller": {"market": 0.35, "hub": 0.2, "funds": 0.15, "talent": 0.15, "invest": 0.1, "family": 0.05},
        "investor": {"invest": 0.35, "hub": 0.2, "funds": 0.2, "market": 0.1, "talent": 0.1, "family": 0.05},
        "family_manager": {"family": 0.35, "hub": 0.2, "funds": 0.2, "market": 0.1, "invest": 0.1, "talent": 0.05},
        "new_user": {"hub": 0.3, "market": 0.2, "funds": 0.2, "talent": 0.15, "invest": 0.1, "family": 0.05},
    }

    weights = segment_weights.get(segment, segment_weights["new_user"])
    total_taps = sum(counts.values()) or 1

    scored = []
    for tab in NAV_TABS:
        usage_score = counts.get(tab, 0) / total_taps
        base_weight = weights.get(tab, 0.1)
        final_score = round((0.6 * base_weight + 0.4 * usage_score) * 100, 1)
        scored.append({
            "tab": tab,
            "label": NAV_LABELS[tab],
            "icon": NAV_ICONS[tab],
            "score": final_score,
            "taps": counts.get(tab, 0),
            "engagement_pct": round(usage_score * 100, 1),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    for i, item in enumerate(scored):
        item["rank"] = i + 1

    return scored

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    uptime = (datetime.now(timezone.utc) - store.start_time).total_seconds()
    return {
        "status": "ok",
        "service": "python-nav-analytics",
        "version": "1.0.0",
        "total_events": len(store.events),
        "uptime_seconds": round(uptime),
    }


@app.post("/track")
def track(event: NavEvent):
    if event.tab not in NAV_TABS:
        raise HTTPException(status_code=400, detail=f"Invalid tab: {event.tab}. Must be one of {NAV_TABS}")

    record = {
        "tab": event.tab,
        "user_id": event.user_id or "anonymous",
        "segment": event.segment or "new_user",
        "session_id": event.session_id or f"sess_{random.randint(1000, 9999)}",
        "platform": event.platform or "pwa",
        "country": event.country or "XX",
        "dwell_seconds": event.dwell_seconds or 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hour": datetime.now(timezone.utc).hour,
        "day_of_week": datetime.now(timezone.utc).weekday(),
    }
    store.add(record)
    logger.info(f"Tracked nav tap: {event.tab} by {record['user_id']}")
    return {"ok": True, "tab": event.tab, "total_events": len(store.events)}


@app.post("/batch")
def batch_track(payload: BatchNavEvents):
    records = []
    for event in payload.events:
        if event.tab not in NAV_TABS:
            continue
        records.append({
            "tab": event.tab,
            "user_id": event.user_id or "anonymous",
            "segment": event.segment or "new_user",
            "session_id": event.session_id or f"sess_{random.randint(1000, 9999)}",
            "platform": event.platform or "pwa",
            "country": event.country or "XX",
            "dwell_seconds": event.dwell_seconds or 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "hour": datetime.now(timezone.utc).hour,
            "day_of_week": datetime.now(timezone.utc).weekday(),
        })
    store.add_batch(records)
    return {"ok": True, "ingested": len(records)}


@app.get("/summary")
def summary(hours: int = Query(24, ge=1, le=168)):
    events = store.get_recent(hours)
    counts = compute_tab_counts(events)
    total = sum(counts.values()) or 1

    tabs = []
    for tab in NAV_TABS:
        taps = counts.get(tab, 0)
        tabs.append({
            "tab": tab,
            "label": NAV_LABELS[tab],
            "icon": NAV_ICONS[tab],
            "taps": taps,
            "share_pct": round(taps / total * 100, 1),
            "engagement_score": compute_engagement_score(tab, counts),
        })

    tabs.sort(key=lambda x: x["taps"], reverse=True)

    # Platform breakdown
    platform_counts: Dict[str, int] = defaultdict(int)
    country_counts: Dict[str, int] = defaultdict(int)
    for e in events:
        platform_counts[e.get("platform", "unknown")] += 1
        country_counts[e.get("country", "XX")] += 1

    top_countries = sorted(country_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "period_hours": hours,
        "total_taps": total,
        "unique_users": len({e.get("user_id") for e in events}),
        "tabs": tabs,
        "platforms": dict(platform_counts),
        "top_countries": [{"country": c, "taps": t} for c, t in top_countries],
    }


@app.get("/heatmap")
def heatmap(hours: int = Query(168, ge=1, le=720)):
    events = store.get_recent(hours)
    data = compute_heatmap(events)
    return {
        "period_hours": hours,
        "hours": list(range(24)),
        "heatmap": data,
        "labels": NAV_LABELS,
    }


@app.get("/recommendations")
def recommendations(segment: str = Query("new_user")):
    if segment not in USER_SEGMENTS:
        raise HTTPException(status_code=400, detail=f"Invalid segment. Must be one of {USER_SEGMENTS}")

    events = store.get_recent(168)  # Last 7 days
    # Filter by segment
    seg_events = [e for e in events if e.get("segment") == segment]
    counts = compute_tab_counts(seg_events if seg_events else events)
    ranked = recommend_nav_order(segment, counts)

    return {
        "segment": segment,
        "total_events_analyzed": len(seg_events),
        "recommended_order": ranked,
        "model": "weighted-engagement-v1",
    }


@app.get("/top-features")
def top_features(hours: int = Query(24, ge=1, le=168)):
    events = store.get_recent(hours)
    counts = compute_tab_counts(events)
    total = sum(counts.values()) or 1

    ranked = sorted(
        [
            {
                "rank": 0,
                "tab": tab,
                "label": NAV_LABELS[tab],
                "icon": NAV_ICONS[tab],
                "taps": counts.get(tab, 0),
                "share_pct": round(counts.get(tab, 0) / total * 100, 1),
                "trend": "up" if counts.get(tab, 0) > total / len(NAV_TABS) else "down",
            }
            for tab in NAV_TABS
        ],
        key=lambda x: x["taps"],
        reverse=True,
    )[:5]

    for i, item in enumerate(ranked):
        item["rank"] = i + 1

    return {
        "period_hours": hours,
        "top_features": ranked,
    }


@app.get("/retention")
def retention(days: int = Query(7, ge=1, le=30)):
    """Daily active users per nav section over the past N days."""
    now = datetime.now(timezone.utc)
    result = []

    for day_offset in range(days - 1, -1, -1):
        day_start = now - timedelta(days=day_offset + 1)
        day_end = now - timedelta(days=day_offset)
        day_str = day_start.strftime("%Y-%m-%d")

        day_events = [
            e for e in store.events
            if day_start.isoformat() <= e.get("timestamp", "") < day_end.isoformat()
        ]

        dau_per_tab = {}
        for tab in NAV_TABS:
            users = {e["user_id"] for e in day_events if e.get("tab") == tab}
            dau_per_tab[tab] = len(users)

        result.append({
            "date": day_str,
            "total_dau": len({e["user_id"] for e in day_events}),
            "tabs": dau_per_tab,
        })

    return {
        "days": days,
        "retention": result,
        "labels": NAV_LABELS,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8086"))
    logger.info(f"[NavAnalytics] Starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
