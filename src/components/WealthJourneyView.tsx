import React, { useState, useMemo, useEffect } from 'react';
import { shortenAssetName } from '../lib/formatAssetName';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
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
  Search,
  Users,
  Layers,
  Globe,
  Scale,
  BarChart3,
  X
} from 'lucide-react';
import {
  formatCompactINR,
  formatCompactUSD,
  FX_FALLBACK_RATE,
  WEALTH_MILESTONES_INR
} from '../shared/formatters';
import type {
  MemberSnapshotBreakdown,
  HoldingSnapshotBreakdown,
  RebalanceSnapshotMeta,
  WealthSnapshotRecord,
  DailyWealthRecord,
  TaxLot,
  RsuGrant
} from '../types';
import {
  computePortfolioTaxIntelligence,
  computeXirrFromEvaluatedLots,
  simulateRsuForwardPlan
} from '../shared/taxAndRsuMath';

export { formatCompactINR, formatCompactUSD };
export type MemberSnapshotEntry = MemberSnapshotBreakdown;
export type HoldingSnapshotEntry = HoldingSnapshotBreakdown;
export type { RebalanceSnapshotMeta };
export type WealthSnapshotItem = WealthSnapshotRecord;

const CompoundingSimulatorCard = React.memo(function CompoundingSimulatorCard({
  currentINR,
  scopeLabel
}: {
  currentINR: number;
  scopeLabel: string;
}) {
  const [monthlySipINR, setMonthlySipINR] = useState(150000);
  const [annualReturnPct, setAnnualReturnPct] = useState(12);
  const [horizonYears, setHorizonYears] = useState(10);

  const projectionData = useMemo(() => {
    const startPrincipal = currentINR || 0;
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
  }, [currentINR, monthlySipINR, annualReturnPct, horizonYears]);

  const finalProjectedINR = projectionData[projectionData.length - 1]?.projected || 0;

  return (
    <div className="bg-slate-900 text-white p-5 sm:p-7 rounded-2xl shadow-lg">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-4 lg:w-5/12">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-black uppercase tracking-widest">
            <Sparkles size={15} /> {scopeLabel} Compounding Trajectory
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-white">
              {formatCompactINR(finalProjectedINR)}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Projected wealth in <strong>{horizonYears} years</strong> starting from {formatCompactINR(currentINR)}
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <div className="flex justify-between text-xs font-bold mb-1">
                <span className="text-slate-400">Monthly SIP / Savings</span>
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
  );
});

function cleanDisplayAssetName(raw: string, ticker?: string): string {
  if (!raw) return 'Asset';
  return shortenAssetName(raw, ticker) || 'Asset';
}

function formatMonthLabel(ym: string): string {
  const parts = (ym || '').split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const idx = parseInt(m, 10) - 1;
  if (!y || isNaN(idx) || idx < 0 || idx > 11) return ym;
  if (d) {
    return `${parseInt(d, 10)} ${names[idx]}`;
  }
  return `${names[idx]} '${y.slice(-2)}`;
}

const MILESTONES_INR = WEALTH_MILESTONES_INR;

const MEMBER_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'];

type ChartLens = 'netWorth' | 'equityDebt' | 'indiaForeign' | 'rebalance' | 'stockFund' | 'members';

interface Props {
  snapshots: WealthSnapshotItem[];
  dailyRecords?: DailyWealthRecord[];
  stats: any;
  holdings?: any[];
  targets?: {
    assetSplit?: { Equity?: number; Debt?: number };
    equitySplit?: { Indian?: number; Foreign?: number };
    equity?: number;
    debt?: number;
    indianEquity?: number;
    foreignEquity?: number;
  };
  fxRate: number;
  members: { id: string; name: string }[];
  activeScope?: 'family' | string;
  onScopeChange?: (scope: 'family' | string) => void;
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
  realEstateEquityINR?: number;
  realEstateByMember?: Record<string, number>;
  includeRealEstate?: boolean;
  taxLots?: TaxLot[];
  rsuGrants?: RsuGrant[];
  onOpenRsuForecast?: () => void;
}

export function WealthJourneyView({
  snapshots,
  dailyRecords = [],
  stats,
  holdings = [],
  targets,
  fxRate,
  members,
  activeScope,
  onScopeChange,
  isRecording,
  onRecordCurrentSnapshot,
  onBackfillMonth,
  onDeleteMonth,
  realEstateEquityINR = 0,
  realEstateByMember = {},
  includeRealEstate = true,
  taxLots = [],
  rsuGrants = [],
  onOpenRsuForecast
}: Props) {
  // Scope: 'family' (combined) or a specific member.id — synced with global header member pills
  const [internalScope, setInternalScope] = useState<'family' | string>('family');
  const scope = activeScope !== undefined ? activeScope : internalScope;
  const setScope = (next: 'family' | string) => {
    setInternalScope(next);
    if (onScopeChange) onScopeChange(next);
  };
  const [lens, setLens] = useState<ChartLens>('netWorth');
  const [cadence, setCadence] = useState<'monthly' | 'daily'>('monthly');
  const [unitMode, setUnitMode] = useState<'value' | 'pct'>('value');
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [range, setRange] = useState<'6M' | '1Y' | '3Y' | 'ALL'>('1Y');
  const [dailyRange, setDailyRange] = useState<'7D' | '30D' | '90D' | '1Y' | 'ALL'>('30D');

  // Stock / Fund Explorer State
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>('');
  const [assetSearch, setAssetSearch] = useState<string>('');
  const [showAssetDropdown, setShowAssetDropdown] = useState(false);
  const [assetSourceMode, setAssetSourceMode] = useState<'market' | 'snapshots'>('market');
  const [assetMarketHistory, setAssetMarketHistory] = useState<{
    loading: boolean;
    points: { date: string; label: string; price: number }[];
    changePct: number;
    currency: string;
    source: string;
  }>({ loading: false, points: [], changePct: 0, currency: 'INR', source: '' });

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

  const safeFx = fxRate || FX_FALLBACK_RATE;
  const memberNameMap = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members]
  );
  const persistedSnapshotMonths = useMemo(
    () => new Set(snapshots.map((s) => s.snapshotMonth)),
    [snapshots]
  );
  const rawEqTarget =
    targets?.assetSplit?.Equity ??
    targets?.equity ??
    (stats?.targetEquityPct !== undefined ? stats.targetEquityPct : 0.7);
  const targetEqPct = Number(rawEqTarget <= 1.0001 ? rawEqTarget * 100 : rawEqTarget);

  const rawIndTarget =
    targets?.equitySplit?.Indian ??
    targets?.indianEquity ??
    (stats?.targetIndianEquityOfEquity !== undefined ? stats.targetIndianEquityOfEquity : 0.6);
  const targetIndOfEqPct = Number(rawIndTarget <= 1.0001 ? rawIndTarget * 100 : rawIndTarget);

  // Aggregate unique selectable assets for the current scope (Family or Individual Member)
  const scopedAssets = useMemo(() => {
    const rawList = (holdings.length > 0 ? holdings : stats?.holdings || []).filter(
      (h: any) => !h.isPlaceholder && (Number(h.quantity) || 0) * (Number(h.currentPrice) || 0) > 0
    );
    const filtered =
      scope === 'family'
        ? rawList
        : rawList.filter((h: any) => (h.ownerId || h.userId) === scope);

    const grouped = new Map<
      string,
      {
        key: string;
        ticker: string;
        name: string;
        displayName: string;
        assetClass: string;
        currency: 'INR' | 'USD';
        provider: string;
        units: number;
        price: number;
        valueINR: number;
      }
    >();

    filtered.forEach((h: any) => {
      const ticker = String(h.ticker || '').trim();
      const orig = String(h.originalName || ticker || 'Asset').trim();
      const key = `${ticker.toUpperCase()}|${orig.toLowerCase().slice(0, 40)}`;
      const qty = Number(h.quantity) || 0;
      const price = Number(h.currentPrice) || 0;
      const cur: 'INR' | 'USD' = h.currency === 'USD' ? 'USD' : 'INR';
      const valINR = cur === 'USD' ? qty * price * safeFx : qty * price;

      const existing = grouped.get(key);
      if (existing) {
        existing.units += qty;
        existing.valueINR += valINR;
        if (price > 0) existing.price = price;
      } else {
        grouped.set(key, {
          key,
          ticker,
          name: orig,
          displayName: cleanDisplayAssetName(orig, ticker),
          assetClass: h.assetClass || 'Equity',
          currency: cur,
          provider: h.provider || 'Portfolio',
          units: qty,
          price,
          valueINR: valINR
        });
      }
    });

    return Array.from(grouped.values()).sort((a, b) => b.valueINR - a.valueINR);
  }, [holdings, stats, scope, safeFx]);

  // Keep selectedAssetKey valid whenever scope or holdings change
  useEffect(() => {
    if (scopedAssets.length === 0) {
      setSelectedAssetKey('');
      return;
    }
    if (!selectedAssetKey || !scopedAssets.some((a) => a.key === selectedAssetKey)) {
      setSelectedAssetKey(scopedAssets[0].key);
    }
  }, [scopedAssets, selectedAssetKey]);

  const activeAsset = useMemo(
    () => scopedAssets.find((a) => a.key === selectedAssetKey) || scopedAssets[0] || null,
    [scopedAssets, selectedAssetKey]
  );

  // Fetch live historical NAV / stock curve whenever Stock/Fund lens is active
  useEffect(() => {
    if (lens !== 'stockFund' || !activeAsset) return;
    const isManualOnly =
      !activeAsset.ticker ||
      activeAsset.ticker.toUpperCase() === 'MANUAL' ||
      activeAsset.provider.toLowerCase() === 'manual';
    if (isManualOnly) {
      setAssetMarketHistory({
        loading: false,
        points: [],
        changePct: 0,
        currency: activeAsset.currency,
        source: 'manual'
      });
      return;
    }

    let cancelled = false;
    setAssetMarketHistory((prev) => ({ ...prev, loading: true }));
    const sym = encodeURIComponent(activeAsset.ticker || activeAsset.name);
    const qName = encodeURIComponent(activeAsset.name || '');
    fetch(`/api/asset-history/${sym}?range=${range}&name=${qName}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setAssetMarketHistory({
          loading: false,
          points: Array.isArray(data?.points) ? data.points : [],
          changePct: Number(data?.changePct) || 0,
          currency: data?.currency || activeAsset.currency,
          source: data?.source || ''
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAssetMarketHistory({
            loading: false,
            points: [],
            changePct: 0,
            currency: activeAsset.currency,
            source: ''
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lens, activeAsset?.key, range]);

  // Build live current-month snapshot with full per-member & per-holding breakdown
  const effectiveSeries = useMemo(() => {
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const map = new Map<string, WealthSnapshotItem>();
    snapshots.forEach((s) => map.set(s.snapshotMonth, s));

    const allHoldings = (holdings.length > 0 ? holdings : stats?.holdings || []).filter(
      (h: any) => !h.isPlaceholder
    );

    if (stats && stats.totalValINR > 0) {
      const memberMap = new Map<string, MemberSnapshotEntry>();
      members.forEach((m) => {
        memberMap.set(m.id, {
          id: m.id,
          name: m.name,
          valueINR: 0,
          indianEquityINR: 0,
          foreignEquityINR: 0,
          debtINR: 0
        });
      });

      const holdingSnapList: HoldingSnapshotEntry[] = [];
      allHoldings.forEach((h: any) => {
        const ownerId = h.ownerId || h.userId || members[0]?.id || '';
        const qty = Number(h.quantity) || 0;
        const price = Number(h.currentPrice) || 0;
        const valINR = h.currency === 'USD' ? qty * price * safeFx : qty * price;
        if (!(valINR > 0)) return;

        const entry = memberMap.get(ownerId) || {
          id: ownerId,
          name: members.find((m) => m.id === ownerId)?.name || 'Member',
          valueINR: 0,
          indianEquityINR: 0,
          foreignEquityINR: 0,
          debtINR: 0
        };
        entry.valueINR += valINR;
        if (h.assetClass === 'Debt') {
          entry.debtINR = (entry.debtINR || 0) + valINR;
        } else if (h.currency === 'USD') {
          entry.foreignEquityINR = (entry.foreignEquityINR || 0) + valINR;
        } else {
          entry.indianEquityINR = (entry.indianEquityINR || 0) + valINR;
        }
        memberMap.set(ownerId, entry);

        const ticker = String(h.ticker || '').trim();
        const orig = String(h.originalName || ticker || 'Asset').trim();
        holdingSnapList.push({
          key: `${ticker.toUpperCase()}|${orig.toLowerCase().slice(0, 40)}`,
          ticker,
          name: orig,
          ownerId,
          assetClass: h.assetClass || 'Equity',
          currency: h.currency === 'USD' ? 'USD' : 'INR',
          provider: h.provider || 'Portfolio',
          units: qty,
          price,
          valueINR: valINR
        });
      });

      const eqINR = (stats.indianEquityValINR || 0) + (stats.foreignEquityValINR || 0);
      const actualEqPct = stats.totalValINR > 0 ? (eqINR / stats.totalValINR) * 100 : 0;
      const actualIndOfEqPct = eqINR > 0 ? ((stats.indianEquityValINR || 0) / eqINR) * 100 : 0;
      const alignPct = Math.max(0, 100 - Math.abs(actualEqPct - targetEqPct));

      map.set(currentYm, {
        householdId: '',
        snapshotMonth: currentYm,
        recordedAt: Date.now(),
        totalINR: stats.totalValINR,
        totalUSD: stats.totalValUSD,
        indianEquityINR: stats.indianEquityValINR,
        foreignEquityINR: stats.foreignEquityValINR,
        debtINR: stats.debtValINR,
        realEstateEquityINR,
        fxRate: safeFx,
        holdingsCount: holdingSnapList.length,
        memberBreakdown: Array.from(memberMap.values()),
        holdingsBreakdown: holdingSnapList,
        rebalanceMeta: {
          actualEquityPct: Number(actualEqPct.toFixed(1)),
          targetEquityPct: Number(targetEqPct.toFixed(1)),
          actualIndianOfEqPct: Number(actualIndOfEqPct.toFixed(1)),
          targetIndianOfEqPct: Number(targetIndOfEqPct.toFixed(1)),
          alignmentPct: Number(alignPct.toFixed(1))
        },
        source: map.get(currentYm)?.source || 'live',
        note: map.get(currentYm)?.note || 'Live current portfolio'
      });
    }

    if (cadence === 'daily') {
      const dayMap = new Map<string, WealthSnapshotItem>();
      (dailyRecords || []).forEach((d) => {
        if (!d?.dateKey) return;
        const eq = (d.indianEquityINR || 0) + (d.foreignEquityINR || 0);
        const tot = d.totalNetWorthINR || eq + (d.debtINR || 0);
        const actualEqPct = tot > 0 ? (eq / tot) * 100 : 0;
        const actualIndOfEqPct = eq > 0 ? ((d.indianEquityINR || 0) / eq) * 100 : 0;
        const alignPct = Math.max(0, 100 - Math.abs(actualEqPct - targetEqPct));
        dayMap.set(d.dateKey, {
          householdId: d.householdId || '',
          snapshotMonth: d.dateKey,
          recordedAt: d.updatedAt || Date.now(),
          totalINR: tot,
          totalUSD: tot / (d.fxRateINR || safeFx),
          indianEquityINR: d.indianEquityINR || 0,
          foreignEquityINR: d.foreignEquityINR || 0,
          debtINR: d.debtINR || 0,
          realEstateEquityINR: d.realEstateEquityINR ?? realEstateEquityINR,
          fxRate: d.fxRateINR || safeFx,
          holdingsCount: holdings.length,
          memberBreakdown: d.memberBreakdown || [],
          providerBreakdown: {},
          rebalanceMeta: {
            actualEquityPct: Number(actualEqPct.toFixed(1)),
            targetEquityPct: Number(targetEqPct.toFixed(1)),
            actualIndianOfEqPct: Number(actualIndOfEqPct.toFixed(1)),
            targetIndianOfEqPct: Number(targetIndOfEqPct.toFixed(1)),
            alignmentPct: Number(alignPct.toFixed(1))
          },
          source: 'daily',
          note: `Daily valuation (${d.dateKey})`
        });
      });

      // Always upsert today's live IST point so Daily chart reflects live prices immediately
      const liveToday = map.get(currentYm);
      if (liveToday) {
        const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        const todayIstKey = nowIst.toISOString().slice(0, 10);
        dayMap.set(todayIstKey, {
          ...liveToday,
          snapshotMonth: todayIstKey,
          source: 'live',
          note: 'Live today'
        });
      }

      const sortedDays = Array.from(dayMap.values()).sort((a, b) =>
        a.snapshotMonth.localeCompare(b.snapshotMonth)
      );
      if (dailyRange === '7D') return sortedDays.slice(-7);
      if (dailyRange === '30D') return sortedDays.slice(-30);
      if (dailyRange === '90D') return sortedDays.slice(-90);
      if (dailyRange === '1Y') return sortedDays.slice(-365);
      return sortedDays;
    }

    const sorted = Array.from(map.values()).sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth));
    if (range === '6M') return sorted.slice(-6);
    if (range === '1Y') return sorted.slice(-12);
    if (range === '3Y') return sorted.slice(-36);
    return sorted;
  }, [snapshots, dailyRecords, cadence, dailyRange, stats, holdings, members, safeFx, range, targetEqPct, targetIndOfEqPct, realEstateEquityINR]);

  // Project series through the selected scope ('family' vs individual member)
  const scopedSeries = useMemo(() => {
    return effectiveSeries.map((s) => {
      if (scope === 'family') {
        const eq = (s.indianEquityINR || 0) + (s.foreignEquityINR || 0);
        const liquidTot = s.totalINR || eq + (s.debtINR || 0);
        const reEq = includeRealEstate ? (s.realEstateEquityINR ?? realEstateEquityINR ?? 0) : 0;
        const tot = liquidTot + reEq;
        const eqPct = liquidTot > 0 ? (eq / liquidTot) * 100 : 0;
        const debtPct = liquidTot > 0 ? ((s.debtINR || 0) / liquidTot) * 100 : 0;
        const indOfEqPct = eq > 0 ? ((s.indianEquityINR || 0) / eq) * 100 : 0;
        const forOfEqPct = eq > 0 ? ((s.foreignEquityINR || 0) / eq) * 100 : 0;
        const tEq = s.rebalanceMeta?.targetEquityPct ?? targetEqPct;
        const tInd = s.rebalanceMeta?.targetIndianOfEqPct ?? targetIndOfEqPct;
        const alignment = Math.max(0, 100 - Math.abs(eqPct - tEq));
        return {
          month: s.snapshotMonth,
          label: formatMonthLabel(s.snapshotMonth),
          totalINR: tot,
          indianEquityINR: s.indianEquityINR || 0,
          foreignEquityINR: s.foreignEquityINR || 0,
          equityINR: eq,
          debtINR: s.debtINR || 0,
          realEstateEquityINR: reEq,
          equityPct: Number(eqPct.toFixed(1)),
          debtPct: Number(debtPct.toFixed(1)),
          indOfEqPct: Number(indOfEqPct.toFixed(1)),
          forOfEqPct: Number(forOfEqPct.toFixed(1)),
          targetEqPct: Number(tEq.toFixed(1)),
          targetIndPct: Number(tInd.toFixed(1)),
          alignmentPct: Number(alignment.toFixed(1)),
          raw: s
        };
      }

      // Individual Member Scope
      const mem = (s.memberBreakdown || []).find((mb) => mb.id === scope);
      const memLiquid = mem?.valueINR || 0;
      const memReEq = includeRealEstate
        ? (mem?.realEstateEquityINR ?? realEstateByMember[scope] ?? 0)
        : 0;
      const memTotal = memLiquid + memReEq;
      const hhTotal = s.totalINR || 1;
      const share = hhTotal > 0 ? memLiquid / hhTotal : 0;
      // Use exact per-member breakdown when stored, else proportional fallback for legacy snapshots
      const hasExactAssetSplit =
        mem &&
        (mem.indianEquityINR !== undefined || mem.foreignEquityINR !== undefined || mem.debtINR !== undefined);
      const indINR = hasExactAssetSplit ? mem?.indianEquityINR || 0 : (s.indianEquityINR || 0) * share;
      const forINR = hasExactAssetSplit ? mem?.foreignEquityINR || 0 : (s.foreignEquityINR || 0) * share;
      const dbtINR = hasExactAssetSplit ? mem?.debtINR || 0 : (s.debtINR || 0) * share;
      const eqINR = indINR + forINR;
      const eqPct = memLiquid > 0 ? (eqINR / memLiquid) * 100 : 0;
      const debtPct = memLiquid > 0 ? (dbtINR / memLiquid) * 100 : 0;
      const indOfEqPct = eqINR > 0 ? (indINR / eqINR) * 100 : 0;
      const forOfEqPct = eqINR > 0 ? (forINR / eqINR) * 100 : 0;
      const alignment = Math.max(0, 100 - Math.abs(eqPct - targetEqPct));

      return {
        month: s.snapshotMonth,
        label: formatMonthLabel(s.snapshotMonth),
        totalINR: memTotal,
        indianEquityINR: indINR,
        foreignEquityINR: forINR,
        equityINR: eqINR,
        debtINR: dbtINR,
        equityPct: Number(eqPct.toFixed(1)),
        debtPct: Number(debtPct.toFixed(1)),
        indOfEqPct: Number(indOfEqPct.toFixed(1)),
        forOfEqPct: Number(forOfEqPct.toFixed(1)),
        targetEqPct: Number(targetEqPct.toFixed(1)),
        targetIndPct: Number(targetIndOfEqPct.toFixed(1)),
        alignmentPct: Number(alignment.toFixed(1)),
        raw: s
      };
    });
  }, [effectiveSeries, scope, targetEqPct, targetIndOfEqPct, includeRealEstate, realEstateEquityINR, realEstateByMember]);

  const chartData = useMemo(() => {
    const div = currency === 'USD' ? safeFx : 1;
    return scopedSeries.map((pt) => {
      const row: Record<string, any> = {
        month: pt.month,
        label: pt.label,
        total: Math.round(pt.totalINR / div),
        equity: Math.round(pt.equityINR / div),
        debt: Math.round(pt.debtINR / div),
        indianEquity: Math.round(pt.indianEquityINR / div),
        foreignEquity: Math.round(pt.foreignEquityINR / div),
        equityPct: pt.equityPct,
        debtPct: pt.debtPct,
        indOfEqPct: pt.indOfEqPct,
        forOfEqPct: pt.forOfEqPct,
        targetEqPct: pt.targetEqPct,
        targetIndPct: pt.targetIndPct,
        alignmentPct: pt.alignmentPct
      };
      members.forEach((m) => {
        const found = (pt.raw.memberBreakdown || []).find((mb) => mb.id === m.id || mb.name === m.name);
        const reAdd = includeRealEstate ? (found?.realEstateEquityINR ?? realEstateByMember[m.id] ?? 0) : 0;
        row[`m_${m.id}`] = Math.round((((found?.valueINR || 0) + reAdd) / div));
      });
      return row;
    });
  }, [scopedSeries, currency, safeFx, members, includeRealEstate, realEstateByMember]);

  // Stock / Fund Chart Data (either Live Market Trajectory × Units OR Recorded Monthly Snapshots)
  const stockFundSeries = useMemo(() => {
    if (!activeAsset) return [];
    const div = currency === 'USD' ? safeFx : 1;

    if (assetSourceMode === 'market' && assetMarketHistory.points.length >= 2) {
      return assetMarketHistory.points.map((p) => {
        const posValINR =
          assetMarketHistory.currency === 'USD'
            ? activeAsset.units * p.price * safeFx
            : activeAsset.units * p.price;
        return {
          label: p.label,
          date: p.date,
          positionVal: Math.round(posValINR / div),
          unitPrice: p.price
        };
      });
    }

    // Recorded snapshot history for this asset
    const snapPts: { label: string; date: string; positionVal: number; unitPrice: number }[] = [];
    scopedSeries.forEach((pt) => {
      const items = (pt.raw.holdingsBreakdown || []).filter((hb) => {
        const matchAsset =
          hb.key === activeAsset.key ||
          (activeAsset.ticker && hb.ticker.toUpperCase() === activeAsset.ticker.toUpperCase());
        const matchOwner = scope === 'family' || hb.ownerId === scope;
        return matchAsset && matchOwner;
      });
      if (items.length > 0) {
        const sumValINR = items.reduce((s, x) => s + (x.valueINR || 0), 0);
        const price = items[0].price || activeAsset.price;
        snapPts.push({
          label: pt.label,
          date: pt.month,
          positionVal: Math.round(sumValINR / div),
          unitPrice: price
        });
      }
    });
    return snapPts;
  }, [activeAsset, assetSourceMode, assetMarketHistory, scopedSeries, currency, safeFx, scope]);

  const metrics = useMemo(() => {
    const latest = scopedSeries[scopedSeries.length - 1];
    const currentINR = latest?.totalINR || 0;
    const prevSnap = scopedSeries.length >= 2 ? scopedSeries[scopedSeries.length - 2] : null;
    const firstSnap = scopedSeries.length >= 2 ? scopedSeries[0] : null;
    const momDeltaINR = prevSnap ? currentINR - prevSnap.totalINR : 0;
    const momPct = prevSnap && prevSnap.totalINR > 0 ? (momDeltaINR / prevSnap.totalINR) * 100 : 0;
    const allTimeDeltaINR = firstSnap ? currentINR - firstSnap.totalINR : 0;
    const allTimePct = firstSnap && firstSnap.totalINR > 0 ? (allTimeDeltaINR / firstSnap.totalINR) * 100 : 0;

    const eqINR = latest?.equityINR || 0;
    const debtINR = latest?.debtINR || 0;
    const indEqINR = latest?.indianEquityINR || 0;
    const forEqINR = latest?.foreignEquityINR || 0;
    const eqPct = latest?.equityPct || 0;
    const debtPct = latest?.debtPct || 0;
    const indOfEqPct = latest?.indOfEqPct || 0;
    const forOfEqPct = latest?.forOfEqPct || 0;
    const alignmentPct = latest?.alignmentPct || 100;

    const nextMilestone = MILESTONES_INR.find((ms) => ms > currentINR) || currentINR * 2 || 1_00_00_000;
    const milestoneProgress = Math.min(100, (currentINR / nextMilestone) * 100);

    return {
      currentINR,
      eqINR,
      debtINR,
      indEqINR,
      forEqINR,
      eqPct,
      debtPct,
      indOfEqPct,
      forOfEqPct,
      alignmentPct,
      momDeltaINR,
      momPct,
      allTimeDeltaINR,
      allTimePct,
      hasPrev: !!prevSnap,
      nextMilestone,
      milestoneProgress
    };
  }, [scopedSeries]);

  const formatVal = (v: number) => (currency === 'USD' ? formatCompactUSD(v) : formatCompactINR(v));
  const activeScopeName =
    scope === 'family'
      ? 'Family Combined'
      : memberNameMap.get(scope) || 'Member';

  // Compute True Cash-Flow XIRR & Unvested RSU Pipeline summary when dated lots / RSU grants exist
  const xirrAndRsuMeta = useMemo(() => {
    let xirrPct: number | null = null;
    let unvestedNetINR = 0;
    if (stats && taxLots.length > 0) {
      const filteredLots =
        scope === 'family' ? taxLots : taxLots.filter((l) => l.ownerId === scope);
      if (filteredLots.length > 0) {
        const intel = computePortfolioTaxIntelligence({
          stats,
          taxLots: filteredLots,
          members,
          fxRate: safeFx
        });
        const xr = computeXirrFromEvaluatedLots(intel.evaluatedLots);
        xirrPct = xr.xirrPct;
      }
    }
    if (stats && rsuGrants.length > 0) {
      const filteredGrants =
        scope === 'family' ? rsuGrants : rsuGrants.filter((g) => g.ownerId === scope);
      if (filteredGrants.length > 0) {
        const sim = simulateRsuForwardPlan({
          stats,
          rsuGrants: filteredGrants,
          targets: targets || { assetSplit: { Equity: 70, Debt: 30 }, equitySplit: { Indian: 60, Foreign: 40 }, foreignBreakdown: [] },
          members,
          fxRate: safeFx,
          horizonMonths: 24
        });
        unvestedNetINR = sim.totalNetVestValueINR;
      }
    }
    return { xirrPct, unvestedNetINR };
  }, [stats, taxLots, rsuGrants, scope, members, safeFx, targets]);

  const filteredDropdownAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    if (!q) return scopedAssets;
    return scopedAssets.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.ticker.toLowerCase().includes(q) ||
        a.provider.toLowerCase().includes(q)
    );
  }, [scopedAssets, assetSearch]);

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
      const resolvedInd = ind > 0 ? ind : Math.round(resolvedTotal * 0.42);
      const resolvedFrn = frn > 0 ? frn : Math.round(resolvedTotal * 0.28);
      await onBackfillMonth({
        snapshotMonth: bfMonth,
        totalINR: resolvedTotal,
        indianEquityINR: resolvedInd,
        foreignEquityINR: resolvedFrn,
        debtINR: dbt > 0 ? dbt : Math.max(0, resolvedTotal - resolvedInd - resolvedFrn),
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
    <div className="space-y-5 pb-6 max-w-full overflow-x-hidden">
      {/* Header + Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Wealth Journey</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <ShieldCheck size={12} /> PostgreSQL Vault
            </span>
            {xirrAndRsuMeta.xirrPct !== null && (
              <span
                className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1"
                title="True annualized cash-flow XIRR across dated holdings"
              >
                <TrendingUp size={11} /> True XIRR: {xirrAndRsuMeta.xirrPct >= 0 ? '+' : ''}
                {xirrAndRsuMeta.xirrPct}% p.a.
              </span>
            )}
            {xirrAndRsuMeta.unvestedNetINR > 0 && (
              <button
                type="button"
                onClick={onOpenRsuForecast}
                className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1 hover:bg-amber-100 transition-colors"
                title="Projected net RSU vests over next 24 months (excluded from current liquid balance)"
              >
                <Sparkles size={11} /> +{formatCompactINR(xirrAndRsuMeta.unvestedNetINR)} Unvested RSU →
              </button>
            )}
            {scope !== 'family' && (
              <button
                type="button"
                onClick={() => setScope('family')}
                className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1 hover:bg-indigo-100 transition-colors"
              >
                <Users size={11} /> {activeScopeName} ×
              </button>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Track net worth, equity/debt balance, India vs foreign exposure, rebalancing alignment & individual holdings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRecordCurrentSnapshot}
            disabled={isRecording || !(metrics.currentINR > 0)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
          >
            {isRecording ? <RefreshCcw size={14} className="animate-spin text-indigo-600" /> : <Camera size={14} className="text-indigo-600" />}
            Snapshot Month
          </button>
          <button
            type="button"
            onClick={() => setShowBackfillModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus size={14} /> Log Past Month
          </button>
        </div>
      </div>

      {/* Scoped Rich 4-Card Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Net Worth + MoM */}
        <div
          onClick={() => setLens('netWorth')}
          className={`bg-white p-4 sm:p-5 rounded-2xl border shadow-sm cursor-pointer transition-all ${
            lens === 'netWorth' ? 'border-indigo-500 ring-2 ring-indigo-500/10' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider truncate">
              {scope === 'family' ? 'Family Net Worth' : `${activeScopeName}`}
            </span>
            {metrics.hasPrev && (
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded-md flex items-center shrink-0 ${
                  metrics.momDeltaINR >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {metrics.momDeltaINR >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                {metrics.momPct >= 0 ? '+' : ''}
                {metrics.momPct.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">{formatCompactINR(metrics.currentINR)}</div>
          <div className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">
            {formatCompactUSD(metrics.currentINR / safeFx)} • {scopedAssets.length} holdings
          </div>
        </div>

        {/* Card 2: Equity vs Debt */}
        <div
          onClick={() => setLens('equityDebt')}
          className={`bg-white p-4 sm:p-5 rounded-2xl border shadow-sm cursor-pointer transition-all ${
            lens === 'equityDebt' ? 'border-indigo-500 ring-2 ring-indigo-500/10' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Equity : Debt</span>
            <span className="text-[10px] font-bold text-slate-400">Target {targetEqPct.toFixed(0)}:{(100 - targetEqPct).toFixed(0)}</span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">
            {metrics.eqPct.toFixed(0)}% <span className="text-slate-300 font-light">/</span>{' '}
            <span className="text-emerald-600">{metrics.debtPct.toFixed(0)}%</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
            Eq {formatCompactINR(metrics.eqINR)} • Debt {formatCompactINR(metrics.debtINR)}
          </div>
        </div>

        {/* Card 3: India vs Foreign Equity */}
        <div
          onClick={() => setLens('indiaForeign')}
          className={`bg-white p-4 sm:p-5 rounded-2xl border shadow-sm cursor-pointer transition-all ${
            lens === 'indiaForeign' ? 'border-indigo-500 ring-2 ring-indigo-500/10' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">India : Foreign Eq</span>
            <span className="text-[10px] font-bold text-slate-400">of Equity</span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">
            <span className="text-orange-600">{metrics.indOfEqPct.toFixed(0)}%</span>{' '}
            <span className="text-slate-300 font-light">/</span>{' '}
            <span className="text-blue-600">{metrics.forOfEqPct.toFixed(0)}%</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
            IN {formatCompactINR(metrics.indEqINR)} • US {formatCompactUSD(metrics.forEqINR / safeFx)}
          </div>
        </div>

        {/* Card 4: Rebalance Ratio & Alignment */}
        <div
          onClick={() => setLens('rebalance')}
          className={`bg-white p-4 sm:p-5 rounded-2xl border shadow-sm cursor-pointer transition-all ${
            lens === 'rebalance' ? 'border-indigo-500 ring-2 ring-indigo-500/10' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Rebalance Ratio</span>
            <span
              className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                metrics.alignmentPct >= 95 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {metrics.alignmentPct >= 95 ? 'Aligned' : 'Drift'}
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-black text-slate-900 mt-1">{metrics.alignmentPct.toFixed(1)}%</div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
            Eq Drift: {metrics.eqPct - targetEqPct >= 0 ? '+' : ''}
            {(metrics.eqPct - targetEqPct).toFixed(1)}% vs target
          </div>
        </div>
      </div>

      {/* Single Clean Multi-Lens Interactive Chart Card */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
        {/* Lens Switcher + Contextual Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar max-w-full">
            {[
              { id: 'netWorth', label: 'Net Worth', icon: <TrendingUp size={13} /> },
              { id: 'equityDebt', label: 'Equity vs Debt', icon: <Layers size={13} /> },
              { id: 'indiaForeign', label: 'India vs Foreign', icon: <Globe size={13} /> },
              { id: 'rebalance', label: 'Rebalance Ratio', icon: <Scale size={13} /> },
              { id: 'stockFund', label: 'Stock / Fund', icon: <BarChart3 size={13} /> },
              ...(members.length > 1 ? [{ id: 'members', label: 'Members', icon: <Users size={13} /> }] : [])
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLens(tab.id as ChartLens)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                  lens === tab.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Value vs % Toggle only when Equity/Debt or India/Foreign lens is selected */}
            {(lens === 'equityDebt' || lens === 'indiaForeign') && (
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setUnitMode('value')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    unitMode === 'value' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {currency === 'INR' ? '₹ Value' : '$ Value'}
                </button>
                <button
                  type="button"
                  onClick={() => setUnitMode('pct')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    unitMode === 'pct' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  % Mix
                </button>
              </div>
            )}

            {/* Currency Switcher (hidden when pure % mode is active) */}
            {lens !== 'rebalance' && !((lens === 'equityDebt' || lens === 'indiaForeign') && unitMode === 'pct') && (
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {(['INR', 'USD'] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setCurrency(cur)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      currency === cur ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    {cur === 'INR' ? '₹ INR' : '$ USD'}
                  </button>
                ))}
              </div>
            )}

            {/* Cadence Switcher: Monthly vs Daily */}
            {lens !== 'stockFund' && (
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setCadence('monthly')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    cadence === 'monthly' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCadence('daily')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    cadence === 'daily' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Daily{dailyRecords.length > 0 ? ` (${dailyRecords.length}d)` : ''}
                </button>
              </div>
            )}

            {/* Time Horizon Switcher */}
            {cadence === 'daily' && lens !== 'stockFund' ? (
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {(['7D', '30D', '90D', '1Y', 'ALL'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDailyRange(r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      dailyRange === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {(['6M', '1Y', '3Y', 'ALL'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Progressive Disclosure: Stock / Mutual Fund Selector Bar (ONLY visible in Stock / Fund lens!) */}
        {lens === 'stockFund' && (
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            {scopedAssets.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium">
                No active holdings in {activeScopeName} yet. Import a statement or add a stock/mutual fund to inspect its trajectory.
              </p>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  {/* Searchable Holding Selector */}
                  <div className="relative flex-1 max-w-md">
                    <button
                      type="button"
                      onClick={() => setShowAssetDropdown((v) => !v)}
                      aria-label="Select individual stock or mutual fund"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 hover:border-indigo-300 rounded-xl text-left flex items-center justify-between gap-2 shadow-xs"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-900 truncate">
                          {activeAsset?.displayName}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          {activeAsset?.ticker} • {activeAsset?.assetClass} • {activeAsset?.provider}
                        </div>
                      </div>
                      <span className="text-xs font-black text-indigo-600 shrink-0">
                        {activeAsset ? formatVal(currency === 'USD' ? activeAsset.valueINR / safeFx : activeAsset.valueINR) : ''} ▾
                      </span>
                    </button>

                    {showAssetDropdown && (
                      <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-2xl border border-slate-200 shadow-2xl z-30 max-h-72 flex flex-col overflow-hidden">
                        <div className="p-2 border-b border-slate-100 flex items-center gap-2">
                          <Search size={14} className="text-slate-400 ml-1.5 shrink-0" />
                          <input
                            type="text"
                            aria-label="Filter stocks and mutual funds"
                            value={assetSearch}
                            onChange={(e) => setAssetSearch(e.target.value)}
                            placeholder="Search stock, mutual fund or ticker..."
                            className="w-full text-xs font-medium py-1 pr-2 outline-none bg-transparent"
                            autoFocus
                          />
                          {assetSearch && (
                            <button
                              type="button"
                              aria-label="Clear search"
                              onClick={() => setAssetSearch('')}
                              className="text-slate-400 hover:text-slate-600 p-1"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        <div className="overflow-y-auto divide-y divide-slate-50">
                          {filteredDropdownAssets.map((asset) => (
                            <button
                              key={asset.key}
                              type="button"
                              onClick={() => {
                                setSelectedAssetKey(asset.key);
                                setShowAssetDropdown(false);
                              }}
                              className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-indigo-50/50 transition-colors ${
                                activeAsset?.key === asset.key ? 'bg-indigo-50/80' : ''
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800 truncate">{asset.displayName}</div>
                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                  {asset.ticker} • {asset.assetClass} • {asset.provider}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-xs font-black text-slate-900 tabular-nums">
                                  {formatCompactINR(asset.valueINR)}
                                </div>
                                <div className="text-[10px] text-slate-400 tabular-nums">
                                  {metrics.currentINR > 0 ? ((asset.valueINR / metrics.currentINR) * 100).toFixed(1) : '0'}%
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Source Sub-Toggle + Live Stats */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex bg-white border border-slate-200 p-0.5 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setAssetSourceMode('market')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          assetSourceMode === 'market' ? 'bg-indigo-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        Market Curve ({range})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssetSourceMode('snapshots')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          assetSourceMode === 'snapshots' ? 'bg-indigo-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        My Snapshots
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Top-5 Holding Chips for 1-Tap Switching */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {scopedAssets.slice(0, 6).map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => {
                        setSelectedAssetKey(a.key);
                        setShowAssetDropdown(false);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 border transition-all ${
                        activeAsset?.key === a.key
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200'
                      }`}
                    >
                      {a.displayName.length > 22 ? `${a.displayName.slice(0, 22)}…` : a.displayName}
                    </button>
                  ))}
                </div>

                {/* Active Asset Compact Telemetry Bar */}
                {activeAsset && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-200/60 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Current Position</span>
                      <span className="font-black text-slate-900">
                        {formatCompactINR(activeAsset.valueINR)}{' '}
                        <span className="text-slate-400 font-semibold">
                          ({metrics.currentINR > 0 ? ((activeAsset.valueINR / metrics.currentINR) * 100).toFixed(1) : '0'}%)
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Units Held</span>
                      <span className="font-mono font-bold text-slate-800">
                        {activeAsset.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Live NAV / Price</span>
                      <span className="font-mono font-bold text-slate-800">
                        {activeAsset.currency === 'USD' ? '$' : '₹'}
                        {activeAsset.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">{range} Price Change</span>
                      {assetMarketHistory.loading ? (
                        <span className="text-slate-400 font-semibold">Loading…</span>
                      ) : assetMarketHistory.points.length >= 2 ? (
                        <span
                          className={`font-black ${
                            assetMarketHistory.changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {assetMarketHistory.changePct >= 0 ? '+' : ''}
                          {assetMarketHistory.changePct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-400 font-semibold">Snapshot tracked</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Chart Canvas */}
        {chartData.length === 0 && lens !== 'stockFund' ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <TrendingUp className="text-indigo-400 mb-3" size={32} />
            <p className="text-sm font-bold text-slate-700">Import your first statement or add an asset to start your wealth curve</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              UnityWealth automatically snapshots your family&apos;s monthly net worth, equity/debt balance, and individual holdings.
            </p>
          </div>
        ) : lens === 'stockFund' && stockFundSeries.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            {assetMarketHistory.loading ? (
              <>
                <RefreshCcw className="animate-spin text-indigo-500 mb-2" size={26} />
                <p className="text-xs font-bold text-slate-600">Loading historical NAV / market curve…</p>
              </>
            ) : (
              <>
                <BarChart3 className="text-indigo-400 mb-2" size={28} />
                <p className="text-sm font-bold text-slate-700">
                  {assetSourceMode === 'snapshots'
                    ? 'Only 1 recorded snapshot so far — switch to "Market Curve" or snapshot next month'
                    : 'Manual fixed asset — historical snapshots accumulate automatically each month'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="h-64 sm:h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {lens === 'netWorth' ? (
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
                      `${activeScopeName} Net Worth`
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
              ) : lens === 'equityDebt' ? (
                unitMode === 'pct' ? (
                  <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      formatter={(val: any, name: any) => [
                        `${Number(val).toFixed(1)}%`,
                        name === 'equityPct' ? 'Actual Equity %' : name === 'debtPct' ? 'Actual Debt %' : 'Target Equity %'
                      ]}
                      contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                    />
                    <ReferenceLine y={targetEqPct} stroke="#94a3b8" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="equityPct" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="debtPct" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                ) : (
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
                        name === 'equity' ? 'Total Equity' : 'Debt & Fixed Income'
                      ]}
                      contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                    />
                    <Area type="monotone" dataKey="equity" stackId="eqd" stroke="#4f46e5" fill="#c7d2fe" strokeWidth={2.5} />
                    <Area type="monotone" dataKey="debt" stackId="eqd" stroke="#10b981" fill="#a7f3d0" strokeWidth={2.5} />
                  </AreaChart>
                )
              ) : lens === 'indiaForeign' ? (
                unitMode === 'pct' ? (
                  <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      formatter={(val: any, name: any) => [
                        `${Number(val).toFixed(1)}%`,
                        name === 'indOfEqPct' ? 'Indian Equity %' : 'Foreign / US Equity %'
                      ]}
                      contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                    />
                    <ReferenceLine y={targetIndOfEqPct} stroke="#fb923c" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="indOfEqPct" stroke="#ea580c" strokeWidth={3} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="forOfEqPct" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                ) : (
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
                        name === 'indianEquity' ? 'Indian Equity (INR)' : 'Foreign Equity (US/Global)'
                      ]}
                      contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                    />
                    <Area type="monotone" dataKey="indianEquity" stackId="geo" stroke="#ea580c" fill="#fed7aa" strokeWidth={2.5} />
                    <Area type="monotone" dataKey="foreignEquity" stackId="geo" stroke="#2563eb" fill="#bfdbfe" strokeWidth={2.5} />
                  </AreaChart>
                )
              ) : lens === 'rebalance' ? (
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    formatter={(val: any, name: any) => [
                      `${Number(val).toFixed(1)}%`,
                      name === 'alignmentPct'
                        ? 'Portfolio Alignment Score'
                        : name === 'equityPct'
                        ? 'Actual Equity %'
                        : name === 'targetEqPct'
                        ? 'Target Equity %'
                        : 'India Share of Equity %'
                    ]}
                    contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                  />
                  <ReferenceLine y={95} stroke="#10b981" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="alignmentPct" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="equityPct" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="targetEqPct" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                </LineChart>
              ) : lens === 'stockFund' ? (
                <AreaChart data={stockFundSeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="uwAssetGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} />
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
                    formatter={(val: any, _name: any, item: any) => {
                      const uPrice = item?.payload?.unitPrice;
                      const formattedPos =
                        currency === 'INR'
                          ? `₹${Number(val).toLocaleString('en-IN')}`
                          : `$${Number(val).toLocaleString('en-US')}`;
                      const priceNote = uPrice ? ` (NAV/Price: ${activeAsset?.currency === 'USD' ? '$' : '₹'}${uPrice})` : '';
                      return [`${formattedPos}${priceNote}`, activeAsset?.displayName || 'Position Value'];
                    }}
                    contentStyle={{ borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 700 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="positionVal"
                    stroke="#0284c7"
                    strokeWidth={3}
                    fill="url(#uwAssetGrad)"
                    dot={stockFundSeries.length <= 14 ? { r: 3.5, fill: '#0284c7' } : false}
                    activeDot={{ r: 5 }}
                  />
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
                      const rawId = String(key || '').startsWith('m_') ? String(key).slice(2) : String(key);
                      return [formatVal(Number(val)), memberNameMap.get(rawId) || key];
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

        {/* Minimalist Legend / Context Strip matching active lens */}
        {lens === 'equityDebt' && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-bold">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" /> Equity: {formatCompactINR(metrics.eqINR)} ({metrics.eqPct.toFixed(1)}%)
              </span>
              <span className="flex items-center gap-1.5 font-bold">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Debt: {formatCompactINR(metrics.debtINR)} ({metrics.debtPct.toFixed(1)}%)
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              Target Ratio: {targetEqPct.toFixed(0)}% Equity / {(100 - targetEqPct).toFixed(0)}% Debt
            </span>
          </div>
        )}

        {lens === 'indiaForeign' && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-bold">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> India Eq: {formatCompactINR(metrics.indEqINR)} ({metrics.indOfEqPct.toFixed(1)}%)
              </span>
              <span className="flex items-center gap-1.5 font-bold">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> Foreign Eq: {formatCompactINR(metrics.forEqINR)} ({metrics.forOfEqPct.toFixed(1)}%)
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              Target Equity Split: {targetIndOfEqPct.toFixed(0)}% India / {(100 - targetIndOfEqPct).toFixed(0)}% Foreign
            </span>
          </div>
        )}

        {lens === 'rebalance' && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 font-bold text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Alignment: {metrics.alignmentPct.toFixed(1)}%
              </span>
              <span className="flex items-center gap-1.5 font-bold text-indigo-700">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" /> Actual Eq: {metrics.eqPct.toFixed(1)}%
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-slate-400">
                --- Target Eq: {targetEqPct.toFixed(0)}%
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              Rebalance Action: {formatCompactINR(Math.abs(((metrics.eqPct - targetEqPct) / 100) * metrics.currentINR))}{' '}
              {metrics.eqPct > targetEqPct ? '→ Debt' : '→ Equity'}
            </span>
          </div>
        )}

        {chartData.length === 1 && lens !== 'stockFund' && (
          <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-indigo-900 font-medium">
              <strong>Tip:</strong> Add 1–2 past months via <strong>Log Past Month</strong> to see multi-month trendlines right away, or switch to <strong>Stock / Fund</strong> to view 1Y–3Y live market curves.
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

      {/* Family Wealth Compounding & Financial Freedom Simulator (isolated memoized component) */}
      <CompoundingSimulatorCard
        currentINR={metrics.currentINR}
        scopeLabel={scope === 'family' ? 'Family' : activeScopeName}
      />

      {/* Monthly Snapshot Ledger */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-800">
              Monthly Snapshot Ledger ({activeScopeName})
            </h3>
            <p className="text-xs text-slate-500">Archived permanently in PostgreSQL across monthly syncs</p>
          </div>
          <span className="text-xs font-bold text-slate-400">{scopedSeries.length} records</span>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden space-y-2.5">
          {[...scopedSeries].reverse().map((pt) => (
            <div key={pt.month} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-900">{pt.label}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                    Eq {pt.equityPct.toFixed(0)}:{pt.debtPct.toFixed(0)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  IN Eq: {formatCompactINR(pt.indianEquityINR)} • US Eq: {formatCompactINR(pt.foreignEquityINR)}
                </div>
                <div className="text-[11px] text-slate-400">
                  Debt: {formatCompactINR(pt.debtINR)} • Align: {pt.alignmentPct.toFixed(0)}%
                </div>
              </div>
              <div className="text-right flex items-center gap-2">
                <div>
                  <div className="text-sm font-black text-slate-900">{formatCompactINR(pt.totalINR)}</div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">{pt.raw.source.replace('_', ' ')}</div>
                </div>
                {persistedSnapshotMonths.has(pt.month) && (
                  <button
                    type="button"
                    aria-label={`Delete snapshot ${pt.month}`}
                    onClick={() => onDeleteMonth(pt.month)}
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
                <th className="pb-3 text-right">Net Worth</th>
                <th className="pb-3 text-right">Eq : Debt</th>
                <th className="pb-3 text-right">India Eq</th>
                <th className="pb-3 text-right">Foreign Eq</th>
                <th className="pb-3 text-right">Debt</th>
                <th className="pb-3 text-right">Alignment</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[...scopedSeries].reverse().map((pt) => (
                <tr key={pt.month} className="hover:bg-slate-50/70">
                  <td className="py-3 font-bold text-slate-800">{pt.label}</td>
                  <td className="py-3 text-right font-black text-slate-900 tabular-nums">
                    ₹{Math.round(pt.totalINR).toLocaleString('en-IN')}
                  </td>
                  <td className="py-3 text-right font-mono text-xs font-bold text-indigo-600 tabular-nums">
                    {pt.equityPct.toFixed(0)} : {pt.debtPct.toFixed(0)}
                  </td>
                  <td className="py-3 text-right text-slate-600 tabular-nums">{formatCompactINR(pt.indianEquityINR)}</td>
                  <td className="py-3 text-right text-slate-600 tabular-nums">{formatCompactINR(pt.foreignEquityINR)}</td>
                  <td className="py-3 text-right text-slate-600 tabular-nums">{formatCompactINR(pt.debtINR)}</td>
                  <td className="py-3 text-right">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-black ${
                        pt.alignmentPct >= 95 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {pt.alignmentPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {persistedSnapshotMonths.has(pt.month) && (
                      <button
                        type="button"
                        aria-label={`Delete snapshot ${pt.month}`}
                        onClick={() => onDeleteMonth(pt.month)}
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
                  placeholder="e.g. Pre-bonus portfolio valuation"
                  value={bfNote}
                  onChange={(e) => setBfNote(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBackfillModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingBf}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
                >
                  {isSavingBf ? 'Saving...' : 'Save Month'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
