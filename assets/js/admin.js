/* Aureon admin console — customers, ledger, reviews, loans, KYC, support, settings. */
(function () {
  'use strict';
  var h = A.html, icon = A.icon, $ = A.$, $$ = A.$$;

  var S = { session: null, me: null, profiles: [], accounts: [], settings: {}, rates: {}, stats: null, route: null, renderToken: 0 };
  var NAV = [
    { group: 'Operations', items: [
      { id: 'overview', label: 'Overview', icon: 'gauge' },
      { id: 'customers', label: 'Customers', icon: 'users' },
      { id: 'transactions', label: 'Ledger', icon: 'activity' },
      { id: 'invites', label: 'Open accounts', icon: 'plus' }
    ] },
    { group: 'Reviews', items: [
      { id: 'loans', label: 'Loans', icon: 'handshake', badge: 'pending_loans' },
      { id: 'kyc', label: 'Verification', icon: 'shield-check', badge: 'pending_kyc' },
      { id: 'support', label: 'Support', icon: 'support', badge: 'open_tickets' }
    ] },
    { group: 'System', items: [
      { id: 'settings', label: 'Rates & settings', icon: 'settings' },
      { id: 'audit', label: 'Audit log', icon: 'file' }
    ] }
  ];
  var TITLES = {};
  NAV.forEach(function (g) { g.items.forEach(function (it) { TITLES[it.id] = it.label; }); });
  var CATEGORIES = ['income', 'transfer', 'bills', 'shopping', 'food', 'transport', 'entertainment', 'health', 'savings', 'loan', 'fees', 'other'];
  var TYPE_LABEL = { checking: 'Current', savings: 'Savings', business: 'Business' };

  /* ---------- helpers ---------- */
  function isSuper() { return S.me.role === 'super_admin'; }
  function base() { return S.settings.base_currency || 'USD'; }
  function convert(v, from, to) { var a = S.rates[from], b = S.rates[to]; return a && b ? Number(v || 0) / a * b : Number(v || 0); }
  function prof(id) { return S.profiles.find(function (p) { return p.id === id; }); }
  function acct(id) { return S.accounts.find(function (a) { return a.id === id; }); }
  function badge(s) { return h`<span class="badge badge-${s}">${s === 'restricted' ? 'flagged' : String(s).replace('_', ' ')}</span>`; }
  function roleBadge(r) { return r === 'customer' ? '' : h`<span class="badge role-badge no-dot">${r === 'super_admin' ? 'Super admin' : 'Admin'}</span>`; }
  function setBody(x) { $('#viewBody').innerHTML = x.toString(); }
  function isCurrent(t) { return t === S.renderToken; }
  function skeleton(n) { var o = ''; for (var i = 0; i < (n || 4); i++) o += '<div class="skeleton" style="height:48px;margin:8px 0"></div>'; return A.raw(o); }
  function empty(ic, title, text) { return h`<div class="empty"><span class="empty-icon">${icon(ic, 'i-lg')}</span><h4>${title}</h4><p>${text || ''}</p></div>`; }
  function avatar(p, cls) {
    return p && p.avatar_url ? h`<span class="avatar ${cls || ''}"><img src="${p.avatar_url}" alt=""></span>` : h`<span class="avatar ${cls || ''}">${A.initials(p ? p.full_name || p.email : '?')}</span>`;
  }
  function userCell(p) {
    return h`<div class="cell-user">${avatar(p, 'mini-avatar')}<div class="grow"><b class="truncate">${p ? p.full_name || '—' : 'Unknown'}</b><small class="truncate">${p ? p.email : ''}</small></div></div>`;
  }
  function err(e) { A.toast(A.friendlyError(e), { type: 'error' }); }
  function run(promise, okMsg) {
    return promise.then(function (r) { if (okMsg) A.toast(okMsg, { type: 'success' }); return reload().then(function () { return r; }); }, function (e) { err(e); throw e; });
  }
  function customerBalance(uid) {
    return S.accounts.filter(function (a) { return a.user_id === uid && a.status !== 'closed'; })
      .reduce(function (s, a) { return s + convert(a.balance, a.currency, base()); }, 0);
  }
  function txnAmount(t) { return (t.direction === 'credit' ? '+' : '−') + A.money(t.direction === 'credit' ? t.amount : Number(t.amount) + Number(t.fee), t.currency); }

  /* ---------- data ---------- */
  function loadAll() {
    return Promise.all([
      A.q(A.sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(2000)),
      A.q(A.sb.from('accounts').select('*').order('created_at').limit(5000)),
      A.q(A.sb.from('settings').select('*').eq('id', 1).maybeSingle()),
      A.q(A.sb.from('fx_rates').select('*').order('currency')),
      A.rpc('admin_stats')
    ]).then(function (r) {
      S.profiles = r[0]; S.accounts = r[1].map(function (a) { a.balance = Number(a.balance); return a; });
      S.settings = r[2] || {}; S.rates = {}; r[3].forEach(function (x) { S.rates[x.currency] = Number(x.per_usd); }); S.fxRows = r[3];
      S.stats = r[4];
      S.me = prof(S.session.user.id) || S.me;
    });
  }
  // After any change, refresh the page and any open customer drawer so balances are never stale.
  function reload() { return loadAll().then(function () { renderChrome(); render(true); refreshDrawer(); }); }

  /* ---------- chrome ---------- */
  function renderChrome() {
    var cur = S.route ? S.route.name : 'overview';
    $('#sideNav').innerHTML = NAV.map(function (g) {
      return h`<div class="nav-group"><div class="nav-label">${g.group}</div>${g.items.map(function (it) {
        var n = it.badge && S.stats ? S.stats[it.badge] : 0;
        if (it.id === 'transactions' && S.stats) n = S.stats.pending_transactions;
        return h`<a class="nav-item ${cur === it.id ? 'active' : ''}" href="#/${it.id}">${icon(it.icon)}${it.label}${n ? h`<span class="count">${n}</span>` : ''}</a>`;
      })}</div>`;
    }).join('');
    $$('#tabbar a[data-tab]').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-tab') === cur); });
    $('#userChip').innerHTML = h`${avatar(S.me)}<div class="grow"><b class="truncate">${S.me.full_name}</b><small class="truncate">${S.me.role === 'super_admin' ? 'Super admin' : 'Admin'}</small></div>`.toString();
    $('#avatarBtn').innerHTML = avatar(S.me).toString();
    var pend = S.stats ? S.stats.pending_transactions + S.stats.pending_kyc + S.stats.pending_loans + S.stats.open_tickets : 0;
    $('#bellBtn').innerHTML = h`${icon('bell')}${pend ? h`<span class="dot">${pend > 9 ? '9+' : pend}</span>` : ''}`.toString();
    $('#bellBtn').setAttribute('aria-label', pend + ' items need attention');
    $('#banners').innerHTML = '';
  }
  function openSidebar(open) {
    var sb = $('#sidebar'), scrim = $('.scrim');
    sb.classList.toggle('open', open);
    if (open && !scrim) { scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.addEventListener('click', function () { openSidebar(false); }); document.body.appendChild(scrim); }
    if (!open && scrim) scrim.remove();
  }
  function closePopovers() { $$('.popover').forEach(function (p) { p.remove(); }); }
  function popover(anchor, html) {
    var had = anchor.parentElement.querySelector('.popover');
    closePopovers(); if (had) return;
    var el = document.createElement('div'); el.className = 'popover'; el.innerHTML = html.toString();
    anchor.parentElement.appendChild(el);
  }
  document.addEventListener('click', function (e) { if (!e.target.closest('.popover') && !e.target.closest('[data-action="notifications"],[data-action="user-menu"]')) closePopovers(); });

  /* =========================================================================
     Shared admin actions
     ========================================================================= */
  function reviewTxn(t, action) {
    var verbs = { approve: 'Approve', decline: 'Decline', reverse: 'Reverse' };
    var needNote = action !== 'approve';
    return A.prompt({
      title: verbs[action] + ' ' + t.reference + '?',
      subtitle: action === 'approve' ? 'The recipient is credited immediately.' : action === 'decline' ? 'The sender is refunded in full, including the fee.' : 'Money is taken back from the recipient and returned to the sender.',
      label: needNote ? 'Message to the customer (required)' : 'Note (optional)', multiline: true, required: needNote,
      confirmText: verbs[action], danger: action !== 'approve'
    }).then(function (note) {
      if (note === null) return;
      return run(A.rpc('admin_review_transaction', { p_group: t.group_id, p_action: action, p_note: note || null }), 'Transaction ' + action + 'd');
    }).catch(function () {});
  }

  function adjustBalance(a, direction) {
    var owner = prof(a.user_id);
    A.modal({
      title: (direction === 'credit' ? 'Fund ' : 'Debit ') + (owner ? owner.full_name : 'account'),
      subtitle: 'Account ' + a.account_number + ' · balance ' + A.money(a.balance, a.currency),
      body: h`<form id="adjForm">
        <div class="field"><label class="label" for="adj-amt">Amount (${a.currency})</label><input class="input input-xl num" id="adj-amt" name="amount" type="number" min="0.01" step="0.01" required></div>
        <div class="field"><label class="label" for="adj-desc">Description shown to customer</label><input class="input" id="adj-desc" name="description" maxlength="140" placeholder="${direction === 'credit' ? 'Cash deposit' : 'Withdrawal'}"></div>
        <div class="field"><label class="label" for="adj-note">Internal note <small>Optional</small></label><input class="input" id="adj-note" name="note" maxlength="280"></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${direction === 'credit' ? 'btn-primary' : 'btn-danger'}" type="submit" form="adjForm">${direction === 'credit' ? 'Fund account' : 'Debit account'}</button>`,
      onOpen: function (el, close) {
        $('#adjForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=adjForm]');
          A.busy(btn, true);
          A.rpc('admin_adjust_balance', { p_account: a.id, p_direction: direction, p_amount: Number(d.amount), p_description: d.description || null, p_note: d.note || null })
            .then(function (r) { close(); A.toast(direction === 'credit' ? 'Account funded' : 'Account debited', { type: 'success', body: 'New balance ' + A.money(r.balance, a.currency) }); return reload(); }, function (x) { A.busy(btn, false); err(x); });
        });
      }
    });
  }

  function localDateTime(d) {
    d = d ? new Date(d) : new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /** Super admin: add a ledger entry with a chosen date (moves the balance). */
  function postTransaction(preselect) {
    if (!isSuper()) return A.toast('Super admin access required', { type: 'error' });
    var accounts = S.accounts.filter(function (a) { return a.status !== 'closed'; });
    A.modal({
      title: 'Add transaction', subtitle: 'Credits add to the balance, debits reduce it. Running balances are recalculated by date.',
      body: h`<form id="postForm">
        <div class="field"><label class="label" for="pt-acc">Account</label><select class="select" id="pt-acc" name="account" required>${accounts.map(function (a) {
          var p = prof(a.user_id);
          return h`<option value="${a.id}" ${a.id === preselect ? 'selected' : ''}>${p ? p.full_name : '?'} · ${a.account_number} · ${A.money(a.balance, a.currency)}</option>`;
        })}</select></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="pt-dir">Type</label><select class="select" id="pt-dir" name="direction"><option value="credit">Credit (money in)</option><option value="debit">Debit (money out)</option></select></div>
          <div class="field"><label class="label" for="pt-amt">Amount</label><input class="input num" id="pt-amt" name="amount" type="number" min="0.01" step="0.01" required></div></div>
        <div class="field"><label class="label" for="pt-desc">Description</label><input class="input" id="pt-desc" name="description" maxlength="140" required placeholder="e.g. Salary — Northwind Ltd"></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="pt-cp">Counterparty</label><input class="input" id="pt-cp" name="counterparty" maxlength="120" placeholder="e.g. Northwind Ltd"></div>
          <div class="field"><label class="label" for="pt-cat">Category</label><select class="select" id="pt-cat" name="category">${CATEGORIES.map(function (c) { return h`<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`; })}</select></div></div>
        <div class="field"><label class="label" for="pt-date">Date &amp; time</label><input class="input" id="pt-date" name="date" type="datetime-local" required value="${localDateTime()}" max="${localDateTime()}"></div>
        <div class="field"><label class="label" for="pt-note">Internal note <small>Optional</small></label><input class="input" id="pt-note" name="note" maxlength="280"></div>
        <label class="check mt-4"><input type="checkbox" name="notify" checked> Notify the customer</label>
      </form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="postForm">Add transaction</button>`,
      onOpen: function (el, close) {
        var dir = $('#pt-dir', el), cat = $('#pt-cat', el);
        dir.addEventListener('change', function () { cat.value = dir.value === 'credit' ? 'income' : 'other'; });
        $('#postForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=postForm]');
          var when = new Date(d.date);
          if (isNaN(when) || when > new Date(Date.now() + 60000)) return A.toast('Choose a date that is not in the future', { type: 'error' });
          A.busy(btn, true);
          A.rpc('admin_post_transaction', { p_account: d.account, p_direction: d.direction, p_amount: Number(d.amount), p_description: d.description,
            p_date: when.toISOString(), p_counterparty: d.counterparty || null, p_category: d.category, p_note: d.note || null, p_notify: !!d.notify })
            .then(function () { close(); A.toast('Transaction added', { type: 'success' }); return reload(); }, function (x) { A.busy(btn, false); err(x); });
        });
      }
    });
  }
  function editTransaction(t) {
    A.modal({
      title: 'Edit ' + t.reference, subtitle: 'Amounts cannot be edited — delete the entry and add a new one instead.',
      body: h`<form id="editForm">
        <div class="field"><label class="label" for="et-desc">Description</label><input class="input" id="et-desc" name="description" maxlength="140" value="${t.description}" required></div>
        <div class="field-row mt-4"><div class="field"><label class="label" for="et-cp">Counterparty</label><input class="input" id="et-cp" name="counterparty" maxlength="120" value="${t.counterparty_name || ''}"></div>
          <div class="field"><label class="label" for="et-cat">Category</label><select class="select" id="et-cat" name="category">${CATEGORIES.map(function (c) { return h`<option value="${c}" ${c === t.category ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`; })}</select></div></div>
        <div class="field"><label class="label" for="et-date">Date &amp; time</label><input class="input" id="et-date" name="date" type="datetime-local" value="${localDateTime(t.created_at)}" max="${localDateTime()}" required></div>
        <div class="field"><label class="label" for="et-note">Internal note</label><input class="input" id="et-note" name="note" maxlength="280" value="${t.admin_note || ''}"></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="editForm">Save</button>`,
      onOpen: function (el, close) {
        $('#editForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target), btn = el.querySelector('[form=editForm]');
          var when = new Date(d.date);
          if (isNaN(when) || when > new Date(Date.now() + 60000)) return A.toast('Choose a date that is not in the future', { type: 'error' });
          var dateChanged = localDateTime(t.created_at) !== d.date;
          A.busy(btn, true);
          A.rpc('admin_update_transaction', { p_id: t.id, p_description: d.description, p_date: dateChanged ? when.toISOString() : null, p_counterparty: d.counterparty || null, p_category: d.category, p_note: d.note || null })
            .then(function () { close(); A.toast('Transaction updated', { type: 'success' }); return reload(); }, function (x) { A.busy(btn, false); err(x); });
        });
      }
    });
  }
  function deleteTransaction(t) {
    var effect = t.direction === 'debit' ? A.money(Number(t.amount) + Number(t.fee), t.currency) + ' will be added back to the account.'
      : (t.status === 'completed' || t.status === 'reversed') ? A.money(t.amount, t.currency) + ' will be removed from the account.' : 'The balance is not affected.';
    A.confirm({ title: 'Delete ' + t.reference + '?', body: '"' + t.description + '" will be removed from the customer\'s history. ' + effect + ' This is recorded in the audit log.', confirmText: 'Delete transaction', danger: true })
      .then(function (ok) { if (ok) run(A.rpc('admin_delete_transaction', { p_id: t.id }), 'Transaction deleted').catch(function () {}); });
  }
  function flagFlow(p, status) {
    var labels = { restricted: 'Flag account', frozen: 'Freeze profile', closed: 'Close profile' };
    A.prompt({
      title: labels[status] + ' — ' + p.full_name,
      subtitle: status === 'restricted' ? 'The customer can still log in and receive money, but every attempt to send, pay or withdraw shows this reason in a pop-up.' : 'The customer will see this reason.',
      label: 'Reason shown to the customer', multiline: true, required: true, value: p.status_reason || '', confirmText: labels[status], danger: true
    }).then(function (reason) {
      if (!reason) return;
      run(A.rpc('admin_set_user_status', { p_user: p.id, p_status: status, p_reason: reason }), status === 'restricted' ? 'Account flagged' : 'Status updated').catch(function () {});
    });
  }
  function messageFlow(p) {
    A.modal({
      title: p ? 'Message ' + p.full_name : 'Message all customers', subtitle: 'Delivered as an in-app notification.',
      body: h`<form id="msgForm"><div class="field"><label class="label" for="m-title">Title</label><input class="input" id="m-title" name="title" maxlength="120" required></div>
        <div class="field"><label class="label" for="m-body">Message</label><textarea class="textarea" id="m-body" name="body" maxlength="1000"></textarea></div>
        <div class="field"><label class="label" for="m-kind">Style</label><select class="select" id="m-kind" name="kind"><option value="info">Information</option><option value="success">Good news</option><option value="warning">Warning</option><option value="danger">Urgent</option></select></div></form>`,
      foot: h`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="msgForm">Send</button>`,
      onOpen: function (el, close) {
        $('#msgForm', el).addEventListener('submit', function (e) {
          e.preventDefault();
          var d = A.formData(e.target);
          A.rpc('admin_broadcast', { p_title: d.title, p_body: d.body, p_kind: d.kind, p_user: p ? p.id : null }).then(function (r) { close(); A.toast('Sent to ' + r.recipients + ' customer' + (r.recipients === 1 ? '' : 's'), { type: 'success' }); }, err);
        });
      }
    });
  }

  /* ---------- transactions table (used on several screens) ---------- */
  var txnIndex = {};
  function txnTable(rows, opts) {
    opts = opts || {};
    rows.forEach(function (t) { txnIndex[t.id] = t; });
    if (!rows.length) return empty('activity', 'No transactions', opts.emptyText || 'Nothing matches these filters.');
    if (opts.compact) return compactTxnTable(rows);
    return h`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th>${opts.hideCustomer ? '' : h`<th>Customer</th>`}<th>Description</th><th>Status</th><th class="right">Amount</th><th class="right">Actions</th></tr></thead><tbody>
      ${rows.map(function (t) {
        var p = prof(t.user_id), reviewable = t.direction === 'debit' && ['transfer', 'external', 'bill'].indexOf(t.kind) !== -1;
        return h`<tr data-row="${t.id}">
          <td class="small" style="white-space:nowrap">${A.date(t.created_at)}<div class="tiny muted">${A.date(t.created_at, 'time')}</div></td>
          ${opts.hideCustomer ? '' : h`<td>${userCell(p)}</td>`}
          <td style="min-width:200px"><b class="small">${t.description}</b><div class="tiny muted">${t.reference} · ${t.kind}${t.counterparty_name ? ' · ' + t.counterparty_name : ''}</div>${t.admin_note ? h`<div class="tiny muted">Note: ${t.admin_note}</div>` : ''}</td>
          <td>${badge(t.status)}</td>
          <td class="right num" style="white-space:nowrap;font-weight:700;color:${t.direction === 'credit' ? 'var(--success)' : 'var(--ink)'}">${txnAmount(t)}${Number(t.fee) > 0 ? h`<div class="tiny muted">fee ${A.money(t.fee, t.currency)}</div>` : ''}</td>
          <td><div class="actions-cell">
            ${reviewable && t.status === 'pending' ? h`<button class="btn btn-success-soft btn-sm" data-review="approve">Approve</button><button class="btn btn-danger-soft btn-sm" data-review="decline">Decline</button>` : ''}
            ${reviewable && t.status === 'completed' ? h`<button class="btn btn-soft btn-sm" data-review="reverse">Reverse</button>` : ''}
            ${isSuper() ? h`<button class="btn btn-ghost btn-sm btn-icon" data-edit aria-label="Edit">${icon('edit', 'i-sm')}</button>${t.status !== 'pending' ? h`<button class="btn btn-ghost btn-sm btn-icon" data-delete aria-label="Delete" style="color:var(--danger)">${icon('trash', 'i-sm')}</button>` : ''}` : ''}
          </div></td></tr>`;
      })}</tbody></table></div>`;
  }
  function txnActions(t) {
    var reviewable = t.direction === 'debit' && ['transfer', 'external', 'bill'].indexOf(t.kind) !== -1;
    return h`<div class="actions-cell">
      ${reviewable && t.status === 'pending' ? h`<button class="btn btn-success-soft btn-sm" data-review="approve">Approve</button><button class="btn btn-danger-soft btn-sm" data-review="decline">Decline</button>` : ''}
      ${reviewable && t.status === 'completed' ? h`<button class="btn btn-soft btn-sm" data-review="reverse">Reverse</button>` : ''}
      ${isSuper() ? h`<button class="btn btn-ghost btn-sm btn-icon" data-edit aria-label="Edit">${icon('edit', 'i-sm')}</button>${t.status !== 'pending' ? h`<button class="btn btn-ghost btn-sm btn-icon" data-delete aria-label="Delete" style="color:var(--danger)">${icon('trash', 'i-sm')}</button>` : ''}` : ''}
    </div>`;
  }
  function compactTxnTable(rows) {
    return h`<table class="table"><tbody>${rows.map(function (t) {
      return h`<tr data-row="${t.id}"><td style="padding-left:0"><b class="small">${t.description}</b><div class="tiny muted">${A.date(t.created_at)} · ${t.reference}</div>${t.status !== 'completed' ? h`<div class="mt-1">${badge(t.status)}</div>` : ''}</td>
        <td class="right num" style="white-space:nowrap;font-weight:700;color:${t.direction === 'credit' ? 'var(--success)' : 'var(--ink)'}">${txnAmount(t)}<div style="margin-top:6px">${txnActions(t)}</div></td></tr>`;
    })}</tbody></table>`;
  }
  // one delegated handler for every transactions table
  document.addEventListener('click', function (e) {
    var row = e.target.closest('[data-row]');
    if (!row) return;
    var t = txnIndex[row.getAttribute('data-row')];
    if (!t) return;
    var b = e.target.closest('[data-review],[data-edit],[data-delete]');
    if (!b) return;
    if (b.hasAttribute('data-review')) reviewTxn(t, b.getAttribute('data-review'));
    else if (b.hasAttribute('data-edit')) editTransaction(t);
    else deleteTransaction(t);
  });

  /* =========================================================================
     Views
     ========================================================================= */
  var views = {};

  views.overview = function (token) {
    var st = S.stats, cur = st.base_currency;
    var kpi = function (ic, k, v, d, alert) { return h`<div class="stat ${alert ? 'kpi-alert' : ''}"><div class="k">${icon(ic)}${k}</div><div class="v">${v}</div>${d ? h`<div class="d">${d}</div>` : ''}</div>`; };
    setBody(h`
      <div class="page-head"><div><h2>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${S.me.full_name.split(' ')[0]}</h2><p>${isSuper() ? 'Super admin' : 'Admin'} · here is the bank today.</p></div>
        <div class="page-actions"><a class="btn btn-soft" href="#/invites">${icon('plus', 'i-sm')}Open account</a>${isSuper() ? h`<button class="btn btn-primary" data-action="post-txn">${icon('plus', 'i-sm')}Add transaction</button>` : ''}</div></div>
      <div class="grid-4">
        ${kpi('users', 'Customers', A.number(st.customers, 0), '+' + st.new_customers_30d + ' in 30 days')}
        ${kpi('wallet', 'Total deposits', A.money(st.deposits, cur, { compact: true }), st.accounts + ' open accounts')}
        ${kpi('activity', 'Payment volume (30d)', A.money(st.volume_30d, cur, { compact: true }), st.txn_24h + ' payments in 24h')}
        ${kpi('handshake', 'Loan book', A.money(st.loan_book, cur, { compact: true }), st.pending_loans + (st.pending_loans === 1 ? ' application' : ' applications') + ' waiting')}
      </div>
      <div class="grid-4 section-gap">
        <a href="#/transactions?status=pending">${kpi('clock', 'Pending transfers', st.pending_transactions, 'Need approval', st.pending_transactions > 0)}</a>
        <a href="#/kyc">${kpi('shield-check', 'Verifications', st.pending_kyc, 'Waiting for review', st.pending_kyc > 0)}</a>
        <a href="#/support">${kpi('support', 'Open tickets', st.open_tickets, 'Customers waiting', st.open_tickets > 0)}</a>
        <a href="#/customers?status=flagged">${kpi('flag', 'Flagged / frozen', st.restricted_users, 'Customers restricted')}</a>
      </div>
      <div class="dash section-gap">
        <section class="card"><div class="card-head"><h3>Payment volume</h3><span class="small muted">Last 14 days · ${cur}</span></div><div class="card-body"><div id="volChart"></div></div></section>
        <section class="card"><div class="card-head"><h3>Deposits by currency</h3></div><div class="card-body"><div class="cat-list">${st.by_currency.length ? st.by_currency.map(function (c) {
          return h`<div class="cat-row" style="grid-template-columns:auto 1fr auto"><span class="ccy-badge" style="width:34px;height:34px;font-size:12px">${A.symbol(c.currency).trim()}</span><span>${c.currency} · ${c.accounts} account${c.accounts === 1 ? '' : 's'}</span><b>${A.money(c.total, c.currency)}</b></div>`;
        }) : empty('wallet', 'No deposits yet')}</div></div></section>
        <section class="card full"><div class="card-head"><h3>Waiting for review</h3><a class="link small" href="#/transactions?status=pending">All pending</a></div><div class="card-body" id="pendingBox">${skeleton(2)}</div></section>
        <section class="card full"><div class="card-head"><h3>Newest customers</h3><a class="link small" href="#/customers">All customers</a></div><div class="card-body">${(function () {
          var list = S.profiles.filter(function (p) { return p.role === 'customer'; }).slice(0, 6);
          return list.length ? h`<div class="table-wrap"><table class="table"><tbody>${list.map(function (p) {
            return h`<tr class="clickable" data-customer="${p.id}"><td>${userCell(p)}</td><td>${badge(p.status)}</td><td>${badge(p.kyc_status)}</td><td class="right num">${A.money(customerBalance(p.id), cur)}</td><td class="right small muted">${A.date(p.created_at, 'relative')}</td></tr>`;
          })}</tbody></table></div>` : empty('users', 'No customers yet', 'Customers appear here as soon as they sign up.');
        })()}</div></section>
      </div>`);
    Charts.area($('#volChart'), { labels: st.daily.map(function (d) { return new Date(d.day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }),
      values: st.daily.map(function (d) { return Number(d.volume); }), name: 'Volume', height: 230, label: 'Daily payment volume', format: function (v) { return A.money(v, cur); } });
    A.q(A.sb.from('transactions').select('*').eq('status', 'pending').eq('direction', 'debit').order('created_at', { ascending: false }).limit(8)).then(function (rows) {
      if (isCurrent(token)) $('#pendingBox').innerHTML = txnTable(rows, { emptyText: 'Nothing is waiting — large and external transfers appear here.' }).toString();
    }, err);
  };

  views.customers = function (token, route) {
    var f = { q: '', status: route.params.get('status') || '', kyc: '' };
    setBody(h`<div class="page-head"><div><h2>Customers</h2><p>${S.profiles.length} profiles</p></div>
      <div class="page-actions"><button class="btn btn-soft" data-action="broadcast">${icon('bell', 'i-sm')}Message all</button><a class="btn btn-primary" href="#/invites">${icon('plus', 'i-sm')}Open account</a></div></div>
      <div class="filters">
        <label class="search">${icon('search')}<input class="input" id="c-q" type="search" placeholder="Search name, email, phone or account number" aria-label="Search customers"></label>
        <select class="select" id="c-status" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="flagged">Flagged / frozen</option><option value="restricted">Flagged only</option><option value="frozen">Frozen</option><option value="closed">Closed</option></select>
        <select class="select" id="c-kyc" aria-label="Verification"><option value="">Any verification</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="rejected">Rejected</option></select>
      </div>
      <section class="card" id="custTable"></section>`);
    $('#c-status').value = f.status;
    var draw = function () {
      var q = f.q.toLowerCase();
      var list = S.profiles.filter(function (p) {
        if (f.status === 'flagged' ? ['restricted', 'frozen'].indexOf(p.status) === -1 : f.status && p.status !== f.status) return false;
        if (f.kyc && p.kyc_status !== f.kyc) return false;
        if (!q) return true;
        var accs = S.accounts.filter(function (a) { return a.user_id === p.id; }).map(function (a) { return a.account_number; }).join(' ');
        return (p.full_name + ' ' + p.email + ' ' + (p.phone || '') + ' ' + accs).toLowerCase().indexOf(q) !== -1;
      });
      $('#custTable').innerHTML = (list.length ? h`<div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th>Accounts</th><th>Status</th><th>Verification</th><th class="right">Balance (${base()})</th><th>Joined</th></tr></thead><tbody>${list.map(function (p) {
        var accs = S.accounts.filter(function (a) { return a.user_id === p.id && a.status !== 'closed'; });
        return h`<tr class="clickable" data-customer="${p.id}"><td>${userCell(p)}</td><td class="small">${accs.map(function (a) { return a.account_number; }).join(', ') || '—'}</td><td>${badge(p.status === 'restricted' ? 'restricted' : p.status)} ${roleBadge(p.role)}</td><td>${badge(p.kyc_status)}</td><td class="right num"><b>${A.money(customerBalance(p.id), base())}</b></td><td class="small muted">${A.date(p.created_at)}</td></tr>`;
      })}</tbody></table></div>` : empty('users', 'No customers found', 'Try another search.')).toString();
    };
    $('#c-q').addEventListener('input', A.debounce(function (e) { f.q = e.target.value.trim(); draw(); }, 150));
    $('#c-status').addEventListener('change', function (e) { f.status = e.target.value; draw(); });
    $('#c-kyc').addEventListener('change', function (e) { f.kyc = e.target.value; draw(); });
    draw();
  };

  /** Customer detail drawer — everything an admin can do for one person. */
  function customerBody(p) {
    var accs = S.accounts.filter(function (a) { return a.user_id === p.id; });
    var self = p.id === S.me.id, superTarget = p.role === 'super_admin';
    return h`
        <div class="row" style="gap:14px">${avatar(p, 'avatar-lg')}<div class="stack" style="gap:6px"><div class="small muted">${p.email}${p.phone ? ' · ' + p.phone : ''}</div>
          <div class="row wrap" style="gap:6px">${badge(p.status)} ${badge(p.kyc_status)} ${roleBadge(p.role)}</div><div class="tiny muted">Joined ${A.date(p.created_at, 'long')}</div></div></div>
        ${p.status !== 'active' ? h`<div class="alert ${p.status === 'restricted' ? 'alert-warning' : 'alert-danger'} mt-4">${icon('flag')}<div><strong>${p.status === 'restricted' ? 'Account flagged — outgoing payments blocked' : 'Profile ' + p.status}</strong><p>${p.status_reason || ''}</p></div></div>` : ''}

        <h4 class="section-title">${icon('flag', 'i-sm')}Status</h4>
        ${self || superTarget ? h`<p class="small muted">${self ? 'You cannot change your own status.' : 'Super admins cannot be flagged or frozen.'}</p>` : h`<div class="row wrap">
          ${p.status === 'active' ? h`<button class="btn btn-soft btn-sm" data-op="flag">${icon('flag', 'i-sm')}Flag account</button><button class="btn btn-soft btn-sm" data-op="freeze">${icon('snowflake', 'i-sm')}Freeze</button>`
            : h`<button class="btn btn-success-soft btn-sm" data-op="unflag">${icon('check', 'i-sm')}${p.status === 'restricted' ? 'Unflag account' : 'Reactivate'}</button>${p.status === 'restricted' ? h`<button class="btn btn-soft btn-sm" data-op="flag">${icon('edit', 'i-sm')}Edit reason</button>` : ''}`}
          ${p.status !== 'closed' ? h`<button class="btn btn-ghost btn-sm" data-op="close" style="color:var(--danger)">Close profile</button>` : ''}
        </div>`}

        <h4 class="section-title">${icon('wallet', 'i-sm')}Accounts</h4>
        <div class="stack">${accs.length ? accs.map(function (a) {
          return h`<div class="acct" style="cursor:default;flex-wrap:wrap"><span class="ccy-badge">${A.symbol(a.currency).trim()}</span><span class="grow"><b>${TYPE_LABEL[a.type]}${a.nickname ? ' · ' + a.nickname : ''}</b><small>${a.account_number} · ${a.currency} ${a.status !== 'active' ? '· ' + a.status : ''}</small></span><span class="amt">${A.money(a.balance, a.currency)}</span>
            ${a.status !== 'closed' ? h`<div class="row wrap" style="width:100%;gap:6px">
              <button class="btn btn-primary btn-sm" data-fund="${a.id}">${icon('plus', 'i-sm')}Fund</button>
              <button class="btn btn-soft btn-sm" data-debit="${a.id}">${icon('minus', 'i-sm')}Debit</button>
              ${isSuper() ? h`<button class="btn btn-soft btn-sm" data-post="${a.id}">${icon('calendar', 'i-sm')}Add dated entry</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-acct-status="${a.id}">${a.status === 'frozen' ? 'Unfreeze' : 'Freeze'} account</button></div>` : ''}</div>`;
        }) : empty('wallet', 'No accounts')}</div>

        ${p.kyc_status === 'pending' || p.kyc_document_number ? h`<h4 class="section-title">${icon('shield-check', 'i-sm')}Verification</h4>
          <div class="kv"><div><span class="k">Document</span><span class="v">${(p.kyc_document_type || '').replace('_', ' ')} · ${p.kyc_document_number || '—'}</span></div>
          <div><span class="k">Date of birth</span><span class="v">${p.date_of_birth ? A.date(p.date_of_birth) : '—'}</span></div>
          <div><span class="k">Address</span><span class="v">${[p.address, p.city, p.country].filter(Boolean).join(', ') || '—'}</span></div></div>
          ${p.kyc_status === 'pending' ? h`<div class="row mt-3"><button class="btn btn-success-soft btn-sm" data-op="kyc-ok">Approve</button><button class="btn btn-danger-soft btn-sm" data-op="kyc-no">Reject</button></div>` : ''}` : ''}

        <h4 class="section-title">${icon('settings', 'i-sm')}More</h4>
        <div class="row wrap">
          <button class="btn btn-soft btn-sm" data-op="message">${icon('bell', 'i-sm')}Send message</button>
          <button class="btn btn-soft btn-sm" data-op="pin">${icon('key', 'i-sm')}Reset PIN</button>
          ${isSuper() && !self && !superTarget ? h`<button class="btn btn-soft btn-sm" data-op="role">${icon('shield', 'i-sm')}${p.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>` : ''}
        </div>

        <h4 class="section-title">${icon('history', 'i-sm')}Recent transactions</h4>
        <div data-cust-txns>${skeleton(3)}</div>`;
  }
  function loadCustomerTxns(el, id) {
    A.q(A.sb.from('transactions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(40)).then(function (rows) {
      var box = el.querySelector('[data-cust-txns]');
      if (box) box.innerHTML = txnTable(rows, { compact: true, emptyText: 'This customer has no transactions yet.' }).toString();
    }, err);
  }
  /** Re-renders the open drawer in place with fresh data (no close/reopen). */
  function refreshDrawer() {
    var d = S.drawer;
    if (!d || !d.el.isConnected) { S.drawer = null; return; }
    var p = prof(d.id);
    if (!p) return;
    d.el.querySelector('.modal-head h2').textContent = p.full_name || p.email;
    d.el.querySelector('.modal-body').innerHTML = customerBody(p).toString();
    loadCustomerTxns(d.el, d.id);
  }
  function openCustomer(id) {
    var p = prof(id);
    if (!p) return;
    var me = { id: id, el: null };
    A.modal({
      drawer: true, title: p.full_name || p.email,
      body: customerBody(p),
      onOpen: function (el, close) {
        me.el = el;
        S.drawer = me;
        var cur = function () { return prof(id); };     // always act on fresh data
        A.on(el, 'click', '[data-fund]', function (e, b) { adjustBalance(acct(b.getAttribute('data-fund')), 'credit'); });
        A.on(el, 'click', '[data-debit]', function (e, b) { adjustBalance(acct(b.getAttribute('data-debit')), 'debit'); });
        A.on(el, 'click', '[data-post]', function (e, b) { postTransaction(b.getAttribute('data-post')); });
        A.on(el, 'click', '[data-acct-status]', function (e, b) {
          var a = acct(b.getAttribute('data-acct-status'));
          run(A.rpc('admin_set_account_status', { p_account: a.id, p_status: a.status === 'frozen' ? 'active' : 'frozen' }), 'Account ' + (a.status === 'frozen' ? 'unfrozen' : 'frozen')).catch(function () {});
        });
        A.on(el, 'click', '[data-op]', function (e, b) {
          var op = b.getAttribute('data-op'), p = cur();
          if (op === 'flag') flagFlow(p, 'restricted');
          else if (op === 'freeze') flagFlow(p, 'frozen');
          else if (op === 'close') flagFlow(p, 'closed');
          else if (op === 'unflag') run(A.rpc('admin_set_user_status', { p_user: p.id, p_status: 'active' }), p.status === 'restricted' ? 'Account unflagged' : 'Profile reactivated').catch(function () {});
          else if (op === 'kyc-ok') run(A.rpc('admin_decide_kyc', { p_user: p.id, p_approve: true }), 'Identity verified').catch(function () {});
          else if (op === 'kyc-no') A.prompt({ title: 'Reject verification', label: 'Reason shown to the customer', required: true, multiline: true, confirmText: 'Reject', danger: true }).then(function (n) { if (n) run(A.rpc('admin_decide_kyc', { p_user: p.id, p_approve: false, p_note: n }), 'Verification rejected').catch(function () {}); });
          else if (op === 'message') messageFlow(p);
          else if (op === 'pin') A.confirm({ title: 'Reset ' + p.full_name + '\'s PIN?', body: 'They will need to create a new PIN before their next payment.', confirmText: 'Reset PIN' }).then(function (ok) { if (ok) run(A.rpc('admin_reset_pin', { p_user: p.id }), 'PIN reset').catch(function () {}); });
          else if (op === 'role') run(A.rpc('admin_set_user_role', { p_user: p.id, p_role: p.role === 'admin' ? 'customer' : 'admin' }), 'Role updated').catch(function () {});
        });
        loadCustomerTxns(el, id);
      }
    }).then(function () { if (S.drawer === me) S.drawer = null; });
  }

  views.transactions = function (token, route) {
    var f = { status: route.params.get('status') || '', kind: '', direction: '', q: '' };
    var PAGE = 50, offset = 0, rows = [];
    setBody(h`<div class="page-head"><div><h2>Ledger</h2><p>Every transaction across the bank.${isSuper() ? ' As super admin you can add, edit and delete entries.' : ''}</p></div>
      <div class="page-actions"><button class="btn btn-soft" id="ledgerCsv">${icon('download', 'i-sm')}Export CSV</button>${isSuper() ? h`<button class="btn btn-primary" data-action="post-txn">${icon('plus', 'i-sm')}Add transaction</button>` : ''}</div></div>
      <div class="filters">
        <label class="search">${icon('search')}<input class="input" id="t-q" type="search" placeholder="Reference, description or counterparty" aria-label="Search"></label>
        <select class="select" id="t-status" aria-label="Status"><option value="">Any status</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="declined">Declined</option><option value="reversed">Reversed</option></select>
        <select class="select" id="t-kind" aria-label="Type"><option value="">All types</option>${['transfer', 'external', 'bill', 'deposit', 'withdrawal', 'savings', 'loan', 'interest', 'reversal'].map(function (k) { return h`<option value="${k}">${k}</option>`; })}</select>
        <select class="select" id="t-dir" aria-label="Direction"><option value="">In &amp; out</option><option value="credit">Credits</option><option value="debit">Debits</option></select>
      </div>
      <section class="card"><div id="ledger">${skeleton(6)}</div><div class="pager" id="ledgerMore" hidden><button class="btn btn-soft">Load more</button></div></section>`);
    $('#t-status').value = f.status;
    var build = function (limit, from) {
      var q = A.sb.from('transactions').select('*').order('created_at', { ascending: false });
      if (f.status) q = q.eq('status', f.status);
      if (f.kind) q = q.eq('kind', f.kind);
      if (f.direction) q = q.eq('direction', f.direction);
      if (f.q) { var s = f.q.replace(/[%,()*]/g, ' ').trim(); if (s) q = q.or('reference.ilike.%' + s + '%,description.ilike.%' + s + '%,counterparty_name.ilike.%' + s + '%'); }
      return q.range(from, from + limit - 1);
    };
    var load = function (reset) {
      if (reset) { offset = 0; rows = []; }
      A.q(build(PAGE, offset)).then(function (r) {
        if (!isCurrent(token)) return;
        rows = rows.concat(r); offset += r.length;
        $('#ledger').innerHTML = txnTable(rows).toString();
        $('#ledgerMore').hidden = r.length < PAGE;
      }, err);
    };
    [['#t-status', 'status'], ['#t-kind', 'kind'], ['#t-dir', 'direction']].forEach(function (x) { $(x[0]).addEventListener('change', function (e) { f[x[1]] = e.target.value; load(true); }); });
    $('#t-q').addEventListener('input', A.debounce(function (e) { f.q = e.target.value.trim(); load(true); }, 300));
    $('#ledgerMore button').addEventListener('click', function () { load(false); });
    $('#ledgerCsv').addEventListener('click', function () {
      A.q(build(5000, 0)).then(function (all) {
        A.downloadCSV('aureon-ledger-' + A.date(new Date(), 'iso') + '.csv', [['Date', 'Reference', 'Customer', 'Email', 'Account', 'Direction', 'Kind', 'Description', 'Counterparty', 'Amount', 'Fee', 'Currency', 'Status', 'Balance after']].concat(all.map(function (t) {
          var p = prof(t.user_id) || {}, a = acct(t.account_id) || {};
          return [new Date(t.created_at).toISOString(), t.reference, p.full_name, p.email, a.account_number, t.direction, t.kind, t.description, t.counterparty_name, t.amount, t.fee, t.currency, t.status, t.balance_after];
        })));
      }, err);
    });
    load(true);
  };

  views.invites = function (token) {
    setBody(h`<div class="page-head"><div><h2>Open accounts</h2><p>Open an account for an existing customer, or pre-open one for someone who has not signed up yet.</p></div></div>
      <div class="transfer-layout">
        <form class="card card-pad" id="invForm">
          <div class="field"><label class="label" for="i-email">Customer email</label><input class="input" id="i-email" name="email" type="email" required placeholder="customer@example.com"><span class="hint">If they already have a profile, the account is added straight away. Otherwise it is linked the moment they sign up with this email.</span></div>
          <div class="field"><label class="label" for="i-name">Full name</label><input class="input" id="i-name" name="name" maxlength="120"></div>
          <div class="field-row mt-4"><div class="field"><label class="label" for="i-type">Account type</label><select class="select" id="i-type" name="type"><option value="checking">Current</option><option value="savings">Savings</option><option value="business">Business</option></select></div>
            <div class="field"><label class="label" for="i-ccy">Currency</label><select class="select" id="i-ccy" name="currency">${Object.keys(S.rates).map(function (c) { return h`<option ${c === base() ? 'selected' : ''}>${c}</option>`; })}</select></div></div>
          <div class="field-row mt-4"><div class="field"><label class="label" for="i-bal">Opening balance</label><input class="input num" id="i-bal" name="balance" type="number" min="0" step="0.01" value="0"></div>
            <div class="field"><label class="label" for="i-phone">Phone <small>Optional</small></label><input class="input" id="i-phone" name="phone" maxlength="40"></div></div>
          <button class="btn btn-primary btn-block mt-6" type="submit">Open account</button>
        </form>
        <section class="card"><div class="card-head"><h3>Pre-opened accounts</h3></div><div class="card-body" id="invList">${skeleton(3)}</div></section>
      </div>`);
    $('#invForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var d = A.formData(e.target), btn = e.target.querySelector('[type=submit]');
      A.busy(btn, true);
      A.rpc('admin_create_invite', { p_email: d.email, p_full_name: d.name, p_currency: d.currency, p_account_type: d.type, p_opening_balance: Number(d.balance || 0), p_phone: d.phone || null })
        .then(function (r) {
          A.busy(btn, false);
          A.modal({ title: r.linked ? 'Account opened' : 'Account pre-opened', body: h`<p class="muted">${r.linked ? 'The account was added to the customer\'s profile.' : 'Share this account number. It becomes active when the customer signs up with ' + d.email + '.'}</p><div class="receipt-amount mt-3 num">${A.groupDigits(r.account_number)}</div>`,
            foot: h`<button class="btn btn-soft" data-copy-num>${icon('copy', 'i-sm')}Copy</button><button class="btn btn-primary" data-close>Done</button>`,
            onOpen: function (el) { el.querySelector('[data-copy-num]').addEventListener('click', function () { A.copy(r.account_number); }); } });
          e.target.reset();
          reload();
        }, function (x) { A.busy(btn, false); err(x); });
    });
    A.q(A.sb.from('account_invites').select('*').order('created_at', { ascending: false })).then(function (rows) {
      if (!isCurrent(token)) return;
      $('#invList').innerHTML = (rows.length ? h`<div class="table-wrap"><table class="table"><tbody>${rows.map(function (r) {
        return h`<tr><td><b class="small">${r.full_name || r.email}</b><div class="tiny muted">${r.email}</div></td><td class="small num">${r.account_number}<div class="tiny muted">${r.currency} · ${A.money(r.opening_balance, r.currency)}</div></td>
          <td>${r.claimed_by ? badge('active') : h`<span class="badge badge-pending">waiting</span>`}</td><td class="right">${r.claimed_by ? '' : h`<button class="btn btn-ghost btn-sm" data-del-inv="${r.id}" style="color:var(--danger)">Delete</button>`}</td></tr>`;
      })}</tbody></table></div>` : empty('mail', 'No pre-opened accounts', 'Accounts you open for people who have not signed up yet appear here.')).toString();
      A.on($('#invList'), 'click', '[data-del-inv]', function (e, b) { run(A.rpc('admin_delete_invite', { p_invite: b.getAttribute('data-del-inv') }), 'Invite deleted').catch(function () {}); });
    }, err);
  };

  views.loans = function (token) {
    setBody(h`<div class="page-head"><div><h2>Loans</h2><p>Approve to pay the money out instantly.</p></div></div><section class="card" id="loanTable">${skeleton(4)}</section>`);
    A.q(A.sb.from('loans').select('*').order('created_at', { ascending: false })).then(function (rows) {
      if (!isCurrent(token)) return;
      rows.sort(function (a, b) { return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1); });
      $('#loanTable').innerHTML = (rows.length ? h`<div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th>Amount</th><th>Term</th><th>Purpose</th><th>Status</th><th class="right">Outstanding</th><th class="right">Actions</th></tr></thead><tbody>${rows.map(function (l) {
        var p = prof(l.user_id);
        return h`<tr><td>${userCell(p)}</td><td class="num"><b>${A.money(l.amount, l.currency)}</b><div class="tiny muted">${A.money(l.monthly_payment, l.currency)}/mo</div></td><td>${l.term_months} mo</td><td class="small" style="max-width:220px">${l.purpose || '—'}</td><td>${badge(l.status)}</td><td class="right num">${A.money(l.outstanding, l.currency)}</td>
          <td><div class="actions-cell">${l.status === 'pending' ? h`<button class="btn btn-success-soft btn-sm" data-loan="${l.id}" data-ok="1">Approve</button><button class="btn btn-danger-soft btn-sm" data-loan="${l.id}" data-ok="0">Reject</button>` : ''}</div></td></tr>`;
      })}</tbody></table></div>` : empty('handshake', 'No loan applications')).toString();
      A.on($('#loanTable'), 'click', '[data-loan]', function (e, b) {
        var ok = b.getAttribute('data-ok') === '1', l = rows.find(function (x) { return x.id === b.getAttribute('data-loan'); });
        A.prompt({ title: (ok ? 'Approve ' : 'Reject ') + A.money(l.amount, l.currency) + ' loan?', subtitle: ok ? 'The amount is paid into the customer\'s account now.' : '', label: ok ? 'Note (optional)' : 'Reason shown to the customer', required: !ok, multiline: true, confirmText: ok ? 'Approve & pay out' : 'Reject', danger: !ok })
          .then(function (note) { if (note === null) return; run(A.rpc('admin_decide_loan', { p_loan: l.id, p_approve: ok, p_note: note || null }), ok ? 'Loan approved and paid out' : 'Loan rejected').catch(function () {}); });
      });
    }, err);
  };

  views.kyc = function () {
    var list = S.profiles.filter(function (p) { return p.kyc_status === 'pending'; });
    setBody(h`<div class="page-head"><div><h2>Identity verification</h2><p>${list.length} waiting for review.</p></div></div>
      <section class="card">${list.length ? h`<div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th>Document</th><th>Date of birth</th><th>Address</th><th class="right">Actions</th></tr></thead><tbody>${list.map(function (p) {
        return h`<tr><td>${userCell(p)}</td><td class="small">${(p.kyc_document_type || '').replace('_', ' ')}<div class="num">${p.kyc_document_number}</div></td><td class="small">${p.date_of_birth ? A.date(p.date_of_birth) : '—'}</td><td class="small">${[p.address, p.city, p.country].filter(Boolean).join(', ')}</td>
          <td><div class="actions-cell"><button class="btn btn-success-soft btn-sm" data-kyc="${p.id}" data-ok="1">Approve</button><button class="btn btn-danger-soft btn-sm" data-kyc="${p.id}" data-ok="0">Reject</button></div></td></tr>`;
      })}</tbody></table></div>` : empty('shield-check', 'All caught up', 'New identity submissions will appear here.')}</section>`);
    A.on($('#viewBody section.card'), 'click', '[data-kyc]', function (e, b) {
      var id = b.getAttribute('data-kyc'), ok = b.getAttribute('data-ok') === '1';
      if (ok) return run(A.rpc('admin_decide_kyc', { p_user: id, p_approve: true }), 'Identity verified').catch(function () {});
      A.prompt({ title: 'Reject verification', label: 'Reason shown to the customer', required: true, multiline: true, confirmText: 'Reject', danger: true })
        .then(function (n) { if (n) run(A.rpc('admin_decide_kyc', { p_user: id, p_approve: false, p_note: n }), 'Verification rejected').catch(function () {}); });
    });
  };

  views.support = function (token, route) {
    setBody(h`<div class="page-head"><div><h2>Support</h2><p>Reply to customers. They get a notification instantly.</p></div>
      <div class="segmented" id="tkFilter"><button aria-selected="true" data-f="open">Open</button><button aria-selected="false" data-f="answered">Answered</button><button aria-selected="false" data-f="closed">Closed</button><button aria-selected="false" data-f="">All</button></div></div>
      <div class="ticket-layout"><section class="card" style="overflow:hidden" id="tkList">${skeleton(3)}</section><section class="card" id="tkView"></section></div>`);
    var filter = 'open', tickets = [];
    var drawList = function () {
      var list = tickets.filter(function (t) { return !filter || t.status === filter; });
      $('#tkList').innerHTML = (list.length ? list.map(function (t) {
        var p = prof(t.user_id);
        return h`<a class="ticket-item ${route.sub === t.id ? 'active' : ''}" href="#/support/${t.id}"><div class="row-between"><b class="truncate">${t.subject}</b>${badge(t.status)}</div><small>${p ? p.full_name : ''} · ${A.date(t.updated_at, 'relative')}</small></a>`;
      }).join('') : empty('message', 'No tickets here')).toString();
    };
    A.on($('#tkFilter'), 'click', '[data-f]', function (e, b) {
      filter = b.getAttribute('data-f');
      $$('#tkFilter button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      drawList();
    });
    A.q(A.sb.from('support_tickets').select('*').order('updated_at', { ascending: false })).then(function (rows) {
      if (!isCurrent(token)) return;
      tickets = rows; drawList();
      var t = rows.find(function (x) { return x.id === route.sub; });
      if (!t) { $('#tkView').innerHTML = empty('support', 'Choose a ticket', 'Select a conversation to read and reply.').toString(); return; }
      var p = prof(t.user_id);
      A.q(A.sb.from('ticket_messages').select('*').eq('ticket_id', t.id).order('created_at')).then(function (msgs) {
        if (!isCurrent(token)) return;
        $('#tkView').innerHTML = h`<div class="card-head"><div><h3>${t.subject}</h3><div class="tiny muted">${p ? p.full_name + ' · ' + p.email : ''} · ${t.category}</div></div>
            <div class="row">${p ? h`<button class="btn btn-ghost btn-sm" data-customer="${p.id}">Profile</button>` : ''}${t.status !== 'closed' ? h`<button class="btn btn-soft btn-sm" id="tkClose">Close</button>` : ''}</div></div>
          <div class="chat" id="chat">${msgs.map(function (m) { return h`<div class="bubble ${m.is_staff ? 'me' : 'staff'}">${m.body}<small>${m.is_staff ? 'Aureon · ' : (p ? p.full_name + ' · ' : '')}${A.date(m.created_at, 'relative')}</small></div>`; })}</div>
          <form class="chat-form" id="tkForm"><label class="sr-only" for="tkInput">Reply</label><textarea class="textarea" id="tkInput" maxlength="4000" placeholder="Write a reply…" required></textarea><button class="btn btn-primary" type="submit" aria-label="Send reply">${icon('send')}</button></form>`.toString();
        $('#chat').scrollTop = $('#chat').scrollHeight;
        $('#tkForm').addEventListener('submit', function (e) {
          e.preventDefault();
          var v = $('#tkInput').value.trim(); if (!v) return;
          run(A.rpc('post_ticket_message', { p_ticket: t.id, p_body: v }), 'Reply sent').catch(function () {});
        });
        $('#tkInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#tkForm').requestSubmit(); } });
        var c = $('#tkClose'); if (c) c.addEventListener('click', function () { run(A.rpc('set_ticket_status', { p_ticket: t.id, p_status: 'closed' }), 'Ticket closed').catch(function () {}); });
      }, err);
    }, err);
  };

  views.settings = function () {
    var s = S.settings, pct = function (v) { return (Number(v) * 100).toFixed(2); };
    setBody(h`<div class="page-head"><div><h2>Rates &amp; settings</h2><p>Changes apply to every customer immediately.</p></div></div>
      <div class="grid-2">
        <form class="card card-pad" id="setForm">
          <h3 style="font-size:16px">Fees &amp; limits</h3>
          <div class="field-row mt-4"><div class="field"><label class="label" for="s-if">Aureon transfer fee (%)</label><input class="input num" id="s-if" name="internal_fee_pct" type="number" step="0.01" min="0" max="10" value="${pct(s.internal_fee_pct)}"></div>
            <div class="field"><label class="label" for="s-ef">External transfer fee (%)</label><input class="input num" id="s-ef" name="external_fee_pct" type="number" step="0.01" min="0" max="10" value="${pct(s.external_fee_pct)}"></div></div>
          <div class="field-row mt-4"><div class="field"><label class="label" for="s-em">Minimum external fee (${base()})</label><input class="input num" id="s-em" name="external_fee_min" type="number" step="0.01" min="0" value="${s.external_fee_min}"></div>
            <div class="field"><label class="label" for="s-rt">Review transfers from (${base()})</label><input class="input num" id="s-rt" name="review_threshold" type="number" step="1" min="1" value="${s.review_threshold}"></div></div>
          <div class="field-row mt-4"><div class="field"><label class="label" for="s-dl">Daily limit (${base()})</label><input class="input num" id="s-dl" name="daily_limit" type="number" step="1" min="1" value="${s.daily_limit}"></div>
            <div class="field"><label class="label" for="s-wb">Welcome bonus (${base()})</label><input class="input num" id="s-wb" name="welcome_bonus" type="number" step="0.01" min="0" value="${s.welcome_bonus}"></div></div>
          <h3 style="font-size:16px" class="mt-6">Interest</h3>
          <div class="field-row mt-4"><div class="field"><label class="label" for="s-la">Loan APR (%)</label><input class="input num" id="s-la" name="loan_apr" type="number" step="0.01" min="0" max="100" value="${pct(s.loan_apr)}"></div>
            <div class="field"><label class="label" for="s-sa">Savings APR (%)</label><input class="input num" id="s-sa" name="savings_apr" type="number" step="0.01" min="0" max="100" value="${pct(s.savings_apr)}"></div></div>
          <div class="field"><label class="label" for="s-ml">Maximum loan (${base()})</label><input class="input num" id="s-ml" name="max_loan" type="number" step="1" min="1" value="${s.max_loan}"></div>
          <button class="btn btn-primary mt-6" type="submit">Save settings</button>
        </form>
        <div class="stack-lg">
          <section class="card card-pad"><h3 style="font-size:16px">Exchange rates</h3><p class="small muted mt-1">Units of each currency per 1 USD.</p>
            <div class="stack mt-4" id="fxList">${S.fxRows.map(function (r) {
              return h`<form class="row fx-form" data-ccy="${r.currency}"><span class="ccy-badge" style="width:38px;height:38px;font-size:12px">${A.symbol(r.currency).trim()}</span><span class="grow"><b class="small">${r.currency}</b><div class="tiny muted">${r.name} · updated ${A.date(r.updated_at, 'relative')}</div></span>
                <input class="input num" style="width:130px;height:40px" name="rate" type="number" step="0.000001" min="0.000001" value="${r.per_usd}" ${r.currency === 'USD' ? 'disabled' : ''} aria-label="${r.currency} per USD">${r.currency === 'USD' ? '' : h`<button class="btn btn-soft btn-sm" type="submit">Save</button>`}</form>`;
            })}</div></section>
          <section class="card card-pad"><h3 style="font-size:16px">Monthly interest</h3><p class="small muted mt-1">Pays ${pct(s.savings_apr)}% ÷ 12 into every active savings account. Run once a month.</p>
            <button class="btn btn-soft mt-4" id="interestBtn">${icon('percent', 'i-sm')}Pay interest now</button></section>
          <section class="card card-pad"><h3 style="font-size:16px">Announcements</h3><p class="small muted mt-1">Send an in-app notification to every customer.</p>
            <button class="btn btn-soft mt-4" data-action="broadcast">${icon('bell', 'i-sm')}Message all customers</button></section>
        </div>
      </div>`);
    $('#setForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var d = A.formData(e.target), btn = e.target.querySelector('[type=submit]'), p = {};
      ['internal_fee_pct', 'external_fee_pct', 'loan_apr', 'savings_apr'].forEach(function (k) { p[k] = Number(d[k]) / 100; });
      ['external_fee_min', 'review_threshold', 'daily_limit', 'welcome_bonus', 'max_loan'].forEach(function (k) { p[k] = Number(d[k]); });
      A.busy(btn, true);
      run(A.rpc('admin_update_settings', { p: p }), 'Settings saved').then(function () { A.busy(btn, false); }, function () { A.busy(btn, false); });
    });
    A.on($('#fxList'), 'submit', '.fx-form', function (e, form) {
      e.preventDefault();
      run(A.rpc('admin_set_fx_rate', { p_currency: form.getAttribute('data-ccy'), p_per_usd: Number(form.rate.value) }), form.getAttribute('data-ccy') + ' rate updated').catch(function () {});
    });
    $('#interestBtn').addEventListener('click', function () {
      A.confirm({ title: 'Pay monthly interest?', body: 'Every active savings account receives one month of interest now.', confirmText: 'Pay interest' }).then(function (ok) {
        if (ok) run(A.rpc('admin_apply_interest'), null).then(function (r) { A.toast('Interest paid to ' + r.accounts + ' account' + (r.accounts === 1 ? '' : 's'), { type: 'success' }); }, function () {});
      });
    });
  };

  views.audit = function (token) {
    setBody(h`<div class="page-head"><div><h2>Audit log</h2><p>Every administrative action, newest first.</p></div></div><section class="card" id="auditBox">${skeleton(6)}</section>`);
    A.q(A.sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300)).then(function (rows) {
      if (!isCurrent(token)) return;
      $('#auditBox').innerHTML = (rows.length ? h`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows.map(function (r) {
        var p = prof(r.actor_id), d = r.details || {};
        var summary = Object.keys(d).filter(function (k) { return d[k] !== null && d[k] !== '' && typeof d[k] !== 'object'; }).slice(0, 6).map(function (k) { return k + ': ' + d[k]; }).join(' · ');
        return h`<tr><td class="small" style="white-space:nowrap">${A.date(r.created_at, 'long')}</td><td class="small">${p ? p.full_name : '—'}</td><td><span class="badge badge-info no-dot">${r.action}</span></td><td class="tiny muted" style="max-width:520px">${summary}</td></tr>`;
      })}</tbody></table></div>` : empty('file', 'No admin actions yet')).toString();
    }, err);
  };

  /* =========================================================================
     Router & boot
     ========================================================================= */
  function parseRoute() {
    var raw = location.hash.replace(/^#\/?/, ''), q = '', i = raw.indexOf('?');
    if (i >= 0) { q = raw.slice(i + 1); raw = raw.slice(0, i); }
    var parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'overview', sub: parts[1] || '', params: new URLSearchParams(q) };
  }
  function render(keep) {
    var route = parseRoute();
    if (route.name === 'more') { openSidebar(true); history.replaceState(null, '', S.route ? '#/' + S.route.name : '#/overview'); return; }
    if (!views[route.name]) { location.replace('#/overview'); return; }
    var changed = !S.route || S.route.name !== route.name || S.route.sub !== route.sub;
    S.route = route;
    var token = ++S.renderToken;
    closePopovers(); openSidebar(false);
    $('#pageTitle').textContent = TITLES[route.name];
    document.title = TITLES[route.name] + ' · Aureon Admin';
    renderChrome();
    var view = $('#view');
    if (changed) { view.classList.remove('entering'); void view.offsetWidth; view.classList.add('entering'); if (!keep) window.scrollTo(0, 0); }
    try { views[route.name](token, route); }
    catch (e) { console.error(e); setBody(h`<div class="card">${empty('alert', 'Something went wrong', A.friendlyError(e))}</div>`); }
  }
  window.addEventListener('hashchange', function () { A.closeAll(); render(false); });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (el) {
      var a = el.getAttribute('data-action');
      if (el.tagName === 'A' && a === 'menu') e.preventDefault();
      if (a === 'menu') openSidebar(!$('#sidebar').classList.contains('open'));
      else if (a === 'signout') A.signOut();
      else if (a === 'post-txn') postTransaction();
      else if (a === 'broadcast') messageFlow(null);
      else if (a === 'notifications') {
        var st = S.stats;
        popover(el, h`<div class="popover-head"><h3>Needs attention</h3></div><div class="menu-list">
          <a href="#/transactions?status=pending">${icon('clock')}Pending transfers <b style="margin-left:auto">${st.pending_transactions}</b></a>
          <a href="#/kyc">${icon('shield-check')}Verifications <b style="margin-left:auto">${st.pending_kyc}</b></a>
          <a href="#/loans">${icon('handshake')}Loan applications <b style="margin-left:auto">${st.pending_loans}</b></a>
          <a href="#/support">${icon('support')}Open tickets <b style="margin-left:auto">${st.open_tickets}</b></a></div>`);
      } else if (a === 'user-menu') {
        popover(el, h`<div class="popover-head"><div><b>${S.me.full_name}</b><div class="small muted">${S.me.email}</div></div></div><div class="menu-list">
          <a href="app.html">${icon('wallet')}My banking</a><a href="index.html">${icon('home')}Public website</a><button class="danger" data-action="signout">${icon('logout')}Sign out</button></div>`);
      }
      return;
    }
    var c = e.target.closest('[data-customer]');
    if (c) { closePopovers(); openCustomer(c.getAttribute('data-customer')); }
  });

  var softReload = A.debounce(function () {
    if (document.querySelector('.overlay')) return;   // don't yank the page from under an open dialog
    loadAll().then(function () { renderChrome(); if (['overview', 'transactions', 'customers'].indexOf(S.route.name) !== -1) render(true); });
  }, 1200);
  A.sb && A.sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') location.replace('login.html'); });

  A.requireUser({ admin: true }).then(function (ctx) {
    S.session = ctx.session; S.me = ctx.profile;
    return loadAll();
  }).then(function () {
    renderChrome(); render(false);
    A.sb.channel('aureon-admin')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, softReload)
      .subscribe();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') softReload(); });
    $('#boot').classList.add('done');
    setTimeout(function () { var b = $('#boot'); if (b) b.remove(); }, 400);
  }).catch(function (e) {
    console.error(e);
    $('#boot').classList.add('done');
    setBody(h`<div class="card" style="max-width:560px;margin:40px auto">${empty('alert', 'Could not load the admin console', A.friendlyError(e))}</div>`);
  });
})();
