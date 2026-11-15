import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import axios from "axios";
import { Resend } from "resend";
import { OAuth2Client } from "google-auth-library";
import { parseStringPromise } from 'xml2js';
import * as XLSX from "xlsx";
import https from "https";
import crypto from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";
import {
  initPostgresStore,
  getPostgresStatus,
  persistAppStateAsync,
  upsertInviteCodePg,
  getInviteCodePg,
  getInviteByHouseholdPg,
  upsertWealthSnapshotPg,
  getWealthHistoryPg,
  deleteWealthSnapshotPg,
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

// Initialize Firebase Admin (Lazy helper)
function getFirestoreInstance() {
  if (getApps().length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        initializeApp({
          credential: cert(serviceAccount),
          projectId: firebaseConfig.projectId,
        });
      } catch (e) {
        console.error("[Firestore] Invalid FIREBASE_SERVICE_ACCOUNT JSON, falling back:", e);
        initializeApp({ projectId: firebaseConfig.projectId });
      }
    } else {
      initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
  }
  return getFirestore(firebaseConfig.firestoreDatabaseId);
}

const firestore = getFirestoreInstance();

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });

async function callGeminiJSON(parts: any[]): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const modelsToTry = [
    {
      model: "gemini-3.5-flash-lite",
      timeout: 25000,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    },
    {
      model: "gemini-flash-lite-latest",
      timeout: 25000,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    },
    {
      model: "gemini-3.6-flash",
      timeout: 30000,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    },
    {
      model: "gemini-3.8-flash",
      timeout: 30000,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
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
      const outText = response.data?.candidates?.[0]?.content?.parts
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
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  const DB_PATH = path.join(process.cwd(), "db.json");

  // Initial DB if not exists
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      users: {
        "u_himanshu": { id: "u_himanshu", email: "himgarg@google.com", password: "password", name: "Himanshu Garg", householdId: "h_garg" },
        "u_nisha": { id: "u_nisha", email: "nndhake@gmail.com", password: "password", name: "Nisha Dhake", householdId: "h_garg" }
      },
      households: {
        "h_garg": {
          id: "h_garg",
          name: "Garg Family",
          members: ["u_himanshu", "u_nisha"],
          targets: {
            assetSplit: { Equity: 0.70, Debt: 0.30 },
            equitySplit: { Indian: 0.60, Foreign: 0.40 },
            foreignBreakdown: [
              { 
                name: "Global Large Cap", 
                percentage: 50, 
                tickerWeights: [
                  { ticker: "GOOGL", weight: 25 },
                  { ticker: "MSFT", weight: 25 },
                  { ticker: "AAPL", weight: 25 },
                  { ticker: "AMZN", weight: 25 }
                ] 
              },
              { 
                name: "Semiconductors", 
                percentage: 50, 
                tickerWeights: [
                  { ticker: "NVDA", weight: 34 },
                  { ticker: "AMD", weight: 33 },
                  { ticker: "TSM", weight: 33 }
                ] 
              }
            ]
          }
        }
      },
      holdings: [],
      invites: [],
      inviteCodes: {}
    }, null, 2));
  }

  function getDB() {
    try {
      const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      if (!db.invites) db.invites = [];
      if (!db.inviteCodes) db.inviteCodes = {};
      return db;
    } catch (e) {
      console.error("DB Read failed, returning empty state to prevent crash");
      return { users: {}, households: {}, holdings: [], invites: [], inviteCodes: {} };
    }
  }

  function saveDB(data: any) {
    // Atomic write to prevent corruption
    const tempPath = DB_PATH + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, DB_PATH);
    persistAppStateAsync(data);

    // Create a rotating backup
    try {
      const backupDir = path.join(process.cwd(), "db_backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(backupDir, `db-backup-${timestamp}.json`);
      fs.copyFileSync(DB_PATH, backupPath);

      // Keep only last 10 backups
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith("db-backup-"))
        .sort((a, b) => fs.statSync(path.join(backupDir, b)).mtimeMs - fs.statSync(path.join(backupDir, a)).mtimeMs);
      
      if (files.length > 10) {
        files.slice(10).forEach(f => fs.unlinkSync(path.join(backupDir, f)));
      }
    } catch (e) {
      console.error("Backup failed", e);
    }
  }

  // --- Firestore Migration ---
  async function migrateToFirestore() {
    try {
      console.log("[Firestore] Checking for existing data...");
      const usersSnap = await firestore.collection('users').limit(1).get();
      if (!usersSnap.empty) {
        console.log("[Firestore] Data already exists, skipping initial migration.");
        return;
      }

      console.log("[Firestore] Empty database detected. Migrating local db.json to Firestore...");
      const dbData = getDB();
      const batch = firestore.batch();

      // Migrate Users
      for (const [id, user] of Object.entries(dbData.users)) {
        const { password, ...safeUser } = user as any;
        batch.set(firestore.collection('users').doc(id), { 
          ...safeUser, 
          createdAt: FieldValue.serverTimestamp() 
        });
      }

      // Migrate Households
      for (const [id, household] of Object.entries(dbData.households)) {
        batch.set(firestore.collection('households').doc(id), household as any);
      }

      // Migrate Holdings
      if (Array.isArray(dbData.holdings)) {
        for (const holding of dbData.holdings) {
          batch.set(firestore.collection('holdings').doc((holding as any).id), holding as any);
        }
      }

      await batch.commit();
      console.log("[Firestore] Migration complete.");
    } catch (e: any) {
      console.error("[Firestore] Migration failed or API disabled:", e.message);
      console.log("[Firestore] The app will continue using the local db.json fallback for now.");
    }
  }

  // Initialize managed PostgreSQL persistence & hydrate any state across container restarts
  try {
    const pgInit = await initPostgresStore();
    if (pgInit.connected) {
      const currentDb = getDB();
      let hydrated = false;
      if (pgInit.restoredDbJson && typeof pgInit.restoredDbJson === "object") {
        if (pgInit.restoredDbJson.users && Object.keys(pgInit.restoredDbJson.users).length > Object.keys(currentDb.users || {}).length) {
          currentDb.users = { ...currentDb.users, ...pgInit.restoredDbJson.users };
          hydrated = true;
        }
        if (Array.isArray(pgInit.restoredDbJson.invites) && pgInit.restoredDbJson.invites.length > 0) {
          currentDb.invites = pgInit.restoredDbJson.invites;
          hydrated = true;
        }
        if (pgInit.restoredDbJson.inviteCodes) {
          currentDb.inviteCodes = { ...currentDb.inviteCodes, ...pgInit.restoredDbJson.inviteCodes };
          hydrated = true;
        }
      }
      if (Object.keys(pgInit.restoredInviteCodes).length > 0) {
        currentDb.inviteCodes = { ...currentDb.inviteCodes, ...pgInit.restoredInviteCodes };
        hydrated = true;
      }
      if (hydrated) {
        fs.writeFileSync(DB_PATH, JSON.stringify(currentDb, null, 2));
        console.log(`[Postgres] Hydrated ${Object.keys(currentDb.inviteCodes || {}).length} family invite code(s) into local cache.`);
      }
    }
  } catch (pgBootErr: any) {
    console.warn("[Postgres] Startup hydration skipped:", pgBootErr.message);
  }

  // Run migration in background to not block startup
  migrateToFirestore().catch(err => {
    console.error("[Firestore] Background migration error:", err);
  });

  // --- Data Management APIs ---
  app.get("/api/admin/export-db", (req, res) => {
    const db = getDB();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=unitywealth-backup.json');
    res.send(JSON.stringify(db, null, 2));
  });

  app.post("/api/admin/import-db", (req, res) => {
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: "Invalid data format" });
    }
    // Basic validation
    if (!data.users || !data.households || !data.holdings) {
       return res.status(400).json({ error: "Data is missing required fields (users, households, holdings)" });
    }
    saveDB(data);
    res.json({ success: true, message: "Database updated successfully" });
  });

  app.get("/api/admin/backups", (req, res) => {
    try {
      const backupDir = path.join(process.cwd(), "db_backups");
      if (!fs.existsSync(backupDir)) return res.json([]);
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith("db-backup-"))
        .map(f => ({
           id: f,
           time: fs.statSync(path.join(backupDir, f)).mtime
        }))
        .sort((a, b) => b.time.getTime() - a.time.getTime());
      res.json(files);
    } catch (e) {
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  app.post("/api/admin/backups/restore", (req, res) => {
    const { id } = req.body;
    try {
      const backupDir = path.join(process.cwd(), "db_backups");
      const backupPath = path.join(backupDir, id);
      if (!fs.existsSync(backupPath)) return res.status(404).json({ error: "Backup not found" });
      
      const data = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
      saveDB(data);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Restore failed" });
    }
  });

  app.post("/api/auth/check-account", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
      const { getAuth } = await import("firebase-admin/auth");
      const authAdmin = getAuth();
      await authAdmin.getUserByEmail(email);
      res.json({ success: true, message: "Account identified" });
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        res.status(404).json({ error: "No account found for this email address." });
      } else {
        res.status(500).json({ error: "Failed to check account: " + e.message });
      }
    }
  });

  app.post("/api/auth/force-reset-password", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    try {
      const { getAuth } = await import("firebase-admin/auth");
      const authAdmin = getAuth();
      const user = await authAdmin.getUserByEmail(email);
      await authAdmin.updateUser(user.uid, { password });
      
      console.log(`[AUTH] Admin-forced password reset for: ${email}`);
      res.json({ success: true, message: "Password updated successfully" });
    } catch (e: any) {
      console.error("[AUTH] Force reset failed:", e);
      if (e.code === 'auth/user-not-found') {
        res.status(404).json({ error: "No account found for this email address." });
      } else {
        res.status(500).json({ error: "Failed to reset password: " + e.message });
      }
    }
  });

  // Mock Email Logger / Real Resend
  async function logEmail(to: string, subject: string, body: string) {
    const logPath = path.join(process.cwd(), "email_logs.txt");
    let status = "MOCK";
    let errorDetails = "";

    // Use the provided 'to' address, but we can have a fallback for testing environments
    const finalTo = to || "hgarg5072@gmail.com";

    if (resend) {
      try {
        const fromEmail = (process.env.RESEND_FROM && process.env.RESEND_FROM.includes("@")) 
                 ? process.env.RESEND_FROM 
                 : "onboarding@resend.dev";

        const { data, error } = await resend.emails.send({
          from: fromEmail,
          to: finalTo,
          subject: subject,
          html: body.replace(/\n/g, '<br>'),
        });

        if (error) {
          status = "FAILED";
          // Resend validation errors often mean unverified domain or unverified recipient in sandbox
          const msg = error.message || "Unknown error";
          const isValidation = error.name === "validation_error";
          const resendHint = isValidation ? " (HINT: If using onboarding@resend.dev, you can only send to the email you signed up with. Also check if your Resend API key is valid.)" : "";
          
          errorDetails = `${error.name}: ${msg}${resendHint}`;
          console.error("[RESEND ERROR]", JSON.stringify(error, null, 2));
        } else {
          status = "REAL";
          console.log(`[REAL EMAIL SENT via Resend] To: ${finalTo}, ID: ${data?.id}`);
        }
      } catch (e: any) {
        status = "ERROR";
        errorDetails = e.message;
        console.error("[RESEND EXCEPTION]", e);
      }
    }

    const entry = `[${new Date().toISOString()}] [${status}] TO: ${to} (FINAL RECIPIENT: ${finalTo}) | SUBJECT: ${subject}${errorDetails ? ` | ERROR: ${errorDetails}` : ""}\nBODY: ${body}\n------------------\n`;
    fs.appendFileSync(logPath, entry);
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
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
    
    // Explicitly construct the URI from headers to match what Google sees
    const detectedUri = `${protocol}://${host}/auth/callback`;
    
    console.log(`[Google OAuth Debug] Host: ${host}, Proto: ${protocol}, Detected: ${detectedUri}`);

    if (host && !host.includes('localhost') && !host.startsWith('127.')) {
      return detectedUri;
    }

    if (process.env.APP_URL) {
      const appUrl = process.env.APP_URL.replace(/\/$/, "");
      if (host?.includes('localhost')) {
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
    const householdId = typeof req.query.householdId === 'string' ? req.query.householdId : '';
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    const loginHint = typeof req.query.loginHint === 'string' && req.query.loginHint
      ? req.query.loginHint
      : 'unitywealth.alerts@gmail.com';
    const statePayload = Buffer.from(JSON.stringify({ householdId, userId })).toString('base64url');
    console.log(`[Google OAuth] Generating Auth URL (Redirect URI: ${redirectUri}, hint: ${loginHint})`);
    
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      login_hint: loginHint,
      state: statePayload,
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.send'
      ]
    });
    res.json({ url, redirectUri });
  });

  // 1-Click convenience redirect to authorize unitywealth.alerts@gmail.com as global system sender
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
    if (typeof code !== 'string') return res.status(400).send("No code provided");

    const client = getGoogleClient(req);
    let parsedState: { householdId?: string; userId?: string } = {};
    if (typeof state === 'string' && state) {
      try {
        parsedState = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      } catch {
        // ignore invalid state
      }
    }

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Fetch user profile from Google
      const oauth2 = axios.create({
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await oauth2.get("https://www.googleapis.com/oauth2/v2/userinfo");
      const { email, name, id: googleId } = profile.data;

      const db = getDB();
      let user = Object.values(db.users).find((u: any) => u.email.toLowerCase() === email.toLowerCase()) as any;
      const existingCfg = await resolveEmailConfig(parsedState.householdId);
      const mergedTokens = {
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || existingCfg?.tokens?.refresh_token || user?.googleTokens?.refresh_token || undefined,
        expiry_date: tokens.expiry_date || Date.now() + 50 * 60 * 1000,
        scope: tokens.scope || undefined
      };

      if (!user) {
        const id = parsedState.userId || ("u_" + Math.random().toString(36).substr(2, 9));
        user = { 
          id, 
          email, 
          name, 
          googleId,
          googleTokens: mergedTokens,
          householdId: parsedState.householdId || null,
          provider: 'google'
        };
        db.users[id] = user;
        saveDB(db);
        console.log(`[Google OAuth] Created new user & email sender: ${email}`);
      } else {
        user.googleTokens = { ...(user.googleTokens || {}), ...mergedTokens };
        user.googleId = googleId;
        if (parsedState.householdId && !user.householdId) {
          user.householdId = parsedState.householdId;
        }
        saveDB(db);
        console.log(`[Google OAuth] Connected Gmail OAuth tokens for: ${email}`);
      }

      if (parsedState.userId && parsedState.userId !== user.id) {
        db.users[parsedState.userId] = {
          ...(db.users[parsedState.userId] || { id: parsedState.userId, email, name }),
          googleTokens: mergedTokens,
          householdId: parsedState.householdId || null
        };
        saveDB(db);
      }

      const isOfficial = email.toLowerCase() === "unitywealth.alerts@gmail.com";
      const resolvedSenderName = isOfficial
        ? "UnityWealth"
        : name || "UnityWealth Family Office";
      await saveHouseholdEmailConfig(parsedState.householdId || user.householdId, {
        provider: "gmail_oauth",
        senderEmail: email,
        senderName: resolvedSenderName,
        tokens: mergedTokens,
        updatedAt: Date.now()
      });
      await setAppStateKeyPg(`gmail_tokens:${parsedState.userId || email.toLowerCase()}`, mergedTokens);
      
      res.send(`
        <!doctype html>
        <html>
          <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Gmail Connected — UnityWealth</title></head>
          <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:40px 16px;text-align:center;color:#0f172a;">
            <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;padding:32px 24px;box-shadow:0 10px 28px rgba(15,23,42,0.08);">
              <div style="width:52px;height:52px;border-radius:16px;background:${isOfficial ? '#dcfce7' : '#e0e7ff'};color:${isOfficial ? '#15803d' : '#4338ca'};font-size:24px;font-weight:900;line-height:52px;margin:0 auto 14px;">✓</div>
              <h3 style="margin:0 0 8px;font-size:18px;font-weight:800;">${isOfficial ? 'Official UnityWealth Sender Active!' : 'Gmail Sender Connected'}</h3>
              <p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.55;">
                All Family Invitations &amp; 24/7 Rebalance Reports will now send from <strong>${resolvedSenderName} &lt;${email}&gt;</strong>.
              </p>
              ${!isOfficial ? `
              <div style="margin:0 0 18px;padding:12px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;font-size:12px;color:#92400e;line-height:1.45;">
                Want to use <strong>unitywealth.alerts@gmail.com</strong> instead?
                <div style="margin-top:8px;">
                  <a href="/connect-sender" style="display:inline-block;padding:8px 14px;border-radius:9px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;font-size:12px;">Switch to unitywealth.alerts@gmail.com</a>
                </div>
              </div>
              ` : ''}
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
        existing && (existing.provider === "gmail_oauth" || existing.provider === "gmail_token") && existing.senderEmail?.toLowerCase() === (senderEmail || caller.email).toLowerCase()
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
    const { userId, tokens, householdId, email, name } = req.body;
    const db = getDB();
    if (db.users[userId]) {
      db.users[userId].googleTokens = tokens;
      saveDB(db);
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

  // --- Gmail Sync Logic ---
  async function syncGmailForUser(userId: string) {
    const db = getDB();
    const user = db.users[userId];
    if (!user || !user.googleTokens) {
      throw new Error("User hasn't connected Gmail");
    }

    const oAuth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials(user.googleTokens);

    // Refresh token if needed
    oAuth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        user.googleTokens.refresh_token = tokens.refresh_token;
      }
      user.googleTokens.access_token = tokens.access_token;
      saveDB(getDB()); // Use fresh DB state
    });

    const { google } = await import('googleapis');
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Search for emails from CAS providers
    const queries = [
      'from:donotreply@camsonline.com "Consolidated Account Statement"',
      'from:donotreply@kfintech.com "Consolidated Account Statement"',
      'from:MFCentral "Account Statement"'
    ];

    let allAttachments: any[] = [];

    for (const q of queries) {
      const msgs = await gmail.users.messages.list({ userId: 'me', q });
      if (!msgs.data.messages) continue;

      for (const m of msgs.data.messages) {
        const msg = await gmail.users.messages.get({ userId: 'me', id: m.id! });
        const parts = msg.data.payload?.parts || [];
        
        for (const part of parts) {
          if (part.filename && part.filename.toLowerCase().endsWith('.pdf')) {
            const attachId = part.body?.attachmentId;
            if (attachId) {
              const attach = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: m.id!,
                id: attachId
              });
              if (attach.data.data) {
                allAttachments.push({
                  filename: part.filename,
                  data: attach.data.data, // Base64 encoded
                  messageId: m.id
                });
              }
            }
          }
        }
      }
    }

    if (allAttachments.length === 0) return { success: true, count: 0, message: "No CAS statements found in Gmail" };

    // Process only the latest one for now to save tokens/time
    const latest = allAttachments[0];
    
    // Use the existing Gemini extract logic (internal call or refactor)
    console.log(`[Gmail Sync] Processing attachment: ${latest.filename}`);
    
    // We can call the extract function directly or use axios to hit our own endpoint
    // To keep it simple, we'll try to use the same logic as /api/gemini/extract
    
    let promptParts: any[] = [
      { text: `Extract all investment holdings (Stocks, Mutual Funds, ETFs) from this PDF. \n\n` +
              "Return as a JSON array of objects with keys: schemeName, originalName, units, nav, assetClass (one of 'Equity', 'Debt', 'Mutual Fund').\n\n" +
              "STRICT CLEANING RULES for 'schemeName':\n" +
              "1. IDENTIFY the core name or ticker. \n" +
              "2. STRIP all plan/option/platform noise.\n" +
              "3. originalName: MUST be the verbatim name for accurate linking.\n\n" +
              "- units and nav: Must be numbers.\n" +
              "- Ignore zero balances." }
    ];

    promptParts.push({
      inlineData: {
        data: latest.data.replace(/-/g, '+').replace(/_/g, '/'), // Convert web-safe base64
        mimeType: "application/pdf"
      }
    });

    const rawJson = await callGeminiJSON(promptParts);
    const holdings = JSON.parse((rawJson || "[]").replace(/```json/g, "").replace(/```/g, "").trim());
    
    // Bulk add to DB
    if (holdings.length > 0) {
      const dbInstance = getDB();
      dbInstance.holdings = dbInstance.holdings.filter((h: any) => !(h.userId === userId && h.source === "GMAIL"));
      
      const newHoldings = holdings.map((h: any) => ({
        id: "h_" + Math.random().toString(36).substr(2, 9),
        userId,
        householdId: user.householdId,
        ticker: h.schemeName,
        quantity: parseFloat(h.units),
        assetClass: h.assetClass || "Mutual Fund",
        currency: "INR",
        provider: "GMAIL",
        source: "GMAIL",
        currentPrice: parseFloat(h.nav),
        originalName: h.originalName,
        syncedAt: Date.now()
      }));

      dbInstance.holdings.push(...newHoldings);
      saveDB(dbInstance);
    }

    return { success: true, count: holdings.length, filename: latest.filename };
  }

  app.post("/api/sync/gmail", async (req, res) => {
    const { userId } = req.body;
    try {
      const result = await syncGmailForUser(userId);
      res.json(result);
    } catch (e: any) {
      console.error("Gmail Sync Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/sync/request-cas", async (req, res) => {
    const { email } = req.body;
    // Mocking the trigger of a CAS request from MFCentral
    logEmail(email, "CAS Request Triggered", "We have initiated a Consolidated Account Statement request on your behalf via MFCentral. You will receive an email from CAMS/KFintech shortly. Once received, our sync engine will pick it up automatically.");
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
      message: result.sent ? `Test email sent via ${result.provider} (${result.senderEmail})` : (result.error || "Email not sent"),
      ...result
    });
  });

  app.post("/api/auth/signup", (req, res) => {
    const { email, password, name } = req.body;
    const db = getDB();
    const normalizedEmail = (email || "").trim().toLowerCase();
    
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (Object.values(db.users).find((u: any) => u.email.toLowerCase() === normalizedEmail)) {
      return res.status(400).json({ error: "An account with this email already exists." });
    }
    const id = "u_" + Math.random().toString(36).substr(2, 9);
    const newUser = { 
      id, 
      email: normalizedEmail, 
      password: (password || "").trim(), 
      name: (name || "New User").trim(), 
      householdId: null 
    };
    db.users[id] = newUser;
    saveDB(db);

    logEmail(normalizedEmail, "Welcome to UnityWealth", `Hi ${name}, welcome! Your account is ready.`);
    res.json(newUser);
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const db = getDB();
    const normalizedEmail = (email || "").trim().toLowerCase();
    const normalizedPass = (password || "").trim();

    const user: any = Object.values(db.users).find((u: any) => u.email.toLowerCase() === normalizedEmail);
    
    if (!user) {
      return res.status(404).json({ error: `No account found for '${email}'. Please sign up first.` });
    }
    
    if (user.password !== normalizedPass) {
      return res.status(401).json({ error: "Incorrect password. Please try again or reset it." });
    }

    res.json(user);
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    const db = getDB();
    const normalizedEmail = (email || "").trim().toLowerCase();
    const user: any = Object.values(db.users).find((u: any) => u.email.toLowerCase() === normalizedEmail);
    
    if (!user) {
      return res.status(404).json({ error: "This email is not registered with us." });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    saveDB(db);

    // Non-blocking email send
    logEmail(
      normalizedEmail, 
      "UnityWealth: Password Reset Code", 
      `Hi ${user.name},\n\nYour 6-digit password reset code is: ${resetCode}\n\nThis code will expire once used or if a new one is requested.`
    ).catch(e => console.error("Forgot Pass email failed", e));

    res.json({ success: true, message: "Reset code sent to your email" });
  });

  app.post("/api/auth/reset-password", (req, res) => {
    const { email, newPassword, code } = req.body;
    const db = getDB();
    const normalizedEmail = (email || "").trim().toLowerCase();
    const user: any = Object.values(db.users).find((u: any) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.resetCode || user.resetCode !== (code || "").trim()) {
      return res.status(401).json({ error: "Invalid or expired reset code." });
    }

    user.password = (newPassword || "").trim();
    delete user.resetCode;
    saveDB(db);

    res.json({ success: true, message: "Password updated successfully" });
  });

  app.post("/api/household/create", (req, res) => {
    const { userId, name } = req.body;
    const db = getDB();
    const householdId = "h_" + Math.random().toString(36).substr(2, 9);
    db.households[householdId] = {
      id: householdId,
      name,
      members: [userId],
      settings: {},
      targets: {
         assetSplit: { Equity: 0.70, Debt: 0.30 },
         equitySplit: { Indian: 0.60, Foreign: 0.40 },
         foreignBreakdown: [
            { name: "Magnificent 7", percentage: 100, tickers: ["GOOGL", "MSFT", "AAPL", "AMZN", "NVDA", "META", "TSLA"] }
         ]
      }
    };
    if (db.users[userId]) {
      db.users[userId].householdId = householdId;
    }
    saveDB(db);
    res.json(db.households[householdId]);
  });

  function normalizeInviteCode(raw: string): string {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/^UW[\-\s]*/i, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  function generateInviteCode(existingCodes: Record<string, any>): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = "";
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        code += alphabet[bytes[i] % alphabet.length];
      }
      if (!existingCodes[code]) return code;
    }
    return crypto.randomBytes(3).toString("hex").toUpperCase();
  }

  async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string; name: string }> {
    const resp = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      { idToken },
      { timeout: 10000, httpsAgent: ipv4HttpsAgent }
    );
    const u = resp.data?.users?.[0];
    if (!u?.localId) {
      throw new Error("Invalid Firebase authentication token");
    }
    return {
      uid: u.localId,
      email: (u.email || "").toLowerCase(),
      name: u.displayName || ""
    };
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
    const maskQuery = fieldPaths.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
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

  // Register or sync a household's shareable Invite Code (backed by member auth)
  app.post("/api/household/invite-code", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
      const { householdId, householdName, inviterName, refreshToken, preferredCode, toEmail } = req.body || {};

      if (!idToken || !householdId) {
        return res.status(400).json({ error: "Missing authentication token or householdId" });
      }

      const caller = await verifyFirebaseIdToken(idToken);
      const hhDoc = await firestoreRestGet(`households/${householdId}`, idToken);
      const memberValues: any[] = hhDoc?.fields?.members?.arrayValue?.values || [];
      const memberIds = memberValues.map((v: any) => v.stringValue).filter(Boolean);

      if (!memberIds.includes(caller.uid)) {
        return res.status(403).json({ error: "Only an existing household member can generate an invite code." });
      }

      const resolvedHouseholdName =
        householdName ||
        hhDoc?.fields?.name?.stringValue ||
        "Family Portfolio";
      const firestoreStoredCode = normalizeInviteCode(
        hhDoc?.fields?.settings?.mapValue?.fields?.inviteCode?.stringValue || ""
      );

      const db = getDB();
      if (!db.inviteCodes) db.inviteCodes = {};

      // Find existing code for this household, or use preferredCode / firestoreStoredCode, or generate a new 6-char code
      let code = "";
      const existingEntry = Object.values(db.inviteCodes).find((entry: any) => entry.householdId === householdId) as any;
      const requestedClean = normalizeInviteCode(preferredCode || firestoreStoredCode);

      if (requestedClean && requestedClean.length >= 4 && (!db.inviteCodes[requestedClean] || db.inviteCodes[requestedClean].householdId === householdId)) {
        code = requestedClean;
        if (existingEntry && existingEntry.code !== code) {
          delete db.inviteCodes[existingEntry.code];
        }
      } else if (existingEntry?.code) {
        code = existingEntry.code;
      } else {
        code = generateInviteCode(db.inviteCodes);
      }

      db.inviteCodes[code] = {
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

      const shareBaseUrl = (process.env.SHORT_URL || resolveRequestBaseUrl(req)).replace(/\/$/, "");
      const joinUrl = `${shareBaseUrl}/j/${code}`;

      let emailOutcome: any = null;
      if (toEmail && typeof toEmail === "string") {
        const cleanEmail = toEmail.trim().toLowerCase();
        if (cleanEmail) {
          const alreadyPending = db.invites.find(
            (i: any) => i.toEmail === cleanEmail && i.householdId === householdId && i.status === "pending"
          );
          if (!alreadyPending) {
            db.invites.push({
              id: Date.now().toString(),
              fromUserId: caller.uid,
              toEmail: cleanEmail,
              householdId,
              householdName: resolvedHouseholdName,
              inviteCode: code,
              status: "pending"
            });
          }

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

      saveDB(db);
      await upsertInviteCodePg(db.inviteCodes[code]);

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
      const status = e?.response?.status === 403 ? 403 : 500;
      console.error("[InviteCode] Error:", e?.response?.data || e.message);
      res.status(status).json({ error: e?.response?.data?.error?.message || e.message || "Failed to generate invite code" });
    }
  });

  // Short invite redirect link (e.g. https://uw.up.railway.app/j/K7M4P9 -> /?invite=K7M4P9)
  app.get("/j/:code", (req, res) => {
    const clean = normalizeInviteCode(req.params.code);
    return res.redirect(302, clean ? `/?invite=${encodeURIComponent(clean)}` : "/");
  });

  // Public preview of an invite code (returns household name & inviter display name only)
  app.get("/api/household/invite-info/:code", async (req, res) => {
    const code = normalizeInviteCode(req.params.code);
    if (!code) return res.status(400).json({ error: "Invite code is required" });
    const db = getDB();
    let entry = db.inviteCodes?.[code];
    if (!entry) {
      entry = await getInviteCodePg(code);
      if (entry) {
        db.inviteCodes[code] = entry;
      }
    }
    if (!entry) {
      return res.status(404).json({ error: "Invalid or expired invite code. Ask your family admin to open Invite and copy the latest code." });
    }
    res.json({
      valid: true,
      code: entry.code,
      householdId: entry.householdId,
      householdName: entry.householdName || "Family Portfolio",
      inviterName: entry.inviterName || "Family Member"
    });
  });

  // Redeem an Invite Code (or pending email invite) and add the authenticated user to the household
  app.post("/api/household/redeem-invite", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      const joinerIdToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
      const { code: rawCode, householdId: requestedHouseholdId } = req.body || {};

      if (!joinerIdToken) {
        return res.status(401).json({ error: "Please sign in first to join a family portfolio." });
      }

      const joiner = await verifyFirebaseIdToken(joinerIdToken);
      const db = getDB();
      const cleanCode = normalizeInviteCode(rawCode || "");

      let entry: any = null;
      if (cleanCode && db.inviteCodes?.[cleanCode]) {
        entry = db.inviteCodes[cleanCode];
      } else if (cleanCode) {
        entry = await getInviteCodePg(cleanCode);
        if (entry) db.inviteCodes[cleanCode] = entry;
      } else if (requestedHouseholdId) {
        entry = Object.values(db.inviteCodes || {}).find((e: any) => e.householdId === requestedHouseholdId);
        if (!entry) {
          entry = await getInviteByHouseholdPg(requestedHouseholdId);
          if (entry?.code) db.inviteCodes[entry.code] = entry;
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

      // Mark any matching local email invite accepted
      let dbChanged = false;
      (db.invites || []).forEach((inv: any) => {
        if (inv.householdId === entry.householdId && inv.toEmail === joiner.email && inv.status === "pending") {
          inv.status = "accepted";
          dbChanged = true;
        }
      });
      if (dbChanged || entry.lastTokenAt) {
        saveDB(db);
      }

      const resolvedHouseholdName = hhDoc?.fields?.name?.stringValue || entry.householdName || "Family Portfolio";
      await upsertInviteCodePg(entry);
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

  // Helper to verify caller belongs to a household via Firebase REST
  async function verifyCallerHouseholdAccess(req: express.Request, householdId: string) {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
    if (!idToken) {
      throw Object.assign(new Error("Missing authorization token"), { statusCode: 401 });
    }
    const caller = await verifyFirebaseIdToken(idToken);
    const hhDoc = await firestoreRestGet(`households/${householdId}`, idToken);
    const memberValues: any[] = hhDoc?.fields?.members?.arrayValue?.values || [];
    const memberIds = memberValues.map((v: any) => v.stringValue).filter(Boolean);
    if (!memberIds.includes(caller.uid)) {
      throw Object.assign(new Error("Forbidden: not a member of this household"), { statusCode: 403 });
    }
    return { caller, hhDoc };
  }

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

  const WEALTH_MILESTONES_INR = [
    25_00_000,
    50_00_000,
    1_00_00_000,
    1_50_00_000,
    2_00_00_000,
    2_50_00_000,
    5_00_00_000,
    10_00_00_000,
    25_00_00_000
  ];

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

      const existingHistory = await getWealthHistoryPg(householdId);
      const previousMax = existingHistory.reduce((m, s) => Math.max(m, s.totalINR), 0);

      const saved = await upsertWealthSnapshotPg({
        householdId,
        snapshotMonth: cleanMonth,
        recordedAt: Date.now(),
        totalINR: Number(totalINR) || 0,
        totalUSD: Number(totalUSD) || (Number(totalINR) / (Number(fxRate) || 84)),
        indianEquityINR: Number(indianEquityINR) || 0,
        foreignEquityINR: Number(foreignEquityINR) || 0,
        debtINR: Number(debtINR) || 0,
        fxRate: Number(fxRate) || 84,
        holdingsCount: Number(holdingsCount) || 0,
        memberBreakdown: Array.isArray(memberBreakdown) ? memberBreakdown : [],
        providerBreakdown: providerBreakdown && typeof providerBreakdown === "object" ? providerBreakdown : {},
        holdingsBreakdown: Array.isArray(holdingsBreakdown) ? holdingsBreakdown : [],
        rebalanceMeta: rebalanceMeta && typeof rebalanceMeta === "object" ? rebalanceMeta : {},
        source: String(source || "auto"),
        note: String(note || "")
      });

      // Check if a new net worth milestone was crossed!
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
      const rate = Number(fxRate) > 0 ? Number(fxRate) : 84;
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

  app.post("/api/household/invite", (req, res) => {
    const { fromUserId, toEmail, householdId } = req.body;
    const db = getDB();
    const inviteId = Date.now().toString();
    const fromUser = db.users[fromUserId];
    const household = db.households[householdId];

    db.invites.push({ 
      id: inviteId,
      fromUserId, 
      toEmail: toEmail.toLowerCase(), 
      householdId, 
      status: "pending" 
    });
    saveDB(db);

    logEmail(
      toEmail, 
      "UnityWealth Household Invitation", 
      `${fromUser?.name || 'A family member'} invited you to join their household '${household?.name}' on UnityWealth.`
    );

    res.json({ success: true });
  });

  app.get("/api/invites/:email", (req, res) => {
    const db = getDB();
    const email = req.params.email.toLowerCase();
    const invites = db.invites.filter((i: any) => i.toEmail === email && i.status === "pending");
    
    // Map with household name for UI context
    const enriched = invites.map((inv: any) => ({
      ...inv,
      householdName: db.households[inv.householdId]?.name || "Family Group"
    }));
    
    res.json(enriched);
  });

  app.post("/api/household/join", (req, res) => {
    const { userId, inviteId } = req.body;
    const db = getDB();
    const inviteIdx = db.invites.findIndex((i: any) => i.id === inviteId);
    if (inviteIdx === -1) return res.status(404).json({ error: "Invite not found" });
    
    const invite = db.invites[inviteIdx];
    db.households[invite.householdId].members.push(userId);
    db.users[userId].householdId = invite.householdId;
    db.invites[inviteIdx].status = "accepted";
    saveDB(db);
    res.json({ success: true, householdId: invite.householdId });
  });

  app.delete("/api/household/:householdId/members/:memberId", (req, res) => {
    const { householdId, memberId } = req.params;
    const db = getDB();
    const household = db.households[householdId];
    if (!household) return res.status(404).json({ error: "Household not found" });

    // Remove from household members
    household.members = household.members.filter((m: string) => m !== memberId);
    
    // Update user record
    if (db.users[memberId]) {
      db.users[memberId].householdId = null;
    }

    // Remove holdings associated with this user and household
    db.holdings = db.holdings.filter((h: any) => !(h.userId === memberId && h.householdId === householdId));

    saveDB(db);
    res.json({ success: true });
  });

  app.post("/api/household/add-member-manual", (req, res) => {
    const { householdId, name, email } = req.body;
    const db = getDB();
    const household = db.households[householdId];
    if (!household) return res.status(404).json({ error: "Household not found" });

    const id = "u_" + Math.random().toString(36).substr(2, 9);
    const newUser = { 
      id, 
      email: email.toLowerCase(), 
      password: "password", // default for manual members
      name, 
      householdId,
      isManual: true 
    };
    
    db.users[id] = newUser;
    household.members.push(id);
    saveDB(db);
    res.json(newUser);
  });

  let amfiCache: any[] = [];
  let lastAmfiFetch = 0;

  async function getAmfiData() {
    const now = Date.now();
    // Cache for 12 hours
    if (amfiCache.length > 0 && (now - lastAmfiFetch < 12 * 60 * 60 * 1000)) {
      return amfiCache;
    }

    try {
      console.log("Fetching AMFI data...");
      const response = await axios.get("https://www.amfiindia.com/spages/NAVAll.txt", {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const text = response.data;
      const lines = text.split(/\r?\n/);
      const results: any[] = [];

      lines.forEach((line: string) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.includes('Open Ended Schemes') || trimmed.includes('Close Ended Schemes')) return;

        const parts = trimmed.includes(';') ? trimmed.split(';') : trimmed.split('|');
        
        if (parts.length >= 4) {
          // Robust heuristic: NAV is typically a numeric value with decimal points, usually after scheme name
          let navIdx = -1;
          for (let i = parts.length - 1; i >= 2; i--) {
            const p = parts[i].trim();
            if (p && !isNaN(parseFloat(p)) && p.includes('.') && !p.includes('-')) {
               navIdx = i;
               break;
            }
          }

          if (navIdx !== -1) {
            // AMFI formats include 6-part (Code;ISIN1;ISIN2;Name;NAV;Date) and
            // 8-part (Code;ISIN1;ISIN2;SchemeName;Plan;Option;NAV;Date)
            const isins = parts
              .slice(1, navIdx)
              .map(s => s.trim().toUpperCase())
              .filter(s => /^INF[A-Z0-9]{9}$/.test(s));
            const nameParts = parts
              .slice(1, navIdx)
              .map(s => s.trim())
              .filter(s => s && s !== '-' && !/^INF[A-Z0-9]{9}$/i.test(s) && !/^[A-Z0-9]{12}$/.test(s));
            const fullName = nameParts.join(' - ');

            const price = parseFloat(parts[navIdx]);
            if (!isNaN(price) && fullName) {
              results.push({
                symbol: parts[0].trim(),
                shortname: fullName,
                isins,
                currentPrice: price,
                typeDisp: 'MUTUAL_FUND',
                exchDisp: 'AMFI',
                isIndia: true
              });
            }
          }
        }
      });

      console.log(`AMFI Parse complete. Found ${results.length} schemes.`);
      amfiCache = results;
      lastAmfiFetch = now;
      return results;
    } catch (e) {
      console.error("AMFI Fetch failed:", e);
      return amfiCache;
    }
  }

  const YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  const stockQuoteCache = new Map<string, { price: number; ts: number }>();
  const QUOTE_CACHE_TTL_MS = 60 * 1000;

  function toYahooSymbol(raw: string): string {
    let sym = raw.trim().toUpperCase();
    if (sym.includes(':')) {
      const [exch, ticker] = sym.split(':');
      if (exch === 'NSE') return `${ticker}.NS`;
      if (exch === 'BSE') return `${ticker}.BO`;
      return ticker;
    }
    if (sym.endsWith('.NSE')) return sym.replace(/\.NSE$/, '.NS');
    if (sym.endsWith('.BSE')) return sym.replace(/\.BSE$/, '.BO');
    if (sym.endsWith('.US')) return sym.replace(/\.US$/, '');
    if (sym === 'BTC' || sym === 'BITCOIN') return 'BTC-USD';
    if (sym === 'ETH' || sym === 'ETHEREUM') return 'ETH-USD';
    return sym;
  }

  async function fetchYahooChartPrice(yahooSym: string): Promise<number | null> {
    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    for (const host of hosts) {
      try {
        const res = await axios.get(
          `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`,
          { timeout: 6000, headers: YAHOO_HEADERS }
        );
        const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof price === 'number' && price > 0) {
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
    if (!price && yahooSym.endsWith('.NS')) {
      price = await fetchYahooChartPrice(yahooSym.replace(/\.NS$/, '.BO'));
    }
    return price;
  }

  function toTradingViewIndiaTicker(raw: string): { primary: string; fallback?: string } {
    let sym = raw.trim().toUpperCase();
    if (sym.includes(':')) {
      const [exch, ticker] = sym.split(':');
      if (exch === 'BSE') return { primary: `BSE:${ticker}`, fallback: `NSE:${ticker}` };
      return { primary: `NSE:${ticker}`, fallback: `BSE:${ticker}` };
    }
    if (sym.endsWith('.BO') || sym.endsWith('.BSE')) {
      const base = sym.replace(/\.(BO|BSE)$/, '');
      return { primary: `BSE:${base}`, fallback: `NSE:${base}` };
    }
    const base = sym.replace(/\.(NS|NSE)$/, '');
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
        'https://scanner.tradingview.com/india/scan',
        {
          symbols: { tickers: Array.from(tickerSet) },
          columns: ['close']
        },
        { timeout: 6000, headers: { 'Content-Type': 'application/json', 'User-Agent': YAHOO_HEADERS['User-Agent'] } }
      );
      const tvPrices = new Map<string, number>();
      for (const item of res.data?.data || []) {
        const price = item?.d?.[0];
        if (item?.s && typeof price === 'number' && price > 0) {
          tvPrices.set(String(item.s).toUpperCase(), price);
        }
      }
      for (const sym of symbols) {
        const mapped = mapBySymbol.get(sym)!;
        const p = tvPrices.get(mapped.primary) ?? (mapped.fallback ? tvPrices.get(mapped.fallback) : undefined);
        if (p) out[sym] = p;
      }
    } catch (e: any) {
      console.warn('[TradingView India] Quote batch failed:', e.message);
    }
    return out;
  }

  async function fetchTradingViewUSPrice(symbol: string): Promise<number | null> {
    const clean = symbol.trim().toUpperCase().replace(/\.US$/, '');
    try {
      const res = await axios.post(
        'https://scanner.tradingview.com/america/scan',
        {
          symbols: { tickers: [`NASDAQ:${clean}`, `NYSE:${clean}`, `AMEX:${clean}`] },
          columns: ['close']
        },
        { timeout: 5000, headers: { 'Content-Type': 'application/json', 'User-Agent': YAHOO_HEADERS['User-Agent'] } }
      );
      for (const item of res.data?.data || []) {
        const price = item?.d?.[0];
        if (typeof price === 'number' && price > 0) return price;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async function fetchLiveStockPrices(symbols: string[]) {
    if (symbols.length === 0) return {};

    const now = Date.now();
    const priceMap: Record<string, number> = {};
    const uncached: string[] = [];

    for (const sym of symbols) {
      const cached = stockQuoteCache.get(sym.toUpperCase());
      if (cached && now - cached.ts < QUOTE_CACHE_TTL_MS) {
        priceMap[sym] = cached.price;
      } else {
        uncached.push(sym);
      }
    }

    if (uncached.length > 0) {
      // Check shared PostgreSQL quote cache so hundreds of concurrent users reuse fresh quotes
      const pgQuotes = await getCachedQuotesPg(uncached, 3 * 60 * 1000);
      for (let i = uncached.length - 1; i >= 0; i--) {
        const sym = uncached[i];
        const hit = pgQuotes[sym.toUpperCase()];
        if (hit && hit.price > 0) {
          priceMap[sym] = hit.price;
          stockQuoteCache.set(sym.toUpperCase(), { price: hit.price, ts: hit.updatedAt });
          uncached.splice(i, 1);
        }
      }
    }

    if (uncached.length === 0) return priceMap;

    const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
    const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;

    const isIndiaSymbol = (s: string) => {
      const u = s.toUpperCase();
      return u.endsWith('.NS') || u.endsWith('.BO') || u.endsWith('.NSE') || u.endsWith('.BSE') || u.includes(':NSE') || u.includes(':BSE') || u.startsWith('NSE:') || u.startsWith('BSE:');
    };

    const indiaStocks = uncached.filter(isIndiaSymbol);
    const potentialUS = uncached.filter(s => !isIndiaSymbol(s));

    console.log(`[fetchLiveStockPrices] Symbols: ${uncached.join(', ')}. Finnhub: ${FINNHUB_KEY ? 'Present' : 'MISSING'}. TV-India: Active.`);

    // --- Task A: TradingView India batch quote for NSE/BSE (.NS / .BO), with Yahoo/AV fallback ---
    const indiaTask = (async () => {
      if (indiaStocks.length === 0) return;
      const tvResults = await fetchTradingViewIndiaPrices(indiaStocks);
      for (const [sym, price] of Object.entries(tvResults)) {
        priceMap[sym] = price;
        stockQuoteCache.set(sym.toUpperCase(), { price, ts: Date.now() });
      }

      const missingIndia = indiaStocks.filter(s => !priceMap[s]);
      await Promise.all(missingIndia.map(async (symbol) => {
        const yPrice = await fetchYahooPriceForSymbol(symbol);
        if (yPrice) {
          priceMap[symbol] = yPrice;
          stockQuoteCache.set(symbol.toUpperCase(), { price: yPrice, ts: Date.now() });
          return;
        }
        if (AV_KEY) {
          try {
            const avSym = toYahooSymbol(symbol).replace(/\.NS$/, '.BSE').replace(/\.BO$/, '.BSE');
            const res = await axios.get(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(avSym)}&apikey=${AV_KEY}`, { timeout: 6000 });
            const priceStr = res.data?.["Global Quote"]?.["05. price"];
            if (priceStr && parseFloat(priceStr) > 0) {
              const p = parseFloat(priceStr);
              priceMap[symbol] = p;
              stockQuoteCache.set(symbol.toUpperCase(), { price: p, ts: Date.now() });
            }
          } catch (e: any) {
            console.warn(`[AlphaVantage] Fallback failed for ${symbol}: ${e.message}`);
          }
        }
      }));
    })();

    // --- Task B: Finnhub primary for US Stocks & Crypto, with TradingView US + India fallback ---
    const usTask = (async () => {
      await Promise.all(potentialUS.map(async (symbol) => {
        if (FINNHUB_KEY) {
          try {
            let sym = symbol.toUpperCase().replace(/\.US$/, '');
            if (sym === 'BTC' || sym === 'BITCOIN') sym = 'BINANCE:BTCUSDT';
            else if (sym === 'ETH' || sym === 'ETHEREUM') sym = 'BINANCE:ETHUSDT';

            const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`, {
              timeout: 5000,
              headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (res.data?.c && res.data.c > 0) {
              priceMap[symbol] = res.data.c;
              stockQuoteCache.set(symbol.toUpperCase(), { price: res.data.c, ts: Date.now() });
              return;
            }
          } catch (e: any) {
            console.warn(`[Finnhub] Failed for ${symbol}: ${e.message}`);
          }
        }
        const tvUsPrice = await fetchTradingViewUSPrice(symbol);
        if (tvUsPrice) {
          priceMap[symbol] = tvUsPrice;
          stockQuoteCache.set(symbol.toUpperCase(), { price: tvUsPrice, ts: Date.now() });
          return;
        }
        const tvIn = await fetchTradingViewIndiaPrices([`${symbol}.NS`]);
        if (tvIn[`${symbol}.NS`]) {
          priceMap[symbol] = tvIn[`${symbol}.NS`];
          stockQuoteCache.set(symbol.toUpperCase(), { price: tvIn[`${symbol}.NS`], ts: Date.now() });
        }
      }));
    })();

    await Promise.all([indiaTask, usTask]);

    // Persist newly fetched quotes into shared PostgreSQL cache asynchronously
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

    console.log(`Live Stock Fetch: Found ${Object.keys(priceMap).length} of ${symbols.length} symbols.`);
    return priceMap;
  }

  // Live Global Market Benchmarks (Nifty 50, S&P 500, NASDAQ 100, Gold, USD/INR) cached for multi-user scale
  let benchmarkCache: { data: any[]; ts: number } | null = null;
  app.get("/api/market/benchmarks", async (req, res) => {
    const now = Date.now();
    if (benchmarkCache && now - benchmarkCache.ts < 90 * 1000) {
      return res.json({ benchmarks: benchmarkCache.data, cachedAt: benchmarkCache.ts });
    }

    try {
      const [tvIndia, tvGlobal, fxRes] = await Promise.all([
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
        axios.get("https://open.er-api.com/v6/latest/USD", { timeout: 5000 }).catch(() => ({ data: { rates: { INR: 84.0 } } }))
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
      const usdInr = Number(fxRes.data?.rates?.INR) || 84.0;

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
    } catch (e: any) {
      res.json({ benchmarks: benchmarkCache?.data || [], cachedAt: now });
    }
  });

  app.get("/api/mf/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const query = (q as string).toLowerCase().trim();
    const tokens = query.split(/\s+/).filter(Boolean);

    const data = await getAmfiData();
    const filtered = data
      .filter(item => {
        if (item.symbol && item.symbol.toLowerCase().includes(query)) return true;
        if (!item.shortname) return false;
        const nameLower = item.shortname.toLowerCase();
        return tokens.every(tok => nameLower.includes(tok));
      })
      .sort((a, b) => {
        const aDirectGrowth = a.shortname.includes('Direct') && a.shortname.includes('Growth') ? 0 : 1;
        const bDirectGrowth = b.shortname.includes('Direct') && b.shortname.includes('Growth') ? 0 : 1;
        return aDirectGrowth - bDirectGrowth;
      })
      .slice(0, 15);

    console.log(`MF Search for "${query}" found ${filtered.length} results.`);
    res.json(filtered);
  });

  app.get("/api/tickers/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    try {
      const results: any[] = [];
      const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
      const cleanIndiaQuery = String(q).trim().replace(/^(NSE|BSE):/i, '').replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();

      // Run TradingView India Search (NSE/BSE with live price included!) + Finnhub US Search in parallel
      const [indiaQuotes, finnhubQuotes] = await Promise.all([
        (async () => {
          if (!cleanIndiaQuery) return [];
          try {
            const tvRes = await axios.post(
              'https://scanner.tradingview.com/india/scan',
              {
                filter: [{ left: 'name,description', operation: 'match', right: cleanIndiaQuery }],
                options: { lang: 'en' },
                markets: ['india'],
                columns: ['name', 'description', 'close', 'currency', 'exchange', 'type'],
                sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
                range: [0, 8]
              },
              { timeout: 6000, headers: { 'Content-Type': 'application/json', 'User-Agent': YAHOO_HEADERS['User-Agent'] } }
            );
            return (tvRes.data?.data || []).map((item: any) => {
              const [ticker, desc, close, , exch, assetType] = item.d || [];
              const suffix = exch === 'BSE' ? '.BO' : '.NS';
              const sym = `${ticker}${suffix}`;
              const price = typeof close === 'number' && close > 0 ? close : 0;
              if (price > 0) {
                stockQuoteCache.set(sym.toUpperCase(), { price, ts: Date.now() });
              }
              return {
                symbol: sym,
                shortname: desc || ticker,
                exchDisp: exch || 'NSE',
                typeDisp: assetType === 'fund' ? 'ETF' : 'EQUITY',
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
          if (!FINNHUB_KEY) return [];
          try {
            const fRes = await axios.get(
              `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q as string)}&token=${FINNHUB_KEY}`,
              { timeout: 5000 }
            );
            return (fRes.data?.result || [])
              .filter((quote: any) => ['Common Stock', 'ETF', 'REIT', 'ADR'].includes(quote.type) && !quote.symbol.includes('.'))
              .slice(0, 8)
              .map((quote: any) => ({
                symbol: toYahooSymbol(quote.symbol),
                shortname: quote.description,
                exchDisp: 'US',
                typeDisp: quote.type,
                currentPrice: 0,
                isIndia: false
              }));
          } catch {
            console.warn("Finnhub search failed");
            return [];
          }
        })()
      ]);

      results.push(...indiaQuotes, ...finnhubQuotes);

      // De-duplicate by symbol
      const seen = new Set<string>();
      const uniqueResults = results.filter((item) => {
        const key = item.symbol.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 10);

      // Fetch prices for any search results that didn't already include a price (e.g. Finnhub US hits)
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
      // Check AMFI first in case symbol is an AMFI scheme code
      const mfData = await getAmfiData();
      const mf = mfData.find(m => m.symbol === symbol);
      if (mf) {
        return res.json({ symbol, price: mf.currentPrice, provider: 'AMFI' });
      }

      const priceMap = await fetchLiveStockPrices([symbol]);
      if (priceMap[symbol]) {
        res.json({ symbol, price: priceMap[symbol] });
      } else {
        res.status(404).json({ error: "Price not found" });
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  function findAmfiMatch(mfData: any[], holding: any) {
    const ticker = String(holding.ticker || '').trim();
    const orig = String(holding.originalName || '').trim();
    const explicitIsin = String(holding.isin || '').trim().toUpperCase();
    const embeddedIsinMatch = `${explicitIsin} ${orig} ${ticker}`.match(/\b(INF[A-Z0-9]{9})\b/i);
    if (embeddedIsinMatch) {
      const targetIsin = embeddedIsinMatch[1].toUpperCase();
      const byIsin = mfData.find(m => Array.isArray(m.isins) && m.isins.includes(targetIsin));
      if (byIsin) return byIsin;
    }

    const exact = mfData.find(m => m.symbol === ticker || (orig && m.shortname === orig) || (ticker && m.shortname === ticker));
    if (exact) return exact;

    const rawName = orig || ticker;
    const cleanedTarget = rawName
      .replace(/,?\s*ISIN\s*:.*$/i, '')
      .replace(/\(formerly[^)]*\)/gi, '')
      .replace(/\(erstwhile[^)]*\)/gi, '')
      .replace(/^[A-Z0-9]{3,10}\s*[-–—]\s*/i, '')
      .toLowerCase();
    const wantsDirect = /\bdirect\b/.test(cleanedTarget);
    const wantsIdcw = /\b(idcw|dividend|payout|reinvestment)\b/.test(cleanedTarget);
    const stopWords = new Set(['fund', 'scheme', 'plan', 'option', 'direct', 'regular', 'growth', 'idcw', 'dividend', 'payout', 'reinvestment', 'india', 'mutual', 'open', 'ended', 'equity', 'g', 'd']);
    const coreTokens = cleanedTarget
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !stopWords.has(t));

    if (coreTokens.length < 2) return null;

    const candidates = mfData.filter(m => {
      const mLower = String(m.shortname || '').toLowerCase();
      return coreTokens.every(tok => mLower.includes(tok));
    });
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aL = String(a.shortname || '').toLowerCase();
      const bL = String(b.shortname || '').toLowerCase();
      const aPlanScore = (wantsDirect ? aL.includes('direct') : !aL.includes('direct')) ? 0 : 1;
      const bPlanScore = (wantsDirect ? bL.includes('direct') : !bL.includes('direct')) ? 0 : 1;
      if (aPlanScore !== bPlanScore) return aPlanScore - bPlanScore;
      const aOptScore = (wantsIdcw ? (aL.includes('idcw') || aL.includes('dividend')) : aL.includes('growth')) ? 0 : 1;
      const bOptScore = (wantsIdcw ? (bL.includes('idcw') || bL.includes('dividend')) : bL.includes('growth')) ? 0 : 1;
      if (aOptScore !== bOptScore) return aOptScore - bOptScore;
      return aL.length - bL.length;
    });
    return candidates[0];
  }

  const assetHistoryCache = new Map<string, { ts: number; payload: any }>();
  const ASSET_HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

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

    const cached = assetHistoryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ASSET_HISTORY_TTL_MS) {
      return res.json(cached.payload);
    }

    const windowDays = rangeKey === "6M" ? 185 : rangeKey === "1Y" ? 366 : rangeKey === "3Y" ? 1096 : 1826;
    const minTsMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    try {
      // 1. Check if this is an Indian Mutual Fund (AMFI scheme code or ISIN/name match)
      let schemeCode = /^\d{5,6}$/.test(rawSymbol) ? rawSymbol : "";
      if (!schemeCode && (rawName || rawSymbol)) {
        const isExplicitStock = /\.(NS|BO|NSE|BSE|US)$/i.test(rawSymbol) || (/^[A-Z]{1,5}$/.test(rawSymbol) && !rawName.toLowerCase().includes("fund"));
        if (!isExplicitStock) {
          const mfData = await getAmfiData();
          const mf = findAmfiMatch(mfData, { ticker: rawSymbol, originalName: rawName });
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
            assetHistoryCache.set(cacheKey, { ts: Date.now(), payload });
            return res.json(payload);
          }
        } catch (mfErr: any) {
          console.warn(`[AssetHistory] MFAPI failed for ${schemeCode}:`, mfErr.message);
        }
      }

      // 2. Stock / ETF History via Yahoo Finance v8 chart (query1 + query2, plus .BO fallback for .NS)
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
              assetHistoryCache.set(cacheKey, { ts: Date.now(), payload });
              return res.json(payload);
            }
          } catch {
            // Try next host/candidate
          }
        }
      }

      // 3. Fallback: TradingView multi-horizon performance anchor points (always reliable on cloud IPs)
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
            assetHistoryCache.set(cacheKey, { ts: Date.now(), payload });
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

  app.post("/api/portfolio/refresh", async (req, res) => {
    const householdId = (req.query.householdId as string) || req.body?.householdId;
    const clientHoldings: any[] | undefined = Array.isArray(req.body?.holdings) ? req.body.holdings : undefined;

    try {
      let holdingsToRefresh: any[] = clientHoldings || [];

      if (holdingsToRefresh.length === 0 && householdId) {
        try {
          const snap = await firestore.collection('holdings').where('householdId', '==', householdId).get();
          holdingsToRefresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch {
          const db = getDB();
          holdingsToRefresh = db.holdings.filter((h: any) => h.householdId === householdId);
        }
      }

      const mfData = await getAmfiData();
      const updates: Record<string, { currentPrice: number; provider: string }> = {};
      const stockHoldings: any[] = [];

      for (const h of holdingsToRefresh) {
        const mf = findAmfiMatch(mfData, h);
        if (mf && mf.currentPrice > 0) {
          updates[h.id] = { currentPrice: mf.currentPrice, provider: 'AMFI' };
        } else if (h.ticker && h.ticker !== 'MANUAL') {
          stockHoldings.push(h);
        }
      }

      if (stockHoldings.length > 0) {
        const uniqueSymbols = Array.from(new Set(stockHoldings.map(h => String(h.ticker))));
        const stockPrices = await fetchLiveStockPrices(uniqueSymbols);
        for (const h of stockHoldings) {
          if (stockPrices[h.ticker]) {
            updates[h.id] = { currentPrice: stockPrices[h.ticker], provider: 'Market-Live' };
          }
        }
      }

      // Best-effort server-side persistence (Firestore if credentials exist, plus local db.json)
      if (Object.keys(updates).length > 0) {
        try {
          const batch = firestore.batch();
          const now = Date.now();
          for (const [id, u] of Object.entries(updates)) {
            batch.update(firestore.collection('holdings').doc(id), {
              currentPrice: u.currentPrice,
              priceUpdatedAt: now
            });
          }
          await batch.commit();
        } catch {
          // Client-side writeBatch in App.tsx handles Firestore updates when server lacks ADC
        }

        const db = getDB();
        let changed = false;
        for (const h of db.holdings) {
          if (updates[h.id]) {
            h.currentPrice = updates[h.id].currentPrice;
            h.provider = updates[h.id].provider;
            h.priceUpdatedAt = Date.now();
            changed = true;
          }
        }
        if (changed) saveDB(db);
      }

      res.json({ success: true, updates, count: Object.keys(updates).length });
    } catch (e: any) {
      console.error("Portfolio refresh error:", e);
      res.status(500).json({ error: e.message || "Failed to refresh portfolio" });
    }
  });

  app.delete("/api/portfolio/holding/:holdingId", async (req, res) => {
    const { holdingId } = req.params;
    try {
      await firestore.collection('holdings').doc(holdingId).delete();
    } catch {
      // Ignore if server lacks Firestore ADC; client deletes directly
    }
    const db = getDB();
    const initialCount = db.holdings.length;
    db.holdings = db.holdings.filter((h: any) => h.id !== holdingId);
    if (db.holdings.length < initialCount) {
      saveDB(db);
    }
    res.json({ success: true });
  });

  app.patch("/api/portfolio/holding/:holdingId", async (req, res) => {
    const { holdingId } = req.params;
    const { quantity, currentPrice } = req.body;
    const patchData: any = { priceUpdatedAt: Date.now() };
    if (quantity !== undefined) patchData.quantity = Number(quantity);
    if (currentPrice !== undefined) patchData.currentPrice = Number(currentPrice);

    try {
      await firestore.collection('holdings').doc(holdingId).update(patchData);
    } catch {
      // Ignore if server lacks Firestore ADC; client updates directly
    }

    const db = getDB();
    const holding = db.holdings.find((h: any) => h.id === holdingId);
    if (holding) {
      if (quantity !== undefined) holding.quantity = Number(quantity);
      if (currentPrice !== undefined) holding.currentPrice = Number(currentPrice);
      holding.priceUpdatedAt = patchData.priceUpdatedAt;
      saveDB(db);
      return res.json(holding);
    }
    res.json({ id: holdingId, ...patchData });
  });

  app.get("/api/portfolio/:householdId", async (req, res) => {
    const db = getDB();
    const household = db.households[req.params.householdId];
    if (!household) return res.status(404).json({ error: "Household not found" });

    // Get active members data
    const membersData = household.members.map((mId: string) => {
      const u = db.users[mId];
      if (!u) return null;
      const userHoldingsCount = db.holdings.filter((h: any) => h.userId === mId && h.householdId === req.params.householdId).length;
      return { 
        id: u.id, 
        name: u.name, 
        email: u.email,
        accounts: userHoldingsCount
      };
    }).filter(Boolean);

    const holdings = db.holdings.filter((h: any) => h.householdId === req.params.householdId);

    // Refresh prices for MFs and Stocks
    const mfData = await getAmfiData();
    
    // Identify symbols to refresh: 
    // 1. Not an Indian MF (which we handle separately)
    // 2. Has a non-placeholder ticker
    // 3. Or explicitly marked as Yahoo/Live
    const stockSymbols = holdings
      .filter((h: any) => h.ticker && h.ticker !== 'MANUAL')
      .filter((h: any) => {
        const isIndianMf = mfData.some(m => m.symbol === h.ticker || m.shortname === h.originalName);
        return !isIndianMf;
      })
      .map((h: any) => h.ticker);
    
    let refreshedStockPrices: Record<string, number> = {};
    if (stockSymbols.length > 0) {
      refreshedStockPrices = await fetchLiveStockPrices(
        Array.from(new Set(stockSymbols))
      );
    }

    let hasPersistedChanges = false;
    const updatedHoldings = holdings.map((h: any) => {
      // Priority 1: AMFI for Mutual Funds
      const mf = mfData.find(m => m.symbol === h.ticker || m.shortname === h.originalName);
      if (mf) {
        // Update in DB to prevent loss on next fail
        const dbH = db.holdings.find((dh: any) => dh.id === h.id);
        if (dbH) {
          if (dbH.currentPrice !== mf.currentPrice) {
            dbH.currentPrice = mf.currentPrice;
            dbH.provider = 'AMFI';
            hasPersistedChanges = true;
          }
          dbH.priceUpdatedAt = Date.now();
        }
        return { ...h, currentPrice: mf.currentPrice, provider: 'AMFI', priceUpdatedAt: Date.now() };
      }
      
      // Priority 2: Finnhub/Yahoo for Stocks & Gold
      if (refreshedStockPrices[h.ticker]) {
        const dbH = db.holdings.find((dh: any) => dh.id === h.id);
        const newPrice = refreshedStockPrices[h.ticker];
        if (dbH) {
          if (dbH.currentPrice !== newPrice) {
            dbH.currentPrice = newPrice;
            dbH.provider = 'Market-Live';
            hasPersistedChanges = true;
          }
          dbH.priceUpdatedAt = Date.now();
        }
        return { ...h, currentPrice: newPrice, provider: 'Market-Live', currency: h.currency || 'USD', priceUpdatedAt: Date.now() };
      }
      return h;
    });

    if (hasPersistedChanges) {
      saveDB(db);
    }

    res.json({ 
      household: { ...household, membersData }, 
      holdings: updatedHoldings
    });
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
    return parseFirestoreValue({ mapValue: { fields: doc.fields } });
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

  async function resolveHouseholdMemberToken(householdId: string, bearerIdToken?: string): Promise<string | null> {
    if (bearerIdToken) return bearerIdToken;
    const db = getDB();
    let entry: any = Object.values(db.inviteCodes || {}).find((e: any) => e.householdId === householdId);
    if (!entry) {
      entry = await getInviteByHouseholdPg(householdId);
    }
    if (entry?.refreshToken) {
      try {
        const fresh = await refreshFirebaseIdToken(entry.refreshToken);
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

  function classifyAssetClassServer(h: any): "Equity" | "Debt" | "Gold" {
    const label = `${h.name || ""} ${h.originalName || ""} ${h.ticker || ""}`.toLowerCase();
    if (h.assetClass === "Gold" || /\b(gold|sgb|silver)\b/.test(label)) return "Gold";
    if (
      h.assetClass === "Debt" ||
      /\b(arbitrage|liquid|overnight|money market|gilt|corporate bond|short duration|ultra short|debt|fixed deposit|treasury)\b/.test(label)
    ) {
      return "Debt";
    }
    return "Equity";
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

      // Fast path when client passes exact live computed report from RebalanceView
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

      let fxRate = 84.0;
      try {
        const fxRes = await axios.get("https://open.er-api.com/v6/latest/USD", { timeout: 6000 });
        fxRate = fxRes.data?.rates?.INR || 84.0;
      } catch {}

      let totalValINR = 0;
      let equityValINR = 0;
      let debtValINR = 0;
      let indianEqINR = 0;
      let foreignEqINR = 0;

      holdings.forEach((h: any) => {
        const qty = Number(h.quantity) || 0;
        const price = Number(h.currentPrice) || 0;
        const val = qty * price;
        const isUsd = String(h.currency || "INR").toUpperCase() === "USD";
        const valINR = isUsd ? val * fxRate : val;
        totalValINR += valINR;
        const cls = classifyAssetClassServer(h);
        if (cls === "Debt") {
          debtValINR += valINR;
        } else {
          equityValINR += valINR;
          if (isUsd) foreignEqINR += valINR;
          else indianEqINR += valINR;
        }
      });

      if (totalValINR <= 0) {
        return { sent: false, error: "Total portfolio value is zero." };
      }

      const actualEquityPct = equityValINR / totalValINR;
      const targetEquityPct = Number(household.targets?.assetSplit?.Equity ?? 0.7);
      const targetDebtPct = Number(household.targets?.assetSplit?.Debt ?? (1 - targetEquityPct));
      const targetIndianSplit = Number(household.targets?.equitySplit?.Indian ?? 0.6);
      const targetForeignSplit = Number(household.targets?.equitySplit?.Foreign ?? 0.4);
      const drift = Math.abs(actualEquityPct - targetEquityPct);
      const accuracy = Math.max(0, 100 - drift * 100);
      const threshold = Number(household.settings?.accuracyThreshold ?? 95);

      if (accuracy >= threshold && !force) {
        return { sent: false, skipped: true, accuracy, reason: "Portfolio is already within target threshold" };
      }

      const lastSentKey = `rebalance_last_sent:${householdId}`;
      const lastSent = (await getAppStateKeyPg<number>(lastSentKey)) || Number(household.settings?.lastAlertSent || 0);
      const now = Date.now();
      if (!force && lastSent && now - lastSent < 24 * 60 * 60 * 1000) {
        return { sent: false, skipped: true, reason: "Alert already sent within the last 24 hours" };
      }

      // Resolve recipient email
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
          try {
            const uDoc = parseFirestoreDoc(await firestoreRestGet(`users/${mId}`, idToken));
            if (uDoc?.email && uDoc.email.includes("@")) {
              recipientEmail = uDoc.email;
              recipientName = uDoc.name || "Investor";
              break;
            }
          } catch {}
        }
      }

      if (!recipientEmail) {
        return { sent: false, error: "Could not find a recipient email address for this household." };
      }

      const fmtINR = (v: number) => `Rs. ${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
      const fmtUSD = (v: number) => `$${Math.round(Math.abs(v / fxRate)).toLocaleString("en-US")}`;
      const mode = opts?.mode === "sip" ? "sip" : "full";
      const orders: { type: string; title: string; category: string; amount: string; description: string }[] = [];

      if (mode === "sip") {
        const sipInflow = Math.max(1000, Number(opts?.freshInflowINR) || 100_000);
        const newTotal = totalValINR + sipInflow;
        const gapInd = Math.max(0, newTotal * targetEquityPct * targetIndianSplit - indianEqINR);
        const gapUs = Math.max(0, newTotal * targetEquityPct * targetForeignSplit - foreignEqINR);
        const gapDebt = Math.max(0, newTotal * targetDebtPct - debtValINR);
        const gapSum = gapInd + gapUs + gapDebt || 1;
        if (gapInd > 0) {
          const alloc = (sipInflow * gapInd) / gapSum;
          orders.push({ type: "buy", title: "Indian Equity SIP", category: "Zero-Sell Inflow", amount: fmtINR(alloc), description: "Route fresh monthly capital into Indian Equity" });
        }
        if (gapUs > 0) {
          const alloc = (sipInflow * gapUs) / gapSum;
          orders.push({ type: "buy", title: "US / Foreign Equity SIP", category: "Zero-Sell Inflow", amount: `${fmtUSD(alloc)} (${fmtINR(alloc)})`, description: "Route fresh monthly capital into US Equity" });
        }
        if (gapDebt > 0) {
          const alloc = (sipInflow * gapDebt) / gapSum;
          orders.push({ type: "buy", title: "Arbitrage / Debt Fund SIP", category: "Zero-Sell Inflow", amount: fmtINR(alloc), description: "Park fresh inflow in tax-efficient Arbitrage/Debt" });
        }
      } else {
        const targetIndINR = totalValINR * targetEquityPct * targetIndianSplit;
        const targetUsINR = totalValINR * targetEquityPct * targetForeignSplit;
        const targetDebtINR = totalValINR * targetDebtPct;
        const diffInd = targetIndINR - indianEqINR;
        const diffUs = targetUsINR - foreignEqINR;
        const diffDebt = targetDebtINR - debtValINR;
        if (Math.abs(diffInd) > 2500) {
          orders.push({
            type: diffInd > 0 ? "buy" : "sell",
            title: "Indian Equity / Mutual Funds",
            category: "Domestic Equity",
            amount: fmtINR(diffInd),
            description: diffInd > 0 ? "Underweight vs target Indian Equity split" : "Trim overweight Indian Equity"
          });
        }
        if (Math.abs(diffUs) > 2500) {
          orders.push({
            type: diffUs > 0 ? "buy" : "sell",
            title: "US / Global Equity Sleeve",
            category: "Foreign Equity",
            amount: `${fmtUSD(diffUs)} (${fmtINR(diffUs)})`,
            description: diffUs > 0 ? "Add to US Equity sleeve" : "Trim overweight US Equity sleeve"
          });
        }
        if (Math.abs(diffDebt) > 2500) {
          orders.push({
            type: diffDebt > 0 ? "buy" : "sell",
            title: "Arbitrage / Fixed Income Reserve",
            category: "Debt & Arbitrage",
            amount: fmtINR(diffDebt),
            description: diffDebt > 0 ? "Add stability via Arbitrage/Liquid funds" : "Redeploy surplus Debt into Equity"
          });
        }
      }

      const indianEqShare = equityValINR > 0 ? indianEqINR / equityValINR : 0;
      const foreignEqShare = equityValINR > 0 ? foreignEqINR / equityValINR : 0;
      const executiveSummary =
        accuracy >= threshold
          ? `${household.name || "Your family portfolio"} is well aligned at ${accuracy.toFixed(1)}% against your ${(targetEquityPct * 100).toFixed(0)}/${(targetDebtPct * 100).toFixed(0)} Equity/Debt target.`
          : `${household.name || "Your family portfolio"} is currently at ${(actualEquityPct * 100).toFixed(1)}% Equity vs your ${(targetEquityPct * 100).toFixed(0)}% target (${accuracy.toFixed(1)}% alignment vs ${threshold}% threshold). Review the recommended ${mode === "sip" ? "Zero-Sell SIP routing" : "rebalance trades"} below.`;

      const content = buildRebalanceEmailContent({
        householdName: household.name || "Family Portfolio",
        recipientName: recipientName || "Investor",
        totalValINR,
        totalValUSD: totalValINR / fxRate,
        accuracy,
        threshold,
        actualEquityPct,
        targetEquityPct,
        indianEquityPctOfEq: indianEqShare,
        foreignEquityPctOfEq: foreignEqShare,
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
          severity: accuracy < threshold ? "warning" : "info",
          title: mode === "sip" ? "Zero-Sell SIP Plan Emailed" : "Rebalance Alert Emailed",
          message: `Delivered ${mode === "sip" ? "Zero-Sell SIP plan" : "rebalance report"} (${accuracy.toFixed(1)}% aligned) to ${recipientEmail}.`,
          actionTab: "rebalance",
          createdAt: now
        }).catch(() => {});
      }

      return {
        ...delivery,
        recipientEmail,
        accuracy
      };
    } catch (e: any) {
      console.error("[Rebalance Email Error]", e?.response?.data || e.message);
      return {
        sent: false,
        error: e?.response?.data?.error?.message || e.message || "Rebalance email check failed"
      };
    }
  }

  app.post("/api/settings/notifications", (req, res) => {
    const { householdId, enabled, threshold } = req.body;
    const db = getDB();
    if (!db.households[householdId]) {
      db.households[householdId] = { id: householdId, settings: {} };
    }
    if (!db.households[householdId].settings) db.households[householdId].settings = {};
    db.households[householdId].settings.emailAlertsEnabled = enabled;
    db.households[householdId].settings.accuracyThreshold = threshold;
    
    saveDB(db);
    res.json({ success: true });
  });

  app.post("/api/rebalance/check-now", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
    const { householdId, toEmail, recipientName, mode, freshInflowINR } = req.body || {};
    const host = req.get("host");
    const proto = req.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
    const baseUrl = (process.env.APP_URL || `${proto}://${host}`).replace(/\/$/, "");

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
        : (outcome?.error || "Email was not sent automatically."),
      ...outcome
    });
  });

  app.post("/api/rebalance/send-email", async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.body?.idToken || "");
    const { householdId, toEmail, recipientName, mode, freshInflowINR, clientReport } = req.body || {};
    const host = req.get("host");
    const proto = req.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
    const baseUrl = (process.env.APP_URL || `${proto}://${host}`).replace(/\/$/, "");

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
        : (outcome?.error || "Outgoing email sender not connected yet."),
      ...outcome
    });
  });

  app.post("/api/targets/:householdId", (req, res) => {
    const db = getDB();
    if (!db.households[req.params.householdId]) return res.status(404).json({ error: "Household not found" });
    
    db.households[req.params.householdId].targets = req.body;
    saveDB(db);
    checkAndSendRebalanceAlert(req.params.householdId).catch(() => {}); // Trigger check on target update
    res.json(db.households[req.params.householdId]);
  });

  app.post("/api/portfolio/bulk-add", async (req, res) => {
    const { userId, householdId, holdings, provider: batchProvider } = req.body;
    
    try {
      const incomingProviders = new Set<string>(
        (holdings || []).map((h: any) => String(h.provider || batchProvider || "CAMS"))
      );
      if (incomingProviders.size === 0 && batchProvider) {
        incomingProviders.add(String(batchProvider));
      }

      const newHoldings = (holdings || []).map((h: any) => {
        const id = "h_" + Math.random().toString(36).substr(2, 9);
        const resolvedProvider = String(h.provider || batchProvider || "CAMS");
        const resolvedCurrency = h.currency === "USD" ? "USD" : "INR";
        return {
          id,
          userId,
          householdId,
          ticker: String(h.ticker || h.schemeName || "MF").slice(0, 50),
          quantity: parseFloat(h.units) || 0,
          assetClass: h.assetClass || "Mutual Fund",
          currency: resolvedCurrency,
          provider: resolvedProvider,
          source: "PDF",
          currentPrice: parseFloat(h.nav) || 0,
          originalName: h.originalName || h.schemeName || "",
          syncedAt: Date.now()
        };
      });

      // Persist to Firestore if server has ADC, while client handles direct Firestore writes when logged in
      try {
        const holdingsRef = firestore.collection('holdings');
        const snap = await holdingsRef
          .where('userId', '==', userId)
          .where('householdId', '==', householdId)
          .get();
        
        const batch = firestore.batch();
        snap.docs.forEach(doc => {
          const data = doc.data();
          const docProvider = String(data.provider || "CAMS");
          if (data.source === "PDF" && incomingProviders.has(docProvider)) {
            batch.delete(doc.ref);
          }
        });
        newHoldings.forEach((item: any) => {
          const { id, ...rest } = item;
          batch.set(holdingsRef.doc(id), rest);
        });
        await batch.commit();
      } catch {
        // Fallback to local db.json when server runs without Firestore service account
      }

      const db = getDB();
      db.holdings = db.holdings.filter((h: any) => {
        if (h.userId !== userId || h.householdId !== householdId) return true;
        const docProvider = String(h.provider || "CAMS");
        return !(h.source === "PDF" && incomingProviders.has(docProvider));
      });
      db.holdings.push(...newHoldings);
      saveDB(db);

      checkAndSendRebalanceAlert(householdId); 
      res.json({ success: true, count: newHoldings.length, holdings: newHoldings });
    } catch (e: any) {
      console.error("Bulk-add error", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/portfolio/add-manual", async (req, res) => {
    const { userId, householdId, ticker, quantity, currentPrice, assetClass, currency, provider, originalName, source } = req.body;
    
    try {
      let resolvedCurrency = currency || "USD";
      const upperTicker = (ticker || "").toUpperCase();
      if (upperTicker.endsWith('.NS') || upperTicker.endsWith('.BO')) {
        resolvedCurrency = "INR";
      }

      const id = "h_" + Math.random().toString(36).substr(2, 9);
      const newHolding = {
        userId,
        householdId,
        ticker: upperTicker,
        originalName: originalName || upperTicker,
        quantity: parseFloat(quantity),
        assetClass: assetClass || "Equity",
        currency: resolvedCurrency,
        provider: provider || "Manual",
        source: source || "Manual",
        currentPrice: parseFloat(currentPrice),
        syncedAt: Date.now()
      };

      try {
        await firestore.collection('holdings').doc(id).set(newHolding);
      } catch {
        // Client handles Firestore directly when authenticated
      }
      const db = getDB();
      db.holdings.push({ id, ...newHolding });
      saveDB(db);
      checkAndSendRebalanceAlert(householdId);
      res.json({ id, ...newHolding });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/fx-rates", async (req, res) => {
    try {
      // Using a public API for USD to INR
      const response = await axios.get('https://open.er-api.com/v6/latest/USD');
      const data = response.data;
      const inrRate = data.rates?.INR || 83.5;
      res.json({ INR: inrRate, USD: 1.0 });
    } catch (error) {
      console.error("FX Fetch Error:", error);
      res.json({ INR: 83.5, USD: 1.0 }); // Fallback
    }
  });

  app.get("/api/market/price/:ticker", async (req, res) => {
    const ticker = req.params.ticker.toUpperCase();
    try {
      const priceMap = await fetchLiveStockPrices([ticker]);
      if (priceMap[ticker]) {
        return res.json({ ticker, price: priceMap[ticker] });
      }
      res.status(404).json({ error: "Price not found" });
    } catch (e) {
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

    // Detect password-encrypted Office Open XML (.xlsx) wrapped in an OLE Compound File container
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

    // Pre-check if PDF is password-encrypted
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
  "statementType": "holdings" | "capital_gains_only" | "transactions_only",
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
      "currency": "INR" | "USD"
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
  - Extract portfolio positions and VESTED/sellable RSU or ESPP shares (ignore unvested future grant schedules, "CASH", and "TOTAL" rows).
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

      const rawList: any[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.holdings) ? parsed.holdings : []);
      const statementType: string = Array.isArray(parsed) ? "holdings" : (parsed?.statementType || "holdings");
      const detectedProvider: string = providerHint || (!Array.isArray(parsed) && parsed?.provider) || "CAMS";
      const summaryNote: string = (!Array.isArray(parsed) && parsed?.summaryNote) || "";

      if (statementType === "capital_gains_only" && rawList.length === 0) {
        return res.json({
          statementType: "capital_gains_only",
          provider: detectedProvider,
          summaryNote,
          warning: "This file is a Capital Gain / Loss (Redemption) tax statement showing sold units rather than active holdings. Please upload a CAMS / MFCentral Consolidated Account Statement (CAS) or Portfolio Holdings statement with current balances.",
          holdings: []
        });
      }

      // Normalize, enforce mandatory domain rules, and consolidate duplicate lots within the same statement
      const debtKeywords = /\b(arbitrage|liquid|liquidbees|liquidcase|overnight|money market|ultra short|low duration|short term debt|short duration|corporate bond|gilt|banking and psu|banking & psu|dynamic bond|floater|swvxx|snvxx|vmfxx|spaxx|sgov|usfr)\b/i;
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

        let assetClass: "Equity" | "Debt" | "Mutual Fund" =
          item.assetClass === "Debt" ? "Debt" :
          item.assetClass === "Equity" ? "Equity" : "Mutual Fund";

        if (debtKeywords.test(origName) || debtKeywords.test(schemeName) || debtKeywords.test(rawTicker)) {
          assetClass = "Debt";
        } else if (currency === "USD" && assetClass === "Mutual Fund") {
          assetClass = "Equity";
        }

        // Clean stock tickers
        if (assetClass === "Equity" || (currency === "USD" && /^[A-Z./-]{1,10}$/i.test(rawTicker))) {
          rawTicker = rawTicker.toUpperCase().replace(/\//g, ".");
          if (currency === "INR" && rowProvider === "Zerodha" && /^[A-Z0-9&-]{1,15}$/.test(rawTicker) && !rawTicker.endsWith(".NS") && !rawTicker.endsWith(".BO")) {
            rawTicker = `${rawTicker}.NS`;
          }
          if (currency === "USD") {
            rawTicker = rawTicker.replace(/\.US$/, "");
          }
        }

        const isinMatch = `${item.isin || ""} ${origName}`.match(/\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/i);
        const isin = isinMatch ? isinMatch[1].toUpperCase() : "";
        const dedupKey = `${rowProvider}|${currency}|${isin || rawTicker.toUpperCase()}|${assetClass}`;

        if (consolidatedMap.has(dedupKey)) {
          const prev = consolidatedMap.get(dedupKey)!;
          prev.units = Number((prev.units + units).toFixed(6));
          if (!prev.nav && nav > 0) prev.nav = nav;
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
            provider: rowProvider
          });
        }
      }

      const enrichedHoldings = Array.from(consolidatedMap.values());

      // Enrich Indian MFs with exact AMFI scheme code & latest live NAV, and stocks with live quotes
      const mfData = await getAmfiData();
      const stockSymbolsToFetch = new Set<string>();

      for (const h of enrichedHoldings) {
        if (h.currency === "INR" && (h.assetClass === "Mutual Fund" || h.assetClass === "Debt" || /^INF[A-Z0-9]{9}$/.test(h.isin))) {
          const mf = findAmfiMatch(mfData, h);
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

      res.json({
        statementType,
        provider: detectedProvider,
        statementMonth,
        summaryNote,
        holdings: enrichedHoldings
      });
    } catch (e: any) {
      console.error("Gemini Extraction Error:", e);
      if (looksEncryptedPdf) {
        return res.status(400).json({
          error: "This PDF is password-protected (encrypted). Please unlock or 'Print to PDF' first (CAMS/CAS password is usually PAN or DDMMYYYY) and upload again."
        });
      }
      const errStatus = Number(e?.statusCode) || 500;
      res.status(errStatus).json({ error: errStatus === 400 ? e.message : "Failed to extract data: " + e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Unhandled Error]", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Pre-warm AMFI NAV cache in background
    getAmfiData().catch((err) => console.warn("[AMFI] Background warmup failed:", err.message));
    
    // Background Monitoring: Check all households every 4 hours
    setInterval(() => {
      console.log("[MONITOR] Running background rebalance check for all households...");
      const db = getDB();
      const allHouseholdIds = new Set<string>([
        ...Object.keys(db.households || {}),
        ...Object.values(db.inviteCodes || {}).map((e: any) => e?.householdId).filter(Boolean)
      ]);
      allHouseholdIds.forEach(householdId => {
        checkAndSendRebalanceAlert(householdId, false).catch(err => console.error("Monitor failed for", householdId, err));
      });
    }, 4 * 60 * 60 * 1000);
  });
}

startServer();
