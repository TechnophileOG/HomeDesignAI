import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

// Letters after the K that fold out of it (Netflix-intro style)
const AFTER_LETTERS = ['a', 't', 'a', 'l', 'o', 'g', 'i', 't'];

// The "K" is a folded t-shirt: the stem is the shirt body, the two arms of
// the K are the sleeves, and the neck hole sits right on the top of the K.
const KShirtMark = () => (
  <svg viewBox="0 0 140 150" className="pk-shirt-svg">
    <defs>
      <linearGradient id="pkShirtGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1d8a5c" />
        <stop offset="100%" stopColor="#0f6240" />
      </linearGradient>
      <linearGradient id="pkSleeveGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fdf3e4" />
        <stop offset="100%" stopColor="#eecba2" />
      </linearGradient>
    </defs>

    {/* ground shadow */}
    <ellipse cx="70" cy="146" rx="36" ry="5" fill="#0a1f14" opacity="0.35" />

    {/* upper sleeve — the K's top arm */}
    <path d="M 54 56 L 118 22 L 130 36 L 60 72 Z" fill="url(#pkSleeveGrad)" stroke="#d9a06b" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M 60 66 L 120 30" stroke="#8a5a3b" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
    <rect x="116" y="20" width="20" height="13" rx="5.5" transform="rotate(-48 126 27)" fill="#fdf3e4" stroke="#d9a06b" strokeWidth="1.5" />

    {/* lower sleeve — the K's bottom arm */}
    <path d="M 86 66 L 130 100 L 120 112 L 78 78 Z" fill="url(#pkSleeveGrad)" stroke="#d9a06b" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M 80 74 L 122 104" stroke="#8a5a3b" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
    <rect x="116" y="98" width="20" height="13" rx="5.5" transform="rotate(48 126 105)" fill="#fdf3e4" stroke="#d9a06b" strokeWidth="1.5" />

    {/* body — the K stem (folded shirt) */}
    <rect x="58" y="28" width="24" height="102" rx="11" fill="url(#pkShirtGrad)" />
    <line x1="70" y1="42" x2="70" y2="124" stroke="#fdf3e4" strokeWidth="1.5" strokeDasharray="3 6" opacity="0.3" />

    {/* neck hole on the K */}
    <circle cx="70" cy="36" r="9" fill="#0a3d28" stroke="#fdf3e4" strokeWidth="2.5" />
    <path d="M 63 43 Q 70 51 77 43" stroke="#fdf3e4" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.9" />
  </svg>
);

export default function KatalogitPreloader({ onComplete }) {
  const [phase, setPhase] = useState(0); // 0 K drops in, 1 letters out, 2 letters in, 3 AI pops, 4 fade
  const [slot, setSlot] = useState(30);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Timeline of the logo animation
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 380),   // letters fold OUT of the K
      setTimeout(() => setPhase(2), 2700),  // letters fold back INTO the K
      setTimeout(() => setPhase(3), 3600),  // AI badge pops up separately
      setTimeout(() => setPhase(4), 4900),  // fade the overlay
      // (fade transition is 0.7s → let it finish before unmounting)
      setTimeout(() => onCompleteRef.current && onCompleteRef.current(), 5750),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Responsive letter spacing so the word always fits the viewport
  useEffect(() => {
    const fit = () => {
      const s = Math.max(20, Math.min(30, Math.floor((window.innerWidth - 160) / 8)));
      setSlot(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const K_W = 64;

  return (
    <div className={`pk-overlay ${phase >= 4 ? 'pk-fade' : ''}`} role="status" aria-label="Loading KatalogitAI">
      <div className="pk-stars">
        {[...Array(14)].map((_, i) => (
          <div key={i} className="ob-star" style={{ '--i': i }} />
        ))}
      </div>

      <div className="pk-stage">
        <div className="pk-word">
          {/* the t-shirt K */}
          <div className="pk-k">
            <KShirtMark />
          </div>

          {/* the rest of "Katalogit" folds out of the K, then folds back in */}
          {AFTER_LETTERS.map((ch, i) => (
            <span
              key={i}
              className={`pk-letter ${phase >= 2 ? 'pk-in' : phase >= 1 ? 'pk-out' : ''}`}
              style={{
                width: slot,
                fontSize: `${Math.min(42, Math.round(slot * 1.35))}px`,
                '--sx': `${-(K_W / 2 + i * slot + slot / 2)}px`,
                '--out-delay': `${0.12 + i * 0.07}s`,
                '--in-delay': `${i * 0.05}s`,
              }}
            >
              {ch}
            </span>
          ))}
        </div>

        {/* AI comes separately — a glowing badge that pops in */}
        <div className={`pk-ai-badge ${phase >= 3 ? 'pk-pop' : ''}`}>
          <Sparkles size={16} />
          <span>AI</span>
        </div>

        <div className="pk-bar" />
      </div>
    </div>
  );
}
