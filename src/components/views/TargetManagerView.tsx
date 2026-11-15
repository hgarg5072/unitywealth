import React, { useState } from 'react';
import {
  Check,
  Download,
  FileJson,
  History,
  Mail,
  Pencil,
  RefreshCcw,
  Save,
  Trash,
  Upload,
  X
} from 'lucide-react';
import { motion } from 'motion/react';
import { HouseholdSettings, PortfolioTargets, TargetCategory } from '../../types';
import { AddTickerRow } from '../AddTickerRow';

export interface TargetFormProps {
  initialTargets: PortfolioTargets;
  initialSettings?: HouseholdSettings;
  onSave: (targets: PortfolioTargets) => void;
  onSaveSettings: (settings: { enabled: boolean; threshold: number }) => void;
  isSaving: boolean;
  householdId?: string;
  onExportBackup?: () => void;
  onImportBackup?: (data: any) => Promise<void>;
}

export default function TargetForm({
  initialTargets,
  initialSettings,
  onSave,
  onSaveSettings,
  isSaving,
  householdId,
  onExportBackup,
  onImportBackup
}: TargetFormProps) {
  const [assetEq, setAssetEq] = useState((initialTargets.assetSplit?.Equity ?? 0.7) * 100);
  const [eqIndian, setEqIndian] = useState((initialTargets.equitySplit?.Indian ?? 0.6) * 100);
  const [emailAlerts, setEmailAlerts] = useState(initialSettings?.emailAlertsEnabled ?? false);
  const [threshold, setThreshold] = useState(initialSettings?.accuracyThreshold ?? 95);

  const [foreignBreakdown, setForeignBreakdown] = useState<TargetCategory[]>(() => {
    return (initialTargets.foreignBreakdown || []).map((cat) => {
      if (!cat.tickerWeights) {
        const legacyTickers = (cat as any).tickers || [];
        if (legacyTickers.length > 0) {
          return {
            name: cat.name,
            percentage: cat.percentage,
            tickerWeights: legacyTickers.map((t: string) => ({
              ticker: t,
              weight: Math.round(100 / legacyTickers.length)
            }))
          };
        }
        return { ...cat, tickerWeights: [] };
      }
      return cat;
    });
  });

  const [newCatName, setNewCatName] = useState('');
  const [editingThemeIdx, setEditingThemeIdx] = useState<number | null>(null);
  const [themeEditName, setThemeEditName] = useState('');

  const addCategory = () => {
    if (!newCatName.trim()) return;
    setForeignBreakdown([
      ...foreignBreakdown,
      {
        name: newCatName.trim(),
        percentage: 0,
        tickerWeights: []
      }
    ]);
    setNewCatName('');
  };

  const updateCatPct = (idx: number, pct: number) => {
    const updated = [...foreignBreakdown];
    updated[idx] = { ...updated[idx], percentage: pct };
    setForeignBreakdown(updated);
  };

  const updateCatName = (idx: number, name: string) => {
    const updated = [...foreignBreakdown];
    updated[idx] = { ...updated[idx], name };
    setForeignBreakdown(updated);
  };

  const updateTickerWeight = (catIdx: number, tickerIdx: number, weight: number) => {
    const updated = [...foreignBreakdown];
    const currentWeights = updated[catIdx].tickerWeights;
    if (currentWeights) {
      const nextWeights = [...currentWeights];
      nextWeights[tickerIdx] = { ...nextWeights[tickerIdx], weight };
      updated[catIdx] = { ...updated[catIdx], tickerWeights: nextWeights };
      setForeignBreakdown(updated);
    }
  };

  const addTickerToCat = (catIdx: number, ticker: string) => {
    if (!ticker) return;
    const tickerUpper = ticker.toUpperCase();
    const updated = [...foreignBreakdown];
    const currentWeights = updated[catIdx].tickerWeights || [];
    if (currentWeights.some((tw) => tw.ticker === tickerUpper)) return;

    updated[catIdx] = {
      ...updated[catIdx],
      tickerWeights: [...currentWeights, { ticker: tickerUpper, weight: 0 }]
    };
    setForeignBreakdown(updated);
  };

  const removeTickerFromCat = (catIdx: number, tickerIdx: number) => {
    const updated = [...foreignBreakdown];
    updated[catIdx] = {
      ...updated[catIdx],
      tickerWeights: updated[catIdx].tickerWeights?.filter((_, i) => i !== tickerIdx)
    };
    setForeignBreakdown(updated);
  };

  const removeCat = (idx: number) => {
    setForeignBreakdown(foreignBreakdown.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      assetSplit: { Equity: assetEq / 100, Debt: (100 - assetEq) / 100 },
      equitySplit: { Indian: eqIndian / 100, Foreign: (100 - eqIndian) / 100 },
      foreignBreakdown
    });
    onSaveSettings({ enabled: emailAlerts, threshold });
  };

  const totalForeignPct = foreignBreakdown.reduce((s, c) => s + c.percentage, 0);

  return (
    <div className="bg-white p-4 md:p-10 rounded-2xl md:rounded-3xl border border-slate-200 shadow-xl shadow-slate-100">
      <div className="mb-6 md:mb-10">
        <h3 className="text-lg md:text-2xl font-bold text-slate-800">
          Portfolio Target Architecture
        </h3>
        <p className="text-slate-500 text-[10px] md:text-sm mt-1">
          Define your family&apos;s global allocation strategy across assets and regions.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-12 md:space-y-16">
        {/* Tier 1: Asset Split */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-indigo-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
              1
            </div>
            <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">
              Main Asset Allocation
            </h4>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex flex-col sm:flex-row sm:justify-between mb-3 gap-1">
                <span className="text-sm font-bold text-slate-600">Equities vs Debt</span>
                <span className="text-sm font-black text-indigo-600">
                  {assetEq}% Equity / {100 - assetEq}% Debt
                </span>
              </div>
              <input
                type="range"
                aria-label="Equity vs Debt Target Percentage"
                min="0"
                max="100"
                value={assetEq}
                onChange={(e) => setAssetEq(Number(e.target.value))}
                className="w-full h-3 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">
                  Target Equity
                </p>
                <p className="text-xl font-bold text-indigo-700">{assetEq}%</p>
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">
                  Target Debt
                </p>
                <p className="text-xl font-bold text-emerald-700">{100 - assetEq}%</p>
              </div>
            </div>
          </div>
        </section>

        {/* Tier 2: Equity Split */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-orange-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
              2
            </div>
            <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">
              Geographic Equity Split{' '}
              <span className="text-[10px] md:text-xs text-slate-400 font-normal block sm:inline sm:ml-2">
                (% of Equities)
              </span>
            </h4>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex flex-col sm:flex-row sm:justify-between mb-3 gap-1">
                <span className="text-sm font-bold text-slate-600">Indian vs Foreign (US)</span>
                <span className="text-sm font-black text-orange-600">
                  {eqIndian}% Indian / {100 - eqIndian}% Foreign
                </span>
              </div>
              <input
                type="range"
                aria-label="Indian vs Foreign Equity Target Percentage"
                min="0"
                max="100"
                value={eqIndian}
                onChange={(e) => setEqIndian(Number(e.target.value))}
                className="w-full h-3 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
            </div>
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full shrink-0"></div>
                <span className="text-[10px] md:text-xs font-bold text-slate-500">
                  IND Equity Weight: {((assetEq * eqIndian) / 100).toFixed(1)}% of total
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full shrink-0"></div>
                <span className="text-[10px] md:text-xs font-bold text-slate-500">
                  Foreign Equity Weight: {((assetEq * (100 - eqIndian)) / 100).toFixed(1)}% of total
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Tier 3: Sectors (Foreign) */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-slate-200 rounded-full"></div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
                3
              </div>
              <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">
                Sectors / Themes Breakdown{' '}
                <span className="text-[10px] md:text-xs text-slate-400 font-normal block sm:inline sm:ml-2">
                  (% of Foreign Equity)
                </span>
              </h4>
            </div>
            <div
              className={`px-4 py-1.5 rounded-xl text-xs font-black border flex items-center gap-2 transition-all shadow-sm ${
                totalForeignPct === 100
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700 animate-pulse'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  totalForeignPct === 100 ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              ></div>
              Sum: {totalForeignPct.toFixed(1)}% / 100%
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 mb-6 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <input
              aria-label="New Sector or Theme Name"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Add theme (e.g. AI & SaaS)"
              className="w-full sm:flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 bg-white"
            />
            <button
              type="button"
              onClick={addCategory}
              className="w-full sm:w-auto bg-slate-900 text-white px-6 py-2 rounded-lg hover:bg-slate-800 transition-all font-bold text-xs"
            >
              ADD THEME
            </button>
          </div>

          <div className="space-y-4">
            {foreignBreakdown.map((cat, idx) => {
              const catTotalBase =
                ((assetEq * (100 - eqIndian)) / 10000) * (cat.percentage / 100) * 100;
              const tickerSum = cat.tickerWeights?.reduce((s, tw) => s + tw.weight, 0) || 0;

              return (
                <div key={idx} className="bg-slate-50 p-6 rounded-2xl border border-slate-200 group">
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex-1">
                      {editingThemeIdx === idx ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            aria-label={`Edit theme name ${cat.name}`}
                            value={themeEditName}
                            onChange={(e) => setThemeEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateCatName(idx, themeEditName);
                                setEditingThemeIdx(null);
                              }
                              if (e.key === 'Escape') setEditingThemeIdx(null);
                            }}
                            className="bg-white border border-indigo-200 rounded px-2 py-1 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          />
                          <button
                            type="button"
                            aria-label="Save theme name"
                            onClick={() => {
                              updateCatName(idx, themeEditName);
                              setEditingThemeIdx(null);
                            }}
                            className="text-emerald-500 hover:text-emerald-600"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label="Cancel editing theme name"
                            onClick={() => setEditingThemeIdx(null)}
                            className="text-slate-400 hover:text-rose-500"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <h5 className="font-bold text-slate-800">{cat.name}</h5>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingThemeIdx(idx);
                                setThemeEditName(cat.name);
                              }}
                              className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                              title="Edit theme name"
                              aria-label={`Edit ${cat.name}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeCat(idx)}
                              className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                              title="Remove theme"
                              aria-label={`Remove ${cat.name}`}
                            >
                              <Trash size={12} />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 space-y-2">
                        {cat.tickerWeights?.map((tw, tIdx) => (
                          <div
                            key={`${tw.ticker}-${tIdx}`}
                            className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white p-3 rounded-xl border border-slate-100"
                          >
                            <div className="flex items-center justify-between sm:justify-start gap-3">
                              <span className="w-16 font-mono text-[10px] font-black text-slate-400 uppercase shrink-0">
                                {tw.ticker}
                              </span>
                              <div className="sm:hidden flex items-center gap-2">
                                <span className="text-[9px] text-indigo-400 font-bold">
                                  ({((catTotalBase * tw.weight) / 100).toFixed(2)}% total)
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${tw.ticker}`}
                                  onClick={() => removeTickerFromCat(idx, tIdx)}
                                  className="text-slate-300 hover:text-rose-500 transition-colors"
                                >
                                  <Trash size={12} />
                                </button>
                              </div>
                            </div>

                            <div className="flex-1 flex items-center gap-3">
                              <input
                                type="range"
                                aria-label={`${tw.ticker} weight slider`}
                                min="0"
                                max="100"
                                value={tw.weight}
                                onChange={(e) => updateTickerWeight(idx, tIdx, Number(e.target.value))}
                                className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                              />
                              <div className="flex items-center gap-2 shrink-0">
                                <input
                                  type="number"
                                  aria-label={`${tw.ticker} weight percentage`}
                                  value={tw.weight}
                                  onChange={(e) => updateTickerWeight(idx, tIdx, Number(e.target.value))}
                                  className="w-12 text-center text-[10px] font-black text-slate-800 bg-white border border-slate-200 rounded px-1 py-0.5"
                                />
                                <div className="hidden sm:block w-16 text-right">
                                  <span className="text-[9px] text-indigo-400 font-bold">
                                    ({((catTotalBase * tw.weight) / 100).toFixed(2)}% total)
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                aria-label={`Remove ${tw.ticker}`}
                                onClick={() => removeTickerFromCat(idx, tIdx)}
                                className="hidden sm:block text-slate-300 hover:text-rose-500 transition-colors"
                              >
                                <Trash size={12} />
                              </button>
                            </div>
                          </div>
                        ))}

                        <div className="flex gap-2 items-center mt-2">
                          <AddTickerRow
                            onAdd={(res) => addTickerToCat(idx, res.symbol)}
                            householdId={householdId}
                            foreignOnly
                          />
                          {tickerSum !== 100 && cat.tickerWeights && cat.tickerWeights.length > 0 && (
                            <span className="text-[9px] font-black text-rose-500 uppercase animate-pulse">
                              Current Sum: {tickerSum.toFixed(1)}% (Must be 100%)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete theme ${cat.name}`}
                      onClick={() => removeCat(idx)}
                      className="text-slate-400 hover:text-rose-500 transition-colors ml-4 hidden md:block"
                    >
                      <Trash size={16} />
                    </button>
                  </div>

                  <div className="border-t border-slate-200/50 pt-4 mt-2">
                    <div className="flex justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase">
                        Theme Weight
                      </span>
                      <span className="text-[10px] font-black text-slate-800">
                        {cat.percentage}% of Foreign Equity
                      </span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                      <input
                        type="range"
                        aria-label={`${cat.name} theme weight slider`}
                        min="0"
                        max="100"
                        value={cat.percentage}
                        onChange={(e) => updateCatPct(idx, Number(e.target.value))}
                        className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
                      />
                      <div className="flex items-center gap-3 w-full sm:w-40 justify-between sm:justify-end">
                        <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2 py-1 shrink-0">
                          <input
                            type="number"
                            aria-label={`${cat.name} theme weight percentage`}
                            value={cat.percentage}
                            onChange={(e) => updateCatPct(idx, Number(e.target.value))}
                            className="w-12 text-sm font-black text-slate-800 focus:outline-none text-right"
                          />
                          <span className="text-xs font-bold text-slate-400 ml-0.5">%</span>
                        </div>
                        <div className="w-16 text-right shrink-0">
                          <span className="text-[10px] text-indigo-500 font-bold">
                            ({catTotalBase.toFixed(1)}% total)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="bg-white border-2 border-dashed border-slate-200 p-6 rounded-2xl">
              <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                Add Sector / Theme
              </h5>
              <div className="flex flex-col md:flex-row gap-4">
                <input
                  aria-label="Sector or Theme Name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g. AI Winners or Semiconductors"
                  className="flex-1 px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/10"
                />
                <button
                  type="button"
                  onClick={addCategory}
                  className="px-6 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors shadow-lg shadow-slate-100"
                >
                  ADD THEME
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Tier 4: Notifications */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-rose-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
              4
            </div>
            <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">
              Intelligence &amp; Automated Alerts
            </h4>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h5 className="font-bold text-slate-800 flex items-center gap-2">
                    <Mail size={16} className="text-rose-500" />
                    Email Rebalance Alerts
                  </h5>
                  <p className="text-xs text-slate-500">
                    Receive a hierarchical rebalance &amp; Zero-Sell SIP plan when alignment drops.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Toggle Email Rebalance Alerts"
                  onClick={() => setEmailAlerts(!emailAlerts)}
                  className={`w-12 h-6 rounded-full transition-all relative shrink-0 ${
                    emailAlerts ? 'bg-rose-500' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                      emailAlerts ? 'left-7' : 'left-1'
                    }`}
                  ></div>
                </button>
              </div>

              {emailAlerts && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="pt-4 border-t border-rose-100"
                >
                  <div className="flex justify-between mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <span>Accuracy Threshold </span>
                    <span className="text-rose-600">Lower than {threshold}%</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Accuracy Alert Threshold"
                    min="80"
                    max="99"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full h-2 bg-white rounded-lg appearance-none cursor-pointer accent-rose-500 mb-2"
                  />
                  <p className="text-[10px] text-slate-400">
                    UnityWealth will email you once every 24h if your Portfolio Alignment score falls below this number.
                  </p>
                </motion.div>
              )}
            </div>
          </div>
        </section>

        {/* Tier 5: Data Resilience */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-indigo-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
              5
            </div>
            <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">
              Data Persistence &amp; Backups
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col justify-between">
              <div>
                <h5 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                  <Download size={16} className="text-indigo-500" />
                  Offline Portfolio Backup
                </h5>
                <p className="text-xs text-slate-500 mb-4">
                  Export your household&apos;s live holdings, targets, real estate schedule, and snapshots to a portable JSON file.
                </p>
              </div>
              <button
                type="button"
                onClick={onExportBackup}
                className="w-full py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
              >
                <FileJson size={14} /> EXPORT PORTFOLIO (.JSON)
              </button>
            </div>

            <div className="p-6 bg-amber-50 border border-amber-100 rounded-2xl flex flex-col justify-between">
              <div>
                <h5 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                  <Upload size={16} className="text-amber-500" />
                  Restore Portfolio Snapshot
                </h5>
                <p className="text-xs text-slate-500 mb-4">
                  Restore holdings, target weights, and real estate records from a previously exported UnityWealth JSON backup.
                </p>
              </div>
              <label className="w-full py-2.5 bg-white border border-amber-200 text-amber-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-50 cursor-pointer transition-colors">
                <Upload size={14} /> IMPORT FROM FILE
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !onImportBackup) return;
                    if (
                      !confirm(
                        'Restore this backup? Current holdings and target weights for this household will be replaced.'
                      )
                    ) {
                      e.target.value = '';
                      return;
                    }
                    try {
                      const text = await file.text();
                      const parsed = JSON.parse(text);
                      await onImportBackup(parsed);
                    } catch (err: any) {
                      alert('Restore failed: ' + (err?.message || 'Invalid JSON file'));
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="mt-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <History size={14} className="text-indigo-400" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                Cloud Dual-Database Persistence
              </span>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              Holdings sync in real time via Cloud Firestore, while monthly wealth history and real estate ledgers are persisted in PostgreSQL.
            </p>
          </div>
        </section>

        <div className="pt-8 border-t border-slate-100">
          <button
            type="submit"
            disabled={
              isSaving ||
              totalForeignPct !== 100 ||
              foreignBreakdown.some(
                (cat) =>
                  cat.tickerWeights &&
                  cat.tickerWeights.length > 0 &&
                  Math.round(cat.tickerWeights.reduce((s, tw) => s + tw.weight, 0)) !== 100
              )
            }
            className="w-full bg-indigo-600 text-white rounded-2xl py-5 font-bold flex items-center justify-center gap-3 hover:bg-indigo-700 disabled:opacity-50 disabled:grayscale transition-all shadow-xl shadow-indigo-100"
          >
            {isSaving ? (
              <RefreshCcw className="animate-spin" size={20} />
            ) : (
              <>
                <Save size={20} />
                Deploy Allocation Architecture
              </>
            )}
          </button>
          {totalForeignPct !== 100 && (
            <p className="text-center text-xs text-rose-500 font-bold mt-4 animate-pulse">
              Foreign themes must sum to exactly 100% (Current: {totalForeignPct.toFixed(1)}%).
            </p>
          )}
          {foreignBreakdown.some(
            (cat) =>
              cat.tickerWeights &&
              cat.tickerWeights.length > 0 &&
              cat.tickerWeights.reduce((s, tw) => s + tw.weight, 0) !== 100
          ) && (
            <p className="text-center text-xs text-rose-500 font-bold mt-1">
              Each theme&apos;s ticker weights must sum to exactly 100%.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
