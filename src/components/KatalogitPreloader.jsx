import React, { useEffect, useRef, useState } from 'react';
import { KShirtMark } from './KatalogitLogo';

// Letters after the K that fold out of it (Netflix-intro style)
const AFTER_LETTERS = ['a', 't', 'a', 'l', 'o', 'g', 'i', 't'];

/**
 * KatalogitAI intro animation — plays on every page load.
 *
 * Real loading, not a fixed timer:
 *   • the logo story plays FIRST (K drops → letters fold out → fold back →
 *     the AI+ pill pops in and settles in front of the word)
 *   • once the story has played AND the app behind is actually ready
 *     (`ready` — fonts loaded + session checked), the overlay fades.
 *   • a hard cap guarantees it can never get stuck, no matter what.
 */
export default function KatalogitPreloader({ onComplete, ready = true }) {
  // 0 K drops · 1 letters out · 2 letters in · 3 AI+ pill pops · 4 story done · 5 fade
  const [phase, setPhase] = useState(0);
  const [slot, setSlot] = useState(30);
  const [progress, setProgress] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const finishedRef = useRef(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPhase(5); // fade the overlay (CSS transition 0.5s)
    setTimeout(() => { if (onCompleteRef.current) onCompleteRef.current(); }, 550);
  };

  // Logo story timeline — tight, so the animation never drags.
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // letters fold OUT of the K
      setTimeout(() => setPhase(2), 1750),  // letters fold back IN
      setTimeout(() => setPhase(3), 2350),  // AI+ pill pops and settles in front
      setTimeout(() => setPhase(4), 2900),  // story minimum done — arm completion
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Leave only when the story has played AND the app behind is ready.
  useEffect(() => {
    if (phase >= 4 && readyRef.current) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready]);

  // Hard cap — never stuck, even if `ready` never arrives.
  useEffect(() => {
    const cap = setTimeout(finish, 4300);
    return () => clearTimeout(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress bar tracks real load: eases to ~75% during the story, then to
  // 100% when the app behind reports ready.
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) / 1000;
      const base = Math.min(0.75, t * 0.26);          // ≈0.75 by 2.9s
      setProgress(readyRef.current ? Math.min(1, base + 0.3) : base);
    }, 80);
    return () => clearInterval(id);
  }, []);

  // Responsive letter spacing so the word always fits the viewport
  useEffect(() => {
    const fit = () => {
      const s = Math.max(20, Math.min(30, Math.floor((window.innerWidth - 200) / 8)));
      setSlot(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const K_W = 64;

  return (
    <div className={`pk-overlay ${phase >= 5 ? 'pk-fade' : ''}`} role="status" aria-label="Loading KatalogitAI">
      <div className="pk-stars">
        {[...Array(14)].map((_, i) => (
          <div key={i} className="ob-star" style={{ '--i': i }} />
        ))}
      </div>

      <div className="pk-stage">
        <div className="pk-lockup">
          {/* AI+ — pops in separately, then settles IN FRONT of the word */}
          <div className={`pk-ai-badge ${phase >= 3 ? 'pk-pop' : ''}`}>
            <span className="pk-ai-plus">AI</span>
            <span className="pk-ai-plus-sign">+</span>
          </div>

          <div className="pk-word">
            {/* the t-shirt K */}
            <div className="pk-k">
              <KShirtMark className="pk-shirt-svg" />
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
                  '--out-delay': `${0.1 + i * 0.06}s`,
                  '--in-delay': `${i * 0.045}s`,
                }}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>

        {/* Real progress bar — width driven by actual load state */}
        <div className="pk-bar">
          <div className="pk-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
