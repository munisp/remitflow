// TigerBeetle Zig Implementation for Remittance Platform
// High-performance double-entry bookkeeping accounting engine
// Optimized for Nigerian banking operations

const std = @import("std");
const print = std.debug.print;
const ArrayList = std.ArrayList;
const HashMap = std.HashMap;
const Allocator = std.mem.Allocator;

// =====================================================
// CORE DATA STRUCTURES
// =====================================================

/// Account flags for different account types
const AccountFlags = packed struct {
    debits_must_not_exceed_credits: bool = false,
    credits_must_not_exceed_debits: bool = false,
    history: bool = true,
    imported: bool = false,
    _reserved: u4 = 0,
};

/// Transfer flags for transaction control
const TransferFlags = packed struct {
    linked: bool = false,
    pending: bool = false,
    post_pending_transfer: bool = false,
    void_pending_transfer: bool = false,
    balancing_debit: bool = false,
    balancing_credit: bool = false,
    _reserved: u2 = 0,
};

/// Account structure for double-entry bookkeeping
const Account = packed struct {
    id: u128,
    user_data: u128,
    ledger: u32,
    code: u16,
    flags: AccountFlags,
    debits_pending: u64,
    debits_posted: u64,
    credits_pending: u64,
    credits_posted: u64,
    timestamp: u64,
    
    pub fn init(id: u128, ledger: u32, code: u16) Account {
        return Account{
            .id = id,
            .user_data = 0,
            .ledger = ledger,
            .code = code,
            .flags = AccountFlags{},
            .debits_pending = 0,
            .debits_posted = 0,
            .credits_pending = 0,
            .credits_posted = 0,
            .timestamp = std.time.timestamp(),
        };
    }
    
    pub fn getBalance(self: *const Account) i64 {
        const debits = @intCast(i64, self.debits_posted);
        const credits = @intCast(i64, self.credits_posted);
        return debits - credits;
    }
};

/// Transfer structure for transactions
const Transfer = packed struct {
    id: u128,
    debit_account_id: u128,
    credit_account_id: u128,
    user_data: u128,
    pending_id: u128,
    timeout: u64,
    ledger: u32,
    code: u16,
    flags: TransferFlags,
    amount: u64,
    timestamp: u64,
    
    pub fn init(
        id: u128,
        debit_account_id: u128,
        credit_account_id: u128,
        amount: u64,
        ledger: u32,
        code: u16
    ) Transfer {
        return Transfer{
            .id = id,
            .debit_account_id = debit_account_id,
            .credit_account_id = credit_account_id,
            .user_data = 0,
            .pending_id = 0,
            .timeout = 0,
            .ledger = ledger,
            .code = code,
            .flags = TransferFlags{},
            .amount = amount,
            .timestamp = std.time.timestamp(),
        };
    }
};

/// Nigerian banking specific ledger codes
const NigerianLedgers = struct {
    const CUSTOMER_DEPOSITS: u32 = 1000;
    const AGENT_ACCOUNTS: u32 = 2000;
    const BANK_RESERVES: u32 = 3000;
    const FEE_INCOME: u32 = 4000;
    const OPERATIONAL_EXPENSES: u32 = 5000;
    const REGULATORY_RESERVES: u32 = 6000;
};

/// Nigerian banking specific account codes
const NigerianAccountCodes = struct {
    const SAVINGS_ACCOUNT: u16 = 100;
    const CURRENT_ACCOUNT: u16 = 200;
    const AGENT_FLOAT: u16 = 300;
    const TRANSACTION_FEE: u16 = 400;
    const CBN_RESERVE: u16 = 500;
    const INTERCHANGE_FEE: u16 = 600;
};

// =====================================================
// TIGERBEETLE ENGINE
// =====================================================

const TigerBeetleEngine = struct {
    allocator: Allocator,
    accounts: HashMap(u128, Account, std.hash_map.DefaultContext(u128), std.hash_map.default_max_load_percentage),
    transfers: ArrayList(Transfer),
    cluster_id: u32,
    replica_id: u8,
    
    const Self = @This();
    
    pub fn init(allocator: Allocator, cluster_id: u32, replica_id: u8) !Self {
        return Self{
            .allocator = allocator,
            .accounts = HashMap(u128, Account, std.hash_map.DefaultContext(u128), std.hash_map.default_max_load_percentage).init(allocator),
            .transfers = ArrayList(Transfer).init(allocator),
            .cluster_id = cluster_id,
            .replica_id = replica_id,
        };
    }
    
    pub fn deinit(self: *Self) void {
        self.accounts.deinit();
        self.transfers.deinit();
    }
    
    /// Create a new account
    pub fn createAccount(self: *Self, account: Account) !void {
        if (self.accounts.contains(account.id)) {
            return error.AccountExists;
        }
        
        try self.accounts.put(account.id, account);
        print("Created account: ID={}, Ledger={}, Code={}\n", .{ account.id, account.ledger, account.code });
    }
    
    /// Create multiple accounts in batch
    pub fn createAccounts(self: *Self, accounts: []const Account) !void {
        for (accounts) |account| {
            try self.createAccount(account);
        }
    }
    
    /// Process a transfer
    pub fn createTransfer(self: *Self, transfer: Transfer) !void {
        // Validate accounts exist
        var debit_account = self.accounts.getPtr(transfer.debit_account_id) orelse return error.DebitAccountNotFound;
        var credit_account = self.accounts.getPtr(transfer.credit_account_id) orelse return error.CreditAccountNotFound;
        
        // Validate ledger consistency
        if (debit_account.ledger != transfer.ledger or credit_account.ledger != transfer.ledger) {
            return error.LedgerMismatch;
        }
        
        // Check account flags and balances
        if (debit_account.flags.credits_must_not_exceed_debits) {
            const new_credits = debit_account.credits_posted + transfer.amount;
            if (new_credits > debit_account.debits_posted) {
                return error.ExceedsCredits;
            }
        }
        
        if (credit_account.flags.debits_must_not_exceed_credits) {
            const new_debits = credit_account.debits_posted + transfer.amount;
            if (new_debits > credit_account.credits_posted) {
                return error.ExceedsDebits;
            }
        }
        
        // Process the transfer
        if (transfer.flags.pending) {
            debit_account.debits_pending += transfer.amount;
            credit_account.credits_pending += transfer.amount;
        } else {
            debit_account.debits_posted += transfer.amount;
            credit_account.credits_posted += transfer.amount;
        }
        
        // Store the transfer
        try self.transfers.append(transfer);
        
        print("Transfer processed: ID={}, Amount={} NGN, Debit={}, Credit={}\n", 
              .{ transfer.id, transfer.amount, transfer.debit_account_id, transfer.credit_account_id });
    }
    
    /// Process multiple transfers in batch
    pub fn createTransfers(self: *Self, transfers: []const Transfer) !void {
        for (transfers) |transfer| {
            try self.createTransfer(transfer);
        }
    }
    
    /// Get account by ID
    pub fn getAccount(self: *Self, account_id: u128) ?*Account {
        return self.accounts.getPtr(account_id);
    }
    
    /// Get account balance
    pub fn getAccountBalance(self: *Self, account_id: u128) !i64 {
        const account = self.getAccount(account_id) orelse return error.AccountNotFound;
        return account.getBalance();
    }
    
    /// Nigerian banking specific: Create agent float account
    pub fn createAgentFloatAccount(self: *Self, agent_id: u128) !void {
        const account = Account.init(
            agent_id,
            NigerianLedgers.AGENT_ACCOUNTS,
            NigerianAccountCodes.AGENT_FLOAT
        );
        try self.createAccount(account);
    }
    
    /// Nigerian banking specific: Process agent transaction
    pub fn processAgentTransaction(
        self: *Self,
        transfer_id: u128,
        agent_account_id: u128,
        customer_account_id: u128,
        amount: u64,
        fee: u64
    ) !void {
        // Main transfer
        const main_transfer = Transfer.init(
            transfer_id,
            customer_account_id,
            agent_account_id,
            amount,
            NigerianLedgers.CUSTOMER_DEPOSITS,
            NigerianAccountCodes.CURRENT_ACCOUNT
        );
        
        // Fee transfer
        const fee_transfer = Transfer.init(
            transfer_id + 1,
            customer_account_id,
            1000000, // Fee income account
            fee,
            NigerianLedgers.FEE_INCOME,
            NigerianAccountCodes.TRANSACTION_FEE
        );
        
        try self.createTransfer(main_transfer);
        try self.createTransfer(fee_transfer);
    }
    
    /// Get engine statistics
    pub fn getStats(self: *Self) void {
        print("\n=== TigerBeetle Engine Statistics ===\n");
        print("Cluster ID: {}\n", .{self.cluster_id});
        print("Replica ID: {}\n", .{self.replica_id});
        print("Total Accounts: {}\n", .{self.accounts.count()});
        print("Total Transfers: {}\n", .{self.transfers.items.len});
        
        var total_debits: u64 = 0;
        var total_credits: u64 = 0;
        
        var iterator = self.accounts.iterator();
        while (iterator.next()) |entry| {
            const account = entry.value_ptr;
            total_debits += account.debits_posted;
            total_credits += account.credits_posted;
        }
        
        print("Total Debits: {} NGN\n", .{total_debits});
        print("Total Credits: {} NGN\n", .{total_credits});
        print("Balance Check: {}\n", .{if (total_debits == total_credits) "BALANCED" else "UNBALANCED"});
        print("=====================================\n\n");
    }
};

// =====================================================
// NIGERIAN BANKING DEMO
// =====================================================

fn runNigerianBankingDemo(allocator: Allocator) !void {
    print("\n🏦 TigerBeetle Nigerian Banking Demo\n");
    print("====================================\n\n");
    
    // Initialize TigerBeetle engine
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    // Create system accounts
    print("Creating system accounts...\n");
    
    const system_accounts = [_]Account{
        Account.init(1000000, NigerianLedgers.FEE_INCOME, NigerianAccountCodes.TRANSACTION_FEE),
        Account.init(2000000, NigerianLedgers.BANK_RESERVES, NigerianAccountCodes.CBN_RESERVE),
        Account.init(3000000, NigerianLedgers.OPERATIONAL_EXPENSES, NigerianAccountCodes.INTERCHANGE_FEE),
    };
    
    try engine.createAccounts(&system_accounts);
    
    // Create customer accounts
    print("\nCreating customer accounts...\n");
    
    const customer_accounts = [_]Account{
        Account.init(100001, NigerianLedgers.CUSTOMER_DEPOSITS, NigerianAccountCodes.SAVINGS_ACCOUNT),
        Account.init(100002, NigerianLedgers.CUSTOMER_DEPOSITS, NigerianAccountCodes.CURRENT_ACCOUNT),
        Account.init(100003, NigerianLedgers.CUSTOMER_DEPOSITS, NigerianAccountCodes.SAVINGS_ACCOUNT),
    };
    
    try engine.createAccounts(&customer_accounts);
    
    // Create agent accounts
    print("\nCreating agent accounts...\n");
    
    try engine.createAgentFloatAccount(200001);
    try engine.createAgentFloatAccount(200002);
    
    // Initial funding
    print("\nProcessing initial funding...\n");
    
    const funding_transfers = [_]Transfer{
        Transfer.init(1, 2000000, 100001, 1000000, NigerianLedgers.CUSTOMER_DEPOSITS, NigerianAccountCodes.SAVINGS_ACCOUNT), // 10,000 NGN
        Transfer.init(2, 2000000, 100002, 500000, NigerianLedgers.CUSTOMER_DEPOSITS, NigerianAccountCodes.CURRENT_ACCOUNT),  // 5,000 NGN
        Transfer.init(3, 2000000, 200001, 2000000, NigerianLedgers.AGENT_ACCOUNTS, NigerianAccountCodes.AGENT_FLOAT),       // 20,000 NGN
    };
    
    try engine.createTransfers(&funding_transfers);
    
    // Process agent transactions
    print("\nProcessing agent transactions...\n");
    
    try engine.processAgentTransaction(1001, 200001, 100001, 50000, 5000); // 500 NGN + 50 NGN fee
    try engine.processAgentTransaction(1002, 200001, 100002, 25000, 2500); // 250 NGN + 25 NGN fee
    
    // Display final statistics
    engine.getStats();
    
    // Display account balances
    print("Account Balances:\n");
    print("Customer 100001: {} NGN\n", .{try engine.getAccountBalance(100001)});
    print("Customer 100002: {} NGN\n", .{try engine.getAccountBalance(100002)});
    print("Agent 200001: {} NGN\n", .{try engine.getAccountBalance(200001)});
    print("Fee Income: {} NGN\n", .{try engine.getAccountBalance(1000000)});
    print("Bank Reserves: {} NGN\n", .{try engine.getAccountBalance(2000000)});
}

// =====================================================
// MAIN FUNCTION
// =====================================================

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();
    
    print("🚀 TigerBeetle Zig Implementation for Remittance Platform\n");
    print("High-Performance Double-Entry Bookkeeping Engine\n");
    print("Optimized for Nigerian Banking Operations\n\n");
    
    try runNigerianBankingDemo(allocator);
    
    print("✅ TigerBeetle Zig implementation completed successfully!\n");
}

// =====================================================
// TESTS
// =====================================================

test "account creation and balance" {
    const allocator = std.testing.allocator;
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    const account = Account.init(12345, 1000, 100);
    try engine.createAccount(account);
    
    const balance = try engine.getAccountBalance(12345);
    try std.testing.expect(balance == 0);
}

test "transfer processing" {
    const allocator = std.testing.allocator;
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    // Create accounts
    const debit_account = Account.init(1, 1000, 100);
    const credit_account = Account.init(2, 1000, 100);
    
    try engine.createAccount(debit_account);
    try engine.createAccount(credit_account);
    
    // Create transfer
    const transfer = Transfer.init(1, 1, 2, 10000, 1000, 100);
    try engine.createTransfer(transfer);
    
    // Check balances
    const debit_balance = try engine.getAccountBalance(1);
    const credit_balance = try engine.getAccountBalance(2);
    
    try std.testing.expect(debit_balance == 10000);
    try std.testing.expect(credit_balance == -10000);
}

test "nigerian banking operations" {
    const allocator = std.testing.allocator;
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    // Create agent float account
    try engine.createAgentFloatAccount(200001);
    
    const account = engine.getAccount(200001).?;
    try std.testing.expect(account.ledger == NigerianLedgers.AGENT_ACCOUNTS);
    try std.testing.expect(account.code == NigerianAccountCodes.AGENT_FLOAT);
}

