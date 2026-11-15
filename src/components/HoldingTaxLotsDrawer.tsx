import React, { useMemo, useState } from 'react';
import { Calendar, Check, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { TaxAcquisitionType, TaxLot, TaxProfileSettings } from '../types';
import { formatCompactINR } from '../shared/formatters';
import {
  classifyHoldingTaxTreatment,
  evaluateTaxLot,
  getEffectiveIndiaTaxRates
} from '../shared/taxAndRsuMath';

interface HoldingTaxLotsDrawerProps {
  holding: any;
  householdId: string;
  lots: TaxLot[];
  allTaxLots: TaxLot[];
  taxProfile?: Partial<TaxProfileSettings>;
  fxRate: number;
  onSaveTaxLots: (nextLots: TaxLot[]) => Promise<void>;
  onClose: () => void;
}

export const HoldingTaxLotsDrawer: React.FC<HoldingTaxLotsDrawerProps> = ({
  holding,
  householdId,
  lots,
  allTaxLots,
  taxProfile,
  fxRate,
  onSaveTaxLots,
  onClose
}) => {
  const rates = useMemo(() => getEffectiveIndiaTaxRates(taxProfile), [taxProfile]);
  const taxRule = useMemo(() => classifyHoldingTaxTreatment(holding), [holding]);

  const totalHoldingQty = Math.max(0, Number(holding.qty ?? holding.quantity) || 0);
  const datedQty = useMemo(
    () => lots.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
    [lots]
  );
  const unassignedQty = Math.max(0, Number((totalHoldingQty - datedQty).toFixed(4)));

  const defaultType: TaxAcquisitionType =
    holding.accountBucket === 'E*TRADE'
      ? 'RSU Vest'
      : holding.assetClass === 'Mutual Fund'
      ? 'SIP'
      : 'Market Buy';

  const todayIso = new Date().toISOString().slice(0, 10);
  const [acqDate, setAcqDate] = useState<string>(todayIso);
  const [qtyInput, setQtyInput] = useState<string>(
    unassignedQty > 0 ? String(unassignedQty) : String(totalHoldingQty || 1)
  );
  const [costInput, setCostInput] = useState<string>(
    holding.price > 0 ? String(Number(holding.price.toFixed(2))) : ''
  );
  const [fxInput, setFxInput] = useState<string>(
    holding.currency === 'USD' ? String(Number(fxRate.toFixed(2))) : ''
  );
  const [acqType, setAcqType] = useState<TaxAcquisitionType>(defaultType);
  const [saving, setSaving] = useState(false);

  const evaluated = useMemo(
    () =>
      lots.map((lot) =>
        evaluateTaxLot({
          lot,
          holding: {
            ...holding,
            valINR: holding.valINR || 0,
            valUSD: (holding.valINR || 0) / fxRate,
            isPlaceholder: false
          },
          ownerName: holding.ownerName || 'Member',
          fxRate,
          rates
        })
      ),
    [lots, holding, fxRate, rates]
  );

  const handleAddTranche = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(qtyInput);
    const cost = Number(costInput);
    if (!acqDate || !(qty > 0) || isNaN(cost) || cost < 0) return;
    setSaving(true);
    try {
      const newLot: TaxLot = {
        id: 'lot_' + Math.random().toString(36).slice(2, 10),
        householdId,
        holdingId: holding.id,
        ownerId: holding.ownerId || holding.userId || '',
        ticker: holding.ticker,
        provider: holding.provider || holding.accountBucket,
        acquiredDate: acqDate,
        quantity: qty,
        costPerUnit: cost,
        currency: holding.currency === 'USD' ? 'USD' : 'INR',
        fxRateAtBuy:
          holding.currency === 'USD' && Number(fxInput) > 0 ? Number(fxInput) : undefined,
        acquisitionType: acqType,
        updatedAt: Date.now()
      };
      const nextAll = [...allTaxLots, newLot];
      await onSaveTaxLots(nextAll);
      const nextRem = Math.max(0, Number((unassignedQty - qty).toFixed(4)));
      setQtyInput(nextRem > 0 ? String(nextRem) : '');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickPreset = async (preset: 'ltcg_all' | 'fresh_rsu') => {
    const targetQty = unassignedQty > 0 ? unassignedQty : totalHoldingQty;
    if (!(targetQty > 0)) return;
    setSaving(true);
    try {
      const d = new Date();
      if (preset === 'ltcg_all') {
        // Set safely past 24M (765 days) for USD or 12M (400 days) for INR
        const daysBack = taxRule.ltcgThresholdDays + 35;
        d.setDate(d.getDate() - daysBack);
      }
      const iso = d.toISOString().slice(0, 10);
      const estCost =
        preset === 'fresh_rsu'
          ? Number((holding.price || 0).toFixed(2))
          : Number(((holding.price || 0) * 0.72).toFixed(2)); // 28% historical appreciation default, editable anytime

      const newLot: TaxLot = {
        id: 'lot_' + Math.random().toString(36).slice(2, 10),
        householdId,
        holdingId: holding.id,
        ownerId: holding.ownerId || holding.userId || '',
        ticker: holding.ticker,
        provider: holding.provider || holding.accountBucket,
        acquiredDate: iso,
        quantity: targetQty,
        costPerUnit: estCost,
        currency: holding.currency === 'USD' ? 'USD' : 'INR',
        fxRateAtBuy: holding.currency === 'USD' ? Number(fxRate.toFixed(2)) : undefined,
        acquisitionType: preset === 'fresh_rsu' ? 'RSU Vest' : defaultType,
        updatedAt: Date.now()
      };
      await onSaveTaxLots([...allTaxLots, newLot]);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLot = async (lotId: string) => {
    setSaving(true);
    try {
      await onSaveTaxLots(allTaxLots.filter((l) => l.id !== lotId));
    } finally {
      setSaving(false);
    }
  };

  const sym = holding.currency === 'USD' ? '$' : '₹';

  return (
    <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 border border-indigo-100 space-y-3 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-black text-indigo-700">
            <Calendar size={13} /> Purchase / RSU Vest Lots — {holding.displayName}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
            {taxRule.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {unassignedQty > 0 && (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleQuickPreset('ltcg_all')}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-black transition-colors"
                title="Tag unassigned units as Long-Term Capital Gains (>12M India / >24M US)"
              >
                ⚡ Tag {unassignedQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })} as LTCG
              </button>
              {holding.currency === 'USD' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleQuickPreset('fresh_rsu')}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-black transition-colors"
                  title="Tag unassigned shares as newly vested RSU near current FMV (~0% cap-gains drag)"
                >
                  <Sparkles size={10} className="inline mr-1" />
                  Fresh RSU Vest
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tax lots drawer"
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Existing Lots List */}
      {evaluated.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase text-slate-400 border-b border-slate-200/70">
                <th className="py-1.5 text-left">Buy / Vest Date</th>
                <th className="py-1.5 text-left">Source</th>
                <th className="py-1.5 text-right">Units</th>
                <th className="py-1.5 text-right">Buy Cost</th>
                <th className="py-1.5 text-left pl-3">Tax Status</th>
                <th className="py-1.5 text-right">Gain / Loss</th>
                <th className="py-1.5 text-right">Tax Drag</th>
                <th className="py-1.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50">
              {evaluated.map((ev) => (
                <tr key={ev.lot.id} className="font-medium">
                  <td className="py-2 font-mono font-bold text-slate-800 whitespace-nowrap">
                    {ev.lot.acquiredDate}
                  </td>
                  <td className="py-2 text-slate-600 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold">
                      {ev.lot.acquisitionType}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono text-slate-700">
                    {ev.lot.quantity.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-2 text-right font-mono text-slate-700 whitespace-nowrap">
                    {sym}
                    {ev.lot.costPerUnit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    {ev.lot.currency === 'USD' && ev.lot.fxRateAtBuy ? (
                      <span className="text-[10px] text-slate-400 ml-1">@₹{ev.lot.fxRateAtBuy}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pl-3 whitespace-nowrap">
                    {ev.isLtcg ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                        LTCG • {ev.applicableTaxRatePct}%
                      </span>
                    ) : ev.isNearLtcgCliff ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black">
                        ⏳ LTCG in {ev.daysToLtcgCliff}d!
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black">
                        STCG • {ev.applicableTaxRatePct}%
                        {ev.daysToLtcgCliff > 0 ? ` (${ev.daysToLtcgCliff}d left)` : ''}
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 text-right font-mono font-bold whitespace-nowrap ${
                      ev.unrealizedGainINR >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {ev.unrealizedGainINR >= 0 ? '+' : '-'}
                    {formatCompactINR(Math.abs(ev.unrealizedGainINR))}
                  </td>
                  <td className="py-2 text-right font-mono font-black text-slate-800 whitespace-nowrap">
                    {ev.taxDragPct.toFixed(1)}%
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleDeleteLot(ev.lot.id)}
                      aria-label={`Delete lot ${ev.lot.acquiredDate}`}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Unassigned Balance Indicator */}
      {unassignedQty > 0 && (
        <div className="text-[11px] text-slate-500 flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-slate-200/80">
          <span>
            <strong>{unassignedQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</strong> of{' '}
            {totalHoldingQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })} units don&apos;t have a purchase/vest date yet.
          </span>
          <span className="text-[10px] font-bold text-indigo-600">Add tranche below ↓</span>
        </div>
      )}

      {/* Add Tranche Inline Form */}
      <form onSubmit={handleAddTranche} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end pt-1">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
            Buy / Vest Date
          </label>
          <input
            type="date"
            required
            value={acqDate}
            onChange={(e) => setAcqDate(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Source</label>
          <select
            value={acqType}
            onChange={(e) => setAcqType(e.target.value as TaxAcquisitionType)}
            className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
          >
            <option value="RSU Vest">RSU Vest</option>
            <option value="ESPP">ESPP</option>
            <option value="Market Buy">Market Buy</option>
            <option value="SIP">SIP</option>
            <option value="Bonus/Split">Bonus / Split</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Units</label>
          <input
            type="number"
            step="any"
            required
            placeholder="Qty"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
            Cost / Unit ({sym})
          </label>
          <input
            type="number"
            step="any"
            required
            placeholder="Buy price"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
          />
        </div>
        {holding.currency === 'USD' ? (
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
              USD/INR @ Vest
            </label>
            <input
              type="number"
              step="any"
              placeholder="84.5"
              value={fxInput}
              onChange={(e) => setFxInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold text-slate-900"
            />
          </div>
        ) : (
          <div className="hidden sm:block" />
        )}
        <button
          type="submit"
          disabled={saving}
          className="col-span-2 sm:col-span-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1 shadow-2xs"
        >
          {saving ? <Check size={13} /> : <Plus size={13} />} Add Lot
        </button>
      </form>
    </div>
  );
};
