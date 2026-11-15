import {
  Currency,
  Holding,
  IncomeBracketKey,
  PortfolioTargets,
  RealEstateProperty,
  RsuGrant,
  TaxLot,
  TaxProfileSettings
} from '../types';
import { FX_FALLBACK_RATE, formatCompactINR, getHoldingOwnerId } from './formatters';
import { ComputedPortfolioStats, EnrichedHolding } from './portfolioMath';

export const DEFAULT_TAX_PROFILE: TaxProfileSettings = {
  incomeBracket: '1cr_to_2cr',
  taxRegime: 'new',
  realizedSec112aGainByMemberINR: {},
  realizedLossOffsetPoolINR: 0,
  nomineeVerifiedByAccount: {}
};

export const SEC_112A_ANNUAL_EXEMPTION_INR = 125_000; // ₹1.25 Lakh per PAN per FY

export interface EffectiveTaxRates {
  surchargeSlabPct: number;        // 0, 10, 15, 25, or 37
  surchargeCapGainsPct: number;    // Capped at 15% for Sec 111A / 112A / 112!
  marginalSlabEffectivePct: number; // e.g. 35.88% (1-2Cr) or 39.00% (>2Cr New Regime)
  indianEqStcgEffectivePct: number; // 20% * (1 + capSurcharge) * 1.04 -> 23.92%
  ltcgEffectivePct: number;         // 12.5% * (1 + capSurcharge) * 1.04 -> 14.95%
  bracketLabel: string;
}

export function getEffectiveIndiaTaxRates(profile?: Partial<TaxProfileSettings>): EffectiveTaxRates {
  const bracket: IncomeBracketKey = profile?.incomeBracket || '1cr_to_2cr';
  const regime = profile?.taxRegime || 'new';

  let surchargeSlabPct = 15;
  let bracketLabel = '₹1 Cr – ₹2 Cr (15% Surcharge)';

  if (bracket === 'below_50l') {
    surchargeSlabPct = 0;
    bracketLabel = 'Up to ₹50L (0% Surcharge)';
  } else if (bracket === '50l_to_1cr') {
    surchargeSlabPct = 10;
    bracketLabel = '₹50L – ₹1 Cr (10% Surcharge)';
  } else if (bracket === '1cr_to_2cr') {
    surchargeSlabPct = 15;
    bracketLabel = '₹1 Cr – ₹2 Cr (15% Surcharge)';
  } else if (bracket === '2cr_to_5cr') {
    surchargeSlabPct = 25;
    bracketLabel = '₹2 Cr – ₹5 Cr (25% Surcharge)';
  } else if (bracket === 'above_5cr') {
    surchargeSlabPct = regime === 'new' ? 25 : 37;
    bracketLabel =
      regime === 'new'
        ? 'Above ₹5 Cr (New Regime 25% Surcharge Cap)'
        : 'Above ₹5 Cr (Old Regime 37% Surcharge)';
  }

  // Statutory 15% surcharge cap under Indian IT Act on Sec 111A, 112A & 112 capital gains
  const surchargeCapGainsPct = Math.min(15, surchargeSlabPct);

  const marginalSlabEffectivePct = Number((30 * (1 + surchargeSlabPct / 100) * 1.04).toFixed(2));
  const indianEqStcgEffectivePct = Number((20 * (1 + surchargeCapGainsPct / 100) * 1.04).toFixed(2));
  const ltcgEffectivePct = Number((12.5 * (1 + surchargeCapGainsPct / 100) * 1.04).toFixed(2));

  return {
    surchargeSlabPct,
    surchargeCapGainsPct,
    marginalSlabEffectivePct,
    indianEqStcgEffectivePct,
    ltcgEffectivePct,
    bracketLabel
  };
}

export type TaxAssetTreatment =
  | 'foreign_equity'          // >24m (730d) LTCG @ 14.95%, <=24m STCG @ Marginal Slab (35.88%-39%)
  | 'indian_equity_sec112a'   // >12m (365d) LTCG @ 14.95% (+ ₹1.25L free/PAN), <=12m STCG @ 23.92%
  | 'gold_etf_or_sgb'         // >12m (365d) LTCG @ 14.95% (no Sec 112A ₹1.25L), <=12m STCG @ Slab
  | 'debt_sec50aa_or_cash';   // Post-Apr-2023 Debt MF @ Marginal Slab; Pre-Apr-2023 >24m @ 14.95%

export function classifyHoldingTaxTreatment(h: {
  ticker?: string;
  originalName?: string;
  assetClass?: string;
  currency?: Currency | string;
}): {
  treatment: TaxAssetTreatment;
  ltcgThresholdDays: number;
  label: string;
} {
  const ticker = String(h.ticker || '').toUpperCase();
  const name = String(h.originalName || '').toLowerCase();
  const combined = `${ticker.toLowerCase()} ${name}`;

  if (h.currency === 'USD') {
    if (/\b(swvxx|snvxx|sgov|bil|usfr|us-cash|money market|treasury bill)\b/i.test(combined)) {
      return {
        treatment: 'debt_sec50aa_or_cash',
        ltcgThresholdDays: 730,
        label: 'USD Cash / Money Market'
      };
    }
    return {
      treatment: 'foreign_equity',
      ltcgThresholdDays: 730, // 24 months for Foreign / Unlisted shares
      label: 'Foreign Equity / US RSU (24M LTCG)'
    };
  }

  // Arbitrage funds are classified as Debt for asset-allocation safety, but taxed as Indian Equity (Sec 112A)!
  if (/\barbitrage\b/i.test(combined)) {
    return {
      treatment: 'indian_equity_sec112a',
      ltcgThresholdDays: 365,
      label: 'Arbitrage Fund (Equity Taxed • 12M LTCG)'
    };
  }

  if (/\b(gold|sgb|silver|goldbees|silverbees)\b/i.test(combined)) {
    return {
      treatment: 'gold_etf_or_sgb',
      ltcgThresholdDays: 365,
      label: 'Gold / SGB (12M LTCG)'
    };
  }

  if (h.assetClass === 'Debt') {
    return {
      treatment: 'debt_sec50aa_or_cash',
      ltcgThresholdDays: 730,
      label: 'Debt / Fixed Income (Sec 50AA Slab)'
    };
  }

  return {
    treatment: 'indian_equity_sec112a',
    ltcgThresholdDays: 365,
    label: 'Indian Equity / MF (Sec 112A • 12M LTCG)'
  };
}

export function normalizeTickerMatchKey(ticker?: string): string {
  return String(ticker || '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|US)$/, '');
}

export function normalizeProviderMatchKey(provider?: string): string {
  const raw = String(provider || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('etrade') || raw.includes('e*trade') || raw.includes('e-trade') || raw.includes('morgan stanley'))
    return 'etrade';
  if (raw.includes('schwab')) return 'schwab';
  if (raw.includes('ibkr') || raw.includes('interactive')) return 'ibkr';
  if (raw.includes('indmoney') || raw.includes('ind money')) return 'indmoney';
  if (raw.includes('zerodha') || raw.includes('kite') || raw.includes('coin')) return 'zerodha';
  if (raw.includes('cams') || raw.includes('kfintech') || raw.includes('mfcentral') || raw === 'amfi')
    return 'cams';
  return raw;
}

export function getLotsForHolding(holding: Holding, allLots: TaxLot[]): TaxLot[] {
  const ownerId = getHoldingOwnerId(holding);
  const tKey = normalizeTickerMatchKey(holding.ticker);
  const pKey = normalizeProviderMatchKey(holding.provider);

  const matched = allLots.filter((lot) => {
    if (!(lot.quantity > 0)) return false;
    if (lot.holdingId && holding.id && lot.holdingId === holding.id) return true;
    const lotOwner = lot.ownerId || '';
    if (lotOwner && ownerId && lotOwner !== ownerId) return false;
    if (normalizeTickerMatchKey(lot.ticker) !== tKey) return false;
    if (lot.provider && pKey) {
      const lp = normalizeProviderMatchKey(lot.provider);
      if (lp && lp !== pKey) return false;
    }
    return true;
  });

  return matched.sort((a, b) => String(a.acquiredDate).localeCompare(String(b.acquiredDate)));
}

export interface EvaluatedTaxLot {
  lot: TaxLot;
  holding: EnrichedHolding;
  ownerName: string;
  holdingDays: number;
  ltcgThresholdDays: number;
  isLtcg: boolean;
  daysToLtcgCliff: number; // 0 if already LTCG or never LTCG (Sec 50AA)
  isNearLtcgCliff: boolean; // true if 1..60 days away from LTCG with positive gain!
  unitPriceINR: number;
  unitCostINR: number;
  marketValueINR: number;
  costBasisINR: number;
  unrealizedGainINR: number;
  gainPctOfProceeds: number;
  applicableTaxRatePct: number; // Tax rate on gain (e.g. 14.95% or 35.88%)
  estimatedFullLotTaxINR: number;
  taxDragPct: number; // Estimated tax INR / Market Value INR * 100
  sec112aEligible: boolean;
  usesFifoAccount: boolean; // True for Indian Demat/MF folios (CAMS, Zerodha)
  treatmentLabel: string;
}

export function evaluateTaxLot(params: {
  lot: TaxLot;
  holding: EnrichedHolding;
  ownerName: string;
  fxRate: number;
  rates: EffectiveTaxRates;
  nowMs?: number;
}): EvaluatedTaxLot {
  const { lot, holding, ownerName, fxRate, rates, nowMs = Date.now() } = params;
  const safeFx = fxRate > 0 ? fxRate : FX_FALLBACK_RATE;

  const acqMs = Date.parse(lot.acquiredDate || '');
  const holdingDays = !isNaN(acqMs) ? Math.max(0, Math.floor((nowMs - acqMs) / 86_400_000)) : 0;

  const { treatment, ltcgThresholdDays, label } = classifyHoldingTaxTreatment(holding);

  const isPreApr2023Debt =
    treatment === 'debt_sec50aa_or_cash' &&
    !isNaN(acqMs) &&
    lot.acquiredDate < '2023-04-01' &&
    !/\b(epf|ppf|fd|cash)\b/i.test(`${holding.ticker} ${holding.originalName || ''}`);

  let isLtcg = false;
  let daysToLtcgCliff = 0;

  if (treatment === 'debt_sec50aa_or_cash' && !isPreApr2023Debt) {
    isLtcg = false;
    daysToLtcgCliff = 0; // Post-Apr-2023 Debt MFs never become LTCG under Sec 50AA
  } else {
    isLtcg = holdingDays > ltcgThresholdDays;
    daysToLtcgCliff = isLtcg ? 0 : Math.max(1, ltcgThresholdDays + 1 - holdingDays);
  }

  const unitPriceNative = Number(holding.currentPrice) || 0;
  const unitPriceINR = holding.currency === 'USD' ? unitPriceNative * safeFx : unitPriceNative;

  const buyFx =
    holding.currency === 'USD'
      ? Number(lot.fxRateAtBuy) > 0
        ? Number(lot.fxRateAtBuy)
        : safeFx
      : 1;
  const unitCostINR = (Number(lot.costPerUnit) || 0) * buyFx;

  const qty = Math.max(0, Number(lot.quantity) || 0);
  const marketValueINR = qty * unitPriceINR;
  const costBasisINR = qty * unitCostINR;
  const unrealizedGainINR = marketValueINR - costBasisINR;
  const gainPctOfProceeds = marketValueINR > 0 ? (unrealizedGainINR / marketValueINR) * 100 : 0;

  let applicableTaxRatePct = rates.marginalSlabEffectivePct;
  if (isLtcg) {
    applicableTaxRatePct = rates.ltcgEffectivePct;
  } else if (treatment === 'indian_equity_sec112a') {
    applicableTaxRatePct = rates.indianEqStcgEffectivePct;
  } else {
    applicableTaxRatePct = rates.marginalSlabEffectivePct;
  }

  const positiveGainINR = Math.max(0, unrealizedGainINR);
  const estimatedFullLotTaxINR = positiveGainINR * (applicableTaxRatePct / 100);
  const taxDragPct = marketValueINR > 0 ? (estimatedFullLotTaxINR / marketValueINR) * 100 : 0;

  const isNearLtcgCliff =
    !isLtcg && daysToLtcgCliff > 0 && daysToLtcgCliff <= 60 && unrealizedGainINR > 10_000;

  const provNorm = normalizeProviderMatchKey(holding.provider);
  const usesFifoAccount =
    holding.currency === 'INR' || ['cams', 'zerodha'].includes(provNorm);

  return {
    lot,
    holding,
    ownerName,
    holdingDays,
    ltcgThresholdDays,
    isLtcg,
    daysToLtcgCliff,
    isNearLtcgCliff,
    unitPriceINR,
    unitCostINR,
    marketValueINR,
    costBasisINR,
    unrealizedGainINR,
    gainPctOfProceeds,
    applicableTaxRatePct,
    estimatedFullLotTaxINR,
    taxDragPct,
    sec112aEligible: treatment === 'indian_equity_sec112a' && isLtcg,
    usesFifoAccount,
    treatmentLabel: label
  };
}

export interface RecommendedLotSlice {
  lotId: string;
  ticker: string;
  assetName: string;
  ownerId: string;
  ownerName: string;
  provider: string;
  acquiredDate: string;
  acquisitionType: string;
  holdingDays: number;
  isLtcg: boolean;
  daysToLtcgCliff: number;
  sellUnits: number;
  sellProceedsINR: number;
  costBasisINR: number;
  realizedGainINR: number;
  sec112aExemptionAppliedINR: number;
  estimatedTaxINR: number;
  taxRateOnGainPct: number;
  taxDragPct: number;
  reasonBadge: string;
  executionMethod: 'Specific Lot ID' | 'FIFO Account Order';
}

export interface OrderLotOptimizationResult {
  orderTitle: string;
  orderCategory: string;
  targetSellINR: number;
  coveredByDatedLotsINR: number;
  uncoveredNoDateINR: number;
  totalEstimatedTaxINR: number;
  naiveStcgTaxINR: number; // Comparison: what worst-case STCG/naive sale would cost
  estimatedTaxSavedINR: number;
  effectiveTaxDragPct: number;
  slices: RecommendedLotSlice[];
  cliffWarnings: {
    ticker: string;
    ownerName: string;
    acquiredDate: string;
    daysRemaining: number;
    potentialTaxSavedINR: number;
    units: number;
  }[];
}

export interface PortfolioTaxIntelligence {
  rates: EffectiveTaxRates;
  coveragePct: number;
  datedValueINR: number;
  undatedValueINR: number;
  ltcgValueINR: number;
  stcgValueINR: number;
  totalUnrealizedGainINR: number;
  evaluatedLots: EvaluatedTaxLot[];
  cliffAlerts: {
    lotId: string;
    ticker: string;
    assetName: string;
    ownerName: string;
    provider: string;
    acquiredDate: string;
    units: number;
    valueINR: number;
    gainINR: number;
    daysToLtcg: number;
    taxNowINR: number;
    taxAfterCliffINR: number;
    taxSavedByWaitingINR: number;
  }[];
  sec112aHarvestByMember: {
    memberId: string;
    memberName: string;
    alreadyRealizedINR: number;
    remainingFreeQuotaINR: number;
    availableLtcgGainINR: number;
    harvestableNowINR: number;
    potentialTaxSavedINR: number;
    topCandidateTicker?: string;
  }[];
  lossHarvestCandidates: {
    lotId: string;
    ticker: string;
    assetName: string;
    ownerName: string;
    provider: string;
    acquiredDate: string;
    units: number;
    valueINR: number;
    unrealizedLossINR: number;
    potentialTaxShieldINR: number;
    isLtcg: boolean;
  }[];
  arbitrageSwapOpportunity?: {
    taxableDebtValueINR: number;
    annualPreTaxYieldINR: number;
    annualTaxSavedViaArbitrageINR: number;
  };
  homeLoanArbitrageInsight?: {
    propertyName: string;
    loanRatePct: number;
    outstandingLoanINR: number;
    postTaxArbitrageYieldPct: number;
    spreadPct: number;
    recommendation: string;
  };
}

export function computePortfolioTaxIntelligence(params: {
  stats: ComputedPortfolioStats;
  taxLots: TaxLot[];
  taxProfile?: Partial<TaxProfileSettings>;
  members: { id: string; name: string }[];
  fxRate: number;
  realEstateProperties?: RealEstateProperty[];
}): PortfolioTaxIntelligence {
  const { stats, taxLots, taxProfile, members, fxRate, realEstateProperties = [] } = params;
  const rates = getEffectiveIndiaTaxRates(taxProfile);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  const activeHoldings = stats.holdings.filter((h) => !h.isPlaceholder && h.valINR > 0);

  const evaluatedLots: EvaluatedTaxLot[] = [];
  let datedValueINR = 0;
  let ltcgValueINR = 0;
  let stcgValueINR = 0;
  let totalUnrealizedGainINR = 0;
  let taxableDebtValueINR = 0;

  for (const h of activeHoldings) {
    const ownerId = getHoldingOwnerId(h);
    const ownerName = memberMap.get(ownerId) || 'Family Member';
    const { treatment } = classifyHoldingTaxTreatment(h);

    if (
      treatment === 'debt_sec50aa_or_cash' &&
      !/\b(epf|ppf|nps)\b/i.test(`${h.ticker} ${h.originalName || ''}`)
    ) {
      taxableDebtValueINR += h.valINR;
    }

    const matchingLots = getLotsForHolding(h, taxLots);
    let remainingHoldingUnits = Math.max(0, Number(h.quantity) || 0);

    for (const lot of matchingLots) {
      if (remainingHoldingUnits <= 0) break;
      const effectiveQty = Math.min(remainingHoldingUnits, Math.max(0, Number(lot.quantity) || 0));
      if (effectiveQty <= 0) continue;
      remainingHoldingUnits -= effectiveQty;

      const effectiveLot: TaxLot =
        effectiveQty === lot.quantity ? lot : { ...lot, quantity: effectiveQty };
      const ev = evaluateTaxLot({
        lot: effectiveLot,
        holding: h,
        ownerName,
        fxRate,
        rates
      });
      evaluatedLots.push(ev);
      datedValueINR += ev.marketValueINR;
      totalUnrealizedGainINR += ev.unrealizedGainINR;
      if (ev.isLtcg) ltcgValueINR += ev.marketValueINR;
      else stcgValueINR += ev.marketValueINR;
    }
  }

  const totalLiquidINR = Math.max(0, stats.totalValINR);
  const undatedValueINR = Math.max(0, totalLiquidINR - datedValueINR);
  const coveragePct = totalLiquidINR > 0 ? Math.min(100, (datedValueINR / totalLiquidINR) * 100) : 0;

  // 1. LTCG Cliff Alerts (lots within 60 days of LTCG with meaningful gain)
  const cliffAlerts = evaluatedLots
    .filter((ev) => ev.isNearLtcgCliff)
    .map((ev) => {
      const posGain = Math.max(0, ev.unrealizedGainINR);
      const taxNowINR = posGain * (ev.applicableTaxRatePct / 100);
      const taxAfterCliffINR = posGain * (rates.ltcgEffectivePct / 100);
      return {
        lotId: ev.lot.id,
        ticker: ev.holding.ticker,
        assetName: ev.holding.originalName || ev.holding.ticker,
        ownerName: ev.ownerName,
        provider: ev.holding.provider,
        acquiredDate: ev.lot.acquiredDate,
        units: ev.lot.quantity,
        valueINR: ev.marketValueINR,
        gainINR: posGain,
        daysToLtcg: ev.daysToLtcgCliff,
        taxNowINR,
        taxAfterCliffINR,
        taxSavedByWaitingINR: Math.max(0, taxNowINR - taxAfterCliffINR)
      };
    })
    .filter((c) => c.taxSavedByWaitingINR >= 1500)
    .sort((a, b) => a.daysToLtcg - b.daysToLtcg);

  // 2. Family Multi-PAN Sec 112A ₹1.25L Annual Tax-Gain Harvesting
  const sec112aHarvestByMember = members.map((m) => {
    const realized = Math.max(
      0,
      Number(taxProfile?.realizedSec112aGainByMemberINR?.[m.id]) || 0
    );
    const remainingFreeQuotaINR = Math.max(0, SEC_112A_ANNUAL_EXEMPTION_INR - realized);
    const memberSec112aLots = evaluatedLots.filter(
      (ev) =>
        getHoldingOwnerId(ev.holding) === m.id &&
        ev.sec112aEligible &&
        ev.unrealizedGainINR > 0
    );
    const availableLtcgGainINR = memberSec112aLots.reduce(
      (sum, ev) => sum + ev.unrealizedGainINR,
      0
    );
    const harvestableNowINR = Math.min(remainingFreeQuotaINR, availableLtcgGainINR);
    const potentialTaxSavedINR = harvestableNowINR * (rates.ltcgEffectivePct / 100);
    const topLot = [...memberSec112aLots].sort(
      (a, b) => b.unrealizedGainINR - a.unrealizedGainINR
    )[0];

    return {
      memberId: m.id,
      memberName: m.name,
      alreadyRealizedINR: realized,
      remainingFreeQuotaINR,
      availableLtcgGainINR,
      harvestableNowINR,
      potentialTaxSavedINR,
      topCandidateTicker: topLot?.holding.originalName || topLot?.holding.ticker
    };
  });

  // 3. Tax-Loss Harvesting Candidates
  const lossHarvestCandidates = evaluatedLots
    .filter((ev) => ev.unrealizedGainINR <= -5_000)
    .map((ev) => {
      const lossAbs = Math.abs(ev.unrealizedGainINR);
      const shieldRate = ev.isLtcg ? rates.ltcgEffectivePct : rates.indianEqStcgEffectivePct;
      return {
        lotId: ev.lot.id,
        ticker: ev.holding.ticker,
        assetName: ev.holding.originalName || ev.holding.ticker,
        ownerName: ev.ownerName,
        provider: ev.holding.provider,
        acquiredDate: ev.lot.acquiredDate,
        units: ev.lot.quantity,
        valueINR: ev.marketValueINR,
        unrealizedLossINR: lossAbs,
        potentialTaxShieldINR: lossAbs * (shieldRate / 100),
        isLtcg: ev.isLtcg
      };
    })
    .sort((a, b) => b.potentialTaxShieldINR - a.potentialTaxShieldINR);

  // 4. Arbitrage vs Sec 50AA Debt / FD Tax Alpha for >1Cr Slab
  let arbitrageSwapOpportunity: PortfolioTaxIntelligence['arbitrageSwapOpportunity'];
  if (taxableDebtValueINR >= 300_000 && rates.marginalSlabEffectivePct > rates.ltcgEffectivePct + 5) {
    const assumedYield = 0.072; // 7.2% p.a. liquid/arbitrage yield
    const annualPreTaxYieldINR = taxableDebtValueINR * assumedYield;
    const taxInDebt = annualPreTaxYieldINR * (rates.marginalSlabEffectivePct / 100);
    const taxInArbitrage = annualPreTaxYieldINR * (rates.ltcgEffectivePct / 100);
    arbitrageSwapOpportunity = {
      taxableDebtValueINR,
      annualPreTaxYieldINR,
      annualTaxSavedViaArbitrageINR: Math.max(0, taxInDebt - taxInArbitrage)
    };
  }

  // 5. Home Loan Prepayment vs Post-Tax Arbitrage / Debt Comparison
  let homeLoanArbitrageInsight: PortfolioTaxIntelligence['homeLoanArbitrageInsight'];
  const activeProp = realEstateProperties.find((p) => (p.loanConfig?.interestRatePct || 0) > 0);
  if (activeProp) {
    const loanRatePct = Number(activeProp.loanConfig.interestRatePct) || 8.0;
    const postTaxArbitrageYieldPct = Number((7.2 * (1 - rates.ltcgEffectivePct / 100)).toFixed(2));
    const spreadPct = Number((loanRatePct - postTaxArbitrageYieldPct).toFixed(2));
    const outstandingLoanINR = Number(activeProp.manualLoanDisbursedINR) || Number(activeProp.loanConfig.sanctionedLimitINR) || 0;
    homeLoanArbitrageInsight = {
      propertyName: activeProp.name,
      loanRatePct,
      outstandingLoanINR,
      postTaxArbitrageYieldPct,
      spreadPct,
      recommendation:
        spreadPct > 0.5
          ? `Prepaying your ${loanRatePct}% home loan earns a risk-free ${spreadPct}% p.a. higher post-tax return than parking surplus Debt in Arbitrage (${postTaxArbitrageYieldPct}% post-tax).`
          : `Your ${loanRatePct}% loan rate is close to post-tax Arbitrage yield (${postTaxArbitrageYieldPct}%) — keep liquidity for upcoming builder demands before prepaying.`
    };
  }

  return {
    rates,
    coveragePct,
    datedValueINR,
    undatedValueINR,
    ltcgValueINR,
    stcgValueINR,
    totalUnrealizedGainINR,
    evaluatedLots,
    cliffAlerts,
    sec112aHarvestByMember,
    lossHarvestCandidates,
    arbitrageSwapOpportunity,
    homeLoanArbitrageInsight
  };
}

/**
 * Optimizes which exact Tax Lots to liquidate for any Rebalance SELL order or Smart Cash-Raise goal.
 * Ranks candidate lots by minimum actual INR Tax Drag % while respecting Sec 112A quotas & LTCG cliffs.
 */
export function optimizeSellOrderLots(params: {
  orderTitle: string;
  orderCategory: string;
  targetSellINR: number;
  isTickerLevel?: boolean;
  targetTicker?: string;
  intel: PortfolioTaxIntelligence;
  stats: ComputedPortfolioStats;
  taxProfile?: Partial<TaxProfileSettings>;
}): OrderLotOptimizationResult {
  const {
    orderTitle,
    orderCategory,
    targetSellINR,
    isTickerLevel,
    targetTicker,
    intel,
    stats,
    taxProfile
  } = params;

  const targetTickerKey = targetTicker ? normalizeTickerMatchKey(targetTicker) : '';

  // Filter candidate lots matching this sell order
  const candidateLots = intel.evaluatedLots.filter((ev) => {
    if (ev.marketValueINR <= 0) return false;
    if (isTickerLevel && targetTickerKey) {
      return normalizeTickerMatchKey(ev.holding.ticker) === targetTickerKey;
    }
    if (orderCategory === 'Asset Allocation') {
      if (/sell\s+equity/i.test(orderTitle)) return ev.holding.assetClass !== 'Debt';
      if (/sell\s+debt/i.test(orderTitle)) return ev.holding.assetClass === 'Debt';
      return true;
    }
    if (orderCategory === 'Geographic Split') {
      if (/indian/i.test(orderTitle)) return ev.holding.currency === 'INR' && ev.holding.assetClass !== 'Debt';
      if (/foreign/i.test(orderTitle)) return ev.holding.currency === 'USD' && ev.holding.assetClass !== 'Debt';
    }
    if (orderCategory === 'Smart Cash Raiser') {
      // Cash raiser can pick across ALL liquid holdings! Prefer overweight buckets slightly, lowest tax drag heavily.
      return true;
    }
    // Foreign breakdown category match
    const foreignCat = stats.foreignBreakdownStats.find((c) => c.name === orderCategory);
    if (foreignCat && ev.holding.currency === 'USD') {
      const catTickers = new Set(
        (foreignCat.tickerWeights || []).map((tw) => normalizeTickerMatchKey(tw.ticker))
      );
      if (catTickers.size > 0) {
        return catTickers.has(normalizeTickerMatchKey(ev.holding.ticker));
      }
      return true;
    }
    return true;
  });

  // Remaining Sec 112A ₹1.25L quota per member
  const memberRemaining112a = new Map<string, number>();
  intel.sec112aHarvestByMember.forEach((m) => {
    memberRemaining112a.set(m.memberId, m.remainingFreeQuotaINR);
  });

  // Track cliff warnings on candidate lots
  const cliffWarnings = candidateLots
    .filter((ev) => ev.isNearLtcgCliff)
    .map((ev) => {
      const gain = Math.max(0, ev.unrealizedGainINR);
      const saved =
        gain * ((ev.applicableTaxRatePct - intel.rates.ltcgEffectivePct) / 100);
      return {
        ticker: ev.holding.ticker,
        ownerName: ev.ownerName,
        acquiredDate: ev.lot.acquiredDate,
        daysRemaining: ev.daysToLtcgCliff,
        potentialTaxSavedINR: Math.max(0, saved),
        units: ev.lot.quantity
      };
    });

  // Score each lot by effective tax drag % + cliff penalty + slight overweight preference for Cash Raiser
  const scored = candidateLots.map((ev) => {
    const ownerId = getHoldingOwnerId(ev.holding);
    const free112a = ev.sec112aEligible ? memberRemaining112a.get(ownerId) || 0 : 0;
    const positiveGain = Math.max(0, ev.unrealizedGainINR);
    const taxableAfter112a = Math.max(0, positiveGain - free112a);
    const effectiveTax = taxableAfter112a * (ev.applicableTaxRatePct / 100);
    const effectiveDragPct = ev.marketValueINR > 0 ? (effectiveTax / ev.marketValueINR) * 100 : 0;

    let sortScore = effectiveDragPct;
    if (ev.unrealizedGainINR < 0) {
      // Loss-harvesting lot gets negative score (highest priority!)
      sortScore = -5 + ev.gainPctOfProceeds * 0.05;
    }
    if (ev.isNearLtcgCliff) {
      // Heavy penalty so we avoid selling lots about to turn LTCG unless no alternative exists
      sortScore += 35;
    }
    if (orderCategory === 'Smart Cash Raiser') {
      // Slight tie-breaker: if Equity is overweight, prefer selling low-tax Equity/RSU; if Debt is overweight, prefer Debt/Arbitrage
      const isDebt = ev.holding.assetClass === 'Debt';
      if (stats.equityDrift > 0.02 && !isDebt) sortScore -= 0.4;
      if (stats.equityDrift < -0.02 && isDebt) sortScore -= 0.4;
    }

    return { ev, sortScore };
  });

  // Respect FIFO ordering WITHIN the same Indian Demat/MF (owner + ticker + provider) if usesFifoAccount is true,
  // while freely selecting the lowest-drag account/member/ticker across the family and Specific-ID for US brokers!
  scored.sort((a, b) => {
    const sameIndianFolio =
      a.ev.usesFifoAccount &&
      b.ev.usesFifoAccount &&
      getHoldingOwnerId(a.ev.holding) === getHoldingOwnerId(b.ev.holding) &&
      normalizeTickerMatchKey(a.ev.holding.ticker) === normalizeTickerMatchKey(b.ev.holding.ticker) &&
      normalizeProviderMatchKey(a.ev.holding.provider) === normalizeProviderMatchKey(b.ev.holding.provider);
    if (sameIndianFolio) {
      return String(a.ev.lot.acquiredDate).localeCompare(String(b.ev.lot.acquiredDate));
    }
    return a.sortScore - b.sortScore;
  });

  let remainingSellINR = Math.max(0, targetSellINR);
  let coveredByDatedLotsINR = 0;
  let totalEstimatedTaxINR = 0;
  const slices: RecommendedLotSlice[] = [];

  for (const { ev } of scored) {
    if (remainingSellINR <= 100) break;
    const sliceProceedsINR = Math.min(remainingSellINR, ev.marketValueINR);
    const ratio = ev.marketValueINR > 0 ? sliceProceedsINR / ev.marketValueINR : 0;
    if (ratio <= 0) continue;

    const sellUnits = Number((ev.lot.quantity * ratio).toFixed(4));
    const costBasisINR = ev.costBasisINR * ratio;
    const realizedGainINR = sliceProceedsINR - costBasisINR;

    const ownerId = getHoldingOwnerId(ev.holding);
    let sec112aExemptionAppliedINR = 0;
    if (ev.sec112aEligible && realizedGainINR > 0) {
      const avail = memberRemaining112a.get(ownerId) || 0;
      sec112aExemptionAppliedINR = Math.min(avail, realizedGainINR);
      memberRemaining112a.set(ownerId, Math.max(0, avail - sec112aExemptionAppliedINR));
    }

    const taxableGainINR = Math.max(0, realizedGainINR - sec112aExemptionAppliedINR);
    const estimatedTaxINR = taxableGainINR * (ev.applicableTaxRatePct / 100);
    const sliceDragPct = sliceProceedsINR > 0 ? (estimatedTaxINR / sliceProceedsINR) * 100 : 0;

    let reasonBadge = ev.isLtcg ? `LTCG (${ev.applicableTaxRatePct}%)` : `STCG (${ev.applicableTaxRatePct}%)`;
    if (realizedGainINR < -500) {
      reasonBadge = 'Tax-Loss Harvest (₹0 Tax)';
    } else if (sec112aExemptionAppliedINR > 0 && estimatedTaxINR < 100) {
      reasonBadge = 'Sec 112A Tax-Free Quota (₹0 Tax)';
    } else if (Math.abs(ev.gainPctOfProceeds) < 3 && ev.lot.acquisitionType === 'RSU Vest') {
      reasonBadge = 'Fresh RSU Near Vest FMV (~0% Drag)';
    } else if (ev.isLtcg) {
      reasonBadge = `Low-Rate LTCG (${ev.applicableTaxRatePct}%)`;
    }

    slices.push({
      lotId: ev.lot.id,
      ticker: ev.holding.ticker,
      assetName: ev.holding.originalName || ev.holding.ticker,
      ownerId,
      ownerName: ev.ownerName,
      provider: ev.holding.provider,
      acquiredDate: ev.lot.acquiredDate,
      acquisitionType: ev.lot.acquisitionType,
      holdingDays: ev.holdingDays,
      isLtcg: ev.isLtcg,
      daysToLtcgCliff: ev.daysToLtcgCliff,
      sellUnits,
      sellProceedsINR: sliceProceedsINR,
      costBasisINR,
      realizedGainINR,
      sec112aExemptionAppliedINR,
      estimatedTaxINR,
      taxRateOnGainPct: ev.applicableTaxRatePct,
      taxDragPct: sliceDragPct,
      reasonBadge,
      executionMethod: ev.usesFifoAccount ? 'FIFO Account Order' : 'Specific Lot ID'
    });

    coveredByDatedLotsINR += sliceProceedsINR;
    totalEstimatedTaxINR += estimatedTaxINR;
    remainingSellINR -= sliceProceedsINR;
  }

  // Compare against naive worst-case STCG sale assuming 35% embedded gain at marginal/STCG rate
  const worstRate =
    candidateLots.some((c) => c.holding.currency === 'USD')
      ? intel.rates.marginalSlabEffectivePct
      : intel.rates.indianEqStcgEffectivePct;
  const highestDragLot = candidateLots.reduce((mx, c) => Math.max(mx, c.taxDragPct), 0);
  const benchmarkDragPct = Math.max(highestDragLot, 0.3 * worstRate);
  const naiveStcgTaxINR = coveredByDatedLotsINR * (benchmarkDragPct / 100);
  const estimatedTaxSavedINR = Math.max(0, naiveStcgTaxINR - totalEstimatedTaxINR);

  const PoolLossOffset = Math.max(0, Number(taxProfile?.realizedLossOffsetPoolINR) || 0);
  if (PoolLossOffset > 0 && totalEstimatedTaxINR > 0) {
    // Informational: realized loss pool can further reduce tax
  }

  return {
    orderTitle,
    orderCategory,
    targetSellINR,
    coveredByDatedLotsINR,
    uncoveredNoDateINR: Math.max(0, targetSellINR - coveredByDatedLotsINR),
    totalEstimatedTaxINR,
    naiveStcgTaxINR,
    estimatedTaxSavedINR,
    effectiveTaxDragPct:
      coveredByDatedLotsINR > 0 ? (totalEstimatedTaxINR / coveredByDatedLotsINR) * 100 : 0,
    slices,
    cliffWarnings
  };
}

// ============================================================================
// FUTURE RSU VESTING TRACKER & FORWARD DRIFT / BALANCE SIMULATOR
// ============================================================================

export interface UpcomingVestEvent {
  grantId: string;
  trancheId: string;
  ownerId: string;
  ownerName: string;
  ticker: string;
  grantName: string;
  provider: string;
  vestDate: string;
  daysUntilVest: number;
  grossUnits: number;
  withholdingTaxPct: number;
  netUnits: number;
  projectedSharePriceUSD: number;
  netVestValueUSD: number;
  netVestValueINR: number;
  sellAtVestUnitsToStayBalanced: number;
  sellAtVestValueINR: number;
}

export interface RsuForwardSimulationResult {
  horizonMonths: number;
  priceScenarioPct: number;
  upcomingEvents: UpcomingVestEvent[];
  totalGrossUnitsVesting: number;
  totalNetUnitsVesting: number;
  totalNetVestValueINR: number;
  currentLiquidINR: number;
  projectedLiquidIfHeldINR: number;
  currentEquityPct: number;
  projectedEquityPctIfHeld: number;
  targetEquityPct: number;
  currentForeignOfEqPct: number;
  projectedForeignOfEqPctIfHeld: number;
  targetForeignOfEqPct: number;
  currentAlignmentPct: number;
  projectedAlignmentIfHeldPct: number;
  topRsuTicker: string;
  currentTopTickerConcentrationPct: number;
  projectedTopTickerConcentrationPct: number;
  timelineCheckpoints: {
    label: string;
    liquidTotalINR: number;
    foreignEqPctOfTotal: number;
    indianEqPctOfTotal: number;
    debtPctOfTotal: number;
    targetForeignPctOfTotal: number;
    cumulativeVestAddedINR: number;
  }[];
  playbookSellAtVest: {
    sellPctOfNetVest: number;
    sellValueINR: number;
    estimatedCapGainsTaxINR: number; // ~₹0 when sold immediately on vest day!
    deployToIndianEquityINR: number;
    deployToDebtArbitrageINR: number;
    resultingAlignmentPct: number;
  };
  playbookHoldAndSip: {
    requiredMonthlySipINR: number;
    monthlyIndianEquitySipINR: number;
    monthlyDebtSipINR: number;
    totalSipOverHorizonINR: number;
    resultingAlignmentPct: number;
  };
}

export function simulateRsuForwardPlan(params: {
  stats: ComputedPortfolioStats;
  rsuGrants: RsuGrant[];
  targets: PortfolioTargets;
  members: { id: string; name: string }[];
  fxRate: number;
  horizonMonths?: number;
  priceScenarioPct?: number; // e.g. -20, 0, +20
  nowMs?: number;
}): RsuForwardSimulationResult {
  const {
    stats,
    rsuGrants,
    targets,
    members,
    fxRate,
    horizonMonths = 12,
    priceScenarioPct = 0,
    nowMs = Date.now()
  } = params;

  const safeFx = fxRate > 0 ? fxRate : FX_FALLBACK_RATE;
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const priceMult = 1 + priceScenarioPct / 100;

  // Map live USD price by ticker from existing holdings (with sensible fallback)
  const tickerLivePriceUSD = new Map<string, number>();
  for (const h of stats.holdings) {
    if (h.currency === 'USD' && h.currentPrice > 0) {
      tickerLivePriceUSD.set(normalizeTickerMatchKey(h.ticker), h.currentPrice);
    }
  }

  const horizonEndMs = nowMs + horizonMonths * 30.4375 * 86_400_000;
  const upcomingEvents: UpcomingVestEvent[] = [];

  for (const grant of rsuGrants) {
    const tKey = normalizeTickerMatchKey(grant.ticker);
    const basePriceUSD = tickerLivePriceUSD.get(tKey) || 175;
    const projectedSharePriceUSD = basePriceUSD * priceMult;
    const withholdPct =
      typeof grant.withholdingTaxPct === 'number' && grant.withholdingTaxPct >= 0
        ? Math.min(60, grant.withholdingTaxPct)
        : 35.88;

    for (const tr of grant.vestSchedule || []) {
      if (tr.vested) continue;
      const vestMs = Date.parse(tr.vestDate || '');
      if (isNaN(vestMs)) continue;
      // Include vests from 7 days ago (unconfirmed) up to horizonEndMs
      if (vestMs < nowMs - 7 * 86_400_000 || vestMs > horizonEndMs) continue;

      const grossUnits = Math.max(0, Number(tr.grossUnits) || 0);
      if (grossUnits <= 0) continue;

      const netUnits =
        typeof tr.netUnits === 'number' && tr.netUnits > 0
          ? tr.netUnits
          : Number((grossUnits * (1 - withholdPct / 100)).toFixed(4));

      const netVestValueUSD = netUnits * projectedSharePriceUSD;
      const netVestValueINR = netVestValueUSD * safeFx;
      const daysUntilVest = Math.max(0, Math.ceil((vestMs - nowMs) / 86_400_000));

      upcomingEvents.push({
        grantId: grant.id,
        trancheId: tr.id,
        ownerId: grant.ownerId,
        ownerName: memberMap.get(grant.ownerId) || 'Family Member',
        ticker: tKey || grant.ticker,
        grantName: grant.grantName || 'RSU Grant',
        provider: grant.provider || 'E*TRADE',
        vestDate: tr.vestDate,
        daysUntilVest,
        grossUnits,
        withholdingTaxPct: withholdPct,
        netUnits,
        projectedSharePriceUSD,
        netVestValueUSD,
        netVestValueINR,
        sellAtVestUnitsToStayBalanced: 0,
        sellAtVestValueINR: 0
      });
    }
  }

  upcomingEvents.sort((a, b) => a.vestDate.localeCompare(b.vestDate));

  const targetEquityRatio = (targets?.assetSplit?.Equity ?? 70) / 100;
  const targetDebtRatio = 1 - targetEquityRatio;
  const targetForeignOfEqRatio = (targets?.equitySplit?.Foreign ?? 40) / 100;
  const targetIndianOfEqRatio = 1 - targetForeignOfEqRatio;
  const targetForeignOfTotalRatio = targetEquityRatio * targetForeignOfEqRatio;
  const targetIndianOfTotalRatio = targetEquityRatio * targetIndianOfEqRatio;

  // Apply priceScenarioPct shock to existing Foreign Equity RSU holdings if scenario != 0
  const rsuTickerSet = new Set(rsuGrants.map((g) => normalizeTickerMatchKey(g.ticker)));
  let rsuExistingValINR = 0;
  let topRsuTicker = upcomingEvents[0]?.ticker || rsuGrants[0]?.ticker || 'QCOM';
  const rsuVestByTicker = new Map<string, number>();
  for (const ev of upcomingEvents) {
    rsuVestByTicker.set(ev.ticker, (rsuVestByTicker.get(ev.ticker) || 0) + ev.netVestValueINR);
  }
  if (rsuVestByTicker.size > 0) {
    topRsuTicker = [...rsuVestByTicker.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  let currentTopTickerINR = 0;
  for (const h of stats.holdings) {
    if (h.isPlaceholder) continue;
    const tk = normalizeTickerMatchKey(h.ticker);
    if (rsuTickerSet.has(tk)) rsuExistingValINR += h.valINR;
    if (tk === normalizeTickerMatchKey(topRsuTicker)) currentTopTickerINR += h.valINR;
  }

  const rsuShockDeltaINR = rsuExistingValINR * (priceScenarioPct / 100);
  const currentLiquidINR = stats.totalValINR;
  const baseForeignINR = Math.max(0, stats.foreignEquityValINR + rsuShockDeltaINR);
  const baseIndianINR = stats.indianEquityValINR;
  const baseDebtINR = stats.debtValINR;

  const totalGrossUnitsVesting = upcomingEvents.reduce((s, e) => s + e.grossUnits, 0);
  const totalNetUnitsVesting = upcomingEvents.reduce((s, e) => s + e.netUnits, 0);
  const totalNetVestValueINR = upcomingEvents.reduce((s, e) => s + e.netVestValueINR, 0);

  const projectedForeignIfHeldINR = baseForeignINR + totalNetVestValueINR;
  const projectedEquityIfHeldINR = baseIndianINR + projectedForeignIfHeldINR;
  const projectedLiquidIfHeldINR = projectedEquityIfHeldINR + baseDebtINR;

  const currentEquityPct = stats.actualEquityPct * 100;
  const projectedEquityPctIfHeld =
    projectedLiquidIfHeldINR > 0 ? (projectedEquityIfHeldINR / projectedLiquidIfHeldINR) * 100 : 0;

  const currentForeignOfEqPct = stats.actualForeignEquityPctOfEquity * 100;
  const projectedForeignOfEqPctIfHeld =
    projectedEquityIfHeldINR > 0 ? (projectedForeignIfHeldINR / projectedEquityIfHeldINR) * 100 : 0;

  const computeSimpleAlignment = (indINR: number, forINR: number, debtINR: number) => {
    const tot = indINR + forINR + debtINR;
    if (tot <= 0) return 100;
    const eqDrift = Math.abs((indINR + forINR) / tot - targetEquityRatio);
    const forDrift = Math.abs(forINR / tot - targetForeignOfTotalRatio);
    return Math.max(0, Math.min(100, 100 - (eqDrift * 65 + forDrift * 55)));
  };

  const currentAlignmentPct = computeSimpleAlignment(
    stats.indianEquityValINR,
    stats.foreignEquityValINR,
    stats.debtValINR
  );
  const projectedAlignmentIfHeldPct = computeSimpleAlignment(
    baseIndianINR,
    projectedForeignIfHeldINR,
    baseDebtINR
  );

  // Playbook A: How much of the newly vesting RSUs should be sold at vest (~₹0 cap-gains tax!)
  // Desired Foreign Equity after total liquid reaches projectedLiquidIfHeldINR = projectedLiquidIfHeldINR * targetForeignOfTotalRatio
  const desiredForeignINR = projectedLiquidIfHeldINR * targetForeignOfTotalRatio;
  const excessForeignINR = Math.max(0, projectedForeignIfHeldINR - desiredForeignINR);
  const sellValueINR = Math.min(totalNetVestValueINR, excessForeignINR);
  const sellPctOfNetVest =
    totalNetVestValueINR > 0 ? Math.min(100, (sellValueINR / totalNetVestValueINR) * 100) : 0;

  // Populate per-event sellAtVest recommendation
  for (const ev of upcomingEvents) {
    ev.sellAtVestValueINR = ev.netVestValueINR * (sellPctOfNetVest / 100);
    ev.sellAtVestUnitsToStayBalanced = Number(
      (ev.netUnits * (sellPctOfNetVest / 100)).toFixed(3)
    );
  }

  // Route proceeds from sell-at-vest into underweight Indian Equity & Debt
  const desiredIndianINR = projectedLiquidIfHeldINR * targetIndianOfTotalRatio;
  const desiredDebtINR = projectedLiquidIfHeldINR * targetDebtRatio;
  const indianGap = Math.max(0, desiredIndianINR - baseIndianINR);
  const debtGap = Math.max(0, desiredDebtINR - baseDebtINR);
  const gapSum = indianGap + debtGap;

  const deployToIndianEquityINR =
    gapSum > 0 ? sellValueINR * (indianGap / gapSum) : sellValueINR * targetIndianOfEqRatio;
  const deployToDebtArbitrageINR = Math.max(0, sellValueINR - deployToIndianEquityINR);

  const postPlaybookAAlignment = computeSimpleAlignment(
    baseIndianINR + deployToIndianEquityINR,
    projectedForeignIfHeldINR - sellValueINR,
    baseDebtINR + deployToDebtArbitrageINR
  );

  // Playbook B: Keep 100% of vesting RSUs and counter-balance purely via monthly INR SIPs!
  // For projectedForeignIfHeldINR to equal targetForeignOfTotalRatio of final portfolio:
  // FinalTotalRequired = projectedForeignIfHeldINR / targetForeignOfTotalRatio
  const requiredTotalForZeroSell =
    targetForeignOfTotalRatio > 0.02
      ? projectedForeignIfHeldINR / targetForeignOfTotalRatio
      : projectedLiquidIfHeldINR;
  const totalSipNeededINR = Math.max(0, requiredTotalForZeroSell - projectedLiquidIfHeldINR);
  const requiredMonthlySipINR = horizonMonths > 0 ? totalSipNeededINR / horizonMonths : 0;

  const targetIndInFinal = requiredTotalForZeroSell * targetIndianOfTotalRatio;
  const targetDebtInFinal = requiredTotalForZeroSell * targetDebtRatio;
  const indSipGap = Math.max(0, targetIndInFinal - baseIndianINR);
  const debtSipGap = Math.max(0, targetDebtInFinal - baseDebtINR);
  const sipGapSum = indSipGap + debtSipGap;

  const monthlyIndianEquitySipINR =
    sipGapSum > 0
      ? requiredMonthlySipINR * (indSipGap / sipGapSum)
      : requiredMonthlySipINR * (targetIndianOfTotalRatio / Math.max(0.01, 1 - targetForeignOfTotalRatio));
  const monthlyDebtSipINR = Math.max(0, requiredMonthlySipINR - monthlyIndianEquitySipINR);

  const postPlaybookBAlignment = computeSimpleAlignment(
    baseIndianINR + monthlyIndianEquitySipINR * horizonMonths,
    projectedForeignIfHeldINR,
    baseDebtINR + monthlyDebtSipINR * horizonMonths
  );

  // Build Timeline Checkpoints (Now, +3M, +6M, +9M, +12M / +24M)
  const stepMonths = horizonMonths <= 6 ? [0, 2, 4, 6] : horizonMonths <= 12 ? [0, 3, 6, 9, 12] : [0, 6, 12, 18, 24];
  const timelineCheckpoints = stepMonths.map((m) => {
    const cutoffMs = nowMs + m * 30.4375 * 86_400_000;
    const cumVest =
      m === 0
        ? 0
        : upcomingEvents
            .filter((ev) => Date.parse(ev.vestDate) <= cutoffMs)
            .reduce((s, ev) => s + ev.netVestValueINR, 0);
    const fVal = m === 0 ? stats.foreignEquityValINR : baseForeignINR + cumVest;
    const tot = baseIndianINR + fVal + baseDebtINR;
    return {
      label: m === 0 ? 'Now' : `+${m}M`,
      liquidTotalINR: Math.round(tot),
      foreignEqPctOfTotal: tot > 0 ? Number(((fVal / tot) * 100).toFixed(1)) : 0,
      indianEqPctOfTotal: tot > 0 ? Number(((baseIndianINR / tot) * 100).toFixed(1)) : 0,
      debtPctOfTotal: tot > 0 ? Number(((baseDebtINR / tot) * 100).toFixed(1)) : 0,
      targetForeignPctOfTotal: Number((targetForeignOfTotalRatio * 100).toFixed(1)),
      cumulativeVestAddedINR: Math.round(cumVest)
    };
  });

  const projectedTopTickerINR =
    currentTopTickerINR * priceMult + (rsuVestByTicker.get(topRsuTicker) || 0);

  return {
    horizonMonths,
    priceScenarioPct,
    upcomingEvents,
    totalGrossUnitsVesting,
    totalNetUnitsVesting,
    totalNetVestValueINR,
    currentLiquidINR,
    projectedLiquidIfHeldINR,
    currentEquityPct,
    projectedEquityPctIfHeld,
    targetEquityPct: targetEquityRatio * 100,
    currentForeignOfEqPct,
    projectedForeignOfEqPctIfHeld,
    targetForeignOfEqPct: targetForeignOfEqRatio * 100,
    currentAlignmentPct,
    projectedAlignmentIfHeldPct,
    topRsuTicker,
    currentTopTickerConcentrationPct:
      currentLiquidINR > 0 ? (currentTopTickerINR / currentLiquidINR) * 100 : 0,
    projectedTopTickerConcentrationPct:
      projectedLiquidIfHeldINR > 0 ? (projectedTopTickerINR / projectedLiquidIfHeldINR) * 100 : 0,
    timelineCheckpoints,
    playbookSellAtVest: {
      sellPctOfNetVest,
      sellValueINR,
      estimatedCapGainsTaxINR: 0,
      deployToIndianEquityINR,
      deployToDebtArbitrageINR,
      resultingAlignmentPct: postPlaybookAAlignment
    },
    playbookHoldAndSip: {
      requiredMonthlySipINR,
      monthlyIndianEquitySipINR,
      monthlyDebtSipINR,
      totalSipOverHorizonINR: totalSipNeededINR,
      resultingAlignmentPct: postPlaybookBAlignment
    }
  };
}

// ============================================================================
// TRUE CASH-FLOW XIRR SOLVER (Newton-Raphson + Bisection Fallback)
// ============================================================================

export function computeXirrFromEvaluatedLots(
  evaluatedLots: EvaluatedTaxLot[],
  nowMs = Date.now()
): { xirrPct: number | null; investedINR: number; currentINR: number; absoluteGainPct: number } {
  let investedINR = 0;
  let currentINR = 0;
  const flows: { amount: number; yearsFromStart: number; ts: number }[] = [];

  for (const ev of evaluatedLots) {
    const ts = Date.parse(ev.lot.acquiredDate || '');
    if (isNaN(ts) || ev.costBasisINR <= 0 || ev.marketValueINR <= 0) continue;
    // Require at least 15 days elapsed so brand-new same-day lots don't blow up annualized math
    if (nowMs - ts < 15 * 86_400_000) continue;
    investedINR += ev.costBasisINR;
    currentINR += ev.marketValueINR;
    flows.push({ amount: -ev.costBasisINR, yearsFromStart: 0, ts });
  }

  if (flows.length === 0 || investedINR <= 0 || currentINR <= 0) {
    return { xirrPct: null, investedINR: 0, currentINR: 0, absoluteGainPct: 0 };
  }

  flows.push({ amount: currentINR, yearsFromStart: 0, ts: nowMs });
  const t0 = Math.min(...flows.map((f) => f.ts));
  for (const f of flows) {
    f.yearsFromStart = (f.ts - t0) / (365.25 * 86_400_000);
  }

  const npv = (rate: number) =>
    flows.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, f.yearsFromStart), 0);

  const dNpv = (rate: number) =>
    flows.reduce(
      (acc, f) =>
        f.yearsFromStart === 0
          ? acc
          : acc - (f.yearsFromStart * f.amount) / Math.pow(1 + rate, f.yearsFromStart + 1),
      0
    );

  // Newton-Raphson starting at 12%
  let r = 0.12;
  let converged = false;
  for (let i = 0; i < 45; i++) {
    const val = npv(r);
    if (Math.abs(val) < 1e-3) {
      converged = true;
      break;
    }
    const deriv = dNpv(r);
    if (Math.abs(deriv) < 1e-9) break;
    const next = r - val / deriv;
    if (next <= -0.95 || next > 10 || isNaN(next)) break;
    r = next;
  }

  // Bisection fallback in [-0.90, 5.0]
  if (!converged) {
    let lo = -0.9;
    let hi = 5.0;
    let fLo = npv(lo);
    const fHi = npv(hi);
    if (fLo * fHi < 0) {
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const fMid = npv(mid);
        if (Math.abs(fMid) < 1e-2) {
          r = mid;
          converged = true;
          break;
        }
        if (fLo * fMid < 0) {
          hi = mid;
        } else {
          lo = mid;
          fLo = fMid;
        }
        r = mid;
      }
      converged = true;
    }
  }

  const absoluteGainPct = ((currentINR - investedINR) / investedINR) * 100;
  return {
    xirrPct: converged ? Number((r * 100).toFixed(2)) : null,
    investedINR,
    currentINR,
    absoluteGainPct: Number(absoluteGainPct.toFixed(2))
  };
}

// ============================================================================
// COMPLIANCE & ESTATE EXPORTS: ITR SCHEDULE FA (FOREIGN ASSETS) + FAMILY ICE
// ============================================================================

export function buildScheduleFaCsv(params: {
  holdings: EnrichedHolding[];
  taxLots: TaxLot[];
  members: { id: string; name: string }[];
  fxRate: number;
  calendarYear?: number;
}): string {
  const { holdings, taxLots, members, fxRate, calendarYear = new Date().getFullYear() } = params;
  const safeFx = fxRate > 0 ? fxRate : FX_FALLBACK_RATE;
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  const foreignHoldings = holdings.filter((h) => !h.isPlaceholder && h.currency === 'USD' && h.valINR > 0);

  const header = [
    'Calendar_Year_ITR_Schedule_FA',
    'Family_Member_PAN_Holder',
    'Country_Name_and_Code',
    'Custodian_Broker',
    'Foreign_Entity_Ticker',
    'Security_Name',
    'Acquisition_or_Vest_Date',
    'Nature_of_Acquisition',
    'Open_Units',
    'Initial_Value_INR_Est',
    'Est_Peak_Balance_During_CY_INR_Verify_Stmt',
    'Closing_Value_USD',
    'Closing_Value_INR',
    'FX_Rate_Used'
  ];

  const rows: (string | number)[][] = [header];

  for (const h of foreignHoldings) {
    const ownerName = memberMap.get(getHoldingOwnerId(h)) || 'Primary Holder';
    const lots = getLotsForHolding(h, taxLots);

    if (lots.length > 0) {
      for (const lot of lots) {
        const buyFx = Number(lot.fxRateAtBuy) > 0 ? Number(lot.fxRateAtBuy) : safeFx;
        const initINR = Math.round(lot.quantity * lot.costPerUnit * buyFx);
        const closeUSD = Number((lot.quantity * h.currentPrice).toFixed(2));
        const closeINR = Math.round(closeUSD * safeFx);
        const estPeakINR = Math.max(initINR, closeINR);
        rows.push([
          `CY ${calendarYear} (Jan 1 - Dec 31)`,
          `"${ownerName.replace(/"/g, '""')}"`,
          '"United States of America (Code: 2)"',
          `"${(h.provider || 'US Broker').replace(/"/g, '""')}"`,
          h.ticker,
          `"${(h.originalName || h.ticker).replace(/"/g, '""')}"`,
          lot.acquiredDate,
          lot.acquisitionType,
          lot.quantity,
          initINR,
          estPeakINR,
          closeUSD,
          closeINR,
          safeFx.toFixed(2)
        ]);
      }
    } else {
      const closeUSD = Number((h.quantity * h.currentPrice).toFixed(2));
      const closeINR = Math.round(closeUSD * safeFx);
      rows.push([
        `CY ${calendarYear} (Jan 1 - Dec 31)`,
        `"${ownerName.replace(/"/g, '""')}"`,
        '"United States of America (Code: 2)"',
        `"${(h.provider || 'US Broker').replace(/"/g, '""')}"`,
        h.ticker,
        `"${(h.originalName || h.ticker).replace(/"/g, '""')}"`,
        'ADD_VEST_OR_BUY_DATE',
        'Holdings Balance',
        h.quantity,
        closeINR,
        closeINR,
        closeUSD,
        closeINR,
        safeFx.toFixed(2)
      ]);
    }
  }

  return rows.map((r) => r.join(',')).join('\n');
}

export function openPrintableFamilyIceSheet(params: {
  householdName: string;
  members: { id: string; name: string }[];
  holdings: EnrichedHolding[];
  realEstateProperties: RealEstateProperty[];
  rsuGrants: RsuGrant[];
  nomineeMap?: Record<string, string>;
  fxRate: number;
}) {
  const {
    householdName,
    members,
    holdings,
    realEstateProperties,
    rsuGrants,
    nomineeMap = {},
    fxRate
  } = params;
  const safeFx = fxRate > 0 ? fxRate : FX_FALLBACK_RATE;
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const active = holdings.filter((h) => !h.isPlaceholder && h.valINR > 0);
  const liquidTotal = active.reduce((s, h) => s + h.valINR, 0);

  // Group by Owner + Custodian
  const accountSummary = new Map<
    string,
    { owner: string; provider: string; currency: string; count: number; totalINR: number; key: string }
  >();

  for (const h of active) {
    const owner = memberMap.get(getHoldingOwnerId(h)) || 'Family Member';
    const provider = h.provider || 'Direct / Manual';
    const key = `${owner}|${provider}`;
    const prev = accountSummary.get(key) || {
      owner,
      provider,
      currency: h.currency,
      count: 0,
      totalINR: 0,
      key
    };
    prev.count += 1;
    prev.totalINR += h.valINR;
    accountSummary.set(key, prev);
  }

  const escapeHtml = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const accountRows = [...accountSummary.values()]
    .sort((a, b) => b.totalINR - a.totalINR)
    .map((a) => {
      const nomineeStatus = nomineeMap[a.key] || 'Verify & Record Nominee in Broker Portal';
      return `<tr>
        <td><strong>${escapeHtml(a.owner)}</strong></td>
        <td>${escapeHtml(a.provider)} (${escapeHtml(a.currency)})</td>
        <td style="text-align:right">${a.count}</td>
        <td style="text-align:right"><strong>${formatCompactINR(a.totalINR)}</strong></td>
        <td>${escapeHtml(nomineeStatus)}</td>
      </tr>`;
    })
    .join('');

  const reRows = realEstateProperties
    .map(
      (p) => `<tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.loanConfig?.lender || 'Self Funded')}</td>
      <td style="text-align:right">${formatCompactINR(p.agreementValueINR || 0)}</td>
      <td style="text-align:right">${formatCompactINR(p.manualSelfPaidINR || 0)}</td>
      <td style="text-align:right">${formatCompactINR(p.manualLoanDisbursedINR || 0)} @ ${p.loanConfig?.interestRatePct || 0}%</td>
    </tr>`
    )
    .join('');

  const rsuRows = rsuGrants
    .map((g) => {
      const unvestedUnits = (g.vestSchedule || [])
        .filter((v) => !v.vested)
        .reduce((s, v) => s + (Number(v.grossUnits) || 0), 0);
      return `<tr>
        <td><strong>${escapeHtml(memberMap.get(g.ownerId) || 'Member')}</strong></td>
        <td>${escapeHtml(g.ticker)} — ${escapeHtml(g.grantName)}</td>
        <td>${escapeHtml(g.provider)}</td>
        <td style="text-align:right">${unvestedUnits.toLocaleString('en-IN')} gross sh</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(householdName)} — Emergency Family Wealth & Nominee Directory (ICE)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; color: #0f172a; padding: 32px; max-width: 920px; margin: 0 auto; line-height: 1.5; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #4f46e5; margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 16px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #475569; }
    .note { background: #f8fafc; border-left: 4px solid #4f46e5; padding: 12px 14px; font-size: 12px; color: #334155; margin-top: 24px; }
    @media print { .no-print { display: none; } body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:18px; display:flex; justify-content:space-between; align-items:center;">
    <span style="font-size:12px; color:#64748b;">Confidential Family Estate & Emergency Readiness Summary</span>
    <button onclick="window.print()" style="background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;">Print / Save as PDF</button>
  </div>
  <h1>${escapeHtml(householdName)} — In Case of Emergency (ICE) Asset Directory</h1>
  <div class="meta">Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} • Liquid Portfolio: <strong>${formatCompactINR(liquidTotal)}</strong> • USD/INR: ₹${safeFx.toFixed(2)}</div>

  <h2>1. Financial Custodians, Brokerage & Mutual Fund Accounts</h2>
  <table>
    <thead>
      <tr><th>Owner</th><th>Institution / Custodian</th><th style="text-align:right">Holdings</th><th style="text-align:right">Approx Value</th><th>Nominee / Claim Note</th></tr>
    </thead>
    <tbody>${accountRows || '<tr><td colspan="5">No liquid accounts recorded yet.</td></tr>'}</tbody>
  </table>

  ${
    reRows
      ? `<h2>2. Real Estate & Active Home Loan Liabilities</h2>
      <table>
        <thead><tr><th>Property</th><th>Lender</th><th style="text-align:right">Agreement Value</th><th style="text-align:right">Self Equity Paid</th><th style="text-align:right">Loan Disbursed</th></tr></thead>
        <tbody>${reRows}</tbody>
      </table>`
      : ''
  }

  ${
    rsuRows
      ? `<h2>3. Employer Unvested Stock / RSU Grants (Check Employer Death/Accelerated Vesting Policy)</h2>
      <table>
        <thead><tr><th>Employee</th><th>Ticker & Grant</th><th>Broker Portal</th><th style="text-align:right">Unvested Shares</th></tr></thead>
        <tbody>${rsuRows}</tbody>
      </table>`
      : ''
  }

  <div class="note">
    <strong>Important Family Claim Checklist:</strong><br/>
    • <strong>Indian Mutual Funds & Demat (CAMS / MFCentral / Zerodha):</strong> Claims are processed centrally via <em>MFCentral.com</em> or depository participant using registered Nominee KYC.<br/>
    • <strong>US Brokerage / Employer RSUs (E*TRADE / Charles Schwab / IBKR):</strong> Verify <em>Transfer on Death (TOD) / W-8BEN Beneficiary</em> designation inside the US broker portal (avoids US probate delays for non-US residents).<br/>
    • <strong>Home Loans:</strong> Check if credit-life / term insurance is assigned or keep emergency EMI buffer in joint savings.
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
