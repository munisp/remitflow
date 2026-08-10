/*!
 * TigerBeetle client adapter.
 *
 * All direct interaction with the `tigerbeetle-unofficial` crate is contained
 * in this module. The crate is the only real Rust client for the TigerBeetle
 * binary wire protocol (there is no official Rust client and the TB server
 * exposes no HTTP API — any HTTP-based "TB client" is theater).
 *
 * The adapter converts between the wire types and the plain data structures
 * the HTTP layer serves, so crate API drift touches only this file.
 */

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tigerbeetle_unofficial as tb;

// ─── Plain data structures (crate-independent) ────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct NewAccount {
    /// 128-bit account id as decimal string.
    pub id: String,
    pub ledger: u32,
    pub code: u16,
    #[serde(default)]
    pub flags: u16,
    #[serde(default)]
    pub user_data_128: String,
    #[serde(default)]
    pub user_data_64: String,
    #[serde(default)]
    pub user_data_32: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewTransfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    /// Amount in the ledger's smallest unit, as decimal string (u128).
    pub amount: String,
    pub ledger: u32,
    pub code: u16,
    #[serde(default)]
    pub flags: u16,
    #[serde(default)]
    pub pending_id: String,
    #[serde(default)]
    pub user_data_128: String,
    #[serde(default)]
    pub user_data_64: String,
    #[serde(default)]
    pub user_data_32: u32,
    #[serde(default)]
    pub timeout: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountView {
    pub id: String,
    pub debits_pending: String,
    pub debits_posted: String,
    pub credits_pending: String,
    pub credits_posted: String,
    pub user_data_128: String,
    pub user_data_64: String,
    pub user_data_32: u32,
    pub reserved: u32,
    pub ledger: u32,
    pub code: u16,
    pub flags: u16,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpError {
    pub index: u32,
    pub reason: String,
    /// TigerBeetle result code name (e.g. "exceeds_debits") when known.
    pub code: String,
}

#[derive(Debug, Error)]
pub enum TbClientError {
    #[error("invalid 128-bit id `{0}`")]
    InvalidId(String),
    #[error("invalid amount `{0}`")]
    InvalidAmount(String),
    #[error("tigerbeetle transport error: {0}")]
    Transport(String),
}

fn parse_u128(s: &str) -> Result<u128, TbClientError> {
    let s = s.trim();
    s.parse::<u128>().map_err(|_| TbClientError::InvalidId(s.to_string()))
}

// ─── Client ───────────────────────────────────────────────────────────────────

pub struct TbClient {
    inner: tb::Client,
}

impl TbClient {
    /// Connect to the cluster. Fails loudly — the bridge refuses to start
    /// without a reachable TigerBeetle replica set.
    pub fn connect(cluster_id: u128, addresses: &str) -> Result<Self, TbClientError> {
        let inner = tb::Client::new(cluster_id, addresses)
            .map_err(|e| TbClientError::Transport(e.to_string()))?;
        Ok(Self { inner })
    }

    pub async fn create_accounts(&self, batch: &[NewAccount]) -> Result<Vec<OpError>, TbClientError> {
        let mut accounts = Vec::with_capacity(batch.len());
        for a in batch {
            let id = parse_u128(&a.id)?;
            let mut acc = tb::Account::new(id, a.ledger, a.code).with_flags(a.flags);
            if !a.user_data_128.is_empty() {
                acc = acc.with_user_data_128(parse_u128(&a.user_data_128)?);
            }
            if !a.user_data_64.is_empty() {
                acc = acc.with_user_data_64(
                    a.user_data_64.parse::<u64>().map_err(|_| TbClientError::InvalidId(a.user_data_64.clone()))?,
                );
            }
            acc = acc.with_user_data_32(a.user_data_32);
            accounts.push(acc);
        }
        let errors = self
            .inner
            .create_accounts(&accounts)
            .await
            .map_err(|e| TbClientError::Transport(e.to_string()))?;
        Ok(errors
            .into_iter()
            .map(|e| OpError {
                index: e.index as u32,
                code: format!("{:?}", e.result),
                reason: format!("{:?}", e.result),
            })
            .collect())
    }

    pub async fn create_transfers(&self, batch: &[NewTransfer]) -> Result<Vec<OpError>, TbClientError> {
        let mut transfers = Vec::with_capacity(batch.len());
        for t in batch {
            let id = parse_u128(&t.id)?;
            let amount = t
                .amount
                .trim()
                .parse::<u128>()
                .map_err(|_| TbClientError::InvalidAmount(t.amount.clone()))?;
            let debit = parse_u128(&t.debit_account_id)?;
            let credit = parse_u128(&t.credit_account_id)?;
            let mut tr = tb::Transfer::new(id, debit, credit, amount, t.ledger, t.code)
                .with_flags(t.flags)
                .with_timeout(t.timeout)
                .with_user_data_32(t.user_data_32);
            if !t.pending_id.is_empty() {
                tr = tr.with_pending_id(parse_u128(&t.pending_id)?);
            }
            if !t.user_data_128.is_empty() {
                tr = tr.with_user_data_128(parse_u128(&t.user_data_128)?);
            }
            if !t.user_data_64.is_empty() {
                tr = tr.with_user_data_64(
                    t.user_data_64.parse::<u64>().map_err(|_| TbClientError::InvalidId(t.user_data_64.clone()))?,
                );
            }
            transfers.push(tr);
        }
        let errors = self
            .inner
            .create_transfers(&transfers)
            .await
            .map_err(|e| TbClientError::Transport(e.to_string()))?;
        Ok(errors
            .into_iter()
            .map(|e| OpError {
                index: e.index as u32,
                code: format!("{:?}", e.result),
                reason: format!("{:?}", e.result),
            })
            .collect())
    }

    pub async fn lookup_accounts(&self, ids: &[String]) -> Result<Vec<AccountView>, TbClientError> {
        let parsed: Vec<u128> = ids.iter().map(|s| parse_u128(s)).collect::<Result<_, _>>()?;
        let accounts = self
            .inner
            .lookup_accounts(&parsed)
            .await
            .map_err(|e| TbClientError::Transport(e.to_string()))?;
        Ok(accounts
            .into_iter()
            .map(|a| AccountView {
                id: a.id().to_string(),
                debits_pending: a.debits_pending().to_string(),
                debits_posted: a.debits_posted().to_string(),
                credits_pending: a.credits_pending().to_string(),
                credits_posted: a.credits_posted().to_string(),
                user_data_128: a.user_data_128().to_string(),
                user_data_64: a.user_data_64().to_string(),
                user_data_32: a.user_data_32(),
                reserved: 0,
                ledger: a.ledger(),
                code: a.code(),
                flags: a.flags(),
                timestamp: a.timestamp().to_string(),
            })
            .collect())
    }
}
