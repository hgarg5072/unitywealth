import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import express from "express";
import path from "path";
import cors from "cors";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import * as XLSX from "xlsx";
import https from "https";
import crypto from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";
import {
  initPostgresStore,
  getPostgresStatus,
  upsertInviteCodePg,
  getInviteCodePg,
  getInviteByHouseholdPg,
  upsertWealthSnapshotPg,
  getWealthHistoryPg,
  getMaxWealthSnapshotInrPg,
  deleteWealthSnapshotPg,
  getRealEstatePg,
  saveRealEstatePg,
  getTaxPlanningPg,
  saveTaxPlanningPg,
  addNotificationPg,
  getNotificationsPg,
  markNotificationsReadPg,
  getCachedQuotesPg,
  upsertCachedQuotesPg,
  setAppStateKeyPg,
  getAppStateKeyPg
} from "./src/server/postgresStore";
import {
  getEmailDeliveryStatus,
  saveHouseholdEmailConfig,
  sendHouseholdEmail,
  buildInvitationEmailContent,
  buildRebalanceEmailContent,
  resolveEmailConfig,
  EmailProviderType,
  StoredEmailConfig
} from "./src/server/emailService";
import {
  fetchGoogleSheetXlsxBuffer,
  parseRealEstateWorkbook
} from "./src/server/realEstateSheetImporter";
import {
  getAmfiIndex,
  searchAmfiIndex,
  findAmfiMatchIndexed
} from "./src/server/amfiIndex";
import { LRUCache } from "./src/shared/lruCache";
import {
  FX_FALLBACK_RATE,
  WEALTH_MILESTONES_INR,
  normalizeInviteCode
} from "./src/shared/formatters";
import {
  DEBT_KEYWORDS_REGEX,
  computePortfolioStats,
  computeRebalancePlan
} from "./src/shared/portfolioMath";

// Lazy Firebase Admin Firestore helper — only initialized if FIREBASE_SERVICE_ACCOUNT is configured
function getAdminFirestoreOrNull() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    if (getApps().length === 0) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({
        credential: cert(serviceAccount),
        projectId: firebaseConfig.projectId
      });
    }
    return getFirestore(firebaseConfig.firestoreDatabaseId);
  } catch (e) {
    console.warn("[Firestore Admin] Invalid FIREBASE_SERVICE_ACCOUNT JSON:", e);
    return null;
  }
}

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

async function callGeminiJSON(parts: any[]): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const modelsToTry = [
    {
      model: "gemini-3.5-flash-lite",
      timeout: 25000,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    },
    {
      model: "gemini-flash-lite-latest",
      timeout: 25000,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    },
    {
      model: "gemini-3.6-flash",
      timeout: 30000,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    },
    {
      model: "gemini-3.8-flash",
      timeout: 30000,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    }
  ];

  let lastErr: any = null;
  for (const candidate of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidate.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await axios.post(
        url,
        {
          contents: [{ role: "user", parts }],
          generationConfig: candidate.generationConfig
        },
        {
          timeout: candidate.timeout,
          httpsAgent: ipv4HttpsAgent,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: { "Content-Type": "application/json" }
        }
      );
      const outText =
        response.data?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text || "")
          .join("") || "";
      if (outText) return outText;
      throw new Error(`Empty response from ${candidate.model}`);
    } catch (err: any) {
      const status = err?.response?.status;
      const apiMsg = err?.response?.data?.error?.message || err.message;
      console.warn(`[Gemini] ${candidate.model} failed (${status || "ERR"}): ${apiMsg}`);
      lastErr = new Error(apiMsg);
      if (status === 400 && /API key not valid/i.test(String(apiMsg))) {
        throw lastErr;
      }
    }
  }
  throw lastErr || new Error("Gemini request failed");
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // O(1) in-memory Family Invite Code index backed by PostgreSQL (uw_invite_codes)
  const inviteCodesByCode = new Map<string, any>();
  const inviteCodeByHousehold = new Map<string, string>();

  function cacheInviteEntry(entry: any) {
    if (!entry?.code || !entry?.householdId) return;
    const clean = normalizeInviteCode(entry.code);
    if (!clean) return;
    const prevCode = inviteCodeByHousehold.get(entry.householdId);
    if (prevCode && prevCode !== clean) {
      inviteCodesByCode.delete(prevCode);
    }
    const normalizedEntry = { ...entry, code: clean };
    inviteCodesByCode.set(clean, normalizedEntry);
    inviteCodeByHousehold.set(entry.householdId, clean);
  }

  // Initialize managed PostgreSQL persistence & hydrate invite codes across container restarts
  try {
    const pgInit = await initPostgresStore();
    if (pgInit.connected) {
      if (pgInit.restoredDbJson?.inviteCodes && typeof pgInit.restoredDbJson.inviteCodes === "object") {
        for (const entry of Object.values(pgInit.restoredDbJson.inviteCodes)) {
          cacheInviteEntry(entry);
        }
      }
      for (const entry of Object.values(pgInit.restoredInviteCodes || {})) {
        cacheInviteEntry(entry);
      }
      if (inviteCodesByCode.size > 0) {
        console.log(`[Postgres] Hydrated ${inviteCodesByCode.size} family invite code(s) into O(1) index.`);
      }
    }
  } catch (pgBootErr: any) {
    console.warn("[Postgres] Startup hydration skipped:", pgBootErr.message);
  }

  // Bounded LRU caches for Firebase JWT verification & household membership checks
  const idTokenAuthCache = new LRUCache<string, { uid: string; email: string; name: string }>(500, 5 * 60 * 1000);
  const householdAccessCache = new LRUCache<string, any>(500, 45 * 1000);

  function hashTokenKey(idToken: string): string {
    return crypto.createHash("sha256").update(idToken).digest("hex");
  }

  async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string; name: string }> {
    const cacheKey = hashTokenKey(idToken);
    const cached = idTokenAuthCache.get(cacheKey);
    if (cached) return cached;

    const resp = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      { idToken },
      { timeout: 10000, httpsAgent: ipv4HttpsAgent }
    );
    const u = resp.data?.users?.[0];
    if (!u?.localId) {
      throw new Error("Invalid Firebase authentication token");
    }
    const caller = {
      uid: u.localId,
      email: (u.email || "").toLowerCase(),
      name: u.displayName || ""
    };
    idTokenAuthCache.set(cacheKey, caller);
    return caller;
  }

  async function refreshFirebaseIdToken(refreshToken: string): Promise<string> {
    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", refreshToken);
    const resp = await axios.post(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      params.toString(),
      {
        timeout: 10000,
        httpsAgent: ipv4HttpsAgent,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );
    if (!resp.data?.id_token) {
      throw new Error("Failed to refresh household authorization token");
    }
    return resp.data.id_token;
  }

  async function firestoreRestGet(docPath: string, idToken: string): Promise<any> {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${docPath}`;
    const resp = await axios.get(url, {
      timeout: 10000,
      httpsAgent: ipv4HttpsAgent,
      headers: { Authorization: `Bearer ${idToken}` }
    });
    return resp.data;
  }

  async function firestoreRestPatch(docPath: string, fieldPaths: string[], fields: any, idToken: string): Promise<any> {
    const maskQuery = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${docPath}?${maskQuery}`;
    const resp = await axios.patch(
      url,
      { fields },
      {
        timeout: 10000,
        httpsAgent: ipv4HttpsAgent,
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    return resp.data;
  }

  async function verifyCallerHouseholdAccess(req: express.Request, householdId: string) {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
    if (!idToken) {
      throw Object.assign(new Error("Missing authorization token"), { statusCode: 401 });
    }
    const caller = await verifyFirebaseIdToken(idToken);
    const accessKey = `${caller.uid}:${householdId}`;
    const cachedHhDoc = householdAccessCache.get(accessKey);
    if (cachedHhDoc) {
      return { caller, hhDoc: cachedHhDoc };
    }

    const hhDoc = await firestoreRestGet(`households/${householdId}`, idToken);
    const memberValues: any[] = hhDoc?.fields?.members?.arrayValue?.values || [];
    const memberIds = memberValues.map((v: any) => v.stringValue).filter(Boolean);
    if (!memberIds.includes(caller.uid)) {
      throw Object.assign(new Error("Forbidden: not a member of this household"), { statusCode: 403 });
    }
    householdAccessCache.set(accessKey, hhDoc);
    return { caller, hhDoc };
  }

  // Shared 30-minute single-flight USD/INR exchange rate cache
  let fxRateState: { inr: number; ts: number; inFlight: Promise<number> | null } = {
    inr: FX_FALLBACK_RATE,
    ts: 0,
    inFlight: null
  };
  const FX_CACHE_TTL_MS = 30 * 60 * 1000;

  async function getUsdInrRate(): Promise<number> {
    const now = Date.now();
    if (fxRateState.ts > 0 && now - fxRateState.ts < FX_CACHE_TTL_MS) {
      return fxRateState.inr;
    }
    if (fxRateState.inFlight) return fxRateState.inFlight;

    fxRateState.inFlight = (async () => {
      try {
        const res = await axios.get("https://open.er-api.com/v6/latest/USD", { timeout: 5000 });
        const rate = Number(res.data?.rates?.INR);
        if (rate > 0) {
          fxRateState.inr = rate;
          fxRateState.ts = Date.now();
        }
      } catch (err: any) {
        console.warn("[FX] Rate refresh failed, using cached/fallback:", err.message);
      }
      return fxRateState.inr;
    })().finally(() => {
      fxRateState.inFlight = null;
    });

    return fxRateState.inFlight;
  }

  // API Routes
  app.get("/api/health", async (req, res) => {
    const pgStatus = getPostgresStatus();
    const emailStatus = await getEmailDeliveryStatus();
    res.json({
      status: "ok",
      postgres: pgStatus.connected,
      postgresPool: pgStatus,
      resend: !!process.env.RESEND_API_KEY,
      google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      emailConfigured: emailStatus.configured,
      emailProvider: emailStatus.provider,
      emailSender: emailStatus.senderEmail,
      appUrl: process.env.APP_URL
    });
  });

  function resolveRequestBaseUrl(req: express.Request): string {
    const host = req.get("host") || "";
    const proto = req.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    if (host && !host.includes("localhost") && !host.startsWith("127.")) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
    return (process.env.APP_URL || `${proto}://${host}` || "https://unitywealth.up.railway.app").replace(/\/$/, "");
  }

  function getRedirectUri(req: express.Request) {
    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
    const detectedUri = `${protocol}://${host}/auth/callback`;

    if (host && !host.includes("localhost") && !host.startsWith("127.")) {
      return detectedUri;
    }

    if (process.env.APP_URL) {
      const appUrl = process.env.APP_URL.replace(/\/$/, "");
      if (host?.includes("localhost")) {
        return `http://${host}/auth/callback`;
      }
      return `${appUrl}/auth/callback`;
    }

    return detectedUri;
  }

  function getGoogleClient(req: express.Request) {
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri(req)
    );
  }

  app.get("/api/auth/google/url", (req, res) => {
    const client = getGoogleClient(req);
    const redirectUri = getRedirectUri(req);
    const householdId = typeof req.query.householdId === "string" ? req.query.householdId : "";
    const userId = typeof req.query.userId === "string" ? req.query.userId : "";
    const loginHint =
      typeof req.query.loginHint === "string" && req.query.loginHint
        ? req.query.loginHint
        : "unitywealth.alerts@gmail.com";
    const statePayload = Buffer.from(JSON.stringify({ householdId, userId })).toString("base64url");

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      login_hint: loginHint,
      state: statePayload,
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.send"
      ]
    });
    res.json({ url, redirectUri });
  });

  app.get("/connect-sender", (req, res) => {
    const client = getGoogleClient(req);
    const statePayload = Buffer.from(JSON.stringify({ householdId: "", userId: "system_sender" })).toString("base64url");
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      login_hint: "unitywealth.alerts@gmail.com",
      state: statePayload,
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.send"
      ]
    });
    res.redirect(302, url);
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code, state } = req.query;
    if (typeof code !== "string") return res.status(400).send("No code provided");

    const client = getGoogleClient(req);
    let parsedState: { householdId?: string; userId?: string } = {};
    if (typeof state === "string" && state) {
      try {
        parsedState = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      } catch {
        // ignore invalid state
      }
    }

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      const oauth2 = axios.create({
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await oauth2.get("https://www.googleapis.com/oauth2/v2/userinfo");
      const { email, name } = profile.data;

      const existingCfg = await resolveEmailConfig(parsedState.householdId);
      const prevUserTokens = parsedState.userId
        ? await getAppStateKeyPg<any>(`gmail_tokens:${parsedState.userId}`)
        : null;
      const mergedTokens = {
        access_token: tokens.access_token || undefined,
        refresh_token:
          tokens.refresh_token ||
          existingCfg?.tokens?.refresh_token ||
          prevUserTokens?.refresh_token ||
          undefined,
        expiry_date: tokens.expiry_date || Date.now() + 50 * 60 * 1000,
        scope: tokens.scope || undefined
      };

      const isOfficial = email.toLowerCase() === "unitywealth.alerts@gmail.com";
      const resolvedSenderName = isOfficial ? "UnityWealth" : name || "UnityWealth Family Office";

      await saveHouseholdEmailConfig(parsedState.householdId || null, {
        provider: "gmail_oauth",
        senderEmail: email,
        senderName: resolvedSenderName,
        tokens: mergedTokens,
        updatedAt: Date.now()
      });
      await setAppStateKeyPg(`gmail_tokens:${parsedState.userId || email.toLowerCase()}`, mergedTokens);
      if (parsedState.userId) {
        await setAppStateKeyPg(`gmail_tokens:${email.toLowerCase()}`, mergedTokens);
      }

      res.send(`
        <!doctype html>
        <html>
          <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Gmail Connected — UnityWealth</title></head>
          <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:40px 16px;text-align:center;color:#0f172a;">
            <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;padding:32px 24px;box-shadow:0 10px 28px rgba(15,23,42,0.08);">
              <div style="width:52px;height:52px;border-radius:16px;background:${isOfficial ? "#dcfce7" : "#e0e7ff"};color:${isOfficial ? "#15803d" : "#4338ca"};font-size:24px;font-weight:900;line-height:52px;margin:0 auto 14px;">✓</div>
              <h3 style="margin:0 0 8px;font-size:18px;font-weight:800;">${isOfficial ? "Official UnityWealth Sender Active!" : "Gmail Sender Connected"}</h3>
              <p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.55;">
                All Family Invitations &amp; 24/7 Rebalance Reports will now send from <strong>${resolvedSenderName} &lt;${email}&gt;</strong>.
              </p>
              ${
                !isOfficial
                  ? `
              <div style="margin:0 0 18px;padding:12px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;font-size:12px;color:#92400e;line-height:1.45;">
                Want to use <strong>unitywealth.alerts@gmail.com</strong> instead?
                <div style="margin-top:8px;">
                  <a href="/connect-sender" style="display:inline-block;padding:8px 14px;border-radius:9px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;font-size:12px;">Switch to unitywealth.alerts@gmail.com</a>
                </div>
              </div>
              `
                  : ""
              }
              <a href="/?emailConnected=1" style="display:inline-block;padding:11px 22px;border-radius:12px;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;">
                Return to UnityWealth
              </a>
            </div>
            <script>
              (function() {
                var payload = {
                  type: 'OAUTH_EMAIL_CONNECTED',
                  senderEmail: ${JSON.stringify(email)},
                  ts: Date.now()
                };
                try {
                  var bc = new BroadcastChannel('uw_email_oauth');
                  bc.postMessage(payload);
                  bc.close();
                } catch (e) {}
                try {
                  localStorage.setItem('uw_email_oauth_event', JSON.stringify(payload));
                } catch (e) {}
                if (window.opener) {
                  try {
                    window.opener.postMessage(payload, '*');
                  } catch (e) {}
                }
                setTimeout(function() {
                  window.close();
                }, 350);
              })();
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Google Auth Error:", error?.response?.data || error.message);
      res.status(500).send("Authentication failed: " + (error?.response?.data?.error_description || error.message));
    }
  });

  // --- Email Delivery Configuration & Diagnostics APIs ---
  app.get("/api/email/status", async (req, res) => {
    try {
      const householdId = typeof req.query.householdId === "string" ? req.query.householdId : null;
      const status = await getEmailDeliveryStatus(householdId);
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to read email status" });
    }
  });

  app.post("/api/email/save-google-token", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
      if (!idToken) return res.status(401).json({ error: "Authentication token required" });

      const caller = await verifyFirebaseIdToken(idToken);
      const { householdId, accessToken, senderEmail, senderName } = req.body || {};
      if (!accessToken) return res.status(400).json({ error: "Google OAuth accessToken is required" });

      const existing = await resolveEmailConfig(householdId);
      const keepRefresh =
        existing &&
        (existing.provider === "gmail_oauth" || existing.provider === "gmail_token") &&
        existing.senderEmail?.toLowerCase() === (senderEmail || caller.email).toLowerCase()
          ? existing.tokens?.refresh_token
          : undefined;

      const cfg: StoredEmailConfig = {
        provider: keepRefresh ? "gmail_oauth" : "gmail_token",
        senderEmail: (senderEmail || caller.email || "").trim(),
        senderName: (senderName || caller.name || "UnityWealth Family Office").trim(),
        tokens: {
          access_token: accessToken,
          refresh_token: keepRefresh,
          expiry_date: Date.now() + 50 * 60 * 1000
        },
        updatedAt: Date.now()
      };
      await saveHouseholdEmailConfig(householdId, cfg);
      const status = await getEmailDeliveryStatus(householdId);
      res.json({ success: true, status });
    } catch (e: any) {
      console.error("[SaveGoogleToken Error]", e.message);
      res.status(500).json({ error: e.message || "Failed to store Gmail token" });
    }
  });

  app.post("/api/email/configure-provider", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
      if (!idToken) return res.status(401).json({ error: "Authentication token required" });

      const caller = await verifyFirebaseIdToken(idToken);
      const { householdId, provider, senderEmail, senderName, apiKey } = req.body || {};

      if (provider === "none" || provider === "disconnect") {
        await saveHouseholdEmailConfig(householdId, null);
        const status = await getEmailDeliveryStatus(householdId);
        return res.json({ success: true, status });
      }

      const validProviders: EmailProviderType[] = ["brevo", "resend", "gmail_smtp"];
      if (!validProviders.includes(provider)) {
        return res.status(400).json({ error: "Unsupported email provider" });
      }
      if (!apiKey || !String(apiKey).trim()) {
        return res.status(400).json({ error: "API Key or App Password is required" });
      }
      const cleanEmail = String(senderEmail || (provider === "resend" ? "onboarding@resend.dev" : caller.email) || "").trim();
      if (!cleanEmail.includes("@")) {
        return res.status(400).json({ error: "Valid sender email address is required" });
      }

      const cfg: StoredEmailConfig = {
        provider,
        senderEmail: cleanEmail,
        senderName: String(senderName || caller.name || "UnityWealth Family Office").trim(),
        apiKey: String(apiKey).trim(),
        updatedAt: Date.now()
      };
      await saveHouseholdEmailConfig(householdId, cfg);
      const status = await getEmailDeliveryStatus(householdId);
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to save email provider" });
    }
  });

  app.post("/api/email/test", async (req, res) => {
    try {
      const { email, householdId } = req.body || {};
      if (!email || !String(email).includes("@")) {
        return res.status(400).json({ error: "Valid recipient email is required" });
      }
      const subject = "UnityWealth — Email delivery confirmed";
      const text = `Hi,\n\nYour UnityWealth family portfolio email notifications are active for ${email}.\n\nFamily invitations and rebalance summaries will be delivered from UnityWealth <unitywealth.alerts@gmail.com>.\n\nSent at ${new Date().toLocaleString("en-IN")}.\n\n— UnityWealth`;
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;background:#f8fafc;color:#0f172a;">
          <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
            <div style="font-size:12px;font-weight:700;color:#4f46e5;margin-bottom:6px;">UnityWealth</div>
            <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a;">Email delivery confirmed</h2>
            <p style="margin:0;color:#334155;font-size:14px;line-height:1.6;">
              Your household email notifications are active for <strong>${String(email).trim()}</strong>. Family invitations and rebalance summaries will arrive from this address.
            </p>
          </div>
        </div>`;

      const result = await sendHouseholdEmail({
        householdId,
        to: String(email).trim(),
        subject,
        text,
        html
      });
      res.json({
        success: result.sent,
        ...result
      });
    } catch (e: any) {
      res.status(500).json({ success: false, sent: false, error: e.message });
    }
  });

  app.post("/api/auth/google/save-tokens", async (req, res) => {
    const { userId, tokens, householdId, email, name } = req.body || {};
    if (userId && tokens) {
      await setAppStateKeyPg(`gmail_tokens:${userId}`, tokens);
    }
    if (tokens?.access_token && email) {
      await saveHouseholdEmailConfig(householdId, {
        provider: tokens.refresh_token ? "gmail_oauth" : "gmail_token",
        senderEmail: email,
        senderName: name || "UnityWealth Family Office",
        tokens,
        updatedAt: Date.now()
      });
    }
    res.json({ success: true });
  });

  // Lightweight Gmail CAS Sync via Gmail REST API (zero heavy googleapis SDK, metadata-first maxResults=1)
  app.post("/api/sync/gmail", async (req, res) => {
    try {
      const { userId, householdId } = req.body || {};
      const storedTokens =
        (userId ? await getAppStateKeyPg<any>(`gmail_tokens:${userId}`) : null) ||
        (await resolveEmailConfig(householdId))?.tokens;

      if (!storedTokens?.access_token && !storedTokens?.refresh_token) {
        return res.status(400).json({ error: "User hasn't connected Gmail with statement read access yet." });
      }

      const oAuth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oAuth2Client.setCredentials(storedTokens);
      const tokenResp = await oAuth2Client.getAccessToken();
      const accessToken = tokenResp?.token || storedTokens.access_token;
      if (!accessToken) {
        return res.status(401).json({ error: "Gmail token expired. Please reconnect Gmail." });
      }

      const gmailHttp = axios.create({
        baseURL: "https://gmail.googleapis.com/gmail/v1/users/me",
        timeout: 12000,
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const q =
        'from:(donotreply@camsonline.com OR donotreply@kfintech.com OR MFCentral) ("Consolidated Account Statement" OR "Account Statement") filename:pdf';
      const listRes = await gmailHttp.get("/messages", { params: { q, maxResults: 1 } });
      const latestMsgId = listRes.data?.messages?.[0]?.id;
      if (!latestMsgId) {
        return res.json({ success: true, count: 0, message: "No CAS statements found in Gmail" });
      }

      const msgRes = await gmailHttp.get(`/messages/${encodeURIComponent(latestMsgId)}`);
      const parts: any[] = msgRes.data?.payload?.parts || [];
      const pdfPart = parts.find(
        (p: any) => p?.filename && String(p.filename).toLowerCase().endsWith(".pdf") && p?.body?.attachmentId
      );
      if (!pdfPart) {
        return res.json({ success: true, count: 0, message: "No PDF attachment found on latest CAS email" });
      }

      const attachRes = await gmailHttp.get(
        `/messages/${encodeURIComponent(latestMsgId)}/attachments/${encodeURIComponent(pdfPart.body.attachmentId)}`
      );
      const base64Data = String(attachRes.data?.data || "").replace(/-/g, "+").replace(/_/g, "/");
      if (!base64Data) {
        return res.json({ success: true, count: 0, message: "Empty CAS attachment" });
      }

      const rawJson = await callGeminiJSON([
        {
          text:
            "Extract all investment holdings (Stocks, Mutual Funds, ETFs) from this PDF.\n" +
            "Return as a JSON array of objects with keys: schemeName, originalName, units, nav, assetClass ('Equity' | 'Debt' | 'Mutual Fund'). Ignore zero balances."
        },
        { inlineData: { data: base64Data, mimeType: "application/pdf" } }
      ]);
      const extracted = JSON.parse((rawJson || "[]").replace(/```json/g, "").replace(/```/g, "").trim());
      res.json({
        success: true,
        count: Array.isArray(extracted) ? extracted.length : 0,
        filename: pdfPart.filename,
        holdings: Array.isArray(extracted) ? extracted : []
      });
    } catch (e: any) {
      console.error("Gmail Sync Error:", e?.response?.data || e.message);
      res.status(500).json({ error: e?.response?.data?.error?.message || e.message || "Gmail sync failed" });
    }
  });

  app.post("/api/sync/request-cas", async (_req, res) => {
    res.json({ success: true, message: "CAS request initiated" });
  });

  app.post("/api/debug/send-test-email", async (req, res) => {
    const { email, householdId } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    const subject = "[UnityWealth] Test Email Delivery";
    const text = "Hi!\n\nYour UnityWealth outgoing email gateway is active and verified for Family Invitations and Rebalance Reports.";
    const html = `<div style="font-family:sans-serif;padding:20px;"><h2>UnityWealth Email Gateway Verified</h2><p>Your outgoing email sender is active and ready to deliver Family Invitations and Rebalance Plans.</p></div>`;
    const result = await sendHouseholdEmail({ householdId, to: String(email).trim(), subject, text, html });
    res.json({
      success: result.sent,
      message: result.sent
        ? `Test email sent via ${result.provider} (${result.senderEmail})`
        : result.error || "Email not sent",
      ...result
    });
  });

  function generateInviteCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = "";
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        code += alphabet[bytes[i] % alphabet.length];
      }
      if (!inviteCodesByCode.has(code)) return code;
    }
    return crypto.randomBytes(3).toString("hex").toUpperCase();
  }

  // Register or sync a household's shareable Invite Code (backed by member auth + PostgreSQL)
  app.post("/api/household/invite-code", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
      const { householdId, householdName, inviterName, refreshToken, preferredCode, toEmail } = req.body || {};

      if (!idToken || !householdId) {
        return res.status(400).json({ error: "Missing authentication token or householdId" });
      }

      const { caller, hhDoc } = await verifyCallerHouseholdAccess(req, householdId);
      const resolvedHouseholdName =
        householdName || hhDoc?.fields?.name?.stringValue || "Family Portfolio";
      const firestoreStoredCode = normalizeInviteCode(
        hhDoc?.fields?.settings?.mapValue?.fields?.inviteCode?.stringValue || ""
      );

      const existingCodeForHh = inviteCodeByHousehold.get(householdId);
      let existingEntry = existingCodeForHh ? inviteCodesByCode.get(existingCodeForHh) : null;
      if (!existingEntry) {
        existingEntry = await getInviteByHouseholdPg(householdId);
        if (existingEntry) cacheInviteEntry(existingEntry);
      }

      const requestedClean = normalizeInviteCode(preferredCode || firestoreStoredCode);
      let code = "";
      const requestedOwner = requestedClean ? inviteCodesByCode.get(requestedClean) : null;

      if (requestedClean && requestedClean.length >= 4 && (!requestedOwner || requestedOwner.householdId === householdId)) {
        code = requestedClean;
      } else if (existingEntry?.code) {
        code = existingEntry.code;
      } else {
        code = generateInviteCode();
      }

      const entry = {
        code,
        householdId,
        householdName: resolvedHouseholdName,
        inviterUid: caller.uid,
        inviterName: inviterName || caller.name || caller.email,
        refreshToken: refreshToken || existingEntry?.refreshToken || "",
        lastIdToken: idToken,
        lastTokenAt: Date.now(),
        updatedAt: Date.now()
      };
      cacheInviteEntry(entry);
      await upsertInviteCodePg(entry);

      const shareBaseUrl = (process.env.SHORT_URL || resolveRequestBaseUrl(req)).replace(/\/$/, "");
      const joinUrl = `${shareBaseUrl}/j/${code}`;

      let emailOutcome: any = null;
      if (toEmail && typeof toEmail === "string") {
        const cleanEmail = toEmail.trim().toLowerCase();
        if (cleanEmail) {
          const content = buildInvitationEmailContent({
            householdName: resolvedHouseholdName,
            inviterName: inviterName || caller.name || caller.email || "A family member",
            inviteCode: code,
            joinUrl
          });
          emailOutcome = await sendHouseholdEmail({
            householdId,
            to: cleanEmail,
            subject: content.subject,
            text: content.text,
            html: content.html
          });

          if (emailOutcome.sent) {
            await addNotificationPg({
              householdId,
              category: "family",
              severity: "info",
              title: "Family Invitation Emailed",
              message: `Sent invite code ${code} to ${cleanEmail} via ${emailOutcome.senderEmail || emailOutcome.provider}.`,
              actionTab: "accounts",
              createdAt: Date.now()
            }).catch(() => {});
          }
        }
      }

      res.json({
        success: true,
        code,
        householdId,
        householdName: resolvedHouseholdName,
        joinUrl,
        emailSent: emailOutcome ? emailOutcome.sent : undefined,
        emailProvider: emailOutcome?.provider,
        senderEmail: emailOutcome?.senderEmail,
        emailError: emailOutcome?.error,
        gmailComposeUrl: emailOutcome?.gmailComposeUrl,
        mailtoUrl: emailOutcome?.mailtoUrl
      });
    } catch (e: any) {
      const status = e?.statusCode || (e?.response?.status === 403 ? 403 : 500);
      console.error("[InviteCode] Error:", e?.response?.data || e.message);
      res.status(status).json({ error: e?.response?.data?.error?.message || e.message || "Failed to generate invite code" });
    }
  });

  // Short invite redirect link (e.g. https://unitywealth.up.railway.app/j/K7M4P9 -> /?invite=K7M4P9)
  app.get("/j/:code", (req, res) => {
    const clean = normalizeInviteCode(req.params.code);
    return res.redirect(302, clean ? `/?invite=${encodeURIComponent(clean)}` : "/");
  });

  // Public preview of an invite code (returns household name & inviter display name only)
  app.get("/api/household/invite-info/:code", async (req, res) => {
    const code = normalizeInviteCode(req.params.code);
    if (!code) return res.status(400).json({ error: "Invite code is required" });
    let entry = inviteCodesByCode.get(code);
    if (!entry) {
      entry = await getInviteCodePg(code);
      if (entry) cacheInviteEntry(entry);
    }
    if (!entry) {
      return res.status(404).json({
        error: "Invalid or expired invite code. Ask your family admin to open Invite and copy the latest code."
      });
    }
    res.json({
      valid: true,
      code: entry.code,
      householdId: entry.householdId,
      householdName: entry.householdName || "Family Portfolio",
      inviterName: entry.inviterName || "Family Member"
    });
  });

  // Redeem an Invite Code and add the authenticated user to the household
  app.post("/api/household/redeem-invite", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const joinerIdToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
      const { code: rawCode, householdId: requestedHouseholdId } = req.body || {};

      if (!joinerIdToken) {
        return res.status(401).json({ error: "Please sign in first to join a family portfolio." });
      }

      const joiner = await verifyFirebaseIdToken(joinerIdToken);
      const cleanCode = normalizeInviteCode(rawCode || "");

      let entry: any = null;
      if (cleanCode && inviteCodesByCode.has(cleanCode)) {
        entry = inviteCodesByCode.get(cleanCode);
      } else if (cleanCode) {
        entry = await getInviteCodePg(cleanCode);
        if (entry) cacheInviteEntry(entry);
      } else if (requestedHouseholdId) {
        const hhCode = inviteCodeByHousehold.get(requestedHouseholdId);
        entry = hhCode ? inviteCodesByCode.get(hhCode) : null;
        if (!entry) {
          entry = await getInviteByHouseholdPg(requestedHouseholdId);
          if (entry) cacheInviteEntry(entry);
        }
      }

      if (!entry) {
        return res.status(404).json({
          error: cleanCode
            ? `Invite code "${cleanCode}" was not found. Please verify the 6-character code from your family admin's Invite dialog.`
            : "This invitation requires an active household invite token. Ask your family admin to copy their Family Invite Code and enter it here."
        });
      }

      let memberAuthToken = "";
      if (entry.refreshToken) {
        memberAuthToken = await refreshFirebaseIdToken(entry.refreshToken);
        entry.lastIdToken = memberAuthToken;
        entry.lastTokenAt = Date.now();
      } else if (entry.lastIdToken && Date.now() - (entry.lastTokenAt || 0) < 50 * 60 * 1000) {
        memberAuthToken = entry.lastIdToken;
      } else {
        return res.status(400).json({
          error: "Invite session expired. Ask your family admin to open UnityWealth once to refresh the invite link."
        });
      }

      const hhDoc = await firestoreRestGet(`households/${entry.householdId}`, memberAuthToken);
      const currentValues: any[] = hhDoc?.fields?.members?.arrayValue?.values || [];
      const currentMembers = currentValues.map((v: any) => v.stringValue).filter(Boolean);

      if (!currentMembers.includes(joiner.uid)) {
        const nextMembers = [...currentMembers, joiner.uid];
        await firestoreRestPatch(
          `households/${entry.householdId}`,
          ["members"],
          {
            members: {
              arrayValue: {
                values: nextMembers.map((m) => ({ stringValue: m }))
              }
            }
          },
          memberAuthToken
        );
      }

      const resolvedHouseholdName = hhDoc?.fields?.name?.stringValue || entry.householdName || "Family Portfolio";
      cacheInviteEntry(entry);
      await upsertInviteCodePg(entry);
      householdAccessCache.delete(`${joiner.uid}:${entry.householdId}`);

      await addNotificationPg({
        householdId: entry.householdId,
        userId: joiner.uid,
        category: "family",
        severity: "success",
        title: "New Family Member Joined",
        message: `${joiner.name || joiner.email} joined ${resolvedHouseholdName} and linked their portfolio.`,
        actionTab: "accounts"
      });
      res.json({
        success: true,
        householdId: entry.householdId,
        householdName: resolvedHouseholdName
      });
    } catch (e: any) {
      console.error("[RedeemInvite] Error:", e?.response?.data || e.message);
      res.status(500).json({
        error: e?.response?.data?.error?.message || e.message || "Failed to join household"
      });
    }
  });

  // --- Wealth History & Monthly Net Worth Tracking (PostgreSQL-backed) ---
  app.get("/api/wealth-history/:householdId", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const history = await getWealthHistoryPg(householdId);

      let momChangeINR = 0;
      let momChangePct = 0;
      let totalGrowthINR = 0;
      let totalGrowthPct = 0;
      if (history.length >= 2) {
        const latest = history[history.length - 1];
        const prev = history[history.length - 2];
        const first = history[0];
        momChangeINR = latest.totalINR - prev.totalINR;
        momChangePct = prev.totalINR > 0 ? ((latest.totalINR - prev.totalINR) / prev.totalINR) * 100 : 0;
        totalGrowthINR = latest.totalINR - first.totalINR;
        totalGrowthPct = first.totalINR > 0 ? ((latest.totalINR - first.totalINR) / first.totalINR) * 100 : 0;
      }

      res.json({
        householdId,
        snapshots: history,
        summary: {
          monthsTracked: history.length,
          momChangeINR,
          momChangePct,
          totalGrowthINR,
          totalGrowthPct,
          peakINR: history.reduce((m, s) => Math.max(m, s.totalINR), 0)
        }
      });
    } catch (e: any) {
      const code = e.statusCode || (e?.response?.status === 403 ? 403 : 500);
      res.status(code).json({ error: e.message || "Failed to load wealth history" });
    }
  });

  function formatMilestoneCroreLakh(val: number): string {
    if (val >= 1_00_00_000) return `₹${(val / 1_00_00_000).toFixed(val % 1_00_00_000 === 0 ? 0 : 1)} Cr`;
    return `₹${(val / 1_00_000).toFixed(0)} Lakh`;
  }

  app.post("/api/wealth-history/record", async (req, res) => {
    try {
      const {
        householdId,
        snapshotMonth,
        totalINR,
        totalUSD,
        indianEquityINR,
        foreignEquityINR,
        debtINR,
        realEstateEquityINR,
        realEstateLoanINR,
        fxRate,
        holdingsCount,
        memberBreakdown,
        providerBreakdown,
        holdingsBreakdown,
        rebalanceMeta,
        source,
        note
      } = req.body || {};

      if (!householdId || !(Number(totalINR) > 0)) {
        return res.status(400).json({ error: "householdId and positive totalINR are required" });
      }

      const { caller } = await verifyCallerHouseholdAccess(req, householdId);

      const now = new Date();
      const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const cleanMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(snapshotMonth || ""))
        ? String(snapshotMonth)
        : defaultMonth;

      // Single lightweight SQL MAX(total_inr) query instead of fetching full JSONB snapshot history twice
      const previousMax = await getMaxWealthSnapshotInrPg(householdId, cleanMonth);
      const rate = Number(fxRate) || FX_FALLBACK_RATE;

      const saved = await upsertWealthSnapshotPg({
        householdId,
        snapshotMonth: cleanMonth,
        recordedAt: Date.now(),
        totalINR: Number(totalINR) || 0,
        totalUSD: Number(totalUSD) || Number(totalINR) / rate,
        indianEquityINR: Number(indianEquityINR) || 0,
        foreignEquityINR: Number(foreignEquityINR) || 0,
        debtINR: Number(debtINR) || 0,
        realEstateEquityINR: Number(realEstateEquityINR) || 0,
        realEstateLoanINR: Number(realEstateLoanINR) || 0,
        fxRate: rate,
        holdingsCount: Number(holdingsCount) || 0,
        memberBreakdown: Array.isArray(memberBreakdown) ? memberBreakdown : [],
        providerBreakdown: providerBreakdown && typeof providerBreakdown === "object" ? providerBreakdown : {},
        holdingsBreakdown: Array.isArray(holdingsBreakdown) ? holdingsBreakdown : [],
        rebalanceMeta: rebalanceMeta && typeof rebalanceMeta === "object" ? rebalanceMeta : {},
        source: String(source || "auto"),
        note: String(note || "")
      });

      if (previousMax > 0 && saved.totalINR > previousMax) {
        const newlyCrossed = WEALTH_MILESTONES_INR.filter(
          (ms) => previousMax < ms && saved.totalINR >= ms
        );
        if (newlyCrossed.length > 0) {
          const topMs = newlyCrossed[newlyCrossed.length - 1];
          await addNotificationPg({
            householdId,
            userId: caller.uid,
            category: "milestone",
            severity: "success",
            title: `Milestone Crossed: ${formatMilestoneCroreLakh(topMs)}!`,
            message: `Your combined family wealth reached ₹${Math.round(saved.totalINR).toLocaleString("en-IN")} (${cleanMonth}).`,
            actionTab: "wealth"
          });
        }
      }

      const updatedHistory = await getWealthHistoryPg(householdId);
      res.json({ success: true, snapshot: saved, snapshots: updatedHistory });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to record wealth snapshot" });
    }
  });

  app.post("/api/wealth-history/backfill", async (req, res) => {
    try {
      const {
        householdId,
        snapshotMonth,
        totalINR,
        indianEquityINR,
        foreignEquityINR,
        debtINR,
        realEstateEquityINR,
        realEstateLoanINR,
        fxRate,
        memberBreakdown,
        note
      } = req.body || {};

      if (!householdId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(snapshotMonth || ""))) {
        return res.status(400).json({ error: "Valid householdId and snapshotMonth (YYYY-MM) are required" });
      }
      const resolvedTotal =
        Number(totalINR) > 0
          ? Number(totalINR)
          : (Number(indianEquityINR) || 0) + (Number(foreignEquityINR) || 0) + (Number(debtINR) || 0);
      if (!(resolvedTotal > 0)) {
        return res.status(400).json({ error: "Total portfolio value must be greater than 0" });
      }

      const { caller } = await verifyCallerHouseholdAccess(req, householdId);
      const rate = Number(fxRate) > 0 ? Number(fxRate) : FX_FALLBACK_RATE;
      const indEq = Number(indianEquityINR) >= 0 ? Number(indianEquityINR) : Math.round(resolvedTotal * 0.42);
      const forEq = Number(foreignEquityINR) >= 0 ? Number(foreignEquityINR) : Math.round(resolvedTotal * 0.28);
      const debtVal = Number(debtINR) >= 0 ? Number(debtINR) : Math.max(0, resolvedTotal - indEq - forEq);

      const saved = await upsertWealthSnapshotPg({
        householdId,
        snapshotMonth: String(snapshotMonth),
        recordedAt: Date.now(),
        totalINR: resolvedTotal,
        totalUSD: resolvedTotal / rate,
        indianEquityINR: indEq,
        foreignEquityINR: forEq,
        debtINR: debtVal,
        realEstateEquityINR: Number(realEstateEquityINR) || 0,
        realEstateLoanINR: Number(realEstateLoanINR) || 0,
        fxRate: rate,
        holdingsCount: 0,
        memberBreakdown: Array.isArray(memberBreakdown) ? memberBreakdown : [],
        providerBreakdown: {},
        source: "manual_backfill",
        note: String(note || `Logged by ${caller.name || caller.email}`)
      });

      const updatedHistory = await getWealthHistoryPg(householdId);
      res.json({ success: true, snapshot: saved, snapshots: updatedHistory });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to save historical month" });
    }
  });

  app.delete("/api/wealth-history/:householdId/:month", async (req, res) => {
    try {
      const { householdId, month } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      await deleteWealthSnapshotPg(householdId, month);
      const updatedHistory = await getWealthHistoryPg(householdId);
      res.json({ success: true, snapshots: updatedHistory });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to delete snapshot" });
    }
  });

  // --- Dedicated PostgreSQL Real Estate Persistence (uw_real_estate) + Sheet Import ---
  app.get("/api/real-estate/:householdId", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const properties = await getRealEstatePg(householdId);
      res.json({ properties });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to load real estate records" });
    }
  });

  app.post("/api/real-estate/:householdId", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const properties = Array.isArray(req.body?.properties) ? req.body.properties : [];
      await saveRealEstatePg(householdId, properties);
      res.json({ success: true, properties });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to save real estate records" });
    }
  });

  app.post("/api/real-estate/import-sheet/parse", async (req, res) => {
    try {
      const { householdId, sheetUrl, fileBase64, propertyName, members } = req.body || {};
      if (!householdId) {
        return res.status(400).json({ error: "householdId is required" });
      }
      await verifyCallerHouseholdAccess(req, householdId);

      let buffer: Buffer;
      if (fileBase64 && typeof fileBase64 === "string") {
        const cleanB64 = fileBase64.replace(/^data:[^;]+;base64,/, "");
        buffer = Buffer.from(cleanB64, "base64");
      } else if (sheetUrl && typeof sheetUrl === "string") {
        buffer = await fetchGoogleSheetXlsxBuffer(sheetUrl.trim());
      } else {
        return res.status(400).json({ error: "Provide either a Google Sheets URL or an .xlsx file" });
      }

      const parsedProperty = parseRealEstateWorkbook(buffer, {
        householdId,
        propertyName,
        sheetUrl: typeof sheetUrl === "string" ? sheetUrl.trim() : undefined,
        members: Array.isArray(members) ? members : []
      });

      res.json({ success: true, property: parsedProperty });
    } catch (e: any) {
      const code = e.statusCode || 400;
      res.status(code).json({ error: e.message || "Failed to import spreadsheet" });
    }
  });

  // --- Dedicated PostgreSQL Tax Lots, RSU Vesting & Tax Profile Persistence + AI CIO Copilot ---
  app.get("/api/tax-planning/:householdId", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const bundle = await getTaxPlanningPg(householdId);
      res.json(bundle);
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to load tax & RSU planning records" });
    }
  });

  app.post("/api/tax-planning/:householdId", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const { taxLots, rsuGrants, taxProfile } = req.body || {};
      const saved = await saveTaxPlanningPg(householdId, {
        ...(Array.isArray(taxLots) ? { taxLots } : {}),
        ...(Array.isArray(rsuGrants) ? { rsuGrants } : {}),
        ...(taxProfile && typeof taxProfile === "object" ? { taxProfile } : {})
      });
      res.json({ success: true, ...saved });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to save tax & RSU planning records" });
    }
  });

  app.post("/api/ai/wealth-copilot", async (req, res) => {
    try {
      const { householdId, question, contextSummary } = req.body || {};
      if (!householdId) {
        return res.status(400).json({ error: "householdId is required" });
      }
      await verifyCallerHouseholdAccess(req, householdId);

      const userQuestion = String(
        question || "Give me a prioritized tax-smart rebalancing, RSU vesting, and cash-flow action plan."
      )
        .trim()
        .slice(0, 800);

      const prompt = `You are an elite Indian Cross-Border Family Office Chief Investment Officer & Chartered Tax Strategist advising a high-income Indian resident household (> Rs. 1 Crore annual income, top tax bracket).

EXACT INDIAN CAPITAL GAINS RULES YOU MUST APPLY (Post-Finance Act 2024/2025):
1. Surcharge on Sec 111A, Sec 112A, and Sec 112 Capital Gains is statutory-capped at 15% even when total income exceeds Rs. 2 Cr or Rs. 5 Cr!
2. Indian Equity / Equity MFs / Arbitrage Funds (STT paid):
   - Held > 12 months: LTCG @ 12.5% -> 14.95% effective (12.5% * 1.15 * 1.04), with Rs. 1.25 Lakh LTCG tax-free per PAN per FY (Sec 112A).
   - Held <= 12 months: STCG @ 20% -> 23.92% effective (20% * 1.15 * 1.04).
   - Note: Arbitrage Funds give liquid/debt-like low volatility while enjoying Equity taxation (14.95% LTCG >12m) instead of 35.88%-39% Debt slab tax!
3. Foreign Stocks / US Employer RSUs (QCOM, GOOGL, MSFT, NVDA, VTI, etc.):
   - Held > 24 months (>730 days): LTCG @ 12.5% -> 14.95% effective (Sec 112).
   - Held <= 24 months: STCG taxed at Marginal Slab Rate (35.88% for Rs. 1-2 Cr; 39.00% for > Rs. 2 Cr New Regime).
   - CRITICAL RSU RULE: Freshly vested RSUs already suffered perquisite income tax withholding at vest. Selling newly vested RSU shares near vest FMV yields Gain ~ Rs. 0 -> ~0% extra capital gains tax, making vest-day liquidation far more tax-efficient than selling appreciated STCG lots or even deep-gain LTCG lots!
   - Schedule FA Compliance: Foreign assets must be disclosed annually (Jan 1 - Dec 31 calendar year peak & closing values) in ITR Schedule FA.
4. Non-Arbitrage Debt MFs (bought on/after 1 Apr 2023, Sec 50AA) & Fixed Deposits: taxed at Marginal Slab Rate (35.88% - 39.00%).

LIVE HOUSEHOLD PORTFOLIO, TAX LOTS, UNVESTED RSU & REAL ESTATE SNAPSHOT:
${JSON.stringify(contextSummary || {}, null, 2).slice(0, 28000)}

INVESTOR QUESTION:
"${userQuestion}"

Return ONLY a valid JSON object matching this exact schema:
{
  "headline": "Crisp 1-line executive takeaway with concrete Rs. numbers",
  "directAnswer": "2-4 sentences directly answering the question with exact tax rates, rupee impact, and trade-offs.",
  "actionSteps": [
    "Concrete step 1 naming exact ticker/account/member/lot or RSU tranche and Rs. amount",
    "Concrete step 2...",
    "Concrete step 3..."
  ],
  "taxAlphaNote": "1-sentence highlight of estimated Rs. tax saved or compliance reminder (e.g. LTCG cliff, Sec 112A multi-PAN harvest, or vest-day 0-gain sale)"
}`;

      try {
        const rawJson = await callGeminiJSON([{ text: prompt }]);
        const cleaned = (rawJson || "").replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        return res.json({
          source: "gemini",
          headline: String(parsed?.headline || "Tax-Smart Portfolio Strategy Ready"),
          directAnswer: String(parsed?.directAnswer || ""),
          actionSteps: Array.isArray(parsed?.actionSteps)
            ? parsed.actionSteps.map((s: any) => String(s)).slice(0, 5)
            : [],
          taxAlphaNote: String(parsed?.taxAlphaNote || "")
        });
      } catch (aiErr: any) {
        console.warn("[Wealth Copilot] Falling back to deterministic tax engine:", aiErr?.message);
        const cs = contextSummary || {};
        return res.json({
          source: "deterministic",
          headline: `Tax-Smart Strategy for ${cs.bracketLabel || "> ₹1 Cr Top Bracket"} (${cs.alignmentPct || 95}% Aligned)`,
          directAnswer: `In your ${cs.marginalRatePct || 35.88}% slab, prioritize (1) booking tax-loss lots or freshly vested RSUs near vest FMV (~0% tax drag), (2) utilizing ₹1.25L Sec 112A tax-free LTCG per family PAN, and (3) selling >24M US / >12M India LTCG lots at 14.95% effective rate while strictly avoiding <=24M appreciated US STCG lots (${cs.marginalRatePct || 35.88}%).`,
          actionSteps: [
            cs.topSellSummary || "Use the Lot Optimizer on each SELL order to liquidate lowest tax-drag tranches first.",
            cs.rsuSummary || "Sell excess newly vesting RSUs within 48 hours of vest (~₹0 cap-gains tax) and route proceeds into underweight Indian Equity / Arbitrage Debt.",
            cs.harvestSummary || "Harvest up to ₹1.25L LTCG tax-free per family member PAN in Indian Equity / Arbitrage MFs before March 31."
          ],
          taxAlphaNote:
            "Statutory 15% surcharge cap keeps all qualifying LTCG at 14.95% vs 35.88%–39.00% marginal STCG."
        });
      }
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to generate AI strategy" });
    }
  });

  // --- Notifications & Household Activity Feed (PostgreSQL-backed) ---
  app.get("/api/notifications/:householdId", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const items = await getNotificationsPg(householdId, 40);
      res.json({ notifications: items });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications/:householdId/add", async (req, res) => {
    try {
      const { householdId } = req.params;
      const { caller } = await verifyCallerHouseholdAccess(req, householdId);
      const { category, severity, title, message, actionTab } = req.body || {};
      if (!title || !message) {
        return res.status(400).json({ error: "title and message are required" });
      }
      const created = await addNotificationPg({
        householdId,
        userId: caller.uid,
        category: category || "system",
        severity: severity || "info",
        title: String(title).slice(0, 140),
        message: String(message).slice(0, 400),
        actionTab: actionTab || ""
      });
      res.json({ success: true, notification: created });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to create notification" });
    }
  });

  app.post("/api/notifications/:householdId/mark-read", async (req, res) => {
    try {
      const { householdId } = req.params;
      await verifyCallerHouseholdAccess(req, householdId);
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
      await markNotificationsReadPg(householdId, ids);
      res.json({ success: true });
    } catch (e: any) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Failed to mark notifications read" });
    }
  });

  // --- Market Data, Bounded Quote & History Caches, and Batched Scanners ---
  const YAHOO_HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "application/json"
  };

  const stockQuoteCache = new LRUCache<string, number>(2500, 60 * 1000);
  const assetHistoryCache = new LRUCache<string, any>(500, 6 * 60 * 60 * 1000);

  function toYahooSymbol(raw: string): string {
    const sym = raw.trim().toUpperCase();
    if (sym.includes(":")) {
      const [exch, ticker] = sym.split(":");
      if (exch === "NSE") return `${ticker}.NS`;
      if (exch === "BSE") return `${ticker}.BO`;
      return ticker;
    }
    if (sym.endsWith(".NSE")) return sym.replace(/\.NSE$/, ".NS");
    if (sym.endsWith(".BSE")) return sym.replace(/\.BSE$/, ".BO");
    if (sym.endsWith(".US")) return sym.replace(/\.US$/, "");
    if (sym === "BTC" || sym === "BITCOIN") return "BTC-USD";
    if (sym === "ETH" || sym === "ETHEREUM") return "ETH-USD";
    return sym;
  }

  async function fetchYahooChartPrice(yahooSym: string): Promise<number | null> {
    const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
    for (const host of hosts) {
      try {
        const res = await axios.get(
          `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`,
          { timeout: 6000, headers: YAHOO_HEADERS }
        );
        const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof price === "number" && price > 0) {
          return price;
        }
      } catch {
        // try next host
      }
    }
    return null;
  }

  async function fetchYahooPriceForSymbol(symbol: string): Promise<number | null> {
    const yahooSym = toYahooSymbol(symbol);
    let price = await fetchYahooChartPrice(yahooSym);
    if (!price && yahooSym.endsWith(".NS")) {
      price = await fetchYahooChartPrice(yahooSym.replace(/\.NS$/, ".BO"));
    }
    return price;
  }

  function toTradingViewIndiaTicker(raw: string): { primary: string; fallback?: string } {
    const sym = raw.trim().toUpperCase();
    if (sym.includes(":")) {
      const [exch, ticker] = sym.split(":");
      if (exch === "BSE") return { primary: `BSE:${ticker}`, fallback: `NSE:${ticker}` };
      return { primary: `NSE:${ticker}`, fallback: `BSE:${ticker}` };
    }
    if (sym.endsWith(".BO") || sym.endsWith(".BSE")) {
      const base = sym.replace(/\.(BO|BSE)$/, "");
      return { primary: `BSE:${base}`, fallback: `NSE:${base}` };
    }
    const base = sym.replace(/\.(NS|NSE)$/, "");
    return { primary: `NSE:${base}`, fallback: `BSE:${base}` };
  }

  async function fetchTradingViewIndiaPrices(symbols: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (symbols.length === 0) return out;

    const tickerSet = new Set<string>();
    const mapBySymbol = new Map<string, { primary: string; fallback?: string }>();
    for (const sym of symbols) {
      const mapped = toTradingViewIndiaTicker(sym);
      mapBySymbol.set(sym, mapped);
      tickerSet.add(mapped.primary);
      if (mapped.fallback) tickerSet.add(mapped.fallback);
    }

    try {
      const res = await axios.post(
        "https://scanner.tradingview.com/india/scan",
        {
          symbols: { tickers: Array.from(tickerSet) },
          columns: ["close"]
        },
        { timeout: 6000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
      );
      const tvPrices = new Map<string, number>();
      for (const item of res.data?.data || []) {
        const price = item?.d?.[0];
        if (item?.s && typeof price === "number" && price > 0) {
          tvPrices.set(String(item.s).toUpperCase(), price);
        }
      }
      for (const sym of symbols) {
        const mapped = mapBySymbol.get(sym)!;
        const p = tvPrices.get(mapped.primary) ?? (mapped.fallback ? tvPrices.get(mapped.fallback) : undefined);
        if (p) out[sym] = p;
      }
    } catch (e: any) {
      console.warn("[TradingView India] Quote batch failed:", e.message);
    }
    return out;
  }

  // Batched US TradingView quote lookup: 1 POST for all symbols instead of N serial POSTs
  async function fetchTradingViewUSPricesBatch(symbols: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (symbols.length === 0) return out;

    const exchanges = ["NASDAQ", "NYSE", "AMEX", "CBOE", "OTC"];
    const tickerSet = new Set<string>();
    const cleanBySymbol = new Map<string, string>();

    for (const sym of symbols) {
      const clean = sym.trim().toUpperCase().replace(/\.US$/, "");
      cleanBySymbol.set(sym, clean);
      for (const ex of exchanges) {
        tickerSet.add(`${ex}:${clean}`);
      }
    }

    try {
      const res = await axios.post(
        "https://scanner.tradingview.com/america/scan",
        {
          symbols: { tickers: Array.from(tickerSet) },
          columns: ["close"]
        },
        { timeout: 6000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
      );
      const tvPrices = new Map<string, number>();
      for (const item of res.data?.data || []) {
        const price = item?.d?.[0];
        if (item?.s && typeof price === "number" && price > 0) {
          tvPrices.set(String(item.s).toUpperCase(), price);
        }
      }
      for (const sym of symbols) {
        const clean = cleanBySymbol.get(sym)!;
        for (const ex of exchanges) {
          const p = tvPrices.get(`${ex}:${clean}`);
          if (p) {
            out[sym] = p;
            break;
          }
        }
      }
    } catch (e: any) {
      console.warn("[TradingView US] Quote batch failed:", e.message);
    }
    return out;
  }

  async function fetchLiveStockPrices(symbols: string[]) {
    if (symbols.length === 0) return {};

    const priceMap: Record<string, number> = {};
    const uncached: string[] = [];

    for (const sym of symbols) {
      const cachedPrice = stockQuoteCache.get(sym.toUpperCase());
      if (cachedPrice && cachedPrice > 0) {
        priceMap[sym] = cachedPrice;
      } else {
        uncached.push(sym);
      }
    }

    if (uncached.length > 0) {
      const pgQuotes = await getCachedQuotesPg(uncached, 3 * 60 * 1000);
      for (let i = uncached.length - 1; i >= 0; i--) {
        const sym = uncached[i];
        const hit = pgQuotes[sym.toUpperCase()];
        if (hit && hit.price > 0) {
          priceMap[sym] = hit.price;
          stockQuoteCache.set(sym.toUpperCase(), hit.price);
          uncached.splice(i, 1);
        }
      }
    }

    if (uncached.length === 0) return priceMap;

    const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
    const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;

    const isIndiaSymbol = (s: string) => {
      const u = s.toUpperCase();
      return (
        u.endsWith(".NS") ||
        u.endsWith(".BO") ||
        u.endsWith(".NSE") ||
        u.endsWith(".BSE") ||
        u.includes(":NSE") ||
        u.includes(":BSE") ||
        u.startsWith("NSE:") ||
        u.startsWith("BSE:")
      );
    };

    const indiaStocks = uncached.filter(isIndiaSymbol);
    const potentialUS = uncached.filter((s) => !isIndiaSymbol(s));

    const indiaTask = (async () => {
      if (indiaStocks.length === 0) return;
      const tvResults = await fetchTradingViewIndiaPrices(indiaStocks);
      for (const [sym, price] of Object.entries(tvResults)) {
        priceMap[sym] = price;
        stockQuoteCache.set(sym.toUpperCase(), price);
      }

      const missingIndia = indiaStocks.filter((s) => !priceMap[s]);
      await mapWithConcurrency(missingIndia, 6, async (symbol) => {
        const yPrice = await fetchYahooPriceForSymbol(symbol);
        if (yPrice) {
          priceMap[symbol] = yPrice;
          stockQuoteCache.set(symbol.toUpperCase(), yPrice);
          return;
        }
        if (AV_KEY) {
          try {
            const avSym = toYahooSymbol(symbol).replace(/\.NS$/, ".BSE").replace(/\.BO$/, ".BSE");
            const res = await axios.get(
              `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(avSym)}&apikey=${AV_KEY}`,
              { timeout: 6000 }
            );
            const priceStr = res.data?.["Global Quote"]?.["05. price"];
            if (priceStr && parseFloat(priceStr) > 0) {
              const p = parseFloat(priceStr);
              priceMap[symbol] = p;
              stockQuoteCache.set(symbol.toUpperCase(), p);
            }
          } catch (e: any) {
            console.warn(`[AlphaVantage] Fallback failed for ${symbol}: ${e.message}`);
          }
        }
      });
    })();

    const usTask = (async () => {
      if (potentialUS.length === 0) return;

      if (FINNHUB_KEY) {
        await mapWithConcurrency(potentialUS, 8, async (symbol) => {
          try {
            let sym = symbol.toUpperCase().replace(/\.US$/, "");
            if (sym === "BTC" || sym === "BITCOIN") sym = "BINANCE:BTCUSDT";
            else if (sym === "ETH" || sym === "ETHEREUM") sym = "BINANCE:ETHUSDT";

            const res = await axios.get(
              `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`,
              { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0" } }
            );
            if (res.data?.c && res.data.c > 0) {
              priceMap[symbol] = res.data.c;
              stockQuoteCache.set(symbol.toUpperCase(), res.data.c);
            }
          } catch (e: any) {
            console.warn(`[Finnhub] Failed for ${symbol}: ${e.message}`);
          }
        });
      }

      // Single batched TradingView America scan for all remaining US tickers
      const missingUS = potentialUS.filter((s) => !priceMap[s]);
      if (missingUS.length > 0) {
        const tvUsMap = await fetchTradingViewUSPricesBatch(missingUS);
        for (const [sym, price] of Object.entries(tvUsMap)) {
          priceMap[sym] = price;
          stockQuoteCache.set(sym.toUpperCase(), price);
        }
      }

      // Final India NSE fallback for bare Indian symbols without .NS suffix
      const stillMissing = potentialUS.filter((s) => !priceMap[s]);
      if (stillMissing.length > 0) {
        const nsSymbols = stillMissing.map((s) => `${s}.NS`);
        const tvIn = await fetchTradingViewIndiaPrices(nsSymbols);
        for (const sym of stillMissing) {
          const p = tvIn[`${sym}.NS`];
          if (p) {
            priceMap[sym] = p;
            stockQuoteCache.set(sym.toUpperCase(), p);
          }
        }
      }
    })();

    await Promise.all([indiaTask, usTask]);

    const newlyFetched = uncached
      .filter((sym) => priceMap[sym] && priceMap[sym] > 0)
      .map((sym) => ({
        symbol: sym.toUpperCase(),
        price: priceMap[sym],
        currency: isIndiaSymbol(sym) ? "INR" : "USD",
        updatedAt: Date.now()
      }));
    if (newlyFetched.length > 0) {
      upsertCachedQuotesPg(newlyFetched).catch(() => {});
    }

    return priceMap;
  }

  // Live Global Market Benchmarks cached for multi-user scale
  let benchmarkCache: { data: any[]; ts: number } | null = null;
  app.get("/api/market/benchmarks", async (req, res) => {
    const now = Date.now();
    if (benchmarkCache && now - benchmarkCache.ts < 90 * 1000) {
      return res.json({ benchmarks: benchmarkCache.data, cachedAt: benchmarkCache.ts });
    }

    try {
      const [tvIndia, tvGlobal, usdInr] = await Promise.all([
        axios
          .post(
            "https://scanner.tradingview.com/india/scan",
            {
              symbols: { tickers: ["NSE:NIFTY", "BSE:SENSEX"] },
              columns: ["close", "change"]
            },
            { timeout: 5000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
          )
          .catch(() => ({ data: { data: [] } })),
        axios
          .post(
            "https://scanner.tradingview.com/america/scan",
            {
              symbols: { tickers: ["AMEX:SPY", "NASDAQ:QQQ", "AMEX:GLD"] },
              columns: ["close", "change"]
            },
            { timeout: 5000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
          )
          .catch(() => ({ data: { data: [] } })),
        getUsdInrRate()
      ]);

      const tvMap = new Map<string, { price: number; changePct: number }>();
      for (const item of [...(tvIndia.data?.data || []), ...(tvGlobal.data?.data || [])]) {
        if (item?.s && typeof item?.d?.[0] === "number") {
          tvMap.set(String(item.s).toUpperCase(), {
            price: Number(item.d[0]),
            changePct: typeof item.d[1] === "number" ? Number(item.d[1]) : 0
          });
        }
      }

      const nifty = tvMap.get("NSE:NIFTY");
      const sensex = tvMap.get("BSE:SENSEX");
      const spy = tvMap.get("AMEX:SPY");
      const qqq = tvMap.get("NASDAQ:QQQ");
      const gld = tvMap.get("AMEX:GLD");

      const benchmarks = [
        nifty ? { id: "nifty50", label: "NIFTY 50", value: nifty.price, changePct: nifty.changePct, prefix: "" } : null,
        sensex ? { id: "sensex", label: "SENSEX", value: sensex.price, changePct: sensex.changePct, prefix: "" } : null,
        spy ? { id: "sp500", label: "S&P 500 (SPY)", value: spy.price, changePct: spy.changePct, prefix: "$" } : null,
        qqq ? { id: "nasdaq", label: "NASDAQ (QQQ)", value: qqq.price, changePct: qqq.changePct, prefix: "$" } : null,
        gld ? { id: "gold", label: "GOLD ETF", value: gld.price, changePct: gld.changePct, prefix: "$" } : null,
        { id: "usdinr", label: "USD / INR", value: usdInr, changePct: 0, prefix: "₹" }
      ].filter(Boolean);

      benchmarkCache = { data: benchmarks, ts: now };
      res.json({ benchmarks, cachedAt: now });
    } catch {
      res.json({ benchmarks: benchmarkCache?.data || [], cachedAt: now });
    }
  });

  app.get("/api/mf/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const amfiIndex = await getAmfiIndex();
    const filtered = searchAmfiIndex(amfiIndex, String(q), 15);
    res.json(filtered);
  });

  app.get("/api/tickers/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);

    try {
      const rawQuery = String(q).trim();
      const wantsEtf = /\b(etf|etfs|etp|etn)\b/i.test(rawQuery);
      const strippedQuery = rawQuery
        .replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|CBOE):/i, "")
        .replace(/\.(NS|BO|NSE|BSE|US)$/i, "")
        .replace(/\b(etf|etfs|etp|etn|stock|stocks|share|shares)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const coreQuery = strippedQuery || rawQuery;
      const queryTokens = coreQuery.split(/\s+/).filter(Boolean).slice(0, 3);
      const upperCore = coreQuery.toUpperCase();

      const results: any[] = [];
      const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

      const [usTvQuotes, indiaQuotes, finnhubQuotes] = await Promise.all([
        (async () => {
          if (queryTokens.length === 0) return [];
          try {
            const tvUsRes = await axios.post(
              "https://scanner.tradingview.com/america/scan",
              {
                filter: queryTokens.map((tok) => ({
                  left: "name,description",
                  operation: "match",
                  right: tok
                })),
                options: { lang: "en" },
                markets: ["america"],
                columns: ["name", "description", "close", "currency", "exchange", "type", "subtype"],
                sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
                range: [0, 12]
              },
              { timeout: 6000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
            );
            return (tvUsRes.data?.data || [])
              .filter((item: any) => {
                const sym = String(item?.d?.[0] || "");
                return sym && !sym.includes("/") && !sym.includes(".");
              })
              .map((item: any) => {
                const [ticker, desc, close, , exch, assetType, subType] = item.d || [];
                const price = typeof close === "number" && close > 0 ? close : 0;
                const sym = String(ticker).toUpperCase();
                const isFund = assetType === "fund" || String(subType || "").toLowerCase().includes("etf");
                if (price > 0) {
                  stockQuoteCache.set(sym, price);
                }
                return {
                  symbol: sym,
                  shortname: desc || sym,
                  exchDisp: exch || "US",
                  typeDisp: isFund ? "ETF" : "EQUITY",
                  currentPrice: price,
                  isIndia: false
                };
              });
          } catch (e: any) {
            console.warn("TradingView US search failed:", e.message);
            return [];
          }
        })(),
        (async () => {
          if (queryTokens.length === 0) return [];
          try {
            const tvRes = await axios.post(
              "https://scanner.tradingview.com/india/scan",
              {
                filter: queryTokens.map((tok) => ({
                  left: "name,description",
                  operation: "match",
                  right: tok
                })),
                options: { lang: "en" },
                markets: ["india"],
                columns: ["name", "description", "close", "currency", "exchange", "type"],
                sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
                range: [0, 8]
              },
              { timeout: 6000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
            );
            return (tvRes.data?.data || []).map((item: any) => {
              const [ticker, desc, close, , exch, assetType] = item.d || [];
              const suffix = exch === "BSE" ? ".BO" : ".NS";
              const sym = `${ticker}${suffix}`;
              const price = typeof close === "number" && close > 0 ? close : 0;
              if (price > 0) {
                stockQuoteCache.set(sym.toUpperCase(), price);
              }
              return {
                symbol: sym,
                shortname: desc || ticker,
                exchDisp: exch || "NSE",
                typeDisp: assetType === "fund" ? "ETF" : "EQUITY",
                currentPrice: price,
                isIndia: true
              };
            });
          } catch (e: any) {
            console.warn("TradingView India search failed:", e.message);
            return [];
          }
        })(),
        (async () => {
          if (!FINNHUB_KEY || !coreQuery) return [];
          try {
            const fRes = await axios.get(
              `https://finnhub.io/api/v1/search?q=${encodeURIComponent(coreQuery)}&token=${FINNHUB_KEY}`,
              { timeout: 5000 }
            );
            return (fRes.data?.result || [])
              .filter(
                (quote: any) =>
                  ["Common Stock", "ETF", "ETP", "REIT", "ADR"].includes(quote.type) && !quote.symbol.includes(".")
              )
              .slice(0, 8)
              .map((quote: any) => ({
                symbol: toYahooSymbol(quote.symbol),
                shortname: quote.description,
                exchDisp: "US",
                typeDisp: quote.type === "ETP" || quote.type === "ETF" ? "ETF" : quote.type,
                currentPrice: 0,
                isIndia: false
              }));
          } catch {
            return [];
          }
        })()
      ]);

      results.push(...usTvQuotes, ...indiaQuotes, ...finnhubQuotes);

      const seen = new Set<string>();
      const deduped = results.filter((item) => {
        const key = String(item.symbol || "").toUpperCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const escapedWord = coreQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const wordBoundaryRe = escapedWord ? new RegExp(`\\b${escapedWord}\\b`, "i") : null;

      deduped.sort((a, b) => {
        const score = (item: any) => {
          const baseSym = String(item.symbol || "").toUpperCase().replace(/\.(NS|BO)$/, "");
          const desc = String(item.shortname || "");
          let s = 0;
          if (baseSym === upperCore) s += 200;
          else if (baseSym.startsWith(upperCore)) s += 80;
          if (wordBoundaryRe && (wordBoundaryRe.test(baseSym) || wordBoundaryRe.test(desc))) s += 45;
          if (wantsEtf && item.typeDisp === "ETF") s += 60;
          if (item.currentPrice > 0) s += 10;
          return s;
        };
        return score(b) - score(a);
      });

      const uniqueResults = deduped.slice(0, 12);
      const missingPriceSymbols = uniqueResults.filter((r: any) => !r.currentPrice).map((r: any) => r.symbol);
      if (missingPriceSymbols.length > 0) {
        try {
          const priceMap = await fetchLiveStockPrices(missingPriceSymbols);
          uniqueResults.forEach((r: any) => {
            if (!r.currentPrice && priceMap[r.symbol]) r.currentPrice = priceMap[r.symbol];
          });
        } catch (e) {
          console.warn("Failed to fetch prices for search results", e);
        }
      }

      res.json(uniqueResults);
    } catch (e) {
      console.error("Ticker search failed:", e);
      res.status(500).json({ error: "Failed to search tickers" });
    }
  });

  app.get("/api/quote/:symbol", async (req, res) => {
    const { symbol } = req.params;
    try {
      const amfiIndex = await getAmfiIndex();
      const mf = amfiIndex.byCode.get(String(symbol).trim());
      if (mf) {
        return res.json({ symbol, price: mf.currentPrice, provider: "AMFI" });
      }

      const priceMap = await fetchLiveStockPrices([symbol]);
      if (priceMap[symbol]) {
        res.json({ symbol, price: priceMap[symbol] });
      } else {
        res.status(404).json({ error: "Price not found" });
      }
    } catch {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  function formatShortHistoryLabel(isoDate: string, rangeKey: string): string {
    const [y, m, d] = isoDate.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = parseInt(m, 10) - 1;
    if (!y || isNaN(mi) || mi < 0 || mi > 11) return isoDate;
    if (rangeKey === "6M") {
      return `${parseInt(d || "1", 10)} ${months[mi]}`;
    }
    return `${months[mi]} '${y.slice(-2)}`;
  }

  function downsamplePoints<T>(arr: T[], maxPts = 48): T[] {
    if (arr.length <= maxPts) return arr;
    const out: T[] = [];
    const step = (arr.length - 1) / (maxPts - 1);
    for (let i = 0; i < maxPts - 1; i++) {
      out.push(arr[Math.round(i * step)]);
    }
    out.push(arr[arr.length - 1]);
    return out;
  }

  app.get("/api/asset-history/:symbol", async (req, res) => {
    const rawSymbol = String(req.params.symbol || "").trim();
    const rawName = String(req.query.name || "").trim();
    const rangeRaw = String(req.query.range || "1Y").toUpperCase();
    const rangeKey = (["6M", "1Y", "3Y", "ALL"].includes(rangeRaw) ? rangeRaw : "1Y") as "6M" | "1Y" | "3Y" | "ALL";
    const cacheKey = `${rawSymbol.toUpperCase()}|${rawName.toLowerCase().slice(0, 40)}|${rangeKey}`;

    const cachedPayload = assetHistoryCache.get(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }

    const windowDays = rangeKey === "6M" ? 185 : rangeKey === "1Y" ? 366 : rangeKey === "3Y" ? 1096 : 1826;
    const minTsMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    try {
      let schemeCode = /^\d{5,6}$/.test(rawSymbol) ? rawSymbol : "";
      if (!schemeCode && (rawName || rawSymbol)) {
        const isExplicitStock =
          /\.(NS|BO|NSE|BSE|US)$/i.test(rawSymbol) ||
          (/^[A-Z]{1,5}$/.test(rawSymbol) && !rawName.toLowerCase().includes("fund"));
        if (!isExplicitStock) {
          const amfiIndex = await getAmfiIndex();
          const mf = findAmfiMatchIndexed(amfiIndex, { ticker: rawSymbol, originalName: rawName });
          if (mf?.symbol && /^\d{5,6}$/.test(String(mf.symbol))) {
            schemeCode = String(mf.symbol);
          }
        }
      }

      if (schemeCode) {
        try {
          const mfRes = await axios.get(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, {
            timeout: 8000,
            headers: { "User-Agent": YAHOO_HEADERS["User-Agent"] }
          });
          const navRows: any[] = Array.isArray(mfRes.data?.data) ? mfRes.data.data : [];
          const parsedPts: { date: string; ts: number; price: number }[] = [];
          for (const item of navRows) {
            const parts = String(item?.date || "").split("-");
            const nav = parseFloat(item?.nav);
            if (parts.length === 3 && nav > 0) {
              const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
              const ts = Date.parse(`${iso}T00:00:00Z`);
              if (!isNaN(ts) && ts >= minTsMs) {
                parsedPts.push({ date: iso, ts, price: nav });
              }
            }
          }
          parsedPts.sort((a, b) => a.ts - b.ts);
          if (parsedPts.length >= 2) {
            const sampled = downsamplePoints(parsedPts, 48).map((p) => ({
              date: p.date,
              label: formatShortHistoryLabel(p.date, rangeKey),
              price: Number(p.price.toFixed(4))
            }));
            const first = sampled[0].price;
            const last = sampled[sampled.length - 1].price;
            const payload = {
              symbol: schemeCode,
              source: "AMFI",
              currency: "INR",
              range: rangeKey,
              changePct: first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
              points: sampled
            };
            assetHistoryCache.set(cacheKey, payload);
            return res.json(payload);
          }
        } catch (mfErr: any) {
          console.warn(`[AssetHistory] MFAPI failed for ${schemeCode}:`, mfErr.message);
        }
      }

      const yahooPrimary = toYahooSymbol(rawSymbol);
      const yRange = rangeKey === "6M" ? "6mo" : rangeKey === "1Y" ? "1y" : rangeKey === "3Y" ? "3y" : "5y";
      const yInterval = rangeKey === "6M" || rangeKey === "1Y" ? "1wk" : "1mo";
      const candidateSyms = yahooPrimary.endsWith(".NS")
        ? [yahooPrimary, yahooPrimary.replace(/\.NS$/, ".BO")]
        : [yahooPrimary];

      for (const ySym of candidateSyms) {
        for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
          try {
            const yRes = await axios.get(
              `https://${host}/v8/finance/chart/${encodeURIComponent(ySym)}?range=${yRange}&interval=${yInterval}`,
              { timeout: 6500, headers: YAHOO_HEADERS }
            );
            const result = yRes.data?.chart?.result?.[0];
            const timestamps: number[] = result?.timestamp || [];
            const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close || [];
            const currency = result?.meta?.currency || (ySym.endsWith(".NS") || ySym.endsWith(".BO") ? "INR" : "USD");
            const pts: { date: string; label: string; price: number }[] = [];
            for (let i = 0; i < timestamps.length; i++) {
              const c = closes[i];
              if (typeof c === "number" && c > 0 && timestamps[i]) {
                const iso = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
                pts.push({
                  date: iso,
                  label: formatShortHistoryLabel(iso, rangeKey),
                  price: Number(c.toFixed(2))
                });
              }
            }
            if (pts.length >= 2) {
              const sampled = downsamplePoints(pts, 52);
              const first = sampled[0].price;
              const last = sampled[sampled.length - 1].price;
              const payload = {
                symbol: rawSymbol,
                source: "Yahoo",
                currency,
                range: rangeKey,
                changePct: first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
                points: sampled
              };
              assetHistoryCache.set(cacheKey, payload);
              return res.json(payload);
            }
          } catch {
            // Try next host/candidate
          }
        }
      }

      const isIndia = /\.(NS|BO|NSE|BSE)$/i.test(yahooPrimary);
      try {
        const tvTickers = isIndia
          ? (() => {
              const m = toTradingViewIndiaTicker(yahooPrimary);
              return m.fallback ? [m.primary, m.fallback] : [m.primary];
            })()
          : (() => {
              const clean = yahooPrimary.replace(/\.US$/i, "").toUpperCase();
              return [`NASDAQ:${clean}`, `NYSE:${clean}`, `AMEX:${clean}`];
            })();
        const tvEndpoint = isIndia
          ? "https://scanner.tradingview.com/india/scan"
          : "https://scanner.tradingview.com/america/scan";
        const tvRes = await axios.post(
          tvEndpoint,
          {
            symbols: { tickers: tvTickers },
            columns: ["close", "Perf.1M", "Perf.3M", "Perf.6M", "Perf.Y", "Perf.3Y", "Perf.5Y"]
          },
          { timeout: 6000, headers: { "Content-Type": "application/json", "User-Agent": YAHOO_HEADERS["User-Agent"] } }
        );
        const row = (tvRes.data?.data || []).find((it: any) => typeof it?.d?.[0] === "number" && it.d[0] > 0);
        if (row) {
          const [close, p1m, p3m, p6m, p1y, p3y, p5y] = row.d;
          const anchors: { daysAgo: number; perf: number | null }[] = [
            { daysAgo: 1825, perf: typeof p5y === "number" ? p5y : null },
            { daysAgo: 1095, perf: typeof p3y === "number" ? p3y : null },
            { daysAgo: 365, perf: typeof p1y === "number" ? p1y : null },
            { daysAgo: 182, perf: typeof p6m === "number" ? p6m : null },
            { daysAgo: 91, perf: typeof p3m === "number" ? p3m : null },
            { daysAgo: 30, perf: typeof p1m === "number" ? p1m : null },
            { daysAgo: 0, perf: 0 }
          ];
          const pts = anchors
            .filter((a) => a.daysAgo <= windowDays + 5 && a.perf !== null && 1 + (a.perf as number) / 100 > 0)
            .map((a) => {
              const iso = new Date(Date.now() - a.daysAgo * 86400000).toISOString().slice(0, 10);
              const histPrice = a.daysAgo === 0 ? close : close / (1 + (a.perf as number) / 100);
              return {
                date: iso,
                label: formatShortHistoryLabel(iso, rangeKey),
                price: Number(histPrice.toFixed(2))
              };
            });
          if (pts.length >= 2) {
            const first = pts[0].price;
            const last = pts[pts.length - 1].price;
            const payload = {
              symbol: rawSymbol,
              source: "TradingView",
              currency: isIndia ? "INR" : "USD",
              range: rangeKey,
              changePct: first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
              points: pts
            };
            assetHistoryCache.set(cacheKey, payload);
            return res.json(payload);
          }
        }
      } catch (tvErr: any) {
        console.warn("[AssetHistory] TradingView fallback warning:", tvErr.message);
      }

      return res.json({ symbol: rawSymbol, source: "none", points: [], changePct: 0 });
    } catch (e: any) {
      console.error("[AssetHistory] Error:", e.message);
      res.status(500).json({ error: "Failed to load asset history" });
    }
  });

  // --- Firestore REST Document Parser & Rebalance Email Engine ---
  function parseFirestoreValue(val: any): any {
    if (!val || typeof val !== "object") return undefined;
    if ("stringValue" in val) return val.stringValue;
    if ("doubleValue" in val) return Number(val.doubleValue);
    if ("integerValue" in val) return Number(val.integerValue);
    if ("booleanValue" in val) return Boolean(val.booleanValue);
    if ("nullValue" in val) return null;
    if ("arrayValue" in val) {
      return (val.arrayValue?.values || []).map(parseFirestoreValue);
    }
    if ("mapValue" in val) {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val.mapValue?.fields || {})) {
        out[k] = parseFirestoreValue(v);
      }
      return out;
    }
    return undefined;
  }

  function parseFirestoreDoc(doc: any): any {
    if (!doc?.fields) return null;
    const parsed = parseFirestoreValue({ mapValue: { fields: doc.fields } });
    if (parsed && typeof doc.name === "string" && !parsed.id) {
      const parts = doc.name.split("/");
      parsed.id = parts[parts.length - 1];
    }
    return parsed;
  }

  async function firestoreRestQueryHoldings(householdId: string, idToken: string): Promise<any[]> {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:runQuery`;
    const resp = await axios.post(
      url,
      {
        structuredQuery: {
          from: [{ collectionId: "holdings" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "householdId" },
              op: "EQUAL",
              value: { stringValue: householdId }
            }
          }
        }
      },
      {
        timeout: 12000,
        httpsAgent: ipv4HttpsAgent,
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (!Array.isArray(resp.data)) return [];
    return resp.data
      .filter((row: any) => row?.document?.fields)
      .map((row: any) => parseFirestoreDoc(row.document));
  }

  app.post("/api/portfolio/refresh", async (req, res) => {
    const householdId = (req.query.householdId as string) || req.body?.householdId;
    const clientHoldings: any[] | undefined = Array.isArray(req.body?.holdings) ? req.body.holdings : undefined;

    try {
      let holdingsToRefresh: any[] = clientHoldings || [];

      if (holdingsToRefresh.length === 0 && householdId) {
        const authHeader = req.headers.authorization || "";
        const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (bearerToken) {
          holdingsToRefresh = await firestoreRestQueryHoldings(householdId, bearerToken);
        } else {
          const adminDb = getAdminFirestoreOrNull();
          if (adminDb) {
            const snap = await adminDb.collection("holdings").where("householdId", "==", householdId).get();
            holdingsToRefresh = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          }
        }
      }

      const amfiIndex = await getAmfiIndex();
      const updates: Record<string, { currentPrice: number; provider: string }> = {};
      const stockHoldings: any[] = [];

      for (const h of holdingsToRefresh) {
        const mf = findAmfiMatchIndexed(amfiIndex, h);
        if (mf && mf.currentPrice > 0) {
          updates[h.id] = { currentPrice: mf.currentPrice, provider: "AMFI" };
        } else if (h.ticker && h.ticker !== "MANUAL") {
          stockHoldings.push(h);
        }
      }

      if (stockHoldings.length > 0) {
        const uniqueSymbols = Array.from(new Set(stockHoldings.map((h) => String(h.ticker))));
        const stockPrices = await fetchLiveStockPrices(uniqueSymbols);
        for (const h of stockHoldings) {
          if (stockPrices[h.ticker]) {
            updates[h.id] = { currentPrice: stockPrices[h.ticker], provider: "Market-Live" };
          }
        }
      }

      const adminDb = getAdminFirestoreOrNull();
      if (adminDb && Object.keys(updates).length > 0) {
        try {
          const entries = Object.entries(updates);
          const now = Date.now();
          for (let i = 0; i < entries.length; i += 450) {
            const batch = adminDb.batch();
            for (const [id, u] of entries.slice(i, i + 450)) {
              batch.update(adminDb.collection("holdings").doc(id), {
                currentPrice: u.currentPrice,
                priceUpdatedAt: now
              });
            }
            await batch.commit();
          }
        } catch {
          // Client-side chunked writeBatch updates Firestore directly when authenticated
        }
      }

      res.json({ success: true, updates, count: Object.keys(updates).length });
    } catch (e: any) {
      console.error("Portfolio refresh error:", e);
      res.status(500).json({ error: e.message || "Failed to refresh portfolio" });
    }
  });

  app.delete("/api/portfolio/holding/:holdingId", async (req, res) => {
    const adminDb = getAdminFirestoreOrNull();
    if (adminDb) {
      try {
        await adminDb.collection("holdings").doc(req.params.holdingId).delete();
      } catch {
        // Client deletes directly via Firestore SDK
      }
    }
    res.json({ success: true });
  });

  app.patch("/api/portfolio/holding/:holdingId", async (req, res) => {
    const { holdingId } = req.params;
    const { quantity, currentPrice } = req.body || {};
    const patchData: any = { priceUpdatedAt: Date.now() };
    if (quantity !== undefined) patchData.quantity = Number(quantity);
    if (currentPrice !== undefined) patchData.currentPrice = Number(currentPrice);

    const adminDb = getAdminFirestoreOrNull();
    if (adminDb) {
      try {
        await adminDb.collection("holdings").doc(holdingId).update(patchData);
      } catch {
        // Client updates directly via Firestore SDK
      }
    }
    res.json({ id: holdingId, ...patchData });
  });

  async function resolveHouseholdMemberToken(householdId: string, bearerIdToken?: string): Promise<string | null> {
    if (bearerIdToken) return bearerIdToken;
    const hhCode = inviteCodeByHousehold.get(householdId);
    let entry: any = hhCode ? inviteCodesByCode.get(hhCode) : null;
    if (!entry) {
      entry = await getInviteByHouseholdPg(householdId);
      if (entry) cacheInviteEntry(entry);
    }
    if (entry?.refreshToken) {
      try {
        const fresh = await refreshFirebaseIdToken(entry.refreshToken);
        entry.lastIdToken = fresh;
        entry.lastTokenAt = Date.now();
        return fresh;
      } catch (e: any) {
        console.warn(`[Rebalance] Failed to refresh token for ${householdId}:`, e.message);
      }
    }
    if (entry?.lastIdToken && Date.now() - (entry.lastTokenAt || 0) < 45 * 60 * 1000) {
      return entry.lastIdToken;
    }
    return null;
  }

  async function checkAndSendRebalanceAlert(
    householdId: string,
    force: boolean = false,
    opts?: {
      idToken?: string;
      toEmail?: string;
      recipientName?: string;
      mode?: "full" | "sip";
      freshInflowINR?: number;
      clientReport?: any;
      baseUrl?: string;
    }
  ): Promise<any> {
    try {
      if (!householdId) {
        return { sent: false, error: "householdId is required" };
      }

      const appUrl = (opts?.baseUrl || process.env.APP_URL || "https://unitywealth.up.railway.app").replace(/\/$/, "");

      if (opts?.clientReport && opts.toEmail) {
        const cr = opts.clientReport;
        const content = buildRebalanceEmailContent({
          householdName: cr.householdName || "Family Portfolio",
          recipientName: opts.recipientName || "Investor",
          totalValINR: Number(cr.totalValINR) || 0,
          totalValUSD: Number(cr.totalValUSD) || 0,
          accuracy: Number(cr.accuracy) || 0,
          threshold: Number(cr.threshold) || 95,
          actualEquityPct: Number(cr.actualEquityPct) || 0,
          targetEquityPct: Number(cr.targetEquityPct) || 0.7,
          indianEquityPctOfEq: Number(cr.indianEquityPctOfEq) || 0,
          foreignEquityPctOfEq: Number(cr.foreignEquityPctOfEq) || 0,
          mode: opts.mode === "sip" ? "sip" : "full",
          executiveSummary:
            cr.executiveSummary ||
            `Portfolio alignment is ${Number(cr.accuracy || 0).toFixed(1)}% across Rs. ${((Number(cr.totalValINR) || 0) / 1_00_000).toFixed(2)}L combined family net worth.`,
          orders: Array.isArray(cr.orders) ? cr.orders : [],
          appUrl
        });

        const delivery = await sendHouseholdEmail({
          householdId,
          to: opts.toEmail,
          subject: content.subject,
          text: content.text,
          html: content.html
        });

        if (delivery.sent) {
          await addNotificationPg({
            householdId,
            category: "drift",
            severity: "info",
            title: opts.mode === "sip" ? "Zero-Sell SIP Plan Emailed" : "Rebalance Report Emailed",
            message: `Sent ${opts.mode === "sip" ? "Zero-Sell SIP plan" : "rebalance execution plan"} to ${opts.toEmail} (${Number(cr.accuracy || 0).toFixed(1)}% aligned).`,
            actionTab: "rebalance",
            createdAt: Date.now()
          }).catch(() => {});
        }
        return delivery;
      }

      const idToken = await resolveHouseholdMemberToken(householdId, opts?.idToken);
      if (!idToken) {
        return {
          sent: false,
          provider: "none",
          error: "Could not authenticate household data session. Open Rebalance while signed in and click 'Email Rebalance Plan'."
        };
      }

      const hhRaw = await firestoreRestGet(`households/${householdId}`, idToken);
      const household = parseFirestoreDoc(hhRaw);
      if (!household) {
        return { sent: false, error: "Household not found" };
      }

      if (household.settings?.emailAlertsEnabled === false && !force) {
        return { sent: false, skipped: true, reason: "Email alerts disabled for this household" };
      }

      const holdings = await firestoreRestQueryHoldings(householdId, idToken);
      if (holdings.length === 0) {
        return { sent: false, error: "Add at least one holding to your portfolio before generating a rebalance report." };
      }

      const fxRate = await getUsdInrRate();
      const stats = computePortfolioStats(holdings, fxRate, [], household.targets);
      if (stats.totalValINR <= 0) {
        return { sent: false, error: "Total portfolio value is zero." };
      }

      const threshold = Number(household.settings?.accuracyThreshold ?? 95);
      if (stats.accuracy >= threshold && !force) {
        return { sent: false, skipped: true, accuracy: stats.accuracy, reason: "Portfolio is already within target threshold" };
      }

      const lastSentKey = `rebalance_last_sent:${householdId}`;
      const lastSent = (await getAppStateKeyPg<number>(lastSentKey)) || Number(household.settings?.lastAlertSent || 0);
      const now = Date.now();
      if (!force && lastSent && now - lastSent < 24 * 60 * 60 * 1000) {
        return { sent: false, skipped: true, reason: "Alert already sent within the last 24 hours" };
      }

      // Resolve recipient email using cached memberProfiles first, then parallel user lookup
      let recipientEmail = (opts?.toEmail || "").trim();
      let recipientName = (opts?.recipientName || "").trim();
      if (!recipientEmail) {
        const members: string[] = Array.isArray(household.members) ? household.members : [];
        for (const mId of members) {
          const prof = household.settings?.memberProfiles?.[mId];
          if (prof?.email && prof.email.includes("@")) {
            recipientEmail = prof.email;
            recipientName = prof.name || "Investor";
            break;
          }
        }
        if (!recipientEmail && members.length > 0) {
          const fetchedUsers = await Promise.all(
            members.map((mId) =>
              firestoreRestGet(`users/${mId}`, idToken)
                .then((raw) => parseFirestoreDoc(raw))
                .catch(() => null)
            )
          );
          const match = fetchedUsers.find((u) => u?.email && u.email.includes("@"));
          if (match) {
            recipientEmail = match.email;
            recipientName = match.name || "Investor";
          }
        }
      }

      if (!recipientEmail) {
        return { sent: false, error: "Could not find a recipient email address for this household." };
      }

      const mode = opts?.mode === "sip" ? "sip" : "full";
      const plan = computeRebalancePlan(stats, household.targets, {
        mode,
        freshInflowINR: opts?.freshInflowINR,
        fxRate
      });

      const fmtINR = (v: number) => `Rs. ${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
      const fmtUSD = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
      const orders = (mode === "sip" ? plan.sipAllocations : plan.orders).map((o) => ({
        type: o.type,
        title: o.title,
        category: o.category,
        amount:
          o.currency === "USD"
            ? `${fmtUSD(o.amountUSD)} (${fmtINR(o.amountINR)})`
            : fmtINR(o.amountINR),
        description: o.description
      }));

      const executiveSummary =
        stats.accuracy >= threshold
          ? `${household.name || "Your family portfolio"} is well aligned at ${stats.accuracy.toFixed(1)}% against your ${(plan.targetEquityPct * 100).toFixed(0)}/${(plan.targetDebtPct * 100).toFixed(0)} Equity/Debt target.`
          : `${household.name || "Your family portfolio"} is currently at ${(stats.actualEquityPct * 100).toFixed(1)}% Equity vs your ${(plan.targetEquityPct * 100).toFixed(0)}% target (${stats.accuracy.toFixed(1)}% alignment vs ${threshold}% threshold). Review the recommended ${mode === "sip" ? "Zero-Sell SIP routing" : "rebalance trades"} below.`;

      const content = buildRebalanceEmailContent({
        householdName: household.name || "Family Portfolio",
        recipientName: recipientName || "Investor",
        totalValINR: stats.totalValINR,
        totalValUSD: stats.totalValUSD,
        accuracy: stats.accuracy,
        threshold,
        actualEquityPct: stats.actualEquityPct,
        targetEquityPct: plan.targetEquityPct,
        indianEquityPctOfEq: stats.indianEquityShareOfEquity,
        foreignEquityPctOfEq: stats.foreignEquityShareOfEquity,
        mode,
        executiveSummary,
        orders,
        appUrl
      });

      const delivery = await sendHouseholdEmail({
        householdId,
        to: recipientEmail,
        subject: content.subject,
        text: content.text,
        html: content.html
      });

      if (delivery.sent) {
        await setAppStateKeyPg(lastSentKey, now);
        await addNotificationPg({
          householdId,
          category: "drift",
          severity: stats.accuracy < threshold ? "warning" : "info",
          title: mode === "sip" ? "Zero-Sell SIP Plan Emailed" : "Rebalance Alert Emailed",
          message: `Delivered ${mode === "sip" ? "Zero-Sell SIP plan" : "rebalance report"} (${stats.accuracy.toFixed(1)}% aligned) to ${recipientEmail}.`,
          actionTab: "rebalance",
          createdAt: now
        }).catch(() => {});
      }

      return {
        ...delivery,
        recipientEmail,
        accuracy: stats.accuracy
      };
    } catch (e: any) {
      console.error("[Rebalance Email Error]", e?.response?.data || e.message);
      return {
        sent: false,
        error: e?.response?.data?.error?.message || e.message || "Rebalance email check failed"
      };
    }
  }

  app.post("/api/rebalance/check-now", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
    const { householdId, toEmail, recipientName, mode, freshInflowINR } = req.body || {};
    const baseUrl = resolveRequestBaseUrl(req);

    const outcome = await checkAndSendRebalanceAlert(householdId, true, {
      idToken: idToken || undefined,
      toEmail,
      recipientName,
      mode,
      freshInflowINR,
      baseUrl
    });

    res.json({
      success: Boolean(outcome?.sent),
      message: outcome?.sent
        ? `Rebalance report emailed to ${outcome.recipientEmail || toEmail} via ${outcome.senderEmail || outcome.provider}.`
        : outcome?.error || "Email was not sent automatically.",
      ...outcome
    });
  });

  app.post("/api/rebalance/send-email", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
    const { householdId, toEmail, recipientName, mode, freshInflowINR, clientReport } = req.body || {};
    const baseUrl = resolveRequestBaseUrl(req);

    const outcome = await checkAndSendRebalanceAlert(householdId, true, {
      idToken: idToken || undefined,
      toEmail,
      recipientName,
      mode,
      freshInflowINR,
      clientReport,
      baseUrl
    });

    res.json({
      success: Boolean(outcome?.sent),
      message: outcome?.sent
        ? `Rebalance plan emailed to ${outcome.recipientEmail || toEmail} via ${outcome.senderEmail || outcome.provider}.`
        : outcome?.error || "Outgoing email sender not connected yet.",
      ...outcome
    });
  });

  app.get("/api/fx-rates", async (_req, res) => {
    const inrRate = await getUsdInrRate();
    res.json({ INR: inrRate, USD: 1.0 });
  });

  app.get("/api/market/price/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    try {
      const priceMap = await fetchLiveStockPrices([ticker]);
      if (priceMap[ticker]) {
        return res.json({ ticker, price: priceMap[ticker] });
      }
      res.status(404).json({ error: "Price not found" });
    } catch {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  function parseSpreadsheetBase64ToText(base64Content: string, fileName?: string): string {
    const cleanB64 = String(base64Content || "").includes(",")
      ? String(base64Content).split(",").pop() || ""
      : String(base64Content || "");
    const buf = Buffer.from(cleanB64, "base64");
    if (buf.length === 0) {
      const err: any = new Error("Empty spreadsheet file received.");
      err.statusCode = 400;
      throw err;
    }

    if (
      buf.length >= 8 &&
      buf[0] === 0xd0 &&
      buf[1] === 0xcf &&
      buf[2] === 0x11 &&
      buf[3] === 0xe0 &&
      buf.toString("latin1").includes("EncryptedPackage")
    ) {
      const err: any = new Error(
        "This Excel (.xlsx) file is password-protected. Please open it, save an unlocked .xlsx or .csv copy, and upload again."
      );
      err.statusCode = 400;
      throw err;
    }

    const xlsxLib: any = (XLSX as any).read ? XLSX : (XLSX as any).default;
    const workbook = xlsxLib.read(buf, { type: "buffer", raw: false, cellDates: true });
    const sheetNames: string[] = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
    const sections: string[] = [];

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets?.[sheetName];
      if (!sheet) continue;
      const rawCsv: string = xlsxLib.utils.sheet_to_csv(sheet, { blankrows: false });
      const cleanedLines = rawCsv
        .split(/\r?\n/)
        .map((line: string) => line.replace(/,+$/g, "").trim())
        .filter((line: string) => line.length > 0 && /[^,\s"]/.test(line));
      if (cleanedLines.length > 0) {
        sections.push(`=== Excel Worksheet: ${sheetName} ===\n${cleanedLines.join("\n")}`);
      }
    }

    if (sections.length === 0) {
      const err: any = new Error(
        `No non-empty data rows were found in ${fileName || "the uploaded Excel workbook"}.`
      );
      err.statusCode = 400;
      throw err;
    }

    return sections.join("\n\n");
  }

  app.post("/api/gemini/extract", async (req, res) => {
    const { content, isPDF, isSpreadsheet, fileName, providerHint } = req.body;
    if (!content) {
      return res.status(400).json({ error: "No file content received." });
    }

    const treatAsSpreadsheet =
      !isPDF &&
      (Boolean(isSpreadsheet) || /\.(xlsx|xls|ods)$/i.test(String(fileName || "")));

    let looksEncryptedPdf = false;
    if (isPDF && typeof content === "string") {
      try {
        const head = Buffer.from(content.slice(0, 65536), "base64").toString("latin1");
        const tail = content.length > 65536 ? Buffer.from(content.slice(-65536), "base64").toString("latin1") : "";
        if ((head + tail).includes("/Encrypt")) {
          looksEncryptedPdf = true;
        }
      } catch {
        // ignore buffer check failure
      }
    }

    try {
      let resolvedTextContent = "";
      if (treatAsSpreadsheet) {
        resolvedTextContent = parseSpreadsheetBase64ToText(String(content), fileName);
      } else if (!isPDF) {
        resolvedTextContent = String(content);
      }

      const hintLine = providerHint ? `\nUser selected account/broker hint: "${providerHint}".` : "";
      const fileLine = fileName ? `\nUploaded filename: "${fileName}".` : "";

      const extractionInstructions = `You are a precision financial statement parser supporting Indian and US brokerages across PDF, CSV, and Excel (.xlsx / .xls) workbooks:
- CAMS / KFintech / MFCentral Consolidated Account Statement (CAS) PDFs & Excel exports
- Zerodha Console / Kite / Coin Holdings XLSX, CSVs & PDFs
- INDmoney US Stocks (DriveWealth/Alpaca) & Indian Portfolio XLSX, CSVs & PDFs
- Charles Schwab Positions CSVs, XLSX & Brokerage Statement PDFs
- Interactive Brokers (IBKR) Activity Statement / Open Positions CSVs, XLSX & PDFs
- E*TRADE (Morgan Stanley) Portfolio Download XLSX, CSVs & RSU/ESPP/Brokerage PDFs
- Custom Family Wealth / Broker Excel (.xlsx / .xls) & CSV spreadsheets${hintLine}${fileLine}

Return ONLY a valid JSON object matching this exact structure:
{
  "statementType": "holdings" | "capital_gains_only" | "transactions_only" | "unvested_rsu_only",
  "provider": "CAMS" | "KFintech" | "Zerodha" | "INDmoney" | "Charles Schwab" | "IBKR" | "E*TRADE" | "Statement",
  "statementMonth": "YYYY-MM valuation month printed on the statement (e.g. 2026-11) or empty string",
  "summaryNote": "1-sentence description of what was detected",
  "holdings": [
    {
      "ticker": "Stock ticker (e.g. NVDA, AAPL, QCOM, RELIANCE.NS) or short clean MF name",
      "schemeName": "Short clean display name (strip Direct/Regular/Growth/ISIN noise)",
      "originalName": "Full verbatim security/scheme name from statement (include ISIN if printed)",
      "isin": "12-char ISIN (e.g. INF179K01BE2) if present, else empty string",
      "units": 123.456,
      "nav": 94.25,
      "assetClass": "Equity" | "Debt" | "Mutual Fund",
      "currency": "INR" | "USD",
      "lots": [
        {
          "acquiredDate": "YYYY-MM-DD purchase or RSU vest release date if shown for open units",
          "units": 45.0,
          "costPerUnit": 168.50,
          "acquisitionType": "RSU Vest" | "ESPP" | "Market Buy" | "SIP"
        }
      ]
    }
  ],
  "unvestedGrants": [
    {
      "ticker": "Stock ticker (e.g. QCOM, GOOGL, MSFT, NVDA)",
      "grantName": "Grant ID or Grant Name if shown",
      "provider": "E*TRADE" | "Charles Schwab" | "Statement",
      "vestSchedule": [
        {
          "vestDate": "YYYY-MM-DD future vest date",
          "grossUnits": 50
        }
      ]
    }
  ]
}

CRITICAL STATEMENT TYPE & EXCEL WORKBOOK RULES (DO NOT VIOLATE):
1. Check the document title, worksheet names, and table columns FIRST.
2. If the file is a "Capital Gain / Loss Statement", "Tax P&L", "Realized Gain/Loss", or "Redemption Statement" that ONLY lists sold/redeemed/switched-out tax lots WITHOUT current open/closing unit balances (for example, CAMS Capital Gain / Loss Statement or Zerodha Tax P&L XLSX with only realized trades), you MUST set:
   "statementType": "capital_gains_only",
   "holdings": []
   NEVER treat redeemed/sold units as active portfolio holdings!
3. If the file has BOTH historical transactions AND a "Closing Unit Balance" / "Open Positions" / "Ending Balance" column or summary, set "statementType": "holdings" and extract ONLY the current open/closing balance for each asset where units > 0. Ignore zero-balance folios and closed positions.
4. For Excel (.xlsx / .xls) workbooks containing "=== Excel Worksheet: <Name> ===" sections:
   - Skip metadata/header preamble rows above the actual column header row (e.g. Client ID, Unrealized P&L summary, disclaimers).
   - Extract active holdings across separate asset worksheets (e.g. "Equity" and "Mutual Funds"), but do NOT double-count an overview/combined summary sheet if individual sheets already list the same positions.

BROKER, TICKER & CURRENCY RULES:
- CAMS / KFintech / MFCentral CAS:
  - provider: "CAMS" (or "KFintech" if exclusively KFintech).
  - currency: "INR".
  - Extract the 12-char "INF..." ISIN into "isin" whenever shown!
  - assetClass: MUST be "Debt" if scheme name contains "Arbitrage", "Liquid", "Money Market", "Overnight", "Ultra Short", "Low Duration", "Short Term", "Short Duration", "Corporate Bond", "Gilt", "Banking and PSU", "Banking & PSU", "Dynamic Bond", "Floater", or "Debt"; otherwise "Mutual Fund".
- Zerodha (XLSX / CSV / PDF):
  - provider: "Zerodha", currency: "INR".
  - In Zerodha Console Holdings XLSX/CSV ("Quantity Available", "Quantity Discrepant", "Quantity Long Term", "Quantity Pledged (Margin)", "Quantity Pledged (Loan)", "Previous Closing Price"): note that "Quantity Long Term" is ALREADY a subset of "Quantity Available" — NEVER add "Quantity Long Term" on top of "Quantity Available"! Total units = Quantity Available + Quantity Discrepant + Quantity Pledged (Margin) + Quantity Pledged (Loan).
  - For Indian NSE/BSE stocks & ETFs (e.g. RELIANCE, INFY, TCS, HDFCBANK, NIFTYBEES, GOLDBEES), append ".NS" to ticker (e.g. "RELIANCE.NS") and set assetClass to "Equity" (except LIQUIDBEES / LIQUIDCASE / GILT / BHARATBOND -> "Debt"). For Coin Mutual Funds (e.g. INF... ISINs or Mutual Funds worksheet), set assetClass to "Mutual Fund" (or "Debt" if Arbitrage/Debt).
- INDmoney:
  - provider: "INDmoney".
  - For US Stocks/ETFs (DriveWealth/Alpaca statements or US stock holdings like AAPL, NVDA, MSFT, GOOGL, META, AMZN, TSLA, QCOM, VOO, QQQ, including fractional shares like 0.4521), set currency to "USD", assetClass to "Equity", and ticker to the clean US symbol (e.g. "NVDA"). For Indian MFs/stocks in INDmoney, use "INR".
- Charles Schwab:
  - provider: "Charles Schwab", currency: "USD".
  - Ignore "Account Total", "Positions Total", and "Cash & Cash Investments" rows. Convert "BRK/B" -> "BRK.B". Money market / treasury funds (SWVXX, SNVXX, SGOV, BIL, USFR, BND, TLT) -> assetClass "Debt"; stocks/equity ETFs -> "Equity".
- Interactive Brokers (IBKR):
  - provider: "IBKR".
  - From "Open Positions" (Summary rows for Stocks/ETFs/Bonds), extract symbol, open quantity, and close/mark price. Ignore "Total" and "Forex" rows. Default currency "USD" (or "INR" if NSE).
- E*TRADE:
  - provider: "E*TRADE", currency: "USD", assetClass: "Equity".
  - Extract portfolio positions and VESTED/sellable RSU or ESPP shares into "holdings" (NEVER include unvested future shares in "holdings"!).
  - If open tax lots / RSU release dates & vest FMVs or purchase dates/costs are shown for open shares (in E*TRADE, Schwab Lot Details, IBKR, Zerodha, or CAMS transaction folios), populate the holding's "lots" array with YYYY-MM-DD "acquiredDate", open "units", and native "costPerUnit".
  - If unvested future RSU vest dates and unvested quantities are shown on the statement, extract them ONLY into top-level "unvestedGrants" (and if the file has ONLY unvested future grants and 0 vested shares, set "statementType": "unvested_rsu_only").
- MANDATORY GLOBAL RULE: Any fund or ETF containing the word "Arbitrage" MUST have assetClass = "Debt".`;

      const promptParts: any[] = [{ text: extractionInstructions }];

      if (isPDF) {
        promptParts.push({
          inlineData: {
            data: content,
            mimeType: "application/pdf"
          }
        });
      } else {
        promptParts[0].text += `\n\nFile Content:\n${resolvedTextContent.slice(0, 350000)}`;
      }

      const text = await callGeminiJSON(promptParts);
      const cleaned = (text || "").replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      const rawList: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.holdings) ? parsed.holdings : [];
      const statementType: string = Array.isArray(parsed) ? "holdings" : parsed?.statementType || "holdings";
      const detectedProvider: string = providerHint || (!Array.isArray(parsed) && parsed?.provider) || "CAMS";
      const summaryNote: string = (!Array.isArray(parsed) && parsed?.summaryNote) || "";

      if (statementType === "capital_gains_only" && rawList.length === 0) {
        return res.json({
          statementType: "capital_gains_only",
          provider: detectedProvider,
          summaryNote,
          warning:
            "This file is a Capital Gain / Loss (Redemption) tax statement showing sold units rather than active holdings. Please upload a CAMS / MFCentral Consolidated Account Statement (CAS) or Portfolio Holdings statement with current balances.",
          holdings: []
        });
      }

      const skipTickers = new Set(["CASH", "TOTAL", "ACCOUNT TOTAL", "POSITIONS TOTAL", "CASH & CASH INVESTMENTS", "USD"]);
      const consolidatedMap = new Map<string, any>();

      for (const item of rawList) {
        const units = Number(String(item.units ?? item.quantity ?? 0).replace(/,/g, ""));
        const nav = Number(String(item.nav ?? item.currentPrice ?? item.price ?? 0).replace(/[$,₹,\s]/g, ""));
        if (!units || isNaN(units) || units <= 0) continue;

        const origName = String(item.originalName || item.schemeName || item.ticker || "").trim();
        const schemeName = String(item.schemeName || item.ticker || origName).trim();
        let rawTicker = String(item.ticker || item.schemeName || origName).trim();
        if (skipTickers.has(rawTicker.toUpperCase()) || skipTickers.has(origName.toUpperCase())) continue;

        const rowProvider = String(item.provider || detectedProvider || "CAMS").trim();
        let currency: "USD" | "INR" = item.currency === "USD" ? "USD" : "INR";
        if (["Charles Schwab", "IBKR", "E*TRADE"].includes(rowProvider) && !item.currency) {
          currency = "USD";
        }
        if (rawTicker.toUpperCase() === "QCOM" || /qualcomm/i.test(origName)) {
          currency = "USD";
        }

        let assetClass: "Equity" | "Debt" | "Mutual Fund" =
          item.assetClass === "Debt" ? "Debt" : item.assetClass === "Equity" ? "Equity" : "Mutual Fund";

        if (DEBT_KEYWORDS_REGEX.test(origName) || DEBT_KEYWORDS_REGEX.test(schemeName) || DEBT_KEYWORDS_REGEX.test(rawTicker)) {
          assetClass = "Debt";
        } else if (currency === "USD" && assetClass === "Mutual Fund") {
          assetClass = "Equity";
        }

        if (assetClass === "Equity" || (currency === "USD" && /^[A-Z./-]{1,10}$/i.test(rawTicker))) {
          rawTicker = rawTicker.toUpperCase().replace(/\//g, ".");
          if (
            currency === "INR" &&
            rowProvider === "Zerodha" &&
            /^[A-Z0-9&-]{1,15}$/.test(rawTicker) &&
            !rawTicker.endsWith(".NS") &&
            !rawTicker.endsWith(".BO")
          ) {
            rawTicker = `${rawTicker}.NS`;
          }
          if (currency === "USD") {
            rawTicker = rawTicker.replace(/\.US$/, "");
          }
        }

        const isinMatch = `${item.isin || ""} ${origName}`.match(/\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/i);
        const isin = isinMatch ? isinMatch[1].toUpperCase() : "";
        const dedupKey = `${rowProvider}|${currency}|${isin || rawTicker.toUpperCase()}|${assetClass}`;

        const parsedLots = Array.isArray(item.lots)
          ? item.lots
              .map((l: any) => ({
                acquiredDate: String(l?.acquiredDate || "").trim(),
                units: Number(String(l?.units ?? l?.quantity ?? 0).replace(/,/g, "")),
                costPerUnit: Number(String(l?.costPerUnit ?? l?.cost ?? 0).replace(/[$,₹,\s]/g, "")),
                acquisitionType: ["RSU Vest", "ESPP", "Market Buy", "SIP"].includes(String(l?.acquisitionType))
                  ? String(l.acquisitionType)
                  : rowProvider === "E*TRADE"
                  ? "RSU Vest"
                  : assetClass === "Mutual Fund"
                  ? "SIP"
                  : "Market Buy"
              }))
              .filter(
                (l: any) =>
                  /^\d{4}-\d{2}-\d{2}$/.test(l.acquiredDate) &&
                  l.units > 0 &&
                  !isNaN(l.costPerUnit) &&
                  l.costPerUnit >= 0
              )
          : [];

        if (consolidatedMap.has(dedupKey)) {
          const prev = consolidatedMap.get(dedupKey)!;
          prev.units = Number((prev.units + units).toFixed(6));
          if (!prev.nav && nav > 0) prev.nav = nav;
          if (parsedLots.length > 0) {
            prev.lots = [...(prev.lots || []), ...parsedLots];
          }
        } else {
          consolidatedMap.set(dedupKey, {
            ticker: rawTicker.slice(0, 50),
            schemeName: schemeName.slice(0, 50),
            originalName: origName,
            isin,
            units,
            nav: isNaN(nav) ? 0 : nav,
            assetClass,
            currency,
            provider: rowProvider,
            lots: parsedLots
          });
        }
      }

      const enrichedHoldings = Array.from(consolidatedMap.values());
      const amfiIndex = await getAmfiIndex();
      const stockSymbolsToFetch = new Set<string>();

      for (const h of enrichedHoldings) {
        if (
          h.currency === "INR" &&
          (h.assetClass === "Mutual Fund" || h.assetClass === "Debt" || /^INF[A-Z0-9]{9}$/.test(h.isin))
        ) {
          const mf = findAmfiMatchIndexed(amfiIndex, h);
          if (mf) {
            h.ticker = mf.symbol;
            if (mf.currentPrice > 0) h.nav = mf.currentPrice;
            if (!h.originalName || h.originalName.length < mf.shortname.length) {
              h.originalName = mf.shortname;
            }
            continue;
          }
        }
        if (h.assetClass === "Equity" || h.currency === "USD" || h.ticker.endsWith(".NS") || h.ticker.endsWith(".BO")) {
          stockSymbolsToFetch.add(h.ticker);
        }
      }

      if (stockSymbolsToFetch.size > 0) {
        try {
          const livePrices = await fetchLiveStockPrices(Array.from(stockSymbolsToFetch));
          for (const h of enrichedHoldings) {
            if (livePrices[h.ticker] && livePrices[h.ticker] > 0) {
              h.nav = livePrices[h.ticker];
            }
          }
        } catch (err) {
          console.warn("[extract] Live stock price enrichment warning:", err);
        }
      }

      const statementMonth: string =
        !Array.isArray(parsed) && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(parsed?.statementMonth || ""))
          ? String(parsed.statementMonth)
          : "";

      const rawUnvestedGrants: any[] =
        !Array.isArray(parsed) && Array.isArray(parsed?.unvestedGrants) ? parsed.unvestedGrants : [];
      const cleanedUnvestedGrants = rawUnvestedGrants
        .map((g: any) => {
          const ticker = String(g?.ticker || "").trim().toUpperCase().replace(/\.US$/, "");
          const vestSchedule = Array.isArray(g?.vestSchedule)
            ? g.vestSchedule
                .map((v: any) => ({
                  vestDate: String(v?.vestDate || "").trim(),
                  grossUnits: Number(String(v?.grossUnits ?? v?.units ?? 0).replace(/,/g, ""))
                }))
                .filter((v: any) => /^\d{4}-\d{2}-\d{2}$/.test(v.vestDate) && v.grossUnits > 0)
            : [];
          return {
            ticker,
            grantName: String(g?.grantName || `${ticker} RSU Grant`).trim(),
            provider: String(g?.provider || detectedProvider || "E*TRADE").trim(),
            vestSchedule
          };
        })
        .filter((g: any) => g.ticker && g.vestSchedule.length > 0);

      res.json({
        statementType,
        provider: detectedProvider,
        statementMonth,
        summaryNote,
        holdings: enrichedHoldings,
        unvestedGrants: cleanedUnvestedGrants
      });
    } catch (e: any) {
      console.error("Gemini Extraction Error:", e);
      if (looksEncryptedPdf) {
        return res.status(400).json({
          error:
            "This PDF is password-protected (encrypted). Please unlock or 'Print to PDF' first (CAMS/CAS password is usually PAN or DDMMYYYY) and upload again."
        });
      }
      const errStatus = Number(e?.statusCode) || 500;
      res.status(errStatus).json({ error: errStatus === 400 ? e.message : "Failed to extract data: " + e.message });
    }
  });

  // Vite middleware for development; static hashed asset caching in production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(
      express.static(distPath, {
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        }
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Unhandled Error]", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Pre-warm indexed AMFI NAV cache & FX rate in background
    getAmfiIndex().catch((err) => console.warn("[AMFI] Background warmup failed:", err.message));
    getUsdInrRate().catch(() => {});

    // Background Monitoring: Check all registered households every 4 hours
    setInterval(() => {
      const householdIds = Array.from(inviteCodeByHousehold.keys());
      if (householdIds.length === 0) return;
      console.log(`[MONITOR] Running background rebalance check for ${householdIds.length} household(s)...`);
      householdIds.forEach((householdId) => {
        checkAndSendRebalanceAlert(householdId, false).catch((err) =>
          console.error("Monitor failed for", householdId, err)
        );
      });
    }, 4 * 60 * 60 * 1000);
  });
}

startServer();
