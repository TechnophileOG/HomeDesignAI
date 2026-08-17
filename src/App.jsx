import React, { useState, useEffect, useRef } from 'react';
import { Home, BarChart2, Settings, Bell, User, TrendingUp, ClipboardCheck, MailCheck } from 'lucide-react';
import './App.css';

import BannerCarousel     from './components/BannerCarousel';
import CatalogGrid        from './components/CatalogGrid';
import StatsView          from './components/StatsView';
import SettingsView       from './components/SettingsView';
import AddProductFlow     from './components/AddProductFlow';
import ProductDetailModal from './components/ProductDetailModal';
import ReviewCenterView   from './components/ReviewCenterView';
import RetakeSession      from './components/RetakeSession';
import OnboardingFlow     from './components/OnboardingFlow';
import KatalogitPreloader from './components/KatalogitPreloader';
import AdminPanel         from './components/AdminPanel';
import AuthGate           from './components/AuthGate';
import AdminUnlockModal   from './components/AdminUnlockModal';
import ResetPasswordView  from './components/ResetPasswordView';
import JoinSessionView    from './components/JoinSessionView';
import KatalogitLogo      from './components/KatalogitLogo';
import { TopUpModal, TransactionsModal } from './components/CreditsWallet';
import { api, getCurrentStoreId, dataUrlToBlob, CREDIT_PRICING } from './api/client';
import { auth } from './api/auth';
import { ai } from './api/ai';

const NAV_ITEMS = [
  { id: 'Home',         label: 'Catalogue',      Icon: Home          },
  { id: 'Review',       label: 'Review Center',  Icon: ClipboardCheck },
  { id: 'Stats',        label: 'Sales Stats',    Icon: BarChart2      },
  { id: 'Settings',     label: 'Store Settings', Icon: Settings       },
];

/* ── server store doc → UI profile shape ─────────────────────────────────── */
const storeToProfile = (s) => ({
  storeName: s?.name || 'My Store',
  name: s?.name || '',
  city: s?.city || '',
  categories: s?.categories || [],
  scale: s?.scale || 'starter',
  aiFeatures: s?.aiFeatures || [],
});

export default function App() {
  const [activeTab, setActiveTab]           = useState('Home');
  const [searchQuery, setSearchQuery]       = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedPdpProduct, setSelectedPdpProduct] = useState(null);
  const [showRetakeSession, setShowRetakeSession]    = useState(false);

  const [onboardingDone, setOnboardingDone] = useState(false);
  const [storeProfile, setStoreProfile]     = useState(null);
  // KatalogitAI intro animation — plays on every page load
  const [showPreloader, setShowPreloader]   = useState(true);
  // "Real" preloader: the animation leaves only when the app behind is ready
  // (fonts loaded + session checked) — never a fixed timer, never stuck.
  const [fontsReady, setFontsReady] = useState(false);

  // Password-reset link handling (mode=resetPassword&oobCode=… from the email)
  const [resetFlow, setResetFlow] = useState(null);

  // Auth gate — the app stays closed until a valid session exists
  const [authed, setAuthed]       = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession]     = useState(null); // carries isAdmin for role gating
  // re-entry guard: stops a double-tap on a draft's Generate from double-spending
  const generateBusyRef           = useRef(false);

  // Live catalogue — every user has their own server-side inventory
  const [products, setProducts]       = useState([]);
  // Pending review queue
  const [pendingReview, setPendingReview] = useState([]);

  // ── Credits & commerce (server-managed via the API) ─────────────────────
  const [wallet, setWallet]       = useState(null);
  const [stores, setStores]       = useState([]);      // admin view
  const [ledger, setLedger]       = useState([]);      // my ledger
  const [adminLedger, setAdminLedger] = useState([]);  // global ledger (admins)
  const [alerts, setAlerts]       = useState([]); // admin follow-up queue
  const [leads, setLeads]         = useState([]); // admin leads (contact form)
  const [adminJobs, setAdminJobs] = useState([]); // admin: jobs across stores
  const [adminOrders, setAdminOrders] = useState([]); // admin: payments
  const [showTopUp, setShowTopUp]       = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);
  // Live cataloging sessions (bulk mode) — surfaced in the Review Center.
  const [sessions, setSessions]         = useState([]);
  const [resumeSessionId, setResumeSessionId] = useState(null);

  // Admin-controlled content (banners + announcements) — server is truth.
  const [banners, setBanners]             = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [adminBanners, setAdminBanners]       = useState([]);
  const [adminAnnouncements, setAdminAnnouncements] = useState([]);
  const DISMISS_KEY = 'kat_dismissed_announcements_v1';
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; }
  });
  const dismissAnnouncement = (id) => {
    const next = dismissed.includes(id) ? dismissed : [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  /* ── Session check — nothing renders until auth is verified. NEVER leaves
     the boot spinner: any failure falls back to the auth gate instead of
     hanging (a hang here was a real bug — a thrown getSession() left
     authChecked=false forever, a permanent loading screen). ───────────── */
  useEffect(() => {
    let mounted = true;
    (async () => {
      let ok = false;
      let s = null;
      try {
        ok = await auth.hasSession();
        s  = ok ? await api.getSession() : null;
      } catch (err) {
        console.error('[app] session check failed:', err);
        ok = false; // cannot verify → auth gate (never a stuck spinner)
      }
      if (mounted) { setSession(s); setAuthed(ok); setAuthChecked(true); }
    })();
    return () => { mounted = false; };
  }, []);

  // Fonts + password-reset link detection — the preloader waits for fonts so
  // the reveal underneath always paints text correctly (no invisible-text FOIT).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try { await (document.fonts ? document.fonts.ready : Promise.resolve()); } catch { /* ignore */ }
      if (mounted) setFontsReady(true);
    })();
    const q = new URLSearchParams(window.location.search);
    if (q.get('mode') === 'resetPassword' && q.get('oobCode')) {
      setResetFlow({ oobCode: q.get('oobCode'), apiKey: q.get('apiKey') || '' });
    }
    return () => { mounted = false; };
  }, []);

  /* ── Hydrate everything from the server on sign-in ────────────────────── */
  useEffect(() => {
    if (!authed) return;
    let mounted = true;
    (async () => {
      try {
        const b = await api.bootstrap();
        if (!mounted) return;
        const freshSession = await api.getSession();
        if (freshSession) setSession(freshSession);
        setStoreProfile(b.store ? storeToProfile(b.store) : null);
        setOnboardingDone(!!b.onboarded);
        setProducts(b.products);
        setPendingReview(b.pending);
        setWallet(b.wallet);
        setStores(b.stores);
        setLedger(b.ledger);
        setAdminLedger(b.isAdmin ? await api.adminGetLedger().catch(() => []) : []);
        setAlerts(b.alerts);
        setLeads(b.isAdmin ? b.leads : []);
        // Live cataloging sessions + admin-controlled content
        setSessions(await api.listSessions().catch(() => []));
        setBanners(await api.getBanners().catch(() => []));
        setAnnouncements(await api.getAnnouncements().catch(() => []));
        // Owner console data loads ONLY when the owner holds a valid unlock
        // session — never on email alone. After unlock we refresh via
        // handleAdminUnlocked().
        if (b.isAdmin && api.hasAdminSession()) {
          setAdminBanners(await api.adminListBanners().catch(() => []));
          setAdminAnnouncements(await api.adminListAnnouncements().catch(() => []));
          setAdminJobs(await api.adminGetJobs().catch(() => []));
          setAdminOrders(await api.adminGetOrders().catch(() => []));
        }
      } catch (err) {
        console.error('[app] bootstrap failed:', err);
        if (err.status === 401 || err.code === 'NETWORK') {
          // Session invalid/expired → bounce to the auth gate
          await auth.signOut();
          if (mounted) { setAuthed(false); setSession(null); }
        }
      }
    })();
    return () => { mounted = false; };
  }, [authed]);

  const storeId = getCurrentStoreId();

  // The onboarding finale calls this and AWAITS it: throws on failure so the
  // finale can show a real error + retry instead of silently passing. The
  // final onboardingDone flip happens via onDone (from the success screen) so
  // the confirmation is seen before the app reveals.
  const handleOnboardingComplete = async (profileData) => {
    const { store, wallet: w } = await api.onboard(profileData);
    setStoreProfile(storeToProfile(store));
    setWallet({ id: store.id, balance: w.balance, plan: w.plan });
    setStores([{ id: store.id, storeName: store.name, city: store.city, plan: String(w.plan || 'free').toUpperCase(), balance: w.balance, lastActive: new Date().toISOString() }]);
    setLedger(await api.getLedger().catch(() => []));
    return { store, wallet: w };
  };

  /* ── Upload a captured photo to GCS via signed URL → object path ──────── */
  const EXT_MAP = {
    'image/png': 'png',
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
  };
  const uploadPhoto = async (dataUrl) => {
    const blob = dataUrlToBlob(dataUrl);
    const mime = blob.type || 'image/jpeg';
    const ext = EXT_MAP[mime] || 'jpg';
    const fileName = `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { uploadUrl, objectPath } = await api.getUploadUrl('flat_lay', fileName, mime);
    await api.uploadBlob(uploadUrl, blob, mime);
    return { path: objectPath, contentType: mime, size: blob.size };
  };

  /* ── Photo shoot complete: upload photos → create product → queue AI job.
     Not enough credits? The product is saved as a DRAFT (server-side) so the
     photos are never lost — the user recharges and generates later.
     opts.hold (user chose to wait for the proprietary model): photos are
     saved as drafts with NO job and NO credit charge — the moment the
     proprietary pipeline is online, drafts generate from Review Center.
     NEVER throws: returns { status, saved[], failed[] } so the caller can
     mark each photo as cloud-saved or keep it cached on-device for retry. */
  const handleShootComplete = async (items, opts = {}) => {
    const list = Array.isArray(items) ? items : [items];
    const saved = [];
    const failed = [];
    let anyQueued = false;
    let anyDraft = false;
    for (const it of list) {
      if (!it || !it.front) continue;
      const marker = { front: it.front, back: it.back || null };
      try {
        // Live-session captures are ALREADY in GCS (stores/{storeId}/sessions/…)
        // — reference the path directly instead of re-uploading. Local captures
        // upload via a signed URL as before.
        const flatLay = it.path
          ? { path: it.path, contentType: it.mime || 'image/jpeg', size: it.size || 0 }
          : await uploadPhoto(it.front);
        if (opts.hold) {
          // Held: no job, no credits — the proprietary model generates later.
          await api.createProduct({
            title: 'Product photo', category: 'Apparel', status: 'draft',
            flatLay,
            note: 'Held — awaiting the proprietary Katalogit AI model.',
          });
          anyDraft = true;
        } else {
          const product = await api.createProduct({
            title: 'Product photo', category: 'Apparel', status: 'pending_approve', flatLay,
          });
          try {
            await api.createJob({ type: 'model_shoot', productId: product.id });
            anyQueued = true;
          } catch (err) {
            if (err.code === 'INSUFFICIENT_CREDITS' || err.status === 402) {
              await api.patchProduct(product.id, { status: 'draft' });
              anyDraft = true;
            } else {
              throw err;
            }
          }
        }
        saved.push(marker); // reached the cloud (live or draft) — mark saved
      } catch (err) {
        console.error('[shoot] item failed:', err);
        failed.push(marker); // stays in the local cache for retry
      }
    }
    const [w, pending] = await Promise.all([api.getWallet(), api.getPending()]);
    setWallet(w);
    setPendingReview(pending);
    return {
      status: opts.hold ? 'held' : (anyQueued ? 'success' : (anyDraft ? 'draft' : 'error')),
      saved, failed,
    };
  };

  /* ── Credits: top-up (Razorpay) — wait for the webhook to credit us ───── */
  const handleTopUp = async () => {
    const before = wallet?.balance ?? 0;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const w = await api.getWallet().catch(() => null);
      if (w && w.balance > before) { setWallet(w); break; }
      if (w) setWallet(w);
    }
    setLedger(await api.getLedger().catch(() => []));
  };

  /* ── ROLE-GATED: only the OWNER (server-decided — email must be exactly
     OWNER_EMAIL) sees the console entry; opening it additionally requires
     the passcode-unlocked short-lived session. ─────────────────────────── */
  const isAdmin = Boolean(session?.isAdmin);

  // Refresh every admin dataset after a successful unlock.
  const refreshAdminData = async () => {
    if (!isAdmin || !api.hasAdminSession()) return;
    const [st, gl, al, ld, bn, an, jb, od] = await Promise.all([
      api.adminGetStores().catch(() => []),
      api.adminGetLedger().catch(() => []),
      api.adminFollowUps().catch(() => []),
      api.adminGetLeads().catch(() => []),
      api.adminListBanners().catch(() => []),
      api.adminListAnnouncements().catch(() => []),
      api.adminGetJobs().catch(() => []),
      api.adminGetOrders().catch(() => []),
    ]);
    setStores(st); setAdminLedger(gl); setAlerts(al); setLeads(ld);
    setAdminBanners(bn); setAdminAnnouncements(an); setAdminJobs(jb); setAdminOrders(od);
  };

  // Opening the console: unlocked session → straight in; otherwise the
  // passcode modal first. Deep-link ?admin=1 was REMOVED — no URL can open
  // the console without the passcode.
  const openAdminConsole = async () => {
    if (!isAdmin) return;
    if (api.hasAdminSession()) {
      await refreshAdminData();
      setShowAdmin(true);
      return;
    }
    setShowAdminUnlock(true);
  };

  const handleAdminUnlocked = async () => {
    setShowAdminUnlock(false);
    await refreshAdminData();
    setShowAdmin(true);
  };

  const handleAdminLock = () => {
    api.adminLock();
    setShowAdmin(false);
  };

  const handleGift = async (store, amount, note) => {
    if (!isAdmin) return;
    try {
      await api.adminAdjustCredits({ storeId: store.id, amount, note: note || 'Admin gift' });
      const [st, gl, w] = await Promise.all([
        api.adminGetStores(),
        api.adminGetLedger(),
        api.getWallet(),
      ]);
      setStores(st);
      setAdminLedger(gl);
      setWallet(w);
    } catch (err) {
      alert(err.message || 'Gift failed.');
    }
  };

  /* ── Admin: publish/update/remove carousel banners + announcements ────── */
  const handleSaveBanner = async (banner, id) => {
    try {
      if (id) await api.adminUpdateBanner(id, banner);
      else await api.adminCreateBanner(banner);
      setAdminBanners(await api.adminListBanners());
      setBanners(await api.getBanners().catch(() => []));
    } catch (err) { alert(err.message || 'Could not save banner.'); }
  };
  const handleDeleteBanner = async (id) => {
    try {
      await api.adminDeleteBanner(id);
      setAdminBanners(await api.adminListBanners());
      setBanners(await api.getBanners().catch(() => []));
    } catch (err) { alert(err.message || 'Could not delete banner.'); }
  };
  const handleSaveAnnouncement = async (ann, id) => {
    try {
      if (id) await api.adminUpdateAnnouncement(id, ann);
      else await api.adminCreateAnnouncement(ann);
      setAdminAnnouncements(await api.adminListAnnouncements());
      setAnnouncements(await api.getAnnouncements().catch(() => []));
    } catch (err) { alert(err.message || 'Could not save announcement.'); }
  };
  const handleDeleteAnnouncement = async (id) => {
    try {
      await api.adminDeleteAnnouncement(id);
      setAdminAnnouncements(await api.adminListAnnouncements());
      setAnnouncements(await api.getAnnouncements().catch(() => []));
    } catch (err) { alert(err.message || 'Could not delete announcement.'); }
  };

  /* ── Admin follow-up alerts (low balance → team nudges the store) ──────── */
  const handleLowBalanceAlert = () => {
    const bal = wallet?.balance ?? 0;
    const name = wallet?.id ? (storeProfile?.storeName || 'My Store') : 'My Store';
    api.addFollowUpAlert({
      storeId, storeName: name, type: 'low_balance',
      message: `Low balance (${bal} credits) — user may need a recharge nudge`, balance: bal,
    }).then(setAlerts).catch(() => {});
  };

  const handleResolveAlert = async (alertId) => {
    try { setAlerts(await api.resolveAlert(alertId)); } catch (err) { console.error(err); }
  };

  const handleResolveLead = async (leadId) => {
    try { setLeads(await api.adminResolveLead(leadId)); } catch (err) { console.error(err); }
  };

  /* ── Live cataloging sessions (bulk mode) ────────────────────────────── */
  const refreshSessions = () => api.listSessions().then(setSessions).catch(() => {});
  const handleCloseSession = async (id) => {
    try {
      await api.closeSession(id);
      await refreshSessions();
    } catch (err) { alert(err.message || 'Could not close the session.'); }
  };
  const handleResumeSession = (id) => {
    setResumeSessionId(id); // AddProductFlow joins this session in bulk mode
    setIsAddModalOpen(true);
  };
  // Live-ish refresh while the Review tab is open (cheap light list GET).
  useEffect(() => {
    if (activeTab !== 'Review') return;
    refreshSessions();
    const t = setInterval(refreshSessions, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /* ── Email verification (defense in depth — AuthGate gates entry, this
     banner covers already-onboarded / edge-case unverified sessions) ────── */
  const handleResendVerification = async () => {
    const res = await auth.sendVerification();
    alert(res.ok ? 'Verification email sent — check your inbox (and spam).' : res.error);
  };

  /* ── Draft → recharge → generate through the real pipeline ────────────── */
  const handleGenerateDraft = async (product) => {
    if (generateBusyRef.current) return; // double-tap guard
    const bal = wallet?.balance ?? 0;
    if (bal < CREDIT_PRICING.model_shoot) { setShowTopUp(true); return; }
    generateBusyRef.current = true;
    try {
      await api.createJob({ type: 'model_shoot', productId: product.id });
      const [w, pending] = await Promise.all([api.getWallet(), api.getPending()]);
      setWallet(w);
      setPendingReview(pending);
    } catch (err) {
      console.error('[ai] draft generation failed:', err);
      if (err.code === 'INSUFFICIENT_CREDITS' || err.status === 402) setShowTopUp(true);
    } finally {
      generateBusyRef.current = false;
    }
  };

  // Regenerate one shot / full gallery — server reserves the credits and
  // queues the job (results land on the product when the pipeline runs).
  const handleRegenShot = async (product, _index) => {
    const bal = wallet?.balance ?? 0;
    if (bal < CREDIT_PRICING.regen_shot) { setShowTopUp(true); return null; }
    try {
      const res = await ai.regenShot({ productId: product.id });
      setWallet(await api.getWallet());
      return res;
    } catch (err) {
      if (err.code === 'INSUFFICIENT_CREDITS' || err.status === 402) setShowTopUp(true);
      return null;
    }
  };

  const handleFullRegen = async (product) => {
    const bal = wallet?.balance ?? 0;
    if (bal < CREDIT_PRICING.full_regen) { setShowTopUp(true); return null; }
    try {
      const res = await ai.fullRegen({ productId: product.id });
      setWallet(await api.getWallet());
      return res;
    } catch (err) {
      if (err.code === 'INSUFFICIENT_CREDITS' || err.status === 402) setShowTopUp(true);
      return null;
    }
  };

  // Approve: PATCH the product live, refresh both lists from the server
  const handleApproveProduct = async (product, price, qty) => {
    const priceDigits = String(price || '').replace(/[^0-9]/g, '');
    try {
      await api.patchProduct(product.id, {
        status: 'live',
        ...(priceDigits ? { price: priceDigits } : {}),
        qty: parseInt(qty, 10) || 1,
      });
      const [products, pending] = await Promise.all([api.getProducts(), api.getPending()]);
      setProducts(products);
      setPendingReview(pending);
    } catch (err) {
      console.error('[approve] failed:', err);
    }
  };

  // Persist edits made inside the review modal
  const handleUpdatePending = async (productId, patch) => {
    try {
      await api.patchProduct(productId, patch);
      setPendingReview(await api.getPending());
    } catch (err) {
      console.error('[update] failed:', err);
    }
  };

  // Send to retake
  const handleSendToRetake = async (ids) => {
    for (const id of ids) {
      await api.patchProduct(id, { status: 'pending_retake' }).catch(() => {});
    }
    setPendingReview(await api.getPending());
  };

  // Bulk delete
  const handleDeletePending = async (ids) => {
    for (const id of ids) {
      await api.deleteProduct(id).catch(() => {});
    }
    setPendingReview(await api.getPending());
  };

  // Retake done: upload the new photo and send back to pending_approve
  const handleRetakeDone = async (productId, newImageSrc) => {
    try {
      const flatLay = await uploadPhoto(newImageSrc);
      await api.patchProduct(productId, { flatLay, status: 'pending_approve' });
      setPendingReview(await api.getPending());
    } catch (err) {
      // The product may have been deleted while the user was retaking —
      // don't let the retake silently vanish.
      if (err?.status === 404) {
        alert('This product was deleted. Your retake was not saved.');
      } else {
        console.error('[retake] failed:', err);
      }
    }
    setShowRetakeSession(false);
  };

  const pendingApprove = pendingReview.filter(p => p.status === 'pending_approve');
  const pendingRetake  = pendingReview.filter(p => p.status === 'pending_retake');
  const pendingDraft   = pendingReview.filter(p => p.status === 'draft');

  // Real notifications only — no fabricated demo messages. Server
  // announcements (pushed by the admin) appear first and can be dismissed.
  const announcementNotifs = announcements
    .filter((a) => !dismissed.includes(a.id))
    .slice(0, 5)
    .map((a) => ({
      id: `ann-${a.id}`,
      text: a.message ? `${a.title} — ${a.message}` : a.title,
      dismissable: true,
      annId: a.id,
    }));
  const notifications = [
    ...announcementNotifs,
    ...(pendingApprove.length > 0 ? [{ id: 1, text: `${pendingApprove.length} product${pendingApprove.length !== 1 ? 's' : ''} waiting for approval.` }] : []),
    ...(pendingDraft.length > 0 ? [{ id: 2, text: `${pendingDraft.length} draft${pendingDraft.length !== 1 ? 's' : ''} waiting for credits to generate.` }] : []),
    // team-only follow-ups never surface to regular sellers
    ...(isAdmin ? alerts.filter(a => !a.resolved).slice(0, 2).map((a, i) => ({
      id: 10 + i,
      text: `Team follow-up: ${a.storeName} needs a recharge nudge (${a.balance} credits).`,
    })) : []),
  ];
  const unreadAnnouncements = announcements.filter((a) => !dismissed.includes(a.id)).length;

  // ── Live-session join page (scanning phone — NO account needed). The QR
  //    links here with a one-time token; it must render BEFORE the auth gate.
  const joinMatch = window.location.pathname.match(/\/join\/([A-Za-z0-9_-]+)$/);
  if (joinMatch) {
    const q = new URLSearchParams(window.location.search);
    return (
      <JoinSessionView
        sessionId={joinMatch[1]}
        token={q.get('t') || ''}
        onReset={() => { window.location.href = import.meta.env.BASE_URL; }}
      />
    );
  }

  // ── Password-reset email link (mode=resetPassword&oobCode=…): show the
  //    branded reset screen before anything else — it works even when the
  //    visitor isn't signed in.
  if (resetFlow) {
    return (
      <ResetPasswordView
        oobCode={resetFlow.oobCode}
        onDone={() => {
          setResetFlow(null);
          window.history.replaceState({}, '', window.location.pathname);
        }}
      />
    );
  }

  // ── Auth gate: nothing renders until the session is verified ────────────
  if (!authChecked) {
    return <div className="ag-wrap"><div className="ai-spinner" style={{ margin: '0 auto' }} /></div>;
  }
  if (!authed) {
    return (
      <AuthGate onAuthed={(s) => { setSession(s || null); setAuthed(true); setShowPreloader(true); }} />
    );
  }
  // Signed in but email not verified (e.g. signed up on the website) → the
  // verify gate, not the app. The backend also 403s store creation until then.
  if (!session?.emailVerified) {
    return (
      <AuthGate
        initialVerifyEmail={session?.email}
        onAuthed={(s) => { setSession(s || null); setShowPreloader(true); }}
      />
    );
  }

  const handleSignOut = async () => {
    await auth.signOut();
    api.adminLock(); // owner console session dies with the login
    // ── Reset ALL in-memory state so the next account on this device starts
    //    with its own empty personal inventory — never the previous user's. ──
    setSession(null);
    setAuthed(false);
    setShowPreloader(false);
    setStoreProfile(null);
    setOnboardingDone(false);
    setProducts([]);
    setPendingReview([]);
    setWallet(null);
    setStores([]);
    setLedger([]);
    setAdminLedger([]);
    setAlerts([]);
    setLeads([]);
  };

  // Brand intro animation on load — the t-shirt K folds open, the AI+ pill
  // settles in front of the word, and the overlay lifts once the app behind
  // is actually ready (fonts + session) — never a fixed timer, never stuck.
  if (showPreloader) {
    return (
      <KatalogitPreloader
        ready={authChecked && fontsReady}
        onComplete={() => setShowPreloader(false)}
      />
    );
  }

  if (!onboardingDone) {
    return (
      <OnboardingFlow
        onComplete={handleOnboardingComplete}
        onDone={() => setOnboardingDone(true)}
      />
    );
  }

  return (
    <div className="web-app">
      {!session?.emailVerified && (
        <div className="verify-banner" role="status">
          <MailCheck size={14} />
          <span>Please verify your email (<strong>{session?.email}</strong>) to keep your account secure.</span>
          <button type="button" onClick={handleResendVerification}>Resend email</button>
        </div>
      )}
      <div className="app-body-container">

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <KatalogitLogo className="kat-logo-sidebar" />
          </div>
          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ id, label, Icon }) => (
              <button key={id}
                className={`sidebar-nav-item${activeTab === id ? ' active' : ''}`}
                onClick={() => setActiveTab(id)}>
                <Icon size={20} strokeWidth={activeTab === id ? 2.5 : 1.8}/>
                <span>{label}</span>
                {id === 'Review' && pendingApprove.length > 0 && (
                  <span className="sidebar-badge">{pendingApprove.length}</span>
                )}
                {activeTab === id && <div className="sidebar-active-bar"/>}
              </button>
            ))}
          </nav>
          <button className="sidebar-profile-pill" onClick={() => setActiveTab('Settings')}>
            <div className="sidebar-avatar"><User size={16}/></div>
            <div className="sidebar-profile-info">
              <span className="sidebar-profile-name">{storeProfile?.storeName || 'My Store'}</span>
              <span className="sidebar-profile-tier">{storeProfile?.city ? `${storeProfile.city} · B2B Vendor` : 'B2B Vendor'}</span>
            </div>
          </button>
        </aside>

        {/* MAIN PANEL */}
        <div className="main-panel">
          <header className="web-header">
            <div className="header-notch-pill">
              <span className="header-notch-brand">KatalogitAI</span>
              <div className="header-notch-stats">
                <span><TrendingUp size={11}/> {products.length} products live</span>
                <span>{wallet?.balance ?? 0} credits</span>
              </div>
            </div>
            <div className="web-header-right">
              <div className="header-icon-btn" onClick={() => setShowNotifications(v => !v)} style={{ position:'relative' }}>
                <Bell size={20} strokeWidth={2}/>
                {(pendingApprove.length > 0 || unreadAnnouncements > 0) && <span className="header-notif-dot"/>}
                {showNotifications && (
                  <div className="notif-dropdown" onClick={e => e.stopPropagation()}>
                    <div className="notif-dropdown-title">
                      Notifications
                      <span onClick={() => setShowNotifications(false)} style={{ cursor:'pointer', color:'var(--c-accent)' }}>✕</span>
                    </div>
                    {notifications.length === 0
                      ? <div className="notif-empty">You're all caught up.</div>
                      : notifications.map(n => (
                          <div key={n.id} className="notif-item">
                            <span style={{ flex: 1 }}>{n.text}</span>
                            {n.dismissable && (
                              <button
                                className="notif-dismiss"
                                aria-label="Dismiss"
                                onClick={() => dismissAnnouncement(n.annId)}
                              >✕</button>
                            )}
                          </div>
                        ))}
                  </div>
                )}
              </div>
              <button className="header-icon-btn" onClick={() => setActiveTab('Settings')} aria-label="Profile">
                <User size={20} strokeWidth={2}/>
              </button>
            </div>
          </header>

          <main className="web-content">
            {activeTab === 'Home' && (
              <>
                <BannerCarousel banners={banners} />
                <CatalogGrid products={products} onAddClick={() => setIsAddModalOpen(true)}
                  onProductClick={p => setSelectedPdpProduct(p)}
                  searchQuery={searchQuery} setSearchQuery={setSearchQuery}/>
              </>
            )}
            {activeTab === 'Review' && (
              <ReviewCenterView
                pendingApprove={pendingApprove}
                pendingRetake={pendingRetake}
                pendingDraft={pendingDraft}
                sessions={sessions}
                walletBalance={wallet?.balance ?? 0}
                onApprove={handleApproveProduct}
                onSendToRetake={handleSendToRetake}
                onDelete={handleDeletePending}
                onOpenRetakeSession={() => setShowRetakeSession(true)}
                onOpenTopUp={() => setShowTopUp(true)}
                onGenerateDraft={handleGenerateDraft}
                onRegenShot={handleRegenShot}
                onFullRegen={handleFullRegen}
                onUpdateProduct={handleUpdatePending}
                onCloseSession={handleCloseSession}
                onResumeSession={handleResumeSession}
              />
            )}
            {activeTab === 'Stats'    && <StatsView products={products} wallet={wallet} ledger={ledger} drafts={pendingDraft.length} />}
            {activeTab === 'Settings' && (
              <SettingsView
                profile={storeProfile}
                wallet={wallet}
                onOpenTopUp={() => setShowTopUp(true)}
                onOpenTransactions={() => setShowTransactions(true)}
                isAdmin={isAdmin}
                onOpenAdmin={openAdminConsole}
                onSignOut={handleSignOut}
                email={session?.email}
                emailVerified={session?.emailVerified}
                onResendVerification={handleResendVerification}
              />
            )}
          </main>

          <nav className="mobile-bottom-nav">
            {NAV_ITEMS.map(({ id, label, Icon }) => (
              <button key={id} className={`mobile-nav-item${activeTab === id ? ' active' : ''}`} onClick={() => setActiveTab(id)}>
                <Icon size={22} strokeWidth={activeTab === id ? 2.5 : 1.8}/>
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {isAddModalOpen && (
        <AddProductFlow
          onClose={() => { setIsAddModalOpen(false); setResumeSessionId(null); }}
          walletBalance={wallet?.balance ?? 0}
          onOpenTopUp={() => setShowTopUp(true)}
          onShootComplete={handleShootComplete}
          onLowBalanceAlert={handleLowBalanceAlert}
          initialSessionId={resumeSessionId}
          onSessionClosed={refreshSessions}
        />
      )}
      {selectedPdpProduct && (
        <ProductDetailModal
          product={selectedPdpProduct}
          storeName={storeProfile?.storeName || 'My Store'}
          onClose={() => setSelectedPdpProduct(null)}
        />
      )}
      {showRetakeSession && (
        <RetakeSession
          retakeQueue={pendingRetake}
          onClose={() => setShowRetakeSession(false)}
          onRetakeDone={handleRetakeDone}
        />
      )}

      {showTopUp && <TopUpModal onClose={() => setShowTopUp(false)} onTopUp={handleTopUp} initialPack={null}/>}
      {showTransactions && (
        <TransactionsModal wallet={wallet} ledger={ledger} onClose={() => setShowTransactions(false)}/>
      )}
      {showAdmin && (
        <AdminPanel
          stores={stores}
          ledger={adminLedger}
          alerts={alerts}
          leads={leads}
          banners={adminBanners}
          announcements={adminAnnouncements}
          onGift={handleGift}
          onResolveAlert={handleResolveAlert}
          onResolveLead={handleResolveLead}
          onSaveBanner={handleSaveBanner}
          onDeleteBanner={handleDeleteBanner}
          onSaveAnnouncement={handleSaveAnnouncement}
          onDeleteAnnouncement={handleDeleteAnnouncement}
          jobs={adminJobs}
          orders={adminOrders}
          onClose={() => setShowAdmin(false)}
          onLock={handleAdminLock}
        />
      )}
      {showAdminUnlock && (
        <AdminUnlockModal onUnlocked={handleAdminUnlocked} onClose={() => setShowAdminUnlock(false)} />
      )}
    </div>
  );
}
