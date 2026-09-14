// RemitFlow — Rust Rate Governance Test Module
// Unit tests for the integer-exact rate math and input validation. Pure
// functions only — these tests must pass with no network, no database, no
// external services.

#[cfg(test)]
mod tests {
    use crate::rate_math::{
        cross_rate_scaled, deviation_bps, div_round_half_away_from_zero, within_band, RATE_SCALE,
    };
    use crate::{
        check_cross_body, check_validate_body, ApiError, CrossBody, NgnMidPerUnit, ValidateBody,
    };

    // ─── Band validation: exact bps boundaries ────────────────────────────────
    //
    // Reference 16000000 (= rate 1600.0000), band 50 bps.
    // Exact 50 bps deviation = 16000000 * 50 / 10000 = 80000 scaled units.

    #[test]
    fn within_band_true_at_exactly_band_bps() {
        // rate 1608.0000 is EXACTLY 50 bps above reference 1600.0000 → within.
        assert!(within_band(16_080_000, 16_000_000, 50));
        assert_eq!(deviation_bps(16_080_000, 16_000_000), 50);
        // Symmetric downside: 1592.0000 is exactly 50 bps below → within.
        assert!(within_band(15_920_000, 16_000_000, 50));
        assert_eq!(deviation_bps(15_920_000, 16_000_000), 50);
    }

    #[test]
    fn within_band_false_one_scaled_unit_beyond_band() {
        // One scaled unit past the boundary must NOT be admitted — the band
        // check is an exact cross-multiplied comparison, immune to the floor
        // rounding of the reported deviationBps (which still displays 50).
        assert!(!within_band(16_080_001, 16_000_000, 50));
        assert_eq!(deviation_bps(16_080_001, 16_000_000), 50); // floor display
        assert!(!within_band(15_919_999, 16_000_000, 50));
        assert_eq!(deviation_bps(15_919_999, 16_000_000), 50);
    }

    #[test]
    fn deviation_bps_integer_math() {
        // rate 1700.0000 vs reference 1600.0000: 100/1600 = 625 bps exactly.
        assert_eq!(deviation_bps(17_000_000, 16_000_000), 625);
        assert!(within_band(17_000_000, 16_000_000, 625));
        assert!(!within_band(17_000_000, 16_000_000, 624));
        // Zero deviation.
        assert_eq!(deviation_bps(16_000_000, 16_000_000), 0);
        assert!(within_band(16_000_000, 16_000_000, 0));
        // Floor rounding of the display value: 1/3 bps → 0.
        assert_eq!(deviation_bps(16_000_001, 30_000_000), 0);
    }

    #[test]
    fn extreme_inputs_do_not_overflow() {
        // i64 extremes: i128 intermediates make overflow impossible; the
        // reported deviation saturates instead of panicking.
        assert!(!within_band(i64::MAX, 1, i64::MAX));
        assert_eq!(deviation_bps(i64::MAX, 1), i64::MAX); // saturated
        assert!(within_band(i64::MAX, i64::MAX, 0));
        assert_eq!(deviation_bps(i64::MAX, i64::MAX), 0);
        // Band check itself never saturates: diff*1e4 vs band*reference in i128.
        assert!(within_band(2_000_000, 1_000_000, 10_000)); // 100% band
        assert!(!within_band(2_000_001, 1_000_000, 10_000));
    }

    // ─── Rounding: half-away-from-zero ────────────────────────────────────────

    #[test]
    fn round_half_away_from_zero_exact_halves() {
        // The defining cases: exact .5 fractions round AWAY from zero.
        assert_eq!(div_round_half_away_from_zero(1, 2), 1); // 0.5 → 1
        assert_eq!(div_round_half_away_from_zero(-1, 2), -1); // -0.5 → -1
        assert_eq!(div_round_half_away_from_zero(3, 2), 2); // 1.5 → 2
        assert_eq!(div_round_half_away_from_zero(-3, 2), -2);
        assert_eq!(div_round_half_away_from_zero(5, 2), 3); // 2.5 → 3
        assert_eq!(div_round_half_away_from_zero(-5, 2), -3);
        assert_eq!(div_round_half_away_from_zero(25, 10), 3); // 2.5 → 3
        assert_eq!(div_round_half_away_from_zero(7, 2), 4); // 3.5 → 4
        assert_eq!(div_round_half_away_from_zero(-7, 2), -4);
    }

    #[test]
    fn round_half_away_from_zero_non_ties() {
        assert_eq!(div_round_half_away_from_zero(4, 2), 2); // exact 2.0
        assert_eq!(div_round_half_away_from_zero(3, 4), 1); // 0.75 → 1
        assert_eq!(div_round_half_away_from_zero(2, 8), 0); // 0.25 → 0
        assert_eq!(div_round_half_away_from_zero(9, 4), 2); // 2.25 → 2
        assert_eq!(div_round_half_away_from_zero(-9, 4), -2);
        assert_eq!(div_round_half_away_from_zero(11, 4), 3); // 2.75 → 3
        assert_eq!(div_round_half_away_from_zero(0, 7), 0);
    }

    // ─── Cross-rate composition (hand-computed vectors) ───────────────────────

    #[test]
    fn cross_rate_usd_gbp_via_naira_mid() {
        // USD mid 1600.2500 NGN → 16002500; GBP mid 2050.0000 NGN → 20500000.
        // buyRate  = 16002500*10000/20500000 = 7806.0975... → 7806 (GBP per USD, scaled)
        // sellRate = 20500000*10000/16002500 = 12810.4983... → 12810 (USD per GBP, scaled)
        assert_eq!(cross_rate_scaled(16_002_500, 20_500_000), 7_806);
        assert_eq!(cross_rate_scaled(20_500_000, 16_002_500), 12_810);
    }

    #[test]
    fn cross_rate_exact_half_tie_rounds_away_from_zero() {
        // from-mid 10005, to-mid 20000:
        // buyRate = 10005*10000/20000 = 5002.5 EXACT tie → 5003 (away from zero).
        assert_eq!(cross_rate_scaled(10_005, 20_000), 5_003);
        // sellRate = 20000*10000/10005 = 19990.0049... → 19990.
        assert_eq!(cross_rate_scaled(20_000, 10_005), 19_990);
    }

    #[test]
    fn cross_rate_parity_and_extremes() {
        // Equal mids → 1:1 rate at scale.
        assert_eq!(cross_rate_scaled(12_345, 12_345), RATE_SCALE);
        // Large ratio: i128 intermediates cannot overflow; the i64 result
        // saturates at i64::MAX instead of panicking or wrapping.
        assert_eq!(cross_rate_scaled(i64::MAX / 2, 1), i64::MAX);
    }

    // ─── Input validation → typed 400s ────────────────────────────────────────

    fn vbody(rate: i64, reference: i64, band_bps: i64) -> ValidateBody {
        ValidateBody { rate, reference, band_bps }
    }

    #[test]
    fn zero_or_negative_reference_rejected() {
        for reference in [0, -1, i64::MIN] {
            let err = check_validate_body(&vbody(16_000_000, reference, 50)).unwrap_err();
            assert!(
                matches!(err, ApiError::InvalidReference),
                "reference {reference} must be INVALID_REFERENCE"
            );
            assert_eq!(err.code(), "INVALID_REFERENCE");
        }
    }

    #[test]
    fn invalid_rate_and_band_rejected() {
        assert!(matches!(
            check_validate_body(&vbody(0, 16_000_000, 50)).unwrap_err(),
            ApiError::InvalidRate
        ));
        assert!(matches!(
            check_validate_body(&vbody(-5, 16_000_000, 50)).unwrap_err(),
            ApiError::InvalidRate
        ));
        assert!(matches!(
            check_validate_body(&vbody(16_000_000, 16_000_000, -1)).unwrap_err(),
            ApiError::InvalidBand
        ));
        // bandBps = 0 is valid: only an exact match is within band.
        assert!(check_validate_body(&vbody(16_000_000, 16_000_000, 0)).is_ok());
    }

    #[test]
    fn cross_body_validation() {
        let cbody = |from: &str, to: &str, mf: i64, mt: i64| CrossBody {
            from_ccy: from.to_string(),
            to_ccy: to.to_string(),
            ngn_mid_per_unit: NgnMidPerUnit { from: mf, to: mt },
        };
        // Happy path, lowercase normalized to upper.
        assert_eq!(
            check_cross_body(&cbody("usd", "gbp", 1, 1)).unwrap(),
            (String::from("USD"), String::from("GBP"))
        );
        // Zero/negative mids rejected (the "zero reference" analogue for cross).
        assert!(matches!(check_cross_body(&cbody("USD", "GBP", 0, 1)).unwrap_err(), ApiError::InvalidMid));
        assert!(matches!(check_cross_body(&cbody("USD", "GBP", 1, -7)).unwrap_err(), ApiError::InvalidMid));
        // Bad currency codes.
        assert!(matches!(check_cross_body(&cbody("US", "GBP", 1, 1)).unwrap_err(), ApiError::InvalidCurrency));
        assert!(matches!(check_cross_body(&cbody("U1D", "GBP", 1, 1)).unwrap_err(), ApiError::InvalidCurrency));
        assert!(matches!(check_cross_body(&cbody("USDX", "GBP", 1, 1)).unwrap_err(), ApiError::InvalidCurrency));
        // Same currency both sides.
        assert!(matches!(check_cross_body(&cbody("USD", "USD", 1, 1)).unwrap_err(), ApiError::SameCurrency));
    }

    // ─── Wire contract: JSON shape & SPEC field-name aliases ─────────────────

    #[test]
    fn validate_body_accepts_spec_and_contract_field_names() {
        // Contract names.
        let b: ValidateBody =
            serde_json::from_str(r#"{"rate":16002500,"reference":16000000,"bandBps":50}"#).unwrap();
        assert_eq!(b.rate, 16_002_500);
        // SPEC-bdc §4.4 names (aliases → identical semantics).
        let b2: ValidateBody =
            serde_json::from_str(r#"{"rateMinor":16002500,"referenceMinor":16000000,"bandBps":50}"#)
                .unwrap();
        assert_eq!(b2.reference, 16_000_000);
        assert_eq!(b2.band_bps, 50);
    }

    #[test]
    fn fractional_json_numbers_rejected_for_i64_fields() {
        // Rates are integer scaled values — 1600.25 on the wire is a client bug.
        assert!(serde_json::from_str::<ValidateBody>(
            r#"{"rate":1600.25,"reference":16000000,"bandBps":50}"#
        )
        .is_err());
    }

    #[test]
    fn error_serializes_to_typed_shape() {
        let (status, axum::Json(body)) = crate::error_response(
            axum::http::StatusCode::BAD_REQUEST,
            ApiError::InvalidReference.code(),
            ApiError::InvalidReference.to_string(),
        );
        assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["error"]["code"], "INVALID_REFERENCE");
        assert!(v["error"]["message"].as_str().unwrap().contains("reference"));
    }

    #[test]
    fn trace_id_extraction() {
        use axum::http::HeaderMap;
        let mut h = HeaderMap::new();
        h.insert(
            "traceparent",
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01".parse().unwrap(),
        );
        assert_eq!(
            crate::extract_trace_id(&h).as_deref(),
            Some("0af7651916cd43dd8448eb211c80319c")
        );
        // Invalid traceparent (bad trace id) → falls back to x-trace-id.
        let mut h2 = HeaderMap::new();
        h2.insert("traceparent", "00-not-a-trace-id-b7ad6b7169203331-01".parse().unwrap());
        h2.insert("x-trace-id", "trace-abc-123".parse().unwrap());
        assert_eq!(crate::extract_trace_id(&h2).as_deref(), Some("trace-abc-123"));
        // All-zero trace id is invalid per W3C.
        let mut h3 = HeaderMap::new();
        h3.insert(
            "traceparent",
            "00-00000000000000000000000000000000-b7ad6b7169203331-01".parse().unwrap(),
        );
        assert_eq!(crate::extract_trace_id(&h3), None);
        // No headers → None.
        assert_eq!(crate::extract_trace_id(&HeaderMap::new()), None);
    }
}
