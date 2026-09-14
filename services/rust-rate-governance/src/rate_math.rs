/*!
 * Integer-exact rate math for BDC rate governance.
 *
 * NO FLOATS anywhere: every computation is i128 integer arithmetic over the
 * i64 wire values (rates scaled 1e4 — see README). i128 headroom makes
 * overflow impossible for any i64 inputs:
 *   max intermediate = |i64::MIN| * 10_000 * 2 ≈ 1.9e23  <<  i128::MAX ≈ 1.7e38.
 */

/// Wire scale for rates: a JSON value of 16002500 means a rate of 1600.2500
/// (kobo/naira per 1 FX unit, 4 decimal places of rate precision).
pub const RATE_SCALE: i64 = 10_000;

/// deviationBps = |rate − reference| × 10_000 / reference.
///
/// Division is INTEGER division (floor for the non-negative numerator) — the
/// reported deviation is a display value; the band decision itself is made by
/// [`within_band`] with an exact comparison, so floor rounding here can never
/// admit an out-of-band rate. Saturates to i64::MAX for absurd inputs
/// (reference = 1, rate = i64::MAX) instead of panicking.
pub fn deviation_bps(rate: i64, reference: i64) -> i64 {
    debug_assert!(reference > 0);
    let diff = (rate as i128 - reference as i128).abs();
    let bps = diff * RATE_SCALE as i128 / reference as i128;
    i64::try_from(bps).unwrap_or(i64::MAX)
}

/// Exact band membership: |rate − reference| × 10_000 <= bandBps × reference.
///
/// Cross-multiplied integer comparison — no division, no rounding, so a rate
/// at EXACTLY bandBps deviation is within the band and one scaled unit beyond
/// it is not.
pub fn within_band(rate: i64, reference: i64, band_bps: i64) -> bool {
    debug_assert!(reference > 0 && band_bps >= 0);
    let diff = (rate as i128 - reference as i128).abs();
    diff * RATE_SCALE as i128 <= band_bps as i128 * reference as i128
}

/// Integer division with ROUND-HALF-AWAY-FROM-ZERO (the documented rounding
/// rule for cross rates):
///   q = n / d rounded to the nearest integer; exact halves (|remainder| == d/2)
///   round away from zero:  5/2 → 3,  -5/2 → -3,  1/2 → 1,  -1/2 → -1.
///
/// Identity used (d > 0):  round_half_away(n/d) = sign(n) * (2|n| + d) / (2d)
/// where the outer division is floor.
pub fn div_round_half_away_from_zero(numerator: i128, denominator: i128) -> i128 {
    assert!(denominator > 0, "denominator must be positive");
    let abs = numerator.abs();
    let q = (2 * abs + denominator) / (2 * denominator);
    if numerator < 0 {
        -q
    } else {
        q
    }
}

/// Cross rate scaled 1e4: how many units of the quote currency buy ONE unit of
/// the base currency, composed from the two naira mids:
///   crossRate = numeratorMid × RATE_SCALE / denominatorMid
/// rounded half-away-from-zero. Both mids are kobo per FX unit scaled 1e4, so
/// the scale factors cancel in the ratio and one RATE_SCALE re-applies the
/// wire convention to the dimensionless result.
pub fn cross_rate_scaled(numerator_mid: i64, denominator_mid: i64) -> i64 {
    debug_assert!(numerator_mid > 0 && denominator_mid > 0);
    let v = div_round_half_away_from_zero(
        numerator_mid as i128 * RATE_SCALE as i128,
        denominator_mid as i128,
    );
    i64::try_from(v).unwrap_or(if v < 0 { i64::MIN } else { i64::MAX })
}
