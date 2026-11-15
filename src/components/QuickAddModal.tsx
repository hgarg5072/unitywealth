import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Upload,
  Landmark,
  Check,
  RefreshCcw,
  X,
  Plus,
  FileUp
} from 'lucide-react';
import { AssetClass, Currency } from '../types';

interface MemberOption {
  id: string;
  name: string;
}

interface QuickAddProps {
  isOpen: boolean;
  onClose: () => void;
  members: MemberOption[];
  defaultOwnerId: string;
  householdId?: string;
  fxRate: number;
  initialMode?: 'search' | 'preset' | 'upload';
  onSaveHolding: (payload: {
    ownerId: string;
    ticker: string;
    originalName: string;
    quantity: number;
    currentPrice: number;
    currency: Currency;
    assetClass: AssetClass;
    provider: string;
    source: 'Manual' | 'Live';
  }) => Promise<void>;
  onUploadFiles: (files: FileList | File[], ownerId: string, providerHint?: string) => Promise<void>;
}

const FAMILY_PRESETS: {
  id: string;
  label: string;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  provider: string;
  hint: string;
}[] = [
  { id: 'epf', label: 'EPF / PPF', ticker: 'EPF-PPF', assetClass: 'Debt', currency: 'INR', provider: 'EPFO / Bank', hint: 'Provident Fund balance' },
  { id: 'fd', label: 'Bank Fixed Deposit', ticker: 'BANK-FD', assetClass: 'Debt', currency: 'INR', provider: 'Bank FD', hint: 'Total FD principal + interest' },
  { id: 'sgb', label: 'Gold / SGB', ticker: 'GOLD-SGB', assetClass: 'Equity', currency: 'INR', provider: 'SGB / Gold', hint: 'Sovereign Gold Bonds or Gold value' },
  { id: 'nps', label: 'NPS Tier I/II', ticker: 'NPS-CORPUS', assetClass: 'Mutual Fund', currency: 'INR', provider: 'NPS', hint: 'National Pension System corpus' },
  { id: 'cash_inr', label: 'Savings / Cash (₹)', ticker: 'CASH-INR', assetClass: 'Debt', currency: 'INR', provider: 'Bank Sweep', hint: 'Emergency fund / liquid cash' },
  { id: 'us_cash', label: 'US Treasury / Cash ($)', ticker: 'US-CASH', assetClass: 'Debt', currency: 'USD', provider: 'US Broker', hint: 'USD money market / HYSA' }
];

export function QuickAddModal({
  isOpen,
  onClose,
  members,
  defaultOwnerId,
  householdId,
  initialMode = 'search',
  onSaveHolding,
  onUploadFiles
}: QuickAddProps) {
  const [mode, setMode] = useState<'search' | 'preset' | 'upload'>(initialMode);
  const [ownerId, setOwnerId] = useState<string>(defaultOwnerId);

  // Search Mode State
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [assetName, setAssetName] = useState('');
  const [entryBy, setEntryBy] = useState<'units' | 'amount'>('units');
  const [unitsInput, setUnitsInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [currency, setCurrency] = useState<Currency>('INR');
  const [assetClass, setAssetClass] = useState<AssetClass>('Equity');
  const [provider, setProvider] = useState('Manual');

  // Preset Mode State
  const [selectedPresetId, setSelectedPresetId] = useState('epf');
  const [presetTitle, setPresetTitle] = useState('EPF / PPF Corpus');
  const [presetAmount, setPresetAmount] = useState('');
  const [presetInst, setPresetInst] = useState('EPFO / Bank');

  // Upload Mode State
  const [brokerHint, setBrokerHint] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addedToast, setAddedToast] = useState('');
  const batchFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      if (defaultOwnerId && defaultOwnerId !== 'combined') {
        setOwnerId(defaultOwnerId);
      } else if (members[0]?.id) {
        setOwnerId(members[0].id);
      }
      setAddedToast('');
    }
  }, [isOpen, initialMode, defaultOwnerId, members]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const hParam = householdId ? `&h=${householdId}` : '';
        const [tRes, mRes] = await Promise.all([
          fetch(`/api/tickers/search?q=${encodeURIComponent(q)}${hParam}`),
          fetch(`/api/mf/search?q=${encodeURIComponent(q)}`)
        ]);
        const tJson = tRes.ok ? await tRes.json() : [];
        const mJson = mRes.ok ? await mRes.json() : [];
        setResults([...(Array.isArray(tJson) ? tJson : []), ...(Array.isArray(mJson) ? mJson : [])].slice(0, 12));
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [query, householdId]);

  if (!isOpen) return null;

  const selectSearchResult = (r: any) => {
    setSelectedSymbol(r.symbol);
    setAssetName(r.shortname || r.symbol);
    const isInd = !!r.isIndia || String(r.symbol).endsWith('.NS') || String(r.symbol).endsWith('.BO') || r.exchDisp === 'AMFI';
    setCurrency(isInd ? 'INR' : 'USD');
    const lowerName = String(r.shortname || '').toLowerCase();
    if (lowerName.includes('arbitrage') || lowerName.includes('liquid') || lowerName.includes('overnight') || lowerName.includes('gilt')) {
      setAssetClass('Debt');
    } else if (r.typeDisp === 'MUTUAL_FUND') {
      setAssetClass('Mutual Fund');
    } else {
      setAssetClass('Equity');
    }
    setProvider(r.exchDisp === 'AMFI' ? 'AMFI' : isInd ? 'Zerodha' : 'US Broker');
    if (r.currentPrice && r.currentPrice > 0) {
      setPriceInput(String(r.currentPrice));
    }
    setQuery('');
    setResults([]);
  };

  const resetSearchFields = () => {
    setSelectedSymbol('');
    setAssetName('');
    setUnitsInput('');
    setAmountInput('');
    setPriceInput('');
  };

  const submitSearchEntry = async (keepOpen: boolean) => {
    const price = parseFloat(priceInput) || 0;
    let qty = parseFloat(unitsInput) || 0;
    if (entryBy === 'amount') {
      const totalAmt = parseFloat(amountInput) || 0;
      if (price > 0 && totalAmt > 0) {
        qty = Number((totalAmt / price).toFixed(6));
      } else if (totalAmt > 0 && price === 0) {
        qty = 1;
      }
    }
    const finalPrice = price > 0 ? price : parseFloat(amountInput) || 0;
    const finalName = assetName.trim() || selectedSymbol.trim();
    if (!finalName || !(qty > 0) || !(finalPrice > 0)) return;

    setIsSubmitting(true);
    try {
      await onSaveHolding({
        ownerId,
        ticker: (selectedSymbol || 'MANUAL').toUpperCase().slice(0, 50),
        originalName: finalName,
        quantity: qty,
        currentPrice: finalPrice,
        currency,
        assetClass,
        provider: provider || 'Manual',
        source: selectedSymbol ? 'Live' : 'Manual'
      });
      if (keepOpen) {
        setAddedToast(`Saved ${finalName}! Ready for next entry.`);
        resetSearchFields();
      } else {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitPresetEntry = async () => {
    const preset = FAMILY_PRESETS.find((p) => p.id === selectedPresetId) || FAMILY_PRESETS[0];
    const amt = parseFloat(presetAmount) || 0;
    if (!(amt > 0)) return;
    setIsSubmitting(true);
    try {
      await onSaveHolding({
        ownerId,
        ticker: preset.ticker,
        originalName: presetTitle.trim() || preset.label,
        quantity: 1,
        currentPrice: amt,
        currency: preset.currency,
        assetClass: preset.assetClass,
        provider: presetInst.trim() || preset.provider,
        source: 'Manual'
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base sm:text-lg text-slate-900">Add or Import Investments</h3>
            <p className="text-xs text-slate-500">Live stocks, mutual funds, EPF/FD presets, or multi-statement PDF/CSV</p>
          </div>
          <button
            type="button"
            aria-label="Close add modal"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Owner / Family Member Selector */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              Assign To Family Member
            </label>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setOwnerId(m.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 border transition-all ${
                    ownerId === m.id
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* 3-Mode Switcher */}
          <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'search' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Search size={13} /> Stock / MF
            </button>
            <button
              type="button"
              onClick={() => setMode('preset')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'preset' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Landmark size={13} /> EPF / FD / Gold
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'upload' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Upload size={13} /> PDF / CSV
            </button>
          </div>

          {addedToast && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
              <Check size={14} className="text-emerald-600" /> {addedToast}
            </div>
          )}

          {/* MODE 1: SMART SEARCH */}
          {mode === 'search' && (
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">
                  1. Search Live US Stock, NSE Stock, ETF or Mutual Fund
                </label>
                <div className="relative">
                  <input
                    type="text"
                    aria-label="Search live stock, ETF, or mutual fund"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Type e.g. Parag Parikh, NVDA, RELIANCE, QCOM..."
                    className="w-full pl-9 pr-8 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <Search size={15} className="absolute left-3 top-3.5 text-slate-400" />
                  {isSearching && <RefreshCcw size={14} className="absolute right-3 top-3.5 animate-spin text-indigo-500" />}
                </div>

                {results.length > 0 && (
                  <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto divide-y divide-slate-50">
                    {results.map((r) => (
                      <button
                        key={`${r.symbol}-${r.exchDisp}`}
                        type="button"
                        onClick={() => selectSearchResult(r)}
                        className="w-full px-3.5 py-2.5 text-left hover:bg-indigo-50/50 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">{r.shortname || r.symbol}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {r.symbol} • {r.exchDisp}
                          </div>
                        </div>
                        {r.currentPrice > 0 && (
                          <span className="text-xs font-black text-emerald-600 shrink-0 tabular-nums">
                            {r.isIndia || r.exchDisp === 'AMFI' ? '₹' : '$'}
                            {Number(r.currentPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Asset Name</label>
                  <input
                    type="text"
                    aria-label="Asset Name"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="e.g. NVIDIA Corp"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    Live Price / NAV ({currency})
                  </label>
                  <input
                    type="number"
                    aria-label="Live Price or NAV"
                    step="any"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="Auto-filled on search"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">2. Enter Holding Size</span>
                  <div className="flex bg-white p-0.5 rounded-lg border border-slate-200 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setEntryBy('units')}
                      className={`px-2.5 py-1 rounded-md ${entryBy === 'units' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                    >
                      By Units / Shares
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryBy('amount')}
                      className={`px-2.5 py-1 rounded-md ${entryBy === 'amount' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                    >
                      By Total {currency === 'INR' ? '₹' : '$'}
                    </button>
                  </div>
                </div>

                {entryBy === 'units' ? (
                  <input
                    type="number"
                    aria-label="Number of shares or units"
                    step="any"
                    value={unitsInput}
                    onChange={(e) => setUnitsInput(e.target.value)}
                    placeholder="Number of shares or MF units (e.g. 50)"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold"
                  />
                ) : (
                  <div className="space-y-1">
                    <input
                      type="number"
                      aria-label="Total market value"
                      step="any"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder={`Current Market Value in ${currency} (e.g. 250000)`}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold"
                    />
                    {parseFloat(amountInput) > 0 && parseFloat(priceInput) > 0 && (
                      <div className="text-[11px] text-indigo-600 font-semibold">
                        Auto-calculated units: {(parseFloat(amountInput) / parseFloat(priceInput)).toFixed(4)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Currency</label>
                  <select
                    aria-label="Currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Asset Class</label>
                  <select
                    aria-label="Asset Class"
                    value={assetClass}
                    onChange={(e) => setAssetClass(e.target.value as AssetClass)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    <option value="Equity">Equity</option>
                    <option value="Mutual Fund">Mutual Fund</option>
                    <option value="Debt">Debt / Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Broker</label>
                  <input
                    type="text"
                    aria-label="Broker or Provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="Broker"
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitSearchEntry(true)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                >
                  <Plus size={14} /> Save & Add Another
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitSearchEntry(false)}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md transition-all"
                >
                  {isSubmitting ? 'Saving...' : 'Save Investment'}
                </button>
              </div>
            </div>
          )}

          {/* MODE 2: FAMILY ASSET PRESETS (EPF / FD / GOLD / NPS / CASH) */}
          {mode === 'preset' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FAMILY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPresetId(p.id);
                      setPresetTitle(p.label);
                      setPresetInst(p.provider);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedPresetId === p.id
                        ? 'border-indigo-600 bg-indigo-50/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">{p.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{p.assetClass} • {p.currency}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                  <input
                    type="text"
                    aria-label="Preset Asset Description"
                    value={presetTitle}
                    onChange={(e) => setPresetTitle(e.target.value)}
                    placeholder="e.g. HDFC FD 7.4%"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Institution / Bank</label>
                  <input
                    type="text"
                    aria-label="Institution or Bank"
                    value={presetInst}
                    onChange={(e) => setPresetInst(e.target.value)}
                    placeholder="e.g. SBI / EPFO"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Current Total Value ({FAMILY_PRESETS.find((p) => p.id === selectedPresetId)?.currency || 'INR'})
                </label>
                <input
                  type="number"
                  aria-label="Current Total Value"
                  step="any"
                  value={presetAmount}
                  onChange={(e) => setPresetAmount(e.target.value)}
                  placeholder="Enter total current value (e.g. 1500000)"
                  className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                />
              </div>

              <button
                type="button"
                disabled={isSubmitting || !(parseFloat(presetAmount) > 0)}
                onClick={submitPresetEntry}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm shadow-md transition-all"
              >
                {isSubmitting ? 'Saving...' : 'Add To Family Portfolio'}
              </button>
            </div>
          )}

          {/* MODE 3: MULTI-FILE STATEMENT UPLOAD */}
          {mode === 'upload' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">
                  Optional Broker / Statement Hint (Auto-detected if left blank)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['', 'CAMS', 'Zerodha', 'INDmoney', 'Charles Schwab', 'IBKR', 'E*TRADE'].map((b) => (
                    <button
                      key={b || 'auto'}
                      type="button"
                      onClick={() => setBrokerHint(b)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${
                        brokerHint === b
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {b || 'Auto-Detect'}
                    </button>
                  ))}
                </div>
              </div>

              <div
                onClick={() => batchFileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    onClose();
                    await onUploadFiles(e.dataTransfer.files, ownerId, brokerHint || undefined);
                  }
                }}
                className="p-8 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50/80 cursor-pointer text-center transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto mb-3 shadow-md">
                  <FileUp size={22} />
                </div>
                <div className="text-sm font-bold text-slate-900">
                  Tap to choose or drop one or multiple PDF / CSV statements
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Supports CAMS / KFintech CAS PDF, Zerodha, INDmoney, Charles Schwab, IBKR & E*TRADE. Automatically links live AMFI NAVs & US stock quotes and updates your monthly wealth curve.
                </p>
                <input
                  ref={batchFileRef}
                  type="file"
                  multiple
                  accept=".pdf,.csv,.txt,.tsv"
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    if (files.length > 0) {
                      onClose();
                      await onUploadFiles(files, ownerId, brokerHint || undefined);
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
