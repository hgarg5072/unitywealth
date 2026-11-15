import React, { useState, useMemo } from 'react';
import {
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  Globe,
  Plus,
  Pencil,
  Trash,
  Check,
  X
} from 'lucide-react';
import { formatCompactINR, formatCompactUSD } from './WealthJourneyView';

export type AssetRegionFilter =
  | 'all'
  | 'equity'
  | 'debt'
  | 'indian'
  | 'foreign'
  | 'indianEquity'
  | 'foreignEquity'
  | 'mutualFund';

export type HoldingSortKey =
  | 'valDesc'
  | 'valAsc'
  | 'weightDesc'
  | 'nameAsc'
  | 'priceDesc'
  | 'unitsDesc';

const STANDARD_ACCOUNTS = [
  { id: 'CAMS', label: 'CAMS / MF' },
  { id: 'Zerodha', label: 'Zerodha' },
  { id: 'INDmoney', label: 'INDmoney' },
  { id: 'Charles Schwab', label: 'Charles Schwab' },
  { id: 'E*TRADE', label: 'E*TRADE' },
  { id: 'IBKR', label: 'IBKR' },
  { id: 'Manual', label: 'Manual / EPF' }
];

export function normalizeAccountBucket(h: any): string {
  const raw = String(h?.provider || '').trim();
  const lower = raw.toLowerCase();
  const src = String(h?.source || '').toLowerCase();

  if (lower.includes('indmoney') || lower.includes('ind money')) return 'INDmoney';
  if (lower.includes('schwab')) return 'Charles Schwab';
  if (lower.includes('etrade') || lower.includes('e*trade') || lower.includes('e-trade') || lower.includes('morgan stanley')) {
    return 'E*TRADE';
  }
  if (lower.includes('ibkr') || lower.includes('interactive')) return 'IBKR';
  if (lower.includes('zerodha') || lower.includes('kite') || lower.includes('coin')) return 'Zerodha';
  if (
    lower.includes('cams') ||
    lower.includes('kfintech') ||
    lower.includes('karvy') ||
    lower.includes('mfcentral') ||
    (lower === 'amfi' && src.includes('pdf'))
  ) {
    return 'CAMS';
  }
  if (lower === 'amfi' && h?.assetClass === 'Mutual Fund') {
    return 'CAMS';
  }
  if (
    !raw ||
    lower === 'manual' ||
    lower === 'manual entry' ||
    lower.includes('epf') ||
    lower.includes('fd') ||
    lower.includes('bank') ||
    src === 'manual'
  ) {
    if (raw && !['manual', 'manual entry', 'finnhub', 'market-live', 'yahoo'].includes(lower)) {
      return raw;
    }
    return 'Manual';
  }
  if (['finnhub', 'market-live', 'yahoo'].includes(lower)) {
    return h?.currency === 'USD' ? 'US Direct' : 'India Direct';
  }
  return raw;
}

interface Props {
  holdings: any[];
  fxRate: number;
  members?: { id: string; name: string }[];
  showMemberFilter?: boolean;
  formatName: (raw: string) => string;
  title?: string;
  compactHeader?: boolean;
  onAddClick?: () => void;
  onUpdateHolding?: (id: string, quantity: number, currentPrice?: number) => Promise<void>;
  onDeleteHolding?: (id: string) => Promise<void>;
}

export function HoldingsExplorer({
  holdings,
  fxRate,
  members = [],
  showMemberFilter = false,
  formatName,
  title = 'Holdings Details',
  compactHeader = false,
  onAddClick,
  onUpdateHolding,
  onDeleteHolding
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [assetFilter, setAssetFilter] = useState<AssetRegionFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<HoldingSortKey>('valDesc');

  // Inline edit / delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [editPrice, setEditPrice] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const safeFx = fxRate || 84;

  const enriched = useMemo(() => {
    const clean = holdings.filter((h) => !h?.isPlaceholder);
    const totalAllINR = clean.reduce((sum, h) => {
      const v =
        typeof h.valINR === 'number'
          ? h.valINR
          : h.currency === 'USD'
          ? (Number(h.quantity) || 0) * (Number(h.currentPrice) || 0) * safeFx
          : (Number(h.quantity) || 0) * (Number(h.currentPrice) || 0);
      return sum + v;
    }, 0);

    return clean.map((h) => {
      const qty = Number(h.quantity) || 0;
      const price = Number(h.currentPrice) || 0;
      const valINR =
        typeof h.valINR === 'number'
          ? h.valINR
          : h.currency === 'USD'
          ? qty * price * safeFx
          : qty * price;
      const ownerId = h.ownerId || h.userId || '';
      const ownerName = members.find((m) => m.id === ownerId)?.name || '';
      const displayName = formatName(h.originalName || h.ticker || 'Asset');
      const accountBucket = normalizeAccountBucket(h);
      const weightPct = totalAllINR > 0 ? (valINR / totalAllINR) * 100 : 0;

      return {
        ...h,
        qty,
        price,
        valINR,
        ownerId,
        ownerName,
        displayName,
        accountBucket,
        weightPct
      };
    });
  }, [holdings, safeFx, members, formatName]);

  const totalPortfolioINR = useMemo(
    () => enriched.reduce((s, h) => s + h.valINR, 0),
    [enriched]
  );

  // Build account chips: standard accounts + any custom account buckets present in data, active ones prioritized
  const accountOptions = useMemo(() => {
    const counts = new Map<string, number>();
    enriched.forEach((h) => {
      counts.set(h.accountBucket, (counts.get(h.accountBucket) || 0) + 1);
    });

    const map = new Map<string, { id: string; label: string; count: number }>();
    STANDARD_ACCOUNTS.forEach((acc) => {
      map.set(acc.id, { id: acc.id, label: acc.label, count: counts.get(acc.id) || 0 });
    });
    counts.forEach((cnt, bucket) => {
      if (!map.has(bucket)) {
        map.set(bucket, { id: bucket, label: bucket, count: cnt });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.count > 0 && b.count === 0) return -1;
      if (a.count === 0 && b.count > 0) return 1;
      return b.count - a.count;
    });
  }, [enriched]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = enriched.filter((h) => {
      // 1. Member filter
      if (memberFilter !== 'all' && h.ownerId !== memberFilter) return false;

      // 2. Asset & Region filter
      const isDebt = h.assetClass === 'Debt';
      const isEquityLike = h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund';
      const isINR = h.currency === 'INR';
      const isUSD = h.currency === 'USD';

      if (assetFilter === 'equity' && !isEquityLike) return false;
      if (assetFilter === 'debt' && !isDebt) return false;
      if (assetFilter === 'indian' && !isINR) return false;
      if (assetFilter === 'foreign' && !isUSD) return false;
      if (assetFilter === 'indianEquity' && !(isEquityLike && isINR)) return false;
      if (assetFilter === 'foreignEquity' && !(isEquityLike && isUSD)) return false;
      if (assetFilter === 'mutualFund' && h.assetClass !== 'Mutual Fund') return false;

      // 3. Account / Broker filter
      if (accountFilter !== 'all' && h.accountBucket !== accountFilter) return false;

      // 4. Text search
      if (q) {
        const hay = `${h.displayName} ${h.originalName || ''} ${h.ticker || ''} ${h.provider || ''} ${h.accountBucket} ${h.ownerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case 'valAsc':
          return a.valINR - b.valINR;
        case 'weightDesc':
          return b.weightPct - a.weightPct;
        case 'nameAsc':
          return a.displayName.localeCompare(b.displayName);
        case 'priceDesc':
          return b.price - a.price;
        case 'unitsDesc':
          return b.qty - a.qty;
        case 'valDesc':
        default:
          return b.valINR - a.valINR;
      }
    });

    return list;
  }, [enriched, memberFilter, assetFilter, accountFilter, searchQuery, sortBy]);

  const filteredTotalINR = useMemo(
    () => filteredAndSorted.reduce((s, h) => s + h.valINR, 0),
    [filteredAndSorted]
  );

  const hasActiveFilters =
    assetFilter !== 'all' ||
    accountFilter !== 'all' ||
    memberFilter !== 'all' ||
    searchQuery.trim().length > 0;

  const resetAllFilters = () => {
    setAssetFilter('all');
    setAccountFilter('all');
    setMemberFilter('all');
    setSearchQuery('');
    setSortBy('valDesc');
  };

  const startEdit = (h: any) => {
    setEditingId(h.id);
    setEditQty(String(h.qty));
    setEditPrice(String(h.price));
    setDeletingId(null);
  };

  const commitEdit = async (id: string) => {
    if (!onUpdateHolding) return;
    const nextQty = parseFloat(editQty);
    const nextPrice = parseFloat(editPrice);
    if (isNaN(nextQty) || nextQty < 0) {
      setEditingId(null);
      return;
    }
    setIsBusy(true);
    try {
      await onUpdateHolding(id, nextQty, isNaN(nextPrice) ? undefined : nextPrice);
      setEditingId(null);
    } finally {
      setIsBusy(false);
    }
  };

  const commitDelete = async (id: string) => {
    if (!onDeleteHolding) return;
    setIsBusy(true);
    try {
      await onDeleteHolding(id);
      setDeletingId(null);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header Row */}
      {!compactHeader && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base md:text-lg font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-400 font-medium">
              Filter by Equity/Debt, India/Foreign, or account (INDmoney, Schwab, E*TRADE, CAMS, Zerodha)
            </p>
          </div>
          {onAddClick && (
            <button
              type="button"
              onClick={onAddClick}
              className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
            >
              <Plus size={14} /> Add Holding
            </button>
          )}
        </div>
      )}

      {/* Search + Member + Sort Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            aria-label="Search holdings by name, ticker or broker"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stock, mutual fund, ticker or broker..."
            className="w-full pl-8 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-indigo-400 outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear holdings search"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {showMemberFilter && members.length > 1 && (
            <select
              aria-label="Filter holdings by family member"
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
            >
              <option value="all">All Members</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          <div className="relative flex items-center flex-1 sm:flex-initial">
            <ArrowUpDown size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
            <select
              aria-label="Sort holdings"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as HoldingSortKey)}
              className="w-full sm:w-auto pl-7 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
            >
              <option value="valDesc">Sort: Value (High → Low)</option>
              <option value="valAsc">Sort: Value (Low → High)</option>
              <option value="weightDesc">Sort: Portfolio %</option>
              <option value="nameAsc">Sort: Name (A → Z)</option>
              <option value="priceDesc">Sort: Price / NAV</option>
              <option value="unitsDesc">Sort: Units / Qty</option>
            </select>
          </div>
        </div>
      </div>

      {/* Filter Pills Block (Clean 2-row horizontal scroll on mobile, zero clutter) */}
      <div className="space-y-2">
        {/* Row 1: Asset Class & Geography */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
            <SlidersHorizontal size={11} /> Type:
          </span>
          {(
            [
              { id: 'all', label: 'All Assets' },
              { id: 'equity', label: 'Equity' },
              { id: 'debt', label: 'Debt' },
              { id: 'indian', label: 'Indian (INR)' },
              { id: 'foreign', label: 'Foreign (USD)' },
              { id: 'indianEquity', label: 'Indian Eq' },
              { id: 'foreignEquity', label: 'Foreign Eq' },
              { id: 'mutualFund', label: 'Mutual Funds' }
            ] as { id: AssetRegionFilter; label: string }[]
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setAssetFilter(pill.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 transition-all ${
                assetFilter === pill.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Row 2: Account / Broker Platform */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 mr-1">
            Account:
          </span>
          <button
            type="button"
            onClick={() => setAccountFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 transition-all ${
              accountFilter === 'all'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            All Accounts ({enriched.length})
          </button>
          {accountOptions.map((acc) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => setAccountFilter(acc.id === accountFilter ? 'all' : acc.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1 ${
                accountFilter === acc.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : acc.count > 0
                  ? 'bg-indigo-50/70 text-indigo-900 border border-indigo-100 hover:bg-indigo-100/70'
                  : 'bg-slate-50 text-slate-400 border border-slate-100 hover:text-slate-600'
              }`}
            >
              <span>{acc.label}</span>
              {acc.count > 0 && (
                <span
                  className={`text-[9px] font-black px-1 py-0.2 rounded ${
                    accountFilter === acc.id ? 'bg-white/20 text-white' : 'bg-white text-indigo-600'
                  }`}
                >
                  {acc.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Filtered Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold text-slate-700">
            Showing <span className="text-indigo-600 font-black">{filteredAndSorted.length}</span> of {enriched.length} holdings
          </span>
          <span className="text-slate-300">•</span>
          <span className="font-bold text-slate-800">
            Filtered Total: <span className="font-black text-slate-900">{formatCompactINR(filteredTotalINR)}</span>{' '}
            <span className="text-slate-400 font-medium">
              ({formatCompactUSD(filteredTotalINR / safeFx)}
              {totalPortfolioINR > 0 ? ` • ${((filteredTotalINR / totalPortfolioINR) * 100).toFixed(1)}%` : ''})
            </span>
          </span>
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAllFilters}
            className="text-[11px] font-black text-rose-600 hover:underline shrink-0"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Empty State */}
      {filteredAndSorted.length === 0 ? (
        <div className="py-10 px-4 text-center bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
          <p className="text-sm font-bold text-slate-700">
            {enriched.length === 0 ? 'No holdings added yet' : 'No holdings match the active filters'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {enriched.length === 0
              ? 'Import a PDF, XLSX, or CSV statement or add a stock/mutual fund.'
              : 'Try switching account or asset filters, or click Reset Filters.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="mt-3 px-3.5 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold"
            >
              Show All Holdings
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile Cards (< 640px) */}
          <div className="sm:hidden space-y-2.5">
            {filteredAndSorted.map((h) => (
              <div key={h.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 text-sm leading-snug">{h.displayName}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] font-bold">
                      <span className="font-mono text-slate-500">{h.ticker}</span>
                      <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 uppercase text-[9px]">
                        {h.assetClass}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 uppercase text-[9px]">
                        {h.accountBucket}
                      </span>
                      {showMemberFilter && h.ownerName && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px]">
                          {h.ownerName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-black text-slate-900 tabular-nums">
                      ₹{h.valINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">
                      {h.qty.toLocaleString('en-IN', { maximumFractionDigits: 3 })} @ {h.currency}{' '}
                      {h.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {(onUpdateHolding || onDeleteHolding) && (
                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-400">
                      {h.weightPct.toFixed(1)}% of portfolio
                    </span>
                    {editingId === h.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          aria-label="Edit units"
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          className="w-20 px-2 py-1 text-xs font-mono bg-white border border-indigo-300 rounded-lg text-right"
                        />
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => commitEdit(h.id)}
                          className="p-1.5 bg-emerald-600 text-white rounded-lg"
                          aria-label="Save holding edit"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1.5 bg-slate-200 text-slate-600 rounded-lg"
                          aria-label="Cancel holding edit"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : deletingId === h.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => commitDelete(h.id)}
                          className="px-2.5 py-1 bg-rose-600 text-white text-[10px] font-black rounded-lg"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="px-2 py-1 bg-slate-200 text-slate-600 text-[10px] font-bold rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        {onUpdateHolding && (
                          <button
                            type="button"
                            aria-label={`Edit ${h.displayName}`}
                            onClick={() => startEdit(h)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {onDeleteHolding && (
                          <button
                            type="button"
                            aria-label={`Delete ${h.displayName}`}
                            onClick={() => setDeletingId(h.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg"
                          >
                            <Trash size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Tablet & Desktop Table (>= 640px) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-black text-slate-400 uppercase tracking-wider">
                  <th className="pb-3">Asset & Account</th>
                  {showMemberFilter && members.length > 1 && <th className="pb-3">Member</th>}
                  <th className="pb-3 text-right">Units</th>
                  <th className="pb-3 text-right">Price / NAV</th>
                  <th className="pb-3 text-right">Value (INR)</th>
                  <th className="pb-3 text-right">Share</th>
                  {(onUpdateHolding || onDeleteHolding) && <th className="pb-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredAndSorted.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-800 text-sm" title={h.originalName || h.ticker}>
                          {h.displayName}
                        </span>
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent((h.originalName || h.ticker) + ' price')}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Look up ${h.displayName} price on Google`}
                          className="p-1 text-slate-400 hover:text-indigo-600 rounded-lg"
                        >
                          <Globe size={13} />
                        </a>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <span className="font-mono text-slate-500">{h.ticker}</span>
                        <span>•</span>
                        <span>{h.assetClass}</span>
                        <span>•</span>
                        <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[9px] font-black">
                          {h.accountBucket}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                            h.currency === 'USD'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-orange-50 text-orange-700'
                          }`}
                        >
                          {h.currency === 'USD' ? 'FOREIGN' : 'INDIA'}
                        </span>
                        {h.ticker && h.ticker !== 'MANUAL' && h.price > 0 && (
                          <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded flex items-center gap-1 text-[9px] font-black">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            LIVE
                          </span>
                        )}
                      </div>
                    </td>

                    {showMemberFilter && members.length > 1 && (
                      <td className="py-3.5 text-xs font-bold text-slate-600 whitespace-nowrap">
                        {h.ownerName || '—'}
                      </td>
                    )}

                    <td className="py-3.5 text-right text-sm font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {editingId === h.id ? (
                        <input
                          type="number"
                          aria-label="Edit units"
                          autoFocus
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(h.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-24 px-2 py-1 text-right text-xs font-mono bg-indigo-50 border border-indigo-200 rounded-lg"
                        />
                      ) : (
                        h.qty.toLocaleString('en-IN', { maximumFractionDigits: 4 })
                      )}
                    </td>

                    <td className="py-3.5 text-right text-sm font-mono tabular-nums whitespace-nowrap">
                      {editingId === h.id ? (
                        <input
                          type="number"
                          aria-label="Edit unit price"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(h.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-24 px-2 py-1 text-right text-xs font-mono bg-indigo-50 border border-indigo-200 rounded-lg"
                        />
                      ) : (
                        <>
                          <span className="text-slate-400 text-xs mr-1">{h.currency === 'USD' ? '$' : '₹'}</span>
                          <span className="font-semibold text-slate-700">
                            {h.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </span>
                        </>
                      )}
                    </td>

                    <td className="py-3.5 text-right tabular-nums whitespace-nowrap">
                      <div className="text-sm font-black text-slate-900">
                        ₹{h.valINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </div>
                      {h.currency === 'USD' && (
                        <div className="text-[10px] font-mono text-slate-400">
                          ${(h.qty * h.price).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 text-right text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap">
                      {h.weightPct.toFixed(1)}%
                    </td>

                    {(onUpdateHolding || onDeleteHolding) && (
                      <td className="py-3.5 text-right whitespace-nowrap">
                        {editingId === h.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => commitEdit(h.id)}
                              aria-label="Save edit"
                              className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              aria-label="Cancel edit"
                              className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : deletingId === h.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => commitDelete(h.id)}
                              className="px-2.5 py-1 bg-rose-600 text-white text-[10px] font-black rounded-lg hover:bg-rose-700"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingId(null)}
                              className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-lg"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {onUpdateHolding && (
                              <button
                                type="button"
                                aria-label={`Edit ${h.displayName}`}
                                onClick={() => startEdit(h)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {onDeleteHolding && (
                              <button
                                type="button"
                                aria-label={`Delete ${h.displayName}`}
                                onClick={() => setDeletingId(h.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              >
                                <Trash size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
