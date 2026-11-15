import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from 'recharts';
import {
  Calendar,
  Check,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { PortfolioTargets, RsuGrant, RsuVestTranche } from '../types';
import { formatCompactINR, formatCompactUSD } from '../shared/formatters';
import { ComputedPortfolioStats } from '../shared/portfolioMath';
import {
  simulateRsuForwardPlan,
  UpcomingVestEvent
} from '../shared/taxAndRsuMath';

interface RsuFuturePlannerPanelProps {
  householdId: string;
  stats: ComputedPortfolioStats;
  targets: PortfolioTargets;
  rsuGrants: RsuGrant[];
  members: { id: string; name: string }[];
  fxRate: number;
  defaultWithholdingPct?: number;
  onSaveRsuGrants: (nextGrants: RsuGrant[]) => Promise<void>;
  onConfirmTrancheVested?: (event: UpcomingVestEvent) => Promise<void>;
}

export const RsuFuturePlannerPanel: React.FC<RsuFuturePlannerPanelProps> = ({
  householdId,
  stats,
  targets,
  rsuGrants,
  members,
  fxRate,
  defaultWithholdingPct = 35.88,
  onSaveRsuGrants,
  onConfirmTrancheVested
}) => {
  const [horizonMonths, setHorizonMonths] = useState<6 | 12 | 24>(12);
  const [priceScenarioPct, setPriceScenarioPct] = useState<-20 | 0 | 20>(0);
  const [showAddGrant, setShowAddGrant] = useState<boolean>(rsuGrants.length === 0);

  // Quick Grant Creator State
  const suggestedUsTickers = useMemo(() => {
    const set = new Set<string>();
    stats.holdings.forEach((h) => {
      if (!h.isPlaceholder && h.currency === 'USD' && h.ticker) {
        set.add(h.ticker.toUpperCase());
      }
    });
    if (set.size === 0) {
      ['QCOM', 'GOOGL', 'MSFT', 'NVDA', 'AAPL'].forEach((t) => set.add(t));
    }
    return Array.from(set).slice(0, 6);
  }, [stats.holdings]);

  const [ownerId, setOwnerId] = useState<string>(members[0]?.id || '');
  const [ticker, setTicker] = useState<string>(suggestedUsTickers[0] || 'QCOM');
  const [grantName, setGrantName] = useState<string>('Annual RSU Grant');
  const [provider, setProvider] = useState<string>('E*TRADE');
  const [withholdPct, setWithholdPct] = useState<string>(String(defaultWithholdingPct));
  const [firstVestDate, setFirstVestDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2);
    return d.toISOString().slice(0, 10);
  });
  const [cadence, setCadence] = useState<'single' | 'quarterly' | 'semiannual' | 'annual'>('quarterly');
  const [trancheCount, setTrancheCount] = useState<string>('4');
  const [grossPerTranche, setGrossPerTranche] = useState<string>('40');
  const [saving, setSaving] = useState(false);
  const [vestingId, setVestingId] = useState<string | null>(null);

  const sim = useMemo(
    () =>
      simulateRsuForwardPlan({
        stats,
        rsuGrants,
        targets,
        members,
        fxRate,
        horizonMonths,
        priceScenarioPct
      }),
    [stats, rsuGrants, targets, members, fxRate, horizonMonths, priceScenarioPct]
  );

  const handleCreateGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTicker = ticker.trim().toUpperCase();
    const gross = Number(grossPerTranche);
    const count = cadence === 'single' ? 1 : Math.max(1, Math.min(20, parseInt(trancheCount, 10) || 4));
    if (!cleanTicker || !firstVestDate || !(gross > 0)) return;

    const stepMonths =
      cadence === 'quarterly' ? 3 : cadence === 'semiannual' ? 6 : cadence === 'annual' ? 12 : 0;

    const vestSchedule: RsuVestTranche[] = [];
    const start = new Date(`${firstVestDate}T00:00:00`);
    for (let i = 0; i < count; i++) {
      const d = new Date(start);
      if (i > 0 && stepMonths > 0) {
        d.setMonth(d.getMonth() + i * stepMonths);
      }
      const iso = d.toISOString().slice(0, 10);
      vestSchedule.push({
        id: 'vst_' + Math.random().toString(36).slice(2, 9),
        vestDate: iso,
        grossUnits: gross,
        vested: false
      });
    }

    setSaving(true);
    try {
      const newGrant: RsuGrant = {
        id: 'rsu_' + Math.random().toString(36).slice(2, 10),
        householdId,
        ownerId: ownerId || members[0]?.id || '',
        ticker: cleanTicker,
        grantName: grantName.trim() || `${cleanTicker} RSU Grant`,
        currency: 'USD',
        provider: provider.trim() || 'E*TRADE',
        withholdingTaxPct: Math.max(0, Math.min(55, Number(withholdPct) || defaultWithholdingPct)),
        vestSchedule,
        updatedAt: Date.now()
      };
      await onSaveRsuGrants([...rsuGrants, newGrant]);
      setShowAddGrant(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGrant = async (grantId: string) => {
    setSaving(true);
    try {
      await onSaveRsuGrants(rsuGrants.filter((g) => g.id !== grantId));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmVest = async (ev: UpcomingVestEvent) => {
    if (!onConfirmTrancheVested) return;
    setVestingId(ev.trancheId);
    try {
      await onConfirmTrancheVested(ev);
    } finally {
      setVestingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Controls Bar */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-black text-indigo-600 uppercase tracking-wider">
              <Sparkles size={14} /> Future RSU Vesting &amp; Forward Drift Simulator
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              See how upcoming RSU vests shift your allocation if stock price stays flat (or moves ±20%), and plan zero-tax vest-day rebalancing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddGrant((v) => !v)}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 shadow-xs"
          >
            <Plus size={14} /> {showAddGrant ? 'Hide Grant Form' : 'Add Unvested RSU Schedule'}
          </button>
        </div>

        {/* Scenario Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-slate-400 uppercase mr-1">Horizon:</span>
            {([6, 12, 24] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setHorizonMonths(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  horizonMonths === m
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Next {m} Months
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-slate-400 uppercase mr-1">Stock Price:</span>
            {[
              { val: -20 as const, label: '-20% Stress' },
              { val: 0 as const, label: 'Flat (Same Price)' },
              { val: 20 as const, label: '+20% Bull' }
            ].map((sc) => (
              <button
                key={sc.val}
                type="button"
                onClick={() => setPriceScenarioPct(sc.val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  priceScenarioPct === sc.val
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Add Unvested Grant Form */}
        {showAddGrant && (
          <form
            onSubmit={handleCreateGrant}
            className="p-4 rounded-xl bg-slate-50 border border-indigo-100 space-y-3"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                Add Unvested Employer RSU Schedule
              </span>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] font-bold text-slate-400 mr-1">Quick Ticker:</span>
                {suggestedUsTickers.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTicker(t)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-black border ${
                      ticker === t
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Member
                </label>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Stock Ticker
                </label>
                <input
                  type="text"
                  required
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="QCOM"
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Grant Label
                </label>
                <input
                  type="text"
                  value={grantName}
                  onChange={(e) => setGrantName(e.target.value)}
                  placeholder="2025 Refresher"
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Sell-to-Cover Tax %
                </label>
                <input
                  type="number"
                  step="any"
                  value={withholdPct}
                  onChange={(e) => setWithholdPct(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Next Vest Date
                </label>
                <input
                  type="date"
                  required
                  value={firstVestDate}
                  onChange={(e) => setFirstVestDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Vesting Frequency
                </label>
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as any)}
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
                >
                  <option value="quarterly">Quarterly (Every 3M)</option>
                  <option value="semiannual">Semi-Annual (Every 6M)</option>
                  <option value="annual">Annual (Every 12M)</option>
                  <option value="single">Single Tranche</option>
                </select>
              </div>
              {cadence !== 'single' && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    # of Vests Left
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={trancheCount}
                    onChange={(e) => setTrancheCount(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Gross Shares / Vest
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={grossPerTranche}
                  onChange={(e) => setGrossPerTranche(e.target.value)}
                  placeholder="40"
                  className="w-full px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="col-span-2 sm:col-span-1 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Check size={14} /> Save Schedule
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Tip: Uploading an E*TRADE statement with unvested grant rows also imports schedules automatically. Unvested RSUs never alter your live Dashboard allocation until confirmed vested.
            </p>
          </form>
        )}
      </div>

      {/* Simulation Results */}
      {sim.upcomingEvents.length === 0 ? (
        <div className="bg-white p-8 rounded-2xl border border-dashed border-slate-200 text-center space-y-2">
          <Calendar size={28} className="mx-auto text-indigo-500" />
          <p className="text-sm font-bold text-slate-800">
            No Unvested RSU Vests Scheduled in the Next {horizonMonths} Months
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Add your employer RSU grant schedule above (e.g., quarterly QCOM / GOOGL / MSFT vests) to simulate future foreign-equity drift and pre-plan tax-free vest-day rebalancing.
          </p>
        </div>
      ) : (
        <>
          {/* KPI Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black uppercase text-slate-400">
                Net Vesting ({horizonMonths}M)
              </div>
              <div className="text-lg sm:text-xl font-black text-slate-900 mt-1">
                {formatCompactINR(sim.totalNetVestValueINR)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {sim.totalNetUnitsVesting.toFixed(1)} net sh ({sim.totalGrossUnitsVesting.toFixed(0)} gross)
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black uppercase text-slate-400">
                Foreign Share of Equity
              </div>
              <div className="text-lg sm:text-xl font-black text-indigo-600 mt-1 flex items-center gap-1.5">
                <span>{sim.currentForeignOfEqPct.toFixed(0)}%</span>
                <ArrowRight size={14} className="text-slate-400" />
                <span>{sim.projectedForeignOfEqPctIfHeld.toFixed(0)}%</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Target: {sim.targetForeignOfEqPct.toFixed(0)}% of Equity
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black uppercase text-slate-400">
                {sim.topRsuTicker} Concentration
              </div>
              <div className="text-lg sm:text-xl font-black text-amber-600 mt-1 flex items-center gap-1.5">
                <span>{sim.currentTopTickerConcentrationPct.toFixed(1)}%</span>
                <ArrowRight size={14} className="text-slate-400" />
                <span>{sim.projectedTopTickerConcentrationPct.toFixed(1)}%</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Of total liquid portfolio if held
              </div>
            </div>

            <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-md">
              <div className="text-[10px] font-black uppercase text-indigo-300">
                Projected Alignment
              </div>
              <div className="text-lg sm:text-xl font-black mt-1 flex items-center gap-1.5">
                <span>{sim.currentAlignmentPct.toFixed(1)}%</span>
                <ArrowRight size={14} className="text-slate-400" />
                <span
                  className={
                    sim.projectedAlignmentIfHeldPct < sim.currentAlignmentPct - 2
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }
                >
                  {sim.projectedAlignmentIfHeldPct.toFixed(1)}%
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                If 100% of vesting RSUs are kept
              </div>
            </div>
          </div>

          {/* Two Pre-Vest Playbooks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-2xl border-2 border-emerald-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase">
                  Recommended • ~₹0 Extra Cap-Gains Tax
                </span>
                <span className="text-xs font-black text-emerald-700">
                  {sim.playbookSellAtVest.resultingAlignmentPct.toFixed(1)}% Aligned
                </span>
              </div>
              <h4 className="text-sm sm:text-base font-black text-slate-900">
                Playbook A: Auto-Sell {sim.playbookSellAtVest.sellPctOfNetVest.toFixed(0)}% of Net Vest on Release Day
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Because employer perquisite tax ({defaultWithholdingPct}%) is already withheld at vest, selling{' '}
                <strong>{formatCompactINR(sim.playbookSellAtVest.sellValueINR)}</strong> within 24–48 hrs of vest has{' '}
                <strong>Gain ≈ ₹0 (₹0 STCG tax)</strong>! Deploy proceeds into:
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">
                    Buy Indian Equity / MF
                  </div>
                  <div className="text-sm font-black text-slate-900 mt-0.5">
                    +{formatCompactINR(sim.playbookSellAtVest.deployToIndianEquityINR)}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">
                    Buy Arbitrage / Debt
                  </div>
                  <div className="text-sm font-black text-slate-900 mt-0.5">
                    +{formatCompactINR(sim.playbookSellAtVest.deployToDebtArbitrageINR)}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-black uppercase">
                  Zero-Sell Alternative • Keep All Shares
                </span>
                <span className="text-xs font-black text-indigo-600">
                  {sim.playbookHoldAndSip.resultingAlignmentPct.toFixed(1)}% Aligned
                </span>
              </div>
              <h4 className="text-sm sm:text-base font-black text-slate-900">
                Playbook B: Hold 100% of RSUs &amp; Counter-SIP {formatCompactINR(sim.playbookHoldAndSip.requiredMonthlySipINR)}/mo
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                If you are bullish on <strong>{sim.topRsuTicker}</strong> and want to hold every vested share until the 24-month LTCG mark, offset the USD inflow with monthly INR SIPs:
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">
                    Monthly India Eq SIP
                  </div>
                  <div className="text-sm font-black text-slate-900 mt-0.5">
                    {formatCompactINR(sim.playbookHoldAndSip.monthlyIndianEquitySipINR)}/mo
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">
                    Monthly Debt / Arb SIP
                  </div>
                  <div className="text-sm font-black text-slate-900 mt-0.5">
                    {formatCompactINR(sim.playbookHoldAndSip.monthlyDebtSipINR)}/mo
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Forward Drift Chart */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp size={14} className="text-indigo-600" /> Forward Foreign-Equity Drift Curve (If Unvested RSUs Are Held)
              </div>
              <span className="text-[11px] font-bold text-slate-500">
                Target Foreign % of Total Portfolio: {sim.timelineCheckpoints[0]?.targetForeignPctOfTotal}%
              </span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={sim.timelineCheckpoints} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 700 }} />
                  <YAxis
                    yAxisId="pct"
                    unit="%"
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(val: any, name: string) =>
                      name.includes('INR') ? formatCompactINR(Number(val)) : `${val}%`
                    }
                  />
                  <ReferenceLine
                    yAxisId="pct"
                    y={sim.timelineCheckpoints[0]?.targetForeignPctOfTotal || 28}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    label={{ value: 'Target Foreign %', fontSize: 10, fill: '#10b981', position: 'insideTopRight' }}
                  />
                  <Bar
                    yAxisId="pct"
                    dataKey="indianEqPctOfTotal"
                    name="Indian Equity %"
                    stackId="mix"
                    fill="#6366f1"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    yAxisId="pct"
                    dataKey="debtPctOfTotal"
                    name="Debt / Arbitrage %"
                    stackId="mix"
                    fill="#10b981"
                  />
                  <Bar
                    yAxisId="pct"
                    dataKey="foreignEqPctOfTotal"
                    name="Foreign Equity / RSU %"
                    stackId="mix"
                    fill="#f59e0b"
                    radius={[6, 6, 0, 0]}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="foreignEqPctOfTotal"
                    name="Foreign % Trajectory"
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Upcoming Vest Calendar & 1-Click Confirm Vest */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                Upcoming RSU Vest Calendar ({sim.upcomingEvents.length})
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase">
                Net after Sell-to-Cover Tax
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {sim.upcomingEvents.map((ev) => (
                <div
                  key={ev.trancheId}
                  className="px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-black text-slate-900">
                        {ev.vestDate}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-black">
                        {ev.ticker}
                      </span>
                      <span className="text-xs font-bold text-slate-700">{ev.grantName}</span>
                      <span className="text-[10px] font-bold text-slate-400">
                        • {ev.ownerName} ({ev.provider})
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Gross {ev.grossUnits} sh → <strong>{ev.netUnits} net sh</strong> @{' '}
                      {formatCompactUSD(ev.projectedSharePriceUSD)} (
                      {ev.daysUntilVest === 0 ? 'Vesting Today!' : `in ${ev.daysUntilVest}d`})
                      {ev.sellAtVestUnitsToStayBalanced > 0 && (
                        <span className="ml-2 text-emerald-700 font-semibold">
                          • Playbook A: Sell {ev.sellAtVestUnitsToStayBalanced} sh ({formatCompactINR(ev.sellAtVestValueINR)}) at vest
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900 tabular-nums">
                        +{formatCompactINR(ev.netVestValueINR)}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {formatCompactUSD(ev.netVestValueUSD)}
                      </div>
                    </div>
                    {onConfirmTrancheVested && (
                      <button
                        type="button"
                        disabled={vestingId === ev.trancheId}
                        onClick={() => handleConfirmVest(ev)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-black flex items-center gap-1"
                        title="Move net vested shares into active Holdings with exact vest date & FMV tax lot"
                      >
                        <ShieldCheck size={12} />
                        {vestingId === ev.trancheId ? 'Recording...' : 'Mark Vested'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Active Grant Schedules Footer */}
            {rsuGrants.length > 0 && (
              <div className="px-4 sm:px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase text-slate-400 mr-1">
                  Saved Grants:
                </span>
                {rsuGrants.map((g) => (
                  <span
                    key={g.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700"
                  >
                    <span>
                      {g.ticker} • {g.grantName} ({g.vestSchedule.filter((v) => !v.vested).length} left)
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteGrant(g.id)}
                      aria-label={`Delete grant ${g.grantName}`}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
