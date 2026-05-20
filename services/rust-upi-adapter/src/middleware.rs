// UPI adapter middleware (placeholder — actual middleware via tower-http layers in main.rs)
// This module contains shared utilities used by handlers

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Verify HMAC-SHA256 signature from NPCI callbacks
pub fn verify_npci_signature(payload: &str, signature: &str, secret: &str) -> bool {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    // Constant-time comparison to prevent timing attacks
    expected.len() == signature.len()
        && expected
            .bytes()
            .zip(signature.bytes())
            .all(|(a, b)| a == b)
}

/// Mask VPA for logging (e.g., "john@oksbi" → "j***@oksbi")
pub fn mask_vpa(vpa: &str) -> String {
    if let Some(at_pos) = vpa.find('@') {
        let (user, domain) = vpa.split_at(at_pos);
        if user.len() <= 1 {
            return format!("{}***{}", &user[..1], domain);
        }
        format!("{}***{}", &user[..1], domain)
    } else {
        "***".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_vpa() {
        assert_eq!(mask_vpa("john@oksbi"), "j***@oksbi");
        assert_eq!(mask_vpa("a@bank"), "a***@bank");
    }

    #[test]
    fn test_verify_hmac_valid() {
        let secret = "test-secret";
        let payload = "txn123:SUCCESS:1000.00";
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(payload.as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        assert!(verify_npci_signature(payload, &sig, secret));
    }

    #[test]
    fn test_verify_hmac_invalid() {
        assert!(!verify_npci_signature("payload", "invalidsig", "secret"));
    }
}
