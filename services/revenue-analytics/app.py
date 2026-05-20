"""
RemitFlow Revenue Analytics & ML Scoring Service
Python 3.11 | stdlib HTTP server (no external deps)

Endpoints:
  POST /segment-classify   - classify a transaction into a revenue segment
  POST /cross-sell-score   - propensity score for account conversion
  POST /formalization-rate - informal-to-formal migration rate tracker
  POST /scenario-model     - 5-year revenue scenario modeler
  GET  /health             - health check
"""

import json
import math
import http.server
from dataclasses import dataclass, asdict

SEGMENT_REVENUE = {
    "hnw":       {"fee_pct": 1.8, "spread_bps": 80,  "cross_sell_prob": 0.45},
    "education": {"fee_pct": 2.8, "spread_bps": 120, "cross_sell_prob": 0.35},
    "medical":   {"fee_pct": 2.5, "spread_bps": 100, "cross_sell_prob": 0.25},
    "sme":       {"fee_pct": 3.2, "spread_bps": 130, "cross_sell_prob": 0.40},
    "labor":     {"fee_pct": 3.5, "spread_bps": 150, "cross_sell_prob": 0.20},
}

FORMALIZATION_RATES = {
    "cash_to_mobile":    0.42,
    "mobile_to_account": 0.28,
    "account_to_invest": 0.15,
    "informal_to_formal": 0.35,
}


def classify_segment(body: dict) -> dict:
    amount = float(body.get("amount_usd", 0))
    desc = " ".join([
        str(body.get("purpose_code", "")),
        str(body.get("purpose_description", "")),
        str(body.get("sender_occupation", "")),
    ]).lower()
    freq = int(body.get("frequency_per_year", 1))

    segment = "labor"
    confidence = 0.60
    reasoning = "Default labor segment"

    if amount >= 10_000 and freq <= 4:
        segment = "hnw"
        confidence = 0.85
        reasoning = f"High-value transfer (${amount:,.0f}) with low frequency"

    edu_kw = ["tuition", "school", "university", "college", "student", "edu"]
    edu_hits = sum(1 for k in edu_kw if k in desc)
    if edu_hits >= 1:
        segment = "education"
        confidence = min(0.70 + edu_hits * 0.08, 0.95)
        reasoning = f"Education signals: {edu_hits} keyword(s)"

    med_kw = ["hospital", "clinic", "medical", "surgery", "treatment", "health"]
    med_hits = sum(1 for k in med_kw if k in desc)
    if med_hits >= 1 and med_hits >= edu_hits:
        segment = "medical"
        confidence = min(0.70 + med_hits * 0.08, 0.95)
        reasoning = f"Medical signals: {med_hits} keyword(s)"

    sme_kw = ["trade", "import", "export", "invoice", "commercial"]
    sme_hits = sum(1 for k in sme_kw if k in desc)
    if amount >= 5_000 and sme_hits >= 1:
        segment = "sme"
        confidence = min(0.72 + sme_hits * 0.06, 0.92)
        reasoning = f"SME signals: amount=${amount:,.0f}, trade kw={sme_hits}"

    rev = SEGMENT_REVENUE[segment]
    annual_vol = amount * freq
    annual_revenue = round(annual_vol * rev["fee_pct"] / 100 + annual_vol * rev["spread_bps"] / 10_000, 2)

    return {
        "segment": segment,
        "confidence": round(confidence, 3),
        "fee_pct": rev["fee_pct"],
        "spread_bps": rev["spread_bps"],
        "cross_sell_probability": rev["cross_sell_prob"],
        "annual_revenue_usd": annual_revenue,
        "reasoning": reasoning,
    }


def score_cross_sell(body: dict) -> dict:
    segment = body.get("segment", "labor")
    amount = float(body.get("amount_usd", 0))
    freq = int(body.get("frequency_per_year", 1))
    months = int(body.get("months_active", 0))
    has_ng = bool(body.get("has_nigerian_account", False))
    has_dia = bool(body.get("has_diaspora_account", False))
    age = body.get("age_group", "26-35")

    rev = SEGMENT_REVENUE.get(segment, SEGMENT_REVENUE["labor"])
    score = rev["cross_sell_prob"]
    if amount >= 5_000: score += 0.08
    if freq >= 6: score += 0.06
    if months >= 12: score += 0.05
    if has_ng: score += 0.04
    if has_dia: score -= 0.05
    if age in ("26-35", "36-50"): score += 0.04
    if segment == "hnw": score += 0.10
    if segment == "education": score += 0.06

    score = 1 / (1 + math.exp(-6 * (score - 0.5)))
    score = round(min(max(score, 0.01), 0.99), 3)

    products = {
        "hnw": "RemitFlow Diaspora Investment Account",
        "education": "RemitFlow Student Savings + FX Lock",
        "sme": "RemitFlow Business FX Account",
    }
    product = products.get(segment, "RemitFlow Naira Savings Account" if has_ng else "RemitFlow Basic Account")

    annual_vol = amount * freq
    annual_rev = annual_vol * (rev["fee_pct"] / 100 + rev["spread_bps"] / 10_000)
    ltv = round(annual_rev * 5 * 1.3, 2)

    action = (
        "Offer FX rate lock for next transfer" if score > 0.6
        else "Send educational content about account benefits" if score > 0.4
        else "Continue standard remittance journey"
    )

    return {
        "propensity_score": score,
        "recommended_product": product,
        "expected_ltv_usd": ltv,
        "conversion_probability": score,
        "next_best_action": action,
    }


def track_formalization(body: dict) -> dict:
    cohort = int(body.get("cohort_size", 100))
    channel = body.get("current_channel", "cash")
    months = int(body.get("months_observed", 3))
    incentive = bool(body.get("incentive_offered", False))

    key = f"{channel}_to_{'mobile' if channel == 'cash' else 'account'}"
    base_rate = FORMALIZATION_RATES.get(key, FORMALIZATION_RATES["informal_to_formal"])
    if incentive:
        base_rate = min(base_rate * 1.35, 0.80)

    time_factor = min(1.0, months / 6)
    adjusted_rate = base_rate * time_factor
    conversions = int(cohort * adjusted_rate)
    uplift = round(conversions * 45.0 * 0.30, 2)
    time_to_conv = round(6 / max(adjusted_rate, 0.01), 1)

    incentives = {
        "cash": "Offer 0% fee on first 3 transfers after account opening",
        "mobile": "Offer 50bps better FX rate for account-linked transfers",
        "account": "Offer diaspora investment product with 5% welcome bonus",
    }

    return {
        "migration_rate": round(adjusted_rate, 3),
        "expected_conversions": conversions,
        "revenue_uplift_usd": uplift,
        "time_to_conversion_months": time_to_conv,
        "recommended_incentive": incentives.get(channel, incentives["cash"]),
    }


def model_scenario(body: dict) -> dict:
    base_vol = float(body.get("base_daily_volume_ngn", 500_000_000))
    scenarios = body.get("growth_scenarios", {"bear": 0.10, "base": 0.25, "bull": 0.45})
    mix = body.get("segment_mix", {"labor": 0.55, "education": 0.20, "medical": 0.10, "sme": 0.10, "hnw": 0.05})
    years = int(body.get("years", 5))
    fx = float(body.get("fx_rate_ngn_usd", 1600.0))

    results = []
    for scenario_name, growth in scenarios.items():
        for yr in range(1, years + 1):
            vol_ngn = base_vol * (1 + growth) ** (yr - 1) * 365
            vol_usd = vol_ngn / fx
            fee_rev = spread_rev = cross_sell_rev = 0.0
            for seg, pct in mix.items():
                sv = vol_usd * pct
                r = SEGMENT_REVENUE.get(seg, SEGMENT_REVENUE["labor"])
                fee_rev += sv * r["fee_pct"] / 100
                spread_rev += sv * r["spread_bps"] / 10_000
                cross_sell_rev += sv * r["cross_sell_prob"] * 0.05
            float_bal = (base_vol * (1 + growth) ** (yr - 1) * 2) / fx
            float_income = float_bal * 0.159
            total = round(fee_rev + spread_rev + float_income + cross_sell_rev, 2)
            results.append({
                "scenario": scenario_name,
                "growth_rate": growth,
                "year": yr,
                "volume_ngn": round(vol_ngn, 2),
                "volume_usd": round(vol_usd, 2),
                "fee_revenue_usd": round(fee_rev, 2),
                "spread_revenue_usd": round(spread_rev, 2),
                "float_income_usd": round(float_income, 2),
                "cross_sell_revenue_usd": round(cross_sell_rev, 2),
                "total_revenue_usd": total,
            })
    return {"scenarios": results, "count": len(results)}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "service": "revenue-analytics"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            body = self.read_body()
        except Exception as e:
            self.send_json(400, {"error": f"invalid JSON: {e}"})
            return
        try:
            routes = {
                "/segment-classify": classify_segment,
                "/cross-sell-score": score_cross_sell,
                "/formalization-rate": track_formalization,
                "/scenario-model": model_scenario,
            }
            if self.path in routes:
                self.send_json(200, routes[self.path](body))
            else:
                self.send_json(404, {"error": "not found"})
        except (KeyError, TypeError, ValueError) as e:
            self.send_json(400, {"error": f"bad request: {e}"})


def run(host="0.0.0.0", port=8083):
    server = http.server.HTTPServer((host, port), Handler)
    print(f"[revenue-analytics] Listening on :{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
