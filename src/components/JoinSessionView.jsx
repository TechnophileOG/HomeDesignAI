/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — JoinSessionView (scanning phone, NO account needed)
   ────────────────────────────────────────────────────────────────────────
   The QR code from the owner's live session points here. The single-use
   join token in the URL is exchanged (once) for a per-DEVICE token, then
   this page captures photos and uploads them to the session — the owner
   sees every capture live in the session QR overlay.
   ════════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useRef } from 'react';
import { Check, Smartphone, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { api, dataUrlToBlob } from '../api/client';
import KatalogitLogo from './KatalogitLogo';

// 10MB cap — complex fabrics need the room; matches the server's limit.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const NAME_KEY = 'kat_join_name_v1';

function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [facing, setFacing] = useState('environment');

  const start = async (facingMode) => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    setReady(false);
    setDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true));
        };
      }
    } catch {
      setDenied(true);
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !ready) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    c.getContext('2d').drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.85);
  };

  useEffect(() => {
    start(facing);
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, ready, denied, capture, flip: () => { setFacing(f => (f === 'environment' ? 'user' : 'environment')); start(facing === 'environment' ? 'user' : 'environment'); } };
}

export default function JoinSessionView({ sessionId, token, onReset }) {
  const [phase, setPhase] = useState('connecting'); // connecting | joined | error
  const [error, setError] = useState('');
  const [storeName, setStoreName] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } });
  const [sentCount, setSentCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState(false);
  const [photo, setPhoto] = useState(null);
  const { videoRef, ready, denied, capture, flip } = useCamera();

  // One-time join exchange — runs exactly once per mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.joinSession(sessionId, token, name || 'Phone');
        if (!alive) return;
        setStoreName(res.storeName || 'Store');
        setDeviceToken(res.deviceToken);
        setPhase('joined');
      } catch (err) {
        if (!alive) return;
        setError(err?.message || 'Could not join this session.');
        setPhase('error');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  const saveName = () => {
    const clean = String(name || '').replace(/<[^>]*>/g, '').trim().slice(0, 40);
    try { localStorage.setItem(NAME_KEY, clean); } catch { /* noop */ }
  };

  // Stage (get a signed GCS URL) → upload the bytes straight to GCS →
  // confirm. Photos up to 10MB; Firestore never sees the bytes.
  const sendPhoto = async (dataUrl, index) => {
    if (!deviceToken || uploading) return;
    const blob = dataUrlToBlob(dataUrl);
    if (blob.size > MAX_PHOTO_BYTES) {
      setError('Photo is larger than 10MB — capture a slightly smaller frame and try again.');
      return;
    }
    const mime = blob.type || 'image/jpeg';
    setUploading(true);
    setPhoto(dataUrl);
    setFlash(true);
    setTimeout(() => setFlash(false), 350);
    try {
      const { photoId, uploadUrl } = await api.sessionPhotoStart(sessionId, deviceToken, {
        mime, size: blob.size, index,
      });
      await api.putBytes(uploadUrl, blob, mime);
      await api.sessionPhotoConfirm(sessionId, deviceToken, photoId, { mime, size: blob.size, index });
      setSentCount((c) => c + 1);
      setTimeout(() => setPhoto(null), 900);
    } catch (err) {
      setError(err?.message || 'Photo could not be sent — try again.');
      setPhoto(null);
    } finally {
      setUploading(false);
    }
  };

  /* ── connecting / error ─────────────────────────────────────────────── */
  if (phase !== 'joined') {
    return (
      <div className="js-wrap">
        <div className="js-card">
          <KatalogitLogo className="kat-logo-auth" />
          {phase === 'connecting' ? (
            <>
              <div className="ai-spinner" style={{ margin: '0 auto' }} />
              <p className="js-sub">Connecting you to the live session…</p>
            </>
          ) : (
            <>
              <div className="js-error-icon"><AlertTriangle size={26} /></div>
              <h3 className="js-title">Can't join this session</h3>
              <p className="js-sub">{error}</p>
              <button className="js-btn" onClick={onReset}>Scan a fresh QR code</button>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── joined: capture + upload ───────────────────────────────────────── */
  return (
    <div className="js-wrap">
      <div className="js-card js-card-cam">
        <div className="js-head">
          <div>
            <span className="js-store-badge"><Smartphone size={12} /> Connected</span>
            <h3 className="js-title">{storeName}</h3>
            <p className="js-sub">
              {sentCount === 0 ? 'Tap to capture your product' : `${sentCount} photo${sentCount !== 1 ? 's' : ''} sent to the owner ✓`}
            </p>
          </div>
          <button className="js-mini" onClick={onReset} aria-label="Leave session"><X size={15} /></button>
        </div>

        <div className="js-name-row">
          <input
            className="js-name-input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            onBlur={saveName}
            placeholder="Your name (shown to the owner)"
            maxLength={40}
          />
        </div>

        <div className="js-cam" style={{ cursor: uploading ? 'default' : 'pointer' }} onClick={uploading ? undefined : () => { const d = capture(); if (d) sendPhoto(d, sentCount); }}>
          <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', display: photo ? 'none' : 'block' }} />
          {photo && <img src={photo} alt="captured" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {!photo && ready && <span className="js-cam-hint">Tap anywhere to capture</span>}
          {denied && (
            <div className="js-denied">
              <p>Camera access needed</p>
              <button className="js-btn" onClick={() => window.location.reload()}>Allow camera</button>
            </div>
          )}
          {flash && <div className="af-flash" />}
          {!photo && ready && (
            <button className="js-flip" onClick={(e) => { e.stopPropagation(); flip(); }}>
              <RefreshCw size={15} color="#fff" />
            </button>
          )}
        </div>

        {error && <p className="js-error-line">{error}</p>}
        <div className="js-foot">
          <Check size={13} /> Photos go straight to the owner's live session
        </div>
      </div>
    </div>
  );
}
