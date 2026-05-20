/**
 * Seed 90 days of daily OHLCV price history for all investment assets.
 * Uses a geometric Brownian motion simulation for realistic price paths.
 */
import postgres from "postgres";

const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }
const client = postgres(url, { max: 1 });

/** Simulate a realistic price path using GBM */
function generatePricePath(startPrice, days, annualVolatility = 0.35, annualDrift = 0.08) {
  const dt = 1 / 252; // daily step
  const drift = (annualDrift - 0.5 * annualVolatility ** 2) * dt;
  const vol = annualVolatility * Math.sqrt(dt);
  const prices = [startPrice];
  for (let i = 1; i < days; i++) {
    const z = gaussianRandom();
    prices.push(prices[i - 1] * Math.exp(drift + vol * z));
  }
  return prices;
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function closeToCandlestick(close, prevClose) {
  const range = Math.abs(close - prevClose) * (0.5 + Math.random() * 1.5);
  const open = prevClose;
  const high = Math.max(open, close) + range * Math.random() * 0.3;
  const low = Math.min(open, close) - range * Math.random() * 0.3;
  const volume = (10000 + Math.random() * 990000).toFixed(2);
  return { open, high, low, close, volume };
}

async function main() {
  // Fetch all active assets
  const assets = await client`SELECT id, symbol, current_price, asset_type FROM investment_assets WHERE is_active = true ORDER BY id`;
  console.log(`Seeding price history for ${assets.length} assets over 90 days...`);

  // Volatility by asset type
  const volMap = { crypto: 0.65, stock: 0.30, etf: 0.18, commodity: 0.28, mining_share: 0.45, bond: 0.08, index_fund: 0.18 };

  const DAYS = 90;
  const now = new Date();
  let totalRows = 0;

  for (const asset of assets) {
    // Check if history already exists
    const [existing] = await client`SELECT COUNT(*)::int as cnt FROM investment_price_history WHERE asset_id = ${asset.id}`;
    if (existing.cnt > 0) {
      console.log(`  ${asset.symbol}: already has ${existing.cnt} rows, skipping`);
      continue;
    }

    const startPrice = Number(asset.current_price ?? 100);
    const vol = volMap[asset.asset_type] ?? 0.30;
    const closePrices = generatePricePath(startPrice * 0.75, DAYS, vol);

    const rows = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - (DAYS - 1 - i));
      d.setHours(0, 0, 0, 0);
      const prevClose = i === 0 ? closePrices[0] * 0.99 : closePrices[i - 1];
      const candle = closeToCandlestick(closePrices[i], prevClose);
      rows.push({
        asset_id: asset.id,
        open: candle.open.toFixed(6),
        high: candle.high.toFixed(6),
        low: Math.max(0.000001, candle.low).toFixed(6),
        close: closePrices[i].toFixed(6),
        volume: candle.volume,
        timestamp: d,
        interval: "1d",
      });
    }

    // Batch insert
    await client`INSERT INTO investment_price_history ${client(rows, "asset_id", "open", "high", "low", "close", "volume", "timestamp", "interval")}`;
    totalRows += rows.length;
    console.log(`  ${asset.symbol}: inserted ${rows.length} rows`);
  }

  console.log(`\nDone. Total rows inserted: ${totalRows}`);
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
