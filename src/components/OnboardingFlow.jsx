import React, { useState, useEffect, useRef } from 'react';
import { sanitizeName, sanitizeCity } from '../api/sanitize';
import { Sparkles, Star, Gift } from 'lucide-react';

const CATEGORIES = [
  { id: 'women',     label: "Women's Clothing",   emoji: '👗' },
  { id: 'men',       label: "Men's Clothing",      emoji: '👔' },
  { id: 'footwear',  label: 'Footwear',            emoji: '👟' },
  { id: 'bags',      label: 'Bags & Accessories',  emoji: '👜' },
  { id: 'kids',      label: "Kids' Wear",          emoji: '🧸' },
  { id: 'jewellery', label: 'Jewellery',           emoji: '💎' },
  { id: 'beauty',    label: 'Beauty & Grooming',   emoji: '🧴' },
  { id: 'electronics', label: 'Electronics',       emoji: '📱' },
];

const SCALE_OPTIONS = [
  { id: 'starter', icon: '📦', title: 'Just starting',    sub: 'Under 50 products' },
  { id: 'small',   icon: '🏪', title: 'Small store',      sub: '50–500 products' },
  { id: 'growing', icon: '🏬', title: 'Growing fast',     sub: '500–2000 products' },
  { id: 'large',   icon: '🏭', title: 'Large operation',  sub: '2000+ products' },
];

const STORE_TYPES = ['My own shop', 'Wholesale dealer', 'Online only'];

const BRAND_STYLES = [
  { id: 'modern', label: 'Modern', description: 'Contemporary and minimalist' },
  { id: 'traditional', label: 'Traditional', description: 'Classic and timeless' },
  { id: 'fusion', label: 'Fusion', description: 'Blend of traditional and modern' },
  { id: 'trendy', label: 'Trendy', description: 'Latest fashion and styles' },
];

// Enhanced Shop with Interactive Features — redesigned to match the app's
// warm cream / peach / deep-green design system.
const ShopGraphic = ({ storeName, currentStep, selectedCategories = [] }) => {
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    // Categories step — gently zoom into the storefront (subtler on mobile)
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 1100;
    setZoomLevel(currentStep === 3 ? (narrow ? 1.12 : 1.35) : 1);
  }, [currentStep]);

  const zoomed = currentStep === 3;

  return (
    <div className="ob-shop-container">
      <svg
        viewBox="0 0 280 240"
        className="ob-shop-graphic"
        style={{
          width: '100%',
          height: 'auto',
          transform: `scale(${zoomLevel})`,
          transformOrigin: '50% 58%',
          transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <defs>
          <linearGradient id="obSkyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fdf7ee" />
            <stop offset="100%" stopColor="#f8eee3" />
          </linearGradient>
          <linearGradient id="obFacadeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2cba2" />
            <stop offset="100%" stopColor="#e0ac7e" />
          </linearGradient>
          <linearGradient id="obRoofGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d8a5c" />
            <stop offset="100%" stopColor="#0f6240" />
          </linearGradient>
          <linearGradient id="obGlassGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff8ea" />
            <stop offset="100%" stopColor="#f3e3c8" />
          </linearGradient>
        </defs>

        {/* Sky */}
        <rect width="280" height="240" rx="28" fill="url(#obSkyGrad)" />

        {/* Sun + soft glow */}
        <circle cx="230" cy="42" r="30" fill="#f4d47c" opacity="0.25" />
        <circle cx="230" cy="42" r="19" fill="#f4d47c" />

        {/* Clouds */}
        <g fill="#ffffff" opacity="0.9">
          <ellipse cx="54" cy="48" rx="22" ry="9" />
          <ellipse cx="70" cy="42" rx="13" ry="7" />
          <ellipse cx="176" cy="30" rx="15" ry="6" opacity="0.7" />
        </g>

        {/* Ground */}
        <rect x="0" y="196" width="280" height="44" fill="#e3ecdd" />
        <line x1="0" y1="196" x2="280" y2="196" stroke="#167a52" strokeWidth="3" opacity="0.3" />

        {/* Building facade */}
        <rect x="48" y="72" width="184" height="124" rx="12" fill="url(#obFacadeGrad)" />
        <rect x="48" y="190" width="184" height="6" fill="#8a5a3b" opacity="0.12" />

        {/* Roof */}
        <path d="M 38 82 L 140 34 L 242 82 Z" fill="url(#obRoofGrad)" />
        <path d="M 140 34 L 242 82 L 242 74 L 140 30 Z" fill="#ffffff" opacity="0.12" />

        {/* Store sign — live name */}
        <rect x="62" y="82" width="156" height="30" rx="15" fill="#fffdf8" stroke="#0f6240" strokeWidth="2.5" />
        <text
          x="140"
          y="102"
          textAnchor="middle"
          fontSize="14"
          fontWeight="800"
          fontFamily="'Outfit', sans-serif"
          fill="#24211d"
          className="ob-shop-name"
        >
          {storeName ? storeName.substring(0, 16) : 'Your Store'}
        </text>

        {/* Display window */}
        <g>
          <rect x="62" y="130" width="78" height="56" rx="10" fill="url(#obGlassGrad)" stroke="#b98a5e" strokeWidth="2.5" />
          {/* sill */}
          <rect x="56" y="186" width="90" height="4" rx="2" fill="#b98a5e" />
          {/* plant on sill (hidden when zoomed into shelves) */}
          {!zoomed && (
            <g>
              <rect x="120" y="168" width="14" height="18" rx="3" fill="#c77f4a" />
              <path d="M 127 168 Q 119 158 127 150 Q 135 158 127 168 Z" fill="#3d8b63" />
            </g>
          )}
        </g>

        {/* Interior shelves — revealed on the categories step */}
        {zoomed && (
          <g className="ob-shop-interior" opacity={selectedCategories.length > 0 ? 1 : 0.35}>
            <rect x="62" y="148" width="78" height="3" rx="1.5" fill="#b98a5e" />
            <rect x="62" y="168" width="78" height="3" rx="1.5" fill="#b98a5e" />
            {selectedCategories.includes('women') && <text x="78" y="163" fontSize="11" textAnchor="middle">👗</text>}
            {selectedCategories.includes('men') && <text x="101" y="163" fontSize="11" textAnchor="middle">👔</text>}
            {selectedCategories.includes('footwear') && <text x="124" y="163" fontSize="11" textAnchor="middle">👟</text>}
            {selectedCategories.includes('bags') && <text x="78" y="183" fontSize="11" textAnchor="middle">👜</text>}
            {selectedCategories.includes('kids') && <text x="101" y="183" fontSize="11" textAnchor="middle">🧸</text>}
            {selectedCategories.includes('jewellery') && <text x="124" y="183" fontSize="11" textAnchor="middle">💎</text>}
          </g>
        )}

        {/* Door */}
        <g>
          <path d="M 154 196 L 154 154 A 34 34 0 0 1 222 154 L 222 196 Z" fill="#a9743f" />
          <path d="M 160 196 L 160 156 A 28 28 0 0 1 216 156 L 216 196 Z" fill="#c8925e" />
          <circle cx="210" cy="176" r="4" fill="#f4d47c" stroke="#a9743f" strokeWidth="1.5" />
          {/* door mat */}
          <ellipse cx="188" cy="196" rx="20" ry="4" fill="#24211d" opacity="0.12" />
        </g>

        {/* Striped awning over the door */}
        <g>
          <rect x="146" y="114" width="86" height="13" rx="6.5" fill="#0f6240" />
          <rect x="154" y="114" width="11" height="13" fill="#f8eee3" />
          <rect x="176" y="114" width="11" height="13" fill="#f8eee3" />
          <rect x="198" y="114" width="11" height="13" fill="#f8eee3" />
        </g>

        {/* Hanging lamp */}
        <g>
          <line x1="44" y1="80" x2="44" y2="94" stroke="#8a5a3b" strokeWidth="2" />
          <path d="M 37 102 Q 44 112 51 102 Z" fill="#f4d47c" />
          <ellipse cx="44" cy="103" rx="9" ry="3" fill="#f4d47c" opacity="0.35" />
        </g>
      </svg>
    </div>
  );
};

// Business Scale Boxes Animation — redesigned as a tidy warehouse with
// a count badge and a forklift for large operations.
const ScaleBoxes = ({ selectedScale }) => {
  const getBoxCount = (scale) => {
    switch (scale) {
      case 'starter': return 2;
      case 'small': return 5;
      case 'growing': return 9;
      case 'large': return 14;
      default: return 1;
    }
  };

  const boxCount = getBoxCount(selectedScale);

  return (
    <div className="ob-scale-visualization">
      <svg viewBox="0 0 300 200" className="ob-boxes-graphic">
        <defs>
          <linearGradient id="obBoxKraft" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2d3ab" />
            <stop offset="100%" stopColor="#dfb184" />
          </linearGradient>
          <linearGradient id="obBoxCream" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#faf3e8" />
            <stop offset="100%" stopColor="#ecd9bf" />
          </linearGradient>
          <linearGradient id="obBoxGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7cc0a1" />
            <stop offset="100%" stopColor="#167a52" />
          </linearGradient>
        </defs>

        {/* Soft card backdrop */}
        <rect width="300" height="200" rx="24" fill="#fdf7ee" />

        {/* Back wall */}
        <rect x="20" y="40" width="260" height="140" rx="14" fill="#f3e6d3" opacity="0.5" />
        <line x1="24" y1="64" x2="276" y2="64" stroke="#e3c9a4" strokeWidth="2" strokeDasharray="3 6" opacity="0.6" />
        <line x1="24" y1="104" x2="276" y2="104" stroke="#e3c9a4" strokeWidth="2" strokeDasharray="3 6" opacity="0.6" />
        <line x1="24" y1="144" x2="276" y2="144" stroke="#e3c9a4" strokeWidth="2" strokeDasharray="3 6" opacity="0.6" />

        {/* Floor */}
        <rect x="0" y="176" width="300" height="24" rx="0" fill="#e3ecdd" />
        <line x1="0" y1="176" x2="300" y2="176" stroke="#167a52" strokeWidth="3" opacity="0.3" />

        {/* Stacked boxes — grow with catalogue size (grid shifted left so the
            forklift never overlaps the stack) */}
        {Array.from({ length: Math.min(boxCount, 14) }).map((_, i) => {
          const row = Math.floor(i / 4);
          const col = i % 4;
          const x = 30 + col * 52;
          const y = 164 - row * 38;
          const fills = ['url(#obBoxKraft)', 'url(#obBoxCream)', 'url(#obBoxGreen)'];
          const w = 42;
          const h = 30;

          return (
            <g key={i} className="ob-box-item" style={{ animation: `boxAppear 0.3s ease ${i * 0.08}s both` }}>
              {/* shadow */}
              <ellipse cx={x + w / 2} cy={y + h + 2} rx={w / 2 + 3} ry={3.5} fill="#24211d" opacity="0.12" />
              {/* box body */}
              <rect x={x} y={y} width={w} height={h} rx="6" fill={fills[i % 3]} />
              {/* lid */}
              <rect x={x - 2} y={y - 5} width={w + 4} height="9" rx="4.5" fill={fills[i % 3]} stroke="#24211d" strokeOpacity="0.08" />
              {/* tape */}
              <rect x={x + w / 2 - 2.5} y={y} width="5" height={h} fill="#fffdf8" opacity="0.55" />
              {/* label */}
              <rect x={x + 8} y={y + 9} width={w - 16} height="12" rx="3" fill="#fffdf8" opacity="0.85" />
            </g>
          );
        })}

        {/* Forklift for large scale — tucked in the far-right lane so it
            never overlaps the box stack (stack ends at x≈228) */}
        {selectedScale === 'large' && (
          <g className="ob-forklift" style={{ animation: 'slideIn 0.5s ease 1s both' }}>
            <rect x="258" y="150" width="34" height="20" rx="6" fill="#f0b429" />
            <rect x="262" y="154" width="26" height="5" rx="2.5" fill="#d99a17" />
            <circle cx="268" cy="168" r="5.5" fill="#3a342f" />
            <circle cx="284" cy="168" r="5.5" fill="#3a342f" />
            <rect x="250" y="136" width="4" height="30" fill="#8a7a66" />
            <rect x="236" y="134" width="20" height="6" rx="3" fill="#8a7a66" />
          </g>
        )}

        {/* Count badge */}
        <g>
          <rect x="216" y="16" width="66" height="26" rx="13" fill="#167a52" />
          <text x="249" y="34" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff" fontFamily="'Outfit', sans-serif">
            {boxCount} items
          </text>
        </g>
      </svg>
    </div>
  );
};

// Business History Icon — redesigned as a growing-store timeline
// with a soft card backdrop and a brand-green clock badge.
const BusinessHistory = ({ yearsInBusiness }) => {
  const hasStage2 = yearsInBusiness && yearsInBusiness !== '0-1 years';
  const hasStage3 = yearsInBusiness && (yearsInBusiness === '3-5 years' || yearsInBusiness === '5+ years');

  return (
    <div className="ob-history-visualization">
      <svg viewBox="0 0 280 170" className="ob-history-graphic">
        <defs>
          <linearGradient id="obStoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2cba2" />
            <stop offset="100%" stopColor="#e0ac7e" />
          </linearGradient>
          <linearGradient id="obStoreRoof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d8a5c" />
            <stop offset="100%" stopColor="#0f6240" />
          </linearGradient>
        </defs>

        {/* Card backdrop */}
        <rect width="280" height="170" rx="24" fill="#fdf7ee" />

        {/* Timeline rail */}
        <line x1="36" y1="132" x2="244" y2="132" stroke="#e3c9a4" strokeWidth="3" strokeLinecap="round" />

        {/* Stage 1 — always visible */}
        <g opacity={yearsInBusiness ? 1 : 0.35}>
          <rect x="34" y="84" width="44" height="46" rx="6" fill="url(#obStoreGrad)" />
          <path d="M 30 86 L 56 64 L 82 86 Z" fill="url(#obStoreRoof)" />
          <rect x="42" y="94" width="28" height="24" rx="4" fill="#fffdf8" opacity="0.85" />
          <circle cx="56" cy="132" r="7" fill="#167a52" stroke="#fdf7ee" strokeWidth="2.5" />
        </g>

        {/* Stage 2 — appears after 1-3 yrs */}
        <g opacity={hasStage2 ? 1 : 0.35}>
          <rect x="108" y="76" width="56" height="54" rx="7" fill="url(#obStoreGrad)" />
          <path d="M 102 78 L 136 50 L 170 78 Z" fill="url(#obStoreRoof)" />
          <rect x="118" y="88" width="36" height="30" rx="4" fill="#fffdf8" opacity="0.85" />
          <rect x="126" y="96" width="10" height="10" rx="2" fill="#b98a5e" />
          <rect x="140" y="96" width="10" height="10" rx="2" fill="#b98a5e" />
          <circle cx="136" cy="132" r="7" fill="#167a52" stroke="#fdf7ee" strokeWidth="2.5" />
        </g>

        {/* Stage 3 — appears after 3-5 yrs */}
        <g opacity={hasStage3 ? 1 : 0.35}>
          <rect x="186" y="68" width="66" height="62" rx="8" fill="url(#obStoreGrad)" />
          <path d="M 180 70 L 219 36 L 258 70 Z" fill="url(#obStoreRoof)" />
          <rect x="198" y="80" width="42" height="36" rx="4" fill="#fffdf8" opacity="0.85" />
          <rect x="206" y="88" width="10" height="10" rx="2" fill="#b98a5e" />
          <rect x="222" y="88" width="10" height="10" rx="2" fill="#b98a5e" />
          <rect x="214" y="102" width="10" height="10" rx="2" fill="#b98a5e" />
          <circle cx="219" cy="132" r="7" fill="#167a52" stroke="#fdf7ee" strokeWidth="2.5" />
        </g>

        {/* Clock badge */}
        <g transform="translate(140, 22)">
          <circle cx="0" cy="0" r="21" fill="#fffdf8" stroke="#0f6240" strokeWidth="2.5" />
          <circle cx="0" cy="0" r="15" fill="#edf6f1" />
          <line x1="0" y1="0" x2="0" y2="-8" stroke="#0f6240" strokeWidth="3" strokeLinecap="round" />
          <line x1="0" y1="0" x2="6" y2="3" stroke="#0f6240" strokeWidth="3" strokeLinecap="round" />
          <circle cx="0" cy="0" r="2.5" fill="#0f6240" />
        </g>
      </svg>
    </div>
  );
};

const PersonGraphic = () => {
  return (
    <svg viewBox="0 0 120 180" className="ob-person-graphic">
      <defs>
        <linearGradient id="obSkinGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5cfa8" />
          <stop offset="100%" stopColor="#e0a97e" />
        </linearGradient>
        <linearGradient id="obShirtGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d8a5c" />
          <stop offset="100%" stopColor="#0f6240" />
        </linearGradient>
      </defs>

      {/* shadow */}
      <ellipse cx="60" cy="174" rx="32" ry="5" fill="#24211d" opacity="0.12" />

      {/* legs + shoes */}
      <rect x="46" y="118" width="11" height="42" rx="5.5" fill="#3a342f" />
      <rect x="63" y="118" width="11" height="42" rx="5.5" fill="#3a342f" />
      <rect x="42" y="158" width="19" height="10" rx="5" fill="#8a5a3b" />
      <rect x="59" y="158" width="19" height="10" rx="5" fill="#8a5a3b" />

      {/* body — kurta-style shirt */}
      <path d="M 38 74 Q 38 118 60 120 Q 82 118 82 74 L 76 58 C 70 66 50 66 44 58 Z" fill="url(#obShirtGrad)" />
      {/* collar */}
      <path d="M 52 62 L 60 72 L 68 62" stroke="#f8eee3" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* nametag */}
      <rect x="66" y="86" width="12" height="9" rx="2.5" fill="#f8eee3" opacity="0.9" />
      <rect x="68" y="89" width="8" height="2.5" rx="1.25" fill="#0f6240" />

      {/* waving arm (left) */}
      <g className="ob-person-wave">
        <path d="M 40 78 Q 24 74 20 52" stroke="url(#obShirtGrad)" strokeWidth="11" strokeLinecap="round" fill="none" />
        <circle cx="20" cy="50" r="7" fill="url(#obSkinGrad)" />
      </g>

      {/* resting arm (right) */}
      <g>
        <path d="M 80 78 Q 96 84 96 104" stroke="url(#obShirtGrad)" strokeWidth="11" strokeLinecap="round" fill="none" />
        <circle cx="96" cy="106" r="7" fill="url(#obSkinGrad)" />
      </g>

      {/* head */}
      <circle cx="60" cy="32" r="19" fill="url(#obSkinGrad)" />
      {/* hair */}
      <path d="M 41 30 Q 41 13 60 13 Q 79 13 79 30 Q 73 20 60 20 Q 47 20 41 30 Z" fill="#3a342f" />
      {/* eyes */}
      <circle cx="54" cy="31" r="2.2" fill="#3a342f" />
      <circle cx="66" cy="31" r="2.2" fill="#3a342f" />
      {/* smile */}
      <path d="M 55 39 Q 60 43 65 39" stroke="#3a342f" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* blush */}
      <circle cx="49" cy="35" r="3" fill="#e88c6a" opacity="0.4" />
      <circle cx="71" cy="35" r="3" fill="#e88c6a" opacity="0.4" />
    </svg>
  );
};

const StepDots = ({ current, total }) => {
  return (
    <div className="ob-step-dots-container">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`ob-step-dot ${i === current - 1 ? 'active' : ''} ${i < current - 1 ? 'completed' : ''}`} />
      ))}
    </div>
  );
};

// Small storefront used for the "crowd of stores" under the cloud
const CrowdStore = ({ delay = 0 }) => (
  <div className="ob-crowd-store" style={{ '--crowd-delay': `${delay}s` }}>
    <svg viewBox="0 0 40 36" className="ob-crowd-store-svg">
      <rect x="6" y="14" width="28" height="20" rx="3" fill="#f2cba2" />
      <path d="M 4 16 L 20 5 L 36 16 Z" fill="#167a52" />
      <rect x="10" y="18" width="8" height="10" rx="1.5" fill="#fffdf8" />
      <rect x="22" y="18" width="10" height="14" rx="1.5" fill="#a9743f" />
    </svg>
  </div>
);

const EpicFinaleScreen = ({ storeName, onComplete }) => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const phases = [
      { duration: 1500, action: () => setPhase(1) }, // Your store appears
      { duration: 2000, action: () => setPhase(2) }, // KatalogitAI powers up
      { duration: 2500, action: () => setPhase(3) }, // Store transforms + digital vault
      { duration: 3000, action: () => setPhase(4) }, // Cloud ecosystem forms
      { duration: 2000, action: () => setPhase(5) }, // Success message
    ];

    let timeouts = [];
    phases.forEach((phase, index) => {
      const timeout = setTimeout(phase.action, phases.slice(0, index).reduce((acc, p) => acc + p.duration, 0));
      timeouts.push(timeout);
    });

    // Complete after all phases
    const completeTimeout = setTimeout(() => {
      onComplete();
    }, phases.reduce((acc, p) => acc + p.duration, 0) + 1000);
    timeouts.push(completeTimeout);

    return () => timeouts.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className="ob-finale-screen-new">
      {/* Animated background */}
      <div className="ob-finale-bg-new">
        <div className="ob-finale-stars">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="ob-star" style={{ '--i': i }} />
          ))}
        </div>
      </div>

      {/* Your store — layered wrappers so appear/power/transform never
          overwrite each other (the old single-element animation conflict
          made the store disappear when it rose to the cloud) */}
      <div className={`ob-finale-main-store ${phase >= 3 ? 'transform' : ''} ${phase >= 5 ? 'hide' : ''}`}>
        <div className={`ob-store-wrap ${phase >= 1 ? 'appear' : ''}`}>
          <div className={`ob-store-main ${phase >= 2 ? 'powered' : ''}`}>
            <ShopGraphic storeName={storeName} currentStep={2} />
          </div>

          {phase >= 2 && (
            <>
              <div className="ob-ai-energy-core">
                <Sparkles size={60} />
              </div>
              <div className="ob-energy-waves">
                <div className="ob-wave ob-wave-1" />
                <div className="ob-wave ob-wave-2" />
                <div className="ob-wave ob-wave-3" />
              </div>
              <div className="ob-power-particles">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="ob-particle" style={{ '--particle-i': i }} />
                ))}
              </div>
            </>
          )}

          {/* Digital vault cage — the store gets sealed & charged before
              it rises into the cloud */}
          {phase >= 3 && (
            <div className="ob-digital-cage">
              <span className="ob-cage-corner ob-cage-tl" />
              <span className="ob-cage-corner ob-cage-tr" />
              <span className="ob-cage-corner ob-cage-bl" />
              <span className="ob-cage-corner ob-cage-br" />
              <span className="ob-cage-label">⚡ DIGITAL VAULT</span>
            </div>
          )}
        </div>
      </div>

      {/* Cloud ecosystem forms around the store */}
      {phase >= 4 && (
        <div className="ob-cloud-ecosystem">
          {/* Floating devices receiving data */}
          <div className="ob-connected-devices">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="ob-device" style={{ '--device-i': i }}>
                <div className="ob-device-screen">
                  <div className="ob-data-bars">
                    <div className="ob-bar" />
                    <div className="ob-bar" />
                    <div className="ob-bar" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Data streams — radiating in ALL directions from the store */}
          <svg className="ob-data-streams" viewBox="0 0 100 100">
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i / 12) * Math.PI * 2;
              const x1 = (50 + Math.cos(a) * 13).toFixed(1);
              const y1 = (50 + Math.sin(a) * 13).toFixed(1);
              const x2 = (50 + Math.cos(a) * 47).toFixed(1);
              const y2 = (50 + Math.sin(a) * 47).toFixed(1);
              const cx = (50 + Math.cos(a) * 33 - Math.sin(a) * 13).toFixed(1);
              const cy = (50 + Math.sin(a) * 33 + Math.cos(a) * 13).toFixed(1);
              return (
                <path
                  key={i}
                  className="ob-data-stream"
                  d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                  style={{ '--stream-delay': `${i * 0.22}s` }}
                />
              );
            })}
          </svg>

          {/* Cloud formations */}
          <div className="ob-cloud-formations">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="ob-cloud" style={{ '--cloud-i': i }}>
                ☁️
              </div>
            ))}
          </div>

          {/* Crowd of stores below — every vendor joins the ecosystem */}
          <div className="ob-crowd">
            {[...Array(6)].map((_, i) => <CrowdStore key={i} delay={i * 0.15} />)}
          </div>
        </div>
      )}

      {/* Success message */}
      {phase >= 5 && (
        <div className="ob-finale-success-new">
          <div className="ob-success-burst">🎉</div>
          <h1>Welcome to the KatalogitAI Cloud!</h1>
          <p>Your store {storeName} is now powered by AI and connected to the ecosystem</p>
          <div className="ob-success-features">
            <div>✨ Professional AI photoshoots ready</div>
            <div>🚀 Smart pricing & descriptions active</div>
            <div>📱 Multi-device sync enabled</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 6; // Merged SKUs into catalog size
  const mainRef = useRef(null);

  // Always start each step scrolled to the top (important on mobile)
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [step]);

  const [storeName, setStoreName] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [storeType, setStoreType] = useState('');
  const [categories, setCategories] = useState([]);
  const [scale, setScale] = useState('');
  const [salesChannel, setSalesChannel] = useState('');
  const [yearsInBusiness, setYearsInBusiness] = useState('');
  const [inventoryTurnover, setInventoryTurnover] = useState('');
  const [hasInventorySystem, setHasInventorySystem] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const [brandStyle, setBrandStyle] = useState('');
  const [aiFeatures, setAiFeatures] = useState([]);

  const toggleCategory = (id) => setCategories(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  const toggleAiFeature = (feature) => setAiFeatures(prev => prev.includes(feature) ? prev.filter(f => f !== feature) : [...prev, feature]);

  const progressPct = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  const handleFinish = () => setStep(TOTAL_STEPS + 1);
  const handleFinaleComplete = () => {
    onComplete({
      storeName, name, city, storeType, categories, scale,
      salesChannel, yearsInBusiness, inventoryTurnover,
      hasInventorySystem, orderValue,
      brandStyle, aiFeatures
    });
  };

  const handleNext = () => { if (step < TOTAL_STEPS) setStep(step + 1); };
  const handlePrev = () => { if (step > 1) setStep(step - 1); };

  const canGoNext = {
    1: true,
    2: storeName.trim() && name.trim(),
    3: categories.length > 0,
    4: scale !== '',
    5: salesChannel && yearsInBusiness && inventoryTurnover && hasInventorySystem && orderValue,
    6: brandStyle !== ''
  };

  if (step === TOTAL_STEPS + 1) {
    return <EpicFinaleScreen storeName={storeName} onComplete={handleFinaleComplete} />;
  }

  return (
    <div className="ob-overlay-new">
      <div className="ob-progress-bar-new">
        <div className="ob-progress-fill-new" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="ob-main-container-new" ref={mainRef}>
        <div className="ob-content-left-new">
          {step === 1 && (
            <div className="ob-step-new ob-step-slide-in">
              <span className="ob-step-label-new">Welcome</span>
              <h1 className="ob-title-new">Turn Your Products Into Professional Photoshoots</h1>
              <p className="ob-subtitle-new">Just click a simple photo → AI creates stunning model shots in seconds</p>
              
              <div className="ob-demo-flow">
                <div className="ob-demo-step">
                  <div className="ob-demo-icon">📱</div>
                  <p>Click flat-lay photo</p>
                </div>
                <div className="ob-demo-arrow">→</div>
                <div className="ob-demo-step">
                  <div className="ob-demo-icon">🤖</div>
                  <p>AI processes</p>
                </div>
                <div className="ob-demo-arrow">→</div>
                <div className="ob-demo-step">
                  <div className="ob-demo-icon">📸</div>
                  <p>Professional model photos</p>
                </div>
              </div>
              
              <div className="ob-benefits-new">
                <div>✓ AI-generated professional model photoshoots</div>
                <div>✓ Auto-written product descriptions & pricing</div>
                <div>✓ Complete catalogue built in minutes</div>
                <div>✓ No photographer, no model, no studio needed</div>
              </div>
              
              <button className="ob-btn-primary-new" onClick={handleNext}>Get Started →</button>
            </div>
          )}

          {step === 2 && (
            <div className="ob-step-new ob-step-slide-in">
              <span className="ob-step-label-new">Step 2 of {TOTAL_STEPS}</span>
              <h1 className="ob-title-new">Tell us about your store</h1>
              <div className="ob-form-group-new">
                <label className="ob-label-new">Store Name</label>
                <input className="ob-input-new" placeholder="Your store name" value={storeName} maxLength={40} onChange={e => setStoreName(sanitizeName(e.target.value, 40))} />
              </div>
              <div className="ob-form-group-new">
                <label className="ob-label-new">Your Name</label>
                <input className="ob-input-new" placeholder="Your full name" value={name} maxLength={40} onChange={e => setName(sanitizeName(e.target.value, 40))} />
              </div>
              <div className="ob-form-group-new">
                <label className="ob-label-new">City</label>
                <input className="ob-input-new" placeholder="e.g. Delhi" value={city} maxLength={30} onChange={e => setCity(sanitizeCity(e.target.value, 30))} />
              </div>
              <div className="ob-form-group-new">
                <label className="ob-label-new">Store Type</label>
                <div className="ob-chips-row-new">
                  {STORE_TYPES.map(t => (
                    <button key={t} className={`ob-chip-new ${storeType === t ? 'active' : ''}`} onClick={() => setStoreType(t)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="ob-buttons-row-new">
                <button className="ob-btn-secondary-new" onClick={handlePrev}>← Back</button>
                <button className="ob-btn-primary-new" disabled={!canGoNext[2]} onClick={handleNext}>Next →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="ob-step-new ob-step-slide-in">
              <span className="ob-step-label-new">Step 3 of {TOTAL_STEPS}</span>
              <h1 className="ob-title-new">What do you sell?</h1>
              <div className="ob-chips-grid-new">
                {CATEGORIES.map(cat => (
                  <button key={cat.id} className={`ob-chip-new ob-chip-lg ${categories.includes(cat.id) ? 'active' : ''}`} onClick={() => toggleCategory(cat.id)}>
                    <span>{cat.emoji}</span> {cat.label}
                  </button>
                ))}
              </div>
              <div className="ob-buttons-row-new">
                <button className="ob-btn-secondary-new" onClick={handlePrev}>← Back</button>
                <button className="ob-btn-primary-new" disabled={!canGoNext[3]} onClick={handleNext}>Next →</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="ob-step-new ob-step-slide-in">
              <span className="ob-step-label-new">Step 4 of {TOTAL_STEPS}</span>
              <h1 className="ob-title-new">How big is your catalogue?</h1>
              <div className="ob-scale-grid-new">
                {SCALE_OPTIONS.map(opt => (
                  <button key={opt.id} className={`ob-scale-card-new ${scale === opt.id ? 'active' : ''}`} onClick={() => setScale(opt.id)}>
                    <span>{opt.icon}</span>
                    <div><div className="ob-scale-title">{opt.title}</div><div className="ob-scale-sub">{opt.sub}</div></div>
                  </button>
                ))}
              </div>
              <div className="ob-buttons-row-new">
                <button className="ob-btn-secondary-new" onClick={handlePrev}>← Back</button>
                <button className="ob-btn-primary-new" disabled={!canGoNext[4]} onClick={handleNext}>Next →</button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="ob-step-new ob-step-slide-in">
              <span className="ob-step-label-new">Step 5 of {TOTAL_STEPS}</span>
              <h1 className="ob-title-new">Business Details</h1>
              <div className="ob-survey-new">
                <div className="ob-question-new">
                  <label>Primary sales channel?</label>
                  <div className="ob-options-new">
                    {['Physical store', 'Online', 'Both'].map(opt => (
                      <button key={opt} className={`ob-option-new ${salesChannel === opt ? 'active' : ''}`} onClick={() => setSalesChannel(opt)}>{opt}</button>
                    ))}
                  </div>
                </div>
                <div className="ob-question-new">
                  <label>Years in business?</label>
                  <div className="ob-options-new">
                    {['0-1 yrs', '1-3 yrs', '3-5 yrs', '5+ yrs'].map(opt => (
                      <button key={opt} className={`ob-option-new ${yearsInBusiness === opt ? 'active' : ''}`} onClick={() => setYearsInBusiness(opt)}>{opt}</button>
                    ))}
                  </div>
                </div>
                <div className="ob-question-new">
                  <label>Inventory turnover?</label>
                  <div className="ob-options-new">
                    {['Fast', 'Moderate', 'Seasonal'].map(opt => (
                      <button key={opt} className={`ob-option-new ${inventoryTurnover === opt ? 'active' : ''}`} onClick={() => setInventoryTurnover(opt)}>{opt}</button>
                    ))}
                  </div>
                </div>
                <div className="ob-question-new">
                  <label>Inventory system?</label>
                  <div className="ob-options-new">
                    {['Yes', 'No'].map(opt => (
                      <button key={opt} className={`ob-option-new ${hasInventorySystem === opt ? 'active' : ''}`} onClick={() => setHasInventorySystem(opt)}>{opt}</button>
                    ))}
                  </div>
                </div>
                <div className="ob-question-new">
                  <label>Average order value?</label>
                  <div className="ob-options-new">
                    {['Budget', 'Mid-range', 'Premium', 'Mixed'].map(opt => (
                      <button key={opt} className={`ob-option-new ${orderValue === opt ? 'active' : ''}`} onClick={() => setOrderValue(opt)}>{opt}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ob-buttons-row-new">
                <button className="ob-btn-secondary-new" onClick={handlePrev}>← Back</button>
                <button className="ob-btn-primary-new" disabled={!canGoNext[5]} onClick={handleNext}>Next →</button>
              </div>
            </div>
          )}


          {step === 6 && (
            <div className="ob-step-new ob-step-slide-in">
              <span className="ob-step-label-new">Step 6 of {TOTAL_STEPS}</span>
              <h1 className="ob-title-new">Choose your preferences</h1>
              
              <div className="ob-prefs-section-new">
                <label className="ob-section-label-new">Brand Style</label>
                <div className="ob-brand-grid-new">
                  {BRAND_STYLES.map(style => (
                    <button key={style.id} className={`ob-brand-card-new ${brandStyle === style.id ? 'active' : ''}`} onClick={() => setBrandStyle(style.id)}>
                      <div>{style.label}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{style.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="ob-prefs-section-new">
                <label className="ob-section-label-new">AI Features for Your Store</label>
                <div className="ob-features-list-new">
                  <button className={`ob-feature-btn-new ${aiFeatures.includes('Auto-pricing') ? 'active' : ''}`} onClick={() => toggleAiFeature('Auto-pricing')}>
                    <input type="checkbox" checked={aiFeatures.includes('Auto-pricing')} onChange={() => {}} />
                    <span>Smart Auto-Pricing Recommendations</span>
                    <div className="ob-feature-badge free">
                      <Gift size={12} />
                      FREE
                    </div>
                  </button>
                  
                  <button className={`ob-feature-btn-new ${aiFeatures.includes('Auto-description') ? 'active' : ''}`} onClick={() => toggleAiFeature('Auto-description')}>
                    <input type="checkbox" checked={aiFeatures.includes('Auto-description')} onChange={() => {}} />
                    <span>Auto Product Descriptions</span>
                    <div className="ob-feature-badge free">
                      <Gift size={12} />
                      FREE
                    </div>
                  </button>
                  
                  <button className={`ob-feature-btn-new ${aiFeatures.includes('Image-enhancement') ? 'active' : ''}`} onClick={() => toggleAiFeature('Image-enhancement')}>
                    <input type="checkbox" checked={aiFeatures.includes('Image-enhancement')} onChange={() => {}} />
                    <span>Professional Image Enhancement</span>
                    <div className="ob-feature-badge free">
                      <Gift size={12} />
                      FREE
                    </div>
                  </button>
                  
                  <button className={`ob-feature-btn-new ${aiFeatures.includes('Advanced-analytics') ? 'active' : ''}`} onClick={() => toggleAiFeature('Advanced-analytics')}>
                    <input type="checkbox" checked={aiFeatures.includes('Advanced-analytics')} onChange={() => {}} />
                    <span>Advanced Sales Analytics & Insights</span>
                    <div className="ob-feature-badge paid">
                      <Star size={12} />
                      PRO
                    </div>
                  </button>
                  
                  <button className={`ob-feature-btn-new ${aiFeatures.includes('Bulk-operations') ? 'active' : ''}`} onClick={() => toggleAiFeature('Bulk-operations')}>
                    <input type="checkbox" checked={aiFeatures.includes('Bulk-operations')} onChange={() => {}} />
                    <span>Bulk Product Operations</span>
                    <div className="ob-feature-badge paid">
                      <Star size={12} />
                      PRO
                    </div>
                  </button>
                </div>
              </div>

              <div className="ob-buttons-row-new">
                <button className="ob-btn-secondary-new" onClick={handlePrev}>← Back</button>
                <button className="ob-btn-primary-new" disabled={!canGoNext[6]} onClick={handleFinish}>Create My Store! →</button>
              </div>
            </div>
          )}
        </div>

        <div className="ob-graphics-right-new">
          {step === 1 && (
            <div className="ob-demo-visual">
              <div className="ob-before-after">
                <div className="ob-demo-card">
                  <div className="ob-demo-label">Your Photo</div>
                  <div className="ob-flat-lay-demo">📱 📷</div>
                </div>
                <div className="ob-demo-magic">✨ AI Magic ✨</div>
                <div className="ob-demo-card">
                  <div className="ob-demo-label">AI Result</div>
                  <img src="/assets/model_female.png" alt="AI Generated" className="ob-model-preview" />
                </div>
              </div>
            </div>
          )}
          
          {step === 2 && <ShopGraphic storeName={storeName} currentStep={step} />}
          {step === 3 && <ShopGraphic storeName={storeName} currentStep={step} selectedCategories={categories} />}
          {step === 4 && <ScaleBoxes selectedScale={scale} />}
          {step === 5 && <BusinessHistory yearsInBusiness={yearsInBusiness} />}
          {step === 6 && <PersonGraphic />}
        </div>
      </div>

      <StepDots current={step} total={TOTAL_STEPS} />
    </div>
  );
}
