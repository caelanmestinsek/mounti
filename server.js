import express from 'express';
import YahooFinance from 'yahoo-finance2';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Cache ────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ── Screener presets ─────────────────────────────────────────────────
// These cover a wide range of market caps, sectors, and activity levels.
// aggressive_small_caps and small_cap_gainers are the key ones for microcap.
const SCREENER_PRESETS = [
  'most_actives',
  'day_gainers',
  'day_losers',
  'small_cap_gainers',
  'aggressive_small_caps',
  'undervalued_growth_stocks',
  'growth_technology_stocks',
  'undervalued_large_caps',
  'most_shorted_stocks',
];

// Fallback hardcoded tickers (always included even if screeners fail)
const SEED_TICKERS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','ORCL','ADBE','CRM',
  'INTC','AMD','QCOM','CSCO','IBM','TXN','AVGO','NOW','SNOW','PLTR',
  'JPM','BAC','WFC','GS','MS','BLK','C','AXP','V','MA',
  'JNJ','PFE','UNH','ABBV','MRK','LLY','TMO','DHR','BMY','AMGN',
  'WMT','PG','KO','PEP','MCD','NKE','DIS','NFLX','COST','SBUX',
  'XOM','CVX','COP','CAT','BA','GE','HON','MMM','UPS','FDX',
  'ROKU','DOCU','TWLO','DDOG','NET','CRWD','ZS','OKTA',
  'UBER','LYFT','ABNB','DASH','COIN','SQ','PYPL',
  'ETSY','EBAY','CHWY','ZM','TEAM','MDB','RKLB',
  'GME','F','GM','RIVN','LCID',
  'SHEL','AZN','HSBC','BP','GSK','RIO',
  'ASML','SAP','NVO','TTE',
  'BABA','TCEHY','JD','BIDU','NIO','PDD',
  'SHOP','ENB','INFY','WIT','HDB','IBN','VALE','PBR','ITUB','TSM',
];

// ── Country inference from exchange ──────────────────────────────────
const EXCHANGE_COUNTRY = {
  NMS: 'United States', NYQ: 'United States', NGM: 'United States',
  NCM: 'United States', PCX: 'United States', ASE: 'United States',
  PNK: 'United States', OBB: 'United States',
  LSE: 'United Kingdom', IOB: 'United Kingdom',
  TOR: 'Canada', VAN: 'Canada', CNQ: 'Canada',
  TSE: 'Japan', OSA: 'Japan',
  HKG: 'Hong Kong', HSI: 'Hong Kong',
  SHH: 'China', SHZ: 'China',
  FRA: 'Germany', GER: 'Germany', STU: 'Germany',
  PAR: 'France', EPA: 'France',
  AMS: 'Netherlands',
  STO: 'Sweden',
  ASX: 'Australia',
  BSE: 'India', NSI: 'India',
  KSC: 'South Korea', KOE: 'South Korea',
  SAO: 'Brazil',
  TAI: 'Taiwan', TWO: 'Taiwan',
  SWX: 'Switzerland',
};

function inferCountry(q) {
  if (q.country) return q.country;
  if (q.exchange && EXCHANGE_COUNTRY[q.exchange]) return EXCHANGE_COUNTRY[q.exchange];
  // Most Yahoo screener results without explicit country are US-listed
  if (q.quoteType === 'EQUITY' && q.market === 'us_market') return 'United States';
  return 'Unknown';
}

// ── Normalise ─────────────────────────────────────────────────────────
function formatMarketCap(v) {
  if (v == null) return null;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

function getMarketCapBand(v) {
  if (v == null) return 'Unknown';
  if (v > 200e9)  return 'Mega';
  if (v >= 10e9)  return 'Large';
  if (v >= 2e9)   return 'Mid';
  if (v >= 300e6) return 'Small';
  return 'Micro';
}

function normalizeQuote(q) {
  if (!q || !q.symbol) return null;
  return {
    ticker:            q.symbol,
    name:              q.longName || q.shortName || q.symbol,
    country:           inferCountry(q),
    exchange:          q.exchange  || '',
    sector:            q.sector    || 'Unknown',
    industry:          q.industry  || q.sectorKey || 'Unknown',
    marketCap:         q.marketCap ?? null,
    marketCapFormatted: formatMarketCap(q.marketCap),
    marketCapBand:     getMarketCapBand(q.marketCap),
    price:             q.regularMarketPrice ?? null,
    change:            q.regularMarketChangePercent ?? null,
    currency:          q.currency || 'USD',
  };
}

// ── Screener fetch ────────────────────────────────────────────────────
async function fetchFromScreeners() {
  const seen = new Set();
  const stocks = [];

  const results = await Promise.allSettled(
    SCREENER_PRESETS.map(preset =>
      yahooFinance.screener(preset, { count: 250 }, { validateResult: false })
        .catch(e => { console.warn(`Screener "${preset}" error:`, e.message); return null; })
    )
  );

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.quotes) continue;
    for (const q of r.value.quotes) {
      if (!q?.symbol || !q.regularMarketPrice || seen.has(q.symbol)) continue;
      seen.add(q.symbol);
      stocks.push(q);
    }
  }

  console.log(`  Screeners returned ${stocks.length} unique stocks`);
  return { stocks, seen };
}

// ── Quote batch fetch (for seed tickers not in screener results) ───────
async function fetchQuotesBatch(tickers, batchSize = 20) {
  const results = [];
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(t => yahooFinance.quote(t, {}, { validateResult: false }).catch(() => null))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.regularMarketPrice) results.push(r.value);
    }
  }
  return results;
}

// ── Main data fetch ───────────────────────────────────────────────────
async function fetchAllStocks() {
  // 1. Dynamic screener results
  const { stocks: screenerStocks, seen } = await fetchFromScreeners();

  // 2. Seed tickers not already covered by screeners
  const missing = SEED_TICKERS.filter(t => !seen.has(t));
  console.log(`  Fetching ${missing.length} seed tickers not in screeners…`);
  const seedStocks = missing.length > 0 ? await fetchQuotesBatch(missing) : [];

  // 3. Combine and normalise
  const all = [...screenerStocks, ...seedStocks]
    .map(normalizeQuote)
    .filter(s => s && s.price);

  console.log(`  Total stocks after merge: ${all.length}`);
  return all;
}

// ── Routes ────────────────────────────────────────────────────────────

app.get('/api/stocks', async (req, res) => {
  try {
    let stocks = getCached('all_stocks');
    if (!stocks) {
      console.log('Fetching fresh stock data…');
      stocks = await fetchAllStocks();
      setCache('all_stocks', stocks);
    }

    const { country, industry, marketCapBand } = req.query;
    let filtered = stocks;
    if (country      && country !== 'all')        filtered = filtered.filter(s => s.country === country);
    if (industry     && industry !== 'all')       filtered = filtered.filter(s => s.industry === industry);
    if (marketCapBand && marketCapBand !== 'all') filtered = filtered.filter(s => s.marketCapBand === marketCapBand);

    res.json({ stocks: filtered, total: filtered.length });
  } catch (err) {
    console.error('Error in /api/stocks:', err);
    res.status(500).json({ error: 'Failed to fetch stock data', message: err.message });
  }
});

app.get('/api/filters', async (req, res) => {
  try {
    let stocks = getCached('all_stocks');
    if (!stocks) {
      stocks = await fetchAllStocks();
      setCache('all_stocks', stocks);
    }

    const countries  = [...new Set(stocks.map(s => s.country).filter(c => c && c !== 'Unknown'))].sort();
    const industries = [...new Set(stocks.map(s => s.industry).filter(i => i && i !== 'Unknown'))].sort();

    const countryIndustryMap = {};
    for (const s of stocks) {
      if (!s.country || s.country === 'Unknown') continue;
      if (!countryIndustryMap[s.country]) countryIndustryMap[s.country] = new Set();
      if (s.industry && s.industry !== 'Unknown') countryIndustryMap[s.country].add(s.industry);
    }
    for (const c of Object.keys(countryIndustryMap)) {
      countryIndustryMap[c] = [...countryIndustryMap[c]].sort();
    }

    res.json({ countries, industries, countryIndustryMap, marketCapBands: ['Mega', 'Large', 'Mid', 'Small', 'Micro'] });
  } catch (err) {
    console.error('Error in /api/filters:', err);
    res.status(500).json({ error: 'Failed to fetch filter options', message: err.message });
  }
});

app.post('/api/refresh', (_req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared' });
});

app.listen(PORT, () => {
  console.log(`\n  Mounti running → http://localhost:${PORT}\n`);
});
