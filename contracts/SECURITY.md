# RemitFlow Smart Contract Security Framework

## Contract Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  RemitFlow Smart Contract Layer                  │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ RemitFlowVault   │  │ RemitFlowEscrow  │  │ RemitFlowBridge│  │
│  │                  │  │                  │  │               │  │
│  │ • LP deposits    │  │ • Settlement     │  │ • Cross-chain │  │
│  │ • Withdrawals    │  │   escrow         │  │   lock/unlock │  │
│  │ • Reserve proof  │  │ • Dispute        │  │ • Validator   │  │
│  │ • Multi-sig      │  │   resolution     │  │   quorum      │  │
│  │ • Daily limits   │  │ • Auto-refund    │  │ • Rate limits │  │
│  │ • Circuit breaker│  │   on expiry      │  │ • Per-chain   │  │
│  └─────────────────┘  └──────────────────┘  │   pause       │  │
│                                              └───────────────┘  │
│                                                                  │
│  Dependencies: OpenZeppelin v5.x                                │
│  • SafeERC20 (handles non-standard ERC20 returns)               │
│  • ReentrancyGuard (prevents reentrancy attacks)                │
│  • Pausable (circuit breaker pattern)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Security Measures by Category

### 1. Reentrancy Protection
| Contract | Method | Protection |
|----------|--------|------------|
| RemitFlowVault | `deposit()` | `nonReentrant` modifier + CEI pattern |
| RemitFlowVault | `withdraw()` | `nonReentrant` modifier + CEI pattern |
| RemitFlowVault | `approveMultiSig()` | `nonReentrant` modifier |
| RemitFlowVault | `emergencyWithdraw()` | `nonReentrant` modifier |
| RemitFlowEscrow | `createEscrow()` | `nonReentrant` modifier |
| RemitFlowEscrow | `release()` | `nonReentrant` modifier |
| RemitFlowEscrow | `refund()` | `nonReentrant` modifier |
| RemitFlowBridge | `lock()` | `nonReentrant` modifier |
| RemitFlowBridge | `confirmUnlock()` | `nonReentrant` modifier |

**CEI Pattern (Checks-Effects-Interactions):** All functions validate inputs,
update state, and THEN make external calls. This prevents reentrancy even
without the modifier as defense-in-depth.

### 2. Access Control
| Role | Capabilities | How Assigned |
|------|-------------|--------------|
| `admin` | Add/remove tokens, operators, guardians; unpause; emergency withdraw | Immutable (set at construction) |
| `operator` | Deposit/withdraw within limits | Admin adds via `addOperator()` |
| `guardian` | Pause (circuit breaker) | Admin adds via `addGuardian()` |
| `signer` | Create/approve multi-sig withdrawals | Set at construction (3 addresses) |
| `validator` | Confirm cross-chain unlocks | Admin adds via `addValidator()` |
| `arbiter` | Resolve escrow disputes | Set per-escrow at creation |

### 3. Fund Safety Mechanisms

#### Daily Withdrawal Limits
- Each token has a configurable daily withdrawal cap
- Counter resets every 24 hours (on first tx after reset period)
- Prevents a compromised operator from draining vault in one shot

#### Single Transaction Limits
- Max amount per single withdrawal (e.g., $500K for USDC)
- Anything above the limit reverts

#### Multi-Sig for Large Withdrawals
- Withdrawals ≥ `multiSigThreshold` require 2-of-3 signer approval
- Signers set at deployment (immutable)
- Each signer can only approve once per request

#### Circuit Breaker (Pausable)
- Any guardian can pause all operations instantly
- Only admin can unpause (prevents guardian from pausing/unpausing to grief)
- Use case: stablecoin de-peg, detected exploit, regulatory order

### 4. Token Safety (SafeERC20)
All ERC20 interactions use OpenZeppelin's `SafeERC20`:
- Handles tokens that don't return `bool` on transfer (USDT)
- Handles tokens that revert on failure instead of returning false
- Uses `safeTransfer`, `safeTransferFrom` — never raw `transfer`/`transferFrom`
- No `approve` — uses `safeIncreaseAllowance` pattern where needed

### 5. Anti-Replay / Idempotency
- Every deposit/withdrawal keyed on `idempotencyKey`
- Once used, the key is permanently burned (`usedIdempotencyKeys[key] = true`)
- Cross-chain bridge uses `processedNonces` mapping to prevent replay
- Sequential nonce on bridge prevents reordering attacks

### 6. Cross-Chain Bridge Security
- **Validator quorum:** 3-of-5 validators must confirm before unlock
- **Per-chain rate limits:** Each destination chain has its own daily volume cap
- **Per-chain pause:** Can disable a single compromised chain without halting others
- **Min/max amount:** Prevents dust attacks (min) and flash loan attacks (max)
- **No arbitrary calls:** Bridge only moves pre-approved ERC20 tokens

## Vulnerability Checklist

### Critical (Must pass before mainnet)
- [ ] **Reentrancy:** Fuzz all external functions with reentrancy callback
- [ ] **Integer overflow:** Solidity 0.8+ has built-in overflow checks ✓
- [ ] **Front-running:** Idempotency keys prevent replay; quotes have TTL
- [ ] **Flash loan attacks:** Bridge min/max amounts; vault daily limits
- [ ] **Signature malleability:** Not using ECDSA directly (multi-sig is on-chain)
- [ ] **Storage collision:** No delegatecall, no proxies (non-upgradeable)
- [ ] **Oracle manipulation:** No external oracle dependency in contracts
- [ ] **Griefing:** Pause is guardian-only; unpause is admin-only
- [ ] **Token approval race:** Using SafeERC20 pattern
- [ ] **Centralization risk:** Admin is immutable, multi-sig for large amounts

### High (Should pass before mainnet)
- [ ] **Gas optimization:** Optimizer at 200 runs; view functions are free
- [ ] **Event completeness:** Every state change emits an event
- [ ] **Error messages:** Custom errors (gas-efficient) for all reverts
- [ ] **Mapping cleanup:** No unbounded iterations (supportedTokens is admin-controlled)
- [ ] **Timestamp dependence:** Only used for daily limit resets (±15s acceptable)

### Medium
- [ ] **Unchecked return values:** SafeERC20 handles this ✓
- [ ] **Denial of service:** No external calls in loops
- [ ] **Unexpected ether:** No `receive()` or `fallback()` — vault never holds ETH

## Audit Recommendations

### Pre-Audit Steps
1. Run Slither static analysis: `slither contracts/src/`
2. Run Mythril symbolic execution: `myth analyze contracts/src/RemitFlowVault.sol`
3. Run Foundry fuzz tests: `forge test --fuzz-runs 10000`
4. Run Echidna property-based tests
5. Gas report: `forge test --gas-report`

### Recommended Audit Firms (for fintech/DeFi)
| Firm | Specialty | Cost Range | Timeline |
|------|-----------|-----------|----------|
| Trail of Bits | Security-critical contracts | $100K-$300K | 4-8 weeks |
| OpenZeppelin | ERC20/vault patterns | $80K-$200K | 4-6 weeks |
| Certora | Formal verification | $50K-$150K | 3-6 weeks |
| Consensys Diligence | DeFi protocols | $80K-$200K | 4-8 weeks |
| Halborn | Bridge security | $60K-$150K | 3-6 weeks |

### Formal Verification Properties
```
// P1: Total reserves ≥ total user liabilities (solvency invariant)
assert getReserveStatus().totalReserves >= totalUserLiabilities();

// P2: No withdrawal can exceed daily limit
assert tokenConfigs[token].withdrawnToday <= tokenConfigs[token].dailyWithdrawalLimit;

// P3: Multi-sig requires exactly MULTI_SIG_THRESHOLD approvals
assert multiSigRequests[id].approvals >= MULTI_SIG_THRESHOLD => multiSigRequests[id].executed;

// P4: Idempotency keys are single-use
assert usedIdempotencyKeys[key] == true => deposit(key) reverts;

// P5: Paused contracts reject all fund movements
assert paused() => deposit() reverts && withdraw() reverts;

// P6: Cross-chain bridge requires quorum
assert unlockRequests[id].confirmations < QUORUM => !unlockRequests[id].executed;
```

## Integration with RemitFlow Platform

```
TypeScript (tRPC) ──→ Go Settlement Engine ──→ Smart Contracts (on-chain)
       │                      │                        │
       │                      │                   ┌────┴────┐
       │                      │                   │ Vault   │ Lock/unlock
       │                      │                   │ Escrow  │ stablecoins
       │                      │                   │ Bridge  │
       │                      │                   └────┬────┘
       │                      │                        │
       │                      │← Settlement events ────┘
       │                      │
       │ ← tRPC response ─────┘
       │
    User gets confirmation
```

Off-chain services monitor on-chain events:
- `Deposited` → Go settlement engine marks LP deposit as confirmed
- `Withdrawn` → TypeScript router credits user's fiat wallet
- `TokenLocked` → Rust pool manager tracks locked liquidity
- `TokenUnlocked` → Python analytics logs cross-chain volume
- `EscrowCreated` → Notification service alerts recipient
- `ReserveAttested` → Admin dashboard updates reserve proof

## Deployment Checklist

### Testnet (Polygon Mumbai / Base Sepolia)
1. [ ] Deploy with test USDC (Aave faucet)
2. [ ] Run full settlement flow: deposit → withdraw → multi-sig → emergency
3. [ ] Test bridge: lock on chain A → confirm → unlock on chain B
4. [ ] Test escrow: create → fund → release; create → fund → expire → refund
5. [ ] Test pause/unpause cycle
6. [ ] Test daily limit reset
7. [ ] Verify events in block explorer

### Mainnet
1. [ ] External audit completed (Trail of Bits / OpenZeppelin)
2. [ ] Bug bounty program launched (Immunefi, $50K-$500K)
3. [ ] Timelock controller deployed (48h delay on admin actions)
4. [ ] Multi-sig wallet deployed (Gnosis Safe, 3-of-5)
5. [ ] Admin keys in hardware wallet (Ledger/Trezor)
6. [ ] Monitoring: Forta agents for anomaly detection
7. [ ] Insurance: Nexus Mutual or Unslashed for custody coverage
