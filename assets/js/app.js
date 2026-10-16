/* Aureon customer app — single-page app with hash routing. */
(function () {
  'use strict';
  var h = A.html, icon = A.icon, $ = A.$, $$ = A.$$;

  /* =========================================================================
     State & constants
     ========================================================================= */
  var S = {
    session: null, profile: null, accounts: [], settings: {}, rates: { USD: 1 }, rateNames: {},
    hasPin: false, notifications: [], unread: 0,
    hide: false, displayCcy: null, renderToken: 0, route: null
  };
  try { S.hide = localStorage.getItem('aureon-hide') === '1'; } catch (e) { /* ignore */ }

  var NAV = [
    { group: 'Banking', items: [
      { id: 'overview', label: 'Overview', icon: 'home' },
      { id: 'accounts', label: 'Accounts', icon: 'wallet' },
      { id: 'transfer', label: 'Transfers', icon: 'send' },
      { id: 'payments', label: 'Pay bills', icon: 'receipt' },
      { id: 'cards', label: 'Cards', icon: 'card' }
    ] },
    { group: 'Grow', items: [
      { id: 'savings', label: 'Savings', icon: 'piggy' },
      { id: 'loans', label: 'Loans', icon: 'handshake' },
      { id: 'insights', label: 'Insights', icon: 'chart' }
    ] },
    { group: 'Account', items: [
      { id: 'transactions', label: 'Activity', icon: 'history' },
      { id: 'support', label: 'Support', icon: 'support' },
      { id: 'settings', label: 'Settings', icon: 'settings' }
    ] }
  ];
  var TITLES = { notifications: 'Notifications' };
  NAV.forEach(function (g) { g.items.forEach(function (it) { TITLES[it.id] = it.label; }); });

  var TYPE_LABEL = { checking: 'Current account', savings: 'Savings account', business: 'Business account' };
  var CATS = {
    transfer: { label: 'Transfers', color: 'var(--cat-1)', icon: 'send' },
    bills: { label: 'Bills & utilities', color: 'var(--cat-2)', icon: 'receipt' },
    shopping: { label: 'Shopping', color: 'var(--cat-3)', icon: 'gift' },
    food: { label: 'Food & dining', color: 'var(--cat-4)', icon: 'heart' },
    savings: { label: 'Savings', color: 'var(--cat-5)', icon: 'piggy' },
    transport: { label: 'Transport', color: 'var(--cat-6)', icon: 'car' },
    entertainment: { label: 'Entertainment', color: 'var(--cat-7)', icon: 'tv' },
    health: { label: 'Health', color: 'var(--cat-8)', icon: 'heart' },
    other: { label: 'Other', color: 'var(--cat-other)', icon: 'more' },
    income: { label: 'Income', color: 'var(--series-1)', icon: 'arrow-down-left' },
    loan: { label: 'Loan', color: 'var(--cat-other)', icon: 'handshake' }
  };
  var CAT_ORDER = ['transfer', 'bills', 'shopping', 'food', 'savings', 'transport', 'entertainment', 'health', 'other'];
  var BILLERS = [
    { id: 'electricity', name: 'Electricity', icon: 'bolt', cat: 'bills', ref: 'Meter number', providers: ['City Power', 'BrightSpark Energy', 'GreenGrid Electric'] },
    { id: 'water', name: 'Water', icon: 'droplet', cat: 'bills', ref: 'Customer number', providers: ['Metro Water', 'ClearSpring Utilities'] },
    { id: 'internet', name: 'Internet', icon: 'router', cat: 'bills', ref: 'Account ID', providers: ['FiberNet', 'SkyLink Broadband', 'AirWave Home'] },
    { id: 'tv', name: 'TV & streaming', icon: 'tv', cat: 'entertainment', ref: 'Smartcard / account', providers: ['StreamBox', 'Vista TV', 'PrimeCast'] },
    { id: 'airtime', name: 'Mobile airtime', icon: 'phone', cat: 'bills', ref: 'Phone number', providers: ['Airtime top-up', 'Mobile data bundle'] },
    { id: 'insurance', name: 'Insurance', icon: 'umbrella', cat: 'health', ref: 'Policy number', providers: ['SafeHarbor Insurance', 'Evergreen Health Cover'] },
    { id: 'education', name: 'Education', icon: 'cap', cat: 'bills', ref: 'Student ID', providers: ['Tuition payment', 'Exam registration'] },
    { id: 'transport', name: 'Transport', icon: 'car', cat: 'transport', ref: 'Card number', providers: ['Transit card top-up', 'Toll account'] }
  ];
  var GOAL_ICONS = ['target', 'plane', 'house', 'car', 'cap', 'gift', 'heart', 'briefcase', 'umbrella', 'star'];

  /* =========================================================================
     Helpers
     ========================================================================= */
  function convert(amount, from, to) {
    if (from === to) return Number(amount || 0);
    var rf = S.rates[from], rt = S.rates[to];
    if (!rf || !rt) return Number(amount || 0);
    return Number(amount || 0) / rf * rt;
  }
  function money(v, c, o) { return S.hide && !(o && o.always) ? '••••••' : A.money(v, c, o); }
  function activeAccounts() { return S.accounts.filter(function (a) { return a.status !== 'closed'; }); }
  function primaryAccount() { var acc = activeAccounts(); return acc.find(function (a) { return a.is_primary; }) || acc[0]; }
  function acctName(a) { return a ? (a.nickname || TYPE_LABEL[a.type] || 'Account') : ''; }
  function acctLabel(a) { return a ? acctName(a) + ' ' + A.maskAccount(a.account_number) : ''; }
  function accountById(id) { return S.accounts.find(function (a) { return a.id === id; }); }
  function displayCcy() {
    var c = S.displayCcy || (S.profile.preferences || {}).display_currency || (primaryAccount() || {}).currency || 'USD';
    return S.rates[c] ? c : 'USD';
  }
  function totalBalance(ccy) {
    return activeAccounts().reduce(function (s, a) { return s + convert(a.balance, a.currency, ccy); }, 0);
  }
  function catOf(t) { return CATS[t.category] ? t.category : 'other'; }
  function txnIcon(t) {
    if (t.kind === 'transfer') return t.direction === 'credit' ? 'arrow-down-left' : 'send';
    var map = { external: 'bank', deposit: 'arrow-down-left', withdrawal: 'arrow-up-right', card: 'card', loan: 'handshake', savings: 'piggy', interest: 'percent', reversal: 'refresh', fee: 'coins' };
    if (t.kind === 'bill') { var b = BILLERS.find(function (x) { return x.providers.indexOf(t.counterparty_name) !== -1; }); return b ? b.icon : 'receipt'; }
    return map[t.kind] || 'activity';
  }
  function statusBadge(s) { return h`<span class="badge badge-${s}">${s}</span>`; }
  function optionsFor(accounts, selected, opts) {
    opts = opts || {};
    return accounts.map(function (a) {
      return h`<option value="${a.id}" ${a.id === selected ? 'selected' : ''} ${opts.disableFrozen && a.status !== 'active' ? 'disabled' : ''}>${acctLabel(a)} · ${A.money(a.balance, a.currency)}${a.status !== 'active' ? ' (' + a.status + ')' : ''}</option>`;
    });
  }
  function emptyState(ic, title, text, action) {
    return h`<div class="empty"><span class="empty-icon">${icon(ic, 'i-lg')}</span><h4>${title}</h4><p>${text}</p>${action || ''}</div>`;
  }
  function skeleton(rows) {
    var out = '';
    for (var i = 0; i < (rows || 4); i++) out += '<div class="skeleton" style="height:56px;margin:8px 0;border-radius:14px"></div>';
    return A.raw(out);
  }
  function setBody(html) { $('#viewBody').innerHTML = html.toString(); }
  function isCurrent(token) { return token === S.renderToken; }
  function monthKey(d) { d = new Date(d); return d.getFullYear() + '-' + (d.getMonth() + 1); }
  function monthLabel(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, { month: 'short' }); }
  function lastMonths(n) {
    var keys = [], d = new Date(); d.setDate(1);
    for (var i = n - 1; i >= 0; i--) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1); keys.push(x.getFullYear() + '-' + (x.getMonth() + 1)); }
    return keys;
  }
  // Money that actually moved (pending outgoing counts as spent; pending incoming does not yet).
  function counts(t) { return t.direction === 'debit' ? t.status !== 'declined' && t.status !== 'failed' : t.status === 'completed' || t.status === 'reversed'; }
  // Money that stays yours (own-account moves, savings goals) is not income or spending.
  function isOwnMove(t) { return (t.metadata && t.metadata.own_transfer) || t.kind === 'savings'; }

  /* =========================================================================
     Data
     ========================================================================= */
  function loadAccounts() {
    return A.q(A.sb.from('accounts').select('*').eq('user_id', S.session.user.id).order('is_primary', { ascending: false }).order('created_at'))
      .then(function (rows) { S.accounts = rows.map(function (a) { a.balance = Number(a.balance); return a; }); });
  }
  function loadProfile() {
    return A.fetchProfile(S.session.user.id).then(function (p) { S.profile = p; });
  }
  function loadNotifications() {
    return A.q(A.sb.from('notifications').select('*').eq('user_id', S.session.user.id).order('created_at', { ascending: false }).limit(40)).then(function (rows) {
      S.notifications = rows;
      S.unread = rows.filter(function (n) { return !n.read_at; }).length;
    });
  }
  function loadRefData() {
    return Promise.all([
      A.q(A.sb.from('settings').select('*').eq('id', 1).maybeSingle()),
      A.q(A.sb.from('fx_rates').select('*').order('currency')),
      A.rpc('has_pin')
    ]).then(function (r) {
      S.settings = r[0] || {};
      S.rates = {}; S.rateNames = {};
      (r[1] || []).forEach(function (x) { S.rates[x.currency] = Number(x.per_usd); S.rateNames[x.currency] = x.name; });
      S.hasPin = !!r[2];
    });
  }
  function fetchTransactions(opts) {
    opts = opts || {};
    var q = A.sb.from('transactions').select('*').eq('user_id', S.session.user.id).order('created_at', { ascending: false });
    if (opts.since) q = q.gte('created_at', opts.since);
    if (opts.until) q = q.lte('created_at', opts.until);
    if (opts.account) q = q.eq('account_id', opts.account);
    if (opts.direction) q = q.eq('direction', opts.direction);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.kind) q = q.eq('kind', opts.kind);
    if (opts.search) {
      var s = opts.search.replace(/[%,()*]/g, ' ').trim();
      if (s) q = q.or('description.ilike.%' + s + '%,counterparty_name.ilike.%' + s + '%,reference.ilike.%' + s + '%');
    }
    var from = opts.offset || 0;
    q = q.range(from, from + (opts.limit || 50) - 1);
    return A.q(q).then(function (rows) { return rows.map(function (t) { t.amount = Number(t.amount); t.fee = Number(t.fee); return t; }); });
  }
  var refreshing = null;
  function refresh(rerender) {
    if (refreshing) return refreshing;
    refreshing = Promise.all([loadAccounts(), loadProfile(), loadNotifications()]).then(function () {
      refreshing = null;
      renderChrome();
      if (rerender) render(true);
    }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  /* =========================================================================
     Chrome: sidebar, top bar, banners, notifications
     ========================================================================= */
  function renderNav() {
    var current = S.route ? S.route.name : 'overview';
    $('#sideNav').innerHTML = NAV.map(function (g) {
      return h`<div class="nav-group"><div class="nav-label">${g.group}</div>${g.items.map(function (it) {
        return h`<a class="nav-item ${current === it.id ? 'active' : ''}" href="#/${it.id}" ${current === it.id ? 'aria-current="page"' : ''}>${icon(it.icon)}${it.label}</a>`;
      })}</div>`;
    }).join('');
    $$('#tabbar a[data-tab]').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-tab') === current); });
  }
  function avatarHtml(cls) {
    var p = S.profile;
    return p.avatar_url
      ? h`<span class="avatar ${cls || ''}"><img src="${p.avatar_url}" alt=""></span>`
      : h`<span class="avatar ${cls || ''}">${A.initials(p.full_name || p.email)}</span>`;
  }
  function renderChrome() {
    var p = S.profile;
    renderNav();
    $('#userChip').innerHTML = h`${avatarHtml()}<div class="grow"><b class="truncate">${p.full_name || 'Customer'}</b><small class="truncate">${p.email}</small></div>`.toString();
    $('#avatarBtn').innerHTML = avatarHtml().toString();
    $('#bellBtn').innerHTML = h`${icon('bell')}${S.unread ? h`<span class="dot">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}`.toString();
    $('#bellBtn').setAttribute('aria-label', S.unread ? S.unread + ' unread notifications' : 'Notifications');
    $('#hideBtn').innerHTML = icon(S.hide ? 'eye-off' : 'eye').toString();
    $('#hideBtn').setAttribute('aria-label', S.hide ? 'Show balances' : 'Hide balances');
    renderBanners();
  }
  function renderBanners() {
    var p = S.profile, out = [];
    if (p.status === 'frozen' || p.status === 'closed') {
      out.push(h`<div class="alert alert-danger">${icon('lock')}<div><strong>Your profile is ${p.status}</strong><p>${p.status_reason || 'Please contact support.'}</p></div><a class="btn btn-sm btn-danger" href="#/support">Contact support</a></div>`);
    } else if (p.status === 'restricted') {
      out.push(h`<div class="alert alert-warning">${icon('flag')}<div><strong>Your account has been flagged — outgoing payments are paused</strong><p>${p.status_reason || 'Please contact support.'}</p></div><a class="btn btn-sm btn-soft" href="#/support">Contact support</a></div>`);
    }
    if (!S.hasPin && p.status === 'active') {
      out.push(h`<div class="alert alert-info">${icon('key')}<div><strong>Create your transaction PIN</strong><p>You need a 4-digit PIN before you can send money or pay bills.</p></div><button class="btn btn-sm btn-soft" data-action="create-pin">Create PIN</button></div>`);
    }
    $('#banners').innerHTML = out.join('');
  }

  function closePopovers() { $$('.popover').forEach(function (p) { p.remove(); }); }
  function openPopover(anchor, html) {
    var existing = anchor.parentElement.querySelector('.popover');
    closePopovers();
    if (existing) return null;
    var el = document.createElement('div');
    el.className = 'popover';
    el.innerHTML = html.toString();
    anchor.parentElement.appendChild(el);
    return el;
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.popover') && !e.target.closest('[data-action="notifications"],[data-action="user-menu"]')) closePopovers();
  });
  function notifIcon(kind) { return { success: 'check-circle', warning: 'alert', danger: 'x-circle', info: 'info' }[kind] || 'bell'; }
  function notifItem(n) {
    return h`<div class="notif ${n.kind} ${n.read_at ? '' : 'unread'}" data-notif="${n.id}" data-link="${n.link || ''}">
      <span class="ic">${icon(notifIcon(n.kind))}</span>
      <div class="grow"><b>${n.title}</b><p>${n.body}</p><small>${A.date(n.created_at, 'relative')}</small></div></div>`;
  }
  function showNotifications(anchor) {
    var list = S.notifications.slice(0, 12);
    var pop = openPopover(anchor, h`
      <div class="popover-head"><h3>Notifications</h3>${S.unread ? h`<button class="btn btn-ghost btn-sm" data-action="read-all">Mark all read</button>` : ''}</div>
      <div class="popover-body">${list.length ? list.map(notifItem) : emptyState('bell', 'All caught up', 'New activity on your accounts will appear here.')}</div>
      <div class="card-foot text-center"><a class="link small" href="#/notifications">View all notifications</a></div>`);
    if (pop && S.unread) markAllRead();
  }
  function markAllRead() {
    if (!S.unread) return Promise.resolve();
    return A.rpc('mark_notifications_read').then(function () {
      S.notifications.forEach(function (n) { n.read_at = n.read_at || new Date().toISOString(); });
      S.unread = 0;
      renderChrome();
    }).catch(function () { /* non-critical */ });
  }
  function showUserMenu(anchor) {
    openPopover(anchor, h`
      <div class="popover-head"><div class="row">${avatarHtml()}<div><b>${S.profile.full_name}</b><div class="small muted">${S.profile.email}</div></div></div></div>
      <div class="menu-list">
        <a href="#/settings/profile">${icon('user')}Profile &amp; verification</a>
        <a href="#/settings/security">${icon('shield')}Security &amp; PIN</a>
        <a href="#/settings/preferences">${icon('settings')}Preferences</a>
        <a href="#/support">${icon('support')}Help &amp; support</a>
        <button class="danger" data-action="signout">${icon('logout')}Sign out</button>
      </div>`);
  }

  /* =========================================================================
     PIN, flagged-account popup and payment authorisation
     ========================================================================= */
  function showFlagPopup(reason) {
    return A.modal({
      title: 'Your account has been flagged',
      body: h`<div class="alert alert-warning">${icon('flag')}<div><strong>Outgoing payments are paused on your account</strong><p>${reason || S.profile.status_reason || 'Please contact support for more information.'}</p></div></div>
              <p class="muted small mt-4">You can still receive money, view your history and message our team. Payments resume as soon as the flag is removed.</p>`,
      foot: h`<button class="btn btn-ghost" data-close>Close</button><a class="btn btn-primary" href="#/support" data-close>Contact support</a>`
    });
  }
  /** Returns true if the customer may send money; otherwise shows why and returns false. */
  function guardSend() {
    var p = S.profile;
    if (p.status === 'restricted') { showFlagPopup(p.status_reason); return false; }
    if (p.status !== 'active') {
      A.modal({ title: 'Your profile is ' + p.status, body: h`<p class="muted">${p.status_reason || 'Please contact support.'}</p>`, foot: h`<a class="btn btn-primary" href="#/support" data-close>Contact support</a>` });
      return false;
    }
    return true;
  }
  function handleMoneyError(err) {
    var m = A.friendlyError(err);
    if (/restricted on your profile/i.test(m)) {
      return refresh().then(function () { showFlagPopup(m.replace(/^Outgoing payments are restricted on your profile\.\s*/i, '')); });
    }
    A.toast('Payment not completed', { type: 'error', body: m });
  }

  function createPinFlow() {
    var first;
    return A.pinPad({ title: 'Create your PIN', subtitle: 'Choose 4 digits you will remember. Avoid birthdays and 1234.', onSubmit: function (pin) { first = pin; return pin; } })
      .then(function (pin) {
        if (!pin) return false;
        return A.pinPad({
          title: 'Confirm your PIN', subtitle: 'Enter the same 4 digits again.',
          onSubmit: function (pin2) {
            if (pin2 !== first) return Promise.reject(new Error('Those PINs do not match. Try again.'));
            return A.rpc('set_transaction_pin', { p_new: pin2 }).then(function () { return true; });
          }
        });
      })
      .then(function (ok) {
        if (ok) {
          S.hasPin = true; renderChrome();
          A.toast('Transaction PIN created', { type: 'success', body: 'You can now send money and pay bills.' });
        }
        return !!ok;
      });
  }
  function changePinFlow() {
    var current;
    return A.pinPad({ title: 'Current PIN', subtitle: 'Enter your current 4-digit PIN.', onSubmit: function (p) { current = p; return p; } })
      .then(function (p) {
        if (!p) return null;
        var fresh;
        return A.pinPad({ title: 'New PIN', subtitle: 'Choose a new 4-digit PIN.', onSubmit: function (n) { fresh = n; return n; } })
          .then(function (n) {
            if (!n) return null;
            return A.pinPad({
              title: 'Confirm new PIN', subtitle: 'Enter the new PIN again.',
              onSubmit: function (n2) {
                if (n2 !== fresh) return Promise.reject(new Error('Those PINs do not match.'));
                return A.rpc('set_transaction_pin', { p_new: n2, p_current: current }).then(function () { return true; });
              }
            });
          });
      })
      .then(function (ok) { if (ok) A.toast('PIN changed', { type: 'success' }); })
      .catch(function (e) { A.toast('PIN not changed', { type: 'error', body: A.friendlyError(e) }); });
  }
  /**
   * Ask for the PIN and run call(pin). PIN mistakes are shown on the pad so the
   * customer can retry; any other error closes the pad and is returned.
   */
  function authorize(call, subtitle) {
    var ready = S.hasPin ? Promise.resolve(true) : createPinFlow();
    return ready.then(function (ok) {
      if (!ok) return null;
      return A.pinPad({
        subtitle: subtitle,
        footer: 'Forgot your PIN? Ask support to reset it.',
        onSubmit: function (pin) {
          return call(pin).then(function (data) { return { ok: true, data: data }; }, function (err) {
            if (err && err.code === 'PIN_INVALID') throw err;
            if (err && err.code === 'PIN_NOT_SET') { S.hasPin = false; }
            return { ok: false, error: err };
          });
        }
      });
    });
  }

  /* =========================================================================
     Shared UI: transactions list, receipts, detail drawer
     ========================================================================= */
  function txnRow(t) {
    var credit = t.direction === 'credit';
    var dead = t.status === 'declined' || t.status === 'failed';
    var amount = credit ? t.amount : t.amount + (t.fee || 0);
    var acc = accountById(t.account_id);
    return h`<button class="txn" data-txn="${t.id}">
      <span class="ic ${credit ? 'credit' : ''}">${icon(txnIcon(t))}</span>
      <span class="meta"><b>${t.description || t.counterparty_name || 'Transaction'}</b>
        <small>${A.date(t.created_at, 'time')} · ${CATS[catOf(t)].label}${activeAccounts().length > 1 && acc ? ' · ' + A.maskAccount(acc.account_number) : ''}${t.status !== 'completed' ? h` ${statusBadge(t.status)}` : ''}</small></span>
      <span class="amt"><b class="${dead ? 'muted-amt' : credit ? 'credit' : ''}">${credit ? '+' : '−'}${money(amount, t.currency)}</b>${t.fee > 0 ? h`<small>incl. ${A.money(t.fee, t.currency)} fee</small>` : ''}</span>
    </button>`;
  }
  function txnGroups(rows) {
    var out = [], last = '';
    rows.forEach(function (t) {
      var day = A.date(t.created_at, 'day');
      if (day !== last) { out.push(h`<div class="txn-day">${day}</div>`); last = day; }
      out.push(txnRow(t));
    });
    return out;
  }
  var txnCache = {};
  function remember(rows) { rows.forEach(function (t) { txnCache[t.id] = t; }); return rows; }

  function receiptKv(t) {
    var acc = accountById(t.account_id);
    var rows = [
      ['Reference', t.reference],
      ['Date', A.date(t.created_at, 'long')],
      ['Status', h`${statusBadge(t.status)}`],
      ['Account', acc ? acctLabel(acc) : '—'],
      [t.direction === 'credit' ? 'From' : 'To', t.counterparty_name || '—']
    ];
    if (t.counterparty_account) rows.push(['Their account', t.counterparty_account]);
    if (t.counterparty_bank) rows.push(['Bank', t.counterparty_bank]);
    if (t.fee > 0) rows.push(['Fee', A.money(t.fee, t.currency)]);
    if (t.metadata && t.metadata.credit_amount && t.metadata.credit_currency && t.metadata.credit_currency !== t.currency) {
      rows.push(['Recipient received', A.money(t.metadata.credit_amount, t.metadata.credit_currency)]);
    }
    if (t.balance_after != null) rows.push(['Balance after', money(t.balance_after, t.currency)]);
    if (t.note) rows.push(['Note', t.note]);
    if (t.admin_note) rows.push(['Message from Aureon', t.admin_note]);
    return h`<div class="kv">${rows.map(function (r) { return h`<div><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`; })}</div>`;
  }
  function openTxn(t) {
    var credit = t.direction === 'credit';
    A.modal({
      drawer: true,
      title: 'Transaction details',
      body: h`<div class="receipt">
          <div class="receipt-mark ${t.status === 'pending' ? 'pending' : ''}" ${t.status === 'declined' || t.status === 'failed' ? 'style="background:var(--danger-soft);color:var(--danger)"' : ''}>${icon(txnIcon(t))}</div>
          <div class="muted small">${t.description}</div>
          <div class="receipt-amount">${credit ? '+' : '−'}${A.money(credit ? t.amount : t.amount + t.fee, t.currency)}</div>
          ${receiptKv(t)}
        </div>
        <div class="row wrap mt-4">
          <button class="btn btn-soft grow" data-copy="${t.reference}">${icon('copy', 'i-sm')}Copy reference</button>
          <button class="btn btn-soft grow" data-print-receipt="${t.id}">${icon('printer', 'i-sm')}Print receipt</button>
        </div>
        <button class="btn btn-ghost btn-block mt-2" data-report="${t.id}">${icon('flag', 'i-sm')}Report a problem</button>`,
      onOpen: function (el, close) {
        A.on(el, 'click', '[data-copy]', function (e, b) { A.copy(b.getAttribute('data-copy')); });
        A.on(el, 'click', '[data-print-receipt]', function () { printReceipt(t); });
        A.on(el, 'click', '[data-report]', function () {
          close();
          newTicket({ subject: 'Problem with transaction ' + t.reference, category: 'transactions' });
        });
      }
    });
  }
  function printDoc(title, inner, win) {
    var w = win || window.open('', '_blank');
    if (!w) { A.toast('Allow pop-ups to print', { type: 'warning' }); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + A.esc(title) + '</title><style>' +
      'body{font-family:Manrope,system-ui,sans-serif;color:#0e1220;margin:40px;font-size:13px}h1{font-size:22px;margin:0}' +
      '.brand{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #c9a35a;padding-bottom:14px;margin-bottom:22px}' +
      '.brand b{font-size:22px;letter-spacing:-.02em}.muted{color:#6a7080}table{width:100%;border-collapse:collapse;margin-top:16px}' +
      'th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #e6e2d9}th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6a7080}' +
      '.r{text-align:right;font-variant-numeric:tabular-nums}.kv td:first-child{color:#6a7080;width:40%}.big{font-size:30px;font-weight:800;margin:14px 0}' +
      '.sum{display:flex;gap:24px;margin-top:10px}.sum div{padding:10px 14px;background:#f6f4ef;border-radius:10px}.foot{margin-top:28px;color:#9aa0ad;font-size:11px}' +
      '</style></head><body>' + inner + '<p class="foot">Generated ' + A.esc(new Date().toLocaleString()) + ' · Aureon is a digital banking platform demo and does not hold real deposits.</p>' +
      '<script>window.onload=function(){window.print()}<\/script></body></html>');
    w.document.close();
  }
  function printReceipt(t) {
    var acc = accountById(t.account_id);
    var credit = t.direction === 'credit';
    var row = function (k, v) { return '<tr><td>' + A.esc(k) + '</td><td>' + A.esc(v) + '</td></tr>'; };
    printDoc('Receipt ' + t.reference,
      '<div class="brand"><b>Aureon</b><span class="muted">Transaction receipt</span></div>' +
      '<div class="muted">' + A.esc(t.description) + '</div><div class="big">' + (credit ? '+' : '−') + A.esc(A.money(credit ? t.amount : t.amount + t.fee, t.currency)) + '</div>' +
      '<table class="kv">' + row('Reference', t.reference) + row('Date', A.date(t.created_at, 'long')) + row('Status', t.status) +
      row('Account', acc ? acctLabel(acc) : '') + row(credit ? 'From' : 'To', t.counterparty_name || '') +
      (t.counterparty_account ? row('Their account', t.counterparty_account) : '') + (t.counterparty_bank ? row('Bank', t.counterparty_bank) : '') +
      (t.fee > 0 ? row('Fee', A.money(t.fee, t.currency)) : '') + (t.note ? row('Note', t.note) : '') + '</table>');
  }
  function showResult(res, title) {
    var pending = res.status === 'pending';
    return A.modal({
      body: h`<div class="receipt">
        <div class="receipt-mark ${pending ? 'pending' : ''}">${pending ? icon('clock') : h`<svg class="i draw" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`}</div>
        <h2 style="font-size:20px">${pending ? 'Submitted for review' : title || 'Payment sent'}</h2>
        <p class="muted small mt-1">${pending ? 'Funds are held while our team reviews this payment. We will notify you as soon as it completes.' : 'Done. A receipt has been saved to your activity.'}</p>
        <div class="receipt-amount mt-3">${A.money(res.amount, res.currency)}</div>
        <div class="kv">
          ${res.recipient ? h`<div><span class="k">To</span><span class="v">${res.recipient}</span></div>` : ''}
          ${res.recipient_account ? h`<div><span class="k">Account</span><span class="v">${res.recipient_account}</span></div>` : ''}
          ${res.bank ? h`<div><span class="k">Bank</span><span class="v">${res.bank}</span></div>` : ''}
          ${res.fee > 0 ? h`<div><span class="k">Fee</span><span class="v">${A.money(res.fee, res.currency)}</span></div>` : ''}
          ${res.credit_currency && res.credit_currency !== res.currency ? h`<div><span class="k">They receive</span><span class="v">${A.money(res.credit_amount, res.credit_currency)}</span></div>` : ''}
          <div><span class="k">Reference</span><span class="v">${res.reference}</span></div>
          ${res.balance_after != null ? h`<div><span class="k">New balance</span><span class="v">${A.money(res.balance_after, res.currency)}</span></div>` : ''}
        </div>
      </div>`,
      foot: h`<a class="btn btn-ghost" href="#/transactions" data-close>View activity</a><button class="btn btn-primary" data-close>Done</button>`
    });
  }

  /* =========================================================================
     Views
     ========================================================================= */
  var views = {};

  /* ---------- Overview ---------- */
  views.overview = function (token) {
    var ccy = displayCcy();
    var ccys = Array.from(new Set(activeAccounts().map(function (a) { return a.currency; }).concat([ccy])));
    var first = (S.profile.full_name || '').split(' ')[0];
    setBody(h`
      <div class="page-head"><div><h2>${A.greeting()}${first ? ', ' + first : ''}</h2><p>Here is where your money stands today.</p></div></div>
      <div class="dash">
        <div class="stack-lg">
          <section class="balance-hero">
            <div class="bh-top">
              <span class="bh-label">Total balance <button data-action="hide-balances" aria-label="Toggle balance visibility">${icon(S.hide ? 'eye-off' : 'eye', 'i-sm')}</button></span>
              ${ccys.length > 1 ? h`<div class="bh-ccy" role="group" aria-label="Display currency">${ccys.map(function (c) { return h`<button class="${c === ccy ? 'on' : ''}" data-ccy="${c}">${c}</button>`; })}</div>` : ''}
            </div>
            <div class="bh-amount">${money(totalBalance(ccy), ccy)}</div>
            <div class="bh-sub" id="bhSub"><span>${activeAccounts().length} account${activeAccounts().length === 1 ? '' : 's'}</span></div>
            <div class="quick-actions">
              <a class="qa primary" href="#/transfer"><span class="ic">${icon('send')}</span>Send</a>
              <button class="qa" data-action="receive"><span class="ic">${icon('arrow-down-left')}</span>Receive</button>
              <a class="qa" href="#/payments"><span class="ic">${icon('receipt')}</span>Pay bills</a>
              <a class="qa" href="#/transfer/own"><span class="ic">${icon('swap')}</span>Exchange</a>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h3>Cash flow</h3><span class="small muted">Last 6 months · ${ccy}</span></div>
            <div class="card-body"><div id="flowChart">${skeleton(3)}</div></div>
          </section>
          <section class="card">
            <div class="card-head"><h3>Recent activity</h3><a class="link small" href="#/transactions">View all</a></div>
            <div class="card-body" id="recentTxns">${skeleton(5)}</div>
          </section>
        </div>
        <div class="stack-lg">
          <section class="card">
            <div class="card-head"><h3>Accounts</h3><button class="btn btn-ghost btn-sm" data-action="open-account">${icon('plus', 'i-sm')}New</button></div>
            <div class="card-body"><div class="acct-list">${activeAccounts().map(function (a) {
              return h`<a class="acct" href="#/accounts"><span class="ccy-badge">${A.symbol(a.currency).trim()}</span><span class="grow"><b>${acctName(a)}</b><small>${A.maskAccount(a.account_number)} · ${a.currency}${a.status !== 'active' ? ' · ' + a.status : ''}</small></span><span class="amt">${money(a.balance, a.currency)}</span></a>`;
            })}</div></div>
          </section>
          <section class="card">
            <div class="card-head"><h3>Spending this month</h3><a class="link small" href="#/insights">Insights</a></div>
            <div class="card-body" id="spendDonut">${skeleton(2)}</div>
          </section>
          <section class="card">
            <div class="card-head"><h3>Savings goals</h3><a class="link small" href="#/savings">All goals</a></div>
            <div class="card-body" id="goalsPreview">${skeleton(2)}</div>
          </section>
        </div>
      </div>`);

    var since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1); since.setHours(0, 0, 0, 0);
    Promise.all([
      fetchTransactions({ since: since.toISOString(), limit: 1000 }),
      A.q(A.sb.from('savings_goals').select('*').eq('user_id', S.session.user.id).neq('status', 'closed').order('created_at').limit(3))
    ]).then(function (r) {
      if (!isCurrent(token)) return;
      var txns = remember(r[0]), goals = r[1];
      var recent = txns.slice(0, 7);
      $('#recentTxns').innerHTML = (recent.length ? h`<div class="txn-list">${recent.map(txnRow)}</div>` : emptyState('history', 'No activity yet', 'Share your account number to receive money, or send your first transfer.', h`<button class="btn btn-soft btn-sm" data-action="receive">Show account details</button>`)).toString();

      // cash flow — exclude moves between own accounts
      var keys = lastMonths(6), inn = {}, out = {};
      keys.forEach(function (k) { inn[k] = 0; out[k] = 0; });
      txns.forEach(function (t) {
        var k = monthKey(t.created_at);
        if (!(k in inn) || !counts(t) || isOwnMove(t) || t.kind === 'reversal') return;
        var v = convert(t.direction === 'debit' ? t.amount + t.fee : t.amount, t.currency, ccy);
        if (t.direction === 'credit') inn[k] += v; else out[k] += v;
      });
      var thisMonth = keys[keys.length - 1];
      $('#bhSub').innerHTML = h`<span>${activeAccounts().length} account${activeAccounts().length === 1 ? '' : 's'}</span><span>This month: <span class="up">+${money(inn[thisMonth], ccy, { noCents: true })}</span> in · <span class="down">−${money(out[thisMonth], ccy, { noCents: true })}</span> out</span>`.toString();
      if (txns.length) {
        Charts.bars($('#flowChart'), {
          labels: keys.map(monthLabel), height: 220, label: 'Money in and out per month',
          series: [
            { name: 'Money in', color: 'var(--series-1)', values: keys.map(function (k) { return inn[k]; }) },
            { name: 'Money out', color: 'var(--series-2)', values: keys.map(function (k) { return out[k]; }) }
          ],
          format: function (v) { return A.money(v, ccy); }
        });
      } else {
        $('#flowChart').innerHTML = emptyState('chart', 'Nothing to chart yet', 'Your monthly money in and out will appear here.').toString();
      }

      renderSpendDonut($('#spendDonut'), txns.filter(function (t) { return monthKey(t.created_at) === thisMonth; }), ccy, 150);

      $('#goalsPreview').innerHTML = (goals.length ? h`<div class="stack">${goals.map(function (g) {
        var pct = Math.min(100, Math.round(g.saved_amount / g.target_amount * 100));
        return h`<a href="#/savings" class="stack" style="gap:8px"><div class="row-between"><span class="row" style="gap:10px"><span class="goal-ic" style="width:36px;height:36px;border-radius:11px">${icon(g.icon, 'i-sm')}</span><b class="small">${g.name}</b></span><span class="small muted">${pct}%</span></div><div class="progress ${pct >= 100 ? 'done' : ''}"><span style="width:${pct}%"></span></div><div class="tiny muted">${money(g.saved_amount, g.currency)} of ${A.money(g.target_amount, g.currency, { noCents: true })}</div></a>`;
      })}</div>` : emptyState('piggy', 'No goals yet', 'Set a goal and watch your savings grow.', h`<a class="btn btn-soft btn-sm" href="#/savings">Create a goal</a>`)).toString();
    }).catch(function (e) { if (isCurrent(token)) A.toast('Could not load activity', { type: 'error', body: A.friendlyError(e) }); });
  };

  function renderSpendDonut(el, txns, ccy, size) {
    var sums = {};
    txns.forEach(function (t) {
      if (t.direction !== 'debit' || !counts(t) || isOwnMove(t)) return;
      var c = catOf(t);
      sums[c] = (sums[c] || 0) + convert(t.amount + t.fee, t.currency, ccy);
    });
    var items = CAT_ORDER.filter(function (c) { return sums[c] > 0; }).map(function (c) { return { key: c, label: CATS[c].label, value: sums[c], color: CATS[c].color }; });
    var total = items.reduce(function (s, x) { return s + x.value; }, 0);
    if (!items.length) { el.innerHTML = emptyState('pie', 'No spending yet', 'Your spending by category will appear here.').toString(); return; }
    el.innerHTML = '<div class="donut-wrap"><div class="donut-slot"></div><div class="cat-list"></div></div>';
    Charts.donut(el.querySelector('.donut-slot'), {
      items: items, size: size || 170, label: 'Spending by category', centerLabel: 'Spent', centerValue: S.hide ? '••••' : A.money(total, ccy, { compact: true }),
      format: function (v) { return A.money(v, ccy); }
    });
    el.querySelector('.cat-list').innerHTML = items.slice().sort(function (a, b) { return b.value - a.value; }).map(function (x) {
      return h`<div class="cat-row"><i style="background:${x.color}"></i><span>${x.label}</span><b>${money(x.value, ccy, { noCents: true })}</b><em>${Math.round(x.value / total * 100)}%</em></div>`;
    }).join('');
  }

  /* ---------- Accounts ---------- */
  views.accounts = function () {
    var list = activeAccounts();
    setBody(h`
      <div class="page-head"><div><h2>Accounts</h2><p>Hold up to six accounts across ${Object.keys(S.rates).length} currencies.</p></div>
        <div class="page-actions"><button class="btn btn-primary" data-action="open-account">${icon('plus', 'i-sm')}Open account</button></div></div>
      <div class="grid-3">${list.map(function (a) {
        return h`<article class="acct-card ${a.is_primary ? 'primary' : ''}">
          <div class="row-between"><span class="row" style="gap:10px"><span class="ccy-badge">${A.symbol(a.currency).trim()}</span><span><b>${acctName(a)}</b><div class="tiny muted">${TYPE_LABEL[a.type]} · ${a.currency}</div></span></span>
            ${a.is_primary ? h`<span class="badge badge-gold no-dot">Primary</span>` : a.status !== 'active' ? statusBadge(a.status) : ''}</div>
          <div><div class="small muted">Available balance</div><div class="big">${money(a.balance, a.currency)}</div></div>
          <div class="row-between"><span class="acct-num">${A.groupDigits(a.account_number)}<button class="copy-btn" data-copy="${a.account_number}" aria-label="Copy account number">${icon('copy', 'i-sm')}</button></span></div>
          <div class="row wrap">
            <button class="btn btn-soft btn-sm" data-details="${a.id}">${icon('info', 'i-sm')}Details</button>
            <a class="btn btn-soft btn-sm" href="#/transactions?account=${a.id}">${icon('history', 'i-sm')}Activity</a>
            <button class="btn btn-ghost btn-sm btn-icon" data-acct-menu="${a.id}" aria-label="More options">${icon('more')}</button>
          </div>
        </article>`;
      })}</div>
      <section class="card section-gap"><div class="card-head"><h3>Exchange rates</h3><span class="small muted">Per 1 ${displayCcy()}</span></div>
        <div class="card-body"><div class="grid-4">${Object.keys(S.rates).filter(function (c) { return c !== displayCcy(); }).map(function (c) {
          return h`<div class="stat"><div class="k">${c} · ${S.rateNames[c] || ''}</div><div class="v">${convert(1, displayCcy(), c).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>`;
        })}</div></div></section>`);
  };
  function accountDetails(a) {
    var text = 'Account name: ' + S.profile.full_name + '\nAccount number: ' + a.account_number + '\nBank: Aureon\nCurrency: ' + a.currency;
    return A.modal({
      title: 'Account details', subtitle: 'Share these to receive money into this account.',
      body: h`<div class="kv">
        <div><span class="k">Account name</span><span class="v">${S.profile.full_name}</span></div>
        <div><span class="k">Account number</span><span class="v num">${a.account_number}</span></div>
        <div><span class="k">Bank</span><span class="v">Aureon</span></div>
        <div><span class="k">Currency</span><span class="v">${a.currency} · ${S.rateNames[a.currency] || ''}</span></div>
        <div><span class="k">Account type</span><span class="v">${TYPE_LABEL[a.type]}</span></div>
        <div><span class="k">Opened</span><span class="v">${A.date(a.created_at)}</span></div>
      </div>`,
      foot: h`${navigator.share ? h`<button class="btn btn-ghost" data-share>${icon('external', 'i-sm')}Share</button>` : ''}<button class="btn btn-primary" data-copy-all>${icon('copy', 'i-sm')}Copy details</button>`,
      onOpen: function (el) {
        var root = el;
        A.on(root, 'click', '[data-copy-all]', function () { A.copy(text); });
        A.on(root, 'click', '[data-share]', function () { navigator.share({ title: 'My Aureon account', text: text }).catch(function () {}); });
      }
    });
  }
  function receiveFlow() {
    var acc = activeAccounts();
    if (acc.length === 1) return accountDetails(acc[0]);
    return A.modal({
      title: 'Receive money', subtitle: 'Choose the account to receive into.',
      body: h`<div class="acct-list">${acc.map(function (a) { return h`<button class="acct" data-pick="${a.id}"><span class="ccy-badge">${A.symbol(a.currency).trim()}</span><span class="grow"><b>${acctName(a)}</b><small>${a.account_number} · ${a.currency}</small></span>${icon('chevron-right')}</button>`; })}</div>`,
      onOpen: function (el, close) { A.on(el, 'click', '[data-pick]', function (e, b) { close(); accountDetails(accountById(b.getAttribute('data-pick'))); }); }
    });
  }
  function openAccountFlow() {
    if (!guardActive()) return;
    A.modal({
      title: 'Open a new account', subtitle: 'Your new account number is issued instantly.',
      body: h`<form id="openAcct">
        <div class="field"><label class="label" for="oa-type">Account type</label><select class="select" id="oa-type" name="type"><option value="checking">Current account — everyday spending</option><option value="savings">Savings account — earns ${((S.settings.savings_apr || 0) * 100).toFixed(2)}% APR</option><option value="business">Business account</option></select></div>
        <div class="field"><label class="label" for="oa-ccy">Currency</label><select class="select" id="oa-ccy" name="currency">${Object.keys(S.rates).map(function (c) { return h`<option value="${c}" ${c === displayCcy() ? 'selected' : ''}>${c} · ${S.rateNames[c]}</option>`; })}</select></div>
        <div class="field"><label class="label" for="oa-nick">Nickname <small>Optional</small></label><input class="input" id="oa-nick" name="nickname" maxlength="40" placeholder="e.g. Travel money"></div>
      </form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="openAcct">Open account</button>`,
      onOpen: function (el, close) {
        var form = $('#openAcct', el);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(form), btn = el.querySelector('[form=openAcct]');
          A.busy(btn, true);
          A.rpc('open_account', { p_type: d.type, p_currency: d.currency, p_nickname: d.nickname || null }).then(function (r) {
            close(); A.toast('Account opened', { type: 'success', body: 'Account number ' + r.account_number });
            refresh(true);
          }).catch(function (err) { A.busy(btn, false); A.toast('Could not open account', { type: 'error', body: A.friendlyError(err) }); });
        });
      }
    });
  }
  function accountMenu(a) {
    A.modal({
      title: acctName(a), subtitle: a.account_number,
      body: h`<div class="menu-list" style="padding:0">
        <button data-op="rename">${icon('edit')}Rename account</button>
        ${!a.is_primary ? h`<button data-op="primary">${icon('star')}Make primary</button>` : ''}
        ${!a.is_primary ? h`<button class="danger" data-op="close">${icon('trash')}Close account</button>` : ''}
      </div>`,
      onOpen: function (el, close) {
        A.on(el, 'click', '[data-op]', function (e, b) {
          var op = b.getAttribute('data-op'); close();
          if (op === 'rename') {
            A.prompt({ title: 'Rename account', label: 'Nickname', value: a.nickname || '', placeholder: TYPE_LABEL[a.type] }).then(function (v) {
              if (v === null) return;
              A.rpc('update_account', { p_account: a.id, p_nickname: v }).then(function () { A.toast('Account renamed', { type: 'success' }); refresh(true); }, function (err) { A.toast(A.friendlyError(err), { type: 'error' }); });
            });
          } else if (op === 'primary') {
            A.rpc('update_account', { p_account: a.id, p_nickname: a.nickname, p_make_primary: true }).then(function () { A.toast('Primary account updated', { type: 'success' }); refresh(true); }, function (err) { A.toast(A.friendlyError(err), { type: 'error' }); });
          } else if (op === 'close') {
            A.confirm({ title: 'Close this account?', body: 'The account must be empty. Linked cards will be cancelled. This cannot be undone.', confirmText: 'Close account', danger: true }).then(function (ok) {
              if (!ok) return;
              A.rpc('close_account', { p_account: a.id }).then(function () { A.toast('Account closed', { type: 'success' }); refresh(true); }, function (err) { A.toast('Could not close account', { type: 'error', body: A.friendlyError(err) }); });
            });
          }
        });
      }
    });
  }
  function guardActive() {
    if (S.profile.status === 'frozen' || S.profile.status === 'closed') {
      A.toast('Your profile is ' + S.profile.status, { type: 'error', body: S.profile.status_reason || 'Please contact support.' });
      return false;
    }
    return true;
  }

  /* ---------- Transfers ---------- */
  views.transfer = function (token, route) {
    var mode = ['aureon', 'own', 'external'].indexOf(route.sub) !== -1 ? route.sub : 'aureon';
    var acc = activeAccounts().filter(function (a) { return a.status === 'active'; });
    var from = acc.find(function (a) { return a.id === route.params.get('from'); }) || primaryAccount();
    var st = S.settings;
    var idem = A.uuid();
    setBody(h`
      <div class="page-head"><div><h2>Send money</h2><p>Instant between Aureon accounts. PIN-protected.</p></div>
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected="${mode === 'aureon'}" data-mode="aureon">${icon('zap', 'i-sm')}Aureon account</button>
          <button role="tab" aria-selected="${mode === 'own'}" data-mode="own">${icon('swap', 'i-sm')}My accounts</button>
          <button role="tab" aria-selected="${mode === 'external'}" data-mode="external">${icon('bank', 'i-sm')}Other bank</button>
        </div></div>
      ${acc.length ? '' : h`<div class="alert alert-warning">${icon('alert')}<div><strong>No active account</strong><p>You need an active account to send money.</p></div></div>`}
      <div class="transfer-layout">
        <form class="card card-pad" id="xferForm" novalidate>
          <div class="field"><label class="label" for="x-from">From</label><select class="select" id="x-from" name="from">${optionsFor(acc, from && from.id)}</select></div>
          ${mode === 'aureon' ? h`
            <div class="field"><label class="label" for="x-to">Recipient account number</label>
              <input class="input num" id="x-to" name="to" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="10-digit Aureon account number" value="${route.params.get('to') || ''}">
              <div id="x-lookup" aria-live="polite"></div></div>` : ''}
          ${mode === 'own' ? h`
            <div class="field"><label class="label" for="x-to">To</label><select class="select" id="x-to" name="to"></select></div>` : ''}
          ${mode === 'external' ? h`
            <div class="field-row mt-4"><div class="field"><label class="label" for="x-bank">Bank name</label><input class="input" id="x-bank" name="bank" maxlength="80" placeholder="Recipient's bank" value="${route.params.get('bank') || ''}"></div>
              <div class="field"><label class="label" for="x-swift">SWIFT / BIC <small>Optional</small></label><input class="input" id="x-swift" name="swift" maxlength="11" placeholder="e.g. ABCDUS33" style="text-transform:uppercase"></div></div>
            <div class="field"><label class="label" for="x-acct">Account number or IBAN</label><input class="input num" id="x-acct" name="acct" maxlength="34" autocomplete="off" value="${route.params.get('to') || ''}"></div>
            <div class="field"><label class="label" for="x-name">Account holder name</label><input class="input" id="x-name" name="name" maxlength="120" autocomplete="off" value="${route.params.get('name') || ''}"></div>` : ''}
          <div class="field"><label class="label" for="x-amount">Amount</label>
            <div class="input-group"><span class="input-prefix" id="x-sym"></span><input class="input input-xl has-prefix num" id="x-amount" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00"></div>
            <div class="amount-chips">${[50, 100, 250, 500, 1000].map(function (v) { return h`<button type="button" data-chip="${v}">${v.toLocaleString()}</button>`; })}<button type="button" data-chip="max">Max</button></div></div>
          ${mode !== 'own' ? h`<div class="field"><label class="label" for="x-note">Note <small>Optional · shown to you and the recipient</small></label><input class="input" id="x-note" name="note" maxlength="140" placeholder="What's it for?"></div>
            <label class="check mt-4"><input type="checkbox" name="save" id="x-save"> Save as a payee</label>` : ''}
          <div class="form-msg" id="x-msg" role="alert"></div>
          <button class="btn btn-primary btn-lg btn-block mt-6" type="submit" ${acc.length ? '' : 'disabled'}>Review transfer ${icon('arrow-right')}</button>
        </form>
        <div class="stack-lg">
          <aside class="card summary" id="x-summary"></aside>
          ${mode !== 'own' ? h`<section class="card"><div class="card-head"><h3>Saved payees</h3><a class="link small" href="#/settings/payees">Manage</a></div><div class="card-body" id="x-payees">${skeleton(2)}</div></section>` : ''}
        </div>
      </div>`);

    A.on($('#viewBody .page-head'), 'click', '[data-mode]', function (e, b) { location.hash = '#/transfer/' + b.getAttribute('data-mode'); });
    var form = $('#xferForm');
    if (!acc.length) return;
    var fromSel = $('#x-from'), amountIn = $('#x-amount'), lookup = { ok: false };

    function src() { return accountById(fromSel.value); }
    function ownTargets() { return acc.filter(function (a) { return a.id !== fromSel.value; }); }
    function fillOwn() {
      var sel = $('#x-to'); if (!sel) return;
      var keep = sel.value, opts = ownTargets();
      sel.innerHTML = opts.length ? optionsFor(opts, keep).join('') : '<option value="">Open another account first</option>';
    }
    function fee(amount) {
      if (mode === 'own') return 0;
      var s = src();
      if (mode === 'external') return Math.max(convert(Number(st.external_fee_min || 0), st.base_currency || 'USD', s.currency), Math.round(amount * Number(st.external_fee_pct || 0) * 100) / 100);
      return Math.round(amount * Number(st.internal_fee_pct || 0) * 100) / 100;
    }
    function destCurrency() {
      if (mode === 'own') { var t = accountById(($('#x-to') || {}).value); return t ? t.currency : null; }
      if (mode === 'aureon') return lookup.ok ? lookup.currency : null;
      return null;
    }
    function summary() {
      var s = src(); if (!s) return;
      $('#x-sym').textContent = A.symbol(s.currency).trim();
      var amount = Math.max(0, Number(amountIn.value) || 0), f = fee(amount), dc = destCurrency();
      var review = mode === 'external' || (mode === 'aureon' && convert(amount, s.currency, st.base_currency || 'USD') >= Number(st.review_threshold || Infinity));
      $('#x-summary').innerHTML = h`<h3 style="font-size:16px">Summary</h3>
        <div class="kv mt-3">
          <div><span class="k">You send</span><span class="v">${A.money(amount, s.currency)}</span></div>
          <div><span class="k">Fee</span><span class="v">${f ? A.money(f, s.currency) : 'Free'}</span></div>
          ${dc && dc !== s.currency ? h`<div><span class="k">Rate</span><span class="v">1 ${s.currency} = ${convert(1, s.currency, dc).toFixed(4)} ${dc}</span></div><div><span class="k">They receive</span><span class="v">${A.money(convert(amount, s.currency, dc), dc)}</span></div>` : ''}
          <div><span class="k">Arrives</span><span class="v">${mode === 'external' ? 'After review (≈1 business day)' : review ? 'After security review' : 'Instantly'}</span></div>
          <div><span class="k">Available</span><span class="v">${money(s.balance, s.currency)}</span></div>
        </div>
        <div class="total"><span class="muted small">Total debit</span><b>${A.money(amount + f, s.currency)}</b></div>
        ${amount + f > s.balance ? h`<p class="hint error mt-2">That is more than your available balance.</p>` : ''}`.toString();
    }
    var doLookup = A.debounce(function () {
      var v = $('#x-to').value.replace(/\D/g, ''), out = $('#x-lookup');
      lookup = { ok: false };
      if (v.length < 10) { out.innerHTML = ''; summary(); return; }
      out.innerHTML = '<div class="hint mt-2">Looking up account…</div>';
      A.rpc('lookup_account', { p_account_number: v }).then(function (r) {
        if ($('#x-to').value.replace(/\D/g, '') !== v) return;
        if (r && r.found) {
          lookup = { ok: true, name: r.name, currency: r.currency, own: r.own, number: v };
          out.innerHTML = h`<div class="recipient-ok mt-2">${icon('check-circle', 'i-sm')}${r.name} · ${r.currency}${r.own ? ' · your account' : ''}</div>`.toString();
        } else {
          out.innerHTML = h`<div class="recipient-bad mt-2">${icon('alert', 'i-sm')}No Aureon account with that number.</div>`.toString();
        }
        summary();
      }).catch(function (e) { out.innerHTML = h`<div class="hint error mt-2">${A.friendlyError(e)}</div>`.toString(); });
    }, 300);

    if (mode === 'own') fillOwn();
    if (mode === 'aureon') { $('#x-to').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/\D/g, ''); doLookup(); }); if ($('#x-to').value) doLookup(); }
    fromSel.addEventListener('change', function () { fillOwn(); summary(); });
    form.addEventListener('input', summary);
    form.addEventListener('change', summary);
    A.on(form, 'click', '[data-chip]', function (e, b) {
      var v = b.getAttribute('data-chip'), s = src();
      if (v === 'max') { var mx = s.balance; if (mode === 'external') mx = Math.max(0, (s.balance - convert(Number(st.external_fee_min || 0), st.base_currency || 'USD', s.currency)) / (1 + Number(st.external_fee_pct || 0))); else if (mode === 'aureon') mx = s.balance / (1 + Number(st.internal_fee_pct || 0)); amountIn.value = (Math.floor(mx * 100) / 100).toFixed(2); }
      else amountIn.value = v;
      summary();
    });
    summary();

    if (mode !== 'own') {
      A.q(A.sb.from('beneficiaries').select('*').eq('user_id', S.session.user.id).eq('is_internal', mode === 'aureon').order('name')).then(function (rows) {
        if (!isCurrent(token)) return;
        $('#x-payees').innerHTML = (rows.length ? rows.map(function (p) {
          return h`<button class="payee" data-payee="${p.id}"><span class="avatar">${A.initials(p.name)}</span><span class="grow"><b>${p.name}</b><small>${p.bank_name} · ${p.account_number}</small></span>${icon('chevron-right', 'i-sm')}</button>`;
        }).join('') : emptyState('users', 'No saved payees', 'Tick "Save as a payee" when you send to someone.')).toString();
        A.on($('#x-payees'), 'click', '[data-payee]', function (e, b) {
          var p = rows.find(function (x) { return x.id === b.getAttribute('data-payee'); });
          if (mode === 'aureon') { $('#x-to').value = p.account_number; doLookup(); }
          else { $('#x-bank').value = p.bank_name; $('#x-acct').value = p.account_number; $('#x-name').value = p.name; if (p.swift_code) $('#x-swift').value = p.swift_code; }
          amountIn.focus();
        });
      }).catch(function () { $('#x-payees').innerHTML = ''; });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msgEl = $('#x-msg'), s = src();
      var fail = function (m) { msgEl.innerHTML = h`<div class="alert alert-danger">${icon('alert')}<span>${m}</span></div>`.toString(); };
      msgEl.innerHTML = '';
      var amount = Math.round((Number(amountIn.value) || 0) * 100) / 100;
      if (mode !== 'own' && !guardSend()) return;
      if (!guardActive()) return;
      if (amount <= 0) return fail('Enter an amount greater than zero.');
      if (amount + fee(amount) > s.balance) return fail('Insufficient funds — your available balance is ' + A.money(s.balance, s.currency) + '.');
      var d = A.formData(form), recipient, call, title;
      if (mode === 'aureon') {
        if (!lookup.ok) return fail('Enter a valid Aureon account number and wait for the name to appear.');
        if (lookup.number === s.account_number) return fail('You cannot send money to the same account.');
        recipient = lookup.name;
        call = function (pin) { return A.rpc('transfer_funds', { p_from_account: s.id, p_to_account_number: lookup.number, p_amount: amount, p_note: d.note || null, p_pin: pin, p_save_beneficiary: !!d.save, p_idempotency_key: idem }); };
      } else if (mode === 'own') {
        var t = accountById(d.to);
        if (!t) return fail('Choose the account to move money into.');
        recipient = acctLabel(t);
        call = function () { return A.rpc('transfer_funds', { p_from_account: s.id, p_to_account_number: t.account_number, p_amount: amount, p_idempotency_key: idem }); };
      } else {
        if (!d.bank || !d.name) return fail('Enter the recipient bank and account holder name.');
        if (!/^[A-Za-z0-9 -]{6,34}$/.test(d.acct || '')) return fail('Enter a valid account number or IBAN (6–34 letters or digits).');
        recipient = d.name + ' · ' + d.bank;
        call = function (pin) { return A.rpc('external_transfer', { p_from_account: s.id, p_bank_name: d.bank, p_account_number: d.acct, p_account_name: d.name, p_amount: amount, p_note: d.note || null, p_pin: pin, p_swift: d.swift || null, p_save_beneficiary: !!d.save, p_idempotency_key: idem }); };
      }
      title = mode === 'own' ? 'Money moved' : 'Transfer sent';
      var f = fee(amount);
      A.modal({
        title: 'Review transfer',
        body: h`<div class="receipt"><div class="muted small">You are sending</div><div class="receipt-amount">${A.money(amount, s.currency)}</div>
          <div class="kv"><div><span class="k">From</span><span class="v">${acctLabel(s)}</span></div><div><span class="k">To</span><span class="v">${recipient}</span></div>
          ${f ? h`<div><span class="k">Fee</span><span class="v">${A.money(f, s.currency)}</span></div>` : ''}
          <div><span class="k">Total debit</span><span class="v">${A.money(amount + f, s.currency)}</span></div>
          ${d.note ? h`<div><span class="k">Note</span><span class="v">${d.note}</span></div>` : ''}</div></div>`,
        foot: h`<button class="btn btn-ghost" data-close>Edit</button><button class="btn btn-primary" data-ok>${mode === 'own' ? 'Move money' : 'Confirm & enter PIN'}</button>`,
        onOpen: function (el, close) { el.querySelector('[data-ok]').addEventListener('click', function () { close(true); }); }
      }).then(function (go) {
        if (!go) return;
        var run;
        if (mode === 'own') {
          var btn = form.querySelector('[type=submit]'); A.busy(btn, true);
          run = call().then(function (data) { A.busy(btn, false); return { ok: true, data: data }; }, function (err) { A.busy(btn, false); return { ok: false, error: err }; });
        } else run = authorize(call, 'Authorise ' + A.money(amount + f, s.currency) + ' to ' + recipient + '.');
        return run.then(function (res) {
          if (!res) return;
          if (!res.ok) return handleMoneyError(res.error);
          idem = A.uuid();
          form.reset(); lookup = { ok: false };
          if ($('#x-lookup')) $('#x-lookup').innerHTML = '';
          refresh().then(function () { fillOwn(); summary(); });
          showResult(res.data, title);
        });
      });
    });
  };

  /* ---------- Bills ---------- */
  views.payments = function (token) {
    setBody(h`
      <div class="page-head"><div><h2>Pay bills</h2><p>Utilities, airtime, subscriptions and more — paid instantly.</p></div></div>
      <div class="biller-grid">${BILLERS.map(function (b) {
        return h`<button class="biller" data-biller="${b.id}"><span class="ic">${icon(b.icon)}</span><b>${b.name}</b><small>${b.providers.length} provider${b.providers.length > 1 ? 's' : ''}</small></button>`;
      })}</div>
      <section class="card section-gap"><div class="card-head"><h3>Recent bill payments</h3></div><div class="card-body" id="billHistory">${skeleton(3)}</div></section>`);
    A.on($('#viewBody .biller-grid'), 'click', '[data-biller]', function (e, b) { payBill(BILLERS.find(function (x) { return x.id === b.getAttribute('data-biller'); })); });
    fetchTransactions({ kind: 'bill', limit: 10 }).then(function (rows) {
      if (!isCurrent(token)) return;
      remember(rows);
      $('#billHistory').innerHTML = (rows.length ? h`<div class="txn-list">${rows.map(txnRow)}</div>` : emptyState('receipt', 'No bills paid yet', 'Choose a biller above to make your first payment.')).toString();
    });
  };
  function payBill(b) {
    if (!guardSend()) return;
    var acc = activeAccounts().filter(function (a) { return a.status === 'active'; });
    var idem = A.uuid();
    A.modal({
      title: b.name, subtitle: 'Pay instantly from any of your accounts.',
      body: h`<form id="billForm" novalidate>
        <div class="field"><label class="label" for="b-prov">Provider</label><select class="select" id="b-prov" name="provider">${b.providers.map(function (p) { return h`<option>${p}</option>`; })}</select></div>
        <div class="field"><label class="label" for="b-ref">${b.ref}</label><input class="input" id="b-ref" name="ref" maxlength="40" required autocomplete="off"></div>
        <div class="field"><label class="label" for="b-from">Pay from</label><select class="select" id="b-from" name="from">${optionsFor(acc, (primaryAccount() || {}).id)}</select></div>
        <div class="field"><label class="label" for="b-amt">Amount</label><input class="input num" id="b-amt" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required placeholder="0.00"></div>
        <div class="form-msg" id="b-msg" role="alert"></div>
      </form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="billForm">Continue</button>`,
      onOpen: function (el, close) {
        $('#billForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), a = accountById(d.from), amount = Math.round(Number(d.amount) * 100) / 100;
          var fail = function (m) { $('#b-msg', el).innerHTML = h`<div class="alert alert-danger">${icon('alert')}<span>${m}</span></div>`.toString(); };
          if (!d.ref) return fail('Enter your ' + b.ref.toLowerCase() + '.');
          if (!a) return fail('Choose an account to pay from.');
          if (!(amount > 0)) return fail('Enter an amount greater than zero.');
          if (amount > a.balance) return fail('Insufficient funds — available ' + A.money(a.balance, a.currency) + '.');
          close();
          authorize(function (pin) {
            return A.rpc('pay_bill', { p_from_account: a.id, p_biller: d.provider, p_customer_ref: d.ref, p_amount: amount, p_pin: pin, p_category: b.cat, p_idempotency_key: idem });
          }, 'Pay ' + A.money(amount, a.currency) + ' to ' + d.provider + '.').then(function (res) {
            if (!res) return;
            if (!res.ok) return handleMoneyError(res.error);
            refresh(S.route.name === 'payments');
            showResult(res.data, 'Bill paid');
          });
        });
      }
    });
  }

  /* ---------- Cards ---------- */
  views.cards = function (token) {
    setBody(h`<div class="page-head"><div><h2>Cards</h2><p>Virtual cards you control — freeze, limit and cancel instantly.</p></div>
      <div class="page-actions"><button class="btn btn-primary" data-action="new-card">${icon('plus', 'i-sm')}New virtual card</button></div></div>
      <div id="cardList">${skeleton(3)}</div>`);
    A.q(A.sb.from('cards').select('*').eq('user_id', S.session.user.id).order('created_at')).then(function (cards) {
      if (!isCurrent(token)) return;
      var live = cards.filter(function (c) { return c.status !== 'cancelled'; });
      var dead = cards.filter(function (c) { return c.status === 'cancelled'; });
      if (!cards.length) {
        $('#cardList').innerHTML = h`<div class="card">${emptyState('card', 'No cards yet', 'Create a virtual card for online shopping and subscriptions in seconds.', h`<button class="btn btn-primary" data-action="new-card">Create a card</button>`)}</div>`.toString();
        return;
      }
      $('#cardList').innerHTML = h`<div class="cards-row">${live.concat(dead).map(function (c) {
        var acc = accountById(c.account_id);
        return h`<div class="card card-pad" data-card="${c.id}">
          <div class="bank-card ${c.color} ${c.status}" id="vis-${c.id}">${cardFace(c, false)}</div>
          <div class="row-between mt-4"><div><b>${c.label}</b><div class="tiny muted">${acc ? acctLabel(acc) : ''}${c.spend_limit ? ' · limit ' + A.money(c.spend_limit, acc ? acc.currency : 'USD') : ''}</div></div>${statusBadge(c.status)}</div>
          ${c.status !== 'cancelled' ? h`<div class="card-controls">
            <div class="ctl-row"><span>Freeze card<small>Temporarily block all payments</small></span><span class="switch"><input type="checkbox" data-ctl="freeze" ${c.status === 'frozen' ? 'checked' : ''} aria-label="Freeze card"><span></span></span></div>
            <div class="ctl-row"><span>Online payments</span><span class="switch"><input type="checkbox" data-ctl="online" ${c.online_payments ? 'checked' : ''} aria-label="Online payments"><span></span></span></div>
            <div class="ctl-row"><span>Contactless</span><span class="switch"><input type="checkbox" data-ctl="contactless" ${c.contactless ? 'checked' : ''} aria-label="Contactless payments"><span></span></span></div>
          </div>
          <div class="row wrap mt-3">
            <button class="btn btn-soft btn-sm" data-reveal-card>${icon('eye', 'i-sm')}Show details</button>
            <button class="btn btn-soft btn-sm" data-limit>${icon('gauge', 'i-sm')}Spending limit</button>
            <button class="btn btn-ghost btn-sm" data-cancel-card style="color:var(--danger)">${icon('trash', 'i-sm')}Cancel</button>
          </div>` : ''}
        </div>`;
      })}</div>`.toString();
      var byId = {}; cards.forEach(function (c) { byId[c.id] = c; });
      var list = $('#cardList');
      var update = function (c, args, okMsg) {
        args.p_card = c.id;
        return A.rpc('update_card', args).then(function () { if (okMsg) A.toast(okMsg, { type: 'success' }); render(true); }, function (err) { A.toast(A.friendlyError(err), { type: 'error' }); render(true); });
      };
      A.on(list, 'change', '[data-ctl]', function (e, input) {
        var c = byId[input.closest('[data-card]').getAttribute('data-card')], k = input.getAttribute('data-ctl');
        if (k === 'freeze') { $('#vis-' + c.id).classList.toggle('frozen', input.checked); update(c, { p_status: input.checked ? 'frozen' : 'active' }, input.checked ? 'Card frozen' : 'Card unfrozen'); }
        if (k === 'online') update(c, { p_online: input.checked }, 'Online payments ' + (input.checked ? 'on' : 'off'));
        if (k === 'contactless') update(c, { p_contactless: input.checked }, 'Contactless ' + (input.checked ? 'on' : 'off'));
      });
      A.on(list, 'click', '[data-reveal-card]', function (e, b) {
        var c = byId[b.closest('[data-card]').getAttribute('data-card')], vis = $('#vis-' + c.id);
        var showing = b.getAttribute('data-showing') === '1';
        vis.innerHTML = cardFace(c, !showing).toString();
        b.setAttribute('data-showing', showing ? '0' : '1');
        b.innerHTML = h`${icon(showing ? 'eye' : 'eye-off', 'i-sm')}${showing ? 'Show details' : 'Hide details'}`.toString();
        if (!showing) setTimeout(function () { if (b.getAttribute('data-showing') === '1') b.click(); }, 30000);
      });
      A.on(list, 'click', '[data-limit]', function (e, b) {
        var c = byId[b.closest('[data-card]').getAttribute('data-card')], acc = accountById(c.account_id);
        A.prompt({ title: 'Spending limit', subtitle: 'Leave empty to remove the limit.', label: 'Monthly limit (' + (acc ? acc.currency : '') + ')', type: 'number', value: c.spend_limit || '' }).then(function (v) {
          if (v === null) return;
          if (v === '') return update(c, { p_clear_limit: true }, 'Limit removed');
          if (!(Number(v) > 0)) return A.toast('Enter an amount greater than zero', { type: 'error' });
          update(c, { p_spend_limit: Number(v) }, 'Limit updated');
        });
      });
      A.on(list, 'click', '[data-cancel-card]', function (e, b) {
        var c = byId[b.closest('[data-card]').getAttribute('data-card')];
        A.confirm({ title: 'Cancel this card?', body: 'Card ending ' + c.last4 + ' will stop working permanently. You can create a new one at any time.', confirmText: 'Cancel card', danger: true }).then(function (ok) {
          if (ok) update(c, { p_status: 'cancelled' }, 'Card cancelled');
        });
      });
    });
  };
  function cardFace(c, reveal) {
    var num = reveal ? A.groupDigits(c.card_number) : '•••• •••• •••• ' + c.last4;
    return h`<div class="bc-top"><span>AUREON</span>${icon('contactless')}</div>
      <div class="row" style="gap:14px"><span class="chip"></span>${reveal ? h`<button class="copy-btn" style="color:inherit" data-copy="${c.card_number}" aria-label="Copy card number">${icon('copy', 'i-sm')}</button>` : ''}</div>
      <div class="bc-num">${num}</div>
      <div class="bc-bot"><div><small>${reveal ? 'EXPIRES' : 'CARD'}</small>${reveal ? String(c.exp_month).padStart(2, '0') + '/' + String(c.exp_year).slice(-2) : c.label.toUpperCase()}</div>${reveal ? h`<div><small>CVV</small>${c.cvv}</div>` : ''}<span class="net">${c.network === 'mastercard' ? 'mastercard' : 'VISA'}</span></div>`;
  }
  function newCardFlow() {
    if (!guardActive()) return;
    var acc = activeAccounts().filter(function (a) { return a.status === 'active'; });
    A.modal({
      title: 'New virtual card', subtitle: 'Ready to use instantly for online payments.',
      body: h`<form id="cardForm">
        <div class="field"><label class="label" for="c-label">Card name</label><input class="input" id="c-label" name="label" maxlength="40" placeholder="e.g. Subscriptions" required></div>
        <div class="field"><label class="label" for="c-acc">Linked account</label><select class="select" id="c-acc" name="account">${optionsFor(acc, (primaryAccount() || {}).id)}</select></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="c-net">Network</label><select class="select" id="c-net" name="network"><option value="visa">Visa</option><option value="mastercard">Mastercard</option></select></div>
        <div class="field"><span class="label">Design</span><div class="icon-pick">${['midnight', 'gold', 'aurora', 'graphite'].map(function (c, i) {
          return h`<label title="${c}"><input type="radio" name="color" value="${c}" ${i === 0 ? 'checked' : ''}><span class="bank-card ${c}" style="width:44px;height:44px;aspect-ratio:auto;padding:0;border-radius:12px"></span></label>`;
        })}</div></div></div>
      </form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="cardForm">Create card</button>`,
      onOpen: function (el, close) {
        $('#cardForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=cardForm]');
          A.busy(btn, true);
          A.rpc('create_card', { p_account: d.account, p_label: d.label || 'Virtual card', p_color: d.color, p_network: d.network }).then(function () {
            close(); A.toast('Card created', { type: 'success' });
            if (S.route.name === 'cards') render(true); else location.hash = '#/cards';
          }).catch(function (err) { A.busy(btn, false); A.toast('Could not create card', { type: 'error', body: A.friendlyError(err) }); });
        });
      }
    });
  }

  /* ---------- Savings ---------- */
  views.savings = function (token) {
    setBody(h`<div class="page-head"><div><h2>Savings goals</h2><p>Put money aside for the things that matter.</p></div>
      <div class="page-actions"><button class="btn btn-primary" data-action="new-goal">${icon('plus', 'i-sm')}New goal</button></div></div>
      <div id="goalList">${skeleton(3)}</div>`);
    A.q(A.sb.from('savings_goals').select('*').eq('user_id', S.session.user.id).neq('status', 'closed').order('created_at')).then(function (goals) {
      if (!isCurrent(token)) return;
      if (!goals.length) {
        $('#goalList').innerHTML = h`<div class="card">${emptyState('piggy', 'Start your first goal', 'A holiday, a home, a rainy-day fund — name it and start saving.', h`<button class="btn btn-primary" data-action="new-goal">Create a goal</button>`)}</div>`.toString();
        return;
      }
      var total = goals.reduce(function (s, g) { return s + convert(g.saved_amount, g.currency, displayCcy()); }, 0);
      $('#goalList').innerHTML = h`
        <div class="grid-4" style="margin-bottom:18px"><div class="stat"><div class="k">${icon('piggy')}Total saved</div><div class="v">${money(total, displayCcy())}</div></div>
          <div class="stat"><div class="k">${icon('target')}Active goals</div><div class="v">${goals.length}</div></div></div>
        <div class="grid-3">${goals.map(function (g) {
          var pct = Math.min(100, Math.round(g.saved_amount / g.target_amount * 100));
          var days = g.target_date ? Math.ceil((new Date(g.target_date) - new Date()) / 86400000) : null;
          return h`<article class="card goal" data-goal="${g.id}">
            <div class="goal-top"><span class="goal-ic">${icon(g.icon)}</span><div class="grow"><b>${g.name}</b><div class="tiny muted">${g.target_date ? (days >= 0 ? days + ' days left' : 'Target date passed') + ' · ' + A.date(g.target_date) : 'No deadline'}</div></div>${g.status === 'completed' ? h`<span class="badge badge-success">Reached</span>` : ''}</div>
            <div><div class="row-between"><b style="font-size:22px;letter-spacing:-.03em" class="num">${money(g.saved_amount, g.currency)}</b><span class="small muted">of ${A.money(g.target_amount, g.currency, { noCents: true })}</span></div>
              <div class="progress mt-2 ${pct >= 100 ? 'done' : ''}"><span style="width:${pct}%"></span></div><div class="tiny muted mt-1">${pct}% saved</div></div>
            <div class="row wrap"><button class="btn btn-primary btn-sm" data-goal-op="in">${icon('plus', 'i-sm')}Add money</button><button class="btn btn-soft btn-sm" data-goal-op="out" ${g.saved_amount > 0 ? '' : 'disabled'}>${icon('minus', 'i-sm')}Withdraw</button><button class="btn btn-ghost btn-sm" data-goal-op="close">Close</button></div>
          </article>`;
        })}</div>`.toString();
      A.on($('#goalList'), 'click', '[data-goal-op]', function (e, b) {
        var g = goals.find(function (x) { return x.id === b.closest('[data-goal]').getAttribute('data-goal'); });
        goalMove(g, b.getAttribute('data-goal-op'));
      });
    });
  };
  function goalMove(g, op) {
    if (!guardActive()) return;
    var acc = activeAccounts().filter(function (a) { return a.status === 'active'; });
    var pick = acc.find(function (a) { return a.currency === g.currency; }) || primaryAccount();
    if (op === 'close') {
      return A.modal({
        title: 'Close "' + g.name + '"?', subtitle: g.saved_amount > 0 ? 'The ' + A.money(g.saved_amount, g.currency) + ' saved will be returned to:' : 'This goal will be removed.',
        body: g.saved_amount > 0 ? h`<select class="select" id="g-acc">${optionsFor(acc, pick && pick.id)}</select>` : h`<p class="muted">You can create a new goal at any time.</p>`,
        foot: h`<button class="btn btn-ghost" data-close>Keep goal</button><button class="btn btn-danger" data-ok>Close goal</button>`,
        onOpen: function (el, close) {
          el.querySelector('[data-ok]').addEventListener('click', function (e) {
            A.busy(e.currentTarget, true);
            A.rpc('close_goal', { p_goal: g.id, p_account: ($('#g-acc', el) || {}).value || (pick && pick.id) }).then(function () {
              close(); A.toast('Goal closed', { type: 'success' }); refresh(true);
            }, function (err) { A.busy(e.currentTarget, false); A.toast(A.friendlyError(err), { type: 'error' }); });
          });
        }
      });
    }
    var isIn = op === 'in';
    A.modal({
      title: isIn ? 'Add to ' + g.name : 'Withdraw from ' + g.name,
      subtitle: isIn ? 'Amount is taken in the selected account\'s currency.' : 'Available in goal: ' + A.money(g.saved_amount, g.currency),
      body: h`<form id="goalForm"><div class="field"><label class="label" for="g-acc">${isIn ? 'From account' : 'To account'}</label><select class="select" id="g-acc" name="account">${optionsFor(acc, pick && pick.id)}</select></div>
        <div class="field"><label class="label" for="g-amt">Amount <small id="g-ccy"></small></label><input class="input num" id="g-amt" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="goalForm">${isIn ? 'Add money' : 'Withdraw'}</button>`,
      onOpen: function (el, close) {
        var lab = function () { var a = accountById($('#g-acc', el).value); $('#g-ccy', el).textContent = isIn ? (a ? a.currency : '') : g.currency; };
        lab(); $('#g-acc', el).addEventListener('change', lab);
        $('#goalForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=goalForm]');
          A.busy(btn, true);
          A.rpc('move_goal_funds', { p_goal: g.id, p_account: d.account, p_amount: Number(d.amount), p_direction: op }).then(function (r) {
            close(); A.toast(isIn ? (r.status === 'completed' ? 'Goal reached! 🎉' : 'Money added') : 'Money withdrawn', { type: 'success' }); refresh(true);
          }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
        });
      }
    });
  }
  function newGoalFlow() {
    if (!guardActive()) return;
    var ccy = (primaryAccount() || {}).currency || 'USD';
    A.modal({
      title: 'New savings goal',
      body: h`<form id="newGoal">
        <div class="field"><label class="label" for="ng-name">Goal name</label><input class="input" id="ng-name" name="name" maxlength="60" required placeholder="e.g. Summer in Lisbon"></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="ng-target">Target amount</label><input class="input num" id="ng-target" name="target" type="number" min="1" step="0.01" required></div>
          <div class="field"><label class="label" for="ng-ccy">Currency</label><select class="select" id="ng-ccy" name="currency">${Object.keys(S.rates).map(function (c) { return h`<option ${c === ccy ? 'selected' : ''}>${c}</option>`; })}</select></div></div>
        <div class="field"><label class="label" for="ng-date">Target date <small>Optional</small></label><input class="input" id="ng-date" name="date" type="date" min="${A.date(new Date(), 'iso')}"></div>
        <div class="field"><span class="label">Icon</span><div class="icon-pick">${GOAL_ICONS.map(function (ic, i) { return h`<label><input type="radio" name="icon" value="${ic}" ${i === 0 ? 'checked' : ''}><span>${icon(ic)}</span></label>`; })}</div></div>
      </form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="newGoal">Create goal</button>`,
      onOpen: function (el, close) {
        $('#newGoal', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=newGoal]');
          A.busy(btn, true);
          A.rpc('create_goal', { p_name: d.name, p_currency: d.currency, p_target: Number(d.target), p_target_date: d.date || null, p_icon: d.icon }).then(function () {
            close(); A.toast('Goal created', { type: 'success' });
            if (S.route.name === 'savings') render(true); else location.hash = '#/savings';
          }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
        });
      }
    });
  }

  /* ---------- Loans ---------- */
  function quote(P, n) {
    var r = Number(S.settings.loan_apr || 0) / 12;
    var pmt = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));
    return { monthly: pmt, total: pmt * n };
  }
  views.loans = function (token) {
    var acc = activeAccounts().filter(function (a) { return a.status === 'active'; });
    var base = S.settings.base_currency || 'USD';
    setBody(h`<div class="page-head"><div><h2>Loans</h2><p>Fixed ${(Number(S.settings.loan_apr || 0) * 100).toFixed(2)}% APR · no early-repayment fees.</p></div></div>
      <div class="transfer-layout">
        <form class="card card-pad" id="loanForm">
          <h3 style="font-size:17px">Apply for a loan</h3>
          <div class="field mt-4"><label class="label" for="l-acc">Pay into</label><select class="select" id="l-acc" name="account">${optionsFor(acc, (primaryAccount() || {}).id)}</select></div>
          <div class="field"><label class="label" for="l-amt">Amount <small id="l-max"></small></label><input class="input input-xl num" id="l-amt" name="amount" type="number" min="1" step="1" value="5000" required></div>
          <div class="field"><label class="label" for="l-term">Term</label><select class="select" id="l-term" name="term">${[3, 6, 12, 18, 24, 36, 48, 60].map(function (n) { return h`<option value="${n}" ${n === 12 ? 'selected' : ''}>${n} months</option>`; })}</select></div>
          <div class="field"><label class="label" for="l-purpose">Purpose</label><input class="input" id="l-purpose" name="purpose" maxlength="280" placeholder="e.g. Home improvements"></div>
          <div class="grid-2 mt-4" id="l-quote"></div>
          <button class="btn btn-primary btn-lg btn-block mt-6" type="submit" ${acc.length ? '' : 'disabled'}>Submit application</button>
        </form>
        <section class="card"><div class="card-head"><h3>Your loans</h3></div><div class="card-body" id="loanList">${skeleton(2)}</div></section>
      </div>`);
    var form = $('#loanForm');
    var upd = function () {
      var a = accountById($('#l-acc').value) || {};
      var P = Number($('#l-amt').value) || 0, n = Number($('#l-term').value), q = quote(P, n);
      $('#l-max').textContent = 'Max ' + A.money(convert(Number(S.settings.max_loan || 0), base, a.currency || base), a.currency || base, { noCents: true });
      $('#l-quote').innerHTML = h`<div class="stat"><div class="k">Monthly payment</div><div class="v">${A.money(q.monthly, a.currency || base)}</div></div><div class="stat"><div class="k">Total to repay</div><div class="v">${A.money(q.total, a.currency || base)}</div></div>`.toString();
    };
    form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!guardSend()) return;
      var d = A.formData(form), btn = form.querySelector('[type=submit]');
      A.busy(btn, true);
      A.rpc('apply_loan', { p_account: d.account, p_amount: Number(d.amount), p_term: Number(d.term), p_purpose: d.purpose || '' }).then(function () {
        A.toast('Application received', { type: 'success', body: 'We will notify you once it has been reviewed.' }); render(true);
      }, function (err) { A.busy(btn, false); A.toast('Application not submitted', { type: 'error', body: A.friendlyError(err) }); });
    });
    A.q(A.sb.from('loans').select('*').eq('user_id', S.session.user.id).order('created_at', { ascending: false })).then(function (loans) {
      if (!isCurrent(token)) return;
      $('#loanList').innerHTML = (loans.length ? h`<div class="stack">${loans.map(function (l) {
        var paid = l.status === 'active' || l.status === 'repaid' ? Math.round((1 - l.outstanding / l.total_repayable) * 100) : 0;
        return h`<div class="stack" style="gap:10px;padding-bottom:14px;border-bottom:1px solid var(--border)">
          <div class="row-between"><b>${A.money(l.amount, l.currency)} · ${l.term_months} months</b>${statusBadge(l.status)}</div>
          <div class="small muted">${l.purpose || 'Personal loan'} · applied ${A.date(l.created_at)} · ${A.money(l.monthly_payment, l.currency)}/month</div>
          ${l.status === 'active' || l.status === 'repaid' ? h`<div class="progress ${l.status === 'repaid' ? 'done' : ''}"><span style="width:${paid}%"></span></div><div class="row-between small"><span class="muted">Outstanding</span><b class="num">${A.money(l.outstanding, l.currency)}</b></div>` : ''}
          ${l.admin_note ? h`<div class="small muted">Note: ${l.admin_note}</div>` : ''}
          ${l.status === 'active' ? h`<button class="btn btn-soft btn-sm" style="justify-self:start" data-repay="${l.id}">${icon('coins', 'i-sm')}Make a repayment</button>` : ''}
        </div>`;
      })}</div>` : emptyState('handshake', 'No loans', 'Use the calculator to see your monthly payment, then apply in a minute.')).toString();
      A.on($('#loanList'), 'click', '[data-repay]', function (e, b) { repayFlow(loans.find(function (l) { return l.id === b.getAttribute('data-repay'); })); });
    });
  };
  function repayFlow(l) {
    var acc = activeAccounts().filter(function (a) { return a.status === 'active'; });
    A.modal({
      title: 'Repay loan', subtitle: 'Outstanding: ' + A.money(l.outstanding, l.currency),
      body: h`<form id="repayForm"><div class="field"><label class="label" for="r-acc">Pay from</label><select class="select" id="r-acc" name="account">${optionsFor(acc, (acc.find(function (a) { return a.currency === l.currency; }) || primaryAccount() || {}).id)}</select></div>
        <div class="field"><label class="label" for="r-amt">Amount (${l.currency})</label><input class="input num" id="r-amt" name="amount" type="number" min="0.01" step="0.01" value="${Math.min(l.monthly_payment, l.outstanding)}" required>
        <div class="amount-chips"><button type="button" data-fill="${l.monthly_payment}">Monthly payment</button><button type="button" data-fill="${l.outstanding}">Pay in full</button></div></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="repayForm">Repay</button>`,
      onOpen: function (el, close) {
        A.on(el, 'click', '[data-fill]', function (e, b) { $('#r-amt', el).value = Number(b.getAttribute('data-fill')).toFixed(2); });
        $('#repayForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=repayForm]');
          A.busy(btn, true);
          A.rpc('repay_loan', { p_loan: l.id, p_account: d.account, p_amount: Number(d.amount) }).then(function (r) {
            close(); A.toast(r.status === 'repaid' ? 'Loan fully repaid 🎉' : 'Repayment made', { type: 'success' }); refresh(true);
          }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
        });
      }
    });
  }

  /* ---------- Activity ---------- */
  views.transactions = function (token, route) {
    var f = { account: route.params.get('account') || '', direction: '', status: '', search: '', since: '', until: '' };
    var offset = 0, PAGE = 40, all = [];
    setBody(h`<div class="page-head"><div><h2>Activity</h2><p>Every payment, transfer and deposit.</p></div>
      <div class="page-actions"><button class="btn btn-soft" data-action="statement">${icon('file', 'i-sm')}Statement</button><button class="btn btn-soft" id="csvBtn">${icon('download', 'i-sm')}Export CSV</button></div></div>
      <div class="filters">
        <label class="search"><span class="sr-only">Search</span>${icon('search')}<input class="input" id="f-search" type="search" placeholder="Search name, description or reference"></label>
        <select class="select" id="f-account" aria-label="Account"><option value="">All accounts</option>${S.accounts.map(function (a) { return h`<option value="${a.id}" ${a.id === f.account ? 'selected' : ''}>${acctLabel(a)}</option>`; })}</select>
        <select class="select" id="f-direction" aria-label="Direction"><option value="">Money in &amp; out</option><option value="credit">Money in</option><option value="debit">Money out</option></select>
        <select class="select" id="f-status" aria-label="Status"><option value="">Any status</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="declined">Declined</option><option value="reversed">Reversed</option></select>
        <input class="input" id="f-since" type="date" aria-label="From date">
        <input class="input" id="f-until" type="date" aria-label="To date">
      </div>
      <section class="card"><div class="card-body" id="txnBody">${skeleton(6)}</div><div class="pager" id="txnMore" hidden><button class="btn btn-soft">Load more</button></div></section>`);
    var opts = function () {
      return { account: f.account, direction: f.direction, status: f.status, search: f.search,
        since: f.since ? new Date(f.since + 'T00:00:00').toISOString() : null, until: f.until ? new Date(f.until + 'T23:59:59').toISOString() : null };
    };
    var load = function (reset) {
      if (reset) { offset = 0; all = []; $('#txnBody').innerHTML = skeleton(6).toString(); }
      var my = token;
      fetchTransactions(Object.assign(opts(), { offset: offset, limit: PAGE })).then(function (rows) {
        if (!isCurrent(my)) return;
        remember(rows);
        all = all.concat(rows); offset += rows.length;
        $('#txnBody').innerHTML = (all.length ? h`<div class="txn-list">${txnGroups(all)}</div>` : emptyState('search', 'No transactions found', 'Try a different filter or date range.')).toString();
        $('#txnMore').hidden = rows.length < PAGE;
      }).catch(function (e) { $('#txnBody').innerHTML = emptyState('alert', 'Could not load activity', A.friendlyError(e)).toString(); });
    };
    var bind = function (id, key, ev) { $(id).addEventListener(ev || 'change', function (e) { f[key] = e.target.value.trim(); load(true); }); };
    bind('#f-account', 'account'); bind('#f-direction', 'direction'); bind('#f-status', 'status'); bind('#f-since', 'since'); bind('#f-until', 'until');
    $('#f-search').addEventListener('input', A.debounce(function (e) { f.search = e.target.value.trim(); load(true); }, 300));
    $('#txnMore button').addEventListener('click', function () { load(false); });
    $('#csvBtn').addEventListener('click', function (e) {
      var btn = e.currentTarget; A.busy(btn, true);
      fetchTransactions(Object.assign(opts(), { limit: 2000 })).then(function (rows) {
        A.busy(btn, false);
        A.downloadCSV('aureon-activity-' + A.date(new Date(), 'iso') + '.csv', [['Date', 'Reference', 'Description', 'Counterparty', 'Account', 'Direction', 'Amount', 'Fee', 'Currency', 'Status', 'Balance after', 'Category', 'Note']].concat(rows.map(function (t) {
          var a = accountById(t.account_id);
          return [new Date(t.created_at).toISOString(), t.reference, t.description, t.counterparty_name, a ? a.account_number : '', t.direction, t.amount, t.fee, t.currency, t.status, t.balance_after, t.category, t.note];
        })));
      }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
    });
    load(true);
  };
  function statementFlow() {
    var today = A.date(new Date(), 'iso'), first = A.date(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'iso');
    A.modal({
      title: 'Account statement', subtitle: 'Opens a printable statement you can save as PDF.',
      body: h`<form id="stmtForm"><div class="field"><label class="label" for="s-acc">Account</label><select class="select" id="s-acc" name="account">${S.accounts.map(function (a) { return h`<option value="${a.id}">${acctLabel(a)} · ${a.currency}</option>`; })}</select></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="s-from">From</label><input class="input" id="s-from" name="from" type="date" value="${first}" max="${today}" required></div>
        <div class="field"><label class="label" for="s-to">To</label><input class="input" id="s-to" name="to" type="date" value="${today}" max="${today}" required></div></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="stmtForm">${icon('printer', 'i-sm')}Generate</button>`,
      onOpen: function (el, close) {
        $('#stmtForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), a = accountById(d.account);
          if (d.from > d.to) return A.toast('The start date must be before the end date', { type: 'error' });
          var w = window.open('', '_blank');   // open synchronously so pop-up blockers allow it
          fetchTransactions({ account: a.id, since: new Date(d.from + 'T00:00:00').toISOString(), until: new Date(d.to + 'T23:59:59').toISOString(), limit: 2000 }).then(function (rows) {
            close();
            rows = rows.slice().reverse();
            var tin = 0, tout = 0;
            rows.forEach(function (t) { if (!counts(t)) return; if (t.direction === 'credit') tin += t.amount; else tout += t.amount + t.fee; });
            var body = rows.map(function (t) {
              var amt = t.direction === 'credit' ? t.amount : t.amount + t.fee;
              return '<tr><td>' + A.esc(A.date(t.created_at)) + '</td><td>' + A.esc(t.description) + '<br><span class="muted">' + A.esc(t.reference) + (t.status !== 'completed' ? ' · ' + A.esc(t.status) : '') + '</span></td><td class="r">' + (t.direction === 'debit' ? A.esc(A.money(amt, t.currency)) : '') + '</td><td class="r">' + (t.direction === 'credit' ? A.esc(A.money(amt, t.currency)) : '') + '</td><td class="r">' + (t.balance_after != null ? A.esc(A.money(t.balance_after, t.currency)) : '—') + '</td></tr>';
            }).join('');
            var html = '<div class="brand"><div><b>Aureon</b><div class="muted">Account statement</div></div><div style="text-align:right"><b>' + A.esc(S.profile.full_name) + '</b><div class="muted">' + A.esc(acctName(a)) + ' · ' + A.esc(a.account_number) + ' · ' + a.currency + '</div><div class="muted">' + A.esc(A.date(d.from)) + ' – ' + A.esc(A.date(d.to)) + '</div></div></div>' +
              '<div class="sum"><div>Money in<br><b>' + A.esc(A.money(tin, a.currency)) + '</b></div><div>Money out<br><b>' + A.esc(A.money(tout, a.currency)) + '</b></div><div>Current balance<br><b>' + A.esc(A.money(a.balance, a.currency)) + '</b></div></div>' +
              '<table><thead><tr><th>Date</th><th>Description</th><th class="r">Money out</th><th class="r">Money in</th><th class="r">Balance</th></tr></thead><tbody>' + (body || '<tr><td colspan="5" class="muted">No transactions in this period.</td></tr>') + '</tbody></table>';
            if (!w) { A.toast('Allow pop-ups to view the statement', { type: 'warning' }); return; }
            printDoc('Statement ' + a.account_number, html, w);
          }, function (err) { if (w) w.close(); A.toast(A.friendlyError(err), { type: 'error' }); });
        });
      }
    });
  }

  /* ---------- Insights ---------- */
  views.insights = function (token, route) {
    var months = Number(route.params.get('m')) || 6, ccy = displayCcy();
    setBody(h`<div class="page-head"><div><h2>Insights</h2><p>Where your money comes from and where it goes · ${ccy}</p></div>
      <div class="segmented" role="tablist">${[3, 6, 12].map(function (m) { return h`<button role="tab" aria-selected="${m === months}" data-m="${m}">${m} months</button>`; })}</div></div>
      <div class="grid-4" id="insStats">${[1, 2, 3, 4].map(function () { return h`<div class="stat"><div class="skeleton" style="height:48px"></div></div>`; })}</div>
      <div class="grid-2 section-gap">
        <section class="card"><div class="card-head"><h3>Cash flow</h3></div><div class="card-body" id="insFlow">${skeleton(3)}</div></section>
        <section class="card"><div class="card-head"><h3>Spending by category</h3></div><div class="card-body" id="insCats">${skeleton(3)}</div></section>
      </div>
      <section class="card section-gap"><div class="card-head"><h3>Top recipients</h3></div><div class="card-body" id="insTop">${skeleton(3)}</div></section>`);
    A.on($('#viewBody .page-head'), 'click', '[data-m]', function (e, b) { location.hash = '#/insights?m=' + b.getAttribute('data-m'); });
    var since = new Date(); since.setMonth(since.getMonth() - (months - 1)); since.setDate(1); since.setHours(0, 0, 0, 0);
    fetchTransactions({ since: since.toISOString(), limit: 2000 }).then(function (txns) {
      if (!isCurrent(token)) return;
      var keys = lastMonths(months), inn = {}, out = {}, tin = 0, tout = 0, saved = 0, recips = {};
      keys.forEach(function (k) { inn[k] = 0; out[k] = 0; });
      txns.forEach(function (t) {
        if (!counts(t) || t.kind === 'reversal') return;
        var v = convert(t.direction === 'debit' ? t.amount + t.fee : t.amount, t.currency, ccy), k = monthKey(t.created_at);
        if (t.category === 'savings' && t.direction === 'debit') saved += v;
        if (isOwnMove(t)) return;
        if (t.direction === 'credit') { tin += v; if (k in inn) inn[k] += v; }
        else {
          tout += v; if (k in out) out[k] += v;
          if (t.kind === 'transfer' || t.kind === 'external' || t.kind === 'bill') { var n = t.counterparty_name || 'Unknown'; recips[n] = recips[n] || { name: n, total: 0, count: 0 }; recips[n].total += v; recips[n].count++; }
        }
      });
      var net = tin - tout, rate = tin > 0 ? Math.max(0, Math.round(net / tin * 100)) : 0;
      $('#insStats').innerHTML = h`
        <div class="stat"><div class="k">${icon('arrow-down-left')}Money in</div><div class="v">${money(tin, ccy, { noCents: true })}</div><div class="d">${months}-month total</div></div>
        <div class="stat"><div class="k">${icon('arrow-up-right')}Money out</div><div class="v">${money(tout, ccy, { noCents: true })}</div><div class="d">${months}-month total</div></div>
        <div class="stat"><div class="k">${icon('scale')}Net</div><div class="v">${net < 0 ? '−' : '+'}${money(Math.abs(net), ccy, { noCents: true })}</div><div class="d ${net >= 0 ? 'up' : 'down'}">${net >= 0 ? 'You kept more than you spent' : 'You spent more than came in'}</div></div>
        <div class="stat"><div class="k">${icon('piggy')}Savings rate</div><div class="v">${rate}%</div><div class="d">${money(saved, ccy, { noCents: true })} moved to goals</div></div>`.toString();
      if (!txns.length) {
        $('#insFlow').innerHTML = emptyState('chart', 'No data yet', 'Insights appear once money starts moving.').toString();
        $('#insCats').innerHTML = ''; $('#insTop').innerHTML = '';
        return;
      }
      Charts.bars($('#insFlow'), { labels: keys.map(monthLabel), height: 240, label: 'Money in and out per month',
        series: [{ name: 'Money in', color: 'var(--series-1)', values: keys.map(function (k) { return inn[k]; }) }, { name: 'Money out', color: 'var(--series-2)', values: keys.map(function (k) { return out[k]; }) }],
        format: function (v) { return A.money(v, ccy); } });
      renderSpendDonut($('#insCats'), txns, ccy, 180);
      var top = Object.keys(recips).map(function (k) { return recips[k]; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 6);
      $('#insTop').innerHTML = (top.length ? h`<div class="stack">${top.map(function (r) {
        var pct = Math.round(r.total / top[0].total * 100);
        return h`<div class="row"><span class="avatar mini-avatar">${A.initials(r.name)}</span><div class="grow"><div class="row-between small"><b>${r.name}</b><b class="num">${money(r.total, ccy)}</b></div><div class="progress mt-1" style="height:6px"><span style="width:${pct}%;background:var(--series-2)"></span></div><div class="tiny muted mt-1">${r.count} payment${r.count > 1 ? 's' : ''}</div></div></div>`;
      })}</div>` : emptyState('users', 'No payments yet', 'People and billers you pay most will appear here.')).toString();
    });
  };

  /* ---------- Support ---------- */
  views.support = function (token, route) {
    setBody(h`<div class="page-head"><div><h2>Support</h2><p>Message our team. We reply here and notify you.</p></div>
      <div class="page-actions"><button class="btn btn-primary" data-action="new-ticket">${icon('plus', 'i-sm')}New request</button></div></div>
      <div class="ticket-layout"><section class="card" style="overflow:hidden"><div id="ticketList">${skeleton(3)}</div></section><section class="card" id="ticketView"></section></div>`);
    A.q(A.sb.from('support_tickets').select('*').eq('user_id', S.session.user.id).order('updated_at', { ascending: false })).then(function (tickets) {
      if (!isCurrent(token)) return;
      var current = route.sub || (tickets[0] && tickets[0].id);
      $('#ticketList').innerHTML = (tickets.length ? tickets.map(function (t) {
        return h`<a class="ticket-item ${t.id === current ? 'active' : ''}" href="#/support/${t.id}"><div class="row-between"><b class="truncate">${t.subject}</b>${statusBadge(t.status)}</div><small>${A.date(t.updated_at, 'relative')} · ${t.category}</small></a>`;
      }).join('') : emptyState('message', 'No requests yet', 'Questions about a payment, your card or your account? We are here to help.')).toString();
      var t = tickets.find(function (x) { return x.id === current; });
      if (!t) { $('#ticketView').innerHTML = emptyState('support', 'How can we help?', 'Start a new request and our team will reply as soon as possible.', h`<button class="btn btn-primary" data-action="new-ticket">New request</button>`).toString(); return; }
      renderThread(t, token);
    });
  };
  function renderThread(t, token) {
    A.q(A.sb.from('ticket_messages').select('*').eq('ticket_id', t.id).order('created_at')).then(function (msgs) {
      if (!isCurrent(token)) return;
      $('#ticketView').innerHTML = h`<div class="card-head"><div><h3>${t.subject}</h3><div class="tiny muted">Opened ${A.date(t.created_at, 'long')}</div></div>
          ${t.status !== 'closed' ? h`<button class="btn btn-ghost btn-sm" data-close-ticket>Mark resolved</button>` : statusBadge('closed')}</div>
        <div class="chat" id="chat">${msgs.map(function (m) { return h`<div class="bubble ${m.is_staff ? 'staff' : 'me'}">${m.body}<small>${m.is_staff ? 'Aureon support · ' : ''}${A.date(m.created_at, 'relative')}</small></div>`; })}</div>
        <form class="chat-form" id="chatForm"><label class="sr-only" for="chatInput">Message</label><textarea class="textarea" id="chatInput" maxlength="4000" placeholder="${t.status === 'closed' ? 'Reply to reopen this request' : 'Write a message…'}" required></textarea><button class="btn btn-primary" type="submit" aria-label="Send">${icon('send')}</button></form>`.toString();
      var chat = $('#chat'); chat.scrollTop = chat.scrollHeight;
      $('#chatForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var v = $('#chatInput').value.trim(), btn = e.target.querySelector('button');
        if (!v) return;
        A.busy(btn, true);
        A.rpc('post_ticket_message', { p_ticket: t.id, p_body: v }).then(function () { render(true); }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
      });
      $('#chatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
      var closeBtn = $('[data-close-ticket]');
      if (closeBtn) closeBtn.addEventListener('click', function () { A.rpc('set_ticket_status', { p_ticket: t.id, p_status: 'closed' }).then(function () { A.toast('Request resolved', { type: 'success' }); render(true); }); });
    });
  }
  function newTicket(pre) {
    pre = pre || {};
    A.modal({
      title: 'New support request',
      body: h`<form id="ticketForm"><div class="field"><label class="label" for="t-cat">Topic</label><select class="select" id="t-cat" name="category">${['general', 'transactions', 'cards', 'account', 'loans', 'security'].map(function (c) { return h`<option value="${c}" ${c === pre.category ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`; })}</select></div>
        <div class="field"><label class="label" for="t-sub">Subject</label><input class="input" id="t-sub" name="subject" maxlength="120" required value="${pre.subject || ''}"></div>
        <div class="field"><label class="label" for="t-body">How can we help?</label><textarea class="textarea" id="t-body" name="body" maxlength="4000" required></textarea></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="ticketForm">Send request</button>`,
      onOpen: function (el, close) {
        $('#ticketForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=ticketForm]');
          A.busy(btn, true);
          A.rpc('create_ticket', { p_subject: d.subject, p_body: d.body, p_category: d.category }).then(function (r) {
            close(); A.toast('Request sent', { type: 'success', body: 'We will reply here and notify you.' });
            location.hash = '#/support/' + r.id;
          }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
        });
      }
    });
  }

  /* ---------- Notifications ---------- */
  views.notifications = function () {
    setBody(h`<div class="page-head"><div><h2>Notifications</h2><p>Everything that happened on your accounts.</p></div>
      ${S.unread ? h`<div class="page-actions"><button class="btn btn-soft" data-action="read-all">Mark all read</button></div>` : ''}</div>
      <section class="card" style="overflow:hidden">${S.notifications.length ? S.notifications.map(notifItem) : emptyState('bell', 'No notifications', 'You are all caught up.')}</section>`);
  };

  /* ---------- Settings ---------- */
  views.settings = function (token, route) {
    var tab = ['profile', 'security', 'preferences', 'payees'].indexOf(route.sub) !== -1 ? route.sub : 'profile';
    var tabs = [['profile', 'Profile', 'user'], ['security', 'Security', 'shield'], ['preferences', 'Preferences', 'settings'], ['payees', 'Saved payees', 'users']];
    setBody(h`<div class="page-head"><div><h2>Settings</h2><p>Manage your profile, security and preferences.</p></div></div>
      <div class="settings-layout"><nav class="settings-nav">${tabs.map(function (t) { return h`<a class="nav-item ${tab === t[0] ? 'active' : ''}" href="#/settings/${t[0]}">${icon(t[2])}${t[1]}</a>`; })}</nav>
      <div id="settingsBody"></div></div>`);
    settingsTabs[tab](token);
  };
  var settingsTabs = {
    profile: function () {
      var p = S.profile, verified = p.kyc_status === 'verified';
      $('#settingsBody').innerHTML = h`
        <section class="card card-pad">
          <div class="avatar-edit">${avatarHtml('avatar-lg')}<div class="stack" style="gap:8px"><b>${p.full_name}</b><span class="small muted">Customer since ${A.date(p.created_at)}</span>
            <div class="row wrap"><label class="btn btn-soft btn-sm">${icon('upload', 'i-sm')}Upload photo<input type="file" accept="image/*" id="avatarInput" hidden></label>${p.avatar_url ? h`<button class="btn btn-ghost btn-sm" id="avatarRemove">Remove</button>` : ''}</div></div></div>
        </section>
        <section class="card card-pad section-gap">
          <div class="row-between"><h3 style="font-size:16px">Identity verification</h3>${statusBadge(p.kyc_status)}</div>
          <p class="small muted mt-2">${verified ? 'Your identity is verified. Your legal name is locked — contact support to change it.' : p.kyc_status === 'pending' ? 'We are reviewing your documents. This usually takes less than a day.' : 'Verify your identity to unlock higher limits and faster reviews.'}${p.kyc_note ? ' Note: ' + p.kyc_note : ''}</p>
          ${p.kyc_status === 'unverified' || p.kyc_status === 'rejected' ? h`<button class="btn btn-primary btn-sm mt-3" data-action="kyc">${icon('shield-check', 'i-sm')}Verify identity</button>` : ''}
        </section>
        <form class="card card-pad section-gap" id="profileForm">
          <h3 style="font-size:16px">Personal details</h3>
          <div class="field mt-4"><label class="label" for="p-name">Full legal name ${verified ? h`<small>Verified</small>` : ''}</label><input class="input" id="p-name" name="full_name" maxlength="120" value="${p.full_name}" ${verified ? 'disabled' : ''} required></div>
          <div class="field-row mt-4"><div class="field"><label class="label" for="p-email">Email</label><input class="input" id="p-email" value="${p.email}" disabled></div>
            <div class="field"><label class="label" for="p-phone">Phone</label><input class="input" id="p-phone" name="phone" type="tel" maxlength="40" value="${p.phone || ''}"></div></div>
          <div class="field"><label class="label" for="p-addr">Address</label><input class="input" id="p-addr" name="address" maxlength="200" value="${p.address || ''}"></div>
          <div class="field-row mt-4"><div class="field"><label class="label" for="p-city">City</label><input class="input" id="p-city" name="city" maxlength="80" value="${p.city || ''}"></div>
            <div class="field"><label class="label" for="p-country">Country</label><input class="input" id="p-country" name="country" maxlength="80" value="${p.country || ''}"></div></div>
          <div class="field"><label class="label" for="p-dob">Date of birth</label><input class="input" id="p-dob" name="date_of_birth" type="date" value="${p.date_of_birth || ''}" max="${A.date(new Date(), 'iso')}"></div>
          <button class="btn btn-primary mt-6" type="submit">Save changes</button>
        </form>`.toString();
      $('#profileForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var d = A.formData(e.target), btn = e.target.querySelector('[type=submit]');
        var patch = { phone: d.phone || null, address: d.address || null, city: d.city || null, country: d.country || null, date_of_birth: d.date_of_birth || null };
        if (!verified) { if (!d.full_name) return A.toast('Enter your name', { type: 'error' }); patch.full_name = d.full_name; }
        A.busy(btn, true);
        A.q(A.sb.from('profiles').update(patch).eq('id', p.id)).then(function () { A.busy(btn, false); A.toast('Profile saved', { type: 'success' }); refresh(); }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
      });
      $('#avatarInput').addEventListener('change', function (e) {
        var file = e.target.files[0]; if (!file) return;
        A.resizeImage(file, 192).then(function (url) { return A.q(A.sb.from('profiles').update({ avatar_url: url }).eq('id', p.id)); })
          .then(function () { A.toast('Photo updated', { type: 'success' }); return refresh(true); })
          .catch(function (err) { A.toast(A.friendlyError(err), { type: 'error' }); });
      });
      var rm = $('#avatarRemove');
      if (rm) rm.addEventListener('click', function () { A.q(A.sb.from('profiles').update({ avatar_url: null }).eq('id', p.id)).then(function () { refresh(true); }); });
    },
    security: function () {
      var u = S.session.user;
      $('#settingsBody').innerHTML = h`
        <section class="card card-pad">
          <h3 style="font-size:16px">Transaction PIN</h3>
          <div class="setting-row"><div><b>${S.hasPin ? 'PIN is set' : 'No PIN yet'}</b><small>Required for transfers to others and bill payments. 5 wrong attempts lock it for 15 minutes.</small></div>
            <button class="btn btn-soft btn-sm" data-action="${S.hasPin ? 'change-pin' : 'create-pin'}">${S.hasPin ? 'Change PIN' : 'Create PIN'}</button></div>
        </section>
        <form class="card card-pad section-gap" id="pwForm">
          <h3 style="font-size:16px">Change password</h3>
          <div class="field mt-4"><label class="label" for="pw-new">New password <small>8+ characters</small></label><input class="input" id="pw-new" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="field"><label class="label" for="pw-confirm">Confirm new password</label><input class="input" id="pw-confirm" type="password" autocomplete="new-password" minlength="8" required></div>
          <button class="btn btn-primary mt-6" type="submit">Update password</button>
        </form>
        <section class="card card-pad section-gap">
          <h3 style="font-size:16px">Sessions</h3>
          <div class="setting-row"><div><b>Last sign-in</b><small>${A.date(u.last_sign_in_at, 'long')}</small></div></div>
          <div class="setting-row"><div><b>Sign out everywhere</b><small>Ends every session on every device, including this one.</small></div><button class="btn btn-danger-soft btn-sm" data-action="signout-all">Sign out all</button></div>
        </section>`.toString();
      $('#pwForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var a = $('#pw-new').value, b = $('#pw-confirm').value, btn = e.target.querySelector('[type=submit]');
        if (a.length < 8) return A.toast('Use at least 8 characters', { type: 'error' });
        if (a !== b) return A.toast('The passwords do not match', { type: 'error' });
        A.busy(btn, true);
        A.sb.auth.updateUser({ password: a }).then(function (r) {
          A.busy(btn, false);
          if (r.error) throw r.error;
          e.target.reset(); A.toast('Password updated', { type: 'success' });
        }).catch(function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
      });
    },
    preferences: function () {
      var prefs = S.profile.preferences || {};
      var theme = (function () { try { return localStorage.getItem('aureon-theme') || 'system'; } catch (e) { return 'system'; } })();
      $('#settingsBody').innerHTML = h`<section class="card card-pad">
        <div class="setting-row"><div><b>Appearance</b><small>Light, dark or follow your device.</small></div>
          <div class="segmented" id="themeSeg">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(function (t) { return h`<button aria-selected="${theme === t[0]}" data-theme-set="${t[0]}">${t[1]}</button>`; })}</div></div>
        <div class="setting-row"><div><b>Display currency</b><small>Used for your total balance and insights.</small></div>
          <select class="select" id="prefCcy" style="width:auto">${Object.keys(S.rates).map(function (c) { return h`<option ${c === displayCcy() ? 'selected' : ''}>${c}</option>`; })}</select></div>
        <div class="setting-row"><div><b>Hide balances</b><small>Mask amounts when you open the app in public.</small></div>
          <span class="switch"><input type="checkbox" id="prefHide" ${S.hide ? 'checked' : ''} aria-label="Hide balances"><span></span></span></div>
      </section>`.toString();
      A.on($('#themeSeg'), 'click', '[data-theme-set]', function (e, b) {
        var t = b.getAttribute('data-theme-set');
        if (t === 'system') { try { localStorage.removeItem('aureon-theme'); } catch (x) { /* ignore */ } document.documentElement.removeAttribute('data-theme'); }
        else A.theme.set(t);
        $$('#themeSeg button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      });
      $('#prefCcy').addEventListener('change', function (e) {
        S.displayCcy = e.target.value;
        var next = Object.assign({}, prefs, { display_currency: e.target.value });
        A.q(A.sb.from('profiles').update({ preferences: next }).eq('id', S.profile.id)).then(function () { S.profile.preferences = next; A.toast('Display currency updated', { type: 'success' }); });
      });
      $('#prefHide').addEventListener('change', function (e) { setHide(e.target.checked); });
    },
    payees: function (token) {
      $('#settingsBody').innerHTML = h`<section class="card"><div class="card-head"><h3>Saved payees</h3></div><div class="card-body" id="payeeList">${skeleton(3)}</div></section>`.toString();
      A.q(A.sb.from('beneficiaries').select('*').eq('user_id', S.session.user.id).order('name')).then(function (rows) {
        if (!isCurrent(token)) return;
        $('#payeeList').innerHTML = (rows.length ? rows.map(function (p) {
          var q = p.is_internal ? '#/transfer/aureon?to=' + encodeURIComponent(p.account_number) : '#/transfer/external?to=' + encodeURIComponent(p.account_number) + '&bank=' + encodeURIComponent(p.bank_name) + '&name=' + encodeURIComponent(p.name);
          return h`<div class="payee"><span class="avatar">${A.initials(p.name)}</span><span class="grow"><b>${p.name}</b><small>${p.bank_name} · ${p.account_number}</small></span><a class="btn btn-soft btn-sm" href="${q}">Send</a><button class="payee-del" data-del="${p.id}" aria-label="Delete ${p.name}">${icon('trash', 'i-sm')}</button></div>`;
        }).join('') : emptyState('users', 'No saved payees', 'Tick "Save as a payee" when you send money and they will appear here.')).toString();
        A.on($('#payeeList'), 'click', '[data-del]', function (e, b) {
          A.confirm({ title: 'Delete payee?', confirmText: 'Delete', danger: true }).then(function (ok) {
            if (!ok) return;
            A.q(A.sb.from('beneficiaries').delete().eq('id', b.getAttribute('data-del'))).then(function () { A.toast('Payee deleted', { type: 'success' }); render(true); });
          });
        });
      });
    }
  };
  function kycFlow() {
    var p = S.profile;
    A.modal({
      title: 'Verify your identity', subtitle: 'Enter the details exactly as they appear on your ID.',
      body: h`<form id="kycForm">
        <div class="field"><label class="label" for="k-name">Full legal name</label><input class="input" id="k-name" name="name" maxlength="120" required value="${p.full_name}"></div>
        <div class="field"><label class="label" for="k-dob">Date of birth</label><input class="input" id="k-dob" name="dob" type="date" required value="${p.date_of_birth || ''}"></div>
        <div class="field"><label class="label" for="k-addr">Address</label><input class="input" id="k-addr" name="address" maxlength="200" required value="${p.address || ''}"></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="k-city">City</label><input class="input" id="k-city" name="city" maxlength="80" value="${p.city || ''}"></div>
          <div class="field"><label class="label" for="k-country">Country</label><input class="input" id="k-country" name="country" maxlength="80" required value="${p.country || ''}"></div></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="k-doc">ID type</label><select class="select" id="k-doc" name="doc"><option value="passport">Passport</option><option value="national_id">National ID</option><option value="drivers_license">Driver's licence</option></select></div>
          <div class="field"><label class="label" for="k-num">ID number</label><input class="input" id="k-num" name="num" maxlength="40" required></div></div>
      </form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="kycForm">Submit for review</button>`,
      onOpen: function (el, close) {
        $('#kycForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=kycForm]');
          A.busy(btn, true);
          A.rpc('submit_kyc', { p_full_name: d.name, p_date_of_birth: d.dob, p_address: d.address, p_city: d.city, p_country: d.country, p_document_type: d.doc, p_document_number: d.num })
            .then(function () { close(); A.toast('Submitted for review', { type: 'success' }); refresh(true); }, function (err) { A.busy(btn, false); A.toast(A.friendlyError(err), { type: 'error' }); });
        });
      }
    });
  }

  /* =========================================================================
     Router
     ========================================================================= */
  function parseRoute() {
    var raw = location.hash.replace(/^#\/?/, ''), q = '', i = raw.indexOf('?');
    if (i >= 0) { q = raw.slice(i + 1); raw = raw.slice(0, i); }
    var parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'overview', sub: parts[1] || '', params: new URLSearchParams(q) };
  }
  function render(keepScroll) {
    var route = parseRoute();
    if (route.name === 'more') { openSidebar(true); history.replaceState(null, '', S.route ? '#/' + S.route.name + (S.route.sub ? '/' + S.route.sub : '') : '#/overview'); return; }
    if (!views[route.name]) { location.replace('#/overview'); return; }
    var changed = !S.route || S.route.name !== route.name || S.route.sub !== route.sub;
    S.route = route;
    var token = ++S.renderToken;
    closePopovers(); openSidebar(false);
    $('#pageTitle').textContent = TITLES[route.name] || 'Aureon';
    document.title = (TITLES[route.name] || 'Dashboard') + ' · Aureon';
    renderNav();
    var view = $('#view');
    if (changed) { view.classList.remove('entering'); void view.offsetWidth; view.classList.add('entering'); if (!keepScroll) window.scrollTo(0, 0); }
    try { views[route.name](token, route); }
    catch (e) { console.error(e); setBody(h`<div class="card">${emptyState('alert', 'Something went wrong', A.friendlyError(e), h`<button class="btn btn-soft" onclick="location.reload()">Reload</button>`)}</div>`); }
  }
  function openSidebar(open) {
    var sb = $('#sidebar'), scrim = $('.scrim');
    sb.classList.toggle('open', open);
    if (open && !scrim) { scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.addEventListener('click', function () { openSidebar(false); }); document.body.appendChild(scrim); }
    if (!open && scrim) scrim.remove();
  }
  function setHide(v) {
    S.hide = v;
    try { localStorage.setItem('aureon-hide', v ? '1' : '0'); } catch (e) { /* ignore */ }
    renderChrome();
    render(true);
  }

  /* global actions */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (el) {
      var a = el.getAttribute('data-action');
      if (el.tagName === 'A' && a === 'menu') e.preventDefault();
      switch (a) {
        case 'menu': openSidebar(!$('#sidebar').classList.contains('open')); break;
        case 'signout': A.signOut(); break;
        case 'signout-all': A.confirm({ title: 'Sign out of every device?', confirmText: 'Sign out all', danger: true }).then(function (ok) { if (ok) A.signOut('global'); }); break;
        case 'notifications': showNotifications(el); break;
        case 'user-menu': showUserMenu(el); break;
        case 'read-all': markAllRead().then(function () { if (S.route.name === 'notifications') render(true); }); closePopovers(); break;
        case 'hide-balances': setHide(!S.hide); break;
        case 'receive': receiveFlow(); break;
        case 'open-account': openAccountFlow(); break;
        case 'new-card': newCardFlow(); break;
        case 'new-goal': newGoalFlow(); break;
        case 'new-ticket': newTicket(); break;
        case 'statement': statementFlow(); break;
        case 'create-pin': createPinFlow().catch(function (err) { A.toast(A.friendlyError(err), { type: 'error' }); }).then(function () { if (S.route.name === 'settings') render(true); }); break;
        case 'change-pin': changePinFlow(); break;
        case 'kyc': kycFlow(); break;
      }
      return;
    }
    var txn = e.target.closest('[data-txn]');
    if (txn && txnCache[txn.getAttribute('data-txn')]) { openTxn(txnCache[txn.getAttribute('data-txn')]); return; }
    var n = e.target.closest('[data-notif]');
    if (n) { var link = n.getAttribute('data-link'); closePopovers(); if (link && link.charAt(0) === '#') location.hash = link; return; }
    var copy = e.target.closest('[data-copy]');
    if (copy && !copy.closest('.overlay')) { e.preventDefault(); A.copy(copy.getAttribute('data-copy')); return; }
    var det = e.target.closest('[data-details]');
    if (det) { accountDetails(accountById(det.getAttribute('data-details'))); return; }
    var am = e.target.closest('[data-acct-menu]');
    if (am) { accountMenu(accountById(am.getAttribute('data-acct-menu'))); return; }
    var cc = e.target.closest('[data-ccy]');
    if (cc) { S.displayCcy = cc.getAttribute('data-ccy'); render(true); }
  });
  window.addEventListener('hashchange', function () { A.closeAll(); render(false); });

  /* =========================================================================
     Realtime + boot
     ========================================================================= */
  var softRefresh = A.debounce(function () {
    refresh().then(function () { if (['overview', 'accounts', 'transactions', 'transfer', 'savings', 'loans', 'notifications'].indexOf(S.route.name) !== -1 && !document.querySelector('.overlay')) render(true); });
  }, 600);
  function subscribe() {
    var uid = S.session.user.id;
    A.sb.channel('aureon-' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + uid }, function (payload) {
        var n = payload.new;
        if (S.notifications.some(function (x) { return x.id === n.id; })) return;
        S.notifications.unshift(n); S.unread++;
        renderChrome();
        A.toast(n.title, { type: n.kind === 'danger' ? 'error' : n.kind, body: n.body });
        softRefresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'accounts', filter: 'user_id=eq.' + uid }, softRefresh)
      .subscribe();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') softRefresh(); });
  }
  A.sb && A.sb.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') location.replace('login.html'); });

  A.requireUser().then(function (ctx) {
    S.session = ctx.session; S.profile = ctx.profile;
    return Promise.all([loadRefData(), loadAccounts(), loadNotifications()]);
  }).then(function () {
    renderChrome();
    render(false);
    subscribe();
    $('#boot').classList.add('done');
    setTimeout(function () { $('#boot').remove(); }, 400);
  }).catch(function (err) {
    console.error(err);
    $('#boot').classList.add('done');
    setBody(h`<div class="card" style="max-width:560px;margin:40px auto">${emptyState('alert', 'Could not load your account', A.friendlyError(err), h`<div class="row"><button class="btn btn-primary" onclick="location.reload()">Try again</button><button class="btn btn-ghost" data-action="signout">Sign out</button></div>`)}</div>`);
  });
})();
