"""
RemitFlow Payroll Compliance Sidecar — Python microservice
Handles: jurisdiction tax validation, statutory deduction rules,
         payslip PDF generation, compliance report export
Port: 8202
"""

from flask import Flask, request, jsonify
from dataclasses import dataclass, asdict, field
from typing import Optional, List, Dict, Any
import json
import math
import os
from datetime import datetime, timezone

app = Flask(__name__)

# ─── Jurisdiction Tax Rules (2026) ────────────────────────────────────────────

JURISDICTION_RULES: Dict[str, Dict[str, Any]] = {
    "NG": {
        "name": "Nigeria",
        "currency": "NGN",
        "tax_authority": "FIRS",
        "pension_regulator": "PenCom",
        "min_wage": 30000,
        "min_wage_currency": "NGN",
        "pension_employee": 0.08,
        "pension_employer": 0.10,
        "nhf": 0.025,          # National Housing Fund
        "nhis": 0.0175,        # National Health Insurance Scheme
        "cra_rate": 0.20,      # Consolidated Relief Allowance
        "cra_min": 200000,     # Minimum CRA (NGN)
        "paye_brackets": [
            {"min": 0,       "max": 300000,  "rate": 0.07},
            {"min": 300000,  "max": 600000,  "rate": 0.11},
            {"min": 600000,  "max": 1100000, "rate": 0.15},
            {"min": 1100000, "max": 1600000, "rate": 0.19},
            {"min": 1600000, "max": 3200000, "rate": 0.21},
            {"min": 3200000, "max": None,    "rate": 0.24},
        ],
        "compliance_notes": [
            "PAYE must be remitted to FIRS by 10th of following month",
            "Pension contributions due within 7 days of salary payment",
            "NHF deductions remitted monthly to Federal Mortgage Bank",
            "Employee must have a valid BVN for payroll processing",
        ]
    },
    "GB": {
        "name": "United Kingdom",
        "currency": "GBP",
        "tax_authority": "HMRC",
        "pension_regulator": "The Pensions Regulator",
        "min_wage": 11.44,     # per hour (National Living Wage 2024)
        "min_wage_currency": "GBP",
        "personal_allowance": 12570,
        "ni_primary_threshold": 12570,
        "ni_upper_threshold": 50270,
        "ni_rate_basic": 0.08,
        "ni_rate_upper": 0.02,
        "pension_employee": 0.05,
        "pension_employer": 0.03,
        "paye_brackets": [
            {"min": 0,      "max": 12570,  "rate": 0.00},
            {"min": 12570,  "max": 50270,  "rate": 0.20},
            {"min": 50270,  "max": 125140, "rate": 0.40},
            {"min": 125140, "max": None,   "rate": 0.45},
        ],
        "compliance_notes": [
            "RTI (Real Time Information) submission required on or before payment date",
            "PAYE and NI remitted to HMRC by 19th (22nd if electronic) of following month",
            "Auto-enrolment pension: eligible workers must be enrolled within 6 weeks",
            "P60 must be issued to all employees by 31 May each year",
        ]
    },
    "US": {
        "name": "United States",
        "currency": "USD",
        "tax_authority": "IRS",
        "pension_regulator": "DOL",
        "min_wage": 7.25,      # Federal minimum wage
        "min_wage_currency": "USD",
        "social_security_rate": 0.062,
        "social_security_wage_base": 168600,
        "medicare_rate": 0.0145,
        "additional_medicare_rate": 0.009,  # above $200k
        "additional_medicare_threshold": 200000,
        "paye_brackets": [
            {"min": 0,       "max": 11600,  "rate": 0.10},
            {"min": 11600,   "max": 47150,  "rate": 0.12},
            {"min": 47150,   "max": 100525, "rate": 0.22},
            {"min": 100525,  "max": 191950, "rate": 0.24},
            {"min": 191950,  "max": 243725, "rate": 0.32},
            {"min": 243725,  "max": 609350, "rate": 0.35},
            {"min": 609350,  "max": None,   "rate": 0.37},
        ],
        "compliance_notes": [
            "Federal payroll taxes deposited semi-weekly or monthly based on lookback period",
            "Form 941 filed quarterly; Form W-2 issued by January 31",
            "FUTA (Federal Unemployment Tax) 6% on first $7,000 of wages",
            "State income tax varies; employer must withhold per employee's W-4",
        ]
    },
    "CA": {
        "name": "Canada",
        "currency": "CAD",
        "tax_authority": "CRA",
        "pension_regulator": "OSFI",
        "min_wage": 17.30,     # Federal minimum wage 2024
        "min_wage_currency": "CAD",
        "cpp_rate": 0.0595,    # CPP employee rate
        "cpp_max_earnings": 68500,
        "ei_rate": 0.0166,     # EI employee rate
        "ei_max_insurable": 63200,
        "paye_brackets": [
            {"min": 0,       "max": 55867,  "rate": 0.15},
            {"min": 55867,   "max": 111733, "rate": 0.205},
            {"min": 111733,  "max": 154906, "rate": 0.26},
            {"min": 154906,  "max": 220000, "rate": 0.29},
            {"min": 220000,  "max": None,   "rate": 0.33},
        ],
        "compliance_notes": [
            "Payroll deductions remitted to CRA by 15th of following month (regular remitter)",
            "T4 slips issued to employees by last day of February",
            "CPP contributions matched by employer; EI employer rate is 1.4x employee rate",
            "Quebec has separate QPP and QPIP instead of CPP and EI",
        ]
    },
    "DE": {
        "name": "Germany",
        "currency": "EUR",
        "tax_authority": "Finanzamt",
        "pension_regulator": "Deutsche Rentenversicherung",
        "min_wage": 12.41,     # EUR per hour 2024
        "min_wage_currency": "EUR",
        "social_security_rate": 0.093,
        "health_insurance_rate": 0.0745,
        "pension_employee": 0.093,
        "unemployment_insurance": 0.013,
        "care_insurance": 0.017,
        "solidarity_surcharge_threshold": 18130,
        "solidarity_surcharge_rate": 0.055,
        "paye_brackets": [
            {"min": 0,       "max": 11604,  "rate": 0.00},
            {"min": 11604,   "max": 66760,  "rate": 0.14},
            {"min": 66760,   "max": 277826, "rate": 0.42},
            {"min": 277826,  "max": None,   "rate": 0.45},
        ],
        "compliance_notes": [
            "Lohnsteuer (wage tax) withheld and remitted monthly to Finanzamt",
            "Social insurance contributions split equally between employer and employee",
            "Lohnsteuerbescheinigung (wage tax certificate) issued by February 28",
            "Kurzarbeit (short-time work) scheme available for eligible employers",
        ]
    },
    "AE": {
        "name": "United Arab Emirates",
        "currency": "AED",
        "tax_authority": "Ministry of Finance",
        "pension_regulator": "GPSSA",
        "min_wage": None,      # No federal minimum wage
        "min_wage_currency": "AED",
        "income_tax_rate": 0.0,  # No personal income tax
        "social_security_uae_nationals": 0.05,
        "social_security_employer_uae": 0.125,
        "gratuity_rate_per_year": 0.0833,  # 21 days per year for first 5 years
        "paye_brackets": [
            {"min": 0, "max": None, "rate": 0.00},
        ],
        "compliance_notes": [
            "No income tax for employees in UAE",
            "End-of-service gratuity mandatory: 21 days per year (first 5 years), 30 days thereafter",
            "UAE nationals: GPSSA social security 5% employee, 12.5% employer",
            "WPS (Wage Protection System) compliance mandatory for all employers",
        ]
    },
    "GH": {
        "name": "Ghana",
        "currency": "GHS",
        "tax_authority": "GRA",
        "pension_regulator": "NPRA",
        "min_wage": 18.15,     # GHS per day 2024
        "min_wage_currency": "GHS",
        "ssnit_employee": 0.055,
        "ssnit_employer": 0.13,
        "tier2_employee": 0.05,
        "paye_brackets": [
            {"min": 0,     "max": 4380,  "rate": 0.00},
            {"min": 4380,  "max": 5100,  "rate": 0.05},
            {"min": 5100,  "max": 6240,  "rate": 0.10},
            {"min": 6240,  "max": 7560,  "rate": 0.175},
            {"min": 7560,  "max": 10080, "rate": 0.25},
            {"min": 10080, "max": None,  "rate": 0.30},
        ],
        "compliance_notes": [
            "PAYE remitted to GRA by 15th of following month",
            "SSNIT contributions due by last day of month",
            "Tier 2 pension mandatory for formal sector employees",
            "Employer must register with GRA and SSNIT within 30 days of first hire",
        ]
    },
    "KE": {
        "name": "Kenya",
        "currency": "KES",
        "tax_authority": "KRA",
        "pension_regulator": "RBA",
        "min_wage": 15201,     # KES per month (general minimum wage 2024)
        "min_wage_currency": "KES",
        "nssf_employee": 0.06,
        "nssf_employer": 0.06,
        "nhif_rate": 0.0275,
        "housing_levy": 0.015,
        "paye_brackets": [
            {"min": 0,       "max": 288000,  "rate": 0.10},
            {"min": 288000,  "max": 388000,  "rate": 0.25},
            {"min": 388000,  "max": None,    "rate": 0.30},
        ],
        "compliance_notes": [
            "PAYE remitted to KRA by 9th of following month",
            "NSSF contributions due by 9th of following month",
            "Housing Levy 1.5% employee + 1.5% employer effective 2024",
            "NHIF replaced by Social Health Insurance Fund (SHIF) from 2024",
        ]
    },
    "ZA": {
        "name": "South Africa",
        "currency": "ZAR",
        "tax_authority": "SARS",
        "pension_regulator": "FSCA",
        "min_wage": 27.58,     # ZAR per hour 2024
        "min_wage_currency": "ZAR",
        "uif_employee": 0.01,
        "uif_employer": 0.01,
        "uif_max_earnings": 17712,  # per month
        "pension_employee": 0.075,
        "paye_brackets": [
            {"min": 0,       "max": 237100,  "rate": 0.18},
            {"min": 237100,  "max": 370500,  "rate": 0.26},
            {"min": 370500,  "max": 512800,  "rate": 0.31},
            {"min": 512800,  "max": 673000,  "rate": 0.36},
            {"min": 673000,  "max": 857900,  "rate": 0.39},
            {"min": 857900,  "max": 1817000, "rate": 0.41},
            {"min": 1817000, "max": None,    "rate": 0.45},
        ],
        "compliance_notes": [
            "PAYE and UIF remitted to SARS by 7th of following month",
            "EMP201 return filed monthly; EMP501 reconciliation annually",
            "IRP5 certificates issued to employees by 31 May",
            "SDL (Skills Development Levy) 1% of payroll for employers with payroll > ZAR 500k/year",
        ]
    },
}

# ─── Business Rules ───────────────────────────────────────────────────────────

def validate_payroll_run(company: dict, employees: list) -> dict:
    """Validate a payroll run against compliance rules."""
    errors = []
    warnings = []

    for emp in employees:
        jur = emp.get("jurisdiction", "US")
        rules = JURISDICTION_RULES.get(jur, {})

        # Minimum wage check
        min_wage = rules.get("min_wage")
        if min_wage and emp.get("gross_salary", 0) < min_wage:
            errors.append({
                "employee_code": emp.get("employee_code"),
                "rule": "MIN_WAGE",
                "message": f"Salary {emp['gross_salary']} {emp.get('salary_currency')} is below minimum wage {min_wage} {rules.get('min_wage_currency')} for {jur}"
            })

        # Missing tax code
        if not emp.get("tax_code") and jur in ["GB", "US", "CA"]:
            warnings.append({
                "employee_code": emp.get("employee_code"),
                "rule": "MISSING_TAX_CODE",
                "message": f"No tax code provided for {jur} employee — default emergency code will be applied"
            })

        # Missing bank details
        if not emp.get("bank_account") and not emp.get("mobile_money_num"):
            errors.append({
                "employee_code": emp.get("employee_code"),
                "rule": "MISSING_PAYMENT_DETAILS",
                "message": "No bank account or mobile money number provided"
            })

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "employee_count": len(employees),
        "jurisdictions": list(set(e.get("jurisdiction", "US") for e in employees)),
    }


def get_compliance_calendar(jurisdiction: str, year: int) -> list:
    """Return key compliance dates for a jurisdiction."""
    rules = JURISDICTION_RULES.get(jurisdiction, {})
    authority = rules.get("tax_authority", "Tax Authority")
    calendar = []

    for month in range(1, 13):
        month_name = datetime(year, month, 1).strftime("%B")
        if jurisdiction == "NG":
            calendar.append({"month": month_name, "deadline": f"10th", "obligation": f"PAYE remittance to {authority}"})
            calendar.append({"month": month_name, "deadline": "7th", "obligation": "PenCom pension contribution"})
        elif jurisdiction == "GB":
            calendar.append({"month": month_name, "deadline": "22nd", "obligation": f"PAYE/NI electronic payment to {authority}"})
        elif jurisdiction == "US":
            calendar.append({"month": month_name, "deadline": "15th/Semi-weekly", "obligation": f"Federal payroll tax deposit to {authority}"})
        elif jurisdiction == "CA":
            calendar.append({"month": month_name, "deadline": "15th", "obligation": f"Payroll deductions remittance to {authority}"})
        elif jurisdiction == "KE":
            calendar.append({"month": month_name, "deadline": "9th", "obligation": f"PAYE and NSSF to {authority}"})
        elif jurisdiction == "ZA":
            calendar.append({"month": month_name, "deadline": "7th", "obligation": f"PAYE and UIF to {authority}"})
        else:
            calendar.append({"month": month_name, "deadline": "End of month", "obligation": f"Statutory deductions to {authority}"})

    return calendar


def generate_payslip_data(employee: dict, run: dict, item: dict) -> dict:
    """Generate structured payslip data for PDF generation."""
    jur = employee.get("jurisdiction", "US")
    rules = JURISDICTION_RULES.get(jur, {})

    earnings = [
        {"description": "Basic Salary", "amount": item.get("gross_salary", 0), "currency": item.get("gross_currency", "USD")}
    ]

    deductions = []
    tax_bd = item.get("tax_breakdown", {})
    if tax_bd.get("income_tax", 0) > 0:
        deductions.append({"description": "Income Tax / PAYE", "amount": tax_bd["income_tax"], "currency": item.get("gross_currency")})
    if tax_bd.get("social_security", 0) > 0:
        label = {"NG": "N/A", "GB": "National Insurance", "US": "Social Security", "CA": "CPP", "DE": "Rentenversicherung", "GH": "SSNIT", "KE": "NSSF", "ZA": "UIF"}.get(jur, "Social Security")
        deductions.append({"description": label, "amount": tax_bd["social_security"], "currency": item.get("gross_currency")})
    if tax_bd.get("pension", 0) > 0:
        deductions.append({"description": "Pension (Employee)", "amount": tax_bd["pension"], "currency": item.get("gross_currency")})
    if tax_bd.get("nhf", 0) > 0:
        deductions.append({"description": "NHF", "amount": tax_bd["nhf"], "currency": item.get("gross_currency")})
    if tax_bd.get("nhis", 0) > 0:
        deductions.append({"description": "NHIS", "amount": tax_bd["nhis"], "currency": item.get("gross_currency")})

    return {
        "company_name": run.get("company_name", ""),
        "employee_name": f"{employee.get('first_name', '')} {employee.get('last_name', '')}",
        "employee_code": employee.get("employee_code", ""),
        "job_title": employee.get("job_title", ""),
        "department": employee.get("department", ""),
        "pay_period": f"{run.get('period_start', '')} – {run.get('period_end', '')}",
        "pay_date": run.get("pay_date", ""),
        "jurisdiction": jur,
        "tax_authority": rules.get("tax_authority", ""),
        "earnings": earnings,
        "deductions": deductions,
        "gross_pay": item.get("gross_salary", 0),
        "total_deductions": item.get("total_deductions", 0),
        "net_pay": item.get("net_pay", 0),
        "currency": item.get("gross_currency", "USD"),
        "net_usd": item.get("net_usd", 0),
        "fx_rate": item.get("fx_rate", 1),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ─── Flask Routes ─────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "payroll-compliance", "version": "1.0.0"})


@app.route("/jurisdictions")
def jurisdictions():
    result = []
    for code, rules in JURISDICTION_RULES.items():
        result.append({
            "code": code,
            "name": rules["name"],
            "currency": rules["currency"],
            "tax_authority": rules["tax_authority"],
            "has_income_tax": rules.get("paye_brackets", [{}])[0].get("rate", 0) > 0 or len(rules.get("paye_brackets", [])) > 1,
            "min_wage": rules.get("min_wage"),
            "min_wage_currency": rules.get("min_wage_currency"),
        })
    return jsonify(result)


@app.route("/jurisdiction/<code>")
def jurisdiction_detail(code: str):
    rules = JURISDICTION_RULES.get(code.upper())
    if not rules:
        return jsonify({"error": f"Jurisdiction {code} not found"}), 404
    return jsonify({**rules, "code": code.upper()})


@app.route("/validate-run", methods=["POST"])
def validate_run():
    data = request.get_json()
    result = validate_payroll_run(
        data.get("company", {}),
        data.get("employees", [])
    )
    return jsonify(result)


@app.route("/compliance-calendar", methods=["GET"])
def compliance_calendar():
    jur = request.args.get("jurisdiction", "NG").upper()
    year = int(request.args.get("year", datetime.now().year))
    calendar = get_compliance_calendar(jur, year)
    return jsonify({
        "jurisdiction": jur,
        "year": year,
        "calendar": calendar,
        "compliance_notes": JURISDICTION_RULES.get(jur, {}).get("compliance_notes", []),
    })


@app.route("/payslip-data", methods=["POST"])
def payslip_data():
    data = request.get_json()
    result = generate_payslip_data(
        data.get("employee", {}),
        data.get("run", {}),
        data.get("item", {})
    )
    return jsonify(result)


@app.route("/tax-brackets/<jurisdiction>")
def tax_brackets(jurisdiction: str):
    rules = JURISDICTION_RULES.get(jurisdiction.upper())
    if not rules:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "jurisdiction": jurisdiction.upper(),
        "name": rules["name"],
        "brackets": rules.get("paye_brackets", []),
        "statutory_deductions": {
            k: v for k, v in rules.items()
            if k not in ["name", "currency", "tax_authority", "pension_regulator",
                         "paye_brackets", "compliance_notes", "min_wage", "min_wage_currency"]
        },
        "compliance_notes": rules.get("compliance_notes", []),
    })


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("COMPLIANCE_PORT", 8202))
    print(f"[payroll-compliance] Listening on :{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
