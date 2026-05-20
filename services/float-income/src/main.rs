use serde::{Deserialize, Serialize};

const CBN_MPR: f64 = 0.265;
const SETTLEMENT_DAYS: f64 = 2.0;
const DAYS_PER_YEAR: f64 = 365.0;
const FLOAT_YIELD_FACTOR: f64 = 0.60;

#[derive(Debug, Deserialize)]
struct FloatRequest {
    daily_volume_ngn: f64,
    settlement_days: Option<f64>,
    annual_growth_rate: Option<f64>,
    projection_years: Option<u32>,
}

#[derive(Debug, Serialize)]
struct FloatResult {
    year: u32,
    daily_volume_ngn: f64,
    float_balance_ngn: f64,
    annual_float_income_ngn: f64,
    daily_float_income_ngn: f64,
    effective_yield_pct: f64,
    cbn_mpr_pct: f64,
    settlement_days: f64,
}

#[derive(Debug, Serialize)]
struct FloatResponse {
    projections: Vec<FloatResult>,
    total_5yr_income_ngn: f64,
    npv_at_10pct_ngn: f64,
    assumptions: FloatAssumptions,
}

#[derive(Debug, Serialize)]
struct FloatAssumptions {
    cbn_mpr_pct: f64,
    float_yield_factor: f64,
    effective_yield_pct: f64,
    settlement_days: f64,
}

fn effective_yield() -> f64 { CBN_MPR * FLOAT_YIELD_FACTOR }
fn float_balance(daily: f64, days: f64) -> f64 { daily * days }
fn annual_float_income(balance: f64) -> f64 { balance * effective_yield() }
fn daily_float_income(balance: f64) -> f64 { annual_float_income(balance) / DAYS_PER_YEAR }
fn r2(v: f64) -> f64 { (v * 100.0).round() / 100.0 }

fn npv(flows: &[f64], rate: f64) -> f64 {
    flows.iter().enumerate().map(|(i, &cf)| cf / (1.0 + rate).powi((i + 1) as i32)).sum()
}

fn project_float(req: &FloatRequest) -> FloatResponse {
    let settlement = req.settlement_days.unwrap_or(SETTLEMENT_DAYS);
    let growth = req.annual_growth_rate.unwrap_or(0.30);
    let years = req.projection_years.unwrap_or(5);
    let yield_rate = effective_yield();
    let mut projections = Vec::new();
    let mut total_income = 0.0;
    let mut cash_flows = Vec::new();
    for yr in 1..=years {
        let vol = req.daily_volume_ngn * (1.0 + growth).powi((yr - 1) as i32);
        let balance = float_balance(vol, settlement);
        let annual_income = annual_float_income(balance);
        let daily_income = daily_float_income(balance);
        total_income += annual_income;
        cash_flows.push(annual_income);
        projections.push(FloatResult {
            year: yr,
            daily_volume_ngn: r2(vol),
            float_balance_ngn: r2(balance),
            annual_float_income_ngn: r2(annual_income),
            daily_float_income_ngn: r2(daily_income),
            effective_yield_pct: r2(yield_rate * 100.0),
            cbn_mpr_pct: r2(CBN_MPR * 100.0),
            settlement_days: settlement,
        });
    }
    let npv_val = npv(&cash_flows, 0.10);
    FloatResponse {
        projections,
        total_5yr_income_ngn: r2(total_income),
        npv_at_10pct_ngn: r2(npv_val),
        assumptions: FloatAssumptions {
            cbn_mpr_pct: CBN_MPR * 100.0,
            float_yield_factor: FLOAT_YIELD_FACTOR,
            effective_yield_pct: yield_rate * 100.0,
            settlement_days: settlement,
        },
    }
}

fn main() {
    eprintln!("[float-income] library mode — use as HTTP service via wrapper");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_effective_yield() {
        let y = effective_yield();
        assert!((y - 0.159).abs() < 0.001, "expected ~15.9%, got {}", y);
    }

    #[test]
    fn test_float_balance_t2() {
        assert_eq!(float_balance(1_000_000_000.0, 2.0), 2_000_000_000.0);
    }

    #[test]
    fn test_annual_float_income_basic() {
        let income = annual_float_income(2_000_000_000.0);
        assert!(income > 300_000_000.0 && income < 340_000_000.0,
            "expected ~318M NGN, got {}", income);
    }

    #[test]
    fn test_daily_float_income() {
        let daily = daily_float_income(2_000_000_000.0);
        let annual = annual_float_income(2_000_000_000.0);
        assert!((daily * 365.0 - annual).abs() < 1.0);
    }

    #[test]
    fn test_project_float_5yr() {
        let req = FloatRequest {
            daily_volume_ngn: 500_000_000.0,
            settlement_days: Some(2.0),
            annual_growth_rate: Some(0.30),
            projection_years: Some(5),
        };
        let resp = project_float(&req);
        assert_eq!(resp.projections.len(), 5);
        assert!((resp.projections[0].float_balance_ngn - 1_000_000_000.0).abs() < 1.0);
        assert!(resp.projections[4].annual_float_income_ngn > resp.projections[0].annual_float_income_ngn);
        assert!(resp.total_5yr_income_ngn > 0.0);
    }

    #[test]
    fn test_project_float_growth() {
        let req = FloatRequest {
            daily_volume_ngn: 1_000_000_000.0,
            settlement_days: Some(2.0),
            annual_growth_rate: Some(0.30),
            projection_years: Some(3),
        };
        let resp = project_float(&req);
        let y1 = resp.projections[0].daily_volume_ngn;
        let y2 = resp.projections[1].daily_volume_ngn;
        assert!((y2 / y1 - 1.30).abs() < 0.01);
    }

    #[test]
    fn test_npv_positive() {
        let req = FloatRequest {
            daily_volume_ngn: 500_000_000.0,
            settlement_days: Some(2.0),
            annual_growth_rate: Some(0.25),
            projection_years: Some(5),
        };
        let resp = project_float(&req);
        assert!(resp.npv_at_10pct_ngn > 0.0);
    }

    #[test]
    fn test_settlement_days_3() {
        let req = FloatRequest {
            daily_volume_ngn: 1_000_000_000.0,
            settlement_days: Some(3.0),
            annual_growth_rate: None,
            projection_years: Some(1),
        };
        let resp = project_float(&req);
        assert!((resp.projections[0].float_balance_ngn - 3_000_000_000.0).abs() < 1.0);
    }

    #[test]
    fn test_assumptions_in_response() {
        let req = FloatRequest {
            daily_volume_ngn: 100_000_000.0,
            settlement_days: None,
            annual_growth_rate: None,
            projection_years: Some(1),
        };
        let resp = project_float(&req);
        assert!((resp.assumptions.cbn_mpr_pct - 26.5).abs() < 0.1);
        assert!((resp.assumptions.float_yield_factor - 0.60).abs() < 0.01);
    }

    #[test]
    fn test_high_volume_scenario() {
        let req = FloatRequest {
            daily_volume_ngn: 10_000_000_000.0,
            settlement_days: Some(2.0),
            annual_growth_rate: Some(0.20),
            projection_years: Some(5),
        };
        let resp = project_float(&req);
        assert!(resp.total_5yr_income_ngn > 10_000_000_000.0);
    }

    #[test]
    fn test_zero_growth() {
        let req = FloatRequest {
            daily_volume_ngn: 500_000_000.0,
            settlement_days: Some(2.0),
            annual_growth_rate: Some(0.0),
            projection_years: Some(3),
        };
        let resp = project_float(&req);
        let y1 = resp.projections[0].annual_float_income_ngn;
        let y3 = resp.projections[2].annual_float_income_ngn;
        assert!((y1 - y3).abs() < 1.0);
    }

    #[test]
    fn test_daily_accrual_calc() {
        let balance = 5_000_000_000.0_f64;
        let daily = daily_float_income(balance);
        let annual = annual_float_income(balance);
        assert!((daily * 365.0 - annual).abs() < 10.0);
        assert!(daily > 0.0);
    }
}
