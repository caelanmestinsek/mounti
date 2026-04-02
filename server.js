import express from 'express';
import YahooFinance from 'yahoo-finance2';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// yahoo-finance2 exports the class; instantiate a singleton
const yahooFinance = new YahooFinance();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Broad ticker list spanning countries, sectors, and market cap sizes
const DEFAULT_TICKERS = [
  // US – Technology
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'ORCL', 'ADBE', 'CRM',
  'INTC', 'AMD', 'QCOM', 'CSCO', 'IBM', 'TXN', 'AVGO', 'NOW', 'SNOW', 'PLTR',
  // US – Finance
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'BLK', 'C', 'AXP', 'V', 'MA',
  // US – Healthcare
  'JNJ', 'PFE', 'UNH', 'ABBV', 'MRK', 'LLY', 'TMO', 'DHR', 'BMY', 'AMGN',
  // US – Consumer
  'WMT', 'PG', 'KO', 'PEP', 'MCD', 'SBUCKS', 'NKE', 'DIS', 'NFLX', 'COST',
  // US – Energy & Industrials
  'XOM', 'CVX', 'COP', 'CAT', 'BA', 'GE', 'HON', 'MMM', 'UPS', 'FDX',
  // US – Mid/Small cap tech
  'ROKU', 'DOCU', 'TWLO', 'DDOG', 'NET', 'CRWD', 'ZS', 'OKTA',
  'UBER', 'LYFT', 'ABNB', 'DASH', 'COIN', 'SQ', 'PYPL',
  'ETSY', 'EBAY', 'CHWY',
  'ZM', 'TEAM', 'MDB',
  'RKLB', 'GME', 'F', 'GM', 'RIVN', 'LCID',
  // UK
  'SHEL', 'AZN', 'HSBC', 'BP', 'GSK', 'RIO',
  // Europe (US-listed ADRs / tickers)
  'ASML', 'SAP', 'NVO', 'TTE',
  // Japan
  '7203.T', '6758.T', '9984.T',
  // China / HK ADRs
  'BABA', 'TCEHY', 'JD', 'BIDU', 'NIO', 'PDD',
  // Canada
  'SHOP', 'ENB',
  // India ADRs
  'INFY', 'WIT', 'HDB', 'IBN',
  // Brazil
  'VALE', 'PBR', 'ITUB',
  // Taiwan
  'TSM',
];

const TICKERS = [...new Set(DEFAULT_TICKERS)];

// Fetch quotes in batches to avoid rate-limiting
async function fetchQuotesBatch(tickers, batchSize = 15) {
  const results = [];
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(ticker =>
        yahooFinance.quote(ticker, {}, { validateResult: false }).catch(() => null)
      )
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

function formatMarketCap(value) {
  if (value == null) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

function getMarketCapBand(value) {
  if (value == null) return 'Unknown';
  if (value > 200e9)  return 'Mega';
  if (value >= 10e9)  return 'Large';
  if (value >= 2e9)   return 'Mid';
  if (value >= 300e6) return 'Small';
  return 'Micro';
}

function normalizeQuote(q) {
  return {
    ticker:            q.symbol,
    name:              q.longName || q.shortName || q.symbol,
    country:           q.country   || 'Unknown',
    exchange:          q.exchange  || '',
    sector:            q.sector    || 'Unknown',
    industry:          q.industry  || 'Unknown',
    marketCap:         q.marketCap ?? null,
    marketCapFormatted: formatMarketCap(q.marketCap),
    marketCapBand:     getMarketCapBand(q.marketCap),
    price:             q.regularMarketPrice ?? null,
    change:            q.regularMarketChangePercent ?? null,
    currency:          q.currency || 'USD',
  };
}

// ── Routes ──────────────────────────────────────────────────────────

// GET /api/stocks — returns stocks, applying optional query filters
app.get('/api/stocks', async (req, res) => {
  try {
    let stocks = getCached('all_stocks');
    if (!stocks) {
      console.log('Fetching fresh stock data…');
      const quotes = await fetchQuotesBatch(TICKERS);
      stocks = quotes.filter(q => q?.regularMarketPrice).map(normalizeQuote);
      setCache('all_stocks', stocks);
      console.log(`Cached ${stocks.length} stocks`);
    }

    const { country, industry, marketCapBand } = req.query;
    let filtered = stocks;
    if (country      && country !== 'all')       filtered = filtered.filter(s => s.country === country);
    if (industry     && industry !== 'all')      filtered = filtered.filter(s => s.industry === industry);
    if (marketCapBand && marketCapBand !== 'all') filtered = filtered.filter(s => s.marketCapBand === marketCapBand);

    res.json({ stocks: filtered, total: filtered.length });
  } catch (err) {
    console.error('Error in /api/stocks:', err);
    res.status(500).json({ error: 'Failed to fetch stock data', message: err.message });
  }
});

// GET /api/filters — returns available dropdown options
app.get('/api/filters', async (req, res) => {
  try {
    let stocks = getCached('all_stocks');
    if (!stocks) {
      const quotes = await fetchQuotesBatch(TICKERS);
      stocks = quotes.filter(q => q?.regularMarketPrice).map(normalizeQuote);
      setCache('all_stocks', stocks);
    }

    const countries = [...new Set(stocks.map(s => s.country).filter(c => c && c !== 'Unknown'))].sort();
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

// POST /api/refresh — clears cache
app.post('/api/refresh', (_req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared' });
});

app.listen(PORT, () => {
  console.log(`\n  Mounti running → http://localhost:${PORT}\n`);
});
