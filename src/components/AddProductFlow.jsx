import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, ArrowRight, QrCode, Sparkles, Camera, RotateCcw, ChevronLeft, RefreshCw, Coins, AlertTriangle, FileText } from 'lucide-react';
import { lowBalanceThresholdCredits } from '../api/client';

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

/* ── Captured mini-card (batch strip) ─────────────────────────────────────── */
function CapturedCard({ item, index }) {
  return (
    <div className="af-captured-card">
      <img src={item.front} alt={`#${index + 1}`} className="af-captured-card-img" />
      {item.back && <div className="af-captured-card-back-badge"><BackClothingIcon active={false} /></div>}
      <span className="af-captured-card-label">#{index + 1}</span>
    </div>
  );
}

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
export default function AddProductFlow({ onClose, walletBalance = 0, onOpenTopUp, onShootComplete, onLowBalanceAlert }) {
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
  const [devicesJoined, setDevicesJoined]         = useState(1);
  // AI
  const [aiProcessing, setAiProcessing] = useState(false);

  // simulate extra devices joining
  useEffect(() => {
    if (step !== 'batchCamera') return;
    const t1 = setTimeout(() => setDevicesJoined(2), 8000);
    const t2 = setTimeout(() => setDevicesJoined(3), 16000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [step]);

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

  const runAI = async (items) => {
    // re-entry guard: prevents duplicate uploads/jobs from a double-tap
    if (aiProcessing) return;

    const all = Array.isArray(items) ? items : [{ front: items, back: backPhoto }];
    if (!all.length || !all[0].front) return;

    setAiProcessing(true);
    try {
      // ── Upload photos → create products → queue AI jobs (or save drafts
      //    when credits can't fund the pass). The server decides, atomically. ──
      const res = onShootComplete
        ? await onShootComplete(all)
        : { status: 'error' };
      setStep(res.status === 'success' ? 'success' : 'draftSaved');
    } catch (err) {
      console.error('[ai] photoshoot failed:', err);
      setStep('tutorial');
    } finally {
      setAiProcessing(false);
    }
  };

  const commitBatchFront = () => {
    if (!currentBatchFront) return;
    setBatchItems(prev => [...prev, { front: currentBatchFront, back: null }]);
    setCurrentBatchFront(null);
    setBatchSide('front');
  };

  /* Save ALL captured items (the server stores drafts when credits are low) */
  const saveBatchAsDrafts = () => {
    const all = currentBatchFront
      ? [...batchItems, { front: currentBatchFront, back: null }]
      : batchItems;
    runAI(all);
  };

  const isCameraStep = step === 'singleCamera' || step === 'batchCamera';

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

  /* ── AI overlay ─────────────────────────────────────────────────────────── */
  if (aiProcessing) {
    const src = frontPhoto || batchItems[0]?.front || '/assets/tshirt.png';
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
                  <img src="/assets/tshirt.png" alt="flatlay" className="af-vis-step-img" style={{ opacity:.85 }}/>
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
                  <img src="/assets/model_female.png" alt="result" className="af-vis-step-img"/>
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
            <h2 className="af-section-title">How many products?</h2>
            <p className="af-hint-text" style={{ textAlign:'left', marginTop:-8 }}>Pick a mode to get started</p>
            <div className="af-mode-card af-mode-featured" onClick={() => { setSide('front'); setFrontPhoto(null); setBackPhoto(null); setStep('singleCamera'); }}>
              <div className="af-mode-img-thumb">
                <img src="/assets/tshirt.png" alt="single"/>
                <div className="af-mode-img-badge">1 item</div>
              </div>
              <div>
                <div className="af-mode-title">One Product</div>
                <div className="af-mode-sub">Photograph front side, optional back side.</div>
              </div>
            </div>
            <div className="af-mode-card" onClick={() => setStep('batchIntro')}>
              <div className="af-mode-img-thumb af-mode-img-thumb-batch">
                <img src="/assets/tshirt.png" alt="b1" style={{ transform:'rotate(-8deg) translateX(-6px)' }}/>
                <img src="/assets/sneaker.png" alt="b2" style={{ transform:'rotate(6deg) translateX(6px)', marginTop:-20 }}/>
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
                      onClick={() => frontPhoto && runAI(frontPhoto)}>
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
            <div className="af-qr-block">
              <svg viewBox="0 0 110 110" width="130" height="130" className="af-qr-svg">
                <rect x="5" y="5" width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="4"/>
                <rect x="12" y="12" width="18" height="18" rx="1.5" fill="currentColor"/>
                <rect x="73" y="5" width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="4"/>
                <rect x="80" y="12" width="18" height="18" rx="1.5" fill="currentColor"/>
                <rect x="5" y="73" width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="4"/>
                <rect x="12" y="80" width="18" height="18" rx="1.5" fill="currentColor"/>
                {[42,52,62,72,82,92].map(x=>[42,52,62,72,82,92].map(y=>{const s=(x<44&&y<44)||(x>70&&y<44)||(x<44&&y>70);const sh=!s&&((x+y)%17<10);return sh?<rect key={`${x}${y}`} x={x} y={y} width="8" height="8" rx="1.5" fill="currentColor"/>:null;}))}
              </svg>
              <p style={{ fontSize:'.72rem', opacity:.6 }}>Scan to join on another device</p>
            </div>
            <button className="af-cta" onClick={() => { setBatchItems([]); setCurrentBatchFront(null); setBatchSide('front'); setStep('batchCamera'); }}>
              Start Session →
            </button>
          </div>
        )}

        {/* ── BATCH CAMERA ── */}
        {step === 'batchCamera' && (
          <div className="af-cam-screen">
            <div className="af-cam-header">
              <button className="af-cam-x" onClick={() => setStep('batchIntro')}><ChevronLeft size={17} color="#fff"/></button>
              <span className="af-cam-title">● LIVE · {devicesJoined} device{devicesJoined !== 1 ? 's' : ''}</span>
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
                  setBatchItems(prev => [...prev, { front: currentBatchFront, back: dataUrl }]);
                  setCurrentBatchFront(null); setBatchSide('front');
                }
              }}
            />

            {/* Captured strip */}
            {batchItems.length > 0 && (
              <div className="af-captured-strip">
                <span className="af-captured-strip-label">This device · {batchItems.length} product{batchItems.length !== 1 ? 's' : ''}</span>
                <div className="af-captured-strip-scroll">
                  {batchItems.map((item, i) => <CapturedCard key={i} item={item} index={i}/>)}
                </div>
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

              <button className="af-ctrl af-ctrl-qr" onClick={() => setStep('batchIntro')}>
                <QrCode size={18} color="#fff"/>
              </button>

              <button className="af-ctrl af-ctrl-confirm"
                      style={{ opacity: batchItems.length > 0 ? 1 : 0.3 }}
                      onClick={() => {
                        const all = currentBatchFront ? [...batchItems, { front: currentBatchFront, back: null }] : batchItems;
                        if (all.length === 0) return;
                        // The server decides: funds the AI pass or saves drafts
                        saveBatchAsDrafts();
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
                <img src={frontPhoto || batchItems[0]?.front || '/assets/tshirt.png'} alt="original"/>
                <span>Your photo</span>
              </div>
              <div className="af-success-arrow">✦</div>
              <div className="af-success-compare-box af-success-compare-box-result">
                <img src="/assets/model_female.png" alt="AI result"/>
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
    </div>
  );
}
