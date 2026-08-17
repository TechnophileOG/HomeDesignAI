import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { X, Check, ArrowRight, QrCode, Sparkles, Camera, RotateCcw, ChevronLeft, RefreshCw, Coins, AlertTriangle, FileText, Clock } from 'lucide-react';
import { lowBalanceThresholdCredits, api } from '../api/client';

/* ── Real QR renderer (single-use join link for another phone) ─────────── */
function QrCanvas({ value, size = 190 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!value || !ref.current) return;
    QRCode.toCanvas(ref.current, value, {
      width: size, margin: 2,
      color: { dark: '#14201a', light: '#ffffff' },
    }).catch(() => { /* transient — retry on next poll */ });
  }, [value, size]);
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: 12, background: '#fff' }} />;
}

/* ── Clothing side icons ───────────────────────────────────────────────────── */
const FrontClothingIcon = ({ active }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
    stroke={active ? '#fff' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round">
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/>
  </svg>
);
const BackClothingIcon = ({ active }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
    stroke={active ? '#fff' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round">
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/>
    <path d="M9 13 Q12 17 15 13" strokeWidth="1.4" opacity=".7"/>
  </svg>
);

// Pipeline stages come from the AI module (src/api/ai.js) — the swappable
// provider drives real progress; the UI just renders it.

/* ── Captured mini-card (batch strip) — clickable to view / retake ───────── */
function CapturedCard({ item, index, onClick }) {
  return (
    <button
      type="button"
      className="af-captured-card"
      onClick={onClick}
      title="Tap to view / retake"
      style={{ cursor: 'pointer' }}
    >
      <img src={item.front} alt={`#${index + 1}`} className="af-captured-card-img" />
      {item.back && <div className="af-captured-card-back-badge"><BackClothingIcon active={false} /></div>}
      {item.saved && <div className="af-captured-card-saved" title="Saved to your account">✓</div>}
      <span className="af-captured-card-label">#{index + 1}</span>
    </button>
  );
}

/* ── Local cache: photos survive reloads until they reach the cloud ──────── */
const PENDING_KEY = 'kat_pending_shots_v1';
const readPendingShots = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
const persistBatch = (items) => {
  try {
    if (items.length) {
      // Keep the GCS path/mime when present (session photos are already in
      // the cloud — resuming must reference them, not re-upload).
      localStorage.setItem(PENDING_KEY, JSON.stringify(
        items.map((i) => ({
          front: i.front,
          back: i.back || null,
          ...(i.path ? { path: i.path, mime: i.mime || 'image/jpeg' } : {}),
        })).slice(0, 20),
      ));
    } else {
      localStorage.removeItem(PENDING_KEY);
    }
  } catch { /* quota exceeded — in-memory state still protects the session */ }
};
const clearPendingShots = () => {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
};

/* ── Live camera hook ──────────────────────────────────────────────────────── */
function useLiveCamera(active) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [ready,   setReady]   = useState(false);
  const [denied,  setDenied]  = useState(false);
  const [facingMode, setFacingMode] = useState('environment');

  const start = useCallback(async (facing = 'environment') => {
    // stop any existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setReady(false);
    setDenied(false);
    try {
      const constraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true));
        };
      }
    } catch (err) {
      console.warn('Camera error:', err);
      setDenied(true);
    }
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const flip = useCallback(() => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    start(next);
  }, [facingMode, start]);

  // capture current frame to a blob URL
  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready) return null;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, [ready]);

  useEffect(() => {
    if (active) start(facingMode);
    else        stop();
    return stop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { videoRef, ready, denied, flip, capture, restart: () => start(facingMode) };
}

/* ── CameraViewfinder ──────────────────────────────────────────────────────── */
function CameraViewfinder({ active, onCapture, photoData, side }) {
  const { videoRef, ready, denied, flip, capture, restart } = useLiveCamera(active && !photoData);
  const [flash, setFlash] = useState(false);

  const handleShutter = () => {
    const dataUrl = capture();
    if (dataUrl) {
      setFlash(true);
      setTimeout(() => setFlash(false), 350);
      onCapture(dataUrl);
    }
  };

  if (denied) {
    return (
      <div className="af-cam-denied">
        <Camera size={44} color="rgba(255,255,255,.3)" strokeWidth={1.4} />
        <p style={{ color:'#fff', fontWeight:700, textAlign:'center' }}>Camera access needed</p>
        <p style={{ color:'rgba(255,255,255,.5)', fontSize:'.78rem', textAlign:'center', maxWidth:240 }}>
          Allow camera in browser settings, then tap below.
        </p>
        <button className="af-cta" style={{ maxWidth:200 }} onClick={restart}>Allow Camera</button>
      </div>
    );
  }

  return (
    <div className="af-cam-view" style={{ cursor: photoData ? 'default' : 'pointer' }}
         onClick={!photoData ? handleShutter : undefined}>

      {/* Live video stream */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          width:'100%', height:'100%', objectFit:'cover',
          display: photoData ? 'none' : 'block',
        }}
      />

      {/* Captured photo */}
      {photoData && <img src={photoData} alt="captured" className="af-cam-img" />}

      {/* Frame guides (only when no photo yet) */}
      {!photoData && (
        <div className="af-cam-overlay-guides">
          <div className="af-cam-frame-guide">
            <div className="af-cam-corner tl"/><div className="af-cam-corner tr"/>
            <div className="af-cam-corner bl"/><div className="af-cam-corner br"/>
          </div>
          {!ready && (
            <span className="af-cam-hint" style={{ marginTop:12 }}>Starting camera…</span>
          )}
          {ready && (
            <span className="af-cam-hint">
              Tap anywhere to capture {side === 'front' ? 'front' : 'back'} side
            </span>
          )}
        </div>
      )}

      {flash && <div className="af-flash" />}

      {/* Flip camera button */}
      {!photoData && ready && (
        <button className="af-cam-flip-btn" onClick={e => { e.stopPropagation(); flip(); }}>
          <RefreshCw size={16} color="#fff" />
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Main component
══════════════════════════════════════════════════════════════════════════════ */
export default function AddProductFlow({ onClose, walletBalance = 0, onOpenTopUp, onShootComplete, onLowBalanceAlert, initialSessionId = null, onSessionClosed }) {
  // "really low" balance — can only catalog ~1-2 products before running dry
  const lowBalance = walletBalance < lowBalanceThresholdCredits();
  // fire the admin follow-up alert only once per modal session
  const lowBalanceAlertSent = useRef(false);
  const [step, setStep]     = useState('tutorial');
  // single
  const [side, setSide]     = useState('front');
  const [frontPhoto, setFrontPhoto] = useState(null);
  const [backPhoto,  setBackPhoto]  = useState(null);
  // batch
  const [batchItems, setBatchItems]               = useState([]);
  const [batchSide, setBatchSide]                 = useState('front');
  const [currentBatchFront, setCurrentBatchFront] = useState(null);
  // ── REAL live session (QR multi-device) ────────────────────────────────
  const [sessionId, setSessionId]       = useState(null);  // backend session
  const [joinUrl, setJoinUrl]           = useState('');    // current QR link
  const [joinToken, setJoinToken]       = useState('');
  const [sessionLive, setSessionLive]   = useState(null);  // polled status
  const [showQr, setShowQr]             = useState(false); // QR overlay (NEVER unmounts the camera)
  const [sessionError, setSessionError] = useState('');
  const [sessionBusy, setSessionBusy]   = useState(false);
  // AI
  const [aiProcessing, setAiProcessing] = useState(false);
  // Progress safety: photos are cached on-device until the cloud confirms
  // them, so a reload or a failed upload NEVER loses a capture.
  const [cachedShots, setCachedShots] = useState(readPendingShots);
  const [lightbox, setLightbox] = useState(null); // batch strip viewer { index }
  const [syncNote, setSyncNote] = useState('');    // quiet auto-flush status
  const [errorState, setErrorState] = useState(null); // { items, message }
  // Engine honesty: when the Vertex AI engine is offline, the user chooses
  // BEFORE anything is generated — Google's managed model now, or hold the
  // photos in drafts until the engine is online (no charge).
  const [aiStatus, setAiStatus] = useState(null);
  const [showConsent, setShowConsent] = useState(false);
  const consentChoiceRef = useRef(null); // null | 'generate' | 'hold'
  const pendingFlushRef = useRef(null);  // { targets, quiet } waiting on consent
  const autoFlushBusyRef = useRef(false);
  const batchItemsRef = useRef([]);
  batchItemsRef.current = batchItems;

  // Fetch the engine state once (never blocks the modal — it's advisory).
  useEffect(() => {
    let mounted = true;
    api.getAiStatus().then((s) => { if (mounted) setAiStatus(s); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  /* ── Resume/join an EXISTING session (from the Review Center): jump into
     bulk camera with that session and a fresh single-use QR. ───────────── */
  useEffect(() => {
    if (!initialSessionId) return;
    let alive = true;
    (async () => {
      try {
        const [res, status] = await Promise.all([
          api.mintJoinUrl(initialSessionId),
          api.getSessionStatus(initialSessionId).catch(() => null),
        ]);
        if (!alive) return;
        setBatchItems([]); setCurrentBatchFront(null); setBatchSide('front');
        setSessionId(initialSessionId);
        setJoinUrl(res.joinUrl);
        setJoinToken(res.joinToken);
        setSessionLive(status || { id: initialSessionId, status: 'active', devices: [], photoCount: 0 });
        setStep('batchCamera');
      } catch (err) {
        console.error('[session] resume failed:', err);
        if (alive) setSessionError('That session could not be resumed — starting fresh.');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  const resumeShots = () => {
    setBatchItems(cachedShots.map((s) => ({ front: s.front, back: s.back || null, ...(s.path ? { path: s.path, mime: s.mime } : {}), saved: false })));
    persistBatch(cachedShots);
    setCachedShots([]);
  };
  const discardShots = () => { setCachedShots([]); clearPendingShots(); };

  /* User chose how to proceed while the proprietary model is offline. The
     choice sticks for the whole session; the pending flush (if any) runs. */
  const chooseConsent = (choice) => {
    consentChoiceRef.current = choice;
    setShowConsent(false);
    const pending = pendingFlushRef.current;
    pendingFlushRef.current = null;
    if (pending) flushShots(pending.targets, { quiet: pending.quiet });
  };

  /* ── Start a REAL live session (registered server-side; each QR = one
     single-use join link). On failure the session is skipped and capture
     still works locally — the user is told, nothing is lost. ──────────── */
  const startSession = async () => {
    setSessionBusy(true);
    setSessionError('');
    try {
      const res = await api.createSession('Bulk cataloging session');
      setSessionId(res.session.id);
      setJoinUrl(res.joinUrl);
      setJoinToken(res.joinToken);
      setSessionLive({ id: res.session.id, status: 'active', devices: [], photoCount: 0, activity: [] });
    } catch (err) {
      console.error('[session] create failed:', err);
      setSessionError('Could not start a live session — capturing will continue on this device only.');
      setSessionId(null);
    } finally {
      setSessionBusy(false);
      setStep('batchCamera');
    }
  };

  /* ── Live status polling while the session is open (cheap light GET). ── */
  useEffect(() => {
    if (!sessionId || step !== 'batchCamera') return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const s = await api.getSessionStatus(sessionId);
        if (alive && s) setSessionLive(s);
      } catch { /* transient — keep last known state */ }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [sessionId, step]);

  /* ── Mint a FRESH single-use QR (the previous one dies the moment it's
     scanned or after 15 min — the owner taps this for each new phone). ── */
  const refreshQr = async () => {
    if (!sessionId || sessionBusy) return;
    setSessionBusy(true);
    try {
      const res = await api.mintJoinUrl(sessionId);
      setJoinUrl(res.joinUrl);
      setJoinToken(res.joinToken);
    } catch (err) {
      setSessionError('Could not create a fresh QR — tap again.');
    } finally { setSessionBusy(false); }
  };

  /* ── Close the session, pull every remote capture, merge into the strip
     so the normal review/save flow owns them (credits/consent/drafts all
     apply). The owner's own shots are already in the strip. ───────────── */
  const pullSessionPhotos = async () => {
    if (!sessionId) return;
    try {
      await api.closeSession(sessionId);
      const photos = await api.getSessionPhotos(sessionId);
      if (photos.length) {
        const merged = [...batchItemsRef.current];
        const seen = new Set(merged.map((i) => i.front));
        for (const p of photos) {
          if (!seen.has(p.url)) {
            // Already in GCS — carry the path so product creation references
            // it directly (no re-upload); the URL is for display in the strip.
            merged.push({ front: p.url, path: p.path, mime: p.mime, size: p.size, back: null, saved: false });
            seen.add(p.url);
          }
        }
        setBatchItems(merged);
        persistBatch(merged);
      }
      setSessionId(null);
      setJoinUrl('');
      setSessionLive(null);
      setShowQr(false);
    } catch (err) {
      console.error('[session] close/pull failed:', err);
      setSessionError('The session could not be closed. Your photos are safe on this device — try again.');
    }
  };

  // ── Low balance: warn the user AND queue a follow-up for the team ────────
  useEffect(() => {
    if (lowBalance && !lowBalanceAlertSent.current && onLowBalanceAlert) {
      lowBalanceAlertSent.current = true;
      onLowBalanceAlert();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Low-balance warning banner (shown before the shoot starts) ────────── */
  const LowBalanceBanner = (
    <div className="af-low-balance-banner">
      <div className="af-low-balance-icon"><AlertTriangle size={16} /></div>
      <div className="af-low-balance-body">
        <strong>Balance running low</strong>
        <span>
          Your balance ({walletBalance} credits) covers only about 1-2 AI shoots.
          Photos you capture now will be saved as drafts until you recharge.
        </span>
      </div>
      <button
        className="af-low-balance-recharge"
        onClick={() => onOpenTopUp && onOpenTopUp()}
      >
        <Coins size={13} /> Recharge
      </button>
    </div>
  );

  /* ── Push photos to the cloud (server creates products + queues AI jobs,
     or saves drafts when credits are low). Confirmed items are marked saved;
     anything that fails stays in the local cache — progress is never lost. ── */
  const flushShots = async (items, { quiet = false } = {}) => {
    const targets = (Array.isArray(items) ? items : [items]).filter((i) => i && i.front);
    if (!targets.length || aiProcessing) return;

    // Fallback engine honesty gate: when our proprietary model is offline
    // and the user hasn't chosen yet, ASK first — never silently generate
    // with a third-party model, never silently hold either.
    if (aiStatus?.fallbackActive && !consentChoiceRef.current) {
      pendingFlushRef.current = { targets, quiet };
      setShowConsent(true);
      return;
    }

    setAiProcessing(true);
    setErrorState(null);
    setSyncNote('');
    try {
      const res = onShootComplete
        ? await onShootComplete(targets, { hold: consentChoiceRef.current === 'hold' })
        : { status: 'error', saved: [], failed: targets, error: 'Upload service unavailable.' };
      if (res.status === 'held') setStep('heldSaved');
      const savedFronts = new Set((res.saved || []).map((i) => i.front));
      const failed = (res.failed && res.failed.length ? res.failed : targets.filter((i) => !savedFronts.has(i.front)));
      const next = batchItemsRef.current.map((i) => (savedFronts.has(i.front) ? { ...i, saved: true } : i));
      for (const t of failed) if (!next.some((i) => i.front === t.front)) next.push({ front: t.front, back: t.back || null, saved: false });
      setBatchItems(next);
      persistBatch(next);

      if (res.status === 'success') setStep('success');
      else if (res.status === 'draft') setStep('draftSaved');
      else if (quiet && failed.length === targets.length) {
        setSyncNote(`${failed.length} photo${failed.length !== 1 ? 's' : ''} waiting to upload — they'll be saved when you finish.`);
      } else {
        setErrorState({
          items: failed.length ? failed : targets,
          message: res.error || 'Your photos could not be uploaded. They are safe on this device — tap Retry.',
        });
      }
    } catch (err) {
      console.error('[ai] flush failed:', err);
      // Keep every photo locally so the user can retry — never lose progress.
      const next = [...batchItemsRef.current];
      for (const t of targets) if (!next.some((i) => i.front === t.front)) next.push({ front: t.front, back: t.back || null, saved: false });
      setBatchItems(next);
      persistBatch(next);
      setErrorState({
        items: targets,
        message: err?.message || 'Your photos could not be uploaded. They are safe on this device — tap Retry.',
      });
    } finally {
      setAiProcessing(false);
    }
  };

  /* Auto-flush in-flight: every 5 newly captured photos go to the cloud as
     drafts while the live session continues — nothing waits until the end. */
  useEffect(() => {
    if (step !== 'batchCamera' || autoFlushBusyRef.current) return;
    const unsaved = batchItems.filter((i) => !i.saved);
    if (unsaved.length >= 5) {
      autoFlushBusyRef.current = true;
      flushShots(unsaved.slice(0, 5), { quiet: true }).finally(() => { autoFlushBusyRef.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchItems, step]);

  const commitBatchFront = () => {
    if (!currentBatchFront) return;
    const next = [...batchItemsRef.current, { front: currentBatchFront, back: null, saved: false }];
    setBatchItems(next);
    persistBatch(next);
    setCurrentBatchFront(null);
    setBatchSide('front');
  };

  /* Save every captured item (server stores drafts when credits are low).
     Anything already saved to the cloud is skipped. When a live session is
     open, its remote captures are pulled in FIRST so nothing is left behind. */
  const saveAll = async () => {
    if (sessionId) {
      setSessionBusy(true);
      await pullSessionPhotos(); // merges remote photos into the strip
      setSessionBusy(false);
    }
    const all = currentBatchFront
      ? [...batchItemsRef.current, { front: currentBatchFront, back: null, saved: false }]
      : batchItemsRef.current;
    const unsaved = all.filter((i) => !i.saved);
    if (!unsaved.length) { onClose(); return; }
    flushShots(unsaved);
  };

  /* Retake/remove one captured item (from the strip lightbox). */
  const removeItem = (index) => {
    const next = batchItemsRef.current.filter((_, i) => i !== index);
    setBatchItems(next);
    persistBatch(next);
    setLightbox(null);
  };

  const isCameraStep = step === 'singleCamera' || step === 'batchCamera';

  /* ── User chose to wait for the proprietary model → photos held ──────── */
  if (step === 'heldSaved') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content af-modal" style={{ textAlign:'center', alignItems:'center', gap:18 }}>
          <button className="af-close" onClick={onClose}><X size={18}/></button>
          <div className="af-insufficient-icon af-insufficient-icon-draft">
            <Clock size={30} />
          </div>
          <h2 className="af-big-title" style={{ fontSize:'1.25rem', marginTop:4 }}>Photos safely held</h2>
          <p className="af-hint-text" style={{ textAlign:'center' }}>
            You chose to wait for our proprietary model.<br/>
            Your photos are safe in <strong>Review Center → Drafts</strong> — no credits charged.<br/>
            We'll generate the photoshoot with our own model the moment it's online.
          </p>
          <button className="af-cta" style={{ maxWidth: 260 }} onClick={onClose}>
            View my drafts
          </button>
        </div>
      </div>
    );
  }

  /* ── Insufficient credits → photos saved as drafts ────────────────────── */
  if (step === 'draftSaved') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content af-modal" style={{ textAlign:'center', alignItems:'center', gap:18 }}>
          <button className="af-close" onClick={onClose}><X size={18}/></button>
          <div className="af-insufficient-icon af-insufficient-icon-draft">
            <FileText size={30} />
          </div>
          <h2 className="af-big-title" style={{ fontSize:'1.25rem', marginTop:4 }}>Saved to Drafts</h2>
          <p className="af-hint-text" style={{ textAlign:'center' }}>
            Not enough credits to generate apparel.<br/>
            Your photos are safe in <strong>Review Center → Drafts</strong>.<br/>
            Recharge to generate your AI photoshoot.
          </p>
          <button
            className="af-cta"
            style={{ maxWidth: 260 }}
            onClick={() => {
              setStep('tutorial');
              if (onOpenTopUp) onOpenTopUp();
            }}
          >
            <Coins size={16}/> Recharge &amp; generate
          </button>
          <button
            className="af-back-pill"
            style={{ alignSelf:'center' }}
            onClick={onClose}
          >
            <ChevronLeft size={15}/> Close
          </button>
        </div>
      </div>
    );
  }

  /* ── Upload failed → explicit retry (photos stay cached on-device) ────── */
  if (step === 'error' && errorState) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content af-modal" style={{ textAlign:'center', alignItems:'center', gap:18 }}>
          <button className="af-close" onClick={onClose}><X size={18}/></button>
          <div className="af-insufficient-icon af-insufficient-icon-draft">
            <AlertTriangle size={30} />
          </div>
          <h2 className="af-big-title" style={{ fontSize:'1.25rem', marginTop:4 }}>Photos not uploaded yet</h2>
          <p className="af-hint-text" style={{ textAlign:'center', maxWidth: 300 }}>
            {errorState.message}
          </p>
          <p className="af-hint-text" style={{ textAlign:'center', fontWeight: 700 }}>
            Your photos are saved on this device — nothing is lost.
          </p>
          <button className="af-cta" style={{ maxWidth: 280 }} onClick={() => flushShots(errorState.items)}>
            <RefreshCw size={15}/> Retry upload
          </button>
          <button className="af-back-pill" style={{ alignSelf:'center' }} onClick={onClose}>
            <ChevronLeft size={15}/> Close (photos stay saved)
          </button>
        </div>
      </div>
    );
  }

  /* ── AI overlay ─────────────────────────────────────────────────────────── */
  if (aiProcessing) {
    const src = frontPhoto || batchItems[0]?.front || `${import.meta.env.BASE_URL}assets/tshirt.png`;
    return (
      <div className="modal-overlay">
        <div className="modal-content af-modal" style={{ textAlign:'center', alignItems:'center', gap:20 }}>
          <div className="af-ai-anim">
            <div className="af-ai-anim-left">
              <img src={src} alt="product" className="af-ai-product-img" />
              <span className="af-ai-label">Your photo</span>
            </div>
            <div className="af-ai-arrow"><Sparkles size={22} className="af-ai-spark" /></div>
            <div className="af-ai-anim-right">
              <div className="af-ai-product-img af-ai-model-img af-ai-pending"><Sparkles size={26} color="var(--c-accent)" /></div>
              <span className="af-ai-label">AI photoshoot</span>
            </div>
          </div>
          <div className="ai-spinner" style={{ margin:'0 auto' }} />
          <p style={{ fontFamily:'var(--font-geom)', fontWeight:700, fontSize:'1rem', color:'var(--c-accent)' }}>
            Saving your product…
          </p>
          <p style={{ fontSize:'.78rem', opacity:.65, marginTop:-12 }}>
            Uploading photos &amp; queueing the AI photoshoot — this can take a moment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={isCameraStep ? undefined : onClose}>
      <div className={`modal-content af-modal${isCameraStep ? ' af-modal-dark' : ''}`}
           onClick={e => e.stopPropagation()}>

        {!isCameraStep && (
          <button className="af-close" onClick={onClose}><X size={18}/></button>
        )}

        {/* ── TUTORIAL ── */}
        {step === 'tutorial' && (
          <div className="af-sw">
            <button className="af-skip" onClick={() => setStep('modeSelect')}>Skip</button>
            {lowBalance && LowBalanceBanner}
            <div className="af-label-tag">How it works</div>
            <h2 className="af-big-title">Add a product<br/>in 3 easy steps</h2>
            <div className="af-vis-steps">
              <div className="af-vis-step">
                <div className="af-vis-step-img-wrap" style={{ background:'#1a1514' }}>
                  <img src={`${import.meta.env.BASE_URL}assets/tshirt.png`} alt="flatlay" className="af-vis-step-img" style={{ opacity:.85 }}/>
                  <div className="af-vis-step-overlay"><Camera size={20} color="#fff" strokeWidth={1.8}/><span>Take a photo</span></div>
                </div>
                <div className="af-vis-step-num">1</div>
                <p className="af-vis-step-caption">Lay your product flat and snap a photo — no studio needed.</p>
              </div>
              <div className="af-vis-step-arrow">→</div>
              <div className="af-vis-step">
                <div className="af-vis-step-img-wrap" style={{ background:'#0f2b1e', alignItems:'center', justifyContent:'center' }}>
                  <Sparkles size={34} color="#6fd49d" strokeWidth={1.4}/>
                  <div className="af-vis-step-overlay"><span style={{ fontSize:'.72rem' }}>AI working…</span></div>
                </div>
                <div className="af-vis-step-num">2</div>
                <p className="af-vis-step-caption">AI writes the title, price &amp; description and places it on a model.</p>
              </div>
              <div className="af-vis-step-arrow">→</div>
              <div className="af-vis-step">
                <div className="af-vis-step-img-wrap" style={{ background:'#edf6f1' }}>
                  <img src={`${import.meta.env.BASE_URL}assets/model_female.png`} alt="result" className="af-vis-step-img"/>
                  <div className="af-vis-step-overlay"><Check size={18} color="#fff" strokeWidth={2.5}/><span>Live in catalogue</span></div>
                </div>
                <div className="af-vis-step-num">3</div>
                <p className="af-vis-step-caption">Your product goes live — complete with a model photoshoot.</p>
              </div>
            </div>
            <button className="af-cta" onClick={() => setStep('modeSelect')}>Let's go →</button>
          </div>
        )}

        {/* ── MODE SELECT ── */}
        {step === 'modeSelect' && (
          <div className="af-sw">
            {lowBalance && LowBalanceBanner}
            {cachedShots.length > 0 && (
              <div className="af-resume-banner">
                <div className="af-resume-icon">📸</div>
                <div className="af-resume-body">
                  <strong>{cachedShots.length} photo{cachedShots.length !== 1 ? 's' : ''} saved on this device</strong>
                  <span>From an earlier session that wasn't finished — resume to upload them to your drafts.</span>
                </div>
                <div className="af-resume-actions">
                  <button className="af-cta" style={{ padding: '7px 14px', fontSize: '.74rem' }} onClick={resumeShots}>Resume</button>
                  <button className="af-back-pill" style={{ padding: '7px 14px', fontSize: '.74rem' }} onClick={discardShots}>Discard</button>
                </div>
              </div>
            )}
            <h2 className="af-section-title">How many products?</h2>
            <p className="af-hint-text" style={{ textAlign:'left', marginTop:-8 }}>Pick a mode to get started</p>
            <div className="af-mode-card af-mode-featured" onClick={() => { setSide('front'); setFrontPhoto(null); setBackPhoto(null); setStep('singleCamera'); }}>
              <div className="af-mode-img-thumb">
                <img src={`${import.meta.env.BASE_URL}assets/tshirt.png`} alt="single"/>
                <div className="af-mode-img-badge">1 item</div>
              </div>
              <div>
                <div className="af-mode-title">One Product</div>
                <div className="af-mode-sub">Photograph front side, optional back side.</div>
              </div>
            </div>
            <div className="af-mode-card" onClick={() => setStep('batchIntro')}>
              <div className="af-mode-img-thumb af-mode-img-thumb-batch">
                <img src={`${import.meta.env.BASE_URL}assets/tshirt.png`} alt="b1" style={{ transform:'rotate(-8deg) translateX(-6px)' }}/>
                <img src={`${import.meta.env.BASE_URL}assets/sneaker.png`} alt="b2" style={{ transform:'rotate(6deg) translateX(6px)', marginTop:-20 }}/>
                <div className="af-mode-img-badge">Many items</div>
              </div>
              <div>
                <div className="af-mode-title">Multiple Products</div>
                <div className="af-mode-sub">Shoot many items in one live session. Add phones via QR.</div>
              </div>
            </div>
          </div>
        )}

        {/* ── SINGLE CAMERA ── */}
        {step === 'singleCamera' && (
          <div className="af-cam-screen">
            <div className="af-cam-header">
              <button className="af-cam-x" onClick={() => setStep('modeSelect')}><ChevronLeft size={17} color="#fff"/></button>
              <span className="af-cam-title">ONE PRODUCT</span>
              <button className="af-cam-x" onClick={onClose}><X size={17} color="#fff"/></button>
            </div>

            <div className="af-side-selector">
              <button className={`af-side-btn${side === 'front' ? ' active' : ''}`} onClick={() => setSide('front')}>
                <FrontClothingIcon active={side === 'front'}/>
                <span>Front</span>
                {frontPhoto && <div className="af-side-done-dot"/>}
              </button>
              <div className="af-side-divider"/>
              <button className={`af-side-btn${side === 'back' ? ' active' : ''}`}
                      onClick={() => setSide('back')}
                      disabled={!frontPhoto} style={{ opacity: frontPhoto ? 1 : 0.35 }}>
                <BackClothingIcon active={side === 'back'}/>
                <span>Back <span style={{ fontSize:'.6rem', opacity:.7 }}>(optional)</span></span>
                {backPhoto && <div className="af-side-done-dot"/>}
              </button>
            </div>

            <CameraViewfinder
              active={step === 'singleCamera'}
              side={side}
              photoData={side === 'front' ? frontPhoto : backPhoto}
              onCapture={dataUrl => { if (side === 'front') { setFrontPhoto(dataUrl); setSide('back'); } else setBackPhoto(dataUrl); }}
            />

            <div className="af-cam-bar">
              {((side === 'front' && frontPhoto) || (side === 'back' && backPhoto)) ? (
                <button className="af-ctrl af-ctrl-retake" onClick={() => { if (side==='front'){setFrontPhoto(null);setBackPhoto(null);}else setBackPhoto(null); }}>
                  <RotateCcw size={18} color="#fff"/>
                </button>
              ) : <div style={{ width:50 }}/>}

              <button className="af-shutter" onClick={() => {
                const el = document.querySelector('.af-cam-view');
                if (el) el.click();
              }}>
                <div className="af-shutter-inner"/>
              </button>

              <button className="af-ctrl af-ctrl-confirm"
                      style={{ opacity: frontPhoto ? 1 : 0.3 }}
                      onClick={() => frontPhoto && flushShots({ front: frontPhoto, back: backPhoto })}>
                <ArrowRight size={20} color="#fff"/>
              </button>
            </div>
          </div>
        )}

        {/* ── BATCH INTRO ── */}
        {step === 'batchIntro' && (
          <div className="af-sw">
            <button className="af-back-pill" onClick={() => setStep('modeSelect')}><ChevronLeft size={15}/> Back</button>
            <h2 className="af-section-title">Batch Live Session</h2>
            <p className="af-hint-text" style={{ textAlign:'left', marginTop:-8 }}>One session, many phones, many products.</p>
            <div className="af-batch-how">
              <div className="af-batch-how-step"><div className="af-batch-how-icon">📱</div><p>Scan QR on other phones</p></div>
              <div className="af-batch-how-arrow">→</div>
              <div className="af-batch-how-step"><div className="af-batch-how-icon">📸</div><p>Everyone shoots simultaneously</p></div>
              <div className="af-batch-how-arrow">→</div>
              <div className="af-batch-how-step"><div className="af-batch-how-icon" style={{ background:'#edf6f1' }}><Sparkles size={20} color="var(--c-accent)"/></div><p>AI processes everything</p></div>
            </div>
            {sessionError && <p className="af-sync-note" style={{ color:'#e8a04c', fontWeight:600, textAlign:'left' }}>{sessionError}</p>}
            <button
              className="af-cta"
              disabled={sessionBusy}
              style={{ opacity: sessionBusy ? .6 : 1 }}
              onClick={() => {
                setBatchItems([]); setCurrentBatchFront(null); setBatchSide('front');
                startSession();
              }}
            >
              {sessionBusy ? 'Starting live session…' : 'Start Session →'}
            </button>
            <p className="af-hint-text" style={{ textAlign:'center', fontSize:'.68rem', opacity:.55, marginTop:-6 }}>
              A secure live session is registered — each phone scans its own one-time QR.
            </p>
          </div>
        )}

        {/* ── BATCH CAMERA ── */}
        {step === 'batchCamera' && (
          <div className="af-cam-screen">
            <div className="af-cam-header">
              <button className="af-cam-x" onClick={() => setStep('batchIntro')}><ChevronLeft size={17} color="#fff"/></button>
              <span className="af-cam-title">● LIVE · {(sessionLive?.devices?.length || 0) + 1} device{((sessionLive?.devices?.length || 0) + 1) !== 1 ? 's' : ''}{sessionLive?.photoCount > 0 ? ` · ${sessionLive.photoCount} photos in` : ''}</span>
              <button className="af-cam-x" onClick={onClose}><X size={17} color="#fff"/></button>
            </div>

            <div className="af-side-selector">
              <button className={`af-side-btn${batchSide==='front'?' active':''}`} onClick={() => setBatchSide('front')}>
                <FrontClothingIcon active={batchSide==='front'}/>
                <span>Front</span>
                {currentBatchFront && <div className="af-side-done-dot"/>}
              </button>
              <div className="af-side-divider"/>
              <button className={`af-side-btn${batchSide==='back'?' active':''}`}
                      onClick={() => setBatchSide('back')}
                      disabled={!currentBatchFront} style={{ opacity: currentBatchFront ? 1 : 0.35 }}>
                <BackClothingIcon active={batchSide==='back'}/>
                <span>Back <span style={{ fontSize:'.6rem', opacity:.7 }}>(optional)</span></span>
              </button>
              {currentBatchFront && (
                <button className="af-side-skip-btn" onClick={commitBatchFront}>Next →</button>
              )}
            </div>

            <CameraViewfinder
              active={step === 'batchCamera'}
              side={batchSide}
              photoData={batchSide === 'front' ? currentBatchFront : null}
              onCapture={dataUrl => {
                if (batchSide === 'front') { setCurrentBatchFront(dataUrl); setBatchSide('back'); }
                else {
                  const next = [...batchItemsRef.current, { front: currentBatchFront, back: dataUrl, saved: false }];
                  setBatchItems(next);
                  persistBatch(next);
                  setCurrentBatchFront(null); setBatchSide('front');
                }
              }}
            />

            {/* Captured strip — tap a card to view / retake it */}
            {batchItems.length > 0 && (
              <div className="af-captured-strip">
                <span className="af-captured-strip-label">
                  This device · {batchItems.length} product{batchItems.length !== 1 ? 's' : ''}
                  {batchItems.filter((i) => i.saved).length > 0 && (
                    <span style={{ color: '#7fd0a8', marginLeft: 6 }}>
                      · {batchItems.filter((i) => i.saved).length} saved to cloud
                    </span>
                  )}
                </span>
                <div className="af-captured-strip-scroll">
                  {batchItems.map((item, i) => (
                    <CapturedCard key={i} item={item} index={i} onClick={() => setLightbox({ index: i })} />
                  ))}
                </div>
                {syncNote && <span className="af-sync-note">{syncNote}</span>}
              </div>
            )}

            <div className="af-cam-bar">
              {(batchSide==='front' && currentBatchFront) ? (
                <button className="af-ctrl af-ctrl-retake" onClick={() => { setCurrentBatchFront(null); setBatchSide('front'); }}>
                  <RotateCcw size={18} color="#fff"/>
                </button>
              ) : <div style={{ width:50 }}/>}

              <button className="af-shutter" onClick={() => {
                const el = document.querySelector('.af-cam-view');
                if (el) el.click();
              }}>
                <div className="af-shutter-inner"/>
              </button>

              <button
                className="af-ctrl af-ctrl-qr"
                onClick={() => {
                  if (!sessionId) return; // no live session → nothing to scan
                  setShowQr(true);        // overlay — the camera keeps running, progress kept
                }}
                title="Show join QR"
              >
                <QrCode size={18} color="#fff"/>
              </button>

              <button className="af-ctrl af-ctrl-confirm"
                      style={{ opacity: batchItems.length > 0 || currentBatchFront ? 1 : 0.3 }}
                      onClick={() => {
                        if (batchItems.length === 0 && !currentBatchFront) return;
                        // The server decides: funds the AI pass or saves drafts
                        saveAll();
                      }}>
                <ArrowRight size={20} color="#fff"/>
              </button>
            </div>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {step === 'success' && (
          <div className="af-sw" style={{ textAlign:'center', alignItems:'center', paddingTop:20 }}>
            <div className="af-success-compare">
              <div className="af-success-compare-box">
                <img src={frontPhoto || batchItems[0]?.front || `${import.meta.env.BASE_URL}assets/tshirt.png`} alt="original"/>
                <span>Your photo</span>
              </div>
              <div className="af-success-arrow">✦</div>
              <div className="af-success-compare-box af-success-compare-box-result">
                <img src={`${import.meta.env.BASE_URL}assets/model_female.png`} alt="AI result"/>
                <span>AI model</span>
              </div>
            </div>
            <div className="af-success-ring" style={{ margin:'4px auto' }}>✓</div>
            <h2 className="af-big-title" style={{ color:'var(--c-success)' }}>Sent to Review!</h2>
            <p className="af-hint-text">
              Your product is in the <strong>Review Center</strong>.<br/>
              The AI photoshoot is queued and will appear when processing completes.
            </p>
            <button className="af-cta" onClick={onClose}>View Catalogue</button>
          </div>
        )}

      </div>

      {/* ── Live-session QR overlay — the camera underneath keeps running ── */}
      {showQr && sessionId && !aiProcessing && (
        <div className="modal-overlay af-qr-overlay" onClick={() => setShowQr(false)}>
          <div className="modal-content af-modal" style={{ maxWidth: 360, textAlign:'center', alignItems:'center', gap:14 }} onClick={(e) => e.stopPropagation()}>
            <button className="af-close" onClick={() => setShowQr(false)}><X size={18}/></button>
            <h3 className="af-big-title" style={{ fontSize:'1.1rem', marginTop:2 }}>Add another phone</h3>
            <p className="af-hint-text" style={{ textAlign:'center', marginTop:-8, fontSize:'.74rem' }}>
              One-time QR — it works for the <strong>first scan only</strong> and expires in 15 minutes.
            </p>
            <div className="af-qr-canvas">
              <QrCanvas value={joinUrl ? `${window.location.origin}${joinUrl}` : ''} />
            </div>
            <div className="af-session-devices">
              {(sessionLive?.devices || []).length === 0 ? (
                <span className="af-session-device-empty">No phones joined yet — scan the QR</span>
              ) : (
                (sessionLive.devices || []).map((d) => (
                  <span key={d.deviceId} className="af-session-device">
                    📱 {d.deviceName || 'Phone'}
                  </span>
                ))
              )}
              <span className="af-session-device">✨ You (owner)</span>
            </div>
            <p className="af-sync-note" style={{ color:'#e8a04c', textAlign:'center' }}>{sessionError}</p>
            <div className="af-session-actions">
              <button className="af-cta" style={{ maxWidth: 260, padding:'9px 14px', fontSize:'.75rem' }} onClick={refreshQr} disabled={sessionBusy}>
                <RefreshCw size={13}/> New QR for next phone
              </button>
              <button className="af-back-pill" style={{ alignSelf:'center' }} onClick={pullSessionPhotos} disabled={sessionBusy}>
                <Check size={14}/> Close session &amp; bring photos here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fallback-engine consent — honest choice before any generation ── */}
      {showConsent && !aiProcessing && aiStatus?.fallbackActive && (
        <div className="modal-overlay af-consent-overlay" onClick={() => setShowConsent(false)}>
          <div className="modal-content af-modal" style={{ textAlign:'center', alignItems:'center', gap:14 }} onClick={(e) => e.stopPropagation()}>
            <button className="af-close" onClick={() => setShowConsent(false)}><X size={18}/></button>
            <div className="af-insufficient-icon af-insufficient-icon-draft">
              <Sparkles size={28} />
            </div>
            <h2 className="af-big-title" style={{ fontSize:'1.2rem', marginTop:2 }}>How should we generate these?</h2>
            <p className="af-hint-text" style={{ textAlign:'center', maxWidth:320 }}>
              Our proprietary Katalogit model is still coming online.
              Until then you can generate with <strong>Google's model</strong> (best
              quality available right now), or <strong>hold your photos</strong> and we'll
              use our own model the moment it's ready — no credits charged for holding.
            </p>
            <button className="af-cta" style={{ width:'100%', maxWidth:300 }} onClick={() => chooseConsent('generate')}>
              <Sparkles size={15}/> Generate with Google's model (3 credits)
            </button>
            <button className="af-back-pill" style={{ alignSelf:'center' }} onClick={() => chooseConsent('hold')}>
              <Clock size={14}/> Hold — use our model when it's online
            </button>
            <p className="af-hint-text" style={{ fontSize:'.68rem', opacity:.55, marginTop:-6 }}>
              You can also close this and your photos stay safe on this device.
            </p>
          </div>
        </div>
      )}

      {/* ── Batch strip lightbox — view a capture, remove & retake ── */}
      {lightbox && batchItems[lightbox.index] && (
        <div className="modal-overlay af-lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="modal-content af-modal af-lightbox" onClick={(e) => e.stopPropagation()}>
            <button className="af-close" onClick={() => setLightbox(null)}><X size={18}/></button>
            <div className="af-lightbox-img-wrap">
              <img src={batchItems[lightbox.index].front} alt={`Product #${lightbox.index + 1}`} className="af-lightbox-img" />
              {batchItems[lightbox.index].back && (
                <img src={batchItems[lightbox.index].back} alt="back" className="af-lightbox-img" />
              )}
            </div>
            <p className="af-hint-text" style={{ textAlign: 'center', fontWeight: 700 }}>
              Product #{lightbox.index + 1}
              {batchItems[lightbox.index].back ? ' · front + back' : ' · front only'}
              {batchItems[lightbox.index].saved ? ' · ✓ saved' : ' · saved on device'}
            </p>
            <div className="af-lightbox-actions">
              <button className="af-cta" style={{ maxWidth: 220 }} onClick={() => removeItem(lightbox.index)}>
                <RotateCcw size={15}/> Remove & retake
              </button>
              <button className="af-back-pill" style={{ alignSelf: 'center' }} onClick={() => setLightbox(null)}>
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
