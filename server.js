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

// ── Ticker lists ──────────────────────────────────────────────────────
// TSX (.TO) — broad coverage across all sectors
const TSX_TICKERS = [
  // Financials
  'RY.TO','TD.TO','BNS.TO','BMO.TO','CM.TO','NA.TO',
  'MFC.TO','SLF.TO','GWO.TO','IFC.TO','FFH.TO','IAG.TO','POW.TO','EQB.TO',
  // Energy
  'ENB.TO','TRP.TO','SU.TO','CNQ.TO','CVE.TO','IMO.TO','PPL.TO','KEY.TO',
  'VET.TO','BTE.TO','ARC.TO','ERF.TO','PEY.TO','MEG.TO','CPG.TO','TVE.TO',
  'BIR.TO','GTE.TO','FRU.TO','TPZ.TO','WCP.TO','PXT.TO','PKI.TO','TOG.TO',
  'TOU.TO','ARX.TO','NVA.TO','PEY.TO','CR.TO','HWX.TO',
  // Materials / Mining
  'ABX.TO','AEM.TO','K.TO','WPM.TO','FM.TO','LUN.TO','HBM.TO','PAAS.TO',
  'DPM.TO','OGC.TO','EDV.TO','TXG.TO','MAG.TO','OR.TO','SSL.TO','GGD.TO',
  'ERO.TO','NGT.TO','MUX.TO','TECK-B.TO','CS.TO','AGI.TO','CG.TO','IMG.TO',
  'CIA.TO','MND.TO','IAG.TO','KNT.TO','SVM.TO','ELD.TO','AR.TO','AMK.TO',
  'SMT.TO','WDO.TO','GCM.TO','CEE.TO','LGD.TO','ATY.TO',
  // Technology
  'SHOP.TO','CSU.TO','BB.TO','OTEX.TO','DSG.TO','DND.TO','LSPD.TO',
  'KXS.TO','TOI.TO','NVEI.TO','DCBO.TO','CWAN.TO','ALYA.TO','TIXT.TO',
  'THNC.TO','GSOL.TO','CLIQ.TO',
  // Industrials
  'CNR.TO','CP.TO','CAE.TO','MG.TO','TIH.TO','WSP.TO','STN.TO',
  'AC.TO','CJT.TO','CHR.TO','TFII.TO','SIS.TO','NFI.TO','ATA.TO',
  'BYD.TO','RBA.TO','LNR.TO','WTE.TO','EIF.TO',
  // Consumer
  'ATD.TO','L.TO','MRU.TO','DOL.TO','EMP-A.TO','CTC-A.TO','GIL.TO',
  'GOOS.TO','QSR.TO','BPF-UN.TO','PZA.TO','MTY.TO','RECP.TO',
  'SVI.TO','JWEL.TO','ZZZ.TO','ACB.TO','TLRY.TO',
  // Telecom / Media
  'BCE.TO','T.TO','RCI-B.TO','QBR-B.TO','SJR-B.TO','MBT.TO','FSV.TO',
  // REITs
  'REI-UN.TO','CAR-UN.TO','HR-UN.TO','D-UN.TO','AP-UN.TO','SRU-UN.TO',
  'NWH-UN.TO','DIR-UN.TO','GRT-UN.TO','CHP-UN.TO','SMU-UN.TO','BTB-UN.TO',
  'IIP-UN.TO','PRV-UN.TO','WIR-U.TO','CSH-UN.TO','MRT-UN.TO','PMZ-UN.TO',
  // Utilities
  'FTS.TO','EMA.TO','H.TO','AQN.TO','NPI.TO','CPX.TO','TA.TO','INE.TO',
  'BLX.TO','ACO-X.TO','ATCO.TO','CU.TO','ALA.TO','RNW.TO','ACXT.TO',
  // Healthcare
  'WELL.TO','CXR.TO','TRIL.TO','CRDL.TO','ZYME.TO','BHC.TO','NUVB.TO',
  // Agriculture / Chemicals
  'NTR.TO','AGT.TO','WN.TO','MFI.TO',
  // Asset Management / Diversified
  'BAM.TO','X.TO','BN.TO','AGF-B.TO','IGM.TO','CIX.TO','GS.TO',
];

// TSXV (.V) — junior miners, explorers, small-cap tech, cannabis
const TSXV_TICKERS = [
  // Junior miners / explorers
  'AAB.V','ABE.V','AME.V','ARE.V','AEI.V','AFM.V','ATW.V','AVL.V',
  'AZM.V','BCM.V','BHS.V','BNR.V','BTT.V','BYN.V','CAD.V','CBR.V',
  'CCW.V','CDV.V','CEI.V','CFW.V','CGT.V','CHW.V','CKG.V','CLD.V',
  'CLM.V','CMC.V','CNC.V','CPN.V','CPY.V','CRB.V','CRS.V','CSO.V',
  'CTF.V','CXX.V','DGO.V','DLP.V','DMX.V','DRL.V','DSV.V','EDE.V',
  'EGD.V','EKG.V','ELM.V','EMX.V','ENW.V','EPO.V','ERD.V','ESK.V',
  'ETG.V','EXS.V','FAR.V','FEX.V','FG.V','FGD.V','FIL.V','FKM.V',
  'FLX.V','FOM.V','FRA.V','FRG.V','FSY.V','FTG.V','FVI.V','GAU.V',
  'GBR.V','GCX.V','GGI.V','GGM.V','GLD.V','GMA.V','GMR.V','GNS.V',
  'GOG.V','GOT.V','GRG.V','GRI.V','GRO.V','GSI.V','GSX.V','GTE.V',
  'GTT.V','GUY.V','GWA.V','HAC.V','HCX.V','HDI.V','HEO.V','HGN.V',
  'HIO.V','HIT.V','HMX.V','HPX.V','HRT.V','HSM.V','HTM.V','HZM.V',
  'IAU.V','ICG.V','IEX.V','IFC.V','IGA.V','IGO.V','IMA.V','IMC.V',
  'IMG.V','IMN.V','ION.V','IPT.V','IRL.V','IRV.V','ITR.V','IVN.V',
  'JAG.V','JDN.V','JEM.V','JNC.V','JPR.V','JZR.V',
  'KAG.V','KAM.V','KDX.V','KEI.V','KGC.V','KGS.V','KLR.V','KLX.V',
  'KNT.V','KOR.V','KRL.V','KTN.V','KUB.V','KWG.V',
  'LAB.V','LAG.V','LAR.V','LBC.V','LGC.V','LIO.V','LLG.V','LMA.V',
  'LME.V','LNF.V','LOM.V','LPK.V','LRC.V','LSG.V','LUN.V','LVL.V',
  'MAI.V','MAK.V','MAO.V','MAR.V','MAX.V','MBX.V','MCC.V','MCG.V',
  'MCK.V','MCM.V','MDS.V','MDX.V','MES.V','MFC.V','MGM.V','MGX.V',
  'MHM.V','MIC.V','MIN.V','MJX.V','MKO.V','MLX.V','MMG.V','MNC.V',
  // Small-cap tech / cannabis
  'HUGE.V','APHA.V','FIRE.V','NTAR.V','CRON.V','ACB.V','HITI.V',
  'XLY.V','HERB.V','LABS.V','BAMM.V',
  'TPVG.V','GABY.V','HARV.V','KERN.V','PHOT.V',
  // Oil & gas juniors
  'PEI.V','TOL.V','NGL.V','GXO.V','ZEN.V','BRY.V','MXG.V','OBE.V',
  'SPE.V','GUS.V','ROK.V','JOY.V','PSD.V','OIL.V',
];

const ALL_TICKERS = [...new Set([...TSX_TICKERS, ...TSXV_TICKERS])];

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

// ── Batch quote fetch ─────────────────────────────────────────────────
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

async function fetchAllCanadianStocks() {
  console.log(`  Fetching ${ALL_TICKERS.length} TSX/TSXV tickers…`);
  const quotes = await fetchQuotesBatch(ALL_TICKERS);
  const stocks = quotes.map(normalizeQuote).filter(s => s?.price);
  console.log(`  Got data for ${stocks.length} stocks`);
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
    if (exchange      && exchange !== 'all')      filtered = filtered.filter(s => s.exchange === exchange);
    if (industry      && industry !== 'all')      filtered = filtered.filter(s => s.industry === industry);
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
