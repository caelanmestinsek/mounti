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

// ── Cache ─────────────────────────────────────────────────────────────
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

// ── Exchange helpers ──────────────────────────────────────────────────
function getExchange(symbol) {
  if (symbol.endsWith('.TO')) return 'TSX';
  if (symbol.endsWith('.V'))  return 'TSXV';
  return null;
}

function isCanadian(symbol) {
  return symbol.endsWith('.TO') || symbol.endsWith('.V');
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
  if (!q?.symbol || !isCanadian(q.symbol)) return null;
  return {
    ticker:             q.symbol,
    name:               q.longName || q.shortName || q.symbol,
    exchange:           getExchange(q.symbol),
    sector:             q.sector   || 'Unknown',
    industry:           q.industry || q.sectorKey || 'Unknown',
    marketCap:          q.marketCap ?? null,
    marketCapFormatted: formatMarketCap(q.marketCap),
    marketCapBand:      getMarketCapBand(q.marketCap),
    price:              q.regularMarketPrice ?? null,
    change:             q.regularMarketChangePercent ?? null,
    currency:           q.currency || 'CAD',
  };
}

// ── Screener fetch ────────────────────────────────────────────────────
// Run multiple pages (offset 0, 250, 500 …) with both DESC and ASC market
// cap sorts so we capture large-caps AND microcaps in the same sweep.
const CA_QUERY = {
  operator: 'and',
  operands: [{ operator: 'EQ', operands: ['region', 'ca'] }],
};

async function fetchCanadianPage(offset, sortType) {
  try {
    const result = await yahooFinance.screener(
      {
        query:     CA_QUERY,
        count:     250,
        offset,
        sortField: 'intradaymarketcap',
        sortType,
      },
      {},
      { validateResult: false }
    );
    return result?.quotes ?? [];
  } catch (e) {
    console.warn(`  Screener page offset=${offset} sortType=${sortType} failed:`, e.message);
    return [];
  }
}

async function fetchAllCanadianStocks() {
  // Fetch pages in parallel: top-N by market cap (DESC) and bottom-N (ASC)
  // to maximise coverage across the full cap spectrum.
  const pages = [
    fetchCanadianPage(0,   'DESC'),
    fetchCanadianPage(250, 'DESC'),
    fetchCanadianPage(500, 'DESC'),
    fetchCanadianPage(750, 'DESC'),
    fetchCanadianPage(0,   'ASC'),   // smallest caps first
    fetchCanadianPage(250, 'ASC'),
    fetchCanadianPage(500, 'ASC'),
  ];

  const settled = await Promise.allSettled(pages);
  const seen = new Set();
  const stocks = [];

  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const q of r.value) {
      if (!q?.symbol || !isCanadian(q.symbol) || seen.has(q.symbol)) continue;
      seen.add(q.symbol);
      const norm = normalizeQuote(q);
      if (norm?.price) stocks.push(norm);
    }
  }

  console.log(`  Found ${stocks.length} TSX/TSXV stocks`);
  return stocks;
}

// ── Routes ────────────────────────────────────────────────────────────

app.get('/api/stocks', async (req, res) => {
  try {
    let stocks = getCached('all_stocks');
    if (!stocks) {
      console.log('Fetching fresh TSX/TSXV data…');
      stocks = await fetchAllCanadianStocks();
      setCache('all_stocks', stocks);
    }

    const { exchange, industry, marketCapBand } = req.query;
    let filtered = stocks;
    if (exchange     && exchange !== 'all')       filtered = filtered.filter(s => s.exchange === exchange);
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
      stocks = await fetchAllCanadianStocks();
      setCache('all_stocks', stocks);
    }

    const industries = [...new Set(stocks.map(s => s.industry).filter(i => i && i !== 'Unknown'))].sort();

    // Exchange → industry map for cascading dropdown
    const exchangeIndustryMap = {};
    for (const s of stocks) {
      if (!s.exchange) continue;
      if (!exchangeIndustryMap[s.exchange]) exchangeIndustryMap[s.exchange] = new Set();
      if (s.industry && s.industry !== 'Unknown') exchangeIndustryMap[s.exchange].add(s.industry);
    }
    for (const ex of Object.keys(exchangeIndustryMap)) {
      exchangeIndustryMap[ex] = [...exchangeIndustryMap[ex]].sort();
    }

    res.json({
      exchanges: ['TSX', 'TSXV'],
      industries,
      exchangeIndustryMap,
      marketCapBands: ['Mega', 'Large', 'Mid', 'Small', 'Micro'],
    });
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
  console.log(`\n  Mounti (TSX/TSXV) running → http://localhost:${PORT}\n`);
});
