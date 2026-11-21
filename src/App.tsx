/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  FileUp,
  Globe,
  Landmark,
  Link,
  LogOut,
  Mail,
  Menu,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Share2,
  Trash,
  TrendingUp,
  Users,
  X,
  Zap
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import {
  ChunkedBatchOperation,
  OperationType,
  commitChunkedBatch,
  handleFirestoreError
} from './lib/firebase-utils';
import {
  AssetClass,
  Currency,
  DashboardData,
  EmailStatusPublic,
  Holding,
  HouseholdRewardsBundle,
  Invite,
  NotificationRecord,
  PortfolioTargets,
  RealEstateProperty,
  RsuGrant,
  TaxAcquisitionType,
  TaxLot,
  TaxProfileSettings,
  User,
  WealthSnapshotRecord
} from './types';
import { BrandLogo } from './components/BrandLogo';
import { ThemeToggle } from './components/ThemeToggle';
import { HoldingsExplorer } from './components/HoldingsExplorer';
import { MarketPulseRibbon } from './components/MarketPulseRibbon';
import type { SmartInsightAlert } from './components/NotificationDrawer';
import { LandingPage, HouseholdSetup } from './components/views/AuthLandingView';
import { shortenAssetName } from './lib/formatAssetName';
import { computeHouseholdRealEstateTotals } from './lib/realEstateMath';
import { useTheme } from './lib/useTheme';
import {
  DEFAULT_TAX_PROFILE,
  UpcomingVestEvent,
  buildScheduleFaCsv,
  computePortfolioTaxIntelligence,
  normalizeProviderMatchKey,
  normalizeTickerMatchKey,
  openPrintableFamilyIceSheet
} from './shared/taxAndRsuMath';
import {
  FX_FALLBACK_RATE,
  formatCompactINR,
  getHoldingOwnerId,
  normalizeInviteCode
} from './shared/formatters';
import { DEFAULT_PORTFOLIO_TARGETS, computePortfolioStats } from './shared/portfolioMath';
import { EMPTY_REWARDS_BUNDLE, computeRewardsHubSummary } from './shared/rewardsMath';

// Lazy-loaded heavy tabs & drawers for fast initial Dashboard bundle paint
const WealthJourneyView = lazy(() =>
  import('./components/WealthJourneyView').then((m) => ({ default: m.WealthJourneyView }))
);
const RealEstateView = lazy(() =>
  import('./components/RealEstateView').then((m) => ({ default: m.RealEstateView }))
);
const CardsMilesView = lazy(() =>
  import('./components/CardsMilesView').then((m) => ({ default: m.CardsMilesView }))
);
const RebalanceView = lazy(() => import('./components/views/RebalanceView'));
const TargetManagerView = lazy(() => import('./components/views/TargetManagerView'));
const LiveMarketsView = lazy(() => import('./components/views/LiveMarketsView'));
const QuickAddModal = lazy(() =>
  import('./components/QuickAddModal').then((m) => ({ default: m.QuickAddModal }))
);
const NotificationDrawer = lazy(() =>
  import('./components/NotificationDrawer').then((m) => ({ default: m.NotificationDrawer }))
);
const ProfileFamilyModal = lazy(() =>
  import('./components/ProfileFamilyModal').then((m) => ({ default: m.ProfileFamilyModal }))
);

function generateClientInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function ViewLoadingFallback() {
  return (
    <div className="py-20 flex items-center justify-center">
      <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-indigo-600"></div>
    </div>
  );
}

export default function App() {
  const { theme, setTheme, isDark } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<any>(null);
  const [holdingsList, setHoldingsList] = useState<Holding[] | null>(null);
  const [fxRates, setFxRates] = useState<Record<string, number>>({ INR: FX_FALLBACK_RATE, USD: 1.0 });
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'wealth' | 'targets' | 'accounts' | 'liveMarkets' | 'rebalance' | 'realEstate' | 'cardsMiles'
  >('dashboard');
  const [dashboardView, setDashboardView] = useState<'combined' | string>('combined');
  const [realEstateProperties, setRealEstateProperties] = useState<RealEstateProperty[] | null>(null);
  const [rewardsBundle, setRewardsBundle] = useState<HouseholdRewardsBundle>(EMPTY_REWARDS_BUNDLE);
  const [taxLots, setTaxLots] = useState<TaxLot[]>([]);
  const [rsuGrants, setRsuGrants] = useState<RsuGrant[]>([]);
  const [taxProfile, setTaxProfile] = useState<TaxProfileSettings>(DEFAULT_TAX_PROFILE);
  const holdingsSectionRef = useRef<HTMLDivElement | null>(null);
  const [showPropertyInDashboard, setShowPropertyInDashboard] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showJoinByCodeModal, setShowJoinByCodeModal] = useState(false);
  const [wealthSnapshots, setWealthSnapshots] = useState<WealthSnapshotRecord[]>([]);
  const [isRecordingSnapshot, setIsRecordingSnapshot] = useState(false);
  const [appNotifications, setAppNotifications] = useState<NotificationRecord[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddInitialMode, setQuickAddInitialMode] = useState<'search' | 'preset' | 'upload'>('search');
  const [quickAddInitialQuery, setQuickAddInitialQuery] = useState<string>('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileModalSection, setProfileModalSection] = useState<'profile' | 'family' | 'email'>('profile');
  const [emailStatus, setEmailStatus] = useState<EmailStatusPublic | null>(null);
  const [lastInviteResult, setLastInviteResult] = useState<{
    sent: boolean;
    email: string;
    senderEmail?: string;
    error?: string;
    gmailComposeUrl?: string;
    mailtoUrl?: string;
  } | null>(null);
  const autoSnapDoneRef = useRef<string>('');
  const memberDocCacheRef = useRef<Map<string, any>>(new Map());
  const reMigratedRef = useRef<string>('');

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isJoiningFamily, setIsJoiningFamily] = useState(false);
  const [householdInviteCode, setHouseholdInviteCode] = useState<string>('');
  const [copiedInviteField, setCopiedInviteField] = useState<'code' | 'link' | null>(null);
  const [pendingInviteCode, setPendingInviteCode] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCode = normalizeInviteCode(params.get('invite') || params.get('join') || '');
      if (urlCode) {
        sessionStorage.setItem('uw_pending_invite', urlCode);
        return urlCode;
      }
      return sessionStorage.getItem('uw_pending_invite') || '';
    } catch {
      return '';
    }
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'refreshed' | 'error' | 'info';
  } | null>(null);
  const [detailView, setDetailView] = useState<{
    title: string;
    filter: (h: Holding) => boolean;
    categoryContext?: any;
    totalForeignVal?: number;
  } | null>(null);

  // Derived DashboardData combining independent household & holdings streams without listener churn
  const data = useMemo<DashboardData | null>(() => {
    if (!household || !holdingsList) return null;
    return { household, holdings: holdingsList };
  }, [household, holdingsList]);

  useEffect(() => {
    if (notification) {
      const duration = notification.type === 'error' ? 9000 : 5000;
      const timer = setTimeout(() => setNotification(null), duration);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
            if (userDoc.exists()) {
              const profile = { id: firebaseUser.uid, ...userDoc.data() } as User;
              memberDocCacheRef.current.set(firebaseUser.uid, profile);
              setUser(profile);
            } else {
              const userEmail = (firebaseUser.email || '').toLowerCase();
              const userName =
                firebaseUser.displayName || (userEmail ? userEmail.split('@')[0] : 'Family Member');
              const newUser = {
                email: userEmail,
                name: userName,
                householdId: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
              const profile = { id: firebaseUser.uid, ...newUser } as User;
              memberDocCacheRef.current.set(firebaseUser.uid, profile);
              setUser(profile);
            }
          } catch (e: any) {
            console.error('Error fetching user profile', e);
            const fallbackEmail = (firebaseUser.email || '').toLowerCase();
            const fallbackName =
              firebaseUser.displayName || (fallbackEmail ? fallbackEmail.split('@')[0] : 'Family Member');
            setUser({ id: firebaseUser.uid, email: fallbackEmail, name: fallbackName } as User);
          }
        } else {
          setUser(null);
          setHousehold(null);
          setHoldingsList(null);
        }
        setLoading(false);
      },
      (error) => {
        console.error('Auth state change error', error);
        setNotification({ message: 'Authentication service error. Please try again.', type: 'error' });
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id || user.householdId) {
      setInvites([]);
      return;
    }

    const q = query(
      collection(db, 'invites'),
      where('toEmail', '==', user.email.toLowerCase()),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const invs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Invite));
        setInvites(invs);
      },
      (err) => {
        if (auth.currentUser) handleFirestoreError(err, OperationType.LIST, 'invites');
      }
    );

    return () => unsubscribe();
  }, [user?.id, user?.email, user?.householdId]);

  // Listener for Household Data (with cached member resolution avoiding N+1 user doc reads)
  useEffect(() => {
    if (!user?.householdId) {
      setHousehold(null);
      setHouseholdInviteCode('');
      return;
    }

    const unsubHH = onSnapshot(
      doc(db, 'households', user.householdId),
      async (hhSnap) => {
        if (!hhSnap.exists()) {
          setHousehold(null);
          return;
        }
        const hhData = hhSnap.data();
        const cachedProfiles: Record<string, any> = hhData.settings?.memberProfiles || {};

        const realMembersData = await Promise.all(
          (hhData.members || []).map(async (mId: string) => {
            if (cachedProfiles[mId]?.name) {
              const prof = { id: mId, ...cachedProfiles[mId] };
              memberDocCacheRef.current.set(mId, prof);
              return prof;
            }
            const memCached = memberDocCacheRef.current.get(mId);
            if (memCached?.name) {
              return memCached;
            }
            try {
              const uDoc = await getDoc(doc(db, 'users', mId));
              if (uDoc.exists()) {
                const fetched = { id: mId, ...uDoc.data() };
                memberDocCacheRef.current.set(mId, fetched);
                return fetched;
              }
            } catch {
              // Fall through to cached profile if user doc is still syncing
            }
            return cachedProfiles[mId] ? { id: mId, ...cachedProfiles[mId] } : null;
          })
        );

        const manualMembers: any[] = Array.isArray(hhData.settings?.manualMembers)
          ? hhData.settings.manualMembers
          : [];
        const seenIds = new Set<string>();
        const mergedMembers: any[] = [];
        [...realMembersData.filter(Boolean), ...manualMembers].forEach((m: any) => {
          if (m?.id && !seenIds.has(m.id)) {
            seenIds.add(m.id);
            mergedMembers.push(m);
          }
        });

        const storedCode = hhData.settings?.inviteCode || '';
        if (storedCode) {
          setHouseholdInviteCode(storedCode);
        }

        setHousehold({ ...hhData, id: hhSnap.id, membersData: mergedMembers });
      },
      (err) => {
        if (auth.currentUser) handleFirestoreError(err, OperationType.GET, `households/${user.householdId}`);
      }
    );

    return () => unsubHH();
  }, [user?.householdId]);

  // Ensure household has a persistent 6-char invite code & keep server invite registry synced
  useEffect(() => {
    if (!user?.householdId || !household?.id || !auth.currentUser) return;
    let cancelled = false;

    const syncHouseholdInviteCode = async () => {
      try {
        const fbUser = auth.currentUser;
        if (!fbUser) return;
        const idToken = await fbUser.getIdToken();
        let preferredCode = household.settings?.inviteCode || '';
        if (!preferredCode) {
          preferredCode = generateClientInviteCode();
          await updateDoc(doc(db, 'households', household.id), {
            settings: {
              ...(household.settings || {}),
              inviteCode: preferredCode
            }
          });
        }
        const res = await fetch('/api/household/invite-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            householdId: household.id,
            householdName: household.name,
            inviterName: user.name,
            refreshToken: fbUser.refreshToken,
            preferredCode
          })
        });
        if (res.ok && !cancelled) {
          const info = await res.json();
          if (info.code) {
            setHouseholdInviteCode(info.code);
          }
        }
      } catch (err) {
        console.warn('Invite code sync warning:', err);
      }
    };

    syncHouseholdInviteCode();
    return () => {
      cancelled = true;
    };
  }, [user?.householdId, household?.id, household?.name, household?.settings?.inviteCode]);

  // Listener for Holdings Data — depends strictly on householdId (zero teardown churn on household edits)
  useEffect(() => {
    if (!user?.householdId) {
      setHoldingsList(null);
      return;
    }

    const holdingsQuery = query(
      collection(db, 'holdings'),
      where('householdId', '==', user.householdId)
    );
    const unsubHoldings = onSnapshot(
      holdingsQuery,
      (hgSnap) => {
        const nextHoldings = hgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Holding));
        setHoldingsList(nextHoldings);
        setLoading(false);
      },
      (err) => {
        if (auth.currentUser) handleFirestoreError(err, OperationType.LIST, 'holdings');
      }
    );

    return () => unsubHoldings();
  }, [user?.householdId]);

  const fetchEmailStatus = async (hhId?: string | null) => {
    try {
      const targetHh = hhId ?? user?.householdId ?? '';
      const q = targetHh ? `?householdId=${encodeURIComponent(targetHh)}` : '';
      const res = await fetch(`/api/email/status${q}`);
      if (res.ok) {
        const st = await res.json();
        setEmailStatus(st);
      }
    } catch {
      // non-fatal
    }
  };

  const mainScrollRef = useRef<HTMLDivElement>(null);

  const fetchFxRates = async () => {
    try {
      const res = await fetch('/api/fx-rates');
      if (res.ok) {
        const json = await res.json();
        setFxRates(json);
      }
    } catch {
      setFxRates({ INR: FX_FALLBACK_RATE, USD: 1.0 });
    }
  };

  useEffect(() => {
    fetchFxRates();
  }, []);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeTab]);

  useEffect(() => {
    fetchEmailStatus(user?.householdId);
  }, [user?.householdId]);

  useEffect(() => {
    const handleConnected = (senderEmail?: string) => {
      fetchEmailStatus(user?.householdId);
      setNotification({
        message: `Gmail sender connected (${senderEmail || 'Authorized'})! Invites & rebalance alerts are now live.`,
        type: 'success'
      });
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev?.data?.type === 'OAUTH_EMAIL_CONNECTED') {
        handleConnected(ev.data.senderEmail);
      }
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'uw_email_oauth_event' && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue);
          if (parsed?.type === 'OAUTH_EMAIL_CONNECTED') {
            handleConnected(parsed.senderEmail);
          }
        } catch {}
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('uw_email_oauth');
        bc.onmessage = (ev) => {
          if (ev?.data?.type === 'OAUTH_EMAIL_CONNECTED') {
            handleConnected(ev.data.senderEmail);
          }
        };
      }
    } catch {}

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('emailConnected') === '1') {
        params.delete('emailConnected');
        const next = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
        window.history.replaceState({}, '', next);
        handleConnected();
      }
    } catch {}
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      try {
        bc?.close();
      } catch {}
    };
  }, [user?.householdId]);

  const handleGoogleAuth = async () => {
    setLoading(true);
    setNotification(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const fbUser = result.user;

      setNotification({
        message: `Welcome, ${fbUser.displayName || fbUser.email || 'User'}!`,
        type: 'success'
      });
      setShowSyncModal(false);
    } catch (e: any) {
      setLoading(false);
      console.error('Google Auth error:', e);
      let msg = e.message;
      if (e.code === 'auth/popup-blocked') {
        msg =
          'Pop-up was blocked by your browser. Please allow pop-ups for this site, or sign in using Email & Password.';
      } else if (e.code === 'auth/unauthorized-domain') {
        msg = `Domain "${window.location.hostname}" is not yet added under Firebase Console → Authentication → Settings → Authorized domains. Sign in with Email & Password right away, or add "${window.location.hostname}" for Google Sign-In.`;
      } else if (e.code === 'auth/account-exists-with-different-credential') {
        msg =
          'This email is already associated with a password login. Please sign in using your email and password.';
      } else if (e.code === 'auth/popup-closed-by-user') {
        msg = 'Google sign-in was closed before completion.';
      } else if (e.code === 'auth/cancelled-popup-request') {
        msg = 'Another sign-in pop-up was already opened.';
      }
      setNotification({ message: msg, type: 'error' });
    }
  };

  const connectGoogleOfflineOAuth = async () => {
    const q = new URLSearchParams({
      householdId: user?.householdId || '',
      userId: user?.id || ''
    });
    const res = await fetch(`/api/auth/google/url?${q.toString()}`);
    if (!res.ok) throw new Error('Google OAuth is not configured on this server.');
    const { url } = await res.json();
    const w = 520;
    const h = 640;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(
      url,
      'uw_google_oauth',
      `width=${w},height=${h},left=${left},top=${top}`
    );
    if (!popup) {
      window.location.href = url;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (ok: boolean, err?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (ok) resolve();
        else reject(new Error(err || 'Gmail authorization window was closed before completion.'));
      };

      let bc: BroadcastChannel | null = null;
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          bc = new BroadcastChannel('uw_email_oauth');
          bc.onmessage = (ev) => {
            if (ev?.data?.type === 'OAUTH_EMAIL_CONNECTED') done(true);
          };
        }
      } catch {}

      const onMsg = (ev: MessageEvent) => {
        if (ev?.data?.type === 'OAUTH_EMAIL_CONNECTED') done(true);
      };
      window.addEventListener('message', onMsg);

      const poll = window.setInterval(async () => {
        try {
          const stRes = await fetch(
            `/api/email/status?householdId=${encodeURIComponent(user?.householdId || '')}`
          );
          if (stRes.ok) {
            const st = await stRes.json();
            if (st?.configured) {
              setEmailStatus(st);
              done(true);
              return;
            }
          }
        } catch {}
      }, 2500);

      const timeout = window.setTimeout(() => done(false, 'Gmail authorization timed out.'), 180000);

      function cleanup() {
        window.removeEventListener('message', onMsg);
        window.clearInterval(poll);
        window.clearTimeout(timeout);
        try {
          bc?.close();
        } catch {}
      }
    });
  };

  const authorizeGmailViaPopup = async () => {
    if (!auth.currentUser) throw new Error('Please sign in first.');
    await connectGoogleOfflineOAuth();
  };

  const handleSaveEmailProviderConfig = async (cfg: {
    provider: 'brevo' | 'resend' | 'gmail_smtp' | 'disconnect';
    senderEmail?: string;
    apiKey?: string;
  }) => {
    if (!auth.currentUser) throw new Error('Please sign in first.');
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/email/configure-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        householdId: user?.householdId || null,
        ...cfg
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to configure email provider');
    if (json.status) setEmailStatus(json.status);
  };

  const handleSendTestEmailTo = async (recipientEmail: string) => {
    const res = await fetch('/api/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: recipientEmail,
        householdId: user?.householdId || null
      })
    });
    return await res.json();
  };

  const [isParsing, setIsParsing] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [selectedImportProvider, setSelectedImportProvider] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFilePayload = (
    file: File
  ): Promise<{ content: string; isPDF: boolean; isSpreadsheet: boolean }> =>
    new Promise((resolve, reject) => {
      const lowerName = (file.name || '').toLowerCase();
      const lowerType = (file.type || '').toLowerCase();
      const isPDF = lowerType === 'application/pdf' || lowerName.endsWith('.pdf');
      const isSpreadsheet =
        !isPDF &&
        (lowerName.endsWith('.xlsx') ||
          lowerName.endsWith('.xls') ||
          lowerName.endsWith('.ods') ||
          lowerType.includes('spreadsheet') ||
          lowerType.includes('excel'));
      const reader = new FileReader();
      reader.onload = (ev) => {
        const raw = String(ev.target?.result || '');
        resolve({
          content: isPDF || isSpreadsheet ? raw.split(',')[1] || '' : raw,
          isPDF,
          isSpreadsheet
        });
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      if (isPDF || isSpreadsheet) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });

  const pushHouseholdNotification = async (payload: {
    category: 'import' | 'family' | 'milestone' | 'drift' | 'system';
    severity: 'info' | 'success' | 'warning';
    title: string;
    message: string;
    actionTab?: string;
  }) => {
    if (!user?.householdId || !auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/notifications/${user.householdId}/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.notification) {
          setAppNotifications((prev) => [json.notification, ...prev]);
        }
      }
    } catch {
      // non-fatal
    }
  };

  const processFilesBatch = async (
    rawFiles: FileList | File[],
    ownerMemberId: string,
    providerHint?: string | null
  ) => {
    const fileArray = Array.from(rawFiles || []);
    if (fileArray.length === 0 || !user) return;
    const resolvedOwner =
      !ownerMemberId || ownerMemberId === 'combined' ? user.id : ownerMemberId;

    setIsParsing(true);
    setShowSyncModal(false);

    let totalImported = 0;
    const importedProviders: string[] = [];
    let lastError = '';
    let workingExisting = [...(data?.holdings || [])];

    try {
      if (user.householdId && auth.currentUser) {
        const uRef = doc(db, 'users', user.id);
        const uSnap = await getDoc(uRef);
        if (!uSnap.exists()) {
          await setDoc(uRef, {
            email: (user.email || auth.currentUser.email || '').toLowerCase(),
            name: user.name || auth.currentUser.displayName || 'Investor',
            householdId: user.householdId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } else if (uSnap.data()?.householdId !== user.householdId) {
          await updateDoc(uRef, { householdId: user.householdId });
        }
      }

      for (const file of fileArray) {
        const { content, isPDF, isSpreadsheet } = await readFilePayload(file);
        const res = await fetch('/api/gemini/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            isPDF,
            isSpreadsheet,
            fileName: file.name,
            providerHint: providerHint || undefined
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastError = err.error || `Failed to extract holdings from ${file.name}`;
          continue;
        }

        const extractedPayload = await res.json();
        const holdings: any[] = Array.isArray(extractedPayload)
          ? extractedPayload
          : extractedPayload?.holdings || [];
        const extractedUnvestedGrants: any[] = !Array.isArray(extractedPayload) && Array.isArray(extractedPayload?.unvestedGrants)
          ? extractedPayload.unvestedGrants
          : [];
        const detectedProvider: string =
          providerHint || (!Array.isArray(extractedPayload) && extractedPayload?.provider) || 'CAMS';
        const warningMsg: string | undefined = !Array.isArray(extractedPayload)
          ? extractedPayload?.warning
          : undefined;

        if (holdings.length === 0 && extractedUnvestedGrants.length === 0) {
          lastError = warningMsg || `No active open holdings (> 0 units) were found in ${file.name}.`;
          continue;
        }

        const incomingProviders = new Set<string>(
          holdings.map((h: any) => String(h.provider || detectedProvider || 'CAMS'))
        );

        if (user.householdId && auth.currentUser) {
          const ops: ChunkedBatchOperation[] = [];
          const remainingExisting: Holding[] = [];
          workingExisting.forEach((existingH) => {
            const existingOwner = getHoldingOwnerId(existingH);
            const docProvider = String(existingH.provider || 'CAMS');
            if (
              holdings.length > 0 &&
              existingOwner === resolvedOwner &&
              existingH.source === 'PDF' &&
              incomingProviders.has(docProvider) &&
              existingH.id &&
              !String(existingH.id).startsWith('placeholder-')
            ) {
              ops.push({ type: 'delete', ref: doc(db, 'holdings', existingH.id) });
            } else {
              remainingExisting.push(existingH);
            }
          });

          const createdDocs: Holding[] = [];
          const autoExtractedLots: TaxLot[] = [];

          holdings.forEach((h: any) => {
            const id = 'h_' + Math.random().toString(36).slice(2, 11);
            const cleanTicker = String(h.ticker || h.schemeName || 'MF').slice(0, 50);
            const cleanProvider = String(h.provider || detectedProvider || 'CAMS');
            const cleanCurrency: Currency = h.currency === 'USD' ? 'USD' : 'INR';
            const docObj: any = {
              userId: user.id,
              ownerId: resolvedOwner,
              householdId: user.householdId,
              ticker: cleanTicker,
              quantity: Number(h.units) || 0,
              assetClass: h.assetClass || 'Mutual Fund',
              currency: cleanCurrency,
              provider: cleanProvider,
              source: 'PDF',
              currentPrice: Number(h.nav) || 0,
              originalName: h.originalName || h.schemeName || '',
              syncedAt: Date.now()
            };
            ops.push({ type: 'set', ref: doc(db, 'holdings', id), data: docObj });
            createdDocs.push({ id, ...docObj });

            if (Array.isArray(h.lots) && h.lots.length > 0) {
              h.lots.forEach((rawLot: any) => {
                if (rawLot?.acquiredDate && Number(rawLot.units) > 0) {
                  autoExtractedLots.push({
                    id: 'lot_' + Math.random().toString(36).slice(2, 10),
                    householdId: user.householdId!,
                    holdingId: id,
                    ownerId: resolvedOwner,
                    ticker: cleanTicker,
                    provider: cleanProvider,
                    acquiredDate: String(rawLot.acquiredDate),
                    quantity: Number(rawLot.units),
                    costPerUnit: Number(rawLot.costPerUnit) || Number(h.nav) || 0,
                    currency: cleanCurrency,
                    acquisitionType: rawLot.acquisitionType || (cleanProvider === 'E*TRADE' ? 'RSU Vest' : 'Market Buy'),
                    updatedAt: Date.now()
                  });
                }
              });
            }
          });

          if (ops.length > 0) {
            await commitChunkedBatch(db, ops);
            workingExisting = [...remainingExisting, ...createdDocs];
            totalImported += holdings.length;
          }

          // Persist any extracted Tax Lots or Unvested RSU Schedules automatically
          if (autoExtractedLots.length > 0 || extractedUnvestedGrants.length > 0) {
            const incomingTickerProviderKeys = new Set(
              autoExtractedLots.map(
                (l) => `${l.ownerId}|${normalizeTickerMatchKey(l.ticker)}|${normalizeProviderMatchKey(l.provider)}`
              )
            );
            const keptLots = taxLots.filter(
              (l) =>
                !incomingTickerProviderKeys.has(
                  `${l.ownerId}|${normalizeTickerMatchKey(l.ticker)}|${normalizeProviderMatchKey(l.provider)}`
                )
            );
            const nextLots = [...keptLots, ...autoExtractedLots];

            const mappedGrants: RsuGrant[] = extractedUnvestedGrants.map((g: any) => ({
              id: 'rsu_' + Math.random().toString(36).slice(2, 10),
              householdId: user.householdId!,
              ownerId: resolvedOwner,
              ticker: String(g.ticker || 'QCOM').toUpperCase(),
              grantName: String(g.grantName || `${g.ticker} RSU Grant`),
              currency: 'USD',
              provider: String(g.provider || detectedProvider || 'E*TRADE'),
              withholdingTaxPct: 35.88,
              vestSchedule: (g.vestSchedule || []).map((v: any) => ({
                id: 'vst_' + Math.random().toString(36).slice(2, 9),
                vestDate: String(v.vestDate),
                grossUnits: Number(v.grossUnits) || 0,
                vested: false
              })),
              updatedAt: Date.now()
            }));
            const nextGrants = [...rsuGrants, ...mappedGrants];

            setTaxLots(nextLots);
            if (mappedGrants.length > 0) setRsuGrants(nextGrants);

            const idToken = await auth.currentUser.getIdToken();
            await fetch(`/api/tax-planning/${user.householdId}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`
              },
              body: JSON.stringify({
                taxLots: nextLots,
                ...(mappedGrants.length > 0 ? { rsuGrants: nextGrants } : {})
              })
            }).catch(() => {});

            if (holdings.length === 0 && mappedGrants.length > 0) {
              setNotification({
                message: `Imported ${mappedGrants.length} unvested RSU grant schedule(s) into Future RSU Forecast!`,
                type: 'success'
              });
            }
          }

          if (holdings.length > 0 && !importedProviders.includes(detectedProvider)) {
            importedProviders.push(detectedProvider);
          }
        }
      }

      if (totalImported > 0) {
        const targetMemberName = data?.household?.membersData?.find(
          (m: any) => m.id === resolvedOwner
        )?.name;
        const providersLabel = importedProviders.join(' + ') || 'Statement';
        setNotification({
          message: `Imported ${totalImported} ${
            totalImported === 1 ? 'holding' : 'holdings'
          } from ${providersLabel}${
            targetMemberName ? ` for ${targetMemberName}` : ''
          } with live prices!`,
          type: 'refreshed'
        });
        autoSnapDoneRef.current = '';
        pushHouseholdNotification({
          category: 'import',
          severity: 'success',
          title: `Statement Synced: ${providersLabel}`,
          message: `Imported ${totalImported} active ${
            totalImported === 1 ? 'holding' : 'holdings'
          }${targetMemberName ? ` for ${targetMemberName}` : ''} with live market prices.`,
          actionTab: 'wealth'
        });
      } else if (lastError) {
        setNotification({ message: lastError, type: 'error' });
      }
    } catch (parseError: any) {
      console.error('Upload process error:', parseError);
      setNotification({ message: parseError.message || 'Error parsing statement', type: 'error' });
    } finally {
      setIsParsing(false);
      setTargetUserId(null);
      setSelectedImportProvider(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !user || !targetUserId) return;
    await processFilesBatch(files, targetUserId, selectedImportProvider);
  };

  const openQuickAdd = (mode: 'search' | 'preset' | 'upload' = 'search', tickerQuery = '') => {
    setQuickAddInitialMode(mode);
    setQuickAddInitialQuery(tickerQuery);
    setShowQuickAddModal(true);
  };

  const handleQuickSaveHolding = async (payload: {
    ownerId: string;
    ticker: string;
    originalName: string;
    quantity: number;
    currentPrice: number;
    currency: Currency;
    assetClass: AssetClass;
    provider: string;
    source: 'Manual' | 'Live';
    initialLot?: {
      acquiredDate: string;
      costPerUnit: number;
      acquisitionType: TaxAcquisitionType;
    };
  }) => {
    if (!user?.householdId) return;
    const resolvedOwner =
      !payload.ownerId || payload.ownerId === 'combined' ? user.id : payload.ownerId;
    const upperTicker = (payload.ticker || 'MANUAL').toUpperCase().slice(0, 50);
    let resolvedCurrency: Currency = payload.currency || 'INR';
    if (upperTicker.endsWith('.NS') || upperTicker.endsWith('.BO')) {
      resolvedCurrency = 'INR';
    }
    const id = 'h_' + Math.random().toString(36).slice(2, 11);
    await setDoc(doc(db, 'holdings', id), {
      userId: user.id,
      ownerId: resolvedOwner,
      householdId: user.householdId,
      ticker: upperTicker,
      originalName: payload.originalName || upperTicker,
      quantity: Number(payload.quantity) || 0,
      assetClass: payload.assetClass || 'Equity',
      currency: resolvedCurrency,
      provider: payload.provider || 'Manual',
      source: payload.source === 'Live' ? 'Manual' : payload.source,
      currentPrice: Number(payload.currentPrice) || 0,
      syncedAt: Date.now()
    });

    if (payload.initialLot?.acquiredDate && auth.currentUser) {
      const createdLot: TaxLot = {
        id: 'lot_' + Math.random().toString(36).slice(2, 10),
        householdId: user.householdId,
        holdingId: id,
        ownerId: resolvedOwner,
        ticker: upperTicker,
        provider: payload.provider || 'Manual',
        acquiredDate: payload.initialLot.acquiredDate,
        quantity: Number(payload.quantity) || 0,
        costPerUnit: Number(payload.initialLot.costPerUnit) || Number(payload.currentPrice) || 0,
        currency: resolvedCurrency,
        fxRateAtBuy: resolvedCurrency === 'USD' ? fxRates.INR : undefined,
        acquisitionType: payload.initialLot.acquisitionType || 'Market Buy',
        updatedAt: Date.now()
      };
      const nextLots = [...taxLots, createdLot];
      setTaxLots(nextLots);
      const idToken = await auth.currentUser.getIdToken();
      fetch(`/api/tax-planning/${user.householdId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ taxLots: nextLots })
      }).catch(() => {});
    }
    autoSnapDoneRef.current = '';
    const memberName = data?.household?.membersData?.find(
      (m: any) => m.id === resolvedOwner
    )?.name;
    setNotification({
      message: `Added ${shortenAssetName(payload.originalName || upperTicker, upperTicker)}${
        memberName ? ` for ${memberName}` : ''
      }!`,
      type: 'success'
    });
  };

  const triggerUpload = (memberId: string, providerHint?: string) => {
    const resolvedMember = !memberId || memberId === 'combined' ? user?.id : memberId;
    if (!resolvedMember) {
      alert('Please sign in first.');
      return;
    }
    setTargetUserId(resolvedMember);
    setSelectedImportProvider(providerHint || null);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  };

  const login = async (email: string, pass: string) => {
    setLoading(true);
    setNotification(null);
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      setNotification({ message: 'Welcome back!', type: 'success' });
    } catch (e: any) {
      setLoading(false);
      let msg = 'Error logging in';
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential')
        msg = 'Invalid email or password. Please check your credentials.';
      else if (e.code === 'auth/wrong-password') msg = 'Incorrect password.';
      else if (e.code === 'auth/too-many-requests')
        msg = 'Too many failed attempts. Please try again later.';
      else if (e.code === 'auth/network-request-failed')
        msg = 'Network error. Please check your connection.';
      else if (e.code === 'auth/operation-not-allowed')
        msg =
          'Email/Password sign-in is not enabled in the Firebase Console. Please enable it in the Authentication tab.';
      else msg = e.message || msg;

      setNotification({ message: msg, type: 'error' });
      throw new Error(msg);
    }
  };

  const signup = async (email: string, pass: string, name: string) => {
    setLoading(true);
    setNotification(null);
    try {
      const res = await createUserWithEmailAndPassword(auth, email, pass);
      const fbUser = res.user;

      const newUser = {
        email: email.toLowerCase(),
        name,
        householdId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'users', fbUser.uid), newUser);
      setNotification({ message: 'Signup successful! Welcome to UnityWealth.', type: 'success' });
    } catch (e: any) {
      setLoading(false);
      let msg = 'Error signing up';
      if (e.code === 'auth/email-already-in-use')
        msg = 'An account already exists with this email address. Please log in instead.';
      else if (e.code === 'auth/weak-password')
        msg = 'Password is too weak. Please use at least 6 characters.';
      else if (e.code === 'auth/invalid-email') msg = 'Please enter a valid email address.';
      else if (e.code === 'auth/operation-not-allowed')
        msg =
          'Email/Password sign-in is not enabled in the Firebase Console. Please enable it in the Authentication tab.';
      else msg = e.message || msg;

      setNotification({ message: msg, type: 'error' });
      throw new Error(msg);
    }
  };

  const forgotPassword = async (email: string): Promise<boolean> => {
    const clean = email.trim().toLowerCase();
    if (!clean) return false;
    try {
      await sendPasswordResetEmail(auth, clean);
      setNotification({
        message: `Password reset link sent to ${clean}! Check your email inbox.`,
        type: 'success'
      });
      return true;
    } catch (e: any) {
      const msg =
        e?.code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : e?.message || 'Unable to send password reset email.';
      setNotification({ message: msg, type: 'error' });
      throw new Error(msg);
    }
  };

  const createHousehold = async (name: string) => {
    if (!user) return;
    const trimmedName = (name || '').trim() || `${user.name.split(' ')[0]}'s Family`;
    setLoading(true);
    try {
      const hhId = 'h_' + Math.random().toString(36).slice(2, 11);
      const inviteCode = generateClientInviteCode();
      const householdData = {
        name: trimmedName,
        members: [user.id],
        settings: {
          inviteCode,
          memberProfiles: {
            [user.id]: { id: user.id, name: user.name, email: user.email }
          }
        },
        targets: {
          assetSplit: { Equity: 0.7, Debt: 0.3 },
          equitySplit: { Indian: 0.6, Foreign: 0.4 },
          foreignBreakdown: DEFAULT_PORTFOLIO_TARGETS.foreignBreakdown
        }
      };
      await setDoc(doc(db, 'households', hhId), householdData);
      await updateDoc(doc(db, 'users', user.id), { householdId: hhId });
      setHouseholdInviteCode(inviteCode);
      setUser((prev) => (prev ? { ...prev, householdId: hhId } : null));
    } catch (e: any) {
      handleFirestoreError(e, OperationType.CREATE, 'households');
    } finally {
      setLoading(false);
    }
  };

  const clearPendingInviteParam = () => {
    setPendingInviteCode('');
    try {
      sessionStorage.removeItem('uw_pending_invite');
      const url = new URL(window.location.href);
      if (url.searchParams.has('invite') || url.searchParams.has('join')) {
        url.searchParams.delete('invite');
        url.searchParams.delete('join');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    } catch {
      // ignore
    }
  };

  const redeemInviteCode = async (
    rawCode: string,
    fallbackHouseholdId?: string,
    firestoreInviteId?: string
  ) => {
    if (!user || !auth.currentUser) return;
    const cleanCode = normalizeInviteCode(rawCode);
    if (!cleanCode && !fallbackHouseholdId) {
      setNotification({ message: 'Please enter a valid Family Invite Code.', type: 'error' });
      return;
    }

    setIsJoiningFamily(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const oldHouseholdId = user.householdId;
      const previousOwnHoldings = (data?.holdings || []).filter(
        (h) => h.userId === user.id && !(h as any).isPlaceholder
      );

      const res = await fetch('/api/household/redeem-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          code: cleanCode || undefined,
          householdId: fallbackHouseholdId
        })
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to join family household');
      }

      const targetHhId: string = payload.householdId;
      const targetHhName: string = payload.householdName || 'Family Portfolio';

      await updateDoc(doc(db, 'users', user.id), { householdId: targetHhId });

      try {
        const hhRef = doc(db, 'households', targetHhId);
        const hhSnap = await getDoc(hhRef);
        if (hhSnap.exists()) {
          const existingSettings = hhSnap.data().settings || {};
          await updateDoc(hhRef, {
            settings: {
              ...existingSettings,
              memberProfiles: {
                ...(existingSettings.memberProfiles || {}),
                [user.id]: { id: user.id, name: user.name, email: user.email }
              }
            }
          });
        }
      } catch (profileSyncErr) {
        console.warn('Member profile sync warning:', profileSyncErr);
      }

      if (firestoreInviteId) {
        try {
          await updateDoc(doc(db, 'invites', firestoreInviteId), { status: 'accepted' });
        } catch {
          // non-fatal
        }
      }

      if (oldHouseholdId && oldHouseholdId !== targetHhId && previousOwnHoldings.length > 0) {
        try {
          const migOps: ChunkedBatchOperation[] = [];
          previousOwnHoldings.forEach((oldH) => {
            const newId = 'h_' + Math.random().toString(36).slice(2, 11);
            migOps.push({
              type: 'set',
              ref: doc(db, 'holdings', newId),
              data: {
                userId: user.id,
                ownerId: user.id,
                householdId: targetHhId,
                ticker: oldH.ticker,
                quantity: oldH.quantity,
                assetClass: oldH.assetClass,
                currency: oldH.currency,
                provider: oldH.provider || 'Manual',
                source: oldH.source || 'PDF',
                currentPrice: oldH.currentPrice || 0,
                originalName: oldH.originalName || oldH.ticker,
                syncedAt: Date.now()
              }
            });
            if (oldH.id) {
              migOps.push({ type: 'delete', ref: doc(db, 'holdings', oldH.id) });
            }
          });
          await commitChunkedBatch(db, migOps);
        } catch (migErr) {
          console.warn('Holding migration skipped:', migErr);
        }
      }

      clearPendingInviteParam();
      setShowJoinByCodeModal(false);
      setJoinCodeInput('');
      setDashboardView('combined');
      setActiveTab('dashboard');
      setUser((prev) => (prev ? { ...prev, householdId: targetHhId } : null));
      setNotification({
        message: `Welcome to ${targetHhName}! Combined family view is now active.`,
        type: 'success'
      });
    } catch (e: any) {
      console.error('Join family error:', e);
      setNotification({ message: e.message || 'Could not join family portfolio.', type: 'error' });
    } finally {
      setIsJoiningFamily(false);
      setLoading(false);
    }
  };

  const joinHousehold = async (inviteId: string) => {
    if (!user) return;
    try {
      const inviteSnap = await getDoc(doc(db, 'invites', inviteId));
      if (!inviteSnap.exists()) throw new Error('Invite not found');
      const invite = inviteSnap.data();
      await redeemInviteCode(invite.inviteCode || '', invite.householdId, inviteId);
    } catch (e: any) {
      setNotification({ message: e.message || 'Failed to accept invite', type: 'error' });
    }
  };

  const copyInviteValue = async (mode: 'code' | 'link') => {
    const code = householdInviteCode || household?.settings?.inviteCode || '';
    if (!code) return;
    const value = mode === 'code' ? code : `${window.location.origin}/j/${code}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedInviteField(mode);
      setNotification({
        message: mode === 'code' ? `Copied Invite Code: ${code}` : `Copied short join link: ${value}`,
        type: 'success'
      });
      setTimeout(() => setCopiedInviteField(null), 2500);
    } catch {
      setNotification({ message: value, type: 'success' });
    }
  };

  const removeMember = async (memberId: string) => {
    if (!user?.householdId) return;
    if (memberId === user.id) {
      setNotification({ message: 'You cannot remove yourself.', type: 'error' });
      return;
    }

    setIsSaving(true);
    setNotification({ message: 'Removing family member...', type: 'success' });

    try {
      const hhRef = doc(db, 'households', user.householdId);
      const hhSnap = await getDoc(hhRef);
      if (hhSnap.exists()) {
        const hhData = hhSnap.data();
        const currentMembers: string[] = hhData.members || [];
        const currentManual: any[] = hhData.settings?.manualMembers || [];
        const patch: Record<string, any> = {};

        if (currentMembers.includes(memberId)) {
          patch.members = currentMembers.filter((m) => m !== memberId);
        }
        if (currentManual.some((m: any) => m.id === memberId)) {
          patch.settings = {
            ...(hhData.settings || {}),
            manualMembers: currentManual.filter((m: any) => m.id !== memberId)
          };
        }
        if (Object.keys(patch).length > 0) {
          await updateDoc(hhRef, patch);
        }
      }

      const memberHoldings = (data?.holdings || []).filter(
        (h) => getHoldingOwnerId(h) === memberId && h.id && !String(h.id).startsWith('placeholder-')
      );
      if (memberHoldings.length > 0) {
        await commitChunkedBatch(
          db,
          memberHoldings.map((h) => ({ type: 'delete', ref: doc(db, 'holdings', h.id) }))
        );
      }

      memberDocCacheRef.current.delete(memberId);
      if (dashboardView === memberId) {
        setDashboardView('combined');
      }
      setNotification({ message: 'Member removed successfully', type: 'success' });
    } catch (e: any) {
      handleFirestoreError(e, OperationType.DELETE, 'members');
    } finally {
      setIsSaving(false);
    }
  };

  const logout = () => {
    signOut(auth);
    setHousehold(null);
    setHoldingsList(null);
  };

  const openProfileSettings = (section: 'profile' | 'family' | 'email' = 'profile') => {
    setProfileModalSection(section);
    setShowProfileModal(true);
    setIsMenuOpen(false);
  };

  const handleUpdateProfileName = async (rawName: string) => {
    const cleanName = (rawName || '').trim();
    if (!user || !cleanName) return;

    if (auth.currentUser) {
      try {
        await updateProfile(auth.currentUser, { displayName: cleanName });
      } catch {
        // non-fatal
      }
    }

    await updateDoc(doc(db, 'users', user.id), {
      name: cleanName,
      updatedAt: serverTimestamp()
    });
    memberDocCacheRef.current.set(user.id, { ...user, name: cleanName });

    if (user.householdId) {
      try {
        const hhRef = doc(db, 'households', user.householdId);
        const hhSnap = await getDoc(hhRef);
        if (hhSnap.exists()) {
          const existingSettings = hhSnap.data().settings || {};
          await updateDoc(hhRef, {
            settings: {
              ...existingSettings,
              memberProfiles: {
                ...(existingSettings.memberProfiles || {}),
                [user.id]: {
                  id: user.id,
                  name: cleanName,
                  email: user.email
                }
              }
            }
          });
        }

        if (auth.currentUser) {
          const idToken = await auth.currentUser.getIdToken();
          await fetch('/api/household/invite-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              householdId: user.householdId,
              householdName: household?.name,
              inviterName: cleanName,
              refreshToken: auth.currentUser.refreshToken,
              preferredCode: householdInviteCode || household?.settings?.inviteCode
            })
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('Household member profile sync warning:', e);
      }
    }

    setUser((prev) => (prev ? { ...prev, name: cleanName } : null));
    setNotification({ message: `Display name updated to "${cleanName}"!`, type: 'success' });
  };

  const handleUpdateHouseholdName = async (rawHhName: string) => {
    const cleanName = (rawHhName || '').trim();
    if (!user?.householdId || !cleanName) return;
    await updateDoc(doc(db, 'households', user.householdId), { name: cleanName });
    if (auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        await fetch('/api/household/invite-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            householdId: user.householdId,
            householdName: cleanName,
            inviterName: user.name,
            refreshToken: auth.currentUser.refreshToken,
            preferredCode: householdInviteCode || household?.settings?.inviteCode
          })
        });
      } catch {}
    }
    setNotification({ message: `Family renamed to "${cleanName}"!`, type: 'success' });
  };

  const handleRenameMember = async (memberId: string, rawName: string) => {
    const cleanName = (rawName || '').trim();
    if (!user?.householdId || !cleanName) return;
    if (memberId === user.id) {
      await handleUpdateProfileName(cleanName);
      return;
    }

    const hhRef = doc(db, 'households', user.householdId);
    const hhSnap = await getDoc(hhRef);
    if (!hhSnap.exists()) return;
    const hhData = hhSnap.data();
    const existingSettings = hhData.settings || {};
    const prevManual: any[] = Array.isArray(existingSettings.manualMembers)
      ? existingSettings.manualMembers
      : [];
    const updatedManual = prevManual.map((m: any) =>
      m.id === memberId ? { ...m, name: cleanName } : m
    );
    const prevProfiles = existingSettings.memberProfiles || {};
    const existingProf = prevProfiles[memberId];

    await updateDoc(hhRef, {
      settings: {
        ...existingSettings,
        manualMembers: updatedManual,
        memberProfiles: existingProf
          ? { ...prevProfiles, [memberId]: { ...existingProf, name: cleanName } }
          : prevProfiles
      }
    });
    if (memberDocCacheRef.current.has(memberId)) {
      memberDocCacheRef.current.set(memberId, {
        ...memberDocCacheRef.current.get(memberId),
        name: cleanName
      });
    }
    setNotification({ message: `Updated member name to "${cleanName}".`, type: 'success' });
  };

  const handleLeaveFamily = async (mode: 'solo_keep_holdings' | 'setup_screen') => {
    if (!user?.householdId) return;
    const oldHouseholdId = user.householdId;
    const oldHouseholdName = household?.name || 'Family Portfolio';

    const myHoldings = (data?.holdings || []).filter(
      (h) => getHoldingOwnerId(h) === user.id && h.id && !String(h.id).startsWith('placeholder-')
    );
    const savedTargets = household?.targets || DEFAULT_PORTFOLIO_TARGETS;

    await pushHouseholdNotification({
      category: 'family',
      severity: 'info',
      title: `${user.name} left ${oldHouseholdName}`,
      message: `${user.name} unlinked from the shared family portfolio.`
    });

    if (myHoldings.length > 0) {
      await commitChunkedBatch(
        db,
        myHoldings.map((h) => ({ type: 'delete', ref: doc(db, 'holdings', h.id) }))
      );
    }

    const oldHhRef = doc(db, 'households', oldHouseholdId);
    const oldHhSnap = await getDoc(oldHhRef);
    if (oldHhSnap.exists()) {
      const hhData = oldHhSnap.data();
      const existingSettings = hhData.settings || {};
      const nextProfiles = { ...(existingSettings.memberProfiles || {}) };
      delete nextProfiles[user.id];

      const currentMembers: string[] = Array.isArray(hhData.members) ? hhData.members : [];
      const nextMembers = currentMembers.filter((mId) => mId !== user.id);

      const hhPatch: Record<string, any> = {
        settings: {
          ...existingSettings,
          memberProfiles: nextProfiles
        }
      };
      if (nextMembers.length > 0) {
        hhPatch.members = nextMembers;
      }
      await updateDoc(oldHhRef, hhPatch);
    }

    if (mode === 'setup_screen') {
      await updateDoc(doc(db, 'users', user.id), {
        householdId: null,
        updatedAt: serverTimestamp()
      });
      setDashboardView('combined');
      setActiveTab('dashboard');
      setHousehold(null);
      setHoldingsList(null);
      setUser((prev) => (prev ? { ...prev, householdId: null } : null));
      setNotification({
        message: `You left "${oldHouseholdName}". Create a new portfolio or join a family by code anytime.`,
        type: 'success'
      });
      return;
    }

    const newHhId = 'h_' + Math.random().toString(36).slice(2, 11);
    const newInviteCode = generateClientInviteCode();
    const firstName = user.name.split(' ')[0] || user.name;
    const soloName = `${firstName}'s Personal Portfolio`;

    await setDoc(doc(db, 'households', newHhId), {
      name: soloName,
      members: [user.id],
      settings: {
        inviteCode: newInviteCode,
        memberProfiles: {
          [user.id]: { id: user.id, name: user.name, email: user.email }
        }
      },
      targets: savedTargets
    });

    await updateDoc(doc(db, 'users', user.id), {
      householdId: newHhId,
      updatedAt: serverTimestamp()
    });

    if (myHoldings.length > 0) {
      await commitChunkedBatch(
        db,
        myHoldings.map((oldH) => {
          const hid = 'h_' + Math.random().toString(36).slice(2, 11);
          return {
            type: 'set',
            ref: doc(db, 'holdings', hid),
            data: {
              userId: user.id,
              ownerId: user.id,
              householdId: newHhId,
              ticker: oldH.ticker,
              quantity: oldH.quantity,
              assetClass: oldH.assetClass,
              currency: oldH.currency,
              provider: oldH.provider || 'Manual',
              source: oldH.source || 'Manual',
              currentPrice: oldH.currentPrice || 0,
              originalName: oldH.originalName || oldH.ticker,
              syncedAt: Date.now()
            }
          };
        })
      );
    }

    setDashboardView('combined');
    setActiveTab('dashboard');
    setHouseholdInviteCode(newInviteCode);
    setUser((prev) => (prev ? { ...prev, householdId: newHhId } : null));
    setNotification({
      message: `Left "${oldHouseholdName}" and moved ${myHoldings.length} holding${
        myHoldings.length === 1 ? '' : 's'
      } to "${soloName}".`,
      type: 'success'
    });
  };

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  const handleAddMemberManual = async () => {
    if (!user?.householdId || !newMemberName.trim()) return;
    setIsSaving(true);
    try {
      const id = 'u_' + Math.random().toString(36).slice(2, 11);
      const manualEntry = {
        id,
        email: (
          newMemberEmail ||
          `${newMemberName.trim().toLowerCase().replace(/\s+/g, '.')}@family.local`
        ).toLowerCase(),
        name: newMemberName.trim(),
        isManual: true
      };

      const hhRef = doc(db, 'households', user.householdId);
      const hhSnap = await getDoc(hhRef);
      if (hhSnap.exists()) {
        const hhData = hhSnap.data();
        const prevManual: any[] = Array.isArray(hhData.settings?.manualMembers)
          ? hhData.settings.manualMembers
          : [];
        await updateDoc(hhRef, {
          settings: {
            ...(hhData.settings || {}),
            manualMembers: [...prevManual, manualEntry]
          }
        });
      }

      setShowAddMemberModal(false);
      setNewMemberName('');
      setNewMemberEmail('');
      setNotification({
        message: `Added ${manualEntry.name} to your household! You can now import their PDFs/CSVs.`,
        type: 'success'
      });
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, 'households/manualMembers');
    } finally {
      setIsSaving(false);
    }
  };

  const sendInvite = async () => {
    if (!user?.householdId || !inviteEmail.trim()) return;
    setIsInviting(true);
    setLastInviteResult(null);
    try {
      const cleanEmail = inviteEmail.trim().toLowerCase();
      const codeToShare =
        householdInviteCode || household?.settings?.inviteCode || generateClientInviteCode();
      const inviteId = 'inv_' + Date.now().toString();
      await setDoc(doc(db, 'invites', inviteId), {
        fromUserId: user.id,
        toEmail: cleanEmail,
        householdId: user.householdId,
        householdName: household?.name || 'Family Portfolio',
        inviteCode: codeToShare,
        status: 'pending'
      });

      let emailSentNow = false;
      let emailErrorMsg: string | undefined;
      let gmailComposeUrl: string | undefined;
      let mailtoUrl: string | undefined;
      let senderEmailUsed: string | undefined;

      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch('/api/household/invite-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            householdId: user.householdId,
            householdName: household?.name,
            inviterName: user.name,
            refreshToken: auth.currentUser.refreshToken,
            preferredCode: codeToShare,
            toEmail: cleanEmail
          })
        });
        if (res.ok) {
          const info = await res.json();
          if (info.code) setHouseholdInviteCode(info.code);
          emailSentNow = Boolean(info.emailSent);
          emailErrorMsg = info.emailError;
          gmailComposeUrl = info.gmailComposeUrl;
          mailtoUrl = info.mailtoUrl;
          senderEmailUsed = info.senderEmail;
        }
      }

      setLastInviteResult({
        sent: emailSentNow,
        email: cleanEmail,
        senderEmail: senderEmailUsed,
        error: emailErrorMsg,
        gmailComposeUrl,
        mailtoUrl
      });

      setInviteSent(true);
      setInviteEmail('');
      if (emailSentNow) {
        setNotification({
          message: `Invitation email delivered to ${cleanEmail}${
            senderEmailUsed ? ` via ${senderEmailUsed}` : ''
          }!`,
          type: 'success'
        });
      } else {
        setNotification({
          message: `Pre-approved ${cleanEmail} (Code: ${codeToShare}). Authorize Gmail or click 'Open in Gmail' in the dialog to deliver the email!`,
          type: 'info'
        });
      }
      setTimeout(() => {
        setInviteSent(false);
      }, 3500);
    } catch (e: any) {
      handleFirestoreError(e, OperationType.CREATE, 'invites');
    } finally {
      setIsInviting(false);
    }
  };

  const handleSendTestEmail = async () => {
    const targetEmail = user?.email || 'hgarg5072@gmail.com';
    try {
      const json = await handleSendTestEmailTo(targetEmail);
      if (json.sent) {
        setNotification({
          message: `Test email delivered to ${targetEmail} via ${json.senderEmail || json.provider}!`,
          type: 'success'
        });
      } else {
        setNotification({
          message: json.error || 'Outgoing email is not authorized yet — opening Email Setup.',
          type: 'error'
        });
        openProfileSettings('email');
      }
    } catch {
      setNotification({ message: 'Error sending test email', type: 'error' });
    }
  };

  const handleTriggerRebalanceCheck = async () => {
    if (!data?.household?.id) return;
    try {
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      const res = await fetch('/api/rebalance/check-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          householdId: data.household.id,
          toEmail: user?.email,
          recipientName: user?.name
        })
      });
      const json = await res.json();
      if (json.sent) {
        setNotification({
          message: `Rebalance report emailed to ${json.recipientEmail || user?.email} via ${
            json.senderEmail || json.provider
          }!`,
          type: 'success'
        });
      } else {
        setNotification({
          message:
            json.error || 'Authorize Gmail in Email Settings to deliver automatic rebalance alerts.',
          type: 'error'
        });
        if (!emailStatus?.configured) {
          openProfileSettings('email');
        }
      }
    } catch {
      setNotification({ message: 'Error triggering rebalance email', type: 'error' });
    }
  };

  const handleSendRebalanceEmail = async (params: {
    toEmail: string;
    mode: 'full' | 'sip';
    freshInflowINR?: number;
    clientReport: any;
  }) => {
    if (!data?.household?.id) {
      return { sent: false, error: 'Household not loaded' };
    }
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    const res = await fetch('/api/rebalance/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
      },
      body: JSON.stringify({
        householdId: data.household.id,
        toEmail: params.toEmail,
        recipientName: user?.name || 'Investor',
        mode: params.mode,
        freshInflowINR: params.freshInflowINR,
        clientReport: params.clientReport
      })
    });
    const json = await res.json();
    if (json.sent) {
      setNotification({
        message: `Emailed ${params.mode === 'sip' ? 'Zero-Sell SIP Plan' : 'Rebalance Plan'} to ${
          params.toEmail
        }!`,
        type: 'success'
      });
    }
    return json;
  };

  const refreshPrices = async () => {
    if (!user?.householdId) return;
    setIsSaving(true);
    try {
      const currentHoldings = data?.holdings || [];
      const res = await fetch(`/api/portfolio/refresh?householdId=${user.householdId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          householdId: user.householdId,
          holdings: currentHoldings.map((h) => ({
            id: h.id,
            ticker: h.ticker,
            originalName: h.originalName
          }))
        })
      });
      if (res.ok) {
        const payload = await res.json();
        const updates = payload?.updates || {};
        const entries = Object.entries(updates) as [string, { currentPrice: number }][];
        if (entries.length > 0) {
          const now = Date.now();
          const ops: ChunkedBatchOperation[] = [];
          entries.forEach(([id, u]) => {
            if (typeof u.currentPrice === 'number' && u.currentPrice > 0) {
              ops.push({
                type: 'update',
                ref: doc(db, 'holdings', id),
                data: {
                  currentPrice: u.currentPrice,
                  priceUpdatedAt: now
                }
              });
            }
          });
          await commitChunkedBatch(db, ops);
        }
        await fetchFxRates();
        autoSnapDoneRef.current = '';
        setNotification({
          message: `Refreshed live prices (${entries.length} updated)!`,
          type: 'refreshed'
        });
      } else {
        setNotification({ message: 'Failed to refresh live prices.', type: 'error' });
      }
    } catch (e) {
      console.error(e);
      setNotification({ message: 'Error refreshing prices.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const saveTargets = async (targets: PortfolioTargets) => {
    if (!user?.householdId) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'households', user.householdId), { targets });
      setNotification({ message: 'Strategy targets updated successfully!', type: 'success' });
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `households/${user.householdId}`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveSettings = async (settings: { enabled: boolean; threshold: number }) => {
    if (!user?.householdId) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'households', user.householdId), {
        settings: {
          ...(household?.settings || {}),
          emailAlertsEnabled: settings.enabled,
          accuracyThreshold: settings.threshold
        }
      });
      setNotification({ message: 'Settings saved successfully', type: 'success' });
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `households/${user.householdId}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Memoized member options array for child components
  const memberOptions = useMemo(
    () => (data?.household?.membersData || []).map((m: any) => ({ id: m.id, name: m.name })),
    [data?.household?.membersData]
  );

  // Single O(H) shared portfolio valuation & drift calculators
  const householdStats = useMemo(() => {
    if (!data) return null;
    return computePortfolioStats({
      holdings: data.holdings,
      targets: data.household.targets,
      fxRate: fxRates.INR,
      membersData: memberOptions,
      scope: 'combined',
      householdId: data.household.id,
      includePlaceholders: false
    });
  }, [data, fxRates.INR, memberOptions]);

  const stats = useMemo(() => {
    if (!data) return null;
    return computePortfolioStats({
      holdings: data.holdings,
      targets: data.household.targets,
      fxRate: fxRates.INR,
      membersData: memberOptions,
      scope: dashboardView,
      householdId: data.household.id,
      includePlaceholders: true
    });
  }, [data, fxRates.INR, dashboardView, memberOptions]);

  // O(H) pre-computed native currency totals for Dashboard StatCards
  const currencyTotals = useMemo(() => {
    if (!stats) return { inrRaw: 0, usdRaw: 0 };
    let inrRaw = 0;
    let usdRaw = 0;
    for (const h of stats.holdings) {
      if (h.isPlaceholder) continue;
      if (h.currency === 'USD') usdRaw += h.quantity * h.currentPrice;
      else inrRaw += h.quantity * h.currentPrice;
    }
    return { inrRaw, usdRaw };
  }, [stats]);

  // O(H) pre-indexed member & provider counts for Accounts tab & Profile modal
  const holdingMetaCounts = useMemo(() => {
    const byOwner = new Map<string, number>();
    let hasUSD = false;
    let hasINR = false;
    for (const h of data?.holdings || []) {
      if (String(h.id || '').startsWith('placeholder-')) continue;
      const oid = getHoldingOwnerId(h);
      if (oid) byOwner.set(oid, (byOwner.get(oid) || 0) + 1);
      if (h.currency === 'USD') hasUSD = true;
      if (h.currency === 'INR') hasINR = true;
    }
    return { byOwner, hasUSD, hasINR };
  }, [data?.holdings]);

  // Load persisted PostgreSQL wealth history, notifications & real estate when household loads
  useEffect(() => {
    if (!user?.householdId || !auth.currentUser) {
      setWealthSnapshots([]);
      setAppNotifications([]);
      setRealEstateProperties(null);
      setTaxLots([]);
      setRsuGrants([]);
      setTaxProfile(DEFAULT_TAX_PROFILE);
      setRewardsBundle(EMPTY_REWARDS_BUNDLE);
      return;
    }
    let active = true;
    const fetchPersisted = async () => {
      try {
        const idToken = await auth.currentUser!.getIdToken();
        const headers = { Authorization: `Bearer ${idToken}` };
        const [histRes, notifRes, reRes, taxRes, rewRes] = await Promise.all([
          fetch(`/api/wealth-history/${user.householdId}`, { headers }),
          fetch(`/api/notifications/${user.householdId}`, { headers }),
          fetch(`/api/real-estate/${user.householdId}`, { headers }),
          fetch(`/api/tax-planning/${user.householdId}`, { headers }),
          fetch(`/api/rewards/${user.householdId}`, { headers })
        ]);
        if (histRes.ok && active) {
          const hj = await histRes.json();
          if (Array.isArray(hj.snapshots)) setWealthSnapshots(hj.snapshots);
        }
        if (notifRes.ok && active) {
          const nj = await notifRes.json();
          if (Array.isArray(nj.notifications)) setAppNotifications(nj.notifications);
        }
        if (reRes.ok && active) {
          const rj = await reRes.json();
          if (Array.isArray(rj.properties) && rj.properties.length > 0) {
            setRealEstateProperties(rj.properties);
          }
        }
        if (taxRes.ok && active) {
          const tj = await taxRes.json();
          if (Array.isArray(tj.taxLots)) setTaxLots(tj.taxLots);
          if (Array.isArray(tj.rsuGrants)) setRsuGrants(tj.rsuGrants);
          if (tj.taxProfile && typeof tj.taxProfile === 'object') {
            setTaxProfile({ ...DEFAULT_TAX_PROFILE, ...tj.taxProfile });
          }
        }
        if (rewRes.ok && active) {
          const rw = await rewRes.json();
          setRewardsBundle({
            creditCards: Array.isArray(rw.creditCards) ? rw.creditCards : [],
            loyaltyPrograms: Array.isArray(rw.loyaltyPrograms) ? rw.loyaltyPrograms : [],
            activities: Array.isArray(rw.activities) ? rw.activities : [],
            updatedAt: rw.updatedAt
          });
        }
      } catch (err) {
        console.warn('Persisted wealth/notification fetch warning:', err);
      }
    };
    fetchPersisted();
    return () => {
      active = false;
    };
  }, [user?.householdId]);

  const effectiveRealEstateList = useMemo<RealEstateProperty[]>(() => {
    if (realEstateProperties !== null) return realEstateProperties;
    const fromSettings = data?.household?.settings?.realEstateProperties;
    return Array.isArray(fromSettings) ? fromSettings : [];
  }, [realEstateProperties, data?.household?.settings?.realEstateProperties]);

  // One-time seamless migration of any legacy Firestore settings.realEstateProperties into PostgreSQL uw_real_estate
  useEffect(() => {
    const legacyProps = data?.household?.settings?.realEstateProperties;
    if (
      user?.householdId &&
      auth.currentUser &&
      realEstateProperties === null &&
      Array.isArray(legacyProps) &&
      legacyProps.length > 0 &&
      reMigratedRef.current !== user.householdId
    ) {
      reMigratedRef.current = user.householdId;
      setRealEstateProperties(legacyProps);
      auth.currentUser
        .getIdToken()
        .then((token) =>
          fetch(`/api/real-estate/${user.householdId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ properties: legacyProps })
          })
        )
        .catch(() => {});
    }
  }, [user?.householdId, realEstateProperties, data?.household?.settings?.realEstateProperties]);

  const realEstateTotals = useMemo(
    () => computeHouseholdRealEstateTotals(effectiveRealEstateList, memberOptions),
    [effectiveRealEstateList, memberOptions]
  );

  const handleSaveRealEstateProperties = async (nextProps: RealEstateProperty[]) => {
    if (!user?.householdId || !auth.currentUser) return;
    setRealEstateProperties(nextProps);
    const idToken = await auth.currentUser.getIdToken();
    await fetch(`/api/real-estate/${user.householdId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ properties: nextProps })
    });
    autoSnapDoneRef.current = '';
  };

  const handleSaveTaxLots = async (nextLots: TaxLot[]) => {
    if (!user?.householdId || !auth.currentUser) return;
    setTaxLots(nextLots);
    const idToken = await auth.currentUser.getIdToken();
    await fetch(`/api/tax-planning/${user.householdId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ taxLots: nextLots })
    });
  };

  const handleSaveRsuGrants = async (nextGrants: RsuGrant[]) => {
    if (!user?.householdId || !auth.currentUser) return;
    setRsuGrants(nextGrants);
    const idToken = await auth.currentUser.getIdToken();
    await fetch(`/api/tax-planning/${user.householdId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ rsuGrants: nextGrants })
    });
  };

  const handleSaveTaxProfile = async (nextProfile: TaxProfileSettings) => {
    if (!user?.householdId || !auth.currentUser) return;
    setTaxProfile(nextProfile);
    const idToken = await auth.currentUser.getIdToken();
    await fetch(`/api/tax-planning/${user.householdId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ taxProfile: nextProfile })
    });
  };

  const handleSaveRewardsBundle = async (patch: Partial<HouseholdRewardsBundle>) => {
    if (!user?.householdId || !auth.currentUser) return;
    const optimistic: HouseholdRewardsBundle = {
      creditCards: Array.isArray(patch.creditCards) ? patch.creditCards : rewardsBundle.creditCards,
      loyaltyPrograms: Array.isArray(patch.loyaltyPrograms)
        ? patch.loyaltyPrograms
        : rewardsBundle.loyaltyPrograms,
      activities: Array.isArray(patch.activities) ? patch.activities : rewardsBundle.activities,
      updatedAt: Date.now()
    };
    setRewardsBundle(optimistic);
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`/api/rewards/${user.householdId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Failed to save Cards & Miles');
    }
    const saved = await res.json();
    if (saved && Array.isArray(saved.creditCards)) {
      setRewardsBundle({
        creditCards: saved.creditCards,
        loyaltyPrograms: Array.isArray(saved.loyaltyPrograms) ? saved.loyaltyPrograms : optimistic.loyaltyPrograms,
        activities: Array.isArray(saved.activities) ? saved.activities : optimistic.activities,
        updatedAt: saved.updatedAt
      });
    }
  };

  const rewardsSummary = useMemo(
    () => computeRewardsHubSummary(rewardsBundle, memberOptions),
    [rewardsBundle, memberOptions]
  );

  const handleConfirmTrancheVested = async (ev: UpcomingVestEvent) => {
    if (!user?.householdId || !auth.currentUser || !data) return;
    // 1. Mark tranche vested in RSU Grants
    const updatedGrants = rsuGrants.map((g) =>
      g.id !== ev.grantId
        ? g
        : {
            ...g,
            vestSchedule: (g.vestSchedule || []).map((v) =>
              v.id === ev.trancheId
                ? { ...v, vested: true, vestPriceUSD: ev.projectedSharePriceUSD }
                : v
            ),
            updatedAt: Date.now()
          }
    );

    // 2. Add net vested shares to existing matching Holding or create a new Holding
    const existingHolding = data.holdings.find(
      (h) =>
        !String(h.id || '').startsWith('placeholder-') &&
        getHoldingOwnerId(h) === ev.ownerId &&
        normalizeTickerMatchKey(h.ticker) === normalizeTickerMatchKey(ev.ticker) &&
        normalizeProviderMatchKey(h.provider) === normalizeProviderMatchKey(ev.provider)
    );

    let targetHoldingId = existingHolding?.id || '';
    if (existingHolding && existingHolding.id) {
      await updateDoc(doc(db, 'holdings', existingHolding.id), {
        quantity: Number(((Number(existingHolding.quantity) || 0) + ev.netUnits).toFixed(4)),
        currentPrice: ev.projectedSharePriceUSD,
        priceUpdatedAt: Date.now()
      });
    } else {
      targetHoldingId = 'h_' + Math.random().toString(36).slice(2, 11);
      await setDoc(doc(db, 'holdings', targetHoldingId), {
        userId: user.id,
        ownerId: ev.ownerId || user.id,
        householdId: user.householdId,
        ticker: ev.ticker.toUpperCase(),
        originalName: `${ev.ticker.toUpperCase()} (${ev.grantName})`,
        quantity: ev.netUnits,
        assetClass: 'Equity',
        currency: 'USD',
        provider: ev.provider || 'E*TRADE',
        source: 'Manual',
        currentPrice: ev.projectedSharePriceUSD,
        syncedAt: Date.now()
      });
    }

    // 3. Record exact RSU Vest Tax Lot
    const newLot: TaxLot = {
      id: 'lot_' + Math.random().toString(36).slice(2, 10),
      householdId: user.householdId,
      holdingId: targetHoldingId,
      ownerId: ev.ownerId || user.id,
      ticker: ev.ticker.toUpperCase(),
      provider: ev.provider || 'E*TRADE',
      acquiredDate: ev.vestDate,
      quantity: ev.netUnits,
      costPerUnit: ev.projectedSharePriceUSD,
      currency: 'USD',
      fxRateAtBuy: fxRates.INR,
      acquisitionType: 'RSU Vest',
      updatedAt: Date.now()
    };
    const nextLots = [...taxLots, newLot];
    setRsuGrants(updatedGrants);
    setTaxLots(nextLots);

    const idToken = await auth.currentUser.getIdToken();
    await fetch(`/api/tax-planning/${user.householdId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ rsuGrants: updatedGrants, taxLots: nextLots })
    });

    setNotification({
      message: `Added ${ev.netUnits} vested ${ev.ticker} shares + RSU Tax Lot (${ev.vestDate})!`,
      type: 'success'
    });
  };

  const handleAskAiCopilot = async (question: string, contextSummary: any) => {
    if (!user?.householdId || !auth.currentUser) {
      throw new Error('Sign in required');
    }
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/ai/wealth-copilot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        householdId: user.householdId,
        question,
        contextSummary
      })
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Failed to generate AI strategy');
    }
    return json;
  };

  const handleImportRealEstateSheet = async (opts: {
    sheetUrl?: string;
    fileBase64?: string;
    propertyName?: string;
  }): Promise<RealEstateProperty> => {
    if (!user?.householdId || !auth.currentUser) {
      throw new Error('Sign in required');
    }
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/real-estate/import-sheet/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        householdId: user.householdId,
        sheetUrl: opts.sheetUrl,
        fileBase64: opts.fileBase64,
        propertyName: opts.propertyName,
        members: memberOptions
      })
    });
    const json = await res.json();
    if (!res.ok || !json.property) {
      throw new Error(json.error || 'Failed to parse spreadsheet');
    }
    return json.property as RealEstateProperty;
  };

  const handleExportBackup = () => {
    if (!data) return;
    const exportPayload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      household: {
        id: data.household.id,
        name: data.household.name,
        targets: data.household.targets,
        settings: data.household.settings
      },
      holdings: data.holdings.filter((h) => !String(h.id || '').startsWith('placeholder-')),
      realEstateProperties: effectiveRealEstateList,
      taxLots,
      rsuGrants,
      taxProfile,
      rewardsHub: rewardsBundle,
      wealthSnapshots
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `unitywealth-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setNotification({ message: 'Downloaded full portfolio JSON backup!', type: 'success' });
  };

  const handleImportBackup = async (backup: any) => {
    if (!user?.householdId || !data) throw new Error('Household not loaded');
    setIsSaving(true);
    try {
      const incomingHoldings: any[] = Array.isArray(backup?.holdings) ? backup.holdings : [];
      const incomingTargets: PortfolioTargets | undefined =
        backup?.household?.targets || backup?.targets;

      if (incomingTargets) {
        await updateDoc(doc(db, 'households', user.householdId), { targets: incomingTargets });
      }

      if (incomingHoldings.length > 0) {
        const ops: ChunkedBatchOperation[] = [];
        for (const oldH of data.holdings) {
          if (oldH.id && !String(oldH.id).startsWith('placeholder-')) {
            ops.push({ type: 'delete', ref: doc(db, 'holdings', oldH.id) });
          }
        }
        for (const h of incomingHoldings) {
          const hid = 'h_' + Math.random().toString(36).slice(2, 11);
          ops.push({
            type: 'set',
            ref: doc(db, 'holdings', hid),
            data: {
              userId: user.id,
              ownerId: h.ownerId || h.userId || user.id,
              householdId: user.householdId,
              ticker: String(h.ticker || 'MANUAL').slice(0, 50),
              originalName: h.originalName || h.ticker || 'Asset',
              quantity: Number(h.quantity) || 0,
              currentPrice: Number(h.currentPrice) || 0,
              assetClass: h.assetClass || 'Equity',
              currency: h.currency === 'USD' ? 'USD' : 'INR',
              provider: h.provider || 'Manual',
              source: h.source === 'PDF' ? 'PDF' : 'Manual',
              syncedAt: Date.now()
            }
          });
        }
        await commitChunkedBatch(db, ops);
      }

      if (Array.isArray(backup?.realEstateProperties)) {
        await handleSaveRealEstateProperties(backup.realEstateProperties);
      }
      if (Array.isArray(backup?.taxLots)) {
        await handleSaveTaxLots(backup.taxLots);
      }
      if (Array.isArray(backup?.rsuGrants)) {
        await handleSaveRsuGrants(backup.rsuGrants);
      }
      if (backup?.taxProfile && typeof backup.taxProfile === 'object') {
        await handleSaveTaxProfile({ ...DEFAULT_TAX_PROFILE, ...backup.taxProfile });
      }
      if (backup?.rewardsHub && typeof backup.rewardsHub === 'object') {
        await handleSaveRewardsBundle({
          ...(Array.isArray(backup.rewardsHub.creditCards) ? { creditCards: backup.rewardsHub.creditCards } : {}),
          ...(Array.isArray(backup.rewardsHub.loyaltyPrograms) ? { loyaltyPrograms: backup.rewardsHub.loyaltyPrograms } : {}),
          ...(Array.isArray(backup.rewardsHub.activities) ? { activities: backup.rewardsHub.activities } : {})
        });
      }

      setNotification({
        message: `Restored ${incomingHoldings.length} holdings from backup!`,
        type: 'success'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleInlineUpdateHolding = async (id: string, nextQty: number, nextPrice?: number) => {
    const patch: Record<string, number> = {
      quantity: nextQty,
      priceUpdatedAt: Date.now()
    };
    if (typeof nextPrice === 'number' && !isNaN(nextPrice)) {
      patch.currentPrice = nextPrice;
    }
    await updateDoc(doc(db, 'holdings', id), patch);
    setNotification({ message: 'Holding updated!', type: 'success' });
  };

  const handleInlineDeleteHolding = async (id: string) => {
    await deleteDoc(doc(db, 'holdings', id));
    setNotification({ message: 'Holding deleted', type: 'success' });
  };

  const recordWealthSnapshot = async (sourceLabel = 'manual_snapshot', showFeedback = false) => {
    if (
      !user?.householdId ||
      !auth.currentUser ||
      !householdStats ||
      !(householdStats.totalValINR > 0)
    )
      return;
    if (showFeedback) setIsRecordingSnapshot(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const rate = fxRates.INR || FX_FALLBACK_RATE;

      const memberAssetMap = new Map<
        string,
        {
          id: string;
          name: string;
          valueINR: number;
          indianEquityINR: number;
          foreignEquityINR: number;
          debtINR: number;
          realEstateEquityINR?: number;
        }
      >();
      householdStats.memberContributions.forEach((m) => {
        memberAssetMap.set(m.id, {
          id: m.id,
          name: m.name,
          valueINR: 0,
          indianEquityINR: 0,
          foreignEquityINR: 0,
          debtINR: 0,
          realEstateEquityINR: Math.round(realEstateTotals.byMemberEquityINR[m.id] || 0)
        });
      });

      const holdingsBreakdown = householdStats.holdings
        .filter((h) => !h.isPlaceholder && h.valINR > 0)
        .map((h) => {
          const ownerId = getHoldingOwnerId(h);
          const mEntry = memberAssetMap.get(ownerId) || {
            id: ownerId,
            name: household?.membersData?.find((x: any) => x.id === ownerId)?.name || 'Member',
            valueINR: 0,
            indianEquityINR: 0,
            foreignEquityINR: 0,
            debtINR: 0
          };
          mEntry.valueINR += h.valINR;
          if (h.assetClass === 'Debt') {
            mEntry.debtINR += h.valINR;
          } else if (h.currency === 'USD') {
            mEntry.foreignEquityINR += h.valINR;
          } else {
            mEntry.indianEquityINR += h.valINR;
          }
          memberAssetMap.set(ownerId, mEntry);

          const ticker = String(h.ticker || '').trim();
          const orig = String(h.originalName || ticker || 'Asset').trim();
          return {
            key: `${ticker.toUpperCase()}|${orig.toLowerCase().slice(0, 40)}`,
            ticker,
            name: orig,
            ownerId,
            assetClass: h.assetClass || 'Equity',
            currency: (h.currency === 'USD' ? 'USD' : 'INR') as 'INR' | 'USD',
            provider: h.provider || 'Portfolio',
            units: Number(h.quantity) || 0,
            price: Number(h.currentPrice) || 0,
            valueINR: Math.round(h.valINR)
          };
        });

      const actualEqPct = (householdStats.actualEquityPct || 0) * 100;
      const targetEqPct = (householdStats.targetEquityPct || 0.7) * 100;
      const actualIndPct = (householdStats.actualIndianEquityPctOfEquity || 0) * 100;
      const targetIndPct = (householdStats.targetIndianEquityOfEquity || 0.6) * 100;
      const alignmentPct = Math.max(0, 100 - Math.abs(actualEqPct - targetEqPct));

      const res = await fetch('/api/wealth-history/record', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          householdId: user.householdId,
          snapshotMonth: ym,
          totalINR: householdStats.totalValINR,
          totalUSD: householdStats.totalValUSD,
          indianEquityINR: householdStats.indianEquityValINR,
          foreignEquityINR: householdStats.foreignEquityValINR,
          debtINR: householdStats.debtValINR,
          realEstateEquityINR: Math.round(realEstateTotals.totalEquityINR),
          realEstateLoanINR: Math.round(realEstateTotals.totalLoanOutstandingINR),
          fxRate: rate,
          holdingsCount: holdingsBreakdown.length,
          memberBreakdown: Array.from(memberAssetMap.values()),
          providerBreakdown: householdStats.providerBreakdown,
          holdingsBreakdown,
          rebalanceMeta: {
            actualEquityPct: Number(actualEqPct.toFixed(1)),
            targetEquityPct: Number(targetEqPct.toFixed(1)),
            actualIndianOfEqPct: Number(actualIndPct.toFixed(1)),
            targetIndianOfEqPct: Number(targetIndPct.toFixed(1)),
            alignmentPct: Number(alignmentPct.toFixed(1))
          },
          source: sourceLabel,
          note: `${holdingsBreakdown.length} active holdings`
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.snapshots)) {
          setWealthSnapshots(json.snapshots);
        }
        if (showFeedback) {
          setNotification({
            message: `Saved ${ym} family wealth snapshot to PostgreSQL!`,
            type: 'success'
          });
        }
      }
    } catch (err) {
      console.warn('Record wealth snapshot error:', err);
    } finally {
      if (showFeedback) setIsRecordingSnapshot(false);
    }
  };

  // Auto-record monthly wealth snapshot whenever live holdings are present & unsynced this session
  useEffect(() => {
    if (
      !user?.householdId ||
      !householdStats ||
      !(householdStats.totalValINR > 0) ||
      !auth.currentUser
    )
      return;
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const snapKey = `${user.householdId}:${ym}:${Math.round(householdStats.totalValINR / 1000)}`;
    if (autoSnapDoneRef.current === snapKey) return;
    autoSnapDoneRef.current = snapKey;

    const timer = setTimeout(() => {
      recordWealthSnapshot('auto_sync', false);
    }, 900);
    return () => clearTimeout(timer);
  }, [user?.householdId, householdStats?.totalValINR]);

  const handleBackfillMonth = async (payload: {
    snapshotMonth: string;
    totalINR: number;
    indianEquityINR: number;
    foreignEquityINR: number;
    debtINR: number;
    note: string;
  }) => {
    if (!user?.householdId || !auth.currentUser) return;
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/wealth-history/backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        householdId: user.householdId,
        ...payload,
        fxRate: fxRates.INR || FX_FALLBACK_RATE,
        memberBreakdown: (householdStats?.memberContributions || []).map((m) => ({
          id: m.id,
          name: m.name,
          valueINR: Math.round(
            payload.totalINR *
              (m.percentage || 1 / Math.max(1, household?.membersData?.length || 1))
          )
        }))
      })
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.snapshots)) setWealthSnapshots(json.snapshots);
      setNotification({
        message: `Logged ${payload.snapshotMonth} wealth snapshot!`,
        type: 'success'
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setNotification({
        message: err.error || 'Failed to save historical month',
        type: 'error'
      });
    }
  };

  const handleDeleteSnapshotMonth = async (month: string) => {
    if (!user?.householdId || !auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(
        `/api/wealth-history/${user.householdId}/${encodeURIComponent(month)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` }
        }
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.snapshots)) setWealthSnapshots(json.snapshots);
        setNotification({ message: `Removed ${month} snapshot.`, type: 'info' });
      }
    } catch {
      // ignore
    }
  };

  const handleMarkNotificationsRead = async () => {
    if (!user?.householdId || !auth.currentUser) return;
    setAppNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      const idToken = await auth.currentUser.getIdToken();
      await fetch(`/api/notifications/${user.householdId}/mark-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({})
      });
    } catch {
      // ignore
    }
  };

  const smartAlerts = useMemo<SmartInsightAlert[]>(() => {
    if (!householdStats) return [];
    const alerts: SmartInsightAlert[] = [];
    if (householdStats.totalValINR <= 0) {
      alerts.push({
        id: 'empty_portfolio',
        severity: 'info',
        title: 'Start Your Family Portfolio',
        message:
          'Upload a CAMS CAS PDF, Zerodha/Schwab/IBKR CSV, or add EPF/FD balances in one tap.',
        actionLabel: 'Open Quick Add & Import',
        onAction: () => openQuickAdd('upload')
      });
      return alerts;
    }

    const driftPct = Math.abs(householdStats.equityDrift) * 100;
    const driftThreshold = 100 - (data?.household?.settings?.accuracyThreshold ?? 95);
    if (driftPct > Math.max(3, driftThreshold)) {
      alerts.push({
        id: 'allocation_drift',
        severity: 'warning',
        title: `Allocation Drift: ${driftPct.toFixed(1)}% Off Target`,
        message: `Use Zero-Sell Monthly SIP Routing or full rebalance orders to realign ${formatCompactINR(
          Math.abs(householdStats.equityDrift * householdStats.totalValINR)
        )}.`,
        actionLabel: 'Open Rebalance & SIP Router',
        onAction: () => setActiveTab('rebalance')
      });
    }

    if (householdStats.daysSinceSync !== null && householdStats.daysSinceSync >= 25) {
      alerts.push({
        id: 'stale_statement',
        severity: 'warning',
        title: `Monthly Statement Refresh Due (${householdStats.daysSinceSync}d ago)`,
        message:
          'Upload your latest CAMS or brokerage statement to append this month to your Wealth Journey curve.',
        actionLabel: 'Upload Monthly Statement',
        onAction: () => openQuickAdd('upload')
      });
    }

    if (householdStats.unmappedForeignCount > 0) {
      alerts.push({
        id: 'unmapped_foreign',
        severity: 'info',
        title: `${householdStats.unmappedForeignCount} Foreign Stock${
          householdStats.unmappedForeignCount > 1 ? 's' : ''
        } Unassigned to Themes`,
        message:
          'Assign US holdings to sector themes in Target Manager for granular ticker-level drift tracking.',
        actionLabel: 'Configure Target Themes',
        onAction: () => setActiveTab('targets')
      });
    }

    if (householdStats.topHoldingPct > 35 && householdStats.holdings.length >= 3) {
      alerts.push({
        id: 'concentration_risk',
        severity: 'info',
        title: `Single-Asset Concentration: ${householdStats.topHoldingPct.toFixed(1)}%`,
        message: `${householdStats.topHoldingName} represents over a third of combined family net worth.`,
        actionLabel: 'Inspect Portfolio',
        onAction: () => setActiveTab('dashboard')
      });
    }

    if (wealthSnapshots.length <= 1) {
      alerts.push({
        id: 'backfill_wealth_curve',
        severity: 'success',
        title: 'Plot Your Multi-Month Wealth Curve',
        message:
          'Current month is saved in PostgreSQL! Backfill 1–2 past months to unlock MoM growth charts.',
        actionLabel: 'Open Wealth Journey',
        onAction: () => setActiveTab('wealth')
      });
    }

    if (taxLots.length > 0) {
      const intel = computePortfolioTaxIntelligence({
        stats: householdStats,
        taxLots,
        taxProfile,
        members: memberOptions,
        fxRate: fxRates.INR
      });
      intel.cliffAlerts.slice(0, 2).forEach((cl) => {
        alerts.unshift({
          id: `ltcg_cliff_${cl.lotId}`,
          severity: 'warning',
          title: `LTCG Cliff in ${cl.daysToLtcg}d: ${cl.ticker}`,
          message: `Hold ${cl.ownerName}'s ${cl.units} ${cl.ticker} units (${cl.acquiredDate}) for ${cl.daysToLtcg} more days to save ${formatCompactINR(cl.taxSavedByWaitingINR)} in tax.`,
          actionLabel: 'Open Tax-Smart Rebalance',
          onAction: () => setActiveTab('rebalance')
        });
      });
    }

    if (rewardsSummary.alerts.length > 0) {
      rewardsSummary.alerts.slice(0, 3).forEach((al) => {
        alerts.push({
          id: `rew_${al.id}`,
          severity: al.severity,
          title: al.title,
          message: al.message,
          actionLabel: 'Open Cards & Miles',
          onAction: () => setActiveTab('cardsMiles')
        });
      });
    }

    return alerts;
  }, [
    householdStats,
    data?.household?.settings?.accuracyThreshold,
    wealthSnapshots.length,
    taxLots,
    taxProfile,
    memberOptions,
    fxRates.INR,
    rewardsSummary.alerts
  ]);

  const unreadAlertBadgeCount = useMemo(
    () =>
      appNotifications.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0) +
      smartAlerts.reduce((acc, a) => acc + (a.severity === 'warning' ? 1 : 0), 0),
    [appNotifications, smartAlerts]
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-dvh bg-slate-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      );
    }
    if (!user) {
      return (
        <LandingPage
          onLogin={login}
          onSignup={signup}
          onForgot={forgotPassword}
          onGoogleLogin={handleGoogleAuth}
          pendingInviteCode={pendingInviteCode}
          themeNode={<ThemeToggle theme={theme} isDark={isDark} onChange={setTheme} compact />}
        />
      );
    }
    if (!user.householdId) {
      return (
        <HouseholdSetup
          onCreate={createHousehold}
          onJoin={joinHousehold}
          onJoinByCode={redeemInviteCode}
          isJoining={isJoiningFamily}
          initialCode={pendingInviteCode}
          invites={invites}
          themeNode={<ThemeToggle theme={theme} isDark={isDark} onChange={setTheme} compact />}
        />
      );
    }
    if (!data || !data.household || !stats) {
      return (
        <div className="p-8 text-center bg-slate-50 min-h-dvh flex flex-col items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Syncing Data...</h3>
            <p className="text-sm text-slate-500 mb-6">
              We&apos;re securely fetching your latest portfolio valuations.
            </p>
            <button
              onClick={() => logout()}
              className="w-full bg-indigo-50 text-indigo-600 font-bold py-3 rounded-xl hover:bg-indigo-100 transition-colors"
            >
              Emergency Logout
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-dvh bg-[#F8FAFC] text-slate-900 font-sans overflow-hidden relative">
        {/* Sidebar - Mobile Backdrop */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside
          className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 p-6 flex flex-col shrink-0 transition-transform duration-300 lg:static lg:translate-x-0
          ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        >
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-2.5">
              <BrandLogo size={36} />
              <div className="leading-none">
                <div className="text-xl tracking-tight">
                  <span className="font-extrabold text-slate-900">unity</span>
                  <span className="font-semibold text-emerald-600">wealth</span>
                </div>
                <div className="text-[8.5px] font-bold tracking-[0.16em] text-slate-400 uppercase mt-0.5">
                  Portfolio &amp; Rebalancing
                </div>
              </div>
            </div>
            <button
              aria-label="Close navigation menu"
              onClick={() => setIsMenuOpen(false)}
              className="lg:hidden p-2 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 space-y-1">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Navigation
            </div>
            <SidebarBtn
              active={activeTab === 'dashboard'}
              onClick={() => {
                setActiveTab('dashboard');
                setIsMenuOpen(false);
              }}
              icon={<PieChartIcon size={18} />}
              label="Dashboard"
            />
            <SidebarBtn
              active={activeTab === 'wealth'}
              onClick={() => {
                setActiveTab('wealth');
                setIsMenuOpen(false);
              }}
              icon={<TrendingUp size={18} />}
              label="Wealth Journey"
              badge={wealthSnapshots.length > 0 ? `${wealthSnapshots.length}M` : 'NEW'}
            />
            <SidebarBtn
              active={activeTab === 'rebalance'}
              onClick={() => {
                setActiveTab('rebalance');
                setIsMenuOpen(false);
              }}
              icon={<Activity size={18} />}
              label="Rebalance & SIP"
            />
            <SidebarBtn
              active={activeTab === 'realEstate'}
              onClick={() => {
                setActiveTab('realEstate');
                setIsMenuOpen(false);
              }}
              icon={<Landmark size={18} />}
              label="Real Estate"
              badge={
                realEstateTotals.totalEquityINR > 0
                  ? formatCompactINR(realEstateTotals.totalEquityINR)
                  : undefined
              }
            />
            <SidebarBtn
              active={activeTab === 'cardsMiles'}
              onClick={() => {
                setActiveTab('cardsMiles');
                setIsMenuOpen(false);
              }}
              icon={<CreditCard size={18} />}
              label="Cards & Miles"
              badge={
                rewardsSummary.totalRewardsWealthINR > 0
                  ? formatCompactINR(rewardsSummary.totalRewardsWealthINR)
                  : 'NEW'
              }
            />
            <SidebarBtn
              active={activeTab === 'liveMarkets'}
              onClick={() => {
                setActiveTab('liveMarkets');
                setIsMenuOpen(false);
              }}
              icon={<Zap size={18} />}
              label="Live Markets"
            />
            <SidebarBtn
              active={activeTab === 'targets'}
              onClick={() => {
                setActiveTab('targets');
                setIsMenuOpen(false);
              }}
              icon={<Settings size={18} />}
              label="Target Manager"
            />
            <SidebarBtn
              active={activeTab === 'accounts'}
              onClick={() => {
                setActiveTab('accounts');
                setIsMenuOpen(false);
              }}
              icon={<Link size={18} />}
              label="Family & Accounts"
            />
          </nav>

          <div className="pt-8 border-t border-slate-100 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Account Sync
              </div>
              <button
                onClick={() => setActiveTab('accounts')}
                className="text-[10px] font-bold text-indigo-600 hover:underline"
              >
                MANAGE
              </button>
            </div>
            <div className="space-y-4">
              <AccountStatusItem label="US Brokers (USD)" isActive={holdingMetaCounts.hasUSD} />
              <AccountStatusItem label="NSE & Finnhub" isActive={true} />
              <AccountStatusItem label="CAMS / Zerodha" isActive={holdingMetaCounts.hasINR} />
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Appearance
              </span>
              <ThemeToggle theme={theme} isDark={isDark} onChange={setTheme} />
            </div>
            <button
              type="button"
              onClick={() => openProfileSettings('profile')}
              aria-label="Edit Profile and Family Settings"
              className="flex items-center justify-between gap-2.5 p-2 -mx-2 rounded-xl hover:bg-slate-50 transition-colors text-left group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-indigo-50 border-2 border-white shadow-sm flex items-center justify-center text-indigo-600 font-bold shrink-0">
                  {user.name.charAt(0)}
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-bold truncate text-slate-900 group-hover:text-indigo-600 transition-colors">
                    {user.name}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">Profile &amp; Family</p>
                </div>
              </div>
              <Pencil size={14} className="text-slate-400 group-hover:text-indigo-600 shrink-0" />
            </button>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => openProfileSettings('family')}
                className="text-xs text-slate-600 font-bold hover:text-indigo-600 text-left"
              >
                Leave / Switch Family
              </button>
              <button
                type="button"
                onClick={logout}
                className="text-xs text-rose-500 font-bold hover:underline text-right"
              >
                Logout
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          <header className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-2.5 shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  aria-label="Open navigation menu"
                  onClick={() => setIsMenuOpen(true)}
                  className="lg:hidden p-2 -ml-1 text-slate-600 hover:bg-slate-100 rounded-xl shrink-0"
                >
                  <Menu size={20} />
                </button>
                <BrandLogo size={28} className="lg:hidden" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-sm sm:text-base text-slate-900 truncate">
                      {data.household.name || 'Family Portfolio'}
                    </span>
                    <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-black text-emerald-700 uppercase shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live Sync
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => openQuickAdd('upload')}
                  disabled={isParsing}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all shadow-2xs disabled:opacity-50"
                >
                  {isParsing ? (
                    <RefreshCcw size={14} className="animate-spin text-indigo-500" />
                  ) : (
                    <FileUp size={14} className="text-indigo-600" />
                  )}
                  <span>{isParsing ? 'Parsing...' : 'Import PDF / XLSX / CSV'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => openQuickAdd('search')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                >
                  <Plus size={15} />
                  <span className="sm:hidden">Add</span>
                  <span className="hidden sm:inline">Quick Add</span>
                </button>

                <ThemeToggle compact theme={theme} isDark={isDark} onChange={setTheme} />

                <button
                  type="button"
                  aria-label="Open notifications and smart alerts"
                  onClick={() => setShowNotifications(true)}
                  className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <Bell size={18} />
                  {unreadAlertBadgeCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                      {unreadAlertBadgeCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  aria-label="Refresh live market prices"
                  onClick={refreshPrices}
                  disabled={isSaving}
                  className={`p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors ${
                    isSaving ? 'animate-spin text-indigo-600' : ''
                  }`}
                >
                  <RefreshCcw size={18} />
                </button>

                <button
                  type="button"
                  aria-label="Open profile and family settings"
                  onClick={() => openProfileSettings('profile')}
                  className="w-9 h-9 rounded-full bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-black text-xs flex items-center justify-center transition-colors shrink-0"
                  title={`${user.name} — Profile & Family Settings`}
                >
                  {(user.name || 'U').charAt(0).toUpperCase()}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1 py-0.5">
                <button
                  type="button"
                  onClick={() => setDashboardView('combined')}
                  className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                    dashboardView === 'combined'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  Combined View
                </button>
                {data.household.membersData?.map((m: any) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => {
                      setDashboardView(m.id);
                      if (
                        activeTab !== 'dashboard' &&
                        activeTab !== 'rebalance' &&
                        activeTab !== 'wealth'
                      ) {
                        setActiveTab('dashboard');
                      }
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                      dashboardView === m.id
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => openQuickAdd('upload')}
                  className="sm:hidden px-2.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center gap-1"
                >
                  <FileUp size={12} /> Import PDF/Excel
                </button>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 pl-1">
                <span className="text-[10px] font-black text-slate-400 uppercase hidden sm:inline">
                  USD/INR
                </span>
                <span className="text-xs font-mono font-black text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                  ₹{fxRates.INR.toFixed(2)}
                </span>
              </div>
            </div>
          </header>

          <div
            ref={mainScrollRef}
            className="flex-1 overflow-x-hidden overflow-y-auto px-3 sm:px-5 md:p-8 pb-24 lg:pb-8"
          >
            <Suspense fallback={<ViewLoadingFallback />}>
              <AnimatePresence mode="wait">
                {activeTab === 'dashboard' && (
                  <motion.div
                    key="dashboard"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col lg:grid lg:grid-cols-12 gap-4 md:gap-6 w-full max-w-full overflow-x-hidden pt-2 sm:pt-0"
                  >
                    <div className="lg:col-span-12">
                      <MarketPulseRibbon />
                    </div>

                    <div className="lg:col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
                      {(() => {
                        const activePropEq =
                          dashboardView === 'combined'
                            ? realEstateTotals.totalEquityINR
                            : realEstateTotals.byMemberEquityINR[dashboardView] || 0;
                        const includeProp = showPropertyInDashboard && activePropEq > 0;
                        const headlineINR = stats.totalValINR + (includeProp ? activePropEq : 0);
                        const subText =
                          activePropEq > 0
                            ? includeProp
                              ? `Liquid ${formatCompactINR(stats.totalValINR)} + Property ${formatCompactINR(
                                  activePropEq
                                )}`
                              : `Liquid Only • (+${formatCompactINR(activePropEq)} Property)`
                            : `₹${stats.totalValINR.toLocaleString('en-IN', {
                                maximumFractionDigits: 0
                              })} • $${stats.totalValUSD.toLocaleString('en-US', {
                                maximumFractionDigits: 0
                              })}`;
                        return (
                          <StatCardModern
                            label={
                              dashboardView === 'combined'
                                ? 'Combined Net Worth'
                                : `${
                                    data.household.membersData?.find(
                                      (m: any) => m.id === dashboardView
                                    )?.name
                                  }'s Net Worth`
                            }
                            value={formatCompactINR(headlineINR)}
                            subValue={subText}
                            actionPill={
                              activePropEq > 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowPropertyInDashboard(!showPropertyInDashboard)
                                  }
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase transition-colors ${
                                    showPropertyInDashboard
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                  title="Toggle paid-in real estate equity in headline net worth"
                                >
                                  {showPropertyInDashboard ? '+Property' : 'Liquid'}
                                </button>
                              ) : undefined
                            }
                          />
                        );
                      })()}
                      <StatCardModern
                        label="Indian Portfolio"
                        value={formatCompactINR(currencyTotals.inrRaw)}
                        subValue="Mutual Funds, Stocks & Debt"
                        isSecondary
                      />
                      <StatCardModern
                        label="Foreign Portfolio"
                        value={`$${currencyTotals.usdRaw.toLocaleString('en-US', {
                          maximumFractionDigits: 0
                        })}`}
                        subValue="US Equities & RSU"
                        isSecondary
                      />
                      <StatCardModern
                        label="Allocation Accuracy"
                        value={`${(100 - Math.abs(stats.equityDrift) * 100).toFixed(1)}%`}
                        subValue={`${(Math.abs(stats.equityDrift) * 100).toFixed(1)}% Drift detected`}
                        isAlert={Math.abs(stats.equityDrift) > 0.05}
                      />
                    </div>

                    <div className="flex flex-col gap-4 md:gap-6 lg:col-span-8 w-full min-w-0">
                      <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-100 sm:border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                            Primary Allocation
                          </h3>
                          <button
                            onClick={() => setActiveTab('targets')}
                            className="text-xs md:text-sm text-indigo-600 font-semibold hover:underline"
                          >
                            Adjust Strategy
                          </button>
                        </div>
                        <div className="space-y-8">
                          <DriftProgressBar
                            label="Global Equities"
                            actual={stats.actualEquityPct}
                            target={stats.targetEquityPct}
                            value={`₹${stats.equityValINR.toLocaleString('en-IN', {
                              maximumFractionDigits: 0
                            })}`}
                            color="bg-indigo-500"
                            onClick={() =>
                              setDetailView({
                                title: 'Global Equities',
                                filter: (h) =>
                                  h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund'
                              })
                            }
                          />
                          <DriftProgressBar
                            label="Fixed Income & Cash"
                            actual={stats.actualDebtPct}
                            target={stats.targetDebtPct}
                            value={`₹${stats.debtValINR.toLocaleString('en-IN', {
                              maximumFractionDigits: 0
                            })}`}
                            color="bg-emerald-400"
                            onClick={() =>
                              setDetailView({
                                title: 'Fixed Income & Cash',
                                filter: (h) => h.assetClass === 'Debt'
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-100 sm:border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                            Equity Breakdown
                          </h3>
                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                            % of Total Equity
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8">
                          <DriftProgressBar
                            label="Indian Equity"
                            actual={stats.actualIndianEquityPctOfEquity}
                            target={stats.targetIndianEquityOfEquity}
                            value={`₹${stats.indianEquityValINR.toLocaleString('en-IN', {
                              maximumFractionDigits: 0
                            })}`}
                            color="bg-orange-400"
                            onClick={() =>
                              setDetailView({
                                title: 'Indian Equities',
                                filter: (h) =>
                                  (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') &&
                                  h.currency === 'INR'
                              })
                            }
                          />
                          <DriftProgressBar
                            label="Foreign Equity"
                            actual={stats.actualForeignEquityPctOfEquity}
                            target={stats.targetForeignEquityOfEquity}
                            value={`₹${stats.foreignEquityValINR.toLocaleString('en-IN', {
                              maximumFractionDigits: 0
                            })}`}
                            color="bg-blue-400"
                            onClick={() =>
                              setDetailView({
                                title: 'Foreign Equities',
                                filter: (h) =>
                                  (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') &&
                                  h.currency === 'USD'
                              })
                            }
                          />
                        </div>
                      </div>

                      {stats.foreignBreakdownStats.length > 0 && (
                        <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-100 sm:border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                              Foreign Equity Granular Drift
                            </h3>
                            <button
                              onClick={() => setActiveTab('targets')}
                              className="text-sm text-indigo-600 font-semibold hover:underline"
                            >
                              Edit Themes
                            </button>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {stats.foreignBreakdownStats.map((stat, idx) => (
                              <CompactDriftRow
                                key={idx}
                                label={stat.name}
                                actual={stat.actualPctOfForeign}
                                target={stat.percentage / 100}
                                value={`₹${stat.actualVal.toLocaleString('en-IN', {
                                  maximumFractionDigits: 0
                                })}`}
                                onClick={() => {
                                  const catSet = new Set<string>(
                                    (stat.tickerWeights || []).map((tw: any) =>
                                      String(tw.ticker || '').toUpperCase()
                                    )
                                  );
                                  const allMapped = new Set<string>();
                                  if (stat.isUnmapped) {
                                    (data.household.targets.foreignBreakdown || []).forEach(
                                      (c: any) =>
                                        c.tickerWeights?.forEach((tw: any) =>
                                          allMapped.add(String(tw.ticker || '').toUpperCase())
                                        )
                                    );
                                  }
                                  setDetailView({
                                    title: stat.name,
                                    filter: (h) => {
                                      if (
                                        (h.assetClass !== 'Equity' &&
                                          h.assetClass !== 'Mutual Fund') ||
                                        h.currency !== 'USD'
                                      ) {
                                        return false;
                                      }
                                      const up = (h.ticker || '').toUpperCase();
                                      return stat.isUnmapped
                                        ? !allMapped.has(up)
                                        : catSet.has(up);
                                    },
                                    categoryContext: stat,
                                    totalForeignVal: stats.foreignEquityValINR
                                  });
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-4 md:gap-6 lg:col-span-4 w-full">
                      {dashboardView === 'combined' && (
                        <div className="bg-indigo-50/80 sm:bg-white p-5 md:p-6 rounded-xl border-t-4 border-t-indigo-500 sm:border-t-slate-200 border-x-indigo-100/50 border-b-indigo-100/50 sm:border-slate-200 shadow-lg sm:shadow-sm ring-1 ring-indigo-500/10 sm:ring-0">
                          <h3 className="text-sm font-black text-indigo-900 mb-4 uppercase tracking-widest">
                            Family Contributions
                          </h3>
                          <div className="space-y-4">
                            {(() => {
                              const inclProp =
                                showPropertyInDashboard && realEstateTotals.totalEquityINR > 0;
                              const enrichedMembers = stats.memberContributions
                                .map((m) => {
                                  const propShare = inclProp
                                    ? realEstateTotals.byMemberEquityINR[m.id] || 0
                                    : 0;
                                  const val = m.value + propShare;
                                  return { ...m, propShare, totalWithProp: val };
                                })
                                .sort((a, b) => b.totalWithProp - a.totalWithProp);
                              const grandTotal =
                                enrichedMembers.reduce((acc, m) => acc + m.totalWithProp, 0) || 1;
                              return enrichedMembers.map((m) => {
                                const pct = (m.totalWithProp / grandTotal) * 100;
                                return (
                                  <div
                                    key={m.id}
                                    className="p-4 bg-slate-50 border border-slate-100 rounded-xl"
                                  >
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-sm font-bold text-slate-700">
                                        {m.name}
                                      </span>
                                      <span className="text-xs font-black text-indigo-600">
                                        {pct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${pct}%` }}
                                        className="h-full bg-indigo-500"
                                      />
                                    </div>
                                    <div className="mt-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                      Contribution: ₹
                                      {m.totalWithProp.toLocaleString('en-IN', {
                                        maximumFractionDigits: 0
                                      })}
                                      {m.propShare > 0
                                        ? ` (incl. ${formatCompactINR(m.propShare)} property)`
                                        : ''}
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}

                      <div className="bg-emerald-50/30 sm:bg-white p-5 md:p-6 rounded-xl border-t-4 border-t-emerald-500 sm:border-t-slate-200 border-x-emerald-100/50 border-b-emerald-100/50 sm:border-slate-200 shadow-lg sm:shadow-sm ring-1 ring-emerald-500/5 sm:ring-0">
                        <h3 className="text-sm font-black text-emerald-900 sm:text-slate-800 mb-4 uppercase tracking-widest">
                          Currency Mix
                        </h3>
                        <div className="h-2 flex rounded-full overflow-hidden mb-4">
                          <div
                            className="bg-orange-500 h-full"
                            style={{
                              width: `${
                                (stats.indianEquityValINR / (stats.totalValINR || 1)) * 100
                              }%`
                            }}
                          ></div>
                          <div
                            className="bg-blue-600 h-full"
                            style={{
                              width: `${
                                (stats.foreignEquityValINR / (stats.totalValINR || 1)) * 100
                              }%`
                            }}
                          ></div>
                          <div
                            className="bg-emerald-400 h-full"
                            style={{
                              width: `${(stats.debtValINR / (stats.totalValINR || 1)) * 100}%`
                            }}
                          ></div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                              <span>INR Equity</span>
                            </div>
                            <span>
                              {((stats.indianEquityValINR / (stats.totalValINR || 1)) * 100).toFixed(
                                1
                              )}
                              %
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                              <span>USD Equity</span>
                            </div>
                            <span>
                              {(
                                (stats.foreignEquityValINR / (stats.totalValINR || 1)) *
                                100
                              ).toFixed(1)}
                              %
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                              <span>Debt &amp; Cash</span>
                            </div>
                            <span>
                              {((stats.debtValINR / (stats.totalValINR || 1)) * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-5 md:p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                            Portfolio Health X-Ray
                          </h3>
                          <button
                            type="button"
                            onClick={() => setActiveTab('wealth')}
                            className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
                          >
                            Wealth Curve →
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="text-[10px] font-bold text-slate-400 uppercase">
                              Liquidity / Debt
                            </div>
                            <div className="text-sm font-black text-slate-800 mt-0.5">
                              {formatCompactINR(stats.debtValINR)}
                            </div>
                            <div className="text-[10px] text-emerald-600 font-bold">
                              {(stats.actualDebtPct * 100).toFixed(1)}% buffer
                            </div>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="text-[10px] font-bold text-slate-400 uppercase">
                              Top Holding
                            </div>
                            <div className="text-sm font-black text-slate-800 mt-0.5">
                              {householdStats?.topHoldingPct
                                ? `${householdStats.topHoldingPct.toFixed(1)}%`
                                : '0%'}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {householdStats?.topHoldingName || 'Diversified'}
                            </div>
                          </div>
                        </div>

                        {householdStats &&
                          Object.keys(householdStats.providerBreakdown).length > 0 && (
                            <div className="space-y-2 pt-1">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                Custody &amp; Broker Split
                              </div>
                              {Object.entries(householdStats.providerBreakdown)
                                .sort((a, b) => (b[1] as number) - (a[1] as number))
                                .slice(0, 4)
                                .map(([prov, val]) => (
                                  <div
                                    key={prov}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="font-semibold text-slate-600 truncate mr-2">
                                      {prov}
                                    </span>
                                    <span className="font-mono font-bold text-slate-900 shrink-0">
                                      {formatCompactINR(val as number)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          )}

                        {effectiveRealEstateList.length > 0 && (
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                            <div>
                              <span className="font-bold text-slate-700">Real Estate Equity</span>
                              <span className="ml-1.5 font-mono font-black text-emerald-700">
                                {formatCompactINR(realEstateTotals.totalEquityINR)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveTab('realEstate')}
                              className="text-indigo-600 font-bold hover:underline"
                            >
                              EMI &amp; Swipes →
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => openQuickAdd('preset')}
                          className="w-full py-2.5 px-3 rounded-xl bg-indigo-50/80 hover:bg-indigo-100/80 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Landmark size={14} /> + Add EPF / FD / Gold / Cash
                        </button>
                      </div>
                    </div>

                    <div
                      ref={holdingsSectionRef}
                      className="lg:col-span-12 bg-white p-4 md:p-6 rounded-xl border border-slate-200 shadow-sm"
                    >
                      <HoldingsExplorer
                        holdings={stats.holdings}
                        fxRate={fxRates.INR}
                        members={memberOptions}
                        showMemberFilter={dashboardView === 'combined'}
                        formatName={shortenAssetName}
                        householdId={user.householdId || ''}
                        taxLots={taxLots}
                        taxProfile={taxProfile}
                        onSaveTaxLots={handleSaveTaxLots}
                        title={
                          dashboardView === 'combined'
                            ? 'Family Holdings Details'
                            : `${
                                data.household.membersData?.find(
                                  (m: any) => m.id === dashboardView
                                )?.name || 'Member'
                              }'s Holdings Details`
                        }
                        onAddClick={() => openQuickAdd('search')}
                        onUpdateHolding={handleInlineUpdateHolding}
                        onDeleteHolding={handleInlineDeleteHolding}
                      />
                    </div>

                    <div className="lg:col-span-12 bg-slate-900 rounded-2xl p-5 sm:p-8 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-1">
                          Unity Intelligence: Smart Suggestions
                        </div>
                        <div className="text-base sm:text-xl font-medium leading-snug">
                          To achieve your {Math.round(stats.targetEquityPct * 100)}/
                          {Math.round(stats.targetDebtPct * 100)} target, align ₹
                          {Math.abs(stats.equityDrift * stats.totalValINR).toLocaleString('en-IN', {
                            maximumFractionDigits: 0
                          })}{' '}
                          toward {stats.equityDrift > 0 ? 'Debt Funds' : 'Equity'} (or route fresh monthly SIPs tax-free).
                        </div>
                        <div className="text-slate-400 text-xs sm:text-sm mt-1.5 font-light">
                          Zero-sell monthly SIP routing and full buy/sell execution lists ready.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('rebalance')}
                        className="w-full sm:w-auto px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl font-bold transition-all shadow-lg active:scale-95 whitespace-nowrap sm:ml-6 shrink-0 text-sm text-center"
                      >
                        Review Rebalance Orders
                      </button>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'wealth' && (
                  <motion.div
                    key="wealth"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                  >
                    <WealthJourneyView
                      snapshots={wealthSnapshots}
                      stats={householdStats}
                      holdings={householdStats?.holdings || data.holdings}
                      targets={data.household.targets}
                      fxRate={fxRates.INR}
                      members={memberOptions}
                      activeScope={dashboardView === 'combined' ? 'family' : dashboardView}
                      onScopeChange={(s) => setDashboardView(s === 'family' ? 'combined' : s)}
                      isRecording={isRecordingSnapshot}
                      onRecordCurrentSnapshot={() => recordWealthSnapshot('manual_button', true)}
                      onBackfillMonth={handleBackfillMonth}
                      onDeleteMonth={handleDeleteSnapshotMonth}
                      realEstateEquityINR={realEstateTotals.totalEquityINR}
                      realEstateByMember={realEstateTotals.byMemberEquityINR}
                      includeRealEstate={
                        showPropertyInDashboard && realEstateTotals.totalEquityINR > 0
                      }
                      taxLots={taxLots}
                      rsuGrants={rsuGrants}
                      onOpenRsuForecast={() => setActiveTab('rebalance')}
                    />
                  </motion.div>
                )}

                {activeTab === 'realEstate' && (
                  <motion.div
                    key="realEstate"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                  >
                    <RealEstateView
                      householdId={user.householdId || ''}
                      members={memberOptions}
                      properties={effectiveRealEstateList}
                      onSaveProperties={handleSaveRealEstateProperties}
                      onImportSheet={handleImportRealEstateSheet}
                    />
                  </motion.div>
                )}

                {activeTab === 'cardsMiles' && (
                  <motion.div
                    key="cardsMiles"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                  >
                    <CardsMilesView
                      householdId={user.householdId || ''}
                      members={memberOptions}
                      defaultOwnerId={dashboardView !== 'combined' ? dashboardView : user.id}
                      bundle={rewardsBundle}
                      realEstateProperties={effectiveRealEstateList}
                      onSaveBundle={handleSaveRewardsBundle}
                    />
                  </motion.div>
                )}

                {activeTab === 'liveMarkets' && (
                  <motion.div
                    key="liveMarkets"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <LiveMarketsView
                      holdings={data.holdings}
                      members={data.household.membersData || []}
                      householdId={user.householdId || undefined}
                    />
                  </motion.div>
                )}

                {activeTab === 'rebalance' && (
                  <motion.div
                    key="rebalance"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <RebalanceView
                      householdId={user.householdId || ''}
                      stats={stats}
                      targets={data.household.targets}
                      members={memberOptions}
                      fxRates={fxRates}
                      householdName={data.household.name}
                      defaultEmail={user.email}
                      threshold={data.household.settings?.accuracyThreshold ?? 95}
                      emailStatus={emailStatus}
                      taxLots={taxLots}
                      rsuGrants={rsuGrants}
                      taxProfile={taxProfile}
                      realEstateProperties={effectiveRealEstateList}
                      onSaveTaxProfile={handleSaveTaxProfile}
                      onSaveRsuGrants={handleSaveRsuGrants}
                      onConfirmTrancheVested={handleConfirmTrancheVested}
                      onAskAiCopilot={handleAskAiCopilot}
                      onJumpToHoldings={() => {
                        setActiveTab('dashboard');
                        setTimeout(() => {
                          holdingsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
                        }, 150);
                      }}
                      onOpenEmailSettings={() => openProfileSettings('email')}
                      onSendRebalanceEmail={handleSendRebalanceEmail}
                    />
                  </motion.div>
                )}

                {activeTab === 'targets' && (
                  <motion.div
                    key="targets"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="max-w-4xl mx-auto space-y-8"
                  >
                    <TargetManagerView
                      initialTargets={data.household.targets}
                      initialSettings={data.household.settings}
                      onSave={saveTargets}
                      onSaveSettings={saveSettings}
                      isSaving={isSaving}
                      householdId={user.householdId || undefined}
                      onExportBackup={handleExportBackup}
                      onImportBackup={handleImportBackup}
                    />
                  </motion.div>
                )}

                {activeTab === 'accounts' && (
                  <motion.div
                    key="accounts"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-4xl mx-auto space-y-6"
                  >
                    <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white font-black text-base flex items-center justify-center shrink-0">
                          {(user.name || 'U')[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm sm:text-base font-black text-slate-900 truncate">
                              {user.name}
                            </h3>
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {data.household.name}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 truncate">{user.email}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            openPrintableFamilyIceSheet({
                              householdName: data.household.name || 'Family Portfolio',
                              members: memberOptions,
                              holdings: householdStats?.holdings || stats.holdings,
                              realEstateProperties: effectiveRealEstateList,
                              rsuGrants,
                              nomineeMap: taxProfile.nomineeVerifiedByAccount,
                              fxRate: fxRates.INR
                            })
                          }
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-all"
                          title="Generate printable Emergency Family Asset & Nominee Directory (ICE Sheet)"
                        >
                          <FileText size={13} /> Family ICE Vault PDF
                        </button>
                        {holdingMetaCounts.hasUSD && (
                          <button
                            type="button"
                            onClick={() => {
                              const csv = buildScheduleFaCsv({
                                holdings: householdStats?.holdings || stats.holdings,
                                taxLots,
                                members: memberOptions,
                                fxRate: fxRates.INR
                              });
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `unitywealth-ITR-Schedule-FA-CY${new Date().getFullYear()}.csv`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                            }}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-all"
                            title="Export US Foreign Assets Calendar-Year disclosure worksheet for ITR Schedule FA"
                          >
                            <Globe size={13} /> ITR Schedule FA CSV
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openProfileSettings('profile')}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all"
                        >
                          <Pencil size={13} /> Change Name
                        </button>
                        <button
                          type="button"
                          onClick={() => openProfileSettings('family')}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50/70 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-all"
                        >
                          <LogOut size={13} /> Leave Family
                        </button>
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-8 rounded-xl border border-slate-200 shadow-sm">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                        <div>
                          <h3 className="text-lg md:text-xl font-bold mb-1 text-slate-800">
                            Connection Manager
                          </h3>
                          <p className="text-slate-500 text-xs md:text-sm">
                            Linked sources for your family portfolio
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 md:gap-3">
                          <button
                            onClick={() => {
                              setLastInviteResult(null);
                              setShowInviteModal(true);
                            }}
                            className="flex items-center gap-2 bg-indigo-600 text-white px-3 md:px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:bg-indigo-700 transition-all shadow-sm"
                          >
                            <Users size={16} /> Invite Family
                          </button>
                          <button
                            onClick={() => {
                              setJoinCodeInput(pendingInviteCode || '');
                              setShowJoinByCodeModal(true);
                            }}
                            className="flex items-center gap-2 border border-emerald-200 text-emerald-700 bg-emerald-50/50 px-3 md:px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:bg-emerald-50 transition-all"
                          >
                            <Share2 size={16} /> Join Family
                          </button>
                          <button
                            onClick={() => setShowSyncModal(true)}
                            className="flex items-center gap-2 border border-slate-200 text-slate-600 px-3 md:px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:bg-slate-50 transition-all"
                          >
                            <Plus size={16} /> Import Data
                          </button>
                        </div>
                      </div>

                      {(householdInviteCode || data.household.settings?.inviteCode) && (
                        <div className="mb-8 p-4 md:p-5 rounded-2xl bg-gradient-to-r from-indigo-50/80 via-white to-emerald-50/50 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1">
                              Family Invite Code &amp; Short Join Link
                            </div>
                            <p className="text-xs text-slate-600">
                              Code:{' '}
                              <span className="font-mono font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                                {householdInviteCode || data.household.settings?.inviteCode}
                              </span>
                              {' • '}
                              Short Link:{' '}
                              <span className="font-mono font-bold text-indigo-700">
                                {window.location.host}/j/
                                {householdInviteCode || data.household.settings?.inviteCode}
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => copyInviteValue('code')}
                              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all"
                            >
                              {copiedInviteField === 'code' ? (
                                <Check size={14} className="text-emerald-600" />
                              ) : (
                                <Copy size={14} />
                              )}
                              Copy Code
                            </button>
                            <button
                              type="button"
                              onClick={() => copyInviteValue('link')}
                              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 rounded-xl text-xs font-bold text-white hover:bg-indigo-700 transition-all shadow-sm"
                            >
                              {copiedInviteField === 'link' ? (
                                <Check size={14} />
                              ) : (
                                <Share2 size={14} />
                              )}
                              Copy Join Link
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-6">
                        <section>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                              Household Members ({data.household.name})
                            </h4>
                            <button
                              onClick={() => setShowAddMemberModal(true)}
                              className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded transition-colors"
                            >
                              + ADD MANUALLY
                            </button>
                          </div>
                          <div className="space-y-3">
                            {data.household.membersData?.map((m: any, idx: number) => (
                              <MemberRow
                                key={m.id}
                                id={m.id}
                                name={m.name}
                                email={m.email}
                                role={m.isManual ? 'Tracked' : idx === 0 ? 'Admin' : 'Member'}
                                accounts={holdingMetaCounts.byOwner.get(m.id) || 0}
                                isLast={idx === (data.household.membersData?.length || 0) - 1}
                                onRemove={removeMember}
                                onRename={handleRenameMember}
                                onLeaveSelf={() => openProfileSettings('family')}
                                currentUserId={user.id}
                              />
                            ))}
                          </div>
                        </section>

                        <section>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                              India Accounts (Mutual Funds &amp; Equities)
                            </h4>
                            <span className="text-[10px] text-slate-400 font-semibold">
                              Click any broker to upload PDF, XLSX or CSV
                            </span>
                          </div>
                          {[
                            {
                              provider: 'CAMS',
                              name: 'CAMS / KFintech / MFCentral CAS',
                              hint: 'Upload unlocked CAS Holdings Valuation PDF or XLSX (not Capital Gains) — auto-links ISINs to live AMFI NAVs',
                              match: (h: Holding) =>
                                h.provider === 'CAMS' ||
                                h.provider === 'KFintech' ||
                                (h.source === 'PDF' &&
                                  h.currency === 'INR' &&
                                  h.assetClass !== 'Equity')
                            },
                            {
                              provider: 'Zerodha',
                              name: 'Zerodha (Kite / Console / Coin)',
                              hint: 'Console → Portfolio → Holdings → Download XLSX, CSV or PDF — auto-links NSE/BSE stocks & Coin MFs',
                              match: (h: Holding) => h.provider === 'Zerodha'
                            },
                            {
                              provider: 'INDmoney',
                              name: 'INDmoney (US Stocks & India Portfolio)',
                              hint: 'Upload INDmoney US Stocks (DriveWealth/Alpaca) or Indian Portfolio PDF / XLSX / CSV',
                              match: (h: Holding) => h.provider === 'INDmoney'
                            }
                          ].map((src) => {
                            const activeMemberId =
                              dashboardView !== 'combined' ? dashboardView : user.id;
                            const activeMemberName =
                              data.household.membersData?.find(
                                (m: any) => m.id === activeMemberId
                              )?.name || 'You';
                            const count = data.holdings.filter(
                              (h) => getHoldingOwnerId(h) === activeMemberId && src.match(h)
                            ).length;
                            return (
                              <SourceRow
                                key={src.provider}
                                icon={
                                  <FileText
                                    className={count > 0 ? 'text-emerald-500' : 'text-indigo-500'}
                                  />
                                }
                                name={src.name}
                                user={activeMemberName}
                                hint={src.hint}
                                status={count > 0 ? 'Connected' : 'Upload PDF/XLSX/CSV'}
                                lastSync={
                                  count > 0
                                    ? `${count} active ${count === 1 ? 'holding' : 'holdings'}`
                                    : undefined
                                }
                                onClick={() => triggerUpload(activeMemberId, src.provider)}
                              />
                            );
                          })}
                        </section>

                        <section className="pt-4 border-t border-slate-100">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                              US Stock Brokerages (Live USD via Finnhub)
                            </h4>
                            <span className="text-[10px] text-slate-400 font-semibold">
                              Each broker syncs independently
                            </span>
                          </div>
                          {[
                            {
                              provider: 'Charles Schwab',
                              name: 'Charles Schwab',
                              hint: 'Accounts → Positions → Export CSV / XLSX, or upload Monthly Brokerage Statement PDF'
                            },
                            {
                              provider: 'IBKR',
                              name: 'Interactive Brokers (IBKR)',
                              hint: 'Performance & Reports → Statements → Activity / Open Positions CSV, XLSX or PDF'
                            },
                            {
                              provider: 'E*TRADE',
                              name: 'E*TRADE (Morgan Stanley)',
                              hint: 'Accounts → Portfolios → Download XLSX / CSV, or upload Brokerage / Vested RSU PDF'
                            }
                          ].map((src) => {
                            const activeMemberId =
                              dashboardView !== 'combined' ? dashboardView : user.id;
                            const activeMemberName =
                              data.household.membersData?.find(
                                (m: any) => m.id === activeMemberId
                              )?.name || 'You';
                            const count = data.holdings.filter(
                              (h) =>
                                getHoldingOwnerId(h) === activeMemberId &&
                                h.provider === src.provider
                            ).length;
                            return (
                              <SourceRow
                                key={src.provider}
                                icon={
                                  <Globe
                                    className={count > 0 ? 'text-emerald-500' : 'text-blue-500'}
                                  />
                                }
                                name={src.name}
                                user={activeMemberName}
                                hint={src.hint}
                                status={count > 0 ? 'Connected' : 'Upload XLSX/CSV/PDF'}
                                lastSync={
                                  count > 0
                                    ? `${count} active ${count === 1 ? 'position' : 'positions'}`
                                    : undefined
                                }
                                onClick={() => triggerUpload(activeMemberId, src.provider)}
                              />
                            );
                          })}
                        </section>

                        <section className="pt-6 border-t border-slate-100">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                              Outgoing Email Delivery (Invites &amp; Rebalance)
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openProfileSettings('email')}
                                className="text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-2 rounded-lg transition-colors"
                              >
                                {emailStatus?.senderEmail?.toLowerCase() ===
                                'unitywealth.alerts@gmail.com'
                                  ? 'EMAIL SETTINGS'
                                  : 'AUTHORIZE UNITYWEALTH.ALERTS@GMAIL.COM'}
                              </button>
                              <button
                                type="button"
                                onClick={handleSendTestEmail}
                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-2 rounded-lg transition-colors"
                              >
                                SEND TEST EMAIL
                              </button>
                              <button
                                type="button"
                                onClick={handleTriggerRebalanceCheck}
                                className="text-[10px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 px-3 py-2 rounded-lg transition-colors"
                              >
                                EMAIL REBALANCE NOW
                              </button>
                            </div>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-4 space-y-2.5 border border-slate-100">
                            <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                              <span className="text-slate-600 font-semibold">
                                Outgoing Email Gateway
                              </span>
                              {emailStatus?.configured ? (
                                <span className="font-bold text-emerald-600 truncate">
                                  ● Connected (
                                  {emailStatus.senderEmail?.toLowerCase() ===
                                  'unitywealth.alerts@gmail.com'
                                    ? 'UnityWealth <unitywealth.alerts@gmail.com>'
                                    : emailStatus.senderEmail}
                                  )
                                </span>
                              ) : (
                                <span className="font-bold text-amber-600">
                                  ○ Not Authorized Yet
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              {emailStatus?.senderEmail?.toLowerCase() ===
                              'unitywealth.alerts@gmail.com'
                                ? 'Official system sender active! Automatic Family Invitations and Rebalance / Zero-Sell SIP Reports are delivered directly from UnityWealth <unitywealth.alerts@gmail.com>.'
                                : emailStatus?.configured
                                ? `Currently sending via ${emailStatus.senderEmail}. Click "Authorize unitywealth.alerts@gmail.com" above once to switch all outgoing alerts to UnityWealth <unitywealth.alerts@gmail.com>.`
                                : 'Click "Authorize unitywealth.alerts@gmail.com" above once to connect the official UnityWealth Gmail sender (free, sends to any email address).'}
                            </p>
                          </div>
                        </section>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Suspense>
          </div>

          <input
            type="file"
            multiple
            aria-label="Upload portfolio statements"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept="application/pdf,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,.pdf,.csv,.xlsx,.xls,.ods,.tsv,.txt"
          />

          <nav
            aria-label="Mobile Primary Navigation"
            className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] grid grid-cols-5 shadow-[0_-4px_20px_rgba(15,23,42,0.06)]"
          >
            {[
              { id: 'dashboard', label: 'Overview', icon: <PieChartIcon size={18} /> },
              { id: 'wealth', label: 'Wealth', icon: <TrendingUp size={18} /> },
              { id: 'rebalance', label: 'Rebalance', icon: <Activity size={18} /> },
              { id: 'liveMarkets', label: 'Markets', icon: <Zap size={18} /> },
              { id: 'accounts', label: 'Family', icon: <Users size={18} /> }
            ].map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id as any)}
                  className={`flex flex-col items-center justify-center py-2 min-h-[44px] rounded-xl transition-colors ${
                    isActive
                      ? 'text-indigo-600 font-black bg-indigo-50/60'
                      : 'text-slate-500 font-semibold'
                  }`}
                >
                  {item.icon}
                  <span className="text-[10px] mt-0.5 leading-none">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {showQuickAddModal && (
            <Suspense fallback={null}>
              <QuickAddModal
                isOpen={showQuickAddModal}
                onClose={() => {
                  setShowQuickAddModal(false);
                  setQuickAddInitialQuery('');
                }}
                members={memberOptions}
                defaultOwnerId={dashboardView !== 'combined' ? dashboardView : user.id}
                householdId={user.householdId || undefined}
                fxRate={fxRates.INR}
                initialMode={quickAddInitialMode}
                initialQuery={quickAddInitialQuery}
                onSaveHolding={handleQuickSaveHolding}
                onUploadFiles={(files, ownerId, hint) => processFilesBatch(files, ownerId, hint)}
              />
            </Suspense>
          )}

          {showNotifications && (
            <Suspense fallback={null}>
              <NotificationDrawer
                isOpen={showNotifications}
                onClose={() => setShowNotifications(false)}
                smartAlerts={smartAlerts}
                notifications={appNotifications}
                onMarkAllRead={handleMarkNotificationsRead}
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            </Suspense>
          )}

          {showProfileModal && (
            <Suspense fallback={null}>
              <ProfileFamilyModal
                isOpen={showProfileModal}
                onClose={() => setShowProfileModal(false)}
                initialSection={profileModalSection}
                user={user}
                household={data.household}
                myHoldingsCount={holdingMetaCounts.byOwner.get(user.id) || 0}
                emailStatus={emailStatus}
                onSaveProfileName={handleUpdateProfileName}
                onSaveHouseholdName={handleUpdateHouseholdName}
                onLeaveFamily={handleLeaveFamily}
                onJoinFamilyByCode={redeemInviteCode}
                onAuthorizeGmailPopup={authorizeGmailViaPopup}
                onConnectGoogleOffline={connectGoogleOfflineOAuth}
                onSaveProviderConfig={handleSaveEmailProviderConfig}
                onSendTestEmail={handleSendTestEmailTo}
              />
            </Suspense>
          )}

          <AnimatePresence>
            {detailView && (
              <DetailViewModal
                title={detailView.title}
                holdings={stats.holdings.filter(detailView.filter)}
                onClose={() => setDetailView(null)}
                fxRates={fxRates}
                members={memberOptions}
                categoryContext={detailView.categoryContext}
                householdId={user.householdId || undefined}
                taxLots={taxLots}
                taxProfile={taxProfile}
                onSaveTaxLots={persistTaxLots}
                onQuickAddTicker={(ticker) => {
                  setDetailView(null);
                  openQuickAdd('search', ticker);
                }}
                onUpdateHolding={handleInlineUpdateHolding}
                onDeleteHolding={handleInlineDeleteHolding}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isParsing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-md"
              >
                <div className="bg-white p-10 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full mx-4">
                  <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-6 relative">
                    <RefreshCcw size={40} className="animate-spin" />
                    <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin-slow"></div>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Analyzing Wealth Data</h3>
                  <p className="text-slate-500 text-center text-sm leading-relaxed">
                    Extracting active holdings from your {selectedImportProvider || 'brokerage'} statement and linking live market prices (10-15s).
                  </p>
                  <div className="mt-8 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 15, ease: 'linear' }}
                      className="h-full bg-indigo-600"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Invite Modal */}
          <AnimatePresence>
            {showInviteModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800">Invite Family Member</h3>
                    <button
                      aria-label="Close Invite Modal"
                      onClick={() => setShowInviteModal(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">
                          Instant Invite Code (Recommended)
                        </span>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                          Works Immediately
                        </span>
                      </div>
                      <div className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-indigo-100">
                        <span className="font-mono text-2xl font-black tracking-[0.25em] text-slate-900">
                          {householdInviteCode || data?.household?.settings?.inviteCode || '------'}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyInviteValue('code')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all"
                        >
                          {copiedInviteField === 'code' ? <Check size={14} /> : <Copy size={14} />}
                          {copiedInviteField === 'code' ? 'Copied' : 'Copy Code'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyInviteValue('link')}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                      >
                        {copiedInviteField === 'link' ? (
                          <Check size={14} />
                        ) : (
                          <Share2 size={14} />
                        )}
                        {copiedInviteField === 'link'
                          ? 'Join Link Copied to Clipboard!'
                          : 'Copy Shareable Join Link (WhatsApp / SMS)'}
                      </button>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Your spouse or family member can open the link or enter this code under{' '}
                        <strong>Join Family</strong> to link accounts in real time.
                      </p>
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-slate-100"></div>
                      </div>
                      <div className="relative flex justify-center text-[10px] uppercase">
                        <span className="bg-white px-2 text-slate-400 font-bold tracking-widest">
                          Or Send Email Invitation
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-slate-400 uppercase">Member Email</span>
                        {emailStatus?.configured ? (
                          <span className="font-bold text-emerald-600 truncate">
                            ● Sending via {emailStatus.senderEmail}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setShowInviteModal(false);
                              openProfileSettings('email');
                            }}
                            className="font-bold text-indigo-600 hover:underline"
                          >
                            Connect Gmail for auto-send →
                          </button>
                        )}
                      </div>
                      <input
                        aria-label="Member Email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        type="email"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                        placeholder="spouse@gmail.com"
                      />
                      <button
                        onClick={sendInvite}
                        disabled={isInviting || !inviteEmail.trim()}
                        className={`w-full text-white rounded-xl py-3.5 text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                          inviteSent ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-800'
                        }`}
                      >
                        {isInviting ? (
                          <RefreshCcw className="animate-spin" size={18} />
                        ) : inviteSent ? (
                          <>
                            <Check size={18} /> {lastInviteResult?.sent ? 'Email Sent!' : 'Pre-Approved!'}
                          </>
                        ) : (
                          <>
                            <Send size={16} />{' '}
                            {emailStatus?.configured
                              ? 'Send Email Invite'
                              : 'Send / Prepare Email Invite'}
                          </>
                        )}
                      </button>

                      {lastInviteResult && (
                        <div
                          className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                            lastInviteResult.sent
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-amber-50 border-amber-200 text-amber-900'
                          }`}
                        >
                          {lastInviteResult.sent ? (
                            <p className="font-bold">
                              Delivered invitation email to <strong>{lastInviteResult.email}</strong>!
                            </p>
                          ) : (
                            <>
                              <p className="font-semibold leading-relaxed">
                                Pre-approved <strong>{lastInviteResult.email}</strong>! Automatic outgoing email isn&apos;t connected yet — send the pre-filled invite in 1 click or authorize Gmail:
                              </p>
                              <div className="flex flex-wrap gap-2 pt-0.5">
                                {lastInviteResult.gmailComposeUrl && (
                                  <a
                                    href={lastInviteResult.gmailComposeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold"
                                  >
                                    Open Pre-Filled Gmail <ExternalLink size={12} />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowInviteModal(false);
                                    openProfileSettings('email');
                                  }}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 text-[11px] font-bold"
                                >
                                  Authorize Automatic Gmail
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Join Existing Family by Code Modal */}
          <AnimatePresence>
            {showJoinByCodeModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800">Join a Family Portfolio</h3>
                    <button
                      onClick={() => setShowJoinByCodeModal(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Enter the 6-character <strong>Family Invite Code</strong> shared by your family member. Any holdings you already added will move with you automatically.
                    </p>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                        Family Invite Code
                      </label>
                      <input
                        aria-label="Family Invite Code"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        type="text"
                        maxLength={12}
                        className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-black tracking-[0.2em] uppercase text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="E.G. K7M4P9"
                      />
                    </div>
                    <button
                      onClick={() => redeemInviteCode(joinCodeInput)}
                      disabled={isJoiningFamily || !joinCodeInput.trim()}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl py-4 font-bold shadow-lg shadow-emerald-100 transition-all flex items-center justify-center gap-2"
                    >
                      {isJoiningFamily ? (
                        <RefreshCcw className="animate-spin" size={18} />
                      ) : (
                        <Users size={18} />
                      )}
                      {isJoiningFamily ? 'Joining Family...' : 'Join Family Portfolio'}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Add Member Manual Modal */}
          <AnimatePresence>
            {showAddMemberModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-lg">Add Member Manually</h3>
                    <button
                      onClick={() => setShowAddMemberModal(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Quickly add a family member record to track their investments manually via PDF uploads.
                    </p>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                          Full Name
                        </label>
                        <input
                          aria-label="Member Full Name"
                          value={newMemberName}
                          onChange={(e) => setNewMemberName(e.target.value)}
                          type="text"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                          placeholder="e.g. Rahul Garg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                          Email Address
                        </label>
                        <input
                          aria-label="Member Email Address"
                          value={newMemberEmail}
                          onChange={(e) => setNewMemberEmail(e.target.value)}
                          type="email"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                          placeholder="rahul@example.com"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleAddMemberManual}
                      disabled={isSaving}
                      className="w-full text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl py-4 font-bold shadow-lg transition-all flex items-center justify-center gap-2"
                    >
                      {isSaving ? <RefreshCcw className="animate-spin" size={20} /> : 'Add Member'}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Sync Modal */}
          <AnimatePresence>
            {showSyncModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800">Add Connection</h3>
                    <button
                      onClick={() => setShowSyncModal(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-6 space-y-3">
                    <SyncOption
                      title="Import Statement (PDF / XLSX / CSV)"
                      desc="Supports CAMS CAS, Zerodha XLSX/CSV, INDmoney, Schwab, IBKR & E*TRADE"
                      icon={<FileText className="text-violet-600" />}
                      onClick={() =>
                        triggerUpload(
                          dashboardView !== 'combined'
                            ? dashboardView
                            : data.household.membersData?.[0]?.id || user.id
                        )
                      }
                      badge="Multi-Broker"
                    />
                    <div className="h-px bg-slate-50 my-2"></div>
                    <SyncOption
                      title="Auto-Sync Email (India)"
                      desc="Connect Gmail to fetch CAS statements automatically"
                      icon={<Mail className="text-rose-600" />}
                      onClick={handleGoogleAuth}
                    />
                    {user?.googleTokens && (
                      <button
                        onClick={async () => {
                          try {
                            setNotification({ message: 'Syncing from Gmail...', type: 'info' });
                            const idToken = auth.currentUser
                              ? await auth.currentUser.getIdToken()
                              : '';
                            const res = await fetch('/api/sync/gmail', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
                              },
                              body: JSON.stringify({ userId: user.id })
                            });
                            const result = await res.json();
                            if (result.success) {
                              if (result.count > 0) {
                                setNotification({
                                  message: `Sync complete! Found ${result.count} holdings in ${
                                    result.filename || 'latest statement'
                                  }.`,
                                  type: 'success'
                                });
                              } else {
                                setNotification({
                                  message: 'No CAS statements found in your recent emails.',
                                  type: 'info'
                                });
                              }
                            } else {
                              setNotification({
                                message: result.error || 'Sync failed',
                                type: 'error'
                              });
                            }
                          } catch {
                            setNotification({
                              message: 'Network error during sync',
                              type: 'error'
                            });
                          }
                        }}
                        className="mt-2 text-xs text-indigo-600 font-bold hover:underline flex items-center gap-1 px-4 mb-2"
                      >
                        <RefreshCcw className="w-3 h-3" /> Sync Now
                      </button>
                    )}
                    <div className="h-px bg-slate-50 my-2"></div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </main>
      </div>
    );
  };

  return (
    <>
      {renderContent()}

      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: !user || !user.householdId ? -24 : 50, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: !user || !user.householdId ? -16 : 20, scale: 0.94 }}
            className={`fixed ${
              !user || !user.householdId ? 'top-4' : 'bottom-20 lg:bottom-8'
            } left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4`}
          >
            <div
              className={`p-3.5 sm:p-4 rounded-2xl shadow-2xl border flex items-center gap-3.5 ${
                notification.type === 'error'
                  ? 'bg-rose-50 border-rose-100 text-rose-800'
                  : 'bg-slate-900 border-slate-800 text-white'
              }`}
            >
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  notification.type === 'error' ? 'bg-rose-100' : 'bg-indigo-600'
                }`}
              >
                {notification.type === 'error' ? (
                  <Plus className="rotate-45" size={18} />
                ) : (
                  <Check size={18} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-bold leading-snug">{notification.message}</p>
              </div>
              <button
                onClick={() => setNotification(null)}
                aria-label="Dismiss notification"
                className={`p-2 rounded-full transition-all shrink-0 ${
                  notification.type === 'error' ? 'hover:bg-rose-200/50' : 'hover:bg-white/10'
                }`}
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarBtn({
  active,
  onClick,
  icon,
  label,
  badge
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-2.5 rounded-xl font-medium transition-all text-[11px] uppercase tracking-wider ${
        active ? 'bg-indigo-50 text-indigo-700 font-black' : 'text-slate-500 hover:bg-slate-50'
      }`}
    >
      <span className="flex items-center space-x-2.5 min-w-0">
        <span className={`shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`}>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      {badge && (
        <span
          className={`px-1.5 py-0.5 rounded-md text-[9px] font-black shrink-0 ${
            active ? 'bg-indigo-600 text-white' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function AccountStatusItem({ label, isActive }: { label: string; isActive?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-600">{label}</span>
      <span
        className={`font-mono text-[10px] font-bold ${
          isActive ? 'text-emerald-500' : 'text-slate-300'
        }`}
      >
        {isActive ? '● LIVE' : '○ DISCONNECTED'}
      </span>
    </div>
  );
}

function StatCardModern({
  label,
  value,
  subValue,
  trend,
  isSecondary: _isSecondary,
  isAlert,
  trendType,
  actionPill
}: {
  label: string;
  value: string;
  subValue: string;
  trend?: string;
  isSecondary?: boolean;
  isAlert?: boolean;
  trendType?: 'good' | 'bad' | 'neutral';
  actionPill?: React.ReactNode;
}) {
  return (
    <div
      className={`bg-white p-3.5 sm:p-5 rounded-xl border shadow-sm min-w-0 ${
        isAlert ? 'border-l-4 border-l-amber-400 border-slate-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider leading-tight truncate">
          {label}
        </div>
        {actionPill}
      </div>
      <div className="text-lg sm:text-2xl font-bold mt-1 text-slate-800 leading-tight">{value}</div>
      {trend ? (
        <div
          className={`text-[10px] sm:text-xs font-medium mt-1 ${
            trendType === 'bad' ? 'text-rose-500' : 'text-emerald-600'
          }`}
        >
          {trend}
        </div>
      ) : (
        <div className="text-[10px] sm:text-xs mt-1 text-slate-400 leading-snug">{subValue}</div>
      )}
    </div>
  );
}

function CompactDriftRow({
  label,
  actual,
  target,
  value,
  onClick
}: {
  label: string;
  actual: number;
  target: number;
  value: string;
  onClick?: () => void;
  key?: any;
}) {
  const drift = actual - target;
  const isBalanced = Math.abs(drift) < 0.05;

  return (
    <div
      className="group flex items-center justify-between p-3 rounded-2xl border border-slate-50 hover:border-indigo-100 hover:bg-indigo-50/20 transition-all cursor-pointer bg-white"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0 mr-2 sm:mr-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider truncate mr-1">
            {label}
          </span>
          <span className="text-[10px] font-bold text-slate-500 tabular-nums whitespace-nowrap">
            {value}
          </span>
        </div>
        <div className="relative h-1 w-full bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${actual * 100}%` }}
            className={`h-full ${isBalanced ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-slate-900/50 z-10"
            style={{ left: `${target * 100}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-6 text-right shrink-0">
        <div className="min-w-[50px] sm:min-w-[70px]">
          <p className="text-[7px] sm:text-[8px] font-black text-slate-300 uppercase leading-none mb-1 tracking-tighter text-right whitespace-nowrap">
            Actual/Target
          </p>
          <div className="flex items-center justify-end gap-1">
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-700">
              {(actual * 100).toFixed(1)}%
            </span>
            <span className="text-[9px] sm:text-[10px] text-slate-300">/</span>
            <span className="text-[10px] sm:text-[11px] font-medium text-slate-400">
              {(target * 100).toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="min-w-[35px] sm:min-w-[45px]">
          <p className="text-[7px] sm:text-[8px] font-black text-slate-300 uppercase leading-none mb-1 tracking-tighter text-right">
            Drift
          </p>
          <p
            className={`text-[10px] sm:text-[11px] font-black ${
              isBalanced ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            {drift > 0 ? '+' : ''}
            {(drift * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}

function DriftProgressBar({
  label,
  actual,
  target,
  value,
  color,
  onClick
}: {
  label: string;
  actual: number;
  target: number;
  value: string;
  color: string;
  onClick?: () => void;
  key?: any;
}) {
  const drift = actual - target;
  return (
    <div
      className={`space-y-2 ${onClick ? 'cursor-pointer hover:opacity-80 transition-all' : ''}`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest truncate">
            {label}
          </p>
          <p className="text-xs md:text-sm font-bold text-slate-800">{value}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">
            Drift
          </p>
          <p
            className={`text-xs md:text-sm font-bold ${
              Math.abs(drift) < 0.05 ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            {drift > 0 ? '+' : ''}
            {(drift * 100).toFixed(1)}%
          </p>
        </div>
      </div>
      <div className="relative">
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${actual * 100}%` }}
            className={`h-full ${color}`}
          />
        </div>
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10"
          style={{ left: `${target * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-tighter text-slate-400">
        <span>Actual: {(actual * 100).toFixed(1)}%</span>
        <span>Target: {(target * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

function DetailViewModal({
  title,
  holdings,
  onClose,
  fxRates,
  members,
  categoryContext,
  householdId,
  taxLots,
  taxProfile,
  onSaveTaxLots,
  onQuickAddTicker,
  onUpdateHolding,
  onDeleteHolding
}: {
  title: string;
  holdings: Holding[];
  onClose: () => void;
  fxRates: Record<string, number>;
  members: { id: string; name: string }[];
  categoryContext?: any;
  householdId?: string;
  taxLots?: TaxLot[];
  taxProfile?: TaxProfileSettings;
  onSaveTaxLots?: (nextLots: TaxLot[]) => Promise<void> | void;
  onQuickAddTicker: (ticker: string) => void;
  onUpdateHolding: (id: string, nextQty: number, nextPrice?: number) => Promise<void>;
  onDeleteHolding: (id: string) => Promise<void>;
}) {
  const [showTargetPlaceholders, setShowTargetPlaceholders] = useState(false);

  const augmentedHoldings = useMemo(() => {
    if (!categoryContext || !categoryContext.tickerWeights) return holdings;

    const existingTickers = new Set(holdings.map((h) => h.ticker.toUpperCase()));
    const missing = categoryContext.tickerWeights
      .filter((tw: any) => !existingTickers.has(tw.ticker.toUpperCase()))
      .map(
        (tw: any) =>
          ({
            id: `placeholder-${tw.ticker}`,
            ticker: tw.ticker,
            quantity: 0,
            currentPrice: 0,
            currency: 'USD',
            assetClass: 'Equity',
            userId: members[0]?.id || 'unknown',
            source: 'Manual',
            isPlaceholder: true,
            originalName: `Goal: ${tw.ticker}`
          } as any)
      );

    return showTargetPlaceholders ? [...holdings, ...missing] : holdings;
  }, [holdings, categoryContext, members, showTargetPlaceholders]);

  const totalCatValueINR = useMemo(() => {
    const rate = fxRates.INR || FX_FALLBACK_RATE;
    return augmentedHoldings.reduce(
      (sum, h) =>
        sum +
        (h.currency === 'USD'
          ? h.quantity * h.currentPrice * rate
          : h.quantity * h.currentPrice),
      0
    );
  }, [augmentedHoldings, fxRates.INR]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{title}</h3>
            <p className="text-xs text-slate-500 font-bold mt-0.5">
              Showing {augmentedHoldings.length} assets
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Show Target Gaps
              </span>
              <div className="relative">
                <input
                  type="checkbox"
                  aria-label="Show Target Gaps"
                  className="sr-only peer"
                  checked={showTargetPlaceholders}
                  onChange={(e) => setShowTargetPlaceholders(e.target.checked)}
                />
                <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
              </div>
            </label>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Plus className="rotate-45" size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {showTargetPlaceholders && augmentedHoldings.some((h: any) => h.isPlaceholder) && (
            <div className="p-3.5 rounded-2xl bg-indigo-50/70 border border-indigo-100 space-y-2">
              <div className="text-[10px] font-black text-indigo-700 uppercase tracking-wider">
                Unallocated Target Tickers
              </div>
              <div className="flex flex-wrap gap-2">
                {augmentedHoldings
                  .filter((h: any) => h.isPlaceholder)
                  .map((h: any) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => onQuickAddTicker(h.ticker)}
                      className="px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-xs font-bold text-indigo-700 hover:bg-indigo-100 flex items-center gap-1"
                    >
                      <Plus size={12} /> Add {h.ticker}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <HoldingsExplorer
            holdings={holdings}
            fxRate={fxRates.INR || FX_FALLBACK_RATE}
            members={members}
            showMemberFilter={members.length > 1}
            formatName={shortenAssetName}
            compactHeader
            onUpdateHolding={onUpdateHolding}
            onDeleteHolding={onDeleteHolding}
            householdId={householdId}
            taxLots={taxLots}
            taxProfile={taxProfile}
            onSaveTaxLots={onSaveTaxLots}
          />
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-400 uppercase">Total Category Value</div>
          <div className="text-xl font-black text-indigo-600">
            ₹{totalCatValueINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SourceRow({
  icon,
  name,
  user,
  hint,
  status,
  lastSync,
  onClick
}: {
  icon: React.ReactNode;
  name: string;
  user: string;
  hint?: string;
  status: string;
  lastSync?: string;
  onClick?: () => void;
  key?: any;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-4 p-4 bg-white border border-slate-100 rounded-xl mb-3 hover:border-indigo-200 transition-colors ${
        onClick ? 'cursor-pointer hover:bg-slate-50' : ''
      }`}
    >
      <div className="flex items-start sm:items-center gap-4 min-w-0">
        <div className="p-2 bg-slate-50 rounded-lg shrink-0">{icon}</div>
        <div className="min-w-0">
          <h5 className="text-sm font-bold text-slate-800">{name}</h5>
          <p className="text-xs text-slate-500">Member: {user}</p>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{hint}</p>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="flex items-center gap-1.5 justify-end mb-1">
          {status === 'Connected' ? (
            <Check size={14} className="text-emerald-500" />
          ) : (
            <FileUp size={14} className="text-indigo-500" />
          )}
          <span
            className={`text-[10px] font-bold uppercase transition-all ${
              status === 'Connected' ? 'text-emerald-600' : 'text-indigo-600'
            }`}
          >
            {status}
          </span>
        </div>
        {lastSync && <p className="text-[10px] text-slate-400 italic">{lastSync}</p>}
      </div>
    </div>
  );
}

function SyncOption({
  title,
  desc,
  icon,
  onClick,
  badge,
  isLinked
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  onClick: () => void;
  badge?: string;
  isLinked?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all group flex items-start gap-4 ${
        isLinked
          ? 'border-emerald-100 bg-emerald-50/20'
          : 'border-slate-100 hover:border-indigo-200 hover:bg-slate-50/50'
      }`}
    >
      <div
        className={`p-3 rounded-xl shadow-sm border transition-transform group-hover:scale-110 ${
          isLinked ? 'bg-emerald-100 border-emerald-100' : 'bg-white border-slate-100'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h5 className="font-bold text-sm text-slate-800">{title}</h5>
          {isLinked ? (
            <span className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[8px] font-black uppercase tracking-tighter flex items-center gap-1">
              <Check size={8} /> Active
            </span>
          ) : (
            badge && (
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[8px] font-black uppercase tracking-tighter">
                {badge}
              </span>
            )
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {isLinked ? 'This account is actively syncing live holdings.' : desc}
        </p>
      </div>
    </button>
  );
}

function MemberRow({
  id,
  name,
  email,
  role,
  accounts,
  isLast,
  onRemove,
  onRename,
  onLeaveSelf,
  currentUserId
}: any) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name || '');

  useEffect(() => {
    setDraftName(name || '');
  }, [name]);

  const canRename = Boolean(onRename) && (id === currentUserId || role === 'Tracked');

  const saveEdit = async () => {
    const clean = draftName.trim();
    if (!clean || clean === name) {
      setEditing(false);
      return;
    }
    await onRename(id, clean);
    setEditing(false);
  };

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between py-3.5 gap-3 ${
        !isLast ? 'border-b border-slate-50' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-[10px] uppercase border border-slate-100">
          {(name || 'U')
            .split(' ')
            .map((n: string) => n[0])
            .join('')}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                aria-label={`Rename ${name}`}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="px-2.5 py-1 text-xs font-bold text-slate-900 bg-slate-50 border border-indigo-300 rounded-lg focus:outline-none w-44 max-w-full"
              />
              <button
                type="button"
                aria-label="Save member name"
                onClick={saveEdit}
                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                aria-label="Cancel member rename"
                onClick={() => setEditing(false)}
                className="p-1 text-slate-400 hover:bg-slate-100 rounded"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h5 className="text-[11px] font-bold text-slate-800 truncate">{name}</h5>
              {id === currentUserId && (
                <span className="text-[8px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1 rounded uppercase font-black">
                  You
                </span>
              )}
              {canRename && (
                <button
                  type="button"
                  aria-label={`Edit name for ${name}`}
                  onClick={() => setEditing(true)}
                  className="p-1 text-slate-300 hover:text-indigo-600 rounded transition-colors"
                  title="Edit Name"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
          <p className="text-[10px] text-slate-400 truncate tracking-tight">{email}</p>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0">
        {!showConfirm ? (
          <>
            <div className="text-right">
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-tighter leading-none mb-0.5">
                Assets
              </p>
              <p className="text-[11px] font-bold text-indigo-600 leading-none">{accounts} Found</p>
            </div>
            <div className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black uppercase text-slate-400 border border-slate-200">
              {role}
            </div>
            {id === currentUserId && onLeaveSelf ? (
              <button
                type="button"
                onClick={onLeaveSelf}
                className="px-2.5 py-1 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-all"
                title="Leave Family"
              >
                Leave
              </button>
            ) : id !== currentUserId ? (
              <button
                type="button"
                aria-label={`Remove ${name} from family`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirm(true);
                }}
                className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                title="Remove Member"
              >
                <Trash size={15} />
              </button>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-2 duration-200">
            <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest mr-1">
              Remove?
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(id);
              }}
              className="px-2 py-1 bg-rose-500 text-white text-[9px] font-black uppercase rounded shadow-sm shadow-rose-200"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowConfirm(false);
              }}
              className="px-2 py-1 bg-slate-200 text-slate-600 text-[9px] font-black uppercase rounded"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
