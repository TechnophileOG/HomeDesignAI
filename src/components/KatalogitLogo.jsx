import React from 'react';

/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — shared brand mark
   ────────────────────────────────────────────────────────────────────────
   The "K" is a folded t-shirt: the stem is the shirt body, the two arms of
   the K are the sleeves, and the neck hole sits right on top of the K.
   Used by: the preloader, the auth modal, and any future brand surfaces —
   so the logo can NEVER drift between screens.
   ════════════════════════════════════════════════════════════════════════ */

export const KShirtMark = ({ className = '' }) => (
  <svg viewBox="0 0 140 150" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="klShirtGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1d8a5c" />
        <stop offset="100%" stopColor="#0f6240" />
      </linearGradient>
      <linearGradient id="klSleeveGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fdf3e4" />
        <stop offset="100%" stopColor="#eecba2" />
      </linearGradient>
    </defs>

    {/* ground shadow */}
    <ellipse cx="70" cy="146" rx="36" ry="5" fill="#0a1f14" opacity="0.35" />

    {/* upper sleeve — the K's top arm */}
    <path d="M 54 56 L 118 22 L 130 36 L 60 72 Z" fill="url(#klSleeveGrad)" stroke="#d9a06b" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M 60 66 L 120 30" stroke="#8a5a3b" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
    <rect x="116" y="20" width="20" height="13" rx="5.5" transform="rotate(-48 126 27)" fill="#fdf3e4" stroke="#d9a06b" strokeWidth="1.5" />

    {/* lower sleeve — the K's bottom arm */}
    <path d="M 86 66 L 130 100 L 120 112 L 78 78 Z" fill="url(#klSleeveGrad)" stroke="#d9a06b" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M 80 74 L 122 104" stroke="#8a5a3b" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
    <rect x="116" y="98" width="20" height="13" rx="5.5" transform="rotate(48 126 105)" fill="#fdf3e4" stroke="#d9a06b" strokeWidth="1.5" />

    {/* body — the K stem (folded shirt) */}
    <rect x="58" y="28" width="24" height="102" rx="11" fill="url(#klShirtGrad)" />
    <line x1="70" y1="42" x2="70" y2="124" stroke="#fdf3e4" strokeWidth="1.5" strokeDasharray="3 6" opacity="0.3" />

    {/* neck hole on the K */}
    <circle cx="70" cy="36" r="9" fill="#0a3d28" stroke="#fdf3e4" strokeWidth="2.5" />
    <path d="M 63 43 Q 70 51 77 43" stroke="#fdf3e4" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.9" />
  </svg>
);

/**
 * Full wordmark: the t-shirt K + "Katalogit" (+ optional "AI+" pill).
 * tone: 'light' (on dark) | 'dark' (on light)
 */
export default function KatalogitLogo({ tone = 'dark', showAiPill = true, className = '' }) {
  const textColor = tone === 'light' ? '#fdf7ee' : '#24211d';
  return (
    <span className={`kat-logo ${className}`} aria-label="KatalogitAI">
      <KShirtMark className="kat-logo-mark" />
      <span className="kat-logo-word" style={{ color: textColor }}>
        Katalogit
      </span>
      {showAiPill && <span className="kat-logo-pill">AI+</span>}
    </span>
  );
}
