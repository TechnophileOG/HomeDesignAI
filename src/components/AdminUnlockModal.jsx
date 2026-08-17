import React, { useState } from 'react';
import { X, ShieldCheck, Lock, Eye, EyeOff } from 'lucide-react';
import { api } from '../api/client';

/* ── Owner Console unlock screen ───────────────────────────────────────────
   The console is locked until the owner proves they know the admin
   passcode. The passcode is verified SERVER-SIDE (timing-safe, rate-limited,
   5 tries / 15 min) — this form just captures it and shows the outcome.
   Success issues a short-lived signed session; every /admin/* call after
   that is re-verified by the server. */
export default function AdminUnlockModal({ onUnlocked, onClose }) {
  const [passcode, setPasscode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !passcode.trim()) { setError('Enter the owner passcode.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.adminUnlock(passcode.trim());
      setPasscode('');
      onUnlocked();
    } catch (err) {
      console.error('[admin] unlock failed:', err);
      if (err?.status === 403) setError('Wrong passcode. Try again.');
      else if (err?.status === 429) setError('Too many attempts — wait a few minutes and try again.');
      else setError(err?.message || 'Could not unlock. Try again.');
      setPasscode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content kv-modal kv-modal-sm" onClick={(e) => e.stopPropagation()}>
        <button className="kv-modal-close" onClick={onClose}><X size={18} /></button>
        <div className="kv-modal-title-row">
          <div className="kv-modal-icon admin"><ShieldCheck size={20} /></div>
          <div>
            <h3 className="kv-modal-title">Owner Console</h3>
            <p className="kv-modal-sub">This area is locked — only the account owner can open it.</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <label className="kv-field-label">Admin passcode</label>
          <div style={{ position: 'relative' }}>
            <input
              className="kv-input"
              type={show ? 'text' : 'password'}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.slice(0, 256))}
              placeholder="••••••••"
              autoFocus
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}
              aria-label={show ? 'Hide passcode' : 'Show passcode'}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <p className="kv-modal-footnote" style={{ color: '#c0392b' }}>{error}</p>}

          <button className="kv-btn kv-btn-primary kv-btn-lg" type="submit" disabled={busy} style={{ marginTop: 14 }}>
            {busy ? <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Unlocking…</> : <><Lock size={14} /> Unlock console</>}
          </button>
        </form>
        <p className="kv-modal-footnote">
          Wrong attempts are rate-limited and logged. The session expires automatically.
        </p>
      </div>
    </div>
  );
}
