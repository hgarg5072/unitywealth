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
import https from "https";
import crypto from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

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
      invites: []
    }, null, 2));
  }

  function getDB() {
    try {
      const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      if (!db.invites) db.invites = [];
      return db;
    } catch (e) {
      console.error("DB Read failed, returning empty state to prevent crash");
      return { users: {}, households: {}, holdings: [], invites: [] };
    }
  }

  function saveDB(data: any) {
    // Atomic write to prevent corruption
    const tempPath = DB_PATH + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, DB_PATH);

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
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      resend: !!process.env.RESEND_API_KEY,
      google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      appUrl: process.env.APP_URL
    });
  });

  function getRedirectUri(req: express.Request) {
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
    
    // Explicitly construct the URI from headers to match what Google sees
    const detectedUri = `${protocol}://${host}/auth/callback`;
    
    console.log(`[Google OAuth Debug] Host: ${host}, Proto: ${protocol}, Detected: ${detectedUri}`);

    if (process.env.APP_URL) {
      const appUrl = process.env.APP_URL.replace(/\/$/, "");
      if (host?.includes('localhost') && appUrl.includes('.run.app')) {
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
    console.log(`[Google OAuth] Generating Auth URL`);
    console.log(`[Google OAuth] Redirect URI: ${redirectUri}`);
    console.log(`[Google OAuth] HINT: Ensure this exact URI is added to "Authorized redirect URIs" in Google Cloud Console.`);
    
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.readonly'
      ]
    });
    res.json({ url });
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const { code } = req.query;
    if (typeof code !== 'string') return res.status(400).send("No code provided");

    const client = getGoogleClient(req);

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

      if (!user) {
        // Sign up new user
        const id = "u_" + Math.random().toString(36).substr(2, 9);
        user = { 
          id, 
          email, 
          name, 
          googleId,
          googleTokens: tokens,
          householdId: null,
          provider: 'google'
        };
        db.users[id] = user;
        saveDB(db);
        console.log(`[Google OAuth] Created new user: ${email}`);
      } else {
        // Log in existing user and update tokens
        user.googleTokens = tokens;
        user.googleId = googleId;
        saveDB(db);
        console.log(`[Google OAuth] Logged in existing user: ${email}`);
      }
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS',
                  user: ${JSON.stringify(user)}
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. You can close this window.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Google Auth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.post("/api/auth/google/save-tokens", (req, res) => {
    const { userId, tokens } = req.body;
    const db = getDB();
    if (db.users[userId]) {
      db.users[userId].googleTokens = tokens;
      saveDB(db);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
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
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    
    await logEmail(email, "UnityWealth Test Connectivity", "This is a test email to verify your Resend configuration. If you received this, your email gateway is working correctly!");
    res.json({ success: true, message: "Test email sent" });
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

    console.log(`Live Stock Fetch: Found ${Object.keys(priceMap).length} of ${symbols.length} symbols.`);
    return priceMap;
  }

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

  // Rebalance Check Logic
  async function checkAndSendRebalanceAlert(householdId: string, force: boolean = false) {
    try {
      const hhSnap = await firestore.collection('households').doc(householdId).get();
      if (!hhSnap.exists) return;
      const household = hhSnap.data() as any;

      if (household.settings?.emailAlertsEnabled === false && !force) return;

      const holdingsSnap = await firestore.collection('holdings').where('householdId', '==', householdId).get();
      const holdings = holdingsSnap.docs.map(d => d.data());
      if (holdings.length === 0) return;

      let fxRate = 83.5;
      try {
        const fxRes = await axios.get('https://open.er-api.com/v6/latest/USD');
        fxRate = fxRes.data.rates?.INR || 83.5;
      } catch(e) {}

      let totalValINR = 0;
      let equityValINR = 0;
      holdings.forEach((h: any) => {
        const val = h.quantity * h.currentPrice;
        const valINR = h.currency === 'USD' ? val * fxRate : val;
        totalValINR += valINR;
        if (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') {
          equityValINR += valINR;
        }
      });

      if (totalValINR === 0) return;

      const actualEquityPct = equityValINR / totalValINR;
      const targetEquityPct = household.targets.assetSplit.Equity || 0.7;
      const drift = Math.abs(actualEquityPct - targetEquityPct);
      const accuracy = 100 - (drift * 100);
      const threshold = household.settings?.accuracyThreshold || 95;

      if (accuracy < threshold || force) {
        const lastSent = household.settings?.lastAlertSent;
        const now = Date.now();
        if (!force && lastSent && (now - lastSent < 24 * 60 * 60 * 1000)) return;

        const members = household.members || [];
        if (members.length === 0) return;
        const adminUserSnap = await firestore.collection('users').doc(members[0]).get();
        if (!adminUserSnap.exists) return;
        const adminUser = adminUserSnap.data() as any;

        const summary = `Hi ${adminUser.name},

Your portfolio allocation at UnityWealth requires attention. Accuracy: ${accuracy.toFixed(1)}% (Threshold: ${threshold}%)

Current Allocation:
- Equity: ${(actualEquityPct * 100).toFixed(1)}%
- Debt: ${((1 - actualEquityPct) * 100).toFixed(1)}%

Best regards,
UnityWealth Team`;

        await logEmail(adminUser.email, "[UnityWealth] Rebalance Alert", summary);
        await hhSnap.ref.update({ 'settings.lastAlertSent': now });
      }
    } catch (e) {
      console.error("Alert task error:", e);
    }
  }

  app.post("/api/settings/notifications", (req, res) => {
    const { householdId, enabled, threshold } = req.body;
    const db = getDB();
    if (!db.households[householdId]) return res.status(404).json({ error: "Household not found" });
    
    if (!db.households[householdId].settings) db.households[householdId].settings = {};
    db.households[householdId].settings.emailAlertsEnabled = enabled;
    db.households[householdId].settings.accuracyThreshold = threshold;
    
    saveDB(db);
    res.json({ success: true });
  });

  app.post("/api/rebalance/check-now", async (req, res) => {
    const { householdId } = req.body;
    await checkAndSendRebalanceAlert(householdId, true);
    res.json({ success: true, message: "Check initiated. If accuracy is below threshold, an email will be sent or logged." });
  });

  app.post("/api/targets/:householdId", (req, res) => {
    const db = getDB();
    if (!db.households[req.params.householdId]) return res.status(404).json({ error: "Household not found" });
    
    db.households[req.params.householdId].targets = req.body;
    saveDB(db);
    checkAndSendRebalanceAlert(req.params.householdId); // Trigger check on target update
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

  app.post("/api/gemini/extract", async (req, res) => {
    const { content, isPDF, fileName, providerHint } = req.body;
    if (!content) {
      return res.status(400).json({ error: "No file content received." });
    }

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
      const hintLine = providerHint ? `\nUser selected account/broker hint: "${providerHint}".` : "";
      const fileLine = fileName ? `\nUploaded filename: "${fileName}".` : "";

      const extractionInstructions = `You are a precision financial statement parser supporting Indian and US brokerages:
- CAMS / KFintech / MFCentral Consolidated Account Statement (CAS) PDFs
- Zerodha Console / Kite / Coin Holdings CSVs & PDFs
- INDmoney US Stocks (DriveWealth/Alpaca) & Indian Portfolio PDFs/CSVs
- Charles Schwab Positions CSVs & Brokerage Statement PDFs
- Interactive Brokers (IBKR) Activity Statement / Open Positions CSVs & PDFs
- E*TRADE (Morgan Stanley) Portfolio Download CSVs & RSU/ESPP/Brokerage PDFs${hintLine}${fileLine}

Return ONLY a valid JSON object matching this exact structure:
{
  "statementType": "holdings" | "capital_gains_only" | "transactions_only",
  "provider": "CAMS" | "KFintech" | "Zerodha" | "INDmoney" | "Charles Schwab" | "IBKR" | "E*TRADE" | "Statement",
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

CRITICAL STATEMENT TYPE RULES (DO NOT VIOLATE):
1. Check the document title and table columns FIRST.
2. If the file is a "Capital Gain / Loss Statement", "Tax P&L", "Realized Gain/Loss", or "Redemption Statement" that ONLY lists sold/redeemed/switched-out tax lots WITHOUT current open/closing unit balances (for example, CAMS Capital Gain / Loss Statement with Redemption rows, Purchase Date, Indexed Cost, Short Term / Long Term gain), you MUST set:
   "statementType": "capital_gains_only",
   "holdings": []
   NEVER treat redeemed/sold units as active portfolio holdings!
3. If the file has BOTH historical transactions AND a "Closing Unit Balance" / "Open Positions" / "Ending Balance" column or summary (e.g. Detailed CAMS CAS or IBKR Activity Statement), set "statementType": "holdings" and extract ONLY the current open/closing balance for each asset where units > 0. Ignore zero-balance folios and closed positions.

BROKER, TICKER & CURRENCY RULES:
- CAMS / KFintech / MFCentral CAS:
  - provider: "CAMS" (or "KFintech" if exclusively KFintech).
  - currency: "INR".
  - Extract the 12-char "INF..." ISIN into "isin" whenever shown!
  - assetClass: MUST be "Debt" if scheme name contains "Arbitrage", "Liquid", "Money Market", "Overnight", "Ultra Short", "Low Duration", "Short Term", "Short Duration", "Corporate Bond", "Gilt", "Banking and PSU", "Banking & PSU", "Dynamic Bond", "Floater", or "Debt"; otherwise "Mutual Fund".
- Zerodha:
  - provider: "Zerodha", currency: "INR".
  - For Indian NSE/BSE stocks & ETFs (e.g. RELIANCE, INFY, TCS, HDFCBANK, NIFTYBEES, GOLDBEES), append ".NS" to ticker (e.g. "RELIANCE.NS") and set assetClass to "Equity" (except LIQUIDBEES / LIQUIDCASE / GILT / BHARATBOND -> "Debt"). For Coin Mutual Funds, set assetClass to "Mutual Fund" (or "Debt" if Arbitrage/Debt).
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
        promptParts[0].text += `\n\nFile Content:\n${String(content).slice(0, 350000)}`;
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

      res.json({
        statementType,
        provider: detectedProvider,
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
      res.status(500).json({ error: "Failed to extract data: " + e.message });
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
      Object.keys(db.households).forEach(householdId => {
        checkAndSendRebalanceAlert(householdId).catch(err => console.error("Monitor failed for", householdId, err));
      });
    }, 4 * 60 * 60 * 1000);
  });
}

startServer();
