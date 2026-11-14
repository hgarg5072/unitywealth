/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';


import { 
  TrendingUp, 
  Settings, 
  Users, 
  Plus, 
  Link,
  ArrowUpRight, 
  ArrowDownRight,
  DollarSign,
  Wallet,
  PieChart as PieChartIcon,
  Globe,
  Mail,
  RefreshCw,
  Save,
  Check,
  RefreshCcw,
  FileUp,
  FileText,
  Trash,
  Zap,
  LayoutDashboard,
  Pencil,
  X,
  Sparkles,
  ShieldCheck,
  Download,
  Upload,
  History,
  FileJson,
  XCircle,
  Smartphone,
  QrCode,
  Copy,
  Eye,
  EyeOff,
  Share2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  Legend
} from 'recharts';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  signInWithPopup,
  GoogleAuthProvider
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  getDoc, 
  getDocs,
  updateDoc, 
  setDoc, 
  deleteDoc,
  addDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { handleFirestoreError, OperationType } from './lib/firebase-utils';
import axios from 'axios';
import { DashboardData, Holding, AssetClass, Currency, PortfolioTargets, User, Invite, TargetCategory, TickerWeight, HouseholdSettings } from './types';


function shortenAssetName(name: string): string {
  if (!name) return '';
  let clean = name.trim();

  // 1. Strip ISIN metadata and parenthetical rename/category suffixes
  clean = clean
    .replace(/,?\s*ISIN\s*:\s*[A-Z0-9]+.*$/i, '')
    .replace(/\s*\((formerly|erstwhile|non-demat|equity|debt|hybrid)[^)]*\).*$/i, '')
    .replace(/\s*\([GD]\)\s*$/i, '');

  // 2. Remove folio/scheme code prefixes at the start (e.g., "PP001ZG - ", "102T801 - ", "G202-")
  clean = clean.replace(/^[A-Z0-9]{3,10}\s*[\-–—]\s*(?=[A-Za-z])/i, '');

  // 3. Remove plan/option noise (handles both " - Direct Plan" and tight "-Growth-Regular Plan")
  const stopMarkers = [
    /\s*[\-–—]\s*Direct\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Regular\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Institutional\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Retail\s*(Plan)?.*$/i,
    /\s*[\-–—]\s*Plan\s*[A-Z0-9]+\b.*$/i,
    /\s*[\-–—]\s*(Growth|IDCW|Dividend|Payout|Reinvestment|Bonus)\b.*$/i,
    /\b(Direct|Regular)\s+Plan\b.*$/i,
    /\b(Growth|IDCW)\s+Option\b.*$/i,
  ];
  stopMarkers.forEach((s) => {
    clean = clean.replace(s, '');
  });

  // 4. Abbreviate verbose Indian AMC prefixes & common long words
  const replacements: [RegExp, string][] = [
    [/^Aditya Birla Sun Life\b/i, 'ABSL'],
    [/^Birla Sun Life\b/i, 'ABSL'],
    [/^ICICI Prudential\b/i, 'ICICI Pru'],
    [/^Parag Parikh\b/i, 'PPFAS'],
    [/^Franklin India\b/i, 'Franklin'],
    [/^Templeton India\b/i, 'Templeton'],
    [/^Nippon India\b/i, 'Nippon'],
    [/^Motilal Oswal\b/i, 'Motilal'],
    [/^Kotak Mahindra\b/i, 'Kotak'],
    [/^Mirae Asset\b/i, 'Mirae'],
    [/^Mahindra Manulife\b/i, 'Mahindra'],
    [/^Canara Robeco\b/i, 'Canara'],
    [/^DSP BlackRock\b/i, 'DSP'],
    [/^WhiteOak Capital\b/i, 'WhiteOak'],
    [/^Invesco India\b/i, 'Invesco'],
    [/^Bandhan\b/i, 'Bandhan'],
    [/\bDeveloped World Overseas Equity Passive\b/gi, 'Developed World'],
    [/\bInternational\b/gi, 'Intl'],
    [/\bOpportunities\b/gi, 'Opp'],
    [/\bInfrastructure\b/gi, 'Infra'],
    [/\bTechnology\b/gi, 'Tech'],
    [/\bHealthcare\b/gi, 'Health'],
    [/\bManufacturing\b/gi, 'Mfg'],
    [/\s+and\s+/gi, ' & '],
  ];
  replacements.forEach(([pattern, short]) => {
    clean = clean.replace(pattern, short);
  });

  // 5. Strip trailing "Mutual Fund" / "Fund" / "Scheme" if at least 2 words remain
  const strippedTrailing = clean.replace(/\s+(Mutual\s+Fund|Fund|Scheme|Plan|Option)\s*$/i, '').trim();
  if (strippedTrailing.split(/\s+/).length >= 2) {
    clean = strippedTrailing;
  }

  return clean.replace(/\s*[\-–—,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

function getHoldingOwnerId(h: Pick<Holding, 'userId' | 'ownerId'>): string {
  return h.ownerId || h.userId;
}

function generateClientInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [fxRates, setFxRates] = useState<Record<string, number>>({ INR: 83.5, USD: 1.0 });
  const [activeTab, setActiveTab] = useState<'dashboard' | 'targets' | 'accounts' | 'liveMarkets' | 'rebalance'>('dashboard');
  const [dashboardView, setDashboardView] = useState<'combined' | string>('combined');
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showJoinByCodeModal, setShowJoinByCodeModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [isJoiningFamily, setIsJoiningFamily] = useState(false);
  const [householdInviteCode, setHouseholdInviteCode] = useState<string>('');
  const [copiedInviteField, setCopiedInviteField] = useState<'code' | 'link' | null>(null);
  const [pendingInviteCode, setPendingInviteCode] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCode = (params.get('invite') || params.get('join') || '').trim().toUpperCase().replace(/^UW[\-\s]*/i, '');
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
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'refreshed' | 'error'} | null>(null);
  const [detailView, setDetailView] = useState<{ title: string, filter: (h: Holding) => boolean, categoryContext?: any, totalForeignVal?: number } | null>(null);

  useEffect(() => {
    if (notification) {
      const duration = notification.type === 'error' ? 9000 : 5000;
      const timer = setTimeout(() => setNotification(null), duration);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const [household, setHousehold] = useState<any>(null);

  useEffect(() => {
    // Firebase Auth listener
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Fetch additional profile data from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setUser({ id: firebaseUser.uid, ...userDoc.data() } as User);
          } else {
            console.warn("User profile doc not found for", firebaseUser.uid);
            const userEmail = (firebaseUser.email || '').toLowerCase();
            const userName = firebaseUser.displayName || (userEmail ? userEmail.split('@')[0] : 'Family Member');
            const newUser = {
              email: userEmail,
              name: userName,
              householdId: null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
            setUser({ id: firebaseUser.uid, ...newUser } as User);
          }
        } catch (e: any) {
          console.error("Error fetching user profile", e);
          const fallbackEmail = (firebaseUser.email || '').toLowerCase();
          const fallbackName = firebaseUser.displayName || (fallbackEmail ? fallbackEmail.split('@')[0] : 'Family Member');
          // Even if profile fetch fails, set user state so UI renders smoothly
          setUser({ id: firebaseUser.uid, email: fallbackEmail, name: fallbackName } as User);
        }
      } else {
        setUser(null);
        setHousehold(null);
        setData(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Auth state change error", error);
      setNotification({ message: "Authentication service error. Please try again.", type: 'error' });
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setInvites([]);
      return;
    }
    if (user.householdId) {
      setInvites([]);
      return;
    }

    const q = query(
      collection(db, 'invites'), 
      where('toEmail', '==', user.email.toLowerCase()),
      where('status', '==', 'pending')
    );
    
    const unsubscribe = onSnapshot(q, (snap) => {
      const invs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invite));
      setInvites(invs);
    }, (err) => {
      // Small optimization: only handle error if we are still logged in
      if (auth.currentUser) handleFirestoreError(err, OperationType.LIST, 'invites');
    });

    return () => unsubscribe();
  }, [user?.id, user?.email, user?.householdId]);

  // Listener for Household Data
  useEffect(() => {
    if (!user?.householdId) {
      setHousehold(null);
      setHouseholdInviteCode('');
      return;
    }

    const unsubHH = onSnapshot(doc(db, 'households', user.householdId), async (hhSnap) => {
      if (!hhSnap.exists()) {
        setHousehold(null);
        return;
      }
      const hhData = hhSnap.data();
      
      // Fetch real authenticated members data
      const realMembersData = await Promise.all(
        (hhData.members || []).map(async (mId: string) => {
          try {
            const uDoc = await getDoc(doc(db, 'users', mId));
            return uDoc.exists() ? { id: mId, ...uDoc.data() } : null;
          } catch {
            return null;
          }
        })
      );

      // Merge any manually-tracked family profiles stored in household settings
      const manualMembers: any[] = Array.isArray(hhData.settings?.manualMembers) ? hhData.settings.manualMembers : [];
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
    }, (err) => {
      if (auth.currentUser) handleFirestoreError(err, OperationType.GET, `households/${user.householdId}`);
    });

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

  // Listener for Holdings Data
  useEffect(() => {
    if (!user?.householdId || !household) {
      setData(null);
      return;
    }

    const holdingsQuery = query(collection(db, 'holdings'), where('householdId', '==', user.householdId));
    const unsubHoldings = onSnapshot(holdingsQuery, (hgSnap) => {
      const holdings = hgSnap.docs.map(d => ({ id: d.id, ...d.data() } as Holding));
      setData({
        household: household,
        holdings
      });
      setLoading(false);
    }, (err) => {
      if (auth.currentUser) handleFirestoreError(err, OperationType.LIST, 'holdings');
    });

    return () => unsubHoldings();
  }, [user?.householdId, household]);

  useEffect(() => {
    fetchFxRates();
  }, []);

  const handleGoogleAuth = async () => {
    setLoading(true);
    setNotification(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      setNotification({ message: `Welcome, ${user.displayName || user.email || 'User'}!`, type: 'success' });
      setShowSyncModal(false);
    } catch (e: any) {
      setLoading(false);
      console.error("Google Auth error:", e);
      let msg = e.message;
      if (e.code === 'auth/popup-blocked') {
        msg = "Pop-up was blocked by your browser. Please allow pop-ups for this site, or sign in using Email & Password or the 1-Click Demo.";
      } else if (e.code === 'auth/unauthorized-domain') {
        msg = "This hosted domain is not yet whitelisted in Firebase Auth for Google OAuth. Please sign in with Email & Password or use the 1-Click Demo Account!";
      } else if (e.code === 'auth/account-exists-with-different-credential') {
        msg = "This email is already associated with a password login. Please sign in using your email and password.";
      } else if (e.code === 'auth/popup-closed-by-user') {
        msg = "Google sign-in was closed before completion.";
      } else if (e.code === 'auth/cancelled-popup-request') {
        msg = "Another sign-in pop-up was already opened.";
      }
      setNotification({ message: msg, type: 'error' });
    }
  };

  const fetchInvites = async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(`/api/invites/${user.email}`);
      const json = await res.json();
      setInvites(json);
    } catch (e) {
      console.error(e);
    }
  };

  const [isParsing, setIsParsing] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [selectedImportProvider, setSelectedImportProvider] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user || !targetUserId) return;

    setIsParsing(true);
    setShowSyncModal(false);
    const providerHintUsed = selectedImportProvider;
    const reader = new FileReader();
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    
    reader.onload = async (e) => {
      let base64 = "";
      let textContent = "";

      if (isPDF) {
        base64 = (e.target?.result as string).split(',')[1];
      } else {
        textContent = e.target?.result as string;
      }
      
      try {
        const res = await fetch("/api/gemini/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: isPDF ? base64 : textContent,
            isPDF,
            fileName: file.name,
            providerHint: providerHintUsed
          })
        });
        
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to extract holdings");
        }
        
        const extractedPayload = await res.json();
        const holdings: any[] = Array.isArray(extractedPayload)
          ? extractedPayload
          : (extractedPayload?.holdings || []);
        const detectedProvider: string = providerHintUsed || (!Array.isArray(extractedPayload) && extractedPayload?.provider) || 'CAMS';
        const warningMsg: string | undefined = !Array.isArray(extractedPayload) ? extractedPayload?.warning : undefined;

        console.log("Extracted holdings:", extractedPayload);

        if (holdings.length === 0) {
          setNotification({
            message: warningMsg || "No active open holdings (> 0 units) were found in this statement.",
            type: 'error'
          });
          return;
        }

        const incomingProviders = new Set<string>(
          holdings.map((h: any) => String(h.provider || detectedProvider || 'CAMS'))
        );
        
        if (user.householdId && auth.currentUser) {
          // Ensure user's Firestore profile doc has householdId synced (required by holdings create rule)
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

          const batch = writeBatch(db);
          (data?.holdings || []).forEach((existingH) => {
            const existingOwner = getHoldingOwnerId(existingH);
            const docProvider = String(existingH.provider || 'CAMS');
            if (
              existingOwner === targetUserId &&
              existingH.source === 'PDF' &&
              incomingProviders.has(docProvider) &&
              existingH.id &&
              !String(existingH.id).startsWith('placeholder-')
            ) {
              batch.delete(doc(db, 'holdings', existingH.id));
            }
          });

          holdings.forEach((h: any) => {
            const id = "h_" + Math.random().toString(36).slice(2, 11);
            batch.set(doc(db, 'holdings', id), {
              userId: user.id,
              ownerId: targetUserId,
              householdId: user.householdId,
              ticker: String(h.ticker || h.schemeName || 'MF').slice(0, 50),
              quantity: Number(h.units) || 0,
              assetClass: h.assetClass || 'Mutual Fund',
              currency: h.currency === 'USD' ? 'USD' : 'INR',
              provider: String(h.provider || detectedProvider || 'CAMS'),
              source: 'PDF',
              currentPrice: Number(h.nav) || 0,
              originalName: h.originalName || h.schemeName || '',
              syncedAt: Date.now()
            });
          });
          await batch.commit();
          const targetMemberName = data?.household?.membersData?.find((m: any) => m.id === targetUserId)?.name;
          setNotification({
            message: `Imported ${holdings.length} ${holdings.length === 1 ? 'holding' : 'holdings'} from ${detectedProvider}${targetMemberName ? ` for ${targetMemberName}` : ''} with live prices!`,
            type: 'refreshed'
          });
        } else {
          const saveRes = await fetch('/api/portfolio/bulk-add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: targetUserId,
              householdId: user.householdId,
              provider: detectedProvider,
              holdings
            }),
          });

          const saveText = await saveRes.text();
          let saveResult;
          try {
            saveResult = JSON.parse(saveText);
          } catch (err) {
            console.error("Non-JSON from bulk-add:", saveText);
            throw new Error("Server returned an invalid response (not JSON) during portfolio update.");
          }

          if (saveRes.ok) {
            setNotification({
              message: `Imported ${holdings.length} holdings from ${detectedProvider}!`,
              type: 'refreshed'
            });
          } else {
            setNotification({ message: saveResult.error || 'Failed to save imported holdings.', type: 'error' });
          }
        }
      } catch (parseError: any) {
        console.error("Upload process error:", parseError);
        setNotification({ message: parseError.message || "Error parsing statement", type: 'error' });
      } finally {
        setIsParsing(false);
        setTargetUserId(null);
        setSelectedImportProvider(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setIsParsing(false);
      setNotification({ message: "Failed to read file.", type: 'error' });
    };
    if (isPDF) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  };

  const triggerUpload = (memberId: string, providerHint?: string) => {
    const resolvedMember = (!memberId || memberId === 'combined') ? user?.id : memberId;
    if (!resolvedMember) {
      alert("Please sign in first.");
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
      // We don't setLoading(false) here. 
      // onAuthStateChanged will handle profile fetch and then set loading false.
      // This prevents the "flicker" back to LandingPage before the observer updates the user state.
      setNotification({ message: "Welcome back!", type: 'success' });
    } catch (e: any) {
      setLoading(false); // Only set loading false on error
      let msg = "Error logging in";
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') msg = "Invalid email or password. Please check your credentials.";
      else if (e.code === 'auth/wrong-password') msg = "Incorrect password.";
      else if (e.code === 'auth/too-many-requests') msg = "Too many failed attempts. Please try again later.";
      else if (e.code === 'auth/network-request-failed') msg = "Network error. Please check your connection.";
      else if (e.code === 'auth/operation-not-allowed') msg = "Email/Password sign-in is not enabled in the Firebase Console. Please enable it in the Authentication tab.";
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
      const user = res.user;
      
      // Create profile in Firestore
      const newUser = {
        email: email.toLowerCase(),
        name,
        householdId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', user.uid), newUser);
      
      // onAuthStateChanged will pick up the doc and set user/loading
      setNotification({ message: "Signup successful! Welcome to UnityWealth.", type: 'success' });
    } catch (e: any) {
      setLoading(false); // Only set loading false on error
      let msg = "Error signing up";
      if (e.code === 'auth/email-already-in-use') msg = "An account already exists with this email address. Please log in instead.";
      else if (e.code === 'auth/weak-password') msg = "Password is too weak. Please use at least 6 characters.";
      else if (e.code === 'auth/invalid-email') msg = "Please enter a valid email address.";
      else if (e.code === 'auth/operation-not-allowed') msg = "Email/Password sign-in is not enabled in the Firebase Console. Please enable it in the Authentication tab.";
      else msg = e.message || msg;

      setNotification({ message: msg, type: 'error' });
      throw new Error(msg);
    }
  };

  const forgotPassword = async (email: string) => {
    try {
      setLoading(true);
      // Use the new backend endpoint to check if account exists without needing client-side read permissions
      await axios.post('/api/auth/check-account', { email: email.toLowerCase() });
      
      setNotification({ message: "Account identified. Please set your new password.", type: 'success' });
      return true;
    } catch (e: any) {
      const msg = e.response?.data?.error || "No account found with this email address.";
      setNotification({ message: msg, type: 'error' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string, code: string, pass: string) => {
    try {
      setLoading(true);
      // Directly call our new backend reset endpoint that uses admin SDK
      await axios.post('/api/auth/force-reset-password', { 
        email: email.toLowerCase(), 
        password: pass 
      });
      
      setNotification({ message: "Password updated successfully! Please log in with your new password.", type: 'success' });
      return true;
    } catch (e: any) {
      const msg = e.response?.data?.error || "Failed to update password.";
      setNotification({ message: msg, type: 'error' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const createHousehold = async (name: string) => {
    if (!user) return;
    const trimmedName = (name || '').trim() || `${user.name.split(' ')[0]}'s Family`;
    setLoading(true);
    try {
      const hhId = "h_" + Math.random().toString(36).substr(2, 9);
      const inviteCode = generateClientInviteCode();
      const householdData = {
        name: trimmedName,
        members: [user.id],
        settings: {
          inviteCode
        },
        targets: {
           assetSplit: { Equity: 0.70, Debt: 0.30 },
           equitySplit: { Indian: 0.60, Foreign: 0.40 },
           foreignBreakdown: [
              { name: "Magnificent 7", percentage: 100, tickerWeights: [{ ticker: "GOOGL", weight: 15 }, { ticker: "MSFT", weight: 15 }, { ticker: "AAPL", weight: 15 }, { ticker: "AMZN", weight: 15 }, { ticker: "NVDA", weight: 15 }, { ticker: "META", weight: 15 }, { ticker: "TSLA", weight: 10 }] }
           ]
        }
      };
      await setDoc(doc(db, 'households', hhId), householdData);
      await updateDoc(doc(db, 'users', user.id), { householdId: hhId });
      setHouseholdInviteCode(inviteCode);
      setUser(prev => prev ? { ...prev, householdId: hhId } : null);
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

  const redeemInviteCode = async (rawCode: string, fallbackHouseholdId?: string, firestoreInviteId?: string) => {
    if (!user || !auth.currentUser) return;
    const cleanCode = (rawCode || '').trim().toUpperCase().replace(/^UW[\-\s]*/i, '').replace(/[^A-Z0-9]/g, '');
    if (!cleanCode && !fallbackHouseholdId) {
      setNotification({ message: "Please enter a valid Family Invite Code.", type: 'error' });
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
        throw new Error(payload.error || "Failed to join family household");
      }

      const targetHhId: string = payload.householdId;
      const targetHhName: string = payload.householdName || "Family Portfolio";

      await updateDoc(doc(db, 'users', user.id), { householdId: targetHhId });

      if (firestoreInviteId) {
        try {
          await updateDoc(doc(db, 'invites', firestoreInviteId), { status: 'accepted' });
        } catch {
          // non-fatal if invite doc already updated
        }
      }

      // If switching from a solo household into a shared family household, migrate user's existing holdings cleanly
      if (oldHouseholdId && oldHouseholdId !== targetHhId && previousOwnHoldings.length > 0) {
        try {
          const migBatch = writeBatch(db);
          previousOwnHoldings.forEach((oldH) => {
            const newId = "h_" + Math.random().toString(36).slice(2, 11);
            migBatch.set(doc(db, 'holdings', newId), {
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
            });
            if (oldH.id) {
              migBatch.delete(doc(db, 'holdings', oldH.id));
            }
          });
          await migBatch.commit();
        } catch (migErr) {
          console.warn("Holding migration skipped:", migErr);
        }
      }

      clearPendingInviteParam();
      setShowJoinByCodeModal(false);
      setJoinCodeInput('');
      setDashboardView('combined');
      setActiveTab('dashboard');
      setUser(prev => prev ? { ...prev, householdId: targetHhId } : null);
      setNotification({ message: `Welcome to ${targetHhName}! Combined family view is now active.`, type: 'success' });
    } catch (e: any) {
      console.error("Join family error:", e);
      setNotification({ message: e.message || "Could not join family portfolio.", type: 'error' });
    } finally {
      setIsJoiningFamily(false);
      setLoading(false);
    }
  };

  const joinHousehold = async (inviteId: string) => {
    if (!user) return;
    try {
      const inviteSnap = await getDoc(doc(db, 'invites', inviteId));
      if (!inviteSnap.exists()) throw new Error("Invite not found");
      const invite = inviteSnap.data();
      await redeemInviteCode(invite.inviteCode || '', invite.householdId, inviteId);
    } catch (e: any) {
      setNotification({ message: e.message || "Failed to accept invite", type: 'error' });
    }
  };

  const copyInviteValue = async (mode: 'code' | 'link') => {
    const code = householdInviteCode || household?.settings?.inviteCode || '';
    if (!code) return;
    const value = mode === 'code' ? code : `${window.location.origin}/?invite=${code}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedInviteField(mode);
      setNotification({
        message: mode === 'code' ? `Copied Invite Code: ${code}` : 'Copied shareable Join Family link!',
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
      setNotification({ message: "You cannot remove yourself.", type: 'error' });
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
        if (currentMembers.includes(memberId)) {
          await updateDoc(hhRef, { members: currentMembers.filter((m: string) => m !== memberId) });
        }
        const currentManual: any[] = hhData.settings?.manualMembers || [];
        if (currentManual.some((m: any) => m.id === memberId)) {
          await updateDoc(hhRef, {
            settings: {
              ...(hhData.settings || {}),
              manualMembers: currentManual.filter((m: any) => m.id !== memberId)
            }
          });
        }
      }
      
      const memberHoldings = (data?.holdings || []).filter(
        (h) => getHoldingOwnerId(h) === memberId && h.id && !String(h.id).startsWith('placeholder-')
      );
      if (memberHoldings.length > 0) {
        const delBatch = writeBatch(db);
        memberHoldings.forEach((h) => delBatch.delete(doc(db, 'holdings', h.id)));
        await delBatch.commit();
      }

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
    setData(null);
  };

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');

  // Manual Entry Form State
  const [manualTicker, setManualTicker] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualAssetClass, setManualAssetClass] = useState<AssetClass>('Equity');
  const [manualCurrency, setManualCurrency] = useState<Currency>('INR');
  const [manualProvider, setManualProvider] = useState('');
  const [manualSource, setManualSource] = useState<'Manual' | 'Live'>('Manual');

  const [isInviting, setIsInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  const handleAddManualEntry = async () => {
    if (!user?.householdId || !dashboardView || dashboardView === 'combined') {
      alert("Please select a valid member first");
      return;
    }
    if (!manualName || !manualQty) {
      alert("Please fill at least name and quantity");
      return;
    }
    if (!manualPrice && !manualTicker) {
      alert("Please enter a price or select an asset from the search dropdown");
      return;
    }
    setIsSaving(true);
    try {
      const upperTicker = (manualTicker || 'MANUAL').toUpperCase().slice(0, 50);
      let resolvedCurrency: Currency = manualCurrency || 'USD';
      if (upperTicker.endsWith('.NS') || upperTicker.endsWith('.BO')) {
        resolvedCurrency = 'INR';
      }

      const id = "h_" + Math.random().toString(36).slice(2, 11);
      await setDoc(doc(db, 'holdings', id), {
        userId: user.id,
        ownerId: dashboardView,
        householdId: user.householdId,
        ticker: upperTicker,
        originalName: manualName || upperTicker,
        quantity: parseFloat(manualQty) || 0,
        assetClass: manualAssetClass || 'Equity',
        currency: resolvedCurrency,
        provider: manualProvider || 'Manual',
        source: manualSource || 'Manual',
        currentPrice: parseFloat(manualPrice) || 0,
        syncedAt: Date.now()
      });
      setShowManualEntryModal(false);
      setManualTicker('');
      setManualName('');
      setManualQty('');
      setManualPrice('');
      setManualSource('Manual');
      setNotification({ message: `Added ${manualName || upperTicker} successfully!`, type: 'success' });
    } catch (e) {
      console.error("Add manual entry failed:", e);
      alert("Error adding entry");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMemberManual = async () => {
    if (!user?.householdId || !newMemberName.trim()) return;
    setIsSaving(true);
    try {
      const id = "u_" + Math.random().toString(36).substr(2, 9);
      const manualEntry = {
        id,
        email: (newMemberEmail || `${newMemberName.trim().toLowerCase().replace(/\s+/g, '.')}@family.local`).toLowerCase(),
        name: newMemberName.trim(),
        isManual: true
      };

      const hhRef = doc(db, 'households', user.householdId);
      const hhSnap = await getDoc(hhRef);
      if (hhSnap.exists()) {
        const hhData = hhSnap.data();
        const prevManual: any[] = Array.isArray(hhData.settings?.manualMembers) ? hhData.settings.manualMembers : [];
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
      setNotification({ message: `Added ${manualEntry.name} to your household! You can now import their PDFs/CSVs.`, type: 'success' });
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, 'households/manualMembers');
    } finally {
      setIsSaving(false);
    }
  };

  const sendInvite = async () => {
    if (!user?.householdId || !inviteEmail.trim()) return;
    setIsInviting(true);
    try {
      const cleanEmail = inviteEmail.trim().toLowerCase();
      const codeToShare = householdInviteCode || household?.settings?.inviteCode || generateClientInviteCode();
      const inviteId = "inv_" + Date.now().toString();
      const inviteData = {
        fromUserId: user.id,
        toEmail: cleanEmail,
        householdId: user.householdId,
        householdName: household?.name || 'Family Portfolio',
        inviteCode: codeToShare,
        status: 'pending'
      };
      await setDoc(doc(db, 'invites', inviteId), inviteData);

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
        }
      }

      setInviteSent(true);
      setInviteEmail('');
      setNotification({
        message: `Added pending invite for ${cleanEmail}! Share code ${codeToShare} or the join link for instant access.`,
        type: 'success'
      });
      setTimeout(() => {
        setInviteSent(false);
      }, 3000);
    } catch (e: any) {
      handleFirestoreError(e, OperationType.CREATE, 'invites');
    } finally {
      setIsInviting(false);
    }
  };

  const fetchFxRates = async () => {
    try {
      const res = await fetch('/api/fx-rates');
      const json = await res.json();
      setFxRates(json);
    } catch (e) {
      console.error(e);
      setFxRates({ INR: 83.5, USD: 1.0 });
    }
  };

  const handleRequestCAS = async () => {
    if (!user?.email) return;
    try {
      const res = await fetch('/api/sync/request-cas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      const json = await res.json();
      if (res.ok) {
        setNotification({ message: "CAS Request Sent! CAMS/KFintech will email you. Our system will sync it automatically.", type: 'success' });
        setShowSyncModal(false);
      }
    } catch (e) {
      setNotification({ message: "Error requesting CAS", type: 'error' });
    }
  };

  const handleSendTestEmail = async () => {
    const targetEmail = "hgarg5072@gmail.com";
    try {
      const res = await fetch('/api/debug/send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      if (res.ok) {
        setNotification({ message: `Test email sent to ${targetEmail}. Check your inbox!`, type: 'success' });
      } else {
        setNotification({ message: "Failed to send test email. Check server logs.", type: 'error' });
      }
    } catch (e) {
      setNotification({ message: "Error sending test email", type: 'error' });
    }
  };

  const handleTriggerRebalanceCheck = async () => {
    if (!data?.household?.id) return;
    try {
      const res = await fetch('/api/rebalance/check-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId: data.household.id }),
      });
      if (res.ok) {
        setNotification({ message: "Rebalance check triggered! If accuracy is below threshold, an email will be sent.", type: 'success' });
      } else {
        setNotification({ message: "Failed to trigger rebalance check.", type: 'error' });
      }
    } catch (e) {
      setNotification({ message: "Error triggering rebalance check", type: 'error' });
    }
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
          holdings: currentHoldings.map(h => ({
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
          const batch = writeBatch(db);
          const now = Date.now();
          entries.forEach(([id, u]) => {
            if (typeof u.currentPrice === 'number' && u.currentPrice > 0) {
              batch.update(doc(db, 'holdings', id), {
                currentPrice: u.currentPrice,
                priceUpdatedAt: now
              });
            }
          });
          await batch.commit();
        }
        await fetchFxRates();
        setNotification({ message: `Refreshed live prices (${entries.length} updated)!`, type: 'refreshed' });
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

  const saveSettings = async (settings: { enabled: boolean, threshold: number }) => {
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

  const stats = useMemo(() => {
    if (!data) return null;
    const rate = fxRates.INR;

    // Filter holdings based on the selected view
    const filteredHoldings = dashboardView === 'combined' 
      ? data.holdings 
      : data.holdings.filter(h => getHoldingOwnerId(h) === dashboardView);

    const holdingsWithVal = filteredHoldings.map(h => {
      // Re-map arbitrage funds to Debt as per user preference
      let effectiveAssetClass = h.assetClass;
      let effectiveCurrency = h.currency;
      const lowerName = (h.originalName || '').toLowerCase();
      const lowerTicker = (h.ticker || '').toLowerCase();
      
      if (lowerName.includes('arbitrage') || lowerTicker.includes('arbitrage')) {
        effectiveAssetClass = 'Debt' as any;
      }
      
      // Fix for Qualcomm/US Stocks for Nisha and others
      if (lowerName.includes('qualcomm') || lowerTicker.includes('qcom')) {
        effectiveCurrency = 'USD';
        effectiveAssetClass = 'Equity' as any;
      }

      const valINR = effectiveCurrency === 'USD' ? h.quantity * h.currentPrice * fxRates.INR : h.quantity * h.currentPrice;
      const valUSD = effectiveCurrency === 'USD' ? h.quantity * h.currentPrice : (h.quantity * h.currentPrice) / fxRates.INR;
      return { ...h, assetClass: effectiveAssetClass, currency: effectiveCurrency, valUSD, valINR };
    });

    // Inject Target-only placeholders for requested visibility
    if (data.household.targets.foreignBreakdown) {
      const existingTickers = new Set(holdingsWithVal.map(h => h.ticker.toUpperCase()));
      data.household.targets.foreignBreakdown.forEach(cat => {
        if (cat.tickerWeights) {
          cat.tickerWeights.forEach((tw: any) => {
            if (!existingTickers.has(tw.ticker.toUpperCase())) {
              holdingsWithVal.push({
                id: `placeholder-${tw.ticker}`,
                userId: dashboardView === 'combined' ? (data.household.membersData?.[0]?.id || 'unknown') : dashboardView,
                householdId: data.household.id,
                ticker: tw.ticker.toUpperCase(),
                originalName: tw.ticker,
                quantity: 0,
                currentPrice: 0, // Will be updated by price fetch logic later or show as 0
                assetClass: 'Equity',
                currency: 'USD',
                provider: 'Manual',
                source: 'Manual',
                valINR: 0,
                valUSD: 0,
                isPlaceholder: true
              } as any);
              existingTickers.add(tw.ticker.toUpperCase());
            }
          });
        }
      });
    }

    const totalValINR = holdingsWithVal.reduce((sum, h) => sum + h.valINR, 0);
    const totalValUSD = totalValINR / rate;
    
    // Member Contributions
    const memberContributions = (data.household.membersData || []).map(m => {
      const memberVal = holdingsWithVal.filter(h => !(h as any).isPlaceholder && getHoldingOwnerId(h) === m.id).reduce((s, h) => s + h.valINR, 0);
      return {
        id: m.id,
        name: m.name,
        value: memberVal,
        percentage: totalValINR > 0 ? memberVal / totalValINR : 0
      };
    }).sort((a,b) => b.value - a.value);

    // Asset Hierarchy
    const equityValINR = holdingsWithVal.filter(h => h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund').reduce((sum, h) => sum + h.valINR, 0);
    const debtValINR = holdingsWithVal.filter(h => h.assetClass === 'Debt').reduce((sum, h) => sum + h.valINR, 0);
    
    const indianEquityValINR = holdingsWithVal.filter(h => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'INR').reduce((sum, h) => sum + h.valINR, 0);
    const foreignEquityValINR = holdingsWithVal.filter(h => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD').reduce((sum, h) => sum + h.valINR, 0);

    const actualEquityPct = totalValINR > 0 ? equityValINR / totalValINR : 0;
    const actualDebtPct = totalValINR > 0 ? debtValINR / totalValINR : 0;
    
    const targetEquityPct = data.household.targets.assetSplit?.Equity ?? 0.7;
    const targetDebtPct = data.household.targets.assetSplit?.Debt ?? 0.3;
    const equityDrift = actualEquityPct - targetEquityPct;

    // Sub-split: Indian vs Foreign (as % of Equity)
    const actualIndianEquityPctOfEquity = equityValINR > 0 ? indianEquityValINR / equityValINR : 0;
    const actualForeignEquityPctOfEquity = equityValINR > 0 ? foreignEquityValINR / equityValINR : 0;
    
    const targetIndianEquityOfEquity = data.household.targets.equitySplit?.Indian ?? 0.5;
    const targetForeignEquityOfEquity = data.household.targets.equitySplit?.Foreign ?? 0.5;

    // Foreign Breakdown (% of Foreign Equity)
    const allForeignUSD = holdingsWithVal.filter(h => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD');
    const mappedTickers = new Set<string>();
    
    const foreignBreakdownStats = (data.household.targets.foreignBreakdown || []).map(cat => {
      const tickers = (cat.tickerWeights || []).map((tw: any) => tw.ticker.toUpperCase());
      tickers.forEach((t: string) => mappedTickers.add(t));

      const actualVal = allForeignUSD.filter(h => 
        tickers.includes(h.ticker.toUpperCase())
      ).reduce((s, h) => s + h.valINR, 0);
      
      const actualPctOfForeign = foreignEquityValINR > 0 ? actualVal / foreignEquityValINR : 0;
      const actualPctOfTotal = totalValINR > 0 ? actualVal / totalValINR : 0;
      
      return {
        ...cat,
        actualVal,
        actualPctOfForeign,
        actualPctOfTotal,
        drift: actualPctOfForeign - (cat.percentage / 100)
      };
    });

    const unmappedForeign = allForeignUSD.filter(h => !mappedTickers.has(h.ticker.toUpperCase()));
    if (unmappedForeign.length > 0) {
      const unmappedVal = unmappedForeign.reduce((s, h) => s + h.valINR, 0);
      foreignBreakdownStats.push({
        id: 'unmapped',
        name: 'Unmapped / Others',
        percentage: 0,
        actualVal: unmappedVal,
        actualPctOfForeign: foreignEquityValINR > 0 ? unmappedVal / foreignEquityValINR : 0,
        drift: foreignEquityValINR > 0 ? unmappedVal / foreignEquityValINR : 0,
        isUnmapped: true,
        tickerWeights: []
      } as any);
    }

    return {
      totalValINR,
      totalValUSD,
      equityValINR,
      debtValINR,
      indianEquityValINR,
      foreignEquityValINR,
      actualEquityPct,
      actualDebtPct,
      targetEquityPct,
      targetDebtPct,
      equityDrift,
      actualIndianEquityPctOfEquity,
      actualForeignEquityPctOfEquity,
      targetIndianEquityOfEquity,
      targetForeignEquityOfEquity,
      memberContributions,
      foreignBreakdownStats,
      holdings: holdingsWithVal
    };
  }, [data, fxRates, dashboardView]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-screen bg-slate-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      );
    }
    if (!user) return <LandingPage onLogin={login} onSignup={signup} onForgot={forgotPassword} onReset={resetPassword} onGoogleLogin={handleGoogleAuth} pendingInviteCode={pendingInviteCode} />;
    if (!user.householdId) return <HouseholdSetup onCreate={createHousehold} onJoin={joinHousehold} onJoinByCode={redeemInviteCode} isJoining={isJoiningFamily} initialCode={pendingInviteCode} invites={invites} />;
    if (!data || !data.household || !stats) {
      return (
        <div className="p-8 text-center bg-slate-50 min-h-screen flex flex-col items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Syncing Data...</h3>
            <p className="text-sm text-slate-500 mb-6">We're securely fetching your latest portfolio valuations.</p>
            <button onClick={() => logout()} className="w-full bg-indigo-50 text-indigo-600 font-bold py-3 rounded-xl hover:bg-indigo-100 transition-colors">Emergency Logout</button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-screen bg-[#F8FAFC] text-slate-900 font-sans overflow-hidden relative">
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
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 p-6 flex flex-col shrink-0 transition-transform duration-300 lg:static lg:translate-x-0
        ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-800">UnityWealth</span>
          </div>
          <button onClick={() => setIsMenuOpen(false)} className="lg:hidden p-1 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Navigation</div>
          <SidebarBtn active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setIsMenuOpen(false); }} icon={<PieChartIcon size={20} />} label="Dashboard" />
          <SidebarBtn active={activeTab === 'liveMarkets'} onClick={() => { setActiveTab('liveMarkets'); setIsMenuOpen(false); }} icon={<Zap size={20} />} label="Live Markets" />
          <SidebarBtn active={activeTab === 'targets'} onClick={() => { setActiveTab('targets'); setIsMenuOpen(false); }} icon={<Settings size={20} />} label="Target Manager" />
          <SidebarBtn active={activeTab === 'accounts'} onClick={() => { setActiveTab('accounts'); setIsMenuOpen(false); }} icon={<Link size={20} />} label="Connection Manager" />
        </nav>

        <div className="pt-8 border-t border-slate-100 flex flex-col h-full">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Account Sync</div>
            <button onClick={() => setActiveTab('accounts')} className="text-[10px] font-bold text-indigo-600 hover:underline">MANAGE</button>
          </div>
          <div className="space-y-4">
            <AccountStatusItem label="US Brokers (USD)" isActive={!!data?.holdings?.some(h => h.currency === 'USD')} />
            <AccountStatusItem label="NSE & Finnhub" isActive={true} />
            <AccountStatusItem label="CAMS / Zerodha" isActive={!!data?.holdings?.some(h => h.currency === 'INR')} />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-50 border-2 border-white shadow-sm flex items-center justify-center text-indigo-600 font-bold">
              {user.name.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{user.name}</p>
              <p className="text-xs text-slate-500">Premium Plan</p>
            </div>
          </div>
          <button onClick={logout} className="text-xs text-rose-500 font-bold hover:underline text-left">Logout Session</button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 lg:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 shrink-0">
          <div className="flex items-center space-x-2 md:space-x-4">
            <button 
              onClick={() => setIsMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:bg-slate-50 rounded-lg"
            >
              <LayoutDashboard size={20} />
            </button>
            <div className="h-6 w-px bg-slate-200 hidden md:block mx-2"></div>
            <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-medium max-w-[300px] sm:max-w-none overflow-x-auto no-scrollbar">
              <button 
                onClick={() => setDashboardView('combined')}
                className={`px-3 py-1 rounded shadow-sm transition-all ${dashboardView === 'combined' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Combined View
              </button>
              {data.household.membersData?.map((m: any) => (
                <button 
                  key={m.id} 
                  onClick={() => {
                    setDashboardView(m.id);
                    setActiveTab('dashboard');
                  }}
                  className={`px-3 py-1 rounded transition-all ${dashboardView === m.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => triggerUpload(dashboardView !== 'combined' ? dashboardView : user.id)}
                disabled={isParsing}
                className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
              >
                {isParsing ? <RefreshCcw size={14} className="animate-spin text-indigo-500" /> : <FileUp size={14} />}
                {isParsing ? "PARSING..." : "IMPORT PDF / CSV"}
              </button>
              {dashboardView !== 'combined' && (
                <button 
                  onClick={() => setShowManualEntryModal(true)}
                  className="flex items-center gap-2 px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-sm active:scale-95"
                >
                  <Plus size={14} /> MANUAL ENTRY
                </button>
              )}
            </div>
          </div>
            <div className="flex items-center space-x-3 md:space-x-6">
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                USD / INR
              </div>
              <div className="text-sm font-mono font-black text-slate-800">
                ₹{fxRates.INR.toFixed(2)}
              </div>
            </div>
            <div className="h-8 w-px bg-slate-100 hidden sm:block mx-1"></div>
            <div className="flex items-center space-x-2 text-xs md:text-sm font-medium text-slate-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse hidden xs:block"></span>
              <span className="whitespace-nowrap">Live Sync</span>
            </div>
            <button 
              onClick={refreshPrices}
              disabled={isSaving}
              className={`p-2 text-slate-400 hover:text-slate-600 ${isSaving ? 'animate-spin' : ''}`}
            >
              <RefreshCcw size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-x-hidden overflow-y-auto px-2 sm:px-4 md:p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard" 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }} 
                className="flex flex-col lg:grid lg:grid-cols-12 gap-4 md:gap-6 w-full max-w-full overflow-x-hidden"
              >
                <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                  <StatCardModern label={dashboardView === 'combined' ? "Combined Net Worth" : `${data.household.membersData?.find((m: any) => m.id === dashboardView)?.name}'s Portfolio`} value={`₹${stats.totalValINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} subValue={`$${stats.totalValUSD.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
                  <StatCardModern label="Indian Portfolio" value={`₹${(stats.holdings.filter(h => h.currency === 'INR').reduce((s, h) => s + h.quantity * h.currentPrice, 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} subValue="Mutual Funds & Debt" isSecondary />
                  <StatCardModern label="Foreign Portfolio" value={`$${(stats.holdings.filter(h => h.currency === 'USD').reduce((s, h) => s + h.quantity * h.currentPrice, 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} subValue="US Equities" isSecondary />
                  <StatCardModern label="Allocation Accuracy" value={`${(100 - Math.abs(stats.equityDrift) * 100).toFixed(1)}%`} subValue={`${(Math.abs(stats.equityDrift) * 100).toFixed(1)}% Drift detected`} isAlert={Math.abs(stats.equityDrift) > 0.05} />
                </div>

                <div className="flex flex-col gap-4 md:gap-6 lg:col-span-8 w-full min-w-0">
                  <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-100 sm:border-slate-200 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Primary Allocation</h3>
                      <button onClick={() => setActiveTab('targets')} className="text-xs md:text-sm text-indigo-600 font-semibold hover:underline">Adjust Strategy</button>
                    </div>
                    <div className="space-y-8">
                      <DriftProgressBar 
                        label="Global Equities" 
                        actual={stats.actualEquityPct} 
                        target={stats.targetEquityPct} 
                        value={`₹${(stats.equityValINR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} 
                        color="bg-indigo-500" 
                        onClick={() => setDetailView({ title: 'Global Equities', filter: (h) => h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund' })}
                      />
                      <DriftProgressBar 
                        label="Fixed Income & Cash" 
                        actual={stats.actualDebtPct} 
                        target={stats.targetDebtPct} 
                        value={`₹${(stats.debtValINR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} 
                        color="bg-emerald-400" 
                        onClick={() => setDetailView({ title: 'Fixed Income & Cash', filter: (h) => h.assetClass === 'Debt' })}
                      />
                    </div>
                  </div>

                  <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-100 sm:border-slate-200 shadow-sm">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-6">Equity Breakdown</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8">
                      <DriftProgressBar 
                        label="Indian Equity (of Total Equity)" 
                        actual={stats.actualIndianEquityPctOfEquity} 
                        target={stats.targetIndianEquityOfEquity} 
                        value={`₹${(stats.indianEquityValINR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} 
                        color="bg-orange-400" 
                        onClick={() => setDetailView({ title: 'Indian Equities', filter: (h) => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'INR' })}
                      />
                      <DriftProgressBar 
                        label="Foreign Equity (of Total Equity)" 
                        actual={stats.actualForeignEquityPctOfEquity} 
                        target={stats.targetForeignEquityOfEquity} 
                        value={`₹${(stats.foreignEquityValINR).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} 
                        color="bg-blue-400" 
                        onClick={() => setDetailView({ title: 'Foreign Equities', filter: (h) => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD' })}
                      />
                    </div>
                  </div>

                  {stats.foreignBreakdownStats.length > 0 && (
                    <div className="bg-white p-4 md:p-6 rounded-xl border border-slate-100 sm:border-slate-200 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Foreign Equity Granular Drift</h3>
                        <button onClick={() => setActiveTab('targets')} className="text-sm text-indigo-600 font-semibold hover:underline">Edit Themes</button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {stats.foreignBreakdownStats.map((stat, idx) => (
                            <CompactDriftRow 
                             key={idx}
                             label={stat.name} 
                             actual={stat.actualPctOfForeign} 
                             target={stat.percentage / 100} 
                             value={`₹${stat.actualVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} 
                             onClick={() => setDetailView({ 
                               title: stat.name, 
                               filter: (h) => {
                                 const tickers = (stat.tickerWeights || []).map((tw: any) => tw.ticker.toUpperCase());
                                 if (stat.isUnmapped) {
                                   const mapped = new Set();
                                   (data.household.targets.foreignBreakdown || []).forEach((c: any) => c.tickerWeights?.forEach((tw:any) => mapped.add(tw.ticker.toUpperCase())));
                                   return (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD' && !mapped.has(h.ticker.toUpperCase());
                                 }
                                 return (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD' && tickers.includes(h.ticker.toUpperCase());
                               },
                               categoryContext: stat,
                               totalForeignVal: stats.foreignEquityValINR
                             })}
                           />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4 md:gap-6 lg:col-span-4 w-full">
                  {dashboardView === 'combined' && (
                    <div className="bg-indigo-50/80 sm:bg-white p-5 md:p-6 rounded-xl border-t-4 border-t-indigo-500 sm:border-t-slate-200 border-x-indigo-100/50 border-b-indigo-100/50 sm:border-slate-200 shadow-lg sm:shadow-sm ring-1 ring-indigo-500/10 sm:ring-0">
                      <h3 className="text-sm font-black text-indigo-900 mb-4 uppercase tracking-widest">Family Contributions</h3>
                      <div className="space-y-4">
                        {stats.memberContributions.map(m => (
                          <div key={m.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-bold text-slate-700">{m.name}</span>
                              <span className="text-xs font-black text-indigo-600">{(m.percentage * 100).toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${m.percentage * 100}%` }} className="h-full bg-indigo-500" />
                            </div>
                            <div className="mt-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                              Contribution: ₹{m.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-emerald-50/30 sm:bg-white p-5 md:p-6 rounded-xl border-t-4 border-t-emerald-500 sm:border-t-slate-200 border-x-emerald-100/50 border-b-emerald-100/50 sm:border-slate-200 shadow-lg sm:shadow-sm ring-1 ring-emerald-500/5 sm:ring-0">
                    <h3 className="text-sm font-black text-emerald-900 sm:text-slate-800 mb-4 uppercase tracking-widest">Currency Mix</h3>
                    <div className="h-2 flex rounded-full overflow-hidden mb-4">
                       <div className="bg-orange-500 h-full" style={{ width: `${(stats.indianEquityValINR / stats.totalValINR) * 100}%` }}></div>
                       <div className="bg-blue-600 h-full" style={{ width: `${(stats.foreignEquityValINR / stats.totalValINR) * 100}%` }}></div>
                       <div className="bg-emerald-400 h-full" style={{ width: `${(stats.debtValINR / stats.totalValINR) * 100}%` }}></div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500"></div><span>INR Equity</span></div>
                        <span>{( (stats.indianEquityValINR / (stats.totalValINR||1)) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-medium">
                        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-600"></div><span>USD Equity</span></div>
                        <span>{( (stats.foreignEquityValINR / (stats.totalValINR||1)) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-medium">
                        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-400"></div><span>Debt & Cash</span></div>
                        <span>{( (stats.debtValINR / (stats.totalValINR||1)) * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {dashboardView !== 'combined' && (
                  <div className="md:col-span-12 bg-white p-4 md:p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-base md:text-lg font-bold text-slate-800">Holdings Details</h3>
                      <div className="text-xs text-slate-500 font-medium">Real-time market values</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-100 pb-3">
                            <th className="pb-4 pt-0 text-xs font-bold text-slate-400 uppercase tracking-widest">Asset Name</th>
                            <th className="pb-4 pt-0 text-xs font-bold text-slate-400 uppercase tracking-widest">Units</th>
                            <th className="pb-4 pt-0 text-xs font-bold text-slate-400 uppercase tracking-widest">Price</th>
                            <th className="pb-4 pt-0 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Value (INR)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {stats.holdings.sort((a,b) => b.valINR - a.valINR).map((h: any) => (
                            <tr key={h.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-4">
                                <div className="flex items-center gap-2">
                                  <div className="font-bold text-slate-800 text-sm" title={h.originalName || h.ticker}>{shortenAssetName(h.originalName || h.ticker)}</div>
                                  <a 
                                    href={`https://www.google.com/search?q=${encodeURIComponent((h.originalName || h.ticker) + ' price')}`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="text-slate-400 hover:text-indigo-600 transition-colors"
                                    title="Search on Google"
                                  >
                                    <Globe size={12} />
                                  </a>
                                </div>
                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2 flex-wrap mt-0.5">
                                  <span className="font-mono">{h.ticker}</span>
                                  <span>•</span>
                                  <span>{h.assetClass}</span>
                                  {h.provider && h.provider !== 'Manual' && (
                                    <>
                                      <span>•</span>
                                      <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase">{h.provider}</span>
                                    </>
                                  )}
                                  {(h.source === 'PDF' || h.source === 'PDF Import') && <span className="bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md border border-amber-200/50 text-[9px] font-black uppercase">STATEMENT</span>}
                                  {h.source === 'Sync' && <span className="bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-md border border-violet-200/50 text-[9px] font-black uppercase">SYNC</span>}
                                  {(h.source === 'Manual' || !h.source) && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md border border-blue-200/50 text-[9px] font-black uppercase">Manual</span>}
                                  {h.ticker && h.ticker !== 'MANUAL' && h.currentPrice > 0 && <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-md border border-emerald-200/50 flex items-center gap-1 text-[9px] font-black uppercase"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>LIVE</span>}
                                </div>
                              </td>
                              <td className="py-4 text-sm text-slate-600 tabular-nums">
                                {h.quantity.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                              </td>
                              <td className="py-4 text-sm tabular-nums">
                                <span className="text-slate-400 mr-1">{h.currency}</span>
                                <span className="font-medium text-slate-700">{h.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                              </td>
                              <td className="py-4 text-sm font-bold text-slate-900 text-right tabular-nums">
                                ₹{h.valINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="col-span-12 bg-slate-900 rounded-xl p-8 text-white flex items-center justify-between">
                  <div>
                    <div className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-1">Unity Intelligence: Smart Suggestions</div>
                    <div className="text-xl font-medium">To achieve your {stats.targetEquityPct * 100}/{stats.targetDebtPct * 100} target, move ₹{Math.abs(stats.equityDrift * stats.totalValINR).toLocaleString('en-IN', { maximumFractionDigits: 0 })} from {stats.equityDrift > 0 ? 'Equity' : 'Debt'} into {stats.equityDrift > 0 ? 'Debt Funds' : 'Equity'}.</div>
                    <div className="text-slate-400 text-sm mt-2 font-light">Optimal tax harvesting identified in family accounts. Currency hedging recommended.</div>
                  </div>
                  <button 
                    onClick={() => setActiveTab('rebalance')}
                    className="px-6 py-4 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold transition-all shadow-lg active:scale-95 whitespace-nowrap ml-8"
                  >
                    Review Rebalance Orders
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'liveMarkets' && (
              <motion.div key="liveMarkets" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <LiveMarketsView 
                  holdings={data.holdings} 
                  members={data.household.membersData || []} 
                  householdId={user.householdId || undefined} 
                />
              </motion.div>
            )}

            {activeTab === 'rebalance' && (
              <motion.div key="rebalance" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <RebalanceView stats={stats} fxRates={fxRates} />
              </motion.div>
            )}

            {activeTab === 'targets' && (
              <motion.div key="targets" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-4xl mx-auto space-y-8">
                <TargetForm 
                  initialTargets={data.household.targets} 
                  initialSettings={data.household.settings}
                  onSave={saveTargets} 
                  onSaveSettings={saveSettings}
                  isSaving={isSaving} 
                  allTickers={Array.from(new Set(data.holdings.map(h => h.ticker)))} 
                  householdId={user.householdId || undefined}
                />
              </motion.div>
            )}

            {activeTab === 'accounts' && (
              <motion.div key="accounts" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-4xl mx-auto space-y-6">
                <div className="bg-white p-4 md:p-8 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div><h3 className="text-lg md:text-xl font-bold mb-1 text-slate-800">Connection Manager</h3><p className="text-slate-500 text-xs md:text-sm">Linked sources for your family portfolio</p></div>
                    <div className="flex flex-wrap gap-2 md:gap-3">
                      <button onClick={() => setShowInviteModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-3 md:px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:bg-indigo-700 transition-all shadow-sm">
                        <Users size={16} /> Invite Family
                      </button>
                      <button onClick={() => { setJoinCodeInput(pendingInviteCode || ''); setShowJoinByCodeModal(true); }} className="flex items-center gap-2 border border-emerald-200 text-emerald-700 bg-emerald-50/50 px-3 md:px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:bg-emerald-50 transition-all">
                        <Share2 size={16} /> Join Family
                      </button>
                      <button onClick={() => setShowSyncModal(true)} className="flex items-center gap-2 border border-slate-200 text-slate-600 px-3 md:px-4 py-2 rounded-lg font-bold text-xs md:text-sm hover:bg-slate-50 transition-all">
                        <Plus size={16} /> Import Data
                      </button>
                    </div>
                  </div>

                  {(householdInviteCode || data.household.settings?.inviteCode) && (
                    <div className="mb-8 p-4 md:p-5 rounded-2xl bg-gradient-to-r from-indigo-50/80 via-white to-emerald-50/50 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1">Family Invite Code • Share to Link Accounts</div>
                        <p className="text-xs text-slate-600">
                          Family members can enter code <span className="font-mono font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">{householdInviteCode || data.household.settings?.inviteCode}</span> under <strong>Join Family</strong> (no email setup needed).
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => copyInviteValue('code')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all"
                        >
                          {copiedInviteField === 'code' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          Copy Code
                        </button>
                        <button
                          type="button"
                          onClick={() => copyInviteValue('link')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 rounded-xl text-xs font-bold text-white hover:bg-indigo-700 transition-all shadow-sm"
                        >
                          {copiedInviteField === 'link' ? <Check size={14} /> : <Share2 size={14} />}
                          Copy Join Link
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-6">
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Household Members ({data.household.name})</h4>
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
                             role={m.isManual ? "Tracked" : (idx === 0 ? "Admin" : "Member")} 
                             accounts={data.holdings.filter(h => getHoldingOwnerId(h) === m.id).length}
                             isLast={idx === (data.household.membersData?.length || 0) - 1}
                             onRemove={removeMember}
                             currentUserId={user.id}
                           />
                        ))}
                      </div>
                    </section>



                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">India Accounts (Mutual Funds & Equities)</h4>
                        <span className="text-[10px] text-slate-400 font-semibold">Click any broker to upload PDF or CSV</span>
                      </div>
                      {[
                        {
                          provider: 'CAMS',
                          name: 'CAMS / KFintech / MFCentral CAS',
                          hint: 'Upload unlocked CAS Holdings Valuation PDF (not Capital Gains) — auto-links ISINs to live AMFI NAVs',
                          match: (h: Holding) => h.provider === 'CAMS' || h.provider === 'KFintech' || (h.source === 'PDF' && h.currency === 'INR' && h.assetClass !== 'Equity')
                        },
                        {
                          provider: 'Zerodha',
                          name: 'Zerodha (Kite / Console / Coin)',
                          hint: 'Console → Portfolio → Holdings → Download CSV or PDF — auto-links NSE/BSE stocks & Coin MFs',
                          match: (h: Holding) => h.provider === 'Zerodha'
                        },
                        {
                          provider: 'INDmoney',
                          name: 'INDmoney (US Stocks & India Portfolio)',
                          hint: 'Upload INDmoney US Stocks (DriveWealth/Alpaca) or Indian Portfolio PDF / CSV',
                          match: (h: Holding) => h.provider === 'INDmoney'
                        }
                      ].map((src) => {
                        const activeMemberId = dashboardView !== 'combined' ? dashboardView : user.id;
                        const activeMemberName = data.household.membersData?.find((m: any) => m.id === activeMemberId)?.name || 'You';
                        const count = data.holdings.filter(h => getHoldingOwnerId(h) === activeMemberId && src.match(h)).length;
                        return (
                          <SourceRow
                            key={src.provider}
                            icon={<FileText className={count > 0 ? "text-emerald-500" : "text-indigo-500"} />}
                            name={src.name}
                            user={activeMemberName}
                            hint={src.hint}
                            status={count > 0 ? "Connected" : "Upload PDF/CSV"}
                            lastSync={count > 0 ? `${count} active ${count === 1 ? 'holding' : 'holdings'}` : undefined}
                            onClick={() => triggerUpload(activeMemberId, src.provider)}
                          />
                        );
                      })}
                    </section>

                    <section className="pt-4 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">US Stock Brokerages (Live USD via Finnhub)</h4>
                        <span className="text-[10px] text-slate-400 font-semibold">Each broker syncs independently</span>
                      </div>
                      {[
                        {
                          provider: 'Charles Schwab',
                          name: 'Charles Schwab',
                          hint: 'Accounts → Positions → Export CSV, or upload Monthly Brokerage Statement PDF'
                        },
                        {
                          provider: 'IBKR',
                          name: 'Interactive Brokers (IBKR)',
                          hint: 'Performance & Reports → Statements → Activity / Open Positions CSV or PDF'
                        },
                        {
                          provider: 'E*TRADE',
                          name: 'E*TRADE (Morgan Stanley)',
                          hint: 'Accounts → Portfolios → Download CSV, or upload Brokerage / Vested RSU PDF'
                        }
                      ].map((src) => {
                        const activeMemberId = dashboardView !== 'combined' ? dashboardView : user.id;
                        const activeMemberName = data.household.membersData?.find((m: any) => m.id === activeMemberId)?.name || 'You';
                        const count = data.holdings.filter(h => getHoldingOwnerId(h) === activeMemberId && h.provider === src.provider).length;
                        return (
                          <SourceRow
                            key={src.provider}
                            icon={<Globe className={count > 0 ? "text-emerald-500" : "text-blue-500"} />}
                            name={src.name}
                            user={activeMemberName}
                            hint={src.hint}
                            status={count > 0 ? "Connected" : "Upload CSV/PDF"}
                            lastSync={count > 0 ? `${count} active ${count === 1 ? 'position' : 'positions'}` : undefined}
                            onClick={() => triggerUpload(activeMemberId, src.provider)}
                          />
                        );
                      })}
                    </section>

                    <section className="pt-6 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">System Delivery Status</h4>
                        <div className="flex gap-2">
                          <button 
                            onClick={handleSendTestEmail}
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md transition-colors"
                          >
                            SEND TEST EMAIL
                          </button>
                          <button 
                            onClick={handleTriggerRebalanceCheck}
                            className="text-[10px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 px-2 py-1 rounded-md transition-colors"
                          >
                            FORCE CHECK NOW
                          </button>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Email Gateway (Resend)</span>
                          <span className={`font-bold ${process.env.NODE_ENV === 'production' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {process.env.NODE_ENV === 'production' ? '● Connected' : '○ Testing Mode'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Google OAuth (Gmail)</span>
                          <span className="text-slate-400 font-medium">Ready for sync</span>
                        </div>
                        <p className="text-[10px] text-slate-400 italic mt-2">
                          Note: All system emails are currently redirected to <strong>hgarg5072@gmail.com</strong> for testing. 
                          To invite others, you must verify your domain at <a href="https://resend.com/domains" target="_blank" className="text-indigo-600 hover:underline">resend.com/domains</a>.
                        </p>
                      </div>
                    </section>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          className="hidden" 
          accept="application/pdf,text/csv,text/tab-separated-values,.pdf,.csv,.tsv,.txt" 
        />

        <AnimatePresence>
          {detailView && (
            <DetailViewModal 
              title={detailView.title} 
              holdings={stats.holdings.filter(detailView.filter)} 
              onClose={() => setDetailView(null)} 
              fxRates={fxRates} 
              members={data.household.membersData || []}
              setNotification={setNotification}
              categoryContext={detailView.categoryContext}
              totalForeignVal={detailView.totalForeignVal}
              setManualTicker={setManualTicker}
              setManualName={setManualName}
              setManualSource={setManualSource}
              setManualProvider={setManualProvider}
              setManualCurrency={setManualCurrency}
              setManualAssetClass={setManualAssetClass}
              setShowManualEntryModal={setShowManualEntryModal}
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
                  Extracting active holdings from your {selectedImportProvider || "brokerage"} statement and linking live market prices (10-15s).
                </p>
                <div className="mt-8 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: "0%" }} 
                    animate={{ width: "100%" }} 
                    transition={{ duration: 15, ease: "linear" }}
                    className="h-full bg-indigo-600"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Notification Toast removed from here and moved to top-level return */}

        {/* Invite Modal */}
        <AnimatePresence>
          {showInviteModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg text-slate-800">Invite Family Member</h3>
                  <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="p-6 space-y-5">
                  <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Instant Invite Code (Recommended)</span>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Works Immediately</span>
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
                      {copiedInviteField === 'link' ? <Check size={14} /> : <Share2 size={14} />}
                      {copiedInviteField === 'link' ? 'Join Link Copied to Clipboard!' : 'Copy Shareable Join Link (WhatsApp / SMS)'}
                    </button>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Your spouse or family member can open the link or enter this code under <strong>Join Family</strong> to link accounts in real time.
                    </p>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
                    <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-2 text-slate-400 font-bold tracking-widest">Or Pre-Approve by Email</span></div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Member Email</label>
                      <input 
                        value={inviteEmail} 
                        onChange={e => setInviteEmail(e.target.value)} 
                        type="email" 
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20" 
                        placeholder="spouse@gmail.com" 
                      />
                    </div>
                    <button 
                      onClick={sendInvite} 
                      disabled={isInviting || inviteSent || !inviteEmail.trim()}
                      className={`w-full text-white rounded-xl py-3.5 text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${inviteSent ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-800'}`}
                    >
                      {isInviting ? <RefreshCcw className="animate-spin" size={18} /> : inviteSent ? <><Check size={18} /> Added to Pending Invites!</> : 'Pre-Approve Email Invite'}
                    </button>
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
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg text-slate-800">Join a Family Portfolio</h3>
                  <button onClick={() => setShowJoinByCodeModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Enter the 6-character <strong>Family Invite Code</strong> shared by your family member. Any holdings you already added will move with you automatically.
                  </p>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Family Invite Code</label>
                    <input
                      value={joinCodeInput}
                      onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
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
                    {isJoiningFamily ? <RefreshCcw className="animate-spin" size={18} /> : <Users size={18} />}
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
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg">Add Member Manually</h3>
                  <button onClick={() => setShowAddMemberModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Quickly add a family member record to track their investments manually via PDF uploads.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Full Name</label>
                      <input 
                        value={newMemberName} 
                        onChange={e => setNewMemberName(e.target.value)} 
                        type="text" 
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20" 
                        placeholder="e.g. Rahul Garg" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Email Address</label>
                      <input 
                        value={newMemberEmail} 
                        onChange={e => setNewMemberEmail(e.target.value)} 
                        type="email" 
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20" 
                        placeholder="rahul@example.com" 
                      />
                    </div>
                  </div>
                  <button 
                    onClick={handleAddMemberManual} 
                    disabled={isSaving}
                    className={`w-full text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl py-4 font-bold shadow-lg transition-all flex items-center justify-center gap-2`}
                  >
                    {isSaving ? <RefreshCcw className="animate-spin" size={20} /> : 'Add Member'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Manual Entry Modal */}
        <AnimatePresence>
          {showManualEntryModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg">Add Manual Entry</h3>
                  <button onClick={() => setShowManualEntryModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ticker / Name</label>
                      <AddTickerRow onAdd={(res) => {
                        setManualTicker(res.symbol);
                        setManualName(res.shortname || '');
                        setManualSource('Manual');
                        setManualProvider(res.isIndia ? 'AMFI' : 'Finnhub');
                        setManualCurrency(res.isIndia ? 'INR' : 'USD');
                        if (res.typeDisp === 'MUTUAL_FUND') setManualAssetClass('Mutual Fund');
                        if (res.currentPrice) setManualPrice(res.currentPrice.toString());
                      }} />
                      {manualTicker && (
                        <div className="mt-2 space-y-2">
                           <div className="flex items-center justify-between">
                            <div className="text-[10px] font-mono text-indigo-500 font-bold uppercase">
                              Selected: {manualTicker}
                            </div>
                            <button 
                              onClick={() => { setManualTicker(''); setManualSource('Manual'); }}
                              className="text-[9px] text-rose-500 font-bold uppercase hover:underline"
                            >
                              Clear Selection
                            </button>
                           </div>
                          <input 
                            value={manualName} 
                            onChange={e => setManualName(e.target.value)} 
                            className="w-full px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded text-xs font-bold text-indigo-700"
                            placeholder="Descriptive Name"
                          />
                        </div>
                      )}
                      {!manualTicker && (
                        <div className="mt-2">
                           <input 
                            value={manualName} 
                            onChange={e => setManualName(e.target.value)} 
                            className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs font-medium focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="Enter Name Manually..."
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Quantity</label>
                      <input value={manualQty} onChange={e => setManualQty(e.target.value)} type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm" placeholder="0.00" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Price</label>
                      <input value={manualPrice} onChange={e => setManualPrice(e.target.value)} type="number" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm" placeholder="Current Price" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Currency</label>
                      <select value={manualCurrency} onChange={e => setManualCurrency(e.target.value as Currency)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm">
                        <option value="USD">USD ($)</option>
                        <option value="INR">INR (₹)</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Asset Class</label>
                      <select value={manualAssetClass} onChange={e => setManualAssetClass(e.target.value as AssetClass)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm font-bold">
                        <option value="Equity">Equity</option>
                        <option value="Debt">Fixed Income / Debt</option>
                        <option value="Mutual Fund">Mutual Fund</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Provider Name</label>
                      <input value={manualProvider} onChange={e => setManualProvider(e.target.value)} type="text" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-lg text-sm" placeholder="Manual Entry" />
                    </div>
                  </div>
                  <button 
                    onClick={handleAddManualEntry} 
                    disabled={isSaving}
                    className={`w-full text-white bg-slate-900 hover:bg-slate-800 rounded-xl py-4 font-bold shadow-lg transition-all flex items-center justify-center gap-2 mt-2`}
                  >
                    {isSaving ? <RefreshCcw className="animate-spin" size={20} /> : 'Save Investment'}
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
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg text-slate-800">Add Connection</h3>
                  <button onClick={() => setShowSyncModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="p-6 space-y-3">
                  <SyncOption 
                    title="Import Statement (PDF / CSV)" 
                    desc="Supports CAMS CAS, Zerodha, INDmoney, Schwab, IBKR & E*TRADE" 
                    icon={<FileText className="text-violet-600" />} 
                    onClick={() => triggerUpload(dashboardView !== 'combined' ? dashboardView : (data.household.membersData?.[0]?.id || user.id))}
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
                          setNotification({ message: "Syncing from Gmail...", type: 'info' });
                          const res = await fetch('/api/sync/gmail', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: user.id }),
                          });
                          const result = await res.json();
                          if (result.success) {
                            if (result.count > 0) {
                              setNotification({ 
                                message: `Sync complete! Found ${result.count} holdings in ${result.filename || 'latest statement'}.`, 
                                type: 'success' 
                              });
                              // fetchData() removed - listeners will handle updates
                            } else {
                              setNotification({ message: "No CAS statements found in your recent emails.", type: 'info' });
                            }
                          } else {
                            setNotification({ message: result.error || "Sync failed", type: 'error' });
                          }
                        } catch (e) {
                          setNotification({ message: "Network error during sync", type: 'error' });
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
}


function SidebarBtn({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center space-x-2.5 p-2 rounded-lg font-medium transition-all text-[11px] uppercase tracking-wider ${active ? 'bg-indigo-50 text-indigo-700 font-black' : 'text-slate-500 hover:bg-slate-50'}`}>
      <span className={`shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function AccountStatusItem({ label, isActive }: { label: string, isActive?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={`font-mono text-[10px] font-bold ${isActive ? 'text-emerald-500' : 'text-slate-300'}`}>
        {isActive ? '● LIVE' : '○ DISCONNECTED'}
      </span>
    </div>
  );
}

function StatCardModern({ label, value, subValue, trend, isSecondary, isAlert, trendType }: { label: string, value: string, subValue: string, trend?: string, isSecondary?: boolean, isAlert?: boolean, trendType?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className={`bg-white p-4 md:p-5 rounded-xl border shadow-sm ${isAlert ? 'border-l-4 border-l-amber-400 border-slate-200' : 'border-slate-200'}`}>
      <div className="text-[10px] md:text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-xl md:text-2xl font-bold mt-1 text-slate-800">{value}</div>
      {trend ? <div className={`text-[10px] md:text-xs font-medium mt-1 ${trendType === 'bad' ? 'text-rose-500' : 'text-emerald-600'}`}>{trend}</div> : <div className={`text-[10px] md:text-xs mt-1 ${isSecondary ? 'text-slate-400 underline cursor-pointer' : 'text-slate-400'}`}>{subValue}</div>}
    </div>
  );
}

function RebalanceView({ stats, fxRates }: { stats: any, fxRates: Record<string, number> }) {
  const accuracy = useMemo(() => {
    if (!stats) return 0;
    const assetDrift = Math.abs(stats.equityDrift);
    return Math.max(0, 100 - (assetDrift * 100));
  }, [stats]);

  const suggestions = useMemo(() => {
    if (!stats) return [];
    const lines: any[] = [];

    // 1. Asset Level
    const assetDriftAmt = stats.equityDrift * stats.totalValINR;
    if (Math.abs(assetDriftAmt) > 1000) {
      if (stats.equityDrift > 0) {
        lines.push({
          title: "Equity to Debt Rebalance",
          description: `Total Equity is ${(stats.equityDrift * 100).toFixed(1)}% above your target.`,
          type: 'sell',
          amount: `₹${assetDriftAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          amountRaw: assetDriftAmt,
          category: 'Asset Allocation'
        });
      } else {
        lines.push({
          title: "Debt to Equity Rebalance",
          description: `Total Equity is ${Math.abs(stats.equityDrift * 100).toFixed(1)}% below your target.`,
          type: 'buy',
          amount: `₹${Math.abs(assetDriftAmt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          amountRaw: Math.abs(assetDriftAmt),
          category: 'Asset Allocation'
        });
      }
    }

    // 2. Equity Split Level
    const foreignDriftOfEquity = stats.actualForeignEquityPctOfEquity - stats.targetForeignEquityOfEquity;
    const foreignDriftAmt = foreignDriftOfEquity * stats.equityValINR;

    if (Math.abs(foreignDriftAmt) > 1000) {
      if (foreignDriftOfEquity > 0) {
        lines.push({
          title: "Shift Foreign to Indian Equity",
          description: `Foreign equity is ${(foreignDriftOfEquity * 100).toFixed(1)}% above its target split within your equity portfolio.`,
          type: 'sell',
          amount: `₹${foreignDriftAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          amountRaw: foreignDriftAmt,
          category: 'Geographic Allocation'
        });
      } else {
        lines.push({
          title: "Shift Indian to Foreign Equity",
          description: `Foreign equity is ${Math.abs(foreignDriftOfEquity * 100).toFixed(1)}% below its target split within your equity portfolio.`,
          type: 'buy',
          amount: `₹${Math.abs(foreignDriftAmt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          amountRaw: Math.abs(foreignDriftAmt),
          category: 'Geographic Allocation'
        });
      }
    }

    // 3. Foreign Granular Level
    stats.foreignBreakdownStats.forEach((cat: any) => {
      const catDriftAmt = cat.drift * stats.foreignEquityValINR;
      if (Math.abs(catDriftAmt) > 1000) {
        const type = cat.drift > 0 ? 'sell' : 'buy';
        lines.push({
          title: `${type === 'sell' ? 'Trim' : 'Top up'} ${cat.name}`,
          description: `${cat.name} is ${(cat.drift * 100).toFixed(1)}% ${type === 'sell' ? 'above' : 'below'} its target within Foreign Equity.`,
          type,
          amount: `₹${Math.abs(catDriftAmt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          amountRaw: Math.abs(catDriftAmt),
          category: cat.name
        });

        // Ticker specific suggestions within this category
        if (cat.tickerWeights && cat.tickerWeights.length > 0) {
          const categoryTickers = cat.tickerWeights.map((tw: any) => tw.ticker.toUpperCase());
          const catHoldings = stats.holdings.filter((h: any) => 
            h.currency === 'USD' && categoryTickers.includes(h.ticker.toUpperCase())
          );
          
          // Calculate drift for each ticker relative to category
          cat.tickerWeights.forEach((tw: any) => {
            const tickerTargetPctOfCat = tw.weight / 100;
            const catGoalVal = stats.foreignEquityValINR * (cat.percentage / 100);
            const tickerIdealVal = catGoalVal * tickerTargetPctOfCat;
            
            const tickerActualVal = catHoldings
              .filter((h: any) => h.ticker.toUpperCase() === tw.ticker.toUpperCase())
              .reduce((sum: number, h: any) => sum + h.valINR, 0);
            const tickerDrift = tickerActualVal - tickerIdealVal;

            if (Math.abs(tickerDrift) > 1000) {
               const tType = tickerDrift > 0 ? 'sell' : 'buy';
               lines.push({
                 title: `${tType === 'sell' ? 'Sell' : 'Buy'} ${tw.ticker}`,
                 description: `${tw.ticker} drift within ${cat.name}: ₹${Math.abs(tickerDrift).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                 type: tType,
                 amount: `₹${Math.abs(tickerDrift).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                 amountRaw: Math.abs(tickerDrift),
                 category: cat.name,
                 isTickerLevel: true
               });
            }
          });
        }
      }
    });

    return lines;
  }, [stats]);

  // Grouped logic for readability
  const narrative = useMemo(() => {
    if (!stats || suggestions.length === 0) return "Your portfolio is perfectly balanced.";
    
    const assetAction = stats.equityDrift > 0.02 ? "Reduce Equity" : (stats.equityDrift < -0.02 ? "Increase Equity" : "Overall Asset Mix is Balanced");
    
    // Find specific intra-category trade (e.g. AI Compute)
    const categoryTrades: string[] = [];
    stats.foreignBreakdownStats.forEach((cat: any) => {
      const sells = suggestions.filter(s => s.category === cat.name && s.type === 'sell' && s.isTickerLevel);
      const buys = suggestions.filter(s => s.category === cat.name && s.type === 'buy' && s.isTickerLevel);
      if (sells.length > 0 && buys.length > 0) {
        categoryTrades.push(`Within ${cat.name}, swap some ${sells.map(s => s.title.split(' ')[1]).join(', ')} into ${buys.map(b => b.title.split(' ')[1]).join(', ')}.`);
      }
    });

    return {
      main: `Your portfolio alignment is at ${accuracy.toFixed(1)}%. ${assetAction}.`,
      secondary: categoryTrades.length > 0 ? categoryTrades[0] : "Focus on adjusting category weights to match your sector targets."
    };
  }, [stats, suggestions, accuracy]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tight">Strategy & Orders</h2>
          <p className="text-slate-500 font-medium tracking-tight">Step-by-step plan to achieve your {stats.targetEquityPct * 100}/{stats.targetDebtPct * 100} goal</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100 flex items-center gap-2">
              <ShieldCheck size={18} />
              <span className="text-xs font-black uppercase">Goal-Aligned</span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-rose-500"></div>
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <ArrowUpRight size={24} />
          </div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sell Value</div>
          <div className="text-3xl font-black text-slate-800">
            ₹{suggestions.filter(s => s.type === 'sell').reduce((sum, s) => sum + s.amountRaw, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>

        <div className="bg-slate-900 p-8 rounded-3xl shadow-xl flex flex-col items-center text-center text-white relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500"></div>
          <div className="w-12 h-12 bg-white/10 text-white rounded-full flex items-center justify-center mb-4 group-hover:rotate-12 transition-transform">
            <RefreshCcw size={24} />
          </div>
          <div className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-1">Accuracy</div>
          <div className="text-3xl font-black">{accuracy.toFixed(1)}%</div>
          <div className="mt-2 text-[10px] font-bold text-indigo-400 uppercase">Target: 100%</div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center text-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <ArrowDownRight size={24} />
          </div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Buy Value</div>
          <div className="text-3xl font-black text-slate-800">
            ₹{suggestions.filter(s => s.type === 'buy').reduce((sum, s) => sum + s.amountRaw, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      <div className="bg-indigo-600 rounded-3xl p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Sparkles size={120} />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="px-3 py-1 bg-white/20 rounded-full text-[10px] font-black uppercase tracking-widest">Executive Summary</div>
          </div>
          <h3 className="text-2xl font-black mb-2 italic">"{typeof narrative === 'string' ? narrative : narrative.main}"</h3>
          {typeof narrative !== 'string' && (
            <p className="text-indigo-100 font-medium leading-relaxed max-w-2xl">
              {narrative.secondary} By adjusting these specific positions, you maintain your sector conviction while reducing overall drift risk.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
             Detailed Order List
          </h3>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Impact Sorted</span>
        </div>
        
        <div className="divide-y divide-slate-50">
          {suggestions.length === 0 ? (
            <div className="p-20 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                <Check size={32} />
              </div>
              <p className="text-slate-800 font-bold">Portfolio Perfectly Balanced</p>
              <p className="text-slate-400 text-sm">No adjustments needed at this time.</p>
            </div>
          ) : (
            suggestions.sort((a,b) => b.amountRaw - a.amountRaw).map((s, idx) => (
              <div key={idx} className="px-8 py-6 hover:bg-slate-50/50 transition-colors flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                    s.type === 'sell' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                  }`}>
                    {s.type === 'sell' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-800 flex items-center gap-2">
                      {s.title}
                      <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded uppercase font-black">{s.category}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 font-medium">{s.description}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-black tabular-nums ${s.type === 'sell' ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {s.type === 'sell' ? '-' : '+'}{s.amount}
                  </div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Market Execution</div>
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="px-8 py-6 bg-slate-50 flex items-center justify-between border-t border-slate-100">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-slate-200 rounded-lg">
                <ShieldCheck size={20} className="text-slate-600" />
             </div>
             <div>
                <div className="text-sm font-bold text-slate-700">Tax-Efficient Routing</div>
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mt-0.5">FIFO logic applied to all family accounts</div>
             </div>
          </div>
          <button className="px-6 py-3 bg-slate-900 hover:bg-black text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 text-sm uppercase tracking-tighter">
            Export Execution List
          </button>
        </div>
      </div>
    </div>
  );
}

function CompactDriftRow({ label, actual, target, value, onClick }: { label: string, actual: number, target: number, value: string, onClick?: () => void, key?: any }) {
  const drift = actual - target;
  const isBalanced = Math.abs(drift) < 0.05;
  
  return (
    <div 
      className={`group flex items-center justify-between p-3 rounded-2xl border border-slate-50 hover:border-indigo-100 hover:bg-indigo-50/20 transition-all cursor-pointer bg-white`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0 mr-2 sm:mr-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider truncate mr-1">{label}</span>
          <span className="text-[10px] font-bold text-slate-500 tabular-nums whitespace-nowrap">{value}</span>
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
          <p className="text-[7px] sm:text-[8px] font-black text-slate-300 uppercase leading-none mb-1 tracking-tighter text-right whitespace-nowrap">Actual/Target</p>
          <div className="flex items-center justify-end gap-1">
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-700">{(actual * 100).toFixed(1)}%</span>
            <span className="text-[9px] sm:text-[10px] text-slate-300">/</span>
            <span className="text-[10px] sm:text-[11px] font-medium text-slate-400">{(target * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div className="min-w-[35px] sm:min-w-[45px]">
          <p className="text-[7px] sm:text-[8px] font-black text-slate-300 uppercase leading-none mb-1 tracking-tighter text-right">Drift</p>
          <p className={`text-[10px] sm:text-[11px] font-black ${isBalanced ? 'text-emerald-500' : 'text-rose-500'}`}>
            {drift > 0 ? '+' : ''}{(drift * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}



function DriftProgressBar({ label, actual, target, value, color, onClick }: { label: string, actual: number, target: number, value: string, color: string, onClick?: () => void, key?: any }) {
  const drift = actual - target;
  return (
    <div className={`space-y-2 ${onClick ? 'cursor-pointer hover:opacity-80 transition-all' : ''}`} onClick={onClick}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest truncate">{label}</p>
          <p className="text-xs md:text-sm font-bold text-slate-800">{value}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">Drift</p>
          <p className={`text-xs md:text-sm font-bold ${Math.abs(drift) < 0.05 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {drift > 0 ? '+' : ''}{(drift * 100).toFixed(1)}%
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
  setNotification, 
  categoryContext, 
  totalForeignVal,
  setManualTicker,
  setManualName,
  setManualSource,
  setManualProvider,
  setManualCurrency,
  setManualAssetClass,
  setShowManualEntryModal
}: { 
  title: string, 
  holdings: Holding[], 
  onClose: () => void, 
  fxRates: Record<string, number>, 
  members: any[],
  setNotification: (n: any) => void,
  categoryContext?: any,
  totalForeignVal?: number,
  setManualTicker: (v: string) => void,
  setManualName: (v: string) => void,
  setManualSource: (v: 'Manual' | 'Live') => void,
  setManualProvider: (v: string) => void,
  setManualCurrency: (v: Currency) => void,
  setManualAssetClass: (v: AssetClass) => void,
  setShowManualEntryModal: (v: boolean) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<string>('');
  const [editPrice, setEditPrice] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTargetPlaceholders, setShowTargetPlaceholders] = useState(false);

  const augmentedHoldings = useMemo(() => {
    if (!categoryContext || !categoryContext.tickerWeights) return holdings;
    
    const existingTickers = new Set(holdings.map(h => h.ticker.toUpperCase()));
    const missing = categoryContext.tickerWeights
      .filter((tw: any) => !existingTickers.has(tw.ticker.toUpperCase()))
      .map((tw: any) => ({
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
      } as any));
      
    return showTargetPlaceholders ? [...holdings, ...missing] : holdings;
  }, [holdings, categoryContext, members, showTargetPlaceholders]);

  const groupedByMember = useMemo(() => {
    const groups: Record<string, Holding[]> = {};
    augmentedHoldings.forEach(h => {
      const mId = getHoldingOwnerId(h);
      if (!groups[mId]) groups[mId] = [];
      groups[mId].push(h);
    });
    return groups;
  }, [augmentedHoldings]);

  const getSubgroups = (userHoldings: Holding[]) => {
    return {
      'Indian Equity': userHoldings.filter(h => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'INR'),
      'Indian Debt': userHoldings.filter(h => h.assetClass === 'Debt' && h.currency === 'INR'),
      'Foreign Equity': userHoldings.filter(h => (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD'),
      'Foreign Debt & Cash': userHoldings.filter(h => h.assetClass === 'Debt' && h.currency === 'USD'),
      'Other': userHoldings.filter(h => {
        const isIE = (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'INR';
        const isID = h.assetClass === 'Debt' && h.currency === 'INR';
        const isFE = (h.assetClass === 'Equity' || h.assetClass === 'Mutual Fund') && h.currency === 'USD';
        const isFD = h.assetClass === 'Debt' && h.currency === 'USD';
        return !isIE && !isID && !isFE && !isFD;
      })
    };
  };

  const deleteHolding = async (id: string) => {
    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'holdings', id));
      fetch(`/api/portfolio/holding/${id}`, { method: 'DELETE' }).catch(() => {});
      setNotification({ message: 'Holding deleted', type: 'success' });
      setDeletingId(null);
    } catch (e) {
      console.error("Delete holding error:", e);
      setNotification({ message: 'Delete failed', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const updateHolding = async (id: string) => {
    if (!editVal || isNaN(parseFloat(editVal))) {
      setEditingId(null);
      return;
    }
    setIsProcessing(true);
    try {
      const nextQty = parseFloat(editVal);
      const nextPrice = parseFloat(editPrice);
      const patch: Record<string, number> = {
        quantity: nextQty,
        priceUpdatedAt: Date.now()
      };
      if (!isNaN(nextPrice)) {
        patch.currentPrice = nextPrice;
      }
      await updateDoc(doc(db, 'holdings', id), patch);
      fetch(`/api/portfolio/holding/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: nextQty, currentPrice: nextPrice })
      }).catch(() => {});
      setEditingId(null);
      setNotification({ message: 'Quantity updated', type: 'success' });
    } catch (e) {
      console.error("Update holding error:", e);
      setNotification({ message: 'Update failed', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

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
            <p className="text-xs text-slate-500 font-bold mt-0.5">Showing {augmentedHoldings.length} assets</p>
          </div>
          <div className="flex items-center gap-4">
             <label className="flex items-center gap-2 cursor-pointer select-none">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Show Target Gaps</span>
               <div className="relative">
                 <input 
                   type="checkbox" 
                   className="sr-only peer" 
                   checked={showTargetPlaceholders}
                   onChange={e => setShowTargetPlaceholders(e.target.checked)}
                 />
                 <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
               </div>
             </label>
             <button onClick={onClose} className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
               <Plus className="rotate-45" size={20} />
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-20">
          {(Object.entries(groupedByMember) as [string, Holding[]][]).map(([userId, memberHoldings]) => {
            const member = members.find(m => m.id === userId);
            const mName = member?.name || 'Unknown Member';
            
            const subgroups = getSubgroups(memberHoldings);
            
            const renderTable = (subHoldings: Holding[]) => (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse mb-10">
                  <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr className="border-b border-slate-100">
                      <th className="px-4 sm:px-8 py-3 md:py-4 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Asset Name</th>
                      <th className="px-4 sm:px-8 py-3 md:py-4 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">Units</th>
                      <th className="px-4 sm:px-8 py-3 md:py-4 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">Price</th>
                      <th className="px-4 sm:px-8 py-3 md:py-4 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">Value (INR)</th>
                      {categoryContext && <th className="px-4 sm:px-8 py-3 md:py-4 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">Drift</th>}
                      <th className="px-4 sm:px-8 py-3 md:py-4 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                <tbody className="divide-y divide-slate-50">
                  {subHoldings.sort((a,b) => {
                    const valA = a.currency === 'INR' ? a.quantity * a.currentPrice : a.quantity * a.currentPrice * fxRates.INR;
                    const valB = b.currency === 'INR' ? b.quantity * b.currentPrice : b.quantity * b.currentPrice * fxRates.INR;
                    return valB - valA;
                  }).map((h) => {
                    const valINR = h.currency === 'INR' ? h.quantity * h.currentPrice : h.quantity * h.currentPrice * fxRates.INR;
                    const displayTitle = shortenAssetName(h.originalName || h.ticker);
                    return (
                      <tr key={h.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-4 sm:px-8 py-4 md:py-5">
                          <div className="flex flex-col min-w-[120px] md:min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-800 text-xs md:text-sm leading-snug" title={h.originalName || h.ticker}>{displayTitle}</span>
                              {(h as any).isPlaceholder && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[8px] bg-indigo-50 text-indigo-400 px-1.5 py-0.5 rounded-md border border-indigo-100 font-black uppercase tracking-tighter">TARGET</span>
                                  <button 
                                    onClick={() => {
                                      setManualTicker(h.ticker);
                                      setManualName(h.ticker);
                                      setManualSource('Manual');
                                      setManualProvider('Finnhub');
                                      setManualCurrency('USD');
                                      setManualAssetClass('Equity');
                                      setShowManualEntryModal(true);
                                    }}
                                    className="text-[8px] font-black text-indigo-600 hover:underline flex items-center gap-1"
                                  >
                                    <Plus size={10} /> ADD
                                  </button>
                                </div>
                              )}
                              {h.provider && h.provider !== 'Manual' && !(h as any).isPlaceholder && (
                                <span className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-black uppercase tracking-tighter shrink-0">{h.provider}</span>
                              )}
                              {(h.source === 'PDF' || h.source === 'PDF Import') && <span className="text-[8px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md border border-amber-100/50 font-black uppercase tracking-tighter shrink-0">STATEMENT</span>}
                              {h.source === 'Sync' && <span className="text-[8px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-md border border-violet-100/50 font-black uppercase tracking-tighter shrink-0">SYNC</span>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[9px] md:text-[10px] text-slate-400 font-mono uppercase font-medium">{h.ticker}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 sm:px-8 py-4 md:py-5 text-right font-mono text-[11px] md:text-sm whitespace-nowrap">
                          {editingId === h.id ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-[8px] font-black text-blue-400 uppercase">Units</span>
                              <input 
                                type="number"
                                autoFocus
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') updateHolding(h.id);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                className="w-20 md:w-24 text-right text-xs font-mono bg-blue-50 border border-blue-200 rounded px-1 py-0.5"
                              />
                            </div>
                          ) : (
                            h.quantity.toLocaleString('en-IN', { maximumFractionDigits: 4 })
                          )}
                        </td>
                        <td className="px-4 sm:px-8 py-4 md:py-5 text-right font-mono text-[11px] md:text-sm whitespace-nowrap">
                          {editingId === h.id ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-[8px] font-black text-blue-400 uppercase">Price ({h.currency})</span>
                              <div className="flex items-center gap-1">
                                <input 
                                  type="number"
                                  value={editPrice}
                                  onChange={(e) => setEditPrice(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') updateHolding(h.id);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  className="w-20 md:w-24 text-right text-xs font-mono bg-blue-50 border border-blue-200 rounded px-1 py-0.5"
                                />
                                <button onClick={() => updateHolding(h.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                                  <Check size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end">
                              <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase leading-none mb-1">{h.currency}</span>
                              <span className="font-medium text-slate-600">{h.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 sm:px-8 py-4 md:py-5 text-right font-mono text-[11px] md:text-sm whitespace-nowrap">
                          <div className="flex flex-col items-end">
                             <span className="font-bold text-slate-800">
                               ₹{valINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                             </span>
                             {h.currency === 'USD' && (
                               <span className="text-[8px] md:text-[9px] text-slate-400 font-mono mt-0.5">
                                 ${(h.quantity * h.currentPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                               </span>
                             )}
                          </div>
                        </td>
                        {categoryContext && (
                          <td className="px-4 sm:px-8 py-4 md:py-5 text-right whitespace-nowrap">
                            {(() => {
                              const weightInCat = categoryContext.tickerWeights?.find((tw: any) => tw.ticker.toUpperCase() === h.ticker.toUpperCase())?.weight || (categoryContext.isUnmapped ? 0 : 100);
                              const targetValINR = (totalForeignVal || 0) * (categoryContext.percentage / 100) * (weightInCat / 100);
                              const drift = valINR - targetValINR;
                              return (
                                <div className="flex flex-col items-end">
                                  <span className={`text-[9px] md:text-[10px] font-black uppercase font-mono ${drift > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                    {drift > 0 ? '+' : ''}₹{drift.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                  </span>
                                  <span className="text-[7px] md:text-[8px] text-slate-400 font-black uppercase tracking-tighter">Goal: ₹{targetValINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              );
                            })()}
                          </td>
                        )}
                        <td className="px-4 sm:px-8 py-4 md:py-5 text-center">
                           <div className="flex items-center justify-center gap-1 md:gap-2">
                            {deletingId === h.id ? (
                              <div className="flex items-center gap-2">
                                 <div className="flex flex-col gap-1">
                                    <button onClick={() => deleteHolding(h.id)} disabled={isProcessing} className="px-3 py-1 bg-rose-600 text-white text-[9px] font-black rounded hover:bg-rose-700 disabled:opacity-50">DELETE</button>
                                    <button onClick={() => setDeletingId(null)} disabled={isProcessing} className="px-3 py-1 bg-slate-100 text-slate-500 text-[9px] font-black rounded hover:bg-slate-200">CANCEL</button>
                                 </div>
                              </div>
                            ) : (h as any).isPlaceholder ? (
                                <div className="p-2 text-slate-300">
                                  <Settings size={14} className="opacity-50" />
                                </div>
                              ) : (
                                <>
                                  <button onClick={() => { setEditingId(h.id); setDeletingId(null); setEditVal(h.quantity.toString()); setEditPrice(h.currentPrice.toString());}} title="Edit Details" disabled={isProcessing} className="p-1.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg disabled:opacity-50"><Settings size={14} /></button>
                                  <button onClick={() => { setDeletingId(h.id); setEditingId(null); }} title="Delete Holding" disabled={isProcessing} className="p-1.5 text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-lg disabled:opacity-50"><Trash size={14} /></button>
                                </>
                            )}
                           </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );

            return (
              <div key={userId} className="mb-10">
                <div className="px-4 sm:px-8 py-3 md:py-4 bg-indigo-50/50 flex items-center justify-between sticky top-0 z-20 backdrop-blur-sm border-y border-indigo-100/50">
                  <h4 className="text-indigo-800 font-black uppercase tracking-tight flex items-center gap-2 text-xs md:text-sm">
                    <Users size={14} className="md:w-4 md:h-4" /> {mName}'s Sections
                  </h4>
                </div>
                
                {Object.entries(subgroups).map(([groupName, groupHoldings]) => {
                  if (groupHoldings.length === 0) return null;
                  return (
                    <div key={groupName} className="mt-6">
                      <div className="px-4 sm:px-8 flex items-center gap-2 sm:gap-3 mb-2">
                        <div className="h-px bg-slate-100 flex-1"></div>
                        <h5 className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none py-1.5 px-3 bg-white border border-slate-100 rounded-full shadow-sm whitespace-nowrap">{groupName}</h5>
                        <div className="h-px bg-slate-100 flex-1"></div>
                      </div>
                      {renderTable(groupHoldings)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-400 uppercase">Total Category Value</div>
          <div className="text-xl font-black text-indigo-600">
            ₹{augmentedHoldings.reduce((sum, h) => sum + (h.currency === 'USD' ? h.quantity * h.currentPrice * fxRates.INR : h.quantity * h.currentPrice), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TickerCapCard({ ticker, actual, target, driftVal, isINR }: { ticker: string, actual: number, target: number, driftVal: number, isINR?: boolean, key?: string }) {
  const isOver = actual > target + 0.005;
  return (
    <div className={`p-4 rounded-lg border ${isOver ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'}`}>
      <div className="flex justify-between items-center mb-1"><span className={`text-sm font-bold ${isOver ? 'text-rose-900' : 'text-slate-800'}`}>{ticker}</span><span className={`text-[10px] font-black uppercase ${isOver ? 'text-rose-600' : 'text-slate-400'}`}>{isOver ? 'OVER CAP' : 'STABLE'}</span></div>
      <div className={`text-xs ${isOver ? 'text-rose-700' : 'text-slate-500'}`}>Current: {(actual * 100).toFixed(1)}% | Max: {(target * 100).toFixed(0)}%</div>
      {isOver && <div className="mt-2 text-xs font-bold text-rose-800 flex items-center gap-1"><ArrowDownRight size={12} /> Sell {isINR ? '₹' : '$'}{Math.abs(driftVal).toLocaleString('en-IN', { maximumFractionDigits: 0 })} to target</div>}
    </div>
  );
}

function SourceRow({ icon, name, user, hint, status, lastSync, onClick }: { icon: React.ReactNode, name: string, user: string, hint?: string, status: string, lastSync?: string, onClick?: () => void, key?: any }) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center justify-between gap-4 p-4 bg-white border border-slate-100 rounded-xl mb-3 hover:border-indigo-200 transition-colors ${onClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
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
          {status === 'Connected' ? <Check size={14} className="text-emerald-500" /> : <FileUp size={14} className="text-indigo-500" />}
          <span className={`text-[10px] font-bold uppercase transition-all ${status === 'Connected' ? 'text-emerald-600' : 'text-indigo-600'}`}>{status}</span>
        </div>
        {lastSync && <p className="text-[10px] text-slate-400 italic">{lastSync}</p>}
      </div>
    </div>
  );
}

function SyncOption({ title, desc, icon, onClick, badge, isLinked }: { title: string, desc: string, icon: React.ReactNode, onClick: () => void, badge?: string, isLinked?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full text-left p-4 rounded-xl border transition-all group flex items-start gap-4 ${isLinked ? 'border-emerald-100 bg-emerald-50/20' : 'border-slate-100 hover:border-indigo-200 hover:bg-slate-50/50'}`}>
      <div className={`p-3 rounded-xl shadow-sm border transition-transform group-hover:scale-110 ${isLinked ? 'bg-emerald-100 border-emerald-100' : 'bg-white border-slate-100'}`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h5 className="font-bold text-sm text-slate-800">{title}</h5>
          {isLinked ? (
            <span className="px-2 py-0.5 bg-emerald-500 text-white rounded text-[8px] font-black uppercase tracking-tighter flex items-center gap-1">
              <Check size={8} /> Active
            </span>
          ) : badge && (
            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[8px] font-black uppercase tracking-tighter">{badge}</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">{isLinked ? 'This account is actively syncing live holdings.' : desc}</p>
      </div>
    </button>
  );
}

 function MemberRow({ id, name, email, role, accounts, isLast, onRemove, currentUserId }: any) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between py-3.5 gap-3 ${!isLast ? 'border-b border-slate-50' : ''}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-[10px] uppercase border border-slate-100">
          {name.split(' ').map((n: string) => n[0]).join('')}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h5 className="text-[11px] font-bold text-slate-800 truncate">{name}</h5>
            {id === currentUserId && <span className="text-[8px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1 rounded uppercase font-black">You</span>}
          </div>
          <p className="text-[10px] text-slate-400 truncate tracking-tight">{email}</p>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
        {!showConfirm ? (
          <>
            <div className="text-right">
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-tighter leading-none mb-0.5">Assets</p>
              <p className="text-[11px] font-bold text-indigo-600 leading-none">{accounts} Found</p>
            </div>
            <div className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black uppercase text-slate-400 border border-slate-200">{role}</div>
            {id !== currentUserId && (
              <button 
                type="button" 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirm(true);
                }}
                className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                title="Remove Member"
              >
                <Trash size={15} />
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-2 duration-200">
            <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest mr-1">Remove?</span>
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

function LandingPage({ onLogin, onSignup, onForgot, onReset, onGoogleLogin, pendingInviteCode }: { 
  onLogin: (e: string, p: string) => void, 
  onSignup: (e: string, p: string, n: string) => void,
  onForgot: (e: string) => Promise<boolean>,
  onReset: (e: string, c: string, p: string) => Promise<boolean>,
  onGoogleLogin: () => void,
  pendingInviteCode?: string
}) {
  const [activeView, setActiveView] = useState<'login' | 'signup' | 'forgot' | 'reset'>(() => pendingInviteCode ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setAuthError(null);
  }, [activeView]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAuthError(null);
    try {
      if (activeView === 'login') {
        await onLogin(email, password);
      } else if (activeView === 'signup') {
        if (!name) throw new Error("Please enter your full name.");
        await onSignup(email, password, name);
      } else if (activeView === 'forgot') {
        const ok = await onForgot(email);
        if (ok) setActiveView('reset');
      } else if (activeView === 'reset') {
        const ok = await onReset(email, resetCode, password);
        if (ok) setActiveView('login');
      }
    } catch (err: any) {
      // Use the mapped error message if available
      const message = err.message || "An unexpected error occurred";
      setAuthError(message);
      console.error("Auth submit error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200 overflow-hidden">
        <div className="bg-indigo-600 p-8 text-white">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <TrendingUp className="text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">UnityWealth</h1>
          </div>
          <p className="text-indigo-100 font-medium">Global Family Wealth Engine</p>
        </div>
        <div className="p-8">
          {pendingInviteCode && (
            <div className="mb-6 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <div className="p-1.5 bg-emerald-600 text-white rounded-lg shrink-0 mt-0.5"><Users size={14} /></div>
              <div>
                <p className="text-xs font-black text-emerald-900 uppercase tracking-wide">Family Invite Code: {pendingInviteCode}</p>
                <p className="text-xs text-emerald-700 mt-0.5 leading-snug">Create an account or log in below to join your shared family portfolio.</p>
              </div>
            </div>
          )}
          <h2 className="text-xl font-bold mb-6 text-slate-800">
            {activeView === 'login' && 'Welcome Back'}
            {activeView === 'signup' && 'Create Account'}
            {activeView === 'forgot' && 'Reset Password'}
            {activeView === 'reset' && 'Enter Reset Code'}
          </h2>
          
          <form className="space-y-4" onSubmit={handleSubmit} autoComplete={activeView === 'login' ? 'on' : 'off'}>
            <AnimatePresence mode="wait">
              {authError && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 bg-rose-50 border border-rose-100 rounded-xl overflow-hidden shadow-sm shadow-rose-100 mb-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5"><XCircle className="text-rose-500" size={14} /></div>
                    <p className="text-xs font-bold text-rose-600 leading-tight">
                      {authError}
                      {(authError.includes("already exists") || authError.includes("associated with a different")) && (
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
            
            {activeView === 'signup' && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Full Name</label>
                <input 
                  name="name"
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  type="text" 
                  autoComplete="name"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20" 
                  placeholder="Himanshu Garg" 
                  required 
                />
              </div>
            )}
            
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Email Address</label>
              <input 
                name="email"
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                type="email" 
                autoComplete="email"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20" 
                placeholder="name@company.com" 
                required 
                disabled={activeView === 'reset'} 
              />
            </div>

            {activeView === 'reset' && (
              <div className="space-y-4">
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest text-center">Update Password for {email}</p>
                </div>
              </div>
            )}

            {(activeView === 'login' || activeView === 'signup' || activeView === 'reset') && (
              <div>
                <div className="flex justify-between items-end mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase">{activeView === 'reset' ? 'Set New Password' : 'Password'}</label>
                  {activeView === 'login' && (
                    <button type="button" onClick={() => setActiveView('forgot')} className="text-[10px] font-bold text-indigo-600 hover:underline">Forgot password?</button>
                  )}
                </div>
                <input 
                  name="password"
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  type="password" 
                  autoComplete={activeView === 'signup' ? 'new-password' : (activeView === 'reset' ? 'new-password' : 'current-password')}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20" 
                  placeholder="••••••••" 
                  required 
                />
                {activeView === 'signup' && (
                  <p className="mt-2 text-[10px] text-slate-400 leading-relaxed italic">
                    Note: If you use a non-verified email in dev mode, you might see a Resend validation error. Your account will still be created, but you won't receive a welcome email.
                  </p>
                )}
              </div>
            )}

            <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 text-white rounded-xl py-4 font-bold mt-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
              {isSubmitting && <RefreshCcw size={16} className="animate-spin" />}
              {activeView === 'login' && 'Login to Portfolio'}
              {activeView === 'signup' && 'Get Started'}
              {activeView === 'forgot' && 'Identify Account'}
              {activeView === 'reset' && 'Confirm New Password'}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400 font-bold tracking-widest">Or Continue With</span></div>
            </div>

            <button 
              type="button" 
              onClick={onGoogleLogin}
              className="w-full bg-white border border-slate-200 text-slate-700 rounded-xl py-4 font-bold flex items-center justify-center gap-3 hover:bg-slate-50 transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google Account
            </button>
          </form>

          <div className="mt-8 text-center space-y-4">
            <button 
              type="button"
              onClick={() => {
                if (activeView === 'login') setActiveView('signup');
                else setActiveView('login');
              }} 
              className="text-sm font-bold text-slate-500 hover:text-indigo-600 underline block mx-auto"
            >
              {activeView === 'login' ? "Don't have an account? Sign up" : "Already have an account? Log in"}
            </button>
            {(activeView === 'forgot' || activeView === 'reset') && (
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

function HouseholdSetup({
  onCreate,
  onJoin,
  onJoinByCode,
  isJoining,
  initialCode,
  invites
}: {
  onCreate: (n: string) => void,
  onJoin: (id: string) => void,
  onJoinByCode: (code: string) => void,
  isJoining?: boolean,
  initialCode?: string,
  invites: Invite[]
}) {
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialCode || '');
  const [previewInfo, setPreviewInfo] = useState<{ householdName: string; inviterName: string } | null>(null);

  useEffect(() => {
    if (initialCode && !inviteCode) {
      setInviteCode(initialCode);
    }
  }, [initialCode]);

  useEffect(() => {
    const clean = inviteCode.trim().toUpperCase().replace(/^UW[\-\s]*/i, '').replace(/[^A-Z0-9]/g, '');
    if (clean.length < 4) {
      setPreviewInfo(null);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/household/invite-info/${encodeURIComponent(clean)}`);
        if (res.ok && active) {
          const info = await res.json();
          setPreviewInfo({ householdName: info.householdName, inviterName: info.inviterName });
        } else if (active) {
          setPreviewInfo(null);
        }
      } catch {
        if (active) setPreviewInfo(null);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [inviteCode]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200 border border-slate-100 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6"><Users /></div>
            <h2 className="text-xl font-bold mb-2 text-slate-800">Create a Household</h2>
            <p className="text-sm text-slate-500 mb-8 leading-relaxed">Start a new combined portfolio for your family. You'll receive a shareable 6-character code to invite family members.</p>
          </div>
          <div className="space-y-4">
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600/20" placeholder="The Garg Family" />
            <button onClick={() => onCreate(name)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-4 font-bold shadow-lg shadow-indigo-100 transition-all">Initialize Family Plan</button>
          </div>
        </div>
        
        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200 border border-emerald-100 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6"><Share2 /></div>
            <h2 className="text-xl font-bold mb-2 text-slate-800">Join Existing Family</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">Enter the 6-character Family Invite Code from your spouse or family member to merge into a shared dashboard.</p>
            <div className="space-y-3">
              <input
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value.toUpperCase())}
                maxLength={12}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-black tracking-[0.2em] uppercase text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="ENTER CODE (E.G. K7M4P9)"
              />
              {previewInfo && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span>Found <strong>{previewInfo.householdName}</strong> (invited by {previewInfo.inviterName})</span>
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
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending Email Invites</div>
              {invites.map(inv => (
                <div key={inv.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-800">Invite to {inv.householdName || 'Family Portfolio'}</p>
                    <p className="text-[11px] text-slate-500">{inv.inviteCode ? `Code: ${inv.inviteCode}` : 'Pre-approved for your email'}</p>
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

function TargetForm({ initialTargets, initialSettings, onSave, onSaveSettings, isSaving, householdId }: { 
  initialTargets: PortfolioTargets, 
  initialSettings?: HouseholdSettings,
  onSave: (t: PortfolioTargets) => void, 
  onSaveSettings: (s: { enabled: boolean, threshold: number }) => void,
  isSaving: boolean, 
  allTickers: string[],
  householdId?: string
}) {
  const [assetEq, setAssetEq] = useState((initialTargets.assetSplit?.Equity ?? 0.7) * 100);
  const [eqIndian, setEqIndian] = useState((initialTargets.equitySplit?.Indian ?? 0.5) * 100);
  const [emailAlerts, setEmailAlerts] = useState(initialSettings?.emailAlertsEnabled ?? false);
  const [threshold, setThreshold] = useState(initialSettings?.accuracyThreshold ?? 95);

  const [foreignBreakdown, setForeignBreakdown] = useState<TargetCategory[]>(() => {
    return (initialTargets.foreignBreakdown || []).map(cat => {
      // Migration of legacy structure
      if (!cat.tickerWeights) {
        const legacyTickers = (cat as any).tickers || [];
        if (legacyTickers.length > 0) {
          return {
            name: cat.name,
            percentage: cat.percentage,
            tickerWeights: legacyTickers.map((t: string) => ({ ticker: t, weight: Math.round(100 / legacyTickers.length) }))
          };
        }
        return { ...cat, tickerWeights: [] };
      }
      return cat;
    });
  });
  
  const [newCatName, setNewCatName] = useState('');
  const [editingThemeIdx, setEditingThemeIdx] = useState<number | null>(null);
  const [themeEditName, setThemeEditName] = useState('');

  const addCategory = () => {
    if (!newCatName) return;
    setForeignBreakdown([...foreignBreakdown, { 
      name: newCatName, 
      percentage: 0, 
      tickerWeights: []
    }]);
    setNewCatName('');
  };

  const updateCatPct = (idx: number, pct: number) => {
    const updated = [...foreignBreakdown];
    updated[idx].percentage = pct;
    setForeignBreakdown(updated);
  };

  const updateCatName = (idx: number, name: string) => {
    const updated = [...foreignBreakdown];
    updated[idx].name = name;
    setForeignBreakdown(updated);
  };

  const updateTickerWeight = (catIdx: number, tickerIdx: number, weight: number) => {
    const updated = [...foreignBreakdown];
    if (updated[catIdx].tickerWeights) {
      updated[catIdx].tickerWeights![tickerIdx].weight = weight;
      setForeignBreakdown(updated);
    }
  };

  const addTickerToCat = (catIdx: number, ticker: string) => {
    if (!ticker) return;
    const updated = [...foreignBreakdown];
    if (!updated[catIdx].tickerWeights) updated[catIdx].tickerWeights = [];
    
    const tickerUpper = ticker.toUpperCase();
    if (updated[catIdx].tickerWeights?.find(tw => tw.ticker === tickerUpper)) return;

    updated[catIdx].tickerWeights!.push({ ticker: tickerUpper, weight: 0 });
    setForeignBreakdown(updated);
  };

  const removeTickerFromCat = (catIdx: number, tickerIdx: number) => {
    const updated = [...foreignBreakdown];
    updated[catIdx].tickerWeights = updated[catIdx].tickerWeights?.filter((_, i) => i !== tickerIdx);
    setForeignBreakdown(updated);
  };

  const removeCat = (idx: number) => {
    setForeignBreakdown(foreignBreakdown.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => { 
    e.preventDefault(); 
    onSave({ 
      assetSplit: { Equity: assetEq / 100, Debt: (100 - assetEq) / 100 }, 
      equitySplit: { Indian: eqIndian / 100, Foreign: (100 - eqIndian) / 100 },
      foreignBreakdown 
    });
    onSaveSettings({ enabled: emailAlerts, threshold });
  };
  
  const totalForeignPct = foreignBreakdown.reduce((s, c) => s + c.percentage, 0);

  return (
    <div className="bg-white p-4 md:p-10 rounded-2xl md:rounded-3xl border border-slate-200 shadow-xl shadow-slate-100">
      <div className="mb-6 md:mb-10">
        <h3 className="text-lg md:text-2xl font-bold text-slate-800">Portfolio Target Architecture</h3>
        <p className="text-slate-500 text-[10px] md:text-sm mt-1">Define your family's global allocation strategy across assets and regions.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-12 md:space-y-16">
        {/* Tier 1: Asset Split */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-indigo-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">1</div>
            <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">Main Asset Allocation</h4>
          </div>
          
          <div className="space-y-6">
            <div>
              <div className="flex flex-col sm:flex-row sm:justify-between mb-3 gap-1">
                <span className="text-sm font-bold text-slate-600">Equities vs Debt</span>
                <span className="text-sm font-black text-indigo-600">{assetEq}% Equity / {100-assetEq}% Debt</span>
              </div>
              <input type="range" min="0" max="100" value={assetEq} onChange={(e) => setAssetEq(Number(e.target.value))} className="w-full h-3 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                 <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Target Equity</p>
                 <p className="text-xl font-bold text-indigo-700">{assetEq}%</p>
               </div>
               <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                 <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Target Debt</p>
                 <p className="text-xl font-bold text-emerald-700">{100 - assetEq}%</p>
               </div>
            </div>
          </div>
        </section>

        {/* Tier 2: Equity Split */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-orange-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-xs shrink-0">2</div>
            <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">Geographic Equity Split <span className="text-[10px] md:text-xs text-slate-400 font-normal block sm:inline sm:ml-2">(% of Equities)</span></h4>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex flex-col sm:flex-row sm:justify-between mb-3 gap-1">
                <span className="text-sm font-bold text-slate-600">Indian vs Foreign (US)</span>
                <span className="text-sm font-black text-orange-600">{eqIndian}% Indian / {100-eqIndian}% Foreign</span>
              </div>
              <input type="range" min="0" max="100" value={eqIndian} onChange={(e) => setEqIndian(Number(e.target.value))} className="w-full h-3 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-orange-500" />
            </div>
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full shrink-0"></div>
                <span className="text-[10px] md:text-xs font-bold text-slate-500">IND Equity Weight: {((assetEq * eqIndian) / 100).toFixed(1)}% of total</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full shrink-0"></div>
                <span className="text-[10px] md:text-xs font-bold text-slate-500">Foreign Equity Weight: {((assetEq * (100 - eqIndian)) / 100).toFixed(1)}% of total</span>
              </div>
            </div>
          </div>
        </section>

        {/* Tier 3: Sectors (Foreign) */}
        <section className="relative">
          <div className="absolute -left-4 md:-left-6 top-0 bottom-0 w-1 bg-slate-200 rounded-full"></div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0">3</div>
              <h4 className="text-base md:text-lg font-bold text-slate-800 uppercase tracking-tight">Sectors / Themes Breakdown <span className="text-[10px] md:text-xs text-slate-400 font-normal block sm:inline sm:ml-2">(% of Foreign Equity)</span></h4>
            </div>
            <div className={`px-4 py-1.5 rounded-xl text-xs font-black border flex items-center gap-2 transition-all shadow-sm ${totalForeignPct === 100 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700 animate-pulse'}`}>
              <div className={`w-2 h-2 rounded-full ${totalForeignPct === 100 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
              Sum: {totalForeignPct.toFixed(1)}% / 100%
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 mb-6 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <input 
              value={newCatName} 
              onChange={e => setNewCatName(e.target.value)}
              placeholder="Add theme (e.g. AI & SaaS)"
              className="w-full sm:flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 bg-white"
            />
            <button 
              type="button" 
              onClick={addCategory}
              className="w-full sm:w-auto bg-slate-900 text-white px-6 py-2 rounded-lg hover:bg-slate-800 transition-all font-bold text-xs"
            >
              ADD THEME
            </button>
          </div>

          <div className="space-y-4">
            {foreignBreakdown.map((cat, idx) => {
              const catTotalBase = (assetEq * (100 - eqIndian) / 10000) * (cat.percentage / 100) * 100;
              const tickerSum = cat.tickerWeights?.reduce((s, tw) => s + tw.weight, 0) || 0;

              return (
                <div key={idx} className="bg-slate-50 p-6 rounded-2xl border border-slate-200 group">
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex-1">
                      {editingThemeIdx === idx ? (
                        <div className="flex items-center gap-2">
                          <input 
                            autoFocus
                            value={themeEditName}
                            onChange={(e) => setThemeEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateCatName(idx, themeEditName);
                                setEditingThemeIdx(null);
                              }
                              if (e.key === 'Escape') setEditingThemeIdx(null);
                            }}
                            className="bg-white border border-indigo-200 rounded px-2 py-1 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          />
                          <button 
                            type="button"
                            onClick={() => {
                              updateCatName(idx, themeEditName);
                              setEditingThemeIdx(null);
                            }}
                            className="text-emerald-500 hover:text-emerald-600"
                          >
                            <Check size={16} />
                          </button>
                          <button 
                            type="button"
                            onClick={() => setEditingThemeIdx(null)}
                            className="text-slate-400 hover:text-rose-500"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <h5 className="font-bold text-slate-800">{cat.name}</h5>
                          <div className="flex items-center gap-1">
                            <button 
                              type="button"
                              onClick={() => {
                                setEditingThemeIdx(idx);
                                setThemeEditName(cat.name);
                              }}
                              className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                              title="Edit theme name"
                            >
                              <Pencil size={12} />
                            </button>
                            <button 
                              type="button" 
                              onClick={() => removeCat(idx)} 
                              className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                              title="Remove theme"
                            >
                              <Trash size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {/* Ticker Management */}
                      <div className="mt-4 space-y-2">
                        {cat.tickerWeights?.map((tw, tIdx) => (
                          <div key={tIdx} className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white p-3 rounded-xl border border-slate-100">
                             <div className="flex items-center justify-between sm:justify-start gap-3">
                               <span className="w-16 font-mono text-[10px] font-black text-slate-400 uppercase shrink-0">{tw.ticker}</span>
                               <div className="sm:hidden flex items-center gap-2">
                                 <span className="text-[9px] text-indigo-400 font-bold">
                                   ({(catTotalBase * tw.weight / 100).toFixed(2)}% total)
                                 </span>
                                 <button 
                                   type="button"
                                   onClick={() => removeTickerFromCat(idx, tIdx)} 
                                   className="text-slate-300 hover:text-rose-500 transition-colors"
                                 >
                                   <Trash size={12} />
                                 </button>
                               </div>
                             </div>
                             
                             <div className="flex-1 flex items-center gap-3">
                               <input 
                                  type="range" 
                                  min="0" 
                                  max="100" 
                                  value={tw.weight} 
                                  onChange={(e) => updateTickerWeight(idx, tIdx, Number(e.target.value))}
                                  className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                               />
                               <div className="flex items-center gap-2 shrink-0">
                                 <input 
                                    type="number"
                                    value={tw.weight}
                                    onChange={(e) => updateTickerWeight(idx, tIdx, Number(e.target.value))}
                                    className="w-12 text-center text-[10px] font-black text-slate-800 bg-white border border-slate-200 rounded px-1 py-0.5"
                                 />
                                 <div className="hidden sm:block w-16 text-right">
                                   <span className="text-[9px] text-indigo-400 font-bold">
                                     ({(catTotalBase * tw.weight / 100).toFixed(2)}% total)
                                   </span>
                                 </div>
                               </div>
                               <button 
                                 type="button"
                                 onClick={() => removeTickerFromCat(idx, tIdx)} 
                                 className="hidden sm:block text-slate-300 hover:text-rose-500 transition-colors"
                               >
                                 <Trash size={12} />
                               </button>
                             </div>
                          </div>
                        ))}

                        <div className="flex gap-2 items-center mt-2">
                           <AddTickerRow onAdd={(res) => addTickerToCat(idx, res.symbol)} householdId={householdId} />
                           {tickerSum !== 100 && cat.tickerWeights && cat.tickerWeights.length > 0 && (
                             <span className="text-[9px] font-black text-rose-500 uppercase animate-pulse">
                               Current Sum: {tickerSum.toFixed(1)}% (Must be 100%)
                             </span>
                           )}
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => removeCat(idx)} className="text-slate-400 hover:text-rose-500 transition-colors ml-4 hidden md:block">
                      <Trash size={16} />
                    </button>
                  </div>
                  
                  <div className="border-t border-slate-200/50 pt-4 mt-2">
                    <div className="flex justify-between mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase">Theme Weight</span>
                      <span className="text-[10px] font-black text-slate-800">{cat.percentage}% of Foreign Equity</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={cat.percentage} 
                        onChange={(e) => updateCatPct(idx, Number(e.target.value))} 
                        className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
                      />
                      <div className="flex items-center gap-3 w-full sm:w-40 justify-between sm:justify-end">
                        <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2 py-1 shrink-0">
                          <input 
                            type="number"
                            value={cat.percentage}
                            onChange={(e) => updateCatPct(idx, Number(e.target.value))}
                            className="w-12 text-sm font-black text-slate-800 focus:outline-none text-right"
                          />
                          <span className="text-xs font-bold text-slate-400 ml-0.5">%</span>
                        </div>
                        <div className="w-16 text-right shrink-0">
                          <span className="text-[10px] text-indigo-500 font-bold">
                            ({catTotalBase.toFixed(1)}% total)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="bg-white border-2 border-dashed border-slate-200 p-6 rounded-2xl">
              <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Add Sector / Theme</h5>
              <div className="flex flex-col md:flex-row gap-4">
                <input 
                  value={newCatName} 
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="e.g. AI Winners or Semiconductors" 
                  className="flex-1 px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/10"
                />
                <button 
                  type="button"
                  onClick={addCategory}
                  className="px-6 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors shadow-lg shadow-slate-100"
                >
                  ADD THEME
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Tier 4: Notifications & Keys */}
        <section className="relative">
          <div className="absolute -left-6 top-0 bottom-0 w-1 bg-rose-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold text-xs">4</div>
            <h4 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Intelligence & External APIs</h4>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="font-bold text-slate-800 flex items-center gap-2">
                    <Mail size={16} className="text-rose-500" />
                    Email Rebalance Alerts
                  </h5>
                  <p className="text-xs text-slate-500">Receive a Gemini-powered rebalance plan when alignment drops.</p>
                </div>
                <button 
                   type="button"
                   onClick={() => setEmailAlerts(!emailAlerts)}
                   className={`w-12 h-6 rounded-full transition-all relative ${emailAlerts ? 'bg-rose-500' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${emailAlerts ? 'left-7' : 'left-1'}`}></div>
                </button>
              </div>

              {emailAlerts && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="pt-4 border-t border-rose-100">
                  <div className="flex justify-between mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <span>Accuracy Threshold </span>
                    <span className="text-rose-600">Lower than {threshold}%</span>
                  </div>
                  <input type="range" min="80" max="99" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full h-2 bg-white rounded-lg appearance-none cursor-pointer accent-rose-500 mb-2" />
                  <p className="text-[10px] text-slate-400">UnityWealth will email you once every 24h if your Portfolio Alignment score falls below this number.</p>
                </motion.div>
              )}
            </div>
          </div>
        </section>

        {/* Tier 5: Data Resilience */}
        <section className="relative">
          <div className="absolute -left-6 top-0 bottom-0 w-1 bg-indigo-100 rounded-full"></div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold text-xs">5</div>
            <h4 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Data Persistence & Backups</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col justify-between">
              <div>
                <h5 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                  <Download size={16} className="text-indigo-500" />
                  Offline Backup
                </h5>
                <p className="text-xs text-slate-500 mb-4">Export your entire portfolio, targets, and household data to a JSON file. Use this to restore in case of accidental loss.</p>
              </div>
              <a 
                href="/api/admin/export-db" 
                download="unitywealth-backup.json"
                className="w-full py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
              >
                <FileJson size={14} /> EXPORT DATABASE (.JSON)
              </a>
            </div>

            <div className="p-6 bg-amber-50 border border-amber-100 rounded-2xl flex flex-col justify-between">
              <div>
                <h5 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                  <Upload size={16} className="text-amber-500" />
                  Restore Snapshot
                </h5>
                <p className="text-xs text-slate-500 mb-4">Upload a previously exported JSON file to overwrite the current database. Use with caution as this replaces all current data.</p>
              </div>
              <label className="w-full py-2.5 bg-white border border-amber-200 text-amber-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-50 cursor-pointer transition-colors">
                <Upload size={14} /> IMPORT FROM FILE
                <input 
                  type="file" 
                  accept=".json" 
                  className="hidden" 
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!confirm("Are you sure? This will OVERWRITE all current portfolio data, users, and settings.")) return;
                    const text = await file.text();
                    try {
                      const data = JSON.parse(text);
                      const res = await fetch('/api/admin/import-db', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data })
                      });
                      if (res.ok) {
                        alert("Database restored successfully! The page will now reload.");
                        window.location.reload();
                      } else {
                        const err = await res.json();
                        alert("Import failed: " + (err.error || "Unknown error"));
                      }
                    } catch (e) {
                      alert("Invalid JSON file");
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="mt-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl">
             <div className="flex items-center gap-2 mb-2">
               <History size={14} className="text-indigo-400" />
               <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Automatic Daily Snapshots</span>
             </div>
             <p className="text-[10px] text-slate-500 italic">UnityWealth automatically maintains 10 rotating snapshots of your database in server storage. Contact support for server-side recovery if needed.</p>
          </div>
        </section>

        <div className="pt-8 border-t border-slate-100">
           <button 
             type="submit" 
             disabled={isSaving || totalForeignPct !== 100 || foreignBreakdown.some(cat => cat.tickerWeights && cat.tickerWeights.length > 0 && Math.round(cat.tickerWeights.reduce((s, tw) => s + tw.weight, 0)) !== 100)} 
             className="w-full bg-indigo-600 text-white rounded-2xl py-5 font-bold flex items-center justify-center gap-3 hover:bg-indigo-700 disabled:opacity-50 disabled:grayscale transition-all shadow-xl shadow-indigo-100"
           >
             {isSaving ? <RefreshCcw className="animate-spin" size={20} /> : <><Save size={20} />Deploy Allocation Architecture</>}
           </button>
            {totalForeignPct !== 100 && (
              <p className="text-center text-xs text-rose-500 font-bold mt-4 animate-pulse">
                Foreign themes must sum to exactly 100% (Current: {totalForeignPct.toFixed(1)}%).
              </p>
            )}
            {foreignBreakdown.some(cat => cat.tickerWeights && cat.tickerWeights.length > 0 && cat.tickerWeights.reduce((s, tw) => s + tw.weight, 0) !== 100) && (
              <p className="text-center text-xs text-rose-500 font-bold mt-1">Each theme's ticker weights must sum to exactly 100%.</p>
            )}
        </div>
      </form>
    </div>
  );
}

function AddTickerRow({ onAdd, householdId }: { onAdd: (res: any) => void, householdId?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length > 1) {
        setIsSearching(true);
        try {
          const hParam = householdId ? `&h=${householdId}` : '';
          const [tickerRes, mfRes] = await Promise.all([
            fetch(`/api/tickers/search?q=${encodeURIComponent(query)}${hParam}`),
            fetch(`/api/mf/search?q=${encodeURIComponent(query)}`)
          ]);
          const tickerData = await tickerRes.json();
          const mfData = await mfRes.json();
          
          // Combine and deduplicate if necessary, though symbols are different
          setResults([...tickerData, ...mfData]);
          setIsOpen(true);
        } catch (e) {
          console.error("Search failed", e);
        } finally {
          setIsSearching(false);
        }
      } else {
        setResults([]);
        setIsOpen(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={searchRef}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input 
            value={query} 
            onChange={e => setQuery(e.target.value)}
            onFocus={() => query.length > 1 && setIsOpen(true)}
            placeholder="Search Ticker or MF (e.g. Parag Parikh)"
            className="text-[10px] bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-full sm:w-48 shadow-sm"
          />
          {isSearching && <RefreshCcw size={10} className="absolute right-2 top-2.5 animate-spin text-slate-400" />}
        </div>
      </div>

              {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full sm:w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
          {results.map((r) => (
            <button
              type="button"
              key={r.symbol}
              onClick={() => {
                onAdd(r);
                setQuery('');
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left hover:bg-slate-50 border-b border-slate-50 last:border-0 flex flex-col gap-0.5"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-900">{r.symbol}</span>
                  {r.isIndia && <span className="text-[7px] bg-orange-50 text-orange-600 px-1 rounded-sm font-black uppercase tracking-tighter">India</span>}
                </div>
                <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded font-bold uppercase">{r.exchDisp}</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-[9px] text-slate-400 truncate font-semibold uppercase max-w-[180px]">{shortenAssetName(r.shortname)}</span>
                {r.currentPrice > 0 && (
                  <div className="text-[9px] font-black text-emerald-600 tabular-nums">
                    {r.isIndia ? '₹' : '$'}{r.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveMarketsView({ holdings, members, householdId }: { holdings: Holding[], members: any[], householdId?: string }) {
  const [searchedAssets, setSearchedAssets] = useState<any[]>([]);

  // Group by ticker to show unique assets in the market view
  const uniqueHoldings = Array.from(new Set(holdings.map(h => h.ticker + (h.originalName || ''))))
    .map(key => holdings.find(h => (h.ticker + (h.originalName || '')) === key)!)
    .filter(Boolean);

  const handleAssetSelect = async (asset: any) => {
    // Show immediate result from search
    if (!searchedAssets.find(a => a.symbol === asset.symbol)) {
      setSearchedAssets([asset, ...searchedAssets]);
      
      // Fetch fresh price to be sure
      try {
        const hParam = householdId ? `?h=${householdId}` : '';
        const res = await fetch(`/api/quote/${encodeURIComponent(asset.symbol)}${hParam}`);
        if (res.ok) {
          const data = await res.json();
          setSearchedAssets(prev => prev.map(a => a.symbol === asset.symbol ? { ...a, currentPrice: data.price } : a));
        }
      } catch (e) {
        console.error("Fresh price fetch failed", e);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-slate-800 uppercase italic">Live Markets</h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Real-time asset tracking & current valuations</p>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-black text-emerald-700 uppercase tracking-tighter">Market Systems Active</span>
        </div>
      </div>

      {/* Global Search Bar */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-1">Check Live Price for Any Asset</label>
        <div className="max-w-xl">
          <AddTickerRow onAdd={handleAssetSelect} householdId={householdId} />
        </div>
      </div>

      {searchedAssets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
             <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Market Watchlist</h3>
             <button onClick={() => setSearchedAssets([])} className="text-[9px] font-black text-rose-500 uppercase hover:underline">Clear</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {searchedAssets.map(asset => (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                key={asset.symbol} 
                className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 relative overflow-hidden group"
              >
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-indigo-400 font-bold">{asset.symbol}</span>
                    <span className="text-xs font-bold leading-tight line-clamp-2" title={asset.shortname}>{shortenAssetName(asset.shortname)}</span>
                  </div>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-emerald-500/20">LIVE</span>
                </div>
                <div className="flex items-baseline gap-1 mt-2">
                   <span className="text-sm opacity-40 font-mono">{asset.isIndia ? '₹' : '$'}</span>
                   <span className="text-2xl font-black">{asset.currentPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '---'}</span>
                </div>
                <div className="text-[9px] text-slate-500 font-bold uppercase mt-1">
                  {asset.exchDisp} • {asset.typeDisp}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-100">
         <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 px-1">Your Portfolio Tracking</h3>
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {uniqueHoldings.sort((a,b) => (a.assetClass || '').localeCompare(b.assetClass || '')).map(h => (
          <div key={h.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:border-emerald-200 transition-all group relative overflow-hidden">
            {h.ticker && h.ticker !== 'MANUAL' && h.currentPrice > 0 && (
              <div className="absolute top-0 right-0 p-3">
                <span className="flex items-center gap-1 text-[7px] font-black text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                  LIVE
                </span>
              </div>
            )}
            
              <div className="flex justify-between items-start mb-6">
              <div className="flex flex-col max-w-[75%]">
                <h3 className="font-bold text-slate-800 text-sm leading-tight line-clamp-2" title={h.originalName || h.ticker}>
                  {shortenAssetName(h.originalName || h.ticker)}
                </h3>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">{h.ticker}</span>
                  <span className="text-[9px] text-indigo-400 font-black uppercase tracking-widest bg-indigo-50 px-1.5 py-0.5 rounded">{h.assetClass}</span>
                </div>
              </div>
              <a 
                href={`https://www.google.com/search?q=${encodeURIComponent((h.originalName || h.ticker) + ' price')}`} 
                target="_blank" 
                rel="noreferrer"
                className="p-2 bg-slate-50 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl transition-all"
              >
                <Globe size={14} />
              </a>
            </div>

            <div className="pt-6 border-t border-slate-50 flex items-end justify-between mt-auto">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Current NAV/Price</span>
                <div className="text-2xl font-black text-slate-800 flex items-baseline gap-1">
                  <span className="text-sm opacity-40 font-mono">{h.currency === 'INR' ? '₹' : '$'}</span>
                  {h.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Owners</span>
                <div className="flex -space-x-2 justify-end">
                  {members.filter(m => holdings.some(hold => getHoldingOwnerId(hold) === m.id && (hold.ticker + (hold.originalName || '')) === (h.ticker + (h.originalName || '')))).map(m => (
                    <div 
                      key={m.id} 
                      className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm ring-1 ring-slate-100"
                      style={{ backgroundColor: m.color || '#6366f1' }}
                      title={m.name}
                    >
                      {m.name.charAt(0)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

      <div className="bg-slate-900 text-white p-8 rounded-3xl relative overflow-hidden flex items-center gap-8">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-indigo-500/20 to-transparent pointer-events-none"></div>
        <div className="bg-indigo-600 p-4 rounded-2xl shadow-xl shadow-indigo-900/50 relative z-10 shrink-0">
          <Zap size={32} />
        </div>
        <div className="relative z-10">
          <h4 className="text-xl font-black italic uppercase italic">Dashboard Intelligence: Live Core</h4>
          <p className="text-slate-400 text-sm mt-1 max-w-2xl leading-relaxed">UnityWealth's live engine connects directly to global markets. Every holding marked as <span className="text-emerald-400 font-bold">LIVE</span> is automatically revalued on every refresh using our high-frequency cloud adapters for AMFI and US Market feeds.</p>
        </div>
      </div>
    </div>
    );
  };

  return (
    <>
      {renderContent()}

      {/* Global Notification Toast (Shared across all views) */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, y: 20, scale: 0.9 }} 
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4"
          >
            <div className={`p-4 rounded-2xl shadow-2xl border flex items-center gap-4 ${
              notification.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-800' : 
              'bg-slate-900 border-slate-800 text-white'
            }`}>
              <div className={`p-2 rounded-lg ${notification.type === 'error' ? 'bg-rose-100' : 'bg-indigo-600'}`}>
                {notification.type === 'error' ? <Plus className="rotate-45" size={20} /> : <Check size={20} />}
              </div>
              <div className="flex-1 pr-2">
                <p className="text-sm font-bold leading-tight">{notification.message}</p>
              </div>
              <button 
                onClick={() => setNotification(null)} 
                className={`p-1 rounded-full transition-all ${notification.type === 'error' ? 'hover:bg-rose-200/50' : 'hover:bg-white/10'}`}
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}


