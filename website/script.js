/* ============================================
   KatalogitAI — New Natural Design JavaScript
   ============================================ */

'use strict';

// ============================================
// Preloader with Camera Snap Animation
// ============================================

(function initPreloader() {
  const preloader = document.getElementById('preloader');

  if (!preloader) return;

  // Hide preloader after 1.5 seconds
  setTimeout(() => {
    preloader.classList.add('hidden');
  }, 1800);
})();

// ============================================
// Hero Typing Animation
// ============================================

(function initHeroTyping() {
  const typingEl = document.getElementById('heroTyping');
  const brandEl = document.getElementById('heroBrand');

  if (!typingEl) return;

  const phrases = [
    "One click is all it takes",
    "Professional photos in hours",
    "From ₹15 per product",
    "No studio needed",
    "Ready the same day",
    "AI does it all for you",
    "8 catalog-ready poses per product",
    "Amazon to Meesho ready",
    "Your shop deserves better"
  ];

  let currentPhrase = 0;
  let charIndex = 0;
  let isDeleting = false;
  let typingSpeed = 150; // Slower typing

  function type() {
    const fullText = phrases[currentPhrase];

    if (isDeleting) {
      typingEl.textContent = fullText.substring(0, charIndex - 1);
      charIndex--;
      typingSpeed = 80; // Slower delete
    } else {
      typingEl.textContent = fullText.substring(0, charIndex + 1);
      charIndex++;
      typingSpeed = 150; // Slower type
    }

    // When phrase is complete
    if (!isDeleting && charIndex === fullText.length) {
      typingSpeed = 1800; // Pause at end
      isDeleting = true;

      // Show brand name BELOW
      if (brandEl) {
        brandEl.classList.add('show');
      }
    }
    // When deletion is complete
    else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      currentPhrase = (currentPhrase + 1) % phrases.length;
      typingSpeed = 600; // Pause before next

      // Hide brand name
      if (brandEl) {
        brandEl.classList.remove('show');
      }
    }

    setTimeout(type, typingSpeed);
  }

  // Start typing after preloader
  setTimeout(() => {
    type();
  }, 1900);
})();


// ============================================
// Navbar Scroll Effect
// ============================================

(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  function onScroll() {
    if (window.scrollY > 40) {
      navbar.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)';
    } else {
      navbar.style.boxShadow = '0 2px 10px rgba(0,0,0,0.03)';
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// ============================================
// Mobile Navigation
// ============================================

(function initMobileNav() {
  const hamburger = document.getElementById('navHamburger');
  const mobileNav = document.getElementById('navMobile');

  if (!hamburger || !mobileNav) return;

  let isOpen = false;

  hamburger.addEventListener('click', () => {
    isOpen = !isOpen;
    mobileNav.classList.toggle('open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  // Close on link click
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      isOpen = false;
      mobileNav.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
})();

// ============================================
// Contact Form Submission (real API — leads land in the backend)
// ============================================

(function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('.btn-submit');
    const originalText = submitBtn.textContent;

    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;

    // Collect form data
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    // ── Sanitize + validate every field before it goes anywhere ──
    const cleanControl = (s) => {
      let out = '';
      for (const ch of String(s ?? '')) {
        const c = ch.codePointAt(0);
        if ((c >= 0 && c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127) out += ' ';
        else if (c === 0x200B || c === 0x200C || c === 0x200D || c === 0x2060 || c === 0xFEFF) out += '';
        else if (c >= 0x202A && c <= 0x202E) out += '';
        else out += ch;
      }
      return out;
    };
    const sanitizeText = (s, max = 120) =>
      cleanControl(s)
        .replace(/<[^>]*>/g, ' ')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim()
        .slice(0, max);
    const sanitizePhone = (s) => String(s ?? '').replace(/[^0-9+]/g, '').slice(0, 15);
    const sanitizeEmail = (s) => {
      const e = String(s ?? '').trim().toLowerCase().slice(0, 120);
      return /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e) ? e : '';
    };

    const clean = {
      name: sanitizeText(data.name, 80),
      phone: sanitizePhone(data.phone),
      email: sanitizeEmail(data.email),
      products: sanitizeText(data.products, 40),
      platform: sanitizeText(data.platform, 30),
    };

    if (clean.name.length < 2 || clean.phone.length < 10 || !clean.email) {
      submitBtn.textContent = '⚠ Please check your details';
      submitBtn.style.background = '#D32F2F';
      setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.style.background = '';
        submitBtn.disabled = false;
      }, 3000);
      return;
    }

    try {
      // Real endpoint — the backend (Cloud Run) stores the lead in Firestore
      // and surfaces it in the admin console. No more fake "Message Sent!".
      const API_BASE = 'https://katalogit-api-787935596465.asia-south1.run.app/api/v1';
      const res = await fetch(API_BASE + '/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clean.name,
          phone: clean.phone,
          email: clean.email,
          products: clean.products,
          platform: clean.platform,
          // honeypot fields — the backend drops any submission that fills them
          website: data.website || '',
          company: data.company || '',
          url: data.url || '',
        }),
      });

      if (!res.ok) throw new Error('lead rejected');

      // Success
      submitBtn.textContent = '✓ Details received!';
      submitBtn.style.background = '#48BB78';
      form.reset();
      alert('Thanks! We\u2019ve received your details and will reach out shortly.');

      setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.style.background = '';
        submitBtn.disabled = false;
      }, 3000);

    } catch {
      submitBtn.textContent = '❌ Could not send. Please call/WhatsApp us.';
      submitBtn.style.background = '#D32F2F';

      setTimeout(() => {
        submitBtn.textContent = originalText;
        submitBtn.style.background = '';
        submitBtn.disabled = false;
      }, 3000);
    }
  });
})();

// ============================================
// Smooth Scroll for Anchor Links
// ============================================

(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
})();

// ============================================
// Fade-in on Scroll (Intersection Observer)
// ============================================

(function initScrollAnimations() {
  const animatedElements = document.querySelectorAll(
    '.comparison-card, .value-card, .pipeline-step, .pricing-card, ' +
    '.brand-item, .contact-box, .section-heading, .section-sub'
  );

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-in');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  animatedElements.forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });
})();

// ============================================
// Active Nav Link Highlight
// ============================================

(function initActiveNavLink() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  if (navLinks.length === 0) return;

  function setActiveLink() {
    const scrollPos = window.scrollY + 120;

    let currentSection = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;

      if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
        currentSection = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === `#${currentSection}`) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  window.addEventListener('scroll', setActiveLink, { passive: true });
  setActiveLink();
})();

// ============================================
// Page Load Complete
// ============================================

console.log('🚀 KatalogitAI website loaded successfully!');
