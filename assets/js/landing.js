/* =============================================================================
   Aureon · landing page
   Ported from the original AlphaBank main.js (loader, theme toggle, navbar,
   mobile nav, scroll reveal, counters, carousel, toasts, converter, card tilt,
   page fade) and wired to Aureon's live rates, fees and session.
   ============================================================================= */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Page loader ---- */
  (function () {
    var loader = $('#pageLoader'), bar = $('#loaderBar');
    if (!loader) return;
    var width = 0;
    var timer = setInterval(function () {
      width = Math.min(100, width + Math.random() * 15);
      if (bar) bar.style.width = width + '%';
      if (width >= 100) clearInterval(timer);
    }, 80);
    var hide = function () {
      loader.style.opacity = '0';
      setTimeout(function () { loader.style.display = 'none'; }, 500);
      setTimeout(function () { showToast('Welcome to Aureon! 🚀', 'success'); }, 700);
    };
    if (document.readyState === 'complete') setTimeout(hide, 900);
    else window.addEventListener('load', function () { setTimeout(hide, 900); });
  })();

  /* ---- Theme toggle (shares the 'aureon-theme' setting with every page) ---- */
  var themeToggle = $('#themeToggle'), themeThumb = $('#themeThumb');
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('aureon-theme', theme); } catch (e) { /* storage blocked */ }
    if (themeToggle) themeToggle.classList.toggle('dark', theme === 'dark');
    if (themeThumb) themeThumb.textContent = theme === 'dark' ? '🌙' : '☀️';
  }
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  if (themeToggle) {
    var flip = function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
    themeToggle.addEventListener('click', flip);
    themeToggle.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  }

  /* ---- Navbar scroll ---- */
  var navbar = $('#navbar');
  var onScroll = function () { if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 50); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- Mobile nav ---- */
  var hamburger = $('#hamburger'), mobileNav = $('#mobileNav'), mobileNavClose = $('#mobileNavClose');
  function setMobileNav(open) {
    if (!mobileNav) return;
    mobileNav.classList.toggle('open', open);
    mobileNav.classList.toggle('active', open);
    if (hamburger) hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (hamburger) {
    hamburger.setAttribute('aria-controls', 'mobileNav');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.addEventListener('click', function () { setMobileNav(!mobileNav.classList.contains('open')); });
  }
  if (mobileNavClose) mobileNavClose.addEventListener('click', function () { setMobileNav(false); });
  if (mobileNav) $$('#mobileNav a').forEach(function (a) { a.addEventListener('click', function () { setMobileNav(false); }); });
  window.addEventListener('resize', function () { if (window.innerWidth > 768) setMobileNav(false); });

  /* ---- "Online Banking" dropdown ---- */
  var dropdown = $('.nav-dropdown'), dropdownToggle = $('.nav-dropdown-toggle');
  if (dropdown && dropdownToggle) {
    dropdownToggle.setAttribute('aria-expanded', 'false');
    dropdownToggle.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      dropdownToggle.setAttribute('aria-expanded', dropdown.classList.toggle('open') ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target)) { dropdown.classList.remove('open'); dropdownToggle.setAttribute('aria-expanded', 'false'); }
    });
  }
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    setMobileNav(false);
    if (dropdown) dropdown.classList.remove('open');
  });

  /* ---- Scroll reveal ---- */
  var revealEls = $$('.reveal, .reveal-left, .reveal-right');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('active'); revealObserver.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('active'); });
  }

  /* ---- Animated counters ---- */
  function animateCounter(el) {
    var target = parseFloat(el.getAttribute('data-target')) || 0;
    var suffix = el.getAttribute('data-suffix') || '', prefix = el.getAttribute('data-prefix') || '';
    if (reduceMotion) { el.textContent = prefix + target + suffix; return; }
    var start = performance.now(), duration = 2000;
    (function tick(now) {
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 4);
      el.textContent = prefix + Math.floor(eased * target).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }
  var counters = $$('[data-target]');
  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { animateCounter(en.target); counterObserver.unobserve(en.target); }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (c) { counterObserver.observe(c); });
  } else counters.forEach(animateCounter);

  /* ---- Carousel ---- */
  var track = $('#testimonialTrack'), dotsBox = $('#carouselDots');
  if (track) {
    var cards = track.querySelectorAll('.testimonial-card');
    var current = 0, timer;
    var perView = function () { return window.innerWidth < 600 ? 1 : window.innerWidth < 900 ? 2 : 3; };
    var total = function () { return Math.max(1, cards.length - perView() + 1); };
    var drawDots = function () {
      if (!dotsBox) return;
      dotsBox.innerHTML = '';
      for (var i = 0; i < total(); i++) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'carousel-dot' + (i === current ? ' active' : '');
        d.setAttribute('aria-label', 'Show slide ' + (i + 1));
        d.addEventListener('click', (function (n) { return function () { goTo(n); restart(); }; })(i));
        dotsBox.appendChild(d);
      }
    };
    var goTo = function (i) {
      current = Math.max(0, Math.min(i, total() - 1));
      track.style.transform = 'translateX(-' + current * (cards[0].offsetWidth + 24) + 'px)';
      if (dotsBox) Array.prototype.forEach.call(dotsBox.children, function (d, n) { d.classList.toggle('active', n === current); });
    };
    var restart = function () {
      clearInterval(timer);
      if (!reduceMotion) timer = setInterval(function () { goTo(current + 1 < total() ? current + 1 : 0); }, 5000);
    };
    $('#prevBtn').addEventListener('click', function () { goTo(current - 1); restart(); });
    $('#nextBtn').addEventListener('click', function () { goTo(current + 1); restart(); });
    var touchX = 0;
    track.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend', function (e) {
      var diff = touchX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
      restart();
    }, { passive: true });
    window.addEventListener('resize', function () { drawDots(); goTo(Math.min(current, total() - 1)); });
    drawDots();
    restart();
  }

  /* ---- Toasts ---- */
  function showToast(message, type) {
    var box = $('#toastContainer');
    if (!box) return;
    var icons = { success: '✅', error: '❌', info: 'ℹ️' };
    var t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.setAttribute('role', 'status');
    var ic = document.createElement('span'); ic.className = 'toast-icon'; ic.textContent = icons[type] || icons.info;
    var msg = document.createElement('span'); msg.className = 'toast-msg'; msg.textContent = message;
    t.appendChild(ic); t.appendChild(msg);
    box.appendChild(t);
    setTimeout(function () { t.classList.add('removing'); setTimeout(function () { t.remove(); }, 300); }, 3500);
  }
  window.showToast = showToast;

  /* ---- Live rates, fees and the converter ---- */
  var rates = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, NGN: 1550 };
  var flags = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', CAD: '🇨🇦', NGN: '🇳🇬' };
  var settings = { internal_fee_pct: 0, savings_apr: 0.04, loan_apr: 0.12 };
  var from = $('#fromCurrency'), to = $('#toCurrency'), amount = $('#currencyInput');

  function fillSelects() {
    var keep = [from.value || 'USD', to.value || 'EUR'];
    var opts = Object.keys(rates).map(function (c) { return '<option value="' + c + '">' + (flags[c] || '') + ' ' + c + '</option>'; }).join('');
    from.innerHTML = opts; to.innerHTML = opts;
    from.value = rates[keep[0]] ? keep[0] : 'USD';
    to.value = rates[keep[1]] ? keep[1] : 'EUR';
  }
  function convert() {
    var a = parseFloat(amount.value) || 0;
    var r = a / rates[from.value] * rates[to.value];
    $('#convertedAmount').textContent = r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + to.value;
  }
  function pct(v) { return (Number(v) * 100).toFixed(2) + '%'; }
  function renderFacts() {
    var set = function (sel, v) { $$(sel).forEach(function (el) { el.textContent = v; }); };
    set('[data-fact="currencies"]', String(Object.keys(rates).length));
    set('[data-fact="internal"]', Number(settings.internal_fee_pct) === 0 ? 'Free' : pct(settings.internal_fee_pct));
    set('[data-fact="savings"]', pct(settings.savings_apr));
    set('[data-fact="loan"]', pct(settings.loan_apr));
  }
  fillSelects(); convert(); renderFacts();
  [from, to].forEach(function (el) { el.addEventListener('change', convert); });
  amount.addEventListener('input', convert);
  $('#convertBtn').addEventListener('click', convert);
  $('#swapBtn').addEventListener('click', function () { var f = from.value; from.value = to.value; to.value = f; convert(); });

  if (window.A && A.sb) {
    Promise.all([
      A.sb.from('fx_rates').select('currency,per_usd'),
      A.sb.from('settings').select('*').eq('id', 1).maybeSingle()
    ]).then(function (res) {
      if (!res[0].error && res[0].data && res[0].data.length) {
        rates = {}; res[0].data.forEach(function (r) { rates[r.currency] = Number(r.per_usd); });
      }
      if (!res[1].error && res[1].data) settings = res[1].data;
      fillSelects(); convert(); renderFacts();
    }).catch(function () { /* offline: keep fallbacks */ });

    A.getSession().then(function (s) {
      if (!s) return;
      $$('[data-auth="out"]').forEach(function (el) { el.hidden = true; });
      $$('[data-auth="in"]').forEach(function (el) { el.hidden = false; });
    }).catch(function () {});
  }

  /* ---- Card 3D tilt ---- */
  var scene = $('.card-3d-scene');
  if (scene && !reduceMotion) {
    var main = scene.querySelector('.card-main');
    scene.addEventListener('mousemove', function (e) {
      var r = scene.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      if (main) main.style.transform = 'translateY(' + (y * -20) + 'px) rotate(' + (x * 8 - 3) + 'deg)';
    });
    scene.addEventListener('mouseleave', function () { if (main) main.style.transform = ''; });
  }

  /* ---- Smooth fade between pages ---- */
  document.body.style.transition = 'opacity 0.3s ease';
  document.body.style.opacity = '1';
  $$('a[href$=".html"], a[href*=".html#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = link.getAttribute('href');
      if (!href || /^https?:/.test(href) || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      document.body.style.opacity = '0';
      setTimeout(function () { window.location.href = href; }, 300);
    });
  });
  window.addEventListener('pageshow', function () { document.body.style.opacity = '1'; });

  var year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
