/* Aureon landing page */
(function () {
  'use strict';
  var $ = A.$, $$ = A.$$;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fallbacks used until (or if) live data loads.
  var rates = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, NGN: 1550 };
  var names = { USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', CAD: 'Canadian Dollar', NGN: 'Nigerian Naira' };
  var settings = { internal_fee_pct: 0, external_fee_pct: 0.005, external_fee_min: 1, savings_apr: 0.04, loan_apr: 0.12, daily_limit: 50000, max_loan: 50000, base_currency: 'USD' };

  /* ---------- nav ---------- */
  var nav = $('#nav');
  var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 24); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  var menu = $('#mobileMenu'), menuBtn = $('#menuBtn');
  var setMenu = function (open) {
    menu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  menuBtn.addEventListener('click', function () { setMenu(true); });
  $('#menuClose').addEventListener('click', function () { setMenu(false); });
  A.on(menu, 'click', 'a', function () { setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  /* ---------- reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.reveal, .tile').forEach(function (el) { io.observe(el); });
  } else {
    $$('.reveal, .tile').forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- hero card tilt ---------- */
  var visual = $('#heroVisual'), card = $('#tiltCard');
  if (visual && card && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    var raf;
    visual.addEventListener('pointermove', function (e) {
      var r = visual.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        card.style.transform = 'rotateX(' + (10 - y * 18).toFixed(2) + 'deg) rotateY(' + (-14 + x * 26).toFixed(2) + 'deg) rotateZ(3deg)';
      });
    });
    visual.addEventListener('pointerleave', function () { card.style.transform = ''; });
  }
  var spark = $('#heroSpark');
  if (spark && window.Charts) spark.innerHTML = Charts.sparkline([92, 96, 94, 101, 99, 107, 112, 110, 118, 121, 119, 128], { width: 196, height: 40, color: '#d4b06c' });

  /* ---------- feature demos ---------- */
  var freeze = $('#freezeDemo');
  if (freeze) freeze.addEventListener('change', function () { $('#miniCard').classList.toggle('frozen', freeze.checked); });
  var ring = $('#goalRing');
  if (ring) {
    var bar = ring.querySelector('.bar');
    var fill = function () { bar.style.strokeDashoffset = String(314.16 * (1 - 0.72)); };
    if ('IntersectionObserver' in window) {
      var rio = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { fill(); rio.disconnect(); } }, { threshold: 0.4 });
      rio.observe(ring);
    } else fill();
  }
  var sc = $('#showcaseChart');
  if (sc && window.Charts) {
    Charts.bars(sc, {
        labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'], height: 190, label: 'Money in and out over six months',
        series: [
          { name: 'Money in', color: 'var(--series-1)', values: [6200, 6400, 6200, 7100, 6900, 7400] },
          { name: 'Money out', color: 'var(--series-2)', values: [4100, 5200, 3900, 4800, 4300, 3600] }
        ],
        format: function (v) { return A.money(v, 'USD', { noCents: true }); }
    });
  }

  /* ---------- live rates, fees, converter, loan calculator ---------- */
  var codes = function () { return Object.keys(rates); };
  var convert = function (amount, from, to) { return amount / rates[from] * rates[to]; };
  var pct = function (v, d) { return (Number(v) * 100).toFixed(d == null ? 2 : d) + '%'; };

  function renderTicker() {
    var pairs = [['USD', 'EUR'], ['USD', 'GBP'], ['EUR', 'GBP'], ['USD', 'NGN'], ['GBP', 'NGN'], ['USD', 'CAD'], ['EUR', 'NGN'], ['GBP', 'USD'], ['CAD', 'NGN']];
    var items = pairs.filter(function (p) { return rates[p[0]] && rates[p[1]]; }).map(function (p) {
      var v = convert(1, p[0], p[1]);
      return '<span class="ticker-item"><b>' + p[0] + '/' + p[1] + '</b><span>' + v.toLocaleString(undefined, { minimumFractionDigits: v > 100 ? 2 : 4, maximumFractionDigits: v > 100 ? 2 : 4 }) + '</span></span>';
    }).join('');
    $('#ticker').innerHTML = items + items;   // duplicated for a seamless loop
    var fx = $('#heroFx');
    if (fx) fx.textContent = 'USD → EUR ' + convert(1, 'USD', 'EUR').toFixed(4);
  }

  var from = $('#convFrom'), to = $('#convTo'), amt = $('#convAmount');
  function fillSelects() {
    var opts = codes().map(function (c) { return '<option value="' + c + '">' + c + ' · ' + A.esc(names[c] || c) + '</option>'; }).join('');
    var f = from.value || 'USD', t = to.value || 'EUR';
    from.innerHTML = opts; to.innerHTML = opts;
    from.value = rates[f] ? f : 'USD';
    to.value = rates[t] ? t : 'EUR';
  }
  function renderConverter() {
    var a = Math.max(0, parseFloat(amt.value) || 0);
    var f = from.value, t = to.value;
    $('#convRate').textContent = '1 ' + f + ' = ' + convert(1, f, t).toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + t;
    $('#convResult').textContent = A.money(convert(a, f, t), t);
  }
  [from, to].forEach(function (el) { el.addEventListener('change', renderConverter); });
  amt.addEventListener('input', renderConverter);
  $('#convSwap').addEventListener('click', function () { var f = from.value; from.value = to.value; to.value = f; renderConverter(); });

  var term = 12;
  var loanAmount = $('#loanAmount');
  function renderLoan() {
    var P = Number(loanAmount.value), r = Number(settings.loan_apr) / 12;
    var pmt = r === 0 ? P / term : P * r / (1 - Math.pow(1 + r, -term));
    var cur = settings.base_currency || 'USD';
    $('#loanAmountOut').textContent = A.money(P, cur, { noCents: true });
    $('#loanMonthly').textContent = A.money(pmt, cur);
    $('#loanTotal').textContent = A.money(pmt * term, cur);
    $('#loanApr').textContent = pct(settings.loan_apr);
    loanAmount.setAttribute('aria-valuetext', A.money(P, cur, { noCents: true }));
  }
  loanAmount.addEventListener('input', renderLoan);
  A.on($('#termChips'), 'click', 'button', function (e, b) {
    term = Number(b.getAttribute('data-term'));
    $$('#termChips button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderLoan();
  });

  function renderFees() {
    var cur = settings.base_currency || 'USD';
    var internal = Number(settings.internal_fee_pct) === 0 ? 'Free' : pct(settings.internal_fee_pct);
    var set = function (sel, v) { $$(sel).forEach(function (el) { el.textContent = v; }); };
    set('[data-fee="internal"]', internal);
    set('[data-fee="external"]', pct(settings.external_fee_pct) + ' (min ' + A.money(settings.external_fee_min, cur) + ')');
    set('[data-fee="savings"]', pct(settings.savings_apr));
    set('[data-fee="limit"]', A.money(settings.daily_limit, cur, { noCents: true }));
    set('[data-fact="internal"]', internal);
    set('[data-fact="currencies"]', String(codes().length));
    set('[data-fact="savings"]', pct(settings.savings_apr));
    loanAmount.max = String(settings.max_loan || 50000);
    if (Number(loanAmount.value) > Number(loanAmount.max)) loanAmount.value = loanAmount.max;
  }

  function renderAll() { renderTicker(); fillSelects(); renderConverter(); renderLoan(); renderFees(); }
  renderAll();

  if (A.sb) {
    Promise.all([
      A.sb.from('fx_rates').select('currency,name,per_usd'),
      A.sb.from('settings').select('*').eq('id', 1).maybeSingle()
    ]).then(function (res) {
      var fx = res[0], st = res[1];
      if (!fx.error && fx.data && fx.data.length) {
        rates = {}; fx.data.forEach(function (r) { rates[r.currency] = Number(r.per_usd); names[r.currency] = r.name; });
      }
      if (!st.error && st.data) settings = st.data;
      renderAll();
    }).catch(function () { /* offline: keep fallbacks */ });

    A.getSession().then(function (s) {
      if (!s) return;
      $$('[data-auth="out"]').forEach(function (el) { el.hidden = true; });
      $$('[data-auth="in"]').forEach(function (el) { el.hidden = false; });
    }).catch(function () {});
  }

  $('#year').textContent = String(new Date().getFullYear());
})();
