import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, ChevronLeft, RotateCcw, ArrowRight, RefreshCw, QrCode, Check } from 'lucide-react';

/* ── reuse same live-camera hook logic inline ──────────────────────────── */
function useLiveCamera(active) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [ready,  setReady]  = useState(false);
  const [denied, setDenied] = useState(false);
  const [facing, setFacing] = useState('environment');

  const start = useCallback(async (f = 'environment') => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setReady(false); setDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: f }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () =>
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true));
      }
    } catch { setDenied(true); }
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setReady(false);
  }, []);

  const flip = useCallback(() => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next); start(next);
  }, [facing, start]);

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !ready) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
    c.getContext('2d').drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }, [ready]);

  useEffect(() => { if (active) start(facing); else stop(); return stop; }, [active]); // eslint-disable-line

  return { videoRef, ready, denied, flip, capture, restart: () => start(facing) };
}

/* ── Product card for retake queue ────────────────────────────────────── */
function RetakeCard({ product, selected, onSelect }) {
  return (
    <button
      className={`rts-product-card${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <div className="rts-product-card-img">
        <img src={product.image} alt={product.title}/>
        {selected && <div className="rts-product-card-selected-overlay"><Check size={18} color="#fff" strokeWidth={3}/></div>}
      </div>
      <p className="rts-product-card-title">{product.title}</p>
      <p className="rts-product-card-cat">{product.category}</p>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function RetakeSession({ retakeQueue, onClose, onRetakeDone }) {
  const [screen, setScreen]             = useState('queue');   // queue | camera
  const [selectedProduct, setSelected] = useState(null);
  const [capturedPhoto, setCaptured]    = useState(null);
  const [flash, setFlash]               = useState(false);
  const [showQR, setShowQR]             = useState(false);

  const camActive = screen === 'camera' && !capturedPhoto;
  const { videoRef, ready, denied, flip, capture } = useLiveCamera(camActive);

  const handleShutter = () => {
    const dataUrl = capture();
    if (dataUrl) { setFlash(true); setTimeout(() => setFlash(false), 350); setCaptured(dataUrl); }
  };

  const handleConfirm = () => {
    if (selectedProduct && capturedPhoto) {
      onRetakeDone(selectedProduct.id, capturedPhoto);
    }
  };

  return (
    <div className="modal-overlay" onClick={screen === 'camera' ? undefined : onClose}>
      <div
        className={`modal-content af-modal${screen === 'camera' ? ' af-modal-dark' : ''}`}
        onClick={e => e.stopPropagation()}
        style={{ width: screen === 'camera' ? 'min(500px,96vw)' : 'min(560px,96vw)' }}
      >

        {/* ── QUEUE SCREEN ── */}
        {screen === 'queue' && (
          <div className="af-sw" style={{ paddingTop: 36 }}>
            <button className="af-close" onClick={onClose}><X size={18}/></button>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h2 className="af-section-title">Retake Session</h2>
              <button className="rts-qr-btn" onClick={() => setShowQR(v => !v)}>
                <QrCode size={16}/> {showQR ? 'Hide QR' : 'Add Phone'}
              </button>
            </div>

            <p className="af-hint-text" style={{ textAlign:'left', marginTop:-8 }}>
              Select a product below, then shoot a fresh photo.
            </p>

            {/* QR panel */}
            {showQR && (
              <div className="af-qr-block" style={{ padding:'16px 12px' }}>
                <svg viewBox="0 0 110 110" width="120" height="120" className="af-qr-svg">
                  <rect x="5"  y="5"  width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="4"/>
                  <rect x="12" y="12" width="18" height="18" rx="1.5" fill="currentColor"/>
                  <rect x="73" y="5"  width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="4"/>
                  <rect x="80" y="12" width="18" height="18" rx="1.5" fill="currentColor"/>
                  <rect x="5"  y="73" width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="4"/>
                  <rect x="12" y="80" width="18" height="18" rx="1.5" fill="currentColor"/>
                  {[42,52,62,72,82,92].map(x=>[42,52,62,72,82,92].map(y=>{
                    const s=(x<44&&y<44)||(x>70&&y<44)||(x<44&&y>70);
                    return (!s&&(x+y)%17<10)?<rect key={`${x}${y}`} x={x} y={y} width="8" height="8" rx="1.5" fill="currentColor"/>:null;
                  }))}
                </svg>
                <p style={{ fontSize:'.7rem', opacity:.6, marginTop:0 }}>Scan to join retake session</p>
              </div>
            )}

            {/* Product cards */}
            {retakeQueue.length === 0 ? (
              <div className="rc-empty">
                <RotateCcw size={32} strokeWidth={1.4} color="var(--c-peach-mid)"/>
                <p>No products in retake queue</p>
              </div>
            ) : (
              <div className="rts-product-grid">
                {retakeQueue.map(p => (
                  <RetakeCard
                    key={p.id}
                    product={p}
                    selected={selectedProduct?.id === p.id}
                    onSelect={() => setSelected(prev => prev?.id === p.id ? null : p)}
                  />
                ))}
              </div>
            )}

            <button
              className="af-cta"
              disabled={!selectedProduct}
              style={{ opacity: selectedProduct ? 1 : 0.35 }}
              onClick={() => { setCaptured(null); setScreen('camera'); }}
            >
              Shoot Selected Product →
            </button>
          </div>
        )}

        {/* ── CAMERA SCREEN ── */}
        {screen === 'camera' && (
          <div className="af-cam-screen">
            <div className="af-cam-header">
              <button className="af-cam-x" onClick={() => { setCaptured(null); setScreen('queue'); }}>
                <ChevronLeft size={17} color="#fff"/>
              </button>
              <span className="af-cam-title">
                {selectedProduct ? selectedProduct.title.slice(0, 22) : 'RETAKE'}
              </span>
              <button className="af-cam-x" onClick={onClose}><X size={17} color="#fff"/></button>
            </div>

            {/* Selected product reference strip */}
            {selectedProduct && (
              <div className="rts-ref-strip">
                <img src={selectedProduct.image} alt="original" className="rts-ref-img"/>
                <div>
                  <p className="rts-ref-label">Original photo</p>
                  <p className="rts-ref-title">{selectedProduct.title}</p>
                </div>
                <span className="rts-ref-arrow">→</span>
                <div className="rts-ref-new">
                  {capturedPhoto
                    ? <img src={capturedPhoto} alt="new" className="rts-ref-img"/>
                    : <div className="rts-ref-placeholder"><span>New</span></div>
                  }
                </div>
              </div>
            )}

            {/* Viewfinder */}
            <div
              className="af-cam-view"
              style={{ cursor: capturedPhoto ? 'default' : 'pointer' }}
              onClick={!capturedPhoto ? handleShutter : undefined}
            >
              <video
                ref={videoRef}
                playsInline muted autoPlay
                style={{ width:'100%', height:'100%', objectFit:'cover', display: capturedPhoto ? 'none' : 'block' }}
              />
              {capturedPhoto && <img src={capturedPhoto} alt="captured" className="af-cam-img"/>}

              {!capturedPhoto && (
                <div className="af-cam-overlay-guides">
                  <div className="af-cam-frame-guide">
                    <div className="af-cam-corner tl"/><div className="af-cam-corner tr"/>
                    <div className="af-cam-corner bl"/><div className="af-cam-corner br"/>
                  </div>
                  <span className="af-cam-hint">
                    {denied ? 'Camera blocked — check browser settings' : ready ? 'Tap to capture' : 'Starting camera…'}
                  </span>
                </div>
              )}
              {flash && <div className="af-flash"/>}

              {/* Flip button */}
              {!capturedPhoto && ready && (
                <button className="af-cam-flip-btn" onClick={e => { e.stopPropagation(); flip(); }}>
                  <RefreshCw size={16} color="#fff"/>
                </button>
              )}
            </div>

            {/* Controls */}
            <div className="af-cam-bar">
              {capturedPhoto ? (
                <button className="af-ctrl af-ctrl-retake" onClick={() => setCaptured(null)}>
                  <RotateCcw size={18} color="#fff"/>
                </button>
              ) : <div style={{ width:50 }}/>}

              <button
                className="af-shutter"
                onClick={handleShutter}
                disabled={!!capturedPhoto}
                style={{ opacity: capturedPhoto ? 0.3 : 1 }}
              >
                <div className="af-shutter-inner"/>
              </button>

              <button
                className="af-ctrl af-ctrl-confirm"
                style={{ opacity: capturedPhoto ? 1 : 0.3 }}
                onClick={() => capturedPhoto && handleConfirm()}
              >
                <ArrowRight size={20} color="#fff"/>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
