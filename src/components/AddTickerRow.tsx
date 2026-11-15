import React, { useEffect, useRef, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { shortenAssetName } from '../lib/formatAssetName';

export interface AddTickerRowProps {
  onAdd: (res: any) => void;
  householdId?: string;
  foreignOnly?: boolean;
}

export function AddTickerRow({ onAdd, householdId, foreignOnly = false }: AddTickerRowProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length <= 1) {
      setResults([]);
      setIsOpen(false);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const hParam = householdId ? `&h=${encodeURIComponent(householdId)}` : '';
        const [tickerRes, mfRes] = await Promise.all([
          fetch(`/api/tickers/search?q=${encodeURIComponent(trimmed)}${hParam}`, {
            signal: controller.signal
          }),
          foreignOnly
            ? Promise.resolve(null)
            : fetch(`/api/mf/search?q=${encodeURIComponent(trimmed)}`, {
                signal: controller.signal
              })
        ]);
        const tickerData = tickerRes.ok ? await tickerRes.json() : [];
        const mfData = mfRes && mfRes.ok ? await mfRes.json() : [];
        const filteredTickers = foreignOnly
          ? Array.isArray(tickerData)
            ? tickerData.filter((r: any) => !r.isIndia)
            : []
          : Array.isArray(tickerData)
          ? tickerData
          : [];

        if (!controller.signal.aborted) {
          setResults([...filteredTickers, ...(Array.isArray(mfData) ? mfData : [])]);
          setIsOpen(true);
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.error('Search failed', e);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, householdId, foreignOnly]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const customTickerCandidate = query.trim().replace(/\s+etf$/i, '').trim().toUpperCase();
  const canUseCustomTicker =
    /^[A-Z0-9.-]{2,10}$/.test(customTickerCandidate) &&
    !results.some((r) => String(r.symbol || '').toUpperCase() === customTickerCandidate);

  return (
    <div className="relative" ref={searchRef}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            aria-label="Search Ticker or Mutual Fund"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim().length > 1 && setIsOpen(true)}
            placeholder={
              foreignOnly
                ? 'Search US Ticker / ETF (e.g. DRAM, SMH, NVDA)'
                : 'Search Ticker, ETF or MF (e.g. DRAM, Parag Parikh)'
            }
            className="text-[11px] bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-full sm:w-64 shadow-sm"
          />
          {isSearching && (
            <RefreshCcw size={10} className="absolute right-2.5 top-2.5 animate-spin text-slate-400" />
          )}
        </div>
      </div>

      {isOpen && (results.length > 0 || (!isSearching && canUseCustomTicker)) && (
        <div className="absolute z-50 mt-1 w-72 sm:w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
          {results.map((r) => (
            <button
              type="button"
              key={`${r.symbol}-${r.exchDisp}`}
              onClick={() => {
                onAdd(r);
                setQuery('');
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left hover:bg-slate-50 border-b border-slate-50 last:border-0 flex flex-col gap-0.5"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-slate-900">{r.symbol}</span>
                  {r.typeDisp === 'ETF' && (
                    <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1 rounded-sm font-black uppercase">
                      ETF
                    </span>
                  )}
                  {r.isIndia && (
                    <span className="text-[7px] bg-orange-50 text-orange-600 px-1 rounded-sm font-black uppercase tracking-tighter">
                      India
                    </span>
                  )}
                </div>
                <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded font-bold uppercase">
                  {r.exchDisp}
                </span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-[9px] text-slate-500 truncate font-semibold max-w-[190px]">
                  {shortenAssetName(r.shortname, r.symbol)}
                </span>
                {r.currentPrice > 0 && (
                  <div className="text-[10px] font-black text-emerald-600 tabular-nums">
                    {r.isIndia ? '₹' : '$'}
                    {r.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            </button>
          ))}
          {!isSearching && canUseCustomTicker && (
            <button
              type="button"
              onClick={() => {
                onAdd({
                  symbol: customTickerCandidate,
                  shortname: customTickerCandidate,
                  exchDisp: 'US',
                  typeDisp: 'ETF',
                  currentPrice: 0,
                  isIndia: false
                });
                setQuery('');
                setIsOpen(false);
              }}
              className="w-full px-4 py-2.5 text-left bg-slate-50 hover:bg-indigo-50 text-[10px] font-bold text-indigo-700 border-t border-slate-100"
            >
              + Use ticker &ldquo;{customTickerCandidate}&rdquo; directly
            </button>
          )}
        </div>
      )}
    </div>
  );
}
