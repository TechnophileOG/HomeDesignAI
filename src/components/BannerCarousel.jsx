import React, { useState, useEffect } from 'react';
import { Sparkles, Award, TrendingUp } from 'lucide-react';

const SLIDES = [
  {
    id: 1,
    title: 'AI Marketing Boost',
    desc: 'Instantly generate WhatsApp & Insta posts for your products wearing premium models.',
    badge: 'PROMO CREATOR',
    bgClass: 'slide-bg-1',
    icon: <Sparkles size={16} style={{ color: 'var(--c-accent)' }} />
  },
  {
    id: 2,
    title: 'Zero Studio Cost',
    desc: 'No model hiring. No professional camera setup. No studio charges. Upload your photo and go online.',
    badge: 'COST SAVINGS',
    bgClass: 'slide-bg-2',
    icon: <Award size={16} style={{ color: 'var(--c-peach-dark)' }} />
  },
  {
    id: 3,
    title: 'Model-Fit Listings',
    desc: 'Your products photographed on AI models — ready for your customers, marketplaces and social posts.',
    badge: 'AI PHOTOSHOOTS',
    bgClass: 'slide-bg-3',
    icon: <TrendingUp size={16} style={{ color: '#2a9d8f' }} />
  }
];

export default function BannerCarousel() {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handlePrev = (e) => {
    e.stopPropagation();
    setCurrentSlide((prev) => (prev === 0 ? SLIDES.length - 1 : prev - 1));
  };

  const handleNext = (e) => {
    e.stopPropagation();
    setCurrentSlide((prev) => (prev === SLIDES.length - 1 ? 0 : prev + 1));
  };

  // Auto slide every 10 seconds (slower, easier to read)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev === SLIDES.length - 1 ? 0 : prev + 1));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="carousel-wrapper">
      {/* Navigation — minimal side arrows */}
      <button className="carousel-btn prev" onClick={handlePrev} aria-label="Previous slide">
        ‹
      </button>
      <button className="carousel-btn next" onClick={handleNext} aria-label="Next slide">
        ›
      </button>

      {/* Slide Track */}
      <div 
        className="carousel-track" 
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        {SLIDES.map((slide) => (
          <div key={slide.id} className={`carousel-slide ${slide.bgClass}`}>
            <div className="slide-content">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                {slide.icon}
                <span className="slide-pill-badge" style={{ margin: 0 }}>{slide.badge}</span>
              </div>
              <h4>{slide.title}</h4>
              <p>{slide.desc}</p>
            </div>
            <div className="slide-visuals">
              <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.7 }}>
                Powered by KatalogitAI Model v2
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Indicator Dots */}
      <div className="carousel-dots">
        {SLIDES.map((_, idx) => (
          <div 
            key={idx} 
            className={`carousel-dot ${currentSlide === idx ? 'active' : ''}`}
            onClick={() => setCurrentSlide(idx)}
          />
        ))}
      </div>
    </div>
  );
}
