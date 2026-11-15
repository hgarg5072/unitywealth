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
  category: 'import' | 'family' | 'milestone' | 'drift' | 'system';
  severity: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  actionTab?: string;
  isRead: boolean;
  createdAt: number;
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
