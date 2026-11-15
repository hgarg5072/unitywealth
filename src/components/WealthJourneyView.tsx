import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import {
  TrendingUp,
  Plus,
  Camera,
  Trash,
  Sparkles,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCcw,
  X
} from 'lucide-react';

export interface WealthSnapshotItem {
  householdId: string;
  snapshotMonth: string; // YYYY-MM
  recordedAt: number;
  totalINR: number;
  totalUSD: number;
  indianEquityINR: number;
  foreignEquityINR: number;
  debtINR: number;
  fxRate: number;
  holdingsCount: number;
  memberBreakdown: { id: string; name: string; valueINR: number }[];
  providerBreakdown?: Record<string, number>;
  source: string;
  note?: string;
}

export function formatCompactINR(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_00_00_000) {
    return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_00_000) {
    return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`;
  }
  if (abs >= 1_000) {
    return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatCompactUSD(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = (ym || '').split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = parseInt(m, 10) - 1;
  if (!y || isNaN(idx) || idx < 0 || idx > 11) return ym;
  return `${names[idx]} '${y.slice(-2)}`;
}

const MILESTONES_INR = [
  25_00_000,
  50_00_000,
  1_00_00_000,
  2_50_00_000,
  5_00_00_000,
  10_00_00_000,
  25_00_00_000,
  50_00_00_000
];

const MEMBER_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'];

interface Props {
  snapshots: WealthSnapshotItem[];
  stats: any;
  fxRate: number;
  members: { id: string; name: string }[];
  isRecording: boolean;
  onRecordCurrentSnapshot: () => Promise<void>;
  onBackfillMonth: (payload: {
    snapshotMonth: string;
    totalINR: number;
    indianEquityINR: number;
    foreignEquityINR: number;
    debtINR: number;
    note: string;
  }) => Promise<void>;
  onDeleteMonth: (month: string) => Promise<void>;
}

export function WealthJourneyView({
  snapshots,
  stats,
  fxRate,
  members,
  isRecording,
  onRecordCurrentSnapshot,
  onBackfillMonth,
  onDeleteMonth
}: Props) {
  const [chartMode, setChartMode] = useState<'total' | 'assets' | 'members'>('total');
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [range, setRange] = useState<'6M' | '1Y' | 'ALL'>('ALL');

  // Backfill Modal State
  const [showBackfillModal, setShowBackfillModal] = useState(false);
  const [bfMonth, setBfMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [bfTotalINR, setBfTotalINR] = useState('');
  const [bfIndEqINR, setBfIndEqINR] = useState('');
  const [bfForEqINR, setBfForEqINR] = useState('');
  const [bfDebtINR, setBfDebtINR] = useState('');
  const [bfNote, setBfNote] = useState('');
  const [isSavingBf, setIsSavingBf] = useState(false);

  // Wealth Compounding Simulator State
  const [monthlySipINR, setMonthlySipINR] = useState(150000);
  const [annualReturnPct, setAnnualReturnPct] = useState(12);
  const [horizonYears, setHorizonYears] = useState(10);

  // Merge live current month if no snapshots exist yet so chart is always meaningful
  const effectiveSeries = useMemo(() => {
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const map = new Map<string, WealthSnapshotItem>();
    snapshots.forEach((s) => map.set(s.snapshotMonth, s));

    if (stats && stats.totalValINR > 0) {
      map.set(currentYm, {
        householdId: '',
        snapshotMonth: currentYm,
        recordedAt: Date.now(),
        totalINR: stats.totalValINR,
        totalUSD: stats.totalValUSD,
        indianEquityINR: stats.indianEquityValINR,
        foreignEquityINR: stats.foreignEquityValINR,
        debtINR: stats.debtValINR,
        fxRate: fxRate || 84,
        holdingsCount: stats.holdings?.filter((h: any) => !h.isPlaceholder)?.length || 0,
        memberBreakdown: (stats.memberContributions || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          valueINR: m.value
        })),
        source: map.get(currentYm)?.source || 'live',
        note: map.get(currentYm)?.note || 'Live current portfolio'
      });
    }

    const sorted = Array.from(map.values()).sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth));
    if (range === '6M') return sorted.slice(-6);
    if (range === '1Y') return sorted.slice(-12);
    return sorted;
  }, [snapshots, stats, fxRate, range]);

  const chartData = useMemo(() => {
    const div = currency === 'USD' ? (fxRate || 84) : 1;
    return effectiveSeries.map((s) => {
      const row: Record<string, any> = {
        month: s.snapshotMonth,
        label: formatMonthLabel(s.snapshotMonth),
        total: Math.round((currency === 'USD' ? s.totalUSD : s.totalINR)),
        indianEquity: Math.round(s.indianEquityINR / div),
        foreignEquity: Math.round(s.foreignEquityINR / div),
        debt: Math.round(s.debtINR / div)
      };
      members.forEach((m) => {
        const found = (s.memberBreakdown || []).find((mb) => mb.id === m.id || mb.name === m.name);
        row[`m_${m.id}`] = Math.round(((found?.valueINR || 0) / div));
      });
      return row;
    });
  }, [effectiveSeries, currency, fxRate, members]);

  const metrics = useMemo(() => {
    const currentINR = stats?.totalValINR || (effectiveSeries[effectiveSeries.length - 1]?.totalINR ?? 0);
    const prevSnap = effectiveSeries.length >= 2 ? effectiveSeries[effectiveSeries.length - 2] : null;
    const firstSnap = effectiveSeries.length >= 2 ? effectiveSeries[0] : null;
    const momDeltaINR = prevSnap ? currentINR - prevSnap.totalINR : 0;
    const momPct = prevSnap && prevSnap.totalINR > 0 ? (momDeltaINR / prevSnap.totalINR) * 100 : 0;
    const allTimeDeltaINR = firstSnap ? currentINR - firstSnap.totalINR : 0;
    const allTimePct = firstSnap && firstSnap.totalINR > 0 ? (allTimeDeltaINR / firstSnap.totalINR) * 100 : 0;

    const nextMilestone = MILESTONES_INR.find((ms) => ms > currentINR) || currentINR * 2 || 1_00_00_000;
    const milestoneProgress = Math.min(100, (currentINR / nextMilestone) * 100);

    return {
      currentINR,
      momDeltaINR,
      momPct,
      allTimeDeltaINR,
      allTimePct,
      hasPrev: !!prevSnap,
      nextMilestone,
      milestoneProgress
    };
  }, [stats, effectiveSeries]);

  // Compounding Projection Series
  const projectionData = useMemo(() => {
    const startPrincipal = metrics.currentINR || 0;
    const monthlyRate = annualReturnPct / 100 / 12;
    const pts: { yearLabel: string; projected: number; principal: number }[] = [];
    for (let yr = 0; yr <= horizonYears; yr++) {
      const months = yr * 12;
      let fv = startPrincipal * Math.pow(1 + monthlyRate, months);
      if (monthlyRate > 0 && months > 0) {
        fv += monthlySipINR * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
      } else {
        fv += monthlySipINR * months;
      }
      const invested = startPrincipal + monthlySipINR * months;
      pts.push({
        yearLabel: yr === 0 ? 'Now' : `${yr}Y`,
        projected: Math.round(fv),
        principal: Math.round(invested)
      });
    }
    return pts;
  }, [metrics.currentINR, monthlySipINR, annualReturnPct, horizonYears]);

  const finalProjectedINR = projectionData[projectionData.length - 1]?.projected || 0;
  const formatVal = (v: number) => (currency === 'USD' ? formatCompactUSD(v) : formatCompactINR(v));

  const handleSaveBackfill = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = parseFloat(bfTotalINR) || 0;
    const ind = parseFloat(bfIndEqINR) || 0;
    const frn = parseFloat(bfForEqINR) || 0;
    const dbt = parseFloat(bfDebtINR) || 0;
    const resolvedTotal = total > 0 ? total : ind + frn + dbt;
    if (!(resolvedTotal > 0)) return;
    setIsSavingBf(true);
    try {
      await onBackfillMonth({
        snapshotMonth: bfMonth,
        totalINR: resolvedTotal,
        indianEquityINR: ind > 0 ? ind : Math.round(resolvedTotal * 0.42),
        foreignEquityINR: frn > 0 ? frn : Math.round(resolvedTotal * 0.28),
        debtINR: dbt > 0 ? dbt : Math.max(0, resolvedTotal - (ind > 0 ? ind : Math.round(resolvedTotal * 0.42)) - (frn > 0 ? frn : Math.round(resolvedTotal * 0.28))),
        note: bfNote
      });
      setShowBackfillModal(false);
      setBfTotalINR('');
      setBfIndEqINR('');
      setBfForEqINR('');
      setBfDebtINR('');
      setBfNote('');
    } finally {
      setIsSavingBf(false);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Wealth Journey</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <ShieldCheck size={12} /> PostgreSQL Vault
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monthly net worth history automatically archived whenever statements or live prices sync.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRecordCurrentSnapshot}
            disabled={isRecording || !(metrics.currentINR > 0)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
          >
            {isRecording ? <RefreshCcw size={14} className="animate-spin text-indigo-600" /> : <Camera size={14} className="text-indigo-600" />}
            Snapshot This Month
          </button>
          <button
            type="button"
            onClick={() => setShowBackfillModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus size={14} /> Log Past Month
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Current Family Net Worth</div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">{formatCompactINR(metrics.currentINR)}</div>
          <div className="text-xs text-slate-400 font-medium mt-0.5">
            {formatCompactUSD(metrics.currentINR / (fxRate || 84))} @ ₹{(fxRate || 84).toFixed(2)}
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Month-over-Month</div>
          {metrics.hasPrev ? (
            <>
              <div className={`text-lg sm:text-2xl font-black mt-1 flex items-center gap-1 ${metrics.momDeltaINR >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {metrics.momDeltaINR >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                {metrics.momPct >= 0 ? '+' : ''}{metrics.momPct.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">
                {metrics.momDeltaINR >= 0 ? '+' : ''}{formatCompactINR(metrics.momDeltaINR)} vs prior month
              </div>
            </>
          ) : (
            <>
              <div className="text-lg sm:text-2xl font-black text-indigo-600 mt-1">Month 1</div>
              <div className="text-xs text-slate-400 mt-0.5">Log a past month to see MoM Δ</div>
            </>
          )}
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Tracked History</div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">
            {effectiveSeries.length} {effectiveSeries.length === 1 ? 'Month' : 'Months'}
          </div>
          <div className="text-xs text-slate-500 font-medium mt-0.5">
            {metrics.hasPrev ? `${metrics.allTimeDeltaINR >= 0 ? '+' : ''}${formatCompactINR(metrics.allTimeDeltaINR)} net growth` : 'Auto-saves monthly'}
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Next Milestone</span>
            <span className="text-[10px] font-black text-indigo-600">{metrics.milestoneProgress.toFixed(0)}%</span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">{formatCompactINR(metrics.nextMilestone)}</div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${metrics.milestoneProgress}%` }} />
          </div>
        </div>
      </div>

      {/* Main Wealth Over Time Interactive Chart */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              type="button"
              onClick={() => setChartMode('total')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${chartMode === 'total' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Total Wealth
            </button>
            <button
              type="button"
              onClick={() => setChartMode('assets')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${chartMode === 'assets' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Asset Mix
            </button>
            <button
              type="button"
              onClick={() => setChartMode('members')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${chartMode === 'members' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              By Member
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {(['INR', 'USD'] as const).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setCurrency(cur)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${currency === cur ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {cur === 'INR' ? '₹ INR' : '$ USD'}
                </button>
              ))}
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {(['6M', '1Y', 'ALL'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <TrendingUp className="text-indigo-400 mb-3" size={32} />
            <p className="text-sm font-bold text-slate-700">Import your first statement or add an asset to start your wealth curve</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              UnityWealth automatically snapshots your family's monthly net worth so your progress compounds visually month after month.
            </p>
          </div>
        ) : (
          <div className="h-64 sm:h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'total' ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="uwTotalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={(v) => formatVal(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    formatter={(val: any) => [
                      currency === 'INR'
                        ? `₹${Number(val).toLocaleString('en-IN')}`
                        : `$${Number(val).toLocaleString('en-US')}`,
                      'Net Worth'
                    ]}
                    contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 10px 25px -5px rgba(15,23,42,0.1)', fontSize: '12px', fontWeight: 700 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#4f46e5"
                    strokeWidth={3}
                    fill="url(#uwTotalGrad)"
                    dot={{ r: 4, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              ) : chartMode === 'assets' ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={(v) => formatVal(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    formatter={(val: any, name: any) => [
                      formatVal(Number(val)),
                      name === 'indianEquity' ? 'Indian Equity' : name === 'foreignEquity' ? 'Foreign Equity' : 'Debt & Cash'
                    ]}
                    contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                  />
                  <Area type="monotone" dataKey="indianEquity" stackId="1" stroke="#f97316" fill="#fed7aa" strokeWidth={2} />
                  <Area type="monotone" dataKey="foreignEquity" stackId="1" stroke="#2563eb" fill="#bfdbfe" strokeWidth={2} />
                  <Area type="monotone" dataKey="debt" stackId="1" stroke="#10b981" fill="#a7f3d0" strokeWidth={2} />
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={(v) => formatVal(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    formatter={(val: any, key: any) => {
                      const mem = members.find((m) => `m_${m.id}` === key);
                      return [formatVal(Number(val)), mem?.name || key];
                    }}
                    contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                  />
                  {members.map((m, idx) => (
                    <Bar
                      key={m.id}
                      dataKey={`m_${m.id}`}
                      stackId="members"
                      fill={MEMBER_COLORS[idx % MEMBER_COLORS.length]}
                      radius={idx === members.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {chartData.length === 1 && (
          <div className="mt-4 p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-indigo-900 font-medium">
              <strong>Tip:</strong> Want to see your trendline right away? Add 1–2 previous months using <strong>Log Past Month</strong>, and UnityWealth will auto-append future months automatically.
            </p>
            <button
              type="button"
              onClick={() => setShowBackfillModal(true)}
              className="text-xs font-black text-indigo-700 hover:underline shrink-0"
            >
              + Backfill Past Month →
            </button>
          </div>
        )}
      </div>

      {/* Family Wealth Compounding & Financial Freedom Simulator */}
      <div className="bg-slate-900 text-white p-5 sm:p-7 rounded-2xl shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-4 lg:w-5/12">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-black uppercase tracking-widest">
              <Sparkles size={15} /> Family Compounding Trajectory
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-black text-white">
                {formatCompactINR(finalProjectedINR)}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Projected family wealth in <strong>{horizonYears} years</strong> starting from {formatCompactINR(metrics.currentINR)}
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-slate-400">Monthly Family SIP / Savings</span>
                  <span className="text-emerald-400">₹{monthlySipINR.toLocaleString('en-IN')}/mo</span>
                </div>
                <input
                  type="range"
                  aria-label="Monthly Family SIP in INR"
                  min={0}
                  max={1000000}
                  step={25000}
                  value={monthlySipINR}
                  onChange={(e) => setMonthlySipINR(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-slate-400">Expected CAGR</span>
                    <span className="text-indigo-300">{annualReturnPct}%</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Expected Annual Return Percentage"
                    min={6}
                    max={18}
                    step={1}
                    value={annualReturnPct}
                    onChange={(e) => setAnnualReturnPct(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-slate-400">Horizon</span>
                    <span className="text-indigo-300">{horizonYears} Yrs</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Projection Horizon in Years"
                    min={3}
                    max={25}
                    step={1}
                    value={horizonYears}
                    onChange={(e) => setHorizonYears(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="h-52 sm:h-60 lg:w-7/12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projectionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                <XAxis dataKey="yearLabel" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => formatCompactINR(Number(v))} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={72} />
                <Tooltip
                  formatter={(v: any, key: any) => [
                    formatCompactINR(Number(v)),
                    key === 'projected' ? 'Projected Wealth' : 'Invested Capital'
                  ]}
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="projected" stroke="#818cf8" strokeWidth={2.5} fill="url(#projGrad)" />
                <Area type="monotone" dataKey="principal" stroke="#475569" strokeDasharray="4 4" strokeWidth={1.5} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Monthly Snapshot Ledger */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-800">Monthly Snapshot Ledger</h3>
            <p className="text-xs text-slate-500">Stored permanently in PostgreSQL across monthly syncs</p>
          </div>
          <span className="text-xs font-bold text-slate-400">{effectiveSeries.length} records</span>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden space-y-2.5">
          {[...effectiveSeries].reverse().map((s) => (
            <div key={s.snapshotMonth} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black text-slate-900">{formatMonthLabel(s.snapshotMonth)}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  IN Eq: {formatCompactINR(s.indianEquityINR)} • US Eq: {formatCompactINR(s.foreignEquityINR)}
                </div>
                <div className="text-[11px] text-slate-400">Debt: {formatCompactINR(s.debtINR)}</div>
              </div>
              <div className="text-right flex items-center gap-2">
                <div>
                  <div className="text-sm font-black text-slate-900">{formatCompactINR(s.totalINR)}</div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">{s.source.replace('_', ' ')}</div>
                </div>
                {snapshots.some((raw) => raw.snapshotMonth === s.snapshotMonth) && (
                  <button
                    type="button"
                    aria-label={`Delete snapshot ${s.snapshotMonth}`}
                    onClick={() => onDeleteMonth(s.snapshotMonth)}
                    className="p-2 text-slate-400 hover:text-rose-600 rounded-lg"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-black text-slate-400 uppercase tracking-wider">
                <th className="pb-3">Month</th>
                <th className="pb-3 text-right">Total Net Worth</th>
                <th className="pb-3 text-right">Indian Equity</th>
                <th className="pb-3 text-right">Foreign Equity</th>
                <th className="pb-3 text-right">Debt & Cash</th>
                <th className="pb-3 text-right">Source</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[...effectiveSeries].reverse().map((s) => (
                <tr key={s.snapshotMonth} className="hover:bg-slate-50/70">
                  <td className="py-3 font-bold text-slate-800">{formatMonthLabel(s.snapshotMonth)}</td>
                  <td className="py-3 text-right font-black text-slate-900 tabular-nums">
                    ₹{Math.round(s.totalINR).toLocaleString('en-IN')}
                  </td>
                  <td className="py-3 text-right text-slate-600 tabular-nums">{formatCompactINR(s.indianEquityINR)}</td>
                  <td className="py-3 text-right text-slate-600 tabular-nums">{formatCompactINR(s.foreignEquityINR)}</td>
                  <td className="py-3 text-right text-slate-600 tabular-nums">{formatCompactINR(s.debtINR)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                      {s.source.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {snapshots.some((raw) => raw.snapshotMonth === s.snapshotMonth) && (
                      <button
                        type="button"
                        aria-label={`Delete snapshot ${s.snapshotMonth}`}
                        onClick={() => onDeleteMonth(s.snapshotMonth)}
                        className="p-2 text-slate-400 hover:text-rose-600 rounded-lg inline-flex"
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Backfill Past Month Modal */}
      {showBackfillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900">Log Historical Monthly Snapshot</h3>
                <p className="text-xs text-slate-500">Record past months to plot your historical family wealth curve</p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowBackfillModal(false)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveBackfill} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Month (YYYY-MM)</label>
                  <input
                    type="month"
                    aria-label="Snapshot Month"
                    required
                    value={bfMonth}
                    onChange={(e) => setBfMonth(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Total Net Worth (₹)</label>
                  <input
                    type="number"
                    aria-label="Total Net Worth in INR"
                    placeholder="e.g. 14800000"
                    value={bfTotalINR}
                    onChange={(e) => setBfTotalINR(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
                <div className="text-[11px] font-bold text-slate-500">Optional Asset Breakdown (₹) — auto-estimated if left blank</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Indian Eq</label>
                    <input
                      type="number"
                      aria-label="Indian Equity in INR"
                      placeholder="₹"
                      value={bfIndEqINR}
                      onChange={(e) => setBfIndEqINR(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Foreign Eq</label>
                    <input
                      type="number"
                      aria-label="Foreign Equity in INR"
                      placeholder="₹"
                      value={bfForEqINR}
                      onChange={(e) => setBfForEqINR(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Debt & Cash</label>
                    <input
                      type="number"
                      aria-label="Debt and Cash in INR"
                      placeholder="₹"
                      value={bfDebtINR}
                      onChange={(e) => setBfDebtINR(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Note (Optional)</label>
                <input
                  type="text"
                  aria-label="Snapshot Note"
                  placeholder="e.g. Oct CAMS + Schwab statement"
                  value={bfNote}
                  onChange={(e) => setBfNote(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingBf}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-md transition-all disabled:opacity-50"
              >
                {isSavingBf ? 'Saving Snapshot...' : 'Save Monthly Snapshot'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
