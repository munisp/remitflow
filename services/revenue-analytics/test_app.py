"""Tests for RemitFlow Revenue Analytics Service"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from app import classify_segment, score_cross_sell, track_formalization, model_scenario, SEGMENT_REVENUE
import math

def test_classify_labor_default():
    r = classify_segment({"amount_usd": 200, "purpose_code": "FAM"})
    assert r["segment"] == "labor", r
    assert r["fee_pct"] == 3.5

def test_classify_hnw():
    r = classify_segment({"amount_usd": 15000, "purpose_code": "INV", "frequency_per_year": 2})
    assert r["segment"] == "hnw", r
    assert r["confidence"] >= 0.80

def test_classify_education():
    r = classify_segment({"amount_usd": 5000, "purpose_code": "EDU", "purpose_description": "university tuition payment"})
    assert r["segment"] == "education", r

def test_classify_medical():
    r = classify_segment({"amount_usd": 3000, "purpose_code": "MED", "purpose_description": "hospital treatment abroad"})
    assert r["segment"] == "medical", r

def test_classify_sme():
    r = classify_segment({"amount_usd": 8000, "purpose_code": "TRD", "purpose_description": "import invoice payment"})
    assert r["segment"] == "sme", r

def test_annual_revenue_positive():
    r = classify_segment({"amount_usd": 500, "purpose_code": "FAM", "frequency_per_year": 12})
    assert r["annual_revenue_usd"] > 0

def test_cross_sell_hnw_high_score():
    r = score_cross_sell({"segment": "hnw", "amount_usd": 20000, "frequency_per_year": 4,
                          "months_active": 18, "has_nigerian_account": True,
                          "has_diaspora_account": False, "age_group": "36-50"})
    assert r["propensity_score"] > 0.7
    assert "Investment" in r["recommended_product"]

def test_cross_sell_labor_lower_score():
    r = score_cross_sell({"segment": "labor", "amount_usd": 200, "frequency_per_year": 2,
                          "months_active": 2, "has_nigerian_account": False,
                          "has_diaspora_account": False, "age_group": "18-25"})
    assert r["propensity_score"] < 0.6

def test_cross_sell_ltv_positive():
    r = score_cross_sell({"segment": "education", "amount_usd": 5000, "frequency_per_year": 2,
                          "months_active": 6, "has_nigerian_account": False,
                          "has_diaspora_account": False, "age_group": "26-35"})
    assert r["expected_ltv_usd"] > 0

def test_formalization_cash_to_mobile():
    r = track_formalization({"cohort_size": 1000, "current_channel": "cash", "months_observed": 6, "incentive_offered": False})
    assert r["migration_rate"] > 0
    assert r["expected_conversions"] > 0
    assert r["revenue_uplift_usd"] > 0

def test_formalization_incentive_boosts_rate():
    r_no = track_formalization({"cohort_size": 100, "current_channel": "cash", "months_observed": 6, "incentive_offered": False})
    r_yes = track_formalization({"cohort_size": 100, "current_channel": "cash", "months_observed": 6, "incentive_offered": True})
    assert r_yes["migration_rate"] > r_no["migration_rate"]

def test_formalization_time_factor():
    r_short = track_formalization({"cohort_size": 100, "current_channel": "mobile", "months_observed": 1, "incentive_offered": False})
    r_long = track_formalization({"cohort_size": 100, "current_channel": "mobile", "months_observed": 6, "incentive_offered": False})
    assert r_long["migration_rate"] >= r_short["migration_rate"]

def test_scenario_model_basic():
    r = model_scenario({"base_daily_volume_ngn": 500_000_000,
                        "growth_scenarios": {"base": 0.25},
                        "segment_mix": {"labor": 0.55, "education": 0.20, "medical": 0.10, "sme": 0.10, "hnw": 0.05},
                        "years": 5, "fx_rate_ngn_usd": 1600.0})
    assert r["count"] == 5
    assert all(s["total_revenue_usd"] > 0 for s in r["scenarios"])

def test_scenario_bull_gt_bear():
    r = model_scenario({"base_daily_volume_ngn": 500_000_000,
                        "growth_scenarios": {"bear": 0.10, "bull": 0.45},
                        "segment_mix": {"labor": 1.0}, "years": 3, "fx_rate_ngn_usd": 1600.0})
    bear_y3 = next(s for s in r["scenarios"] if s["scenario"] == "bear" and s["year"] == 3)
    bull_y3 = next(s for s in r["scenarios"] if s["scenario"] == "bull" and s["year"] == 3)
    assert bull_y3["total_revenue_usd"] > bear_y3["total_revenue_usd"]

def test_scenario_three_scenarios_count():
    r = model_scenario({"base_daily_volume_ngn": 1_000_000_000,
                        "growth_scenarios": {"bear": 0.10, "base": 0.25, "bull": 0.45},
                        "segment_mix": {"labor": 1.0}, "years": 5, "fx_rate_ngn_usd": 1600.0})
    assert r["count"] == 15

def test_cross_sell_score_bounds():
    for seg in ["hnw", "education", "medical", "sme", "labor"]:
        r = score_cross_sell({"segment": seg, "amount_usd": 1000, "frequency_per_year": 1,
                               "months_active": 6, "has_nigerian_account": False,
                               "has_diaspora_account": False, "age_group": "26-35"})
        assert 0 < r["propensity_score"] < 1

def test_formalization_incentive_present():
    for ch in ["cash", "mobile", "account"]:
        r = track_formalization({"cohort_size": 100, "current_channel": ch, "months_observed": 3, "incentive_offered": False})
        assert len(r["recommended_incentive"]) > 10

def test_scenario_float_income_positive():
    r = model_scenario({"base_daily_volume_ngn": 1_000_000_000,
                        "growth_scenarios": {"base": 0.25},
                        "segment_mix": {"labor": 1.0}, "years": 1, "fx_rate_ngn_usd": 1600.0})
    assert r["scenarios"][0]["float_income_usd"] > 0

def test_classify_reasoning_present():
    r = classify_segment({"amount_usd": 200, "purpose_code": "FAM"})
    assert len(r["reasoning"]) > 5

def test_segment_revenue_constants():
    for seg, rev in SEGMENT_REVENUE.items():
        assert rev["fee_pct"] > 0
        assert rev["spread_bps"] > 0
        assert 0 < rev["cross_sell_prob"] < 1

def test_cross_sell_education_product():
    r = score_cross_sell({"segment": "education", "amount_usd": 5000, "frequency_per_year": 2,
                          "months_active": 12, "has_nigerian_account": False,
                          "has_diaspora_account": False, "age_group": "26-35"})
    assert "Student" in r["recommended_product"] or "FX" in r["recommended_product"]

def test_scenario_year_growth():
    r = model_scenario({"base_daily_volume_ngn": 500_000_000,
                        "growth_scenarios": {"base": 0.30},
                        "segment_mix": {"labor": 1.0}, "years": 2, "fx_rate_ngn_usd": 1600.0})
    y1 = r["scenarios"][0]["volume_usd"]
    y2 = r["scenarios"][1]["volume_usd"]
    assert abs(y2 / y1 - 1.30) < 0.01

if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS: {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL: {t.__name__} -- {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
