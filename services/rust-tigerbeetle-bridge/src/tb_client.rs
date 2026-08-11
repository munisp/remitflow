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
 *
 * Crate API notes (tigerbeetle-unofficial 0.14.13+0.16.63):
 *   - `Client::new(cluster_id: u128, address: impl AsRef<[u8]>)`
 *   - `create_accounts` / `create_transfers` return `Result<(), …Error>` —
 *     per-index failures arrive as `…Error::Api(…ApiError)`, transport
 *     failures as `…Error::Send(SendError)`.
 *   - `Account::new(id, ledger, code)` and `Transfer::new(id)` PANIC on
 *     zero/`u128::MAX` ids and (for accounts) zero ledger/code — every value
 *     is validated here first so bad input becomes a 400, never a panic.
 *   - `Account::timestamp()` returns `SystemTime`; the raw wire value
 *     (nanoseconds since epoch, u64) is exposed via `as_raw().timestamp`,
 *     which is what the TypeScript caller consumes (`BigInt(a.timestamp)`).
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
    /// Nanoseconds since Unix epoch as decimal string (the raw wire value —
    /// the TypeScript caller parses it with `BigInt(...)`).
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpError {
    pub index: u32,
    /// TigerBeetle result code name (e.g. "ExceedsDebits") when known.
    pub reason: String,
    /// Numeric TigerBeetle result code — the TypeScript caller consumes it
    /// with `Number(err.code)`.
    pub code: u32,
}

#[derive(Debug, Error)]
pub enum TbClientError {
    #[error("invalid 128-bit id `{0}`")]
    InvalidId(String),
    #[error("invalid amount `{0}`")]
    InvalidAmount(String),
    #[error("invalid field: {0}")]
    InvalidField(String),
    #[error("tigerbeetle transport error: {0}")]
    Transport(String),
}

fn parse_u128(s: &str) -> Result<u128, TbClientError> {
    let s = s.trim();
    s.parse::<u128>().map_err(|_| TbClientError::InvalidId(s.to_string()))
}

/// TigerBeetle rejects (and the client library panics on) zero and
/// `u128::MAX` object ids — validate up front so the caller gets a 400.
fn parse_object_id(s: &str) -> Result<u128, TbClientError> {
    let id = parse_u128(s)?;
    if id == 0 || id == u128::MAX {
        return Err(TbClientError::InvalidId(format!(
            "{s} (id must be in 1..=2^128-2)"
        )));
    }
    Ok(id)
}

fn parse_account_ledger_code(ledger: u32, code: u16) -> Result<(), TbClientError> {
    if ledger == 0 {
        return Err(TbClientError::InvalidField("ledger must not be zero".into()));
    }
    if code == 0 {
        return Err(TbClientError::InvalidField("code must not be zero".into()));
    }
    Ok(())
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

    /// Returns per-index errors for the accounts TigerBeetle rejected; an
    /// empty vector means the entire batch was accepted.
    pub async fn create_accounts(&self, batch: &[NewAccount]) -> Result<Vec<OpError>, TbClientError> {
        let mut accounts = Vec::with_capacity(batch.len());
        for a in batch {
            let id = parse_object_id(&a.id)?;
            parse_account_ledger_code(a.ledger, a.code)?;
            let mut acc = tb::Account::new(id, a.ledger, a.code)
                .with_flags(tb::account::Flags::from_bits_retain(a.flags));
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
        match self.inner.create_accounts(accounts).await {
            Ok(()) => Ok(Vec::new()),
            Err(tb::error::CreateAccountsError::Api(api)) => Ok(api
                .as_slice()
                .iter()
                .map(|e| OpError {
                    index: e.index(),
                    reason: format!("{:?}", e.kind()),
                    code: e.inner().code().get(),
                })
                .collect()),
            Err(e) => Err(TbClientError::Transport(e.to_string())),
        }
    }

    /// Returns per-index errors for the transfers TigerBeetle rejected; an
    /// empty vector means the entire batch was accepted.
    pub async fn create_transfers(&self, batch: &[NewTransfer]) -> Result<Vec<OpError>, TbClientError> {
        let mut transfers = Vec::with_capacity(batch.len());
        for t in batch {
            let id = parse_object_id(&t.id)?;
            let amount = t
                .amount
                .trim()
                .parse::<u128>()
                .map_err(|_| TbClientError::InvalidAmount(t.amount.clone()))?;
            let debit = parse_object_id(&t.debit_account_id)?;
            let credit = parse_object_id(&t.credit_account_id)?;
            let mut tr = tb::Transfer::new(id)
                .with_debit_account_id(debit)
                .with_credit_account_id(credit)
                .with_amount(amount)
                .with_ledger(t.ledger)
                .with_code(t.code)
                .with_flags(tb::transfer::Flags::from_bits_retain(t.flags))
                .with_timeout(t.timeout)
                .with_user_data_32(t.user_data_32);
            if !t.pending_id.is_empty() && t.pending_id.trim() != "0" {
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
        match self.inner.create_transfers(transfers).await {
            Ok(()) => Ok(Vec::new()),
            Err(tb::error::CreateTransfersError::Api(api)) => Ok(api
                .as_slice()
                .iter()
                .map(|e| OpError {
                    index: e.index(),
                    reason: format!("{:?}", e.kind()),
                    code: e.inner().code().get(),
                })
                .collect()),
            Err(e) => Err(TbClientError::Transport(e.to_string())),
        }
    }

    pub async fn lookup_accounts(&self, ids: &[String]) -> Result<Vec<AccountView>, TbClientError> {
        let parsed: Vec<u128> = ids.iter().map(|s| parse_u128(s)).collect::<Result<_, _>>()?;
        let accounts = self
            .inner
            .lookup_accounts(parsed)
            .await
            .map_err(|e| TbClientError::Transport(e.to_string()))?;
        Ok(accounts
            .into_iter()
            .map(|a| {
                let raw = a.as_raw();
                AccountView {
                    id: a.id().to_string(),
                    debits_pending: a.debits_pending().to_string(),
                    debits_posted: a.debits_posted().to_string(),
                    credits_pending: a.credits_pending().to_string(),
                    credits_posted: a.credits_posted().to_string(),
                    user_data_128: a.user_data_128().to_string(),
                    user_data_64: a.user_data_64().to_string(),
                    user_data_32: a.user_data_32(),
                    reserved: raw.reserved,
                    ledger: a.ledger(),
                    code: a.code(),
                    flags: a.flags().bits(),
                    timestamp: raw.timestamp.to_string(),
                }
            })
            .collect())
    }
}
