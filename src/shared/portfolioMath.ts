import { AssetClass, Currency, Holding, PortfolioTargets } from '../types';
import { shortenAssetName } from '../lib/formatAssetName';
import { FX_FALLBACK_RATE, formatExactINR, getHoldingOwnerId } from './formatters';

export const DEBT_KEYWORDS_REGEX =
  /\b(arbitrage|liquid|liquidbees|liquidcase|overnight|money\s*market|ultra\s*short|low\s*duration|short\s*term\s*debt|short\s*duration|corporate\s*bond|gilt|banking\s*(?:and|&)\s*psu|dynamic\s*bond|floater|fixed\s*deposit|treasury|swvxx|snvxx|vmfxx|spaxx|sgov|usfr)\b/i;

export const DEFAULT_PORTFOLIO_TARGETS: PortfolioTargets = {
  assetSplit: { Equity: 0.85, Debt: 0.15 },
  equitySplit: { Indian: 0.6, Foreign: 0.4 },
  foreignBreakdown: [
    {
      name: 'Magnificent 7',
      percentage: 100,
      tickerWeights: [
        { ticker: 'AAPL', weight: 15 },
        { ticker: 'MSFT', weight: 15 },
        { ticker: 'GOOGL', weight: 15 },
        { ticker: 'AMZN', weight: 15 },
        { ticker: 'NVDA', weight: 15 },
        { ticker: 'META', weight: 15 },
        { ticker: 'TSLA', weight: 10 }
      ]
    }
  ]
};

/**
 * Unified holding asset-class & currency classifier shared by Client UI and Backend Server.
 * Preserves core household rules:
 *   - Arbitrage / Liquid / Overnight / Gilt / Money-Market funds -> 'Debt'
 *   - Qualcomm / QCOM -> Currency 'USD', AssetClass 'Equity'
 *   - .NS / .BO / NSE: / BSE: tickers -> Currency 'INR'
 */
export function normalizeHoldingClassification(raw: {
  ticker?: string;
  originalName?: string;
  assetClass?: string;
  currency?: string;
}): { assetClass: AssetClass; currency: Currency } {
  const ticker = (raw.ticker || '').trim();
  const name = (raw.originalName || '').trim();
  const combined = `${ticker} ${name}`;

  let currency: Currency = raw.currency === 'USD' ? 'USD' : 'INR';
  if (/\.(NS|BO|NSE|BSE)$/i.test(ticker) || /^(NSE|BSE):/i.test(ticker)) {
    currency = 'INR';
  }

  let assetClass: AssetClass =
    raw.assetClass === 'Debt'
      ? 'Debt'
      : raw.assetClass === 'Mutual Fund'
      ? 'Mutual Fund'
      : 'Equity';

  if (DEBT_KEYWORDS_REGEX.test(combined)) {
    assetClass = 'Debt';
  }

  if (/\b(qualcomm|qcom)\b/i.test(combined)) {
    currency = 'USD';
    assetClass = 'Equity';
  }

  return { assetClass, currency };
}

export interface ValuedHolding extends Holding {
  valINR: number;
  valUSD: number;
  isPlaceholder?: boolean;
}

export interface ComputedPortfolioStats {
  totalValINR: number;
  totalValUSD: number;
  equityValINR: number;
  debtValINR: number;
  indianEquityValINR: number;
  foreignEquityValINR: number;
  actualEquityPct: number;
  actualDebtPct: number;
  targetEquityPct: number;
  targetDebtPct: number;
  equityDrift: number;
  actualIndianEquityPctOfEquity: number;
  actualForeignEquityPctOfEquity: number;
  targetIndianEquityOfEquity: number;
  targetForeignEquityOfEquity: number;
  memberContributions: { id: string; name: string; value: number; percentage: number }[];
  foreignBreakdownStats: any[];
  providerBreakdown: Record<string, number>;
  topHoldingName: string;
  topHoldingPct: number;
  daysSinceSync: number | null;
  unmappedForeignCount: number;
  holdings: ValuedHolding[];
}

/**
 * Single O(H) pass portfolio valuation, member attribution, and foreign-bucket drift calculator.
 */
export function computePortfolioStats(params: {
  holdings: Holding[];
  targets?: PortfolioTargets | null;
  fxRate?: number;
  membersData?: { id: string; name: string }[];
  scope?: 'combined' | string;
  householdId?: string;
  includePlaceholders?: boolean;
}): ComputedPortfolioStats {
  const rate = params.fxRate && params.fxRate > 0 ? params.fxRate : FX_FALLBACK_RATE;
  const scope = params.scope || 'combined';
  const targets = params.targets || DEFAULT_PORTFOLIO_TARGETS;
  const membersData = params.membersData || [];

  const memberValueMap = new Map<string, number>();
  const providerBreakdown: Record<string, number> = {};
  const foreignByTickerValINR = new Map<string, number>();
  const existingTickers = new Set<string>();

  let totalValINR = 0;
  let equityValINR = 0;
  let debtValINR = 0;
  let indianEquityValINR = 0;
  let foreignEquityValINR = 0;
  let topHolding: ValuedHolding | null = null;
  let latestSyncTs = 0;

  const holdingsWithVal: ValuedHolding[] = [];

  for (const h of params.holdings) {
    const ownerId = getHoldingOwnerId(h);
    if (scope !== 'combined' && ownerId !== scope) continue;

    const { assetClass, currency } = normalizeHoldingClassification(h);
    const qty = Number(h.quantity) || 0;
    const price = Number(h.currentPrice) || 0;
    const rawVal = qty * price;
    const valINR = currency === 'USD' ? rawVal * rate : rawVal;
    const valUSD = currency === 'USD' ? rawVal : rawVal / rate;

    const enriched: ValuedHolding = {
      ...h,
      assetClass,
      currency,
      valINR,
      valUSD
    };
    holdingsWithVal.push(enriched);

    const upperTicker = (h.ticker || '').toUpperCase();
    if (upperTicker) existingTickers.add(upperTicker);

    totalValINR += valINR;
    if (ownerId) {
      memberValueMap.set(ownerId, (memberValueMap.get(ownerId) || 0) + valINR);
    }
    if (valINR > 0) {
      const prov = h.provider || 'Manual';
      providerBreakdown[prov] = (providerBreakdown[prov] || 0) + valINR;
      if (!topHolding || valINR > topHolding.valINR) {
        topHolding = enriched;
      }
    }

    const syncTs = Number(h.syncedAt || h.priceUpdatedAt || 0);
    if (syncTs > latestSyncTs) latestSyncTs = syncTs;

    if (assetClass === 'Debt') {
      debtValINR += valINR;
    } else {
      equityValINR += valINR;
      if (currency === 'USD') {
        foreignEquityValINR += valINR;
        if (upperTicker) {
          foreignByTickerValINR.set(upperTicker, (foreignByTickerValINR.get(upperTicker) || 0) + valINR);
        }
      } else {
        indianEquityValINR += valINR;
      }
    }
  }

  if (params.includePlaceholders && targets.foreignBreakdown) {
    const defaultOwner = scope === 'combined' ? (membersData[0]?.id || 'unknown') : scope;
    for (const cat of targets.foreignBreakdown) {
      for (const tw of cat.tickerWeights || []) {
        const up = (tw.ticker || '').toUpperCase();
        if (up && !existingTickers.has(up)) {
          holdingsWithVal.push({
            id: `placeholder-${up}`,
            userId: defaultOwner,
            householdId: params.householdId || '',
            ticker: up,
            originalName: up,
            quantity: 0,
            currentPrice: 0,
            assetClass: 'Equity',
            currency: 'USD',
            provider: 'Manual',
            source: 'Manual',
            valINR: 0,
            valUSD: 0,
            isPlaceholder: true
          });
          existingTickers.add(up);
        }
      }
    }
  }

  const totalValUSD = totalValINR / rate;
  const actualEquityPct = totalValINR > 0 ? equityValINR / totalValINR : 0;
  const actualDebtPct = totalValINR > 0 ? debtValINR / totalValINR : 0;

  const targetEquityPct = targets.assetSplit?.Equity ?? 0.7;
  const targetDebtPct = targets.assetSplit?.Debt ?? 0.3;
  const equityDrift = actualEquityPct - targetEquityPct;

  const actualIndianEquityPctOfEquity = equityValINR > 0 ? indianEquityValINR / equityValINR : 0;
  const actualForeignEquityPctOfEquity = equityValINR > 0 ? foreignEquityValINR / equityValINR : 0;

  // Unified default Indian Equity of Equity = 0.6 (eliminating client 0.5 vs server 0.6 mismatch)
  const targetIndianEquityOfEquity = targets.equitySplit?.Indian ?? 0.6;
  const targetForeignEquityOfEquity =
    targets.equitySplit?.Foreign ?? Math.max(0, 1 - targetIndianEquityOfEquity);

  const memberContributions = membersData
    .map((m) => {
      const value = memberValueMap.get(m.id) || 0;
      return {
        id: m.id,
        name: m.name,
        value,
        percentage: totalValINR > 0 ? value / totalValINR : 0
      };
    })
    .sort((a, b) => b.value - a.value);

  const mappedTickers = new Set<string>();
  const foreignBreakdownStats: any[] = (targets.foreignBreakdown || []).map((cat) => {
    let actualVal = 0;
    for (const tw of cat.tickerWeights || []) {
      const up = (tw.ticker || '').toUpperCase();
      if (!up) continue;
      mappedTickers.add(up);
      actualVal += foreignByTickerValINR.get(up) || 0;
    }
    const actualPctOfForeign = foreignEquityValINR > 0 ? actualVal / foreignEquityValINR : 0;
    const actualPctOfTotal = totalValINR > 0 ? actualVal / totalValINR : 0;
    return {
      ...cat,
      actualVal,
      actualPctOfForeign,
      actualPctOfTotal,
      drift: actualPctOfForeign - cat.percentage / 100
    };
  });

  let unmappedVal = 0;
  let unmappedForeignCount = 0;
  for (const [ticker, val] of foreignByTickerValINR.entries()) {
    if (!mappedTickers.has(ticker)) {
      unmappedVal += val;
      if (val > 0) unmappedForeignCount++;
    }
  }

  if (unmappedForeignCount > 0 || (unmappedVal > 0)) {
    foreignBreakdownStats.push({
      id: 'unmapped',
      name: 'Unmapped / Others',
      percentage: 0,
      actualVal: unmappedVal,
      actualPctOfForeign: foreignEquityValINR > 0 ? unmappedVal / foreignEquityValINR : 0,
      drift: foreignEquityValINR > 0 ? unmappedVal / foreignEquityValINR : 0,
      isUnmapped: true,
      tickerWeights: []
    });
  }

  const topHoldingPct = topHolding && totalValINR > 0 ? (topHolding.valINR / totalValINR) * 100 : 0;
  const daysSinceSync =
    latestSyncTs > 0 ? Math.floor((Date.now() - latestSyncTs) / (1000 * 60 * 60 * 24)) : null;

  return {
    totalValINR,
    totalValUSD,
    equityValINR,
    debtValINR,
    indianEquityValINR,
    foreignEquityValINR,
    actualEquityPct,
    actualDebtPct,
    targetEquityPct,
    targetDebtPct,
    equityDrift,
    actualIndianEquityPctOfEquity,
    actualForeignEquityPctOfEquity,
    targetIndianEquityOfEquity,
    targetForeignEquityOfEquity,
    memberContributions,
    foreignBreakdownStats,
    providerBreakdown,
    topHoldingName: topHolding ? shortenAssetName(topHolding.originalName || topHolding.ticker, topHolding.ticker) : '',
    topHoldingPct,
    daysSinceSync,
    unmappedForeignCount,
    holdings: holdingsWithVal
  };
}

export interface RebalanceOrderItem {
  title: string;
  description: string;
  type: 'buy' | 'sell';
  amount: string;
  amountRaw: number;
  category: string;
  isTickerLevel?: boolean;
}

/**
 * Shared hierarchical Full-Rebalance & Zero-Sell SIP order generator used by both Client UI and Email Alerts.
 */
export function computeRebalancePlan(params: {
  stats: ComputedPortfolioStats;
  fxRate?: number;
  freshInflowINR?: number;
}): {
  accuracy: number;
  suggestions: RebalanceOrderItem[];
  sipOrders: RebalanceOrderItem[];
  sipPostAccuracy: number;
} {
  const { stats } = params;
  const rate = params.fxRate && params.fxRate > 0 ? params.fxRate : FX_FALLBACK_RATE;
  const freshInflowINR = params.freshInflowINR ?? 150_000;

  const accuracy = Math.max(0, 100 - Math.abs(stats.equityDrift) * 100);
  const suggestions: RebalanceOrderItem[] = [];

  // Pre-index foreign USD values by ticker in O(H) instead of O(C * T * H)
  const usdValByTicker = new Map<string, number>();
  for (const h of stats.holdings) {
    if (h.currency === 'USD' && h.assetClass !== 'Debt') {
      const up = (h.ticker || '').toUpperCase();
      usdValByTicker.set(up, (usdValByTicker.get(up) || 0) + h.valINR);
    }
  }

  // 1. Asset Level
  const assetDriftAmt = stats.equityDrift * stats.totalValINR;
  if (Math.abs(assetDriftAmt) > 1000) {
    if (stats.equityDrift > 0) {
      suggestions.push({
        title: 'Equity to Debt Rebalance',
        description: `Total Equity is ${(stats.equityDrift * 100).toFixed(1)}% above your target.`,
        type: 'sell',
        amount: formatExactINR(assetDriftAmt),
        amountRaw: Math.abs(assetDriftAmt),
        category: 'Asset Allocation'
      });
    } else {
      suggestions.push({
        title: 'Debt to Equity Rebalance',
        description: `Total Equity is ${Math.abs(stats.equityDrift * 100).toFixed(1)}% below your target.`,
        type: 'buy',
        amount: formatExactINR(Math.abs(assetDriftAmt)),
        amountRaw: Math.abs(assetDriftAmt),
        category: 'Asset Allocation'
      });
    }
  }

  // 2. Geographic Split Level
  const foreignDriftOfEquity = stats.actualForeignEquityPctOfEquity - stats.targetForeignEquityOfEquity;
  const foreignDriftAmt = foreignDriftOfEquity * stats.equityValINR;
  if (Math.abs(foreignDriftAmt) > 1000) {
    if (foreignDriftOfEquity > 0) {
      suggestions.push({
        title: 'Shift Foreign to Indian Equity',
        description: `Foreign equity is ${(foreignDriftOfEquity * 100).toFixed(1)}% above its target split within your equity portfolio.`,
        type: 'sell',
        amount: formatExactINR(foreignDriftAmt),
        amountRaw: Math.abs(foreignDriftAmt),
        category: 'Geographic Allocation'
      });
    } else {
      suggestions.push({
        title: 'Shift Indian to Foreign Equity',
        description: `Foreign equity is ${Math.abs(foreignDriftOfEquity * 100).toFixed(1)}% below its target split within your equity portfolio.`,
        type: 'buy',
        amount: formatExactINR(Math.abs(foreignDriftAmt)),
        amountRaw: Math.abs(foreignDriftAmt),
        category: 'Geographic Allocation'
      });
    }
  }

  // 3. Foreign Theme & Ticker Level
  for (const cat of stats.foreignBreakdownStats) {
    const catDriftAmt = cat.drift * stats.foreignEquityValINR;
    if (Math.abs(catDriftAmt) > 1000) {
      const type: 'buy' | 'sell' = cat.drift > 0 ? 'sell' : 'buy';
      suggestions.push({
        title: `${type === 'sell' ? 'Trim' : 'Top up'} ${cat.name}`,
        description: `${cat.name} is ${Math.abs(cat.drift * 100).toFixed(1)}% ${type === 'sell' ? 'above' : 'below'} its target within Foreign Equity.`,
        type,
        amount: formatExactINR(Math.abs(catDriftAmt)),
        amountRaw: Math.abs(catDriftAmt),
        category: cat.name
      });

      if (Array.isArray(cat.tickerWeights) && cat.tickerWeights.length > 0) {
        const catGoalVal = stats.foreignEquityValINR * (cat.percentage / 100);
        for (const tw of cat.tickerWeights) {
          const up = (tw.ticker || '').toUpperCase();
          const tickerIdealVal = catGoalVal * (tw.weight / 100);
          const tickerActualVal = usdValByTicker.get(up) || 0;
          const tickerDrift = tickerActualVal - tickerIdealVal;
          if (Math.abs(tickerDrift) > 1000) {
            const tType: 'buy' | 'sell' = tickerDrift > 0 ? 'sell' : 'buy';
            suggestions.push({
              title: `${tType === 'sell' ? 'Sell' : 'Buy'} ${tw.ticker}`,
              description: `${tw.ticker} drift within ${cat.name}: ${formatExactINR(Math.abs(tickerDrift))}`,
              type: tType,
              amount: formatExactINR(Math.abs(tickerDrift)),
              amountRaw: Math.abs(tickerDrift),
              category: cat.name,
              isTickerLevel: true
            });
          }
        }
      }
    }
  }

  // Zero-Sell Monthly SIP / Fresh Inflow Routing
  const sipOrders: RebalanceOrderItem[] = [];
  let sipPostAccuracy = accuracy;

  if (freshInflowINR > 0) {
    const newTotal = stats.totalValINR + freshInflowINR;
    const targetIndEqShare = stats.targetEquityPct * stats.targetIndianEquityOfEquity;
    const targetForEqShare = stats.targetEquityPct * stats.targetForeignEquityOfEquity;
    const targetDebtShare = stats.targetDebtPct;

    const buckets = [
      {
        title: 'Invest in Indian Equity Mutual Funds / Index',
        category: 'Indian Equity',
        shortfall: Math.max(0, newTotal * targetIndEqShare - stats.indianEquityValINR),
        targetShare: targetIndEqShare,
        hint: 'Direct Growth Flexi-Cap / Nifty 50 SIP — zero capital gains tax'
      },
      {
        title: 'Invest in US / Global Equities',
        category: 'Foreign Equity',
        shortfall: Math.max(0, newTotal * targetForEqShare - stats.foreignEquityValINR),
        targetShare: targetForEqShare,
        hint: `Approx. $${Math.round(freshInflowINR / rate).toLocaleString('en-US')} capacity @ ₹${rate.toFixed(2)}`
      },
      {
        title: 'Allocate to Arbitrage / Liquid / Debt Funds',
        category: 'Debt & Cash',
        shortfall: Math.max(0, newTotal * targetDebtShare - stats.debtValINR),
        targetShare: targetDebtShare,
        hint: 'Arbitrage funds offer equity-like tax treatment for fixed-income bucket'
      }
    ];

    const sumShortfalls = buckets.reduce((s, b) => s + b.shortfall, 0);
    for (const b of buckets) {
      const alloc =
        sumShortfalls > 0
          ? (b.shortfall / sumShortfalls) * freshInflowINR
          : b.targetShare * freshInflowINR;
      if (alloc >= 500) {
        const rounded = Math.round(alloc);
        sipOrders.push({
          title: b.title,
          description: b.hint,
          type: 'buy',
          amount: formatExactINR(rounded),
          amountRaw: rounded,
          category: b.category
        });
      }
    }

    const addedEq = sipOrders
      .filter((o) => o.category !== 'Debt & Cash')
      .reduce((s, o) => s + o.amountRaw, 0);
    const postEqPct = newTotal > 0 ? (stats.equityValINR + addedEq) / newTotal : stats.targetEquityPct;
    sipPostAccuracy = Math.max(0, 100 - Math.abs(postEqPct - stats.targetEquityPct) * 100);
  }

  return { accuracy, suggestions, sipOrders, sipPostAccuracy };
}
