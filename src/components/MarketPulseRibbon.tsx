import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface BenchmarkItem {
  id: string;
  label: string;
  value: number;
  changePct: number;
  prefix: string;
}

// Module-level shared cache across tab mounts so switching views never re-fetches within 90s
let sharedBenchmarkItems: BenchmarkItem[] = [];
let sharedBenchmarkTs = 0;
let inFlightBenchmarkReq: Promise<BenchmarkItem[]> | null = null;
const BENCHMARK_TTL_MS = 90 * 1000;

async function fetchBenchmarksCached(force = false): Promise<BenchmarkItem[]> {
  const now = Date.now();
  if (!force && sharedBenchmarkItems.length > 0 && now - sharedBenchmarkTs < BENCHMARK_TTL_MS) {
    return sharedBenchmarkItems;
  }
  if (inFlightBenchmarkReq) return inFlightBenchmarkReq;

  inFlightBenchmarkReq = (async () => {
    try {
      const res = await fetch('/api/market/benchmarks');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.benchmarks) && json.benchmarks.length > 0) {
          sharedBenchmarkItems = json.benchmarks;
          sharedBenchmarkTs = Date.now();
        }
      }
    } catch {
      // silent fallback to cached items
    }
    return sharedBenchmarkItems;
  })().finally(() => {
    inFlightBenchmarkReq = null;
  });

  return inFlightBenchmarkReq;
}

export function MarketPulseRibbon() {
  const [items, setItems] = useState<BenchmarkItem[]>(() => sharedBenchmarkItems);

  useEffect(() => {
    let active = true;
    const load = async (force = false) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const list = await fetchBenchmarksCached(force);
      if (active && list.length > 0) {
        setItems(list);
      }
    };
    load(false);
    const timer = setInterval(() => load(true), 120000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto no-scrollbar py-1">
      <div className="flex items-center gap-2 min-w-max">
        {items.map((b) => {
          const isUp = b.changePct >= 0;
          return (
            <div
              key={b.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200/80 rounded-xl shadow-xs text-xs shrink-0"
            >
              <span className="font-black text-[10px] text-slate-400 uppercase tracking-wider">{b.label}</span>
              <span className="font-mono font-bold text-slate-800">
                {b.prefix}
                {b.value.toLocaleString('en-IN', {
                  minimumFractionDigits: b.id === 'usdinr' ? 2 : 0,
                  maximumFractionDigits: 2
                })}
              </span>
              {b.changePct !== 0 && (
                <span
                  className={`inline-flex items-center font-bold text-[10px] px-1.5 py-0.5 rounded-md ${
                    isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {isUp ? '+' : ''}
                  {b.changePct.toFixed(2)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
