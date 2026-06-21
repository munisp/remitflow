"""
Alert Routing — PagerDuty, OpsGenie, and Slack Integration

Routes reconciliation engine alerts to external incident management systems.
Supports three channels:
  1. PagerDuty Events API v2 (for critical/high severity)
  2. OpsGenie Alert API (alternative to PagerDuty)
  3. Slack Incoming Webhook (for all severities)

Environment Variables:
  PAGERDUTY_ROUTING_KEY    — PagerDuty Events API v2 routing key
  PAGERDUTY_API_URL        — PagerDuty API URL (default: https://events.pagerduty.com/v2/enqueue)
  OPSGENIE_API_KEY         — OpsGenie API key
  OPSGENIE_API_URL         — OpsGenie API URL (default: https://api.opsgenie.com/v2/alerts)
  SLACK_WEBHOOK_URL        — Slack incoming webhook URL
  ALERT_ROUTING_CHANNELS   — comma-separated list of channels to use (default: "slack")
                             Options: pagerduty, opsgenie, slack
  ALERT_SEVERITY_THRESHOLD — minimum severity to route externally (default: "medium")
                             Options: critical, high, medium, low
"""

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import IntEnum
from typing import Optional

logger = logging.getLogger("alert-routing")

# ── Configuration ────────────────────────────────────────────────────────────

PAGERDUTY_ROUTING_KEY = os.environ.get("PAGERDUTY_ROUTING_KEY", "")
PAGERDUTY_API_URL = os.environ.get("PAGERDUTY_API_URL", "https://events.pagerduty.com/v2/enqueue")
OPSGENIE_API_KEY = os.environ.get("OPSGENIE_API_KEY", "")
OPSGENIE_API_URL = os.environ.get("OPSGENIE_API_URL", "https://api.opsgenie.com/v2/alerts")
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")
ALERT_ROUTING_CHANNELS = os.environ.get("ALERT_ROUTING_CHANNELS", "slack").split(",")
ALERT_SEVERITY_THRESHOLD = os.environ.get("ALERT_SEVERITY_THRESHOLD", "medium")


class Severity(IntEnum):
    LOW = 0
    MEDIUM = 1
    HIGH = 2
    CRITICAL = 3


SEVERITY_MAP = {
    "low": Severity.LOW,
    "medium": Severity.MEDIUM,
    "high": Severity.HIGH,
    "critical": Severity.CRITICAL,
}

THRESHOLD = SEVERITY_MAP.get(ALERT_SEVERITY_THRESHOLD, Severity.MEDIUM)


@dataclass
class AlertPayload:
    """Structured alert payload for external routing."""
    alert_id: str
    severity: str
    flow_type: str
    message: str
    operation_id: Optional[str]
    raised_at: str
    source: str = "remitflow-reconciliation-engine"
    metadata: Optional[dict] = None


# Metrics
routing_metrics = {
    "total_routed": 0,
    "pagerduty_sent": 0,
    "pagerduty_failed": 0,
    "opsgenie_sent": 0,
    "opsgenie_failed": 0,
    "slack_sent": 0,
    "slack_failed": 0,
    "below_threshold": 0,
}


# ── PagerDuty ────────────────────────────────────────────────────────────────

async def send_pagerduty(alert: AlertPayload) -> bool:
    """Send alert to PagerDuty Events API v2."""
    if not PAGERDUTY_ROUTING_KEY:
        logger.warning("[PagerDuty] PAGERDUTY_ROUTING_KEY not configured — skipping")
        return False

    pd_severity_map = {
        "critical": "critical",
        "high": "error",
        "medium": "warning",
        "low": "info",
    }

    payload = {
        "routing_key": PAGERDUTY_ROUTING_KEY,
        "event_action": "trigger",
        "dedup_key": f"remitflow-{alert.alert_id}",
        "payload": {
            "summary": f"[RemitFlow] {alert.severity.upper()}: {alert.message}",
            "severity": pd_severity_map.get(alert.severity, "warning"),
            "source": alert.source,
            "component": f"fund-flow-{alert.flow_type}",
            "group": "fund-flow-atomicity",
            "class": alert.flow_type,
            "timestamp": alert.raised_at,
            "custom_details": {
                "alert_id": alert.alert_id,
                "flow_type": alert.flow_type,
                "operation_id": alert.operation_id,
                "metadata": alert.metadata or {},
            },
        },
        "links": [
            {
                "href": f"https://remitflow.internal/admin/alerts/{alert.alert_id}",
                "text": "View in RemitFlow Dashboard",
            }
        ],
    }

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                PAGERDUTY_API_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201, 202):
                    routing_metrics["pagerduty_sent"] += 1
                    logger.info(f"[PagerDuty] Alert {alert.alert_id} sent successfully")
                    return True
                body = await resp.text()
                logger.error(f"[PagerDuty] Failed: {resp.status} — {body}")
                routing_metrics["pagerduty_failed"] += 1
                return False
    except ImportError:
        # aiohttp not available — use urllib
        import urllib.request
        req = urllib.request.Request(
            PAGERDUTY_API_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201, 202):
                    routing_metrics["pagerduty_sent"] += 1
                    return True
        except Exception as e:
            logger.error(f"[PagerDuty] Request failed: {e}")
            routing_metrics["pagerduty_failed"] += 1
            return False
    except Exception as e:
        logger.error(f"[PagerDuty] Error: {e}")
        routing_metrics["pagerduty_failed"] += 1
        return False
    return False


# ── OpsGenie ─────────────────────────────────────────────────────────────────

async def send_opsgenie(alert: AlertPayload) -> bool:
    """Send alert to OpsGenie Alert API."""
    if not OPSGENIE_API_KEY:
        logger.warning("[OpsGenie] OPSGENIE_API_KEY not configured — skipping")
        return False

    og_priority_map = {
        "critical": "P1",
        "high": "P2",
        "medium": "P3",
        "low": "P4",
    }

    payload = {
        "message": f"[RemitFlow] {alert.severity.upper()}: {alert.message}",
        "alias": f"remitflow-{alert.alert_id}",
        "description": (
            f"Flow Type: {alert.flow_type}\n"
            f"Operation ID: {alert.operation_id or 'N/A'}\n"
            f"Raised At: {alert.raised_at}\n"
            f"Source: {alert.source}"
        ),
        "priority": og_priority_map.get(alert.severity, "P3"),
        "source": alert.source,
        "tags": ["remitflow", "fund-flow", alert.flow_type, alert.severity],
        "details": {
            "alert_id": alert.alert_id,
            "flow_type": alert.flow_type,
            "operation_id": alert.operation_id or "",
        },
        "entity": f"fund-flow-{alert.flow_type}",
    }

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                OPSGENIE_API_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"GenieKey {OPSGENIE_API_KEY}",
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status in (200, 201, 202):
                    routing_metrics["opsgenie_sent"] += 1
                    logger.info(f"[OpsGenie] Alert {alert.alert_id} sent successfully")
                    return True
                body = await resp.text()
                logger.error(f"[OpsGenie] Failed: {resp.status} — {body}")
                routing_metrics["opsgenie_failed"] += 1
                return False
    except ImportError:
        import urllib.request
        req = urllib.request.Request(
            OPSGENIE_API_URL,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"GenieKey {OPSGENIE_API_KEY}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201, 202):
                    routing_metrics["opsgenie_sent"] += 1
                    return True
        except Exception as e:
            logger.error(f"[OpsGenie] Request failed: {e}")
            routing_metrics["opsgenie_failed"] += 1
            return False
    except Exception as e:
        logger.error(f"[OpsGenie] Error: {e}")
        routing_metrics["opsgenie_failed"] += 1
        return False
    return False


# ── Slack ─────────────────────────────────────────────────────────────────────

async def send_slack(alert: AlertPayload) -> bool:
    """Send alert to Slack via incoming webhook."""
    if not SLACK_WEBHOOK_URL:
        logger.warning("[Slack] SLACK_WEBHOOK_URL not configured — skipping")
        return False

    severity_emoji = {
        "critical": ":rotating_light:",
        "high": ":warning:",
        "medium": ":large_orange_diamond:",
        "low": ":information_source:",
    }

    severity_color = {
        "critical": "#FF0000",
        "high": "#FF6600",
        "medium": "#FFCC00",
        "low": "#0099FF",
    }

    payload = {
        "attachments": [
            {
                "color": severity_color.get(alert.severity, "#CCCCCC"),
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"{severity_emoji.get(alert.severity, ':bell:')} RemitFlow Fund Flow Alert",
                        },
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Severity:*\n{alert.severity.upper()}"},
                            {"type": "mrkdwn", "text": f"*Flow Type:*\n{alert.flow_type}"},
                            {"type": "mrkdwn", "text": f"*Operation ID:*\n{alert.operation_id or 'N/A'}"},
                            {"type": "mrkdwn", "text": f"*Alert ID:*\n{alert.alert_id}"},
                        ],
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Message:*\n{alert.message}",
                        },
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"Raised at {alert.raised_at} | Source: {alert.source}",
                            }
                        ],
                    },
                ],
            }
        ],
    }

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                SLACK_WEBHOOK_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    routing_metrics["slack_sent"] += 1
                    logger.info(f"[Slack] Alert {alert.alert_id} sent successfully")
                    return True
                body = await resp.text()
                logger.error(f"[Slack] Failed: {resp.status} — {body}")
                routing_metrics["slack_failed"] += 1
                return False
    except ImportError:
        import urllib.request
        req = urllib.request.Request(
            SLACK_WEBHOOK_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    routing_metrics["slack_sent"] += 1
                    return True
        except Exception as e:
            logger.error(f"[Slack] Request failed: {e}")
            routing_metrics["slack_failed"] += 1
            return False
    except Exception as e:
        logger.error(f"[Slack] Error: {e}")
        routing_metrics["slack_failed"] += 1
        return False
    return False


# ── Main Router ───────────────────────────────────────────────────────────────

async def route_alert(alert: AlertPayload) -> dict:
    """
    Route an alert to configured external channels.
    Returns a summary of which channels succeeded/failed.
    """
    severity = SEVERITY_MAP.get(alert.severity, Severity.MEDIUM)

    if severity < THRESHOLD:
        routing_metrics["below_threshold"] += 1
        logger.debug(f"[AlertRouter] Alert {alert.alert_id} below threshold ({alert.severity} < {ALERT_SEVERITY_THRESHOLD})")
        return {"routed": False, "reason": "below_threshold", "channels": {}}

    routing_metrics["total_routed"] += 1
    results = {}

    tasks = []
    channels_to_use = [c.strip() for c in ALERT_ROUTING_CHANNELS if c.strip()]

    for channel in channels_to_use:
        if channel == "pagerduty" and severity >= Severity.HIGH:
            tasks.append(("pagerduty", send_pagerduty(alert)))
        elif channel == "opsgenie" and severity >= Severity.HIGH:
            tasks.append(("opsgenie", send_opsgenie(alert)))
        elif channel == "slack":
            tasks.append(("slack", send_slack(alert)))

    for channel_name, coro in tasks:
        try:
            success = await coro
            results[channel_name] = "sent" if success else "failed"
        except Exception as e:
            results[channel_name] = f"error: {e}"
            logger.error(f"[AlertRouter] {channel_name} error: {e}")

    return {"routed": True, "channels": results}


def get_routing_metrics() -> dict:
    """Get alert routing metrics."""
    return dict(routing_metrics)


def get_routing_config() -> dict:
    """Get current alert routing configuration."""
    return {
        "channels": ALERT_ROUTING_CHANNELS,
        "severity_threshold": ALERT_SEVERITY_THRESHOLD,
        "pagerduty_configured": bool(PAGERDUTY_ROUTING_KEY),
        "opsgenie_configured": bool(OPSGENIE_API_KEY),
        "slack_configured": bool(SLACK_WEBHOOK_URL),
    }
