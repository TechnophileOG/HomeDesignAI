/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — errors
   ────────────────────────────────────────────────────────────────────────
   Uniform `{ ok:false, error:{ code, message } }` responses. Unknown errors
   become a generic 500 — stack traces are logged server-side only, never
   shipped to clients (black-box behaviour).
   ════════════════════════════════════════════════════════════════════════ */

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new AppError(400, code, message);
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
export const forbidden = (message = 'Forbidden.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
export const verifyEmailRequired = () => new AppError(403, 'VERIFY_EMAIL',
  'Please verify your email address before continuing.');
export const conflict = (code, message) => new AppError(409, code, message);
export const tooMany = (message = 'Too many requests. Try again later.') =>
  new AppError(429, 'RATE_LIMITED', message);
export const insufficientCredits = (balance) =>
  new AppError(402, 'INSUFFICIENT_CREDITS',
    `Not enough credits to start this job (balance: ${balance}). Please top up.`);
export const notConfigured = (code, message) => new AppError(501, code, message);

/* eslint-disable no-unused-vars */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
  }

  // body-parser / express.json failures — no internals leaked
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large.' } });
  }
  if (typeof err.type === 'string' && err.type.startsWith('entity.parse')) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', message: 'Malformed JSON body.' } });
  }

  // Everything else — log the real cause server-side, reply generically.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong.' } });
}
