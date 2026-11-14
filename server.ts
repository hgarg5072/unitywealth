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
import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

// Initialize Firebase Admin (Lazy helper)
function getFirestoreInstance() {
  if (getApps().length === 0) {
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
  return getFirestore(firebaseConfig.firestoreDatabaseId);
}

const firestore = getFirestoreInstance();

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function getAIClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'x-goog-api-client': 'aistudio-build',
      }
    }
  });
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

    const result = await getAIClient().models.generateContent({
      model: "gemini-flash-latest",
      contents: { parts: promptParts },
      config: { responseMimeType: "application/json" }
    });

    const holdings = JSON.parse(result.text || "[]");
    
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
            // Scheme name is usually the field before ISIN or right before NAV if ISIN is missing
            // Standard format is Code;ISIN;ISIN;Name;NAV;Date (6 parts)
            // or Code|ISIN|Name|NAV|Date (5 parts)
            let nameIdx = navIdx - 1;
            // Catch cases where there's an ISIN between Name and NAV (rare)
            if (parts[nameIdx].length > 4 && /^[A-Z0-9]{12}$/.test(parts[nameIdx])) {
              nameIdx = nameIdx - 1;
            }

            const price = parseFloat(parts[navIdx]);
            if (!isNaN(price) && parts[nameIdx]) {
              results.push({
                symbol: parts[0].trim(),
                shortname: parts[nameIdx].trim(),
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

  async function fetchLiveStockPrices(symbols: string[]) {
    if (symbols.length === 0) return {};
    
    const priceMap: Record<string, number> = {};
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
    const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;

    // Grouping
    const indiaStocks = symbols.filter(s => {
      const u = s.toUpperCase();
      return u.endsWith('.NS') || u.endsWith('.BO') || u.includes(':NSE') || u.includes(':BSE');
    });

    console.log(`[fetchLiveStockPrices] Symbols: ${symbols.join(', ')}. Finnhub: ${FINNHUB_KEY ? 'Present' : 'MISSING'}. AlphaVantage: ${AV_KEY ? 'Present' : 'MISSING'}`);
    
    const potentialUS = symbols.filter(s => !indiaStocks.includes(s));
    
    const fetchTasks: Promise<void>[] = [];

    // --- Task A: Alpha Vantage (For Indian Stocks) ---
    if (indiaStocks.length > 0) {
      if (!AV_KEY) {
        console.warn("[AlphaVantage] API Key missing. Skipping India stocks.");
      } else {
        fetchTasks.push((async () => {
          for (const symbol of indiaStocks) {
            try {
              let avSym = symbol.toUpperCase();
              // Normalize common formats to Alpha Vantage preferred ones
              if (avSym.endsWith('.NS')) avSym = avSym.replace('.NS', '.NSE');
              if (avSym.endsWith('.BO')) avSym = avSym.replace('.BO', '.BSE');
              
              // If it's already like 'NSE:RELIANCE', it might work too, 
              // but AV usually prefers TICKET.NSE. Let's try to handle both.
              if (avSym.includes(':')) {
                const [exch, ticker] = avSym.split(':');
                if (exch === 'NSE') avSym = `${ticker}.NSE`;
                else if (exch === 'BSE') avSym = `${ticker}.BSE`;
              }
              
              console.log(`[AlphaVantage] Fetching ${avSym} (original: ${symbol})`);
              const res = await axios.get(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSym}&apikey=${AV_KEY}`);
              
              if (res.data?.["Note"]) {
                console.warn(`[AlphaVantage] Rate limit hit for ${symbol}`);
                break; 
              }

              const quote = res.data?.["Global Quote"];
              const priceStr = quote?.["05. price"];
              
              if (priceStr) {
                const price = parseFloat(priceStr);
                priceMap[symbol] = price;
                console.log(`[AlphaVantage] Success: ${symbol} = ${price}`);
              } else {
                // Try one more internal format if the first one fails
                let fallbackSym = avSym;
                if (avSym.endsWith('.NSE')) fallbackSym = avSym.replace('.NSE', '.NS');
                if (avSym.endsWith('.BSE')) fallbackSym = avSym.replace('.BSE', '.BO');
                
                if (fallbackSym !== avSym) {
                   console.log(`[AlphaVantage] Retrying with ${fallbackSym}...`);
                   const res2 = await axios.get(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${fallbackSym}&apikey=${AV_KEY}`);
                   const p2 = res2.data?.["Global Quote"]?.["05. price"];
                   if (p2) {
                     priceMap[symbol] = parseFloat(p2);
                     console.log(`[AlphaVantage] Success on fallback: ${symbol} = ${priceMap[symbol]}`);
                   }
                }
              }
              
              await new Promise(r => setTimeout(r, 600)); // slightly longer delay
            } catch (e: any) {
              console.error(`[AlphaVantage] Error for ${symbol}:`, e.message);
            }
          }
        })());
      }
    }

    // --- Task B: Finnhub (US Stocks & Crypto) ---
    if (potentialUS.length > 0 && FINNHUB_KEY) {
      console.log(`[Finnhub] Fetching ${potentialUS.length} symbols...`);
      const pTasks = potentialUS.map(async (symbol) => {
        try {
          let sym = symbol.toUpperCase().replace('.US', '');
          // Basic Crypto Mapping for Finnhub
          if (sym === 'BTC' || sym === 'BITCOIN') sym = 'BINANCE:BTCUSDT';
          else if (sym === 'ETH' || sym === 'ETHEREUM') sym = 'BINANCE:ETHUSDT';
          
          const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`, { 
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (res.data?.c && res.data.c !== 0) {
            priceMap[symbol] = res.data.c;
          }
        } catch (e) {
          console.warn(`[Finnhub] Failed for ${symbol}: ${e.message}`);
        }
      });
      fetchTasks.push(Promise.all(pTasks).then(() => {}));
    }

    await Promise.all(fetchTasks);

    console.log(`Live Stock Fetch: Found ${Object.keys(priceMap).length} of ${symbols.length} symbols.`);
    return priceMap;
  }

  app.get("/api/mf/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const query = (q as string).toLowerCase();

    const data = await getAmfiData();
    const filtered = data
      .filter(item => 
        (item.shortname && item.shortname.toLowerCase().includes(query)) || 
        (item.symbol && item.symbol.includes(query))
      )
      .slice(0, 15);

    console.log(`MF Search for "${query}" found ${filtered.length} results.`);
    res.json(filtered);
  });

  app.get("/api/tickers/search", async (req, res) => {
    const { q, h: householdId } = req.query;
    if (!q) return res.json([]);
    
    try {
      const db = getDB();
      const household = householdId ? db.households[householdId as string] : null;
      
      const results: any[] = [];
      const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

      // 1. Finnhub Search (Strong for US and some international)
      if (FINNHUB_KEY) {
        try {
          const fRes = await axios.get(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q as string)}&token=${FINNHUB_KEY}`);
          const fQuotes = (fRes.data.result || [])
            .filter((quote: any) => ['Common Stock', 'ETF', 'REIT', 'ADR'].includes(quote.type))
            .map((quote: any) => ({
              symbol: quote.symbol,
              shortname: quote.description,
              exchDisp: quote.displaySymbol.includes('.') ? quote.displaySymbol.split('.')[1] : 'US',
              typeDisp: quote.type,
              currentPrice: 0,
              isIndia: quote.symbol.endsWith('.NS') || quote.symbol.endsWith('.BO')
            }));
          results.push(...fQuotes);
        } catch(e) { console.warn("Finnhub search failed"); }
      }

      // 2. Alpha Vantage Search (Good for international)
      const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;
      if (AV_KEY && results.length < 5) {
        try {
          const avRes = await axios.get(`https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(q as string)}&apikey=${AV_KEY}`);
          const avQuotes = (avRes.data.bestMatches || []).map((m: any) => ({
            symbol: m["1. symbol"],
            shortname: m["2. name"],
            exchDisp: m["4. region"],
            typeDisp: m["3. type"],
            currentPrice: 0,
            isIndia: m["1. symbol"].endsWith('.BSE') || m["1. symbol"].endsWith('.NSE') || m["4. region"] === 'India'
          }));
          results.push(...avQuotes);
        } catch(e) { console.warn("Alpha Vantage search failed"); }
      }

      // De-duplicate by symbol
      const uniqueResults = results.reduce((acc, current) => {
        const x = acc.find((item: any) => item.symbol === current.symbol);
        if (!x) return acc.concat([current]);
        else return acc;
      }, []).slice(0, 10);

      // Fetch prices for search results
      if (uniqueResults.length > 0) {
        try {
          const priceMap = await fetchLiveStockPrices(
            uniqueResults.map((r: any) => r.symbol)
          );
          uniqueResults.forEach((r: any) => {
            if (priceMap[r.symbol]) r.currentPrice = priceMap[r.symbol];
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
    const { h: householdId } = req.query;
    try {
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

  app.delete("/api/portfolio/holding/:holdingId", (req, res) => {
    const db = getDB();
    const { holdingId } = req.params;
    const initialCount = db.holdings.length;
    db.holdings = db.holdings.filter((h: any) => h.id !== holdingId);
    
    if (db.holdings.length < initialCount) {
      saveDB(db);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Holding not found" });
    }
  });

  app.patch("/api/portfolio/holding/:holdingId", (req, res) => {
    const db = getDB();
    const { holdingId } = req.params;
    const { quantity, currentPrice } = req.body;
    
    const holding = db.holdings.find((h: any) => h.id === holdingId);
    if (holding) {
      if (quantity !== undefined) holding.quantity = Number(quantity);
      if (currentPrice !== undefined) holding.currentPrice = Number(currentPrice);
      saveDB(db);
      res.json(holding);
    } else {
      res.status(404).json({ error: "Holding not found" });
    }
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
    const { userId, householdId, holdings } = req.body;
    
    try {
      // Clean existing PDF or CAMS holdings for this user
      const holdingsRef = firestore.collection('holdings');
      const q = holdingsRef
        .where('userId', '==', userId)
        .where('householdId', '==', householdId);
      const snap = await q.get();
      
      const batch = firestore.batch();
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.source === "PDF" || data.provider === "CAMS") {
          batch.delete(doc.ref);
        }
      });

      const newHoldings = holdings.map((h: any) => {
        const id = "h_" + Math.random().toString(36).substr(2, 9);
        const data = {
          userId,
          householdId,
          ticker: h.schemeName,
          quantity: parseFloat(h.units),
          assetClass: h.assetClass || "Mutual Fund",
          currency: "INR",
          provider: "CAMS",
          source: "PDF",
          currentPrice: parseFloat(h.nav),
          originalName: h.originalName,
          syncedAt: Date.now()
        };
        batch.set(holdingsRef.doc(id), data);
        return { id, ...data };
      });

      await batch.commit();
      checkAndSendRebalanceAlert(householdId); 
      res.json({ success: true, count: newHoldings.length });
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

      await firestore.collection('holdings').doc(id).set(newHolding);
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
      // Mocking real-time market data fetch. 
      const prices: Record<string, number> = {
        "GOOGL": 175.24,
        "MSFT": 415.10,
        "AAPL": 190.12,
        "AMZN": 185.30,
        "TSLA": 170.50
      };
      
      const price = prices[ticker] || (100 + Math.random() * 50);
      res.json({ ticker, price });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  app.post("/api/gemini/extract", async (req, res) => {
    const { content, isPDF } = req.body;
    try {
      let promptParts: any[] = [
        { text: `Extract all investment holdings (Stocks, Mutual Funds, ETFs) from this ${isPDF ? 'PDF' : 'file content'}. \n\n` +
                "Return as a JSON array of objects with keys: schemeName, originalName, units, nav, assetClass (one of 'Equity', 'Debt', 'Mutual Fund').\n\n" +
                "STRICT CLEANING RULES for 'schemeName':\n" +
                "1. IDENTIFY the core name or ticker. \n" +
                "2. STRIP all plan/option/platform noise.\n" +
                "3. originalName: MUST be the verbatim name for accurate linking.\n\n" +
                "CURRENCY & ASSET CLASS RULES:\n" +
                "- If the fund name contains the word 'Arbitrage' anywhere, set assetClass to 'Debt'. This is MANDATORY.\n" +
                "- If it's a US Stock (e.g. Qualcomm, Apple, Google, Microsoft) or has a ticker like 'QCOM', set currency to 'USD' and assetClass to 'Equity'.\n" +
                "- Default currency is 'INR'.\n\n" +
                "- units and nav: Must be numbers.\n" +
                "- Ignore zero balances.\n" +
                "Only return raw JSON array." }
      ];

      if (isPDF) {
        promptParts.push({
          inlineData: {
            data: content,
            mimeType: "application/pdf"
          }
        });
      } else {
        promptParts[0].text += `\n\nContent:\n${content}`;
      }

      const result = await getAIClient().models.generateContent({
        model: "gemini-flash-latest",
        contents: { parts: promptParts },
        config: {
          responseMimeType: "application/json"
        }
      });
      const text = result.text;
      
      // Clean up markdown code blocks if present
      const cleaned = (text || "").replace(/```json/g, "").replace(/```/g, "").trim();
      const json = JSON.parse(cleaned);
      res.json(json);
    } catch (e: any) {
      console.error("Gemini Extraction Error:", e);
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
