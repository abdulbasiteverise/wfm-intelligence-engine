/**
 * Gupta Trader — script.js
 * RO Service, Gaya, Bihar
 * All logic runs entirely in the browser. No backend required.
 */

(function () {
  'use strict';

  /* ============================================================
     1. HEADER — sticky scroll shadow
  ============================================================ */
  const header = document.getElementById('siteHeader');

  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  /* ============================================================
     2. MOBILE NAVIGATION TOGGLE
  ============================================================ */
  const menuToggle = document.getElementById('mobileMenuToggle');
  const nav        = document.getElementById('nav');

  if (menuToggle && nav) {
    menuToggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      // update aria for accessibility
      const isOpen = nav.classList.contains('open');
      menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close nav when any link is clicked
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close nav on outside click
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && !menuToggle.contains(e.target)) {
        nav.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ============================================================
     3. SERVICES ACCORDION
  ============================================================ */
  document.querySelectorAll('.service-title').forEach(function (title) {
    title.addEventListener('click', function () {
      const card    = title.closest('.service-card');
      const wasOpen = card.classList.contains('open');

      // Close all
      document.querySelectorAll('.service-card').forEach(function (c) {
        c.classList.remove('open');
      });

      // Re-open if it was closed
      if (!wasOpen) {
        card.classList.add('open');
      }
    });
  });

  /* ============================================================
     4. FAQ ACCORDION
  ============================================================ */
  document.querySelectorAll('.faq-question').forEach(function (question) {
    question.addEventListener('click', function () {
      const item    = question.closest('.faq-item');
      const wasOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-item').forEach(function (i) {
        i.classList.remove('open');
      });

      // Re-open if it was closed
      if (!wasOpen) {
        item.classList.add('open');
      }
    });
  });

  /* ============================================================
     5. PRODUCT BRAND FILTER
  ============================================================ */
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      // Update active state
      document.querySelectorAll('.filter-btn').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      document.querySelectorAll('.product-card').forEach(function (card) {
        if (filter === 'all' || card.dataset.brand === filter) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  /* ============================================================
     6. BOOKING FORM — build WhatsApp message & redirect
  ============================================================ */
  const bookingForm    = document.getElementById('bookingForm');
  const successMessage = document.getElementById('successMessage');

  if (bookingForm) {
    // Set today as the minimum selectable date
    const dateInput = document.getElementById('date');
    if (dateInput) {
      dateInput.min = new Date().toISOString().split('T')[0];
    }

    bookingForm.addEventListener('submit', function (e) {
      e.preventDefault();

      // Collect values
      const name    = (document.getElementById('name').value    || '').trim();
      const phone   = (document.getElementById('phone').value   || '').trim();
      const address = (document.getElementById('address').value || '').trim();
      const service = (document.getElementById('serviceType').value || '').trim();
      const date    = (document.getElementById('date').value    || '').trim();
      const time    = (document.getElementById('timeWindow').value || '').trim();
      const brand   = (document.getElementById('brand').value   || '').trim();
      const notes   = (document.getElementById('notes').value   || '').trim();

      // Build a structured WhatsApp message
      const lines = [
        '*New Service Request \u2014 Gupta Trader*',
        '',
        '\uD83D\uDC64 Name: '    + name,
        '\uD83D\uDCDE Phone: '   + phone,
        '\uD83D\uDCCD Address: ' + address,
        '\uD83D\uDD27 Service: ' + service,
        '\uD83D\uDCC5 Date: '    + date,
        '\u23F0 Time: '          + time,
        '\uD83C\uDFF7\uFE0F Brand/Model: ' + (brand || 'Not specified'),
        '\uD83D\uDCCB Notes: '   + (notes || 'None'),
      ];

      const message = encodeURIComponent(lines.join('\n'));
      const waURL   = 'https://wa.me/919852215570?text=' + message;

      // Show confirmation
      if (successMessage) {
        successMessage.style.display = 'block';
      }
      bookingForm.style.display = 'none';

      // Open WhatsApp after a short delay so user sees the confirmation
      setTimeout(function () {
        window.open(waURL, '_blank', 'noopener,noreferrer');
      }, 900);
    });
  }

  /* ============================================================
     7. SMOOTH SCROLL POLYFILL (for older browsers)
     Native CSS scroll-behavior handles modern browsers;
     this catches the rare edge-case without dependencies.
  ============================================================ */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();
