/* =============================================================================
   Aureon · public website (every page built from src/pages)
   Ported from the original AlphaBank main.js (loader, theme toggle, navbar,
   mobile nav, scroll reveal, counters, carousel, toasts, converter, card tilt,
   page fade) and extended for the multi-page site: live rates and fees, the
   loan calculator, the savings ring, the card freeze demo and help search.
   Every feature checks that its elements exist, so one script serves all pages.
   ============================================================================= */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var page = document.body.getAttribute('data-page') || '';
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  /* ---- Page loader: first page of a visit only ---- */
  (function () {
    var loader = $('#pageLoader'), bar = $('#loaderBar');
    if (!loader) return;
    var firstVisit = !store.get('aureon-visited');
    if (!firstVisit || reduceMotion) { loader.remove(); return; }
    store.set('aureon-visited', '1');
    var width = 0;
    var timer = setInterval(function () {
      width = Math.min(100, width + Math.random() * 15);
      if (bar) bar.style.width = width + '%';
      if (width >= 100) clearInterval(timer);
    }, 80);
    var hide = function () {
      loader.style.opacity = '0';
      setTimeout(function () { loader.remove(); }, 500);
      if (page === 'index') setTimeout(function () { showToast('Welcome to Aureon! 🚀', 'success'); }, 700);
    };
    if (document.readyState === 'complete') setTimeout(hide, 900);
    else window.addEventListener('load', function () { setTimeout(hide, 900); });
  })();

  /* ---- Theme toggle (shares the 'aureon-theme' setting with every page) ---- */
  var themeToggle = $('#themeToggle'), themeThumb = $('#themeThumb');
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('aureon-theme', theme); } catch (e) { /* storage blocked */ }
    if (themeToggle) { themeToggle.classList.toggle('dark', theme === 'dark'); themeToggle.setAttribute('aria-pressed', String(theme === 'dark')); }
    if (themeThumb) themeThumb.textContent = theme === 'dark' ? '🌙' : '☀️';
  }
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  if (themeToggle) {
    var flip = function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
    themeToggle.addEventListener('click', flip);
    themeToggle.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  }

  /* ---- Navbar ---- */
  var navbar = $('#navbar');
  var onScroll = function () { if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 50); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var hamburger = $('#hamburger'), mobileNav = $('#mobileNav'), mobileNavClose = $('#mobileNavClose');
  function setMobileNav(open) {
    if (!mobileNav) return;
    mobileNav.classList.toggle('open', open);
    mobileNav.classList.toggle('active', open);
    if (hamburger) hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (hamburger && mobileNav) {
    hamburger.setAttribute('aria-controls', 'mobileNav');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.addEventListener('click', function () { setMobileNav(!mobileNav.classList.contains('open')); });
    $$('a', mobileNav).forEach(function (a) { a.addEventListener('click', function () { setMobileNav(false); }); });
  }
  if (mobileNavClose) mobileNavClose.addEventListener('click', function () { setMobileNav(false); });
  window.addEventListener('resize', function () { if (window.innerWidth > 768) setMobileNav(false); });

  var dropdown = $('.nav-dropdown'), dropdownToggle = $('.nav-dropdown-toggle');
  if (dropdown && dropdownToggle) {
    dropdownToggle.setAttribute('aria-expanded', 'false');
    if ($('[aria-current="page"]', dropdown)) dropdownToggle.classList.add('is-current');
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
    // Safety net for very fast scrolling: once scrolling settles, reveal anything already on screen.
    var settle;
    window.addEventListener('scroll', function () {
      clearTimeout(settle);
      settle = setTimeout(function () {
        revealEls.forEach(function (el) {
          if (el.classList.contains('active')) return;
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) { el.classList.add('active'); revealObserver.unobserve(el); }
        });
      }, 150);
    }, { passive: true });
  } else {
    revealEls.forEach(function (el) { el.classList.add('active'); });
  }
  var whenVisible = function (el, fn, threshold) {
    if (!('IntersectionObserver' in window)) return fn();
    var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { fn(); io.disconnect(); } }, { threshold: threshold || 0.4 });
    io.observe(el);
  };

  /* ---- Animated counters ---- */
  $$('[data-target]').forEach(function (el) {
    whenVisible(el, function () {
      var target = parseFloat(el.getAttribute('data-target')) || 0;
      var suffix = el.getAttribute('data-suffix') || '', prefix = el.getAttribute('data-prefix') || '';
      if (reduceMotion) { el.textContent = prefix + target + suffix; return; }
      var start = performance.now();
      (function tick(now) {
        var p = Math.min((now - start) / 2000, 1);
        el.textContent = prefix + Math.floor((1 - Math.pow(1 - p, 4)) * target).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(start);
    }, 0.5);
  });

  /* ---- Carousel ---- */
  var track = $('#testimonialTrack'), dotsBox = $('#carouselDots');
  if (track) {
    var cards = track.querySelectorAll('.testimonial-card');
    var current = 0, timer;
    var perView = function () { return window.innerWidth < 600 ? 1 : window.innerWidth < 900 ? 2 : 3; };
    var total = function () { return Math.max(1, cards.length - perView() + 1); };
    var goTo = function (i) {
      current = Math.max(0, Math.min(i, total() - 1));
      track.style.transform = 'translateX(-' + current * (cards[0].offsetWidth + 24) + 'px)';
      if (dotsBox) Array.prototype.forEach.call(dotsBox.children, function (d, n) { d.classList.toggle('active', n === current); });
    };
    var restart = function () {
      clearInterval(timer);
      if (!reduceMotion) timer = setInterval(function () { goTo(current + 1 < total() ? current + 1 : 0); }, 5000);
    };
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
    var prev = $('#prevBtn'), next = $('#nextBtn');
    if (prev) prev.addEventListener('click', function () { goTo(current - 1); restart(); });
    if (next) next.addEventListener('click', function () { goTo(current + 1); restart(); });
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

  /* ---- Live data: rates, settings, session ---- */
  var rates = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, NGN: 1550 };
  var names = { USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', CAD: 'Canadian Dollar', NGN: 'Nigerian Naira' };
  var symbols = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', NGN: '₦' };
  var settings = { internal_fee_pct: 0, external_fee_pct: 0.005, external_fee_min: 1, review_threshold: 10000, daily_limit: 50000, savings_apr: 0.04, loan_apr: 0.12, max_loan: 50000, base_currency: 'USD', support_email: '' };

  var money = function (v, cur, noCents) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: noCents ? 0 : 2, maximumFractionDigits: noCents ? 0 : 2 }).format(v);
    } catch (e) { return (cur || '') + ' ' + Number(v).toFixed(noCents ? 0 : 2); }
  };
  var pct = function (v) { return (Number(v) * 100).toFixed(2) + '%'; };
  var setText = function (sel, v) { $$(sel).forEach(function (el) { el.textContent = v; }); };

  function renderFacts() {
    var cur = settings.base_currency || 'USD';
    var internal = Number(settings.internal_fee_pct) === 0 ? 'Free' : pct(settings.internal_fee_pct);
    setText('[data-fact="currencies"]', String(Object.keys(rates).length));
    setText('[data-fact="internal"]', internal);
    setText('[data-fact="savings"]', pct(settings.savings_apr));
    setText('[data-fact="loan"]', pct(settings.loan_apr));
    setText('[data-fee="internal"]', internal);
    setText('[data-fee="external"]', pct(settings.external_fee_pct) + ' (min ' + money(settings.external_fee_min, cur) + ')');
    setText('[data-fee="review"]', money(settings.review_threshold, cur, true));
    setText('[data-fee="limit"]', money(settings.daily_limit, cur, true));
    setText('[data-fee="maxloan"]', money(settings.max_loan, cur, true));
  }

  // converter (home strip and rates page)
  var from = $('#fromCurrency'), to = $('#toCurrency'), amount = $('#currencyInput');
  function fillSelects() {
    if (!from || !to) return;
    var keep = [from.value || 'USD', to.value || 'EUR'];
    var opts = Object.keys(rates).map(function (c) { return '<option value="' + c + '">' + c + ' · ' + (names[c] || c) + '</option>'; }).join('');
    from.innerHTML = opts; to.innerHTML = opts;
    from.value = rates[keep[0]] ? keep[0] : 'USD';
    to.value = rates[keep[1]] ? keep[1] : 'EUR';
  }
  function convert() {
    if (!from || !to || !amount) return;
    var a = Math.max(0, parseFloat(amount.value) || 0);
    var r = a / rates[from.value] * rates[to.value];
    var out = $('#convertedAmount');
    if (out) out.textContent = r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + to.value;
    var rate = $('#convRate');
    if (rate) rate.textContent = '1 ' + from.value + ' = ' + (rates[to.value] / rates[from.value]).toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + to.value;
  }
  if (from && to && amount) {
    [from, to].forEach(function (el) { el.addEventListener('change', convert); });
    amount.addEventListener('input', convert);
    var cb = $('#convertBtn'); if (cb) cb.addEventListener('click', convert);
    var sb = $('#swapBtn'); if (sb) sb.addEventListener('click', function () { var f = from.value; from.value = to.value; to.value = f; convert(); });
  }

  // rates table (rates page)
  function renderRatesTable() {
    var body = $('#ratesTable');
    if (!body) return;
    body.innerHTML = Object.keys(rates).map(function (c) {
      var per = rates[c];
      return '<tr><td><span class="tbl-flag">' + (symbols[c] || c.slice(0, 1)) + '</span><b>' + c + '</b> <small>' + (names[c] || '') + '</small></td>' +
        '<td class="num">' + per.toLocaleString(undefined, { minimumFractionDigits: per >= 100 ? 2 : 4, maximumFractionDigits: per >= 100 ? 2 : 4 }) + '</td>' +
        '<td class="num">' + (1 / per).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 }) + '</td></tr>';
    }).join('');
  }

  // loan calculator (savings & loans page)
  var loanAmount = $('#loanAmount'), term = 12;
  function renderLoan() {
    if (!loanAmount) return;
    var cur = settings.base_currency || 'USD';
    loanAmount.max = String(settings.max_loan || 50000);
    if (Number(loanAmount.value) > Number(loanAmount.max)) loanAmount.value = loanAmount.max;
    var P = Number(loanAmount.value), r = Number(settings.loan_apr) / 12;
    var pmt = r === 0 ? P / term : P * r / (1 - Math.pow(1 + r, -term));
    setText('#loanAmountOut', money(P, cur, true));
    setText('#loanMonthly', money(pmt, cur));
    setText('#loanTotal', money(pmt * term, cur));
    loanAmount.setAttribute('aria-valuetext', money(P, cur, true));
    loanAmount.style.setProperty('--fill', ((P - loanAmount.min) / (loanAmount.max - loanAmount.min) * 100) + '%');
  }
  if (loanAmount) {
    loanAmount.addEventListener('input', renderLoan);
    $$('#termChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        term = Number(b.getAttribute('data-term'));
        $$('#termChips button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderLoan();
      });
    });
  }

  function renderSupport() {
    var card = $('#emailContact'), link = $('#supportEmailLink');
    if (card && link && settings.support_email) {
      link.href = 'mailto:' + settings.support_email;
      link.textContent = settings.support_email;
      card.hidden = false;
    }
  }

  function renderAll() { fillSelects(); convert(); renderFacts(); renderRatesTable(); renderLoan(); renderSupport(); }
  renderAll();

  if (window.A && A.sb) {
    Promise.all([
      A.sb.from('fx_rates').select('currency,name,per_usd,updated_at'),
      A.sb.from('settings').select('*').eq('id', 1).maybeSingle()
    ]).then(function (res) {
      var fx = res[0], st = res[1];
      if (!fx.error && fx.data && fx.data.length) {
        rates = {};
        var latest = 0;
        fx.data.forEach(function (r) { rates[r.currency] = Number(r.per_usd); names[r.currency] = r.name; latest = Math.max(latest, new Date(r.updated_at).getTime() || 0); });
        if (latest) setText('#ratesUpdated', 'Live rates · updated ' + new Date(latest).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
      }
      if (!st.error && st.data) settings = st.data;
      renderAll();
    }).catch(function () { /* offline: keep standard figures */ });

    A.getSession().then(function (s) {
      if (!s) return;
      $$('[data-auth="out"]').forEach(function (el) { el.hidden = true; });
      $$('[data-auth="in"]').forEach(function (el) { el.hidden = false; });
    }).catch(function () {});
  }

  /* ---- Savings ring ---- */
  var ring = $('#goalRing');
  if (ring) whenVisible(ring, function () { ring.querySelector('.ring-bar').style.strokeDashoffset = String(314.16 * (1 - 0.72)); });

  /* ---- Card freeze demo ---- */
  var freeze = $('#freezeDemo'), demoCard = $('#demoCard');
  if (freeze && demoCard) freeze.addEventListener('change', function () {
    demoCard.classList.toggle('frozen', freeze.checked);
    showToast(freeze.checked ? 'Card frozen. Payments are blocked.' : 'Card unfrozen. You are good to go.', freeze.checked ? 'info' : 'success');
  });

  /* ---- Help search ---- */
  var search = $('#faqSearch');
  if (search) {
    var empty = $('#faqEmpty');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      $$('.faq-group').forEach(function (g) {
        var any = 0;
        $$('details', g).forEach(function (d) {
          var hit = !q || d.textContent.toLowerCase().indexOf(q) !== -1;
          d.hidden = !hit;
          if (hit) any++;
          if (q && hit) d.open = true;
        });
        g.hidden = !any;
        shown += any;
      });
      if (empty) empty.hidden = shown > 0;
    });
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
  $$('a[href]').forEach(function (link) {
    var href = link.getAttribute('href');
    if (!/^[\w-]+\.html(#.*)?$/.test(href)) return;
    link.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      var samePage = href.split('#')[0] === (location.pathname.split('/').pop() || 'index.html');
      if (samePage) return;
      e.preventDefault();
      document.body.style.opacity = '0';
      setTimeout(function () { window.location.href = href; }, 250);
    });
  });
  window.addEventListener('pageshow', function () { document.body.style.opacity = '1'; });

  var year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
