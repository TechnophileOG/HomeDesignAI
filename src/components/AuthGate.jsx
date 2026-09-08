import React, { useState, useRef, useEffect } from 'react';
import { Lock, User as UserIcon, ArrowRight, XCircle, MailCheck, KeyRound, RotateCcw } from 'lucide-react';
import { auth } from '../api/auth';
import KatalogitLogo from './KatalogitLogo';

/* ════════════════════════════════════════════════════════════════════════════
   AuthGate — the app requires a valid session to render.
   Flows:
     • signin / signup (Firebase Auth — passwords never touch our servers)
     • forgot-password → reset link by email (generic reply, no enumeration)
     • verify-email step: new email/password accounts must verify before they
       can onboard (the backend also 403s VERIFY_EMAIL on store creation).
     • Continue with Google (accounts are verified by default).
   ════════════════════════════════════════════════════════════════════════════ */
export default function AuthGate({ onAuthed, initialVerifyEmail = '' }) {
  const [mode, setMode]     = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [error, setError]   = useState('');
  const [info, setInfo]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [fields, setFields] = useState({});
  // forgot-password anti-spam: 60s cooldown + hard cap per session
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const forgotSendsRef = useRef(0);
  // verify step — shown until the user's email is verified
  const [verifyEmail, setVerifyEmail] = useState(initialVerifyEmail);
  const [resendSent, setResendSent]   = useState(!!initialVerifyEmail);
  const [checking, setChecking]       = useState(false);
  const pollRef = useRef(null);

  // Auto-recheck verification every 3s after signup (link opened in another
  // tab/device → the app unlocks itself once verified).
  const startVerificationPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await auth.refreshVerified();
      if (res.ok && res.verified && res.session) {
        if (pollRef.current) clearInterval(pollRef.current);
        onAuthed(res.session);
      }
    }, 3000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Google sign-in runs in REDIRECT mode — when the browser returns from
  // accounts.google.com, complete the sign-in here. (Popup mode hung after
  // the OAuth dance on real browsers and dumped users back to the login card.)
  useEffect(() => {
    let mounted = true;
    auth.completeGoogleRedirect().then((res) => {
      if (!mounted || !res.handled) return;
      if (res.ok) onAuthed(res.session); // Google accounts are pre-verified
      else if (res.error) setError(res.error);
    });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entered already signed-in but unverified (e.g. signed up on the website).
  useEffect(() => {
    if (initialVerifyEmail) startVerificationPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => {
    setFields((f) => ({ ...f, [k]: e.target.value }));
    if (error) setError('');
    if (info) setInfo('');
  };

  const switchMode = (m) => { setMode(m); setError(''); setInfo(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    if (mode === 'forgot') {
      const res = await auth.sendPasswordReset(fields.email);
      setBusy(false);
      if (res.ok) {
        forgotSendsRef.current += 1;
        setInfo(res.error || 'If an account exists for that email, a reset link is on its way.');
        // Button cooldown — one reset email per minute, max 3 per session.
        setForgotCooldown(60);
        const id = setInterval(() => {
          setForgotCooldown((s) => {
            if (s <= 1) { clearInterval(id); return 0; }
            return s - 1;
          });
        }, 1000);
      } else {
        setError(res.error);
      }
      return;
    }
    const res = mode === 'signin'
      ? await auth.signIn({ email: fields.email, password: fields.password })
      : await auth.register({
          name: fields.name, email: fields.email, password: fields.password,
        });
    setBusy(false);
    if (res.ok) {
      if (!res.session.emailVerified) {
        // New email/password account → verification required before entering.
        setVerifyEmail(res.session.email);
        setResendSent(true);
        startVerificationPoll();
      } else {
        onAuthed(res.session);
      }
    } else {
      setError(res.error);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    setError('');
    const res = await auth.signInWithGoogle();
    if (res.redirect) return; // page is navigating to Google — nothing else to do
    setBusy(false);
    if (res.ok) onAuthed(res.session); // Google accounts are pre-verified
    else if (res.error) setError(res.error);
  };

  const handleResend = async () => {
    setBusy(true);
    const res = await auth.sendVerification();
    setBusy(false);
    setResendSent(true);
    setError(res.ok ? '' : res.error);
  };

  const handleCheckVerified = async () => {
    setChecking(true);
    const res = await auth.refreshVerified();
    setChecking(false);
    if (res.ok && res.verified && res.session) onAuthed(res.session);
    else setError('Not verified yet — check your inbox (and spam folder), then try again.');
  };

  const handleVerifySignOut = async () => {
    await auth.signOut();
    if (pollRef.current) clearInterval(pollRef.current);
    setVerifyEmail('');
    setResendSent(false);
    switchMode('signin');
  };

  /* ── verify-email step ─────────────────────────────────────────────────── */
  if (verifyEmail) {
    return (
      <div className="ag-wrap">
        <div className="ag-card">
          <div className="ag-brand">
            <KatalogitLogo tone="dark" />
          </div>
          <div className="ag-verify-icon"><MailCheck size={26} /></div>
          <h2 className="ag-title">Verify your email</h2>
          <p className="ag-sub" style={{ textAlign: 'center', lineHeight: 1.5 }}>
            We sent a verification link to <strong>{verifyEmail}</strong>.<br />
            Open it to activate your account — this also protects your store from fraud.
          </p>
          {resendSent && <p className="ag-info">📬 Verification email sent. Check your inbox & spam.</p>}
          {error && (
            <div className="ag-error" role="alert"><XCircle size={13} /> {error}</div>
          )}
          <button className="ag-submit" type="button" onClick={handleCheckVerified} disabled={busy || checking}>
            {checking ? <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Checking…</> : <>I've verified — continue <ArrowRight size={15} /></>}
          </button>
          <button className="ag-ghost" type="button" onClick={handleResend} disabled={busy}>
            <RotateCcw size={13} /> Resend verification email
          </button>
          <button className="ag-link" type="button" onClick={handleVerifySignOut}>
            Use a different account
          </button>
        </div>
      </div>
    );
  }

  const input = (key, label, type, placeholder, autoComplete) => (
    <label className="ag-field" key={key}>
      <span className="ag-label">{label}</span>
      <input
        className="ag-input"
        type={type}
        placeholder={placeholder}
        value={fields[key] || ''}
        onChange={set(key)}
        autoComplete={autoComplete}
        required
        maxLength={120}
      />
    </label>
  );

  return (
    <div className="ag-wrap">
      <div className="ag-card">
        <div className="ag-brand">
          <KatalogitLogo tone="dark" />
        </div>

        {mode === 'forgot' ? (
          <>
            <div className="ag-verify-icon"><KeyRound size={24} /></div>
            <h2 className="ag-title">Reset your password</h2>
            <p className="ag-sub">
              Enter the email on your account and we'll send you a reset link.
            </p>
            <form className="ag-form" onSubmit={handleSubmit}>
              {input('email', 'Email', 'email', 'you@store.com', 'email')}
              {info && <div className="ag-info">{info}</div>}
              {error && (
                <div className="ag-error" role="alert"><XCircle size={13} /> {error}</div>
              )}
              <button
                className="ag-submit"
                type="submit"
                disabled={busy || forgotCooldown > 0 || forgotSendsRef.current >= 3}
              >
                {busy
                  ? <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Sending…</>
                  : forgotCooldown > 0
                    ? <>Resend available in {forgotCooldown}s</>
                    : forgotSendsRef.current >= 3
                      ? 'Limit reached — try again later'
                      : <>Send reset link <ArrowRight size={15} /></>}
              </button>
            </form>
            <button className="ag-link" type="button" onClick={() => switchMode('signin')}>
              ← Back to sign in
            </button>
          </>
        ) : (
          <>
            <h2 className="ag-title">
              {mode === 'signin' ? 'Welcome back' : 'Create your store account'}
            </h2>
            <p className="ag-sub">
              {mode === 'signin'
                ? 'Sign in to your dashboard.'
                : 'Set up your account to start cataloguing.'}
            </p>

            <div className="ag-tabs">
              <button
                type="button"
                className={`ag-tab${mode === 'signin' ? ' active' : ''}`}
                onClick={() => switchMode('signin')}
              >
                <Lock size={13} /> Sign In
              </button>
              <button
                type="button"
                className={`ag-tab${mode === 'signup' ? ' active' : ''}`}
                onClick={() => switchMode('signup')}
              >
                <UserIcon size={13} /> Create Account
              </button>
            </div>

            <form className="ag-form" onSubmit={handleSubmit}>
              {mode === 'signup' && input('name', 'Your Name', 'text', 'Your full name', 'name')}
              {input('email', 'Email', 'email', 'you@store.com', 'email')}
              {input('password', 'Password', 'password', '••••••••', mode === 'signin' ? 'current-password' : 'new-password')}
              {mode === 'signup' && (
                <p className="ag-hint" style={{ lineHeight: 1.5 }}>
                  8+ characters with letters &amp; numbers.
                </p>
              )}

              {info && <div className="ag-info">{info}</div>}
              {error && (
                <div className="ag-error" role="alert"><XCircle size={13} /> {error}</div>
              )}

              <button className="ag-submit" type="submit" disabled={busy}>
                {busy
                  ? <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Checking…</>
                  : <>{mode === 'signin' ? 'Sign In' : 'Create Account'} <ArrowRight size={15} /></>}
              </button>
            </form>

            {mode === 'signin' && (
              <button className="ag-link" type="button" onClick={() => switchMode('forgot')} style={{ marginTop: 10 }}>
                Forgot password?
              </button>
            )}

            <div className="ag-divider"><span>or</span></div>

            <button
              type="button"
              className="ag-google"
              onClick={handleGoogle}
              disabled={busy}
            >
              <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Continue with Google
            </button>
          </>
        )}
      </div>
    </div>
  );
}
