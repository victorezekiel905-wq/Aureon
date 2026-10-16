/* Aureon core — shared helpers for every page. Exposes window.A */
(function () {
  'use strict';

  var cfg = window.AUREON_CONFIG || {};
  var A = {};
  window.A = A;
  A.config = cfg;

  /* ---------- Supabase ---------- */
  A.configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  A.sb = A.configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'aureon-auth' }
      })
    : null;

  /* ---------- safe HTML templating ---------- */
  function Raw(s) { this.s = s; }
  Raw.prototype.toString = function () { return this.s; };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  A.esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  A.raw = function (s) { return new Raw(String(s == null ? '' : s)); };
  function val(v) {
    if (v == null || v === false) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(val).join('');
    return A.esc(v);
  }
  /** Tagged template: interpolations are HTML-escaped unless wrapped in A.raw() or produced by A.html. */
  A.html = function (strings) {
    var out = '';
    for (var i = 0; i < strings.length; i++) {
      out += strings[i];
      if (i + 1 < arguments.length) out += val(arguments[i + 1]);
    }
    return new Raw(out);
  };
  A.icon = function (name, cls) { return new Raw(window.aIcon ? window.aIcon(name, cls) : ''); };

  /* ---------- DOM helpers ---------- */
  A.$ = function (sel, root) { return (root || document).querySelector(sel); };
  A.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  A.on = function (root, type, selector, handler) {
    root.addEventListener(type, function (e) {
      var t = e.target.closest(selector);
      if (t && root.contains(t)) handler(e, t);
    });
  };
  A.formData = function (form) {
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
    return data;
  };
  A.busy = function (btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!on);
    btn.disabled = !!on;
  };
  A.debounce = function (fn, ms) {
    var t;
    return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms || 250); };
  };
  A.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };
  A.initials = function (name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  A.copy = function (text) {
    var done = function () { A.toast('Copied to clipboard', { type: 'success', timeout: 1800 }); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(String(text)).then(done);
    var ta = document.createElement('textarea');
    ta.value = String(text); ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { A.toast('Copy failed', { type: 'error' }); }
    ta.remove();
    return Promise.resolve();
  };

  /* ---------- formatting ---------- */
  var SYMBOLS = { USD: '$', EUR: '€', GBP: '£', NGN: '₦', CAD: 'C$' };
  A.symbol = function (c) { return SYMBOLS[c] || (c ? c + ' ' : ''); };
  var nfCache = {};
  A.money = function (amount, currency, opts) {
    opts = opts || {};
    var cur = currency || 'USD';
    var key = cur + (opts.compact ? 'c' : '') + (opts.noCents ? 'n' : '');
    if (!nfCache[key]) {
      try {
        nfCache[key] = new Intl.NumberFormat(undefined, {
          style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol',
          notation: opts.compact ? 'compact' : 'standard',
          minimumFractionDigits: opts.compact || opts.noCents ? 0 : 2,
          maximumFractionDigits: opts.compact ? 1 : (opts.noCents ? 0 : 2)
        });
      } catch (e) {
        nfCache[key] = { format: function (n) { return A.symbol(cur) + Number(n).toFixed(2); } };
      }
    }
    var n = Number(amount || 0);
    var s = nfCache[key].format(Math.abs(n));
    if (opts.sign === true) return (n < 0 ? '−' : '+') + s;
    if (opts.sign === '-') return '−' + s;
    return n < 0 ? '−' + s : s;
  };
  A.number = function (n, d) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d == null ? 2 : d }); };
  A.date = function (v, style) {
    if (!v) return '—';
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return '—';
    if (style === 'relative') {
      var diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    }
    if (style === 'time') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (style === 'day') {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var that = new Date(d); that.setHours(0, 0, 0, 0);
      var days = Math.round((today - that) / 86400000);
      if (days === 0) return 'Today';
      if (days === 1) return 'Yesterday';
      return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: that.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    }
    if (style === 'long') return d.toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (style === 'iso') return d.toISOString().slice(0, 10);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  A.maskAccount = function (n) { n = String(n || ''); return n.length > 4 ? '••' + n.slice(-4) : n; };
  A.groupDigits = function (n) { return String(n || '').replace(/(\d{4})(?=\d)/g, '$1 '); };
  A.greeting = function () {
    var h = new Date().getHours();
    return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  /* ---------- theme ---------- */
  A.theme = {
    current: function () {
      var t = document.documentElement.getAttribute('data-theme');
      if (t) return t;
      return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    set: function (t) {
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('aureon-theme', t); } catch (e) { /* storage blocked */ }
      document.dispatchEvent(new CustomEvent('aureon:theme', { detail: t }));
    },
    toggle: function () { A.theme.set(A.theme.current() === 'dark' ? 'light' : 'dark'); }
  };
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-theme-toggle]')) A.theme.toggle();
  });

  /* ---------- toasts ---------- */
  var toastRoot;
  var TOAST_ICON = { success: 'check-circle', error: 'x-circle', warning: 'alert', info: 'info' };
  A.toast = function (title, opts) {
    opts = opts || {};
    if (!toastRoot) {
      toastRoot = document.createElement('div');
      toastRoot.className = 'toasts';
      toastRoot.setAttribute('role', 'status');
      toastRoot.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastRoot);
    }
    var type = opts.type || 'info';
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = A.html`${A.icon(TOAST_ICON[type] || 'info')}<div class="grow"><div class="toast-title">${title}</div>${opts.body ? A.html`<div class="toast-body">${opts.body}</div>` : ''}</div><button class="toast-close" aria-label="Dismiss">${A.icon('x', 'i-sm')}</button>`;
    var remove = function () {
      if (!el.isConnected) return;
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 250);
    };
    el.querySelector('.toast-close').addEventListener('click', remove);
    toastRoot.appendChild(el);
    while (toastRoot.children.length > 4) toastRoot.firstChild.remove();
    setTimeout(remove, opts.timeout || (type === 'error' ? 6000 : 4000));
    return remove;
  };

  /* ---------- modal & drawer ---------- */
  var openLayers = [];
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openLayers.length) {
      var top = openLayers[openLayers.length - 1];
      if (top.dismissible) top.close(null);
    }
  });

  /**
   * A.modal({ title, subtitle, body, foot, size: 'lg', drawer: true, dismissible, onOpen(el, close) })
   * Returns a promise resolved with whatever close(value) receives.
   */
  A.modal = function (o) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var overlay = document.createElement('div');
      overlay.className = 'overlay' + (o.drawer ? ' drawer-overlay' : '');
      overlay.innerHTML = A.html`
        <div class="${o.drawer ? 'drawer' : 'modal' + (o.size === 'lg' ? ' modal-lg' : '')}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          ${o.title ? A.html`<div class="modal-head"><div><h2 id="dlg-title">${o.title}</h2>${o.subtitle ? A.html`<p>${o.subtitle}</p>` : ''}</div>
            <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${A.icon('x')}</button></div>` : ''}
          <div class="modal-body">${o.body || ''}</div>
          ${o.foot ? A.html`<div class="modal-foot">${o.foot}</div>` : ''}
        </div>`;
      var layer = { dismissible: o.dismissible !== false, close: null };
      var closed = false;
      function close(value) {
        if (closed) return;
        closed = true;
        overlay.classList.add('leaving');
        openLayers.splice(openLayers.indexOf(layer), 1);
        setTimeout(function () {
          overlay.remove();
          if (!openLayers.length) document.body.style.overflow = '';
          if (prevFocus && prevFocus.focus) prevFocus.focus();
        }, 170);
        resolve(value);
      }
      layer.close = close;
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && layer.dismissible) close(null); });
      A.on(overlay, 'click', '[data-close]', function () { close(null); });
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      openLayers.push(layer);
      var panel = overlay.firstElementChild;
      if (o.onOpen) o.onOpen(panel, close);
      var focusable = panel.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button:not([data-close])');
      if (focusable && !o.noAutofocus) setTimeout(function () { if (!panel.contains(document.activeElement)) focusable.focus(); }, 60);
    });
  };

  /** Closes every open modal/drawer (used when the route changes, e.g. browser Back). */
  A.closeAll = function () { openLayers.slice().forEach(function (l) { l.close(null); }); };

  A.confirm = function (o) {
    return A.modal({
      title: o.title,
      body: A.html`<p class="muted">${o.body || ''}</p>`,
      foot: A.html`<button class="btn btn-ghost" data-close>${o.cancelText || 'Cancel'}</button>
                   <button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-ok>${o.confirmText || 'Confirm'}</button>`,
      onOpen: function (el, close) { el.querySelector('[data-ok]').addEventListener('click', function () { close(true); }); }
    }).then(function (v) { return v === true; });
  };

  /** Ask for a short text. Resolves the string, or null if cancelled. */
  A.prompt = function (o) {
    return A.modal({
      title: o.title,
      subtitle: o.subtitle,
      body: A.html`<form id="prompt-form"><div class="field"><label class="label" for="prompt-input">${o.label || ''}</label>
        ${o.multiline
          ? A.html`<textarea class="textarea" id="prompt-input" placeholder="${o.placeholder || ''}" ${o.required ? 'required' : ''}>${o.value || ''}</textarea>`
          : A.html`<input class="input" id="prompt-input" type="${o.type || 'text'}" step="any" value="${o.value || ''}" placeholder="${o.placeholder || ''}" ${o.required ? 'required' : ''}>`}
        </div></form>`,
      foot: A.html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" form="prompt-form" type="submit">${o.confirmText || 'Save'}</button>`,
      onOpen: function (el, close) {
        el.closest('.overlay').querySelector('#prompt-form').addEventListener('submit', function (e) {
          e.preventDefault();
          close(el.querySelector('#prompt-input').value.trim());
        });
      }
    });
  };

  /**
   * PIN pad. onSubmit(pin) should return a promise; if it rejects, the error is
   * shown on the pad and the user can retry. Resolves with onSubmit's result,
   * or null if the user cancels.
   */
  A.pinPad = function (o) {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    return A.modal({
      title: o.title || 'Enter your PIN',
      subtitle: o.subtitle || 'Your 4-digit transaction PIN authorises this payment.',
      body: A.html`
        <div class="pin-dots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <div class="pin-error" role="alert"></div>
        <input class="sr-only" id="pin-input" inputmode="numeric" autocomplete="one-time-code" maxlength="4" aria-label="PIN">
        <div class="pin-pad">${keys.map(function (k) {
          if (!k) return A.html`<span></span>`;
          if (k === 'del') return A.html`<button type="button" class="ghost" data-key="del" aria-label="Delete">${A.icon('arrow-left')}</button>`;
          return A.html`<button type="button" data-key="${k}">${k}</button>`;
        })}</div>
        ${o.footer ? A.html`<p class="tiny muted text-center mt-4">${o.footer}</p>` : ''}`,
      noAutofocus: true,
      onOpen: function (el, close) {
        var pin = '';
        var busy = false;
        var dots = A.$$('.pin-dots span', el);
        var err = A.$('.pin-error', el);
        var input = A.$('#pin-input', el);
        var paint = function () { dots.forEach(function (d, i) { d.classList.toggle('filled', i < pin.length); }); };
        var fail = function (msg) {
          err.textContent = msg;
          pin = ''; paint();
          var box = A.$('.pin-dots', el); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        };
        var submit = function () {
          busy = true;
          err.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;vertical-align:-3px"></span>';
          Promise.resolve(o.onSubmit(pin)).then(function (res) { busy = false; close(res); }, function (e) { busy = false; fail(A.friendlyError(e)); });
        };
        var press = function (k) {
          if (busy) return;
          if (k === 'del') pin = pin.slice(0, -1);
          else if (/^\d$/.test(k) && pin.length < 4) pin += k;
          err.textContent = '';
          paint();
          if (pin.length === 4) submit();
        };
        A.on(el, 'click', '[data-key]', function (e, b) { press(b.getAttribute('data-key')); });
        // Digits typed anywhere go to the pad while it is the top-most dialog.
        var onKey = function (e) {
          if (!el.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
          if (el.closest('.overlay').classList.contains('leaving')) return;
          if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); e.stopPropagation(); }
          else if (e.key === 'Backspace') { press('del'); e.preventDefault(); e.stopPropagation(); }
        };
        document.addEventListener('keydown', onKey, true);
        el.setAttribute('tabindex', '-1');
        setTimeout(function () { (window.matchMedia('(pointer: coarse)').matches ? el : input).focus(); }, 80);
        input.addEventListener('input', function () { var v = input.value.replace(/\D/g, ''); input.value = ''; v.split('').forEach(press); });
      }
    });
  };

  /* ---------- errors & RPC ---------- */
  A.friendlyError = function (e) {
    var msg = (e && (e.message || e.error_description || e.error)) || String(e || 'Something went wrong.');
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Network problem — check your connection and try again.';
    if (/JWT expired|invalid JWT|Please sign in again/i.test(msg)) return 'Your session expired. Please sign in again.';
    if (/Invalid login credentials/i.test(msg)) return 'That email and password do not match.';
    if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox for the link.';
    if (/User already registered/i.test(msg)) return 'An account with this email already exists. Try signing in.';
    if (/rate limit|too many requests/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
    if (/Could not find the function|schema cache/i.test(msg)) return 'The database is not set up yet. Run supabase/schema.sql in your Supabase project.';
    if (/relation .* does not exist/i.test(msg)) return 'The database is not set up yet. Run supabase/schema.sql in your Supabase project.';
    if (/permission denied/i.test(msg)) return 'You do not have permission to do that.';
    return msg;
  };

  A.rpc = function (fn, args) {
    if (!A.sb) return Promise.reject(new Error('Supabase is not configured. Edit assets/js/config.js.'));
    return A.sb.rpc(fn, args || {}).then(function (res) {
      if (res.error) throw res.error;
      if (res.data && typeof res.data === 'object' && res.data.ok === false) {
        var e = new Error(res.data.error || 'Request failed');
        e.code = res.data.code;
        throw e;
      }
      return res.data;
    });
  };
  /** Runs a PostgREST query builder and returns data or throws. */
  A.q = function (builder) {
    return builder.then(function (res) { if (res.error) throw res.error; return res.data; });
  };

  /* ---------- auth ---------- */
  A.getSession = function () {
    if (!A.sb) return Promise.resolve(null);
    return A.sb.auth.getSession().then(function (r) { return r.data.session; });
  };
  A.fetchProfile = function (uid) {
    return A.q(A.sb.from('profiles').select('*').eq('id', uid).maybeSingle());
  };
  /** Redirects away unless signed in (and admin when opts.admin). Resolves { session, profile }. */
  A.requireUser = function (opts) {
    opts = opts || {};
    var here = location.pathname.split('/').pop() + location.hash;
    if (!A.sb) { A.renderSetupNotice(); return new Promise(function () {}); }
    return A.getSession().then(function (session) {
      if (!session) { location.replace('login.html?next=' + encodeURIComponent(here)); return new Promise(function () {}); }
      return A.fetchProfile(session.user.id).then(function (profile) {
        if (!profile) throw new Error('relation profiles does not exist');
        if (opts.admin && profile.role !== 'admin' && profile.role !== 'super_admin') { location.replace('app.html'); return new Promise(function () {}); }
        return { session: session, profile: profile };
      });
    });
  };
  A.signOut = function (scope) {
    var done = function () { location.replace('login.html'); };
    if (!A.sb) return done();
    return A.sb.auth.signOut(scope ? { scope: scope } : undefined).then(done, done);
  };
  A.setupNoticeHtml = function () {
    return A.html`<div class="setup-card">
        <span class="eyebrow">Setup required</span>
        <h2>Connect Aureon to Supabase</h2>
        <ol>
          <li>Create a free project at <a class="link" href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a>.</li>
          <li>Open <b>SQL Editor</b>, paste <code>supabase/schema.sql</code> and press <b>Run</b>.</li>
          <li>Copy the <b>Project URL</b> and <b>anon key</b> into <code>assets/js/config.js</code>.</li>
        </ol>
        <a class="btn btn-primary mt-4" href="index.html">Back to home</a>
      </div>`;
  };
  A.renderSetupNotice = function () {
    document.body.innerHTML = A.html`<main style="min-height:100vh;display:grid;place-items:center;padding:24px">${A.setupNoticeHtml()}</main>`.toString();
  };

  /* ---------- CSV ---------- */
  A.downloadCSV = function (filename, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // neutralise spreadsheet formulas
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  /** Shrinks an image file to a square JPEG data URL (used for avatars). */
  A.resizeImage = function (file, size) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('That image is larger than 8 MB.'));
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(img.width, img.height);
        var c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  };
})();
