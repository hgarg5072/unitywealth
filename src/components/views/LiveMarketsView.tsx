import React, { useMemo, useState } from 'react';
import { Globe, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { Holding } from '../../types';
import { shortenAssetName } from '../../lib/formatAssetName';
import { getHoldingOwnerId } from '../../shared/formatters';
import { MarketPulseRibbon } from '../MarketPulseRibbon';
import { AddTickerRow } from '../AddTickerRow';

export interface LiveMarketsViewProps {
  holdings: Holding[];
  members: any[];
  householdId?: string;
}

export default function LiveMarketsView({
  holdings,
  members,
  householdId
}: LiveMarketsViewProps) {
  const [searchedAssets, setSearchedAssets] = useState<any[]>([]);

  // Pre-build O(1) member lookup map
  const memberById = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of members) {
      if (m?.id) map.set(m.id, m);
    }
    return map;
  }, [members]);

  // Single O(H) pass to group unique assets and accumulate owner IDs (replacing O(H^2) + O(U*M*H) nested scans)
  const groupedAssets = useMemo(() => {
    const byKey = new Map<string, { holding: Holding; ownerIds: Set<string> }>();
    for (const h of holdings) {
      const key = `${h.ticker || ''}|${h.originalName || ''}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { holding: h, ownerIds: new Set<string>() };
        byKey.set(key, entry);
      }
      const ownerId = getHoldingOwnerId(h);
      if (ownerId) entry.ownerIds.add(ownerId);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      (a.holding.assetClass || '').localeCompare(b.holding.assetClass || '')
    );
  }, [holdings]);

  const handleAssetSelect = async (asset: any) => {
    if (!searchedAssets.some((a) => a.symbol === asset.symbol)) {
      setSearchedAssets((prev) => [asset, ...prev]);

      try {
        const hParam = householdId ? `?h=${encodeURIComponent(householdId)}` : '';
        const res = await fetch(`/api/quote/${encodeURIComponent(asset.symbol)}${hParam}`);
        if (res.ok) {
          const data = await res.json();
          setSearchedAssets((prev) =>
            prev.map((a) => (a.symbol === asset.symbol ? { ...a, currentPrice: data.price } : a))
          );
        }
      } catch (e) {
        console.error('Fresh price fetch failed', e);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase italic">
            Live Markets
          </h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
            Real-time asset tracking &amp; current valuations
          </p>
        </div>
        <div className="inline-flex self-start sm:self-auto items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-black text-emerald-700 uppercase tracking-tighter">
            Market Systems Active
          </span>
        </div>
      </div>

      <MarketPulseRibbon />

      <div className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-slate-100">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-1">
          Check Live Price for Any Asset
        </label>
        <div className="max-w-xl">
          <AddTickerRow onAdd={handleAssetSelect} householdId={householdId} />
        </div>
      </div>

      {searchedAssets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              Market Watchlist
            </h3>
            <button
              onClick={() => setSearchedAssets([])}
              className="text-[9px] font-black text-rose-500 uppercase hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {searchedAssets.map((asset) => (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                key={asset.symbol}
                className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 relative overflow-hidden group"
              >
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-indigo-400 font-bold">
                      {asset.symbol}
                    </span>
                    <span
                      className="text-xs font-bold leading-tight line-clamp-2"
                      title={asset.shortname}
                    >
                      {shortenAssetName(asset.shortname, asset.symbol)}
                    </span>
                  </div>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-emerald-500/20">
                    LIVE
                  </span>
                </div>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-sm opacity-40 font-mono">
                    {asset.isIndia ? '₹' : '$'}
                  </span>
                  <span className="text-2xl font-black">
                    {asset.currentPrice?.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    }) || '---'}
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 font-bold uppercase mt-1">
                  {asset.exchDisp} • {asset.typeDisp}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-100">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 px-1">
          Your Portfolio Tracking
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groupedAssets.map(({ holding: h, ownerIds }) => {
            const owners = Array.from(ownerIds)
              .map((id) => memberById.get(id))
              .filter(Boolean);

            return (
              <div
                key={h.id}
                className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:border-emerald-200 transition-all group relative overflow-hidden"
              >
                <div className="flex justify-between items-start gap-3 mb-6">
                  <div className="flex flex-col min-w-0">
                    <h3
                      className="font-bold text-slate-800 text-sm leading-tight line-clamp-2"
                      title={h.originalName || h.ticker}
                    >
                      {shortenAssetName(h.originalName || h.ticker, h.ticker)}
                    </h3>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
                        {h.ticker}
                      </span>
                      <span className="text-[9px] text-indigo-500 font-black uppercase tracking-widest bg-indigo-50 px-1.5 py-0.5 rounded">
                        {h.assetClass}
                      </span>
                      {h.ticker &&
                        h.ticker !== 'MANUAL' &&
                        h.source !== 'Manual' &&
                        h.currentPrice > 0 && (
                          <span className="inline-flex items-center gap-1 text-[8px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            LIVE
                          </span>
                        )}
                    </div>
                  </div>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(
                      (h.originalName || h.ticker) + ' price'
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Search ${h.originalName || h.ticker} price on Google`}
                    className="p-2 bg-slate-50 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl transition-all shrink-0"
                  >
                    <Globe size={14} />
                  </a>
                </div>

                <div className="pt-6 border-t border-slate-50 flex items-end justify-between mt-auto">
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                      Current NAV/Price
                    </span>
                    <div className="text-2xl font-black text-slate-800 flex items-baseline gap-1">
                      <span className="text-sm opacity-40 font-mono">
                        {h.currency === 'INR' ? '₹' : '$'}
                      </span>
                      {h.currentPrice.toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                      Owners
                    </span>
                    <div className="flex -space-x-2 justify-end">
                      {owners.map((m: any) => (
                        <div
                          key={m.id}
                          className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm ring-1 ring-slate-100"
                          style={{ backgroundColor: m.color || '#6366f1' }}
                          title={m.name}
                        >
                          {m.name.charAt(0)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900 text-white p-5 sm:p-8 rounded-3xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-indigo-500/20 to-transparent pointer-events-none"></div>
        <div className="bg-indigo-600 p-3.5 sm:p-4 rounded-2xl shadow-xl shadow-indigo-900/50 relative z-10 shrink-0 self-start sm:self-auto">
          <Zap size={28} />
        </div>
        <div className="relative z-10">
          <h4 className="text-lg sm:text-xl font-black italic uppercase">
            Dashboard Intelligence: Live Core
          </h4>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
            UnityWealth&apos;s live engine connects directly to global markets. Every holding marked as{' '}
            <span className="text-emerald-400 font-bold">LIVE</span> is automatically revalued on every refresh using shared cloud quote caches for AMFI, NSE, and US Market feeds.
          </p>
        </div>
      </div>
    </div>
  );
}
