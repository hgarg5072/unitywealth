export interface User {
  id: string;
  email: string;
  name: string;
  householdId: string | null;
  googleId?: string;
  googleTokens?: any;
}

export interface Invite {
  id: string;
  fromUserId: string;
  toEmail: string;
  householdId: string;
  householdName?: string;
  inviteCode?: string;
  status: 'pending' | 'accepted' | 'declined';
}

export type AssetClass = "Equity" | "Debt" | "Mutual Fund";
export type Currency = "USD" | "INR";

export interface Holding {
  id: string;
  userId: string;
  ownerId?: string;
  householdId: string;
  ticker: string;
  quantity: number;
  assetClass: AssetClass;
  currency: Currency;
  provider: string;
  currentPrice: number;
  originalName?: string;
  source?: 'PDF' | 'Sync' | 'Live' | 'Manual' | 'PDF Import';
  priceUpdatedAt?: number;
  syncedAt?: number;
}

export interface TickerWeight {
  ticker: string;
  weight: number; // percentage within the category (sums to 100)
}

export interface TargetCategory {
  name: string;
  percentage: number; // % of parent (e.g. % of Foreign Equity)
  tickerWeights?: TickerWeight[];
}

export interface PortfolioTargets {
  assetSplit: {
    Equity: number;
    Debt: number;
  };
  equitySplit: {
    Indian: number;
    Foreign: number;
  };
  foreignBreakdown: TargetCategory[];
}

export interface ManualMember {
  id: string;
  name: string;
  email: string;
  isManual?: boolean;
}

export interface RealEstateSwipe {
  id: string;
  paymentDate: string;          // YYYY-MM-DD
  paymentAmountINR: number;     // Gross paid (e.g. ₹9,60,000 on Magnus)
  paymentMethod: string;        // e.g. 'Magnus', 'Axis Atlas', 'Tata Neu CC', 'SBI Cashback', 'Net Banking', 'Loan'
  isLoanFunded?: boolean;       // true when funded by bank loan disbursement
  receivedByBuilderINR: number; // Net credited to builder (e.g. ₹9,40,176)
  ccChargesINR: number;         // MDR / gateway fee (paymentAmount - receivedByBuilder)
  pointsEarned: number;         // Reward points or cashback earned
  category: 'installment' | 'tds' | 'stamp_duty' | 'other';
  notes?: string;
}

export interface RealEstateDemand {
  id: string;
  title: string;                // e.g. 'Installment 1 (Booking & Allotment)', 'Jun 2026 Slab Demand'
  dueDate?: string;             // YYYY-MM-DD
  demandAmountINR: number;      // e.g. 28,38,924
  status: 'paid' | 'partial' | 'planned';
  plannedFunding?: 'self_card' | 'loan' | 'split';
  plannedSelfINR?: number;
  plannedLoanINR?: number;
  planNote?: string;            // e.g. 'June Pay by card', 'December only loan'
  swipes: RealEstateSwipe[];
}

export interface RealEstateFundOrigin {
  id: string;
  label: string;                // e.g. '20L - Papa', '10L - Tata Arbitrage MF', '6L - Google Stocks'
  amountINR: number;
  memberTag: string;            // memberId or 'family_external'
  notes?: string;
}

export interface RealEstateLoanTx {
  id: string;
  date: string;                 // YYYY-MM-DD
  type: 'disbursement' | 'emi' | 'prepayment';
  amountINR: number;            // Disbursed amount OR Paid EMI / Prepayment
  expectedEmiINR?: number;      // e.g. 1,64,315 (15-yr target)
  minEmiINR?: number;           // e.g. 11,000 (bank required minimum)
  principalComponentINR?: number;
  interestComponentINR?: number;
  notes?: string;
}

export interface RealEstateProperty {
  id: string;
  householdId: string;
  name: string;                         // e.g. 'Primary Residence (₹2.90 Cr)'
  agreementValueINR: number;            // e.g. 2,90,00,000
  marketValueINR?: number;              // Optional market valuation
  targetSelfRatioPct: number;           // e.g. 37.93 (1.10 Cr / 2.90 Cr)
  includeInNetWorth: boolean;           // Default: true (adds Paid-In Net Equity to Family/Member Net Worth)
  useManualTotals?: boolean;            // True = use manualSelfPaidINR / manualLoanDisbursedINR directly; False = sum from ledger
  manualSelfPaidINR?: number;           // e.g. 70,00,000
  manualLoanDisbursedINR?: number;      // e.g. 50,00,000
  pointValueINR?: number;               // Estimated ₹ value per reward point (default ₹0.80)
  ownershipSplit: { memberId: string; sharePct: number }[]; // e.g. 50% Himanshu / 50% Nisha
  loanConfig: {
    lender: string;
    sanctionedLimitINR: number;         // e.g. 1,80,00,000
    interestRatePct: number;            // e.g. 7.4 or 8.5
    bankTenureYears: number;            // e.g. 30
    targetTenureYears: number;          // e.g. 15
    targetMonthlyEmiINR: number;        // e.g. 1,64,315
    minMonthlyEmiINR: number;           // e.g. 11,000
    emiDayOfMonth: number;              // 1..28
    plannedPrepaymentINR?: number;      // e.g. 60,00,000 (Plot sale scenario)
    note?: string;
  };
  sheetUrl?: string;
  demands: RealEstateDemand[];
  loanLedger: RealEstateLoanTx[];
  fundOrigins: RealEstateFundOrigin[];
  updatedAt: number;
}

export interface MemberSnapshotBreakdown {
  id: string;
  name: string;
  valueINR: number;
  indianEquityINR?: number;
  foreignEquityINR?: number;
  debtINR?: number;
  realEstateEquityINR?: number;
}

export interface HoldingSnapshotBreakdown {
  key: string;
  ticker: string;
  name: string;
  ownerId: string;
  assetClass: string;
  currency: string;
  provider: string;
  units: number;
  price: number;
  valueINR: number;
}

export interface RebalanceSnapshotMeta {
  actualEquityPct?: number;
  targetEquityPct?: number;
  actualIndianOfEqPct?: number;
  targetIndianOfEqPct?: number;
  alignmentPct?: number;
}

export interface WealthSnapshotRecord {
  householdId: string;
  snapshotMonth: string; // YYYY-MM
  recordedAt: number;
  totalINR: number;
  totalUSD: number;
  indianEquityINR: number;
  foreignEquityINR: number;
  debtINR: number;
  realEstateEquityINR?: number;
  realEstateLoanINR?: number;
  fxRate: number;
  holdingsCount: number;
  memberBreakdown: MemberSnapshotBreakdown[];
  providerBreakdown: Record<string, number>;
  holdingsBreakdown?: HoldingSnapshotBreakdown[];
  rebalanceMeta?: RebalanceSnapshotMeta;
  source: string;
  note?: string;
}

export interface NotificationRecord {
  id: string;
  householdId: string;
  userId?: string;
  category: 'import' | 'family' | 'milestone' | 'drift' | 'tax' | 'rsu' | 'system';
  severity: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  actionTab?: string;
  isRead: boolean;
  createdAt: number;
}

export type TaxAcquisitionType = 'RSU Vest' | 'ESPP' | 'Market Buy' | 'SIP' | 'Bonus/Split';

export interface TaxLot {
  id: string;
  householdId: string;
  holdingId?: string;
  ownerId: string;
  ticker: string;
  provider?: string;
  acquiredDate: string; // YYYY-MM-DD (purchase date or RSU vest release date)
  quantity: number;     // Open units in this tranche
  costPerUnit: number;  // Cost basis per unit in native currency (USD or INR)
  currency: Currency;
  fxRateAtBuy?: number; // USD/INR rate at vest/purchase (optional)
  acquisitionType: TaxAcquisitionType;
  notes?: string;
  updatedAt: number;
}

export interface RsuVestTranche {
  id: string;
  vestDate: string;     // YYYY-MM-DD
  grossUnits: number;   // Gross shares scheduled to vest
  netUnits?: number;    // Optional override; else grossUnits * (1 - withholdingTaxPct / 100)
  vested?: boolean;     // True once confirmed & converted into Holding + TaxLot
  vestPriceUSD?: number;
}

export interface RsuGrant {
  id: string;
  householdId: string;
  ownerId: string;
  ticker: string;            // e.g. QCOM, GOOGL, MSFT, NVDA
  companyName?: string;
  grantName: string;         // e.g. '2025 Annual Refresher'
  grantDate?: string;        // YYYY-MM-DD
  currency: Currency;        // typically 'USD'
  provider: string;          // e.g. 'E*TRADE', 'Charles Schwab'
  withholdingTaxPct: number; // default 35.88 (sell-to-cover tax %)
  vestSchedule: RsuVestTranche[];
  notes?: string;
  updatedAt: number;
}

export type IncomeBracketKey = 'above_5cr' | '2cr_to_5cr' | '1cr_to_2cr' | '50l_to_1cr' | 'below_50l';

export interface TaxProfileSettings {
  incomeBracket: IncomeBracketKey;
  taxRegime: 'new' | 'old';
  realizedSec112aGainByMemberINR?: Record<string, number>; // FY realized Indian Eq LTCG per member PAN
  realizedLossOffsetPoolINR?: number;                      // Current/carry-forward capital losses available
  nomineeVerifiedByAccount?: Record<string, string>;       // Account key -> Nominee name / verified note (for ICE sheet)
}

export interface HouseholdTaxPlanningBundle {
  taxLots: TaxLot[];
  rsuGrants: RsuGrant[];
  taxProfile: TaxProfileSettings;
  updatedAt?: number;
}

export type CardNetwork = 'Visa' | 'Mastercard' | 'Amex' | 'Diners' | 'RuPay';
export type CardStatus = 'active' | 'ltf' | 'downgrade_watch' | 'closed';
export type PointsExpiryPolicy = 'fixed_date' | 'rolling_months' | 'never';

export interface CreditCardAccount {
  id: string;
  householdId: string;
  ownerId: string;
  bank: string;                     // e.g. 'Axis Bank', 'HDFC Bank', 'Amex', 'ICICI Bank', 'SBI'
  cardName: string;                 // e.g. 'Axis Magnus Burgundy', 'HDFC Infinia Metal'
  last4?: string;
  network?: CardNetwork;
  status: CardStatus;
  pointsCurrency: string;           // e.g. 'Edge Rewards', 'Edge Miles', 'HDFC RP', 'Amex MR', 'NeuCoins'
  pointsBalance: number;
  pointValueINR: number;            // Estimated ₹ value per point (e.g. 1.0, 1.6, 0.7)
  expiryPolicy: PointsExpiryPolicy;
  pointsExpiryDate?: string;        // YYYY-MM-DD (for fixed_date)
  rollingInactivityMonths?: number; // e.g. 36m for HDFC RP, 12m for Edge
  lastActivityDate?: string;        // YYYY-MM-DD
  renewalDate?: string;             // YYYY-MM-DD (next annual fee renewal date)
  annualFeeINR: number;             // Pre-GST base fee (or 0 if LTF)
  gstIncludedInFee?: boolean;       // If false, 18% GST is added automatically in ROI math
  isLifetimeFree?: boolean;
  feeWaiverSpendINR?: number;       // e.g. 10,00,000 for Infinia
  currentYearSpendINR?: number;
  renewalBenefitValueINR?: number;  // e.g. 10,000 for 10,000 RP on renewal
  renewalBenefitNote?: string;
  milestoneTargetINR?: number;      // e.g. 4,00,000 for Amex Plat Travel
  milestoneRewardNote?: string;
  transferCapUsed?: number;         // e.g. Axis Group A annual transfer cap used
  transferCapLimit?: number;        // e.g. 30,000 / 2,00,000
  transferCapNote?: string;
  statementDay?: number;            // 1–31
  dueDay?: number;                  // 1–31
  creditLimitINR?: number;
  loungeNotes?: string;
  notes?: string;
  updatedAt: number;
}

export interface LoyaltyVoucher {
  id: string;
  title: string;                    // e.g. 'Marriott 35k Free Night Award', 'Taj ₹10,000 Voucher', 'Accor Stay Plus'
  estimatedValueINR: number;
  expiryDate?: string;              // YYYY-MM-DD
  codeOrNote?: string;
  used?: boolean;
}

export interface LoyaltyProgramAccount {
  id: string;
  householdId: string;
  ownerId: string;
  category: 'hotel' | 'airline' | 'other';
  programName: string;              // e.g. 'Marriott Bonvoy', 'Accor Live Limitless (ALL)', 'Singapore KrisFlyer'
  membershipNumber?: string;
  eliteTier?: string;               // e.g. 'Gold Elite', 'Platinum', 'Silver', 'Member'
  pointsBalance: number;
  pointValueINR: number;            // e.g. 0.70 for Marriott, 1.90 for Accor, 1.20 for KrisFlyer
  expiryPolicy: PointsExpiryPolicy;
  expiryDate?: string;              // YYYY-MM-DD (for fixed_date)
  rollingInactivityMonths?: number; // e.g. 24 for Marriott, 12 for Accor, 36 for KrisFlyer
  lastActivityDate?: string;        // YYYY-MM-DD
  vouchers: LoyaltyVoucher[];
  notes?: string;
  updatedAt: number;
}

export interface PointsActivityEntry {
  id: string;
  date: string;                     // YYYY-MM-DD
  type: 'transfer' | 'redemption' | 'earn' | 'real_estate_sync';
  fromAccountId?: string;
  fromLabel?: string;
  toAccountId?: string;
  toLabel?: string;
  pointsOut?: number;
  pointsIn?: number;
  ratioLabel?: string;              // e.g. '5:4', '1:2', '1:1'
  estimatedValueINR?: number;
  notes?: string;
}

export interface HouseholdRewardsBundle {
  creditCards: CreditCardAccount[];
  loyaltyPrograms: LoyaltyProgramAccount[];
  activities: PointsActivityEntry[];
  updatedAt?: number;
}

export interface EmailStatusPublic {
  configured: boolean;
  provider: 'gmail_oauth' | 'gmail_smtp' | 'brevo' | 'resend' | 'none';
  senderEmail?: string;
  senderName?: string;
  officialSenderEmail?: string;
  isOfficialSender?: boolean;
  hasRefreshToken?: boolean;
  canSendToAnyone: boolean;
  googleOAuthAvailable?: boolean;
  warning?: string;
}

export interface HouseholdSettings {
  emailAlertsEnabled?: boolean;
  accuracyThreshold?: number;
  lastAlertSent?: number;
  inviteCode?: string;
  manualMembers?: ManualMember[];
  memberProfiles?: Record<string, { id: string; name: string; email: string }>;
  realEstateProperties?: RealEstateProperty[];
  taxProfile?: TaxProfileSettings;
}

export interface Household {
  id: string;
  name: string;
  members: string[];
  membersData?: { id: string; name: string; email: string; isManual?: boolean }[];
  targets: PortfolioTargets;
  settings?: HouseholdSettings;
}

export interface DashboardData {
  household: Household;
  holdings: Holding[];
}
