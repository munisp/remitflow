#!/usr/bin/env node
/**
 * Seed script: populates investment_assets with a diverse set of
 * stocks, ETFs, commodities, crypto, and mining shares relevant to
 * the African diaspora investor.
 *
 * Usage: node scripts/seed-investments.mjs
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, integer, text, boolean, decimal, timestamp } from "drizzle-orm/pg-core";

const DATABASE_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL or LOCAL_DATABASE_URL env var required");
  process.exit(1);
}

// Minimal inline schema for seeding
const investmentAssets = pgTable("investment_assets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  assetType: text("asset_type").notNull(),
  currentPrice: decimal("current_price", { precision: 18, scale: 8 }),
  priceChange24h: decimal("price_change_24h", { precision: 18, scale: 8 }),
  priceChangePct24h: decimal("price_change_pct_24h", { precision: 10, scale: 4 }),
  marketCap: decimal("market_cap", { precision: 24, scale: 2 }),
  volume24h: decimal("volume_24h", { precision: 24, scale: 2 }),
  currency: text("currency").default("USD"),
  exchange: text("exchange"),
  sector: text("sector"),
  country: text("country"),
  description: text("description"),
  logoUrl: text("logo_url"),
  isFeatured: boolean("is_featured").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const ASSETS = [
  // ── Crypto ──────────────────────────────────────────────────────────────────
  { symbol: "BTC", name: "Bitcoin", assetType: "crypto", currentPrice: "64250.00", priceChange24h: "1280.50", priceChangePct24h: "2.03", marketCap: "1260000000000", volume24h: "28500000000", currency: "USD", exchange: "Crypto", sector: "Cryptocurrency", country: "Global", description: "The original decentralised digital currency.", isFeatured: true },
  { symbol: "ETH", name: "Ethereum", assetType: "crypto", currentPrice: "3180.00", priceChange24h: "-42.00", priceChangePct24h: "-1.30", marketCap: "382000000000", volume24h: "14200000000", currency: "USD", exchange: "Crypto", sector: "Cryptocurrency", country: "Global", description: "Smart-contract platform powering DeFi and NFTs.", isFeatured: true },
  { symbol: "BNB", name: "BNB (Binance Coin)", assetType: "crypto", currentPrice: "412.50", priceChange24h: "8.20", priceChangePct24h: "2.03", marketCap: "61000000000", volume24h: "1800000000", currency: "USD", exchange: "Crypto", sector: "Cryptocurrency", country: "Global", description: "Native token of the BNB Chain ecosystem." },
  { symbol: "SOL", name: "Solana", assetType: "crypto", currentPrice: "178.40", priceChange24h: "5.60", priceChangePct24h: "3.24", marketCap: "82000000000", volume24h: "3200000000", currency: "USD", exchange: "Crypto", sector: "Cryptocurrency", country: "Global", description: "High-throughput blockchain for DeFi and NFTs." },
  { symbol: "USDT", name: "Tether USD", assetType: "crypto", currentPrice: "1.00", priceChange24h: "0.00", priceChangePct24h: "0.00", marketCap: "112000000000", volume24h: "48000000000", currency: "USD", exchange: "Crypto", sector: "Stablecoin", country: "Global", description: "USD-pegged stablecoin for stable value storage." },

  // ── US Stocks ────────────────────────────────────────────────────────────────
  { symbol: "AAPL", name: "Apple Inc.", assetType: "stock", currentPrice: "189.50", priceChange24h: "2.30", priceChangePct24h: "1.23", marketCap: "2940000000000", volume24h: "58000000", currency: "USD", exchange: "NASDAQ", sector: "Technology", country: "USA", description: "Consumer electronics, software, and services giant.", isFeatured: true },
  { symbol: "MSFT", name: "Microsoft Corporation", assetType: "stock", currentPrice: "415.20", priceChange24h: "-3.10", priceChangePct24h: "-0.74", marketCap: "3080000000000", volume24h: "22000000", currency: "USD", exchange: "NASDAQ", sector: "Technology", country: "USA", description: "Cloud, enterprise software, and AI leader." },
  { symbol: "GOOGL", name: "Alphabet Inc.", assetType: "stock", currentPrice: "175.80", priceChange24h: "1.90", priceChangePct24h: "1.09", marketCap: "2190000000000", volume24h: "24000000", currency: "USD", exchange: "NASDAQ", sector: "Technology", country: "USA", description: "Parent company of Google, YouTube, and DeepMind." },
  { symbol: "AMZN", name: "Amazon.com Inc.", assetType: "stock", currentPrice: "198.40", priceChange24h: "3.20", priceChangePct24h: "1.64", marketCap: "2080000000000", volume24h: "38000000", currency: "USD", exchange: "NASDAQ", sector: "Consumer Discretionary", country: "USA", description: "E-commerce, AWS cloud, and logistics behemoth." },
  { symbol: "TSLA", name: "Tesla Inc.", assetType: "stock", currentPrice: "248.60", priceChange24h: "-6.40", priceChangePct24h: "-2.51", marketCap: "792000000000", volume24h: "92000000", currency: "USD", exchange: "NASDAQ", sector: "Automotive / Clean Energy", country: "USA", description: "Electric vehicles, energy storage, and solar." },
  { symbol: "NVDA", name: "NVIDIA Corporation", assetType: "stock", currentPrice: "875.40", priceChange24h: "22.10", priceChangePct24h: "2.59", marketCap: "2160000000000", volume24h: "44000000", currency: "USD", exchange: "NASDAQ", sector: "Semiconductors", country: "USA", description: "GPU leader powering AI and data centres.", isFeatured: true },

  // ── African-listed Stocks ────────────────────────────────────────────────────
  { symbol: "DANGCEM", name: "Dangote Cement Plc", assetType: "stock", currentPrice: "42.50", priceChange24h: "0.80", priceChangePct24h: "1.92", marketCap: "724000000000", volume24h: "12000000", currency: "NGN", exchange: "NGX", sector: "Materials", country: "Nigeria", description: "Africa's largest cement producer.", isFeatured: true },
  { symbol: "GTCO", name: "Guaranty Trust Holding Co.", assetType: "stock", currentPrice: "38.20", priceChange24h: "-0.30", priceChangePct24h: "-0.78", marketCap: "1120000000000", volume24h: "45000000", currency: "NGN", exchange: "NGX", sector: "Financials", country: "Nigeria", description: "Leading Nigerian commercial bank and fintech group." },
  { symbol: "SAFCOM", name: "Safaricom Plc", assetType: "stock", currentPrice: "18.40", priceChange24h: "0.25", priceChangePct24h: "1.38", marketCap: "737000000000", volume24h: "8500000", currency: "KES", exchange: "NSE", sector: "Telecommunications", country: "Kenya", description: "M-Pesa operator and Kenya's largest telco." },
  { symbol: "MTN", name: "MTN Group Ltd", assetType: "stock", currentPrice: "142.80", priceChange24h: "2.10", priceChangePct24h: "1.49", marketCap: "262000000000", volume24h: "6200000", currency: "ZAR", exchange: "JSE", sector: "Telecommunications", country: "South Africa", description: "Pan-African mobile network with 280M+ subscribers." },

  // ── ETFs ─────────────────────────────────────────────────────────────────────
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetType: "etf", currentPrice: "524.80", priceChange24h: "4.20", priceChangePct24h: "0.81", marketCap: "498000000000", volume24h: "68000000", currency: "USD", exchange: "NYSE Arca", sector: "Broad Market", country: "USA", description: "Tracks the S&P 500 index — the US market benchmark.", isFeatured: true },
  { symbol: "QQQ", name: "Invesco QQQ Trust", assetType: "etf", currentPrice: "448.60", priceChange24h: "5.80", priceChangePct24h: "1.31", marketCap: "248000000000", volume24h: "42000000", currency: "USD", exchange: "NASDAQ", sector: "Technology", country: "USA", description: "Tracks the NASDAQ-100 index — top US tech companies." },
  { symbol: "EEM", name: "iShares MSCI Emerging Markets ETF", assetType: "etf", currentPrice: "42.30", priceChange24h: "0.60", priceChangePct24h: "1.44", marketCap: "18000000000", volume24h: "52000000", currency: "USD", exchange: "NYSE Arca", sector: "Emerging Markets", country: "Global", description: "Exposure to large/mid-cap emerging market equities." },
  { symbol: "AFK", name: "VanEck Africa Index ETF", assetType: "etf", currentPrice: "21.40", priceChange24h: "0.30", priceChangePct24h: "1.42", marketCap: "68000000", volume24h: "120000", currency: "USD", exchange: "NYSE Arca", sector: "Africa", country: "Africa", description: "Broad exposure to African equity markets.", isFeatured: true },

  // ── Commodities ──────────────────────────────────────────────────────────────
  { symbol: "GLD", name: "Gold (SPDR Gold Shares)", assetType: "commodity", currentPrice: "218.40", priceChange24h: "1.20", priceChangePct24h: "0.55", marketCap: "56000000000", volume24h: "8200000", currency: "USD", exchange: "NYSE Arca", sector: "Precious Metals", country: "Global", description: "Physical gold-backed ETF — the classic safe haven.", isFeatured: true },
  { symbol: "SLV", name: "Silver (iShares Silver Trust)", assetType: "commodity", currentPrice: "26.80", priceChange24h: "0.40", priceChangePct24h: "1.52", marketCap: "11000000000", volume24h: "14000000", currency: "USD", exchange: "NYSE Arca", sector: "Precious Metals", country: "Global", description: "Physical silver-backed ETF." },
  { symbol: "OIL", name: "Crude Oil (iPath Series B)", assetType: "commodity", currentPrice: "28.60", priceChange24h: "-0.80", priceChangePct24h: "-2.72", marketCap: "420000000", volume24h: "1800000", currency: "USD", exchange: "NYSE Arca", sector: "Energy", country: "Global", description: "Tracks crude oil futures — key for African exporters." },
  { symbol: "COCO", name: "Cocoa Futures (iPath)", assetType: "commodity", currentPrice: "42.10", priceChange24h: "1.80", priceChangePct24h: "4.47", marketCap: "180000000", volume24h: "320000", currency: "USD", exchange: "NYSE Arca", sector: "Soft Commodities", country: "Global", description: "Cocoa futures — Ghana and Ivory Coast are world leaders." },

  // ── Mining Shares ────────────────────────────────────────────────────────────
  { symbol: "ANGLOGOLD", name: "AngloGold Ashanti Ltd", assetType: "mining_share", currentPrice: "24.80", priceChange24h: "0.60", priceChangePct24h: "2.48", marketCap: "10500000000", volume24h: "3200000", currency: "USD", exchange: "NYSE", sector: "Gold Mining", country: "South Africa", description: "One of the world's largest gold mining companies.", isFeatured: true },
  { symbol: "GFI", name: "Gold Fields Limited", assetType: "mining_share", currentPrice: "18.20", priceChange24h: "0.40", priceChangePct24h: "2.25", marketCap: "8100000000", volume24h: "2800000", currency: "USD", exchange: "NYSE", sector: "Gold Mining", country: "South Africa", description: "Major gold miner with operations across Africa and Australia." },
  { symbol: "IMPALA", name: "Impala Platinum Holdings", assetType: "mining_share", currentPrice: "62.40", priceChange24h: "-1.20", priceChangePct24h: "-1.89", marketCap: "88000000000", volume24h: "4100000", currency: "ZAR", exchange: "JSE", sector: "Platinum Group Metals", country: "South Africa", description: "World's second-largest platinum producer." },
  { symbol: "FREEPORT", name: "Freeport-McMoRan Inc.", assetType: "mining_share", currentPrice: "48.60", priceChange24h: "1.10", priceChangePct24h: "2.31", marketCap: "70000000000", volume24h: "18000000", currency: "USD", exchange: "NYSE", sector: "Copper Mining", country: "USA", description: "World's largest publicly traded copper producer." },
];

async function main() {
  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  console.log(`Seeding ${ASSETS.length} investment assets...`);

  let inserted = 0;
  let skipped = 0;

  for (const asset of ASSETS) {
    try {
      await db
        .insert(investmentAssets)
        .values(asset)
        .onConflictDoNothing({ target: investmentAssets.symbol });
      inserted++;
      process.stdout.write(".");
    } catch (err) {
      skipped++;
      process.stdout.write("x");
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped (already exist): ${skipped}`);
  await client.end();
}

main().catch(err => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
