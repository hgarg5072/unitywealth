import React, { useState, useEffect } from "react";
import {
  X,
  User as UserIcon,
  Users,
  Mail,
  LogOut,
  Check,
  AlertTriangle,
  KeyRound,
  Send,
  ExternalLink,
  ShieldCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowRightLeft
} from "lucide-react";
import type { EmailStatusPublic } from "../types";

export type EmailStatusInfo = EmailStatusPublic;

interface ProfileFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: "profile" | "family" | "email";
  user: { id: string; name: string; email: string; householdId: string | null };
  household: any;
  myHoldingsCount: number;
  emailStatus: EmailStatusInfo | null;
  onSaveProfileName: (newName: string) => Promise<void>;
  onSaveHouseholdName: (newHouseholdName: string) => Promise<void>;
  onLeaveFamily: (mode: "solo_keep_holdings" | "setup_screen") => Promise<void>;
  onJoinFamilyByCode?: (code: string) => Promise<void>;
  onAuthorizeGmailPopup: () => Promise<void>;
  onConnectGoogleOffline: () => Promise<void>;
  onSaveProviderConfig: (cfg: {
    provider: "brevo" | "resend" | "gmail_smtp" | "disconnect";
    senderEmail?: string;
    apiKey?: string;
  }) => Promise<void>;
  onSendTestEmail: (recipientEmail: string) => Promise<{
    sent: boolean;
    provider?: string;
    senderEmail?: string;
    error?: string;
    gmailComposeUrl?: string;
  }>;
}

export const ProfileFamilyModal: React.FC<ProfileFamilyModalProps> = ({
  isOpen,
  onClose,
  initialSection = "profile",
  user,
  household,
  myHoldingsCount,
  emailStatus,
  onSaveProfileName,
  onSaveHouseholdName,
  onLeaveFamily,
  onJoinFamilyByCode,
  onAuthorizeGmailPopup,
  onConnectGoogleOffline,
  onSaveProviderConfig,
  onSendTestEmail
}) => {
  const [displayName, setDisplayName] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [nameSavedMsg, setNameSavedMsg] = useState("");

  const [householdName, setHouseholdName] = useState(household?.name || "");
  const [savingHhName, setSavingHhName] = useState(false);
  const [hhSavedMsg, setHhSavedMsg] = useState("");

  const [switchCode, setSwitchCode] = useState("");
  const [switchingFamily, setSwitchingFamily] = useState(false);

  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [leavingMode, setLeavingMode] = useState<"solo_keep_holdings" | "setup_screen" | null>(null);

  const [authGmailBusy, setAuthGmailBusy] = useState(false);
  const [showApiConfig, setShowApiConfig] = useState(initialSection === "email" && !emailStatus?.configured);
  const [providerType, setProviderType] = useState<"brevo" | "resend" | "gmail_smtp">("brevo");
  const [senderEmailInput, setSenderEmailInput] = useState(user?.email || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);

  const [testRecipient, setTestRecipient] = useState(user?.email || "");
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{
    ok: boolean;
    text: string;
    composeUrl?: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDisplayName(user?.name || "");
      setHouseholdName(household?.name || "");
      setTestRecipient(user?.email || "");
      setSenderEmailInput(emailStatus?.senderEmail || user?.email || "");
      setConfirmLeaveOpen(false);
      setErrorMsg(null);
      setNameSavedMsg("");
      setHhSavedMsg("");
      setEmailFeedback(null);
    }
  }, [isOpen, user?.name, user?.email, household?.name, emailStatus?.senderEmail]);

  if (!isOpen) return null;

  const memberCount = Array.isArray(household?.members) ? household.members.length : 1;

  const handleSaveMyName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = displayName.trim();
    if (!clean) return;
    setSavingName(true);
    setErrorMsg(null);
    try {
      await onSaveProfileName(clean);
      setNameSavedMsg("Name updated across your profile & family!");
      setTimeout(() => setNameSavedMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update display name");
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveFamilyName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = householdName.trim();
    if (!clean) return;
    setSavingHhName(true);
    setErrorMsg(null);
    try {
      await onSaveHouseholdName(clean);
      setHhSavedMsg("Family name updated!");
      setTimeout(() => setHhSavedMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to rename family");
    } finally {
      setSavingHhName(false);
    }
  };

  const handleSwitchByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onJoinFamilyByCode || !switchCode.trim()) return;
    setSwitchingFamily(true);
    setErrorMsg(null);
    try {
      await onJoinFamilyByCode(switchCode.trim());
      setSwitchCode("");
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not join family with that code");
    } finally {
      setSwitchingFamily(false);
    }
  };

  const handleExecuteLeave = async (mode: "solo_keep_holdings" | "setup_screen") => {
    setLeavingMode(mode);
    setErrorMsg(null);
    try {
      await onLeaveFamily(mode);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to leave family");
    } finally {
      setLeavingMode(null);
    }
  };

  const handleGmailPopup = async () => {
    setAuthGmailBusy(true);
    setErrorMsg(null);
    setEmailFeedback(null);
    try {
      await onAuthorizeGmailPopup();
      setEmailFeedback({
        ok: true,
        text: "Gmail connected! Invitations & rebalance reports will now send directly from your Gmail."
      });
    } catch (err: any) {
      setErrorMsg(err?.message || "Google popup authorization was cancelled or failed.");
    } finally {
      setAuthGmailBusy(false);
    }
  };

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;
    setSavingProvider(true);
    setErrorMsg(null);
    setEmailFeedback(null);
    try {
      await onSaveProviderConfig({
        provider: providerType,
        senderEmail: senderEmailInput.trim(),
        apiKey: apiKeyInput.trim()
      });
      setApiKeyInput("");
      setShowApiConfig(false);
      setEmailFeedback({
        ok: true,
        text: `Saved ${providerType.toUpperCase()} email sender (${senderEmailInput.trim()}).`
      });
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save email provider");
    } finally {
      setSavingProvider(false);
    }
  };

  const handleRunTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient.trim()) return;
    setTestingEmail(true);
    setErrorMsg(null);
    setEmailFeedback(null);
    try {
      const res = await onSendTestEmail(testRecipient.trim());
      if (res.sent) {
        setEmailFeedback({
          ok: true,
          text: `Test email delivered to ${testRecipient.trim()} from ${res.senderEmail || res.provider}!`
        });
      } else {
        setEmailFeedback({
          ok: false,
          text: res.error || "Automatic email sender is not authorized yet.",
          composeUrl: res.gmailComposeUrl
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Test email request failed");
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Profile, Family & Email Settings"
    >
      <div className="bg-white w-full max-w-2xl max-h-[88dvh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-base shrink-0">
              {(user?.name || "U")[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-slate-900 truncate">
                Profile, Family &amp; Email Settings
              </h2>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Profile Settings"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-7 overflow-y-auto space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Profile Name */}
          <section className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-white space-y-3.5">
            <div className="flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Your Profile</h3>
            </div>

            <form onSubmit={handleSaveMyName} className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name"
                aria-label="Your Display Name"
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={savingName || !displayName.trim() || displayName.trim() === user?.name}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shrink-0"
              >
                {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save Name
              </button>
            </form>
            {nameSavedMsg && (
              <p className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> {nameSavedMsg}
              </p>
            )}
          </section>

          {/* 2. Family & Leave Household */}
          {household && (
            <section className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-white space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                    Family / Household Membership
                  </h3>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
                  {memberCount} {memberCount === 1 ? "Member" : "Members"} • {myHoldingsCount} Your Holdings
                </span>
              </div>

              {/* Rename Household */}
              <form onSubmit={handleSaveFamilyName} className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="Family / Household Name"
                  aria-label="Family Household Name"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={savingHhName || !householdName.trim() || householdName.trim() === household?.name}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shrink-0"
                >
                  {savingHhName ? "Saving..." : "Rename Family"}
                </button>
              </form>
              {hhSavedMsg && (
                <p className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> {hhSavedMsg}
                </p>
              )}

              {/* Switch / Join Another Family by Code */}
              {onJoinFamilyByCode && (
                <form onSubmit={handleSwitchByCode} className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={switchCode}
                    onChange={(e) => setSwitchCode(e.target.value.toUpperCase())}
                    placeholder="Enter 6-char family invite code"
                    aria-label="Invite Code to Switch Family"
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold uppercase tracking-wider text-slate-900 placeholder:font-sans placeholder:font-medium placeholder:tracking-normal placeholder:normal-case focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={switchingFamily || switchCode.trim().length < 4}
                    className="px-4 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-bold disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    {switchingFamily ? "Joining..." : "Join Family"}
                  </button>
                </form>
              )}

              {/* Leave Family */}
              <div className="pt-3 border-t border-slate-100">
                {!confirmLeaveOpen ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Leave &ldquo;{household.name}&rdquo;</p>
                      <p className="text-[11px] text-slate-500">
                        Unlink your account from this shared family dashboard at any time.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmLeaveOpen(true)}
                      className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Leave Family...
                    </button>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-rose-50/70 border border-rose-200 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-rose-900 space-y-1">
                        <p className="font-black">How would you like to leave &ldquo;{household.name}&rdquo;?</p>
                        <p className="text-rose-700 leading-relaxed">
                          Other family members&apos; holdings will remain untouched in &ldquo;{household.name}&rdquo;. Choose what happens to your{" "}
                          <strong>{myHoldingsCount}</strong> holding{myHoldingsCount === 1 ? "" : "s"}:
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={leavingMode !== null}
                        onClick={() => handleExecuteLeave("solo_keep_holdings")}
                        className="p-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 text-left transition-all shadow-sm"
                      >
                        <div className="text-xs font-black flex items-center gap-1.5">
                          {leavingMode === "solo_keep_holdings" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Keep My Holdings in Personal Portfolio
                        </div>
                        <div className="text-[10px] text-indigo-100 mt-1">
                          Moves your {myHoldingsCount} holding{myHoldingsCount === 1 ? "" : "s"} into a private solo portfolio.
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={leavingMode !== null}
                        onClick={() => handleExecuteLeave("setup_screen")}
                        className="p-3 rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 disabled:opacity-60 text-left transition-all"
                      >
                        <div className="text-xs font-black flex items-center gap-1.5">
                          {leavingMode === "setup_screen" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Leave &amp; Go to Create / Join Screen
                        </div>
                        <div className="text-[10px] text-rose-600 mt-1">
                          Removes your holdings from this family and opens family setup.
                        </div>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setConfirmLeaveOpen(false)}
                      className="text-[11px] font-bold text-slate-500 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 3. Outgoing Email Gateway (Invites & Rebalance Plans) */}
          <section className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                  Outgoing Email Sender (Invites &amp; Rebalance)
                </h3>
              </div>

              {emailStatus?.configured && emailStatus.senderEmail?.toLowerCase() === "unitywealth.alerts@gmail.com" ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Official: UnityWealth &lt;unitywealth.alerts@gmail.com&gt;
                </span>
              ) : emailStatus?.configured ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Connected: {emailStatus.senderEmail}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-black">
                  ● Not Authorized Yet
                </span>
              )}
            </div>

            {emailStatus?.warning && (
              <p className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200/80 leading-relaxed">
                {emailStatus.warning}
              </p>
            )}

            {emailStatus?.senderEmail?.toLowerCase() !== "unitywealth.alerts@gmail.com" && (
              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-[11px] text-slate-700 space-y-1.5 leading-relaxed">
                <div className="font-black text-indigo-950">
                  Switch Official Global Sender to <span className="font-mono">unitywealth.alerts@gmail.com</span>:
                </div>
                <div>
                  Click the button below, sign in as <strong>unitywealth.alerts@gmail.com</strong>, and tap <strong>Allow</strong> once. All Family Invitations and 24/7 Rebalance Reports will automatically send from <strong>UnityWealth &lt;unitywealth.alerts@gmail.com&gt;</strong>.
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={handleGmailPopup}
                disabled={authGmailBusy}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 text-xs font-bold transition-all flex items-center gap-2 shadow-sm"
              >
                {authGmailBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {emailStatus?.senderEmail?.toLowerCase() === "unitywealth.alerts@gmail.com"
                  ? "Re-authorize unitywealth.alerts@gmail.com"
                  : "Authorize unitywealth.alerts@gmail.com (1-Click)"}
              </button>

              <button
                type="button"
                onClick={() => setShowApiConfig((v) => !v)}
                className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Brevo / Resend API Key
                {showApiConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {emailStatus?.configured && emailStatus.senderEmail?.toLowerCase() !== "unitywealth.alerts@gmail.com" && (
                <button
                  type="button"
                  onClick={() => onSaveProviderConfig({ provider: "disconnect" })}
                  className="px-3 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-bold transition-all"
                >
                  Disconnect
                </button>
              )}
            </div>

            {showApiConfig && (
              <form onSubmit={handleSaveApiKey} className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      Provider
                    </label>
                    <select
                      value={providerType}
                      onChange={(e) => setProviderType(e.target.value as any)}
                      aria-label="Email Provider Type"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800"
                    >
                      <option value="brevo">Brevo HTTPS API (300 free/day to anyone)</option>
                      <option value="resend">Resend HTTPS API</option>
                      <option value="gmail_smtp">Gmail 16-Char App Password</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      Verified Sender Email
                    </label>
                    <input
                      type="email"
                      value={senderEmailInput}
                      onChange={(e) => setSenderEmailInput(e.target.value)}
                      placeholder="you@gmail.com"
                      aria-label="Verified Sender Email"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={
                      providerType === "brevo"
                        ? "xkeysib-..."
                        : providerType === "resend"
                        ? "re_..."
                        : "16-character Google App Password"
                    }
                    aria-label="Email API Key or App Password"
                    className="flex-1 px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-900"
                  />
                  <button
                    type="submit"
                    disabled={savingProvider || !apiKeyInput.trim()}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 shrink-0"
                  >
                    {savingProvider ? "Saving..." : "Save Sender"}
                  </button>
                </div>
              </form>
            )}

            {/* Live Test Email */}
            <form onSubmit={handleRunTestEmail} className="pt-2 border-t border-slate-200/70 flex flex-col sm:flex-row gap-2.5">
              <input
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="Send test email to..."
                aria-label="Test Recipient Email"
                className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-900"
              />
              <button
                type="submit"
                disabled={testingEmail || !testRecipient.trim()}
                className="px-4 py-2 rounded-xl bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
              >
                {testingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send Test Email
              </button>
            </form>

            {emailFeedback && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  emailFeedback.ok
                    ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                    : "bg-amber-50 border border-amber-200 text-amber-900"
                }`}
              >
                <span>{emailFeedback.text}</span>
                {!emailFeedback.ok && emailFeedback.composeUrl && (
                  <a
                    href={emailFeedback.composeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-900 text-white text-[11px] font-bold shrink-0"
                  >
                    Open in Gmail <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
