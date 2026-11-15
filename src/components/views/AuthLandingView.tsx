import React, { useEffect, useState } from 'react';
import { Check, RefreshCcw, Share2, Users, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrandLogo } from '../BrandLogo';
import { Invite } from '../../types';
import { normalizeInviteCode } from '../../shared/formatters';

export function LandingPage({
  onLogin,
  onSignup,
  onForgot,
  onGoogleLogin,
  pendingInviteCode
}: {
  onLogin: (email: string, password: string) => Promise<void> | void;
  onSignup: (email: string, password: string, name: string) => Promise<void> | void;
  onForgot: (email: string) => Promise<boolean>;
  onGoogleLogin: () => void;
  pendingInviteCode?: string;
}) {
  const [activeView, setActiveView] = useState<'login' | 'signup' | 'forgot'>(() =>
    pendingInviteCode ? 'signup' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  useEffect(() => {
    setAuthError(null);
    setResetEmailSent(false);
  }, [activeView]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAuthError(null);
    try {
      if (activeView === 'login') {
        await onLogin(email, password);
      } else if (activeView === 'signup') {
        if (!name.trim()) throw new Error('Please enter your full name.');
        await onSignup(email, password, name.trim());
      } else if (activeView === 'forgot') {
        const ok = await onForgot(email);
        if (ok) setResetEmailSent(true);
      }
    } catch (err: any) {
      const message = err.message || 'An unexpected error occurred';
      setAuthError(message);
      console.error('Auth submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200 overflow-hidden">
        <div className="bg-gradient-to-b from-slate-50 to-white px-6 pt-7 pb-5 sm:px-8 sm:pt-8 sm:pb-6 border-b border-slate-100 flex items-center gap-3.5">
          <BrandLogo size={46} />
          <div className="leading-none">
            <div className="text-2xl tracking-tight">
              <span className="font-extrabold text-slate-900">unity</span>
              <span className="font-semibold text-emerald-600">wealth</span>
            </div>
            <div className="text-[10px] font-bold tracking-[0.18em] text-slate-400 uppercase mt-1.5">
              Portfolio &amp; Rebalancing
            </div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          {pendingInviteCode && (
            <div className="mb-6 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <div className="p-1.5 bg-emerald-600 text-white rounded-lg shrink-0 mt-0.5">
                <Users size={14} />
              </div>
              <div>
                <p className="text-xs font-black text-emerald-900 uppercase tracking-wide">
                  Family Invite Code: {pendingInviteCode}
                </p>
                <p className="text-xs text-emerald-700 mt-0.5 leading-snug">
                  Create an account or log in below to join your shared family portfolio.
                </p>
              </div>
            </div>
          )}
          <h2 className="text-xl font-bold mb-6 text-slate-800">
            {activeView === 'login' && 'Welcome Back'}
            {activeView === 'signup' && 'Create Account'}
            {activeView === 'forgot' && 'Reset Password'}
          </h2>

          <form
            className="space-y-4"
            onSubmit={handleSubmit}
            autoComplete={activeView === 'login' ? 'on' : 'off'}
          >
            <AnimatePresence mode="wait">
              {authError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 bg-rose-50 border border-rose-100 rounded-xl overflow-hidden shadow-sm shadow-rose-100 mb-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      <XCircle className="text-rose-500" size={14} />
                    </div>
                    <p className="text-xs font-bold text-rose-600 leading-tight">
                      {authError}
                      {(authError.includes('already exists') ||
                        authError.includes('associated with a different')) && (
                        <button
                          type="button"
                          onClick={() => setActiveView('login')}
                          className="ml-2 px-2 py-1 bg-rose-100 rounded text-rose-800 hover:bg-rose-200 transition-colors inline-block"
                        >
                          Login Now
                        </button>
                      )}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {resetEmailSent && activeView === 'forgot' && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-start gap-2">
                <Check size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Password reset link sent to <strong>{email}</strong>. Check your inbox (or spam folder) and follow the link to set a new password.
                </span>
              </div>
            )}

            {activeView === 'signup' && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                  Full Name
                </label>
                <input
                  name="name"
                  aria-label="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  type="text"
                  autoComplete="name"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                  placeholder="Himanshu Garg"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                Email Address
              </label>
              <input
                name="email"
                aria-label="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                placeholder="name@company.com"
                required
              />
            </div>

            {(activeView === 'login' || activeView === 'signup') && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase">
                    Password
                  </label>
                  {activeView === 'login' && (
                    <button
                      type="button"
                      onClick={() => setActiveView('forgot')}
                      className="text-xs font-bold text-indigo-600 hover:underline py-1 px-1.5 -my-1 -mr-1.5"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  name="password"
                  aria-label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete={activeView === 'signup' ? 'new-password' : 'current-password'}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                  placeholder="••••••••"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-indigo-600 text-white rounded-xl py-4 font-bold mt-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting && <RefreshCcw size={16} className="animate-spin" />}
              {activeView === 'login' && 'Login to Portfolio'}
              {activeView === 'signup' && 'Get Started'}
              {activeView === 'forgot' && 'Send Password Reset Link'}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-400 font-bold tracking-widest">
                  Or Continue With
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onGoogleLogin}
              className="w-full bg-white border border-slate-200 text-slate-700 rounded-xl py-4 font-bold flex items-center justify-center gap-3 hover:bg-slate-50 transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google Account
            </button>
          </form>

          <div className="mt-6 sm:mt-8 text-center space-y-3">
            <button
              type="button"
              onClick={() => {
                if (activeView === 'login') setActiveView('signup');
                else setActiveView('login');
              }}
              className="text-sm font-bold text-slate-500 hover:text-indigo-600 underline block mx-auto py-2 px-3"
            >
              {activeView === 'login'
                ? "Don't have an account? Sign up"
                : 'Already have an account? Log in'}
            </button>
            {activeView === 'forgot' && (
              <button
                type="button"
                onClick={() => setActiveView('login')}
                className="text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                ← Back to Login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HouseholdSetup({
  onCreate,
  onJoin,
  onJoinByCode,
  isJoining,
  initialCode,
  invites
}: {
  onCreate: (name: string) => void;
  onJoin: (id: string) => void;
  onJoinByCode: (code: string) => void;
  isJoining?: boolean;
  initialCode?: string;
  invites: Invite[];
}) {
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialCode || '');
  const [previewInfo, setPreviewInfo] = useState<{
    householdName: string;
    inviterName: string;
  } | null>(null);

  useEffect(() => {
    if (initialCode && !inviteCode) {
      setInviteCode(initialCode);
    }
  }, [initialCode]);

  useEffect(() => {
    const clean = normalizeInviteCode(inviteCode);
    if (clean.length < 4) {
      setPreviewInfo(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/household/invite-info/${encodeURIComponent(clean)}`, {
          signal: controller.signal
        });
        if (res.ok && !controller.signal.aborted) {
          const info = await res.json();
          setPreviewInfo({ householdName: info.householdName, inviterName: info.inviterName });
        } else if (!controller.signal.aborted) {
          setPreviewInfo(null);
        }
      } catch {
        if (!controller.signal.aborted) setPreviewInfo(null);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [inviteCode]);

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 gap-6 sm:gap-8">
      <div className="flex items-center gap-3 pt-2 sm:pt-0">
        <BrandLogo size={42} />
        <div className="leading-none">
          <div className="text-2xl tracking-tight">
            <span className="font-extrabold text-slate-900">unity</span>
            <span className="font-semibold text-emerald-600">wealth</span>
          </div>
          <div className="text-[9.5px] font-bold tracking-[0.18em] text-slate-400 uppercase mt-1">
            Portfolio &amp; Rebalancing
          </div>
        </div>
      </div>
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8">
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl shadow-slate-200 border border-slate-100 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-5 sm:mb-6">
              <Users />
            </div>
            <h2 className="text-xl font-bold mb-2 text-slate-800">Create a Household</h2>
            <p className="text-sm text-slate-500 mb-6 sm:mb-8 leading-relaxed">
              Start a new combined portfolio for your family. You&apos;ll receive a shareable 6-character code to invite family members.
            </p>
          </div>
          <div className="space-y-4">
            <input
              aria-label="Household Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
              placeholder="The Garg Family"
            />
            <button
              onClick={() => onCreate(name)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-4 font-bold shadow-lg shadow-indigo-100 transition-all"
            >
              Initialize Family Plan
            </button>
          </div>
        </div>

        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl shadow-slate-200 border border-emerald-100 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-5 sm:mb-6">
              <Share2 />
            </div>
            <h2 className="text-xl font-bold mb-2 text-slate-800">Join Existing Family</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Enter the 6-character Family Invite Code from your spouse or family member to merge into a shared dashboard.
            </p>
            <div className="space-y-3">
              <input
                aria-label="Family Invite Code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={12}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-black tracking-[0.2em] uppercase text-center placeholder:font-sans placeholder:text-sm placeholder:font-semibold placeholder:tracking-normal placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="Enter 6-char code (e.g. K7M4P9)"
              />
              {previewInfo && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span>
                    Found <strong>{previewInfo.householdName}</strong> (invited by {previewInfo.inviterName})
                  </span>
                </div>
              )}
              <button
                onClick={() => onJoinByCode(inviteCode)}
                disabled={isJoining || !inviteCode.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl py-4 font-bold shadow-lg shadow-emerald-100 transition-all flex items-center justify-center gap-2"
              >
                {isJoining ? <RefreshCcw size={18} className="animate-spin" /> : <Check size={18} />}
                {isJoining ? 'Joining Family...' : 'Join Family Portfolio'}
              </button>
            </div>
          </div>

          {invites.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-100 space-y-3">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Pending Email Invites
              </div>
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                      Invite to {inv.householdName || 'Family Portfolio'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {inv.inviteCode ? `Code: ${inv.inviteCode}` : 'Pre-approved for your email'}
                    </p>
                  </div>
                  <button
                    onClick={() => onJoin(inv.id)}
                    disabled={isJoining}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-700 transition shadow-sm shrink-0"
                  >
                    JOIN
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
