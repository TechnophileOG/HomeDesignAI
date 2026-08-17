import React, { useState, useEffect } from 'react';
import { Sparkles, Award, TrendingUp } from 'lucide-react';

/* Default slides — shown only until the admin publishes real banners
   (server-driven content replaces them; there is no hardcoded demo UI). */
const DEFAULT_SLIDES = [
  {
    id: 'default-1',
    title: 'AI Marketing Boost',
    subtitle: 'Instantly generate WhatsApp & Insta posts for your products wearing premium models.',
    badge: 'PROMO CREATOR',
    theme: 1,
    ctaText: '',
    ctaUrl: '',
  },
  {
    id: 'default-2',
    title: 'Zero Studio Cost',
    subtitle: 'No model hiring. No professional camera setup. No studio charges. Upload your photo and go online.',
    badge: 'COST SAVINGS',
    theme: 2,
    ctaText: '',
    ctaUrl: '',
  },
  {
    id: 'default-3',
    title: 'Model-Fit Listings',
    subtitle: 'Your products photographed on AI models — ready for your customers, marketplaces and social posts.',
    badge: 'AI PHOTOSHOOTS',
    theme: 3,
    ctaText: '',
    ctaUrl: '',
  },
];

const THEME_ICONS = {
  1: <Sparkles size={16} style={{ color: 'var(--c-accent)' }} />,
  2: <Award size={16} style={{ color: 'var(--c-peach-dark)' }} />,
  3: <TrendingUp size={16} style={{ color: '#2a9d8f' }} />,
};

export default function BannerCarousel({ banners = [] }) {
  const slides = banners.length > 0 ? banners : DEFAULT_SLIDES;
  const [currentSlide, setCurrentSlide] = useState(0);
  const count = slides.length;

  // If the slide list changes (admin publishes), never drift out of range.
  useEffect(() => {
    if (currentSlide >= count) setCurrentSlide(0);
  }, [count, currentSlide]);

  const handlePrev = (e) => {
    e.stopPropagation();
    setCurrentSlide((prev) => (prev === 0 ? count - 1 : prev - 1));
  };
  const handleNext = (e) => {
    e.stopPropagation();
    setCurrentSlide((prev) => (prev === count - 1 ? 0 : prev + 1));
  };

  // Auto slide every 10 seconds (only when there's more than one slide)
  useEffect(() => {
    if (count <= 1) return undefined;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev === count - 1 ? 0 : prev + 1));
    }, 10000);
    return () => clearInterval(timer);
  }, [count]);

  return (
    <div className="carousel-wrapper">
      {count > 1 && (
        <>
          <button className="carousel-btn prev" onClick={handlePrev} aria-label="Previous slide">
            ‹
          </button>
          <button className="carousel-btn next" onClick={handleNext} aria-label="Next slide">
            ›
          </button>
        </>
      )}

      <div
        className="carousel-track"
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        {slides.map((slide) => {
          const href = slide.ctaUrl && (slide.ctaUrl.startsWith('http') || slide.ctaUrl.startsWith('/'))
            ? slide.ctaUrl
            : null;
          const content = (
            <>
              <div className="slide-content">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  {THEME_ICONS[slide.theme] || THEME_ICONS[1]}
                  <span className="slide-pill-badge" style={{ margin: 0 }}>{slide.badge || 'KATALOGITAI'}</span>
                </div>
                <h4>{slide.title}</h4>
                <p>{slide.subtitle}</p>
                {slide.ctaText && href && (
                  <span className="slide-cta">{slide.ctaText} →</span>
                )}
              </div>
              <div className="slide-visuals">
                <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.7 }}>
                  Powered by KatalogitAI Model v2
                </span>
              </div>
            </>
          );
          return href ? (
            <a
              key={slide.id}
              className={`carousel-slide ${slide.bgClass || `slide-bg-${slide.theme || 1}`}`}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {content}
            </a>
          ) : (
            <div key={slide.id} className={`carousel-slide ${slide.bgClass || `slide-bg-${slide.theme || 1}`}`}>
              {content}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <div className="carousel-dots">
          {slides.map((_, idx) => (
            <div
              key={idx}
              className={`carousel-dot ${currentSlide === idx ? 'active' : ''}`}
              onClick={() => setCurrentSlide(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
