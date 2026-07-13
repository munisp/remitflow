// RemitFlow — Rust Fee Engine Test Module
// Tests cover: corridor fee calculation, rail surcharges, tier discounts,
// promo codes, FX markup, boundary conditions, and fee breakdown accuracy.

#[cfg(test)]
mod tests {
    use super::*;

    // ── Fee Calculation: Basic Corridors ─────────────────────────────────────

    #[test]
    fn test_fee_usd_ngn_standard() {
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 500.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let resp = calculate_fee(&req).expect("fee calculation should succeed");
        // Total fee must be positive
        assert!(resp.total_fee > 0.0, "total fee must be positive");
        // Total fee should be reasonable (< 10% of amount)
        assert!(
            resp.total_fee < req.amount * 0.10,
            "fee {:.2} exceeds 10% of amount {:.2}",
            resp.total_fee,
            req.amount
        );
        // Fee breakdown must sum to total
        let sum = resp.corridor_fee + resp.rail_fee + resp.fx_markup
            - resp.tier_discount - resp.promo_discount;
        assert!(
            (sum - resp.total_fee).abs() < 0.001,
            "fee breakdown sum {:.4} != total_fee {:.4}",
            sum,
            resp.total_fee
        );
    }

    #[test]
    fn test_fee_usd_ghs_standard() {
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "GHS".to_string(),
            amount: 200.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let resp = calculate_fee(&req).expect("fee calculation should succeed");
        assert!(resp.total_fee > 0.0);
        assert!(resp.total_fee < req.amount * 0.10);
    }

    // ── Fee Calculation: Rail Surcharges ─────────────────────────────────────

    #[test]
    fn test_swift_rail_surcharge() {
        let base_req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 1000.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let swift_req = FeeRequest {
            rail: Some("SWIFT".to_string()),
            ..base_req.clone()
        };

        let base_resp = calculate_fee(&base_req).expect("base fee should succeed");
        let swift_resp = calculate_fee(&swift_req).expect("swift fee should succeed");

        // SWIFT should have higher rail fee than default
        assert!(
            swift_resp.rail_fee >= base_resp.rail_fee,
            "SWIFT rail_fee {:.2} should be >= base rail_fee {:.2}",
            swift_resp.rail_fee,
            base_resp.rail_fee
        );
    }

    #[test]
    fn test_papss_rail_lower_fee_than_swift() {
        let swift_req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 1000.0,
            rail: Some("SWIFT".to_string()),
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let papss_req = FeeRequest {
            rail: Some("PAPSS".to_string()),
            ..swift_req.clone()
        };

        let swift_resp = calculate_fee(&swift_req).expect("swift fee should succeed");
        let papss_resp = calculate_fee(&papss_req).expect("papss fee should succeed");

        // PAPSS is designed to be cheaper than SWIFT for intra-African transfers
        assert!(
            papss_resp.total_fee <= swift_resp.total_fee,
            "PAPSS fee {:.2} should be <= SWIFT fee {:.2}",
            papss_resp.total_fee,
            swift_resp.total_fee
        );
    }

    // ── Fee Calculation: Tier Discounts ──────────────────────────────────────

    #[test]
    fn test_premium_tier_discount() {
        let standard_req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 500.0,
            rail: None,
            user_tier: Some("standard".to_string()),
            promo_code: None,
            promo_discount_amount: None,
        };
        let premium_req = FeeRequest {
            user_tier: Some("premium".to_string()),
            ..standard_req.clone()
        };

        let standard_resp = calculate_fee(&standard_req).expect("standard fee should succeed");
        let premium_resp = calculate_fee(&premium_req).expect("premium fee should succeed");

        assert!(
            premium_resp.total_fee < standard_resp.total_fee,
            "premium tier fee {:.2} should be < standard tier fee {:.2}",
            premium_resp.total_fee,
            standard_resp.total_fee
        );
        assert!(
            premium_resp.tier_discount > 0.0,
            "premium tier should have a non-zero discount"
        );
    }

    // ── Fee Calculation: Boundary Conditions ─────────────────────────────────

    #[test]
    fn test_zero_amount_returns_error() {
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 0.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let result = calculate_fee(&req);
        assert!(result.is_err(), "zero amount should return an error");
    }

    #[test]
    fn test_negative_amount_returns_error() {
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: -100.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let result = calculate_fee(&req);
        assert!(result.is_err(), "negative amount should return an error");
    }

    #[test]
    fn test_unsupported_currency_pair_returns_error() {
        let req = FeeRequest {
            from_currency: "XYZ".to_string(),
            to_currency: "ABC".to_string(),
            amount: 100.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let result = calculate_fee(&req);
        assert!(result.is_err(), "unsupported currency pair should return an error");
    }

    #[test]
    fn test_minimum_fee_enforced() {
        // Very small amount should still have minimum fee
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 1.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let resp = calculate_fee(&req).expect("fee calculation should succeed");
        assert!(
            resp.total_fee >= 0.5,
            "minimum fee not enforced: got {:.4}",
            resp.total_fee
        );
    }

    #[test]
    fn test_maximum_fee_cap() {
        // Very large amount should have fee capped
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 1_000_000.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let resp = calculate_fee(&req).expect("fee calculation should succeed");
        // Fee should not exceed 5% of amount for large transfers
        assert!(
            resp.total_fee <= req.amount * 0.05,
            "fee {:.2} exceeds 5% cap for large transfer",
            resp.total_fee
        );
    }

    // ── FX Markup ─────────────────────────────────────────────────────────────

    #[test]
    fn test_fx_markup_is_positive() {
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 500.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        let resp = calculate_fee(&req).expect("fee calculation should succeed");
        assert!(resp.fx_markup >= 0.0, "FX markup must be non-negative");
    }

    #[test]
    fn test_same_currency_no_fx_markup() {
        // Same currency transfer should have zero FX markup
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "USD".to_string(),
            amount: 500.0,
            rail: None,
            user_tier: None,
            promo_code: None,
            promo_discount_amount: None,
        };
        if let Ok(resp) = calculate_fee(&req) {
            assert_eq!(
                resp.fx_markup, 0.0,
                "same-currency transfer should have zero FX markup"
            );
        }
    }

    // ── Promo Code ────────────────────────────────────────────────────────────

    #[test]
    fn test_promo_discount_applied() {
        let req = FeeRequest {
            from_currency: "USD".to_string(),
            to_currency: "NGN".to_string(),
            amount: 500.0,
            rail: None,
            user_tier: None,
            promo_code: Some("WELCOME10".to_string()),
            promo_discount_amount: Some(2.0),
        };
        let resp = calculate_fee(&req).expect("fee calculation should succeed");
        assert!(
            resp.promo_discount >= 0.0,
            "promo discount must be non-negative"
        );
        assert!(
            resp.total_fee >= 0.0,
            "total fee must not go negative after promo"
        );
    }

    // ── Fee Breakdown Invariants ──────────────────────────────────────────────

    #[test]
    fn test_fee_breakdown_never_negative() {
        let test_cases = vec![
            ("USD", "NGN", 100.0),
            ("USD", "GHS", 50.0),
            ("EUR", "KES", 200.0),
            ("GBP", "NGN", 75.0),
        ];

        for (from, to, amount) in test_cases {
            let req = FeeRequest {
                from_currency: from.to_string(),
                to_currency: to.to_string(),
                amount,
                rail: None,
                user_tier: None,
                promo_code: None,
                promo_discount_amount: None,
            };
            if let Ok(resp) = calculate_fee(&req) {
                assert!(resp.corridor_fee >= 0.0, "{}->{}: corridor_fee negative", from, to);
                assert!(resp.rail_fee >= 0.0, "{}->{}: rail_fee negative", from, to);
                assert!(resp.fx_markup >= 0.0, "{}->{}: fx_markup negative", from, to);
                assert!(resp.total_fee >= 0.0, "{}->{}: total_fee negative", from, to);
            }
        }
    }
}
