import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Award,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Gift,
  Pencil,
  Plane,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Trash,
  X
} from 'lucide-react';
import {
  CardNetwork,
  CardStatus,
  CreditCardAccount,
  HouseholdRewardsBundle,
  LoyaltyProgramAccount,
  LoyaltyVoucher,
  PointsActivityEntry,
  PointsExpiryPolicy,
  RealEstateProperty
} from '../types';
import {
  INDIAN_CARD_PRESETS,
  LOYALTY_PROGRAM_PRESETS,
  computeCardFeeWithGstINR,
  computeRewardsHubSummary,
  daysUntilIso,
  isCardFeeWaived,
  resolveEffectiveExpiryDate,
  suggestTransferRatio,
  summarizeRealEstateSwipePointsByCard
} from '../shared/rewardsMath';
import { formatCompactINR, formatExactINR } from '../shared/formatters';

interface Props {
  householdId: string;
  members: { id: string; name: string }[];
  defaultOwnerId: string;
  bundle: HouseholdRewardsBundle;
  realEstateProperties?: RealEstateProperty[];
  onSaveBundle: (patch: Partial<HouseholdRewardsBundle>) => Promise<void>;
}

type RewardsSubTab = 'overview' | 'cards' | 'loyalty' | 'transfers';
type CardSortKey = 'valueDesc' | 'renewalAsc' | 'pointsDesc' | 'feeDesc';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CardsMilesView({
  householdId,
  members,
  defaultOwnerId,
  bundle,
  realEstateProperties = [],
  onSaveBundle
}: Props) {
  const [subTab, setSubTab] = useState<RewardsSubTab>('overview');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [isBusy, setIsBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Cards filters & drawers
  const [cardSearch, setCardSearch] = useState('');
  const [cardSort, setCardSort] = useState<CardSortKey>('valueDesc');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [showCardForm, setShowCardForm] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [quickEditCardId, setQuickEditCardId] = useState<string | null>(null);
  const [quickCardPoints, setQuickCardPoints] = useState('');

  // Card form fields
  const [cOwnerId, setCOwnerId] = useState(defaultOwnerId || members[0]?.id || '');
  const [cBank, setCBank] = useState('Axis Bank');
  const [cName, setCName] = useState('');
  const [cLast4, setCLast4] = useState('');
  const [cNetwork, setCNetwork] = useState<CardNetwork>('Visa');
  const [cStatus, setCStatus] = useState<CardStatus>('active');
  const [cPointsCurrency, setCPointsCurrency] = useState('Reward Points');
  const [cPointsBalance, setCPointsBalance] = useState('');
  const [cPointValue, setCPointValue] = useState('1.0');
  const [cExpiryPolicy, setCExpiryPolicy] = useState<PointsExpiryPolicy>('rolling_months');
  const [cExpiryDate, setCExpiryDate] = useState('');
  const [cRollingMonths, setCRollingMonths] = useState('36');
  const [cLastActivity, setCLastActivity] = useState(todayIso());
  const [cRenewalDate, setCRenewalDate] = useState('');
  const [cAnnualFee, setCAnnualFee] = useState('');
  const [cGstIncluded, setCGstIncluded] = useState(false);
  const [cIsLtf, setCIsLtf] = useState(false);
  const [cFeeWaiverSpend, setCFeeWaiverSpend] = useState('');
  const [cCurrentSpend, setCCurrentSpend] = useState('');
  const [cRenewalBenefitVal, setCRenewalBenefitVal] = useState('');
  const [cRenewalBenefitNote, setCRenewalBenefitNote] = useState('');
  const [cMilestoneTarget, setCMilestoneTarget] = useState('');
  const [cMilestoneNote, setCMilestoneNote] = useState('');
  const [cTransferCapUsed, setCTransferCapUsed] = useState('');
  const [cTransferCapLimit, setCTransferCapLimit] = useState('');
  const [cTransferCapNote, setCTransferCapNote] = useState('');
  const [cStatementDay, setCStatementDay] = useState('');
  const [cDueDay, setCDueDay] = useState('');
  const [cCreditLimit, setCCreditLimit] = useState('');
  const [cLoungeNotes, setCLoungeNotes] = useState('');
  const [cNotes, setCNotes] = useState('');

  // Loyalty filters & drawers
  const [loyaltyCatFilter, setLoyaltyCatFilter] = useState<'all' | 'hotel' | 'airline'>('all');
  const [expandedPrograms, setExpandedPrograms] = useState<Record<string, boolean>>({});
  const [showProgramForm, setShowProgramForm] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [quickEditProgId, setQuickEditProgId] = useState<string | null>(null);
  const [quickProgPoints, setQuickProgPoints] = useState('');

  // Loyalty form fields
  const [pOwnerId, setPOwnerId] = useState(defaultOwnerId || members[0]?.id || '');
  const [pCategory, setPCategory] = useState<'hotel' | 'airline' | 'other'>('hotel');
  const [pName, setPName] = useState('');
  const [pMemberNo, setPMemberNo] = useState('');
  const [pTier, setPTier] = useState('');
  const [pBalance, setPBalance] = useState('');
  const [pPointValue, setPPointValue] = useState('0.7');
  const [pExpiryPolicy, setPExpiryPolicy] = useState<PointsExpiryPolicy>('rolling_months');
  const [pExpiryDate, setPExpiryDate] = useState('');
  const [pRollingMonths, setPRollingMonths] = useState('24');
  const [pLastActivity, setPLastActivity] = useState(todayIso());
  const [pNotes, setPNotes] = useState('');

  // Voucher inline form
  const [addingVoucherFor, setAddingVoucherFor] = useState<string | null>(null);
  const [vTitle, setVTitle] = useState('');
  const [vValue, setVValue] = useState('');
  const [vExpiry, setVExpiry] = useState('');
  const [vNote, setVNote] = useState('');

  // Transfer calculator form
  const [txFromCardId, setTxFromCardId] = useState('');
  const [txToProgId, setTxToProgId] = useState('');
  const [txPointsOut, setTxPointsOut] = useState('');
  const [txFromRatio, setTxFromRatio] = useState('1');
  const [txToRatio, setTxToRatio] = useState('1');
  const [txNote, setTxNote] = useState('');

  const memberName = (id?: string) => members.find((m) => m.id === id)?.name || 'Family';

  const filteredBundle = useMemo<HouseholdRewardsBundle>(() => {
    if (ownerFilter === 'all') return bundle;
    return {
      creditCards: (bundle.creditCards || []).filter((c) => c.ownerId === ownerFilter),
      loyaltyPrograms: (bundle.loyaltyPrograms || []).filter((p) => p.ownerId === ownerFilter),
      activities: bundle.activities || []
    };
  }, [bundle, ownerFilter]);

  const summary = useMemo(
    () => computeRewardsHubSummary(filteredBundle, members),
    [filteredBundle, members]
  );

  const realEstateCardPoints = useMemo(
    () => summarizeRealEstateSwipePointsByCard(realEstateProperties),
    [realEstateProperties]
  );

  const persistPatch = async (patch: Partial<HouseholdRewardsBundle>, msg?: string) => {
    setIsBusy(true);
    setErrorMsg(null);
    try {
      await onSaveBundle(patch);
      if (msg) setStatusMsg(msg);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to save Cards & Miles update');
    } finally {
      setIsBusy(false);
    }
  };

  // --- Card Form Helpers ---
  const applyCardPreset = (presetKey: string) => {
    const preset = INDIAN_CARD_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    setCBank(preset.bank);
    setCName(preset.cardName);
    setCNetwork(preset.network);
    setCPointsCurrency(preset.pointsCurrency);
    setCPointValue(String(preset.pointValueINR));
    setCAnnualFee(String(preset.annualFeeINR));
    setCGstIncluded(false);
    setCIsLtf(Boolean(preset.isLifetimeFree));
    setCStatus(preset.isLifetimeFree ? 'ltf' : 'active');
    setCFeeWaiverSpend(preset.feeWaiverSpendINR ? String(preset.feeWaiverSpendINR) : '');
    setCRenewalBenefitVal(preset.renewalBenefitValueINR ? String(preset.renewalBenefitValueINR) : '');
    setCRenewalBenefitNote(preset.renewalBenefitNote || '');
    setCMilestoneTarget(preset.milestoneTargetINR ? String(preset.milestoneTargetINR) : '');
    setCMilestoneNote(preset.milestoneRewardNote || '');
    setCTransferCapLimit(preset.transferCapLimit ? String(preset.transferCapLimit) : '');
    setCTransferCapNote(preset.transferCapNote || '');
    setCExpiryPolicy(preset.expiryPolicy);
    setCRollingMonths(preset.rollingInactivityMonths ? String(preset.rollingInactivityMonths) : '36');
    setCLoungeNotes(preset.loungeNotes || '');
  };

  const openCardEditor = (card?: CreditCardAccount) => {
    if (card) {
      setEditingCardId(card.id);
      setCOwnerId(card.ownerId || defaultOwnerId);
      setCBank(card.bank);
      setCName(card.cardName);
      setCLast4(card.last4 || '');
      setCNetwork(card.network || 'Visa');
      setCStatus(card.status);
      setCPointsCurrency(card.pointsCurrency);
      setCPointsBalance(String(card.pointsBalance || ''));
      setCPointValue(String(card.pointValueINR ?? 1));
      setCExpiryPolicy(card.expiryPolicy || 'rolling_months');
      setCExpiryDate(card.pointsExpiryDate || '');
      setCRollingMonths(card.rollingInactivityMonths ? String(card.rollingInactivityMonths) : '36');
      setCLastActivity(card.lastActivityDate || todayIso());
      setCRenewalDate(card.renewalDate || '');
      setCAnnualFee(String(card.annualFeeINR || ''));
      setCGstIncluded(Boolean(card.gstIncludedInFee));
      setCIsLtf(Boolean(card.isLifetimeFree || card.status === 'ltf'));
      setCFeeWaiverSpend(card.feeWaiverSpendINR ? String(card.feeWaiverSpendINR) : '');
      setCCurrentSpend(card.currentYearSpendINR ? String(card.currentYearSpendINR) : '');
      setCRenewalBenefitVal(card.renewalBenefitValueINR ? String(card.renewalBenefitValueINR) : '');
      setCRenewalBenefitNote(card.renewalBenefitNote || '');
      setCMilestoneTarget(card.milestoneTargetINR ? String(card.milestoneTargetINR) : '');
      setCMilestoneNote(card.milestoneRewardNote || '');
      setCTransferCapUsed(card.transferCapUsed ? String(card.transferCapUsed) : '');
      setCTransferCapLimit(card.transferCapLimit ? String(card.transferCapLimit) : '');
      setCTransferCapNote(card.transferCapNote || '');
      setCStatementDay(card.statementDay ? String(card.statementDay) : '');
      setCDueDay(card.dueDay ? String(card.dueDay) : '');
      setCCreditLimit(card.creditLimitINR ? String(card.creditLimitINR) : '');
      setCLoungeNotes(card.loungeNotes || '');
      setCNotes(card.notes || '');
    } else {
      setEditingCardId(null);
      setCOwnerId(ownerFilter !== 'all' ? ownerFilter : defaultOwnerId || members[0]?.id || '');
      setCBank('');
      setCName('');
      setCLast4('');
      setCNetwork('Visa');
      setCStatus('active');
      setCPointsCurrency('Reward Points');
      setCPointsBalance('');
      setCPointValue('1.0');
      setCExpiryPolicy('rolling_months');
      setCExpiryDate('');
      setCRollingMonths('36');
      setCLastActivity(todayIso());
      setCRenewalDate('');
      setCAnnualFee('');
      setCGstIncluded(false);
      setCIsLtf(false);
      setCFeeWaiverSpend('');
      setCCurrentSpend('');
      setCRenewalBenefitVal('');
      setCRenewalBenefitNote('');
      setCMilestoneTarget('');
      setCMilestoneNote('');
      setCTransferCapUsed('');
      setCTransferCapLimit('');
      setCTransferCapNote('');
      setCStatementDay('');
      setCDueDay('');
      setCCreditLimit('');
      setCLoungeNotes('');
      setCNotes('');
    }
    setShowCardForm(true);
    setSubTab('cards');
  };

  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName.trim()) {
      setErrorMsg('Please enter a credit card name.');
      return;
    }
    const cardObj: CreditCardAccount = {
      id: editingCardId || `cc_${Date.now()}`,
      householdId,
      ownerId: cOwnerId || defaultOwnerId || members[0]?.id || '',
      bank: cBank.trim() || 'Bank',
      cardName: cName.trim(),
      last4: cLast4.trim() || undefined,
      network: cNetwork,
      status: cIsLtf ? 'ltf' : cStatus,
      pointsCurrency: cPointsCurrency.trim() || 'Reward Points',
      pointsBalance: Math.max(0, Number(cPointsBalance) || 0),
      pointValueINR: Math.max(0, Number(cPointValue) || 0),
      expiryPolicy: cExpiryPolicy,
      pointsExpiryDate: cExpiryPolicy === 'fixed_date' ? cExpiryDate || undefined : undefined,
      rollingInactivityMonths:
        cExpiryPolicy === 'rolling_months' ? Math.max(1, Number(cRollingMonths) || 36) : undefined,
      lastActivityDate: cExpiryPolicy === 'rolling_months' ? cLastActivity || todayIso() : undefined,
      renewalDate: cRenewalDate || undefined,
      annualFeeINR: cIsLtf ? 0 : Math.max(0, Number(cAnnualFee) || 0),
      gstIncludedInFee: cGstIncluded,
      isLifetimeFree: cIsLtf,
      feeWaiverSpendINR: Number(cFeeWaiverSpend) > 0 ? Number(cFeeWaiverSpend) : undefined,
      currentYearSpendINR: Number(cCurrentSpend) > 0 ? Number(cCurrentSpend) : undefined,
      renewalBenefitValueINR: Number(cRenewalBenefitVal) > 0 ? Number(cRenewalBenefitVal) : undefined,
      renewalBenefitNote: cRenewalBenefitNote.trim() || undefined,
      milestoneTargetINR: Number(cMilestoneTarget) > 0 ? Number(cMilestoneTarget) : undefined,
      milestoneRewardNote: cMilestoneNote.trim() || undefined,
      transferCapUsed: Number(cTransferCapUsed) > 0 ? Number(cTransferCapUsed) : undefined,
      transferCapLimit: Number(cTransferCapLimit) > 0 ? Number(cTransferCapLimit) : undefined,
      transferCapNote: cTransferCapNote.trim() || undefined,
      statementDay: Number(cStatementDay) > 0 ? Number(cStatementDay) : undefined,
      dueDay: Number(cDueDay) > 0 ? Number(cDueDay) : undefined,
      creditLimitINR: Number(cCreditLimit) > 0 ? Number(cCreditLimit) : undefined,
      loungeNotes: cLoungeNotes.trim() || undefined,
      notes: cNotes.trim() || undefined,
      updatedAt: Date.now()
    };

    const nextCards = editingCardId
      ? bundle.creditCards.map((c) => (c.id === editingCardId ? cardObj : c))
      : [...bundle.creditCards, cardObj];

    await persistPatch({ creditCards: nextCards }, `${editingCardId ? 'Updated' : 'Added'} ${cardObj.cardName}`);
    setShowCardForm(false);
    setEditingCardId(null);
  };

  // --- Loyalty Program Form Helpers ---
  const applyProgramPreset = (presetKey: string) => {
    const preset = LOYALTY_PROGRAM_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    setPCategory(preset.category);
    setPName(preset.programName);
    setPPointValue(String(preset.pointValueINR));
    setPExpiryPolicy(preset.expiryPolicy);
    setPRollingMonths(preset.rollingInactivityMonths ? String(preset.rollingInactivityMonths) : '24');
    setPTier(preset.defaultTier || '');
    setPNotes(preset.notes || '');
  };

  const openProgramEditor = (prog?: LoyaltyProgramAccount) => {
    if (prog) {
      setEditingProgramId(prog.id);
      setPOwnerId(prog.ownerId || defaultOwnerId);
      setPCategory(prog.category);
      setPName(prog.programName);
      setPMemberNo(prog.membershipNumber || '');
      setPTier(prog.eliteTier || '');
      setPBalance(String(prog.pointsBalance || ''));
      setPPointValue(String(prog.pointValueINR ?? 0.7));
      setPExpiryPolicy(prog.expiryPolicy || 'rolling_months');
      setPExpiryDate(prog.expiryDate || '');
      setPRollingMonths(prog.rollingInactivityMonths ? String(prog.rollingInactivityMonths) : '24');
      setPLastActivity(prog.lastActivityDate || todayIso());
      setPNotes(prog.notes || '');
    } else {
      setEditingProgramId(null);
      setPOwnerId(ownerFilter !== 'all' ? ownerFilter : defaultOwnerId || members[0]?.id || '');
      setPCategory('hotel');
      setPName('');
      setPMemberNo('');
      setPTier('');
      setPBalance('');
      setPPointValue('0.7');
      setPExpiryPolicy('rolling_months');
      setPExpiryDate('');
      setPRollingMonths('24');
      setPLastActivity(todayIso());
      setPNotes('');
    }
    setShowProgramForm(true);
    setSubTab('loyalty');
  };

  const handleSaveProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim()) {
      setErrorMsg('Please enter a hotel or airline program name.');
      return;
    }
    const existing = editingProgramId
      ? bundle.loyaltyPrograms.find((p) => p.id === editingProgramId)
      : undefined;

    const progObj: LoyaltyProgramAccount = {
      id: editingProgramId || `lp_${Date.now()}`,
      householdId,
      ownerId: pOwnerId || defaultOwnerId || members[0]?.id || '',
      category: pCategory,
      programName: pName.trim(),
      membershipNumber: pMemberNo.trim() || undefined,
      eliteTier: pTier.trim() || undefined,
      pointsBalance: Math.max(0, Number(pBalance) || 0),
      pointValueINR: Math.max(0, Number(pPointValue) || 0),
      expiryPolicy: pExpiryPolicy,
      expiryDate: pExpiryPolicy === 'fixed_date' ? pExpiryDate || undefined : undefined,
      rollingInactivityMonths:
        pExpiryPolicy === 'rolling_months' ? Math.max(1, Number(pRollingMonths) || 24) : undefined,
      lastActivityDate: pExpiryPolicy === 'rolling_months' ? pLastActivity || todayIso() : undefined,
      vouchers: existing?.vouchers || [],
      notes: pNotes.trim() || undefined,
      updatedAt: Date.now()
    };

    const nextProgs = editingProgramId
      ? bundle.loyaltyPrograms.map((p) => (p.id === editingProgramId ? progObj : p))
      : [...bundle.loyaltyPrograms, progObj];

    await persistPatch(
      { loyaltyPrograms: nextProgs },
      `${editingProgramId ? 'Updated' : 'Added'} ${progObj.programName}`
    );
    setShowProgramForm(false);
    setEditingProgramId(null);
  };

  // --- Sorted & Filtered Lists ---
  const visibleCards = useMemo(() => {
    const q = cardSearch.trim().toLowerCase();
    const list = filteredBundle.creditCards.filter((c) => {
      if (!q) return true;
      return `${c.cardName} ${c.bank} ${c.pointsCurrency} ${c.last4 || ''} ${c.notes || ''}`
        .toLowerCase()
        .includes(q);
    });
    return [...list].sort((a, b) => {
      if (cardSort === 'valueDesc') {
        return b.pointsBalance * b.pointValueINR - a.pointsBalance * a.pointValueINR;
      }
      if (cardSort === 'pointsDesc') return b.pointsBalance - a.pointsBalance;
      if (cardSort === 'feeDesc') return computeCardFeeWithGstINR(b) - computeCardFeeWithGstINR(a);
      // renewalAsc
      const da = daysUntilIso(a.renewalDate) ?? 9999;
      const db = daysUntilIso(b.renewalDate) ?? 9999;
      return da - db;
    });
  }, [filteredBundle.creditCards, cardSearch, cardSort]);

  const visiblePrograms = useMemo(() => {
    return filteredBundle.loyaltyPrograms
      .filter((p) => loyaltyCatFilter === 'all' || p.category === loyaltyCatFilter)
      .sort((a, b) => b.pointsBalance * b.pointValueINR - a.pointsBalance * a.pointValueINR);
  }, [filteredBundle.loyaltyPrograms, loyaltyCatFilter]);

  // --- Transfer Preview ---
  const selectedFromCard = bundle.creditCards.find((c) => c.id === txFromCardId) || null;
  const selectedToProg = bundle.loyaltyPrograms.find((p) => p.id === txToProgId) || null;
  const txPtsOutNum = Math.max(0, Number(txPointsOut) || 0);
  const txFromR = Math.max(0.01, Number(txFromRatio) || 1);
  const txToR = Math.max(0.01, Number(txToRatio) || 1);
  const txPtsInNum = Math.round((txPtsOutNum * txToR) / txFromR);
  const txBeforeValINR = selectedFromCard ? Math.round(txPtsOutNum * selectedFromCard.pointValueINR) : 0;
  const txAfterValINR = selectedToProg ? Math.round(txPtsInNum * selectedToProg.pointValueINR) : 0;

  const handleExecuteTransfer = async () => {
    if (!selectedFromCard || !selectedToProg || txPtsOutNum <= 0) return;
    if (txPtsOutNum > selectedFromCard.pointsBalance) {
      setErrorMsg(`Transfer amount exceeds ${selectedFromCard.cardName} balance.`);
      return;
    }
    const today = todayIso();
    const nextCards = bundle.creditCards.map((c) =>
      c.id === selectedFromCard.id
        ? {
            ...c,
            pointsBalance: Math.max(0, c.pointsBalance - txPtsOutNum),
            transferCapUsed: (c.transferCapUsed || 0) + txPtsOutNum,
            lastActivityDate: today,
            updatedAt: Date.now()
          }
        : c
    );
    const nextProgs = bundle.loyaltyPrograms.map((p) =>
      p.id === selectedToProg.id
        ? {
            ...p,
            pointsBalance: p.pointsBalance + txPtsInNum,
            lastActivityDate: today,
            updatedAt: Date.now()
          }
        : p
    );
    const entry: PointsActivityEntry = {
      id: `act_${Date.now()}`,
      date: today,
      type: 'transfer',
      fromAccountId: selectedFromCard.id,
      fromLabel: selectedFromCard.cardName,
      toAccountId: selectedToProg.id,
      toLabel: selectedToProg.programName,
      pointsOut: txPtsOutNum,
      pointsIn: txPtsInNum,
      ratioLabel: `${txFromRatio}:${txToRatio}`,
      estimatedValueINR: txAfterValINR,
      notes: txNote.trim() || undefined
    };
    await persistPatch(
      {
        creditCards: nextCards,
        loyaltyPrograms: nextProgs,
        activities: [entry, ...(bundle.activities || [])]
      },
      `Transferred ${txPtsOutNum.toLocaleString('en-IN')} pts → ${txPtsInNum.toLocaleString('en-IN')} ${selectedToProg.programName}!`
    );
    setTxPointsOut('');
    setTxNote('');
  };

  const handleSyncRealEstateCard = async (methodName: string, totalPoints: number) => {
    const match = bundle.creditCards.find(
      (c) =>
        c.cardName.toLowerCase().includes(methodName.toLowerCase()) ||
        methodName.toLowerCase().includes(c.cardName.toLowerCase())
    );
    const today = todayIso();
    if (match) {
      const nextCards = bundle.creditCards.map((c) =>
        c.id === match.id
          ? { ...c, pointsBalance: c.pointsBalance + totalPoints, lastActivityDate: today, updatedAt: Date.now() }
          : c
      );
      const entry: PointsActivityEntry = {
        id: `act_re_${Date.now()}`,
        date: today,
        type: 'real_estate_sync',
        toAccountId: match.id,
        toLabel: match.cardName,
        pointsIn: totalPoints,
        estimatedValueINR: Math.round(totalPoints * match.pointValueINR),
        notes: `Synced from Real Estate swipes (${methodName})`
      };
      await persistPatch(
        { creditCards: nextCards, activities: [entry, ...(bundle.activities || [])] },
        `Added ${Math.round(totalPoints).toLocaleString('en-IN')} Real Estate swipe pts to ${match.cardName}!`
      );
    } else {
      // Create a new card from matching preset or generic
      const preset = INDIAN_CARD_PRESETS.find((p) =>
        p.cardName.toLowerCase().includes(methodName.toLowerCase())
      );
      const created: CreditCardAccount = {
        id: `cc_re_${Date.now()}`,
        householdId,
        ownerId: defaultOwnerId || members[0]?.id || '',
        bank: preset?.bank || 'Bank',
        cardName: preset?.cardName || methodName,
        network: preset?.network || 'Visa',
        status: preset?.isLifetimeFree ? 'ltf' : 'active',
        pointsCurrency: preset?.pointsCurrency || 'Reward Points',
        pointsBalance: Math.round(totalPoints),
        pointValueINR: preset?.pointValueINR ?? 0.8,
        expiryPolicy: preset?.expiryPolicy || 'rolling_months',
        rollingInactivityMonths: preset?.rollingInactivityMonths || 36,
        lastActivityDate: today,
        annualFeeINR: preset?.annualFeeINR || 0,
        isLifetimeFree: preset?.isLifetimeFree,
        feeWaiverSpendINR: preset?.feeWaiverSpendINR,
        renewalBenefitValueINR: preset?.renewalBenefitValueINR,
        renewalBenefitNote: preset?.renewalBenefitNote,
        milestoneTargetINR: preset?.milestoneTargetINR,
        milestoneRewardNote: preset?.milestoneRewardNote,
        transferCapLimit: preset?.transferCapLimit,
        transferCapNote: preset?.transferCapNote,
        loungeNotes: preset?.loungeNotes,
        updatedAt: Date.now()
      };
      await persistPatch(
        { creditCards: [...bundle.creditCards, created] },
        `Created ${created.cardName} with ${Math.round(totalPoints).toLocaleString('en-IN')} pts from Real Estate!`
      );
    }
  };

  const totalBarDenom = Math.max(1, summary.totalRewardsWealthINR);

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Cards &amp; Miles Hub</h2>
            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold">
              {summary.activeCardsCount} Cards • {summary.programsCount} Programs
            </span>
            <span className="text-[11px] text-slate-400 font-semibold hidden md:inline">
              • Isolated from Financial Net Worth &amp; Rebalance
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Track credit card points, renewal fees &amp; waivers, hotel/airline miles (Marriott, Accor, Avios, KrisFlyer), and expiry dates.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {members.length > 1 && (
            <select
              aria-label="Filter cards and miles by family member"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700"
            >
              <option value="all">All Family</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => openCardEditor()}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus size={13} /> Add Card
          </button>
          <button
            type="button"
            onClick={() => openProgramEditor()}
            className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus size={13} /> Add Hotel / Airline
          </button>
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

      {/* 4 Compact KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            Total Rewards Wealth
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-700 mt-1 tabular-nums">
            {formatCompactINR(summary.totalRewardsWealthINR)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Cards {formatCompactINR(summary.cardPointsValueINR)} • Travel {formatCompactINR(summary.hotelPointsValueINR + summary.airlineMilesValueINR)}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            Annual Fees (incl. GST)
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tabular-nums">
            {formatExactINR(summary.totalEffectiveFeesAfterWaiversINR)}
          </div>
          <div
            className={`text-[11px] font-semibold mt-1 ${
              summary.netAnnualCarryINR >= 0 ? 'text-emerald-600' : 'text-slate-500'
            }`}
          >
            Renewal perks: {formatExactINR(summary.totalRenewalBenefitsINR)} (Net{' '}
            {summary.netAnnualCarryINR >= 0 ? '+' : ''}
            {formatCompactINR(summary.netAnnualCarryINR)})
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            Expiring Soon (≤60d)
          </div>
          <div
            className={`text-xl sm:text-2xl font-black mt-1 tabular-nums ${
              summary.expiringSoonCount > 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {summary.expiringSoonCount > 0 ? formatCompactINR(summary.expiringSoonValueINR) : '₹0'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {summary.expiringSoonCount > 0
              ? `${summary.expiringSoonCount} account/voucher alert(s)`
              : 'All points & vouchers safe'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
            Renewals Due (≤45d)
          </div>
          <div
            className={`text-xl sm:text-2xl font-black mt-1 tabular-nums ${
              summary.renewingSoonCount > 0 ? 'text-amber-600' : 'text-slate-900'
            }`}
          >
            {summary.renewingSoonCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {summary.vouchersValueINR > 0
              ? `+ ${formatCompactINR(summary.vouchersValueINR)} active vouchers`
              : `${summary.activeCardsCount} active card(s) tracked`}
          </div>
        </div>
      </div>

      {/* Sub-Navigation Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(
          [
            { id: 'overview', label: `Overview & Alerts${summary.alerts.length ? ` (${summary.alerts.length})` : ''}` },
            { id: 'cards', label: `Credit Cards (${filteredBundle.creditCards.length})` },
            { id: 'loyalty', label: `Hotels & Airlines (${filteredBundle.loyaltyPrograms.length})` },
            { id: 'transfers', label: 'Transfers & Real Estate Sync' }
          ] as { id: RewardsSubTab; label: string }[]
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
          {/* Empty Quick-Start */}
          {bundle.creditCards.length === 0 && bundle.loyaltyPrograms.length === 0 && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Quick-Start Your Cards &amp; Miles Vault</h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Add your 10–15 credit cards and hotel/airline accounts in seconds using pre-filled Indian card &amp; global loyalty templates (Axis Magnus Burgundy, Atlas, Infinia, DCB, Amex Plat Travel, Marriott Bonvoy, Accor ALL, KrisFlyer, Avios).
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openCardEditor()}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <CreditCard size={14} /> Add First Credit Card
                </button>
                <button
                  type="button"
                  onClick={() => openProgramEditor()}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plane size={14} /> Add Marriott / Accor / Airline
                </button>
                {realEstateCardPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubTab('transfers')}
                    className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <RefreshCcw size={14} /> Import {realEstateCardPoints.length} Card(s) from Real Estate Swipes
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Rewards Ecosystem Bar */}
          {summary.totalRewardsWealthINR > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                  Rewards Wealth Breakdown ({formatCompactINR(summary.totalRewardsWealthINR)})
                </h3>
              </div>
              <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
                <div
                  className="bg-indigo-500 h-full"
                  style={{ width: `${(summary.cardPointsValueINR / totalBarDenom) * 100}%` }}
                  title={`Credit Card Points: ${formatExactINR(summary.cardPointsValueINR)}`}
                />
                <div
                  className="bg-emerald-500 h-full"
                  style={{ width: `${(summary.hotelPointsValueINR / totalBarDenom) * 100}%` }}
                  title={`Hotel Points: ${formatExactINR(summary.hotelPointsValueINR)}`}
                />
                <div
                  className="bg-sky-500 h-full"
                  style={{ width: `${(summary.airlineMilesValueINR / totalBarDenom) * 100}%` }}
                  title={`Airline Miles: ${formatExactINR(summary.airlineMilesValueINR)}`}
                />
                <div
                  className="bg-amber-400 h-full"
                  style={{ width: `${(summary.vouchersValueINR / totalBarDenom) * 100}%` }}
                  title={`Free Nights & Vouchers: ${formatExactINR(summary.vouchersValueINR)}`}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100 flex items-center justify-between">
                  <span className="font-bold text-indigo-900">Card Points</span>
                  <span className="font-mono font-black text-indigo-700">{formatCompactINR(summary.cardPointsValueINR)}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
                  <span className="font-bold text-emerald-900">Hotels</span>
                  <span className="font-mono font-black text-emerald-700">{formatCompactINR(summary.hotelPointsValueINR)}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-blue-50 border border-indigo-100 flex items-center justify-between">
                  <span className="font-bold text-blue-800">Airlines</span>
                  <span className="font-mono font-black text-blue-700">{formatCompactINR(summary.airlineMilesValueINR)}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between">
                  <span className="font-bold text-amber-900">Vouchers</span>
                  <span className="font-mono font-black text-amber-700">{formatCompactINR(summary.vouchersValueINR)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Actionable Expiry & Renewal Alerts */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-500" /> Actionable Expiry, Renewal &amp; Fee-Waiver Alerts
            </h3>
            {summary.alerts.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No urgent points expiries (≤60d) or card renewals (≤45d) right now. Add renewal &amp; expiry dates on your cards/programs to receive proactive Bell alerts.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {summary.alerts.map((al) => (
                  <div
                    key={al.id}
                    className={`p-3.5 rounded-xl border space-y-1 ${
                      al.severity === 'warning'
                        ? 'bg-rose-50/70 border-rose-200'
                        : al.severity === 'success'
                        ? 'bg-emerald-50/70 border-emerald-200'
                        : 'bg-amber-50/70 border-amber-200'
                    }`}
                  >
                    <div className="text-xs font-black text-slate-900">{al.title}</div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{al.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= SUB-TAB 2: CREDIT CARDS ================= */}
      {subTab === 'cards' && (
        <div className="space-y-4">
          {/* Add / Edit Credit Card Form */}
          {showCardForm && (
            <form
              onSubmit={handleSaveCard}
              className="bg-white p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-xs font-black text-indigo-700 uppercase tracking-wider">
                  {editingCardId ? 'Edit Credit Card' : 'Add Credit Card (Pick a 1-Click Preset or Custom)'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowCardForm(false);
                    setEditingCardId(null);
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={16} />
                </button>
              </div>

              {!editingCardId && (
                <div className="flex flex-wrap gap-1.5">
                  {INDIAN_CARD_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyCardPreset(p.key)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        cName === p.cardName
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-300'
                      }`}
                    >
                      {p.cardName}
                    </button>
                  ))}
                </div>
              )}

              {/* Row 1: Identity */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Card Name *</label>
                  <input
                    type="text"
                    required
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    placeholder="e.g. Axis Magnus Burgundy"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bank</label>
                  <input
                    type="text"
                    value={cBank}
                    onChange={(e) => setCBank(e.target.value)}
                    placeholder="Axis Bank"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Owner</label>
                  <select
                    aria-label="Card owner"
                    value={cOwnerId}
                    onChange={(e) => setCOwnerId(e.target.value)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Network</label>
                  <select
                    aria-label="Card network"
                    value={cNetwork}
                    onChange={(e) => setCNetwork(e.target.value as CardNetwork)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    {(['Visa', 'Mastercard', 'Amex', 'Diners', 'RuPay'] as CardNetwork[]).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Last 4 Digits</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={cLast4}
                    onChange={(e) => setCLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4821"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              {/* Row 2: Points & Expiry */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Points Currency</label>
                  <input
                    type="text"
                    value={cPointsCurrency}
                    onChange={(e) => setCPointsCurrency(e.target.value)}
                    placeholder="Edge Rewards"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Points Balance</label>
                  <input
                    type="number"
                    value={cPointsBalance}
                    onChange={(e) => setCPointsBalance(e.target.value)}
                    placeholder="125000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Value (₹ / pt)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={cPointValue}
                    onChange={(e) => setCPointValue(e.target.value)}
                    placeholder="1.0"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Expiry Rule</label>
                  <select
                    aria-label="Points expiry rule"
                    value={cExpiryPolicy}
                    onChange={(e) => setCExpiryPolicy(e.target.value as PointsExpiryPolicy)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    <option value="rolling_months">Rolling Months</option>
                    <option value="fixed_date">Fixed Expiry Date</option>
                    <option value="never">Never Expires</option>
                  </select>
                </div>
                {cExpiryPolicy === 'fixed_date' ? (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Points Expiry Date</label>
                    <input
                      type="date"
                      value={cExpiryDate}
                      onChange={(e) => setCExpiryDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                ) : cExpiryPolicy === 'rolling_months' ? (
                  <>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Expiry (Months)</label>
                      <input
                        type="number"
                        value={cRollingMonths}
                        onChange={(e) => setCRollingMonths(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Last Activity</label>
                      <input
                        type="date"
                        value={cLastActivity}
                        onChange={(e) => setCLastActivity(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  </>
                ) : null}
              </div>

              {/* Row 3: Renewal Fee, Waiver & Milestones */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Next Renewal Date</label>
                  <input
                    type="date"
                    value={cRenewalDate}
                    onChange={(e) => setCRenewalDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Annual Fee (₹)</label>
                  <input
                    type="number"
                    disabled={cIsLtf}
                    value={cIsLtf ? '0' : cAnnualFee}
                    onChange={(e) => setCAnnualFee(e.target.value)}
                    placeholder="12500"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono disabled:opacity-50"
                  />
                </div>
                <div className="flex flex-col gap-1.5 pb-1">
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cIsLtf}
                      onChange={(e) => setCIsLtf(e.target.checked)}
                      className="rounded accent-emerald-600"
                    />
                    Lifetime Free (LTF)
                  </label>
                  {!cIsLtf && (
                    <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cGstIncluded}
                        onChange={(e) => setCGstIncluded(e.target.checked)}
                        className="rounded accent-indigo-600"
                      />
                      18% GST already incl.
                    </label>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Fee Waiver Spend (₹)</label>
                  <input
                    type="number"
                    value={cFeeWaiverSpend}
                    onChange={(e) => setCFeeWaiverSpend(e.target.value)}
                    placeholder="1000000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">YTD Card Spend (₹)</label>
                  <input
                    type="number"
                    value={cCurrentSpend}
                    onChange={(e) => setCCurrentSpend(e.target.value)}
                    placeholder="650000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Renewal Benefit (₹)</label>
                  <input
                    type="number"
                    value={cRenewalBenefitVal}
                    onChange={(e) => setCRenewalBenefitVal(e.target.value)}
                    placeholder="12500"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              {/* Row 4: Optional Milestones, Transfer Cap & Billing */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Milestone Spend (₹)</label>
                  <input
                    type="number"
                    value={cMilestoneTarget}
                    onChange={(e) => setCMilestoneTarget(e.target.value)}
                    placeholder="400000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Transfer Cap Limit</label>
                  <input
                    type="number"
                    value={cTransferCapLimit}
                    onChange={(e) => setCTransferCapLimit(e.target.value)}
                    placeholder="30000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Transfer Cap Used</label>
                  <input
                    type="number"
                    value={cTransferCapUsed}
                    onChange={(e) => setCTransferCapUsed(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Credit Limit (₹)</label>
                  <input
                    type="number"
                    value={cCreditLimit}
                    onChange={(e) => setCCreditLimit(e.target.value)}
                    placeholder="1500000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bill Day (1-31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={cStatementDay}
                    onChange={(e) => setCStatementDay(e.target.value)}
                    placeholder="15"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Status</label>
                  <select
                    aria-label="Card status"
                    value={cIsLtf ? 'ltf' : cStatus}
                    onChange={(e) => {
                      const st = e.target.value as CardStatus;
                      setCStatus(st);
                      setCIsLtf(st === 'ltf');
                    }}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    <option value="active">Active (Paid)</option>
                    <option value="ltf">Lifetime Free</option>
                    <option value="downgrade_watch">Review / Downgrade</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={cRenewalBenefitNote}
                  onChange={(e) => setCRenewalBenefitNote(e.target.value)}
                  placeholder="Renewal perk / milestone note (e.g. 12.5k RP on renewal, Taj ₹10k voucher)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
                <input
                  type="text"
                  value={cLoungeNotes}
                  onChange={(e) => setCLoungeNotes(e.target.value)}
                  placeholder="Lounge / transfer cap / general notes"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCardForm(false);
                    setEditingCardId(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                >
                  {editingCardId ? 'Update Card' : 'Save Credit Card'}
                </button>
              </div>
            </form>
          )}

          {/* Search & Sort Toolbar */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                placeholder="Search 10–15 cards by name, bank, points currency..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Sort credit cards"
                value={cardSort}
                onChange={(e) => setCardSort(e.target.value as CardSortKey)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
              >
                <option value="valueDesc">Sort: Points Value (₹)</option>
                <option value="renewalAsc">Sort: Next Renewal Date</option>
                <option value="pointsDesc">Sort: Points Balance</option>
                <option value="feeDesc">Sort: Annual Fee</option>
              </select>
            </div>
          </div>

          {/* Cards List */}
          {visibleCards.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
              No credit cards tracked yet. Click <strong>+ Add Card</strong> above to pick from 1-click Indian presets.
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleCards.map((c) => {
                const isExp = Boolean(expandedCards[c.id]);
                const valINR = Math.round((c.pointsBalance || 0) * (c.pointValueINR || 0));
                const feeGst = computeCardFeeWithGstINR(c);
                const waived = isCardFeeWaived(c);
                const renewDays = daysUntilIso(c.renewalDate);
                const exp = resolveEffectiveExpiryDate({
                  expiryPolicy: c.expiryPolicy,
                  fixedExpiryDate: c.pointsExpiryDate,
                  lastActivityDate: c.lastActivityDate,
                  rollingInactivityMonths: c.rollingInactivityMonths
                });
                const waiverPct =
                  c.feeWaiverSpendINR && c.feeWaiverSpendINR > 0
                    ? Math.min(100, Math.round(((c.currentYearSpendINR || 0) / c.feeWaiverSpendINR) * 100))
                    : 0;
                const milestonePct =
                  c.milestoneTargetINR && c.milestoneTargetINR > 0
                    ? Math.min(100, Math.round(((c.currentYearSpendINR || 0) / c.milestoneTargetINR) * 100))
                    : 0;

                return (
                  <div
                    key={c.id}
                    className={`bg-white rounded-2xl border shadow-2xs overflow-hidden ${
                      c.status === 'closed' ? 'border-slate-200 opacity-65' : 'border-slate-200'
                    }`}
                  >
                    <div
                      onClick={() => setExpandedCards((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                      className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{c.cardName}</span>
                          {c.last4 && (
                            <span className="font-mono text-[10px] text-slate-400">•••• {c.last4}</span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {c.bank}
                          </span>
                          {members.length > 1 && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                              {memberName(c.ownerId)}
                            </span>
                          )}
                          {c.isLifetimeFree || c.status === 'ltf' ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase">
                              LTF
                            </span>
                          ) : waived ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase">
                              Fee Waived
                            </span>
                          ) : renewDays !== null && renewDays <= 45 ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black">
                              Renews {renewDays < 0 ? 'Overdue' : `in ${renewDays}d`}
                            </span>
                          ) : null}
                          {exp.daysRemaining !== null && exp.daysRemaining <= 60 && c.pointsBalance > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black">
                              Pts Expire {exp.daysRemaining < 0 ? 'Past' : `in ${exp.daysRemaining}d`}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-3">
                          <span>
                            Fee:{' '}
                            <strong className="text-slate-800">
                              {c.isLifetimeFree || c.status === 'ltf' ? '₹0 (LTF)' : formatExactINR(feeGst)}
                            </strong>
                            {c.renewalDate && <span className="ml-1 font-mono">({c.renewalDate})</span>}
                          </span>
                          {exp.effectiveDate && (
                            <span>
                              Expiry: <strong className="font-mono text-slate-700">{exp.effectiveDate}</strong>
                            </span>
                          )}
                          {c.transferCapLimit ? (
                            <span>
                              Cap:{' '}
                              <strong className="font-mono text-indigo-700">
                                {(c.transferCapUsed || 0).toLocaleString('en-IN')}/
                                {c.transferCapLimit.toLocaleString('en-IN')}
                              </strong>
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                        {quickEditCardId === c.id ? (
                          <div
                            className="flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="number"
                              autoFocus
                              value={quickCardPoints}
                              onChange={(e) => setQuickCardPoints(e.target.value)}
                              className="w-28 px-2 py-1 bg-slate-50 border border-indigo-300 rounded-lg text-xs font-mono font-bold text-right"
                            />
                            <button
                              type="button"
                              aria-label="Save quick points balance"
                              onClick={async () => {
                                const nextPts = Math.max(0, Number(quickCardPoints) || 0);
                                await persistPatch(
                                  {
                                    creditCards: bundle.creditCards.map((item) =>
                                      item.id === c.id
                                        ? {
                                            ...item,
                                            pointsBalance: nextPts,
                                            lastActivityDate: todayIso(),
                                            updatedAt: Date.now()
                                          }
                                        : item
                                    )
                                  },
                                  `Updated ${c.cardName} points`
                                );
                                setQuickEditCardId(null);
                              }}
                              className="p-1.5 rounded-lg bg-emerald-600 text-white"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel quick points edit"
                              onClick={() => setQuickEditCardId(null)}
                              className="p-1.5 rounded-lg bg-slate-100 text-slate-500"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-right">
                            <div className="text-sm font-black text-slate-900 font-mono">
                              {Math.round(c.pointsBalance).toLocaleString('en-IN')}{' '}
                              <span className="text-[10px] font-sans font-bold text-slate-400">
                                {c.pointsCurrency}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-emerald-700 font-mono">
                              ≈ {formatCompactINR(valINR)}{' '}
                              <span className="text-[10px] text-slate-400 font-normal">(@ ₹{c.pointValueINR})</span>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            title="Quick update points"
                            aria-label={`Quick edit points for ${c.cardName}`}
                            onClick={() => {
                              setQuickEditCardId(c.id);
                              setQuickCardPoints(String(c.pointsBalance || 0));
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedCards((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                            className="p-1 text-slate-400"
                            aria-label="Toggle card details"
                          >
                            {isExp ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExp && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4 space-y-3 text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {c.feeWaiverSpendINR ? (
                            <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5">
                              <div className="flex justify-between text-[11px] font-bold">
                                <span className="text-slate-600">Fee Waiver Progress</span>
                                <span className={waived ? 'text-emerald-600' : 'text-indigo-600'}>
                                  {waiverPct}%
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={`h-full ${waived ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                  style={{ width: `${waiverPct}%` }}
                                />
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatCompactINR(c.currentYearSpendINR || 0)} / {formatCompactINR(c.feeWaiverSpendINR)}
                              </div>
                            </div>
                          ) : null}

                          {c.milestoneTargetINR ? (
                            <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5">
                              <div className="flex justify-between text-[11px] font-bold">
                                <span className="text-slate-600">Milestone Progress</span>
                                <span className="text-emerald-700">{milestonePct}%</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${milestonePct}%` }} />
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {c.milestoneRewardNote || `Target ${formatCompactINR(c.milestoneTargetINR)}`}
                              </div>
                            </div>
                          ) : null}

                          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase">Perks &amp; Billing</div>
                            {c.renewalBenefitNote && (
                              <div className="text-[11px] text-slate-700">{c.renewalBenefitNote}</div>
                            )}
                            {c.loungeNotes && (
                              <div className="text-[11px] text-slate-500">{c.loungeNotes}</div>
                            )}
                            {(c.creditLimitINR || c.statementDay) && (
                              <div className="text-[11px] text-slate-500 font-mono">
                                {c.creditLimitINR ? `Limit ${formatCompactINR(c.creditLimitINR)}` : ''}
                                {c.statementDay ? ` • Bill Day ${c.statementDay}` : ''}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openCardEditor(c)}
                              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-indigo-700 font-bold text-[11px]"
                            >
                              Edit Full Card Details
                            </button>
                            {c.expiryPolicy === 'rolling_months' && (
                              <button
                                type="button"
                                onClick={() =>
                                  persistPatch(
                                    {
                                      creditCards: bundle.creditCards.map((item) =>
                                        item.id === c.id
                                          ? { ...item, lastActivityDate: todayIso(), updatedAt: Date.now() }
                                          : item
                                      )
                                    },
                                    `Reset rolling expiry clock for ${c.cardName}`
                                  )
                                }
                                className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[11px]"
                              >
                                Reset Expiry Clock (Activity Today)
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              persistPatch(
                                { creditCards: bundle.creditCards.filter((item) => item.id !== c.id) },
                                `Removed ${c.cardName}`
                              )
                            }
                            className="text-[11px] font-bold text-rose-500 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash size={12} /> Remove Card
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= SUB-TAB 3: HOTELS & AIRLINES ================= */}
      {subTab === 'loyalty' && (
        <div className="space-y-4">
          {showProgramForm && (
            <form
              onSubmit={handleSaveProgram}
              className="bg-white p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-xs font-black text-indigo-700 uppercase tracking-wider">
                  {editingProgramId ? 'Edit Loyalty Program' : 'Add Hotel or Airline Program (1-Click Presets)'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowProgramForm(false);
                    setEditingProgramId(null);
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={16} />
                </button>
              </div>

              {!editingProgramId && (
                <div className="flex flex-wrap gap-1.5">
                  {LOYALTY_PROGRAM_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyProgramPreset(p.key)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        pName === p.programName
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-300'
                      }`}
                    >
                      {p.category === 'hotel' ? '🏨 ' : '✈️ '}
                      {p.programName}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Program Name *</label>
                  <input
                    type="text"
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="e.g. Marriott Bonvoy"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Category</label>
                  <select
                    aria-label="Program category"
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value as any)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    <option value="hotel">Hotel</option>
                    <option value="airline">Airline</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Owner</label>
                  <select
                    aria-label="Program owner"
                    value={pOwnerId}
                    onChange={(e) => setPOwnerId(e.target.value)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Elite Tier</label>
                  <input
                    type="text"
                    value={pTier}
                    onChange={(e) => setPTier(e.target.value)}
                    placeholder="Gold Elite"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Member #</label>
                  <input
                    type="text"
                    value={pMemberNo}
                    onChange={(e) => setPMemberNo(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Points / Miles</label>
                  <input
                    type="number"
                    value={pBalance}
                    onChange={(e) => setPBalance(e.target.value)}
                    placeholder="85000"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Value (₹ / pt)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={pPointValue}
                    onChange={(e) => setPPointValue(e.target.value)}
                    placeholder="0.70"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Expiry Policy</label>
                  <select
                    aria-label="Loyalty expiry policy"
                    value={pExpiryPolicy}
                    onChange={(e) => setPExpiryPolicy(e.target.value as PointsExpiryPolicy)}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  >
                    <option value="rolling_months">Rolling Inactivity</option>
                    <option value="fixed_date">Hard Fixed Date</option>
                    <option value="never">Never Expires</option>
                  </select>
                </div>
                {pExpiryPolicy === 'fixed_date' ? (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Hard Expiry Date</label>
                    <input
                      type="date"
                      value={pExpiryDate}
                      onChange={(e) => setPExpiryDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                ) : pExpiryPolicy === 'rolling_months' ? (
                  <>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Inactivity (Mo)</label>
                      <input
                        type="number"
                        value={pRollingMonths}
                        onChange={(e) => setPRollingMonths(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Last Activity</label>
                      <input
                        type="date"
                        value={pLastActivity}
                        onChange={(e) => setPLastActivity(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <input
                type="text"
                value={pNotes}
                onChange={(e) => setPNotes(e.target.value)}
                placeholder="Goal / notes (e.g. Saving 200k Bonvoy for Japan 2027, Accor Plus Stay Plus active)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProgramForm(false);
                    setEditingProgramId(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                >
                  {editingProgramId ? 'Update Program' : 'Save Program'}
                </button>
              </div>
            </form>
          )}

          {/* Category Filter */}
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All Programs' },
                { id: 'hotel', label: 'Hotels (Marriott, Accor, ITC)' },
                { id: 'airline', label: 'Airlines (KrisFlyer, Avios, Air India)' }
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setLoyaltyCatFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  loyaltyCatFilter === f.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {visiblePrograms.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
              No hotel or airline accounts added yet. Click <strong>+ Add Hotel / Airline</strong> above to add Marriott Bonvoy, Accor ALL, KrisFlyer, Avios, and more.
            </div>
          ) : (
            <div className="space-y-3">
              {visiblePrograms.map((p) => {
                const isExp = Boolean(expandedPrograms[p.id]);
                const valINR = Math.round((p.pointsBalance || 0) * (p.pointValueINR || 0));
                const activeVouchers = (p.vouchers || []).filter((v) => !v.used);
                const exp = resolveEffectiveExpiryDate({
                  expiryPolicy: p.expiryPolicy,
                  fixedExpiryDate: p.expiryDate,
                  lastActivityDate: p.lastActivityDate,
                  rollingInactivityMonths: p.rollingInactivityMonths
                });

                return (
                  <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                    <div
                      onClick={() => setExpandedPrograms((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                            {p.category === 'hotel' ? <Building2 size={14} /> : <Plane size={14} />}
                          </span>
                          <span className="font-bold text-sm text-slate-900">{p.programName}</span>
                          {p.eliteTier && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black">
                              {p.eliteTier}
                            </span>
                          )}
                          {members.length > 1 && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                              {memberName(p.ownerId)}
                            </span>
                          )}
                          {activeVouchers.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-black inline-flex items-center gap-1">
                              <Gift size={10} /> {activeVouchers.length} Voucher(s)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-3">
                          {p.membershipNumber && <span className="font-mono">#{p.membershipNumber}</span>}
                          <span>
                            Expiry:{' '}
                            {p.expiryPolicy === 'never' ? (
                              <strong className="text-emerald-700">Never</strong>
                            ) : exp.effectiveDate ? (
                              <strong
                                className={
                                  exp.daysRemaining !== null && exp.daysRemaining <= 60
                                    ? 'text-rose-600'
                                    : 'text-slate-700'
                                }
                              >
                                {exp.effectiveDate} ({exp.daysRemaining !== null ? `${exp.daysRemaining}d` : ''})
                              </strong>
                            ) : (
                              <span>Set activity date</span>
                            )}
                          </span>
                          {p.notes && <span className="truncate max-w-md">{p.notes}</span>}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                        {quickEditProgId === p.id ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              autoFocus
                              value={quickProgPoints}
                              onChange={(e) => setQuickProgPoints(e.target.value)}
                              className="w-28 px-2 py-1 bg-slate-50 border border-indigo-300 rounded-lg text-xs font-mono font-bold text-right"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                const nextPts = Math.max(0, Number(quickProgPoints) || 0);
                                await persistPatch(
                                  {
                                    loyaltyPrograms: bundle.loyaltyPrograms.map((item) =>
                                      item.id === p.id
                                        ? {
                                            ...item,
                                            pointsBalance: nextPts,
                                            lastActivityDate: todayIso(),
                                            updatedAt: Date.now()
                                          }
                                        : item
                                    )
                                  },
                                  `Updated ${p.programName} balance`
                                );
                                setQuickEditProgId(null);
                              }}
                              className="p-1.5 rounded-lg bg-emerald-600 text-white"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickEditProgId(null)}
                              className="p-1.5 rounded-lg bg-slate-100 text-slate-500"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-right">
                            <div className="text-sm font-black text-slate-900 font-mono">
                              {Math.round(p.pointsBalance).toLocaleString('en-IN')}{' '}
                              <span className="text-[10px] font-sans font-bold text-slate-400">
                                {p.category === 'airline' ? 'miles' : 'pts'}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-emerald-700 font-mono">
                              ≈ {formatCompactINR(valINR)}{' '}
                              <span className="text-[10px] text-slate-400 font-normal">(@ ₹{p.pointValueINR})</span>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            title="Quick update balance"
                            onClick={() => {
                              setQuickEditProgId(p.id);
                              setQuickProgPoints(String(p.pointsBalance || 0));
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedPrograms((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                            className="p-1 text-slate-400"
                          >
                            {isExp ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExp && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4 space-y-3 text-xs">
                        {/* Free Nights & Vouchers */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                              <Gift size={13} className="text-indigo-600" /> Free Night Awards &amp; Vouchers
                            </span>
                            <button
                              type="button"
                              onClick={() => setAddingVoucherFor(addingVoucherFor === p.id ? null : p.id)}
                              className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                            >
                              <Plus size={12} /> Add Free Night / Voucher
                            </button>
                          </div>

                          {addingVoucherFor === p.id && (
                            <div className="p-3 rounded-xl bg-white border border-indigo-200 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                              <div className="col-span-2">
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Voucher Title</label>
                                <input
                                  type="text"
                                  value={vTitle}
                                  onChange={(e) => setVTitle(e.target.value)}
                                  placeholder="e.g. Marriott 35k FNA / Accor Stay Plus"
                                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Est. Value (₹)</label>
                                <input
                                  type="number"
                                  value={vValue}
                                  onChange={(e) => setVValue(e.target.value)}
                                  placeholder="20000"
                                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Expiry Date</label>
                                <input
                                  type="date"
                                  value={vExpiry}
                                  onChange={(e) => setVExpiry(e.target.value)}
                                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!vTitle.trim()) return;
                                  const nv: LoyaltyVoucher = {
                                    id: `vch_${Date.now()}`,
                                    title: vTitle.trim(),
                                    estimatedValueINR: Math.max(0, Number(vValue) || 0),
                                    expiryDate: vExpiry || undefined,
                                    codeOrNote: vNote.trim() || undefined
                                  };
                                  await persistPatch(
                                    {
                                      loyaltyPrograms: bundle.loyaltyPrograms.map((item) =>
                                        item.id === p.id
                                          ? { ...item, vouchers: [...(item.vouchers || []), nv], updatedAt: Date.now() }
                                          : item
                                      )
                                    },
                                    `Added voucher to ${p.programName}`
                                  );
                                  setVTitle('');
                                  setVValue('');
                                  setVExpiry('');
                                  setVNote('');
                                  setAddingVoucherFor(null);
                                }}
                                className="py-1.5 px-3 bg-indigo-600 text-white rounded-lg text-xs font-bold"
                              >
                                Save Voucher
                              </button>
                            </div>
                          )}

                          {(p.vouchers || []).length > 0 && (
                            <div className="space-y-1.5">
                              {p.vouchers.map((v) => (
                                <div
                                  key={v.id}
                                  className={`p-2.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2 ${
                                    v.used ? 'opacity-50 line-through' : ''
                                  }`}
                                >
                                  <div>
                                    <span className="font-bold text-slate-800">{v.title}</span>
                                    {v.expiryDate && (
                                      <span className="ml-2 font-mono text-[11px] text-slate-500">
                                        Exp {v.expiryDate}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-emerald-700">
                                      {formatExactINR(v.estimatedValueINR)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        persistPatch({
                                          loyaltyPrograms: bundle.loyaltyPrograms.map((item) =>
                                            item.id === p.id
                                              ? {
                                                  ...item,
                                                  vouchers: item.vouchers.map((x) =>
                                                    x.id === v.id ? { ...x, used: !x.used } : x
                                                  )
                                                }
                                              : item
                                          )
                                        })
                                      }
                                      className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600"
                                    >
                                      {v.used ? 'Restore' : 'Mark Used'}
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Delete voucher"
                                      onClick={() =>
                                        persistPatch({
                                          loyaltyPrograms: bundle.loyaltyPrograms.map((item) =>
                                            item.id === p.id
                                              ? { ...item, vouchers: item.vouchers.filter((x) => x.id !== v.id) }
                                              : item
                                          )
                                        })
                                      }
                                      className="p-1 text-slate-400 hover:text-rose-500"
                                    >
                                      <Trash size={12} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-200/60">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openProgramEditor(p)}
                              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-indigo-700 font-bold text-[11px]"
                            >
                              Edit Program
                            </button>
                            {p.expiryPolicy === 'rolling_months' && (
                              <button
                                type="button"
                                onClick={() =>
                                  persistPatch(
                                    {
                                      loyaltyPrograms: bundle.loyaltyPrograms.map((item) =>
                                        item.id === p.id
                                          ? { ...item, lastActivityDate: todayIso(), updatedAt: Date.now() }
                                          : item
                                      )
                                    },
                                    `Extended ${p.programName} rolling expiry by ${p.rollingInactivityMonths || 12} months!`
                                  )
                                }
                                className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[11px]"
                              >
                                Reset Rolling Expiry (Activity Today)
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              persistPatch(
                                { loyaltyPrograms: bundle.loyaltyPrograms.filter((item) => item.id !== p.id) },
                                `Removed ${p.programName}`
                              )
                            }
                            className="text-[11px] font-bold text-rose-500 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash size={12} /> Remove Program
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= SUB-TAB 4: TRANSFERS & REAL ESTATE SYNC ================= */}
      {subTab === 'transfers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 1-Click Card -> Hotel/Airline Transfer Calculator */}
          <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowRightLeft size={14} className="text-indigo-600" /> 1-Click Card → Hotel / Airline Transfer
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically deducts card points, updates annual transfer cap usage, credits your hotel/airline balance, and resets rolling inactivity clocks.
              </p>
            </div>

            {bundle.creditCards.length === 0 || bundle.loyaltyPrograms.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                Add at least one <strong>Credit Card</strong> and one <strong>Hotel/Airline Program</strong> first to run 1-click point transfers.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">From Credit Card</label>
                    <select
                      aria-label="Source credit card"
                      value={txFromCardId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setTxFromCardId(id);
                        const card = bundle.creditCards.find((c) => c.id === id);
                        if (card && selectedToProg) {
                          const s = suggestTransferRatio(card.cardName, selectedToProg.programName);
                          setTxFromRatio(String(s.fromRatio));
                          setTxToRatio(String(s.toRatio));
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    >
                      <option value="">Select card...</option>
                      {bundle.creditCards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.cardName} ({Math.round(c.pointsBalance).toLocaleString('en-IN')} {c.pointsCurrency})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">To Hotel / Airline</label>
                    <select
                      aria-label="Destination loyalty program"
                      value={txToProgId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setTxToProgId(id);
                        const prog = bundle.loyaltyPrograms.find((p) => p.id === id);
                        if (selectedFromCard && prog) {
                          const s = suggestTransferRatio(selectedFromCard.cardName, prog.programName);
                          setTxFromRatio(String(s.fromRatio));
                          setTxToRatio(String(s.toRatio));
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    >
                      <option value="">Select program...</option>
                      {bundle.loyaltyPrograms.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.programName} ({Math.round(p.pointsBalance).toLocaleString('en-IN')} pts)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Points to Move</label>
                    <input
                      type="number"
                      value={txPointsOut}
                      onChange={(e) => setTxPointsOut(e.target.value)}
                      placeholder="30000"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ratio From</label>
                    <input
                      type="number"
                      step="0.5"
                      value={txFromRatio}
                      onChange={(e) => setTxFromRatio(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ratio To</label>
                    <input
                      type="number"
                      step="0.5"
                      value={txToRatio}
                      onChange={(e) => setTxToRatio(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                    />
                  </div>
                </div>

                {selectedFromCard && selectedToProg && txPtsOutNum > 0 && (
                  <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-indigo-900">
                        {txPtsOutNum.toLocaleString('en-IN')} {selectedFromCard.pointsCurrency} →{' '}
                        <span className="text-emerald-700 font-black">
                          {txPtsInNum.toLocaleString('en-IN')} {selectedToProg.programName}
                        </span>
                      </span>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        Value: {formatExactINR(txBeforeValINR)} → <strong>{formatExactINR(txAfterValINR)}</strong>{' '}
                        ({txAfterValINR - txBeforeValINR >= 0 ? '+' : ''}
                        {formatExactINR(txAfterValINR - txBeforeValINR)})
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleExecuteTransfer}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shrink-0"
                    >
                      Execute Transfer
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Recent Activity Log */}
            {(bundle.activities || []).length > 0 && (
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  Recent Transfers &amp; Sync Log
                </div>
                <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                  {bundle.activities.slice(0, 10).map((act) => (
                    <div key={act.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-mono text-[10px] text-slate-400 mr-2">{act.date}</span>
                        <span className="font-bold text-slate-800">
                          {act.fromLabel ? `${act.fromLabel} → ` : ''}
                          {act.toLabel}
                        </span>
                        {act.ratioLabel && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono text-slate-600">
                            {act.ratioLabel}
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-emerald-700 shrink-0">
                        +{Math.round(act.pointsIn || 0).toLocaleString('en-IN')} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Real Estate Card Points Sync Bridge */}
          <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Award size={14} className="text-emerald-600" /> Real Estate Swipe Points Bridge
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Points already logged from your Real Estate card swipes. Click <strong>Sync</strong> to add them to a matching card balance.
              </p>
            </div>

            {realEstateCardPoints.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No credit card reward points logged in Real Estate swipes yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {realEstateCardPoints.map((row) => (
                  <div key={row.paymentMethod} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-bold text-slate-800">{row.paymentMethod}</div>
                      <div className="text-[11px] text-slate-500">
                        {Math.round(row.totalPoints).toLocaleString('en-IN')} pts across {row.swipeCount} swipe(s)
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleSyncRealEstateCard(row.paymentMethod, row.totalPoints)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[11px] font-bold shrink-0"
                    >
                      + Sync to Card
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
