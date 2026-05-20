// TigerBeetle Zig Performance Benchmark
// High-performance accounting engine benchmarks for Remittance Platform

const std = @import("std");
const print = std.debug.print;
const Timer = std.time.Timer;

// Import our TigerBeetle implementation
const main_module = @import("main.zig");
const TigerBeetleEngine = main_module.TigerBeetleEngine;
const Account = main_module.Account;
const Transfer = main_module.Transfer;
const NigerianLedgers = main_module.NigerianLedgers;
const NigerianAccountCodes = main_module.NigerianAccountCodes;

const BenchmarkConfig = struct {
    num_accounts: u32 = 10000,
    num_transfers: u32 = 100000,
    batch_size: u32 = 1000,
    warmup_iterations: u32 = 3,
    benchmark_iterations: u32 = 10,
};

const BenchmarkResults = struct {
    accounts_per_second: f64,
    transfers_per_second: f64,
    total_time_ms: f64,
    memory_used_mb: f64,
};

fn generateTestAccounts(allocator: std.mem.Allocator, count: u32) ![]Account {
    var accounts = try allocator.alloc(Account, count);
    
    for (accounts, 0..) |*account, i| {
        const account_id = @as(u128, i + 1);
        const ledger = if (i % 3 == 0) NigerianLedgers.CUSTOMER_DEPOSITS 
                      else if (i % 3 == 1) NigerianLedgers.AGENT_ACCOUNTS 
                      else NigerianLedgers.BANK_RESERVES;
        const code = if (i % 2 == 0) NigerianAccountCodes.SAVINGS_ACCOUNT 
                    else NigerianAccountCodes.CURRENT_ACCOUNT;
        
        account.* = Account.init(account_id, ledger, code);
    }
    
    return accounts;
}

fn generateTestTransfers(allocator: std.mem.Allocator, count: u32, num_accounts: u32) ![]Transfer {
    var transfers = try allocator.alloc(Transfer, count);
    var rng = std.rand.DefaultPrng.init(@intCast(std.time.timestamp()));
    
    for (transfers, 0..) |*transfer, i| {
        const transfer_id = @as(u128, i + 1);
        const debit_account = rng.random().intRangeAtMost(u128, 1, num_accounts);
        var credit_account = rng.random().intRangeAtMost(u128, 1, num_accounts);
        
        // Ensure different accounts
        while (credit_account == debit_account) {
            credit_account = rng.random().intRangeAtMost(u128, 1, num_accounts);
        }
        
        const amount = rng.random().intRangeAtMost(u64, 100, 1000000); // 1 NGN to 10,000 NGN
        
        transfer.* = Transfer.init(
            transfer_id,
            debit_account,
            credit_account,
            amount,
            NigerianLedgers.CUSTOMER_DEPOSITS,
            NigerianAccountCodes.CURRENT_ACCOUNT
        );
    }
    
    return transfers;
}

fn benchmarkAccountCreation(allocator: std.mem.Allocator, config: BenchmarkConfig) !f64 {
    print("Benchmarking account creation ({} accounts)...\n", .{config.num_accounts});
    
    var total_time: u64 = 0;
    
    for (0..config.benchmark_iterations) |iteration| {
        var engine = try TigerBeetleEngine.init(allocator, 1, 0);
        defer engine.deinit();
        
        const accounts = try generateTestAccounts(allocator, config.num_accounts);
        defer allocator.free(accounts);
        
        var timer = try Timer.start();
        
        // Benchmark account creation in batches
        var i: u32 = 0;
        while (i < config.num_accounts) {
            const batch_end = @min(i + config.batch_size, config.num_accounts);
            const batch = accounts[i..batch_end];
            
            try engine.createAccounts(batch);
            i = batch_end;
        }
        
        const elapsed = timer.read();
        total_time += elapsed;
        
        if (iteration == 0) {
            print("  First iteration: {d:.2} ms\n", .{@as(f64, @floatFromInt(elapsed)) / 1_000_000});
        }
    }
    
    const avg_time_ns = @as(f64, @floatFromInt(total_time)) / @as(f64, @floatFromInt(config.benchmark_iterations));
    const avg_time_s = avg_time_ns / 1_000_000_000;
    const accounts_per_second = @as(f64, @floatFromInt(config.num_accounts)) / avg_time_s;
    
    print("  Average: {d:.2} accounts/second\n", .{accounts_per_second});
    return accounts_per_second;
}

fn benchmarkTransferProcessing(allocator: std.mem.Allocator, config: BenchmarkConfig) !f64 {
    print("Benchmarking transfer processing ({} transfers)...\n", .{config.num_transfers});
    
    // Pre-create accounts
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    const accounts = try generateTestAccounts(allocator, config.num_accounts);
    defer allocator.free(accounts);
    
    try engine.createAccounts(accounts);
    
    var total_time: u64 = 0;
    
    for (0..config.benchmark_iterations) |iteration| {
        const transfers = try generateTestTransfers(allocator, config.num_transfers, config.num_accounts);
        defer allocator.free(transfers);
        
        var timer = try Timer.start();
        
        // Benchmark transfer processing in batches
        var i: u32 = 0;
        while (i < config.num_transfers) {
            const batch_end = @min(i + config.batch_size, config.num_transfers);
            const batch = transfers[i..batch_end];
            
            try engine.createTransfers(batch);
            i = batch_end;
        }
        
        const elapsed = timer.read();
        total_time += elapsed;
        
        if (iteration == 0) {
            print("  First iteration: {d:.2} ms\n", .{@as(f64, @floatFromInt(elapsed)) / 1_000_000});
        }
    }
    
    const avg_time_ns = @as(f64, @floatFromInt(total_time)) / @as(f64, @floatFromInt(config.benchmark_iterations));
    const avg_time_s = avg_time_ns / 1_000_000_000;
    const transfers_per_second = @as(f64, @floatFromInt(config.num_transfers)) / avg_time_s;
    
    print("  Average: {d:.2} transfers/second\n", .{transfers_per_second});
    return transfers_per_second;
}

fn benchmarkNigerianBankingWorkload(allocator: std.mem.Allocator) !void {
    print("\nBenchmarking Nigerian Banking Workload...\n");
    
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    // Create realistic Nigerian banking scenario
    const num_customers: u32 = 1000;
    const num_agents: u32 = 100;
    const num_transactions: u32 = 10000;
    
    var timer = try Timer.start();
    
    // Create customer accounts
    for (1..num_customers + 1) |i| {
        const account = Account.init(
            @as(u128, i),
            NigerianLedgers.CUSTOMER_DEPOSITS,
            if (i % 2 == 0) NigerianAccountCodes.SAVINGS_ACCOUNT else NigerianAccountCodes.CURRENT_ACCOUNT
        );
        try engine.createAccount(account);
    }
    
    // Create agent accounts
    for (1..num_agents + 1) |i| {
        try engine.createAgentFloatAccount(@as(u128, 100000 + i));
    }
    
    // Create system accounts
    const system_accounts = [_]Account{
        Account.init(1000000, NigerianLedgers.FEE_INCOME, NigerianAccountCodes.TRANSACTION_FEE),
        Account.init(2000000, NigerianLedgers.BANK_RESERVES, NigerianAccountCodes.CBN_RESERVE),
    };
    try engine.createAccounts(&system_accounts);
    
    // Process agent transactions
    var rng = std.rand.DefaultPrng.init(@intCast(std.time.timestamp()));
    
    for (1..num_transactions + 1) |i| {
        const customer_id = rng.random().intRangeAtMost(u128, 1, num_customers);
        const agent_id = rng.random().intRangeAtMost(u128, 100001, 100000 + num_agents);
        const amount = rng.random().intRangeAtMost(u64, 100, 50000); // 1-500 NGN
        const fee = amount / 100; // 1% fee
        
        try engine.processAgentTransaction(
            @as(u128, i),
            agent_id,
            customer_id,
            amount,
            fee
        );
    }
    
    const elapsed = timer.read();
    const elapsed_ms = @as(f64, @floatFromInt(elapsed)) / 1_000_000;
    const tps = @as(f64, @floatFromInt(num_transactions)) / (@as(f64, @floatFromInt(elapsed)) / 1_000_000_000);
    
    print("  Created {} customers, {} agents\n", .{ num_customers, num_agents });
    print("  Processed {} transactions in {d:.2} ms\n", .{ num_transactions, elapsed_ms });
    print("  Throughput: {d:.2} TPS\n", .{tps});
    
    engine.getStats();
}

fn runMemoryBenchmark(allocator: std.mem.Allocator) !void {
    print("\nMemory Usage Benchmark...\n");
    
    const config = BenchmarkConfig{
        .num_accounts = 50000,
        .num_transfers = 100000,
    };
    
    var engine = try TigerBeetleEngine.init(allocator, 1, 0);
    defer engine.deinit();
    
    // Create accounts
    const accounts = try generateTestAccounts(allocator, config.num_accounts);
    defer allocator.free(accounts);
    
    try engine.createAccounts(accounts);
    
    // Create transfers
    const transfers = try generateTestTransfers(allocator, config.num_transfers, config.num_accounts);
    defer allocator.free(transfers);
    
    try engine.createTransfers(transfers);
    
    // Estimate memory usage (simplified)
    const account_size = @sizeOf(Account);
    const transfer_size = @sizeOf(Transfer);
    const total_memory = (config.num_accounts * account_size) + (config.num_transfers * transfer_size);
    const memory_mb = @as(f64, @floatFromInt(total_memory)) / (1024 * 1024);
    
    print("  Accounts: {} ({} bytes each)\n", .{ config.num_accounts, account_size });
    print("  Transfers: {} ({} bytes each)\n", .{ config.num_transfers, transfer_size });
    print("  Estimated memory usage: {d:.2} MB\n", .{memory_mb});
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();
    
    print("🚀 TigerBeetle Zig Performance Benchmark\n");
    print("High-Performance Accounting Engine for Remittance Platform\n");
    print("=========================================================\n\n");
    
    const config = BenchmarkConfig{};
    
    // Warmup
    print("Warming up...\n");
    for (0..config.warmup_iterations) |_| {
        var engine = try TigerBeetleEngine.init(allocator, 1, 0);
        defer engine.deinit();
        
        const accounts = try generateTestAccounts(allocator, 1000);
        defer allocator.free(accounts);
        
        try engine.createAccounts(accounts);
    }
    
    print("\nStarting benchmarks...\n");
    print("======================\n");
    
    // Run benchmarks
    const accounts_per_second = try benchmarkAccountCreation(allocator, config);
    const transfers_per_second = try benchmarkTransferProcessing(allocator, config);
    
    try benchmarkNigerianBankingWorkload(allocator);
    try runMemoryBenchmark(allocator);
    
    // Summary
    print("\n📊 Benchmark Summary\n");
    print("===================\n");
    print("Account Creation: {d:.0} accounts/second\n", .{accounts_per_second});
    print("Transfer Processing: {d:.0} transfers/second\n", .{transfers_per_second});
    print("Configuration: {} accounts, {} transfers\n", .{ config.num_accounts, config.num_transfers });
    print("Batch Size: {}\n", .{config.batch_size});
    
    print("\n✅ TigerBeetle Zig benchmark completed successfully!\n");
}

