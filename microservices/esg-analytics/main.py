#!/usr/bin/env python3
"""
esg-analytics — Python microservice for ESG impact analytics.
Computes: CO2 offset from remittances, SDG alignment scores, development impact metrics,
ESG rating for diaspora investment products, and reporting for NGO/DFI partners.
Listens on :8231.
"""

from flask import Flask, request, jsonify
from datetime import date
import math

app = Flask(__name__)

# ─── CO2 Impact Model ─────────────────────────────────────────────────────────

# Average CO2 saved per USD remitted vs traditional cash courier (kg CO2e)
# Based on World Bank remittance cost study + digital vs physical transport
CO2_SAVED_PER_USD = 0.0023  # kg CO2e per USD sent digitally vs cash

# CO2 per traditional wire transfer (SWIFT) vs digital
SWIFT_CO2_PER_TX = 2.8  # kg CO2e (server energy + correspondent chain)
DIGITAL_CO2_PER_TX = 0.4  # kg CO2e (cloud-native)
CO2_SAVED_PER_TX = SWIFT_CO2_PER_TX - DIGITAL_CO2_PER_TX

# ─── SDG Mapping ──────────────────────────────────────────────────────────────

SDG_WEIGHTS = {
    "remittance": {
        "SDG1": 0.25,  # No Poverty — direct income transfer
        "SDG8": 0.20,  # Decent Work — supports livelihoods
        "SDG10": 0.20, # Reduced Inequalities — cross-border wealth transfer
        "SDG17": 0.15, # Partnerships — financial inclusion
        "SDG3": 0.10,  # Good Health — healthcare funding
        "SDG4": 0.10,  # Quality Education — school fees
    },
    "investment": {
        "SDG8": 0.25,  # Decent Work — job creation
        "SDG9": 0.25,  # Industry & Innovation — infrastructure
        "SDG11": 0.20, # Sustainable Cities — real estate
        "SDG17": 0.15, # Partnerships
        "SDG1": 0.15,  # No Poverty
    },
    "payroll": {
        "SDG8": 0.35,  # Decent Work — formal employment
        "SDG1": 0.25,  # No Poverty
        "SDG10": 0.20, # Reduced Inequalities
        "SDG17": 0.20, # Partnerships
    },
}

# ─── Country Development Multiplier ──────────────────────────────────────────

def development_multiplier(country: str) -> float:
    """Higher multiplier = more development impact per USD."""
    multipliers = {
        "NG": 1.8, "KE": 1.7, "GH": 1.6, "TZ": 1.9, "UG": 1.9,
        "RW": 1.8, "ET": 2.0, "ZM": 1.7, "MW": 2.0, "MZ": 1.9,
        "ZA": 1.2, "EG": 1.4, "MA": 1.3, "SN": 1.6, "CI": 1.5,
        "GB": 0.8, "US": 0.7, "DE": 0.8, "AE": 0.9, "CA": 0.7,
    }
    return multipliers.get(country.upper(), 1.0)

# ─── ESG Score Calculator ─────────────────────────────────────────────────────

def calculate_esg_score(
    total_volume_usd: float,
    tx_count: int,
    activity_type: str,
    destination_countries: list,
    period_months: int = 12,
) -> dict:
    """
    Compute ESG score (0-100) and impact metrics for a given activity.
    """
    if total_volume_usd <= 0 or tx_count <= 0:
        return {"error": "Volume and transaction count must be positive"}

    # CO2 impact
    co2_saved_volume = total_volume_usd * CO2_SAVED_PER_USD
    co2_saved_tx = tx_count * CO2_SAVED_PER_TX
    total_co2_saved_kg = co2_saved_volume + co2_saved_tx
    trees_equivalent = total_co2_saved_kg / 21.77  # avg tree absorbs 21.77 kg CO2/year
    car_km_equivalent = total_co2_saved_kg / 0.21  # avg car 210g CO2/km

    # Development impact
    avg_dev_multiplier = sum(
        development_multiplier(c) for c in destination_countries
    ) / max(1, len(destination_countries))
    development_impact_usd = total_volume_usd * avg_dev_multiplier

    # SDG scores
    sdg_weights = SDG_WEIGHTS.get(activity_type, SDG_WEIGHTS["remittance"])
    sdg_scores = {}
    for sdg, weight in sdg_weights.items():
        # Score based on volume, frequency, and development multiplier
        volume_score = min(100, math.log10(max(1, total_volume_usd)) * 10)
        freq_score = min(100, math.log10(max(1, tx_count)) * 15)
        sdg_scores[sdg] = round(
            (volume_score * 0.5 + freq_score * 0.3 + avg_dev_multiplier * 10) * weight, 2
        )

    total_sdg_score = min(100, sum(sdg_scores.values()) * 2)

    # Financial inclusion score
    avg_tx_size = total_volume_usd / tx_count
    inclusion_score = min(100, 100 - (avg_tx_size / 1000) * 10)  # smaller avg = more inclusive
    inclusion_score = max(0, inclusion_score)

    # Overall ESG score (weighted)
    esg_score = (
        total_sdg_score * 0.40 +
        inclusion_score * 0.30 +
        min(100, total_co2_saved_kg / 10) * 0.30
    )
    esg_score = min(100, round(esg_score, 1))

    # ESG rating
    if esg_score >= 80:
        rating = "AAA"
    elif esg_score >= 70:
        rating = "AA"
    elif esg_score >= 60:
        rating = "A"
    elif esg_score >= 50:
        rating = "BBB"
    elif esg_score >= 40:
        rating = "BB"
    else:
        rating = "B"

    return {
        "esg_score": esg_score,
        "esg_rating": rating,
        "period_months": period_months,
        "activity_type": activity_type,
        "environmental": {
            "co2_saved_kg": round(total_co2_saved_kg, 2),
            "co2_saved_tonnes": round(total_co2_saved_kg / 1000, 4),
            "trees_equivalent": round(trees_equivalent, 1),
            "car_km_equivalent": round(car_km_equivalent, 0),
            "digital_vs_cash_co2_reduction_pct": 85.7,
        },
        "social": {
            "total_volume_usd": round(total_volume_usd, 2),
            "transaction_count": tx_count,
            "avg_transaction_usd": round(avg_tx_size, 2),
            "development_impact_usd": round(development_impact_usd, 2),
            "financial_inclusion_score": round(inclusion_score, 1),
            "destination_countries": destination_countries,
            "avg_development_multiplier": round(avg_dev_multiplier, 2),
        },
        "governance": {
            "aml_compliance": "FATF",
            "data_protection": "GDPR",
            "kyc_framework": "eIDAS",
            "regulatory_frameworks": ["FCA", "CBN", "CBK", "BOG"],
        },
        "sdg_alignment": {
            "scores": sdg_scores,
            "primary_sdgs": sorted(sdg_scores.keys(), key=lambda k: sdg_scores[k], reverse=True)[:3],
            "total_sdg_score": round(total_sdg_score, 1),
        },
        "reporting": {
            "gri_standard": "GRI 203-1 (Infrastructure Investments)",
            "tcfd_aligned": True,
            "un_global_compact": True,
            "impact_report_ready": esg_score >= 50,
        }
    }

# ─── Invoice Financing Risk Scorer ────────────────────────────────────────────

def score_invoice_risk(
    invoice_amount_usd: float,
    debtor_country: str,
    debtor_industry: str,
    debtor_payment_history_days: float,  # avg days to pay
    invoice_age_days: int,
    invoice_due_days: int,
    seller_relationship_months: int,
    seller_tx_volume_usd: float,
) -> dict:
    """
    Score invoice financing risk (0-100, higher = lower risk).
    Used by the invoice financing router to set advance rate and fee.
    """
    # 1. Debtor payment history (30 points)
    if debtor_payment_history_days <= 30:
        payment_score = 30.0
    elif debtor_payment_history_days <= 45:
        payment_score = 22.0
    elif debtor_payment_history_days <= 60:
        payment_score = 15.0
    elif debtor_payment_history_days <= 90:
        payment_score = 8.0
    else:
        payment_score = 2.0

    # 2. Invoice age vs due date (20 points)
    days_remaining = invoice_due_days - invoice_age_days
    if days_remaining >= 60:
        age_score = 20.0
    elif days_remaining >= 30:
        age_score = 15.0
    elif days_remaining >= 14:
        age_score = 10.0
    elif days_remaining >= 0:
        age_score = 5.0
    else:
        age_score = 0.0  # overdue

    # 3. Debtor country risk (20 points)
    country_scores = {
        "GB": 20, "DE": 20, "US": 19, "SG": 19, "AU": 18,
        "AE": 16, "ZA": 14, "NG": 12, "KE": 12, "GH": 11,
        "TZ": 10, "UG": 10,
    }
    country_score = country_scores.get(debtor_country.upper(), 8)

    # 4. Industry risk (15 points)
    industry_scores = {
        "technology": 15, "healthcare": 14, "manufacturing": 12,
        "retail": 10, "construction": 8, "hospitality": 7,
        "agriculture": 9, "logistics": 11,
    }
    industry_score = industry_scores.get(debtor_industry.lower(), 8)

    # 5. Seller relationship (15 points)
    if seller_relationship_months >= 24:
        relationship_score = 15.0
    elif seller_relationship_months >= 12:
        relationship_score = 11.0
    elif seller_relationship_months >= 6:
        relationship_score = 7.0
    else:
        relationship_score = 3.0

    total_score = payment_score + age_score + country_score + industry_score + relationship_score

    # Advance rate: 70-90% based on score
    advance_rate = 0.70 + (total_score / 100) * 0.20

    # Fee: 1.5-4% based on risk
    fee_pct = 4.0 - (total_score / 100) * 2.5

    # Risk band
    if total_score >= 80:
        risk_band = "LOW"
    elif total_score >= 60:
        risk_band = "MEDIUM"
    elif total_score >= 40:
        risk_band = "HIGH"
    else:
        risk_band = "VERY_HIGH"

    decision = "approve" if total_score >= 40 and days_remaining >= 0 else "decline"

    return {
        "risk_score": round(total_score, 1),
        "risk_band": risk_band,
        "decision": decision,
        "advance_rate_pct": round(advance_rate * 100, 1),
        "advance_amount_usd": round(invoice_amount_usd * advance_rate, 2),
        "fee_pct": round(fee_pct, 2),
        "fee_usd": round(invoice_amount_usd * fee_pct / 100, 2),
        "net_disbursement_usd": round(invoice_amount_usd * advance_rate - invoice_amount_usd * fee_pct / 100, 2),
        "components": {
            "payment_history": round(payment_score, 1),
            "invoice_timing": round(age_score, 1),
            "country_risk": country_score,
            "industry_risk": industry_score,
            "seller_relationship": round(relationship_score, 1),
        },
        "days_remaining_to_due": days_remaining,
    }


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({"service": "esg-analytics", "status": "healthy", "version": "1.0.0"})


@app.route('/esg-score', methods=['POST'])
def esg_score():
    data = request.get_json()
    result = calculate_esg_score(
        total_volume_usd=float(data.get('total_volume_usd', 0)),
        tx_count=int(data.get('tx_count', 0)),
        activity_type=data.get('activity_type', 'remittance'),
        destination_countries=data.get('destination_countries', ['NG']),
        period_months=int(data.get('period_months', 12)),
    )
    return jsonify(result)


@app.route('/invoice-risk', methods=['POST'])
def invoice_risk():
    data = request.get_json()
    result = score_invoice_risk(
        invoice_amount_usd=float(data.get('invoice_amount_usd', 0)),
        debtor_country=data.get('debtor_country', 'NG'),
        debtor_industry=data.get('debtor_industry', 'manufacturing'),
        debtor_payment_history_days=float(data.get('debtor_payment_history_days', 45)),
        invoice_age_days=int(data.get('invoice_age_days', 0)),
        invoice_due_days=int(data.get('invoice_due_days', 60)),
        seller_relationship_months=int(data.get('seller_relationship_months', 6)),
        seller_tx_volume_usd=float(data.get('seller_tx_volume_usd', 10000)),
    )
    return jsonify(result)


@app.route('/impact-report', methods=['POST'])
def impact_report():
    """Generate a full ESG impact report for a partner or period."""
    data = request.get_json()
    esg = calculate_esg_score(
        total_volume_usd=float(data.get('total_volume_usd', 0)),
        tx_count=int(data.get('tx_count', 0)),
        activity_type=data.get('activity_type', 'remittance'),
        destination_countries=data.get('destination_countries', []),
        period_months=int(data.get('period_months', 12)),
    )
    report = {
        "report_date": date.today().isoformat(),
        "partner_id": data.get('partner_id'),
        "period": data.get('period', f"{date.today().year}"),
        "esg_summary": esg,
        "narrative": {
            "headline": f"In this period, {data.get('tx_count', 0):,} transactions totalling ${data.get('total_volume_usd', 0):,.0f} were processed, saving an estimated {esg.get('environmental', {}).get('co2_saved_kg', 0):.1f} kg of CO₂ compared to traditional remittance channels.",
            "sdg_headline": f"Primary SDG contributions: {', '.join(esg.get('sdg_alignment', {}).get('primary_sdgs', []))}",
            "inclusion_note": f"Average transaction size of ${esg.get('social', {}).get('avg_transaction_usd', 0):.0f} indicates strong micro-remittance activity supporting household-level financial inclusion.",
        }
    }
    return jsonify(report)


if __name__ == '__main__':
    import os
    port = int(os.environ.get('ESG_ANALYTICS_PORT', 8231))
    print(f"[esg-analytics] Starting on :{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
