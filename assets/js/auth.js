/* Aureon authentication pages: login, signup, forgot-password, reset-password */
(function () {
  'use strict';
  var $ = A.$, $$ = A.$$;
  var page = document.body.getAttribute('data-page');
  var card = $('#authCard');

  if (!A.configured) {
    card.innerHTML = A.setupNoticeHtml().toString();
    return;
  }

  var ADMIN_ROLES = ['admin', 'super_admin'];
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function msg(text, type, el) {
    el = el || $('#formMsg');
    if (!el) return;
    if (!text) { el.innerHTML = ''; return; }
    el.innerHTML = A.html`<div class="alert alert-${type || 'danger'}">${A.icon(type === 'success' ? 'check-circle' : 'alert')}<span>${text}</span></div>`.toString();
  }
  function invalid(input, bad) { input.setAttribute('aria-invalid', bad ? 'true' : 'false'); }
  function pageUrl(file) { return new URL(file, location.href).href; }

  // Only allow redirects back into our own app pages.
  function safeNext() {
    var next = new URLSearchParams(location.search).get('next') || '';
    return /^(app|admin)\.html(#\/[\w\-/]*)?$/.test(next) ? next : '';
  }
  function routeFor(profile) {
    var next = safeNext();
    var isAdmin = profile && ADMIN_ROLES.indexOf(profile.role) !== -1;
    if (next && (next.indexOf('admin.html') !== 0 || isAdmin)) return next;
    return isAdmin ? 'admin.html' : 'app.html';
  }
  function goHome(session) {
    return A.fetchProfile(session.user.id).then(function (p) { location.replace(routeFor(p)); });
  }

  // password reveal buttons
  A.on(document, 'click', '[data-reveal]', function (e, b) {
    var input = document.getElementById(b.getAttribute('data-reveal'));
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    b.innerHTML = A.icon(show ? 'eye-off' : 'eye', 'i-sm').toString();
  });

  function scorePassword(pw) {
    var s = 0;
    if (pw.length >= 8) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) s++;
    return pw.length < 8 ? Math.min(s, 1) : s;
  }
  function bindStrength() {
    var pw = $('#password'), meter = $('#strength'), hint = $('#strengthHint');
    if (!pw || !meter) return;
    pw.addEventListener('input', function () {
      var s = scorePassword(pw.value);
      meter.setAttribute('data-score', String(s));
      if (hint) hint.textContent = ['Use 8+ characters with a mix of letters, numbers and symbols.', 'Too weak — add more characters.', 'Fair — add a number or symbol.', 'Good password.', 'Strong password.'][s];
    });
  }
  function checkPasswords() {
    var pw = $('#password'), cf = $('#confirm');
    if (pw.value.length < 8) { invalid(pw, true); return 'Your password needs at least 8 characters.'; }
    if (scorePassword(pw.value) < 2) { invalid(pw, true); return 'Choose a stronger password — mix letters with numbers or symbols.'; }
    invalid(pw, false);
    if (pw.value !== cf.value) { invalid(cf, true); return 'The two passwords do not match.'; }
    invalid(cf, false);
    return '';
  }

  /* ---------------- login ---------------- */
  if (page === 'login') {
    A.getSession().then(function (s) { if (s) goHome(s); });
    var form = $('#loginForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#email'), pw = $('#password');
      var bad = !EMAIL_RE.test(email.value.trim());
      invalid(email, bad);
      if (bad) return msg('Enter a valid email address.');
      if (!pw.value) { invalid(pw, true); return msg('Enter your password.'); }
      var btn = form.querySelector('[type=submit]');
      A.busy(btn, true); msg('');
      A.sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value })
        .then(function (res) {
          if (res.error) throw res.error;
          return goHome(res.data.session);
        })
        .catch(function (err) { A.busy(btn, false); msg(A.friendlyError(err)); });
    });
  }

  /* ---------------- signup ---------------- */
  if (page === 'signup') {
    A.getSession().then(function (s) { if (s) goHome(s); });
    bindStrength();
    var sform = $('#signupForm');
    var steps = $$('.form-step', sform), bars = $$('.stepper span');
    var setStep = function (n) {
      steps.forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-step') === String(n)); });
      bars.forEach(function (b, i) { b.classList.toggle('on', i < n); });
      $('#stepNo').textContent = String(n);
      $('#stepName').textContent = n === 1 ? 'About you' : 'Security';
      var first = steps[n - 1].querySelector('input, select');
      if (first) first.focus();
    };
    var stepOneMsg = $('[data-msg="1"]');
    $('#toStep2').addEventListener('click', function () {
      var name = $('#full_name'), email = $('#email'), country = $('#country');
      var problems = [];
      invalid(name, name.value.trim().length < 3); if (name.value.trim().length < 3) problems.push('Enter your full name.');
      invalid(email, !EMAIL_RE.test(email.value.trim())); if (!EMAIL_RE.test(email.value.trim())) problems.push('Enter a valid email address.');
      invalid(country, !country.value.trim()); if (!country.value.trim()) problems.push('Enter your country.');
      if (problems.length) return msg(problems[0], 'danger', stepOneMsg);
      msg('', null, stepOneMsg);
      setStep(2);
    });
    $('#backStep1').addEventListener('click', function () { setStep(1); });
    sform.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && $('[data-step="1"]').classList.contains('active')) { e.preventDefault(); $('#toStep2').click(); }
    });
    sform.addEventListener('submit', function (e) {
      e.preventDefault();
      var problem = checkPasswords();
      if (problem) return msg(problem);
      if (!$('#terms').checked) return msg('Please accept the terms to continue.');
      var d = A.formData(sform);
      var btn = sform.querySelector('[type=submit]');
      A.busy(btn, true); msg('');
      A.sb.auth.signUp({
        email: d.email,
        password: $('#password').value,
        options: {
          emailRedirectTo: pageUrl('login.html'),
          data: { full_name: d.full_name, phone: d.phone || '', country: d.country, currency: d.currency }
        }
      }).then(function (res) {
        if (res.error) throw res.error;
        // The sign-up endpoint returns a user with no identities when the email is already registered.
        if (res.data.user && Array.isArray(res.data.user.identities) && res.data.user.identities.length === 0) {
          throw new Error('User already registered');
        }
        if (res.data.session) return goHome(res.data.session);
        $('#doneEmail').textContent = d.email;
        $('#signupFlow').hidden = true;
        $('#signupDone').hidden = false;
      }).catch(function (err) { A.busy(btn, false); msg(A.friendlyError(err)); });
    });
  }

  /* ---------------- forgot password ---------------- */
  if (page === 'forgot') {
    var fform = $('#forgotForm');
    fform.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#email');
      if (!EMAIL_RE.test(email.value.trim())) { invalid(email, true); return msg('Enter a valid email address.'); }
      invalid(email, false);
      var btn = fform.querySelector('[type=submit]');
      A.busy(btn, true); msg('');
      A.sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: pageUrl('reset-password.html') })
        .then(function (res) {
          if (res.error && /rate limit|too many/i.test(res.error.message)) throw res.error;
          // Always show the same confirmation so the form can't be used to discover accounts.
          $('#doneEmail').textContent = email.value.trim();
          $('#forgotFlow').hidden = true;
          $('#forgotDone').hidden = false;
        })
        .catch(function (err) { A.busy(btn, false); msg(A.friendlyError(err)); });
    });
  }

  /* ---------------- reset password ---------------- */
  if (page === 'reset') {
    bindStrength();
    var shown = false;
    var show = function (ok) {
      if (shown) return;
      shown = true;
      $('#resetWait').hidden = true;
      $(ok ? '#resetFlow' : '#resetInvalid').hidden = false;
      if (ok) $('#password').focus();
    };
    var hashError = /error_code=|error=/.test(location.hash);
    A.sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) show(true);
    });
    A.getSession().then(function (s) {
      if (s && !hashError) show(true);
      setTimeout(function () { show(false); }, 4000);
    });
    var rform = $('#resetForm');
    rform.addEventListener('submit', function (e) {
      e.preventDefault();
      var problem = checkPasswords();
      if (problem) return msg(problem);
      var btn = rform.querySelector('[type=submit]');
      A.busy(btn, true); msg('');
      A.sb.auth.updateUser({ password: $('#password').value }).then(function (res) {
        if (res.error) throw res.error;
        msg('Password saved. Taking you to your dashboard…', 'success');
        return A.getSession().then(function (s) { setTimeout(function () { goHome(s); }, 900); });
      }).catch(function (err) { A.busy(btn, false); msg(A.friendlyError(err)); });
    });
  }
})();
