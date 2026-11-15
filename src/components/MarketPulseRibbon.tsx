import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface BenchmarkItem {
  id: string;
  label: string;
  value: number;
  changePct: number;
  prefix: string;
}

export function MarketPulseRibbon() {
  const [items, setItems] = useState<BenchmarkItem[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/market/benchmarks');
        if (res.ok && active) {
          const json = await res.json();
          if (Array.isArray(json.benchmarks)) {
            setItems(json.benchmarks);
          }
        }
      } catch {
        // silent fallback
      }
    };
    load();
    const timer = setInterval(load, 120000);
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
