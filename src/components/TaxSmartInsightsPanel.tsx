import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Coins,
  Download,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Landmark
} from 'lucide-react';
import {
  IncomeBracketKey,
  RealEstateProperty,
  RsuGrant,
  TaxLot,
  TaxProfileSettings
} from '../types';
import { formatCompactINR } from '../shared/formatters';
import { ComputedPortfolioStats } from '../shared/portfolioMath';
import {
  buildScheduleFaCsv,
  optimizeSellOrderLots,
  PortfolioTaxIntelligence
} from '../shared/taxAndRsuMath';
import { shortenAssetName } from '../lib/formatAssetName';

interface TaxSmartInsightsPanelProps {
  householdId: string;
  stats: ComputedPortfolioStats;
  intel: PortfolioTaxIntelligence;
  taxLots: TaxLot[];
  rsuGrants: RsuGrant[];
  taxProfile: TaxProfileSettings;
  members: { id: string; name: string }[];
  realEstateProperties: RealEstateProperty[];
  fxRate: number;
  accuracy: number;
  onSaveTaxProfile: (next: TaxProfileSettings) => Promise<void>;
  onAskAiCopilot: (question: string, contextSummary: any) => Promise<{
    headline: string;
    directAnswer: string;
    actionSteps: string[];
    taxAlphaNote: string;
  }>;
  onJumpToHoldings?: () => void;
}

export const TaxSmartInsightsPanel: React.FC<TaxSmartInsightsPanelProps> = ({
  stats,
  intel,
  taxLots,
  rsuGrants,
  taxProfile,
  members,
  realEstateProperties,
  fxRate,
  accuracy,
  onSaveTaxProfile,
  onAskAiCopilot,
  onJumpToHoldings
}) => {
  // Detect next upcoming unpaid Real Estate demand if present
  const nextBuilderDemand = useMemo(() => {
    for (const prop of realEstateProperties) {
      for (const dem of prop.demands || []) {
        if (dem.status !== 'paid' && dem.demandAmountINR > 0) {
          const paidSoFar = (dem.swipes || []).reduce(
            (s, sw) => s + (Number(sw.receivedByBuilderINR || sw.paymentAmountINR) || 0),
            0
          );
          const pending = Math.max(0, dem.demandAmountINR - paidSoFar);
          const selfTarget =
            typeof dem.plannedSelfINR === 'number' && dem.plannedSelfINR > 0
              ? Math.min(pending, dem.plannedSelfINR)
              : pending;
          if (selfTarget > 50_000) {
            return {
              propertyName: prop.name,
              title: dem.title,
              dueDate: dem.dueDate,
              amountINR: Math.round(selfTarget)
            };
          }
        }
      }
    }
    return null;
  }, [realEstateProperties]);

  const [showCashRaiser, setShowCashRaiser] = useState<boolean>(Boolean(nextBuilderDemand));
  const [cashGoalINR, setCashGoalINR] = useState<number>(
    nextBuilderDemand?.amountINR || 1_000_000
  );

  // AI Copilot State
  const [aiQuestion, setAiQuestion] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiResponse, setAiResponse] = useState<{
    headline: string;
    directAnswer: string;
    actionSteps: string[];
    taxAlphaNote: string;
  } | null>(null);

  const cashRaisePlan = useMemo(
    () =>
      showCashRaiser && cashGoalINR > 0
        ? optimizeSellOrderLots({
            orderTitle: 'Smart Cash Raise',
            orderCategory: 'Smart Cash Raiser',
            targetSellINR: cashGoalINR,
            intel,
            stats,
            taxProfile
          })
        : null,
    [showCashRaiser, cashGoalINR, intel, stats, taxProfile]
  );

  const hasForeignHoldings = useMemo(
    () => stats.holdings.some((h) => !h.isPlaceholder && h.currency === 'USD' && h.valINR > 0),
    [stats.holdings]
  );

  const handleDownloadScheduleFa = () => {
    const csv = buildScheduleFaCsv({
      holdings: stats.holdings,
      taxLots,
      members,
      fxRate
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unitywealth-ITR-Schedule-FA-CY${new Date().getFullYear()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const buildCopilotContext = () => ({
    bracketLabel: intel.rates.bracketLabel,
    marginalRatePct: intel.rates.marginalSlabEffectivePct,
    ltcgRatePct: intel.rates.ltcgEffectivePct,
    indianEqStcgRatePct: intel.rates.indianEqStcgEffectivePct,
    alignmentPct: Number(accuracy.toFixed(1)),
    liquidPortfolioINR: Math.round(stats.totalValINR),
    actualEquityPct: Number((stats.actualEquityPct * 100).toFixed(1)),
    targetEquityPct: Number((stats.targetEquityPct * 100).toFixed(1)),
    actualForeignOfEqPct: Number((stats.actualForeignEquityPctOfEquity * 100).toFixed(1)),
    targetForeignOfEqPct: Number((stats.targetForeignEquityOfEquity * 100).toFixed(1)),
    datedLotCoveragePct: Number(intel.coveragePct.toFixed(1)),
    ltcgPoolINR: Math.round(intel.ltcgValueINR),
    stcgPoolINR: Math.round(intel.stcgValueINR),
    cliffAlerts: intel.cliffAlerts.slice(0, 5),
    sec112aHarvestByMember: intel.sec112aHarvestByMember,
    lossHarvestCandidates: intel.lossHarvestCandidates.slice(0, 5),
    homeLoanInsight: intel.homeLoanArbitrageInsight,
    nextBuilderDemand,
    unvestedRsuCount: rsuGrants.length,
    topDatedLots: intel.evaluatedLots.slice(0, 18).map((ev) => ({
      ticker: ev.holding.ticker,
      owner: ev.ownerName,
      provider: ev.holding.provider,
      acquiredDate: ev.lot.acquiredDate,
      source: ev.lot.acquisitionType,
      isLtcg: ev.isLtcg,
      daysToLtcgCliff: ev.daysToLtcgCliff,
      valueINR: Math.round(ev.marketValueINR),
      gainINR: Math.round(ev.unrealizedGainINR),
      taxRatePct: ev.applicableTaxRatePct,
      taxDragPct: Number(ev.taxDragPct.toFixed(2))
    }))
  });

  const triggerAiPrompt = async (q: string) => {
    const cleanQ = q.trim();
    if (!cleanQ) return;
    setAiQuestion(cleanQ);
    setAiLoading(true);
    try {
      const resp = await onAskAiCopilot(cleanQ, buildCopilotContext());
      setAiResponse(resp);
    } finally {
      setAiLoading(false);
    }
  };

  const totalSec112aHarvestableINR = intel.sec112aHarvestByMember.reduce(
    (s, m) => s + m.harvestableNowINR,
    0
  );
  const totalSec112aTaxSavedINR = intel.sec112aHarvestByMember.reduce(
    (s, m) => s + m.potentialTaxSavedINR,
    0
  );

  return (
    <div className="space-y-4">
      {/* Compact Tax Profile & Schedule FA Bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
                <ShieldCheck size={15} /> India High-Income Tax Intelligence
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                LTCG Capped @ {intel.rates.ltcgEffectivePct}%
              </span>
              <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black">
                US/Debt STCG @ {intel.rates.marginalSlabEffectivePct}%
              </span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                Ind Eq STCG @ {intel.rates.indianEqStcgEffectivePct}%
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Dated tax-lot coverage: <strong>{intel.coveragePct.toFixed(0)}%</strong> of liquid portfolio
              {intel.coveragePct < 80 && onJumpToHoldings && (
                <button
                  type="button"
                  onClick={onJumpToHoldings}
                  className="ml-1.5 text-indigo-600 font-bold hover:underline"
                >
                  (+ Tag buy/vest dates in Holdings →)
                </button>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Annual Income Tax Bracket"
              value={taxProfile.incomeBracket}
              onChange={(e) =>
                onSaveTaxProfile({
                  ...taxProfile,
                  incomeBracket: e.target.value as IncomeBracketKey
                })
              }
              className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800"
            >
              <option value="1cr_to_2cr">Income ₹1 Cr – ₹2 Cr (15% Surcharge • 35.88%)</option>
              <option value="2cr_to_5cr">Income ₹2 Cr – ₹5 Cr (25% Surcharge • 39.00%)</option>
              <option value="above_5cr">Income &gt; ₹5 Cr (New Regime 25% Cap • 39.00%)</option>
              <option value="50l_to_1cr">Income ₹50L – ₹1 Cr (10% Surcharge • 34.32%)</option>
              <option value="below_50l">Income &lt; ₹50L (0% Surcharge • 31.20%)</option>
            </select>

            {hasForeignHoldings && (
              <button
                type="button"
                onClick={handleDownloadScheduleFa}
                className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs"
                title="Download Calendar-Year Foreign Assets disclosure worksheet for Indian ITR Schedule FA"
              >
                <Download size={13} /> ITR Schedule FA CSV
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowCashRaiser((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                showCashRaiser
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
            >
              <Coins size={13} /> Raise Cash (Min Tax)
            </button>
          </div>
        </div>

        {/* Proactive Insights Cards */}
        {(intel.cliffAlerts.length > 0 ||
          totalSec112aHarvestableINR > 5_000 ||
          intel.lossHarvestCandidates.length > 0 ||
          intel.arbitrageSwapOpportunity ||
          intel.homeLoanArbitrageInsight) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            {/* 1. LTCG Cliff Guard */}
            {intel.cliffAlerts.map((cl) => (
              <div
                key={cl.lotId}
                className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase text-amber-800 flex items-center gap-1">
                    <AlertTriangle size={12} /> LTCG Cliff Guard • Wait {cl.daysToLtcg} Days!
                  </span>
                  <span className="text-xs font-black text-emerald-700">
                    Save {formatCompactINR(cl.taxSavedByWaitingINR)} Tax
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  <strong>{cl.ownerName}&apos;s {shortenAssetName(cl.assetName, cl.ticker)}</strong> ({cl.units} sh from {cl.acquiredDate}) crosses LTCG in{' '}
                  <strong>{cl.daysToLtcg} days</strong> — cutting tax from{' '}
                  {formatCompactINR(cl.taxNowINR)} to {formatCompactINR(cl.taxAfterCliffINR)}. Do not sell this tranche yet!
                </p>
              </div>
            ))}

            {/* 2. Family Multi-PAN Sec 112A Tax-Gain Harvesting */}
            {totalSec112aHarvestableINR > 5_000 && (
              <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase text-emerald-800 flex items-center gap-1">
                    <Sparkles size={12} /> Multi-PAN ₹1.25L Tax-Free LTCG Harvest
                  </span>
                  <span className="text-xs font-black text-emerald-700">
                    Save {formatCompactINR(totalSec112aTaxSavedINR)}/yr
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Harvest <strong>{formatCompactINR(totalSec112aHarvestableINR)}</strong> of Indian Equity / Arbitrage LTCG at{' '}
                  <strong>₹0 tax</strong> across{' '}
                  {intel.sec112aHarvestByMember
                    .filter((m) => m.harvestableNowINR > 0)
                    .map((m) => `${m.memberName} (${formatCompactINR(m.harvestableNowINR)} free)`)
                    .join(' + ')}{' '}
                  and immediately re-buy to step up cost basis.
                </p>
              </div>
            )}

            {/* 3. Tax-Loss Harvesting */}
            {intel.lossHarvestCandidates.length > 0 && (
              <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase text-indigo-800 flex items-center gap-1">
                    <TrendingDown size={12} /> Tax-Loss Harvest Shield
                  </span>
                  <span className="text-xs font-black text-indigo-700">
                    Offset {formatCompactINR(
                      intel.lossHarvestCandidates.reduce((s, c) => s + c.potentialTaxShieldINR, 0)
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {intel.lossHarvestCandidates
                    .slice(0, 2)
                    .map(
                      (c) =>
                        `${c.ownerName}'s ${shortenAssetName(c.assetName, c.ticker)} (${formatCompactINR(c.unrealizedLossINR)} loss)`
                    )
                    .join(' & ')}{' '}
                  can be sold at ₹0 tax to offset taxable rebalance gains.
                </p>
              </div>
            )}

            {/* 4. Home Loan vs Arbitrage OR Debt-to-Arbitrage Tax Alpha */}
            {intel.homeLoanArbitrageInsight ? (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase text-slate-700 flex items-center gap-1">
                    <Landmark size={12} className="text-indigo-600" /> Home Loan ({intel.homeLoanArbitrageInsight.loanRatePct}%) vs Arbitrage ({intel.homeLoanArbitrageInsight.postTaxArbitrageYieldPct}% Post-Tax)
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {intel.homeLoanArbitrageInsight.recommendation}
                </p>
              </div>
            ) : intel.arbitrageSwapOpportunity ? (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase text-slate-700">
                    Arbitrage vs Taxable Debt / FD Alpha
                  </span>
                  <span className="text-xs font-black text-emerald-600">
                    +{formatCompactINR(intel.arbitrageSwapOpportunity.annualTaxSavedViaArbitrageINR)}/yr
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Holding {formatCompactINR(intel.arbitrageSwapOpportunity.taxableDebtValueINR)} in Arbitrage MFs (&gt;12M) cuts yield tax from{' '}
                  {intel.rates.marginalSlabEffectivePct}% to {intel.rates.ltcgEffectivePct}% while keeping Debt safety.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Smart Cash Raiser (Bridges Real Estate Builder Demands + Lowest-Tax Lot Liquidation) */}
      {showCashRaiser && cashRaisePlan && (
        <div className="bg-white p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
                <Coins size={14} /> Smart Minimum-Tax Cash Raiser
                {nextBuilderDemand && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                    Linked: {nextBuilderDemand.title}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Selects the exact cross-family tranches that free cash with the lowest rupee tax outflow.
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[500_000, 1_500_000, 2_500_000, 5_000_000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setCashGoalINR(amt)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                    cashGoalINR === amt
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {formatCompactINR(amt)}
                </button>
              ))}
              <input
                type="number"
                aria-label="Target Cash to Raise in INR"
                value={cashGoalINR}
                onChange={(e) => setCashGoalINR(Math.max(0, Number(e.target.value)))}
                className="w-32 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono font-black text-slate-900"
              />
            </div>
          </div>

          {cashRaisePlan.slices.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs">
                <span className="font-bold text-slate-800">
                  Dated Lots Selected: <strong>{formatCompactINR(cashRaisePlan.coveredByDatedLotsINR)}</strong> • Est. Tax:{' '}
                  <strong className="text-emerald-700">{formatCompactINR(cashRaisePlan.totalEstimatedTaxINR)}</strong> (
                  {cashRaisePlan.effectiveTaxDragPct.toFixed(2)}% drag)
                </span>
                {cashRaisePlan.estimatedTaxSavedINR > 1_000 && (
                  <span className="font-black text-emerald-700">
                    Saves ~{formatCompactINR(cashRaisePlan.estimatedTaxSavedINR)} vs naive STCG sale!
                  </span>
                )}
              </div>

              <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                {cashRaisePlan.slices.map((sl) => (
                  <div
                    key={`${sl.lotId}-cash`}
                    className="px-3.5 py-2.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>Sell {sl.sellUnits} units of {shortenAssetName(sl.assetName, sl.ticker)}</span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-black">
                          {sl.ownerName} • {sl.provider}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-black">
                          {sl.reasonBadge}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Lot Date: <span className="font-mono font-semibold">{sl.acquiredDate}</span> ({sl.acquisitionType} •{' '}
                        {sl.executionMethod})
                      </div>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <div className="font-black text-slate-900 tabular-nums">
                        Frees {formatCompactINR(sl.sellProceedsINR)}
                      </div>
                      <div className="text-[10px] font-bold text-slate-500">
                        Est. Tax: {formatCompactINR(sl.estimatedTaxINR)} ({sl.taxDragPct.toFixed(2)}% drag)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Add purchase or RSU vest dates to your holdings in the Overview / Holdings table to unlock lot-by-lot cash liquidation ranking.
            </p>
          )}
        </div>
      )}

      {/* Gemini AI Chief Investment Officer & Tax Strategist */}
      <div className="bg-slate-900 text-white p-4 sm:p-6 rounded-2xl shadow-lg space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300">
              <Bot size={18} />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-indigo-300">
                AI Tax &amp; Wealth Strategist (Gemini)
              </div>
              <p className="text-[11px] text-slate-300">
                Grounded in your live {intel.rates.bracketLabel} tax rates, open lots, RSU vests &amp; property demands
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            'Which exact lots should I sell to rebalance with lowest tax?',
            nextBuilderDemand
              ? `How should I raise ${formatCompactINR(nextBuilderDemand.amountINR)} for ${nextBuilderDemand.title}?`
              : 'How can I harvest maximum tax-free LTCG across family PANs?',
            'What should I do when my next RSU vests if stock price stays flat?',
            'Should I prepay my home loan or invest surplus in Arbitrage MFs?'
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={aiLoading}
              onClick={() => triggerAiPrompt(preset)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-left text-[11px] font-semibold text-slate-200 transition-colors border border-white/10"
            >
              {preset}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            triggerAiPrompt(aiQuestion);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            placeholder="Ask anything about your tax lots, RSU vests, rebalancing, or builder payments..."
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
          <button
            type="submit"
            disabled={aiLoading || !aiQuestion.trim()}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
          >
            {aiLoading ? <RefreshCcw size={14} className="animate-spin" /> : <Send size={14} />}
            Ask AI
          </button>
        </form>

        {aiResponse && (
          <div className="p-4 rounded-xl bg-white/8 border border-indigo-400/30 space-y-2.5">
            <div className="text-sm font-black text-white">{aiResponse.headline}</div>
            <p className="text-xs text-slate-200 leading-relaxed">{aiResponse.directAnswer}</p>
            {aiResponse.actionSteps.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {aiResponse.actionSteps.map((step, i) => (
                  <li key={i} className="text-xs text-indigo-100 flex items-start gap-2">
                    <span className="px-1.5 py-0.2 rounded bg-indigo-500/40 text-[10px] font-black shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            )}
            {aiResponse.taxAlphaNote && (
              <div className="pt-2 border-t border-white/10 text-[11px] font-bold text-emerald-300">
                💡 {aiResponse.taxAlphaNote}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
