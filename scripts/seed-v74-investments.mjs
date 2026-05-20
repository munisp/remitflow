/**
 * seed-v74-investments.mjs
 * Seeds NGX stocks, real estate listings, and startup deals with realistic Nigerian market data.
 * Run: DATABASE_URL=$LOCAL_DATABASE_URL node scripts/seed-v74-investments.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ─── NGX STOCKS ──────────────────────────────────────────────────────────────
const NGX_STOCKS = [
  { symbol: "DANGCEM", name: "Dangote Cement Plc", sector: "Industrial Goods", exchange: "NGX", currentPriceNgn: "542.00", marketCapNgn: "9230000000000", peRatio: "12.4", dividendYieldPct: "5.2", weekHigh52Ngn: "620.00", weekLow52Ngn: "410.00", description: "Africa's largest cement producer, listed on NGX. Operations in 10 African countries.", isBlueChip: true, isActive: true },
  { symbol: "GTCO", name: "Guaranty Trust Holding Co. Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "47.50", marketCapNgn: "1397000000000", peRatio: "6.8", dividendYieldPct: "8.1", weekHigh52Ngn: "58.00", weekLow52Ngn: "32.00", description: "Pan-African financial services group with operations across Africa and Europe.", isBlueChip: true, isActive: true },
  { symbol: "ZENITHBANK", name: "Zenith Bank Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "38.20", marketCapNgn: "1200000000000", peRatio: "5.9", dividendYieldPct: "9.4", weekHigh52Ngn: "45.00", weekLow52Ngn: "26.50", description: "One of Nigeria's largest banks by total assets and profitability.", isBlueChip: true, isActive: true },
  { symbol: "MTNN", name: "MTN Nigeria Communications Plc", sector: "ICT", exchange: "NGX", currentPriceNgn: "215.00", marketCapNgn: "4380000000000", peRatio: "18.2", dividendYieldPct: "4.6", weekHigh52Ngn: "280.00", weekLow52Ngn: "160.00", description: "Nigeria's largest telecom operator with 80M+ subscribers.", isBlueChip: true, isActive: true },
  { symbol: "AIRTELAFRI", name: "Airtel Africa Plc", sector: "ICT", exchange: "NGX", currentPriceNgn: "1850.00", marketCapNgn: "6960000000000", peRatio: "22.1", dividendYieldPct: "2.8", weekHigh52Ngn: "2200.00", weekLow52Ngn: "1400.00", description: "Pan-African telecom and mobile money operator across 14 African countries.", isBlueChip: true, isActive: true },
  { symbol: "BUACEMENT", name: "BUA Cement Plc", sector: "Industrial Goods", exchange: "NGX", currentPriceNgn: "98.00", marketCapNgn: "3234000000000", peRatio: "10.8", dividendYieldPct: "3.1", weekHigh52Ngn: "125.00", weekLow52Ngn: "72.00", description: "Second largest cement producer in Nigeria with 11 million MT capacity.", isBlueChip: false, isActive: true },
  { symbol: "ACCESSCORP", name: "Access Holdings Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "22.80", marketCapNgn: "812000000000", peRatio: "4.2", dividendYieldPct: "7.9", weekHigh52Ngn: "28.50", weekLow52Ngn: "16.00", description: "Nigeria's largest bank by total assets with operations in 18 countries.", isBlueChip: true, isActive: true },
  { symbol: "FBNH", name: "FBN Holdings Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "28.50", marketCapNgn: "1020000000000", peRatio: "5.1", dividendYieldPct: "6.3", weekHigh52Ngn: "35.00", weekLow52Ngn: "20.00", description: "Nigeria's oldest bank, founded 1894. Operates First Bank of Nigeria.", isBlueChip: false, isActive: true },
  { symbol: "NESTLE", name: "Nestle Nigeria Plc", sector: "Consumer Goods", exchange: "NGX", currentPriceNgn: "1450.00", marketCapNgn: "1150000000000", peRatio: "28.4", dividendYieldPct: "3.8", weekHigh52Ngn: "1800.00", weekLow52Ngn: "1100.00", description: "Leading FMCG company in Nigeria. Products include Milo, Maggi, Nestlé Pure Life.", isBlueChip: true, isActive: true },
  { symbol: "DANGSUGAR", name: "Dangote Sugar Refinery Plc", sector: "Consumer Goods", exchange: "NGX", currentPriceNgn: "32.00", marketCapNgn: "386000000000", peRatio: "7.2", dividendYieldPct: "5.0", weekHigh52Ngn: "42.00", weekLow52Ngn: "24.00", description: "Largest sugar refinery in sub-Saharan Africa. Refines 1.44M MT of sugar annually.", isBlueChip: false, isActive: true },
  { symbol: "SEPLAT", name: "Seplat Energy Plc", sector: "Oil & Gas", exchange: "NGX", currentPriceNgn: "4200.00", marketCapNgn: "2470000000000", peRatio: "8.9", dividendYieldPct: "4.2", weekHigh52Ngn: "5200.00", weekLow52Ngn: "3100.00", description: "Leading indigenous Nigerian oil and gas company. Dual-listed on NGX and LSE.", isBlueChip: true, isActive: true },
  { symbol: "STANBIC", name: "Stanbic IBTC Holdings Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "68.00", marketCapNgn: "244000000000", peRatio: "9.4", dividendYieldPct: "5.7", weekHigh52Ngn: "82.00", weekLow52Ngn: "50.00", description: "Subsidiary of Standard Bank Group. Offers banking, insurance, and asset management.", isBlueChip: false, isActive: true },
  { symbol: "TRANSCORP", name: "Transnational Corporation Plc", sector: "Conglomerates", exchange: "NGX", currentPriceNgn: "12.50", marketCapNgn: "224000000000", peRatio: "6.1", dividendYieldPct: "4.0", weekHigh52Ngn: "16.00", weekLow52Ngn: "8.50", description: "Diversified conglomerate with interests in hospitality, power, and oil & gas.", isBlueChip: false, isActive: true },
  { symbol: "UBA", name: "United Bank for Africa Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "24.60", marketCapNgn: "843000000000", peRatio: "4.8", dividendYieldPct: "8.5", weekHigh52Ngn: "30.00", weekLow52Ngn: "18.00", description: "Pan-African bank with presence in 20 African countries, UK, USA, and France.", isBlueChip: true, isActive: true },
  { symbol: "WAPCO", name: "Lafarge Africa Plc", sector: "Industrial Goods", exchange: "NGX", currentPriceNgn: "38.50", marketCapNgn: "618000000000", peRatio: "11.2", dividendYieldPct: "2.6", weekHigh52Ngn: "48.00", weekLow52Ngn: "28.00", description: "Part of LafargeHolcim Group. Produces cement and aggregates across Nigeria.", isBlueChip: false, isActive: true },
  { symbol: "BUAFOOD", name: "BUA Foods Plc", sector: "Consumer Goods", exchange: "NGX", currentPriceNgn: "420.00", marketCapNgn: "7560000000000", peRatio: "24.6", dividendYieldPct: "2.4", weekHigh52Ngn: "520.00", weekLow52Ngn: "320.00", description: "Largest flour milling and sugar refining company in Nigeria.", isBlueChip: true, isActive: true },
  { symbol: "OANDO", name: "Oando Plc", sector: "Oil & Gas", exchange: "NGX", currentPriceNgn: "18.00", marketCapNgn: "216000000000", peRatio: "5.4", dividendYieldPct: "0.0", weekHigh52Ngn: "24.00", weekLow52Ngn: "12.00", description: "Integrated energy solutions provider with upstream, midstream, and downstream operations.", isBlueChip: false, isActive: true },
  { symbol: "PRESCO", name: "Presco Plc", sector: "Agriculture", exchange: "NGX", currentPriceNgn: "480.00", marketCapNgn: "480000000000", peRatio: "8.2", dividendYieldPct: "3.1", weekHigh52Ngn: "580.00", weekLow52Ngn: "360.00", description: "Integrated palm oil company. Largest palm oil producer in Nigeria.", isBlueChip: false, isActive: true },
  { symbol: "FIDELITYBK", name: "Fidelity Bank Plc", sector: "Financial Services", exchange: "NGX", currentPriceNgn: "14.20", marketCapNgn: "407000000000", peRatio: "4.1", dividendYieldPct: "7.0", weekHigh52Ngn: "18.00", weekLow52Ngn: "10.00", description: "Mid-tier Nigerian bank with strong retail and SME banking focus.", isBlueChip: false, isActive: true },
  { symbol: "FLOURMILL", name: "Flour Mills of Nigeria Plc", sector: "Consumer Goods", exchange: "NGX", currentPriceNgn: "52.00", marketCapNgn: "260000000000", peRatio: "6.8", dividendYieldPct: "4.8", weekHigh52Ngn: "65.00", weekLow52Ngn: "38.00", description: "Nigeria's largest flour milling company. Also produces pasta, noodles, and sugar.", isBlueChip: false, isActive: true },
];

// ─── REAL ESTATE LISTINGS ─────────────────────────────────────────────────────
const REAL_ESTATE_LISTINGS = [
  {
    title: "Ikoyi Luxury Apartment Block", city: "Lagos", state: "Lagos", country: "Nigeria",
    propertyType: "apartment", totalValueUsd: "2500000", pricePerShareUsd: "500",
    totalShares: 5000, availableShares: 3200, rentalYieldPct: "11.2",
    projectedAppreciationPct: "8.5", occupancyRatePct: "94",
    address: "15 Bourdillon Road, Ikoyi, Lagos", bedrooms: 4, bathrooms: 4, areaSqm: 280,
    description: "Premium 4-bedroom apartment in the heart of Ikoyi. Fully furnished, 24/7 security, swimming pool, gym. Managed by Grenadines Homes.",
    amenities: JSON.stringify(["Swimming Pool", "24/7 Security", "Gym", "Backup Power", "Parking", "CCTV"]),
    imageUrls: JSON.stringify([]),
    status: "active", isVerified: true, isFeatured: true,
    titleDeedType: "C of O", managementFee: "8.0", minimumHoldPeriodMonths: 12,
  },
  {
    title: "Victoria Island Commercial Plaza", city: "Lagos", state: "Lagos", country: "Nigeria",
    propertyType: "commercial", totalValueUsd: "5000000", pricePerShareUsd: "1000",
    totalShares: 5000, availableShares: 2800, rentalYieldPct: "9.8",
    projectedAppreciationPct: "7.2", occupancyRatePct: "88",
    address: "Plot 1234 Adeola Odeku Street, Victoria Island, Lagos", bedrooms: null, bathrooms: null, areaSqm: 1200,
    description: "Prime commercial office space on Victoria Island. Tenanted by multinational companies. Grade A office building with modern facilities.",
    amenities: JSON.stringify(["24/7 Security", "Backup Power", "Parking", "Conference Rooms", "High-speed Internet", "Cafeteria"]),
    imageUrls: JSON.stringify([]),
    status: "active", isVerified: true, isFeatured: true,
    titleDeedType: "C of O", managementFee: "7.5", minimumHoldPeriodMonths: 24,
  },
  {
    title: "Abuja Maitama Residence", city: "Abuja", state: "FCT", country: "Nigeria",
    propertyType: "house", totalValueUsd: "800000", pricePerShareUsd: "500",
    totalShares: 1600, availableShares: 900, rentalYieldPct: "8.4",
    projectedAppreciationPct: "6.8", occupancyRatePct: "91",
    address: "Plot 45 Parakou Crescent, Maitama, Abuja", bedrooms: 5, bathrooms: 5, areaSqm: 450,
    description: "5-bedroom detached house in Maitama, Abuja's most prestigious district. Fully serviced with diplomatic-grade security.",
    amenities: JSON.stringify(["Swimming Pool", "Boys Quarters", "24/7 Security", "Backup Power", "Garden", "Parking"]),
    imageUrls: JSON.stringify([]),
    status: "active", isVerified: true, isFeatured: false,
    titleDeedType: "C of O", managementFee: "8.0", minimumHoldPeriodMonths: 12,
  },
  {
    title: "Lekki Phase 1 Short-Let Complex", city: "Lagos", state: "Lagos", country: "Nigeria",
    propertyType: "apartment", totalValueUsd: "1200000", pricePerShareUsd: "500",
    totalShares: 2400, availableShares: 1600, rentalYieldPct: "14.5",
    projectedAppreciationPct: "9.2", occupancyRatePct: "82",
    address: "12 Admiralty Way, Lekki Phase 1, Lagos", bedrooms: 3, bathrooms: 3, areaSqm: 180,
    description: "12-unit short-let apartment complex in Lekki Phase 1. High occupancy from business travelers and expatriates. Managed by Shortlet.ng.",
    amenities: JSON.stringify(["Swimming Pool", "24/7 Security", "Gym", "Backup Power", "Parking", "Laundry"]),
    imageUrls: JSON.stringify([]),
    status: "active", isVerified: true, isFeatured: true,
    titleDeedType: "C of O", managementFee: "10.0", minimumHoldPeriodMonths: 6,
  },
  {
    title: "Port Harcourt GRA Duplex", city: "Port Harcourt", state: "Rivers", country: "Nigeria",
    propertyType: "house", totalValueUsd: "450000", pricePerShareUsd: "500",
    totalShares: 900, availableShares: 600, rentalYieldPct: "10.1",
    projectedAppreciationPct: "5.5", occupancyRatePct: "89",
    address: "15 Rumuola Road, GRA Phase 2, Port Harcourt", bedrooms: 4, bathrooms: 4, areaSqm: 320,
    description: "4-bedroom duplex in Port Harcourt GRA. Tenanted by oil company executives. Strong rental demand from energy sector.",
    amenities: JSON.stringify(["24/7 Security", "Backup Power", "Parking", "Garden", "Borehole"]),
    imageUrls: JSON.stringify([]),
    status: "active", isVerified: false, isFeatured: false,
    titleDeedType: "C of O", managementFee: "8.5", minimumHoldPeriodMonths: 12,
  },
  {
    title: "Banana Island Penthouse", city: "Lagos", state: "Lagos", country: "Nigeria",
    propertyType: "apartment", totalValueUsd: "8000000", pricePerShareUsd: "1000",
    totalShares: 8000, availableShares: 5500, rentalYieldPct: "7.8",
    projectedAppreciationPct: "12.0", occupancyRatePct: "96",
    address: "Plot 22 Banana Island Road, Ikoyi, Lagos", bedrooms: 6, bathrooms: 7, areaSqm: 650,
    description: "Ultra-luxury penthouse on Banana Island, Nigeria's most exclusive address. Panoramic ocean views, private pool, concierge service.",
    amenities: JSON.stringify(["Private Pool", "Concierge", "Helipad Access", "24/7 Security", "Smart Home", "Cinema Room", "Wine Cellar"]),
    imageUrls: JSON.stringify([]),
    status: "active", isVerified: true, isFeatured: true,
    titleDeedType: "C of O", managementFee: "12.0", minimumHoldPeriodMonths: 24,
  },
];

// ─── STARTUP DEALS ────────────────────────────────────────────────────────────
const STARTUP_DEALS = [
  {
    companyName: "PayStack Pro", tagline: "Next-gen payment infrastructure for African businesses",
    description: "Building the next layer of payment infrastructure on top of existing rails. Our API processes $2B+ annually and serves 60,000+ businesses across 10 African markets. Raising to expand to East Africa and launch embedded finance products.",
    sector: "Fintech", stage: "Series B", location: "Lagos, Nigeria", foundedYear: 2019, teamSize: 120,
    targetRaiseUsd: "10000000", raisedSoFarUsd: "6500000", minimumTicketUsd: "5000",
    valuationUsd: "150000000", equityOfferedPct: "6.67", instrumentType: "Equity",
    status: "open", isFeatured: true, isVerified: true,
    highlights: JSON.stringify(["$2B+ annual payment volume", "60,000+ business customers", "Operating in 10 countries", "Profitable since 2022"]),
    risks: JSON.stringify(["Regulatory risk in new markets", "Competition from global players", "FX volatility"]),
    metrics: JSON.stringify([{label: "ARR", value: "$18M"}, {label: "MoM Growth", value: "12%"}, {label: "NPS", value: "72"}]),
    closingDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  },
  {
    companyName: "FarmDirect Nigeria", tagline: "Connecting smallholder farmers to premium markets",
    description: "Agritech marketplace connecting 50,000+ smallholder farmers directly to supermarkets, restaurants, and exporters. We eliminate 4 layers of middlemen, increasing farmer income by 40% while reducing food costs for buyers by 25%.",
    sector: "Agritech", stage: "Series A", location: "Ibadan, Nigeria", foundedYear: 2020, teamSize: 45,
    targetRaiseUsd: "3000000", raisedSoFarUsd: "1800000", minimumTicketUsd: "2500",
    valuationUsd: "25000000", equityOfferedPct: "12.0", instrumentType: "SAFE",
    status: "open", isFeatured: true, isVerified: true,
    highlights: JSON.stringify(["50,000+ registered farmers", "₦8B GMV in 2024", "40% farmer income increase", "Backed by USAID"]),
    risks: JSON.stringify(["Weather/climate risk", "Logistics infrastructure gaps", "Farmer digital literacy"]),
    metrics: JSON.stringify([{label: "GMV 2024", value: "₦8B"}, {label: "Farmers", value: "50,000+"}, {label: "Buyers", value: "2,400+"}]),
    closingDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
  },
  {
    companyName: "HealthBridge Africa", tagline: "Telemedicine and health insurance for the unbanked",
    description: "Combining telemedicine, pharmacy delivery, and micro health insurance into one app. Serving 200,000+ patients across Nigeria. Our NHIS-approved plans start at ₦500/month and cover outpatient, inpatient, and maternity care.",
    sector: "Healthtech", stage: "Pre-Series A", location: "Lagos, Nigeria", foundedYear: 2021, teamSize: 32,
    targetRaiseUsd: "2000000", raisedSoFarUsd: "800000", minimumTicketUsd: "1000",
    valuationUsd: "12000000", equityOfferedPct: "16.67", instrumentType: "SAFE",
    status: "open", isFeatured: false, isVerified: true,
    highlights: JSON.stringify(["200,000+ registered patients", "NHIS approved", "₦500/month insurance plans", "48-hour pharmacy delivery"]),
    risks: JSON.stringify(["Healthcare regulation complexity", "Doctor supply constraints", "Insurance claims management"]),
    metrics: JSON.stringify([{label: "Patients", value: "200K+"}, {label: "MoM Growth", value: "18%"}, {label: "CAC", value: "$2.40"}]),
    closingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  {
    companyName: "LogiTrack NG", tagline: "Last-mile logistics intelligence for e-commerce",
    description: "AI-powered logistics platform optimizing last-mile delivery for e-commerce in Nigeria. Our route optimization reduces delivery costs by 35% and improves on-time delivery from 62% to 94%. Serving Jumia, Konga, and 800+ SME merchants.",
    sector: "Logistics", stage: "Seed", location: "Lagos, Nigeria", foundedYear: 2022, teamSize: 18,
    targetRaiseUsd: "1000000", raisedSoFarUsd: "650000", minimumTicketUsd: "1000",
    valuationUsd: "6000000", equityOfferedPct: "16.67", instrumentType: "SAFE",
    status: "open", isFeatured: false, isVerified: true,
    highlights: JSON.stringify(["35% cost reduction", "94% on-time delivery", "800+ merchant clients", "Jumia & Konga integration"]),
    risks: JSON.stringify(["Traffic and infrastructure challenges", "Rider retention", "Fuel price volatility"]),
    metrics: JSON.stringify([{label: "Deliveries/Day", value: "12,000"}, {label: "Revenue MRR", value: "$85K"}, {label: "Gross Margin", value: "42%"}]),
    closingDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  },
  {
    companyName: "EduAfrika", tagline: "Vocational training and job placement for African youth",
    description: "Online and offline vocational training platform with guaranteed job placement. 15,000+ graduates placed in tech, trades, and services roles. Our income-share agreement model means students pay nothing upfront — we earn when they earn.",
    sector: "Edtech", stage: "Series A", location: "Abuja, Nigeria", foundedYear: 2020, teamSize: 55,
    targetRaiseUsd: "4000000", raisedSoFarUsd: "2200000", minimumTicketUsd: "2500",
    valuationUsd: "30000000", equityOfferedPct: "13.33", instrumentType: "Equity",
    status: "open", isFeatured: true, isVerified: true,
    highlights: JSON.stringify(["15,000+ job placements", "92% placement rate", "ISA model — no upfront cost", "Government MOU in 3 states"]),
    risks: JSON.stringify(["ISA collection risk", "Employer relationship dependency", "Curriculum relevance"]),
    metrics: JSON.stringify([{label: "Graduates Placed", value: "15,000+"}, {label: "Placement Rate", value: "92%"}, {label: "Avg Salary", value: "₦180K/mo"}]),
    closingDate: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000),
  },
  {
    companyName: "SolarPay Nigeria", tagline: "Pay-as-you-go solar energy for off-grid communities",
    description: "Providing affordable solar home systems to 500,000+ off-grid households via PAYG mobile money. Our IoT-enabled systems can be remotely managed and financed over 24 months. Backed by Shell Foundation and GSMA.",
    sector: "Cleantech", stage: "Growth", location: "Kano, Nigeria", foundedYear: 2018, teamSize: 180,
    targetRaiseUsd: "15000000", raisedSoFarUsd: "9000000", minimumTicketUsd: "10000",
    valuationUsd: "80000000", equityOfferedPct: "18.75", instrumentType: "Equity",
    status: "open", isFeatured: true, isVerified: true,
    highlights: JSON.stringify(["500,000+ households served", "Shell Foundation backed", "24-month PAYG financing", "Carbon credits revenue"]),
    risks: JSON.stringify(["FX risk on hardware imports", "Customer default rates", "Grid extension competition"]),
    metrics: JSON.stringify([{label: "Households", value: "500K+"}, {label: "Revenue 2024", value: "$12M"}, {label: "Default Rate", value: "3.2%"}]),
    closingDate: new Date(Date.now() + 75 * 24 * 60 * 60 * 1000),
  },
];

async function seed() {
  console.log("🌱 Seeding v74 investment data...\n");

  // ── NGX Stocks ──
  let stockCount = 0;
  for (const stock of NGX_STOCKS) {
    try {
      await query(
        `INSERT INTO ngx_stocks (ticker, name, sector, exchange, current_price_ngn, market_cap_ngn, pe_ratio, dividend_yield, week_52_high, week_52_low, description, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (ticker) DO UPDATE SET
           current_price_ngn = EXCLUDED.current_price_ngn,
           market_cap_ngn = EXCLUDED.market_cap_ngn,
           last_updated = NOW()`,
        [stock.symbol, stock.name, stock.sector, stock.exchange, stock.currentPriceNgn, stock.marketCapNgn, stock.peRatio, stock.dividendYieldPct, stock.weekHigh52Ngn, stock.weekLow52Ngn, stock.description, stock.isActive]
      );
      stockCount++;
    } catch (e) {
      console.warn(`  ⚠ Stock ${stock.symbol}: ${e.message}`);
    }
  }
  console.log(`✅ NGX Stocks: ${stockCount}/${NGX_STOCKS.length} seeded`);

  // ── Real Estate Listings ──
  let reCount = 0;
  for (const listing of REAL_ESTATE_LISTINGS) {
    try {
      // Use total_value_ngn = total_value_usd * 1600 (approx NGN rate), minimum_investment_usd = price_per_share_usd
      const totalValueNgn = (parseFloat(listing.totalValueUsd) * 1600).toFixed(2);
      await query(
        `INSERT INTO real_estate_listings (title, city, state, location, property_type, total_value_usd, total_value_ngn, price_per_share_usd, minimum_investment_usd, total_shares, available_shares, rental_yield_pct, appreciation_pct, description, image_urls, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT DO NOTHING`,
        [listing.title, listing.city, listing.state, `${listing.city}, Nigeria`, listing.propertyType, listing.totalValueUsd, totalValueNgn, listing.pricePerShareUsd, listing.pricePerShareUsd, listing.totalShares, listing.availableShares, listing.rentalYieldPct, listing.projectedAppreciationPct, listing.description, listing.imageUrls, listing.status]
      );
      reCount++;
    } catch (e) {
      console.warn(`  ⚠ Listing "${listing.title}": ${e.message}`);
    }
  }
  console.log(`✅ Real Estate Listings: ${reCount}/${REAL_ESTATE_LISTINGS.length} seeded`);

  // ── Startup Deals ──
  let sdCount = 0;
  for (const deal of STARTUP_DEALS) {
    try {
      await query(
        `INSERT INTO startup_deals (company_name, tagline, description, sector, stage, location, founded_year, team_size, target_raise_usd, raised_so_far_usd, minimum_ticket_usd, valuation_usd, equity_offered_pct, instrument_type, status, is_featured, is_verified, highlights, risks, metrics, closing_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT DO NOTHING`,
        [deal.companyName, deal.tagline, deal.description, deal.sector, deal.stage, deal.location, deal.foundedYear, deal.teamSize, deal.targetRaiseUsd, deal.raisedSoFarUsd, deal.minimumTicketUsd, deal.valuationUsd, deal.equityOfferedPct, deal.instrumentType, deal.status, deal.isFeatured, deal.isVerified, deal.highlights, deal.risks, deal.metrics, deal.closingDate]
      );
      sdCount++;
    } catch (e) {
      console.warn(`  ⚠ Deal "${deal.companyName}": ${e.message}`);
    }
  }
  console.log(`✅ Startup Deals: ${sdCount}/${STARTUP_DEALS.length} seeded`);

  const total = stockCount + reCount + sdCount;
  console.log(`\n🎉 Total: ${total} investment records seeded`);
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
