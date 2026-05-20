#!/usr/bin/env python3
"""
tax-filing-sidecar — Python microservice for multi-jurisdiction payroll tax filing.
Covers: Nigeria (FIRS/PAYE), UK (HMRC PAYE/NI), Kenya (KRA PAYE), Ghana (GRA PAYE).
Provides: tax calculation, filing schedule, remittance instructions, P60/P45 equivalents.
Listens on :8230.
"""

from flask import Flask, request, jsonify
from datetime import date, datetime
import math

app = Flask(__name__)

# ─── Nigeria FIRS PAYE ────────────────────────────────────────────────────────

def calculate_ng_paye(gross_annual_ngn: float) -> dict:
    """
    Nigeria PAYE per FIRS guidelines (2024):
    - Consolidated Relief Allowance: 20% of gross + NGN 200,000 (or 1% of gross, whichever higher)
    - Pension: 8% employee (PRA 2014)
    - NHF: 2.5% of basic salary (assume 60% of gross)
    - NHIS: 5% of basic salary
    Progressive rates: 7% / 11% / 15% / 19% / 21% / 24%
    """
    basic = gross_annual_ngn * 0.60
    pension = gross_annual_ngn * 0.08
    nhf = basic * 0.025
    nhis = basic * 0.05

    # CRA
    cra_pct = gross_annual_ngn * 0.20
    cra_fixed = 200_000
    cra = max(cra_pct + cra_fixed, gross_annual_ngn * 0.01)

    taxable = max(0, gross_annual_ngn - pension - nhf - nhis - cra)

    # Progressive bands (annual NGN)
    bands = [
        (300_000, 0.07),
        (300_000, 0.11),
        (500_000, 0.15),
        (500_000, 0.19),
        (1_600_000, 0.21),
        (float('inf'), 0.24),
    ]

    tax = 0.0
    remaining = taxable
    for band_size, rate in bands:
        if remaining <= 0:
            break
        taxable_in_band = min(remaining, band_size)
        tax += taxable_in_band * rate
        remaining -= taxable_in_band

    net_annual = gross_annual_ngn - pension - nhf - nhis - tax
    effective_rate = (tax / gross_annual_ngn * 100) if gross_annual_ngn > 0 else 0

    return {
        "jurisdiction": "NG",
        "authority": "FIRS",
        "gross_annual": round(gross_annual_ngn, 2),
        "pension_employee": round(pension, 2),
        "nhf": round(nhf, 2),
        "nhis": round(nhis, 2),
        "cra": round(cra, 2),
        "taxable_income": round(taxable, 2),
        "paye_annual": round(tax, 2),
        "paye_monthly": round(tax / 12, 2),
        "net_annual": round(net_annual, 2),
        "net_monthly": round(net_annual / 12, 2),
        "effective_rate_pct": round(effective_rate, 2),
        "filing_frequency": "monthly",
        "remittance_deadline": "10th of following month",
        "filing_form": "FIRS PAYE Schedule",
        "employer_pension": round(gross_annual_ngn * 0.10, 2),  # 10% employer
    }


def calculate_uk_paye(gross_annual_gbp: float, tax_year: str = "2024-25") -> dict:
    """
    UK HMRC PAYE + National Insurance (2024-25):
    - Personal allowance: £12,570
    - Basic rate: 20% (£12,571–£50,270)
    - Higher rate: 40% (£50,271–£125,140)
    - Additional rate: 45% (>£125,140)
    - NI Class 1 employee: 8% (£12,570–£50,270), 2% above
    """
    personal_allowance = 12_570.0
    # Taper personal allowance above £100k
    if gross_annual_gbp > 100_000:
        reduction = min(personal_allowance, (gross_annual_gbp - 100_000) / 2)
        personal_allowance = max(0, personal_allowance - reduction)

    taxable = max(0, gross_annual_gbp - personal_allowance)

    # Income tax
    tax = 0.0
    if taxable > 0:
        basic_band = min(taxable, 50_270 - 12_570)
        tax += basic_band * 0.20
        higher_band = min(max(0, taxable - (50_270 - 12_570)), 125_140 - 50_270)
        tax += higher_band * 0.40
        additional_band = max(0, taxable - (125_140 - 12_570))
        tax += additional_band * 0.45

    # NI Class 1 employee
    ni_lower = 12_570.0
    ni_upper = 50_270.0
    ni = 0.0
    if gross_annual_gbp > ni_lower:
        ni_main = min(gross_annual_gbp, ni_upper) - ni_lower
        ni += ni_main * 0.08
        if gross_annual_gbp > ni_upper:
            ni += (gross_annual_gbp - ni_upper) * 0.02

    # Employer NI: 13.8% above secondary threshold (£9,100)
    employer_ni = max(0, gross_annual_gbp - 9_100) * 0.138

    net_annual = gross_annual_gbp - tax - ni
    effective_rate = ((tax + ni) / gross_annual_gbp * 100) if gross_annual_gbp > 0 else 0

    return {
        "jurisdiction": "GB",
        "authority": "HMRC",
        "tax_year": tax_year,
        "gross_annual": round(gross_annual_gbp, 2),
        "personal_allowance": round(personal_allowance, 2),
        "taxable_income": round(taxable, 2),
        "income_tax_annual": round(tax, 2),
        "income_tax_monthly": round(tax / 12, 2),
        "ni_employee_annual": round(ni, 2),
        "ni_employee_monthly": round(ni / 12, 2),
        "ni_employer_annual": round(employer_ni, 2),
        "net_annual": round(net_annual, 2),
        "net_monthly": round(net_annual / 12, 2),
        "effective_rate_pct": round(effective_rate, 2),
        "filing_frequency": "monthly",
        "remittance_deadline": "19th of following month (22nd electronic)",
        "filing_form": "RTI Full Payment Submission (FPS)",
        "student_loan_threshold": 27_295.0,
    }


def calculate_ke_paye(gross_annual_kes: float) -> dict:
    """
    Kenya KRA PAYE (2024):
    - Personal relief: KES 28,800/year
    - Insurance relief: 15% of premiums (max KES 60,000)
    Progressive bands (monthly): 24K/8K/467K/300K/above
    """
    gross_monthly = gross_annual_kes / 12

    # Monthly bands
    bands = [
        (24_000, 0.10),
        (8_333, 0.25),
        (467_667, 0.30),
        (300_000, 0.325),
        (float('inf'), 0.35),
    ]

    monthly_tax = 0.0
    remaining = gross_monthly
    for band_size, rate in bands:
        if remaining <= 0:
            break
        taxable_in_band = min(remaining, band_size)
        monthly_tax += taxable_in_band * rate
        remaining -= taxable_in_band

    # Personal relief
    personal_relief_monthly = 28_800 / 12
    monthly_tax = max(0, monthly_tax - personal_relief_monthly)

    # NSSF: KES 2,160/month (Tier I + II)
    nssf = 2_160.0
    # NHIF: sliding scale
    if gross_monthly <= 5_999:
        nhif = 150
    elif gross_monthly <= 7_999:
        nhif = 300
    elif gross_monthly <= 11_999:
        nhif = 400
    elif gross_monthly <= 14_999:
        nhif = 500
    elif gross_monthly <= 19_999:
        nhif = 600
    elif gross_monthly <= 24_999:
        nhif = 750
    elif gross_monthly <= 29_999:
        nhif = 850
    elif gross_monthly <= 34_999:
        nhif = 900
    elif gross_monthly <= 39_999:
        nhif = 950
    elif gross_monthly <= 44_999:
        nhif = 1_000
    elif gross_monthly <= 49_999:
        nhif = 1_100
    elif gross_monthly <= 59_999:
        nhif = 1_200
    elif gross_monthly <= 69_999:
        nhif = 1_300
    elif gross_monthly <= 79_999:
        nhif = 1_400
    elif gross_monthly <= 89_999:
        nhif = 1_500
    elif gross_monthly <= 99_999:
        nhif = 1_600
    else:
        nhif = 1_700

    net_monthly = gross_monthly - monthly_tax - nssf - nhif
    effective_rate = ((monthly_tax + nssf + nhif) / gross_monthly * 100) if gross_monthly > 0 else 0

    return {
        "jurisdiction": "KE",
        "authority": "KRA",
        "gross_annual": round(gross_annual_kes, 2),
        "gross_monthly": round(gross_monthly, 2),
        "paye_monthly": round(monthly_tax, 2),
        "paye_annual": round(monthly_tax * 12, 2),
        "nssf_monthly": nssf,
        "nhif_monthly": nhif,
        "net_monthly": round(net_monthly, 2),
        "net_annual": round(net_monthly * 12, 2),
        "effective_rate_pct": round(effective_rate, 2),
        "filing_frequency": "monthly",
        "remittance_deadline": "9th of following month",
        "filing_form": "KRA iTax PAYE Return",
    }


def calculate_gh_paye(gross_annual_ghs: float) -> dict:
    """
    Ghana GRA PAYE (2024):
    Progressive bands (annual GHS)
    """
    bands = [
        (4_380, 0.0),
        (1_320, 0.05),
        (1_560, 0.10),
        (36_000, 0.175),
        (196_740, 0.25),
        (float('inf'), 0.30),
    ]

    tax = 0.0
    remaining = gross_annual_ghs
    for band_size, rate in bands:
        if remaining <= 0:
            break
        taxable_in_band = min(remaining, band_size)
        tax += taxable_in_band * rate
        remaining -= taxable_in_band

    # SSNIT: 5.5% employee, 13% employer
    ssnit_employee = gross_annual_ghs * 0.055
    ssnit_employer = gross_annual_ghs * 0.13

    net_annual = gross_annual_ghs - tax - ssnit_employee
    effective_rate = ((tax + ssnit_employee) / gross_annual_ghs * 100) if gross_annual_ghs > 0 else 0

    return {
        "jurisdiction": "GH",
        "authority": "GRA",
        "gross_annual": round(gross_annual_ghs, 2),
        "paye_annual": round(tax, 2),
        "paye_monthly": round(tax / 12, 2),
        "ssnit_employee_annual": round(ssnit_employee, 2),
        "ssnit_employer_annual": round(ssnit_employer, 2),
        "net_annual": round(net_annual, 2),
        "net_monthly": round(net_annual / 12, 2),
        "effective_rate_pct": round(effective_rate, 2),
        "filing_frequency": "monthly",
        "remittance_deadline": "15th of following month",
        "filing_form": "GRA PAYE Monthly Return",
    }


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({"service": "tax-filing-sidecar", "status": "healthy", "version": "1.0.0"})


@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.get_json()
    jurisdiction = data.get('jurisdiction', '').upper()
    gross_annual = float(data.get('gross_annual', 0))

    if gross_annual <= 0:
        return jsonify({"error": "gross_annual must be > 0"}), 400

    calculators = {
        'NG': calculate_ng_paye,
        'GB': calculate_uk_paye,
        'KE': calculate_ke_paye,
        'GH': calculate_gh_paye,
    }

    if jurisdiction not in calculators:
        return jsonify({"error": f"Unsupported jurisdiction: {jurisdiction}. Supported: NG, GB, KE, GH"}), 400

    result = calculators[jurisdiction](gross_annual)
    return jsonify(result)


@app.route('/batch-calculate', methods=['POST'])
def batch_calculate():
    """Calculate tax for multiple employees across jurisdictions."""
    data = request.get_json()
    employees = data.get('employees', [])
    results = []

    calculators = {
        'NG': calculate_ng_paye,
        'GB': calculate_uk_paye,
        'KE': calculate_ke_paye,
        'GH': calculate_gh_paye,
    }

    total_gross = 0.0
    total_tax = 0.0
    total_net = 0.0

    for emp in employees:
        jur = emp.get('jurisdiction', '').upper()
        gross = float(emp.get('gross_annual', 0))
        emp_id = emp.get('employee_id')

        if jur in calculators and gross > 0:
            calc_result = calculators[jur](gross)
            calc_result['employee_id'] = emp_id
            results.append(calc_result)
            total_gross += gross
            total_tax += calc_result.get('paye_annual', 0)
            total_net += calc_result.get('net_annual', 0)
        else:
            results.append({
                "employee_id": emp_id,
                "error": f"Unsupported jurisdiction or invalid amount: {jur}",
            })

    return jsonify({
        "results": results,
        "summary": {
            "total_employees": len(employees),
            "total_gross_usd_equiv": round(total_gross, 2),
            "total_tax": round(total_tax, 2),
            "total_net": round(total_net, 2),
            "avg_effective_rate_pct": round(
                sum(r.get('effective_rate_pct', 0) for r in results if 'error' not in r) /
                max(1, sum(1 for r in results if 'error' not in r)), 2
            ),
        }
    })


@app.route('/filing-calendar', methods=['GET'])
def filing_calendar():
    """Return the filing calendar for all supported jurisdictions."""
    today = date.today()
    month = today.month
    year = today.year

    return jsonify({
        "current_period": f"{year}-{month:02d}",
        "deadlines": [
            {"jurisdiction": "NG", "authority": "FIRS", "deadline": f"{year}-{month:02d}-10", "form": "PAYE Schedule", "penalty": "10% of tax due + 5% per month"},
            {"jurisdiction": "GB", "authority": "HMRC", "deadline": f"{year}-{month:02d}-19", "form": "RTI FPS", "penalty": "£100–£400/month"},
            {"jurisdiction": "KE", "authority": "KRA", "deadline": f"{year}-{month:02d}-09", "form": "iTax PAYE Return", "penalty": "25% of tax due or KES 10,000"},
            {"jurisdiction": "GH", "authority": "GRA", "deadline": f"{year}-{month:02d}-15", "form": "PAYE Monthly Return", "penalty": "10% of tax due"},
        ]
    })


if __name__ == '__main__':
    import os
    port = int(os.environ.get('TAX_FILING_PORT', 8230))
    print(f"[tax-filing-sidecar] Starting on :{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
