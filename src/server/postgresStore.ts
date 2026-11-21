import pg from "pg";
import {
  MemberSnapshotBreakdown,
  HoldingSnapshotBreakdown,
  RebalanceSnapshotMeta,
  WealthSnapshotRecord,
  NotificationRecord,
  RealEstateProperty,
  HouseholdTaxPlanningBundle,
  TaxLot,
  RsuGrant,
  TaxProfileSettings,
  HouseholdRewardsBundle,
  CreditCardAccount,
  LoyaltyProgramAccount,
  PointsActivityEntry
} from "../types";
import { LRUCache } from "../shared/lruCache";
import { FX_FALLBACK_RATE } from "../shared/formatters";
import { DEFAULT_TAX_PROFILE } from "../shared/taxAndRsuMath";

export type {
  MemberSnapshotBreakdown,
  HoldingSnapshotBreakdown,
  RebalanceSnapshotMeta,
  WealthSnapshotRecord,
  NotificationRecord
};

const { Pool } = pg;

export interface CachedQuoteRecord {
  symbol: string;
  price: number;
  prevClose?: number;
  changePct?: number;
  currency?: string;
  updatedAt: number;
}

let pool: pg.Pool | null = null;
let pgReady = false;
let lastPgError: string | null = null;

// In-memory fallback maps ONLY populated when PostgreSQL is unavailable (local dev without DATABASE_URL)
const fallbackSnapshots = new Map<string, Map<string, WealthSnapshotRecord>>();
const fallbackNotifications = new Map<string, NotificationRecord[]>();
const fallbackStateKeys = new Map<string, any>();
const fallbackRealEstate = new Map<string, RealEstateProperty[]>();
const fallbackTaxPlanning = new Map<string, HouseholdTaxPlanningBundle>();
const fallbackRewardsHub = new Map<string, HouseholdRewardsBundle>();

// 60-second read cache for uw_app_state (avoids repeated SELECTs on /api/health & /api/email/status)
const appStateReadCache = new LRUCache<string, any>(256, 60_000);

export async function initPostgresStore(): Promise<{
  connected: boolean;
  restoredInviteCodes: Record<string, any>;
}> {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    lastPgError = "DATABASE_URL not set (running with local fallback)";
    return { connected: false, restoredInviteCodes: {} };
  }

  const createCandidatePool = (useSsl: boolean) =>
    new Pool({
      connectionString: dbUrl,
      max: 18,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    });

  try {
    let candidate = createCandidatePool(true);
    try {
      await candidate.query("SELECT 1");
      pool = candidate;
    } catch (sslErr: any) {
      await candidate.end().catch(() => {});
      if (/does not support SSL/i.test(String(sslErr?.message || ""))) {
        candidate = createCandidatePool(false);
        await candidate.query("SELECT 1");
        pool = candidate;
      } else {
        throw sslErr;
      }
    }

    pool.on("error", (err) => {
      console.warn("[Postgres Pool Warning]", err.message);
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS uw_wealth_snapshots (
        id SERIAL PRIMARY KEY,
        household_id TEXT NOT NULL,
        snapshot_month TEXT NOT NULL,
        recorded_at BIGINT NOT NULL,
        total_inr DOUBLE PRECISION NOT NULL,
        total_usd DOUBLE PRECISION NOT NULL,
        indian_equity_inr DOUBLE PRECISION NOT NULL DEFAULT 0,
        foreign_equity_inr DOUBLE PRECISION NOT NULL DEFAULT 0,
        debt_inr DOUBLE PRECISION NOT NULL DEFAULT 0,
        fx_rate DOUBLE PRECISION NOT NULL DEFAULT 84,
        holdings_count INTEGER NOT NULL DEFAULT 0,
        member_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        provider_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
        holdings_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        rebalance_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        real_estate_equity_inr DOUBLE PRECISION NOT NULL DEFAULT 0,
        real_estate_loan_inr DOUBLE PRECISION NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'auto',
        note TEXT NOT NULL DEFAULT '',
        UNIQUE (household_id, snapshot_month)
      );

      ALTER TABLE uw_wealth_snapshots
        ADD COLUMN IF NOT EXISTS holdings_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE uw_wealth_snapshots
        ADD COLUMN IF NOT EXISTS rebalance_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE uw_wealth_snapshots
        ADD COLUMN IF NOT EXISTS real_estate_equity_inr DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE uw_wealth_snapshots
        ADD COLUMN IF NOT EXISTS real_estate_loan_inr DOUBLE PRECISION NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_uw_wealth_hh_month
        ON uw_wealth_snapshots (household_id, snapshot_month ASC);

      CREATE TABLE IF NOT EXISTS uw_invite_codes (
        code TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        household_name TEXT NOT NULL DEFAULT 'Family Portfolio',
        inviter_uid TEXT NOT NULL DEFAULT '',
        inviter_name TEXT NOT NULL DEFAULT 'Family Member',
        refresh_token TEXT NOT NULL DEFAULT '',
        last_id_token TEXT NOT NULL DEFAULT '',
        last_token_at BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_uw_invite_hh
        ON uw_invite_codes (household_id);

      CREATE TABLE IF NOT EXISTS uw_notifications (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'system',
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_tab TEXT NOT NULL DEFAULT '',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_uw_notif_hh_created
        ON uw_notifications (household_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_uw_notif_unread
        ON uw_notifications (household_id) WHERE is_read = FALSE;

      CREATE TABLE IF NOT EXISTS uw_market_cache (
        symbol TEXT PRIMARY KEY,
        price DOUBLE PRECISION NOT NULL,
        prev_close DOUBLE PRECISION NOT NULL DEFAULT 0,
        change_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uw_real_estate (
        household_id TEXT PRIMARY KEY,
        properties JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uw_tax_planning (
        household_id TEXT PRIMARY KEY,
        tax_lots JSONB NOT NULL DEFAULT '[]'::jsonb,
        rsu_grants JSONB NOT NULL DEFAULT '[]'::jsonb,
        tax_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uw_rewards_hub (
        household_id TEXT PRIMARY KEY,
        credit_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
        loyalty_programs JSONB NOT NULL DEFAULT '[]'::jsonb,
        activities JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uw_app_state (
        state_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    // Prune stale market quote cache entries (> 7 days old) asynchronously
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    pool
      .query("DELETE FROM uw_market_cache WHERE updated_at < $1", [sevenDaysAgo])
      .catch(() => {});

    pgReady = true;
    lastPgError = null;
    console.log("[Postgres] Connected & schema verified successfully.");

    const restoredInviteCodes: Record<string, any> = {};
    try {
      const invRes = await pool.query("SELECT * FROM uw_invite_codes");
      for (const r of invRes.rows) {
        restoredInviteCodes[r.code] = {
          code: r.code,
          householdId: r.household_id,
          householdName: r.household_name,
          inviterUid: r.inviter_uid,
          inviterName: r.inviter_name,
          refreshToken: r.refresh_token,
          lastIdToken: r.last_id_token,
          lastTokenAt: Number(r.last_token_at) || 0,
          createdAt: Number(r.created_at) || Date.now(),
          updatedAt: Number(r.updated_at) || Date.now()
        };
      }
    } catch (e: any) {
      console.warn("[Postgres] Invite code hydration warning:", e.message);
    }

    return { connected: true, restoredInviteCodes };
  } catch (err: any) {
    lastPgError = err?.message || String(err);
    console.error("[Postgres] Initialization failed:", lastPgError);
    return { connected: false, restoredInviteCodes: {} };
  }
}

export function getPostgresStatus() {
  return {
    connected: pgReady && !!pool,
    totalCount: pool?.totalCount ?? 0,
    idleCount: pool?.idleCount ?? 0,
    error: lastPgError
  };
}

export async function upsertInviteCodePg(entry: any): Promise<void> {
  if (!pgReady || !pool || !entry?.code) return;
  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO uw_invite_codes (
         code, household_id, household_name, inviter_uid, inviter_name,
         refresh_token, last_id_token, last_token_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (code) DO UPDATE SET
         household_id = EXCLUDED.household_id,
         household_name = EXCLUDED.household_name,
         inviter_uid = CASE WHEN EXCLUDED.inviter_uid <> '' THEN EXCLUDED.inviter_uid ELSE uw_invite_codes.inviter_uid END,
         inviter_name = CASE WHEN EXCLUDED.inviter_name <> '' THEN EXCLUDED.inviter_name ELSE uw_invite_codes.inviter_name END,
         refresh_token = CASE WHEN EXCLUDED.refresh_token <> '' THEN EXCLUDED.refresh_token ELSE uw_invite_codes.refresh_token END,
         last_id_token = CASE WHEN EXCLUDED.last_id_token <> '' THEN EXCLUDED.last_id_token ELSE uw_invite_codes.last_id_token END,
         last_token_at = CASE WHEN EXCLUDED.last_token_at > 0 THEN EXCLUDED.last_token_at ELSE uw_invite_codes.last_token_at END,
         updated_at = EXCLUDED.updated_at`,
      [
        entry.code,
        entry.householdId,
        entry.householdName || "Family Portfolio",
        entry.inviterUid || "",
        entry.inviterName || "Family Member",
        entry.refreshToken || "",
        entry.lastIdToken || "",
        Number(entry.lastTokenAt) || 0,
        Number(entry.createdAt) || now,
        now
      ]
    );
  } catch (err: any) {
    console.warn("[Postgres] upsertInviteCodePg error:", err.message);
  }
}

export async function getInviteCodePg(code: string): Promise<any | null> {
  if (!pgReady || !pool || !code) return null;
  try {
    const res = await pool.query("SELECT * FROM uw_invite_codes WHERE code = $1 LIMIT 1", [code]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      code: r.code,
      householdId: r.household_id,
      householdName: r.household_name,
      inviterUid: r.inviter_uid,
      inviterName: r.inviter_name,
      refreshToken: r.refresh_token,
      lastIdToken: r.last_id_token,
      lastTokenAt: Number(r.last_token_at) || 0,
      createdAt: Number(r.created_at) || 0,
      updatedAt: Number(r.updated_at) || 0
    };
  } catch {
    return null;
  }
}

export async function getInviteByHouseholdPg(householdId: string): Promise<any | null> {
  if (!pgReady || !pool || !householdId) return null;
  try {
    const res = await pool.query(
      "SELECT * FROM uw_invite_codes WHERE household_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [householdId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      code: r.code,
      householdId: r.household_id,
      householdName: r.household_name,
      inviterUid: r.inviter_uid,
      inviterName: r.inviter_name,
      refreshToken: r.refresh_token,
      lastIdToken: r.last_id_token,
      lastTokenAt: Number(r.last_token_at) || 0,
      createdAt: Number(r.created_at) || 0,
      updatedAt: Number(r.updated_at) || 0
    };
  } catch {
    return null;
  }
}

/**
 * Fast O(1) aggregate query to find previous peak INR net worth without downloading historical JSONB blobs.
 */
export async function getMaxWealthSnapshotInrPg(
  householdId: string,
  excludeMonth?: string
): Promise<number> {
  if (!pgReady || !pool) {
    const map = fallbackSnapshots.get(householdId);
    if (!map) return 0;
    let maxVal = 0;
    for (const [m, snap] of map.entries()) {
      if (excludeMonth && m === excludeMonth) continue;
      if (snap.totalINR > maxVal) maxVal = snap.totalINR;
    }
    return maxVal;
  }

  const res = excludeMonth
    ? await pool.query(
        "SELECT COALESCE(MAX(total_inr), 0) AS max_inr FROM uw_wealth_snapshots WHERE household_id = $1 AND snapshot_month <> $2",
        [householdId, excludeMonth]
      )
    : await pool.query(
        "SELECT COALESCE(MAX(total_inr), 0) AS max_inr FROM uw_wealth_snapshots WHERE household_id = $1",
        [householdId]
      );
  return Number(res.rows[0]?.max_inr) || 0;
}

export async function upsertWealthSnapshotPg(snap: WealthSnapshotRecord): Promise<WealthSnapshotRecord> {
  if (!snap.householdId || !snap.snapshotMonth) {
    throw new Error("householdId and snapshotMonth are required");
  }

  if (!pgReady || !pool) {
    if (!fallbackSnapshots.has(snap.householdId)) {
      fallbackSnapshots.set(snap.householdId, new Map());
    }
    fallbackSnapshots.get(snap.householdId)!.set(snap.snapshotMonth, snap);
    return snap;
  }

  await pool.query(
    `INSERT INTO uw_wealth_snapshots (
       household_id, snapshot_month, recorded_at, total_inr, total_usd,
       indian_equity_inr, foreign_equity_inr, debt_inr, real_estate_equity_inr, real_estate_loan_inr, fx_rate,
       holdings_count, member_breakdown, provider_breakdown,
       holdings_breakdown, rebalance_meta, source, note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)
     ON CONFLICT (household_id, snapshot_month) DO UPDATE SET
       recorded_at = EXCLUDED.recorded_at,
       total_inr = EXCLUDED.total_inr,
       total_usd = EXCLUDED.total_usd,
       indian_equity_inr = EXCLUDED.indian_equity_inr,
       foreign_equity_inr = EXCLUDED.foreign_equity_inr,
       debt_inr = EXCLUDED.debt_inr,
       real_estate_equity_inr = EXCLUDED.real_estate_equity_inr,
       real_estate_loan_inr = EXCLUDED.real_estate_loan_inr,
       fx_rate = EXCLUDED.fx_rate,
       holdings_count = EXCLUDED.holdings_count,
       member_breakdown = EXCLUDED.member_breakdown,
       provider_breakdown = EXCLUDED.provider_breakdown,
       holdings_breakdown = CASE WHEN jsonb_array_length(EXCLUDED.holdings_breakdown) > 0 THEN EXCLUDED.holdings_breakdown ELSE uw_wealth_snapshots.holdings_breakdown END,
       rebalance_meta = CASE WHEN EXCLUDED.rebalance_meta <> '{}'::jsonb THEN EXCLUDED.rebalance_meta ELSE uw_wealth_snapshots.rebalance_meta END,
       source = EXCLUDED.source,
       note = CASE WHEN EXCLUDED.note <> '' THEN EXCLUDED.note ELSE uw_wealth_snapshots.note END`,
    [
      snap.householdId,
      snap.snapshotMonth,
      snap.recordedAt,
      snap.totalINR,
      snap.totalUSD,
      snap.indianEquityINR,
      snap.foreignEquityINR,
      snap.debtINR,
      Number(snap.realEstateEquityINR) || 0,
      Number(snap.realEstateLoanINR) || 0,
      snap.fxRate,
      snap.holdingsCount,
      JSON.stringify(snap.memberBreakdown || []),
      JSON.stringify(snap.providerBreakdown || {}),
      JSON.stringify(snap.holdingsBreakdown || []),
      JSON.stringify(snap.rebalanceMeta || {}),
      snap.source || "auto",
      snap.note || ""
    ]
  );

  return snap;
}

export async function getWealthHistoryPg(householdId: string): Promise<WealthSnapshotRecord[]> {
  if (!pgReady || !pool) {
    const map = fallbackSnapshots.get(householdId);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth));
  }

  const res = await pool.query(
    `SELECT * FROM uw_wealth_snapshots
     WHERE household_id = $1
     ORDER BY snapshot_month ASC`,
    [householdId]
  );

  return res.rows.map((r) => ({
    householdId: r.household_id,
    snapshotMonth: r.snapshot_month,
    recordedAt: Number(r.recorded_at) || Date.now(),
    totalINR: Number(r.total_inr) || 0,
    totalUSD: Number(r.total_usd) || 0,
    indianEquityINR: Number(r.indian_equity_inr) || 0,
    foreignEquityINR: Number(r.foreign_equity_inr) || 0,
    debtINR: Number(r.debt_inr) || 0,
    realEstateEquityINR: Number(r.real_estate_equity_inr) || 0,
    realEstateLoanINR: Number(r.real_estate_loan_inr) || 0,
    fxRate: Number(r.fx_rate) || FX_FALLBACK_RATE,
    holdingsCount: Number(r.holdings_count) || 0,
    memberBreakdown: Array.isArray(r.member_breakdown) ? r.member_breakdown : [],
    providerBreakdown: r.provider_breakdown && typeof r.provider_breakdown === "object" ? r.provider_breakdown : {},
    holdingsBreakdown: Array.isArray(r.holdings_breakdown) ? r.holdings_breakdown : [],
    rebalanceMeta: r.rebalance_meta && typeof r.rebalance_meta === "object" ? r.rebalance_meta : {},
    source: r.source || "auto",
    note: r.note || ""
  }));
}

export async function deleteWealthSnapshotPg(householdId: string, snapshotMonth: string): Promise<void> {
  if (!pgReady || !pool) {
    fallbackSnapshots.get(householdId)?.delete(snapshotMonth);
    return;
  }
  await pool.query(
    "DELETE FROM uw_wealth_snapshots WHERE household_id = $1 AND snapshot_month = $2",
    [householdId, snapshotMonth]
  );
}

/**
 * Dedicated PostgreSQL table persistence for Real Estate properties & payment/loan ledgers.
 * Auto-migrates any legacy `uw_app_state` key (`real_estate:{householdId}`) transparently.
 */
export async function getRealEstatePg(householdId: string): Promise<RealEstateProperty[]> {
  if (!householdId) return [];
  if (!pgReady || !pool) {
    return fallbackRealEstate.get(householdId) || [];
  }

  const res = await pool.query(
    "SELECT properties FROM uw_real_estate WHERE household_id = $1 LIMIT 1",
    [householdId]
  );
  if (res.rows.length > 0 && Array.isArray(res.rows[0].properties)) {
    return res.rows[0].properties as RealEstateProperty[];
  }

  // Seamless one-time migration from uw_app_state('real_estate:{householdId}') if present
  const legacy = await getAppStateKeyPg<RealEstateProperty[]>(`real_estate:${householdId}`);
  if (Array.isArray(legacy) && legacy.length > 0) {
    await saveRealEstatePg(householdId, legacy);
    await setAppStateKeyPg(`real_estate:${householdId}`, null);
    return legacy;
  }

  return [];
}

export async function saveRealEstatePg(
  householdId: string,
  properties: RealEstateProperty[]
): Promise<void> {
  if (!householdId) return;
  const clean = Array.isArray(properties) ? properties : [];
  if (!pgReady || !pool) {
    fallbackRealEstate.set(householdId, clean);
    return;
  }
  await pool.query(
    `INSERT INTO uw_real_estate (household_id, properties, updated_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (household_id)
     DO UPDATE SET properties = EXCLUDED.properties, updated_at = EXCLUDED.updated_at`,
    [householdId, JSON.stringify(clean), Date.now()]
  );
}

export async function getTaxPlanningPg(householdId: string): Promise<HouseholdTaxPlanningBundle> {
  if (!householdId) {
    return { taxLots: [], rsuGrants: [], taxProfile: { ...DEFAULT_TAX_PROFILE } };
  }
  if (!pgReady || !pool) {
    return (
      fallbackTaxPlanning.get(householdId) || {
        taxLots: [],
        rsuGrants: [],
        taxProfile: { ...DEFAULT_TAX_PROFILE }
      }
    );
  }
  try {
    const res = await pool.query(
      "SELECT tax_lots, rsu_grants, tax_profile, updated_at FROM uw_tax_planning WHERE household_id = $1 LIMIT 1",
      [householdId]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        taxLots: Array.isArray(row.tax_lots) ? (row.tax_lots as TaxLot[]) : [],
        rsuGrants: Array.isArray(row.rsu_grants) ? (row.rsu_grants as RsuGrant[]) : [],
        taxProfile: {
          ...DEFAULT_TAX_PROFILE,
          ...(row.tax_profile && typeof row.tax_profile === "object"
            ? (row.tax_profile as Partial<TaxProfileSettings>)
            : {})
        },
        updatedAt: Number(row.updated_at) || Date.now()
      };
    }
  } catch (err: any) {
    console.warn("[Postgres] getTaxPlanningPg warning:", err.message);
  }
  return { taxLots: [], rsuGrants: [], taxProfile: { ...DEFAULT_TAX_PROFILE } };
}

export async function saveTaxPlanningPg(
  householdId: string,
  patch: Partial<HouseholdTaxPlanningBundle>
): Promise<HouseholdTaxPlanningBundle> {
  const existing = await getTaxPlanningPg(householdId);
  const merged: HouseholdTaxPlanningBundle = {
    taxLots: Array.isArray(patch.taxLots) ? patch.taxLots : existing.taxLots,
    rsuGrants: Array.isArray(patch.rsuGrants) ? patch.rsuGrants : existing.rsuGrants,
    taxProfile: patch.taxProfile
      ? { ...DEFAULT_TAX_PROFILE, ...existing.taxProfile, ...patch.taxProfile }
      : existing.taxProfile,
    updatedAt: Date.now()
  };

  if (!householdId) return merged;

  if (!pgReady || !pool) {
    fallbackTaxPlanning.set(householdId, merged);
    return merged;
  }

  await pool.query(
    `INSERT INTO uw_tax_planning (household_id, tax_lots, rsu_grants, tax_profile, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (household_id)
     DO UPDATE SET
       tax_lots = EXCLUDED.tax_lots,
       rsu_grants = EXCLUDED.rsu_grants,
       tax_profile = EXCLUDED.tax_profile,
       updated_at = EXCLUDED.updated_at`,
    [
      householdId,
      JSON.stringify(merged.taxLots),
      JSON.stringify(merged.rsuGrants),
      JSON.stringify(merged.taxProfile),
      merged.updatedAt
    ]
  );

  return merged;
}

export async function getRewardsHubPg(householdId: string): Promise<HouseholdRewardsBundle> {
  if (!householdId) {
    return { creditCards: [], loyaltyPrograms: [], activities: [] };
  }
  if (!pgReady || !pool) {
    return (
      fallbackRewardsHub.get(householdId) || {
        creditCards: [],
        loyaltyPrograms: [],
        activities: []
      }
    );
  }
  try {
    const res = await pool.query(
      "SELECT credit_cards, loyalty_programs, activities, updated_at FROM uw_rewards_hub WHERE household_id = $1 LIMIT 1",
      [householdId]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        creditCards: Array.isArray(row.credit_cards) ? (row.credit_cards as CreditCardAccount[]) : [],
        loyaltyPrograms: Array.isArray(row.loyalty_programs)
          ? (row.loyalty_programs as LoyaltyProgramAccount[])
          : [],
        activities: Array.isArray(row.activities) ? (row.activities as PointsActivityEntry[]) : [],
        updatedAt: Number(row.updated_at) || Date.now()
      };
    }
  } catch (err: any) {
    console.warn("[Postgres] getRewardsHubPg warning:", err.message);
  }
  return { creditCards: [], loyaltyPrograms: [], activities: [] };
}

export async function saveRewardsHubPg(
  householdId: string,
  patch: Partial<HouseholdRewardsBundle>
): Promise<HouseholdRewardsBundle> {
  const existing = await getRewardsHubPg(householdId);
  const merged: HouseholdRewardsBundle = {
    creditCards: Array.isArray(patch.creditCards) ? patch.creditCards : existing.creditCards,
    loyaltyPrograms: Array.isArray(patch.loyaltyPrograms)
      ? patch.loyaltyPrograms
      : existing.loyaltyPrograms,
    activities: Array.isArray(patch.activities)
      ? patch.activities.slice(0, 200)
      : existing.activities,
    updatedAt: Date.now()
  };

  if (!householdId) return merged;

  if (!pgReady || !pool) {
    fallbackRewardsHub.set(householdId, merged);
    return merged;
  }

  await pool.query(
    `INSERT INTO uw_rewards_hub (household_id, credit_cards, loyalty_programs, activities, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (household_id)
     DO UPDATE SET
       credit_cards = EXCLUDED.credit_cards,
       loyalty_programs = EXCLUDED.loyalty_programs,
       activities = EXCLUDED.activities,
       updated_at = EXCLUDED.updated_at`,
    [
      householdId,
      JSON.stringify(merged.creditCards),
      JSON.stringify(merged.loyaltyPrograms),
      JSON.stringify(merged.activities),
      merged.updatedAt
    ]
  );

  return merged;
}

export async function addNotificationPg(
  notif: Omit<NotificationRecord, "id" | "isRead" | "createdAt"> & { id?: string; createdAt?: number; type?: string }
): Promise<NotificationRecord> {
  const resolvedCategory = (notif.category || (notif as any).type || "system") as NotificationRecord["category"];
  const full: NotificationRecord = {
    id: notif.id || `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    householdId: notif.householdId,
    userId: notif.userId || "",
    category: resolvedCategory,
    severity: notif.severity || "info",
    title: notif.title,
    message: notif.message,
    actionTab: notif.actionTab || "",
    isRead: false,
    createdAt: notif.createdAt || Date.now()
  };

  if (!pgReady || !pool) {
    const arr = fallbackNotifications.get(full.householdId) || [];
    arr.unshift(full);
    fallbackNotifications.set(full.householdId, arr.slice(0, 60));
    return full;
  }

  try {
    await pool.query(
      `INSERT INTO uw_notifications (
         id, household_id, user_id, category, severity, title, message, action_tab, is_read, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        full.id,
        full.householdId,
        full.userId,
        full.category,
        full.severity,
        full.title,
        full.message,
        full.actionTab,
        full.isRead,
        full.createdAt
      ]
    );
    // Keep table bounded to latest 200 notifications per household asynchronously
    pool
      .query(
        `DELETE FROM uw_notifications
         WHERE household_id = $1
           AND id NOT IN (
             SELECT id FROM uw_notifications WHERE household_id = $1 ORDER BY created_at DESC LIMIT 200
           )`,
        [full.householdId]
      )
      .catch(() => {});
  } catch (err: any) {
    console.warn("[Postgres] addNotificationPg warning:", err.message);
  }
  return full;
}

export async function getNotificationsPg(householdId: string, limit = 40): Promise<NotificationRecord[]> {
  if (!pgReady || !pool) {
    return (fallbackNotifications.get(householdId) || []).slice(0, limit);
  }
  try {
    const res = await pool.query(
      `SELECT * FROM uw_notifications
       WHERE household_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [householdId, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      householdId: r.household_id,
      userId: r.user_id,
      category: r.category,
      severity: r.severity,
      title: r.title,
      message: r.message,
      actionTab: r.action_tab,
      isRead: Boolean(r.is_read),
      createdAt: Number(r.created_at) || Date.now()
    }));
  } catch {
    return (fallbackNotifications.get(householdId) || []).slice(0, limit);
  }
}

export async function markNotificationsReadPg(householdId: string, ids?: string[]): Promise<void> {
  if (!pgReady || !pool) {
    const mem = fallbackNotifications.get(householdId);
    if (mem) {
      const idSet = ids && ids.length > 0 ? new Set(ids) : null;
      mem.forEach((n) => {
        if (!idSet || idSet.has(n.id)) n.isRead = true;
      });
    }
    return;
  }
  if (ids && ids.length > 0) {
    await pool.query(
      "UPDATE uw_notifications SET is_read = TRUE WHERE household_id = $1 AND is_read = FALSE AND id = ANY($2::text[])",
      [householdId, ids]
    );
  } else {
    await pool.query(
      "UPDATE uw_notifications SET is_read = TRUE WHERE household_id = $1 AND is_read = FALSE",
      [householdId]
    );
  }
}

export async function getCachedQuotesPg(symbols: string[], maxAgeMs: number): Promise<Record<string, CachedQuoteRecord>> {
  const out: Record<string, CachedQuoteRecord> = {};
  if (!pgReady || !pool || symbols.length === 0) return out;
  try {
    const upper = Array.from(new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean)));
    if (upper.length === 0) return out;
    const minUpdated = Date.now() - maxAgeMs;
    const res = await pool.query(
      `SELECT * FROM uw_market_cache
       WHERE symbol = ANY($1::text[]) AND updated_at >= $2`,
      [upper, minUpdated]
    );
    for (const r of res.rows) {
      out[r.symbol] = {
        symbol: r.symbol,
        price: Number(r.price) || 0,
        prevClose: Number(r.prev_close) || 0,
        changePct: Number(r.change_pct) || 0,
        currency: r.currency || "USD",
        updatedAt: Number(r.updated_at) || 0
      };
    }
  } catch {
    // non-fatal
  }
  return out;
}

/**
 * Single bulk UNNEST query instead of N sequential pool.query round-trips!
 */
export async function upsertCachedQuotesPg(quotes: CachedQuoteRecord[]): Promise<void> {
  if (!pgReady || !pool || quotes.length === 0) return;
  try {
    // Deduplicate by uppercase symbol so Postgres ON CONFLICT DO UPDATE never sees duplicate target rows
    const dedup = new Map<string, CachedQuoteRecord>();
    for (const q of quotes) {
      if (!q.symbol || !(q.price > 0)) continue;
      dedup.set(q.symbol.toUpperCase(), q);
    }
    if (dedup.size === 0) return;

    const now = Date.now();
    const syms: string[] = [];
    const prices: number[] = [];
    const prevCloses: number[] = [];
    const changePcts: number[] = [];
    const currencies: string[] = [];
    const updatedAts: number[] = [];

    for (const [sym, q] of dedup.entries()) {
      syms.push(sym);
      prices.push(q.price);
      prevCloses.push(q.prevClose || 0);
      changePcts.push(q.changePct || 0);
      currencies.push(q.currency || "USD");
      updatedAts.push(q.updatedAt || now);
    }

    await pool.query(
      `INSERT INTO uw_market_cache (symbol, price, prev_close, change_pct, currency, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::float8[], $3::float8[], $4::float8[], $5::text[], $6::bigint[])
       ON CONFLICT (symbol) DO UPDATE SET
         price = EXCLUDED.price,
         prev_close = CASE WHEN EXCLUDED.prev_close > 0 THEN EXCLUDED.prev_close ELSE uw_market_cache.prev_close END,
         change_pct = EXCLUDED.change_pct,
         currency = EXCLUDED.currency,
         updated_at = EXCLUDED.updated_at`,
      [syms, prices, prevCloses, changePcts, currencies, updatedAts]
    );
  } catch {
    // non-fatal
  }
}

const NULL_SENTINEL = Symbol("NULL_APP_STATE");

export async function setAppStateKeyPg(key: string, payload: any): Promise<void> {
  if (!key) return;
  if (payload === null || payload === undefined) {
    appStateReadCache.set(key, NULL_SENTINEL);
    if (!pgReady || !pool) {
      fallbackStateKeys.delete(key);
      return;
    }
    try {
      await pool.query("DELETE FROM uw_app_state WHERE state_key = $1", [key]);
    } catch (err: any) {
      console.warn("[Postgres] deleteAppStateKeyPg error:", err.message);
    }
    return;
  }

  appStateReadCache.set(key, payload);
  if (!pgReady || !pool) {
    fallbackStateKeys.set(key, payload);
    return;
  }
  try {
    await pool.query(
      `INSERT INTO uw_app_state (state_key, payload, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (state_key)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(payload), Date.now()]
    );
  } catch (err: any) {
    console.warn("[Postgres] setAppStateKeyPg error:", err.message);
  }
}

export async function getAppStateKeyPg<T = any>(key: string): Promise<T | null> {
  if (!key) return null;
  const cached = appStateReadCache.get(key);
  if (cached !== undefined) {
    return cached === NULL_SENTINEL ? null : (cached as T);
  }

  if (pgReady && pool) {
    try {
      const res = await pool.query("SELECT payload FROM uw_app_state WHERE state_key = $1 LIMIT 1", [key]);
      if (res.rows.length > 0 && res.rows[0].payload !== undefined) {
        const val = res.rows[0].payload as T;
        appStateReadCache.set(key, val);
        return val;
      }
      appStateReadCache.set(key, NULL_SENTINEL);
      return null;
    } catch (err: any) {
      console.warn("[Postgres] getAppStateKeyPg error:", err.message);
    }
  }
  return (fallbackStateKeys.get(key) as T) ?? null;
}
