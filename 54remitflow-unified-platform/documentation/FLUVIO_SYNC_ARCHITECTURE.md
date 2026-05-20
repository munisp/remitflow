## Fluvio Bi-directional Synchronization Architecture

**Complete Guide to Data Synchronization & Conflict Resolution**

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Synchronization Flow](#synchronization-flow)
3. [Conflict Detection](#conflict-detection)
4. [Conflict Resolution Strategies](#conflict-resolution-strategies)
5. [Vector Clocks](#vector-clocks)
6. [Implementation Details](#implementation-details)
7. [Examples](#examples)
8. [Monitoring](#monitoring)

---

## Architecture Overview

### **System Components**

```
┌─────────────────────────────────────────────────────────────────┐
│                     Fluvio Event Streaming                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Transactions │  │   Commands   │  │ Config/Rules │          │
│  │   (Topic)    │  │   (Topic)    │  │   (Topics)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
         ▲                    │                    │
         │ Publish            │ Subscribe          │ Subscribe
         │                    ▼                    ▼
┌────────┴────────┐    ┌──────────────┐    ┌──────────────┐
│   POS Terminal  │    │  Go Consumer │    │   Central    │
│    (Python)     │    │ (Processor)  │    │   Server     │
│                 │    │              │    │              │
│ • Sync Manager  │    │ • Analytics  │    │ • Master DB  │
│ • Vector Clock  │    │ • Fraud Det  │    │ • Config Mgr │
│ • Conflict Res  │    │ • Metrics    │    │ • Rule Engine│
└─────────────────┘    └──────────────┘    └──────────────┘
```

### **Data Flow Patterns**

1. **Outbound (POS → Fluvio → Central)**
   - Transaction events
   - Payment events
   - Device status
   - Fraud alerts

2. **Inbound (Central → Fluvio → POS)**
   - Terminal configuration
   - Fraud rules
   - Price updates
   - System commands

3. **Bi-directional (Both Ways)**
   - Inventory updates
   - Customer data
   - Merchant settings

---

## Synchronization Flow

### **1. Outbound Synchronization (Local → Remote)**

```python
# Step 1: Prepare sync event
sync_event = await sync_manager.prepare_sync_event(
    entity_id="txn_123",
    entity_type="transaction",
    data={
        "amount": 100.50,
        "currency": "USD",
        "status": "approved"
    },
    operation="create"
)

# Step 2: Add metadata
# - Version number (incremented)
# - Timestamp (UTC)
# - Checksum (SHA-256)
# - Vector clock (for causality)

# Step 3: Publish to Fluvio
await fluvio_client.publish_transaction(sync_event)

# Step 4: Update local state
sync_manager.local_state[entity_id] = sync_event
```

**Metadata Added:**
```json
{
  "sync_id": "uuid-1234",
  "metadata": {
    "entity_id": "txn_123",
    "entity_type": "transaction",
    "version": 1,
    "timestamp": "2025-10-27T10:30:00Z",
    "source": "pos_001",
    "checksum": "sha256-hash",
    "operation": "create"
  },
  "data": { ... },
  "vector_clock": {"pos_001": 42, "central": 15}
}
```

### **2. Inbound Synchronization (Remote → Local)**

```python
# Step 1: Receive event from Fluvio
incoming_event = await fluvio_client.consume_event()

# Step 2: Process incoming event
success, conflict = await sync_manager.process_incoming_event(incoming_event)

# Step 3: Handle result
if success:
    # No conflict, accepted
    logger.info("✓ Sync accepted")
elif conflict:
    # Conflict detected, attempt resolution
    resolved = await sync_manager._resolve_conflict(conflict)
    if not resolved:
        # Manual resolution required
        logger.warning("⚠️  Manual resolution needed")
```

**Processing Steps:**
1. Check if local version exists
2. Detect conflicts (if any)
3. Apply resolution strategy
4. Update local state
5. Log sync event

---

## Conflict Detection

### **Conflict Types**

#### **1. UPDATE-UPDATE Conflict**

**Scenario:** Both local and remote updated the same record concurrently

```
Time:    t0          t1          t2
Local:   Read v1  →  Update v2
Remote:  Read v1  →  Update v2'
                        ↓
                    CONFLICT!
```

**Detection:**
- Same entity_id
- Both operations are "update"
- Timestamps within 1 second
- Different checksums

#### **2. UPDATE-DELETE Conflict**

**Scenario:** One side updated, other side deleted

```
Local:   Update record
Remote:  Delete record
           ↓
       CONFLICT!
```

**Detection:**
- Same entity_id
- One operation is "update", other is "delete"

#### **3. CREATE-CREATE Conflict**

**Scenario:** Both sides created record with same ID

```
Local:   Create ID=123
Remote:  Create ID=123
           ↓
       CONFLICT!
```

**Detection:**
- Same entity_id
- Both operations are "create"
- Different checksums

#### **4. VERSION MISMATCH**

**Scenario:** Version numbers don't match expected sequence

```
Local:   v3
Remote:  v5  (skipped v4)
           ↓
       CONFLICT!
```

**Detection:**
- Version gap > 1
- Missing intermediate versions

---

## Conflict Resolution Strategies

### **1. Last Write Wins (LWW)**

**Use Case:** Configuration updates, prices, non-critical data

**Logic:**
```python
if remote.timestamp > local.timestamp:
    winner = remote
else:
    winner = local
```

**Example:**
```
Terminal Config Update:
Local:  {"max_amount": 5000} @ 10:30:00
Remote: {"max_amount": 10000} @ 10:30:05
Result: Remote wins → max_amount = 10000
```

**Pros:**
- ✅ Simple and fast
- ✅ Always resolves automatically
- ✅ No data loss if timestamps accurate

**Cons:**
- ⚠️ Can lose concurrent updates
- ⚠️ Depends on clock synchronization

---

### **2. First Write Wins (FWW)**

**Use Case:** Transactions, immutable records

**Logic:**
```python
if remote.timestamp < local.timestamp:
    winner = remote
else:
    winner = local
```

**Example:**
```
Transaction Creation:
Local:  txn_123 @ 10:30:00.100
Remote: txn_123 @ 10:30:00.150
Result: Local wins (first)
```

**Pros:**
- ✅ Preserves original transaction
- ✅ Prevents duplicate processing
- ✅ Audit trail integrity

**Cons:**
- ⚠️ Later updates rejected

---

### **3. Highest Version Wins (HVW)**

**Use Case:** Fraud rules, policies with version tracking

**Logic:**
```python
if remote.version > local.version:
    winner = remote
else:
    winner = local
```

**Example:**
```
Fraud Rule Update:
Local:  v3 (amount > 5000)
Remote: v5 (amount > 10000)
Result: Remote wins (v5)
```

**Pros:**
- ✅ Clear versioning
- ✅ Tracks update history
- ✅ Easy to audit

**Cons:**
- ⚠️ Requires version tracking
- ⚠️ Can skip intermediate versions

---

### **4. Merge Strategy**

**Use Case:** Inventory, customer data, non-conflicting fields

**Logic:**
```python
merged = local.data.copy()
for key, value in remote.data.items():
    if key not in merged or remote.timestamp > local.timestamp:
        merged[key] = value
```

**Example:**
```
Customer Update:
Local:  {"name": "John", "email": "john@old.com"}
Remote: {"email": "john@new.com", "phone": "555-1234"}
Result: {"name": "John", "email": "john@new.com", "phone": "555-1234"}
```

**Pros:**
- ✅ Preserves all changes
- ✅ No data loss
- ✅ Flexible

**Cons:**
- ⚠️ Complex logic
- ⚠️ May create inconsistent state

---

### **5. Source Priority**

**Use Case:** Hierarchical systems (central > pos > terminal)

**Logic:**
```python
priority = {"central": 3, "pos": 2, "terminal": 1}
if priority[remote.source] > priority[local.source]:
    winner = remote
else:
    winner = local
```

**Example:**
```
Price Update:
Local:  $100 (source: terminal)
Remote: $95  (source: central)
Result: Remote wins (central authority)
```

**Pros:**
- ✅ Clear authority hierarchy
- ✅ Consistent with business rules
- ✅ Predictable

**Cons:**
- ⚠️ May ignore valid local changes
- ⚠️ Requires source tracking

---

### **6. Business Rule Strategy**

**Use Case:** Domain-specific logic

**Example: Inventory Conflict**
```python
async def _resolve_inventory_conflict(conflict):
    local_qty = conflict.local_version.data['quantity']
    remote_adj = conflict.remote_version.data['adjustment']
    
    # Merge quantities (sum adjustments)
    merged_qty = local_qty + remote_adj
    
    return {"quantity": merged_qty}
```

**Example Scenario:**
```
Inventory Sync:
Local:  quantity=100, adjustment=-5  (sold 5)
Remote: quantity=100, adjustment=-3  (sold 3)
Result: quantity=92  (100 - 5 - 3)
```

**Pros:**
- ✅ Domain-specific logic
- ✅ Accurate for business needs
- ✅ Flexible

**Cons:**
- ⚠️ Requires custom implementation
- ⚠️ Complex to maintain

---

## Vector Clocks

### **What Are Vector Clocks?**

Vector clocks track causality in distributed systems to detect concurrent updates.

**Structure:**
```python
{
  "pos_001": 42,    # POS terminal 1 has seen 42 events
  "pos_002": 15,    # POS terminal 2 has seen 15 events
  "central": 100    # Central server has seen 100 events
}
```

### **How They Work**

#### **1. Increment on Local Update**
```python
# Before update
vector_clock = {"pos_001": 42, "central": 100}

# After local update
vector_clock.increment()
# Result: {"pos_001": 43, "central": 100}
```

#### **2. Merge on Remote Update**
```python
# Local clock
local = {"pos_001": 43, "central": 100}

# Remote clock
remote = {"pos_001": 40, "central": 105, "pos_002": 20}

# Merge (take max of each)
local.update(remote)
# Result: {"pos_001": 44, "central": 105, "pos_002": 20}
```

#### **3. Compare Clocks**
```python
def compare(clock_a, clock_b):
    # Returns: "before", "after", "concurrent", "equal"
    
    a_greater = False
    b_greater = False
    
    for node in all_nodes:
        if clock_a[node] > clock_b[node]:
            a_greater = True
        elif clock_b[node] > clock_a[node]:
            b_greater = True
    
    if a_greater and not b_greater:
        return "after"   # A happened after B
    elif b_greater and not a_greater:
        return "before"  # A happened before B
    elif not a_greater and not b_greater:
        return "equal"   # Same state
    else:
        return "concurrent"  # CONFLICT!
```

### **Example: Detecting Concurrent Updates**

```
Scenario: Two POS terminals update same product price

Terminal 1 (pos_001):
  Clock before: {"pos_001": 10, "pos_002": 5, "central": 20}
  Update price to $100
  Clock after:  {"pos_001": 11, "pos_002": 5, "central": 20}

Terminal 2 (pos_002):
  Clock before: {"pos_001": 10, "pos_002": 5, "central": 20}
  Update price to $95
  Clock after:  {"pos_001": 10, "pos_002": 6, "central": 20}

Comparison:
  pos_001: 11 > 10  (Terminal 1 is ahead)
  pos_002: 5 < 6    (Terminal 2 is ahead)
  Result: CONCURRENT → CONFLICT!
```

---

## Implementation Details

### **Configuration by Entity Type**

```python
strategy_by_entity = {
    "transaction": ConflictResolutionStrategy.FIRST_WRITE_WINS,
    "terminal_config": ConflictResolutionStrategy.LAST_WRITE_WINS,
    "fraud_rule": ConflictResolutionStrategy.HIGHEST_VERSION_WINS,
    "price": ConflictResolutionStrategy.LAST_WRITE_WINS,
    "inventory": ConflictResolutionStrategy.MERGE,
    "customer": ConflictResolutionStrategy.MERGE,
    "merchant": ConflictResolutionStrategy.SOURCE_PRIORITY,
}
```

### **Sync Event Structure**

```python
@dataclass
class SyncEvent:
    sync_id: str                    # Unique sync ID
    metadata: SyncMetadata          # Version, timestamp, checksum
    data: Dict[str, Any]            # Actual data
    previous_version: Optional[Dict] # For rollback
```

### **Metadata Fields**

```python
@dataclass
class SyncMetadata:
    entity_id: str              # Unique entity ID
    entity_type: str            # "transaction", "price", etc.
    version: int                # Monotonically increasing
    timestamp: datetime         # UTC timestamp
    source: str                 # "pos_001", "central", etc.
    checksum: str               # SHA-256 of data
    operation: str              # "create", "update", "delete"
    conflict_resolved: bool     # Was conflict resolved?
    resolution_strategy: str    # Strategy used
```

---

## Examples

### **Example 1: Transaction Sync (No Conflict)**

```python
# Terminal creates transaction
sync_event = await sync_manager.prepare_sync_event(
    entity_id="txn_123",
    entity_type="transaction",
    data={
        "amount": 100.50,
        "currency": "USD",
        "status": "approved",
        "merchant_id": "merchant_001"
    },
    operation="create"
)

# Publish to Fluvio
await fluvio_client.publish_transaction(sync_event)

# Central receives and processes
# No conflict (new transaction)
# Stores in database
```

### **Example 2: Price Update (Last Write Wins)**

```python
# Scenario: Two terminals update same product price

# Terminal 1 updates at 10:30:00
local_event = SyncEvent(
    metadata=SyncMetadata(
        entity_id="product_456",
        version=2,
        timestamp=datetime(2025, 10, 27, 10, 30, 0),
        source="pos_001"
    ),
    data={"price": 100.00}
)

# Terminal 2 updates at 10:30:05 (5 seconds later)
remote_event = SyncEvent(
    metadata=SyncMetadata(
        entity_id="product_456",
        version=2,
        timestamp=datetime(2025, 10, 27, 10, 30, 5),
        source="pos_002"
    ),
    data={"price": 95.00}
)

# Conflict detected: UPDATE-UPDATE
# Strategy: LAST_WRITE_WINS
# Result: Remote wins (10:30:05 > 10:30:00)
# Final price: $95.00
```

### **Example 3: Inventory Merge**

```python
# Scenario: Two terminals sell from same inventory

# Terminal 1: Sold 5 units
local_event = SyncEvent(
    data={
        "product_id": "prod_789",
        "quantity": 100,
        "adjustment": -5
    }
)

# Terminal 2: Sold 3 units
remote_event = SyncEvent(
    data={
        "product_id": "prod_789",
        "quantity": 100,
        "adjustment": -3
    }
)

# Conflict detected: UPDATE-UPDATE
# Strategy: MERGE (inventory-specific)
# Logic: quantity = 100 - 5 - 3 = 92
# Result: Final quantity = 92
```

---

## Monitoring

### **Sync Statistics**

```python
stats = sync_manager.get_sync_stats()

# Returns:
{
    "total_syncs": 1500,
    "outbound_syncs": 800,
    "inbound_syncs": 700,
    "total_conflicts": 25,
    "resolved_conflicts": 23,
    "unresolved_conflicts": 2,
    "resolution_rate": 92.0,  # 92%
    "entities_synced": 450
}
```

### **Unresolved Conflicts**

```python
unresolved = sync_manager.get_unresolved_conflicts()

for conflict in unresolved:
    print(f"""
    Conflict ID: {conflict.conflict_id}
    Type: {conflict.conflict_type}
    Entity: {conflict.entity_type}/{conflict.entity_id}
    Local version: v{conflict.local_version.metadata.version}
    Remote version: v{conflict.remote_version.metadata.version}
    Detected: {conflict.detected_at}
    """)
```

### **Sync Log**

```python
# View recent sync events
for log_entry in sync_manager.sync_log[-10:]:
    print(f"""
    {log_entry['timestamp']} | {log_entry['direction']} |
    {log_entry['entity_type']}/{log_entry['entity_id']} |
    v{log_entry['version']} | {log_entry['operation']}
    """)
```

---

## Best Practices

### **1. Choose Appropriate Strategy**

- **Transactions:** First Write Wins (immutable)
- **Configuration:** Last Write Wins (latest is correct)
- **Inventory:** Merge (sum adjustments)
- **Prices:** Last Write Wins or Source Priority
- **Customer Data:** Merge (preserve all fields)

### **2. Monitor Conflict Rate**

- **< 1%:** Excellent
- **1-5%:** Good
- **5-10%:** Review sync timing
- **> 10%:** Investigate root cause

### **3. Handle Unresolved Conflicts**

- Alert administrators
- Provide UI for manual resolution
- Log for audit trail
- Implement business-specific rules

### **4. Optimize Sync Frequency**

- **Real-time:** Transactions, payments
- **Near real-time (1-5 min):** Inventory, prices
- **Periodic (15-60 min):** Configuration, rules
- **Batch (daily):** Analytics, reports

### **5. Ensure Clock Synchronization**

- Use NTP (Network Time Protocol)
- Monitor clock drift
- Use vector clocks for causality
- Don't rely solely on timestamps

---

## Summary

**Bi-directional Fluvio Synchronization:**

✅ **Conflict Detection**
- UPDATE-UPDATE, UPDATE-DELETE, CREATE-CREATE
- Version mismatch detection
- Vector clock for causality

✅ **Resolution Strategies**
- Last Write Wins
- First Write Wins
- Highest Version Wins
- Merge
- Source Priority
- Business Rules

✅ **Features**
- Automatic conflict resolution (92%+ rate)
- Manual resolution for complex cases
- Audit trail for all syncs
- Monitoring and statistics
- Entity-specific strategies

✅ **Production Ready**
- Handles concurrent updates
- Preserves data integrity
- Scalable architecture
- Comprehensive logging

**Result:** Robust, scalable, and reliable bi-directional synchronization for distributed POS systems!

