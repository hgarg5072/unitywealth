import { RealEstateProperty, RealEstateLoanTx } from '../types';

export interface EnrichedLoanTx extends RealEstateLoanTx {
  runningDisbursedINR: number;
  runningOutstandingINR: number;
  computedPrincipalINR: number;
  computedInterestINR: number;
  cumulativeShortfallINR: number;
}

export interface RealEstateComputedSummary {
  agreementValueINR: number;
  selfPaidINR: number;               // Self-funded capital credited toward property (incl. 1% TDS)
  loanDisbursedINR: number;          // Total loan disbursed so far
  totalPaidToBuilderINR: number;     // selfPaidINR + loanDisbursedINR
  remainingBuilderINR: number;       // agreementValueINR - totalPaidToBuilderINR
  paidProgressPct: number;
  actualSelfRatioPct: number;        // selfPaidINR / totalPaidToBuilderINR * 100
  targetSelfRatioPct: number;        // e.g. 37.93%
  principalRepaidINR: number;        // Cumulative principal paid via EMIs / prepayments
  interestPaidINR: number;           // Cumulative interest paid
  outstandingLoanINR: number;        // loanDisbursedINR - principalRepaidINR
  netPaidInEquityINR: number;        // selfPaidINR + principalRepaidINR (added to Family Net Worth!)
  totalCcFeesINR: number;
  totalPointsEarned: number;
  estimatedPointsValueINR: number;
  netRewardsGainINR: number;
  totalTdsINR: number;
  totalStampDutyINR: number;
  totalEmiPaidINR: number;
  cumulativeShortfallINR: number;    // Positive = behind target EMI schedule; Negative = ahead
  nextRecommendedEmiINR: number;     // targetMonthlyEmi + max(0, cumulativeShortfall)
  enrichedLoanLedger: EnrichedLoanTx[];
}

export function calcStandardEmi(principalINR: number, annualRatePct: number, tenureMonths: number): number {
  if (principalINR <= 0 || tenureMonths <= 0) return 0;
  const r = annualRatePct / 12 / 100;
  if (r <= 0) return Math.round(principalINR / tenureMonths);
  const factor = Math.pow(1 + r, tenureMonths);
  return Math.round((principalINR * r * factor) / (factor - 1));
}

export function simulateLumpSumPrepayment(params: {
  loanPrincipalINR: number;
  annualRatePct: number;
  targetTenureMonths: number;
  currentMonthlyEmiINR: number;
  lumpSumINR: number;
}) {
  const { loanPrincipalINR, annualRatePct, targetTenureMonths, currentMonthlyEmiINR, lumpSumINR } = params;
  const basePrincipal = Math.max(0, loanPrincipalINR);
  const reducedPrincipal = Math.max(0, basePrincipal - Math.max(0, lumpSumINR));
  const r = Math.max(0, annualRatePct) / 12 / 100;

  const baseEmi = currentMonthlyEmiINR > 0
    ? currentMonthlyEmiINR
    : calcStandardEmi(basePrincipal, annualRatePct, targetTenureMonths);

  // Baseline total interest over targetTenureMonths (or actual payoff at baseEmi)
  const simulateRun = (startPrin: number, monthlyPay: number, maxMonths = 600) => {
    let bal = startPrin;
    let months = 0;
    let totalInt = 0;
    if (bal <= 0) return { months: 0, totalInterest: 0 };
    while (bal > 1 && months < maxMonths) {
      const interest = bal * r;
      if (monthlyPay <= interest) {
        // Payment doesn't cover monthly interest; cap at targetTenureMonths
        return {
          months: targetTenureMonths,
          totalInterest: Math.round(interest * targetTenureMonths)
        };
      }
      const prin = Math.min(bal, monthlyPay - interest);
      bal -= prin;
      totalInt += interest;
      months++;
    }
    return { months, totalInterest: Math.round(totalInt) };
  };

  const baselineRun = simulateRun(basePrincipal, baseEmi);

  // Option A: Reduce Monthly EMI, keep same targetTenureMonths
  const reducedEmi = calcStandardEmi(reducedPrincipal, annualRatePct, targetTenureMonths);
  const optionATotalInterest = Math.max(0, Math.round(reducedEmi * targetTenureMonths - reducedPrincipal));
  const optionAInterestSaved = Math.max(0, baselineRun.totalInterest - optionATotalInterest);

  // Option B: Keep same Monthly EMI (e.g. ₹1,64,315), finish years earlier
  const optionBRun = simulateRun(reducedPrincipal, baseEmi);
  const monthsSaved = Math.max(0, baselineRun.months - optionBRun.months);
  const optionBInterestSaved = Math.max(0, baselineRun.totalInterest - optionBRun.totalInterest);

  return {
    basePrincipal,
    reducedPrincipal,
    baseEmi,
    baselineMonths: baselineRun.months,
    baselineTotalInterest: baselineRun.totalInterest,
    reducedEmi,
    emiMonthlySavings: Math.max(0, baseEmi - reducedEmi),
    optionAInterestSaved,
    acceleratedMonths: optionBRun.months,
    monthsSaved,
    yearsSaved: +(monthsSaved / 12).toFixed(1),
    optionBInterestSaved
  };
}

export function computePropertySummary(prop: RealEstateProperty): RealEstateComputedSummary {
  const agreementValueINR = Math.max(0, Number(prop.agreementValueINR) || 0);
  const targetSelfRatioPct = Number(prop.targetSelfRatioPct) || 37.93;
  const pointVal = typeof prop.pointValueINR === 'number' ? prop.pointValueINR : 0.8;

  // 1. Sum Builder Demands & Card Swipes
  let ledgerSelfBuilderINR = 0;
  let ledgerLoanBuilderINR = 0;
  let totalCcFeesINR = 0;
  let totalPointsEarned = 0;
  let totalTdsINR = 0;
  let totalStampDutyINR = 0;

  for (const d of prop.demands || []) {
    if (d.status === 'planned') continue;
    for (const sw of d.swipes || []) {
      const paid = Math.max(0, Number(sw.paymentAmountINR) || 0);
      const recv = Math.max(0, Number(sw.receivedByBuilderINR) || 0);
      const fee = Math.max(0, Number(sw.ccChargesINR) || Math.max(0, paid - recv));
      const pts = Math.max(0, Number(sw.pointsEarned) || 0);
      const isLoan = Boolean(sw.isLoanFunded) || /^loan$/i.test((sw.paymentMethod || '').trim());

      totalPointsEarned += pts;

      if (sw.category === 'tds') {
        totalTdsINR += paid;
        // 1% TDS (Form 26QB) is statutory withholding credited directly toward builder agreement value
        if (!isLoan) ledgerSelfBuilderINR += paid;
      } else if (sw.category === 'stamp_duty') {
        totalStampDutyINR += paid;
      } else {
        totalCcFeesINR += fee;
        const credited = recv > 0 ? recv : paid;
        if (isLoan) {
          ledgerLoanBuilderINR += credited;
        } else {
          ledgerSelfBuilderINR += credited;
        }
      }
    }
  }

  // 2. Walk Home Loan Ledger chronologically
  const monthlyRate = Math.max(0, Number(prop.loanConfig?.interestRatePct) || 0) / 12 / 100;
  const defaultTargetEmi = Math.max(0, Number(prop.loanConfig?.targetMonthlyEmiINR) || 0);
  const minMonthlyEmi = Math.max(0, Number(prop.loanConfig?.minMonthlyEmiINR) || 0);

  const sortedLoan = [...(prop.loanLedger || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let runningDisbursed = 0;
  let runningOutstanding = 0;
  let principalRepaidINR = 0;
  let interestPaidINR = 0;
  let totalEmiPaidINR = 0;
  let cumulativeShortfallINR = 0;

  const enrichedLoanLedger: EnrichedLoanTx[] = sortedLoan.map((tx) => {
    const amt = Math.max(0, Number(tx.amountINR) || 0);
    let compPrin = 0;
    let compInt = 0;

    if (tx.type === 'disbursement') {
      runningDisbursed += amt;
      runningOutstanding += amt;
    } else if (tx.type === 'prepayment') {
      compPrin = Math.min(runningOutstanding > 0 ? runningOutstanding : amt, amt);
      runningOutstanding = Math.max(0, runningOutstanding - compPrin);
      principalRepaidINR += compPrin;
      totalEmiPaidINR += amt;
    } else {
      // Monthly EMI / Voluntary Repayment
      const baseOut = runningOutstanding > 0
        ? runningOutstanding
        : Math.max(0, (Number(prop.manualLoanDisbursedINR) || ledgerLoanBuilderINR) - principalRepaidINR);
      compInt = typeof tx.interestComponentINR === 'number'
        ? tx.interestComponentINR
        : Math.min(amt, Math.round(baseOut * monthlyRate));
      compPrin = typeof tx.principalComponentINR === 'number'
        ? tx.principalComponentINR
        : Math.max(0, amt - compInt);

      if (runningOutstanding > 0) {
        runningOutstanding = Math.max(0, runningOutstanding - compPrin);
      }
      principalRepaidINR += compPrin;
      interestPaidINR += compInt;
      totalEmiPaidINR += amt;

      const expected = typeof tx.expectedEmiINR === 'number' && tx.expectedEmiINR > 0
        ? tx.expectedEmiINR
        : defaultTargetEmi;
      if (expected > 0) {
        cumulativeShortfallINR += expected - amt;
      }
    }

    return {
      ...tx,
      runningDisbursedINR: runningDisbursed,
      runningOutstandingINR: runningOutstanding,
      computedPrincipalINR: compPrin,
      computedInterestINR: compInt,
      cumulativeShortfallINR
    };
  });

  // 3. Resolve Self-Paid & Loan-Disbursed (Manual Totals vs Ledger)
  const hasManual = Boolean(prop.useManualTotals);
  const selfPaidINR = hasManual
    ? Math.max(0, Number(prop.manualSelfPaidINR) || 0)
    : ledgerSelfBuilderINR;

  const ledgerDisbursedBest = Math.max(runningDisbursed, ledgerLoanBuilderINR);
  const loanDisbursedINR = hasManual
    ? Math.max(0, Number(prop.manualLoanDisbursedINR) || 0)
    : ledgerDisbursedBest;

  const totalPaidToBuilderINR = selfPaidINR + loanDisbursedINR;
  const remainingBuilderINR = Math.max(0, agreementValueINR - totalPaidToBuilderINR);
  const paidProgressPct = agreementValueINR > 0 ? Math.min(100, (totalPaidToBuilderINR / agreementValueINR) * 100) : 0;
  const actualSelfRatioPct = totalPaidToBuilderINR > 0 ? (selfPaidINR / totalPaidToBuilderINR) * 100 : 0;

  const outstandingLoanINR = Math.max(0, loanDisbursedINR - principalRepaidINR);
  const netPaidInEquityINR = selfPaidINR + principalRepaidINR;

  const estimatedPointsValueINR = Math.round(totalPointsEarned * pointVal);
  const netRewardsGainINR = estimatedPointsValueINR - Math.round(totalCcFeesINR);

  const nextRecommendedEmiINR = defaultTargetEmi > 0
    ? Math.max(minMonthlyEmi, Math.round(defaultTargetEmi + Math.max(0, cumulativeShortfallINR)))
    : 0;

  return {
    agreementValueINR,
    selfPaidINR,
    loanDisbursedINR,
    totalPaidToBuilderINR,
    remainingBuilderINR,
    paidProgressPct,
    actualSelfRatioPct,
    targetSelfRatioPct,
    principalRepaidINR,
    interestPaidINR,
    outstandingLoanINR,
    netPaidInEquityINR,
    totalCcFeesINR,
    totalPointsEarned,
    estimatedPointsValueINR,
    netRewardsGainINR,
    totalTdsINR,
    totalStampDutyINR,
    totalEmiPaidINR,
    cumulativeShortfallINR,
    nextRecommendedEmiINR,
    enrichedLoanLedger
  };
}

export function computeHouseholdRealEstateTotals(
  properties: RealEstateProperty[] | undefined,
  members: { id: string; name: string }[]
) {
  const list = Array.isArray(properties) ? properties : [];
  let totalEquityINR = 0;
  let totalLoanOutstandingINR = 0;
  let totalAgreementINR = 0;
  const byMemberEquityINR: Record<string, number> = {};

  for (const prop of list) {
    const sum = computePropertySummary(prop);
    if (!prop.includeInNetWorth) continue;

    totalEquityINR += sum.netPaidInEquityINR;
    totalLoanOutstandingINR += sum.outstandingLoanINR;
    totalAgreementINR += sum.agreementValueINR;

    const validSplits = (prop.ownershipSplit || []).filter((s) => s.memberId && s.sharePct > 0);
    if (validSplits.length > 0) {
      const totalPct = validSplits.reduce((acc, s) => acc + s.sharePct, 0) || 100;
      for (const sp of validSplits) {
        byMemberEquityINR[sp.memberId] =
          (byMemberEquityINR[sp.memberId] || 0) + (sum.netPaidInEquityINR * sp.sharePct) / totalPct;
      }
    } else if (members.length > 0) {
      // Default equal co-ownership across active household members if unspecified
      const share = sum.netPaidInEquityINR / members.length;
      for (const m of members) {
        byMemberEquityINR[m.id] = (byMemberEquityINR[m.id] || 0) + share;
      }
    }
  }

  return {
    count: list.length,
    activeCount: list.filter((p) => p.includeInNetWorth).length,
    totalEquityINR,
    totalLoanOutstandingINR,
    totalAgreementINR,
    byMemberEquityINR
  };
}
