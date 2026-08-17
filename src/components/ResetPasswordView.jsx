import React, { useState } from 'react';
import { KeyRound, CheckCircle2, XCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { fbAuth } from '../api/firebase';
import KatalogitLogo from './KatalogitLogo';

/* ════════════════════════════════════════════════════════════════════════
   ResetPasswordView — the branded "webpage" side of the reset email.
   Handles Firebase's `mode=resetPassword&oobCode=…` action links: shows a
   store-branded set-new-password screen instead of Firebase's default page.
   (Works once the Firebase console action URL points at the app — see the
   run doc. Until then Firebase shows its own page; this component still
   handles the link when it arrives.)
   ════════════════════════════════════════════════════════════════════════ */

const PASSWORD_OK = (pw) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

export default function ResetPasswordView({ oobCode, onDone }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState('form'); // form | verifying | done

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!PASSWORD_OK(pw)) {
      setError('Password needs 8+ characters with letters and numbers.');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Verify the one-time code first — gives us a clean "expired/invalid"
      // message and never lets a bad code reach confirmPasswordReset. (The
      // SDK already knows the project from the Firebase config; the apiKey
      // query param from the email link is not needed here.)
      await verifyPasswordResetCode(fbAuth, oobCode);
      await confirmPasswordReset(fbAuth, oobCode, pw);
      setState('done');
    } catch (err) {
      const c = err?.code || '';
      if (c === 'auth/expired-action-code') setError('This reset link has expired. Request a new one.');
      else if (c === 'auth/invalid-action-code') setError('This reset link is invalid. Request a new one.');
      else if (c === 'auth/weak-password') setError('Password is too weak — use 8+ characters with letters and numbers.');
      else if (c === 'auth/too-many-requests') setError('Too many attempts. Wait a few minutes and try again.');
      else setError('Something went wrong. Please request a new reset link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ag-wrap">
      <div className="ag-card">
        <div className="ag-brand">
          <KatalogitLogo tone="dark" />
        </div>

        {state === 'done' ? (
          <>
            <div className="ag-verify-icon" style={{ color: 'var(--c-accent)' }}><CheckCircle2 size={26} /></div>
            <h2 className="ag-title">Password updated</h2>
            <p className="ag-sub" style={{ textAlign: 'center', lineHeight: 1.5 }}>
              Your password has been reset successfully.<br />
              Sign in with your new password to continue.
            </p>
            <button className="ag-submit" type="button" onClick={onDone}>
              Continue to sign in <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <>
            <div className="ag-verify-icon"><KeyRound size={24} /></div>
            <h2 className="ag-title">Set a new password</h2>
            <p className="ag-sub">
              Choose a strong password for your KatalogitAI account.
            </p>
            <form className="ag-form" onSubmit={handleSubmit}>
              <label className="ag-field">
                <span className="ag-label">New password</span>
                <input
                  className="ag-input"
                  type="password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); if (error) setError(''); }}
                  placeholder="8+ chars, letters & numbers"
                  autoComplete="new-password"
                  maxLength={120}
                  required
                />
              </label>
              <label className="ag-field">
                <span className="ag-label">Confirm new password</span>
                <input
                  className="ag-input"
                  type="password"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); if (error) setError(''); }}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  maxLength={120}
                  required
                />
              </label>
              <p className="ag-hint"><ShieldCheck size={12} /> 8+ characters with letters &amp; numbers.</p>
              {error && (
                <div className="ag-error" role="alert"><XCircle size={13} /> {error}</div>
              )}
              <button className="ag-submit" type="submit" disabled={busy}>
                {busy
                  ? <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Updating…</>
                  : <>Update password <ArrowRight size={15} /></>}
              </button>
            </form>
            <button className="ag-link" type="button" onClick={onDone}>
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
