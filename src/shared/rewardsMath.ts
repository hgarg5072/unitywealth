import {
  CardNetwork,
  CreditCardAccount,
  HouseholdRewardsBundle,
  LoyaltyProgramAccount,
  PointsExpiryPolicy,
  RealEstateProperty
} from '../types';
import { formatCompactINR } from './formatters';

export const EMPTY_REWARDS_BUNDLE: HouseholdRewardsBundle = {
  creditCards: [],
  loyaltyPrograms: [],
  activities: []
};

export interface CreditCardPreset {
  key: string;
  bank: string;
  cardName: string;
  network: CardNetwork;
  pointsCurrency: string;
  pointValueINR: number;
  annualFeeINR: number;
  isLifetimeFree?: boolean;
  feeWaiverSpendINR?: number;
  renewalBenefitValueINR?: number;
  renewalBenefitNote?: string;
  milestoneTargetINR?: number;
  milestoneRewardNote?: string;
  transferCapLimit?: number;
  transferCapNote?: string;
  expiryPolicy: PointsExpiryPolicy;
  rollingInactivityMonths?: number;
  loungeNotes?: string;
}

export interface LoyaltyProgramPreset {
  key: string;
  category: 'hotel' | 'airline' | 'other';
  programName: string;
  pointValueINR: number;
  expiryPolicy: PointsExpiryPolicy;
  rollingInactivityMonths?: number;
  defaultTier?: string;
  notes?: string;
}

export interface TransferPartnerRatio {
  cardKeyword: string;
  programKeyword: string;
  fromRatio: number; // e.g. 5
  toRatio: number;   // e.g. 4 (5:4)
  label: string;     // e.g. '5:4 (Magnus Burgundy -> Accor)'
}

export const INDIAN_CARD_PRESETS: CreditCardPreset[] = [
  {
    key: 'axis_magnus_burgundy',
    bank: 'Axis Bank',
    cardName: 'Axis Magnus Burgundy',
    network: 'Mastercard',
    pointsCurrency: 'Edge Rewards',
    pointValueINR: 1.5,
    annualFeeINR: 30000,
    feeWaiverSpendINR: 0,
    renewalBenefitValueINR: 0,
    renewalBenefitNote: 'Free for Burgundy Private / ₹30k + GST otherwise',
    milestoneTargetINR: 150000,
    milestoneRewardNote: 'Accelerated 35 ER/₹200 above ₹1.5L/mo spend',
    transferCapLimit: 200000,
    transferCapNote: 'Group A annual cap: 2,00,000 ER/yr (5:4 to Accor/ITC/Avios)',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    loungeNotes: 'Unlimited Domestic + Unlimited Intl Priority Pass + 4 Guests'
  },
  {
    key: 'axis_magnus',
    bank: 'Axis Bank',
    cardName: 'Axis Magnus',
    network: 'Mastercard',
    pointsCurrency: 'Edge Rewards',
    pointValueINR: 0.75,
    annualFeeINR: 12500,
    feeWaiverSpendINR: 2500000,
    renewalBenefitValueINR: 12500,
    renewalBenefitNote: '₹12.5k Luxe / Postcard / Yatra voucher on renewal',
    milestoneTargetINR: 150000,
    milestoneRewardNote: 'Accelerated 35 ER/₹200 above ₹1.5L/mo',
    transferCapLimit: 100000,
    transferCapNote: 'Group A annual cap: 1,00,000 ER/yr (5:2)',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    loungeNotes: 'Unlimited Intl Priority Pass + 4 Guests'
  },
  {
    key: 'axis_atlas',
    bank: 'Axis Bank',
    cardName: 'Axis Atlas',
    network: 'Visa',
    pointsCurrency: 'Edge Miles',
    pointValueINR: 3.6,
    annualFeeINR: 5000,
    feeWaiverSpendINR: 0,
    renewalBenefitValueINR: 9000,
    renewalBenefitNote: '2,500–5,000 Edge Miles on Gold/Platinum tier renewal',
    milestoneTargetINR: 750000,
    milestoneRewardNote: '₹3L → 2.5k EM · ₹7.5L → +2.5k EM · ₹15L → +5k EM',
    transferCapLimit: 30000,
    transferCapNote: 'Group A cap: 30,000 EM/yr (1:2 to Accor = 60,000 ALL!)',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    loungeNotes: 'Gold Tier: 6 Intl + 12 Domestic incl. guests'
  },
  {
    key: 'hdfc_infinia',
    bank: 'HDFC Bank',
    cardName: 'HDFC Infinia Metal',
    network: 'Visa',
    pointsCurrency: 'HDFC RP',
    pointValueINR: 1.0,
    annualFeeINR: 12500,
    feeWaiverSpendINR: 1000000,
    renewalBenefitValueINR: 12500,
    renewalBenefitNote: '12,500 RP on renewal (covers base fee, GST extra)',
    milestoneTargetINR: 1000000,
    milestoneRewardNote: '₹10L annual fee waiver · 15,000 RP/mo SmartBuy cap',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    loungeNotes: 'Unlimited Domestic + Unlimited Intl Priority Pass (Primary + Add-on)'
  },
  {
    key: 'hdfc_dcb',
    bank: 'HDFC Bank',
    cardName: 'HDFC Diners Club Black Metal',
    network: 'Diners',
    pointsCurrency: 'HDFC RP',
    pointValueINR: 1.0,
    annualFeeINR: 10000,
    feeWaiverSpendINR: 800000,
    renewalBenefitValueINR: 0,
    renewalBenefitNote: 'Waived at ₹8L annual spend',
    milestoneTargetINR: 400000,
    milestoneRewardNote: '10,000 bonus RP on ₹4L quarterly spend',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    loungeNotes: 'Unlimited Domestic + Intl Lounge access'
  },
  {
    key: 'amex_plat_travel',
    bank: 'American Express',
    cardName: 'Amex Platinum Travel',
    network: 'Amex',
    pointsCurrency: 'Amex MR',
    pointValueINR: 0.7,
    annualFeeINR: 5000,
    feeWaiverSpendINR: 0,
    renewalBenefitValueINR: 0,
    renewalBenefitNote: 'Retention offer / paid renewal (worth it for ₹4L milestone)',
    milestoneTargetINR: 400000,
    milestoneRewardNote: '₹4L/yr → 48,000 MR + ₹10,000 Taj Experiences Voucher',
    expiryPolicy: 'never',
    loungeNotes: '8 Domestic lounges/yr + Priority Pass membership'
  },
  {
    key: 'amex_mrcc',
    bank: 'American Express',
    cardName: 'Amex MRCC',
    network: 'Amex',
    pointsCurrency: 'Amex MR',
    pointValueINR: 0.65,
    annualFeeINR: 4500,
    feeWaiverSpendINR: 150000,
    renewalBenefitValueINR: 0,
    renewalBenefitNote: '100% fee waiver at ₹1.5L/yr (50% at ₹90k)',
    milestoneTargetINR: 240000,
    milestoneRewardNote: '4x₹1,500 + ₹20k/mo → 2,000 bonus MR/month',
    expiryPolicy: 'never'
  },
  {
    key: 'tata_neu_infinity',
    bank: 'HDFC Bank',
    cardName: 'Tata Neu Infinity',
    network: 'RuPay',
    pointsCurrency: 'NeuCoins',
    pointValueINR: 1.0,
    annualFeeINR: 1499,
    feeWaiverSpendINR: 300000,
    renewalBenefitValueINR: 0,
    renewalBenefitNote: 'Waived at ₹3L annual spend (or LTF)',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 12,
    loungeNotes: '8 Domestic + 4 Intl lounges/yr'
  },
  {
    key: 'sbi_cashback',
    bank: 'SBI Card',
    cardName: 'SBI Cashback',
    network: 'Visa',
    pointsCurrency: 'Cashback ₹',
    pointValueINR: 1.0,
    annualFeeINR: 999,
    feeWaiverSpendINR: 200000,
    renewalBenefitValueINR: 0,
    renewalBenefitNote: 'Waived at ₹2L/yr · 5% online cashback (₹5k/mo cap)',
    expiryPolicy: 'never'
  },
  {
    key: 'icici_emeralde_private',
    bank: 'ICICI Bank',
    cardName: 'ICICI Emeralde Private Metal',
    network: 'Mastercard',
    pointsCurrency: 'ICICI RP',
    pointValueINR: 1.0,
    annualFeeINR: 12499,
    feeWaiverSpendINR: 1000000,
    renewalBenefitValueINR: 12500,
    renewalBenefitNote: '12,500 RP + Taj Epicure + EaseMyTrip vouchers',
    milestoneTargetINR: 1000000,
    milestoneRewardNote: '₹4L & ₹8L EaseMyTrip vouchers · ₹10L fee waiver',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    loungeNotes: 'Unlimited Domestic + Intl Priority Pass'
  },
  {
    key: 'icici_amazon_pay',
    bank: 'ICICI Bank',
    cardName: 'Amazon Pay ICICI',
    network: 'Visa',
    pointsCurrency: 'Amazon Pay ₹',
    pointValueINR: 1.0,
    annualFeeINR: 0,
    isLifetimeFree: true,
    expiryPolicy: 'never'
  },
  {
    key: 'hdfc_regalia_gold',
    bank: 'HDFC Bank',
    cardName: 'HDFC Regalia Gold',
    network: 'Visa',
    pointsCurrency: 'HDFC RP',
    pointValueINR: 0.65,
    annualFeeINR: 2500,
    feeWaiverSpendINR: 400000,
    milestoneTargetINR: 500000,
    milestoneRewardNote: '₹5L → ₹5k Flight Voucher · ₹7.5L → +₹5k Voucher',
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 24,
    loungeNotes: '12 Domestic + 6 Intl Priority Pass'
  },
  {
    key: 'idfc_wealth',
    bank: 'IDFC First Bank',
    cardName: 'IDFC First Wealth',
    network: 'Visa',
    pointsCurrency: 'IDFC RP',
    pointValueINR: 0.25,
    annualFeeINR: 0,
    isLifetimeFree: true,
    expiryPolicy: 'never',
    loungeNotes: '2 Domestic + 2 Intl per quarter (₹20k spend req)'
  }
];

export const LOYALTY_PROGRAM_PRESETS: LoyaltyProgramPreset[] = [
  {
    key: 'marriott_bonvoy',
    category: 'hotel',
    programName: 'Marriott Bonvoy',
    pointValueINR: 0.7,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 24,
    defaultTier: 'Gold Elite',
    notes: '24-month inactivity expiry — any earn/transfer/redemption resets clock'
  },
  {
    key: 'accor_all',
    category: 'hotel',
    programName: 'Accor Live Limitless (ALL)',
    pointValueINR: 1.9,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 12,
    defaultTier: 'Gold',
    notes: '2,000 ALL = €40 (~₹3,800). 12-month inactivity expiry — transfer 100 pts or stay to extend'
  },
  {
    key: 'itc_green',
    category: 'hotel',
    programName: 'Club ITC Green Points',
    pointValueINR: 1.0,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 24,
    defaultTier: 'Gold',
    notes: '1 Green Point = ₹1 at ITC Hotels (or 2:3 transfer to Marriott Bonvoy)'
  },
  {
    key: 'taj_innercircle',
    category: 'hotel',
    programName: 'Taj InnerCircle / NeuPass',
    pointValueINR: 1.0,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 12,
    defaultTier: 'Gold'
  },
  {
    key: 'ihg_one',
    category: 'hotel',
    programName: 'IHG One Rewards',
    pointValueINR: 0.45,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 12,
    defaultTier: 'Platinum'
  },
  {
    key: 'hilton_honors',
    category: 'hotel',
    programName: 'Hilton Honors',
    pointValueINR: 0.4,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 24,
    defaultTier: 'Gold'
  },
  {
    key: 'sq_krisflyer',
    category: 'airline',
    programName: 'Singapore KrisFlyer',
    pointValueINR: 1.25,
    expiryPolicy: 'fixed_date',
    rollingInactivityMonths: 36,
    defaultTier: 'KrisFlyer',
    notes: 'HARD 36-month expiry from earn date — cannot be extended by activity!'
  },
  {
    key: 'qatar_avios',
    category: 'airline',
    programName: 'Qatar Privilege Club (Avios)',
    pointValueINR: 1.15,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    defaultTier: 'Burgundy',
    notes: '36-month inactivity expiry · Free 1:1 linked transfer with BA & Finnair Avios'
  },
  {
    key: 'ba_avios',
    category: 'airline',
    programName: 'British Airways Club (Avios)',
    pointValueINR: 1.15,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 36,
    defaultTier: 'Blue'
  },
  {
    key: 'air_india_maharaja',
    category: 'airline',
    programName: 'Air India Maharaja Club',
    pointValueINR: 0.9,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 24,
    defaultTier: 'Silver'
  },
  {
    key: 'flying_blue',
    category: 'airline',
    programName: 'Air France / KLM Flying Blue',
    pointValueINR: 1.1,
    expiryPolicy: 'rolling_months',
    rollingInactivityMonths: 24,
    defaultTier: 'Explorer'
  },
  {
    key: 'united_mileageplus',
    category: 'airline',
    programName: 'United MileagePlus',
    pointValueINR: 1.1,
    expiryPolicy: 'never',
    defaultTier: 'Member',
    notes: 'Miles never expire'
  }
];

export const COMMON_TRANSFER_RATIOS: TransferPartnerRatio[] = [
  { cardKeyword: 'magnus burgundy', programKeyword: 'accor', fromRatio: 5, toRatio: 4, label: '5:4 (Magnus Burgundy → Accor)' },
  { cardKeyword: 'magnus burgundy', programKeyword: 'itc', fromRatio: 5, toRatio: 4, label: '5:4 (Magnus Burgundy → ITC)' },
  { cardKeyword: 'magnus burgundy', programKeyword: 'avios', fromRatio: 5, toRatio: 4, label: '5:4 (Magnus Burgundy → Avios)' },
  { cardKeyword: 'magnus burgundy', programKeyword: 'krisflyer', fromRatio: 5, toRatio: 4, label: '5:4 (Magnus Burgundy → KrisFlyer)' },
  { cardKeyword: 'magnus burgundy', programKeyword: 'marriott', fromRatio: 5, toRatio: 4, label: '5:4 (Magnus Burgundy → Marriott)' },
  { cardKeyword: 'atlas', programKeyword: 'accor', fromRatio: 1, toRatio: 2, label: '1:2 (Atlas Edge Miles → Accor)' },
  { cardKeyword: 'atlas', programKeyword: 'itc', fromRatio: 1, toRatio: 2, label: '1:2 (Atlas Edge Miles → ITC)' },
  { cardKeyword: 'atlas', programKeyword: 'avios', fromRatio: 1, toRatio: 2, label: '1:2 (Atlas Edge Miles → Avios)' },
  { cardKeyword: 'atlas', programKeyword: 'krisflyer', fromRatio: 1, toRatio: 2, label: '1:2 (Atlas Edge Miles → KrisFlyer)' },
  { cardKeyword: 'atlas', programKeyword: 'air india', fromRatio: 1, toRatio: 2, label: '1:2 (Atlas Edge Miles → Air India)' },
  { cardKeyword: 'magnus', programKeyword: 'accor', fromRatio: 5, toRatio: 2, label: '5:2 (Magnus → Accor)' },
  { cardKeyword: 'infinia', programKeyword: 'accor', fromRatio: 2, toRatio: 1, label: '2:1 (HDFC Infinia → Accor)' },
  { cardKeyword: 'infinia', programKeyword: 'krisflyer', fromRatio: 1, toRatio: 1, label: '1:1 (HDFC Infinia → KrisFlyer)' },
  { cardKeyword: 'infinia', programKeyword: 'avios', fromRatio: 1, toRatio: 1, label: '1:1 (HDFC Infinia → Avios)' },
  { cardKeyword: 'infinia', programKeyword: 'air india', fromRatio: 1, toRatio: 1, label: '1:1 (HDFC Infinia → Air India)' },
  { cardKeyword: 'infinia', programKeyword: 'itc', fromRatio: 2, toRatio: 1, label: '2:1 (HDFC Infinia → ITC)' },
  { cardKeyword: 'diners', programKeyword: 'accor', fromRatio: 2, toRatio: 1, label: '2:1 (HDFC DCB → Accor)' },
  { cardKeyword: 'diners', programKeyword: 'krisflyer', fromRatio: 1, toRatio: 1, label: '1:1 (HDFC DCB → KrisFlyer)' },
  { cardKeyword: 'amex', programKeyword: 'marriott', fromRatio: 1, toRatio: 1, label: '1:1 (Amex MR → Marriott Bonvoy)' },
  { cardKeyword: 'amex', programKeyword: 'hilton', fromRatio: 1, toRatio: 0.9, label: '10:9 (Amex MR → Hilton)' },
  { cardKeyword: 'amex', programKeyword: 'avios', fromRatio: 2, toRatio: 1, label: '2:1 (Amex MR → Avios)' },
  { cardKeyword: 'amex', programKeyword: 'krisflyer', fromRatio: 2, toRatio: 1, label: '2:1 (Amex MR → KrisFlyer)' }
];

export function suggestTransferRatio(cardName: string, programName: string): { fromRatio: number; toRatio: number; label: string } {
  const c = (cardName || '').toLowerCase();
  const p = (programName || '').toLowerCase();
  for (const r of COMMON_TRANSFER_RATIOS) {
    if (c.includes(r.cardKeyword) && p.includes(r.programKeyword)) {
      return { fromRatio: r.fromRatio, toRatio: r.toRatio, label: r.label };
    }
  }
  return { fromRatio: 1, toRatio: 1, label: '1:1 (Custom Ratio)' };
}

function parseIsoDateLocal(iso?: string): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return null;
  const [y, m, d] = iso.trim().split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function addMonthsIso(iso: string, months: number): string | null {
  const dt = parseIsoDateLocal(iso);
  if (!dt) return null;
  const target = new Date(dt.getFullYear(), dt.getMonth() + months, dt.getDate());
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function daysUntilIso(iso?: string, today = new Date()): number | null {
  const dt = parseIsoDateLocal(iso);
  if (!dt) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((dt.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
}

export function resolveEffectiveExpiryDate(params: {
  expiryPolicy: PointsExpiryPolicy;
  fixedExpiryDate?: string;
  lastActivityDate?: string;
  rollingInactivityMonths?: number;
}): { effectiveDate: string | null; daysRemaining: number | null } {
  if (params.expiryPolicy === 'never') {
    return { effectiveDate: null, daysRemaining: null };
  }
  if (params.expiryPolicy === 'fixed_date') {
    const d = params.fixedExpiryDate || null;
    return { effectiveDate: d, daysRemaining: d ? daysUntilIso(d) : null };
  }
  // rolling_months
  if (params.lastActivityDate && params.rollingInactivityMonths && params.rollingInactivityMonths > 0) {
    const computed = addMonthsIso(params.lastActivityDate, params.rollingInactivityMonths);
    return { effectiveDate: computed, daysRemaining: computed ? daysUntilIso(computed) : null };
  }
  if (params.fixedExpiryDate) {
    return { effectiveDate: params.fixedExpiryDate, daysRemaining: daysUntilIso(params.fixedExpiryDate) };
  }
  return { effectiveDate: null, daysRemaining: null };
}

export function computeCardFeeWithGstINR(card: CreditCardAccount): number {
  if (card.isLifetimeFree || card.status === 'ltf' || card.status === 'closed') return 0;
  const base = Math.max(0, Number(card.annualFeeINR) || 0);
  if (base <= 0) return 0;
  return card.gstIncludedInFee ? Math.round(base) : Math.round(base * 1.18);
}

export function isCardFeeWaived(card: CreditCardAccount): boolean {
  if (card.isLifetimeFree || card.status === 'ltf') return true;
  const req = Number(card.feeWaiverSpendINR) || 0;
  const cur = Number(card.currentYearSpendINR) || 0;
  return req > 0 && cur >= req;
}

export interface RewardsAlertItem {
  id: string;
  severity: 'warning' | 'info' | 'success';
  title: string;
  message: string;
  daysLeft?: number;
}

export interface RewardsHubSummary {
  activeCardsCount: number;
  programsCount: number;
  cardPointsValueINR: number;
  hotelPointsValueINR: number;
  airlineMilesValueINR: number;
  vouchersValueINR: number;
  totalRewardsWealthINR: number;
  totalAnnualFeesWithGstINR: number;
  totalEffectiveFeesAfterWaiversINR: number;
  totalRenewalBenefitsINR: number;
  netAnnualCarryINR: number; // Positive = net gain after fees; Negative = net out-of-pocket fee cost
  expiringSoonCount: number;
  expiringSoonValueINR: number;
  renewingSoonCount: number;
  alerts: RewardsAlertItem[];
}

export function computeRewardsHubSummary(
  bundle: HouseholdRewardsBundle,
  members: { id: string; name: string }[] = [],
  today = new Date()
): RewardsHubSummary {
  const memberName = (id?: string) => members.find((m) => m.id === id)?.name || 'Family';

  const cards = (bundle.creditCards || []).filter((c) => c.status !== 'closed');
  const programs = bundle.loyaltyPrograms || [];

  let cardPointsValueINR = 0;
  let hotelPointsValueINR = 0;
  let airlineMilesValueINR = 0;
  let vouchersValueINR = 0;
  let totalAnnualFeesWithGstINR = 0;
  let totalEffectiveFeesAfterWaiversINR = 0;
  let totalRenewalBenefitsINR = 0;
  let expiringSoonCount = 0;
  let expiringSoonValueINR = 0;
  let renewingSoonCount = 0;
  const alerts: RewardsAlertItem[] = [];

  for (const card of cards) {
    const valINR = Math.round((Number(card.pointsBalance) || 0) * (Number(card.pointValueINR) || 0));
    cardPointsValueINR += valINR;

    const feeGst = computeCardFeeWithGstINR(card);
    const waived = isCardFeeWaived(card);
    totalAnnualFeesWithGstINR += feeGst;
    if (!waived) {
      totalEffectiveFeesAfterWaiversINR += feeGst;
      totalRenewalBenefitsINR += Math.max(0, Number(card.renewalBenefitValueINR) || 0);
    }

    // Renewal countdown
    const renewDays = daysUntilIso(card.renewalDate, today);
    if (renewDays !== null && renewDays >= -5 && renewDays <= 45) {
      renewingSoonCount++;
      const waiverReq = Number(card.feeWaiverSpendINR) || 0;
      const curSpend = Number(card.currentYearSpendINR) || 0;
      const spendGap = waiverReq > 0 ? Math.max(0, waiverReq - curSpend) : 0;

      if (!card.isLifetimeFree && card.status !== 'ltf' && feeGst > 0) {
        alerts.push({
          id: `cc_renew_${card.id}`,
          severity: renewDays <= 15 && !waived ? 'warning' : 'info',
          title:
            renewDays < 0
              ? `Renewal Overdue: ${card.cardName}`
              : `${card.cardName} renews in ${renewDays}d`,
          message: waived
            ? `${memberName(card.ownerId)}'s card fee (${formatCompactINR(feeGst)}) is already WAIVED via spend.`
            : spendGap > 0
            ? `${formatCompactINR(feeGst)} incl. GST due on ${card.renewalDate}. Spend ${formatCompactINR(spendGap)} more to waive fee.`
            : `${formatCompactINR(feeGst)} incl. GST due on ${card.renewalDate}${card.renewalBenefitNote ? ` (${card.renewalBenefitNote})` : ''}.`,
          daysLeft: renewDays
        });
      }
    } else if (renewDays !== null && renewDays > 45 && renewDays <= 90 && !waived) {
      const waiverReq = Number(card.feeWaiverSpendINR) || 0;
      const curSpend = Number(card.currentYearSpendINR) || 0;
      if (waiverReq > 0 && curSpend / waiverReq >= 0.78) {
        alerts.push({
          id: `cc_waiver_close_${card.id}`,
          severity: 'success',
          title: `Fee Waiver Almost Hit: ${card.cardName}`,
          message: `${Math.round((curSpend / waiverReq) * 100)}% done — spend ${formatCompactINR(waiverReq - curSpend)} before ${card.renewalDate} to waive ${formatCompactINR(feeGst)}.`,
          daysLeft: renewDays
        });
      }
    }

    // Card points expiry
    if ((Number(card.pointsBalance) || 0) > 0) {
      const exp = resolveEffectiveExpiryDate({
        expiryPolicy: card.expiryPolicy,
        fixedExpiryDate: card.pointsExpiryDate,
        lastActivityDate: card.lastActivityDate,
        rollingInactivityMonths: card.rollingInactivityMonths
      });
      if (exp.daysRemaining !== null && exp.daysRemaining <= 60) {
        expiringSoonCount++;
        expiringSoonValueINR += valINR;
        alerts.push({
          id: `cc_exp_${card.id}`,
          severity: 'warning',
          title:
            exp.daysRemaining < 0
              ? `Points Expired: ${card.cardName}`
              : `${Math.round(card.pointsBalance).toLocaleString('en-IN')} ${card.pointsCurrency} expire in ${exp.daysRemaining}d`,
          message: `${memberName(card.ownerId)}'s ${card.cardName} (${formatCompactINR(valINR)} value) hits expiry on ${exp.effectiveDate}. Transfer or redeem soon!`,
          daysLeft: exp.daysRemaining
        });
      }
    }
  }

  for (const prog of programs) {
    const valINR = Math.round((Number(prog.pointsBalance) || 0) * (Number(prog.pointValueINR) || 0));
    if (prog.category === 'hotel') hotelPointsValueINR += valINR;
    else airlineMilesValueINR += valINR;

    // Program points expiry
    if ((Number(prog.pointsBalance) || 0) > 0) {
      const exp = resolveEffectiveExpiryDate({
        expiryPolicy: prog.expiryPolicy,
        fixedExpiryDate: prog.expiryDate,
        lastActivityDate: prog.lastActivityDate,
        rollingInactivityMonths: prog.rollingInactivityMonths
      });
      if (exp.daysRemaining !== null && exp.daysRemaining <= 60) {
        expiringSoonCount++;
        expiringSoonValueINR += valINR;
        alerts.push({
          id: `prog_exp_${prog.id}`,
          severity: 'warning',
          title:
            exp.daysRemaining < 0
              ? `Miles/Points Expired: ${prog.programName}`
              : `${prog.programName} expires in ${exp.daysRemaining}d`,
          message: `${memberName(prog.ownerId)}'s ${Math.round(prog.pointsBalance).toLocaleString('en-IN')} pts (${formatCompactINR(valINR)}) ${
            prog.expiryPolicy === 'rolling_months'
              ? `hits ${prog.rollingInactivityMonths}m inactivity expiry on ${exp.effectiveDate} — earn/transfer 100 pts to reset clock!`
              : `has hard expiry on ${exp.effectiveDate}.`
          }`,
          daysLeft: exp.daysRemaining
        });
      }
    }

    // Active vouchers
    for (const v of prog.vouchers || []) {
      if (v.used) continue;
      const vVal = Math.max(0, Number(v.estimatedValueINR) || 0);
      vouchersValueINR += vVal;
      const vDays = daysUntilIso(v.expiryDate, today);
      if (vDays !== null && vDays <= 60) {
        expiringSoonCount++;
        expiringSoonValueINR += vVal;
        alerts.push({
          id: `vouch_exp_${prog.id}_${v.id}`,
          severity: 'warning',
          title:
            vDays < 0
              ? `Voucher Expired: ${v.title}`
              : `Voucher expires in ${vDays}d: ${v.title}`,
          message: `${prog.programName} voucher worth ${formatCompactINR(vVal)} expires on ${v.expiryDate}.`,
          daysLeft: vDays
        });
      }
    }
  }

  alerts.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  const totalRewardsWealthINR =
    cardPointsValueINR + hotelPointsValueINR + airlineMilesValueINR + vouchersValueINR;
  const netAnnualCarryINR = totalRenewalBenefitsINR - totalEffectiveFeesAfterWaiversINR;

  return {
    activeCardsCount: cards.length,
    programsCount: programs.length,
    cardPointsValueINR,
    hotelPointsValueINR,
    airlineMilesValueINR,
    vouchersValueINR,
    totalRewardsWealthINR,
    totalAnnualFeesWithGstINR,
    totalEffectiveFeesAfterWaiversINR,
    totalRenewalBenefitsINR,
    netAnnualCarryINR,
    expiringSoonCount,
    expiringSoonValueINR,
    renewingSoonCount,
    alerts
  };
}

/**
 * Aggregates reward points already recorded per credit card inside Real Estate builder swipes,
 * so the user can 1-click import/sync those card points into Cards & Miles.
 */
export function summarizeRealEstateSwipePointsByCard(
  properties: RealEstateProperty[] | undefined
): { paymentMethod: string; totalPoints: number; swipeCount: number; totalSpendINR: number }[] {
  const map = new Map<string, { paymentMethod: string; totalPoints: number; swipeCount: number; totalSpendINR: number }>();
  for (const prop of properties || []) {
    for (const dem of prop.demands || []) {
      if (dem.status === 'planned') continue;
      for (const sw of dem.swipes || []) {
        const pts = Math.max(0, Number(sw.pointsEarned) || 0);
        const method = (sw.paymentMethod || '').trim();
        if (!method || /^loan$/i.test(method) || pts <= 0) continue;
        const key = method.toLowerCase();
        const prev = map.get(key) || {
          paymentMethod: method,
          totalPoints: 0,
          swipeCount: 0,
          totalSpendINR: 0
        };
        prev.totalPoints += pts;
        prev.swipeCount += 1;
        prev.totalSpendINR += Math.max(0, Number(sw.paymentAmountINR) || 0);
        map.set(key, prev);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalPoints - a.totalPoints);
}
