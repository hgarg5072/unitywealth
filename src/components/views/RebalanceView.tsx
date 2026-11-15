import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Download,
  ExternalLink,
  Mail,
  RefreshCcw,
  ShieldCheck
} from 'lucide-react';
import { EmailStatusPublic } from '../../types';
import { FX_FALLBACK_RATE, formatCompactINR } from '../../shared/formatters';
import { ComputedPortfolioStats, computeRebalancePlan } from '../../shared/portfolioMath';

export interface RebalanceViewProps {
  stats: ComputedPortfolioStats;
  fxRates: Record<string, number>;
  householdName?: string;
  defaultEmail?: string;
  threshold?: number;
  emailStatus?: EmailStatusPublic | null;
  onOpenEmailSettings?: () => void;
  onSendRebalanceEmail?: (params: {
    toEmail: string;
    mode: 'full' | 'sip';
    freshInflowINR?: number;
    clientReport: any;
  }) => Promise<any>;
}

export default function RebalanceView({
  stats,
  fxRates,
  householdName,
  defaultEmail,
  threshold = 95,
  emailStatus,
  onOpenEmailSettings,
  onSendRebalanceEmail
}: RebalanceViewProps) {
  const [rebalanceMode, setRebalanceMode] = useState<'full' | 'sip'>('full');
  const [freshInflowINR, setFreshInflowINR] = useState<number>(150000);
  const [recipientEmail, setRecipientEmail] = useState<string>(defaultEmail || '');
  const [isEmailingPlan, setIsEmailingPlan] = useState(false);
  const [emailPlanResult, setEmailPlanResult] = useState<{
    sent: boolean;
    message?: string;
    gmailComposeUrl?: string;
  } | null>(null);

  const plan = useMemo(
    () =>
      computeRebalancePlan({
        stats,
        fxRate: fxRates.INR || FX_FALLBACK_RATE,
        freshInflowINR
      }),
    [stats, fxRates.INR, freshInflowINR]
  );

  const { accuracy, suggestions, sipOrders, sipPostAccuracy } = plan;
  const activeOrders = rebalanceMode === 'sip' ? sipOrders : suggestions;

  const sortedOrders = useMemo(
    () => [...activeOrders].sort((a, b) => b.amountRaw - a.amountRaw),
    [activeOrders]
  );

  const narrative = useMemo(() => {
    if (!stats || suggestions.length === 0) return 'Your portfolio is perfectly balanced.';

    const assetAction =
      stats.equityDrift > 0.02
        ? 'Reduce Equity'
        : stats.equityDrift < -0.02
        ? 'Increase Equity'
        : 'Overall Asset Mix is Balanced';

    const categoryTrades: string[] = [];
    stats.foreignBreakdownStats.forEach((cat: any) => {
      const sells = suggestions.filter(
        (s) => s.category === cat.name && s.type === 'sell' && s.isTickerLevel
      );
      const buys = suggestions.filter(
        (s) => s.category === cat.name && s.type === 'buy' && s.isTickerLevel
      );
      if (sells.length > 0 && buys.length > 0) {
        categoryTrades.push(
          `Within ${cat.name}, swap some ${sells
            .map((s) => s.title.split(' ')[1])
            .join(', ')} into ${buys.map((b) => b.title.split(' ')[1]).join(', ')}.`
        );
      }
    });

    return {
      main: `Your portfolio alignment is at ${accuracy.toFixed(1)}%. ${assetAction}.`,
      secondary:
        categoryTrades.length > 0
          ? categoryTrades[0]
          : 'Focus on adjusting category weights to match your sector targets.'
    };
  }, [stats, suggestions, accuracy]);

  const exportOrdersCsv = () => {
    const rate = fxRates.INR || FX_FALLBACK_RATE;
    const rows = [
      ['Mode', 'Action', 'Category', 'Order', 'Amount_INR', 'Approx_USD', 'Notes'],
      ...sortedOrders.map((o) => [
        rebalanceMode === 'sip' ? 'Zero-Sell SIP' : 'Full Rebalance',
        String(o.type).toUpperCase(),
        `"${String(o.category || '').replace(/"/g, '""')}"`,
        `"${String(o.title || '').replace(/"/g, '""')}"`,
        Math.round(o.amountRaw || 0),
        Math.round((o.amountRaw || 0) / rate),
        `"${String(o.description || '').replace(/"/g, '""')}"`
      ])
    ];
    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unitywealth-${rebalanceMode}-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const { totalSellRaw, totalBuyRaw } = useMemo(() => {
    let sell = 0;
    let buy = 0;
    for (const o of activeOrders) {
      if (o.type === 'sell') sell += o.amountRaw;
      else buy += o.amountRaw;
    }
    return { totalSellRaw: sell, totalBuyRaw: buy };
  }, [activeOrders]);

  return (
    <div className="max-w-4xl mx-auto space-y-5 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase tracking-tight">
            Strategy &amp; Orders
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium tracking-tight">
            Step-by-step plan to achieve your {Math.round(stats.targetEquityPct * 100)}/
            {Math.round(stats.targetDebtPct * 100)} goal
          </p>
        </div>
        <div className="flex bg-slate-200/70 p-1 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setRebalanceMode('full')}
            className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs font-bold transition-all ${
              rebalanceMode === 'full' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Full Rebalance
          </button>
          <button
            type="button"
            onClick={() => setRebalanceMode('sip')}
            className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs font-bold transition-all ${
              rebalanceMode === 'sip' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600'
            }`}
          >
            Zero-Sell SIP Router
          </button>
        </div>
      </div>

      {rebalanceMode === 'sip' && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-indigo-200 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-xs font-black text-indigo-600 uppercase tracking-wider">
                Tax-Free Monthly Inflow Router
              </div>
              <p className="text-xs text-slate-500">
                Route your monthly salary savings / SIP into underweight buckets without selling a single unit.
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[50000, 150000, 300000, 500000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setFreshInflowINR(preset)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${
                    freshInflowINR === preset
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {formatCompactINR(preset)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-black text-slate-500">₹</span>
            <input
              type="number"
              aria-label="Fresh Monthly SIP Inflow in INR"
              value={freshInflowINR}
              onChange={(e) => setFreshInflowINR(Math.max(0, Number(e.target.value)))}
              className="w-full sm:w-64 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-900"
            />
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200 shrink-0">
              Post-SIP: {sipPostAccuracy.toFixed(1)}% aligned
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5 sm:gap-6">
        <div className="bg-white p-3.5 sm:p-7 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-rose-500"></div>
          <div className="w-8 h-8 sm:w-12 sm:h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mb-2 sm:mb-4">
            <ArrowUpRight size={18} />
          </div>
          <div className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">
            Sell Value
          </div>
          <div className="text-sm sm:text-2xl font-black text-slate-800">
            {formatCompactINR(totalSellRaw)}
          </div>
        </div>

        <div className="bg-slate-900 p-3.5 sm:p-7 rounded-2xl sm:rounded-3xl shadow-xl flex flex-col items-center text-center text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500"></div>
          <div className="w-8 h-8 sm:w-12 sm:h-12 bg-white/10 text-white rounded-full flex items-center justify-center mb-2 sm:mb-4">
            <RefreshCcw size={18} />
          </div>
          <div className="text-[9px] sm:text-[10px] font-black text-white/60 uppercase tracking-wider mb-0.5">
            Accuracy
          </div>
          <div className="text-sm sm:text-2xl font-black">
            {(rebalanceMode === 'sip' ? sipPostAccuracy : accuracy).toFixed(1)}%
          </div>
        </div>

        <div className="bg-white p-3.5 sm:p-7 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
          <div className="w-8 h-8 sm:w-12 sm:h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-2 sm:mb-4">
            <ArrowDownRight size={18} />
          </div>
          <div className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">
            Buy Value
          </div>
          <div className="text-sm sm:text-2xl font-black text-slate-800">
            {formatCompactINR(totalBuyRaw)}
          </div>
        </div>
      </div>

      <div className="bg-indigo-600 rounded-2xl sm:rounded-3xl p-5 sm:p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <div className="px-3 py-1 bg-white/20 rounded-full text-[10px] font-black uppercase tracking-widest">
              {rebalanceMode === 'sip' ? 'Zero-Sell SIP Summary' : 'Executive Summary'}
            </div>
          </div>
          <h3 className="text-lg sm:text-2xl font-black mb-2 italic">
            &ldquo;
            {rebalanceMode === 'sip'
              ? `Routing ${formatCompactINR(freshInflowINR)} lifts alignment from ${accuracy.toFixed(1)}% to ${sipPostAccuracy.toFixed(1)}% with ₹0 tax drag.`
              : typeof narrative === 'string'
              ? narrative
              : narrative.main}
            &rdquo;
          </h3>
          {rebalanceMode === 'full' && typeof narrative !== 'string' && (
            <p className="text-xs sm:text-sm text-indigo-100 font-medium leading-relaxed max-w-2xl">
              {narrative.secondary} Switch to Zero-Sell SIP Router above anytime to rebalance purely via monthly inflows.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-sm sm:text-base font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
            Detailed Order List ({sortedOrders.length})
          </h3>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Impact Sorted
          </span>
        </div>

        <div className="divide-y divide-slate-50">
          {sortedOrders.length === 0 ? (
            <div className="p-12 sm:p-20 text-center flex flex-col items-center">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                <Check size={28} />
              </div>
              <p className="text-slate-800 font-bold">Portfolio Perfectly Balanced</p>
              <p className="text-slate-400 text-sm">No adjustments needed at this time.</p>
            </div>
          ) : (
            sortedOrders.map((s, idx) => (
              <div
                key={`${s.category}-${s.title}-${idx}`}
                className="px-4 sm:px-8 py-4 sm:py-6 hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                  <div
                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border shrink-0 ${
                      s.type === 'sell'
                        ? 'bg-rose-50 text-rose-600 border-rose-100'
                        : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                    }`}
                  >
                    {s.type === 'sell' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800 flex items-center gap-2 flex-wrap">
                      <span>{s.title}</span>
                      <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-black">
                        {s.category}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 font-medium leading-snug">
                      {s.description}
                    </div>
                  </div>
                </div>
                <div className="text-left sm:text-right pl-12 sm:pl-0 shrink-0">
                  <div
                    className={`text-base sm:text-lg font-black tabular-nums ${
                      s.type === 'sell' ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {s.type === 'sell' ? '-' : '+'}
                    {s.amount}
                  </div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
                    {rebalanceMode === 'sip' ? 'Zero-Tax Buy' : 'Market Execution'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 sm:px-8 py-5 bg-slate-50 space-y-4 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-200 rounded-lg shrink-0">
                <ShieldCheck size={18} className="text-slate-600" />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-bold text-slate-700">
                  Tax-Efficient Family Execution &amp; Email Dispatch
                </div>
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mt-0.5">
                  Email formatted plan to yourself / spouse or export CSV orders
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={exportOrdersCsv}
              disabled={sortedOrders.length === 0}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-900 hover:bg-black disabled:opacity-40 text-white rounded-xl font-bold transition-all shadow-sm active:scale-95 text-xs uppercase tracking-wider flex items-center justify-center gap-2 shrink-0"
            >
              <Download size={14} /> Export CSV Orders
            </button>
          </div>

          {onSendRebalanceEmail && (
            <div className="pt-3 border-t border-slate-200/70 space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="Recipient email (e.g. you or spouse@gmail.com)"
                  aria-label="Rebalance Report Recipient Email"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  disabled={isEmailingPlan || !recipientEmail.trim()}
                  onClick={async () => {
                    setIsEmailingPlan(true);
                    setEmailPlanResult(null);
                    try {
                      const execSum =
                        rebalanceMode === 'sip'
                          ? `Routing ${formatCompactINR(freshInflowINR).replace(/₹/g, 'Rs. ')} lifts alignment from ${accuracy.toFixed(1)}% to ${sipPostAccuracy.toFixed(1)}% with Rs. 0 tax drag.`
                          : typeof narrative === 'string'
                          ? narrative
                          : `${narrative.main} ${narrative.secondary}`;

                      const res = await onSendRebalanceEmail({
                        toEmail: recipientEmail.trim(),
                        mode: rebalanceMode,
                        freshInflowINR,
                        clientReport: {
                          householdName: householdName || 'Family Portfolio',
                          totalValINR: stats.totalValINR,
                          totalValUSD: stats.totalValUSD,
                          accuracy: rebalanceMode === 'sip' ? sipPostAccuracy : accuracy,
                          threshold,
                          actualEquityPct: stats.actualEquityPct,
                          targetEquityPct: stats.targetEquityPct,
                          indianEquityPctOfEq: stats.actualIndianEquityPctOfEquity,
                          foreignEquityPctOfEq: stats.actualForeignEquityPctOfEquity,
                          executiveSummary: execSum,
                          orders: sortedOrders.map((o) => ({
                            type: o.type,
                            title: o.title,
                            category: o.category,
                            amount: String(o.amount || '').replace(/₹/g, 'Rs. '),
                            description: String(o.description || '').replace(/₹/g, 'Rs. ')
                          }))
                        }
                      });
                      setEmailPlanResult({
                        sent: Boolean(res?.sent),
                        message: res?.sent
                          ? `Delivered ${rebalanceMode === 'sip' ? 'Zero-Sell SIP Plan' : 'Rebalance Plan'} to ${recipientEmail.trim()}!`
                          : res?.error || 'Outgoing email sender is not authorized yet.',
                        gmailComposeUrl: res?.gmailComposeUrl
                      });
                    } catch (err: any) {
                      setEmailPlanResult({
                        sent: false,
                        message: err?.message || 'Failed to send rebalance email'
                      });
                    } finally {
                      setIsEmailingPlan(false);
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm shrink-0"
                >
                  {isEmailingPlan ? <RefreshCcw size={14} className="animate-spin" /> : <Mail size={14} />}
                  Email Rebalance Plan
                </button>
              </div>

              {emailPlanResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                    emailPlanResult.sent
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'
                      : 'bg-amber-50 border-amber-200 text-amber-900 font-semibold'
                  }`}
                >
                  <span>{emailPlanResult.message}</span>
                  {!emailPlanResult.sent && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {emailPlanResult.gmailComposeUrl && (
                        <a
                          href={emailPlanResult.gmailComposeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold"
                        >
                          Open Pre-Filled Gmail <ExternalLink size={12} />
                        </a>
                      )}
                      {onOpenEmailSettings && !emailStatus?.configured && (
                        <button
                          type="button"
                          onClick={onOpenEmailSettings}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 text-[11px] font-bold"
                        >
                          Connect Gmail Sender
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
