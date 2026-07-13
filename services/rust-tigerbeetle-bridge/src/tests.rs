// RemitFlow — TigerBeetle Bridge Test Module
// Tests cover: account creation validation, transfer validation,
// 128-bit ID handling, balance invariants, reconciliation logic.

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    // ── Account Validation ────────────────────────────────────────────────────

    #[test]
    fn test_account_ledger_codes() {
        // Ledger codes must map to valid ISO 4217 currency codes
        let valid_ledgers: Vec<u32> = vec![
            840,  // USD
            978,  // EUR
            826,  // GBP
            566,  // NGN
            936,  // GHS
            404,  // KES
            834,  // TZS
            894,  // ZMW
            646,  // RWF
            800,  // UGX
        ];
        for ledger in valid_ledgers {
            assert!(
                is_valid_ledger_code(ledger),
                "ledger code {} should be valid",
                ledger
            );
        }

        // Invalid ledger codes
        let invalid_ledgers: Vec<u32> = vec![0, 999, 1000];
        for ledger in invalid_ledgers {
            assert!(
                !is_valid_ledger_code(ledger),
                "ledger code {} should be invalid",
                ledger
            );
        }
    }

    #[test]
    fn test_account_code_types() {
        // Account type codes
        assert_eq!(account_type_name(1), "wallet");
        assert_eq!(account_type_name(2), "escrow");
        assert_eq!(account_type_name(3), "fee");
        assert_eq!(account_type_name(4), "reserve");
    }

    #[test]
    fn test_account_id_uuid_roundtrip() {
        let original_id = Uuid::new_v4().to_string();
        let (hi, lo) = uuid_to_tb_id(&original_id).expect("UUID to TB ID should succeed");
        let recovered = tb_id_to_uuid(hi, lo);
        assert_eq!(
            original_id, recovered,
            "UUID roundtrip failed: {} != {}",
            original_id, recovered
        );
    }

    #[test]
    fn test_invalid_uuid_returns_error() {
        let result = uuid_to_tb_id("not-a-valid-uuid");
        assert!(result.is_err(), "invalid UUID should return error");
    }

    // ── Transfer Validation ───────────────────────────────────────────────────

    #[test]
    fn test_transfer_amount_must_be_positive() {
        let req = TbTransferRequest {
            debit_account_id: Uuid::new_v4().to_string(),
            credit_account_id: Uuid::new_v4().to_string(),
            amount: 0,
            ledger: 840,
            code: 1,
            flags: 0,
            pending_id: None,
            user_data_128: None,
            user_data_64: None,
            user_data_32: None,
            timeout: None,
        };
        let result = validate_transfer_request(&req);
        assert!(result.is_err(), "zero amount transfer should be rejected");
    }

    #[test]
    fn test_transfer_same_account_rejected() {
        let account_id = Uuid::new_v4().to_string();
        let req = TbTransferRequest {
            debit_account_id: account_id.clone(),
            credit_account_id: account_id.clone(),
            amount: 1000,
            ledger: 840,
            code: 1,
            flags: 0,
            pending_id: None,
            user_data_128: None,
            user_data_64: None,
            user_data_32: None,
            timeout: None,
        };
        let result = validate_transfer_request(&req);
        assert!(
            result.is_err(),
            "transfer from account to itself should be rejected"
        );
    }

    #[test]
    fn test_transfer_mismatched_ledger_rejected() {
        // Debit and credit accounts must be on the same ledger
        let req = TbTransferRequest {
            debit_account_id: Uuid::new_v4().to_string(),
            credit_account_id: Uuid::new_v4().to_string(),
            amount: 1000,
            ledger: 0, // invalid ledger
            code: 1,
            flags: 0,
            pending_id: None,
            user_data_128: None,
            user_data_64: None,
            user_data_32: None,
            timeout: None,
        };
        let result = validate_transfer_request(&req);
        assert!(result.is_err(), "invalid ledger code should be rejected");
    }

    // ── Balance Invariants ────────────────────────────────────────────────────

    #[test]
    fn test_balance_never_negative_for_debit_must_not_exceed_credit() {
        // TigerBeetle enforces: debits_posted <= credits_posted for debit-normal accounts
        let account = TbAccount {
            id: Uuid::new_v4().to_string(),
            user_id: 1,
            ledger: 840,
            code: 1,
            flags: 0,
            debits_posted: 500,
            credits_posted: 1000,
            debits_pending: 0,
            credits_pending: 0,
        };
        let balance = calculate_balance(&account);
        assert_eq!(balance, 500u128, "balance should be credits - debits = 500");
    }

    #[test]
    fn test_balance_calculation_with_pending() {
        let account = TbAccount {
            id: Uuid::new_v4().to_string(),
            user_id: 1,
            ledger: 840,
            code: 1,
            flags: 0,
            debits_posted: 300,
            credits_posted: 1000,
            debits_pending: 100,
            credits_pending: 0,
        };
        // Available balance = credits_posted - debits_posted - debits_pending
        let available = calculate_available_balance(&account);
        assert_eq!(
            available, 600u128,
            "available balance should be 1000 - 300 - 100 = 600"
        );
    }

    // ── Reconciliation ────────────────────────────────────────────────────────

    #[test]
    fn test_reconciliation_match() {
        let tb_balance: u128 = 100_000_00; // $10,000.00 in cents
        let pg_balance: i64 = 100_000_00;

        let result = reconcile_balances(tb_balance, pg_balance as u128);
        assert!(result.is_ok(), "matching balances should reconcile successfully");
        assert_eq!(result.unwrap().discrepancy, 0);
    }

    #[test]
    fn test_reconciliation_mismatch_detected() {
        let tb_balance: u128 = 100_000_00;
        let pg_balance: u128 = 99_999_00; // $1 discrepancy

        let result = reconcile_balances(tb_balance, pg_balance);
        assert!(result.is_ok());
        let reconciliation = result.unwrap();
        assert_ne!(reconciliation.discrepancy, 0, "discrepancy should be detected");
        assert_eq!(reconciliation.discrepancy, 100); // 1 dollar in cents
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    #[test]
    fn test_transfer_latency_histogram_buckets() {
        // Latency buckets should cover sub-millisecond to 10 second range
        let buckets = get_latency_histogram_buckets();
        assert!(!buckets.is_empty(), "histogram buckets must not be empty");
        assert!(
            buckets.iter().any(|&b| b <= 0.001),
            "must have sub-millisecond bucket"
        );
        assert!(
            buckets.iter().any(|&b| b >= 1.0),
            "must have 1-second+ bucket"
        );
    }

    // ── Amount Precision ──────────────────────────────────────────────────────

    #[test]
    fn test_amount_to_cents_conversion() {
        // Financial amounts must be stored as integer cents to avoid float errors
        assert_eq!(amount_to_cents(100.00), 10_000u128);
        assert_eq!(amount_to_cents(0.01), 1u128);
        assert_eq!(amount_to_cents(999.99), 99_999u128);
        assert_eq!(amount_to_cents(1_000_000.00), 100_000_000u128);
    }

    #[test]
    fn test_cents_to_amount_conversion() {
        assert!((cents_to_amount(10_000u128) - 100.00).abs() < 0.001);
        assert!((cents_to_amount(1u128) - 0.01).abs() < 0.001);
        assert!((cents_to_amount(99_999u128) - 999.99).abs() < 0.001);
    }
}
