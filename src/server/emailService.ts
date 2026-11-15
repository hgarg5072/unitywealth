import axios from "axios";
import crypto from "crypto";
import tls from "tls";
import { OAuth2Client } from "google-auth-library";
import { Resend } from "resend";
import { getAppStateKeyPg, setAppStateKeyPg } from "./postgresStore";

export type EmailProviderType = "gmail_oauth" | "gmail_token" | "gmail_smtp" | "brevo" | "resend" | "none";

export interface StoredEmailConfig {
  provider: EmailProviderType;
  senderEmail: string;
  senderName?: string;
  // Gmail OAuth / Token
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    scope?: string;
  };
  // Resend / Brevo API key or Gmail App Password
  apiKey?: string;
  updatedAt: number;
}

export interface EmailStatusPublic {
  configured: boolean;
  provider: EmailProviderType;
  senderEmail: string | null;
  officialSenderEmail: string;
  isOfficialSender: boolean;
  hasRefreshToken: boolean;
  canSendToAnyone: boolean;
  googleOAuthAvailable: boolean;
  warning?: string;
}

export interface SendEmailResult {
  sent: boolean;
  provider: EmailProviderType;
  senderEmail?: string;
  messageId?: string;
  error?: string;
  gmailComposeUrl: string;
  mailtoUrl: string;
}

function encodeMimeHeaderUtf8(value: string): string {
  const clean = (value || "").replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function encodeQuotedPrintableUtf8(input: string): string {
  const normalized = (input || "").replace(/\r?\n/g, "\r\n");
  const rawLines = normalized.split("\r\n");
  const outLines: string[] = [];

  for (const rawLine of rawLines) {
    const buf = Buffer.from(rawLine, "utf8");
    let current = "";

    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      const isLastByte = i === buf.length - 1;
      let token: string;

      if ((b === 0x20 || b === 0x09) && !isLastByte) {
        token = String.fromCharCode(b);
      } else if (b >= 33 && b <= 126 && b !== 61 && !(i === 0 && b === 46)) {
        token = String.fromCharCode(b);
      } else {
        token = `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
      }

      if (current.length + token.length > 75) {
        outLines.push(`${current}=`);
        current = token;
      } else {
        current += token;
      }
    }
    outLines.push(current);
  }

  return outLines.join("\r\n");
}

function wrapCleanHtmlDocument(title: string, bodyInner: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>${title.replace(/[<>&"]/g, "")}</title>`,
    "</head>",
    '<body style="margin:0;padding:0;background-color:#f8fafc;">',
    bodyInner.trim(),
    "</body>",
    "</html>"
  ].join("\r\n");
}

function formatFromAddress(fromEmail: string, fromName?: string): string {
  if (!fromName) return fromEmail;
  const cleanName = fromName.replace(/[\r\n"]+/g, " ").trim();
  if (/^[A-Za-z0-9 _.-]+$/.test(cleanName)) {
    return `"${cleanName}" <${fromEmail}>`;
  }
  return `${encodeMimeHeaderUtf8(cleanName)} <${fromEmail}>`;
}

function buildMultipartRawEmail(opts: {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = `000000000000${crypto.randomBytes(8).toString("hex")}`;
  const senderDomain = (opts.fromEmail.split("@")[1] || "gmail.com").trim();
  const messageId = `<${crypto.randomUUID()}@${senderDomain}>`;
  const rfcDate = new Date().toUTCString();
  const displayFrom = formatFromAddress(opts.fromEmail, opts.fromName);
  const fullHtml = opts.html.trim().toLowerCase().startsWith("<!doctype")
    ? opts.html
    : wrapCleanHtmlDocument(opts.subject, opts.html);

  const lines = [
    `Date: ${rfcDate}`,
    `Message-ID: ${messageId}`,
    `From: ${displayFrom}`,
    `To: <${opts.toEmail.trim()}>`,
    `Subject: ${encodeMimeHeaderUtf8(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintableUtf8(opts.text),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintableUtf8(fullHtml),
    "",
    `--${boundary}--`,
    ""
  ];
  return lines.join("\r\n");
}

function toBase64Url(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildComposeFallbackUrls(opts: { to: string; subject: string; text: string }) {
  const to = (opts.to || "").trim();
  const su = encodeURIComponent(opts.subject || "");
  const body = encodeURIComponent(opts.text || "");
  return {
    gmailComposeUrl: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${su}&body=${body}`,
    mailtoUrl: `mailto:${encodeURIComponent(to)}?subject=${su}&body=${body}`
  };
}

export const OFFICIAL_SYSTEM_SENDER_EMAIL = "unitywealth.alerts@gmail.com";

export async function saveHouseholdEmailConfig(
  householdId: string | null | undefined,
  cfg: StoredEmailConfig | null
): Promise<void> {
  const isOfficial = cfg?.senderEmail?.toLowerCase() === OFFICIAL_SYSTEM_SENDER_EMAIL;
  if (cfg && isOfficial) {
    cfg = {
      ...cfg,
      senderEmail: OFFICIAL_SYSTEM_SENDER_EMAIL,
      senderName: "UnityWealth"
    };
  }
  if (householdId) {
    await setAppStateKeyPg(`email_cfg:${householdId}`, cfg);
  }
  if (isOfficial) {
    await setAppStateKeyPg("email_cfg:global", cfg);
    return;
  }
  const existingGlobal = await getAppStateKeyPg<StoredEmailConfig>("email_cfg:global");
  const globalIsOfficial =
    existingGlobal &&
    existingGlobal.provider &&
    existingGlobal.provider !== "none" &&
    existingGlobal.senderEmail?.toLowerCase() === OFFICIAL_SYSTEM_SENDER_EMAIL;
  if (!globalIsOfficial) {
    await setAppStateKeyPg("email_cfg:global", cfg);
  }
}

export async function resolveEmailConfig(householdId?: string | null): Promise<StoredEmailConfig | null> {
  const globalCfg = await getAppStateKeyPg<StoredEmailConfig>("email_cfg:global");
  // When the dedicated system sender (unitywealth.alerts@gmail.com) is authorized, always prefer it across all households
  if (
    globalCfg &&
    globalCfg.provider &&
    globalCfg.provider !== "none" &&
    globalCfg.senderEmail?.toLowerCase() === OFFICIAL_SYSTEM_SENDER_EMAIL
  ) {
    return {
      ...globalCfg,
      senderName: "UnityWealth"
    };
  }

  if (householdId) {
    const hhCfg = await getAppStateKeyPg<StoredEmailConfig>(`email_cfg:${householdId}`);
    if (hhCfg && hhCfg.provider && hhCfg.provider !== "none") {
      return hhCfg;
    }
  }

  if (globalCfg && globalCfg.provider && globalCfg.provider !== "none") {
    return globalCfg;
  }

  if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) {
    return {
      provider: "brevo",
      senderEmail: process.env.BREVO_SENDER_EMAIL,
      senderName: "UnityWealth",
      apiKey: process.env.BREVO_API_KEY,
      updatedAt: Date.now()
    };
  }

  if (process.env.RESEND_API_KEY) {
    const fromEmail =
      process.env.RESEND_FROM && process.env.RESEND_FROM.includes("@")
        ? process.env.RESEND_FROM
        : "onboarding@resend.dev";
    return {
      provider: "resend",
      senderEmail: fromEmail,
      senderName: "UnityWealth",
      apiKey: process.env.RESEND_API_KEY,
      updatedAt: Date.now()
    };
  }

  return null;
}

export async function getEmailDeliveryStatus(householdId?: string | null): Promise<EmailStatusPublic> {
  const googleOAuthAvailable = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const cfg = await resolveEmailConfig(householdId);

  if (!cfg) {
    return {
      configured: false,
      provider: "none",
      senderEmail: null,
      officialSenderEmail: OFFICIAL_SYSTEM_SENDER_EMAIL,
      isOfficialSender: false,
      hasRefreshToken: false,
      canSendToAnyone: false,
      googleOAuthAvailable,
      warning: `Authorize ${OFFICIAL_SYSTEM_SENDER_EMAIL} once in 1 click so all Family Invitations and Rebalance Reports send from UnityWealth <${OFFICIAL_SYSTEM_SENDER_EMAIL}>.`
    };
  }

  const isOfficialSender = cfg.senderEmail?.toLowerCase() === OFFICIAL_SYSTEM_SENDER_EMAIL;

  if (cfg.provider === "gmail_token") {
    const exp = Number(cfg.tokens?.expiry_date) || 0;
    const expired = exp > 0 && Date.now() > exp;
    if (expired && !cfg.tokens?.refresh_token) {
      return {
        configured: false,
        provider: "none",
        senderEmail: cfg.senderEmail || null,
        officialSenderEmail: OFFICIAL_SYSTEM_SENDER_EMAIL,
        isOfficialSender,
        hasRefreshToken: false,
        canSendToAnyone: false,
        googleOAuthAvailable,
        warning: `Gmail session for ${cfg.senderEmail} expired. Click 'Authorize ${OFFICIAL_SYSTEM_SENDER_EMAIL}' once to re-connect.`
      };
    }
  }

  const isResendSandbox = cfg.provider === "resend" && cfg.senderEmail.toLowerCase().endsWith("@resend.dev");

  return {
    configured: true,
    provider: cfg.provider,
    senderEmail: cfg.senderEmail,
    officialSenderEmail: OFFICIAL_SYSTEM_SENDER_EMAIL,
    isOfficialSender,
    hasRefreshToken: Boolean(cfg.tokens?.refresh_token),
    canSendToAnyone: !isResendSandbox,
    googleOAuthAvailable,
    warning: isResendSandbox
      ? "Resend's onboarding@resend.dev sandbox only delivers to your own Resend signup email. Connect Gmail instead to send invitations to any family member."
      : !isOfficialSender
      ? `Currently sending from ${cfg.senderEmail}. Authorize ${OFFICIAL_SYSTEM_SENDER_EMAIL} below once to switch all outgoing alerts to UnityWealth <${OFFICIAL_SYSTEM_SENDER_EMAIL}>.`
      : undefined
  };
}

async function sendViaGmailApi(
  cfg: StoredEmailConfig,
  householdId: string | null | undefined,
  opts: { to: string; subject: string; text: string; html: string }
): Promise<{ messageId: string; senderEmail: string }> {
  let accessToken = cfg.tokens?.access_token || "";
  const refreshToken = cfg.tokens?.refresh_token || "";
  const expiry = Number(cfg.tokens?.expiry_date) || 0;

  if (refreshToken && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const needsRefresh = !accessToken || (expiry > 0 && Date.now() > expiry - 60_000);
    if (needsRefresh) {
      const oauth2 = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const refreshed = await oauth2.getAccessToken();
      if (refreshed?.token) {
        accessToken = refreshed.token;
        const updatedCfg: StoredEmailConfig = {
          ...cfg,
          provider: "gmail_oauth",
          tokens: {
            ...cfg.tokens,
            access_token: accessToken,
            refresh_token: refreshToken,
            expiry_date: Date.now() + 50 * 60 * 1000
          },
          updatedAt: Date.now()
        };
        await saveHouseholdEmailConfig(householdId, updatedCfg);
      }
    }
  }

  if (!accessToken) {
    throw new Error("Gmail access token is missing or expired. Please click 'Connect Gmail' to authorize.");
  }

  const rawMime = buildMultipartRawEmail({
    fromEmail: cfg.senderEmail,
    fromName: cfg.senderName || "UnityWealth Family Office",
    toEmail: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html
  });

  try {
    const resp = await axios.post(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { raw: toBase64Url(rawMime) },
      {
        timeout: 12000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    return { messageId: resp.data?.id || "gmail_sent", senderEmail: cfg.senderEmail };
  } catch (err: any) {
    // If 401 and we have a refresh token, retry once with forced token refresh
    if (err?.response?.status === 401 && refreshToken && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      const oauth2 = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const refreshed = await oauth2.getAccessToken();
      if (refreshed?.token) {
        const retryResp = await axios.post(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          { raw: toBase64Url(rawMime) },
          {
            timeout: 12000,
            headers: {
              Authorization: `Bearer ${refreshed.token}`,
              "Content-Type": "application/json"
            }
          }
        );
        await saveHouseholdEmailConfig(householdId, {
          ...cfg,
          provider: "gmail_oauth",
          tokens: { ...cfg.tokens, access_token: refreshed.token, refresh_token: refreshToken, expiry_date: Date.now() + 50 * 60 * 1000 },
          updatedAt: Date.now()
        });
        return { messageId: retryResp.data?.id || "gmail_sent", senderEmail: cfg.senderEmail };
      }
    }
    const apiMsg = err?.response?.data?.error?.message || err.message || "Gmail API error";
    throw new Error(`Gmail API failed: ${apiMsg}`);
  }
}

async function sendViaGmailSmtpAppPassword(
  cfg: StoredEmailConfig,
  opts: { to: string; subject: string; text: string; html: string }
): Promise<{ messageId: string; senderEmail: string }> {
  const appPass = (cfg.apiKey || "").replace(/\s+/g, "");
  if (!cfg.senderEmail || !appPass) {
    throw new Error("Missing Gmail address or 16-character App Password");
  }
  const rawMime = buildMultipartRawEmail({
    fromEmail: cfg.senderEmail,
    fromName: cfg.senderName || "UnityWealth Family Office",
    toEmail: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html
  });

  return new Promise((resolve, reject) => {
    const socket = tls.connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
    let buffer = "";
    let step = 0;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP port 465 timed out on cloud host — please use 1-Click Gmail OAuth or Brevo/Resend HTTPS API instead."));
    }, 7000);

    const sendLine = (line: string) => socket.write(line + "\r\n");

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`SMTP connection failed (${err.message}) — use 1-Click Gmail OAuth (HTTPS) instead.`));
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line || (line.length >= 4 && line[3] === "-")) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (code >= 400) {
          clearTimeout(timeout);
          socket.end();
          reject(new Error(`Gmail SMTP error: ${line}`));
          return;
        }
        if (step === 0 && code === 220) {
          step = 1;
          sendLine("EHLO unitywealth.app");
        } else if (step === 1 && code === 250) {
          step = 2;
          const authStr = Buffer.from(`\0${cfg.senderEmail}\0${appPass}`, "utf8").toString("base64");
          sendLine(`AUTH PLAIN ${authStr}`);
        } else if (step === 2 && code === 235) {
          step = 3;
          sendLine(`MAIL FROM:<${cfg.senderEmail}>`);
        } else if (step === 3 && code === 250) {
          step = 4;
          sendLine(`RCPT TO:<${opts.to}>`);
        } else if (step === 4 && code === 250) {
          step = 5;
          sendLine("DATA");
        } else if (step === 5 && code === 354) {
          step = 6;
          const dotStuffed = rawMime.replace(/\r\n\./g, "\r\n..");
          socket.write(dotStuffed + "\r\n.\r\n");
        } else if (step === 6 && code === 250) {
          step = 7;
          clearTimeout(timeout);
          sendLine("QUIT");
          socket.end();
          resolve({ messageId: "smtp_sent", senderEmail: cfg.senderEmail });
        }
      }
    });
  });
}

export async function sendHouseholdEmail(opts: {
  householdId?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  const cleanTo = (opts.to || "").trim();
  const fallbackUrls = buildComposeFallbackUrls({
    to: cleanTo,
    subject: opts.subject,
    text: opts.text
  });

  if (!cleanTo || !cleanTo.includes("@")) {
    return {
      sent: false,
      provider: "none",
      error: "Invalid recipient email address",
      ...fallbackUrls
    };
  }

  const cfg = await resolveEmailConfig(opts.householdId);
  if (!cfg) {
    return {
      sent: false,
      provider: "none",
      error: "Outgoing email is not connected yet. Click 'Authorize Gmail' once in Family & Accounts (or use the pre-filled Gmail compose button).",
      ...fallbackUrls
    };
  }

  try {
    if (cfg.provider === "gmail_oauth" || cfg.provider === "gmail_token") {
      const r = await sendViaGmailApi(cfg, opts.householdId, {
        to: cleanTo,
        subject: opts.subject,
        text: opts.text,
        html: opts.html
      });
      return {
        sent: true,
        provider: cfg.provider,
        senderEmail: r.senderEmail,
        messageId: r.messageId,
        ...fallbackUrls
      };
    }

    if (cfg.provider === "gmail_smtp") {
      const r = await sendViaGmailSmtpAppPassword(cfg, {
        to: cleanTo,
        subject: opts.subject,
        text: opts.text,
        html: opts.html
      });
      return {
        sent: true,
        provider: "gmail_smtp",
        senderEmail: r.senderEmail,
        messageId: r.messageId,
        ...fallbackUrls
      };
    }

    if (cfg.provider === "brevo" && cfg.apiKey) {
      const resp = await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
          sender: { name: cfg.senderName || "UnityWealth Family Office", email: cfg.senderEmail },
          to: [{ email: cleanTo }],
          subject: opts.subject,
          htmlContent: opts.html,
          textContent: opts.text
        },
        {
          timeout: 12000,
          headers: {
            "api-key": cfg.apiKey,
            "Content-Type": "application/json",
            accept: "application/json"
          }
        }
      );
      return {
        sent: true,
        provider: "brevo",
        senderEmail: cfg.senderEmail,
        messageId: resp.data?.messageId || "brevo_sent",
        ...fallbackUrls
      };
    }

    if (cfg.provider === "resend" && cfg.apiKey) {
      const client = new Resend(cfg.apiKey);
      const fromAddr = cfg.senderEmail.includes("<")
        ? cfg.senderEmail
        : `${cfg.senderName || "UnityWealth"} <${cfg.senderEmail}>`;
      const { data, error } = await client.emails.send({
        from: fromAddr,
        to: cleanTo,
        subject: opts.subject,
        html: opts.html,
        text: opts.text
      });
      if (error) {
        const hint =
          error.name === "validation_error"
            ? " (Resend onboarding@resend.dev only sends to your own signup email unless you verify a domain — connect Gmail instead to email any family member!)"
            : "";
        return {
          sent: false,
          provider: "resend",
          senderEmail: cfg.senderEmail,
          error: `${error.message || "Resend error"}${hint}`,
          ...fallbackUrls
        };
      }
      return {
        sent: true,
        provider: "resend",
        senderEmail: cfg.senderEmail,
        messageId: data?.id || "resend_sent",
        ...fallbackUrls
      };
    }

    return {
      sent: false,
      provider: "none",
      error: "No valid email sender configuration found.",
      ...fallbackUrls
    };
  } catch (err: any) {
    console.error("[EmailService Error]", err.message);
    return {
      sent: false,
      provider: cfg.provider,
      senderEmail: cfg.senderEmail,
      error: err.message || "Email delivery failed",
      ...fallbackUrls
    };
  }
}

export function buildInvitationEmailContent(params: {
  householdName: string;
  inviterName: string;
  inviteCode: string;
  joinUrl: string;
}) {
  const subject = `${params.inviterName} invited you to ${params.householdName} on UnityWealth`;
  const text = `Hi,\n\n${params.inviterName} invited you to join the shared family portfolio "${params.householdName}" on UnityWealth.\n\nJoin link:\n${params.joinUrl}\n\nFamily Invite Code: ${params.inviteCode}\n\n— UnityWealth`;

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:32px 16px;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
      <div style="background:#4f46e5;padding:24px 28px;color:#ffffff;">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">UnityWealth Family Office</div>
        <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;">You're Invited to ${params.householdName}</h1>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">
          <strong>${params.inviterName}</strong> invited you to collaborate on your shared household wealth dashboard, monthly net worth curve, and tax-efficient rebalance plan.
        </p>
        <div style="background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:14px;padding:18px;text-align:center;margin-bottom:22px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Family Invite Code</div>
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:900;letter-spacing:0.25em;color:#0f172a;">${params.inviteCode}</div>
        </div>
        <div style="text-align:center;margin-bottom:22px;">
          <a href="${params.joinUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:12px;">
            Accept Invite &amp; Join Family Portfolio
          </a>
        </div>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;text-align:center;">
          Or open <a href="${params.joinUrl}" style="color:#4f46e5;">${params.joinUrl}</a> and enter code <strong>${params.inviteCode}</strong> under <em>Join Family</em>.
        </p>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

export function buildRebalanceEmailContent(params: {
  householdName: string;
  recipientName: string;
  totalValINR: number;
  totalValUSD: number;
  accuracy: number;
  threshold: number;
  actualEquityPct: number;
  targetEquityPct: number;
  indianEquityPctOfEq: number;
  foreignEquityPctOfEq: number;
  mode: "full" | "sip";
  executiveSummary: string;
  orders: { type: string; title: string; category: string; amount: string; description: string }[];
  appUrl: string;
}) {
  const fmtCrore = (v: number) => {
    if (v >= 1_00_00_000) return `Rs. ${(v / 1_00_00_000).toFixed(2)} Cr`;
    if (v >= 1_00_000) return `Rs. ${(v / 1_00_000).toFixed(2)} L`;
    return `Rs. ${Math.round(v).toLocaleString("en-IN")}`;
  };

  const subject = `${params.householdName} — ${params.mode === "sip" ? "Monthly SIP Plan" : "Portfolio Rebalance Summary"} (${params.accuracy.toFixed(1)}% aligned)`;

  const orderLinesText =
    params.orders.length > 0
      ? params.orders
          .map((o, idx) => `${idx + 1}. [${o.type.toUpperCase()}] ${o.title} (${o.category}): ${o.amount} — ${o.description}`)
          .join("\n")
      : "Portfolio is aligned within target tolerances — no trades required right now.";

  const text = `Hi ${params.recipientName || "Investor"},\n\nHere is the latest ${params.mode === "sip" ? "Zero-Sell Monthly SIP Routing Plan" : "Portfolio Rebalance Plan"} for ${params.householdName}.\n\nCombined Net Worth: ${fmtCrore(params.totalValINR)} ($${Math.round(params.totalValUSD).toLocaleString("en-US")})\nAlignment Score: ${params.accuracy.toFixed(1)}% (Alert Threshold: ${params.threshold}%)\nEquity / Debt Mix: ${(params.actualEquityPct * 100).toFixed(1)}% Equity vs ${(params.targetEquityPct * 100).toFixed(0)}% Target\n\nSummary:\n${params.executiveSummary}\n\nRecommended Actions:\n${orderLinesText}\n\nOpen Dashboard: ${params.appUrl}\n\n— UnityWealth Family Office`;

  const orderRowsHtml =
    params.orders.length > 0
      ? params.orders
          .map(
            (o) => `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">
              <span style="display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;text-transform:uppercase;background:${
                o.type === "sell" ? "#ffe4e6" : "#d1fae5"
              };color:${o.type === "sell" ? "#be123c" : "#047857"};">${o.type}</span>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">
              <div style="font-weight:700;font-size:13px;color:#0f172a;">${o.title}</div>
              <div style="font-size:11px;color:#64748b;">${o.category} • ${o.description}</div>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:800;font-size:13px;color:${
              o.type === "sell" ? "#e11d48" : "#059669"
            };white-space:nowrap;">
              ${o.type === "sell" ? "-" : "+"}${o.amount}
            </td>
          </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="padding:18px;text-align:center;color:#059669;font-weight:700;">Portfolio is well balanced — no trades required!</td></tr>`;

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:32px 16px;color:#0f172a;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
      <div style="background:#0f172a;padding:24px 28px;color:#ffffff;">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#818cf8;">UnityWealth Strategy Report</div>
        <h1 style="margin:6px 0 0;font-size:21px;font-weight:800;">${params.householdName} — ${
    params.mode === "sip" ? "Zero-Sell SIP Plan" : "Rebalance Execution Plan"
  }</h1>
      </div>
      <div style="padding:26px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
          <div style="flex:1;min-width:140px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
            <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Combined Net Worth</div>
            <div style="font-size:18px;font-weight:900;color:#0f172a;margin-top:4px;">${fmtCrore(params.totalValINR)}</div>
            <div style="font-size:11px;color:#64748b;">$${Math.round(params.totalValUSD).toLocaleString("en-US")}</div>
          </div>
          <div style="flex:1;min-width:140px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
            <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Alignment Score</div>
            <div style="font-size:18px;font-weight:900;color:${params.accuracy >= params.threshold ? "#059669" : "#e11d48"};margin-top:4px;">${params.accuracy.toFixed(1)}%</div>
            <div style="font-size:11px;color:#64748b;">Target Threshold: ${params.threshold}%</div>
          </div>
          <div style="flex:1;min-width:140px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
            <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Equity vs Target</div>
            <div style="font-size:18px;font-weight:900;color:#4f46e5;margin-top:4px;">${(params.actualEquityPct * 100).toFixed(1)}% / ${(params.targetEquityPct * 100).toFixed(0)}%</div>
            <div style="font-size:11px;color:#64748b;">IND ${(params.indianEquityPctOfEq * 100).toFixed(0)}% • US ${(params.foreignEquityPctOfEq * 100).toFixed(0)}%</div>
          </div>
        </div>

        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:14px;padding:16px;margin-bottom:22px;">
          <div style="font-size:10px;font-weight:800;color:#4338ca;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Executive Summary</div>
          <div style="font-size:13px;line-height:1.55;color:#1e1b4b;font-weight:600;">${params.executiveSummary}</div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr style="background:#f8fafc;text-align:left;">
              <th style="padding:8px 12px;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Action</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Order Details</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${orderRowsHtml}
          </tbody>
        </table>

        <div style="text-align:center;">
          <a href="${params.appUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:13px 26px;border-radius:12px;">
            Open UnityWealth Rebalance &amp; SIP Router
          </a>
        </div>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}
