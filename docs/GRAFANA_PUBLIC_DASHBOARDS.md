# Grafana Public Dashboards — Setup Guide

## Overview

RemitFlow ships four Grafana dashboards that can be shared as read-only public
URLs — no login required. This is useful for sharing platform health with
stakeholders, investors, or on-call engineers without granting Grafana access.

## Dashboards

| Dashboard | UID | Purpose |
|---|---|---|
| Platform Overview | `platform-overview` | Cross-service KPIs, transaction volume, error rates |
| Go Services | `go-services` | API Gateway, NGX Price Feed, Corridor Pricing metrics |
| Rust Services | `rust-services` | FX Engine, TX Processor, Compliance Engine metrics |
| Python Services | `python-services` | Fraud Detection, AML Compliance, Analytics Engine metrics |

## Enabling Public Dashboards

### Step 1 — Start the observability stack

```bash
# Set your Slack webhook before starting
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

docker compose -f docker-compose.observability.yml up -d
```

### Step 2 — Generate public URLs

1. Open Grafana at `http://localhost:3001` (default: `admin` / `remitflow2026`)
2. Navigate to a dashboard (e.g., Platform Overview)
3. Click **Share** (top toolbar) → **Public Dashboard** tab
4. Toggle **Enable public access** → **Save**
5. Copy the generated URL — it is permanent and does not require login

### Step 3 — Share with stakeholders

The public URL format is:
```
http://localhost:3001/public-dashboards/{unique-uid}
```

For production, replace `localhost:3001` with your Grafana domain.

## Email Sharing (Optional)

With `publicDashboardsEmailSharing` feature enabled, you can also:

1. Go to **Share** → **Public Dashboard** → **Email sharing**
2. Enter recipient email addresses
3. Grafana sends a time-limited link (configurable TTL)

## Security Considerations

- Public dashboards expose **read-only** metric data only — no write access
- No user data, PII, or financial records are exposed through Prometheus metrics
- Disable a public dashboard at any time via **Share** → **Public Dashboard** → toggle off
- For production, consider placing Grafana behind an authenticated reverse proxy
  and only exposing specific public dashboard paths

## Alertmanager Slack Integration

The observability stack includes Alertmanager with four Slack channels:

| Channel | Purpose |
|---|---|
| `#remitflow-critical` | P0/P1 alerts — service down, high error rate |
| `#remitflow-ops` | P2/P3 operational warnings |
| `#remitflow-fraud` | Fraud detection and AML alerts |
| `#remitflow-monitoring` | Info / resolved notifications |

### Setting the Slack Webhook

```bash
# Option 1: Environment variable (recommended)
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../..."
docker compose -f docker-compose.observability.yml up -d alertmanager

# Option 2: Edit alertmanager.yml directly
# Replace ${SLACK_WEBHOOK_URL} with your webhook URL
```

### Creating a Slack App

1. Go to https://api.slack.com/apps → **Create New App**
2. Choose **From scratch** → name it `RemitFlow Alerts`
3. Enable **Incoming Webhooks** → **Add New Webhook to Workspace**
4. Select the `#remitflow-ops` channel → copy the webhook URL
5. Repeat for `#remitflow-critical`, `#remitflow-fraud`, `#remitflow-monitoring`
6. Update `alertmanager.yml` with each channel's webhook URL

### Testing Alerts

```bash
# Send a test alert to Alertmanager
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "service": "fraud-detection",
      "severity": "warning"
    },
    "annotations": {
      "summary": "Test alert from RemitFlow",
      "description": "This is a test alert to verify Slack integration"
    }
  }]'
```
