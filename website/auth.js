/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — Website Auth (Firebase Auth)
   ────────────────────────────────────────────────────────────────────────────
   The landing page now signs accounts up against REAL Firebase Auth (the same
   project the app uses), so an account created here works in the dashboard on
   the same origin — no more on-device user store.

     • Passwords NEVER touch our servers — Firebase SDK talks to Google's
       Identity Platform over TLS.
     • The Firebase session persists on this origin, so /app recognizes the
       user automatically (it verifies with the same project).
     • Client-side validation + failed-attempt lockout still apply.
   ════════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Firebase init (public config — keys are not secrets) ─────────────────── */
var firebaseConfig = {
  apiKey: 'AIzaSyALahslGJhigEPOcDe3Vtuc_zVzCZnxN6w',
  authDomain: 'katalogitai-501916.firebaseapp.com',
  projectId: 'katalogitai-501916',
  storageBucket: 'katalogitai-501916.appspot.com',
  messagingSenderId: '787935596465',
};
firebase.initializeApp(firebaseConfig);
var fbAuth = firebase.auth();

/* ── Storage keys (session cache shared with the React app) ───────────────── */
var AUTH_KEYS = {
  attempts: 'kat_auth_attempts_v1',
  session: 'kat_auth_v1',
};

var MAX_ATTEMPTS = 5;
var LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/* ── Tiny helpers ─────────────────────────────────────────────────────────── */
function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* noop */ }
}

function cleanControl(s) {
  var out = '';
  for (var i = 0; i < String(s ?? '').length; i++) {
    var c = String(s).codePointAt(i);
    if ((c >= 0 && c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127) out += ' ';
    else if (c === 0x200B || c === 0x200C || c === 0x200D || c === 0x2060 || c === 0xFEFF) out += '';
    else if (c >= 0x202A && c <= 0x202E) out += '';
    else out += String(s)[i];
  }
  return out;
}

function sanitizeText(raw, maxLen) {
  maxLen = maxLen || 120;
  return cleanControl(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}
function sanitizeEmail(raw) {
  var e = String(raw ?? '').trim().toLowerCase().slice(0, 120);
  return /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e) ? e : '';
}
function sanitizePhone(raw) {
  return String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 12);
}
function sanitizeName(raw) {
  return sanitizeText(raw, 60).replace(/[^a-zA-Z0-9\s.,'&()/-]/g, '');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ── Firebase error → friendly message ────────────────────────────────────── */
function friendly(err) {
  var c = (err && err.code) || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found') {
    return 'Invalid email or password.';
  }
  if (c === 'auth/email-already-in-use') return 'An account with this email already exists. Sign in instead.';
  if (c === 'auth/invalid-email') return 'Enter a valid email address.';
  if (c === 'auth/weak-password') return 'Password is too weak — use 8+ characters with letters and numbers.';
  if (c === 'auth/too-many-requests') return 'Too many attempts. Try again in a few minutes.';
  if (c === 'auth/network-request-failed') return 'Network error — check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

function writeSession(u, name, phone) {
  writeJSON(AUTH_KEYS.session, {
    uid: u.uid,
    name: name || u.displayName || '',
    phone: phone || u.phoneNumber || '',
    email: (u.email || '').toLowerCase(),
    isAdmin: false, // decided server-side (ADMIN_EMAILS) in the app
    token: '',
    createdAt: new Date().toISOString(),
    expiresAt: '',
  });
}

/* ── Rate limiting (client-side tripwire; server enforces its own) ────────── */
function getLockout(email) {
  var attempts = readJSON(AUTH_KEYS.attempts, {});
  var rec = attempts[email];
  if (!rec) return { locked: false, remaining: MAX_ATTEMPTS };
  if (rec.lockUntil && Date.now() < rec.lockUntil) {
    return { locked: true, waitMs: rec.lockUntil - Date.now() };
  }
  return { locked: false, remaining: Math.max(0, MAX_ATTEMPTS - rec.failures) };
}
function recordFailure(email) {
  var attempts = readJSON(AUTH_KEYS.attempts, {});
  var rec = attempts[email] || { failures: 0, lockUntil: 0 };
  rec.failures = (rec.failures || 0) + 1;
  if (rec.failures >= MAX_ATTEMPTS) { rec.lockUntil = Date.now() + LOCKOUT_MS; rec.failures = 0; }
  attempts[email] = rec;
  writeJSON(AUTH_KEYS.attempts, attempts);
}
function clearFailures(email) {
  var attempts = readJSON(AUTH_KEYS.attempts, {});
  delete attempts[email];
  writeJSON(AUTH_KEYS.attempts, attempts);
}

/* ── Public auth API (interface unchanged) ────────────────────────────────── */
async function register(_args) {
  var args = _args || {};
  var clean = {
    name: sanitizeName(args.name),
    storeName: sanitizeName(args.storeName),
    phone: sanitizePhone(args.phone),
    email: sanitizeEmail(args.email),
  };
  var pw = String(args.password || '');

  if (clean.name.length < 2) return { ok: false, error: 'Enter your full name.' };
  if (clean.storeName.length < 2) return { ok: false, error: 'Enter your store name.' };
  if (clean.phone.length !== 10) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
  if (!clean.email) return { ok: false, error: 'Enter a valid email address.' };
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return { ok: false, error: 'Password needs 8+ characters with letters and numbers.' };
  }

  try {
    var cred = await fbAuth.createUserWithEmailAndPassword(clean.email, pw);
    try { await cred.user.updateProfile({ displayName: clean.name }); } catch (e) { /* non-fatal */ }
    // Verification is required before onboarding (server-enforced) — send it
    // immediately so the user can verify while they explore the dashboard.
    try { await cred.user.sendEmailVerification(); } catch (e) { /* resend available */ }
    writeSession(cred.user, clean.name, clean.phone);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendly(err) };
  }
}

async function signIn(_args) {
  var args = _args || {};
  var cleanEmail = sanitizeEmail(args.email);
  if (!cleanEmail) return { ok: false, error: 'Enter a valid email address.' };

  var lock = getLockout(cleanEmail);
  if (lock.locked) {
    var mins = Math.ceil(lock.waitMs / 60000);
    return { ok: false, error: 'Too many attempts. Try again in ' + mins + ' min.' };
  }

  try {
    var cred = await fbAuth.signInWithEmailAndPassword(cleanEmail, String(args.password || ''));
    clearFailures(cleanEmail);
    var u = cred.user;
    var session = {
      uid: u.uid,
      name: u.displayName || '',
      phone: u.phoneNumber || '',
      email: (u.email || '').toLowerCase(),
      isAdmin: false,
      token: '',
      createdAt: new Date().toISOString(),
      expiresAt: '',
    };
    writeJSON(AUTH_KEYS.session, session);
    return { ok: true, session: session };
  } catch (err) {
    recordFailure(cleanEmail);
    return { ok: false, error: friendly(err) };
  }
}

async function sendPasswordReset(email) {
  var cleanEmail = sanitizeEmail(email);
  if (!cleanEmail) return { ok: false, error: 'Enter a valid email address.' };
  try {
    await fbAuth.sendPasswordResetEmail(cleanEmail);
    // Generic reply either way — never reveal whether an account exists.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'If an account exists for that email, a reset link is on its way.' };
  }
}

async function sendVerification() {
  var u = fbAuth.currentUser;
  if (!u) return { ok: false, error: 'No active session.' };
  try {
    await u.sendEmailVerification();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not send the verification email. Try again in a few minutes.' };
  }
}

async function signInWithGoogle() {
  try {
    var cred = await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    writeSession(cred.user, cred.user.displayName || '', cred.user.phoneNumber || '');
    return { ok: true };
  } catch (err) {
    var c = (err && err.code) || '';
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') {
      return { ok: false, error: '' }; // user cancelled
    }
    return { ok: false, error: friendly(err) };
  }
}

function signOut() {
  try { fbAuth.signOut(); } catch (e) { /* already signed out */ }
  try { localStorage.removeItem(AUTH_KEYS.session); } catch (e) { /* noop */ }
}

/* ── Expose for the modal controller ──────────────────────────────────────── */
window.KatalogitAuth = {
  register: register,
  signIn: signIn,
  signInWithGoogle: signInWithGoogle,
  sendPasswordReset: sendPasswordReset,
  sendVerification: sendVerification,
  signOut: signOut,
  getSession: function () { return readJSON(AUTH_KEYS.session, null); },
  escapeHtml: escapeHtml,
};

/* ════════════════════════════════════════════════════════════════════════════
   Modal controller — sign in / sign up UI
   ════════════════════════════════════════════════════════════════════════════ */
(function initAuthModal() {
  var openBtns = document.querySelectorAll('[data-auth-open]');
  var modal = document.getElementById('authModal');
  if (!modal) return;

  var body = modal.querySelector('.auth-body');
  var closeBtn = modal.querySelector('.auth-close');
  var errBox = modal.querySelector('.auth-error');

  function showError(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.style.display = msg ? 'block' : 'none';
  }

  function switchTab(tab) {
    modal.querySelectorAll('.auth-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
    body.innerHTML = '';
    body.appendChild(tab === 'signin' ? signInForm() : signUpForm());
    showError('');
  }

  function field(label, type, id, placeholder, autocomplete, opts) {
    var wrap = document.createElement('div');
    wrap.className = 'auth-field';
    var lbl = document.createElement('label');
    lbl.className = 'auth-label';
    lbl.textContent = label;
    var input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'auth-input';
    input.placeholder = placeholder;
    input.autocomplete = autocomplete;
    if (type === 'password') input.minLength = 8;
    input.maxLength = 120;
    if (opts) input.setAttribute('pattern', opts);
    wrap.append(lbl, input);
    return wrap;
  }

  function signInForm() {
    var form = document.createElement('form');
    form.className = 'auth-form';
    form.noValidate = true;

    form.append(
      field('Email', 'email', 'authSigninEmail', 'you@store.com', 'email'),
      field('Password', 'password', 'authSigninPw', '••••••••', 'current-password')
    );

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary btn-large auth-submit';
    submit.textContent = 'Sign In →';

    var alt = document.createElement('p');
    alt.className = 'auth-switch';
    alt.innerHTML = 'New here? <button type="button" class="auth-link" data-tab="signup">Create a store account</button>';

    var forgot = document.createElement('button');
    forgot.type = 'button';
    forgot.className = 'auth-link';
    forgot.dataset.forgot = '1';
    forgot.textContent = 'Forgot password?';
    forgot.style.margin = '0 auto';

    // Google sign-in (provider enabled in the Firebase console)
    var divider = document.createElement('div');
    divider.className = 'auth-divider';
    divider.textContent = 'or';
    var googleBtn = document.createElement('button');
    googleBtn.type = 'button';
    googleBtn.className = 'auth-google';
    googleBtn.innerHTML =
      '<svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">' +
      '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
      '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
      '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
      '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
      '</svg> Continue with Google';
    googleBtn.addEventListener('click', function () {
      googleBtn.disabled = true;
      googleBtn.textContent = 'Checking…';
      window.KatalogitAuth.signInWithGoogle().then(function (res) {
        if (res.ok) {
          showError('');
          window.location.href = '/app';
        } else {
          googleBtn.disabled = false;
          googleBtn.innerHTML = 'Continue with Google';
          if (res.error) showError(res.error);
        }
      });
    });

    form.append(googleBtn, divider, submit, forgot, alt);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('authSigninEmail').value;
      var pw = document.getElementById('authSigninPw').value;
      submit.disabled = true;
      submit.textContent = 'Checking…';
      window.KatalogitAuth.signIn({ email: email, password: pw }).then(function (res) {
        if (res.ok) {
          showError('');
          window.location.href = '/app'; // same origin — Firebase session is shared
        } else {
          showError(res.error);
          submit.disabled = false;
          submit.textContent = 'Sign In →';
        }
      });
    });

    return form;
  }

  function signUpForm() {
    var form = document.createElement('form');
    form.className = 'auth-form';
    form.noValidate = true;

    form.append(
      field('Store Name', 'text', 'authSignupStore', 'Your store name', 'organization', '[A-Za-z0-9 .&\'()-]{2,60}'),
      field('Your Name', 'text', 'authSignupName', 'Your full name', 'name', '[A-Za-z0-9 .&\'()-]{2,60}'),
      field('Mobile Number', 'tel', 'authSignupPhone', '10-digit mobile', 'tel', '[0-9]{10}'),
      field('Email', 'email', 'authSignupEmail', 'you@store.com', 'email'),
      field('Password', 'password', 'authSignupPw', '8+ chars, letters & numbers', 'new-password')
    );

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary btn-large auth-submit';
    submit.textContent = 'Create Account →';

    var alt = document.createElement('p');
    alt.className = 'auth-switch';
    alt.innerHTML = 'Already have access? <button type="button" class="auth-link" data-tab="signin">Sign in</button>';

    var note = document.createElement('p');
    note.className = 'auth-note';
    note.textContent = '🔒 Your account is protected by Firebase Authentication.';

    form.append(submit, alt, note);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Creating…';
      window.KatalogitAuth.register({
        name: document.getElementById('authSignupName').value,
        storeName: document.getElementById('authSignupStore').value,
        phone: document.getElementById('authSignupPhone').value,
        email: document.getElementById('authSignupEmail').value,
        password: document.getElementById('authSignupPw').value,
      }).then(function (res) {
        if (res.ok) {
          showError('');
          // Account created + signed in. Show the verification step — the
          // dashboard requires a verified email (server-enforced).
          body.innerHTML = '';
          body.appendChild(signUpSuccess(document.getElementById('authSignupEmail').value));
        } else {
          showError(res.error);
          submit.disabled = false;
          submit.textContent = 'Create Account →';
        }
      });
    });

    return form;
  }

  function signUpSuccess(email) {
    var wrap = document.createElement('div');
    wrap.className = 'auth-form';
    var h = document.createElement('h3');
    h.className = 'auth-title';
    h.textContent = 'Account created! 🎉';
    var p = document.createElement('p');
    p.className = 'auth-sub';
    p.innerHTML = 'We sent a verification link to <strong>' + escapeHtml(email) + '</strong>. ' +
      'Click it to activate your account — your store stays protected from fraud.';
    var go = document.createElement('a');
    go.href = '/app';
    go.className = 'btn-primary btn-large auth-submit';
    go.textContent = 'Continue to dashboard →';
    var resend = document.createElement('button');
    resend.type = 'button';
    resend.className = 'auth-link';
    resend.textContent = 'Resend verification email';
    resend.style.margin = '0 auto';
    resend.addEventListener('click', function () {
      window.KatalogitAuth.sendVerification().then(function (r) {
        p.innerHTML = r.ok
          ? '📬 Verification email sent to <strong>' + escapeHtml(email) + '</strong>. Check your inbox (and spam).'
          : escapeHtml(r.error);
      });
    });
    wrap.append(h, p, go, resend);
    return wrap;
  }

  function forgotForm() {
    var wrap = document.createElement('div');
    wrap.className = 'auth-form';

    var p = document.createElement('p');
    p.className = 'auth-sub';
    p.textContent = 'Enter your account email and we\u2019ll send a password reset link.';
    wrap.appendChild(p);

    var form = document.createElement('form');
    form.className = 'auth-form';
    form.append(field('Email', 'email', 'authForgotEmail', 'you@store.com', 'email'));

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary btn-large auth-submit';
    submit.textContent = 'Send Reset Link';
    form.append(submit);

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'auth-link';
    back.textContent = '← Back to sign in';
    back.style.margin = '0 auto';
    back.addEventListener('click', function () { switchTab('signin'); });

    var msg = document.createElement('p');
    msg.className = 'auth-note';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('authForgotEmail').value;
      submit.disabled = true;
      submit.textContent = 'Sending…';
      window.KatalogitAuth.sendPasswordReset(email).then(function (res) {
        msg.textContent = res.ok
          ? 'If an account exists for that email, a reset link is on its way. Check your inbox (and spam).'
          : res.error;
        submit.disabled = false;
        submit.textContent = 'Send Reset Link';
      });
    });

    wrap.append(form, msg, back);
    return wrap;
  }

  // Tabs
  modal.querySelectorAll('.auth-tab').forEach(function (t) {
    t.addEventListener('click', function () { switchTab(t.dataset.tab); });
  });
  body.addEventListener('click', function (e) {
    var link = e.target.closest('.auth-link');
    if (link && link.dataset.forgot) {
      body.innerHTML = '';
      body.appendChild(forgotForm());
      showError('');
      var first = document.getElementById('authForgotEmail');
      if (first) first.focus();
      return;
    }
    if (link) switchTab(link.dataset.tab);
  });

  function open() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    switchTab('signin');
    var first = document.getElementById('authSigninEmail');
    if (first) first.focus();
  }
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  openBtns.forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); open(); }); });
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();

console.log('🔐 KatalogitAI auth ready — Firebase protected.');
