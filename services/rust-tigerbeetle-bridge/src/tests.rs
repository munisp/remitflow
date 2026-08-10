// RemitFlow — TigerBeetle Bridge Test Module
// Unit tests for crate-independent validation/serialization helpers.
// Cluster integration is covered by docker-compose healthchecks — these tests
// must pass without a TigerBeetle replica.

#[cfg(test)]
mod tests {
    use crate::tb_client::{NewAccount, NewTransfer, OpError};

    #[test]
    fn parses_new_account_from_ts_contract_json() {
        let body: NewAccount = serde_json::from_str(r#"{
            "id": "340282366920938463463374607431768211455",
            "ledger": 566,
            "code": 1000,
            "flags": 10,
            "user_data_128": "42",
            "user_data_64": "0",
            "user_data_32": 0
        }"#).expect("valid TS payload must parse");
        assert_eq!(body.ledger, 566);
        assert_eq!(body.code, 1000);
        assert_eq!(body.flags, 10);
        assert!(body.id.parse::<u128>().is_ok(), "128-bit ids must round-trip as decimal strings");
    }

    #[test]
    fn parses_new_transfer_with_defaults() {
        // TS always sends all fields, but missing optional fields must default
        // rather than reject — forward compatibility.
        let body: NewTransfer = serde_json::from_str(r#"{
            "id": "123",
            "debit_account_id": "456",
            "credit_account_id": "789",
            "amount": "10000",
            "ledger": 840,
            "code": 1
        }"#).expect("valid TS payload must parse");
        assert_eq!(body.amount.parse::<u128>().unwrap(), 10_000u128);
        assert_eq!(body.flags, 0);
        assert!(body.pending_id.is_empty());
    }

    #[test]
    fn rejects_overflowing_u128_ids() {
        // 2^128 — one past the maximum. Must not silently truncate.
        assert!("340282366920938463463374607431768211456".parse::<u128>().is_err());
    }

    #[test]
    fn op_error_serializes_to_ts_contract_shape() {
        let err = OpError { index: 3, reason: "ExceedsDebits".into(), code: "ExceedsDebits".into() };
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["index"], 3);
        assert!(v.get("reason").is_some());
        assert!(v.get("code").is_some());
    }
}
