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
  source?: 'PDF' | 'Sync' | 'Manual' | 'Live' | 'PDF Import';
  priceUpdatedAt?: number;
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

export interface HouseholdSettings {
  emailAlertsEnabled?: boolean;
  accuracyThreshold?: number;
  lastAlertSent?: number;
  inviteCode?: string;
  manualMembers?: ManualMember[];
  memberProfiles?: Record<string, { id: string; name: string; email: string }>;
}

export interface Household {
  id: string;
  name: string;
  members: string[];
  membersData?: { id: string, name: string, email: string, isManual?: boolean }[];
  targets: PortfolioTargets;
  settings?: HouseholdSettings;
}

export interface DashboardData {
  household: Household;
  holdings: Holding[];
}
