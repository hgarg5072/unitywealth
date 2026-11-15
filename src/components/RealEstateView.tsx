import React, { useState, useMemo, useRef } from 'react';
import {
  Landmark,
  Plus,
  Trash,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  FileUp,
  RefreshCcw,
  Sparkles,
  Users,
  Layers,
  Scale,
  ExternalLink
} from 'lucide-react';
import {
  RealEstateProperty,
  RealEstateDemand,
  RealEstateSwipe,
  RealEstateLoanTx,
  RealEstateFundOrigin
} from '../types';
import {
  computePropertySummary,
  calcStandardEmi,
  simulateLumpSumPrepayment
} from '../lib/realEstateMath';

interface Props {
  householdId: string;
  members: { id: string; name: string }[];
  properties: RealEstateProperty[];
  onSaveProperties: (next: RealEstateProperty[]) => Promise<void>;
  onImportSheet: (opts: { sheetUrl?: string; fileBase64?: string; propertyName?: string }) => Promise<RealEstateProperty>;
}

type SubTab = 'overview' | 'demands' | 'loan' | 'origins';

function fmtCrLakh(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_00_00_000) {
    return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_00_000) {
    return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

function fmtExactINR(val: number): string {
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

const CARD_METHODS = [
  'Magnus',
  'Axis Atlas',
  'Tata Neu CC',
  'SBI Cashback',
  'DCB',
  'Net Banking',
  'Loan'
];

export function RealEstateView({
  householdId,
  members,
  properties,
  onSaveProperties,
  onImportSheet
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Quick setup / Sheet import state
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [quickName, setQuickName] = useState('Primary Residence');
  const [quickTotalCr, setQuickTotalCr] = useState('2.90');
  const [quickSelfLakh, setQuickSelfLakh] = useState('70');
  const [quickLoanLakh, setQuickLoanLakh] = useState('50');
  const [quickTargetEmi, setQuickTargetEmi] = useState('164315');
  const fileRef = useRef<HTMLInputElement>(null);

  // Edit base config drawer
  const [editingBase, setEditingBase] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Demand accordion & inline add state
  const [expandedDemands, setExpandedDemands] = useState<Record<string, boolean>>({});
  const [addingDemand, setAddingDemand] = useState(false);
  const [newDemandTitle, setNewDemandTitle] = useState('');
  const [newDemandDate, setNewDemandDate] = useState('');
  const [newDemandAmt, setNewDemandAmt] = useState('');
  const [newDemandStatus, setNewDemandStatus] = useState<'paid' | 'planned'>('planned');
  const [newDemandPlanMode, setNewDemandPlanMode] = useState<'self_card' | 'loan'>('self_card');

  const [addingSwipeFor, setAddingSwipeFor] = useState<string | null>(null);
  const [swDate, setSwDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [swPaid, setSwPaid] = useState('');
  const [swRecv, setSwRecv] = useState('');
  const [swMethod, setSwMethod] = useState('Magnus');
  const [swCategory, setSwCategory] = useState<'installment' | 'tds' | 'stamp_duty'>('installment');
  const [swPoints, setSwPoints] = useState('');
  const [swNotes, setSwNotes] = useState('');

  // Loan inline add & prepayment simulator state
  const [addingLoanTx, setAddingLoanTx] = useState(false);
  const [lnDate, setLnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lnType, setLnType] = useState<'emi' | 'disbursement' | 'prepayment'>('emi');
  const [lnAmt, setLnAmt] = useState('');
  const [lnNotes, setLnNotes] = useState('');

  // Fund origin add state
  const [addingOrigin, setAddingOrigin] = useState(false);
  const [foLabel, setFoLabel] = useState('');
  const [foAmtLakh, setFoAmtLakh] = useState('');
  const [foMember, setFoMember] = useState(members[0]?.id || 'family_external');

  const prop = properties[selectedIdx] || properties[0] || null;
  const summary = useMemo(() => (prop ? computePropertySummary(prop) : null), [prop]);

  const [simLumpSumINR, setSimLumpSumINR] = useState<number>(
    prop?.loanConfig?.plannedPrepaymentINR || 60_00_000
  );

  const updateCurrentProperty = async (updater: (p: RealEstateProperty) => RealEstateProperty) => {
    if (!prop) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const updated = updater({ ...prop, updatedAt: Date.now() });
      const nextList = properties.map((item) => (item.id === prop.id ? updated : item));
      await onSaveProperties(nextList);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to save changes');
    } finally {
      setIsBusy(false);
    }
  };

  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const agreementValueINR = Math.round((Number(quickTotalCr) || 2.9) * 1_00_00_000);
      const selfPaid = Math.round((Number(quickSelfLakh) || 70) * 1_00_000);
      const loanDisbursed = Math.round((Number(quickLoanLakh) || 50) * 1_00_000);
      const targetEmi = Math.round(Number(quickTargetEmi) || 164315);

      const defaultSplit =
        members.length >= 2
          ? [
              { memberId: members[0].id, sharePct: 50 },
              { memberId: members[1].id, sharePct: 50 }
            ]
          : members.length === 1
          ? [{ memberId: members[0].id, sharePct: 100 }]
          : [];

      const created: RealEstateProperty = {
        id: `re_${Date.now()}`,
        householdId,
        name: quickName.trim() || 'Primary Residence',
        agreementValueINR,
        targetSelfRatioPct: 37.93,
        includeInNetWorth: true,
        useManualTotals: true,
        manualSelfPaidINR: selfPaid,
        manualLoanDisbursedINR: loanDisbursed,
        pointValueINR: 0.8,
        ownershipSplit: defaultSplit,
        loanConfig: {
          lender: 'Home Loan',
          sanctionedLimitINR: 1_80_00_000,
          interestRatePct: 7.3,
          bankTenureYears: 30,
          targetTenureYears: 15,
          targetMonthlyEmiINR: targetEmi,
          minMonthlyEmiINR: 11_000,
          emiDayOfMonth: 23,
          plannedPrepaymentINR: 60_00_000
        },
        demands: [],
        loanLedger:
          loanDisbursed > 0
            ? [
                {
                  id: `ln_init_${Date.now()}`,
                  date: new Date().toISOString().slice(0, 10),
                  type: 'disbursement',
                  amountINR: loanDisbursed,
                  notes: 'Initial Disbursed Balance'
                }
              ]
            : [],
        fundOrigins: [],
        updatedAt: Date.now()
      };

      await onSaveProperties([...properties, created]);
      setStatusMsg('Property added! Your paid-in equity now reflects in Family Net Worth.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not create property');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSheetUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrlInput.trim()) return;
    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const imported = await onImportSheet({
        sheetUrl: sheetUrlInput.trim(),
        propertyName: prop?.name || quickName || 'Primary Residence'
      });
      if (prop) {
        const merged: RealEstateProperty = {
          ...imported,
          id: prop.id,
          name: prop.name,
          includeInNetWorth: prop.includeInNetWorth,
          ownershipSplit: prop.ownershipSplit?.length ? prop.ownershipSplit : imported.ownershipSplit
        };
        await onSaveProperties(properties.map((p) => (p.id === prop.id ? merged : p)));
      } else {
        await onSaveProperties([imported]);
      }
      setShowImportPanel(false);
      setStatusMsg('Synced installments, card swipes, points & loan ledger from Google Sheet!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Google Sheet sync failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const imported = await onImportSheet({
        fileBase64: b64,
        propertyName: prop?.name || file.name.replace(/\.(xlsx|xls)$/i, '') || 'Primary Residence'
      });
      if (prop) {
        const merged: RealEstateProperty = {
          ...imported,
          id: prop.id,
          name: prop.name,
          includeInNetWorth: prop.includeInNetWorth
        };
        await onSaveProperties(properties.map((p) => (p.id === prop.id ? merged : p)));
      } else {
        await onSaveProperties([imported]);
      }
      setShowImportPanel(false);
      setStatusMsg(`Imported ${imported.demands.length} milestones & ${imported.loanLedger.length} loan entries!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Excel import failed');
    } finally {
      setIsBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDeleteProperty = async () => {
    if (!prop) return;
    setIsBusy(true);
    try {
      const remaining = properties.filter((p) => p.id !== prop.id);
      await onSaveProperties(remaining);
      setConfirmDelete(false);
      setSelectedIdx(0);
    } finally {
      setIsBusy(false);
    }
  };

  // --- Empty State ---
  if (!prop || !summary) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Real Estate &amp; Home Loan
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Track paid-in property equity in Family Net Worth without affecting liquid Equity/Debt rebalancing.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Option 1: Sync Google Sheet / XLSX */}
          <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-wider">
                <Sparkles size={12} /> 1-Click Spreadsheet Sync
              </div>
              <h3 className="text-base font-black text-slate-900">Import Google Sheet or Excel</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Imports Builder Installments, split Credit Card swipes (Magnus, Atlas, SBI Cashback), MDR fees &amp; points, 1% TDS, Self-vs-Loan ratio plan, Fund Origins, and your 15-year Loan ledger.
              </p>
            </div>

            <form onSubmit={handleSheetUrlImport} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Google Sheet Link (Viewer Shared)
                </label>
                <input
                  type="url"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isBusy || !sheetUrlInput.trim()}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  {isBusy ? 'Importing...' : 'Sync Google Sheet'}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileRef.current?.click()}
                  className="py-2.5 px-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <FileUp size={14} /> .xlsx
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </div>
            </form>
          </div>

          {/* Option 2: Quick 4-Number Setup */}
          <form
            onSubmit={handleQuickCreate}
            className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5"
          >
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-wider">
                <Landmark size={12} /> Quick Summary Setup
              </div>
              <h3 className="text-base font-black text-slate-900 mt-2">Enter Key Totals Manually</h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Property Name</label>
                <input
                  type="text"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Total Cost (₹ Cr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={quickTotalCr}
                  onChange={(e) => setQuickTotalCr(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Out-of-Pocket Paid (₹ L)</label>
                <input
                  type="number"
                  step="0.1"
                  value={quickSelfLakh}
                  onChange={(e) => setQuickSelfLakh(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Loan Disbursed (₹ L)</label>
                <input
                  type="number"
                  step="0.1"
                  value={quickLoanLakh}
                  onChange={(e) => setQuickLoanLakh(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target EMI (₹/mo)</label>
                <input
                  type="number"
                  value={quickTargetEmi}
                  onChange={(e) => setQuickTargetEmi(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isBusy}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors"
            >
              Add Property (+₹{quickSelfLakh || '0'}L Equity to Net Worth)
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Prepayment simulation values
  const simResult = simulateLumpSumPrepayment({
    loanPrincipalINR: prop.loanConfig.sanctionedLimitINR || summary.outstandingLoanINR || 1_80_00_000,
    annualRatePct: prop.loanConfig.interestRatePct || 7.3,
    targetTenureMonths: (prop.loanConfig.targetTenureYears || 15) * 12,
    currentMonthlyEmiINR: prop.loanConfig.targetMonthlyEmiINR || 164315,
    lumpSumINR: simLumpSumINR
  });

  const paidDemands = prop.demands.filter((d) => d.status !== 'planned');
  const plannedDemands = prop.demands.filter((d) => d.status === 'planned');

  // Compute live projected Self-vs-Loan ratio walk across plannedDemands
  let projTotal = summary.totalPaidToBuilderINR;
  let projSelf = summary.selfPaidINR;
  let projLoan = summary.loanDisbursedINR;
  const plannedProjection = plannedDemands.map((pd) => {
    const amt = Math.max(0, Number(pd.demandAmountINR) || 0);
    let addSelf = 0;
    let addLoan = 0;
    if (pd.plannedFunding === 'loan') {
      addLoan = amt;
    } else if (pd.plannedFunding === 'split') {
      addSelf = Number(pd.plannedSelfINR) || Math.round(amt / 2);
      addLoan = Math.max(0, amt - addSelf);
    } else {
      addSelf = amt;
    }
    projTotal += amt;
    projSelf += addSelf;
    projLoan += addLoan;
    const projRatio = projTotal > 0 ? (projSelf / projTotal) * 100 : 0;
    return { demand: pd, addSelf, addLoan, projTotal, projSelf, projLoan, projRatio };
  });

  const selfBarPct = summary.agreementValueINR > 0 ? (summary.selfPaidINR / summary.agreementValueINR) * 100 : 0;
  const loanBarPct = summary.agreementValueINR > 0 ? (summary.loanDisbursedINR / summary.agreementValueINR) * 100 : 0;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Clean Top Header */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 truncate">{prop.name}</h2>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold">
              {fmtCrLakh(summary.agreementValueINR)} Agreement
            </span>
            <span className="text-[11px] text-slate-400 font-semibold hidden md:inline">
              • Excluded from Equity/Debt Rebalance
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Paid so far: <strong className="text-slate-800">{fmtCrLakh(summary.totalPaidToBuilderINR)}</strong> ({summary.paidProgressPct.toFixed(1)}%) • Remaining demands: <strong className="text-slate-800">{fmtCrLakh(summary.remainingBuilderINR)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              updateCurrentProperty((p) => ({ ...p, includeInNetWorth: !p.includeInNetWorth }))
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              prop.includeInNetWorth
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                prop.includeInNetWorth ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            In Family Net Worth: {prop.includeInNetWorth ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() => {
              setSheetUrlInput(prop.sheetUrl || '');
              setShowImportPanel(!showImportPanel);
            }}
            className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCcw size={13} /> Sync Sheet
          </button>

          <button
            type="button"
            onClick={() => setEditingBase(!editingBase)}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            title="Edit property totals & settings"
            aria-label="Edit property settings"
          >
            <Pencil size={14} />
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDeleteProperty}
                className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold"
              >
                Confirm Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="p-1.5 rounded-xl bg-slate-100 text-slate-600"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              title="Remove property"
              aria-label="Remove property"
            >
              <Trash size={14} />
            </button>
          )}
        </div>
      </div>

      {(errorMsg || statusMsg) && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between ${
            errorMsg
              ? 'bg-rose-50 border border-rose-200 text-rose-700'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{errorMsg || statusMsg}</span>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setStatusMsg(null);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Collapsible Sheet Sync Panel */}
      {showImportPanel && (
        <form
          onSubmit={handleSheetUrlImport}
          className="bg-indigo-50/60 border border-indigo-100 p-4 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <input
            type="url"
            value={sheetUrlInput}
            onChange={(e) => setSheetUrlInput(e.target.value)}
            placeholder="Paste Google Sheets URL (Anyone with link -> Viewer)..."
            className="flex-1 px-3.5 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-medium"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isBusy || !sheetUrlInput.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
            >
              {isBusy ? 'Syncing...' : 'Sync URL'}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1"
            >
              <FileUp size={13} /> Upload .xlsx
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFileImport} className="hidden" />
          </div>
        </form>
      )}

      {/* Collapsible Quick Edit Totals Panel */}
      {editingBase && (
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
              Property Configuration &amp; Totals Source
            </h3>
            <button type="button" onClick={() => setEditingBase(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Property Name</label>
              <input
                type="text"
                defaultValue={prop.name}
                onBlur={(e) => updateCurrentProperty((p) => ({ ...p, name: e.target.value.trim() || p.name }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Agreement Value (₹)</label>
              <input
                type="number"
                defaultValue={prop.agreementValueINR}
                onBlur={(e) =>
                  updateCurrentProperty((p) => ({
                    ...p,
                    agreementValueINR: Math.max(0, Number(e.target.value) || p.agreementValueINR)
                  }))
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target Self % (OCR)</label>
              <input
                type="number"
                step="0.01"
                defaultValue={prop.targetSelfRatioPct}
                onBlur={(e) =>
                  updateCurrentProperty((p) => ({
                    ...p,
                    targetSelfRatioPct: Number(e.target.value) || 37.93
                  }))
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Point Value (₹/pt)</label>
              <input
                type="number"
                step="0.05"
                defaultValue={prop.pointValueINR ?? 0.8}
                onBlur={(e) =>
                  updateCurrentProperty((p) => ({
                    ...p,
                    pointValueINR: Math.max(0, Number(e.target.value) || 0.8)
                  }))
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-800">
                Totals Calculation Mode:{' '}
                <span className="text-indigo-600">
                  {prop.useManualTotals ? 'Manual Summary Override (e.g. ₹70L Self + ₹50L Loan)' : 'Auto-Summed from Swipes & Loan Ledger'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Use Manual Override whenever your sheet ledger lags behind recent payments.
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateCurrentProperty((p) => ({ ...p, useManualTotals: !p.useManualTotals }))}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 shrink-0"
            >
              Switch to {prop.useManualTotals ? 'Auto Ledger Sum' : 'Manual Totals'}
            </button>
          </div>

          {prop.useManualTotals && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Out-of-Pocket Self Paid So Far (₹)
                </label>
                <input
                  type="number"
                  defaultValue={prop.manualSelfPaidINR ?? 70_00_000}
                  onBlur={(e) =>
                    updateCurrentProperty((p) => ({
                      ...p,
                      manualSelfPaidINR: Math.max(0, Number(e.target.value) || 0)
                    }))
                  }
                  className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Home Loan Disbursed So Far (₹)
                </label>
                <input
                  type="number"
                  defaultValue={prop.manualLoanDisbursedINR ?? 50_00_000}
                  onBlur={(e) =>
                    updateCurrentProperty((p) => ({
                      ...p,
                      manualLoanDisbursedINR: Math.max(0, Number(e.target.value) || 0)
                    }))
                  }
                  className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Segmented Sub-Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'demands', label: `Installments & Cards (${paidDemands.length}/${prop.demands.length})` },
            { id: 'loan', label: `Home Loan & EMI (${prop.loanLedger.length})` },
            { id: 'origins', label: `Fund Origins & Split` }
          ] as { id: SubTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
              subTab === t.id
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= SUB-TAB 1: OVERVIEW ================= */}
      {subTab === 'overview' && (
        <div className="space-y-5">
          {/* 4 Clean KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Paid-In Net Equity
              </div>
              <div className="text-xl sm:text-2xl font-black text-emerald-700 mt-1 tabular-nums">
                {fmtCrLakh(summary.netPaidInEquityINR)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {fmtCrLakh(summary.selfPaidINR)} self + {fmtCrLakh(summary.principalRepaidINR)} loan prin.
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Loan Outstanding
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tabular-nums">
                {fmtCrLakh(summary.outstandingLoanINR)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Disbursed {fmtCrLakh(summary.loanDisbursedINR)} of {fmtCrLakh(prop.loanConfig.sanctionedLimitINR)}
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Self-Fund Ratio (OCR)
              </div>
              <div className="text-xl sm:text-2xl font-black text-indigo-700 mt-1 tabular-nums">
                {summary.actualSelfRatioPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Target {summary.targetSelfRatioPct.toFixed(1)}% (1.1 / 2.9 Cr)
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Card Points vs Fees
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tabular-nums">
                {Math.round(summary.totalPointsEarned).toLocaleString('en-IN')}{' '}
                <span className="text-xs font-bold text-slate-400">pts</span>
              </div>
              <div className="text-[11px] text-emerald-600 font-semibold mt-1">
                MDR Fees: {fmtExactINR(summary.totalCcFeesINR)} • Net {summary.netRewardsGainINR >= 0 ? '+' : ''}
                {fmtCrLakh(summary.netRewardsGainINR)}
              </div>
            </div>
          </div>

          {/* Visual 3-Segment Property Funding Bar */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                Property Payment Progress ({fmtCrLakh(summary.agreementValueINR)})
              </h3>
              <span className="text-xs font-bold text-slate-500">
                {summary.paidProgressPct.toFixed(1)}% Paid • {(100 - summary.paidProgressPct).toFixed(1)}% Remaining
              </span>
            </div>

            <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: `${Math.min(100, selfBarPct)}%` }}
                title={`Self-Funded: ${fmtExactINR(summary.selfPaidINR)}`}
              />
              <div
                className="bg-indigo-500 h-full transition-all"
                style={{ width: `${Math.min(100 - selfBarPct, loanBarPct)}%` }}
                title={`Loan Disbursed: ${fmtExactINR(summary.loanDisbursedINR)}`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
                <span className="font-bold text-emerald-900">Self-Funded Paid</span>
                <span className="font-mono font-black text-emerald-700">{fmtCrLakh(summary.selfPaidINR)}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 border border-indigo-100">
                <span className="font-bold text-indigo-900">Paid via Home Loan</span>
                <span className="font-mono font-black text-indigo-700">{fmtCrLakh(summary.loanDisbursedINR)}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="font-bold text-slate-600">Upcoming Demands</span>
                <span className="font-mono font-black text-slate-800">{fmtCrLakh(summary.remainingBuilderINR)}</span>
              </div>
            </div>

            {(summary.totalTdsINR > 0 || summary.totalStampDutyINR > 0 || summary.nextRecommendedEmiINR > 0) && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    1% TDS Paid: <strong className="text-slate-900">{fmtExactINR(summary.totalTdsINR)}</strong>
                  </span>
                  <span>
                    Stamp Duty: <strong className="text-slate-900">{fmtExactINR(summary.totalStampDutyINR)}</strong>
                  </span>
                  <span>
                    EMIs Paid: <strong className="text-slate-900">{fmtExactINR(summary.totalEmiPaidINR)}</strong>
                  </span>
                </div>
                {summary.nextRecommendedEmiINR > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubTab('loan')}
                    className="text-indigo-600 font-bold hover:underline"
                  >
                    Next Target EMI: {fmtExactINR(summary.nextRecommendedEmiINR)} →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SUB-TAB 2: INSTALLMENTS & CARDS ================= */}
      {subTab === 'demands' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                Builder Demands &amp; Split Card Swipes
              </h3>
              <p className="text-xs text-slate-500">
                Click any milestone to view or add credit card / net-banking / loan swipes, 1% TDS, and Stamp Duty.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddingDemand(!addingDemand)}
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
            >
              <Plus size={14} /> Add Milestone
            </button>
          </div>

          {addingDemand && (
            <div className="bg-white p-4 rounded-2xl border border-indigo-200 grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Milestone Title</label>
                <input
                  type="text"
                  value={newDemandTitle}
                  onChange={(e) => setNewDemandTitle(e.target.value)}
                  placeholder="e.g. Installment 4 - Floor Slab"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Due Date</label>
                <input
                  type="date"
                  value={newDemandDate}
                  onChange={(e) => setNewDemandDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Demand Amount (₹)</label>
                <input
                  type="number"
                  value={newDemandAmt}
                  onChange={(e) => setNewDemandAmt(e.target.value)}
                  placeholder="1950000"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Milestone status"
                  value={newDemandStatus}
                  onChange={(e) => setNewDemandStatus(e.target.value as 'paid' | 'planned')}
                  className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                >
                  <option value="planned">Planned</option>
                  <option value="paid">Paid</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const amt = Number(newDemandAmt) || 0;
                    if (!amt) return;
                    const nd: RealEstateDemand = {
                      id: `dem_${Date.now()}`,
                      title: newDemandTitle.trim() || `Installment ${prop.demands.length + 1}`,
                      dueDate: newDemandDate || undefined,
                      demandAmountINR: amt,
                      status: newDemandStatus,
                      plannedFunding: newDemandStatus === 'planned' ? newDemandPlanMode : undefined,
                      swipes: []
                    };
                    await updateCurrentProperty((p) => ({ ...p, demands: [...p.demands, nd] }));
                    setNewDemandTitle('');
                    setNewDemandAmt('');
                    setAddingDemand(false);
                  }}
                  className="px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Completed / Active Demands Accordion */}
          <div className="space-y-3">
            {paidDemands.length === 0 && (
              <div className="p-6 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
                No completed installment milestones logged yet. Click <strong>Sync Sheet</strong> to import your Google Sheet swipes or <strong>+ Add Milestone</strong> above.
              </div>
            )}

            {paidDemands.map((d) => {
              const isExp = Boolean(expandedDemands[d.id]);
              const builderCredited = d.swipes
                .filter((s) => s.category === 'installment')
                .reduce((acc, s) => acc + (s.receivedByBuilderINR || s.paymentAmountINR), 0);
              const pts = d.swipes.reduce((acc, s) => acc + (s.pointsEarned || 0), 0);
              const fees = d.swipes.reduce((acc, s) => acc + (s.ccChargesINR || 0), 0);

              return (
                <div key={d.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                  <div
                    onClick={() => setExpandedDemands((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
                    className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900">{d.title}</span>
                        {d.dueDate && (
                          <span className="text-[11px] font-mono text-slate-400">Due {d.dueDate}</span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase">
                          {d.swipes.length} {d.swipes.length === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-3">
                        <span>Demand: <strong>{fmtExactINR(d.demandAmountINR)}</strong></span>
                        <span>Credited: <strong className="text-slate-800">{fmtExactINR(builderCredited)}</strong></span>
                        {pts > 0 && (
                          <span className="text-indigo-600 font-semibold">
                            +{Math.round(pts).toLocaleString('en-IN')} pts (Fee {fmtExactINR(fees)})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isExp ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </div>

                  {isExp && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/50 space-y-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-[10px] font-black text-slate-400 uppercase border-b border-slate-200/70">
                              <th className="pb-2">Date</th>
                              <th className="pb-2">Method</th>
                              <th className="pb-2">Type</th>
                              <th className="pb-2 text-right">Paid</th>
                              <th className="pb-2 text-right">Credited</th>
                              <th className="pb-2 text-right">CC Fee</th>
                              <th className="pb-2 text-right">Points</th>
                              <th className="pb-2 text-right"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {d.swipes.map((sw) => (
                              <tr key={sw.id}>
                                <td className="py-2 font-mono text-[11px] text-slate-600">{sw.paymentDate || '-'}</td>
                                <td className="py-2 font-bold text-slate-800">
                                  {sw.paymentMethod}
                                  {sw.notes && <span className="block text-[10px] font-normal text-slate-400">{sw.notes}</span>}
                                </td>
                                <td className="py-2">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      sw.category === 'tds'
                                        ? 'bg-amber-50 text-amber-700'
                                        : sw.category === 'stamp_duty'
                                        ? 'bg-purple-50 text-purple-700'
                                        : sw.isLoanFunded
                                        ? 'bg-indigo-50 text-indigo-700'
                                        : 'bg-white border border-slate-200 text-slate-600'
                                    }`}
                                  >
                                    {sw.category === 'tds' ? '1% TDS' : sw.category === 'stamp_duty' ? 'Stamp Duty' : sw.isLoanFunded ? 'Loan' : 'Builder'}
                                  </span>
                                </td>
                                <td className="py-2 text-right font-mono font-semibold">{fmtExactINR(sw.paymentAmountINR)}</td>
                                <td className="py-2 text-right font-mono text-slate-600">
                                  {sw.category === 'installment' ? fmtExactINR(sw.receivedByBuilderINR) : '—'}
                                </td>
                                <td className="py-2 text-right font-mono text-rose-600">
                                  {sw.ccChargesINR > 0 ? fmtExactINR(sw.ccChargesINR) : '—'}
                                </td>
                                <td className="py-2 text-right font-mono text-emerald-700 font-bold">
                                  {sw.pointsEarned > 0 ? Math.round(sw.pointsEarned).toLocaleString('en-IN') : '—'}
                                </td>
                                <td className="py-2 text-right">
                                  <button
                                    type="button"
                                    aria-label="Delete swipe"
                                    onClick={() =>
                                      updateCurrentProperty((p) => ({
                                        ...p,
                                        demands: p.demands.map((dm) =>
                                          dm.id === d.id
                                            ? { ...dm, swipes: dm.swipes.filter((s) => s.id !== sw.id) }
                                            : dm
                                        )
                                      }))
                                    }
                                    className="p-1 text-slate-400 hover:text-rose-600"
                                  >
                                    <Trash size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {addingSwipeFor === d.id ? (
                        <div className="bg-white p-3.5 rounded-xl border border-indigo-200 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Date</label>
                            <input
                              type="date"
                              value={swDate}
                              onChange={(e) => setSwDate(e.target.value)}
                              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Method</label>
                            <select
                              aria-label="Payment method"
                              value={swMethod}
                              onChange={(e) => setSwMethod(e.target.value)}
                              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
                            >
                              {CARD_METHODS.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Type</label>
                            <select
                              aria-label="Payment category"
                              value={swCategory}
                              onChange={(e) => setSwCategory(e.target.value as any)}
                              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
                            >
                              <option value="installment">Installment</option>
                              <option value="tds">1% TDS</option>
                              <option value="stamp_duty">Stamp Duty</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Paid (₹)</label>
                            <input
                              type="number"
                              value={swPaid}
                              onChange={(e) => {
                                setSwPaid(e.target.value);
                                if (!swRecv) setSwRecv(e.target.value);
                              }}
                              placeholder="960000"
                              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Builder Recv (₹)</label>
                            <input
                              type="number"
                              value={swRecv}
                              onChange={(e) => setSwRecv(e.target.value)}
                              placeholder="940176"
                              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Points Earned</label>
                            <input
                              type="number"
                              value={swPoints}
                              onChange={(e) => setSwPoints(e.target.value)}
                              placeholder="120600"
                              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          </div>
                          <div className="col-span-2 sm:col-span-6 flex items-center justify-between gap-2 pt-1">
                            <input
                              type="text"
                              value={swNotes}
                              onChange={(e) => setSwNotes(e.target.value)}
                              placeholder="Optional note (e.g. 2% gateway fee)"
                              className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                const paid = Number(swPaid) || 0;
                                if (!paid) return;
                                const recv = Number(swRecv) || paid;
                                const newSw: RealEstateSwipe = {
                                  id: `sw_${Date.now()}`,
                                  paymentDate: swDate,
                                  paymentAmountINR: paid,
                                  paymentMethod: swMethod,
                                  isLoanFunded: swMethod === 'Loan',
                                  receivedByBuilderINR: swCategory === 'installment' ? recv : paid,
                                  ccChargesINR: swCategory === 'installment' ? Math.max(0, paid - recv) : 0,
                                  pointsEarned: Number(swPoints) || 0,
                                  category: swCategory,
                                  notes: swNotes.trim() || undefined
                                };
                                await updateCurrentProperty((p) => ({
                                  ...p,
                                  demands: p.demands.map((dm) =>
                                    dm.id === d.id ? { ...dm, swipes: [...dm.swipes, newSw] } : dm
                                  )
                                }));
                                setSwPaid('');
                                setSwRecv('');
                                setSwPoints('');
                                setSwNotes('');
                                setAddingSwipeFor(null);
                              }}
                              className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold"
                            >
                              Add Swipe
                            </button>
                            <button
                              type="button"
                              onClick={() => setAddingSwipeFor(null)}
                              className="px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => setAddingSwipeFor(d.id)}
                            className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
                          >
                            <Plus size={13} /> Add Card / Bank / TDS Swipe
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentProperty((p) => ({
                                ...p,
                                demands: p.demands.filter((dm) => dm.id !== d.id)
                              }))
                            }
                            className="text-[11px] font-bold text-rose-500 hover:underline"
                          >
                            Delete Milestone
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Forward Self-vs-Loan Ratio Planner (Columns L..Q) */}
          {plannedProjection.length > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                    Forward Demand &amp; OCR Ratio Planner (Target {summary.targetSelfRatioPct.toFixed(1)}%)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Toggle future demands between <strong>Card (Self)</strong> and <strong>Loan</strong> to stay near your 1.1 / 2.9 Cr ratio.
                  </p>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {plannedProjection.map(({ demand, projTotal: pt, projRatio }) => (
                  <div key={demand.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800">{demand.title}</span>
                      {demand.dueDate && <span className="ml-2 text-slate-400 font-mono text-[11px]">{demand.dueDate}</span>}
                      <span className="ml-2 font-mono font-bold text-slate-700">{fmtCrLakh(demand.demandAmountINR)}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() =>
                            updateCurrentProperty((p) => ({
                              ...p,
                              demands: p.demands.map((dm) =>
                                dm.id === demand.id ? { ...dm, plannedFunding: 'self_card' } : dm
                              )
                            }))
                          }
                          className={`px-2.5 py-1 rounded-md ${
                            demand.plannedFunding !== 'loan' ? 'bg-white text-emerald-700 shadow-2xs' : 'text-slate-500'
                          }`}
                        >
                          Card / Self
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateCurrentProperty((p) => ({
                              ...p,
                              demands: p.demands.map((dm) =>
                                dm.id === demand.id ? { ...dm, plannedFunding: 'loan' } : dm
                              )
                            }))
                          }
                          className={`px-2.5 py-1 rounded-md ${
                            demand.plannedFunding === 'loan' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500'
                          }`}
                        >
                          Loan
                        </button>
                      </div>

                      <span className="text-[11px] font-mono text-slate-500 w-28 text-right">
                        Self: <strong className="text-slate-900">{projRatio.toFixed(1)}%</strong>
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          updateCurrentProperty((p) => ({
                            ...p,
                            demands: p.demands.map((dm) =>
                              dm.id === demand.id
                                ? {
                                    ...dm,
                                    status: 'paid',
                                    swipes: [
                                      {
                                        id: `sw_auto_${Date.now()}`,
                                        paymentDate: new Date().toISOString().slice(0, 10),
                                        paymentAmountINR: dm.demandAmountINR,
                                        paymentMethod: dm.plannedFunding === 'loan' ? 'Loan' : 'Magnus',
                                        isLoanFunded: dm.plannedFunding === 'loan',
                                        receivedByBuilderINR: dm.demandAmountINR,
                                        ccChargesINR: 0,
                                        pointsEarned: 0,
                                        category: 'installment'
                                      }
                                    ]
                                  }
                                : dm
                            )
                          }))
                        }
                        className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[10px] font-black hover:bg-emerald-100"
                      >
                        Mark Paid
                      </button>

                      <button
                        type="button"
                        aria-label="Remove planned demand"
                        onClick={() =>
                          updateCurrentProperty((p) => ({
                            ...p,
                            demands: p.demands.filter((dm) => dm.id !== demand.id)
                          }))
                        }
                        className="p-1 text-slate-400 hover:text-rose-500"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= SUB-TAB 3: HOME LOAN & EMI ================= */}
      {subTab === 'loan' && (
        <div className="space-y-5">
          {/* Loan Parameters & Catch-Up Banner */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                  Accelerated Home Loan ({prop.loanConfig.targetTenureYears}-Yr Payoff Target vs {prop.loanConfig.bankTenureYears}-Yr Bank)
                </h3>
                {prop.loanConfig.note && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{prop.loanConfig.note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setLnAmt(String(summary.nextRecommendedEmiINR || prop.loanConfig.targetMonthlyEmiINR || ''));
                  setAddingLoanTx(!addingLoanTx);
                }}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
              >
                <Plus size={14} /> Log EMI / Disbursement
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Sanctioned Limit (₹)</label>
                <input
                  type="number"
                  defaultValue={prop.loanConfig.sanctionedLimitINR}
                  onBlur={(e) =>
                    updateCurrentProperty((p) => ({
                      ...p,
                      loanConfig: {
                        ...p.loanConfig,
                        sanctionedLimitINR: Number(e.target.value) || p.loanConfig.sanctionedLimitINR
                      }
                    }))
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Interest Rate (% p.a.)</label>
                <input
                  type="number"
                  step="0.05"
                  defaultValue={prop.loanConfig.interestRatePct}
                  onBlur={(e) => {
                    const nextRate = Number(e.target.value) || 7.3;
                    const suggestedEmi = calcStandardEmi(
                      prop.loanConfig.sanctionedLimitINR,
                      nextRate,
                      (prop.loanConfig.targetTenureYears || 15) * 12
                    );
                    updateCurrentProperty((p) => ({
                      ...p,
                      loanConfig: {
                        ...p.loanConfig,
                        interestRatePct: nextRate,
                        targetMonthlyEmiINR: p.loanConfig.targetMonthlyEmiINR || suggestedEmi
                      }
                    }));
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">15-Yr Target EMI (₹)</label>
                <input
                  type="number"
                  defaultValue={prop.loanConfig.targetMonthlyEmiINR}
                  onBlur={(e) =>
                    updateCurrentProperty((p) => ({
                      ...p,
                      loanConfig: {
                        ...p.loanConfig,
                        targetMonthlyEmiINR: Number(e.target.value) || p.loanConfig.targetMonthlyEmiINR
                      }
                    }))
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Bank Min EMI (₹)</label>
                <input
                  type="number"
                  defaultValue={prop.loanConfig.minMonthlyEmiINR}
                  onBlur={(e) =>
                    updateCurrentProperty((p) => ({
                      ...p,
                      loanConfig: {
                        ...p.loanConfig,
                        minMonthlyEmiINR: Number(e.target.value) || 0
                      }
                    }))
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                />
              </div>
            </div>

            {/* Catch-Up Status Strip */}
            <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-bold text-indigo-950">
                  Next Month Recommended Payment:{' '}
                  <span className="font-mono text-sm font-black text-indigo-700">
                    {fmtExactINR(summary.nextRecommendedEmiINR)}
                  </span>
                </span>
                <span className="block sm:inline sm:ml-2 text-indigo-700/80">
                  {summary.cumulativeShortfallINR > 0
                    ? `(Includes ${fmtExactINR(summary.cumulativeShortfallINR)} shortfall catch-up)`
                    : summary.cumulativeShortfallINR < 0
                    ? `(${fmtExactINR(Math.abs(summary.cumulativeShortfallINR))} ahead of 15-yr target!)`
                    : '(Right on 15-yr schedule)'}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-slate-600">
                Principal Repaid: <strong className="text-emerald-700">{fmtExactINR(summary.principalRepaidINR)}</strong> • Interest: <strong>{fmtExactINR(summary.interestPaidINR)}</strong>
              </div>
            </div>

            {addingLoanTx && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-indigo-200 grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Date</label>
                  <input
                    type="date"
                    value={lnDate}
                    onChange={(e) => setLnDate(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Entry Type</label>
                  <select
                    aria-label="Loan entry type"
                    value={lnType}
                    onChange={(e) => setLnType(e.target.value as any)}
                    className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                  >
                    <option value="emi">Monthly EMI</option>
                    <option value="disbursement">Bank Disbursement</option>
                    <option value="prepayment">Lump-Sum Prepayment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    value={lnAmt}
                    onChange={(e) => setLnAmt(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Note</label>
                  <input
                    type="text"
                    value={lnNotes}
                    onChange={(e) => setLnNotes(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const amt = Number(lnAmt) || 0;
                      if (!amt) return;
                      const tx: RealEstateLoanTx = {
                        id: `ln_${Date.now()}`,
                        date: lnDate,
                        type: lnType,
                        amountINR: amt,
                        expectedEmiINR: lnType === 'emi' ? prop.loanConfig.targetMonthlyEmiINR : undefined,
                        minEmiINR: lnType === 'emi' ? prop.loanConfig.minMonthlyEmiINR : undefined,
                        notes: lnNotes.trim() || undefined
                      };
                      await updateCurrentProperty((p) => ({
                        ...p,
                        loanLedger: [...p.loanLedger, tx]
                      }));
                      setLnAmt('');
                      setLnNotes('');
                      setAddingLoanTx(false);
                    }}
                    className="flex-1 py-2 px-3 bg-indigo-600 text-white rounded-lg text-xs font-bold"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingLoanTx(false)}
                    className="p-2 bg-white border border-slate-200 text-slate-500 rounded-lg"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Loan Disbursement & Repayment Table */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-3">
              Disbursement &amp; Repayment Ledger
            </h4>
            {summary.enrichedLoanLedger.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No loan entries logged yet.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase border-b border-slate-100">
                    <th className="pb-2.5">Date</th>
                    <th className="pb-2.5">Type</th>
                    <th className="pb-2.5 text-right">Amount</th>
                    <th className="pb-2.5 text-right">Principal (+Equity)</th>
                    <th className="pb-2.5 text-right">Interest</th>
                    <th className="pb-2.5 text-right">Loan Balance</th>
                    <th className="pb-2.5 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {summary.enrichedLoanLedger.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2.5 font-mono text-[11px] text-slate-600">{tx.date}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            tx.type === 'disbursement'
                              ? 'bg-indigo-50 text-indigo-700'
                              : tx.type === 'prepayment'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {tx.type}
                        </span>
                        {tx.notes && <span className="ml-2 text-[11px] text-slate-400">{tx.notes}</span>}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-slate-900">
                        {tx.type === 'disbursement' ? '+' : ''}
                        {fmtExactINR(tx.amountINR)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-emerald-700 font-semibold">
                        {tx.computedPrincipalINR > 0 ? fmtExactINR(tx.computedPrincipalINR) : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-500">
                        {tx.computedInterestINR > 0 ? fmtExactINR(tx.computedInterestINR) : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-slate-800">
                        {fmtCrLakh(tx.runningOutstandingINR)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          aria-label="Delete loan entry"
                          onClick={() =>
                            updateCurrentProperty((p) => ({
                              ...p,
                              loanLedger: p.loanLedger.filter((item) => item.id !== tx.id)
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Plot-Sale / Lump-Sum Prepayment Simulator */}
          <div className="bg-slate-900 text-white p-5 sm:p-6 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                  What-If Prepayment / Plot-Sale Simulator
                </div>
                <h4 className="text-base font-bold mt-0.5">
                  Inject {fmtCrLakh(simLumpSumINR)} Lump Sum against {fmtCrLakh(simResult.basePrincipal)} Full Loan
                </h4>
              </div>
              <span className="font-mono text-lg font-black text-emerald-400">{fmtCrLakh(simLumpSumINR)}</span>
            </div>

            <input
              type="range"
              aria-label="Prepayment lump sum amount"
              min={5_00_000}
              max={1_50_00_000}
              step={5_00_000}
              value={simLumpSumINR}
              onChange={(e) => setSimLumpSumINR(Number(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div className="p-4 rounded-xl bg-slate-800/90 border border-slate-700 space-y-1">
                <div className="text-[10px] font-black text-slate-400 uppercase">
                  Option A: Lower Monthly EMI (Keep 15 Yrs)
                </div>
                <div className="text-xl font-black text-white font-mono">
                  {fmtExactINR(simResult.reducedEmi)}
                  <span className="text-xs font-normal text-slate-400">/mo</span>
                </div>
                <div className="text-xs text-emerald-400 font-semibold">
                  Saves {fmtExactINR(simResult.emiMonthlySavings)}/mo • {fmtCrLakh(simResult.optionAInterestSaved)} less interest
                </div>
              </div>

              <div className="p-4 rounded-xl bg-indigo-950/80 border border-indigo-500/30 space-y-1">
                <div className="text-[10px] font-black text-indigo-300 uppercase">
                  Option B: Keep {fmtExactINR(simResult.baseEmi)}/mo &amp; Finish Early
                </div>
                <div className="text-xl font-black text-white font-mono">
                  {(simResult.acceleratedMonths / 12).toFixed(1)} Years{' '}
                  <span className="text-xs font-bold text-emerald-400">(-{simResult.yearsSaved} yrs!)</span>
                </div>
                <div className="text-xs text-emerald-400 font-semibold">
                  Saves {fmtCrLakh(simResult.optionBInterestSaved)} in total bank interest
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= SUB-TAB 4: FUND ORIGINS & SPLIT ================= */}
      {subTab === 'origins' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Member Ownership Attribution */}
          <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Users size={14} className="text-indigo-600" /> Household Co-Ownership Split
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Controls how {fmtCrLakh(summary.netPaidInEquityINR)} Paid-In Equity is attributed when viewing individual family member tabs.
              </p>
            </div>

            <div className="space-y-2.5">
              {members.map((m) => {
                const existing = prop.ownershipSplit.find((s) => s.memberId === m.id);
                const pct = existing ? existing.sharePct : members.length > 0 ? +(100 / members.length).toFixed(1) : 0;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <div className="text-xs font-bold text-slate-800">{m.name}</div>
                      <div className="text-[11px] text-slate-500">
                        Share: {fmtCrLakh((summary.netPaidInEquityINR * pct) / 100)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={pct}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          const others = members.filter((om) => om.id !== m.id);
                          let nextSplit = members.map((mem) => {
                            if (mem.id === m.id) return { memberId: mem.id, sharePct: val };
                            if (others.length === 1) return { memberId: mem.id, sharePct: Math.max(0, 100 - val) };
                            const cur = prop.ownershipSplit.find((s) => s.memberId === mem.id)?.sharePct ?? 0;
                            return { memberId: mem.id, sharePct: cur };
                          });
                          updateCurrentProperty((p) => ({ ...p, ownershipSplit: nextSplit }));
                        }}
                        className="w-16 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-right"
                      />
                      <span className="text-xs font-bold text-slate-400">%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fund Origins List (Column J) */}
          <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  Self-Funding Sources (Fund Origin)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tracks which bonuses, stock sales, MF redemptions, or family contributions funded your down payment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddingOrigin(!addingOrigin)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1 shrink-0"
              >
                <Plus size={13} /> Add Source
              </button>
            </div>

            {addingOrigin && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-indigo-200 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Source Label</label>
                  <input
                    type="text"
                    value={foLabel}
                    onChange={(e) => setFoLabel(e.target.value)}
                    placeholder="e.g. 10L - Tata Arbitrage MF"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Amount (₹ L)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={foAmtLakh}
                    onChange={(e) => setFoAmtLakh(e.target.value)}
                    placeholder="10"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Source contributor"
                    value={foMember}
                    onChange={(e) => setFoMember(e.target.value)}
                    className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    <option value="family_external">Extended Family / Parents</option>
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!foLabel.trim()) return;
                      const item: RealEstateFundOrigin = {
                        id: `fo_${Date.now()}`,
                        label: foLabel.trim(),
                        amountINR: Math.round((Number(foAmtLakh) || 0) * 1_00_000),
                        memberTag: foMember
                      };
                      await updateCurrentProperty((p) => ({
                        ...p,
                        fundOrigins: [...(p.fundOrigins || []), item]
                      }));
                      setFoLabel('');
                      setFoAmtLakh('');
                      setAddingOrigin(false);
                    }}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {(prop.fundOrigins || []).length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No fund origins recorded yet. Sync your Google Sheet or click <strong>+ Add Source</strong>.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {prop.fundOrigins.map((fo) => {
                  const memberLabel =
                    fo.memberTag === 'family_external'
                      ? 'Family / Parents'
                      : members.find((m) => m.id === fo.memberTag)?.name || 'Member';
                  return (
                    <div key={fo.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-800 truncate">{fo.label}</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                          {memberLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {fo.amountINR > 0 && (
                          <span className="font-mono font-bold text-slate-900">{fmtCrLakh(fo.amountINR)}</span>
                        )}
                        <button
                          type="button"
                          aria-label="Remove fund origin"
                          onClick={() =>
                            updateCurrentProperty((p) => ({
                              ...p,
                              fundOrigins: p.fundOrigins.filter((x) => x.id !== fo.id)
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
